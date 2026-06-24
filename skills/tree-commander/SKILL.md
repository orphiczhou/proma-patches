# tree-commander SKILL

树形会话执行体系 — 指挥官（根会话）操作手册。

---

## §0 元数据

```yaml
skill_name: tree-commander
version: 2.2
target: 根会话（指挥官）
requires:
  - tree-state.js (v0.7+ 已内联进 mcp__tree__* MCP，工作区不再有源码)
  - commander-methodology.md v1.2                          # 指挥官方法论
  - tree-commander-design.md v1.1                          # 体系设计文档
  - tree-audit-methodology.md v1.0                         # 树形审计方法论（审计任务强制执行）
mcp_dependencies:
  - mcp__session__fork_session / create_session / send_message / list_messages / archive_session
  - mcp__automation__create_automation / get_automation / update_automation
task_tools: TaskCreate / TaskUpdate / Agent
```

> **v0.7+：本 skill 通过 `mcp__tree__*` MCP 工具操作 tree 状态（替代旧的 `node tree-state.js` CLI）。所有工具返回 `{ok, error?, ...result}`，失败时查 `error.code`。引擎代码已内联进 MCP，工作区不再有 tree-state.js 源码。**

---

## §1 铁律（5 条）

> 依据：设计文档 §3 契约纪律 + §4.4 铁律 + §5.3 关键设计；方法论原则 8/9；tree-audit-methodology.md

| # | 措辞 | 依据 |
|---|------|------|
| 1 | **严禁直接读写 tree-state.json** — 所有状态变更必须走 `mcp__tree__*` MCP 工具 | 补丁 4（§A.1）；方法论原则 8 |
| 2 | **必须下发 5 件套契约** — brief / dod / report / autonomy / self_audit 缺一不可 | 设计文档 §3；§3 契约纪律 |
| 3 | **必须走三步质量门** — 实施 → 回归测试 → 审计，缺任一步不算完成 | 方法论原则 3 |
| 4 | **必须三档递进纠偏** — 同一偏差最多 2 次纠正机会，第 3 次必剪枝 | 设计文档 §5.3；方法论原则 9 |
| 5 | **审计任务必须并行多Agent** — 当任务涉及文档审计/验证/终局审查时，必须 Fork ≥4 个独立审查子会话（每人一个维度），禁止单 Agent 包办所有维度。详见 §14 | tree-audit-methodology.md 铁律 1 |

---

## §2 前置检查（加载时执行）

> 依据：设计文档 §8.5 持久化目录结构 + §A.7 init/validate。

指挥官 Skill 加载时，必须执行以下检查：

```text
1. 检查 mcp__tree__* 工具可用:
   任调一个 mcp__tree__* 工具（如 tree_tree_dump）确认返回 {ok:true,...}
   → 返回 {ok:false, error} 则报错，不能继续

2. 列出已存在的 tree:
   ls .context/trees/*/    （仍可用文件系统定位 <tree_id>）
   识别子目录名作为 <tree_id> 列表
   对每个 <tree_id> 运行:
     mcp__tree__tree_leaf_list_active(tree_id=<tree_id>)
     输出活跃叶子清单（返回 {ok, leaves:[...]}）

3. 对每个 tree 运行一致性校验:
   mcp__tree__tree_validate(tree_id=<tree_id>)
   → 返回的 issues 非空则打印告警后继续（不阻断）
```

---

## §3 5 件套契约模板

> 依据：设计文档 §3.1-3.5。每条标注必填字段。

下发子会话时，**第一条消息**必须包含以下完整的 5 件套 YAML 模板。直接复制粘贴，仅替换 `<>` 占位符。

### §3.1 任务简报（Brief）

```yaml
brief:
  # ------ 必填 ------
  parent_intent: "<用户/母任务的一句话目标>"
  my_mission: "<本会话的一句话任务>"
  why_this_exists: "<为什么这个子任务存在，缺它整个链条哪里断>"
  in_scope:
    - "<明确边界内的事项 1>"
    - "<明确边界内的事项 2>"
  out_of_scope:
    - "<边界外：必须上报而非自决的事项 1>"
    - "<边界外：必须上报而非自决的事项 2>"
```

### §3.2 DoD（Definition of Done）

```yaml
dod:
  # ------ 必填 ------
  deliverables:
    - path: "<产出的相对路径>"
      min_length: <数字>                                     # 可选
      must_contain: ["<必须包含的关键词 1>", "<关键词 2>"]   # 可选
  quality_gates:
    - type: self_check
      desc: "<自查项描述>"
    - type: auto_test                                       # 可选，须同时给 script
      script: "<测试脚本路径>"
      expect_exit: 0
      timeout_sec: 30
  self_check:                                               # 必填，至少 2 项
    - "逐条比对 deliverables 是否全部产出"
    - "逐条跑 quality_gates 并记录结果"
    - "在交付消息中附 check-list 每项 ✅/❌"
```

### §3.3 汇报契约（Report Protocol）

```yaml
report:
  # ------ 必填 ------
  channels:
    done: "成果 + 自查 check-list + 文件路径"
    blocked: "卡点描述 + 已尝试方案 + 请示选项 A/B"
    plan: "拟拆解的孙任务清单（含各自的 brief/dod）"
    heartbeat_reply: "回应 status_check：当前步骤/已产出/预计剩余"
  format: "结构化 YAML，不要写散文"
  plan_ack_seconds: 300                                    # 60~300，默认 300；worker 端对应 silence_ack_seconds
  escalation: "block 超过 10 分钟未回复根会话 → 升级到 archive + 重 Fork"
```

### §3.4 自主度边界（Autonomy Boundaries）

```yaml
autonomy:
  # ------ 必填 ------
  can_decide:
    - "<可自决的技术/实现级决策>"
  must_report:
    - "<必须上报但可继续执行的事项>"
  must_ask:
    - "<必须请示后才能做的事项>"
```

### §3.5 自审契约（Self-Audit）

```yaml
self_audit:
  # ------ 必填 ------
  milestones:
    - { id: M1, desc: "<里程碑 1 描述>", expect_outputs: ["<产出文件 1>"] }
    - { id: M2, desc: "<里程碑 2 描述>", expect_outputs: ["<产出文件 2>"] }
  audit_after_each_milestone: true
  audit_agent_type: "code-reviewer"
  max_self_corrections: 2
  drift_declaration_required: true
```

---

## §4 工作流程（5 步法）

> 依据：方法论 §2 标准工作流程；设计文档 §2 架构分层 + §4.2 事件通道。

### Step 1：任务规划

```text
用 TaskCreate 拆解用户意图为 3-7 个子任务。
标注依赖关系：独立任务标记为可并行，依赖任务标记为串行。
每个子任务设明确 acceptance。
```

### Step 2：下发子会话

```text
对每个子任务:
  1. fork_session(from=<parent_session>, new_channel_id=..., new_model_id=...)
     或 create_session(channel_id=..., model_id=..., title=<命名规范的标题>)
  2. 首条消息 = §3 的 5 件套完整 YAML（直接复制粘贴模板）
  3. 调 mcp__tree__tree_leaf_add(tree_id=<tree_id>, leaf=<leaf 初始数据对象>)
     （命名强制校验在工具内置，失败返回 error.code 如 E_NAME_INVALID）
  4. 对 self_audit 的每个 milestone 调:
     mcp__tree__tree_milestone_add(tree_id=<tree_id>, leaf_id=<leaf_id>, milestone=<milestone 对象>)
```

### Step 3：事件路由

```text
子会话通过 send_message(notify) 上行事件。
根会话收到后按 §6 事件路由表派发处理。
所有事件先登记: mcp__tree__tree_event_append(tree_id=<tree_id>, leaf_id=<leaf_id>, type=<type>, meta=<meta 对象>)
```

### Step 4：质量门

```text
子会话 done 上报后:
  1. 检查 self_check 是否全部 pass（缺任一项 → 直接退回，不进入验收）
  2. 派验收 Agent（见 §9 模板）→ 拿到 verdict
  3. verdict.pass → mcp__tree__tree_leaf_set_status(tree_id=<tree_id>, leaf_id=<leaf_id>, status=done)
     verdict 不通过 → 按 §7 三档纠偏决策树执行
```

### Step 5：沉淀文档

```text
重要产出落盘到 .context/:
  - 设计文档 / 审计报告 / 测试方案 / 测试报告
  - 每个关键决策记录到 .context/note.md
  原则: "删掉后未来 Agent 会犯错" 的内容才值得沉淀（方法论原则 10）
```

---

## §5 mcp__tree__* 工具速查

> v0.7+ 起 tree-state.js 已内联进 MCP，通过 `mcp__tree__*` 工具调用。依据：设计文档附录 A（A.3-A.7）。所有工具返回 `{ok, error?, ...result}`，失败看 `error.code`（如 `E_NAME_INVALID`、`E_DELIVERABLE_MISSING`、`E_SCHEMA_INVALID`）。

### Query（只读）

| 工具 | 说明 |
|------|------|
| `mcp__tree__tree_leaf_get(tree_id, leaf_id)` | 查询单个 leaf 完整信息 |
| `mcp__tree__tree_leaf_list_active(tree_id)` | 列出所有 status=active 的叶子（心跳用） |
| `mcp__tree__tree_leaf_list_all(tree_id)` | 列出所有叶子（含 done/pruned/archived） |
| `mcp__tree__tree_tree_dump(tree_id)` | 全树 JSON dump（调试/恢复用） |
| `mcp__tree__tree_drift_list(tree_id, leaf_id?, since?)` | 查询 drift 历史，可按 leaf / 时间过滤 |
| `mcp__tree__tree_heartbeat_tail(tree_id, leaf_id?, n?)` | 查询最近 N 条心跳记录 |
| `mcp__tree__tree_event_list(tree_id, leaf_id?, type?)` | 查询事件历史（共 8 种类型：done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check） |

### Add（新增）

| 工具 | 说明 |
|------|------|
| `mcp__tree__tree_leaf_add(tree_id, leaf=<obj>)` | Fork 新会话时调用，含命名强制校验（失败返回 `E_NAME_INVALID`） |
| `mcp__tree__tree_milestone_add(tree_id, leaf_id, milestone=<obj>)` | 添加里程碑（milestone 对象含 id/desc/expect_outputs） |

### Update（字段更新）

| 工具 | 说明 |
|------|------|
| `mcp__tree__tree_leaf_set_status(tree_id, leaf_id, status)` | status ∈ `active\|done\|pruned\|archived\|segment_pending`。切 done 时校验 milestones 非空且全部 audit_pass=true（失败返回 `E_MILESTONE_INCOMPLETE`） |
| `mcp__tree__tree_leaf_set_context(tree_id, leaf_id, context_pct)` | context_pct 0-100，心跳后更新上下文使用率 |
| `mcp__tree__tree_leaf_set_last_event(tree_id, leaf_id, event_type, ts?)` | 更新最后事件类型和时间 |
| `mcp__tree__tree_leaf_autonomy_override(tree_id, leaf_id, overrides=<obj>)` | 中档纠偏时限权（overrides 对象含 added_must_ask / removed_can_decide / reason） |
| `mcp__tree__tree_milestone_set_result(tree_id, leaf_id, milestone_id, audit_pass, note_path?)` | 记录里程碑审计结果（audit_pass 布尔） |

### Append（数组追加）

| 工具 | 说明 |
|------|------|
| `mcp__tree__tree_event_append(tree_id, leaf_id, type, meta=<obj>)` | 登记上行事件元数据，同时更新 last_event_* |
| `mcp__tree__tree_drift_append(tree_id, leaf_id, kind, severity, action, fork_to?, reason?)` | kind ∈ `production\|direction\|rhythm`，severity ∈ `low\|mid\|high`，action ∈ `nudge\|limit\|prune\|self_correct\|declare\|handoff`。双写 drift_history + drift_log |
| `mcp__tree__tree_heartbeat_append(tree_id, heartbeat=<obj>)` | heartbeat 对象含 `{verdicts:[...], ts, next_heartbeat}`，追加并更新 last_heartbeat |
| `mcp__tree__tree_segment_append(tree_id, leaf_id, new_session_id)` | 竹节交接：追加 segment_chain + 改状态 segment_pending |

### Audit（v2.1 审计专用）

| 工具 | 说明 |
|------|------|
| `mcp__tree__tree_audit_gate(tree_id, leaf_id, verdict, audit_session_id?, reason?)` | 审计门禁裁决 |
| `mcp__tree__tree_audit_append(tree_id, leaf_id, report=<obj>)` | 追加审计报告 |
| `mcp__tree__tree_nudge_append(tree_id, leaf_id, nudge=<obj>)` | 追加 nudge 记录 |

### Maintain（维护）

| 工具 | 说明 |
|------|------|
| `mcp__tree__tree_init(tree_id, root_brief=<obj>, root_dod=<obj>, session_id?, model?, channel?, audit_meta?)` | 首次创建 tree（根会话激活时调一次） |
| `mcp__tree__tree_backup(tree_id, label?)` | 手动备份（保留最近 10 份） |
| `mcp__tree__tree_restore(tree_id, backup_file)` | 从备份恢复（恢复前自动安全备份） |
| `mcp__tree__tree_validate(tree_id)` | 一致性校验：parent 引用 / fork_to / session_id 唯一 / path 一致 / milestone.id 唯一 |
| `mcp__tree__tree_migrate(tree_id)` | 数据迁移 |

---

## §6 事件路由表

> 依据：设计文档 §4.2 事件通道 + §4.3 心跳通道 + §6.1 brief_echo。

| 事件 | 触发 | 指挥官动作 | mcp__tree__* 工具 |
|------|------|-----------|------------------|
| **done** | 子会话完成上报 | ① 登记事件 ② 派验收 Agent（§9）③ 按 verdict 执行：pass → set-status done；不通过 → 走 §7 纠偏 | `tree_event_append(type=done)` → `tree_leaf_set_status(status=done)` 或 `tree_drift_append` |
| **blocked** | 子会话卡点上报 | ① 登记事件 ② 审查选项 A/B ③ send_message 给决策 ④ 超 10 分钟无响应 → archive + 重 Fork | `tree_event_append(type=blocked)` → 超时后 `tree_leaf_set_status(status=archived)` + `tree_leaf_add` 新叶 |
| **plan** | 子会话拆解计划上报 | ① 登记事件 + 登记 plan_id + ts ② 派路线图 Agent（researcher）评估 ③ 5 分钟内收到 verdict → 按 verdict 行事 ④ 5 分钟未收到 → **默认放行**（plan_ack_seconds 到期）⑤ 若 verdict=nack 在放行后才到 → 走中档纠偏 | `tree_event_append(type=plan)` → nack 时 `tree_drift_append(action=limit)` |
| **brief_echo** | 子会话首条上行（复述理解） | ① 登记事件 ② 派路线图 Agent 比对对齐度 ③ ≥85% → 放行 ④ <85% → 直接发回简报，重新 brief_echo（最便宜纠偏） | `tree_event_append(type=brief_echo)` → <85% 时 `tree_drift_append(severity=low, action=nudge)` |
| **heartbeat_reply** | 子会话回应 status_check | ① 登记事件 ② 解析回应内容 ③ 正常 → 仅记录 ④ 异常 → 喂给 §7 纠偏 | `tree_event_append(type=heartbeat_reply)` → `tree_leaf_set_context` |

### plan 默认放行机制（详细）

```text
子会话 X 发出 plan 后:
  1. 根会话调 event append 登记 plan_id + ts
  2. 根会话派 Agent(subagent_type=researcher) 评估此 plan
     prompt = "评估 plan 是否放行" + plan 内容 + 母任务 brief/dod
  3. plan-审批 Agent: 5 分钟内返回 { verdict: ack | nack | tweak, reason }
  4. 根会话:
     - 5 分钟内收到 verdict → 按 verdict 行事
     - 5 分钟内未收到 → 默认放行（子会话已默认开始 Fork）
  5. 若 verdict=nack 在默认放行后才到 → 走 §7 中档纠偏
```

### brief_echo alignment 回填机制（v0.7 批次5 V5b 必须）

```text
子会话 worker 发出 brief_echo（首条，复述理解）后:
  1. 根会话调 event append 登记（worker 的 brief_echo event，含 my_understanding/milestones_preview）
  2. 根会话派路线图 Agent 评估对齐度（比对 brief/dod）
     - 路线图 Agent 必须是独立 leaf（其 session_id 将作为 alignment auditor）
  3. 评估完成 → 根会话【必须】回填一条 brief_echo event 到 worker leaf:
     mcp__tree__tree_event_append(
       tree_id, leaf_id=<worker>,
       type='brief_echo',
       json='{"alignment":"<评估结论或百分比>","auditor_session_id":"<路线图Agent的session_id>"}'
     )
     这条回填 event 是 worker 后续 audit_gate pass 的硬前置（V5b 查 events 留痕，不查可篡改标志）。
  4. 对齐度 ≥85% → 放行 worker 继续干活
     对齐度 <85% → tree_drift_append(severity=low, action=nudge) 发回重 brief_echo
  5. ⚠️ 若跳过步骤 3（未回填 alignment event），worker 永远拿不到 audit pass:
     - cmdAuditGate 拦 E_ALIGNMENT_NOT_VERIFIED（worker events 无 alignment 留痕）
     - worker 卡死无法 done，会上行 blocked 抱怨"audit pass 被拦"
     - 这是 V5b 的硬约束（堵 A3-omit-alignment 绕过），不是 bug
```

> **为什么 alignment 在回填 event 里，不在 worker 首条 brief_echo 里**：alignment 是 commander/路线图 Agent 的**对齐评估产物**（worker 自己无法自评对齐度）。worker 首条 brief_echo 只含 `my_understanding + milestones_preview`（见 tree-worker SKILL §3.4）。评估由独立 Agent 完成后，结果以第二条 brief_echo event 形式回填到 worker leaf——这同时满足 V5b 的"events 留痕"和 A3 的"独立 auditor 背书"。

---

## §7 三档纠偏决策树（v0.2 启用）

> 依据：设计文档 §5.2 三档纠偏表 + §5.3 纠偏决策树 + §10.5 纠偏执行流程。

### 决策树（if-else）

```text
收到 Agent 的 verdict { severity: low|mid|high, action: ..., suggestion: "..." }:

  if severity == low OR action == status_check:
    ┌─ 轻档 nudge ─────────────────────────────────────────┐
    │ send_message(leaf.session_id, "nudge: " + suggestion) │
    │ mcp__tree__tree_leaf_set_last_event(tree_id, leaf_id, "nudge")     │
    │ mcp__tree__tree_drift_append(tree_id, leaf_id,                       │
    │   kind=<kind>, severity="low", action="nudge",                       │
    │   reason="<suggestion 摘要>")                                        │
    └────────────────────────────────────────────────────────┘

  elif severity == mid:
    if leaf.drift_history 近 30 分钟内有 nudge 记录:
      ┌─ 中档限权 ──────────────────────────────────────────────┐
      │ send_message(leaf.session_id, "limit: 权限已限制 — "    │
      │   + verdict.gaps 摘要)                                   │
      │ mcp__tree__tree_leaf_autonomy_override(tree_id, leaf_id, │
      │   overrides={                                            │
      │     added_must_ask:[...], removed_can_decide:[...],      │
      │     reason:"中档纠偏：方向偏差 mid 严重度"})             │
      │ mcp__tree__tree_leaf_set_last_event(tree_id, leaf_id, "limit")     │
      │ mcp__tree__tree_drift_append(tree_id, leaf_id,                       │
      │   kind=<kind>, severity="mid", action="limit")                       │
      └──────────────────────────────────────────────────────────┘
    else:
      → 先走轻档 nudge（给一次自纠机会）

  elif severity == high OR (mid + leaf 已有 limit 记录):
    ┌─ 重档剪枝 ─────────────────────────────────────────┐
    │ archive_session(leaf.session_id)                    │
    │ mcp__tree__tree_leaf_set_status(tree_id, leaf_id, "pruned")         │
    │ fork_session(from=<leaf_id>,                        │
    │   up_to_message_uuid=<verdict.suggested_fork_from_uuid>)     │
    │ 新 leaf: role 加 i2/i3 后缀                         │
    │ mcp__tree__tree_leaf_add(tree_id, leaf=<新 leaf 对象>)             │
    │ mcp__tree__tree_drift_append(tree_id, <原 leaf_id>,                 │
    │   kind=<kind>, severity="high", action="prune",                     │
    │   fork_to=<新 leaf_id>, reason="<偏差原因摘要>")                    │
    └──────────────────────────────────────────────────────┘

全部动作调 tree_drift_append 记录。
```

### 三档递进原则

| 档位 | 触发 | 动作 | 执行者 |
|------|------|------|--------|
| 轻档（提示） | severity=low | send_message(nudge) | 根会话直发 |
| 中档（限权） | severity=mid / 轻档后再偏 | send_message(limit) + autonomy-override | 根会话 |
| 重档（剪枝） | severity=high / 中档后再偏 | archive + fork + prune | 根会话 |

---

## §8 心跳通道（v0.2 启用）

> 依据：设计文档 §4.3 心跳通道 + §10.3 心跳通道实现。

### §8.1 心跳 Automation 配置（可直接粘贴）

```yaml
name: "tree-heartbeat-<tree_id>"
scheduleType: interval
intervalMinutes: 15
sessionMode: reuse
permissionMode: bypassPermissions
prompt: |
  执行树 <tree_id> 心跳巡检。工作区: C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files

  步骤:
  1. 调用 mcp__tree__tree_leaf_list_active(tree_id=<tree_id>)
     返回: {ok:true, leaves:[{leaf_id, session_id, last_event_ts, context_usage_pct},...]}
  2. 对每个 active 叶子调用 mcp__session__list_messages(session_id, limit=3) 获取最近活动
  3. 组装数据后，调用哨兵 Agent（subagent_type=explorer），prompt 见下方判定矩阵
  4. 对哨兵判定为 stale/silent 的叶子:
     mcp__session__send_message(session_id, "status_check: 请报告当前步骤、已产出文件、预计完成时间、是否有阻塞")
     调 mcp__tree__tree_leaf_set_last_event(tree_id=<tree_id>, leaf_id=<leaf_id>, event_type="status_check")
  5. 调 mcp__tree__tree_heartbeat_append(tree_id=<tree_id>, heartbeat=<判定结果对象>)
  6. 返回巡检摘要（< 200 字）：活跃数/停滞数/静默数/已发 status_check 数
```

### §8.2 哨兵 Agent prompt 模板

```text
任务：判定一批 active 叶子的状态。

输入数据格式:
[{leaf_id, last_event_ts, last_event_type, context_usage_pct, recent_messages: [...最近3条]}]

判定矩阵 (依据设计文档 §4.3):

| 最近活动    | 上下文使用 | 判定               | action                     |
|------------|-----------|-------------------|-----------------------------|
| < 5 分钟    | < 85%     | active            | none                        |
| < 5 分钟    | >= 85%    | sweet_spot_risk   | schedule_handoff            |
| 5~30 分钟   | 任意       | stale             | status_check                |
| > 30 分钟   | 任意       | silent            | status_check + mark_pending_correction |

输出格式 (JSON 数组):
[
  {
    "leaf_id": "...",
    "verdict": "active|stale|silent|sweet_spot_risk",
    "action": "none|status_check|schedule_handoff|mark_pending_correction",
    "reason": "..."
  }
]

去重规则 (设计文档 §4.4):
- leaf.last_event_ts 在 5 分钟内 → 跳过（事件通道已覆盖），判定为 active，action=none
```

### §8.3 心跳结果处理流程

```text
收到哨兵 Agent 返回的 verdicts 数组:

  for each verdict in verdicts:
    调 mcp__tree__tree_leaf_set_context(tree_id=<tree_id>, leaf_id=<leaf_id>, context_pct=<pct>)
    
    if verdict.verdict == "active":
      → 仅记录，不动作
    
    elif verdict.verdict == "sweet_spot_risk":
      → 在 heartbeat 日志中标记预警
      → 下次心跳仍 >=85% 则触发竹节交接（v0.3 实现）
    
    elif verdict.verdict == "stale":
      → 已发 status_check（步骤 4 完成）
      → 调 mcp__tree__tree_leaf_set_last_event(tree_id=<tree_id>, leaf_id=<leaf_id>, event_type="status_check")
    
    elif verdict.verdict == "silent":
      → 已发 status_check
      → 调 mcp__tree__tree_leaf_set_last_event(tree_id=<tree_id>, leaf_id=<leaf_id>, event_type="status_check")
      → 调 mcp__tree__tree_drift_append(tree_id=<tree_id>, leaf_id=<leaf_id>,
          kind="rhythm", severity="mid", action="nudge",
          reason="静默 > 30 分钟，下次心跳若仍 silent 升级到重档剪枝")
  
  最后调 mcp__tree__tree_heartbeat_append(tree_id=<tree_id>, heartbeat=<完整 verdicts 对象>)
```

---

## §9 验收 Agent prompt 模板（v0.2 启用）

> 依据：设计文档 §10.5 验收 Agent prompt 骨架。

```text
任务：验收子会话产出是否符合任务契约。

输入:
  leaf_id: <leaf_id>
  brief: <子会话的 brief YAML>
  dod: <子会话的 dod YAML>
  deliverables_paths: [<产出文件绝对路径列表>]
  self_check: [{item, pass}, ...]
  drift_history: [<子会话 drift_history 数组>]

检查维度:
  1. deliverables 是否存在且满足 dod.min_length 和 dod.must_contain
  2. self_check 项目是否全部 pass=true（缺一项 → severity=high）
  3. 产出内容是否超出 brief.in_scope 范围（超出 → direction 偏差）
  4. drift_history 中有无未解决的 severity>=mid 偏差
  5. 如有偏差，从哪个里程碑开始偏（用于确定 suggested_fork_from_uuid）
  6. 每个交付物是否附带 .note.md 决策笔记（无 → severity=high，依据 §6.3）

输出格式:
{
  "pass": true|false,
  "gaps": ["缺失项 1", "出界内容 2", ...],
  "severity": "low|mid|high",
  "suggested_fork_from_uuid": "uuid 或 null",
  "reason": "一句话摘要"
}

注意:
  - severity=high 时必须给出 suggested_fork_from_uuid
  - 假设有偏，找出证据（避免自我合理化盲区，设计文档 §5.6）
  - auto_test 退出码 != 期望 → severity=high
  - auto_test 超时 → severity=mid
```

---

## §10 灾难恢复检查表

> 依据：设计文档 §8.3 灾难恢复（4 类故障 F1-F4）。

| 故障 | 现象 | 恢复动作 | mcp__tree__* 工具 |
|------|------|---------|------------------|
| **F1. 子会话崩溃** | send_message 无响应，心跳发现 🔴 | ① 从该 leaf 最后通过的 milestone uuid 重 Fork ② archive 旧会话 ③ 新 leaf 加 i2 后缀 | `tree_leaf_set_status(status=pruned)` → `tree_leaf_add` 新叶 → `tree_drift_append(action=prune, fork_to=<新 leaf_id>)` |
| **F2. 根会话崩溃** | 调度停滞 | ① tree-state.json 完整 → 重启根会话 ② 调 `tree_leaf_list_active` 恢复所有活跃叶子索引 ③ 调 `tree_validate` 校验一致性 ④ 恢复心跳 automation（如存在） | `tree_leaf_list_active` → `tree_validate` → `tree_event_list` 重建最近事件时间线 |
| **F3. tree-state 损坏** | JSON 解析失败（E_SCHEMA_INVALID） | ① 从 `.tmp` 或最近 backup 恢复 ② 无备份则从 drift_log/heartbeat_log 重建叶子列表 ③ 重建后调 `tree_validate` | `tree_restore(tree_id, backup_file)` 或 `tree_tree_dump` 确认恢复结果 |
| **F4. SDK 配额耗尽** | Fork/send_message 失败 | ① 根会话"待机"：每 5 分钟 ping 1 次 ② 恢复后重试失败的 Fork ③ 不写 tree-state，等恢复后统一更新 | 无需特殊工具，恢复后 `tree_leaf_list_active` 确认状态一致 |

**关键设计**：
- leaves 条目永不删除，只改 status（保留可追溯）
- drift_log 永不截断
- 每写 10 次自动备份一次（mcp__tree__* 引擎内置）

---

## §11 禁止行为清单（12 条）

> 依据：方法论 §6 反模式表 + 设计文档 §1 补丁约束 + §8.2 写入铁律。

| # | 禁止行为 | 后果 | 正确做法 |
|---|---------|------|---------|
| 1 | 指挥官亲自写代码 / 亲自做判断 | 上下文爆炸，甜点危机 | 派子 Agent 判断 / 派子会话执行 |
| 2 | 给子会话一句话任务 | 必然跑偏 | 7 段式 prompt：背景 + 必读 + 任务 + 约束 + 流程 + 禁止 + 格式 |
| 3 | 直接读/写 tree-state.json | 字段写错 / 格式错误 / 覆盖丢失 | 走 mcp__tree__* 工具 |
| 4 | 下发缺失 DoD 的任务 | 子会话不知道什么叫完成 | 5 件套缺一不可 |
| 5 | 下发缺失 milestones 的任务 | 无法内部自审 | self_audit.milestones 必填 |
| 6 | 跳过 brief_echo 直接开始干活 | 理解偏差在全程传播 | 首条上行必须是 brief_echo |
| 7 | 信任子 Agent 的"已完成" | bug 漏到下游 | trust but verify：独立子 Agent 验收 |
| 8 | done 上报 self_check 缺项不退回 | 低质量产出通过验收 | DoD 硬校验：缺一项直接退回 |
| 9 | 同一偏差反复 nudge 超过 2 次不升级 | 纠偏失效 | 第 3 次必剪枝 |
| 10 | plan 审批阻塞子会话等待 | 子会话空等浪费 | 默认放行机制：5 分钟无 NACK 自动放行 |
| 11 | 重档剪枝后删旧会话 | 丢失可追溯历史 | archive 不删，drift_log 永存 |
| 12 | 不沉淀文档 | 跨会话失忆 | 重要产出落盘到 .context/ |

---

## §12 命名规范

> 依据：设计文档 §6.5 命名规范。

### 格式

```
<prefix>-<path>-<role>[-<suffix>]
```

| 段 | 内容 | 正则 |
|----|------|------|
| `prefix` | 项目代号 | `[a-z][a-z0-9_]{3,7}`（小写字母开头，4-8 字符，**不含连字符**） |
| `path` | 树定位：根为空，子=A/B/C，孙=A1/A2，曾孙=A1a | `[A-Z]\d*(?:[a-z]\d*)*` |
| `role` | 角色短名（可含连字符） | `\w+` |
| `suffix` | 可选。竹节=sNN / 尝试=iNN | `s\d+\|i\d+` |

### 完整正则

```
^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$
```

### 正例

| 命名 | 解读 |
|------|------|
| `nanju-root` | nanju 项目根会话 |
| `nanju-A-eval` | 第 1 子 A = 实验评测模块 |
| `nanju-A-eval-s2` | A 的竹节第 2 节 |
| `nanju-A1-engine` | A 的第 1 孙 = 评测引擎 |
| `sweng-B-pedagogy` | sweng 项目 B = 教学法模块 |
| `webv3-C-api` | webv3 项目 C = API 设计 |
| `pguide-root` | pguide 项目根会话 |
| `nanju-A1b-engine` | A1 的第 2 次尝试（i2=i, path 中 b 表示第 2 个曾孙） |

### 负例

| 命名 | 原因 |
|------|------|
| `proma-guide-root` | prefix 含连字符 `-` |
| `NA-root` | prefix 大写 + 不足 4 字符 |
| `nju-root` | prefix 仅 3 字符 |
| `NANJU-root` | prefix 含大写字母 |
| `123abc-root` | prefix 首字符非小写字母 |
| `toolkithelper-root` | prefix 13 字符，超过 8 字符上限 |

### 配套规则

1. `prefix` 由根会话首次 `init` 时生成，**永不变更**
2. Fork 时强制继承 prefix（leaf add 校验）
3. `role` 必填
4. 重档剪枝时旧会话 archive 不删，新会话加 `i2/i3` 后缀

---

## §14 审计工作流（v2.1 新增）

> 依据：tree-audit-methodology.md v1.0。当任务涉及文档审计/终局验证/可信度审查时，**必须**按本节执行。

### §14.1 何时触发

满足任一条件即进入审计模式：
- 任务 brief 中含 "审计/审查/验证/验收/终局/converge/audit/verify/review" 等关键词
- 需要对一份已完成文档进行可信度评估
- 子会话 done 上报后进入 §4 Step 4 质量门

### §14.2 最小审计树结构（强制执行）

```
{tree_id} (指挥官)
  ├── {tree_id}-fix        — 修正执行员（等审查完成后统一修改）
  ├── {tree_id}-C1         — 一致性审查员
  ├── {tree_id}-C2         — 完整性/闭环审查员
  ├── {tree_id}-C3         — 规范性/格式审查员
  ├── {tree_id}-C4         — 可验证性/证据审查员
  ├── {tree_id}-A1         — 反向映射重构员
  └── {tree_id}-A2         — 反事实攻击员
```

**铁腕要求**：
- **最少 7 个审查 leaf**（4 四维 + 2 攻击 + 1 修正），缺一个都不算完成
- C1-C4 和 A1-A2 必须并行启动（相互独立）
- 修正员（fix）在所有审查员返回后启动
- 禁止指挥官亲自充当审查员（"自己画靶自己打分"）

### §14.3 审计 5 件套模板

下发审查子会话时，在标准 §3 模板基础上，`brief.in_scope` 必须包含**该维度的具体审查问题**。以下为 6 个角色的 in_scope 模板：

**C1 一致性审查员**：
```yaml
in_scope:
  - "逐项比对报告与上游文档的数字/版本/环境声明是否一致"
  - "用例计数可复算（逐行求和的每一步写出来）"
  - "报告声称的修复项与实际问题列表逐条对照"
  - "时间窗口声称与 session 时间戳是否吻合"
```

**C2 完整性/闭环审查员**：
```yaml
in_scope:
  - "11 个工具是否全部测试（逐一核对，不跳）"
  - "每个工具的错误用例是否覆盖（方案要求 ≥1）"
  - "集成场景是否全部执行（逐场景检查步骤完整性）"
  - "跳过的用例是否有充分理由和替代探索记录"
  - "性能数据是否完整（总耗时、最慢工具精确值）"
```

**C3 规范性审查员**：
```yaml
in_scope:
  - "报告格式是否符合方案模板要求"
  - "严重程度评级是否合理（有无降级/升级）"
  - "结论是否基于证据（非主观判断）"
  - "统计表述是否有误导（'零失败' vs '2跳过'）"
  - "'READY FOR RELEASE' 声明是否满足前置条件"
```

**C4 可验证性审查员**：
```yaml
in_scope:
  - "每个关键声称是否有可验证证据（session ID/时间戳/原始返回值）"
  - "性能数据是否有测量方法说明"
  - "第三方能否根据报告复现测试"
  - "session ID 引用是否完整（禁止短格式）"
  - "报告是否在 git 中固化（非未提交修改）"
```

**A1 反向映射重构员**：
```yaml
in_scope:
  - "忽略报告原有分组，从每条声称反向提取功能验证点"
  - "汇总为功能清单，与上游方案逐项比对"
  - "标记三类差异：遗漏（方案有报告无）/ 冗余（报告有方案无）/ 偏离（都有但不一致）"
  - "特别注意：方案和报告中的编号体系是否对应"
```

**A2 反事实攻击员**：
```yaml
in_scope:
  - "覆盖边界攻击：单频道/单模型的测试能否支撑全频道通用结论？"
  - "结论逻辑攻击：跳过=未覆盖≠通过，统计数据是否误导？"
  - "时间线攻击：声称的时间窗口与实际 session 时间戳是否吻合？报告是否经历多版本迭代但未声明？"
  - "并发场景攻击：核心使用模式是否被跳过？"
  - "至少 5 个具体攻击场景，每个标注：报告能否兜住/失守/部分失守"
```

### §14.4 迭代收敛流程

```
Round 1:
  ① Fork C1-C4 + A1-A2（6 个并行）
  ② 收集所有问题列表，去重汇总
  ③ Fix 子会话执行修正
  ④ tree-state 记录 round=1, issues_found=N1

Round 2:
  ⑤ 重新 Fork C1-C4 + A1-A2（6 个并行，只检查修正是否正确、是否引入新问题）
  ⑥ 收集回归问题列表
  ⑦ 判定收敛（三个条件全部满足）：
     a. N2 < N1 × 0.3
     b. 无阻断级或严重级新问题
     c. 所有遗留问题均为"建议"级或"待人类确认"
  ⑧ 不满足 → Fix 再修正 → Round 3
  ⑨ 满足 → tree-state 记录 converged=true, convergence_round=N

严禁行为:
  - 一轮就 declare done
  - 审查员和攻击员复用同一子会话
  - 回归阶段跳过任何维度
  - 未 commit 就声明"READY FOR RELEASE"
```

### §14.5 tree-state 审计记录

每轮迭代在 `_meta` 中追加：

```json
{
  "audit_rounds": [
    {
      "round": 1,
      "issues_found": {"blocker": N, "severe": N, "suggestion": N},
      "issues_fixed": {"blocker": N, "severe": N, "suggestion": N},
      "regression_issues": 0
    }
  ],
  "converged": true,
  "convergence_round": 2
}
```

### §14.6 完成检查表

declare done 前逐项确认：

```
[ ] leaves ≥ 7（1 root + 4 审查 + 2 攻击 + 可选 fix/走查）
[ ] 阶段一：4 个审查子会话全部 done，产出结构化问题列表
[ ] 阶段二：2 个攻击子会话全部 done，产出漏洞列表
[ ] ≥ 2 轮迭代，audit_rounds 记录完整
[ ] 收敛三条件全部满足
[ ] tree-state validate() = {ok: true, issues: []}
[ ] 修正后 git commit 完成
[ ] 最终报告头部标注审计轮次和审查子会话 ID 列表
```

---

## §15 修订历史

| 日期 | 版本 | 主要变更 |
|------|------|---------|
| 2026-06-19 | v2.2 | 审计驱动修订：requires 中 commander-methodology.md 版本引用从 v1.0 更新为 v1.2 |
| 2026-06-19 | v2.1 | 新增 §14 审计工作流（铁律 5、最小 7 leaf 结构、审计 5 件套模板、迭代收敛流程、完成检查表）；§0 引用 tree-audit-methodology.md；铁律从 4 条扩展到 5 条 |
| 2026-06-18 | v2.0 | 首次创建。合并 v0.1 契约/事件/剪枝 + v0.2 心跳/内审/三档纠偏/哨兵 Agent/验收 Agent。所有 tree-state.js 子命令引用来自附录 A 实现。 |
