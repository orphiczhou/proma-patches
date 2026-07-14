#!/usr/bin/env node
/**
 * sprint2-ctx-segment-test.cjs — Sprint 2 约束 6：ctx 竹节自动触发测试 (2026-07-14)
 *
 * 被测改动 (tree-engine.cjs, Sprint 2 约束 6 / ISS-007 / P2-S04):
 *   - cmdLeafSetContext (L1722): 写 context_usage_pct 后，若 pct >= 阈值且 status=active 且 role!=root
 *     → 自动 set status='segment_pending' + drift handoff 留痕（约束 5 联动）
 *   - 阈值 audit_meta.ctx_segment_threshold 默认 85（对齐 SKILL §8.2 sweet_spot_risk）
 *   - 替代 SKILL §8.3 "v0.3 未实现" 的手动竹节交接
 *
 * methodology-coverage-audit 约束 6：ctx 超阈值自动触发 segment（竹节交接）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 's2-ctx-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid));

const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  cmd:    '00000000-0000-0000-0000-000000000003',
};

async function run(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  return engine.run(cmd, args, SANDBOX, caller || null);
}

let counter = 0;
function freshTreeId() { counter++; return `sctx${counter}`; }

async function initTree(tid, auditMeta) {
  const args = ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'ctx segment test' }),
    '--root-dod', JSON.stringify({ deliverables: ['out.md'], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'glm-5-2', '--channel', 'zlm',
  ];
  if (auditMeta) args.push('--audit-meta', JSON.stringify(auditMeta));
  return run(null, args);
}

async function addCmdLeaf(tid, pathSeg) {
  const leafId = `${tid}-${pathSeg}-commander`;
  await run(UUID.root, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: UUID.cmd, parent: `${tid}-root`,
    path: pathSeg, role: 'commander', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
  })]);
  return leafId;
}

function readLeaf(tree_id, leaf_id) {
  const state = JSON.parse(fs.readFileSync(path.join(SANDBOX, tree_id, 'tree-state.json'), 'utf8'));
  return state.leaves[leaf_id];
}
function tamperStatus(tree_id, leaf_id, status) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  st.leaves[leaf_id].status = status;
  fs.writeFileSync(sp, JSON.stringify(st, null, 2));
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// 测试1: ctx < 阈值不触发
async function test_below_threshold() {
  console.log('\n[Test-1] set-context 50%（< 阈值 85）→ 不触发 segment_pending');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addCmdLeaf(tid, 'C1');
  const r = await run(UUID.root, ['leaf', 'set-context', tid, leafId, '50']);
  if (!r.ok) { fail('Test-1 set-context', r.error && r.error.code); return; }
  const leaf = readLeaf(tid, leafId);
  if (leaf.status === 'active' && r.leaf.segment_pending === false) pass('50% 不触发，status=active', ''); else fail('50% 不触发', `status=${leaf.status}, seg=${r.leaf && r.leaf.segment_pending}`);
}

// 测试2: ctx >= 阈值触发 segment_pending + drift
async function test_at_threshold() {
  console.log('\n[Test-2] set-context 90%（>= 阈值 85）→ 自动 segment_pending + drift handoff');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addCmdLeaf(tid, 'C2');
  const beforeDrift = (readLeaf(tid, leafId).drift_history || []).length;
  const r = await run(UUID.root, ['leaf', 'set-context', tid, leafId, '90']);
  if (!r.ok) { fail('Test-2 set-context', r.error && r.error.code); return; }
  const leaf = readLeaf(tid, leafId);
  if (leaf.status === 'segment_pending' && r.leaf.segment_pending === true) pass('90% 触发 segment_pending', ''); else fail('90% 触发', `status=${leaf.status}, seg=${r.leaf && r.leaf.segment_pending}`);
  const afterDrift = (leaf.drift_history || []).length;
  const lastDrift = leaf.drift_history[afterDrift - 1];
  if (afterDrift === beforeDrift + 1 && lastDrift.action === 'handoff' && /segment_pending/.test(lastDrift.reason || '')) {
    pass('drift 联动 handoff（竹节交接留痕）', '');
  } else {
    fail('drift handoff', JSON.stringify(lastDrift));
  }
}

// 测试3: root leaf 不触发
async function test_root_no_trigger() {
  console.log('\n[Test-3] root leaf set-context 95% → 不触发（信任锚不竹节）');
  const tid = freshTreeId();
  await initTree(tid);
  const r = await run(UUID.root, ['leaf', 'set-context', tid, `${tid}-root`, '95']);
  if (!r.ok) { fail('Test-3 set-context', r.error && r.error.code); return; }
  const leaf = readLeaf(tid, `${tid}-root`);
  if (leaf.status === 'active' && r.leaf.segment_pending === false) pass('root 95% 不触发', ''); else fail('root 不触发', `status=${leaf.status}, seg=${r.leaf && r.leaf.segment_pending}`);
}

// 测试4: done leaf 不触发
async function test_done_no_trigger() {
  console.log('\n[Test-4] done leaf set-context 90% → 不触发（终态不动）');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addCmdLeaf(tid, 'C4');
  tamperStatus(tid, leafId, 'done');
  const r = await run(UUID.root, ['leaf', 'set-context', tid, leafId, '90']);
  if (!r.ok) { fail('Test-4 set-context', r.error && r.error.code); return; }
  const leaf = readLeaf(tid, leafId);
  if (leaf.status === 'done' && r.leaf.segment_pending === false) pass('done 90% 不触发', ''); else fail('done 不触发', `status=${leaf.status}`);
}

// 测试5: 自定义阈值
async function test_custom_threshold() {
  console.log('\n[Test-5] 自定义阈值 ctx_segment_threshold=70 → 72% 触发 / 68% 不触发');
  const tid = freshTreeId();
  await initTree(tid, { ctx_segment_threshold: 70 });
  const leafId = await addCmdLeaf(tid, 'C5');
  const r = await run(UUID.root, ['leaf', 'set-context', tid, leafId, '72']);
  if (!r.ok) { fail('Test-5 set-context 72', r.error && r.error.code); return; }
  if (readLeaf(tid, leafId).status === 'segment_pending') pass('自定义阈值 70，72% 触发', ''); else fail('72% 触发', `status=${readLeaf(tid, leafId).status}`);
  const tid2 = freshTreeId();
  await initTree(tid2, { ctx_segment_threshold: 70 });
  const leafId2 = await addCmdLeaf(tid2, 'C5');
  const r2 = await run(UUID.root, ['leaf', 'set-context', tid2, leafId2, '68']);
  if (!r2.ok) { fail('Test-5 set-context 68', r2.error && r2.error.code); return; }
  if (readLeaf(tid2, leafId2).status === 'active') pass('68% < 自定义阈值 70 不触发', ''); else fail('68% 不触发', `status=${readLeaf(tid2, leafId2).status}`);
}

(async () => {
  console.log('============================================================');
  console.log('Sprint 2 约束 6 — ctx 竹节自动触发测试（set-context 阈值 → segment_pending）');
  console.log('============================================================');
  try {
    await test_below_threshold();
    await test_at_threshold();
    await test_root_no_trigger();
    await test_done_no_trigger();
    await test_custom_threshold();
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
