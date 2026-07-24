# P1-2: send_message 可观测性（tree_log_communication 工具）

> 日期：2026-07-24 | 接力第三棒

## 1. 问题根因

macp 实战（tests/002）：root 通过 `send_message` 驱动 worker（发 brief、nudge、追问、指令），这些**外部 IPC 通信**在 Proma 的 session message 里可见（`list_messages`），但 **tree 体系完全看不到**——tree call-log 只记 `mcp__tree__*` 工具调用，`send_message` 走 session MCP 不入 tree。

**后果**：
- commander 心跳巡检（只看 tree events / call-log）看到 worker `last_event_ts` 长时间不更新 → 误判"worker 冻结"，发出冗余 status_check。
- macp 实战中 root 在"静默期"密集 send_message 驱动 6 个 worker，但 tree call-log 一片空白，事后复盘看不出 root 实际做了什么调度。
- "指令-进度"链条断裂：worker 端有 progress event（P1-1）报进度，但 root 端的指令流动无记录。

**注意**：P1-1（brief_echo 自动转 active + progress event）已缓解"worker 冻结误判"（worker 主动报进度，status 实时 active）。P1-2 补的是**另一侧**：root→worker 的指令流动可见。

## 2. 方案选择

| 方案 | 描述 | 优势 | 劣势 | 决定 |
|------|------|------|------|------|
| **a. tree 工具** | 新增 `tree_log_communication`，root 主动调记录 | 干净可控、不侵入核心 IPC、精确控制 | 依赖 agent 自觉调 | **✅ 选** |
| b. 自动 hook send_message | 在 send_message handler 自动记录 | agent 无感、彻底 | 侵入核心 IPC、需透传 workspaceSlug 到 session handler、性能开销、风险高 | ❌ 留作观察点 |

**选 a 的理由**：send_message 是 Proma 核心 IPC，改它风险高于 P1 优先级值得；方案 a 配合 SKILL 教化 + macp 实战形成"通信即记录"协议（类似"done 即 set-status"协议）。自动 hook 作为后续观察点——若实战再证 agent 普遍漏调，再做 b（届时需把 workspaceSlug 透传到 session handler）。

## 3. 改动点

### 3.1 引擎：tree-engine.cjs

**(a) state 新增 `communication_log: []`**（顶层，类似 drift_log / heartbeat_log）。init 时初始化；旧树用防御性 `if (!Array.isArray(state.communication_log)) state.communication_log = []` 兜底，**不改 migrate**。

**(b) 新命令 `cmdCommunicationLog(args, callerSessionId)`**：
- 参数：`<tree_id> --target <session_id> --direction <in|out> [--note <text>]`
- 行为：
  1. 追加 `{ts, caller_session_id, target_session_id, target_leaf_id, direction, note}` 到 `state.communication_log`。
  2. **自动定位 target leaf**（按 `session_id` 匹配 `state.leaves`），若命中：
     - 记录 `target_leaf_id` 到条目（便于按 leaf 过滤查询）。
     - 更新 `target_leaf.last_event_type = 'communication_<dir>'` + `last_event_ts`（**让心跳巡检感知到通信活动**，不再误判冻结）。
  3. **不截 message 内容**（隐私 + 体积；note 可选，agent 自主决定记什么摘要）。

**(c) 新命令 `cmdCommunicationList(args)`**（只读查询）：按 `--leaf` / `--target` / `--since` 过滤。

**(d) dispatch 加 `communication` case** + `dispatchCommunication`（子命令 log/list）。

### 3.2 patches.cjs：注册 2 个新工具

```js
{ name: "tree_log_communication",
  description: "Log an external communication (send_message etc.) for tree observability. Records caller→target activity WITHOUT capturing message content. Call after send_message to a tree participant so heartbeats see the activity. Auto-updates target leaf last_event.",
  schema: { tree_id, target_session_id, direction: z.enum(['out','in']).optional(), note: z.string().optional() },
  handler: async (a) => call(["communication", "log", a.tree_id, "--target", a.target_session_id, "--direction", a.direction||"out", ...(a.note ? ["--note", a.note] : [])]) },
{ name: "tree_communication_list",
  description: "List communication log entries (external send_message activity). Filter by leaf_id / target / since.",
  schema: { tree_id, leaf_id?, target?, since? }, readOnly: true,
  handler: async (a) => call(["communication", "list", a.tree_id, ...]) },
```

### 3.3 SKILL.md 教化（v2.8 → v2.9）

1. **§5 工具速查**：Append 区加 `tree_log_communication`；Query 区加 `tree_communication_list`。
2. **§4 Step3 事件路由** 或 **§6**：新增"外部通信记录协议"——root 每次 `send_message` 驱动 worker/commander 后，调 `tree_log_communication(tree_id, target_session_id, direction='out', note?)` 记一条。这样心跳巡检能看到 target leaf 的 `last_event_ts` 更新，不误判冻结。
3. **§15 修订历史 v2.9**。

## 4. 测试计划

### 4.1 引擎单测（test-p12.cjs）

**用例 A（log + 自动定位 target leaf）**：
1. init + leaf_add worker（session=wSid）
2. `communication log --target wSid --direction out`（caller=rootSid）
3. **断言**：communication_log 多一条，target_leaf_id=worker leaf_id；worker.last_event_type='communication_out' + last_event_ts 更新

**用例 B（target 不在树内）**：
1. init
2. `communication log --target <随机 UUID> --direction out`
3. **断言**：communication_log 多一条，target_leaf_id=null；不崩

**用例 C（note 可选 + 不截内容）**：
1. 用例 A 基础，带 `--note "发送 brief"`
2. **断言**：entry.note = "发送 brief"；entry 无 message 字段（不截内容）

**用例 D（list 过滤）**：
1. 多个 log 条目（不同 target）
2. `communication list --leaf <worker_leaf_id>`
3. **断言**：只返回该 worker 的通信条目

**用例 E（callerSessionId 记录）**：
1. log 时 caller=rootSid
2. **断言**：entry.caller_session_id = rootSid

### 4.2 回归测试

- P0-1（17/17）+ P1-3（16/16）+ P1-1（12/12）复跑零回归。
- node --check tree-engine.cjs + proma-dev-patches.cjs 通过。

## 5. 验收标准

- [ ] 用例 A-E 全部符合预期
- [ ] dispatch 'communication' case 工作
- [ ] patches.cjs 注册 tree_log_communication + tree_communication_list
- [ ] SKILL §5 / §6 / §15 v2.9 已更新
- [ ] node --check 通过（引擎 + patches.cjs）
- [ ] P0-1/P1-3/P1-1 单测零回归
- [ ] 独立审计 verdict=pass

## 6. 后续观察点（方案 b）

若 macp 类实战再证 agent 普遍漏调 `tree_log_communication`（通信盲区仍存在），考虑方案 b：把 workspaceSlug 透传到 session tool handler，在 send_message handler 成功路径末尾自动调 `communication log`。届时需评估性能（每次 send 查 tree）+ 核心 IPC 改动风险。
