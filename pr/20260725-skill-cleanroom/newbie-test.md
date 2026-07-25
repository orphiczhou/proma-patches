# tree-iterative-development SKILL 洁净室测试报告

**测试日期**: 2026-07-25
**测试者**: 洁净室测试员（零上下文新人视角）
**被测文件**: `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-iterative-development/SKILL.md`

---

## 0. 测试环境（洁净室约束验证）

- ✅ 只读了 SKILL.md 一个文件
- ✅ 未读 CLAUDE.md / .claude/memory / handoff-* / 其他 skill / git 历史
- ⚠️ 当前 workspace_state 显示 MCP 服务器只有：`sequential-thinking`, `github`, `context7`(禁用), `proma-dev-session`(禁用)
- ❌ **skill 依赖的核心 MCP 工具全部不可用**：`mcp__session__*`、`mcp__remote-session__*`、`mcp__tree__*`、`mcp__automation__*` 均不在我的工具列表中

---

## 1. §10 接力会话第一步 — 逐步测试

### Step 1: "读本 skill + CLAUDE.md + .claude/memory/MEMORY.md"

| 项目 | 理解度 | 详情 |
|------|--------|------|
| "读本 skill" | ✅ 清晰 | 就是当前 SKILL.md，已读 |
| "CLAUDE.md" | ⚠️ 模糊 | **skill §10 没说路径**。碰巧在 §9 末尾找到 `C:/Users/sir_c/.proma/agent-workspaces/proma/CLAUDE.md`，但新人要从 §10 跳到 §9 才能发现 |
| ".claude/memory/MEMORY.md" | ❌ 看不懂 | **相对路径，基目录不明**。§10 写 `.claude/memory/MEMORY.md` 但没有绝对前缀。是 workspace 根目录下？还是当前 session cwd 下？§9 写 `.claude/memory/MEMORY.md（长期记忆索引：渠道/陷阱/经验）`，同样没有绝对路径。新人只能猜是 `C:/Users/sir_c/.proma/agent-workspaces/proma/.claude/memory/MEMORY.md` |

**卡点**:
- CLAUDE.md 路径靠 §9 碰巧找到，§10 自身不给路径
- `.claude/memory/MEMORY.md` 是完全相对路径，skill 没有在任何地方给出绝对路径
- 作为洁净室新人，我必须跳过这一步（不能真读 CLAUDE.md 和 memory）

### Step 2: "读最近交接 + 最近 PR + 测试"

| 项目 | 理解度 | 详情 |
|------|--------|------|
| `workspace-files/.context/handoff-*.md` | ⚠️ 模糊 | **相对路径**。§9 写 `workspace-files/.context/handoff-*.md`。新人不知道 `workspace-files/` 相对于哪个根目录。合理猜测是 workspace 根目录下的子目录：`C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/handoff-*.md`。但 skill 从未明确写出这个绝对路径 |
| `D:/Codes/tree-harness/pr/` 最新 | ✅ 清晰 | 绝对路径，`ls` 即可找最新 |
| `tests/` | ⚠️ 模糊 | **相对路径**。§10 写 `tests/`，但没说是相对于哪的。§9 提到 `D:/Codes/tree-harness/tests/`，所以新人需要推断 `tests/` 指的是 tree-harness 下的 tests。但 §10 自身没交代 |

**卡点**:
- handoff 路径不全：`workspace-files/` 基目录需推断
- `tests/` 基目录需从 §9 推断
- handoff 通配符 `*.md` 怎么找？用 `find` 还是 `ls`？skill 没说

### Step 3: "检查实例 + 部署"

| 项目 | 理解度 | 详情 |
|------|--------|------|
| `remote_discover_instances` | ❌ 看不懂 | **工具不在我的列表中**。skill 说用 `mcp__remote-session__remote_discover_instances`，但我的 workspace_state 里没有 `remote-session` MCP 服务器。我根本调不了这个工具 |
| "release/dev/pro 在线？" | ✅ 清晰 | §3 给了端口（19876/19877/19878），语义明白 |
| "dist + SKILL 版本" | ❌ 看不懂 | **没有检查方法**。怎么检查 dist 版本？怎么检查 SKILL 版本？skill 只说"检查"，没说怎么检查。需要 `cat` 某个 version 文件？`grep` 版本号？还是 `git log`？全没说 |

**卡点**:
- `mcp__remote-session__*` 工具不可用（环境缺失）— 这是致命卡点
- "检查部署"操作不可执行：没有给出检查命令或判断标准

### Step 4: "看进行中的 macp"

| 项目 | 理解度 | 详情 |
|------|--------|------|
| "指挥官 + 观察员 session_id" | ⚠️ 模糊 | §10.1 给了 `c7494c62` 和 `27f6346f`。但**这些 session_id 属于哪个工具/系统**？是 `mcp__remote-session__remote_list_messages` 的参数？还是 `mcp__session__list_sessions` 的？新人不知道 session_id 体系的命名空间 |
| `remote_list_messages` | ❌ 看不懂 | **工具不在列表中**。同上，我没 `mcp__remote-session__*` 工具。而且 skill 在 §10 写 `remote_list_messages`（简写），在 §2.2 写 `remote_list_messages` 和 `remote_send_message`，在 §2 表格里写 `remote_create_session(pro)`。这些简写都不匹配标准 MCP 工具名格式 `mcp__server__tool`。新人需要猜 `remote_list_messages` = `mcp__remote-session__remote_list_messages`，但工具名对吗？需要 `mcp__remote-session__remote_list_messages` 还是 `mcp__remote-session__list_messages`？skill 从未给出精确完整工具名 |
| "看进度" | ⚠️ 模糊 | 怎么"看"？`list_messages` 返回什么？拿回来怎么判断进度？skill 没给判断标准 |

**卡点**:
- session_id 的命名空间不明确
- 工具简写和全名映射不清
- `mcp__remote-session__*` 工具不可用

### Step 5: "基于现状定下一步"

| 项目 | 理解度 | 详情 |
|------|--------|------|
| 整步 | ⚠️ 模糊 | skill 给出了选项（继续观察 / 回收评估 / 拉团队改进 / 新一轮 macp），语义上能理解。但**前 4 步都卡死了**，根本到不了第 5 步 |
| "继续观察" | ❌ 看不懂 | 怎么"继续观察"？需要给观察员发消息？用什么工具？发什么内容？ |
| "回收评估" | ❌ 看不懂 | "回收"是什么意思？把观察员结果拿到 release 来？用 `remote_get_messages`？ |
| "拉团队改进" | ⚠️ 模糊 | §5 有流程，但依赖 `mcp__session__create_session`（同样不可用） |

**卡点**:
- 所有决策路径都依赖前 4 步完成，而前 4 步卡死
- 每个选项都没有给出具体执行指令

---

## 2. skill 假设但未说明的知识清单

以下概念/术语在 skill 中被频繁使用，但**从未在新人可理解的范围内给出定义**：

| # | 术语 | 出现次数 | 新人能理解吗？ | 问题 |
|---|------|---------|--------------|------|
| 1 | **macp** | 15+ | ❌ | **skill 核心概念但从未定义**。从上下文猜测是"树形任务实战"的代号，但 macp 是什么的缩写？为什么叫 macp？macp/macp2/macp3 的关系是顺序迭代还是不同项目？ |
| 2 | **星形退化 (star degradation)** | 3 | ⚠️ | §6 略作解释："root 不越级 leaf_add worker"。但具体表现是什么？root 直接加 leaf 会发生什么？为什么叫星形？ |
| 3 | **A/B/C 链** | 5 | ❌ | §1.1 提到"3 层树 A/B/C 链"，§7 提到"B 链（judge）"、"A/C 链（GLM）"。这些"链"是 tree 的分支？还是消息链路？还是角色链（coder/judge）？从 §1.1 "coder/judge 接 LLM（3 层树 A/B/C 链）"大概猜到 coder 是 A 链、judge 是 B 链，但 C 链是什么？从来没有解释 |
| 4 | **tree-harness** | 频繁 | ⚠️ | §9 给了路径 `D:/Codes/tree-harness/`。知道在哪，但不知道它是什么（引擎补丁项目？测试框架？） |
| 5 | **multi-agent-collab-platform** | 多次 | ⚠️ | §9 给了路径 `D:/Codes/multi-agent-collab-platform/`。知道在哪，但不清楚它跟 tree-harness 的关系（tree-harness 改造 Proma 引擎、collab-platform 是用引擎的项目？） |
| 6 | **Proma 实例颜色** | 3 | ❌ | §3 说 release=Proma-blue, dev=white, pro=green。这些颜色是什么？UI 中的主题色？只是视觉标识？新人无法验证 |
| 7 | **ISOLATED=1** | 2 | ❌ | §3 说 `PROMA_INSTANCE_ISOLATED=1`。这是什么环境变量？起什么作用？为什么需要？ |
| 8 | **Gap B** | 1 | ❌ | §11 #7 提到"Gap B 等历史内容"。Gap B 是什么？在哪？ |
| 9 | **DeepSeek 渠道 id** | - | ⚠️ | §2.1 给了完整 UUID `56ecefd2-8e22-4c62-add5-16e8992c987d`，有渠道名 DeepSeek 官方。新人能直接用这个 id 吗？这个 id 在哪个工具里用？create_session 的 channelId 参数？skill 没说参数名 |
| 10 | **Drift** | 3 | ⚠️ | §1.1 "24 次失败零 drift"，§6 "P1-3 drift 自动记录"。drift 是错误日志？是偏差报告？是 tree 系统的某种 event？概念模糊 |
| 11 | **PENDING_ROOT** | 1 | ❌ | §6 P0-B "消 PENDING_ROOT 死锁"。PENDING_ROOT 是什么状态？怎么造成的？ |
| 12 | **comm_log** | 3 | ⚠️ | §1.1 "communication_log"、§6 "comm_log 硬 checklist"。从上下文猜是记录 send_message 的日志，但怎么记？用 `mcp__tree__tree_log_communication`？ |
| 13 | **audit_gate** | 1 | ❌ | §7 "补 audit_gate 全 skip 漏洞"。audit_gate 是审计门禁？是 tree 系统的一个机制？从未解释 |
| 14 | **leaf / leaf_add / cmdInit / cmdEventAppend** | 多次 | ❌ | 这些是 tree 引擎的内部 API。skill 直接引用但**假定读者已读完 tree-commander + tree-worker skill**。新人只看本 skill 完全不懂 |
| 15 | **§13.4.6 fix leaf 闭环** | 2 | ❌ | 引用 tree-worker skill 的某个章节。新人没有 tree-worker skill，完全不知道这是什么 |
| 16 | **sprint** | 1 | ⚠️ | §5.1 "下个 Sprint"。大概知道是迭代周期，但这是项目的 sprint 还是随意说的？ |

---

## 3. 引用但路径不全/不存在的文件

| # | skill 引用的路径 | skill 中写法 | 绝对路径（新人推测） | 问题 |
|---|-----------------|-------------|-------------------|------|
| 1 | `.claude/memory/MEMORY.md` | §10 步骤1, §9 | `C:/Users/sir_c/.proma/agent-workspaces/proma/.claude/memory/MEMORY.md`（推测） | **相对路径无基目录**。skill 从未写绝对路径。而且 session cwd 下也有 `.claude/` 可能，易混淆 |
| 2 | `workspace-files/.context/handoff-*.md` | §10 步骤2, §9 | `C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/handoff-*.md`（推测） | 同上。`workspace-files/` 基目录需推断 |
| 3 | `tests/` | §10 步骤2 | `D:/Codes/tree-harness/tests/`（从 §9 推断） | §10 自身不交代基目录 |
| 4 | `06_TESTS/macpN-tree-evaluation` | §1, §5 | `D:/Codes/multi-agent-collab-platform/06_TESTS/`（从 §9 推断） | 同上 |
| 5 | `tree-commander SKILL v2.9.2` | §0, §6 | `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（从 §9 推断） | skill 引用其他 skill 的章节（如"SKILL §4 Step2.1"），但新人没有这些 skill |
| 6 | `tree-worker SKILL v2.6` | §0, §6 | `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-worker/SKILL.md`（从 §9 推断） | 同上 |
| 7 | `tree-auditor SKILL v1.0` | §0 | 同上 | 同上 |
| 8 | `CLAUDE.md` | §10 步骤1, §9 | `C:/Users/sir_c/.proma/agent-workspaces/proma/CLAUDE.md`（从 §9 推断） | §10 自身不给路径 |
| 9 | `~/.proma-pro/agent-workspaces/default/skills/` | §4.1, §9 | `C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/`（推测 ~ = C:/Users/sir_c/） | `~` 在 Windows 上的含义 skill 未说明 |

---

## 4. 各节卡点详录

### §0 元数据
- ✅ 版本号、日期、based_on 都清楚
- ⚠️ `related` 列了 3 个 skill，但新人没有这些 skill，不知道它们的内容
- ⚠️ workspace 路径给了绝对路径，好

### §1 迭代开发闭环
- ❌ **"macp" 从未定义** — 这是最严重的遗漏。新人从第一行就卡住
- ❌ 闭环图里 "06_TESTS/macpN-tree-evaluation" 路径不完整（无基目录）
- ❌ "派子会话或父会话" — 用什么工具派？skill 此时还没介绍
- ⚠️ §1.1 表格里的 P0-1/P1-3 等只有到 §6 才解释，但读者不知道要跳到 §6

### §2 角色与子会话
- ❌ **工具名不一致**：skill 描述里写 `mcp__session__* / mcp__remote-session__*`，但正文里用 `remote_create_session(pro)`、`mcp__session__create_session`。全名和简写混用，新人不知道对应关系
- ❌ `remote_create_session(pro)` — `pro` 是参数名还是参数值？完整调用是 `mcp__remote-session__remote_create_session({instance: "pro"})` 还是别的？
- ❌ **我的 MCP 工具列表里没有 `mcp__session__*` 或 `mcp__remote-session__*`**。这是一个致命的环境问题
- ✅ §2.1 渠道表有用，给了完整 UUID
- ⚠️ §2.1 "claude 渐变" — 这是什么意思？Claude 模型逐渐被替代？
- ⚠️ §2.2 send_message busy 处理：操作指南清晰，但 `remote_send_message` 完整工具名不明

### §3 实例管理
- ✅ 端口号给全了
- ✅ 启动脚本路径给了
- ❌ "Proma-blue/white/green" 颜色含义不解释
- ❌ "ISOLATED=1" 不解释
- ⚠️ "~/.proma" — `~` 在 Windows 上是什么？
- ❌ `mcp__remote-session__remote_discover_instances` 工具不可用

### §4 PR 流程
- ✅ 7 步清晰，路径都是绝对路径（大部分）
- ⚠️ §4.1 "sed 补丁（apply-patches.sh）或直接 sed dist（CLAUDE.md 允许）" — 引用了 CLAUDE.md 但没有告知具体允许什么
- ⚠️ `~/.proma-pro/...` 相对路径问题同上
- ✅ `export PATH="/c/Program Files/nodejs:$PATH"` 给了完整命令
- ⚠️ "cp source" "restart" — 没有给出具体命令

### §5 改进方案制定
- ❌ `06_TESTS/macpN-tree-evaluation` 路径不全
- ⚠️ "AskUserQuestion 给用户选" — 语义清楚，但 AskUserQuestion 工具怎么调、options 格式什么样，skill 没教
- ✅ 改进 vs 项目边界清晰

### §6 关键约束
- ❌ **大量引用其他 skill**："SKILL §4 Step2.1"、"SKILL §13.4.0"、"SKILL §3.4 final_step + worker §1 #10"、"SKILL §4 Step3 + §11 #15"、"§13.4.6 fix leaf 闭环"。新人没有这些 skill，无法理解
- ⚠️ 约束名称（P0-1/P0-A 等）在 §1.1 表中首次出现，但含义要到 §6 才解释。阅读顺序不友好
- ❌ "星形退化"、"PENDING_ROOT"、"drift"、"leaf"、"cmdInit" 等术语不解释
- ⚠️ "引擎软约束 + SKILL §4 Step2.1" — 双重引用（引擎 + SKILL），新人都看不懂

### §7 多源模型审计
- ✅ 核心理念（多模型避免同质化）表述清晰
- ❌ "B 链（judge）"、"A/C 链"、"C1 量化" 概念来自 §1.1 但从未充分解释
- ⚠️ "audit_gate 全 skip 漏洞" — 什么是 audit_gate？什么是 skip 漏洞？

### §8 复用优先
- ✅ 路径清晰，策略明确
- ⚠️ `mcp__proma_cloud__get_credentials` — 这个工具在我的列表里！但 `runAgentHeadless` / `createSession` 这些内部 API 新人怎么调用？没有文档
- ⚠️ "sandbox/snapshot/router 已真实成熟（macp2 确认）" — macp2 确认了什么？新人不清楚

### §9 文件索引
- ✅ 大部分路径是绝对路径，好
- ❌ `.claude/memory/MEMORY.md` — 无绝对路径
- ❌ `workspace-files/.context/handoff-*.md` — 无绝对路径
- ⚠️ "指令 + 记忆" 小节标题笼统，三个条目没有说明它们各自的作用和关系

### §11 常见陷阱
- ✅ 大部分陷阱有清晰的原因 + 解决方案
- ❌ #7 "Gap B 等历史内容" — Gap B 未定义
- ❌ #7 "§13.4.6 fix leaf 闭环" — 引用其他 skill
- ⚠️ #3 push 报 lock 错 — 给了验证命令，好，但没给完整 git 命令示例

---

## 5. 改进建议（按优先级排序）

### 🔴 P0 — 致命：新会话无法起步

| # | 建议 | 涉及章节 |
|---|------|---------|
| **P0-1** | **定义 "macp"**：在 §1 开头加一句 "macp = Multi-Agent Collaboration Platform 树形实战（代号），每轮 macp 是一次完整端到端的树形任务执行+评估+改进迭代"。这是全文最核心的术语，但从未定义 | §1 |
| **P0-2** | **§10 每步补绝对路径**：步骤 1 写 `CLAUDE.md` → 改为 `C:/Users/sir_c/.proma/agent-workspaces/proma/CLAUDE.md`；步骤 1 写 `.claude/memory/MEMORY.md` → 补全绝对路径；步骤 2 写 `tests/` → 改为 `D:/Codes/tree-harness/tests/`。新人不应该需要跳到 §9 去拼路径 | §10 |
| **P0-3** | **统一工具名**：全文统一使用完整 MCP 工具名格式 `mcp__server__tool`。在 §0 或 §2 开头加一个"工具名速查表"，列出每个简写对应的完整工具名及关键参数：(1) `remote_create_session(pro)` → `mcp__remote-session__remote_create_session({instance: "pro"})` (2) `remote_list_messages` → `mcp__remote-session__remote_list_messages({sessionId})` (3) `remote_send_message` → `mcp__remote-session__remote_send_message({...})` (4) `mcp__session__create_session` → 完整参数 | §2, §10 |
| **P0-4** | **加"前置依赖"小节**：在 §0 或 §10 前明确列出：(a) 本 skill 需要哪些 MCP 服务器（remote-session, session, tree, automation）(b) 如何验证这些 MCP 工具可用（检查 workspace_state）(c) 如果不可用该怎么办（联系用户启用？退而用什么？） | §0 或 §10 |

### 🟡 P1 — 重要：能起步但会反复卡住

| # | 建议 | 涉及章节 |
|---|------|---------|
| **P1-1** | **解释核心概念**（新人词汇表）：在 §1 或独立小节中加一个"术语表"：(a) A/B/C 链是什么（coder 链 / judge 链 / ？）(b) 星形退化是什么（root 越过 commander 直接给 worker 发 leaf_add）(c) drift 是什么（tree 系统的可恢复错误自动记录）(d) PENDING_ROOT 是什么（tree 初始化时 root 节点等待确认的状态）(e) Gap B 是什么 | §1, §6, §11 |
| **P1-2** | **§10 步骤 3 "检查部署"给可执行命令**：不要只说"检查 dist + SKILL 版本"，给出：(a) `cat D:/Proma-dev/resources/app/dist/tree-engine.cjs | head -5` 看版本注释 (b) `diff D:/Codes/tree-harness/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs` 看是否同步 (c) 检查 SKILL 版本的命令 | §10 |
| **P1-3** | **§10 步骤 4 "看进度"给出判断标准**：不要只说"看进度"，给出：(a) 调 `remote_list_messages` 拿最近 N 条消息 (b) 在消息中找什么关键字（done / blocked / error / milestone）(c) 如何判断指挥官/观察员是否卡住 | §10 |
| **P1-4** | **§10 步骤 5 每个选项给具体指令**：(a) "继续观察" → 用什么工具给观察员发什么 (b) "回收评估" → 用 `remote_get_messages` 把观察员的改进建议拉回 release (c) "拉团队改进" → 跳到 §5 执行 (d) "新一轮 macp" → 跳到 tree-commander skill | §10 |
| **P1-5** | **§6 不要引用其他 skill 的具体章节号**：改为在 §6 内直接写约束内容和执行方法，而不是 "SKILL §4 Step2.1 已教"（新人没那些 skill）。或者在最前面加一句 "本 skill 假设你已加载 tree-commander 和 tree-worker skill；如果没有，先去加载它们" | §6 |
| **P1-6** | **§4.1 部署给完整命令示例**：不要只说 "cp 整文件"，给具体的 `cp` 命令（源 → 目标），给具体的 restart 命令 | §4.1 |

### 🟢 P2 — 改善体验

| # | 建议 | 涉及章节 |
|---|------|---------|
| **P2-1** | **§2.2 send_message busy 处理给完整工具名**：`remote_send_message` → `mcp__remote-session__remote_send_message`，`remote_list_messages` → 完整名 | §2.2 |
| **P2-2** | **§3 解释颜色和 ISOLATED**：加一句 "Proma-blue/white/green 是实例在 Proma 界面的主题色，用于视觉区分；ISOLATED=1 防止实例互相干扰" | §3 |
| **P2-3** | **§2.1 渠道表加"如何使用"**：加一列 "在 create_session 中的参数名"（如 `channelId`），让新人知道这个 UUID 填到哪里 | §2.1 |
| **P2-4** | **§9 所有相对路径补绝对前缀**：`.claude/memory/MEMORY.md` → 补全；`workspace-files/.context/` → 补全 | §9 |
| **P2-5** | **§11 #7 解释 Gap B**：加一句 "Gap B = tree-commander skill 中的 §Gap B 章节，包含历史遗留的引擎行为描述" | §11 |
| **P2-6** | **§5 AskUserQuestion 给参数示例**：`AskUserQuestion({questions: [{question: "选方案", options: [{label: "A 全做"}, {label: "B 只 P0"}]}]})` | §5 |
| **P2-7** | **阅读顺序优化**：§1.1 表格中的 P0-1 等代码，在旁边加 `→ 见 §6` 引导读者知道后面有解释 | §1.1 |

---

## 6. 总结

**洁净室测试结论**：一个零上下文新人拿到 `tree-iterative-development/SKILL.md`，**无法独立完成 §10 的 5 步接力流程**。

主要原因（按严重程度）：
1. **环境不满足**：skill 依赖 `mcp__session__*` 和 `mcp__remote-session__*` 工具，但新会话的 workspace_state 中没有这些 MCP 服务器
2. **核心术语未定义**：macp、A/B/C 链、星形退化等贯穿全文的概念从未被解释
3. **路径不完整**：多个关键文件路径是相对的，新人需要猜测基目录
4. **操作不可执行**：多处只说"做什么"不说"怎么做"（检查部署、看进度、定下一步）
5. **跨 skill 引用断裂**：大量引用 tree-commander/worker skill 的章节，新人没有这些 skill

**亮点**：PR 流程（§4）、文件索引（§9 大部分）、常见陷阱（§11 大部分）给了绝对路径和可操作的指令，这些部分是 skill 最强的部分。
