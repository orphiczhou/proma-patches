#!/usr/bin/env node
/**
 * sprint-v021-audit-pass-with-minor-test.cjs — v0.21: audit_gate pass_with_minor + severity 必填 (2026-07-17)
 *
 * 被测改动 (tree-engine.cjs, v0.21):
 *   - verdict 枚举加 pass_with_minor（cmdAuditGate L3213）
 *   - isPassVerdict helper（L3200）：pass + pass_with_minor 都当放行
 *   - 6 处 === 'pass' 改 isPassVerdict（done 门禁 / V10-auditor-active / validate / 独立性 / done event + red 阈值外层）
 *   - cmdAuditAppend results[] severity 必填（v0.20 可选→必填 red|yellow|green）
 *   - audit_append 报错一次性 schema
 *
 * 测试矩阵:
 *   T1  audit_gate verdict=pass_with_minor                    → 枚举接受（非 E_SCHEMA_INVALID）
 *   T2  audit_log yellow + audit_gate pass_with_minor         → 放行（isPassVerdict，red 阈值不拦 yellow）
 *   T3  cmdAuditAppend results 无 severity                    → E_SCHEMA_INVALID（v0.21 必填）
 *   T4  audit_log red + audit_gate pass_with_minor            → E_AUDIT_RED_BLOCKED（v0.20 red 阈值含 pass_with_minor）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'v021-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  worker: '00000000-0000-0000-0000-000000000101',
};

async function run(caller, cmdArgs) {
  return engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX, caller || null);
}

let counter = 0;
function freshTid() { counter++; return `v21t${counter}`; }

async function initTree(t) {
  return run(null, ['init', t,
    '--root-brief', JSON.stringify({ parent_intent: 'v0.21 pass_with_minor test' }),
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

async function prepWorkerForAuditGate(t) {
  const wid = `${t}-W1-worker`;
  await run(UUID.root, ['event', 'append', t, `${t}-root`, '--type', 'plan', '--json', JSON.stringify({ plan_id: 'p1' })]);
  await run(UUID.worker, ['event', 'append', t, wid, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'w' })]);
  await run(UUID.root, ['event', 'append', t, wid, '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '95%', auditor_session_id: UUID.root })]);
  await run(UUID.worker, ['event', 'append', t, wid, '--type', 'done', '--json', JSON.stringify({
    self_check: [{ item: 'done', pass: true, evidence: 'worker completed deliverable thoroughly' }],
  })]);
  tamperLeaf(t, wid, (l) => { l.milestones = [{ id: 'M1', title: 'm', status: 'done', audit_pass: true, expect_outputs: ['out.md'] }]; });
  const dir = path.join(SANDBOX, t, 'deliverables');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'out.md'), 'worker deliverable content');
}

async function auditGate(t, verdict) {
  return run(UUID.root, ['audit', 'gate', t, `${t}-W1-worker`, '--verdict', verdict, '--audit-session-id', UUID.root]);
}

function setAuditLog(t, results) {
  tamperLeaf(t, `${t}-W1-worker`, (l) => {
    l.audit_log = [{
      ts: '2026-07-17T00:00:00Z', auditor_session_id: UUID.root,
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
  console.log(`v0.21 pass_with_minor test — sandbox: ${SANDBOX}`);

  // T1: audit_gate verdict=pass_with_minor 枚举接受
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLog(t, [{ item: 'minor', pass: false, evidence: 'minor evidence described here', severity: 'yellow' }]);
    await expectOk('T1 audit_gate pass_with_minor 枚举接受（非 E_SCHEMA_INVALID）', () => auditGate(t, 'pass_with_minor'));
  }

  // T2: audit_log yellow + pass_with_minor → 放行（red 阈值不拦 yellow）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLog(t, [{ item: 'mid safety', pass: false, evidence: 'cwe-204 info leak evidence here', severity: 'yellow' }]);
    await expectOk('T2 yellow + pass_with_minor → 放行（mid 安全，引擎只兜 red）', () => auditGate(t, 'pass_with_minor'));
  }

  // T3: cmdAuditAppend results 无 severity → E_SCHEMA_INVALID（v0.21 必填）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t);
    await expectErr('E_SCHEMA_INVALID', 'T3 audit_append 无 severity → 拦（v0.21 必填）',
      () => run(UUID.root, ['audit', 'append', t, `${t}-W1-worker`, '--json', JSON.stringify({
        auditor_session_id: UUID.root, total: 1, passed: 0, failed: 1,
        results: [{ item: 'x', pass: false, evidence: 'evidence here no severity' }],
      })]));
  }

  // T4: audit_log red + pass_with_minor → E_AUDIT_RED_BLOCKED（v0.20 red 阈值含 pass_with_minor）
  {
    const t = freshTid();
    await initTree(t); await addWorker(t); await prepWorkerForAuditGate(t);
    setAuditLog(t, [{ item: 'critical', pass: false, evidence: 'critical security bug evidence here', severity: 'red' }]);
    await expectErr('E_AUDIT_RED_BLOCKED', 'T4 red + pass_with_minor → 拦（red 阈值含 pass_with_minor）', () => auditGate(t, 'pass_with_minor'));
  }

  console.log(`\n==== ${stats.passed} passed, ${stats.failed} failed ====`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
