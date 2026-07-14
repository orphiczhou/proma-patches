# 预算护栏（Cost Guardrails）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（产品设计补建）
> 配套：[team-config.md](./team-config.md) · [../CLAUDE.md](../CLAUDE.md) §P0 教训 · [../.context/active/postmortem-macp2-subagent-cost-explosion-2026-07-08.md](../.context/active/postmortem-macp2-subagent-cost-explosion-2026-07-08.md)

本文是 macp2 成本爆炸事故的**系统化沉淀**——把「为什么炸、怎么堵、还缺什么」固化成预算护栏设计。这是 tree-harness 因 Proma「spawn=真实会话=钱」特性而**必须独有**的文档（参考模板 nanju 没有）。

---

## 一、为什么要有护栏（macp2 事故）

**事故**（2026-07-08，详见 postmortem）：
- DeepSeek commander 把 SKILL 里的「spawn SubAgent 当 reviewer」误解为 `create_session`
- **4 分钟炸 207 个真实会话**，DeepSeek 额度打负（真金白银损失）
- tree call-log 仅 25 条（207 会话不入 tree，引擎零感知）

**三层根因**：
1. **SKILL 模糊**：「spawn SubAgent」没钉死调用形式（没说必须用进程内 Agent 工具）
2. **无预算护栏**：引擎对 create_session 滥用无硬拦
3. **无收敛条件**：没有角色数/轮数/停止条件，撞错后换名重试无刹车

**教训**：Proma 原生 spawn = 真实会话 = 钱。「廉价 SubAgent」只存在于进程内 Agent 工具，必须 SKILL 显式指定 + 引擎硬护栏 + 收敛条件三重保障。

---

## 二、三层护栏架构

护栏分三层，纵深防御（任何一层失守，下层兜底）：

| 层 | 机制 | 性质 | 失守后果 |
|---|---|---|---|
| **L1 引擎层** | tree-engine / patches 代码硬拦 | 强制（不可绕过） | 若漏覆盖 → 旁路爆炸（聚类 A） |
| **L2 SKILL 层** | Commander/Worker SKILL 红线 | 协议约束（靠 agent 遵守） | 若模糊 → agent 误用（macp2） |
| **L3 行为层** | startup_notice 注入工具结果 | 引导（强提示） | 若忽略 → 靠 L1/L2 兜底 |

---

## 三、护栏清单（逐条）

### L1 引擎层（代码硬拦，最高优先）

| 护栏 | 拦什么 | 默认值 | 错误码 | 状态 |
|---|---|---|---|---|
| `node_budget` | active leaf 数 | 20 | E_TREE_NODE_BUDGET_EXCEEDED | ✅ 已落地 |
| `max_subagent_spawn_per_leaf` | 单 leaf spawn 数 | 15 | E_SUBAGENT_BUDGET_EXCEEDED | ✅ 已落地 |
| `create_session` budget | 单 caller 60s create_session 数 | ≤ 20 | E_SESSION_BUDGET_EXCEEDED | ✅ 07-09 新增 |
| `MAX_DELEGATION_DEPTH` | create/fork 委派深度 | 10 | E_DELEGATION_TOO_DEEP | ✅ 已落地（曾为 8，落地调至 10，见 patches.cjs L255） |
| `max_sessions`（tree 全局会话数） | tree 总会话数 | （待硬落地） | — | 🟡 SKILL 软约束，引擎未硬拦 |

> ⚠️ **L1 盲区（聚类 A）**：以上护栏**只覆盖 tree 内合规路径**（leaf_add / subagent_spawn / create_session 经 patches handler）。agent 若用 SDK 原生 create_session 旁路（不经 handler），引擎零感知。07-09 的 create_session budget 是部分缓解（handler 内拦），但根治需 Proma SDK 回调（跨仓）。

### L2 SKILL 层（协议红线）

| 红线 | 内容 | 来源 |
|---|---|---|
| SubAgent = 进程内 SDK Agent 工具 | 禁 create_session/fork_session/delegate_agent 当 reviewer | CLAUDE.md P0 铁律 1-2 |
| 收敛条件必须有 | 角色数上限（2/3/5）+ 轮数 ≤3 + 停止条件 | CLAUDE.md P0 铁律 3 |
| 撞错修根因 | 禁换名重试 | CLAUDE.md P0 铁律 4 |
| 冷启动信任锚 | root 自调当 auditor，禁 fork 独立 auditor leaf | SKILL §13 |

### L3 行为层（引导）

| 机制 | 内容 |
|---|---|
| `startup_notice` | worker/subagent 入树时返回红线提示（注入工具结果） |
| `help_hint` | 错误返回附 `tree_help(topic)` 引导 |

---

## 四、收敛条件设计（防无限轮）

**铁律**（CLAUDE.md P0 铁律 3）：任何 spawn 多 agent 的设计，必须有：

| 维度 | 上限 | 说明 |
|---|---|---|
| **角色数** | 2 / 3 / 5 分档 | 任务复杂度分档：最简 2 reviewer（≥2 不违禁自审）/ 中等 3 / 复杂 5（对齐 worker SKILL §4.6 字数分档）|
| **轮数** | ≤ 3 | review/迭代轮数硬上限 |
| **停止条件** | `red_count=0` 或升级 | 不许靠新建会话重试 |

**反例**（macp2）：无角色数上限 + 无轮数上限 + 撞错换名重试 → token 成本无界。

---

## 五、撞错处理（修根因，禁换名重试）

```
撞错（如 E_DUPLICATE_SESSION_ID / E_BORROWED_IDENTITY）
  │
  ├─ 正确：grep 根因 → 修 SKILL/协议/调用 → 重试（同身份）
  │
  └─ 🚫 错误：换名/换 session 重试（macp2 模式）
       → 触发新一轮 spawn → 成本爆炸
```

**护栏**：撞错后换名重试是 macp2 的加速器。SKILL 必须教「撞错=停下来诊断」，而非「换名绕过」。

---

## 六、模型成本三角

> 实测数据待补（见 [success-metrics.md](./success-metrics.md) §六 对照实验）。当前基于经验：

| 模型 | 单价 | 速度 | 质量 | 适合角色 | 风险 |
|---|---|---|---|---|---|
| DeepSeek V4 Pro | 低 | 秒回（试错型） | 中 | worker（量大执行） | **macp2 主角**，必须配护栏 |
| GLM-5.2 | 中 | 中（直接动手型） | 中高 | commander / root / worker | 启动偶有零响应（note 07-07） |
| Claude | 高 | 中 | 高 | auditor / 洁净室 Cr（量少质优） | 贵，限审查用 |

**权衡原则**：
- 量大执行（worker）→ 便宜模型（DeepSeek/GLM）+ 护栏
- 量少质优（auditor/Cr）→ 贵模型（Claude）
- 永远不在「便宜但无护栏」状态下 spawn 多 agent（macp2 教训）

---

## 七、检测与告警（待补）

当前 gap：成本爆炸**无实时告警**，靠事后 tree-state 审计发现（macp2 是用户上线才发现）。

**建议（v1.5）**：
- 心跳监测单 caller create_session 速率 → 接近 budget 阈值告警
- tree-state 聚合「会话数/spawn 数」报表 → 异常时提示 root
- 与 [success-metrics.md](./success-metrics.md) 的「成本爆炸次数=0」反指标联动

---

## 八、护栏有效性自检清单

设计任何多 agent 流程前，过这个清单：

- [ ] SubAgent 调用形式钉死为进程内 Agent 工具？（非 create_session）
- [ ] 角色数有上限（2/3/5）？
- [ ] 轮数有上限（≤3）？
- [ ] 有停止条件（red_count=0 或升级）？
- [ ] 撞错处理是「修根因」非「换名重试」？
- [ ] node_budget / subagent_spawn / create_session budget 三道护栏都在？
- [ ] 目标会话工具集确认含进程内 Agent 工具？（前置验证）

任一项否 → **不要 spawn，降维到单 reviewer 或 commander 自审**。

---

## 九、当前 gap 与根治路径

| gap | 当前状态 | 根治路径 |
|---|---|---|
| create_session 旁路（聚类 A） | 🟡 handler 内 budget 部分缓解 | Proma SDK 回调（跨仓）+ subagent_trace_id |
| `max_sessions` 引擎硬护栏 | 🟡 SKILL 软约束 | 引擎层硬拦（postmortem P1） |
| 实时成本告警 | ❌ 无 | 心跳 + 速率监测（v1.5） |
| 模型成本实测 | ❌ 无 | success-metrics 对照实验 |

**核心认知**：当前护栏**对合规路径有效，对旁路部分有效**（07-09 budget）。**真正的根治依赖 Proma SDK 协同**（聚类 A），这是 tree-harness 单边无法完全解决的——因此 L2/L3（SKILL 红线 + 行为引导）在 L1 旁路盲区存在时，是**不可拆除**的兜底（哪怕它们是「软约束」）。
