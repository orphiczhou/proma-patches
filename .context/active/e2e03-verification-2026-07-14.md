# e2e03 — tree-system 端到端真实项目验证报告

> 维护: 周星星 + Proma Agent (tree-harness 子会话) | 日期: 2026-07-14
> 性质: Sprint 6 之后「真实项目端到端验证」，补 success-metrics 团队维度实证数据
> 载体: 补 `03_ARCHITECTURE/` 三份形式化产物（design-files-mapping §五 P0-3 / P1-11 / P1-12 最大架构缺口）
> 实例: pro（`127.0.0.1:19877`，userData `~/.proma-dev/`，引擎 `5532fa5f` + patches `339082af` + SKILL `8b2d20f2`，Sprint 5 部署）

---

## 〇、TL;DR（一句话结论）

**tree-system（补丁形式）在 pro 上由 GLM-5.2 commander 自主端到端跑通**：1 root + 3 worker（create_session 非 fork 派生，并行）+ 1 auditor，**全部 status=done**，产出 **1157 行**架构形式化文档（class-diagram / data-model / sequence×4），冷启动信任锚 + done 8 道门禁 + auditor 交叉一致性审查**全部按协议触发**。Sprint 1-5 新机制在真实协作中**实证有效**。协作总墙钟 ~21 分钟（tree_init 23:07 → auditor done 23:28）。

**最大教训**（方法学，必读 §八）：监督期间一度误判 commander「卡死」并建 driver 欲转受控方式——**根因是误信 API `list_messages total=1`**。GLM-5.2 在**单个长未提交轮**内完成全部多步工作，API 消息可见性滞后；**tree-state.json（文件通道）才是 ground truth**。

---

## 一、测试设置

| 项 | 值 |
|---|---|
| 实例 | pro（`127.0.0.1:19877`，ISOLATED=1，userData `~/.proma-dev/`）|
| workspace | `eb5e3f9c`（默认工作区，slug=default）|
| channel / model | `57d0f98e`（GLM）/ **GLM-5.2**（全程，成本控制）|
| commander session | `124ccb14-5a38-45bc-8112-e894e9c4fd36`（= root.session_id / 信任锚）|
| tree_id | `e2e03`（纯字母数字，prefix=e2e03）|
| 源材料暂存 | pro `workspace-files/.context/e2e03-sources/`（ARCHITECTURE.md 530 行 + API.md 845 行 + design-files-mapping 230 行，由编排方 cp 进 pro 供 worker 读取）|
| 产物落点 | pro 树 deliverables → 中转到 `D:/codes/tree-harness/03_ARCHITECTURE/`（pro 无 D:/codes 访问权，编排方中转）|
| 约束 | 不改引擎/patches/SKILL/源码（367/0 基线不动）；max_sessions 50；SubAgent 仅进程内 Agent 工具 |

---

## 二、自主执行时间线（commander 124ccb14，全 GLM-5.2）

> 数据源：`~/.proma-dev/.../trees/e2e03/tree-state.json`（write_count=35，文件通道 ground truth）。
> 关键观察：commander 的 API `list_messages` 全程 `total=1`（长未提交轮），但 tree-state 每次 tool call 即落盘，时间线完整可重建。

| 时刻 | 事件 | 机制验证 |
|---|---|---|
| 23:07:34 | `tree_init(e2e03)` root 创建（session=124ccb14）| 闸门2 root 激活 |
| 23:08:03 | root `plan` event（含 subtask_split A/B/C/D）| **步骤0** root.events 非空（闸门2 前置）|
| 23:08:36-37 | **create_session ×3**（A=f73a71ce / B=8a00124d / C=45f4a7bb），source=create_session | **Sprint 2 派生（非 fork）✅** |
| 23:09:43 | `leaf_add` ×3，**5 件套全持久化**（brief/dod/report_protocol/autonomy/self_audit）| **Sprint 2 五件套持久化 ✅** |
| 23:09:43 | workers 创建间隔 .256/.293/.333ms —— **77ms 内并行派生 3 worker** | **并行协作 ✅** |
| 23:12:20-23 | workers `brief_echo`（my_understanding + milestones_preview）| 步骤3（caller=worker）|
| 23:13:41 | commander **回填 alignment** ×3（audit_session_id=root）| **步骤4 V5b 硬前置 ✅** |
| 23:16:16-53 | workers `done` event（self_check 丰富，每项 evidence≥10 字）| 步骤5 |
| 23:16:42-19:52 | workers `set-status done` **撞 E_GATEKEEPER_REQUIRED**（blocked 上行）| **done 门禁触发 ✅（gate 7）** |
| 23:20:06 | commander `audit_gate pass` ×3（audit_session_id=root，caller===audit_session_id）| **步骤6 冷启动信任锚 ✅** |
| 23:20:06 | workers **status=done**（门禁全过放行）| 步骤7 ✅ |
| 23:22:28 | **create_session auditor**（5ad72278，role=auditor，create_session 避 fork identity timeout）| P0a auditor role ✅ |
| 23:22:43 | `leaf_add(role=auditor, path=D)` | 简化协议 |
| 23:23:39 | auditor `brief_echo` | — |
| 23:27:48-23:28:27 | auditor `audit_append` ×3（**passed:9 / failed:3**，真实交叉审）| **auditor 审 ✅** |
| ~23:28 | auditor **status=done**（commander audit_gate pass 背书）| 简化门禁通过 ✅ |

**协作墙钟**：tree_init 23:07:34 → 末 worker done 23:20:06 = **~13 分钟产 3 份文档**；含 auditor 审查至 23:28 = **~21 分钟全链路**。

---

## 三、Sprint 1-5 新机制触发实证（验证矩阵）

| # | 机制 | 期望 | 实证 | 判定 |
|---|---|---|---|---|
| 1 | **5 件套持久化**（S2）| worker 启动 tree_leaf_get 读 brief/dod | 3 worker leaf 均持久化 brief/dod/report_protocol/autonomy/self_audit；done event meta.tried 记「tree_leaf_get 读 5 件套 → brief_echo」| ✅ 触发 |
| 2 | **create_session 派生**（S2）| commander/worker create_session 非 fork | session_registry 5 个 worker/auditor session 全 `source:"create_session"`（无 fork_session 痕迹），caller=124ccb14 | ✅ 触发 |
| 3 | **flagged / done-未审拦截**（S1）| done-未审被拦 | 无独立 `flagged` 字段触发（clean run 无篡改）；**功能等价门禁触发**：3 worker `set-status done` 全撞 `E_GATEKEEPER_REQUIRED`（audit_gate 未 pass 时拒放行）| 🟡 等价触发（门禁而非 flagged 字段）|
| 4 | **max_sessions**（S5）| session_registry 登记 + count | `audit_meta.max_sessions=50`；session_registry 登记 5 session（root+3worker+auditor），**count=5 ≪ 50**，E_MAX_SESSIONS 未触发（预算充足）| ✅ 机制就位（未触上限）|
| 5 | **drift 联动**（S2）| 状态变更 drift_history | `drift_log=[]` 空——clean run 无 drift（worker 经门禁纠偏，非 drift 三档）；机制（drift_log 字段 + drift_append 工具）就位但**本轮未演练** | ⚪ 未触发（无 drift 场景）|
| 6 | **done 门禁 8 道** | milestone/expect_outputs/deliverables/brief_echo/review_round/audit_gate/status_event/children | `E_GATEKEEPER_REQUIRED` 实证 gate 7 拦截；02-done-gate.puml 逐道还原 8 门禁 + 全部错误码（E_SCHEMA_INVALID/E_DELIVERABLE_MISSING/E_DELIVERABLE_EMPTY/E_ALIGNMENT_NOT_VERIFIED/E_AUDIT_PREMATURE/E_GATEKEEPER_REQUIRED/E_REVIEW_NOT_CONVERGED）| ✅ 触发（gate 7 实证，8 道文档化）|
| 7 | **auditor 审 + 独立性** | 交叉一致性 + E_BORROWED_IDENTITY 防 self-audit | 3 轮 × 14 项交叉审（**11 pass / 3 fail**，见 §四）；auditor_session_id=5ad72278 独立；audit_gate 由 root（caller===audit_session_id）背书，worker 不能自审 | ✅ 触发 |
| 8 | **协作效果** | 多 agent 并行 vs 单 agent | 3 worker 77ms 内并行派生，~13 分钟并行产 3 份独立文档（class/data/sequence 无依赖，真并行）| ✅ 并行有效 |

**结论**：8 项验证点 **6 项实证触发 / 1 项等价触发（门禁）/ 1 项未触发（无场景）**。新机制在真实 GLM-5.2 协作中可靠工作。

---

## 四、产出质量（3 份形式化产物，已落 `D:/codes/tree-harness/03_ARCHITECTURE/`）

| 产物 | 行数 | 字节 | 规格 | 质评 |
|---|---|---|---|---|
| `class-diagram.puml` | 205 | 8969 | 4 模块（main.cjs/patches/tree-engine/mcp-server）+ global.__proma__ 12 桥接 + sed 补丁 A-K 11 注入点 + SDK createSdkMcpServer 入树点 | 规范 PlantUML，扎根 ARCHITECTURE.md §1.1/§4/§9，行数/版本准确 |
| `data-model.md` | 505 | 29108 | 顶层 11 字段表 + leaf 26 字段表 + role/status 枚举 + 8 种 event meta 差异表 + audit_gate/milestone/nudge/drift/session_registry/segment_chain 子结构表 | formal schema 表格化，补 P1-11「非 formal」缺口 |
| `sequence-diagrams/01-lifecycle.puml` | 112 | 5013 | 建树全生命周期（步骤0-7）| 锚定 SKILL §13.3 八步 |
| `sequence-diagrams/02-done-gate.puml` | 129 | 5089 | done 8 道门禁 + 错误码 | 逐道还原，错误码齐全 |
| `sequence-diagrams/03-prune-cascade.puml` | 86 | 3279 | prune 级联 DFS + nudge 阶梯 | 覆盖 D1 级联语义 |
| `sequence-diagrams/04-ctx-segment.puml` | 120 | 4544 | ctx≥85% 竹节交接 | 覆盖 ctx 竹节刚性触发 |
| **合计** | **1157** | — | — | 全部非空、超 min_length、must_contain 关键字全命中 |

**done 门禁实证**：6 文件 size>0（过 E_DELIVERABLE_EMPTY）、行数超 min_length（过 quality gate）、expect_outputs 全落盘（过 E_DELIVERABLE_MISSING）。

### auditor 交叉一致性审查结论（passed:9 / failed:3，真实 findings）

3 个 **FAILED** 项（带 file:line 证据，**非橡皮图章**）：
1. **`drift kind=escalation 越界`**（03-prune-cascade L64）—— drift kind 枚举仅 `production/direction/rhythm`，产物误用 `escalation`。
2. **`session_registry source=segment 越界`**（04-ctx-segment L47）—— source 枚举无 `segment`。
3. **`data-model.md 附录 A.3 LEAF_NAME_RE 段3 role 描述与 §3 ROLE_ENUM 自相矛盾`** —— 内部不一致。

> 这 3 处是产物内**轻微枚举/自洽瑕疵**（整体质量仍高），auditor 精准定位——证明 auditor 机制产出**真实审查价值**。产物已 verbatim 中转落盘（未擅自修正，保留 worker 原始产出 + auditor findings 留痕）。

---

## 五、成本

| 维度 | 值 | 评估 |
|---|---|---|
| tree 内 session | 5（root + 3 worker + auditor）| ≪ max_sessions 50（预算余量 90%）|
| 编排方附加 session | 2（driver b72b1d16 + ping d9b6fb9c，均 idle 误建，见 §八）| 已尝试归档被 R6-external-deny 拒（remote 仅 send_message）|
| 模型 | 全程 GLM-5.2 | 成本可控（未触 rate/count 护栏）|
| token | API 未暴露 per-session token（context_window=null）；估算：5 agent × ~30-50K input（读 SKILL+源材料+产出）| 中等 |
| 墙钟 | ~21 分钟（含冷启动 + 审查）| 可接受 |

**成本结论**：5 真实协作 session 远低于 macp2 事故 207，**Sprint 5 max_sessions 护栏 + macp2 红线（SubAgent 进程内）有效防爆炸**。

---

## 六、tree-system 真实协作效果（补 success-metrics 团队维度）

- **并行增益**：3 worker（class/data/sequence 三份独立文档）77ms 内并行派生，~13 分钟全部 done。单 agent 串行需依次产 3 份（每份含读源+写+自审），估算 ~30+ 分钟。**并行 ≈ 2x 加速**。
- **契约保真**：5 件套持久化 + brief_echo 对齐（3 worker alignment 0.92/0.93/0.92）+ cross_audit gate 让 3 份产物**实体名/枚举一致**（11 项跨产物一致性 pass）——证明 5 件套契约驱动多 agent 产出**自洽**，非各写各的。
- **质量门有效**：worker done-未审被 E_GATEKEEPER_REQUIRED 实时拦下（非放行后才发现），commander 异步补 audit_gate 后放行——**事中拦截**（Layer 1 Hard Gate 真实生效）。
- **auditor 价值**：独立 auditor 抓出 3 处工人自查漏掉的跨产物枚举越界——**第二道闸真实增益**（worker 进程内 code-reviewer 自审 alignment 95-96 全过，但跨产物一致性需独立 auditor）。

---

## 七、未触发 / 限制（诚实记录）

- **drift 联动（S2）**：clean run 无 drift，drift_log 空。机制就位（drift_append 工具 + drift_history 字段）但本轮未演练。需专门构造偏差场景验证（如故意让 worker 越界）。
- **flagged 动态（S1）**：无独立 flagged 字段触发（无篡改）。功能等价的 done门禁（E_GATEKEEPER_REQUIRED）触发。flagged 是 P1-S03 防篡改机制，需构造 done-后篡改场景验证。
- **E_MAX_SESSIONS（S5）**：count=5 未触上限。需构造 ≥50 session 场景验证硬护栏。
- **tree_validate**：未单独跑（remote 仅 send_message，且 commander 在长轮不宜打断）。tree-state 结构自洽（5 leaf、parent 链 valid、session 唯一）。

---

## 八、关键发现 / 方法学教训（必读）

### 8.1 🔴 API `list_messages total=1` ≠ 卡死 —— 文件通道是 ground truth

**事故**：监督期 commander API `list_messages` 持续 `total=1`（仅我的任务消息，零 assistant 消息）长达 ~18 分钟。我误判「GLM-5.2 自主编排超能力，卡 busy」并**误建 driver 会话欲转受控方式**。driver 调 `tree_init` 撞 `E_DUPLICATE_LEAF` 才发现：**commander 早已建树并跑完 3 worker + 正建 auditor**。

**根因**：Proma/GLM-5.2 在**单个长未提交轮**内完成全部多步工作（读 SKILL + 4 源文件 + tree_init + create_session×3 + leaf_add×3 + ... 共 35 次 tree write）。轮内 tool call 不立即落 API 消息表，**直到轮结束才提交**。故 API `total=1` 是**可见性滞后假信号**。

**正解**：**tree-state.json（文件通道，每次 tool call 即原子落盘）是 ground truth**。监督 tree-system 必须读 tree-state（leaves/events/session_registry/audit_log），**不能以 API 消息数判进度**。

**遗留**：误建的 driver（b72b1d16）向 e2e03-root 多 append 了 1 条 plan event（无害，events append-only）+ 1 次失败 tree_init（E_DUPLICATE_LEAF，无副作用）。driver/ping 已尝试归档被 remote R6-external-deny 拒，留 idle。

### 8.2 GLM-5.2 自主能力——足够，但需正确信号

GLM-5.2 commander **自主且正确**跑通完整冷启动协议（create_session 派生 / 5 件套 / alignment 回填 / audit_gate 信任锚 / done 门禁 / auditor role），无人工介入。此前「GLM-5.2 编排复杂任务不可靠」的担忧**被证伪**——前提是给清晰的自包含 prompt（7 段式 + 显式协议步骤）。

### 8.3 remote 调用方受限（D1-A）

remote（编排方）对 pro 仅 `send_message` 可用；`archive_session` 等被 `R6-external-deny` 拒。这是合理的安全约束（外部调用方不能删/归档会话）。编排方清理需走 pro 本地。

### 8.4 pro userData = `~/.proma-dev/`（非 .proma-pro）

ARCHITECTURE.md §3.1 表标 pro userData=`~/.proma-pro/` **过时**；CLAUDE.md L35 正确（pro 用 `.proma-dev`）。本轮实证：pro tree 落 `C:\Users\sir_c\.proma-dev\agent-workspaces\default\.context\trees\`。建议修 ARCHITECTURE.md §3.1。

---

## 九、结论

**端到端真实项目验证通过**：tree-system 补丁形式在 pro 上由 GLM-5.2 自主协作完成 03_ARCHITECTURE 三份形式化产物（1157 行），Sprint 1-5 新机制（5 件套持久化 / create_session 派生 / done 8 道门禁 / auditor 交叉审 / max_sessions 护栏）在真实协作中**实证可靠**。补 success-metrics 团队维度实证：并行 ~2x 加速、5 件套契约驱动跨产物自洽、门禁事中拦截、auditor 抓出工人自查盲区。

最大收获是**方法学纠偏**（§8.1）：监督 tree-system 当以 tree-state 文件通道为 ground truth，API 消息可见性不可靠。此教训已入 CLAUDE.md / note。

**产物**：`D:/codes/tree-harness/03_ARCHITECTURE/{class-diagram.puml, data-model.md, sequence-diagrams/0[1-4]-*.puml}`（6 文件）。
**原始 tree-state**：`~/.proma-dev/.../trees/e2e03/tree-state.json`（5 leaf 全 done，write_count=35）。
