# C2 完整性/闭环审查 — 问题列表

> 审查员: tree-worker (leaf: sq_audit-C2-completeness)
> 审查对象: tree-system-v0.2.0 发布包（17 文件）
> 审查时间: 2026-06-19 18:29 GMT+8
> 审查维度: 文件清单完整性、QUICKSTART 可执行性、tree-state.js 命令覆盖、铁律/事件类型一致性、CHANGELOG 闭环

---

## 一、质量门验证摘要

| 质量门 | 状态 | 说明 |
|--------|------|------|
| QUICKSTART 7 步骤逐条验证 | ✅ 完成 | 发现 4 步存在阻断级命令语法错误 |
| tree-state.js 子命令 × SKILL §5 交叉核验 | ✅ 完成 | 24/24 子命令全部在代码中存在 |
| 所有文件引用路径验证 | ✅ 完成 | 17/17 文件存在，引用链完整 |

---

## 二、问题列表

### 阻断级（Blocking）— 用户按文档操作会直接失败

| 问题ID | 定位 | 严重程度 | 描述 | 修正建议 |
|--------|------|---------|------|---------|
| **C2-B01** | QUICKSTART.md:20-21 | **阻断** | `node tree-state.js init mydemo "demo"` 命令语法错误。tree-state.js 的 `init` 子命令要求 `--root-brief '<json>'` 和 `--root-dod '<json>'` 两个必填标志参数（见 tree-state.js:413-414），当前命令缺少这两个参数，执行将直接失败并报 `E_SCHEMA_INVALID: --root-brief is required`。第二个位置参数 `"demo"` 会被静默忽略。 | 改为 `node tree-state.js init mydemo --root-brief '{"parent_intent":"demo"}' --root-dod '{"deliverables":[]}'`，或提供一个最小可用的 JSON 示例 |
| **C2-B02** | QUICKSTART.md:57-58 | **阻断** | `node tree-state.js leaf add mydemo-A-draft root "xxx-xxx-A" draft deepseek-v4-pro` 命令语法完全错误。`leaf add` 要求 `--json '<json>'` 标志传入完整的 leaf JSON 对象（含 leaf_id/session_id/parent/path/role/model/channel 等必填字段，见 tree-state.js:464-477），当前使用位置参数无法被解析，执行将报 `E_SCHEMA_INVALID: --json is required` | 改为 `node tree-state.js leaf add mydemo --json '{"leaf_id":"mydemo-A-draft","session_id":"xxx-xxx-A","parent":"mydemo-root","path":"A","role":"draft","model":"deepseek-v4-pro","channel":"deepseek"}'` |
| **C2-B03** | QUICKSTART.md:114-115 | **阻断** | `node tree-state.js event add mydemo-A-draft done '...'` 子命令不存在。`event` 的正确子命令是 `append`，且需要 `--type` 和 `--json` 标志（见 tree-state.js:1458、973-979）。执行 `event add` 将报 `E_UNKNOWN: unknown event subcommand "add"` | 改为 `node tree-state.js event append mydemo mydemo-A-draft --type done --json '{"deliverables":["demo/draft.md"],"lines":105,"self_check":"PASS"}'` |
| **C2-B04** | QUICKSTART.md:121-125 | **阻断** | 两个子命令均存在语法错误：(a) `node tree-state.js validate` — `validate` 要求 `<tree_id>` 位置参数（见 tree-state.js:1211-1212），缺少将报 `E_SCHEMA_INVALID: tree_id is required`；(b) `node tree-state.js dump` — `dump` 不是顶层命令，正确路径为 `tree dump <tree_id>`（见 tree-state.js:1503-1509），执行将报 `E_UNKNOWN: unknown command "dump"` | 改为 `node tree-state.js validate mydemo` 和 `node tree-state.js tree dump mydemo` |
| **C2-B05** | README.md:40 | **阻断** | `node core/tree-state.js init mytree "我的第一个树形任务"` — 同 C2-B01，缺少必填的 `--root-brief` 和 `--root-dod` 标志。第二个位置参数会被静默忽略 | 改为 `node core/tree-state.js init mytree --root-brief '{"parent_intent":"...}' --root-dod '{"deliverables":[]}'` |
| **C2-B06** | README.md:47 | **阻断** | `node core/tree-state.js validate` — 同 C2-B04(a)，缺少 `<tree_id>` 参数 | 改为 `node core/tree-state.js validate mytree` |

### 严重级（Severe）— 文档不一致或功能声称与实现不匹配

| 问题ID | 定位 | 严重程度 | 描述 | 修正建议 |
|--------|------|---------|------|---------|
| **C2-S01** | README.md:119-125 事件类型表 | **严重** | README 事件表使用事件类型名 `heartbeat`，但 tree-state.js 的 `EVENT_TYPE_ENUM`（line 68）中对应类型为 `heartbeat_reply`，tree-commander SKILL §6 事件路由表也使用 `heartbeat_reply`。同一概念使用两个不同名称会导致使用 tree-state.js 时类型校验失败：`event append --type heartbeat` 将报枚举错误 | 统一为 `heartbeat_reply`，或将 README 表格中的 `heartbeat` 改为 `heartbeat_reply` |
| **C2-S02** | README.md:70 | **严重** | README 目录结构中标注 `commander-methodology.md — 指挥官方法论（14条铁律）`，但 commander-methodology.md 实际包含 **10 条核心原则**（原则 1-10），并非 14 条。"14"这个数字可能来源于将 methodology 的 10 条原则 + tree-commander SKILL 的 4 条铁律合并计数，但描述位置明确指向 methodology 单个文件 | 将 `14条铁律` 改为 `10条核心原则`，或注明"方法论 10 条 + SKILL 4 条 = 14 条铁律" |
| **C2-S03** | CHANGELOG.md:42-47 vs README.md:148-156 | **严重** | CHANGELOG "已知限制"列出 4 项，但 README "已知限制"列出 6 项。CHANGELOG 缺少：(1) "频道兼容性：GLM 配额不稳定，DeepSeek 偶尔长消息卡死"；(2) "内审/三档纠偏"与"心跳机制"在 CHANGELOG 中合并为一项但 README 分开列出。版本发布文件的限制声明不一致 | 将 CHANGELOG 已知限制与 README 对齐，补充"频道兼容性"条目 |
| **C2-S04** | tree-commander SKILL §3.3 + tree-worker SKILL §7 #10 | **严重** | **心跳通道文档闭环断裂**：commander SKILL §3.3 的 `report.channels` 模板包含 `heartbeat_reply` 上报通道，§6 事件路由表明确路由 `heartbeat_reply` 事件并调 `event append --type heartbeat_reply`。但 worker SKILL §1 铁律 7 和 §7 禁止行为 #10 明确规定"只允许 done/blocked/plan/brief_echo 四种 type"，且 worker SKILL §3 上行消息模板只有这 4 种，**缺少 heartbeat_reply 响应模板**。当 commander 发送 `status_check` 询问时，worker 不知道应使用哪种事件类型、何种格式回复 | 二选一：(a) worker SKILL §3 新增 heartbeat_reply 模板 + §7 #10 更新为允许 5 种类型；或 (b) 明确 status_check→worker 回复走 brief_echo 通道，commander 端转换为 heartbeat_reply 记录 |
| **C2-S05** | tree-worker/SKILL.md:10 vs :440 | **严重** | tree-worker SKILL §0 元数据声明 `version: 2.0`，但 §11 修订历史最新条目为 `2026-06-19 \| v2.1 \| 新增 §10 审计角色`。文件内部版本号自相矛盾（§0 说 v2.0，§11 说 v2.1） | 将 §0 的 `version: 2.0` 更新为 `version: 2.1` |
| **C2-S06** | CHANGELOG.md:22-26 vs tree-worker/SKILL.md:366-434 | **严重** | CHANGELOG 声称 tree-worker SKILL 为 **v2.0**，但实际文件已更新到 v2.1（新增 §10 审计角色 + 5 条审计禁止行为 + §11 修订历史）。CHANGELOG 未记录 v2.1 变更，版本发布记录不完整 | 在 CHANGELOG 中追加 tree-worker SKILL v2.1 的变更记录（§10 审计角色新增） |

### 建议级（Suggestion）— 改进建议，不影响核心可用性

| 问题ID | 定位 | 严重程度 | 描述 | 修正建议 |
|--------|------|---------|------|---------|
| **C2-R01** | QUICKSTART.md:20 | **建议** | QUICKSTART Step 1 使用硬编码的 Windows 绝对路径 `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\trees`，在 macOS/Linux 或不同用户环境中不可用 | 改为相对路径或使用 `<workspace>/.context/trees` 占位符，在文首说明工作区根路径 |
| **C2-R02** | CHANGELOG.md:7 | **建议** | CHANGELOG 声称 tree-state.js 为 "1551 行"，实际文件包含 1552 行（含末尾空行）。虽然差异微小，但版本发布文件的精确行数声明应准确 | 改为 "1552 行" 或 "约 1550 行" |
| **C2-R03** | QUICKSTART.md:39-51 | **建议** | QUICKSTART Step 3-4 的 MCP 工具调用使用了伪函数调用语法（`mcp__session__create_session(channel_id="...", model_id="...", title="...")`），与实际的 MCP 工具 JSON 参数格式不一致，可能让不熟悉 MCP 工具调用方式的用户困惑 | 使用 JSON 格式展示参数，或添加说明"在 Agent 对话中以自然语言要求调用此工具" |
| **C2-R04** | README.md:119-125 | **建议** | README 事件通道表仅列出 5 种事件类型（brief_echo/plan/done/blocked/heartbeat），但 tree-state.js 的 `EVENT_TYPE_ENUM` 共支持 8 种（增加了 heartbeat_reply/nudge/limit/status_check）。后 3 种（nudge/limit/status_check）是 commander 内部操作事件，不经过工人上行通道，但 heartbeat_reply 是工人上行事件，README 未区分说明 | 在事件表下方增加注释："tree-state.js 内部还支持 nudge/limit/status_check 事件类型，用于 commander 端纠偏记录，不经过工人上行通道" |

---

## 三、已验证通过的清单

以下审查项**零问题**，确认闭环：

| 审查项 | 结果 | 详情 |
|--------|------|------|
| 文件清单 vs README 目录结构 | ✅ 通过 | 17/17 文件全部存在，目录结构与 README:54-89 完全一致 |
| tree-state.js 子命令 vs SKILL §5 | ✅ 通过 | 24/24 子命令 100% 覆盖：Query 7 + Add 3 + Update 5 + Append 4 + Maintain 4，与 dispatch 分支一一对应 |
| tree-worker SKILL §4 自审流程 | ✅ 闭环 | 触发时机 → 检测者 → prompt 模板 → 处理逻辑 → drift_history，5 环节完整 |
| tree-worker SKILL §5 .note.md 模板 | ✅ 闭环 | 7 字段约束表（milestone/topic/reversible/方案/选择/理由/重审条件）全部可执行 |
| tree-worker SKILL §6 上下文最小化 | ✅ 闭环 | 3 条规则均有具体实现指引 |
| commander SKILL §7 三档纠偏 | ✅ 闭环 | 轻/中/重三档决策树完整，与 drift append 参数枚举一致 |
| commander SKILL §10 灾难恢复 | ✅ 闭环 | F1-F4 四类故障均有恢复动作 + tree-state.js 子命令 |
| commander SKILL §11 禁止行为 vs methodology §6 | ✅ 一致 | 12 条禁止行为覆盖 methodology 8 条反模式 + 4 条 SKILL 特有约束 |
| CHANGELOG 核心交付 vs 实际文件 | ✅ 通过 | 所有声明的核心交付物均有对应文件，tree-state.js/tree-commander SKILL/tree-worker SKILL/methodology 文档/验证记录全部存在 |
| tree-audit-methodology 5 铁律 | ✅ 闭环 | 并行多Agent / 迭代收敛 / 攻击独立 / 修正回归 / 证据结论，与 §二 完整对应 |
| 命名规范一致性 | ✅ 通过 | commander SKILL §12 / worker SKILL §8 / tree-state.js LEAF_NAME_RE，三处正则一致 |
| plan 默认放行机制 | ✅ 闭环 | commander SKILL §6 详细流程 + §3.3 plan_ack_seconds 参数 + worker SKILL §2 silence 默认 300s，三方衔接正确 |

---

## 四、统计摘要

| 严重程度 | 数量 | 占比 |
|---------|------|------|
| **阻断** | 6 | 35% |
| **严重** | 6 | 35% |
| **建议** | 4 | 24% |
| **通过项** | 12 | — |
| **合计问题** | **16** | 100% |

### 关键发现

1. **QUICKSTART 不可执行**：7 步中 4 步存在命令语法错误（Step 1/3/5/6），tree-state.js 的实际 CLI 接口与文档描述严重脱节。用户无法按 QUICKSTART 完成教程。
2. **README 快速开始同样受损**：README 的 Step 3 和 Step 7 存在与 QUICKSTART 相同的 init/validate 命令语法错误（C2-B05、C2-B06）。
3. **心跳通道文档闭环断裂**：commander 期望 worker 发送 heartbeat_reply，但 worker 被禁止使用 4 种之外的事件类型（C2-S04）。这是一个功能设计意图与操作手册之间的结构性矛盾。
4. **版本号管理松散**：tree-worker SKILL 内部版本号不一致（§0 v2.0 vs §11 v2.1），且 CHANGELOG 遗漏 v2.1 变更记录（C2-S05、C2-S06）。

### 发布判定建议

**当前状态下不建议交付**。6 个阻断级问题意味着 QUICKSTART 和 README 快速开始章节的关键命令无法执行，用户的第一印象将是失败。建议优先修复全部阻断级问题（预计工作量：QUICKSTART.md 4 处 + README.md 2 处命令修正），严重级问题可在 v0.2.1 中修复。

---

*审查完成于 2026-06-19 18:29 GMT+8 | leaf: sq_audit-C2-completeness*
