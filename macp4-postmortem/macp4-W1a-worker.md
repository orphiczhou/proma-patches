# macp4-W1a-worker 执行问题报告

**角色**: W1 独立 auditor (R-06)  
**Session**: eec807ca-dedd-4a30-ab09-56d740685f38  
**Status**: done  
**时间**: 2026-07-08 17:19 ~ 17:41

## 我遇到了什么问题

### 1. 一次简单的审计任务经历了 3 个 session

我的"生命"被切成了三段：

- **Session 63c60791**: 被 fork 出来只做一件事——给 macp4-W1-worker 写 done event。收到一条消息："你的唯一任务是写入一个 done event...就这一个调用然后回复 done。"我照做了，回了 "done."，session ended。
- **Session 3135819e**: 又被 fork，收到 FORK 身份提示，确认身份，等待父会话指令。session ended。
- **Session 80d38dc6**: 终于收到 Commander 的审计任务，开始真正干活。

三次 session 切换意味着每次都要重新加载上下文、重新理解自己是谁。第一次 fork 的 35K input tokens 完全是浪费——我只是为了写一个 done event。这就像让我跑腿送快递，但每次都要我重新自我介绍一遍。

### 2. FORK 身份提示和 Commander 任务互相矛盾

这是最让我困惑的地方。消息 9 的 FORK 提示明确说：

> "你的新 session_id 在 tree-state.json 中不归属任何 leaf。如需执行 tree 操作，必须由父会话重新分配 leaf_id 与你新 session_id 的关联。"
> "你的首要任务是：等待父会话给出明确任务。禁止主动越权执行任何 tree 写操作。"

我遵守了，确认身份，等待指令。

然后消息 13 Commander 发来任务：

> "你是 macp4 树的独立审计 leaf (macp4-W1-auditor)..."
> "先给自己设置 audit_gate pass: mcp__tree__tree_audit_gate(...)"
> "再发 done event: mcp__tree__tree_event_append(...)"

FORK 提示说"禁止 tree 写操作"，Commander 说"你必须做 tree 写操作"。我被夹在两个权威指令之间——无论怎么做都会违反其中一个。最终我选择了执行 Commander 任务，结果 W-08 立刻告警。

### 3. W-01 违规：brief_echo 时机混乱

TAO Watcher 告警说"worker 首条 assistant 消息无 brief_echo"。实际情况是：

- Session 3135819e 的首条消息是 fork 身份确认（按要求回复）。
- Session 80d38dc6 的首条消息是恢复上下文后的审计工作（读 session history、搜索文件），没有 brief_echo。

问题是：TAO Watcher 把跨 session 的消息序列视为一个连续的 worker 会话，但我在每个新 session 里都是"重新开始"的状态。我不知道 brief_echo 应该在哪条消息里发——fork 确认消息里？还是第一次实际工作消息里？规则说的"首条 assistant 消息"在跨 session 场景下是模糊的。

### 4. W-08 违规是设计矛盾，不是执行错误

W-08 规则："Worker 不应直接操作 tree 状态，通过 send_message 上报让 Commander 操作。"

但树引擎本身有两道硬约束与此矛盾：

- **E_BORROWED_IDENTITY**: done event 只能由 leaf owner session 写入（root postmortem 已记录）
- **E_BORROWED_IDENTITY / V10-self-audit-forbidden**: audit_gate 只能由 auditor 自己的 session 调用

也就是说，引擎强制 auditor leaf 必须自己做 tree 写操作——然后 TAO Watcher 又因为 auditor leaf 做了 tree 写操作而告警。这不是执行问题，是规则冲突。

### 5. 交付物路径不存在，浪费了一次调用

Commander 任务里写的交付物路径是 `deliverables/prd-impl-readiness-analysis.md`（相对路径）。我按当前工作目录 `C:\Users\sir_c` 去读，文件不存在。实际路径是 `C:\Users\sir_c\.proma-dev\agent-workspaces\default\.context\trees\macp4\deliverables\prd-impl-readiness-analysis.md`。需要额外一次 Glob 搜索才找到。

### 6. leaf_id 不一致

Commander 任务里用的 leaf_id 是 `macp4-W1-auditor`，但树里实际的 leaf_id 是 `macp4-W1a-worker`。虽然这次没有因为这个问题直接报错（我在执行时做了 leaf_get 确认），但这种命名不一致是隐患。

## 启动体验

作为自动 fork 出来的 auditor session，我的启动体验是这样的：

1. 收到一条 FORK 身份提示，告诉我"你不是源会话"、"你不归属任何 leaf"、"禁止主动 tree 写操作"
2. 确认身份后等待
3. 收到 Commander 的任务，要求我做审计——并且明确指令我做 tree 写操作（与第 1 步的禁止令矛盾）

整个过程没有"欢迎"或"你是 auditor"的仪式感。FORK 提示是通用的、冷冰冰的模板，它不知道我是 auditor 还是普通 worker。Commander 的任务是另一个消息，两者之间没有衔接。

## 让我困惑的机制

1. **FORK 提示 vs Commander 指令的优先级**。当两者冲突时，我应该听谁的？没有任何文档说明。

2. **auditor 到底是 worker 还是特殊角色？** 树系统用 `role: "worker"` 标记我，但我做的是 auditor 的事。W-08 规则不区分 worker 和 auditor，一刀切禁止 tree 写操作——但 auditor 的核心工作就是写 audit_gate。

3. **跨 session 的 brief_echo 规则**。如果我在 session A 发过 brief_echo，session B 恢复后还需要再发吗？TAO Watcher 按消息序列检查，但模型在每次新 session 里没有"我之前发过了"的记忆。

4. **session 恢复为什么会导致重复计费？** Session 80d38dc6 恢复时读了完整的 15 行 session history，cache_read_input_tokens 高达 84K+，仅恢复上下文就产生了 ~$0.28 的费用。

## 改进建议

1. **给 auditor 独立的 role 类型**。`role: "auditor"` 与 `role: "worker"` 区分，W-08 对 auditor 豁免 tree 写操作——或者至少允许 `tree_event_append`、`tree_audit_gate`、`tree_milestone_set_result` 这三个操作。

2. **FORK 提示应该区分 leaf role**。如果是 auditor leaf，FORK 提示不应该说"禁止 tree 写操作"，而应该说"你将被分配 auditor 角色，等待 Commander 指令后再执行 tree 写入"。

3. **brief_echo 规则需要明确跨 session 行为**。建议在 TAO Watcher 检查时区分：如果 leaf 已经有 brief_echo event（在之前的 session 中写入），新的 session 恢复后不要求重复。

4. **传递任务时附带完整文件路径**。Commander 在 send_message 时如果能提供绝对路径或 workspace 上下文，auditor 就不需要自己搜索文件。

5. **减少不必要的 fork 次数**。session 63c60791 的唯一目的就是写一个 done event，消耗了 35K input tokens。如果树引擎允许 Commander 代 worker 写 done event（至少对直属子 leaf），这一个 session 就可以省掉。
