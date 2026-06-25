# C5 root-as-trust-anchor P0 修复报告

> 维护: C5 commander (v10v-C5-commander leaf, C3 修复版本) | 创建: 2026-06-25
> 上游评价: `.context/v10/a3-a4-review-report.md`（A3 独立 auditor 发现的 2 个 P0 致命失守）
> 上游实施: `.context/v10/c3-trust-anchor-report.md`（C3 原始实施）

## 修复概况

### 2 个 P0 攻击状态

| # | 攻击 | 原状态 | 修复后状态 |
|---|------|--------|-----------|
| 1 | worker 用 `audit_session_id=null` 给 root 调 audit_gate pass | **失守**（root.audit_gate 被 worker 一键改写） | **堵住**（E_AUDITOR_NOT_INDEPENDENT,root.audit_gate 未被改写） |
| 2 | worker 通过 `event_append` 给 root 写 done event 触发 auto_upgrade | **失守**（root.audit_gate 从 skip 升级为 pass + auto_upgrade=true） | **堵住**（E_BORROWED_IDENTITY,root.audit_gate 保持 skip + status 保持 active） |

### 修复位置

| 文件 | 行号（patch-l/dist） | 行号（core） |
|------|---------------------|-------------|
| `resolveAuditorIndep` root 信任锚 | tree-engine.cjs:1843-1860 | tree-state.js:1840-1857 |
| `cmdEventAppend` 函数签名加 callerSessionId | tree-engine.cjs:1429 | tree-state.js:1426 |
| `cmdEventAppend` done event caller 校验（新增） | tree-engine.cjs:1482-1492 | tree-state.js:1479-1489 |
| `cmdEventAppend` auto_upgrade 触发条件收紧 | tree-engine.cjs:1597-1618 | tree-state.js:1594-1615 |
| `dispatchEvent` 透传 callerSessionId | tree-engine.cjs:3382-3392 | tree-state.js:3379-3389 |
| `dispatch` case 'event' 透传 callerSessionId | tree-engine.cjs:3316-3318 | tree-state.js:3338-3340 |
| `run()` 注释补充（仅 patch-l/dist） | tree-engine.cjs:3469-3471 | （core 用 main(),N/A） |

**改动行数**：约 +60 行（含注释；纯逻辑约 +25 行）

### 新增测试

| 测试 | 描述 | 期望 | 实测 |
|------|------|------|------|
| T8 | worker 用 audit_session_id=null 给 root 调 audit_gate pass | 拒绝（E_AUDITOR_NOT_INDEPENDENT 等）+ root.audit_gate 未被改写 | ✓（3/3 子断言通过） |
| T9 | worker 通过 event_append 给 root 写 done event | 拒绝（E_BORROWED_IDENTITY）+ root.audit_gate 保持 skip + status 保持 active | ✓（3/3 子断言通过） |

---

## P0 攻击 1 修复：root 信任锚 null 放行支

### 根因（A3 报告原文）

> 放行条件中 `auditorSessionId === null` 这一支**完全绕过 caller 校验**。结合 cmdAuditGate:2244 的 caller 校验：
> ```js
> if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId) { throw ...E_BORROWED_IDENTITY...; }
> ```
> 当 `audit_session_id === null` 时,短路逻辑跳过整个 caller 校验,直接进入 resolveAuditorIndep,root 信任锚分支放行。

### 修复

**文件:行号**：patch-l/tree-engine.cjs:1849（同 dist）；core/tree-state.js:1846

**改动代码片段**（patch-l）：

改前：
```js
if (leaf.role === 'root' && (auditorSessionId === null || auditorSessionId === leaf.session_id)) {
  return null;  // root 自审放行
}
```

改后：
```js
// V10-trust-anchor-fix (C5/A3 P0 攻击 1): 删除 `auditorSessionId === null` 放行支。
//   原放行条件 `(auditorSessionId === null || auditorSessionId === leaf.session_id)` 中 null 这一支
//   会被 worker 利用：worker 调 audit_gate 不传 audit_session_id（=null）,cmdAuditGate 的
//   caller 校验 `audit_session_id && callerSessionId && ...` 因 audit_session_id=null 短路跳过,
//   resolveAuditorIndep 又因 null 放行,root.audit_gate 被 worker 一键改写（包括覆盖 fail 状态）。
//   修复：root 自审必须显式传 audit_session_id === leaf.session_id,与 cmdAuditGate 的 caller 校验
//   （caller === audit_session_id）协同,确保只有 caller=root.session_id 才能命中此分支。
if (leaf.role === 'root' && auditorSessionId === leaf.session_id) {
  return null;  // root 自审放行（必须显式传 root 自己的 session_id,不允许 null）
}
```

### 自验证

T8 测试（v10-trust-anchor-test.cjs）实测：
- T8a root 写 done event 建立信任锚（auto_upgrade=true）→ ok
- T8b worker 用 null 给 root 调 audit_gate pass → **E_AUDITOR_NOT_INDEPENDENT 拒**（resolveAuditorIndep 因 null 返回 'auditor_session_id is null'）
- T8c root.audit_gate 未被 worker 改写 → verdict=pass, auditor=root.session_id, auto_upgrade=true（保持 T8a 的状态）

---

## P0 攻击 2 修复：cmdEventAppend caller 校验 + auto_upgrade 收紧

### 根因（A3 报告原文）

> cmdEventAppend 函数定义 `async function cmdEventAppend(args)` **没有 callerSessionId 形参**。意味着任何角色（包括 worker）都能给任何 leaf（包括 root）写 done event,自动触发 trust-anchor auto_upgrade。

### 修复

**修复 A：cmdEventAppend 函数签名加 callerSessionId**

文件:行号：patch-l/tree-engine.cjs:1429；core/tree-state.js:1426

```js
// 改前
async function cmdEventAppend(args) {

// 改后
async function cmdEventAppend(args, callerSessionId) {
```

**修复 B：写 done event 时校验 caller 是 leaf 拥有者或其添加者**

文件:行号：patch-l/tree-engine.cjs:1482-1492；core/tree-state.js:1479-1489

```js
// V10-trust-anchor-fix (C5/A3 P0 攻击 2): 写 done event 必须是 leaf 拥有者（session_id）或其添加者（added_by）。
//   失守根因：原 cmdEventAppend 没有 callerSessionId 形参,任何角色（含 worker）都能给任何 leaf（含 root）
//   写 done event,触发 V10-trust-anchor auto_upgrade,root.audit_gate 一键被 worker 升级为 pass。
//   修复：callerSessionId（MCP wrapper 透传）必须 === leaf.session_id 或 leaf.added_by（commander 可代 worker 报 done）。
//   CLI 调用（dbc-spec 等测试）不传 callerSessionId,跳过此校验（向后兼容）。
if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id && callerSessionId !== leaf.added_by) {
  throw new TreeStateError(
    E_BORROWED_IDENTITY,
    `event_append rejected: caller "${callerSessionId}" cannot write done event to leaf "${leaf_id}" (session=${leaf.session_id}, added_by=${leaf.added_by || 'null'}). Only the leaf owner or its creator can mark done.`
  );
}
```

**修复 C：auto_upgrade 触发条件加 caller === leaf.session_id（defense-in-depth）**

文件:行号：patch-l/tree-engine.cjs:1597-1618；core/tree-state.js:1594-1615

```js
// 改前
if (opts.type === 'done' && leaf.role === 'root') {
  const curGate = leaf.audit_gate;
  if (!curGate || curGate.verdict === 'skip') {
    leaf.audit_gate = { verdict: 'pass', ... auto_upgrade: true };
  }
}

// 改后（加 callerIsRootSelf 守卫）
if (opts.type === 'done' && leaf.role === 'root') {
  const curGate = leaf.audit_gate;
  const callerIsRootSelf = !callerSessionId || callerSessionId === leaf.session_id;
  if ((!curGate || curGate.verdict === 'skip') && callerIsRootSelf) {
    leaf.audit_gate = { verdict: 'pass', ... auto_upgrade: true };
  }
}
```

### 自验证

T9 测试（v10-trust-anchor-test.cjs）实测：
- T9 前置：root.audit_gate.verdict='skip'（root 还没写 done event）✓
- T9a worker 给 root 写 done event → **E_BORROWED_IDENTITY 拒**（caller=worker.session_id, root.session_id 不同,root.added_by=null 也不同）
- T9b root.audit_gate 未被 worker 升级（仍 skip）✓
- T9c root.status 未被 worker 改 done（保持 active）✓

---

## MCP wrapper / dispatch 透传链路

### 链路（已存在 + C5 补全）

```
MCP wrapper (patches.cjs)
  __proma_getMcpServers__(sessionId, ...)        ← 从 SDK 注入 callerSessionId
  → __proma_createTreeMcpServer__(..., sessionId)
  → tt("tree_event_append", ..., argBuilder)     ← 已在 D4/V10-self-audit-forbidden-v2 注册
  → callTreeState(workspaceSlug, args, callerSessionId)  ← 透传（patches.cjs:1132-1138）
  → treeEngine.run(cmd, rest, ws.trees_dir, callerSessionId)  ← 透传（patches.cjs:1138）

engine (tree-engine.cjs)
  run(cmd, args, treesRoot, callerSessionId)     ← 已存在（V10-self-audit-forbidden-v2）
  → dispatch(cmd, args, callerSessionId)         ← 已存在
  → case 'event': dispatchEvent(args, callerSessionId)  ← C5 修复 3（原为 dispatchEvent(args)）
  → case 'append': cmdEventAppend(rest, callerSessionId)  ← C5 修复 3（原为 cmdEventAppend(rest)）
  → done event 写入前校验 callerSessionId       ← C5 修复 2（新增校验）
```

### patches.cjs 改动

**无需改动**。patches.cjs:1132-1138 已在 V10-self-audit-forbidden-v2 任务中透传 callerSessionId 到 engine.run,所有 mcp__tree__* 工具（含 tree_event_append）都经过 callTreeState → engine.run → dispatch → dispatchEvent → cmdEventAppend 链路。C5 只补全了 engine 内部 dispatch → dispatchEvent → cmdEventAppend 这一段。

### dist/patches.cjs 验证

```bash
$ diff patch-l/proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs | wc -l
0
```

patch-l ↔ dist patches.cjs 完全字面一致。

---

## 3 处 diff 验证

```bash
$ diff patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs | wc -l
0
# patch-l ↔ dist 完全字面一致 ✓

$ diff patch-l/proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs | wc -l
0
# patches.cjs 完全字面一致 ✓

$ diff core/tree-state.js patch-l/tree-engine.cjs | wc -l
130
# baseline 漂移：core 用 main() + __dirname,patch-l/dist 用 run() + TREES_ROOT 可注入
# C5 改动在 3 处文件中逻辑等价、字面一致（除 baseline 漂移外）

$ grep -c "V10-trust-anchor-fix (C5" core/tree-state.js patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs
core/tree-state.js:5
patch-l/tree-engine.cjs:6    # 5 个改动点 + 1 个 run() 注释
D:/Proma-dev/.../tree-engine.cjs:6   # 同 patch-l
```

**core 5 vs patch-l/dist 6 的差异说明**：core 没有 `run()` 函数（用 `main()` 当 CLI 入口），少 1 个 C5 标记是 run() 函数头注释里的,符合 baseline 漂移,与 C5 改动逻辑无关。

---

## 测试回归

| 测试套件 | 期望 | 实测 | 状态 |
|---------|------|------|------|
| v10-trust-anchor-test | 18→24（+T8/T9） | **24/24 通过**（T8 3 子断言 + T9 3 子断言全过） | ✓ |
| helper-test | 6/6 | **6/6 通过** | ✓ |
| v10-cleanroom | 54/54 | **54/54 通过**（V10-auditor-active 3/3 + V10-self-audit-forbidden-v2 2/2 + V10-uuid-format-strict 7/7 + V10-numeric-consistency 8/8 + V10-nudge-escalation 4/4 + V10-timestamp-monotonic 3/3 + V10-workspace-canonical 3/3 + V10-status-event-sync 3/3 + audit-gate-test-失守重放 1/1 + vfb-17种攻击重放 15/15 + Cr2-incremental 5/5） | ✓ |
| dbc-spec | 48/0 | **48/0 通过** | ✓ |
| audit-attacks | 18 总/0 可绕过 | **18 总 / 0 可绕过 / 17 不可绕过 / 1 部分（CP2-direct-forge baseline 不变）** | ✓ |
| v10-regression | 14/14 | **14/14 通过** | ✓ |

**全部 6 套测试通过,0 退化。**

---

## 自验证：A3 的 2 个攻击向量

### 攻击 1: worker 用 null 给 root 调 audit_gate

```
=== T8 实测 ===
T8a root 写 done event（建立信任锚）  ok
T8b worker 用 null 给 root 调 audit_gate pass（应拒）  E_AUDITOR_NOT_INDEPENDENT
T8c root.audit_gate 未被 worker 改写  verdict=pass, auditor=00000000-0000-0000-0000-000000000001, auto_upgrade=true
```

**结果**：worker 用 audit_session_id=null 给 root 调 audit_gate 被拒（E_AUDITOR_NOT_INDEPENDENT）,root.audit_gate 保持 T8a 写 done event 后的状态（auto_upgrade=true, auditor=root.session_id）,未被 worker 改写。

**修复机制**：
1. cmdAuditGate 的 caller 校验 `audit_session_id && callerSessionId && ...` 因 audit_session_id=null 短路跳过（这是 V10-self-audit-forbidden-v2 原设计）
2. resolveAuditorIndep 进入,root 信任锚分支**不再因 null 放行**（C5 改动 1）,继续往下走
3. `if (!auditorSessionId) return 'auditor_session_id is null';` 命中,返回失败原因
4. cmdAuditGate 把失败原因包装成 E_AUDITOR_NOT_INDEPENDENT 拒绝

### 攻击 2: worker 给 root 写 done event

```
=== T9 实测 ===
T9a worker 给 root 写 done event（应 E_BORROWED_IDENTITY）  E_BORROWED_IDENTITY
T9b root.audit_gate 未被 worker 升级（仍 skip）  verdict=skip
T9c root.status 未被 worker 改 done  status=active
```

**结果**：worker 通过 event_append 给 root 写 done event 被拒（E_BORROWED_IDENTITY）,root.audit_gate 保持 'skip',root.status 保持 'active',auto_upgrade 未被触发。

**修复机制**：
1. MCP wrapper 已经透传 callerSessionId=worker.session_id 到 engine.run（V10-self-audit-forbidden-v2 已存在）
2. C5 改动 3 让 dispatch → dispatchEvent → cmdEventAppend 都透传 callerSessionId
3. cmdEventAppend 写 done event 前,C5 改动 2 校验 callerSessionId === leaf.session_id 或 leaf.added_by
4. root.session_id 是 root 自己,root.added_by 是 null,worker.session_id 都不匹配 → E_BORROWED_IDENTITY 拒绝
5. 即便上述校验被绕过,C5 改动 2 的 defense-in-depth（auto_upgrade 触发条件加 callerIsRootSelf）也会阻止 auto_upgrade

---

## 已知遗留

### 1. core/tree-state.js 与 patch-l/tree-engine.cjs baseline 漂移（130 行）

**根因**：core 用 main() + __dirname,patch-l/dist 用 run() + TREES_ROOT 可注入。这是 C3 报告中已记录的 baseline 漂移（C3 时是 128 行,C5 后变成 130 行,新增 2 行是 dispatch case 'event' 注释的差异）。

**C5 责任**：C5 的 6 处 trust-anchor-fix 改动在 3 处文件中逻辑等价、字面一致（除 baseline 漂移外）。

**修复建议**：在 Phase 5 / push 任务中统一一回写 core,或保留 core 作为 reference impl（只跑测试不直接部署）。不属于 C5 范围。

### 2. audit-attacks 中 CP2-direct-forge 仍是"部分通过"

`CP2-direct-forge` 显示 "✓(部分)" —— 这是 baseline 行为（C2/C3 报告中都存在）,validate 报 `audit_gate_not_independent` issue 已正确拦截,符合预期。C5 改动未引入新退化。

### 3. 测试覆盖广度建议（可选,P2）

A3 报告建议 helper-test 加 H7 批量验证 16 个 V10 错误码的 help_topic 映射（当前只测了 2 个）。这属于 D4 helper 配套的 P2 改进,不属于 C5 范围。

---

## 实施总结

- **2 个 P0 攻击全部堵住**,T8/T9 测试验证 + 6 套金标准全过
- **6 处改动**（resolveAuditorIndep + cmdEventAppend 签名 + done event caller 校验 + auto_upgrade 收紧 + dispatchEvent 透传 + dispatch case 'event' 透传）,3 处文件同步一致（patch-l↔dist 0 diff,core 仅有 baseline 漂移与 C5 无关）
- **新增 T8/T9 共 6 个子断言**,v10-trust-anchor-test 从 18 → 24 全过
- **金标准 6 套全过**：v10-trust-anchor-test(24) + helper-test(6) + v10-cleanroom(54) + dbc-spec(48) + audit-attacks(18) + v10-regression(14) = 164 测试 0 退化
- **未触碰 V4-V9 + V10 + D4 + C3 现有代码**（仅在 A3 明确指出的 2 处 + 1 处必要透传链路上修改）
- **未修改金标准测试**（仅给 v10-trust-anchor-test.cjs 加 T8/T9,不改其他 5 套）
- **未调用 mcp__tree__* 工具**

C5 修复**收敛**,建议主会话派 A5 复评（独立 auditor 验证 T8/T9 + 3 处 diff + 6 套金标准）后正式 close v10v 开发树的 trust-anchor 任务。
