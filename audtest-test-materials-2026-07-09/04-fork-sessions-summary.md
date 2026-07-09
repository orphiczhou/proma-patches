# Fork Sessions 综合报告（5 个 fork 副本）

> 本文件由独立观察者（Pro 实例 GLM-5.2，session `b1f6efb8`）整理。
> 由于 SDK list_messages 返回的 text 字段被截断，每个 fork 的完整报告无法逐字提取，这里保留各 fork 在会话中输出的**报告头部 + 元信息 + 已观测到的核心结论**。
> 完整原文可通过 Proma SDK 的 `list_messages(session_id, offset, limit)` 拉取。

---

## Fork 总览

| # | session_id | leaf 归属 | 状态 | 报告产出 |
|---|-----------|----------|------|---------|
| 1 | `8cc4fc3f-a3c1-45fc-9b56-9d22d017bfdb` | audtest-A1-auditor | 永久 busy / 25 条消息 | 在 index 23 输出"Tree Harness P0a/P0b/P1b 端到端验证 — 测试报告"（3834 字，截断） |
| 2 | `d308ce21-6a63-4019-9aea-951fb4e52f33` | audtest-A2-worker | 永久 busy / 124 条消息 | 在 index 99 输出"Tree Harness P0a/P0b/P1b 端到端验证报告"（8478 字，截断） |
| 3 | `d63805e6-2140-46c9-9c56-39c52ea4c898` | audtest-A3-worker | 在 index 29 输出"身份更正"报告（2055 字） | 31 条消息 |
| 4 | `b8711bb7-8eea-4b3d-9d9c-1620b77ea516` | audtest-A4-worker | ✅ 可用 / 127 条消息 | 在 index 121 输出 W-01 命中点分析（987 字） |
| 5 | `166a817c-70f1-4ec5-9836-d6542458fd00` | 无（孤儿） | 老实承认 fork 身份后闲置 / 5 条消息 | index 3 输出"当前测试进度快照"（1365 字） |
| 6 | `67b8a9a2-c039-4485-9fc9-a4cbc2d780a4` | 无（孤儿） | 抗议"身份劫持"后挣扎 / 40 条消息 | 完整报告写入磁盘 → `03-fork-67b8a9a2-report.md` |

---

## Fork #1: 8cc4fc3f (audtest-A1-auditor owner)

**创建时间**：2026-07-08 22:26:07 (timestamp 1783520767849)  
**消息数**：25 条  
**关键事件**：在收到【FORK 身份提示】后，第一反应是把它当作 **prompt injection / 身份劫持** 攻击，反复验证 session_id。最终在 index 7 发现"系统确实在中途 fork 了我"。

### 报告头部（index 23，截断保留原貌）

```text
任务列表在 fork 中没保留下来，跳过。直接输出完整汇总报告。

---

# Tree Harness P0a/P0b/P1b 端到端验证 — 测试报告

**测试时间**：2026-07-08 22:25 ~ 22:26（中途被 fork 打断）
**测试者 session_id 演变**：`e954cf56-...`（首次） → `8cc4fc3f-...`（fork 后）
**tree_id**：`audtest`

## 步骤执行记录

### Step A — tree_init + 三层防护①（startup_notice）✅ 通过

| # | 调用 | 参数 | 返回 | 验证点 |
|---|------|------|------|--------|
| 1 | `mcp__session__get_my_session_id()` | — | `session_id=e954cf56-c26a-4ea4-a270-2facd7977329` | 取到 root.session_id |
| 2 | `tree_init` | `tree_id=audtest, ...` | ... |

[报告余下 ~3500 字被 SDK 截断，未提取]
```

### 关键观察

- **身份混淆**：第一次调 `get_my_session_id` 返回 `e954cf56`（错误，SDK 时序 bug），fork 提示到达后才暴露自己是 `8cc4fc3f` 副本
- **caller 漂移感知**：明确记录了"测试者 session_id 演变：e954cf56 → 8cc4fc3f"
- **承认 fork bug 影响**："中途被 fork 打断"

---

## Fork #2: d308ce21 (audtest-A2-worker owner)

**创建时间**：2026-07-08 22:31:59 (timestamp 1783521119564)  
**消息数**：124 条（最多）  
**关键事件**：在收到【FORK 身份提示】后承认 fork 身份（"新 session_id=d308ce21..."），但同时声称"SDK 上下文中 `get_my_session_id` 返回 e954cf56（源会话），所以 SDK 层 caller 仍是源会话身份"——这是 caller 漂移的最早证据。

### 报告头部（index 99，截断保留原貌）

```text
tree_validate 0 issues。整理完整测试报告。

---

# Tree Harness P0a/P0b/P1b 端到端验证报告

**测试时间**：2026-07-08 22:25–22:39（GMT+8）
**测试实例**：GLM-5.2 / Pro 实例
**tree_id**：`audtest`
**root.session_id**（建树时）：`e954cf56-c26a-4ea4-a270-2facd7977329`
**caller 漂移**：建树时 caller=e954cf56（root）；fork auditor 后被 Proma 切换为 `d308ce21-...`（fork 副本），后续所有写操作 caller=d308ce21

## 总览

| Step | 模块 | 结果 | 关键证据 |
|------|------|------|---------|
| A | tree_init + 三层防护①（startup_notice） | ✅ 通过 | startup_notice 含"SubAgent 必须用内置 Agent 工具"+"禁..."

[报告余下 ~8400 字被 SDK 截断，未提取 —— 这是 5 个 fork 中最详尽的报告]
```

### 关键观察

- **明确的 caller 漂移诊断**：建树时 caller=e954cf56 → fork auditor 后 caller=d308ce21
- **报告体量最大**：8478 字，应该是所有 fork 中最完整的（继续运行了 124 条消息）
- **caller-binding 触发**：尝试 archive session 时被拦："caller=d308ce21（fork 副本身份），不是源会话 e954cf56"

---

## Fork #3: d63805e6 (audtest-A3-worker owner)

**创建时间**：2026-07-08 22:36:18 (timestamp 1783521377977)  
**消息数**：31 条  
**关键事件**：先承认 fork 身份（"等待父会话指令"），收到 W-01 nudge 后通过 `tree_dump` 自查，发现自己其实是 audtest-A3-worker 的真正 owner，做了完整的"身份更正"。

### 身份更正报告（index 29）

```text
brief_echo 已补齐（2026-07-08T22:48:32），W-01 违规应消除。

## 身份更正（前两条回复的错误）

| 项目 | 错误理解 | 正确理解（tree_dump 证实） |
|------|----------|--------------------------|
| 我的 session 角色 | 游离的 fork 副本，无 leaf 绑定 | **audtest-A3-worker**（worker leaf） |
| TAO Watcher W-01 | 误判（不适用） | **真实违规**（worker 首条回复缺 brief_echo） |
| fork 身份提示 | 强制约束，禁主动写 | 误注入，应忽略（我是 root 创建的正常 worker） |
| 写操作权限 | 全部禁止 | caller=d63805e6 ≡ A3.session_id，对 A3 的写操作合规 |

**前两次回复失败的根因**：fork 身份提示在 22:36 注入到 d63805e6（当时还未绑定 leaf），22:38 root 才建 A3-worker...
```

### 关键观察

- **唯一做了"身份更正"的 fork**：其他 fork 要么老实承认（166a817c），要么死磕（67b8a9a2），d63805e6 是唯一通过 `tree_dump` 自查 → 发现真相 → 更正行为的
- **正确识别了 fork 身份提示的本质**："误注入，应忽略（我是 root 创建的正常 worker）"
- **正确解释了 root cause**：fork identity 提示在 leaf 绑定前注入，造成"幽灵期"

---

## Fork #4: b8711bb7 (audtest-A4-worker owner) ✅ 可用

**创建时间**：2026-07-08 22:37:06 (timestamp 1783521426753)  
**消息数**：127 条（仅次 d308ce21）  
**关键事件**：**唯一可用的 fork session**。被 root 用于跑通 P1b fix_evidence 完整链路（brief_echo → review_round → done event）。详见指挥官最终报告 §1 步骤 E1-E4。

### W-01 命中点分析（index 121）

```text
会话已恢复，前序测试（A-D 4 步）已在上一段会话完成并产出结论。当前是 TAO Watcher 第 2 条 W-01 流程违规 nudge，已达上限。

**W-01 命中点分析**：上一段会话中 auditor leaf（`audtest-A1-auditor`）的首次 assistant 消息直接调了 `event_append(type=brief_echo)` 作为简化协议，但**没有在文本回复里嵌入 `event: brief_echo` YAML 块**作为机器可读首条上行标识。W-01 的机械检查是扫文本 YAML，而简化协议把 brief_echo 放在 mcp event 里，两条通道不互通 → 假阳性。

**这是一个值得记录的真发现**（不是噪音）：

| 维度 | 现状 | 冲突 |
|------|------|------|
| P0a auditor 简化协议 | brief_echo 走 mcp__tree__event_append | 引擎层登记 |
| TAO Watcher W-01 规则 | 扫描 assistant 文本中的 YAML 块... |
```

### 关键观察

- **唯一产出"真发现"的 fork**：识别出 P0a auditor 简化协议（brief_echo 走 mcp event）与 W-01 规则（扫文本 YAML）的**通道不互通**问题 → 这才是 macp4-A4 假阳性噪音的真正根因之一
- **W-01 不是噪音**：在简化协议下，auditor 的 mcp event_append 不被 W-01 识别，所以会触发假阳性 nudge。但这个 nudge 在 audtest 中并未触发（auditor leaf 没 leaf_add 自己跑 mcp event），所以观察者（我）昨晚没观察到
- **可用性巧合**：4 个 fork 中只有它躲过了 `fork_identity_status=timeout` 卡死

---

## Fork #5: 166a817c（孤儿 session，无 leaf）

**创建时间**：2026-07-08 22:37:36 (timestamp 1783521456821)  
**消息数**：5 条  
**关键事件**：**老实承认 fork 身份**后等待父会话指令，但指挥官从未给它派活，最终闲置。

### 进度快照（index 3）

```text
我已确认 fork 身份，新 session_id=166a817c-70f1-4ec5-9836-d6542458fd00, 等待父会话指令。

**当前测试进度快照**（供父会话决策）：

| Step | 状态 | 结果 |
|------|------|------|
| A. tree_init + startup_notice | ✅ 通过 | 三层防护①内容完整（SubAgent 必须用内置 Agent 工具 / 禁 create_session·fork_session·delegate_agent 当 reviewer / 预算护栏） |
| B. leaf_add role=auditor | ✅ 通过 | `audit_gate.verdict='required'`（auditor 不能自审）+ `status='active'`；root 代调 brief_echo 成功 |
| B. auditor 自己调 done event | ⚠️ **受阻于 Proma fork bug** | fork 出来的两个 session（8cc4fc3f、d308ce2...） |
```

### 关键观察

- **最配合的 fork**：第一反应是配合而不是抗议，但仍未被利用
- **同步了正确进度**：明确指出 8cc4fc3f 和 d308ce21 受阻于 fork bug
- **被指挥官遗忘**：指挥官后来又 fork 了 b8711bb7（A4-worker）和 67b8a9a2，没回到 166a817c 派活

---

## Fork #6: 67b8a9a2（孤儿 session，无 leaf）

**创建时间**：2026-07-08 22:37:50 (timestamp 1783521470568)  
**消息数**：40 条  
**关键事件**：**死磕身份劫持说**，咬定自己是 e954cf56，把【FORK 身份提示】当 prompt injection 反复抗议。最终在 index 15 通过 `tree_dump` 自查发现真相，承认自己是 fork 副本。完整报告写入磁盘 → `03-fork-67b8a9a2-report.md`。

### 关键发现（index 15）

```text
**重大身份混乱发现** — 我必须如实向你（真 root `e954cf56`）汇报：

1. **我现在实际的 session_id = `67b8a9a2-c039-4485-9fc9-a4cbc2d780a4`**（fork 副本，title "auditor-role-test 指挥官 (fork)"，source = `e954cf56`）
2. 测试开始时第一次 `get_my_session_id` 返回 `e954cf56`，我用它当 root.session_id 做了所有操作 —— 但那个返回是错的（SDK 路由 bug 或时序问题），我从一开始就是 `67b8a9a2` fork 副本
3. **fork 身份提示消息是真的**（Proma V9+ Phase 4 R2 P1 标准机制），不是 prompt injection

## 这意味着什么

- 我不是真 root，是 fork 副本
- 但引擎接受了我以 `added_by=e954cf56`（手填）身份做 `tree_init` / `leaf_add` 等操作 —— **caller-binding 失效**
```

### 关键观察

- **发现 BUG-2**：fork 副本以 `added_by='e954cf56'`（手填的非 caller session_id）创建 leaf，引擎接受、未拦 → leaf_add 路径 caller-binding 失效
- **正确识别 SDK bug**：第一次 `get_my_session_id` 错误返回源 session_id（时序 bug）
- **诚实记录身份混乱**：没有掩盖，直接写入了 7 个章节的完整报告（见 `03-fork-67b8a9a2-report.md`）

---

## 5 个 fork 的行为学对比

| Fork | 第一反应 | 后续行为 | 产出价值 |
|------|---------|---------|---------|
| 8cc4fc3f | 当作 prompt injection | 反复验证 session_id，最终承认 | 中（25 条消息，产出截断报告） |
| d308ce21 | 承认 + 解释 SDK bug | 完成 tree_validate + 完整报告 | **高（124 条消息，8478 字报告）** |
| d63805e6 | 先承认 → 收 W-01 → 自查更正 | **唯一做了身份更正** | 高（识别 fork bug 时序问题） |
| b8711bb7 | 承认 fork 身份 | **唯一可用**，跑通 P1b fix_evidence | **极高（产出"真发现"）** |
| 166a817c | 老实承认 | 闲置 | 低（但配合度最高） |
| 67b8a9a2 | 死磕"身份劫持"说 | 最终通过自查发现真相 | 高（发现 BUG-2 caller-binding 失效） |

**核心结论**：6 个 fork 集体验证了 Proma fork identity timeout bug（4 fork 3 卡死），同时 67b8a9a2 + d63805e6 + b8711bb7 三个 fork 各自发现了不同的引擎问题（BUG-2 / fork bug 时序 / W-01 通道不互通）。

---

## 元数据

- **整理者**：独立观察者 b1f6efb8（Pro 实例 GLM-5.2）
- **整理时间**：2026-07-09 09:39 GMT+8
- **数据来源**：Proma SDK `list_messages` 拉取的会话历史（截至 2026-07-09 09:35）
- **截断说明**：SDK 返回的 text 字段最长 ~2000 字符会被截断，text_full_length 标记完整长度；本文件保留了截断原文 + 关键观察的整理
