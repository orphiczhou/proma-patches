# C3 规范性/格式审查 — 审计报告

> **审计者**: `sq_audit-C3-standards` (leaf: tree-worker)
> **审计对象**: tree-system-v0.2.0 发布包（17 文件）
> **审计范围**: 命名规范、Markdown/YAML 格式、严重度体系、统计声称可复算性、版本一致性
> **审计时间**: 2026-06-19 18:29 GMT+8

---

## 问题列表

| 问题ID | 定位(文件:行号) | 严重程度 | 描述 | 修正建议 |
|--------|---------------|---------|------|---------|
| **C3-01** | `README.md:70` `CHANGELOG.md:17,30` `QUICKSTART.md:164` | **严重** | **"14条铁律"统计声称不实**。README 称 `commander-methodology.md` 含"14条铁律"；CHANGELOG 称 tree-commander SKILL 含"14条铁律"、commander-methodology 含"14条铁律"。实检：commander-methodology.md §1 有 **10 条核心原则**（非"铁律"），tree-commander SKILL.md §1 有 **4 条铁律**（§11 另有 12 条禁止行为，合计 16 条，仍不构成 14）。数字 14 在当前所有文档中均无对应条目，属系统性统计错误。 | 逐一核实各文档的实际条目数：commander-methodology.md → "10条核心原则"；tree-commander SKILL.md → "4条铁律 + 12条禁止行为"；全面替换所有"14条铁律"引用为准确数字。 |
| **C3-02** | `design/tree-commander-design.md:3` | **严重** | **设计文档标题版本滞后**。H1 下方元数据标注 `版本: v1.0 (2026-06-18)`，但文件尾部修订历史记录已迭代至 **v1.2**（最后一次 v1.2 变更：S3 rename 重试修复 + DRIFT_ACTION_ENUM 补齐 `handoff`）。标题版本与实际版本差 2 个小版本。 | 将第 3 行 `v1.0` 改为 `v1.2`，保持与修订历史一致。 |
| **C3-03** | `test-plans/s1-test-plan.md:43-44` | **严重** | **s1-test-plan 引用已废弃的旧版命名正则**。§0.3 约束写道 `所有 leaf_id 必须匹配正则 ^(\w+)-(?:...)?$`，仍使用 prefix 段为 `\w+` 的旧版正则（v0.1 时代）。当前 tree-state.js:64 的正则已锁定为 `[a-z][a-z0-9_]{3,7}`（v0.1.1-C 修复），s1-test-plan 未同步更新。虽然后续表格中提到了 "proma-guide-root 被拒"（与新正则行为一致），但引用的正则文本本身已过时，会给读者造成混淆。 | 将 §0.3 的正则替换为当前版本：`^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+\|i\d+))?$`，并更新配套的解释文本。 |
| **C3-04** | `handoffs/b-task-brief.md:19` `handoffs/l1-audit-fix-brief.md:80` `QUICKSTART.md:28` | **严重** | **3 处代码块缺语言标注**。b-task-brief.md 树形结构图（第 19 行）、l1-audit-fix-brief.md 的 l1fix 树形结构（第 80 行）、QUICKSTART.md 的 mydemo 树结构图（第 28 行）均使用裸 ````` 开头，未标注 `text`。项目规范（见 tree-commander-design.md 等文件）要求所有代码块标注语言。 | 将上述 3 处 ```` ``` ```` 改为 ```` ```text ````。 |
| **C3-05** | `methodologies/commander-methodology.md:1 vs :284` | **建议** | **commander-methodology.md 内部版本号不一致**。H1 标题写 `v1.0`（第 1 行），但 §8 修订历史最后一条记录为 `v1.0.1`（第 284 行，命名规范复盘改写）。H1 版本未随修订历史更新。 | 将 H1 标题更新为 `v1.0.1`，或在修订历史中明确标注 H1 版本为基线版本。 |
| **C3-06** | `CHANGELOG.md:30` `README.md:70` | **建议** | **CHANGELOG/README 引用的 methodology 版本与文件内部不一致**。CHANGELOG 称 `commander-methodology.md v1.0`，README 目录注释写"14条铁律"。实际文件修订历史已到 v1.0.1，且只有 10 条原则（非铁律）。 | CHANGELOG 更新为 `v1.0.1`，将"14条铁律"改为"10条核心原则"。 |
| **C3-07** | `verification-reports/v01-real-test-report.md:28` | **建议** | **`real-A-F1-polish` 命名与正则语义不完全匹配**。该 leaf_id 意图表达"父=A、子=F1、角色=polish"，但正则 `[A-Z]\d*(?:[a-z]\d*)*` 仅支持单段路径。正则解析会将 path 解析为 `A`、role 解析为 `F1`，`polish` 落入未匹配区域。实际 tree-state.js 的 `leaf add` 会用显式 path 覆盖此问题（path 字段独立指定），但 leaf_id 本身的语义解析存在歧义。 | 如 F1 是独立子节点（非 A 的孙），命名为 `real-F1-polish`（path=F1, role=polish）；如确为孙节点且需保留父路径信息，此为 regex 扩展需求，应在设计文档中注明已知限制。 |
| **C3-08** | `verification-reports/b-verify-report.md:24` `verification-reports/v01-real-test-report.md:37` | **建议** | **验证报告引用"14条铁律"**（与 C3-01 同源问题）。b-verify-report 声称 "mentally apply 14 条铁律"，v01-real-test-report 声称 "加载 commander-methodology.md（14 条铁律）"。这些引用传播了不实的统计数字。 | 修改为准确表述，例如 "10条核心原则" 或直接引用 commander-methodology.md 文件名而不附数字。 |
| **C3-09** | `design/tree-commander-design.md:1187` | **建议** | **§10 节头版本标注 `v2.0 草稿` 与文件整体版本体系冲突**。文件标题为 v1.0（应为 v1.2），但 §10 自称 v2.0，易使读者困惑节版本与文件版本的关系。 | 改为 `v0.2 实施规范（草稿）` 或 `§10 版本: 草稿` 以区分节级标注与文件级版本。 |

---

## 统计摘要

| 指标 | 值 |
|------|-----|
| 审计文件总数 | 17 |
| 发现问题数 | 9 |
| 严重 | 4 |
| 建议 | 5 |
| 阻断 | 0 |

### 按类别分布

| 类别 | 问题ID | 数量 |
|------|--------|------|
| 统计声称不实 | C3-01, C3-06, C3-08 | 3 |
| 版本号不一致 | C3-02, C3-05, C3-09 | 3 |
| 代码块缺语言标注 | C3-04 | 1 |
| 引用过时规范 | C3-03 | 1 |
| 命名语义歧义 | C3-07 | 1 |

---

## 自审检查

### 代码块语言标注检查

全部 17 个文件中的代码块已逐文件审查。结果：
- ✅ 以下文件所有代码块均有语言标注：README.md, CHANGELOG.md, tree-commander-design.md, commander-methodology.md, tree-audit-methodology.md, audit-methodology.md, tree-commander/SKILL.md, tree-worker/SKILL.md, s1-test-plan.md, s2-test-plan.md, v01-real-test-report.md, v01-retest-report.md, b-verify-report.md
- ❌ 3 处缺语言标注（见 C3-04）：b-task-brief.md:19, l1-audit-fix-brief.md:80, QUICKSTART.md:28

### 命名规范正负例全量验证

tree-commander SKILL.md §12 的正例/负例对照当前 LEAF_NAME_RE（`^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$`）：

- ✅ **正例 8 个**（nanju-root, nanju-A-eval, nanju-A-eval-s2, nanju-A1-engine, sweng-B-pedagogy, webv3-C-api, pguide-root, nanju-A1b-engine）— 全部通过正则
- ✅ **负例 6 个**（proma-guide-root, NA-root, nju-root, NANJU-root, 123abc-root, toolkithelper-root）— 判定原因全部正确
- ✅ `toolkithelper`（13 字符）超过 8 字符上限的判定正确

tree-worker SKILL.md §8 的命名约定与 tree-commander SKILL.md §12 一致。

### YAML Frontmatter 一致性检查

- 两个 SKILL 文件（tree-commander/SKILL.md, tree-worker/SKILL.md）使用统一的 `## §0 元数据` + YAML 代码块模式（非标准 `---` frontmatter）
- 方法论文档（commander-methodology.md, audit-methodology.md, tree-audit-methodology.md）不包含 YAML frontmatter — 一致
- design/tree-commander-design.md 使用 `>` 引用块做元数据头 — 与 SKILL 文件有差异但属不同类型文档的合理差异
- 结论：YAML frontmatter 约定在同类文档间一致，无违规

---

## 可复算性核验

| README 声称 | 实际值 | 核验结果 |
|------------|--------|---------|
| tree-state.js "1551 行" | `wc -l` = 1551 | ✅ 完全一致 |
| tree-commander-design.md "1413 行" | `wc -l` = 1413 | ✅ 完全一致 |
| commander-methodology.md "14条铁律" | §1 含 10 条核心原则 | ❌ 不实（见 C3-01） |
| tree-worker "9条铁律" | §1 含 9 条铁律 | ✅ 一致 |
| tree-audit-methodology "5条铁律" | §二 含 5 条铁律 | ✅ 一致 |
| tree-audit-methodology "最少 7 leaf" | §二铁律1 + §三流程 明确 ≥7 | ✅ 自洽 |
