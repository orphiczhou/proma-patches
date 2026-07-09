# Tree Harness P0a/P0b/P1b 端到端验证 — 失败报告

- **tree_id**: `audtest`
- **测试时间**: 2026-07-08 22:25 – 22:50 (GMT+8) + 2026-07-09 09:35 收尾
- **root.session_id**: `e954cf56-c26a-4ea4-a270-2facd7977329`
- **模型/渠道**: GLM-5.2 / GLM
- **node_budget**: 5
- **结论**: ❌ **总体失败**（端到端核心目标未达成）

---

## 1. 测试目标 vs 实际达成

| 目标 | 设计预期 | 实际 | 判定 |
|------|---------|------|------|
| P0a auditor role 创建 | leaf_add role=auditor → audit_gate=required | ✅ 创建成功 | 达成 |
| P0a auditor 简化协议 done（**核心**） | auditor 自调 brief_echo + done event → root 背书 audit_gate pass → set-status done | ❌ **auditor session 全部卡死，无法自调 done event；auditor done 路径未跑通** | **未达成** |
| 三层防护① startup_notice | tree_init / leaf_add 返回含告警 | ✅ 5 条告警注入 | 达成 |
| 三层防护② caller-binding | 借身份被 E_BORROWED_IDENTITY 拦 | ✅ done event + leaf_add added_by 双拦 | 达成 |
| 三层防护③ 预算护栏 | 超 node_budget 拦 | ✅ E_TREE_NODE_BUDGET_EXCEEDED | 达成 |
| P1b fix_evidence | done 缺 red_findings_resolved → E_SELFCHECK_INVALID | ✅ 借 b8711bb7 worker 跑通 | 达成（但靠幸运副本） |

**端到端核心目标（P0a auditor role 完整 done）失败。** 其它 4 个目标达成属于"门禁单元验证"，不构成端到端流程跑通。

---

## 2. 失败根因

### 根因 A：Proma fork identity timeout（BUG-A，阻断性）

`mcp__session__fork_session` 返回 `fork_identity_status:'timeout'`，**4 个 fork session 中 3 个永久卡死**（无 assistant 消息、无 token 消耗、所有 send_message 被 status=busy 拒绝）：

| Fork | session_id | 状态 | 用途 |
|------|-----------|------|------|
| #1 | 8cc4fc3f-a3c1-45fc-9b56-9d22d017bfdb | 永久 busy | auditor（A1-auditor owner，本应自调 done event） |
| #2 | d308ce21-6a63-4019-9aea-951fb4e52f33 | 永久 busy | 计划替换 auditor session，未果 |
| #3 | 67b8a9a2-c039-4485-9fc9-a4cbc2d780a4 | 永久 busy | 未实际使用 |
| #4 | b8711bb7-8eea-4b3d-9d9c-1620b77ea516 | ✅ 可用 | A4-worker owner（fork bug 副作用绑定） |

**auditor 协议要求 caller=auditor.session_id 自调 done event**（caller-binding 防护②硬约束）。auditor session 卡死 → 这一步永远走不通 → P0a 端到端失败。

### 根因 B：测试设计依赖外部 session 可用性

我的测试设计假设 fork 出来的 session 能可靠响应 send_message。实际：
- fork identity timeout 是非确定性的（4 fork 1 ok）
- 无法预测哪个 session 能用
- 没有"探测 session 是否可用"的 SDK 接口（`get_session_context` 返回 "No usage data yet" 不能区分"准备中"和"卡死"）

**正确做法应该是**：测试前先用 `send_message(wait=true, timeout=短)` 探测 fork session 可用性，归档卡死 session 重 fork，再绑 leaf。我直接 fork → leaf_add → 假设可用，导致 auditor 路径死锁。

### 根因 C：leaf_add 事务原子性破坏（BUG-B，污染环境）

步骤 C1 测试 caller-binding 时：
- `leaf_add(added_by=auditor session)` 报 `E_BORROWED_IDENTITY`
- 但 `audtest-A3-worker` 仍被创建（status=pending_brief，session_id 被替换为引擎自动生成的 UUID）
- 还连带创建了 `audtest-A4-worker`（来源不明，疑似 fork bug 副作用）

后果：active_count 被幽灵 leaf 污染，导致步骤 D1 提前撞 E_TREE_NODE_BUDGET_EXCEEDED（实际 5 = root + A1-auditor + A2/A3/A4-worker，其中 A2/A3/A4 都是 fork bug 副作用）。

---

## 3. 实际验证的门禁单元（不属于端到端但仍是有效数据）

| 验证项 | 错误码 | 引擎位置 |
|--------|--------|---------|
| done event caller ≠ leaf.session | E_BORROWED_IDENTITY | caller-binding |
| leaf_add added_by=auditor session | E_BORROWED_IDENTITY + [D2-B1] | macp4-A4 caller-binding 收紧 |
| audit_gate pass 无 done event | E_AUDIT_PREMATURE | 门禁前置 |
| leaf_add 超过 node_budget | E_TREE_NODE_BUDGET_EXCEEDED | 预算护栏 |
| leaf_add 伪造 session_id | E_SESSION_NOT_ALIVE | V10 session liveness |
| leaf_add 已存在 leaf_id | E_DUPLICATE_LEAF | naming 强制 |
| leaf set-session 已占用 session | E_SCHEMA_INVALID | session 唯一性 |
| review_round schema 错（字段名错 / reviewer=added_by） | E_REVIEW_FORGERY | review 协议 |
| done event 缺 red_findings_resolved | E_SELFCHECK_INVALID | P1b fix_evidence |

---

## 4. 引擎 / 协议问题清单

| # | 类型 | 描述 | 严重度 | 归属 |
|---|------|------|--------|------|
| BUG-A | Proma 引擎 | fork identity timeout（4 fork 3 卡死，25% 可用率） | **阻断** | Proma |
| BUG-B | tree-engine | leaf_add 报错时未事务回滚，幽灵 leaf 污染 active_count | 高 | tree-engine |
| BUG-C | tree-engine（疑似） | 连带创建未授权 leaf（A4-worker 来源不明） | 高 | tree-engine / Proma 协同 |
| LIMIT-D | tree-engine | `leaf_list_active` 不含 pending_brief，但预算 `active_count` 含 —— 口径不一致 | 中 | tree-engine |
| LIMIT-E | SKILL 文档 | `alignment_workflow` topic 对 P1b `red_findings_resolved` 描述不完整（缺对象结构） | 中 | SKILL |
| LIMIT-F | SDK | 无"探测 fork session 是否可用"的同步接口 | 中 | SDK |

---

## 5. P0a auditor role 设计 vs 实际可行性

**设计正确性**（协议层面）：
- ✅ role=auditor 枚举被引擎接受
- ✅ 初始 audit_gate.verdict=required（不能自审）
- ✅ 简化协议路径打开（无 milestone/deliverables 必填）
- ✅ done event + audit_gate pass 是硬前置（不允许跳门禁）

**实际可行性**（运行时层面）：
- ❌ 协议假设"auditor session 能自调 done event" —— 在 Proma 当前 fork identity 状态下不可靠
- ❌ 一旦 auditor session 卡死，没有协议级 fallback（root 不能代调，caller-binding 拦；leaf set-session 换 session 又有 caller 校验陷阱）

**核心矛盾**：caller-binding 防护② 要求"worker/auditor 必须自己调 done event"，但 Proma fork 不保证 session 可用 —— 两条约束叠加导致 auditor role 在当前环境下不可用。

---

## 6. 给上游的建议

### 短期（不修引擎，调协议）
1. **SKILL §13.4.1 加 fallback 路径**：auditor session 卡死时，允许 root 用 `mcp__session__archive_session` 归档卡死 session，重新 fork + leaf set-session 替换绑定（需要引擎放开 leaf set-session 的 caller 校验，允许 root 在 cold start 期替换卡死 session）。
2. **测试设计前置**：fork 完先 send_message 探测，确认可用再 leaf_add；归档卡死 session 重 fork。

### 中期（修引擎）
3. **修 BUG-A**：Proma fork identity 异步校验逻辑（V9+ Phase 4 / R2 P1），让 fork 同步等待就绪或提供 ready 接口。
4. **修 BUG-B/C**：tree-engine leaf_add 报错时完整事务回滚；审计 fork_identity_status=timeout session 是否被允许越权写 tree-state（疑似 A4-worker 是这种越权写入的产物）。
5. **修 LIMIT-D**：list_active 与预算口径对齐。

### 长期（协议演进）
6. **修 LIMIT-E**：回写 SKILL P1b schema 到 `alignment_workflow` topic 和 §13.7 / §4.6（red_findings_resolved 对象数组完整定义）。
7. **修 LIMIT-F**：SDK 提供 `wait_for_session_ready(session_id, timeout)` 接口。

---

## 7. 自我复盘

**我做错的地方**：
1. **测试设计没考虑 fork 不可靠**：直接 fork → leaf_add → 假设可用，没做探测。正确做法应该 fork 完先 send_message 探测再绑 leaf。
2. **fork bug 副作用识别慢**：A2/A3/A4 worker 不是我创建的，但我直到 leaf_list_all 才发现，前几步分析时没意识到环境已被污染。
3. **过早断言"所有 fork 都卡死"**：BUG-A 第一版报告写"全部卡死"，b8711bb7 来找我后才修正为"非全量"。这是验证不充分就下结论。
4. **把 P1b 达成包装成"端到端突破"**：实际只是借了 b8711bb7 这个幸运副本，根本不是可靠路径。最终的总体结论应该是失败，不应该用单个单元的达成掩盖端到端的失败。

**测试本身的元问题**：用 fork session 当 reviewer/auditor 本质是 SKILL §13.5 红线禁止的"create_session/fork_session 当 reviewer"模式（虽然 SKILL §13.4.1 步骤1 明确允许 fork 拿 auditor session，两条规则有内部张力）。这次测试实际上触碰了这个张力，结果付出代价。

---

## 8. 一句话结论

**P0a auditor role 设计正确但当前不可用**（被 Proma fork identity timeout 卡住），三层防护和 P1b 单元验证通过但**端到端核心目标失败**。建议先修 Proma fork identity 异步校验，再复测。
