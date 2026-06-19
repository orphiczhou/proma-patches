---
milestone: M1-M3
topic: l1fix-A-test 补测关键决策
reversible: true
---

## 可选方案

### 跨 provider 切换
- A: MiniMax-M3 (anthropic 协议端点)
- B: GLM 系列 (ZLM-CodingPlan 频道 `cbb12a0b`)
- C: Proma 官方频道中的其他 provider 模型

### 集成场景 2 替代
- A: deepseek-v4-flash → deepseek-v4-pro (同频道跨模型 Fork)
- B: MiniMax → DeepSeek (跨频道 Fork)

## 选择

- 跨 provider: 方案 A — MiniMax-M3 on MiniMax-CodingPlan (`b7e25505`)
- 集成场景 2: 方案 A — deepseek 内部 flash→pro Fork

## 理由

1. MiniMax 是唯一可用的非 DeepSeek agent 频道 (GLM 频道虽存在但 GLM 被禁令跳过)
2. 方案 A 避免了原测试"GLM 禁令跳过"的问题，且 MiniMax-M3 成功响应验证
3. deepseek 内部 flash→pro Fork 优于跨频道 Fork，因为:
   - 跨频道 Fork 要求 `new_channel_id` 参数，可能引入额外变化
   - 同频道跨模型验证了核心功能: Fork 可切换模型且保留上下文

## 触发重审条件

- 如果 MiniMax-CodingPlan 频道出现模型不可用
- 如果有新的非 DeepSeek provider 频道加入 Release 实例

---

## 关键发现记录

1. `remote_get_my_session_id` 对 instance="" 不报错（行为不一致）
2. `remote_list_sessions` 对负 offset 静默归零（与 limit 的严格 -32602 不一致）
3. Fork 要求源会话已有 SDK 会话（至少发过一条消息）
4. MiniMax 频道的 provider 返回 "anthropic"（API 协议层面非模型厂商）
5. get_session_info 不返回 model_name（显示名），需额外调 list_channels 映射
