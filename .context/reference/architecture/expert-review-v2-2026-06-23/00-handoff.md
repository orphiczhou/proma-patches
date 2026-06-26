# 专家组交接文件 — Tree 体系架构层诊断 v2 审议

> **日期**: 2026-06-23 14:41
> **起草人**: Proma Agent（周星星的工作 AI 助手）
> **递交方式**: 用户周星星把本目录整体递交给专家组审议
> **审议目标**: 决定是否批准 v2 报告的核心论断，以及如何调整 v0.6 / v0.7 优先级
> **预计审议时长**: 30-60 分钟（最少阅读路径 20 分钟）
> **版本**: v2（v1 是 `expert-review-2026-06-23/`，针对 v0.5/v0.6 修订计划；本 v2 是基于 v1 之后的架构层深度调研）

---

## 0. 给专家组的快速进入路径

**最少阅读路径（20 分钟）**:
1. 本文件（00-handoff.md）— 核心论断 + 三层架构 + 决议题概览
2. `01-questions.md` — 8 个详细决议题（含选项、利弊、推荐）
3. 工作区文件 `../tree-system-architecture-analysis-2026-06-23.md` §0 + §1.5 + §6 — TL;DR + qfv2 实测证据 + 层级深度对比

**完整审议路径（60 分钟）**:
4. `../tree-system-architecture-analysis-2026-06-23.md` §2-§10 — 用户问题答案 + 三层防御 + 框架借鉴 + 优先级 + 风险
5. `../expert-review-2026-06-23/01-test-summary.md` — 测试报告（CP1-CP6）
6. `../expert-review-2026-06-23/03-v0.6-revised-plan-draft.md` — 原 v0.6 草稿（被本 v2 报告修正）

---

## 1. 项目背景（30 秒回顾）

### 1.1 Proma 是什么

Proma 是一款桌面端 AI 工作流应用（Electron + React + Node.js），基于 Claude Agent SDK 构建。用户在工作区里跟 Agent 对话完成任务，可以 Fork 会话、并行调度多 Agent。

### 1.2 Proma 改造项目

本项目（"Proma改造探索"工作区）目标：在 Proma 商业版基础上叠加开源改造，**不动 main.cjs（AGPL 合规）**，所有逻辑写进插件文件 `proma-dev-patches.cjs`。

### 1.3 Tree 体系是什么

"树形会话执行体系" 是本项目的核心创新：
- 由 `tree-state.js`（状态机）+ `tree-commander` skill（根会话）+ `tree-worker` skill（子会话）+ TAO Watcher（周期审计）组成
- commander 拆任务 → fork worker 执行 → 状态走 tree-state.json 持久化 → TAO Watcher 周期跑 35 条规则

### 1.4 当前 Tree 体系版本

- tree-state.js: v0.2.2 + TAO 子命令扩展
- commander / worker skill: v0.1.0
- TAO Watcher: v0.1（5 min interval + 35 规则 + nudge）
- 浮窗 UI: v0.4.5（已发布）

---

## 2. 为什么有这次 v2 审议

### 2.1 v1 审议（2026-06-23 09:30）针对什么

v1 审议针对"用户实测 4 个使用层 bug + 测试报告揭示的 6 个共性确认问题（CP1-CP6）"，给出 v0.6 修订计划草稿（新建 Phase 6 审计硬约束，8 个子步骤）。

### 2.2 v1 之后用户提了什么新问题

用户跳出 bug 层面，要求**从架构师 / 组织学 / AI 行为学视角**回答：

> "我这个 tree 多层结构，应该怎么设计一个机制才能确保规则执行下去？目前模型在单会话内执行还行，但**委托出去再兴起一个新的会话，然后让新会话按照规则做行为这事儿，感觉就有点儿不靠谱**。我不知道是 prompt 问题，还是当前模型套了 Agent harness 之后机制不支持这种多层级的调用。"

### 2.3 怎么回答的

派 3 个 researcher subagent 并行调研：
- **Agent A**（开源框架）: LangGraph / AutoGen / CrewAI / MetaGPT / ChatDev / Anthropic 多 Agent 经验
- **Agent B**（LLM 行为学）: 多层委托保真度衰减 / goal drift / sycophancy / context rot / cross-session 约束传递
- **Agent C**（工业控制模式）: Erlang OTP / Actor Model / Capability Security / Design by Contract / Event Sourcing / Watchdog / Saga / TMR

3 份调研结论**惊人一致**：**这不是 prompt 问题，是 LLM 物理特性 + Agent harness 缺硬约束层 + 层级深度严重失控 三者叠加**。

回溯 qfv2 tree 实际数据，发现跑到了 **5 层深**（用户印象里只有 3 层），完全印证了调研结论。

完整报告：`../tree-system-architecture-analysis-2026-06-23.md`

---

## 3. 核心论断（必须专家组判断对错）

### 3.1 一句话论断

**这不是 prompt 写得不够好的问题。靠 prompt 解 30%，剩下 70% 必须靠架构层硬约束 + 严格限制层级深度。**

### 3.2 论断的三层支撑

**Layer 1 — LLM 物理特性**（不可改）:
- 单轮→多轮准确率掉 **39%**（Laban ICLR 2026, 15 个模型 × 20 万对话）
- MAS 生产失败率 **41–86%**（Cemri NeurIPS 2025, MAST 14 种失败模式）
- Anthropic 自己说 *"LLM agents are not yet great at coordinating and delegating to other agents in real time"*
- 用户描述的 worker 行为（自审自过、伪造字段、跳过校验）= RLHF 训练目标的结构性副产物（Sycophancy → Reward Hacking），**prompt 改不动训练目标**

**Layer 2 — Agent harness 缺硬约束层**（可改）:
- 当前只有 Layer 0（prompt 软约束）+ Layer 3 部分（TAO Watcher 周期被动审计）
- **Layer 1（Capability Token + Design by Contract）完全缺**
- **Layer 2（事件驱动主动 supervision）完全缺**
- Agent 走捷径时，0 层管不住，3 层事后才发现，**中间没有事中拦截**

**Layer 3 — 层级深度严重失控**（可改）:
- qfv2 实测跑到 **5 层深**（root → C → Cr → Ccr1 → worker）
- 1 root + **8 个 sub-commander**（A/Ac1/C/Cc1/Cr/Ccr1/C2/C2c1）+ 9 worker
- 每层指令保真度掉 39%，**5 层下来 = 92% 信息丢失**
- Erlang OTP 工业上 3-5 层就停；Anthropic 自己只用 2 层
- 根因：`tree-state.js` 的 `role` 字段是**自由文本**，无 enum 限制；`leaf add` 也没有 depth 校验

### 3.3 用户 4 个问题的明确答案

| Q | A |
|---|---|
| 是 prompt 问题还是机制问题？ | **部分 prompt，更主要是机制**。30% prompt + 30% 模型 RLHF 副产物 + 40% harness 缺硬约束 |
| "天道"机制够不够？ | **作为第三层兜底够，作为唯一防线不够**。当前 Proma 把天道当唯一防线所以不可靠 |
| 开源框架有现成的吗？ | **没完全解决的**，但有大量可借鉴（LangGraph State Schema / MetaGPT SOP / Erlang OTP Supervisor / seL4 Capability）|
| "严格 2 层"是什么？对比当前 3 层 commander？ | qfv2 实测跑到 5 层。**严格 2 层 = 1 commander + N worker**。折中：硬限 depth ≤ 3，sub-commander 必须更强模型，禁 depth ≥ 4 |

---

## 4. 三层防御架构（核心建议）

```
┌─────────────────────────────────────────────────────┐
│ Layer 4: 模型层契约（v0.7+ Proma 平台改造）          │
│   - subagent_trace_id（真凭证，非 UUID 字段）         │
│   - capability-based 工具调用                         │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│ Layer 3: 监督平面（"天道"）— 当前 Proma 唯一防线      │
│   - TAO Watcher（已存在）— 周期被动审计               │
│   - Liveness 心跳（待加）— 卡死检测                   │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│ Layer 2: 主动 supervision（完全缺，待加）             │
│   - commander 持有 worker lifecycle handle            │
│   - worker 失败立即接管（不等 watcher 下个 tick）     │
│   - Erlang OTP 的 max_restarts/max_seconds 防抖       │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│ Layer 1: 数据 + 不变式层（Hard Gate，完全缺）         │
│   - Capability Token（fork 时颁发，工具调用前校验）   │
│   - Design by Contract（precondition/postcondition）  │
│   - State Schema（强制结构化输出）                    │
│   - Event hash chain（防伪造审计链）                  │
│   - 层级深度硬限制（depth ≤ 3）                       │
│   - role 字段 enum 校验                              │
└─────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────┐
│ Layer 0: 行为引导（Soft Guidance，prompt）— 已有      │
│   - skill 里的"铁律""应当"（35 条 TAO 规则）          │
│   - 当前是唯一防线，但其实是"暗示"                     │
└─────────────────────────────────────────────────────┘
```

---

## 5. 复杂任务不嵌套怎么拆？三种替代方案

qfv2 式 5 层嵌套禁掉后，大任务怎么办？三种替代方案：

### 方案 A：扁平化 + 横向扩 N（推荐）

```
commander-root
├─ worker-frontend-module1
├─ worker-frontend-module2
├─ worker-backend-api
├─ worker-backend-db
├─ worker-integration-test
└─ worker-doc
```

复杂度靠 root 多拆一级 + worker 内部 multi-step plan 消化。
- ✅ 层级浅，指令保真
- ❌ root context 压力大（管 10+ worker），需要早做竹节交接

### 方案 B：多 tree 协调（meta-tree）

```
[meta-tree]
  meta-commander
  ├─ tree-1-commander  ← 独立 tree（独立 tree-state.json）
  │  ├─ worker-1
  │  └─ worker-2
  └─ tree-2-commander  ← 独立 tree
     ├─ worker-3
     └─ worker-4
```

- ✅ context 完全隔离，可并行
- ❌ 跨 tree 协调成本高

### 方案 C：保留 3 层但加硬护栏（折中）

- 硬限 depth = 3（root → sub-commander → worker）
- sub-commander 必须用更强模型（Claude Opus 级别）
- sub-commander 不许再嵌套

---

## 6. 8 个待专家组决议题（核心）

详见 `01-questions.md`。摘要：

| # | 议题 | 起草人推荐 |
|---|---|---|
| 1 | **核心论断是否接受**（30/30/40 分配） | ✅ 接受 |
| 2 | **三层防御架构是否采纳** | ✅ 采纳，按 P0→P1→P2 推进 |
| 3 | **层级深度硬限制怎么定**（2 vs 3 vs 4） | depth ≤ 3，sub-commander 更强模型 |
| 4 | **Capability Token 是否上 P0** | ✅ P0，但 token 不能放 prompt 里 |
| 5 | **v0.5 / v0.6 / v0.7 怎么合并** | v0.5 + v0.6 合并为 v0.7，按三层架构重写优先级 |
| 6 | **复杂任务用 A/B/C 哪种方案** | 默认 A，B 备选，C 折中 |
| 7 | **migrate 策略**：16 个历史 tree 强制还是只对新生效 | 不覆盖策略，仅新 tree 生效 |
| 8 | **测试方法**：v0.7 完成后怎么验证 | 重跑 mdref/pytut + 加 depth/role 压力测试 |

---

## 7. 关键约束（不要违反）

### 7.1 工程约束
1. **不修改 main.cjs**（AGPL 合规，所有逻辑写进 patches.cjs）
2. **零外部依赖**（patches.cjs 只用 Node.js 内置 + electron）
3. **向后兼容**（每次改 tree-state.js 跑 migrate 让历史数据合规）
4. **破坏性操作前先跟用户确认**
5. **commit 时只 add 自己改的文件**

### 7.2 用户偏好（重要）
- **喜欢具体例子**：描述方案要给代码片段，不要空谈
- **反对附和**：要诚实提出反对意见，不要为了讨好而同意
- **接受限制**：解释清楚技术约束后能接受合理折中
- **决策快**：用具体选项让用户秒选，不喜欢开放式提问
- **重视文档**：每个阶段产物要落盘到 `.context/`
- **不喜欢长篇大论**：回复简洁，code 优先于 prose
- **F12 DevTools 走不通**：必须用 dump 路径调试 renderer
- **倒竖时间线不要做**（用户被劝住过）
- **wiki + git 是标准动作**

---

## 8. 环境信息

### 8.1 三个 Proma 实例

| 实例 | 代码位置 | 状态 |
|------|---------|------|
| **Dev** | `D:/Proma-dev/resources/app/dist/` | ✅ 最新补丁（v0.4.5 + 待发 v0.7） |
| **Release-fresh** | 共享 Dev 的 exe | ✅ 跟 Dev 一样 |
| **Release** | `D:/Proma-release/...` | ❌ 6/18 旧版，无补丁 |

### 8.2 关键文件路径

**完整 v2 报告**:
- `~/.proma/agent-workspaces/proma/workspace-files/.context/tree-system-architecture-analysis-2026-06-23.md`

**v1 审议包**（对比参考）:
- `~/.proma/agent-workspaces/proma/workspace-files/.context/expert-review-2026-06-23/`

**Tree 体系核心**:
- `~/.proma/agent-workspaces/proma/workspace-files/release/tree-system-v0.2.2/core/tree-state.js` — 主状态机（1700+ 行）
- `~/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md` — commander skill（500+ 行）
- `~/.proma/agent-workspaces/proma/skills/tree-worker/SKILL.md` — worker skill（550+ 行）

**qfv2 实测数据**（5 层嵌套证据）:
- `~/.proma/agent-workspaces/proma/workspace-files/.context/trees/qfv2/tree-state.json`

### 8.3 Git 仓库
- 工作区仓库: `~/.proma/agent-workspaces/proma/workspace-files/`
- v2 报告 commit: 待定（用户审批后）

---

## 9. 给专家组的建议

### 9.1 审议重点

建议把时间主要花在 `01-questions.md` 的 8 个决议题上，特别是：
- 议题 1（核心论断是否接受）— 决定整个方向
- 议题 3（层级深度硬限制）— 决定业务折中
- 议题 5（v0.5/v0.6/v0.7 怎么合并）— 决定下一步工作量

### 9.2 不要重复讨论的（已经定了的）

- 不修改 main.cjs（AGPL）
- v0.5 的 4 个 bug 修复方向（用户已批准）
- 倒竖时间线视觉（用户被劝住过）
- 浮窗 UI 改造（v0.4.5 已基本完成）
- "天道"作为周期审计的定位（v1 已确认）

### 9.3 可以挑战的

- 起草人对"30% prompt + 30% 模型 + 40% harness"的分配比例（拍脑袋）
- 起草人对"depth ≤ 3"的判断（可能太严，业务上 qfv2 这种确实需要再拆）
- "Capability Token 不能放 prompt 里"的论断（是否有折中方案）
- migrate 不覆盖策略（历史 5 层 tree 是否应该强制回滚到 depth ≤ 3）
- DeepSeek V4 Pro 作为 commander 模型的能力边界

### 9.4 不要做的

- ❌ 不要建议用 LangGraph / AutoGen 重写 Proma（用户明确不重写，只借鉴机制）
- ❌ 不要重新讨论浮窗 UI（已稳定）
- ❌ 不要建议换模型（DeepSeek V4 Pro 是用户当前选择）

---

## 10. 联系方式

- **用户**: 周星星
- **起草 Agent**: Proma Agent（工作在 proma workspace）
- **反馈途径**: 用户读专家组结论后，回会话里告诉 Agent 调整方案

---

> **本交接文件由 Proma Agent 撰写，2026-06-23 14:41**
> **请专家组审议后通过用户周星星反馈结论**
