#!/usr/bin/env node
/**
 * sprint-v020-audit-red-test.cjs — v0.20: audit_gate red severity 阈值 (2026-07-17)
 *
 * 被测改动 (tree-engine.cjs, v0.20):
 *   - cmdAuditAppend: results[i].severity 可选（red|yellow|green），向后兼容旧 audit_log 无 severity
 *   - cmdAuditGate verdict=pass: 扫描 leaf.audit_log，有 severity=red → E_AUDIT_RED_BLOCKED
 *   - 堵 v20t 教训：GLM auditor 发现 mid 安全问题却 verdict=pass（偏松）。引擎兜底 red（critical）阻断。
 *
 * 测试矩阵:
 *   T1  audit_log results severity=red + audit_gate pass    → E_AUDIT_RED_BLOCKED
 *   T2  audit_log results severity=yellow + audit_gate pass → 放行（mid 由 SKILL 加权，引擎只兜 red）
 *   T3  audit_log results 无 severity（旧）+ audit_gate pass → 放行（向后兼容）
 *   T4  audit_append severity 非法（blue）                  → E_SCHEMA_INVALID
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'v020-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  worker: '00000000-0000-0000-0000-000000000101',
};

async function run(caller, cmdArgs) {
  return engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX, caller || null);
}

let counter = 0;
function freshTid() { counter++; return `v20ar${counter}`; }

async function initTree(t) {
  return run(null, ['init', t,
    '--root-brief', JSON.stringify({ parent_intent: 'v0.20 audit red test' }),
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

function setAuditLog(t, results) {
  tamperLeaf(t, `${t}-W1-worker`, (l) => {
    l.audit_log = [{
      ts: '2026-07-17T00:00:00Z',
      auditor_session_id: UUID.root,
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).length,
      results,
    }];
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

async function main() {
  console.log(`v0.20 audit red threshold test — sandbox: ${SANDBOX}`);

  // T1: audit_log red + audit_gate pass → E_AUDIT_RED_BLOCKED
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLog(t, [{ item: 'critical security bug', pass: false, evidence: 'auth chain missing evidence here', severity: 'red' }]);
    await expectErr('E_AUDIT_RED_BLOCKED', 'T1 audit_log red → audit_gate pass 拦（v0.20 核心）', () => auditGatePass(t));
  }

  // T2: audit_log yellow + audit_gate pass → 放行（mid 由 SKILL 加权，引擎只兜 red）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLog(t, [{ item: 'minor issue', pass: false, evidence: 'minor evidence described here', severity: 'yellow' }]);
    await expectOk('T2 audit_log yellow → 放行（引擎只兜 red）', () => auditGatePass(t));
  }

  // T3: audit_log 无 severity（旧）+ audit_gate pass → 放行（向后兼容）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLog(t, [{ item: 'old style', pass: false, evidence: 'old evidence no severity field' }]);
    await expectOk('T3 audit_log 无 severity（旧）→ 放行（向后兼容）', () => auditGatePass(t));
  }

  // T4: audit_append severity 非法（blue）→ E_SCHEMA_INVALID
  {
    const t = freshTid();
    await initTree(t); await addWorker(t);
    await expectErr('E_SCHEMA_INVALID', 'T4 audit_append severity 非法（blue）→ 拦',
      () => run(UUID.root, ['audit', 'append', t, `${t}-W1-worker`, '--json', JSON.stringify({
        auditor_session_id: UUID.root, total: 1, passed: 0, failed: 1,
        results: [{ item: 'x', pass: false, evidence: 'evidence here', severity: 'blue' }],
      })]));
  }

  console.log(`\n==== ${stats.passed} passed, ${stats.failed} failed ====`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
