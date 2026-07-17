#!/usr/bin/env node
/**
 * sprint-v018-worker-session-test.cjs — v0.18: worker role 禁 review_round session 分支 (2026-07-16)
 *
 * 被测改动 (tree-engine.cjs validateReviewRoundSchema, v0.18):
 *   - leaf.role==='worker' && reviewer_kind==='session'(或缺省) → E_REVIEW_SESSION_FORBIDDEN
 *   - 堵 nanju05/v172t 实战：GLM worker 用 session 分支 + 占位/借真合法 v4 UUID 蒙混 review_round（0 subagent_spawn）
 *   - 双校验点自动覆盖：append 时(L2255) + done 门禁(L1706)
 *
 * 测试矩阵:
 *   T1  worker + reviewer_kind=session           → E_REVIEW_SESSION_FORBIDDEN
 *   T2  worker + reviewer_kind 缺省(→session)     → E_REVIEW_SESSION_FORBIDDEN（v172t 场景，关键）
 *   T3  worker + subagent 分支(reviewer_ref 溯源) → 放行（正确路径）
 *   T4  commander + session 分支(role≠worker)     → 放行（边界：非 worker 不受影响）
 *   T5  worker session 撞错后改走 subagent         → 放行（撞错可恢复，引导正确行为）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'v018-ws-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root:         '00000000-0000-0000-0000-000000000001',
  cmdr:         '00000000-0000-0000-0000-000000000002',
  worker:       '00000000-0000-0000-0000-000000000101',
  fakeReviewer: '00000000-0000-0000-0000-000000000099',  // 占位 reviewer session（蒙混用）
};

async function run(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  return engine.run(cmd, args, SANDBOX, caller || null);
}

let counter = 0;
function freshTreeId() { counter++; return `v18ws${counter}`; }

async function initTree(tid, rootSession) {
  const args = ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'v0.18 worker session test' }),
    '--root-dod', JSON.stringify({ deliverables: ['out.md'] }),
    '--model', 'glm-5-2', '--channel', 'zlm',
    '--session-id', rootSession];
  return run(null, args);
}

// leaf_id 格式: <prefix>-<大写PATH段>-<role>，path 参数 = 大写段（参照 sprint5）
async function addLeaf(caller, tid, leaf_id, session_id, parent, role, pathSeg) {
  return run(caller, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id, session_id, parent, path: pathSeg, role, model: 'glm-5-2', channel: 'zlm', added_by: caller,
  })]);
}

async function appendReviewRound(caller, tid, leafId, reviewers) {
  const meta = { round_no: 1, reviewers, red_count: 0, converged: true };
  return run(caller, ['event', 'append', tid, leafId, '--type', 'review_round', '--json', JSON.stringify(meta)]);
}

async function appendSubagentSpawn(caller, tid, leafId, subagentId, perspective, outputRef) {
  return run(caller, ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify({
    subagent_id: subagentId, role: 'review', perspective: perspective || 'G1',
    purpose: 'v0.18 test review', output_ref: outputRef, status: 'done',
  })]);
}

function ensureSubFile(wid) {
  const subDir = path.join(SANDBOX, ...wid.split('-')[0] ? [wid.split('-')[0]] : [], 'deliverables', 'subagent-outputs');
  // wid = <tid>-W1-worker，取 tid 段
  const tid = wid.split('-').slice(0, -2).join('-');
  const dir = path.join(SANDBOX, tid, 'deliverables', 'subagent-outputs');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `sub-${wid}-01.md`;
  fs.writeFileSync(path.join(dir, fname), 'real SubAgent review output content');
  return `subagent-outputs/${fname}`;
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function assert(cond, name, info) { if (cond) pass(name, info); else fail(name, info); }

async function expectErr(code, name, fn) {
  let r;
  try { r = await fn(); } catch (e) { fail(name, `引擎 throw（应返回 result）: ${e && e.code}`); return; }
  if (r && r.ok === false && r.error && r.error.code === code) pass(name);
  else fail(name, `期望 ${code}，got ok=${r && r.ok} err=${r && r.error && r.error.code}`);
}
async function expectOk(name, fn) {
  let r;
  try { r = await fn(); } catch (e) { fail(name, `应放行但引擎 throw: ${e && e.code}`); return; }
  if (r && r.ok !== false) pass(name);
  else fail(name, `期望 ok，got err=${r && r.error && r.error.code}`);
}

function findingGreen() { return { severity: 'green', item: '内容合格', evidence: 'test evidence sufficiently long' }; }

async function main() {
  console.log(`v0.18 worker session forbidden test — sandbox: ${SANDBOX}`);
  console.log(`engine: authority source (D:/codes/tree-harness/tree-engine.cjs)\n`);

  // T1: worker + reviewer_kind=session → E_REVIEW_SESSION_FORBIDDEN
  {
    const tid = freshTreeId();
    await initTree(tid, UUID.root);
    const wid = `${tid}-W1-worker`;
    await addLeaf(UUID.root, tid, wid, UUID.worker, `${tid}-root`, 'worker', 'W1');
    await expectErr('E_REVIEW_SESSION_FORBIDDEN', 'T1 worker session 分支被拦',
      () => appendReviewRound(UUID.worker, tid, wid, [
        { perspective: 'G1', reviewer_kind: 'session', reviewer_session_id: UUID.fakeReviewer, findings: [findingGreen()] },
      ]));
  }

  // T2: worker + reviewer_kind 缺省（→session）→ E_REVIEW_SESSION_FORBIDDEN（v172t 场景，关键）
  {
    const tid = freshTreeId();
    await initTree(tid, UUID.root);
    const wid = `${tid}-W1-worker`;
    await addLeaf(UUID.root, tid, wid, UUID.worker, `${tid}-root`, 'worker', 'W1');
    await expectErr('E_REVIEW_SESSION_FORBIDDEN', 'T2 worker 缺省走 session 被拦（v172t 场景）',
      () => appendReviewRound(UUID.worker, tid, wid, [
        { perspective: 'G1', reviewer_session_id: UUID.fakeReviewer, findings: [findingGreen()] }, // 无 reviewer_kind → 缺省 session
      ]));
  }

  // T3: worker + subagent 分支（reviewer_ref 溯源 subagent_spawn）→ 放行
  {
    const tid = freshTreeId();
    await initTree(tid, UUID.root);
    const wid = `${tid}-W1-worker`;
    await addLeaf(UUID.root, tid, wid, UUID.worker, `${tid}-root`, 'worker', 'W1');
    const outRef = ensureSubFile(wid);
    await expectOk('T3a worker append subagent_spawn',
      () => appendSubagentSpawn(UUID.worker, tid, wid, `sub:${wid}:01`, 'G1', outRef));
    await expectOk('T3b worker subagent 分支（reviewer_ref 溯源）放行',
      () => appendReviewRound(UUID.worker, tid, wid, [
        { perspective: 'G1', reviewer_kind: 'subagent', reviewer_ref: `sub:${wid}:01`, findings: [findingGreen()] },
      ]));
  }

  // T4: commander + session 分支（role≠worker）→ 放行（边界：非 worker 不受影响）
  {
    const tid = freshTreeId();
    await initTree(tid, UUID.root);
    const cid = `${tid}-C1-commander`;
    await addLeaf(UUID.root, tid, cid, UUID.cmdr, `${tid}-root`, 'commander', 'C1');
    await expectOk('T4 commander session 分支放行（role≠worker）',
      () => appendReviewRound(UUID.cmdr, tid, cid, [
        { perspective: 'G1', reviewer_kind: 'session', reviewer_session_id: UUID.fakeReviewer, findings: [findingGreen()] },
      ]));
  }

  // T5: worker session 撞错后改走 subagent → 放行（撞错可恢复，引导正确行为）
  {
    const tid = freshTreeId();
    await initTree(tid, UUID.root);
    const wid = `${tid}-W1-worker`;
    await addLeaf(UUID.root, tid, wid, UUID.worker, `${tid}-root`, 'worker', 'W1');
    await expectErr('E_REVIEW_SESSION_FORBIDDEN', 'T5a worker 先撞 session 分支',
      () => appendReviewRound(UUID.worker, tid, wid, [
        { perspective: 'G1', reviewer_kind: 'session', reviewer_session_id: UUID.fakeReviewer, findings: [findingGreen()] },
      ]));
    const outRef = ensureSubFile(wid);
    await expectOk('T5b worker append subagent_spawn（改走 subagent）',
      () => appendSubagentSpawn(UUID.worker, tid, wid, `sub:${wid}:01`, 'G1', outRef));
    await expectOk('T5c worker subagent 分支放行（撞错恢复）',
      () => appendReviewRound(UUID.worker, tid, wid, [
        { perspective: 'G1', reviewer_kind: 'subagent', reviewer_ref: `sub:${wid}:01`, findings: [findingGreen()] },
      ]));
  }

  console.log(`\n==== ${stats.passed} passed, ${stats.failed} failed ====`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
