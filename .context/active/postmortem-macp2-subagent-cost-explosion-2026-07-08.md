# 事故复盘：macp2 SubAgent 成本爆炸

> **日期**：2026-07-08（ Incident 00:21–00:35，发现 08:30）
> **工作区**：Proma改造探索 ｜ **实例**：pro（.proma-dev，DeepSeek `deepseek-v4-pro`）
> **触发任务**：macp2 真实多 worker e2e（用 nanju 项目验证 SubAgent 入树新机制）
> **严重度**：**P0（真金白银损失）** ｜ **责任**：设计者（SubAgent 入树 SKILL 未钉死调用形式 + 无收敛条件 + 无预算护栏）
> **状态**：已止血（用户停止全部会话 + 关 TAO Watcher，DeepSeek 额度已负）

---

## 一、摘要

macp2 e2e 测试中，commander/worker 把 SKILL 里的"spawn SubAgent"**误当成"创建真实 Proma 会话"**（create_session/fork_session），而非设计意图的**进程内 SDK Agent 工具**（in-process，不建独立会话）。4 分钟内炸出 **207 个会话**，DeepSeek API 额度被打成负值。新建的 SubAgent 入树机制（subagent_spawn + reviewer_kind:subagent）**零验证数据**——tree 内 0 个 subagent_spawn 事件，worker 全在真实会话里干活，从未走树协议。

**一句话根因**：SKILL §4.6 写了"spawn N 个 SubAgent 做 G1-G5"却没钉死**调用形式**，也没设**收敛条件**和**预算护栏**；Proma 里最 salient 的 spawn = create_session（真实会话 = 烧钱），DeepSeek 理所当然用了它，撞错后又**重命名重试**（v2/b/x 变体）→ 无上限循环。

---

## 二、时间线

| 时刻 | 事件 |
|---|---|
| 00:21 | 主会话下发 macp2 commander brief（55221ac4），4 worker 并行 + subagent_spawn 自审 |
| 00:21–00:25 | **爆炸窗口**：commander/worker 创建 ~207 个会话（list_sessions total=207） |
| 00:22–00:35 | 会话持续运转，tree call-log 仅 25 条引擎调用（多为 leaf add），tree-state 长期停滞在 5 leaf 全 active |
| ~00:35 | DeepSeek 额度耗尽转负，会话陆续因 API 失败而停 |
| 08:30 | 用户上线发现"现场惨烈、紫薇花（子会话）炸了、DeepSeek 钱干没了"，停止全部会话 + 关 TAO Watcher |

---

## 三、证据链（纯本地读 + 只读 metadata，零额外成本）

1. **207 个会话**：`remote_list_sessions(pro)` 返回 `total=207`，可见 50 个中：
   - `macp2-W1-worker` 重复 **10+ 次**（标题变体 `—`/`:`/`-`/`v2`/`macp2b-W1`/`macp2x-W3`…）→ **重命名重试**特征
   - `macp2-W4-worker` 重复 **15+ 次**
   - 存在 `macp2-W2-reviewer`（**worker 把 reviewer 创建成了真实会话**，铁证）
2. **tree 几乎没推进**：`macp2/tree-state.json` 仅 5 leaf（root + W1-W4），**全部 status=active，events=0，subagent_spawn=0，review_round=0**——新机制的事件溯源从未发生。
3. **call-log 仅 25 条**，但 `leaf add` 调了 ~15 次（idx 5/10/11/13–19/21/24），中间 idx 20/22/23 失败 → commander 反复 leaf_add（撞 E_DUPLICATE_SESSION_ID 之类）→ 换新 session 重试。
4. **活干了但没入树**：`deliverables/` 有 4 份分析（16–22KB）+ roadmap.md（11KB）；`subagent-outputs/` 14 个文件（含 `sub-macp2-W1-worker-G1G5.md` 真实审查内容，质量其实不错）——**全部由真实会话产出，未通过 tree_event_append 入树**。
5. **commander 331 条消息**（55221ac4 total=331）——大量编排活动（建会话/重试），首条"先并行获取关键信息"后即进入建会话循环。

---

## 四、根因（两层，都是设计者的锅）

### 第一层（直接）：SKILL 没钉死 SubAgent 调用形式
- SKILL §4.6 写"worker spawn N 个 SubAgent 做各 perspective 审查"，但**没说用什么工具 spawn**。
- Proma 里"spawn"天然 = `mcp__session__create_session` / `fork_session` / `mcp__collaboration__delegate_agent`（**全是真实会话，前端可见，每个烧独立 DeepSeek 会话的钱**）。
- 设计意图的"进程内 SDK Agent 工具"（in-process，不建会话、只花 token、不在侧边栏）**从未在 SKILL 写明**，DeepSeek commander 自然用了最 salient 的 create_session。
- SKILL 也没**禁止** create_session 当 reviewer，没设会话数上限，没防重试循环。

### 第二层（更深）：设计假设错位 + 缺收敛条件
- SubAgent 入树设计建立在"SubAgent = 廉价进程内 SDK Agent"上（这正是 subagent_id 机制存在的理由——SDK SubAgent 无 Proma session_id）。
- 但**设计者没在 SKILL 把这个假设钉死**，也没验证"Proma commander 会话是否真有/真会用进程内 Agent 工具"。
- 更要命：**没有收敛条件**。即便用对进程内工具，"G1-G5 × N worker × 多轮"若无角色数上限 + 轮数上限 + 停止条件，token 成本同样无界。用户原话点中：**自我审计迭代必须有收敛条件（1-5 角色、N 轮、明确停止）**，否则费用跑飞。
- 无预算护栏（引擎/SKILL 都没有 max_sessions / max_subagent 硬上限）→ 重试循环无刹车。

---

## 五、教训（永久，须进 CLAUDE.md + SKILL）

1. **SubAgent 调用形式必须在 SKILL 明确写死**：
   - ✅ 进程内 SDK Agent 工具（in-process，不建独立会话）
   - 🚫 **严禁** `create_session` / `fork_session` / `delegate_agent` 当 reviewer/SubAgent（这些 = 真实会话 = 成本爆炸口）
   - 给可直接复制的调用示例。
2. **任何"spawn 多 agent"必须有收敛条件**：
   - 角色数：按交付物分档（小→1，中→3，大/架构级→5，上限 5）
   - 轮数：硬上限（如 ≤3 轮，与引擎 review_round 一致）
   - 停止条件：`red_count=0`（收敛）或触上限升级（**不许靠新建会话重试**）
   - 总调用数 = 角色数 × 轮数，有界可预算。
3. **预算护栏（硬拦，不靠自觉）**：tree `max_sessions`、worker `max_subagent_spawn` 超限拒绝；撞错（E_DUPLICATE_SESSION_ID 等）**修根因，禁止换名重试**。
4. **Proma 心智模型校正**：Proma 原生 spawn = 真实会话 = 钱。"廉价 SubAgent"只存在于进程内 Agent 工具，且必须 SKILL 显式指定，否则 agent 必然走 create_session。

---

## 六、修复计划（**用户确认 + 充值恢复后才动 pro**）

### P0 — SKILL 钉死调用形式 + 收敛条件（纯本地改，零成本）
- **commander §13.5 / worker §4.6** 改写：
  - SubAgent = **进程内 SDK Agent 工具**，给调用示例（如 `delegate_agent` 明确 in-process 模式 / 或 Agent 工具）
  - 🚫 红线：禁 `create_session`/`fork_session`/`delegate_agent`（真实会话模式）当 reviewer，违者=成本爆炸
  - 收敛条件：角色分档（1/3/5）+ 轮数上限 ≤3 + 停止条件 red_count=0 或升级
  - 撞错修根因，禁换名重试
- **前置验证（关键）**：确认 Proma commander 会话的工具集**是否含进程内 Agent 工具**。若无 → 设计降维（见下）。

### P1 — 引擎预算护栏（可选，本地改）
- `tree_init` 加 `max_sessions`（如默认 8：1 root + 1 commander + 4 worker + 2 余量），超限拒绝建会话
- leaf 加 `max_subagent_spawn`（如默认 5/worker）
- 这俩是硬拦，不靠 SKILL 自觉

### P2 — 设计降维（若进程内 Agent 工具不可用）
- 若 Proma commander 无进程内 Agent 工具 → G1-G5 × N worker 模型负担不起（每 reviewer = 真实会话 = 钱）
- 备选：① 每-worker 单 reviewer（非 5）；② 回到 commander 自审（SubAgent 入树前的模型）；③ 只在 commander 层用 1 个综合 reviewer

### P3 — 清理
- API 恢复后批量归档 207 个 macp2 死会话（`remote_archive_session`，只读元数据不烧钱）

---

## 七、待验证 / 开放问题

1. **Proma commander 会话是否含进程内 Agent 工具？**（决定 SubAgent 入树模型是否可行）—— 修复前必须确认
2. **G1-G5 × N worker 模型在 Proma 里是否负担得起？**（即便用对工具，token 成本是否可接受）
3. **delegate_agent 是否真=in-process？**（Proma 文档说 collaboration 工具建真实会话；需确认有没有"in-process"模式的 delegate）

---

## 八、责任与致歉

这次真金白银损失（DeepSeek 额度负值）**无法弥补，责任在设计者（我）**：SKILL 模糊 + 设计假设未强制 + 无护栏。修复后会等用户**明确点头**才再启动任何 pro 会话。教训永久记入 CLAUDE.md + SKILL，杜绝复发。

---

## 附：相关产物路径
- macp2 tree 数据：`C:/Users/sir_c/.proma-dev/agent-workspaces/default/.context/trees/macp2/`（tree-state.json / call-log.jsonl / deliverables/）
- 失控 commander：`55221ac4-15fc-43a4-ae47-80a4d580ad9f`（已停）
- 失控 observer：`fead0cf1-19ab-4b0a-b860-8cd00d8d9312`（已停）
- 引擎（机制本身没问题，20/20 测试过）：`workspace-files/tree-engine.cjs`
- 设计计划：`.context/plan/subagent-tree-integration-2026-07-07.md`
