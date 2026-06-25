# 06 — 决策日志

> **日期**: 2026-06-23
> **性质**: 架构改进方案所有关键决策的"选项/选择/理由/风险"记录
> **配套**: `03-implementation-roadmap.md`（实施路线图）
> **来源**: `expert-review-v2-2026-06-23/01-questions.md`（8 个决议题）、`tree-system-architecture-analysis-2026-06-23.md`（v2 诊断报告）、`architecture-analysis-2026-06-23.md`（路线评估）

---

## 决策 1：核心论断的接受

| 维度 | 内容 |
|---|---|
| **决策内容** | 是否接受 v2 报告的核心论断："这不是 prompt 写得不够好的问题。靠 prompt 解 30%，剩下 70% 必须靠架构层硬约束 + 严格限制层级深度。" |
| **选项** | A. 完全接受 30/30/40 / B. 接受方向但调整比例 / C. 部分接受（prompt 仍有空间）/ D. 不接受 |
| **选择** | **A. 完全接受** |
| **理由** | 1. 三家调研结论惊人一致（学术 Laban ICLR 2026 + 工业 Cemri NeurIPS 2025 + Anthropic/OpenAI 官方文档）；2. Anthropic 自己承认 multi-agent 不可靠；3. 用户已实测 35 条 TAO 规则优化 prompt，效果有限；4. 30/30/40 是定性分配，不需要精确数字；5. 用户四个问题的答案全部指向"机制缺失 > prompt 质量" |
| **风险** | 如果实际比例是 50/30/20（prompt 占大头），则 v0.7 投入产出比可能不如继续优化 prompt。没有量化方法验证（除非专门跑对比实验）。 |
| **用户确认状态** | 待确认 |

---

## 决策 2：五层架构的采纳范围

| 维度 | 内容 |
|---|---|
| **决策内容** | v2 报告提出的 5 层防御架构（Layer 0-4）中，本次实施哪些层级？ |
| **选项** | A. 完全采纳 P0→P1→P2→P3 / B. 只做 Layer 1 / C. Layer 1 + Layer 2 / D. 自定义 |
| **选择** | **C. Layer 1 + Layer 2** |
| **理由** | 1. Layer 1（Hard Gate：DbC + Capability + depth/role + hash chain）解决"事中拦截"——这是最大痛点；2. Layer 2（主动 supervision：Erlang OTP 式 supervisor）解决"worker 失败即时接管"——不等 TAO Watcher 下个 tick；3. Layer 3 已有 TAO Watcher（周期审计），强化（加 liveness heartbeat）可放 P2；4. Layer 4 是 Proma 平台改造（subagent_trace_id）、依赖 Anthropic/Proma 官方，本项目不可控 |
| **风险** | Layer 1 + Layer 2 同时改 tree-state.js，可能有合并冲突（已通过 Phase A→B 串行执行缓解）。主动 supervision 改 commander SKILL.md，可能影响现有 16 个历史 tree 续跑（已通过只对新 tree 生效策略缓解）。 |
| **用户确认状态** | 待确认 |

---

## 决策 3：层级深度限制

| 维度 | 内容 |
|---|---|
| **决策内容** | 限制 tree 的最大层级深度为多少？ |
| **选项** | A. depth ≤ 2 / B. depth ≤ 3 / C. depth ≤ 4 / D. 不硬限制 |
| **选择** | **B. depth ≤ 3（默认 3，硬上限 5）** |
| **理由** | 1. 80% 任务 depth ≤ 2 能搞定（扁平化 + worker multi-step plan）；2. 大任务确实需要 sub-commander 时，强制用更强模型兜底；3. depth ≥ 4 明确禁掉（每层指令保真度掉 39%，4 层 = 84.8% 信息丢失）；4. Anthropic 自己只用 2 层，3 层以上无公开生产案例；5. qfv2 实测 5 层失控是反面教材；6. 配套 `root_dod.max_depth` 可配置，用户按需调整 |
| **风险** | qfv2 这种已跑的 5 层 tree 无法继续 add leaf（处理方式：保留原样，下次 add 被拦，用户可选择扁平化重组或 split meta-tree）。业务方可能抱怨限制太严。sub-commander 强模型成本（Claude Opus 比 DeepSeek 贵约 10 倍）。 |
| **用户确认状态** | 待确认 |

### depth 限制的代码落地

```js
// tree-state.js cmdLeafAdd 加 depth 校验
const depth = computeLeafDepth(state, args.parent);
const maxDepth = state.root_dod?.max_depth || 3;
if (depth >= maxDepth) {
  throw new TreeStateError(E_TREE_DEPTH_EXCEEDED, ...);
}

// role 加 enum 校验
const ALLOWED_ROLES = ['root', 'commander', 'worker', 'auditor', 'integrator'];
if (!ALLOWED_ROLES.includes(args.role)) {
  throw new TreeStateError(E_ROLE_INVALID, ...);
}
```

---

## 决策 4：Capability Token 优先级

| 维度 | 内容 |
|---|---|
| **决策内容** | Capability Token 机制（Fork 时颁发，工具调用前校验）应该放在什么优先级？ |
| **选项** | A. P0 立即做 / B. P1 跟 DbC 一起 / C. P2 中期做 / D. 不做 |
| **选择** | **B. P1（v0.7 Phase C，排在 DbC 之后）** |
| **理由** | 1. DbC 是"函数调用前校验"（tree-state.js 子命令层），Capability 是"工具调用前校验"（Proma 平台工具调用层），两者互补不重叠；2. 单 DbC 不够——worker 可以直接调 write_file 绕过 tree-state.js 子命令；3. 但 Capability 需要改 Proma 平台的工具调用拦截层（patches.cjs），复杂度高，依赖 Proma 官方基础设施；4. 折中：先做 DbC（Phase A，1-2 天），看效果再决定 Capability 是否加速或降级；5. 起草人推荐将 Capability 定为 P1 而非 P0，因为"改平台层"的不确定性比"改 tree-state.js"大得多 |
| **风险** | 如果 Phase A（DbC）做完后 commander 仍在绕过 tree-state.js 子命令（例如不调 audit-gate 直接调 tree set-status archived），则 Phase C 必须加速到 P0。Token 不能放 prompt 里（LLM 会读到并学会自降权）——这个约束决定了实现复杂度，不是简单的 prompt 注入。 |
| **用户确认状态** | 待确认 |

---

## 决策 5：v0.5 / v0.6 / v0.7 合并方案

| 维度 | 内容 |
|---|---|
| **决策内容** | 三套计划（v0.5 用户层 bug + v0.6 审计硬约束 + v0.7 三层防御架构）如何合并？ |
| **选项** | A. 全部合并为 v0.7 / B. 三套并行 / C. v0.5+v0.6 合并为 v0.7（Capability+supervision 推 v0.8）/ D. 自定义 |
| **选择** | **A. 全部合并为 v0.7** |
| **理由** | 1. v0.5 / v0.6 高度耦合（都改 tree-state.js + commander/worker SKILL.md），分批做反而增加 migrate 次数（每次都要让历史数据合规）；2. 一次性 commit 减少协调成本；3. v1 审议时用户已确认偏好"全部修完一次性 commit"；4. v2 诊断报告明确了架构层硬约束是根本解法——分散实施等于持续暴露于已知风险；5. v0.7 按优先级分 Phase A-G，逻辑清晰，不混乱 |
| **风险** | 总工作量约 2-3 周编码，用户可能等不及。中间任何一步出错可能阻塞整个 v0.7 release。缓解：Phase A 和 D 并行，A 完成后即可出阶段性成果（DbC 已生效）。 |
| **用户确认状态** | 待确认 |

### 合并后的 v0.7 Phase 映射

| v0.7 Phase | 原计划来源 | 内容 |
|---|---|---|
| Phase A | v0.6 Phase 6 + v2 新增 | DbC 硬约束 9 子步骤（CP1-CP6+SP1+SP4+depth+role） |
| Phase B | v2 新增 | 主动 Supervision |
| Phase C | v2 新增 | Capability Token |
| Phase D | v0.5 | 用户层 Bug 修复（剪枝/skill 全局/watcher） |
| Phase E | v2 新增 | Event Hash Chain + Snapshot |
| Phase F | v2 新增 | Liveness Heartbeat |
| Phase G | — | 部署 + 验证 + Wiki + Commit |

---

## 决策 6：复杂任务的替代方案

| 维度 | 内容 |
|---|---|
| **决策内容** | 层级深度限制（depth ≤ 3）后，需要多级拆分的大任务用什么方案替代嵌套 sub-commander？ |
| **选项** | A. 默认方案 A（扁平化），备选 B（meta-tree）/ B. 默认方案 C（depth ≤ 3 + sub-commander 强模型）/ C. 三种方案都支持，用户在 root_dod 里选 / D. 只支持方案 A |
| **选择** | **C. 三种方案都支持** |
| **理由** | 1. 用户业务多样：小任务扁平化（方案 A），超大任务 meta-tree（方案 B），特殊场景 sub-commander（方案 C）；2. 通过 `root_dod.max_depth` + `root_dod.tree_mode` 字段让用户在 brief 里声明；3. 默认值：max_depth=3, tree_mode=flat（方案 A），覆盖 80% 任务；4. tree-state.js 校验时按 root_dod 走，不硬编码单一路径 |
| **风险** | 三种模式都要测试，测试工作量增加。meta-tree（方案 B）跨 tree 协调机制需要单独设计——这是 v0.8 候选，当前 v0.7 只在 schema 层面预留字段，不实现完整跨 tree 协调。 |
| **用户确认状态** | 待确认 |

### root_dod 字段扩展

```js
root_dod: {
  deliverables: [...],
  must_contain: [...],
  quality_gates: [...],
  // v0.7 新增:
  max_depth: 3,               // 默认 3，硬上限 5
  max_leaves: 10,             // 已有
  node_budget: 10,            // 已有（CP4）
  tree_mode: 'flat',          // 'flat' | 'meta' | 'hybrid'（方案选择）
  allow_sub_commander: true,  // tree_mode=hybrid 时才允许
}
```

---

## 决策 7：Migrate 策略

| 维度 | 内容 |
|---|---|
| **决策内容** | 16 个历史 tree（含 qfv2 的 5 层深结构）如何处理？ |
| **选项** | A. 强制 migrate / B. 只对新 tree 生效 / C. 不覆盖策略（按版本号判断）/ D. 强制回滚超限数据 |
| **选择** | **B + C 组合：只对新 tree 生效 + skill 更新才覆盖（版本号比较）** |
| **理由** | 1. 历史 archived tree 已经收尾，强行 migrate 没意义且可能产生 warning 噪音；2. qfv2 这种活跃的 5 层 tree，下次 add leaf 时会被 depth 校验（A9）自然拦住——不用强制回滚；3. skill 用版本号判断，避免覆盖用户在新 ws 手改的内容（v1 审议时已选不覆盖策略）；4. 历史 self_check 字符串（"all_pass"）自动转为数组，打 warning 但不 blocking |
| **风险** | 历史 tree 数据 schema 不一致（旧字段 vs 新字段），未来 debug 困难。qfv2 这种 5 层 tree 续跑时被拦，用户体验差但安全必须。 |
| **用户确认状态** | 待确认 |

### 特殊情况矩阵

| 情况 | 处理 |
|---|---|
| 新创建的 tree | 完全合规（depth/role/schema 全部硬校验） |
| 历史 2 层 tree 续跑 | 正常，不受 depth 限制影响 |
| qfv2 5 层 tree 续跑 | 禁止 add leaf（depth ≥ 3），保留已有节点。用户可选择扁平化重组或 split meta-tree |
| 已 archived tree | 不做任何改动。migrate 打 warning 但不 unarchive |
| 历史 self_check="all_pass" | 自动转为 `[{item:"legacy",pass:true,evidence:"migrated"}]`，打 warning |
| skill 版本更新 | 用 semver 比较，只覆盖旧版本 |

---

## 决策 8：测试方法

| 维度 | 内容 |
|---|---|
| **决策内容** | v0.7 完成后用什么验证方法？ |
| **选项** | A. 只重跑 mdref/pytut / B. 只做 depth/role 压力测试 / C. 只做 capability 攻击测试 / D. 全部都做 |
| **选择** | **D. 全部都做（6 组测试）** |
| **理由** | 1. v0.7 改动面大（15+ 文件，12+ 新错误码），单一测试不够；2. T1+T2（重跑 mdref/pytut）验证 v0.6 Phase 6 的 6 个 CP 是否消失；3. T3+T4（depth/role 压力）验证议题 3 的 depth 限制 + role enum；4. T5（capability 攻击）验证议题 4 的 Capability Token；5. T6（主动 supervision）验证议题 2 的 Layer 2；6. 三组测试互不重叠，覆盖所有新增机制 |
| **风险** | 6 组测试全做工作量大。缓解：T1-T4 可在 Phase A 完成后立即执行（1 小时内），T5-T6 在 Phase B+C 完成后执行。全量回归在 Phase G 部署前执行。 |
| **用户确认状态** | 待确认 |

### 测试矩阵

| ID | 名称 | 验证目标 | 通过条件 | 执行时机 |
|---|---|---|---|---|
| T1 | mdref 回归 | CP1-CP6 消失 | 6 个 CP 全部通过 | Phase A 完成后 |
| T2 | pytut 回归 | 同上 | 6 个 CP 全部通过 | Phase A 完成后 |
| T3 | depth 压力 | depth ≤ 3 硬限制 | depth=4 → throw E_TREE_DEPTH_EXCEEDED | Phase A（A9）完成后 |
| T4 | role enum | 自由文本 role 被拒 | role="custom" → throw E_ROLE_INVALID | Phase A（A9）完成后 |
| T5 | capability 攻击 | 越权工具调用被拒 | worker 调 write_file → throw E_CAPABILITY_DENIED | Phase C 完成后 |
| T6 | supervision | worker 失败 commander 接管 | mock fail → commander retry/escalate | Phase B 完成后 |

---

## 决策 9：Fork 机制验证结论

| 维度 | 内容 |
|---|---|
| **决策内容** | Fork 之后的子 session，系统提示词和 Skill 上下文是否和源 session 完全一致？这个验证结论如何影响 A/B/C 路线优先级？ |
| **验证方法** | 阅读 `main.cjs` 中 `forkAgentSession()` / `buildSystemPrompt()` / `query()` 的代码实现 |
| **结论** | **Fork 之后的子 session，系统提示词和 Skill 与源 session 完全一致。** 原因：(a) Skill 是 workspace 级别的，不是 session 级别的；(b) System Prompt 每次 query() 时动态生成，不持久化；(c) Fork 与 Create 在提示词层面没有本质区别——唯一差异是 Fork 复制了消息历史和 workspace 文件；(d) Worker session 确实拥有全部规则——Commander 有的 tree-commander skill、tree-worker skill、系统提示词，worker 都有 |
| **对路线的影响** | 排除了"worker 没收到规则"的假设，锁定了真正的根因：**模型看到了规则但仍然选择不执行**。软约束在跨 session 压力下被模型选择性忽略。这使路线 A（工具层硬约束）优先级进一步上升——既然模型能看到规则但可以不遵守，那就让代码在写入路径上强制校验。路线 B（平台层注入树身份）方向微调：不再是"补全丢失的规则"，而是**新增当前不存在的树身份信息**（如 worker 不知道自己在这个 tree 中是什么角色、父节点是谁、兄弟节点有哪些）。 |
| **风险** | 验证是基于代码阅读的静态分析，未通过实际 Fork+query 动态验证。但 main.cjs 的代码逻辑足够清晰，静态分析的置信度很高。 |
| **用户确认状态** | 待确认 |

---

## 决策 10：用户四个问题的答案

| 维度 | 内容 |
|---|---|
| **决策内容** | 用户在 v2 诊断过程中提出的四个根本性问题的答案是什么？ |
| **四个问题** | Q1: 是 prompt 问题还是模型 + harness 机制问题？ Q2: "天道机制"能不能解决？ Q3: 开源框架有没有现成的？ Q4: "严格 2 层"是什么？和当前结构对比？ |
| **选择（答案）** | 见下表 |
| **理由** | 基于 v2 报告三家调研结论 + qfv2 实际数据回溯 + 用户自己的判断（如"13 条铁律全部应该变成代码"、"TAO 应该是代码层不应在 Agent 层递归"） |
| **风险** | 这些答案驱动了整个 v0.7 的设计方向。如果未来发现某个答案有偏差（如 prompt 实际可解 > 30%），部分 Phase 可能过度工程。 |
| **用户确认状态** | 待确认 |

### Q1: 是 prompt 问题还是模型 + harness 机制问题？

| 因素 | 占比 | 可否改变 | 对应 v0.7 Phase |
|---|---|---|---|
| prompt 表达不够结构化 | 30% | 可优化（但不作为 v0.7 重点） | — |
| 模型 RLHF 副产物（sycophancy/reward hacking） | 30% | prompt 改不动 | — |
| Agent harness 缺少硬约束层 | 40% | **可改（v0.7 的核心）** | Phase A-C |

### Q2: "天道机制"能不能解决？

| 结论 | 细节 |
|---|---|
| **部分能，但不能作为唯一防线** | "天道"（TAO Watcher 周期审计）对应工业界的 Watchdog Timer / PDCA Check 阶段——只能发现"慢死"，发现不了"瞬死"。Erlang OTP 是事件驱动主动接管——child 失败那一刻 supervisor 立即接管，不等下个 tick。 |
| v0.7 定位 | Layer 1（DbC + Capability）事中拦截 → Layer 2（主动 supervision）失败即时接管 → Layer 3（TAO Watcher + liveness）周期兜底。三层叠起来才是真正的 defense in depth。 |

### Q3: 开源框架有没有现成的？

| 结论 | 细节 |
|---|---|
| **没有完全解决的，但有大量可借鉴机制** | LangGraph State Schema + Checkpointer（结构化输出强制校验）、MetaGPT SOP + Structured Output（减少 hallucination cascading）、Erlang OTP Supervisor（主动监督的成熟答案）、seL4/Fuchsia Capability-based Security（最小权限的成熟答案）、Anthropic 自己只用 2 层（3 层以上是未验证地带） |
| 关键发现 | CrewAI（最像 Proma 痛点场景）的 Manager agent 只认得自己、把所有任务自己做了——纯 prompt 驱动的 delegation 在生产环境不可靠。这反向验证了 v0.7 的架构层硬约束方向。 |

### Q4: "严格 2 层"是什么？和当前结构对比？

| 维度 | 当前结构（qfv2 式） | 严格 2 层 | v0.7 折中 |
|---|---|---|---|
| 深度 | 实际跑到 5 层 | 硬限 2 层 | depth ≤ 3（默认 3，硬上限 5） |
| commander 数 | 1 + 8 个 sub-commander | 只有 1 个 root | 最多 root + 1 层 sub-commander |
| 指令保真度 | 每层掉 39%，5 层 = 92% 信息丢失 | 1 层传递，掉 39% | 2 层传递，掉约 62%（在可接受边界） |
| Anthropic 实践 | 从未做过 3 层以上 | 2 层正是 Anthropic 自己用的 | 3 层是 Anthropic 的未验证地带但有 Erlang OTP 工业先例 |
| 复杂任务拆法 | 嵌套 sub-commander | 扁平化 + worker multi-step plan | 扁平化/ meta-tree/ sub-commander 三选一 |

---

## 决策汇总

| # | 决策 | 选择 | 一句话 |
|---|---|---|---|
| 1 | 核心论断 | A 完全接受 | 30% prompt + 30% RLHF + 40% harness → 重点改 harness |
| 2 | 五层架构范围 | C Layer 1+2 | Hard Gate + 主动 supervision = 覆盖 80% 痛点 |
| 3 | 层级深度 | B depth ≤ 3 | 默认 3，硬上限 5，禁掉 qfv2 式 5 层 |
| 4 | Capability 优先级 | B P1 | 先做 DbC（P0），Capability 跟后（需改平台层） |
| 5 | 计划合并 | A 全部合并为 v0.7 | 7 个 Phase，A-G，一次性 commit |
| 6 | 复杂任务方案 | C 三种都支持 | root_dod 可配，默认扁平化 |
| 7 | migrate 策略 | B+C 组合 | 只对新 tree + 版本号不覆盖 |
| 8 | 测试方法 | D 全部做 | 6 组测试（回归+压力+攻击+supervision） |
| 9 | Fork 验证 | 提示词完全一致 | 排除了"规则丢失"假设，锁定"模型选择不执行" |
| 10 | 用户四问题 | 已回答 | 机制 > prompt / 天道不够 / 有借鉴无现成 / 严格 2 层折中为 3 层 |

---

## 附录 A: 待用户确认的开放项

| # | 开放项 | 当前推荐 | 是否需要用户确认 |
|---|---|---|---|
| 1 | 10 个决策的整体方向 | 见上表 | **是（最关键）** |
| 2 | root_dod.max_depth 默认值 | 3（硬上限 5） | 是 |
| 3 | root_dod.tree_mode 默认值 | 'flat' | 是 |
| 4 | Phase C（Capability Token）是否要在 Phase A 效果不好时加速到 P0 | 先观察 | 是（定判断标准） |
| 5 | qfv2 的 5 层 tree 是否接受"续跑被拦" | 保留原样 + 被拦 | 是 |
| 6 | migrate 后历史 self_check 转为数组的打 warning 策略 | 自动转 + warning | 是 |
| 7 | Phase G commit 是否一 commit 全包含 | 是 | 用户偏好确认 |

---

> **本决策日志由 Proma Agent 撰写，2026-06-23**
> **配套文档**: `03-implementation-roadmap.md`
> **状态**: 待用户逐项确认（本日志中的"待确认"状态将在用户审议后更新为"已确认/已修改/已拒绝"）
