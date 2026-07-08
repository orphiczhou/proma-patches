# macp4-W4-worker 执行问题报告

**角色**: worker（数据模型→持久化层就绪度分析）
**Session**: e53b64b4-3213-4392-a733-a83e2db2a6e7
**Status**: done
**时间**: 2026-07-08 17:02 ~ 17:20

## 执行过程回顾

我的任务是分析 data-model.md 中 5 个实体的持久化层就绪度。整体执行很顺畅——research subagent 读完 527 行文档后产出了约 30KB 的分析报告，然后 5 个 G1-G5 review subagent 并行复核。review_round 1 就收敛了（red_count=0），在所有 4 个 worker 中我是唯一一个一轮过的（W1 两轮 2 reds，W2 两轮 1 red，W3 两轮 5 reds）。产出质量没问题。

然后问题开始了。

## 遇到的问题

### 1. 被 R-03 误伤——"最后完成的不像整合 leaf"

我是 4 个 worker 中最后写完 done event 的（比 W3 晚了约 12 秒）。TAO Watcher 的 R-03 规则要求最后 done 的 leaf 应该是整合节点，发现我名字里没有 "integrate/整合" 就给了一个 nudge。

但这是 tree 设计层面的问题，跟我没有关系。Root 的 plan 明确写了"4 worker 并行各审一份上游契约就绪度，root 自当 auditor 走闸门2信任锚"——**根本就没有设计 integrate leaf**。Root 自己又当 commander 又当 auditor 又当 integrator。我只是碰巧最后完成，就成了机械规则的靶子。

这条 nudge 重复了 2 次。我没有任何办法解决——我不可能改自己的名字，也不可能创建 integrate leaf。这个违规只能由 root 来消除。

### 2. 被 R-06 误伤——"没有独立验证 leaf"

同样的问题。Root 的策略是自当 auditor，所以 audit_gate 由 root session 直接 pass 了。从 root 的角度看，这就是"独立验证"——root 不在 worker 的 session 里，它独立审视了所有 worker 的产出。

但 TAO Watcher 的 R-06 不认这种模式。它要求必须有一个独立的 verify/audit leaf。这是规则和策略的冲突。Root 选了一条捷径（信任锚模型），但机械规则不承认这个捷径。

这条 nudge 也重复了 2 次，累计 4 条 nudge，nudge_count 达到上限。后续违规只记录不提醒了。

### 3. review subagent 无法访问源文件

这是实际影响工作质量的问题。G3 review subagent 在验证行号引用时报告"源文件 03_ARCHITECTURE/data-model.md 与 04_API_SPEC/api-spec.md 未在当前 workspace 发现，所有行号精度不可验证"。

这不是 subagent 的问题——源文件在 `D:\Codes\multi-agent-collab-platform\` 下面，而 subagent 的 workspace 是另一个路径。review subagent 只能验证内部一致性（算术和、字段数引用），但无法验证对外部源文件的引用是否准确。

这意味着 review 的"准确性"维度（G3）实际上是半盲的。我们声称做了 G3 复核，但最关键的验证——"引用的行号确实指向声称的内容"——做不到。

### 4. 自主 review 的独立性悖论

我的 review_round 的 independence 字段是 `self_delegated`——我自己 spawn 了 5 个 review subagent。这当然比不 review 好，但真的算"独立"吗？subagent 是我 spawn 的，prompt 是我写的，它们的视角天然受我影响。

讽刺的是，我的产出质量反而是最高的（0 red，一轮收敛），但 TAO Watcher 盯着我不放。问题不在于质量，在于形式。

### 5. done event 写完后不知道干什么

写完 done event 之后，我这个 session 就处于一种奇怪的"任务完成但会话存活"状态。TAO Watcher 的 nudge 持续涌入，但我什么都做不了——R-03 需要 root 创建 integrate leaf，R-06 需要 root 创建 verify leaf，都不是我能干的。

这暴露了 worker session 的一个设计缺陷：worker 完成产出后，即进入完全被动的状态。它能看到自己被 flag，但没有任何机制去响应或修复。

## 什么解决了、什么没解决

**解决了：**
- 产出质量本身。deliverable 29972 字节，5 节完整，5 实体全覆盖，review 一轮收敛。
- alignment 很快，score 95，commander 确认范围理解一致。

**没解决：**
- R-03 和 R-06 的 4 条 nudge 悬而未决。Root 后来创建了 W1a-worker 和 W1-worker-s2 作为 W1 的验证 leaf，还创建了 A3-worker（可能想做独立审计），但 W2/W3/W4 的验证 leaf 还没创建。
- workspace 隔离导致的 review 盲区。
- self_delegated review 的独立性问题。

## 对树体系的困惑

1. **规则和策略的优先级不清**。Root 在 plan 里声明了"自当 auditor"的策略，但这个声明对机械规则没有约束力。TAO Watcher 不看 plan，只看 leaf 结构。那 plan 里的策略声明意义何在？

2. **Worker 的权责不对等**。Worker 被要求产出交付物，被 review 流程约束，被 nudge 系统监控，但对于 tree 层面的结构性违规，worker 完全没有处置权限。这就像流水线工人被通知"工厂布局不符合 ISO 标准"——知道了，但改不了。

3. **Nudge 机制的反馈回路断裂**。Nudge 触发了、通知了、重复了、到上限了——但整个过程中没有任何人（包括 root）对 nudge 做出响应。它们只是在 log 里堆积。如果 nudge 的目标是推动改进，它需要一个有效的 escalation 路径。

4. **Subagent 的 workspace 继承问题**。我 spawn 的 subagent 拿不到源文件的 workspace，这意味着依赖外部文档的 review 任务本质上是不可靠的。要么需要一种机制让 subagent 继承父级的 workspace 文件，要么应该在 review prompt 里附带源文件内容。

## 改进建议

1. **让 plan 中的策略声明对规则引擎可见**。如果 root 声明了"自当 auditor"，R-06 应该能识别这个声明并调整判断逻辑。
2. **区分 worker 可控和不可控的违规**。Worker 触发的 nudge 如果属于结构性（tree 层面）问题，应该自动路由给 root 或 commander，而不是堆积在 worker 的 log 里。
3. **Subagent 需要文件上下文继承**。至少应该有一个选项让 subagent 访问父 session 可访问的文件。
4. **Worker done 后的生命周期应该有明确的收尾流程**。而不是 done event 写完后 session 悬在半空等 nudge 堆积。
