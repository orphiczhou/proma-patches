#!/usr/bin/env node
/**
 * sprint-v023-audit-red-recheck-test.cjs — v0.23: audit_gate red 死锁修复 (2026-07-17)
 *
 * 被测改动 (tree-engine.cjs, v0.23):
 *   - cmdAuditGate verdict=pass: red 阈值从扫所有历史 audit_log 改为只看最新一条
 *     `leaf.audit_log[leaf.audit_log.length - 1]`
 *   - 解决 v0.20 E_AUDIT_RED_BLOCKED 死锁：v0.20 扫所有历史 → 旧 red append-only 不可清除
 *     → 真实修复后复审仍被拦（false positive）。
 *   - v0.23: auditor 复审追加新 audit_log entry（无 red）= resolve 旧 red，不再死锁。
 *
 * 测试矩阵:
 *   T1  audit_log 单 entry 有 red                      → E_AUDIT_RED_BLOCKED（最新=red → 拦，同 v0.20）
 *   T2  audit_log 两 entry（entry1 red + entry2 无 red） → 放行（v0.23 修复核心：最新 entry2 无 red = 旧 red resolved by re-audit）
 *   T3  audit_log 两 entry（entry1 无 red + entry2 red） → E_AUDIT_RED_BLOCKED（最新 entry2 red → 拦）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'v023-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  worker: '00000000-0000-0000-0000-000000000101',
};

async function run(caller, cmdArgs) {
  return engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX, caller || null);
}

let counter = 0;
function freshTid() { counter++; return `v23ar${counter}`; }

async function initTree(t) {
  return run(null, ['init', t,
    '--root-brief', JSON.stringify({ parent_intent: 'v0.23 audit red recheck test' }),
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

// 构造 worker 到 audit_gate pass 前置（root 冷启动信任锚当 auditor）
async function prepWorkerForAuditGate(t) {
  const wid = `${t}-W1-worker`;
  // root plan（root events 非空，满足闸门2 对 rootLeaf 要求）
  await run(UUID.root, ['event', 'append', t, `${t}-root`, '--type', 'plan', '--json', JSON.stringify({ plan_id: 'p1' })]);
  // worker brief_echo（复述）
  await run(UUID.worker, ['event', 'append', t, wid, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'w understands' })]);
  // root 回填 alignment（到 worker leaf，V5b 前置）
  await run(UUID.root, ['event', 'append', t, wid, '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '95%', auditor_session_id: UUID.root })]);
  // worker done event（self_check）
  await run(UUID.worker, ['event', 'append', t, wid, '--type', 'done', '--json', JSON.stringify({
    self_check: [{ item: 'done', pass: true, evidence: 'worker completed deliverable thoroughly' }],
  })]);
  // milestone + deliverable 文件（tamper 构造，聚焦测 red 阈值不卡 milestone 门禁）
  tamperLeaf(t, wid, (l) => { l.milestones = [{ id: 'M1', title: 'm', status: 'done', audit_pass: true, expect_outputs: ['out.md'] }]; });
  const dir = path.join(SANDBOX, t, 'deliverables');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'out.md'), 'worker deliverable content');
}

async function auditGatePass(t) {
  return run(UUID.root, ['audit', 'gate', t, `${t}-W1-worker`, '--verdict', 'pass', '--audit-session-id', UUID.root]);
}

// v0.23 核心：构造多条 audit_log entries，模拟多轮复审
//   entriesResults = [[results1], [results2], ...] 每个数组是一轮 audit_log entry 的 results
//   数组顺序 = audit_log 时间顺序（最后一个 = 最新复审）
function setAuditLogMulti(t, entriesResults) {
  tamperLeaf(t, `${t}-W1-worker`, (l) => {
    l.audit_log = entriesResults.map((results, i) => ({
      ts: `2026-07-17T00:0${i}:00:00Z`,
      auditor_session_id: UUID.root,
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      results,
    }));
  });
}

const stats = { passed: 0, failed: 0 };
function pass(n) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
function fail(n, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}  ${info || ''}`); }
async function expectErr(code, n, fn) {
  const r = await fn();
  if (r && r.ok === false && r.error && r.error.code === code) pass(n);
  else fail(n, `期望 ${code}，got ok=${r && r.ok} ${r && r.error && r.error.code} ${(r && r.error && r.error.msg || '').slice(0, 60)}`);
}
async function expectOk(n, fn) {
  const r = await fn();
  if (r && r.ok !== false) pass(n);
  else fail(n, `期望 ok，got ${r && r.error && r.error.code} ${(r && r.error && r.error.msg || '').slice(0, 60)}`);
}

const RED = (item, evidence) => ({ item, pass: false, evidence, severity: 'red' });
const GREEN = (item, evidence) => ({ item, pass: true, evidence, severity: 'green' });

async function main() {
  console.log(`v0.23 audit red recheck (deadlock fix) test — sandbox: ${SANDBOX}`);

  // T1: 单 entry 有 red + audit_gate pass → E_AUDIT_RED_BLOCKED（最新=red → 拦，同 v0.20）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLogMulti(t, [
      [RED('critical security bug', 'auth chain missing evidence here')],
    ]);
    await expectErr('E_AUDIT_RED_BLOCKED', 'T1 单 entry red → 拦（最新=red，同 v0.20）', () => auditGatePass(t));
  }

  // T2: 两 entry（entry1 red + entry2 无 red）→ 放行（v0.23 修复核心：最新 entry2 无 red = 旧 red resolved by re-audit）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLogMulti(t, [
      [RED('critical security bug', 'first audit found auth chain missing evidence here')],
      [GREEN('critical security bug fixed', 're-audit confirms auth chain now has thorough evidence here')],
    ]);
    await expectOk('T2 entry1 red + entry2 无 red → 放行（v0.23 修复核心）', () => auditGatePass(t));
  }

  // T3: 两 entry（entry1 无 red + entry2 red）→ E_AUDIT_RED_BLOCKED（最新 entry2 red → 拦）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLogMulti(t, [
      [GREEN('initial check clean', 'first audit found no red issues, evidence documented here')],
      [RED('newly found critical bug', 'second audit found regression in auth chain, evidence here')],
    ]);
    await expectErr('E_AUDIT_RED_BLOCKED', 'T3 entry1 无 red + entry2 red → 拦（最新=red）', () => auditGatePass(t));
  }

  console.log(`\n==== ${stats.passed} passed, ${stats.failed} failed ====`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
