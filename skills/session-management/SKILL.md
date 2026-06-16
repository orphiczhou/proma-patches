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
| `get_session_info` | 查询任意会话详情 | ✅ |
| `get_session_context` | 查询 token 用量/上下文窗口/使用率 | ✅ |
| `list_messages` | 列出消息历史（含 UUID，用于 Fork） | ✅ |
| `create_session` | 创建新会话（指定渠道/模型/工作区） | ❌ |
| `fork_session` | Fork 会话（支持精确 UUID 截断） | ❌ |
| `send_message` | 向目标会话发消息（返回 Agent 输出） | ❌ |

## 核心使用模式

### 模式 1：开小弟并行干活

1. `list_channels` → 看有哪些模型可用
2. `create_session × N` → 开 N 个小弟会话（用便宜模型省钱）
3. `send_message(wait=false) × N` → 同时派任务
4. 轮询 `get_session_context` → token 稳定即完成
5. `list_messages` → 取每个小弟的最后回复
6. `fork_session` → 开"整合会话"汇总

**省钱：** 复杂分析用 Claude Opus / V4 Pro，简单实现用 V4 Flash，最便宜用 GLM-4.5-Air。

### 模式 2：深度探索 — Fork 任意轮

1. `list_messages(session_id)` → 查看消息历史，每条都有 UUID
2. 找到想回退的那轮 assistant 消息的 UUID
3. `fork_session(source_session_id, up_to_message_uuid=那个UUID)`
4. `send_message(新会话, "换一种方式...")`

### 模式 3：竹节交接 — 上下文甜点区护航

当 `get_session_context` 显示 usage_pct 接近甜点区上限：
1. 先总结当前进度
2. `fork_session` 创建新会话
3. 发送简报 + "继续任务" 到新会话
4. 旧会话保留为检查点

| 模型 | 甜点区 | 建议交接线 |
|---|---|---|
| DeepSeek V4 Pro | 150K-250K | 200K |
| DeepSeek V4 Flash | 80K-150K | 120K |
| Claude Sonnet 4.6 | 100K-200K | 150K |
| GLM-5-Turbo | 50K-80K | 60K |

### 模式 4：跨工作区

`list_workspaces` → `list_sessions(workspace_id=...)` → `create_session(workspace_id=...)`

### 模式 5：send_message 三模式

| 参数 | 行为 | 适用 |
|---|---|---|
| `wait=true` | 阻塞等待，返回 reply | 短任务 |
| `wait=false, notify=true` | 异步回调（仅内部） | Agent 间协作 |
| `wait=false` | 纯 fire-and-forget | 不关心结果 |

## 注意事项

- 首先调 `get_my_session_id` 获取自己的会话 ID
- 创建/fork 的会话在侧边栏需手动刷新
- headless 会话的 usage 数据可能不完整
- Fork 时用 assistant 或 result 消息的 UUID（user 消息可能没有 UUID）
- 省钱优先：能用 flash 就别用 pro
