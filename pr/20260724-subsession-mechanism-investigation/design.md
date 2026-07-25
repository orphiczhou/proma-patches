# PR 需求：子会话创建机制调研报告与改进方案

> 调研日期：2026-07-24 | 调研者：13cddc31（pi, delegationDepth=2）
> 触发：当前接力会话无法创建任何子会话，4 种机制全部被阻断

---

## 1. 问题现象

当前会话（`13cddc31`，pi 运行时，GLM-5.2）无法创建任何子会话：

| # | 机制 | 现象 | 用户期望 |
|---|------|------|---------|
| 1 | `mcp__collaboration__delegate_agent` | 工具可见但调用报错 "协作子会话不能继续创建新的子会话" | 可用 |
| 2 | `mcp__session__create_session` | 工具不在工具列表中 | 可用（用户记得有这个机制） |
| 3 | SDK `Agent` / `Task` 工具 | 工具不存在 | 可用（"进程内 SubAgent 任何会话都应该可以"） |
| 4 | `mcp__tree__tree_leaf_add` 等 | 工具不在工具列表中 | N/A（tree 系统专用） |

---

## 2. 根因分析

### 2.1 委派链追溯（从会话元数据确认）

```
ROOT  (8b402ab9, depth=0, ?runtime)
  └→ LEVEL 1  (07705a4e, depth=1, claude)  "Proma改造接力（pi兼容闭环后）"
      └→ LEVEL 2  (13cddc31, depth=2, pi)  "P0P1改进-接力会话"  ← 当前会话
```

当前会话 `delegationDepth=2`，是**二级委派孙会话**。

### 2.2 逐机制阻断根因

#### 机制 1：collaboration delegation — delegationDepth > 0 硬拦截

**代码位置**：`main.cjs` → `src/main/lib/agent-collaboration-utils.ts` → `assertCanCreateDelegation`

```typescript
function assertCanCreateDelegation(ctx, requestedCount = 1) {
  const parent = getAgentSessionMeta(ctx.sessionId);
  const delegationDepth = parent?.delegationDepth ?? 0;
  if (ctx.triggeredBy === "delegation" || delegationDepth > 0) {
    throw new Error("协作子会话不能继续创建新的子会话");
  }
  // ... max count check
}
```

当前会话 `delegationDepth=2 > 0` → **直接 throw**。

**⚠️ 额外发现——Pi 运行时注入条件不一致（伪可用陷阱）**：

| 运行时 | collaboration 注入条件 | 代码位置 |
|--------|----------------------|---------|
| **Claude** | `triggeredBy !== "delegation" && delegationDepth === 0` | L469229 |
| **Pi** | `triggeredBy !== "delegation"`（**不检查 delegationDepth**） | L469701 |

**后果**：Pi 运行时子会话（如本会话）能看到 collaboration 工具在工具列表中，但调用即 throw。Agent 被误导，浪费多轮调用试错。

#### 机制 2：mcp__session__* — 外部 MCP 被禁用

**配置位置**：`mcp.json`

```json
"proma-dev-session": {
  "type": "stdio",
  "command": "node",
  "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"],
  "enabled": false   ← 禁用
}
```

`proma-dev-session` MCP 提供了 `mcp__session__create_session` / `mcp__session__send_message` / `mcp__tree__*` 等工具。`enabled: false` 导致整套工具未注入。

**注意**：这个 MCP 是指向 dev 实例的（`--dev` 参数），即使在 release 会话中启用，创建的 session 也只能在 dev 实例上操作。

#### 机制 3：SDK Agent/Task — Pi 运行时不提供

Pi Agent SDK（OpenAI Responses 兼容层）不暴露 SDK 内置的 `Agent` / `Task` 工具。这些工具是 Claude Code SDK 的特性（`CLAUDE_CODE_ENABLE_TASKS`），用于进程内 SubAgent。

Pi 运行时通过 `__proma_getPiCustomTools__` 钩子注入自定义工具，但该钩子只注入 Proma 内置 MCP（automation / collaboration / proma-cloud），不注入 SDK Agent/Task。

#### 机制 4：tree MCP — 同机制 2

`mcp__tree__*` 工具由 `proma-dev-session` MCP 提供（指向 dev 实例），同样被 `enabled: false` 阻断。

---

## 3. 设计意图分析

Proma 当前的子会话创建机制有**三种正交路径**，各有设计边界：

| 路径 | 关系模型 | 深度限制 | 运行时限制 | 实例绑定 |
|------|---------|---------|-----------|---------|
| **collaboration delegation** | 父子（有 delegationDepth） | ≤1 层（root→child） | pi + claude | 同实例 |
| **session MCP** | 无关系（独立 session） | 无限制 | 需 MCP 启用 | 可跨实例（dev/pro） |
| **SDK Agent/Task** | 进程内（sidechain） | 无限制 | **仅 claude** | 同进程 |

用户的期望是这三种路径中**至少有一种可用**。但当前会话处于最差组合：
- delegationDepth=2 → collaboration 被拦
- MCP disabled → session MCP 不可用
- pi runtime → SDK Agent 不可用

---

## 4. 改进方案

### P0：修复 Pi 运行时 collaboration 注入条件不一致（伪可用陷阱）

**问题**：Pi 运行时不检查 delegationDepth 就注入 collaboration 工具，导致工具可见但不可用。

**改动**：

`src/main/lib/pi-agent-bridge.ts`（或等效位置），修改 Pi collaboration 注入条件：

```typescript
// BEFORE (L469701):
const collaborationAvailable = isBuiltinMcpUserEnabled("collaboration") 
    && !!ctx.workspaceId 
    && ctx.triggeredBy !== "delegation";

// AFTER:
const collaborationAvailable = isBuiltinMcpUserEnabled("collaboration") 
    && !!ctx.workspaceId 
    && ctx.triggeredBy !== "delegation"
    && (ctx.sessionMeta?.delegationDepth ?? 0) === 0;  // 与 claude 对齐
```

**效果**：深度 >0 的 Pi 子会话不再看到 collaboration 工具，避免误导。

**风险**：低。纯前置过滤，不影响任何现有功能。

---

### P1：collaboration 不可用时给出明确提示

**问题**：当前 collaboration 工具被移除后，Agent 完全不知道为什么不能委派，也不知道有什么替代方案。

**改动**：在系统提示词注入逻辑中，当 `collaborationAvailable=false` 且会话是子会话时，追加提示：

```text
⚠️ 当前会话是协作子会话（delegationDepth={depth}），不能继续创建 collaboration 子会话。
替代方案：
1. 请父会话创建子会话（通过 mcp__collaboration__delegate_agent）
2. 或用户手动开新会话
3. 或启用 proma-dev-session MCP 后用 mcp__session__create_session
```

---

### P2：允许有条件的二级委派

**问题**：当前 `assertCanCreateDelegation` 硬编码 `delegationDepth > 0` 即拦。但实际场景中，grandchild 委派 grandson 有时是合理的（如三层树形任务 root→commander→worker）。

**改动方向**：

```typescript
const MAX_DELEGATION_DEPTH = 3; // 允许到第 3 层（root→child→grandchild→great-grandchild）

function assertCanCreateDelegation(ctx, requestedCount = 1) {
  const parent = getAgentSessionMeta(ctx.sessionId);
  const delegationDepth = parent?.delegationDepth ?? 0;
  if (ctx.triggeredBy === "delegation" && delegationDepth >= MAX_DELEGATION_DEPTH) {
    throw new Error(`已达到最大委派深度 ${MAX_DELEGATION_DEPTH}，不能继续创建子会话`);
  }
  // ...
}
```

**风险**：中。需要评估：
- Token 成本：多级委派可能导致并发会话爆炸（macp2 事故教训）
- 上下文追踪：grandchild 的结果需要逐级上报
- 建议：配合 max_sessions 限制 + heartbeat 监控

---

### P2：session MCP 的多实例支持

**问题**：`proma-dev-session` MCP 硬编码了 `--dev` 参数，只能操作 dev 实例。如果用户想在 release 会话中创建 release 实例的 session，没有对应 MCP。

**改动方向**：
- 提供一个不绑定实例的 session MCP（使用当前实例的 IPC channel）
- 或让 session MCP 的实例参数可配置（`--release` / `--dev` / `--pro`）

---

## 5. 用户即时解决方案（不改代码）

当前会话要创建子会话，有三个 workaround：

| 方案 | 操作 | 代价 |
|------|------|------|
| **A. 用户手动开新会话** | 在 Proma UI 点"新建会话"，粘贴提示词 | 无父子关系，结果靠人工搬运 |
| **B. 启用 proma-dev-session MCP** | 在 Proma 设置中启用该 MCP，重启会话 | 创建的 session 在 dev 实例上 |
| **C. 从父会话（level 1）委派** | 在父会话 07705a4e 中用 delegate_agent 创建 | 需要父会话还在线 |

---

## 6. 附录：代码位置索引

| 文件 | 行号 | 内容 |
|------|------|------|
| `main.cjs` | 467697-467699 | `assertCanCreateDelegation` — 委派深度拦截 |
| `main.cjs` | 469229 | Claude 运行时 collaboration 注入条件 |
| `main.cjs` | 469701 | Pi 运行时 collaboration 注入条件（缺 depth 检查） |
| `main.cjs` | 467960-468010 | `startDelegation` — 实际创建委派子会话 |
| `main.cjs` | 467986 | `delegationDepth: (parent?.delegationDepth ?? 0) + 1` — 深度递增 |
| `main.cjs` | 468350-468460 | `buildPiCollaborationTools` — Pi collaboration 工具定义 |
| `mcp.json` | - | `proma-dev-session` enabled:false |
