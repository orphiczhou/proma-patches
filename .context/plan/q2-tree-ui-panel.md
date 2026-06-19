# Q2: 树形会话可视化面板 — 侧边栏 UI 补丁

> 版本: v1.0 | 日期: 2026-06-19 | 类型: 开发方案

---

## 一、问题与目标

### 现状痛点

1. **不可视**：树形任务全靠看一长溜 session 列表 + 手工读 tree-state.json，完全不知道任务树长什么样
2. **不直观**：哪个分支在跑、哪个叶子完成了、哪里有偏差——全部要靠脑补
3. **不可追溯**：fork 关系在 `fork_session` 返回值里，但 `list_sessions` 和 `get_session_info` 都不暴露 parent 关系

### 目标

在 Proma 侧边栏顶部插入一个**树形可视化面板**：

- 以树形结构展示任务层级（根→枝杈→叶子）
- 颜色标识状态（绿=done / 蓝=active / 红=blocked / 灰=archived）
- 点击节点跳转到对应会话
- 自动刷新（3 秒轮询 tree-state.json）

---

## 二、技术架构

### 为什么用独立文件而不是 sed 注入 React？

现有补丁 D+E 用 sed 改 minified JS，但这个方案对树形面板**不适用**：

- 树形面板是**全新 UI 组件**，不是"删一行代码"
- sed 注入一个完整的树组件到 4.1MB 的 minified React bundle 里 → **不可维护，极易出错**
- 变量名每次构建都会变，sed 匹配极其脆弱

**替代方案：独立 JS 文件 + DOM 注入**

```
proma-tree-view.js    ← 独立文件，纯 vanilla JS，渲染树形 DOM
proma-tree-view.css   ← 独立文件，树形样式
index.html            ← 补丁：加载上述两个文件
main.cjs              ← 补丁：新增 IPC handler 读取 tree-state.json
```

优势：

- 代码可读、可维护、可调试
- 不依赖 React 渲染周期，不破坏现有 UI
- 升级官方版时只需重跑补丁脚本（文件复制 + sed）

### 数据流

```
tree-state.json (磁盘)
    ↑ readFileSync
main.cjs IPC handler ("get-tree-states")
    ↑ ipcRenderer.invoke
proma-tree-view.js (renderer 进程)
    ↓ DOM 操作
<div id="proma-tree-panel"> (侧边栏顶部)
    ↓ 用户点击
ipcRenderer.send("navigate-to-session", sessionId)
    ↓
main.cjs → 触发 session 切换
```

---

## 三、实现步骤

### Step 1: 新增 IPC Handler（main.cjs 补丁 I）

在 main.cjs 中新增两个 IPC handler：

**I-1:** `proma:get-tree-states` — 扫描并返回所有 tree 数据

```javascript
// 伪代码
ipcMain.handle('proma:get-tree-states', async () => {
  const treesDir = path.join(workspaceRoot, '.context', 'trees');
  const trees = [];
  for (const dir of fs.readdirSync(treesDir)) {
    const statePath = path.join(treesDir, dir, 'tree-state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      trees.push({
        tree_id: dir,
        leaves: state.leaves,
        root_brief: state.root_brief,
        root_dod: state.root_dod,
        _meta: state._meta
      });
    }
  }
  return { ok: true, trees };
});
```

**I-2:** `proma:navigate-to-session` — 切换当前活跃会话

```javascript
// 伪代码
ipcMain.on('proma:navigate-to-session', (event, sessionId) => {
  // 调用现有的 session 切换逻辑
  // 具体 API 需要从 main.cjs 中提取
});
```

**注入方式**：sed 在合适位置插入上述代码。参考补丁 B 的模式——在 `app.whenReady()` 或 IPC 注册区域追加。

### Step 2: 创建独立前端文件

**proma-tree-view.js**（约 200-300 行 vanilla JS）：

核心功能：

- `init()` — 创建 DOM 容器，挂载到侧边栏顶部
- `fetchTrees()` — 通过 IPC 获取 tree 数据
- `renderTree(tree)` — 递归构建树形 DOM
- `buildLeafNode(leaf)` — 渲染单个节点（颜色圆点 + 标题 + 角色标签）
- `handleClick(sessionId)` — 发送 IPC 导航到会话
- `startPolling(intervalMs)` — 定时刷新（默认 3000ms）

节点渲染逻辑：

```
┌─────────────────────────────────────────┐
│ 📁 nanju (v0.2 路线图)          [展开] │  ← 根节点，加粗
│  ├─ 🔀 A-commander (子任务A)   🟢 done │  ← 枝杈，V4 Flash
│  │   ├─ 🍃 A1-worker (草稿)   🟢 done │  ← 叶子
│  │   └─ 🍃 A2-worker (审查)   🔵 active│
│  └─ 🔀 B-commander (子任务B)   🔵 active│
│      └─ 🍃 B1-worker (实现)    🟡 blocked│
└─────────────────────────────────────────┘
```

状态颜色：

- 🟢 `#22c55e` — done
- 🔵 `#3b82f6` — active
- 🟡 `#f59e0b` — blocked
- 🔴 `#ef4444` — pruned
- ⚫ `#6b7280` — archived

**proma-tree-view.css**（约 80-120 行）：

- 面板容器：侧边栏顶部，max-height 40vh，overflow-y auto
- 折叠/展开：CSS transition
- 缩进线：`border-left` + `::before` 伪元素画竖线和横线
- 节点 hover：背景高亮
- 响应式：适配亮色/暗色主题

### Step 3: 注入到 index.html

在 `renderer/index.html` 中注入：

```html
<!-- Proma Tree View Panel -->
<link rel="stylesheet" href="./assets/proma-tree-view.css">
<script src="./assets/proma-tree-view.js"></script>
```

通过 `sed` 或直接文件复制（index.html 是明文 HTML，不是 minified）。

### Step 4: 部署

```bash
# 复制新文件
cp proma-tree-view.js D:/Proma-dev/resources/app/dist/renderer/assets/
cp proma-tree-view.css D:/Proma-dev/resources/app/dist/renderer/assets/

# 注入 HTML 引用（sed）
sed -i 's|</head>|<link rel="stylesheet" href="./assets/proma-tree-view.css">\n</head>|' D:/Proma-dev/resources/app/dist/renderer/index.html
sed -i 's|</body>|<script src="./assets/proma-tree-view.js"></script>\n</body>|' D:/Proma-dev/resources/app/dist/renderer/index.html

# 注入 main.cjs IPC handler（sed）
# ... 在合适位置插入 IPC handler 代码

# 重启 Dev 实例
```

---

## 四、技术风险与缓解

| 风险 | 严重度 | 缓解 |
| --- | --- | --- |
| **导航 API 未知**：main.cjs 中切换会话的具体函数需要从 minified 代码中定位 | 高 | 先用 `shell.openExternal` 或复制 session_id 到剪贴板作为 fallback；后续 grep main.cjs 定位导航函数 |
| **侧边栏 DOM 结构变化**：升级官方版后侧边栏 CSS 选择器可能变 | 中 | 用 `document.querySelector` 的鲁棒选择器，或在 index.html 中预留固定锚点 `<div id="proma-tree-anchor">` |
| **暗色主题适配**：CSS 变量名随版本变化 | 低 | 用 `prefers-color-scheme` + 读取 body 上的主题 class |
| **IPC 性能**：每 3 秒读一次磁盘文件 | 低 | tree-state.json 通常 &lt; 50KB，`readFileSync` 微秒级 |
| **多个 tree 同时活跃** | 中 | 默认展示最近更新的 tree，支持切换（下拉选择） |

---

## 五、分阶段交付

### v0.1 MVP（最小可行）

- 单个 tree 的树形展示
- 状态颜色圆点 + 标题
- 3 秒轮询刷新
- 点击节点 = 复制 session_id（fallback 导航）
- 手动刷新按钮

### v0.2 增强

- 多 tree 切换
- 真正的点击导航（定位 main.cjs 的 session 切换函数）
- 展开/折叠动画
- milestone 进度条（完成数/总数）

### v0.3 完善

- 暗色主题自适应
- 拖拽折叠面板大小
- 新节点出现的动画
- deviation 告警闪烁

---

## 六、与 Q1 的协同

Q1 和 Q2 相互独立但互补：

- Q1 解决"树结构正确性"（叶子干净上下文、role 正式化、分布式状态写入）
- Q2 解决"树结构可视化"（侧边栏面板、实时刷新、点击导航）

Q2 的面板读取 tree-state.json，Q1 完善了 tree-state.json 的数据质量 → Q1 做得越好，Q2 面板显示的信息越准确。

建议实施顺序：**先 Q1 再 Q2**。Q1 的 role 枚举和 parent 链规范化后，Q2 的面板才能正确区分枝杈/叶子并渲染层级关系。

---

## 七、验证方案

### 模拟验证（不需 Dev 实例）

```bash
# 1. 创建测试 tree
node tree-state.js init demovis --root-brief '{"parent_intent":"demo"}' --root-dod '{"deliverables":[]}'

# 2. 添加根、枝杈、叶子
node tree-state.js leaf add demovis --json '{"leaf_id":"demovis-root","session_id":"s1","parent":null,"path":"","role":"root","model":"deepseek-v4-pro","channel":"56ecefd2"}'
node tree-state.js leaf add demovis --json '{"leaf_id":"demovis-A-commander","session_id":"s2","parent":"demovis-root","path":"A","role":"commander","model":"deepseek-v4-flash","channel":"56ecefd2"}'
node tree-state.js leaf add demovis --json '{"leaf_id":"demovis-A1-worker","session_id":"s3","parent":"demovis-A-commander","path":"A1","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2"}'

# 3. 模拟状态变更
node tree-state.js leaf set-status demovis demovis-A1-worker done
node tree-state.js milestone add demovis demovis-A-commander --json '{"id":"M1","desc":"test","expect_outputs":[]}'

# 4. 渲染验证
# 手动检查 proma-tree-view.js 的 renderTree 输出是否匹配预期 DOM 结构
```

### Dev 实例集成验证

1. 部署所有文件到 Dev 实例
2. 重启 Dev，打开侧边栏 → 应看到树形面板
3. 创建 demovis tree → 面板自动出现树
4. 修改 leaf 状态 → 3 秒后面板颜色更新
5. 点击节点 → 跳转到对应会话

### 验收标准

- [ ] 树形面板出现在侧边栏顶部

- [ ] 正确渲染 3 层树（root → commander → worker）

- [ ] 状态颜色与 tree-state 一致

- [ ] 点击节点执行导航（或复制 session_id）

- [ ] 3 秒轮询正常刷新

- [ ] 不影响现有侧边栏功能（session 列表、搜索、设置等）

- [ ] 空 tree 时不崩溃（显示"暂无活跃任务树"）

- [ ] 折叠/展开面板功能正常

---

## 八、实施步骤总览

| 步骤 | 内容 | 预估 | 依赖 |
| --- | --- | --- | --- |
| 1 | 定位 main.cjs 中的 session 导航 API | 中 | — |
| 2 | 实现 main.cjs 补丁 I（IPC handlers） | 中 | 步骤 1 |
| 3 | 编写 proma-tree-view.js | 大 | — |
| 4 | 编写 proma-tree-view.css | 小 | — |
| 5 | 注入 index.html 引用 | 小 | — |
| 6 | 部署 + Dev 实例集成测试 | 中 | 步骤 2-5 |
| 7 | 暗色主题适配 | 小 | 步骤 6 |
| 8 | 文档更新（wiki + 补丁清单） | 小 | 步骤 6 |

**总预估**：约 3-4 个补丁的工作量（补丁 I-1 + I-2 + HTML 注入 + 前端文件），比现有补丁 A-H 中单个补丁略大，但远小于整个 patches.cjs 的体量。

