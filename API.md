# Proma 改造项目 — MCP 工具 API 参考

> 维护: 周星星 + Proma Agent | 版本: V10 Phase 3 + IHL R6（2026-06-26）
> 配套文档: [ARCHITECTURE.md](./ARCHITECTURE.md) · [SECURITY.md](./SECURITY.md)
> 数据源: `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs` (2658 行) · `tree-engine.cjs` (3602 行)

---

## 一、工具总览

Proma 改造项目暴露 **53 个 MCP 工具**，分三类：

| 类别 | 前缀 | 数量 | 入口 |
|---|---|---|---|
| 本地 session | `mcp__session__*` | 12 | 进程内 `global.__proma__` |
| 远端 remote-session | `mcp__remote-session__*` | 12 | HTTP bridge 19876-95 |
| Tree | `mcp__tree__*` | 29 | 进程内 `tree-engine.cjs` |

**命名约定**：所有 MCP 工具在 Claude API 调用中前缀为 `mcp__<server>__<tool>`，本文档省略前缀，只列工具名。

**调用环境**：
- 本地工具在 Proma Agent 内部（同一 Electron 主进程）调用
- 远端工具通过 HTTP bridge 跨实例调用（instance 参数必填）
- Tree 工具在 Proma Agent 内部调用，工作区零源码

---

## 二、本地 session 工具（12 个）

### 2.1 get_my_session_id

获取调用方自己的 session ID。

**参数**：无

**返回**：`{ session_id: string|null, hint: string }`

**错误码**：无（永远成功，可能返回 null）

**示例**：
```javascript
await mcp__session__get_my_session_id({})
// → { session_id: "ce9a1e2f-...", hint: "Use it with get_session_context..." }
```

### 2.2 list_channels

列出所有 AI 频道和模型。

**参数**：无

**返回**：`{ channels: [{ id, name, provider, models: [{id, name}] }] }`

### 2.3 list_workspaces

列出所有工作区。

**参数**：无

**返回**：`{ workspaces: [{ id, name, slug }] }`

### 2.4 list_sessions

列出 agent 会话。

**参数**：

| 名 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `workspace_id` | string | 否 | null | 过滤工作区 |
| `include_archived` | boolean | 否 | false | 是否含归档会话 |
| `limit` | number | 否 | 50 | 最大返回数 |

**返回**：`{ sessions: [{ session_id, title, channel_id, model_id, workspace_id, archived }] }`

### 2.5 get_session_info

获取会话详情。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | string | 是 | 目标 session ID |

**错误码**：无（找不到返回 `{ error: "Session not found" }`）

### 2.6 get_session_context

获取会话上下文 token 用量。

**参数**：`session_id`（必填）

**返回**：`{ session_id, input_tokens, output_tokens, total_tokens, context_window_size }`

### 2.7 list_messages

列出会话消息历史。

**参数**：

| 名 | 类型 | 必填 | 默认 |
|---|---|---|---|
| `session_id` | string | 是 | - |
| `limit` | number | 否 | 50 |
| `offset` | number | 否 | 0 |

**返回**：`{ messages: [{ uuid, role, content, ts }] }`

### 2.8 create_session

创建新 agent 会话。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `channel_id` | string | 是 | 频道 ID |
| `model_id` | string | 否 | 模型 ID（缺省取频道默认）|
| `title` | string | 否 | 显示标题（自动生成）|
| `workspace_id` | string | 否 | 工作区 ID |

**R2 校验**（IHL R2 新增）：`workspace_id` 必须存在于 `list_workspaces`。GLM-5.2 v1 落 "undefined" slug 漏洞已修。

**错误码**：
- `E_WORKSPACE_NOT_FOUND` — workspace_id 不在白名单

**返回**：`{ session_id, title, channel_id, model_id }`

### 2.9 fork_session

Fork 现有会话。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `source_session_id` | string | 是 | 源会话 |
| `up_to_message_uuid` | string | 否 | Fork 截止消息（默认全部）|
| `title` | string | 否 | 自定义标题（默认追加 "(fork)"）|
| `new_channel_id` | string | 否 | 覆盖频道 |
| `new_model_id` | string | 否 | 覆盖模型 |
| `new_workspace_id` | string | 否 | 覆盖工作区 |

**R4 校验**（IHL R4 新增）：`new_workspace_id` 走与 R2 相同的 `validateWorkspaceId` helper。

**错误码**：
- `E_WORKSPACE_NOT_FOUND`
- `Session not found` — 源会话不存在

### 2.10 send_message

给目标会话发消息。三种模式：

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | string | 是 | 目标会话 |
| `message` | string | 是 | 用户消息内容 |
| `wait` | boolean | 否 | true=同步（默认）|
| `notify` | boolean | 否 | true=异步通知回调 |
| `model_id` | string | 否 | 模型覆盖 |
| `channel_id` | string | 否 | 频道覆盖 |

**模式组合**：

| wait | notify | 行为 |
|---|---|---|
| true | - | 同步阻塞，返回 `{ reply }` |
| false | true | 异步通知，完成后推消息回调用会话 |
| false | false | 立即返回，调用方主动 list_messages 轮询 |

**返回（wait=true）**：`{ session_id, reply, ok }`

### 2.11 archive_session

归档会话（隐藏，不删除）。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | string | 是 | 目标会话 |
| `archived` | boolean | 否 | true=归档（默认），false=取消归档 |

### 2.12 discover_instances

扫描本地与局域网内的 Proma 实例。

**参数**：

| 名 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `refresh` | boolean | 否 | false | 强制重扫（默认 60s 缓存）|
| `hosts` | string[] | 否 | [] | 探测的 LAN IP 列表 |

**返回**：`{ instances: [{ name, port, version, isolated }] }`

---

## 三、远端 remote-session 工具（12 个）

与本地 session 一一对应，**多一个 `instance` 参数**（必填），其他 schema 完全相同。HTTP bridge 自动扫描 19876-19895 端口发现目标实例。

### 3.1 工具列表

```
remote_get_my_session_id
remote_list_channels
remote_list_workspaces
remote_list_sessions
remote_get_session_info
remote_get_session_context
remote_list_messages
remote_create_session
remote_fork_session
remote_send_message
remote_archive_session
remote_discover_instances
```

### 3.2 instance 参数

所有 remote_* 工具第一个参数都是 `instance: string`，取值：

- `dev` — `127.0.0.1:19877`（D:/Proma-dev/start-dev.bat）
- `release` — `127.0.0.1:19876`（D:/Proma-dev/start-release.bat）
- `pro` / `release-fresh` — 启动后绑定端口
- LAN 主机名 — 远端实例（hosts 扫描发现）

### 3.3 示例

```javascript
await mcp__remote-session__remote_list_sessions({
  instance: "dev",
  workspace_id: null,
  include_archived: false,
  limit: 20
})
```

---

## 四、Tree 工具（29 个）

### 4.0 元工具

#### tree_help

V10 Helper D4 Layer 1 元工具。**任何 mcp__tree__* 调用前如果不确定用法，先 tree_help 拿 topic**。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `topic` | string | 是 | 13 个 topic 之一 |

**13 个 topic**：
```
how_to_init | how_to_register_auditor | role_semantics |
v10_constraints | self_audit_forbidden | borrowed_identity |
naming_convention | common_mistakes | alignment_workflow |
nudge_escalation | audit_tree_structure | error_code_index | full_guide
```

**返回**：`{ topic, content }`

> 错误返回也会自动附 `help_topic` 引用（`run()` catch 块根据 `ERROR_TO_HELP` 映射表生成 `help_hint`）。

### 4.1 Maintain（维护类）

#### tree_init

初始化新树，创建 tree dir + root leaf。返回 `tips.next_steps` 引导注册 auditor 和避免常见错误。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | 树 ID（唯一）|
| `root_brief` | object | 是 | 根任务简报 JSON |
| `root_dod` | object | 是 | Definition of Done（含 max_depth, node_budget）|
| `session_id` | string | 否 | root 的 session ID（缺省占位 PENDING_ROOT）|
| `model` | string | 否 | root 模型 ID |
| `channel` | string | 否 | root 频道 ID |
| `audit_meta` | object | 否 | 审计元数据 |

**错误码**：
- `E_DUPLICATE_LEAF` — 树已存在

**返回**：`{ ok, tree_id, root_leaf_id, tips: { next_steps, skill_reference, pro_tip } }`

#### tree_validate

运行所有树不变式校验（父链 / session_id 唯一 / path / done-worker 独立 audit_gate / 上下文溢出）。**只读**。

**参数**：`tree_id`（必填）

**返回**：`{ ok: boolean, issues: [string] }`

#### tree_backup

创建 tree-state.json 时间戳备份。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `label` | string | 否 | 备份标签 |

#### tree_restore

从备份恢复 tree-state.json。v0.7 V1 拒绝不合规备份。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `backup_file` | string | 是 | tree dir 内 basename 或绝对路径 |

**错误码**：
- `E_BACKUP_CORRUPT` — 备份文件 schema 不合规（V1 修复，堵 restore 旁路）

#### tree_migrate

运行 schema 迁移。

**参数**：

| 名 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tree_id` | string | 是 | - | - |
| `dry_run` | boolean | 否 | false | 仅打印不写 |

### 4.2 Add（新增类）

#### tree_leaf_add

添加 leaf 节点。worker 不能有子节点；commander 嵌套深度 ≤ 3 强制。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf` | object | 是 | 完整 leaf JSON：`{leaf_id, session_id, parent, path, role, model, channel, added_by}` |

**约束**：
- `role` 必须在 `['root', 'commander', 'worker']`（否则 `E_ROLE_INVALID`）
- `role === 'root'` 拒绝（root 必须由 `tree_init` 创建）
- `depth > max_depth` → `E_DEPTH_EXCEEDED`
- 父节点 status 不能是 `active`（`E_PARENT_MISSING`）
- session_id 在树中唯一（Bug B 修复，否则 `E_DUPLICATE_SESSION_ID`）

#### tree_milestone_add

添加里程碑。`expect_outputs` 必须非空（V3 修复）。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `milestone` | object | 是 | `{id, expect_outputs: [...], ...}` |

**错误码**：
- `E_SCHEMA_INVALID` — `expect_outputs` 为空数组（V3）

### 4.3 Update（更新类）

#### tree_leaf_set_status

设置 leaf 状态。`done` / `archived` 触发 DbC 硬门禁。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `status` | string | 是 | `active|done|pruned|archived|segment_pending|pending_brief` |

**done 触发的 DbC 校验**：
- A1: `expect_outputs` 文件真实存在（`E_DELIVERABLE_MISSING`）
- A7: 必有 done event 留痕（`E_AUDIT_PREMATURE`）
- V5b: alignment 留痕（`E_ALIGNMENT_NOT_VERIFIED`）
- V6: self_check 不能全 pass:false（`E_SELFCHECK_INVALID`）
- V10-status-event-sync: status 与 last_event 一致

#### tree_leaf_set_context

更新 leaf 上下文使用率。

**参数**：`tree_id`, `leaf_id`, `context_pct: number (0-100+)`

#### tree_leaf_set_last_event

更新 leaf 最近事件类型 / 时间戳。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `event_type` | string | 是 | - |
| `ts` | string | 否 | ISO 时间戳（缺省 now）|

#### tree_leaf_set_session

更新 leaf 的 session_id（如修正 PENDING_ROOT root）。

**参数**：`tree_id`, `leaf_id`, `session_id`

#### tree_leaf_autonomy_override

覆盖 leaf 自主度（added_must_ask 等）。

**参数**：`tree_id`, `leaf_id`, `overrides: object`

#### tree_milestone_set_result

设置里程碑审计结果。V4（v0.7 批次5）：`audit_pass=true` 需独立 `audit_session_id`（真实独立 leaf session）。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `milestone_id` | string | 是 | - |
| `audit_pass` | boolean | 是 | - |
| `audit_session_id` | string | audit_pass=true 时必填 | 独立 auditor session |
| `note_path` | string | 否 | 审计报告路径 |

**错误码**：
- `E_AUDITOR_NOT_INDEPENDENT` — auditor === leaf 自己 / 父 / 根
- `E_AUDITOR_NOT_DONE` — V10-auditor-active: auditor 状态非 done
- `E_AUDITOR_NO_EVENTS` — V10-auditor-active: auditor events 空
- `E_AUDITOR_NOT_VERIFIED` — V10-auditor-active: auditor 自己 audit_gate 非 pass
- `E_BORROWED_IDENTITY` — V10-self-audit-forbidden-v2: caller ≠ audit_session_id

### 4.4 Append（追加类）

#### tree_event_append

追加事件。`done` 需 self_check schema；`brief_echo+alignment` 需独立 auditor。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `type` | string | 是 | `done|blocked|plan|brief_echo|heartbeat_reply|nudge|limit|status_check` |
| `meta` | object | 是 | 事件元数据 |

**Bug A-1 修复**（IHL V10 P3）：caller 校验 — 非 `leaf.session_id` 自己不能写 done event（堵 commander 代 worker 写）。

**done 事件 self_check schema**：`{ name, pass: boolean, evidence: string }[]`（V6 严格校验，不能全 pass:false）。

**错误码**：
- `E_BORROWED_IDENTITY` — caller 写别人的 done event
- `E_SELFCHECK_INVALID` — self_check 不合规
- `E_TS_BEFORE_CREATED` / `E_TS_IN_FUTURE` / `E_TS_NOT_MONOTONIC` — V10-timestamp-monotonic

#### tree_drift_append

追加 drift（3 层纠正）。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `kind` | string | 是 | drift 类型 |
| `severity` | string | 是 | `low|medium|high` |
| `action` | string | 是 | 修复动作 |
| `fork_to` | string | 否 | fork 目标 |
| `reason` | string | 否 | 原因 |

#### tree_heartbeat_append

追加心跳（sentinel agent 巡逻）。

**参数**：`tree_id`, `heartbeat: object`

#### tree_segment_append

追加 segment（竹节交接）。

**参数**：`tree_id`, `leaf_id`, `new_session_id`

#### tree_nudge_append

追加 nudge（TAO Watcher 用）。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `rule_id` | string | 是 | 规则 ID（如 `W-01`, `R-04`, `W-AUDIT-SELF`）|
| `severity` | string | 否 | `low|medium|high` |

#### tree_nudge_reset

重置 leaf nudge_count + nudge_log。

**参数**：`tree_id`, `leaf_id`

### 4.5 TAO（审计类）

#### tree_audit_gate

设置 audit_gate verdict。`pass` / `required` 需独立 auditor session（白名单 V2）；`pass` 需先有 done event（A7）。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `verdict` | string | 是 | `pass|required|skip` |
| `audit_session_id` | string | pass/required 时必填 | 独立 auditor session |
| `reason` | string | 否 | - |

**Bug A-2 修复**（IHL V10 P3）：`caller === audit_session_id` 校验（堵 auditor #2 发现的 hasDone 漏洞）。

**C5 修复**：root 自审必须显式传 `audit_session_id === leaf.session_id`，**不允许 null**。

**错误码**：
- `E_AUDITOR_NOT_INDEPENDENT` — auditor 不在白名单（resolveAuditorIndep L1897）
- `E_AUDIT_PREMATURE` — 还没 done event 就 pass
- `E_BORROWED_IDENTITY` — caller ≠ audit_session_id
- `E_INVALID_UUID_STRICT` — auditor_session_id 是全 0 / 全 f / 非 v4
- `E_AUDITOR_NOT_DONE` / `E_AUDITOR_NO_EVENTS` / `E_AUDITOR_NOT_VERIFIED` — V10-auditor-active

#### tree_audit_append

追加审计报告条目。R2-T7 + M2：`results[i]` 必须是 `{item, pass, evidence}` 三元组；`total/passed/failed` 必须是整数。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 是 | - |
| `report` | object | 是 | `{ auditor, ts, total, passed, failed, results: [{item, pass, evidence}] }` |

**错误码**：
- `E_SCHEMA_INVALID` — results 非数组 / 元素非对象 / 字段类型错（R2-T7）
- `E_NEGATIVE_COUNT` — total/passed/failed < 0
- `E_COUNT_MISMATCH` — passed + failed ≠ total
- `E_LENGTH_MISMATCH` — results.length ≠ total
- `E_INVALID_UUID_STRICT` — auditor 字段伪造

### 4.6 Query（查询类，全部只读）

#### tree_leaf_get

按 ID 获取 leaf。**只读**。

**参数**：`tree_id`, `leaf_id`

#### tree_leaf_list_active

列出活跃（非归档）leaf。**只读**。

**参数**：`tree_id`

#### tree_leaf_list_all

列出所有 leaf（含归档）。**只读**。

**参数**：`tree_id`

#### tree_tree_dump

Dump 完整树状态 JSON。**只读**。

**参数**：`tree_id`

#### tree_drift_list

列出 drift 条目。**只读**。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 否 | 过滤指定 leaf |
| `since` | string | 否 | ISO 时间戳 |

#### tree_heartbeat_tail

Tail 心跳日志。**只读**。

**参数**：

| 名 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `tree_id` | string | 是 | - | - |
| `leaf_id` | string | 否 | null | 过滤指定 leaf |
| `n` | number | 否 | - | 返回条数 |

#### tree_event_list

列出事件。**只读**。

**参数**：

| 名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tree_id` | string | 是 | - |
| `leaf_id` | string | 否 | 过滤 |
| `type` | string | 否 | 按事件类型过滤 |

---

## 五、错误码字典

### 5.1 基础错误（tree-engine.cjs L76-100）

| 错误码 | 含义 | 触发场景 |
|---|---|---|
| `E_LOCK_TIMEOUT` | 文件锁超时 | 并发写冲突 |
| `E_TREE_NOT_FOUND` | 树不存在 | tree_id 找不到 |
| `E_LEAF_NOT_FOUND` | leaf 不存在 | leaf_id 找不到 |
| `E_SCHEMA_INVALID` | Schema 不合规 | 字段缺失 / 类型错 / R2-T7 results[i] |
| `E_STATUS_INVALID` | 状态枚举错 | status 不在 STATUS_ENUM |
| `E_NAME_INVALID` | 命名不合规 | leaf_id 不匹配 `LEAF_NAME_RE` |
| `E_PARENT_MISSING` | 父节点缺失 | parent 指向不存在 leaf |
| `E_DUPLICATE_LEAF` | leaf ID 重复 | leaf_id 已存在 |
| `E_DUPLICATE_SESSION_ID` | session_id 重复 | Bug B 修复（IHL V10 P3）|
| `E_CHILDREN_NOT_DONE` | 子节点未完成 | 不能在子节点未 done 时父 done |
| `E_DEPTH_EXCEEDED` | 深度超限 | depth > max_depth（默认 3）|
| `E_BACKUP_CORRUPT` | 备份损坏 | V1 restore 校验失败 |
| `E_IO` | IO 错误 | 磁盘读写失败 |
| `E_UNKNOWN` | 未知错误 | 兜底 |
| `E_GATEKEEPER_REQUIRED` | 需守卫 | 内部错误 |

### 5.2 DbC 错误（CP1-CP6 + V4-V9）

| 错误码 | 含义 | 触发 |
|---|---|---|
| `E_DELIVERABLE_MISSING` | 交付物缺失 | A1: expect_outputs 文件不存在 |
| `E_AUDITOR_NOT_INDEPENDENT` | auditor 不独立 | CP5: auditor === leaf / 父 / 根 |
| `E_AUDIT_PREMATURE` | 审计过早 | A7: 还没 done 就 pass |
| `E_ALIGNMENT_NOT_VERIFIED` | 对齐未验证 | V5b: events 无 brief_echo with alignment |
| `E_SELFCHECK_INVALID` | 自检不合规 | V6: 全 pass:false / schema 错 |
| `E_TREE_NODE_BUDGET_EXCEEDED` | 节点预算超限 | CP2: node_count > budget |
| `E_TREE_NOT_VALIDATED` | 树未通过 validate | 整树结构不合规 |
| `E_ROLE_INVALID` | role 非法 | 不在 ROLE_ENUM |
| `E_DEPTH_EXCEEDED` | 深度超限 | 重复出现，CP3 |
| `E_PATH_TRAVERSAL` | 路径遍历 | V9: 绝对路径 / `..` |
| `E_SYMLINK_ESCAPE` | symlink 逃逸 | V9: symlink 指向工作区外 |

### 5.3 V10 八大加固错误（V10 Phase 1-2）

| 错误码 | 含义 | 触发 |
|---|---|---|
| `E_AUDITOR_NOT_DONE` | V10-auditor-active | auditor leaf status ≠ done |
| `E_AUDITOR_NO_EVENTS` | V10-auditor-active | auditor leaf events 空 |
| `E_AUDITOR_NOT_VERIFIED` | V10-auditor-active | auditor 自己 audit_gate.verdict ≠ pass |
| `E_BORROWED_IDENTITY` | V10-self-audit-forbidden-v2 | caller ≠ audit_session_id |
| `E_INVALID_UUID_STRICT` | V10-uuid-format-strict | 全 0 / 全 f / 非 v4 UUID |
| `E_NEGATIVE_COUNT` | V10-numeric-consistency | total/passed/failed < 0 |
| `E_COUNT_MISMATCH` | V10-numeric-consistency | passed + failed ≠ total |
| `E_LENGTH_MISMATCH` | V10-numeric-consistency | results.length ≠ total |
| `E_TS_BEFORE_CREATED` | V10-timestamp-monotonic | ts 早于 created_at |
| `E_TS_IN_FUTURE` | V10-timestamp-monotonic | ts 晚于 now+60s |
| `E_TS_NOT_MONOTONIC` | V10-timestamp-monotonic | ts 早于上一条 event |
| `E_LEAF_AUTO_PRUNED` | V10-nudge-escalation | nudge_count ≥ 7 强制 pruned |
| `E_STATUS_EVENT_MISMATCH` | V10-status-event-sync | status 与 last_event_type 不同步 |
| `E_WORKSPACE_CANONICAL` | V10-workspace-canonical | slug "undefined" / null / "" 未 fallback |

### 5.4 IHL R2/R4 错误（patches.cjs）

| 错误码 | 含义 |
|---|---|
| `E_WORKSPACE_NOT_FOUND` | workspace_id 不在白名单（create_session / fork_session）|
| `E_NO_TREES_DIR` | workspace 缺 `.context/trees/` 目录 |

### 5.5 ERROR_TO_HELP 映射（D4 Layer 3）

V10 Helper D4 设计：37 个错误码自动映射到 13 个 help_topic。错误返回附 `help_hint: "Use mcp__tree__tree_help('xxx')"`，引导 Agent 反向学习。

完整映射见 [tree-engine.cjs `ERROR_TO_HELP` 常量]。

---

## 六、调用示例

### 6.1 完整建树流程

```javascript
// 1. 建树
await mcp__tree__tree_init({
  tree_id: "demo-2026",
  root_brief: { goal: "Demo tree", boundary: [...] },
  root_dod: { max_depth: 3, node_budget: 10, deliverables_check: [...] },
  session_id: "ce9a1e2f-...",  // 当前 root session
  model: "glm-5.2", channel: "proma-official"
})
// → { ok: true, tips: { next_steps: [...] } }

// 2. Fork commander
const cmd = await mcp__session__fork_session({
  source_session_id: "ce9a1e2f-...",
  title: "demo-commander-A"
})

// 3. Add commander leaf
await mcp__tree__tree_leaf_add({
  tree_id: "demo-2026",
  leaf: {
    leaf_id: "demo-A-commander",
    session_id: cmd.session_id,
    parent: "demo-root",
    path: "demo-root/demo-A-commander",
    role: "commander",
    added_by: "ce9a1e2f-..."
  }
})

// 4. Worker session + leaf（commander 内部）
// 5. Worker 写 done event
await mcp__tree__tree_event_append({
  tree_id: "demo-2026",
  leaf_id: "demo-A-worker-1",
  type: "done",
  meta: { self_check: [{ name: "test", pass: true, evidence: "..." }] }
})

// 6. Auditor (independent) 设 audit_gate pass
await mcp__tree__tree_audit_gate({
  tree_id: "demo-2026",
  leaf_id: "demo-A-worker-1",
  verdict: "pass",
  audit_session_id: "<auditor-session-id>"  // 必须独立
})
```

### 6.2 错误学习示例

```javascript
// Agent 调用错误
await mcp__tree__tree_audit_gate({
  tree_id: "demo-2026", leaf_id: "demo-A-worker-1",
  verdict: "pass",
  audit_session_id: "00000000-0000-0000-0000-000000000000"  // 全 0
})
// → { ok: false, error: {
//     code: "E_INVALID_UUID_STRICT",
//     msg: "auditor_session_id is invalid UUID",
//     help_topic: "v10_constraints",
//     help_hint: "Use mcp__tree__tree_help('v10_constraints') to see valid UUID format."
//   } }

// Agent 反向学习
await mcp__tree__tree_help({ topic: "v10_constraints" })
```

---

## 七、约束速查

### 7.1 ROLE_ENUM
```
['root', 'commander', 'worker']
```

### 7.2 STATUS_ENUM
```
['active', 'done', 'pruned', 'archived', 'pending_brief', 'segment_pending']
```

### 7.3 LEAF_NAME_RE
```
/^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$/
```

注意：path 段 `[A-Z]\d*(?:[a-z]\d*)*` **不允许两个连续大写字母**（如 `RT` 非法，`R` 或 `Ra` 合法）。

### 7.4 EVENT_TYPE_ENUM
```
['done', 'blocked', 'plan', 'brief_echo', 'heartbeat_reply',
 'nudge', 'limit', 'status_check']
```

### 7.5 VERDICT_ENUM
```
['pass', 'required', 'skip']
```

### 7.6 默认配置
- `max_depth`: 3
- `node_budget`: 10
- `nudge_escalation`: 3→medium, 5→high, 7→pruned
- `ts_tolerance`: now+60s（future tolerance）
- `stale_tree_hours`: 24

---

## 八、相关文档

| 文档 | 用途 |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构总览 + 三层防御拓扑 |
| [SECURITY.md](./SECURITY.md) | 威胁模型 + 已修复漏洞 |
| [.context/proma-dev-wiki.md](.context/proma-dev-wiki.md) | 完整技术 Wiki |
| [.context/reference/methodology/commander-methodology-v10.md](.context/reference/methodology/commander-methodology-v10.md) | V10 工程方法论 |
| [D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs](D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs) | 工具定义源码（2658 行）|
| [D:/Proma-dev/resources/app/dist/tree-engine.cjs](D:/Proma-dev/resources/app/dist/tree-engine.cjs) | 引擎源码（3602 行）|

---

## 九、维护约定

- 新增 MCP 工具必须更新本文档 + `tree_help('full_guide')` 索引
- 错误码新增同步到第 5 节 + `ERROR_TO_HELP` 映射
- Schema 变更（新增字段 / 类型变化）必须标注引入版本（如 V10 / IHL R6）
- 保持本文档 < 1200 行，超出时按工具类别拆分子文档
