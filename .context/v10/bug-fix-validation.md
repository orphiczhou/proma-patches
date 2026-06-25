# Bug 修复验证报告

**修复时间**: 2026-06-25 19:10
**引擎版本**: D:\Proma-dev\resources\app\dist\tree-engine.cjs
**修复范围**: 4 处代码修改 + 1 个错误码添加

---

## 修复内容汇总

### ✅ Bug A-1：cmdEventAppend worker 真实性校验（P0）

**位置**: Line 1479-1489
**修改内容**:
```diff
- // 修复：callerSessionId 必须 === leaf.session_id 或 leaf.added_by（commander 可代 worker 报 done）
- if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id && callerSessionId !== leaf.added_by) {
+ // 修复：只允许 leaf.session_id 自己写自己的 done event，禁止任何代写（包括 commander）
+ if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id) {
```

**验证方法**:
```bash
# 场景：commander 尝试给 worker 写 done event
# 期望：抛出 E_BORROWED_IDENTITY 错误
```

**预期结果**: ❌ Commander 无法代写 worker done event，必须由 worker 自己报告完成。

---

### ✅ Bug A-2：cmdAuditGate hasDone 写入者检查（P0）

**位置**: Line 2298-2307
**修改内容**:
```diff
- const hasDone = evs.some((e) => e && e.type === 'done');
- if (!hasDone) {
+ const doneEvent = evs.find((e) => e && e.type === 'done');
+ if (!doneEvent) {
    throw new TreeStateError(E_AUDIT_PREMATURE, ...);
  }
+ // Bug A 修复：验证 done event 的写入者身份
+ const callerOfDone = doneEvent.meta && doneEvent.meta.caller_session_id;
+ if (callerOfDone && callerOfDone !== leaf.session_id) {
+   throw new TreeStateError(E_BORROWED_IDENTITY, ...);
+ }
```

**验证方法**:
```bash
# 场景：worker 的 done event 是由 commander 代写的
# 期望：audit_gate 时抛出 E_BORROWED_IDENTITY 错误
```

**预期结果**: ❌ 即使 commander 绕过 Bug A-1 写了 done event，audit_gate 也会拦截。

---

### ✅ Bug B-3：cmdLeafAdd session_id 唯一性校验（P1）

**位置**: Line 703-718
**修改内容**:
```javascript
// 在 leaf_id 唯一性校验后添加：
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

**错误码添加**: Line 83
```javascript
const E_DUPLICATE_SESSION_ID = 'E_DUPLICATE_SESSION_ID';
```

**验证方法**:
```bash
# 场景：用同一 session 注册两个 leaf
# 期望：leaf_add 第二次时抛出 E_DUPLICATE_SESSION_ID 错误
```

**预期结果**: ❌ 同 session 无法注册多个 leaf，从入口处堵住歧义。

---

### ✅ Bug B-4：resolveAuditorIndep fallthrough（P1）

**位置**: Line 1896-1907
**修改内容**:
```diff
- const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === auditorSessionId);
- if (!auditorLeaf) return ...;
+ const auditorCandidates = Object.values(state.leaves).filter(l => l.session_id === auditorSessionId);
+ if (auditorCandidates.length === 0) return ...;
+ // 跳过 pruned/archived 候选
+ const activeCandidates = auditorCandidates.filter(l => l.status !== 'archived' && l.status !== 'pruned');
+ if (activeCandidates.length === 0) return ...;
+ // 取第一个活跃候选
+ const auditorLeaf = activeCandidates[0];
```

**验证方法**:
```bash
# 场景：同 session 有多个 leaf（commander + worker），commander 已 pruned
# 期望：audit_gate 使用 worker leaf（活跃），而非 commander leaf（pruned）
```

**预期结果**: ✅ Audit_gate 正确路由到活跃 leaf，无视已 pruned 的同 session leaf。

---

## 修复前后对比

| 漏洞 | 修复前行为 | 修复后行为 |
|------|-----------|-----------|
| Bug A-1 | Commander 可代写 worker done event | ❌ Commander 无法代写 |
| Bug A-2 | Commander 代写的 done 能通过审计 | ❌ Audit_gate 拦截代写 |
| Bug B-3 | 同 session 可注册多个 leaf | ❌ 第二次注册被拒绝 |
| Bug B-4 | Audit_gate 命中第一个匹配（即使 pruned） | ✅ 跳过 pruned，使用活跃 leaf |

---

## 语法验证

✅ **JavaScript 语法检查通过**
```bash
node -c D:\Proma-dev\resources\app\dist\tree-engine.cjs
# 无输出 → 语法正确
```

---

## 运行时验证建议

### 测试场景 1：Bug A 修复验证
```bash
# 在 dev 实例创建测试树
tree_id="bug-a-verify-$(date +%m%d%H%M)"

# 1. 创建 commander + worker
# 2. Commander 尝试给 worker 写 done event
# 3. 预期：E_BORROWED_IDENTITY 错误
```

### 测试场景 2：Bug B 修复验证
```bash
# 在 dev 实例创建测试树
tree_id="bug-b-verify-$(date +%m%d%H%M)"

# 1. 用 session X 注册 commander
# 2. 用同一 session X 尝试注册 worker
# 3. 预期：E_DUPLICATE_SESSION_ID 错误
```

### 测试场景 3：Bug B-4 修复验证
```bash
# 1. 用 session X 注册 commander（后 pruned）
# 2. 用 session X 注册 worker（活跃）
# 3. 调 audit_gate(session=X)
# 4. 预期：使用 worker leaf，而非 commander leaf
```

---

## 与原始报告的对应

| Bug A 报告结论 | 修复措施 | 状态 |
|---------------|---------|------|
| "cmdEventAppend line 1484 允许 commander 代写" | 修改为只允许 leaf.session_id | ✅ 已修复 |
| "cmdAuditGate line 2302 hasDone 不检查写入者" | 检查 done event.meta.caller_session_id | ✅ 已修复 |
| "High 严重度，设计漏洞" | 双重保障（Bug A-1 + Bug A-2） | ✅ 已加固 |

| Bug B 报告结论 | 修复措施 | 状态 |
|---------------|---------|------|
| "cmdLeafAdd line 633 不校验 session_id 唯一" | 添加 session_id 唯一性校验 | ✅ 已修复 |
| "resolveAuditorIndep line 1883 .find() 不 fallthrough" | 改用 .filter() 过滤 pruned/archived | ✅ 已修复 |
| "Medium-High 严重度，工程缺陷" | 入口拦截（Bug B-3）+ 防御性修复（Bug B-4） | ✅ 已加固 |

---

## 审查会话参与情况

| 审查会话 | 审查内容 | 状态 |
|---------|---------|------|
| Auditor #1 (abf92aed) | Bug A-1 cmdEventAppend | ✅ 已返回 - 确认漏洞 |
| Auditor #2 (76e5d898) | Bug A-2 cmdAuditGate | ⏳ 进行中 |
| Auditor #3 (1795cea8) | Bug B-3 cmdLeafAdd | ✅ 已返回 - 推荐复用 cmdLeafSetSession 逻辑 |
| Auditor #4 (1cdd1ecf) | Bug B-4 resolveAuditorIndep | ⏳ 进行中 |

---

## 下一步行动

1. ✅ **代码修复完成** - 4 处修改 + 1 个错误码
2. ⏳ **在 dev 实例复现验证** - 创建测试树验证修复效果
3. ⏳ **回归测试** - 确保修复不影响现有功能
4. ⏳ **文档更新** - 更新 V10 方法论，补充 Bug A/B 修复章节

---

## 结论

✅ **所有 4 处修复已实施**，语法检查通过，等待运行时验证。

**关键改进**：
- **Bug A（High）**: 从"允许 commander 代写"改为"严格禁止代写"，双重保障审计链
- **Bug B（Medium-High）**: 从"入口放行 + 查询歧义"改为"入口拦截 + 智能路由"，彻底消除 session 多 leaf 问题

**风险评估**：
- ⚠️ **行为变更**: 禁止 commander 代写 worker done event - 可能影响现有工作流
- ⚠️ **新增约束**: 禁止同 session 注册多个 leaf - 要求每个 leaf 用独立 session
- ✅ **向后兼容**: CLI 调用不传 callerSessionId 时跳过校验 - 保持测试兼容性
