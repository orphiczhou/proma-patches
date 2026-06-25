# Cr 洁净室 V10 加固测试报告

> 测试时间：2026-06-25 12:38
> 测试者：Cr（v10v-Cr-cleanroom leaf，独立上下文）
> 测试对象：tree-engine.cjs（V10 加固版本，3 处同步验证后）
> 测试原则：洁净室铁律 — 完全基于 spec，不看任何实现代码

---

## 测试设计原则

1. **完全基于 spec**：8 大加固点测试用例全部从任务书 §三推导，禁看 `core/tree-state.js`、`patch-l/tree-engine.cjs`、`dist/tree-engine.cjs`、C1/A1 报告、现有金标准测试具体用例。
2. **重放真实失守数据**：audit-gate-test-20260625 真实失守链路 + vfa1/vfb 17 种对抗 fixture。
3. **攻击优先**：先测攻击应该被拒，再测合法应该通过；至少 2 个用例/加固点。
4. **错误码并集**：V10 各加固点交叉触发（如 audit_gate 先触发 E_BORROWED_IDENTITY 再触发 auditor-active），候选错误码取并集。

## 测试用例统计

- **总测试用例**：49 个
- 来自 8 大加固点 spec：32 个
- 来自 audit-gate-test 失守重放：1 个（核心）
- 来自 vfa1/vfb 对抗重放：16 个

## 测试结果总览

| 加固点 | 用例数 | 通过 | 失败 | 失败详情 |
|--------|-------|------|------|---------|
| V10-auditor-active | 3 | 3 | 0 | — |
| V10-self-audit-forbidden-v2 | 2 | 2 | 0 | — |
| V10-uuid-format-strict（audit_gate 路径） | 7 | 7 | 0 | — |
| V10-numeric-consistency | 8 | 8 | 0 | — |
| V10-nudge-escalation | 4 | 4 | 0 | — |
| **V10-timestamp-monotonic** | **3** | **0** | **3** | **🚨 全部失守：1970 年、2999 年、非单调 ts 全放行** |
| V10-workspace-canonical | 3 | 3 | 0 | — |
| V10-status-event-sync | 3 | 3 | 0 | — |
| **audit-gate-test 失守重放** | **1** | **1** | **0** | **✓ 核心防住** |
| vfb/vfa1 17 种攻击重放（audit_append 路径） | 15 | 8 | **7** | **🚨 audit_append 不校验 auditor_session_id：7 种 UUID 攻击全放行** |
| **合计** | **49** | **39** | **10** | **20% 失守率** |

---

## 核心 1：audit-gate-test 失守链路重放

**场景**：完全重放 audit-gate-test-20260625 真实失守链路。
- worker leaf（session 528b0925-9e67-40f4-9700-1b3baa1b73e9），status=done
- auditor leaf（session 404c724f-1b57-4af1-a2c1-41d439cf49ba），status=active，events=[]，audit_gate.verdict=skip（zombie）
- 用 worker session 调 `audit gate <tid> <wid> --verdict pass --audit-session-id 404c724f`

**预期**：V10 应该拒绝（V10-auditor-active 至少触发一个，或 V10-self-audit-forbidden-v2 触发）。

**实际结果**：✓ **V10 拒绝**

```
E_BORROWED_IDENTITY: audit-gate rejected: caller "528b0925-9e67-40f4-9700-1b3baa1b73e9" 
                     != audit_session_id "404c724f-1b57-4af1-a2c1-41d439cf49ba"
```

**判定**：**V10-self-audit-forbidden-v2 优先于 V10-auditor-active 触发**。caller session_id 校验先拦住了借身份。这意味着即使 zombie auditor 的状态校验失效，借身份校验也能堵住 audit-gate-test 失守。

**结论**：**核心失守链路 0% 通过，V10 有效**。

---

## 核心 2：vfb/vfa1 17 种攻击重放

按攻击路径分两组：

### audit_gate 路径（V10-self-audit-forbidden-v2 + V10-uuid-format-strict 保护）

通过 `audit gate` 命令注入的攻击，V10 全部拦截：
- 全 f UUID / 全 0 UUID / 空串 / "not-uuid" / 不传 audit-session-id：**全部拒绝**（E_INVALID_UUID_STRICT 或 E_AUDITOR_NOT_INDEPENDENT）
- 伪造合法 UUID（树中不存在）：拒绝（E_BORROWED_IDENTITY — caller != audit_session_id）

### audit_append 路径（V10-numeric-consistency 保护，但 UUID 校验缺失）

通过 `audit append` 命令注入审计日志条目，V10 表现：

| 攻击 | V10 是否拦截 | 错误码 |
|------|-------------|--------|
| 10.05 results.length=1 != total=5 | ✓ | E_LENGTH_MISMATCH |
| 10.06 total=-1 | ✓ | E_NEGATIVE_COUNT |
| 10.07 p+f=6 != total=5 | ✓ | E_COUNT_MISMATCH |
| 10.15 passed=0+failed=0 != total=1 | ✓ | E_COUNT_MISMATCH |
| 10.08 auditor_session_id="" 空串 | ✗ **放行** | — |
| 10.09 auditor_session_id="not-uuid" | ✗ **放行** | — |
| 10.10 伪造合法 UUID（不在树） | ✗ **放行** | — |
| 10.11 auditor_session_id=self session | ✗ **放行** | — |
| 10.12 auditor_session_id=null | ✗ **放行** | — |
| 10.13 全 f UUID | ✗ **放行** | — |
| 10.17 全 f UUID（来自 vfa1） | ✗ **放行** | — |

**汇总**：4 拦截 / 11 放行 / 15 总（其中 4 个是边界场景期望放行）

**真实失守**：7 种 UUID 相关攻击全放行。V10-numeric-consistency 在 audit_append 完整工作，但 **V10-uuid-format-strict 只在 audit_gate 路径生效，audit_append 路径完全没校验 auditor_session_id**。

---

## 关键发现（按重要性排序）

### 🚨 发现 1：V10-timestamp-monotonic 完全失守（3/3 放行）

任务书 §V10-timestamp-monotonic 要求 `cmdEventAppend` 校验 ts：
- ts 早于 leaf.created_at 应抛 E_TS_BEFORE_CREATED
- ts 在未来（>now+60s）应抛 E_TS_IN_FUTURE
- ts 早于上一条 event 应抛 E_TS_NOT_MONOTONIC

**实测**：
- `--ts 1970-01-01T00:00:00.000Z`（早于任何 leaf.created_at）→ **放行**
- `--ts 2999-12-31T23:59:59.000Z`（远在未来）→ **放行**
- 先写 ts=2026-06-25T10:00，再写 ts=2026-06-25T09:00 → **放行**

**根因推测**（不看实现代码）：要么 `cmdEventAppend` 没接 V10 校验逻辑，要么校验逻辑被某个早返回跳过了。这是 V10 加固的最大漏洞 — 时间戳 DoS 攻击完全没防御。

### 🚨 发现 2：V10-uuid-format-strict 在 audit_append 路径缺失（7/7 放行）

任务书 §V10-uuid-format-strict 要求 UUID v4 严格校验。实测：
- `audit gate` 路径：所有 UUID 攻击都被拒绝（E_INVALID_UUID_STRICT）
- `audit append` 路径：所有 UUID 攻击都被放行（写入 audit_log 成功）

**影响**：恶意 worker 可以伪造任意 auditor_session_id（包括全 f UUID、伪造合法 UUID、self session）写入审计日志，污染审计追踪。虽然 audit_gate 是真正的"放行门"，但 audit_log 是"证据链"，被污染后会让后续审计无法信任。

### ✓ 发现 3：V10-self-audit-forbidden-v2 + callerSessionId 透传成功

`engine.run(cmd, args, treesRoot, callerSessionId)` 第四参数成功接收 caller session_id。
`cmdAuditGate` 校验 `audit_session_id === callerSessionId`，不等则抛 E_BORROWED_IDENTITY。
**这一条优先于 V10-auditor-active 触发**，所以即使 zombie auditor 校验有漏洞，借身份校验也能堵住 audit-gate-test 失守。

### ✓ 发现 4：V10-nudge-escalation 工作良好（含 vfb 重放）

- 3 次 low → severity 升级到 `mid`（V10 用简写而非 spec 的 `medium`）
- 5 次 low → severity 升级到 `high`
- 7 次 low → 强制 pruned + 抛 E_LEAF_AUTO_PRUNED
- vfb 失守重放（nudge_count=42 再加 1）→ 立即 pruned（E_LEAF_AUTO_PRUNED）

V10 完全堵住了"168 次提醒不升级"的失守。

### ✓ 发现 5：V10-status-event-sync 双向同步工作

- 写 done event 时强制 status=done（V10-event-side）
- 无 done event 时 set-status done 被拒（E_SCHEMA_INVALID）
- validate 检测到 status=active 但 events 有 done event → 报 status_event_mismatch issue

---

## 测试代码

`C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\release\tree-system-v0.2.2\test-sandbox\v10-cleanroom.cjs`

49 个测试用例，覆盖 8 大加固点 spec + audit-gate-test 失守重放 + vfb/vfa1 17 种攻击重放。

## 给 C2 的建议（V10 失守修复）

### 修复 1：cmdEventAppend 增加 ts 校验（V10-timestamp-monotonic 真实失守）

```js
// 在 cmdEventAppend 写入 events[] 前：
const tsMs = Date.parse(ts);
const nowMs = Date.now();
if (tsMs < Date.parse(leaf.created_at)) {
  throw new TreeStateError(E_TS_BEFORE_CREATED, 
    `event ts ${ts} earlier than leaf created_at ${leaf.created_at}`);
}
if (tsMs > nowMs + 60_000) {
  throw new TreeStateError(E_TS_IN_FUTURE, 
    `event ts ${ts} in future (now=${new Date(nowMs).toISOString()})`);
}
if (leaf.events.length > 0) {
  const lastTsMs = Date.parse(leaf.events[leaf.events.length - 1].ts);
  if (tsMs < lastTsMs) {
    throw new TreeStateError(E_TS_NOT_MONOTONIC, 
      `event ts ${ts} earlier than last event ts`);
  }
}
```

### 修复 2：cmdAuditAppend 增加 auditor_session_id UUID 严格校验（V10-uuid-format-strict 在 audit_append 缺失）

```js
// V10-uuid-format-strict 当前只在 resolveAuditorIndep（audit_gate 路径）生效。
// cmdAuditAppend 也需要前置 UUID 校验：
const UUID_V4_STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_UUIDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
]);
function isValidStrictUuid(u) {
  return typeof u === 'string' && UUID_V4_STRICT.test(u) && !FORBIDDEN_UUIDS.has(u.toLowerCase());
}
// cmdAuditAppend 中：
if (!isValidStrictUuid(entry.auditor_session_id)) {
  throw new TreeStateError(E_INVALID_UUID_STRICT, 
    `audit_append rejected: auditor_session_id "${entry.auditor_session_id}" not strict UUID v4`);
}
// 进一步：检查 auditor_session_id 是否是树中真实 leaf 的 session（防伪造）
const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === entry.auditor_session_id);
if (!auditorLeaf) {
  throw new TreeStateError(E_AUDITOR_NOT_INDEPENDENT, 
    `audit_append rejected: auditor_session_id not found as any leaf in tree (forged)`);
}
```

### 修复 3（次要）：V10-nudge-escalation 的 severity 命名一致性

实测 V10 把 medium 简写为 `mid`，spec 写的是 `medium`。建议统一为 spec 的 `medium`（兼容性更好）。

---

## 最终结论

**V10 加固在 49 个测试用例中 39 个通过（80% 有效），10 个失守（20%）**。

**关键判定**：

1. ✅ **audit-gate-test-20260625 失守链路 0% 通过** — V10-self-audit-forbidden-v2 的 caller session_id 校验优先触发，把 worker 528b0925 借身份调 audit_gate 的攻击完全堵住。**核心目标达成**。

2. ✅ **8 大加固点中 6 个完全工作**：auditor-active / self-audit-v2 / uuid-strict（audit_gate 路径）/ numeric-consistency / nudge-escalation / status-event-sync

3. 🚨 **2 个真实失守**：
   - **V10-timestamp-monotonic 完全没生效**（3/3 放行）— 时间戳 DoS 攻击无防御
   - **V10-uuid-format-strict 在 audit_append 路径缺失**（7/7 放行）— audit_log 可被任意 UUID 污染

4. ⚠️ **C2 commander 必须修复上述 2 个失守点**，V10 才能称为"完整加固"。建议优先级：
   - **P0**：V10-timestamp-monotonic（防时间倒挂 DoS）
   - **P1**：audit_append 路径 UUID 校验（防审计日志污染）

**测试代码可重现**：
```bash
cd C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\release\tree-system-v0.2.2\test-sandbox
node v10-cleanroom.cjs
```

预期输出：`通过: 39 / 失败: 10`，失败集中在组 6（V10-timestamp-monotonic）和组 10（audit_append UUID 漏校验）。
