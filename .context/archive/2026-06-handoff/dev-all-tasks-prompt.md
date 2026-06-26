# 树形会话执行体系 — 全部开发任务启动提示词

> 给新会话的开场 prompt | 日期: 2026-06-21
> 覆盖: Q2 Part A (tree-state.js 硬化) + Q3 (天道运行官) + Q2 Part B (UI 面板)

---

## 使用方法

将 `---` 分隔线之后的所有内容复制，在新 Proma Agent 会话中作为第一条消息发送。

---

你是 Proma 树形会话执行体系的开发者。以下是一个完整的三阶段开发计划，按依赖顺序执行。

## 工作区根

```
C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files
```

## 先读（恢复上下文，约 15 分钟）

按顺序读以下文件：

1. `.context\PROJECT-INDEX.md` — 项目全景（5 分钟）
2. `.context\technical-report-tree-system-issues.md` — Q1 v2 发现的 8 项问题（重点 #1/#2/#4/#5）
3. `.context\plan\q2-tree-ui-panel.md` — Q2 方案（§0 tree-state.js 硬化 + §1-8 UI 面板）
4. `.context\plan\q3-tao-hard-constraint.md` — Q3 天道运行官方案 v1.2
5. `.context\commander-methodology.md` — 方法论 v1.2（13 原则）
6. `.context\trees\tree-state.js` — 当前代码（~1680 行）

**禁止读取或修改以下文件**：`D:\Proma-dev\resources\app\dist\main.cjs`、`proma-dev-patches.cjs`（这些属于 Layer 1 补丁体系，与本次开发无关）。

---

---

# 阶段一：tree-state.js v0.2.2 硬化

**目标**：修复 Q1 v2 发现的 4 个结构性缺陷，堵住根会话虚空、CLI 手动注入、Events 空洞。约 90 行新增代码。

**依赖**：无。直接修改 `.context\trees\tree-state.js`。

**约束**：不修改 main.cjs。不修改 proma-dev-patches.cjs。不新增补丁。零外部依赖。向后兼容（bverify 回归 validate 不能报新错误）。每次修改后跑 `node --check tree-state.js` 语法校验。

## 阶段一 任务清单

### 任务 1.1：init 自动创建 root leaf（修复 ROOT_PLACEHOLDER）

修改 `cmdInit` 函数。在 `writeState(treeId, state)` 之前自动创建 root leaf：

```
leaf_id: {treeId}-root
session_id: --session-id 参数 → PROMA_SESSION_ID 环境变量 → "PENDING_ROOT"
parent: null
role: "root"
status: "active"
```

新增 **validate 规则**：root leaf 的 session_id 非 UUID 且非 PENDING_ROOT → issue（type: root_session_not_real）。PENDING_ROOT 时产生 warning。

新增子命令：`leaf set-session <tree_id> <leaf_id> <session_id>`，校验 session_id 为合法 UUID。

验收：
- `node tree-state.js init test1 --root-brief '{...}' --root-dod '{...}' --session-id 00000000-0000-0000-0000-000000000001` → leaves 含 test1-root，session_id=传入UUID
- 不传 session-id 且无环境变量 → session_id="PENDING_ROOT"，validate 产生 warning
- `leaf set-session test1 test1-root 00000000-0000-0000-0000-000000000002` → 成功
- `leaf set-session test1 test1-root not-a-uuid` → E_SCHEMA_INVALID

### 任务 1.2：leaf add UUID 校验 + added_by 追溯（修复 CLI 手动注入）

修改 `cmdLeafAdd`：

- session_id 必须合法 UUID（正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`），否则 E_SCHEMA_INVALID
- role ≠ root 时必须传 added_by（合法 UUID），否则 E_SCHEMA_INVALID

新增 **validate 规则**：非 root leaf 的 added_by 须对应树中已存在的 leaf（role ∈ {root, commander}）。

验收：
- 非法 session_id → E_SCHEMA_INVALID
- role=worker 无 added_by → E_SCHEMA_INVALID
- 合法 UUID + 合法 added_by → 成功

### 任务 1.3：pending_brief + Worker done 前置 events 检查（修复 Events 空洞）

- Worker leaf 创建后默认 status = `"pending_brief"`（非 "active"）
- Worker set-status done 时检查 events：≥2 条 + 含至少 1 条 `"brief_echo"` + 1 条 `"done"`，否则 E_SCHEMA_INVALID

验收：
- Worker leaf add 后 status = "pending_brief"
- Worker events=[] → set-status done → E_SCHEMA_INVALID
- Worker events=[brief_echo, done] → set-status done → 成功
- Commander 不受此限制

### 任务 1.4：回归测试

- bverify 回归：`node tree-state.js validate bverify`（使用 `.context\trees\bverify\tree-state.json`）→ 不能报新错误
- 22 个子命令 smoke test（取关键路径：init → leaf add → leaf set-status → leaf get → milestone add → event append → drift append → validate → backup → restore）
- 已修复场景的边界测试（PENDING_ROOT validate、非法 UUID 拒绝、Worker 缺 events 拒绝）

---

---

# 阶段二：天道运行官 v0.1-TAO 实施

**目标**：实现流程警察——自动化鞭策 + done 审计 + 自检。35 条规则对应的 4 个新文件 + 1 个 Prompt 配置。

**依赖**：阶段一完成（依赖 tree-state.js v0.2.2 的 audit-gate / pending_brief / validate 能力）。

**约束**：不修改 main.cjs。不修改 proma-dev-patches.cjs。不新增补丁。天道是一个独立 Agent 会话 + 2 个 Proma automation 定时任务。

## 阶段二 任务清单

### 任务 2.1：创建规则库 `tao-rules.json`

文件位置：`.context\trees\tao-rules.json`

内容：35 条规则的 JSON 数组。每条规则包含 `id`、`role`、`rule`、`data_source`、`query_method`、`pass_logic`。从 Q3 方案 v1.2 §5 逐条提取。

```json
[
  {
    "id": "C-01",
    "role": "commander",
    "rule": "收到任务后必须创建 plan",
    "data_source": "TaskList 或 list_messages",
    "query_method": "检查 TaskList count ≥2 或 搜索消息中 sub_missions 数组",
    "pass_logic": "tasks≥2 或 sub_missions.length≥1"
  },
  ...
]
```

### 任务 2.2：在 tree-state.js 中新增 audit-gate / audit / nudge 命令

**新增子命令**（在阶段一的 tree-state.js 上叠加）：

1. `audit-gate <tree_id> <leaf_id> --verdict pass|fail|required|skip --audit-session-id <uuid>`
   - 写入 `leaf.audit_gate = { verdict, auditor_session_id, ts }`
   
2. `audit append <tree_id> <leaf_id> --json '{...}'`
   - 向 `leaf.audit_log` 数组追加审计记录

3. `nudge append <tree_id> <leaf_id> --rule-id <id> --nudge-count <N>`
   - 更新 `leaf.nudge_count` 并追加 `leaf.nudge_log`

4. `nudge reset <tree_id> <leaf_id>`
   - 重置 `nudge_count = 0`

**修改 `cmdLeafSetStatus`**：done 入口检查 `leaf.audit_gate.verdict` —— 不为 `"pass"` 时拒绝并返回 `E_GATEKEEPER_REQUIRED`。

**修改 `cmdInit`**：在 `_meta` 中新增 `workspace_root` 字段（从 TREES_ROOT 推导为绝对路径）。

### 任务 2.3：创建审计 Prompt 模板 `tao-audit-prompt.md`

文件位置：`.context\trees\tao-audit-prompt.md`

内容：Q3 §4.3 的完整审计 prompt——含 JSON Schema 约束、few-shot 示例、"只输出 JSON" 指令、N=10（前3+后7）消息采样策略。

### 任务 2.4：创建鞭策消息模板 `tao-nudge-template.md`

文件位置：`.context\trees\tao-nudge-template.md`

内容：Q3 §6.2 的鞭策消息格式——含鞭策计数、leaf 信息、触发规则、下一步要求、升级警告。

### 任务 2.5：创建天道主循环 Prompt `tao-watcher-prompt.md`

文件位置：`.context\trees\tao-watcher-prompt.md`

内容：Q3 §7.3 的完整 automation prompt——Bootstrap 协议 + Stall 检测 + 审计调度 + 降级模式 + 性能预算（单轮最多 5 leaf）。

### 任务 2.6：创建天道自检 Prompt `tao-health-check-prompt.md`

文件位置：`.context\trees\tao-health-check-prompt.md`

内容：每分钟检查天道主 automation 最后一条消息时间戳，>120 秒 → 通知根会话。

### 任务 2.7：部署天道到 Proma

1. **创建主 automation**：`mcp__automation__create_automation`
   - name: "TAO-Watcher"
   - scheduleType: interval, intervalMinutes: 0.5（30秒）
   - sessionMode: daily
   - prompt: 复制 `tao-watcher-prompt.md` 内容
   - permissionMode: bypassPermissions

2. **创建自检 automation**：`mcp__automation__create_automation`
   - name: "TAO-HealthCheck"
   - scheduleType: interval, intervalMinutes: 1（60秒）
   - sessionMode: daily
   - prompt: 复制 `tao-health-check-prompt.md` 内容
   - permissionMode: bypassPermissions

### 任务 2.8：Smoke Test（用一棵真实小树验证）

1. 创建测试树 `taotest`：root + 1 commander + 2 worker
2. Worker 故意不写 brief_echo → set-status done → 被 E_GATEKEEPER_REQUIRED 拦截
3. 手动触发天道审计 → worker 被审计 → 收到打回消息（附缺失清单）
4. Worker 补上 brief_echo + self_check → 重新 done → audit-gate pass → set-status done 成功
5. 验证 audit_log / nudge_log 已写入 tree-state.json

---

---

# 阶段三：树形可视化 UI 面板（Q2 Part B）

**目标**：在 Proma 侧边栏顶部插入树形可视化面板，展示整棵任务树的结构和状态。

**依赖**：阶段一 + 阶段二完成（依赖 tree-state.js 硬化后的数据结构 + 天道的 audit_log/nudge_log 字段用于状态展示）。

**约束**：需要新建补丁 L（IPC handler + HTML 注入 + 独立前端文件），这是本次开发中唯一涉及补丁体系的环节。

## 阶段三 任务清单

### 任务 3.1：定位 main.cjs 注入点

在 `D:\Proma-dev\resources\app\dist\main.cjs` 中定位：
- IPC 注册区域（搜索 `ipcMain.handle` 或 `ipcMain.on` 找到集中注册位置）
- session 导航 / 切换函数（搜索 session 切换相关的函数名）

### 任务 3.2：实现补丁 L — IPC Handler（main.cjs）

新增两个 IPC handler：

1. `proma:get-tree-states` — 扫描 `.context/trees/*/tree-state.json`，返回所有 tree 数据
2. `proma:navigate-to-session` — 接收 session_id，切换到对应会话

用 Edit 工具注入（参考补丁 B 的注入模式）。若导航 API 无法定位，先用"复制 session_id 到剪贴板"作为 fallback。

### 任务 3.3：编写 `proma-tree-view.js`（~250 行 vanilla JS）

文件部署位置：`D:\Proma-dev\resources\app\dist\renderer\assets\proma-tree-view.js`

功能：
- `init()` — 创建 DOM 容器 `<div id="proma-tree-panel">`，挂载到侧边栏顶部
- `fetchTrees()` — `ipcRenderer.invoke('proma:get-tree-states')`
- `renderTree(tree)` — 递归构建树形 DOM（节点缩进 + 树线）
- `buildNode(leaf)` — 渲染单个节点：颜色圆点 + 标题 + role 标签 + milestone 进度
- `handleClick(sessionId)` — ipcRenderer.send 导航
- `startPolling(3000)` — 3 秒轮询刷新

状态颜色：
- 🟢 done / 🟡 blocked / 🔵 active / 🔴 pruned / ⚫ archived
- 天道状态叠加：橙色边框 = nudge_count>0 / 红色边框闪烁 = E_STALL_TIMEOUT

### 任务 3.4：编写 `proma-tree-view.css`（~100 行）

- 面板容器：侧边栏顶部，max-height 40vh，overflow-y auto
- 缩进线：border-left + ::before 伪元素
- 节点 hover 高亮
- 折叠/展开 CSS transition
- 暗色主题适配（prefers-color-scheme）

### 任务 3.5：注入 `index.html` 引用

```html
<link rel="stylesheet" href="./assets/proma-tree-view.css">
<script src="./assets/proma-tree-view.js"></script>
```

通过 Edit 工具在 index.html 中注入（`renderer/index.html` 是明文 HTML）。

### 任务 3.6：部署 + 集成测试

```bash
cp proma-tree-view.js D:/Proma-dev/resources/app/dist/renderer/assets/
cp proma-tree-view.css D:/Proma-dev/resources/app/dist/renderer/assets/
# index.html + main.cjs 已通过 Edit 工具修改
```

重启 Dev 实例验证：
- 侧边栏顶部出现树形面板
- taotest 树的节点正确渲染
- 状态颜色与 tree-state 一致
- 点击节点可导航或复制 session_id
- 3 秒轮询刷新正常

---

---

# 总体约束（三个阶段通用）

1. **不修改 main.cjs / proma-dev-patches.cjs**（阶段三的补丁 L 除外——那是唯一需要 main.cjs 注入的环节，且仅限于新增 IPC handler）
2. 向后兼容——每次修改后跑 bverify validate 回归
3. 每个阶段结束后 commit（git 仓库：`orphiczhou/proma-patches`，路径：`workspace-files`）
4. 优先使用 Edit 工具做精确修改，避免 Bash sed

## 预期总工作量

| 阶段 | 内容 | 代码量 | 预估时间 |
|------|------|:---:|:---:|
| 一 | tree-state.js 硬化 | ~90 行 | ~2h |
| 二 | 天道运行官 | ~600 行（4 文件 + 2 Prompt 配置） | ~4h |
| 三 | UI 面板 | ~350 行（JS+CSS+IPC） + 补丁 L | ~4h |
| **合计** | | **~1040 行** | **~10h** |
