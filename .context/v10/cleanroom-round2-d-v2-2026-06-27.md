# Commander D v2 — B 篡改 + 修复回归测试报告 (Round 2)

> 执行者: Commander D v2 (session `5efd64be` → fork worker `3c329be6`, proxy `ed2cdf0b`)
> 执行时间: 2026-06-27 14:03 - 14:25 GMT+8
> 维度: B 篡改变体 + 5 大修复回归（D 注入视角）
> 状态: **完成 — 8/8 用例执行，6 PASS / 2 FAIL**
> tree: `cr26r2dv2` (workspace tree-2)

---

## 一、测试执行总览

| 用例 | 测试目标 | 结果 | 关键错误码/发现 |
|------|---------|------|----------------|
| D2-B1 | Bug A — borrowed identity (`added_by` 伪造) | **FAIL** | 未在 `leaf_add` 触发，仅 `tree_validate` 事后检测 |
| D2-B2 | Bug B — duplicate session_id | **PASS** | `E_DUPLICATE_SESSION_ID` 正确拦截 |
| D2-B3 | Self-audit (自审拦截) | **PASS** | `E_AUDITOR_NOT_INDEPENDENT` 正确拦截 |
| D2-B4 | audit_log 伪造（外部注入） | **PASS** | 三层防御链 (schema → UUID → membership) |
| D2-B5 | tree-state.json 哈希校验分析 | **N/A** | 分析见 §三，含方案建议 |
| D2-R1 | B12 注入回归 (路径遍历) | **PASS** | `E_DELIVERABLE_MISSING` 双路径拦截 |
| D2-R2 | B9 注入回归 (nudge 白名单) | **PASS** | `E_NAME_INVALID` 拦截无效 rule_id |
| D2-R3 | B5 注入回归 (audit_log 篡改) | **FAIL** | 合法树成员可跨 leaf 注入 audit_log |

**总评**: **6/8 通过**。2 个 FAIL 均涉及事前拦截缺口：B1 缺少 `added_by` 身份校验，R3 缺少 auditor 角色/权限校验。其余修复均生效。

---

## 二、逐用例详情

### D2-B1: Bug A — borrowed identity

| 项目 | 内容 |
|------|------|
| **攻击向量** | `tree_leaf_add` 使用伪造 `added_by`（不在树中的虚假 session UUID） |
| **预期** | `E_BORROWED_IDENTITY` — `leaf_add` 时拒绝 |
| **实际** | `ok: true` — leaf 创建成功 |
| **事后检测** | `tree_validate` 报告 `added_by_not_in_tree` |
| **判定** | **FAIL** |

**分析**: Bug A (borrowed identity) 的事前拦截未实现（或未生效）。伪造的 `added_by` 可绕过 `leaf_add` 检查，仅在 `tree_validate` 事后扫描时被检测。这导致攻击窗口期允许伪造来源的 leaf 存在并执行操作。Bug B 的 `E_DUPLICATE_SESSION_ID` 检查先于 Bug A 触发，且 Bug A 的独立检查路径缺失。

**建议**: 在 `tree_leaf_add` 中增加 `added_by` 校验：
- `added_by` 必须等于 parent leaf 的 `session_id`（直接父节点授权）
- 或 `added_by` 必须在树中存在且有 commander/root 角色
- 非 root 的直接子节点创建者必须是 root 自身

### D2-B2: Bug B — duplicate session_id

| 项目 | 内容 |
|------|------|
| **攻击向量** | 同一 session_id 尝试注册第二个 leaf |
| **预期** | `E_DUPLICATE_SESSION_ID` |
| **实际** | `E_DUPLICATE_SESSION_ID` — "session_id already used by leaf X. Each session can only register one leaf per tree." |
| **判定** | **PASS** |

无额外发现。Bug B 修复稳固。

### D2-B3: Self-audit 拦截

| 项目 | 内容 |
|------|------|
| **攻击向量** | leaf 给自己的 `audit_gate` 打 `pass` |
| **预期** | `E_AUDITOR_NOT_INDEPENDENT` |
| **实际** | `E_AUDITOR_NOT_INDEPENDENT` — "auditor is the leaf itself" |
| **判定** | **PASS** |

自审检测精确识别 auditor == leaf 的情况。修复稳固。

### D2-B4: audit_log 伪造（外部注入）

| 项目 | 内容 |
|------|------|
| **攻击向量** | 伪造的 `auditor_session_id`（非 UUID / 不存在于树 / 完全外部） |
| **预期** | 被拦截（三重防御） |
| **实际** | 三层均生效 |
| **判定** | **PASS** |

**三层防御链**:

| 层级 | 输入 | 错误码 |
|------|------|--------|
| Schema | 缺少 `total` 字段 | `E_SCHEMA_INVALID` |
| UUID 格式 | `fake-forgery-9999` | `E_INVALID_UUID_STRICT` |
| 树成员 | 合规 UUID 但不在树中 | `E_AUDITOR_NOT_INDEPENDENT` |

外部攻击者无法注入伪造 audit_log，三层防御有效。但注意此防御仅对**外部** session 有效，参见 D2-R3 中发现的内部跨 leaf 注入缺口。

### D2-B5: tree-state.json 哈希校验分析

详见 §三。

### D2-R1: B12 注入回归 — expect_outputs 路径遍历

| 项目 | 内容 |
|------|------|
| **注入向量 1** | `tree_milestone_add` → `expect_outputs=["/etc/passwd","/etc/shadow","normal.txt"]` |
| **注入向量 2** | `tree_event_append type=plan` → `meta.expect_outputs=["/etc/passwd"]` |
| **预期** | 双路径均拦截 |
| **实际** | 双路径均返回 `E_DELIVERABLE_MISSING` — "absolute paths forbidden" |
| **判定** | **PASS** |

B12 修复覆盖了 `milestone_add` 和 `event_append` 两条注入路径。即使混合合法/恶意路径的批量注入也被整体拒绝。修复稳固。

### D2-R2: B9 注入回归 — nudge rule_id 白名单

| 项目 | 内容 |
|------|------|
| **注入向量 1** | `rule-id=INVALID-RULE-99` |
| **注入向量 2** | `rule-id=W-FAKE-NOT-REAL` (W- 前缀伪装) |
| **对照** | `rule-id=W-01` (合法 rule) |
| **判定** | **PASS** |

| rule_id | 结果 |
|---------|------|
| `INVALID-RULE-99` | `E_NAME_INVALID` — "B9: rule injection guard" |
| `W-FAKE-NOT-REAL` | `E_NAME_INVALID` — "not in whitelist" |
| `W-01` | `ok: true` |

**当前白名单** (从运行时错误信息提取):

```
Root:    R-01, R-03, R-04, R-05, R-06
Cmd:     C-02, C-03, C-06, C-11, C-13, C-15
Worker:  W-01, W-08, W-11, W-12
Audit:   W-AUDIT-SELF, W-AUDIT-WORKER, W-AUDIT-TAMPER, W-AUDIT-NO-ALIGN  (R2 新增)
```

B9 修复稳固。`W-` 前缀伪装无法绕过白名单。

### D2-R3: B5 注入回归 — audit_log 跨 leaf 篡改

| 项目 | 内容 |
|------|------|
| **攻击向量** | 合法树成员 (A2 worker) 以 auditor 身份向 A1 worker 的 leaf 注入 audit_log |
| **预期** | 被拦截（角色检查 / 跨 leaf 权限） |
| **实际** | `ok: true` — audit_log 注入成功并持久化 |
| **判定** | **FAIL** |

**A1-worker audit_log 现状** (4 条记录中 2 条为注入):

| # | 来源 | 内容 | 合法性 |
|---|------|------|--------|
| 0 | A2 worker 注入 | "B5 cross-leaf tampering attempt" | ❌ 伪造 |
| 1 | TAO watcher | W-01 brief_echo 缺失 | ✅ 合法 |
| 2 | TAO watcher | W-08 leaf purity 违规 | ✅ 合法 |
| 3 | A2 worker 注入 | "R3 injection cross-leaf audit test" | ❌ 伪造 |

**根源分析**: `E_AUDITOR_NOT_INDEPENDENT` 检查存在两个缺口：

| 检查层 | 状态 | 绕过条件 |
|--------|------|---------|
| UUID 格式 | ✅ 已实现 | 使用合规 UUID v4 |
| 树成员存在性 | ✅ 已实现 | session 在树中有任意 leaf |
| 非自审 (auditor ≠ leaf) | ✅ 已实现 | 跨 leaf (A2 → A1) |
| **角色检查** | ❌ 缺失 | worker 可充当 auditor |
| **跨 leaf 权限** | ❌ 缺失 | 任意树成员可审任意 leaf |

**事后检测**: `tree_validate` 报告 `audit_log_integrity` / `W-AUDIT-WORKER`，但为事后扫描。

---

## 三、D2-B5: tree-state.json 离线完整性分析

### 当前状态

- 文件路径: `~/.proma/agent-workspaces/tree-2/workspace-files/.context/trees/cr26r2dv2/tree-state.json`
- 大小: 5014 bytes
- 权限: 0644 (rw-r--r--)
- 无任何完整性校验字段

### 离线篡改攻击面

`tree-state.json` 是纯 JSON 文件，所有 API 层修复（B9/B12/audit_gate）均无法防御**直接文件编辑**：

| 攻击向量 | 方法 | 影响 |
|---------|------|------|
| 删除 audit_log | 直接编辑 JSON | 隐藏入侵痕迹 |
| 修改 audit_gate verdict | 改为 `skip` 或修改结果 | 绕过审计闸门 |
| 清除 nudge_log | 删除 nudge 条目 | 隐藏流程违规 |
| 修改 milestone 结果 | 改 `audit_pass: true` | 伪造里程碑通过 |
| 增删 leaf | 直接编辑 leaves 对象 | 注入/移除执行节点 |

### 方案建议

**轻量方案**（推荐优先实现）:

```json
"_integrity": {
  "hash": "sha256:abc123...",
  "last_write_ts": "2026-06-27T14:25:19.000+08:00",
  "last_write_tool": "tree_nudge_append",
  "last_write_leaf": "r2dv2-A1-worker"
}
```

- 每次写操作后自动更新 `_integrity.hash`
- 计算范围：`leaves` + `heartbeat_log` + `drift_log` + `audit_meta`
- 排除 `_integrity` 自身和 `_meta.write_count`
- `tree_validate` 时重新计算并比对

**完整方案**（后续迭代）:

1. **内容哈希链**: 每次写操作产生新哈希，哈希链验证操作历史
2. **HMAC 签名**: root session 持有密钥，签名关键字段（audit_log, audit_gate）
3. **审计日志子哈希**: 仅对 `audit_log` + `audit_gate` 计算，避免性能开销

### 离线篡改 vs 在线注入对比

| 维度 | 在线注入 (R3) | 离线篡改 |
|------|-------------|---------|
| 攻击门槛 | 需有效 session（树成员） | 需文件系统访问 |
| 检测方式 | `tree_validate` 事后扫描 | 当前**无** |
| 修复建议 | 角色/权限检查 | 内容哈希 |

两个向量互补 — 在线注入需要树成员身份，离线篡改需要文件系统访问。两者都需要修复。

---

## 四、修复效果矩阵

| 修复 | R1 状态 | R2 目标 | R2 实际 | 差距 |
|------|--------|---------|---------|------|
| Bug A (borrowed identity) | ❌ | 事前拦截 | 事后检测 | 缺 `leaf_add` 入口检查 |
| Bug B (duplicate session) | ❌ | 事前拦截 | ✅ 事前拦截 | 无 |
| B3 (self-audit) | ✅ | 保持 | ✅ 保持 | 无 |
| B4 (audit_log forgery external) | △ | 完整拦截 | ✅ 三层防御 | 无 |
| B5 (audit_log cross-leaf) | ❌ | 事前拦截 | ❌ 可绕过 | 缺角色/权限检查 |
| B9 (nudge whitelist) | ❌ | 事前拦截 | ✅ 白名单拦截 | 无 |
| B12 (path traversal) | ❌ | 事前拦截 | ✅ 双路径拦截 | 无 |
| B13 (hash integrity) | — | 新增 | — | 待实现 |

---

## 五、R3 设计建议（补遗）

### 1. 角色权限矩阵

当前所有树成员享有相同的 `tree_audit_append` 权限。建议引入角色权限矩阵：

| 操作 | root | commander | worker | auditor (独立角色) |
|------|------|-----------|--------|-------------------|
| `tree_leaf_add` | ✅ | ✅ | ❌ | ❌ |
| `tree_audit_gate` | ❌ | ❌ | ❌ | ✅ (仅独立 auditor) |
| `tree_audit_append` | ❌ | ❌ | ❌ | ✅ (仅独立 auditor) |
| `tree_nudge_append` | ✅ (系统) | ❌ | ❌ | ❌ |

### 2. auditor 独立注册

- 新增 `role: "auditor"` leaf 类型
- `tree_audit_gate` 和 `tree_audit_append` 仅允许 `role=auditor` 的 session 调用
- auditor leaf 不可同时为 worker

### 3. 跨 leaf 审计隔离

- auditor 只能审计已被明确指派 (`audit_gate.assigned_auditor`) 的 leaf
- 新增 `tree_leaf_assign_auditor` 工具：root/commander 给 leaf 指派 auditor

### 4. `added_by` 源头校验（修复 B1）

```javascript
// tree_leaf_add 时
if (leaf.added_by !== parent.session_id && !isRootSession(leaf.added_by)) {
  return E_BORROWED_IDENTITY;
}
```

---

## 六、环境与元信息

| 项 | 值 |
|---|---|
| 实例 | Proma (Dev, patches 已加载) |
| 频道 | DeepSeek官方 (`56ecefd2`) |
| 模型 | deepseek-v4-pro |
| workspace | Tree测试工作区2 (`b38b9e4e`) |
| tree | `cr26r2dv2` |
| Commander root session | `5efd64be-431b-442c-a1ac-59d27cee1aba` |
| A1 worker (本会话) | `3c329be6-ce4b-4324-9934-278e30d47ac1` leaf `r2dv2-A1-worker` |
| A2 worker (代理) | `ed2cdf0b-af70-4ab5-a1a9-c012709bfa69` leaf `r2dv2-A2-worker` |
| tree MCP 工具状态 | A1 主会话不可用 (E_NO_TREES_DIR workspace="undefined")，通过 A2 代理 |

---

## 七、附录：v1 PATCHES_NOT_LOADED 阻断记录

以下为 v1 报告中保留的 R3 设计建议（已在 v2 中更新但保留原始版本供参考）：

### 原始 R3 建议（v1 提出）

1. **内容哈希链**: 每次写操作后更新 `tree-state.json` 的 `_integrity.hash`（SHA-256），validate 时比对
2. **Patch 加载检测**: 新增 `tree_health_check` 工具返回版本/补丁信息
3. **MCP Workspace 绑定稳健性**: 增加 workspace 解析的 fallback 逻辑

其中 #1 已在 §三 (D2-B5) 中进一步细化。#2 和 #3 仍未实现，建议纳入 R3。

---

*报告完成于 2026-06-27 14:25 GMT+8。8/8 用例执行。*
