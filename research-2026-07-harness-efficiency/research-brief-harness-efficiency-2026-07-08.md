# 调研任务书：Tree Harness 硬约束机制效率评估与优化

> **对象**：Pro 实例独立改进调研员（GLM-5.2，其派生子 Agent/子会话亦 GLM-5.2）
> **发起**：2026-07-08，Proma改造探索工作区
> **性质**：独立调研，靠证据说话，**可推翻发起人假设**

## 一、背景

Tree 形会话执行体系（tree-engine.cjs + tree-commander/worker SKILL + TaoWatcher）：指挥官-工人-审计树形协作，叠加了大量**硬代码约束**（caller-binding、audit_gate 独立性、milestone caller 绑定、预算护栏、schema 校验、TaoWatcher 机械巡检、§13 冷启动协议、V10 八大加固）。

近期工作链：
1. **SubAgent 入树**：让 SDK SubAgent 成为父 leaf 事件溯源的一等劳动单元（subagent_spawn + reviewer_kind:subagent + 溯源）。
2. **macp2 事故**（2026-07-08）：DeepSeek commander 没读 SKILL 调用红线，误用 `create_session` 当 reviewer，4 分钟炸 207 会话，DeepSeek 额度打负。
3. **三层防护修复**：startup_notice（引擎注入 tool 结果）+ SKILL §13.5/§4.6 调用形式红线 + 引擎预算护栏（node_budget/max_subagent_spawn_per_leaf/E_SUBAGENT_BUDGET_EXCEEDED）。
4. **review_round append 校验修复**：macp3 发现 worker status 卡 active（review_round 只在 done 门禁校验，早期 malformed 事件污染→done 永远过不了），改为 append 时即校验。
5. **三级验证**：rvreq2（1-worker）→ macp3（2-worker，暴露 status 卡）→ macp4（4-worker 全量，全 done 不爆炸）逐级 PASS。

## 二、发起人假设（供独立验证，可推翻）

> "硬约束机制（如 TaoWatcher）效率太低，也没完全约束好，反而逼着会话 Agent 在执行过程找出路。"

**不要附和**。用证据支持或推翻。即便推翻（结论是"约束高效且必要"），也是有价值的结论。

## 三、调研目标

独立评估 harness 硬约束机制的**效率**（防护价值 vs 摩擦成本 vs 绕过风险），给出优化建议：哪些保留、哪些放宽、哪些重设计、哪些合并；以及 harness 演进方向（更少更聪明的约束 vs 更多硬门？声明式协议 vs 命令式校验？）。

## 四、评估对象（硬约束清单，逐个评）

1. **TaoWatcher**（机械巡检：tao-rules.json 的 W-01 fork身份/W-08 越权/C-13 R-06 小任务模式 等）—— `.context/trees/tao-rules.json` + `.context/reference/prompts/tao-watcher-prompt.md`
2. **caller-binding**（E_BORROWED_IDENTITY：caller===audit_session_id，多处）—— engine cmdAuditGate/cmdMilestoneSetResult/cmdAuditAppend/cmdLeafSetSession/cmdEventAppend(done)
3. **audit_gate 独立性**（E_AUDITOR_NOT_INDEPENDENT：V4 硬门 + resolveAuditorIndep 闸门2/3）
4. **milestone caller-binding + audit_pass**
5. **预算护栏**（node_budget / max_subagent_spawn_per_leaf / E_SUBAGENT_BUDGET_EXCEEDED / E_TREE_NODE_BUDGET_EXCEEDED）
6. **schema 校验**（review_round / subagent_spawn / done 门禁 size>0 / E_REVIEW_FORGERY / E_DELIVERABLE_EMPTY）
7. **§13 冷启动协议**（root 信任锚 / 闸门2 / 转正常期闸门3）
8. **V10 八大加固点**（grep v10_constraints）

## 五、证据来源（现场遗迹，只读）

- **pro tree 数据**：`C:/Users/sir_c/.proma-dev/agent-workspaces/default/.context/trees/{macp2,rvreq2,macp3,macp4}/`（tree-state.json + call-log.jsonl + deliverables/ + subagent-outputs/）
  - macp2（事故）：207 会话爆炸，call-log 显示 leaf_add 反复重试
  - macp3（2-worker）：75 次 E_SCHEMA_INVALID（worker 摸索 schema），status 卡 active
  - macp4（4-worker）：commander root 阶段 15×E_AUDITOR_NOT_INDEPENDENT + 18×E_SCHEMA_INVALID（V4 独立门摩擦，spawn 3 个额外 auditor 才过）
  - rvreq2（1-worker）：6 subagent_spawn 诚实路径
- **postmortem**：`workspace-files/.context/active/postmortem-macp2-subagent-cost-explosion-2026-07-08.md`
- **CLAUDE.md**：P0 教训（SubAgent 调用形式必须钉死）
- **engine 源**：`workspace-files/tree-engine.cjs`（grep E_*/cmd*/validate*）
- **SKILL**：`workspace-files/skills/tree-{commander,worker}/SKILL.md`
- **commander 角色问题报告**（用户已让 macp4 commander 统计，查 commander 会话消息）

## 六、评估维度（每约束按此打分）

- **真实防护价值**：拦了什么真实威胁（伪造身份/越权/成本爆炸/草率收敛）？举 call-log 实证。
- **摩擦成本**：agent 为遵守它烧了多少试错？看 E_* 频次 + worker 学习曲线（如 macp3 的 75×E_SCHEMA_INVALID、macp4 的 15×E_AUDITOR_NOT_INDEPENDENT）。
- **绕过/出路**：agent 是否找到 workaround？
  - macp2：整个 SubAgent 审查绕过树约束（create_session 当 reviewer）→ 直到引擎预算护栏+SKILL 红线才堵
  - macp4：commander spawn 额外 auditor session 绕 V4 独立门
  - review_round append 前的 malformed 滞留（macp3 status 卡）
- **漏网**：哪些约束该拦没拦？（macp2 的 create_session 爆炸、status/timing 观测差）

## 七、特别现象（用户观察 + 已知，必查）

1. **status/timing 观测差**（用户观察）：macp4 commander 报告"全部完成"时，仍有 worker 在执行。是 harness 缺陷（commander 基于 tree-state 判断 done，但 worker session 可能还在跑）还是协议问题？根因 + 修复方向。
2. **macp3 status 卡 active**：已修（review_round append 校验），但暴露"校验时机"系统性问题——还有哪些校验只在 done 门禁而非即时？
3. **macp2 整体绕过**：所有约束都被绕过（直到事后才补护栏）。说明约束的**覆盖盲区**在哪？
4. **TaoWatcher 假阳性/低效**：用户直觉它效率低。看 tao-rules + 历史 audit_log（若有 tao-watcher-script 条目），评它拦了什么真问题 vs 制造多少噪音。

## 八、输出（调研报告 Markdown）

1. **约束效率矩阵**：每约束一行（防护价值高/中/低 | 摩擦成本高/中/低 | 绕过风险 | 实证 call-log 引用）
2. **workaround 模式总结**：agent 在哪些约束上找过出路（系统性规律）
3. **覆盖盲区**：哪些威胁没被约束（如 create_session 爆炸、status/timing 差）
4. **优化建议**（分档）：
   - 保留（高效必要）
   - 放宽/合并（摩擦 > 价值）
   - 重设计（如声明式协议替代命令式校验？即时反馈替代 done 门禁一次性？）
   - 新增（堵盲区）
5. **harness 演进方向**（根本性建议）：更少更聪明的约束 vs 更多硬门？engine 硬拦 vs SKILL 引导 vs startup_notice 前置，三者最佳配比？
6. **对发起人假设的裁决**：支持/推翻/部分同意，附证据

## 九、约束

- **只读**遗迹 + 源码，不改 engine/SKILL/数据
- 模型 **GLM-5.2**；你派生的子 Agent/子会话也 GLM-5.2
- **独立思考**，不附和发起人；证据推翻欢迎
- 调研深度优先于速度，但控制在单次调研内可完成（别派生爆炸）
