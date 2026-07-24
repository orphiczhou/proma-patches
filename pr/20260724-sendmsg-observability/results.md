# P1-2: send_message 可观测性 — 实施与审计结果

> 日期：2026-07-24 | 接力第三棒（最后一项）| design.md 同目录

## 1. 实施摘要

### 1.1 引擎：tree-engine.cjs

**(a) 新命令 cmdCommunicationLog / cmdCommunicationList**（约 L1322-1390）：
- `log`：追加 `{ts, caller_session_id, target_session_id, target_leaf_id, direction, note}` 到 `state.communication_log`；**自动定位 target leaf**（按 session_id 匹配）+ 更新 `target_leaf.last_event_type='communication_<dir>'` + `last_event_ts`（心跳可感知）。
- `list`：按 `--leaf` / `--target` / `--since` 过滤查询。
- **不截 message 内容**（无 message 字段；note 是 agent 自主摘要，可选）。

**(b) dispatchCommunication** + dispatch `case 'communication'`（透传 callerSessionId）。

**(c) state 新增 `communication_log` 顶层字段**：防御性初始化（`if (!Array.isArray) []`），**不改 migrate**，旧树兼容。

**(d) dispatch default 错误信息** Available 列表加 `communication`。

### 1.2 patches.cjs（双渲染器共用）

注册 2 工具到 `buildTreeTable`（被 `renderClaude` L1968 + `renderPi` L2024 共用）：
- `tree_log_communication(tree_id, target_session_id, direction?, note?)`
- `tree_communication_list(tree_id, leaf_id?, target?, since?)`

`call()` 透传 callerSessionId（MCP 层注入，agent 无法伪造）。

### 1.3 SKILL.md（v2.8 → v2.9）

1. **§5 Append 表**加 `tree_log_communication`；**Query 表**加 `tree_communication_list`。
2. **§6 新增「外部通信记录协议」**：root 每次 `send_message` 给树内 leaf 后调 `tree_log_communication`；说明引擎自动处理 + 不截内容 + 为什么不用自动 hook。
3. **§15 修订历史 v2.9**。

## 2. 部署

| 目标 | 状态 |
|------|------|
| source tree-engine.cjs + proma-dev-patches.cjs | node --check OK |
| dev/pro dist（两文件 cp 整文件） | node --check OK + diff identical |
| dev/pro 实例 | restart-{dev,pro}.ps1 (ISOLATED=1) LAUNCHED |
| SKILL.md v2.9 | 已改（加载即生效） |

## 3. 单测结果

**脚本**：`pr/20260724-sendmsg-observability/test-p12.cjs`（5 用例 17 子用例）

```
[A] communication log 定位 target leaf + 更新 last_event    6 PASS
[B] target 不在树内 → target_leaf_id=null                   2 PASS
[C] note 记录 + entry 无 message 字段（不截内容）            3 PASS
[D] communication list 按 leaf 过滤                         3 PASS
[E] direction=in + 默认 out                                3 PASS
=== 17 passed, 0 failed ===
```

**回归**：P0-1（17/17）+ P1-3（16/16）+ P1-1（12/12）同步复跑全过（零回归）。

## 4. 独立审计

**审计员**：独立子会话（release 本地，DeepSeek-V4-Pro，session=f111f1a4）
**Verdict**：**PASS**

审计结论：
- 引擎正确性 PASS：target leaf 定位（session_id 匹配，遍历含 archived）+ last_event 更新 + direction 校验 + target 不在树内 null 处理均完备。
- 不截内容 PASS：entry 无 message 字段（测试 C 显式断言），note 是 agent 自主摘要。
- patches.cjs 注册 PASS：两工具 schema + handler 正确；call() 透传 callerSessionId（MCP 层注入）；buildTreeTable 被 renderClaude + renderPi 双渲染器共用，新工具两运行时都能用。
- SKILL 文档一致性 PASS：§5 两工具 + §6 通信协议 + §15 v2.9 与引擎行为 100% 一致。
- 回归风险 PASS：dispatch 纯新增 case + state communication_log 防御性初始化（不改 migrate）；P0-1/P1-3/P1-1 零回归。
- 安全/滥用 PASS：callerSessionId 不可伪造（MCP 注入）；无通信日志限频（设计认定为轻量方案合理——entry ~200B，note agent 自控；macp 实战若刷屏再加 --target 短期去重）。
- 单测 PASS：17/17 绿；漏测边界（since 过滤 / 无效 direction / archived target）均论证低风险。

## 5. 后续观察点

- **通信日志限频**：审计建议若 macp 实战出现同一 target 频繁重复 log 刷屏，后续加 `--target` + `--direction` 短期去重（类比 P1-3 drift 限频）。
- **方案 b（自动 hook send_message）**：若 macp 类实战再证 agent 普遍漏调 `tree_log_communication`（通信盲区仍存在），考虑把 workspaceSlug 透传到 session tool handler，在 send_message handler 成功路径末尾自动调 `communication log`。
- macp 实战再跑时，确认 root 记录通信后 commander 心跳不再误判 worker "冻结"（target leaf last_event_ts 实时更新）。

## 6. 交付物

- `D:/Codes/tree-harness/tree-engine.cjs`（cmdCommunicationLog/List + dispatchCommunication + dispatch case）
- `D:/Codes/tree-harness/proma-dev-patches.cjs`（buildTreeTable 注册 2 工具）
- `D:/Codes/tree-harness/pr/20260724-sendmsg-observability/{design.md, results.md, test-p12.cjs}`
- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.9）
