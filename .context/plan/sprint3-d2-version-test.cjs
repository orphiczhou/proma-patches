#!/usr/bin/env node
/**
 * sprint3-d2-version-test.cjs — Sprint 3 Phase D / D2：schema 版本管理测试 (2026-07-14)
 *
 * 被测改动 (tree-engine.cjs, Sprint 3 D2):
 *   - 顶部常量 SCHEMA_VERSION='1.1' / SCHEMA_LADDER=['1.0','1.1'] / SCHEMA_HISTORY / compareVersion
 *   - cmdInit: version: SCHEMA_VERSION（单一信源，原硬编码 '1.1'）
 *   - cmdMigrate 规则 12 重构：按 SCHEMA_LADDER 从 startVersion 逐级升到 SCHEMA_VERSION（version-dispatch），
 *     每跳记一条 change；startVersion 超前于 ladder 则 clamp 回 SCHEMA_VERSION（防漂移）
 *
 * 设计约束：SCHEMA_VERSION 保持 '1.1'（Sprint 3 未引入新 schema 字段；升 1.2 会破坏 auditor-role-test Case 8）。
 *
 * 测试矩阵:
 *   1. 新树 version === SCHEMA_VERSION ('1.1')
 *   2. tamper 1.0 → migrate → changes 含 {version, 1.0→1.1}, state.version==='1.1'（兼容 auditor Case 8）
 *   3. 已是 1.1 → migrate → 无 version change（幂等）
 *   4. migrate --dry-run → state.version 不落库
 *   5. tamper 0.9（ladder 前置）→ migrate → 多跳 dispatch (0.9→1.0→1.1)，最终 1.1
 *   6. tamper 2.0（超前 ladder）→ migrate → clamp 回 1.1（防漂移）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 's3-d2-ver-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid));

const UUID_ROOT = '00000000-0000-0000-0000-000000000001';
const SCHEMA_VERSION = '1.1';  // 与引擎常量保持一致（D2 不升 1.2）

async function run(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  return engine.run(cmd, args, SANDBOX, caller || null);
}

let counter = 0;
function freshTreeId() { counter++; return `sd2v${counter}`; }

async function initTree(tid) {
  return run(null, ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'd2 version test' }),
    '--root-dod', JSON.stringify({ deliverables: ['out.md'], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID_ROOT, '--model', 'glm-5-2', '--channel', 'zlm',
  ]);
}

function readState(tree_id) {
  return JSON.parse(fs.readFileSync(path.join(SANDBOX, tree_id, 'tree-state.json'), 'utf8'));
}

function tamperVersion(tree_id, ver) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  st.version = ver;
  fs.writeFileSync(sp, JSON.stringify(st, null, 2));
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// ============================================================
// 测试 1: 新树 version === SCHEMA_VERSION
// ============================================================
async function test_new_tree_version() {
  console.log('\n[Test-1] 新树 version === SCHEMA_VERSION (1.1)');
  const tid = freshTreeId();
  await initTree(tid);
  const st = readState(tid);
  if (st.version === SCHEMA_VERSION) pass(`新树 version=${SCHEMA_VERSION}（单一信源）`, ''); else fail('新树 version', '实际 ' + st.version);
}

// ============================================================
// 测试 2: 1.0 → migrate → 1.1（兼容 auditor-role-test Case 8）
// ============================================================
async function test_migrate_1_0_to_1_1() {
  console.log('\n[Test-2] migrate 1.0→1.1（changes 含 version change + state.version=1.1）');
  const tid = freshTreeId();
  await initTree(tid);
  tamperVersion(tid, '1.0');
  const r = await run(null, ['migrate', tid]);
  if (!r.ok) { fail('Test-2 migrate', r.error && r.error.msg); return; }
  const changes = (r.migrated != null && r.changes) || [];
  const vc = changes.find((c) => c && c.field === 'version' && c.from === '1.0' && c.to === '1.1');
  if (vc) pass('changes 含 {version, 1.0→1.1}', ''); else fail('changes 缺 version 1.0→1.1', JSON.stringify(changes.filter(c=>c.field==='version')));
  const after = readState(tid).version;
  if (after === '1.1') pass('migrate 后 state.version===1.1', ''); else fail('state.version', '实际 ' + after);
}

// ============================================================
// 测试 3: 已 1.1 → migrate → 幂等（无 version change）
// ============================================================
async function test_migrate_idempotent() {
  console.log('\n[Test-3] 已是 1.1 → migrate 幂等（无 version change）');
  const tid = freshTreeId();
  await initTree(tid);
  // 新树已是 1.1
  const r = await run(null, ['migrate', tid]);
  if (!r.ok) { fail('Test-3 migrate', r.error && r.error.msg); return; }
  const changes = (r.migrated != null && r.changes) || [];
  const hasVerChange = changes.some((c) => c && c.field === 'version');
  if (!hasVerChange) pass('migrate 幂等：无 version change', ''); else fail('不应有 version change', JSON.stringify(changes.filter(c=>c.field==='version')));
}

// ============================================================
// 测试 4: migrate --dry-run → state.version 不落库
// ============================================================
async function test_migrate_dry_run() {
  console.log('\n[Test-4] migrate --dry-run 不落库 version');
  const tid = freshTreeId();
  await initTree(tid);
  tamperVersion(tid, '1.0');
  const r = await run(null, ['migrate', tid, '--dry-run', 'true']);
  if (!r.ok) { fail('Test-4 migrate dry-run', r.error && r.error.msg); return; }
  const after = readState(tid).version;
  if (after === '1.0') pass('dry-run 后 state.version 仍 1.0（未落库）', ''); else fail('dry-run 不应落库', '实际 ' + after);
  // dry-run 仍记 change（汇报用）
  const changes = (r.migrated != null && r.changes) || [];
  const hasVerChange = changes.some((c) => c && c.field === 'version' && c.to === '1.1');
  if (hasVerChange) pass('dry-run changes 仍汇报 version→1.1', ''); else fail('dry-run 应汇报 version change', JSON.stringify(changes.filter(c=>c.field==='version')));
}

// ============================================================
// 测试 5: tamper 0.9（ladder 前置）→ 多跳 dispatch
// ============================================================
async function test_migrate_multi_hop() {
  console.log('\n[Test-5] migrate 0.9→1.1 多跳 dispatch（0.9→1.0→1.1）');
  const tid = freshTreeId();
  await initTree(tid);
  tamperVersion(tid, '0.9');
  const r = await run(null, ['migrate', tid]);
  if (!r.ok) { fail('Test-5 migrate', r.error && r.error.msg); return; }
  const changes = (r.migrated != null && r.changes) || [];
  const verChanges = changes.filter((c) => c && c.field === 'version');
  // 0.9 < 1.0 < 1.1 → ladder filter (>0.9 且 <=1.1) = ['1.0','1.1'] → 2 跳：0.9→1.0, 1.0→1.1
  if (verChanges.length === 2 && verChanges[0].from === '0.9' && verChanges[0].to === '1.0' && verChanges[1].from === '1.0' && verChanges[1].to === '1.1') {
    pass('多跳 dispatch：0.9→1.0→1.1（2 条 change）', '');
  } else {
    fail('多跳 dispatch 不符', JSON.stringify(verChanges));
  }
  const after = readState(tid).version;
  if (after === '1.1') pass('最终 state.version===1.1', ''); else fail('最终 version', '实际 ' + after);
}

// ============================================================
// 测试 6: tamper 2.0（超前 ladder）→ clamp 回 1.1（防漂移）
// ============================================================
async function test_migrate_clamp_ahead() {
  console.log('\n[Test-6] migrate 2.0（超前 ladder）→ clamp 回 1.1（防漂移）');
  const tid = freshTreeId();
  await initTree(tid);
  tamperVersion(tid, '2.0');
  const r = await run(null, ['migrate', tid]);
  if (!r.ok) { fail('Test-6 migrate', r.error && r.error.msg); return; }
  const after = readState(tid).version;
  if (after === '1.1') pass('超前版本 clamp 回 1.1（防漂移）', ''); else fail('应 clamp 到 1.1', '实际 ' + after);
  const changes = (r.migrated != null && r.changes) || [];
  const hasClamp = changes.some((c) => c && c.field === 'version' && c.to === '1.1' && /clamp|fallback/i.test(c.reason || ''));
  if (hasClamp) pass('changes 含 clamp/fallback 标记', ''); else fail('changes 缺 clamp 标记', JSON.stringify(changes.filter(c=>c.field==='version')));
}

(async () => {
  console.log('============================================================');
  console.log('Sprint 3 Phase D / D2 — schema 版本管理测试');
  console.log('ENGINE_PATH =', ENGINE_PATH, '| SCHEMA_VERSION =', SCHEMA_VERSION);
  console.log('============================================================');
  try {
    await test_new_tree_version();
    await test_migrate_1_0_to_1_1();
    await test_migrate_idempotent();
    await test_migrate_dry_run();
    await test_migrate_multi_hop();
    await test_migrate_clamp_ahead();
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
