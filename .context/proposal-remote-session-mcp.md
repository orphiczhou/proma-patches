# 改进提案：远端会话 MCP 内建工具 + 通用实例命名

> 日期: 2026-06-16 | 状态: 草稿 | 版本: v0.1

---

## 一、背景与问题

### 1.1 当前架构

Proma 的会话管理能力通过两层暴露：

```
Agent（内部）                   外部工具（Claude Code / 脚本）
    │                                │
    │ mcp__session__* (进程内)       │ stdio MCP → HTTP bridge
    ▼                                ▼
proma-dev-patches.cjs           proma-mcp-server.cjs
    │                                │
    └────────────┬───────────────────┘
                 │
          localhost:19876-19895
          HTTP bridge (127.0.0.1)
```

- **内部 Agent** 通过 `mcp__session__*` 调用 11 个进程内工具
- **外部工具** 通过 `proma-mcp-server.cjs` stdio 桥接 → HTTP POST → 同一套 handler
- **远端实例**（同一台机器上的另一个 Proma 进程）只能通过 curl 手工调用 HTTP bridge

### 1.2 三个痛点

**痛点 1：远端操作是二等公民。** Agent 操作本实例用 `mcp__session__*` 一行调用，操作远端实例却要手工 curl + 端口扫描 + printf 管道 + 中文编码处理。Agent 频繁因遗漏步骤导致"远端口令"执行失败。

**痛点 2：实例身份用布尔值表示。** `GET /get_instance_info` 返回 `{"proma_dev": true/false}`，只能区分 Dev 和 Release。用户未来会有更多实例（staging、专项测试、客户演示等），布尔值无法扩展。

**痛点 3：Skill 被迫承载底层细节。** session-management Skill 的"第一判断"章节（v1.3.0 新增）本质上是在教 Agent 如何做端口扫描、HTTP 请求、编码转换——这些应该是工具层封装的事，不是 Skill 该管的事。

---

## 二、改进目标

### 2.1 核心思想

**远端操作提升为一等公民。** 仿照本地 `mcp__session__*`，新建 `mcp__remote-session__*`（也是 11 个工具），让 Agent 像操作本地会话一样操作远端实例。

### 2.2 理想体验

```
# 本地（不变）
mcp__session__create_session({ channel_id: "...", title: "测试" })

# 远端（改进后）
mcp__remote-session__create_session({ instance: "dev", channel_id: "...", title: "测试" })

# Agent 不需要知道端口号、不需要 curl、不需要 printf、不需要 UTF-8 处理
```

### 2.3 与 Skill 的关系

Skill 从"教 Agent 如何 curl"退位为"告诉 Agent 什么时候用哪个工具"：

```
Skill v1.3.0：  "远端操作就是 curl 四步走：探测端口 → 全部 curl → 中文编码 → 实查验证"
Skill v1.4.0：  "本实例 mcp__session__*，远端实例 mcp__remote-session__*，加 instance 参数即可"
```

---

## 三、实例命名体系

### 3.1 从布尔到字符串

```
v0.11 (现状)：
  GET /get_instance_info → { "proma_dev": true, "port": 19876 }
  启动参数：PROMA_DEV=1（环境变量，布尔语义）

v1.0 (目标)：
  GET /get_instance_info → { "instance": "dev", "port": 19876 }
  启动参数：PROMA_INSTANCE_NAME=dev（环境变量，字符串语义）
```

### 3.2 命名规范

`PROMA_INSTANCE_NAME` 的值是自由字符串，建议使用小写短横线命名：

| 实例名 | 用途 |
|--------|------|
| `dev` | 开发调试 |
| `release` | 日常使用（补丁版） |
| `staging` | 预发布验证 |
| `南大专用` | 某个项目的独立实例 |
| `demo-客户名` | 客户演示 |

### 3.3 启动脚本更新

```bat
# start-dev.bat（改前）
set PROMA_DEV=1

# start-dev.bat（改后）
set PROMA_INSTANCE_NAME=dev
set PROMA_DEV=1                ← 保留向后兼容：插件检测到 PROMA_DEV=1 但无 PROMA_INSTANCE_NAME 时，默认 instance="dev"

# start-release.bat（改后）
set PROMA_INSTANCE_NAME=release

# 将来任意新增
set PROMA_INSTANCE_NAME=staging
```

> **向后兼容策略**：`createExternalHttpBridge()` 读取 `process.env.PROMA_INSTANCE_NAME`，若不存在则 fallback 到检查 `PROMA_DEV`（`=1` → `"dev"`，否则 `"release"`）。`get_instance_info` 同时返回 `instance`（新）和 `proma_dev`（旧，标记 deprecated），给 proma-mcp-server.cjs 和外部调用者一个过渡期。

### 3.4 涉及改动的文件和行

| 文件 | 改动 |
|------|------|
| `proma-dev-patches.cjs` — `createExternalHttpBridge()` | `get_instance_info` 返回值：增加 `instance` 字段，保留 `proma_dev` deprecated |
| `proma-dev-patches.cjs` — `createExternalHttpBridge()` | 启动日志：`External MCP HTTP bridge: http://127.0.0.1:XXXXX (instance: dev)` |
| `proma-mcp-server.cjs` — 端口扫描匹配 | `--dev`/`--release` 改为 `--instance <name>`，匹配 `get_instance_info` 的 `instance` 字段 |
| `proma-mcp-server.cjs` — CLI 参数 | 新增 `--instance` 参数，保留 `--dev`/`--release` 作别名 |
| `start-dev.bat` | `PROMA_DEV=1` → `PROMA_INSTANCE_NAME=dev` |
| `start-release.bat` | 增加 `PROMA_INSTANCE_NAME=release` |
| `proma-dev-wiki.md` | 更新补丁说明 |

---

## 四、`mcp__remote-session__*` 工具设计

### 4.1 架构

```
Agent
  │
  ├─ mcp__session__*          ← 本地 session MCP server（已有，不变）
  │     │
  │     └─ createToolHandlers(sourceSessionId)
  │           └─ global.__proma__ API（进程内直连）
  │
  └─ mcp__remote-session__*   ← 远端 session MCP server（新增）
        │
        └─ createRemoteToolHandlers()
              ├─ 实例发现：扫 19876-19895，调 GET /get_instance_info
              │     → 按 instance 参数匹配，结果缓存
              └─ HTTP 调用：http.request() → Buffer.concat → JSON.parse
                    → 自动处理 UTF-8，Agent 无感知
```

### 4.2 11 个工具

与本地 `session` MCP server 完全对称，每个工具多一个 `instance` 参数：

| 工具 | 参数（与本地相同） | 新增参数 |
|------|-------------------|----------|
| `remote_list_channels` | 无 | `instance` |
| `remote_list_workspaces` | 无 | `instance` |
| `remote_list_sessions` | `include_archived?`, `workspace_id?`, `limit?` | `instance` |
| `remote_get_session_info` | `session_id` | `instance` |
| `remote_get_session_context` | `session_id` | `instance` |
| `remote_list_messages` | `session_id`, `offset?`, `limit?` | `instance` |
| `remote_create_session` | `channel_id`, `model_id?`, `title?`, `workspace_id?` | `instance` |
| `remote_fork_session` | `source_session_id`, `up_to_message_uuid?`, `title?`, `new_channel_id?`, `new_model_id?`, `new_workspace_id?` | `instance` |
| `remote_send_message` | `session_id`, `message`, `wait?`, `notify?`, `model_id?`, `channel_id?` | `instance` |
| `remote_archive_session` | `session_id`, `archived?` | `instance` |
| `remote_get_my_session_id` | 无 | `instance` |

### 4.3 `instance` 参数

- **类型**：`string`，如 `"dev"`、`"release"`、`"staging"`
- **发现**：首次调用时扫描 19876-19895 端口，调 `GET /get_instance_info`，缓存 `instance → port` 映射
- **缓存**：同一 Agent 调用期间缓存端口，避免每次扫描
- **错误**：找不到匹配实例时返回明确错误：`"No instance named 'xxx' found (scanned 19876-19895)"`
- **通配**：`instance: "auto"` 返回第一个发现的实例（调试用）

### 4.4 Handler 实现概要

```javascript
// 伪代码——每个 remote handler 的核心模式
let instanceCache = {};  // { "dev": 19876, "release": 19877 }

async function discoverInstance(instanceName) {
  if (instanceCache[instanceName]) return instanceCache[instanceName];
  
  for (let port = 19876; port <= 19895; port++) {
    const info = await httpGet(`http://127.0.0.1:${port}/get_instance_info`);
    if (info && info.instance === instanceName) {
      instanceCache[instanceName] = port;
      return port;
    }
  }
  throw new Error(`No instance named '${instanceName}' found`);
}

async function remoteCreateSession(args) {
  const port = await discoverInstance(args.instance);
  return httpPost(port, 'create_session', {
    channel_id: args.channel_id,
    model_id: args.model_id,
    title: args.title,
    workspace_id: args.workspace_id,
  });
}
```

### 4.5 MCP Server 注册

在插件末尾注册第二个 MCP server：

```javascript
// 现有（不变）
const sessionMcpServer = createSessionMcpServer(sdk, z, sessionId);

// 新增
const remoteSessionMcpServer = createRemoteSessionMcpServer(sdk, z);

// 注册钩子（不变，MCP 框架自动合并两个 server 的工具列表）
global.__proma_getMcpServers__ = (sId, ws) => {
  sessionMcpServer.updateSessionId(sId);  // 本地 server 需要 session 上下文
  return { session: sessionMcpServer, "remote-session": remoteSessionMcpServer };
};
```

### 4.6 与现有 HTTP bridge 的关系

**不冲突，各司其职：**

| | HTTP bridge (已有) | remote-session MCP (新增) |
|---|---|---|
| 调用方 | 外部 MCP 客户端（Claude Code/脚本） | 内部 Agent |
| 协议 | HTTP POST（外部 MCP server 转发） | 内部 `http.request()` |
| 实例发现 | 由 `proma-mcp-server.cjs` 在外部做 | 由 handler 内部自动做 |
| 感知度 | 调用方知道端口和 HTTP | Agent 完全无感知 |

两者可共存：外部工具继续走 HTTP bridge + stdio MCP，内部 Agent 新增 `remote-session` 工具。

---

## 五、实施计划

### 阶段 1：实例命名改造（基础设施）

| 步骤 | 文件 | 改动 |
|------|------|------|
| 1.1 | `proma-dev-patches.cjs` | `createExternalHttpBridge()`: 读 `PROMA_INSTANCE_NAME`，fallback `PROMA_DEV`，`get_instance_info` 返回 `instance`+`proma_dev`(deprecated) |
| 1.2 | `proma-mcp-server.cjs` | `--instance <name>` 参数，端口扫描匹配 `instance` 字段 |
| 1.3 | `start-dev.bat` / `start-release.bat` | 设置 `PROMA_INSTANCE_NAME` |
| 1.4 | 验证 | 启动 Dev → `curl /get_instance_info` 确认返回 `instance: "dev"` |

### 阶段 2：remote-session MCP server（核心功能）

| 步骤 | 文件 | 改动 |
|------|------|------|
| 2.1 | `proma-dev-patches.cjs` | 新增 `createRemoteToolHandlers()` — 11 个 handler，内置实例发现+HTTP 调用 |
| 2.2 | `proma-dev-patches.cjs` | 新增 `createRemoteSessionMcpServer(sdk, z)` — 注册到 `proma_getMcpServers__` |
| 2.3 | 部署到 Dev | `cp` + 重启验证 |
| 2.4 | 集成测试 | Agent 调 `mcp__remote-session__create_session({instance:"dev",...})` |

### 阶段 3：Skill + 文档收敛

| 步骤 | 内容 |
|------|------|
| 3.1 | session-management Skill v1.4.0："第一判断"简化为两句，新增"模式 9"改用 remote-session 工具 |
| 3.2 | Wiki 更新版本记录 |
| 3.3 | 全链路验证：Agent 零提示词自主完成远端操作 |

---

## 六、风险评估

| 风险 | 影响 | 缓解 |
|------|------|------|
| `instance` 缓存过期（远端重启换端口） | 请求发到错误端口 | 请求失败时清除缓存重新发现 |
| `PROMA_INSTANCE_NAME` 未设置 | 旧启动脚本不兼容 | fallback 到 `PROMA_DEV` 检测，确保向后兼容 |
| 端口扫描耗时（首次调用） | 首次调用慢 ~2 秒 | 缓存 + 并行扫描（同时发 20 个 GET，取最快响应） |
| MCP server 工具名冲突 | `session` 和 `remote-session` 有同名工具 | 前缀区分：`remote_` vs 本地无前缀 |
| 两个实例同时重启端口互换 | 缓存指向错误实例 | 每次 HTTP 请求前调 `get_instance_info` 验证 instance 名是否一致 |

---

## 七、替代方案

### 方案 B：纯 Skill 方案（不写代码）

继续用 Skill 教 Agent 如何 curl。优点零开发成本，缺点 Agent 频繁出错、Skill 越长越复杂。

### 方案 C：统一 MCP server 方案

把 11 个工具合并到一个 MCP server，加 `target` 参数区分本地/远端。缺点：每个工具都要写 if-else 分支，handler 逻辑混乱；且本地 `send_message(notify)` 依赖 `sourceSessionId` 闭包，远端不需要。

**推荐方案 A（本提案）**：新建独立 `remote-session` MCP server，handler 层复用 HTTP bridge 的纯函数设计，与本地 `session` MCP server 平行但不耦合。

---

## 八、待讨论

1. **`instance` 参数是否必填？** 可选默认值（如 `"dev"`）可能方便但隐藏错误。建议必填，强制 Agent 明确目标。
2. **是否支持跨机器远端实例？** 本提案只覆盖同一台机器（127.0.0.1）。跨机器需要 IP + 端口配置，可后续扩展 `instance` 参数为 `"192.168.1.x:port"` 格式。
3. **`remote-session` 是否暴露给外部 MCP？** 暂不需要——外部工具已有 `proma-mcp-server.cjs` stdio 方案。
