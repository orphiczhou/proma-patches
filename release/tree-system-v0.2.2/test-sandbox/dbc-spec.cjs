#!/usr/bin/env node
/**
 * dbc-spec.cjs — Phase A DbC 硬约束单元测试 (T0)
 *
 * 性质: commander（根会话）的独立验收工具。不委托给被测 worker 编写，
 *       保证"实现/测试/审计"三方分离（呼应方案"审计必须是独立角色"）。
 *
 * 原理: 通过 require patch-l/tree-engine.cjs 调引擎（不再 spawn tree-state.js CLI）。
 *       engine.run(cmd, args) 返回 {ok, ...result} 或 {ok:false, error:{code,msg}}，
 *       永不 throw；调用前须 engine.setTreesRoot(SANDBOX) 注入 tree 数据目录
 *       （原 CLI 用 __dirname，require 后必须显式注入）。
 *
 * 用法: node dbc-spec.cjs            # 跑全部用例
 *       node dbc-spec.cjs A1 A2      # 跑指定用例
 *
 * 红绿循环:
 *   - 改造前（v0.2.2 基线）: A1/A2/A7 用例应为红（bug 存在，命令成功而非 throw）
 *   - worker 实施 DbC 后   : 全部变绿（命令 throw 正确错误码）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, 'core');       // test-sandbox/core/ — tree 数据目录（tree-state.js 副本保留但不再 spawn）
// 引擎 require（M3：内联引擎，消除对 tree-state.js 文件的 spawn 依赖）
// 自适应查找 tree-engine.cjs（让本文件在 test-sandbox/、skills/assets/、激活 assets/ 下都能定位 engine）
const _findEngine = () => {
  if (process.env.PROMA_TREE_ENGINE && fs.existsSync(process.env.PROMA_TREE_ENGINE)) return process.env.PROMA_TREE_ENGINE;
  const cands = [
    path.join(__dirname, '..', 'patch-l', 'tree-engine.cjs'),
    path.join(__dirname, '..', '..', '..', 'release', 'tree-system-v0.2.2', 'patch-l', 'tree-engine.cjs'),
    path.join(__dirname, '..', '..', '..', 'workspace-files', 'release', 'tree-system-v0.2.2', 'patch-l', 'tree-engine.cjs'),
    'D:\\Proma-dev\\resources\\app\\dist\\tree-engine.cjs',
    'D:\\Proma-release\\resources\\app\\dist\\tree-engine.cjs',
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  throw new Error('tree-engine.cjs not found. Set PROMA_TREE_ENGINE=<abs-path> or deploy engine to dist/.');
};
const engine = require(_findEngine());
engine.setTreesRoot(SANDBOX);                       // 原 CLI 用 __dirname，require 后必须显式注入

// ---- 期望错误码常量（commander 锁定，worker 不得更改这些断言期望）----
const E = {
  DELIVERABLE_MISSING:      'E_DELIVERABLE_MISSING',      // A1
  AUDITOR_NOT_INDEPENDENT:  'E_AUDITOR_NOT_INDEPENDENT',  // A2
  AUDIT_PREMATURE:          'E_AUDIT_PREMATURE',          // A7
  ALIGNMENT_NOT_VERIFIED:   'E_ALIGNMENT_NOT_VERIFIED',   // A3 (批次2)
  SELFCHECK_INVALID:        'E_SELFCHECK_INVALID',        // A5 (批次2)
  TREE_NODE_BUDGET_EXCEEDED:'E_TREE_NODE_BUDGET_EXCEEDED',// A4 (批次3)
  TREE_NOT_VALIDATED:       'E_TREE_NOT_VALIDATED',       // A6 (批次3)
  DEPTH_EXCEEDED:           'E_DEPTH_EXCEEDED',           // A9 已有 (T3)
  // E_ROLE_INVALID 由 ROLE_ENUM 既有机制覆盖
};

// 固定测试 UUID（避免 Math.random 依赖）
const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',
  worker:  '00000000-0000-0000-0000-000000000002',
  auditor: '00000000-0000-0000-0000-000000000003',
  other:   '00000000-0000-0000-0000-000000000004',
};

// ---- 引擎运行器（M3：engine.run 替代 execFileSync spawn）----
// engine.run 是 async（返回 Promise），永不 throw。
// 成功 -> {ok:true, ...result}；失败 -> {ok:false, error:{code,msg}}。
async function run(cmdArgs) {
  // cmdArgs: string[] 不含 'node tree-state.js' 前缀；cmdArgs[0]=command, rest=args
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  return { ok: !!out.ok, error: out.error || null, result: out, stdout: JSON.stringify(out) };
}

// ---- 断言 ----
const stats = { passed: 0, failed: 0, skipped: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function skip(name, info) { stats.skipped++; console.log(`  \x1b[33m-\x1b[0m ${name}  ${info || ''}`); }

// 期望命令失败且错误码匹配
async function expectFail(name, cmdArgs, expectedCode) {
  const r = await run(cmdArgs);
  if (r.ok) { fail(name, `期望失败 ${expectedCode}，但命令成功了`); return; }
  if (r.error && r.error.code === expectedCode) { pass(name, expectedCode); return; }
  fail(name, `期望 ${expectedCode}，实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 120)}`);
}
// 期望命令成功（用于验证 setup 步骤本身没被拦）
async function expectOk(name, cmdArgs) {
  const r = await run(cmdArgs);
  if (r.ok) { pass(name, 'ok'); return; }
  fail(name, `期望成功，实际失败 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 120)}`);
}

// ---- 通用 setup helpers ----
let counter = 0;
function freshTreeId() {
  counter++;
  const tid = `tdb${counter}`; // 符合 leaf_id prefix 正则 [a-z][a-z0-9_]{3,7}
  const dir = path.join(SANDBOX, tid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return tid;
}

// 初始化 tree 并返回 {tid}。budget 可选，默认 10
async function setupTree(budget) {
  const tid = freshTreeId();
  await run(['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'dbc unit test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: (budget === undefined ? 10 : budget), max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic',
  ]);
  return { tid };
}

// 直接读改 tree-state.json（模拟"绕过子命令直接篡改文件"的攻击场景，用于 validate/归档前置测试）
function tamperLeaf(tree_id, leaf_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (state.leaves[leaf_id]) mutateFn(state.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

// 初始化 tree + 一个 auditor-commander leaf（V2 白名单后，auditor 必须是树中真实 leaf session）
// 返回 {tid, auditorSession}。auditorSession = UUID.auditor（auditor-commander leaf 的 session）
async function setupTreeWithAuditor(budget) {
  const { tid } = await setupTree(budget);
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: `${tid}-Aud-commander`, session_id: UUID.auditor, parent: `${tid}-root`, path: 'Aud',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })]);
  return { tid, auditorSession: UUID.auditor };
}

// 添加一个 worker leaf（满足 done 前置除"被测项"外的条件由调用方控制）
async function addWorker(tid, leafPath) {
  const leafId = `${tid}-${leafPath}-worker`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: UUID.worker, parent: `${tid}-root`,
    path: leafPath, role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  return leafId;
}

// 给 worker 配齐"done 前置"：milestone(audit_pass) + brief_echo + done event + audit_gate pass
async function prepareWorkerForDone(tid, leafId, opts) {
  opts = opts || {};
  // milestone（expect_outputs 缺省指向不存在文件）
  const outputs = opts.expectOutputs || ['missing-deliverable.md'];
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({
    id: 'M1', desc: 'test milestone', expect_outputs: outputs,
  })]);
  // v0.7 批次5 (V4): set-result 需独立 auditor 背书（调用方需 setupTreeWithAuditor 保证 auditor leaf 存在）
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  // events: brief_echo + done
  // brief_echo 带 alignment + 独立 auditor（V5b: 清 alignment_pending，让后续 audit_gate pass 放行）
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.auditor })]);
  if (opts.skipDoneEvent !== true) {
    const defaultDone = {
      deliverables: [],
      self_check: [{ item: 'setup_placeholder', pass: true, evidence: 'prepareWorkerForDone default' }],
    };
    await run(['event', 'append', tid, leafId, '--type', 'done', '--json',
      JSON.stringify(opts.doneMeta || defaultDone)]);
  }
  // audit_gate pass（A2 未实现前不校验独立性；用独立 auditor）
  if (opts.skipAuditGate !== true) {
    await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  }
}

// ============================================================
// 用例定义
// ============================================================
const CASES = {};

// ---------- A1: done 时校验 expect_outputs 文件存在 ----------
CASES.A1 = async () => {
  console.log('\n[A1] done 时 milestone.expect_outputs 文件必须存在 (E_DELIVERABLE_MISSING)');
  const { tid } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'A1');
  await prepareWorkerForDone(tid, leafId, { expectOutputs: ['missing-deliverable.md'] });
  // 文件不存在 → set-status done 必须被拦
  await expectFail('A1 文件缺失拦截', ['leaf', 'set-status', tid, leafId, 'done'], E.DELIVERABLE_MISSING);
};

// ---------- A2: auditor 独立性 ----------
CASES.A2 = async () => {
  console.log('\n[A2] audit-gate auditor 必须独立于 added_by / root / null (E_AUDITOR_NOT_INDEPENDENT)');
  const { tid } = await setupTree();
  const leafId = await addWorker(tid, 'A2');

  // (a) auditor = added_by（= root session）→ 拦
  await expectFail('A2-a auditor=added_by(根) 拦截',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.root],
    E.AUDITOR_NOT_INDEPENDENT);

  // (b) auditor 缺省(null) → 拦
  await expectFail('A2-b auditor=null 拦截',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass'],
    E.AUDITOR_NOT_INDEPENDENT);

  // (c) 对照：独立 auditor 应通过（验证 A2 不是误伤）
  // 注: 对照 worker 必须先补 done event 满足 A7 时序前置, 否则会被 A7 时序门误拦,
  //     混淆 A2 独立性验证 —— A2-c 与 A7 的区别应仅在"auditor 是否独立", 而非"有无 done event"
  const { tid: tid2, auditorSession } = await setupTreeWithAuditor();
  const leafId2 = await addWorker(tid2, 'A2c');
  await run(['event', 'append', tid2, leafId2, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: auditorSession })]);
  await run(['event', 'append', tid2, leafId2, '--type', 'done', '--json', JSON.stringify({ deliverables: [], self_check: [{ item: 'a2c_setup', pass: true, evidence: 'setup default for strict A5' }] })]);
  await expectOk('A2-c 独立 auditor 放行',
    ['audit', 'gate', tid2, leafId2, '--verdict', 'pass', '--audit-session-id', auditorSession]);
};

// ---------- A7: audit 时序（pass 前必须有更早的 done 事件）----------
CASES.A7 = async () => {
  console.log('\n[A7] audit-gate pass 时必须存在更早的 done 事件 (E_AUDIT_PREMATURE)');
  const { tid } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'A7');
  // 不 append done event，直接 audit pass（用独立 auditor 避免触发 A2）
  await expectFail('A7 无 done 事件即 audit pass 拦截',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.auditor],
    E.AUDIT_PREMATURE);
};

// ---------- 批次2 占位（A3/A5）----------
CASES.A3 = async () => {
  console.log('\n[A3] brief_echo 带 alignment 必须有独立 auditor_session_id (E_ALIGNMENT_NOT_VERIFIED)');
  const { tid } = await setupTree();
  const leafId = await addWorker(tid, 'A3');
  // (a) alignment 无 auditor_session_id → 拦
  await expectFail('A3-a alignment 无 auditor 拦截',
    ['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '98%' })],
    E.ALIGNMENT_NOT_VERIFIED);
  // (b) alignment 的 auditor = added_by/root(自己) → 拦
  await expectFail('A3-b alignment auditor=自己 拦截',
    ['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '98%', auditor_session_id: UUID.root })],
    E.ALIGNMENT_NOT_VERIFIED);
  // (c) 对照: alignment + 独立 auditor → ok
  const { tid: tid2, auditorSession } = await setupTreeWithAuditor();
  const leafId2 = await addWorker(tid2, 'A3c');
  await expectOk('A3-c alignment+独立auditor 放行',
    ['event', 'append', tid2, leafId2, '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '95%', auditor_session_id: auditorSession })]);
};
CASES.A5 = async () => {
  console.log('\n[A5] done event self_check 必须是 [{item,pass,evidence}] 非空数组 (E_SELFCHECK_INVALID)');
  const { tid } = await setupTree();
  const leafId = await addWorker(tid, 'A5');
  // (a) self_check 是字符串 → 拦
  await expectFail('A5-a self_check=字符串 拦截',
    ['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ self_check: 'all_pass' })],
    E.SELFCHECK_INVALID);
  // (b) self_check 空数组 → 拦
  await expectFail('A5-b self_check=空数组 拦截',
    ['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ self_check: [] })],
    E.SELFCHECK_INVALID);
  // (c) self_check 缺 pass/evidence → 拦
  await expectFail('A5-c self_check 缺字段 拦截',
    ['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x' }] })],
    E.SELFCHECK_INVALID);
  // (e) self_check 完全缺省 → 拦（strict：必须存在，堵 CP5 省略式伪自检）
  await expectFail('A5-e self_check 缺省 拦截',
    ['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ deliverables: [] })],
    E.SELFCHECK_INVALID);
  // (d) 对照: 合法 self_check → ok
  const { tid: tid2 } = await setupTree();
  const leafId2 = await addWorker(tid2, 'A5d');
  await expectOk('A5-d 合法 self_check 放行',
    ['event', 'append', tid2, leafId2, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'file_exists', pass: true, evidence: '8556 bytes on disk' }] })]);
};

// ---------- 批次3 占位（A4/A6/#2）----------
CASES.A4 = async () => {
  console.log('\n[A4] leaf add 时 active_count >= node_budget 拦截 (E_TREE_NODE_BUDGET_EXCEEDED)');
  const { tid } = await setupTree(2); // node_budget=2: root(1) + 1 worker(2) = 满
  await addWorker(tid, 'A4a'); // root + A4a = 2 active, 放行
  // 第2个 worker → active_count=2 >= budget=2 → 拦
  await expectFail('A4 节点超budget拦截', ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: `${tid}-A4b-worker`, session_id: UUID.other, parent: `${tid}-root`, path: 'A4b',
    role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })], E.TREE_NODE_BUDGET_EXCEEDED);
};
CASES.A6 = async () => {
  console.log('\n[A6] leaf set-status archived 前整 tree validate issues=0 (E_TREE_NOT_VALIDATED)');
  const { tid } = await setupTree();
  const leafId = await addWorker(tid, 'A6');
  // 篡改: 伪造 done worker + 不独立 audit_gate(auditor=added_by=root) → HARDEN2 会让 validate 报 issue
  tamperLeaf(tid, leafId, (l) => {
    l.status = 'done';
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.root, ts: '2026-06-23T00:00:00Z' };
  });
  // archived 前跑整 tree validate, 有 issue → 拦（加固点#2 的双重防线之一）
  await expectFail('A6 archived前validate拦截', ['leaf', 'set-status', tid, leafId, 'archived'], E.TREE_NOT_VALIDATED);
};
CASES.HARDEN2 = async () => {
  console.log('\n[#2] validate 时 done worker 必须有独立 audit_gate (加固点#2)');
  const { tid } = await setupTree();
  const leafId = await addWorker(tid, 'H2');
  // 篡改: done worker 的 auditor=added_by(自审)，模拟绕过 audit-gate 命令直接改文件
  tamperLeaf(tid, leafId, (l) => {
    l.status = 'done';
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.root, ts: '2026-06-23T00:00:00Z' };
  });
  const r = await run(['validate', tid]);
  const issues = (r.result && r.result.issues) || [];
  const hit = issues.find((i) => /audit|independent/i.test(i.type || '') || /audit|independent|self.audit/i.test(i.detail || ''));
  if (hit) pass('HARDEN2 validate 报 audit_gate issue', `${issues.length} issues, hit: ${hit.type || (hit.detail || '').slice(0, 60)}`);
  else fail('HARDEN2 validate 报 audit_gate issue', `未找到 audit_gate issue. ok=${r.result && r.result.ok}, issues=${JSON.stringify(issues).slice(0, 200)}`);
};
CASES.HARDEN6 = async () => {
  console.log('\n[#6] validate 时 commander/root context_usage_pct>100 报 issue (加固点#6 预留)');
  const { tid } = await setupTree();
  tamperLeaf(tid, `${tid}-root`, (l) => { l.context_usage_pct = 120; });
  const r = await run(['validate', tid]);
  const issues = (r.result && r.result.issues) || [];
  const hit = issues.find((i) => /context/i.test(i.type || '') || /context/i.test(i.detail || ''));
  if (hit) pass('HARDEN6 validate 报 context issue', `${issues.length} issues`);
  else fail('HARDEN6 validate 报 context issue', `未找到 context issue. ok=${r.result && r.result.ok}, issues=${JSON.stringify(issues).slice(0, 150)}`);
};

// ---------- V2: auditor 白名单（堵伪造UUID，批次4 加固）----------
CASES.V2_FORGED = async () => {
  console.log('\n[V2] audit-gate auditor 必须是树中真实 leaf session（白名单，E_AUDITOR_NOT_INDEPENDENT）');
  const { tid } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'V2');
  // 伪造非树中 UUID → 白名单拦（黑名单下会放行）
  await expectFail('V2 伪造非树中UUID auditor 拦截',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    E.AUDITOR_NOT_INDEPENDENT);
};

// ---------- V1: cmdRestore validate 前置（CRITICAL 修复，批次4 加固）----------
CASES.V1_RESTORE = async () => {
  console.log('\n[V1] cmdRestore 拒绝含伪造 done worker 的 backup（E_TREE_NOT_VALIDATED，CRITICAL）');
  const { tid } = await setupTreeWithAuditor();
  const FK = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const rootLid = `${tid}-root`, wLid = `${tid}-V1-worker`;
  const forged = {
    version: '1.0', tree_id: tid, created_at: '2026-06-23T00:00:00Z', last_heartbeat: null,
    root_brief: {}, root_dod: { deliverables: [], node_budget: 10, max_depth: 3 },
    leaves: {
      [rootLid]: { leaf_id: rootLid, session_id: UUID.root, parent: null, path: '', role: 'root', model: 'claude-sonnet-4-6', channel: 'anthropic', status: 'active', created_at: '2026-06-23T00:00:00Z', added_by: null, last_event_ts: null, last_event_type: null, context_usage_pct: 0, drift_history: [], milestones: [], segment_chain: [], autonomy_overrides: {}, events: [], audit_gate: { verdict: 'skip', auditor_session_id: null, ts: null }, nudge_count: 0, nudge_log: [], audit_log: [] },
      [wLid]: { leaf_id: wLid, session_id: FK, parent: rootLid, path: 'V1', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', status: 'done', created_at: '2026-06-23T00:00:00Z', added_by: UUID.root, last_event_ts: '2026-06-23T00:00:00Z', last_event_type: 'done', context_usage_pct: 0, drift_history: [], milestones: [], segment_chain: [], autonomy_overrides: {}, events: [{ type: 'done', ts: '2026-06-23T00:00:00Z', meta: { self_check: [{ item: 'forged', pass: true, evidence: 'forged' }] } }], audit_gate: { verdict: 'pass', auditor_session_id: FK, ts: '2026-06-23T00:00:00Z' }, nudge_count: 0, nudge_log: [], audit_log: [] },
    },
    heartbeat_log: [], drift_log: [], audit_meta: {}, _meta: { workspace_root: SANDBOX },
  };
  const backupPath = path.join(SANDBOX, tid, 'forged-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(forged));
  // restore → V2 白名单让 HARDEN2 检测伪造 auditor → validate issue → V1 拦
  await expectFail('V1 restore 拒绝伪造backup', ['restore', tid, backupPath], E.TREE_NOT_VALIDATED);
};

// ---------- V3: A1 强制 expect_outputs 非空（堵空交付物，批次4 加固）----------
CASES.V3_EMPTY = async () => {
  console.log('\n[V3] done 时 milestone.expect_outputs 必须非空（E_DELIVERABLE_MISSING，堵空交付物）');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'V3');
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'empty outputs', expect_outputs: [] })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', auditorSession]);
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: auditorSession })]);
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'v3', pass: true, evidence: 'setup' }] })]);
  await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', auditorSession]);
  await expectFail('V3 空 expect_outputs 拦截', ['leaf', 'set-status', tid, leafId, 'done'], E.DELIVERABLE_MISSING);
};

// ---------- T3: depth 既有机制复测（应已绿）----------
CASES.T3 = async () => {
  console.log('\n[T3] commander 嵌套深度限制复测 (E_DEPTH_EXCEEDED 既有)');
  // 构造 root → commander1 → commander2 → 尝试加 commander3（第4层 commander）
  // 注: calcCommanderDepth 拦 commander depth>=3
  const { tid } = await setupTree();
  const c1 = `${tid}-B-commander`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: c1, session_id: UUID.worker, parent: `${tid}-root`, path: 'B',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })]);
  const c2 = `${tid}-B1-commander`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: c2, session_id: UUID.other, parent: c1, path: 'B1',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.worker,
  })]);
  // 尝试加第3层 commander（c2 下）→ calcCommanderDepth(c2)=3 → 拦
  const c3 = `${tid}-B2-commander`;
  await expectFail('T3 第3层 commander 嵌套拦截', ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: c3, session_id: UUID.auditor, parent: c2, path: 'B2',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.other,
  })], E.DEPTH_EXCEEDED);
};

// ---------- 批次5 (V8): node_budget=0 被尊重 ----------
CASES.V8 = async () => {
  console.log('\n[V8] node_budget=0 必须禁止加任何非root leaf (E_TREE_NODE_BUDGET_EXCEEDED)');
  const { tid } = await setupTree(0); // budget=0: root 已是 1 active >= 0
  await expectFail('V8 budget=0 加 leaf 被拦',
    ['leaf', 'add', tid, '--json', JSON.stringify({
      leaf_id: `${tid}-V8-worker`, session_id: UUID.worker, parent: `${tid}-root`,
      path: 'V8', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
    })], E.TREE_NODE_BUDGET_EXCEEDED);
};

// ---------- 批次5 (V6): self_check 全 pass:false 被拦 ----------
CASES.V6 = async () => {
  console.log('\n[V6] done event self_check 全 pass:false 被拦 (E_SELFCHECK_INVALID)');
  const { tid } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'V6');
  await expectFail('V6 全 pass:false 拦截',
    ['event', 'append', tid, leafId, '--type', 'done', '--json',
     JSON.stringify({ self_check: [{ item: 'failed', pass: false, evidence: '没做' }] })],
    E.SELFCHECK_INVALID);
  await expectOk('V6 混合 pass 放行（诚实报部分失败）',
    ['event', 'append', tid, leafId, '--type', 'done', '--json',
     JSON.stringify({ self_check: [
       { item: 'done_part', pass: true, evidence: 'e1' },
       { item: 'missed_part', pass: false, evidence: 'e2' },
     ] })]);
};

// ---------- 批次5 (V5b): 无 alignment 留痕时 worker audit_gate pass 被拦 ----------
CASES.V5B = async () => {
  console.log('\n[V5b] brief_echo 无 alignment 时 worker audit_gate pass 被拦 (E_ALIGNMENT_NOT_VERIFIED)');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'V5b');
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok' })]);
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json',
    JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  await expectFail('V5b 无 alignment → audit pass 被拦',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', auditorSession],
    E.ALIGNMENT_NOT_VERIFIED);
  await expectOk('V5b 补 alignment+auditor 后 brief_echo 放行',
    ['event', 'append', tid, leafId, '--type', 'brief_echo', '--json',
     JSON.stringify({ alignment: '95%', auditor_session_id: auditorSession })]);
  await expectOk('V5b 补 alignment 后 audit pass 放行',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', auditorSession]);
};

// ---------- 批次5 (V4): milestone set-result audit_pass=true 需独立 auditor ----------
CASES.V4 = async () => {
  console.log('\n[V4] milestone set-result --audit-pass true 需独立 --audit-session-id (E_AUDITOR_NOT_INDEPENDENT)');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'V4');
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['x.md'] })]);
  await expectFail('V4-a audit_pass=true 无 auditor 拦截',
    ['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true'],
    E.AUDITOR_NOT_INDEPENDENT);
  await expectFail('V4-b auditor=self(根) 拦截',
    ['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.root],
    E.AUDITOR_NOT_INDEPENDENT);
  await expectOk('V4-c 独立 auditor 放行',
    ['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', auditorSession]);
  await expectOk('V4-d audit_pass=false 免 auditor 放行',
    ['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'false']);
};

// ---------- 批次5 (CP2): 任何 verdict=pass 的 audit_gate 都验独立性 ----------
CASES.CP2 = async () => {
  console.log('\n[CP2] 伪造 audit_gate.verdict=pass (任意 role/status) 被 validate 报出');
  const FK = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const { tid } = await setupTree();
  const leafId = await addWorker(tid, 'Cp2');
  tamperLeaf(tid, leafId, (l) => {
    l.audit_gate = { verdict: 'pass', auditor_session_id: FK, ts: '2026-06-23T00:00:00Z' };
  });
  let r = await run(['validate', tid]);
  let issues = (r.result && r.result.issues) || [];
  let hit = issues.find((i) => i.type === 'audit_gate_not_independent');
  if (hit) pass('CP2 伪造 pass 被 validate 报出', `${hit.type} on ${hit.leaf_id}`);
  else fail('CP2 伪造 pass 被 validate 报出', `未报出 (issues=${issues.length})`);
  // 对照: 合法独立 auditor 的 pass 不误报
  const { tid: tid2, auditorSession } = await setupTreeWithAuditor();
  const leafId2 = await addWorker(tid2, 'Cq2');
  tamperLeaf(tid2, leafId2, (l) => {
    l.audit_gate = { verdict: 'pass', auditor_session_id: auditorSession, ts: '2026-06-23T00:00:00Z' };
  });
  r = await run(['validate', tid2]);
  issues = (r.result && r.result.issues) || [];
  hit = issues.find((i) => i.type === 'audit_gate_not_independent');
  if (hit) fail('CP2 合法 auditor 不误报', `误报: ${hit.type} on ${hit.leaf_id}`);
  else pass('CP2 合法 auditor 不误报', 'ok');
};

// ---------- 批次5 (V9): expect_outputs 禁止绝对路径/路径遍历 ----------
CASES.V9 = async () => {
  console.log('\n[V9] expect_outputs 绝对路径/路径遍历被拦 (E_DELIVERABLE_MISSING)');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const sysFile = process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/hosts';
  // (a) 绝对路径（系统文件冒充交付物）→ 拦
  const leafId = await addWorker(tid, 'V9a');
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'abs', expect_outputs: [sysFile] })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', auditorSession]);
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '95%', auditor_session_id: auditorSession })]);
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', auditorSession]);
  await expectFail('V9-a 绝对路径拦截', ['leaf', 'set-status', tid, leafId, 'done'], E.DELIVERABLE_MISSING);
  // (b) 路径遍历（../逃出 deliverables/）→ 拦
  const leafId2 = await addWorker(tid, 'V9b');
  await run(['milestone', 'add', tid, leafId2, '--json', JSON.stringify({ id: 'M1', desc: 'trav', expect_outputs: ['../../../etc/hosts'] })]);
  await run(['milestone', 'set-result', tid, leafId2, 'M1', '--audit-pass', 'true', '--audit-session-id', auditorSession]);
  await run(['event', 'append', tid, leafId2, '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '95%', auditor_session_id: auditorSession })]);
  await run(['event', 'append', tid, leafId2, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  await run(['audit', 'gate', tid, leafId2, '--verdict', 'pass', '--audit-session-id', auditorSession]);
  await expectFail('V9-b 路径遍历拦截', ['leaf', 'set-status', tid, leafId2, 'done'], E.DELIVERABLE_MISSING);
};

// ---------- 批次5 (V5b-tamper): alignment_pending 标志篡改无效（审计[1] 回归）----------
CASES.V5BT = async () => {
  console.log('\n[V5b-tamper] 篡改 alignment_pending 标志无法绕过对齐门（cmdAuditGate 查 events 留痕）');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'V5t');
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok' })]); // 无 alignment
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  tamperLeaf(tid, leafId, (l) => { l.alignment_pending = false; }); // 篡改标志
  await expectFail('V5b-tamper 篡改标志后 audit pass 仍被拦',
    ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', auditorSession],
    E.ALIGNMENT_NOT_VERIFIED);
};

// ---------- 批次5 (C4): milestone add 空 expect_outputs → validate 软警告 ----------
CASES.C4 = async () => {
  console.log('\n[C4] milestone add 空 expect_outputs → add ok, validate 报 milestone_empty_outputs issue');
  const { tid } = await setupTree();
  const leafId = await addWorker(tid, 'C4');
  // milestone add 空 expect_outputs → add 成功（保"先建后填"灵活）
  await expectOk('C4 milestone add 空 expect_outputs 不拦',
    ['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'empty', expect_outputs: [] })]);
  // validate → 报 milestone_empty_outputs issue
  const r = await run(['validate', tid]);
  const issues = (r.result && r.result.issues) || [];
  const hit = issues.find((i) => i.type === 'milestone_empty_outputs');
  if (hit) pass('C4 validate 报 milestone_empty_outputs issue', `${hit.type} on ${hit.leaf_id}`);
  else fail('C4 validate 报 milestone_empty_outputs issue', `未找到 issue. ok=${r.result && r.result.ok}, issues=${JSON.stringify(issues).slice(0, 200)}`);
  // 对照: 非空 expect_outputs 不报
  const leafId2 = await addWorker(tid, 'C4b');
  await run(['milestone', 'add', tid, leafId2, '--json', JSON.stringify({ id: 'M1', desc: 'full', expect_outputs: ['x.md'] })]);
  const r2 = await run(['validate', tid]);
  const issues2 = (r2.result && r2.result.issues) || [];
  const hit2 = issues2.find((i) => i.type === 'milestone_empty_outputs' && i.leaf_id === leafId2);
  if (!hit2) pass('C4 非空 expect_outputs 不误报', 'ok');
  else fail('C4 非空 expect_outputs 不误报', `误报: ${JSON.stringify(hit2).slice(0, 100)}`);
};

// ============================================================
// 主入口
// ============================================================
async function main() {
  console.log('============================================================');
  console.log('dbc-spec — Phase A DbC 硬约束单元测试');
  console.log('被测引擎: patch-l/tree-engine.cjs (require, 不再 spawn tree-state.js)');
  console.log('============================================================');
  const filter = process.argv.slice(2);
  const order = ['A1', 'A2', 'A7', 'A3', 'A5', 'A4', 'A6', 'HARDEN2', 'HARDEN6', 'V2_FORGED', 'V1_RESTORE', 'V3_EMPTY', 'T3', 'V8', 'V6', 'V5B', 'V4', 'CP2', 'V9', 'V5BT', 'C4'];
  for (const key of order) {
    if (filter.length > 0 && !filter.includes(key)) continue;
    if (typeof CASES[key] === 'function') await CASES[key]();
  }
  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m / \x1b[33m跳过 ${stats.skipped}\x1b[0m`);
  console.log('------------------------------------------------------------');
  // 批次1验收硬门: A1/A2/A7 必须全绿（改造后）；改造前它们应该失败（红）证明 bug
  process.exit(stats.failed > 0 ? 1 : 0);
}

main();
