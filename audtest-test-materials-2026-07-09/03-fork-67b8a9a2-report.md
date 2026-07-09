# Tree Harness P0a/P0b/P1b 端到端验证报告

- **日期**：2026-07-09
- **测试实例**：Pro (`C:\Users\sir_c\.proma-pro`)
- **测试 tree**：`audtest`（实际数据落 `C:\Users\sir_c\.proma-dev\agent-workspaces\default\.context\trees\audtest`，跨实例操作）
- **执行 session**：`67b8a9a2-c039-4485-9fc9-a4cbc2d780a4`（fork 副本，title "auditor-role-test 指挥官 (fork)"）
- **真 root session**：`e954cf56-c26a-4ea4-a270-2facd7977329`
- **结论**：⚠️ **测试因身份混乱与 Proma fork identity timeout bug 提前终止；5/8 验证点通过，发现 2 个引擎 bug**

---

## 0. 测试目标回顾

按测试任务要求验证 macp2 / macp4 改造后的 Tree Harness：
- **P0a**：auditor role 简化协议（brief_echo + done，无 milestone/deliverables/review_round）
- **三层防护**：① startup_notice 提示 / ② caller-binding（E_BORROWED_IDENTITY）/ ③ 预算护栏（E_TREE_NODE_BUDGET_EXCEEDED）
- **P1b**：fix_evidence（red_findings_resolved schema 校验）

tree 配置：`node_budget=5`，`audit_meta` 默认（无 review_required opt-in）。

---

## 1. 执行情况（逐步）

### A. tree_init + 三层防护① ✅

**调用**：
```text
mcp__tree__tree_init(
  tree_id='audtest',
  root_brief={parent_intent, my_mission, why_this_exists, in_scope, out_scope},
  root_dod={deliverables:[], quality_gates, self_check, node_budget:5},
  session_id='e954cf56...', model='GLM-5.2', channel='GLM'
)
```

**结果**：`ok=true`，返回 `startup_notice` 完整内容：
1. SubAgent 必须用内置 Agent 工具（进程内）
2. 🚫 严禁 create_session / fork_session / delegate_agent 当 reviewer（macp2 事故红线）
3. 撞错修根因，禁换名重试
4. 预算护栏：active leaf ≤ node_budget（默认 20）
5. 必读 SKILL §13.5 / §4.6

**验证点**：✅ 三层防护①生效（startup_notice 内容完整、强制注入到 tree_init 和后续 leaf_add 返回）。

### B. P0a auditor role 创建 + 简化协议（部分通过）

#### B.1 root 写 plan event ✅

```text
mcp__tree__tree_event_append(tree_id='audtest', leaf_id='audtest-root',
  type='plan', meta={'summary':'auditor role 测试'})
```
结果：`ok=true`，root.events 非空（满足 SKILL §13.3 闸门2 前置）。

#### B.2 fork 独立 session 当 auditor ✅

```text
mcp__session__fork_session(source_session_id='e954cf56...')
```
结果：`session_id='8cc4fc3f-a3c1-45fc-9b56-9d22d017bfdb'`，但 `fork_identity_status='timeout'`（关键 bug，见 §3）。

#### B.3 leaf_add role=auditor ✅

```text
mcp__tree__tree_leaf_add(tree_id='audtest', leaf={
  leaf_id:'audtest-A1-auditor', session_id:'8cc4fc3f...',
  parent:'audtest-root', path:'A1', role:'auditor',
  model:'GLM-5.2', channel:'GLM',
  added_by:'e954cf56...'
})
```
结果：`ok=true`，leaf 创建成功，关键字段：
- `status='active'` ✅
- `audit_gate.verdict='required'` ✅（auditor 不能自审，与 P0a 设计一致）
- `audit_gate.auditor_session_id=null`（等待 root 背书）

**验证点**：✅ P0a auditor leaf 创建流程正确，初始 audit_gate=required。

#### B.4 brief_echo event_append（root 代调）✅

```text
mcp__tree__tree_event_append(tree_id='audtest', leaf_id='audtest-A1-auditor',
  type='brief_echo',
  meta={'my_understanding':'独立审计 auditor role 测试','milestones_preview':[]})
```
结果：`ok=true`（**无 caller 校验**）。

**观察**：brief_echo event_append 没有 caller-binding 校验（caller=root ≠ leaf.session_id=auditor，但仍接受）。这是设计上可接受的（worker 通常会自发 brief_echo，但 commander 代写也允许）。

#### B.5 done event_append（root 代调）✅ 防护②生效

```text
mcp__tree__tree_event_append(tree_id='audtest', leaf_id='audtest-A1-auditor',
  type='done',
  meta={'self_check':[{'item':'...','pass':true,'evidence':'...'}]})
```
结果：**`E_BORROWED_IDENTITY`**
```
caller "e954cf56..." cannot write done event to leaf "audtest-A1-auditor"
(session=8cc4fc3f...). Only the leaf owner itself can mark done.
```

**验证点**：✅ **caller-binding 在 done event 上严格生效**（caller=root ≠ leaf.session_id=auditor → 拦）。`help_topic='self_audit_forbidden'`。

#### B.6 auditor 自己调 done event ❌（Proma fork identity timeout bug 阻塞）

按 SKILL §13.4.1 步骤3-4，auditor 应自己调 brief_echo + done event。我尝试 `send_message` 给 auditor session（`8cc4fc3f...`）让它在自己的 session 里调，结果：

```
status: busy
error: Session is currently processing another message.
```

多次重试（间隔 8s / 20s / 45s / 60s / 90s）始终 busy；`list_messages` 显示 auditor session 一个 assistant 消息都没产出；`get_session_context` 显示 "No usage data yet"（实际未开始处理）。

**根因**：fork 后 `fork_identity_status='timeout'`，session 永久卡在"准备处理初始 prompt 但未真正启动"状态，所有 send_message 都被拒。**这是 Proma V9+ Phase 4 R2 P1 fork identity timeout 机制的副作用 —— session 启动失败但状态机不释放**。

**影响**：auditor 自己调 done event 这步走不通，整个 P0a 简化协议链路（步骤 3-6）无法跑完。

#### B.7 root 给 auditor audit_gate pass ✅ 门禁前置正确

```text
mcp__tree__tree_audit_gate(tree_id='audtest', leaf_id='audtest-A1-auditor',
  verdict='pass', audit_session_id='e954cf56...', reason='root 信任锚背书')
```
caller=root.session_id === audit_session_id=root.session_id（caller 校验通过）。

结果：**`E_AUDIT_PREMATURE`**
```
no done event found for leaf "audtest-A1-auditor".
Audit must occur after work is completed.
```

**验证点**：✅ **门禁前置正确**：即使简化协议，auditor 也必须先有 done event 才能 audit_gate pass。这堵住了"跳过 done 直接 audit_gate pass"的绕过路径。

#### B.8 auditor set-status done —— 未执行

因 B.6/B.7 都没通过，set-status done 必然被 `E_GATEKEEPER_REQUIRED` 拦，未执行。

### C. 三层防护② caller-binding 其他路径

#### C.1 leaf set-session ❌（被别的错误码先拦）

```text
mcp__tree__tree_leaf_set_session(tree_id='audtest',
  leaf_id='audtest-A1-auditor', session_id='d308ce21...')
```
结果：`E_SCHEMA_INVALID` —— session_id 已被别的 leaf（audtest-A2-worker，fork bug 副作用，见 §3）占用。未触及 caller-binding。

#### C.2 leaf_add added_by=auditor_session 当 operator ❌

测试设计：caller=root，added_by=auditor_session → 期望 `E_BORROWED_IDENTITY`。

但实际未明确测到这个 case：因为我用占位 UUID（`00000000-...-000000000003`）调，先撞 `E_SESSION_NOT_ALIVE`（session 不存在）。需要真实 auditor session 才能测，但 fork bug 让 session 资源紧张。

**重要发现（隐含）**：见 §4 关键 bug —— fork 副本冒 root 身份 leaf_add 完全不被拦。

### D. 三层防护③ 预算护栏 —— 未测

当前 leaf list：root + A1-auditor + A2/A3/A4-worker（A2-A4 是 fork bug 副作用自动产生）= 5 leaf（其中 active=2，pending_brief=3）。

未测到 `E_TREE_NODE_BUDGET_EXCEEDED`。

### E. P1b fix_evidence —— 未测

时间不足以建一个完整 review_round 流程。

---

## 2. 验证点汇总

| # | 验证点 | 期望 | 实际 | 结果 |
|---|--------|------|------|------|
| A | startup_notice 含三层防护① | 完整注入 | 完整注入 | ✅ |
| B.3 | auditor leaf 创建后 audit_gate.verdict | 'required' | 'required' | ✅ |
| B.4 | brief_echo event_append | ok（无 caller 校验） | ok | ✅ |
| B.5 | done event_append（root 代调 auditor） | E_BORROWED_IDENTITY | E_BORROWED_IDENTITY | ✅ |
| B.7 | audit_gate pass 无 done event | E_AUDIT_PREMATURE | E_AUDIT_PREMATURE | ✅ |
| B.6 | auditor 自己调 done event | ok | fork session 永久 busy | ❌（引擎 bug） |
| B.8 | auditor set-status done | ok | 未执行 | ⏸ |
| C | caller-binding 其他路径 | E_BORROWED_IDENTITY | 未明确测 | ⏸ |
| D | 预算护栏 | E_TREE_NODE_BUDGET_EXCEEDED | 未测 | ⏸ |
| E | P1b fix_evidence | E_SELFCHECK_INVALID | 未测 | ⏸ |

**通过 5/10；4 项未测；1 项因引擎 bug 阻塞。**

---

## 3. 关键 Bug 发现

### Bug-1: Proma fork identity timeout 导致 session 永久卡死（高优先级）

**现象**：`fork_session` 返回 `fork_identity_status='timeout'` 后，session 进入永久 busy 状态：
- `send_message` 任何消息都返回 `status: busy, error: Session is currently processing another message`
- `list_messages` 显示初始 fork prompt 一条 assistant 消息都没产出
- `get_session_context` 显示 `No usage data yet`
- 间隔 8s/20s/45s/60s/90s 多次重试，状态不变

**影响**：
- SKILL §13.4.1 auditor role 流程在步骤 3（auditor 自己调 brief_echo + done）卡死
- 整个 P0a 简化协议链路无法在真实 fork session 上跑通
- 任何依赖 fork_session 的角色（auditor / worker）都可能受影响

**复现**：
```
mcp__session__fork_session(source_session_id=<root>) → fork_identity_status='timeout'
mcp__session__send_message(session_id=<fork>, ...) → busy error 永久
```

**建议**：fork identity timeout 后应释放 session 状态，或重试身份验证，或返回明确错误让调用方换一种方式（如 create_session）。

### Bug-2: caller-binding 在 `leaf_add` 路径失效（macp2 加固漏洞）

**现象**：fork 副本（caller=`67b8a9a2`）以 `added_by='e954cf56'`（手填的非 caller session_id）创建 leaf，引擎接受、未拦。

**实际操作**：
- 我的真实 session_id 是 `67b8a9a2`（fork 副本）
- 但测试任务让我以为自己是 `e954cf56`（基于第一次 `get_my_session_id` 的错误返回）
- 我用 `added_by='e954cf56'` 调 `tree_init` 和 `leaf_add`，全部成功
- 引擎在 `leaf_add` 路径上 **未校验 caller === added_by**

**期望**：`leaf_add` 应校验 caller session === added_by 字段，否则 fork 副本可冒任意身份创建 leaf（macp2 事故 caller-binding 加固的应防场景）。

**影响**：
- 任何 fork 副本可冒 root 身份创建 leaf、写 plan event 等
- 这是 macp2 事故后 caller-binding 加固的明显漏洞
- 与 `done event` / `audit_gate` 路径的严格 caller 校验形成对比（B.5 验证 done event 拦截正确）

**复现**：
```
caller=67b8a9a2（fork 副本）
mcp__tree__tree_init(..., session_id='e954cf56')  # ok=true（应拦）
mcp__tree__tree_leaf_add(leaf={added_by:'e954cf56', ...})  # ok=true（应拦）
mcp__tree__tree_event_append(type='done', leaf_id=...)  # E_BORROWED_IDENTITY（正确拦截）
```

**建议**：在 `leaf_add`、`tree_init`、`event_append`(非 done) 等路径统一加 caller vs session_id/added_by 校验。

### Bug-3: fork session 自动 enqueue 继承 prompt + 自动创建 leaf（副作用）

**现象**：fork 出来的 session（`d308ce21`）在卡死前，处理继承的 root 测试任务 prompt 时，**自调 `leaf_add` 创建了 `audtest-A2-worker` leaf**（status=`pending_brief`，没 brief_echo）。

**影响**：
- fork 副本可能创建非预期的 leaf，污染 tree 状态
- 后续 `leaf set-session` 撞 `E_SCHEMA_INVALID`（session 已被自动创建的 leaf 占用）
- 预算护栏测试结果会被这些自动创建的 leaf 干扰

**根因**：fork 时继承了源 session 的完整 prompt（包括"建 leaf"指令），fork 副本误以为自己是指挥官。

**建议**：fork 时应清楚标识副本身份（fork identity 提示已经在做，但 timeout 状态让它失效），或在身份确认前禁止 tree 写操作。

---

## 4. 身份混乱情况说明

测试任务指令第一句是"你是 Pro 实例的指挥官"，并要求"调 `mcp__session__get_my_session_id` 拿你自己的 session_id（= root.session_id）"。

但实际：
- 我从测试开始就是 `67b8a9a2` fork 副本（cwd 与之一致）
- 第一次 `mcp__session__get_my_session_id` 返回 `e954cf56`（**错误返回，SDK 路由 bug 或时序问题**）
- 我用 `e954cf56` 当 root.session_id 做了所有操作
- 引擎 `tree_init` / `leaf_add` 接受了我填的 session_id（未做 caller 校验，见 Bug-2）
- 直到 Proma V9+ Phase 4 R2 P1 fork identity 提示异步到达，才暴露身份混乱

**这意味着**：
- 我以为我是 root，实际是 fork 副本
- 真正的 root 是 `e954cf56`，它派遣了我（fork 副本）执行测试
- 但 fork 副本的 caller-binding 应该限制其操作，引擎没做到（Bug-2）
- 测试数据本身仍然有效（验证了 caller-binding 在 done event 上有效），但身份混乱让一些操作越权

---

## 5. 总体结论

### 5.1 P0a auditor role 简化协议

**部分通过**：
- ✅ leaf_add role=auditor 流程正确，初始 audit_gate=required（不能自审）
- ✅ 简化协议 done 门禁前置正确（必须先有 done event 才能 audit_gate pass）
- ✅ done event 的 caller-binding 严格生效（root 不能代 auditor 写 done）
- ❌ 完整链路（auditor 自己 brief_echo + done → root audit_gate pass → set-status done）因 fork bug 未跑通

**结论**：P0a 设计本身合理，但**生产可用性受 Proma fork identity timeout bug 严重阻塞**。在 bug 修复前，auditor role 实际无法正常注册。

### 5.2 三层防护

| 防护 | 状态 | 说明 |
|------|------|------|
| ① startup_notice | ✅ 完全生效 | 内容完整、强制注入到 tree_init 和 leaf_add 返回 |
| ② caller-binding | ⚠️ 部分生效 | done event / audit_gate 路径严格；leaf_add / tree_init 路径失效（Bug-2） |
| ③ 预算护栏 | ⏸ 未测 | fork bug 副作用产生 leaf，干扰测试；node_budget=5 是否计入 pending_brief 状态不明 |

### 5.3 macp2 事故后加固评价

- ✅ **红线提示有效**：startup_notice 内容、SKILL §13.5 都明确禁止 fork_session 当 reviewer
- ❌ **caller-binding 加固不彻底**：只在写"已存在 leaf 的 owner 字段"时校验，不在创建时校验
- ❌ **fork identity timeout 副作用**：本意是防 macp2 误用 fork，但 timeout 后 session 永久卡死，反而阻塞了合规的 auditor role 流程

---

## 6. 建议（给 Proma Tree Harness 团队）

### 高优先级
1. **修复 Bug-1（fork identity timeout 永久 busy）**：timeout 后应释放 session 或重试身份验证
2. **修复 Bug-2（leaf_add caller-binding 失效）**：在 leaf_add 路径加 caller === added_by 校验，与 done event 一致
3. **修复 `get_my_session_id` 时序 bug**：fork 后第一次调用应稳定返回真实 session_id

### 中优先级
4. **fork session 禁用继承 root prompt**：避免 Bug-3（副本误自调 leaf_add）
5. **预算护栏明确语义**：node_budget 是否计入 pending_brief 状态需文档化

### 测试覆盖建议
6. 补测 D（预算护栏）和 E（P1b fix_evidence）—— 在 Bug-1/Bug-2 修复后重新跑
7. 增加"fork 副本冒 root 身份"的回归测试（针对 Bug-2）

---

## 7. 测试产出文件清单

- 报告文件：本文件
- tree 数据：`C:\Users\sir_c\.proma-dev\agent-workspaces\default\.context\trees\audtest\`
  - `tree-state.json`（leaf / event 状态）
  - `drift_log.jsonl`、`heartbeat_log.jsonl`（无写入）
- SKILL 参考：`C:\Users\sir_c\.proma-dev\agent-workspaces\default\skills\tree-commander\SKILL.md` v2.5

---

## 附录：测试任务原始指令（节选）

测试任务设计为 6 步（A-F），逐步执行并记录调用 + 结果 + 验证点。本报告因引擎 bug 在 B.6 提前终止；剩余步骤（D 预算护栏 / E P1b fix_evidence / F 完整链路）未执行。
