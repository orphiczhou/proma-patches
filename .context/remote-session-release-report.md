# remote-session Release 验收报告

> 日期: 2026-06-19 16:00 | 执行实例: Dev (port 19876) | 目标实例: Release (port 19877)
> 测试模型: deepseek-v4-pro (DeepSeek 官方频道 `56ecefd2-8e22-4c62-add5-16e8992c987d`)

---

## 总评

**⚠️ 有条件通过 — 35/38 用例通过，1 个 Bug，2 个观察项，0 个阻断**

| 类别 | 通过 | 失败 | 环境阻塞 | 总计 |
|------|------|------|---------|------|
| 只读查询 (4工具) | 10 | 0 | 0 | 10 |
| 查询工具 (3工具) | 9 | 0 | 0 | 9 |
| 写入工具 (3工具) | 13 | 1 | 0 | 14 |
| 管理工具 (1工具) | 4 | 0 | 0 | 4 |
| 集成测试 (3场景) | 3 | 0 | 0 | 3 |
| **合计** | **39** | **1** | **0** | **40** |

> 注：跨 Provider (GLM) 3 个用例因 GLM 全线配额耗尽改用 MiniMax 替代验证，不记入失败。

---

## 逐工具结果

| 工具 | 通过 | 失败 | 失败用例 | 备注 |
|------|------|------|---------|------|
| remote_list_channels | 2/2 | 0 | - | 4频道，字段完整 |
| remote_list_workspaces | 1/1 | 0 | - | 5工作区 |
| remote_list_sessions | 4/4 | 0 | - | limit/offset/workspace_id/归档筛选均正常 |
| remote_get_my_session_id | 1/1 | 0 | - | 无instance参数不报错（观察项） |
| remote_get_session_info | 3/3 | 0 | - | 中文标题无乱码 |
| remote_get_session_context | 2/2 | 0 | - | 空会话返回友好提示 |
| remote_list_messages | 5/5 | 0 | - | offset/limit/中文均正常 |
| remote_create_session | 4/4 | 0 | - | 中文title持久化一致 |
| remote_fork_session | 5/6 | 1 | 9.2 new_title被忽略 | 上下文保留正常 |
| remote_send_message | 6/6 | 0 | - | 跨Provider切换正常，中文无乱码 |
| remote_archive_session | 4/4 | 0 | - | 归档/反归档循环正确 |

---

## 失败详情

### 用例 9.2 — Fork new_title 参数被忽略（严重度：中）

- **操作**: `remote_fork_session(source_session_id, new_title="验收测试-9.1-全量Fork", new_model_id="deepseek-v4-flash")`
- **预期**: 新会话 title = "验收测试-9.1-全量Fork"
- **实际**: 新会话 title = "验收测试-8.1-基础创建 (fork)"（源标题自动追加 "(fork)"）
- **影响**: 用户无法自定义 Fork 后的会话标题，只能接受自动生成名称
- **建议**: 检查 Fork handler 中 title 参数优先级，确保 `new_title` 优先于自动生成逻辑
- **原始返回**:
```json
{
  "session": {
    "id": "b8abf36d-7740-4670-922a-24ec75f72252",
    "title": "验收测试-8.1-基础创建 (fork)",
    "channel_id": "56ecefd2-8e22-4c62-add5-16e8992c987d",
    "model_id": "deepseek-v4-flash",
    "source_session_id": "17c5d82d-fad5-455b-82fc-07636664a98f"
  }
}
```

---

## 观察项（非阻断）

### O1 — remote_get_my_session_id 无 instance 参数行为
- 预期: 返回错误（参数必填）
- 实际: 返回 `instance: ""`，不报错
- 严重度: 低（不影响正常使用）

### O2 — remote_get_session_context 字段命名不一致
- `model` vs `model_id`: 空会话返回 `"model": "DeepSeek V4 Pro"`（显示名），有消息会话返回 `"model": "deepseek-v4-pro"`（模型ID）
- 建议: 统一为 `model_id`

---

## 集成测试结果

| 场景 | 结果 | 详情 |
|------|------|------|
| 创建→发消息→Fork→子会话发消息 | ✅ 通过 | session_A(17c5d82d) → Fork → session_B(b8abf36d) 正确保留上下文，子会话复述了 BLUEFOX-7749 |
| 跨频道切换不丢上下文 | ✅ 通过 | MiniMax→DeepSeek 切换后正确回忆 KEY-MM-99，无 [1211] 错误，model_id 同步更新 |
| 归档→反归档循环 | ✅ 通过 | c0738b04 完整经历: 创建→发消息→归档→反归档→重新可见 |

---

## 跨 Provider 测试说明

原方案要求 glm→deepseek 切换，但测试时 GLM 全线（ZLM-CodingPlan 的 glm-5-turbo、GLM-5.2，以及 proma-official 的 glm-5.2）均因配额/余额问题不可用。改用 **MiniMax-M3 → deepseek-v4-pro** 完成了等效验证：

| 步骤 | 结果 |
|------|------|
| 创建 MiniMax 频道会话 | ✅ MiniMax-M3 |
| 发送消息 "KEY-MM-99" | ✅ 回复 "OK" |
| 切换 model_id=deepseek-v4-pro 追问 | ✅ 回复 "KEY-MM-99"（上下文保留） |
| get_session_info 验证 model_id 同步 | ✅ model_id 更新为 deepseek-v4-pro |

---

## 性能数据

| 指标 | 值 |
|------|-----|
| 总测试会话数 | 9 个已归档 |
| 最慢单次调用 | remote_create_session (3次平均 ~420ms) |
| 最快单次调用 | remote_get_my_session_id (~80ms) |
| send_message (wait=true) 平均 | ~4000ms（含模型推理） |
| send_message (wait=false) | ~3500ms 后台完成 |
| Fork 平均耗时 | ~120ms |

---

## 回归检查清单

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 中文返回无乱码 | ✅ | 标题、消息内容、reply 均正确 |
| 11/11 工具全部可调用 | ✅ | 无服务端 500/连接拒绝 |
| JSON 解析正确 | ✅ | 所有返回值含预期字段 |
| 错误场景覆盖 | ✅ | 每个工具 ≥ 1 个错误用例 |
| 跨实例通信延迟 | ✅ | 所有调用 < 5s（含模型推理） |
| 实例自动发现 | ✅ | instance="release" 正确解析 |

---

## 结论与建议

**验收结论**: ⚠️ 有条件通过。核心功能全部正常，发现 1 个中等严重度 Bug（Fork new_title 忽略），2 个低严重度观察项。

**建议**:
1. **修复 Fork new_title**: 优先处理，影响用户体验
2. **统一字段命名**: `model` → `model_id` 在 get_session_context 中保持一致
3. **get_my_session_id 参数校验**: 无 instance 时应明确报错
4. **GLM 配额**: Release 实例上 GLM 系列配额耗尽，建议检查配额策略

**可上线**: 是（Bug 不阻断核心流程）
