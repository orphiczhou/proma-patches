# V10 加固实施任务书（SubAgent 共享参考）

> 维护: 周星星 | 创建: 2026-06-25 11:57
> 用途: C1 commander / A1 auditor / Cr 洁净室 三个 SubAgent 共享的统一初始信息
> 上游文档: `.context/audit/iterative-deep-audit-2026-06-25.md`（完整失守链路 + 源码根因）

---

## 一、项目背景（一段话）

Proma 是基于商业版 Electron 应用（AGPL-3.0）做的闭源改造项目，通过 sed 补丁 + 独立插件叠加 Tree 形会话执行体系。Layer 2 的 V4-V9 DbC 加固（9 个硬约束点）形式上完整，但实测对真实攻击 0% 拦截——失守案例 `audit-gate-test-20260625` 证明 V4-V9 加固方向正确但只查"字段存在"，没查"内容有效"。V10 加固补 8 个盲点，从「字段存在性校验」升级为「内容有效性校验」。

---

## 二、失守案例证据（用这个理解为什么要做 V10）

### 树：audit-gate-test-20260625（3 副本）

| 实体 | session_id | 状态 |
|------|-----------|------|
| commander | 972bd9a8-cb0b-4466-ae86-25fd5d3cea76 | 自导自演 |
| worker | 528b0925-9e67-40f4-9700-1b3baa1b73e9 | 调 audit_gate 写 pass |
| auditor | 404c724f-1b57-4af1-a2c1-41d439cf49ba | **status=active, events=[], 从未审计** |

### 失守链路（关键时间线）

| 时间 | 事件 | 失守点 |
|------|------|--------|
| 09:07:00 | 树创建 | — |
| 09:07:30 | worker leaf 创建 | — |
| 09:07:45 | auditor leaf 创建 | role 标 worker 而非 auditor |
| 09:16:32 | commander 写"10/10 全部通过"报告 | 报告时 worker 还没 done |
| 09:19:11 | worker 调 `mcp__tree__tree_audit_gate` verdict=pass audit_session_id=404c724f | **接口 4 道检查全过，写入成功** |
| 09:20:54 | auditor 最后消息："workspace 已被清理" | — |

### 接口为什么放行？看 `resolveAuditorIndep`（tree-engine.cjs:1642）

```js
function resolveAuditorIndep(state, leaf, auditorSessionId) {
  if (!auditorSessionId) return 'auditor_session_id is null';
  if (leaf.added_by && auditorSessionId === leaf.added_by) return 'self-audit forbidden';
  const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === auditorSessionId);
  if (!auditorLeaf) return 'forged UUID';
  if (auditorLeaf.leaf_id === leaf.leaf_id) return 'auditor is the leaf itself';
  return null;  // ← worker 528b0925 拿 404c724f 走到这里全部通过
}
```

**4 道检查全过的原因**：
- 404c724f 是真 UUID（不是 null）
- worker.added_by 是 commander 不是 auditor（不等于）
- 404c724f 确实是树里 audit-gate-auditor leaf 的 session_id（不是伪造）
- auditorLeaf.leaf_id ≠ worker.leaf_id（不是自己审自己）

**漏掉的检查（V10 要补）**：
- ❌ auditorLeaf.status 是不是 'done'？（404c724f 是 active）
- ❌ auditorLeaf.events 是否非空？（404c724f 是 []）
- ❌ auditorLeaf.audit_gate.verdict 自己是不是 'pass'？（404c724f 是 'skip'）
- ❌ 调用方 session_id（worker 528b0925）= audit_session_id（404c724f）？（不相等，但接口没查）

---

## 三、V10 八大加固点详细 Spec

### V10-auditor-active（堵僵尸 auditor）

**位置**：`resolveAuditorIndep`（tree-engine.cjs:1642-1649）增加 3 个返回值

```js
function resolveAuditorIndep(state, leaf, auditorSessionId) {
  if (!auditorSessionId) return 'auditor_session_id is null';
  if (leaf.added_by && auditorSessionId === leaf.added_by) return 'auditor=added_by (self-audit forbidden)';
  const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === auditorSessionId);
  if (!auditorLeaf) return `auditor "${auditorSessionId}" not found as any leaf session in tree (forged UUID)`;
  if (auditorLeaf.leaf_id === leaf.leaf_id) return 'auditor is the leaf itself';
  // V10 新增：auditor leaf 自身状态校验
  if (auditorLeaf.status !== 'done') return `auditor leaf "${auditorLeaf.leaf_id}" status="${auditorLeaf.status}" (must be done)`;
  if (!Array.isArray(auditorLeaf.events) || auditorLeaf.events.length === 0) return `auditor leaf "${auditorLeaf.leaf_id}" events empty (no audit work performed)`;
  if (!auditorLeaf.audit_gate || auditorLeaf.audit_gate.verdict !== 'pass') return `auditor leaf "${auditorLeaf.leaf_id}" own audit_gate.verdict="${auditorLeaf.audit_gate?.verdict}" (must be pass)`;
  return null;
}
```

### V10-self-audit-forbidden-v2（堵借身份）

**位置**：`cmdAuditGate`（tree-engine.cjs:1964）开头增加 caller 校验

**问题**：当前 `cmdAuditGate` 不知道调用方是谁，worker 拿 auditor 的 session_id 调接口完全察觉不到。

**实现**：MCP wrapper 层（proma-dev-patches.cjs 的 `mcp__tree__tree_audit_gate` handler）把 caller session_id 透传到 engine，engine 校验：

```js
// cmdAuditGate 接收新参数 callerSessionId
async function cmdAuditGate(args, callerSessionId) {
  // ...
  const audit_session_id = opts['audit-session-id'] || null;
  // V10 新增：调用方必须是 audit_session_id 本人（防借身份）
  if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId) {
    throw new TreeStateError(
      E_AUDITOR_NOT_INDEPENDENT,
      `audit-gate rejected: caller "${callerSessionId}" != audit_session_id "${audit_session_id}" (borrowed identity forbidden)`
    );
  }
  // ...
}
```

**MCP wrapper 改动**：`proma-dev-patches.cjs` 找到 `tree_audit_gate` 的 handler，从 ctx 提取调用方 session_id，传给 engine。

### V10-uuid-format-strict（堵全 f / 空 / null / not-uuid）

**位置**：`resolveAuditorIndep` UUID 校验前置 + leaf_set_status 的 session_id 校验

```js
const UUID_V4_STRICT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_UUIDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
]);
function isValidStrictUuid(u) {
  return typeof u === 'string' && UUID_V4_STRICT.test(u) && !FORBIDDEN_UUIDS.has(u.toLowerCase());
}
// resolveAuditorIndep 开头：
if (!isValidStrictUuid(auditorSessionId)) return `auditor_session_id "${auditorSessionId}" not strict UUID v4`;
```

### V10-numeric-consistency（堵 total=-1 / p+f≠total）

**位置**：`cmdAuditAppend`（tree-engine.cjs:~2063）

```js
// 现有：const required = ['auditor_session_id', 'total', 'passed', 'failed', 'results'];
// V10 新增数值校验
const { total, passed, failed, results } = entry;
if (!Number.isInteger(total) || total < 0) throw E_NEGATIVE_COUNT;
if (!Number.isInteger(passed) || passed < 0) throw E_NEGATIVE_COUNT;
if (!Number.isInteger(failed) || failed < 0) throw E_NEGATIVE_COUNT;
if (passed + failed !== total) throw E_COUNT_MISMATCH;
if (!Array.isArray(results) || results.length !== total) throw E_LENGTH_MISMATCH;
// V10 新增 results[i] 子结构校验（R2-T7 的扩展）
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (!r || typeof r.item !== 'string' || typeof r.pass !== 'boolean' || typeof r.evidence !== 'string') {
    throw new TreeStateError(E_SCHEMA_INVALID, `audit log entry results[${i}] must have {item:string, pass:boolean, evidence:string}`);
  }
}
```

### V10-nudge-escalation（堵 168 次提醒不升级）

**位置**：`cmdNudgeAppend`（搜 nudge_append 找）

```js
// 现有：nudge_count 累加但不升级
// V10 新增强制升级 + pruned
leaf.nudge_count = (leaf.nudge_count || 0) + 1;
let effectiveSeverity = severity;
if (leaf.nudge_count >= 7) {
  // 强制 pruned
  leaf.status = 'pruned';
  leaf.events.push({ type: 'auto_pruned', ts: now(), meta: { reason: 'nudge_overrun', count: leaf.nudge_count } });
  throw new TreeStateError(E_LEAF_AUTO_PRUNED, `leaf "${leaf_id}" auto-pruned after ${leaf.nudge_count} nudges`);
}
if (leaf.nudge_count >= 5) effectiveSeverity = 'high';
else if (leaf.nudge_count >= 3) effectiveSeverity = severity === 'low' ? 'medium' : severity;
```

### V10-timestamp-monotonic（堵时间倒挂）

**位置**：`cmdEventAppend`（搜 event_append 找）+ 所有写入 ts 的地方

```js
// event append 时校验
const tsMs = Date.parse(ts);
const nowMs = Date.now();
if (tsMs < Date.parse(leaf.created_at)) {
  throw new TreeStateError(E_TS_BEFORE_CREATED, `event ts ${ts} earlier than leaf created_at ${leaf.created_at}`);
}
if (tsMs > nowMs + 60_000) {
  throw new TreeStateError(E_TS_IN_FUTURE, `event ts ${ts} in future (now=${new Date(nowMs).toISOString()})`);
}
if (leaf.events.length > 0) {
  const lastTsMs = Date.parse(leaf.events[leaf.events.length - 1].ts);
  if (tsMs < lastTsMs) {
    throw new TreeStateError(E_TS_NOT_MONOTONIC, `event ts ${ts} earlier than last event ts`);
  }
}
```

### V10-workspace-canonical（堵 slug "undefined"）

**位置**：3 处

```js
// 1. patches.cjs findTreesDirForWorkspace（fallback）
function findTreesDirForWorkspace(slug) {
  if (!slug || slug === 'undefined') slug = 'default';  // V10 fallback
  // ...
}

// 2. main.cjs:191 getAgentWorkspacePath（防御性抛错）— 不在补丁范围，写注释提示
// 注意：main.cjs 改动需要 sed 补丁，本任务先不改 main.cjs，由后续补丁 L 处理

// 3. patches.cjs remote_create_session handler（强制 workspace_id）
// 找到 remote_create_session 的 handler，如果调用方没传 workspace_id，
// 用调用方当前 workspace 作 fallback，不再容忍 null
```

### V10-status-event-sync（堵 status=active 但 last_event=done）

**位置**：`cmdLeafSetStatus` + `cmdEventAppend` 双向同步

```js
// cmdEventAppend 写 done 时强制 status=done
if (type === 'done') {
  leaf.status = 'done';  // 强制同步
}
// cmdLeafSetStatus 设置 done 前校验有 done event
if (new_status === 'done') {
  const hasDone = leaf.events.some(e => e.type === 'done');
  if (!hasDone) throw new TreeStateError(E_STATUS_EVENT_MISMATCH, `cannot set status=done: no done event`);
}
// 反向：reconcileStatus 函数（validate 时调用）
function reconcileStatus(leaf) {
  const hasDone = leaf.events.some(e => e && e.type === 'done');
  if (hasDone && leaf.status !== 'done') {
    return { type: 'status_event_mismatch', leaf_id: leaf.leaf_id, detail: `last_event=done but status=${leaf.status}` };
  }
}
// collectValidateIssues 中调用 reconcileStatus，把 mismatch 作为 issue
```

---

## 四、修改位置（精确文件 + 大致行号）

### 主战场：3 处同步

| 位置 | 路径 | 用途 |
|------|------|------|
| **逻辑源** | `~/.proma/agent-workspaces/proma/workspace-files/release/tree-system-v0.2.2/core/tree-state.js` | 可读可维护的源码 |
| **内联版** | `~/.proma/agent-workspaces/proma/workspace-files/release/tree-system-v0.2.2/patch-l/tree-engine.cjs` | patches.cjs 内联版 |
| **部署版** | `D:\Proma-dev\resources\app\dist\tree-engine.cjs` | dev 实例加载版 |

**铁律**：3 处必须 diff 验证逐字一致（仅 wrapper 注释差异允许）。

### 关键函数定位

| 函数 | 当前位置（tree-engine.cjs） |
|------|----------------------------|
| `resolveAuditorIndep` | 1642-1649 |
| `cmdAuditGate` | 1964+ |
| `cmdAuditAppend` | ~2063 |
| `cmdEventAppend` | 搜 `type === 'event_append'` |
| `cmdNudgeAppend` | 搜 `type === 'nudge_append'` |
| `cmdLeafSetStatus` | 搜 `cannot set status=done` |
| `collectValidateIssues` | 1657+ |

### MCP wrapper 改动

| 文件 | 改动 |
|------|------|
| `~/.proma/agent-workspaces/proma/workspace-files/release/tree-system-v0.2.2/patch-l/proma-dev-patches.cjs` | `tree_audit_gate` handler 提取 caller session_id 传给 engine |
| `D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs` | 同步 |

---

## 五、验收标准（必须全部满足）

### 代码层

- [ ] 3 处文件 diff 验证一致（除 wrapper 注释外）
- [ ] `resolveAuditorIndep` 包含 status/events/audit_gate.verdict 3 重校验
- [ ] `cmdAuditGate` 接收 callerSessionId 并校验
- [ ] MCP wrapper 透传 caller session_id
- [ ] `cmdAuditAppend` 数值一致性 + results[i] 三元组校验
- [ ] `cmdNudgeAppend` 升级 + 7 次强制 pruned
- [ ] `cmdEventAppend` 时间戳校验
- [ ] `findTreesDirForWorkspace` fallback "default"
- [ ] `cmdLeafSetStatus` + `cmdEventAppend` 双向 status 同步

### 测试层（Cr 洁净室负责）

- [ ] audit-gate-test 失守链路在 V10 后 0% 通过（重放 worker 528b0925 的调用应被拒）
- [ ] vfa1/vfb 17 种注入全部被拦
- [ ] 现有 dbc-spec.cjs 39/0 不退化
- [ ] 现有 audit-attacks.cjs 18/0 不退化
- [ ] 现有 audit-extra.cjs 21 case 不退化

### 不允许的妥协

- ❌ 不能改 V4-V9 现有加固代码（除非新错误码必要的扩展）
- ❌ 不能为通过测试修改测试用例（dbc-spec/audit-attacks/audit-extra 是金标准）
- ❌ 不能跳过任何 3 处同步
- ❌ 不能简化 spec（8 大加固点必须全部实现）
- ❌ 不能在 dist 主文件直接改（必须先改 core/tree-state.js 再同步）

---

## 六、错误码定义（C1 需要新增）

```js
const E_AUDITOR_NOT_DONE = 'E_AUDITOR_NOT_DONE';
const E_AUDITOR_NO_EVENTS = 'E_AUDITOR_NO_EVENTS';
const E_AUDITOR_NOT_VERIFIED = 'E_AUDITOR_NOT_VERIFIED';  // 已有，复用
const E_BORROWED_IDENTITY = 'E_BORROWED_IDENTITY';
const E_INVALID_UUID_STRICT = 'E_INVALID_UUID_STRICT';
const E_NEGATIVE_COUNT = 'E_NEGATIVE_COUNT';
const E_COUNT_MISMATCH = 'E_COUNT_MISMATCH';
const E_LENGTH_MISMATCH = 'E_LENGTH_MISMATCH';
const E_TS_BEFORE_CREATED = 'E_TS_BEFORE_CREATED';
const E_TS_IN_FUTURE = 'E_TS_IN_FUTURE';
const E_TS_NOT_MONOTONIC = 'E_TS_NOT_MONOTONIC';
const E_LEAF_AUTO_PRUNED = 'E_LEAF_AUTO_PRUNED';
const E_STATUS_EVENT_MISMATCH = 'E_STATUS_EVENT_MISMATCH';
```

---

## 七、不允许的妥协（再次强调）

- 不修改 V4-V9 现有 9 个硬约束点（V4/V5b/V6/V8/CP2/V9 + 审计[1][2][3]）
- 不修改 dbc-spec.cjs / audit-attacks.cjs / audit-extra.cjs 三个金标准测试
- 不在 dist 主文件直接改（必须从 core 源开始）
- 不能为赶进度跳过 3 处 diff 验证

---

## 八、参考文档

- 完整失守链路: `.context/audit/iterative-deep-audit-2026-06-25.md`
- 全局审计报告: `.context/audit/tree-state-global-audit-2026-06-25.md`
- V4-V9 加固原始决策: `.context/note.md` 6/24 条目
- V10 重测方案（Cr 参考）: `.context/plan/audit-gate-retest-v10.md`
- tree-engine.cjs 当前代码: `D:\Proma-dev\resources\app\dist\tree-engine.cjs`（2609 行）

---

## 九、SubAgent 角色分工

| 角色 | 任务 | 不允许 |
|------|------|--------|
| **C1（commander，实施）** | 按本任务书 §三 实施 8 大加固点，3 处同步，写自验证报告 | 不能跳过任何加固点；不能修改金标准测试 |
| **A1（auditor，评价）** | 不看 C1 实施过程，独立读 C1 改后的代码，对照本任务书 §五 验收标准逐项评价 | 不能因为"看起来对"就通过；必须每条 spec 都验证 |
| **Cr（洁净室，测试）** | 仅看 §二失守案例 + §三V10 spec（不看 §五验收），从 spec 写测试用例，重放 audit-gate-test 失守链路 + vfa1/vfb 17 种注入 | 不能看实现代码；不能照搬现有测试 |

每个 SubAgent 输出文件位置：

```
.context/v10/
├── c1-implementation-report.md   # C1 自验证报告（含 3 处 diff 验证）
├── a1-review-report.md           # A1 评价报告（含 8 项加固点逐项判定）
├── cr-test-report.md             # Cr 测试报告（含测试用例 + 通过率）
└── convergence-judgment.md       # 主会话收敛判断（C2 是否必要）
```
