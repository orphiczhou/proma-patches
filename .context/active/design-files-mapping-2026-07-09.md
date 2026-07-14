# Tree-Harness 设计文件结构映射与缺口分析

> 维护：周星星 | 产出：2026-07-09 会话 bbdefd1e（5 路 SubAgent 并行深读 + 父会话交叉印证）
> 参照模板：`D:\Codes\multi-agent-collab-platform`（代号 nanju）的 01–06 产品设计文档体系
> 配套文档：[improvement-report-2026-07-09.md](./improvement-report-2026-07-09.md)（待改进报告/问题清单）

---

## 一、背景与方法

用户指令：参考 nanju 项目的设计文件结构，依据 tree-harness 现有文档，**构建完整的设计文件**，并发现**逻辑不自洽与设计问题**，产出待改进报告。

执行方式：5 路 general-purpose SubAgent 并行深读，分域输出「完整性评估 + 问题发现」：

| Agent | 负责域（对照模板） | 产出 |
|---|---|---|
| A | 产品定位与需求（01_PRD） | 8 项完整性评估 + 7 个定位问题 + 8 份缺失文件 |
| B | 架构与 API（03+04） | 架构/API 完整性 + 6 个跨文档矛盾 + 8 份缺失文件 |
| C | 方法论与流程（05+DEV） | 7 项完整性 + 6 个方法论↔事故 gap + 5 份缺失文件 |
| D | 安全与设计缺陷（06+SEC+事故） | 23 条问题总表 + 5 聚类根因 + Top5 |
| E | note.md（181KB）长期笔记挖掘 | 10 条独家发现 + 6 处跨时间矛盾 + 隐含待办 |

父会话额外做**交叉印证**：核实 SubAgent 间冲突的状态声明（如 BUG-2 已修 vs 待修）、确认文档落点、发现双 `.context` 漂移。

---

## 二、参考模板解析（nanju 01–06 设计哲学）

nanju 的文档体系是一套**规范化的产品设计文档流水线**，按开发阶段编号，PRD 驱动逐层细化：

| 目录 | 核心产出物 | 设计意图 |
|---|---|---|
| `01_PRD/` | prd.md + user-stories*.md | 需求先行：产品定位、用户故事、功能/非功能需求 |
| `02_UX_DESIGN/` | sitemap / user-flows / design-system / interaction-spec / wireframes/ | 用户体验设计 |
| `03_ARCHITECTURE/` | architecture.md + class-diagram.puml + sequence-diagrams/ + data-model.md + task-pkg-d1~d4/ | 架构总览 + 类图 + 时序图 + 数据模型 |
| `04_API_SPEC/` | api-spec.md | 接口规范（参数/返回/错误码） |
| `05_PROJECT_PLAN/` | sprint-plan.md + team-config.md + workflow.md | Sprint 计划 + 团队配置 + 工作流 |
| `06_TESTS/` | test-plan.md | 测试计划 |

**四点设计哲学**：
1. **阶段编号 + 明确产出物**：每个目录对应一个开发阶段，有标准化文件名。
2. **PRD 驱动逐层细化**：需求 → UX → 架构 → API → 计划 → 测试，前层定义后层。
3. **两阶段评审**：Agent 洁净室评审 + 人机交互评审，人类有最终拍板权。
4. **设计取舍显式化**：每个 `.md` 配 `.note.md` 记录「为什么这样设计」的取舍。

---

## 三、Tree-Harness 文档现状全景

### 3.1 根目录工程文档（14 份 .md）

```
README.md          — 项目主入口（Quick Start + 架构 + 文档导航）
ARCHITECTURE.md    — 系统架构 + 三层防御 + 设计决策
API.md             — 53 个 MCP 工具参考（12 session + 12 remote + 29 tree）
SECURITY.md        — 安全模型 + 威胁模型
DEVELOPMENT.md     — 开发指南 + Tree 模式 + IHL 方法论
DEPLOYMENT.md      — 三实例部署 + 已知坑
TESTING.md         — 测试金字塔 + 金标准套件
CHANGELOG.md       — v0.16 → V10 版本演进
CLAUDE.md          — 项目知识库（P0 教训 + 部署口诀）
AGENT-PROMPT.md    — Agent 提示词
proma-dev-wiki.md  — 技术 Wiki（顶层精简版，13KB，已过时）
session-management-skill.md
使用场景-Agent团队协作开发流程.md  — 5 个 Layer1 场景（v0.10 时代）
时间线的剪枝者-Proma会话管理增强方案.md  — 设计哲学叙事（v0.10）
```

### 3.2 `.context/` 知识沉淀层（极丰富，但偏运维）

- `active/`（26 份）：大量 handoff + harness 效率研究 + macp2 事故 + 观察
- `v10/`（30+ 份）：V10 加固工程报告全集
- `reference/`：design / methodology / architecture / plans / prompts / test-plans 六子域
- `plan/`：设计文档 + 测试脚本（layer1/layer2 设计、iss-fix-plan、多个 *-test.cjs）
- `archive/`：多期归档（early-versions / handoff / l1fix / q1q3-audit / mcp-test）
- `trees/`：27 个运行时 tree-state
- `note.md`（181KB）、`PROJECT-INDEX.md`、`待解决问题清单.md`

### 3.3 现状诊断一句话

> **文档「深度」远超模板（安全加固/IHL/洁净室/信任锚等独有资产），但「产品设计视角」缺位、形式化产物（类图/时序图/formal schema）缺失、文档散落且部分失同步。** 项目主体（Layer 2 树形体系，占代码量 80%）没有配套的用户场景与 PRD，处于「实现丰满、PRD 骨感」的倒挂。

---

## 四、完整设计文件结构映射表（核心）

> 图例：✅ 已有且成文 ｜ 🟡 部分/散落/失同步 ｜ ❌ 缺失

### 4.1 对照 `01_PRD/`（产品需求）

| 模板产出物 | tree-harness 现状 | 证据 | gap |
|---|---|---|---|
| 产品定位 | ✅ 一句话清晰，但三处定位摇摆（补丁/产品/方法论） | README L16、PROJECT-INDEX L11、时间线剪枝者 L22 | 缺统合的一段话定位 |
| 目标用户/画像 | 🟡 仅作者 n=1 自画像，无用户分层 | 使用场景 L9 | 缺 user-personas |
| 核心使用场景 | 🟡 5 个场景全是 Layer1，**Layer2 零场景** | 使用场景全文 | 缺 Layer2 用户场景 |
| 用户故事 | ❌ 无标准 As-a/I-want/so-that | 全文档无 | 缺 user-stories |
| 功能需求清单 | 🟡 呈现为「已交付能力清单」非「需求清单」 | README §核心交付 | 缺 functional-requirements |
| 非功能需求 | 🟡 安全过重，性能/可靠性缺 | README §安全、CLAUDE.md P0 | 缺 non-functional-requirements |
| 项目边界 | 🟡 out-of-scope 藏在脚注 | README L409-413 | 缺 scope-and-boundaries |
| 成功指标 | ❌ 只有工程测试指标，无产品指标 | README L260-268 | 缺 success-metrics |
| 威胁模型 ROI 论证 | ❌ 21 DbC 投入无 PRD 级论证 | 中期评价「过度设计」 | 缺 threat-model-justification |

### 4.2 对照 `02_UX_DESIGN/`（用户体验）

| 模板产出物 | tree-harness 现状 | gap |
|---|---|---|
| 信息架构 / sitemap | ❌ | 全域缺失 |
| 用户流程 / user-flows | 🟡 Layer1 场景有流程图，Layer2 无 | 缺 Layer2 流程 |
| 设计系统 | ❌（非 UI 产品，可弱化） | N/A |
| 交互规范 | ❌ | tree-harness 是开发者工具，UX 域可大幅简化 |

> **结论**：tree-harness 作为「开发者工具 + Agent 方法论」，UX 域应**降维**——保留「Agent 与人类的交互流程」和「开发者使用流程」，舍弃 UI 设计系统。建议合并为 `02_INTERACTION/agent-human-workflow.md`。

### 4.3 对照 `03_ARCHITECTURE/`（架构）

| 模板产出物 | tree-harness 现状 | 证据 | gap |
|---|---|---|---|
| 架构总览图 | 🟡 有 ASCII 图，但**行数失真**（图标 3602 行，实际 4879） | ARCHITECTURE §1.1 | 数字需校正 |
| 类图/模块关系 | ❌ 完全缺失（无 class-diagram.puml） | — | **P0 缺口** |
| 时序图 | ❌ 无 sequence-diagrams/ | — | **P0 缺口** |
| 数据模型 formal schema | 🟡 有 JSON 示例，非 formal；8 种 event meta 未统一 | ARCHITECTURE §5 | 缺 data-model.md |
| 关键设计决策 ADR | 🟡 §9 有 5 条质量近 ADR，但无编号/状态，与 reference/architecture 并行存在 | ARCHITECTURE §9 | 缺 ADR 体系 |
| 三层防御拓扑 | ✅ 较充分，但**行号失效**（基于旧 3602 行版） | ARCHITECTURE §7 | 行号需更新 |
| 统一防御拓扑 | 🟡 五层洋葱 vs 三层防御两套并行，维度混淆 | ARCHITECTURE §6 vs §7 | 需归一 |

### 4.4 对照 `04_API_SPEC/`（接口规范）

| 模板产出物 | tree-harness 现状 | 证据 | gap |
|---|---|---|---|
| 53 工具完整签名 | 🟡 覆盖面足，remote 工具偷懒（未逐个列） | API.md §3 | remote 需补全 |
| 错误码总表 | 🟡 **严重不全**：API 列 37 个，引擎实际 42 个 E_ 常量 | API.md §5 vs tree-engine L124-179 | **P0 缺口**（缺 E_SESSION_NOT_ALIVE/E_NO_OWNERSHIP 等） |
| 调用约束/前置条件 | 🟡 caller ownership R1-R6 完全未文档化 | API.md §2.10 | 需补前置条件 |

### 4.5 对照 `05_PROJECT_PLAN/`（项目计划）

| 模板产出物 | tree-harness 现状 | 证据 | gap |
|---|---|---|---|
| Sprint 路线图 | 🟡 事后追溯（CHANGELOG），非事前承诺 | CHANGELOG [Unreleased] | 缺 sprint-plan.md |
| 团队配置 | 🟡 角色定义强，但**无 team-config 统一文档 + 无模型矩阵** | commander-methodology §6.1 | **P0 缺口**（macp2 根因之一） |
| 统一工作流 | ✅ 强但分散在 6+ 份文档 | commander SKILL §13 + worker SKILL §2.5 | 缺 unified workflow.md |
| 预算护栏 | ❌ 无成本硬约束文档 | macp2 postmortem | 缺 cost-guardrails.md（macp2 教训） |
| 方法论覆盖度审计 | ❌ 无自审机制 | 中期评价「死的硬约束」 | 缺 methodology-coverage-audit.md |
| 人类 checkpoint | ❌ 无人类审查者角色 | macp2/macp4 用户上线才发现 | 需补人机交互评审 |

### 4.6 对照 `06_TESTS/`（测试）

| 模板产出物 | tree-harness 现状 | gap |
|---|---|---|
| 测试计划 | ✅ 极强（项目核心资产） | — |
| 测试金字塔（单元/对抗/洁净室/e2e） | ✅ 4 层 6 套件金标准 | — |
| 洁净室铁律 | ✅ 独有方法论资产 | — |

> **结论**：测试域是 tree-harness **最强**的领域，远超模板。无需补建，仅需把 `TESTING.md` 提升为 `06_TESTS/test-plan.md` 并补 `.note.md` 记设计取舍。

---

## 五、缺失设计文件新建清单（按优先级）

> 优先级依据：是否阻断核心使用 / 是否有实际损失史 / ROI。

### P0 — 必须补（阻断核心使用或已有损失史）

1. **`01_PRD/layer2-user-scenarios.md`** — Layer 2（树形体系）用户场景。补齐项目主体（80% 代码量）的「为什么用户需要一棵树」叙事。
2. **`01_PRD/success-metrics.md`** — 产品成功指标（多 Agent vs 单 Agent 完成时间/成功率/成本对照基线）。矫正「研发完成度=产品成功」的错觉。
3. **`03_ARCHITECTURE/class-diagram.puml`** — 模块关系图（main.cjs / patches.cjs / tree-engine.cjs / mcp-server 依赖方向 + global.__proma__ 12 桥接函数 + 注入点）。当前最大架构文档缺口。
4. **`04_API_SPEC/error-codes.md`** — 错误码字典与引擎对齐（42 个 E_ 常量全录入 + 归属文件 + 引入版本）。堵「37 vs 42」缺口。
5. **`05_PROJECT_PLAN/team-config.md`** — 角色↔模型↔工具↔成本上限↔激活条件矩阵 + 模型降级策略。**macp2 成本爆炸的直接根因**。
6. **`05_PROJECT_PLAN/cost-guardrails.md`** — 预算护栏专文（会话数硬上限/subagent 上限/收敛条件/撞错处理/模型成本三角）。Proma「spawn=真实会话=钱」特性要求独有。

### P1 — 应该补（显著改善可维护性/可上手性）

7. **`01_PRD/product-positioning.md`** — 统合定位（补丁/产品/方法论三选一锚定）+ 边界声明。
8. **`01_PRD/user-stories.md`** — 标准 user stories + 验收标准 + MoSCoW 优先级。
9. **`01_PRD/non-functional-requirements.md`** — 性能（fork/send_message 响应目标、并发上限）+ 可靠性（tree-state 损坏恢复）+ 成本（单任务 token 预算）；安全部分**做减法**（从工程报告抽取 PRD 级需求）。
10. **`01_PRD/threat-model-justification.md`** — 安全投入 ROI 论证（回答「为什么 AI agent 需要被防作弊」，引用 macp2 实证）。
11. **`03_ARCHITECTURE/data-model.md`** — tree-state.json formal schema（每字段类型/必填/约束/默认值 + 8 种 event meta 差异 + _meta 字块）。
12. **`03_ARCHITECTURE/sequence-diagrams/`** — 至少 4 张：建树全生命周期 / TAO Watcher 巡检+升级 / caller ownership R1-R6 / session verifier 注入与 bypass。
13. **`03_ARCHITECTURE/unified-defense-topology.md`** — 统一防御拓扑（归一五层洋葱 vs 三层防御，标 patches 层 vs tree-engine 层）。
14. **`05_PROJECT_PLAN/sprint-plan.md`** — 事前 Sprint 路线图（Phase D / subagent_trace_id / Q2 UI 优先级排序）。
15. **`05_PROJECT_PLAN/workflow.md`** — 端到端统一工作流（串联分散在 6+ 文档的流程）+ **人类 checkpoint 角色**。
16. **`05_PROJECT_PLAN/methodology-coverage-audit.md`** — 方法论覆盖度审计（对照中期评价「死的硬约束清单」逐条标注纸面/实战状态）。

### P2 — 可以补（提升文档质量/防未来复发）

17. **`01_PRD/user-personas.md`** — 用户画像分层（部署者 vs 使用者）。
18. **`01_PRD/scope-and-boundaries.md`** — 显式 in/out-of-scope。
19. **`03_ARCHITECTURE/adr/`** — ADR 体系（编号 + 状态 + 日期），归并 §9 与 reference/architecture 的并行决策记录。
20. **`06_TESTS/test-plan.note.md`** — 测试设计取舍（Cr 优先于 A1 / Tier1 vs Tier2 等）。

---

## 六、现有文档治理建议

### 6.1 🔴 双 `.context` 漂移（新发现）

- `D:/codes/tree-harness/.context/` 与 `~/.proma/.../workspace-files/.context/` **部分同源**（PROJECT-INDEX、待解决问题清单 md5 一致），但 **note.md 不同步**（tree-harness 版停在 07-07，workspace 版已到 07-09）。
- **风险**：两个并行知识库，持续追加的 note.md 会越漂越远，新会话读哪个版本得到不同结论（本次 SubAgent E 读 tree-harness 版，得出「note 落后 2 天」，实际 workspace 版已更新）。
- **建议**：**统一到 `D:/codes/tree-harness/.context/`（正式工程目录）为唯一真相源**，workspace 级改为软链或废弃。短期至少建立同步脚本。

### 6.2 🟠 文档散落与命名冲突

- **BUG-2 命名冲突**：`SECURITY.md §3.6` 的「BUG-2 = leaf_add session_id 唯一性（已修）」vs `CLAUDE.md` 的「BUG-2 = leaf_add caller-binding」——**同名指两个不同漏洞**。建议建立 BUG 全局注册表。
- **wiki 两版分裂**：顶层 `proma-dev-wiki.md`（13KB，「插件工具 10 个」严重过时）vs `.context/proma-dev-wiki.md`（73KB）。建议顶层版归档或标 deprecated，PROJECT-INDEX 明确指向 .context 版。
- **架构文档三处并行**：`ARCHITECTURE.md` vs `reference/architecture/` vs `proma-dev-wiki.md`，无单一真相源。

### 6.3 🟠 基础元数据全线失真

- 行数（图标 3602 / 2658，实际 4879 / 3098）、错误码数（文档 37，实际 42）、工具数（顶层 wiki 说 10）。
- **建议**：要么删除具体行数（改「约 4.8K 行」），要么加脚本从代码自动生成。

### 6.4 🟡 场景文档过期

- 《使用场景》《时间线的剪枝者》停留在 v0.10（2026-06-16，10 工具时代），与 v0.16.5（49 工具）严重脱节。建议更新或标注版本适用范围。

---

## 七、总结：从「工程运维文档」到「产品设计文档」的差距

tree-harness 当前文档体系可用一句话概括：**「安全加固 + 事故复盘 + 运维知识」极强，「产品需求 + 形式化架构 + 项目计划」缺位**。

对照 nanju 模板的 6 个域：
- **强项**（无需补建）：`06_TESTS/`（测试金字塔 + 洁净室，远超模板）、安全加固方法论文档（IHL/信任锚/三层防御，模板没有的独有资产）。
- **缺位**（P0 必补）：Layer2 用户场景、产品成功指标、架构类图、错误码对齐、team-config、cost-guardrails。
- **根因**：项目走的是「实战驱动、事后沉淀」路径（先有实现→再补 SKILL/方法论→最后补工程文档），从未做过「PRD 驱动、逐层细化」的正向设计。这导致 Layer 2（项目主体）长期「自证需求」。

**最小可行改进路径**：先补 P0 的 6 份文件（场景/指标/类图/错误码/team-config/护栏），即可把项目从「一堆运维笔记」提升到「一套可被新人/外部理解的产品设计文档」，同时顺手修掉文档失同步与命名冲突。

---

> 详细问题清单（23 条 + 5 聚类根因 + Top5 优先级）见配套的 [improvement-report-2026-07-09.md](./improvement-report-2026-07-09.md)。
