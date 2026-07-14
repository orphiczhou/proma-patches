#!/usr/bin/env node
/**
 * sprint5-patches-bypass-test.cjs — Sprint 5 / 聚类 A: create_session 旁路根治 (patches.cjs) 测试 (2026-07-14)
 *
 * 被测改动 (proma-dev-patches.cjs, Sprint 5):
 *   - findCallerTreesForBypassGuard(sourceSessionId): 扫描所有 workspace trees_dir，定位 caller 所属 tree
 *   - create_session handler max_sessions 预检（session-count reached → E_MAX_SESSIONS，钱没花）
 *   - create 成功后旁路登记（register-session，让 SDK 原生 create_session 对 engine 可见）
 *   - tree_register_session / tree_session_count MCP 工具注册
 *
 * ⚠️ 测试局限（诚实声明，同 sprint3-d3/sprint4）：patches.cjs 顶层有 electron 副作用（require 会 hang），
 *    无法 require 整模块单测。故本文件 mirror 纯逻辑契约 + 源码静态校验。
 *
 * 测试矩阵:
 *   A. mirror 逻辑 (applyBypassGuardPrecheck): 无所属 tree→放行 / reached→拒绝 / 未 reached→放行+登记 / 多 tree 任一 reached→拒
 *   B. 源码静态: helper 定义+候选+non-fatal / 预检 E_MAX_SESSIONS+session-count+reached / 顺序 budget<预检<depth /
 *      登记 register-session+source / _pendingBypassRegister 连接 / 顺序 lineage<登记<log / MCP 工具注册
 */
'use strict';

const fs = require('fs');

const PATCHES_PATH = 'D:/codes/tree-harness/proma-dev-patches.cjs';
const SRC = fs.readFileSync(PATCHES_PATH, 'utf8');

// ============================================================
// mirror: create_session 旁路根治预检逻辑（与 patches.cjs create_session handler 同语义）
// ============================================================
//   ownerTrees      = findCallerTreesForBypassGuard(sourceSessionId) → [{trees_dir, tree_ids:[]}]
//   countsByTree    = { tree_id: {count, max, reached} }（每所属 tree 的 session-count 结果）
//   返回 { allow, code?, tree?, register? }
//     - 无所属 tree（caller 不在任何 tree 里 / 顶层 user）→ 放行，不登记
//     - 任一所属 tree reached（count>=max）→ 拒绝 E_MAX_SESSIONS
//     - 全部未 reached → 放行 + register=ownerTrees（create 成功后登记旁路 session）
function applyBypassGuardPrecheck(ownerTrees, countsByTree) {
  if (!ownerTrees || !ownerTrees.length) return { allow: true, register: null };
  for (const ot of ownerTrees) {
    for (const tid of ot.tree_ids) {
      const c = countsByTree[tid];
      if (c && c.reached) return { allow: false, code: 'E_MAX_SESSIONS', tree: tid };
    }
  }
  return { allow: true, register: ownerTrees };
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function assert(cond, name, info) { if (cond) pass(name, info); else fail(name, info); }

// 源码静态：包含 + 顺序 helper
function has(needle) { return SRC.includes(needle); }
function assertHas(needle, name) { assert(has(needle), name, has(needle) ? '' : `[missing snippet: ${String(needle).slice(0, 70)}]`); }
function assertOrder(a, b, name) {
  const ia = SRC.indexOf(a), ib = SRC.indexOf(b);
  assert(ia !== -1 && ib !== -1 && ia < ib, name, `order a@${ia} b@${ib} (need a<b)`);
}

console.log(`Sprint 5 patches bypass test — source: ${PATCHES_PATH} (${SRC.split('\n').length} lines)\n`);

// ============================================================
// A. mirror 逻辑契约
// ============================================================
console.log('[A] mirror 逻辑 applyBypassGuardPrecheck');
{
  // A1: 无所属 tree → 放行，不登记
  const r = applyBypassGuardPrecheck([], {});
  assert(r.allow === true && r.register === null, 'A1 无所属 tree → 放行不登记', JSON.stringify(r));
}
{
  // A2: 所属 tree reached → 拒绝 E_MAX_SESSIONS
  const r = applyBypassGuardPrecheck([{ trees_dir: '/x', tree_ids: ['t1'] }], { t1: { count: 50, max: 50, reached: true } });
  assert(r.allow === false && r.code === 'E_MAX_SESSIONS' && r.tree === 't1', 'A2 reached → 拒绝 E_MAX_SESSIONS', JSON.stringify(r));
}
{
  // A3: 所属 tree 未 reached → 放行 + 登记
  const ot = [{ trees_dir: '/x', tree_ids: ['t1'] }];
  const r = applyBypassGuardPrecheck(ot, { t1: { count: 3, max: 50, reached: false } });
  assert(r.allow === true && r.register === ot, 'A3 未 reached → 放行+登记', JSON.stringify({ allow: r.allow, hasReg: !!r.register }));
}
{
  // A4: 多 tree，任一 reached → 拒绝
  const r = applyBypassGuardPrecheck([{ trees_dir: '/x', tree_ids: ['t1', 't2'] }], { t1: { reached: false }, t2: { count: 50, max: 50, reached: true } });
  assert(r.allow === false && r.code === 'E_MAX_SESSIONS', 'A4 多 tree 任一 reached → 拒绝', JSON.stringify(r));
}
{
  // A5: 多 tree 全未 reached → 放行 + 登记（登记到全部所属 tree）
  const ot = [{ trees_dir: '/x', tree_ids: ['t1', 't2'] }];
  const r = applyBypassGuardPrecheck(ot, { t1: { reached: false }, t2: { reached: false } });
  assert(r.allow === true && r.register === ot, 'A5 多 tree 全未 reached → 放行+登记全部', JSON.stringify({ allow: r.allow, regTreeCount: r.register ? r.register[0].tree_ids.length : 0 }));
}

// ============================================================
// B. 源码静态校验（patches.cjs 实际实现）
// ============================================================
console.log('\n[B] 源码静态校验 patches.cjs');

// B1: helper 定义
assertHas('function findCallerTreesForBypassGuard(sourceSessionId)', 'B1 findCallerTreesForBypassGuard 定义');
// B2: helper 调 engine.findTreesBySession
assert(has('treeEngine.findTreesBySession') || has('.findTreesBySession('), 'B2 helper 调 findTreesBySession');
// B3: helper 扫描两候选 trees_dir
assertHas('workspace-files", ".context", "trees"', 'B3 helper 候选 workspace-files/.context/trees');
assertHas('".context", "trees"', 'B4 helper 候选 .context/trees');
// B5: helper non-fatal（无 sourceSessionId 返回 []）
assertHas('if (!sourceSessionId) return [];', 'B5 helper 无 caller → []');

// B6: create_session 含 max_sessions 预检 E_MAX_SESSIONS
assertHas("'E_MAX_SESSIONS'", 'B6 create_session 预检抛 E_MAX_SESSIONS');
// B7: 预检用 session-count
assertHas("['session-count', _tid]", 'B7 预检用 session-count 命令');
// B8: 预检用 reached 判定
assertHas('_sc.reached', 'B8 预检判 reached');
// B9: 预检 non-fatal 降级
assertHas('max_sessions bypass precheck skipped (non-fatal)', 'B9 预检 non-fatal 降级');

// B10: 顺序 — budget(checkCreateSessionBudget) < max_sessions 预检 < delegationDepth
assertOrder('checkCreateSessionBudget(sourceSessionId)', 'max_sessions bypass precheck', 'B10 顺序 budget < max_sessions 预检');
assertOrder('聚类A 旁路根治', 'delegationDepth 预检', 'B11 顺序 max_sessions 预检 < delegationDepth');

// B12: 登记 register-session + source create_session
assertHas("['register-session', _tid", 'B12 登记调 register-session');
assertHas("'--source', 'create_session'", 'B13 登记标记 source=create_session');
// B14: _pendingBypassRegister 连接预检与登记
assertHas('_pendingBypassRegister', 'B14 _pendingBypassRegister 变量');
assertOrder('_pendingBypassRegister = _ownerTrees', '_pendingBypassRegister && meta', 'B15 _pendingBypassRegister 预检赋值 < 登记消费');
// B16: 登记顺序 — lineage write < 登记 < "Session created" log
assertOrder('lineage write failed', 'bypass session register', 'B16 顺序 lineage write < 旁路登记');
assertOrder('bypass session register', 'Session created:', 'B17 顺序 旁路登记 < Session created log');
// B18: 登记 non-fatal
assertHas('bypass session register to tree', 'B18 登记 non-fatal 降级');

// B19/B20: MCP 工具注册
assertHas('tt("tree_register_session"', 'B19 tree_register_session MCP 工具注册');
assertHas('tt("tree_session_count"', 'B20 tree_session_count MCP 工具注册');
assertHas('["tree", "session-count", a.tree_id]', 'B21 tree_session_count argBuilder 用 session-count');
// B22: tree_session_count 只读（出现于 tree_tree_dump 只读工具附近，含 readOnly true 参数）— 校验其 argBuilder 后有 , true)
{
  const idx = SRC.indexOf('tt("tree_session_count"');
  const snippet = SRC.slice(idx, idx + 400);
  assert(snippet.includes(', true)'), 'B22 tree_session_count readOnly=true', snippet.slice(0, 120).replace(/\n/g, ' '));
}

console.log(`\n============================================================`);
console.log(`Sprint 5 patches bypass: ${stats.passed} passed, ${stats.failed} failed`);
console.log(`============================================================`);
process.exit(stats.failed ? 1 : 0);
