# Proma 改造路线图

> 最后更新: 2026-06-16 | 维护者: 周星星

---

## 总览：两层结构

```
Layer 1: MCP 基础设施（当前）
  ├─ 会话管理工具（22 个：11 本地 + 11 远端）
  ├─ 外部 MCP 服务（stdio，实例字符串命名 + 自动发现）
  ├─ 远端 MCP Server（remote-session，Agent 无需 curl）
  ├─ 会话间通信（send_message + reply + notify）
  ├─ Release 并行版（彩色图标，独立部署）
  └─ 补丁工具包（apply-patches.sh）

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
| **补丁 F** | 跨渠道 sdkSessionId 断裂防护 | UI 跨渠道切换模型时检测差异，清除旧 session 走上下文回填，避免 "Session 已失效" |
| **补丁 D+E** | Renderer 同步 | 版本同步 + hydration 幂等守卫移除 → UI 模型选择器正确显示 |
| **补丁 G** | CLAUDE_CONFIG_DIR 无条件覆盖 | 修复 Dev 实例 fork 失败——去掉条件守卫，强制用 `getSdkConfigDir()` 纠正路径 |
| **插件** | proma-dev-patches.cjs | 22 个 MCP 工具（11 本地 + 11 远端 remote-session），实例自动发现，HTTP bridge |
| **外部 MCP** | proma-mcp-server.cjs | 零依赖 stdio 桥接（168 行），`--instance <name>` 参数，实例字符串匹配 |
| **Release 版** | `D:\Proma-release\` | 与正式版/Dev 三开，彩色图标，独立部署（v0.15 已同步） |
| **Wiki** | proma-dev-wiki.md | 完整技术文档（补丁命令、架构、流程） |
| **Skill** | session-management v1.3.0 | Agent 内置技能，9 大使用模式，"第一判断"远端隔离机制，外部 MCP 端口发现文档 |

### 1.2 22 个 MCP 工具（11 本地 + 11 远端）

#### 本地 session MCP server（`mcp__session__*`）

| 工具 | 功能 | 只读 | 状态 |
|---|---|---|---|
| `get_my_session_id` | Agent 自指——获取当前会话 ID | ✅ | 完成 |
| `list_channels` | 列出所有 AI 渠道及可用模型 | ✅ | 完成 |
| `list_workspaces` | 列出所有工作区（id/name/slug） | ✅ | 完成 |
| `list_sessions` | 列出 Agent 会话（含工作区名、支持 workspace_id 过滤） | ✅ | 完成 |
| `get_session_info` | 查询单个会话详情（含渠道名、工作区） | ✅ | 完成 |
| `get_session_context` | 查询会话 token 用量（含上下文窗口/使用率、渠道 fallback） | ✅ | 完成 |
| `list_messages` | 列出消息历史（UUID/角色/文本/usage），支持分页 | ✅ | 完成 |
| `create_session` | 创建新会话，指定渠道/模型/标题/工作区 | ❌ | 完成 |
| `fork_session` | Fork 会话，正确继承 channel/modelId；支持 UUID 截断 | ❌ | 完成（v0.15 补丁 G 修复 Dev fork） |
| `send_message` | 向目标会话发消息，wait=true 返回 reply 字段；外部不支持 notify | ❌ | 完成 |
| `archive_session` | 归档/取消归档会话（归档后默认隐藏） | ❌ | 完成 |

#### 远端 remote-session MCP server（`mcp__remote-session__*`）⭐ v0.14

操作其他 Proma 实例的会话。每个工具多一个 `instance` 参数（如 `"dev"`、`"release"`），内置端口扫描 + 实例发现 + 缓存，Agent 无需手动 curl。

| 工具 | 对应本地工具 |
|---|---|
| `remote_list_channels` | `list_channels` |
| `remote_list_workspaces` | `list_workspaces` |
| `remote_list_sessions` | `list_sessions` |
| `remote_get_session_info` | `get_session_info` |
| `remote_get_session_context` | `get_session_context` |
| `remote_list_messages` | `list_messages` |
| `remote_create_session` | `create_session` |
| `remote_fork_session` | `fork_session` |
| `remote_send_message` | `send_message` |
| `remote_archive_session` | `archive_session` |
| `remote_get_my_session_id` | `get_my_session_id` |

### 1.3 待做 🔨

#### 1.3.1 外部 MCP 服务 ✅ 完成 (v0.9 → v0.11 增强)

把 11 个工具暴露为独立 stdio MCP server。已完成：

- **实现：**
- [x] 插件内抽取 `createToolHandlers(sourceSessionId)` → 11 个纯 handler
- [x] 插件内新增 `createExternalHttpBridge()` → localhost HTTP server，端口自动选择（19876-19895 范围）
- [x] `GET /get_instance_info` 端点 → 返回 `{ proma_dev, port }`，废弃端口文件
- [x] 新建 `proma-mcp-server.cjs` → 零依赖 MCP JSON-RPC stdio 桥接（153 行）
- [x] `--dev`/`--release` 参数 → 端口扫描 + 自动发现目标实例
- [x] `send_message` 外部调用时 `notify=true` 返回明确错误

#### 1.3.2 send_message 结果回传 ✅ 完成 (v0.10)

- [x] `wait=true` 完成后返回最后一条 assistant 消息的文本（`reply` 字段）
- [x] 内部 Agent 间 notify 正常工作
- [x] 外部 MCP server 同理

#### 1.3.3 Release 并行版 ✅ 完成 (v0.11)

`D:\Proma-release\` 与正式版/Dev 三开。彩色图标（`rcedit` 注入 + 托盘 `proma-color.png`）。独立 userData（`~/.proma-release/`）。

#### 1.3.4 补丁工具包 ✅ 完成

- [x] `apply-patches.sh` — 一键部署脚本
- [x] `uninstall.sh` — 卸载脚本
- [x] `AGENT-PROMPT.md` — Agent 安装提示词
- [x] 发布到 GitHub: `orphiczhou/proma-patches`

#### 1.3.5 已知 Bug / 遗留问题

- ~~DeepSeek 跨渠道 Fork~~ → ✅ v0.15 补丁 G：根因 `CLAUDE_CONFIG_DIR` 条件守卫导致 Dev 读写路径不一致。去掉守卫无条件覆盖，Dev fork 0/3→3/3
- ~~远端操作为二等公民~~ → ✅ v0.14 `remote-session` MCP server：11 个 `remote_*` 工具，Agent 操作远端实例像本地一样简单。Skill 中的 curl 模式退位为备选
- **cloud-auth token 共享冲突**：Dev 和 Release 共用 token，一方刷新后另一方失效。

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
| P0 | 外部 MCP 服务（11 工具 stdio 暴露 + 实例自动发现） | ✅ 完成 (v0.9 → v0.11) |
| P0 | Release 并行版部署 | ✅ 完成 (v0.11) |
| P1 | send_message 结果回传 + list_messages + 多工作区 | ✅ 完成 (v0.10) |
| P1 | HTTP bridge UTF-8 编码修复 + 全链路验证 13/13 | ✅ 完成 (v0.12) |
| P1 | remote-session MCP server（11 远端工具 + 实例字符串命名） | ✅ 完成 (v0.14) |
| P1 | DeepSeek 跨渠道 Fork → 补丁 G CLAUDE_CONFIG_DIR 修复 | ✅ 完成 (v0.15) |
| P1 | Skill v1.3.0（第一判断关卡 + 模式 9 远端 curl） | ✅ 完成 (v0.13) |
| P3 | 模型列表缓存 | ⏳ 待做 |

### 下一步

- **Layer 2 ready**：22 工具体系完整，基础设施已具备。时间线剪枝者——树形任务编排、竹节式自动交接、并行调度+剪枝
- **低优先**：模型列表缓存优化
