# 用户故事（User Stories）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（补 SubAgent A 指出的 user stories 缺口）
> 配套：[layer2-user-scenarios.md](./layer2-user-scenarios.md)（场景叙事）· [../使用场景-Agent团队协作开发流程.md](../使用场景-Agent团队协作开发流程.md)（Layer 1 场景）· [product-positioning.md](./product-positioning.md)

本文把 Layer 1 + Layer 2 的场景**合并去重，转写成标准 user stories**（As-a/I-want/so-that + 验收标准 + MoSCoW 优先级），供 [sprint-plan.md](../05_PROJECT_PLAN/sprint-plan.md) 排期与测试引用。

- **角色**：AI 开发团队 Lead（团队的技术指挥者，详见 [product-positioning §二](./product-positioning.md)）
- **格式**：`As a <角色>, I want <能力>, so that <价值>.` + 验收标准 + MoSCoW + 关联

---

## Must Have（v1 核心，必须满足）

### US-001 ｜主线：设计→拆解→并行开发→汇总 + 独立审计 ｜ Must ⭐
**As a** 团队 Lead，**I want** 把一个项目拆成子任务让多个 agent 并行实现，并对每个产出独立审计后汇总，**so that** 并行提速、审计防走捷径、成本可控。

**验收标准**：
- Given 一个项目，When Lead 建树下发 5 件套契约，Then 可派 N 个 worker 并行（受 node_budget 约束）
- Given worker 声明 done，Then 必须过 audit_gate（独立 auditor pass + alignment 回填 + self_check 有效）
- Given worker 伪完成/自审，Then 被 caller-binding + E_BORROWED_IDENTITY 拦截
- Given 成本接近 node_budget / subagent_spawn / create_session budget 上限，Then 引擎拒绝新建
- Given 所有 worker done，Then root 可汇总归档

**关联**：[layer2-user-scenarios §三](./layer2-user-scenarios.md) · [team-config](./team-config.md)（worker/auditor）· [cost-guardrails](./cost-guardrails.md) · Sprint 1-2

---

### US-002 ｜深度探索：从任意一轮 Fork 重试 ｜ Must
**As a** 团队 Lead，**I want** 从任务的任意一轮 fork 出新分支重试，**so that** 探索多个方案/回退错误方向，不破坏主线。

**验收标准**：
- Given 一个 leaf 的某一轮，When Lead fork，Then 新 session 继承历史 + 独立推进
- Given fork 副本，Then 不能冒充原身份注册 leaf（caller-binding E_BORROWED_IDENTITY）
- Given fork 深度，Then 受 MAX_DELEGATION_DEPTH 约束（E_DELEGATION_TOO_DEEP）

**关联**：Layer1 场景 2 · fork_session / leaf_add caller-binding · Sprint 1

---

### US-003 ｜竹节交接：上下文甜点区自动护航 ｜ Must
**As a** 团队 Lead，**I want** 长任务跨会话延续时，上下文自动保持在「甜点区」（不溢出不丢失），**so that** 长任务不因上下文腐化而失忆或爆炸。

**验收标准**：
- Given leaf context 接近阈值，Then 自动 fork 新竹节继承 ownership + 历史
- Given 竹节交接，Then 5 件套契约不丢失（brief/dod/expect_outputs）
- Given 旧竹节，Then 可归档不阻塞

> ⚠️ 当前 gap：竹节自动触发未实现（ctx 全 0，ISS-007 / methodology-coverage-audit 约束 6）。验收标准第 1 条 v1 不满足，Sprint 2 补。

**关联**：Layer1 场景 3 + Layer2 场景 3 · segment_append / ctx 监测 · Sprint 2

---

## Should Have（v1 重要，尽量满足）

### US-004 ｜多视角设计评审 ｜ Should
**As a** 团队 Lead，**I want** 一份设计文档用多个独立 agent 从不同视角（架构/安全/UX/成本）评审，**so that** 设计质量多维保障，单视角盲点被补上，防互审洗白。

**验收标准**：
- Given 设计产出，Then 有 ≥4 个独立审查 leaf（tree-audit 铁律 1）
- Given review_round，Then red_count=0 才算收敛（防假收敛，P1b fix_evidence）
- Given 祖先 leaf 有 flagged 未补审，Then 拒绝建子 leaf（E_REVIEW_FLAGGED_BLOCK）

**关联**：Layer2 场景 4 · review_round / E_REVIEW_FLAGGED_BLOCK · Sprint 2

---

### US-005 ｜对抗式洁净室测试 ｜ Should
**As a** 团队 Lead，**I want** 对 agent 产出做独立洁净室测试（实现者不参与测试设计），**so that** 暴露确认偏误，发现实现者盲点。

**验收标准**：
- Given 测试任务，Then 测试 agent 禁看实现者测试，从 spec 写
- Given 多视角（功能/对抗/端到端/Prompt injection），Then Cr 洁净室优先于 A1 代码层评
- Given 洁净室发现失守，Then 计入回归测试

**关联**：Layer2 场景 2 · commander-methodology-v10 §4.1 · Sprint 2

---

### US-006 ｜跨工作区协作 ｜ Should
**As a** 团队 Lead，**I want** 跨工作区/跨实例调度 agent，**so that** 不同工作区的专长 agent 能协作。

**验收标准**：
- Given 跨工作区操作，Then workspace_id 校验（R2/R4）
- Given 跨实例（dev/pro/release），Then remote-session 工具可用 + instance 参数

> 🟡 当前状态：R2/R4 workspace_id 校验**已落地**（create_session/fork_session 入口，2026-06-26）；patches.cjs 补丁 + main.cjs 白名单待补（CHANGELOG [Unreleased]），Sprint 4 补全。

**关联**：Layer1 场景 4 · remote-session 工具 / workspace_id 校验 · Sprint 4

---

## Could Have（v1 可选，有时间再做）

### US-007 ｜事故复盘 + IHL 加固 ｜ Could
**As a** 团队 Lead，**I want** 一次事故被系统化复盘并转化为加固，**so that** 同类事故不复发。

**验收标准**：
- Given 事故，Then 洁净室多 agent 分析根因 + IHL 迭代加固
- Given 加固，Then 回归测试验证 + 沉淀进 CLAUDE.md P0 教训

**关联**：Layer2 场景 5 · IHL 方法论 · 持续（非单一 Sprint）

---

### US-008 ｜外部工具编排（Claude Code 作为调度中心）｜ Could
**As a** 团队 Lead，**I want** 用外部工具（如 Claude Code）作为调度中心编排 Proma agent，**so that** 利用外部工具的能力补充 Proma。

**验收标准**：
- Given 外部 MCP 客户端，Then 可经 MCP 桥接调用 Proma session/tree 工具
- Given 编排，Then 受同样的预算护栏 + caller-binding 约束

**关联**：Layer1 场景 5 · MCP 桥接（proma-mcp-server.cjs）· 持续

---

## Won't Have（v1 明确不做，留上游或未来）

### US-W1 ｜树形 UI 可视化面板 ｜ Won't（v1）
**As a** 团队 Lead，**I want** 在 Proma 侧边栏看到树形可视化……
→ **v1 不做**：需改 Proma renderer（打包 bundle），留给 Proma 上游（ISS-002）。tree-harness 仅提供 tree_* 查询工具供外部渲染。

### US-W2 ｜垂直业务定制 ｜ Won't（v1）
→ **v1 不做**：垂直化是未来可能产品形态（product-positioning §四），当前 v1 聚焦基础设施 + 上游补丁。

### US-W3 ｜Layer 2 主动 Supervision / Layer 4 模型契约 ｜ Won't（v1）
→ **v1 不做**：设计完成未实现 / 平台层依赖未就绪（未来 v2+）。

---

## 优先级矩阵

| ID | 用户故事 | MoSCoW | 关联 Sprint | 当前可用性 |
|---|---|---|---|---|
| US-001 | 主线并行+审计 | Must | 1-2 | 🟡 部分（auditor fallback gap）|
| US-002 | 深度 Fork | Must | 1 | ✅ 可用 |
| US-003 | 竹节交接 | Must | 2 | 🔴 自动触发未实现 |
| US-004 | 多视角评审 | Should | 2 | 🟡 部分（§14 gap）|
| US-005 | 洁净室测试 | Should | 2 | ✅ 可用 |
| US-006 | 跨工作区 | Should | 4 | 🟡 R2/R4 已落地，patches/白名单待补 |
| US-007 | 事故复盘 IHL | Could | 持续 | ✅ 可用 |
| US-008 | 外部编排 | Could | 持续 | ✅ 可用 |

**v1 可用性结论**：8 个故事中 4 个完全可用（US-002/005/007/008），3 个部分可用（US-001/004 + 依赖修复），1 个核心未实现（US-003 竹节，Sprint 2 补）。**Must 的 3 个里，US-003 是 v1 最大缺口**。

---

## 维护约定
- 新增场景 → 转写成 user story 进本表（带 ID + 验收 + MoSCoW）
- sprint-plan 排期引用本表 ID（如 Sprint 2 做 US-003/004）
- 测试用例引用 user story 验收标准（Given/When/Then）
