# remote-session Release 验收测试方案

> 版本: v1.0 | 日期: 2026-06-19 | 制定: Proma Agent
> 背景: 2026-06-17 初次验收未通过（11/11 工具返回正常但用户判定不通过，缺失具体失败原因）

---

## 一、测试目标

验证 11 个 `mcp__remote-session__*` 工具对 **Release 实例** (instance="release", port 19877) 的全功能正确性，覆盖：
- 只读查询：返回值正确、字段完整
- 写入操作：副作用正确、可验证
- 错误处理：非法输入返回清晰错误
- 跨实例场景：Dev→Release 通信正常
- 中文支持：中文内容无乱码

---

## 二、测试环境

| 项目 | 值 |
|------|-----|
| 执行实例 | Dev (instance="dev", port 19876) |
| 目标实例 | Release (instance="release", port 19877) |
| 测试频道 | DeepSeek 官方 (`56ecefd2-8e22-4c62-add5-16e8992c987d`) |
| 测试模型 | deepseek-v4-pro |
| 子会话模型 | deepseek-v4-flash |

---

## 三、11 工具逐项测试用例

### 0. 前置检查 — 实例连通性

| 用例 | 操作 | 期望 |
|------|------|------|
| 0.1 | remote_get_my_session_id(instance="release") | 返回有效 session_id (UUID 格式) |

### 1. remote_list_channels

| 用例 | 操作 | 期望 |
|------|------|------|
| 1.1 | 正常调用 | 返回频道列表，至少包含 proma-official、DeepSeek 官方等 |
| 1.2 | 验证字段 | 每个频道含 id/name/provider/models 字段 |

### 2. remote_list_workspaces

| 用例 | 操作 | 期望 |
|------|------|------|
| 2.1 | 正常调用 | 返回工作区列表，包含 name/id 字段 |

### 3. remote_list_sessions

| 用例 | 操作 | 期望 |
|------|------|------|
| 3.1 | 默认参数 | 返回非归档会话列表 |
| 3.2 | include_archived=true | 返回含归档会话（总数 ≥ 3.1） |
| 3.3 | limit=3 | 返回 ≤ 3 条 |
| 3.4 | workspace_id 筛选 | 指定工作区 ID 后仅返回该工作区会话 |

### 4. remote_get_my_session_id

| 用例 | 操作 | 期望 |
|------|------|------|
| 4.1 | instance="release" | 返回有效 UUID + instance 字段 |
| 4.2 | 无 instance 参数 | 返回错误（参数必填） |

### 5. remote_get_session_info

| 用例 | 操作 | 期望 |
|------|------|------|
| 5.1 | 有效 session_id | 返回 title/channel_name/model_name/workspace_name 等完整字段 |
| 5.2 | 无效 session_id | 返回 "Session not found" 错误 |
| 5.3 | 中文标题会话 | 中文标题正确显示，无乱码 |

### 6. remote_get_session_context

| 用例 | 操作 | 期望 |
|------|------|------|
| 6.1 | 有消息的会话 | 返回 input/output/total tokens |
| 6.2 | 空会话（新创建） | 返回 "No messages yet" 提示 |
| 6.3 | 无效 session_id | 返回 "Session not found" 错误 |

### 7. remote_list_messages

| 用例 | 操作 | 期望 |
|------|------|------|
| 7.1 | 默认参数 | 返回消息列表（默认 limit=50） |
| 7.2 | limit=5 | 返回 ≤ 5 条 |
| 7.3 | offset=2 | 跳过前 2 条 |
| 7.4 | 无效 session_id | 返回 "Session not found" 错误 |
| 7.5 | 中文消息内容 | 中文正确显示无乱码 |

### 8. remote_create_session

| 用例 | 操作 | 期望 |
|------|------|------|
| 8.1 | 指定 channel + model + title | 返回完整 UUID，session 实际创建成功 |
| 8.2 | 仅指定 channel（不指定 model） | 使用默认模型创建成功 |
| 8.3 | 中文 title | title 正确保存，后续 get_session_info 一致 |
| 8.4 | 无效 channel_id | 返回 "Channel not found" 错误 |

### 9. remote_fork_session

| 用例 | 操作 | 期望 |
|------|------|------|
| 9.1 | 基础 Fork（全量） | Fork 成功，返回新 session_id |
| 9.2 | Fork + 指定 new_title | 标题正确 |
| 9.3 | Fork + 指定 up_to_message_uuid | 截断 Fork 成功，消息数 ≤ 截断点+1 |
| 9.4 | Fork + new_model_id=deepseek-v4-flash | 模型覆盖成功 |
| 9.5 | 无效 source_session_id | 返回 "Source session not found" 错误 |
| 9.6 | Fork 后 send_message 上下文保留 | 子会话可复述源会话内容 |

### 10. remote_send_message

| 用例 | 操作 | 期望 |
|------|------|------|
| 10.1 | wait=true（同步） | 返回 status=completed + 完整 reply |
| 10.2 | wait=false（fire-and-forget） | 返回 status=started，后续可 list_messages 看到回复 |
| 10.3 | 跨 provider 模型切换（glm→deepseek） | 第二轮正常回复，无 [1211] 错误 |
| 10.4 | 无效 session_id | 返回 "Target session not found" 错误 |
| 10.5 | 中文消息发送 + 回复 | 中文无乱码 |
| 10.6 | send_message 后 get_session_info 验证 model_id 同步 | model_id 匹配最近一次 send_message 使用的模型 |

### 11. remote_archive_session

| 用例 | 操作 | 期望 |
|------|------|------|
| 11.1 | archive 有效会话 | 成功，list_sessions 不再出现（不传 include_archived） |
| 11.2 | archive 后 include_archived=true 可见 | 出现在归档列表中 |
| 11.3 | unarchive (archived=false) | 恢复，list_sessions 重新出现 |
| 11.4 | 无效 session_id | 返回错误 |

---

## 四、跨工具集成测试

### 集成场景 1：创建→发消息→Fork→子会话发消息

```
1. remote_create_session → session_A
2. remote_send_message(session_A, "记下代号 ALPHA-99") → 验证 reply 包含 ALPHA-99
3. remote_fork_session(session_A, new_model_id=deepseek-v4-flash) → session_B
4. remote_send_message(session_B, "代号是什么？") → 验证 reply 含 ALPHA-99（上下文保留）
5. remote_list_messages(session_B) → 验证消息数 = 4（2 user + 2 assistant）
```

### 集成场景 2：跨频道切换不丢上下文

```
1. remote_create_session(model_id=glm-5.2) → session_C
2. remote_send_message(session_C, "记住 KEY-42") → 正常
3. remote_send_message(session_C, "KEY 是什么？", model_id=deepseek-v4-pro) → 验证回复含 KEY-42 且无报错
4. remote_get_session_info(session_C) → model_id = deepseek-v4-pro（meta 已同步）
```

### 集成场景 3：归档→反归档循环

```
1. remote_create_session → session_D
2. remote_send_message(session_D, "test") → 正常
3. remote_archive_session(session_D, archived=true) → 成功
4. remote_list_sessions(include_archived=true) → session_D 标记 archived
5. remote_archive_session(session_D, archived=false) → 成功
6. remote_list_sessions() → session_D 重新可见
```

---

## 五、回归检查清单（上次验收已知问题）

| 检查项 | 上次状态 | 本次验证 |
|--------|---------|---------|
| 中文返回无乱码 | ✅ | 逐工具验证 |
| 11/11 工具全部可调用 | ✅ | 逐工具验证 + 返回值字段完整性 |
| JSON 解析正确 | 未验证 | 每个返回值含预期字段 |
| 错误场景覆盖 | 部分 | 每个工具 ≥ 1 个错误用例 |
| 跨实例通信延迟 | 未测量 | 记录每次调用耗时 |
| 实例自动发现 | ✅ | 验证 instance="release" 解析到 port 19877 |

---

## 六、报告格式

测试完成后按以下格式输出：

```markdown
# remote-session Release 验收报告

## 总评
✅ / ⚠️ / ❌（通过数/总数）

## 逐工具结果
| 工具 | 通过 | 失败 | 失败用例 | 备注 |
|------|------|------|---------|------|
| remote_list_channels | 2/2 | 0 | - | |
| ... | | | | |

## 集成测试结果
| 场景 | 结果 | 详情 |
|------|------|------|

## 失败详情
### 用例 X.X — [描述]
- 预期: ...
- 实际: ...
- 严重度: 阻断/高/中/低

## 性能数据
- 总耗时: ...
- 最慢工具: ... (Xms)

## 结论与建议
```

---

## 七、执行约束

- **你的身份**: Dev 实例上的测试会话（deepseek-v4-pro, DeepSeek 官方频道）
- **测试工具**: 使用 `mcp__remote-session__remote_*` 系列，instance 参数统一填 `"release"`
- **子会话（如需）**: 使用 `deepseek-v4-flash` 模型，省钱且快速
- **完成后**: 报告写入 `workspace-files/.context/remote-session-release-report.md`
