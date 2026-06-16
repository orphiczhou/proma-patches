# Proma 开发版 Wiki

> 最后更新: 2026-06-15 | 维护者: 周星星

---

## 一、核心概念：源码 ≠ 运行版本

**重要区分：**

| | 源码仓库 | 运行版本 |
|---|---|---|
| **位置** | `proma-source/` | `D:\Proma\`、`D:\Proma-dev\`、`D:\Proma-release\` |
| **来源** | GitHub `ErlichLiu/Proma` | 商业版安装包 |
| **版本** | v0.12.23（开源） | v0.12.23（商业，含闭源模块） |
| **用途** | 学习架构、理解代码逻辑 | 实际运行和调试 |
| **修改方式** | `git` 管理 TypeScript 改动 | `sed` 在编译后的 `main.cjs` 上打补丁 + 插件文件 |

**关键事实：dev 版不是从源码构建的，而是从商业正式版 `D:\Proma\` 拷贝 → 解包 → sed 打补丁生成。** 源码仓库仅用于理解代码和搜索定位，实际部署走 sed 补丁 + 插件文件流程。

---

## 二、三版架构

| | 正式版 | Dev发行版 | 调试版 |
|---|---|---|---|
| **路径** | `D:\Proma\` | `D:\Proma-release\` | `D:\Proma-dev\` |
| **用途** | 官方原版 | 日常使用（补丁版） | 开发调试 |
| **启动方式** | 正常双击 | `start-release.bat` | `start-dev.bat` |
| **用户数据** | `~/.proma/` | `~/.proma/`（共享） | `~/.proma-dev/`（独立） |
| **PROMA_DEV** | - | - | `=1` |
| **双开** | - | ❌（与正式版互斥） | ✅（可同时） |
| **代码加载** | `app.asar`（原版） | `app.asar`（补丁） | `app/` 目录（解包） |
| **图标** | 黑色 | 渐变色 | 白色 |
| **Electron userData** | `@proma/electron/` | `@proma/electron/`（共享） | `@proma/electron-dev/` |

---

## 三、创建开发版的步骤

### 1. 复制正式版

```bash
cp -r D:/Proma D:/Proma-dev
```

### 2. 解包 ASAR

```bash
cd D:/Proma-dev/resources
npx asar extract app.asar app
mv app.asar app.asar.disabled   # 让 Electron 加载 app/ 目录
```

### 3. 合并原生模块

```bash
cp -r app.asar.unpacked/node_modules/* app/node_modules/
```

### 4. 创建启动脚本 `start-dev.bat`

```bat
@echo off
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma-white.exe"
```

### 5. 同步认证数据

```bash
cp ~/.proma/cloud-auth.json ~/.proma-dev/
cp ~/.proma/channels.json ~/.proma-dev/
cp ~/.proma/user-profile.json ~/.proma-dev/
cp -r %APPDATA%/@proma/electron/Network %APPDATA%/@proma/electron-dev/
cp -r %APPDATA%/@proma/electron/Session%20Storage %APPDATA%/@proma/electron-dev/
cp -r %APPDATA%/@proma/electron/Local%20Storage %APPDATA%/@proma/electron-dev/
```

---

## 四、代码修改方法

### 核心原则：商业版 main.cjs + sed 补丁 + 插件文件

开源源码缺少商业版的 15 个闭源模块（cloudAuth、sync、billing 等），不能直接用 esbuild 重构建——会导致登录功能丢失。**已验证：从源码构建的 main.cjs 部署到 dev 版后，cloudAuth 模块缺失，直接跳登录页。**

### 修改方式分两层

| 层级 | 方式 | 适用场景 |
|---|---|---|
| `main.cjs` | sed 字符串替换 | 常量修改、小段代码注入 |
| `proma-dev-patches.cjs` | 独立插件文件 | 新增 MCP 工具、复杂逻辑 |

### 插件模式（v0.6 新增）

通过 sed 在 `main.cjs` 末尾注入一行 `require("./proma-dev-patches.cjs")`，加载独立插件文件。插件运行在主进程环境，可访问 `global.__proma__` 暴露的 API，所有复杂逻辑写入插件文件即可。

**优势：** 只需极少 sed 改动（1-3 处），大段新功能放插件文件自由编写，不受 sed 限制。

### 提取与部署流程

```bash
# 1. 提取商业版 main.cjs
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp /tmp/app/dist/main.cjs /tmp/main-patched.cjs

# 2. 打所有 sed 补丁（见第五节）

# 3. 部署
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs

# 4. 更新 package.json 版本号
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json

# 5. 双击 start-dev.bat 启动
```

---

## 五、当前已应用的全部补丁

### 基础补丁（每次重建都要打）

#### 补丁 1：DeepSeek 子 Agent 使用 V4 Pro

```bash
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' main.cjs
```

**效果：** DeepSeek 系列主模型的所有子 Agent（explorer、researcher、code-reviewer）路由到 `deepseek-v4-pro`。

#### 补丁 2：PROMA_DEV userData 隔离

```bash
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_DEV === "1") {/g' main.cjs
```

**效果：** `PROMA_DEV=1` 时使用 `@proma/electron-dev/` userData，实现与正式版双开。

#### 补丁 3：托盘图标白色

```bash
sed -i 's/"iconTemplate.png"/"proma-white.png"/g' main.cjs
```

**效果：** 托盘图标与任务栏 Proma-white.exe 统一为白色。

---

### 插件系统补丁

#### 补丁 A：MCP 钩子

**注入点：** `sendMessage()` 方法内，`customMcpServers` 合并块之后（搜索 `const dynamicCtx = buildDynamicContext({`）

```bash
sed -i 's|          const dynamicCtx = buildDynamicContext({|if(typeof global.__proma_getMcpServers__==="function"){const __h=global.__proma_getMcpServers__(sessionId,workspaceSlug,sdk);if(__h)Object.assign(mcpServers,__h);}\n          const dynamicCtx = buildDynamicContext({|' main.cjs
```

**效果：** 在每次 Agent 会话启动时，调用插件注册的钩子函数注入额外的 MCP 服务器。

#### 补丁 B：API 桥接 + 插件加载

**注入点：** `init_index();` 之后（文件末尾最后一处）

```bash
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' main.cjs
```

**效果：** 导出主进程 API 到 `global.__proma__`（11 个函数），加载插件文件。

#### 补丁 B2：runAgentHeadless 桥接（v0.9 新增）

`send_message` 工具通过 `runAgentHeadless` 实现目标会话的 headless 执行，但补丁 B 最初未将其加入 API 桥接，导致外部 MCP 调用 `send_message` 时报 `runAgentHeadless is not a function`。

```bash
sed -i 's/getAgentSessionSDKMessages};/getAgentSessionSDKMessages,runAgentHeadless};/' main.cjs
```

**效果：** 补丁 B 导出的函数从 10 个扩展到 11 个。

#### 补丁 B3：listAgentWorkspaces 桥接（v0.10 新增）

`list_workspaces` 工具需要列出所有工作区，但 `listAgentWorkspaces` 未在补丁 B 中导出。

```bash
sed -i 's/listChannels,getChannelById,getAgentWorkspace/listChannels,getChannelById,getAgentWorkspace,listAgentWorkspaces/' main.cjs
```

**效果：** 补丁 B 导出的函数从 11 个扩展到 12 个。

#### 补丁 C：频道 + 模型元数据覆盖

**注入点：** `sendMessage()` 方法内，channel 解析处（`const channel = getChannelById(channelId);`）

```bash
# C1: channel lookup — 优先用元数据的 channelId
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' main.cjs

# C2: API key decrypt — 用覆盖后的 channelId（限制行范围 405686-405695）
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' main.cjs

# C3: autoGenerateTitle — 用覆盖后的 channelId
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' main.cjs

# C4: modelId — 优先用元数据的 modelId
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' main.cjs

# C5: SDK query model — 用 resolvedModel 而非 modelId
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' main.cjs
```

**效果：** 通过 MCP 工具创建的会话，API 请求走元数据中存储的正确频道和模型（后端层面）。结合补丁 D+E，UI 模型选择器也与元数据同步。

---

### 渲染器补丁

#### 补丁 D：Renderer 版本同步

**问题：** dev 版 renderer 停留在旧版本（如 0.12.1），与 main.cjs（0.12.23）版本不匹配，IPC 协议可能不一致。

**修复：** 每次正式版升级后，同步 renderer 文件：

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp -r /tmp/app/dist/renderer/* D:/Proma-dev/resources/app/dist/renderer/
```

#### 补丁 E：渲染器 hydration 幂等守卫移除

**文件：** `renderer/assets/index-*.js`（主 bundle，约 4.1MB）

**问题：** AgentView 的 hydration effect 在初始化模型 Map 时有幂等守卫 `if(qe.has(e))return qe`。当 metadata 有 modelId 但 Map 已被其他代码路径（如 auto-select first model）预先填充时，metadata 的 modelId 被跳过。

**修复：** 移除幂等守卫，让 hydration 始终用 metadata 更新：

```bash
sed -i 's/if(qe.has(e))return qe;//g' D:/Proma-dev/resources/app/dist/renderer/assets/index-*.js
```

**效果：** 打开 MCP 创建的会话时，UI 模型选择器自动显示正确的模型名称（与 metadata 同步）。

---

### 补丁 4：版本号校正

```bash
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json
```

**注意：** 正式版升级后需重新对齐。

---

## 六、插件文件：proma-dev-patches.cjs

放置位置：`D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs`

### MCP Server：`session`

提供 6 个 Agent 可调用的工具：

| 工具名 | 功能 | 只读 |
|---|---|---|
| `list_channels` | 列出所有 AI 渠道及可用模型 | ✅ |
| `list_workspaces` | 列出所有工作区（id/name/slug） | ✅ |
| `list_sessions` | 列出 Agent 会话（含工作区名、支持 workspace_id 过滤） | ✅ |
| `get_session_info` | 查询单个会话详情 | ✅ |
| `get_session_context` | 查询会话当前 token 用量（含上下文窗口/使用率） | ✅ |
| `list_messages` | 列出会话消息历史（UUID/角色/文本），支持 offset/limit 分页 | ✅ |
| `create_session` | 创建新会话，指定渠道/模型/标题/工作区 | ❌ |
| `fork_session` | Fork 已有会话，支持 up_to_message_uuid 精确截断 | ❌ |
| `send_message` | 向目标会话发消息，wait=true 返回 `reply` 字段（Agent 输出文本） | ❌ |

### 架构

```
main.cjs
  ├─ 补丁 A: MCP 钩子（检查 global.__proma_getMcpServers__）
  ├─ 补丁 B: API 桥接（global.__proma__）+ require 插件
  └─ proma-dev-patches.cjs
       ├─ 读取 global.__proma__ 调用主进程序 API
       ├─ 使用 sendMessage 传入的 sdk 创建 MCP server
       ├─ 注册到 global.__proma_getMcpServers__
       └─ 6 个会话管理工具
```

---

## 七、项目文件结构

```
d:\桌面\Agent 编程方法论实验-南大大一\
├── proma-source/                        # 开源源码（v0.12.23）
│   └── ...
├── proma-source-backup-20260615-170316/  # 原始源码备份
│
D:\
├── Proma/                                # 正式版（保持不动，v0.12.23）
└── Proma-dev/                            # 开发版
    ├── start-dev.bat                     # 启动脚本（→ Proma-white.exe）
    └── resources/
        ├── app.asar.disabled
        ├── app/                          # 解包代码
        │   ├── package.json              # 版本号已对齐
        │   └── dist/
        │       ├── main.cjs              # 已打 7 个 sed 补丁
        │       ├── preload.cjs           # 商业版原版
        │       ├── proma-dev-patches.cjs # ★ 插件文件
        │       └── renderer/             # 商业版原版（补丁 E）
        │           └── assets/
        │               └── index-*.js    # 主 bundle（hydrate 守卫已移除）
        └── app.asar.unpacked/
```

---

## 八、日常开发流程

1. 在开源源码中定位相关代码，理解逻辑
2. 设计 sed 补丁或插件代码
3. 从正式版提取最新 `main.cjs`，打全部补丁
4. 编写/更新 `proma-dev-patches.cjs`
5. 部署到 `D:\Proma-dev\resources\app\dist\`
6. 双击 `start-dev.bat` 启动验证
7. 验证通过后更新本 Wiki

---

## 九、正式版升级后的操作步骤

```bash
# 1. 提取新版 main.cjs
npx asar extract D:\Proma\resources\app.asar /tmp/new-app
cp /tmp/new-app/dist/main.cjs /tmp/main-patched.cjs

# 2. 重新打所有 sed 补丁（按第五节顺序）

# 3. 部署
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs

# 4. 同步 renderer 文件（补丁 D）
cp -r /tmp/new-app/dist/renderer/* D:/Proma-dev/resources/app/dist/renderer/

# 5. 重新打 renderer 补丁 E
sed -i 's/if(qe.has(e))return qe;//g' D:/Proma-dev/resources/app/dist/renderer/assets/index-*.js

# 6. 对齐版本号
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json

# 7. 重启验证
```

**原则：每次正式版升级后，重新从最新版提取 main.cjs + renderer 打补丁，不跨版本复用。**

---

## 十、已知问题

1. **cloud-auth token 共享冲突：** 两个版本共用 token，一方刷新后另一方失效。临时方案：重新同步 `cloud-auth.json`。

2. **渲染器无法从源码构建：** 含闭源组件，只能对 JS bundle 做字符串替换。

3. **Windows esbuild 构建：** 通过 Git Bash 会 segfault，需用 `node_modules/@esbuild/win32-x64/esbuild.exe`。

4. ~~**DeepSeek 频道会话 Fork 失败：** SDK 层 bug——会话的 `sdkSessionId` 存在 Proma 元数据中，但 SDK 内部找不到对应会话数据。~~ v0.7 渲染器补丁（D+E）后已修复。

5. **正式版升级后 renderer 版本漂移：** 补丁 D 解决，升级后需同步 renderer 文件。

---

## 十一、版本记录

| 日期 | 版本 | 改动 |
|---|---|---|
| 2026-06-16 | v0.8.1 | 修复 `get_session_context` 的 `context_window` 和 `usage_pct` 返回 null：modelUsage 的 key 是模型名（如 `glm-5-turbo`）不是 session metadata 的 modelId |
| 2026-06-15 | v0.8 | 新增 `get_session_context` 工具（查询会话 token 用量，支持多会话管理时的上下文甜点区控制）；补丁 B 扩展：`getAgentSessionSDKMessages` 加入 API 桥接 |
| 2026-06-15 | v0.7 | 修复 UI 模型同步：补丁 D（renderer 版本同步 0.12.1→0.12.23）+ 补丁 E（移除 hydration 幂等守卫）；MCP 创建的会话模型选择器自动显示正确模型 |
| 2026-06-16 | v0.10.1 | 新增 `get_my_session_id` 工具（Agent 自指）；10 工具体系；内部 Agent 间调用全链路验证（老板→小弟→子小弟三层，9/9 通过） |
| 2026-06-16 | v0.10 | P1 多工作区+消息列表+结果回传：补丁 B3（`listAgentWorkspaces` 12 函数导出）；新增 `list_workspaces` / `list_messages` 工具（共 9 工具）；`list_sessions` 加 workspace_id 过滤+workspace_name；`send_message` wait=true 返回 `reply` 字段含 Agent 实际输出；多轮对话+Fork at UUID 全链路验证；插件 696 行，MCP server 225 行 |
| 2026-06-16 | v0.9.1 | 补丁 B2：`runAgentHeadless` 加入 API 桥接；`get_session_context` 增强 fallback 从渠道配置查 `contextWindow` + billing_error 检测；DeepSeek Fork 验证通过（v0.7 渲染器修复后已可用）；插件更新至 569 行 |
| 2026-06-16 | v0.9 | 外部 MCP 服务：插件重构抽取 `createToolHandlers()`；新增 HTTP bridge（127.0.0.1:19876-19895 自动选端口）；新建 `proma-mcp-server.cjs`（零依赖 MCP JSON-RPC stdio 桥接，206 行）。外部 Claude Code / 脚本可通过 stdio 调用全部 7 个会话管理工具 |
| 2026-06-16 | v0.8.1 | 修复 `get_session_context` 的 `context_window` 和 `usage_pct` 返回 null：modelUsage 的 key 是模型名（如 `glm-5-turbo`）不是 session metadata 的 modelId |
| 2026-06-15 | v0.8 | 新增 `get_session_context` 工具（查询会话 token 用量，支持多会话管理时的上下文甜点区控制）；补丁 B 扩展：`getAgentSessionSDKMessages` 加入 API 桥接 |
| 2026-06-15 | v0.7 | 修复 UI 模型同步：补丁 D（renderer 版本同步 0.12.1→0.12.23）+ 补丁 E（移除 hydration 幂等守卫）；MCP 创建的会话模型选择器自动显示正确模型 |
| 2026-06-15 | v0.6 | 方案 A 完成：插件化 MCP 工具系统，5 个会话管理工具（list_channels/sessions、create/fork/get_session_info）；补丁 A/B/C；频道+模型元数据覆盖；验证 esbuild 源构建不可行 |
| 2026-06-15 | v0.5 | 重构 dev 版：基于正式版 0.12.23 重新提取 main.cjs，sed 打补丁 1/2/3/4；废弃源构建方案（缺 cloudAuth 模块） |
| 2026-06-15 | v0.4 | 源码从 v0.10.28 rebase 到 v0.12.23；新增源码备份；明确"源码≠运行版本"关系 |
| 2026-06-15 | v0.3 | 新增 Dev发行版；渐变色图标；三版架构确立 |
| 2026-06-15 | v0.2 | 开发版更换白色应用图标；托盘图标修复 |
| 2026-06-15 | v0.1 | 初始创建开发版；补丁1（deepseek-v4-pro）+ 补丁2（PROMA_DEV userData隔离）；双开支持 |

---

## 十二、插件化改造体系：Agent 会话管理能力

### 12.1 核心设计思想

**命题**：如何在不重编译商业版 `main.cjs` 的前提下，给 Agent 增加任意新能力？

**答案**：插件模式。商业版 `main.cjs` 只注入一个 `require("./proma-dev-patches.cjs")`，所有新能力写入独立插件文件。

```
main.cjs (sed 注入 3 处，其余不动)
  ├─ 补丁 A: sendMessage() 中插入 MCP 钩子（检查 global.__proma_getMcpServers__）
  ├─ 补丁 B: init_index() 后导出核心函数到 global.__proma__，并 require 插件
  ├─ 补丁 C: sendMessage() 中优先使用 metadata.modelId
  └─ proma-dev-patches.cjs (独立文件，TypeScript 级别的复杂度，随便写)
```

### 12.2 插件能力总览

插件通过 SDK 的 `sdk.createSdkMcpServer()` 创建一个名为 `session` 的进程内 MCP Server，包含 6 个工具：

| 工具 | 类型 | 功能 |
|---|---|---|
| `list_channels` | 只读 | 列出所有 AI 渠道及 Agent 可用模型 |
| `list_sessions` | 只读 | 列出所有 Agent 会话（标题/渠道/模型/归档状态） |
| `get_session_info` | 只读 | 查询单个会话详情（渠道、模型、工作区） |
| `create_session` | 写入 | 创建新会话，指定渠道/模型/标题/工作区 |
| `fork_session` | 写入 | Fork 已有会话，保留上下文，可切换渠道/模型 |
| `send_message` | 写入 | 向目标会话发送消息，支持三种执行模式 |

### 12.3 send_message 三种执行模式

```
┌──────────────────────────────────────────────────────────┐
│                    send_message                          │
│                                                         │
│  wait=true (默认)    wait=false + notify     纯 fire-   │
│  同步等待            异步回调通知             and-forget │
│                                                         │
│  调用──────返回      调用──→返回             调用──→返回  │
│   ████████████       ██                        ██       │
│  (阻塞等完成)        │ onComplete             (无回调)   │
│                      ↓ runAgentHeadless                 │
│                     源会话收到通知                        │
│                                                         │
│  适用: 短任务        适用: 并行多任务        适用: 不关心  │
│       需要即时结果         需要异步通知            结果    │
└──────────────────────────────────────────────────────────┘
```

**异步回调模式的完整流程**：

1. 源 Agent 调用 `send_message(target, msg, notify=true)`
2. MCP 工具 handler 调用 `runAgentHeadless(目标)` 并在 `onComplete` 中注册回调
3. MCP 立即返回 `{ status: "started" }`，源会话不阻塞，Agent 可以继续处理其他任务
4. 目标会话在后台 headless 执行（`permissionModeOverride: "bypassPermissions"`）
5. 目标完成 → `onComplete` 回调触发
6. 回调内调用 `runAgentHeadless(源会话, "[系统通知] 目标已完成")`
7. 源 Agent 收到通知消息 → 处理 → 告知用户

**关键技术点**：源会话 ID 通过 MCP Server 创建时的闭包捕获（`createSessionMcpServer(sdk, z, sourceSessionId)`），无需额外的 IPC 通道。

### 12.4 多会话并行调度模型

源会话作为"调度中心"，异步分派任务给多个目标会话：

```
源 Agent
  ├─ send_message(A, notify) → 立即返回
  ├─ send_message(B, notify) → 立即返回
  ├─ send_message(C, notify) → 立即返回
  └─ 回复用户: "三个任务已启动"
源会话空闲
  │
  ├─ B 完成 → 回调通知源 → Agent 处理
  ├─ A 完成 → 回调通知源 → Agent 处理
  └─ C 完成 → 回调通知源 → Agent 处理
```

**限制与注意事项**：
- 源会话正在处理用户消息时，通知消息会排队等待当前轮结束
- 大量并发目标会话时注意 API 配额消耗（每个目标会话一个 Agent 进程）
- `runAgentHeadless` 有并发守卫，同一会话同时只能有一个 run

### 12.5 完整补丁清单

| 补丁 | 位置 | sed 操作 | 功能 |
|---|---|---|---|
| 补丁 1 | `agent-model-routing` | 字符串替换 | `deepseek-v4-flash` → `deepseek-v4-pro` |
| 补丁 2 | `index.ts` ×4 | 正则替换 | `PROMA_DEV=1` 触发 userData 隔离 |
| 补丁 3 | `tray.ts` | 字符串替换 | 托盘图标 → `proma-white.png` |
| 补丁 4 | `package.json` | 字符串替换 | 版本号 0.12.1 → 0.12.23（防升级提示） |
| 补丁 A | `sendMessage()` | 在 `const dynamicCtx` 前插入 | MCP 钩子：检查 `global.__proma_getMcpServers__` |
| 补丁 B | `init_index()` 后 | 替换该行 | API 桥接 + `require` 插件 |
| 补丁 C | `sendMessage()` | 替换该行 | `metadata.modelId` 优先于 UI 传入的 modelId |

### 12.6 模型指定策略

**问题**：MCP `create_session` 将 modelId 存入 `AgentSessionMeta`，但 UI 渲染器不读这个字段。用户打开会话时，UI 显示的是全局默认模型。

**解决方案（补丁 C）**：在 `sendMessage()` 的模型解析处插入元数据优先逻辑：

```javascript
// 原代码
let resolvedModel = modelId || DEFAULT_MODEL_ID;

// 补丁后
const __sessionMeta = getAgentSessionMeta(sessionId);
let resolvedModel = __sessionMeta?.modelId || modelId || DEFAULT_MODEL_ID;
```

**效果**：无论 UI 显示什么模型名，实际 API 调用使用元数据中存储的模型。UI 模型选择器可能显示旧值，但功能正确。

### 12.7 部署文件结构

```
D:\Proma-dev\resources\app\dist\
├── main.cjs                    # 商业版 0.12.23 + 7 个 sed 补丁
├── proma-dev-patches.cjs       # 插件文件（~350 行，含 6 个 MCP 工具）
└── renderer/                   # 保持商业版原版不动
    └── assets/
        └── index-DHbUm1xm.js
```

### 12.8 后续方向

- **模型 UI 同步**：修正渲染器 `AgentSessionMeta.modelId` 读取，消除 UI 与实际不一致
- **多模型协作链**：A 完成 → 通知 B 继续 → B 完成 → 通知 C
- **会话模板**：`create_session` 支持从模板复制上下文
- **成果聚合**：源会话定期检查目标会话输出，自动汇总
- **会话池管理**：预创建一批不同模型的会话，按需分配任务

---

## 十三、外部 MCP 服务（v0.9）

### 13.1 概述

将 7 个会话管理工具暴露为独立 stdio MCP server，让外部工具（Claude Code、脚本等）也能调用。分为两层：

```
外部工具 (Claude Code / 脚本)
    │ stdio (MCP JSON-RPC)
    ▼
proma-mcp-server.cjs          ← 独立进程，零外部依赖（206 行）
    │ HTTP POST /:tool_name
    ▼
proma-dev-patches.cjs         ← Electron 主进程内 localhost HTTP bridge
  createExternalHttpBridge()
```

### 13.2 架构设计

| 组件 | 文件 | 位置 | 说明 |
|---|---|---|---|
| HTTP Bridge | `proma-dev-patches.cjs` | `app/dist/` | `createExternalHttpBridge()`，启动 localhost HTTP server |
| MCP stdio 桥接 | `proma-mcp-server.cjs` | `app/dist/` | MCP JSON-RPC over stdio → HTTP 转发 |

### 13.3 HTTP Bridge

- **端口范围**：19876-19895（20 个连续端口），启动时自动选择第一个空闲端口
- **监听地址**：`127.0.0.1`（仅 loopback，外部网络不可达）
- **端口文件**：`~/.proma-dev/mcp-bridge-port.json`（`{ "port": 19876 }`）
- **协议**：`POST /:tool_name`，body 为 JSON arguments，返回 JSON result
- **CORS**：允许任意来源（`Access-Control-Allow-Origin: *`）
- **Handler 共享**：与内部 MCP server 共用 `createToolHandlers(null)`（`null` = 无源会话）
- **`send_message` 限制**：外部调用 `notify=true` 返回明确错误（无源会话无法接收通知）

### 13.4 MCP stdio 桥接

- **零外部依赖**：纯 Node.js 内置模块（`http`, `fs`, `path`, `os`, `readline`）
- **协议**：手动实现 MCP JSON-RPC over stdio（`initialize`, `tools/list`, `tools/call`）
- **端口发现**：启动时读 `~/.proma-dev/mcp-bridge-port.json`，未找到则用默认 19876
- **超时**：`send_message(wait=true)` 请求超时 10 分钟（适应长任务）
- **错误信息**：stderr 输出启动信息，stdout 专用于 MCP 协议

### 13.5 Claude Code 配置

```json
{
  "mcpServers": {
    "proma-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs"]
    }
  }
}
```

放在 `%USERPROFILE%/.claude/claude_desktop_config.json` 或项目 `.claude/mcp.json`。

### 13.6 插件重构（v0.9）

- **抽取 `createToolHandlers(sourceSessionId)`**：7 个纯 handler 函数，内部 MCP server 和 HTTP bridge 共享
- **`createSessionMcpServer(sdk, z, sourceSessionId)`**：仅负责用 `sdk.tool()` 包装 handler
- **`createExternalHttpBridge()`**：在插件末尾自动启动
- **备份更新**：`workspace-files/.context/proma-dev-patches.cjs` 已同步到 546 行
- **新增备份**：`workspace-files/.context/proma-mcp-server.cjs`（206 行）

### 13.7 验证

```bash
# 语法检查
node -c D:/Proma-dev/resources/app/dist/proma-mcp-server.cjs

# 集成测试（mock HTTP bridge + MCP server 子进程）
# initialize → tools/list (7 工具) → tools/call → 3/3 响应正确
```

### 13.8 已知限制

- Proma 不运行时，外部 MCP server 连接失败（HTTP bridge 不存在）
- `send_message` 外部调用不支持 `notify=true`
- `send_message(wait=true)` 只返回 `{ status: "completed" }`，不含 Agent 输出内容（待 P1）
- 端口范围硬编码在插件中，不通过配置文件
