# 树形会话执行体系 — 技术问题与解决方案

> 版本: v1.0 | 日期: 2026-06-21
> 来源: Q1 v2 全深度验证 × 3 轮独立审计（C1/C2/A1/A2 × 2 轮迭代）
> 范围: tree-state.js v0.2.1 + commander-methodology v1.2 + tree-audit-methodology v1.0

---

## 一、总览

经过 3 轮独立 Agent Team 审计，共发现 **8 项问题**，按严重度分：

| 严重度 | 数量 | 核心问题 |
|--------|:----:|---------|
| 阻断 | 2 | 根会话虚空、方法论断裂 |
| 严重 | 3 | Scope 承诺落空、自审计循环、覆盖率不足 |
| 中等 | 2 | 报告数据漂移、持续遗漏项 |
| 低 | 1 | 子命令覆盖缺口 |

**根因链**：ROOT_PLACEHOLDER → 根指挥官无真实会话 → 方法论所有铁律的"根会话"前提悬空 → 自审计循环无法打破 → 数据/报告漂移反复发生。

---

## 二、逐项问题与解决方案

### 问题 1：根会话 ROOT_PLACEHOLDER — 方法论根基断裂 🔴

**现象**：tree-state.json 中根 leaf 的 `session_id = "ROOT_PLACEHOLDER"`，无真实 MCP session_id，无 events，context_usage_pct=0。但是 `status = "done"`，是活跃 leaf。

**影响**：
- 方法论要求"根指挥官是一个真实 Agent 会话，只调度不执行"。但当前根节点是一个数据占位符，从未作为 Agent 运行
- 根 leaf 的 3 个 milestone（方案编制/子会话创建/终局审计）全部由 CLI 手动操作完成，无法追踪是哪个 Agent 在何时执行的
- 从数据中无法区分"根指挥官 fork 了审计子会话"还是"根指挥官自己写了审计报告"（根 events=[]）

**根因**：tree-state.js `init` 命令创建 root brief/dod 但不自动创建 root leaf。后续 `leaf add` 命令需要手动指定 `session_id`。操作者传入 `ROOT_PLACEHOLDER` 作为占位值——这个行为没有被校验拦截。

**解决方案**（三选一，推荐 A+B 组合）：

#### 方案 A：init 自动创建 root leaf，从环境获取真实 session_id（推荐）

修改 `cmdInit` 函数，在创建 tree-state.json 时自动创建 root leaf，session_id 从以下来源获取（按优先级）：
1. `--session-id <uuid>` CLI 参数
2. 环境变量 `PROMA_SESSION_ID`
3. 回退：生成一个标记为 `PENDING_ROOT` 的特殊值，并要求操作者在首次真实操作前通过 `leaf set-session` 子命令修正

```javascript
// tree-state.js cmdInit 末尾新增
const rootSessionId = opts['session-id'] || process.env.PROMA_SESSION_ID || 'PENDING_ROOT';
const rootLeaf = {
  leaf_id: `${tree_id}-root`,
  session_id: rootSessionId,
  parent: null,
  path: '',
  role: 'root',
  model: opts.model || 'unknown',
  channel: opts.channel || 'unknown',
  status: 'active',
  created_at: new Date().toISOString(),
  // ...其余字段
};
state.leaves[`${tree_id}-root`] = rootLeaf;
```

**工作量**：~15 行代码 + 1 个新增子命令 `leaf set-session`

#### 方案 B：validate 新增规则：拒绝非 UUID 格式的 root session_id

```javascript
// tree-state.js validate 函数中新增
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const [id, leaf] of Object.entries(state.leaves)) {
  if (leaf.role === 'root' && !UUID_RE.test(leaf.session_id)) {
    issues.push({
      type: 'root_session_not_real',
      leaf_id: id,
      detail: `root leaf session_id "${leaf.session_id}" is not a valid UUID. Root must be a real Agent session.`
    });
  }
}
```

**工作量**：~10 行代码

#### 方案 C：接受 ROOT_PLACEHOLDER 作为合法标记

在 commander-methodology.md 中新增一条说明：根 leaf 的 session_id 可以是标记值（如 `ROOT_PLACEHOLDER`），但需满足：
- root leaf 的 `added_by` 字段指向唯一的真实操作者
- 根 leaf 的每个 milestone 必须通过 `event append` 关联到真实的执行 Agent session_id
- validate 允许此特殊值，但需检查上述补偿条件

**工作量**：~5 行代码 + methodology 更新。不推荐——治标不治本。

---

### 问题 2：Scope "3 层 commander 深度"未兑现 🔴

**现象**：`root_brief.in_scope` 明确写了 `"3层commander深度"`。但实际实现的 commander 链最深仅 2 层（root→A-commander→Ac1-commander），第 3 层是 worker。E_DEPTH_EXCEEDED 验证了"第 3 层被拒绝"，但从未有 3 层 commander 链被 fork_session + send_message 端到端运行。

**根因**：tree-state.js v0.2.1 设计上限就是 3 层（root + 子 commander + 孙 commander），`calcCommanderDepth >= 3` 时拒绝再加 commander。这个设计是正确的——3 层 commander 是最大容量，不是必须全部占满。但 scope 措辞暗示了"我们会验证 3 层都可工作"，实际只验证了 2 层。

**解决方案**：

#### 方案 A：修正 scope 措辞（最小改动）

```json
// root_brief.in_scope 改为
"3层commander容量验证（含第3层拒绝E_DEPTH_EXCEEDED）"
```

在报告中明确区分"容量上限"和"已实现的链深度"。

#### 方案 B：补做真实 3 层 commander 端到端测试（彻底验证）

创建一个新 tree，构造：
```
root (depth 0, fork from 当前会话)
  └── X-commander (depth 1, fork from root)
       └── Y-commander (depth 2, fork from X)
            ├── Y-w1-worker (depth 3, create from Y)
            └── Y-w2-worker (depth 3, create from Y)
```

用 fork_session 创建 X 和 Y，用 create_session 创建 worker。通过 send_message 派任务并回收 brief_echo + done。验证：Y-commander 可以正常 fork、发消息、收 done；Y-w1/Y-w2 可以正常创建和通信。

**工作量**：~15 分钟，3 个子会话

**推荐 A+B 组合**：scope 先修正措辞，再补端到端测试。

---

### 问题 3：自审计循环 — 自己审自己 🟡

**现象**：根指挥官在同一会话内完成了方案制定 → 执行 → 自审计 → 报告编写。Round 1 自审计发现 10 个非阻断问题，Round 2 回归自审计"发现 0 个新问题"——但 Round 2 只检查了 Round 1 修复的正确性，未对 tree-state.json 做新的独立数据审查。tree-audit-methodology 铁律 3 要求"反事实攻击子会话不得与产出文档的子会话是同一个"，铁律 1 要求"审查必须并行多 Agent"。

**根因**：方法论要求审计 Agent 通过 fork_session 独立创建，但与"根指挥官 ROOT_PLACEHOLDER 不是真实会话"形成死循环——根不是真实会话，就无法 fork 出真实审计子会话。

**解决方案**：

#### 方案 A：根指挥官 fork 审计子会话（配合问题 1 修复）

问题 1 修复后，根 leaf 拥有真实 session_id，即可通过 `fork_session` 创建独立审计子会话。审计子会话的 prompt 中禁止包含待审报告的全文（防止偏见），只给文件路径和审查维度。审计子会话独立读取文件、独立判断、独立产出结构化问题列表。根指挥官只负责汇总去重，不修改审计员的判断。

#### 方案 B：引入"外部审计回调"机制

在 commander-methodology.md 中新增原则 14（外部审计）：**所有声称"通过"的报告，必须经过至少一次由非产出链上的 Agent 执行的独立审计。** 具体做法：
- 产出链：根指挥官 → 子 commander → worker（执行链）
- 审计链：独立审计指挥官（由用户或另一个根指挥官 fork 创建）→ 4+2 审计员 → 审计报告
- 审计链的根指挥官不得是产出链上的任何会话

#### 方案 C：自审计标记 + 降级

如果因环境限制无法 fork 独立审计子会话（如当前根 session 不是真实会话），则在报告中强制标注"自审计 = 非独立"并降级总评——自审计产出的结论最高只能是 ⚠️，不能声明 ✅。

**推荐**：问题 1 修复后采用方案 A。在问题 1 修复前采用方案 C。

---

### 问题 4：CLI 手动插入违反方法论 🟡

**现象**：至少 4 个非根 leaf 的 session_id 不是 UUID（"C-COMMANDER-SESSION"、"CC1-COMMANDER-SESSION"、"CC1W1-WORKER-SESSION"、"TEST-UUID"），而是通过 CLI `leaf add --json` 手动插入的占位符。方法论铁律要求"指挥官不亲自执行"，但手动 leaf add 就是执行行为。

**根因**：当前 tree-state.js 的 `leaf add` 不校验 session_id 的合法性（UUID 格式 + 来源可信）。任何字符串都可作为 session_id 传入。

**解决方案**：

#### 方案 A：leaf add 强制 session_id 校验

```javascript
// tree-state.js cmdLeafAdd 中新增
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(session_id)) {
  throw new TreeStateError(E_SCHEMA_INVALID,
    `session_id "${session_id}" is not a valid UUID. ` +
    'Leaves must be created with real MCP session IDs from fork_session or create_session.'
  );
}
```

**工作量**：~5 行代码

#### 方案 B：新增 `added_by` 强制追踪

`leaf add` 时要求传入 `added_by` 字段（操作者 session_id），写入 leaf 的 `added_by` 属性。validate 检查：非 root leaf 的 `added_by` 不得为其自身的 `session_id`（自己不能创建自己），且 `added_by` 必须存在于树中且具有 commander 或 root role。

```javascript
// leaf add 时
if (role !== 'root') {
  if (!added_by || !UUID_RE.test(added_by)) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'added_by (operator session_id) is required for non-root leaves');
  }
  // validate 时检查 added_by 对应的 leaf 存在且 role ∈ {root, commander}
}
```

**工作量**：~15 行代码

**推荐 A+B 组合**：A 堵住非法 session_id 入口，B 提供操作者可追溯性。

---

### 问题 5：Events 覆盖率不足 🟡

**现象**：18 个 leaf 中仅 6 个有 events（33%）。原始 A 分支的 4 个 worker leaf（Aw1/Ac1w1/Ac1w2/B）events 全部为 0——它们从未通过 send_message 触发事件写入。但能力矩阵终局将 "events / brief_echo" 标记为 ✅。

**根因**：第一轮验证中 worker 子会话的创建和 milestone 完成是通过 CLI 操作完成的（`milestone add` + `leaf set-status done`），而非通过 send_message 派任务 → Agent 回复 brief_echo → 自动写入 events。这是"重结构、轻交互"的执行策略偏差。

**解决方案**：

#### 方案 A：Worker 创建后强制执行 brief_echo 回环

在 commander-methodology.md 的原则 11（叶子 = create_session）后新增子句：

> Worker 会话的首条消息必须包含结构化 brief_echo。Commander 在收到 brief_echo 前不得将 Worker 标记为 active——必须保持 pending_brief 状态。收到 brief_echo 后通过 `event append` 写入 tree-state。

对应 tree-state.js 增加 status 值 `pending_brief`，validate 检查：role=worker 且 status=active 的 leaf，必须满足 `events 含至少 1 条 brief_echo`。

#### 方案 B：Worker milestone done 的前置条件检查

`leaf set-status done` 对 worker 增加检查：events 数组必须非空（至少含 1 条 brief_echo + 1 条 done）。当前代码 L764-778 的 milestone 检查对 worker 仅要求"有 milestone + audit_pass=true"，不检查 events。

```javascript
// tree-state.js cmdLeafSetStatus 中 worker 专属检查
if (leaf.role === 'worker' && (!Array.isArray(leaf.events) || leaf.events.length < 2)) {
  throw new TreeStateError(E_SCHEMA_INVALID,
    `worker "${leaf_id}" must have at least 2 events (brief_echo + done) before set-status done`
  );
}
```

**工作量**：方案 A ~20 行（methodology + tree-state），方案 B ~10 行

**推荐 A+B 组合**。

---

### 问题 6：报告数据漂移 🔶

**现象**：报告 v1.0 基于 write_count=1 的旧快照编写，声称 7 leaf、0 events、C 分支未创建。但此时 tree-state.json 已经 write_count=49、18 leaf、10 events。偏差 48 次写入。v1.2 重写后才对齐。

**根因**：报告与 tree-state.json 之间没有引用完整性约束——报告声称的数据和 tree-state.json 实际数据可以任意偏离。报告规范未要求"报告必须标注数据快照的 write_count 和生成时间"。

**解决方案**：

#### 方案 A：报告头部强制快照声明（推荐）

在 commander-methodology.md 的报告模板中新增必填字段：

```markdown
> **数据快照**: write_count=<N> | tree-state生成时间=<ISO> | 报告生成时间=<ISO>
```

每次验证报告必须声明它所基于的 tree-state 快照的 write_count。后续审计员可通过比对报告的 write_count 和当前 tree-state 的 write_count 判断是否有未反映的变更。

#### 方案 B：tree-state 内嵌报告哈希

在 tree-state.json 的 `_meta` 中新增 `last_report_hash` 字段。每次写报告时，将报告文件的 SHA256 写入 tree-state。validate 时可选检查：如果 `_meta.last_report_hash` 与当前报告文件不匹配，产生 info 级别 issue。

**工作量**：方案 A ~5 行（模板修改），方案 B ~20 行（tree-state.js + CLI）

**推荐 A**（简单有效）。

---

### 问题 7：5 项持续遗漏 🔶

| 遗漏项 | 性质 | 持续轮次 |
|--------|------|:---:|
| B5 — Worker write_count 差值验证 | 可执行用例 | 3 轮 |
| C15 — Fork 上下文 list_messages 检查 | 可执行用例 | 3 轮 |
| M4 — migrate worker→commander 自动提升 | 数据依赖 | 3 轮 |
| 原则 2 — 双轨执行 | 方法论验证 | 2 轮 |
| 原则 5 — 7 段式 prompt 传递 | 方法论验证 | 2 轮 |

**解决方案**：

- **B5**: 在 Worker 创建前后记录 `_meta.write_count`，send_message 完成后再次记录，差值写入 Worker 的 milestone note。~5 分钟工作量。
- **C15**: 在 fork 后对子会话执行 `list_messages(limit=200)`，验证消息数 ≥ fork 截断点的 index+1。~3 分钟工作量。
- **M4**: 用 bverify 树中已知有子节点的旧 worker 执行 migrate，验证提升为 commander。或在 bverify 中手动构造一个 worker-with-children leaf。~5 分钟。
- **原则 2/5**: 在子会话 prompt 模板中增加 7 段式检查项，在 Commander 的 done 上报中要求附上"已下发的原始 prompt 文本摘要"。

---

### 问题 8：子命令覆盖率 13/23 🔸

剩余 10 个未覆盖子命令：

| 组 | 子命令 | 原因 |
|----|--------|------|
| Query | leaf get, leaf list-active, leaf list-all, tree dump, drift list, heartbeat tail, event list | 未纳入方案范围 |
| Update | leaf set-context, leaf set-last-event | 未纳入方案范围 |
| Append | segment append (独立路径) | 仅通过 A-commander segment_chain 间接覆盖 |

**建议**：其中 7 个 Query 命令可在 5 分钟内全部跑完（纯 CLI 操作）。3 个 Update/Append 命令应在下一轮验证方案中纳入。不构成阻断。

---

## 三、实施路线图

| 优先级 | 问题 | 方案 | 工作量 | 依赖 |
|--------|------|------|:---:|------|
| **P0** | 问题 1 — ROOT_PLACEHOLDER | A+B: init 自动创建 root leaf + validate 拒绝非 UUID | ~25行 | — |
| **P0** | 问题 4 — CLI 手动插入 | A+B: leaf add UUID校验 + added_by追踪 | ~20行 | P0-1 |
| **P1** | 问题 2 — 3 层 commander 深度 | A: 修正 scope 措辞 + B: 补端到端测试 | 15分钟 | P0-1 |
| **P1** | 问题 5 — Events 覆盖率 | A+B: pending_brief 状态 + worker done 前置检查 | ~30行 | P0-1 |
| **P1** | 问题 3 — 自审计循环 | A: fork 独立审计子会话 | 流程变更 | P0-1 |
| **P2** | 问题 6 — 报告漂移 | A: 报告头部强制快照声明 | ~5行(模板) | — |
| **P2** | 问题 7 — 5 项遗漏 | 逐项补测 | ~15分钟 | — |
| **P3** | 问题 8 — 子命令覆盖率 | Query 7 命令 CLI 补跑 | 5分钟 | — |

---

## 四、结论

树形会话执行体系 v0.2.1 的核心引擎（tree-state.js）功能正确——18 leaf、11 events、12 drift、13/23 子命令、8/8 错误码、migrate/backup/restore 往返均通过验证。但体系的方法论合规性存在**结构性缺陷**：根会话不是一个真实 Agent 会话，导致"根会话纯净原则"悬空，继而引发自审计循环和手动 CLI 操作的问题。

修复 P0 两项（ROOT_PLACEHOLDER + CLI 校验）后，可声明 v0.2.2 方法论合规。修复 P1 三项后，可声明完整验证闭环。

---
> *本报告由独立审计 Agent Team（C1/C2/A1/A2）的多轮审计发现驱动，由 Proma Agent 整合撰写。*
