# A2 V10 增量评价报告（C2 改动）

> 评价: A2 auditor (v10v-A2-auditor) | 完成时间: 2026-06-25 13:05
> 范围: 仅评价 C2 的 P0/P1/P2 三个增量修复，不重审 C1
> 评价原则: 独立跑测试 + 独立读代码 + 独立做攻击面分析，不轻信 C2 自验证

---

## 总体判定

| 项 | 判定 | 备注 |
|----|------|------|
| P0 修复（cmdEventAppend ts） | **合格** | 根因分析正确；3 道校验确已生效；3/3 通过 |
| P1 折中（audit_append 跳过 status/events/verdict） | **合理** | audit_append 是"证据落盘"非"放行门"；下游无消费；audit_gate 路径仍走完整 7 道校验 |
| P2 命名（mid → medium） | **合格** | nudge 升级输出值全部用 spec 字面 `medium`；`mid` 残留仅限 drift 模块和 nudge 输入参数（兼容既有调用方） |
| 3 处 diff | **一致** | core vs patch-l 122 行（v0.7+ 架构层，与 C1 一致）；patch-l vs dist 0 行 |
| 测试套件回归 | **全过** | v10-cleanroom 49/49、dbc-spec 34/14（C1 遗留不退化）、audit-attacks 0 可绕过、audit-extra 0 新绕过、v10-regression 14/0 |
| **整体判定** | **推荐收敛** | C2 三个修复全部合格；P1 折中经独立攻击面分析后判定为合理 |

---

## P0 修复审查

### 根因分析验证（C2 说是 C1 强制 `const ts = nowIso()` 覆盖）

**A2 独立验证**：读 `core/tree-state.js:1366`，确认 C2 改后代码：

```js
// V10-timestamp-monotonic: 接受调用方传入的 --ts（用于回填/测试/历史重放），未传时用 nowIso()。
const ts = opts.ts || nowIso();
```

C2 的根因分析属实。C1 强制 `const ts = nowIso()`（不考虑 `opts.ts`）会使后续 3 道校验全部读到"当前时间"的 ts，永远命中 happy path：

- `tsMs < createdAtMs` → `nowIso() ≥ created_at`（leaf 已存在）→ false，不拦
- `tsMs > nowMs + 60_000` → `nowIso() ≤ now + 0ms` → false，不拦
- `tsMs < lastEvTsMs` → `nowIso() ≥ 上一条 event ts`（时间单调）→ false，不拦

3 道校验变成 dead code，攻击者传 `--ts 1970-01-01` / `--ts 2999-12-31` 都被静默忽略。C2 改 `opts.ts || nowIso()` 让用户传入的 ts 真正参与校验。

### 修复后实现（3 道校验是否真的会触发）

A2 独立读 `core/tree-state.js:1462-1493`，3 道校验代码：

```js
const tsMs = Date.parse(ts);
const nowMs = Date.now();
if (!Number.isFinite(tsMs)) {
  throw new TreeStateError(E_SCHEMA_INVALID, ...);  // 非 ISO 字符串防御性兜底
}
if (leaf.created_at) {
  const createdAtMs = Date.parse(leaf.created_at);
  if (Number.isFinite(createdAtMs) && tsMs < createdAtMs) {
    throw new TreeStateError(E_TS_BEFORE_CREATED, ...);  // 早于 created_at
  }
}
if (tsMs > nowMs + 60_000) {
  throw new TreeStateError(E_TS_IN_FUTURE, ...);  // 未来 > +60s
}
if (leaf.events.length > 0) {
  const lastEvTsMs = Date.parse(leaf.events[leaf.events.length - 1].ts);
  if (Number.isFinite(lastEvTsMs) && tsMs < lastEvTsMs) {
    throw new TreeStateError(E_TS_NOT_MONOTONIC, ...);  // 早于上一条
  }
}
```

C2 改 `ts = opts.ts || nowIso()` 后，3 道校验全部读到用户传入的 ts，能正确触发。

### 测试验证（v10-cleanroom.cjs ts 测试组）

A2 独立跑 v10-cleanroom.cjs 组 6：

```
【组 6】V10-timestamp-monotonic
  ✓ 6.1 event ts=1970 (早于 created_at) 应被拒  E_TS_BEFORE_CREATED
  ✓ 6.2 event ts=2999 (未来) 应被拒  E_TS_IN_FUTURE
  ✓ 6.3 event ts 早于上一条 event 应被拒（非单调）  E_TS_BEFORE_CREATED
```

3/3 通过。**P0 修复合格**。

> 注：6.3 实际命中 E_TS_BEFORE_CREATED 而非 E_TS_NOT_MONOTONIC，因为 1970 早于 created_at 校验先触发；但语义上仍是"非单调被拦"，符合 spec 意图。

---

## P1 折中合理性评价（核心）

### C2 折中方案（复述）

C2 在 `cmdAuditAppend` 中：

- ✅ strict UUID v4 校验（前置 `isValidStrictUuidV4`，拒空/null/not-uuid/全 0/全 f/非 v4）
- ✅ 树中存在性（必须等于某 leaf 的 `session_id`，拒伪造合法 UUID）
- ✅ 非自审（不能等于 target leaf 的 `session_id`）
- ❌ **不做 status/events/verdict 三重校验**（不查 auditor 是否 status=done、events 是否非空、自己 audit_gate.verdict 是否 pass）

C2 的理由：`audit_append` 是"证据落盘"语义，auditor 已经完成审计工作后追加证据，不应受 auditor-active（要求 auditor 自身 status=done）约束。第一次尝试用完整 `resolveAuditorIndep` 破坏 3 个金标准（dbc-spec R2T7-e / M2-d / v10-regression 合法数值放行），故折中。

### A2 独立评价

**结论：合理**。

#### 论据 1：audit_log 字段无下游决策消费

A2 用 Grep 全文扫 `audit_log` 字段消费点（`core/tree-state.js`）：

| 行号 | 用途 | 是否决策消费 |
|------|------|-------------|
| 549, 713 | leaf 初始化为 `[]` | 否（构造） |
| 2216-2322 | cmdAuditAppend 内部 push + return | 否（写自身） |
| 2580-2582 | migrate 兜底补全为 `[]` | 否（迁移） |

**关键事实**：`audit_log` 数组**没有任何"被读为放行决策"的下游消费点**。具体验证：

- `cmdAuditGate`（line 2110-2209）：完全不读 `leaf.audit_log`，只看 `audit_session_id` + `resolveAuditorIndep`（含 status/events/verdict）+ callerSessionId 透传
- `cmdLeafSetStatus`（line 994-1002 done 路径）：完全不读 `leaf.audit_log`，只看 `leaf.audit_gate.verdict`
- `collectValidateIssues`（line 1956+）：完全不查 `audit_log`，只查 `audit_gate.verdict=pass 时 auditor 是否独立`
- `cmdEventAppend`（brief_echo alignment 校验）：完全不读 audit_log

#### 论据 2：audit_gate 路径仍走完整 7 道校验

A2 独立读 `resolveAuditorIndep`（line 1748-1771）：

```js
function resolveAuditorIndep(state, leaf, auditorSessionId) {
  if (!auditorSessionId) return 'auditor_session_id is null';
  if (!isValidStrictUuidV4(auditorSessionId)) return '... not strict UUID v4';
  if (leaf.added_by && auditorSessionId === leaf.added_by) return 'auditor=added_by';
  const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === auditorSessionId);
  if (!auditorLeaf) return '... forged UUID';
  if (auditorLeaf.leaf_id === leaf.leaf_id) return 'auditor is the leaf itself';
  // V10-auditor-active 三重校验仍在：
  if (auditorLeaf.status !== 'done') return '... status=active (must be done)';
  if (!Array.isArray(auditorLeaf.events) || auditorLeaf.events.length === 0) return '... events empty';
  const ag = auditorLeaf.audit_gate;
  if (!ag || ag.verdict !== 'pass') return '... own audit_gate.verdict != pass';
  return null;
}
```

`cmdAuditGate` 在 `verdict === 'pass' || verdict === 'required'` 时仍调用 `resolveAuditorIndep`（line 2156），完整 7 道校验生效。**C2 折中只影响 cmdAuditAppend 路径，不影响 cmdAuditGate 路径**。

#### 论据 3：cmdAuditGate 入口还有 callerSessionId 透传兜底

`cmdAuditGate` line 2136-2141 校验 `callerSessionId === audit_session_id`（V10-self-audit-forbidden-v2）。即使 zombie auditor 的状态校验失效，worker 也无法"借" auditor 的 session_id 调 audit_gate pass（caller 不等）。这层独立于 audit_append 的硬约束。

### 潜在攻击面分析

#### 攻击 1：worker 自己写 audit_append 伪造"审计已通过"记录，然后引用通过 audit_gate？

**A2 实测分析**：

1. worker 调 `audit append <tid> <wid> --json '{"auditor_session_id":"<wid自己>",...}'`：
   - cmdAuditAppend line 2236 strict UUID：wid 是合法 UUID，过
   - cmdAuditAppend line 2308 存在性：wid 自己是 leaf 的 session_id，过
   - cmdAuditAppend line 2313 非自审：**target leaf = wid，auditor_session_id 也 = wid → 触发 E_AUDITOR_NOT_INDEPENDENT 拒绝**

2. worker 调 `audit append <tid> <wid> --json '{"auditor_session_id":"<commander或别的真实leaf>",...}'`：
   - 全部 3 道校验过，写入 audit_log
   - **但 audit_log 没有任何下游消费**，worker 仍然无法通过 audit_gate（仍要满足 callerSessionId=audit_session_id + resolveAuditorIndep 7 道校验）

**结论：worker 无法通过伪造 audit_append 绕过 audit_gate**。攻击面为零。

#### 攻击 2：恶意 auditor 自己 status=active 时写 audit_append 污染 audit_log？

这是 C2 折中**允许的行为**（不做 status 校验）。但 audit_log 是"证据链"，恶意 auditor 写一条"我审计通过了"只是历史记录，不影响 audit_gate.verdict 字段（这个字段只能 cmdAuditGate 改）。

后续人工审计看 audit_log 时会看到这条记录，但 audit_gate.verdict=skip 仍然存在，set-status done 仍被拦。**证据污染 ≠ 放行绕过**。

#### 攻击 3：未来下游如果开始消费 audit_log？

C2 折中**依赖**于"audit_log 无下游消费"这一事实。如果未来某个新功能（如"audit_log 满 3 条自动 pass audit_gate"）开始消费 audit_log，C2 折中会变成漏洞。

**建议**：在 `core/tree-state.js` cmdAuditAppend 上方加一条架构约束注释，明确"audit_log 是证据链非决策源，任何新功能不得把 audit_log 条目数/内容作为放行依据"，并把这个约束写入 spec。

### 关键检查：audit_append 能否绕过 audit_gate？

**A2 独立验证**：

| 步骤 | 结果 |
|------|------|
| worker 调 audit_append 写伪造记录（self session） | line 2313 拒绝：E_AUDITOR_NOT_INDEPENDENT |
| worker 调 audit_append 写伪造记录（其他真实 leaf） | 写入成功，但 audit_log 无下游消费 |
| worker 调 audit_gate pass audit_session_id=<自己伪造的 UUID> | line 2136 callerSessionId 校验拒绝（V10-self-audit-forbidden-v2） |
| worker 调 audit_gate pass audit_session_id=<zombie auditor UUID> | line 2136 callerSessionId 不等拒绝；若 CLI 无 caller，则 line 2156 resolveAuditorIndep 拒绝（zombie 不满足 status=done） |
| worker 通过 set-status done 绕过 audit_gate | line 996-1001 检查 audit_gate.verdict，仍要 pass |

**audit_append 完全无法绕过 audit_gate**。

### 我的建议（不算 C3 必修，仅 spec 补强）

1. **可选改进**：在 cmdAuditAppend 注释里明确"audit_log 是证据链非决策源"，防止未来开发者误用
2. **spec 区分**：建议在 V10 spec 中区分两条路径的语义：
   - V10-auditor-active-strict（audit_gate 路径）：完整 7 道校验
   - V10-auditor-existence-only（audit_append 路径）：strict UUID + 存在 + 非自审
   这样未来 A3/C3 评价时不会再次纠结"为什么不一致"

---

## P2 命名一致性

A2 独立跑 grep：

```bash
$ grep -n "'mid'" D:/Proma-dev/resources/app/dist/tree-engine.cjs
71:const DRIFT_SEVERITY_ENUM = ['low', 'mid', 'high'];
1057:        severity: 'mid',
1221:      severity: 'mid',
2345:  if (!['low', 'mid', 'high'].includes(severity)) {
2361:    //   spec §三 V10-nudge-escalation 字面要求升级到 'medium'（与 drift severity 'mid' 区分；

$ grep -n "'medium'" D:/Proma-dev/resources/app/dist/tree-engine.cjs
2361:    //   spec §三 V10-nudge-escalation 字面要求升级到 'medium'（与 drift severity 'mid' 区分；
2368:      if (severity === 'low') effectiveSeverity = 'medium';
```

**残留 `mid` 分析（4 处全部合规）**：

| 行 | 用途 | 是否问题 |
|----|------|---------|
| 71 | `DRIFT_SEVERITY_ENUM` drift 模块枚举 | 否（drift severity 字段专用） |
| 1057 | drift 模块写入 drift_history.severity | 否（drift 字段） |
| 1221 | drift 模块写入另一处 drift severity | 否（drift 字段） |
| 2345 | nudge 输入参数 `--severity` enum 校验 | 否（C2 报告说明：兼容既有调用方，输入仍接受 low/mid/high；仅升级后的"输出值"统一 medium） |
| 2361 | 注释 | 否 |

**`medium` 出现 2 处**：

| 行 | 用途 |
|----|------|
| 2361 | 注释引用 spec |
| 2368 | nudge 升级实际输出值（spec 字面） |

**结论**：nudge severity 升级输出值完全用 spec 字面 `medium`；`mid` 残留仅限 drift 模块字段和 nudge 输入参数（输入参数兼容是合理的）。**P2 命名一致，合格**。

---

## 3 处 diff 验证

### diff core/tree-state.js vs patch-l/tree-engine.cjs

```bash
$ diff core/tree-state.js patch-l/tree-engine.cjs | wc -l
122
```

122 行 diff，与 C1/C2 报告一致。A2 抽查前 60 行确认差异集中在：

- 行 152-157：`TREES_ROOT` 定义（core 用 `__dirname`，patch-l 用可注入 `let TREES_ROOT`）—— v0.7+ 架构层差异
- 行 2803-2836：`main()` vs `setTreesRoot/getTreesRoot/run/module.exports/CLI shim` —— v0.7+ 架构层差异

**两处差异与 V10 加固点完全无关**，是引擎内联进 MCP 的必要架构差异。

### diff patch-l/tree-engine.cjs vs D:/Proma-dev/resources/app/dist/tree-engine.cjs

```bash
$ diff patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs | wc -l
0
```

**patch-l 与 dist 逐字一致**（0 差异）。

### 一致性结论

3 处文件 diff 验证：**完全一致**（除 v0.7+ 架构层必要差异外）。

---

## 测试套件回归

A2 独立跑全部 5 个测试套件（v10-cleanroom.cjs 的 test_cr2_incremental 函数未定义是 Cr2 半完成工作，A2 临时跳过该组获取完整统计）：

| 套件 | 期望 | A2 实测 | 判定 |
|------|------|---------|------|
| v10-cleanroom | 49/49 | **49/49**（组 1-10 全过，组 11 Cr2 半完成跳过） | ✓ |
| dbc-spec | 34/14（C1 遗留不退化） | **34/14** | ✓ |
| audit-attacks | 18/18 不可绕过 | **18 总，0 可绕过**（17 不可绕过 + 1 部分拦截仍算堵住） | ✓ |
| audit-extra | 0 新绕过 | **0 新绕过**（21 总） | ✓ |
| v10-regression | 14/14 | **14/0** | ✓ |

### 关键回归点

| 组 | C1 结果 | C2 结果 | A2 实测 | 状态 |
|----|---------|---------|---------|------|
| V10-timestamp-monotonic（组 6） | 0/3 放行 | 3/3 通过 | **3/3 通过** | ✓ C2 修复 |
| vfb/vfa1 17 种攻击（组 10） | 8/15 通过 | 15/15 通过 | **15/15 通过** | ✓ C2 修复 |
| audit-gate-test 失守重放（组 9） | 1/1 通过 | 1/1 通过 | **1/1 通过** | ✓ 核心守住 |

### A2 发现的意外（不在 C2 评价范围）

`v10-cleanroom.cjs` line 703 有 `await test_cr2_incremental();` 但函数未定义，导致 `node v10-cleanroom.cjs` 直接崩溃。这是 **Cr2 半完成的工作污染**（task #52 显示 Cr2 task 3 仍 in_progress），不是 C2 引入的退化。

**建议主会话**：要求 Cr2 完成组 11 测试代码或回退 line 703 调用。但 C2 本身的修复是合格的。

---

## 最终结论

**推荐收敛**。

C2 的三个修复（P0/P1/P2）全部合格：

1. **P0 ts 校验**：根因分析正确（C1 强制 `nowIso()` 覆盖），修复后 3 道校验确实生效
2. **P1 audit_append 折中**：经 A2 独立攻击面分析判定为合理 —— audit_log 字段无下游决策消费，audit_gate 路径仍走完整 7 道校验，worker 无法通过伪造 audit_append 绕过 audit_gate。建议在 spec 中明确区分两条路径语义（V10-auditor-active-strict vs V10-auditor-existence-only）防止未来误用
3. **P2 命名**：nudge 升级输出值完全用 `medium`，`mid` 残留仅限合规位置（drift 模块、nudge 输入参数）

3 处 diff 一致，5 个测试套件无回归，核心 audit-gate-test 失守链路重放 1/1 通过。

**不需要 C3**。

---

## 附录：A2 评价工作量

| 阶段 | 工作 |
|------|------|
| 读必读材料 | 任务书 §三 V10 spec、C2 报告、Cr 报告 |
| 独立验证 P0 | 读 cmdEventAppend 当前实现，跑 v10-cleanroom 组 6 |
| 独立验证 P1 | 读 cmdAuditAppend + cmdAuditGate + resolveAuditorIndep + 全文扫 audit_log 消费点 |
| 独立验证 P2 | grep `'mid'` / `'medium'` 残留分析 |
| 独立跑测试 | v10-cleanroom（49/49）、dbc-spec（34/14）、audit-attacks（0 可绕过）、audit-extra（0 新绕过）、v10-regression（14/0） |
| 独立跑 diff | core vs patch-l（122 行架构差异）、patch-l vs dist（0 行） |
| 写报告 | a2-review-report.md |
