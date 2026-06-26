# 内部 Agent 会话调用完整测试计划

> 日期: 2026-06-16 | 模型: DeepSeek V4 Pro | 通道: DeepSeek官方

## 测试架构

```
老板 (HTTP bridge → 外部MCP)        小弟 (headless, deepseek-v4-pro)
  │                                      │
  ├─ create_session ───────────────────→ 🟢 小弟诞生
  ├─ send_message("自我介绍+自检") ──→ 🟢 MCP工具可用? get_my_session_id?
  ├─ send_message("探索所有会话") ──→ 🟢 list_sessions + 跨会话查询
  ├─ send_message("创建一个子小弟") ─→ 🟢 create_session + send_message 给子小弟
  ├─ send_message("查上下文") ──────→ 🟢 get_session_context(自己)
  ├─ send_message("看消息历史") ────→ 🟢 list_messages(自己)
  ├─ send_message("Fork自己") ──────→ 🟢 fork_session
  └─ list_messages + context ────────→ 📊 最终检查
```

## 测试用例

| # | 测试项 | 关键验证点 |
|---|--------|----------|
| T1 | 小弟自指 | get_my_session_id 返回正确ID |
| T2 | 小弟自检上下文 | get_session_context(自己) 返回模型/窗口/用量 |
| T3 | 小弟探索全局 | list_channels + list_workspaces + list_sessions |
| T4 | 小弟创建子小弟 | create_session + send_message 给子小弟 |
| T5 | 小弟看自己消息 | list_messages(自己) 含 UUID/role/text |
| T6 | 小弟Fork自己 | fork_session + 验证保留上下文 |
| T7 | 上下文增长 | 多轮后 context pct 逐步增长 |
| T8 | 异步通知 | send_message(notify=true) 验证回调 |
| T9 | 跨工作区 | 有多个工作区时 list_sessions 过滤 |

## 预期结果
- T1-T7: 全部通过
- T8: notify 从外部不支持，从内部支持（需在 Proma UI 内验证）
- T9: 当前只有1个工作区，基本过滤验证通过即可
