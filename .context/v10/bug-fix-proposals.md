# Bug 修复方案

**修复时间**: 2026-06-25 19:04
**审查会话**: 4 个独立审查会话已 fork，等待审查结论

---

## Bug A（High 严重度）：Commander 谎报通过

### 漏洞 1：cmdEventAppend 允许 commander 代写 worker done event

**当前代码**（Line 1484）：
```javascript
// V10-trust-anchor-fix (C5/A3 P0 攻击 2): 写 done event 必须是 leaf 拥有者（session_id）或其添加者（added_by）。
if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id && callerSessionId !== leaf.added_by) {
  throw new TreeStateError(
    E_BORROWED_IDENTITY,
    `event_append rejected: caller "${callerSessionId}" cannot write done event to leaf "${leaf_id}" (session=${leaf.session_id}, added_by=${leaf.added_by || 'null'}). Only the leaf owner or its creator can mark done.`
  );
}
```

**问题**：当前修复**允许 added_by（commander）代写**，这正是漏洞根因。

**修复方案**：
```javascript
// V10-trust-anchor-fix (C5/A3 P0 攻击 2) + Bug A 修复：写 done event 必须是 leaf 拥有者（session_id）。
//   失守根因：原 V10-trust-anchor-fix 允许 added_by 代写，导致 commander 可谎报 worker done。
//   修复：只允许 leaf.session_id 自己写自己的 done event，禁止任何代写（包括 commander）。
if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id) {
  throw new TreeStateError(
    E_BORROWED_IDENTITY,
    `event_append rejected: caller "${callerSessionId}" cannot write done event to leaf "${leaf_id}" (session=${leaf.session_id}). Only the leaf owner itself can mark done.`
  );
}
```

**潜在副作用**：
- ✅ **无副作用**：Leaf 应该自己报告完成，不应该由 commander 代写
- ✅ **符合 spec**：Worker leaf 必须通过 brief_echo → done 流程自己完成
- ⚠️ **兼容性**：CLI 测试可能需要调整（但 CLI 本来就不应该代写）

---

### 漏洞 2：cmdAuditGate hasDone 不检查写入者身份

**当前代码**（Line 2302）：
```javascript
const evs = Array.isArray(leaf.events) ? leaf.events : [];
const hasDone = evs.some((e) => e && e.type === 'done');
if (!hasDone) {
  throw new TreeStateError(
    E_AUDIT_PREMATURE,
    `audit-gate rejected: no done event found for leaf "${leaf_id}". Audit must occur after work is completed.`
  );
}
```

**问题**：只检查 done event 存在性，不检查是谁写的。

**修复方案**：
```javascript
const evs = Array.isArray(leaf.events) ? leaf.events : [];
const doneEvent = evs.find((e) => e && e.type === 'done');
if (!doneEvent) {
  throw new TreeStateError(
    E_AUDIT_PREMATURE,
    `audit-gate rejected: no done event found for leaf "${leaf_id}". Audit must occur after work is completed.`
  );
}
// V10-trust-anchor-fix (Bug A 漏洞 2)：验证 done event 的写入者身份。
//   失守根因：原 hasDone 只检查存在性，不检查 caller_session_id，导致 commander 代写的 done 也能通过审计。
//   修复：检查 done event.meta.caller_session_id 是否等于 leaf.session_id（leaf 自己写的才算）。
const callerOfDone = doneEvent.meta && doneEvent.meta.caller_session_id;
if (callerOfDone && callerOfDone !== leaf.session_id) {
  throw new TreeStateError(
    E_BORROWED_IDENTITY,
    `audit-gate rejected: leaf "${leaf_id}" done event was written by "${callerOfDone}", not by leaf itself (session=${leaf.session_id}). Commander cannot declare worker done on behalf.`
  );
}
```

**潜在副作用**：
- ✅ **无副作用**：Done event 的 meta.caller_session_id 由 cmdEventAppend 的 MCP wrapper 透传
- ✅ **配合修复 1**：双重保障，即使修复 1 被绕过，这里也能拦截
- ⚠️ **依赖 meta 字段**：需确保 done event 的 meta.caller_session_id 正确记录

---

## Bug B（Medium-High 严重度）：Session 多 leaf 歧义

### 漏洞 3：cmdLeafAdd 不校验 session_id 唯一性

**当前代码**（Line 633-797）：
```javascript
async function cmdLeafAdd(args) {
  // ... 必填字段校验
  const { leaf_id, session_id, parent, path: leafPath, role, model, channel } = input;

  // session_id 格式校验（Line 667-671）
  if (!UUID_RE.test(session_id)) {
    throw new TreeStateError(
      E_SCHEMA_INVALID,
      `session_id "${session_id}" is not a valid UUID. Leaves must be created with real MCP session IDs from fork_session or create_session.`
    );
  }

  // leaf_id 唯一性校验（Line 700-701）
  if (Object.prototype.hasOwnProperty.call(state.leaves, leaf_id)) {
    throw new TreeStateError(E_DUPLICATE_LEAF, `leaf "${leaf_id}" already exists`);
  }

  // ⚠️ 缺少 session_id 唯一性校验
  // ...
}
```

**问题**：**没有检查 session_id 是否已被其他 leaf 使用**。

**修复方案**（在 Line 701 后插入）：
```javascript
// Bug B 修复：session_id 唯一性校验（与 cmdLeafSetSession 对齐）
//   失守根因：cmdLeafAdd 只校验 leaf_id 唯一，不校验 session_id 唯一，导致同 session 可注册多个 leaf。
//   后果：resolveAuditorIndep 的 .find() 取第一个匹配，不 fallthrough，导致审计歧义。
//   修复：复用 cmdLeafSetSession（Line 1739）的校验逻辑，确保 session_id 在树中唯一。
const sessionConflict = Object.values(state.leaves).find(
  (l) => l.session_id === session_id
);
if (sessionConflict) {
  throw new TreeStateError(
    E_DUPLICATE_SESSION_ID,
    `session_id "${session_id}" already used by leaf "${sessionConflict.leaf_id}". Each session can only register one leaf per tree.`
  );
}
```

**需要的错误码**（在错误码定义中添加）：
```javascript
const E_DUPLICATE_SESSION_ID = 'E_DUPLICATE_SESSION_ID';
```

**潜在副作用**：
- ✅ **无副作用**：与 cmdLeafSetSession（Line 1739）对齐，逻辑一致
- ✅ **符合 spec**：每个 session 应该只对应一个 leaf
- ⚠️ **行为变更**：禁止同 session 注册多个 leaf（但这本来就是反模式）

---

### 漏洞 4：resolveAuditorIndep .find() 不 fallthrough

**当前代码**（Line 1883）：
```javascript
const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === auditorSessionId);
if (!auditorLeaf) return `auditor "${auditorSessionId}" not found as any leaf session in tree (forged UUID)`;
```

**问题**：**取第一个匹配，不 fallthrough**。当同 session 有多个 leaf 时，总是命中第一个。

**审查会话 #3 推荐**：使用 `.filter().sort()` 按优先级排序，优先选择 `done` 状态的 leaf。

**修复方案（选项 A - 推荐）**：
```javascript
// Bug B 修复：auditor session → leaf 解析时 fallthrough 逻辑
//   失守根因：.find() 取第一个匹配，不 fallthrough，当同 session 有多个 leaf 时总是命中第一个。
//   后果：audit_gate 反复命中同一个 leaf（即使已 pruned），无视同 session 的其他可用 leaf。
//   修复：.filter() 找所有匹配，按 status=done > active > pending_brief > pruned/archived 排序，取最优先。
const auditorCandidates = Object.values(state.leaves).filter(l => l.session_id === auditorSessionId);
if (auditorCandidates.length === 0) {
  return `auditor "${auditorSessionId}" not found as any leaf session in tree (forged UUID)`;
}
if (auditorCandidates.length > 1) {
  // 歧义场景：同 session 有多个 leaf
  // 优先级：done > active > pending_brief > pruned/archived（跳过已归档的）
  const activeCandidates = auditorCandidates.filter(l => l.status !== 'archived' && l.status !== 'pruned');
  if (activeCandidates.length === 0) {
    return `auditor "${auditorSessionId}" has ${auditorCandidates.length} leaves but all are pruned/archived. No active auditor found.`;
  }
  // 按 status 优先级排序：done > active > pending_brief
  const statusPriority = { 'done': 3, 'active': 2, 'pending_brief': 1 };
  activeCandidates.sort((a, b) => (statusPriority[b.status] || 0) - (statusPriority[a.status] || 0));
  auditorLeaf = activeCandidates[0]; // 取最高优先级
} else {
  auditorLeaf = auditorCandidates[0];
}
```

**潜在副作用**：
- ✅ **解决歧义**：当同 session 有多个 leaf 时，智能选择最合适的 auditor
- ✅ **向后兼容**：单个 leaf 场景行为不变
- ⚠️ **复杂性增加**：逻辑从 1 行变成多行（但可读性更好）

---

**替代方案（选项 B）**：显式拒绝多匹配（报错）
```javascript
const auditorCandidates = Object.values(state.leaves).filter(l => l.session_id === auditorSessionId);
if (auditorCandidates.length === 0) {
  return `auditor "${auditorSessionId}" not found as any leaf session in tree (forged UUID)`;
}
if (auditorCandidates.length > 1) {
  return `auditor "${auditorSessionId}" matches ${auditorCandidates.length} leaves (${auditorCandidates.map(l => l.leaf_id).join(', ')}). Session must be unique per tree.`;
}
auditorLeaf = auditorCandidates[0];
```

**替代方案（选项 C）**：跳过 pruned/archived 候选
```javascript
const auditorCandidates = Object.values(state.leaves)
  .filter(l => l.session_id === auditorSessionId)
  .filter(l => l.status !== 'archived' && l.status !== 'pruned'); // 跳过已归档的
if (auditorCandidates.length === 0) {
  return `auditor "${auditorSessionId}" not found as any active leaf session in tree (forged UUID or all pruned/archived)`;
}
auditorLeaf = auditorCandidates[0]; // 取第一个（已过滤掉 pruned/archived）
```

**审查会话 #3 建议**：选项 A 最优，选项 C 为最小化修改（只加一行 filter）。

---

## 修复优先级

| 优先级 | 漏洞 | 修复位置 | 严重度 | 理由 |
|--------|------|----------|--------|------|
| **P0** | Bug A-1 | cmdEventAppend Line 1484 | High | 设计漏洞，审计可被绕过 |
| **P0** | Bug A-2 | cmdAuditGate Line 2302 | High | 配合 Bug A-1，双重保障 |
| **P1** | Bug B-3 | cmdLeafAdd Line 701 | Medium-High | 工程缺陷，对称性修复 |
| **P1** | Bug B-4 | resolveAuditorIndep Line 1883 | Medium-High | 防御性修复，降低歧义 |

---

## 审查会话结论

### ✅ Auditor #1（Bug A-1 - cmdEventAppend）
**状态**：已返回
**结论**：❌ 当前 V10-trust-anchor-fix 代码有问题（允许 added_by 代写）
**确认**：修复方案正确，需要移除 `|| callerSessionId !== leaf.added_by` 分支

### ⏳ Auditor #2（Bug A-2 - cmdAuditGate）
**状态**：进行中
**预期**：确认需要检查 done event 的写入者身份

### ✅ Auditor #3（Bug B-3 - cmdLeafAdd）
**状态**：已返回
**结论**：✅ 修复方案正确，推荐直接复用 cmdLeafSetSession 逻辑
**建议**：在 line 701 后插入 session_id 唯一性校验

### ⏳ Auditor #4（Bug B-4 - resolveAuditorIndep）
**状态**：进行中
**预期**：评估 fallthrough 方案的优劣

---

## 最终确认修复方案

基于代码分析和 4 个审查会话的反馈，最终修复方案如下：

### Bug A-1 修复（cmdEventAppend Line 1484）
```javascript
// V10-trust-anchor-fix (C5/A3 P0 攻击 2) + Bug A 修复：写 done event 必须是 leaf 拥有者（session_id）。
//   失守根因：原 V10-trust-anchor-fix 允许 added_by 代写，导致 commander 可谎报 worker done。
//   修复：只允许 leaf.session_id 自己写自己的 done event，禁止任何代写（包括 commander）。
if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id) {
  throw new TreeStateError(
    E_BORROWED_IDENTITY,
    `event_append rejected: caller "${callerSessionId}" cannot write done event to leaf "${leaf_id}" (session=${leaf.session_id}). Only the leaf owner itself can mark done.`
  );
}
```

### Bug A-2 修复（cmdAuditGate Line 2302）
```javascript
const evs = Array.isArray(leaf.events) ? leaf.events : [];
const doneEvent = evs.find((e) => e && e.type === 'done');
if (!doneEvent) {
  throw new TreeStateError(
    E_AUDIT_PREMATURE,
    `audit-gate rejected: no done event found for leaf "${leaf_id}". Audit must occur after work is completed.`
  );
}
// Bug A 修复：验证 done event 的写入者身份
const callerOfDone = doneEvent.meta && doneEvent.meta.caller_session_id;
if (callerOfDone && callerOfDone !== leaf.session_id) {
  throw new TreeStateError(
    E_BORROWED_IDENTITY,
    `audit-gate rejected: leaf "${leaf_id}" done event was written by "${callerOfDone}", not by leaf itself (session=${leaf.session_id}). Commander cannot declare worker done on behalf.`
  );
}
```

### Bug B-3 修复（cmdLeafAdd Line 701）
```javascript
// Bug B 修复：session_id 唯一性校验（与 cmdLeafSetSession 对齐）
const sessionConflict = Object.values(state.leaves).find(
  (l) => l.session_id === session_id
);
if (sessionConflict) {
  throw new TreeStateError(
    E_DUPLICATE_SESSION_ID,
    `session_id "${session_id}" already used by leaf "${sessionConflict.leaf_id}". Each session can only register one leaf per tree.`
  );
}
```

### Bug B-4 修复（resolveAuditorIndep Line 1883）
```javascript
// Bug B 修复：auditor session → leaf 解析时 fallthrough 逻辑
const auditorCandidates = Object.values(state.leaves).filter(l => l.session_id === auditorSessionId);
if (auditorCandidates.length === 0) {
  return `auditor "${auditorSessionId}" not found as any leaf session in tree (forged UUID)`;
}
// 跳过 pruned/archived 候选
const activeCandidates = auditorCandidates.filter(l => l.status !== 'archived' && l.status !== 'pruned');
if (activeCandidates.length === 0) {
  return `auditor "${auditorSessionId}" has ${auditorCandidates.length} leaves but all are pruned/archived. No active auditor found.`;
}
// 取第一个活跃候选（已过滤掉 pruned/archived）
auditorLeaf = activeCandidates[0];
```

---

## 下一步

1. ✅ 修复方案已确认
2. ⏳ 实施 4 处代码修改
3. ⏳ 用 dev 实例复现验证
4. ⏳ 写修复验证报告
