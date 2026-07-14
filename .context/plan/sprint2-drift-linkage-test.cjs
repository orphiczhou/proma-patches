#!/usr/bin/env node
/**
 * sprint2-drift-linkage-test.cjs — Sprint 2 约束 5：状态变更 drift 联动测试 (2026-07-14)
 *
 * 被测改动 (tree-engine.cjs, Sprint 2 约束 5 / P2-S03):
 *   - cmdLeafSetSession (L1816): session_id 变更后双写 drift（kind=rhythm/action=self_correct, from/to=session）
 *   - cmdRestore (L2457): 恢复后双写 drift（kind=production/severity=high/action=declare, root leaf + drift_log）
 *   - cmdMigrate (L3636): 迁移后双写 drift（kind=production/severity=mid/action=declare, root leaf + drift_log）
 *
 * methodology-coverage-audit 约束 5：set-session/migrate/restore 等状态变更联动写 drift（状态变更全留痕）。
 *
 * 测试方法:
 *   - 记录操作前 drift_log / drift_history 计数 → 操作 → 断言 +1 且 entry 内容正确
 *   - migrate --dry-run 不写 drift（dry-run 不持久化）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 's2-drift-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid));

const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  worker: '00000000-0000-0000-0000-000000000002',
  newSid: '00000000-0000-0000-0000-000000000009',
};

async function run(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  return engine.run(cmd, args, SANDBOX, caller || null);
}

let counter = 0;
function freshTreeId() { counter++; return `sdre${counter}`; }

async function initTree(tid) {
  return run(null, ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'drift linkage test' }),
    '--root-dod', JSON.stringify({ deliverables: ['out.md'], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'glm-5-2', '--channel', 'zlm',
  ]);
}

function readState(tree_id) {
  return JSON.parse(fs.readFileSync(path.join(SANDBOX, tree_id, 'tree-state.json'), 'utf8'));
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// ============================================================
// 测试 1: set-session 写 drift
// ============================================================
async function test_set_session_drift() {
  console.log('\n[Test-1] set-session 写 drift（leaf.drift_history + state.drift_log）');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = `${tid}-L1-worker`;
  await run(UUID.root, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: UUID.worker, parent: `${tid}-root`,
    path: 'L1', role: 'worker', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
  })]);
  const beforeLog = (readState(tid).drift_log || []).length;
  const beforeHist = (readState(tid).leaves[leafId].drift_history || []).length;
  // set-session（caller=root 创建者，合法）
  const r = await run(UUID.root, ['leaf', 'set-session', tid, leafId, UUID.newSid]);
  if (!r.ok) { fail('Test-1 set-session', r.error && r.error.code + ': ' + (r.error.msg || '').slice(0, 100)); return; }
  const st = readState(tid);
  const afterLog = (st.drift_log || []).length;
  const afterHist = (st.leaves[leafId].drift_history || []).length;
  if (afterLog === beforeLog + 1) pass('state.drift_log +1', ''); else fail('drift_log 计数', `${beforeLog}→${afterLog}`);
  if (afterHist === beforeHist + 1) pass('leaf.drift_history +1', ''); else fail('drift_history 计数', `${beforeHist}→${afterHist}`);
  const entry = st.leaves[leafId].drift_history[afterHist - 1];
  if (entry && entry.action === 'self_correct' && entry.from === UUID.worker && entry.to === UUID.newSid) {
    pass('drift entry 内容正确（self_correct, from→to）', '');
  } else {
    fail('drift entry 内容', JSON.stringify(entry));
  }
}

// ============================================================
// 测试 2: restore 写 drift
// ============================================================
async function test_restore_drift() {
  console.log('\n[Test-2] restore 写 drift（root.drift_history + state.drift_log）');
  const tid = freshTreeId();
  await initTree(tid);
  const backupPath = path.join(SANDBOX, tid, 'manual-bk.json');
  fs.copyFileSync(path.join(SANDBOX, tid, 'tree-state.json'), backupPath);
  const beforeLog = (readState(tid).drift_log || []).length;
  const r = await run(null, ['restore', tid, 'manual-bk.json']);
  if (!r.ok) { fail('Test-2 restore', r.error && r.error.code + ': ' + (r.error.msg || '').slice(0, 100)); return; }
  const st = readState(tid);
  const afterLog = (st.drift_log || []).length;
  if (afterLog >= beforeLog + 1) pass('state.drift_log +≥1（restore entry）', ''); else fail('drift_log 计数', `${beforeLog}→${afterLog}`);
  const lastEntry = st.drift_log[afterLog - 1];
  if (lastEntry && lastEntry.action === 'declare' && /restored from backup/.test(lastEntry.reason || '')) {
    pass('restore drift entry 内容正确（declare, reason 含 backup）', '');
  } else {
    fail('restore drift entry', JSON.stringify(lastEntry));
  }
  const rootLeaf = Object.values(st.leaves).find((l) => l.role === 'root');
  const rootHasRestore = (rootLeaf.drift_history || []).some((e) => /restored from backup/.test(e.reason || ''));
  if (rootHasRestore) pass('root leaf.drift_history 含 restore entry', ''); else fail('root drift_history 缺 restore');
}

// ============================================================
// 测试 3: migrate 写 drift + dry-run 不写
// ============================================================
async function test_migrate_drift() {
  console.log('\n[Test-3] migrate 写 drift（root.drift_history + state.drift_log）+ dry-run 不写');
  const tid = freshTreeId();
  await initTree(tid);
  const beforeLog = (readState(tid).drift_log || []).length;
  const r = await run(null, ['migrate', tid]);
  if (!r.ok) { fail('Test-3 migrate', r.error && r.error.code + ': ' + (r.error.msg || '').slice(0, 100)); return; }
  const st = readState(tid);
  const afterLog = (st.drift_log || []).length;
  if (afterLog >= beforeLog + 1) pass('state.drift_log +≥1（migrate entry）', ''); else fail('drift_log 计数', `${beforeLog}→${afterLog}`);
  const lastEntry = st.drift_log[afterLog - 1];
  if (lastEntry && lastEntry.action === 'declare' && /schema migrated/.test(lastEntry.reason || '')) {
    pass('migrate drift entry 内容正确（declare, reason 含 schema migrated）', '');
  } else {
    fail('migrate drift entry', JSON.stringify(lastEntry));
  }
  // migrate --dry-run 不写 drift
  const beforeLog2 = (readState(tid).drift_log || []).length;
  await run(null, ['migrate', tid, '--dry-run', 'true']);
  const afterLog2 = (readState(tid).drift_log || []).length;
  if (afterLog2 === beforeLog2) pass('migrate --dry-run 不写 drift', ''); else fail('dry-run 不应写 drift', `${beforeLog2}→${afterLog2}`);
}

(async () => {
  console.log('============================================================');
  console.log('Sprint 2 约束 5 — drift 联动测试（set-session / restore / migrate）');
  console.log('ENGINE_PATH =', ENGINE_PATH);
  console.log('============================================================');
  try {
    await test_set_session_drift();
    await test_restore_drift();
    await test_migrate_drift();
  } catch (e) {
    console.log('\n[FATAL]', e && e.stack ? e.stack : e);
    stats.failed++;
  }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m`);
  console.log('------------------------------------------------------------');
  process.exit(stats.failed === 0 ? 0 : 1);
})();
