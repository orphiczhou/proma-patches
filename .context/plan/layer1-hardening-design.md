# 层1加固设计 — patches.cjs 身份冒用根治方案

> **纯设计文档（research 协作子 Agent 产出），不含代码改动。**
> 范围：`proma-dev-patches.cjs` 的 `mcp__session__*`（send_message / fork_session / create_session / archive_session）+ `mcp__remote-session__*` 身份冒用根治。
> 设计目标：**caller ownership 校验**，堵冒用同时零误伤现有 tree-commander/worker、session-management、remote-session 合法用法。
> 日期：2026-06-27。

---

## 0. TL;DR（核心规则摘要）

身份注入层（sourceSessionId 闭包）**已可信**，漏洞纯在工具层。根治 = 给 `send_message / fork_session / archive_session` 加 **caller ownership 校验** + 让 `create_session / fork_session` 写 **parentSessionId 血缘**。核心规则是**双向血缘 + 自循环 + 系统特权 + 同工作区降级**：

```
允许 send_message(source→target) 当满足任一:
  R1  source === target                         # 自循环（竹节交接 fork 自己 / worker 给自己总结）
  R2  target.parentSessionId === source          # 下行认领（commander→worker、worker→reviewer）
  R3  source.parentSessionId === target          # 上行回报（worker→commander）
  R4  祖先链命中（target 在 source 的后代链 / source 在 target 的后代链，≤MAX_DEPTH）
  R5  caller 为系统特权（triggeredBy=automation 且 workspace 一致）  # 心跳巡检
  R6  外部/跨实例降级（sourceSessionId==null 或 remote → 同 workspace 内 allow + 审计日志）
否则: 返回 E_NO_OWNERSHIP，拒绝，记审计日志。
```

**关键洞察**：必须区分两个字段——`parentSessionId`（谁**拥有/创建**了我，create_session 和 fork_session 都写）vs `forkSourceSdkSessionId`（官方已有，sdkSession 级技术血缘，仅 fork 写，不能用于 ownership）。当前 create_session 不写任何血缘 → commander 认领不了自己建的 worker → **必须补写 parentSessionId**。

---

## 1. 漏洞确认（精确定位）

调研 patches.cjs（2758 行，未加固版，12:53）与官方源码 `session-mcp.ts` 对比，两者**逻辑一致**，漏洞相同：

| 工具 | 位置 | 漏洞 |
|---|---|---|
| `send_message` | L709-862，校验点 L712-715 | 仅 `getAgentSessionMeta(args.session_id)` 查 target 存在，**无 sourceSessionId→target 权限校验**。Agent A 可给任意 session B 注入 user message（冒充用户指令、污染 B 的上下文/产出）。 |
| `fork_session` | L506-707，校验点 L509-512 | 仅 `getAgentSessionMeta(args.source_session_id)` 查 source 存在，**无 caller→source 权限校验**。Agent A 可 fork 任意 session B → **窃取 B 完整对话上下文**（最严重，等于复制 B 的全部记忆/密钥/决策）。返回只回 `source_session_id`（L693），**不写 parentSessionId 血缘**。 |
| `create_session` | L459-504 | 创建全新 session，无血缘写入（commander 建的 worker 无法被 ownership 认领）。 |
| `archive_session` | L864-872 | 仅查 target 存在，**无 ownership**。任何 agent 可归档任何 session（DoS / 破坏协作链）。 |
| `remote_*` | L882-979 | `createRemoteToolHandlers()` 完全不接受 sourceSessionId，跨实例无身份；远端 HTTP bridge 用 `createToolHandlers(null)`（L1148），远端 ownership 校验拿到的是 null。 |

**身份冒用根因（一句话）**：`sourceSessionId` 是可信的服务端注入身份，但三个写工具从未用它做权限判定。

---

## 2. 数据模型现状（决定方案可行性）

调研官方 `agent-session-manager.ts`：

### 2.1 AgentSessionMeta 标准字段
```
id, title, channelId, modelId, workspaceId,
sdkSessionId, forkSourceDir, forkSourceSdkSessionId,
createdAt, updatedAt, pinned, archived,
permissionMode, attachedDirectories, attachedFiles,
resumeAtMessageUuid, stoppedByUser, completedButUnconfirmed, sourceAutomationId
```

### 2.2 关键发现：**没有任何 agentSession 级血缘字段**
- `createAgentSession(title, channelId, workspaceId, modelId)`（L99）签名**不接受 parent 参数**。
- `forkAgentSession`（L623）只写 `forkSourceSdkSessionId`（**sdkSession 级技术血缘**，用于定位 JSONL，不是 agentSession 级 ownership）。
- patches.cjs L2587（C-15 ruleC15）读的 `meta.sourceSessionId || source_session_id || forked_from` —— **官方三个字段都不写** → 当前这些字段恒为 undefined，C-15 实际从未触发（dead 字段）。
- 结论：**当前 meta 里没有任何可靠的 agentSession 级血缘**，ownership 校验必须**新建 parentSessionId 字段**。

### 2.3 updateAgentSessionMeta 运行时是 generic merge（关键可行性）
```ts
// agent-session-manager.ts L380
const updated = { ...existing, ...updates, ..., updatedAt: Date.now() }
```
TS 类型签名是白名单（`Partial<Pick<...>>`），但**运行时是 spread merge**，且 patches.cjs 是 `.cjs`（不经 TS 类型检查）→ **patches.cjs 可直接 `a.updateAgentSessionMeta(id, { parentSessionId, delegationDepth, triggeredBy })` 写入自定义字段，持久化到 sessions.json，下次 `getAgentSessionMeta` 能读回**。**无需改 main 源码数据模型。**

### 2.4 sourceSessionId 来源（身份可信性确认）
```js
// patches.cjs L1353 — 主进程按会话注入
global.__proma_getMcpServers__ = function (sessionId, workspaceSlug, sdk) {
  const server = createSessionMcpServer(sdk, z, sessionId);  // ← sessionId 闭包注入
  ...
}
```
`sessionId` 由 Proma 主进程在为该 agent 会话创建 MCP server 时注入，agent 无法篡改自己的身份。**已有先例**：`__proma_createTreeMcpServer__(sdk, z, workspaceSlug, sessionId)`（L1363）已透传 sessionId 到 tree-engine 做 `audit_gate` 的 `caller == audit_session_id` 校验（L1361 注释"堵借身份"）。**ownership 校验复用同一可信身份源，范式已验证。**

### 2.5 global.__proma__ 可用内省 API（从 patches.cjs 调用点穷举）
```
getAgentSessionMeta(id)          → 读完整 meta（含自定义字段，运行时全量）
updateAgentSessionMeta(id, upd)  → generic merge 写（可写自定义字段）
createAgentSession(...)          → 建新 session（无 parent 参数）
forkAgentSession(input)          → SDK 级 fork
listAgentSessions()              → 列全部（可遍历建血缘索引）
listAgentWorkspaces() / getAgentWorkspace(id)
getChannelById / listChannels
runAgentHeadless / stopAgent / isAgentSessionActive
getAgentSessionSDKMessages
```
> ⚠️ 注意：没有原生的"查祖先链"API，需用 `listAgentSessions()` + parentSessionId 在内存里遍历（sessions 总量小，O(深度) 可接受）。

---

## 3. 现有合法用法清点（**这些绝不能误伤**）

### 3.1 tree-commander（指挥官 / 根会话）— `skills/tree-commander/SKILL.md`
| 场景 | 调用 | source→target 关系 |
|---|---|---|
| 下发子会话 | `fork_session(parent)` 或 `create_session(...)` 建 worker/子commander | source=commander，target=新建会话（**create_session 建的 worker 当前无血缘**） |
| 下发任务/5件套 | `send_message(worker, notify=true)` | commander→worker（**下行**） |
| 轻档纠偏 nudge | `send_message(leaf.session_id, "nudge: ...")` (§7) | commander→worker（**下行**） |
| 中档限权 | `send_message + autonomy_override` (§7) | commander→worker（**下行**） |
| 重档剪枝 | `archive_session(worker)` + `fork_session(from=worker, up_to_uuid)` (§7) | commander 对 worker（**认领 + fork 自己的后代**） |
| 回填 alignment | `tree_event_append`（不经过 send_message，走 tree MCP） | — |

### 3.2 tree-worker（叶子会话）— `skills/tree-worker/SKILL.md`
| 场景 | 调用 | source→target 关系 |
|---|---|---|
| **上行事件上报** | `send_message(commander, notify=true)`，type∈{done, blocked, plan, brief_echo} (§3) | **worker→commander（上行，反向！）** |
| 内部自审 | Fork `code-reviewer` 子 Agent（§4.2，subagent_type） | worker→reviewer（**下行认领**） |
| 审计 worker Fork 子 Agent | `fork_session` 建 C1-C4/A1-A2 审查员 (§10.3) | worker→审查员（**下行认领**） |

> **铁律**：tree-worker `load_on: create_session`，`target: 子会话=create_session 创建；子 Commander=fork_session 创建`（§0）。即 **Worker = create_session 建的（当前无血缘字段），子 Commander = fork 建的**。

### 3.3 session-management（通用，非 tree）— `skills/session-management/SKILL.md`
| 模式 | 调用 | 关系 |
|---|---|---|
| 模式1 开小弟并行 | `create_session × N` + `send_message(wait=false) × N` | 主→小弟（**下行，依赖 create_session 写 parentSessionId**） |
| 模式2 深度探索 | `fork_session(自己, up_to_uuid)` + `send_message(新会话)` | **source===source 的 fork，自循环派生** |
| 模式3 竹节交接 | `send_message(自己,"总结")` + `fork_session(自己)` + `send_message(新会话)` | **自循环 + 下行认领** |
| 模式4 跨工作区 | `create_session(workspace_id=xxx)` | 主→新会话（**跨工作区认领**） |
| 模式5 归档清理 | `archive_session(session_id)` | 主→自己拥有/历史会话 |
| 模式6 外部轮询回收 | 外部 MCP `send_message(wait=false)` + 轮询 | **sourceSessionId==null（外部）** |

### 3.4 remote-session（跨实例）— `mcp__remote-session__*`
- `remote_send_message / remote_fork_session / remote_create_session`（L912-962）通过 HTTP 代理到远端实例，**本地 sourceSessionId 无法传到远端**（远端用 `createToolHandlers(null)`）。

### 3.5 心跳 Automation — `tree-commander/SKILL.md §8.1`
- `sessionMode: reuse` 的心跳 automation，其 session 给**所有 active worker** 发 `status_check`。
- **心跳 session 不是任何 worker 的 parent** → 严格血缘校验会**拦死心跳**（核心误伤风险）。

### 3.6 系统内部回调
- `send_message` 的 `notify` 模式：target 完成后，server 内部 `runAgentHeadless(sourceSessionId, "[系统通知]...")` 反向通知（L781-800）。这是 **server 端行为，不经过 caller ownership 校验**，需确保加固不误拦（它在 onComplete 里直接调 runAgentHeadless，不走 send_message handler）。

### 清点结论 → ownership 规则必须覆盖
1. **自循环**（source===target）：模式2/3。
2. **下行认领**（source 是 target 的父）：3.1 下发、3.2 自审/审查员、3.3 开小弟、模式3 竹节交接的下行。
3. **上行回报**（target 是 source 的父）：3.2 上行事件（**反向，必须允许**）。
4. **祖先链多跳**：worker→子commander→commander 多层。
5. **系统特权**：3.5 心跳 automation。
6. **外部/跨实例降级**：3.3 模式6、3.4 remote。

---

## 4. parentSessionId 血缘方案（必答 3）

### 4.1 字段定义（新增，写进 sessions.json）
| 字段 | 写入时机 | 含义 | 用于 |
|---|---|---|---|
| `parentSessionId: string` | **create_session + fork_session** 写 | "谁拥有/创建了我"（agentSession 级 ownership） | ownership R2/R3/R4 |
| `forkedFromSessionId: string` | 仅 **fork_session** 写 | "我从哪个 agentSession fork 上下文"（语义血缘，区别于 sdkSession 级 forkSourceSdkSessionId） | 审计/追溯（替代当前 dead 的 source_session_id/forked_from） |
| `delegationDepth: number` | create_session/fork_session 写 | 委派深度（root=0） | R4 防递归 |
| `triggeredBy: 'user'\|'agent'\|'automation'` | create_session/fork_session 写 | 触发来源 | R5 系统特权 + 审计 |
| `ownerGrantedAt: number` | 认领时写 | parentSessionId 写入时间戳 | 审计/调试 |

> **命名铁律**：`parentSessionId`（ownership，create+fork 都写）≠ `forkSourceSdkSessionId`（官方已有，sdkSession 技术血缘，仅 fork）。**绝不能复用 `sourceSessionId`/`source_session_id`/`forked_from`** —— 这些是 C-15 ruleC15 当前判断"worker 是否 fork 建的"的依据（L2587），若 create_session 也写会**破坏 C-15 语义**（误判 create_session 建的 worker 为 fork 建）。必须用全新字段名 `parentSessionId` + `forkedFromSessionId`。

### 4.2 写入点（patches.cjs，3 处）
```text
[A] create_session handler (L488 createAgentSession 之后):
    if (sourceSessionId) {  // 内部 agent 调用（外部 null 不写血缘，避免外部冒认）
      a.updateAgentSessionMeta(meta.id, {
        parentSessionId: sourceSessionId,
        delegationDepth: (sourceMeta?.delegationDepth ?? 0) + 1,
        triggeredBy: 'agent'
      });
    } else {
      a.updateAgentSessionMeta(meta.id, { triggeredBy: sourceAutomationId ? 'automation' : 'user', delegationDepth: 0 });
    }
    // 注意：create_session 建的 worker 触发 C-15 检查 forkedFromSessionId（不写）→ C-15 仍判为合法 create 会话 ✓

[B] fork_session handler (L583 updateAgentSessionMeta 处，并入现有 updates):
    updates.parentSessionId = sourceSessionId || args.source_session_id;  // caller 认领 fork 产物
    updates.forkedFromSessionId = args.source_session_id;                 // 语义血缘
    updates.delegationDepth = (source.depth ?? 0) + 1;                    // 从 source 继承深度+1
    updates.triggeredBy = sourceSessionId ? 'agent' : 'user';
    // 现有 fork_identity 提示流程不变

[C] archive_session: 无需血缘，但需 ownership 校验（见 §5）
```

### 4.3 祖先链查询路径（用于 R4）
```text
function isAncestorOrDescendant(a, b, maxDepth=8):
  // a 是否是 b 的祖先，或 b 是否是 a 的祖先
  const sessions = indexByParentId(listAgentSessions())  // Map<parentSessionId, sessions[]>
  return reachable(a → b, maxDepth) || reachable(b → a, maxDepth)
```
- 用 `listAgentSessions()` 一次性读全部 + 建 `parentSessionId → children` 索引（内存，O(n) 建一次）。
- 深度假上限 8（够覆盖 tree 多层 + 竹节，防恶意深链 DoS）。
- best-effort：`getAgentSessionMeta` 失败不阻断，但记审计日志（与 list_sessions house style 一致）。

---

## 5. caller ownership 规则集（必答 2 — 核心）

### 5.1 校验入口（共享 helper，send_message/fork_session/archive_session 复用）
```text
function assertOwnership(sourceSid, targetSid, action):
  // action ∈ {'send','fork','archive'}
  if (!sourceSid) return decideExternal(targetSid, action)   // §5.4 外部/remote 降级

  const src = getAgentSessionMeta(sourceSid), tgt = getAgentSessionMeta(targetSid)
  if (!tgt) return DENY('E_TARGET_NOT_FOUND')
  if (!src) return ALLOW_AUDIT('E_SOURCE_META_MISSING')      // source meta 丢失不阻断（信任闭包身份）

  if (R1 sourceSid === targetSid)              return ALLOW         // 自循环
  if (R2 tgt.parentSessionId === sourceSid)    return ALLOW         // 下行认领
  if (R3 src.parentSessionId === targetSid)    return ALLOW         // 上行回报
  if (R4 isAncestorOrDescendant(src, tgt, 8))  return ALLOW         // 多跳血缘
  if (R5 isSystemPrivileged(src, tgt))         return ALLOW_AUDIT   // 心跳 automation（§5.3）
  return DENY('E_NO_OWNERSHIP', {source, target, action})
```

### 5.2 各规则的合理性 + 误伤分析
| 规则 | 合理性 | 是否误伤现有用法 |
|---|---|---|
| **R1 自循环** `source===target` | 模式2/3 fork 自己、worker 给自己总结进度是合法的 | ✅ 不误伤（覆盖 3.3 模式2/3、tree-worker 自总结） |
| **R2 下行认领** `target.parentSessionId===source` | commander 建的 worker、worker fork 的 reviewer，caller 应是其创建者 | ✅ 不误伤（覆盖 3.1 下发、3.2 自审/审查员、3.3 开小弟）——**前提：§4.2[A] create_session 写了 parentSessionId** |
| **R3 上行回报** `source.parentSessionId===target` | worker 给 commander 上报、reviewer 回报 worker | ✅ 不误伤（覆盖 3.2 上行事件，**反向必须允许**） |
| **R4 多跳血缘** 祖先链 | 子commander↔孙worker 多层、竹节交接链 | ✅ 不误伤（覆盖 3.1 多层、模式3 竹节）；防递归靠 depth 上限 |
| **R5 系统特权** 见 §5.3 | 心跳 automation 非血缘关系但属系统巡检 | ⚠️ 需 §5.3 精确界定，否则过宽 |
| **R6 外部/remote 降级** 见 §5.4 | 外部 MCP / 跨实例无身份 | ⚠️ 需主会话决策安全等级（§9-D1） |

### 5.3 R5 系统特权（心跳 automation）
```text
function isSystemPrivileged(src, tgt):
  return src.triggeredBy === 'automation'
      && src.workspaceId === tgt.workspaceId        // 同工作区才放行（跨工作区 automation 仍需血缘）
      && action === 'send'                          // automation 只 send，不 fork/archive 他人
```
- **心跳 automation**（§8.1 reuse session）触发时 src.triggeredBy='automation'、与 worker 同 workspace → 放行 status_check。✅
- 收紧点：automation **不能 fork/archive 他人 session**（只允许 send 巡检），不能跨工作区。避免 automation 特权被滥用。
- ⚠️ **依赖 §4.2 给 automation 触发的会话写 triggeredBy='automation'**。需确认 automation session 的创建路径会经过 create_session handler 写入（见 §9-D2，需主会话确认 automation 是否走同一 create_session handler）。

### 5.4 R6 外部 / 跨实例降级（sourceSessionId==null）
外部 stdio MCP（Claude Code）和 remote_* 进来时 sourceSessionId=null，无法做血缘。三档选项（**需主会话决策 D1**）：
- **选项 A（保守，推荐）**：外部/remote 仅允许 `send_message`（且 target 须无 parentSessionId 或 caller 显式声明的"公开 session"），**禁止 fork/archive**。理由：send 冒充危害（注入消息）< fork 窃取上下文。覆盖模式6 外部轮询。
- **选项 B（严格）**：外部/remote 全 DENY，强制所有写操作走内部 agent。最安全但破坏外部 MCP/remote 全部写用法（session-management 模式6、remote fork/send 全失效）。
- **选项 C（同工作区放行）**：外部/remote 在同 workspace 内 allow 全部 + 强审计日志。最宽松，等同现状加固日志。

### 5.5 各工具的 ownership 应用点
| 工具 | 校验 source→target | 备注 |
|---|---|---|
| `send_message` | `assertOwnership(sourceSessionId, args.session_id, 'send')` 在 L712 meta 存在性检查之后 | notify 回调（L781 server 内部 runAgentHeadless sourceSessionId）**不经过此校验**，天然不受影响 ✓ |
| `fork_session` | `assertOwnership(sourceSessionId, args.source_session_id, 'fork')` 在 L509 之后 | caller 必须拥有 source 才能 fork 它（防窃取上下文） |
| `archive_session` | `assertOwnership(sourceSessionId, args.session_id, 'archive')` 在 L866 之后 | automation 走 R5 只允许 send，故 automation 不能 archive（心跳不应 archive，符合预期） |
| `create_session` | 不校验 ownership（本就允许创建）；仅写血缘（§4.2[A]） | 创建任意 session 合法，关键是写 parentSessionId 让后续认领成立 |

---

## 6. delegationDepth 防递归（必答 4）

- **计算**：`newDepth = (parentMeta?.delegationDepth ?? 0) + 1`。create_session/fork_session 都从 caller（sourceSessionId）继承 depth+1。root/user 直接建 = 0。
- **阈值**：`MAX_DELEGATION_DEPTH = 8`（与 R4 祖先链上限一致）。
- **超阈值处理**：
  - create/fork 时若 `newDepth > MAX` → 返回 `E_DELEGATION_TOO_DEEP`，拒绝创建（防恶意/失控的无限委派链 DoS）。
  - send_message 的 R4 祖先链遍历也用此上限兜底（即便血缘能构成环，depth 也会先超限）。
- **现状风险**：当前完全无 depth，恶意 agent 可无限 fork/fork 形成深链耗尽资源。补 depth 顺手堵住。
- ⚠️ 需主会话确认：现有 tree 体系最深会到几层（commander→子commander→worker→reviewer≈4，竹节 sN 可能再+几节），8 是否够用（**D3**）。若 tree 实际更深需调高。

---

## 7. triggeredBy 审计字段（必答 5）

| 值 | 写入场景 | 用途 |
|---|---|---|
| `user` | sourceSessionId==null 且非 automation（UI/外部用户直接建） | 审计基线 |
| `agent` | sourceSessionId 非空（内部 agent 调 create/fork） | 标准委派 |
| `automation` | automation 触发的会话（sourceAutomationId 非空，或 automation 调用路径） | **R5 系统特权判定** |

- create_session/fork_session 写入（§4.2）。
- 审计日志每次 ownership DENY/AUDIT 时记录 `{ts, action, sourceSid, targetSid, triggeredBy_source, rule_hit, reason}`。
- 远期可用于 UI 展示会话来源、限制 automation 越权。
- ⚠️ **automation 写入路径需主会话确认（D2）**：Proma automation 是否经过 `createAgentSession` → 我们的 create_session handler？还是另有 automation 专用建会话路径（automation-manager.ts / automation-scheduler.ts）绕过 patches 的 handler？若绕过，triggeredBy 需在 automation 专用路径补写。

---

## 8. remote-session 同步加固（必答 6）

### 8.1 现状
`createRemoteToolHandlers()`（L882）完全不接收 sourceSessionId，11 个 remote_* 工具透传到远端 HTTP bridge，远端用 `createToolHandlers(null)`（L1148）→ **远端 sourceSessionId 恒为 null**。

### 8.2 跨实例 ownership 判定困境
本地 caller 的 sourceSessionId 在远端实例**无对应 session**（不同实例的 sessions.json 独立），血缘校验无意义。

### 8.3 推荐方案（**需主会话决策 D4**）
- **方案 A（实例边界 = 信任边界，推荐）**：remote_* 视为跨实例运维通道，**在远端统一按 R6 外部降级处理**（同实例内 R1-R5 仍生效；远端收到的请求 sourceSessionId=null → 走 §5.4 外部策略）。
  - 即：本地不做 remote ownership（无从校验），**远端 send_message/fork/archive handler 的加固自然覆盖** remote 进来的请求（它们在远端也是 sourceSessionId=null 的外部调用）。
  - 收益：**无需改 remote_* 本身**，远端加固后 remote 自动受限为"外部调用等级"。
- **方案 B（跨实例血缘）**：在 remote_* 透传时携带 `caller_instance + caller_session`，远端记录为"跨实例来源"字段，做实例级白名单。复杂度高，跨实例 session_id 无全局唯一性保证，**不推荐**。
- **结论建议**：remote_* 工具**不需单独加固**，靠远端 §5.4 外部降级覆盖即可。仅需在文档/审计里标注 remote 调用等级。

---

## 9. 风险点 + 回归测试（必答 7）

### 9.1 风险点与缓解
| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| K1 | **create_session 当前不写 parentSessionId** → 加固后 commander 无法 R2 认领自己建的 worker，**所有 tree 下发/开小弟全断** | 🔴 致命 | §4.2[A] create_session 必须同步补写血缘，与 ownership 校验**同批上线**（缺一即全断） |
| K2 | **上行回报 R3 反向** 被遗漏 → worker→commander 上报全断 | 🔴 致命 | §5.1 R3 显式覆盖；回归必测 tree-worker done 上报 |
| K3 | **心跳 automation** session 非 worker parent → 心跳被拦 | 🔴 致命 | §5.3 R5 系统特权；回归必测 §8.1 心跳 status_check |
| K4 | **C-15 ruleC15** 误判 create_session 建的 worker 为 fork 建 | 🟡 功能 | §4.1 命名铁律：用新字段 parentSessionId/forkedFromSessionId，不动 source_session_id/forked_from，C-15 不受影响 |
| K5 | **外部 MCP / remote 全部写操作断** | 🟠 可用性 | §5.4 R6 选项 A（外部仅 send）平衡；D1 决策 |
| K6 | **depth=8 太严**，tree 竹节/多层被拦 | 🟡 功能 | D3 确认 tree 实际深度，调阈值 |
| K7 | **notify 回调**（server 内部 runAgentHeadless sourceSessionId）被误拦 | 🟠 可用性 | §5.5 注明：回调不经 send_message handler，天然免疫；回归必测 notify 模式 |
| K8 | **祖先链 listAgentSessions** 性能（session 多时） | 🟢 低 | sessions 总量小；内存建索引 O(n)；可加 LRU/超时 |
| K9 | **历史会话无 parentSessionId**（加固前建的）→ 老会话间 ownership 全 DENY | 🟠 兼容 | 老会话 tgt.parentSessionId==undefined 时：若 source 也无血缘 → 走 R6 降级或 ALLOW_AUDIT（向后兼容，渐进加固） |

### 9.2 回归测试矩阵（实现子会话照此验证）
```text
[T1] 堵冒用（应 DENY）:
  - Agent A send_message(B)，A≠B 且无血缘 → E_NO_OWNERSHIP ✓
  - Agent A fork_session(source=B) 窃取上下文 → E_NO_OWNERSHIP ✓
  - Agent A archive_session(B) → E_NO_OWNERSHIP ✓

[T2] tree 下行（应 ALLOW）:
  - commander create_session(worker) → send_message(worker, notify) ✓ （依赖 K1 修复）
  - commander send_message(worker, "nudge") ✓
  - commander archive_session(worker) + fork_session(worker, uuid) 重档剪枝 ✓

[T3] tree 上行（应 ALLOW）:
  - worker send_message(commander, notify, type=done) ✓ （R3）
  - worker send_message(commander, type=blocked/plan/brief_echo) ✓

[T4] 自循环（应 ALLOW）:
  - X send_message(X) 自总结 ✓
  - X fork_session(X) 竹节/深度探索 ✓

[T5] 多跳血缘（应 ALLOW）:
  - 孙worker send_message(祖父commander) ✓ （R4）
  - commander fork_session(子commander建的worker) ✓ （R4）

[T6] 心跳 automation（应 ALLOW via R5）:
  - automation session send_message(任意同workspace worker, status_check) ✓
  - automation session fork_session(worker) → DENY（R5 只允许 send）✓

[T7] notify 回调（应 ALLOW，不误拦）:
  - worker send_message(target, notify=true) → target 完成后反向通知 worker ✓

[T8] 外部/remote（按 D1）:
  - 外部 MCP send_message(wait=false) 轮询回收 ✓（选项A）
  - 远端 remote_send_message → 远端按外部降级 ✓

[T9] C-15 不破坏:
  - create_session 建的 worker，ruleC15 仍判为合法（forkedFromSessionId 未写）✓

[T10] depth 防递归:
  - 连续 fork 9 层 → 第 9 层 E_DELEGATION_TOO_DEEP ✓
```

---

## 10. 需主会话决策的点（不要自己拍板）

| # | 决策点 | 选项 | 子 Agent 建议 |
|---|---|---|---|
| **D1** | 外部 MCP / remote 的写操作安全等级 | A 仅 send / B 全禁 / C 同工作区全放 | **A**（平衡可用与安全） |
| **D2** | automation 触发的会话是否经过 patches 的 create_session handler（决定 triggeredBy='automation' 能否自动写入） | 是 / 否（另有路径） | 需主会话查 automation-manager.ts/scheduler.ts 建会话路径确认；若另有路径，triggeredBy 需在该路径补写 |
| **D3** | MAX_DELEGATION_DEPTH 阈值 | 8 / 更高 | 调研 tree 实际最深层数后定；建议 8-12 |
| **D4** | remote_* 是否单独加固 | A 远端降级覆盖（不改 remote）/ B 跨实例血缘 | **A**（remote 无法可靠做跨实例 ownership） |
| **D5** | 老会话兼容策略（无 parentSessionId 的历史会话） | ALLOW_AUDIT 向后兼容 / 强制 DENY 渐进 | **ALLOW_AUDIT**（避免一上线全断老协作） |
| **D6** | 字段命名最终确认 | parentSessionId / forkedFromSessionId（本文案）vs 其他 | 建议采用本文案，避免与 C-15 用的 source_session_id/forked_from 冲突 |

---

## 11. 实现优先级建议（给后续实现子会话）

```text
P0（必须同批，否则 K1/K2/K3 致命）:
  1. §4.2[A] create_session 写 parentSessionId + depth + triggeredBy
  2. §4.2[B] fork_session 写血缘 + depth
  3. §5.1 assertOwnership helper（R1-R5）
  4. §5.5 send_message/fork_session/archive_session 接入 ownership
  5. §5.3 R5 系统特权（心跳）

P1（加固完整性）:
  6. §6 delegationDepth 超限拒绝
  7. §7 triggeredBy 审计 + DENY/AUDIT 日志
  8. §9.1 K9 老会话兼容（D5）

P2（外部/remote，依赖 D1/D4）:
  9. §5.4 R6 外部降级（按 D1 选项实现）
  10. remote_* 文档标注 + 远端验证

回归: §9.2 T1-T10 全过方可上线。
```

---

## 附：调研依据文件
- `proma-dev-patches.cjs`（L207 createToolHandlers / L459 create_session / L506 fork_session / L709 send_message / L864 archive_session / L882 remote / L1005 createSessionMcpServer / L1148 外部 bridge / L1353 身份注入 / L2579 C-15）
- 官方 `apps/electron/src/main/lib/session-mcp.ts`（L369 fork / L428 send，对比确认同漏洞）
- 官方 `apps/electron/src/main/lib/agent-session-manager.ts`（L99 createAgentSession / L380 updateAgentSessionMeta generic merge / L623 forkAgentSession 只写 sdkSession 级血缘）
- `skills/tree-commander/SKILL.md`、`skills/tree-worker/SKILL.md`、`skills/session-management/SKILL.md`（合法用法清点）
- `tree-engine.cjs` L1361-1363（audit_gate caller 校验先例）
