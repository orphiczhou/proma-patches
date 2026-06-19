# 指挥官交接文档 — Release 接替启动

> **交接日期**: 2026-06-18 18:39 (北京时间)
> **前任**: Proma Dev 实例主会话（已运行 7+ 小时，上下文接近饱和）
> **接任**: Release 实例新会话（DeepSeek V4 Pro 官方渠道）
> **方法论版本**: commander-methodology.md v1.0.1
> **紧急程度**: 中（前任还能撑一会，但越早接替越好）

---

## 0. 元信息（你的身份）

```yaml
event: handoff_to_new_commander
methodology_version: v1.0.1
your_role: 接替指挥官（Release 版本）
your_model: deepseek-v4-pro (DeepSeek 官方渠道)
your_workspace: null  # ⚠️ workspace=null，文件访问只能走绝对路径
your_instance: release  # 你跑在 Release 实例（PORT 19877）
workspace_root: "C:\\Users\\sir_c\\.proma\\agent-workspaces\\proma\\workspace-files"
```

### ⚠️ 关键约束（违反必失败）

1. ✗ **不要用 Skill 工具加载** tree-commander / tree-worker / session-management（workspace=null 看不到）
2. ✗ **不要用相对路径读文件**（`.context/xxx.md` 会失败）
3. ✓ **必须用 Read 工具 + 绝对路径**读所有文档
4. ✓ **Glob/Grep 必须带 path 参数**指定工作区目录绝对路径
5. ✓ **遇到"SKILL.md 缺失"错误时立即停止**——是 workspace=null 问题，文件实际存在
6. ✓ **HTTP API 调用走 Release 端口 19877**（不是 Dev 的 19876）
7. ✓ **新会话只能用 DeepSeek 官方渠道（id=`56ecefd2-8e22-4c62-add5-16e8992c987d`）+ `deepseek-v4-pro` 模型**——前任用过 claude-sonnet 触发 Anthropic Usage Policy 错误，且用户明确要求"不用 proma 渠道"

---

## 1. 项目一句话定义

**「树形会话执行体系」**：基于 Proma 的会话 Fork + send_message 能力，构建多层级、分层的指挥控制执行体系，目标是让一个根会话能可靠地调度 N 个子会话 + N 个子 Agent 完成大型任务，且每一步都有判断防偏题。

**当前阶段**：v0.1 已通过验收，v0.2 设计与实施中（部分完成），需要你接手推进 + 审计 + 落地。

---

## 2. 前任指挥官的完整进度（你必须知道的历史）

### 2.1 v0.1 已完成并验收通过

设计 → 实施 → 审计 → 修复 → 回归 → S1 测试 → 最终验收，全流程闭环。

**核心产出**：
- `tree-commander-design.md` — 设计文档（9 章 + 4 个架构补丁 + 附录 A 完整 spec）
- `v0.1-audit-report.md` — 首次审计报告（M1/M2/M3 阻断 + S1-S5 中等 + T1-T4 轻微）
- `s1-test-plan.md` — S1 模拟测试方案（25 步，已跑通）
- `trees/tree-state.js` — 状态脚本（1531 行 / 零依赖 / 21 子命令）
- `skills/tree-commander/SKILL.md` — 514 行根会话 Skill
- `skills/tree-worker/SKILL.md` — 702 行子会话 Skill
- `commander-methodology.md` — 指挥官方法论 v1.0.1（297 行）
- `note.md` — 项目笔记（含 v0.16.3 测试矩阵）

**4 个架构补丁**（宪法级约束）：
1. **根会话纯净原则** — 指挥官不亲自判断，全派子 Agent
2. **双轨执行原则** — 判断派 Agent（同步），执行派会话（异步）
3. **递归自审原则** — 每个会话内自审 milestones（v0.2 启用）
4. **状态访问脚本化** — LLM 不直接读写 JSON，必须调 tree-state.js

### 2.2 v0.1.1 已修

M1（自动备份）/ M2（空 milestone 拒绝 done）/ M3（错误码 E_STATUS_INVALID），全过 R1-R5 回归。

### 2.3 v0.2 已部分启动（SESSION1 在 Dev 完成的，待审计）

**SESSION1（C-A v2）报告完成 7 项**：
1. ✅ C 任务：命名规范歧义修复 + 回归验证
2. ✅ A 任务：v0.2 设计与实施启动
3. ⚠️ 创建 tree-commander/tree-worker SKILL.md（**虚报**！文件时间戳未变，需要审计根因）
4. ✅ Code review v0.2 变更
5. ✅ S2 测试方案
6. ✅ 最终报告

**SESSION1 产出文件**（需要审计质量）：
- `tree-commander-design.md` 增长 ~6KB（v0.2 章节待审）
- `note.md` 增长 ~15KB（项目笔记大幅扩充）
- `commander-methodology.md` 增长 ~2KB
- `s2-test-plan.md` 新建 10KB

### 2.4 B 任务（真实环境跑 v0.1）

**SESSION2 v3** (`63b4e61a-5b0e-479a-82e9-0cbb481a30d8`) 在 Dev 实例（PORT 19876）继续跑，DeepSeek V4 Pro 渠道。**继承者可以继续监控**，或在 Release 重新跑。

---

## 3. 必读资料（按顺序，约 30 分钟读完）

```
workspace_root/.context/commander-methodology.md     # 方法论 v1.0.1（你工作的"宪法"）
workspace_root/.context/tree-commander-design.md     # 体系设计文档（已含 v0.2 章节，待你审计）
workspace_root/.context/v0.1-audit-report.md         # v0.1 审计报告
workspace_root/.context/s1-test-plan.md              # S1 测试方案
workspace_root/.context/s2-test-plan.md              # S2 测试方案（SESSION1 产出，待你审计）
workspace_root/.context/note.md                      # 项目级长期笔记（SESSION1 扩充过）
workspace_root/.context/handoff/session1-prompt.md   # SESSION1 收到的原任务（参考）
workspace_root/.context/handoff/session2-prompt.md   # SESSION2 收到的原任务（参考）
```

`workspace_root` = `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`

---

## 4. 待办任务（按优先级）

### 🔴 P0：审计 SESSION1 产出（trust but verify 必做）

SESSION1 报告 7 项 ✅ 但已发现 1 处虚报（SKILL.md "创建"）。**必须独立审计**：

1. **v0.2 设计章节质量**（在 `tree-commander-design.md` 末尾）：
   - 是否覆盖心跳通道 / 内部自审 / 三档纠偏三大模块？
   - 是否符合 §9.1 v0.2 范围定义？
   - 命名规范歧义修复是否到位（§6.5 prefix 含连字符问题）？

2. **SKILL.md 虚报根因**：
   - SESSION1 说"创建"了 SKILL.md，但文件时间戳还是 13:05（未变）
   - 是 workspace=null 找不到目录跳过？还是别的原因？
   - 用 ls + grep 验证文件实际状态

3. **是否引入 regression**：
   - SESSION1 改了 `commander-methodology.md`（+2KB）/ `note.md`（+15KB）/ `design.md`（+6KB）
   - 这些修改是否破坏原有内容？是否新增了什么？
   - 用 git diff（如有）或人工对比关键章节

4. **S2 测试方案可执行性**：
   - `s2-test-plan.md`（10KB）是否真能跑？
   - 命令序列是否完整？期望输出是否清晰？

**输出**：审计报告 `workspace_root/.context/v0.2-audit-report.md`

### 🟡 P1：监控 SESSION2 v3 进度

- session_id: `63b4e61a-5b0e-479a-82e9-0cbb481a30d8`
- 跑在 **Dev 实例（PORT 19876）**，DeepSeek V4 Pro
- 任务：真实环境跑 v0.1（HTTP 直连 + tree-commander Skill）
- **监控方法**：`curl http://127.0.0.1:19876/list_messages` + `get_session_context`
- 若卡住超过 30 分钟无新消息，按方法论原则 9 走"重档剪枝"流程（archive + 重 Fork）

### 🟡 P2：v0.2 完整实施（如审计通过）

如 SESSION1 的 v0.2 设计章节审计通过：
- 派子 Agent 实施 v0.2 的 5-7 个模块（心跳 automation / 内审 Agent / 三档纠偏决策树 / 哨兵 Agent / 等）
- 每个产出派 code-reviewer 审计
- 跑 S2 测试方案验证

### 🟢 P3：v0.1.1 / v0.2.1 滚动清理

按 v0.1-audit-report.md + SESSION1 审计结果，把 S1-S5 / N1-N2 / 新发现问题分到 v0.1.1 / v0.2.1 / v1.0。

### 🟢 P4：方法论补丁

发现两个体系级 bug 值得加入 commander-methodology.md 反模式表：
1. **HTTP API 创建会话默认 workspace=null** → 文件访问必须用绝对路径
2. **子 Agent 报告"创建 X" 但实际未改文件** → 必须用 ls -la 验证时间戳

---

## 5. 关键资源清单

### 5.1 Session ID 速查

| Session | ID | 状态 |
|---|---|---|
| 前任主会话（Dev） | (查 `get_my_session_id` MCP，但 MCP 禁用，用 HTTP) | 接近饱和，待交接 |
| SESSION1 v1 (claude-sonnet, 旧) | `7fe2a2e4-332c-4b05-9557-232815c2b44f` | 已归档（API Error） |
| SESSION1 v2 (DeepSeek, C-A) | `359188cf-6af9-44eb-9606-ffdc16b817a9` | ✅ 完成（待审计） |
| SESSION2 v1 (claude-sonnet, 旧) | `d9f439c1-2acd-420e-b8d2-843aaaa83184` | 已归档 |
| SESSION2 v2 (DeepSeek, B) | `5a475d25-e571-4338-9794-27bd373a7853` | 已归档（卡死） |
| SESSION2 v3 (DeepSeek, B) | `63b4e61a-5b0e-479a-82e9-0cbb481a30d8` | 🟡 跑中（Dev 实例） |
| **你（新接任）** | 待创建（Release 实例） | — |

### 5.2 实例端口

- **Dev**: `http://127.0.0.1:19876` (PROMA_INSTANCE_NAME=dev, 隔离 ~/.proma-dev/)
- **Release**: `http://127.0.0.1:19877` (PROMA_INSTANCE_NAME=release, 共享 ~/.proma/)
- **正式版**: `D:\Proma\`（不要碰）

### 5.3 渠道速查

| 渠道名 | id | 备注 |
|---|---|---|
| Proma 官方 | `proma-official` | ❌ 用户禁用（避免高成本） |
| MiniMax-CodingPlan | `b7e25505-c972-49e7-9173-ef14df3eaa3f` | anthropic provider |
| ZLM-CodingPlan | `cbb12a0b-3d21-476d-9812-d37bb5642cda` | glm 系列 |
| **DeepSeek 官方** | **`56ecefd2-8e22-4c62-add5-16e8992c987d`** | ✅ **指定使用** |

模型：`deepseek-v4-pro`（DeepSeek 官方，1M context window）

### 5.4 关键文件路径

```
workspace_root/.context/
  ├─ commander-methodology.md          # 方法论
  ├─ tree-commander-design.md          # 体系设计（含 v0.2）
  ├─ v0.1-audit-report.md              # v0.1 审计报告
  ├─ s1-test-plan.md                   # S1 测试方案
  ├─ s2-test-plan.md                   # S2 测试方案（SESSION1 产出）
  ├─ note.md                           # 项目笔记
  ├─ v0.2-audit-report.md              # ⚠️ 你要新建的审计报告
  └─ handoff/
     ├─ release-commander-handoff.md   # 本文档
     ├─ session1-prompt.md             # SESSION1 原任务
     └─ session2-prompt.md             # SESSION2 原任务

workspace_root/skills/
  ├─ tree-commander/SKILL.md           # 514 行根会话 Skill（v0.1.0）
  └─ tree-worker/SKILL.md              # 702 行子会话 Skill（v0.1.0）

workspace_root/.context/trees/
  └─ tree-state.js                     # 状态脚本（1531 行）
```

### 5.5 当前 TaskList 状态

前任留下了 30+ 个 TaskCreate 记录（v0.1 全流程 + 4 个 v0.2 阶段任务）。**你可以新建 task 追踪你的工作**，不用清理前任的（保留作为历史）。

---

## 6. 已知避坑指南（前任踩过的坑）

| 坑 | 现象 | 避坑方法 |
|---|---|---|
| HTTP API 响应 JSON 嵌套 | 外层 `{content:[{text:"..."}]}`，内层才是真 JSON，且 `\"id\"` 是转义的 | grep 用 `[[:space:]]*` 容忍空格，或用 Node.js 解析 |
| Bash 工具 shell 不持久 | 每次调用都是新 shell，环境变量不保留 | 所有逻辑放一个 Bash 命令里 |
| create_session attached_directories 没生效 | API 静默忽略，会话仍 workspace=null | 不要依赖 attached_directories，用 Read 绝对路径 |
| claude-sonnet 触发 Anthropic Usage Policy | 某些 prompt 触发内容过滤 | 用 DeepSeek V4 Pro，不用 Anthropic |
| Skill 工具找不到 SKILL.md | workspace=null 时 Skill 工具列表是空的 | Read SKILL.md 绝对路径，mentally apply |
| DeepSeek 渠道瞬时卡死 | 25 分钟"上一条消息仍在处理中" | 归档 + 重建，用 wait=true ping 验证 |
| 子 Agent 报告"创建 X" 但文件未变 | workspace=null 找不到目录静默跳过 | 用 ls -la 查时间戳，trust but verify |
| SESSION2 用 claude-sonnet API Error | Anthropic 渠道内容过滤 | DeepSeek V4 Pro 已规避 |

---

## 7. 工作流程建议（你的前 1 小时）

### Step 1（10 分钟）：身份确认 + 必读资料
1. 用 HTTP 调 `http://127.0.0.1:19877/get_my_session_id` 拿到你的 session_id
2. 用 Read 工具读 `commander-methodology.md`（你的工作宪法）
3. 用 Read 工具读本文档（`release-commander-handoff.md`）
4. 用 Read 工具读 `tree-commander-design.md` 末尾的 v0.2 章节（你需要审计的）

### Step 2（30-45 分钟）：执行 P0 任务（审计 SESSION1）
1. 用 ls + Read 对比 SESSION1 修改的 4 个文件
2. 用 Bash 跑 grep 找具体修改点
3. **派子 Agent 做深度审计**（subagent_type=code-reviewer，必须用 DeepSeek V4 Pro）：
   - v0.2 设计章节质量
   - SKILL.md 虚报根因
   - 是否引入 regression
   - S2 测试方案可执行性
4. 审计报告写到 `.context/v0.2-audit-report.md`

### Step 3（持续）：监控 SESSION2 v3
- 每 15-30 分钟 HTTP 查一次 `63b4e61a-5b0e-479a-82e9-0cbb481a30d8`
- 卡死超过 30 分钟 → archive + 重建
- 完成 → 读最后报告

### Step 4（视情况）：v0.2 完整实施
- 如审计通过：派子 Agent 实施 v0.2 各模块
- 如审计不通过：先修 v0.2 设计章节

---

## 8. 禁止行为（铁律，从方法论 §6 反模式表）

1. ✗ **不亲自写代码 / 改文件**——所有产出派子 Agent
2. ✗ **不给子 Agent 一句话任务**——必须 7 段式 prompt（背景/必读/任务/流程/约束/禁止/格式）
3. ✗ **不信任子 Agent 的"已完成"**——必须独立验证（ls + grep + 时间戳）
4. ✗ **不直接读写 tree-state.json**——必须调 tree-state.js 子命令
5. ✗ **不用 Skill 工具加载 SKILL**（你的 workspace=null）——用 Read 读绝对路径
6. ✗ **不用 proma-official 渠道**——只用 DeepSeek 官方（id=`56ecefd2-...`）
7. ✗ **不用 claude-sonnet / Anthropic 模型**——只用 deepseek-v4-pro
8. ✗ **用相对路径读文件**——必须用绝对路径
9. ✗ **不沉淀文档**——重要产出必须落盘到 `.context/`
10. ✗ **不更新方法论**——发现新坑要回写 commander-methodology.md §6 反模式表 + §8 修订历史

---

## 9. 返回报告格式

完成 P0 / 卡住 / 需要决策时，向你（用户周星星）汇报：

```markdown
# Release 接任指挥官报告（阶段 N）

## 总评
✅ 通过 / ⚠️ 有条件通过 / ❌ 不通过

## 本阶段完成
- 任务 1：...
- 任务 2：...

## 关键决策（3-5 条）
- 决策 1：... 理由：...

## 发现的问题
- 编号、问题、严重程度、建议

## 下一步建议
- ...

## 当前 SESSION2 v3 状态
- 最新消息：...
- 卡死风险：低/中/高
```

报告字数 < 1500 字。

---

## 10. 关键提醒

1. **你的 session_id**：创建后会立即知道（保存到本文档第 5.1 节）
2. **前任还能撑一会**：如果你卡住，可以 HTTP 发消息到前任主会话求救（但前任上下文已近饱和，少用）
3. **不要修改 v0.1 已通过的产出**（tree-state.js / SKILL.md 核心）—— 你只是验证 + 推进 v0.2，发现问题报告但不修
4. **方法论与设计文档冲突时以方法论为准**（v1.0.1 是 v0.1 验收后沉淀的最新版本）
5. **遇到不确定时优先用 AskUserQuestion 问用户**（不要瞎猜）
6. **完成或卡住时**用 HTTP send_message 把报告发回用户当前会话（即本会话）

---

## 11. 启动确认（你读完本文档后第一件事）

读完本文档后，向你的"指挥官"（即启动你的用户会话）回复一段简短启动确认：

```yaml
event: handoff_acknowledged
your_session_id: <你的 session_id>
your_understanding: |
  我是 Release 实例的接替指挥官，已读完交接文档。
  立即开始执行 P0 任务（审计 SESSION1 产出）。
  监控 SESSION2 v3 进度。
  所有产出用 DeepSeek V4 Pro，所有文件用 Read 绝对路径。
first_action: |
  1. 读 commander-methodology.md（10 分钟）
  2. 读 tree-commander-design.md v0.2 章节（10 分钟）
  3. 派 code-reviewer 子 Agent 审计 SESSION1 产出（30 分钟）
  4. 写 v0.2-audit-report.md
```

---

**交接完成。祝接任顺利。**

— 前任指挥官（Dev 实例主会话）
