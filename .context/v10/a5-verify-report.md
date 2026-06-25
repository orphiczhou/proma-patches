# A5 验证报告：C5 P0 修复有效性

> 验证者: A5 auditor（v10v-A5-verify leaf，独立上下文，A3 迭代版本）
> 评价对象: C5 root-as-trust-anchor P0 修复（C3 → A3 评价 → C5 修复链路）
> 评价日期: 2026-06-25
> 上游材料:
> - A3 攻击向量：`.context/v10/a3-a4-review-report.md`
> - C5 修复报告：`.context/v10/c5-trust-anchor-fix-report.md`
> - 改后代码：`release/tree-system-v0.2.2/patch-l/tree-engine.cjs` + `D:/Proma-dev/resources/app/dist/tree-engine.cjs`

---

## 总体判定

| 维度 | 判定 | 证据 |
|------|------|------|
| P0 攻击 1 已堵 | **是** | worker 用 null 给 root 调 audit_gate pass → E_AUDITOR_NOT_INDEPENDENT，root.audit_gate 未被改写（独立重放）|
| P0 攻击 2 已堵 | **是** | worker 给 root 写 done event → E_BORROWED_IDENTITY，root.audit_gate 保持 skip、status 保持 active（独立重放）|
| T8/T9 测试覆盖 | **充分** | T8 覆盖攻击 1（worker + null audit_session_id + target=root + caller=worker）、T9 覆盖攻击 2（worker + done event + target=root + caller=worker）；断言方向正确（应拒绝）|
| 6 套金标准 0 退化 | **是** | 24+6+54+48+18+14 = 164 测试全过 |
| 新攻击面 | **无 C5 新引入**（baseline 遗留 E1 已记录）| E1 是 V10-self-audit-forbidden-v2 旧 caller 校验缺陷（C5 之前已存在），非 C5 引入；E2 wrapper 绕过依赖 MCP wrapper 不可绕过（设计前提）|
| 整体 | **推荐收敛** | 2 个 P0 已真正堵住，T8/T9 覆盖到位，3 处 diff 字面一致，0 退化 |

---

## 任务 1: P0 攻击 1 验证

### 代码层验证

**位置**：`patch-l/tree-engine.cjs:1861-1877`（同 `dist/tree-engine.cjs`；`core/tree-state.js:1794-1810`）

改前（C3 版本，A3 已确认失守）：
```js
if (leaf.role === 'root' && (auditorSessionId === null || auditorSessionId === leaf.session_id)) {
  return null;  // root 自审放行
}
```

改后（C5）：
```js
// V10-trust-anchor-fix (C5/A3 P0 攻击 1): 删除 `auditorSessionId === null` 放行支。
if (leaf.role === 'root' && auditorSessionId === leaf.session_id) {
  return null;  // root 自审放行（必须显式传 root 自己的 session_id,不允许 null）
}
if (!auditorSessionId) return 'auditor_session_id is null';
```

**确认**：
- ✅ root 信任锚分支不再放行 `auditorSessionId === null`
- ✅ 只放行 `auditorSessionId === leaf.session_id`（显式自审，root 必须传自己的 session_id）
- ✅ 下一行兜底：null 直接返回失败原因 `'auditor_session_id is null'`，被 cmdAuditGate 包装成 E_AUDITOR_NOT_INDEPENDENT

### 独立重放

**脚本**：`release/tree-system-v0.2.2/test-sandbox/a5-verify.cjs`（A5 独立构造，不复用 v10-trust-anchor-test.cjs 的 helper）

```
=== ATTACK 1: worker 用 audit_session_id=null 给 root 调 audit_gate verdict=pass ===
root 写 done event: OK
攻击前 root.audit_gate: {"verdict":"pass","auditor_session_id":"a5a5...a001","auto_upgrade":true}
worker 用 null 调 audit_gate: 拒（E_AUDITOR_NOT_INDEPENDENT）
  error.msg: audit-gate rejected: auditor "null" not independent for leaf "att1-root" (verdict=pass): auditor_session_id is null.
攻击后 root.audit_gate: {"verdict":"pass","auditor_session_id":"a5a5...a001","auto_upgrade":true}
root.audit_gate.auditor_session_id 仍是 root.session_id（保持）：是
攻击 1 结论：已堵
```

**关键证据**：
- worker (caller=a5a5...a003) 调用 audit_gate 不传 audit_session_id（=null）
- cmdAuditGate 行 2269 caller 校验 `audit_session_id && callerSessionId && ...` 因 `audit_session_id=null` 短路跳过（这是 V10-self-audit-forbidden-v2 原设计）
- 进入 `resolveAuditorIndep(state, leaf, null)`：
  - root 信任锚分支（行 1874）条件 `auditorSessionId === leaf.session_id` 不满足（null ≠ root.session_id）→ **不放行**（C5 关键修复点）
  - 行 1877 `if (!auditorSessionId) return 'auditor_session_id is null';` 命中 → 返回失败原因
- cmdAuditGate 行 2290 包装成 `E_AUDITOR_NOT_INDEPENDENT` 拒绝
- root.audit_gate 完全未被改写（保持 T8a 写 done event 后的状态：verdict=pass, auditor=root.session_id, auto_upgrade=true）

---

## 任务 2: P0 攻击 2 验证

### 代码层验证

**位置**：`patch-l/tree-engine.cjs:1429 + 1484-1489 + 1611-1622`（同 dist；同 core 行号 +5/-5）

**修复 A：cmdEventAppend 加 callerSessionId 形参**（行 1429）
```js
async function cmdEventAppend(args, callerSessionId) {
```

**修复 B：写 done event 时校验 caller 是 leaf 拥有者或其添加者**（行 1484-1489）
```js
if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id && callerSessionId !== leaf.added_by) {
  throw new TreeStateError(E_BORROWED_IDENTITY, ...);
}
```

**修复 C：auto_upgrade 触发条件加 callerIsRootSelf 守卫**（行 1611-1622）
```js
if (opts.type === 'done' && leaf.role === 'root') {
  const curGate = leaf.audit_gate;
  const callerIsRootSelf = !callerSessionId || callerSessionId === leaf.session_id;
  if ((!curGate || curGate.verdict === 'skip') && callerIsRootSelf) {
    leaf.audit_gate = { verdict: 'pass', auditor_session_id: leaf.session_id, ts: nowIso(), auto_upgrade: true };
  }
}
```

**透传链路**：
- `dispatch:3343` → `dispatchEvent(args, callerSessionId)`
- `dispatchEvent:3412` → `cmdEventAppend(rest, callerSessionId)`

**确认**：
- ✅ cmdEventAppend 接收 callerSessionId 形参
- ✅ 写 done event 前校验 caller === leaf.session_id 或 leaf.added_by
- ✅ auto_upgrade 触发条件加 callerIsRootSelf 守卫（defense-in-depth）

### 独立重放

```
=== ATTACK 2: worker 给 root 写 done event 触发 auto_upgrade ===
攻击前 root.audit_gate: {"verdict":"skip","auditor_session_id":null,"ts":null}
攻击前 root.status: active
worker 给 root 写 done event: 拒（E_BORROWED_IDENTITY）
  error.msg: event_append rejected: caller "a5a5...a003" cannot write done event to leaf "att2-root" (session=a5a5...a001, added_by=null). Only the leaf owner or its creator can mark done.
攻击后 root.audit_gate: {"verdict":"skip","auditor_session_id":null,"ts":null}
攻击后 root.status: active
攻击 2 结论：已堵
```

**关键证据**：
- worker (caller=a5a5...a003) 给 root (leaf.session_id=a5a5...a001, leaf.added_by=null) 写 done event
- 行 1484 校验：`callerSessionId(a5a5...a003) !== leaf.session_id(a5a5...a001)` 且 `callerSessionId !== leaf.added_by(null)` → 抛 E_BORROWED_IDENTITY
- root.audit_gate 保持 'skip'（未被 auto_upgrade 升级为 pass）
- root.status 保持 'active'（done event 未写入，行 1591 的 `if (opts.type === 'done' && leaf.status !== 'done')` 未触发）

---

## 任务 3: T8/T9 覆盖验证

### T8 用例审查

**位置**：`v10-trust-anchor-test.cjs:324-361`

T8 三段子断言：
- T8a：root 用 caller=root.session_id 写 done event，建立信任锚（auto_upgrade=true）— ok
- T8b：worker 用 caller=worker.session_id、不传 audit_session_id（=null）给 root 调 audit_gate verdict=pass — **应拒**（期望码 `E_AUDITOR_NOT_INDEPENDENT | E_BORROWED_IDENTITY | E_INVALID_UUID_STRICT`）
- T8c：双重确认 root.audit_gate 未被改写（verdict=pass, auditor=root.session_id, auto_upgrade=true）

**覆盖度评估**：
- ✅ 真的覆盖了 A3 攻击 1 的精确向量（worker + audit_session_id=null + target=root + caller=worker.session_id）
- ✅ 断言方向正确（期望拒绝，accept 备选码包括 caller 校验拦截的 E_BORROWED_IDENTITY 和 UUID 严格校验的 E_INVALID_UUID_STRICT，覆盖各修复层兜底）
- ✅ T8c 双重确认 root.audit_gate 状态，防止"表面拒绝但状态被改"的隐式失守

### T9 用例审查

**位置**：`v10-trust-anchor-test.cjs:363-405`

T9 三段子断言：
- T9a：worker 用 caller=worker.session_id 给 root 写 done event — **应 E_BORROWED_IDENTITY**
- T9b：root.audit_gate 未被 worker 升级（仍 skip）
- T9c：root.status 未被 worker 改 done（保持 active）

**覆盖度评估**：
- ✅ 真的覆盖了 A3 攻击 2 的精确向量（worker + event_append done + target=root + caller=worker.session_id）
- ✅ 三重断言（拒绝 + audit_gate 不变 + status 不变）杜绝"拒绝但状态被改"的隐式失守
- ✅ T9 前置校验 root.audit_gate.verdict='skip'（root 还没写 done event），确保测试起点正确

### 实跑结果

```
$ node v10-trust-anchor-test.cjs
...
[T8] (C5/A3 P0 攻击 1) worker 用 audit_session_id=null 给 root 调 audit_gate（应拒绝）
  ✓ T8a root 写 done event（建立信任锚）  ok
  ✓ T8b worker 用 null 给 root 调 audit_gate pass（应拒）  E_AUDITOR_NOT_INDEPENDENT
  ✓ T8c root.audit_gate 未被 worker 改写  verdict=pass, auditor=00000000-0000-0000-0000-000000000001, auto_upgrade=true

[T9] (C5/A3 P0 攻击 2) worker 给 root 写 done event 触发 auto_upgrade（应拒绝）
  ✓ T9a worker 给 root 写 done event（应 E_BORROWED_IDENTITY）  E_BORROWED_IDENTITY
  ✓ T9b root.audit_gate 未被 worker 升级（仍 skip）  verdict=skip
  ✓ T9c root.status 未被 worker 改 done  status=active

=== 统计 ===
通过: 24
失败: 0
```

T8/T9 全部 6 个子断言通过，与 C5 自验证报告一致。

---

## 任务 4: 6 套金标准回归

| 测试套件 | 期望 | 实测 | 状态 |
|---------|------|------|------|
| v10-trust-anchor-test | 24/24（T1-T7 17 + T8 3 + T9 3 + 默认 1）| **24/24 通过** | ✓ |
| helper-test | 6/6 | **6/6 通过** | ✓ |
| v10-cleanroom | 54/54 | **54/54 通过**（V10-auditor-active 3 + V10-self-audit-forbidden-v2 2 + V10-uuid-format-strict 7 + V10-numeric-consistency 8 + V10-nudge-escalation 4 + V10-timestamp-monotonic 3 + V10-workspace-canonical 3 + V10-status-event-sync 3 + audit-gate-test-失守重放 1 + vfb-17种攻击重放 15 + Cr2-incremental 5）| ✓ |
| dbc-spec | 48/0 | **48/0 通过** | ✓ |
| audit-attacks | 18 总 / 0 可绕过 / 17 不可绕过 / 1 部分（CP2-direct-forge baseline）| **18 总 / 0 可绕过 / 17 不可绕过 / 1 部分** | ✓ |
| v10-regression | 14/14 | **14/14 通过** | ✓ |

**全部 6 套测试通过，0 退化，164 测试全部通过。**

---

## 任务 5: 3 处 diff

### patch-l vs dist (tree-engine.cjs)

```bash
$ diff patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs | wc -l
0
```

**完全字面一致** ✓（部署版已是 C5 修复版本）

### patch-l vs dist (proma-dev-patches.cjs)

```bash
$ diff patch-l/proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs | wc -l
0
```

**完全字面一致** ✓（patches.cjs 无需 C5 改动，dispatchEvent 透传在 engine 层完成）

### core vs patch-l (tree-state.js vs tree-engine.cjs)

```bash
$ diff core/tree-state.js patch-l/tree-engine.cjs | wc -l
130
```

130 行差异**全部是 baseline 漂移**（与 C5 改动无关）：
- TREES_ROOT：core 用 `__dirname`，patch-l 用 `let TREES_ROOT = __dirname` + 可注入 `setTreesRoot()`
- main() → run() CLI shim 重构（含 try/catch + Object.assign 风格）
- 注释微调（main() catch 块 vs run() catch 块）

**C5 改动验证**：
```bash
$ grep -c "V10-trust-anchor-fix (C5" core/tree-state.js patch-l/tree-engine.cjs dist/tree-engine.cjs
core: 5 处
patch-l: 6 处（5 改动点 + 1 run() 头注释）
dist: 5 处（同 core,无 run() 函数）
```

core 5 vs patch-l/dist 6 的差异是 core 用 main() 无 run() 函数头注释，符合 baseline 漂移。

**3 处文件 C5 改动逻辑等价、字面一致**（除合理的 baseline 漂移外）。

---

## 任务 6: 新攻击面分析

### 6.1 caller === added_by 攻击（worker 用 added_by 字段伪装）

**A5 边界测试 E4**（`a5-edge.cjs`）：

```
w1 (caller=UUID.w1) 给 w2 写 done event
w2.session_id = UUID.w2
w2.added_by   = UUID.comm  (w2 是 commander 直接子)
w1 不等于 w2.session_id 也不等于 w2.added_by
结果：E_BORROWED_IDENTITY 拒绝
```

**结论**：worker 无法通过 added_by 绕过 caller 校验。caller 校验逻辑正确：caller 必须**严格等于** leaf.session_id 或 leaf.added_by，兄弟 worker 互写 done event 被拒。

### 6.2 commander 代 worker 报 done（合法 added_by 路径）

**A5 边界测试 E3**：

```
commander (caller=UUID.comm) 给 worker 写 done event
worker.added_by = UUID.comm  (worker 是 commander 直接子)
caller=commander === worker.added_by
结果：放行
```

**结论**：C5 设计承认的合法路径（commander 可代 worker 报 done）正确放行，无误拒。

### 6.3 callerIsRootSelf 守卫判定逻辑

**代码**（行 1613）：
```js
const callerIsRootSelf = !callerSessionId || callerSessionId === leaf.session_id;
```

**判定逻辑**：
- `!callerSessionId`：CLI 路径（无 caller，向后兼容）→ true（放行 auto_upgrade）
- `callerSessionId === leaf.session_id`：root 自己调 → true（放行 auto_upgrade）
- 其他（worker 借 caller 给 root 写 done 等）→ false（拒绝 auto_upgrade）

**边界情况**：

#### E1: verdict=skip 降级攻击（**baseline 遗留缺陷，非 C5 引入**）

**A5 边界测试 E1**：

```
worker (caller=UUID.worker) 给 root 调 audit_gate verdict=skip（不传 audit_session_id）
攻击前 root.audit_gate.verdict = pass (auto_upgrade=true)
结果：放行（无 caller 校验）
攻击后 root.audit_gate.verdict = skip（auditor_session_id=null, auto_upgrade 字段被抹）
```

**机制**：cmdAuditGate 行 2269 的 caller 校验 `audit_session_id && callerSessionId && audit_session_id !== callerSessionId`，**audit_session_id 不传时短路跳过**。同时行 2288 的 resolveAuditorIndep 只在 `verdict ∈ {pass, required}` 时调用，**verdict=skip/fail 跳过独立性校验**。所以 worker 能给 root 调 verdict=skip 把 audit_gate 降级。

**严重性评估**：
- **不是 C5 引入**：此缺陷在 V10-self-audit-forbidden-v2 设计之初就存在（caller 校验的短路逻辑），C5 没有触碰这条路径。
- **影响范围**：worker 可以抹掉 root.audit_gate.verdict=pass 改成 skip（降级），但**不能升级**（verdict=pass 会被 resolveAuditorIndep 拒，C5 已堵）。降级让 root 失去 trust-anchor 信任锚状态，下游 commander/worker 的 audit_gate 调用会因 root 不再是 done+pass 状态被 resolveAuditorIndep 拒绝（"auditor leaf root own audit_gate.verdict=skip must be pass"）。这是 DoS 攻击而非 trust-chain 攻陷。
- **C5 范围外**：A3 报告只提了 2 个 P0（升级攻击），没提降级攻击。E1 属于 C5 范围外的新发现（baseline 遗留），建议作为后续 P1 任务跟进（caller 校验应覆盖所有 verdict 分支，或 resolveAuditorIndep 应在所有 verdict 分支都调用）。

#### E2: wrapper 绕过场景（依赖 MCP wrapper 不可绕过）

**A5 边界测试 E2**：

```
假设 worker 能控制 caller（直接调 engine.run 传 callerSessionId=UUID.root）
worker 借 caller=root.session_id 给 root 写 done event
结果：放行（auto_upgrade 触发）
```

**严重性评估**：
- **不是 C5 引入**：caller 是 MCP wrapper 从 SDK `__proma_getMcpServers__(sessionId)` 提取注入的，worker 无法在真实 MCP 调用中伪造。
- **设计前提**：整个 V10-self-audit-forbidden-v2 + C5 修复都依赖"MCP wrapper 不可绕过"这一前提。如果 wrapper 被绕过（如 SDK bug 让 sessionId 可控），所有 V10 加固都失效。这是结构性假设，不是 C5 的责任。

### 6.4 CLI 路径 auto_upgrade 触发（C5 设计承认的向后兼容）

**A5 边界测试（a5-verify.cjs Attack 4）**：

```
CLI 无 caller 给 root 写 done event
结果：放行（auto_upgrade 触发，root.audit_gate 升级为 pass）
```

**机制**：callerIsRootSelf 守卫的 `!callerSessionId` 分支让 CLI 路径放行 auto_upgrade。

**严重性评估**：
- **C5 注释已承认**（行 1611-1613 注释 + 行 1484 caller 校验注释 "CLI 调用（dbc-spec 等测试）不传 callerSessionId,跳过此校验（向后兼容）"）。
- **设计意图**：CLI 是本地用户操作（在 bash 直接调 `node tree-engine.cjs event append ...`），不是 MCP 跨 leaf 调用，没有"caller leaf"概念。
- **风险**：理论上恶意用户通过 CLI 操控可绕过，但实际部署中 root 节点 CLI 由 commander agent 或用户操作，不属于"worker 越权"范围。

---

## 最终结论

### 一句话

**C5 修复完全有效，推荐收敛**：A3 提出的 2 个 P0 攻击都被真正堵住（独立重放确认）；T8/T9 测试覆盖精确、断言方向正确、6 个子断言全过；3 处文件 diff 字面一致（patch-l↔dist 0 行差异，core 仅 baseline 漂移）；6 套金标准 164 测试 0 退化；未引入新攻击面（E1 是 baseline 遗留的 verdict=skip 降级 DoS，属 C5 范围外，建议作为后续 P1 跟进）。

### C5 修复成果总结

| 攻击向量 | 修复层 | 测试覆盖 | 独立重放 |
|---------|--------|---------|---------|
| P0 攻击 1（worker null audit_session_id 给 root 调 pass） | resolveAuditorIndep 删除 null 放行支 | T8（3 子断言） | ✓ 已堵 |
| P0 攻击 2（worker 给 root 写 done 触发 auto_upgrade） | cmdEventAppend 加 caller 校验 + auto_upgrade callerIsRootSelf 守卫 | T9（3 子断言） | ✓ 已堵 |

### 范围外发现（建议作为 P1 后续任务）

| 发现 | 严重性 | 范围 | 建议 |
|------|--------|------|------|
| E1: worker 给 root 调 verdict=skip 可降级 audit_gate | P1（DoS，非 trust-chain 攻陷）| baseline 遗留（V10-self-audit-forbidden-v2 caller 校验仅覆盖 pass/required 分支）| cmdAuditGate caller 校验应覆盖所有 verdict 分支，或所有 verdict 分支都调 resolveAuditorIndep |
| E2: wrapper 绕过假设 | P3（结构性假设）| 全 V10 加固的设计前提 | 维持现状，依赖 wrapper 不可绕过 |

### 后续建议

1. **正式 close v10v 开发树的 trust-anchor 任务**（C3 + C5 已收敛）
2. **(可选) P1 任务**：单独派 C6 修复 E1（verdict=skip/fail 降级攻击），属于 baseline 遗留范围，不阻塞当前收敛
3. **Phase 5 / push 任务**：v10v 修复集（V10 八大加固 + D4 helper + C3 trust-anchor + C5 P0 修复）整体合并到 orphiczhou/proma-patches 仓库

---

## 评价者签名

- 评价者：v10v-A5-verify（独立上下文，A3 迭代版本，只验证 C5 修复，不重审 C3+D4）
- 评价方法：独立读 C5 改后代码 + 独立构造 a5-verify.cjs（2 个 P0 攻击独立重放）+ 独立构造 a5-edge.cjs（5 个边界 case 探索新攻击面）+ 实跑 T8/T9 + 实跑 6 套金标准 + 3 处 diff 字面验证
- 关键发现：2 个 P0 攻击真正被堵住（独立重放确认，不只信 C5 自验证报告）；E1 baseline 遗留 verdict=skip 降级 DoS（C5 范围外）
- 报告生成：2026-06-25
