# Tree Harness P0a/P0b/P1b 端到端验证报告

- **tree_id**: `audtest`
- **测试时间**: 2026-07-08 22:25–22:42 (GMT+8)
- **root.session_id**: `e954cf56-c26a-4ea4-a270-2facd7977329`
- **模型/渠道**: GLM-5.2 / GLM
- **node_budget**: 5

---

## 1. 测试矩阵（逐步调用 + 结果 + 验证点）

| # | 步骤 | API 调用 | 返回 | 验证点 | 状态 |
|---|------|---------|------|--------|------|
| A1 | 建树 | `tree_init(tree_id='audtest', root_brief, root_dod, session_id, model, channel)` | `{ok:true, tree, startup_notice, root_leaf}` | `startup_notice` 含三层防护①（"SubAgent 必须用内置 Agent 工具" + "🚫禁 create_session/fork_session 当 reviewer" + 预算护栏提示） | ✅ 通过 |
| B1 | root 写 plan event | `tree_event_append(audtest-root, type=plan, meta)` | `{ok:true, event}` | root.events 非空（闸门2 前置） | ✅ 通过 |
| B2 | fork auditor session | `mcp__session__fork_session(source=root sid)` | `{session:{id:8cc4fc3f..., fork_identity_status:'timeout'}}` | 拿到独立 session_id；fork_identity_status=timeout（Proma 已知问题） | ⚠️ 拿到 id 但 session 卡死 |
| B3 | leaf_add role=auditor | `tree_leaf_add(audtest, leaf={leaf_id:'audtest-A1-auditor', session_id:8cc4fc3f, parent:audtest-root, path:'A1', role:'auditor', added_by:root sid})` | `{ok:true, leaf:{..., audit_gate:{verdict:'required'}, status:'active'}, startup_notice}` | auditor leaf 初始 `audit_gate.verdict='required'`（不能自审）；`status='active'` | ✅ P0a 核心：role=auditor 接受，audit_gate required |
| B4 | auditor 写 brief_echo event | `tree_event_append(audtest-A1-auditor, type=brief_echo, meta)` —— **caller=root（代调）** | `{ok:true, event}` | brief_echo event_append 无 caller 校验（不在 SKILL §13.7 caller-binding 列表） | ✅ 通过 |
| B5 | auditor 写 done event | `tree_event_append(audtest-A1-auditor, type=done, meta)` —— **caller=root（代调）** | `{ok:false, error:{code:'E_BORROWED_IDENTITY', msg, help_topic:'self_audit_forbidden'}}` | done event 是 caller-binding 校验点（caller=root ≠ leaf.session=auditor） | ✅ 额外数据点：caller-binding 在 done event 上拦住 root 代调 |
| B6 | root 给 auditor audit_gate pass | `tree_audit_gate(audtest-A1-auditor, verdict=pass, audit_session_id=root sid)` —— caller=root === audit_session_id | `{ok:false, error:{code:'E_AUDIT_PREMATURE', msg:'no done event found for leaf', help_topic:'alignment_workflow'}}` | 简化协议仍需 done event 前置（缺则 audit_gate 不放行） | ✅ 额外数据点：门禁前置正确 |
| C1 | leaf_add added_by=auditor session | `tree_leaf_add(leaf={..., added_by:8cc4fc3f (auditor session)})` | `{ok:false, error:{code:'E_BORROWED_IDENTITY', msg:'added_by...auditors cannot add child leaves — only root/commander can. [D2-B1]', help_topic:'self_audit_forbidden'}}` | auditor 不能当 operator；macp4-A4 caller-binding 收紧生效 | ✅ **Step C 核心**：caller-binding 防护②生效 |
| D1 | 连续 leaf_add role=worker 超预算 | 当前 active leaf=5（root + auditor + 3 worker，含 pending_brief），尝试 add A5-worker | `{ok:false, error:{code:'E_TREE_NODE_BUDGET_EXCEEDED', msg:'active_count 5 >= budget 5. archive leaves first or increase root_dod.node_budget', help_topic:'how_to_init'}}` | node_budget=5 硬拦；pending_brief 也算 active_count | ✅ **Step D 核心**：预算护栏③生效 |
| E1 | P1b fix_evidence 步骤 1：worker brief_echo | b8711bb7 自调 `event_append(A4-worker, brief_echo)` | `{ok:true}` | 消除 W-01 触发条件；nudge_count 不重置（留痕） | ✅ 通过 |
| E2 | P1b 步骤 2：review_round（带 red finding FR-01） | b8711bb7 自调 `event_append(A4-worker, review_round, meta={round_no:1, reviewers:[{perspective:'G1', reviewer_session_id, findings:[{severity:'red', finding_id:'FR-01', ...}]}], red_count:1, converged:false})` | 前两次撞 `E_REVIEW_FORGERY`（schema 字段名错：用了 `round/reviewer_kind` 而非 `round_no/reviewers`；reviewer_session_id 不能等于 leaf.added_by）；改 schema 后 `{ok:true}` | review_round schema 严格，字段名错即拦 | ✅ 通过（学习成本：试错 2 次） |
| E3 | P1b 步骤 3：done event **缺 red_findings_resolved** | b8711bb7 自调 `event_append(A4-worker, done, meta={self_check})`（无 red_findings_resolved） | `{ok:false, error:{code:'E_SELFCHECK_INVALID'}}` | **P1b fix_evidence 拦截生效**：检测到 history review_round 有 red finding_id，强制要求 meta.red_findings_resolved | ✅ **P1b 核心验证通过** |
| E4 | P1b 步骤 4：done event **补 red_findings_resolved 对象数组** | b8711bb7 自调 `event_append(A4-worker, done, meta={self_check, red_findings_resolved:[{finding_id:'FR-01', fix_method:'edit_file', fix_evidence:'≥20字'}]})` | `{ok:true}` | 字符串数组会被拦，**必须对象数组**：`{finding_id, fix_method(edit_file/downgrade/other), fix_evidence≥20字}` | ✅ 通过 |

---

## 2. 总结

### P0a auditor role 是否 work（步骤 B3-B6 + 衍生）
- ✅ `leaf_add(role='auditor')` 成功接受，引擎认识 auditor role 枚举（不抛 E_SCHEMA_INVALID）。
- ✅ 初始 `audit_gate.verdict='required'`（auditor 不能自审，需 root 信任锚或上级 auditor 背书）。
- ✅ 初始 `status='active'`，简化协议路径打开（无 milestone/deliverables 必填）。
- ✅ 简化协议的 caller-binding 在 done event 上仍生效（auditor 必须自己写 done event，root 代调被 E_BORROWED_IDENTITY 拦）。
- ✅ audit_gate pass 仍需 done event 前置（E_AUDIT_PREMATURE）—— 简化协议不是"跳过门禁"，是"减少冗余字段"。
- ❌ **无法跑通完整 done 路径**：fork_session 出来的 auditor session `fork_identity_status='timeout'`，永久 busy，send_message 全部被拒，导致 auditor 无法自己调 done event。这是 **Proma 引擎的 fork identity timeout bug**，不是 tree-engine 的问题。

### 三层防护是否生效

| 防护 | 设计意图 | 实测 | 结论 |
|------|---------|------|------|
| ① startup_notice | tree_init / leaf_add 返回里强制注入，告警 SubAgent 必须用内置 Agent + 禁 create_session/fork_session 当 reviewer | ✅ tree_init 返回 `startup_notice`（5 条）+ 每次 leaf_add 也注入 | ✅ **生效** |
| ② caller-binding | caller ≠ audit_session_id 时拦（防冒名背书）；auditor 不能当 operator | ✅ done event 拦 root 代调（B5）+ leaf_add 拦 added_by=auditor session（C1，[D2-B1] 标签） | ✅ **生效（双重收紧：caller 校验 + role 校验）** |
| ③ 预算护栏 | active leaf 数 ≤ node_budget，超则硬拦 | ✅ E_TREE_NODE_BUDGET_EXCEEDED（D1），active_count 算 pending_brief 在内的"未结"leaf | ✅ **生效** |

### P1b fix_evidence（步骤 E1-E4）
- ✅ **核心拦截生效**：worker 自调 done event 时若 history 有 red finding_id（来自 review_round）但 meta 缺 `red_findings_resolved`，引擎 `E_SELFCHECK_INVALID` 拦截。
- ✅ **schema 严格**：`red_findings_resolved` 必须是**对象数组**（`{finding_id, fix_method, fix_evidence}`），字符串数组形式被拦。`fix_method` 枚举 `edit_file / downgrade / other`，`fix_evidence` ≥ 20 字门槛。
- ✅ **借力突破**：fork bug 副作用产生的 A4-worker（b8711bb7 session）联系 root 后被纠正认知（误以为"无 leaf 归属"，实际是 A4-worker owner），按 worker 协议跑通 P1b。
- ⚠️ **SKILL 文档滞后**：`alignment_workflow` topic 对 `red_findings_resolved` 描述不完整（缺对象结构），完整 schema 在 `how_to_worker_lifecycle` topic。建议回写 SKILL §13.7 或 §4.6。

---

## 3. 发现的 Proma 引擎 bug / tree-engine 限制

### BUG-A: fork_session 后部分 session 永久 busy（fork_identity_status=timeout，非全量）
- **现象**: `mcp__session__fork_session` 返回 `fork_identity_status:'timeout'`。本次 fork 4 个 session，**3 个永久 busy**（8cc4fc3f, d308ce21, 67b8a9a2 —— 无 assistant 消息、无 token 消耗、send_message 全被拒），**1 个可用**（b8711bb7 —— 能响应 send_message 并自调 mcp__tree__* 工具跑通 P1b 测试）。
- **影响**: fork 出来的 session 是否可用**不可预测**。指挥官派 worker/auditor 任务时若遇到卡死 session，无法继续协议。需要 fork 多次试错，或归档卡死 session 重 fork。
- **本次实测**：4 fork = 3 timeout + 1 ok（25% 成功率）。
- **建议**：修 Proma fork identity 异步校验逻辑（V9+ Phase 4 / R2 P1）；或给 SDK 提供"wait for fork ready"同步接口让指挥官能 polling 等就绪。

### BUG-B: leaf_add 报 E_BORROWED_IDENTITY 但 leaf 仍被创建（事务原子性破坏）
- **现象**: 步骤 C1 测试 caller-binding 时，`tree_leaf_add` 返回 `E_BORROWED_IDENTITY`（added_by 是 auditor session），但事后 `leaf_list_all` 显示 `audtest-A3-worker` 已被创建（status=pending_brief，session_id 被替换为引擎自动生成的 UUID 而非传入的 67b8a9a2）。
- **连带副作用**: 同一调用还连带创建了 `audtest-A4-worker`（同样 pending_brief），来源不明（疑似 fork session 在处理继承的 root prompt 时自调 leaf_add 副作用）。
- **影响**: 预算护栏 active_count 被这些"幽灵 leaf"污染，导致步骤 D1 提前撞 E_TREE_NODE_BUDGET_EXCEEDED（active=5 而非预期的 2）。
- **建议**: tree-engine 在 leaf_add 报错路径上做完整事务回滚；并审计是否有 fork session 越权写 tree-state（fork_identity_status=timeout 期间应禁写）。

### LIMIT-C: leaf_list_active 不含 pending_brief
- **现象**: `tree_leaf_list_active` 只返回 status=active 的 leaf（本次只 2 个），但预算护栏 `active_count` 把 pending_brief 也算进去（5 个）。
- **影响**: 工具语义不一致 —— 指挥官用 list_active 看到还能加 3 个 leaf，但实际加第 3 个就撞预算。
- **建议**: 二者口径对齐（要么 list_active 含 pending_brief，要么预算只算 status=active）。

---

## 4. 关键错误码命中清单（本次实测）

| 错误码 | 触发场景 | 引擎位置（按 SKILL §13.7 + 本次实测） |
|--------|---------|-----------------------------------|
| `E_BORROWED_IDENTITY` | done event（caller ≠ leaf.session_id） + leaf_add（added_by=auditor session） | caller-binding 校验，多处 |
| `E_AUDIT_PREMATURE` | audit_gate pass 时 leaf 无 done event | alignment_workflow 闸门 |
| `E_TREE_NODE_BUDGET_EXCEEDED` | leaf_add 时 active_count（含 pending_brief）≥ node_budget | 预算护栏 |
| `E_SESSION_NOT_ALIVE` | leaf_add 传入伪造/不存在 session_id | V10 session liveness 加固 |
| `E_DUPLICATE_LEAF` | leaf_add 时 leaf_id 已存在 | naming 强制校验 |
| `E_SCHEMA_INVALID` | leaf set-session 时新 session_id 已被别的 leaf 占用 | session 唯一性约束 |

---

## 5. 结论

✅ **P0a auditor role 设计正确**，引擎认识 role=auditor 并初始化 audit_gate=required，简化协议门禁前置（done event + audit_gate）保留。

✅ **三层防护全部生效**（startup_notice / caller-binding / 预算护栏），且 caller-binding 在 macp4-A4 后做了双重收紧（caller 校验 + role 校验，标签 [D2-B1]）。

✅ **P1b fix_evidence 拦截正确生效**（核心收尾）：worker done event 时 history review_round 有 red finding_id 但 meta 缺 `red_findings_resolved` → `E_SELFCHECK_INVALID`；补对象数组（含 finding_id/fix_method/fix_evidence≥20字）后通过。

⚠️ **端到端不可靠**的根因不在 tree-engine，而在 **Proma fork identity timeout bug**（BUG-A，4 fork = 3 卡死 + 1 可用）。本测试通过 b8711bb7 这个"幸运的 fork 副本"完成了 P1b 验证，但这种"试错到可用 session"的模式不能作为生产路径。

⚠️ **BUG-B（leaf_add 事务原子性）** 是 tree-engine 问题，需要修：报错时回滚 leaf 创建，并阻断 fork_identity_status=timeout session 的越权写入。

⚠️ **SKILL 文档滞后**：`alignment_workflow` topic 对 `red_findings_resolved` 描述不完整（缺对象结构），完整 schema 在 `how_to_worker_lifecycle` topic。建议回写 SKILL §13.7 / §4.6。
