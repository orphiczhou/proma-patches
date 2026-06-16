# Proma 会话管理补丁工具包

> 给 Proma Agent 装上管理会话的双手。10 个 MCP 工具，内部 Agent 间协作 + 外部工具调用。
> 适用于 Proma v0.12.x 商业版。无需重编译，sed 补丁 + 插件文件即可。

---

## 一、这个工具包做什么

Proma 本身支持 Fork 会话，但 Agent **无法自己操作这些能力**。Agent 被困在自己的会话里，不能创建新会话、不能 Fork 自己、不能给其他会话发消息。

本工具包通过在主进程上打 **5 个 sed 补丁** + 放入 **2 个插件文件**，给 Agent 注入 **10 个会话管理 MCP 工具**：

| 工具 | 功能 |
|---|---|
| `get_my_session_id` | 获取自己的会话 ID |
| `list_channels` | 列出所有 AI 渠道及可用模型 |
| `list_workspaces` | 列出所有工作区 |
| `list_sessions` | 列出会话（支持工作区过滤） |
| `get_session_info` | 查询会话详情 |
| `get_session_context` | 查询 token 用量/上下文窗口 |
| `list_messages` | 消息历史（UUID/角色/文本/分页） |
| `create_session` | 创建新会话 |
| `fork_session` | Fork 会话（支持精确 UUID 截断） |
| `send_message` | 向会话发消息（返回 Agent 输出） |

同时暴露为**独立 stdio MCP server**，让外部工具（Claude Code 等）也能调用。

---

## 二、前置条件

- Proma 商业版 v0.12.x（`D:\Proma\`）
- Node.js >= 18
- Git Bash（或 WSL/Cygwin，用于执行 sed）

---

## 三、安装

### 方式 1：一键安装（推荐）

```bash
# 克隆工具包
git clone https://github.com/orphiczhou/Proma.git
cd Proma/proma-session-patch-kit

# 运行安装脚本
bash apply-patches.sh
```

脚本会自动：
1. 从 `D:\Proma\resources\app.asar` 提取 `main.cjs`
2. 打 5 个 sed 补丁
3. 把插件和 MCP server 复制到 `D:\Proma-dev\resources\app\dist\`
4. 创建启动脚本 `start-dev.bat`

### 方式 2：手动安装（逐步）

如果你想让 Agent 帮你执行，把本文档发给 Agent，说：

> "请按照这份文档，帮我在 D:\Proma\ 的基础上创建 D:\Proma-dev\ 开发版，打上所有补丁。"

Agent 会按照 §四-§八 的步骤逐一执行。

---

## 四、步骤 1：创建 Dev 版

```bash
# 复制正式版
cp -r D:/Proma D:/Proma-dev

# 解包 ASAR
cd D:/Proma-dev/resources
npx asar extract app.asar app
mv app.asar app.asar.disabled

# 合并原生模块
cp -r app.asar.unpacked/node_modules/* app/node_modules/

# 同步认证数据
cp ~/.proma/cloud-auth.json ~/.proma-dev/
cp ~/.proma/channels.json ~/.proma-dev/
cp ~/.proma/user-profile.json ~/.proma-dev/
```

---

## 五、步骤 2：打 sed 补丁

从正式版提取最新 `main.cjs`：

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp /tmp/app/dist/main.cjs /tmp/main-patched.cjs
```

在 `/tmp/main-patched.cjs` 上依次打以下 5 个补丁：

### 补丁 A：MCP 钩子

让 Agent 的每次 `sendMessage()` 调用都检查是否注入额外的 MCP server。

```bash
sed -i 's|          const dynamicCtx = buildDynamicContext({|if(typeof global.__proma_getMcpServers__==="function"){const __h=global.__proma_getMcpServers__(sessionId,workspaceSlug,sdk);if(__h)Object.assign(mcpServers,__h);}\n          const dynamicCtx = buildDynamicContext({|' /tmp/main-patched.cjs
```

### 补丁 B：API 桥接 + 插件加载

导出 12 个核心函数到全局对象，加载插件文件。

```bash
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace,listAgentWorkspaces,getAgentSessionSDKMessages,runAgentHeadless};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' /tmp/main-patched.cjs
```

### 补丁 C：频道 + 模型元数据覆盖

让 MCP 创建的会话使用元数据中存储的正确渠道和模型。

```bash
# C1: 优先用元数据的 channelId
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' /tmp/main-patched.cjs

# C2: API key 解密用覆盖后的 channelId
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' /tmp/main-patched.cjs

# C3: autoGenerateTitle 用覆盖后的 channelId
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' /tmp/main-patched.cjs

# C4: modelId 优先用元数据
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' /tmp/main-patched.cjs

# C5: SDK query 用 resolvedModel
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' /tmp/main-patched.cjs
```

### 补丁 D：DeepSeek 子 Agent 使用 V4 Pro（可选）

```bash
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' /tmp/main-patched.cjs
```

### 补丁 E：PROMA_DEV userData 隔离

```bash
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_DEV === "1") {/g' /tmp/main-patched.cjs
```

---

## 六、步骤 3：部署文件

```bash
# 部署 main.cjs
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs

# 部署插件和 MCP server（从工具包目录执行）
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/
cp proma-mcp-server.cjs D:/Proma-dev/resources/app/dist/

# 同步 renderer（每次正式版升级后需要）
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp -r /tmp/app/dist/renderer/* D:/Proma-dev/resources/app/dist/renderer/
# 移除 hydration 幂等守卫
sed -i 's/if(qe.has(e))return qe;//g' D:/Proma-dev/resources/app/dist/renderer/assets/index-*.js

# 对齐版本号
sed -i 's/"version": "0.12.X"/"version": "0.12.23"/g' D:/Proma-dev/resources/app/package.json
```

---

## 七、步骤 4：启动验证

创建 `D:\Proma-dev\start-dev.bat`：

```bat
@echo off
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma-white.exe"
```

双击启动后验证：

1. 检查 `~/.proma-dev/mcp-bridge-port.json` 已生成
2. 打开 Proma Agent 会话，输入"用 list_channels 列出可用的 AI 渠道"
3. Agent 应该能调用 MCP 工具并返回渠道列表

---

## 八、配置外部 MCP（可选）

如果要在 Claude Code 等外部工具中调用 Proma 会话管理能力：

在 `.claude/mcp.json` 中添加：

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

---

## 九、卸载

```bash
# 删除开发版
rm -rf D:/Proma-dev

# 清理开发版数据（可选）
rm -rf ~/.proma-dev
rm -rf %APPDATA%/@proma/electron-dev
```

---

## 十、正式版升级后重新安装

每次正式版升级后，重新执行 §五-§六：

```bash
bash apply-patches.sh
```

---

## 十一、验证结果

以下场景已在 v0.12.23 上验证通过：

- ✅ 10 个 MCP 工具全部可用
- ✅ 内部 Agent 间三层联动（老板→小弟→子小弟）
- ✅ 多轮对话 + 任选一轮 Fork（通过 `list_messages` 获取 UUID）
- ✅ 并行调度 + 轮询回收（3 小弟并行，8-12 秒完成）
- ✅ 外部 stdio MCP 10 工具全部可用
- ✅ DeepSeek / ZLM / Proma 官方渠道 Fork 正常

---

## 十二、使用场景

安装完成后，Agent 可以进行以下操作：

```
Agent（在你的 Proma 会话中）:
  ├─ list_channels → 看有哪些模型可用
  ├─ list_workspaces → 看有哪些工作区
  ├─ create_session → 开一个"开发会话"用便宜模型
  ├─ send_message → 给开发会话发任务
  ├─ get_session_context → 监控开发进度
  ├─ list_messages → 查看开发会话的对话历史
  ├─ fork_session(uuid) → 从某轮对话截断重试
  └─ 最终汇总所有产出
```

---

## 十三、文件清单

| 文件 | 说明 |
|---|---|
| `apply-patches.sh` | 一键安装脚本 |
| `proma-dev-patches.cjs` | 插件主文件（710+ 行） |
| `proma-mcp-server.cjs` | 外部 MCP stdio 桥接（230+ 行） |
| `README.md` | 本文档 |

---

## 十四、反馈与改进

本工具包是"时间线的剪枝者"概念的第一步基础设施。

- 完整技术 Wiki：见 workspace-files
- 使用场景介绍：见 workspace-files
- 问题反馈：提交到 [orphiczhou/Proma](https://github.com/orphiczhou/Proma) issues
