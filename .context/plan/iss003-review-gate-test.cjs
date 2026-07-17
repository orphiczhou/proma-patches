#!/usr/bin/env node
/**
 * iss003-review-gate-test.cjs — ISS-003 Review Gate 验收测试 (2026-07-04)
 *
 * 被测改动 (tree-engine.cjs, ISS-003):
 *   1. 新增错误码 E_REVIEW_NOT_CONVERGED / E_REVIEW_FORGERY / E_REVIEW_FLAGGED_BLOCK
 *   2. DEFAULT_AUDIT_META.review_required = false (默认 opt-in, 防金标准回归)
 *   3. isReviewRequired(leaf) + validateReviewRoundSchema(meta, leaf, leafId) 辅助函数
 *   4. cmdLeafSetStatus done 门禁: worker + review_required → events 须含 ≥1 review_round,
 *      schema 校验 + 末轮 red_count===0 + 总轮数 ≤3
 *   5. cmdLeafAdd 3.8 父链 flagged 扫描: 祖先 review_evidence.flagged=true 且 events 无 review_round → 拒
 *   6. cmdMigrate 规则 11: 存量 done worker leaf 标 review_evidence={grandfathered:true, flagged:true, ...}
 *
 * 引擎调用约定 (参考 dbc-spec.cjs):
 *   - engine.run(cmd, args, treesRoot?, callerSessionId?) 永不 throw, 返回 {ok:true,...} | {ok:false,error:{code,msg}}
 *   - 测试前 engine.setTreesRoot(SANDBOX); engine.setSessionVerifier(mock)
 *   - review_round 事件【不能】通过 event append 添加 (EVENT_TYPE_ENUM 不含 review_round),
 *     必须用 tamperLeaf 直接写文件 —— 这正是 ISS-003 设计标注的"events 可写, 仅防格式伪造, 不防内容伪造"
 *     的阶段一已知局限. 本测试通过 tamperLeaf 注入 review_round 事件, 验证 set-status done 时
 *     validateReviewRoundSchema 的拦截/放行逻辑.
 *
 * 关键架构事实 (确认):
 *   - audit_meta 在 init 时只挂在 tree state 上, 不在 leaf 上. 而 isReviewRequired(leaf) 读的是
 *     leaf.audit_meta (默认 {}), 所以 review_required 必须【直接篡改到 leaf 上】才能触发门禁.
 *     这与 dbc-spec 的 tamperLeaf 模式一致 (用它构造 done 前置条件).
 *
 * 测试场景 (11):
 *   1. review_required=true + 无 review_round event → E_REVIEW_NOT_CONVERGED
 *   2. review_required=true + 合法 review_round(末轮 red=0, subagent 分支) → 通过 review 门禁 (done 成功)
 *   3. review_required=true + worker session 分支(reviewer_session_id=leaf.session_id) → E_REVIEW_SESSION_FORBIDDEN (v0.18)
 *   4. review_required=true + worker session 分支(reviewer_session_id=added_by) → E_REVIEW_SESSION_FORBIDDEN (v0.18)
 *   5. review_required=true + subagent 分支 + evidence <10 字 → E_REVIEW_FORGERY
 *   6. review_required=true + subagent 分支 + 末轮 red_count>0 → E_REVIEW_NOT_CONVERGED
 *   7. review_required=false (默认) → 不要求 review, done 通过
 *   8. PROMA_REVIEW_DISABLE=1 → 不要求 review, done 通过
 *   9. 【已知局限】worker 自写格式合法的 review_round (5 个 subagent reviewer, red=0, converged=true)
 *      → 期望通过门禁 (内容伪造阶段一不拦, 靠 commander 抽样 + 阶段二 Layer2)
 *   10. cmdMigrate 规则 11: done worker leaf → review_evidence.grandfathered=true + flagged=true
 *   11. cmdLeafAdd 父链 flagged: flagged 祖先下创建子 leaf → E_REVIEW_FLAGGED_BLOCK;
 *       给祖先补 review_round event 后 → 放行
 *
 * v0.18 (2026-07-16) 引擎变更:
 *   - worker role 用 review_round session 分支 (reviewer_kind=session 或缺省) → E_REVIEW_SESSION_FORBIDDEN.
 *     worker 自审必走 subagent 分支: reviewer_kind:'subagent' + reviewer_ref:`sub:<leafId>:<seq>`,
 *     且 leaf.events 须有匹配的 subagent_spawn event (引擎 L1488 溯源, 无则 E_REVIEW_FORGERY).
 *     subagent 分支禁 reviewer_session_id. commander/auditor 不受影响 (session 分支仍合法).
 *   - 测试机制: injectSubagentSpawn (tamperLeaf push subagent_spawn) + injectReviewRound + leaf set-status done.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 引擎 require ----
const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

// ---- 临时沙箱 (每次运行一个独立目录, 结束清理) ----
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'iss003-review-'));

// ---- mock session verifier (沿用 dbc-spec 占位 UUID 放行策略) ----
engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

// ---- 固定测试 UUID ----
// 注: 引擎强制每棵 tree 内 session_id 唯一 (E_DUPLICATE_SESSION_ID). 这里给每个角色一个独立 UUID,
//     避免同一 session 被 auditor/worker/reviewer 多次注册导致 add 失败.
const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',  // tree init 的 root session + 所有 worker 的 added_by (commander)
  worker:  '00000000-0000-0000-0000-000000000002',  // 被测 worker leaf 的 session (review 校验中 = leaf.session_id)
  auditor: '00000000-0000-0000-0000-000000000003',  // auditor-commander leaf 的 session (互背书环 + audit_gate pass)
  other:   '00000000-0000-0000-0000-000000000004',  // 互背书环的 Oth-commander leaf session
  // 5 个独立 reviewer UUID (用于场景 9 的多 reviewer 合法 review_round)
  rev1:    '00000000-0000-0000-0000-000000000011',
  rev2:    '00000000-0000-0000-0000-000000000012',
  rev3:    '00000000-0000-0000-0000-000000000013',
  rev4:    '00000000-0000-0000-0000-000000000014',
  rev5:    '00000000-0000-0000-0000-000000000015',
};

// ---- run helper ----
async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  return { ok: !!out.ok, error: out.error || null, result: out };
}

// ---- 断言 ----
const stats = { passed: 0, failed: 0, skipped: 0 };
const results = [];
function pass(name, info) { stats.passed++; results.push({ name, status: 'PASS', info }); console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; results.push({ name, status: 'FAIL', info }); console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function skip(name, info) { stats.skipped++; results.push({ name, status: 'SKIP', info }); console.log(`  \x1b[33m-\x1b[0m ${name}  ${info || ''}`); }

async function expectFail(name, cmdArgs, expectedCode) {
  const r = await run(cmdArgs);
  if (r.ok) { fail(name, `期望失败 ${expectedCode}, 但命令成功了`); return r; }
  if (r.error && r.error.code === expectedCode) { pass(name, expectedCode); return r; }
  fail(name, `期望 ${expectedCode}, 实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
  return r;
}
async function expectOk(name, cmdArgs) {
  const r = await run(cmdArgs);
  if (r.ok) { pass(name, 'ok'); return r; }
  fail(name, `期望成功, 实际失败 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
  return r;
}

// ---- 通用 setup helpers (仿 dbc-spec, 简化) ----
let counter = 0;
function freshTreeId() {
  counter++;
  const tid = `trev${counter}`;  // 符合 leaf_id prefix 正则 [a-z][a-z0-9_]{3,7}
  return tid;
}

async function setupTree(budget) {
  const tid = freshTreeId();
  await run(['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'iss003 review gate test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: (budget === undefined ? 20 : budget), max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic',
  ]);
  return { tid };
}

// 初始化 + auditor-commander leaf (互背书环, 让 audit_gate pass 可用)
// 复刻 dbc-spec.setupTreeWithAuditor 的 3-leaf 互背书终态.
async function setupTreeWithAuditor(budget) {
  const { tid } = await setupTree(budget);
  const audLeafId = `${tid}-Aud-commander`;
  const othLeafId = `${tid}-Oth-commander`;
  const rootLeafId = `${tid}-root`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: audLeafId, session_id: UUID.auditor, parent: rootLeafId, path: 'Aud',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })]);
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: othLeafId, session_id: UUID.other, parent: rootLeafId, path: 'Oth',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })]);
  const ts = '2026-07-04T00:00:00Z';
  tamperLeaf(tid, rootLeafId, (l) => {
    l.status = 'done';
    l.events = [{ type: 'done', ts, meta: { self_check: [{ item: 'root_init', pass: true, evidence: 'init' }] } }];
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.auditor, ts };
    l.last_event_ts = ts; l.last_event_type = 'done';
  });
  tamperLeaf(tid, audLeafId, (l) => {
    l.status = 'done';
    l.events = [{ type: 'done', ts, meta: { self_check: [{ item: 'aud_init', pass: true, evidence: 'init' }] } }];
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.other, ts };
    l.last_event_ts = ts; l.last_event_type = 'done';
  });
  tamperLeaf(tid, othLeafId, (l) => {
    l.status = 'done';
    l.events = [{ type: 'done', ts, meta: { self_check: [{ item: 'oth_init', pass: true, evidence: 'init' }] } }];
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.auditor, ts };
    l.last_event_ts = ts; l.last_event_type = 'done';
  });
  return { tid, auditorSession: UUID.auditor };
}

async function addWorker(tid, leafPath, workerSession) {
  const leafId = `${tid}-${leafPath}-worker`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: workerSession || UUID.worker, parent: `${tid}-root`,
    path: leafPath, role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  return leafId;
}

// 直接读改 tree-state.json (绕过 API 注入 review_round / 篡改 audit_meta)
function tamperLeaf(tree_id, leaf_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (state.leaves[leaf_id]) mutateFn(state.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

// 在 deliverables/<rel> 下创建一个非空交付物文件 (满足 A1 文件存在性)
function createDeliverable(tree_id, rel) {
  const dir = path.join(SANDBOX, tree_id, 'deliverables', path.dirname(rel));
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(SANDBOX, tree_id, 'deliverables', rel);
  fs.writeFileSync(fp, 'deliverable content for iss003 test\n');
  return fp;
}

// 配齐 worker done 前置 (除 review 门禁和 audit_gate 外):
//   milestone(audit_pass) + expect_outputs 落盘 + brief_echo + done event.
// opts:
//   reviewRequired: 篡改 leaf.audit_meta.review_required=true (触发 ISS-003 门禁)
//   skipAuditGate:  不设 audit_gate (默认 worker audit_gate=required, done 时会撞 E_GATEKEEPER_REQUIRED)
//   auditorSession: 用于 milestone set-result / audit_gate pass 的独立 auditor
async function prepareWorkerForDone(tid, leafId, opts) {
  opts = opts || {};
  const out = opts.deliverable || 'out.md';
  createDeliverable(tid, out);
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({
    id: 'M1', desc: 'iss003 test', expect_outputs: [out],
  })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', opts.auditorSession || UUID.auditor]);
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json',
    JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: opts.auditorSession || UUID.auditor })]);
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json',
    JSON.stringify({ self_check: [{ item: 'work_done', pass: true, evidence: 'setup for iss003 test gate' }] })]);
  if (opts.reviewRequired) {
    tamperLeaf(tid, leafId, (l) => {
      if (!l.audit_meta) l.audit_meta = {};
      l.audit_meta.review_required = true;
    });
  }
  if (opts.skipAuditGate !== true && opts.auditorSession) {
    await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', opts.auditorSession]);
  }
}

// 构造一条合法 review_round event meta (red=0, converged=true)
// v0.18 (2026-07-16): worker role 禁 session 分支, 默认改走 subagent 分支.
//   默认 reviewer = subagent 分支: reviewer_kind=subagent + reviewer_ref=`sub:${leafId}:01`
//   (调用方须先 injectSubagentSpawn 让 reviewer_ref 可溯源, 否则 E_REVIEW_FORGERY).
//   leafId 必传 (reviewer_ref 父段须 = 本 leaf). reviewerOverrides 可定制 (覆盖默认 reviewers).
function goodReviewRoundMeta(leafId, reviewerOverrides) {
  const reviewers = reviewerOverrides || [{
    perspective: 'G1-correctness',
    reviewer_kind: 'subagent',
    reviewer_ref: `sub:${leafId}:01`,
    findings: [{ severity: 'green', item: 'logic', evidence: 'all paths verified correct' }],
  }];
  return {
    round_no: 1,
    reviewers,
    red_count: 0,
    converged: true,
  };
}

// 注入一条 review_round event 到 leaf.events (用 tamperLeaf, 因为 EVENT_TYPE_ENUM 不含 review_round)
function injectReviewRound(tree_id, leaf_id, meta, roundNo) {
  tamperLeaf(tree_id, leaf_id, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({
      type: 'review_round',
      ts: '2026-07-04T01:00:00Z',
      meta: Object.assign({ round_no: roundNo || 1 }, meta),
    });
  });
}

// 注入一条 subagent_spawn event 到 leaf.events (用 tamperLeaf, 同 injectReviewRound 模式).
// v0.18: done 门禁 validateReviewRoundSchema L1488 会找 type=subagent_spawn 且
//   meta.subagent_id === reviewer_ref 做溯源 (无匹配 → E_REVIEW_FORGERY).
//   subId 形如 `sub:<leafId>:01`, 须与 review_round reviewer.reviewer_ref 一致.
function injectSubagentSpawn(tree_id, leaf_id, subId) {
  tamperLeaf(tree_id, leaf_id, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({
      type: 'subagent_spawn',
      ts: '2026-07-04T00:59:00Z',
      meta: {
        subagent_id: subId,
        role: 'review',
        perspective: 'G1-correctness',
        purpose: 'review',
        output_ref: 'subagent-outputs/x.md',
        status: 'done',
      },
    });
  });
}

// ============================================================
// 测试场景
// ============================================================

// 场景 1: review_required=true + 无 review_round event → E_REVIEW_NOT_CONVERGED
async function case1() {
  console.log('\n[1] review_required=true + 无 review_round → E_REVIEW_NOT_CONVERGED');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C1');
  await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
  await expectFail('1 无 review_round 拦截',
    ['leaf', 'set-status', tid, leafId, 'done'], 'E_REVIEW_NOT_CONVERGED');
}

// 场景 2: review_required=true + 合法 review_round(末轮 red=0) → 通过 review 门禁 → done 成功
async function case2() {
  console.log('\n[2] review_required=true + 合法 review_round(末轮 red=0) → done 成功');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C2');
  await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
  // v0.18: worker 自审走 subagent 分支, 先 spawn SubAgent 再写 review_round
  injectSubagentSpawn(tid, leafId, `sub:${leafId}:01`);
  injectReviewRound(tid, leafId, goodReviewRoundMeta(leafId));
  // 期望完全通过 (audit_gate 也已配齐) → done ok
  await expectOk('2 合法 review_round → done 成功',
    ['leaf', 'set-status', tid, leafId, 'done']);
}

// 场景 3: worker 用 session 分支 (reviewer_session_id=leaf.session_id 自审) → E_REVIEW_SESSION_FORBIDDEN
//   v0.18 (2026-07-16): worker role 禁 session 分支 (无论是否自审), 统一 E_REVIEW_SESSION_FORBIDDEN.
//   自审场景 (reviewer=leaf session) 被 worker session 全禁覆盖, 错码由 E_REVIEW_FORGERY → E_REVIEW_SESSION_FORBIDDEN.
async function case3() {
  console.log('\n[3] worker session 分支 (reviewer=leaf.session_id 自审) → E_REVIEW_SESSION_FORBIDDEN');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C3');
  await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
  // reviewer = worker 自己 session → session 分支 (缺省 reviewer_kind=session), worker role 必被 v0.18 拦
  const meta = goodReviewRoundMeta(leafId, [{
    perspective: 'G1-correctness',
    reviewer_session_id: UUID.worker,  // leaf owner session
    findings: [{ severity: 'green', item: 'x', evidence: 'self review evidence' }],
  }]);
  injectReviewRound(tid, leafId, meta);
  await expectFail('3 worker session 分支 (reviewer=leaf session) 拦截',
    ['leaf', 'set-status', tid, leafId, 'done'], 'E_REVIEW_SESSION_FORBIDDEN');
}

// 场景 4: worker 用 session 分支 (reviewer_session_id=added_by) → E_REVIEW_SESSION_FORBIDDEN
//   v0.18: worker role 禁 session 分支, reviewer=added_by 同样撞 worker session 全禁 (E_REVIEW_FORGERY → E_REVIEW_SESSION_FORBIDDEN).
async function case4() {
  console.log('\n[4] worker session 分支 (reviewer=added_by) → E_REVIEW_SESSION_FORBIDDEN');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C4');
  await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
  // added_by = UUID.root (addWorker 默认). reviewer=root → session 分支, worker role 必被 v0.18 拦
  const meta = goodReviewRoundMeta(leafId, [{
    perspective: 'G1-correctness',
    reviewer_session_id: UUID.root,  // = added_by
    findings: [{ severity: 'green', item: 'x', evidence: 'commander self review' }],
  }]);
  injectReviewRound(tid, leafId, meta);
  await expectFail('4 worker session 分支 (reviewer=added_by) 拦截',
    ['leaf', 'set-status', tid, leafId, 'done'], 'E_REVIEW_SESSION_FORBIDDEN');
}

// 场景 5: subagent 分支 + evidence <10 字 → E_REVIEW_FORGERY
//   v0.18: evidence<10 校验 (L1500) 在 subagent/session 分支后共用, subagent 分支也触发.
async function case5() {
  console.log('\n[5] subagent 分支 + evidence <10 字 → E_REVIEW_FORGERY');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C5');
  await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
  injectSubagentSpawn(tid, leafId, `sub:${leafId}:01`);
  const meta = goodReviewRoundMeta(leafId, [{
    perspective: 'G1-correctness',
    reviewer_kind: 'subagent',
    reviewer_ref: `sub:${leafId}:01`,
    findings: [{ severity: 'green', item: 'x', evidence: 'short' }],  // 5 字 < 10
  }]);
  injectReviewRound(tid, leafId, meta);
  await expectFail('5 subagent 分支 evidence 太短拦截',
    ['leaf', 'set-status', tid, leafId, 'done'], 'E_REVIEW_FORGERY');
}

// 场景 6: subagent 分支 + 末轮 red_count>0 → E_REVIEW_NOT_CONVERGED
//   v0.18: schema 校验放行 (subagent 分支合法), 但 done 门禁收敛校验 (末轮 red>0) 仍拦.
async function case6() {
  console.log('\n[6] subagent 分支 + 末轮 red_count>0 → E_REVIEW_NOT_CONVERGED');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C6');
  await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
  injectSubagentSpawn(tid, leafId, `sub:${leafId}:01`);
  const meta = goodReviewRoundMeta(leafId, [{
    perspective: 'G1-correctness',
    reviewer_kind: 'subagent',
    reviewer_ref: `sub:${leafId}:01`,
    findings: [{ severity: 'red', item: 'critical bug', evidence: 'found a critical defect here' }],
  }]);
  meta.red_count = 1;
  meta.converged = false;
  injectReviewRound(tid, leafId, meta);
  await expectFail('6 subagent 分支末轮 red_count>0 拦截',
    ['leaf', 'set-status', tid, leafId, 'done'], 'E_REVIEW_NOT_CONVERGED');
}

// 场景 7: review_required=false (默认) → 不要求 review, done 通过
async function case7() {
  console.log('\n[7] review_required=false (默认) → 不要求 review, done 通过');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C7');
  // 不篡改 audit_meta.review_required (默认 undefined/false)
  await prepareWorkerForDone(tid, leafId, { auditorSession });  // reviewRequired 不传
  // 无 review_round → 应放行 (因 review_required=false)
  await expectOk('7 默认不要求 review → done 成功',
    ['leaf', 'set-status', tid, leafId, 'done']);
}

// 场景 8: PROMA_REVIEW_DISABLE=1 → 不要求 review (即使 leaf.audit_meta.review_required=true)
async function case8() {
  console.log('\n[8] PROMA_REVIEW_DISABLE=1 → 不要求 review');
  const prev = process.env.PROMA_REVIEW_DISABLE;
  process.env.PROMA_REVIEW_DISABLE = '1';
  try {
    const { tid, auditorSession } = await setupTreeWithAuditor();
    const leafId = await addWorker(tid, 'C8');
    await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
    // 即使 review_required=true, 环境变量禁用 → 放行
    await expectOk('8 PROMA_REVIEW_DISABLE=1 → done 成功 (跳过 review)',
      ['leaf', 'set-status', tid, leafId, 'done']);
  } finally {
    if (prev === undefined) delete process.env.PROMA_REVIEW_DISABLE;
    else process.env.PROMA_REVIEW_DISABLE = prev;
  }
}

// 场景 9: 【已知局限】worker 自写格式完全合法的 review_round (5 个 subagent reviewer, red=0, converged=true)
//   → 期望通过门禁. 内容伪造阶段一不拦, 靠 commander 抽样 + 阶段二 Layer2.
//   v0.18: worker session 分支全禁, 改走 subagent 分支 (每个 reviewer 溯源到一条 subagent_spawn).
async function case9() {
  console.log('\n[9] 【已知局限】worker 自写合法 review_round (5 subagent reviewer, red=0) → 通过门禁');
  console.log('    注: 内容伪造阶段一不拦, 靠 commander 抽样 + 阶段二 Layer2 (findings-文件相关性).');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C9');
  await prepareWorkerForDone(tid, leafId, { reviewRequired: true, auditorSession });
  // 5 个合法 SubAgent reviewer, 全 green 废话 findings, red=0, converged=true
  const refs = ['01', '02', '03', '04', '05'];
  for (const seq of refs) {
    injectSubagentSpawn(tid, leafId, `sub:${leafId}:${seq}`);
  }
  const reviewers = [
    { perspective: 'G1-correctness',  reviewer_kind: 'subagent', reviewer_ref: `sub:${leafId}:01`,
      findings: [{ severity: 'green', item: 'logic', evidence: 'everything looks fine to me here' }] },
    { perspective: 'G2-security',     reviewer_kind: 'subagent', reviewer_ref: `sub:${leafId}:02`,
      findings: [{ severity: 'green', item: 'sec',   evidence: 'no obvious security issues spotted' }] },
    { perspective: 'G3-performance',  reviewer_kind: 'subagent', reviewer_ref: `sub:${leafId}:03`,
      findings: [{ severity: 'green', item: 'perf',  evidence: 'performance seems acceptable overall' }] },
    { perspective: 'G4-readability',  reviewer_kind: 'subagent', reviewer_ref: `sub:${leafId}:04`,
      findings: [{ severity: 'green', item: 'read',  evidence: 'code is reasonably readable to me' }] },
    { perspective: 'G5-edge-case',    reviewer_kind: 'subagent', reviewer_ref: `sub:${leafId}:05`,
      findings: [{ severity: 'green', item: 'edge',  evidence: 'edge cases handled as far as checked' }] },
  ];
  const meta = { round_no: 1, reviewers, red_count: 0, converged: true };
  injectReviewRound(tid, leafId, meta);
  // 期望通过 (阶段一不防内容伪造)
  await expectOk('9 自写合法 review_round → 通过门禁 (阶段一已知局限)',
    ['leaf', 'set-status', tid, leafId, 'done']);
}

// 场景 10: cmdMigrate 规则 11 — done worker leaf 标 grandfathered+flagged
async function case10() {
  console.log('\n[10] cmdMigrate 规则 11: done worker leaf → review_evidence.grandfathered+flagged');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  const leafId = await addWorker(tid, 'C10');
  // 把 worker 做成 done (无 review_evidence, 模拟存量 pre-ISS-003 leaf)
  await prepareWorkerForDone(tid, leafId, { auditorSession });  // 默认 review_required=false
  await run(['leaf', 'set-status', tid, leafId, 'done']);
  // 确认迁移前无 review_evidence
  let statePath = path.join(SANDBOX, tid, 'tree-state.json');
  let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.leaves[leafId].review_evidence !== undefined && state.leaves[leafId].review_evidence !== null) {
    fail('10 迁移前确认无 review_evidence', `实际: ${JSON.stringify(state.leaves[leafId].review_evidence)}`);
    return;
  }
  // ISS-003 v2: migrate rule 11 的 flagged 只在 tree audit_meta.review_required=true 时标.
  //   本场景模拟 nanju 类 opt-in 树 (review_required=true), 期望 grandfathered+flagged.
  //   (未 opt-in 的树 migrate 只标 grandfathered, 不影响下游 — 见场景 10b 之外的契约)
  if (!state.audit_meta) state.audit_meta = {};
  state.audit_meta.review_required = true;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  // 跑 migrate
  const r = await run(['migrate', tid]);
  if (!r.ok) { fail('10 migrate 命令成功', `migrate 失败: ${r.error && r.error.code}`); return; }
  // 验证 review_evidence
  state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const re = state.leaves[leafId].review_evidence;
  if (!re) { fail('10 review_evidence 已设置', '迁移后仍为空'); return; }
  let okG = re.grandfathered === true;
  let okF = re.flagged === true;
  if (okG && okF) {
    pass('10 review_evidence.grandfathered=true + flagged=true',
      `grandfathered=${re.grandfathered}, flagged=${re.flagged}, final_converged=${re.final_converged}`);
  } else {
    fail('10 review_evidence.grandfathered=true + flagged=true',
      `grandfathered=${re.grandfathered}, flagged=${re.flagged}, full=${JSON.stringify(re).slice(0,160)}`);
  }
  // 额外验证: grandfathered 后, 即使设了 review_required=true, isReviewRequired 也应返回 false
  //   (降级纯函数测试, 验证 grandfathered 豁免逻辑)
  if (typeof engine.isReviewRequired === 'function') {
    const fakeLeaf = Object.assign({}, state.leaves[leafId], { audit_meta: { review_required: true } });
    const res = engine.isReviewRequired(fakeLeaf);
    if (res === false) pass('10 [降级纯函数] grandfathered 豁免 isReviewRequired=false', `返回 ${res}`);
    else fail('10 [降级纯函数] grandfathered 豁免 isReviewRequired=false', `返回 ${res} (期望 false)`);
  } else {
    skip('10 [降级纯函数] isReviewRequired 未导出', '');
  }
}

// 场景 11: cmdLeafAdd 父链 flagged — flagged 祖先下创建子 leaf → E_REVIEW_FLAGGED_BLOCK;
//          给祖先补 review_round event 后 → 放行
async function case11() {
  console.log('\n[11] cmdLeafAdd 父链 flagged: 拦截 + 补审放行');
  const { tid, auditorSession } = await setupTreeWithAuditor();
  // 在 root 下加一个 commander leaf, 标记 review_evidence.flagged=true (模拟 migrate 规则11 标记的存量 leaf)
  // 用独立 session UUID.rev1 (避免与 auditor/worker/other 冲突)
  const flaggedCommander = `${tid}-Fcmd-commander`;
  const r0 = await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: flaggedCommander, session_id: UUID.rev1, parent: `${tid}-root`, path: 'Fcmd',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })]);
  if (!r0.ok) { fail('11-a flagged ancestor leaf add 成功', `add 失败: ${r0.error && r0.error.code}: ${r0.error && r0.error.msg}`); return; }
  tamperLeaf(tid, flaggedCommander, (l) => {
    l.review_evidence = {
      grandfathered: true, flagged: true, rounds: [], final_converged: true, total_rounds: 0,
      note: 'simulated pre-ISS-003 flagged ancestor for case 11',
    };
    // 给它补 done 让它符合一个"已 done 的 flagged"语义 (不严格要求, 但贴近真实)
    l.status = 'done';
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.auditor, ts: '2026-07-04T00:00:00Z' };
    l.events = [{ type: 'done', ts: '2026-07-04T00:00:00Z', meta: { self_check: [{ item: 'x', pass: true, evidence: 'flagged ancestor' }] } }];
    l.last_event_ts = '2026-07-04T00:00:00Z';
    l.last_event_type = 'done';
  });

  // (a) 在 flagged 祖先下创建子 worker leaf → 应被拦 (E_REVIEW_FLAGGED_BLOCK)
  // 用独立 session UUID.rev2 (避免冲突)
  await expectFail('11-a flagged 祖先下加子 leaf 拦截',
    ['leaf', 'add', tid, '--json', JSON.stringify({
      leaf_id: `${tid}-Fchild-worker`, session_id: UUID.rev2, parent: flaggedCommander, path: 'Fchild',
      role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.rev1,
    })], 'E_REVIEW_FLAGGED_BLOCK');

  // (b) 给 flagged 祖先补一条 review_round event → 再创建子 leaf 应放行
  // reviewer 用 UUID.auditor (独立于 commander session UUID.rev1 和 added_by UUID.root)
  tamperLeaf(tid, flaggedCommander, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({
      type: 'review_round', ts: '2026-07-04T02:00:00Z',
      meta: {
        round_no: 1,
        reviewers: [{
          perspective: 'G1-correctness',
          reviewer_session_id: UUID.auditor,
          findings: [{ severity: 'green', item: 'review', evidence: 'flagged ancestor backfilled review' }],
        }],
        red_count: 0, converged: true,
      },
    });
    l.last_event_ts = '2026-07-04T02:00:00Z';
    l.last_event_type = 'review_round';
  });
  // 用另一个独立 session UUID.rev3 (rev2 在失败的 add 中可能已被记录)
  await expectOk('11-b 补 review_round 后加子 leaf 放行',
    ['leaf', 'add', tid, '--json', JSON.stringify({
      leaf_id: `${tid}-Fch2-worker`, session_id: UUID.rev3, parent: flaggedCommander, path: 'Fch2',
      role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.rev1,
    })]);
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  console.log('============================================================');
  console.log('iss003-review-gate-test — ISS-003 Review Gate 验收测试');
  console.log('被测引擎: ' + ENGINE_PATH);
  console.log('沙箱: ' + SANDBOX);
  console.log('============================================================');

  // 重置 treesRoot 到我们的临时沙箱 (require 后必须显式注入)
  engine.setTreesRoot(SANDBOX);

  const filter = process.argv.slice(2).filter((a) => !/^--/.test(a));
  const cases = [
    { n: 1, fn: case1 },  { n: 2, fn: case2 },  { n: 3, fn: case3 },
    { n: 4, fn: case4 },  { n: 5, fn: case5 },  { n: 6, fn: case6 },
    { n: 7, fn: case7 },  { n: 8, fn: case8 },  { n: 9, fn: case9 },
    { n: 10, fn: case10 },{ n: 11, fn: case11 },
  ];

  try {
    for (const c of cases) {
      if (filter.length > 0 && !filter.includes(String(c.n))) continue;
      try {
        await c.fn();
      } catch (e) {
        fail(`场景 ${c.n} 异常`, `${e && e.code ? e.code + ': ' : ''}${(e && e.message || String(e)).slice(0, 200)}`);
      }
    }
  } finally {
    // 清理临时沙箱
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m / \x1b[33m跳过 ${stats.skipped}\x1b[0m`);
  console.log('------------------------------------------------------------');
  if (stats.failed > 0) {
    console.log('\n失败用例:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.info}`);
    });
  }
  process.exit(stats.failed > 0 ? 1 : 0);
}

main();
