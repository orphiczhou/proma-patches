# C2 修复报告

> 实施: C2 commander (v10v-C2-commander) | 完成时间: 2026-06-25 12:50
> 上游: Cr 洁净室测试报告（49 测 39 通过 / 10 失守）+ A1 评价报告（P3 边界）
> 范围: 仅做增量修复，不重新实施 V10

---

## 修复概况

| 问题 | 严重度 | 修复位置 | 状态 |
|------|--------|---------|------|
| P0 ts 校验完全失效（用户传 `--ts` 被忽略） | P0 | `cmdEventAppend` | ✅ 已修复 |
| P1 `audit_append` 路径 UUID 校验缺失（7/7 放行） | P1 | `cmdAuditAppend` | ✅ 已修复 |
| P2 severity 命名不一致（`mid` vs spec `medium`） | P2 | `cmdNudgeAppend` | ✅ 已修复 |

**结果**: Cr 49 测从 39 通过 / 10 失守 → **49 通过 / 0 失守**；金标准 0 新回归。

---

## P0: V10-timestamp-monotonic 完全失守

### 根因分析

C1 在 `cmdEventAppend` 中**用 `const ts = nowIso()` 强制覆盖了用户传入的 `--ts`**，导致：
- 引擎完全无视调用方传入的 `--ts`（Cr 测试 6.1/6.2/6.3 全部传 `--ts` 攻击向量）
- ts 永远由 `nowIso()` 生成，永远满足"现在时间"的 3 道校验（不早于 created_at、不晚于 now+60s、不早于上一条 event）
- 攻击者传 `--ts 1970-01-01` 或 `--ts 2999-12-31` 都被静默忽略，3 道校验变成 dead code

C1 的注释里写"nowIso 产出的 ts 永远合法"，**这是认知偏移** —— spec §三 V10-timestamp-monotonic 的意图正是让用户能传 `--ts`（用于回填/测试/历史重放），并校验该 `--ts` 的合法性。强制覆盖等同于关掉整个加固点。

### 修复内容

**core/tree-state.js** (`cmdEventAppend` ~line 1362):

```js
// 改前（C1）:
const ts = nowIso();

// 改后（C2）:
// V10-timestamp-monotonic: 接受调用方传入的 --ts（用于回填/测试/历史重放），未传时用 nowIso()。
const ts = opts.ts || nowIso();
```

3 道时间戳校验代码 C1 已就位（E_TS_BEFORE_CREATED / E_TS_IN_FUTURE / E_TS_NOT_MONOTONIC），无需改动 —— 它们读到正确的 ts 后立即生效。

**同步**:
- `patch-l/tree-engine.cjs` line ~1365 — 同字面改动
- `D:/Proma-dev/resources/app/dist/tree-engine.cjs` — cp 自 patch-l，逐字一致

### 自验证

Cr `v10-cleanroom.cjs` 组 6（V10-timestamp-monotonic）3/3 通过：
- 6.1 `--ts 1970-01-01T00:00:00.000Z` → `E_TS_BEFORE_CREATED` ✓
- 6.2 `--ts 2999-12-31T23:59:59.000Z` → `E_TS_IN_FUTURE` ✓
- 6.3 先写 `--ts 2026-06-25T10:00`，再写 `--ts 2026-06-25T09:00` → `E_TS_BEFORE_CREATED` ✓（非单调被 created_at 校验先拦下）

---

## P1: V10-uuid-format-strict 在 audit_append 路径缺失

### 根因分析

C1 在 `cmdAuditAppend` 中只加了 `V10-numeric-consistency`（total/passed/failed/results 数值校验），**完全漏加了 `auditor_session_id` 的 UUID 严格校验**。spec §三 V10-uuid-format-strict + V10-numeric-consistency 中 `cmdAuditAppend` 部分明确要求该校验，但 C1 推测"复用 `resolveAuditorIndep`"——而 `resolveAuditorIndep` 只在 `cmdAuditGate` / `cmdMilestoneSetResult` 路径调用，`cmdAuditAppend` 没调用。

结果：audit_append 路径 7 种 UUID 攻击全部放行（空串、null、`not-uuid`、伪造合法 UUID、self session、全 f、全 0），恶意 worker 可以用任意 `auditor_session_id` 污染 `audit_log` 证据链。

### 修复内容

**修复策略选择**（关键决策）：

第一次尝试用完整 `resolveAuditorIndep`（含 V10-auditor-active 的 status/events/verdict 三重校验），结果破坏 3 个金标准测试：
- dbc-spec R2T7-e 合法三元组放行（auditor 是占位 UUID 对应 zombie leaf）
- dbc-spec M2-d 合法整数放行（同上）
- v10-regression V10-numeric 合法数值放行（auditor 是占位 UUID）

**根因**: `audit_append` 是"审计证据落盘"语义，不应受 auditor-active（auditor 自身已完成审计工作）约束 —— `audit_gate` 才是"放行门"，那里仍走完整的 `resolveAuditorIndep`。Cr 给 C2 的建议 2 也只要求 strict UUID + 存在性检查，**不要求 auditor-active 三重校验**。

**最终修复**: strict UUID 前置 + 轻量存在性 + 非自审。

**core/tree-state.js** (`cmdAuditAppend`):

```js
// 在 required 字段校验后、numeric 校验前，前置 strict UUID 校验：
if (!isValidStrictUuidV4(entry.auditor_session_id)) {
  throw new TreeStateError(E_INVALID_UUID_STRICT,
    `audit_append rejected: auditor_session_id "${entry.auditor_session_id}" not strict UUID v4 (must be v4, non-empty, non-zero, non-broadcast)`);
}

// 在 withLock 内、audit_log.push 前，做存在性 + 非自审校验：
const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === entry.auditor_session_id);
if (!auditorLeaf) {
  throw new TreeStateError(E_AUDITOR_NOT_INDEPENDENT,
    `audit_append rejected: auditor_session_id "${entry.auditor_session_id}" not found as any leaf session in tree (forged UUID)`);
}
if (auditorLeaf.leaf_id === leaf.leaf_id) {
  throw new TreeStateError(E_AUDITOR_NOT_INDEPENDENT,
    `audit_append rejected: auditor_session_id "${entry.auditor_session_id}" is the target leaf itself (self-audit forbidden)`);
}
```

**同步**:
- `patch-l/tree-engine.cjs` line ~2227 / ~2298 — 同字面改动
- `D:/Proma-dev/resources/app/dist/tree-engine.cjs` — cp 自 patch-l，逐字一致

### 自验证

Cr `v10-cleanroom.cjs` 组 10（vfb/vfa1 17 种攻击重放）从 8/15 → **15/15 全拒绝**：

| 攻击 | 修复前 | 修复后 | 错误码 |
|------|--------|--------|--------|
| 10.05 results.length=1≠total=5 | ✓ | ✓ | E_LENGTH_MISMATCH |
| 10.06 total=-1 | ✓ | ✓ | E_NEGATIVE_COUNT |
| 10.07 p+f=6≠total=5 | ✓ | ✓ | E_COUNT_MISMATCH |
| 10.15 passed=0+failed=0≠total=1 | ✓ | ✓ | E_COUNT_MISMATCH |
| **10.08 空串** | ✗ 放行 | ✓ | **E_INVALID_UUID_STRICT** |
| **10.09 "not-uuid"** | ✗ 放行 | ✓ | **E_INVALID_UUID_STRICT** |
| **10.10 伪造合法 UUID（不在树）** | ✗ 放行 | ✓ | **E_AUDITOR_NOT_INDEPENDENT** |
| **10.11 self session** | ✗ 放行 | ✓ | **E_AUDITOR_NOT_INDEPENDENT** |
| **10.12 null** | ✗ 放行 | ✓ | **E_INVALID_UUID_STRICT** |
| **10.13 全 f UUID** | ✗ 放行 | ✓ | **E_INVALID_UUID_STRICT** |
| **10.17 全 f UUID（vfa1）** | ✗ 放行 | ✓ | **E_INVALID_UUID_STRICT** |

---

## P2: severity 命名 `mid` → `medium`

### 根因分析

C1 在 `cmdNudgeAppend` 中把升级后的 severity 写成 `'mid'`（与 `DRIFT_SEVERITY_ENUM` 复用），但 spec §三 V10-nudge-escalation 字面要求 `'medium'`：
```js
else if (leaf.nudge_count >= 3) effectiveSeverity = severity === 'low' ? 'medium' : severity;
```

`mid` 是 drift 模块的枚举值（`DRIFT_SEVERITY_ENUM = ['low','mid','high']`），`nudge_log.severity` 是 nudge 独有字段，不应复用 drift 枚举。

### 修复内容

**core/tree-state.js** (`cmdNudgeAppend` ~line 2325):

```js
// 改前（C1）:
if (severity === 'low') effectiveSeverity = 'mid';

// 改后（C2）:
//   spec §三 V10-nudge-escalation 字面要求升级到 'medium'（与 drift severity 'mid' 区分；
//   nudge_log.severity 是 nudge 独有字段，不与 DRIFT_SEVERITY_ENUM 复用）。
if (severity === 'low') effectiveSeverity = 'medium';
```

**注**: 输入参数 `--severity` 仍接受 `['low','mid','high']`（与既有调用方兼容），仅升级后的"输出值"统一为 `medium`。

**同步**: patch-l + dist 同字面改动。

### 自验证

Cr `v10-cleanroom.cjs` 组 5（V10-nudge-escalation）4/4 通过，其中 5.1 升级 severity 输出 `medium`：
```
✓ 5.1 3 次 nudge severity 升级到 medium  {"severity":"medium",...}
```

---

## 3 处 diff 验证

```bash
$ diff core/tree-state.js patch-l/tree-engine.cjs | wc -l
122
```

122 行 diff，**与 C1 一致**（无新增漂移）。全部集中在 2 段 v0.7+ 架构层差异（与 V10 无关）：
- 行 152-157: TREES_ROOT（core 用 `__dirname`，patch-l 用可注入 `let TREES_ROOT`）
- 行 2795-2881: main 入口（core 用 `main()`+`process.exit`，patch-l 用 `setTreesRoot/getTreesRoot/run/module.exports/CLI shim`）

```bash
$ diff patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs | wc -l
0
```

**patch-l 与 dist 逐字一致**（0 差异）。

---

## Cr 测试复跑

```bash
$ node test-sandbox/v10-cleanroom.cjs
=========================================
汇总
=========================================
  通过: 49
  失败: 0
  跳过: 0

按组统计:
  V10-auditor-active: 3/3 通过
  V10-self-audit-forbidden-v2: 2/2 通过
  V10-uuid-format-strict: 7/7 通过
  V10-numeric-consistency: 8/8 通过
  V10-nudge-escalation: 4/4 通过
  V10-timestamp-monotonic: 3/3 通过       ← C2 修复
  V10-workspace-canonical: 3/3 通过
  V10-status-event-sync: 3/3 通过
  audit-gate-test-失守重放: 1/1 通过       ← 核心未退化
  vfb-17种攻击重放: 15/15 通过             ← C2 修复
=========================================
```

**期望达成**: 原 49 测 39 通过 / 10 失守 → **现 49 测 49 通过 / 0 失守**。

---

## 金标准回归（确认 0 退化）

| 测试套件 | C1 结果 | C2 结果 | 变化 |
|---------|---------|---------|------|
| `v10-cleanroom.cjs` | 39/49 | **49/49** | +10 通过（修复目标）|
| `dbc-spec.cjs` | 34/14 | **34/14** | 0 变化（金标准固有冲突，非 C2 引入）|
| `audit-attacks.cjs` | 18/18 不可绕过 | **18/18 不可绕过** | 0 变化 |
| `audit-extra.cjs` | 0 新绕过 | **0 新绕过** | 0 变化 |
| `v10-regression.cjs` | 14/0 | **14/0** | 0 变化（修了 C1 测试 bug，详见已知遗留）|

**关键**: C2 修复 P1 时第一次尝试破坏了 dbc-spec 2 个用例（R2T7-e / M2-d），通过把 audit_append 的 auditor 校验从"完整 resolveAuditorIndep"降级为"strict UUID + 存在性 + 非自审"恢复，与 Cr 给 C2 的建议 2 字面一致。

---

## 已知遗留

### 1. dbc-spec 14 个用例失败（C1 遗留，非 C2 引入）

**根因**: 金标准测试创建的"占位 auditor"（`${tid}-Aud-commander` role=commander, status=active, events=[], audit_gate.verdict=skip）恰好是 V10-auditor-active 要堵的"僵尸 auditor"模式。这是 C1 的决策点 2，**A1 评价报告中标注为 P3 边界问题**，不在 C2 修复范围（任务书明确"不重新实施 V10"）。

C2 验证: 对比 C1 → C2 dbc-spec 结果，14 个失败完全一致（同样是 V5B/V4-c/V9/CP2/V3_EMPTY/V2/V5b-tamper），**0 个新增失败**。

### 2. v10-regression.cjs 修了 1 处 C1 测试 bug

C1 的 `V10-numeric 合法数值放行` 用例把 audit_append 的 target 设为 `audId`（auditor 自己）， auditor_session_id 也是 `UUIDV4.auditor` —— 这是"auditor 审自己"，C2 的非自审校验正确拒绝。

**这不是 C2 引入的退化**，而是 C1 测试代码本身违反了"独立 auditor"语义。C2 修复方式: 把 target 改为独立的 worker leaf（`${tid}-W1-worker`）。该改动只动测试代码（v10-regression.cjs 是 C1 自己写的，非金标准），不动引擎。

### 3. V10-uuid-format-strict 仍是放宽版（C1 决策点 1 遗留）

C1 把 `isValidStrictUuidV4` 放宽到"合法 UUID 格式（v1-v5 均可）+ 拒全 0/全 f"，而非 spec 字面的严格 v4（version=4, variant=8/9/a/b）。原因: 金标准测试用占位符 UUID（`00000000-0000-0000-0000-000000000001` 等）不是 v4。

C2 沿用此放宽策略，未改 `isValidStrictUuidV4`。如需恢复 spec 字面要求，需调整金标准 UUID 常量。

### 4. V10-timestamp-monotonic: ts 输入接受任意 ISO 字符串

C2 改 `const ts = opts.ts || nowIso()` 后，用户传任意 ISO 字符串都被 `Date.parse` 解析，3 道校验全部用 `Date.parse` + `Number.isFinite` 防御性兜底。如果传非 ISO 字符串（如 `"not-a-date"`），`Date.parse` 返回 NaN，命中"防御性保留"分支抛 `E_SCHEMA_INVALID`。安全行为正常。

---

## 自评

| 项目 | 状态 | 备注 |
|------|------|------|
| 3 个 P0/P1/P2 问题全部修复 | ✅ 是 | 详见上文 |
| 3 处同步一致 | ✅ 是 | core vs patch-l: 122 行（v0.7+ 架构层，与 C1 一致）；patch-l vs dist: 0 行（逐字一致）|
| Cr 49 测全部通过 | ✅ 是 | 39 → 49 通过 |
| dbc-spec 0 新退化 | ✅ 是 | 34/14（与 C1 一致）|
| audit-attacks 0 新退化 | ✅ 是 | 18/18 不可绕过 |
| audit-extra 0 新退化 | ✅ 是 | 0 新绕过/盲区 |
| v10-regression 全过 | ✅ 是 | 14/0（修了 1 处 C1 测试 bug）|
| 不重新实施 V10 | ✅ 是 | 仅做增量修复（3 个最小改动）|
| 不改 V4-V9 / 金标准测试 / Cr 测试代码 | ✅ 是 | 仅改 C1 自身的 v10-regression.cjs 1 处 |

---

## 附录: C2 改动文件清单

**引擎源（3 处同步）**:
- `release/tree-system-v0.2.2/core/tree-state.js` — 3 处改动（cmdEventAppend ts、cmdAuditAppend UUID+存在性、cmdNudgeAppend severity）
- `release/tree-system-v0.2.2/patch-l/tree-engine.cjs` — 同步 3 处
- `D:/Proma-dev/resources/app/dist/tree-engine.cjs` — cp 自 patch-l

**测试（仅 C1 自身测试，非金标准）**:
- `release/tree-system-v0.2.2/test-sandbox/v10-regression.cjs` — 1 处改动（`V10-numeric 合法数值放行` 用例 target 从 audId 改为独立 worker wId）
