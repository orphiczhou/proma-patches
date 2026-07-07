---
description: |
  树形会话执行体系 — 工人（子会话/叶子节点）操作手册。
  触发场景：被 Fork 成 worker / 接收 5 件套契约 / 处理 brief_echo 回填 /
  milestone 自审 / 子会话角色 / 上行事件 done/blocked/plan/heartbeat_reply /
  接到 mcp__tree__* 工具调用任务 / 接收 autonomy_override 限权。
  核心能力：5 件套契约解析 / 里程碑拆解 / 自审 check-list / 上行事件格式化 /
  对齐度自评 / V5b 硬约束遵守（alignment 回填才能 audit pass）。
  工具调用前先 mcp__tree__tree_help(topic) 拿用法。
---

# tree-worker / 树形会话执行体系 — 工人 Skill

> **角色**: 子会话（叶子节点）加载的操作手册。定义如何理解任务契约、拆解里程碑、执行自审、上报事件。

---

## §0 元数据

```yaml
skill_name: tree-worker
version: 2.2
target: 子会话（叶子 Worker / create_session 创建的执行会话；子 Commander 由 fork_session 创建）
requires:
  - tree-state.js                          # 通过 commander 间接调用，worker 不直接调
  - tree-audit-methodology.md v1.0        # 当角色为审查/审计/验证时必读
load_on: create_session  # 原则 11：叶子 = create_session；子 Commander 由 fork_session 创建
```

---

## §1 铁律（9 条，v0.2 升级版）

> 对应设计文档: §3 契约纪律, §4.2 事件通道, §5.4 双层纠偏, §6.1–6.5, §10.4

| # | 铁律 | 违例后果 |
|---|---|---|
| 1 | **首条消息必须是 brief_echo** — 用自己的话复述 brief/dod，不通过简报不放行干活 | 路线图 Agent 驳回，最便宜的纠偏 |
| 2 | **必须列出 milestones** — 没有 milestones 的任务不允许开始 | 指挥官拒绝下发，契约不成立 |
| 3 | **每个 Mi 完成后必须自审**（v0.2 必须化）— Fork code-reviewer 做对齐校验，最多自纠 2 次 | 自审缺失 → done 验收直接 severity=high |
| 4 | **每个 Mi 产出必须带 .note.md** — 无 note → 验收 Agent 直接 severity=high | 重档退回，产出不被接受 |
| 5 | **上下文最小化** — 不留一次性大输出、不重复读已读文件、超 85% 甜点主动声明 | 哨兵 Agent 竹节强制交接 |
| 6 | **done 上报必须附 self_check** — 逐条比对 deliverables + quality_gates，附 check-list ✅/❌ | 缺一项 → 不进入外部验收，直接退回 |
| 7 | **上行消息必须结构化 YAML** — 只允许 done/blocked/plan/brief_echo 四种 type，不允许散文 | 指挥官路由 Agent 无法解析，视为无效上报 |
| 8 | **严禁直接读写 tree-state.json** — 所有状态通过事件上报让指挥官调 tree-state.js 记录 | 违反补丁 4，字段错写/覆盖丢失由工人全责 |
| 9 | **严禁越界** — 改动 out_of_scope → 必须请示；改动 DoD deliverables → 必须请示 | 方向偏差，路线图 Agent 检出后升级纠偏 |

---

## §2 收到 5 件套后的首动作

> 对应设计文档: §3 核心契约, §3.5 自审契约, §6.1

收到指挥官下发的 5 件套契约（brief / dod / report / autonomy / self_audit）后，按以下流程执行：

```
1. 解析 5 件套
   逐条阅读 brief.in_scope / brief.out_of_scope / dod.deliverables / dod.quality_gates
   理解 autonomy.can_decide / must_report / must_ask 的边界

2. 写出 milestones 列表
   优先使用 self_audit.milestones（如已提供）
   若未提供，基于 brief.my_mission 自己拆解
   每个 Mi 包含: id / desc / expect_outputs

3. 发送 brief_echo
   用自己的话复述理解 + milestones_preview（模板见 §3.4）
   不通过简报不放行干活

4. 等待放行
   默认放行时间: report.plan_ack_seconds（默认 300 秒，即 5 分钟）
   5 分钟内未收到 NACK → 默认放行，开始执行
   收到 NACK → 根据指挥官反馈修正理解后重新发送 brief_echo
```

---

## §2.5 worker lifecycle 全景（谁调什么）

> 对应设计文档: §4.2 事件通道 + §6.1 brief_echo；commander 侧流程见 tree-commander SKILL §13.3。
> 一图看懂 worker 一生要经历 9 个阶段，哪些是 worker 主动调、哪些是 commander 调、哪些是 worker 收件。

| 阶段 | 调用者 | 工具 / 动作 | worker 做什么 |
|------|--------|------------|--------------|
| 1. fork | commander | `mcp__session__fork_session` / `create_session` | （被动）被创建，拿到自己的 session_id |
| 2. leaf_add | commander | `mcp__tree__tree_leaf_add` | （被动）被登记为 tree 里的 leaf，拿到 leaf_id |
| 3. 收 5 件套 | commander → worker | `send_message`（首条=5 件套 YAML） | 解析 brief/dod/report/autonomy/self_audit，理解任务边界 |
| 4. brief_echo（首条） | **worker 主动** | `mcp__tree__tree_event_append(type=brief_echo, meta={my_understanding, milestones_preview})` | 用自己的话复述 brief + 列 milestones（无 alignment 字段） |
| 5. alignment 回填 | commander（root 身份） | `tree_event_append(type=brief_echo, meta={alignment, auditor_session_id=root.session_id})` | （被动）等待 commander 回填对齐评估；撞 `E_ALIGNMENT_NOT_VERIFIED` 说明这步没做，上行 `blocked` 提示母会话 |
| 6. 干活 | **worker 主动** | 产出文件落盘 `deliverables/` + 每个 Mi 自审（§4）+ review_round（若 review_required，§4.6） | 执行 milestones，每个 Mi 完成跑 §4.2 自审、产出 `.note.md` |
| 7. done event | **worker 主动** | `tree_event_append(type=done, meta={self_check, deliverables, milestones, context_usage, drift_declaration})` | 全部 Mi 完成、self_check 全过后上报；self_check schema = `[{item,pass,evidence}]`（§3.1） |
| 8. audit_gate pass | commander（caller===audit_session_id=root.session_id） | `tree_audit_gate(verdict=pass, audit_session_id=root.session_id)` | （被动）等待门禁背书；步骤 5 没做则这步被 `E_ALIGNMENT_NOT_VERIFIED` 拦，worker 永远到不了步骤 9 |
| 9. set-status done | **worker 主动** | `tree_leaf_set_status(status=done)` | 步骤 8 通过后自己调；deliverables 必须已落盘，否则 `E_DELIVERABLE_MISSING` |

> **worker 主动调的步骤**：4（brief_echo）、7（done event）、9（set-status done）——这三步 commander 不能代调（代调 → `E_BORROWED_IDENTITY`）。
> **步骤 9 前必须步骤 8 完成**：worker 调 set-status done 时引擎查 `audit_gate.verdict=pass`，没过 → `E_GATEKEEPER_REQUIRED`。若卡在这，先确认 commander 是否已调步骤 8（上行 `blocked` 催一下）。
> **撞 `E_ALIGNMENT_NOT_VERIFIED`**：说明步骤 5 没做（commander 没回填 alignment event），worker 这边上行 `blocked` 提示母会话补 alignment 评估，**不要自己伪造 alignment**（auditor 必须独立，伪造会被拦）。

---

## §3 上行消息模板

> 对应设计文档: §4.2 事件通道, §6.1 brief_echo

### §3.1 done — 完成上报

**触发**: 所有 milestones 完成，self_check 全部通过后

**必填字段**: `event`, `deliverables`, `self_check`, `milestones`, `context_usage`, `drift_declaration`

> **self_check schema（v2.4 强化，引擎硬校验）**：必须是 `[{item, pass, evidence}]` 数组。`item` = 检查项描述；`pass` = true/false；`evidence` = ≥10 字的客观证据（引用产出文件的具体位置/行/段落，禁止空泛"已检查"）。缺 `evidence` 或 <10 字 → done event 被 `E_SELFCHECK_INVALID` 拦，必须重写。

```yaml
event: done
deliverables: ["docs/prd/module-x.md", "docs/prd/module-x/flow.mmd"]  # 必填
self_check:                     # 必填，逐条比对 deliverable + quality_gate；schema = [{item,pass,evidence}]
  - item: "Mermaid 流程图可渲染"
    pass: true
    evidence: "flow.mmd 经 mmdc CLI 渲染输出 flow.svg 无报错，含 7 个节点 6 条边"
  - item: "API 列表覆盖全部端点"
    pass: true
    evidence: "api.yaml 第 12-89 行列出 8 个端点，逐条对照 brief.in_scope 第 2 条 8 项全部命中"
  - item: "异常处理 section 存在"
    pass: false                  # ❌ 则标注原因，在 milestones 中说明
    evidence: "module-x.md 当前无 '异常处理' 二级标题，仅在第 4 段提及 1 句，缺 timeout/重试/降级三档"
milestones:                     # 必填，逐个标注
  - id: M1
    audit_pass: true
    note_path: "docs/prd/module-x/flow.note.md"
  - id: M2
    audit_pass: false           # 自审未过但有 drift_declaration
    note_path: "docs/prd/module-x/api.note.md"
context_usage: 73               # 必填，当前会话 token 使用百分比
drift_declaration: true         # 必填，v0.2: 如有未解决偏差则 true，否则 false
```

**可选字段**: 无（done 模板所有字段均为必填）

---

### §3.2 blocked — 卡点上报

**触发**: 遇到无法自决的阻碍

**必填字段**: `event`, `obstacle`, `tried`, `options`, `wait_for`

```yaml
event: blocked
obstacle: "评测引擎选型不确定，对课程环境的兼容性无把握"  # 必填
tried:                          # 必填，至少 1 项
  - "Docker 方案 — 部署太重，学生机器无法承载"
  - "WebAssembly — 较新，文档和社区支持不足"
options:                        # 必填，至少 2 个可选项
  - id: A
    desc: "Docker，稳定但部署重"
    cost: "高（需额外 500MB 镜像）"
  - id: B
    desc: "WebAssembly，轻量但风险高"
    cost: "中（需调研和学习投入）"
wait_for: "decision"            # 必填，固定值
```

**根会话回应格式**（工人收到后按此解析）：

```yaml
decision: "A"                   # 选中的 option id
reason: "稳定优先，部署重可接受"
```

**可选字段**: 无

---

### §3.3 plan — 拆解计划上报

**触发**: 需要拆解孙任务时

**必填字段**: `event`, `sub_missions`, `silence_ack_seconds`, `status`

```yaml
event: plan
sub_missions:                   # 必填，至少 1 项
  - name: "评测引擎调研"
    dod: "输出引擎对比表（≥3 个方案），含性能/部署/兼容性维度"
    est_steps: 5
  - name: "评测 API 设计"
    dod: "RESTful API 列表 + 请求/响应示例 + 错误码表"
    est_steps: 8
silence_ack_seconds: 300        # 必填，默认 300（范围 60–300）
status: "5 分钟内无 NACK 则开始 Fork"  # 必填
```

**可选字段**: `est_steps` 为可选（不提供则视作步骤数未知）

---

### §3.4 brief_echo — 简报复述（首条消息）

**触发**: 收到 5 件套后，开工前必须发送

**必填字段**: `event`, `my_understanding`, `milestones_preview`

```yaml
event: brief_echo
my_understanding:               # 必填，用自己的话复述
  parent_intent: "为南大软件编程课 24 秋写一份完整 PRD"
  my_mission: "完成实验评测模块的需求规格，含学生提交→评测→反馈闭环"
  in_scope:
    - "学生提交代码 → 自动评测 → 反馈分数"
    - "教师端：查看评测日志、调整测试用例"
  out_of_scope:
    - "课程内容本身（其他模块负责）"
    - "成绩录入教务系统（属于成绩模块）"
  dod_essence: "产出 docs/prd/experiment-eval.md（≥2000 字，含评测流程图/异常处理/API 列表），Mermaid 可渲染"
milestones_preview:             # 必填，至少 1 项
  - "M1: 评测流程图初稿（输出 flow.mmd）"
  - "M2: API 列表（输出 api.yaml）"
  - "M3: 异常处理方案（输出 error-handling.md）"
```

**可选字段**: `my_understanding.why_this_exists`（可选，说明此任务存在的理由）

> **⚠️ v0.7 批次5 (V5b) done 前置 — alignment 回填**：worker 的 brief_echo 本身不带 alignment（alignment 是 commander/独立 auditor 的对齐评估产物）。但 worker 要 `set-status done`，引擎要求 events 中**必须存在一条带 `alignment + auditor_session_id` 的 brief_echo event**（由母会话/独立 auditor 收到你的首条 brief_echo、评估对齐后回填）。若卡在"audit pass 被拦 E_ALIGNMENT_NOT_VERIFIED"，说明 commander 还没回填 alignment——请上行 `blocked` 提示母会话补 alignment 评估，**不要自己伪造 alignment**（auditor 必须独立，伪造会被拦）。
>
> **冷启动期（2026-07-07 补）**：母会话在冷启动期会用 `root.session_id` 直接当 alignment+audit_gate auditor（引擎信任锚，详见 tree-commander SKILL §13）。这正常，worker 不必担心 auditor 是"母会话自己"——root 作信任锚是引擎允许的例外。worker 仍只需：发首条 brief_echo（无 alignment）→ 干活 → done 上报，alignment 回填和 audit_gate pass 由母会话（root 身份）完成。

---

## §4 内部自审流程（v0.2 必须）

> 对应设计文档: §10.4 内部自审流程, §3.5 自审契约

### §4.1 触发时机

每次 `milestone set-result` 后**立即**触发。不可跳过。

### §4.2 检测者

会话内自 Fork 的 `code-reviewer` 子 Agent（`subagent_type=code-reviewer`），同步返回判定。

### §4.3 审计 Prompt 模板

```text
审计里程碑 <Mi.id> 的产出是否与任务 brief/dod 对齐。

brief:
  parent_intent: <brief.parent_intent>
  my_mission: <brief.my_mission>
  in_scope: <brief.in_scope>
  out_of_scope: <brief.out_of_scope>

dod:
  deliverables: <dod.deliverables>
  quality_gates: <dod.quality_gates>

当前里程碑:
  id: <Mi.id>
  desc: <Mi.desc>
  expect_outputs: <Mi.expect_outputs>

产出路径: <实际产出文件路径>

检查点:
  1. 产出是否覆盖 Mi.desc 描述的全部内容
  2. 是否有偏离 brief.in_scope 的内容
  3. 产出质量是否达到 dod.quality_gates 的最低标准
  4. 如涉及 auto_test，检查退出码和 stdout 摘要

输出格式（严格 JSON）:
{
  "alignment": <0-100 整数>,
  "gaps": ["<差距描述1>", "<差距描述2>"],
  "severity": "low|mid|high",
  "suggestion": "<修正建议，severity=low 时可省略>"
}
```

### §4.4 处理逻辑

```
自审 Agent 返回 verdict:

  if verdict.severity == "low":
    → 通过。记录后进入下一个里程碑

  elif verdict.severity == "mid" or verdict.severity == "high":
    → 按 verdict.suggestion 自纠
    → 再次调用自审 Agent（第 2 次）
    → 第 2 次仍 mid+:
        → 不再纠（达到 max_self_corrections=2）
        → 标记 drift，在最终 done 上报时 drift_declaration=true
```

### §4.5 drift_history 写入

> 通过上行事件传达给指挥官，由指挥官调 `tree-state.js drift append`

| 场景 | kind | severity | action |
|---|---|---|---|
| 自纠成功（第 1/2 次修正后 low） | production | low | self_correct |
| 2 次自纠后仍 mid+，上报声明 | production | mid | declare |

---

## §4.6 done 前 G1-G5 多子Agent 内容审查（ISS-003，review_required=true 时强制）

> 对应引擎硬约束：`cmdLeafSetStatus` done 门禁校验 events[] 须含 ≥1 条 `review_round` 事件（schema + 末轮 red_count===0 + 总轮数≤3）。
> 2026-07-04 新增（ISS-003 阶段一）。与 §4.2 互补：§4.2 是每个 Mi 后的快速单 Agent 对齐自检；§4.6 是全部 Mi 完成后、done 前的多视角内容审查收敛。

**触发条件**：`brief.audit_meta.review_required === true`（commander 下发 brief 时标记），或 worker 自检交付物为设计文档/架构级/跨文件（≥1000 字）时主动开启。

**与 §4.2 的关系**：§4.2 不废弃（仍用于 milestone 级快速自检），但 review_required=true 时 done 前必须**额外**跑 §4.6。审计角色（§10，commander 派 leaf 模式）是另一条独立链，不冲突。

**执行步骤**（最多 3 轮，红色归零收敛）：

1. **分档决定 reviewer 数量**（按交付物总字数/文件数，避免小任务过重）：
   - < 1000 字或单文件小改 → 2 reviewer（G1 完整性 + G3 可执行性）
   - 1000–5000 字或跨 2-3 文件 → 3 reviewer（G1 + G2 一致性 + G3）
   - \> 5000 字或跨多文件/架构级 → 5 reviewer（G1-G5 全视角）

2. **并行 Fork N 个子 Agent**，每个分配一个视角：
   - **G1 完整性**：交付物是否覆盖 brief.my_mission / dod.deliverables 全部要求
   - **G2 一致性**：交付物内部 / 跨文件是否自洽（命名、接口、术语）
   - **G3 可执行性**（红色必改）：能否跑/编译/通过测试；命令、依赖、路径是否正确
   - **G4 可读性**：结构、表达、受众适配
   - **G5 格式合规**（红色必改）：对照 dod.quality_gates 逐项

   每个子 Agent prompt 给出 brief / dod / milestone / 产出路径，要求**只提 findings，不重写**，每条 finding 标 `severity: red|yellow|green` + `evidence`（≥10 字，引用具体位置）。

3. **收集 N 份 findings → 写 review_round event**（`mcp__tree__tree_event_append`）：
   ```yaml
   event: review_round
   meta:
     round_no: 1
     reviewers:
       - perspective: G1
         reviewer_session_id: <子Agent session_id；SDK SubAgent 无 Proma session_id 时填一个合法 UUID，≠ 自己 session_id，≠ added_by>
         findings:
           - { severity: red, item: "评测流程图缺异常分支", evidence: "flow.mmd 第3段未画 timeout 分支，与 error-handling.md 不一致" }
           - { severity: green, item: "API 列表完整", evidence: "api.yaml 覆盖 brief 要求的 8 个端点" }
     red_count: 1
     converged: false
   ```
   ⚠️ `reviewer_session_id` 不得 = 自己 session_id（自审，引擎 `E_REVIEW_FORGERY` 拦截）、不得 = added_by（commander 不能自审下属）。

4. **若末轮 red_count > 0** → 按 findings 自改 → 再 Fork N 个子 Agent（至少 60% 新 session，避免视角重复）→ 写 round 2 → …
5. **最多 3 轮**：red_count=0 即收敛（converged: true）→ 可 done；3 轮仍红 → 不再循环，上行 `blocked` 请求 commander 介入（引擎拦截 total_rounds>3 的 done）。

**已知局限（阶段一，诚实标注）**：引擎 review 门禁【仅防格式伪造 + 自审】，**不防内容伪造**——worker 自写一条格式合法但全 green 的 review_round 可蒙混通过。**真实防线是 commander 验收时抽查 reviewer findings 与产出文件的相关性**（见 tree-commander SKILL §4 Step4）。阶段二（Layer2 findings-产出文件相关性校验）将补引擎层内容真实性。这与 self_check 同安全级别（self_check 也是 worker 自写、引擎只防格式）。

**禁止**：
- `reviewer_session_id` = 自己 session / added_by（`E_REVIEW_FORGERY`）
- findings 为空或 evidence < 10 字（`E_REVIEW_FORGERY`）
- 跳过审查直接 done（`E_REVIEW_NOT_CONVERGED`）

---

## §5 决策笔记模板（.note.md）

> 对应设计文档: §6.3 决策日志

每个里程碑产出文件旁必须附带 `<产出名>.note.md`（≤ 50 行），模板：

```markdown
---
milestone: M2
topic: api-style
reversible: true
---

## 可选方案

- REST
- GraphQL
- RPC

## 选择

REST

## 理由

学生群体更熟悉 RESTful 风格，与现有教案对接成本最低。GraphQL 虽灵活但学习曲线对课程无增益。RPC 过于底层不适合教学场景。

## 触发重审条件

课程组反馈接口散乱 > 3 次则切换至 RPC
```

**约束**:

| 字段 | 必填 | 说明 |
|---|---|---|
| `milestone` | 是 | 关联的 milestone id |
| `topic` | 是 | 决策主题，简短标签 |
| `reversible` | 是 | true/false，决策是否可逆 |
| 可选方案 | 是 | ≥ 2 个考虑过的方案 |
| 选择 | 是 | 最终采用方案 |
| 理由 | 是 | 为什么选这个 |
| 触发重审条件 | 否 | 什么条件下重新评估此决定 |

---

## §6 上下文最小化规则（3 条）

> 对应设计文档: §6.4 上下文最小化

| # | 规则 | 实现 |
|---|---|---|
| 1 | **不留一次性大输出** | 产出大文件后，只保留路径 + 摘要，不把文件内容塞进对话历史 |
| 2 | **不重复读已读文件** | 已读文件路径 + 摘要记录在 `working_notes/files_index.md` |
| 3 | **超甜点 85% 主动声明** | 检测到 context_usage ≥ 85% 时，在最近一次上行消息中附带 `context_usage` 字段，让哨兵 Agent 接管竹节交接 |

**附加**: 若收到指挥官竹节交接指令，输出任务简报（≤ 2K tokens）：进度 + 关键发现 + 未完成 milestones，供新会话接收。

---

## §7 禁止行为清单（12 条）

> 综合设计文档全部约束 + v0.1 审计报告发现

| # | 禁止行为 | 来源 |
|---|---|---|
| 1 | 第一条消息发任何非 brief_echo 内容 | §6.1 |
| 2 | 无 milestones 直接开始执行 | §3 契约纪律 |
| 3 | 跳过里程碑自审（v0.2） | §10.4 |
| 4 | 产出里程碑但不附带 .note.md | §6.3 |
| 5 | done 上报缺 self_check 或 quality_gates 执行结果 | §6.2 |
| 6 | 发非结构化（散文式）上行消息 | §4.2 |
| 7 | 直接读取或写入 tree-state.json 文件 | 补丁 4 / §1 铁律 8 |
| 8 | 改动 brief.out_of_scope 的内容而不请示 | §3.4 autonomy |
| 9 | 改动 DoD 的 deliverables 路径或 quality_gates 项而不请示 | §3.4 autonomy |
| 10 | 使用 done/blocked/plan/brief_echo 之外的事件类型 | §4.2 |
| 11 | 在 brief_echo 未放行前开始产出实际文件 | §6.1 |
| 12 | 重复读取已读过的文件（不做 files_index.md 记录） | §6.4 |

---

## §8 命名规范摘要

> 对应设计文档: §6.5 命名规范（worker 视角精简版）

工人只需记住自身 `leaf_id` 的格式约束：

```
<prefix>-<path>-<role>[-<suffix>]
```

| 段 | 约束 | 示例 |
|---|---|---|
| `prefix` | 小写字母开头，4–8 字符，仅含 `[a-z0-9_]`，不含连字符 | `nanju`, `pguide`, `webv3` |
| `path` | 树定位：根为空，子为 A/B/C，孙为 A1/A2，曾孙 A1a/A1b | `A`, `B1`, `A1a` |
| `role` | 角色短名，可含连字符 | `eval`, `api`, `ui` |
| `suffix` | 可选。`s<N>` 表竹节 / `i<N>` 表尝试序号 | `s2`, `i3` |

**示例**: `nanju-A-eval` = nanju 项目第 1 子（A）执行评测模块；`nanju-B1b-engine` = B 的第 1 孙的第 2 次尝试（评测引擎）。

工人**不需要**记忆完整正则，但必须确保自己的 `leaf_id` 符合上述段约束。`prefix` 由根会话首次激活时生成、Fork 时自动继承，工人无需自行生成。

---

## §10 审计角色（v2.1 新增）

> 依据：tree-audit-methodology.md v1.0。当你的 role 或 brief.my_mission 涉及审查/审计/验证/终局时，**必须**按本节执行。

### §10.1 触发判定

收到 5 件套后，检查以下条件，任一满足即进入审计角色：
- `brief.my_mission` 含 "审查/审计/验证/终局/review/audit/verify/converge"
- `leaf_id` 的 role 段为 `C1/C2/C3/C4/A1/A2/verify/review/audit`
- brief.in_scope 第一条含 "按方法论阶段"

### §10.2 审计角色的核心区别

| 常规 worker | 审计 worker |
|------------|------------|
| 自己产出文档/代码 | **不产出内容，只产出问题列表** |
| 1 个 self_check 即够 | **必须 Fork 子 Agent 做多维并行审查** |
| done 后指挥官验收 | **done 后由指挥官汇总多审计员结果** |
| 不做反事实攻击 | **攻击角色必须构造破坏性场景** |

### §10.3 审计 worker 的最小 Fork 结构

**如果你是审查员（C1-C4）**：你必须 Fork 1 个子 Agent 执行具体审查。

```
审查员 worker（你）
  └── Fork 1 个子 Agent：按你的维度执行具体审查
        产出：结构化问题列表，每个问题含 ID/定位/严重程度/描述/修正建议
```

**如果你是攻击员（A1-A2）**：你必须 Fork 2 个子 Agent 并行攻击。

```
攻击员 worker（你）
  ├── Fork Agent 1：角色视角攻击（每个角色 3 个"如果...怎么办"）
  ├── Fork Agent 2：契约边界攻击（每条验收标准 1-2 个边界外输入）
  └── 汇总产出攻击报告
```

### §10.4 审计 done 上报格式

```yaml
event: done
deliverables:
  - "<审查/攻击报告路径>"
self_check:                      # schema = [{item,pass,evidence}]，evidence ≥10 字，缺则 E_SELFCHECK_INVALID
  - item: "已 Fork 子 Agent 执行审查（非自己直接判断）"
    pass: true
    evidence: "Fork 了子 Agent session <id>，list_messages 可见其审查对话，问题列表来自该子 Agent 返回"
  - item: "问题列表含 ID/定位/严重程度/描述/修正建议 5 字段"
    pass: true
    evidence: "审查报告第 2-47 行每条问题均含 ID（P1-P23）/定位（文件:行）/severity/desc/fix 五列"
  - item: "标注了每个严重程度的判断理由"
    pass: true
    evidence: "报告 severity 列每项后括注理由，如 'high（阻断：API 缺 auth 校验，见 §3.2）'"
milestones:
  - { id: M1, audit_pass: true, note_path: "<note路径>" }
  - { id: M2, audit_pass: true, note_path: "<note路径>" }
context_usage: <数字>
drift_declaration: false
```

### §10.5 审计禁止行为

| # | 禁止行为 | 后果 |
|---|---------|------|
| 1 | 审查员自己读完文档直接写结论，不 Fork 子 Agent | 单维度推理惯性，审计不可采信 |
| 2 | 攻击员和审查员是同一个子会话 | 攻击心态与建设心态冲突 |
| 3 | 审计报告缺少结构化问题列表（无 ID/定位/严重程度） | 无法追溯，视为无效 |
| 4 | done 上报 self_check 中未确认"已 Fork 子 Agent" | 退回重做 |

---

## §11 修订历史

| 日期 | 版本 | 主要变更 |
|------|------|---------|
| 2026-07-04 | v2.3 | ISS-003：新增 §4.6 done 前 G1-G5 多子Agent 内容审查（review_required=true 时强制，含分档/红色归零/最多3轮/已知局限诚实标注）。与 §4.2 milestone 级自检互补不冲突 |
| 2026-06-19 | v2.2 | 审计驱动修订：load_on 从 fork_session 修正为 create_session（原则 11：叶子 = create_session）；target 描述明确子 Commander 由 fork_session 创建 |
| 2026-06-19 | v2.1 | 新增 §10 审计角色（触发判定、最小 Fork 结构、审计 done 格式、审计禁止行为）；§0 引用 tree-audit-methodology.md |
| 2026-06-18 | v2.0 | 首次创建。合并 v0.1 9 条铁律 + v0.2 内部自审必须化（铁律 3 从可选升级为必须）；新增 §4 完整自审流程（含 Prompt 模板 + drift_history 写入规范）；done 模板新增 drift_declaration 字段 |
