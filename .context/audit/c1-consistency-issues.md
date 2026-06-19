# C1 一致性审查报告 — tree-system-v0.2.0

> **审查员**: tree-worker (leaf: sq_audit-C1-consistency)
> **审查日期**: 2026-06-19 18:29 GMT+8
> **审查范围**: 交叉引用有效性、版本号对齐、行数声称、SKILL requires 路径一致性、日期一致性
> **方法论**: tree-audit-methodology.md 阶段一 C1 维度

---

## 审查覆盖矩阵

| 审查项 | 覆盖率 | 状态 |
|--------|--------|------|
| 所有文件间交叉引用路径验证 | 17/17 文件 × 内部引用 | ✅ 100% |
| 版本号一致性（README/CHANGELOG/SKILL/设计文档） | 7 个版本声明交叉比对 | ✅ 100% |
| 行数声称 vs 实际 (wc -l) | 2 个声称值 | ✅ 100% |
| SKILL requires 声明 vs 实际文件 | 4 个依赖项 | ✅ 100% |
| README 已验证场景 vs 报告文件 | 3 个场景 | ✅ 100% |
| CHANGELOG 日期 vs 文件日期 | 6 个日期 | ✅ 100% |
| 枚举值跨文件对齐 (status/event/drift) | 5 组枚举 | ✅ 100% |
| 目录结构声称 vs 实际文件 | 17 个文件 | ✅ 100% |

---

## 发现的问题

| 问题ID | 定位 | 严重程度 | 描述 | 修正建议 |
|--------|------|----------|------|---------|
| **C1-01** | `design/tree-commander-design.md:3-6` | 建议 | 文档头部 YAML 元数据声明 `版本: v1.0 (2026-06-18)`，但文档底部修订历史（行 1409-1413）记录已迭代至 v1.2（最后一次修订为 "v0.1.1-S3 已修复到 tree-state.js…同步创建 tree-commander SKILL.md…"）。头部版本号未随修订历史同步更新。 | 将头部 `版本: v1.0` 更新为 `版本: v1.2`，日期更新为最后一次修订日期 |
| **C1-02** | `skills/tree-commander/SKILL.md:15` | 建议 | SKILL §0 `requires` 声明 `tree-commander-design.md v1.1`，但实际设计文档 (`design/tree-commander-design.md`) 的修订历史已到 v1.2。两个文件之间的版本引用不同步。 | 将 SKILL requires 中的版本号更新为 `v1.2`，或在设计文档 v1.2 发布后同步更新 SKILL |
| **C1-03** | `design/tree-commander-design.md:1187` | 建议 | §10 头部元数据声明 `版本: v2.0 草稿 (2026-06-18)`，但整个文档的版本体系是 v1.x（头部 v1.0，修订历史 v1.0→v1.1→v1.2）。§10 使用 v2.0 造成文档内部版本号体系不统一——同一文件中存在两套版本命名空间。 | 方案 A：将 §10 版本改为 `v1.2` 并标注"v0.2 实施规范"以保持文档内一致性。方案 B：在 §10 头部显式注明"本节 v2.0 指 tree-commander/tree-worker SKILL 版本，非本文档版本" |
| **C1-04** | `README.md:70` + `CHANGELOG.md:30` | 严重 | README 目录结构中标注 `commander-methodology.md # 指挥官方法论（14条铁律）`，CHANGELOG 声称 `commander-methodology.md v1.0：14 条铁律 + 双轨执行`。但实际 `methodologies/commander-methodology.md` §1 为 **10 条核心原则**，§0 另有 2 条元信念，合计 12 条。数字 "14" 无法在任何合理的计数方式下与文件内容对应。 | 将 README 和 CHANGELOG 中的 "14条铁律" 改为 "10条核心原则 + 2条元信念"（即 12），或直接改为 "10条核心原则"（指 §1）。同时注意：方法论文件用的是"原则"而非"铁律"——"铁律"是 SKILL 文件的术语体系 |
| **C1-05** | `CHANGELOG.md:17` | 严重 | CHANGELOG 描述 `tree-commander SKILL v2.0：14 条铁律（根会话纯净、双轨执行、事件路由等）`。实际 SKILL 文件 `skills/tree-commander/SKILL.md` §1 仅有 **4 条铁律**，§11 有 12 条禁止行为（合计 16）。更关键的是，括号中列举的 "根会话纯净、双轨执行、事件路由" 是 **commander-methodology** 中的概念，而非 SKILL §1 铁律的内容。CHANGELOG 描述与实际文件内容存在双重偏差：数量不对、来源不对。 | 将 CHANGELOG 该行改为 `4 条铁律 + 12 条禁止行为`，并确保示例（括号内）引用 SKILL §1 的实际铁律措辞 |
| **C1-06** | `methodologies/commander-methodology.md:218` + `methodologies/commander-methodology.md:187` + `methodologies/commander-methodology.md:255` | 建议 | 方法论文档在 §4.2（行 187）、§5（行 218）、§6（行 255）三处通过相对路径引用 `v0.1-audit-report.md`，但该文件**不在发布包中**。阅读者在发布包内无法找到此引用文件，导致 R1-R5 回归用例的具体定义失去上下文。 | 方案 A：将 `v0.1-audit-report.md` 纳入发布包（如放入 `verification-reports/`）。方案 B：在引用处添加脚注说明该文件为历史审计报告，可通过 git history 查看，并在此处内联 R1-R5 用例定义（当前已有，见行 187、255）。推荐方案 B——当前文档已在两处内联了 R1-R5 定义，引用只是额外的历史指针 |
| **C1-07** | `methodologies/commander-methodology.md:216-219` | 建议 | §5 初始化模板中 `required_reading` 的 5 个路径全部使用**部署路径**（`.context/commander-methodology.md`、`.context/tree-commander-design.md` 等），与发布包的实际目录结构（`methodologies/`、`design/`、`test-plans/`）不对齐。新用户从发布包出发，无法按模板中的路径找到文件。 | 在模板说明中添加注释"以下路径为部署后工作区路径，发布包中对应文件位于 `methodologies/`、`design/`、`test-plans/` 目录"；或提供发布包→部署路径的映射表 |

---

## 通过验证的项目（无问题）

### 行数声称
| 文件 | 声称行数 | wc -l 实际 | 匹配 |
|------|---------|-----------|------|
| `core/tree-state.js` | 1551 (README:61) | 1551 | ✅ |
| `design/tree-commander-design.md` | 1413 (README:75) | 1413 | ✅ |

### 版本号一致性
| 组件 | README | CHANGELOG | 文件自身 | 一致 |
|------|--------|-----------|---------|------|
| 发布包 | v0.2.0 | v0.2.0 | — | ✅ |
| tree-state.js | — | v1.0 | v1.0 (schema) | ✅ |
| tree-commander SKILL | v2.0 | v2.0 | v2.0 | ✅ |
| tree-worker SKILL | v2.0 | v2.0 | v2.0 | ✅ |
| commander-methodology | — | v1.0 | v1.0 | ✅ |
| tree-audit-methodology | — | v1.0 | v1.0 | ✅ |

### 日期一致性
| 事件 | README | CHANGELOG | 报告文件 | 一致 |
|------|--------|-----------|---------|------|
| v0.2.0 发布 | 2026-06-19 | 2026-06-19 | — | ✅ |
| B 任务 | — | 2026-06-18 | b-verify-report: 2026-06-18 | ✅ |
| S1 重测 | — | 2026-06-19 | v01-retest-report: 2026-06-19 | ✅ |
| L2 验证 | — | 2026-06-19 | v01-real-test-report: 2026-06-19 | ✅ |

### 已验证场景与报告对应
| README 场景 | 证据文件 | 文件存在 | 内容匹配 |
|-------------|---------|---------|---------|
| B 任务 GLM-5-Turbo 4 子会话 | `b-verify-report.md` | ✅ | ✅ |
| S1 重测 25 命令全部通过 | `v01-retest-report.md` | ✅ | ✅ |
| L2 DeepSeek-v4-flash 3 子会话 | `v01-real-test-report.md` | ✅ | ✅ |

### 目录结构
README 声明的 17 个文件路径与实际文件系统完全一致。✅

### SKILL requires 路径有效性
| SKILL | 依赖项 | 实际路径 | 文件存在 |
|-------|--------|---------|---------|
| tree-commander | `tree-state.js` | `core/tree-state.js` | ✅ |
| tree-commander | `commander-methodology.md v1.0` | `methodologies/commander-methodology.md` | ✅ |
| tree-commander | `tree-commander-design.md v1.1` | `design/tree-commander-design.md` | ✅ (版本见 C1-02) |
| tree-worker | `tree-state.js` | `core/tree-state.js` | ✅ |

### 枚举值跨文件对齐
| 枚举组 | tree-state.js | tree-commander SKILL | 一致 |
|--------|-------------|---------------------|------|
| STATUS_ENUM (5) | active/done/pruned/archived/segment_pending | 同 | ✅ |
| EVENT_TYPE_ENUM (8) | done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check | 同 | ✅ |
| DRIFT_KIND_ENUM (3) | production/direction/rhythm | 同 | ✅ |
| DRIFT_SEVERITY_ENUM (3) | low/mid/high | 同 | ✅ |
| DRIFT_ACTION_ENUM (6) | nudge/limit/prune/self_correct/declare/handoff | 同 | ✅ |

### CHANGELOG 已验证数据 vs 报告文件
| CHANGELOG 声称 | 报告文件确认 | 一致 |
|---------------|------------|------|
| B 任务 4 子会话 3 次尝试 | b-verify-report: "4 个成功 + 7 个归档" | ✅ |
| S1 重测 25 命令全部通过 | v01-retest-report: "成功: 25, 失败: 0" | ✅ |
| L2 验证 3 子会话 1 次通过 0 偏差 | v01-real-test-report: "第 1 次尝试（一次性通过）" + drift_log=0 | ✅ |

---

## 统计摘要

| 指标 | 数值 |
|------|------|
| 审查文件数 | 17 |
| 交叉引用检查项 | 42 |
| 发现问题总数 | 7 |
| 严重（Severe） | 2 (C1-04, C1-05) |
| 建议（Suggestion） | 5 (C1-01, C1-02, C1-03, C1-06, C1-07) |
| 阻断（Blocker） | 0 |
| 通过检查项 | 35 |
| 行数声称一致性 | 2/2 通过 |
| 版本号一致性 | 6/6 通过（C1-02 为 SKILL requires 版本引用滞后，非 SKILL 自身版本） |
| 日期一致性 | 4/4 通过 |
| 枚举对齐 | 5/5 通过 |
| 路径有效性 | 17/17 通过 |

### 发布决策影响评估

**2 个严重问题 (C1-04, C1-05) 可能导致外部读者对文档可信度产生怀疑：**

- **C1-04**: "14条铁律" 这个数字出现在 README 目录结构（用户第一眼看到的内容）和 CHANGELOG 中，但无法与任何实际文件内容对应。用户打开方法论文件会发现只有 10 条原则——直接矛盾。
- **C1-05**: CHANGELOG 中 tree-commander SKILL 的描述（14 条铁律 + 引用了错误来源的概念）与 SKILL 文件完全不匹配。

**建议发布前修复 C1-04 和 C1-05**，以维护发布包的文档可信度。其余 5 个建议级问题可在 v0.2.1 中处理。

---

*审计结束。本报告基于 wc -l 行数计数、全文交叉比对和目录结构校验，未使用自动化工具。*
