# 树形会话执行体系 — 完整设计文档

> **版本**: v1.3 (2026-06-19)
> **项目**: Proma 改造探索 / Layer 2 指挥控制层
> **作者**: 周星星 + Proma Agent
> **状态**: 设计完成，待 v0.1 实施
> **下一步**: 按 §9 MVP 路线落地

---

## 0. 元原则（指导整个体系的两条根本信念）

1. **工程化的本质 = 把复杂问题拆成大模型能"手拿把掐"的高可靠执行片段。**
2. **命令遵循度的核心 = 每一步都有判断。**

任何与本体系冲突的设计，都回到这两条原则上来裁决。

---

## 1. 四个架构补丁（设计过程中沉淀的硬约束）

这四条补丁是体系的"宪法"，所有后续设计不得违背。

### 补丁 1：根会话纯净原则（Root Purity Principle）

```text
根会话上下文里只能有三类东西：
  ① 树状态（tree-state.json 的内存映射）
  ② 路由决策（"事件 X 派给哪个 Agent 处理"）
  ③ 索引（"哪些会话正在为哪些子任务服务"）

任何「判断」工作（评估、审计、决策、质量打分、plan 审批、纠偏判定）
都必须委托给专门的子 Agent 或子会话执行。根会话只是「会议主持人 + 调度器」。
```

**为什么**：根会话一旦亲自判断，上下文会被细节淹没，迅速进入自己的甜点危机。委托 = 上下文隔离。

### 补丁 2：双轨执行原则（Two-Track Execution）

```text
判断轨 → 子 Agent（Agent 工具）
  用途：评估、审计、决策、纠偏判定、plan 审批、心跳判定、路线图对齐
  特性：同步返回、任务完即销、上下文隔离、根会话直接拿 verdict
  工具：Agent(subagent_type=...)

执行轨 → 子会话（fork_session / create_session）
  用途：写文档、跑代码、长任务、需要持久上下文的实际产出
  特性：异步通信、有历史、能跨消息累积、竹节交接延续
  工具：fork_session + send_message(notify)

根会话只做「路由」——判断派给 Agent，执行派给会话。
```

**为什么不能混用**：判断是短任务（秒级~分钟级），执行是长任务（分钟级~小时级）。混用会让会话爆炸或 Agent 等待成本失控。

### 补丁 3：递归自审原则（Recursive Self-Audit）

```text
每个会话（根/子/孙，所有层级）在执行任务时必须：

  拆解任务 → 列出里程碑 M1, M2, M3, ...
  对每个 Mi:
    1. 执行产出
    2. Fork 内部审计 Agent（subagent_type=code-reviewer）做对齐校验
       输入：当前 Mi 产出 + 自己的 brief/dod
       输出：{ alignment: 0-100, gaps: [...], severity }
    3. severity == low → 通过，进入 M(i+1)
       severity ≥ mid → 自纠，重新审计，最多 2 次
       2 次后仍 mid+ → 标 drift，上报时主动声明
    4. 所有 Mi 完成后做 final 自审 → 输出 self_check
```

**为什么**：外部纠偏是事后的（已偏才纠正），内部纠偏是事中的（执行过程中就自查）。两层叠加 = 每一步都有判断 = 累计偏差可控。

### 补丁 4：状态访问脚本化（Scripted State Access）

```text
铁律：tree-state.json 永远不由 LLM 直接读/写。
      LLM 只能调 tree-state.js 的子命令，由脚本完成实际操作。

脚本职责：
  ① CRUD 封装（查询/新增/更新/追加）
  ② Schema 校验（字段类型/枚举值/必填项）
  ③ 并发控制（同一时刻只有 1 个写入者）
  ④ 原子写入（先写 .tmp，再 mv）
  ⑤ 自动备份（保留最近 10 份）

LLM 职责：
  ① 决定调哪个子命令
  ② 提供子命令需要的参数
  ③ 拿到 stdout 的 JSON 结果做决策
```

**为什么**：LLM 直接写 JSON 文件，多少次后必然发生偏差（字段写错、格式错误、覆盖丢失）。脚本化 = 把状态变更从"AI 直接操作"变成"AI 发指令 + 脚本原子执行"。

---

## 2. 整体架构 — 在剪枝者之上叠加「指挥控制层」

现有的 Layer 2「时间线剪枝者」（见 `proma-dev-wiki-timeline-pruner.md`）是**机械论**：Fork = 树杈、剪枝 = 切掉、果实 = 交付物。它解决了"能不能并行探索"，但没解决"**整个森林是不是在朝同一个方向走**"。

我们叠加的是 **C2 层（Command & Control）**——把树当成军队编制来用：

```
        🎯 用户意图
            │
        ┌───┴───┐
        │ 指挥所 │  = 根会话（战略 + 调度 + 校准）
        └───┬───┘
       ┌────┼────┐
      战术组1  战术组2  战术组3   = 子会话（拆解 + 执行 + 汇报）
       │        │
     ┌─┴─┐    ┌─┴─┐
     执行  执行  执行  执行      = 孙会话（叶子，原子任务）
```

### 两层的职责切分

| 层 | 剪枝者回答 | C2 层回答 |
|---|---|---|
| 根会话 | "我该 Fork 几条？" | "**这次战役的目标是什么、什么算赢**" |
| 子会话 | "我跑完了，交东西" | "**我跑得对不对、需不需要纠偏**" |
| 剪枝 | "失败就丢" | "**先纠偏，纠不动再丢**" |

### 关键约束

C2 层**不替代**剪枝者，而是包裹它。Fork/send_message/notify/竹节交接这些底层动作一个都不改，只在每次调用前后加契约和校验。

---

## 3. 核心契约 — 下行命令的 4 件套 + 自审契约

每次根会话 Fork 一个子会话，**第一条消息**必须是这 5 件套（4 件套 + 自审契约），作为不可违背的工作合同。子会话在工作过程中**反复回读**这 5 件套防止偏题。

### 3.1 任务简报（Brief）

```yaml
brief:
  parent_intent: "用户要一份南大软件编程课的 PRD"
  my_mission: "完成「实验评测模块」的需求规格"
  why_this_exists: "整个 PRD 缺这块就缺了学生反馈闭环"
  in_scope:
    - "学生提交代码 → 自动评测 → 反馈分数"
    - "教师端：查看评测日志、调整测试用例"
  out_of_scope:           # 关键！边界外的事必须上报而非自决
    - "课程内容本身（其他模块负责）"
    - "成绩录入教务系统（属于成绩模块）"
```

### 3.2 DoD（Definition of Done）

```yaml
dod:
  deliverables:
    - path: "docs/prd/experiment-eval.md"
      min_length: 2000
      must_contain: ["评测流程图", "异常处理", "API 列表"]
  quality_gates:
    - type: self_check
      desc: "Mermaid 流程图可渲染"
    - type: auto_test            # 支持自动跑测试脚本
      script: "scripts/check-mermaid.sh docs/prd/experiment-eval.md"
      expect_exit: 0
      timeout_sec: 30
  self_check:                    # 子会话交付前自查
    - "逐条比对 deliverables"
    - "逐条跑 quality_gates"
    - "在交付消息中附 check-list ✅/❌"
```

### 3.3 汇报契约（Report Protocol）

```yaml
report:
  channels:
    done:      "成果 + 自查 check-list + 文件路径"
    blocked:   "卡点描述 + 已尝试方案 + 请示选项 A/B"
    plan:      "拟拆解的孙任务清单"
    heartbeat_reply: "回应 status_check：当前步骤/已产出/预计剩余"
  format: "结构化 YAML，不要写散文"
  plan_ack_seconds: 300     # 可配置，范围 60~300，超时默认放行
  escalation: "block 超过 10 分钟未回复根会话 → 升级到 archive + 重 Fork"
```

### 3.4 自主度边界（Autonomy Boundaries）

```yaml
autonomy:
  can_decide:                 # 可自决
    - "实验评测模块内部的技术选型"
    - "Mermaid 流程图的具体画法"
    - "API 字段命名（在 in_scope 范围内）"
  must_report:                # 必须上报但可继续
    - "拆解孙任务（plan 通道）"
    - "技术选型的重大变更"
  must_ask:                   # 必须请示才能做
    - "改动 out_of_scope 的内容"
    - "DoD 的 deliverables 路径"
    - "DoD 的 quality_gates 项"
```

### 3.5 自审契约（Self-Audit）

```yaml
self_audit:
  milestones:                 # 子会话拆解时必须先列出
    - { id: M1, desc: "评测流程图初稿", expect_outputs: ["flow.mmd"] }
    - { id: M2, desc: "API 列表", expect_outputs: ["api.yaml"] }
  audit_after_each_milestone: true
  audit_agent_type: "code-reviewer"
  max_self_corrections: 2
  drift_declaration_required: true
```

### 契约纪律

- 没有 DoD 的任务 = **不允许下发**
- 没有 milestones 的任务 = **不允许开始**
- 子会话任何输出都可以拿这 5 件套对照检查

---

## 4. 双通道节奏 — 事件 + 心跳

两个通道不是冗余，而是**互补的感知网**。事件回答"**正在发生什么**"，心跳回答"**为什么没发生**"。

### 4.1 分工矩阵

| | 事件通道 | 心跳通道 |
|---|---|---|
| **触发** | 子会话主动 `send_message(notify)` | Proma automation 定时唤起 |
| **方向** | 上行（子→根） | 下行询问（根→子，根发起） |
| **延迟** | ~实时 | 15 分钟（可调） |
| **覆盖盲区** | 子会话"忘了说" | 子会话"卡死/休眠" |
| **成本** | 仅子会话产出时 1 次上报 | 每次心跳 ~20-30 次 MCP 调用 |

### 4.2 事件通道 — 3 类信号 + 默认放行

子会话只能发 3 类上行消息，**结构化 YAML，不允许散文**：

```yaml
# 1. done — 完成
event: done
deliverables: ["docs/prd/experiment-eval.md"]
self_check: [{ item: "Mermaid 渲染", pass: true }]
context_usage: 78

# 2. blocked — 卡点
event: blocked
obstacle: "评测引擎选型不确定"
tried: ["Docker（重）", "WebAssembly（新）"]
options:
  - { id: A, desc: "Docker，稳但部署重", cost: "高" }
  - { id: B, desc: "WebAssembly，新但轻", cost: "中" }
wait_for: "decision"

# 3. plan — 拆解计划
event: plan
sub_missions:
  - { name: "评测引擎调研", dod: "...", est_steps: 5 }
silence_ack_seconds: 300
status: "5 分钟内无 NACK 则开始 Fork"
```

**plan 默认放行的 A 方案**（每会话独立计时，根会话不阻塞）：

```text
当子会话 X 发出 plan:
  1. 根会话: tree-state.js event append 登记 plan_id + ts
  2. 根会话: Agent(subagent_type=...) 评估此 plan
              prompt = "评估 plan 是否放行" + plan 内容 + 母任务 brief/dod
  3. plan-审批 Agent: 5 分钟内返回 { verdict: ack | nack | tweak, reason }
  4. 根会话:
     - 5 分钟内收到 verdict → 按 verdict 行事
     - 5 分钟内未收到 → 默认放行（plan_ack_seconds 到期）
     - 子会话 X 已经默认开始 Fork 孙会话（不阻塞）
  5. 若 verdict=nack 在默认放行后才到 → 走 §5 中档纠偏
```

### 4.3 心跳通道 — 状态判定与动作

**心跳本质 = 周期性触发 + 状态轮询**。

**触发器**：`mcp__automation__create_automation`（推荐）：
```yaml
name: "tree-heartbeat-<tree_id>"
scheduleType: interval
intervalMinutes: 15
sessionMode: reuse
permissionMode: bypassPermissions
prompt: |
  执行树 <tree_id> 巡检：
  1) 调 tree-state.js leaf list-active 拿到所有 active 叶子
  2) 对每个叶子调 list_messages(session_id, limit=3)
  3) 派哨兵 Agent 判定状态
  4) 异常叶子调 send_message(status_check)
  5) 调 tree-state.js heartbeat append 记录
```

**判定矩阵**（哨兵 Agent 输入数据后输出判定）：

| 最近活动 | 上下文使用 | 判定 | 动作 |
|---|---|---|---|
| < 5 分钟 | < 85% 甜点上限 | 🟢 活跃 | 仅记录 |
| < 5 分钟 | ≥ 85% 甜点上限 | 🟡 甜点预警 | 触发竹节交接（§8.4） |
| 5 ~ 30 分钟 | 任意 | 🟡 停滞 | 发 `status_check` |
| > 30 分钟 | 任意 | 🔴 静默 | `status_check` + 标"待纠偏"（喂给 §5） |

### 4.4 双通道协同 — 去重规则

```text
心跳唤起时先过滤：
  for leaf in active_leaves:
    if leaf.last_event_ts within 5 min:
      skip                          # 事件刚到，跳过
    else:
      apply 4.3 判定矩阵
```

**两个铁律**：
1. **事件优先**：事件能解决的事，心跳绝不重复
2. **心跳补漏**：事件 5 分钟没到的，心跳必须接管

---

## 5. 偏差检测与三档纠偏

偏差 = 子会话的产出/方向/节奏，与 brief + DoD + 上报内容**不一致**。检测和纠偏分开。

### 5.1 偏差的 3 类信号 + 检测 Agent

| 类别 | 信号源 | 检测 Agent | subagent_type | 例子 |
|---|---|---|---|---|
| **产出偏差** | deliverables 内容 | 验收 Agent | `code-reviewer` | 文档缺 API 列表、Mermaid 渲染失败、auto_test 跑不过 |
| **方向偏差** | 上行消息语义 | 路线图 Agent | `researcher` | 子会话在写 out_of_scope、技术选型偏离项目栈 |
| **节奏偏差** | heartbeat_log | 哨兵 Agent | `explorer` | 静默 > 30 分钟、context_usage ≥ 85%、反复同类 blocked |

**Agent 输入契约化**：
- 验收 Agent：子会话 brief + dod + deliverables 路径 → `{pass, gaps, severity, suggested_fork_from_uuid?}`
- 路线图 Agent：母任务 brief + 子会话最近 N 条上行消息 → `{alignment, drift_topics, severity}`
- 哨兵 Agent：tree-state 全部 active 叶子的状态 → `{stale, sweet_spot_risk, silent}`

### 5.2 三档纠偏（按严重度递进）

| 档位 | 触发条件 | 动作 | 谁执行 |
|---|---|---|---|
| **轻档（提示）** | severity=low | `send_message(子会话, "nudge: 注意 X")` | 根会话直发 |
| **中档（限权）** | severity=mid / 节奏 🟡 | `send_message(pause + 限权)` + `tree-state.js leaf autonomy-override` | 根会话 |
| **重档（剪枝）** | severity=high / 节奏 🔴 / 中档后再偏 | `archive_session` + `fork_session(suggested_fork_from_uuid)` + 用更强模型/更严 brief | 根会话 |

### 5.3 纠偏决策树

```text
收到 Agent 的 verdict:
  if severity == low:
    → 轻档 nudge
  elif severity == mid:
    if 该会话近 30 分钟内已 nudge 过:
      → 升级到中档限权
    else:
      → 轻档 nudge（给一次自纠机会）
  elif severity == high:
    if 该会话已被限权过:
      → 重档剪枝（按 verdict.suggested_fork_from_uuid）
    else:
      → 中档限权（给最后一次机会）

  全部动作调 tree-state.js drift append 记录
```

**关键设计**：
- **三档递进**——同一偏差最多给 2 次纠正机会，第 3 次必剪枝
- **递进状态持久化**——`tree-state.json.leaves[X].drift_history` 累计
- **重档剪枝不丢上下文**——Fork 时带 `suggested_fork_from_uuid`（来自验收 Agent 建议）

### 5.4 双层纠偏体系（章节 4 外部 + 补丁 3 内部）

| 维度 | 内部纠偏（会话内） | 外部纠偏（会话间） |
|---|---|---|
| 触发 | 每个里程碑 Mi 完成 | 上报事件 + 心跳周期 |
| 检测者 | 会话内自 Fork 的子 Agent | 根会话派的子 Agent |
| 检查对象 | 自身产出 vs **自己的 brief/dod** | 子会话整体 vs **母任务 brief/dod** |
| 纠偏权限 | 自纠，最多 2 次 | 三档递进 |
| 持久化 | 写在子会话 working_notes（不污染根会话） | 写在 tree-state.json.drift_log |
| 失败升级 | 标 drift 后上报时声明 | 直接走三档递进 |

### 5.5 三层防御全景

```
   【第 0 层】契约预防 — 4 件套 + 自审契约本身消除 60% 偏题
        ↓
   【第 1 层】内部纠偏（事中）— 每里程碑自审 + 自纠 2 次
        ↓
   【第 2 层】外部纠偏（事后）— 事件 + 心跳双通道 + 三档递进
        ↓
   【最终交付】deliverables + self_check + drift_declaration
```

每层输出是下层输入：内部 drift → 外部起点抬高（直接跳中档）；内部 clean → 外部从轻档起。

### 5.6 自评 vs 异体（Agent 化后）

初始决策是"自评（根会话直接判）"。子 Agent 化后盲区补偿：

| 自评盲区 | Agent 化后补偿 |
|---|---|
| 同阵营思维同质化 | 验收 Agent 可指定**不同 subagent_type** |
| 同模型盲区 | 验收 Agent 调用时可**换模型**（用 `model: 'opus'`） |
| 自我合理化 | 验收 Agent prompt 写**"假设有偏，找出证据"** |

---

## 6. 可靠度 5 机制

5 条工程手段，**强制嵌入到 4 件套契约和子会话执行流程里**。

### 6.1 任务简报复述（Brief Echo）

子会话拿到 4 件套后，**第一条上行消息**必须是简报复述：

```yaml
event: brief_echo
my_understanding:
  parent_intent: "<子会话用自己的话复述>"
  my_mission: "<复述>"
  in_scope: ["...", "..."]
  out_of_scope: ["...", "..."]
  dod_essence: "<复述 DoD 的关键判定>"
milestones_preview: ["M1 ...", "M2 ..."]
```

**根会话处理**：派路线图 Agent 比对对齐度。≥85% 放行；<85% 直接发回简报，**子会话没开始干活就被驳回**（最便宜的纠偏）。

### 6.2 DoD 硬校验（Contract Gate）

DoD 不是"参考"，是**门**。子会话每次 `done` 上报时：
- 必须**附带 `quality_gates` 全部执行结果**（含 `auto_test` 退出码、stdout 摘要）
- 缺一项 → **不进入外部验收**，直接退回（重档轻量版）
- 全过 → 才进入根会话派的验收 Agent

`auto_test` 失败语义：
- 退出码 ≠ 期望 → severity=high，直接重档
- 超时 → severity=mid，中档限权后重跑
- 通过 → 算 DoD 合格一项

### 6.3 决策日志（分散化）

**不要独立 `decisions.md`**。改为**每个产出旁带一个 ≤ 50 行的小笔记**：

```
docs/prd/experiment-eval/
  ├─ flow.mmd                    # M1 产出
  ├─ flow.note.md                # M1 决策笔记（< 50 行）
  ├─ api.yaml                    # M2 产出
  └─ api.note.md                 # M2 决策笔记
```

**`<产出名>.note.md` 模板**：

```markdown
---
milestone: M2
topic: api-style
reversible: true
---
options: [REST, GraphQL, RPC]
chose: REST
reason: 学生群体更熟悉，教案对接成本低
review_trigger: 课程组反馈接口散乱 > 3 次则换 RPC
```

**强约束**：每个里程碑产出**必须**带配套 `.note.md`。无 note → 验收 Agent 直接 severity=high。

### 6.4 上下文最小化（Context Diet）

防止会话上下文爆炸，3 条硬规则：

| 规则 | 实现 |
|---|---|
| **不留一次性大输出** | 子会话产出大文件后，只保留路径 + 摘要，不塞对话历史 |
| **不重复读已读文件** | 已读文件路径 + 摘要记录在 `working_notes/files_index.md` |
| **超甜点 85% 强制竹节交接** | 哨兵 Agent 检测到 → 强制 Fork 续接（§8.4） |

### 6.5 命名规范

**格式**：`<prefix>-<path>-<role>[-<suffix>]`

| 段 | 内容 | 例 |
|---|---|---|
| `prefix` | 项目代号，正则 `[a-z][a-z0-9_]{3,7}`（小写字母开头，4-8 字符，**不含连字符**） | `nanju`、`sweng`、`webv3`、`pguide` |
| `path` | 树定位，根为空，子为 A/B/C，孙为 A1/A2，曾孙 A1a/A1b | `A`、`A1`、`A1a` |
| `role` | 角色枚举，取值 `root` \| `commander` \| `worker`（不受 LEAF_NAME_RE 的 `\w+` 限制，语义校验由 tree-state.js 的 assertEnum 负责） | `root`、`commander`、`worker` |
| `suffix` | 可选。`s\d+` 表竹节 / `i\d+` 表尝试序号 | `s2`、`i2` |

**完整示例**：

| 命名 | 解读 |
|---|---|
| `nanju-root` | nanju 项目根会话 |
| `nanju-A-eval` | 第 1 子 A = 实验评测模块 |
| `nanju-A-eval-s2` | A 的竹节第 2 节 |
| `nanju-A1-engine` | A 的第 1 孙 = 评测引擎调研 |
| `nanju-A1b-engine` | A1 的第 2 次尝试 |
| `nanju-B-pedagogy` | 第 2 子 B = 教学法模块 |

**prefix 不含连字符示例**：

| prefix | 合法？ | 说明 |
|---|---|---|
| `nanju` | ✅ | 5 字符，全小写 |
| `pguide` | ✅ | 6 字符，全小写 |
| `proma-guide` | ❌ | 含连字符，正则不匹配 → 改用 `pguide` |
| `web_v3` | ✅ | 6 字符，下划线合法 |
| `webv3` | ✅ | 5 字符 |
| `n` | ❌ | 不足 4 字符 |
| `nar` | ❌ | 不足 4 字符（3 字符） |
| `NANJU` | ❌ | 含大写字母 |
| `123abc` | ❌ | 首字符非小写字母 |
| `toolkithelper` | ❌ | 13 字符，超过 8 字符上限 |

**友好性**：
- 人：念得出来、看得出关系、看得出状态
- 机：正则 `^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$`，可作 key，可作目录名

**配套规则**：
1. `prefix` 由根会话首次激活时生成，**永不变更**
2. Fork 时强制继承 prefix
3. `role` 必填
4. 重档剪枝时旧会话 archive 不删，新会话加 `i2/i3` 后缀

---

## 7. 南大 PRD 场景套用（验证用例）

把体系套到真实需求："**为南大软件编程课（24 秋）写一份完整 PRD**"。

### 7.1 树形结构实例

```
nanju-root                                    🌳 指挥所
  ├─ nanju-A-commander                        🍃 课程大纲模块
  │  ├─ nanju-A1-worker                       🍃 知识点拆解
  │  └─ nanju-A2-worker                       🍃 教材选型
  ├─ nanju-B-commander                        🍃 实验评测模块
  │  ├─ nanju-B1-worker                       🍃 评测引擎调研
  │  │  ├─ nanju-B1a-worker   ❌ 剪枝（Docker 太重）
  │  │  └─ nanju-B1b-worker   🍎 WebAssembly
  │  └─ nanju-B2-worker                       🍃 评测 API 设计
  ├─ nanju-C-commander                        🍃 成绩管理模块
  ├─ nanju-D-commander                        🍃 师生交互模块
  ├─ nanju-E-commander                        🍃 教学资源模块
  └─ nanju-F-commander                        🍃 整合会话（最后启动）
```

### 7.2 典型时序（含一次偏差纠偏全过程）

```text
T+0:00  用户: "为南大软件编程课 24 秋写一份完整 PRD"
T+0:01  nanju-root: 拆解为 6 个子任务 A-F
T+0:02  nanju-root: Fork nanju-A-syllabus ... nanju-E-resource
        每个 Fork 第一条消息 = 4 件套 + self_audit 契约
T+0:05  nanju-B1-engine → brief_echo
        根会话派路线图 Agent → 对齐度 92% → 放行
T+0:08  nanju-B1a-engine: M1 完成（Docker 方案文档）
        内部自审：通过 → 上报 done → 根会话派验收 Agent
T+0:09  验收 Agent: severity=high（Docker 部署对课程环境过重）
        suggested_fork_from: M1 之前的 uuid
T+0:10  nanju-root: archive nanju-B1a-engine
        Fork nanju-B1b-engine，brief 加约束 "排除容器方案"
T+0:18  nanju-B1b-engine: M1 完成（WebAssembly）→ 内审过 → 验收过
        标记 🍎
T+0:25  nanju-A2-textbook: 发 plan 信号 → plan-审批 Agent 5 分钟内 ack
T+0:30  nanju-root: 心跳唤起 → 哨兵 Agent 扫描
        nanju-D-interaction 静默 25 分钟 → status_check
T+0:32  nanju-D-interaction: 回应 → 🟢 继续观察
T+0:45  A/B/C/E 全部 done，drift_log 记录 1 次重档剪枝
T+0:46  nanju-root: 启动 nanju-F-integration
T+1:20  nanju-F-integration: done → 验收 → 🍎
        交付: docs/prd/nanjing-sw-programming-24fall.md
```

### 7.3 与传统 PRD 工作流对比

| 维度 | 传统方式 | 本体系 |
|---|---|---|
| 写一份 PRD | 1 个 Agent 顺序写 6 模块 | 6 个会话并行 + 1 个整合 |
| 偏差发现 | 末尾交付时 | 每里程碑 + 每上报 + 心跳 |
| 失败重做 | 整模块推倒 | 从失败前 uuid 局部重 Fork |
| 上下文成本 | 1 个会话扛到底（必爆炸） | 每模块独立，甜点不超 |
| 整合质量 | 依赖作者全局观 | 整合会话带 6 模块产出 |
| 可恢复性 | 崩了重来 | tree-state.json 重建 |

---

## 8. 持久化与灾难恢复

### 8.1 tree-state.json 完整结构

```jsonc
{
  "version": "1.0",
  "tree_id": "nanju",
  "created_at": "2026-06-18T12:00:00+08:00",
  "last_heartbeat": "2026-06-18T12:45:00+08:00",
  "root_brief": { /* §3.1 brief */ },
  "root_dod":   { /* §3.2 dod */ },

  "leaves": {
    "nanju-A-syllabus": {
      "session_id": "uuid-xxx",
      "parent": null,
      "path": "A",
      "role": "syllabus",
      "status": "active",                    // active | done | pruned | archived | segment_pending
      "model": "claude-sonnet-4-6",
      "channel": "anthropic",
      "created_at": "...",
      "last_event_ts": "...",
      "last_event_type": "plan",
      "context_usage_pct": 47,
      "drift_history": [
        { "ts": "...", "kind": "production", "severity": "high", "action": "prune", "fork_to": "nanju-B1b-engine" }
      ],
      "milestones": [
        { "id": "M1", "status": "done", "audit_pass": true, "note_path": "docs/.../flow.note.md" }
      ],
      "segment_chain": [],
      "autonomy_overrides": {}
    }
  },

  "heartbeat_log": [...],
  "drift_log": [...],

  "audit_meta": {
    "plan_ack_seconds": 300,
    "sweet_spot_limits": {
      "claude-sonnet-4-6": { "min": 100000, "max": 200000, "hard": 300000 },
      "deepseek-v4-pro":   { "min": 150000, "max": 250000, "hard": 400000 },
      "deepseek-v4-flash": { "min": 80000,  "max": 150000, "hard": 200000 },
      "glm-5-turbo":       { "min": 50000,  "max": 80000,  "hard": 100000 }
    },
    "max_self_corrections": 2,
    "heartbeat_interval_minutes": 15
  }
}
```

### 8.2 写入时机（铁律）

| 事件 | 写入内容 |
|---|---|
| Fork 任何会话 | `leaf add` 新增 leaves 条目 |
| 收到任何上行事件 | `event append` + `leaf set-last-event` + `leaf set-context` |
| 内/外部审计完成 | `drift append` |
| 心跳完成 | `heartbeat append` |
| 竹节交接 | `segment append` + 旧叶 set-status=segment_pending |
| 剪枝 | `leaf set-status=pruned`（不删除） |

**铁律**：所有写入走 `tree-state.js` 子命令，**LLM 永不直接读写 JSON**。

### 8.3 灾难恢复 — 4 类故障

| 故障 | 现象 | 恢复 |
|---|---|---|
| **F1. 子会话崩溃** | send_message 无响应 | 心跳发现 🔴 → 重档剪枝；从该 leaf 最后通过的 milestone uuid 重 Fork |
| **F2. 根会话崩溃** | 调度停滞 | tree-state.json 完整 → 重启根会话 → 加载 tree-state → 恢复调度 |
| **F3. tree-state 损坏** | JSON 解析失败 | 从 `.tmp` 或 backup 恢复；无备份则从 drift_log/heartbeat_log 重建 |
| **F4. SDK 配额耗尽** | Fork/send_message 失败 | 根会话"待机"：每 5 分钟 ping 1 次，恢复后续跑 |

**关键设计**：
- leaves 条目**永不删除**，只改 status（保留可追溯）
- drift_log 永不截断（除非显式 archive）
- 每写 10 次自动备份一次

### 8.4 竹节式自动交接（落地版）

```text
哨兵 Agent 每次心跳扫描 context_usage_pct:
  for leaf in active_leaves:
    pct = leaf.context_usage_pct
    limit = audit_meta.sweet_spot_limits[leaf.model].max
    
    if pct >= limit * 0.95:           # 强制交接
      force_handoff(leaf)
    elif pct >= limit * 0.85:         # 预警
      schedule_handoff(leaf, delay=300s)

force_handoff(leaf):
  1. send_message(leaf, "请输出任务简报：进度 + 关键发现 + 未完成里程碑，< 2K tokens")
  2. 等回应（wait=true）
  3. fork_session(from=leaf, new_name=leaf.name + "-s" + next_seq)
  4. 新会话首条消息 = 原 brief + dod + self_audit + 简报 + 已产出文件列表
  5. 旧叶 status=segment_pending
  6. 新叶 status=active
  7. tree-state.js segment append
```

**新会话首条消息模板**：

```yaml
brief: <原 brief>
dod: <原 dod>
self_audit: <原 self_audit，milestones 标记已完成项>
handoff_brief: |
  <简报 2K tokens 内>
produced_so_far:
  - { milestone: M1, path: "...", note: "..." }
next_milestone: M3
instruction: "你承接的是同名会话的第 N 节。不要重做已完成的里程碑，从 next_milestone 继续。"
```

### 8.5 持久化目录结构

```
<workspace>/.context/trees/<tree_id>/
  ├─ tree-state.json                  # 主状态
  ├─ tree-state.backup.*.json         # 历史备份（最近 10 份）
  ├─ heartbeat.log                    # 心跳追加日志（按月 rotate）
  ├─ drift.log                        # 偏差追加日志（按月 rotate）
  ├─ tree-state.js                    # 状态访问脚本（补丁 4）
  └─ .lock                            # 文件锁
```

`tree-state.js` 跨多个 tree_id 共享一个，放在 `<workspace>/.context/trees/tree-state.js`，子命令带 `<tree_id>` 参数路由。

---

## 9. MVP 落地与渐进路线

### 9.1 三层交付路线

```
v0.1 (MVP) ──── 跑通一棵最小树（根+2子，无孙），验证契约+事件+剪枝
   ↓ 持续 1-2 周，跑 5+ 真实任务
v0.2 ────────── 加心跳通道 + 内部自审 + 三档纠偏
   ↓ 持续 2-3 周
v0.3 ────────── 加竹节交接 + 灾难恢复 + 哨兵 Agent
   ↓ 持续 2 周
v1.0 ────────── 完整体系（含模板复用、可视化、Mermaid 导出）
```

### 9.2 v0.1 必做项

| # | 项 | 实现位置 |
|---|---|---|
| 1 | **tree-state.js 脚本**（补丁 4） | `<workspace>/.context/trees/tree-state.js` |
| 2 | **4 件套契约模板**（§3） | prompt 模板文件 |
| 3 | **tree-commander Skill** | `skills/tree-commander/SKILL.md` |
| 4 | **tree-worker Skill** | `skills/tree-worker/SKILL.md` |
| 5 | **会话命名强制**（§6.5） | tree-state.js 的 add-leaf 校验 |
| 6 | **事件通道**（§4.2） | 子会话 send_message 上行 + 根会话路由 |
| 7 | **basic 偏差检测**（§5） | 根会话派 Agent |
| 8 | **三档纠偏**（§5.2） | 根会话 archive/fork 逻辑 |
| 9 | **brief_echo 强制**（§6.1） | 子会话首条消息格式校验 |
| 10 | **DoD 硬校验**（§6.2） | 验收 Agent 检查 self_check |

### 9.3 v0.1 故意不做（YAGNI）

- ❌ 心跳通道（人工触发替代）
- ❌ 内部自审（v0.2）
- ❌ 竹节交接（v0.3，v0.1 控制任务规模避免触甜点）
- ❌ tree-state.backup 自动 rotate（v0.2）
- ❌ 模板复用（v1.0）
- ❌ Mermaid 可视化导出（v1.0）

### 9.4 v0.1 验证用例 — 3 个必跑场景

| 用例 | 验证什么 |
|---|---|
| **S1. 简单二叉树** | 根拆 2 子，都正常 done，整合会话产出。验证契约下发、事件路由、整合 |
| **S2. 一次偏差纠偏** | 故意让子会话偏题，验证路线图 Agent 发现 + 三档纠偏 |
| **S3. 一次重档剪枝** | 子会话产出质量很差，验证 archive + fork + 旧会话不删 + drift_log |

3 个用例都通过 = v0.1 可用。

### 9.5 测试方法

用 Proma 内置的矩阵测试模式：每个用例跑 3 次（不同模型组合），矩阵记录成功/失败、上下文消耗、纠偏触发次数。

---

## 附录索引

设计文档主体完成。下列附录作为 v0.1 实施的独立 spec，分别委派子 Agent 实施：

- **附录 A**: tree-state.js API 完整 spec（参数、输出、错误码）→ 委派子 Agent A
- **附录 B**: tree-commander Skill 完整内容 → 委派子 Agent B
- **附录 C**: tree-worker Skill 完整内容 → 委派子 Agent C

---

## 附录 A / tree-state.js API 完整 Spec

> 实施目标：单文件 Node.js 脚本，零第三方依赖（仅用 Node 内置 fs/path/process）。
> 部署位置：`<workspace>/.context/trees/tree-state.js`
> 调用方式：CLI `node tree-state.js <command> [args]`

### A.1 全局约定

**输出格式**：
- 成功：stdout 输出**单行 JSON**（紧凑，无缩进），退出码 0
- 失败：stdout 输出 `{ "ok": false, "error": { "code": "...", "msg": "..." } }`，退出码 ≠ 0

**错误码枚举**：
```text
E_LOCK_TIMEOUT      锁等待超时（10s 内未拿到）
E_TREE_NOT_FOUND    tree_id 对应目录不存在
E_LEAF_NOT_FOUND    leaf_id 在 leaves 中不存在
E_SCHEMA_INVALID    输入 JSON 不符合 schema
E_STATUS_INVALID    status 值不在枚举内
E_NAME_INVALID      命名不符合 §6.5 规范
E_PARENT_MISSING    parent 引用的 leaf 不存在
E_DUPLICATE_LEAF    同名 leaf 已存在
E_BACKUP_CORRUPT    备份文件损坏
E_IO                文件读写错误
```

**tree_id 路由**：所有子命令第一个位置参数是 `<tree_id>`，脚本内部映射到 `<workspace>/.context/trees/<tree_id>/` 目录。

**并发锁**：
- 锁文件：`<tree_dir>/.lock`
- 锁内容：`{pid}_{timestamp_ms}`
- 锁超时：10 秒，超时自动释放（防死锁）
- 实现要点：用 `fs.openSync(path, 'wx')` 原子创建，失败则等待 + 重试

**原子写入**：
```text
1. 读 tree-state.json → 反序列化
2. 业务逻辑修改 state 对象
3. JSON.stringify(state) → 写到 tree-state.json.tmp
4. fs.renameSync(tmp, tree-state.json)  // 原子 mv
5. 每写 10 次自动备份一次（保留最近 10 份）
```

### A.2 子命令分组

| 组 | 命令 | 说明 |
|---|---|---|
| Query | `leaf get` / `leaf list-active` / `leaf list-all` / `tree dump` | 只读 |
| Query | `drift list` / `heartbeat tail` / `event list` | 只读 |
| Add | `leaf add` / `milestone add` | 新增 |
| Update | `leaf set-status` / `leaf set-context` / `leaf set-last-event` | 字段更新 |
| Update | `leaf autonomy-override` / `milestone set-result` | 字段更新 |
| Append | `event append` / `drift append` / `heartbeat append` / `segment append` | 数组追加 |
| Maintain | `backup` / `restore` / `validate` / `init` | 维护 |

### A.3 Query 类（read-only）

#### `leaf get <tree_id> <leaf_id>`

**用途**：查询单个 leaf 完整信息。

**输出**：
```json
{"ok":true,"leaf":{"session_id":"...","parent":"...","path":"A","role":"eval","status":"active",...}}
```

**错误**：`E_TREE_NOT_FOUND` / `E_LEAF_NOT_FOUND`

#### `leaf list-active <tree_id>`

**用途**：列出所有 status=active 的叶子（心跳用）。

**输出**：
```json
{"ok":true,"leaves":[{"leaf_id":"nanju-A-eval","session_id":"...","last_event_ts":"...","context_usage_pct":47},...]}
```

#### `leaf list-all <tree_id>`

**用途**：列出所有叶子（含 done/pruned/archived）。

**输出**：`{"ok":true,"leaves":[{...},{...}]}`

#### `tree dump <tree_id>`

**用途**：全树 dump（调试/恢复用）。返回完整 tree-state.json 内容。

#### `drift list <tree_id> [--leaf <id>] [--since <iso>]`

**用途**：查询 drift 历史。可按 leaf / 时间过滤。

#### `heartbeat tail <tree_id> [--leaf <id>] [-n 20]`

**用途**：查询最近 N 条心跳记录。

#### `event list <tree_id> [--leaf <id>] [--type done|blocked|plan|brief_echo]`

**用途**：查询事件历史。

### A.4 Add 类

#### `leaf add <tree_id> --json '<leaf_initial_json>'`

**用途**：Fork 新会话时调（命名强制校验）。

**输入 JSON**：
```json
{
  "leaf_id": "nanju-A-eval",
  "session_id": "uuid-xxx",
  "parent": null,
  "path": "A",
  "role": "eval",
  "model": "claude-sonnet-4-6",
  "channel": "anthropic"
}
```

**校验**：
- `leaf_id` 必须匹配 `^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$`（prefix 段 4-8 字符小写无连字符）
- `path` 必须与 `leaf_id` 中的 path 段一致
- `parent` 若非 null，必须指向已存在的 leaf
- 同名 leaf 不允许重复

**自动填充**：
- `created_at` = 当前 ISO 时间
- `status` = "active"
- `drift_history` = []
- `milestones` = []
- `segment_chain` = []
- `autonomy_overrides` = {}
- `last_event_ts` / `last_event_type` = null
- `context_usage_pct` = 0

**输出**：`{"ok":true,"leaf":{...完整对象}}`

#### `milestone add <tree_id> <leaf_id> --json '<milestone_json>'`

**输入**：`{"id":"M1","desc":"评测流程图初稿","expect_outputs":["flow.mmd"]}`

**校验**：同 leaf 内 milestone.id 不重复。

### A.5 Update 类

#### `leaf set-status <tree_id> <leaf_id> <new_status>`

**new_status 枚举**：`active | done | pruned | archived | segment_pending`

**特殊行为**：
- 切到 `pruned` 或 `archived` 时，自动追加 `drift_history` 一条 `{action: "status_change", from, to, ts}`
- 切到 `done` 时校验 milestones **非空** 且所有 milestones 都 audit_pass=true（否则报错 `E_SCHEMA_INVALID`）。空 milestone 集合不允许 done——契约精神要求每个宣告完成的工作都有结构骨架。

#### `leaf set-context <tree_id> <leaf_id> <pct_int>`

**用途**：心跳后更新上下文使用率。

**校验**：`pct_int` 是 0~100 的整数。

#### `leaf set-last-event <tree_id> <leaf_id> <event_type> [--ts <iso>]`

**event_type 枚举**：`done | blocked | plan | brief_echo | heartbeat_reply | nudge | limit | status_check`

**ts 默认**：当前 ISO 时间。

#### `leaf autonomy-override <tree_id> <leaf_id> --json '<override_json>'`

**用途**：§5.2 中档纠偏时限权。

**输入 JSON**：
```json
{
  "added_must_ask": ["改动 API 字段类型"],
  "removed_can_decide": ["技术选型"],
  "reason": "中档纠偏：方向偏差 mid 严重度",
  "ts": "2026-06-18T12:30:00+08:00"
}
```

实现：合并到 leaf.autonomy_overrides，并追加 drift_history 一条 `{kind:"direction",severity:"mid",action:"limit"}`。

#### `milestone set-result <tree_id> <leaf_id> <milestone_id> --audit-pass <bool> [--note-path <path>]`

**用途**：内审/外审后记录结果。

**校验**：milestone_id 必须存在；audit_pass=true 时建议附 note_path（不强制）。

### A.6 Append 类

#### `event append <tree_id> <leaf_id> --type <type> --json '<meta>'`

**用途**：登子上行事件元数据（不是消息原文）。

**输入 meta**：
```json
{
  "deliverables": ["docs/prd/..."],    // done 时填
  "self_check": [...],                  // done 时填
  "options": [...],                     // blocked 时填
  "sub_missions": [...],                // plan 时填
  "my_understanding": {...}             // brief_echo 时填
}
```

实现：append 到 `tree-state.json.leaves[<leaf_id>].events` 数组（如不存在则创建），同时更新 last_event_*。

#### `drift append <tree_id> <leaf_id> --kind <kind> --severity <sev> --action <act> [--fork-to <leaf_id>] [--reason <text>]`

**用途**：内/外部审计后追加偏差记录。

**kind 枚举**：`production | direction | rhythm`
**severity 枚举**：`low | mid | high`
**action 枚举**：`nudge | limit | prune | self_correct | declare | handoff`

实现：双写——
1. 追加到 `leaves[<leaf_id>].drift_history` 数组
2. 追加到顶层 `drift_log` 数组（便于跨叶子查询）

#### `heartbeat append <tree_id> --json '<heartbeat_json>'`

**输入**：
```json
{
  "verdicts": [
    {"leaf_id":"nanju-A-eval","verdict":"active","action":"none"},
    {"leaf_id":"nanju-D-x","verdict":"stale","action":"status_check_sent"}
  ],
  "ts": "2026-06-18T12:45:00+08:00",
  "next_heartbeat": "2026-06-18T13:00:00+08:00"
}
```

实现：追加到顶层 `heartbeat_log`，更新顶层 `last_heartbeat`。

#### `segment append <tree_id> <leaf_id> <new_session_id>`

**用途**：竹节交接时调用。

实现：
1. 在 `leaves[<leaf_id>].segment_chain` 追加 new_session_id
2. 把当前 leaf 的 status 改为 `segment_pending`
3. 在 drift_history 追加 `{kind:"rhythm", action:"handoff", to_session: new_session_id}`

### A.7 Maintain 类

#### `init <tree_id> --root-brief '<json>' --root-dod '<json>' [--audit-meta '<json>']`

**用途**：首次创建 tree（根会话激活时调一次）。

实现：
- 创建 `<workspace>/.context/trees/<tree_id>/` 目录
- 写初始 tree-state.json：version=1.0, tree_id, created_at, root_brief, root_dod, leaves={}, heartbeat_log=[], drift_log=[], audit_meta（带默认值）
- audit_meta 默认：
  ```json
  {
    "plan_ack_seconds": 300,
    "max_self_corrections": 2,
    "heartbeat_interval_minutes": 15,
    "sweet_spot_limits": {
      "claude-sonnet-4-6": {"min":100000,"max":200000,"hard":300000},
      "deepseek-v4-pro":   {"min":150000,"max":250000,"hard":400000},
      "glm-5-turbo":       {"min":50000,"max":80000,"hard":100000}
    }
  }
  ```

#### `backup <tree_id> [--label <text>]`

**用途**：手动备份。

实现：复制 tree-state.json 到 `tree-state.backup.<ts_ms>.<label>.json`，保留最近 10 份（按时间排序，超出删旧的）。

#### `restore <tree_id> <backup_file>`

**用途**：从备份恢复。

**校验**：备份文件能解析为合法 tree-state schema。

#### `validate <tree_id>`

**用途**：一致性校验（启动时跑一遍）。

**检查项**：
1. 所有 leaves 的 parent 引用都能找到
2. 所有 drift_history 的 fork_to（如有）指向存在的 leaf
3. 所有 segment_chain 中的 session_id 唯一
4. 所有 leaf.path 与 leaf_id 解析出的 path 一致
5. milestones.id 在同 leaf 内唯一

**输出**：
```json
{"ok":true,"issues":[]}
```
或
```json
{"ok":false,"issues":[{"type":"parent_missing","leaf_id":"...","detail":"..."}]}
```

### A.8 关键实现要点（给子 Agent 的提示）

```javascript
// 1. 主入口骨架
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    const result = await dispatch(cmd, args);
    process.stdout.write(JSON.stringify({ok: true, ...result}) + '\n');
    process.exit(0);
  } catch (e) {
    process.stdout.write(JSON.stringify({ok:false, error:{code:e.code||'E_UNKNOWN', msg:e.message}}) + '\n');
    process.exit(1);
  }
}

// 2. 锁实现（零依赖，跨平台兼容 Windows）
async function withLock(treeDir, fn) {
  const lockPath = path.join(treeDir, '.lock');
  const startTime = Date.now();
  const LOCK_TIMEOUT_MS = 10000;
  
  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(lockPath, 'wx');      // 原子创建
      fs.writeSync(fd, `${process.pid}_${Date.now()}`);
      fs.closeSync(fd);
      try {
        return await fn();
      } finally {
        fs.unlinkSync(lockPath);
      }
    } catch (e) {
      if (e.code === 'EEXIST') {
        // 检查锁是否过期
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) {
            fs.unlinkSync(lockPath);                 // 强制清理过期锁
            continue;
          }
        } catch {}
        await sleep(100);
      } else {
        throw e;
      }
    }
  }
  const err = new Error('Lock timeout');
  err.code = 'E_LOCK_TIMEOUT';
  throw err;
}

// 3. 命名正则 — prefix 段: [a-z][a-z0-9_]{3,7}（小写字母开头，4-8 字符，不含连字符）
const LEAF_NAME_RE = /^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$/;

// 4. status 枚举
const STATUS_ENUM = ['active', 'done', 'pruned', 'archived', 'segment_pending'];
const EVENT_TYPE_ENUM = ['done','blocked','plan','brief_echo','heartbeat_reply','nudge','limit','status_check'];
const DRIFT_KIND_ENUM = ['production','direction','rhythm'];
const DRIFT_SEVERITY_ENUM = ['low','mid','high'];
const DRIFT_ACTION_ENUM = ['nudge','limit','prune','self_correct','declare','handoff'];

// 5. sleep helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
```

### A.9 v0.1 实施清单（给子 Agent 的 acceptance）

- [ ] 单文件 `<workspace>/.context/trees/tree-state.js`，零第三方依赖
- [ ] 所有 §A.3-A.7 子命令实现，输出格式严格按 §A.1
- [ ] 并发锁实现（§A.8 第 2 点），10s 超时
- [ ] 命名正则强制（§A.8 第 3 点）
- [ ] 所有枚举值校验（§A.8 第 4-6 点）
- [ ] 原子写入（tmp + rename）
- [ ] 自动备份（每 10 次写备份一次，保留最近 10 份）
- [ ] `validate` 命令实现 §A.7 所有检查项
- [ ] 错误码覆盖 §A.1 所有枚举
- [ ] 每个 subcommand 至少一个示例放在文件顶部注释里
- [ ] Windows 兼容（路径用 path.join，不用 /）

---

## 附录 B / tree-commander Skill 内容（待子 Agent B 实施）

> 由子 Agent B 基于本文档主体 + 附录 A 实施，写到 `<workspace>/skills/tree-commander/SKILL.md`。
> 内容要点见 §9.4。

## 附录 C / tree-worker Skill 内容（待子 Agent C 实施）

> 由子 Agent C 基于本文档主体实施，写到 `<workspace>/skills/tree-worker/SKILL.md`。
> 内容要点见 §9.4。

---

## 10. v0.2 实施规范

> **版本**: v2.0 草稿 (2026-06-18)
> **基于**: §4（心跳通道）、§3.5（内部自审）、§5（三档纠偏）的设计，将其从"设计愿景"落地为"可执行 spec"
> **v0.2 范围**: 心跳通道 + 内部自审 + 三档纠偏 + v0.1.1-S3 Windows rename 修复

---

### 10.1 v0.2 范围与 v0.1 差异

| 能力 | v0.1 | v0.2 |
|---|---|---|
| 事件通道（子→根 上行） | ✅ | ✅（不变） |
| 心跳通道（自动巡检） | ❌ 人工替代 | ✅ Proma automation |
| 内部自审（会话内 Mi 自查） | ❌ 可选 | ✅ 必须 |
| 三档纠偏（纠偏决策+执行） | ❌ 设计有 / 无实现 | ✅ 实现 nudge/limit/prune |
| 哨兵 Agent prompt | ❌ | ✅ |
| Windows rename 重试（S3） | ❌ 单次尝试 | ✅ 重试 3-5 次 + 退避 |

**v0.2 故意不做（YAGNI）**：
- 竹节交接（v0.3）
- 灾难恢复 F1-F4（v0.3）
- tree-state.backup 自动 rotate（已在 v0.1 完成）
- 模板复用（v1.0）

---

### 10.2 v0.1.1-S3：Windows rename 重试修复

**问题**：`tree-state.js` 原子写入用 `fs.renameSync(tmp, target)`，Windows 下当 target 文件有其他进程占用读/写句柄时会抛 `EPERM`，当前代码仅捕获异常并清理 tmp，导致本次状态更新丢失。

**修复规范**：

```javascript
// writeState 中替换原有的 renameSync 调用
async function atomicRename(tmpPath, targetPath) {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 50;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return; // 成功
    } catch (e) {
      if (e.code === 'EPERM' && attempt < MAX_RETRIES - 1) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt)); // 指数退避: 50/100/200/400ms
        continue;
      }
      // 最后一次失败或非 EPERM 错误，清理 tmp 后抛出
      try { fs.unlinkSync(tmpPath); } catch {}
      throw e;
    }
  }
}
```

**关键约束**：
- 最多重试 5 次（总最大等待约 750ms）
- 退避策略：指数退避（50ms × 2^attempt）
- 非 EPERM 错误不重试，直接抛出
- 重试耗尽后仍失败：清理 tmp，抛 `E_IO`

**影响范围**：仅 `writeState` 函数中的 rename 调用，不影响其他逻辑。

---

### 10.3 心跳通道实现

**目标**：每 15 分钟自动巡检一次所有 active 叶子，通过 Proma automation 持久化触发，哨兵 Agent 判定状态。

**Automation 配置规范**：

```yaml
name: "tree-heartbeat-<tree_id>"
scheduleType: interval
intervalMinutes: 15
sessionMode: reuse
permissionMode: bypassPermissions
prompt: |
  执行树 <tree_id> 心跳巡检。工作区: C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files
  
  步骤:
  1. 运行: node .context/trees/tree-state.js leaf list-active <tree_id>
  2. 对每个 active 叶子调用 mcp__session__list_messages(session_id, limit=3) 获取最近活动
  3. 调用哨兵 Agent（见 §10.3.1）判定每个叶子状态
  4. 对「停滞」叶子调用 mcp__session__send_message(session_id, "status_check: 请报告当前步骤和预计完成时间")
  5. 运行: node .context/trees/tree-state.js heartbeat append <tree_id> --json '<判定结果 JSON>'
  6. 返回巡检摘要（< 200 字）
```

**哨兵 Agent prompt 骨架**（§10.3.1）：

```text
任务：判定一批 active 叶子的状态。
输入：[{leaf_id, last_event_ts, last_event_type, context_usage_pct, recent_messages: [...3条]}]
判定矩阵（§4.3）：
  最近活动 < 5 分钟 且 context_usage < 85% → 🟢 active / action: none
  最近活动 < 5 分钟 且 context_usage ≥ 85% → 🟡 sweet_spot_risk / action: schedule_handoff
  最近活动 5~30 分钟 → 🟡 stale / action: status_check
  最近活动 > 30 分钟 → 🔴 silent / action: status_check + mark_pending_correction
输出（JSON 数组）：
  [{leaf_id, verdict: "active|stale|silent|sweet_spot_risk", action: "none|status_check|schedule_handoff|mark_pending_correction", reason: "..."}]
```

**tree-state.js 新增子命令**（v0.2）：
- 无需新增子命令，`heartbeat append` 在 v0.1 已实现

---

### 10.4 内部自审流程

**目标**：每个执行会话在每个里程碑 Mi 完成后，自 Fork 一个 `code-reviewer` 子 Agent 做对齐校验，severity ≥ mid 时自纠最多 2 次。

**tree-worker SKILL 需新增的里程碑自审段落**（在铁律 3 从"v0.1 可选"升级为"v0.2 必须"）：

```yaml
# 里程碑 Mi 完成后立即调用以下审计流程
self_audit_after_milestone:
  trigger: 每次 milestone set-result 后
  agent_type: code-reviewer
  model: sonnet  # 关键里程碑可升级为 opus
  prompt_template: |
    审计里程碑 <Mi.id> 的产出是否与任务 brief/dod 对齐。
    brief: <当前任务 brief>
    dod: <当前任务 dod>
    产出路径: <Mi.expect_outputs>
    检查点:
    1. 产出是否覆盖 Mi.desc 描述的全部内容
    2. 是否有偏离 brief.in_scope 的内容
    3. 产出质量是否达到 dod.quality_gates 的最低标准
    输出: {alignment: 0-100, gaps: [...], severity: "low|mid|high", suggestion: "..."}
  max_self_corrections: 2
  on_severity_low: 继续下一个里程碑
  on_severity_mid_or_high:
    - 按 suggestion 自纠
    - 再次调用审计（第 2 次）
    - 若仍 mid+: 在 done 上报时加 drift_declaration=true，声明偏差
```

**drift_history 写入规范**（v0.2 新增）：
- 自纠成功：`drift append ... --kind production --severity low --action self_correct`
- 仍有偏差上报：`drift append ... --kind production --severity mid --action declare`

---

### 10.5 三档纠偏实现

**目标**：根会话（指挥官）收到子会话 `done` 或心跳巡检后，按 §5.2 的决策树自动执行三档纠偏。

**纠偏触发时机**：
1. 子会话上报 `done` → 验收 Agent 判定 → severity 驱动
2. 心跳哨兵 Agent 判定 `stale/silent` → 节奏偏差驱动

**纠偏执行流程（tree-commander SKILL 更新）**：

```text
收到 verdict:
  if verdict.severity == low OR verdict.action == status_check:
    send_message(leaf.session_id, "nudge: " + verdict.suggestion)
    tree-state.js leaf set-last-event <tree_id> <leaf_id> nudge
    tree-state.js drift append <tree_id> <leaf_id> --kind <kind> --severity low --action nudge

  elif verdict.severity == mid:
    if leaf.drift_history 近 30 min 内有 nudge 记录:
      send_message(leaf.session_id, "limit: 权限已限制 — " + verdict.gaps)
      tree-state.js leaf autonomy-override <tree_id> <leaf_id> --json '{...限权内容...}'
      tree-state.js drift append ... --action limit
    else:
      → 先走 low 档 nudge（给一次机会）

  elif verdict.severity == high OR (mid + 已有 limit 记录):
    archive_session(leaf.session_id)
    fork_session(from=parent_session, up_to=verdict.suggested_fork_from_uuid)
    tree-state.js leaf set-status <tree_id> <leaf_id> pruned
    tree-state.js leaf add <tree_id> --json '{...新 leaf，role+i2...}'
    tree-state.js drift append ... --action prune --fork-to <new_leaf_id>
```

**验收 Agent prompt 骨架**：
```text
任务：验收子会话产出是否符合任务契约。
输入: {leaf_id, brief, dod, deliverables_paths, self_check, drift_history}
检查:
  1. deliverables 是否存在且满足 dod.min_length 和 must_contain
  2. self_check 项目是否全部 pass=true
  3. drift_history 中有无未解决的 severity≥mid 偏差
  4. 如有偏差，从哪个里程碑开始偏（suggested_fork_from_uuid）
输出: {pass: bool, gaps: [...], severity: "low|mid|high", suggested_fork_from_uuid: "..."}
```

---

### 10.6 v0.2 MVP 必做项

| # | 项 | 实现位置 |
|---|---|---|
| 1 | **S3 修复（rename 重试）** | `tree-state.js` `atomicRename` 函数 |
| 2 | **心跳 automation 配置模板** | `skills/tree-commander/SKILL.md` §9 |
| 3 | **哨兵 Agent prompt 模板** | `skills/tree-commander/SKILL.md` §10 |
| 4 | **内部自审流程（里程碑后必须）** | `skills/tree-worker/SKILL.md` 铁律 3 升级 |
| 5 | **三档纠偏执行流程** | `skills/tree-commander/SKILL.md` §8 更新 |
| 6 | **验收 Agent prompt 模板** | `skills/tree-commander/SKILL.md` §11 |

---

### 10.7 v0.2 验收条件（S2 测试方案草稿）

S2 测试覆盖三个场景：

**S2a：心跳唤起（哨兵检测 + status_check 发送）**
- 前提：有 active 叶子超过 5 分钟无活动
- 验证：automation 触发后 `heartbeat_log` 有新记录，`stale` 叶子收到 `status_check` 消息

**S2b：内部自审触发（里程碑后自查 + 纠偏）**
- 前提：里程碑产出意图偏离
- 验证：`drift_history` 有 `self_correct` 或 `declare` 记录

**S2c：三档纠偏执行（轻档 nudge → 中档 limit 升级）**
- 前提：子会话产出有 mid 级偏差，且近 30 分钟已收过 nudge
- 验证：`leaf.autonomy_overrides` 被设置，`drift_history` 有 `limit` 记录

---

## 修订历史

| 日期 | 版本 | 主要变更 |
|---|---|---|
| 2026-06-18 | v1.0 | 初版设计完成。4 个架构补丁 + 9 章节 + 附录 A 完整 spec |
| 2026-06-18 | v1.1 | v0.1.1-C：§6.5 prefix 正则明确为 `[a-z][a-z0-9_]{3,7}`，同步修附录 A.4/A.8 和负例表格；添加 §10 v0.2 实施规范（S3 修复 + 心跳 + 内审 + 三档纠偏 + S2 验收草稿） |
| 2026-06-18 | v1.2 | v0.1.1-S3 已修复到 tree-state.js（writeState 中 rename 改为 5 次重试+指数退避）；同步创建 tree-commander SKILL.md 和 tree-worker SKILL.md（v2.0，首次创建，合并 v0.1+v0.2）；code-reviewer 审计后微调 §A.6 DRIFT_ACTION_ENUM 补齐 `handoff` |
| 2026-06-19 | v1.3 | Q1 v1.1 架构落地：ROLE_ENUM(root/commander/worker)、E_CHILDREN_NOT_DONE、E_DEPTH_EXCEEDED、migrate 子命令、Leaf Purity + 分布式写入原则；审计驱动修订 |
