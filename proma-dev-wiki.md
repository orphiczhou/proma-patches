# Proma 技术 Wiki（精简版）

> 完整 Wiki 维护在本地 workspace-files，本文是面向 GitHub 发布的精简版。

## 核心原则

**不可从开源源码重构建 main.cjs**：商业版有 15 个闭源模块（cloudAuth/sync/billing），源构建会导致登录失败。

**正确方式**：商业版 main.cjs + sed 补丁 + 插件文件

## 补丁清单

### 基础补丁
| 补丁 | 功能 | sed 命令 |
|---|---|---|
| 1 | DeepSeek 子Agent → v4-pro | `s/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g` |
| 2 | PROMA_DEV 隔离 | `s/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged \|\| process.env.PROMA_DEV === "1") {/g` |
| 3 | 托盘图标白色 | `s/"iconTemplate.png"/"proma-white.png"/g` |
| 4 | 版本号校正 | 改 `package.json` |

### 插件系统补丁
| 补丁 | 功能 | 注入点 |
|---|---|---|
| A | MCP 钩子 | `sendMessage()` 中 `const dynamicCtx` 之前 |
| B | API 桥接 + require 插件 | `init_index()` 之后 |
| B2 | runAgentHeadless 桥接 | 扩展补丁 B |
| B3 | listAgentWorkspaces 桥接 | 扩展补丁 B |
| C1-5 | 频道/模型元数据覆盖 | `sendMessage()` 多处 |
| D | Renderer 版本同步 | 升级时整体替换 |
| E | 移除 hydration 幂等守卫 | renderer JS 中 `if(qe.has(e))return qe;` |

## 插件工具（10 个）

| 工具 | 功能 |
|---|---|
| `get_my_session_id` | 获取当前会话 ID |
| `list_channels` | 列出 AI 渠道 |
| `list_workspaces` | 列出工作区 |
| `list_sessions` | 列出 Agent 会话 |
| `get_session_info` | 会话详情 |
| `get_session_context` | Token 用量（含上下文窗口/使用率） |
| `list_messages` | 消息历史（分页，含 UUID） |
| `create_session` | 创建新会话 |
| `fork_session` | Fork 会话 |
| `send_message` | 向目标会话发消息（3 种模式） |

## 版本历史

| 版本 | 日期 | 改动 |
|---|---|---|
| v0.6 | 2026-06-15 | 插件模式 POC |
| v0.7 | 2026-06-15 | UI 模型同步 |
| v0.8 | 2026-06-15 | get_session_context 工具 |
| v0.9 | 2026-06-16 | 外部 MCP 服务（HTTP bridge + stdio） |
| v0.10 | 2026-06-16 | send_message + list_messages + 多工作区 |
| v0.10.1 | 2026-06-16 | 10 工具体系 + 完整验证 |
| v0.11 | 2026-06-17 | remote-session 11 工具 (提案阶段2) + 实例命名体系 |

## 树形 UI 浮窗补丁（patch-L/M/M+）

> 独立补丁系列，叠加在插件系统补丁之上。源码发布在 `release/tree-system-v0.2.2/patch-l/`，5 个文件直接 cp 到 `D:/Proma-dev/resources/app/dist/`。

| 版本 | 日期 | 改动 |
|---|---|---|
| patch-L v0.1 | 2026-06-21 | 树形 UI 面板首版（IPC + 浮窗 + fallback 按钮） |
| patch-M v0.1 | 2026-06-22 | TAO Watcher 脚本主导重写（5min interval + nudge + audit-gate） |
| patch-M+ v0.2 | 2026-06-22 | 树面板重写为可调节浮窗 + 真正切换会话（tray:open-agent-session IPC） |
| patch-M+ v0.2.1 | 2026-06-22 | 修复数据混杂 — 按 workspace 分组返回（IPC 用 discoverAllWorkspacesWithTrees） |
| patch-M+ v0.3 | 2026-06-22 | 入口按钮精准注入（每个 .group/project 项目行 absolute 定位 right:60px）+ DOM dump 工具（proma:dom-dump IPC，preload 白名单） |
| patch-M+ v0.3.1 | 2026-06-22 | IPC 加 instance filter（ISOLATED → ~/.proma-dev，否则 ~/.proma）避免跨实例显示 + 清理临时 debug labels |
| patch-M+ v0.4 | 2026-06-22 | 入口按钮记忆 workspace_slug（React fiber + textContent 反查兜底）→ 点击从哪个项目进就激活哪个 workspace + 活跃 tree 排顶 + 不活跃 tree 标灰 |
| patch-M+ v0.4.1 | 2026-06-22 | 修两层 tab 完整显示: IPC 返回所有 workspace(含 name 不再过滤空) + UI 总是显示第一层 workspace tab + 空 workspace 标灰 |
| patch-M+ v0.4.2 | 2026-06-22 | 修第一层只显示 1 个 workspace 的 bug: discoverAllWorkspacesWithTrees 不再强制要求 trees 目录存在, 5 个 workspace 都返回 |

### 关键文件

| 文件 | 作用 |
|---|---|
| `proma-dev-patches.cjs` | 主入口；注册 IPC、TAO Watcher、workspace 发现 |
| `preload.cjs` | renderer 桥接；promaTreeIpc.invoke 白名单（必须同步加 channel） |
| `renderer/assets/proma-tree-view.js` | 浮窗 UI + 入口按钮注入（MutationObserver 持续 inject） |
| `renderer/assets/proma-tree-view.css` | 浮窗样式 |
| `renderer/index.html` | 注入 link/script 引用 |

### 已知约束

- **不修改 main.cjs**（AGPL 合规，所有逻辑写进 patches.cjs）
- **零外部依赖**（patches.cjs 只用 Node.js 内置 + electron）
- **preload.cjs 白名单制**：新增 IPC channel 必须同步加白名单，否则 renderer invoke 被 reject
- **preload.cjs 已经被 Proma 商业版 require**，修改会立即生效（不需要重启 main 进程之外的步骤）

## 测试记录

### 2026-06-17 remote-session Release 验收 — ❌ 不通过

- **测试方**：Proma Agent（本会话 b18c436b）
- **目标实例**：Release (instance: "release")
- **工具调用层面**：11/11 返回正常，中文无乱码
- **用户判定**：验收不通过（具体问题待用户说明）
- **下一步**：Fork 到新会话重新测试