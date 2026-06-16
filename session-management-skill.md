---
name: session-management
description: Agent 会话管理能力。当用户需要创建/查询/Fork会话、给其他会话发消息、监控token用量、归档会话、跨工作区操作、并行调度多个Agent协作时触发。触发信号：多会话、开小弟、Fork、分身、并行、批量、派任务、监控进度、上下文甜点、竹节交接、工作区切换、归档、清理会话。
group: proma
version: "1.1.0"
---

# Agent 会话管理 (v1.1.0)

你拥有 **11 个会话管理 MCP 工具**（`session` MCP server），可以管理 Proma 中的 Agent 会话——创建、Fork、发消息、查用量、查消息历史、归档等。你不是被困在自己的会话里；你可以像"老板"一样调度多个"小弟"协作完成复杂任务。

这些工具同时暴露为**外部 stdio MCP server**，让 Claude Code 等外部工具也能调用。

## 工具速览

| 工具 | 用途 | 只读 |
|---|---|---|
| `get_my_session_id` | 获取你自己的会话 ID | ✅ |
| `list_channels` | 列出所有 AI 渠道及可用模型 | ✅ |
| `list_workspaces` | 列出所有工作区 | ✅ |
| `list_sessions` | 列出会话（支持按工作区过滤、含工作区名） | ✅ |
| `get_session_info` | 查询任意会话详情（渠道/模型/工作区） | ✅ |
| `get_session_context` | 查询会话 token 用量/上下文窗口/使用率 | ✅ |
| `list_messages` | 列出消息历史（含 UUID，用于 Fork） | ✅ |
| `create_session` | 创建新会话（指定渠道/模型/工作区） | ❌ |
| `fork_session` | Fork 会话（支持精确 UUID 截断，跨渠道 Fork） | ❌ |
| `send_message` | 向目标会话发消息（wait=true 返回 Agent 输出） | ❌ |
| `archive_session` | 归档/取消归档会话（归档后默认隐藏） | ❌ |

## 核心使用模式

### 模式 1：开小弟并行干活

```
1. list_channels → 看有哪些模型可用
2. create_session × N → 开 N 个"小弟"会话（用便宜模型省钱）
3. send_message(wait=false) × N → 同时给所有小弟派任务
4. 轮询 get_session_context → 监控每个小弟的 token 是否稳定（完成了）
5. list_messages → 取每个小弟的最后回复
6. fork_session → 开"整合会话"汇总所有产出
```

**省钱技巧：**
- 复杂分析/架构 → Claude Opus / DeepSeek V4 Pro
- 简单实现/CRUD → DeepSeek V4 Flash
- 最便宜 → GLM-4.5-Air

### 模式 2：深度探索 — 从任意轮 Fork

```
1. list_messages(session_id) → 查看消息历史，每条都有 UUID
2. 找到想回退的那轮 assistant 消息的 UUID
3. fork_session(source_session_id, up_to_message_uuid=那个UUID)
   → 新会话从截断点继承上下文，前几轮对话完整保留
4. send_message(新会话, "换一种方式实现...")
```

**注意：** headless 会话的 user 消息可能没有 UUID，fork 时用 assistant 或 result 消息的 UUID。

### 模式 3：竹节交接 — 上下文甜点区护航

```
1. get_session_context(自己) → 看 usage_pct
2. 如果接近模型甜点区上限（如 DeepSeek V4 Pro 60%+）：
   a. 先总结当前进度 → send_message(自己, "总结进度和关键发现")
   b. fork_session(自己) → 新会话
   c. send_message(新会话, 简报 + "继续任务")
   d. 旧会话保留为检查点，新会话继续
```

### 模式 4：跨工作区协作

```
1. list_workspaces → 看到所有工作区
2. list_sessions(workspace_id="xxx") → 只看某个工作区的会话
3. create_session(workspace_id="xxx") → 在指定工作区创建会话
   新会话自动获得该工作区的文件访问权限
```

### 模式 5：会话归档与清理

```
1. archive_session(session_id) → 归档已完成/不需要的会话
2. archive_session(session_id, archived=false) → 取消归档
3. list_sessions(include_archived=true) → 查看含归档的完整列表
```

归档的会话默认不在 `list_sessions` 中显示，但数据不丢失、可随时恢复。适合清理测试会话、整理历史记录。

### 模式 6：外部轮询回收（外部 MCP 调用者用）

外部调用者（如 Claude Code）不支持 `notify=true`，用 fire-and-forget + 轮询实现并行调度：

```
1. send_message(wait=false) × N → 立即返回 "started"
2. 定时轮询 get_session_context(target)
   → token 连续两次不变且非零 → 任务完成
3. list_messages(target, limit=1) → 取最后一条 assistant 文本
```

## 消息历史与 UUID

`list_messages` 返回每条消息的：
- `index` — 序号
- `type` — user / assistant / result
- `uuid` — SDK 消息唯一标识（**用于 fork_session 的 up_to_message_uuid**）
- `role` — user / assistant
- `text` — 文本内容（截取前 500 字）
- `text_full_length` — 完整文本长度
- `timestamp` — 时间戳
- `usage` — token 用量（仅 result 类型）
- `error_code` / `error_title` — 错误信息（如有）

## send_message 三模式

| 参数 | 行为 | 适用场景 |
|---|---|---|
| `wait=true` (默认) | 阻塞等小弟完成，返回 `reply` 字段含 Agent 输出 | 短任务，需要即时结果 |
| `wait=false, notify=true` | 立即返回，完成后通知源会话 | **仅内部 Agent 可用**，异步协作 |
| `wait=false` | 纯 fire-and-forget | 不关心结果，或配合轮询回收 |

**`notify=true` 仅内部 Agent 可用**（外部 MCP 调用返回明确错误）。

## 外部 MCP 服务

工具同时暴露为独立 stdio MCP server（`proma-mcp-server.cjs`），外部工具可调用。

**启动参数：**
```bash
node proma-mcp-server.cjs          # 默认 --dev
node proma-mcp-server.cjs --dev     # 连接 Dev 实例
node proma-mcp-server.cjs --release # 连接 Release 实例
```

**自动发现：** 启动时扫描端口 19876-19895，通过 `GET /get_instance_info` 识别 Dev（`proma_dev=true`）和 Release（`proma_dev=false`）实例。

**Claude Code 配置（`.claude/mcp.json`）：**
```json
{
  "mcpServers": {
    "proma-dev-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"]
    }
  }
}
```

## 模型甜点区参考

| 模型 | 甜点区 | 建议交接线 |
|---|---|---|
| DeepSeek V4 Pro | 150K-250K | 200K (20%) |
| DeepSeek V4 Flash | 80K-150K | 120K |
| Claude Sonnet 4.6 | 100K-200K | 150K |
| GLM-5-Turbo | 50K-80K | 60K |

## 注意事项

- `get_my_session_id` 首先调用，获取自己的会话 ID
- 创建/fork 的会话在 Proma 侧边栏需手动刷新才能看到
- headless 会话（send_message 启动的）的 usage 数据可能不完整，正常现象
- 跨渠道 Fork（如 DeepSeek→GLM）一般可用，个别情况可能因 SDK session GC 失败
- 跨渠道 UI 切换模型已通过补丁 F 修复，不再触发 "Session 已失效"
- `send_message` 外部调用不支持 `notify=true`，可用模式 6（轮询回收）替代
- 省钱优先：能用 deepseek-v4-flash 就别用 deepseek-v4-pro
