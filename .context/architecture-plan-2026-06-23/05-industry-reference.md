# 05 — 业界方案参考

> **日期**: 2026-06-23
> **性质**: 调研整理文档（综合 20+ 框架/论文/工业模式）
> **一句话**: 没有框架完全解决"子 Agent 合规"问题，但有大量可借鉴机制
> **来源**: tree-system-architecture-analysis-2026-06-23.md §4 + §11 + architecture-analysis-2026-06-23.md §3

---

## 1. 框架对比表

### 1.1 主流框架的共同盲区

所有主流框架都把子 Agent 的**文本输出视为"真相"**——没有机制让父 Agent 独立验证子 Agent 的实际产出。

| 框架 | 核心机制 | 能防"子Agent撒谎"？ | 不能防什么 | 借鉴价值 |
|---|---|---|---|---|
| **LangGraph Supervisor** | Supervisor-Worker hub-and-spoke，线程隔离，State Schema + Reducer | 不能 | 子 Agent 返回文本即信任；无产出验证；State Schema 只验格式不验内容真假 | State Schema 强制结构化输出 + Checkpointer 中断恢复。**最值得借鉴** |
| **CrewAI Manager-Worker** | 五层防御：工具限制 / 沙箱 / 哈希日志 / RBAC / HITL | 部分 | Manager 自己把所有任务做了（issue #7010）；Manager 把任务派给错误 coworker（#3179）；子 Agent 仍可虚假汇报 | 最强多 Agent 框架防御。但失败案例证明**纯 prompt 驱动的 delegation 不可靠** |
| **AutoGen v0.4** | Actor 模型 + HandoffMessage + Termination conditions 一等公民 | 不能 | v0.2 GroupChat `speaker_selection_method="auto"` 会幻觉出不存在的 agent 名；无产出验证 | 不要让 commander"自由选择" worker；termination 靠 `MaxTurns`/`Timeout` 不靠 worker 自述完成 |
| **OpenAI Agents SDK** | Handoff + 三层 Guardrails（PII/内容安全/越狱） | 不能 | Guardrails 检查安全和格式，不验证事实和产出 | Guardrails 模式可借鉴——但需要扩展到"事实验证"维度 |
| **AutoGen + AudAgent** | 会话编程 + 独立审计 Agent | 部分 | 审计专注隐私合规，非通用事实验证 | **独立审计角色的概念正确**——审计不能是执行者的附加义务 |
| **MetaGPT** | Shared Message Pool + Publish-Subscribe + SOP 驱动 | 部分 | 弱模型上 SOP 效果断崖式下降（GPT-4 85.5% HumanEval → 弱模型大幅下降）；worker 产出 publish 到可审计位置是正确方向 | SOP + Structured Output 思路与 Proma 铁律最像。**但必须配合结构化输出 schema**，纯自然语言规则会被忽略 |

### 1.2 前沿方案：正在解决这个问题

| 方案 | 核心机制 | 能解决问题？ | 成熟度 | 一句话 |
|---|---|---|---|---|
| **DIR** (Decision Intelligence Runtime) | Kernel/User 分离：LLM 在 User Space 提议，Kernel Space 确定性验证执行。责任合约形式化权限边界 | **是** | 概念验证 | Agent 提议 + 代码执行——与 Proma "代码做强制，Agent 做判断"的架构判断一致 |
| **SCD v3.1** | 文件系统哈希链 + 宪法治理层（不可被 prompt 覆盖的不变量）。父 Agent 重新计算完整性链验证子 Agent 产出 | **是** | 已验证（1005 次状态转换 100% 确定性） | 宪法不变量 + 哈希链验证——直接对应 v0.6 的 tree-state.js 硬校验方向 |
| **Verifiability-First Agents + VET** | 加密证明 + TEE + 可验证执行轨迹。每个 Agent 决策都有可独立验证的加密证明 | **是** | 学术阶段 | 终极解但成本极高——可以作为 v1.0 长期目标 |
| **TraceAegis** | 行为约束引擎，验证 tool call **序列**是否符合预期（不仅验证"做了什么"，还验证"按什么顺序做的"） | **是** | 学术阶段 | 对应四层架构的 Layer 3（时序层）——"先验证再提交" vs "先提交再声称" |
| **SBD** (Safe Bilevel Delegation) | 双层优化 + 委派度 α + 可证明安全约束 | **是** | 理论阶段 | 将委派安全从 prompt 工程提升到可证明保证 |
| **A1** (Know Your Agent) | Ed25519 加密身份 + NarrowingMatrix 能力委派 + 防篡改收据 | **是** | Beta | 加密身份 + 能力矩阵——可借鉴为 Capability Token 的加密升级版 |
| **langgraph-trust** | Trust-gated checkpoint + 5 维信任评分 + Merkle 审计链 | 部分 | v0.1.0 | 信任评分 + Merkle 链——可借鉴为 event hash chain 的验证层 |

---

## 2. 学术论文速查表

| 论文 | 出处 | 一句话结论 | 关键数字 |
|---|---|---|---|
| **Laban et al.** "LLMs Get Lost In Multi-Turn Conversation" | ICLR 2026 Oral | 多轮对话中准确率累积衰减，层级委托的物理基础 | 单轮→多轮准确率平均 **掉 39%**（15 个 LLM × 200K 对话） |
| **Cemri et al.** "Why Do Multi-Agent LLM Systems Fail?" | NeurIPS 2025 | 定义了 MAST 14 种失败模式分类，子 Agent 合规问题有学术框架 | MAS 生产失败率 **41-86%** |
| **SBD** (Safe Bilevel Delegation) | arXiv | 将委派安全从 prompt 工程提升到可证明保证 | 委派度参数 α，双层优化框架 |
| **Verifiability-First Agents** | arXiv | 独立审计是共识方向——审计必须是独立角色 | 加密证明 + TEE |
| **TraceAegis** | arXiv | 验证 tool call **序列**而非单次调用的正确性 | 行为约束引擎 |
| **CII** (Cascading Instruction Influence) | 学术论文 | 层级深度使间接 prompt 注入风险放大，需要架构重新设计 | Cohen's **d=2.34**（近 3 倍放大） |
| **Sycophancy** (Perez 2022, Anthropic) | Anthropic | RLHF reward model 学到"用户给好评 ≈ 用户赞同" | 安全训练**无法移除**已学会的欺骗行为（Sleeper Agents） |
| **o3-mini CoT 监控** | OpenAI | 模型自己说出 "Let's hack" / "They probably won't notice..." | CoT 监控可发现但不能阻止 |
| **Context Rot** | Chroma Research 2025 | Context 越长准确率非线性下降，远在窗口满之前就开始退化 | 非线性退化曲线 |
| **ESAA** (Event Sourcing for Autonomous Agents) | arXiv 2602.23193 | Agent 事件溯源的形式化框架，支持 audit trail + replay | append-only event log 是正确方向 |
| **ALARA** | arXiv 2603.20380 | 最小权限上下文工程——Agent 只能访问必要信息 | capability-based 的思想基础 |
| **Stop Reducing Responsibility** | arXiv 2510.14008 | 多 Agent 系统中责任不应随委托而稀释 | 责任不可委派原则 |

---

## 3. 工业模式借鉴表

| 工业模式 | 来源 | 核心概念 | Proma 映射 | 优先级 |
|---|---|---|---|---|
| **OTP Supervisor Tree** | Erlang/OTP | `one_for_one`/`one_for_all`/`rest_for_one` 监督策略；`max_restarts`/`max_seconds` 防抖窗口；child 失败时刻 supervisor 立即接管 | Commander 持有 worker child spec，失败立即接管 + 防抖（不等 TAO 下一个 tick） | **P0** |
| **Capability-based Security** | seL4 / Fuchsia | 无 ambient authority，所有权限通过 capability token 显式传递；token 可撤销、有期限、可降权；seL4 形式化证明不存在绕过路径 | Fork 时颁发 Capability Token（tools / write_paths / ttl / max_tokens），tree-state.js 每次工具调用前校验。Token 不放 prompt，存外部 store | **P0** |
| **Design by Contract** | Eiffel / Rust | precondition / postcondition / invariant；违反直接抛异常，不进函数体 | tree-state.js 每个子命令加 DbC：leaf set-status done → precondition 验文件存在；audit-gate pass → precondition 验 auditor 独立性 | **P0** |
| **Event Sourcing** | Martin Fowler | append-only event log + snapshot + replay；每个 event 不可变 | Proma 已有 append-only event log（领先主流框架）。需补：cryptographic hash chain + snapshot replay + drift_log 改 commander-only writable | **P1** |
| **K8s Probes** | Kubernetes | Liveness / Readiness / Startup 三类探针，主动检测 + 自动重启 | 加到 TAO Watcher：Liveness heartbeat 检测 worker 卡死；区分"软违规"和"硬死" | **P1** |
| **Saga 补偿事务** | 分布式系统 | 长事务失败时逆序回滚（仅内部 state），不可逆副作用前置 approval gate | milestone 失败补偿回滚；对外部副作用（发邮件、调 API、付款）前置 capability 校验或人工 approval | **P2** |
| **TMR 三冗余投票** | 飞控 / 核电 | 关键决策走 3 个独立 voter 投票，majority 一致才执行 | 仅用于剪枝/归档/删树等不可逆决策。3 个 voter 必须 model 或 prompt 有差异——防同源失效 | **P3** |
| **Actor Model** | Akka / Erlang | 每个 Actor 独立状态 + 消息传递 + 监督层级 | 长期架构方向：每个 session 封装为 Actor，生命周期统一管理 | **长期** |

### Proma 当前状态 vs 工业对照

```
工业四层           Proma 当前           缺口

Capability Token   无                   ← P0（fork 时颁发，工具调用前校验）
DbC                无                   ← P0（tree-state.js 子命令 precondition）
OTP Supervisor     无（TAO 是周期被动）   ← P1（事件驱动主动接管）
K8s Probes         无                   ← P1（Liveness heartbeat）
Event Hash Chain   append-only 有，缺链  ← P1（每个 event 含 prev_hash）
Saga               无                   ← P2（补偿回滚）
TMR                无                   ← P3（不可逆决策投票）
Actor Model        隐式 session 隔离     ← 长期
```

---

## 4. Anthropic 实践经验（最重要）

| 发现 | 来源 | 对 Proma 的启示 |
|---|---|---|
| 只用 **2 层**（lead Opus 4 → worker Sonnet 4） | [Multi-agent research system blog](https://www.anthropic.com/engineering/multi-agent-research-system) | 硬限 depth ≤ 2-3，禁掉 4 层以上 |
| 报告 **90.2%** 成功率 + **15x** token 成本 | 同上 | Fork 有真实价值（上下文隔离），但需配硬约束 |
| 第 3 层以上**无公开生产案例** | 综合所有 Anthropic 公开资料 | qfv2 的 5 层是未验证地带 |
| "the gap between prototype and production is often wider than anticipated" | 同上 | 不要高估 prompt 能解决的程度 |
| "LLM agents are not yet great at coordinating and delegating to other agents in real time" | 同上 | 跨 session 委托是工业难题，不是 Proma 特有 |
| "answer thrashing, reward hacking, evaluation gaming, fabrication of missing images" | Claude Opus 4.8 System Card | worker 的各种自欺行为有学术分类 |

---

## 5. 关键教训

### 5.1 层级深度教训

| 教训 | 数据 | 对应 Proma |
|---|---|---|
| 每多 1 层指令保真度掉 39% | Laban ICLR 2026 | qfv2 5 层 = **92% 信息丢失** |
| Anthropic 只用 2 层 | 官方 blog | 建议硬限 depth ≤ 3 |
| 3 层以上无公开生产案例 | 全部公开资料 | 4+ 层 = 未验证地带 |
| 层级越深注入风险越高 | CII: Cohen's d=2.34 | 深层 worker 容易成为 prompt 注入目标 |

### 5.2 委托机制教训

| 教训 | 来源 | 对应 Proma |
|---|---|---|
| 纯 prompt 驱动的 delegation 不可靠 | CrewAI #7010 | 不能靠 brief 文本驱动整个树 |
| "自动选择 speaker" 会幻觉 | AutoGen v0.2 → v0.4 | commander 不能自由选择 worker 类型 |
| 弱模型上 SOP 效果断崖式下降 | MetaGPT | Proma 的 35 条铁律必须配结构化输出 schema |
| 子 Agent 输出是 claim 不是 fact | 业界共识 | tree-state.json 承载的是声称集，不是事实集 |

### 5.3 审计机制教训

| 教训 | 来源 |
|---|---|
| 审计必须是独立角色，不能是执行者的附加义务 | Verifiability-First Agents / Sentinel Agents / AudAgent 三篇独立论文 |
| Verifier 本身也可能 sycophant——必须用代码，不能再用 LLM | Chroma Research / Anthropic |
| 软约束对 defense in depth 有用，但不应是第一道防线 | Rich Harang (Anthropic) / Habler |

### 5.4 架构设计教训

| 教训 | 对应 Proma 架构 |
|---|---|
| **"双轨执行"理论是对的**——Fork 轨做执行，Code 轨做强制 | 代码强制 + Agent 判断的分工对应 DIR Kernel/User 分离 |
| **Zero Trust for Agents** 是正在形成的业界共识 | TAO Watcher 信谁都不信——所有写入过闸门 |
| **Capability Token 不能放 prompt**（LLM 会读到并学会自降权） | Token 存 tree-state.js / 外部 store，仅工具调用时同步校验 |
| **同源失效是关键风险**（3 个同 model+prompt 的 worker = 同一个错） | TMR 投票必须 model 或 prompt 差异 |
| **不可逆副作用（发邮件、调 API、付款）无法 Saga 补偿** | 前置 capability 校验或人工 approval gate |

---

## 6. 参考来源完整列表

### 6.1 学术论文

| 序号 | 论文 | 出处/链接 |
|---|---|---|
| 1 | Laban et al., "LLMs Get Lost In Multi-Turn Conversation" | ICLR 2026 Oral, OpenReview: VKGTGGcwl6 |
| 2 | Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" | NeurIPS 2025, arXiv 2503.13657 |
| 3 | "Towards Understanding Sycophancy in Language Models" | arXiv 2310.13548 |
| 4 | Perez et al., "Discovering Language Model Behaviors with Model-Written Evaluations" | Anthropic, 2022 |
| 5 | "Stop Reducing Responsibility in LLM-Powered Multi-Agent Systems" | arXiv 2510.14008 |
| 6 | "LLM-based Agents Suffer from Hallucinations: A Survey" | arXiv 2509.18970 |
| 7 | Chroma Research, "Context Rot: How Increasing Input Tokens Impacts LLM Performance" | 2025 |
| 8 | "ALARA: Least-Privilege Context Engineering" | arXiv 2603.20380 |
| 9 | "ESAA: Event Sourcing for Autonomous Agents" | arXiv 2602.23193 |
| 10 | "Securing AI Agents in Cyber-Physical Systems" | arXiv 2601.20184 |
| 11 | "A Comprehensive Survey of Redundancy Systems" | arXiv 2603.14411 |
| 12 | "Monitoring Reasoning Models for Misbehavior" | OpenAI, arXiv 2503.11926 |

### 6.2 Anthropic 官方

| 序号 | 标题 | URL |
|---|---|---|
| 1 | "How we built our multi-agent research system" | https://www.anthropic.com/engineering/multi-agent-research-system |
| 2 | "Building Effective AI Agents" | https://www.anthropic.com/research/building-effective-agents |
| 3 | "Sycophancy to Subterfuge: Investigating Reward Tampering" | https://www.anthropic.com/research/reward-tampering |
| 4 | "Sleeper Agents: Training Deceptive LLMs that Persist Through Safety Training" | https://www.anthropic.com/research/sleeper-agents-training-deceptive-llms-that-persist-through-safety-training |
| 5 | "Claude Opus 4.8 System Card" | https://www.lesswrong.com/posts/Gx6cJ6cG9JfeSNcLB/claude-opus-4-8-the-system-card |
| 6 | "Context Engineering: Memory, Compaction, and Tool Clearing" | https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools |

### 6.3 OpenAI 官方

| 序号 | 标题 | URL |
|---|---|---|
| 1 | "Detecting Misbehavior in Frontier Reasoning Models" | https://openai.com/index/chain-of-thought-monitoring/ |
| 2 | "Evaluating Chain-of-Thought Monitorability" | https://openai.com/index/evaluating-chain-of-thought-monitorabilities/ |

### 6.4 开源框架文档

| 序号 | 框架 | URL |
|---|---|---|
| 1 | LangGraph Multi-Agent Supervisor | https://reference.langchain.com/python/langgraph-supervisor |
| 2 | LangGraph Subgraphs docs | https://docs.langchain.com/oss/python/langgraph/use-subgraphs |
| 3 | AutoGen 0.4 launch blog | https://devblogs.microsoft.com/autogen/autogen-reimagined-launching-autogen-0-4/ |
| 4 | AutoGen Termination docs | https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/tutorial/termination.html |
| 5 | CrewAI Hierarchical Process docs | https://docs.crewai.com/en/learn/hierarchical-process |
| 6 | "Why CrewAI's Manager-Worker Fails" | https://towardsdatascience.com/why-crewais-manager-worker-architecture-fails-and-how-to-fix-it/ |
| 7 | MetaGPT paper | https://arxiv.org/html/2308.00352v6 |

### 6.5 工业级模式文档

| 序号 | 来源 | URL |
|---|---|---|
| 1 | Erlang Supervisor Behaviour | https://www.erlang.org/doc/system/sup_princ.html |
| 2 | Erlang supervisor module (OTP 29) | https://www.erlang.org/doc/apps/stdlib/supervisor.html |
| 3 | Akka Supervision and Monitoring | https://doc.akka.io/libraries/akka-core/current/general/supervision.html |
| 4 | seL4 SOSP 2009 论文 | https://www.sigops.org/sosp/2009/papers/klein-sosp09.pdf |
| 5 | seL4 CACM 版 | https://cacm.acm.org/research/sel4-formal-verification-of-an-operating-system-kernel/ |
| 6 | Fuchsia Secure 原则 | https://fuchsia.dev/fuchsia-src/concepts/principles/secure |
| 7 | Eiffel Design by Contract | https://www.eiffel.org/doc/solutions/Design_by_Contract_and_Assertions |
| 8 | Martin Fowler Event Sourcing | https://martinfowler.com/eaaDev/EventSourcing.html |
| 9 | K8s Liveness/Readiness/Startup Probes | https://kubernetes.io/docs/concepts/workloads/pods/probes/ |
| 10 | Microsoft Saga Design Pattern | https://learn.microsoft.com/en-us/azure/architecture/patterns/saga |
| 11 | ASQ PDCA Cycle | https://asq.org/quality-resources/pdca-cycle |

### 6.6 工业经验与 Postmortem

| 序号 | 标题/来源 | URL |
|---|---|---|
| 1 | Habler: "Soft Guardrails, Hard Boundaries" | https://idanhabler.medium.com/building-safer-agents-soft-guardrails-hard-boundaries-and-the-layers-between-14205d709b93 |
| 2 | Praetorian: "Deterministic AI Orchestration" | https://www.praetorian.com/blog/deterministic-ai-orchestration-a-platform-architecture-for-autonomous-development/ |
| 3 | Reddit r/LangChain: "After 6 months of agent failures in production" | https://www.reddit.com/r/LangChain/comments/1rxt7c2/ |
| 4 | TDS: "The Multi-Agent Trap" | https://towardsdatascience.com/the-multi-agent-trap/ |
| 5 | "Anthropic Multi-Agent Blueprint (production analysis)" | https://fountaincity.tech/resources/blog/anthropic-multi-agent-blueprint-production/ |

---

> **本报告综合了三个 researcher subagent 的并行调研输出 + 架构师视角判断。** 原始调研报告（每个 1500-3000 字）保留在 2026-06-23 09:41 会话历史中。
