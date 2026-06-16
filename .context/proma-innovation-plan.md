# Proma 改造路线图

> 最后更新: 2026-06-16 | 维护者: 周星星

---

## 总览：两层结构

```
Layer 1: MCP 基础设施（当前）
  ├─ 会话管理工具（7 个）
  ├─ 外部 MCP 服务（stdio）
  ├─ 会话间通信（send_message）
  └─ 补丁自动化

        ↓ 支撑

Layer 2: 时间线的剪枝者（未来）
  ├─ 树形任务编排
  ├─ 竹节式自动交接
  ├─ 并行调度 + 剪枝
  └─ 可视化 + 果实审计
```

---

## Layer 1: MCP 基础设施

### 1.1 已完成 ✅

| 类别 | 项目 | 说明 |
|---|---|---|
| **Dev 版** | `D:\Proma-dev\` 双开环境 | 基于正式版 v0.12.23 解包，独立 `~/.proma-dev/` 数据 |
| **补丁 1** | DeepSeek 子 Agent 路由 | `deepseek-v4-flash` → `deepseek-v4-pro` |
| **补丁 2** | userData 隔离 | `PROMA_DEV=1` → `@proma/electron-dev/` |
| **补丁 3** | 托盘图标 | → `proma-white.png` |
| **补丁 4** | 版本号校正 | 防升级提示 |
| **补丁 A** | MCP 钩子 | `global.__proma_getMcpServers__` → 注入 session MCP server |
| **补丁 B** | API 桥接 + 插件加载 | `global.__proma__` 导出 10 个函数 + `require("./proma-dev-patches.cjs")` |
| **补丁 C1-5** | 频道+模型元数据覆盖 | MCP 创建的会话走后端正确频道/模型/API Key |
| **补丁 D+E** | Renderer 同步 | 版本同步 + hydration 幂等守卫移除 → UI 模型选择器正确显示 |
| **插件** | proma-dev-patches.cjs | 7 个 MCP 工具（见 1.2） |
| **Wiki** | proma-dev-wiki.md | 完整技术文档（补丁命令、架构、流程） |

### 1.2 7 个 MCP 工具（均为 Agent 可用）

| 工具 | 功能 | 只读 | 状态 |
|---|---|---|---|
| `list_channels` | 列出所有 AI 渠道及可用模型 | ✅ | 完成 |
| `list_sessions` | 列出 Agent 会话（标题/渠道/模型/归档） | ✅ | 完成 |
| `get_session_info` | 查询单个会话详情（含渠道名、工作区） | ✅ | 完成 |
| `get_session_context` | 查询会话 token 用量（含上下文窗口/使用率） | ✅ | 完成 |
| `create_session` | 创建新会话，指定渠道/模型/标题 | ❌ | 完成 |
| `fork_session` | Fork 会话，保留上下文，支持切换渠道/模型 | ❌ | 完成（DeepSeek 频道有 bug） |
| `send_message` | 向目标会话发送消息，三种执行模式 | ❌ | 完成（仅内部 Agent 可用） |

### 1.3 待做 🔨

#### 1.3.1 外部 MCP 服务（当前任务）⭐

把 7 个工具暴露为独立 stdio MCP server，外部可调用。

**架构：**
```
Claude Code / 外部脚本
    │ stdio (JSON-RPC)
    ▼
proma-mcp-server.cjs          ← 纯 Node.js，零外部依赖
    │ HTTP POST /:tool_name
    ▼
proma-dev-patches.cjs         ← localhost HTTP bridge
  localhost:19876-19895
```

**实现：**
- [x] 插件内抽取 `createToolHandlers(sourceSessionId)` → 7 个纯 handler
- [x] 插件内新增 `createExternalHttpBridge()` → localhost HTTP server，端口自动选择（19876-19895 范围），写入 `~/.proma-dev/mcp-bridge-port.json`
- [x] 新建 `proma-mcp-server.cjs` → 零依赖 MCP JSON-RPC stdio 桥接（206 行），读端口文件 → HTTP 转发
- [x] `send_message` 外部调用时 `notify=true` 返回明确错误（无源会话）
- [x] 校验：集成测试通过（initialize → tools/list → tools/call，7 工具全部正确）

#### 1.3.2 send_message 结果回传

**当前问题：** `wait=true` 模式下只返回 `{ status: "completed" }`，不包含 Agent 的实际输出内容。

**改进方向：**
- `wait=true` 完成后返回最后一条 assistant 消息的文本内容
- `notify=true` 的系统通知中包含目标会话产出的摘要（而非仅"已完成"）
- 外部 MCP server 同理

#### 1.3.3 补丁自动化脚本

写 `apply-patches.sh`：一键执行 `asar extract → sed × 8 → cp plugin → cp renderer → sed renderer → 完成`。

#### 1.3.4 已知 Bug 修复

- **DeepSeek 频道 Fork 失败**：SDK 层 `sdkSessionId` 存在但内部找不到，需排查 JSONL 路径
- **插件备份更新**：`workspace-files/.context/proma-dev-patches.cjs` 仍是 v0.6（453 行），需同步到当前部署版

---

## Layer 2: 时间线的剪枝者（未来）

> 详见 `proma-dev-wiki-timeline-pruner.md`。Layer 2 依赖 Layer 1 全部完成。

### 2.1 核心隐喻

```
每一个 Agent 会话 = 一条时间线
Fork = 时间线上长出的分支
send_message = 激活分支上的叶子
get_session_context = 监控叶子是否接近枯竭
剪枝 = 放弃失败路径，回退到上一个成功检查点
竹节交接 = 同一分支上下文超甜点区后，Fork 新节继续
```

### 2.2 待建设能力

#### 调度层
- [ ] **树状态文件**：根 Agent 自动维护 `.context/task-tree.md`
- [ ] **剪枝决策**：根据输出质量自动判断 ✅/❌
- [ ] **并行槽位管理**：同一渠道串行排队，不同渠道可并行
- [ ] **递归深度控制**：最大树深度限制

#### 自动化层
- [ ] **竹节式自动交接**：`get_session_context` 监控 → 甜点区 85% 触发 → Fork → 简报注入 → 继续
- [ ] **树枝间 DAG 通信**：`send_message` 加 `reply_to` 支持直接依赖
- [ ] **成果自动聚合**：根 Agent 收集所有果实，Fork 整合会话生成最终交付物

#### 可视化层
- [ ] **树形侧边栏**：Proma 会话列表 → 树形结构
- [ ] **实时状态图标**：🍃激活 / 🍎完成 / 🥀剪枝 / 🎋竹节节点
- [ ] **Mermaid 导出**：当前任务树 → Mermaid 图

### 2.3 甜点区参考

| 模型 | 甜点区 | 硬上限 |
|---|---|---|
| DeepSeek V4 Pro | 150K ~ 250K | 400K |
| DeepSeek V4 Flash | 80K ~ 150K | 200K |
| Claude Sonnet 4.6 | 100K ~ 200K | 300K |
| GLM-5-Turbo | 50K ~ 80K | 100K |

---

## 三、当前执行计划（2026-06-16）

### 优先级排序

| 优先级 | 任务 | 状态 |
|---|---|---|
| P0 | 外部 MCP 服务（7 工具 stdio 暴露） | ✅ 完成 (v0.9) |
| P1 | send_message 结果回传 + list_messages + 多工作区 | ✅ 完成 (v0.10) |
| P1 | 插件备份同步到 workspace-files | ✅ 完成 (v0.10) |
| P2 | 补丁自动化脚本 `apply-patches.sh` | ⏳ 待做 |
| P2 | DeepSeek Fork bug 排查 | ⏳ 待做 |
| P3 | 模型列表缓存 | ⏳ 待做 |

### 下一步

**今天：实现外部 MCP 服务。** 具体改动见 `1.3.1` 节。
