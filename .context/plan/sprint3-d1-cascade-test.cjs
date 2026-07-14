#!/usr/bin/env node
/**
 * sprint3-d1-cascade-test.cjs — Sprint 3 Phase D / D1：prune/archive 级联语义测试 (2026-07-14)
 *
 * 被测改动 (tree-engine.cjs, Sprint 3 D1):
 *   - cmdLeafSetStatus: 父 leaf set-status=pruned 后，未 done 后代级联 pruned（+ drift 留痕）；
 *     已 done 后代保留（防误删成果）且不下降其子树；终态后代不动；archived 不级联；root 防级联。
 *
 * 级联是引擎内部强制状态变更（同一 withLock 事务），绕过 STATUS_TRANSITIONS / caller-binding
 * （caller 已通过 target leaf 的 caller-binding 校验；级联子是内部变更非新 API 调用）。
 *
 * 测试矩阵:
 *   1. active 子级联 pruned + drift 留痕 + result.cascaded
 *   2. done 子保留（防误删成果）
 *   3. 递归级联（3 层：commander→commander→worker）
 *   4. done 子树不下降（done commander 下的 done worker 不被动）
 *   5. 终态（archived/pruned）子不动
 *   6. archived 父不级联（archived 是隐藏非删除）
 *   7. root 不被级联（防御性：root parent=null 天然不可达）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 's3-d1-cascade-'));
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid));

const UUID = {
  root: '00000000-0000-0000-0000-000000000001',
  c1:   '00000000-0000-0000-0000-000000000010',
  c2:   '00000000-0000-0000-0000-000000000020',
  w1:   '00000000-0000-0000-0000-000000000101',
  w2:   '00000000-0000-0000-0000-000000000102',
  w3:   '00000000-0000-0000-0000-000000000103',
  w4:   '00000000-0000-0000-0000-000000000104',
};

async function run(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  return engine.run(cmd, args, SANDBOX, caller || null);
}

let counter = 0;
function freshTreeId() { counter++; return `sd1c${counter}`; }

async function initTree(tid) {
  return run(null, ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'd1 cascade test' }),
    '--root-dod', JSON.stringify({ deliverables: ['out.md'], node_budget: 30, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'glm-5-2', '--channel', 'zlm',
  ]);
}

async function addLeaf(caller, tid, leaf_id, session_id, parent, role, pathSeg) {
  // caller-binding (P1): added_by 必须 === caller（操作者即声明者）
  const r = await run(caller, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id, session_id, parent, path: pathSeg, role, model: 'glm-5-2', channel: 'zlm', added_by: caller,
  })]);
  if (!r.ok) throw new Error(`addLeaf ${leaf_id} failed: ${r.error && r.error.code} ${r.error && (r.error.msg||'').slice(0,120)}`);
  return r;
}

function readState(tree_id) {
  return JSON.parse(fs.readFileSync(path.join(SANDBOX, tree_id, 'tree-state.json'), 'utf8'));
}

// 直接改 tree-state.json（绕过 done-gate），用于把 leaf 标成 done/archived 测试"保留/不级联"语义。
// cascade 只读 status，所以 tamper status 足够。
function tamperLeaf(tree_id, leaf_id, fn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  fn(st.leaves[leaf_id], st);
  fs.writeFileSync(sp, JSON.stringify(st, null, 2));
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// ============================================================
// 测试 1: active 子级联 pruned + drift 留痕 + result.cascaded
// 测试 2: done 子保留
// ============================================================
async function test_active_cascade_and_done_preserved() {
  console.log('\n[Test-1+2] active 子级联 pruned / done 子保留');
  const tid = freshTreeId();
  await initTree(tid);
  const c1 = `${tid}-L1-commander`;
  const w1 = `${tid}-L1a-worker`;  // active → 应级联
  const w2 = `${tid}-L1b-worker`;  // done → 应保留
  await addLeaf(UUID.root, tid, c1, UUID.c1, `${tid}-root`, 'commander', 'L1');
  await addLeaf(UUID.c1, tid, w1, UUID.w1, c1, 'worker', 'L1a');
  await addLeaf(UUID.c1, tid, w2, UUID.w2, c1, 'worker', 'L1b');
  tamperLeaf(tid, w2, (l) => { l.status = 'done'; });  // W2 标 done

  const r = await run(UUID.root, ['leaf', 'set-status', tid, c1, 'pruned']);
  if (!r.ok) { fail('Test-1 set-status pruned', r.error && r.error.code + ': ' + (r.error.msg || '').slice(0, 120)); return; }
  const cascaded = (r.leaf && r.cascaded) || [];
  const st = readState(tid);

  // C1 自身 pruned
  if (st.leaves[c1].status === 'pruned') pass('C1 自身 status=pruned', ''); else fail('C1 status', st.leaves[c1].status);
  // W1 active → 级联 pruned
  if (st.leaves[w1].status === 'pruned') pass('W1 (active) 级联 pruned', ''); else fail('W1 应级联 pruned', '实际 ' + st.leaves[w1].status);
  // W2 done → 保留
  if (st.leaves[w2].status === 'done') pass('W2 (done) 保留为 done', ''); else fail('W2 应保留 done', '实际 ' + st.leaves[w2].status);
  // result.cascaded 含 W1 不含 W2
  // 注：fresh worker 初始 status=pending_brief（v0.2.2，未 brief_echo），pending_brief 是非 done → 级联 pruned（额外覆盖 pending_brief 边界）
  if (cascaded.some((c) => c.leaf_id === w1 && c.from === 'pending_brief' && c.to === 'pruned')) pass('result.cascaded 含 W1 (pending_brief→pruned)', ''); else fail('result.cascaded 缺 W1', JSON.stringify(cascaded));
  if (!cascaded.some((c) => c.leaf_id === w2)) pass('result.cascaded 不含 W2 (done 保留)', ''); else fail('result.cascaded 不应含 W2', JSON.stringify(cascaded));
  // W1 drift 留痕（cascade prune）
  const w1drift = (st.leaves[w1].drift_history || []).find((d) => d.action === 'prune' && /cascade/.test(d.reason || ''));
  if (w1drift) pass('W1 drift_history 含 cascade prune entry', ''); else fail('W1 drift 缺 cascade entry', JSON.stringify((st.leaves[w1].drift_history || []).slice(-1)));
  // state.drift_log 含 W1 cascade entry
  const logHas = (st.drift_log || []).some((d) => d.leaf_id === w1 && d.action === 'prune' && /cascade/.test(d.reason || ''));
  if (logHas) pass('state.drift_log 含 W1 cascade entry', ''); else fail('drift_log 缺 W1 cascade', '');
}

// ============================================================
// 测试 3: 递归级联（commander→commander→worker，3 层）
// ============================================================
async function test_recursive_cascade() {
  console.log('\n[Test-3] 递归级联（C1→C2→W1 全 active）');
  const tid = freshTreeId();
  await initTree(tid);
  const c1 = `${tid}-L1-commander`;
  const c2 = `${tid}-L1a-commander`;
  const w1 = `${tid}-L1a1-worker`;
  await addLeaf(UUID.root, tid, c1, UUID.c1, `${tid}-root`, 'commander', 'L1');
  await addLeaf(UUID.c1, tid, c2, UUID.c2, c1, 'commander', 'L1a');
  await addLeaf(UUID.c2, tid, w1, UUID.w1, c2, 'worker', 'L1a1');

  const r = await run(UUID.root, ['leaf', 'set-status', tid, c1, 'pruned']);
  if (!r.ok) { fail('Test-3 set-status pruned', r.error && r.error.msg); return; }
  const st = readState(tid);
  if (st.leaves[c2].status === 'pruned') pass('C2 (active) 级联 pruned', ''); else fail('C2 应级联', st.leaves[c2].status);
  if (st.leaves[w1].status === 'pruned') pass('W1 (active, 孙) 递归级联 pruned', ''); else fail('W1 应递归级联', st.leaves[w1].status);
  const cascaded = (r.leaf && r.cascaded) || [];
  if (cascaded.length === 2) pass(`result.cascaded 含 2 条 (C2+W1)`, ''); else fail('cascaded 应 2 条', '实际 ' + cascaded.length);
}

// ============================================================
// 测试 4: done 子树不下降（done commander 下的 done worker 不被动）
// ============================================================
async function test_done_subtree_not_descended() {
  console.log('\n[Test-4] done 子树不下降（C2=done → 其下 W3=done 不被动）');
  const tid = freshTreeId();
  await initTree(tid);
  const c1 = `${tid}-L1-commander`;
  const c2 = `${tid}-L1a-commander`;
  const w3 = `${tid}-L1a1-worker`;
  await addLeaf(UUID.root, tid, c1, UUID.c1, `${tid}-root`, 'commander', 'L1');
  await addLeaf(UUID.c1, tid, c2, UUID.c2, c1, 'commander', 'L1a');
  await addLeaf(UUID.c2, tid, w3, UUID.w3, c2, 'worker', 'L1a1');
  tamperLeaf(tid, c2, (l) => { l.status = 'done'; });
  tamperLeaf(tid, w3, (l) => { l.status = 'done'; });

  const r = await run(UUID.root, ['leaf', 'set-status', tid, c1, 'pruned']);
  if (!r.ok) { fail('Test-4 set-status pruned', r.error && r.error.msg); return; }
  const st = readState(tid);
  if (st.leaves[c2].status === 'done') pass('C2 (done) 保留', ''); else fail('C2 应保留 done', st.leaves[c2].status);
  if (st.leaves[w3].status === 'done') pass('W3 (done, C2 子) 不下降保留', ''); else fail('W3 应保留 done', st.leaves[w3].status);
}

// ============================================================
// 测试 5: 终态（archived/pruned）子不动
// ============================================================
async function test_terminal_child_not_touched() {
  console.log('\n[Test-5] 终态子（archived/pruned）不被级联触碰');
  const tid = freshTreeId();
  await initTree(tid);
  const c1 = `${tid}-L1-commander`;
  const w1 = `${tid}-L1a-worker`;  // tamper 成 archived
  const w2 = `${tid}-L1b-worker`;  // tamper 成 pruned
  await addLeaf(UUID.root, tid, c1, UUID.c1, `${tid}-root`, 'commander', 'L1');
  await addLeaf(UUID.c1, tid, w1, UUID.w1, c1, 'worker', 'L1a');
  await addLeaf(UUID.c1, tid, w2, UUID.w2, c1, 'worker', 'L1b');
  tamperLeaf(tid, w1, (l) => { l.status = 'archived'; });
  tamperLeaf(tid, w2, (l) => { l.status = 'pruned'; });

  const r = await run(UUID.root, ['leaf', 'set-status', tid, c1, 'pruned']);
  if (!r.ok) { fail('Test-5 set-status pruned', r.error && r.error.msg); return; }
  const st = readState(tid);
  if (st.leaves[w1].status === 'archived') pass('W1 (archived) 终态不动', ''); else fail('W1 应保持 archived', st.leaves[w1].status);
  if (st.leaves[w2].status === 'pruned') pass('W2 (pruned) 终态不动', ''); else fail('W2 应保持 pruned', st.leaves[w2].status);
}

// ============================================================
// 测试 6: archived 父不级联（archived 是隐藏非删除）
// ============================================================
async function test_archived_no_cascade() {
  console.log('\n[Test-6] archived 父不级联（archived=隐藏非删除）');
  const tid = freshTreeId();
  await initTree(tid);
  const c1 = `${tid}-L1-commander`;
  const w1 = `${tid}-L1a-worker`;
  await addLeaf(UUID.root, tid, c1, UUID.c1, `${tid}-root`, 'commander', 'L1');
  await addLeaf(UUID.c1, tid, w1, UUID.w1, c1, 'worker', 'L1a');

  // archived 前置：collectValidateIssues 须通过（树结构合法即过）
  const r = await run(UUID.root, ['leaf', 'set-status', tid, c1, 'archived']);
  if (!r.ok) { fail('Test-6 set-status archived', r.error && r.error.code + ': ' + (r.error.msg || '').slice(0, 120)); return; }
  const st = readState(tid);
  if (st.leaves[c1].status === 'archived') pass('C1 自身 status=archived', ''); else fail('C1 status', st.leaves[c1].status);
  // fresh worker 初始 pending_brief；archived 不级联 → W1 应保持 pending_brief 未被触碰
  if (st.leaves[w1].status === 'pending_brief') pass('W1 不被 archived 级联（保持 pending_brief）', ''); else fail('W1 不应被级联', st.leaves[w1].status);
  const cascaded = (r.leaf && r.cascaded) || [];
  if (cascaded.length === 0) pass('result.cascaded 为空（archived 不级联）', ''); else fail('archived 不应有 cascaded', JSON.stringify(cascaded));
}

// ============================================================
// 测试 7: root 不被级联（防御性验证）
// ============================================================
async function test_root_not_cascaded() {
  console.log('\n[Test-7] root 不被级联（信任锚，parent=null 天然不可达）');
  const tid = freshTreeId();
  await initTree(tid);
  const c1 = `${tid}-L1-commander`;
  const w1 = `${tid}-L1a-worker`;
  await addLeaf(UUID.root, tid, c1, UUID.c1, `${tid}-root`, 'commander', 'L1');
  await addLeaf(UUID.c1, tid, w1, UUID.w1, c1, 'worker', 'L1a');

  // prune C1：root 不是 C1 的子，cascade 不会触达 root
  const r = await run(UUID.root, ['leaf', 'set-status', tid, c1, 'pruned']);
  if (!r.ok) { fail('Test-7 set-status pruned', r.error && r.error.msg); return; }
  const st = readState(tid);
  const rootId = `${tid}-root`;
  if (st.leaves[rootId].status === 'active') pass('root 保持 active（未被级联）', ''); else fail('root 不应变', st.leaves[rootId].status);
  // 额外防御：即便手工把 root 挂到某 leaf 下（不可能，parent 不可改），cascade 仍跳过 role=root
  const cascaded = (r.leaf && r.cascaded) || [];
  if (!cascaded.some((c) => c.leaf_id === rootId)) pass('result.cascaded 不含 root', ''); else fail('cascaded 不应含 root', '');
}

(async () => {
  console.log('============================================================');
  console.log('Sprint 3 Phase D / D1 — prune/archive 级联语义测试');
  console.log('ENGINE_PATH =', ENGINE_PATH);
  console.log('============================================================');
  try {
    await test_active_cascade_and_done_preserved();
    await test_recursive_cascade();
    await test_done_subtree_not_descended();
    await test_terminal_child_not_touched();
    await test_archived_no_cascade();
    await test_root_not_cascaded();
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
