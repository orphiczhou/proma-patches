#!/usr/bin/env node
/**
 * v10-trust-anchor-test.cjs — C3 root-as-trust-anchor + C5 P0 修复验证测试
 *
 * 性质：V10 trust-anchor 子方案的端到端用例。覆盖：
 *   T1: tree_init 后 root.audit_gate.verdict='skip'（默认值）
 *   T2: root 写 done event 后 audit_gate 自动升级为 'pass'（auto_upgrade=true）
 *   T3: root 用自己 session_id 调 audit_gate verdict=pass（应放行）
 *   T4: root 引用其他 active leaf session_id（应拒绝，不是 trust anchor 来源）
 *   T5: worker 冒充 root session_id 调 audit_gate（应拒绝 E_BORROWED_IDENTITY）
 *   T6: commander 试图 leaf_add role='root'（应拒绝 E_SCHEMA_INVALID）
 *   T7: root audit_gate 升级后，下游 commander/worker 引用 root 信任链可工作
 *   T8 (C5/A3 P0 攻击 1): worker 用 audit_session_id=null 给 root 调 audit_gate pass（应拒绝）
 *   T9 (C5/A3 P0 攻击 2): worker 通过 event_append 给 root 写 done event 触发 auto_upgrade（应拒绝）
 *
 * 引擎：优先 patch-l/tree-engine.cjs（最新），fallback dist。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, 'core');

// ---- engine require ----
const _findEngine = () => {
  if (process.env.PROMA_TREE_ENGINE && fs.existsSync(process.env.PROMA_TREE_ENGINE)) return process.env.PROMA_TREE_ENGINE;
  const cands = [
    path.join(__dirname, '..', 'patch-l', 'tree-engine.cjs'),
    'D:\\Proma-dev\\resources\\app\\dist\\tree-engine.cjs',
    'D:\\Proma-release\\resources\\app\\dist\\tree-engine.cjs',
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  throw new Error('tree-engine.cjs not found. Set PROMA_TREE_ENGINE=<abs-path>.');
};
const engine = require(_findEngine());
engine.setTreesRoot(SANDBOX);

// ---- 固定测试 UUID（同 v10-cleanroom.cjs 占位符风格）----
const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',
  comm:    '00000000-0000-0000-0000-000000000002',
  worker:  '00000000-0000-0000-0000-000000000003',
  other:   '00000000-0000-0000-0000-000000000004',
};

async function run(cmdArgs, callerSessionId) {
  let out;
  if (callerSessionId) {
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1), null, callerSessionId);
  } else {
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  }
  return { ok: !!out.ok, error: out.error || null, result: out };
}

// ---- 统计 ----
const stats = { passed: 0, failed: 0 };
const failures = [];
function pass(name, info) {
  stats.passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`);
}
function fail(name, info) {
  stats.failed++;
  failures.push({ name, info });
  console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`);
}
async function expectOk(name, cmdArgs, callerSessionId) {
  const r = await run(cmdArgs, callerSessionId);
  if (r.ok) pass(name, 'ok');
  else fail(name, `期望成功，实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0,120)}`);
  return r;
}
async function expectFail(name, cmdArgs, expectedCodes, callerSessionId) {
  const r = await run(cmdArgs, callerSessionId);
  if (r.ok) { fail(name, `期望拒绝（codes: ${expectedCodes.join(',')}）但放行`); return r; }
  const got = r.error ? r.error.code : '?';
  const msg = (r.error && r.error.msg || '').slice(0, 120);
  if (expectedCodes.indexOf(got) >= 0) pass(name, got);
  else fail(name, `期望 ${expectedCodes.join(',')}，实际 ${got}: ${msg}`);
  return r;
}

// ---- helpers ----
let counter = 7000;
function freshTreeId(prefix) {
  counter++;
  const tid = `${prefix || 'ta'}${counter}`;
  const dir = path.join(SANDBOX, tid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return tid;
}
async function setupTree(budget, prefix) {
  const tid = freshTreeId(prefix);
  await run(['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'ta test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: (budget === undefined ? 10 : budget), max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  return { tid };
}
async function addLeaf(tid, pathSeg, role, sessionId, addedBy) {
  const lid = `${tid}-${pathSeg}-${role}`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: lid, session_id: sessionId, parent: `${tid}-root`,
    path: pathSeg, role: role,
    model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: addedBy || UUID.root,
  })]);
  return lid;
}
async function addDoneEvent(tid, lid, callerSessionId) {
  return await run(['event', 'append', tid, lid, '--type', 'done',
    '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    callerSessionId);
}
function readLeaf(tree_id, leaf_id) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  return state.leaves[leaf_id];
}

// ============================================================================
// T1: tree_init 后 root.audit_gate.verdict='skip'（默认值）
// ============================================================================
async function test_t1_default_skip() {
  console.log('\n[T1] tree_init 后 root.audit_gate.verdict=skip（默认值）');
  const { tid } = await setupTree(10, 't1');
  const rootId = `${tid}-root`;
  const leaf = readLeaf(tid, rootId);
  if (leaf && leaf.audit_gate && leaf.audit_gate.verdict === 'skip') {
    pass('T1 root.audit_gate.verdict=skip', `verdict=${leaf.audit_gate.verdict}`);
  } else {
    fail('T1 root.audit_gate.verdict=skip', `实际 verdict=${leaf && leaf.audit_gate && leaf.audit_gate.verdict}`);
  }
}

// ============================================================================
// T2: root 写 done event 后 audit_gate 自动升级为 'pass'（auto_upgrade=true）
// ============================================================================
async function test_t2_auto_upgrade_on_done() {
  console.log('\n[T2] root 写 done event → audit_gate 自动升级 pass + auto_upgrade=true');
  const { tid } = await setupTree(10, 't2');
  const rootId = `${tid}-root`;
  // root 写 done event（self_check 必填且至少 1 pass=true）
  await expectOk('T2 root 写 done event',
    ['event', 'append', tid, rootId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'root done', pass: true, evidence: 'root self-check evidence' }] })],
    UUID.root);
  const leaf = readLeaf(tid, rootId);
  if (leaf && leaf.audit_gate && leaf.audit_gate.verdict === 'pass') {
    if (leaf.audit_gate.auto_upgrade === true) {
      pass('T2 audit_gate.verdict=pass + auto_upgrade=true',
        `verdict=${leaf.audit_gate.verdict}, auditor=${leaf.audit_gate.auditor_session_id}, auto_upgrade=${leaf.audit_gate.auto_upgrade}`);
    } else {
      fail('T2 auto_upgrade 标记缺失', `verdict=${leaf.audit_gate.verdict}, auto_upgrade=${leaf.audit_gate.auto_upgrade}`);
    }
  } else {
    fail('T2 audit_gate 未升级', `verdict=${leaf && leaf.audit_gate && leaf.audit_gate.verdict}`);
  }
}

// ============================================================================
// T3: root 用自己 session_id 调 audit_gate verdict=pass（应放行）
// ============================================================================
async function test_t3_root_self_audit_gate() {
  console.log('\n[T3] root 用自己 session_id 调 audit_gate verdict=pass（应放行）');
  const { tid } = await setupTree(10, 't3');
  const rootId = `${tid}-root`;
  // 先写 done event（A7 要求 pass 前有 done event）
  await expectOk('T3a root 先写 done event',
    ['event', 'append', tid, rootId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    UUID.root);
  // root 用自己 session_id 调 audit_gate pass
  await expectOk('T3b root audit_gate verdict=pass（root 自审）',
    ['audit', 'gate', tid, rootId, '--verdict', 'pass',
     '--audit-session-id', UUID.root, '--reason', 'root self-audit'],
    UUID.root);
  const leaf = readLeaf(tid, rootId);
  if (leaf && leaf.audit_gate && leaf.audit_gate.verdict === 'pass'
      && leaf.audit_gate.auditor_session_id === UUID.root) {
    pass('T3c root audit_gate=pass auditor=root.session_id', `auditor=${leaf.audit_gate.auditor_session_id}`);
  } else {
    fail('T3c audit_gate 状态错', `verdict=${leaf && leaf.audit_gate && leaf.audit_gate.verdict}, auditor=${leaf && leaf.audit_gate && leaf.audit_gate.auditor_session_id}`);
  }
}

// ============================================================================
// T4: root 引用其他 active leaf session_id（应拒绝，不是 trust anchor 来源）
//     root 不能用其他 leaf 的 session_id 调 audit_gate（哪怕该 leaf 真实存在）
// ============================================================================
async function test_t4_root_cannot_use_other_leaf() {
  console.log('\n[T4] root 引用其他 active leaf session_id 调 audit_gate（应拒绝）');
  const { tid } = await setupTree(10, 't4');
  const rootId = `${tid}-root`;
  // 加一个 commander leaf
  const cId = await addLeaf(tid, 'C', 'commander', UUID.comm, UUID.root);
  // root 写 done event
  await expectOk('T4a root 写 done event',
    ['event', 'append', tid, rootId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    UUID.root);
  // root 试图用 commander.session_id 调 audit_gate（caller=root.session_id, audit_session_id=comm.session_id）
  // 期望：E_BORROWED_IDENTITY（caller != audit_session_id）或 E_AUDITOR_NOT_INDEPENDENT（auditor 不独立）
  await expectFail('T4b root 用 comm session_id 调 audit_gate（应拒绝）',
    ['audit', 'gate', tid, rootId, '--verdict', 'pass',
     '--audit-session-id', UUID.comm, '--reason', 'trying to borrow comm identity'],
    ['E_BORROWED_IDENTITY', 'E_AUDITOR_NOT_INDEPENDENT', 'E_AUDITOR_NOT_DONE', 'E_AUDITOR_NO_EVENTS', 'E_AUDITOR_NOT_VERIFIED'],
    UUID.root);
}

// ============================================================================
// T5: worker 冒充 root session_id 调 audit_gate（应拒绝 E_BORROWED_IDENTITY）
//     worker 试图借用 root 的 session_id 给自己 audit_gate pass
// ============================================================================
async function test_t5_worker_borrow_root_id() {
  console.log('\n[T5] worker 冒充 root session_id 调 audit_gate（应拒绝 E_BORROWED_IDENTITY）');
  const { tid } = await setupTree(10, 't5');
  const rootId = `${tid}-root`;
  // 加 commander（commander.added_by=root），再用 commander 加 worker（worker.added_by=commander）
  // 这样 root 才能给 worker 做 auditor（否则 worker.added_by=root 触发 auditor=added_by）
  const cId = await addLeaf(tid, 'C', 'commander', UUID.comm, UUID.root);
  const wId = await addLeaf(tid, 'Cw', 'worker', UUID.worker, UUID.comm);
  // 顺序：root 先建立信任锚（写 done → 自动 pass），worker 才能 brief_echo 引用 root 作 auditor
  await expectOk('T5a root 写 done event（建立信任锚）',
    ['event', 'append', tid, rootId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    UUID.root);
  // worker 写 brief_echo（带 alignment，auditor=root 已是 pass 信任锚）
  await expectOk('T5b worker 写 brief_echo（root 作 auditor 信任锚）',
    ['event', 'append', tid, wId, '--type', 'brief_echo',
     '--json', JSON.stringify({
       my_understanding: 'do task',
       milestones_preview: [],
       alignment: { score: 0.9, notes: 'aligned' },
       auditor_session_id: UUID.root
     })], UUID.worker);
  // worker 写 done
  await expectOk('T5c worker 写 done event',
    ['event', 'append', tid, wId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    UUID.worker);
  // worker 试图用 root.session_id 调 audit_gate pass（caller=worker.session_id, audit=root.session_id）
  // 期望：E_BORROWED_IDENTITY（caller != audit_session_id）
  await expectFail('T5d worker 借 root session_id 调 audit_gate（应 E_BORROWED_IDENTITY）',
    ['audit', 'gate', tid, wId, '--verdict', 'pass',
     '--audit-session-id', UUID.root, '--reason', 'worker trying to borrow root'],
    ['E_BORROWED_IDENTITY'],
    UUID.worker);
}

// ============================================================================
// T6: commander 试图 leaf_add role='root'（应拒绝 E_SCHEMA_INVALID）
// ============================================================================
async function test_t6_leaf_add_rejects_root() {
  console.log('\n[T6] leaf_add role=root 应拒绝（E_SCHEMA_INVALID）');
  const { tid } = await setupTree(10, 't6');
  // 试图通过 leaf_add 加第二个 root
  await expectFail('T6 leaf_add role=root 拒绝',
    ['leaf', 'add', tid, '--json', JSON.stringify({
      leaf_id: `${tid}-X-root`,  // 命名看起来像 root
      session_id: UUID.other,
      parent: null,
      path: '',
      role: 'root',
      model: 'claude-sonnet-4-6', channel: 'anthropic',
      // added_by 留空（role=root 的旧逻辑允许）
    })],
    ['E_SCHEMA_INVALID']);
}

// ============================================================================
// T7: root audit_gate 升级后，root 可作为 worker（非直接子）的 auditor
//     场景：root 写 done → 自动 pass；commander 加 worker；worker 引用 root 作 auditor
//     注：直接子（commander.added_by=root）会被 V2 的 'auditor=added_by' 拦截，
//         所以 worker 必须由 commander 添加（added_by=commander），root 才能作 auditor。
// ============================================================================
async function test_t7_trust_chain_propagates() {
  console.log('\n[T7] root 升级后，root 给非直接子 worker audit_gate pass（信任链下游）');
  const { tid } = await setupTree(10, 't7');
  const rootId = `${tid}-root`;
  const cId = await addLeaf(tid, 'C', 'commander', UUID.comm, UUID.root);
  // root 写 done event，自动升级 audit_gate=pass
  await expectOk('T7a root 写 done event → 自动 pass',
    ['event', 'append', tid, rootId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    UUID.root);
  const rootLeaf = readLeaf(tid, rootId);
  if (!rootLeaf || !rootLeaf.audit_gate || rootLeaf.audit_gate.verdict !== 'pass') {
    fail('T7 前置失败：root audit_gate 未升级', `verdict=${rootLeaf && rootLeaf.audit_gate && rootLeaf.audit_gate.verdict}`);
    return;
  }
  // commander 加 worker（worker.added_by=commander，root 不是其直接父）
  const wId = await addLeaf(tid, 'Cw', 'worker', UUID.worker, UUID.comm);
  // worker 写 brief_echo（auditor=root，root 已 pass）
  await expectOk('T7b worker 写 brief_echo（root 作 auditor 信任锚）',
    ['event', 'append', tid, wId, '--type', 'brief_echo',
     '--json', JSON.stringify({
       my_understanding: 'do task',
       milestones_preview: [],
       alignment: { score: 0.9, notes: 'aligned' },
       auditor_session_id: UUID.root
     })], UUID.worker);
  // worker 写 done
  await expectOk('T7c worker 写 done event',
    ['event', 'append', tid, wId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    UUID.worker);
  // root 作为 auditor 给 worker audit_gate pass（caller=root, audit=root）
  await expectOk('T7d root 给 worker audit_gate pass（信任链下游放行）',
    ['audit', 'gate', tid, wId, '--verdict', 'pass',
     '--audit-session-id', UUID.root, '--reason', 'root audits worker'],
    UUID.root);
  const wLeaf = readLeaf(tid, wId);
  if (wLeaf && wLeaf.audit_gate && wLeaf.audit_gate.verdict === 'pass'
      && wLeaf.audit_gate.auditor_session_id === UUID.root) {
    pass('T7e worker audit_gate=pass by root（信任链下游通）', `auditor=${wLeaf.audit_gate.auditor_session_id}`);
  } else {
    fail('T7e worker audit_gate 状态错', `verdict=${wLeaf && wLeaf.audit_gate && wLeaf.audit_gate.verdict}`);
  }
}

// ============================================================================
// T8 (C5/A3 P0 攻击 1): worker 用 audit_session_id=null 给 root 调 audit_gate pass（应拒绝）
//   攻击向量：worker 调 mcp__tree__tree_audit_gate(leaf_id=<root>, verdict=pass) 不传 audit_session_id
//   原失守：cmdAuditGate caller 校验因 audit_session_id=null 短路,resolveAuditorIndep 又因 null 放行
//   修复后：resolveAuditorIndep root 信任锚分支只允许 === leaf.session_id,worker 用 null 命中
//          'auditor_session_id is null' 失败 → E_AUDITOR_NOT_INDEPENDENT
// ============================================================================
async function test_t8_worker_null_audit_session_id_attack() {
  console.log('\n[T8] (C5/A3 P0 攻击 1) worker 用 audit_session_id=null 给 root 调 audit_gate（应拒绝）');
  const { tid } = await setupTree(10, 't8');
  const rootId = `${tid}-root`;
  // 加 commander + worker（worker.added_by=commander,root 可作 auditor）
  const cId = await addLeaf(tid, 'C', 'commander', UUID.comm, UUID.root);
  // root 先写 done event（建立信任锚）—— root 自己写,caller=root.session_id
  await expectOk('T8a root 写 done event（建立信任锚）',
    ['event', 'append', tid, rootId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    UUID.root);
  // 攻击：worker 给 root 调 audit_gate verdict=pass 不传 audit_session_id（=null）
  // callerSessionId=UUID.worker（模拟 MCP wrapper 透传 worker.session_id）
  // 期望：拒绝（resolveAuditorIndep 因 null 返回 'auditor_session_id is null' → E_AUDITOR_NOT_INDEPENDENT）
  //       或：caller 校验通过的边界情况兜底（理论上 caller 校验因 audit_session_id=null 短路跳过,主要靠 resolveAuditorIndep 拒）
  await expectFail('T8b worker 用 null 给 root 调 audit_gate pass（应拒）',
    ['audit', 'gate', tid, rootId, '--verdict', 'pass',
     '--reason', 'worker attack via null audit_session_id'],
    ['E_AUDITOR_NOT_INDEPENDENT', 'E_BORROWED_IDENTITY', 'E_INVALID_UUID_STRICT'],
    UUID.worker);
  // 双重确认：root.audit_gate 必须保持 auto_upgrade=true（worker 攻击未改写）
  const leaf = readLeaf(tid, rootId);
  if (leaf && leaf.audit_gate
      && leaf.audit_gate.verdict === 'pass'
      && leaf.audit_gate.auto_upgrade === true
      && leaf.audit_gate.auditor_session_id === UUID.root) {
    pass('T8c root.audit_gate 未被 worker 改写', `verdict=${leaf.audit_gate.verdict}, auditor=${leaf.audit_gate.auditor_session_id}, auto_upgrade=${leaf.audit_gate.auto_upgrade}`);
  } else {
    fail('T8c root.audit_gate 被 worker 改写或状态错', JSON.stringify(leaf && leaf.audit_gate));
  }
}

// ============================================================================
// T9 (C5/A3 P0 攻击 2): worker 通过 event_append 给 root 写 done event 触发 auto_upgrade（应拒绝）
//   攻击向量：worker 调 mcp__tree__tree_event_append(leaf_id=<root>, type=done, ...) 给 root 写 done
//   原失守：cmdEventAppend 无 callerSessionId 形参,任何角色都能给 root 写 done → 触发 auto_upgrade
//   修复后：cmdEventAppend 加 callerSessionId,done event 要求 caller===leaf.session_id 或 added_by
//          worker 给 root 写 done → caller=worker.session_id != root.session_id 且 != root.added_by(=null)
//          → E_BORROWED_IDENTITY
// ============================================================================
async function test_t9_worker_event_append_done_to_root_attack() {
  console.log('\n[T9] (C5/A3 P0 攻击 2) worker 给 root 写 done event 触发 auto_upgrade（应拒绝）');
  const { tid } = await setupTree(10, 't9');
  const rootId = `${tid}-root`;
  // 加 commander + worker（worker.added_by=commander）
  const cId = await addLeaf(tid, 'C', 'commander', UUID.comm, UUID.root);
  const wId = await addLeaf(tid, 'Cw', 'worker', UUID.worker, UUID.comm);
  // 此时 root.audit_gate.verdict 应该还是 'skip'（root 还没写 done event）
  const leafBefore = readLeaf(tid, rootId);
  if (!leafBefore || !leafBefore.audit_gate || leafBefore.audit_gate.verdict !== 'skip') {
    fail('T9 前置失败：root.audit_gate 未初始化为 skip', JSON.stringify(leafBefore && leafBefore.audit_gate));
    return;
  }
  // 攻击：worker 给 root 写 done event（caller=worker.session_id）
  // 期望：E_BORROWED_IDENTITY（caller != leaf.session_id 也 != leaf.added_by(null)）
  await expectFail('T9a worker 给 root 写 done event（应 E_BORROWED_IDENTITY）',
    ['event', 'append', tid, rootId, '--type', 'done',
     '--json', JSON.stringify({ self_check: [{ item: 'worker attack', pass: true, evidence: 'e' }] })],
    ['E_BORROWED_IDENTITY'],
    UUID.worker);
  // 双重确认：root.audit_gate 必须保持 'skip'（worker 攻击未触发 auto_upgrade）
  const leafAfter = readLeaf(tid, rootId);
  if (leafAfter && leafAfter.audit_gate
      && leafAfter.audit_gate.verdict === 'skip') {
    pass('T9b root.audit_gate 未被 worker 升级（仍 skip）', `verdict=${leafAfter.audit_gate.verdict}`);
  } else {
    fail('T9b root.audit_gate 被 worker 触发 auto_upgrade', JSON.stringify(leafAfter && leafAfter.audit_gate));
  }
  // 双重确认：root.status 也不能被 worker 改为 done（done event 被拒,status 保持 active）
  if (leafAfter && leafAfter.status !== 'done') {
    pass('T9c root.status 未被 worker 改 done', `status=${leafAfter.status}`);
  } else {
    fail('T9c root.status 被 worker 改为 done', JSON.stringify(leafAfter && leafAfter.status));
  }
}

// ============================================================================
// 主入口
// ============================================================================
(async () => {
  console.log('=== V10 Trust Anchor 加固测试（C3 实施 + C5 P0 修复验证）===');
  console.log(`engine: ${_findEngine()}`);
  console.log(`sandbox: ${SANDBOX}`);
  try {
    await test_t1_default_skip();
    await test_t2_auto_upgrade_on_done();
    await test_t3_root_self_audit_gate();
    await test_t4_root_cannot_use_other_leaf();
    await test_t5_worker_borrow_root_id();
    await test_t6_leaf_add_rejects_root();
    await test_t7_trust_chain_propagates();
    await test_t8_worker_null_audit_session_id_attack();
    await test_t9_worker_event_append_done_to_root_attack();
  } catch (e) {
    console.error('\n[FATAL] 测试执行抛错:', e && e.stack ? e.stack : e);
    stats.failed++;
  }
  console.log('\n=== 统计 ===');
  console.log(`通过: ${stats.passed}`);
  console.log(`失败: ${stats.failed}`);
  if (failures.length > 0) {
    console.log('\n--- 失败详情 ---');
    for (const f of failures) console.log(`  ${f.name}: ${f.info}`);
  }
  process.exit(stats.failed === 0 ? 0 : 1);
})();
