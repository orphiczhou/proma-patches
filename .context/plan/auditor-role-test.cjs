#!/usr/bin/env node
/**
 * auditor-role-test.cjs — Tree Harness P0a auditor role 新机制交叉验证 (2026-07-08)
 *
 * 被测改动 (tree-engine.cjs, P0a):
 *   - ROLE_ENUM 增 'auditor' (L88)
 *   - cmdLeafAdd audit_gate 初始 verdict: (role==='worker'||role==='auditor') ? 'required' : 'skip' (L1046)
 *   - cmdLeafSetStatus done 门禁 auditor 简化协议: 跳过 milestone/expect_outputs/deliverables (L1424-1506);
 *     保留 brief_echo+done 双事件 (L1510) + audit_gate pass (L1564) + done event 存在 (L1579)
 *   - collectValidateIssues HARDEN6: auditor 也走 context overflow 检查 (L2725)
 *   - cmdInit state.version='1.1' (L732); cmdMigrate 规则12 version 1.0→1.1 (L3561)
 *   - resolveAuditorIndep 不改: root 信任锚 (L2444-2458) + 上级 auditor 已 done+pass (L2491-2502) + 自审拒 (L2490)
 *
 * 测试方法: 独立沙箱, 每个场景独立小树互不污染. 落真实非空文件 (fs.writeFileSync), 不 mock.
 *   按 spec 写期望, 跑实际引擎, 诚实报 pass/fail. 失败不迁就引擎, 报上来让主会话判断.
 *
 * Harness 模式复用自 subagent-lifecycle-test.cjs:
 *   - require(ENGINE_PATH); engine.setTreesRoot(SANDBOX); engine.setSessionVerifier(mock)
 *   - engine.run(cmd, args, treesRoot?, callerSessionId?) 永不 throw, 返回 {ok:true}|{ok:false,error:{code,msg}}
 *   - expectOk / expectFail 断言 + pass/fail 计数 + 末尾总结
 *   - run(cmdArgs) 默认不传 callerSessionId (CLI 模式, caller 校验跳过)
 *   - runWithCaller(cmdArgs, callerSid) 传第 4 参 callerSessionId (测 caller===audit_session_id 用例)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 引擎 setup
// ============================================================
const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

// 临时沙箱 (独立目录, 结束清理)
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'audt-role-'));
engine.setTreesRoot(SANDBOX);

// mock session verifier (沿用占位 UUID 放行策略, 与 subagent-lifecycle-test 一致)
engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

// 固定测试 UUID (每棵 tree 内 session_id 唯一)
const UUID = {
  root:     '00000000-0000-0000-0000-000000000001',  // tree init root + added_by + root 信任锚
  worker:   '00000000-0000-0000-0000-000000000002',  // worker leaf session
  auditor:  '00000000-0000-0000-0000-000000000003',  // auditor1 leaf session
  other:    '00000000-0000-0000-0000-000000000004',  // 备用
  auditor2: '00000000-0000-0000-0000-000000000005',  // auditor2 leaf session
};

// ============================================================
// run helpers
// ============================================================
// run: 默认不传 callerSessionId (CLI 模式, caller 校验跳过)
async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX);
  return { ok: !!out.ok, error: out.error || null, result: out };
}

// runWithCaller: 传第 4 参 callerSessionId (测 caller===audit_session_id 用例)
async function runWithCaller(cmdArgs, callerSid) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX, callerSid);
  return { ok: !!out.ok, error: out.error || null, result: out };
}

// ============================================================
// 断言
// ============================================================
const stats = { passed: 0, failed: 0 };
const results = [];
function pass(name, info) { stats.passed++; results.push({ name, status: 'PASS' }); console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; results.push({ name, status: 'FAIL', info }); console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

async function expectOk(name, cmdArgs) {
  const r = await run(cmdArgs);
  if (r.ok) { pass(name, 'ok'); return r; }
  fail(name, `期望成功, 实际失败 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 200)}`);
  return r;
}
async function expectFail(name, cmdArgs, expectedCode) {
  const r = await run(cmdArgs);
  if (r.ok) { fail(name, `期望失败 ${expectedCode}, 但命令成功了`); return r; }
  if (r.error && r.error.code === expectedCode) { pass(name, expectedCode); return r; }
  fail(name, `期望 ${expectedCode}, 实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 200)}`);
  return r;
}
// expectOkCaller / expectFailCaller: 带 callerSessionId 的变体
async function expectOkCaller(name, cmdArgs, callerSid) {
  const r = await runWithCaller(cmdArgs, callerSid);
  if (r.ok) { pass(name, 'ok'); return r; }
  fail(name, `期望成功, 实际失败 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 200)}`);
  return r;
}
async function expectFailCaller(name, cmdArgs, callerSid, expectedCode) {
  const r = await runWithCaller(cmdArgs, callerSid);
  if (r.ok) { fail(name, `期望失败 ${expectedCode}, 但命令成功了`); return r; }
  if (r.error && r.error.code === expectedCode) { pass(name, expectedCode); return r; }
  fail(name, `期望 ${expectedCode}, 实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 200)}`);
  return r;
}

// ============================================================
// 通用 setup helpers
// ============================================================
let counter = 0;
function freshTreeId() {
  counter++;
  return `audt${counter}`;  // leaf_id prefix 正则 [a-z][a-z0-9_]{3,7} ('audt' + 数字, 注意别超长)
}

async function initTree(tid) {
  return run(['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'auditor role test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic',
  ]);
}

// addAuditor: 创建 auditor leaf, parent=root, added_by=root
async function addAuditor(tid, leafPath, auditorSession) {
  const leafId = `${tid}-${leafPath}-auditor`;
  const r = await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: auditorSession || UUID.auditor, parent: `${tid}-root`,
    path: leafPath, role: 'auditor', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  if (!r.ok) {
    throw new Error(`addAuditor(${leafId}) failed: ${r.error && r.error.code}: ${r.error && r.error.msg}`);
  }
  return leafId;
}

// addWorker: 创建 worker leaf
async function addWorker(tid, leafPath, workerSession) {
  const leafId = `${tid}-${leafPath}-worker`;
  const r = await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: workerSession || UUID.worker, parent: `${tid}-root`,
    path: leafPath, role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  if (!r.ok) {
    throw new Error(`addWorker(${leafId}) failed: ${r.error && r.error.code}: ${r.error && r.error.msg}`);
  }
  return leafId;
}

// appendBriefEcho: auditor/worker 写 brief_echo event (my_understanding + milestones_preview)
async function appendBriefEcho(tid, leafId, understanding, milestonesPreview) {
  return run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({
    my_understanding: understanding || 'auditor understands the brief',
    milestones_preview: milestonesPreview || [],
  })]);
}

// appendDoneEvent: 写 done event (self_check)
async function appendDoneEvent(tid, leafId, evidence) {
  return run(['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({
    self_check: [{ item: 'work_done', pass: true, evidence: evidence || 'auditor completed audit work thoroughly' }],
  })]);
}

// auditGatePass: root 给 leaf 背书 audit_gate=pass (audit_session_id=root)
async function auditGatePass(tid, leafId, auditorSid) {
  return run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', auditorSid || UUID.root]);
}

// setStatus: set-status
async function setStatus(tid, leafId, status) {
  return run(['leaf', 'set-status', tid, leafId, status]);
}

// 直接读改 tree-state.json (绕过 API 注入/篡改 leaf 状态)
function tamperLeaf(tree_id, leaf_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (state.leaves[leaf_id]) mutateFn(state.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

// 直接读改 state (顶层字段, 如 version)
function tamperState(tree_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  mutateFn(state);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

// 读取整个 state
function readState(tree_id) {
  return JSON.parse(fs.readFileSync(path.join(SANDBOX, tree_id, 'tree-state.json'), 'utf8'));
}

// 落非空产物到 deliverables/<rel>
function createDeliverable(tree_id, rel, content) {
  const fp = path.join(SANDBOX, tree_id, 'deliverables', rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content || 'non-empty auditor test deliverable\n');
  return fp;
}

// ============================================================
// 测试场景
// ============================================================

// Case 1: auditor leaf 创建
//   initTree → leaf_add role='auditor' → 期望 ok; 断言 audit_gate.verdict==='required', status==='active'
async function case1_auditor_create() {
  console.log('\n[1] auditor leaf 创建 → audit_gate.verdict=required, status=active');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addAuditor(tid, 'A1', UUID.auditor);
  // 断言返回 result 里 leaf.audit_gate.verdict === 'required', status === 'active'
  //   addAuditor 内部已 expectOk (throw on fail); 这里读 state 验证字段
  const state = readState(tid);
  const leaf = state.leaves[leafId];
  if (!leaf) { fail('1 auditor leaf 存在于 state', `leaf ${leafId} not found`); return; }
  if (leaf.role !== 'auditor') { fail('1 leaf.role === auditor', `实际 ${leaf.role}`); return; }
  if (leaf.status !== 'active') { fail('1 leaf.status === active', `实际 ${leaf.status}`); return; }
  const verdict = leaf.audit_gate && leaf.audit_gate.verdict;
  if (verdict !== 'required') { fail('1 audit_gate.verdict === required', `实际 ${verdict}`); return; }
  pass('1 auditor leaf 创建: role=auditor, status=active, audit_gate.verdict=required', 'ok');
}

// Case 2: auditor done 简化协议 (无 milestone 也能 done)
//   Case1 基础上: brief_echo + done event + root audit_gate pass + set-status done → ok
async function case2_auditor_done_simplified() {
  console.log('\n[2] auditor done 简化协议 (无 milestone 也能 done)');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addAuditor(tid, 'A1', UUID.auditor);
  // root 需有 events (resolveAuditorIndep root 信任锚要求 root.events 非空)
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-08T00:00:00Z', meta: { summary: 'root bootstrap auditor' } }];
  });
  await appendBriefEcho(tid, leafId, 'auditor will audit worker deliverables');
  await appendDoneEvent(tid, leafId, 'auditor completed review of all worker outputs');
  await auditGatePass(tid, leafId, UUID.root);
  await expectOk('2 auditor done 简化协议 (无 milestone) → ok',
    ['leaf', 'set-status', tid, leafId, 'done']);
}

// Case 3: auditor done 仍需 brief_echo+done 双事件 (缺 done event → 拒)
//   只 append brief_echo (不 append done event) + root pass + set-status done → 期望失败
async function case3_auditor_missing_done_event() {
  console.log('\n[3] auditor done 仍需 brief_echo+done 双事件 (缺 done event → 拒)');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addAuditor(tid, 'A1', UUID.auditor);
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-08T00:00:00Z', meta: { summary: 'root bootstrap' } }];
  });
  // 只 append brief_echo (不 append done event)
  await appendBriefEcho(tid, leafId, 'auditor brief echo without done event');
  // 注: 缺 done event 时 audit_gate pass 会被 E_AUDIT_PREMATURE 拦 (cmdAuditGate L2973 要求先有 done event)
  //   但这里测的是 set-status done 门禁, 不是 audit_gate. 先尝试 pass (若被拦, 则 status 仍是 required,
  //   set-status done 会被 audit_gate 检查 L1564 拦 E_GATEKEEPER_REQUIRED).
  //   两种情况都说明 "缺 done event 不能 done", 但错误码不同. 任务期望 E_STATUS_EVENT_MISMATCH.
  //   诚实测试: 先尝试 audit_gate pass, 若失败则跳过 pass 直接 set-status (audit_gate.verdict=required → E_GATEKEEPER_REQUIRED).
  //   为测到 E_STATUS_EVENT_MISMATCH, 需让 audit_gate.verdict=pass (绕过 L1564), 这样才走到 L1579 done event 检查.
  //   但 audit_gate pass 需先有 done event (L2973) → 矛盾.
  //   解法: 用 tamperLeaf 直接把 audit_gate.verdict 改成 pass (绕过 cmdAuditGate 的时序校验), 再 set-status done.
  tamperLeaf(tid, leafId, (l) => {
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.root, ts: '2026-07-08T00:00:00Z' };
  });
  // 现在 events=[brief_echo] (length=1), audit_gate.verdict=pass
  //   auditor/worker 走双事件检查 (cmdLeafSetStatus L1510, 要求 brief_echo+done ≥2 events),
  //   比行 1579 V10-status-event-sync (E_STATUS_EVENT_MISMATCH) 更严格、先拦.
  //   故 auditor 缺 done event → L1512 evs.length<2 → E_SCHEMA_INVALID.
  //   E_STATUS_EVENT_MISMATCH 只对 commander/root 生效 (它们不走 L1510 双事件检查).
  await expectFail('3 auditor 缺 done event → 拒 (E_SCHEMA_INVALID, 双事件检查先于 done event 检查)',
    ['leaf', 'set-status', tid, leafId, 'done'], 'E_SCHEMA_INVALID');
}

// Case 4: auditor audit_gate=pass 由 root 背书
//   Case1 基础上: brief_echo + done + audit-gate(verdict=pass, audit-session-id=root) → ok
async function case4_root_endorses_auditor() {
  console.log('\n[4] auditor audit_gate=pass 由 root 背书 (root 信任锚)');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addAuditor(tid, 'A1', UUID.auditor);
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-08T00:00:00Z', meta: { summary: 'root bootstrap' } }];
  });
  await appendBriefEcho(tid, leafId, 'auditor will perform independent audit');
  await appendDoneEvent(tid, leafId, 'auditor finished audit work with full coverage');
  await expectOk('4 audit-gate(auditor, pass, audit-session-id=root) → ok (root 信任锚放行)',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.root]);
}

// Case 5: auditor 自审被拒 (audit_session_id=auditor 自己 session → E_AUDITOR_NOT_INDEPENDENT)
async function case5_auditor_self_audit_rejected() {
  console.log('\n[5] auditor 自审被拒 (audit_session_id=auditor 自己 session)');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addAuditor(tid, 'A1', UUID.auditor);
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-08T00:00:00Z', meta: { summary: 'root bootstrap' } }];
  });
  await appendBriefEcho(tid, leafId, 'auditor brief echo for self-audit test');
  await appendDoneEvent(tid, leafId, 'auditor done event before self-audit attempt');
  // audit-gate(auditor, pass, audit-session-id=auditor)  # auditor 审自己
  //   resolveAuditorIndep: leaf.role=auditor≠root, auditorSessionId=UUID.auditor
  //   L2444 找 rootLeaf: parent===null && role==='root' && session_id===UUID.auditor → 找不到 (root.sid=UUID.root)
  //   L2460 !auditorSessionId → false
  //   L2474 added_by === auditorSessionId? added_by=UUID.root, auditorSessionId=UUID.auditor → false
  //   L2479 filter session_id===UUID.auditor → 找到 auditor leaf 自己
  //   L2484 activeCandidates (非 archived/pruned) → [auditor leaf]
  //   L2489 auditorLeaf = auditor leaf 自己
  //   L2490 auditorLeaf.leaf_id === leaf.leaf_id → return 'auditor is the leaf itself'
  await expectFail('5 auditor 自审 (audit_session_id=auditor 自己) → E_AUDITOR_NOT_INDEPENDENT',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.auditor],
    'E_AUDITOR_NOT_INDEPENDENT');
}

// Case 6: auditor→auditor 背书 (上级 auditor done+pass → 下级 auditor pass 放行)
async function case6_auditor_endorses_auditor() {
  console.log('\n[6] auditor→auditor 背书 (上级 auditor done+pass 背书下级)');
  const tid = freshTreeId();
  await initTree(tid);
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-08T00:00:00Z', meta: { summary: 'root bootstrap' } }];
  });

  // 创建 auditor1 (session=auditor, path='A1')
  const aud1Id = await addAuditor(tid, 'A1', UUID.auditor);
  await appendBriefEcho(tid, aud1Id, 'auditor1 understands audit scope');
  await appendDoneEvent(tid, aud1Id, 'auditor1 completed primary audit');
  await auditGatePass(tid, aud1Id, UUID.root);  // root 背书 auditor1
  await expectOk('6a auditor1 set-status done',
    ['leaf', 'set-status', tid, aud1Id, 'done']);

  // 创建 auditor2 (session=auditor2, path='A2', added_by=root)
  const aud2Id = `${tid}-A2-auditor`;
  await expectOk('6b 创建 auditor2 leaf',
    ['leaf', 'add', tid, '--json', JSON.stringify({
      leaf_id: aud2Id, session_id: UUID.auditor2, parent: `${tid}-root`,
      path: 'A2', role: 'auditor', model: 'claude-sonnet-4-6', channel: 'anthropic',
      added_by: UUID.root,
    })]);
  await appendBriefEcho(tid, aud2Id, 'auditor2 understands secondary audit scope');
  await appendDoneEvent(tid, aud2Id, 'auditor2 completed secondary audit work');

  // audit-gate(auditor2, pass, audit-session-id=auditor)  # auditor1 背书 auditor2
  //   resolveAuditorIndep: leaf=aud2, auditorSessionId=UUID.auditor
  //   L2444 找 rootLeaf: role==='root' && session_id===UUID.auditor → 找不到 (root.sid=UUID.root)
  //   L2479 filter session_id===UUID.auditor → [aud1Id] (auditor1, status=done)
  //   L2484 activeCandidates → [aud1Id]
  //   L2489 auditorLeaf = aud1Id
  //   L2490 aud1Id.leaf_id === aud2.leaf_id → false
  //   L2493 auditorLeaf.status==='done' → true (auditor1 done)
  //   L2496 events 非空 → true
  //   L2499 ag.verdict==='pass' → true
  //   L2503 return null → 放行
  await expectOk('6c auditor1 背书 auditor2 audit_gate=pass → ok (上级 auditor 背书下级)',
    ['audit', 'gate', tid, aud2Id, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);

  // auditor2 set-status done → ok
  await expectOk('6d auditor2 set-status done → ok',
    ['leaf', 'set-status', tid, aud2Id, 'done']);
}

// Case 7: auditor 当 worker 的 auditor (auditor done+pass → worker audit_gate pass 放行)
//   worker 仍走完整门禁 (milestone + expect_outputs + brief_echo + done event + audit_gate pass)
async function case7_auditor_endorses_worker() {
  console.log('\n[7] auditor 当 worker 的 auditor (auditor done+pass 背书 worker)');
  const tid = freshTreeId();
  await initTree(tid);
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-08T00:00:00Z', meta: { summary: 'root bootstrap' } }];
  });

  // 创建 auditor (session=auditor, path='A1') → done
  const audId = await addAuditor(tid, 'A1', UUID.auditor);
  await appendBriefEcho(tid, audId, 'auditor will audit worker deliverable');
  await appendDoneEvent(tid, audId, 'auditor completed audit plan and scope');
  await auditGatePass(tid, audId, UUID.root);  // root 背书 auditor
  await expectOk('7a auditor set-status done',
    ['leaf', 'set-status', tid, audId, 'done']);

  // 创建 worker (session=worker, path='W1')
  const wId = await addWorker(tid, 'W1', UUID.worker);

  // worker done 前置: milestone (含 expect_outputs, 落真实非空文件)
  createDeliverable(tid, 'w1-out.md', 'worker deliverable content for audit\n');
  await expectOk('7b milestone_add (含 expect_outputs)',
    ['milestone', 'add', tid, wId, '--json', JSON.stringify({ id: 'M1', desc: 'w1 deliverable', expect_outputs: ['w1-out.md'] })]);
  // milestone_set_result (audit_pass=true, audit_session_id=root) — 冷启动 root 背书 milestone
  await expectOk('7c milestone_set_result (root 背书 milestone)',
    ['milestone', 'set-result', tid, wId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.root]);

  // worker brief_echo #1 (my_understanding)
  await expectOk('7d worker brief_echo #1 (my_understanding)',
    ['event', 'append', tid, wId, '--type', 'brief_echo', '--json', JSON.stringify({
      my_understanding: 'worker understands the task scope and deliverables',
      milestones_preview: [{ id: 'M1', desc: 'w1 deliverable' }],
    })]);

  // worker brief_echo #2 (alignment, auditor_session_id=root) — V5b 前置
  //   注: 用 root 作 alignment auditor_session_id (冷启动 root 信任锚), 而非 auditor
  //   因为 alignment 回填的 auditor 需独立于 worker; root 独立, auditor 也独立, 但
  //   下游 audit_gate(auditor) 会校验 alignment 的 auditor_session_id 是否独立 (L3003).
  //   为避免 alignment auditor 与 audit_gate auditor 混淆, 这里 alignment 用 root.
  await expectOk('7e worker brief_echo #2 (alignment, auditor_session_id=root)',
    ['event', 'append', tid, wId, '--type', 'brief_echo', '--json', JSON.stringify({
      ack: 'ok', alignment: '95%', auditor_session_id: UUID.root,
    })]);

  // worker done event (self_check)
  await expectOk('7f worker done event (self_check)',
    ['event', 'append', tid, wId, '--type', 'done', '--json', JSON.stringify({
      self_check: [{ item: 'work_done', pass: true, evidence: 'worker completed w1 deliverable thoroughly' }],
    })]);

  // audit-gate(worker, pass, audit_session_id=auditor) — auditor 背书 worker (不是 root)
  //   resolveAuditorIndep: leaf=worker, auditorSessionId=UUID.auditor
  //   L2444 找 rootLeaf: role==='root' && session_id===UUID.auditor → 找不到
  //   L2479 filter session_id===UUID.auditor → [audId] (auditor, status=done, audit_gate=pass)
  //   L2490 audId.leaf_id === worker.leaf_id → false
  //   L2493 status==='done' → true; L2496 events 非空 → true; L2499 ag.verdict==='pass' → true
  //   L2503 return null → 放行
  await expectOk('7g audit-gate(worker, pass, audit_session_id=auditor) → ok (auditor 背书 worker)',
    ['audit', 'gate', tid, wId, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);

  // worker set-status done → ok
  await expectOk('7h worker set-status done → ok (auditor 已背书)',
    ['leaf', 'set-status', tid, wId, 'done']);
}

// Case 8: migrate version 1.0→1.1
//   initTree (新树 version=1.1). 用 tamperState 把 version 改回 '1.0'.
//   跑 migrate (dry-run=false). 断言 changes 含 {field:'version', from:'1.0', to:'1.1'}, 且重读 state.version==='1.1'.
async function case8_migrate_version() {
  console.log('\n[8] migrate version 1.0→1.1');
  const tid = freshTreeId();
  await initTree(tid);
  // 先确认新树 version 已是 1.1
  const before = readState(tid);
  if (before.version !== '1.1') {
    fail('8 新树 version 初始应为 1.1', `实际 ${before.version}`);
    return;
  }
  // 篡改回 1.0
  tamperState(tid, (s) => { s.version = '1.0'; });
  const tampered = readState(tid);
  if (tampered.version !== '1.0') {
    fail('8 篡改 version 回 1.0 失败', `实际 ${tampered.version}`);
    return;
  }
  // 跑 migrate
  const r = await run(['migrate', tid]);
  if (!r.ok) {
    fail('8 migrate 命令执行', `失败 ${r.error && r.error.code}: ${(r.error && r.error.msg || '').slice(0, 200)}`);
    return;
  }
  // 断言 changes 含 version 1.0→1.1
  const changes = r.result && r.result.changes;
  if (!Array.isArray(changes)) {
    fail('8 migrate 返回 changes 数组', `实际 type=${typeof changes}`);
    return;
  }
  const versionChange = changes.find((c) => c && c.field === 'version' && c.from === '1.0' && c.to === '1.1');
  if (!versionChange) {
    const allVersionChanges = changes.filter((c) => c && c.field === 'version');
    fail('8 migrate changes 含 {field:version, from:1.0, to:1.1}',
      `未找到. version 相关 changes: ${JSON.stringify(allVersionChanges).slice(0, 200)}`);
    return;
  }
  // 重读 state.version === '1.1'
  const after = readState(tid);
  if (after.version !== '1.1') {
    fail('8 migrate 后 state.version === 1.1', `实际 ${after.version}`);
    return;
  }
  pass('8 migrate version 1.0→1.1 (changes 含 version change + state.version=1.1)', 'ok');
}

// Case 9: auditor 当 parent 被拒 (P0a 契约: auditor 是叶子节点, 不能有子 leaf)
//   addAuditor 后, 尝试 leaf_add worker parent=auditor → E_SCHEMA_INVALID
//   回归审计 P1 修复: cmdLeafAdd 行 980 加 || role === 'auditor'
async function case9_auditor_cannot_be_parent() {
  console.log('\n[9] auditor 当 parent 被拒 (叶子节点契约, 审计 P1 修复)');
  const tid = freshTreeId();
  await initTree(tid);
  const auditorId = await addAuditor(tid, 'A1', UUID.auditor);
  // 尝试给 auditor 加子 worker (parent=auditor leaf) → 应被拒
  await expectFail('9 leaf_add worker parent=auditor → E_SCHEMA_INVALID (auditor 是叶子节点)',
    ['leaf', 'add', tid, '--json', JSON.stringify({
      leaf_id: `${tid}-A2-worker`, session_id: UUID.worker, parent: auditorId,
      path: 'A2', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
      added_by: UUID.root,
    })], 'E_SCHEMA_INVALID');
}

// Case 10: auditor 当 added_by 被拒 (P0a 契约: auditor 是叶子节点, 不能当 operator)
//   addAuditor 后, 尝试 leaf_add worker added_by=auditor.session_id → E_BORROWED_IDENTITY
//   回归审计 P1 修复: cmdLeafAdd 行 930 加 || role === 'auditor'
async function case10_auditor_cannot_be_operator() {
  console.log('\n[10] auditor 当 added_by 被拒 (叶子节点不能当 operator, 审计 P1 修复)');
  const tid = freshTreeId();
  await initTree(tid);
  await addAuditor(tid, 'A1', UUID.auditor);
  // 尝试用 auditor.session_id 当 added_by 创建 worker (parent=root, 合法 parent)
  await expectFail('10 leaf_add worker added_by=auditor → E_BORROWED_IDENTITY (auditor 不能当 operator)',
    ['leaf', 'add', tid, '--json', JSON.stringify({
      leaf_id: `${tid}-W2-worker`, session_id: UUID.worker, parent: `${tid}-root`,
      path: 'W2', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
      added_by: UUID.auditor,  // auditor session 当 added_by → 应被拒
    })], 'E_BORROWED_IDENTITY');
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  console.log('============================================================');
  console.log('auditor-role-test — P0a auditor role 新机制交叉验证');
  console.log('被测引擎: ' + ENGINE_PATH);
  console.log('沙箱: ' + SANDBOX);
  console.log('============================================================');

  const cases = [
    { n: 1, fn: case1_auditor_create },
    { n: 2, fn: case2_auditor_done_simplified },
    { n: 3, fn: case3_auditor_missing_done_event },
    { n: 4, fn: case4_root_endorses_auditor },
    { n: 5, fn: case5_auditor_self_audit_rejected },
    { n: 6, fn: case6_auditor_endorses_auditor },
    { n: 7, fn: case7_auditor_endorses_worker },
    { n: 8, fn: case8_migrate_version },
    { n: 9, fn: case9_auditor_cannot_be_parent },
    { n: 10, fn: case10_auditor_cannot_be_operator },
  ];

  const filter = process.argv.slice(2).filter((a) => !/^--/.test(a));

  try {
    for (const c of cases) {
      if (filter.length > 0 && !filter.includes(String(c.n))) continue;
      try {
        await c.fn();
      } catch (e) {
        fail(`case ${c.n} 异常`, `${e && e.code ? e.code + ': ' : ''}${(e && e.message || String(e)).slice(0, 200)}`);
      }
    }
  } finally {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m`);
  console.log('------------------------------------------------------------');
  if (stats.failed > 0) {
    console.log('\n失败用例:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.info || ''}`);
    });
  }
  process.exit(stats.failed > 0 ? 1 : 0);
}

main();
