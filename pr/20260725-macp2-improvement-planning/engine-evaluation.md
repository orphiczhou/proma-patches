# 引擎层改进可行性论证报告

> **来源**: macp2 树形任务独立验收评估报告 §5 改进建议（P0-A / P0-B / P2-A）
> **论证对象**: `D:/Codes/tree-harness/tree-engine.cjs`（5753 行，v1.1 schema）
> **论证方法**: 逐行源码追踪 → 逻辑分析 → 可行性/风险/工作量打分
> **约束**: 只读论证，不改代码。聚焦引擎层，不评 SKILL/项目层。
> **日期**: 2026-07-25

---

## 一、引擎架构速览（与论证相关部分）

### 1.1 审计独立性三层闸门

`resolveAuditorIndep(state, leaf, auditorSessionId)` (行 3018–3098) 是审计独立性的**单一 choke point**，被 `cmdAuditGate`、`cmdMilestoneSetResult`、`cmdEventAppend`(alignment)、`collectValidateIssues` 四处复用：

| 闸门 | 行号 | 触发条件 | 语义 |
|------|------|---------|------|
| **闸门1** | 3031–3032 | `leaf.role === 'root' && auditorSessionId === leaf.session_id` | root 自审放行（信任锚，必须显式传） |
| **闸门2** | 3039–3065 | `auditorSessionId === root.session_id`（root 担任任意非 root leaf 的 auditor） | root 信任锚打破死锁（需 root status 非 archived/pruned + events 非空） |
| **闸门3** | 3066–3098 | 其余所有情况 | 独立 auditor 必须：① UUID v4 格式 ② 真实 live session ③ 树内存在且非自审 ④ **status=done** ⑤ **events 非空** ⑥ **自己 audit_gate.verdict=pass/pass_with_minor** |

```
             ┌──────────────────────────┐
             │  resolveAuditorIndep()   │
             │  3 闸门，按优先级短路    │
             └──────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   闸门1: root     闸门2: root      闸门3: 独立
   自审放行        信任锚背书        auditor 校验
   (行3031)        (行3039)         (行3066)
```

### 1.2 callerSessionId 透传链路

MCP wrapper（`patches.cjs`）→ `engine.run(cmd, args, treesRoot, callerSessionId)` → `dispatch(cmd, args, callerSessionId)` → 各子命令。**当前覆盖**：

| 命令 | 透传 callerSessionId | 用途 |
|------|---------------------|------|
| `leaf add` | ✅ (行 966) | caller === added_by 校验 |
| `leaf set-status` | ✅ (行 1699) | owner/creator/root-self 校验 |
| `leaf set-session` | ✅ (行 2117) | creator 校验（堵夺权） |
| `event append` | ✅ (行 2445) | done 事件 caller===owner 校验 |
| `audit gate` | ✅ (行 3516) | caller===audit_session_id |
| `audit append` | ✅ (行 3656) | caller===auditor_session_id |
| `milestone add` | ✅ (行 2199) | owner/creator/root-self 校验 |
| `milestone set-result` | ✅ (行 2270) | caller===audit_session_id |
| `milestone update` | ✅ (行 2358) | owner/creator/root-self 校验 |
| `communication log` | ✅ (行 1364) | 记录 caller |
| **`init`** | **❌ 未透传** | — |

### 1.3 tree_init session_id 三级降级

`cmdInit` (行 739–867) 中 root leaf 的 session_id 来源：

```javascript
// 行 815
const rootSessionId = opts['session-id'] || process.env.PROMA_SESSION_ID || PENDING_ROOT;
```

- 优先级: `--session-id` → `PROMA_SESSION_ID` 环境变量 → `'PENDING_ROOT'`（过渡标记）
- 若落到 `PENDING_ROOT`：`registerSessionToState` 跳过登记（不占 session 配额），`validate` 产生 warning，需后续 `leaf set-session` 修正

### 1.4 tree_id 校验现状

`cmdInit` 行 754 处有 `root_brief.prefix` 的前置校验（`PREFIX_RE = /^[a-z][a-z0-9_]{3,7}$/`），但 **`tree_id` 自身仅校验非法字符**（`/[\\/\s]/`，行 725），**不校验是否匹配 prefix 规则**。`LEAF_NAME_RE`（行 47）要求 leaf_id 的 prefix 段匹配 `[a-z][a-z0-9_]{3,7}`（无连字符），tree_id 被用作 leaf 的 prefix，因此 tree_id="oeval-macp2" 会在 init 通过、leaf_add 才炸。

---

## 二、P0-A：放开"冷启动禁 fork 独立 auditor"——方案 B

### 2.1 建议原文

> root fork 一个 role=auditor leaf 并背书它 audit_gate pass，之后该 auditor leaf 给全树所有 leaf 配 milestone_set_result/audit_gate（root 只介入一次）。

### 2.2 可行性：**高（引擎已天然支持方案 B）**

逐闸门源码分析——方案 B 描述的流程**在引擎层已完全合法**：

**步骤 1** — root 或 commander 调用 `leaf_add(role='auditor')`：
- 引擎行 1092–1096 仅禁止 worker/auditor 担任 `added_by`，**root/commander 可创建 auditor leaf**
- auditor leaf 初始 `audit_gate.verdict='required'`（行 1180）、`status='active'`（行 1163）
- ✅ 无"禁 fork auditor"硬约束

**步骤 2** — auditor leaf 完成自身工作（brief_echo + done event）：
- auditor 角色走简化协议（行 84–86 注释明确），只需 brief_echo + done，无 milestone/review_round
- ✅ 无引擎障碍

**步骤 3** — root 背书 auditor leaf 的 audit_gate=pass：
- root 调 `audit_gate(leaf_id=auditor, verdict=pass, audit_session_id=root.session_id)`
- 进入 `resolveAuditorIndep` → **闸门2（行 3039–3065）**：`auditorSessionId === root.session_id` → root trust anchor 放行（只要 root status 非 archived/pruned + events 非空）
- ✅ 引擎已支持，这是 V9+ Phase 4 的 R2 P1 修复

**步骤 4** — auditor 给任意 worker leaf 配 milestone_set_result / audit_gate：
- auditor 调 `audit_gate(leaf_id=worker-X, verdict=pass, audit_session_id=auditor.session_id)`
- 进入 `resolveAuditorIndep` → 闸门1 不命中（worker 不是 root）→ 闸门2 不命中（auditor ≠ root）→ **闸门3（行 3066–3098）**
- 闸门3 检查：auditor status=done ✅（步骤2）、events 非空 ✅（步骤2）、自己 audit_gate=pass ✅（步骤3）
- ✅ 引擎已支持，**auditor leaf 可以给全树所有 leaf 配门禁**，无"只能审同子树"限制

**结论：引擎层零改动即可支持方案 B。macp2 中 audit 门禁全回流 root 是 SKILL/流程层问题**——commander 不知道要创建 auditor leaf 并走上述四步流程，而非引擎禁止。

### 2.3 风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| **auditor 自审循环** | 🟡 低 | 闸门3 明确检查 `auditorLeaf.leaf_id === leaf.leaf_id`（行 3093: `if (auditorLeaf.leaf_id === leaf.leaf_id) return 'auditor is the leaf itself'`），auditor 不能审自己。但 auditor 审另一个 auditor 是否合法？——如果 auditor-B 自己的 audit_gate 也是 pass，闸门3 放行，理论上允许 auditor 互审。**这不算循环**，因为每个 auditor 的初始 pass 必须来自 root（闸门2）或上级已 done 的 auditor（闸门3），无法凭空产生 |
| **auditor 越权** | 🟢 极低 | auditor 可以给任何 leaf 配门禁，但必须在自己 session 内调用（`callerSessionId === audit_session_id` 校验，行 3547），且每次写入都有 call-log 审计追踪。如果 auditor"作恶"（给不合格 worker pass），属于信任问题而非引擎缺陷——auditor 本身是 root 信任锚背书的 |
| **闸门2 root 活跃度校验被绕过** | 🟢 极低 | 闸门2 要求 root status 非 archived/pruned + events 非空（行 3052–3059），防止 root 被注入后一键背书。已足够 |
| **macp2 报告中的"V10 冷启动约束"真实含义** | — | 重新审视：macp2 报告说的"冷启动约束"并非引擎硬编码的禁止，而是**V10 加固后闸门3 要求 auditor 必须 done + events + 自己 pass，导致没有任何 leaf 天然满足条件**——这是设计意图（防僵尸 auditor），需要 root 通过闸门2 显式背书才能打破。方案 B 的流程正好走闸门2→闸门3 |

### 2.4 工作量

| 项目 | 估算 |
|------|------|
| **引擎代码改动** | **0 行**（引擎已完全支持） |
| SKILL 文档更新 | 需要在 `tree-commander` / `tree-worker` SKILL 中明确四步流程（见 macp2 报告 P2-D：知识已沉淀到 auto memory，但需提升到 SKILL 级） |
| 测试验证 | 建议新增 `auditor-delegation` 测试用例（root→auditor→worker 全链路） |

### 2.5 实施大纲

**引擎层无需改动。** 但为了降低 commander 的使用门槛，可考虑以下**体验增强**（非必须）：

```
可选的引擎增强（低优先级）:
1. tree_init 返回值 tips 中加入 auditor 委派流程指引（buildInitTips 行 876）
   - 在 next_steps 中加一条: "调 mcp__tree__tree_help('how_to_register_auditor') 了解 auditor 委派四步流程"
2. 若希望进一步降低门槛，可在 help system 中新增 'auditor_delegation' topic
```

### 2.6 优先级推荐：**P0（引擎零改动，关键是 SKILL 和流程推广）**

引擎已天然支持方案 B。应把精力放在：
1. 更新 SKILL 文档，将四步流程从 auto memory 提升为 SKILL 强制 checklist
2. 下轮 macp3 中强制要求 commander 创建 auditor leaf（而非全回流 root）

---

## 三、P0-B：tree_init 自动绑定 caller session 到 root leaf

### 3.1 建议原文

> `tree_init` 自动绑定 caller session 到 root leaf（或强制要求传 session_id），消除 PENDING_ROOT 死锁。

### 3.2 可行性：**高（极小改动，已有完整基础设施）**

**现状分析**：

1. **MCP 层已透传 callerSessionId**：`engine.run(cmd, args, treesRoot, callerSessionId)` 行 5636，callerSessionId 来自 MCP wrapper 的 `__proma_getMcpServers__(sessionId, ...)`
2. **dispatch 已接收 callerSessionId**：行 5258 `async function dispatch(cmd, args, callerSessionId)`
3. **但 `init` case 未透传**：行 5261 `case 'init': return await cmdInit(args);` —— **没有传 callerSessionId**
4. **cmdInit 不接受 callerSessionId 参数**：行 739 `async function cmdInit(args)`

**断点位置**：`dispatch` 行 5261 和 `cmdInit` 行 739——两处各加一个参数即可。

**改动方案**：

```
dispatch 层 (行 5261):
  -  case 'init': return await cmdInit(args);
  +  case 'init': return await cmdInit(args, callerSessionId);

cmdInit 层 (行 739):
  -  async function cmdInit(args) {
  +  async function cmdInit(args, callerSessionId) {

session_id 优先级 (行 815):
  -  const rootSessionId = opts['session-id'] || process.env.PROMA_SESSION_ID || PENDING_ROOT;
  +  const rootSessionId = opts['session-id'] || callerSessionId || process.env.PROMA_SESSION_ID || PENDING_ROOT;
```

新优先级：`--session-id`（显式）→ `callerSessionId`（MCP 自动注入）→ `PROMA_SESSION_ID`（环境变量）→ `PENDING_ROOT`（兜底）

### 3.3 风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| **外部 MCP 调用无 callerSessionId** | 🟢 极低 | `run()` 未传入 callerSessionId 时 `callerSessionId=undefined`，`cmdInit` 中 `opts['session-id'] \|\| undefined \|\| env \|\| PENDING_ROOT` 自然退化到原行为。向后兼容 |
| **CLI 直接调用** | 🟢 极低 | CLI 走 `engine.run(cmd, args)` 不传 callerSessionId，参数为 undefined，与原行为一致。金标准测试全部走 CLI 路径，不受影响 |
| **callerSessionId 是 MCP wrapper session 而非 root 自己的 session** | 🟢 极低 | 这是设计意图——tree_init 的调用者就是 root session，MCP wrapper 注入的 callerSessionId 就是 root 的 session_id。不存在身份错配 |
| **PENDING_ROOT 遗留** | 🟢 极低 | PENDING_ROOT 仍需保留作为最终兜底（环境变量未设且 MCP 异常时）。已有 `leaf set-session` 修正路径（行 2117），不影响现有流程 |
| **`PROMA_SESSION_ID` 环境变量优先级争议** | 🟡 低 | 原优先级 `--session-id > PROMA_SESSION_ID > PENDING_ROOT`。新插入了 `callerSessionId` 在 `PROMA_SESSION_ID` 之前。理由是：MCP 注入的 callerSessionId 比环境变量更精确（环境变量可能在多树场景中过期）。如果团队认为环境变量应优先，可调整为 `--session-id > PROMA_SESSION_ID > callerSessionId > PENDING_ROOT` |

### 3.4 工作量

| 项目 | 估算 |
|------|------|
| `dispatch` 行 5261 改动 | **1 行**（透传参数） |
| `cmdInit` 行 739 签名改动 | **1 行**（加参数） |
| `cmdInit` 行 815 优先级改动 | **1 行**（插入 callerSessionId） |
| 注释更新 | 2–3 行 |
| 测试验证 | 需验证：① MCP 树 init 自动绑定 ② CLI 向后兼容 ③ --session-id 显式覆盖 ④ PROMA_SESSION_ID 兜底 |
| **总工作量** | **~5 行代码 + 测试，<1 小时** |

### 3.5 实施大纲

**Step 1** — `cmdInit` 签名加参：

```javascript
// 行 739
async function cmdInit(args, callerSessionId) {
```

**Step 2** — `dispatch` 透传：

```javascript
// 行 5261
case 'init': return await cmdInit(args, callerSessionId);
```

**Step 3** — `cmdInit` 内优先级调整：

```javascript
// 行 815
// 旧: const rootSessionId = opts['session-id'] || process.env.PROMA_SESSION_ID || PENDING_ROOT;
// 新:
const rootSessionId = opts['session-id'] || callerSessionId || process.env.PROMA_SESSION_ID || PENDING_ROOT;
```

**Step 4** — 更新行 814 注释，说明新的四级降级逻辑。

**Step 5** — `buildInitTips()` 中 `root_leaf.is_pending` 提示更新：`is_pending: rootSessionId === PENDING_ROOT` 逻辑不变，但兜底到 PENDING_ROOT 的概率将大幅下降。

### 3.6 优先级推荐：**P0（极低风险 + 极小工作量 + 高收益）**

消除 oeval-macp2 观察员实际撞到的 PENDING_ROOT 死锁，大幅降低新用户入树门槛。

---

## 四、P2-A：tree_init 校验 tree_id 前缀规则

### 4.1 建议原文

> `tree_init` 校验 tree_id 符合 prefix 规则（`[a-z][a-z0-9_]{3,7}` 无连字符），否则拒绝。

### 4.2 可行性：**高（已有完全相同的校验逻辑可复用）**

**现状**：

- `LEAF_NAME_RE` (行 47)：`/^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$/`
  - prefix 段：`[a-z][a-z0-9_]{3,7}` → 4–8 字符，小写开头，字母/数字/下划线，**无连字符**
- `cmdInit` (行 754–758) 已有 `root_brief.prefix` 的前置校验：
  ```javascript
  const PREFIX_RE = /^[a-z][a-z0-9_]{3,7}$/;
  if (root_brief.prefix !== undefined && !PREFIX_RE.test(root_brief.prefix)) {
    throw new TreeStateError(E_NAME_INVALID, ...);
  }
  ```
- 但 `tree_id` 自身仅校验 `/[\\/\s]/`（行 725），**不匹配 PREFIX_RE**
- 后果：`tree_id="oeval-macp2"`（含连字符）→ `tree_init` 通过 → `leaf_add` 时 leaf_id="oeval-macp2-root" 被 `LEAF_NAME_RE` 拒绝（prefix 段 `oeval-macp2` 含连字符）→ `E_NAME_INVALID`

**改动方案**：在 `cmdInit` 中，复用已有的 `PREFIX_RE`，对 `tree_id` 做前置校验。

### 4.3 风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| **现有树兼容性** | 🟡 低 | 需检查现有所有树（macp/macp2/nanju/sweng 等）的 tree_id 是否满足 `[a-z][a-z0-9_]{3,7}`。已知：macp→✅、macp2→✅(5字符)、nanju→✅、sweng→✅。oeval-macp2→❌ 含连字符，但它是观察树且已发现该问题，正应被拦截。**无现有活跃树受影响** |
| **未来 tree_id 命名自由度下降** | 🟢 极低 | 约束从"无路径分隔符"升级为"4-8 字符小写/数字/下划线"。这是 leaf_id 正则已要求的，只是前置到 init 拦截 |
| **4 字符最小长度过严？** | 🟢 极低 | 当前最常用 tree_id（macp/macp2/nanju/sweng）均 4-5 字符，4 字符下限合理 |

### 4.4 工作量

| 项目 | 估算 |
|------|------|
| `cmdInit` 加校验 | **4 行**（紧接 tree_id 基本校验之后） |
| 错误消息 | 1 行 |
| 测试验证 | 验证 tree_id="test"✅、"ab"❌、"my-tree"❌、"ABCDEFGH"❌ |
| **总工作量** | **~5 行代码，<30 分钟** |

### 4.5 实施大纲

**Step 1** — 在 `cmdInit` 中，紧接 `treeDir(tree_id)` 调用前（~行 744）或紧接 `if (!tree_id)` 之后，加入：

```javascript
// tree_id 前置校验：必须满足 prefix 规则（与 LEAF_NAME_RE prefix 段一致）
// [a-z][a-z0-9_]{3,7} — 4-8 字符，小写开头，字母/数字/下划线，无连字符
// 防止 tree_id="oeval-macp2" 这类含连字符的名字在 init 通过、leaf_add 才炸
const PREFIX_RE = /^[a-z][a-z0-9_]{3,7}$/;
if (!PREFIX_RE.test(tree_id)) {
  throw new TreeStateError(
    E_NAME_INVALID,
    `tree_id "${tree_id}" must match [a-z][a-z0-9_]{3,7} (4-8 chars, lowercase start, letters/digits/underscores only, no hyphens). This is because tree_id becomes the prefix segment of all leaf names (e.g. "${tree_id}-root"). Hyphens (like "my-tree") will cause leaf_add E_NAME_INVALID.`
  );
}
```

**注**：`PREFIX_RE` 已在同函数行 755 定义，可直接上提作用域复用，避免重复定义。

### 4.6 优先级推荐：**P2（低优先级但零风险）**

不影响核心业务，但消除“init 通过 + leaf_add 才炸”的不一致体验。应在 P0-A/P0-B 之后顺手修复。

---

## 五、引擎层整体方案

### 5.1 改动汇总

| 建议 | 函数 | 改动量 | 风险 | 优先级 |
|------|------|--------|------|--------|
| **P0-A** | 无需改动（引擎已支持） | 0 行 | 🟢 | P0（SKILL 层执行） |
| **P0-B** | `dispatch` + `cmdInit` | ~5 行 | 🟢 | P0 |
| **P2-A** | `cmdInit` | ~5 行 | 🟢 | P2 |

### 5.2 推荐执行顺序

```
Phase 1 (立即) ─────────────────────────────────────────────
  P0-B: tree_init 自动绑定 caller session (5行, <1h)
  └─ 收益: 消除 PENDING_ROOT 死锁，新人第一体验改善
  └─ 依赖: 无
  
  P0-A: 引擎无需改动，更新 SKILL + 流程推广
  └─ 收益: commander 全自主 done 闭环
  └─ 依赖: P0-B 完成（root session 自动绑定后 init 更顺滑）
  └─ 验证: 下轮 macp3 中强制使用 auditor 委派四步流程

Phase 2 (顺手) ─────────────────────────────────────────────
  P2-A: tree_id 前缀校验前置 (5行, <30min)
  └─ 收益: 一致性体验
  └─ 依赖: 无
```

### 5.3 依赖关系

```
P0-B (tree_init 绑 session)
  │
  ├── P0-A (auditor 委派): 弱依赖——root session 绑定后，root fork auditor 的流程更自然
  │
  └── P2-A (tree_id 前缀校验): 无依赖，独立修改
```

### 5.4 关键风险总结

| 风险 | 关联建议 | 缓解措施 |
|------|---------|---------|
| **P0-A auditor 自审循环** | P0-A | 闸门3 已硬编码阻止自审（行 3093）。auditor 互审是设计允许的——auditor-B 的初始 pass 来自 root（闸门2）或上级已 done auditor（闸门3），无凭空产生路径 |
| **P0-A auditor 越权** | P0-A | `callerSessionId === audit_session_id` 校验 + call-log 审计追踪。auditor 是 root 背书的，作恶是信任问题非引擎缺陷 |
| **P0-B 外部调用无 caller** | P0-B | `callerSessionId` 为 `undefined` 时退化到原三级降级逻辑（`--session-id → PROMA_SESSION_ID → PENDING_ROOT`）。CLI/金标准测试完全向后兼容 |
| **P0-B PROMA_SESSION_ID 优先级** | P0-B | MCP 注入的 callerSessionId 比环境变量更精确。如团队有不同意见，可调整为 `--session-id > PROMA_SESSION_ID > callerSessionId > PENDING_ROOT` |
| **P2-A 现有树兼容** | P2-A | 已知所有活跃树（macp/macp2/nanju/sweng）均满足 4-8 字符小写规则。oeval-macp2 是观察树且正应被拦截 |

---

## 六、附录：关键源码引用

| 代码段 | 行号 | 说明 |
|--------|------|------|
| `LEAF_NAME_RE` | 47 | leaf 命名正则，prefix 段 `[a-z][a-z0-9_]{3,7}` |
| `PREFIX_RE` | 755 | root_brief.prefix 前置校验（与 LEAF_NAME_RE prefix 段一致） |
| `cmdInit` session_id 降级 | 815 | `--session-id → PROMA_SESSION_ID → PENDING_ROOT` |
| `dispatch` init case | 5261 | 未透传 callerSessionId（断点） |
| `resolveAuditorIndep` 闸门1 | 3031–3032 | root 自审放行 |
| `resolveAuditorIndep` 闸门2 | 3039–3065 | root 信任锚背书（R2 P1 死锁修复） |
| `resolveAuditorIndep` 闸门3 | 3066–3098 | 独立 auditor 六重校验 |
| `cmdAuditGate` caller 校验 | 3547–3552 | callerSessionId === audit_session_id |
| `run()` 签名 | 5636 | `run(cmd, args, treesRoot, callerSessionId)` |
| `registerSessionToState` | 945–948 | PENDING_ROOT 不占 session 配额 |
| `TREE_STARTUP_NOTICE` | 287–294 | 任务启动须知 |
| `buildInitTips` | 876–919 | init 返回值 tips 构造器 |

---

*论证完成: 2026-07-25 15:15 GMT+8*
*论证方: Proma Agent (Pi SDK) · 只读论证，未改引擎代码*
