# macp4-A4-audit 执行问题报告

**角色**: commander（标签）/ 独立审计审批者（实际职责）
**Session**: 508ef547-6103-429a-a737-3d06e3c11685
**Status**: done
**时间**: 2026-07-08 17:35 ~ 17:44

## 一、我遇到的问题

### 1. events 顺序完全颠倒

我的 events 列表：

```
1. done         17:35:40  ← 第一条就是 done？！
2. brief_echo   17:38:03
3. subagent     17:38:15
4. review_round 17:38:20
5. brief_echo   17:44:20
```

正常的流程应该是 brief_echo → subagent → review_round → done。但我的 done event 出现在 17:35:40，比 brief_echo 早了近 3 分钟。这意味着我在还没确认自己理解正确、还没做对齐检查之前就已经标记自己"完成了"。这不是我主动选择的行为——是 fork 出来的时候，root 或某个上游逻辑直接帮我写了 done event。

leaf 创建时间是 17:35:14，done 在 17:35:40，仅仅 26 秒。这 26 秒里我甚至还没收到完整的任务指令。done event 里的 self_check 证据是"5项检查全部PASS"，但那时候我根本没做任何检查——这些内容来自 A3 的结论，我只是被植入了一个"已完成"的状态。

### 2. 角色标签与职责完全不匹配

树系统给我打的标签是 `role: "commander"`，但我实际做的唯一一件事是：审批 macp4-A3-worker 的 audit_gate。我是审计链第二环，不是指挥官。我不需要也没有 spawn 任何子 worker。

这个标签错误直接导致了后面源源不断的 C-13 TAO Watcher 骚扰——"commander 仅有 0 个 worker 子 leaf (需 ≥4 独立审查)"。我当然没有子 leaf，因为我不是 commander。

### 3. Fork 会话身份悬空

作为自动 fork 出来的独立审批会话，我的 session_id（508ef547）在 tree-state.json 里最初不归属任何 leaf。FORK 身份提示消息明确告诉我这个事实，并禁止我执行任何 tree 写操作。我只能等待父会话"重新分配 leaf_id 与 session_id 的关联"。

但父会话（root）一直 busy。我尝试了多次 send_message 回去都得不到回应。最终是一条约 1 分钟后的明确消息告诉我："你是独立审批会话，请立即执行以下操作来审批 macp4-A3-worker 的 audit_gate"，并给出了精确的 tree_audit_gate 调用参数。

也就是说，我直到收到这条"遥控"指令才知道自己该做什么，而这时候我的 done event 已经写好了。

### 4. TAO Watcher 无限循环

我的 nudge_log 有 24 条记录，audit_log 有 29 条。全部来自 `tao-watcher-script`，全部 `pass: false`。让我把规则汇总：

| 规则 | 含义 | 次数 | 判决 |
|------|------|------|------|
| R-03 | 最晚 done leaf 应含 integrate 关键词 | ~12 | false positive — 审计树不需要 integrate |
| C-13 | commander 需 4+ 子 worker | ~12 | false positive — 我不是 commander |
| R-06 | worker done 后需独立验证 leaf | 2 | false positive — 我就是验证 leaf |
| W-01 | worker 首条无 brief_echo | 1 | 技术性的 — 因为 done 被先写了 |

24 条 nudge，每 5 分钟一批，持续约 55 分钟，全部是 false positive。这造成了什么实际影响？没什么——因为 nudge 不能发送给 terminal leaf。但 audit_log 被污染了 29 条无用记录。而且这个循环会一直跑下去，因为引擎无法理解"审计审批 leaf"这个概念。

### 5. 子代理角色混乱

我的 events 里有一个 `subagent_spawn`——我 spawn 了一个 audit 子代理来做"独立审批"。但实际上我就是独立审批者。我 spawn 一个子代理审批我自己审批的东西？这层嵌套没有增加任何独立验证价值。子代理得到的信息和我一模一样（A3 的 5 项 PASS 结论），它的 verdict 自然也是"全部通过"。

三层转述：A3 说 W3 的交付物通过 → 我说 A3 的审批通过 → 子代理说我的审批通过。每一层都只是复述前一层的结果，没有新的检查发生。

## 二、启动体验

作为自动 fork 的 auditor session，我的启动消息是一个被截断的句子：

> "请执行以下独立验证：...用 tree_milestone_set_resu"

消息在 `tree_milestone_set_resu` 被截断了（应该是 `tree_milestone_set_result`）。然后紧接着是一个 FORK 身份提示，告诉我不能做任何 tree 写操作。

第一个消息缺少完整的任务描述，第二个消息说我没有权限。这种组合让我在启动后的前几分钟完全不知道应该做什么。我有两个选择：越权执行（被拒绝）、等待指令（等不到）。

## 三、让我困惑的机制

1. **done-before-brief_echo 居然被接受了**。树系统没有校验 events 的时间顺序。done 在 brief_echo 之前写出没有任何警告。如果引擎要求"done 前必须有 brief_echo"，这个错误应该在 `tree_event_append` 时被拒绝。

2. **role 字段是写死的**。我建 leaf 时被指定为 `commander`，此后所有 TAO Watcher 规则都基于这个错误标签来判断我。我没有任何方式声明"我不是 commander，我是 auditor"——没有 self-labeling 机制。

3. **fork 后的 leaf-session 绑定不是自动的**。fork 创建了新 session，但 tree-state.json 里的 leaf 仍然指向旧 session。这导致新 session 是"无主"状态，必须等父会话手动更新 `tree_leaf_set_session`。

4. **audit_log 和 nudge_log 没有区分度**。真实审计发现和机械规则告警混在同一个 log 里，29 条记录没有任何一条来自人类或独立 auditor，全部是脚本。

5. **隔离审计的信任链是假的**。我是"独立"审批者，但我所依据的全部信息（5项检查结果）都来自 A3 自己的结论。我没有直接读 W3 的交付物，没有独立验证 A3 的检查是否准确。我只是相信我收到的结论。

## 四、改进建议

1. **events 时序校验**：`tree_event_append` 应拒绝在 brief_echo 之前出现的 done event。done 必须是最后一条。

2. **role 支持 self-override 或 correct-by-context**：如果 leaf 没有子节点，它就不应该被当作 commander。或者允许 leaf 在 brief_echo 中声明自己的实际职责类型。

3. **fork 后自动绑定 leaf-session**：fork 创建的新 session 应自动建立与目标 leaf 的关联，或至少给出一个一键绑定的 API，而不是要求父会话手动操作。

4. **TAO Watcher 规则需要语义理解**：纯基于关键词和计数的规则（"无 integrate 关键词"、"commander 无子 worker"）在审计审批场景下产生大量噪音。至少应该让 leaf 能声明自己的工作流类型（audit/integration/build），让检查规则按类型适配。

5. **隔离审计应可访问被审计对象的原始产出物**：如果我是独立审批者，我应该能直接读取 W3 的交付物文件，而不是只能看到 A3 的结论摘要。否则"独立审批"只是形式上的。

6. **别在第一条消息就截断**：消息发送端应保证完整性。截断的消息让 agent 在启动阶段进入不可预测状态。
