# Proma 定制补丁集

> 基于 Proma 商业版 v0.12.23，通过 sed 补丁 + 插件文件增强 Agent 能力。
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
| **A. 双开开发版** | 开发调试，两者同时用 | 隔离，`~/.proma-dev/` 独立 | 需同步登录态 |
| **B. Release 并行版** | 日常替代使用 | 共享 `~/.proma/`，互斥运行 | 不需要 |
| **C. 直接改正式版** | 不想维护多份副本 | 直接修改原版 | 不需要（不推荐） |

> 推荐：日常用选 B，开发调试选 A。

### 第三步：让用户选增强模块

| 模块 | 功能 | 
|---|---|
| **1. DeepSeek 子Agent 升级** | 子Agent `flash` → `pro` |
| **2. 会话管理 MCP 工具** | 10 个 session 工具（创建/查询/Fork/发消息/上下文） |
| **3. 频道+模型元数据覆盖** | MCP 创建会话后端自动走正确模型 |
| **4. UI 模型同步** | 模型选择器自动显示正确模型名 |
| **5. 外部 MCP 服务** | 跨实例调用（任何 MCP 客户端可操控 Proma 会话） |
| **6. Windows 托盘图标** | 替换为白色图标 |

推荐组合：只想强子Agent→1 / Agent管理多会话→2+3+4 / 外部操控Proma→2+3+5 / 全都要→2+3+4+5（1已含）

### 第四步：执行安装

方式一：运行 `bash apply-patches.sh` 一键安装。
方式二：按所选模块手动执行下方命令。

### 第五步：验证

安装后验证：双击 `start-dev.bat` 启动 → 开 Agent 会话 → 说"用 list_channels 列出可用渠道"。

---

## 前置：提取商业版 main.cjs

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/proma-app
cp /tmp/proma-app/dist/main.cjs /tmp/main-patched.cjs
```

---

## 模块 A：双开开发版

独立数据目录（`~/.proma-dev/`），可与正式版同时运行。

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
```

### 模块 A-续：同步认证和会话数据（关键！）

**这一步是 Agent 最容易失败的地方。请仔细执行。**

#### A5a. 同步 Proma 配置文件（始终可执行）

```bash
mkdir -p ~/.proma-dev
cp ~/.proma/cloud-auth.json ~/.proma-dev/ 2>/dev/null \
  || echo "[SKIP] cloud-auth.json 不存在，dev 版需重新登录 Google"
cp ~/.proma/channels.json ~/.proma-dev/ 2>/dev/null \
  || echo "[SKIP] channels.json 不存在，dev 版需重新配渠道"
cp ~/.proma/user-profile.json ~/.proma-dev/ 2>/dev/null \
  || echo "[SKIP] user-profile.json 不存在，不影响使用"
```

#### A5b. 同步 Electron session 数据（必须先关正式版！）

**正式版运行时文件被锁定，必须先关闭正式版，否则此步一定失败。**

路径说明：
- `%APPDATA%` = `C:\Users\<你的用户名>\AppData\Roaming`
- `@proma/electron/` = 正式版数据
- `@proma/electron-dev/` = dev 版数据（PROMA_DEV=1 时启用）

```bash
echo "正在同步 Electron session 数据（正式版必须已关闭！）..."

echo "  [1/3] Network (cookies, Google OAuth tokens)..."
cp -r "$APPDATA/@proma/electron/Network" "$APPDATA/@proma/electron-dev/" 2>/dev/null \
  && echo "    ✅ OK" || echo "    ❌ FAIL — 正式版可能未关，关闭后重试"

echo "  [2/3] Session Storage..."
cp -r "$APPDATA/@proma/electron/Session Storage" "$APPDATA/@proma/electron-dev/" 2>/dev/null \
  && echo "    ✅ OK" || echo "    ❌ FAIL"

echo "  [3/3] Local Storage..."
cp -r "$APPDATA/@proma/electron/Local Storage" "$APPDATA/@proma/electron-dev/" 2>/dev/null \
  && echo "    ✅ OK" || echo "    ❌ FAIL"
```

#### A5c. 验证

```bash
echo "=== 数据同步验证 ==="
ls ~/.proma-dev/cloud-auth.json >/dev/null 2>&1 && echo "  ✅ cloud-auth.json" || echo "  ⚠️  缺失"
ls ~/.proma-dev/channels.json >/dev/null 2>&1 && echo "  ✅ channels.json" || echo "  ⚠️  缺失"
ls "$APPDATA/@proma/electron-dev/Network" >/dev/null 2>&1 && echo "  ✅ Network (免登录)" || echo "  ⚠️  Network 缺失（需在 dev 版手动登录 OAuth）"
ls "$APPDATA/@proma/electron-dev/Local Storage" >/dev/null 2>&1 && echo "  ✅ Local Storage" || echo "  ⚠️  Local Storage 缺失"
```

#### Agent 常见失败速查

| 错误 | 原因 | 修复 |
|---|---|---|
| `cp: cannot stat .../Network` | `$APPDATA` 没展开 | 用 `echo $APPDATA` 确认，或用绝对路径替换 |
| `cp: Permission denied` | 正式版未关，文件被锁 | 关正式版 → 任务管理器确认无 Proma.exe → 重试 |
| dev 版启动后要求重新登录 | Network 目录没复制成功 | **不是大问题**——手动登录一次 Google OAuth 即可，不影响补丁功能 |
| `~/.proma-dev/` 目录不存在 | 没执行 mkdir | 先执行 `mkdir -p ~/.proma-dev` |

---

## 模块 B：Release 并行版

共享正式版数据（`~/.proma/`），无需重新登录。与正式版互斥。

```bash
cp -r D:/Proma D:/Proma-release
npx asar extract D:/Proma-release/resources/app.asar /tmp/release-app
cp /tmp/release-app/dist/main.cjs /tmp/main-patched.cjs
# ... 在 /tmp/main-patched.cjs 上打补丁 ...
cp /tmp/main-patched.cjs /tmp/release-app/dist/main.cjs
cd /tmp/release-app && npx asar pack . D:/Proma-release/resources/app.asar
```

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
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace,listAgentWorkspaces,getAgentSessionSDKMessages,runAgentHeadless};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' /tmp/main-patched.cjs
```

#### 部署插件文件

将仓库中的 `proma-dev-patches.cjs` 放到 `[安装目录]/resources/app/dist/proma-dev-patches.cjs`

**10 个工具：** get_my_session_id / list_channels / list_workspaces / list_sessions / get_session_info / get_session_context / list_messages / create_session / fork_session / send_message

### 模块 3：频道+模型元数据覆盖

```bash
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' /tmp/main-patched.cjs
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' /tmp/main-patched.cjs 2>/dev/null || true
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' /tmp/main-patched.cjs 2>/dev/null || true
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' /tmp/main-patched.cjs
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' /tmp/main-patched.cjs
```

### 模块 4：UI 模型同步

```bash
cp -r /tmp/app/dist/renderer/* D:/Proma-dev/resources/app/dist/renderer/
sed -i 's/if(qe.has(e))return qe;//g' D:/Proma-dev/resources/app/dist/renderer/assets/index-*.js
```

### 模块 5：外部 MCP 服务

将 `proma-mcp-server.cjs` 放到 `[安装目录]/resources/app/dist/`。插件自动启动 localhost HTTP bridge（端口 19876-19895 自动选择，写入 `~/.proma-dev/mcp-bridge-port.json`）。

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

### 模块 6：托盘图标替换

```bash
sed -i 's/"iconTemplate.png"/"proma-white.png"/g' /tmp/main-patched.cjs
```

---

## 最终部署

```bash
mkdir -p D:/Proma-dev/resources/app/dist
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/
cp proma-mcp-server.cjs D:/Proma-dev/resources/app/dist/
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json
```

---

## 补丁速查表

| 补丁 | 功能 | 适用 |
|---|---|---|
| A | MCP 钩子 | A/B |
| B | API 桥接 + 插件加载 | A/B |
| C1-5 | 频道+模型覆盖 | A/B |
| D+E | Renderer 同步 | A/B |
| 1 | DeepSeek 子Agent v4-pro | 通用 |
| 2 | PROMA_DEV 隔离 | 仅 A |
| 3 | 托盘图标 | 通用 |
| V | 版本号对齐 | 通用 |

---

## 卸载

```bash
bash uninstall.sh
# 或手动：
rm -rf D:/Proma-dev && rm -rf ~/.proma-dev
```

## 许可证

补丁命令和插件代码为独立作品，基于对 Proma（AGPL-3.0）运行时环境的互操作。按 MIT 许可发布。
