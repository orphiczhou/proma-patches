# tree-worker / 树形会话执行体系 — 工人 Skill

> **角色**: 子会话（叶子节点）加载的操作手册。定义如何理解任务契约、拆解里程碑、执行自审、上报事件。

---

## §0 元数据

```yaml
skill_name: tree-worker
version: 2.0
target: 子会话（叶子节点 / Fork 出的执行会话）
requires: tree-state.js # 通过 commander 间接调用，worker 不直接调
load_on: fork_session  # commander 在 Fork 时通过首条消息自动加载
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

## §3 上行消息模板

> 对应设计文档: §4.2 事件通道, §6.1 brief_echo

### §3.1 done — 完成上报

**触发**: 所有 milestones 完成，self_check 全部通过后

**必填字段**: `event`, `deliverables`, `self_check`, `milestones`, `context_usage`, `drift_declaration`

```yaml
event: done
deliverables: ["docs/prd/module-x.md", "docs/prd/module-x/flow.mmd"]  # 必填
self_check:                     # 必填，逐条比对 deliverable + quality_gate
  - item: "Mermaid 流程图可渲染"
    pass: true
  - item: "API 列表覆盖全部端点"
    pass: true
  - item: "异常处理 section 存在"
    pass: false                  # ❌ 则标注原因，在 milestones 中说明
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

## §9 修订历史

| 日期 | 版本 | 主要变更 |
|---|---|---|
| 2026-06-18 | v2.0 | 首次创建。合并 v0.1 9 条铁律 + v0.2 内部自审必须化（铁律 3 从可选升级为必须）；新增 §4 完整自审流程（含 Prompt 模板 + drift_history 写入规范）；done 模板新增 drift_declaration 字段 |
