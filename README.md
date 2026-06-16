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

推荐组合：
- 只想强子Agent → 1
- Agent 管理多会话 → 2+3+4
- 外部操控 Proma → 2+3+5
- 全都要 → 2+3+4+5（1 已含）

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

# 5. 同步认证数据
cp ~/.proma/cloud-auth.json ~/.proma-dev/
cp ~/.proma/channels.json ~/.proma-dev/
cp ~/.proma/user-profile.json ~/.proma-dev/
```

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

**10 个工具：**
| 工具 | 功能 |
|---|---|
| `get_my_session_id` | Agent 获取自己的会话 ID |
| `list_channels` | 列出所有 AI 渠道及模型 |
| `list_workspaces` | 列出所有工作区 |
| `list_sessions` | 列出会话（支持工作区过滤） |
| `get_session_info` | 查询会话详情 |
| `get_session_context` | Token 用量/上下文窗口 |
| `list_messages` | 消息历史（UUID/角色/文本/分页） |
| `create_session` | 创建新会话 |
| `fork_session` | Fork 会话（支持精确 UUID 截断） |
| `send_message` | 向会话发消息（返回 Agent 输出） |

### 模块 3：频道+模型元数据覆盖

```bash
# C1: 频道查询优先用元数据
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' /tmp/main-patched.cjs

# C2: API Key 解密用覆盖后的 channelId（行号可能漂移，失败不中断）
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' /tmp/main-patched.cjs 2>/dev/null || true

# C3: 标题生成用覆盖后的 channelId
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' /tmp/main-patched.cjs 2>/dev/null || true

# C4: modelId 优先用元数据
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' /tmp/main-patched.cjs

# C5: SDK 查询用 resolvedModel
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' /tmp/main-patched.cjs
```

### 模块 4：UI 模型同步（Renderer 补丁）

```bash
# 同步 renderer 文件
cp -r /tmp/app/dist/renderer/* D:/Proma-dev/resources/app/dist/renderer/
# 移除 hydration 幂等守卫
sed -i 's/if(qe.has(e))return qe;//g' D:/Proma-dev/resources/app/dist/renderer/assets/index-*.js
```

### 模块 5：外部 MCP 服务

将 `proma-mcp-server.cjs` 放到 `[安装目录]/resources/app/dist/`。插件会自动启动 localhost HTTP bridge（端口 19876-19895 自动选择，写入 `~/.proma-dev/mcp-bridge-port.json`）。

Claude Code 配置（`.claude/mcp.json`）：
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
# Dev 版
mkdir -p D:/Proma-dev/resources/app/dist
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/
cp proma-mcp-server.cjs D:/Proma-dev/resources/app/dist/

# 对齐版本号
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

## 使用示例

安装后，Agent 可执行：

```
Agent（在你的 Proma 会话中）:
  ├─ list_channels → 看有哪些模型可用
  ├─ list_workspaces → 看有哪些工作区
  ├─ create_session → 开开发会话用便宜模型
  ├─ send_message → 给开发会话发任务
  ├─ get_session_context → 监控 token 用量
  ├─ list_messages → 查对话历史 + 获取 UUID
  ├─ fork_session(uuid) → 从某轮截断重试
  └─ 汇总所有产出
```

## 验证结果

- ✅ 10 个 MCP 工具全部可用
- ✅ 内部 Agent 间三层联动（老板→小弟→子小弟）
- ✅ 多轮对话 + 任选一轮 Fork
- ✅ 并行调度 + 轮询回收
- ✅ 外部 stdio MCP 全部可用
- ✅ DeepSeek / ZLM / Proma 官方 Fork 正常

## 卸载

```bash
bash uninstall.sh
# 或手动：
rm -rf D:/Proma-dev
rm -rf ~/.proma-dev
```

## 许可证

补丁命令和插件代码为独立作品，基于对 Proma（AGPL-3.0）运行时环境的互操作。按 MIT 许可发布。
