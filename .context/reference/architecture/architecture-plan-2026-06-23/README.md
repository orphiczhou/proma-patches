# Proma Tree 体系架构改进方案

> **日期**: 2026-06-23
> **性质**: 架构改进实施方案（在 v2 审议通过后进入执行）
> **前置依赖**: v2 专家审议已批准核心论断和方向
> **读者**: 周星星 + 执行 Agent

---

## 一句话总结

**将 Tree 体系从"提示词信仰"升级为"Zero Trust 代码仲裁"——在 tree-state.js 中构建不可绕过的硬约束层，严格限制层级深度，用代码而非 prompt 执行审计。**

---

## 方案目录文件清单

| # | 文件 | 一句话说明 |
|---|------|-----------|
| 1 | `README.md` | 本文件，方案目录导航与阅读指南 |
| 2 | `00-executive-summary.md` | 执行摘要，5 分钟抓住核心论断、五层防御、v0.7 Phase A-G、10 个决策、风险 |
| 3 | `01-root-cause-analysis.md` | 根因分析（四层：LLM物理特性 / RLHF副产物 / Harness缺失 / 激励机制失衡） |
| 4 | `02-defense-architecture.md` | 五层防御架构详细设计（Layer 0-4），含 DbC / Capability Token / depth限制 / hash chain 完整代码草案 |
| 5 | `03-implementation-roadmap.md` | v0.7 Phase A-G 执行计划、工作量估算、文件改动清单、测试矩阵、migrate 策略 |
| 6 | `04-fork-mechanism-findings.md` | Fork 机制验证报告：系统提示词和 Skill 完美保留，问题不在丢失规则而在缺乏执行牙齿 |
| 7 | `05-industry-reference.md` | 业界方案参考（框架对比 / 学术论文速查 / 工业模式借鉴 / 46 个参考来源） |
| 8 | `06-decision-log.md` | 10 个关键决策记录（选项、选择、理由、风险、用户确认状态） |

---

## 阅读路径

### 最少阅读路径（20 分钟）

适合：需要快速了解方案全貌的读者。

1. **`00-executive-summary.md`**（5 分钟）— 核心论断、关键证据、五层架构图、10 个决策、风险
2. **`01-root-cause-analysis.md`** §2（10 分钟）— 四层根因模型，理解"为什么 prompt 只能解 30%"
3. **`03-implementation-roadmap.md`** §1-§2（5 分钟）— Phase A-G 概览表 + Phase A 核心改动

### 完整阅读路径（60 分钟）

适合：需要深入理解每个机制设计并做判断的读者。

1. **`00-executive-summary.md`** — 全局视角（必读）
2. **`01-root-cause-analysis.md`** — 完整四层根因 + 六大失败因果链
3. **`02-defense-architecture.md`** — 五层防御完整设计 + 代码草案 + 错误码清单
4. **`03-implementation-roadmap.md`** — Phase A-G 完整时间线 + 文件改动清单 + 测试矩阵
5. **`04-fork-mechanism-findings.md`** — Fork 验证：规则没丢，缺的是牙齿
6. **`05-industry-reference.md`** — 业界 20+ 框架对比 + 学术论文速查
7. **`06-decision-log.md`** — 10 个关键决策的来龙去脉

### 专题查阅

- 只想看 **根因**：`01-root-cause-analysis.md`
- 只想看 **防御怎么设计**：`02-defense-architecture.md`
- 只想看 **怎么实施**：`03-implementation-roadmap.md`
- 只想看 **Fork 到底怎么回事**：`04-fork-mechanism-findings.md`
- 只想看 **业界怎么做**：`05-industry-reference.md`
- 只想看 **决策怎么定的**：`06-decision-log.md`

---

## 与其他审议包的关系

| 审议包 | 日期 | 性质 | 与本方案的关系 |
|--------|------|------|---------------|
| **architecture-analysis** | 2026-06-23 | 架构根因分析报告 | **前置输入**。本方案的所有机制设计都基于该分析的四层架构建议 + Fork 验证结论。回答了"问题在哪"。 |
| **v1 expert-review** | 2026-06-23 09:30 | 用户 bug 层审议（CP1-CP6） | **被本方案覆盖**。v1 提出的 v0.5/0.6 修订计划已全部合并进 v0.7。回答了"用户层修什么"。 |
| **v2 expert-review** | 2026-06-23 14:41 | 架构层诊断审议（8 个决议题） | **本方案的直接上游**。v2 审议批准了核心论断和三层防御方向后，本方案将其转化为可执行的详细设计。回答了"方向对不对"。 |
| **本方案 (architecture-plan)** | 2026-06-23 | 架构改进实施方案 | **执行输出**。将 v2 审议结论落地为 Phase A-G 的具体步骤、代码草案、测试矩阵。回答"具体怎么改"。 |

---

## 关键约束（方案设计的前提）

1. **不修改 main.cjs**（AGPL 合规，所有逻辑写进 `proma-dev-patches.cjs`）
2. **零外部依赖**（仅用 Node.js 内置 + Electron）
3. **向后兼容**（tree-state.js 改动自带 migrate 逻辑）
4. **破坏性操作前先跟用户确认**
5. **每个 Phase 产物落盘到 `.context/`**

---

> **本文件由 Proma Agent 撰写，2026-06-23**
> **方案系列 8 个文件全部完成，经三轨独立审计（结构一致性/内容质量/反事实攻击）后修正。**
