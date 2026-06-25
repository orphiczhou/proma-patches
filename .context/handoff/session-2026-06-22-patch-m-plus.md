# 会话交接 — 补丁 M+（树形 UI 浮窗）+ 数据混杂修复 + 入口按钮定位

> 日期: 2026-06-22 14:22
> 上一会话: 373bd614-319c-4ed3-aaec-501aac3d74ec
> 工作区: Proma改造探索
> 启动原因: 上下文将腐化，开新会话继续

---

## 一、当前任务状态

### 整体进度
正在开发 **补丁 M+（树形 UI 浮窗）**，已完成 80%，剩入口按钮定位问题待解。

### 三次 commit（按时序）
| commit | 内容 |
|--------|------|
| `23a4061` | feat(patch-M v0.1): TAO Watcher 脚本主导重写 |
| `308fad1` | feat(patch-M+ v0.2): 树面板重写为可调节浮窗 + 真正切换会话 |
| `2408944` | fix(patch-M+ v0.2.1): 修复数据混杂 - 按 workspace 分组返回 |

### 工作区**未 commit** 的改动（已部署到 D:/Proma-dev，但还没进 git）
1. `D:/Proma-dev/resources/app/dist/renderer/assets/proma-tree-view.js`
   - 入口按钮 selector 改为 `.tabbar-bg`（最优先）
   - 加 `dumpDOMForDebug()` 函数，启动 3s 后把 DOM 结构发回主进程
   - 加 `domDumped` 标志避免重复 dump
2. `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`
   - 新增 IPC `proma:dom-dump`：把 renderer DOM 写到 `tao-engine/dom-dump.txt`

**下次新会话先 commit 这些再继续**。

---

## 二、用户反馈的两个问题（这是当前焦点）

### 问题 1：入口按钮位置不对
- 现状：fallback 在右上角 fixed 浮动按钮，跟 Proma 原 icon 重叠
- 用户期望：注入到工作区 tab 栏右侧（每个工作区一个入口）
- 用户原话："在工作区域的入口，现在只有一棵树啊，位置太靠右边，跟原有的点点点 icon 重叠了，为什么不是每个工作区一个"

### 问题 2：数据混杂（已修复，commit `2408944`）
- 现状：用户看到一长排 tree，其中很多不是当前实例的
- 根因：补丁 L 的 IPC handler 写死读 `~/.proma/agent-workspaces/proma/workspace-files/.context/trees/`（slug="proma"），那里堆了 16 个历史测试 tree
- 修复：IPC 改用 `discoverAllWorkspacesWithTrees()`（跟 WatcherManager 统一），按 workspace 分组返回

---

## 三、关键发现：Proma DOM 结构线索（新会话必读）

从 React bundle `index-q2RzEXb9.js` grep 出来的稳定 class 名：

| class | 用途 |
|-------|------|
| `.tabbar-bg` | tab 栏容器（file preview tab 等） |
| `.crt-sidebar` | 侧边栏 |
| `.titlebar-drag-region` | 窗口顶部可拖动区 |
| `.titlebar-no-drag` | 顶部按钮区（不可拖动）|
| **`.titlebar-no-drag.automation-entry`** | **🔥 Proma 自己的"自动任务"入口按钮** |
| `.workspace-badge` | session tab 上的 workspace 标签 chip |
| `.session-item` | 会话列表项 |

### 下一步关键思路
**注入到 `.automation-entry` 旁边** —— 这是 Proma 自己的入口按钮位置，class 稳定，跟我们的功能定位一致（都是"工具入口"）。

具体实现：
```js
// injectEntryButton 的 candidates 数组加一项（放最优先位置）：
{ selector: '.automation-entry', insert: 'before' }  // 注入到 automation-entry 之前
// 或
{ selector: '.automation-entry', insert: 'sibling-before' }
```

### DOM 探测机制（已部署）
代码已经让 renderer 启动 3s 后把以下 selector 的 outerHTML 通过 IPC 发回主进程：
- `.tabbar-bg`
- `[class*="tabbar"]`
- `header`
- `[class*="sidebar"]`

写到 `~/.proma/agent-workspaces/proma/workspace-files/tao-engine/dom-dump.txt`。

**新会话开始后第一件事**：让用户重启 Dev，读取 `tao-engine/dom-dump.txt` 拿到真实 DOM，再精准写 selector。

---

## 四、用户已经确认的决策（不要重新讨论）

| 决策点 | 用户选择 |
|--------|---------|
| 浮窗模式 | 可调节浮窗（默认记忆 localStorage） |
| 入口位置 | 工作区 tab 栏旁（每个工作区一个） |
| 树形方向 | 横向缩进（保留现状） |
| 切换会话 | 用 Proma 内置 `tray:open-agent-session` IPC |
| Watcher 实现 | Node.js 脚本主导（不走 Agent 会话） |
| Watcher interval | 5 分钟可配置 |
| nudge 上限 | 2 次（事不过三） |
| watcher 默认开关 | 记忆上次状态（config.json 的 enabled 字段） |
| 违规响应 | send_message 到违规 leaf + 写日志，不通知用户 |
| v0.1 LLM 调用 | 不调，纯降级模式 |

---

## 五、环境信息

### 当前进程
- 我跑在 **Release 实例**：`PROMA_INSTANCE_NAME=release`, `ISOLATED=0`
- 通过 `D:\Proma-release\start-release.bat` 启动 → 加载 `D:\Proma-release\Proma-black.exe`
- 但 **Release 目录代码是 6/16-6/19 旧版**，没有补丁 L/M
- 我（agent）所在的会话 ID: `373bd614-319c-4ed3-aaec-501aac3d74ec`

### 三个实例的代码状态
| 实例 | 代码位置 | 状态 |
|------|---------|------|
| **Dev** | `D:/Proma-dev/resources/app/dist/` | ✅ 有补丁 L/M/M+（最新） |
| **Release** | `D:/Proma-release/resources/app/dist/` | ❌ 6/16-6/19 旧版，没补丁 |
| **Release-fresh** | 共享 Dev 的 exe | ✅ 跟 Dev 一样 |

### 用户重启 Dev 的方法
关闭 Dev 实例 → 双击 `D:\Proma-dev\start-dev.bat`（启动 `Proma-white.exe` + `PROMA_INSTANCE_NAME=dev` + `ISOLATED=1`）

---

## 六、关键文件路径

### 源码（部署目标）
- `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs` — 补丁 L + M 入口（2000+ 行）
- `D:/Proma-dev/resources/app/dist/preload.cjs` — promaTreeIpc 桥接
- `D:/Proma-dev/resources/app/dist/renderer/assets/proma-tree-view.js` — 浮窗 UI（800+ 行）
- `D:/Proma-dev/resources/app/dist/renderer/assets/proma-tree-view.css` — 浮窗样式（500+ 行）
- `D:/Proma-dev/resources/app/dist/renderer/index.html` — 注入 link/script 引用

### 数据
- `C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees/` — 所有 tree 数据
  - `tree-state.js` — 主状态机（v0.2.2 + TAO 子命令）
  - `tao-rules.json` — 35 条规则
  - `tao-{audit,nudge,watcher,health-check}-prompt.md` — TAO prompts
  - 16 个 tree 目录（bverify/l1fix/qfv2/smoke22/taotest/...）— 历史测试数据
- `C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/tao-engine/config.json` — Watcher 配置
- `C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/tao-engine/dom-dump.txt` — DOM 探测输出（重启 Dev 后才有）

### 发布包
- `release/tree-system-v0.2.2/` — 完整发布包
  - `core/tree-state.js`
  - `tao/` — 4 个 prompt + rules.json
  - `patch-l/` — 5 个部署文件
  - `README.md`

---

## 七、未完成任务清单

### 立即要做（新会话开始后）
1. **commit 工作区改动**：
   - proma-tree-view.js（selector 改进 + DOM dump）
   - proma-dev-patches.cjs（proma:dom-dump IPC）
2. **让用户重启 Dev**，验证：
   - 浮窗能正常打开（🌳 按钮位置）
   - DOM dump 写到 `tao-engine/dom-dump.txt`
3. **读取 dom-dump.txt**，分析真实 DOM 结构
4. **改 selector** 注入到 `.automation-entry` 旁边（或 dump 发现的更精确位置）
5. **commit** 精准注入逻辑

### 后续优化
- 每个 workspace 一个入口 icon（用户期望但目前只注入一个全局按钮）
- 入口按钮跟着 workspace 切换而切换选中态
- v0.3 改进项（来自 todo）：
  - B2 文件竞态（watcher 与 Agent 并发写）
  - S2 nudge_log 无限增长
  - L6 IPC 缓存
  - 真正的 split view（会话页 + 树并排）

---

## 八、关键约束（不要违反）

1. **不修改 main.cjs**（AGPL 合规，所有逻辑写进 patches.cjs）
2. **零外部依赖**（patches.cjs 只用 Node.js 内置 + electron）
3. **向后兼容**（每次改 tree-state.js 跑 migrate 让历史数据合规）
4. **破坏性操作前先跟用户确认**
5. **用户当前在 Release 实例**，不要动 Release 目录代码（动了等于改用户当前会话）
6. **Dev 才是开发目标**，所有补丁部署到 `D:/Proma-dev/`
7. **commit 时只 add 自己改的文件**，不要 add 用户的 PROJECT-INDEX/note.md/plan 等遗留改动

---

## 九、给新会话的启动 prompt 建议

```
你接手 Proma 改造项目，当前任务：补丁 M+ 入口按钮精准注入。

先读：
1. workspace-files/.context/handoff/session-2026-06-22-patch-m-plus.md（本文件）
2. workspace-files/PROJECT-INDEX.md（项目总览）
3. workspace-files/.context/todo-v2-tao-engine.md（v2 待办）

未 commit 改动：
- D:/Proma-dev/resources/app/dist/renderer/assets/proma-tree-view.js
- D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs

立即行动：
1. 让用户重启 Dev 实例
2. 读 workspace-files/tao-engine/dom-dump.txt（重启后生成）
3. 根据真实 DOM 写精准 selector，注入到 .automation-entry 附近
4. commit

约束：不动 main.cjs，不动 Release 目录，commit 时只 add 自己改的文件。
```

---

## 十、用户偏好备忘

- **喜欢具体例子**：描述方案要给代码片段，不要空谈
- **反对附和**：要诚实提出反对意见，不要为了讨好而同意
- **接受限制**：解释清楚技术约束后，用户能接受合理折中
- **决策快**：用 AskUserQuestion 给具体选项，用户秒选，不喜欢开放式提问
- **重视文档**：每个阶段产物要落盘到 `.context/`
- **不喜欢长篇大论**：回复要简洁，code 优先于 prose

---

> 本交接由 Proma Agent 撰写，跨会话恢复必读。
