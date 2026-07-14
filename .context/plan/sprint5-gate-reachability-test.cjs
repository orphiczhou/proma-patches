#!/usr/bin/env node
/**
 * sprint5-gate-reachability-test.cjs — Sprint 5 / 聚类 B: 门禁前置可达性静态审计测试 (2026-07-14)
 *
 * 任务3 交付：审计 done 门禁链 + max_sessions 是否存在「绕过链」（聚类 B 根因：门禁互相架空/协议编队不可达）。
 *
 * 审计方法：源码静态校验（grep 引擎不变式）。这是**回归保护**——防止未来改动重新引入绕过链
 *   （历次 P0 多为「文档/修复失同步」，如有人重新加 done event 自动同步、或新增 session 写入不登记，本测试即抓）。
 *
 * 审计结论（2026-07-14）：
 *   1. done 门禁单一入口（P0-S03 修复完整）：status=done 无字面量赋值，只经 cmdLeafSetStatus `leaf.status = new_status`
 *   2. done event 不自动同步 status（cmdEventAppend done 路径无 leaf.status 赋值）
 *   3. done event caller-binding（E_BORROWED_IDENTITY 防 commander 谎报 worker done）
 *   4. review_round/subagent_spawn append 前置校验（防 events 污染绕过 done 门禁）
 *   5. max_sessions session 写入路径完整（registerSessionToState 4 调用点：init/add/set-session/register）
 *   6. PENDING_ROOT 不占额度（registerSessionToState 跳过）
 *   → 无新绕过链需修复。历史修复（P0-S03/S04、P1-S03、P2-S02）+ max_sessions 完整登记 = done 门禁链前置可达。
 */
'use strict';

const fs = require('fs');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const SRC = fs.readFileSync(ENGINE_PATH, 'utf8');

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function assert(cond, name, info) { if (cond) pass(name, info); else fail(name, info); }

function countOccurrences(needle) {
  let c = 0, i = SRC.indexOf(needle);
  while (i !== -1) { c++; i = SRC.indexOf(needle, i + 1); }
  return c;
}

console.log(`Sprint 5 gate-reachability audit — source: ${ENGINE_PATH} (${SRC.split('\n').length} lines)\n`);

// ============================================================
// 1. done 门禁单一入口（P0-S03 修复完整性回归保护）
// ============================================================
console.log('[1] done 门禁单一入口（P0-S03）');
{
  // status=done 无字面量赋值（.status = 'done' 不应存在）→ 证明只经 cmdLeafSetStatus = new_status
  //   失守场景：若有人重新加 `leaf.status = 'done'`（如 done event 自动同步），即绕过 8 门禁。
  const literalDoneAssign = countOccurrences(".status = 'done'");
  assert(literalDoneAssign === 0, '1a 无 `.status = \'done\'` 字面量赋值（单一入口）', `found ${literalDoneAssign}（应为 0；status=done 只经 cmdLeafSetStatus = new_status）`);
}
{
  // cmdLeafSetStatus 是 status 写入入口（含 new_status === 'done' 门禁分支）
  assert(SRC.includes("if (new_status === 'done')"), '1b cmdLeafSetStatus 含 done 门禁分支', '');
  // STATUS_TRANSITIONS 含 'done'（流转白名单）
  assert(SRC.includes("if (status === 'done')"), '1c STATUS_TRANSITIONS 含 done 流转', '');
}

// ============================================================
// 2. done event 不自动同步 status（cmdEventAppend done 路径无 leaf.status 赋值）
// ============================================================
console.log('\n[2] done event 不自动同步 status（P0-S03 根因修复）');
{
  // 定位 cmdEventAppend 函数体（async function cmdEventAppend ... 到下一个 async function）
  const fnStart = SRC.indexOf('async function cmdEventAppend');
  assert(fnStart !== -1, '2a cmdEventAppend 函数定位', fnStart !== -1 ? '' : 'NOT FOUND');
  if (fnStart !== -1) {
    const nextFn = SRC.indexOf('async function cmd', fnStart + 1);
    const fnBody = SRC.slice(fnStart, nextFn !== -1 ? nextFn : SRC.length);
    // done event 路径不应有 leaf.status = 赋值（自动同步已删）—— 排除注释行（注释含历史说明 leaf.status='done'）
    const codeLines = fnBody.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; });
    const hasStatusAssign = codeLines.some(l => /\.status\s*=\s*[^=]/.test(l));
    assert(!hasStatusAssign, '2b cmdEventAppend 代码行无 leaf.status 赋值（done event 不自动同步 status；注释历史说明已排除）', hasStatusAssign ? 'FOUND status assign in event_append code!' : '');
    // done event 路径有 caller-binding（E_BORROWED_IDENTITY）
    assert(fnBody.includes("opts.type === 'done'") && fnBody.includes('E_BORROWED_IDENTITY'), '2c done event caller-binding（E_BORROWED_IDENTITY）', '');
    // root done auto_upgrade 注释存在（信任锚机制文档化）
    assert(fnBody.includes('auto_upgrade'), '2d root done auto_upgrade（信任锚）', '');
  }
}

// ============================================================
// 3. review_round / subagent_spawn append 前置校验（防 events 污染绕过 done 门禁）
// ============================================================
console.log('\n[3] append 前置校验（macp3 复盘：防 events 污染）');
{
  const fnStart = SRC.indexOf('async function cmdEventAppend');
  const nextFn = SRC.indexOf('async function cmd', fnStart + 1);
  const fnBody = SRC.slice(fnStart, nextFn !== -1 ? nextFn : SRC.length);
  assert(fnBody.includes("opts.type === 'review_round'") && fnBody.includes('validateReviewRoundSchema'), '3a review_round append 即校验（防污染绕过 done 门禁）', '');
  assert(fnBody.includes("opts.type === 'subagent_spawn'") && fnBody.includes('E_SUBAGENT_BUDGET_EXCEEDED'), '3b subagent_spawn append 即预算校验', '');
}

// ============================================================
// 4. max_sessions session 写入路径完整（聚类 A+E，Sprint 5 新增护栏的绕过链审计）
// ============================================================
console.log('\n[4] max_sessions session 写入路径完整');
{
  // registerSessionToState 在 4 个 session 写入路径调用
  //   cmdInit（root）/ cmdLeafAdd / cmdLeafSetSession / cmdTreeRegisterSession
  const callSites = SRC.split('\n').map((l, i) => ({ l, n: i + 1 })).filter(x => x.l.includes('registerSessionToState(state'));
  assert(callSites.length >= 4, `4a registerSessionToState ≥4 调用点`, `found ${callSites.length}: ${callSites.map(c => c.n).join(',')}`);
  // 各路径特征：init root / leaf_add / set_session / register
  assert(SRC.includes("registerSessionToState(state, rootSessionId"), '4b cmdInit root 登记', '');
  assert(SRC.includes("registerSessionToState(state, session_id, { leaf_id, source: 'leaf_add'"), '4c cmdLeafAdd 登记', '');
  assert(SRC.includes("registerSessionToState(state, new_session_id, { leaf_id, source: 'set_session'"), '4d cmdLeafSetSession 登记（堵绕过链）', '');
  assert(SRC.includes("registerSessionToState(state, session_id, { leaf_id: null, source"), '4e cmdTreeRegisterSession 登记', '');
}
{
  // PENDING_ROOT 不占额度（registerSessionToState 跳过逻辑）
  const fnStart = SRC.indexOf('function registerSessionToState');
  const fnBody = SRC.slice(fnStart, SRC.indexOf('\n}', fnStart) + 2);
  assert(fnBody.includes("sessionId === PENDING_ROOT") && fnBody.includes('UUID_RE.test(sessionId)'), '4f PENDING_ROOT/非UUID 跳过（不占额度）', '');
  // migrate 规则14 回灌
  assert(SRC.includes('规则 14') && SRC.includes('session_registry') && SRC.includes('backfill leaf sessions into registry'), '4g migrate 规则14 回灌 session_registry', '');
  // countSessions 兜底（registry 缺失 → leaves distinct session 重建）
  const cfnStart = SRC.indexOf('function countSessions');
  const cfnBody = SRC.slice(cfnStart, SRC.indexOf('\n}', cfnStart) + 2);
  assert(cfnBody.includes('Set') && cfnBody.includes('session_id'), '4h countSessions 兜底（registry 缺失从 leaves 重建）', '');
}

// ============================================================
// 5. max_sessions 错误码导出（供验收断言）
// ============================================================
console.log('\n[5] E_MAX_SESSIONS 导出');
{
  assert(SRC.includes("const E_MAX_SESSIONS = 'E_MAX_SESSIONS';"), '5a E_MAX_SESSIONS 常量定义', '');
  assert(SRC.includes('E_MAX_SESSIONS,'), '5b E_MAX_SESSIONS 导出（ERRORS）', '');
  assert(SRC.includes('max_sessions: 50'), '5c DEFAULT_AUDIT_META.max_sessions=50', '');
}

console.log(`\n============================================================`);
console.log(`Sprint 5 gate-reachability audit: ${stats.passed} passed, ${stats.failed} failed`);
console.log(`============================================================`);
process.exit(stats.failed ? 1 : 0);
