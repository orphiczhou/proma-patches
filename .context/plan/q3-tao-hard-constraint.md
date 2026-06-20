# Q3：天道运行官 — 硬约束流程执行体系

> 版本: v1.2（第 2 轮审计修订版） | 日期: 2026-06-20 | 状态: 方案定稿
> 审计: 2轮 × 4维 AgentTeam 并行审查, 第2轮新发现占比 37%→v1.2修复→预期收敛至<30%
> 依赖: Layer 1 (MCP 补丁 A-K v0.16.5) + Layer 2 (tree-state.js v0.2.2 + 方法论 v1.2)

---

## 一、问题诊断：软约束为什么不够

### 1.1 现象

Q1 v1.1 全深度验证（q1full, 10 leaf, 38/38 通过）在**树形结构**层面验证了 role/深度/E_CHILDREN_NOT_DONE 等机制，但执行过程中暴露出软约束体系的致命缺陷：

| 现象 | 根因 |
|------|------|
| Commander 跳过里程碑审计 | 方法论写的是"应该做"，不是"必须做" |
| Worker 自说自话"做完了"直接写回报告 | done 上报时无人验证证据真实性 |
| 各层"开口不闭环" | 每一层都有选择性忽略方法论的自主权 |
| 长时间 stall 无人推动 | 没有外部推力，Agent 等下一轮用户消息 |

### 1.2 根因

方法论的载体是 Markdown + SKILL.md + 提示词。对 Agent 来说，这些是**建议**——Agent 在对话中可以自主决定"我觉得 OK 了，可以跳过这一步"。

tree-state.js 虽然有一些硬校验（E_CHILDREN_NOT_DONE、ROLE_ENUM），但它只校验**数据形状**，不校验**执行过程**。它管"账本记对了没"，不管"你是不是真的做了这些事"。

### 1.3 天道要解决的

**把方法论中的"XX 角色应该做 YY"从文档变成代码——不可跳过、不可敷衍、不可造假。**

---

## 二、天道定位

### 一句话

**天道是流程警察，不是内容评委。**

### 执法边界（声明式）

```
✅ 归天道管（流程合规）：
  "你有没有做 self_audit？"
  "你的 dod 有 5 条，self_check 只回了 3 条——另外 2 条呢？"
  "你声称产出了文件 X，我检查了，文件不存在。"
  "你已经 120 秒没进展了，按计划下一步应该是什么？"
  "你的 self_audit 是自己一个人做的还是派了 ≥4 个独立审查子会话？"

❌ 不归天道管（内容质量）：
  "你的设计方案合理吗？"
  "你的代码写得好不好？"
  "你的分析是不是对的？"
  "你是不是真的遇到了 blocker？"（这是内容判断，超出 Flash 能力边界）
```

### 为什么这个边界重要

流程合规是**可穷举的**——方法论里有多少条规则，就有多少个检查项。
内容质量是**开放域的**——需要强模型、需要专业判断，留给 self_audit 负责。
天道不替代 self_audit。天道审计"self_audit 有没有按规定做"。

### 与 self_audit 的关系（明确化）

```
每个节点完成工作 → 自己做 self_audit → 天道验证 self_audit 的合规性

天道审的是：
  □ self_audit 记录是否存在
  □ self_audit 是否由 ≥4 个独立审查子会话执行（Commander 铁律 5）
  □ self_audit 的 checklist 是否逐条回应（不是一两句话敷衍）
  □ 声称的证据（文件路径/session_id）是否真实可查
  □ dod.quality_gates 和 self_check 条目数是否一致（gate_id 一一对应）
  □ self_check 每条的 verdict 是否为 pass/fail/na（而非空或 "OK"）

天道不审的是：
  ✗ self_audit 的结论对不对
  ✗ self_check 的 pass/fail 判定是否准确
  ✗ Agent 是否真的"理解"了任务
```

---

## 三、架构设计

### 3.1 总体结构

```
                ┌─────────────────────────────────────────┐
                │    天道运行官（TAO Watcher）              │
                │  一个独立 Proma Agent 会话 + 定时任务     │
                │  Channel: DeepSeek官方, Model: V4 Pro    │
                │                                          │
                │  ┌─────────────────────────────────────┐ │
                │  │ ① 心跳鞭策器（Pulse）               │ │
                │  │   Proma automation, interval=30s    │ │
                │  │   stall 检测 → 鞭策消息注入          │ │
                │  │   wait=true 顺序发送（避免I3竞态）   │ │
                │  ├─────────────────────────────────────┤ │
                │  │ ② 合规审计器（Auditor）             │ │
                │  │   leaf done 后触发                  │ │
                │  │   事后审计（非事前阻断——见§7.2）     │ │
                │  │   调 Flash Agent 跑 checklist        │ │
                │  │   pass → 放行 / fail → 打回         │ │
                │  ├─────────────────────────────────────┤ │
                │  │ ③ 审计调度器（Audit Dispatcher）    │ │
                │  │   create_session(flash)              │ │
                │  │   注入方法论规则 + 目标上下文          │ │
                │  │   跑 checklist → 写回 audit_log       │ │
                │  └─────────────────────────────────────┘ │
                │                                          │
                │  ④ 自检（Health Check）                  │
                │     automation cron 每分钟检查天道心跳   │
                │     天道失能 → 通知根会话                │
                └──────────┬──────────────┬────────────────┘
                           │              │
              ┌────────────┼──────────────┼────────────┐
              ▼            ▼              ▼            ▼
         Commander A  Commander B     Worker C     Worker D
         (self_audit) (self_audit)   (self_audit) (self_audit)
                       │
              ┌────────┴────────┐
              ▼                 ▼
         Root (也是 leaf)   所有 leaf 受监督
         role=root          (包括 root 自身)
```

### 3.2 三个子系统的职责（v1.2 修订）

| 子系统 | 职责 | 触发时机 | 技术实现 |
|--------|------|---------|---------|
| **Pulse（鞭策）** | 检测 stall → 推动继续 | Proma automation, interval=30s, **sessionMode=daily** | `list_sessions` + `list_messages` + `send_message(wait=true)` 顺序发送；**每轮从 tree-state.json 重建世界模型** |
| **Auditor（审计）** | done 后合规检查 | 天道主动轮询发现需审计的 leaf（leaf 被 `audit-gate --verdict required` 拦截后无法自调 done） | 事后审计 → Flash Agent 跑 checklist → pass 则 `audit-gate --verdict pass` 放行 / fail 则打回 |
| **Audit Dispatcher** | 创建轻量审计会话 | Auditor 触发 | `create_session(flash/fallback)` + `send_message(audit_prompt, wait=true)` |

### v1.1 架构关键修订（vs v1.0）

| v1.0 | v1.1 | 审计来源 |
|------|------|---------|
| while(true) 无限循环 | **Proma automation 定时任务**（interval=30s） | A-3 发现 1 |
| Gatekeeper 拦截 set-status done | **事后 Auditor**：leaf done 后触发审计，不通过则打回（tree-state.js 加入 `TAO_AUDIT_REQUIRED` 环境变量检查） | A-3 发现 2,4 |
| send_message(wait=false) 并发鞭策 | **wait=true 顺序发送**（避免 I3 竞态丢消息） | A-3 发现 3 |
| 无 Watcher 自恢复 | **外部健康检查**：每分钟查天道心跳，失能 → 通知根会话 | A-1 发现 1 |
| Root 节点不在监督范围 | **Root 也是 leaf**，纳入 Pulse 轮询 + Auditor 审计 | A-1 发现 8 |
| Flash 唯一模型无 fallback | **Flash 主模型 + 纯规则引擎降级**（字符串匹配 fallback） | A-3 发现 9 |

---

## 四、规则提取方法论

### 4.1 提取原则（v1.1 新增）

**从四个权威文档中提取所有含"必须""严禁""绝不""铁律""强制"措辞的条款**，每条翻译为一个可操作的检查项：

1. commander-methodology v1.2（13条原则）
2. tree-commander SKILL v2.2（铁律 + 禁止 + 规范）
3. tree-worker SKILL v2.2（铁律 + 禁止 + 规范）
4. tree-commander-design v1.3（5件套契约结构）

**v1.1 新增覆盖**（v1.0 遗漏的 5 条方法论原则 + 14 条 SKILL 必须条款）：

| 新增规则 ID | 来源 | 内容 |
|------------|------|------|
| C-11 | 方法论原则 1 + commander SKILL 铁律 1 | Commander 严禁直接读写 tree-state.json（所有操作走 CLI） |
| C-12 | 方法论原则 2 + commander SKILL 铁律 2 | Commander 严禁混用双轨——判断派 Agent 工具，执行派 fork/create_session |
| C-13 | 方法论原则 6 + commander SKILL 铁律 5 | 文档审计/验证场景必须 Fork ≥4 个独立审查子会话，禁止单人包办 |
| C-14 | 方法论原则 10 | 重要产出必须落盘到 .context/ 或指定路径 |
| C-15 | 方法论原则 11 | 叶子角色必须使用 create_session 创建（禁止 fork_session 创建 Worker） |
| W-10 | worker SKILL 铁律 3 | 每个 milestone 完成后必须 Fork code-reviewer 做独立自审 |
| W-11 | worker SKILL 铁律 5 | 大文件产出后禁止将全文读回对话历史（单条 assistant 消息 >5K 字符视为违规） |
| W-12 | worker SKILL 铁律 7 | 上行消息必须使用结构化 YAML（type: done/blocked/plan/brief_echo） |
| W-13 | worker SKILL 铁律 9 | 改动 out_of_scope 或 DoD deliverables 必须通过 blocked 消息请示 |
| R-05 | 方法论原则 3 | 根 Commander 必须确保整树走完"实施→回归测试→审计"三步质量门 |
| R-06 | 方法论原则 4 | 关键交付物必须经过独立验证（非产出 Agent 自身验证） |

### 4.2 规则验证方式规范化（v1.1 新增）

**每条规则的验证方式必须包含**：
- **数据源**：明确从哪个工具/文件取数据（如 `list_messages(session_id, limit=N)`）
- **查询方法**：具体到字段、索引、正则
- **判定逻辑**：明确的 pass/fail 条件（不含"判断是否合理"等主观措辞）

**禁止的验证措辞**：
- "逐条匹配"（无 gate_id 体系时不可执行）
- "复述了 dod"（"复述"无操作定义）
- "搜索关键词"（过于宽泛，假阳性率高）
- "判断是否合理/是否遇到 blocker"（内容判断，超出天道边界）

### 4.3 审计 Prompt 模板（v1.1 修订）

```
你是天道审计官。你的唯一职责是验证目标 Agent 是否按照规则完成了规定动作。
你不是在评价它的工作质量，你只是在检查它有没有做该做的事。

## 目标信息
- leaf_id: {leaf_id}
- role: {root|commander|worker}
- 父会话 UUID: {parent_session_id}  （用于过滤继承消息——fork 场景）
- 目标会话首条自身消息索引: {first_own_msg_idx}  （fork 场景中，此索引之前的消息为继承消息，不审）
- 产出消息: {前 3 条 + 最后 7 条 assistant 消息}  （共10条，约15K tokens）
- 关联文件: {声称产出的文件绝对路径列表}
- workspace_root: {目标 leaf 的 workspace 根路径}

## 规则清单（逐条验证，按角色选取）

{根据角色从规则库中选取对应的 checklist}

## 输出要求

**绝对禁止**：在 JSON 外加任何文字、markdown 代码块标记（```json）、注释。
**绝对必须**：回复以 { 开头，以 } 结尾，使用合法 JSON。

## 输出格式（含 Schema 约束）
{
  "pass": true/false,          // 是否全部规则通过
  "total": N,                  // 检查的规则总数
  "passed": N,                 // 通过的规则数
  "failed": N,                 // 失败的规则数
  "results": [                 // 逐条结果
    {
      "rule_id": "W-01",      // 规则ID，必填
      "pass": true,            // 布尔值，必填
      "evidence": "证据描述"   // pass=true 时必填，说明在哪里找到的证据
    },
    {
      "rule_id": "W-05",
      "pass": false,
      "reason": "失败原因"     // pass=false 时必填，说明为什么失败
    }
  ],
  "block_reason": "如果 pass=false，简述不能放行的原因；否则为 null"
}

## Few-shot 示例

输入：Worker leaf "q1full-F-worker"，简要执行记录，规则 W-01/W-05/W-06
输出：
{"pass":true,"total":3,"passed":3,"failed":0,"results":[{"rule_id":"W-01","pass":true,"evidence":"消息#3(assistant,ts=1781923...) 含 event: brief_echo YAML块"},{"rule_id":"W-05","pass":true,"evidence":"done消息含 self_check 字段，为数组，长度=4"},{"rule_id":"W-06","pass":true,"evidence":"self_check 4条，dod.quality_gates 4条，gate_id 全部对应"}],"block_reason":null}
```

---

## 五、分角色规则清单（v1.2 修订版，共 35 条）

### 5.1 Commander 规则（16 条）

| ID | 规则 | 数据源 | 查询方法 | 判定逻辑 |
|----|------|--------|---------|---------|
| C-01 | 收到任务后必须创建 plan（含 milestones 列表） | TaskCreate 工具调用记录 或 plan 上行消息 | 检查 TaskList 返回的 tasks 数量 ≥2，或搜索消息中 `sub_missions` 数组 | tasks>=2 或 sub_missions.length>=1 → pass |
| C-02 | 每个 milestone 的 expect_outputs 必须非空 | tree-state.json milestones 数组 | `leaf get` 读取所有 milestone，检查 expect_outputs 字段 | 所有 milestone.expect_outputs 非空字符串 → pass |
| C-03 | 每个 milestone 完成后必须调用 `milestone set-result` | tree-state.json milestones 数组 | 检查每个 milestone.status | 所有 milestone.status === "done" → pass |
| C-04 | self_audit 消息的 list_messages 索引 < 第一个 send_message(子会话, 含 brief) 的索引 | 源会话 list_messages | 搜索 "self_audit" 或 "自审" 消息索引 → 搜索第一条含 "brief:" 的 send_message 调用索引 → 比较 | self_audit_idx < first_send_idx → pass |
| C-05 | 发给子会话的首条 send_message 必须含 5 段 YAML（brief/dod/report/autonomy/self_audit） | 对子会话的 list_messages(limit=1) | 解析首条 user 消息，搜索 5 个顶层 YAML key | 5 个 key 全部存在且值非空 → pass |
| C-06 | 所有子节点 done 后方可声明自己的 done | tree-state.js `leaf set-status done` 返回值 | CLI 返回 ok 而非 E_CHILDREN_NOT_DONE | 返回 ok → pass |
| C-07 | done 消息必须附 self_audit 报告（匹配正则 `/self[ _-]?audit\|自审\|自查报告/i`） | 源会话 list_messages 最后 10 条 | 正则匹配 + 检查匹配到的消息中含 pass/fail 判定或逐条 gate 结论 | 正则命中 且 含判定 → pass |
| C-08 | self_audit 必须逐条回应 dod.quality_gates（按数组索引对齐，不要求 gate_id） | done 消息 + root_dod | 提取 self_audit 的检查结论数组 + dod.quality_gates 数组 → 比对数组长度 + 逐索引检查 pass/fail 存在 | 长度相等 且 每条有 verdict → pass（v1.2：改用索引对齐，消除 gate_id 前提依赖） |
| C-09 | 声称的产出文件绝对路径必须真实存在 | done 消息中的 deliverables 路径列表 | Read(绝对路径) 逐一验证 | 全部文件存在 → pass；ENOENT → fail；EACCES → warn |
| C-10 | 若 leaf add 的 role=commander，brief 必须含 `max_commander_depth` 字段且值 ≤2 | 对子 Commander 的 send_message 首条 | 解析 brief YAML 中 max_commander_depth 字段 | 字段存在且 ≤2 → pass |
| C-11 | **（v1.1 新增）** Commander 严禁直接 Read/Write tree-state.json | 源会话 Bash/Read/Write 调用历史 | 搜索包含 "tree-state.json" 的 Read/Write/Bash 调用 | 无直接操作 → pass |
| C-12 | **（v1.2 修订）** Commander 严禁混用双轨——判断用 Agent 工具，执行用 fork/create_session | 源会话 Agent 工具调用 + fork/create_session 记录 | (a) 检查 Agent() 调用次数 > fork+create 次数 → 判定为"判断轨过重/可能混用"；(b) 检查是否存在 fork/create_session 的 task 含 "分析/审查/评估/审计/判断/规划" 等判断动词 → 执行轨混入判断。两者满足任一 → fail | 两种判定均为 fail → fail（v1.2：从开放式动词列表改为双向计数检查+执行轨混入检查，消除字符串匹配歧义） |
| C-13 | **（v1.1 新增）** 文档审计/验证场景必须 Fork ≥4 个独立审查子会话 | tree-state.json leaves | 筛选 role=worker 且 brief 含 "review/审计/审查" 的 leaf，统计数量 | worker 审查 leaf ≥4 → pass |
| C-14 | **（v1.1 新增）** 重要产出必须落盘到磁盘（.context/ 或指定路径） | done 消息 deliverables 列表 | 对每个 deliverable 调用 Read 验证文件存在 + 行数 ≥10 | 全部存在且非空 → pass |
| C-15 | **（v1.1 新增）** 禁止用 fork_session 创建 role=worker 的 leaf | tree-state.json leaf 的 session 创建方式 | `get_session_info(session_id)` 检查 source_session_id 字段 | create_session 创建（无 source_session_id）→ pass；fork 创建 → fail |
| C-16 | **（v1.2 新增）** 发给子会话的契约消息（含 brief 的 send_message）长度禁止 <100 字符（"一句话任务"违规） | Commander 的 send_message 调用记录 | 筛选目标为子会话的 send_message，检查 message 参数长度 | 全部 ≥100 chars → pass（对应 commander SKILL §11 禁止 #2） |

### 5.2 Worker 规则（13 条）

| ID | 规则 | 数据源 | 查询方法 | 判定逻辑 |
|----|------|--------|---------|---------|
| W-01 | 首条自身 assistant 消息必须含 `event: brief_echo` YAML 块 | 目标会话 list_messages(limit=50)，筛选 role=assistant | 按 timestamp 升序取第一条自身消息，搜索 "event:" 后紧邻 "brief_echo" | 命中 → pass |
| W-02 | brief_echo 必须包含 `dod_essence` 字段且非空且 ≥20 字符 | brief_echo YAML 块 | 解析 brief_echo，提取 dod_essence 字段，检查长度 | 存在且 len≥20 → pass |
| W-03 | milestones 必须按 M1,M2,M3... 顺序排列且全部 status=done | done 消息中的 milestones 数组 | 逐一检查：M1.status=done, M2.status=done...，无跳过 | 全部 done 且 ID 连续 → pass |
| W-04 | done 消息中的每个 milestone 必须含 note_path 且对应文件存在 | done 消息 milestones 数组 | 提取 note_path → 拼接 workspace_root 绝对路径 → Read 验证 | 全部文件存在 + 行数≥10 → pass |
| W-05 | done 消息必须含 self_check 字段（YAML key），值为数组且长度 ≥1 | done 消息 | 解析 YAML，检查 self_check 是否为数组 + 长度 + 每项含 item/pass 字段 | 数组长度≥1 且 每项含 item/pass → pass |
| W-06 | self_check 条目数必须等于 dod.quality_gates 条目数（按数组索引对齐） | done 消息 self_check + dod.quality_gates | 提取 self_check 数组长度 + quality_gates 数组长度 → 比对；逐索引检查 self_check[i].pass 存在 | 长度相等 且 每索引有 pass 值 → pass（v1.2：改用索引对齐） |
| W-07 | 声称的产出文件绝对路径必须真实存在 | 同 C-09 | 同 C-09 | 同 C-09 |
| W-08 | 不得执行任何修改 tree-state 的 CLI 命令 | 目标会话 Bash 调用历史 | 搜索是否含 tree-state.js 的写命令（leaf add/set-status, milestone add/set-result, event/drift/heartbeat/segment append, init, backup, restore） | 无写命令 → pass |
| W-09 | **（v1.1 降级）** 连续 ≥3 次同类工具调用失败（同一工具+同类错误）且未见 blocked 消息 | 目标会话工具调用历史 | 搜索连续的 error 返回，检查其后是否有 blocked YAML 消息 | 无连续≥3次同类错误 或 有blocked → pass |
| W-10 | **（v1.2 修订）** 每个 milestone 完成后必须 Fork code-reviewer 做独立自审 | 目标会话 fork_session 调用 + milestone set-result 时间戳 | 检查每个 milestone 的 set-result 时间前后 **120 秒窗口**内是否有 fork_session 调用（±120s） | 每个 milestone 在时间窗口内对应 ≥1 次 fork → pass（v1.2：时间窗口从"附近"精确化为±120s。fork 的具体用途无法从调用参数判断——此为已知限制） |
| W-11 | **（v1.1 新增）** 单条 assistant 消息长度禁止 >5K 字符 | 目标会话 list_messages | 逐条检查 assistant 消息的 text 长度 | 全部 ≤5000 chars → pass |
| W-12 | **（v1.1 新增）** 上行消息 type 必须是 done/blocked/plan/brief_echo 之一 | 目标会话的上行消息 | 解析每条上行消息的 event 字段 | 全部 event ∈ {done,blocked,plan,brief_echo} → pass |
| W-13 | **（v1.2 降级）** done 消息的 blocked_history 数组必须记录所有超过 brief 原定范围的产出说明 | done 消息的 blocked_history 字段 | 检查 done 消息 YAML 中 blocked_history 是否为数组；若 deliverables 中任何文件路径不在 brief.in_scope 描述的关键词集中（精确字符串匹配），则要求 blocked_history 非空 | blocked_history 数组 ≥ out_of_scope 疑似命中数 → pass（v1.2：从语义判断降级为字段存在性检查+文件名关键词匹配。不判内容，只判是否留下请示记录） |

### 5.3 Root 规则（6 条）

| ID | 规则 | 数据源 | 查询方法 | 判定逻辑 |
|----|------|--------|---------|---------|
| R-01 | 必须是唯一的 root（parent=null 且 role=root） | tree-state.js validate | validate 已校验 | 引用 validate 结果 |
| R-02 | **（v1.1 改写）** 第一个 leaf add 之前，必须存在 TaskCreate tasks≥2 或含 ≥2 子任务拆解的消息 | TaskList 或根会话消息 | TaskList count≥2，或搜索消息中 my_mission/in_scope 结构 | tasks≥2 或 子任务≥2 → pass |
| R-03 | **（v1.1 改写）** 存在整合 leaf（role:commander/worker, parent=root, brief 含 "integrate/整合" 关键词, done时间晚于其他 leaf） | tree-state.json leaves | 筛选整合 leaf，检查 done 时间 > 所有非整合 leaf 的 done 时间 | 存在符合的整合 leaf → pass |
| R-04 | **（v1.1 改写）** 所有 Worker leaf 的 milestone audit_pass 必须全部为 true | tree-state.js `leaf list-all` | 检查每个 role=worker 的 leaf 的 milestones[*].audit_pass | 全部 true → pass |
| R-05 | **（v1.1 新增）** 整树必须走完三步质量门（实施→回归测试→审计） | tree-state.json events + audit_log | 检查是否存在：实施阶段 leaf done + 回归测试 leaf done + 审计 leaf done | 三个阶段都有对应 done leaf → pass |
| R-06 | **（v1.1 新增）** 关键交付物必须经过独立验证（非产出 Agent 自身） | tree-state.json leaves | 检查交付物对应的验证 leaf 的 session_id ≠ 交付 leaf 的 session_id | 验证者≠产出者 → pass |

---

## 六、鞭策规则（v1.1 修订）

### 6.1 Stall 判定

| 条件 | 判定 |
|------|------|
| leaf status=active 且最后 assistant 消息 > 90 秒前 | stall |
| leaf status=active 且 milestones 全部 done 但 status 未 done | 遗忘 done |
| leaf status=active 且无任何 milestone | 违规（需 Commander 介入） |
| leaf 有 blocked 消息但 > 120 秒无后续 | 需 Commander 介入 |
| Commander 子节点全部 done 但自身未 done | 遗忘整合 |
| **（v1.1 新增）** Root status=active 且最后消息 > 120 秒前 | Root stall |

### 6.2 鞭策消息格式

```
[天道鞭策 #{N}]
目标: {leaf_id} (role={role})
触发规则: {rule_id} {规则描述}
上次活跃: {时间} (距今 {N} 秒)
当前状态: {status}, milestones: {完成数}/{总数}

下一步要求: {具体指令}

已记录鞭策事件到 tree-state drift_log。
回复 "done" 或 "blocked" 或继续执行。3 次鞭策无响应将标记为 E_STALL_TIMEOUT。
```

### 6.3 升级路径

```
鞭策 1: 温和提醒 (Nudge)
鞭策 2: 警告 (Warning)
鞭策 3: 最终通知 (Final) → 标记 E_STALL_TIMEOUT
E_STALL_TIMEOUT → 向上冒泡：
  Worker stall → 通知父 Commander
  Commander stall → 通知祖父 Commander → ... → 最终到达 Root
  Root stall → 通知天道 → 天道通知用户（send_message 到根会话）
```

### 6.4 鞭策发送策略（v1.1 修订）

**使用 `send_message(wait=true)` 顺序发送**，避免 I3 已知竞态（并发 wait=false 丢消息）。多 leaf 同时需鞭策时，串行发送（每个阻塞 ~5-10 秒），不影响总体延迟（90 秒 stall 阈值远大于鞭策耗时）。

---

## 七、技术实现（v1.1 修订）

### 7.1 依赖清单

| 能力 | 所用工具 | v1.1 变更 |
|------|---------|----------|
| 定时触发 | `mcp__automation__create_automation`（Proma 持久化定时任务） | **替代 while(true)** |
| 天道自检 | 第 2 个 automation，每分钟检查天道心跳（`list_messages(watcher, limit=1)` 响应时间） | **v1.1 新增** |
| 轮询所有 active leaf | `list_sessions` + `list_messages` | 不变 |
| 鞭策消息注入 | `send_message(target, wait=true)` 顺序发送 | **wait=false → wait=true** |
| 创建审计子会话 | `create_session(flash/fallback)` | 新增 fallback |
| 读取目标上下文 | `list_messages(target, limit=50)` | limit=200 → limit=50 |
| 验证文件存在 | `Read(绝对路径)`，拼接 workspace_root | 新增绝对路径拼接 |
| 写入审计记录 | tree-state.js `audit append` + `nudge append`（v0.2.2 新增命令） | **v1.1 需扩展 tree-state.js** |
| done 前置检查 | tree-state.js `set-status done` 入口检查 `TAO_AUDIT_REQUIRED` 环境变量 | **v1.1 新增** |

### 7.2 Auditor 模式：事后审计 + audit-gate 子命令（v1.2 修订）

**v1.0 的"拦截器"设计不可行**（tree-state.js 是裸 CLI）。v1.1 的环境变量方案有跨进程语义问题（A-3-R2 #10）。v1.2 采用更可靠的 `audit-gate` 子命令：

**第一层（前置检查——tree-state.js v0.2.2 新增 `audit-gate` 子命令）**：

```bash
# 天道审计通过后调用
node tree-state.js audit-gate <tree_id> <leaf_id> --verdict pass --audit-session-id <uuid>

# leaf 被拦截时（verdict=required，初始状态）
node tree-state.js audit-gate <tree_id> <leaf_id> --verdict required
```

tree-state.js 在 leaf 对象中新增 `audit_gate: { verdict: "required"|"pass"|"skip", auditor_session_id: null|uuid, ts: ISO }` 字段。`set-status done` 入口检查此字段：`verdict !== "pass"` 时拒绝并返回 `E_GATEKEEPER_REQUIRED`。

**为什么比环境变量更可靠**：(a) 持久化到 tree-state.json，可追溯；(b) 不依赖跨进程语义——天道修改的是文件，leaf 读的也是文件；(c) audit-gate 标记在文件中有时间戳和审计会话 ID，形成审计证据链。

**第二层（事后审计——天道 Auditor）**：
天道 automation 每轮轮询时检测以下"需审计"信号：
- leaf 的 `audit_gate.verdict === "required"`（leaf 尝试 done 被拦截）
- leaf 的 `list_messages` 最后 N 条中含 done 声明但 `audit_log` 无对应记录
- leaf 的 `status === "active"` 且 `milestones` 全部 `audit_pass=true`（可能即将 done）

**发现延迟**：leaf 被拦截后，天道最多 30s 后（下次 automation 触发）发现。被拦截的 leaf 应通过 send_message 告知父 Commander "awaiting TAO audit"，避免父 Commander 误判 stall。

**为什么不直接改成事前**：审计需要调 LLM（Flash Agent），耗时 ~5 秒，不能同步阻塞 CLI。前置检查只验证"天道是否已审过"，不自己审。

### 7.3 天道主循环（automation prompt 模板，v1.2 修订）

**执行模型**：Proma automation，`interval=30s`，`sessionMode=daily`。每天第一触发创建新 Agent 子会话，上下文清零。天道每次醒来从 tree-state.json 重建世界模型，不存在跨轮内存依赖。

**Bootstrap 协议（每轮起始）**：
```
1. 读取 tree-state.json：确定 tree_id、_meta.workspace_root、_meta.tao_watcher_session_id
2. 筛选 status="active" 的 leaves（含 Root, parent=null, role=root）
3. 检查每个 leaf 的 audit_gate 字段（verdict="required" → 需审计）
4. 检查每个 leaf 的 audit_log（有 pass 记录但 status 非 done → 补调 set-status done，无需重审）
```

**主循环 prompt**：
```
你是天道运行官。工作区根: {workspace_root}（从 tree-state._meta.workspace_root 读取）

1. Bootstrap（见上），从 tree-state.json 重建世界模型。

2. Stall 检测 —— 对每个 active leaf：
   - list_messages(leaf.session_id, limit=5)
   - 若最后 assistant 消息 > 90s 前且 leaf.nudge_count < 3:
     send_message(target, nudge_msg, wait=true) 顺序发送
   - 若 nudge_count >= 3:
     send_message(parent, escalation_msg, wait=true) 向上冒泡
     标记 E_STALL_TIMEOUT

3. 审计调度 —— 对每个"需审计"的 leaf（audit_gate.verdict="required" 或 audit_log 中无记录但最后消息含 done 声明）：
   - 若 Flash 可用: create_session(deepseek-v4-flash) → 注入审计 prompt → wait=true
   - 解析返回 JSON（4 级防御式解析，§7.6）→ pass 则 audit-gate --verdict pass → set-status done；fail 则打回
   - 若 Flash 不可用: 降级为纯规则引擎
   - 写入 audit_log

4. 写入树状态：
   - node tree-state.js audit-gate <tree_id> <leaf_id> --verdict pass|fail --audit-session-id <uuid>
   - node tree-state.js audit append <tree_id> <leaf_id> --json '{...}'
   - node tree-state.js nudge append <tree_id> <leaf_id> --rule-id <id> --nudge-count <N>

5. 性能预算：单轮最多审计 5 个 leaf（优先 Worker 再 Commander），最多鞭策 5 个 leaf。超出则排队到下一轮。

6. 跨轮幂等：审计前检查 audit_log——若已有本轮（同 ts 区间）的审计记录，跳过。

降级模式（Flash 不可用）：仅检查可字符串匹配的 8 条规则：
C-06, C-09, C-11, C-15, W-07, W-08, R-01, W-01（简化版：仅检查 "brief_echo" 字符串存在）
C-08, W-05, W-06 在降级模式下标为 "degraded_unverified"，不判定 fail。
```

### 7.4 自检机制

第二个 Proma automation，每分钟运行：

```
你是天道自检官。执行以下检查：
1. list_messages(天道主会话ID, limit=1)
2. 若最后一条消息时间戳距今 > 120 秒 → 天道失能
3. 发送 send_message(根会话, "[天道自检] 天道运行官失能，需人工介入。最近活动: {timestamp}")
```

**不创建第二个完整天道**（无限递归问题），仅做心跳检测 + 报警。

### 7.5 Fork 会话消息边界处理（v1.1 新增）

Fork 创建的子会话继承父的全部消息历史。审计时须区分继承消息和自身产出：

1. 调用 `get_session_info(child_session_id)` 获取 `source_session_id`
2. 若存在 `source_session_id`（说明是 fork 创建的），找到 `first_own_msg_idx`
3. 审计 prompt 中传入 `parent_session_id` + `first_own_msg_idx`
4. 审计 Agent **仅评估 first_own_msg_idx 及之后的消息**

### 7.6 审计 JSON 解析容错（v1.1 新增）

```
function parseAuditResult(rawReply) {
  // 1. 尝试直接 JSON.parse
  try { return JSON.parse(rawReply); } catch(e) {}

  // 2. 尝试提取 markdown code fence 中的 JSON
  const fenceMatch = rawReply.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch(e) {}
  }

  // 3. 尝试正则匹配第一个完整 JSON 对象
  const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch(e) {}
  }

  // 4. 全部失败 → 重试 1 次 → 再次失败 → 默认拒绝（fail-safe）
  return { pass: false, total: 0, passed: 0, failed: 0,
           results: [], block_reason: "AUDIT_PARSE_ERROR: 审计 Agent 返回了无法解析的输出" };
}
```

### 7.7 新增文件

| 文件 | 类型 | 行数 |
|------|------|------|
| `.context/trees/tao-rules.json` | 规则库（JSON，34条规则含数据源/查询方法/判定逻辑） | ~300 行 |
| `.context/trees/tao-audit-prompt.md` | 审计 Agent prompt 模板（含 JSON Schema + few-shot） | ~120 行 |
| `.context/trees/tao-nudge-template.md` | 鞭策消息模板 | ~60 行 |
| `.context/trees/tao-watcher-prompt.md` | 天道 automation prompt（§7.3 的完整版） | ~80 行 |
| `.context/trees/tao-health-check-prompt.md` | 自检 automation prompt | ~30 行 |

### 7.8 tree-state.js 修改（v0.2.1 → v0.2.2）

**不属于补丁体系，是 Layer 2 独立脚本增强**：

1. `_meta` 新增 `workspace_root` 字段：`init` 命令从 `TREES_ROOT` 推导并写入绝对路径。**解决审计 Agent 无法定位 workspace 的问题**（A-3 #5）
2. `cmdLeafSetStatus` 新增 `audit_gate` 字段检查：`verdict !== "pass"` 时拒绝 done（替代环境变量方案）
3. 新增 `cmdAuditGate` 子命令：`audit-gate <tree_id> <leaf_id> --verdict pass|fail|required|skip --audit-session-id <uuid>`
4. 新增 `cmdAuditAppend` 子命令：`audit append <tree_id> <leaf_id> --json '{...}'`
5. 新增 `cmdNudgeAppend` 子命令：`nudge append <tree_id> <leaf_id> --rule-id <id> --nudge-count <N>`
6. 新增 `cmdNudgeReset` 子命令：`nudge reset <tree_id> <leaf_id>`

**不修改 main.cjs。不修改 proma-dev-patches.cjs。不修改任何补丁。**

### 7.9 新增 tree-state 字段

```
leaves[leaf_id]:
  audit_gate: { verdict, auditor_session_id, ts }  // v1.2: 替代环境变量方案
  nudge_count: number
  nudge_log: [{ts, rule_id}]
  audit_log: [{
    ts: ISO,
    auditor_session_id: uuid,
    degraded: bool,
    total: N, passed: N, failed: N,
    results: [{rule_id, pass, evidence_or_reason}]
  }]

_meta:
  workspace_root: "/absolute/path"   // v1.2新增：init时从TREES_ROOT推导
  tao_version: "v0.1-TAO"
  tao_watcher_session_id: uuid
  tao_health_check_session_id: uuid
```

---

## 八、与 Q2 的关系

Q2（侧边栏树形可视化面板）和 Q3 是互补关系：

- **Q2 做"看"**：把树的状态画出来，让人一眼看到哪个 leaf 卡住了、哪个通过了
- **Q3 做"管"**：确保每一层都按规定执行，不开口、不造假

Q2 的树形 UI 面板上可以直接展示天道的审计状态（绿色=pass、黄色=鞭策中、红色=stall_timeout、灰色=degraded），两个结合后，用户打开 Dev 版侧边栏就能看到整棵树的健康状态。

**实施顺序建议**：Q3 先做（解决当前的执行质量痛点）→ Q2 再做（可视化锦上添花）。

---

## 九、MVP 范围（v0.1-TAO）

### 必做

1. **规则库** `tao-rules.json`：34 条规则（Commander 15 + Worker 13 + Root 6），每条含数据源/查询方法/判定逻辑
2. **tree-state.js v0.2.2**：4 个新子命令 + TAO_GATEKEEPER_PASS 前置检查
3. **鞭策循环**：Proma automation（interval=30s）+ 90s stall 判定 + 3 级鞭策 + 向上冒泡
4. **done 审计**：事后 Auditor + Flash Agent checklist + pass/fail 判定
5. **审计证据链**：audit_log 字段 + nudge_log + drift_log
6. **自检**：第 2 个 automation 心跳检测 + 失能报警
7. **降级模式**：Flash 不可用时纯规则引擎 fallback（覆盖 11 条可字符串匹配的规则）

### 不做（v0.2-TAO+）

- Plan 前置审计（Commander 规划阶段就审计，而非仅 done 时审计）
- blocked 消息智能路由到父 Commander（当前仅向上冒泡 stall 升级）
- E_STALL_TIMEOUT 后自动 archive + 重建 leaf（当前仅通知父 Commander 人工处理）
- 天道深度自检（第二个完整天道——无限递归，v0.1 仅做心跳检测 + 报警）
- Q2 UI 面板集成

---

## 十、已知限制与风险

| 限制 | 严重度 | 缓解措施 |
|------|--------|---------|
| 事后审计模式——违规可能已发生 | 中 | audit-gate 子命令阻止未审计的 done；发现违规后打回修正 |
| W-09 降级——无法检测隐式 blocker | 低 | 仅检测显式信号（连续同类错误）；真正的方向性偏差由 Commander self_audit 发现 |
| Flash 模型 JSON 输出不稳定 | 中 | 4 级防御式解析 + 1 次重试 + fail-safe 默认拒绝 |
| 鞭策 wait=true 串行延迟 | 低 | 90s stall 阈值远大于鞭策耗时；单轮最多鞭策 5 个 leaf |
| 无深度自检 | 中 | 心跳检测 + 报警；深度自检留待 v0.2 |
| 假合规（Agent 学会 checklist 后机械填入关键词） | 中 | v0.1 不覆盖内容质量；W-11(消息长度)+C-14(文件行数)+C-16(契约长度) 三道形式关卡 |
| **v1.2 新增** 审计消息采样只取前3+后7条，中间 milestone 执行记录可能遗漏 | 中 | W-03/W-04 等规则的数据源优先取 tree-state.json 结构化 milestones 数组，消息仅作补充 |
| **v1.2 新增** W-10 fork 用途无法从调用参数判断（不知道 fork 的是不是 code-reviewer） | 低 | 时间窗口判断 fork 存在性（±120s）；用途验证为已知盲区 |
| **v1.2 新增** 方法论原则1"一切判断必须委托子 Agent"无法机械验证（需要内容理解） | 中 | C-16(契约长度≥100字符)间接防止"一句话任务"；原则1核心由 Commander 自律 + self_audit 负责 |
| **v1.2 新增** 三档递进纠偏（原则9/commander铁律4）无法机械验证——"重档剪枝"的触发条件需要判断产出质量 | 中 | 鞭策升级路径（nudge→warning→final→stall_timeout）覆盖了时间维度的递进；质量维度的递进留待 v0.2 |
| **v1.2 新增** gate_id 索引对齐方案要求 self_audit/self_check 条目与 dod.quality_gates 严格同序——如果 Commander/Worker 改变了条目顺序，会被误判 fail | 低 | 在 SKILL 中增加"self_check 条目必须与 quality_gates 保持相同顺序"的规范 |

---

## 十一、关键心智模型

```
天道不问"你做得好不好"，只问"你有没有按规定做"。

Commander/Worker 的 self_audit 是对内容负责。
天道的 Auditor 是对流程负责。

self_audit 不诚实 → 天道检测到 → 打回。
self_audit 诚实但内容差 → 天道放行 → 后果由 Commander 承担。
self_audit 不做 → 天道不放行 → 必须补上。

天道也是被监督的——自检 automation 每分钟看天道是否还活着。
天道失能 → 通知根会话 → 人工介入。
```

天道是**外挂式 + 轻量侵入式**的——主体不修改任何现有代码，仅 tree-state.js 增加 4 个新子命令 + 1 个环境变量检查（~80 行新增代码）。不需要新补丁、不改 main.cjs、不改 proma-dev-patches.cjs。
