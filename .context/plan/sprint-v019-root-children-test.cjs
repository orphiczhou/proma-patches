#!/usr/bin/env node
/**
 * sprint-v019-root-children-test.cjs — v0.19: root done 须子 done (2026-07-16)
 *
 * 被测改动 (tree-engine.cjs cmdLeafSetStatus L1762, v0.19):
 *   - E_CHILDREN_NOT_DONE 校验从 `role==='commander'` 扩到 `|| role==='root'`
 *   - 堵 v0.18 实战 v18t 暴露：commander(role=root) 提前 root done 放弃子任务
 *
 * 测试矩阵:
 *   T1  root 有子 worker(未 done) → root set-status done → E_CHILDREN_NOT_DONE
 *   T2  root 有子 worker(done)    → root set-status done → 放行
 *   T3  root 无子                  → root set-status done → 放行（不误伤单 root 树，关键边界）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'v019-rc-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root: '00000000-0000-0000-0000-000000000001',
  w1:   '00000000-0000-0000-0000-000000000101',
};

async function run(caller, cmdArgs) {
  return engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX, caller || null);
}

let counter = 0;
function freshTid() { counter++; return `v19rc${counter}`; }

async function initTree(t) {
  return run(null, ['init', t,
    '--root-brief', JSON.stringify({ parent_intent: 'v0.19 root-children test' }),
    '--root-dod', JSON.stringify({ deliverables: [] }),
    '--model', 'glm-5-2', '--channel', 'zlm',
    '--session-id', UUID.root]);
}

async function addWorker(t, suffix, session) {
  return run(UUID.root, ['leaf', 'add', t, '--json', JSON.stringify({
    leaf_id: `${t}-${suffix}-worker`, session_id: session, parent: `${t}-root`,
    path: suffix, role: 'worker', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
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

// tamperLeaf：直接改 state 构造场景（绕过 worker done 完整流程），聚焦测 root children done 校验
function tamperLeaf(t, leafId, fn) {
  const f = path.join(SANDBOX, t, 'tree-state.json');
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  fn(st.leaves[leafId]);
  fs.writeFileSync(f, JSON.stringify(st));
}
function setWorkerDone(t, suffix) {
  tamperLeaf(t, `${t}-${suffix}-worker`, (l) => { l.status = 'done'; });
}
// root done 门禁也校验 milestone 非空（L1601）+ milestone.expect_outputs 非空（L1620）+ 落盘（L1655）。
// tamper 构造 root milestone + 落盘文件，越过 milestone/deliverables 门禁，聚焦测 v0.19 children done（Gap1）
function setRootMilestone(t) {
  tamperLeaf(t, `${t}-root`, (l) => { l.milestones = [{ id: 'M1', title: 'root skeleton', status: 'done', audit_pass: true, expect_outputs: ['out.md'] }]; });
  const dir = path.join(SANDBOX, t, 'deliverables');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'out.md'), 'root deliverable for v0.19 test');
}

const stats = { passed: 0, failed: 0 };
function pass(n) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
function fail(n, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}  ${info || ''}`); }
async function expectErr(code, n, fn) {
  const r = await fn();
  if (r && r.ok === false && r.error && r.error.code === code) pass(n);
  else fail(n, `期望 ${code}，got ok=${r && r.ok} ${r && r.error && r.error.code}`);
}
async function expectOk(n, fn) {
  const r = await fn();
  if (r && r.ok !== false) pass(n);
  else fail(n, `期望 ok，got ${r && r.error && r.error.code}`);
}

async function main() {
  console.log(`v0.19 root-children test — sandbox: ${SANDBOX}`);
  console.log(`engine: authority source\n`);

  // T1: root 有子 worker(未 done) → root set-status done → E_CHILDREN_NOT_DONE
  {
    const t = freshTid();
    await initTree(t);
    await addWorker(t, 'W1', UUID.w1);   // worker 未 done
    await rootDoneEvent(t);
    setRootMilestone(t);               // root done event（auto_upgrade audit_gate pass）
    await expectErr('E_CHILDREN_NOT_DONE', 'T1 root 有子未 done → 拦（v0.19 新覆盖）',
      () => rootSetDone(t));
  }

  // T2: root 有子 worker(done + audit_gate=pass) → root set-status done → 放行（v0.24 加 audit_gate=pass）
  {
    const t = freshTid();
    await initTree(t);
    await addWorker(t, 'W1', UUID.w1);
    setWorkerDone(t, 'W1');               // worker done（tamper 构造）
    tamperLeaf(t, `${t}-W1-worker`, (l) => { l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.root, ts: '2026-07-17T00:00:00Z' }; }); // v0.24: worker audit_gate=pass
    await rootDoneEvent(t);
    setRootMilestone(t);
    await expectOk('T2 root 有子 done → 放行', () => rootSetDone(t));
  }

  // T3: root 无子 → root set-status done → 放行（不误伤单 root 树，关键边界）
  {
    const t = freshTid();
    await initTree(t);
    await rootDoneEvent(t);
    setRootMilestone(t);
    await expectOk('T3 root 无子 → 放行（不误伤单 root 树）', () => rootSetDone(t));
  }

  console.log(`\n==== ${stats.passed} passed, ${stats.failed} failed ====`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
