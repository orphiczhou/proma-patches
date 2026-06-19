# S1 简单二叉树测试方案

> **测试目标**：端到端验证 v0.1 树形会话执行体系的「简单二叉树」场景
> **设计依据**：`tree-commander-design.md §9.4` + 附录 A
> **测试形态**：模拟测试（不真 Fork 会话，直接用 mock UUID 跑命令序列）
> **预期通过标准**：所有命令返回 `{"ok":true,...}`，最终 `validate` 返回 `{"ok":true,"issues":[]}`，关键状态字段符合预期
> **预估耗时**：5-10 分钟（含清理）

---

## 0. 元信息

### 0.1 测试目的

按 v0.1 设计文档 §9.4 的 S1 用例：

> **S1. 简单二叉树** — 根拆 2 子，都正常 done，整合会话产出。验证契约下发、事件路由、整合。

模拟测试（非真实 Fork）覆盖的验证点：

1. tree-state.js 的 init / leaf / milestone / event / drift / tree 系列命令协同工作
2. 4 件套契约下发（通过 root_brief / root_dod）能落盘
3. 子任务 leaf add 时的命名正则校验通过
4. brief_echo / done 事件能正确 append 到 leaf.events
5. milestones 推进流程（add → set-result audit_pass=true）正常
6. set-status done 的严格校验（milestones 非空且全部 audit_pass=true）能放行
7. 整合会话 F 的启动时机（A/B done 之后）符合编排
8. 最终 validate 通过
9. drift_log 为空（happy path 不触发纠偏）
10. _meta.write_count 持续递增（M1 修复后正常工作）

### 0.2 测试环境约束

- **当前工作区**：`C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`
- **tree-state.js 路径**：`<workspace>/.context/trees/tree-state.js`
- **tree 目录**：`<workspace>/.context/trees/pguide/`（脚本自动创建）
- **测试后清理**：删除 `pguide/` 目录（见 §7）
- **Node 版本**：v22.13.1（实测可用）
- **shell**：bash on Windows（命令中 JSON 参数用单引号包裹，路径用 `/`）

### 0.3 命名规范约束（避免触发 v0.1 已知问题 S1/S3）

**严格遵守**：所有 leaf_id 必须匹配正则 `^(\w+)-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$`，**且不触发**审计报告 S1 提到的 4 类边界 case：

| ❌ 禁用命名 | 原因 |
|---|---|
| `A-eval` | 缺 prefix 段 |
| `n-root` | prefix 过短（虽然能匹配，但属于 S1 风险范围） |
| `NANJU-ROOT` | 全大写 prefix（设计 §6.5 暗示小写） |
| `nanju--eval` | 连续分隔符 |
| `proma-guide-root` | **prefix 含连字符**——正则匹配失败（`\w+` 不包含 `-`） |

**本测试采用 prefix = `pguide`**（5 字符，符合 §6.5 的 "4-8 字符" 建议，全小写）。

### 0.4 不触发 v0.1 已知问题清单

| 已知问题 | 本测试规避方式 |
|---|---|
| v0.1.1-S1：命名正则边界 | 全部使用规范命名（见 §2） |
| v0.1.1-S3：Windows rename 重试 | 单会话顺序执行，无并发占用 |
| v0.1.1-N1：restore 计数器 | 本测试不调 restore |
| v0.1.1-N2：考古注释 | 不涉及 |

---

## 1. 业务场景（虚构）

> **任务**：写一份《如何用 Proma 写 PRD》的小指南（< 2000 字）
>
> 拆解：
> - **子任务 A（流程部分）**：写"PRD 写作流程"章节（约 1000 字），含 5 步流程图
> - **子任务 B（技巧部分）**：写"Proma 配合技巧"章节（约 1000 字），含 3 条技巧
> - **整合 F（合并）**：合并 A 和 B 为单文件，加目录、加引言

### 1.1 树形结构

```
pguide-root                          🌳 指挥所（虚拟，不创建 leaf）
  ├─ pguide-A-flow                   🍃 流程部分（约 1000 字）
  └─ pguide-B-tips                   🍃 技巧部分（约 1000 字）
（A、B 全部 done 后启动）
  └─ pguide-F-integration            🍃 整合会话
```

注：根据附录 A，`init` 创建 tree 后 leaves 是空对象。`pguide-root` 不是 leaf，而是 tree_id 本身（指挥所是根会话，由调用 tree-state.js 的那个会话承担）。所以本测试创建 3 个 leaf：A、B、F。

### 1.2 leaf 命名表

| leaf_id | path | role | parent | session_id（mock） |
|---|---|---|---|---|
| `pguide-A-flow` | `A` | `flow` | null | `mock-uuid-pguide-A-001` |
| `pguide-B-tips` | `B` | `tips` | null | `mock-uuid-pguide-B-002` |
| `pguide-F-integration` | `F` | `integration` | null | `mock-uuid-pguide-F-003` |

F 的 parent 为 null（独立 Fork；A/B 的产出通过 4 件套 brief 注入 F 的上下文，不走 parent-child 链接）。也可以让 F 的 parent 设为 `pguide-A-flow` 表示"A 之后启动"，但本测试选择 parent=null 以保持简单——A/B 是 parallel，F 是 sequential，独立 leaf 更符合实际语义。

---

## 2. 完整命令序列

> **执行约定**：
> - 工作目录：`<workspace>/.context/trees/`
> - 所有命令以 `node tree-state.js` 开头
> - 所有 JSON 参数用单引号 `'...'` 包裹（bash 转义）
> - 每条命令执行后，**预期 stdout** 是单行紧凑 JSON，包含 `"ok":true`
> - 退出码 0 = 成功，非 0 = 失败
> - 命令前的 `#` 注释行是说明，不需要执行

### 步骤 0：前置检查

```bash
# 切换到 tree-state.js 所在目录
cd "C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees"

# 确认 pguide 测试 tree 不存在（如已存在，先按 §7 清理）
ls pguide 2>/dev/null && echo "WARN: pguide/ exists — run cleanup first" || echo "OK: clean slate"
```

**预期**：输出 `OK: clean slate`

---

### 步骤 1：init tree（根会话激活）

```bash
node tree-state.js init pguide \
  --root-brief '{"parent_intent":"写一份《如何用 Proma 写 PRD》的小指南(<2000字)","my_mission":"组织两个子任务A/B并行产出+一个整合F合并","why_this_exists":"让新用户快速上手用 Proma 写 PRD","in_scope":["PRD 写作流程","Proma 配合技巧"],"out_of_scope":["PRD 模板下载","企业级 PRD 案例"]}' \
  --root-dod '{"deliverables":[{"path":"docs/proma-prd-guide.md","min_length":1800,"must_contain":["目录","PRD 写作流程","Proma 配合技巧"]}],"quality_gates":[{"type":"self_check","desc":"文档结构完整"}],"self_check":["目录有 3+ 条目","正文两部分齐全"]}'
```

**预期 stdout**：
```json
{"ok":true,"tree":{"tree_id":"pguide","created_at":"2026-06-18T...+08:00","dir":"<workspace>/.context/trees/pguide"}}
```

**状态变化**：
- 创建 `pguide/` 目录
- 创建 `pguide/tree-state.json`，初始内容含：`version / tree_id / created_at / root_brief / root_dod / leaves:{} / heartbeat_log:[] / drift_log:[] / audit_meta:{默认} / _meta:{write_count:1}`

---

### 步骤 2：下发子任务 A（leaf add）

```bash
node tree-state.js leaf add pguide --json '{
  "leaf_id": "pguide-A-flow",
  "session_id": "mock-uuid-pguide-A-001",
  "parent": null,
  "path": "A",
  "role": "flow",
  "model": "claude-sonnet-4-6",
  "channel": "anthropic"
}'
```

**预期 stdout**：
```json
{"ok":true,"leaf":{"leaf_id":"pguide-A-flow","session_id":"mock-uuid-pguide-A-001","parent":null,"path":"A","role":"flow","model":"claude-sonnet-4-6","channel":"anthropic","status":"active","created_at":"...","last_event_ts":null,"last_event_type":null,"context_usage_pct":0,"drift_history":[],"milestones":[],"segment_chain":[],"autonomy_overrides":{},"events":[]}}
```

**状态变化**：
- `leaves["pguide-A-flow"]` 创建，status=active
- `_meta.write_count` 递增到 2

---

### 步骤 3：下发子任务 B（leaf add）

```bash
node tree-state.js leaf add pguide --json '{
  "leaf_id": "pguide-B-tips",
  "session_id": "mock-uuid-pguide-B-002",
  "parent": null,
  "path": "B",
  "role": "tips",
  "model": "claude-sonnet-4-6",
  "channel": "anthropic"
}'
```

**预期 stdout**：`{"ok":true,"leaf":{"leaf_id":"pguide-B-tips",...}}`

**状态变化**：
- `leaves["pguide-B-tips"]` 创建，status=active
- `_meta.write_count` 递增到 3

---

### 步骤 4：子任务 A 上行 brief_echo（事件路由验证）

```bash
node tree-state.js event append pguide pguide-A-flow --type brief_echo --json '{
  "my_understanding": {
    "parent_intent": "写一份《如何用 Proma 写 PRD》的小指南",
    "my_mission": "完成 PRD 写作流程章节（约 1000 字，含 5 步流程图）",
    "in_scope": ["PRD 写作流程的 5 步分解", "每步的 Proma 操作"],
    "out_of_scope": ["技巧部分（由 B 负责）", "整合（由 F 负责）"],
    "dod_essence": "5 步流程图 + 每步说明 + 总字数约 1000"
  },
  "milestones_preview": ["M1: 5 步流程图初稿", "M2: 每步说明补充"]
}'
```

**预期 stdout**：
```json
{"ok":true,"event":{"type":"brief_echo","ts":"2026-06-18T...+08:00","meta":{"my_understanding":{...},"milestones_preview":[...]}}}
```

**状态变化**：
- `leaves["pguide-A-flow"].events` 追加 1 条 brief_echo
- `last_event_type` = `brief_echo`，`last_event_ts` 更新
- `_meta.write_count` 递增到 4

---

### 步骤 5：子任务 A 添加 milestone M1

```bash
node tree-state.js milestone add pguide pguide-A-flow --json '{
  "id": "M1",
  "desc": "5 步 PRD 写作流程图初稿",
  "expect_outputs": ["docs/proma-prd-guide/flow.mmd"]
}'
```

**预期 stdout**：
```json
{"ok":true,"milestone":{"id":"M1","desc":"5 步 PRD 写作流程图初稿","expect_outputs":["docs/proma-prd-guide/flow.mmd"],"status":"pending","audit_pass":null,"note_path":null}}
```

**状态变化**：
- `leaves["pguide-A-flow"].milestones` 追加 M1，status=pending
- `_meta.write_count` 递增到 5

---

### 步骤 6：子任务 A 添加 milestone M2

```bash
node tree-state.js milestone add pguide pguide-A-flow --json '{
  "id": "M2",
  "desc": "每步说明补充（约 1000 字总）",
  "expect_outputs": ["docs/proma-prd-guide/flow.md"]
}'
```

**预期 stdout**：`{"ok":true,"milestone":{"id":"M2","desc":"...","expect_outputs":["docs/proma-prd-guide/flow.md"],"status":"pending","audit_pass":null,"note_path":null}}`

**状态变化**：
- `leaves["pguide-A-flow"].milestones` 追加 M2
- `_meta.write_count` 递增到 6

---

### 步骤 7：子任务 A 完成 milestone M1（audit_pass=true）

```bash
node tree-state.js milestone set-result pguide pguide-A-flow M1 \
  --audit-pass true \
  --note-path "docs/proma-prd-guide/flow.mmd.note.md"
```

**预期 stdout**：
```json
{"ok":true,"milestone":{"id":"M1","desc":"5 步 PRD 写作流程图初稿","expect_outputs":["docs/proma-prd-guide/flow.mmd"],"status":"done","audit_pass":true,"note_path":"docs/proma-prd-guide/flow.mmd.note.md"}}
```

**状态变化**：
- `leaves["pguide-A-flow"].milestones[0]` 的 status=done, audit_pass=true, note_path 已设
- `_meta.write_count` 递增到 7

---

### 步骤 8：子任务 A 完成 milestone M2

```bash
node tree-state.js milestone set-result pguide pguide-A-flow M2 \
  --audit-pass true \
  --note-path "docs/proma-prd-guide/flow.md.note.md"
```

**预期 stdout**：`{"ok":true,"milestone":{"id":"M2",...,"status":"done","audit_pass":true,...}}`

**状态变化**：
- `leaves["pguide-A-flow"].milestones[1]` 完成
- `_meta.write_count` 递增到 8

---

### 步骤 9：子任务 A done（事件 + 状态变更）

#### 9a. 上行 done 事件（含 deliverables + self_check）

```bash
node tree-state.js event append pguide pguide-A-flow --type done --json '{
  "deliverables": ["docs/proma-prd-guide/flow.md"],
  "self_check": [
    {"item": "5 步流程图 Mermaid 渲染", "pass": true},
    {"item": "总字数 1050 字（目标 1000）", "pass": true},
    {"item": "M1 + M2 均已 audit_pass", "pass": true}
  ],
  "context_usage": 42
}'
```

**预期 stdout**：`{"ok":true,"event":{"type":"done","ts":"...","meta":{"deliverables":[...],"self_check":[...],"context_usage":42}}}`

**状态变化**：
- `leaves["pguide-A-flow"].events` 追加 done 事件
- `last_event_type` = `done`
- `_meta.write_count` 递增到 9

#### 9b. set-status done（严格校验通过）

```bash
node tree-state.js leaf set-status pguide pguide-A-flow done
```

**预期 stdout**：
```json
{"ok":true,"leaf":{"leaf_id":"pguide-A-flow","status":"done","from":"active"}}
```

**状态变化**：
- `leaves["pguide-A-flow"].status` = `done`
- 校验通过（milestones 非空 + 所有 audit_pass=true）
- `_meta.write_count` 递增到 10
- **关键点**：write_count=10 触发自动备份（M1 修复后正常工作）→ `pguide/` 目录下应出现 `tree-state.backup.<ts_ms>.auto.json`

---

### 步骤 10-15：子任务 B 走相同流程（brief_echo → 2 milestones → done）

### 步骤 10：子任务 B 上行 brief_echo

```bash
node tree-state.js event append pguide pguide-B-tips --type brief_echo --json '{
  "my_understanding": {
    "parent_intent": "写一份《如何用 Proma 写 PRD》的小指南",
    "my_mission": "完成 Proma 配合技巧章节（约 1000 字，含 3 条技巧）",
    "in_scope": ["3 条可复用技巧", "每条技巧的 Proma 操作截图说明"],
    "out_of_scope": ["流程部分（由 A 负责）", "整合（由 F 负责）"],
    "dod_essence": "3 条技巧 + 每条 300+ 字说明"
  },
  "milestones_preview": ["M1: 3 条技巧标题与概述", "M2: 每条技巧详细说明"]
}'
```

**预期**：`{"ok":true,"event":{...}}`，write_count → 11

---

### 步骤 11：子任务 B 添加 milestone M1

```bash
node tree-state.js milestone add pguide pguide-B-tips --json '{
  "id": "M1",
  "desc": "3 条技巧标题与概述",
  "expect_outputs": ["docs/proma-prd-guide/tips-outline.md"]
}'
```

**预期**：`{"ok":true,"milestone":{"id":"M1",...,"status":"pending",...}}`，write_count → 12

---

### 步骤 12：子任务 B 添加 milestone M2

```bash
node tree-state.js milestone add pguide pguide-B-tips --json '{
  "id": "M2",
  "desc": "每条技巧详细说明（约 1000 字总）",
  "expect_outputs": ["docs/proma-prd-guide/tips.md"]
}'
```

**预期**：`{"ok":true,"milestone":{"id":"M2",...}}`，write_count → 13

---

### 步骤 13：子任务 B 完成 milestone M1

```bash
node tree-state.js milestone set-result pguide pguide-B-tips M1 \
  --audit-pass true \
  --note-path "docs/proma-prd-guide/tips-outline.md.note.md"
```

**预期**：`{"ok":true,"milestone":{"id":"M1",...,"status":"done","audit_pass":true,...}}`，write_count → 14

---

### 步骤 14：子任务 B 完成 milestone M2

```bash
node tree-state.js milestone set-result pguide pguide-B-tips M2 \
  --audit-pass true \
  --note-path "docs/proma-prd-guide/tips.md.note.md"
```

**预期**：`{"ok":true,"milestone":{"id":"M2",...,"status":"done","audit_pass":true,...}}`，write_count → 15

---

### 步骤 15：子任务 B done

#### 15a. 上行 done 事件

```bash
node tree-state.js event append pguide pguide-B-tips --type done --json '{
  "deliverables": ["docs/proma-prd-guide/tips.md"],
  "self_check": [
    {"item": "3 条技巧齐全", "pass": true},
    {"item": "总字数 980 字（目标 1000）", "pass": true},
    {"item": "M1 + M2 均已 audit_pass", "pass": true}
  ],
  "context_usage": 38
}'
```

**预期**：`{"ok":true,"event":{...}}`，write_count → 16

#### 15b. set-status done

```bash
node tree-state.js leaf set-status pguide pguide-B-tips done
```

**预期 stdout**：`{"ok":true,"leaf":{"leaf_id":"pguide-B-tips","status":"done","from":"active"}}`

**状态变化**：
- `leaves["pguide-B-tips"].status` = `done`
- `_meta.write_count` 递增到 17

---

### 步骤 16：启动整合会话 F（A/B 全部 done 后）

```bash
node tree-state.js leaf add pguide --json '{
  "leaf_id": "pguide-F-integration",
  "session_id": "mock-uuid-pguide-F-003",
  "parent": null,
  "path": "F",
  "role": "integration",
  "model": "claude-sonnet-4-6",
  "channel": "anthropic"
}'
```

**预期 stdout**：`{"ok":true,"leaf":{"leaf_id":"pguide-F-integration",...}}`

**状态变化**：
- `leaves["pguide-F-integration"]` 创建，status=active
- `_meta.write_count` 递增到 18

---

### 步骤 17：整合会话 F 上行 brief_echo

```bash
node tree-state.js event append pguide pguide-F-integration --type brief_echo --json '{
  "my_understanding": {
    "parent_intent": "写一份《如何用 Proma 写 PRD》的小指南",
    "my_mission": "合并 A 的 flow.md 与 B 的 tips.md 为单一 proma-prd-guide.md，加目录和引言",
    "in_scope": ["合并 A+B 产出", "加目录", "加 200 字引言"],
    "out_of_scope": ["重写 A 或 B 的内容", "补充新章节"],
    "dod_essence": "总字数 >= 1800，含目录、PRD 写作流程、Proma 配合技巧 3 段"
  },
  "milestones_preview": ["M1: 合并 + 目录", "M2: 引言 + 最终校对"]
}'
```

**预期**：`{"ok":true,"event":{...}}`，write_count → 19

---

### 步骤 18：整合会话 F 添加 milestone M1

```bash
node tree-state.js milestone add pguide pguide-F-integration --json '{
  "id": "M1",
  "desc": "合并 A+B + 生成目录",
  "expect_outputs": ["docs/proma-prd-guide.md"]
}'
```

**预期**：`{"ok":true,"milestone":{"id":"M1",...,"status":"pending",...}}`，write_count → 20

---

### 步骤 19：整合会话 F 添加 milestone M2

```bash
node tree-state.js milestone add pguide pguide-F-integration --json '{
  "id": "M2",
  "desc": "加引言（200 字）+ 最终校对",
  "expect_outputs": ["docs/proma-prd-guide.md"]
}'
```

**预期**：`{"ok":true,"milestone":{"id":"M2",...}}`，write_count → 21

---

### 步骤 20：整合会话 F 完成 milestone M1

```bash
node tree-state.js milestone set-result pguide pguide-F-integration M1 \
  --audit-pass true \
  --note-path "docs/proma-prd-guide.md.M1.note.md"
```

**预期**：`{"ok":true,"milestone":{"id":"M1",...,"status":"done","audit_pass":true,...}}`，write_count → 22

---

### 步骤 21：整合会话 F 完成 milestone M2

```bash
node tree-state.js milestone set-result pguide pguide-F-integration M2 \
  --audit-pass true \
  --note-path "docs/proma-prd-guide.md.M2.note.md"
```

**预期**：`{"ok":true,"milestone":{"id":"M2",...,"status":"done","audit_pass":true,...}}`，write_count → 23

---

### 步骤 22：整合会话 F done

#### 22a. 上行 done 事件（含最终 deliverables）

```bash
node tree-state.js event append pguide pguide-F-integration --type done --json '{
  "deliverables": ["docs/proma-prd-guide.md"],
  "self_check": [
    {"item": "总字数 2230 字（>= 1800 目标）", "pass": true},
    {"item": "目录有 4 条目（引言/流程/技巧/总结）", "pass": true},
    {"item": "PRD 写作流程章节齐全（来自 A）", "pass": true},
    {"item": "Proma 配合技巧章节齐全（来自 B）", "pass": true},
    {"item": "M1 + M2 均已 audit_pass", "pass": true}
  ],
  "context_usage": 55
}'
```

**预期**：`{"ok":true,"event":{...}}`，write_count → 24

#### 22b. set-status done

```bash
node tree-state.js leaf set-status pguide pguide-F-integration done
```

**预期 stdout**：`{"ok":true,"leaf":{"leaf_id":"pguide-F-integration","status":"done","from":"active"}}`

**状态变化**：
- `leaves["pguide-F-integration"].status` = `done`
- `_meta.write_count` 递增到 25

---

### 步骤 23：最终验证 — tree dump

```bash
node tree-state.js tree dump pguide
```

**预期 stdout**：单行紧凑 JSON，包含完整 tree-state。关键观察点：

- `tree_id` = `"pguide"`
- `leaves` 含 3 个 leaf（A / B / F），全部 `status="done"`
- 每个 leaf 的 `events` 数组含 2 条（brief_echo + done）
- 每个 leaf 的 `milestones` 数组含 2 个，全部 `audit_pass=true`
- `drift_log` = `[]`（happy path，无纠偏）
- `heartbeat_log` = `[]`（v0.1 不要求心跳）
- `_meta.write_count` = 25

---

### 步骤 24：最终验证 — validate

```bash
node tree-state.js validate pguide
```

**预期 stdout**：
```json
{"ok":true,"issues":[]}
```

---

### 步骤 25：辅助验证 — 查询类命令（可选但推荐）

```bash
# 查所有叶子（应含 3 个，全部 done）
node tree-state.js leaf list-all pguide

# 查 active 叶子（应为空数组）
node tree-state.js leaf list-active pguide

# 查所有事件（应含 6 条：A brief_echo + A done + B brief_echo + B done + F brief_echo + F done）
node tree-state.js event list pguide

# 按 leaf 过滤事件
node tree-state.js event list pguide --leaf pguide-A-flow

# 按类型过滤事件
node tree-state.js event list pguide --type done

# 查 drift（应为空数组）
node tree-state.js drift list pguide

# 查 heartbeat tail（应为空数组）
node tree-state.js heartbeat tail pguide

# 查备份列表（应有 2 份 auto 备份：write_count=10 和 20 时触发）
node tree-state.js backup pguide --label final-check
```

**预期**：
- `leaf list-all` → `{"ok":true,"leaves":[3 items]}`
- `leaf list-active` → `{"ok":true,"leaves":[]}`
- `event list` → `{"ok":true,"events":[6 items]}`
- `event list --leaf pguide-A-flow` → `{"ok":true,"events":[2 items: brief_echo + done]}`
- `event list --type done` → `{"ok":true,"events":[3 items]}`
- `drift list` → `{"ok":true,"drifts":[]}`
- `heartbeat tail` → `{"ok":true,"heartbeats":[]}`
- `backup --label final-check` → `{"ok":true,"backup":"tree-state.backup.<ts>.final-check.json","backups":[3 items]}`（2 auto + 1 manual）

---

## 3. 期望最终状态

测试结束后，`pguide/tree-state.json` 应符合以下结构（关键字段）：

```jsonc
{
  "version": "1.0",
  "tree_id": "pguide",
  "created_at": "2026-06-18T...+08:00",
  "last_heartbeat": null,
  "root_brief": {
    "parent_intent": "写一份《如何用 Proma 写 PRD》的小指南(<2000字)",
    "my_mission": "...",
    // ... 完整 brief
  },
  "root_dod": {
    "deliverables": [{"path":"docs/proma-prd-guide.md","min_length":1800,...}],
    // ... 完整 dod
  },
  "leaves": {
    "pguide-A-flow": {
      "leaf_id": "pguide-A-flow",
      "session_id": "mock-uuid-pguide-A-001",
      "parent": null,
      "path": "A",
      "role": "flow",
      "model": "claude-sonnet-4-6",
      "channel": "anthropic",
      "status": "done",
      "created_at": "...",
      "last_event_ts": "...",
      "last_event_type": "done",
      "context_usage_pct": 0,
      "drift_history": [],
      "milestones": [
        {"id":"M1","desc":"5 步 PRD 写作流程图初稿","expect_outputs":["docs/proma-prd-guide/flow.mmd"],"status":"done","audit_pass":true,"note_path":"docs/proma-prd-guide/flow.mmd.note.md"},
        {"id":"M2","desc":"每步说明补充（约 1000 字总）","expect_outputs":["docs/proma-prd-guide/flow.md"],"status":"done","audit_pass":true,"note_path":"docs/proma-prd-guide/flow.md.note.md"}
      ],
      "segment_chain": [],
      "autonomy_overrides": {},
      "events": [
        {"type":"brief_echo","ts":"...","meta":{"my_understanding":{...},"milestones_preview":[...]}},
        {"type":"done","ts":"...","meta":{"deliverables":["docs/proma-prd-guide/flow.md"],"self_check":[...],"context_usage":42}}
      ]
    },
    "pguide-B-tips": {
      // 结构同 pguide-A-flow，path="B"，role="tips"，session_id="mock-uuid-pguide-B-002"
      "status": "done",
      "milestones": [M1, M2 均 done],
      "events": [brief_echo, done]
    },
    "pguide-F-integration": {
      // 结构同上，path="F"，role="integration"，session_id="mock-uuid-pguide-F-003"
      "status": "done",
      "milestones": [M1, M2 均 done],
      "events": [brief_echo, done]
    }
  },
  "heartbeat_log": [],
  "drift_log": [],
  "audit_meta": {
    "plan_ack_seconds": 300,
    "max_self_corrections": 2,
    "heartbeat_interval_minutes": 15,
    "sweet_spot_limits": {
      "claude-sonnet-4-6": {"min":100000,"max":200000,"hard":300000},
      "deepseek-v4-pro": {...},
      "glm-5-turbo": {...}
    }
  },
  "_meta": {
    "write_count": 25
  }
}
```

### 3.1 关键字段预期值速查表

| 字段 | 预期值 | 备注 |
|---|---|---|
| `version` | `"1.0"` | init 默认 |
| `tree_id` | `"pguide"` | init 参数 |
| `last_heartbeat` | `null` | v0.1 不要求心跳 |
| `Object.keys(leaves).length` | `3` | A/B/F |
| `leaves["pguide-A-flow"].status` | `"done"` | 步骤 9b |
| `leaves["pguide-B-tips"].status` | `"done"` | 步骤 15b |
| `leaves["pguide-F-integration"].status` | `"done"` | 步骤 22b |
| 每个 leaf 的 `events.length` | `2` | brief_echo + done |
| 每个 leaf 的 `milestones.length` | `2` | M1 + M2 |
| 所有 milestones 的 `audit_pass` | `true` | set-result 时设 |
| 所有 milestones 的 `status` | `"done"` | set-result audit_pass=true 时自动 |
| `heartbeat_log.length` | `0` | v0.1 不要求心跳 |
| `drift_log.length` | `0` | happy path |
| `_meta.write_count` | `25` | init=1 + 24 次写入 |

### 3.2 文件系统期望

`pguide/` 目录下应有：

| 文件 | 数量 | 触发条件 |
|---|---|---|
| `tree-state.json` | 1 | 主状态文件 |
| `tree-state.json.tmp` | 0 | 每次 rename 后被清理 |
| `tree-state.backup.<ts>.auto.json` | 2 | write_count=10 和 20 时各触发一次 |
| `.lock` | 0 | 每次命令结束后被清理（极少数情况下可能残留，可忽略） |

---

## 4. 验证维度（7 个 ✅ 检查项）

测试结束后，逐项核对：

### ✅ 4.1 契约下发（4 件套）是否完整记录在 tree-state？

**验证方法**：`node tree-state.js tree dump pguide | python -m json.tool`（或用其他 JSON 美化工具）

**通过标准**：
- `root_brief` 含 parent_intent / my_mission / why_this_exists / in_scope / out_of_scope
- `root_dod` 含 deliverables / quality_gates / self_check
- 每个 leaf 的 brief_echo 事件 `meta.my_understanding` 复述了对应子任务的 brief 要素

### ✅ 4.2 事件路由（brief_echo / done）是否被正确 append？

**验证方法**：`node tree-state.js event list pguide`

**通过标准**：
- 返回 6 条事件（3 leaf × 2 events）
- A 的 2 条事件 type 分别是 `brief_echo` 和 `done`
- 所有事件的 leaf_id 字段正确
- 时间戳 ts 按升序

### ✅ 4.3 milestones 是否按预期推进？

**验证方法**：`node tree-state.js leaf get pguide pguide-A-flow`

**通过标准**：
- `milestones` 数组含 M1 和 M2
- 两者 `status` 均为 `"done"`，`audit_pass` 均为 `true`
- `note_path` 已设置（不为 null）

### ✅ 4.4 整合会话 F 的启动时机是否在 A/B done 后？

**验证方法**：检查命令执行顺序（步骤 16 在步骤 15b 之后）

**通过标准**：
- 步骤 15b 完成后（B done）才执行步骤 16（F leaf add）
- F 的 `created_at` 时间戳晚于 B 的 `last_event_ts`

### ✅ 4.5 最终 validate 是否通过？

**验证方法**：`node tree-state.js validate pguide`

**通过标准**：`{"ok":true,"issues":[]}`

### ✅ 4.6 drift_log 是否为空（happy path 不应触发纠偏）？

**验证方法**：`node tree-state.js drift list pguide`

**通过标准**：`{"ok":true,"drifts":[]}`

### ✅ 4.7 _meta.write_count 是否合理？

**验证方法**：dump tree 后查 `_meta.write_count`

**通过标准**：值 = `25`（init=1 + 24 次业务写入）

详细分解：
- 步骤 1 init → 1
- 步骤 2 leaf add A → 2
- 步骤 3 leaf add B → 3
- 步骤 4 event append A brief_echo → 4
- 步骤 5 milestone add A M1 → 5
- 步骤 6 milestone add A M2 → 6
- 步骤 7 milestone set-result A M1 → 7
- 步骤 8 milestone set-result A M2 → 8
- 步骤 9a event append A done → 9
- 步骤 9b set-status A done → 10（**触发第 1 次自动备份**）
- 步骤 10 event append B brief_echo → 11
- 步骤 11 milestone add B M1 → 12
- 步骤 12 milestone add B M2 → 13
- 步骤 13 milestone set-result B M1 → 14
- 步骤 14 milestone set-result B M2 → 15
- 步骤 15a event append B done → 16
- 步骤 15b set-status B done → 17
- 步骤 16 leaf add F → 18
- 步骤 17 event append F brief_echo → 19
- 步骤 18 milestone add F M1 → 20（**触发第 2 次自动备份**）
- 步骤 19 milestone add F M2 → 21
- 步骤 20 milestone set-result F M1 → 22
- 步骤 21 milestone set-result F M2 → 23
- 步骤 22a event append F done → 24
- 步骤 22b set-status F done → 25

---

## 5. 额外验证 — 自动备份（M1 修复回归）

M1 修复后，每 10 次写触发一次自动备份。本测试恰好覆盖两次触发点（write_count=10 和 20）。

**验证方法**：
```bash
ls -la pguide/*.backup.*.json
```

**通过标准**：
- 至少 2 个文件，命名形如 `tree-state.backup.<ts_ms>.auto.json`
- ts_ms 与对应命令执行时间一致

---

## 6. 异常路径（可选，加分项）

> **不强制执行**。如基础流程跑通且时间允许，再跑这两个扩展测试。

### EX1：plan 上报 + 默认放行（验证 plan 事件能被记录）

**场景**：让 A 在 M1 完成后发 plan 信号（要拆孙任务），但根会话 5 分钟内不回应 → 默认放行。

**操作**：在步骤 7（A 完成 M1）和步骤 8（A 完成 M2）之间插入：

```bash
# EX1.1 A 上报 plan
node tree-state.js event append pguide pguide-A-flow --type plan --json '{
  "sub_missions": [
    {"name": "流程图细节调研", "dod": "确定每步的输入输出", "est_steps": 3}
  ],
  "silence_ack_seconds": 300,
  "status": "5 分钟内无 NACK 则开始"
}'

# EX1.2 模拟 5 分钟超时（实际测试中可省略等待，直接继续推进 M2）
# 注：tree-state.js 本身不做超时判定，只是记录事件
# plan 上报后 A 继续干 M2（模拟默认放行）
```

**预期**：
- `event append` 返回 `{"ok":true,"event":{"type":"plan",...}}`
- `pguide-A-flow.events` 数组增加 1 条 plan 事件
- 不影响后续流程

**注意**：执行 EX1 后，最终验证需调整：
- 步骤 23 dump：A 的 `events` 应有 3 条（brief_echo + plan + done）
- 步骤 25 event list：总事件数应为 7（原 6 + 1 plan）
- `_meta.write_count` 增加到 26（多一次写）

### EX2：delayed 子任务（模拟心跳检测）

**场景**：让 B 故意不立即 done，模拟心跳唤起并记录一次 heartbeat。

**操作**：在步骤 15（B done）之前插入：

```bash
# EX2.1 模拟心跳唤起（哨兵 Agent 扫描）
node tree-state.js heartbeat append pguide --json '{
  "verdicts": [
    {"leaf_id":"pguide-A-flow","verdict":"done","action":"none"},
    {"leaf_id":"pguide-B-tips","verdict":"active","action":"none"}
  ],
  "ts": "2026-06-18T13:00:00+08:00",
  "next_heartbeat": "2026-06-18T13:15:00+08:00"
}'

# EX2.2 然后 B 继续走原计划 done
```

**预期**：
- `heartbeat append` 返回 `{"ok":true,"heartbeat":{"ts":"...","verdicts":[2 items],"next_heartbeat":"..."}}`
- `heartbeat_log` 数组增加 1 条
- `last_heartbeat` 字段被更新

**注意**：执行 EX2 后，最终验证需调整：
- 步骤 23 dump：`heartbeat_log` 含 1 条
- `_meta.write_count` 增加到 26（多一次写）

---

## 7. 清理步骤

测试结束后，删除测试 tree 目录，避免污染工作区。

```bash
cd "C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees"

# 删除整个 pguide 测试目录（含 tree-state.json + 备份 + lock）
rm -rf pguide

# 验证清理
ls pguide 2>/dev/null && echo "FAIL: pguide still exists" || echo "OK: cleaned"
```

**预期输出**：`OK: cleaned`

**重要**：
- 不要删除 `tree-state.js`（共享脚本）
- 不要删除其他 tree 目录（如已有 `nanju` 等）
- 清理后再次跑 S1 时会从 init 重新开始

---

## 8. 失败处理

### 8.1 通用排查步骤

如果某一步返回 `{"ok":false,...}`：

1. **先看 error.code**：
   - `E_TREE_NOT_FOUND` → 检查 init 是否成功，目录是否存在
   - `E_LEAF_NOT_FOUND` → 检查 leaf_id 拼写、是否漏了 leaf add 步骤
   - `E_NAME_INVALID` → leaf_id 不符合命名正则，参考 §0.3
   - `E_DUPLICATE_LEAF` → 重复创建，先清理再跑
   - `E_SCHEMA_INVALID` → JSON 参数格式错误，检查单引号是否正确转义
   - `E_STATUS_INVALID` → status 值不在枚举内
   - `E_LOCK_TIMEOUT` → 锁文件残留，删除 `pguide/.lock` 后重试

2. **查 error.msg**：通常包含具体原因

3. **查 tree dump**：`node tree-state.js tree dump pguide` 看当前状态

4. **查 backup**：`node tree-state.js backup pguide --label debug-snapshot` 保存当前状态用于排查

### 8.2 常见错误及解决

| 错误 | 原因 | 解决 |
|---|---|---|
| init 报 `E_DUPLICATE_LEAF: tree already initialized` | pguide 已存在 | 先按 §7 清理 |
| leaf add 报 `E_NAME_INVALID` | leaf_id 格式错误 | 参考 §0.3，避免 `A-eval`/`n-root`/`proma-guide-*` 等 |
| milestone set-result 报 `E_LEAF_NOT_FOUND: milestone ... not found` | milestone_id 拼错，或漏了 milestone add 步骤 | 重新检查步骤序号 |
| set-status done 报 `cannot set status=done: milestones must be non-empty` | M2 修复后严格校验，空 milestone 不允许 done | 确保先 add milestone 再 set-result audit_pass=true |
| set-status done 报 `cannot set status=done: milestone "..." is not audit_pass=true` | 有 milestone 还没 set-result audit_pass=true | 补完所有 milestone 的 set-result |
| validate 报 `parent_missing` | leaf.parent 指向不存在的 leaf | 检查 parent 值（本测试全部为 null） |
| validate 报 `path_mismatch` | leaf.path 与 leaf_id 解析出的 path 段不一致 | leaf_id `pguide-A-flow` 对应 path `A`，依此类推 |

### 8.3 中断恢复

如果测试中途断电/退出/某步卡死：

1. 不要慌，tree-state.json 是持久化的，可从中断点继续
2. 跑 `node tree-state.js tree dump pguide` 看当前进度
3. 对照 §3.1 速查表，确认已完成到第几步
4. 从未完成的步骤继续

如果状态被搞乱（如 leaf 重名冲突）：

```bash
# 备份当前状态供事后分析
mv pguide pguide.broken-$(date +%s)

# 重新开始（注意：init 会因目录存在而失败，需要彻底清理）
# 实际上 mv 已经移走了，可以直接 init
```

### 8.4 报告失败

如某步无法解决，收集以下信息报告：

1. 失败发生在第几步
2. 完整的命令行（含 JSON 参数）
3. 完整的 stdout（含 ok:false + error 字段）
4. 退出码
5. 当前 tree dump（用 `node tree-state.js tree dump pguide` 输出）
6. 是否尝试过排查步骤

---

## 9. 附录 — 完整命令一键脚本（供实施者复制粘贴）

> **使用说明**：将下方所有命令按顺序复制到 bash 终端执行。每条命令独占一行，JSON 参数已用单引号包裹。
>
> **预计总执行时间**：60-90 秒（不含 EX1/EX2）

```bash
# === S1 简单二叉树测试 — 完整命令序列 ===
# 工作目录：<workspace>/.context/trees
# prefix：pguide

cd "C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees"

# 清理（如存在）
rm -rf pguide

# 步骤 1: init
node tree-state.js init pguide --root-brief '{"parent_intent":"写一份《如何用 Proma 写 PRD》的小指南(<2000字)","my_mission":"组织两个子任务A/B并行产出+一个整合F合并","why_this_exists":"让新用户快速上手用 Proma 写 PRD","in_scope":["PRD 写作流程","Proma 配合技巧"],"out_of_scope":["PRD 模板下载","企业级 PRD 案例"]}' --root-dod '{"deliverables":[{"path":"docs/proma-prd-guide.md","min_length":1800,"must_contain":["目录","PRD 写作流程","Proma 配合技巧"]}],"quality_gates":[{"type":"self_check","desc":"文档结构完整"}],"self_check":["目录有 3+ 条目","正文两部分齐全"]}'

# 步骤 2: leaf add A
node tree-state.js leaf add pguide --json '{"leaf_id":"pguide-A-flow","session_id":"mock-uuid-pguide-A-001","parent":null,"path":"A","role":"flow","model":"claude-sonnet-4-6","channel":"anthropic"}'

# 步骤 3: leaf add B
node tree-state.js leaf add pguide --json '{"leaf_id":"pguide-B-tips","session_id":"mock-uuid-pguide-B-002","parent":null,"path":"B","role":"tips","model":"claude-sonnet-4-6","channel":"anthropic"}'

# 步骤 4: A brief_echo
node tree-state.js event append pguide pguide-A-flow --type brief_echo --json '{"my_understanding":{"parent_intent":"写一份《如何用 Proma 写 PRD》的小指南","my_mission":"完成 PRD 写作流程章节（约 1000 字，含 5 步流程图）","in_scope":["PRD 写作流程的 5 步分解","每步的 Proma 操作"],"out_of_scope":["技巧部分（由 B 负责）","整合（由 F 负责）"],"dod_essence":"5 步流程图 + 每步说明 + 总字数约 1000"},"milestones_preview":["M1: 5 步流程图初稿","M2: 每步说明补充"]}'

# 步骤 5: A add M1
node tree-state.js milestone add pguide pguide-A-flow --json '{"id":"M1","desc":"5 步 PRD 写作流程图初稿","expect_outputs":["docs/proma-prd-guide/flow.mmd"]}'

# 步骤 6: A add M2
node tree-state.js milestone add pguide pguide-A-flow --json '{"id":"M2","desc":"每步说明补充（约 1000 字总）","expect_outputs":["docs/proma-prd-guide/flow.md"]}'

# 步骤 7: A complete M1
node tree-state.js milestone set-result pguide pguide-A-flow M1 --audit-pass true --note-path "docs/proma-prd-guide/flow.mmd.note.md"

# 步骤 8: A complete M2
node tree-state.js milestone set-result pguide pguide-A-flow M2 --audit-pass true --note-path "docs/proma-prd-guide/flow.md.note.md"

# 步骤 9a: A done event
node tree-state.js event append pguide pguide-A-flow --type done --json '{"deliverables":["docs/proma-prd-guide/flow.md"],"self_check":[{"item":"5 步流程图 Mermaid 渲染","pass":true},{"item":"总字数 1050 字（目标 1000）","pass":true},{"item":"M1 + M2 均已 audit_pass","pass":true}],"context_usage":42}'

# 步骤 9b: A set-status done
node tree-state.js leaf set-status pguide pguide-A-flow done

# 步骤 10: B brief_echo
node tree-state.js event append pguide pguide-B-tips --type brief_echo --json '{"my_understanding":{"parent_intent":"写一份《如何用 Proma 写 PRD》的小指南","my_mission":"完成 Proma 配合技巧章节（约 1000 字，含 3 条技巧）","in_scope":["3 条可复用技巧","每条技巧的 Proma 操作截图说明"],"out_of_scope":["流程部分（由 A 负责）","整合（由 F 负责）"],"dod_essence":"3 条技巧 + 每条 300+ 字说明"},"milestones_preview":["M1: 3 条技巧标题与概述","M2: 每条技巧详细说明"]}'

# 步骤 11: B add M1
node tree-state.js milestone add pguide pguide-B-tips --json '{"id":"M1","desc":"3 条技巧标题与概述","expect_outputs":["docs/proma-prd-guide/tips-outline.md"]}'

# 步骤 12: B add M2
node tree-state.js milestone add pguide pguide-B-tips --json '{"id":"M2","desc":"每条技巧详细说明（约 1000 字总）","expect_outputs":["docs/proma-prd-guide/tips.md"]}'

# 步骤 13: B complete M1
node tree-state.js milestone set-result pguide pguide-B-tips M1 --audit-pass true --note-path "docs/proma-prd-guide/tips-outline.md.note.md"

# 步骤 14: B complete M2
node tree-state.js milestone set-result pguide pguide-B-tips M2 --audit-pass true --note-path "docs/proma-prd-guide/tips.md.note.md"

# 步骤 15a: B done event
node tree-state.js event append pguide pguide-B-tips --type done --json '{"deliverables":["docs/proma-prd-guide/tips.md"],"self_check":[{"item":"3 条技巧齐全","pass":true},{"item":"总字数 980 字（目标 1000）","pass":true},{"item":"M1 + M2 均已 audit_pass","pass":true}],"context_usage":38}'

# 步骤 15b: B set-status done
node tree-state.js leaf set-status pguide pguide-B-tips done

# 步骤 16: leaf add F (A/B 都 done 后启动)
node tree-state.js leaf add pguide --json '{"leaf_id":"pguide-F-integration","session_id":"mock-uuid-pguide-F-003","parent":null,"path":"F","role":"integration","model":"claude-sonnet-4-6","channel":"anthropic"}'

# 步骤 17: F brief_echo
node tree-state.js event append pguide pguide-F-integration --type brief_echo --json '{"my_understanding":{"parent_intent":"写一份《如何用 Proma 写 PRD》的小指南","my_mission":"合并 A 的 flow.md 与 B 的 tips.md 为单一 proma-prd-guide.md，加目录和引言","in_scope":["合并 A+B 产出","加目录","加 200 字引言"],"out_of_scope":["重写 A 或 B 的内容","补充新章节"],"dod_essence":"总字数 >= 1800，含目录、PRD 写作流程、Proma 配合技巧 3 段"},"milestones_preview":["M1: 合并 + 目录","M2: 引言 + 最终校对"]}'

# 步骤 18: F add M1
node tree-state.js milestone add pguide pguide-F-integration --json '{"id":"M1","desc":"合并 A+B + 生成目录","expect_outputs":["docs/proma-prd-guide.md"]}'

# 步骤 19: F add M2
node tree-state.js milestone add pguide pguide-F-integration --json '{"id":"M2","desc":"加引言（200 字）+ 最终校对","expect_outputs":["docs/proma-prd-guide.md"]}'

# 步骤 20: F complete M1
node tree-state.js milestone set-result pguide pguide-F-integration M1 --audit-pass true --note-path "docs/proma-prd-guide.md.M1.note.md"

# 步骤 21: F complete M2
node tree-state.js milestone set-result pguide pguide-F-integration M2 --audit-pass true --note-path "docs/proma-prd-guide.md.M2.note.md"

# 步骤 22a: F done event
node tree-state.js event append pguide pguide-F-integration --type done --json '{"deliverables":["docs/proma-prd-guide.md"],"self_check":[{"item":"总字数 2230 字（>= 1800 目标）","pass":true},{"item":"目录有 4 条目（引言/流程/技巧/总结）","pass":true},{"item":"PRD 写作流程章节齐全（来自 A）","pass":true},{"item":"Proma 配合技巧章节齐全（来自 B）","pass":true},{"item":"M1 + M2 均已 audit_pass","pass":true}],"context_usage":55}'

# 步骤 22b: F set-status done
node tree-state.js leaf set-status pguide pguide-F-integration done

# 步骤 23: 最终 dump（人工核对）
node tree-state.js tree dump pguide

# 步骤 24: validate
node tree-state.js validate pguide

# 步骤 25: 辅助查询（可选）
echo "--- list-all ---"
node tree-state.js leaf list-all pguide
echo "--- list-active (应为空) ---"
node tree-state.js leaf list-active pguide
echo "--- event list (应 6 条) ---"
node tree-state.js event list pguide
echo "--- drift list (应为空) ---"
node tree-state.js drift list pguide
echo "--- heartbeat tail (应为空) ---"
node tree-state.js heartbeat tail pguide
echo "--- backup files ---"
ls -la pguide/*.backup.*.json 2>/dev/null || echo "no backup files (异常：M1 修复后应有 2 个 auto 备份)"

# === 测试完成，清理（按需注释掉以保留状态供分析） ===
# rm -rf pguide
```

---

## 10. 测试完成报告模板（实施者填写）

```markdown
## S1 测试完成报告

**执行时间**: YYYY-MM-DD HH:MM
**执行者**: <agent name>
**总耗时**: <分钟数>

### 命令执行统计
- 总命令数: 25 (基础) + N (扩展)
- 成功: X
- 失败: Y (列出失败的步骤)
- 跳过: Z

### 验证维度核对（§4 的 7 项）
- [ ] 4.1 契约下发完整记录
- [ ] 4.2 事件路由正确 append
- [ ] 4.3 milestones 按预期推进
- [ ] 4.4 F 启动时机在 A/B done 后
- [ ] 4.5 最终 validate 通过
- [ ] 4.6 drift_log 为空
- [ ] 4.7 _meta.write_count = 25

### 额外验证
- [ ] §5 自动备份触发（write_count=10/20 时各 1 个 auto 备份）

### 异常路径（如执行了）
- [ ] EX1 plan 上报
- [ ] EX2 心跳唤起

### 已知风险或意外发现
- <如有，列在此处>

### 结论
- [ ] 通过：S1 验证 v0.1 简单二叉树场景可用
- [ ] 不通过：详见失败步骤和排查记录

### 清理
- [ ] 已删除 pguide/ 目录
```

---

## 修订历史

| 日期 | 版本 | 主要变更 |
|---|---|---|
| 2026-06-18 | v1.0 | 初版。基于 v0.1 已修复（M1/M2/M3 + R1-R5 回归通过）状态设计。采用 prefix=pguide（5 字符，全小写，避免触发 S1 命名正则边界问题）。设计 25 步基础命令 + 2 个异常路径（EX1 plan 上报 / EX2 心跳唤起）。 |
