# macp4 引擎层改进论证报告

> **论证对象**：tree-engine.cjs + prompa-dev-patches.cjs（harness 引擎层，3 项）
> **论证方**：引擎层改进论证员
> **依据**：macp3 最终评估报告（`06_TESTS/macp3-tree-evaluation-final-2026-07-25.md`）
> **时点**：2026-07-25 21:35 GMT+8
> **约束**：只读论证，不改代码。聚焦 harness，不碰项目实现（coder/judge 是样本项目）

---

## 一、引擎层整体方案

| 优先级 | 编号 | 议题 | 改动文件 | 估计行数 | 依赖 |
|--------|------|------|----------|----------|------|
| 🔴 P0 | P0-E | root role done 门禁 | tree-engine.cjs | ~6 行 | 无 |
| 🔴 P0 | P0-D | session 重连/fork MCP 注入一致性 | patches.cjs + 需 Proma app 配合 | ~3 行（patches）+ app 侧 | 无 |
| 🟡 P1 | P1-B | E_NO_OWNERSHIP 中转优化 | patches.cjs | ~12 行 | 无 |

**推荐执行顺序**：P0-E → P0-D → P1-B（无相互依赖，可并行）

---

## 二、🔴 P0-E：root role done 门禁（新头号）

### 2.1 现象复述

macp3 root（`macp3-root`，role=root）在实现层 100% 完成（7 worker 全 done，所有 milestone audit_pass=true）后，调用 `set-status done` 撞 `E_SCHEMA_INVALID`。root 0 milestones + role=root 无 L1767 豁免。

### 2.2 根因分析（代码级复盘）

#### 2.2.1 `cmdLeafSetStatus` 的 done 门禁链路（tree-engine.cjs L1710-1930）

进入 `new_status === 'done'` 块后的校验顺序：

```
1. isAuditor = (leaf.role === 'auditor')   → root = false
2. if (!isAuditor) {                        → root 进此块
3.   ms.length === 0                        → ROOT 0 MILESTONES → 💥 E_SCHEMA_INVALID
     所有 milestone audit_pass=true
     expect_outputs 非空 + 文件存在性
   }
4. (isAuditor 闭合)
5. worker/auditor brief_echo+done 双事件检查 → root 不受此限
6. review_round 收敛检查                   → root 不受此限
7. audit_gate 检查                         → root audit_gate.verdict='skip' 不触发
8. done event 存在性检查                    → root 需要有 done event
9. commander/root children 检查             → root 不会走到这里（已在第 3 步炸）
```

**关键发现**：`isAuditor` 豁免是当前唯一绕过 milestone 门禁的路径。`role=root` 不在豁免范围内，必须经过完整的 milestone→deliverables 门禁链。root 没有 milestones（也不应该有一一 root 是信任锚，不产出交付物），在 `ms.length === 0` 处被拦截。

#### 2.2.2 `cmdEventAppend` 的 root auto_upgrade（tree-engine.cjs L2753-2772）

```javascript
// L2753-2772
if (opts.type === 'done' && leaf.role === 'root') {
  const curGate = leaf.audit_gate;
  const callerIsRootSelf = !callerSessionId || callerSessionId === leaf.session_id;
  if ((!curGate || curGate.verdict === 'skip') && callerIsRootSelf) {
    leaf.audit_gate = {
      verdict: 'pass',
      auditor_session_id: leaf.session_id,
      ts: nowIso(),
      auto_upgrade: true
    };
  }
}
```

**auto_upgrade 的工作原理**：
- 触发条件：root 自己写 done event + audit_gate.verdict==='skip'
- 效果：自动把 audit_gate 从 `skip` 升级为 `pass`（auditor=root.session_id, auto_upgrade=true）
- 目的：解决"鸡生蛋"——root 是信任锚，没有上游 auditor，不应要求外部调 audit_gate

**auto_upgrade 为什么在 macp3 没生效？**

**不是 auto_upgrade 没生效——它生效了，但只解决了 audit_gate 问题。** macp3 的失败链路是：

```
1. root 写 done event                     → auto_upgrade 触发，audit_gate: skip→pass ✅
2. root 调 set-status done                → cmdLeafSetStatus 检查 milestones
3. milestones.length === 0                → E_SCHEMA_INVALID ❌
```

auto_upgrade **只修改了 audit_gate**，没有修改 milestones。cmdLeafSetStatus 的里程碑检查在 audit_gate 检查**之前**执行（L1757-1842 先于 L1901-1906），root 在到达 audit_gate 检查前就已经因 milestones 为空而失败。

#### 2.2.3 代码位置确认

| 检查点 | 代码行 | 对 root 行为 |
|--------|--------|-------------|
| isAuditor 豁免 | L1757 | root=false，不进豁免 |
| milestones 非空 | L1759-1766 | root 0 milestones → **E_SCHEMA_INVALID** |
| deliverables 存在 | L1806-1840 | 未到达 |
| audit_gate 检查 | L1901-1906 | 未到达 |
| done event 存在 | L1914-1923 | 未到达 |
| children done | L1929-1957 | 未到达 |

### 2.3 修法 ①：cmdLeafSetStatus 对 role=root 豁免（推荐）

**改哪里**：`tree-engine.cjs` `cmdLeafSetStatus`，约 L1757

**怎么改**：在 `if (!isAuditor)` 之前或之内增加 root 豁免判断。

**方案 A（与 auditor 并列豁免）**：

```javascript
// 改动前（L1757）：
const isAuditor = leaf.role === 'auditor';
if (!isAuditor) {

// 改动后：
const isAuditor = leaf.role === 'auditor';
const isRoot = leaf.role === 'root';
if (!isAuditor && !isRoot) {
```

**方案 B（更精细——root 仅豁免 milestone/deliverables，保留 children 检查）**：

当前 children 检查（L1929-1957）独立于 `!isAuditor` 块之外，role=root 天然会经过。如果采用方案 A，root 将跳过 milestone/deliverables 检查，但 children 检查仍然执行（因为它在 `!isAuditor` 块闭合之后）。**这就是我们需要的行为**——root 不需要 deliverables（它是信任锚），但必须确保所有子节点完成。

**行数**：1 行（`if (!isAuditor)` → `if (!isAuditor && leaf.role !== 'root')`）

**风险**：root 绕过 deliverable 存在性检查——但 root 是信任锚，不产出交付物，跳过合理。唯一风险是 root 在 children 未完成时就 done，但 children 检查仍在生效（L1929），此风险已被覆盖。

**方案 B（安全网加码——root done 前必须 auto_upgrade 已触发）**：

```javascript
const isAuditor = leaf.role === 'auditor';
const isRoot = leaf.role === 'root';
if (!isAuditor && !isRoot) {
  // ... 原 milestone/deliverables 检查
}
// 在 isAuditor 闭合后，children 检查前，增加 root 的 auto_upgrade 验证：
if (isRoot) {
  const gate = leaf.audit_gate;
  if (!gate || !gate.auto_upgrade) {
    throw new TreeStateError(E_GATEKEEPER_REQUIRED,
      'root done requires auto_upgrade audit_gate (write a done event first to trigger auto_upgrade)');
  }
}
```

行数：~6 行。风险更低——root 不能绕过 auto_upgrade，必须走"写 done event → auto_upgrade upgrade → set-status done"的合规路径。

### 2.4 修法 ②：cmdEventAppend 增强 auto_upgrade

**核心思路**：让 auto_upgrade 不仅设置 audit_gate，还创建一个"虚拟 milestone"满足 cmdLeafSetStatus。

**问题**：这打破了 milestone 的语义（milestone 是交付物骨架）。root 不应该有里程碑——设置一个假里程碑（如 `{id: 'auto_upgrade_root_trust_anchor', ...}`）会让 tree-state.json 中出现工程噪音。

**行数**：~15 行。但与 milestone 语义矛盾，不推荐。

### 2.5 推荐：修法 ① 方案 A 或 B

| 维度 | 修法 ①-A（简单豁免） | 修法 ①-B（+auto_upgrade 验证） | 修法 ②（增强 auto_upgrade） |
|------|---------------------|-------------------------------|---------------------------|
| 行数 | 1 行 | ~6 行 | ~15 行 |
| 语义 | 干净——root 是信任锚，不需要里程碑 | 干净且安全 | 脏——创建假 milestone |
| 风险 | root 可能绕过 done event 要求？不会——done event 存在性检查（L1914）独立于 milestone 块，root 也要过 | 更低——强制要求 done event→auto_upgrade 路径 | milestone 噪音 |
| 实施建议 | **如果确认 L1914 done event 检查生效**，直接上 ①-A | **防御性首选**——最安全 | 不推荐 |

**实际代码确认**（L1914-1923）：done event 存在性检查在 `!isAuditor` 闭合**之后**，role=root 一定会经过：

```javascript
// L1914-1923，在 isAuditor 块闭合之后
{
  const evs = Array.isArray(leaf.events) ? leaf.events : [];
  const hasDone = evs.some((e) => e && (e.type === 'done' || e.event_type === 'done'));
  if (!hasDone) {
    throw new TreeStateError(E_STATUS_EVENT_MISMATCH, ...);
  }
}
```

**结论**：修法 ①-A（1 行）已足够安全——root 的完整 done 路径为：done event（触发 auto_upgrade）→ children done → set-status done。推荐实施 ①-A。

### 2.6 实施大纲

```diff
// tree-engine.cjs, cmdLeafSetStatus, ~L1757
-  const isAuditor = leaf.role === 'auditor';
-  if (!isAuditor) {
+  const isAuditor = leaf.role === 'auditor';
+  const isRoot = leaf.role === 'root';
+  if (!isAuditor && !isRoot) {
     // milestones / deliverables / expect_outputs 检查保持不变
   }
```

**工作量**：1 行修改 + 1 行注释。无测试回归风险——现有测试不覆盖 root done 场景（root 此前无法 done）。

**优先级**：P0-E。macp3 闭环的最后一道门。macp4 必须在第一轮就修好。

---

## 三、🔴 P0-D：session 重连/fork MCP 注入一致性

### 3.1 现象复述

macp3 出现两次 MCP 工具注入不稳：

1. **auditor fork 后误读**：auditor（MiniMax-M3）fork 后第一次检查工具列表，发现"工具只剩 proma_cloud"（实际 `session`/`tree`/`remote-session` 三组都已注入）
2. **root 重连后误报**：root 在重连后第一次检查，误报"tree/session 未注入"（17:45 自纠）

两次误读共浪费 5+ 分钟。

### 3.2 根因分析

**注入链路**（patches.cjs）：

```
Proma app（main.cjs）
  → __proma_getMcpServers__(sessionId, workspaceSlug, sdk)
    → createSessionMcpServer(sdk, z, sessionId)       // mcp__session__*
    → createRemoteSessionMcpServer(sdk, z)             // mcp__remote-session__*
    → __proma_createTreeMcpServer__(sdk, z, ws, sid)   // mcp__tree__*
```

**时序问题**：`__proma_getMcpServers__` 由 Proma app 在会话上下文初始化时调用。在以下场景存在时序窗口：

1. **fork 后**：fork 创建新 session → Proma app 为新 session 初始化上下文 → 调用 `__proma_getMcpServers__` 注入工具。但 Agent SDK 可能在 MCP 注入完成前就发送了第一条工具列表查询，导致看到的是内置 MCP 工具（如 `proma_cloud`/`automation`）而非 session/tree 工具。

2. **重连后**：会话重连时，Proma app 重新初始化上下文。如果 `__proma_getMcpServers__` 的执行晚于 Agent 的第一次工具调用，Agent 会看到不完整的工具列表。

**根因**：**Proma app 侧的 MCP 注入时序与 Agent SDK 上下文初始化之间存在竞态。** 这不是 patches.cjs 能独立修复的——`__proma_getMcpServers__` 本身是同步函数，但它被谁调用、何时调用、调用后 Agent 何时可见这些工具，取决于 Proma app 的会话生命周期管理。

### 3.3 为什么不是 patches.cjs 的 bug

`__proma_getMcpServers__` 的逻辑是正确的：它同步创建三个 MCP server 并返回。问题在于：

- **Proma app 可能在 Agent SDK 上下文初始化后才调用此 hook**，或 SDK 在 MCP 服务注册完成前就开始处理工具列表
- **fork 后的身份提示注入**（patches.cjs L1378-1430）通过 `runAgentHeadless` 向新会话发送消息——这可能在 MCP 工具注入尚未完成时就触发了 Agent 的第一次思考

### 3.4 可行修复（三层面）

#### 层面 1：patches.cjs 防御（低工作量，不根治但减少概率）

在 fork 身份提示注入前，增加一个小延迟确认 MCP 工具就绪：

```javascript
// 在 fork_session handler 中，identityPrompt 注入前
// 增加短暂延迟，等待 Proma app 完成新 session 的 MCP 注入
await new Promise(r => setTimeout(r, 2000)); // 2s 等待 MCP 注入完成
```

**行数**：~3 行。**风险**：不可靠（竞态缓解非根治），且增加每次 fork 的固定延迟 2s，影响体验。

#### 层面 2：Proma app 侧时序修复（根治，需 app 配合）

**方案**：确保 `__proma_getMcpServers__` 在 Agent SDK 上下文就绪**之前**完成注入。

具体实现可以是：
- 在 Proma app 的 session 初始化流程中，将 MCP 工具注入提前到 SDK context provider 创建之前
- 或者在 SDK context provider 中增加工具就绪确认机制

这个改动在 Proma app（main.cjs / Electron 主进程），不在 patches.cjs。**需要与 Proma app 开发协调。**

#### 层面 3：Agent SKILL 防御（零改动，短期 mitigation）

在 tree-commander/tree-worker SKILL 中增加：
- fork 后/重连后首次对话，先调用 `mcp__session__get_my_session_id` 验证 session 工具可用
- 如果不可用（返回 error），等待 5s 后重试

**行数**：0 引擎改动。**风险**：治标不治本。

### 3.5 推荐方案

| 方案 | 根治性 | 工作量 | 风险 |
|------|--------|--------|------|
| 层面 1（patches 延迟） | ⭐⭐ 缓解 | 3 行 patches | 不可靠 + 增加延迟 |
| 层面 2（Proma app 时序） | ⭐⭐⭐ 根治 | app 侧改动 | 需跨团队协调 |
| 层面 3（SKILL 防御） | ⭐ 绕过 | 0 行 | 所有 tree agent 需加载新 SKILL |

**推荐**：**层面 1（patches 短期缓解）+ 层面 2（Proma app 长期根治）**。

- macp4 立即做：在 fork identity prompt 前加 2s 延迟（3 行），降低 macp4 期间的误读概率
- 标记为"需 Proma app 配合"的 tech debt，在后续版本中根治

### 3.6 实施大纲

```diff
// patches.cjs, fork_session handler, identityPrompt 注入前
+      // P0-D mitigation: 等待 MCP 工具注入完成（fork 后存在时序窗口，
+      //   Agent 可能在 session/tree MCP 就绪前就开始查询工具列表）
+      await new Promise(r => setTimeout(r, 2000));
       let identityStatus = 'failed';
       try {
         await new Promise((resolve) => {
```

**工作量**：3 行 patches.cjs。无测试回归风险（现有测试不覆盖 fork 后工具就绪时序）。

**优先级**：P0-D。降低 macp4 期间的 MCP 误读概率，但需标注"长期方案需 Proma app 配合"。

---

## 四、🟡 P1-B：E_NO_OWNERSHIP 中转优化

### 4.1 现象复述

macp3 中，commander（`macp3-A-commander`，parent=root）和 auditor（`macp3-X-auditor`，parent=root）同为 root 的子节点。send_message 从 commander 到 auditor 被 `assertOwnership` 拒绝（E_NO_OWNERSHIP），必须由 root 中转：

```
commander → root（R3 upstream 允许）→ auditor（R2 downstream 允许）
```

代价：
- auditor 17:23 done 后空闲 26+ 分钟才接到首个审查请求
- C2 遗漏异厂商审查（走 root 自审，可能是中转遗漏）

### 4.2 根因分析

#### 4.2.1 `assertOwnership` 的判定规则（patches.cjs L731-807）

```javascript
function assertOwnership(sourceSid, targetSid, action) {
  // R1: 自循环 → allow
  // R2: target.parent==source → allow (downstream)
  // R3: source.parent==target → allow (upstream)
  // R4: 祖先链 → allow (multi-hop lineage)
  // R5: 系统特权 (automation) → allow
  // 老会话兼容: 双方无 parentSessionId → send allow+audit
  // 其他 → E_NO_OWNERSHIP
}
```

**commander→auditor 的判定**：
- commander.parent=root, auditor.parent=root
- R1: source≠target ❌
- R2: auditor.parent !== commander ❌（auditor.parent=root, 不是 commander）
- R3: commander.parent !== auditor ❌（commander.parent=root, 不是 auditor）
- R4: commander 和 auditor 无共同祖先链（parent 相同但不是同一链）❌
- → **E_NO_OWNERSHIP**

#### 4.2.2 为什么 sibling 被禁用

层1加固的设计原则是**基于血缘的权限模型**：只有 parent-child 或祖先-后代关系才允许通信。这是为了堵"任意 Agent 可给任意其他 Agent 注入消息"的漏洞。sibling 之间没有直接血缘关系（有共同 parent 但不构成 ancestor 链）。

### 4.3 修法 ①：开放兄弟通信（auditor role 白名单）

**改哪里**：`patches.cjs` `assertOwnership`，在 R4 和 R5 之间插入新规则

**怎么改**：

```javascript
// R4.5-sibling-auditor: 兄弟 leaf 间允许 send_message 当 target 是 auditor
//   commander→auditor 场景：双方 parent 相同，target.role=auditor →
//   允许 send（auditor 不产出任务，只审不写，低风险）
//   限制：仅 send 动作（不能 fork/archive auditor）
if (action === 'send' && srcMeta && tgtMeta) {
  const srcParent = srcMeta.parentSessionId;
  const tgtParent = tgtMeta.parentSessionId;
  if (srcParent && tgtParent && srcParent === tgtParent) {
    // 同一 parent，是兄弟节点
    // 需要 tgt 是 auditor（白名单角色）
    // 需要确认 tgt 的 leaf role（从 tree-state 查，或从 meta 推断）
    if (tgtMeta.treeRole === 'auditor' || isAuditorLeaf(tgtMeta)) {
      return { allow: true, rule: 'R7-sibling-auditor', audit: true,
        reason: 'sibling communication to auditor leaf (same parent, target is auditor)' };
    }
  }
}
```

**问题**：`assertOwnership` 基于 `agentSessionMeta`，而 `agentSessionMeta` 不一定包含 `treeRole` 字段（leaf role 在 tree-state.json 中，不在 session meta 中）。需要跨数据源查询。

**替代方案**：不查 `treeRole`，改为查 target 的 session meta 是否有特殊标记（如 `role: 'auditor'` 在主进程中可注入到 session meta）。

**行数**：~12 行（含 helper）。**风险**：
- 如果实现不稳定（白名单判断依赖跨系统查询），可能引入新的拒绝场景
- 兄弟 leaf 中的 worker 也可能获得 auditor 通信权限（需要严格限定到 auditor role）
- 依赖 `treeRole` 在 session meta 中的存在性（当前可能不存在）

### 4.4 修法 ②：auditor 改 root 子树（结构重组）

**思路**：让 auditor 的 parent=commander（或 parent=root 但加到 commander 的子树下），使 commander→auditor 构成 R2（downstream）。

**问题**：
- 如果 auditor.parent=commander，则 auditor 不能独立审查 commander 的行为（利益冲突——auditor 不能审查自己的父节点）
- macp3 的结构是 root→commander（3 个）+ root→auditor（1 个）——auditor 需要独立于被审查方

**结论**：不推荐。破坏了 auditor 的独立性设计。

### 4.5 修法 ③：SKILL 固化中转 + 待审清单（引擎零改动）

**思路**：
1. tree-commander SKILL 中增加中转协议模板
2. root 主动维护"待审 worker 清单"，确保每个 worker done 后 root 立即转发给 auditor
3. root 在通信日志（`tree_log_communication`）中记录每条中转

**P1-2 通信日志工具**（`tree_log_communication` / `tree_communication_list`）已经在 tree-engine.cjs 中实现（2026-07-24 macp 实战后），可让心跳感知通信活动。

**行数**：0 引擎改动（SKILL 改动，不在本论证范围）。

**风险**：
- 依赖 root 的主动性和正确性（macp3 的 root 已经做了中转，但 C2 仍然遗漏——人工中转不可靠）
- 不解决延迟问题（root 需要主动轮询/监听 worker done → 转给 auditor）

### 4.6 推荐方案

| 维度 | 修法 ①（兄弟白名单） | 修法 ②（改树结构） | 修法 ③（SKILL） |
|------|---------------------|--------------------|-----------------|
| 根治性 | ⭐⭐⭐ 根治——commander 可直连 auditor | ⭐ 打补丁——破坏独立性 | ⭐ 绕过 |
| 行数 | ~12 行 | 0（结构改动不在引擎） | 0 |
| 风险 | 需要查 treeRole（跨数据源）；白名单可能遗漏边界 | auditor 失去独立性 | 人工中转不可靠 |
| 实施建议 | **推荐**——增加 R7-sibling-auditor 规则 | 不推荐 | 作为修法 ① 的 fallback |

**推荐**：**修法 ①（兄弟白名单）+ 修法 ③（SKILL 防御纵深）**。

修法 ① 的实现细节建议：
1. 在 `agentSessionMeta` 中增加 `treeRole` 字段（由 leaf_add 时 `updateAgentSessionMeta` 写入）
2. 或改为在 `assertOwnership` 中调 tree-engine 查询 leaf role（更重但更可靠）
3. 白名单规则：**仅当 target 的 session 对应 tree leaf 的 role=auditor 时，允许兄弟间 send_message**

### 4.7 实施大纲

**Step 1（patches.cjs）**：在 leaf_add 时写入 `treeRole` 到 session meta：

```diff
// patches.cjs, leaf_add handler (tree MCP 工具路径)
+  // P1-B: 写入 treeRole 到 session meta，供 assertOwnership 兄弟白名单判定
+  try {
+    a.updateAgentSessionMeta(leaf.session_id, { treeRole: role });
+  } catch (_) { /* non-fatal */ }
```

**Step 2（patches.cjs）**：在 `assertOwnership` 中增加 R7-sibling-auditor：

```javascript
// 在 R4 和 R5 之间插入
// R4.5-sibling-auditor (P1-B, 2026-07-25): 兄弟 leaf 间允许 send_message 
//   当 target 的 treeRole 是 auditor 时。commander→auditor 是标准场景：
//   双方 parent 同为 root，auditor 只审不写，开放 send 低风险。
//   仅 send 动作开放（fork/archive auditor 仍需要血缘）。
if (action === 'send' && srcMeta && tgtMeta) {
  const srcParent = srcMeta.parentSessionId;
  const tgtParent = tgtMeta.parentSessionId;
  if (srcParent && tgtParent && srcParent === tgtParent &&
      tgtMeta.treeRole === 'auditor') {
    return { allow: true, rule: 'R7-sibling-auditor', audit: true,
      reason: `sibling→auditor: commander→auditor direct send (same parent, target role=auditor). P1-B transit optimization.` };
  }
}
```

**行数**：~8 行 patches.cjs + ~4 行 leaf_add handler。共计 ~12 行。

**风险**：
- auditor 白名单安全：仅 `send` 动作（不能 fork/archive auditor），且通信留审计日志（`audit: true`）
- 不开放给其他 sibling role（worker/commander 之间的 sibling 通信仍被拦）

**优先级**：P1-B。不阻塞 macp4 核心流程（中转协议已 work），但显著提升 auditor 响应速度。

---

## 五、风险点总结

| 风险 | 影响项 | 缓解措施 |
|------|--------|----------|
| root 绕过 done 门禁自签 | P0-E | done event 存在性检查（L1914）+ children 检查（L1929）仍在生效；root 无法跳过这两道 |
| auditor 兄弟通信解禁副作用 | P1-B | 仅限 `send` + `treeRole=auditor` 白名单；`fork`/`archive` auditor 仍需血缘 |
| fork 后 MCP 注入不完整 | P0-D | 2s 固定延迟仅缓解不根治；长期需 Proma app 配合修复时序 |
| treeRole 字段不存在于 session meta | P1-B | 需要先在 leaf_add 时写入；存量 leaf 需要 migration 或 fallback 到 tree-state 查询 |

---

## 六、附录：关键代码位置索引

| 描述 | 文件 | 行号 |
|------|------|------|
| cmdLeafSetStatus done 门禁 | tree-engine.cjs | L1710-1957 |
| └ isAuditor 豁免判断 | tree-engine.cjs | L1757 |
| └ milestones 非空检查 | tree-engine.cjs | L1759-1766 |
| └ deliverables 存在检查 | tree-engine.cjs | L1806-1840 |
| └ done event 存在检查 | tree-engine.cjs | L1914-1923 |
| └ children done 检查 | tree-engine.cjs | L1929-1957 |
| cmdEventAppend root auto_upgrade | tree-engine.cjs | L2753-2772 |
| assertOwnership 核心 | patches.cjs | L731-807 |
| └ E_NO_OWNERSHIP 降级 | patches.cjs | L798-807 |
| send_message handler | patches.cjs | L1481-1580 |
| fork_session handler | patches.cjs | L1238-1430 |
| __proma_getMcpServers__ hook | patches.cjs | L1997-2013 |
| __proma_getPiCustomTools__ hook | patches.cjs | L2033-2052 |

---

*论证完成：2026-07-25 21:35 GMT+8*
*论证方：引擎层改进论证员（只读，未改代码）*
