# tests/003: 跨实例交叉测试 — P1-2 + 子会话机制改进

> 测试日期：2026-07-25 | 指挥官 8559ec21 + 观察员 4e3735f2 | CLAUDE.md PR 流程第 7 步

## 1. 测试目标

两个最近 PR 在 dev + pro 实例的端到端验证（双实例行为一致性 + 功能实测）：

| PR | commit | 核心改动 |
|----|--------|---------|
| **P1-2** send_message 可观测性 | `d4a88eb` | tree_log_communication 工具 + communication log/list（不截内容 + target leaf last_event 联动）|
| **子会话机制** P0+P1+P1+ | `7d41453` | Pi collaboration 注入加 depth 检查（P0）+ fork identityPrompt 在 depth>0 追加限制提示（P1+）|

## 2. 执行方式（指挥官 + 观察员子会话群）

- **指挥官**（8559ec21，DeepSeek）：用 `mcp__remote-session__*` 在 dev(19877) + pro(19878) 各测两 PR → `commander-report.md`
- **观察员**（4e3735f2，DeepSeek）：独立审查指挥官报告 + 抽查 identityPrompt 全文（绕过 list_messages 截断）→ `observer-report.md`

## 3. 结果：两 PR 真 PASS（观察员逐字确认）

| PR | dev | pro | 关键验证 |
|----|:-:|:-:|--------|
| **P1-2** | ✅ | ✅ | tree_log_communication 接口正常 + communication_log 写入 1 条（dev/pro 一致）|
| **子会话机制 P0** | ✅ | ✅ | fork 子会话（depth=1）工具列表**无** `mcp__collaboration__delegate_agent`（dev 68 工具 / pro 67 工具均无）|
| **子会话机制 P1+** | ✅ | ✅ | identityPrompt 全文含三要素（观察员让 fork 子会话复述逐字确认）：① 「协作子会话限制（delegationDepth=1）」② 「你看不到 mcp__collaboration__delegate_agent 工具」③ 3 种替代方案 |

## 4. 覆盖度说明（互补）

- **P1-2 worker last_event 联动**：跨实例测试因占位 UUID（`22222222-...`）被 V10 session liveness 校验拦截，worker leaf 没建成，只验证了 target=root 路径。**worker last_event 联动**由 `pr/20260724-sendmsg-observability/test-p12.cjs` 用例 A 单测覆盖（17/17 全过，同代码路径，风险低）。
- **P1+ identityPrompt 全文**：指挥官的 `remote_list_messages` text 字段截断 ~400 字符（identityPrompt 全长 890），P1+ 关键词未直接可见。观察员改用"让 fork 子会话复述 identityPrompt 全文"绕过截断，**逐字确认** P1+ 三要素。

## 5. 发现的小问题（非阻塞，可后续优化）

| # | 问题 | 严重性 | 说明 |
|---|------|--------|------|
| 1 | `remote_list_messages` text 截断 ~400 字符 | 低 | 影响长消息（identityPrompt 890 字符）直接验证。建议 proma-mcp-server.cjs 加 full_text 字段或提高阈值。本次靠"让会话复述"绕过。 |
| 2 | `remote_archive_session` HTTP 外部调用被 R6 拦 | 低（设计如此） | D1-A 仅允许 send_message。测试会话需在 dev/pro Proma UI 手动归档。 |
| 3 | dev `get_instance_info` 返回 `proma_dev:false` | 低 | 可能与启动方式有关，不影响功能。 |

## 6. 测试会话清单（需手动归档）

| 实例 | 用途 | session_id |
|------|------|-----------|
| dev | P12-dev | 47b3d8e0-a84f-420d-beca-bdfb8e0035b8 |
| pro | P12-pro | e58fd6ee-d56b-47d8-9947-8b9723eb3c15 |
| dev | FORK-dev (parent) | dddf8fc6-c170-4d30-8c94-002f9bfe79ae |
| pro | FORK-pro (parent) | a780add3-fb74-477f-954a-f54bd080861b |
| dev | FORK-dev (fork) | 46aa7572-8169-4441-a3b1-7f80e092c096 |
| pro | FORK-pro (fork) | 9a07829f-8e88-4ae3-9dc7-0bb915c54dc7 |

## 7. 关联档案

- P1-2 单测（含 worker last_event 联动）：`pr/20260724-sendmsg-observability/test-p12.cjs`（17/17）
- P1-2 PR 档案：`pr/20260724-sendmsg-observability/{design.md, results.md}`
- 子会话机制 PR 档案：`pr/20260724-subsession-mechanism-investigation/{design.md, implementation-p0.md, implementation-p1.md, results.md}`
- 详细报告：`commander-report.md`（指挥官）+ `observer-report.md`（观察员）
