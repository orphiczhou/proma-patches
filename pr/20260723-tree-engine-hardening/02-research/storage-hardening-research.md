# Tree-State 存储改造 + 引擎加固 调研报告

> 调研子会话：`de1e7e26-8f24-4ee3-aace-bc6feb9eac6d`（release 本地）
> 日期：2026-07-23
> 背景：观察员实证 systest2 多层检测中，A-commander 的 M1（空 expect_outputs）靠直接编辑 tree-state.json 修复——暴露 tree-state.json 文件可被 agent 绕过引擎闸门直接篡改。本调研评估存储改造（DB / protected-location）+ 引擎加固（A+B+C）方案。

## 1. Proma 用什么持久化存储

### 结论：纯 JSON 文件 + JSONL，无数据库

Proma **不使用任何数据库**（无 better-sqlite3、无 lowdb、无 electron-store、无 node-json-db）。main.cjs 中唯一 `sqlite` 引用是 undici HTTP 库的内部缓存（`SqliteCacheStore`），与业务数据无关。

存储机制：全部 `fs.readFileSync`/`fs.writeFileSync` + `JSON.stringify`/`JSON.parse`。物理位置：`getConfigDir()` = `~/.proma`（或 `~/.proma-<INSTANCE>`）。

| 数据类型 | 格式 | 路径（相对 ~/.proma） | 证据 |
|---|---|---|---|
| Agent 会话消息 | JSONL | `agent-sessions/<id>.jsonl` | main.cjs L181 |
| Agent 会话索引 | JSON | `agent-sessions.json` | L170 |
| 工作区索引 | JSON | `agent-workspaces.json` | L184 |
| 渠道（API Key） | JSON | `channels.json` | L117 |
| 设置 | JSON | `settings.json` | L164 |
| Tree-state | JSON | `agent-workspaces/<slug>/{workspace-files/,}.context/trees/<tree_id>/tree-state.json` | tree-engine.cjs L504-505 |

## 2. tree-state 迁 DB 可行性

### 结论：技术可行但改动量大、收益有限、不推荐优先

Proma 自身**无 DB 层**可复用——迁 DB 等于从零新建。且 **SQLite 文件也是文件**，agent 全盘写权限下 `fs.writeFileSync(dbPath,...)` 同样能绕过引擎。**迁 DB 不解决核心漏洞**。

迁移需改 tree-engine.cjs 约 15-20 个函数（readState/writeState/withLock/appendCallLog/treeDir/statePath/cmdBackup/cmdRestore...），约 300-400 行。patches.cjs 的 findTreesDirForWorkspace + callTreeState 也要改。

## 3. Protected-Location 方案

### 结论：理论最优，但当前 SDK 无路径沙箱，物理隔离无效

**Agent 文件访问范围 = 全盘，无限制**。SDK 工具定义（main.cjs L450550-450559 `buildBuiltinToolDefinitions`）：`createReadToolDefinition(cwd)` / `createWriteToolDefinition(cwd)` 等，`cwd` 只是默认前缀，**无路径限制参数**。`canUseTool` 回调只查权限模式（bypassPermissions/plan/normal），不查路径。bypassPermissions 下任意绝对路径直接放行。

所以把 tree-state 移到 workspace 外（如 `~/.proma/tree-data/`）**没用**——agent 用绝对路径照样读写。

**唯一可行的变体**：`canUseTool` 是 Proma 自己的函数，可在其中拦截 Write/Edit 对 `tree-state.json`/`call-log.jsonl`/`.lock` 的操作（main.cjs ~L484830）。但不防 Bash（`echo > tree-state.json`），且 bypassPermissions 跳过检查。

## 4. A+B+C 文件式加固设计（具体改动点）

### 4A. cmdMilestoneAdd 加 V3 expect_outputs 非空校验
当前（tree-engine.cjs L2050-2113）只校验 expect_outputs 是数组，**不校验非空**。L2103 空数组直接入库。
**修复**：L2066 之后插：
```js
if (Array.isArray(input.expect_outputs) && input.expect_outputs.length === 0) {
  throw new TreeStateError(E_DELIVERABLE_MISSING,
    `milestone_add "${input.id}": expect_outputs must not be empty — every milestone must declare at least one deliverable`);
}
```

### 4B. cmdMilestoneSetResult 加 reject-empty
当前（L2115-2195）只改 audit_pass/status，**不查 expect_outputs**。
**修复**：L2173 之后（找到 target 后、设 audit_pass 前）插：
```js
if (audit_pass === true) {
  const outs = Array.isArray(target.expect_outputs) ? target.expect_outputs : [];
  if (outs.length === 0) {
    throw new TreeStateError(E_DELIVERABLE_MISSING,
      `milestone set-result rejected: milestone "${milestone_id}" has empty expect_outputs — cannot audit-pass a milestone with no declared deliverables`);
  }
}
```

### 4C. 新增 cmdMilestoneUpdate
引擎**无** milestone 更新命令（dispatchMilestone L5072-5081 只有 add/set-result）。修改 milestone 的唯一途径是直接改文件——正是漏洞根源。
**新增** `cmdMilestoneUpdate`（L2195 后）：可改 desc/expect_outputs（不可改 id/status/audit_pass）；caller 身份校验（owner/creator）；**拒绝改已 audit_pass 的 milestone**（防篡改审计结果）；V3 拒绝空 expect_outputs。
**dispatchMilestone** L5079 加 `case 'update': return await cmdMilestoneUpdate(rest, callerSessionId);`
**MCP 暴露**：patches.cjs buildTreeTable 加 `tree_milestone_update` 条目（schema: tree_id/leaf_id/milestone_id/desc?/expect_outputs?）。

## 5. 推荐 + 分阶段实施计划

| 阶段 | 改动 | 行数 | 解决 | 残余风险 |
|---|---|---|---|---|
| **P1** | A+B+C 加固 | ~50 | 空 expect_outputs 注入；缺合法 update 命令 | 仍可直改文件 |
| **P2** | 篡改检测（write_count + SHA-256 hash） | ~100 | 直改文件可被检测 | agent 可同时改 hash（需 HMAC 根除） |
| **P3** | canUseTool 拦 Write/Edit + 私有路径 | ~80 | Write/Edit 直改被拦 | Bash 绕过 |
| **P4** | SDK 路径沙箱（allowedPaths/denyPaths） | 0（等 SDK） | 路径级隔离 | 需 SDK 支持，当前不可行 |

**推荐：P1 立即做 + P2 紧随**。共 ~150 行，不破坏现有 tree 兼容，覆盖观察员报告的核心漏洞 + 用户提出的"防文件篡改"关切（P2 检测）。P3 视残余风险。P4 长期。

**核心判断**：问题根源是 agent 有全盘文件写权限 + tree-state.json 是明文 JSON。SDK 无路径沙箱前提下，**没有方案能 100% 防直改文件**。正确策略：(1) 堵合法入口漏洞（A+B+C，让 agent 不需绕路）；(2) 检测篡改（P2，让绕路被发现）；(3) 增加绕路成本（P3 canUseTool）。
