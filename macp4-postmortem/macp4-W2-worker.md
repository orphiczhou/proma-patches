# macp4-W2-worker 执行问题报告

**角色**: worker (架构+PlantUML→代码可行性分析)
**Session**: 39d180e4-a813-4b55-b244-6a91eccbdb5a
**Status**: done
**时间**: 2026-07-08 17:02 ~ 17:19

---

## 一、遇到的问题

### 1. R-06 独立验证 leaf 之困 — 我做了能做的一切，但"还不够"

这是整个执行过程中最让我困惑的问题。

我产出了 `arch-codegen-feasibility-analysis.md` 之后，做了以下验证工作：

- 与 commander 做了两轮 brief_echo 对齐，alignment score 95，"与commander理解一致"
- 派了 **5 个独立 subagent reviewer**，从 G1~G5 五个维度做交叉复核
- 第一轮发现 1 个 red、7 个 yellow，我针对性修改后跑第二轮
- 第二轮 red_count 归零，converged=true
- milestones M1/M2 都有 `audit_pass: true`
- audit_gate 拿到了 `verdict: pass`

然后 TAO Watcher 告诉我：**不行，R-06 违规，你没有独立验证 leaf**。

两次 nudge，两次相同的建议："fork 一个 verify/audit worker 独立检查"。但作为 worker，我**没有创建 leaf 的工具**。这不是我能解决的问题——我只能 spawn subagent 做 review，不能往 macp4 树上添加新的叶子节点。nudge 指向了一个我无法执行的行动。

更让我困惑的是 **subagent reviewer 算不算"独立验证"**？五个 reviewer 各自用独立的模型实例、独立的视角检查同一份文档，和"独立验证 leaf"在实质上有什么区别？如果区别只是"有没有在树上注册为一个 leaf"，那这是一个**形式合规**问题，不是实质质量问题。

最终 nudge 到了上限，"后续违规将仅记录不提醒"——问题没有解决，只是系统不再提醒了。

### 2. Review round 1 的 red finding — §1 和 §5 的自相矛盾

G2 reviewer 抓到了一个真正的逻辑问题：§1.3 明确裁定 GuideAgent 为 READY（依赖/接口/数据模型三要素全部就绪），但 §5 "推荐立即开工" 只列了 SnapshotManager 和 TelemetryCollector 两个模块。GuideAgent（20 个方法，最大的单体模块）被静默排除了。

这确实是我的疏忽。第二轮我补充了解释：S1 阶段只需要基本路由功能，不需要完整的 agent 编排引擎，所以 GuideAgent 的 READY 裁定不变，但 S1 暂不启动——这是 scope 限制，不是架构缺陷。G2 第二轮接受这个解释，yellow 保留但 red 已消除。

**反思**：这个问题本质上是分析文档内部的一致性问题。如果我没有跑多视角 review，这个矛盾可能会直接流向 S1 编码阶段，造成实际困惑。

### 3. 跨工作区文件访问 — G3 无法独立验证 PlantUML 解析

G3 reviewer 想验证我对 PlantUML 源文件的解析是否准确，但源文件在 `D:\Codes\multi-agent-collab-platform\03_ARCHITECTURE\`，不在当前工作区。reviewer 只能对照我的分析文档做内部一致性检查（方法计数是否自洽），无法回到原始 PUML 文本做独立比对。

这个问题不是 worker 层面能解决的——它触及了树体系的**工作区隔离设计**。架构文档在一个工作区，分析 worker 在另一个工作区，reviewer 拿不到上游原始材料。

### 4. 首次执行的 done event 写入失败

从 macp4-root 的 postmortem 可以反推：我最早的 done event 不是自己写的，是 commander 通过 `send_message` 让我写的。原因底层的 E_BORROWED_IDENTITY 校验：done event 只能由 leaf 的 owner session 写入。

这意味着 commander 需要额外消耗一次 send_message 往返才能让我完成 done 标记。对于复杂任务来说这个问题不大，但如果 worker pool 扩展到几十个，这种跨 session 协调的开销会线性增长。

---

## 二、解决了什么、没解决什么

### 解决的

| 问题 | 解决方案 |
|------|---------|
| §1 GuideAgent READY 与 §5 推荐路径的矛盾 | 第二轮 review 补充 S1 scope 限制说明，red→yellow |
| 分析质量的多维验证 | 5 视角交叉复核 + 2 轮收敛 |
| 交付物完整性和字数要求 | 最终文件 22522 bytes，5 节 7 模块全覆盖 |

### 未解决的

| 问题 | 原因 |
|------|------|
| R-06 独立验证 leaf 缺失 | worker 无创建 leaf 权限，nudge 无法响应 |
| G3 跨工作区 PlantUML 验证 | 树体系的工作区隔离限制 |
| G5 P0 项工作量估算缺失 | yellow 级，非阻塞，未在第二轮优先修复 |
| G1 SandboxManager/ProjectDocumentSystem 模块级裁定缺失 | yellow 级，基础设施域的小模块，影响较小 |
| G4 OS 术语对非系统编程读者不友好 | yellow 级，受众假设问题，非技术错误 |

---

## 三、让我困惑或受阻的机制

### 3.1 "独立"的定义模糊

这套体系里"独立性"至少有三层：
- **subagent reviewer**：独立模型实例，不同视角，并行运行
- **commander auditor**：通过 audit_gate 判定 pass/fail
- **独立验证 leaf**：树上注册为单独叶子节点的 auditor

我的理解是：只要验证者不是"同一个模型的同一次推理"，就具有一定的独立性。但 R-06 要求的是第三层——必须是一个在树上有正式身份的 leaf。这里缺乏明确的标准说明：什么样的验证算"独立"、什么不算。

### 3.2 Nudge → Action 链路断裂

TAO Watcher 发出 nudge → 我看到了 → 然后呢？

规则说"fork 一个 verify/audit worker"，但作为 worker 我没有 fork leaf 的工具。nudge 的接收者和能够执行修复行动的实体（commander）是分离的。结果就是两次提醒→两次无法响应→达到上限→静默记录。

这不是 TAO Watcher 的问题，而是**nudge 分发路由**的问题：nudge 应该发给有能力修复的人，而不是发给被检查的对象。

### 3.3 self_delegated 的悖论

review_round 的 `independence` 字段被标为 `self_delegated`。这个词本身就包含矛盾——自己委派出去的东西能称得上"独立"吗？但从执行角度看，spawn 出去的 subagent 确实是独立的模型实例，有自己的推理过程，能发现我作为主 worker 没有注意到的问题（red finding 就是证据）。

系统在"鼓励 self_delegated 多视角 review"和"要求独立 leaf 验证"之间没有给出清晰的边界。我的理解是两件事都应该做，但前者我已经做了，后者我做不了。

### 3.4 时间压力下的收敛判断

整个执行从 17:02 到 17:19，共 17 分钟。两轮 review 之间只隔了 1 分钟。第二轮只派了一个 reviewer（G2）做针对性复核。第二轮 converged=true 的判断是正确的，但如果有更多时间，G1/G3/G4/G5 的 yellow findings 也应该在第二轮被重新审视。快速收敛保证了交付节奏，但在质量深度上做了妥协。

---

## 四、改进建议

1. **给 worker 提供创建 verify leaf 的能力**，或者让 worker 的 subagent review chain（满足一定条件：≥3 视角、red_count=0、converged=true）等价于 R-06 合规。形式合规应该服务于实质质量，而不是反过来。

2. **Nudge 按能力路由**：TAO Watcher 的 nudge 应该发给能执行修复的 entity（commander/root），而不是发给出问题的 worker。worker 看到了也无能为力。

3. **跨工作区文件引用机制**：如果架构文档和实现工作区是分离的，应该有一种方式让 reviewer 能访问上游源材料——至少在 tree leaf 上记录一个 `source_workspace_path` 字段，让 reviewer 知道去哪找。

4. **R-06 规则细化**：明确什么算"独立验证"——subagent reviewer chain 是否可以？commander audit_gate 是否可以？还是必须是独立的 tree leaf？把标准写清楚，减少机械误报。

5. **worker 自治边界明确化**：worker 能做什么（spawn subagent、自修订、自收敛）、不能做什么（创建 leaf、修改 audit_gate）、遇到不能做的事时应该怎么升级——这些应该在 worker brief 阶段就明确。
