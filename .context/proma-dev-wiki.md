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

**效果：** 导出主进程 API 到 `global.__proma__`，加载插件文件。

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

**效果：** 通过 MCP 工具创建的会话，即使 UI 选择器显示旧模型，实际 API 请求也会走元数据中存储的正确频道和模型。

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

提供 5 个 Agent 可调用的工具：

| 工具名 | 功能 | 只读 |
|---|---|---|
| `list_channels` | 列出所有 AI 渠道及可用模型 | ✅ |
| `list_sessions` | 列出 Agent 会话（含标题/渠道/模型/归档） | ✅ |
| `get_session_info` | 查询单个会话详情 | ✅ |
| `create_session` | 创建新会话，指定渠道/模型/标题/工作区 | ❌ |
| `fork_session` | Fork 已有会话，支持切换渠道和模型 | ❌ |

### 架构

```
main.cjs
  ├─ 补丁 A: MCP 钩子（检查 global.__proma_getMcpServers__）
  ├─ 补丁 B: API 桥接（global.__proma__）+ require 插件
  └─ proma-dev-patches.cjs
       ├─ 读取 global.__proma__ 调用主进程序 API
       ├─ 使用 sendMessage 传入的 sdk 创建 MCP server
       ├─ 注册到 global.__proma_getMcpServers__
       └─ 5 个会话管理工具
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
        │       └── renderer/             # 商业版原版
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

# 4. 对齐版本号
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json

# 5. 重启验证
```

**原则：每次正式版升级后，重新从最新版提取 main.cjs 打补丁，不跨版本复用。**

---

## 十、已知问题

1. **cloud-auth token 共享冲突：** 两个版本共用 token，一方刷新后另一方失效。临时方案：重新同步 `cloud-auth.json`。

2. **渲染器无法从源码构建：** 含闭源组件，只能对 JS bundle 做字符串替换。

3. **Windows esbuild 构建：** 通过 Git Bash 会 segfault，需用 `node_modules/@esbuild/win32-x64/esbuild.exe`。

4. **DeepSeek 频道会话 Fork 失败：** SDK 层 bug——会话的 `sdkSessionId` 存在 Proma 元数据中，但 SDK 内部找不到对应会话数据。非 DeepSeek 频道 Fork 正常。

5. **UI 模型选择器不反映 MCP 创建的会话模型：** 补丁 C 已覆盖后端，实际 API 请求走正确频道/模型，但 UI 选择器显示可能是旧值。手动切换一次即可同步。

---

## 十一、版本记录

| 日期 | 版本 | 改动 |
|---|---|---|
| 2026-06-15 | v0.6 | 方案 A 完成：插件化 MCP 工具系统，5 个会话管理工具（list_channels/sessions、create/fork/get_session_info）；补丁 A/B/C；频道+模型元数据覆盖；验证 esbuild 源构建不可行 |
| 2026-06-15 | v0.5 | 重构 dev 版：基于正式版 0.12.23 重新提取 main.cjs，sed 打补丁 1/2/3/4；废弃源构建方案（缺 cloudAuth 模块） |
| 2026-06-15 | v0.4 | 源码从 v0.10.28 rebase 到 v0.12.23；新增源码备份；明确"源码≠运行版本"关系 |
| 2026-06-15 | v0.3 | 新增 Dev发行版；渐变色图标；三版架构确立 |
| 2026-06-15 | v0.2 | 开发版更换白色应用图标；托盘图标修复 |
| 2026-06-15 | v0.1 | 初始创建开发版；补丁1（deepseek-v4-pro）+ 补丁2（PROMA_DEV userData隔离）；双开支持 |
