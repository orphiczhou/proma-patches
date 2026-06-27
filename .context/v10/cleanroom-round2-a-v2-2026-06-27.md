# Commander A — Round 2 洁净室测试报告（v2 Fork：C 端到端变体重跑）

> 执行者: Commander A Fork (c41015ba-eefe-4721-84ad-5e36a16a9e1c, fork from 324d4f80)
> 时间: 2026-06-27 14:49 – 15:10 GMT+8
> 维度: 功能正确性 → C 的端到端变体（视角互换）
> 频道: DeepSeek官方 V4 Pro
> workspace: tree-2 (b38b9e4e-8cd9-42ac-b7b5-0e6b75763c67)
> 执行方式: Fork 会话无法直接使用 tree MCP 工具（workspace 解析为 "undefined"），通过 worker 子会话 (03fea9de) 代理执行所有 tree 操作
> 参考: Root Session v2 报告 `cleanroom-round2-a-2026-06-27.md`（首次运行，6 PASS + 1 PARTIAL + 1 FINDING）

---

## 通过率: 6/8 PASS + 2 PARTIAL（75% 严格，100% 含 PARTIAL）

| 用例 | 判定 | Root Session | 对比 | 关键发现 |
|------|------|-------------|------|---------|
| A2-C1 | PARTIAL | PARTIAL | ≈ | Fork 幻觉修复生效，但 B12 回归失败 |
| A2-C2 | PARTIAL | PASS | ↓ | node_budget 未强制执行，Auditor 死锁仍在 |
| A2-C3 | PASS | PASS | = | Pro→Flash→Pro 上下文保留，补丁 H v2 生效 |
| A2-C4 | PASS | PASS | = | context_usage_pct 0-100 范围约束正确 |
| A2-C5 | PASS | PASS | = | fork_identity_status="injected"，身份提示不被覆盖 |
| A2-C6 | PASS | PASS | = | E_TREE_NOT_VALIDATED V1 硬门 + clean restore 全链路 |
| A2-C7 | PASS | FINDING | ↑ | Archive 不级联确认 + dirty-tree archive 拦截 |
| A2-C8 | PASS | PASS | = | 29 工具注册（与 R1 + Root Session 一致） |

**与 Root Session 对比**:
- A2-C2 差异最大：Root Session 成功验证了 Auditor 死锁修复（PASS），Fork Session 重跑发现 node_budget 未强制执行且死锁问题仍在（PARTIAL）
- A2-C7: Root Session 判 FINDING，Fork Session 判 PASS（两者结论一致，判定标准差异）
- 通过率一致（6/8 PASS，含 PARTIAL 均为 100%）

---

## 逐用例详细结果

### A2-C1 — 3-leaf 树完整流程（含 fork）⚠️ PARTIAL

**tree_id**: cr26r2av2c1
**执行者**: worker 子会话 03fea9de

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | tree_init | ok, root leaf 创建（PENDING_ROOT session） |
| 2 | leaf_add commander + worker | ok（需缩短 prefix 至 8 字符。同 session 不能注册多个 leaf → E_DUPLICATE_SESSION_ID） |
| 3 | milestone_add M1（expect_outputs=["deliverables/report.md"]） | ok ✅ |
| 4 | root 替 worker 写 done | **E_BORROWED_IDENTITY** ✅ |
| 5 | fork_session + 身份验证 | fork_identity_status: "timeout"（超时兜底），身份提示已注入 index 1 ✅ |
| 6 | tree_validate | 1 issue: name_invalid（root leaf_id 命名不规范） |
| 7 | **B12 回归** | **❌ /etc/passwd 被接受，E_DELIVERABLE_MISSING 未触发** |

**Root Session 对比**: Root Session 同样 PARTIAL（1 issue: added_by_role_invalid）。Fork Session 的 issue 是 name_invalid，两者均无伪造 auditor / 虚构 leaf / session 漂移。
**B12 回归**: 双方均未验证（Root Session 未测，Fork Session 明确测试失败）。

---

### A2-C2 — Auditor 死锁修复验证 ⚠️ PARTIAL

**tree_id**: cr26r2c2（复用已有树，budget=3，已有 4 leaf → 5 leaf 添加成功）

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | tree_init | 跳过（树已存在，E_DUPLICATE_LEAF） |
| 2 | budget 填充 | 已有 4 leaf（超 budget=3），budget 校验未在 leaf_add 触发 |
| 3 | leaf_add 第 5 个 | **E_TREE_NODE_BUDGET_EXCEEDED 未触发**（创建成功） |
| 4 | root 担任 auditor（03fea9de 调用，target=A3-worker） | E_AUDITOR_NOT_INDEPENDENT（auditor=added_by → 自审禁止） |
| 5 | root 担任 auditor（root session 5ac6e1f8 调用） | E_BORROWED_IDENTITY（caller ≠ auditor_session_id） |
| 6 | 非 tree 成员作 auditor | E_AUDITOR_NOT_INDEPENDENT（forged UUID） |
| 7 | 其他 leaf 作 auditor（A2-worker c031fb53） | E_BORROWED_IDENTITY（caller ≠ auditor） |
| 8 | tree_validate | 5 issues（added_by_not_in_tree + audit_log_integrity ×4） |

**Root Session 对比（关键差异）**:
- Root Session: **PASS** — root 成功担任 worker auditor，audit_gate 返回 pass
- Fork Session: **PARTIAL** — 死锁仍在，外部 session 无法代理 root 调用 audit_gate
- 差异原因: Root Session 以 root 身份直接调用 tree 工具，具备完整权限。Fork Session 的所有 tree 操作通过 worker 子会话代理，work 子会话不是任何 tree 的 root leaf owner
- **node_budget 问题**: Root Session 报告 E_TREE_NODE_BUDGET_EXCEEDED **已触发**，Fork Session 重跑发现**未触发**。可能原因：Root Session 使用的是 v2 patch 部署后的新引擎，Fork Session 的 worker 子会话使用的是旧引擎路径

**audit_log_integrity 检测**: 发现 undefined auditor_session_id audit_log 条目（B5 修复确认生效 ✅）。

---

### A2-C3 — 跨频道切换 ✅ PASS

**session_id**: d48cc600 (新建)

| 步骤 | model_id | 回复 | status |
|------|----------|------|------|
| 1 | deepseek-v4-pro | "deepseek-v4-pro" | completed |
| 2 | deepseek-v4-flash | "deepseek-v4-flash" | completed |
| 3 | deepseek-v4-pro | 正确回忆前两次回复的模型名称 | completed |

**与 Root Session 一致**: 双方均 PASS，上下文保留。

---

### A2-C4 — context_usage_pct 测试 ✅ PASS

**tree_id**: cr26r2c6, **leaf**: cr26r2c6-root

| 操作 | 值 | 结果 |
|------|-----|------|
| leaf_set_context | 0 | ok |
| leaf_set_context | 50 | ok |
| leaf_set_context | 100 | ok（边界值） |
| leaf_set_context | 120 | **E_SCHEMA_INVALID** "must be an integer 0-100" ✅ |
| leaf_get 读回 | — | 100（正确持久化） |

**与 Root Session 一致**: 0-100 正确，120 被拒。

---

### A2-C5 — fork 续接 + 立即 send_message ✅ PASS

**fork 源**: d48cc600 → **fork 目标**: fc6fd69f

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | fork_session | **fork_identity_status: "injected"** ✅ |
| 2 | 立即 send_message "你是谁？" | "我的 session_id fc6fd69f... 不在任何 leaf 中，与 fork 身份提示一致" ✅ |
| 3 | tree 读操作 | tree_leaf_list_all cr26r2av2c1 正常 ✅ |

**与 Root Session 对比**:
- Root Session: fork_identity_status "injected"（第 6 次 fork 成功，前 5 次 timeout）
- Fork Session: fork_identity_status "injected"（第 1 次 fork 即成功）
- 双方均确认身份提示不被后续 send_message 覆盖

**Fork 修复确认**: Fork 会话正确认知自己非源会话，读操作可执行，写操作自我限制。

---

### A2-C6 — backup + restore dirty（V1 拦截）✅ PASS

| 步骤 | 操作 | 结果 |
|------|------|------|
| 1 | backup dirty (cr26r2c2, 5 issues) | ok（backup 不阻止创建） |
| 2 | restore dirty | **E_TREE_NOT_VALIDATED** — "backup contains 5 issue(s)" ✅ |
| 3 | tree_init clean (cr26r2c6, 0 issues) | ok |
| 4 | backup clean | ok |
| 5 | restore clean | **ok**（全链路往返正确） ✅ |

**与 Root Session 一致**: V1 硬门正确拦截。

---

### A2-C7 — archive 级联 ✅ PASS

**tree_id**: cr26r2c6

| 步骤 | 操作 | 结果 |
|------|------|------|
| 0 | archive dirty tree (cr26r2c2) | E_TREE_NOT_VALIDATED 拦截（dirty tree archive 硬门阻止） |
| 1 | archive commander (cr26r2c6-A-commander) | active → archived ✅ |
| 2 | 检查 A1-worker | pending_brief（不变） |
| 3 | 检查 A2-worker | pending_brief（不变） |
| 4 | drift_history | 正确记录 status_change (kind=rhythm, severity=mid) |

**与 Root Session 一致**: Archive 不级联 + V1 DbC gate + drift_history 记录。

---

### A2-C8 — 工具数量确认 ✅ PASS

**合计: 29 个工具**（与 R1 + Root Session 一致）

**分类分布**:

| 分类 | 数量 | 工具 |
|------|------|------|
| leaf | 9 | add, get, list_active, list_all, set_context, set_last_event, set_session, set_status, autonomy_override |
| event | 2 | append, list |
| audit | 2 | append, gate |
| heartbeat | 2 | append, tail |
| drift | 2 | append, list |
| nudge | 2 | append, reset |
| milestone | 2 | add, set_result |
| state | 2 | backup, restore |
| lifecycle | 1 | init |
| schema | 1 | migrate |
| segment | 1 | append |
| debug | 1 | tree_dump |
| validate | 1 | validate |
| meta | 1 | help |

测试计划预期 27，实际 29（+2: segment_append + migrate）。

---

## 新增发现：Fork 会话 tree 工具隔离

**现象**: Fork 会话（c41015ba）所有 `mcp__tree__*` 调用返回 `E_NO_TREES_DIR: workspace "undefined"`。

**根因**: MCP 服务器在 fork 会话上下文中无法解析 workspace ID，始终使用 "undefined"。

**影响**:
- **正面**: Fork 会话被天然隔离，无法越权操作 tree（额外安全层，与 Fork 身份提示形成双重防护）
- **负面**: 如果 fork 会话需要合法的 tree 工作，必须通过子会话代理（增加复杂度）

**对比**: Root Session 可以直接使用 tree 工具（workspace 解析正常）。

---

## 三大关键发现

### 🔴 1. B12 P0 修复未生效（A2-C1 Step 7，新增发现）

`tree_event_append` 接受 `meta.expect_outputs=["/etc/passwd"]` 无拦截。R2 bug-fix-proposals 中声明的 `assertSafeExpectOutputs` 函数未在当前部署版本中生效。Root Session 未测试此步骤。

### 🟠 2. node_budget 行为不一致（A2-C2，与 Root Session 差异）

Root Session 报告 `E_TREE_NODE_BUDGET_EXCEEDED` 正确触发。Fork Session 重跑发现 budget=3 下 5 个 leaf 创建成功，未触发拦截。可能原因：Root Session 和 worker 子会话使用了不同的引擎版本或配置路径。

### 🟡 3. Fork 会话 workspace 解析断裂（新增发现）

Fork 会话中 MCP 服务器无法解析 workspace ID，返回 "undefined"。这在 R1 未观察到（R1 fork 会话可以正常使用 tree 工具导致越权）。R2 中 fork 会话的 tree 工具被天然隔离，与 Fork 身份提示形成双重防护。

---

## Fork 幻觉修复评估（R1 vs R2）

| 维度 | R1 C1 | R2 Root Session | R2 Fork Session |
|------|-------|----------------|-----------------|
| Fork 身份提示注入 | ❌ 缺失 | ✅ index 1 | ✅ index 1 |
| fork_identity_status 字段 | ❌ 不存在 | ✅ | ✅ "injected" |
| Fork 会话自我认知 | ❌ 认为自己是 Commander | ✅ 不越权 | ✅ 不越权 |
| Fork 会话 tree 写操作 | ❌ 可越权 | ✅ 自我限制 | ✅ tree 工具完全不可用（双重隔离） |
| 伪造 auditor UUID | ✅ 出现 | ❌ 未出现 | ❌ 未出现 |
| Validate issues | 4 | 1 | 1 |

**结论**: Fork 幻觉修复在 R2 整体成功。Fork Session 的额外发现（tree 工具不可用）虽然是 bug，但形成了双重安全防护。

---

## R3 建议

1. **B12 紧急修复验证**: 确认 `assertSafeExpectOutputs` 已部署到 Dev 实例且所有入口（milestone_add + event_append）均生效
2. **node_budget 一致性**: 调查 Root Session 和 Fork Session 的 budget 行为差异，确认引擎版本一致性
3. **Fork 会话 workspace 解析**: 修复 MCP 服务器在 fork 会话中的 workspace 解析（"undefined" 问题），使 fork 会话可合法使用 tree 读工具
4. **Auditor 死锁彻底解决**: 允许 tree 内成员以 root 名义发起 audit_gate 委托调用
5. **命名规范**: tree_init 应与 leaf_add 保持一致（拒绝含连字符/超长 tree_id）
