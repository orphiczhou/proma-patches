#!/usr/bin/env node
/**
 * sprint-v022-yellow-findings-test.cjs — v0.22 Gap A: done event yellow_findings_resolved (2026-07-17)
 *
 * 被测改动 (tree-engine.cjs, v0.22 Gap A, L2379-2415, 照搬 P1b red_findings_resolved 模式):
 *   - cmdEventAppend type=done: 若 leaf 历史 review_round 有 yellow findings（带 finding_id），
 *     meta.yellow_findings_resolved 必填（`[{finding_id, fix_method, fix_evidence ≥20字}]`）。
 *   - fix_method 枚举: edit_file | fixed | downgrade | deferred | accepted。
 *   - 缺失/非数组 → E_SELFCHECK_INVALID；fix_method 非法 → E_SELFCHECK_INVALID；fix_evidence <20字 → E_SELFCHECK_INVALID。
 *   - 向后兼容：无 yellow findings 或 yellow 无 finding_id → yellow_findings_resolved 可省略。
 *
 * 注意：done event 走 cmdEventAppend（append 即校验），不走 set-status done。
 *       所以 expectErr/expectOk 测的是 `event append type=done` 的结果。
 *
 * 测试矩阵:
 *   T1  review_round 有 yellow findings（带 finding_id）+ done 无 yellow_findings_resolved       → E_SELFCHECK_INVALID
 *   T2  review_round 有 yellow findings + done 有 yellow_findings_resolved（deferred, 证据≥20字） → 放行
 *   T3  review_round 有 yellow findings + done yellow_findings_resolved fix_method 非法（bogus）  → E_SELFCHECK_INVALID
 *   T4  review_round 无 yellow findings（全 green / 无 finding_id）+ done 无 yellow_findings_resolved → 放行（向后兼容）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'v022-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  worker: '00000000-0000-0000-0000-000000000101',
};

async function run(caller, cmdArgs) {
  return engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX, caller || null);
}

let counter = 0;
function freshTid() { counter++; return `v22yf${counter}`; }

async function initTree(t) {
  return run(null, ['init', t,
    '--root-brief', JSON.stringify({ parent_intent: 'v0.22 yellow findings test' }),
    '--root-dod', JSON.stringify({ deliverables: [] }),
    '--model', 'glm-5-2', '--channel', 'zlm',
    '--session-id', UUID.root]);
}

async function addWorker(t) {
  return run(UUID.root, ['leaf', 'add', t, '--json', JSON.stringify({
    leaf_id: `${t}-W1-worker`, session_id: UUID.worker, parent: `${t}-root`,
    path: 'W1', role: 'worker', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
  })]);
}

function tamperLeaf(t, leafId, fn) {
  const f = path.join(SANDBOX, t, 'tree-state.json');
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  fn(st.leaves[leafId]);
  fs.writeFileSync(f, JSON.stringify(st));
}

// 注入 review_round event（含 findings）到 leaf.events，模拟历史 review_round。
// 引擎扫描逻辑：events[].type === 'review_round' → .meta.reviewers[].findings[].{severity, finding_id}
function injectReviewRound(t, findings) {
  tamperLeaf(t, `${t}-W1-worker`, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({
      type: 'review_round',
      ts: '2026-07-17T00:00:00Z',
      meta: {
        round_no: 1,
        reviewers: [{
          perspective: 'G1',
          reviewer_kind: 'subagent',
          reviewer_ref: `sub:${t}-W1-worker:01`,
          findings,
        }],
        red_count: 0,
        converged: true,
      },
    });
  });
}

// done event append —— cmdEventAppend 校验 yellow_findings_resolved
function doneEvent(t, extraMeta) {
  return run(UUID.worker, ['event', 'append', t, `${t}-W1-worker`, '--type', 'done', '--json', JSON.stringify({
    self_check: [{ item: 'done', pass: true, evidence: 'worker completed deliverable thoroughly' }],
    ...extraMeta,
  })]);
}

const stats = { passed: 0, failed: 0 };
function pass(n) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
function fail(n, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}  ${info || ''}`); }
async function expectErr(code, n, fn) {
  const r = await fn();
  if (r && r.ok === false && r.error && r.error.code === code) pass(n);
  else fail(n, `期望 ${code}，got ok=${r && r.ok} ${r && r.error && r.error.code} ${(r && r.error && r.error.msg || '').slice(0, 80)}`);
}
async function expectOk(n, fn) {
  const r = await fn();
  if (r && r.ok !== false) pass(n);
  else fail(n, `期望 ok，got ${r && r.error && r.error.code} ${(r && r.error && r.error.msg || '').slice(0, 80)}`);
}

async function main() {
  console.log(`v0.22 yellow findings test — sandbox: ${SANDBOX}`);

  // T1: review_round 有 yellow findings（带 finding_id）+ done 无 yellow_findings_resolved → E_SELFCHECK_INVALID
  {
    const t = freshTid();
    await initTree(t); await addWorker(t);
    injectReviewRound(t, [
      { severity: 'yellow', finding_id: 'Y1', item: 'minor doc gap', evidence: 'minor evidence described here' },
    ]);
    await expectErr('E_SELFCHECK_INVALID', 'T1 yellow findings + done 无 yellow_findings_resolved → 拦（v0.22 核心）',
      () => doneEvent(t, {}));
  }

  // T2: review_round 有 yellow findings + done 有 yellow_findings_resolved（deferred, 证据≥20字）→ 放行
  {
    const t = freshTid();
    await initTree(t); await addWorker(t);
    injectReviewRound(t, [
      { severity: 'yellow', finding_id: 'Y1', item: 'minor doc gap', evidence: 'minor evidence described here' },
    ]);
    await expectOk('T2 yellow findings + done 有 yellow_findings_resolved（deferred）→ 放行',
      () => doneEvent(t, {
        yellow_findings_resolved: [
          { finding_id: 'Y1', fix_method: 'deferred', fix_evidence: 'deferred to S2 because non-blocking polish' },
        ],
      }));
  }

  // T3: review_round 有 yellow findings + done yellow_findings_resolved fix_method 非法（bogus）→ E_SELFCHECK_INVALID
  {
    const t = freshTid();
    await initTree(t); await addWorker(t);
    injectReviewRound(t, [
      { severity: 'yellow', finding_id: 'Y1', item: 'minor doc gap', evidence: 'minor evidence described here' },
    ]);
    await expectErr('E_SELFCHECK_INVALID', 'T3 yellow_findings_resolved fix_method 非法（bogus）→ 拦',
      () => doneEvent(t, {
        yellow_findings_resolved: [
          { finding_id: 'Y1', fix_method: 'bogus', fix_evidence: 'bogus method should be rejected by engine' },
        ],
      }));
  }

  // T4: review_round 无 yellow findings（全 green / 无 finding_id）+ done 无 yellow_findings_resolved → 放行（向后兼容）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t);
    injectReviewRound(t, [
      { severity: 'green', finding_id: 'G1', item: 'all good', evidence: 'green finding no action needed here' },
      { severity: 'yellow', item: 'old style yellow without finding_id', evidence: 'no finding_id means skip' },
    ]);
    await expectOk('T4 review_round 无 yellow finding_id + done 无 yellow_findings_resolved → 放行（向后兼容）',
      () => doneEvent(t, {}));
  }

  console.log(`\n==== ${stats.passed} passed, ${stats.failed} failed ====`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
