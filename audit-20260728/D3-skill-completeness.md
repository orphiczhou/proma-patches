# D3 SKILL 完备性审计报告 — tree-commander SKILL v2.9.7

> **审计维度**：协议完备性（矛盾、缺失、重复、模糊）
> **审计对象**：`D:/Codes/tree-harness/skills/tree-commander/SKILL.md` v2.9.7（1268 行）
> **对照参考**：`ERROR-CODES.md`（51 错误码）、`FINAL-REPORT.md`
> **审计日期**：2026-07-28
> **审计身份**：audit-D3-commander（独立 auditor leaf，tree_id=audit）

---

## 审计方法

对 SKILL 全文逐节审查，交叉验证以下维度：
- **矛盾**：SKILL 内部两处说 X 又说非 X
- **缺失**：协议步骤遗漏关键错误码、工具、或异常路径
- **重复**：同一内容在不同章节重复但不一致
- **模糊**：协议步骤可执行性不足，操作者会因歧义卡住
- **与 ERROR-CODES.md 一致性**：§13.7 速查表是否覆盖关键错误码

每条 finding 标注 severity（red/yellow/green）和精确 § 引用。

---

## 矛盾清单 + 缺失协议 + 模糊点 汇总

| # | Severity | § 引用 | 问题类型 | 问题摘要 |
|---|----------|--------|---------|---------|
| F1 | 🔴 red | §11 (L697) | **矛盾** | 标题写"12 条"但实际有 17 条（#1–#17），计数严重滞后 |
| F2 | 🔴 red | §14.2 (L1122) vs §14.6 (L1239) | **矛盾** | fix leaf 强制 vs 可选——§14.2 要求最少 7 leaf 含 fix，§14.6 称 fix "可选" |
| F3 | 🔴 red | §14.2 (L1112) vs §14.3 (L1129-1187) | **矛盾** | §14.2 规定 7 leaf（含 fix），§14.3 只给了 6 个角色的 in_scope 模板（缺 fix） |
| F4 | 🔴 red | §13.3a (L849) vs §13.3a.2 (L869-872) | **矛盾** | 声称"不走 §13.3 八步"但备选路径复用 §13.3 步骤 1–2（milestone_add/set_result） |
| F5 | 🟡 yellow | §6 (L382-389) vs §5 (L328) | **缺失** | 事件路由表仅覆盖 6/11 种事件类型，nudge/limit/status_check/review_round/subagent_spawn 无路由指令 |
| F6 | 🟡 yellow | §13.7 (L1081-1092) vs ERROR-CODES.md | **缺失** | 速查表仅 9/51 错误码；`E_CHILDREN_NOT_DONE`、`E_AUDITOR_NOT_DONE`、`E_AUDITOR_NO_EVENTS`、`E_AUDITOR_NOT_VERIFIED`、`E_MAX_SESSIONS`、`E_DELIVERABLE_EMPTY`、`E_REVIEW_NOT_CONVERGED` 等指挥官关键码完全缺失 |
| F7 | 🟡 yellow | §13.6.0 (L1062-1067) vs §6 (L409-420) | **缺失** | idle 多维核验 4 项清单未包含 `communication_log` 检查——§6 强制记 comm_log 的核心目的就是防误判 idle，但 idle 探测清单却漏了它 |
| F8 | 🟡 yellow | §13.3b 接力补章 (L941) vs 身份矩阵 (L937) | **缺失** | emergent v2 能力描述遗漏 `tree_segment_add`（矩阵标注 ✅ 可自调，正文只列了 event_append + leaf_get） |
| F9 | 🟡 yellow | §13.3 步骤 7 (L819) | **缺失** | 步骤 7 可能错误码列表遗漏 `E_CHILDREN_NOT_DONE`（commander 有子 leaf 时必撞）和 `E_DELIVERABLE_EMPTY` |
| F10 | 🟡 yellow | §13.4.0a 步骤 3 (L1009-1010) | **模糊** | "可省中转"依赖 R7-sibling-send，但未说明如何判断直发是否已启用——操作者不知该走中转还是直发 |
| F11 | 🟡 yellow | §13.7 (L1091) | **模糊** | `E_SCHEMA_INVALID` 描述仅写了 root done 场景，实际覆盖 schema 校验失败的全部场景（leaf 结构非法、milestone 格式错等），严重误导诊断方向 |
| F12 | 🟡 yellow | §13.4.6 (L1041 vs L1044) | **模糊** | fix leaf "走完整 worker 协议（brief_echo...）"但随即说 commander "立即回填 alignment=1.0，不等 fix leaf 自己 brief_echo"——是否仍需要 fix leaf 自己写首条 brief_echo 未明确 |
| F13 | 🟢 green | §13.0 (L791) vs §13.3a (L849-851) | **模糊** | "root"一词在 §13.3a 和 §13.3b 中语义不同：§13.3a 的 root 含"单 commander 树中 root===commander"，§13.3b 的 root 特指树根 leaf。虽 L791/L851 有注释但分散易忽略 |
| F14 | 🟢 green | §13.4.0 步骤 B (L985) | **模糊** | auditor 需 ≥2 events，但只列了 brief_echo + done。auditor 的 alignment 回填是否需要未说明（worker 需要，auditor 是否需要？） |
| F15 | 🟢 green | §3.4 (L153) | **模糊** | `final_step` 模板预置 "收到 audit_gate pass 后自己调 set-status done"——但 §13.3b 说 commander done 不需 audit_gate，此模板对 commander 角色产生误导 |
| F16 | 🟢 green | §13.3b 接力补章矩阵 (L927-937) | **缺失** | 身份矩阵仅覆盖 8 个工具，`tree_drift_append`、`tree_heartbeat_append`、`tree_log_communication`、`tree_communication_list`、`tree_event_list` 等常用工具未列入 |

---

## 详细分析

### F1 🔴 §11 标题计数错误（12 vs 17）

**位置**：`SKILL.md:697`

**问题**：标题 `## §11 禁止行为清单（12 条）` 声称 12 条，实际表格含 #1–#17 共 17 条。修订历史（L1255-1256）显示 v2.9.3 新增了 #16（漏待审清单）和 #17（漏回填 alignment），v2.7 新增了 #14（越级 leaf_add），v2.4 新增了 #13（create_session vs fork_session），v2.9 新增了 #15（漏记 comm_log）。每轮加条目但从未更新标题计数。

**后果**：新读者按标题预期 12 条，实际翻到 17 条，会怀疑文档维护质量。

**修复建议**：改为"禁止行为清单（17 条）"。

---

### F2 🔴 §14.2 vs §14.6 fix leaf 强制 vs 可选矛盾

**位置**：
- `SKILL.md:1122` — §14.2："最少 7 个审查 leaf（4 四维 + 2 攻击 + 1 修正），**缺一个都不算完成**"
- `SKILL.md:1239` — §14.6："leaves ≥ 7（1 root + 4 审查 + 2 攻击 + **可选** fix/走查）"

**问题**：同一份 SKILL 内部，fix 在 §14.2 是强制必需的（"缺一个都不算完成"），在 §14.6 完成检查表中又变成"可选"。操作者无法确定到底要不要建 fix leaf。

**后果**：若按 §14.6 省略 fix → §14.4 迭代收敛流程步骤 ③ "Fix 子会话执行修正" 无法执行（无 fix leaf 可用）→ 审计收敛流程整体卡死。

**修复建议**：统一为强制。删除 §14.6 的"可选"标注，改为"1 fix（修正执行员，不可省略）"。

---

### F3 🔴 §14.2 fix 角色声明 vs §14.3 模板缺失

**位置**：
- `SKILL.md:1112` — §14.2：`{tree_id}-fix — 修正执行员（等审查完成后统一修改）`
- `SKILL.md:1129-1187` — §14.3：提供 C1/C2/C3/C4/A1/A2 共 **6 个** 角色的 in_scope 模板

**问题**：§14.2 声明 fix 是审计树的第 7 个 leaf，但 §14.3 "审计 5 件套模板"只给了 6 个角色的 in_scope，**fix 角色无模板**。下发 fix 子会话时，commander 不知道该在 brief.in_scope 里写什么。

**后果**：操作者只能自行猜测 fix 的 in_scope，与 C1-C4/A1-A2 有标准模板的质量不一致。

**修复建议**：在 §14.3 补充 fix 角色的 in_scope 模板（含修正范围、优先级规则、与 auditor 复审的交接协议）。

---

### F4 🔴 §13.3a "不走 §13.3 八步"但备选路径复用步骤 1–2

**位置**：
- `SKILL.md:849` — §13.3a 标题："root 自身 done（三路径，不走 §13.3 八步）"
- `SKILL.md:869-872` — §13.3a.2 备选路径：`milestone_add → milestone_set_result → done event → set-status done`
- `SKILL.md:808` — §13.3 步骤表：步骤 1 = milestone_add，步骤 2 = milestone_set_result

**问题**：§13.3a 声称 root done "不走 §13.3 八步"，但备选路径 (§13.3a.2) 的前两步就是 §13.3 的步骤 1 和 2（milestone_add + milestone_set_result）。声称与内容自相矛盾。

更深层问题：§13.3 标注为"root 给 worker 配齐 done 前置"，但 §13.3a 是"root 自身 done"——两个不同场景。读者看到 §13.3a "不走八步"后，可能误以为 root 自身 done 完全不需要 milestone 操作，实际备选路径仍需要。

**后果**：操作者走 §13.3a.2 备选路径时，会困惑"不是说好不走八步吗为什么还在做步骤 1 和 2"。

**修复建议**：改为"root 自身 done（三路径，精简自 §13.3 子集——仅需步骤 1-2 的 milestone 操作，无需步骤 3-7 的 worker 交互步骤）"。

---

### F5 🟡 §6 事件路由表只覆盖 6/11 事件类型

**位置**：
- `SKILL.md:382-389` — §6 路由表：done / blocked / plan / brief_echo / heartbeat_reply / progress（6 种）
- `SKILL.md:328` — §5 event_list 文档：11 种事件类型（done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check/review_round/subagent_spawn/progress）

**问题**：缺失 5 种事件的路由指令：
- **nudge / limit**：§7 三档纠偏会触发这些事件，但 §6 路由表没写收到后在 commander 端怎么处理
- **status_check**：§8 心跳通道会发 status_check，但 §6 没写 worker 回应 heartbeat_reply 后怎么关联到 status_check
- **review_round**：§4 Step4 + ISS-003 强制 review_round event，但 §6 没写收到后做什么
- **subagent_spawn**：引擎自动登记，但 commander 收到此事件时是否需要关注（如检查预算消耗）

**后果**：commander 收到这 5 种事件时，没有标准路由指令，只能自行猜测处理方式。

**修复建议**：补充 5 行的路由表（至少 nudge/limit/status_check/review_round）。

---

### F6 🟡 §13.7 速查表严重不完整（9/51，缺关键指挥官码）

**位置**：`SKILL.md:1081-1092` vs `ERROR-CODES.md`（51 错误码）

**问题**：SKILL §13.7 仅列 9 个错误码，大量对 commander 关键的错误码缺失：

| 缺失错误码 | 为什么指挥官需要知道 |
|-----------|-------------------|
| `E_CHILDREN_NOT_DONE` | commander 自身 done 前子 leaf 必须全部 done，撞此码意味着要等待或 prune 子 leaf |
| `E_AUDITOR_NOT_DONE` | 建 auditor leaf 配门禁时 auditor 自身未 done，冷启动→正常期过渡失败 |
| `E_AUDITOR_NO_EVENTS` | auditor leaf events 为空不满足 V10-active，步骤 B 执行不完整 |
| `E_AUDITOR_NOT_VERIFIED` | auditor 自身 audit_gate 非 pass，步骤 C 未执行或失败 |
| `E_MAX_SESSIONS` | 树总 session 达上限，无法继续 leaf_add。需清理僵尸 session 或提额 |
| `E_DELIVERABLE_EMPTY` | 产出文件存在但为空，worker 写了占位符 |
| `E_REVIEW_NOT_CONVERGED` | review_required=true 时 worker review_round 未收敛 |
| `E_STATUS_TRANSITION_INVALID` | 非法状态流转（如 done→active），segment_pending→done 需经 active 中转 |

虽然 §13.7 开头说"表没覆盖的看 help_topic"，但缺失的恰好是 commander 最常撞的错误码。

**后果**：commander 撞到上述错误码时无法在 SKILL 内查到修复方法，额外走 help_topic 增加排查延迟。

**修复建议**：至少补充上述 8 个关键码。

---

### F7 🟡 §13.6.0 idle 核验清单遗漏 communication_log

**位置**：
- `SKILL.md:1062-1067` — §13.6.0：4 项核验清单（mtime / tool calls / ping / heartbeat）
- `SKILL.md:409-420` — §6：强制 `tree_log_communication` 的核心理由是"心跳巡检只看 tree events/call-log，会误判 target leaf 冻结"

**问题**：§6 花了大量篇幅（L409-420）论证 comm_log 对防止 idle 误判的重要性，但 §13.6.0 的 4 项 idle 核验清单中**完全没有包含 `tree_communication_list` 检查**。

逻辑矛盾：如果 comm_log 是防误判 idle 的关键信号，为什么 idle 核验时不去查它？

**后果**：commander 执行 idle 探测时可能漏掉最近的通信活动信号（如 root 刚发了 nudge 但 worker 还没回应），仍误判 idle。

**修复建议**：在第 4 项"heartbeat / last_event"后追加通信活动检查：`tree_communication_list(tree_id, leaf_id=<target>, since=<10min ago>)` 看近期是否有 inbound/outbound 通信。

---

### F8 🟡 §13.3b 接力补章 v2 能力描述遗漏 segment_add

**位置**：
- `SKILL.md:937` — 身份矩阵：`tree_segment_add` ✅ v2 可自调
- `SKILL.md:941` — emergent 协作模式正文："v2 担当"上下文接力"：**只能** event_append + leaf_get + 写报告 + 读 comm_log"

**问题**：身份矩阵标注 segment_add 是 v2 可自调的 2 个工具之一（另一个是 event_append），但正文能力列表遗漏了 segment_add。

**后果**：读者读正文时可能以为 v2 连 segment_add 都不能调，从而不敢接力。

**修复建议**：正文能力列表追加 segment_add。

---

### F9 🟡 §13.3 步骤 7 错误码列表不完整

**位置**：`SKILL.md:819`

**问题**：步骤 7（set-status done）的可能错误码列了 4 个：`E_DELIVERABLE_MISSING / E_GATEKEEPER_REQUIRED / E_SCHEMA_INVALID / E_REVIEW_NOT_CONVERGED`。遗漏：
- `E_CHILDREN_NOT_DONE`：当被 done 的 leaf 是 commander 且有未 done 子 leaf 时必然触发
- `E_DELIVERABLE_EMPTY`：产出文件存在但内容为空

**后果**：commander 自身 done 时撞 `E_CHILDREN_NOT_DONE`，步骤 7 的速查表帮不上忙。

**修复建议**：追加这两个错误码。

---

### F10 🟡 §13.4.0a 步骤 3 "中转 vs 直发"缺乏判断标准

**位置**：`SKILL.md:1009-1010`

**问题**：步骤 3 原文："root 中转审查请求给 auditor（macp4 P1-B R7-sibling-send 已让兄弟直发，可省中转；未启用直发时仍走 root 中转）"

"可省中转"和"未启用直发"暗示存在一个直发功能的开关，但 SKILL 没有说明：
- 什么是 R7-sibling-send？如何判断是否已启用？
- 直发和 root 中转的适用条件分别是什么？
- 两种路径下 commander 的操作有何不同？

**后果**：操作者不知道该走中转还是直发，可能两种都不做导致审查请求丢失。

**修复建议**：明确直发/中转的选择规则，或统一推荐一种路径。

---

### F11 🟡 §13.7 E_SCHEMA_INVALID 描述过于狭窄

**位置**：`SKILL.md:1091`

**问题**：速查表中 `E_SCHEMA_INVALID` 仅写了"root 调 set-status done 撞 L1767 milestone 门禁"。但 `E_SCHEMA_INVALID` 是引擎最通用的 schema 校验错误码，覆盖：
- tree-state.json schema 校验失败（ERROR-CODES.md L127）
- leaf 结构非法（命名不合规、role 越界等）
- milestone 格式非法（id/desc/expect_outputs 缺字段）
- audit_append report.results[] severity 缺/错值（macp6 实证）
- self_check schema 非法
- 等等

只写 root done 场景会误导指挥官：撞 `E_SCHEMA_INVALID` 就去走 §13.3a.2 备选路径，但实际根因可能是 deliverable 路径格式错误或 milestone schema 非法。

**后果**：误导性诊断方向，增加排查时间。

**修复建议**：改为"tree/leaf/milestone/event schema 校验失败（多个触发点）。先看 error.message 定位具体字段，再对照 ERROR-CODES.md 排查。"

---

### F12 🟡 §13.4.6 fix leaf brief_echo 流程歧义

**位置**：`SKILL.md:1041` vs `SKILL.md:1044`

**问题**：
- L1041："fix leaf 是 role=worker（不是 auditor），走完整 worker 协议（brief_echo + milestone + done + audit_gate）"
- L1044："fix leaf 派出后立即回填 alignment=1.0……commander 派 fix leaf 后立即 tree_event_append(type=brief_echo, meta={alignment:"1.0"...}) 到 fix leaf，**不等 fix leaf 自己 brief_echo**"

这两句产生歧义：
1. commander 回填 alignment 后，fix leaf 是否还需要自己写首条 brief_echo（含 my_understanding）？
2. 如果需要，两条 brief_echo event 的先后顺序和关系是什么？
3. 如果不需要（commander 代写了首条），那还算"走完整 worker 协议"吗？

**后果**：fix leaf 可能等待自己写 brief_echo（但 commander 已代填），或跳过（但协议要求）。

**修复建议**：明确 fix leaf 的 brief_echo 简化协议：commander 代写首条 brief_echo（alignment=1.0），fix leaf 不需要再写 brief_echo，直接开始修复工作。或明确 fix leaf 仍需自己写首条（commander 只补 alignment 回填），两者不互斥。

---

### F13 🟢 §13.0/§13.3a/§13.3b "root" 术语多义

**位置**：`SKILL.md:791` vs `SKILL.md:849-851` vs `SKILL.md:886-888`

**问题**：
- §13.0 定义："多层级树（≥3 层）下的 'root' = 树根 leaf（role=root），≠ 当前 L2 commander"
- §13.3a："本节 'root' 指树根 leaf（role=root）。单 commander 树（macp2/macp3，root===commander 自己）下本节直接适用"
- §13.3b："L2 commander 多层级 done 路径"

三个章节用同一个词 "root" 指代不同概念：树根 leaf / 单层树中的 commander-self / 代调协议中的权限锚。虽然有 L791 和 L851 的注释，但分散在不同位置，读者容易在 §13.3b 中看到"root 代调"时误以为是"commander 自己调"。

**后果**：轻微理解障碍，已有注释缓解但不够集中。

**修复建议**：在 §13.0 末尾追加一个术语速查表，统一标注 root 在三个子节中的精确语义。

---

### F14 🟢 §13.4.0 步骤 B auditor alignment 回填未说明

**位置**：`SKILL.md:983-986`

**问题**：步骤 B 说 auditor leaf 需 ≥2 events（brief_echo + done）。但 worker 的 brief_echo 回填 alignment 是 V5b 硬前置（§13.3 步骤 4）。auditor 的 brief_echo 是否也需要 alignment 回填？如果需要，谁来评估 auditor 的对齐度（auditor 自己审查别人，谁来审查 auditor 的对齐度）？

上下文推断应为"不需要"——因为 auditor 走闸门 2（root 背书），不依赖自己的 alignment。但 SKILL 没有明确说"auditor 不需要 alignment 回填"，操作者可能因过度遵守协议而卡住。

**后果**：谨慎的指挥官可能试图给 auditor 回填 alignment 但不知道评估标准和 auditor_session_id 填谁。

**修复建议**：在步骤 B 明确标注"auditor 不需要 alignment 回填（闸门 2 走 root 背书，不走 V5b 独立 auditor 路径）"。

---

### F15 🟢 §3.4 final_step 模板对 commander 角色误导

**位置**：`SKILL.md:153`

**问题**：5 件套模板的 `autonomy.final_step` 预置为："完成所有产出 + 收到 audit_gate pass 后，你（worker）自己调 tree_leaf_set_status(status=done)"

但 §13.3b 发现 commander 的 audit_gate 初始 = skip，commander done 不需 audit_gate pass（L909）。如果下发任务给角色为 commander 的子会话时原样复制了这个 final_step，commander 会等待一个永远不会来的 audit_gate pass。

**后果**：commander 子会话可能无限等待 audit_gate pass 而卡死。

**修复建议**：在模板中加注释"对 role=commander 的子会话，改为'完成所有产出后自己调 set-status done（commander 的 audit_gate 初始=skip，不需等待 pass）'"。

---

### F16 🟢 §13.3b 接力身份矩阵覆盖不全

**位置**：`SKILL.md:927-937`

**问题**：身份矩阵覆盖了 8 个工具，但 v2 在日常操作中还会用到：
- `tree_drift_append`（记录偏差）— 未列入
- `tree_heartbeat_append`（心跳记录）— 未列入
- `tree_log_communication`（通信记录）— 未列入
- `tree_communication_list`（查询通信）— 未列入
- `tree_event_list`（查询事件）— 未列入

这些工具未列入矩阵，v2 操作者不知能否自调。

**后果**：v2 可能不敢调用这些工具（即便其中一些没有 caller 校验），或调了被拦（如果有 caller 校验），产生不必要的摩擦。

**修复建议**：补齐矩阵中常用工具的归属标注。

---

## 自查 Check-list

| # | 检查项 | 状态 |
|---|--------|------|
| 1 | §13 系列全子节（§13.0–§13.7）逐条审查 | ✅ |
| 2 | §13.3a root 三路径逐条审查 | ✅ |
| 3 | §13.3b L2 接力协议 + 补章逐条审查 | ✅ |
| 4 | §13.4.0 建 auditor 四步 + §13.4.0a 待审清单 6 步 | ✅ |
| 5 | §13.4.6 fix leaf 反馈闭环 | ✅ |
| 6 | §13.6 idle 多维核验 4 项清单 | ✅ |
| 7 | §13.7 错误码速查表 vs ERROR-CODES.md | ✅ |
| 8 | §6 事件路由表 6 种事件逐条审查 | ✅ |
| 9 | §6 brief_echo 回填确认清单 | ✅ |
| 10 | §11 禁止行为 17 条逐条审查 | ✅ |
| 11 | §14 审计工作流全子节（§14.1–§14.6） | ✅ |
| 12 | §4 Step2.1 层级委派协议 + W_STAR_DEGRADATION | ✅ |
| 13 | §13.3a vs §13.3b root done 矛盾交叉验证 | ✅ |
| 14 | §13.3b 接力补章 macp9 修正一致性交叉验证 | ✅ |
| 15 | §13.4.6 fix leaf vs §14.2 fix 角色混淆交叉验证 | ✅ |
| 16 | 每条 finding 有 severity + §引用 + 具体描述 | ✅ |

---

## 审计结论

**SKILL v2.9.7 协议完备性评级：B−（有明显缺陷，不可直接用于生产）**

- **4 red findings**：3 个内部矛盾（F1/F2/F3 为事实性矛盾；F4 为声称与内容自矛盾），1 个 fix 角色模板缺失协议（F3）
- **8 yellow findings**：关键缺失协议（事件路由不完整、错误码严重缺失、idle 清单遗漏 comm_log、协议模糊点）
- **4 green findings**：术语歧义、小范围缺失协议，不影响核心流程可执行性

**最严重问题**：
1. **§14 fix 角色强制/可选矛盾（F2）**——若按 §14.6 跳过 fix，审计收敛流程直接断裂
2. **§13.7 遗漏 E_CHILDREN_NOT_DONE（F6）**——这是 commander done 最常见的阻断错误码，速查表竟然没有
3. **§6 事件路由表只覆盖半数事件（F5）**——nudge/limit/status_check/review_round 无路由指令，等于 commander 在这些关键事件上没有标准操作手册

**FINAL-REPORT 声称与实际差距**：FINAL-REPORT 描述了 6 项 harness 改进已落地，这是事实。但"SKILL v2.9.7 已完备"的说法不成立——上述 4 个 red finding 和 8 个 yellow finding 表明 SKILL 在协议层仍有明显缺口和内部矛盾，需要在下一轮迭代中修复。

---

*审计完成时间：2026-07-28 11:34 → 2026-07-28 TBD*
*审计方：audit-D3-commander（独立 auditor leaf，tree_id=audit）*
