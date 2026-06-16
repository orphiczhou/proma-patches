# Proma 定制补丁集

> 基于 Proma 商业版 v0.12.23，通过 sed 补丁 + 插件文件增强 Agent 能力。
> 适用于 **Proma 0.12.x 系列**，其他版本需验证注入点。
> **给人看也给 Agent 看 — Agent 读完后能交互式帮用户安装。**

---

## 给 Agent 读的（先看这里）

如果用户让你"给 Proma 打补丁"或"安装 Proma 增强功能"，请按以下流程操作：

### 第一步：确认环境

询问用户:
1. Proma 正式版安装路径（默认 `D:\Proma`）
2. 选择哪种部署方式（见第二步）

### 第二步：让用户选基础模块（三选一）

| 模块 | 适用场景 | 与正式版关系 | 需重新登录？ |
|---|---|---|---|
| **A. 双开开发版** | 开发调试，两者同时用 | 隔离，`~/.proma-dev/` 独立 | ✅ 需同步登录态 |
| **B. Release 并行版** | 日常替代使用，不双开 | 共享 `~/.proma/`，互斥运行 | ❌ 不需要 |
| **C. 直接改正式版** | 不想维护多份副本 | 直接修改原版 | ❌ 不需要（不推荐） |

> **推荐：** 日常用选 B，开发调试选 A。

### 第三步：让用户选增强模块（可选）

| 模块 | 功能 | 
|---|---|
| **1. DeepSeek 子Agent 升级** | 子Agent `flash` → `pro` |
| **2. 会话管理 MCP 工具** | 10 个 session 工具（创建/查询/Fork/发消息/上下文） |
| **3. 频道+模型元数据覆盖** | MCP 创建的会话后端自动走正确模型 |
| **4. UI 模型同步** | 模型选择器自动显示正确模型名 |
| **5. 外部 MCP 服务** | 跨实例调用（任何 MCP 客户端可操控 Proma 会话） |
| **6. Windows 托盘图标** | 替换为白色图标 |

**推荐组合：**
- 只想强子Agent → 1
- Agent 管理多会话 → 2+3+4
- 外部操控 Proma → 2+3+5
- 全都要 → B+2+3+4+5+6（1 已含）

### 第四步：执行安装

按所选模块逐一执行（见下方详细步骤）。

### 第五步：验证

安装完成后告知验证方法。

---

## 前置：提取商业版 main.cjs

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/proma-app
cp /tmp/proma-app/dist/main.cjs /tmp/main-patched.cjs
```

---

## 模块 A：双开开发版（D:\Proma-dev）

独立数据目录，可与正式版同时运行。基于商业版拷贝。

```bash
# === 1. 复制正式版 ===
cp -r D:/Proma D:/Proma-dev

# === 2. 解包 ASAR ===
cd D:/Proma-dev/resources
npx asar extract app.asar app
mv app.asar app.asar.disabled

# === 3. 合并原生模块（关键！ASAR 解包后缺少） ===
cp -r app.asar.unpacked/node_modules/* app/node_modules/

# === 4. 创建启动脚本 ===
cat > D:/Proma-dev/start-dev.bat << 'BAT'
@echo off
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma-white.exe"
BAT

# === 5a. 同步认证配置 ===
cp ~/.proma/cloud-auth.json ~/.proma-dev/
cp ~/.proma/channels.json ~/.proma-dev/
cp ~/.proma/user-profile.json ~/.proma-dev/

# === 5b. 同步 Electron 会话数据（关键！跳过需重新登录 Google OAuth） ===
# 正式版运行时 Session Storage/LOCK 被锁，需先关正式版再执行：
cp -r "$APPDATA/@proma/electron/Network" "$APPDATA/@proma/electron-dev/"
cp -r "$APPDATA/@proma/electron/Session Storage" "$APPDATA/@proma/electron-dev/"
cp -r "$APPDATA/@proma/electron/Local Storage" "$APPDATA/@proma/electron-dev/"

# === 6. PROMA_DEV 隔离补丁 ===
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_DEV === "1") {/g' /tmp/main-patched.cjs

# === 7. 对齐版本号（防升级提示） ===
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json
```

> **注意：** 5b 步必须先关正式版再执行。如果 LOCK 文件被锁，重启电脑后执行，或单独登录 dev 版 Google OAuth。

---

## 模块 B：Release 并行版（D:\Proma-release）

**共享正式版数据**（`~/.proma/`），不需要重新登录。与正式版互斥运行（关一个开另一个）。

```bash
# === 1. 复制正式版 ===
cp -r D:/Proma D:/Proma-release

# === 2. 提取 main.cjs（asar 不解包） ===
npx asar extract D:/Proma-release/resources/app.asar /tmp/release-app
cp /tmp/release-app/dist/main.cjs /tmp/main-patched.cjs

# === 3. 打补丁（在 /tmp/main-patched.cjs 上打全部需要的补丁） ===
# 注意：不需要 PROMA_DEV 补丁（共享数据无需隔离）

# === 4. 替换 asar 中的 main.cjs ===
cp /tmp/main-patched.cjs /tmp/release-app/dist/main.cjs
cd /tmp/release-app
npx asar pack . D:/Proma-release/resources/app.asar

# === 5. 创建启动脚本 ===
cat > D:/Proma-release/start-release.bat << 'BAT'
@echo off
start "" "D:\Proma-release\Proma.exe"
BAT

# === 6. 对齐版本号 ===
# 提取 package.json → 改版本 → 重新打包到 asar
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-release/resources/app.asar
```

> **优势：** 共享 `~/.proma/` 和 `@proma/electron/`，所有登录态、渠道配置、会话历史与正式版完全一致。**关闭正式版 → 双击 start-release.bat → 无缝切换。**

---

## 模块 C：直接改正式版（不推荐）

```bash
# 备份
cp D:/Proma/resources/app.asar D:/Proma/resources/app.asar.bak

# 提取 → 打补丁 → 打包回
npx asar extract D:/Proma/resources/app.asar /tmp/direct-app
# ... 在 /tmp/direct-app/dist/main.cjs 上打补丁 ...
npx asar pack /tmp/direct-app D:/Proma/resources/app.asar
```

> **风险：** 正式版自动升级会覆盖补丁，每次升级需重新操作。

---

## 增强模块

### 模块 1：DeepSeek 子Agent 升级 → V4 Pro

```bash
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' /tmp/main-patched.cjs
```

### 模块 2：会话管理 MCP 工具（10 个）

#### 补丁 A — MCP 钩子
```bash
sed -i 's|          const dynamicCtx = buildDynamicContext({|if(typeof global.__proma_getMcpServers__==="function"){const __h=global.__proma_getMcpServers__(sessionId,workspaceSlug,sdk);if(__h)Object.assign(mcpServers,__h);}\n          const dynamicCtx = buildDynamicContext({|' /tmp/main-patched.cjs
```

#### 补丁 B — API 桥接 + 加载插件
```bash
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace,getAgentSessionSDKMessages,runAgentHeadless,listAgentWorkspaces};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' /tmp/main-patched.cjs
```

#### 部署插件文件
从本仓库下载 `proma-dev-patches.cjs`，放到 `[安装目录]/resources/app/dist/proma-dev-patches.cjs`

### 模块 3：频道+模型元数据覆盖

```bash
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' /tmp/main-patched.cjs
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' /tmp/main-patched.cjs
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' /tmp/main-patched.cjs
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' /tmp/main-patched.cjs
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' /tmp/main-patched.cjs
```

> C2/C3 行范围可能随版本微调。若失败，搜索 `decryptApiKey(channelId)` 和 `autoGenerateTitle(sessionId` 定位实际行号。

### 模块 4：UI 模型同步

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp -r /tmp/app/dist/renderer/* [安装目录]/resources/app/dist/renderer/
sed -i 's/if(qe.has(e))return qe;//g' [安装目录]/resources/app/dist/renderer/assets/index-*.js
```

### 模块 5：外部 MCP 服务（跨实例）

插件内置 HTTP bridge（Proma 启动时自动在 127.0.0.1:19876-19895 启动）。

配合 `proma-mcp-server.cjs`（从本仓库下载），在 Claude Code 中配置：

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

### 模块 6：Windows 托盘/任务栏图标

#### 6a. 托盘图标（运行时显示）
```bash
sed -i 's/"iconTemplate.png"/"proma-white.png"/g' /tmp/main-patched.cjs
```

#### 6b. 任务栏图标（Proma-white.exe）
Windows 任务栏图标嵌入在 EXE 资源中，需替换：

```bash
# 1. 安装工具（首次）
npm install -g png-to-ico rcedit

# 2. PNG → ICO
png-to-ico D:/Proma-dev/resources/proma-logos/proma-white.png > /tmp/proma-white.ico

# 3. 嵌入 EXE（关掉 Proma-dev 后执行）
cp D:/Proma-dev/Proma.exe D:/Proma-dev/Proma-white.exe
rcedit D:/Proma-dev/Proma-white.exe --set-icon /tmp/proma-white.ico

# 4. start-dev.bat 指向 Proma-white.exe
```

> **注意：** EXE 运行时被锁，需先关进程再改。改完用新文件名 `Proma-white.exe`，保留原 `Proma.exe` 不动。

---

## 最终部署

### 开发版（模块 A）
```bash
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs
cp proma-mcp-server.cjs D:/Proma-dev/resources/app/dist/proma-mcp-server.cjs
# 启动: 双击 D:\Proma-dev\start-dev.bat
```

### Release 版（模块 B）
```bash
# main.cjs 已在打包 asar 时放入
# 启动: 双击 D:\Proma-release\start-release.bat
```

---

## 补丁速查

| 补丁 | 作用 | 适用 A/B |
|---|---|---|
| PROMA_DEV | userData 隔离 | 仅 A |
| 1 | DeepSeek 子Agent v4-pro | 通用 |
| A+B | MCP 钩子+API 桥接 | 通用 |
| C1-5 | 频道+模型覆盖 | 通用 |
| D+E | Renderer 同步+幂等守卫 | 通用 |
| 6 | 托盘+任务栏图标 | 通用 |
| 版本号 | package.json 对齐 | 通用 |

---

## 许可证

补丁命令和插件代码为独立作品，基于对 Proma（AGPL-3.0）运行时环境的互操作。按 MIT 许可发布。
