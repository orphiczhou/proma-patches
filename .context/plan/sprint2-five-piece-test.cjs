#!/usr/bin/env node
/**
 * sprint2-five-piece-test.cjs — Sprint 2 约束 4：5 件套契约持久化专项测试 (2026-07-14)
 *
 * 被测改动 (tree-engine.cjs, Sprint 2 约束 4, design-commander-spawn §4.1):
 *   - root leaf 构造 (cmdInit L770-775): brief=state.root_brief, dod=state.root_dod,
 *     report_protocol/autonomy/self_audit = null（root 是信任锚，无下游协议）
 *   - cmdLeafAdd leaf 构造 (L1056-1060): brief/dod/report_protocol/autonomy/self_audit
 *     从 input 取，默认 null（向后兼容旧 leaf）
 *   - cmdLeafGet (L1082): 返回 { leaf }，leaf 含 5 件套字段
 *
 * design-commander-spawn §八 检查清单「测试：持久化 + 读流程 + 向后兼容」的实施。
 * 混合任务书机制核心：worker 启动调 tree_leaf_get(自己 leaf_id) 读 leaf 持久化的 5 件套。
 *
 * 测试方法:
 *   - 持久化: leaf add 传 5 件套 → 直接读 tree-state.json 断言 5 字段非空 + 值对（readLeaf）
 *   - 读流程: API leaf get 返回的 leaf 含 5 件套（r.result.leaf）
 *   - 向后兼容: leaf add 不传 5 件套 → 5 字段为 null，不报错
 *
 * 注: ENGINE_PATH 用权威源 D:/codes/tree-harness/（含 5 件套改动）。
 *     现有 6 核心测试 require workspace-files 旧引擎（md5 42ba5d51，无 5 件套），
 *     本测试独立用权威源，避免依赖旧路径。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 引擎 setup（权威源）
// ============================================================
const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 's2-fivepiece-'));

engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  worker: '00000000-0000-0000-0000-000000000002',
  cmd:    '00000000-0000-0000-0000-000000000003',
};

// ============================================================
// helpers
// ============================================================
async function run(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  // engine.run 成功返回 {ok:true, ...dispatchResult}（Object.assign 展开, engine L4826），失败返回 {ok:false, error}
  // 例: leaf get → {ok:true, leaf:{...}}；数据字段在【顶层】(r.leaf)，非 r.result.leaf
  return engine.run(cmd, args, SANDBOX, caller || null);
}

let counter = 0;
function freshTreeId() {
  counter++;
  return `stre${counter}`; // [a-z][a-z0-9_]{3,7}
}

async function initTree(tid, rootBrief, rootDod) {
  return run(null, ['init', tid,
    '--root-brief', JSON.stringify(rootBrief || { parent_intent: 's2 five-piece test', my_mission: '验证 5 件套持久化' }),
    '--root-dod', JSON.stringify(rootDod || { deliverables: ['out.md'], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'glm-5-2', '--channel', 'zlm',
  ]);
}

// 直接读 tree-state.json（持久化权威断言，绕过 API 任何包装层）
function readLeaf(tree_id, leaf_id) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  return state.leaves[leaf_id] || null;
}

// 5 件套样本数据
const FIVE_PIECE = {
  brief: { my_mission: '子模块A实现', in_scope: ['a','b'], out_of_scope: ['c'] },
  dod: { deliverables: ['a.md'], quality_gates: ['测试通过'] },
  report_protocol: { cadence: '每个 milestone', channels: ['event'] },
  autonomy: { can_decide: ['实现细节'], must_report: ['方向变更'], must_ask: ['删功能'] },
  self_audit: { milestones: [{ id: 'M1', desc: 'm1', expect_outputs: ['a.md'] }] },
};

// ============================================================
// 断言
// ============================================================
const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// ============================================================
// 测试 1: root leaf 5 件套（brief/dod 来自 init 参数，其余 null）
// ============================================================
async function test_root_leaf_five_piece() {
  console.log('\n[Test-1] root leaf 5 件套：brief/dod 来自 init 参数，其余 null');
  const tid = freshTreeId();
  const rb = { parent_intent: 'root mission abc' };
  const rd = { deliverables: ['root-out.md'], node_budget: 20 };
  const ir = await initTree(tid, rb, rd);
  if (!ir.ok) { fail('Test-1 init', ir.error && ir.error.code); return; }
  const rootLid = `${tid}-root`;
  const leaf = readLeaf(tid, rootLid);
  if (!leaf) { fail('Test-1', 'root leaf 不存在'); return; }
  if (leaf.brief && leaf.brief.parent_intent === 'root mission abc') pass('root leaf.brief ← root_brief', ''); else fail('root leaf.brief', JSON.stringify(leaf.brief));
  if (leaf.dod && Array.isArray(leaf.dod.deliverables) && leaf.dod.deliverables[0] === 'root-out.md') pass('root leaf.dod ← root_dod', ''); else fail('root leaf.dod', JSON.stringify(leaf.dod));
  if (leaf.report_protocol === null) pass('root leaf.report_protocol=null（信任锚无下游协议）', ''); else fail('root report_protocol', JSON.stringify(leaf.report_protocol));
  if (leaf.autonomy === null) pass('root leaf.autonomy=null', ''); else fail('root autonomy', JSON.stringify(leaf.autonomy));
  if (leaf.self_audit === null) pass('root leaf.self_audit=null', ''); else fail('root self_audit', JSON.stringify(leaf.self_audit));
}

// ============================================================
// 测试 2: leaf_add 持久化完整 5 件套 + API 读流程一致
// ============================================================
async function test_leaf_add_persist_full() {
  console.log('\n[Test-2] leaf add 传完整 5 件套 → 持久化 + API 读流程一致');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = `${tid}-L2-commander`;
  const ar = await run(UUID.root, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: UUID.cmd, parent: `${tid}-root`,
    path: 'L2', role: 'commander', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
    brief: FIVE_PIECE.brief, dod: FIVE_PIECE.dod, report_protocol: FIVE_PIECE.report_protocol,
    autonomy: FIVE_PIECE.autonomy, self_audit: FIVE_PIECE.self_audit,
  })]);
  if (!ar.ok) { fail('Test-2 leaf add', ar.error && ar.error.code); return; }
  // 持久化断言（文件直读）
  const leaf = readLeaf(tid, leafId);
  if (!leaf) { fail('Test-2', 'leaf 不存在'); return; }
  if (leaf.brief && leaf.brief.my_mission === '子模块A实现') pass('持久化 leaf.brief', ''); else fail('leaf.brief', JSON.stringify(leaf.brief));
  if (leaf.dod && leaf.dod.quality_gates) pass('持久化 leaf.dod', ''); else fail('leaf.dod', JSON.stringify(leaf.dod));
  if (leaf.report_protocol && leaf.report_protocol.cadence) pass('持久化 leaf.report_protocol', ''); else fail('leaf.report_protocol', JSON.stringify(leaf.report_protocol));
  if (leaf.autonomy && Array.isArray(leaf.autonomy.must_ask)) pass('持久化 leaf.autonomy', ''); else fail('leaf.autonomy', JSON.stringify(leaf.autonomy));
  if (leaf.self_audit && Array.isArray(leaf.self_audit.milestones)) pass('持久化 leaf.self_audit', ''); else fail('leaf.self_audit', JSON.stringify(leaf.self_audit));
  // API 读流程（worker 启动 tree_leaf_get 模拟）
  const gr = await run(UUID.cmd, ['leaf', 'get', tid, leafId]);
  if (!gr.ok) { fail('Test-2 leaf get 读流程', gr.error && gr.error.code); return; }
  const got = gr.leaf;
  if (got && got.brief && got.brief.my_mission === '子模块A实现' && got.self_audit && got.self_audit.milestones) {
    pass('API leaf get 返回 5 件套（读流程对齐混合任务书）', '');
  } else {
    fail('API leaf get 返回 5 件套', JSON.stringify(got && Object.keys(got)));
  }
}

// ============================================================
// 测试 3: 向后兼容（leaf add 不传 5 件套 → 5 字段 null，不报错）
// ============================================================
async function test_leaf_add_backward_compat() {
  console.log('\n[Test-3] 向后兼容：leaf add 不传 5 件套 → 5 字段 null，不报错');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = `${tid}-L3-worker`;
  const ar = await run(UUID.root, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: UUID.worker, parent: `${tid}-root`,
    path: 'L3', role: 'worker', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
    // 故意不传任何 5 件套字段（模拟旧 leaf）
  })]);
  if (!ar.ok) { fail('Test-3 leaf add（旧 leaf 应成功）', ar.error && ar.error.code); return; }
  const leaf = readLeaf(tid, leafId);
  if (!leaf) { fail('Test-3', 'leaf 不存在'); return; }
  const fields = ['brief', 'dod', 'report_protocol', 'autonomy', 'self_audit'];
  const allNull = fields.every((f) => leaf[f] === null || leaf[f] === undefined);
  if (allNull) pass('旧 leaf 5 字段全 null（向后兼容）', ''); else fail('旧 leaf 5 字段应 null', JSON.stringify(fields.map((f) => leaf[f])));
  // API get 也不报错
  const gr = await run(UUID.worker, ['leaf', 'get', tid, leafId]);
  if (gr.ok) pass('旧 leaf API get 不报错', ''); else fail('旧 leaf API get', gr.error && gr.error.code);
}

// ============================================================
// 测试 4: 部分传（只 brief+dod，其余 null）—— 混合任务书常见场景
// ============================================================
async function test_leaf_add_partial() {
  console.log('\n[Test-4] 部分传：只 brief+dod（commander 常见）→ 其余 null');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = `${tid}-L4-commander`;
  const ar = await run(UUID.root, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: UUID.cmd, parent: `${tid}-root`,
    path: 'L4', role: 'commander', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
    brief: FIVE_PIECE.brief, dod: FIVE_PIECE.dod,
  })]);
  if (!ar.ok) { fail('Test-4 leaf add', ar.error && ar.error.code); return; }
  const leaf = readLeaf(tid, leafId);
  if (leaf.brief && leaf.dod && leaf.report_protocol === null && leaf.autonomy === null && leaf.self_audit === null) {
    pass('部分传：brief/dod 非空，其余 null', '');
  } else {
    fail('部分传 5 字段', JSON.stringify({ b: !!leaf.brief, d: !!leaf.dod, rp: leaf.report_protocol, au: leaf.autonomy, sa: leaf.self_audit }));
  }
}

// ============================================================
// 测试 5: 持久化 5 件套后 tree validate 一致性不破坏
// ============================================================
async function test_validate_with_five_piece() {
  console.log('\n[Test-5] 持久化 5 件套后 tree validate 一致性校验通过');
  const tid = freshTreeId();
  await initTree(tid);
  await run(UUID.root, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: `${tid}-L5-commander`, session_id: UUID.cmd, parent: `${tid}-root`,
    path: 'L5', role: 'commander', model: 'glm-5-2', channel: 'zlm', added_by: UUID.root,
    ...FIVE_PIECE,
  })]);
  const vr = await run(null, ['validate', tid]);
  if (vr.ok) pass('tree validate ok（5 件套字段不破坏一致性）', ''); else fail('tree validate', vr.error && vr.error.code);
}

// ============================================================
// 主流程
// ============================================================
(async () => {
  console.log('============================================================');
  console.log('Sprint 2 约束 4 — 5 件套契约持久化测试（权威源引擎）');
  console.log('ENGINE_PATH =', ENGINE_PATH);
  console.log('SANDBOX     =', SANDBOX);
  console.log('============================================================');
  try {
    await test_root_leaf_five_piece();
    await test_leaf_add_persist_full();
    await test_leaf_add_backward_compat();
    await test_leaf_add_partial();
    await test_validate_with_five_piece();
  } catch (e) {
    console.log('\n[FATAL] 测试异常:', e && e.stack ? e.stack : e);
    stats.failed++;
  }
  // 清理沙箱
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m`);
  console.log('------------------------------------------------------------');
  process.exit(stats.failed === 0 ? 0 : 1);
})();
