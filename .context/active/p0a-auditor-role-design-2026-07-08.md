# P0a auditor role 实施设计 spec（2026-07-08）

> 实施依据：handoff-harness-improvement-2026-07-08.md + 调研报告 §6.2.1/§6.4.5 + macp4-postmortem
> 一手证据：macp4-A4（commander 假装 auditor → C-13/R-03/R-06 假阳性 24-38 条）、macp4-W3 §3.5（"需要独立 auditor role，而非复用 worker 靠 W-AUDIT-WORKER 打补丁"）

## 核心洞察（决定改动规模）

**`resolveAuditorIndep` 不需要改**。现有 root trust anchor（行 2432-2446：root 可担任任意非 root leaf 的 auditor）天然覆盖"root 给 auditor leaf 背书 audit_gate=pass"；通用路径（行 2467-2490）天然覆盖"上级 auditor（已 done + 自己 pass）给下级 auditor 背书"。auditor 自审被行 2478 `auditor is the leaf itself` 拦。

→ engine 改动从报告估的 500-700 行降到 ~80-120 行。SKILL §13 是大头。

## engine 改动清单（精确行号 = 实际文件）

### 1. ROLE_ENUM（行 84）
`['root','commander','worker']` → 加 `'auditor'`

### 2. cmdLeafAdd audit_gate 初始 verdict（行 1041）
`verdict: role === 'worker' ? 'required' : 'skip'` → `(role === 'worker' || role === 'auditor') ? 'required' : 'skip'`
**理由**：auditor 不能自审（行 2478 拦），需 root 背书 → verdict='required'。commander/root 仍 'skip'（root 是信任锚自审放行，commander 不走 audit_gate）。

### 3. cmdLeafSetStatus done 门禁 auditor 简化协议（行 1414-1589）
auditor leaf 不产出交付物（其"产物"是 audit_gate verdict + audit_log），故跳过 milestone/expect_outputs/deliverables。保留通用安全门。
- 行 1414 `if (new_status === 'done')` 后加 `const isAuditor = leaf.role === 'auditor';` + `if (!isAuditor) {` 包裹 milestones(1416-1429)+expect_outputs(1431-1445)+deliverables(1447-1494)，在 1494 后闭合 `}`
- 行 1498 `if (leaf.role === 'worker')` → `if (leaf.role === 'worker' || isAuditor)`（auditor 也要求 brief_echo+done 双事件）
- ISS-003 review_round（1521，`worker && isReviewRequired`）：auditor 自动跳过 ✅ 不改
- audit_gate 检查（1551）：auditor verdict=required 需 pass ✅ 不改
- done event 存在（1564）：auditor 也要 ✅ 不改
- commander children（1576，`commander` only）：auditor 自动跳过 ✅ 不改

### 4. collectValidateIssues HARDEN6 context overflow（行 2712）
`if ((leaf.role === 'commander' || leaf.role === 'root') && ...)` → 加 `|| leaf.role === 'auditor'`
auditor leaf 也可能 context 卡死。

### 5. cmdInit state.version（行 728）
`version: '1.0'` → `'1.1'`

### 6. cmdMigrate（行 3373+）
- 规则 5（行 3444）：`verdict = leaf.role === 'worker' ? 'required' : 'skip'` → `(leaf.role === 'worker' || leaf.role === 'auditor') ? 'required' : 'skip'`
- 新增规则 12：state.version 1.0→1.1 升级（旧树补版本号）
- **不自动把 commander→auditor**（会误伤真 commander；历史 macp4-A4 假装 auditor 的 commander leaf 已 done，不影响新机制）

### 7. NUDGE_RULE_WHITELIST（行 93-117）—— P0a 暂不改
tao-watcher-script 绕过 engine 直接写 audit_log（A4 实证 29 条全 tao-watcher-script），engine 白名单只管手动 nudge_append。手动给 auditor 发 R-03 会被拒（auditor 不在 allowedRoles）—— 这是合理的。P0b 统一收窄 tao-rules.json 时同步处理。

## resolveAuditorIndep 不改的验证（关键安全论证）

auditor leaf audit_gate=pass 由 root 背书：
1. cmdAuditGate 行 2926 `caller === audit_session_id`：root 亲调，caller=root.sid=audit_session_id ✅
2. resolveAuditorIndep 行 2432 `if (leaf.role !== 'root' && auditorSessionId)`：auditor leaf ≠ root，进入
3. 行 2433-2435 找 rootLeaf（parent===null && role==='root' && session_id===auditorSessionId）：找到 root
4. 行 2436 `rootLeaf.leaf_id !== leaf.leaf_id`：auditor leaf ≠ root leaf，进入
5. 行 2438 root status 非 archived/pruned + 行 2441 root events 非空 → 行 2444 return null（放行）
6. **不达行 2462 `auditor=added_by` 检查**（auditor.added_by 可能=root.sid，但快路径已提前 return）✅

auditor→auditor 背书（正常期）：走通用路径 2467-2490，要求上级 auditor status=done + events 非空 + 自己 audit_gate=pass。✅

auditor 自审：行 2478 `auditorLeaf.leaf_id === leaf.leaf_id` → 拦。✅

## SKILL 改动大纲

### commander SKILL §13（冷启动信任锚流程）—— 加 §13.x auditor 协议
- §13.2 冷启动期 auditor = root.session_id：扩展为"root 可担任 auditor leaf 的 audit_gate 背书者"
- 新增 §13.x：auditor role 创建协议（commander 用 leaf_add role=auditor 创建独立审计 leaf，parent=commander，added_by=commander.sid）
- 新增 §13.x：auditor leaf 简化协议（brief_echo + done + audit_gate 三步，无 milestone/review_round）
- 新增 §13.x：auditor 自审死锁解决（auditor leaf 自己 audit_gate=pass 由 root 背书；正常期由上级 auditor 背书）
- §13.4 转正常期：root 信任锚保留作冷启动兜底；正常期 auditor leaf 链式背书

### worker SKILL §10（审计角色）—— 调整
- §10.2 审计角色核心区别：明示 role=auditor（不再复用 worker）
- §10.3 最小 Fork 结构：auditor leaf 创建路径

## 测试用例清单（auditor-role-test.cjs，复用 subagent-lifecycle-test.cjs harness）

1. auditor leaf 创建：role=auditor 通过 ROLE_ENUM，audit_gate.verdict='required'
2. auditor done 简化协议：无 milestone 也能 done（跳过 milestones/deliverables 门禁）
3. auditor done 仍需 brief_echo+done 双事件（缺 done event → E_STATUS_EVENT_MISMATCH）
4. auditor audit_gate=pass 由 root 背书（root.sid 当 audit_session_id → 放行）
5. auditor 自审被拒（auditor.sid 当自己的 audit_session_id → E_AUDITOR_NOT_INDEPENDENT）
6. auditor→auditor 背书（上级 auditor done+pass → 下级 auditor pass 放行）
7. auditor 当 worker 的 auditor（auditor done+pass → worker audit_gate pass 放行）
8. migrate：state.version 1.0→1.1 + auditor leaf audit_gate verdict='required'
9. 现有 30/19/13 全绿（兼容性）

## 风险点（审计重点）

1. **行 2462 added_by 陷阱**：若 auditor leaf 的 added_by=root.sid 且 root 当其 auditor，会否触发 'auditor=added_by'？→ 不会（root 走 2432 快路径提前 return）。测试用例 4 验证。
2. **collectValidateIssues HARDEN2（行 2683）**：auditor verdict=pass 时 auditor=root，resolveAuditorIndep 放行，不报 audit_gate_not_independent。测试用例 4 验证。
3. **NUDGE_RULE_WHITELIST role 校验（行 3213）**：手动给 auditor 发 worker/commander 规则会被拒（E_STATUS_INVALID）。这是期望行为，但需确认 tao-watcher-script 不走此路径（它直接写 audit_log）。
4. **migrate 不自动识别历史假 auditor**：macp4-A4（commander 假装）保持 commander role。可接受（已 done，不影响新树）。

## 不破坏的安全不变量（macp2 三层防护 + caller-binding）

- caller-binding 8 处 throw 点（行 923/929/1730/1914/2006/2928/2972/3049）：不改
- 预算护栏（node_budget / max_subagent_spawn）：不改
- startup_notice + SKILL 调用形式红线：不改
- review_round append 即时校验：不改
- V10 八加固点：不改（HARDEN6 仅加 auditor 到 context overflow 检查）
