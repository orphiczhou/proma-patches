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
2. 是否需要双开开发版（推荐，不影响原版）

### 第二步：列出可选模块，让用户勾选

**基础模块（必须装一个）**

| 模块 | 功能 |
|---|---|
| **A. 双开开发版** | 解包 ASAR + 创建 `D:\Proma-dev\`，与正式版隔离 |
| **B. 直接改正式版** | 在 `D:\Proma\` 上直接打补丁（不推荐：升级后丢失） |

**增强模块（可选，按需勾选）**

| 模块 | 功能 | 互操作方式 |
|---|---|---|
| **1. DeepSeek 子Agent 升级** | 子Agent 模型 `flash` → `pro` | 内部（自动） |
| **2. 会话管理 MCP 工具** | 10 个 session 工具 | 内部（Agent 内调用） |
| **3. 频道+模型元数据覆盖** | 后端自动走正确频道模型 | 内部（自动生效） |
| **4. UI 模型同步** | 模型选择器自动同步 | 内部（自动） |
| **5. 外部 MCP 服务** | stdio MCP server | **跨实例**（任何 MCP 客户端） |
| **6. 托盘图标替换** | 白色图标 | 仅外观 |

**推荐组合：**
- 只是想让子 Agent 更强 → 选 1
- 想让 Agent 能管理多个会话 → 选 2+3+4
- 想从外部脚本/工具操控 Proma 会话 → 选 2+3+5
- 全都要 → 选 A+2+3+4+5（1 已包含）

### 第三步：执行安装

根据用户选择的模块，按下面详细步骤逐一执行。

### 第四步：验证

安装完成后，告知用户如何验证每个模块。

---

## 前置步骤：提取商业版文件

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/proma-app
cp /tmp/proma-app/dist/main.cjs /tmp/main-patched.cjs
```

所有后续补丁基于 `/tmp/main-patched.cjs`。

---

## 模块 A：双开开发版

```bash
# 1. 复制正式版
cp -r D:/Proma D:/Proma-dev

# 2. 解包 ASAR
cd D:/Proma-dev/resources
npx asar extract app.asar app
mv app.asar app.asar.disabled

# 3. 合并原生模块
cp -r app.asar.unpacked/node_modules/* app/node_modules/

# 4. 创建启动脚本
cat > D:/Proma-dev/start-dev.bat << 'BAT'
@echo off
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma-white.exe"
BAT

# 5. 同步认证
cp ~/.proma/cloud-auth.json ~/.proma-dev/
cp ~/.proma/channels.json ~/.proma-dev/
cp ~/.proma/user-profile.json ~/.proma-dev/

# 6. PROMA_DEV 补丁
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_DEV === "1") {/g' /tmp/main-patched.cjs

# 7. 对齐版本号
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json
```

---

## 模块 1：DeepSeek 子Agent 升级

```bash
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' /tmp/main-patched.cjs
```

**验证：** 开 DeepSeek Agent 会话，委派 explorer，检查子Agent 模型。

---

## 模块 2：会话管理 MCP 工具（内部）

### 补丁 A — MCP 钩子

```bash
sed -i 's|          const dynamicCtx = buildDynamicContext({|if(typeof global.__proma_getMcpServers__==="function"){const __h=global.__proma_getMcpServers__(sessionId,workspaceSlug,sdk);if(__h)Object.assign(mcpServers,__h);}\n          const dynamicCtx = buildDynamicContext({|' /tmp/main-patched.cjs
```

### 补丁 B — API 桥接 + 加载插件

```bash
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace,getAgentSessionSDKMessages,runAgentHeadless,listAgentWorkspaces};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' /tmp/main-patched.cjs
```

### 部署插件文件

从本仓库复制 `proma-dev-patches.cjs` 到 `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`

**验证：** 开 Agent 会话，输入"用 session 的 list_channels 列出所有渠道"。

---

## 模块 3：频道+模型元数据覆盖

```bash
# C1: channel lookup 覆盖
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' /tmp/main-patched.cjs

# C2: API Key 解密覆盖（行范围需根据版本微调）
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' /tmp/main-patched.cjs

# C3: autoGenerateTitle 覆盖
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' /tmp/main-patched.cjs

# C4: modelId 解析覆盖
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' /tmp/main-patched.cjs

# C5: SDK query model 覆盖
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' /tmp/main-patched.cjs
```

> **注意：** C2 和 C3 的行范围可能随 Proma 版本变化。如果 sed 失败，在 `main.cjs` 中搜索 `decryptApiKey(channelId)` 和 `autoGenerateTitle(sessionId` 定位实际行号。

**验证：** 用 MCP `create_session` 创建 DeepSeek 会话，打开后发消息问 Agent "你是什么模型"。

---

## 模块 4：UI 模型同步

```bash
# 同步 renderer 文件
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp -r /tmp/app/dist/renderer/* D:/Proma-dev/resources/app/dist/renderer/

# 移除 hydration 幂等守卫
sed -i 's/if(qe.has(e))return qe;//g' D:/Proma-dev/resources/app/dist/renderer/assets/index-*.js
```

**验证：** 打开 MCP 创建的会话，看 UI 模型选择器是否显示正确模型。

---

## 模块 5：外部 MCP 服务（跨实例）

插件内置了 HTTP bridge（Proma 启动时自动在 127.0.0.1:19876-19895 启动）。

配合 `proma-mcp-server.cjs` 使用：

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

---

## 模块 6：白色托盘图标

```bash
sed -i 's/"iconTemplate.png"/"proma-white.png"/g' /tmp/main-patched.cjs
```

---

## 最终部署

打完所有选中的补丁后：

```bash
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs
cp proma-mcp-server.cjs D:/Proma-dev/resources/app/dist/proma-mcp-server.cjs
# 重启: 双击 D:/Proma-dev/start-dev.bat
```

---

## 补丁速查

| 补丁 | 作用 | 依赖 |
|---|---|---|
| A | PROMA_DEV 隔离（双开基础） | 无 |
| 1 | DeepSeek 子Agent → v4-pro | 无 |
| 2 (A+B) | MCP 会话工具（10个，内部） | A |
| 3 (C1-5) | 频道+模型元数据覆盖 | 2 |
| 4 (D+E) | UI 模型同步 | 3 |
| 5 | 外部 MCP 服务（跨实例） | 2 |
| 6 | 白色托盘图标 | A |

---

## 许可证

本仓库的补丁命令和插件代码为独立作品，基于对 Proma（AGPL-3.0）运行时环境的互操作。补丁本身按 MIT 许可发布，可自由使用和修改。