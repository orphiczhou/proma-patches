# Commander B — 对抗攻击测试报告 (Round 1)

> 执行者: Commander B (session `d3ad6373-e8f1-4577-af04-0b1d73e4f05f`)
> 执行时间: 2026-06-26 20:44 - 20:52 GMT+8
> 维度: 对抗攻击 (audit-attacks)
> 范围: B1-B12
> tree_id 前缀: `cr6b01` - `cr6b06`

---

## 一、用例执行详情

### B1: Bug A — commander 代 worker 写 done（借身份检测）

| 项 | 值 |
|---|---|
| tree_id | `cr6b01` |
| 攻击向量 | Commander session (`d3ad6373`) 尝试为 worker leaf (`cr6b01-A-worker`, session=`3fbd5eb9`) 写入 done event |
| 期望拦截点 | `E_BORROWED_IDENTITY` (cmdEventAppend L1498) |
| 实际结果 | `E_BORROWED_IDENTITY` — "caller d3ad6373... cannot write done event to leaf cr6b01-A-worker (session=3fbd5eb9...). Only the leaf owner itself can mark done." |
| 判定 | **PASS** |

---

### B2: Bug B — 同 session 多 leaf（重复 session_id 检测）

| 项 | 值 |
|---|---|
| tree_id | `cr6b02` |
| 攻击向量 | 在已存在 `cr6b02-A-worker`（session=`3fbd5eb9`）的树上，尝试用同一 session_id 创建第二个 leaf `cr6b02-B-worker` |
| 期望拦截点 | `E_DUPLICATE_SESSION_ID` (cmdLeafAdd L705-718) |
| 实际结果 | `E_DUPLICATE_SESSION_ID` — "session_id 3fbd5eb9... already used by leaf cr6b02-A-worker. Each session can only register one leaf per tree." |
| 判定 | **PASS** |

---

### B3: v626 篡改 — 自审通过（W-AUDIT-SELF）

| 项 | 值 |
|---|---|
| tree_id | `cr6b03` |
| 攻击向量 | 直接篡改 tree-state.json，设置 worker audit_gate: `verdict=pass` + `auditor_session_id=worker自身session_id`（即 `9ee78f09`） |
| 期望拦截点 | W-AUDIT-SELF 触发 |
| 实际结果 | `tree_validate` 检出 `audit_gate_not_independent`: "auditor is the leaf itself" + `alignment_not_recorded` + `status_event_mismatch` — 共 3 个 issue |
| 判定 | **PASS** — `audit_gate_not_independent` 即 W-AUDIT-SELF 语义，篡改被正确检出 |

---

### B4: v626 篡改 — worker 当 auditor（W-AUDIT-WORKER）

| 项 | 值 |
|---|---|
| tree_id | `cr6b04` |
| 攻击向量 | 2 worker 树：篡改 worker A audit_gate: `verdict=pass` + `auditor_session_id=worker B session_id`（`f1bbec64`），模拟跨 worker 互审 |
| 期望拦截点 | W-AUDIT-WORKER 触发 |
| 实际结果 | `tree_validate` 检出 `audit_gate_not_independent`: "auditor leaf cr6b04-B-worker status=pending_brief (must be done; auditor must have completed its own audit work)" + `alignment_not_recorded` + `status_event_mismatch` |
| 判定 | **PASS** — 正确识别 auditor 为另一个未完成的 worker，审计独立性校验生效 |

---

### B5: v626 篡改 — audit_log 伪造 pass（W-AUDIT-TAMPER）

| 项 | 值 |
|---|---|
| tree_id | `cr6b05` |
| 攻击向量 | 直接篡改 tree-state.json，注入伪造的 audit_log 条目（含 schema 合规格式：type/milestone_id/passed/failed/total/results[{item,pass,evidence}]），auditor_session_id 为不存在于树中的 UUID |
| 期望拦截点 | W-AUDIT-TAMPER 触发 |
| 实际结果 | `tree_validate` 检出 `alignment_not_recorded` + `status_event_mismatch`（通用完整性），但**未触发**特定的 W-AUDIT-TAMPER 代码。API 层面 `tree_audit_append` 有严格的 schema + UUID v4 校验防止写入伪造条目，但直接 JSON 篡改绕过。 |
| 判定 | **PARTIAL PASS** — 通用完整性校验检出异常，但缺少专用 W-AUDIT-TAMPER 校验。直接 JSON 篡改可注入合规格式的伪造 audit_log |

---

### B6: v626 篡改 — NO-ALIGN（W-AUDIT-NO-ALIGN）

| 项 | 值 |
|---|---|
| tree_id | `cr6b06` |
| 攻击向量 | 直接篡改 tree-state.json，设置 worker status=`done` 但 events=[]（无 brief_echo / alignment 事件） |
| 期望拦截点 | W-AUDIT-NO-ALIGN 触发 |
| 实际结果 | `tree_validate` 检出 `alignment_not_recorded`: "worker done but no brief_echo event carries alignment (alignment_pending flag may be tampered)" + `status_event_mismatch` |
| 判定 | **PASS** — `alignment_not_recorded` 即 W-AUDIT-NO-ALIGN 语义 |

---

### B7: workspace_id 跨工作区 — create_session（R2 校验）

| 项 | 值 |
|---|---|
| 攻击向量 | `create_session(workspace_id=00000000-0000-0000-0000-000000000000)` |
| 期望拦截点 | `E_WORKSPACE_NOT_FOUND` (R2 L461) |
| 实际结果 | `E_WORKSPACE_NOT_FOUND` — 返回 7 个有效 workspace UUID 列表，明确拒绝无效 ID |
| 判定 | **PASS** |

---

### B8: workspace_id 跨工作区 — fork_session（R4 校验）

| 项 | 值 |
|---|---|
| 攻击向量 | `fork_session(new_workspace_id=ffffffff-ffff-ffff-ffff-ffffffffffff, source=d3ad6373)` |
| 期望拦截点 | `E_WORKSPACE_NOT_FOUND` (R4 L601) |
| 实际结果 | `E_WORKSPACE_NOT_FOUND` — 与 B7 一致的严格校验 |
| 判定 | **PASS** |

---

### B9: 9c423b8 绕过 — applyNudge tree 级规则守卫

| 项 | 值 |
|---|---|
| tree_id | `cr6b06` |
| 攻击向量 | 对 worker leaf 施加树级规则 nudge（R-01/R-04），以及无效 rule_id 的 nudge（"INVALID-RULE-99"） |
| 期望拦截点 | R1 applyNudge 全局守卫拦截 |
| 实际结果 | 全部 3 个 nudge 均被接受（nudge_count: 3）：R-04（所有 worker milestone audit_pass 为 true）、R-01（唯一 root）、INVALID-RULE-99。**无任何 guard 拦截**。 |
| 判定 | **FAIL** — rule_id 未校验有效性，树级规则可无限制施加于 worker leaf，applyNudge 全局守卫未触发 |

---

### B10: V2 旧攻击 — 伪造 UUID 白名单拦截

| 项 | 值 |
|---|---|
| tree_id | `cr6b06` |
| 攻击向量 | `tree_audit_gate(audit_session_id=ffffffff-ffff-ffff-ffff-ffffffffffff, verdict=pass)` |
| 期望拦截点 | V2 白名单拦截 (resolveAuditorIndep L1897) |
| 实际结果 | `E_INVALID_UUID_STRICT` — "must be version 4, non-zero, non-broadcast" |
| 判定 | **PASS** — V10 UUID strict 校验覆盖 V2 旧攻击向量 |

---

### B11: V4 旧攻击 — milestone 无条件 audit_pass=true

| 项 | 值 |
|---|---|
| tree_id | `cr6b01` |
| 攻击向量 | `tree_milestone_set_result(audit_pass=true)` 不提供 `audit_session_id` |
| 期望拦截点 | V4 拦截 (cmdMilestoneSetResult) |
| 实际结果 | `E_AUDITOR_NOT_INDEPENDENT` — "Self-approving a milestone audit is forbidden" |
| 判定 | **PASS** |

---

### B12: V9 旧攻击 — expect_outputs 绝对路径/symlink

| 项 | 值 |
|---|---|
| tree_id | `cr6b01`, `cr6b06` |
| 攻击向量 | (a) `tree_event_append(done, expect_outputs=["/etc/passwd", "C:\\Windows\\System32\\config\\SAM"])` (b) `tree_milestone_add(expect_outputs=["/etc/passwd", "/etc/shadow"])` |
| 期望拦截点 | V9 拦截 (cmdLeafSetStatus) |
| 实际结果 | 两个调用均返回 `ok: true`，绝对路径被无拦截接受并持久化到 tree-state.json。**路径遍历守卫未触发**。 |
| 判定 | **FAIL** — expect_outputs 未做路径白名单/沙箱校验，绝对系统路径可注入 |

---

## 二、汇总

### 通过率

| 判定 | 数量 | 用例 |
|---|---|---|
| PASS | 9 | B1, B2, B3, B4, B6, B7, B8, B10, B11 |
| PARTIAL PASS | 1 | B5 |
| FAIL | 2 | B9, B12 |
| **总计** | **12** | — |

**通过率: 9/12 (75%)**（含 PARTIAL 计为 9.5/12 = 79%）

### 关键安全用例（B 系列 + D 系列必须 100%）

目标 100%，实际未达成。两个 FAIL 需要关注。

---

## 三、失败用例根因分析

### B9: applyNudge 守卫缺失

**现象**: `tree_nudge_append` 对 rule_id 不做校验，接受任意字符串（含无效 ID "INVALID-RULE-99"）。树级规则（R-01：唯一 root，R-04：所有 worker milestone audit_pass 全部 true）可被施加到 worker leaf，不触发 role/scope 校验。

**根因推测**: applyNudge 入口缺少 rule_id 白名单校验和 role→rule 的适用性检查。commit 9c423b8 的加固可能未覆盖所有绕过路径。

**风险**: TAO Watcher 或其他自动化系统可通过随意 nudge 制造噪音或误导根会话做出错误的纠偏决策。

**建议**:
- 在 `tree_nudge_append` 入口增加 rule_id 白名单校验（参考 `tao-rules.json` rules 数组）
- 增加 role→rule 适用性检查：leaf.role 必须匹配 rule.role
- 对无效/不适用的 rule_id 返回 `E_INVALID_RULE_ID`

### B12: expect_outputs 路径遍历

**现象**: `tree_event_append` 和 `tree_milestone_add` 接受 expect_outputs 中的绝对系统路径（`/etc/passwd`, `C:\Windows\System32\config\SAM`, `/etc/shadow`），不做任何路径安全校验。

**根因推测**: expect_outputs 被视为声明式元数据，路径校验未在 API 入口点实施。实际的路径遍历防护可能在文件操作层（Read/Write 工具已有沙箱），但 expect_outputs 作为元数据存储时缺少前置校验。

**风险**: 如果后续有流程（如 TAO 审计、验证 Agent）基于 expect_outputs 路径读取文件，可能触发路径遍历。即使当前无直接风险，不校验也会降低整体安全水位。

**建议**:
- 在 `tree_milestone_add` 和 `tree_event_append` 中增加 expect_outputs 路径校验
- 拒绝绝对路径（必须以相对路径开头）
- 拒绝 `..` 路径遍历序列
- 拒绝符号链接路径（Windows junction / Unix symlink）

---

## 四、盲点与 R2 建议

### B5 盲点 — audit_log 真实性

validate 检测了 alignment / status 完整性，但未专门校验 audit_log 条目的 authenticity（auditor_session_id 是否对应树中真实 leaf）。建议 R2 中：
- 在 validate 新增 `audit_log_integrity` 检查项
- 交叉验证 audit_log[i].auditor_session_id 是否在树 leaves 中存在且 role 为合法 auditor

### 通用盲点 — 直接 JSON 篡改

B3-B6 均通过直接修改 tree-state.json 实现篡改。当前 validate 对部分篡改类型（audit_gate 自审/互审、alignment 缺失、status 不一致）有良好检测，但对 audit_log 伪造检测偏弱。建议：
- 增加 tree-state.json 的哈希/签名校验（完整性校验层）
- 或增加 `tree_validate` 的检查项覆盖度

### B9 盲点 — 完整的 nudge 校验链

当前 nudge 只有 severity 枚举校验，缺少 rule_id 有效性 + role 适用性校验。建议完整的三层校验：
1. rule_id 是否在白名单中
2. rule.role 是否匹配 leaf.role
3. nudge 累计计数是否超出限制（防止洪水攻击）

---

## 五、测试环境

| 项 | 值 |
|---|---|
| 实例 | Dev (D:\Proma-dev\) |
| 频道 | DeepSeek官方 (`56ecefd2`) |
| 模型 | deepseek-v4-pro |
| workspace | tree-2 (`b38b9e4e`) |
| Commander session | `d3ad6373-e8f1-4577-af04-0b1d73e4f05f` |
| 创建的测试 sessions | `3fbd5eb9`, `9ee78f09`, `f1bbec64` |
| 测试 trees | `cr6b01` - `cr6b06` |
| 洁净室 | 未读取 tree-engine.cjs / patches.cjs / proma-source/ |

---

*报告完成。待父会话收集后进入 R2 盲点验证。*
