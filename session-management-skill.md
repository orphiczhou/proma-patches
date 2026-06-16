---
name: session-management
description: Agent 会话管理能力。当用户需要创建/查询/Fork会话、给其他会话发消息、监控token用量、跨工作区操作、并行调度多个Agent协作时触发。触发信号：多会话、开小弟、Fork、分身、并行、批量、派任务、监控进度、上下文甜点、竹节交接、工作区切换。
group: proma
version: "1.0.0"
---

# Agent 会话管理

你拥有 **10 个会话管理 MCP 工具**（`session` MCP server），可以管理 Proma 中的 Agent 会话——创建、Fork、发消息、查用量、查消息历史等。你不是被困在自己的会话里；你可以像"老板"一样调度多个"小弟"协作完成复杂任务。

## 工具速览

| 工具 | 用途 | 只读 |
|---|---|---|
| `get_my_session_id` | 获取你自己的会话 ID | ✅ |
| `list_channels` | 列出所有 AI 渠道及可用模型 | ✅ |
| `list_workspaces` | 列出所有工作区 | ✅ |
| `list_sessions` | 列出会话（支持按工作区过滤） | ✅ |
| `get_session_info` | 查询任意会话详情（渠道/模型/工作区） | ✅ |
| `get_session_context` | 查询会话 token 用量/上下文窗口/使用率 | ✅ |
| `list_messages` | 列出消息历史（含 UUID，用于 Fork） | ✅ |
| `create_session` | 创建新会话（指定渠道/模型/工作区） | ❌ |
| `fork_session` | Fork 会话（支持精确 UUID 截断） | ❌ |
| `send_message` | 向目标会话发消息（返回 Agent 输出） | ❌ |

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

### 模式 3：竹节交接 — 上下文甜点区护航

```
1. get_session_context(自己) → 看 usage_pct
2. 如果接近模型甜点区上限（如 DeepSeek V4 Pro 60%+）：
   a. 先总结当前进度 → send_message(自己, "总结进度和关键发现")
   b. fork_session(自己) → 新会话
   c. send_message(新会话, 简报 + "继续任务")
   d. 旧会话保留为检查点，新会话继续
```

**模型甜点区参考：**

| 模型 | 甜点区 | 建议交接线 |
|---|---|---|
| DeepSeek V4 Pro | 150K-250K | 200K (20%) |
| DeepSeek V4 Flash | 80K-150K | 120K |
| Claude Sonnet 4.6 | 100K-200K | 150K |
| GLM-5-Turbo | 50K-80K | 60K |

### 模式 4：跨工作区协作

```
1. list_workspaces → 看到所有工作区
2. list_sessions(workspace_id="xxx") → 只看某个工作区的会话
3. create_session(workspace_id="xxx") → 在指定工作区创建会话
   新会话自动获得该工作区的文件访问权限
```

### 模式 5：外部工具编排（通过外部 MCP）

用户如果配置了外部 MCP（Claude Code 连接 Proma），那么 Claude Code 也能调度 Proma 内的 Agent 团队。你在内部和外部看到的工具是一样的。

## 消息历史与 UUID

`list_messages` 返回每条消息的：
- `index` — 序号
- `type` — user / assistant / result
- `uuid` — SDK 消息唯一标识（**用于 fork_session 的 up_to_message_uuid**）
- `role` — user / assistant
- `text` — 文本内容（截取前 500 字）
- `text_full_length` — 完整文本长度
- `timestamp` — 时间戳

**注意：** headless 会话（通过 send_message 启动的）的 user 消息可能没有 UUID。fork 时用 assistant 或 result 消息的 UUID。

## send_message 三模式

| 参数 | 行为 | 适用场景 |
|---|---|---|
| `wait=true` (默认) | 阻塞等小弟完成，返回 `reply` 字段 | 短任务，需要即时结果 |
| `wait=false, notify=true` | 立即返回，完成后通知源会话 | 内部 Agent 间异步协作 |
| `wait=false` | 纯 fire-and-forget | 不关心结果 |

**`notify=true` 仅内部 Agent 可用**（外部 MCP 调用不支持）。

## 注意事项

- `get_my_session_id` 首先调用，获取自己的会话 ID
- 创建/fork 的会话在 Proma 侧边栏需手动刷新才能看到
- headless 会话（send_message 启动的）的 usage 数据可能不完整，正常现象
- DeepSeek 渠道的 Fork 在渲染器补丁后已可用
- 省钱优先：能用 deepseek-v4-flash 就别用 deepseek-v4-pro
