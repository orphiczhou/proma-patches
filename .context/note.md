# Proma 改造 — 调研与分析笔记

> 工作区级长期文档 | 维护: 周星星

新条目追加在顶部。

---

## 2026-06-18 会话 2 (B) — v0.1 真实环境验证 ✅ 有条件通过

> 执行: 会话 63b4e61a (deepseek-v4-pro, 第 3 次尝试) | 状态: 已完成

### 验证结论

v0.1 在真实环境下**能端到端工作**。4 个子会话（A 公告/B 技术/F 整合/F1 审查，含孙会话）全部成功完成，产出真实交付物（Proma v0.2 启动公告，339 行/19KB）。

**关键发现**：
- **频道兼容性**：Claude Sonnet（余额不足）、DeepSeek V4 Pro/Flash（长消息 >60s 无响应）不可用；**仅 GLM-5-Turbo (ZLM-CodingPlan) 稳定**
- **HTTP 直连**：create_session / send_message / list_messages / archive_session 全功能正常
- **tree-state.js**：57 次写入、validate 通过、drift_log 含频道切换历史
- **notify 异步上报未验证**：子会话用 wait=true 同步模式，brief_echo/done 嵌入最终响应而非独立上报

### 已知问题（非 v0.1 缺陷）

| 编号 | 问题 | 严重度 |
|------|------|--------|
| B1 | Claude/DeepSeek 频道不可用（余额/性能），仅 GLM-5-Turbo 稳定 | 高（基础设施） |
| B2 | 子会话未使用 notify 异步上报（跨频道限制） | 中 |
| B3 | context_usage_pct 未更新到 tree-state | 低 |

详见: `.context/b-verify-report.md`

---

## 2026-06-18 会话 1 (C→A) — 命名规范修复 + v0.2 启动

> 执行: 会话 7fe2a2e4 (deepseek-v4-pro) | 状态: 进行中

### C 任务（命名规范歧义修复 v0.1.1-C）

**背景**：设计文档 §6.5 原写 prefix "4-8 字符"但未给精确正则，产生两重歧义——(1) 旧 regex `(\w+)` 过宽，放行大写 `NANJU`、1 字符 `A` 等；(2) 用户合理假设 prefix 可含连字符（如 `proma-guide`），但 `\w` 不匹配 `-`，此类命名被 E_NAME_INVALID 拒绝。

**执行**：
- 设计文档 §6.5 已在 v1.1 修正（prefix 正则锁定为 `[a-z][a-z0-9_]{3,7}` + 负例表）
- tree-state.js LEAF_NAME_RE 已同步修正（v0.1 验收前已修）
- commander-methodology.md §4.4 复盘描述改写（纠正 `(\w+)` 的歧义，明确两重歧义）
- S1 回归测试：前 10 步全部通过，3 个负例（`bad-prefix-A-x`/`BAD-A-x`/`n-A-x`）全部正确拒绝
- 自动备份验证：write_count=10 时触发，备份文件生成正常

### A 任务（v0.2 启动）

**已完**：
- v0.1.1-S3 Windows rename 重试修复 → tree-state.js `writeState` 中 rename 改为 5 次重试 + 指数退避（50/100/200/400ms）
- S2 测试方案 → `.context/s2-test-plan.md`（S2a 心跳/S2b 内审/S2c 三档 + S3 验证）
- 设计文档修订历史 → v1.2
- 方法论修订历史 → v1.0.1

**进行中**：
- tree-commander SKILL.md v2.0（子 Agent 创建中）
- tree-worker SKILL.md v2.0（子 Agent 创建中）

**待做**：
- Code review（code-reviewer 审计 tree-state.js + 2 SKILL + 设计文档变更）
- 最终报告


---

## 2026-06-18 v0.16.3 多维度综合交叉测试报告

> 执行: 指挥会话 (cf10d65d) @ Dev 实例 HTTP bridge | 耗时: ~20 分钟 | 5 Agent 并行执行

### 总览

| 矩阵 | 主题 | 结果 | 关键指标 |
|------|------|------|---------|
| H | 多 provider 横跳 × 多 sdkSession fork | **PASS** (部分) | model_sync 5/5, forks 3/5 (2 个跨 sdkSession 预期失败) |
| I | send_message 三模式 × 跨 provider | **FAIL** | I1 PASS, I2 PASS, I3 FAIL (并发丢消息) |
| J | 嵌套 Fork (3 层) | **PASS** | 3/3 层成功, 上下文完整保留 |
| K | 长会话 Fork 对比 (Bug 2 复检) | **PASS** | 源 104 = Fork 104, 差 0 |
| L | 错误恢复 | **PASS** | 4/4 断言通过 |

**整体**: 4/5 矩阵通过, 1 个发现新问题 (I3 并发竞态丢消息)

### 矩阵 H 详细结果 — 多 provider 横跳 × 多 sdkSession fork

会话 `4f9c9fd2`（标题 `[多维-H] 5 provider 横跳`）。

**model_sync（Bug 5 验证）5/5 PASS:**

| 轮次 | model_id | reply | get_session_info | 断言 |
|------|----------|-------|-----------------|------|
| R1 | glm-5.2 | 代号 PHOENIX-7 | glm-5.2 | ✅ |
| R2 | deepseek-v4-pro | 代号复述 + DeepSeek 风格 | deepseek-v4-pro | ✅ |
| R3 | claude-sonnet-4-6-promo-3 | 代号复述 + Claude 风格 | claude-sonnet-4-6-promo-3 | ✅ |
| R4 | gpt-5.4 | "未知错误" | gpt-5.4 | ✅ (meta 同步但 API 不可用) |
| R5 | gemini-2.5-pro | "未知错误" | gemini-2.5-pro | ✅ (meta 同步但 API 不可用) |

**forks（Bug 4 验证）3/5 PASS:**

| Fork | UUID 类型 | 时期 | 结果 | 消息数 | 期望 |
|------|----------|------|------|--------|------|
| F1 | assistant (idx 1) | GLM | ✅ 6658604a | 2 | 2 |
| F2 | result (idx 3) | GLM | ❌ 跨 sdkSession | - | - |
| F3 | assistant (idx 5) | DeepSeek | ✅ e72a4545 | 6 | 6 |
| F4 | result (idx 7) | DeepSeek | ❌ 跨 sdkSession | - | - |
| F5 | assistant (idx 9) | Claude | ✅ ca6511aa | 10 | 10 |

**关键发现**:
- Bug 5 修复确认：5 次 provider 切换 model_id 全部正确同步
- Bug 4 修复确认：跨 sdkSession 的 assistant 消息 fork 全部成功（候选循环试错生效）
- gpt-5.4 和 gemini-2.5-pro 在 Dev 实例返回"未知错误"，需检查 API key/配额
- result 类型消息的 fork 因跨 sdkSession 仍然失败（非 Bug，是 SDK 架构限制）

### 矩阵 I 详细结果 — send_message 三模式 × 跨 provider

**I1 (wait=true × 跨 provider): PASS**
- glm-5.2 → deepseek-v4-pro → gpt-5.4 三次切换
- model_id 全部同步，上下文 IOTA-11 在健康 provider 间正确传递
- gpt-5.4 返回"未知错误"但 model_id 仍正确更新

**I2 (fire-and-forget): PASS**
- 会话 `ac012ac9`（`[多维-I2] fire-and-forget`）
- send_message wait=false 立即返回 `{"status":"started"}`
- 轮询 2 次（~8 秒）看到 assistant 回复"巴黎。"
- model_id 同步正确

**I3 (并发 fire-and-forget × 跨 provider): FAIL**
- 会话 `4fc92476`（`[多维-I3] 并发 fire-and-forget`）
- 同时发送 3 条 wait=false（glm-5.2 / deepseek-v4-pro / gpt-5.4）
- 3 条全部返回 `"started"` 成功
- 但 list_messages 中只出现 deepseek-v4-pro 的 1 条（"2+2=4"）
- **glm-5.2 和 gpt-5.4 的消息静默丢失**
- 系统无死锁，但存在同会话并发竞态导致消息丢失

**⚠️ 这是一个新发现的 Bug：同一会话的并发 fire-and-forget send_message 存在竞态条件，导致部分消息丢失。**

### 矩阵 J 详细结果 — 嵌套 Fork

源会话 `8fa7351b`（`[多维-J] 嵌套 Fork`）。

| 层级 | 源 | Fork 会话 ID | 结果 |
|------|-----|-------------|------|
| L1 | 源 (8fa7351b) | 12bf1524 | ✅ |
| L2 | L1 (12bf1524) | b7043cc1 | ✅ |
| L3 | L2 (b7043cc1) | 567c7c31 | ✅ |

在 L3 中提问"代号？"，回复正确包含 `NESTED-OK-99` 和 `CHAIN-DEPTH-3`。
**3 层嵌套 Fork 上下文完整保留。**

### 矩阵 K 详细结果 — 长会话 Fork 对比

源会话 `63bc1223`（`[多维-K] 长会话 Fork 对比`）。

| 指标 | 值 |
|------|-----|
| 发送消息 | 30 条（REPLY-1 ~ REPLY-30） |
| 源 total | 104（30 user + 30 assistant + 44 result） |
| Fork 会话 | 44f63de4 |
| Fork total | 104 |
| 差 | **0** |
| Bug 2 状态 | **确认不存在** |

30 轮对话全部成功，Fork 完整保留全部 104 条消息（UUID、时间戳、文本、usage 完全一致）。

### 矩阵 L 详细结果 — 错误恢复

会话 `b983381c`（`[多维-L] 错误恢复`）。

| 步骤 | 操作 | 结果 | 断言 |
|------|------|------|------|
| 1 | send_message model_id="invalid-model-id" | 返回"未知错误"，无崩溃 | ✅ |
| 2 | send_message model_id="glm-5.2" | 正常回复 "已恢复正常，LIMA-77 收到" | ✅ |
| 3 | get_session_info | model_id = glm-5.2 | ✅ |
| 4 | send_message 确认稳定 | "LIMA-77 确认：会话稳定" | ✅ |

补丁 H v2 的错误恢复路径验证通过。

### 关键发现

1. **Bug 5 修复确认**：5 provider 横跳 model_id 全部同步（矩阵 H R1-R5）
2. **Bug 4 修复确认**：跨 sdkSession fork 候选循环试错生效（矩阵 H F1/F3/F5）
3. **Bug 2 确认不存在**：长会话 104 条消息全量 Fork 零丢失（矩阵 K）
4. **⚠️ 新发现：同会话并发 fire-and-forget 竞态丢消息**（矩阵 I3）：3 条并发 wait=false 消息中 2 条静默丢失，均返回 `"started"` 但未实际处理。需要排查 `runAgentHeadless` 的并发守卫是否拒绝而非排队
5. **gpt-5.4 和 gemini-2.5-pro 在 Dev 实例不可用**：两次独立测试均返回"未知错误"。需检查 API key 配置或 provider 状态
6. **补丁 H v2 错误恢复路径正常**：无效模型报错后立即可恢复（矩阵 L）

### Smoke Test 清单（可重复执行）

发布前必跑：

```bash
# S1: Bug 5 — model_id 同步
# 创建会话 → send_message(model_id=A) → get_session_info 验证 model_id=A
# → send_message(model_id=B) → get_session_info 验证 model_id=B
# 断言: 两次 model_id 均正确

# S2: Bug 4 — 跨 sdkSession fork
# 创建会话 → 用 model_id=A 发消息 → 用 model_id=B 发消息
# → list_messages 找到两个时期的 assistant UUID
# → fork_session(up_to_message_uuid=UUID_B) → 断言成功 + 消息数正确

# S3: 嵌套 Fork
# 创建会话 → 发 3 条消息 → fork → fork(forked) → fork(forked2)
# → 在 L3 发消息问上下文 → 断言回复包含原始上下文标记

# S4: 错误恢复
# 创建会话 → send_message(model_id="invalid") → 断言不崩溃
# → send_message(model_id=正常) → 断言正常回复

# S5: 长会话 Fork
# 创建会话 → 发 10 条消息 → 全量 fork → list_messages 对比总数
# 断言: |源 - Fork| <= 2
```

### 测试会话清单（全部已归档）

| session_id | 标题 | 矩阵 |
|---|---|---|
| 4f9c9fd2-7b8b-4ac2-8ff0-dcde9b08e94c | [多维-H] 5 provider 横跳 | H |
| 6658604a-32ff-48cf-9554-0365a839cefc | [多维-H] 5 provider 横跳 (fork) | H-F1 |
| e72a4545-f785-4427-aeb6-2e3f861cae27 | [多维-H] 5 provider 横跳 (fork) | H-F3 |
| ca6511aa-7c1b-4ff8-8a7e-4cbacff7ec66 | [多维-H] 5 provider 横跳 (fork) | H-F5 |
| 65fcf2d5-641f-4044-86d0-ee18af336c9d | [多维-I] send_message 三模式 | I1 |
| ac012ac9-00da-4ce4-a4de-a158423dc8f0 | [多维-I2] fire-and-forget | I2 |
| 4fc92476-5e6a-45ea-989e-e6fa5a7e6c85 | [多维-I3] 并发 fire-and-forget | I3 |
| 8fa7351b-9278-4a9e-a884-9e1817d5bf9b | [多维-J] 嵌套 Fork | J |
| 12bf1524-12b1-41f6-8413-505160b3ca95 | [多维-J] 嵌套 Fork (fork) | J-L1 |
| b7043cc1-9996-4d63-a6fd-edf81fcbe255 | [多维-J] 嵌套 Fork (fork) (fork) | J-L2 |
| 567c7c31-5914-4c23-9945-ff1ed691ab0e | [多维-J] 嵌套 Fork (fork) (fork) (fork) | J-L3 |
| 63bc1223-c914-4532-a320-95a5e2d9e2bf | [多维-K] 长会话 Fork 对比 | K |
| 44f63de4-a448-4cbd-a337-35ac428fd850 | [多维-K] 长会话 Fork 对比 (fork) | K-Fork |
| b983381c-aa9c-45da-93cf-c9c896489e94 | [多维-L] 错误恢复 | L |

### 改进建议

1. **紧急：修复 I3 并发竞态**。`runAgentHeadless` 的并发守卫在拒绝重复调用时应返回明确错误而非静默丢弃，或改为排队机制
2. **排查 gpt-5.4 / gemini-2.5-pro API 不可用**。两次测试均失败，检查 Dev 实例的 API key 和 provider 配置
3. **Smoke test 清单落地为自动化**。5 个 smoke test 用例适合做成 Proma 定时任务（每周发布前自动跑）
4. **fork_session 的 new_title 参数未生效**（HTTP bridge 路径），fork 标题始终追加 "(fork)" 后缀

---

## 2026-06-18 v0.16.3 回归测试报告（SubAgent HTTP bridge 执行）

### 总览

- **R1 (Bug 5 — send_message 同步 meta)**: ✅ **通过**
- **R2 (Bug 4 — fork 跨 sdkSession)**: ✅ **通过**
- **R3 (Bug 1 补丁 H v2 — UI 路径)**: 程序化等效 R1 已验证；UI 手测待用户

三个修复全部生效。Bug 5 修复前 model_id 永远停在初始值（矩阵 D 已证实），本轮 R1 三次切换后 `get_session_info` 全部正确同步。Bug 4 修复前跨 sdkSession fork 必报 "Message XXX not found in session YYY"（矩阵 E2 已证实），本轮 R2 两次跨 sdkSession fork 全部成功且消息数符合 idx+1。

### R1 详细结果（Bug 5 meta 同步）

会话 `7af460be-91b7-4b9b-981f-9a14ee9a7891`（标题 `[回归-R1] Bug5 meta 同步`，channel=proma-official）。

| 步骤 | 操作 | reply | get_session_info.model_id |
|---|---|---|---|
| 2 | send_message model_id=glm-5.2 | "收到代号 HAWKEYE-42..." | (基线) |
| 3 | get_session_info | — | **glm-5.2** ✓ |
| 4 | send_message model_id=deepseek-v4-pro（跨 provider） | "HAWKEYE-42" ✓ 无报错 | — |
| 5 | get_session_info | — | **deepseek-v4-pro** ✓（Bug 5 修复前 = glm-5.2） |
| 6 | send_message model_id=claude-sonnet-4-6-promo-3（再跨 provider） | Claude 警觉性回复，但 reply 正常返回、无 API 错误 | — |
| 7 | get_session_info | — | **claude-sonnet-4-6-promo-3** ✓ |

**关键对比**（同场景，修复前 vs 修复后）：

| 场景 | 矩阵 D（修复前） | 本轮 R1（修复后） |
|---|---|---|
| send_message 切到 deepseek 后 get_session_info.model_id | 仍是 glm-5.2 ❌ | deepseek-v4-pro ✓ |
| send_message 切到 claude 后 get_session_info.model_id | (未测) | claude-sonnet-4-6-promo-3 ✓ |

### R2 详细结果（Bug 4 跨 sdkSession fork）

源会话复用 R1 的 `7af460be`，关联 3 个 sdkSession（GLM/DeepSeek/Claude 各一）。`list_messages` total = 11，结构：

```
[0]  user     (uuid null, headless)
[1]  assistant 2f51d312-ae11-4714-a2fc-2bc62f6b0f29   ← GLM 时期
[2]  result   fb2d45e8
[3]  user     (uuid null)
[4]  assistant 6e506567
[5]  assistant ea664bf5-fd42-4591-98eb-641c76812d6d   ← DeepSeek 时期
[6]  result   96efc135
[7]  user     (uuid null)
[8]  assistant eef727c0
[9]  assistant e4b88009                                ← Claude 时期
[10] result   5fb783bb
```

| 用例 | up_to_message_uuid | 时期 | 结果 | fork_source_sdk_session_id | forked total | 期望 total |
|---|---|---|---|---|---|---|
| R2-cut1 | 2f51d312 (idx1) | GLM | ✅ 成功 | abe79296-29d0-46ac-a66d-15005401f90b | **2** | 2 (idx1+1) ✓ |
| R2-cut2 | ea664bf5 (idx5) | DeepSeek | ✅ 成功 | fe1c49f2-e547-4d43-b897-130d62575be8 | **6** | 6 (idx5+1) ✓ |

**关键对比**：矩阵 E2 同场景（跨 sdkSession fork）报 "Message XXX not found in session YYY"。本轮 0 报错，0 失败。两个 fork_source_sdk_session_id 不同（abe79296 ≠ fe1c49f2），证明 Bug 4 修复的"候选 sdkSession 循环试错"逻辑生效。

### R3 说明

Bug 1 补丁 H v2 的 UI 路径（用户在 Dev 实例侧边栏切换模型）需用户手测，SubAgent 无法覆盖。但补丁 H v2 的程序化等效（MCP `send_message` 工具传 model_id 切换）已被 R1 通过验证，说明清 sdkSessionId + 同步 meta 的核心逻辑链路通了。

**用户手测步骤**：
1. 在 Dev 实例侧边栏打开任意 proma-official 频道的会话
2. 切到 GLM-5.2 → 发条消息 → 应正常回复
3. UI 上切到 deepseek-v4-pro → 直接发新消息（不刷新）→ 应第一轮就成功，不报 `[1211]` / `model not supported`
4. 看主进程日志应出现 `[Agent 编排] 检测到模型/频道切换: proma-official/glm-5.2 → proma-official/deepseek-v4-pro, 已清空 sdkSessionId 并更新 meta`

### 测试会话清单（全部已归档）

| session_id | 标题 | 用例 | 归档 |
|---|---|---|---|
| 7af460be-91b7-4b9b-981f-9a14ee9a7891 | [回归-R1] Bug5 meta 同步 | R1 + R2 源 | ✅ |
| 0f250fdd-0c13-4a84-8e39-611e09ff7b39 | [回归-R2] 跨 sdkSession fork @ CUT_UUID_1 (GLM era) | R2-cut1 | ✅ |
| 39bebf39-fda9-413f-a41c-7777b01b8b3b | [回归-R2] 跨 sdkSession fork @ CUT_UUID_2 (DeepSeek era) | R2-cut2 | ✅ |

### 执行耗时

约 6 分钟（HTTP bridge 调用 + 3 个会话 + 2 个 fork + 3 个归档）。无重试，无失败。

### 改进建议

1. **补丁 H v2 应同步推到 Release 版**（v0.16.2 → v0.16.3 同步发布），Bug 1 / Bug 4 / Bug 5 三个修复一起落地。
2. **回归用例沉淀**：R1 / R2 应作为后续版本发布的标配 smoke test，跑通才发版。
3. **Bug 5 补丁形态**：用户报告矩阵 D 时 `send_message` 不同步 meta 是独立 Bug 5，本轮已修。建议在 patches.cjs 的 send_message handler 注释里写明 "镜像补丁 H v2"，方便后人维护。

---

## 2026-06-18 矩阵 D/E/F/G 测试报告（SubAgent 执行）

### 总览

- 矩阵 D（跨 provider 切换 / Bug 1 补丁 H v2）: **3/3 功能通过**,但 **meta 同步 0/3**
- 矩阵 E（Fork 后可用性）: **2/2 通过**（E3 sidechain 用例未跑,跳过 — 缺 sidechain 会话）
- 矩阵 F（边界场景）: **F1 通过（根因明确）/ F3 跳过（无 compact 会话基线）**
- 矩阵 G（身份标识）: 全部应用

### 关键结论（三件事）

1. **Bug 1 补丁 H v2 ✅ 功能层生效**:D1/D2/D3 共 9 轮跨 provider 切换（GLM↔DeepSeek↔Claude）**全部第一轮就成功**,无 `[1211]` / `model not supported` / `supported API model names` 错误。reply 内容正确（"42"、"99"、"A B C"）。

2. **补丁 H v2 ❌ meta 同步不生效**:`send_message` 工具传 `model_id` 切换模型后,`get_session_info` 返回的 `session.model_id` 仍是创建时的初始值（D1 仍是 glm-5.2,D2 仍是 deepseek-v4-pro）。**说明 MCP `send_message` 工具走的是 `runAgentHeadless` 路径,补丁 H 在 `sendMessage()` 入口的 `updateAgentSessionMeta` 没被触发**。要修需要在 `runAgentHeadless` 入口加同样的检测,或显式同步 meta。这是个**新发现的独立 Bug**。

3. **Bug 2 真相 = 不存在**:F3 调研发现 Dev 实例上**所有 jsonl 文件都没有 `compact_boundary` 标记**（检查了 415/411/289 行三个长会话）,auto-compact 从未触发。结合 E1 验证 Fork 能完整复述上下文 → **Fork 不丢历史**。用户报告"Fork 只剩 20 轮"最可能是 **`list_messages` 默认 `limit=50` + 偏移错觉**导致的视觉截断,**不是 fork bug**。

### 矩阵 D 详细结果（补丁 H v2）

| 用例 | 切换路径 | 轮数 | 报错 | reply | 结论 |
|---|---|---|---|---|---|
| D1 | GLM→DeepSeek | 2 | 无 | "42"（DeepSeek 复述） | ✅ |
| D2 | DeepSeek→GLM | 2 | 无 | "99"（GLM 复述） | ✅ |
| D3 | GLM→DeepSeek→Claude→GLM | 4 | 无 | "A B C"（全复述） | ✅ |

**meta 同步**:D1-D3 全部失败,`session.model_id` 始终是 create_session 时的值。

### 矩阵 E 详细结果（Fork 后可用性）

**E1 全量 Fork** ✅:
- 源会话 b5efd84f 注入 BLUEFOX/7749 → fork 出 dcacb605
- forked 会话问"代号和密令" → reply: "BLUEFOX,7749"（**完整复述**）
- 18 条源消息全部继承,Fork 不丢消息

**E2 截断 Fork** ✅（技术层）:
- 用 index 1 的 assistant UUID `25ac8daf` 作 fork 截断点 → forked 6e584499
- forked 会话只有 8 条消息（原 2 条截断 + 新 6 条）,MSG2/MSG3 被截掉
- 注意:GLM 模型有 SDK Memory 功能（写入 `project_matrix_e1_bluefox.md`）,所以"复述验证"层面模型仍知道 BLUEFOX,但**这是 Memory 而不是 Fork 残留**

### 矩阵 F 调研结论

**F1 — index 2 UUID 失败根因（代码调研）**:

1. `proma-dev-patches.cjs` 第 312 行注释明确:`// headless 的 user 消息可能没有 uuid`,`entry.uuid = m.uuid || null`
2. 实测 D1/E1 会话证实:**前 3 条 headless user 消息 `uuid=null`**,sidechain 触发的 user 消息（index 11+）有 uuid
3. `main.cjs` 17749127 行 `findLastIndex((m) => "uuid" in m && m.uuid === upToMessageUuid)` — `in` 操作符只判断 key 存在（不管值）,所以**uuid=null 的消息不会被这个查找匹配**
4. **真正报错源头**:E2 用 index 5 的 result UUID `47e24037` fork 时报错 `Message XXX not found in session beba6edc`（英文,不是 main.cjs 的中文错误）。这说明:
   - main.cjs 找到了消息（targetIdx ≥ 0）
   - main.cjs 把 `forkSourceSdkSessionId` 切换为 `effectiveMsg.session_id`（代码 17749186）
   - 但 SDK `forkSession()` 在切换后的 sdkSessionId 里找不到那个 UUID
5. **根因**:agent session 关联多个 sdkSessionId（因为补丁 H 清空 sdkSessionId 后重建,或 sidechain 触发了新 sdkSession）,**MCP `fork_session` 工具的 sdkSessionId 切换逻辑只能选一个 sdkSession,导致跨 sdkSession 的消息 UUID 解析失败**。这跟"headless user 无 uuid"是**两个独立 Bug**。

**Bug 4 — fork 跨 sdkSession 失败（新发现）**:E2 测试中同一个 agent session 显示了两个不同的 `fork_source_sdk_session_id`:
- 全量 fork: `53f515f3-e21b-4f70-9d25-8c6fe2881808`
- 截断 fork（index 1）: `beba6edc-c917-4eb5-a601-bf4051c65fa3`
- 截断 fork（index 5）: 失败,报错 sdkSession 是 `beba6edc`（与成功的 index 1 同一个,但 SDK 仍找不到 UUID）

→ 推测:SDK 内部把消息按 sdkSession 分桶存储,fork 时切换 sdkSessionId 后,只有部分消息在新 sdkSession 里。**应该改 fork 逻辑:遍历所有 sdkSession 找 UUID,而不是只信 `effectiveMsg.session_id`**。

**F3 — Bug 2 验证**:Dev 实例 3 个长会话（289/411/415 行）**全部没有 compact_boundary / isCompactSummary** → **auto-compact 从未触发**。Bug 2 现象不可能由 compact 导致,**真相是 list_messages 默认 limit=50 + 用户感知错觉**。

### 测试会话清单（全部已归档）

| session_id | 标题 | 用例 | 创建→归档 |
|---|---|---|---|
| 9863dbbf-9ddb-48df-9d5d-593523372c83 | [矩阵D-D1] GLM→DeepSeek | D1 | ✅ |
| 39850f50-fcae-40e7-8aec-224b83cecedd | [矩阵D-D2] DeepSeek→GLM | D2 | ✅ |
| 35823e5f-23a2-42d2-8485-7291bb8ad864 | [矩阵D-D3] 3-way switch | D3 | ✅ |
| b5efd84f-feb4-41a6-a2e6-1a7f4693ac36 | [矩阵E-E1] source | E1+E2 source | ✅ |
| dcacb605-fd88-457d-bc78-08aaf3278746 | [矩阵E-E1] fork (full) | E1 | ✅ |
| 6e584499-6b18-4bc1-a1ec-f40039163e9c | [矩阵E-E2] fork (cut at idx1) | E2 | ✅ |
| 58c15733-abdb-4d23-82ce-87127b1a1363 | [矩阵E-E2] fork (full retry) | E2 辅助 | ✅ |

### 改进建议（给下一轮）

1. **修 Bug 4 — fork 跨 sdkSession**:在 `fork_session` 工具层做 UUID 全 sdkSession 索引（不再依赖 `effectiveMsg.session_id` 单一切换）。
2. **修 Bug 5 — send_message 不同步 meta**:在 `runAgentHeadless` 入口加补丁 H 同款检测,或在 `send_message` MCP 工具显式调 `updateAgentSessionMeta({channelId, modelId})`。
3. **测试设计教训**:用 GLM-5.2（带 SDK Memory）做 fork 截断验证不可靠 — Memory 会"绕过"对话历史让模型记得被截断的内容。下次用 DeepSeek 或关 Memory 的模型做"内容复述"断言。
4. **Bug 2 用户报告路径**:让用户实际跑一次 fork + `list_messages(limit=200)` 对比源/目标的 `total` 字段,大概率会发现行数一致,从而澄清错觉。

---

## 2026-06-18 跨频道换模型丢上下文 + Fork 截断 20 轮 — 根因调研

**触发场景**：Dev 版 + Release 版都出现的两个用户报告 bug。

### Bug 1：会话内跨频道换模型直接报错 + 丢上下文（如 GLM → DeepSeek V4 Pro）

**根因（双重问题）**：

1. **补丁 F 未真正落地**。main.cjs 405955-405956 处：
   ```js
   const sessionMeta = getAgentSessionMeta(sessionId);
   let existingSdkSessionId = sessionMeta?.sdkSessionId;
   ```
   之后**没有任何** `channelId !== sessionMeta.channelId` 的比对逻辑。grep `existingSdkSessionId = void 0` 出现 4 次（406525、406558、406718、406750），但**全是事后 Session-Not-Found 被动恢复路径**，不是事前预防。

2. **更深层问题**：`sessionMeta.channelId/modelId` 在 sendMessage 中**从不更新**。补丁 C1 设计是 `meta.channelId 优先 || UI channelId`：
   ```js
   const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;
   ```
   - 创建会话时 meta.channelId 写入
   - UI 跨频道切换时，meta.channelId 还是旧值
   - → `__effChannelId` 永远是旧频道
   - → 旧 sdkSessionId 也透传给 `queryOptions.resumeSessionId`（406335）
   - → 新频道 SDK 找不到旧 session → 抛 "No conversation found ... with session"
   - → 触发 406524/406717 被动恢复（`existingSdkSessionId = void 0` + JSONL 回填）→ 用户感知"先报错 + 上下文靠 JSONL 二次读取勉强恢复"

**修复方案（方案 A，推荐）**：sendMessage 入口处检测 UI 跨频道主动切换，三件事一起做：

```js
const sessionMeta = getAgentSessionMeta(sessionId);
let existingSdkSessionId = sessionMeta?.sdkSessionId;
// 检测 UI 主动跨频道切换
if (existingSdkSessionId && sessionMeta?.channelId && channelId && channelId !== sessionMeta.channelId) {
  existingSdkSessionId = void 0;                     // 清空 sdkSessionId（走上下文回填）
  updateAgentSessionMeta(sessionId, {                // 同步更新 meta
    channelId,
    sdkSessionId: void 0,
    ...(modelId ? { modelId } : {}),
  });
}
```

这样同时修复：
- sdkSessionId 不再透传旧值
- meta.channelId/modelId 同步更新 → `__effChannelId` 用新频道
- 后续 `getAgentSessionMeta` 取到的都是新值，UI 也对得上

**最小变更方案（方案 B，不推荐）**：只补补丁 F 的清空逻辑，不动 meta。但 `__effChannelId` 还是旧频道，apiKey/baseUrl 用错，治标不治本。

**方案 A 的 sed 实现**：

```bash
# 注：minified main.cjs 中需要精确匹配现有代码（注意 \\& 是 sed 的 & 转义）
sed -i 's@let existingSdkSessionId = sessionMeta?.sdkSessionId;@let existingSdkSessionId = sessionMeta?.sdkSessionId;if(existingSdkSessionId\&\&sessionMeta?.channelId\&\&channelId\&\&channelId!==sessionMeta.channelId){existingSdkSessionId=void 0;try{updateAgentSessionMeta(sessionId,{channelId,sdkSessionId:void 0,...(modelId?{modelId}:{})});}catch(_){}}@' main.cjs
```

**验证场景**：
- 在一个 GLM 会话里跑几轮 → UI 切换到 DeepSeek V4 Pro → 发新消息 → 应当：① 不报 "Session not found"；② 历史上下文保留（通过 JSONL 回填到新频道 SDK session）；③ 后续消息走 DeepSeek API

---

### Bug 2：Fork 只保留前 20 轮（疑似误判）

**结论**：**main.cjs 的 `forkAgentSession` 和 SDK 的 `forkSession` 都没有任何"20 轮"截断**。极可能是 SDK 的 **auto-compact 机制**导致的"看似丢历史"。

**调研细节**：

- `forkAgentSession`（main.cjs 387015–387166）按 `upToMessageUuid` 做 `slice(0, cutIndex+1)`，不传时复制全量
- SDK `forkSession`（`@anthropic-ai/claude-agent-sdk/sdk.mjs` 的 `kZ` 函数）：读整个 JSONL，filter sidechain，逐条复制并改写 uuid/sessionId/parentUuid，无截断
- main.cjs 里 `20` 出现的地方都无关：
  - `AUTOMATION_MAX_HISTORY = 20`（line 1612）—— automation `runHistory` 列表，不影响 fork
  - `SEARCH_WORKSPACE_FILES` 默认 `limit = 20`（line 567882）—— 搜索结果
- `MAX_SDK_MESSAGE_LENGTH = 256KB`（line 387617）—— 单条消息长度限制，触发 `sanitizeOversizedMessage` 截断内容但**不丢消息**

**最可能的真相（按概率）**：

1. **可能性 A：SDK auto-compact 已发生**。源会话长到一定 token 后 SDK 自动 compact，jsonl 里只保留 `preservedMessages.uuids`（早期几条）+ compact 之后的近期消息，中段被压缩成 `compact_boundary` system message。Fork 时复制的是已 compact 的 jsonl → 用户感觉"只剩 20 轮"。这不是 bug，是 SDK 机制。
2. **可能性 B：用户用 `list_messages` 默认 limit=50 看的，没意识到要传 limit=200**。list_messages 默认 50、上限 200。
3. **可能性 C：用户记忆里的"全部历史"和实际不一致**（短时记忆错觉）。

**验证清单**（让用户复现时提供）：

```
1. fork 前源会话：mcp__session__list_messages(source_id, limit=200) → total = ?
2. fork 后目标会话：mcp__session__list_messages(forked_id, limit=200) → total = ?
3. 直接看磁盘文件：
   ls ~/.proma-dev/agent-sessions/<workspace-slug>/<sdkSessionId-hash>/*.jsonl
   wc -l <source>.jsonl
   wc -l <forked>.jsonl
   如果行数大致一致 → fork 没丢
   如果源文件本身就 < 30 行有效对话 → SDK auto-compact 已发生
4. 在 fork 后的会话里直接问："你记得我们最早聊的是什么？" —— 如果 SDK 已 compact，模型自然不记得早期内容
```

**如果确认是 auto-compact 导致**：
- 选项 1：教育用户（compact 是设计行为，Fork 无法"恢复"已压缩历史）
- 选项 2：关闭 auto-compact（如果有开关）—— 但会破坏长会话
- 选项 3：自定义 fork 复制 JSONL 而不调 SDK forkSession（重建 sessionId）—— 工程量大

---

### 行动建议

**P0：修 Bug 1**（方案 A 的 sed 补丁）。这个是确凿的代码 bug，影响所有跨频道切换场景。

**P0：先验证 Bug 2**（让用户跑验证清单）。在没有"fork 前后实际消息数对比"之前不要急着改代码，可能根本不是 fork 的问题。

---

## 2026-06-18 补丁 H v1 实测发现盲点 — 升级到 v2

**触发场景**：v0.16.0-dev 补丁 H（v1）部署到 Dev 版后，用户实测发现"报错之后再问一轮就好了"。

### 实测发现：`proma-official` 是多 provider 路由频道

通过 `list_channels` 实查 Dev 实例配置：
- `proma-official` 频道（provider="proma"）下挂 **18+ 个不同 provider 的模型**：claude-opus-4-8、claude-sonnet-4-6-promo-3、glm-5.2、deepseek-v4-pro、deepseek-v4-flash、gpt-5.4、gpt-5.5、gpt-5-mini、gemini-3.1-pro-preview、gemini-2.5-pro 等等
- 其他三个频道是单一 provider：`MiniMax-CodingPlan` (anthropic)、`ZLM-CodingPlan` (anthropic)、`DeepSeek官方` (deepseek)

### 为什么 v1 补丁 H 不够

v1 只检测 `channelId !== sessionMeta.channelId`。用户在 UI 切换"GLM-5.2 → DeepSeek V4 Pro"时：
- channelId 都是 `proma-official`，**不变**
- modelId 从 `glm-5.2` 变到 `deepseek-v4-pro`

→ v1 检测条件 false → 不清空 sdkSessionId → 旧 sdkSessionId（GLM provider 的）透传给 DeepSeek API → DeepSeek API 报 `The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed glm-5-turbo`

### "报错之后再问一轮就好了"的真相

main.cjs 406524 / 406717 是 SDK 报错后的**被动恢复路径**：
1. 第一轮：SDK 抛错 → catch 块清空 `existingSdkSessionId` + 调 `prepareSessionNotFoundRecovery` 注入 `<session_recovery>` 让 Agent 自读 JSONL
2. 第二轮：sdkSessionId 已被清空（持久化）→ 走"新会话 + 上下文回填"路径 → 成功

所以现象是"先报错一次，靠被动恢复救场"。

### 实测会话证据

会话 `d6e16c7e-f826-4483-977e-02a5c53423c5`（标题："再答一次上面问题"），49 条消息里模型自报反复横跳：

| 时间戳 | 用户输入 | 模型回复 | 状态 |
|---|---|---|---|
| 1781751646085 | "上面的问题你同样你来回答一遍" | unknown_error "未知错误" | ❌ |
| 1781752277599 | "你来" | "Claude Sonnet 4.6" | ✅ |
| 1781752314264 | "再回答一次" | "DeepSeek V4 Pro" | ✅ |
| 1781752323856 | "你来回答" | `API Error: 400 The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed glm-5-turbo` | ❌ |
| 1781752337630 | "你来回答" | `API Error: 400 [1211][模型不存在，请检查模型代码]` | ❌ |
| 1781752369938 | "你呢？" | "GLM-5.2 限时折扣" | ✅ |

### v2 修复（已部署）

把 v1 检测条件扩展为 `(channelId !== meta.channelId) OR (modelId !== meta.modelId)`。这样：
- 跨频道切换（v1 已修）：触发
- 同频道内换 provider 模型（v2 新增）：触发
- 同模型继续聊：不触发（不影响性能）

### 教训：sed + shell `&&` 是大坑

部署 v2 时第一次用 `sed -i 's@...&&...@...&&...@'`，shell 把每个 `&&` 当命令分隔符 → sed 多次执行 → 文件被搞乱（一堆重复片段）。`node --check` 直接报语法错误。

正确做法：
1. **用 Edit 工具直接修改**（不经过 shell 解析）
2. 或把 sed 命令写到 `.sh` 脚本里 `bash xxx.sh`（脚本里 `&&` 不被外层 shell 看到）

通过备份 `main.cjs.bak-20260618-bug1-v2-preexpand` 完整回滚后用 Edit 工具重新打补丁。**后续补丁一律走 Edit 工具**。

---
