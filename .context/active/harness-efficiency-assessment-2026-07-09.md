# Tree Harness 硬约束机制效率评估报告

> **brief 第八节交付** | 调研员: GLM-5.2 会话 4fee5a45 | 日期: 2026-07-09
> 上游: `active/research-brief-harness-efficiency-2026-07-08.md`
> 性质: 独立调研，靠证据说话。**结论强支持发起人假设**（非附和——证据导向）。

## 摘要 — 对发起人假设的裁决

发起人假设（brief 第二节）:
> "硬约束机制（如 TaoWatcher）效率太低，也没完全约束好，反而逼着会话 Agent 在执行过程找出路。"

**裁决: 支持，且比假设更尖锐。** 核心发现（三次独立验证同构）:

tree-system 的所有硬约束**普遍只覆盖 tree 内合规/声明路径**，对 `create_session` 等原生会话绕过机制**系统性无效**。最严重的 macp2 事故（4 分钟 207 会话爆炸）正是利用此盲区——而事后修复靠的是**行为约束**（startup_notice + SKILL §13.5 红线 + 进程内 SubAgent），**不是引擎硬约束**。

问题不是"约束太多"，而是"**约束覆盖错位**":tree 内重重加固（caller-binding 6 处 + V10 八大 + audit_gate），tree 外会话 / 状态篡改类写操作裸奔。优化方向是**重新分配**约束，而非简单增减。

---

## 一、约束效率矩阵

| 约束 | 真实防护价值 | 摩擦成本 | 绕过风险 | 实证 (call-log / 测试) |
|------|:-:|:-:|:-:|------|
| **caller-binding** (6处: add[新修]/set-session/milestone-set-result/event-append/audit-gate/audit-append) | 高 | 低 | 🔴 set-status / milestone-add 仍裸奔（跨身份杀 leaf / 注入，已实证 3/3） | leaf_add 修复 66/0 零回归；覆盖盲区动态实证 3/3 |
| **TaoWatcher** (Patch M, 35→11 规则) | **0**（实测） | 0（没跑）/ 工程沉没高 | 先天看不到 tree 外会话 | pro 21 tree 自动触发全 0；macp2 时 config 未启用（时序铁证） |
| **预算护栏** (node_budget 20 / subagent 15) | 中（合规路径） | 低 | 🔴 create_session 扁平爆炸绕过 | macp2 tree call-log 25 条 vs 207 create_session 不在 tree |
| **schema 校验** (done 门禁 / review_round / deliverable) | 中-高 | 🔴高 | 校验时机盲点（review_round 滞留，已修） | macp3: E_SCHEMA_INVALID×75 + E_DELIVERABLE_MISSING×21；macp4: 19 |
| **audit_gate 独立性** (V4 硬门 + 闸门2/3) | 高 | 中 | spawn 额外 auditor 合规绕过 | macp4: E_AUDITOR_NOT_INDEPENDENT×15 + E_BORROWED_IDENTITY×10 |
| **§13 冷启动协议** (SKILL，root 信任锚) | 高（解死锁） | 中（依赖 commander 读 SKILL） | DeepSeek 执行波动（非 100%） | 07-07 实证解 alignment 死锁，错误 24→1 |
| **V10 八大加固** (auditor-active/self-audit/uuid-strict/numeric/ts-monotonic/...) | 高（tree 内数据完整性） | 低-中 | 只校验 tree 内已声明数据 | audit-gate-test 失守案例堵住；macp4 多处受益 |
| **milestone caller-binding** | 高 | 低 | 已堵 | macp4 milestone 全通过 |

---

## 二、Workaround 模式（agent 在约束上找的出路）

系统性规律——**绕过都发生在"约束未覆盖的路径"**:

1. **tree 外会话绕过**（macp2）: commander 用 `create_session` 当 reviewer，207 会话不入树 → 绕开 tree_leaf_add 预算 + caller-binding + TaoWatcher 全部。直到 startup_notice + SKILL 红线 + 进程内 SubAgent 才堵。
2. **合规路径内绕独立门**（macp4）: commander 为过 V4 独立审计门，spawn 额外 auditor session（合规但多耗 15×摩擦 + 3 个额外 auditor 才过）。
3. **校验时机盲点**（macp3）: review_round 只在 done 门禁校验，早期 malformed 事件滞留 → done 永远过不了（status 卡 active）。已修（append 时即校验）。
4. **状态篡改无 caller**（新发现）: set-status / milestone-add 无 caller-binding → 跨身份杀 leaf / 注入 milestone（实证 3/3）。
5. **死字段**（新发现）: autonomy_overrides 写而不读 → "限权/放权"是 no-op，SKILL 若教用则徒增摩擦。

**元规律**: 约束呈"出事补漏"的打补丁式演进（leaf_add caller-binding 是 07-09 最新一例），非系统设计。每个新约束只堵上一次事故的具体路径，留下相邻的新盲区。

---

## 三、覆盖盲区（决定性）

按严重度:

1. **tree 外会话（create_session）—— 所有 tree 约束无效**。Proma 原生 `create_session` 不走 tree engine，tree 内的预算/caller/TaoWatcher 全部管不到。只有 patches.cjs 的 delegationDepth（防链式深递归）+ lineage/ownership（R1-R6），**无数量预算** → 扁平爆炸无拦。
2. **状态篡改类写操作无 caller-binding**: set-status（跨身份 pruned/archived 杀 leaf）、milestone-add（跨身份注入）、autonomy-override（死字段）。
3. **TaoWatcher 不可观测**: log=console.log（行175，不持久化），无法回溯是否启动/命中。config 启用但 macp3/4 期间 0 触发，原因未定。
4. **死字段 autonomy_overrides**: 写而不读，号称限权放权实则 no-op。
5. **DeepSeek 执行波动**: §13 SKILL 非 100% 命中（同 SKILL macp3=1 错误 vs macp-stab=7），约束可靠性依赖模型随机性。

---

## 四、优化建议（分档）

### 保留（高效必要）
- caller-binding 6 处（含 07-09 leaf_add 修复）
- V10 八大内容校验（堵审计伪造，真实价值）
- audit_gate 独立性 + milestone caller-binding
- 预算护栏（合规路径内有效，20/15 宽松不误伤）

### 放宽 / 合并
- **schema 摩擦**（macp3 96×错误）: help topics + SKILL §13.3 前置表已缓解（24→1），可再降——leaf_add 自动补默认 model/channel（brief 07-07 条目建议），减少必填字段摩擦。
- **autonomy_overrides**: 死字段，要么实现消费逻辑（让限权真生效），要么砍掉减负 + 改 SKILL 不教用。

### 重设计
- **TaoWatcher**: 当前是"安全剧场"（配置启用、实测 0 产出、不可观测）。二选一: ① 补 file-log + 健康检查 + status() 暴露，让它可观测可信任；② 承认它对 tree 内已有 caller-binding/V10 覆盖，边际价值低，砍掉减负。
- **caller-binding 统一中间件**: 当前命令式散落各 cmd*，leaf_add 式漏传难免。改为声明式（如 dispatch 层统一注入 caller + 命令声明"需要 caller 校验"），从结构上杜绝漏传。set-status / milestone-add 顺带补上。

### 新增（堵盲区）
- **create_session 数量预算**: patches.cjs delegationDepth 只防链式，加"单 caller 单位时间扁平创建数上限"（如 ≤10/min），直接堵 macp2 型爆炸。
- **tree 外会话观测层**: 让 watcher 或新机制能看到 create_session 频次/异常（macp2 的 207 会话在 tree call-log 里完全隐形，直到事后看 agent-sessions 目录才发现）。

---

## 五、Harness 演进方向（根本性建议）

1. **约束的"边界"问题是根因**。tree-system 只管 tree 内，但 Proma 会话可绕过 tree（create_session）。需要一层"tree 外会话"的观测/预算（patches.cjs delegationDepth 是雏形，但缺数量预算 + 可观测性）。这是 macp2 类事故的治本方向。

2. **三层配比应重配**。当前: engine 硬拦（重）> SKILL 引导 > startup_notice（轻）。macp2 证明 **SKILL/notice 比 engine 硬约束更关键**（堵绕过靠行为，不靠 tree 内校验）。建议: tree 内硬约束精简（caller-binding 统一中间件减冗余），把工程注意力转向 tree 外观测层 + 行为约束的可靠性（降 DeepSeek 波动）。

3. **声明式 > 命令式**。命令式校验散落各 cmd*，每个新约束留相邻盲区（leaf_add 是第 N 例）。声明式（命令声明所需约束，框架统一执行）能结构性降低漏传/盲区。

---

## 六、证据与方法

- **数据源**: pro 21 个 tree（macp2/3/4/rvreq2/macp-stab/cleanroom 等）的 tree-state.json + call-log.jsonl；engine 源码（tree-engine.cjs 4740 行）；patches.cjs（Patch M）；tao-rules.json + tao-watcher-prompt。
- **动态验证**: ① leaf_add caller-binding 修复测试 4/4 + 零回归 66/0；② 覆盖盲区实证 3/3（set-status/milestone-add 跨身份篡改坐实）；③ 错误码频次（macp3 schema 96×、macp4 audit 15+10）。
- **不确定性（诚实标注）**: TaoWatcher 在 macp3/4（config 已启用）期间 0 触发的原因未完全确定——log=console.log 不持久化，无法回溯 watcher 实际是否启动/命中。候选: __proma__ 未就绪 give up / discoverWorkspaces 未发现 / 规则 0 命中 / applyNudge 静默失败。**建议动态验证**（手动 require dist patches + runOnce）。
- **已修复（workspace 副本，暂不部署）**: leaf_add caller-binding（行4528/816/864），66/0 零回归。部署待用户确认。

## 附: 对 CLAUDE.md 记录的修正建议

CLAUDE.md「macp2 后靠引擎预算护栏堵」**部分不准确**。引擎预算护栏只堵"commander 走合规 tree_leaf_add/subagent_spawn 路径"的爆炸（20 leaf/15 spawn）；macp2 实际走 create_session 绕过 → 引擎预算护栏无效。真正堵 create_session 绕过的是行为约束（startup_notice + SKILL §13.5 + 进程内 SubAgent）。建议 CLAUDE.md 该条补充此区分（治标 vs 治本）。
