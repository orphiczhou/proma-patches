# 使用场景：用 Proma 组织 Agent 团队进行协作开发

> 作者：周星星 | 日期：2026-06-16 | 提交给 Proma 团队的功能场景参考

---

## 一、我是谁，我在做什么

我是一个在南大做 AI Agent 编程方法论研究的开发者。我的日常工作是：设计一个软件系统，把它拆成多个模块，让 AI Agent 并行开发，然后把结果汇总审计。

我在本机有多个工程目录，通过 Proma 的工作区来管理。我的典型项目结构：

```
D:\Projects\
  ├── my-app/          ← 工作区 "my-app"（主项目）
  ├── my-app-libs/     ← 工作区 "my-app-libs"（公共组件库）
  └── research/        ← 工作区 "research"（技术调研）
```

---

## 二、我的需求场景

### 场景 1：设计→拆解→并行开发→汇总

**流程：**

```
1. 我在 Proma 开一个"设计会话"，用 SOTA 模型（如 Claude Opus）
   ├─ 和我讨论需求
   ├─ 产出 PRD（产品需求文档）
   ├─ 拆分出 N 个子任务
   └─ 生成任务分配计划 → 写入 .context/task-plan.md

2. 设计会话调用 MCP 工具：
   ├─ create_session × N     → 为每个子任务创建"开发会话"
   │   每个开发会话用不同的性价比模型：
   │   - 复杂逻辑：Claude Opus / DeepSeek V4 Pro
   │   - 简单 CRUD：DeepSeek V4 Flash / GLM-4.5-Air
   │   - 前端 UI：Claude Sonnet
   ├─ send_message × N        → 给每个开发会话发送任务描述
   │   wait=false（fire-and-forget）
   └─ 轮询 get_session_context → 监控各会话完成情况

3. 所有开发会话完成后：
   ├─ list_messages           → 收集各会话的产出
   ├─ fork_session            → 开一个"整合会话"用最强模型
   └─ send_message(整合)       → 汇总所有产出，生成最终交付物
```

**我需要的工具：** `create_session`, `send_message`, `get_session_context`, `list_messages`, `fork_session`

### 场景 2：深度探索——从任意一轮 Fork 重试

**流程：**

```
1. 开发会话 A 执行到第 5 轮，发现方向不对
2. list_messages(会话A) → 找到第 2 轮 assistant 回复的 UUID
3. fork_session(会话A, up_to_message_uuid=第2轮的UUID)
   → 新会话 A' 从第 2 轮截断，前 2 轮上下文保留
4. send_message(A', "换一种实现方式...")
5. A' 继续开发，A 保留为检查点（或丢弃）
```

**我需要的工具：** `list_messages`（要 UUID）, `fork_session`（要支持 `up_to_message_uuid`）

### 场景 3：竹节交接——上下文甜点区自动护航

**流程：**

```
1. 开发会话 B 已经跑了 10 轮，get_session_context 显示 token 用量 52%
2. 接近模型甜点区上限（例如 DeepSeek V4 Pro 甜点区 50-60%）
3. 我决定主动交接：
   ├─ send_message(B, "总结当前进度和关键发现，生成交接简报")
   ├─ fork_session(B) → 新会话 B'
   ├─ send_message(B', 简报 + "继续任务，上下文已压缩")
   └─ B 标记为竹节节点，B' 继续工作
```

**我需要的工具：** `get_session_context`（token 监控）, `fork_session`, `send_message`

### 场景 4：跨工作区协作

**流程：**

```
1. 主项目在"my-app"工作区，需要依赖公共库
2. list_workspaces           → 找到"my-app-libs"工作区
3. create_session(
     channel_id=...,
     model_id=...,
     workspace_id="my-app-libs"  ← 指定工作区
   )
4. send_message(该会话, "在 my-app-libs 里实现这个工具函数...")
5. list_sessions(workspace_id="my-app-libs") → 查看该工作区的所有开发会话
```

**我需要的工具：** `list_workspaces`, `create_session`（支持 `workspace_id`）, `list_sessions`（支持 `workspace_id` 过滤）

### 场景 5：外部工具编排（Claude Code 作为调度中心）

**流程：**

```
1. 在 VS Code 终端开 Claude Code，通过外部 MCP 连接 Proma
2. Claude Code 作为"总指挥"：
   ├─ list_channels → 看有哪些模型可用
   ├─ create_session × 5 → 开 5 条开发会话
   ├─ send_message(并行, wait=false) → 同时派发任务
   ├─ 轮询 get_session_context → 监控进度
   └─ list_messages → 收集结果，汇总报告
```

**我需要的工具：** 外部 MCP stdio server（`proma-session`），所有 10 个工具外部可用

---

## 三、我理想中的使用体验

### 3.1 会话侧边栏

理想状态下，Proma 侧边栏应该显示的不是扁平会话列表，而是**树形结构**：

```
🌳 my-app（根会话，调度中心）
  ├─ 🍎 数据库设计 ✅
  ├─ 🍃 API 接口开发 ⏳
  ├─ 🥀 前端方案v1 ❌（已剪枝）
  │   └─ 🍃 前端方案v2 ⏳
  └─ 🍎 测试用例 ✅
```

每个子会话都能看到：属于哪个父会话 Fork 出来的、当前状态（进行中/完成/失败）、token 用量。

### 3.2 上下文甜点区预警

在会话旁边显示令牌用量百分比，到达阈值时变黄/变红，提醒我主动压缩。

### 3.3 一键交接

点击"竹节交接"按钮 → 自动 Fork → 注入简报 → 新会话继续工作。

---

## 四、当前已通过 MCP 工具实现的能力

所有以下操作都可通过 MCP 工具完成（10 个工具）：

| 操作 | 工具 | 说明 |
|---|---|---|
| 查看可用模型 | `list_channels` | 4 个渠道，30+ 模型 |
| 查看工作区 | `list_workspaces` | 支持跨工作区操作 |
| 查看所有会话 | `list_sessions` | 支持按工作区过滤 |
| 创建开发会话 | `create_session` | 指定渠道/模型/工作区 |
| Fork 重试 | `fork_session` | 支持精确 UUID 截断 |
| 发送任务 | `send_message` | wait=true 返回 Agent 输出 |
| 监控进度 | `get_session_context` | 返回 token 用量和百分比 |
| 查看对话 | `list_messages` | UUID/角色/文本/分页 |
| 会话自指 | `get_my_session_id` | Agent 知道自己的 ID |
| 会话详情 | `get_session_info` | 渠道名/工作区名/附件 |

内部 Agent 间调用已验证：老板→小弟→子小弟三层联动全部通过。

---

## 五、希望 Proma 原生支持的能力

以下是我希望 Proma 未来能原生支持的方向：

1. **树形会话视图**：侧边栏展示 Fork 父子关系，带状态图标
2. **上下文甜点区可视化**：每个会话显示令牌用量进度条
3. **一键竹节交接**：点击按钮自动 Fork + 注入简报
4. **会话间通知**：A 会话完成 → B 会话收到通知（目前可通过 `notify=true` 实现）
5. **附件传递**：创建会话时指定附加文件/目录（工作区 level 的已有，需要暴露到 MCP）
6. **会话模板**：从模板创建会话（预置系统提示词 + 附加文件）

---

*这份文档描述了一个真实用户在使用 Proma 进行 AI Agent 协作开发时的工作流和需求。希望能帮助 Proma 团队理解这类使用场景，并推动相关功能的原生支持。*
