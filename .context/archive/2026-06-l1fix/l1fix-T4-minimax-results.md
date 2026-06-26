# T4 MiniMax 频道 8 工具补测结果

> 执行: 2026-06-23 08:50 GMT+8 | Agent: T4-minimax-tester
> 频道: MiniMax-CodingPlan (`b7e25505-c972-49e7-9173-ef14df3eaa3f`)
> 实例: release

## 补测背景

v5 报告覆盖边界矩阵: MiniMax 频道仅 3/11 工具验证 (create_session, send_message, get_session_info)。
其余 8 工具 (list_channels, list_workspaces, list_sessions, get_my_session_id, get_session_context, list_messages, fork_session, archive_session) 从未在 MiniMax 频道测试。

## 补测结果

| # | 工具 | 参数 | 返回值摘要 | 结果 |
|---|------|------|-----------|:---:|
| 1 | remote_list_channels | instance="release" | 4频道: Proma官方, MiniMax-CodingPlan (b7e25505, 4模型), ZLM-CodingPlan, DeepSeek官方 | ✅ |
| 2 | remote_list_workspaces | instance="release" | 7工作区: Tree测试2/1, Proma改造探索, 高维空间理解, 三元溯源, 本机工作, 南大项目 | ✅ |
| 3 | remote_list_sessions | instance="release", limit=5 | 5条session (total=150) | ✅ |
| 4 | remote_get_my_session_id | instance="release" | session_id=null, is_remote=true (远端调用预期null) | ✅ |
| 5 | remote_get_session_context | session_id=65911a00-5054-4d94-be7b-8c7071a7d6a3 | session="M1-跨provider-MiniMax", model=MiniMax-M3, tokens=31622/1M (3.2%) | ✅ |
| 6 | remote_list_messages | session_id=65911a00..., limit=5 | 5/8条消息, MiniMax-M3回复中文正常 | ✅ |
| 7 | remote_fork_session | source=65911a00..., new_model_id="MiniMax-M3" | 新session 580e6e81, channel=MiniMax-CodingPlan, model=MiniMax-M3 | ✅ |
| 8 | remote_archive_session | session_id=580e6e81..., archived=true/false | 归档/反归档循环正常 | ✅ |

## 关键发现

- MiniMax 频道所有 8 个工具全部正常工作
- Fork 在 MiniMax 频道正常: 新 session 继承源 channel 和 model
- Archive/unarchive 循环正常
- MiniMax-M3 模型中文回复无乱码

## 覆盖边界更新

| 工具 | DeepSeek 频道 | MiniMax 频道 (T3前) | MiniMax 频道 (T4后) |
|------|:---:|:---:|:---:|
| list_channels | ✅ T2 | ❌ | ✅ T4 |
| list_workspaces | ✅ T2 | ❌ | ✅ T4 |
| list_sessions | ✅ T2 | ❌ | ✅ T4 |
| get_my_session_id | ✅ T2 | ❌ | ✅ T4 |
| get_session_info | ✅ T2 | ✅ T3 | ✅ |
| get_session_context | ✅ T2 | ❌ | ✅ T4 |
| list_messages | ✅ T2 | ❌ | ✅ T4 |
| create_session | ✅ T2 | ✅ T3 | ✅ |
| fork_session | ✅ T2 | ❌ | ✅ T4 |
| send_message | ✅ T2 | ✅ T3 | ✅ |
| archive_session | ✅ T2 | ❌ | ✅ T4 |
| **覆盖率** | **11/11** | **3/11** | **11/11** ✅ |

MiniMax 频道现已达到全 11/11 工具验证。此前 "全部 11 工具跨 provider 可用" 的结论在 MiniMax 侧不再泛化过度。
