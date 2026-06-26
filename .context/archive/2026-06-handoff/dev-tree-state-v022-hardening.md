# 开发启动提示词 — tree-state.js v0.2.2 硬化

> 给新会话的开场 prompt | 日期: 2026-06-21

---

## 使用方法

复制下面 `---` 分隔线之后的所有内容，在新 Proma Agent 会话中作为第一条消息发送。

---

你是 Proma 树形会话执行体系的开发者。你的任务是对 tree-state.js 进行 v0.2.2 硬化——修复 Q1 v2 全深度验证中发现的 4 个结构性缺陷。

## 工作区

所有文件在：`C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`

## 背景（必读，5 分钟）

先读这三个文件了解上下文：

1. `.context\technical-report-tree-system-issues.md` — Q1 v2 测试发现的 8 项问题（重点看 #1/#2/#4/#5）
2. `.context\plan\q2-tree-ui-panel.md` §0 — 本次要实施的具体修复方案（含伪代码）
3. `.context\trees\tree-state.js` — 当前代码（~1680 行），你的修改对象

## 任务清单（按顺序执行）

### 任务 1：init 自动创建 root leaf（修复 #1 ROOT_PLACEHOLDER）

修改 `cmdInit` 函数，在 `writeState(treeId, state)` 之前自动创建 root leaf：

- session_id 来源优先级：`--session-id` CLI 参数 → `PROMA_SESSION_ID` 环境变量 → 回退 `"PENDING_ROOT"`
- leaf_id：`{treeId}-root`
- role：`"root"`
- parent：`null`
- status：`"active"`
- 其他字段按 §0.2 伪代码填充

同时在 `validate` 函数中新增检查：如果 root leaf 的 session_id 不是合法 UUID 且不是 `"PENDING_ROOT"`，报告 issue（type: `root_session_not_real`）。

新增子命令：`leaf set-session <tree_id> <leaf_id> <session_id>`。用于修正 PENDING_ROOT 或在 leaf 恢复时更新 session_id。校验 session_id 为合法 UUID。

**验收**：
- `node tree-state.js init test1 --root-brief '{"test":true}' --root-dod '{"test":true}' --session-id 00000000-0000-0000-0000-000000000001` → tree-state.json 的 leaves 中自动包含 `test1-root`，session_id 为传入的 UUID
- 不传 `--session-id` 且无环境变量 → session_id=`"PENDING_ROOT"`
- `node tree-state.js validate test1` — PENDING_ROOT 时产生 warning（非 error）
- `node tree-state.js leaf set-session test1 test1-root 00000000-0000-0000-0000-000000000002` → root session_id 更新
- `node tree-state.js leaf set-session test1 test1-root not-a-uuid` → E_SCHEMA_INVALID

### 任务 2：leaf add UUID 校验 + added_by 追溯（修复 #4 CLI 手动注入）

修改 `cmdLeafAdd`：

- 校验 session_id 必须是合法 UUID 格式（正则：`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`），否则抛 E_SCHEMA_INVALID
- 非 root leaf 必须传 `added_by` 字段且为合法 UUID，否则抛 E_SCHEMA_INVALID

在 `validate` 函数中新增：非 root leaf 的 `added_by` 必须能追溯到树中已存在的 leaf（且该 leaf 的 role 为 root 或 commander），否则报告 issue。

**验收**：
- `leaf add` 传非法 session_id → E_SCHEMA_INVALID
- `leaf add` 传合法 UUID 但 role≠root 且无 added_by → E_SCHEMA_INVALID
- `leaf add` 传合法 UUID + 合法 added_by（对应树中已存在的 commander） → 成功
- validate 检测到 added_by 指向不存在的 leaf → issue

### 任务 3：pending_brief + Worker done 前置 events 检查（修复 #5 Events 空洞）

新增 status 值 `pending_brief`：Worker leaf 创建后初始状态为 `pending_brief`（修改 `cmdLeafAdd` 中 role=worker 时的默认 status）。

修改 `cmdLeafSetStatus`：当 Worker（role=worker）设置 status=done 时，检查 events 数组：
- events 长度 ≥ 2
- events 中至少包含 1 条 type=`"brief_echo"` 和 1 条 type=`"done"`
- 不满足 → E_SCHEMA_INVALID

**验收**：
- Worker leaf add 后初始 status = `"pending_brief"`
- Worker leaf events 为空时 set-status done → E_SCHEMA_INVALID
- Worker leaf events 只有 1 条 brief_echo → set-status done → E_SCHEMA_INVALID
- Worker leaf events 有 brief_echo + done → set-status done → 成功
- Commander leaf set-status done 不受此限制（Commander 不需要 brief_echo）

### 任务 4：补充 3 层 fork 端到端测试（修复 #2 scope 未兑现）

不修改代码。用 fork_session + create_session + send_message 创建真实 3 层 commander 链路：

```
tree_id: q2depth
root → X-commander (fork) → Y-commander (fork) → Y-w1-worker (create) + Y-w2-worker (create)
```

验证：
- X 和 Y 通过 fork_session 创建，session_id 为真实 UUID
- Y 通过 send_message 向 Y-w1 发送任务，收到 brief_echo 回复
- 尝试在 Y 下创建曾孙 commander → E_DEPTH_EXCEEDED
- 整棵树 validate 通过

## 关键约束

1. **不修改 main.cjs。不修改 proma-dev-patches.cjs。不新增补丁。**
2. tree-state.js 是纯 Node.js 脚本，零外部依赖。保持这个特性。
3. 修改后必须通过 `node --check` 语法校验
4. 现有 22 个子命令的向后兼容——已有功能不能破坏
5. 用 bverify 树（`.context\trees\bverify\tree-state.json`）做回归测试——你的修改不能导致 bverify 的 validate 报新错误

## 产出

1. 修改后的 `tree-state.js`（覆盖 `.context\trees\tree-state.js`）
2. 每个任务完成后跑上面的验收命令，截图或贴输出
3. 全部完成后跑 bverify 回归：`node tree-state.js validate bverify`
4. 跑 q2depth 测试树：创建 → leaf add → 3 层链路验证 → 最终 validate

## 时间预估

- 任务 1：~30 分钟
- 任务 2：~20 分钟
- 任务 3：~20 分钟
- 任务 4：~15 分钟（主要等 fork_session 响应）
- 回归测试：~10 分钟
- **合计：~1.5-2 小时**
