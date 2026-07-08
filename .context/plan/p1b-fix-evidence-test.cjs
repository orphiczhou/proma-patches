#!/usr/bin/env node
/**
 * p1b-fix-evidence-test.cjs — Tree Harness P1b 机制交叉验证 (2026-07-08)
 *
 * 被测改动 (tree-engine.cjs, P1b):
 *   - validateReviewRoundSchema findings[].finding_id 可选 (L1363): 若存在必须是非空字符串, 否则 E_REVIEW_FORGERY.
 *   - cmdEventAppend type=done 时 self_check 校验后 (L2109+) 做 red_findings_resolved 跨事件关联:
 *       收集 leaf 历史所有 review_round events 中 severity=red 且带 finding_id 的 id 集合 _redIds.
 *       若 _redIds.size>0: meta.red_findings_resolved 必须是数组, 每项 {finding_id, fix_method, fix_evidence}:
 *         - finding_id 非空字符串, 必须覆盖所有 _redIds
 *         - fix_method ∈ edit_file|downgrade|other
 *         - fix_evidence ≥20 字
 *       若 _redIds.size===0 (无 review_round 或 red findings 无 finding_id): red_findings_resolved 可省略.
 *     违例抛 E_SELFCHECK_INVALID. finding_id 格式错抛 E_REVIEW_FORGERY (走 review_round schema 校验).
 *
 * 测试方法: 独立沙箱, 每个场景独立小树互不污染. 落真实非空文件 (fs.writeFileSync), 不 mock.
 *   按 spec 写期望, 跑实际引擎, 诚实报 pass/fail. 失败不迁就引擎, 报上来让主会话判断.
 *
 * Harness 模式复用自 subagent-lifecycle-test.cjs / auditor-role-test.cjs:
 *   - require(ENGINE_PATH); engine.setTreesRoot(SANDBOX); engine.setSessionVerifier(mock)
 *   - engine.run(cmd, args, treesRoot?, callerSessionId?) 永不 throw, 返回 {ok:true}|{ok:false,error:{code,msg}}
 *   - tamperLeaf 直接读改 tree-state.json (绕过 API 注入 review_round event)
 *   - expectOk / expectFail 断言 + pass/fail 计数 + 末尾总结
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

// 临时沙箱 (独立目录, 结束清理)
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p1b-fixev-'));
engine.setTreesRoot(SANDBOX);

// mock session verifier (沿用占位 UUID 放行策略, 与 subagent-lifecycle-test 一致)
engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

// 固定测试 UUID (每棵 tree 内 session_id 唯一)
const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',  // tree init root + added_by
  worker:  '00000000-0000-0000-0000-000000000002',  // worker leaf session
  auditor: '00000000-0000-0000-0000-000000000003',  // milestone/audit_gate auditor
  rev1:    '00000000-0000-0000-0000-000000000011',  // 独立 reviewer
};

// ============================================================
// run helper
// ============================================================
async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX);
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

// ============================================================
// 通用 setup helpers
// ============================================================
let counter = 0;
function freshTreeId() {
  counter++;
  return `p1bt${counter}`;  // leaf_id prefix 正则 [a-z][a-z0-9_]{3,7} ('p1bt'+数字, 注意别超长)
}

async function initTree(tid) {
  return run(['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'p1b fix evidence test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic',
  ]);
}

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

// 直接读改 tree-state.json (绕过 API 注入 review_round event)
function tamperLeaf(tree_id, leaf_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (state.leaves[leaf_id]) mutateFn(state.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

// 落非空产物到 deliverables/<rel>
function createDeliverable(tree_id, rel, content) {
  const fp = path.join(SANDBOX, tree_id, 'deliverables', rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content || 'non-empty p1b test deliverable\n');
  return fp;
}

// 构造合法 subagent_spawn meta (默认 done + role=review + perspective=G1)
function spawnMeta(leafId, seq, overrides) {
  const base = {
    subagent_id: `sub:${leafId}:${seq}`,
    role: 'review',
    perspective: 'G1-correctness',
    purpose: 'review worker deliverable for correctness',
    output_ref: `subagent-outputs/${leafId}-${seq}.md`,
    status: 'done',
  };
  return Object.assign({}, base, overrides || {});
}

// injectReviewRound: tamperLeaf 注入一条 review_round event.
//   findings 数组每项形如 {item, severity, evidence, finding_id?}.
//   red_count 自动按 severity=red 计数 (防手算错), converged 由调用方给.
function injectReviewRound(tid, leafId, reviewers, converged) {
  let redCount = 0;
  for (const rv of reviewers) {
    for (const f of (rv.findings || [])) {
      if (f.severity === 'red') redCount++;
    }
  }
  tamperLeaf(tid, leafId, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({
      type: 'review_round',
      ts: '2026-07-08T02:00:00Z',
      meta: {
        round_no: 1,
        reviewers,
        red_count: redCount,
        converged: (converged === undefined ? true : converged),
      },
    });
  });
}

// appendDoneEvent: 调 event append --type done, 传 self_check + 可选 red_findings_resolved.
//   selfCheckItems 形如 [{item, pass, evidence}]. rfr 可省略 (无 red history 时).
async function appendDoneEvent(tid, leafId, selfCheckItems, rfr) {
  const meta = { self_check: selfCheckItems };
  if (rfr !== undefined) meta.red_findings_resolved = rfr;
  return run(['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify(meta)]);
}

// 合法 self_check (1 项 pass=true, evidence ≥10 字) — done event 前置 self_check 校验用
function legalSelfCheck(evidence) {
  return [{ item: 'work_done', pass: true, evidence: evidence || 'p1b worker done self check ok' }];
}

// 合法 finding (severity green, evidence ≥10 字)
function greenFinding(item, evidence, findingId) {
  const f = { item: item || 'logic', severity: 'green', evidence: evidence || 'all paths verified correct here' };
  if (findingId !== undefined) f.finding_id = findingId;
  return f;
}
// red finding (evidence ≥10 字)
function redFinding(item, evidence, findingId) {
  const f = { item: item || 'logic', severity: 'red', evidence: evidence || 'red issue found in logic path' };
  if (findingId !== undefined) f.finding_id = findingId;
  return f;
}

// ============================================================
// 测试场景
// ============================================================

// Case 1: review_round findings 带 finding_id (合法) → done event append ok
//   tamperLeaf 注入 review_round (findings 含 finding_id:'F01', severity green, red_count:0, converged:true)
//   done event --json {self_check:[...]} (无 red, red_findings_resolved 可省略)
//   期望 ok (finding_id 存在且合法)
async function case1_finding_id_legal() {
  console.log('\n[1] review_round findings 带 finding_id (合法) → done append ok');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C1');
  // 注入 review_round: green finding 带 finding_id:'F01' (无 red, red_findings_resolved 可省略)
  injectReviewRound(tid, leafId, [{
    perspective: 'G1-correctness',
    reviewer_session_id: UUID.rev1,  // session 缺省路径, ≠owner≠added_by
    findings: [greenFinding('logic', 'all paths verified correct', 'F01')],
  }], true);
  await expectOk('1 review_round finding_id 合法 + done (无 red) → ok',
    ['event', 'append', tid, leafId, '--type', 'done', '--json',
      JSON.stringify({ self_check: legalSelfCheck() })]);
}

// Case 2: review_round finding_id 非字符串 (数字 123) → E_REVIEW_FORGERY
//   走 event append --type review_round (append 时即校验, subagent-lifecycle-test Case 14 实证)
//   前置: 先 append 合法 subagent_spawn (让 reviewer_ref 溯源通过)
async function case2_finding_id_non_string() {
  console.log('\n[2] review_round finding_id 非字符串 → E_REVIEW_FORGERY (append 即拒)');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C2');
  // 先 append 合法 subagent_spawn (让 reviewer_ref 溯源通过)
  const sm = spawnMeta(leafId, 1);
  createDeliverable(tid, sm.output_ref, 'c2 subagent review report\n');
  await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
  // review_round findings 含 finding_id:123 (数字, 非法)
  const rrMeta = {
    round_no: 1,
    reviewers: [{
      perspective: 'G1-correctness',
      reviewer_kind: 'subagent',
      reviewer_ref: sm.subagent_id,  // sub:<leafId>:1, 与 spawn 匹配
      findings: [{ item: 'logic', severity: 'green', evidence: 'c2 finding_id non-string test', finding_id: 123 }],
    }],
    red_count: 0,
    converged: true,
    independence: 'self_delegated',
  };
  await expectFail('2 review_round finding_id 非字符串 (123) → E_REVIEW_FORGERY (append 即拒)',
    ['event', 'append', tid, leafId, '--type', 'review_round', '--json', JSON.stringify(rrMeta)],
    'E_REVIEW_FORGERY');
}

// Case 3: done event 有历史 red findings (带 finding_id) 但缺 red_findings_resolved → E_SELFCHECK_INVALID
//   tamperLeaf 注入 review_round (findings 含 {severity:'red', finding_id:'F01'}, red_count:1, converged:false)
//   done event --json {self_check:[...]} (缺 red_findings_resolved)
//   期望 E_SELFCHECK_INVALID (有 red finding_id 但缺 red_findings_resolved)
async function case3_red_missing_rfr() {
  console.log('\n[3] done event 有历史 red findings 但缺 red_findings_resolved → E_SELFCHECK_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C3');
  // 注入 review_round: red finding 带 finding_id:'F01'
  injectReviewRound(tid, leafId, [{
    perspective: 'G1-correctness',
    reviewer_session_id: UUID.rev1,
    findings: [redFinding('logic', 'red logic gap in module X', 'F01')],
  }], false);  // red_count=1, converged=false
  // done event 缺 red_findings_resolved
  await expectFail('3 done 缺 red_findings_resolved (有 red F01) → E_SELFCHECK_INVALID',
    ['event', 'append', tid, leafId, '--type', 'done', '--json',
      JSON.stringify({ self_check: legalSelfCheck() })],
    'E_SELFCHECK_INVALID');
}

// Case 4: done event red_findings_resolved 覆盖所有 red finding_id → ok
//   Case 3 基础上, done event --json 加 red_findings_resolved:[{finding_id:'F01', fix_method:'edit_file', fix_evidence:'≥20字'}]
//   期望 ok
async function case4_rfr_covers_all() {
  console.log('\n[4] done event red_findings_resolved 覆盖所有 red finding_id → ok');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C4');
  injectReviewRound(tid, leafId, [{
    perspective: 'G1-correctness',
    reviewer_session_id: UUID.rev1,
    findings: [redFinding('logic', 'red logic gap in module X', 'F01')],
  }], false);
  await expectOk('4 red_findings_resolved 覆盖 F01 (edit_file, ≥20字) → ok',
    ['event', 'append', tid, leafId, '--type', 'done', '--json',
      JSON.stringify({
        self_check: legalSelfCheck(),
        red_findings_resolved: [{
          finding_id: 'F01',
          fix_method: 'edit_file',
          fix_evidence: '已修复 module X 的逻辑缺口 diff 见 commit abc123',
        }],
      })]);
}

// Case 5: done event red_findings_resolved 缺某个 red finding_id → E_SELFCHECK_INVALID
//   tamperLeaf 注入 review_round 含 2 个 red (F01, F02)
//   done event --json red_findings_resolved:[{finding_id:'F01', ...}] (缺 F02)
//   期望 E_SELFCHECK_INVALID (F02 未 resolve)
async function case5_rfr_missing_one() {
  console.log('\n[5] done event red_findings_resolved 缺某个 red finding_id → E_SELFCHECK_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C5');
  injectReviewRound(tid, leafId, [{
    perspective: 'G1-correctness',
    reviewer_session_id: UUID.rev1,
    findings: [
      redFinding('logic', 'red logic gap in module X', 'F01'),
      redFinding('safety', 'red safety issue in parser', 'F02'),
    ],
  }], false);  // red_count=2, converged=false
  // done event 只 resolve F01, 缺 F02
  await expectFail('5 red_findings_resolved 缺 F02 → E_SELFCHECK_INVALID',
    ['event', 'append', tid, leafId, '--type', 'done', '--json',
      JSON.stringify({
        self_check: legalSelfCheck(),
        red_findings_resolved: [{
          finding_id: 'F01',
          fix_method: 'edit_file',
          fix_evidence: '已修复 module X 的逻辑缺口 diff 见 commit abc123',
        }],
      })],
    'E_SELFCHECK_INVALID');
}

// Case 6: done event red_findings_resolved fix_evidence <20字 → E_SELFCHECK_INVALID
//   tamperLeaf 注入 review_round 含 red F01
//   done event --json red_findings_resolved:[{finding_id:'F01', fix_method:'edit_file', fix_evidence:'短'}] (<20字)
//   期望 E_SELFCHECK_INVALID
async function case6_rfr_fix_evidence_too_short() {
  console.log('\n[6] done event red_findings_resolved fix_evidence <20字 → E_SELFCHECK_INVALID');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C6');
  injectReviewRound(tid, leafId, [{
    perspective: 'G1-correctness',
    reviewer_session_id: UUID.rev1,
    findings: [redFinding('logic', 'red logic gap in module X', 'F01')],
  }], false);
  await expectFail('6 red_findings_resolved fix_evidence <20字 → E_SELFCHECK_INVALID',
    ['event', 'append', tid, leafId, '--type', 'done', '--json',
      JSON.stringify({
        self_check: legalSelfCheck(),
        red_findings_resolved: [{
          finding_id: 'F01',
          fix_method: 'edit_file',
          fix_evidence: '修好了',  // 3 字 <20
        }],
      })],
    'E_SELFCHECK_INVALID');
}

// Case 7: 无历史 red findings (review_round 无 red 或 red 无 finding_id) → red_findings_resolved 可省略 ok
//   tamperLeaf 注入 review_round (findings 全 green, 或 red 无 finding_id)
//   done event --json {self_check:[...]} (无 red_findings_resolved)
//   期望 ok (向后兼容)
async function case7_no_red_id_rfr_omittable() {
  console.log('\n[7] 无历史 red findings (或 red 无 finding_id) → red_findings_resolved 可省略 ok');
  // (a) 全 green findings
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C7a');
    injectReviewRound(tid, leafId, [{
      perspective: 'G1-correctness',
      reviewer_session_id: UUID.rev1,
      findings: [greenFinding('logic', 'all green paths verified correct')],
    }], true);  // red_count=0, converged=true
    await expectOk('7a 全 green findings + done 无 rfr → ok (向后兼容)',
      ['event', 'append', tid, leafId, '--type', 'done', '--json',
        JSON.stringify({ self_check: legalSelfCheck() })]);
  }
  // (b) red finding 但无 finding_id (老格式, 向后兼容)
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C7b');
    injectReviewRound(tid, leafId, [{
      perspective: 'G1-correctness',
      reviewer_session_id: UUID.rev1,
      findings: [redFinding('logic', 'red logic gap but no finding_id')],  // 无 finding_id
    }], false);  // red_count=1, converged=false
    await expectOk('7b red 无 finding_id + done 无 rfr → ok (向后兼容, red_findings_resolved 可省略)',
      ['event', 'append', tid, leafId, '--type', 'done', '--json',
        JSON.stringify({ self_check: legalSelfCheck() })]);
  }
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  console.log('============================================================');
  console.log('p1b-fix-evidence-test — P1b red_findings_resolved 跨事件关联校验');
  console.log('被测引擎: ' + ENGINE_PATH);
  console.log('沙箱: ' + SANDBOX);
  console.log('============================================================');

  const cases = [
    { n: 1, fn: case1_finding_id_legal },
    { n: 2, fn: case2_finding_id_non_string },
    { n: 3, fn: case3_red_missing_rfr },
    { n: 4, fn: case4_rfr_covers_all },
    { n: 5, fn: case5_rfr_missing_one },
    { n: 6, fn: case6_rfr_fix_evidence_too_short },
    { n: 7, fn: case7_no_red_id_rfr_omittable },
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
