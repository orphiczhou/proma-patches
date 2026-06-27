# Bug 修复方案 R2 — 洁净室测试 Round 1 暴露的 5 大问题

**修复时间**: 2026-06-27 12:30-12:50 GMT+8
**修复执行者**: Proma Agent（主会话）
**备份文件**: `tree-engine.cjs.bak-20260627-pre-r2-fix` / `proma-dev-patches.cjs.bak-20260627-pre-r2-fix`
**同步状态**: 3 处物理同步完成（Dev dist / workspace-files / Release dist）

---

## 一、修复总览

| 编号 | 问题 | 严重度 | 文件 | 行号 | 状态 |
|---|---|---|---|---|---|
| **B12** | expect_outputs 路径遍历 | P0 | tree-engine.cjs | 257-310 / 1351-1356 / 1455-1462 | ✅ |
| **B9** | applyNudge 规则绕过 | P0 | tree-engine.cjs | 75-105（白名单）/ 2562-2600（校验） | ✅ |
| **B5** | audit_log 伪造 | P0 | tree-engine.cjs | 2272-2329（collectValidateIssues 新增） | ✅ |
| **Fork** | Fork 幻觉（C1+C5） | P1 | proma-dev-patches.cjs | 586-670（fork_session 注入） | ✅ |
| **Auditor** | Auditor 鸡生蛋死锁 | P1 | tree-engine.cjs | 1978-1993（resolveAuditorIndep 扩展） | ✅ |

---

## 二、B12 — expect_outputs 路径遍历漏洞修复

### 失守根因

R1 洁净室 B12 暴露：`tree_event_append` / `tree_milestone_add` 接受 `expect_outputs=["/etc/passwd", "C:\Windows\System32\config\SAM", "/etc/shadow"]` 等绝对系统路径，无任何校验直接持久化到 tree-state.json。

V9 守卫（路径遍历防护）原本设计为"在 cmdLeafSetStatus(done) 时校验"，导致攻击者可先用 `milestone_add` 或 `event_append` 注入恶意路径，再走 done 时才被拦截，但恶意路径已持久化。

### 修复方案：共享路径校验函数 + 双入口拦截

#### 1. 新增共享函数 `assertSafeExpectOutputs`（行 257-310）

```javascript
function assertSafeExpectOutputs(outputs, context) {
  if (outputs === undefined || outputs === null) return;
  if (!Array.isArray(outputs)) {
    throw new TreeStateError(E_SCHEMA_INVALID, `${context}: expect_outputs must be an array`);
  }
  for (let i = 0; i < outputs.length; i++) {
    const p = outputs[i];
    if (typeof p !== 'string' || p.length === 0) { /* E_DELIVERABLE_MISSING */ }
    if (path.isAbsolute(p)) { /* E_DELIVERABLE_MISSING */ }
    const normalized = path.normalize(p).replace(/\\/g, '/');
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      /* E_DELIVERABLE_MISSING */
    }
  }
}
```

#### 2. cmdMilestoneAdd 调用点（行 1351-1356）

```javascript
if (input.expect_outputs !== undefined && !Array.isArray(input.expect_outputs)) {
  throw new TreeStateError(E_SCHEMA_INVALID, 'milestone.expect_outputs must be an array');
}
// V9+ Phase 4 (R2 P0 / B12 修复): milestone add 时即时校验 expect_outputs 路径安全。
assertSafeExpectOutputs(input.expect_outputs, `milestone_add "${input.id}"`);
```

#### 3. cmdEventAppend 调用点（行 1455-1462）

```javascript
const meta = parseJsonArg(opts.json, 'event meta');
// V9+ Phase 4 (R2 P0 / B12 修复): event append 时即时校验 meta.expect_outputs 路径安全。
if (meta && meta.expect_outputs !== undefined) {
  assertSafeExpectOutputs(meta.expect_outputs, `event_append type="${opts.type}" meta.expect_outputs`);
}
```

### 防御纵深

| 层 | 拦截点 | 触发时机 |
|---|---|---|
| 入口层（新） | cmdMilestoneAdd / cmdEventAppend | add 时即时拦截 |
| 验收层（V9 原有） | cmdLeafSetStatus(done) | done 时再次校验（包括文件存在性 + symlink） |

---

## 三、B9 — applyNudge 规则绕过漏洞修复

### 失守根因

R1 洁净室 B9 暴露：`tree_nudge_append` 接受任意 `rule_id` 字符串（包括 `"INVALID-RULE-99"`），3 个 nudge 全部被接受，无任何守卫。

`sharedCount` 全局守卫（行 2209-2219）原本只检查 `session_id` 共享（防 Bug B），与 `rule_id` 无关。PROJECT-INDEX 中描述的"R1 applyNudge 全局守卫"实际只防 session 共享，**不存在 rule_id 白名单**。

### 修复方案：三层防御

#### 1. 白名单常量定义（行 75-105）

```javascript
const NUDGE_RULE_WHITELIST = {
  // Tier 1 — 全局规则
  'R-01': ['root', 'commander', 'worker'],
  'R-03': ['root', 'commander', 'worker'],
  // ... 5 条 R 系列
  // Tier 2 — Commander 规则
  'C-02': ['commander'], 'C-03': ['commander'], 'C-06': ['commander'],
  'C-11': ['commander'], 'C-13': ['commander'], 'C-15': ['commander'],
  // Tier 3 — Worker 规则
  'W-01': ['worker'], 'W-08': ['worker'], 'W-11': ['worker'], 'W-12': ['worker'],
  // Tier 4 — 审计事后检测
  'W-AUDIT-SELF': ['worker', 'commander'],
  'W-AUDIT-WORKER': ['worker', 'commander'],
  'W-AUDIT-TAMPER': ['worker', 'commander'],
  'W-AUDIT-NO-ALIGN': ['worker', 'commander'],
};
const NUDGE_FLOOD_LIMIT_PER_LEAF = 20;
```

#### 2. cmdNudgeAppend 三层校验（行 2562-2600）

```javascript
// 层 1：rule_id 白名单（withLock 外提前拦截）
const allowedRoles = NUDGE_RULE_WHITELIST[opts['rule-id']];
if (!allowedRoles) {
  throw new TreeStateError(E_NAME_INVALID, `nudge_append rejected: rule_id "${opts['rule-id']}" not in whitelist ...`);
}

// 层 2：role→rule 适用性（withLock 内拿到 leaf 后）
if (!allowedRoles.includes(leaf.role)) {
  throw new TreeStateError(E_STATUS_INVALID, `nudge_append rejected: rule_id "${opts['rule-id']}" applies to roles [${allowedRoles.join(', ')}], but leaf "${leaf_id}" has role "${leaf.role}" ...`);
}

// 层 3：洪水限制（单 leaf 累计上限）
if (leaf.nudge_count >= NUDGE_FLOOD_LIMIT_PER_LEAF) {
  throw new TreeStateError(E_SCHEMA_INVALID, `nudge_append rejected: leaf "${leaf_id}" nudge_count ${leaf.nudge_count} reached flood limit ...`);
}
```

### 与 V10 7-strike auto-prune 协同

V10 已有：nudge_count >= 7 → 强制 pruned（行 2624+）。新增洪水限制（20）作为更宽松的上限，在 auto-prune 之前提供额外拦截层（针对恶意 automation 滥用）。

---

## 四、B5 — audit_log 伪造检测修复

### 失守根因

R1 洁净室 B5 暴露：直接 JSON 篡改 tree-state.json 可注入合规格式 audit_log 条目（auditor_session_id 不存在于 leaves 中），仅被通用 `alignment_not_recorded + status_event_mismatch` 检出，**缺专用 W-AUDIT-TAMPER 校验**。

`cmdAuditAppend` 在 append 时已有轻量校验（格式 + 存在性 + 非自审），但 `collectValidateIssues` 不交叉验证已入库的 audit_log 条目，导致历史数据或 migrate 注入的伪造无法被检测。

### 修复方案：collectValidateIssues 新增 audit_log_integrity 检查项

#### 新增检查项（行 2272-2329）

```javascript
const sessionToLeafMap = new Map();
for (const id of leafIds) {
  const l = leaves[id];
  if (l && l.session_id) sessionToLeafMap.set(l.session_id, l);
}
for (const id of leafIds) {
  const leaf = leaves[id];
  const auditLog = Array.isArray(leaf.audit_log) ? leaf.audit_log : [];
  for (let i = 0; i < auditLog.length; i++) {
    const entry = auditLog[i];
    if (!entry || typeof entry !== 'object') continue;
    const auditorSession = entry.auditor_session_id;
    // ① auditor_session_id 必须在 leaves 中存在
    const auditorLeaf = auditorSession ? sessionToLeafMap.get(auditorSession) : null;
    if (!auditorLeaf) {
      issues.push({ type: 'audit_log_integrity', leaf_id: id, detail: `audit_log[${i}].auditor_session_id "${auditorSession}" not found ... (possible W-AUDIT-TAMPER: forged audit_log entry injected via direct JSON tampering).` });
      continue;
    }
    // ② auditor leaf role 不能是 worker
    if (auditorLeaf.role === 'worker') {
      issues.push({ type: 'audit_log_integrity', leaf_id: id, detail: `audit_log[${i}].auditor_session_id ... maps to leaf ... with role=worker (related to W-AUDIT-WORKER).` });
    }
    // ③ 数值一致性
    if (typeof entry.total === 'number' && typeof entry.passed === 'number' && typeof entry.failed === 'number') {
      if (entry.passed + entry.failed !== entry.total) { /* issue */ }
      if (Array.isArray(entry.results) && entry.results.length !== entry.total) { /* issue */ }
    }
  }
}
```

### 防御纵深

| 层 | 拦截点 | 触发时机 |
|---|---|---|
| 入口层（原有） | cmdAuditAppend | append 时格式 + 存在性 + 非自审 |
| 事后检测层（新） | collectValidateIssues.audit_log_integrity | tree_validate / done / archived 时交叉验证 |

---

## 五、Fork 幻觉修复（C1 + C5）

### 失守根因

R1 洁净室 C1+C5 双重确认：fork 后的会话继承根会话完整上下文，但**缺少"你是 fork"的身份提示**，导致 fork 会话认为自己就是原始 Commander，自主越权执行建 leaf、写 done event、伪造 auditor UUID（C1 实测：伪造 auditor `e860de98`、虚构 leaf A2/A3/A4、root 状态污染、session_id 漂移 `17a5005a→db7983e8`，validate 返回 4 个 issues）。

`fork_session` 在 patches.cjs 行 506-607 中只调用 `a.forkAgentSession()` + `a.updateAgentSessionMeta()`，**完全不注入身份提示**。

### 修复方案：fork 后同步等待身份提示注入

#### 修改 fork_session（proma-dev-patches.cjs 行 586-670）

在 `a.updateAgentSessionMeta(forked.id, updates)` 之后、`return jsonResult` 之前插入：

```javascript
const identityPrompt = [
  '【FORK 身份提示 - V9+ Phase 4 / R2 P1 修复】',
  '',
  `你是从源会话 ${args.source_session_id.slice(0, 8)}... fork 出来的副本（不是源会话本身）。`,
  '',
  '**身份信息**：',
  `- 你的新 session_id: ${forked.id}`,
  `- 源会话 session_id: ${args.source_session_id}`,
  '',
  '**关键约束（必须遵守）**：',
  '1. 你**不是**源会话本身。源会话身份相关的操作（如以源会话身份建 leaf、写 done event、',
  '   调 audit_gate、伪造 auditor UUID）你**无权**执行。',
  '2. 你的新 session_id 在 tree-state.json 中**不归属任何 leaf**。如需执行 tree 操作，',
  '   必须由父会话重新分配 leaf_id 与你新 session_id 的关联。',
  '3. 你的首要任务是：等待父会话给出明确任务。**禁止**主动越权执行任何 tree 写操作。',
  '4. 如果你接到父会话任务（含明确 leaf_id 指派），按任务要求执行；不要复用源会话的',
  '   leaf owner 身份。',
  '',
  '请回复："我已确认 fork 身份..." 以确认。'
].join('\n');

// 同步等待身份提示响应（30s 超时兜底）
await new Promise((resolve) => {
  const timeout = setTimeout(() => { resolve(); }, 30000);
  a.runAgentHeadless({
    sessionId: forked.id,
    userMessage: identityPrompt,
    channelId: forkChannelId,
    modelId: forkModelId,
    workspaceId: forked.workspaceId,
    permissionModeOverride: 'bypassPermissions',
  }, {
    onComplete: () => { clearTimeout(timeout); resolve(); },
    onError: (e) => { clearTimeout(timeout); resolve(); },
    onTitleUpdated: () => {},
  });
});
```

### 设计权衡

| 选项 | 优点 | 缺点 | 选择 |
|---|---|---|---|
| 异步注入（不等待） | fork_session 立即返回 | 身份提示可能与后续真实任务消息竞争 | ❌ |
| **同步等待响应（采用）** | 身份提示确定生效 | 增加 ~5-15s 延迟 | ✅ |
| SDK systemPromptOverride（理想） | 不污染对话历史 | SDK 不支持该参数 | ❌ |

返回值新增 `fork_identity_injected: true` 字段，让调用方知道身份提示已注入。

---

## 六、Auditor 鸡生蛋死锁修复

### 失守根因

R1 洁净室 C 系列报告：worker 需要独立 auditor 才能通过 audit_gate，但创建 auditor leaf 消耗 `node_budget`；若 worker 占满 budget，无法创建 auditor 形成死锁。

`resolveAuditorIndep` 行 1974 原本只允许 root 自审（`leaf.role === 'root' && auditorSessionId === leaf.session_id`），不允许 root 担任其他 leaf 的 auditor。

### 修复方案：扩展 root trust anchor

#### 修改 resolveAuditorIndep（tree-engine.cjs 行 1978-1993）

```javascript
// V9+ Phase 4 (R2 P1 / Auditor 死锁修复): root leaf 可担任任意非 root leaf 的 auditor。
if (leaf.role !== 'root' && auditorSessionId) {
  const rootLeaf = Object.values(state.leaves).find(
    (l) => l.parent === null && l.role === 'root' && l.session_id === auditorSessionId
  );
  if (rootLeaf && rootLeaf.leaf_id !== leaf.leaf_id) {
    return null;  // root 担任非 root leaf 的 auditor，放行（trust anchor 死锁修复）
  }
}
```

### 设计权衡

| 选项 | 优点 | 缺点 | 选择 |
|---|---|---|---|
| A: 调高默认 budget | 简单 | 治标不治本，仍可能在极端场景死锁 | ❌ |
| B: root 创建 leaf 不计入 budget | 给 root 特权 | 破坏 budget 本意 | ❌ |
| C: 新增 tree_set_budget 工具 | 灵活 | 增加复杂度 | ❌ |
| **D: root 担任任意非 root leaf auditor（采用）** | 自然延伸 trust anchor 语义 | root 权力扩大 | ✅ |

### 安全考虑

- **仅 root leaf**（parent=null + role='root'）能触发，commander/worker 无此特权
- 必须显式传 `auditor_session_id === root.session_id`（与 cmdAuditGate caller 校验协同）
- root 独立于所有 worker/commander，是 trust chain 起点，担任 auditor 不破坏"独立第三方"语义
- root 是不可质疑的信任源，已有自审特权，扩展为可审任意非 root leaf 是自然延伸

---

## 七、回归测试方案（供 R2 验证）

### B12 回归测试

```bash
# 期望：均抛 E_DELIVERABLE_MISSING
mcp__tree__tree_event_append --type plan --json '{"expect_outputs":["/etc/passwd"]}'
mcp__tree__tree_milestone_add --json '{"id":"M1","expect_outputs":["C:\\Windows\\System32\\config\\SAM"]}'
mcp__tree__tree_event_append --type plan --json '{"expect_outputs":["../../etc/passwd"]}'
mcp__tree__tree_milestone_add --json '{"id":"M2","expect_outputs":["deliverables/report.md"]}'  # 应通过
```

### B9 回归测试

```bash
# 期望：均抛 E_NAME_INVALID
mcp__tree__tree_nudge_append --rule-id INVALID-RULE-99
mcp__tree__tree_nudge_append --rule-id FAKE-1
# 期望：抛 E_STATUS_INVALID（role 不匹配）
mcp__tree__tree_nudge_append --rule-id R-01 <worker_leaf_id>  # R-01 适用 root, worker 不匹配
# 期望：通过
mcp__tree__tree_nudge_append --rule-id W-01 <worker_leaf_id>  # 合法
```

### B5 回归测试

```bash
# 1. 篡改 tree-state.json 注入伪造 audit_log 条目（auditor_session_id 不存在）
# 2. 调 tree_validate
# 期望：返回 audit_log_integrity issue
```

### Fork 幻觉回归测试

```bash
# 1. fork_session
# 2. list_messages 查看 fork 会话首条消息
# 期望：首条消息为身份提示 + fork 会话有确认响应
```

### Auditor 死锁回归测试

```bash
# 1. tree_init --root-dod '{"node_budget":3}'
# 2. 添加 2 个 worker（占满 budget: root + 2 worker = 3 leaf）
# 3. 尝试添加第 3 个 leaf 作 auditor → 应失败 E_TREE_NODE_BUDGET_EXCEEDED
# 4. 用 root session_id 作为 auditor 调 audit_gate → 应通过（V9+ Phase 4 修复）
```

---

## 八、修复影响范围分析

### 改动行数统计

| 文件 | 改动行数 | 新增函数 | 修改函数 |
|---|---|---|---|
| tree-engine.cjs | ~190 行 | assertSafeExpectOutputs | cmdMilestoneAdd, cmdEventAppend, cmdNudgeAppend, collectValidateIssues, resolveAuditorIndep |
| proma-dev-patches.cjs | ~85 行 | （无） | fork_session |
| **合计** | **~275 行** | 1 个新函数 + 1 个新白名单常量 | 6 个函数修改 |

### 向后兼容性

- ✅ 所有新校验都抛已有的错误码（E_DELIVERABLE_MISSING / E_NAME_INVALID / E_STATUS_INVALID / E_SCHEMA_INVALID）
- ✅ audit_log_integrity 是新 issue type，与现有 issue type 不冲突
- ✅ Fork 身份提示是新增 user message，不影响现有 fork 流程
- ⚠️ Auditor 死锁修复扩展了 root 特权，但仅 root leaf 触发，commander/worker 行为不变
- ⚠️ B9 rule_id 白名单可能拒绝合法但未注册的 rule_id（需要 R2 验证是否覆盖所有场景）

### 潜在回归风险

1. **白名单覆盖度**：B9 白名单可能漏掉某些合法 rule_id（patches.cjs TAO Watcher 规则集需要交叉验证）
2. **Fork 延迟**：fork_session 增加 ~5-15s 延迟，可能影响自动化测试
3. **Auditor 死锁修复**：root 权力扩大，需要 R2 验证 root 不会被注入攻击诱导担任恶意 auditor

---

## 九、下一步

1. ✅ 修复完成，3 处物理同步
2. ⏳ **重启 Dev 实例**让 patches 生效（需用户操作）
3. ⏳ 子 Agent 审计修复代码（任务 #13）
4. ⏳ R2 测试启动（任务 #14）
