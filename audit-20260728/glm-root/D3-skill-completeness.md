# D3 SKILL 协议完备性审计报告 — Tree Harness FINAL-REPORT 对抗核验

> 审计员: audit2-D3-worker (GLM-5.2, ZLM 渠道)
> 审计对象: FINAL-REPORT.md 自评 7/7 完成 + C1=86/100；靶子 SKILL = `skills/tree-commander/SKILL.md` v2.9.7（1268 行）
> 审计日期: 2026-07-28
> 审计方法: 独立源头文档逐节核验（SKILL.md v2.9.7 全文 + ERROR-CODES.md 51 码 + tree-worker/auditor SKILL 交叉验证 + FINAL-REPORT §三 6 项改进），**未读** `audit-20260728/` 根目录任何 .md（独立性硬规则遵守）

---

## 一、执行摘要

- **总体判定**: 🔴 **过度宣称**。FINAL-REPORT §三宣称 6 项 harness 改进"全部 PASS + macp10/11 实战零撞击"，但 **SKILL v2.9.7 本身仍存在多处协议级矛盾、错误码表严重残缺、角色模板误导**。FINAL-REPORT 把"实战未撞"等同于"协议完备"，掩盖了 SOP 文档本身的硬伤。
- **confidence**: **high**（所有 finding 均带 SKILL.md 行号 + 矛盾双方原文引用，可直接复核）
- **一句话核心结论**: SKILL v2.9.7 是"实战驱动补丁堆叠"产物——每次 macp 撞墙就补一段（§13.3a/b 接力补章、§13.6.0 idle 核验、§11 #14-#17），但**从未做过整体一致性回归**：错误码速查表覆盖率仅 9/51（17.6%）、§14 数字口径自相矛盾、§11 标题"12 条"实际 17 条、§3.4 final_step 模板对 commander/auditor 角色产生方向性误导。

---

## 二、Findings 表

| # | Severity | 问题摘要 | 证据（file:line / 原文 / 归档） | 对 7/7 或 C1=86 的影响 |
|---|----------|---------|-------------------------|----------------------|
| F1 | 🔴 RED | §13.7 错误码速查表覆盖率 9/51（17.6%），指挥官关键码 E_CHILDREN_NOT_DONE / E_MAX_SESSIONS / E_REVIEW_NOT_CONVERGED / E_DELIVERABLE_EMPTY 全缺 | SKILL.md L1077-1093（仅 9 码）vs ERROR-CODES.md 全集 51 码 | 标准 1/3/6 宣称 PASS 但指挥官撞 E_CHILDREN_NOT_DONE/E_MAX_SESSIONS 时无 SOP 兜底 |
| F2 | 🔴 RED | §13.6.0 idle 多维核验 4 项清单**漏 communication_log 检查**，与 §6/§11 #15 强制要求直接矛盾 | SKILL.md L1055-1067（4 项无 comm_log）vs L407-420（§6 强制）+ L717（§11 #15） | 标准 1（idle 多维核验）宣称 PASS 但 macp6 误判根因正是漏看 comm_log，SOP 未堵 |
| F3 | 🔴 RED | §14.2 "最少 7 leaf 含 fix 缺一不算完成" vs §14.6 "7 leaf = 1 root + 4 + 2 + **可选 fix**" — 数字口径 + fix 强制性双重矛盾 | SKILL.md L1122（§14.2）vs L1239（§14.6） | 标准 7（审计工作流）内部矛盾，指挥官按 §14.6 可省 fix，按 §14.2 不可省 |
| F4 | 🔴 RED | §13.3 step7 漏做触发列表漏 E_CHILDREN_NOT_DONE（父 done 前子全 done）+ E_DELIVERABLE_EMPTY（0 字节产物）| SKILL.md L819（step7 仅列 4 码）vs ERROR-CODES.md L135/L177 | 标准 6（综合实战）宣称 PASS 但 root/commander done 时父节点必撞 E_CHILDREN_NOT_DONE，§13.3a 完全没提 |
| F5 | 🔴 RED | §3.4 autonomy final_step 模板"你（worker）自己调 set-status done" 对 commander/auditor 角色方向性误导 | SKILL.md L153（§3.4）vs L909（§13.3b commander 不需 audit_gate）+ auditor SKILL L372（auditor 不能自设 done） | 5 件套契约模板适用于所有角色却按 worker 视角写，L2 commander/auditor 收到会困惑 |
| F6 | 🟡 YELLOW | §13.3b 身份继承矩阵覆盖 8 工具，**漏 tree_drift_append / tree_log_communication / tree_heartbeat_append** 等常用工具 | SKILL.md L922-943（矩阵 8 行）vs §5 工具全集（L314-374） | v2 接力后卡点必记 drift_append、send_message 后必 log_communication，矩阵未说能否自调 |
| F7 | 🟡 YELLOW | §11 标题"禁止行为清单（**12 条**）" 实际 #1-#17 共 17 条，计数滞后 3 轮迭代未更新 | SKILL.md L697（标题）vs L701-720（实际 17 条） | metadata 一致性硬伤；指挥官按"12 条"心智模型会漏 #14-#17（含 comm_log、待审清单、alignment 回填） |
| F8 | 🟡 YELLOW | §13.3a 自相矛盾：节首"L1767 对 role=root **无豁免**（macp3 实测撞墙）" vs §13.3a.1 "条件：L1767 对 role=root **有豁免**" | SKILL.md L853（节首）vs L857（§13.3a.1 条件） | 当前到底有无豁免未说清，读者无法判断走 §13.3a.1 还是 §13.3a.2 |
| F9 | 🟡 YELLOW | §14.3 审计 5 件套模板只给 6 角色（C1-C4/A1-A2）in_scope，**完全缺 fix 角色模板** | SKILL.md L1131-1187（6 角色）+ L1234-1247（§14.6 fix 列为检查项） | §14.4 Round 1③ 让 Fix 子会话执行修正，但 commander 无 fix brief 模板可抄 |
| F10 | 🟡 YELLOW | §13.4.0 步骤 B→C→D 顺序描述漏"root set-status auditor done"，与 auditor SKILL §6.1 ④ 矛盾 | SKILL.md L983-997（B→C→D）vs tree-auditor SKILL L372（④ root 设 auditor done） | commander 按 §13.4.0 跳过 set-status，auditor 永远 status≠done，V10-auditor-active 三连失败 |
| F11 | 🟡 YELLOW | §3.3 escalation "blocked 超 10 分钟→archive+重 Fork" 跳过 §7 三档递进（low→mid→high） | SKILL.md L139（§3.3）vs L495-545（§7 三档决策树） | blocked 默认 mid severity，§3.3 直接重档剪枝跳过 nudge/limit 两档 |
| F12 | 🟡 YELLOW | §13.4.0a 步骤 5 "status='pending_audit' 超过 **N 分钟**" — N 未定义具体值 | SKILL.md L1012（N 分钟）| commander 无可操作阈值，催审时机全凭感觉 |
| F13 | 🟡 YELLOW | §13.3 步骤前置条件表 step5 前置条件列未嵌入 review_round（仅靠表头上方 L806 提示） | SKILL.md L817（step5 前置条件）vs L806（表头上方提示） | review_required=true 时 step5 前置条件列没写 review_round，读者只看表会漏 |
| G1 | 🟢 GREEN | §13.3 步骤前置条件表设计本身优秀（caller/前置/产物/漏做触发 四列）— 是 SOP 文档化的正向样本 | SKILL.md L808-822 | 协议可追溯性基础扎实，macp 实战可复现 |
| G2 | 🟢 GREEN | §13.3b 身份继承矩阵虽不完整（见 F6），但有矩阵本身是 v2 接力场景的大改进 | SKILL.md L922-943 | macp6 v2 撞 E_BORROWED_IDENTITY 后的系统化沉淀，框架正确 |
| G3 | 🟢 GREEN | §6 communication_log 协议设计正确（v2.9 新增 tree_log_communication 工具 + 自动更新 last_event） | SKILL.md L407-420 + L356 | 防 idle 误判的底层机制到位，问题是 §13.6.0 没引用（见 F2） |

**Severity 分布**: RED × 5 / YELLOW × 8 / GREEN × 3 = 16 findings

---

## 三、详细分析（RED + YELLOW 全展开）

### F1 🔴 §13.7 错误码速查表覆盖率 9/51（17.6%），指挥官关键码全缺

**位置**: `skills/tree-commander/SKILL.md` L1077-1093

**问题**: §13.7 速查表只列了 9 个错误码（E_DUPLICATE_SESSION_ID / E_BORROWED_IDENTITY / E_AUDITOR_NOT_INDEPENDENT / E_AUDIT_PREMATURE / E_SELFCHECK_INVALID / E_DELIVERABLE_MISSING / E_ALIGNMENT_NOT_VERIFIED / E_GATEKEEPER_REQUIRED / E_SCHEMA_INVALID），但 `ERROR-CODES.md` 权威源共 51 码（engine 43 + patches 8）。表末兜底"表没覆盖的，看工具返回里的 `help_topic` 字段"（L1093）是软兜底——指挥官撞码时若返回没带 help_topic 就卡死。

**证据**:

ERROR-CODES.md 权威源关键码（指挥官建树/验收/接力高频撞）**完全不在 §13.7 速查表**：

| 缺失错误码 | 触发场景 | 指挥官撞码频率 |
|-----------|---------|--------------|
| `E_CHILDREN_NOT_DONE`（ERROR-CODES.md L135）| 父叶子 done 前子叶子未全 done | 🔴 高（root/commander done 必撞，macp6 memory 已强调"自底向上"）|
| `E_MAX_SESSIONS`（ERROR-CODES.md L89，Sprint 5 新增）| tree 总会话数 > max_sessions（默认 50） | 🔴 高（macp2 型会话爆炸护栏，建树关键码）|
| `E_REVIEW_NOT_CONVERGED`（ERROR-CODES.md L173）| worker done 但 review_round 未收敛 | 🟡 中（§13.3 step7 漏做触发列了，但速查表没有）|
| `E_DELIVERABLE_EMPTY`（ERROR-CODES.md L177，BUG-3 治理码）| done 时交付物 0 字节 | 🟡 中（worker SKILL §2.6 反复强调，commander 验收会撞）|
| `E_AUDITOR_NOT_DONE`（L155）/ `E_AUDITOR_NO_EVENTS`（L156）/ `E_AUDITOR_NOT_VERIFIED`（L157）| V10-auditor-active 三连失败 | 🟡 中（建 auditor leaf 场景，§13.4.0）|
| `E_REVIEW_FORGERY`（L174）/ `E_REVIEW_FLAGGED_BLOCK`（L175）| review_round 伪造 / 父链 flagged | 🟡 中（review_required=true 时）|
| `E_AUDIT_RED_BLOCKED`（L3300，v0.20）| audit_gate pass 时 audit_log 有 red finding | 🟡 中（auditor 偏松 pass critical 拦截）|
| `E_SUBAGENT_BUDGET_EXCEEDED`（L179）| 单 leaf subagent_spawn ≥ 15 | 🟡 中（worker §4.6 多视角审查时）|
| `E_LEAF_AUTO_PRUNED`（L166）| nudge_count ≥ 7 强制 pruned | 🟡 中（三档纠偏极端情况）|
| `E_NO_OWNERSHIP`（patches L405）| caller 与目标 session 无血缘 | 🟡 中（跨 session 冒用）|
| `E_SESSION_NOT_ALIVE`（L171）| session 真实性校验失败 | 🟡 低（layer2 verifier）|

**后果**: FINAL-REPORT 标准 1（P0 接力协议 + idle 多维核验）+ 标准 3（引擎 segment_add 评估）+ 标准 6（综合实战验证）宣称 PASS，但指挥官撞 E_CHILDREN_NOT_DONE / E_MAX_SESSIONS / E_DELIVERABLE_EMPTY 时**无 SOP 兜底**，只能靠 help_topic 现场查。这是"实战未撞 ≠ 协议完备"的典型——macp10/11 没撞是因为树结构简单（worker 数少、无嵌套 done），不代表 SOP 覆盖到位。

**修复建议**:
1. §13.7 速查表至少补齐指挥官高频码：E_CHILDREN_NOT_DONE / E_MAX_SESSIONS / E_REVIEW_NOT_CONVERGED / E_DELIVERABLE_EMPTY / E_AUDITOR_NOT_DONE / E_AUDIT_RED_BLOCKED / E_NO_OWNERSHIP / E_SUBAGENT_BUDGET_EXCEEDED。
2. 把"表没覆盖看 help_topic"的软兜底升级为硬引用："完整 51 码见 `ERROR-CODES.md`，本表只列指挥官高频码"。
3. 每个 macp 实战新撞的码（macp6 E_CHILDREN_NOT_DONE、macp11 CLI 通道码）必须当轮进 §13.7，不再堆到下轮。

---

### F2 🔴 §13.6.0 idle 多维核验漏 communication_log 检查（与 §6/§11 #15 直接矛盾）

**位置**: `skills/tree-commander/SKILL.md` L1055-1067（§13.6.0 清单）vs L407-420（§6 强制）+ L717（§11 #15）

**问题**: §13.6.0 idle 探测多维核验清单 4 项是：① 产出文件 mtime ② tool calls 计数（list_messages）③ send ping ④ heartbeat/last_event（tree_leaf_get）。**4 项里没有一项检查 communication_log**——但 §6 和 §11 #15 反复强调"心跳巡检读 communication_log 防误判冻结"。这是 SOP 内部直接矛盾。

**证据**:

§6 外部通信记录协议（L407-420）原文：
> "root 通过 `send_message` 驱动 worker/commander（发 brief、nudge、追问、指令）时，这些**外部 IPC 通信 tree 默认看不到**——心跳巡检只看 tree events/call-log，会误判 target leaf '冻结'。v2.9 协议：root 每次 `send_message` 给树内 leaf 后，调一条 `tree_log_communication` 记录"

§11 #15（L717）原文：
> "send_message 给树内 leaf 后漏记 tree_log_communication | 心跳巡检看不到通信活动，误判 target leaf 冻结（macp2 实战 ~10% 漏记触发升级）| ...commander 心跳读 communication_log 感知 IPC 活动"

但 §13.6.0 多维核验清单（L1061-1067）原文：
> "**多维核验清单**（判断 leaf idle 前必须全查，任一非 idle 信号即不 prune）：
> 1. **产出文件 mtime**...
> 2. **tool calls 计数**...
> 3. **send ping**...
> 4. **heartbeat / last_event**..."

**矛盾点**: §6/§11 #15 说"心跳读 communication_log 防误判冻结"，但 §13.6.0 判 idle 的清单里没 communication_log。macp6 J 实战误判根因（§13.6.0 引言 L1057）正是"send_message 撞队列锁 + get_session_context 返回 No usage data"——如果当时清单里有"查 communication_log 最近是否有 communication_out 记录"这一项，root 自己发的 send_message 就会被 last_event_type='communication_out'（L418 引擎自动更新）捕获，不会误判 J idle。

**后果**: FINAL-REPORT 标准 1（idle 多维核验）宣称"macp10/11 实战零 leaf 误判 prune"，但 macp10/11 未误判的原因是树结构简单 + commander 主动多维查，**不是 SOP 清单本身完备**。下个 macp 一旦 commander 只按 §13.6.0 清单 4 项查，漏 communication_log 仍会复发 macp6 型误判。

**修复建议**: §13.6.0 清单加第 5 项（或在第 4 项 heartbeat/last_event 里明示）：
> "5. **communication_log 最近活动**：`tree_communication_list(tree_id, leaf_id=<target>, since=<10min前>)` 看最近是否有 communication_out 记录（root 自己 send_message 后必记，§11 #15）。有近期通信 = target 正在被驱动响应，非 idle。"

---

### F3 🔴 §14.2 vs §14.6 数字口径 + fix 强制性双重矛盾

**位置**: `skills/tree-commander/SKILL.md` L1122（§14.2）vs L1239（§14.6）

**问题**: 两处对"7 leaf 最小结构"的口径完全对不上——§14.2 算的是"审查 leaf 数（不含 root，含 fix）"，§14.6 算的是"含 root 不含强制 fix"。同一个"7"指向两种不同的树结构。

**证据**:

§14.2 铁腕要求（L1121-1125）原文：
> "**铁腕要求**：
> - **最少 7 个审查 leaf**（4 四维 + 2 攻击 + 1 修正），缺一个都不算完成
> - C1-C4 和 A1-A2 必须并行启动（相互独立）
> - 修正员（fix）在所有审查员返回后启动"

按 §14.2 字面：7 leaf = 4（C1-C4）+ 2（A1-A2）+ 1（fix），**fix 强制**，**不含 root**。加 root 应是 8 leaf。

§14.6 完成检查表（L1239）原文：
> "[ ] leaves ≥ 7（1 root + 4 审查 + 2 攻击 + **可选 fix/走查**）"

按 §14.6 字面：7 leaf = 1（root）+ 4 + 2 + fix（**可选**）。fix 不强制，含 root。

**双重矛盾**:
1. **数字口径矛盾**: §14.2 的"7"不含 root，§14.6 的"7"含 root。同一文档同一节内"7 leaf"指代两种结构。
2. **fix 强制性矛盾**: §14.2 "缺一个都不算完成"（fix 强制），§14.6 "可选 fix/走查"（fix 可选）。

**后果**: FINAL-REPORT 标准 7（tree-iterative-development 终版 + 最终归档）宣称 PASS，但 §14 审计工作流自身矛盾。指挥官按 §14.6 可省 fix（"可选"），但 §14.2 又说"缺一个都不算完成"——实战中 commander 倾向按更宽松的 §14.6 执行，导致 fix 闭环（§13.4.6 描述的"non-green findings 进已知但未修复真空"）形同虚设。

**修复建议**: 统一口径。建议 §14.6 改为：
> "[ ] leaves ≥ 8（1 root + 4 审查 + 2 攻击 + 1 fix 强制）"
或 §14.2 改为：
> "最少 6 个审查 leaf + 1 fix = 7 审查 leaf（不含 root）；加 root 共 8 leaf"

并在 §14.6 显式标注"fix 不可省，§14.2 铁腕要求"。

---

### F4 🔴 §13.3 step7 漏做触发列表漏 E_CHILDREN_NOT_DONE + E_DELIVERABLE_EMPTY

**位置**: `skills/tree-commander/SKILL.md` L819（§13.3 步骤前置条件表 step7）

**问题**: §13.3 step7（set-status done）"漏做触发"列只列了 4 个码：E_DELIVERABLE_MISSING / E_GATEKEEPER_REQUIRED / E_SCHEMA_INVALID（milestone未pass）/ E_REVIEW_NOT_CONVERGED。但引擎在 set-status done 时还可能抛 E_CHILDREN_NOT_DONE（父 done 前子未全 done）和 E_DELIVERABLE_EMPTY（0 字节产物）——这两个码在 §13.3 全表和 §13.7 速查表都没有。

**证据**:

§13.3 step7 行（L819）原文：
> "| 7. set-status done | worker | 步骤 0-6 全过 + deliverables 落盘 | worker.status=done | `E_DELIVERABLE_MISSING` / `E_GATEKEEPER_REQUIRED` / `E_SCHEMA_INVALID（milestone未pass）` / `E_REVIEW_NOT_CONVERGED（review_required=true时）` |"

ERROR-CODES.md 权威源：
- `E_CHILDREN_NOT_DONE`（L135）："父叶子有未 done 的子叶子，无法 done"
- `E_DELIVERABLE_EMPTY`（L177）："done 时交付物文件为空"

worker SKILL §2.6（L191）也明确强调 E_DELIVERABLE_EMPTY：
> "**done 门禁 size>0 校验**（治 BUG-3）：引擎在 `cmdLeafSetStatus(status=done)` 时，对每个 `expect_outputs` 校验文件存在 + `fs.statSync().size > 0`；0 字节 → `E_DELIVERABLE_EMPTY`"

**矛盾**: worker SKILL 反复教 E_DELIVERABLE_EMPTY（§2.6 + §4.6 多处），但 commander SKILL §13.3 step7 漏做触发列表和 §13.7 速查表完全没有这个码。commander 验收撞 E_DELIVERABLE_EMPTY 时无 SOP 兜底。

更严重的是 E_CHILDREN_NOT_DONE：memory `macp6-idle-misjudge.md` 和 `multi-layer-tree-commander.md` 都强调"E_CHILDREN_NOT_DONE 父done前子全done自底向上"——这是多层级树 commander done 时的必撞码。但 §13.3a（root done）+ §13.3b（L2 commander done）+ §13.3 step7 全都没提。commander 自己 done 时撞 E_CHILDREN_NOT_DONE 会完全不知道是子叶子未 done 导致。

**后果**: FINAL-REPORT 标准 6（综合实战验证）宣称"§13.3b 多层级 done 零 V10 撞击（macp10）"，但 macp10 树结构是单 commander，没触发父 done 场景。一旦多层级树 commander 自己 done（子 worker 未全 done），commander 撞 E_CHILDREN_NOT_DONE 时 §13.3 全表无解。

**修复建议**:
1. §13.3 step7 漏做触发列补 `E_CHILDREN_NOT_DONE（父 done 前子未全 done）` + `E_DELIVERABLE_EMPTY（0 字节产物）`。
2. §13.3a（root done）和 §13.3b（L2 commander done）显式加一步前置："set-status done 前确认所有子叶子 status=done（否则 E_CHILDREN_NOT_DONE）"。
3. §13.7 速查表同步补这两码（见 F1）。

---

### F5 🔴 §3.4 autonomy final_step 模板对 commander/auditor 角色方向性误导

**位置**: `skills/tree-commander/SKILL.md` L153（§3.4）vs L909（§13.3b）+ tree-auditor SKILL L372

**问题**: §3.4 autonomy final_step 字段是 5 件套契约模板的一部分，commander 给**任何子会话**（worker / L2 commander / auditor）下发 brief 时都用这同一模板。但 final_step 措辞按 worker 视角写（"你（worker）自己调 set-status done"+"收到 audit_gate pass 后"），对 L2 commander 和 auditor 角色产生方向性误导。

**证据**:

§3.4 autonomy final_step（L153）原文：
> "final_step: '完成所有产出 + **收到 audit_gate pass 后**，**你（worker）自己调** tree_leaf_set_status(status=done)。commander 不代调（代调被引擎 E_BORROWED_IDENTITY 拦截）'"

§13.3b macp5 实战发现（L909）原文：
> "📝 **macp5 实战发现：commander 自己 done 不需 audit_gate 代调**（macp5 实证 + 观察员 MiniMax-M3 异厂商核验）：commander 角色 audit_gate.verdict 初始='skip'（引擎设计如此，非临时状态），写 done event + set-status done 直接放行，**无需 root 代调 audit_gate**... 实战发现 root 代调 audit_gate 反撞 E_AUDIT_PREMATURE 'no done event'，commander 写 done event 后直接 set-status done 即可"

tree-auditor SKILL §6.1 ④（L372）原文：
> "[caller=root] ④ tree_leaf_set_status(leaf_id=<auditor 自己>, status=done) # root 设 auditor 状态为 done（auditor 不能自设；引擎硬约束）"

**三重矛盾**:
1. **L2 commander 角色误导**: §3.4 final_step 说"收到 audit_gate pass 后自己调"，但 §13.3b 说 L2 commander **不需 audit_gate**（初始=skip，自己写 done event + set-status 直接放行）。commander 用 §3.4 模板给 L2 commander 子节点发 brief 时，final_step 字段会告诉 L2 commander"等 audit_gate pass"——但 L2 commander 永远等不到（它不需要 audit_gate），会卡死或误上行 blocked。
2. **auditor 角色误导**: §3.4 final_step 说"你（worker）自己调 set-status done"，但 auditor SKILL §6.1 ④ 明确 auditor **不能自设 done**（由 root 设）。commander 给 auditor 子节点发 brief 时 final_step 字段会误导 auditor 自己调 set-status，撞 E_BORROWED_IDENTITY 或引擎硬约束。
3. **顺序冲突**: §3.4 说"收到 audit_gate pass 后"（audit_gate 先，set-status 后），但 §13.3b 说"root 代调 audit_gate 反撞 E_AUDIT_PREMATURE"——对 commander 角色，audit_gate 代调本身就是错路径。

**后果**: 5 件套契约模板是 SKILL §3 核心，适用于所有角色却按 worker 视角硬编码。commander 派 L2 commander 或 auditor 子节点时若不手动改 final_step，子会话按模板执行必撞墙。这是"模板默认值未考虑角色分支"的设计缺陷。

**修复建议**: §3.4 final_step 改为角色分支：
```yaml
final_step:
  worker: "完成所有产出 + 收到 audit_gate pass 后，自己调 tree_leaf_set_status(status=done)"
  commander: "完成所有产出 + 写 done event 后，自己调 tree_leaf_set_status(status=done)（audit_gate 初始=skip，不需代调，§13.3b）"
  auditor: "完成 brief_echo + done event 后等 root 背书；root 调 audit_gate pass + set-status done（auditor 不能自设，§13.4.0）"
```

---

### F6 🟡 §13.3b 身份继承矩阵漏 tree_drift_append / tree_log_communication 等常用工具

**位置**: `skills/tree-commander/SKILL.md` L922-943（身份继承矩阵）

**问题**: §13.3b 接力补章的身份继承矩阵覆盖 8 个工具（event_append/leaf_get / milestone_add / audit_append / milestone_set_result / audit_gate / leaf_set_status / leaf_set_session / segment_add），但 §5 工具全集（L314-374）里多个**接力后高频调用**的工具没进矩阵。

**证据**:

矩阵覆盖的 8 工具（L928-937）：
1. tree_event_append / tree_leaf_get（✅ v2 可自调）
2. tree_milestone_add（❌ 需旧 root 代调）
3. tree_audit_append（❌ 需 auditor 或旧 root 代调）
4. tree_milestone_set_result（❌ 需旧 root 代调）
5. tree_audit_gate（❌ 需旧 root 代调）
6. tree_leaf_set_status（❌ 需旧 root 代调或先 set_session）
7. tree_leaf_set_session（❌ 需旧 root 代调）
8. tree_segment_add（✅ v2 可调）

**漏掉的高频工具**:

| 漏的工具 | 接力后调用频率 | 后果 |
|---------|--------------|------|
| `tree_drift_append` | 🔴 高（v2 撞墙必记 drift，L963 CLI 应急也强制"用后必须留痕 drift_append"）| v2 撞 E_BORROWED_IDENTITY 时不知能否自调 drift_append 记卡点；§13.3b L963 又强制"CLI 应急后必 drift_append 留痕"，但矩阵没说 v2 自调权限 |
| `tree_log_communication` | 🔴 高（§6/§11 #15 强制 send_message 后必调）| v2 接力后发 send_message 给 worker 时，按 §11 #15 必须 log_communication，但矩阵未说 v2 能否自调 |
| `tree_heartbeat_append` | 🟡 中（哨兵 automation 调）| 若哨兵也是接力后 session，权限不明 |
| `tree_nudge_append` | 🟡 中（三档纠偏时）| v2 接管后能否 nudge 子叶子不明 |
| `tree_leaf_set_context` / `tree_leaf_set_last_event` / `tree_leaf_autonomy_override` | 🟡 中（心跳后更新）| 接力后权限不明 |

**矛盾点**: §13.3b L963 明确要求"CLI 应急后必 drift_append 留痕"，但身份继承矩阵没列 tree_drift_append。v2 走 emergent 协作（旧 root 代调）时，旧 root 代调 drift_append 没问题；但 v2 走 CLI 应急后自己调 drift_append 时（CLI 模式省略 callerSessionId 绕过校验，L961），矩阵没说这是允许的。逻辑上 drift_append 应该和 event_append 一样无 owner/creator 校验（v2 可自调），但矩阵不写明，v2 不敢调。

**后果**: v2 接力场景（macp6 实战复现）下，v2 不知道 drift_append / log_communication 能否自调，要么漏记（违反 §11 #15 / CLI 应急留痕要求），要么多绕一圈让旧 root 代调（增加 idle 风险）。

**修复建议**: 矩阵补 3 行：
| 工具 | v2 可自调？ | 原因 |
|------|------------|------|
| `tree_drift_append` | ✅ v2 可自调 | 无 owner/creator 校验（与 event_append 同类，纯追加）|
| `tree_log_communication` | ✅ v2 可自调 | 无 owner/creator 校验（自动定位 target leaf）|
| `tree_heartbeat_append` | ✅ v2 可自调 | 无 owner/creator 校验（哨兵巡检用）|

---

### F7 🟡 §11 标题"12 条"实际 17 条，计数滞后 3 轮迭代

**位置**: `skills/tree-commander/SKILL.md` L697（标题）vs L701-720（实际内容）

**问题**: §11 标题写"禁止行为清单（**12 条**）"，但实际表格 #1 到 #17 共 17 条。计数滞后 3 轮迭代（v2.7 加 #14、v2.9.2 加 #15、v2.9.3 加 #16/#17）始终未更新标题。

**证据**:

§11 标题（L697）：
> "## §11 禁止行为清单（12 条）"

实际最后一条（L719-720）：
> "| 17 | commander 派 worker 后漏回填 alignment event | worker 永远拿不到 audit_gate pass（E_ALIGNMENT_NOT_VERIFIED），卡死无法 done | 执行 §6 回填完成确认清单逐条确认... |"

v2.0（2026-06-18）首次创建时是 12 条（#1-#12），后续：
- v2.7（2026-07-24）加 #13（create_session 未打补丁）+ #14（root 越级 leaf_add worker）—— 实际 §15 v2.7 修订历史 L1260 只提 #14，#13 是 v2.4/v2.5 加的
- v2.9.2（2026-07-25）加 #15（漏记 tree_log_communication）
- v2.9.3（2026-07-25）加 #16（漏待审清单）+ #17（漏回填 alignment）

标题"12 条"从 v2.0 沿用到 v2.9.7 没改过。

**对比**: tree-worker SKILL §7 标题也是"12 条"（worker SKILL L692），但 worker 实际就是 12 条（#1-#12），worker 是对的。commander 的"12 条"是错的。

**后果**: metadata 一致性硬伤。指挥官按"12 条"心智模型会漏 #13-#17（含 comm_log 硬要求、待审清单维护、alignment 回填确认）——这恰恰是 macp2-4 实战暴露的高发违规。

**修复建议**: §11 标题改为"禁止行为清单（**17 条**）"，并在 §15 修订历史约定"每次新增禁止行为必须同步标题计数"。

---

### F8 🟡 §13.3a 自相矛盾：L1767 对 role=root "无豁免" vs "有豁免"

**位置**: `skills/tree-commander/SKILL.md` L853（§13.3a 节首）vs L857（§13.3a.1 条件）

**问题**: §13.3a 节首说"引擎 L1767 对 role=root **无豁免**（macp3 实测撞墙）"，紧接着 §13.3a.1 又说"条件：引擎 L1767 对 role=root **有豁免**（`!isAuditor && !isRoot`）"。两句话并列出现，读者无法判断当前引擎到底有没有豁免、该走 §13.3a.1 还是 §13.3a.2。

**证据**:

§13.3a 节首（L853）原文：
> "root（commander 自己）的 leaf 要 done 时，**不需要**走 §13.3 八步。但引擎 L1767（milestone 非空 + audit_pass=true）对 role=root **无豁免**（macp3 实测撞墙），auto_upgrade 只处理 audit_gate（skip→pass），不豁免 milestone 检查。分三种路径"

§13.3a.1 正常路径（L855-857）原文：
> "#### §13.3a.1 正常路径（引擎已修 L1767 豁免时）
> 条件：引擎 L1767 对 role=root **有豁免**（`!isAuditor && !isRoot`），或 root 已有 milestone。"

**矛盾**: 节首断言"无豁免（macp3 实测）"，§13.3a.1 又把"有豁免"列为正常路径条件。逻辑上应该是"当前 macp3 状态无豁免 → 走 §13.3a.2 备选；未来引擎若加豁免 → 走 §13.3a.1 正常"，但措辞没说清"当前是哪种状态"。读者会问：macp3 之后引擎修了吗？v2.9.7 时是 §13.3a.1 还是 §13.3a.2 是当前路径？

**后果**: command SKILL §13.7 E_SCHEMA_INVALID 修复方法（L1091）说"走 §13.3a.2 备选路径... 若引擎已修 L1767 豁免，直接走 §13.3a.1 正常路径即可"——把判断责任推给读者，但 §13.3a 没给"如何检测引擎是否已修"的方法（如 grep tree-engine.cjs L1767 看 `!isRoot` 是否存在）。

**修复建议**: §13.3a 节首明确"当前状态"：
> "🔴 **当前引擎状态（v2.9.7 / 2026-07-28）**：L1767 对 role=root **无豁免**（macp3 实测，未修）。实战一律走 §13.3a.2 备选路径。§13.3a.1 仅供未来引擎加豁免后参考。检测方法：`grep -n '!isRoot' tree-engine.cjs` 看 L1767 附近是否有此条件。"

---

### F9 🟡 §14.3 审计 5 件套模板缺 fix 角色 in_scope

**位置**: `skills/tree-commander/SKILL.md` L1131-1187（§14.3 六角色模板）

**问题**: §14.3 给了 C1/C2/C3/C4/A1/A2 共 6 个角色的 in_scope 模板，但 §14.2 明确要求"最少 7 个审查 leaf（4 四维 + 2 攻击 + **1 修正**）"，§14.4 Round 1 ③ 也让"Fix 子会话执行修正"——fix 是强制角色，但 §14.3 **完全没有 fix 角色的 in_scope 模板**。

**证据**:

§14.2 铁腕要求（L1122）："最少 7 个审查 leaf（4 四维 + 2 攻击 + 1 修正），缺一个都不算完成"

§14.4 迭代收敛流程（L1192-1196）：
> "Round 1:
>   ① Fork C1-C4 + A1-A2（6 个并行）
>   ② 收集所有问题列表，去重汇总
>   ③ Fix 子会话执行修正"

§14.3 模板覆盖的角色（L1131-1187）：C1 / C2 / C3 / C4 / A1 / A2 — **6 个，无 fix**。

§14.6 完成检查表（L1239）也把 fix 列为检查项（虽然标"可选"，见 F3）。

**矛盾**: fix 是 §14.2/§14.4/§14.6 三处都提及的强制角色，但 §14.3 模板缺位。commander 实战派 fix leaf 时无 in_scope 模板可抄，只能临场编 brief，导致 fix leaf 的修正范围、修正方法（edit_file / downgrade / deferred，§13.4.6 L1036 有定义但 §14.3 没引用）、复审协议不一致。

注：§13.4.6（L1027-1047）有"fix leaf 反馈闭环"专节，定义了 fix leaf 的 fixes_resolved schema，但那是"worker 产物的反馈闭环"，不是"§14 审计任务的批量修正 fix"。两者 commander SKILL §13.4.6 L1043 自己也区分："与 §14.2 fix 区别：§14.2 fix 是审计任务批量修正（审被审文档）；§13.4.6 fix 是独立审 worker 产物的反馈闭环"。所以 §14.2 的 fix 角色确实需要独立 in_scope 模板。

**修复建议**: §14.3 加第 7 个角色模板：
```yaml
**fix 修正执行员**：
in_scope:
  - "收集 C1-C4 + A1-A2 全部 findings，按 severity 排序（red 优先）"
  - "每条 finding 选修正方法：edit_file（改产物，附 diff）/ downgrade（降级附理由）/ deferred（推迟附原因）"
  - "fixes_resolved 覆盖所有 non-green findings（schema 见 §13.4.6）"
  - "修正后自验证：重跑原审查维度确认 finding 已消解"
  - "done event meta 含 fixes_resolved 数组"
```

---

### F10 🟡 §13.4.0 步骤 B→C→D 顺序描述漏"root set-status auditor done"

**位置**: `skills/tree-commander/SKILL.md` L983-997（§13.4.0 步骤 B/C/D）vs tree-auditor SKILL L372（§6.1 ④）

**问题**: §13.4.0 建 auditor leaf 协议四步（A/B/C/D）的步骤 B→C→D 顺序描述里，没明示"root 给 auditor set-status done"这一步——但 auditor SKILL §6.1 ④ 明确说 auditor 不能自设 done，由 root 设。commander 按 §13.4.0 跳过这一步，auditor 永远 status≠done，V10-auditor-active 三连失败。

**证据**:

§13.4.0 步骤 B（L983-987）原文：
> "步骤 B: auditor leaf 完成自身工作（≥2 events 强制 + schema 提示，macp8 补充）
>   auditor leaf 走简化协议：① `tree_event_append(type=brief_echo)` 复述审查任务理解 ② `tree_event_append(type=done)` 含 verdict
>   🔴 **set-status done 前必须 ≥2 events**...
>   → auditor leaf status=done + events ≥2 + audit_gate 初始='required'"

§13.4.0 步骤 C（L989-992）：
> "步骤 C: root 用闸门2 背书 auditor leaf
>   mcp__tree__tree_audit_gate(tree_id, leaf_id=<auditor>, verdict='pass', audit_session_id=<root.session_id>)
>   → 闸门2（root 信任锚）放行 → auditor.audit_gate.verdict=pass"

§13.4.0 步骤 D（L994-997）：
> "步骤 D: auditor leaf 自主给全树任意 leaf 配门禁
>   auditor 自己调 audit_gate / milestone_set_result（caller=auditor.session_id，走闸门3）"

tree-auditor SKILL §6.1 协议五步（L361-378）原文：
> "[caller=auditor]   ① tree_event_append(type=brief_echo...)
> [caller=auditor]   ② tree_event_append(type=done...)
> # ─── 以下 ③④ 由 commander/root 执行 ───
> [caller=root]       ③ tree_audit_gate(leaf_id=<auditor 自己>, verdict=pass, audit_session_id=root.session_id)
> [caller=root]       ④ tree_leaf_set_status(leaf_id=<auditor 自己>, status=done)  # root 设 auditor 状态为 done（auditor 不能自设；引擎硬约束）
> # ─── 以下 ⑤ auditor 才能审 worker ───
> [caller=auditor]    ⑤ tree_audit_append(leaf_id=<worker>...) + tree_audit_gate(leaf_id=<worker>...)"

**矛盾**: auditor SKILL §6.1 是 5 步（①②auditor 自调 → ③root audit_gate pass auditor → **④root set-status auditor done** → ⑤auditor 审 worker）。commander §13.4.0 步骤 B→C→D 把 ①② 合并入 B，③ 对应 C，但 **④（root set-status auditor done）在 §13.4.0 完全缺失**，直接从 C（audit_gate pass）跳到 D（auditor 审别人）。

§13.4.0 步骤 B 末尾"→ auditor leaf status=done + events ≥2 + audit_gate 初始='required'"——这句把 status=done 描述成步骤 B 的产物，但 auditor 不能自设 done（auditor SKILL §6.1 ④ 明确）。所以这个"status=done"应该是步骤 ④（在 C 之后 D 之前）的产物，但 §13.4.0 没单列这一步。

**后果**: commander 按 §13.4.0 执行时，做完 C（root audit_gate pass auditor）直接跳 D（让 auditor 审 worker），但 auditor 此时 status 仍是 active（不是 done），V10-auditor-active 三连（done+events+gate=pass）不满足，auditor 审 worker 时闸门3 拒绝 → E_AUDITOR_NOT_DONE（ERROR-CODES.md L155）。

**修复建议**: §13.4.0 在步骤 C 和 D 之间加步骤 C.5（或把 B 末尾的 status=done 移出来）：
> "步骤 C.5: root 给 auditor set-status done
>   mcp__tree__tree_leaf_set_status(tree_id, leaf_id=<auditor>, status=done)  # caller=root；auditor 不能自设（auditor SKILL §6.1 ④）
>   → auditor status=done，V10-auditor-active 三连齐全（done + events≥2 + audit_gate=pass）"

---

### F11 🟡 §3.3 escalation 跳过 §7 三档递进

**位置**: `skills/tree-commander/SKILL.md` L139（§3.3）vs L495-545（§7 三档决策树）

**问题**: §3.3 report 模板的 escalation 字段写"block 超过 10 分钟未回复根会话 → 升级到 archive + 重 Fork"，但 §7 三档纠偏决策树要求重档剪枝（archive+fork）的触发条件是 severity=high 或"mid+已有 limit 记录"。blocked 超时≠severity=high，§3.3 直接 archive+fork 跳过了 §7 的 low→mid→high 递进。

**证据**:

§3.3 escalation（L139）原文：
> "escalation: 'block 超过 10 分钟未回复根会话 → 升级到 archive + 重 Fork'"

§7 三档纠偏决策树（L523-534）重档剪枝触发条件：
> "elif severity == high OR (mid + leaf 已有 limit 记录):
>     ┌─ 重档剪枝 ─────────────────────────────────────────┐
>     │ archive_session(leaf.session_id)                    │
>     │ mcp__tree__tree_leaf_set_status(tree_id, leaf_id, 'pruned')         │
>     │ fork_session(...)                                   │"

§6 事件路由表 blocked 行（L385）也写"超 10 分钟无响应 → archive + 重 Fork"，与 §3.3 一致。

**矛盾**: §3.3/§6 把"blocked 超 10 分钟"直接映射到重档剪枝动作（archive+fork），但 §7 决策树的重档触发条件是 severity=high 或 mid+limit 记录。blocked 上报本身不携带 severity=high（§6 blocked 行没标 severity），按 §7 应先走轻档 nudge 或中档 limit，而不是直接重档。

逻辑上 blocked 超时是"rhythm"类偏差（节奏问题），按 §7 kind=rhythm + severity=mid 处理更合理（先 limit 再 prune）。但 §3.3/§6 跳过中间档直接 prune。

**后果**: 指挥官对 blocked 子会话的处置过于粗暴——10 分钟未响应就直接 archive+重 Fork，没给 nudge/limit 缓冲。这与 §1 铁律 4"必须三档递进纠偏——同一偏差最多 2 次纠正机会，第 3 次必剪枝"的精神冲突（一次超时就剪枝，没给 2 次机会）。

**修复建议**: §3.3 escalation 改为分档：
> "escalation: 'block 超过 10 分钟未回复 → 第 1 次：send nudge（轻档）→ 仍无响应 5 分钟 → autonomy_override 限权（中档）→ 再无响应 → archive + 重 Fork（重档）'，对齐 §7 三档递进"

或在 §7 决策树加一条"blocked 超时"的专门分支，明确它的 severity 归属。

---

### F12 🟡 §13.4.0a 步骤 5 "N 分钟"未定义具体值

**位置**: `skills/tree-commander/SKILL.md` L1012（§13.4.0a 步骤 5）

**问题**: §13.4.0a 待审 worker 清单维护流程步骤 5 写"status='pending_audit' 超过 **N 分钟**未进入 'in_audit' → 主动催 auditor"——N 是占位符未定义具体值，commander 无可操作阈值。

**证据**:

§13.4.0a 步骤 5（L1012）原文：
> "5. 【催】定期核对清单：status='pending_audit' 超过 N 分钟未进入 'in_audit' → 主动催 auditor"

全文搜索 §13.4.0a 没有给 N 赋值（无"默认 30 分钟"或"建议 N=30"之类说明）。

**对比**: §3.3 plan_ack_seconds 明确"默认 300；60~300"（L138）；§3.3 escalation 明确"10 分钟"（L139）；§6 plan 默认放行明确"5 分钟"（L386）。这些都是具体值，唯独 §13.4.0a 的 N 是占位符。

**后果**: commander 无可操作阈值，催审时机全凭感觉——催早了打扰 auditor，催晚了拖延收敛。macp3 C2 遗漏异厂商审的教训（§13.4.0a 引言）正是中转链无时效约束导致最后一个 worker 滑落，但 §13.4.0a 用占位符 N 没真正解决时效问题。

**修复建议**: §13.4.0a 步骤 5 把 N 赋值：
> "5. 【催】定期核对清单：status='pending_audit' 超过 **30 分钟**（默认）未进入 'in_audit' → 主动催 auditor（send_message + tree_log_communication）。超 60 分钟未进 in_audit → 上行 root 请求干预。"

---

### F13 🟡 §13.3 步骤前置条件表 step5 前置条件列未嵌入 review_round

**位置**: `skills/tree-commander/SKILL.md` L817（step5 前置条件）vs L806（表头上方提示）

**问题**: §13.3 步骤前置条件表 step5（done event）的"前置条件"列只写"步骤 4 + 干活完成 + deliverables 落盘"，没把 review_round event 嵌进去。review_required=true 时 step5 前还需 review_round event 这个前置条件，只靠表头上方 L806 的提示文字带过——读者只看步骤表会漏。

**证据**:

§13.3 表头上方提示（L806）原文：
> "⚠️ 若树的 `audit_meta.review_required=true`（ISS-003 opt-in），步骤 5 前还需 worker 产 ≥1 条 review_round event（末轮 red_count=0，见 §4 Step4 / tree-worker §4.6），否则步骤 7 被 `E_REVIEW_NOT_CONVERGED` 拦。"

§13.3 step5 行（L817）原文：
> "| 5. done event（带 self_check） | worker | **步骤 4 + 干活完成 + deliverables 落盘** | worker.events done 留痕 | — （worker 漏做则永远到不了步骤 6） |"

step5 前置条件列没写"review_required=true 时还需 ≥1 条 review_round event（末轮 red_count=0）"。step7 漏做触发列虽然提了 E_REVIEW_NOT_CONVERGED（L819），但 step5 前置没嵌入，读者按表执行时不会在 step5 前主动产 review_round。

**矛盾**: 表头上方提示说"步骤 5 前还需 review_round"，但 step5 前置条件列没列。SKILL 步骤表是 commander/worker 执行的主索引，提示文字容易被略过。

**后果**: review_required=true 时，worker 按 step5 前置条件列只做"步骤 4 + 干活 + deliverables"就发 done event，到 step7 才撞 E_REVIEW_NOT_CONVERGED——浪费一轮。这本可在 step5 前置就避免。

**修复建议**: step5 前置条件列改为：
> "步骤 4 + 干活完成 + deliverables 落盘 + **（review_required=true 时）≥1 条 review_round event 末轮 red_count=0**"

---

## 四、该维度对 FINAL-REPORT 真实完成度的结论

### 该维度宣称 7/7 真实达成: **5/7**（部分达成）

| 标准 | 宣称 | 真实状态 | 依据 |
|------|------|---------|------|
| 1 | ✅ P0 接力协议 + idle 多维核验 | 🟡 **部分** | 接力协议补章（§13.3b）框架到位（G2），但 idle 多维核验漏 communication_log（F2），macp6 误判根因未真正堵 |
| 2 | ✅ audit_log schema severity + auditor ≥2 events + emergent 协作 | 🟢 **达成** | v0.21 引擎强制 severity，§13.4.0 步骤 B 强调 ≥2 events（虽有 F10 顺序描述缺陷，但内容齐全） |
| 3 | ✅ 引擎 segment_add 评估 | 🟢 **达成** | macp9 三方案论证文档化（A1 否决 / A2 留候选 / A3 落地），评估本身是文档产出非协议完备性 |
| 4 | ✅ 项目层 4 缺陷全修 + C1 85+ | ⚪ **不在本维度** | 项目层（multi-agent-collab-platform），D3 不审 |
| 5 | ✅ C1 权威复评 85+ | ⚪ **不在本维度** | C1 打分归 MiniMax auditor，D3 不打分 |
| 6 | ✅ 综合实战验证 | 🟡 **部分** | macp10/11 未撞是因为树结构简单，不是 SOP 完备。E_CHILDREN_NOT_DONE（F4）/ E_MAX_SESSIONS（F1）在多层级/大规模树必撞，§13.3/§13.7 无解 |
| 7 | ✅ tree-iterative-development 终版 + 最终归档 | 🟡 **部分** | SKILL v2.9.7 落盘但内部矛盾（F3 §14 数字 / F7 §11 计数 / F8 §13.3a 自相矛盾），"终版"宣称过早 |

### 该维度发现的过度宣称

1. **"macp10/11 实战零 V10 撞击" ≠ "协议完备"**（F1/F4）：macp10 单 commander 树没触发父 done / 会话爆炸场景，E_CHILDREN_NOT_DONE / E_MAX_SESSIONS 未被压测。
2. **"idle 多维核验 PASS"**（F2）：§13.6.0 清单漏 communication_log，macp6 误判根因未真正堵。
3. **"SKILL v2.9.7 终版"**（F3/F7/F8）：§14 数字口径矛盾、§11 计数滞后、§13.3a 自相矛盾，未做过整体一致性回归。
4. **"emergent v2 协作教化"**（F6）：身份继承矩阵漏 drift_append / log_communication 等高频工具。

### 该维度发现的遗漏

1. §13.7 错误码速查表覆盖率仅 9/51（17.6%），指挥官关键码全缺（F1）。
2. §13.3 step7 漏做触发列表漏 E_CHILDREN_NOT_DONE / E_DELIVERABLE_EMPTY（F4）。
3. §13.3b 身份继承矩阵漏 tree_drift_append / tree_log_communication（F6）。
4. §14.3 缺 fix 角色 in_scope 模板（F9）。
5. §13.4.0 缺"root set-status auditor done"步骤（F10）。
6. §13.6.0 漏 communication_log 检查项（F2）。

---

## 五、Roadmap 贡献

### P0（阻断级 — 协议级矛盾，不修会复现 macp 型卡死）

- **P0-1（F1）**: §13.7 错误码速查表补齐指挥官高频码（E_CHILDREN_NOT_DONE / E_MAX_SESSIONS / E_REVIEW_NOT_CONVERGED / E_DELIVERABLE_EMPTY / E_AUDITOR_NOT_DONE / E_AUDIT_RED_BLOCKED / E_NO_OWNERSHIP / E_SUBAGENT_BUDGET_EXCEEDED），并把软兜底升级为硬引用 ERROR-CODES.md。
- **P0-2（F2）**: §13.6.0 idle 多维核验清单加第 5 项 communication_log 检查，与 §6/§11 #15 对齐。
- **P0-3（F3）**: §14.2 vs §14.6 数字口径 + fix 强制性统一（建议都改"8 leaf = 1 root + 4 + 2 + 1 fix 强制"）。
- **P0-4（F4）**: §13.3 step7 漏做触发列补 E_CHILDREN_NOT_DONE + E_DELIVERABLE_EMPTY；§13.3a/§13.3b 加"父 done 前子全 done"前置检查。
- **P0-5（F5）**: §3.4 final_step 改为角色分支（worker / commander / auditor 三种 final_step），消除"模板按 worker 视角硬编码"误导。

### P1（高优 — SOP 一致性硬伤，影响可读性和可执行性）

- **P1-1（F6）**: §13.3b 身份继承矩阵补 tree_drift_append / tree_log_communication / tree_heartbeat_append（标注 v2 可自调，无 owner/creator 校验）。
- **P1-2（F7）**: §11 标题"12 条"改"17 条"，§15 修订历史约定"新增禁止行为必须同步标题计数"。
- **P1-3（F8）**: §13.3a 节首明确"当前引擎状态（v2.9.7 / 2026-07-28）：L1767 无豁免，走 §13.3a.2"，并给检测方法（grep tree-engine.cjs）。
- **P1-4（F9）**: §14.3 加 fix 角色 in_scope 模板（第 7 角色）。
- **P1-5（F10）**: §13.4.0 步骤 C 和 D 之间加"步骤 C.5: root set-status auditor done"，对齐 auditor SKILL §6.1 ④。

### P2（中优 — 模糊/口径不严，影响实操精度）

- **P2-1（F11）**: §3.3 escalation 改为分档（nudge → limit → archive+fork），对齐 §7 三档递进；或在 §7 加"blocked 超时"专门分支。
- **P2-2（F12）**: §13.4.0a 步骤 5 把 N 赋值（建议默认 30 分钟，超 60 分钟上行 root）。
- **P2-3（F13）**: §13.3 step5 前置条件列嵌入 review_round（review_required=true 时）。

---

## 六、审计自检（独立性 + 完整性）

- **独立性保持**: ✅ 仅读 BRIEF-CONTEXT §三 白名单源头文档（SKILL.md v2.9.7 全文 1268 行 + ERROR-CODES.md 51 码 + tree-worker/auditor SKILL + FINAL-REPORT.md），**未读** `audit-20260728/` 根目录任何 .md。
- **finding 证据化**: ✅ 每条 finding 带 SKILL.md 行号 + 矛盾双方原文引用（共 16 findings，RED×5 / YELLOW×8 / GREEN×3）。
- **对抗原则遵守**: ✅ 不听 FINAL-REPORT 自评，逐节核验 SKILL.md 内部一致性；RED 全部带"实战未撞 ≠ 协议完备"论证。
- **confidence**: high（所有矛盾点均可在 SKILL.md 直接复核，无主观判断）。

> **核心结论**: SKILL v2.9.7 是"实战驱动补丁堆叠"产物，需做一次**整体一致性回归**（错误码表全覆盖 / 数字口径统一 / 角色模板分支化 / 计数同步）才能称"终版"。当前宣称 7/7 + C1=86 在 SKILL 协议完备性维度**过度宣称**，建议复评时扣除本维度发现的 5 个 RED。
