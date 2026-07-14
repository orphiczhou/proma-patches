# BUG 全局注册表

> 维护：周星星 | 产出：2026-07-09 会话 bbdefd1e（建可信基线 · 文档治理 A2）
> 用途：统一 tree-harness 历史上两套并行的 BUG 命名体系，消除 leaf_add 相关漏洞的混淆。
> 配套：[ERROR-CODES.md](./ERROR-CODES.md)、[improvement-report-2026-07-09.md](./.context/active/improvement-report-2026-07-09.md)

---

## 一、两套命名体系（并行，易混淆）

历史上 tree-harness 用过两套 BUG 编号，分属不同时期：

| 体系 | 格式 | 时期 | 主用文档 | 范围 |
|---|---|---|---|---|
| **体系 A（字母）** | `Bug {A\|B}-{1-4}` | 2026-06 V10 Phase 3 | SECURITY.md / CHANGELOG.md | 4 个，全已修 |
| **体系 B（数字）** | `BUG-{数字\|字母}` | 2026-07 audtest/harness | CLAUDE.md / note.md / audtest 材料 | caller-binding / fork / 事务回滚等 |

---

## 二、注册表

### 体系 A — V10 Phase 3（2026-06-25，全部 ✅ 已修）

| 编号 | 描述 | 修复点 | 错误码 | 证据 |
|---|---|---|---|---|
| **Bug A-1** | commander 代 worker 写 done event（`cmdEventAppend` caller≠leaf.session） | V10 P3 A-1，engine L1498 | E_BORROWED_IDENTITY | SECURITY §1.2 |
| **Bug A-2** | audit_gate `caller==audit_session` 漏洞（hasDone 漏检） | V10 P3 A-2，engine L2337 | E_BORROWED_IDENTITY | SECURITY §1.2 |
| **Bug B-3** | leaf_add **session_id 唯一性**（同 session 多 leaf 歧义） | V10 P3 B-3，engine L705 | E_DUPLICATE_SESSION_ID | SECURITY §1.2 / §2.2 |
| **Bug B-4** | resolveAuditorIndep `.filter` 跳过 pruned auditor | V10 P3 B-4，engine L1897 | E_AUDITOR_NOT_INDEPENDENT | SECURITY §1.2 |

### 体系 B — audtest / harness 效率评估（2026-07）

| 编号 | 描述 | 状态 | 对应问题 | 证据 |
|---|---|---|---|---|
| **BUG-2** | leaf_add / set-status / milestone-add **caller-binding**（caller!==added_by/owner/creator） | ✅ 已修 2026-07-09（会话 4fee5a45，vcb2 实证） | — | CLAUDE.md、note.md、improvement P2-S07 |
| **BUG-A** | Proma fork identity timeout（auditor session 永久 busy，可用率 33%） | 🔴 未修（跨仓，归属 Proma app 非 tree-engine） | improvement P1-S04 | audtest 01/05、CLAUDE.md |
| **BUG-B** | leaf_add 报错路径**未事务回滚**（幽灵 leaf 污染 active_count） | ⚪ **待重新核实**（2026-07-11） | improvement P1-S06 | audtest 01/05/06 |

> **BUG-B 核实说明（2026-07-11 代码审查）**：通读 `cmdLeafAdd`（tree-engine.cjs L816-1070），所有 throw（caller-binding L872、duplicate/session唯一/added_by树内/parent/深度/budget L1029 等）**都在 `state.leaves[leaf_id]=leaf`（L1064）之前**，push 与 writeState（L1066）之间无 throw。**cmdLeafAdd 本身不存在事务回滚问题**——报错时 leaf 未写入。audtest 报告的「幽灵 leaf + session_id 自动生成 + 连带 A4-worker」更像是 **fork session 副作用**而非 cmdLeafAdd 事务缺陷。**建议**：重新设计测试复现，定位幽灵 leaf 真正来源（fork? 并发? mock?）后再决定是否改代码，勿盲目加回滚逻辑。
| **BUG-3** | harness-efficiency 报告提及（具体待核实） | ⚪ 待核实 | — | archive/harness-efficiency-research-report L243 |

### 历史归档（早期审计，低优先级）

| 编号 | 描述 | 状态 | 证据 |
|---|---|---|---|
| **Bug I** | q1-v2 审计报告提及（具体待核实） | ⚪ 待核实（历史） | archive/2026-06-q1q3-audit/q1-v2-*.md |
| **bug-f / bug-a** | 小写引用（疑似文件名或非正式） | — | note.md L529、DEVELOPMENT.md L291 |

---

## 三、⚠️ 易混淆点（重点）

### 混淆 1：leaf_add 有两个不同漏洞，分属两体系

| 漏洞 | 编号 | 校验维度 | 状态 |
|---|---|---|---|
| session_id 唯一性 | **Bug B-3**（体系A） | 同一个 session 不能注册多个 leaf | ✅ V10 P3 已修 |
| caller-binding | **BUG-2**（体系B） | 注册者必须是它声明的 added_by | ✅ 07-09 已修 |

**两者都涉及 leaf_add，但是不同的校验维度，勿混。** 历史上 CLAUDE.md 曾误写"同名 BUG-2 另指 SECURITY"，实际 SECURITY 用的是 `Bug B-3`，非 `BUG-2`——已于 2026-07-09 修正。

### 混淆 2：BUG-B（事务回滚）vs Bug B（V10 P3 泛指）

- `BUG-B`（大写带连字符，体系B）= leaf_add 事务回滚缺失（未修）
- `Bug B`（字母，体系A）= V10 P3 session 类漏洞泛指（B-3/B-4，已修）

---

## 四、命名规范（建议）

今后新增 BUG **统一用体系 B（`BUG-{数字}`）**，废弃体系 A（字母），避免与已有 `Bug A/B` 混淆。每个新 BUG 必须进本注册表（编号 + 描述 + 状态 + 证据 + 对应 improvement 问题号）。

---

## 维护约定

- 发现/修复 BUG → 同步本注册表 + improvement-report 对应条目状态。
- 状态变更（🔴→⚪→🟢）两处同步。
- 历史归档 BUG（Bug I / bug-f 等）核实后补全或标注「历史，不再追溯」。
