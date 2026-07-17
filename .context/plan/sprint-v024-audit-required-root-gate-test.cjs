#!/usr/bin/env node
/**
 * sprint-v024-audit-required-root-gate-test.cjs — v0.24 P1: root done 子 audit_gate=required 硬拦 (2026-07-17)
 *
 * 被测改动 (tree-engine.cjs cmdLeafSetStatus L1779-1793, v0.24 P1):
 *   - root/commander done 门禁在「子 status≠done」校验之后，再加一道：
 *     子（非 auditor role）audit_gate.verdict === 'required' → 抛 E_CHILDREN_NOT_DONE。
 *   - 堵 fix-leaf 教化失效（ns1b + l2t1 实证）：auditor 审 worker 发现 red → audit_gate=required
 *     → root 不能 done（强制 commander 推进 fix + 复审）。
 *   - 跳过条件：role==='auditor'（auditor leaf 自己被 root/上级背书，不查子这一道）；
 *     verdict ∈ {pass, pass_with_minor, skip, null} 全放行（只拦 required）。
 *
 * 测试矩阵:
 *   T1  root 有子 worker(status=done + audit_gate=required) → root done → E_CHILDREN_NOT_DONE（v0.24 新拦）
 *   T2  root 有子 worker(status=done + audit_gate=pass)    → root done → 放行
 *   T3  root 有子 worker(status=done + audit_gate=skip)    → root done → 放行（skip=没审，不拦）
 *   T4  root 有子 auditor(status=done + audit_gate=required, role=auditor)
 *              + 子 worker(status=done + audit_gate=pass)  → root done → 放行（auditor leaf 即使 required 也不查）
 *
 * 参照 sprint-v019-root-children-test.cjs harness（initTree / addWorker / tamperLeaf / rootDoneEvent / rootSetDone）。
 *
 * 构造说明：
 *   - worker.audit_gate=required 通过 tamperLeaf 直接写 state（不能走 set-status done 命令，
 *     cmdLeafSetStatus L1742 通用 audit_gate 门禁会先拦 required）。这是测 root 子门禁，不是测 worker done 门禁，
 *     所以 tamper 构造任意 (status, audit_gate) 组合是正确的测试姿势。
 *   - auditor leaf 同理：audit_gate=required + status=done 通过 tamper 构造（auditor leaf 走 set-status 也会被
 *     L1742 拦；但 v0.24 root 门禁只查 worker 子，auditor 子即使 required 也不查，故 tamper 后 root done 应放行）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'v024-arg-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',
  w1:      '00000000-0000-0000-0000-000000000101',
  auditor: '00000000-0000-0000-0000-000000000a01',
};

async function run(caller, cmdArgs) {
  return engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX, caller || null);
}

let counter = 0;
function freshTid() { counter++; return `v24arg${counter}`; }

async function initTree(t) {
  return run(null, ['init', t,
    '--root-brief', JSON.stringify({ parent_intent: 'v0.24 audit-required root gate test' }),
    '--root-dod', JSON.stringify({ deliverables: [] }),
    '--model', 'glm-5-2', '--channel', 'zlm',
    '--session-id', UUID.root]);
}

async function addWorker(t) {
  return run(UUID.root, ['leaf', 'add', t, '--json', JSON.stringify({
    leaf_id: `${t}-W1-worker`, session_id: UUID.w1, parent: `${t}-root`,
    path: 'W1', role: 'worker', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
  })]);
}

async function addAuditor(t) {
  return run(UUID.root, ['leaf', 'add', t, '--json', JSON.stringify({
    leaf_id: `${t}-A1-auditor`, session_id: UUID.auditor, parent: `${t}-root`,
    path: 'A1', role: 'auditor', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
  })]);
}

async function rootDoneEvent(t) {
  // root 写自己的 done event → 触发 auto_upgrade（audit_gate skip→pass）
  return run(UUID.root, ['event', 'append', t, `${t}-root`, '--type', 'done', '--json', JSON.stringify({
    self_check: [{ item: 'root done', pass: true, evidence: 'root work complete evidence here' }],
  })]);
}

async function rootSetDone(t) {
  return run(UUID.root, ['leaf', 'set-status', t, `${t}-root`, 'done']);
}

// tamperLeaf：直接改 state 构造场景（绕过 worker done 完整流程），聚焦测 v0.24 root 子 audit_gate 门禁。
//   worker/auditor 的 (status=done, audit_gate=任意) 组合不能通过 set-status 命令构造
//   （cmdLeafSetStatus L1742 通用门禁先拦 required），所以测 root 子门禁时必须 tamper 构造子 leaf 状态。
function tamperLeaf(t, leafId, fn) {
  const f = path.join(SANDBOX, t, 'tree-state.json');
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  fn(st.leaves[leafId]);
  fs.writeFileSync(f, JSON.stringify(st));
}

// v0.24 测试核心 helper：构造子 worker 的 (status=done, audit_gate=verdict)。
//   verdict ∈ {'required', 'pass', 'pass_with_minor', 'skip'}；auditor_session_id 用 root 信任锚占位。
function setWorkerDoneGate(t, verdict) {
  tamperLeaf(t, `${t}-W1-worker`, (l) => {
    l.status = 'done';
    l.audit_gate = { verdict, auditor_session_id: UUID.root, ts: '2026-07-17T00:00:00Z' };
  });
}

// T4 专用：构造子 auditor leaf 的 (status=done, audit_gate=required)。
//   auditor leaf 同样被 L1742 通用门禁约束（required 不能 set-status done），故 tamper 构造。
function setAuditorDoneGate(t, verdict) {
  tamperLeaf(t, `${t}-A1-auditor`, (l) => {
    l.status = 'done';
    l.audit_gate = { verdict, auditor_session_id: UUID.root, ts: '2026-07-17T00:00:00Z' };
  });
}

// root done 门禁也校验 milestone 非空 + expect_outputs 非空 + 落盘 deliverables（v0.19 同款）。
// tamper 构造 root milestone + 落盘文件，越过 milestone/deliverables 门禁，聚焦测 v0.24 子 audit_gate 门禁。
function setRootMilestone(t) {
  tamperLeaf(t, `${t}-root`, (l) => {
    l.milestones = [{ id: 'M1', title: 'root skeleton', status: 'done', audit_pass: true, expect_outputs: ['out.md'] }];
  });
  const dir = path.join(SANDBOX, t, 'deliverables');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'out.md'), 'root deliverable for v0.24 test');
}

const stats = { passed: 0, failed: 0 };
function pass(n) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
function fail(n, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}  ${info || ''}`); }
async function expectErr(code, n, fn) {
  const r = await fn();
  if (r && r.ok === false && r.error && r.error.code === code) pass(n);
  else fail(n, `期望 ${code}，got ok=${r && r.ok} ${(r && r.error && r.error.code) || ''}`);
}
async function expectOk(n, fn) {
  const r = await fn();
  if (r && r.ok !== false) pass(n);
  else fail(n, `期望 ok，got ${(r && r.error && r.error.code) || ''}`);
}

async function main() {
  console.log(`v0.24 audit-required root-gate test — sandbox: ${SANDBOX}`);
  console.log(`engine: authority source\n`);

  // T1: root 有子 worker(status=done + audit_gate=required) → root done → E_CHILDREN_NOT_DONE（v0.24 新拦）
  {
    const t = freshTid();
    await initTree(t);
    await addWorker(t);
    setWorkerDoneGate(t, 'required');    // worker done 但 auditor 发现 red 未修 → audit_gate=required
    await rootDoneEvent(t);
    setRootMilestone(t);
    await expectErr('E_CHILDREN_NOT_DONE', 'T1 子 worker audit_gate=required → root done 拦（v0.24 新）',
      () => rootSetDone(t));
  }

  // T2: root 有子 worker(status=done + audit_gate=pass) → root done → 放行
  {
    const t = freshTid();
    await initTree(t);
    await addWorker(t);
    setWorkerDoneGate(t, 'pass');        // auditor 复审 pass
    await rootDoneEvent(t);
    setRootMilestone(t);
    await expectOk('T2 子 worker audit_gate=pass → root done 放行', () => rootSetDone(t));
  }

  // T3: root 有子 worker(status=done + audit_gate=skip) → root done → 放行（skip=没审，不拦）
  {
    const t = freshTid();
    await initTree(t);
    await addWorker(t);
    setWorkerDoneGate(t, 'skip');        // auditor 还没审 → skip，不拦（区别于 required=审了发现 red 未修）
    await rootDoneEvent(t);
    setRootMilestone(t);
    await expectOk('T3 子 worker audit_gate=skip → root done 放行（没审不拦）', () => rootSetDone(t));
  }

  // T4: root 有子 auditor leaf(status=done + audit_gate=required, role=auditor) + 子 worker(status=done + audit_gate=pass)
  //     → root done → 放行（auditor leaf 即使 required 也不查，v0.24 只查非 auditor 子）
  {
    const t = freshTid();
    await initTree(t);
    await addWorker(t);
    await addAuditor(t);
    setWorkerDoneGate(t, 'pass');
    setAuditorDoneGate(t, 'required');  // auditor leaf required，但 role=auditor → v0.24 过滤跳过
    await rootDoneEvent(t);
    setRootMilestone(t);
    await expectOk('T4 子 auditor(required) + 子 worker(pass) → root done 放行（auditor leaf 不查）',
      () => rootSetDone(t));
  }

  console.log(`\n==== ${stats.passed} passed, ${stats.failed} failed ====`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
