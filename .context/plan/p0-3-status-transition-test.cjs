#!/usr/bin/env node
/**
 * p0-3-status-transition-test.cjs — P0-3 状态机流转白名单 + milestone caller-binding 专项测试 (2026-07-07)
 *
 * 被测改动 (tree-engine.cjs, P0-3):
 *   1. STATUS_TRANSITIONS 矩阵 + cmdLeafSetStatus 流转校验 (L1283), 非法流转抛 E_STATUS_TRANSITION_INVALID
 *      - pending_brief → active/done/pruned/archived/pending_brief
 *      - active        → done/pruned/archived/segment_pending/pending_brief/active
 *      - done          → pruned/archived/done (禁 done→active 回退)
 *      - pruned        → archived/pruned (禁 pruned→active/done 复活)
 *      - archived      → archived (终态, 禁复活)
 *      - segment_pending → active/segment_pending
 *   2. cmdMilestoneSetResult 新增 callerSessionId 形参 + audit_pass=true 时 caller===audit_session_id 校验
 *      (L1783, 与 cmdAuditGate 一致, 堵 worker 借 root session_id 伪造 milestone audit_pass)
 *      CLI 不传 caller (callerSessionId=undefined) 跳过校验 → 向后兼容
 *
 * 测试方法:
 *   - 流转校验位于 done 门禁【之前】(L1283 < L1293 done-gate). 测流转本身用 tamperLeaf 把 leaf
 *     强制设成 from 状态 (绕过门禁到达 from 状态), 再调 set-status to.
 *     * 非法流转: 期望 E_STATUS_TRANSITION_INVALID (流转校验最先跑, 命中即抛)
 *     * 合法流转且 to != done: 期望 OK (无 done-gate 拦截)
 *     * 合法流转且 to == done: 配齐 done 前置 (milestone audit_pass + deliverable) 后期望 OK;
 *       或仅断言 error.code !== E_STATUS_TRANSITION_INVALID (流转本身放行)
 *   - milestone caller-binding: engine.run(cmd, args, SANDBOX, callerSessionId) 第 4 参显式注入 caller
 *     (模拟 MCP wrapper 透传)
 *
 * API (参考 iss003-review-gate-test.cjs / deadlock-repro.cjs):
 *   - engine.run(cmd, args, treesRoot?, callerSessionId?) 永不 throw, 返回 {ok:true} | {ok:false,error:{code,msg}}
 *   - engine.setTreesRoot(SANDBOX) + engine.setSessionVerifier(mock 放行 00000000-0000-0000-0000-0xxx)
 *   - tamperLeaf 直接读改 tree-state.json (绕过 API 构造 from 状态)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 引擎 setup
// ============================================================
const ENGINE_PATH = 'C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/tree-engine.cjs';
const engine = require(ENGINE_PATH);

// 临时沙箱 (每次独立目录, 结束清理)
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-trans-'));

// mock session verifier (沿用 iss003 / dbc-spec 占位 UUID 放行策略)
engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

// 固定测试 UUID (每棵 tree 内 session_id 唯一)
const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',  // tree init root + 所有 added_by
  worker:  '00000000-0000-0000-0000-000000000002',  // worker leaf session
  auditor: '00000000-0000-0000-0000-000000000003',  // milestone auditor (独立 leaf session)
  other:   '00000000-0000-0000-0000-000000000004',  // 备用独立 session
};

// ============================================================
// helpers
// ============================================================
// engine.run(cmd, args, treesRoot?, callerSessionId?) —— callerSessionId 第 4 参
// 默认不传 caller (走 CLI 兼容路径); milestone caller-binding 测试显式注入.
async function runAs(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  const out = await engine.run(cmd, args, SANDBOX, caller || null);
  return { ok: !!out.ok, error: out.error || null, result: out };
}

let counter = 0;
function freshTreeId() {
  counter++;
  const tid = `ptre${counter}`;  // 符合 leaf_id prefix 正则 [a-z][a-z0-9_]{3,7}
  return tid;
}

async function initTree(tid, budget) {
  return runAs(null, ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'p0-3 status-transition test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: budget === undefined ? 20 : budget, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic',
  ]);
}

// 加一个 worker leaf (初始 status=pending_brief) 或 commander leaf (初始 status=active)
async function addLeaf(tid, leafPath, role, session) {
  const leafId = `${tid}-${leafPath}-${role}`;
  await runAs(null, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: session || UUID.worker, parent: `${tid}-root`,
    path: leafPath, role: role || 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  return leafId;
}

// 直接读改 tree-state.json (绕过 API, 把 leaf 强制设成 from 状态, 测 set-status to 的流转校验)
function tamperLeaf(tree_id, leaf_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (state.leaves[leaf_id]) mutateFn(state.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

function createDeliverable(tree_id, rel) {
  const dir = path.join(SANDBOX, tree_id, 'deliverables', path.dirname(rel));
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(SANDBOX, tree_id, 'deliverables', rel);
  fs.writeFileSync(fp, 'p0-3 test deliverable\n');
  return fp;
}

// ============================================================
// 断言
// ============================================================
const stats = { passed: 0, failed: 0 };
const results = [];
function pass(name, info) { stats.passed++; results.push({ name, status: 'PASS' }); console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; results.push({ name, status: 'FAIL', info }); console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// 期望 E_STATUS_TRANSITION_INVALID (非法流转拦截)
async function expectTransitionReject(name, cmdArgs) {
  const r = await runAs(null, cmdArgs);
  if (r.ok) { fail(name, `期望 E_STATUS_TRANSITION_INVALID, 但命令成功了`); return r; }
  if (r.error && r.error.code === 'E_STATUS_TRANSITION_INVALID') { pass(name, r.error.code); return r; }
  fail(name, `期望 E_STATUS_TRANSITION_INVALID, 实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
  return r;
}

// 期望流转放行: to !== 'done' 期望 OK; to === 'done' 期望 OK 或 (流转放行后被 done-gate 拦, code !== E_STATUS_TRANSITION_INVALID)
//   返回结果, 由调用方决定是否进一步断言 OK.
async function expectTransitionAllow(name, cmdArgs, toStatus, expectOkDone) {
  const r = await runAs(null, cmdArgs);
  if (r.ok) { pass(name, 'OK'); return r; }
  if (r.error && r.error.code === 'E_STATUS_TRANSITION_INVALID') {
    fail(name, `期望流转放行, 实际被流转校验拦: ${r.error.msg.slice(0, 140)}`);
    return r;
  }
  // 流转本身放行了, 但被后续 done-gate 拦
  if (toStatus === 'done' && expectOkDone !== true) {
    pass(name, `流转放行 (后续 done-gate ${r.error.code} 不影响流转测试)`);
    return r;
  }
  fail(name, `期望 OK, 实际失败 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
  return r;
}

// ============================================================
// P0-3 状态机流转测试
// ============================================================

// 每个测试独立树, 避免状态污染.
// 给 worker leaf 配齐 done 前置 (用于合法 →done 测试, 期望完全 OK):
//   milestone(audit_pass=true by root 当 auditor) + deliverable + brief_echo + done event + audit_gate pass
//   注: auditor 必须是树中真实独立 leaf. 最方便的是 root 自己 (走闸门2: auditor===root.session_id
//   + rootLeaf events 非空). 所以这里用 UUID.root 当 milestone/audit_gate/alignment 的 auditor.
//   但 worker leaf.session_id !== root.session_id, 满足独立性. (deadlock-repro 场景B 同款路径)
async function prepareWorkerDonePrereqs(tid, leafId, workerSession) {
  const ws = workerSession || UUID.worker;
  createDeliverable(tid, 'out.md');
  // rootLeaf.events 非空 (闸门2 必要)
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-07T00:00:00Z', meta: { summary: 'root bootstrap p0-3' } }];
  });
  // milestone add (root 当 commander)
  await runAs(null, ['milestone', 'add', tid, leafId, '--json',
    JSON.stringify({ id: 'M1', desc: 'p0-3 deliverable', expect_outputs: ['out.md'] })]);
  // milestone set-result audit_pass=true, root 当 auditor (caller=root, audit_session_id=root)
  await runAs(UUID.root, ['milestone', 'set-result', tid, leafId, 'M1',
    '--audit-pass', 'true', '--audit-session-id', UUID.root]);
  // brief_echo (含 alignment by root)
  await runAs(UUID.root, ['event', 'append', tid, leafId, '--type', 'brief_echo', '--json',
    JSON.stringify({ ack: 'aligned', alignment: '95%', auditor_session_id: UUID.root })]);
  // done event (worker 自己写, caller=worker)
  await runAs(ws, ['event', 'append', tid, leafId, '--type', 'done', '--json',
    JSON.stringify({ self_check: [{ item: 'work_done', pass: true, evidence: 'p0-3 done prereqs' }] })]);
  // audit_gate pass by root (caller=root, audit_session_id=root)
  await runAs(UUID.root, ['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.root]);
}

// --- 合法流转放行 ---
async function legal_pending_brief_to_done() {
  console.log('\n[Legal-1] pending_brief → done (worker, 配齐门禁) → OK');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'L1', 'worker', UUID.worker);
  await prepareWorkerDonePrereqs(tid, leafId);
  await expectTransitionAllow('Legal-1 pending_brief→done', ['leaf', 'set-status', tid, leafId, 'done'], 'done', true);
}

async function legal_active_to_done() {
  console.log('\n[Legal-2] active → done (commander, 配齐门禁) → OK');
  const tid = freshTreeId();
  await initTree(tid);
  // commander 初始 status=active, session=auditor
  const leafId = await addLeaf(tid, 'L2', 'commander', UUID.auditor);
  // commander 也需要 milestone + audit_gate 等 done 前置; done event 由 leaf owner (auditor) 自己写
  await prepareWorkerDonePrereqs(tid, leafId, UUID.auditor);
  await expectTransitionAllow('Legal-2 active→done', ['leaf', 'set-status', tid, leafId, 'done'], 'done', true);
}

async function legal_done_to_pruned() {
  console.log('\n[Legal-3] done → pruned → OK');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'L3', 'worker', UUID.worker);
  // tamperLeaf 直接把 leaf 设成 done (绕过门禁, 测流转本身)
  tamperLeaf(tid, leafId, (l) => { l.status = 'done'; });
  await expectTransitionAllow('Legal-3 done→pruned', ['leaf', 'set-status', tid, leafId, 'pruned'], 'pruned');
}

async function legal_done_to_archived() {
  console.log('\n[Legal-4] done → archived (proper done leaf) → OK');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'L4', 'worker', UUID.worker);
  // 走完正规 done (配齐门禁 + set-status done), 再 archived (validate 不会因 alignment 缺失而拦)
  await prepareWorkerDonePrereqs(tid, leafId);
  await runAs(null, ['leaf', 'set-status', tid, leafId, 'done']);
  await expectTransitionAllow('Legal-4 done→archived', ['leaf', 'set-status', tid, leafId, 'archived'], 'archived', true);
}

async function legal_pruned_to_archived() {
  console.log('\n[Legal-5] pruned → archived → OK');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'L5', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'pruned'; });
  await expectTransitionAllow('Legal-5 pruned→archived', ['leaf', 'set-status', tid, leafId, 'archived'], 'archived');
}

async function legal_pending_brief_to_active() {
  console.log('\n[Legal-6] pending_brief → active (worker) → OK');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'L6', 'worker', UUID.worker);  // 初始 pending_brief
  await expectTransitionAllow('Legal-6 pending_brief→active', ['leaf', 'set-status', tid, leafId, 'active'], 'active');
}

async function legal_segment_pending_to_active() {
  console.log('\n[Legal-7] segment_pending → active → OK');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'L7', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'segment_pending'; });
  await expectTransitionAllow('Legal-7 segment_pending→active', ['leaf', 'set-status', tid, leafId, 'active'], 'active');
}

async function legal_done_idempotent() {
  console.log('\n[Legal-8] done → done (幂等) → OK (或 done-gate 拦, 但非 E_STATUS_TRANSITION_INVALID)');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'L8', 'worker', UUID.worker);
  // 先正常走完 done (配齐门禁)
  await prepareWorkerDonePrereqs(tid, leafId);
  await runAs(null, ['leaf', 'set-status', tid, leafId, 'done']);
  // 再 set-status done (幂等)
  await expectTransitionAllow('Legal-8 done→done (幂等)', ['leaf', 'set-status', tid, leafId, 'done'], 'done', true);
}

// --- 非法流转拦截 (期望 E_STATUS_TRANSITION_INVALID) ---
async function illegal_done_to_active() {
  console.log('\n[Illegal-1] done → active (回退) → E_STATUS_TRANSITION_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'I1', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'done'; });
  await expectTransitionReject('Illegal-1 done→active 拦截', ['leaf', 'set-status', tid, leafId, 'active']);
}

async function illegal_done_to_pending_brief() {
  console.log('\n[Illegal-2] done → pending_brief → E_STATUS_TRANSITION_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'I2', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'done'; });
  await expectTransitionReject('Illegal-2 done→pending_brief 拦截', ['leaf', 'set-status', tid, leafId, 'pending_brief']);
}

async function illegal_archived_to_active() {
  console.log('\n[Illegal-3] archived → active (终态复活) → E_STATUS_TRANSITION_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'I3', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'archived'; });
  await expectTransitionReject('Illegal-3 archived→active 拦截', ['leaf', 'set-status', tid, leafId, 'active']);
}

async function illegal_archived_to_done() {
  console.log('\n[Illegal-4] archived → done → E_STATUS_TRANSITION_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'I4', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'archived'; });
  await expectTransitionReject('Illegal-4 archived→done 拦截', ['leaf', 'set-status', tid, leafId, 'done']);
}

async function illegal_archived_to_pruned() {
  console.log('\n[Illegal-5] archived → pruned → E_STATUS_TRANSITION_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'I5', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'archived'; });
  await expectTransitionReject('Illegal-5 archived→pruned 拦截', ['leaf', 'set-status', tid, leafId, 'pruned']);
}

async function illegal_pruned_to_active() {
  console.log('\n[Illegal-6] pruned → active (复活) → E_STATUS_TRANSITION_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'I6', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'pruned'; });
  await expectTransitionReject('Illegal-6 pruned→active 拦截', ['leaf', 'set-status', tid, leafId, 'active']);
}

async function illegal_pruned_to_done() {
  console.log('\n[Illegal-7] pruned → done (复活) → E_STATUS_TRANSITION_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addLeaf(tid, 'I7', 'worker', UUID.worker);
  tamperLeaf(tid, leafId, (l) => { l.status = 'pruned'; });
  await expectTransitionReject('Illegal-7 pruned→done 拦截', ['leaf', 'set-status', tid, leafId, 'done']);
}

// ============================================================
// milestone caller-binding 测试 (P0-3 攻击面堵)
// ============================================================
// 三场景:
//   D1: worker (caller=W) 借 root session_id 调 milestone-set-result(audit_pass=true, audit_session_id=R)
//       → E_BORROWED_IDENTITY (攻击面已堵)
//   D2: root (caller=R) 调 milestone-set-result(audit_session_id=R) → OK (auditor 自己调)
//   D3: CLI 不传 caller (engine.run 不传 callerSessionId) → 校验跳过, OK (向后兼容)
async function milestone_caller_binding() {
  console.log('\n[Milestone-Caller-Binding] worker 借身份伪造 milestone audit_pass 攻击面堵');

  // D1: worker 借 root session_id → E_BORROWED_IDENTITY
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addLeaf(tid, 'D1', 'worker', UUID.worker);
    // rootLeaf.events 非空 (让闸门2 能放行, 隔离 caller-binding 校验之外的变量)
    tamperLeaf(tid, `${tid}-root`, (l) => {
      l.events = [{ type: 'plan', ts: '2026-07-07T00:00:00Z', meta: { summary: 'root bootstrap D1' } }];
    });
    createDeliverable(tid, 'd1-out.md');
    await runAs(null, ['milestone', 'add', tid, leafId, '--json',
      JSON.stringify({ id: 'DM1', desc: 'attack target', expect_outputs: ['d1-out.md'] })]);
    // worker (caller=W) 借 root session_id 调 set-result
    const r = await runAs(UUID.worker, ['milestone', 'set-result', tid, leafId, 'DM1',
      '--audit-pass', 'true', '--audit-session-id', UUID.root]);
    if (!r.ok && r.error && r.error.code === 'E_BORROWED_IDENTITY') {
      pass('D1 worker 借 root session_id → E_BORROWED_IDENTITY (攻击面已堵)', r.error.code);
    } else if (r.ok) {
      fail('D1 worker 借 root session_id → E_BORROWED_IDENTITY', '攻击面成立: worker 借身份成功 audit_pass=true (修复未生效)');
    } else {
      fail('D1 worker 借 root session_id → E_BORROWED_IDENTITY', `实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
    }
  }

  // D2: root (caller=R) 调 milestone-set-result(audit_session_id=R) → OK
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addLeaf(tid, 'D2', 'worker', UUID.worker);
    tamperLeaf(tid, `${tid}-root`, (l) => {
      l.events = [{ type: 'plan', ts: '2026-07-07T00:00:00Z', meta: { summary: 'root bootstrap D2' } }];
    });
    createDeliverable(tid, 'd2-out.md');
    await runAs(null, ['milestone', 'add', tid, leafId, '--json',
      JSON.stringify({ id: 'DM2', desc: 'auditor self call', expect_outputs: ['d2-out.md'] })]);
    // root (caller=R) 自己调, audit_session_id=R
    const r = await runAs(UUID.root, ['milestone', 'set-result', tid, leafId, 'DM2',
      '--audit-pass', 'true', '--audit-session-id', UUID.root]);
    if (r.ok) {
      pass('D2 root (caller=R) 自己调 audit_session_id=R → OK', 'ok');
    } else {
      fail('D2 root (caller=R) 自己调 audit_session_id=R → OK',
        `实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
    }
  }

  // D3: CLI 不传 caller (engine.run 不传 callerSessionId) → 校验跳过, OK (向后兼容)
  //   模拟 iss003 / p0-1 等测试的 engine.run(cmd, args) 调用方式 (不传 callerSessionId)
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addLeaf(tid, 'D3', 'worker', UUID.worker);
    tamperLeaf(tid, `${tid}-root`, (l) => {
      l.events = [{ type: 'plan', ts: '2026-07-07T00:00:00Z', meta: { summary: 'root bootstrap D3' } }];
    });
    createDeliverable(tid, 'd3-out.md');
    await runAs(null, ['milestone', 'add', tid, leafId, '--json',
      JSON.stringify({ id: 'DM3', desc: 'cli compat', expect_outputs: ['d3-out.md'] })]);
    // CLI 风格: 不传 caller (runAs(null, ...) → engine.run 第 4 参 null)
    //   注意: runAs(null,...) 会传 null; 真正的 CLI 路径是 engine.run(cmd, args) 完全不传第 4 参.
    //   两种都让 callerSessionId === undefined/null, 校验跳过. 这里测 null 路径.
    const r = await runAs(null, ['milestone', 'set-result', tid, leafId, 'DM3',
      '--audit-pass', 'true', '--audit-session-id', UUID.root]);
    if (r.ok) {
      pass('D3 CLI 不传 caller (null) → 校验跳过, OK (向后兼容)', 'ok');
    } else {
      fail('D3 CLI 不传 caller → OK',
        `实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
    }
  }

  // D3b: 完全不传第 4 参 (真 CLI 路径, callerSessionId === undefined)
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addLeaf(tid, 'D3b', 'worker', UUID.worker);
    tamperLeaf(tid, `${tid}-root`, (l) => {
      l.events = [{ type: 'plan', ts: '2026-07-07T00:00:00Z', meta: { summary: 'root bootstrap D3b' } }];
    });
    createDeliverable(tid, 'd3b-out.md');
    await engine.run('milestone', ['add', tid, leafId, '--json',
      JSON.stringify({ id: 'DM3b', desc: 'cli compat 2', expect_outputs: ['d3b-out.md'] })], SANDBOX);
    // 真 CLI: engine.run(cmd, args, treesRoot) 不传第 4 参
    const out = await engine.run('milestone', ['set-result', tid, leafId, 'DM3b',
      '--audit-pass', 'true', '--audit-session-id', UUID.root], SANDBOX);
    const r = { ok: !!out.ok, error: out.error || null };
    if (r.ok) {
      pass('D3b 真 CLI (undefined caller) → 校验跳过, OK (向后兼容)', 'ok');
    } else {
      fail('D3b 真 CLI → OK',
        `实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
    }
  }
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  console.log('============================================================');
  console.log('p0-3-status-transition-test — P0-3 状态机流转白名单 + milestone caller-binding');
  console.log('被测引擎: ' + ENGINE_PATH);
  console.log('沙箱: ' + SANDBOX);
  console.log('============================================================');

  const legal = [
    legal_pending_brief_to_done,
    legal_active_to_done,
    legal_done_to_pruned,
    legal_done_to_archived,
    legal_pruned_to_archived,
    legal_pending_brief_to_active,
    legal_segment_pending_to_active,
    legal_done_idempotent,
  ];
  const illegal = [
    illegal_done_to_active,
    illegal_done_to_pending_brief,
    illegal_archived_to_active,
    illegal_archived_to_done,
    illegal_archived_to_pruned,
    illegal_pruned_to_active,
    illegal_pruned_to_done,
  ];

  try {
    console.log('\n--- 合法流转放行 (8 场景) ---');
    for (const fn of legal) {
      try { await fn(); } catch (e) {
        fail(`${fn.name} 异常`, `${e && e.code ? e.code + ': ' : ''}${(e && e.message || String(e)).slice(0, 200)}`);
      }
    }
    console.log('\n--- 非法流转拦截 (7 场景, 期望 E_STATUS_TRANSITION_INVALID) ---');
    for (const fn of illegal) {
      try { await fn(); } catch (e) {
        fail(`${fn.name} 异常`, `${e && e.code ? e.code + ': ' : ''}${(e && e.message || String(e)).slice(0, 200)}`);
      }
    }
    console.log('\n--- milestone caller-binding (P0-3 攻击面堵, 4 场景) ---');
    try { await milestone_caller_binding(); } catch (e) {
      fail('milestone_caller_binding 异常', `${e && e.code ? e.code + ': ' : ''}${(e && e.message || String(e)).slice(0, 200)}`);
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
