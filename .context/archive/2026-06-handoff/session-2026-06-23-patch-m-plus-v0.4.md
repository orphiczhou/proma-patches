# 会话交接 — 补丁 M+ v0.4.4（两层 tab + 入口定位 + 时间倒排）

> 日期: 2026-06-23 07:30
> 上一会话: 373bd614-319c-4ed3-aaec-501aac3d74ec (2026-06-22)
> 当前会话: ca9df2c3-ba5c-46af-b053-da511638672a
> 工作区: Proma 改造探索
> 启动原因: 跨日上下文腐化 + 验证发现 2 个未解决问题

---

## 一、整体进度

正在开发 **补丁 M+（树形 UI 浮窗）**，已发布到 v0.4.4。两层 tab 联动通过，但**入口定位**和**时间排序**有 bug 待修。

### v0.4 系列版本时序

| commit | 内容 |
|--------|------|
| `867e48b` | feat(patch-M+ v0.3): 入口按钮精准注入到每个项目行 + IPC 加实例过滤 |
| `483e092` | feat(patch-M+ v0.4): 入口记忆 workspace_slug + 活跃 tree 排顶标灰 |
| `d6ecada` | feat(patch-M+ v0.4.1): 修两层 tab 完整显示 (IPC 返回所有 workspace) |
| `b9d4231` | fix(patch-M+ v0.4.2): 修第一层只显示 1 个 workspace 的 bug |
| `cee9fb0` | feat(patch-M+ v0.4.3): 第二层按时间倒排 + dump 调试入口定位 |
| `821fef3` | fix(patch-M+ v0.4.4): 修入口定位 - 用真实 React fiber 字段名 |
| `90b13d4` | docs(wiki): 记录 v0.4.4 验证结果 + 待解决问题根因 |

---

## 二、当前任务状态（v0.4.4 验证结果）

### ✅ 通过
- **两层 tab 联动**：点第一层 workspace tab → 第二层 tree 切换显示

### ❌ 未解决（用户明确要求"先不改，写 wiki + commit + 交接"）

#### 问题 A：入口定位 10 次只 1 次生效
**用户期望**：从"南大项目"的 🌳 进 → 浮窗第一层自动激活"南大项目"。
**实际**：90% 概率激活 proma（current workspace），10% 概率激活对应 workspace。

**根因（已诊断）**：
- `injectEntryButton` 注入 🌳 时调 `getWorkspaceSlugFromProjectGroup`
- 如果注入时 DOM 刚渲染、React fiber 还没准备好（aria-controls / props.group.workspace 都没填）→ 拿到 slug=null
- MutationObserver 后续重试时检查 `existing && group.contains(existing)` → 已注入直接 return，**slug 永远不会被更新**
- 🌳 按钮的 onClick 用闭包 slug=null → showOverlay(null) → 浮窗走默认逻辑（proma）

**修复方向（不要遗漏）**：
```js
// proma-tree-view.js makeEntryBtn 的 onClick 不要用闭包 workspaceSlug
// 改为每次点击时重新从 DOM 拿:
onClick: (e) => {
  e.preventDefault();
  e.stopPropagation();
  let slug = workspaceSlug;  // 闭包值作为兜底
  try {
    const group = e.currentTarget.closest('.group\\/project');
    if (group) slug = getWorkspaceSlugFromProjectGroup(group) || slug;
  } catch (_) {}
  if (state.floatingVisible) hideOverlay();
  else showOverlay(slug);
}
```

#### 问题 B：第二层排序不对
**用户期望**：按最近活动时间倒排，活跃的排前。
**实际**：灰色（不活跃）tree 排第一（4d 前），活跃 tree 排第二（3 天前）。

**根因（已诊断）**：
- IPC 加 `latest_activity_ts = max(leaves[].last_event_ts, last_heartbeat, created_at, mtime_ms)`
- **mtime_ms 是文件系统时间**，TAO Watcher 跑过会更新 tree-state.json 导致 mtime 变很新
- 不活跃 tree 的 mtime 可能比活跃 tree 的 last_event_ts 更新 → 被顶到第一

**修复方向（不要遗漏）**：
```js
// proma-dev-patches.cjs readTreesFromDir 里, 去掉 mtimeMs 参与 latest_activity_ts 计算:
let latestTs = 0;  // 不再用 mtimeMs 作为初始值
try {
  if (state.last_heartbeat) {
    const t = new Date(state.last_heartbeat).getTime();
    if (!isNaN(t) && t > latestTs) latestTs = t;
  }
  if (state.created_at) {
    const t = new Date(state.created_at).getTime();
    if (!isNaN(t) && t > latestTs) latestTs = t;
  }
  for (const leaf of Object.values(state.leaves || {})) {
    if (leaf && leaf.last_event_ts) {
      const t = new Date(leaf.last_event_ts).getTime();
      if (!isNaN(t) && t > latestTs) latestTs = t;
    }
  }
} catch (_) {}
// 如果业务时间字段全空, 退化用 mtimeMs
if (latestTs === 0) latestTs = mtimeMs;
```

---

## 三、关键技术发现（dump 拿到的真实数据）

### Proma 项目按钮的 React fiber 结构（v0.4.4 dump）

来源：`tao-engine/dom-dump-project-info.txt`

```
d0 (button):
  aria-controls: "project-sessions-<workspace-uuid>"  ← 最稳, 每个 button 都有
  onClick: function

d1 (group/project div):
  className: "group/project relative flex items-center"

d2:
  className: "relative py-0.5 rounded-md transition-opacity"

d3 (ProjectGroup component):
  group: { workspace, sessions }    ← 嵌套对象, workspace.slug 在这里
  currentWorkspaceId: "<uuid>"      ← 当前激活 workspace UUID
  activeSessionId: "<uuid>"
  onSelectProject: function
  onNewSession: function
  ...
```

### 3 重保险拿 workspace_slug（已实现，见 `getWorkspaceSlugFromProjectGroup`）

1. **方法 0 (最稳)**：`aria-controls` regex 提取 UUID → `workspaceIdToSlug[uuid]` 反查
2. **方法 1**：`props.group.workspace.slug` 直接拿 / `.id` 反查
3. **方法 1.5**：`props.currentWorkspaceId` → `workspaceIdToSlug` 反查
4. **方法 2 (兜底)**：textContent 反查 `workspaceNameToSlug`

### release 实例的 5 个 workspace

来源：`~/.proma/agent-workspaces.json`

| name | slug | id | 有 tree |
|------|------|-----|---------|
| Proma改造探索 (当前 ★) | proma | 743ff4fe-... | 16 个 |
| 南大项目 | default | 0f21b16e-... | 0 |
| 本机工作 | workspace-1776227916908 | 060b3d80-... | 0 |
| 三元溯源 | workspace-1778510916164 | d8d2cf1a-... | 0 |
| 高维空间理解 | workspace-1779015714856 | 163b417f-... | 0 |

---

## 四、环境信息

### 启动方式
- 用户启动 release 实例：双击 `D:/Proma-dev/start-release.bat`（**注意：用的是 dev 目录的 exe**）
- 也可能是 `D:/Proma-release/start-release-fresh.bat`（启动 `D:/Proma-dev/Proma-coral.exe` + ISOLATED=1）
- **关键**：所有改动部署到 `D:/Proma-dev/resources/app/dist/`，不要部署到 `D:/Proma-release/`（那是旧版 6/18 没有 patches）

### 三个实例的代码状态
| 实例 | 代码位置 | 状态 |
|------|---------|------|
| **Dev** | `D:/Proma-dev/resources/app/dist/` | ✅ 有补丁 L/M/M+ v0.4.4（最新） |
| **Release-fresh** | 共享 Dev 的 exe | ✅ 跟 Dev 一样 |
| **Release** | `D:/Proma-release/...` | ❌ 6/18 旧版，无补丁 |

---

## 五、关键文件路径

### 源码（部署目标）
- `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs` — 补丁 L + M + M+ 入口（1500+ 行）
- `D:/Proma-dev/resources/app/dist/preload.cjs` — promaTreeIpc 桥接（白名单制）
- `D:/Proma-dev/resources/app/dist/renderer/assets/proma-tree-view.js` — 浮窗 UI（1100+ 行）
- `D:/Proma-dev/resources/app/dist/renderer/assets/proma-tree-view.css` — 浮窗样式（600+ 行）
- `D:/Proma-dev/resources/app/dist/renderer/index.html` — 注入 link/script 引用

### 发布包
- `workspace-files/release/tree-system-v0.2.2/patch-l/` — 5 个文件镜像（与 Dev 同步）
- `workspace-files/proma-dev-wiki.md` — 面向 GitHub 发布的精简 wiki

### 数据
- `~/.proma/agent-workspaces/proma/workspace-files/.context/trees/` — 16 个 tree 目录
- `~/.proma/agent-workspaces.json` — workspace 元数据（id/name/slug）
- `~/.proma/agent-workspaces/proma/workspace-files/tao-engine/dom-dump-*.txt` — 调试 dump
- `~/.proma/agent-workspaces/proma/workspace-files/tao-engine/config.json` — Watcher 配置

### Git
- workspace-files 仓库：`~/.proma/agent-workspaces/proma/workspace-files/`
- 最近 commit：`90b13d4 docs(wiki): 记录 v0.4.4 验证结果`

---

## 六、未完成任务清单（按优先级）

### 立即要做（v0.4.5，下次会话）
1. **修入口定位 race condition**（问题 A）
   - 改 `makeEntryBtn` 的 onClick: 重新调 `getWorkspaceSlugFromProjectGroup` 而不是用闭包 slug
   - 文件：`proma-tree-view.js`
2. **修排序 mtime 干扰**（问题 B）
   - 改 IPC handler `readTreesFromDir`: 去掉 `mtimeMs` 参与 `latest_activity_ts` 计算
   - 业务时间字段全空时退化用 mtime
   - 文件：`proma-dev-patches.cjs`

### 验证后做
3. 同步到 `release/tree-system-v0.2.2/patch-l/` + commit + wiki

### v0.5 候选（远期）
- split view（点击树叶 → 同屏切会话，用户原本 v0.2 要求，交接被降级到 v0.3）
- 倒竖时间线视觉（用户被"下一规划"劝住，决定不做）

---

## 七、关键约束（不要违反）

1. **不修改 main.cjs**（AGPL 合规，所有逻辑写进 patches.cjs）
2. **零外部依赖**（patches.cjs 只用 Node.js 内置 + electron）
3. **向后兼容**（每次改 tree-state.js 跑 migrate 让历史数据合规）
4. **破坏性操作前先跟用户确认**
5. **commit 时只 add 自己改的文件**（不要 add 用户的 PROJECT-INDEX/note.md/plan 等）
6. **每改好一个问题写 wiki + commit**（用户明确要求的标准操作）
7. **倒竖时间线不要做**（用户被下一规划劝住）

---

## 八、用户偏好备忘

- **喜欢具体例子**：描述方案要给代码片段，不要空谈
- **反对附和**：要诚实提出反对意见，不要为了讨好而同意
- **接受限制**：解释清楚技术约束后能接受合理折中
- **决策快**：用 AskUserQuestion 给具体选项，秒选，不喜欢开放式提问
- **重视文档**：每个阶段产物要落盘到 `.context/`
- **不喜欢长篇大论**：回复简洁，code 优先于 prose
- **F12 DevTools 走不通**：必须用 dump 路径调试 renderer
- **倒竖时间线不要做**

---

## 九、给新会话的启动 prompt 建议

```
你接手 Proma 改造项目，当前任务：修补丁 M+ v0.4.4 的 2 个 bug。

先读：
1. workspace-files/.context/handoff/session-2026-06-23-patch-m-plus-v0.4.md（本文件）
2. workspace-files/proma-dev-wiki.md（v0.4.4 验证结果章节）

待修 2 个 bug：
- 问题 A（入口定位 race condition）: makeEntryBtn 的 onClick 用闭包 slug, 应该重新调 getWorkspaceSlugFromProjectGroup
- 问题 B（排序 mtime 干扰）: latest_activity_ts 用了 max(..., mtime_ms), mtime 被 watcher 更新过会顶上来

修复路径：
1. 改 D:/Proma-dev/.../proma-tree-view.js 的 makeEntryBtn onClick
2. 改 D:/Proma-dev/.../proma-dev-patches.cjs 的 readTreesFromDir
3. 同步到 release/tree-system-v0.2.2/patch-l/
4. commit + wiki

约束：不动 main.cjs，不动 Release 目录，commit 时只 add 自己改的文件，倒竖时间线不要做。
```

---

> 本交接由 Proma Agent 撰写，跨会话恢复必读。
