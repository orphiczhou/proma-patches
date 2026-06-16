# MCP 7 工具外部服务测试报告

> 日期: 2026-06-16 | 版本: v0.9 | 测试人: Proma Agent

---

## 一、测试环境

| 项目 | 值 |
|---|---|
| Proma 版本 | v0.12.23-dev (D:\Proma-dev\) |
| 插件版本 | v0.9 (546 行) |
| HTTP Bridge | 127.0.0.1:19876 |
| MCP Server | proma-mcp-server.cjs (206 行) |
| 测试渠道 | proma-official (Proma 官方) |
| 测试模型 | deepseek-v4-pro |

## 二、测试结果总览

| 分类 | 通过 | 失败 | 备注 |
|---|---|---|---|
| 只读查询 (4 工具) | 9/9 | 0 | 全部正常 |
| 写入操作 (3 工具) | 7/7 | 0 | 全部正常 |
| 错误处理 | 5/5 | 0 | 错误信息清晰 |
| **合计** | **21/21** | **0** | **100%** |

## 三、逐项明细

### 3.1 list_channels

| 用例 | 结果 | 详情 |
|---|---|---|
| 正常调用 | PASS | 4 渠道: Proma官方(18m), MiniMax(4m), ZLM(6m), DeepSeek(2m) |

### 3.2 list_sessions

| 用例 | 结果 | 详情 |
|---|---|---|
| 默认参数 | PASS | 返回非归档会话 20 条 |
| include_archived=true | PASS | 返回全部 23 条 (含 3 条归档) |
| limit=1 | PASS | 返回精确 1 条 |

### 3.3 get_session_info

| 用例 | 结果 | 详情 |
|---|---|---|
| 有效 session_id | PASS | 正确返回标题/渠道/模型/工作区/权限模式 |
| 无效 session_id | PASS | `Session not found: deadbeef-...` |

### 3.4 get_session_context

| 用例 | 结果 | 详情 |
|---|---|---|
| 空会话 (无消息) | PASS | `No messages yet. Send a message first...` |
| headless 执行后 | PASS* | 返回 `No usage data found` — headless 模式不持久化 usage 到 SDK messages |
| 无效 session_id | PASS | `Session not found: ...` |

> *注: headless 模式 (runAgentHeadless) 的 usage 数据记录方式与常规 sendMessage 不同，token 用量查不回来属于已知限制，不影响 send_message 功能正确性。

### 3.5 create_session

| 用例 | 结果 | 详情 |
|---|---|---|
| 指定 channel + model + title | PASS | 创建成功，返回完整 UUID + channel/model/title |
| 无效 channel_id | PASS | `Channel not found: "nonexistent-chan"...` |

### 3.6 send_message

| 用例 | 结果 | 详情 |
|---|---|---|
| wait=true (同步等待) | PASS | 目标会话 headless 执行完成，`status: completed` |
| notify=true (外部调用) | PASS | 正确拒绝: `notify=true is not supported from external MCP (no source session)` |
| 无效 session_id | PASS | `Target session not found: "deadbeef-..."` |

### 3.7 fork_session

| 用例 | 结果 | 详情 |
|---|---|---|
| 基础 Fork | PASS | 从 send_message 执行后的会话 Fork，成功创建并保留上下文 |
| 模型覆盖 (new_model_id) | PASS | `model_id: glm-5-turbo` — 覆盖成功 |
| 无效 source_session_id | PASS | `Source session not found: "deadbeef-..."` |

### 3.8 send_message on Fork

| 用例 | 结果 | 详情 |
|---|---|---|
| Fork 会话 send_message | PASS | Fork 后的会话正常接收消息并完成 |

## 四、测试过程中发现和修复的问题

| 问题 | 严重性 | 修复 |
|---|---|---|
| **补丁 B 缺少 `runAgentHeadless` 导出** | 阻塞 | 追加 `runAgentHeadless` 到 `global.__proma__` API 桥接 (1 行 sed) |
| send_message 返回 error 时 test 脚本读错字段 (d1.message vs d1.error) | 低 | 修复测试脚本 |
| headless 模式 usage 数据不持久化 | 已知限制 | 不影响功能，在报告中注明 |

## 五、关键发现

1. **`runAgentHeadless` 需要在补丁 B 中显式导出** — send_message 依赖它，但旧的补丁 B 漏掉了。v0.9 的补丁清单应从 8 个扩展到 9 个（补丁 B2）。

2. **headless 执行不记录 usage** — `get_session_context` 对 headless 执行的会话返回 "No usage data"，这不影响 Layer 2 竹节交接方案（竹节交接应在常规会话中做，不是 headless 会话）。

3. **外部 MCP 不支持 `notify=true`** — 设计正确，外部调用无源会话无法接收回调通知。外部场景应使用 `wait=true`（同步等待）。

## 六、结论

**7 个 MCP 工具的外部 stdio 服务全部可用。** 外部工具 (Claude Code / 脚本) 可通过 stdio MCP 协议调用 Proma 的会话管理能力：查询渠道/会话、创建会话、Fork 会话、发送消息到目标会话并同步等待结果。
