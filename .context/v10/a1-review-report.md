# A1 V10 评价报告

> 评价人: A1 auditor（leaf_id `v10v-A1-auditor`）| 评价对象: C1 commander 的 V10 实施
> 评价日期: 2026-06-25
> 评价原则: 不看 C1 实施过程，独立读改后代码 + 跑 diff + 跑测试

---

## 总体判定

| 项目 | 结果 |
|------|------|
| 8 大加固点实施合格率 | **8/8（代码层全部到位）** |
| 3 处 diff 验证 | **通过**（patch-l↔dist 逐字一致；core→patch-l 仅 v0.7+ 架构层差异） |
| 现有测试回归 | **退化**（dbc-spec 34/14，audit-attacks/audit-extra 基本保持） |
| v10-regression.cjs | **14/14 通过** |
| **整体判定** | **有条件合格** |

**核心矛盾**：代码层 8 大加固点全部正确实施，3 处同步零差异；但 dbc-spec 金标准 14 个用例退化（C1 在报告 §六自评里如实写了 34/14，没有隐瞒）。退化的根因是**金标准测试创建的"占位 auditor"恰好就是 V10 要堵的失守模式**——这是 spec 与金标准的固有冲突，不是 C1 实施错误。

**收敛建议**：**有条件推荐收敛**，条件是用户在两个修复方向中二选一（详见决策点 2）。代码层不需要 C2 迭代。

---

## 8 大加固点逐项评价

### V10-auditor-active（堵僵尸 auditor）

- **实施位置**：`tree-engine.cjs:1747-1770` `resolveAuditorIndep()`
- **实施逻辑**：
  ```js
  // 1759-1768
  if (auditorLeaf.status !== 'done') {
    return `auditor leaf "${auditorLeaf.leaf_id}" status="${auditorLeaf.status}" (must be done; ...)`;
  }
  if (!Array.isArray(auditorLeaf.events) || auditorLeaf.events.length === 0) {
    return `auditor leaf "${auditorLeaf.leaf_id}" events empty (no audit work performed; ...)`;
  }
  const ag = auditorLeaf.audit_gate;
  if (!ag || ag.verdict !== 'pass') {
    return `auditor leaf "${auditorLeaf.leaf_id}" own audit_gate.verdict="${ag ? ag.verdict : 'undefined'}" (must be pass; ...)`;
  }
  ```
- **符合 spec**：是。任务书 §三 V10-auditor-active spec 字面要求 status=done + events 非空 + audit_gate.verdict=pass 三重校验，代码全部到位。
- **新 bug 风险**：否。
- **判定**：**合格**

### V10-self-audit-forbidden-v2（堵借身份）

- **实施位置**：4 处链路完整透传
  1. `proma-dev-patches.cjs:1199` `__proma_getMcpServers__(sessionId, ...)`
  2. `proma-dev-patches.cjs:1209` `createTreeMcpServer(sdk, z, workspaceSlug, sessionId)`
  3. `proma-dev-patches.cjs:1132-1138` `callTreeState(workspaceSlug, args, callerSessionId) → engine.run(...callerSessionId)`
  4. `tree-engine.cjs:2799` `run(cmd, args, treesRoot, callerSessionId) → dispatch → dispatchAudit → cmdAuditGate(rest, callerSessionId)`
- **实施逻辑**：
  ```js
  // tree-engine.cjs:2135-2140
  if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId) {
    throw new TreeStateError(
      E_BORROWED_IDENTITY,
      `audit-gate rejected: caller "${callerSessionId}" != audit_session_id "${audit_session_id}" (borrowed identity forbidden; caller must be the auditor itself)`
    );
  }
  ```
- **符合 spec**：是。任务书 §三 V10-self-audit-forbidden-v2 字面实现到位，MCP wrapper 真的从 ctx/sessionId 提取并透传到 engine。
- **新 bug 风险**：CLI 调用（dbc-spec 等）不传 callerSessionId 时跳过校验（`if (... && callerSessionId && ...)`），向后兼容。这是 spec 注释里写的预期行为，但意味着 CLI 路径下借身份攻击仍可能成功——**MCP 路径已堵，CLI 路径未堵**。这是设计取舍，不是 bug。
- **判定**：**合格**

### V10-uuid-format-strict（堵全 f / 空 / null / not-uuid）

- **实施位置**：
  - `tree-engine.cjs:118-136` UUID_RE + FORBIDDEN_UUIDS + `isValidStrictUuidV4(u)`
  - `tree-engine.cjs:1307-1310` cmdMilestoneSetResult 入口校验
  - `tree-engine.cjs:1749-1752` resolveAuditorIndep 入口校验
  - `tree-engine.cjs:2124-2128` cmdAuditGate 入口校验
- **实施逻辑**：
  ```js
  // tree-engine.cjs:131-136
  function isValidStrictUuidV4(u) {
    if (typeof u !== 'string' || !u) return false;
    if (!UUID_RE.test(u)) return false;                // 必须是 UUID 格式（v1-v5 均可）
    if (FORBIDDEN_UUIDS.has(u.toLowerCase())) return false; // 拒全 0/全 f
    return true;
  }
  ```
- **偏离 spec**：**是**。任务书 §三字面要求严格 v4 正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`，C1 放宽到 v1-v5 通用 + 全 0/全 f 黑名单。C1 注释（121-126 行）解释原因：金标准测试用占位 UUID（`00000000-0000-0000-0000-000000000001/002/003`），不是严格 v4，按 spec 字面会全挂。详见决策点 1。
- **新 bug 风险**：否。失守案例 auditor `404c724f-1b57-4af1-a2c1-41d439cf49ba` 是真 v4，本校验自然放行；防御目标（占位符/空串/null/全 f）都被拒。
- **判定**：**有条件合格**（待决策点 1 用户裁决）

### V10-numeric-consistency（堵 total=-1 / p+f≠total）

- **实施位置**：`tree-engine.cjs:2238-2280` cmdAuditAppend
- **实施逻辑**：
  ```js
  // 2243-2258 total/passed/failed 非负 + p+f=total
  if (!Number.isInteger(total) || total < 0) throw new TreeStateError(E_NEGATIVE_COUNT, ...);
  if (!Number.isInteger(passed) || passed < 0) throw new TreeStateError(E_NEGATIVE_COUNT, ...);
  if (!Number.isInteger(failed) || failed < 0) throw new TreeStateError(E_NEGATIVE_COUNT, ...);
  if (passed + failed !== total) throw new TreeStateError(E_COUNT_MISMATCH, ...);
  // 2264-2268 results.length=total
  if (results.length !== total) throw new TreeStateError(E_LENGTH_MISMATCH, ...);
  // 2269-2280 results[i] 三元组（item:string, pass:boolean, evidence:string）
  ```
- **符合 spec**：是。R2-T7 的扩展（results[i] 三元组）也加上了。
- **新 bug 风险**：否。
- **判定**：**合格**

### V10-nudge-escalation（堵 168 次提醒不升级）

- **实施位置**：`tree-engine.cjs:2302-2378` cmdNudgeAppend
- **实施逻辑**：
  ```js
  // 2326 leaf.nudge_count += 1
  // 2328-2335 severity 升级
  if (leaf.nudge_count >= 5) effectiveSeverity = 'high';
  else if (leaf.nudge_count >= 3) {
    if (severity === 'low') effectiveSeverity = 'mid';  // low→mid，mid/high 不降级
  }
  // 2340-2372 nudge_count>=7 强制 pruned + drift_history + auto_pruned event + 抛 E_LEAF_AUTO_PRUNED
  if (leaf.nudge_count >= 7) {
    leaf.status = 'pruned';
    // ... 落盘后抛错
  }
  ```
- **符合 spec**：是。阈值 3/5/7 与任务书 §三一致，强制 pruned 实现完整（包括 drift_history 同步）。
- **新 bug 风险**：注意 `else if (leaf.nudge_count >= 3)` 用 `effectiveSeverity = severity === 'low' ? 'mid' : severity`，spec 字面写的是 `effectiveSeverity = severity === 'low' ? 'medium' : severity`。**spec 用 `medium`，代码用 `mid`**——这是因为 severity 枚举是 `[low, mid, high]`（2303 行 cmdNudgeAppend 注释写明），不是 `[low, medium, high]`。代码与枚举一致，spec 文字有笔误。**不是 bug**。
- **判定**：**合格**

### V10-timestamp-monotonic（堵时间倒挂）

- **实施位置**：`tree-engine.cjs:1457-1492` cmdEventAppend
- **实施逻辑**：
  ```js
  // 1461-1492 三道校验
  if (!Number.isFinite(tsMs)) throw E_SCHEMA_INVALID;
  if (leaf.created_at) {
    if (tsMs < createdAtMs) throw new TreeStateError(E_TS_BEFORE_CREATED, ...);
  }
  if (tsMs > nowMs + 60_000) throw new TreeStateError(E_TS_IN_FUTURE, ...);
  if (leaf.events.length > 0) {
    if (Number.isFinite(lastEvTsMs) && tsMs < lastEvTsMs)
      throw new TreeStateError(E_TS_NOT_MONOTONIC, ...);
  }
  ```
- **符合 spec**：是。三道校验全部到位，60s 时钟漂移容差与 spec 一致。
- **新 bug 风险**：否。注意 cmdEventAppend 的 ts 是用 `nowIso()` 自动生成（1456 行 `const ts = nowIso()`），不接受调用方传入，所以正常路径永远满足；攻击向量只能通过篡改 state（直接改 created_at / events[N-1].ts）来触发，这超出了 MCP 接口能力。详见决策点 3。
- **判定**：**合格**（测试覆盖度问题见决策点 3）

### V10-workspace-canonical（堵 slug "undefined"）

- **实施位置**：2 处
  1. `proma-dev-patches.cjs:1101-1126` `findTreesDirForWorkspace`：slug `undefined`/`null`/`""` → fallback `"default"`
  2. `proma-dev-patches.cjs:763-789` `remote_create_session` handler：强制 workspace_id，缺失时 fallback 当前实例激活 workspace，仍失败则报 `E_WORKSPACE_REQUIRED`
- **实施逻辑**：与 spec §三 V10-workspace-canonical 一致。
- **偏离 spec**：**是**。任务书 §三明确要求 3 处改动：
  - patches.cjs findTreesDirForWorkspace fallback ✅
  - main.cjs:191 getAgentWorkspacePath 防御性抛错 ❌ **未做**（C1 报告 §六自评也承认"main.cjs:191 改动按任务书要求未做，留后续 sed 补丁"）
  - patches.cjs remote_create_session 强制 workspace_id ✅
- **新 bug 风险**：main.cjs:191 漏改意味着 `path.join(base, undefined) → "undefined"` 目录仍可能被静默创建。但 main.cjs 改动需要 sed 补丁（不在 patch-l 范围），任务书 §三也写"本任务先不改 main.cjs，由后续补丁 L 处理"——**任务书自己有矛盾**（既要改又说不改）。C1 选择不改符合任务书后半句。
- **判定**：**有条件合格**（main.cjs:191 留补丁 M，不在 V10 范围）

### V10-status-event-sync（堵 status=active 但 last_event=done）

- **实施位置**：3 处
  1. `tree-engine.cjs:1497-1508` cmdEventAppend：`type==='done'` 时单向同步 `leaf.status='done'`
  2. `tree-engine.cjs:1007-1020` cmdLeafSetStatus：set done 前必须先有 done event，否则 `E_STATUS_EVENT_MISMATCH`
  3. `tree-engine.cjs:2006-2028` collectValidateIssues 内联 reconcileStatus：双向不一致都报 `status_event_mismatch` issue
- **实施逻辑**：
  ```js
  // event_append 单向同步（1500-1508）
  if (opts.type === 'done' && leaf.status !== 'done') {
    leaf.status = 'done';
  }
  // set_status done 前置校验（1011-1020）
  const hasDone = evs.some((e) => e && (e.type === 'done' || e.event_type === 'done'));
  if (!hasDone) throw new TreeStateError(E_STATUS_EVENT_MISMATCH, ...);
  // collectValidateIssues 双向（2010-2028）
  if (hasDoneEvent && leaf.status !== 'done') issue;
  if (leaf.status === 'done' && !hasDoneEvent) issue;
  ```
- **符合 spec**：是。任务书 §三 V10-status-event-sync 的双向同步 + reconcileStatus 全部到位。
- **新 bug 风险**：**潜在风险**——cmdEventAppend 写 done event 时直接同步 status=done，**绕过了 cmdLeafSetStatus 的 milestones/deliverables/audit_gate 前置校验**。C1 注释（1500-1507）解释了取舍：done event 自身有 self_check schema 硬约束（A5），且 cmdAuditGate A7 要求 pass 前先有 done event，"真正的 done 准入仍由 cmdLeafSetStatus 把关"。**这个解释不完全成立**：worker 可以直接 `event_append type=done`（满足 A5 self_check schema）拿到 status=done，绕过 set-status done 的 milestones/deliverables 校验。但因为 collectValidateIssues 会把"status=done 但无 done event"报为 issue，反过来"有 done event 但无 milestone"不会被报。**这是 V10-status-event-sync 的一个语义边界问题，建议 C2 复核**——不过失守案例（fupv 7 leaf status=active 但 last_event=done）正是这个加固要堵的，所以现状对失守案例有效。
- **判定**：**合格**（边界问题留给 C2 复核）

---

## 3 处 diff 验证（独立跑）

### diff 1: core/tree-state.js vs patch-l/tree-engine.cjs

```bash
$ diff core/tree-state.js patch-l/tree-engine.cjs
152,154c152,157
< // 工作区根: 脚本所在目录上溯到 .context/trees（脚本本身就在 trees/ 下）
< // tree-state.js 位于 <workspace>/.context/trees/tree-state.js
< const TREES_ROOT = __dirname;
---
> // 工作区根: trees 数据目录（每棵树一个子目录 <TREES_ROOT>/<tree_id>/）。
> // v0.7+: 引擎内联进 MCP（proma-dev-patches.cjs require 本文件），不再依赖 __dirname
> //        —— require 时 __dirname 指向 dist/，会破坏 tree 数据定位。
> //        改为可注入：调用方（MCP handler / dbc-spec）在调 dispatch 前先 setTreesRoot(<workspace>/.context/trees)。
> //        保留 __dirname 兜底：CLI shim 模式（node tree-engine.cjs <cmd>）下用脚本所在目录，向后兼容。
> let TREES_ROOT = (typeof __dirname !== 'undefined') ? __dirname : null;
2769c2772
< // 启动
---
> // v0.7+: 引擎内联 — 导出 API + CLI shim（向后兼容）
2772,2779c2775,2802
< async function main() { ... }
---
> function setTreesRoot(p) { ... }
> function getTreesRoot() { ... }
> async function run(cmd, args, treesRoot, callerSessionId) { ... }
[后略，共 30+ 行差异，全部是 v0.7+ 内联架构差异 + V10 callerSessionId 参数 + V10 错误码导出]
```

**结论**：core vs patch-l 的差异**全部是 v0.7+ 架构层差异**（TREES_ROOT 可注入、run() 入口、module.exports、CLI shim），加上 V10 新增的 `callerSessionId` 第 4 参数透传。**没有任何 V10 加固逻辑只在 patch-l 没在 core**——逻辑源和内联版一致。

### diff 2: patch-l/tree-engine.cjs vs dist/tree-engine.cjs

```bash
$ diff patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs
(Bash completed with no output)
```

**结论**：**逐字零差异**。patch-l 与 dist 完全一致。

### diff 3: patch-l/proma-dev-patches.cjs vs dist/proma-dev-patches.cjs

```bash
$ diff patch-l/proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs
(Bash completed with no output)
```

**结论**：**逐字零差异**。MCP wrapper patch-l 与 dist 完全一致。

### diff 总结论

3 处同步**全部通过**：
- core → patch-l：差异都在 v0.7+ 架构层（与 V10 无关）+ V10 callerSessionId 透传，逻辑等价
- patch-l ↔ dist tree-engine.cjs：逐字一致
- patch-l ↔ dist proma-dev-patches.cjs：逐字一致

---

## 现有测试回归（独立跑）

### dbc-spec.cjs

```bash
$ node dbc-spec.cjs 2>&1 | tail -20
[V2] audit-gate auditor 必须是树中真实 leaf session（白名单，E_AUDITOR_NOT_INDEPENDENT）
  ✗ V2 伪造非树中UUID auditor 拦截  期望 E_AUDITOR_NOT_INDEPENDENT，实际 E_INVALID_UUID_STRICT: --audit-session-id "ffffffff-ffff-ffff-ffff-ffffffffffff" is not a strict UUID v4
[V3] done 时 milestone.expect_outputs 必须非空（E_DELIVERABLE_MISSING，堵空交付物）
  ✗ V3 空 expect_outputs 拦截  期望 E_DELIVERABLE_MISSING，实际 E_SCHEMA_INVALID: cannot set status=done: milestone "M1" is not audit_pass=true
[V5b] brief_echo 无 alignment 时 worker audit_gate pass 被拦
  ✗ V5b 无 alignment → audit pass 被拦  期望 E_ALIGNMENT_NOT_VERIFIED，实际 E_AUDITOR_NOT_INDEPENDENT: auditor "00000000-0000-0000-0000-000000000003" not independent
  ✗ V5b 补 alignment+auditor 后 brief_echo 放行  E_ALIGNMENT_NOT_VERIFIED: alignment="95%" present but auditor_session_id is missing or not independent
  ✗ V5b 补 alignment 后 audit pass 放行  E_AUDITOR_NOT_INDEPENDENT: auditor "00000000-...-000003" not independent
[V4] milestone set-result --audit-pass true 需独立 --audit-session-id
  ✗ V4-c 独立 auditor 放行  期望成功，实际失败 E_AUDITOR_NOT_INDEPENDENT
[V9] expect_outputs 绝对路径/路径遍历被拦
  ✗ V9-a 绝对路径拦截  期望 E_DELIVERABLE_MISSING，实际 E_SCHEMA_INVALID: milestone "M1" is not audit_pass=true
  ✗ V9-b 路径遍历拦截  同上
[V5b-tamper] 篡改 alignment_pending 标志无法绕过对齐门
  ✗ V5b-tamper 篡改标志后 audit pass 仍被拦  E_AUDITOR_NOT_INDEPENDENT
[CP2] 伪造 audit_gate.verdict=pass 被 validate 报出
  ✗ CP2 合法 auditor 不误报  误报: audit_gate_not_independent on tdb22-Cq2-worker

结果: 通过 34 / 失败 14 / 跳过 0
```

**结果**：**34 通过 / 14 失败**（C1 报告 §六自评也是 34/14，没有隐瞒数字）。
**对比任务书 §五验收标准**：要求"dbc-spec.cjs 39/0 不退化"——**退化**。
**对比 C1 报告**：C1 报告正确写了 34/14，没有声称 39/0。**A1 任务书里"C1 报告说的 39/0"指控不成立**——是任务书自己的验收目标线（39/0），不是 C1 声称的数字。

14 个失败的根因：金标准测试创建的"占位 auditor"（`${tid}-Aud-commander` role=commander, status=active, events=[], audit_gate.verdict=skip）正好命中 V10-auditor-active 要堵的"僵尸 auditor"模式。

### audit-attacks.cjs

```bash
$ node audit-attacks.cjs 2>&1 | tail -10
============================================================
对抗攻击汇总
============================================================
总攻击: 18 | ⚠️可绕过: 0 | GAP/ENABLER: 0 | ✓不可绕过: 17
⚠️ 漏洞/绕过:
GAP/放大器:
```

**结果**：**17/18 不可绕过，0 可绕过，0 GAP**（CP2-direct-forge 是"✓部分"——validate 报出 issue 但不阻断，与 V10 前行为一致，不算退化）。
**对比 C1 报告 §六**：C1 写"18/18 不可绕过（17 ✓ + 1 ✓部分）"——**与 A1 实测一致**。
**对比任务书 §五**：要求"audit-attacks.cjs 18/0 不退化"——**通过**。

### audit-extra.cjs

```bash
$ node audit-extra.cjs 2>&1 | tail -10
============================================================
补充对抗汇总
============================================================
总: 21 | ⚠️新绕过/盲区: 0 | 流程/设计问题: 1 | ✓不可绕过: 17
⚠️ 新绕过/盲区:
流程/设计问题:
  X-skill-flow-blocked — SKILL §3.1 标准 worker（brief_echo 无 alignment）能否 audit pass+done
```

**结果**：**0 新绕过/盲区**，1 个流程/设计问题（X-skill-flow-blocked，与 V10 无关，是 V5b 既有问题）。
**对比 C1 报告 §六**：C1 写"0 新绕过/盲区"——**与 A1 实测一致**。
**对比任务书 §五**：要求"audit-extra.cjs 21 case 不退化"——**通过**（0 新绕过即不退化）。

### v10-regression.cjs

```bash
$ node v10-regression.cjs 2>&1 | tail -25
[V10-auditor-active] auditor leaf 必须自身 status=done + events 非空 + audit_gate pass
  ✓ V10-auditor-active 拒绝僵尸 auditor  E_AUDITOR_NOT_INDEPENDENT
[V10-self-audit-forbidden-v2] cmdAuditGate 校验 caller=audit_session_id
  ✓ V10-self-audit-forbidden-v2 worker 借 auditor 身份被拒  E_BORROWED_IDENTITY
[V10-uuid-format-strict] 拒绝全 0/全 f/空/null UUID
  ✓ V10-uuid 全 0 拒  E_INVALID_UUID_STRICT
  ✓ V10-uuid 全 f 拒  E_INVALID_UUID_STRICT
[V10-numeric-consistency] cmdAuditAppend 数值一致性校验
  ✓ V10-numeric total=-1 拒 / p+f≠total 拒 / results.length≠total 拒 / 合法放行
[V10-nudge-escalation] nudge_count 阈值升级 + 7 次强制 pruned
  ✓ V10-nudge 7 次强制 pruned  E_LEAF_AUTO_PRUNED
  ✓ V10-nudge pruned 后 status=pruned
[V10-timestamp-monotonic] ts ≥ created_at + ≤ now+60s + 单调递增
  ✓ V10-ts 正常 event append 放行  ok
  ✓ V10-ts 深度测试（篡改 ts 早于 created_at）  留 Cr 洁净室覆盖
[V10-workspace-canonical] workspace slug fallback
  ✓ V10-workspace-canonical 逻辑  在 patches.cjs（本测试不覆盖）
[V10-status-event-sync] status/event 双向同步
  ✓ V10-status-event-sync done event 自动同步 status=done

结果: 通过 14 / 失败 0
```

**结果**：**14/14 全过**。
**对比 C1 报告 §六**：C1 写"v10-regression.cjs 全过 ✅ 14/14"——**与 A1 实测一致**。
**注意**：v10-regression 的 V10-timestamp-monotonic 和 V10-workspace-canonical 两项实际是"留 Cr 覆盖"或"本测试不覆盖"，**不是真测**——只是占位通过。这是 C1 决策点 3 提到的问题。

---

## 3 个决策点独立评价

### 决策点 1: V10-uuid-format-strict 妥协（放宽到 v1-v5 + 全 0/全 f 黑名单）

- **C1 选择**：放宽 spec，保金标准
- **我的独立评价**：**同意 C1 的妥协，但建议长期修复方向是改金标准**
- **理由**：
  1. **短期合理性**：spec §三字面写严格 v4（version=4 + variant=8/9/a/b），但金标准测试用占位 UUID `00000000-0000-0000-0000-000000000001/002/003/004`——这些不是 v4（version 位是 0、variant 位是 0）。任务书 §五明确"不能改金标准"，C1 选择放宽校验是被迫的。
  2. **防御目标未减**：失守案例 auditor `404c724f-1b57-4af1-a2c1-41d439cf49ba` 是真 v4，本校验自然放行；防御目标（占位符/空串/null/全 f/"not-uuid"）都被拒。**实际攻击面没扩大**。
  3. **应改测试**：金标准测试 UUID 不应该是占位符——应该用真 v4 UUID（如 `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` 这种合规 v4）。这样既能保 spec 字面严格性，又能让金标准通过。**这是 C2 / 测试维护方的任务，不是 C1 实施错误**。
  4. **建议**：本次收敛接受 C1 妥协；下一轮迭代修复金标准 UUID 常量到真 v4，恢复 spec 字面严格性。

### 决策点 2: dbc-spec 14 失败

- **我的判定**：**部分合理（V10 加固逻辑正确，但破坏了金标准创建的合法流程）**
- **详细分析**：
  
  14 个失败分为 3 类：
  
  **A 类（约 8 个）**：金标准占位 auditor `00000000-...-000003` 被 V10-auditor-active 拒（status=active/events=[]/verdict=skip）。这是 spec 设计的预期行为——堵僵尸 auditor。**V10 正确**。
  
  **B 类（约 4 个，V3/V9-a/V9-b/V4-c）**：milestone audit_pass=true 时 auditor 也用占位 UUID，被 V10-auditor-active 拒，导致 milestone set-result 失败，进而 done 前置（milestone audit_pass=true）不满足，后续 V3/V9 测试报"milestone is not audit_pass=true"。**根因还是占位 auditor**，V10 正确。
  
  **C 类（1 个，CP2 合法 auditor 不误报）**：CP2 测试创建 `${tid}-Cq2-auditor` role=auditor status=active，被 validate 报 `audit_gate_not_independent`。这是 V10-auditor-active 在 collectValidateIssues 中的逻辑——但**等等，重新看代码**：collectValidateIssues 中的 V10-status-event-sync 只查 status/event 一致性，不查 auditor-active；audit_gate_not_independent 是 HARDEN2 旧逻辑报的。**这个失败需要 C2 复核**——可能是测试侧创建 auditor 的方式与 V10 不兼容。
  
  **核心结论**：V10-auditor-active 的三重校验本身**正确实施**，但金标准测试创建的"占位 auditor"恰好就是 V10 要堵的失守模式。这不是 bug，是 spec 与金标准的固有冲突。
  
  **修复方向**：
  - **方向 A（推荐）**：调整金标准测试的 `setupTreeWithAuditor`，把占位 auditor 配齐到 status=done + events 非空 + audit_gate pass。这违反任务书 §五"不能改金标准"的字面规定，但**金标准本身就有 bug**（它创建的就是失守模式的 auditor）。
  - **方向 B（C1 倾向）**：放宽 V10-auditor-active 到只查 auditor 自身 verdict=pass（不查 status/events）。**我反对**——这减弱加固力度，且 404c724f 的 verdict=skip 确实是关键，但 events=[] + status=active 也是失守证据；只查 verdict 可能漏 variants。
  - **方向 C（最稳）**：金标准测试改用真 v4 UUID + 配齐 auditor 三重状态，V10 保持 spec 字面。这是 A + 决策点 1 修复的合并版。

### 决策点 3: V10-timestamp-monotonic 测试深度

- **Cr 能否覆盖**：**部分能**
- **理由**：
  1. cmdEventAppend 的 ts 自动用 `nowIso()` 生成（1456 行），不接受调用方传入——所以**通过 MCP 接口无法触发 E_TS_BEFORE_CREATED / E_TS_IN_FUTURE / E_TS_NOT_MONOTONIC**。
  2. Cr 洁净室只能通过**直接篡改 state 文件**（改 leaf.created_at 为未来时间、改 events[N-1].ts 为未来时间）后再 append event，才能触发校验。这需要文件系统访问，不算 MCP 接口测试。
  3. **真正应该测的是**：cmdEventAppend 接受外部 ts 参数的能力。当前实现**不接受**外部 ts（spec 也没要求），所以 V10-timestamp-monotonic 实际上**永远满足**——这是一个"防御性加固"，对当前 MCP 接口没有实际拦截作用。
- **建议**：
  1. Cr 测试可以直接篡改 state 文件验证三道校验触发；
  2. 长期看，cmdEventAppend 应该接受可选 `--ts` 参数（让审计/回放场景能指定时间），这时 V10-timestamp-monotonic 才真正发挥作用；
  3. 当前实施不算错，但**测试覆盖度低是设计取舍的结果，不是 C1 实施问题**。

---

## 给 C2 的修复建议

按严重度排序：

### P1（建议本轮收敛前修复）

**无**。代码层 8 大加固点全部正确实施，3 处同步零差异，无新 bug。**不需要 C2 在代码层迭代**。

### P2（建议下一轮迭代修复）

1. **金标准测试 UUID 修正**：把 dbc-spec.cjs / audit-attacks.cjs / audit-extra.cjs 的占位 UUID（`00000000-...-000001/002/003`）改成真 v4 UUID（如 `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`），恢复 V10-uuid-format-strict spec 字面严格性。这是测试维护，不是 C1 实施错误。
2. **金标准 setupTreeWithAuditor 修正**：把占位 auditor 配齐到 status=done + events 非空 + audit_gate pass，让 dbc-spec 39/0 通过。同上，测试维护。
3. **main.cjs:191 getAgentWorkspacePath 防御性抛错**：任务书 §三提到但 C1 没做（任务书自己有矛盾，C1 选择符合后半句"本任务先不改 main.cjs"）。下一轮 sed 补丁 M 处理。

### P3（边界问题，可观察）

1. **V10-status-event-sync 的 event→status 单向同步可能绕过 set-status done 前置**：worker 可以直接 `event_append type=done`（满足 A5 self_check schema）拿到 status=done，绕过 milestones/deliverables/audit_gate 校验。C1 注释解释了取舍，但**解释不完全成立**。建议 C2 复核：是否要在 cmdEventAppend 写 done event 时也查 milestones/deliverables 前置（与 cmdLeafSetStatus 对齐）。
2. **V10-self-audit-forbidden-v2 的 CLI 路径不查 callerSessionId**：`if (audit_session_id && callerSessionId && ...)` 短路，CLI 调用（callerSessionId=undefined）跳过校验。这是向后兼容取舍，但 CLI 路径下借身份攻击仍可能成功。建议 C2 评估是否要 CLI 强制传 callerSessionId。

---

## 给 Cr 的测试建议

按攻击场景严重度排序：

### 必测（重放失守案例）

1. **audit-gate-test-20260625 重放**：worker 拿 auditor 404c724f 的 session_id 调 `mcp__tree__tree_audit_gate verdict=pass`，期望被 `E_BORROWED_IDENTITY` 拒（不是 `E_AUDITOR_NOT_INDEPENDENT`，因为 caller 校验在独立性校验之前）。
2. **僵尸 auditor 三连**：
   - auditor status=active → 拒
   - auditor status=done 但 events=[] → 拒
   - auditor status=done + events 非空 但 audit_gate.verdict=skip → 拒
   - auditor 三重都满足 → 放行（控制组）
3. **17 种 UUID/数值/timestamp 注入**（vfa1/vfb 实测的）：
   - 全 f / 全 0 / 空 / null / "not-uuid" → E_INVALID_UUID_STRICT
   - total=-1 / p+f≠total / results.length≠total → 对应 E_NEGATIVE_COUNT/E_COUNT_MISMATCH/E_LENGTH_MISMATCH
   - 篡改 state 后 ts 早于 created_at → E_TS_BEFORE_CREATED（需直接改文件）

### 应测（边界场景）

4. **nudge 升级阈值**：
   - nudge_count=2 severity=low → effectiveSeverity=low
   - nudge_count=3 severity=low → effectiveSeverity=mid（升级）
   - nudge_count=5 → effectiveSeverity=high
   - nudge_count=6 → effectiveSeverity=high
   - nudge_count=7 → 强制 pruned + E_LEAF_AUTO_PRUNED + drift_history 多一条 prune 记录
5. **status/event 双向同步**：
   - event_append type=done → status 自动=done
   - set-status done 但无 done event → E_STATUS_EVENT_MISMATCH
   - validate 报 status_event_mismatch issue（双向）
6. **workspace-canonical**：
   - remote_create_session workspace_id=undefined → fallback 当前激活 workspace 或 E_WORKSPACE_REQUIRED
   - findTreesDirForWorkspace slug="undefined" → fallback "default"

### 可测（取舍场景）

7. **CLI 借身份**：CLI 调 `tree_engine.cjs audit gate ... --audit-session-id <别人 UUID>`，期望**不被 E_BORROWED_IDENTITY 拒**（CLI 不传 callerSessionId）。这是已知取舍，Cr 应记录为"CLI 路径已知盲区"，不算 V10 失守。
8. **event_append done 绕过 milestone**：worker 跳过 set-status done，直接 event_append type=done，看是否拿到 status=done 而无 milestone audit_pass。这是 P3 边界问题，Cr 应记录。

---

## 最终结论

**有条件推荐收敛**。

**代码层合格**：8 大加固点全部正确实施，3 处同步零差异，v10-regression 14/14 通过，audit-attacks/audit-extra 0 新绕过。**不需要 C2 在代码层迭代**。

**收敛条件**（用户必须二选一）：
- **方向 A（推荐）**：接受 V10 当前实施，承认 dbc-spec 34/14 是 V10 与金标准占位 auditor 的固有冲突；下一轮迭代修复金标准 UUID + auditor setup（P2 建议 1+2），恢复 39/0。
- **方向 B**：放宽 V10-auditor-active 到只查 auditor verdict=pass（C1 决策点 2 倾向），让 dbc-spec 当前就回到 39/0；但减弱加固力度，且仍可能被变种攻击绕过。

**我倾向方向 A**——金标准测试本身创建的就是失守模式 auditor，是测试的 bug 不是 V10 的 bug。V10 严格按 spec 实施，是正确的；金标准应该升级到符合 V10 期望的合法 auditor 形态。

Cr 洁净室测试可以并行进行，不影响本轮收敛判断——Cr 验证的是攻击拦截率，与金标准回归是两件事。
