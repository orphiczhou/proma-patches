# 02 — 五层防御架构：机制设计与代码草案

> **日期**: 2026-06-23
> **性质**: 实施方案文档（可操作代码草案）
> **配套**: `tree-system-architecture-analysis-2026-06-23.md`（诊断） + `01-questions.md`（专家审议）
> **定位**: 方案系列中最具操作性的文档——描述每一层防御的具体机制和代码草案
> **阅读前提**: 已阅读 v2 诊断报告 §3（三层防御架构）、§4（开源框架借鉴）、§7（天道定位）、§9（v0.6 计划影响）

---

## §0 五层架构总览图

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 4: 模型层契约（v0.8+ Proma 平台改造）          [ 完全缺失 ] │
│   - subagent_trace_id（真凭证，非 UUID 字段）                     │
│   - capability-based 工具调用（平台层拦截）                       │
│   - 依赖 Anthropic / Proma 官方，本项目不可控                     │
└──────────────────────────────────────────────────────────────────┘
                                ▲
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3: 监督平面 — "天道" TAO Watcher（周期被动审计）[ 部分有 ]  │
│   - TAO Watcher 已存在（35 条规则，周期审计数据合规性）           │
│   - 缺：Liveness heartbeat（区分"软违规" vs "硬死"）             │
│   - 缺：silence_minutes 字段（用户可感知静默时长）                │
│   - 定位：第三层兜底，不是唯一防线                                │
└──────────────────────────────────────────────────────────────────┘
                                ▲
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2: 主动 Supervision（事件驱动接管）           [ 完全缺失 ]  │
│   - commander 持有 worker lifecycle handle                       │
│   - worker 失败 → commander 立即接管（不等 TAO 下个 tick）        │
│   - Erlang OTP 的 max_restarts / max_seconds 防抖窗口             │
└──────────────────────────────────────────────────────────────────┘
                                ▲
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: Hard Gate — 数据 + 不变式层（事中拦截）    [ 完全缺失 ]  │
│   - Design by Contract（precondition / postcondition / invariant） │
│   - Capability Token（fork 时颁发，工具调用前校验）               │
│   - 层级深度硬限制（depth ≤ max_depth）                           │
│   - State Schema 强制结构化（self_check / event schema）          │
│   - Event Hash Chain（防伪造审计链）                              │
└──────────────────────────────────────────────────────────────────┘
                                ▲
┌──────────────────────────────────────────────────────────────────┐
│ Layer 0: 行为引导 — prompt 软约束                    [ 已有 ]     │
│   - SKILL.md 里的"铁律""应当""必须"                              │
│   - 当前主要防线，但本质是"暗示"——模型可以不遵守                  │
└──────────────────────────────────────────────────────────────────┘
```

**当前 Proma 的状态**：Layer 0（prompt）+ Layer 3 部分（TAO Watcher 只查数据合规性）。**Layer 1、2、4 全缺**。Agent 走捷径时，0 层管不住，3 层事后才发现，中间没有事中拦截。

**三层叠起来才是真正的 defense in depth**，对应 Rich Harang 的结论：*"soft controls are good for defense in depth, but should not be the first line."*

---

## §1 Layer 1 — Hard Gate（P0，立即做）

Layer 1 是五层架构中最关键的一层——它把 SKILL.md 里的"应当"升级为 tree-state.js 子命令里的"必须"。模型可以灵活选择执行路径，但不能跨越宪法红线。

五个子机制各有侧重：DbC 守写入门、Capability Token 守工具调用门、depth 限制守结构门、Schema 守格式门、Hash Chain 守审计链完整。

### 1.1 Design by Contract（DbC）

#### 概念

源自 Eiffel / Rust 的契约式编程，三个概念：

| 概念 | 含义 | Proma 映射 |
|---|---|---|
| **precondition** | 函数执行前必须满足的条件 | tree-state.js 子命令入口校验 |
| **postcondition** | 函数执行后必须满足的条件 | 写入后校验状态一致性 |
| **invariant** | 始终为真的属性 | `validate()` 函数，每次状态变更后必须 ok |

违反任何一条 = 直接抛 `TreeStateError`，不进函数体，不写入状态。LLM 走捷径 → 立即被拦。

#### 每个 tree-state.js 子命令的 DbC 校验点清单

**`leaf set-status done`**

```
precondition:
  - new_status === 'done' → 遍历 milestone.expect_outputs
  - 每个 output 路径 → fs.existsSync(absPath) 必须 true
  - 任一文件不存在 → throw E_DELIVERABLE_MISSING

postcondition:
  - leaf.status === 'done'
  - leaf.events 包含 done 事件
```

**`leaf set-status archived`**（leaf 级）

```
precondition:
  - leaf 不能是 root（root 只能通过 tree set-status archived 归档整树）
  - 若 leaf.role === 'commander' → 所有子 leaf 必须已 archived 或 done
  - worker 不能自己 arch 自己 → caller.session_id !== leaf.added_by 或通过 commander 委托

postcondition:
  - leaf.archived_session 字段已写入（记录归档者 session_id）
  - leaf 不再计入 active_count
```

**`leaf add`**

```
precondition:
  - computeLeafDepth(state, parent) < max_depth（默认 3）
  - role in ALLOWED_ROLES（枚举校验，禁止自由文本）
  - active_count < max_leaves（默认 10）
  - parent leaf 必须存在且 status !== 'archived'
  - 若 role === 'sub_commander' → root_dod.allow_sub_commander === true

postcondition:
  - 新 leaf 出现在 state.leaves 中
  - parent leaf.children 数组包含新 leaf_id
```

**`audit-gate pass`**

```
precondition:
  - auditor_session_id 不能为 null
  - auditor_session_id !== leaf.added_by（不能自己审自己）
  - auditor_session_id !== root.session_id（root 不兼任 auditor）
  - leaf.events 中存在 ts < audit_ts 的 done 事件（审计在完成之后）

postcondition:
  - leaf.audit_gate.verdict === 'pass'
  - leaf.audit_gate.auditor_session_id 已写入
```

**`event append done`**

```
precondition:
  - self_check 必须是 Array，长度 > 0
  - 每个元素必须包含 {item: string, pass: boolean, evidence: string}
  - 不能是字符串 "all_pass" 或其他自由格式

postcondition:
  - event 追加到 leaf.events
  - event.prev_hash === 最后一个 event 的 hash
```

**`event append brief_echo`**

```
precondition:
  - 若 meta.alignment 字段存在 → 必须附带 auditor_session_id
  - auditor_session_id 不能为 null 或等于 caller.session_id
  - 否则 throw E_ALIGNMENT_NOT_VERIFIED

postcondition:
  - brief_echo 事件追加到 leaf.events
```

**`tree set-status archived`**（整树级）

```
precondition:
  - validate(state) 必须返回 ok: true
  - 若有 issues → throw E_TREE_NOT_VALIDATED
  - 所有 leaf 必须 done 或 archived（调用方自己保证）

postcondition:
  - tree.status === 'archived'
  - 归档时间戳记录
```

#### 代码草案（合并 v0.6 草稿和 v2 报告，优化版）

以下代码草案覆盖全部 8 个校验点，可直接作为 tree-state.js 改造的参考实现。

```js
// ============================================================
// §1.1.1 错误码定义（新增）
// ============================================================
const E_DELIVERABLE_MISSING     = 'E_DELIVERABLE_MISSING';
const E_AUDITOR_NOT_INDEPENDENT = 'E_AUDITOR_NOT_INDEPENDENT';
const E_ALIGNMENT_NOT_VERIFIED  = 'E_ALIGNMENT_NOT_VERIFIED';
const E_TREE_NODE_BUDGET_EXCEEDED = 'E_TREE_NODE_BUDGET_EXCEEDED';
const E_SELFCHECK_INVALID       = 'E_SELFCHECK_INVALID';
const E_TREE_NOT_VALIDATED      = 'E_TREE_NOT_VALIDATED';
const E_AUDIT_PREMATURE         = 'E_AUDIT_PREMATURE';
const E_TREE_DEPTH_EXCEEDED     = 'E_TREE_DEPTH_EXCEEDED';
const E_ROLE_INVALID            = 'E_ROLE_INVALID';

// ============================================================
// §1.1.2 cmdLeafSetStatus — 文件存在性校验（CP1）
// ============================================================
// 位置: cmdLeafSetStatus, 在 leaf.status = new_status 之前

if (new_status === 'done' && leaf.role === 'worker') {
  for (const m of leaf.milestones || []) {
    for (const outPath of m.expect_outputs || []) {
      const absPath = path.isAbsolute(outPath)
        ? outPath
        : path.join(
            state._deliverables_root || path.dirname(statePath),
            outPath
          );
      if (!fs.existsSync(absPath)) {
        throw new TreeStateError(
          E_DELIVERABLE_MISSING,
          `cannot set status=done: deliverable "${outPath}" not found on disk\n` +
          `  milestone: ${m.id}\n` +
          `  leaf: ${leaf_id}\n` +
          `  resolved path: ${absPath}\n` +
          `  tip: check if the file was written to the expected location`
        );
      }
    }
  }
}
```

```js
// ============================================================
// §1.1.3 cmdAuditGate — auditor 独立性校验（CP2）
// ============================================================
// 位置: cmdAuditGate, 在写入 audit_gate 之前

if (verdict === 'pass' || verdict === 'required') {
  const auditor = args.auditor_session_id;
  const commander = state.leaves[leaf_id]?.added_by;
  const root = state.root_leaf?.session_id;

  if (!auditor) {
    throw new TreeStateError(
      E_AUDITOR_NOT_INDEPENDENT,
      `audit-gate rejected: auditor_session_id is null or undefined.\n` +
      `  Must be an independent Agent's session_id.`
    );
  }
  if (auditor === commander) {
    throw new TreeStateError(
      E_AUDITOR_NOT_INDEPENDENT,
      `audit-gate rejected: auditor_session_id="${auditor}" equals leaf's added_by (commander).\n` +
      `  Self-audit is prohibited. Delegate audit to an independent Agent.`
    );
  }
  if (auditor === root) {
    throw new TreeStateError(
      E_AUDITOR_NOT_INDEPENDENT,
      `audit-gate rejected: auditor_session_id="${auditor}" equals root session.\n` +
      `  Root session must not serve as leaf auditor.`
    );
  }
}
```

```js
// ============================================================
// §1.1.4 cmdEventAppend — alignment 字段保护（CP3）
// ============================================================
// 位置: cmdEventAppend, eventType === 'brief_echo' 分支

if (eventType === 'brief_echo') {
  const alignment = meta?.alignment;
  if (alignment !== undefined && alignment !== null) {
    if (!meta.auditor_session_id || meta.auditor_session_id === args.session_id) {
      throw new TreeStateError(
        E_ALIGNMENT_NOT_VERIFIED,
        `brief_echo rejected: alignment=${alignment} but no independent auditor_session_id.\n` +
        `  Commander cannot self-assess alignment. Delegate to an Agent and provide its session_id.`
      );
    }
  }
}
```

```js
// ============================================================
// §1.1.5 cmdLeafAdd — 节点数硬上限（CP4）
// ============================================================
// 位置: cmdLeafAdd, 在创建 leaf 之前

const maxLeaves = args['max-leaves']
  || state.root_dod?.node_budget
  || 10;

const allLeaves = Object.values(state.leaves);
const archivedCount = allLeaves.filter(l => l.status === 'archived').length;
const activeCount = allLeaves.length - archivedCount;

if (activeCount >= maxLeaves) {
  throw new TreeStateError(
    E_TREE_NODE_BUDGET_EXCEEDED,
    `cannot add leaf: active leaf count ${activeCount} >= budget ${maxLeaves}.\n` +
    `  total leaves: ${allLeaves.length}, archived: ${archivedCount}\n` +
    `  action: archive some leaves first, or increase root_dod.node_budget`
  );
}
```

```js
// ============================================================
// §1.1.6 cmdEventAppend — self_check schema 校验（CP5）
// ============================================================
// 位置: cmdEventAppend, eventType === 'done' 分支

if (eventType === 'done') {
  const sc = meta?.self_check;

  if (sc === undefined || sc === null) {
    throw new TreeStateError(
      E_SELFCHECK_INVALID,
      `done event rejected: self_check is missing (must be a non-empty array)`
    );
  }

  if (!Array.isArray(sc)) {
    throw new TreeStateError(
      E_SELFCHECK_INVALID,
      `done event rejected: self_check must be an array, got ${typeof sc}.\n` +
      `  string values like "all_pass" are not accepted.`
    );
  }

  if (sc.length === 0) {
    throw new TreeStateError(
      E_SELFCHECK_INVALID,
      `done event rejected: self_check array is empty (must have at least one item)`
    );
  }

  for (let i = 0; i < sc.length; i++) {
    const item = sc[i];
    if (!item.item || typeof item.item !== 'string') {
      throw new TreeStateError(E_SELFCHECK_INVALID,
        `self_check[${i}].item is missing or not a string`);
    }
    if (typeof item.pass !== 'boolean') {
      throw new TreeStateError(E_SELFCHECK_INVALID,
        `self_check[${i}].pass must be boolean, got ${typeof item.pass}`);
    }
    if (!item.evidence || typeof item.evidence !== 'string') {
      throw new TreeStateError(E_SELFCHECK_INVALID,
        `self_check[${i}].evidence is missing or not a string`);
    }
  }
}
```

```js
// ============================================================
// §1.1.7 cmdTreeSetStatus — archived 前强制 validate（CP6）
// ============================================================
// 位置: tree set-status 命令, target === 'tree' && new_status === 'archived'

if (new_status === 'archived' && target === 'tree') {
  const result = validateTree(state);
  if (!result.ok || (result.issues && result.issues.length > 0)) {
    const issueCount = result.issues ? result.issues.length : 0;
    throw new TreeStateError(
      E_TREE_NOT_VALIDATED,
      `cannot archive tree: validate() returned ${issueCount} issue(s).\n` +
      `  run: node tree-state.js validate ${tree_id}\n` +
      `  fix all issues before archiving`
    );
  }
}
```

```js
// ============================================================
// §1.1.8 cmdAuditGate — audit 时序校验（SP1）
// ============================================================
// 位置: cmdAuditGate, 在 verdict === 'pass' 分支

if (verdict === 'pass') {
  const doneEvents = (leaf.events || []).filter(e => e.type === 'done');
  if (doneEvents.length === 0) {
    throw new TreeStateError(
      E_AUDIT_PREMATURE,
      `audit-gate rejected: no 'done' event found for leaf ${leaf_id}.\n` +
      `  Audit must occur after work is completed.`
    );
  }

  const lastDoneTs = doneEvents[doneEvents.length - 1].ts;
  if (args.ts && args.ts < lastDoneTs) {
    throw new TreeStateError(
      E_AUDIT_PREMATURE,
      `audit-gate rejected: audit timestamp (${args.ts}) is before last done event (${lastDoneTs}).\n` +
      `  delta: ${lastDoneTs - args.ts}ms`
    );
  }
}
```

```js
// ============================================================
// §1.1.9 invariant — validate() 函数（每次状态变更后）
// ============================================================
// 用于 tree validate 命令和被其他子命令引用

function validateTree(state) {
  const issues = [];

  // (a) 根路径连通性
  for (const [id, leaf] of Object.entries(state.leaves)) {
    if (leaf.parent) {
      if (!state.leaves[leaf.parent]) {
        issues.push({
          type: 'orphan',
          leaf_id: id,
          msg: `parent ${leaf.parent} does not exist`
        });
      }
    }
  }

  // (b) status 字段枚举
  const VALID_STATUSES = ['pending', 'active', 'done', 'archived', 'blocked'];
  for (const [id, leaf] of Object.entries(state.leaves)) {
    if (!VALID_STATUSES.includes(leaf.status)) {
      issues.push({
        type: 'invalid_status',
        leaf_id: id,
        msg: `status "${leaf.status}" not in ${VALID_STATUSES.join(', ')}`
      });
    }
  }

  // (c) 节点数
  const activeCount = Object.values(state.leaves)
    .filter(l => l.status !== 'archived').length;
  const budget = state.root_dod?.node_budget || 10;
  if (activeCount > budget) {
    issues.push({
      type: 'budget_exceeded',
      msg: `active leaves ${activeCount} > budget ${budget}`
    });
  }

  // (d) 深度限制
  const { computeLeafDepth } = require('./depth-utils');
  const maxDepth = state.root_dod?.max_depth || 3;
  for (const [id, leaf] of Object.entries(state.leaves)) {
    if (leaf.status !== 'archived') {
      const depth = computeLeafDepth(state, id);
      if (depth > maxDepth) {
        issues.push({
          type: 'depth_exceeded',
          leaf_id: id,
          msg: `depth ${depth} > max_depth ${maxDepth}`
        });
      }
    }
  }

  // (e) role 枚举
  const ALLOWED_ROLES = ['root', 'commander', 'worker', 'auditor', 'integrator'];
  for (const [id, leaf] of Object.entries(state.leaves)) {
    if (!ALLOWED_ROLES.includes(leaf.role)) {
      issues.push({
        type: 'invalid_role',
        leaf_id: id,
        msg: `role "${leaf.role}" not in ${ALLOWED_ROLES.join(', ')}`
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    summary: `${issues.length} issue(s) found`
  };
}
```

### 1.2 Capability Token（fork 时颁发，工具调用前校验）

#### 概念

源自 seL4 / Fuchsia 的 capability-based security 模型。核心思想：**没有 ambient authority，所有权限通过 capability token 显式传递**。token 可撤销、有期限、可降权。seL4 已形式化证明不存在绕过路径。

**映射到 Proma Tree 体系**：commander fork worker 时，不是"请求" worker 不要乱写文件，而是直接不给它写文件的 token。worker 即使"想"越权，工具调用层会直接 throw——LLM 根本碰不到文件系统。

#### Token 结构草案

```js
// commander fork worker 时颁发:
{
  "worker_id": "w_20260623_001",
  "parent_session_id": "commander_20260623_root",
  "issued_at": "2026-06-23T10:30:00Z",
  "expires_at": "2026-06-23T11:00:00Z",     // TTL 30 min
  "capabilities": {
    "tools": ["read_file", "grep", "glob"],  // 没有 write_file / bash / task
    "write_paths": ["workspace/temp/"],      // 白名单路径
    "max_tokens_per_call": 8000,
    "max_total_tokens": 64000,
    "max_sessions_allowed": 1                // 禁止再 fork
  },
  "revocable": true,
  "revoked": false
}
```

**关键设计要点**：

1. **tools 白名单而非黑名单**：默认 deny all，显式 grant
2. **write_paths 前缀匹配**：worker 只能写到指定目录
3. **TTL 强制过期**：过期后即使 token 未被 revoke 也自动失效
4. **max_sessions_allowed**：控制 worker 能否再 fork（通常 = 1，即禁止）
5. **revocable + revoked**：commander 可随时撤销

#### 校验流程

```
worker 调 write_file(path="/workspace/output.txt", content="...")
    │
    ▼
patches.cjs 拦截（工具调用前 hook）
    │
    ├─ 1. 从 tree-state 读该 session 的 capability token
    │
    ├─ 2. token 不存在？ → throw E_CAPABILITY_MISSING
    │
    ├─ 3. token 已过期？（expires_at < now） → throw E_CAPABILITY_EXPIRED
    │
    ├─ 4. token 已 revoke？ → throw E_CAPABILITY_REVOKED
    │
    ├─ 5. write_file 在 tools 白名单中？
    │     ├─ 否 → throw E_CAPABILITY_DENIED
    │     └─ 是 → 继续
    │
    ├─ 6. path 在 write_paths 前缀中？
    │     ├─ 否 → throw E_CAPABILITY_PATH_DENIED
    │     └─ 是 → 放行
    │
    └─ 实际执行工具调用
```

#### 代码草案

```js
// ============================================================
// patches.cjs — 工具调用拦截层
// ============================================================

// 工具白名单（worker 默认没有任何权限）
const DEFAULT_WORKER_CAPABILITIES = {
  tools: [],
  write_paths: [],
  max_tokens_per_call: 0,
  max_total_tokens: 0,
  max_sessions_allowed: 0
};

function checkCapability(sessionId, toolName, toolArgs) {
  // 1. 读 token
  const token = getCapabilityToken(sessionId);
  if (!token) {
    throw new CapabilityError('E_CAPABILITY_MISSING',
      `no capability token found for session ${sessionId}`);
  }

  // 2. 检查过期
  if (Date.now() > new Date(token.expires_at).getTime()) {
    throw new CapabilityError('E_CAPABILITY_EXPIRED',
      `capability token expired at ${token.expires_at}`);
  }

  // 3. 检查撤销
  if (token.revoked) {
    throw new CapabilityError('E_CAPABILITY_REVOKED',
      `capability token revoked for session ${sessionId}`);
  }

  // 4. 检查工具权限
  const caps = token.capabilities;
  if (!caps.tools.includes(toolName)) {
    throw new CapabilityError('E_CAPABILITY_DENIED',
      `tool "${toolName}" not in capability token tools list: [${caps.tools.join(', ')}]`);
  }

  // 5. 检查路径权限（write 类工具）
  const WRITE_TOOLS = ['write_file', 'edit_file', 'bash'];
  if (WRITE_TOOLS.includes(toolName) && toolArgs.path) {
    const allowed = caps.write_paths.some(prefix =>
      toolArgs.path.startsWith(prefix)
    );
    if (!allowed) {
      throw new CapabilityError('E_CAPABILITY_PATH_DENIED',
        `path "${toolArgs.path}" not in write_paths: [${caps.write_paths.join(', ')}]`);
    }
  }

  // 6. fork 权限
  if (toolName === 'task' || toolName === 'fork_session') {
    if (!caps.max_sessions_allowed || caps.max_sessions_allowed < 1) {
      throw new CapabilityError('E_CAPABILITY_FORK_DENIED',
        `session ${sessionId} is not allowed to fork sub-sessions`);
    }
  }

  return true;
}

// ============================================================
// commander 颁发 token（fork worker 时调用）
// ============================================================
function issueWorkerToken(workerSessionId, commanderSessionId, options = {}) {
  const token = {
    worker_id: workerSessionId,
    parent_session_id: commanderSessionId,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + (options.ttl_seconds || 1800) * 1000).toISOString(),
    capabilities: {
      tools: options.tools || ['read_file', 'grep', 'glob'],
      write_paths: options.write_paths || ['workspace/temp/'],
      max_tokens_per_call: options.max_tokens_per_call || 8000,
      max_total_tokens: options.max_total_tokens || 64000,
      max_sessions_allowed: options.max_sessions_allowed || 0  // 默认禁止再 fork
    },
    revocable: true,
    revoked: false
  };

  // 存入外部 store（不在 prompt 里，不在 tree-state.json 里暴露给 worker）
  storeCapabilityToken(workerSessionId, token);
  return token;
}
```

#### 关键风险：token 不能放 prompt 里

**这是 Capability Token 机制最重要的安全约束。** LLM 会"读"到自己 context 里的所有内容，包括自己的权限边界。如果 token 出现在 prompt 中，模型可能：

- 学会"自降权"策略（比如故意调低 max_tokens 以提前结束）
- 尝试绕过（知道 write_paths 是 `/workspace/temp/`，就写一个符号链接到 `/workspace/`）
- 在 context 压缩时丢失关键权限信息，导致误判自己"没权限"

**正确做法**：Token 必须存在 tree-state.js 的外部 store（如 `~/.proma/capability-tokens/<session_id>.json`），**仅工具调用时由 patches.cjs 同步读取校验**。LLM 永远不直接接触 token 内容。

#### 为什么 P0 不现实，建议 P1

Capability Token 的拦截需要修改 Proma 平台的工具调用层（`patches.cjs` 或 `main.cjs` 的 tool use hook），这涉及：

1. 对 Proma Agent SDK 内部行为的假设（tool call hook 是否可用）
2. 可能和 Proma 官方的 tool use 实现冲突
3. 需要 Proma 官方支持或至少不阻止第三方 hook

**因此建议**：DbC 作为 P0（纯 tree-state.js 改造，不依赖平台），Capability Token 作为 P1（DbC 上线观察后再推进）。

### 1.3 层级深度硬限制

#### 问题背景

qfv2 实测跑到 5 层深（root → C → Cr → Ccr1 → worker）。每层指令保真度掉 39%（Laban ICLR 2026），5 层下来 = 92% 信息丢失。Erlang OTP 工业上 3-5 层就停，Anthropic 自己只用 2 层。

根因：`tree-state.js` 的 `role` 字段是自由文本（SKILL.md §13 只举例，无 enum 限制），`leaf add` 也没有 depth 校验。commander 可以无限嵌套。

#### 代码草案

```js
// ============================================================
// depth-utils.js — computeLeafDepth
// ============================================================

/**
 * 计算指定 leaf 在 tree 中的深度。
 * root depth = 1, 其直接子节点 depth = 2, 以此类推。
 * 防环：用 visited set 记录已访问节点，遇环即停。
 */
function computeLeafDepth(state, leaf_id) {
  let depth = 0;
  let current = leaf_id;
  const visited = new Set();

  while (current && !visited.has(current)) {
    visited.add(current);
    depth++;
    const leaf = state.leaves[current];
    if (!leaf || !leaf.parent) break;
    current = leaf.parent;
  }

  return depth;
}

// ============================================================
// cmdLeafAdd — depth 校验
// ============================================================

// 在 cmdLeafAdd 创建 leaf 之前:
const depth = computeLeafDepth(state, args.parent);
const maxDepth = state.root_dod?.max_depth || 3;

if (depth >= maxDepth) {
  // 生成可视化路径帮助 commander 定位问题
  const chain = [];
  let cur = args.parent;
  while (cur && chain.length < maxDepth + 3) {
    const l = state.leaves[cur];
    chain.unshift(`${l?.role || '?'} (${cur.slice(-8)})`);
    cur = l?.parent;
  }

  throw new TreeStateError(
    E_TREE_DEPTH_EXCEEDED,
    `cannot add leaf at depth ${depth + 1}: max_depth=${maxDepth}.\n` +
    `  current chain: ${chain.join(' → ')}\n` +
    `  suggestion: consider flattening (worker multi-step plan) or ` +
    `splitting into separate trees (meta-tree mode).\n` +
    `  or increase root_dod.max_depth (hard cap: 5)`
  );
}

// ============================================================
// role 字段 enum 校验
// ============================================================
const ALLOWED_ROLES = ['root', 'commander', 'worker', 'auditor', 'integrator'];

if (!ALLOWED_ROLES.includes(args.role)) {
  throw new TreeStateError(
    E_ROLE_INVALID,
    `invalid role "${args.role}": must be one of [${ALLOWED_ROLES.join(', ')}].\n` +
    `  free-text roles are prohibited to prevent unbounded commander nesting.`
  );
}

// ============================================================
// root_dod 字段扩展
// ============================================================
// 用户可在 brief 里覆盖默认值:
root_dod: {
  deliverables: [...],
  must_contain: [...],
  quality_gates: [...],

  // 新增:
  max_depth: 3,               // 默认 3，硬上限 5
  max_leaves: 10,             // 已有
  node_budget: 10,             // 已有（别名）
  allow_sub_commander: true,  // 是否允许 sub-commander（默认 true）
  tree_mode: 'flat'            // 'flat' | 'meta' | 'hybrid'（见 §5）
}
```

#### 硬上限策略

| 配置 | max_depth | 说明 |
|---|---|---|
| 默认 | 3 | root → commander → worker。80% 任务够用 |
| 扁平模式 | 2 | root → worker。Anthropic 同款，严格模式 |
| 宽松上限 | 5 | 硬上限，即便 root_dod 配了更大的值也在此截断 |

tree-state.js 内部强制 `Math.min(root_dod.max_depth || 3, 5)`。

### 1.4 State Schema 强制结构化

#### 概念

借鉴 LangGraph 的 State Schema + Reducer 机制：worker 输出强制匹配预定义 schema，commander 用 schema 校验，worker 无法"伪造字段"或"缩短格式"。

LangGraph 中每个 subgraph 有独立 schema，父子图 schema 不共享时形成硬边界。对应到 Proma：worker 只能写自己的 event，event 格式由 tree-state.js 强制校验。

#### self_check schema 校验

已在 §1.1.6 给出完整代码草案。补充说明：

```js
// 合法示例:
self_check: [
  { item: "deliverable_exists",   pass: true,  evidence: "/workspace/output.md (8556 bytes)" },
  { item: "schema_valid",         pass: true,  evidence: "JSON parse ok" },
  { item: "cross_refs_resolved",  pass: false, evidence: "3 broken links in §2" }
]

// 非法示例（会被 throw）:
self_check: "all_pass"                         // 字符串，不是数组
self_check: []                                  // 空数组
self_check: [{ item: "x" }]                    // 缺少 pass 和 evidence
self_check: [{ item: "x", pass: "yes" }]       // pass 不是 boolean
```

#### event schema 校验

```js
// 每个 event 必须包含的字段:
const REQUIRED_EVENT_FIELDS = ['type', 'ts', 'session_id', 'prev_hash'];

// 各 event type 的额外必填字段:
const EVENT_TYPE_SCHEMA = {
  'done': {
    required: ['self_check'],
    schema: { self_check: 'array<{item, pass, evidence}>' }
  },
  'brief_echo': {
    optional: ['alignment'],
    conditional: {
      // 若 alignment 存在，必须伴 auditor_session_id
      alignment: meta => !meta.auditor_session_id
        ? 'E_ALIGNMENT_NOT_VERIFIED'
        : null
    }
  },
  'drift': {
    required: ['kind', 'severity', 'action'],
    enum: {
      kind: ['context', 'quality', 'missing', 'timeout', 'other'],
      severity: ['info', 'warning', 'high', 'critical'],
      action: ['declare', 'nudge', 'block', 'escalate']
    }
  },
  'plan': {
    required: ['plan_text'],
    optional: ['milestones', 'estimated_turns']
  },
  'blocked': {
    required: ['reason'],
    optional: ['waiting_for', 'unblock_condition']
  },
  'recovery': {
    required: ['action_taken', 'result']
  }
};

// 在 cmdEventAppend 中校验:
function validateEventSchema(eventType, meta) {
  const schema = EVENT_TYPE_SCHEMA[eventType];
  if (!schema) {
    throw new TreeStateError('E_UNKNOWN_EVENT_TYPE',
      `unknown event type: ${eventType}`);
  }
  for (const field of (schema.required || [])) {
    if (meta[field] === undefined) {
      throw new TreeStateError('E_EVENT_SCHEMA_VIOLATION',
        `event ${eventType} missing required field: ${field}`);
    }
  }
  // enum 校验
  if (schema.enum) {
    for (const [field, values] of Object.entries(schema.enum)) {
      if (meta[field] && !values.includes(meta[field])) {
        throw new TreeStateError('E_EVENT_SCHEMA_VIOLATION',
          `${eventType}.${field}="${meta[field]}" not in [${values.join(', ')}]`);
      }
    }
  }
}
```

### 1.5 Event Hash Chain

#### 概念

Proma 已有 append-only event log（领先主流框架），但缺密码学完整性保护。借鉴 Event Sourcing 的 hash chain 模式：每个 event 包含 `prev_hash`，形成不可篡改链。worker 伪造 auditor_session_id 时链会断。

#### 代码草案

```js
// ============================================================
// hash-chain.js — event hash chain 工具
// ============================================================
const crypto = require('crypto');

function hashEvent(event) {
  // 排除 prev_hash 和 hash 自身，只 hash 内容
  const { prev_hash, hash, ...content } = event;
  const canonical = JSON.stringify(content, Object.keys(content).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function computePrevHash(leaf) {
  const events = leaf.events || [];
  if (events.length === 0) return '0'.repeat(64);  // 创世 hash
  const lastEvent = events[events.length - 1];
  return lastEvent.hash || hashEvent(lastEvent);
}

function verifyLeafHashChain(leaf) {
  const events = leaf.events || [];
  let expectedPrev = '0'.repeat(64);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // 检查 prev_hash
    if (event.prev_hash !== expectedPrev) {
      return {
        valid: false,
        index: i,
        event_type: event.type,
        expected: expectedPrev.slice(0, 16) + '...',
        actual: (event.prev_hash || 'undefined').slice(0, 16) + '...',
        msg: `hash chain broken at event #${i} (${event.type})`
      };
    }

    // 重新计算 hash 确认真实性
    const recomputed = hashEvent(event);
    if (event.hash && event.hash !== recomputed) {
      return {
        valid: false,
        index: i,
        msg: `event #${i} hash mismatch (may be tampered)`
      };
    }

    expectedPrev = event.hash || recomputed;
  }

  return { valid: true, length: events.length };
}

// ============================================================
// cmdEventAppend — 注入 prev_hash 和 hash
// ============================================================
// 在 event push 之前:
const leaf = state.leaves[leaf_id];
const prevHash = computePrevHash(leaf);
const event = {
  ...eventData,
  prev_hash: prevHash,
  ts: eventData.ts || new Date().toISOString()
};
event.hash = hashEvent(event);
leaf.events.push(event);

// ============================================================
// validate 中新增 hash chain 检查
// ============================================================
for (const [id, leaf] of Object.entries(state.leaves)) {
  const chainResult = verifyLeafHashChain(leaf);
  if (!chainResult.valid) {
    issues.push({
      type: 'hash_chain_broken',
      leaf_id: id,
      msg: chainResult.msg
    });
  }
}
```

---

## §2 Layer 2 — 主动 Supervision（P1）

### 2.1 Erlang OTP Supervisor 模式借鉴

Erlang/OTP 的 supervisor tree 是工业界最成熟的进程监督模式。关键机制：

| Erlang OTP 概念 | 含义 | Proma 映射 |
|---|---|---|
| **Supervisor** | 持有 child 生命周期的进程 | commander 持有 worker session handle |
| **Child Spec** | 子进程的配置（重启策略、shutdown 强度、超时） | worker 的任务描述 + 重试配置 |
| **one_for_one** | 一个 child 挂了，只重启那个 child | worker 失败，只重试该 worker |
| **rest_for_one** | 一个 child 挂了，重启它及之后的所有 child | 链式依赖的 worker，前序失败后序全重来 |
| **max_restarts / max_seconds** | 防抖窗口：N 秒内最多重启 M 次 | worker 重试窗口：10 min 内最多 3 次 |
| **escalate** | 防抖窗口内超过上限 → supervisor 自己自杀 → 上层接管 | commander 重试耗尽 → 上报告警 + 标记 blocked |

核心区别：当前 Proma 的 TAO Watcher 是**周期被动**（5 min tick 才发现问题）。Erlang OTP 是**事件驱动主动**（child 失败那一刻 supervisor 立即接管）。

### 2.2 Child Spec 结构

```js
// commander 每 fork 一个 worker 时，在 tree-state 中注册 child spec:
{
  "worker_id": "w_20260623_001",
  "parent_commander": "commander_20260623_root",
  "forked_at": "2026-06-23T10:30:00Z",
  "expected_duration_minutes": 15,
  "restart_strategy": "one_for_one",   // 'one_for_one' | 'one_for_all' | 'rest_for_one'
  "max_restarts": 3,                    // 防抖窗口内最多重启次数
  "max_seconds": 600,                   // 防抖窗口（秒）
  "shutdown_timeout_seconds": 120,      // 等待 worker 自行 cleanup 的最长时间
  "restart_count": 0,                   // 当前窗口内已重启次数
  "restart_window_start": null,         // 当前窗口起始时间
  "last_seen_alive": "2026-06-23T10:35:00Z",
  "missed_heartbeats": 0,
  "status": "active"                    // 'active' | 'restarting' | 'blocked' | 'escalated'
}
```

### 2.3 Commander 持有 Worker Lifecycle Handle

```
commander 主循环（每次处理 event 批次后）:

    ┌─────────────────────────────────────────┐
    │ 1. 遍历所有 active child spec            │
    │    last_seen_alive > shutdown_timeout?   │
    └──────────────┬──────────────────────────┘
                   │ 是（worker 失联）
                   ▼
    ┌─────────────────────────────────────────┐
    │ 2. 检查 restart 窗口                     │
    │    restart_count < max_restarts?         │
    │    window 内?                             │
    └──────────────┬──────────────────────────┘
                   │
         ┌─────────┴────────┐
         │ 是               │ 否
         ▼                  ▼
    ┌──────────────┐   ┌──────────────────┐
    │ 3a. 重试      │   │ 3b. escalate     │
    │ restart_count++│   │ status=blocked   │
    │ fork 新 worker │   │ drift kind=timeout│
    │ 同样 brief     │   │ severity=critical│
    │ (但不同 session)│   │ 通知用户         │
    └──────────────┘   └──────────────────┘
```

### 2.4 Commander SKILL.md 改动草案

在 commander SKILL.md 新增 §7.1 "主动 Supervision 机制"：

```markdown
## §7.1 主动 Supervision — worker lifecycle 管理（v0.7 新增）

[必须] 你持有每个 worker 的 lifecycle handle。Worker 失联时你必须主动接管，
不等 TAO Watcher 下个 tick。

### 心跳检查（每次主循环）
[必须] 每轮处理完 event 后，检查所有 active child spec 的 last_seen_alive:
  - 超过 expected_duration_minutes × 2 → 判定失联
  - 超过 shutdown_timeout_seconds 无任何 event → 判定失联

### 重试规则
[必须] 重试窗口为 max_seconds 秒内最多 restart max_restarts 次:
  - 窗口内次数未满 → fork 新 worker（同样 brief，不同 session_id），restart_count++
  - 窗口内次数已满 → escalate：drift append kind=timeout severity=critical，
    leaf status → blocked，通知用户

### 重试注意事项
[必须] 重试时使用相同的 brief 但必须 fork 不同的 session（session_id 不同）。
[必须] 如果原 worker 有部分产出（done 事件已写但 verify 失败），
  新 worker 的 brief 应包含"已有部分产出在 <path>，请在此基础上修复"。
[禁止] 同一个 worker session 重发消息（LLM 同样 input 会同样输出）。

### 防抖窗口
[必须] 记录 restart_window_start 和 restart_count。
  窗口过期后重置计数。这是防止"重试死循环"的机制。
```

### 2.5 关键风险

1. **重试死循环**：worker 失败 → commander 重试 → 又失败（同样 input 同样错）→ 循环。必须配 `max_restarts` / `max_seconds` 防抖窗口。窗口内次数耗尽必须 escalate，不能无限重试。

2. **Commander 自身 context 压力**：同时管理 N 个 child spec + 正常推进 tree 增长，commander 的 context 可能更早耗尽。需要配合竹节交接在 context usage > 80% 时预警（已在 v0.6 Phase 6.8 部分覆盖）。

3. **与现有 SKILL.md 的冲突**：主动 supervision 改变了 commander 的角色——从"推进 tree 生长"变成"推进 + 监护"。需要确保 commander 不会因为监护任务而忽略推进任务（或反过来）。

---

## §3 Layer 3 — 监督平面 / "天道"（强化已有）

### 3.1 TAO Watcher 当前状态

TAO Watcher 已存在，目前的能力：

- **35 条规则**：周期审计数据合规性（字段非空、status 合法、树结构完整等）
- **5 分钟 tick**：每个 workspace 遍历一次
- **只查数据合规性**：不查产出质量，不查 worker 是否"真的在工作"
- **软性督促**：发现问题 → 写 drift event → 由 commander 自行处理

**当前定位问题**：Proma 把 TAO Watcher 当成了唯一防线（Layer 0 prompt + Layer 3 天道）。但实际上 TAO 是周期被动审计，只能发现"慢死"（数据慢慢变脏），发现不了"瞬死"（worker 卡死、commander 超 context 崩掉）。

### 3.2 需要加的：Liveness Heartbeat

区分"软违规"（数据不合规）和"硬死"（worker 完全无响应）：

```js
// ============================================================
// TAO Watcher 加 liveness 检测
// ============================================================

function checkLiveness(treeState) {
  const now = Date.now();
  const livenessIssues = [];

  for (const [leafId, leaf] of Object.entries(treeState.leaves)) {
    if (leaf.status === 'archived' || leaf.status === 'done') continue;

    // 获取最后一次 event 时间
    const events = leaf.events || [];
    const lastEvent = events[events.length - 1];
    const lastActivityTs = lastEvent
      ? new Date(lastEvent.ts).getTime()
      : new Date(leaf.created_at).getTime();

    const silenceMinutes = (now - lastActivityTs) / 60000;

    // 心跳超时阈值:
    // - worker: 10 min 无活动 → soft violation（可能在做长任务）
    // - worker: 30 min 无活动 → hard death（大概率卡死）
    // - commander: 15 min 无活动 → soft violation
    // - commander: 45 min 无活动 → hard death（可能 context 崩了）
    const softThreshold = leaf.role === 'commander' ? 15 : 10;
    const hardThreshold = leaf.role === 'commander' ? 45 : 30;

    if (silenceMinutes >= hardThreshold) {
      livenessIssues.push({
        type: 'liveness_hard_death',
        leaf_id: leafId,
        role: leaf.role,
        silence_minutes: Math.round(silenceMinutes),
        severity: 'critical',
        msg: `${leaf.role} ${leafId.slice(-8)} silent for ${Math.round(silenceMinutes)}min — presumed dead`
      });
    } else if (silenceMinutes >= softThreshold) {
      livenessIssues.push({
        type: 'liveness_soft_violation',
        leaf_id: leafId,
        role: leaf.role,
        silence_minutes: Math.round(silenceMinutes),
        severity: 'warning',
        msg: `${leaf.role} ${leafId.slice(-8)} silent for ${Math.round(silenceMinutes)}min — may be stuck`
      });
    }
  }

  return livenessIssues;
}
```

### 3.3 需要加的：silence_minutes 字段

让用户可感知静默时长（不仅仅是内部检测）。加到 tree-state 的 leaf 级别字段中，由 TAO Watcher 每次 tick 更新：

```js
// TAO Watcher 每次 tick 后更新每个 leaf 的 silence 字段:
leaf.silence_minutes = Math.round((Date.now() - lastActivityTs) / 60000);
leaf.last_checked_at = new Date().toISOString();

// 浮窗 UI 第二层 tab 上加 silence badge:
//   > 60 min → 灰色 "静默 67 min"
//   > 120 min → 黄色 "静默 2.3 h"
//   > 240 min → 红色 "失联 4.5 h"
```

### 3.4 TAO 的正确定位

```
           ┌──────────────────────────────┐
           │ Layer 1: Hard Gate            │  ← 第一道防线（事中拦截）
           │ 写入前硬校验，绕不过            │
           └──────────────┬───────────────┘
                          │ 漏过的
                          ▼
           ┌──────────────────────────────┐
           │ Layer 2: 主动 Supervision     │  ← 第二道防线（事件驱动接管）
           │ commander 持有 lifecycle      │
           └──────────────┬───────────────┘
                          │ 仍然漏过的
                          ▼
           ┌──────────────────────────────┐
           │ Layer 3: TAO Watcher          │  ← 第三道防线（周期兜底）
           │ 5 min tick 审计 + liveness    │     事后发现，nudge 纠正
           │ 软性督促，不能替代前两层       │
           └──────────────────────────────┘
```

**TAO 是第三层兜底，不是唯一防线。** 前两层拦住 90% 的问题，TAO 负责兜住剩下的 10%。如果把 TAO 当唯一防线，就会出现当前的问题：worker 走捷径 → TAO 5 分钟后才发现 → 发现时 impact 已经扩散。

---

## §4 Layer 4 — 模型层契约（v0.8+，远期）

### 4.1 概念

Layer 4 是 Proma 平台层的改造，涉及到 Agent SDK 内部机制，不在本项目直接可控范围内。但作为架构的第四层，它提供了最强的保证。

### 4.2 subagent_trace_id（真凭证，非 UUID 字段）

当前 Proma 的 `Agent()` 工具返回一个 UUID session_id，但 tree-state.js 无法验证这个 UUID 真的对应一个 Agent session。commander 可以瞎编一个 UUID 写进去。

**subagent_trace_id** 是 Anthropic 推荐的方案：平台层在 Agent 调用时生成加密凭证，包含：

- 调用方 session_id
- 被调用方 session_id
- 调用时间戳
- 平台签名（防伪造）

tree-state.js 可以通过 Proma API 验证凭证真伪，而不依赖 UUID 格式校验。

### 4.3 Capability-based 工具调用（Proma 平台改造）

见 §1.2。真正的 Capability Token 需要 Proma 平台在工具调用层提供拦截点。目前只能通过 patches.cjs 做 best-effort hook。

### 4.4 依赖关系

```
本项目可控范围:
  Layer 0: SKILL.md prompt 文案
  Layer 1: tree-state.js 子命令校验
  Layer 2: commander SKILL.md 行为规范
  Layer 3: TAO Watcher 代码
  ─────────────────────────────── 边界
Proma 平台层（本项目不可控）:
  Layer 4: subagent_trace_id + capability-based tool call
  Anthropic Agent SDK（不可控）
```

Layer 4 的推进需要与 Proma 官方协调，不在 v0.7 范围内。

---

## §5 层级深度限制 — 三种替代方案

从 tree-system-architecture-analysis §6.4-6.5 提取，详细讨论复杂任务在深度限制下如何拆解。

### 5.1 方案 A：扁平化（depth ≤ 2）

```
commander-root (depth=1)
├─ worker-frontend-module1  (depth=2)
├─ worker-frontend-module2  (depth=2)
├─ worker-backend-api        (depth=2)
├─ worker-backend-db         (depth=2)
├─ worker-integration-test   (depth=2)
└─ worker-doc                (depth=2)

[1 commander + N worker] [depth = 2]
```

- **优点**：层级浅，指令保真度最高（仅 1 层传递）。Anthropic 同款。实现最简单。
- **缺点**：root context 压力大（管 10+ worker）。复杂任务需要 root 多拆一级 brief。worker 需要自己消化 multi-step plan。
- **适用**：80% 任务。

### 5.2 方案 B：meta-tree（多独立 tree 协调）

```
meta-commander (独立 tree-0)
├─ tree-1-commander  ← 独立 tree-state.json
│  ├─ worker-1
│  └─ worker-2
└─ tree-2-commander  ← 独立 tree-state.json
   ├─ worker-3
   └─ worker-4
```

- **优点**：context 完全隔离，可并行。每个 sub-tree 独立 depth ≤ 2。
- **缺点**：跨 tree 协调成本高（需 meta-commander 汇总）。tree-state 不互通（需显式传递 deliverable 路径）。
- **适用**：超大任务（各模块独立可并行）。

### 5.3 方案 C：折中（depth ≤ 3 + sub-commander 强模型）

```
commander-root (depth=1)
├─ worker-A (depth=2)
├─ sub-commander-B (depth=2) ← 必须用更强模型
│  ├─ worker-B1 (depth=3)
│  └─ worker-B2 (depth=3)
└─ worker-C (depth=2)
```

- **优点**：保留 sub-commander 灵活性。强模型兜底指令保真度。
- **缺点**：sub-commander 强模型成本高（Claude Opus 比 DeepSeek 贵 10x）。depth=3 仍有 61% 信息丢失。
- **适用**：业务确实需要 sub-commander 拆分，且愿意承担强模型成本。

### 5.4 推荐：三种都支持，root_dod 配置

```js
// root_dod 字段声明 tree 模式:
root_dod: {
  // ... 其他字段

  // 层级配置:
  max_depth: 3,             // 默认 3
  tree_mode: 'flat',        // 'flat' (方案A) | 'meta' (方案B) | 'hybrid' (方案C)

  // 仅在 hybrid 模式下:
  allow_sub_commander: true,
  sub_commander_min_model: 'claude-opus-4',  // sub-commander 必须使用的模型
}
```

**默认值**：`max_depth=3`, `tree_mode='flat'`（方案 A，覆盖 80% 任务）。

**校验逻辑**：
- `tree_mode='flat'` → `max_depth` 强制 = 2
- `tree_mode='hybrid'` → `max_depth` ≤ 3, `allow_sub_commander=true`
- `tree_mode='meta'` → 每个 sub-tree 独立校验（各自 tree-state.json）

---

## §6 防御深度总结表

| 层 | 机制 | 时机 | 强度 | 当前状态 | 优先级 | 工作量 |
|----|------|------|------|---------|--------|--------|
| **Layer 1** | DbC precondition / postcondition / invariant | 事中（写入前） | 硬，绕不过 | 完全缺失 | **P0** | 3-4h |
| **Layer 1** | Capability Token（工具调用前校验） | 事中（工具调用前） | 硬，绕不过 | 完全缺失 | **P1** | 2-3d |
| **Layer 1** | 层级深度硬限制（depth ≤ 3 + role enum） | 事中（leaf add 时） | 硬，绕不过 | 完全缺失 | **P0** | 30min |
| **Layer 1** | State Schema 强制结构化（self_check / event） | 事中（event append 时） | 硬，绕不过 | 完全缺失 | **P0** | 1h |
| **Layer 1** | Event Hash Chain（防伪造审计链） | 事中（event append 时） | 硬，可审计 | 完全缺失 | **P2** | 1-2h |
| **Layer 2** | 主动 Supervision（commander 持 worker lifecycle） | 事件驱动（失败时） | 硬，主动接管 | 完全缺失 | **P1** | 2-3d |
| **Layer 3** | TAO Watcher 周期审计 | 周期（5 min） | 软，audit + nudge | 部分有 | **P2** | 已有 |
| **Layer 3** | Liveness Heartbeat（硬死检测） | 周期（5 min） | 软，告警 | 完全缺失 | **P2** | 30min |
| **Layer 3** | silence_minutes 字段（用户可感知） | 周期（5 min） | 软，透明 | 完全缺失 | **P2** | 15min |
| **Layer 4** | subagent_trace_id（真凭证） | 远期 | 硬，平台层 | 缺失 | **P3** | 不可控 |
| **Layer 4** | Capability-based 工具调用（平台层） | 远期 | 硬，平台层 | 缺失 | **P3** | 不可控 |

### 防御层次关系

```
问题流入 → [Layer 1: Hard Gate] ──拦不住──→ [Layer 2: 主动 Supervision] ──拦不住──→ [Layer 3: TAO Watcher] ──拦不住──→ 用户感知
                ▲                              ▲                              ▲
            拦截率 ~80%                    拦截率 ~15%                     兜底 ~5%
         (写入前硬校验)               (事件驱动主动接管)               (周期被动审计)
```

三层叠加 = defense in depth。Layer 4 是远期理想态（平台改造），不纳入当前拦截率估计。

---

## 附录 A：错误码完整清单

| 错误码 | 触发子命令 | 触发条件 | Phase |
|--------|-----------|---------|-------|
| `E_DELIVERABLE_MISSING` | `leaf set-status done` | expect_outputs 文件不在磁盘上 | P0 / 6.1 |
| `E_AUDITOR_NOT_INDEPENDENT` | `audit-gate` | auditor = null / commander / root | P0 / 6.2 |
| `E_ALIGNMENT_NOT_VERIFIED` | `event append brief_echo` | alignment 存在但无 auditor_session_id | P0 / 6.3 |
| `E_TREE_NODE_BUDGET_EXCEEDED` | `leaf add` | active_count >= max_leaves | P0 / 6.4 |
| `E_SELFCHECK_INVALID` | `event append done` | self_check 不是合法数组 | P0 / 6.5 |
| `E_TREE_NOT_VALIDATED` | `tree set-status archived` | validate() 不通过 | P0 / 6.6 |
| `E_AUDIT_PREMATURE` | `audit-gate` | audit 时间早于 done 事件 | P0 / 6.7 |
| `E_TREE_DEPTH_EXCEEDED` | `leaf add` | depth >= max_depth | P0 / 6.11 |
| `E_ROLE_INVALID` | `leaf add` | role 不在 ALLOWED_ROLES | P0 / 6.12 |
| `E_CAPABILITY_MISSING` | patches.cjs | session 无 capability token | P1 / 6.9 |
| `E_CAPABILITY_EXPIRED` | patches.cjs | token 超过 TTL | P1 / 6.9 |
| `E_CAPABILITY_REVOKED` | patches.cjs | token 已被 revoke | P1 / 6.9 |
| `E_CAPABILITY_DENIED` | patches.cjs | tool 不在白名单 | P1 / 6.9 |
| `E_CAPABILITY_PATH_DENIED` | patches.cjs | path 不在 write_paths | P1 / 6.9 |
| `E_CAPABILITY_FORK_DENIED` | patches.cjs | worker 尝试 fork | P1 / 6.9 |
| `E_EVENT_SCHEMA_VIOLATION` | `event append` | event 不匹配 schema | P0 / 6.5 |
| `E_UNKNOWN_EVENT_TYPE` | `event append` | event type 不在枚举中 | P0 / 6.5 |

## 附录 B：改造文件清单

| 文件 | 改造内容 | Phase |
|------|---------|-------|
| `tree-state.js` | DbC 校验（8 个子步骤）+ depth/role 校验 + hash chain | P0 |
| `depth-utils.js`（新建） | computeLeafDepth 函数 | P0 |
| `hash-chain.js`（新建） | hashEvent / computePrevHash / verifyLeafHashChain | P2 |
| `patches.cjs` | Capability Token 拦截层 | P1 |
| `capability-store.js`（新建） | capability token 存取（外部 store） | P1 |
| `commander SKILL.md` | 主动 supervision 机制（§7.1）+ 铁律更新 | P1 |
| `worker SKILL.md` | self_check schema 要求 + role enum 说明 | P0 |
| `TAO Watcher` | liveness heartbeat + silence_minutes 字段 | P2 |
| `migrate.cjs` | 历史 16 个 tree 数据迁移（新字段补全 + schema 合规） | P0 |

---

> **本文档由 Proma Agent 综合 tree-system-architecture-analysis v2、architecture-analysis、expert-review v1/v2 输出撰写。**
> **代码草案为参考实现，实际落地需根据 tree-state.js 现有结构适配。**
> **所有 DbC 校验 + depth/role 校验 = P0 最高优先级，Capability Token + 主动 supervision = P1，hash chain + liveness = P2。**
