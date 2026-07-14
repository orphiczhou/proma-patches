#!/usr/bin/env node
/**
 * sprint4-patches-test.cjs — Sprint 4 patches.cjs 专项测试 (2026-07-14)
 *
 * 覆盖两项 patches 层改动:
 *   [Task 1 / 跨工作区 P1] create_session + fork_session agent 调用方工作区锁定
 *       (E_WORKSPACE_FORBIDDEN + 未指定强制到调用方 workspace, cross-workspace-tree-issue §五 P1 Part B)
 *   [Task 3 / TAO Watcher] rule 分发按 leaf.role (RULE_ROLE_SCOPE 中心表 + maybeForLeaf 结构防御)
 *
 * ⚠️ 测试局限（诚实声明，同 sprint3-d3）：patches.cjs 顶层有 electron 副作用（require 会 hang），
 *    无法 require 整模块单测。故本文件 mirror 纯逻辑做契约测试 + 源码静态校验（含表↔函数 guard
 *    一致性回归检查，防止 RULE_ROLE_SCOPE 与各 rule 函数自过滤漂移）。
 *    若未来 patches.cjs 导出这些纯函数，应改 require 实测。
 *
 * 测试矩阵:
 *   Task 1: 顶层 user 不受限 / agent 无 workspace_id→强制 / agent 同 workspace→放行 /
 *           agent 跨 workspace→FORBIDDEN / callerWs 取不到→best-effort 放行 / fork 同类
 *   Task 3: worker 规则不发 root(a8111bf5 不变式) / commander 专属 / commander+root /
 *           null-scope 全 role / 表↔guard 一致性(静态)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PATCHES_PATH = 'D:/codes/tree-harness/proma-dev-patches.cjs';

// ============================================================
// Task 1 mirror: agent 调用方工作区锁定 (create_session / fork_session Part B 共享语义)
// ============================================================
//   sourceSessionId = 调用方 session (存在=agent 调用; 缺=顶层 user/automation)
//   requestedWs     = 调用方显式传的 workspace_id (create_session) 或 new_workspace_id (fork)
//   callerWs        = 调用方 meta.workspaceId (getAgentSessionMeta 取)
//   返回 {allow, workspaceId, code?}
function applyCallerWorkspaceLock(sourceSessionId, requestedWs, callerWs) {
  if (!sourceSessionId) return { allow: true, workspaceId: requestedWs };  // 顶层 user/automation 不受限
  if (!callerWs) return { allow: true, workspaceId: requestedWs };          // 取不到 caller ws, best-effort 放行
  if (requestedWs && requestedWs !== callerWs) {
    return { allow: false, code: 'E_WORKSPACE_FORBIDDEN' };                 // 显式跨 → 拒绝
  }
  if (!requestedWs) {
    return { allow: true, workspaceId: callerWs };                          // 未指定 → 强制到 caller ws
  }
  return { allow: true, workspaceId: requestedWs };                         // 同 workspace → 放行
}

// ============================================================
// Task 3 mirror: rule 按 role 分发 (与 patches.cjs RULE_ROLE_SCOPE 同表)
// ============================================================
const RULE_ROLE_SCOPE = {
  'C-02': null,
  'C-03': null,
  'C-06': ['commander'],
  'W-AUDIT-SELF': null,
  'W-AUDIT-WORKER': null,
  'W-AUDIT-TAMPER': null,
  'W-AUDIT-NO-ALIGN': ['worker'],
  'W-01': ['worker'],
  'W-08': ['worker'],
  'W-11': ['worker'],
  'W-12': ['worker'],
  'C-11': ['commander', 'root'],
};
function ruleAppliesToRole(ruleId, role) {
  const scope = RULE_ROLE_SCOPE[ruleId];
  if (!scope) return true;
  return scope.includes(role);
}

// ============================================================
// Task 4 mirror: nudge_log cap (applyNudge 写入后截断, P1-S05 命运决策落地)
// ============================================================
//   cap>0 且 log 超 cap → 保留最近 cap 条, 累计丢弃数记到专用计数器 droppedTotal
//   (独立于哪些条目存活, 永远准确). cap<=0 → 关闭 (不截断).
//   与 patches.cjs applyNudge 内 cap 逻辑一致 (leaf.nudge_log_dropped_total).
function applyNudgeLogCap(nudge_log, droppedTotal, cap) {
  const log = nudge_log.slice();
  const prevTotal = (typeof droppedTotal === 'number') ? droppedTotal : 0;
  if (cap > 0 && log.length > cap) {
    const dropped = log.length - cap;
    return { log: log.slice(-cap), droppedTotal: prevTotal + dropped, droppedThisRound: dropped };
  }
  return { log, droppedTotal: prevTotal, droppedThisRound: 0 };
}

// ============================================================
// 测试框架
// ============================================================
const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// ============================================================
// Task 1 测试
// ============================================================
function testTask1() {
  console.log('\n[Task 1] agent 调用方工作区锁定 (create_session / fork_session Part B)');
  const WS_A = 'ws-aaaa-1111';
  const WS_B = 'ws-bbbb-2222';

  // 1. 顶层 user/automation (无 sourceSessionId) → 不受限, 原样放行 (即使跨 workspace)
  {
    const r = applyCallerWorkspaceLock(null, WS_B, WS_A);
    if (r.allow && r.workspaceId === WS_B) pass('顶层 user 跨 workspace 放行 (admin 操作)');
    else fail('顶层 user 应放行', JSON.stringify(r));
  }
  // 2. agent 调用方, 未传 workspace_id → 强制到 caller ws (防 undefined 漂移)
  {
    const r = applyCallerWorkspaceLock('sess-caller', null, WS_A);
    if (r.allow && r.workspaceId === WS_A) pass('agent 未指定 workspace → 强制到 caller ws');
    else fail('agent 未指定应强制到 caller ws', JSON.stringify(r));
  }
  // 3. agent 调用方, workspace_id === caller ws → 放行不变
  {
    const r = applyCallerWorkspaceLock('sess-caller', WS_A, WS_A);
    if (r.allow && r.workspaceId === WS_A) pass('agent 同 workspace → 放行');
    else fail('agent 同 workspace 应放行', JSON.stringify(r));
  }
  // 4. agent 调用方, workspace_id !== caller ws → E_WORKSPACE_FORBIDDEN (核心: 堵漂移)
  {
    const r = applyCallerWorkspaceLock('sess-caller', WS_B, WS_A);
    if (!r.allow && r.code === 'E_WORKSPACE_FORBIDDEN') pass('agent 跨 workspace → E_WORKSPACE_FORBIDDEN (堵 9 工作区漂移)');
    else fail('agent 跨 workspace 应 FORBIDDEN', JSON.stringify(r));
  }
  // 5. agent 调用方, callerWs 取不到 (meta 缺字段) → best-effort 放行 (与 validateWorkspaceId house style 一致)
  {
    const r = applyCallerWorkspaceLock('sess-caller', WS_B, null);
    if (r.allow) pass('callerWs 取不到 → best-effort 放行 (非阻断)');
    else fail('callerWs 取不到应放行', JSON.stringify(r));
  }
  // 6. fork_session 语义同 (new_workspace_id 路径) — 同一 helper 覆盖
  {
    const r = applyCallerWorkspaceLock('sess-caller', WS_B, WS_A);
    if (!r.allow && r.code === 'E_WORKSPACE_FORBIDDEN') pass('fork_session new_workspace_id 跨 workspace → 同样 FORBIDDEN');
    else fail('fork 应同样 FORBIDDEN', JSON.stringify(r));
  }
}

// ============================================================
// Task 3 测试
// ============================================================
function testTask3() {
  console.log('\n[Task 3] TAO Watcher rule 按 leaf.role 分发');

  // a8111bf5 不变式: worker 规则绝不发给 root/commander/auditor
  const workerRules = ['W-01', 'W-08', 'W-11', 'W-12', 'W-AUDIT-NO-ALIGN'];
  for (const rid of workerRules) {
    if (ruleAppliesToRole(rid, 'worker')) pass(`${rid} → worker 适用`);
    else fail(`${rid} 应适用于 worker`);
    if (!ruleAppliesToRole(rid, 'root')) pass(`${rid} → root 不适用 (a8111bf5 不变式)`);
    else fail(`${rid} 不应发给 root (a8111bf5 根因)`);
    if (!ruleAppliesToRole(rid, 'commander')) pass(`${rid} → commander 不适用`);
    else fail(`${rid} 不应发给 commander`);
    if (!ruleAppliesToRole(rid, 'auditor')) pass(`${rid} → auditor 不适用`);
    else fail(`${rid} 不应发给 auditor`);
  }

  // commander 专属
  if (ruleAppliesToRole('C-06', 'commander')) pass('C-06 → commander 适用');
  if (!ruleAppliesToRole('C-06', 'worker')) pass('C-06 → worker 不适用');

  // commander + root
  if (ruleAppliesToRole('C-11', 'commander') && ruleAppliesToRole('C-11', 'root')) pass('C-11 → commander+root 适用');
  if (!ruleAppliesToRole('C-11', 'worker')) pass('C-11 → worker 不适用');

  // null-scope: 全 role 适用 (规则自带更细条件, 如 W-AUDIT-SELF root 例外)
  const nullScopeRules = ['C-02', 'C-03', 'W-AUDIT-SELF', 'W-AUDIT-WORKER', 'W-AUDIT-TAMPER'];
  for (const rid of nullScopeRules) {
    let allTrue = ['root', 'commander', 'worker', 'auditor'].every(r => ruleAppliesToRole(rid, r));
    if (allTrue) pass(`${rid} → null-scope 全 role 适用 (函数内自过滤)`);
    else fail(`${rid} null-scope 应适用所有 role`);
  }
}

// ============================================================
// Task 4 测试: nudge_log cap (P1-S05 命运决策落地)
// ============================================================
function testTask4() {
  console.log('\n[Task 4] nudge_log cap (P1-S05 保留+补可观测)');

  // 1. log 未超 cap → 不截断, droppedThisRound=0, droppedTotal 不变
  {
    const log = [{ rule_id: 'W-01' }, { rule_id: 'W-08' }];
    const r = applyNudgeLogCap(log, 0, 50);
    if (r.droppedThisRound === 0 && r.log.length === 2 && r.droppedTotal === 0) pass('nudge_log 未超 cap → 不截断');
    else fail('未超 cap 应不截断', JSON.stringify(r));
  }
  // 2. log 超 cap → 截到 cap 条, droppedThisRound>0, droppedTotal=本轮
  {
    const log = [];
    for (let i = 0; i < 60; i++) log.push({ rule_id: 'W-01', n: i });
    const r = applyNudgeLogCap(log, 0, 50);
    if (r.droppedThisRound === 10 && r.log.length === 50 && r.droppedTotal === 10) {
      pass('nudge_log 超 cap → 截到 50 条 + droppedTotal=10 (防 macp2b 15052 膨胀)');
    } else fail('超 cap 应截到 50 + droppedTotal=10', JSON.stringify(r));
  }
  // 3. cap<=0 → 关闭 (不截断, 即使 log 很长)
  {
    const log = [];
    for (let i = 0; i < 100; i++) log.push({ rule_id: 'W-01' });
    const r = applyNudgeLogCap(log, 0, 0);
    if (r.droppedThisRound === 0 && r.log.length === 100) pass('cap=0 → 关闭截断 (保留全部)');
    else fail('cap=0 应不截断', JSON.stringify(r));
  }
  // 4. 多次截断 droppedTotal 累加 (专用计数器独立于条目存活, 永远准确)
  {
    let log = [];
    for (let i = 0; i < 60; i++) log.push({ rule_id: 'W-01' });
    let r = applyNudgeLogCap(log, 0, 50);            // 第一次: droppedThisRound 10, total 10
    log = r.log;
    for (let i = 0; i < 30; i++) log.push({ rule_id: 'W-08' });  // 涨到 80
    r = applyNudgeLogCap(log, r.droppedTotal, 50);   // 第二次: droppedThisRound 30, total 40
    if (r.log.length === 50 && r.droppedTotal === 40 && r.droppedThisRound === 30) {
      pass('多次截断 droppedTotal 累加 (10+30=40, 专用计数器独立于条目存活)');
    } else fail('多次截断应 droppedTotal=40', JSON.stringify(r));
  }
  // 5. 保留的是最近 cap 条 (slice(-cap)), 非最旧
  {
    const log = [];
    for (let i = 0; i < 55; i++) log.push({ rule_id: 'W-01', seq: i });
    const r = applyNudgeLogCap(log, 0, 50);
    if (r.log.length === 50 && r.log[0].seq === 5 && r.log[49].seq === 54) {
      pass('截断保留最近 50 条 (seq 5..54), 丢弃最旧 5 条');
    } else fail('应保留最近 cap 条', JSON.stringify({ first: r.log[0], last: r.log[49] }));
  }
}

// ============================================================
// 源码静态校验 (防 mirror 与实际脱节 + 表↔guard 一致性回归)
// ============================================================
function verifySource() {
  console.log('\n[Source] 静态校验 patches.cjs 含 Sprint 4 改动 + 表↔guard 一致性');
  const src = fs.readFileSync(PATCHES_PATH, 'utf8');

  // --- Task 1 静态校验 ---
  const t1Checks = [
    ['create_session E_WORKSPACE_FORBIDDEN 锁', /E_WORKSPACE_FORBIDDEN/],
    ['create_session caller-workspace lock 注释', /caller-workspace lock/],
    ['create_session Part B 强制 caller ws (workspaceId = _callerWs)', /workspaceId = _callerWs/],
    ['fork_session caller-workspace lock 注释', /\[fork_session\] caller-workspace lock/],
    ['fork_session new_workspace_id FORBIDDEN', /E_WORKSPACE_FORBIDDEN[\s\S]*fork_session rejected/],
  ];
  for (const [name, re] of t1Checks) {
    if (re.test(src)) pass(`[T1 源码] ${name}`);
    else fail(`[T1 源码] ${name}`, '未在 patches.cjs 找到');
  }

  // --- Task 3 静态校验 ---
  const t3Checks = [
    ['RULE_ROLE_SCOPE 中心表定义', /const RULE_ROLE_SCOPE\s*=/],
    ['ruleAppliesToRole helper', /function ruleAppliesToRole\s*\(/],
    ['maybeForLeaf 结构分发 helper', /function maybeForLeaf\s*\(/],
    ['Tier 1 分发改 maybeForLeaf (C-02)', /maybeForLeaf\("C-02"/],
    ['Tier 1 分发改 maybeForLeaf (W-AUDIT-NO-ALIGN)', /maybeForLeaf\("W-AUDIT-NO-ALIGN"/],
    ['Tier 2 分发改 maybeForLeaf (W-01)', /maybeForLeaf\("W-01"/],
    ['Tier 2 分发改 maybeForLeaf (C-11)', /maybeForLeaf\("C-11"/],
    ['表注释 a8111bf5 根因标注', /a8111bf5 根因/],
  ];
  for (const [name, re] of t3Checks) {
    if (re.test(src)) pass(`[T3 源码] ${name}`);
    else fail(`[T3 源码] ${name}`, '未在 patches.cjs 找到');
  }

  // --- Task 4 静态校验 (P1-S05 命运决策: nudge_log cap) ---
  const t4Checks = [
    ['applyNudge nudge_log cap 逻辑', /nudge_log capped to/],
    ['cap 专用累计计数器 nudge_log_dropped_total', /nudge_log_dropped_total/],
    ['cap 默认 50 (applyNudge 内)', /_nudgeLogCap.*50/],
    ['loadTaoConfig 合并默认 nudge_log_cap', /nudge_log_cap:\s*50/],
    ['config-patch 白名单含 nudge_log_cap', /"nudge_log_cap"/],
    ['P1-S05 命运决策注释', /P1-S05 命运决策落地/],
  ];
  for (const [name, re] of t4Checks) {
    if (re.test(src)) pass(`[T4 源码] ${name}`);
    else fail(`[T4 源码] ${name}`, '未在 patches.cjs 找到');
  }

  // --- 表↔guard 一致性 (核心回归检查) ---
  // 对每个 scoped rule, 提取其函数体的首个 role guard, 断言与 RULE_ROLE_SCOPE 一致.
  // 对 null-scope rule, 断言函数体无 `leaf.role !==` 硬 guard (靠更细条件或无 role 维度).
  console.log('\n[Source] 表↔函数 guard 一致性 (回归核心)');
  const ruleFns = {
    'C-06': 'ruleC06',
    'W-AUDIT-NO-ALIGN': 'ruleAuditNoAlign',
    'W-01': 'ruleW01',
    'W-08': 'ruleW08',
    'W-11': 'ruleW11',
    'W-12': 'ruleW12',
    'C-11': 'ruleC11',
    'C-02': 'ruleC02',
    'C-03': 'ruleC03',
    'W-AUDIT-SELF': 'ruleAuditSelf',
    'W-AUDIT-WORKER': 'ruleAuditWorker',
    'W-AUDIT-TAMPER': 'ruleAuditTamper',
  };
  for (const [ruleId, fnName] of Object.entries(ruleFns)) {
    // 提取 function fnName(...) { 到下一个 function 之间 (函数体)
    const re = new RegExp('function ' + fnName + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\(?function ', 'm');
    const m = src.match(re);
    if (!m) { fail(`${ruleId}/${fnName} 函数体未提取到`, 'regex 未命中'); continue; }
    const body = m[1].slice(0, 400);  // 只看开头 guard 区
    const scope = RULE_ROLE_SCOPE[ruleId];
    if (scope) {
      // scoped: 函数体应含 role guard. 简化校验: 含 leaf.role !== 且首个匹配的 role 在 scope 内
      const guardMatch = body.match(/leaf\.role\s*!==\s*"(\w+)"/);
      if (guardMatch && scope.includes(guardMatch[1])) {
        pass(`${ruleId} 函数 guard (role!==${guardMatch[1]}) 与 scope ${JSON.stringify(scope)} 一致`);
      } else if (ruleId === 'C-11') {
        // C-11 是双 role guard (commander && root), 单独校验
        if (/role\s*!==\s*"commander"\s*&&\s*leaf\.role\s*!==\s*"root"/.test(body)) {
          pass('C-11 双 role guard (commander && root) 与 scope 一致');
        } else fail('C-11 guard 应为 commander && root', body.slice(0, 120));
      } else {
        fail(`${ruleId} guard 与 scope 不一致`, 'guard=' + (guardMatch ? guardMatch[0] : '(无)') + ' scope=' + JSON.stringify(scope));
      }
    } else {
      // null-scope: 函数体不应有硬 role guard (规则靠更细条件, 不靠 role)
      const hasHardGuard = /leaf\.role\s*!==\s*"/.test(body);
      if (!hasHardGuard) pass(`${ruleId} null-scope, 函数无硬 role guard (一致)`);
      else {
        // W-AUDIT-SELF 例外: 有 root 自审例外 (role === root return), 非 role!=== 硬 guard
        if (ruleId === 'W-AUDIT-SELF' && /role\s*===\s*"root"/.test(body)) {
          pass('W-AUDIT-SELF null-scope + root 自审例外 (一致, 非硬 role! guard)');
        } else {
          fail(`${ruleId} null-scope 但函数含硬 role guard (不一致, 可能回归)`, body.slice(0, 120));
        }
      }
    }
  }
}

// ============================================================
// 主流程
// ============================================================
testTask1();
testTask3();
testTask4();
verifySource();

console.log(`\n${'='.repeat(60)}`);
console.log(`Sprint 4 patches 专项: ${stats.passed} 通过, ${stats.failed} 失败`);
console.log(`${'='.repeat(60)}`);
process.exit(stats.failed > 0 ? 1 : 0);
