#!/usr/bin/env node
/**
 * a5-verify.cjs — A5 独立重放脚本（验证 C5 P0 修复有效性）
 *
 * 不依赖 v10-trust-anchor-test.cjs 的 helper，独立构造攻击场景：
 *   Attack 1: worker 用 audit_session_id=null 给 root 调 audit_gate verdict=pass
 *             期望：拒绝 + root.audit_gate 不被改写
 *   Attack 2: worker 给 root 写 done event（触发 auto_upgrade）
 *             期望：拒绝 + root.audit_gate 不被升级 + root.status 不被改
 *   Attack 3 (额外深度): worker 伪装 added_by 字段尝试绕过 caller 校验
 *             期望：拒绝（added_by 在 leaf_add 时已被验证/绑定,worker 无法在 event_append 时修改）
 *
 * 引擎：patch-l/tree-engine.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

// A5 独立沙盒（不复用 v10-trust-anchor-test 的 core 目录）
const SANDBOX = path.join(__dirname, 'a5-sandbox');

// 清空并创建沙盒
if (fs.existsSync(SANDBOX)) fs.rmSync(SANDBOX, { recursive: true, force: true });
fs.mkdirSync(SANDBOX, { recursive: true });

// ---- engine require ----
const ENGINE_CANDIDATES = [
  path.join(__dirname, '..', 'patch-l', 'tree-engine.cjs'),
  'D:\\Proma-dev\\resources\\app\\dist\\tree-engine.cjs',
];
let _enginePath = null;
for (const c of ENGINE_CANDIDATES) {
  if (fs.existsSync(c)) { _enginePath = c; break; }
}
if (!_enginePath) throw new Error('tree-engine.cjs not found');
console.log(`engine: ${_enginePath}`);
const engine = require(_enginePath);
engine.setTreesRoot(SANDBOX);

// ---- 测试 UUID（用 v4 严格格式：version=4 + 合法 variant）----
// 注意：V10-uuid-format-strict 拒绝全 0。所以用合法 v4 UUID。
const UUID = {
  root:   'a5a5a5a5-1111-4111-8111-a5a5a5a5a001', // v4 (version=4)
  comm:   'a5a5a5a5-1111-4111-8111-a5a5a5a5a002',
  worker: 'a5a5a5a5-1111-4111-8111-a5a5a5a5a003',
  // 全 0 UUID（严格校验会拒）
  zero:   '00000000-0000-0000-0000-000000000000',
};

// ---- 工具 ----
async function call(cmdArgs, callerSessionId) {
  let out;
  if (callerSessionId) {
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1), null, callerSessionId);
  } else {
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  }
  return { ok: !!out.ok, error: out.error || null, result: out };
}

function readLeaf(tree_id, leaf_id) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  return state.leaves[leaf_id];
}

function banner(name) { console.log('\n' + '='.repeat(72) + '\n' + name + '\n' + '='.repeat(72)); }

// ---- 主流程 ----
(async () => {
  const results = { attacks: [] };

  // ============================================================
  // 攻击 1: worker 用 audit_session_id=null 给 root 调 audit_gate verdict=pass
  // ============================================================
  banner('ATTACK 1: worker 用 audit_session_id=null 给 root 调 audit_gate verdict=pass');
  const tid1 = 'att1';
  await call(['init', tid1,
    '--root-brief', JSON.stringify({ parent_intent: 'attack 1 test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  const rootId1 = `${tid1}-root`;
  // 加 commander（root 是 commander 的 added_by）
  await call(['leaf', 'add', tid1, '--json', JSON.stringify({
    leaf_id: `${tid1}-C-commander`, session_id: UUID.comm, parent: rootId1,
    path: 'C', role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  // root 先写 done event 建立 trust anchor（caller=root）
  const r0 = await call(['event', 'append', tid1, rootId1, '--type', 'done',
    '--json', JSON.stringify({ self_check: [{ item: 'root done', pass: true, evidence: 'e' }] })],
    UUID.root);
  console.log('root 写 done event:', r0.ok ? 'OK' : `FAIL ${r0.error && r0.error.code}`);
  const gateBefore = readLeaf(tid1, rootId1).audit_gate;
  console.log('攻击前 root.audit_gate:', JSON.stringify(gateBefore));

  // 攻击：worker 调 audit_gate verdict=pass 不传 audit_session_id（=null）
  const r1 = await call(['audit', 'gate', tid1, rootId1, '--verdict', 'pass',
    '--reason', 'worker attack via null audit_session_id'],
    UUID.worker); // caller=worker.session_id
  console.log(`worker 用 null 调 audit_gate: ${r1.ok ? '放行（**ATTACK SUCCEEDED**）' : `拒（${r1.error && r1.error.code}）`}`);
  if (r1.error) console.log(`  error.msg: ${(r1.error.msg || '').slice(0, 200)}`);

  const gateAfter = readLeaf(tid1, rootId1).audit_gate;
  console.log('攻击后 root.audit_gate:', JSON.stringify(gateAfter));
  const att1Pass = (gateAfter.auditor_session_id === UUID.root && gateAfter.auto_upgrade === true);
  console.log(`root.audit_gate.auditor_session_id 仍是 root.session_id（保持）：${att1Pass ? '是' : '否'}`);
  console.log(`攻击 1 结论：${r1.ok || !att1Pass ? '失守' : '已堵'}`);
  results.attacks.push({ name: 'attack-1', rejected: !r1.ok, gate_preserved: att1Pass });

  // ============================================================
  // 攻击 2: worker 给 root 写 done event 触发 auto_upgrade
  // ============================================================
  banner('ATTACK 2: worker 给 root 写 done event 触发 auto_upgrade');
  const tid2 = 'att2';
  await call(['init', tid2,
    '--root-brief', JSON.stringify({ parent_intent: 'attack 2 test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  const rootId2 = `${tid2}-root`;
  await call(['leaf', 'add', tid2, '--json', JSON.stringify({
    leaf_id: `${tid2}-C-commander`, session_id: UUID.comm, parent: rootId2,
    path: 'C', role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  await call(['leaf', 'add', tid2, '--json', JSON.stringify({
    leaf_id: `${tid2}-Cw-worker`, session_id: UUID.worker, parent: `${tid2}-C-commander`,
    path: 'Cw', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.comm, // worker.added_by=comm
  })]);

  // 此时 root 还没写 done event，audit_gate 应为 skip
  const before2 = readLeaf(tid2, rootId2);
  console.log('攻击前 root.audit_gate:', JSON.stringify(before2.audit_gate));
  console.log('攻击前 root.status:', before2.status);

  // 攻击：worker 给 root 写 done event
  const r2 = await call(['event', 'append', tid2, rootId2, '--type', 'done',
    '--json', JSON.stringify({ self_check: [{ item: 'worker attack', pass: true, evidence: 'e' }] })],
    UUID.worker);
  console.log(`worker 给 root 写 done event: ${r2.ok ? '放行（**ATTACK SUCCEEDED**）' : `拒（${r2.error && r2.error.code}）`}`);
  if (r2.error) console.log(`  error.msg: ${(r2.error.msg || '').slice(0, 200)}`);

  const after2 = readLeaf(tid2, rootId2);
  console.log('攻击后 root.audit_gate:', JSON.stringify(after2.audit_gate));
  console.log('攻击后 root.status:', after2.status);
  const att2Skip = (after2.audit_gate && after2.audit_gate.verdict === 'skip');
  const att2StatusActive = (after2.status !== 'done');
  console.log(`root.audit_gate.verdict 仍是 skip：${att2Skip ? '是' : '否（被升级 = 失守）'}`);
  console.log(`root.status 仍是 active（非 done）：${att2StatusActive ? '是' : '否（被改 = 失守）'}`);
  console.log(`攻击 2 结论：${r2.ok || !att2Skip ? '失守' : '已堵'}`);
  results.attacks.push({ name: 'attack-2', rejected: !r2.ok, gate_preserved_skip: att2Skip, status_preserved: att2StatusActive });

  // ============================================================
  // 攻击 3 (额外深度): worker 用 added_by 字段伪装尝试绕过 caller 校验
  //   C5 改动 2 校验：caller === leaf.session_id 或 leaf.added_by
  //   如果 worker 能控制 leaf.added_by 字段（例如 worker 给自己 added_by=root.session_id），
  //   然后用 root.session_id 作 caller 给 root 写 done event，能否绕过？
  //   实际上：caller 是 MCP wrapper 透传的（worker 无法伪造），且 leaf_add 时 added_by 由 caller 决定。
  //   这里测：worker 给自己 added_by=root.session_id 后，用 caller=worker.session_id 给 root 写 done。
  //   期望：仍拒绝（caller=worker != root.session_id 也 != root.added_by=null）
  // ============================================================
  banner('ATTACK 3 (深度): worker 用 added_by=root.session_id 伪装给 root 写 done');
  const tid3 = 'att3';
  await call(['init', tid3,
    '--root-brief', JSON.stringify({ parent_intent: 'attack 3 test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  const rootId3 = `${tid3}-root`;
  // worker leaf.added_by=root.session_id（直接子 worker,合法）
  await call(['leaf', 'add', tid3, '--json', JSON.stringify({
    leaf_id: `${tid3}-Cw-worker`, session_id: UUID.worker, parent: rootId3,
    path: 'Cw', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root, // worker.added_by=root.session_id（合法：root 直接子）
  })]);
  console.log('worker.added_by=root.session_id（伪装场景）,root.added_by=null（root 是 init 创建）');

  // 攻击：worker (caller=worker.session_id) 给 root 写 done event
  // 校验逻辑：caller(=worker) === root.session_id(=root)? 不等
  //           caller(=worker) === root.added_by(=null)? 不等
  // 期望：E_BORROWED_IDENTITY
  const r3 = await call(['event', 'append', tid3, rootId3, '--type', 'done',
    '--json', JSON.stringify({ self_check: [{ item: 'worker attack via added_by', pass: true, evidence: 'e' }] })],
    UUID.worker);
  console.log(`worker 给 root 写 done event: ${r3.ok ? '放行（**ATTACK SUCCEEDED**）' : `拒（${r3.error && r3.error.code}）`}`);
  if (r3.error) console.log(`  error.msg: ${(r3.error.msg || '').slice(0, 200)}`);

  const after3 = readLeaf(tid3, rootId3);
  console.log('攻击后 root.audit_gate:', JSON.stringify(after3.audit_gate));
  const att3Skip = (after3.audit_gate && after3.audit_gate.verdict === 'skip');
  console.log(`攻击 3 结论：${r3.ok || !att3Skip ? '失守' : '已堵（caller 校验正确,worker 无法绕过 added_by）'}`);
  results.attacks.push({ name: 'attack-3', rejected: !r3.ok, gate_preserved_skip: att3Skip });

  // ============================================================
  // 攻击 4 (深度边界): caller 不传（CLI 路径,无 callerSessionId）
  //   C5 注释说："CLI 调用（dbc-spec 等测试）不传 callerSessionId,跳过此校验（向后兼容）"
  //   这是设计决策：CLI 没有真实 caller 概念（用户在 bash 直接调）。
  //   验证：无 caller 调用 worker 写 done event 给 root,会触发 auto_upgrade 吗？
  //   分析：
  //     - caller 校验 `callerSessionId && ...` 因 !callerSessionId 短路跳过（放行 worker 写 done）
  //     - 但 auto_upgrade 触发条件加 callerIsRootSelf = `!callerSessionId || callerSessionId === leaf.session_id`
  //       无 caller 时 callerIsRootSelf=true,所以**会触发** auto_upgrade。
  //   这是 C5 注释承认的"向后兼容",但意味着 CLI 路径下任何角色都能给 root 写 done 触发 auto_upgrade。
  //   风险评估：CLI 是本地用户操作,不在 MCP 跨 leaf 调用范围内,MCP wrapper 会传 caller。
  //   但理论上：如果有恶意用户通过 CLI 操控（不通过 MCP wrapper）,可绕过。
  // ============================================================
  banner('ATTACK 4 (CLI 边界): 无 callerSessionId 给 root 写 done event');
  const tid4 = 'att4';
  await call(['init', tid4,
    '--root-brief', JSON.stringify({ parent_intent: 'attack 4 test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  const rootId4 = `${tid4}-root`;
  const before4 = readLeaf(tid4, rootId4);
  console.log('攻击前 root.audit_gate:', JSON.stringify(before4.audit_gate));

  // 攻击：无 caller 给 root 写 done event（模拟 CLI 路径）
  const r4 = await call(['event', 'append', tid4, rootId4, '--type', 'done',
    '--json', JSON.stringify({ self_check: [{ item: 'CLI attack', pass: true, evidence: 'e' }] })]);
  console.log(`CLI 无 caller 给 root 写 done: ${r4.ok ? '放行（C5 注释承认：CLI 向后兼容）' : `拒（${r4.error && r4.error.code}）`}`);

  const after4 = readLeaf(tid4, rootId4);
  console.log('攻击后 root.audit_gate:', JSON.stringify(after4.audit_gate));
  const att4AutoUp = (after4.audit_gate && after4.audit_gate.verdict === 'pass' && after4.audit_gate.auto_upgrade === true);
  console.log(`auto_upgrade 触发：${att4AutoUp ? '是' : '否'}`);
  console.log(`攻击 4 结论（C5 已承认 CLI 向后兼容）：${att4AutoUp ? '触发但属设计（CLI 路径）' : '未触发'}`);
  results.attacks.push({ name: 'attack-4-cli-edge', triggered: att4AutoUp, design_acknowledged: true });

  // ============================================================
  // 总结
  // ============================================================
  banner('A5 独立重放总结');
  console.log(JSON.stringify(results, null, 2));
  console.log('\n--- 关键判定 ---');
  const a1 = results.attacks.find(a => a.name === 'attack-1');
  const a2 = results.attacks.find(a => a.name === 'attack-2');
  console.log(`P0 攻击 1 (worker null 给 root audit_gate): ${a1 && a1.rejected && a1.gate_preserved ? '✓ 已堵' : '✗ 失守'}`);
  console.log(`P0 攻击 2 (worker 给 root 写 done 触发 auto_upgrade): ${a2 && a2.rejected && a2.gate_preserved_skip && a2.status_preserved ? '✓ 已堵' : '✗ 失守'}`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
