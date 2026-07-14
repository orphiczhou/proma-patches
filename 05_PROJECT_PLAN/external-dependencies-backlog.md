# 外部依赖 Backlog（Sprint 6 产品化）

> 维护：周星星 | 产出：2026-07-14 tree-harness 子会话
> 配套：[sprint-plan.md](./sprint-plan.md) Sprint 6 · [first-pr-draft.md](./first-pr-draft.md) · [experiment-design.md](./experiment-design.md)

tree-harness 单边（子会话/研究者）能做的已做完（Sprint 1-6 准备）。剩余推进**全部依赖外部**（用户 GitHub / 上游维护者 / 真实团队 / Proma SDK 团队）。本文集中标记，明确「单边已做 vs 外部待办 vs 阻塞谁」。

---

## 一、外部依赖总表

| # | 外部依赖 | 单边已做（tree-harness 侧） | 外部待办 | 阻塞 | 优先级 |
|---|---|---|---|---|---|
| E1 | 首个 Proma PR 提交 | [first-pr-draft.md](./first-pr-draft.md)（补丁适用性评估 + 推荐路径 + PR 材料模板） | clone 上游 v0.13.x 源码核实 gap → fork `orphiczhou/Proma` 提 PR → 上游 review | success-metrics §二A 维护者维度全部数据 | 🔴 v1 首要里程碑 |
| E2 | 真实团队试用（2-3 AI 团队） | product-positioning/team-config/success-metrics 团队维度框架 + tree-commander/worker SKILL | 找 2-3 个 AI 团队试用 + 收集反馈 | success-metrics §二B 团队维度数据 | 🟠 v1 验证 |
| E3 | 对照实验执行 | [experiment-design.md](./experiment-design.md)（3-5 任务 × 3 模式 + 指标协议 + 归因） | 跑 45 次任务（5×3×3）+ 聚合分析 | success-metrics §二B 速度/成本/质量实测 | 🟠 v1 验证 |
| E4 | Proma SDK create_session 回调钩子 | Sprint 5 单边缓解（patches findCallerTreesForBypassGuard + max_sessions 预检 + 旁路登记） | Proma SDK 团队加 create_session 回调 + subagent_trace_id | 聚类 A 根治（Layer 4 平台层） | 🟡 跨仓根治 |
| E5 | Proma fork identity timeout 修复 | Sprint 5 SKILL §13.4.5 fallback（归档卡死 session + 重 fork + set-session） | Proma app 团队修 fork identity（BUG-A） | auditor role 端到端无 fallback 依赖 | 🟡 跨仓根治 |

---

## 二、各依赖详情

### E1 首个 Proma PR 提交（🔴 v1 首要里程碑）

**为什么是首要**：success-metrics §二A 维护者维度当前全为 0/N/A（未提交任何 PR）。这是从「孵化」走向「合并」的第一步，决定 tree-harness「上游补丁孵化场」定位是否成立。

**单边已做**：
- ✅ [first-pr-draft.md](./first-pr-draft.md)：颠覆性结论——补丁 I/J/F/H 全不适合上游（I 有害 / J 无场景 / F-H 方向相反于上游 #903）。
- ✅ 推荐路径：基于研究经验在上游 v0.13.x 找真实改进点（方向 1：MCP 会话频道/模型一致性）。
- ✅ PR 材料模板 + 风险评估 + 回滚方案。

**外部待办**：
1. clone `proma-ai/Proma` v0.13.x 源码，核实方向 1 的 gap 真实存在（定位 `agent-session-manager.ts`/`agent-orchestrator.ts`）。
2. 在 `orphiczhou/Proma` fork 验证 + 写测试。
3. 提 PR 到 `proma-ai/Proma`（上游有 PR Bounty，维护者欢迎 PR）。
4. 等 ErlichLiu review/merge。

**阻塞**：维护者维度全部数据（合并率/合并数/合并周期/回滚率/反馈）。

---

### E2 真实团队试用（🟠 v1 验证）

**为什么需要**：success-metrics §六诚实声明「无真实团队使用，仅研究者 n=1」。n=1 数据无法证明「AI 开发团队受益」（product-positioning §二最终受益者），也无法排除操作者偏好的混淆（experiment-design §八）。

**单边已做**：
- ✅ product-positioning 两层客户框架 + team-config（角色↔模型↔工具↔成本矩阵）。
- ✅ success-metrics §二B 团队维度指标框架。
- ✅ tree-commander/worker/auditor SKILL（团队可直接用）。
- ✅ cost-guardrails.md（macp2 教训 + 预算护栏）。

**外部待办**：
1. 找 2-3 个 AI 开发团队（小团队 Lead + Agent）愿意试用。
2. 提供部署 + SKILL + 场景文档，收集「速度/成本/质量」主观 + 客观反馈。
3. 聚合反馈回填 success-metrics §二B。

**阻塞**：团队维度「多 agent vs 单 agent 收益」的可信数据。

---

### E3 对照实验执行（🟠 v1 验证）

**为什么需要**：success-metrics §三两条基线（裸 prompt / Layer1-only）当前**未采集**（§六 gap）。无基线则产品指标无意义。

**单边已做**：
- ✅ [experiment-design.md](./experiment-design.md)：5 任务 × 3 模式 × 3 重复 = 45 次。
- ✅ 解决 §三 gap：Layer1 边界界定（budget rate∈Layer1 / max_sessions count∈Layer2）。
- ✅ 指标采集协议 + 归因方法 + 预期假设。

**外部待办**：
1. 准备 3 实例（A 裸 prompt / B Layer1-only / C tree-system 隔离配置）。
2. 写 5 任务 spec + 验收脚本。
3. 跑 45 次任务（成本 ~$45-225 + ~10-20 小时）。
4. 聚合 + 归因分析，回填 success-metrics §二B。

**阻塞**：速度/成本/质量的实测对照数据。

---

### E4 Proma SDK create_session 回调钩子（🟡 跨仓根治）

**为什么是跨仓**：聚类 A 根因——tree engine 与 Proma SDK 间无双向契约，agent 用 SDK 原生 create_session 旁建 session 时 engine 零感知（macp2 207 session 不入树）。真正根治需 SDK 层回调钩子 + subagent_trace_id（Layer 4 平台层 capability-based 调用 + event hash chain，SECURITY §4.3 远期路线）。

**单边已做**（Sprint 5，降风险非根治）：
- ✅ engine max_sessions 硬护栏（session_registry 四路径登记 + E_MAX_SESSIONS）。
- ✅ patches findCallerTreesForBypassGuard（定位 caller tree）+ max_sessions 预检（钱没花先拦）+ 旁路登记（register-session 让旁路 create 可见）。
- ✅ MCP 工具 tree_register_session / tree_session_count。

**外部待办**：Proma SDK 团队在 create_session 路径加回调钩子（让 engine 可订阅 session 创建事件）+ subagent_trace_id（调用链追溯）。

**阻塞**：聚类 A 完全根治（当前单边缓解把 207 降到 max_sessions=50 兜底，但旁路 create 仍是 best-effort 登记，非硬契约）。

---

### E5 Proma fork identity timeout 修复（🟡 跨仓根治）

**为什么是跨仓**：auditor role 端到端依赖 Proma fork 创建独立审计 session，但 fork identity timeout（BUG-A）导致 auditor session 卡死。这是 Proma app 层 bug。

**单边已做**（Sprint 5，SKILL fallback 非根治）：
- ✅ commander SKILL §13.4.5：root 归档卡死 session + 重 fork + leaf set-session 换新 session + 红线（重 fork ≤2 次，归档不释放 max_sessions 额度）。
- ✅ 替代方案回退 §13.4.4 root 信任锚（不依赖 fork，无 identity timeout 风险）。

**外部待办**：Proma app 团队修 fork identity（让 fork 可靠创建独立 session）。

**阻塞**：auditor role 完全自动化（当前靠 SKILL fallback + 人工介入归档）。

---

## 三、单边 vs 外部边界原则

为避免子会话/研究者「强行做外部项」导致浪费，明确原则：

| 能做（单边） | 不能做（外部） |
|---|---|
| 文档/设计/脚本/SKILL/引擎改动/测试 | 用户 GitHub 操作（提 PR/fork） |
| 研究者 n=1 自用数据采集 | 上游维护者响应（review/merge） |
| 框架/协议/评估 | 真实团队意愿 + 反馈 |
| 单边缓解（降风险） | 跨仓根治（改 Proma SDK/app） |

**Sprint 6 准备阶段，子会话已把所有「能做」做完**。剩余 E1-E5 的「外部待办」列即交接给用户/上游/团队的明确清单。

---

## 四、建议执行顺序（给用户）

1. **E1（PR）先行**：维护者维度是 v1 首要里程碑，且不依赖团队。建议用户优先 clone 上游核实 + 提首个 PR。
2. **E3（实验）次之**：研究者可独立跑（不需团队），产出 success-metrics §二B 基线数据。成本可控（$45-225）。
3. **E2（团队）并行**：找团队的同时跑实验，团队反馈补 n=1 偏差。
4. **E4/E5（跨仓）长期**：依赖 Proma 团队，标记汇报，不阻塞 v1。
