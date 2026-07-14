# Sprint 计划（Sprint Plan）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（方法论补建）
> 配套：[../CHANGELOG.md](../CHANGELOG.md)（事后追溯）· [methodology-coverage-audit.md](./methodology-coverage-audit.md) · [../01_PRD/success-metrics.md](../01_PRD/success-metrics.md)

本文是 tree-harness 的**事前承诺式路线图**。SubAgent C 指出：tree-harness 此前是「事后追溯式」（CHANGELOG 记录已做），无事前 Sprint 承诺，导致 commander 行为对「下一步做什么」缺统一参照，每次靠 handoff 口传。本文转向事前规划。

---

## 一、当前状态（2026-07-11，基线 + PRD 后）

| 维度 | 状态 |
|---|---|
| 引擎版本 | v0.16.5 + V10 P3 + IHL R6 + 07-09 caller-binding + create_session budget |
| 基线 | ✅ 源码统一 + 文档治理 + .context 统一 |
| PRD | ✅ 01_PRD/ 5 份（定位/场景/指标/team-config/护栏）|
| 方法论 | 🟡 本轮补建中（coverage-audit / sprint-plan / workflow）|
| 测试 | dbc-spec 48/0 / audit-attacks 18/0 / v10-cleanroom 54/54 |
| 部署 | Dev（权威源）✅ / Release 落后暂缓 / 未向 Proma 提交 PR |

---

## 二、Sprint 路线图总览

```
Sprint 1（基线收尾）       ← ✅ 完成（PRD/方法论补建 + ISS-003 阶段二 + autonomy 删）
Sprint 2（约束激活）       ← ✅ 完成（纸面门禁变刚性，methodology-audit 驱动）
Sprint 3（Phase D）        ← ✅ 完成（prune/migrate/watcher 语义完整性）
Sprint 4（跨工作区 + TAO） ← ✅ 完成（workspace 拦截 P1/P2 + TAO 角色规则 + P1-S05 命运决策）
Sprint 5（安全根治）       ← ✅ 完成（聚类 A/B 单边缓解 + 跨仓标记，2026-07-14）
Sprint 6（产品化验证）     ← 🟡 准备✅（5 项材料齐）+ 外部待办（PR/实验/团队，2026-07-14）
```

### Sprint ↔ User Stories 覆盖映射（PRD 域 ↔ 计划域双向追溯）

| Sprint | 覆盖 [user-stories](../01_PRD/user-stories.md) |
|---|---|
| Sprint 1 | US-001（部分，auditor fallback 待 Sprint 5）/ US-002（深度 Fork）|
| Sprint 2 | US-003（竹节）/ US-004（多视角评审）/ US-005（洁净室）|
| Sprint 3 | 基础设施（无直接 US）|
| Sprint 4 | US-006（跨工作区）|
| Sprint 5 | US-001 闭环（auditor fallback）|
| Sprint 6 | 全 US 验证（首个 PR + 对照实验 + 团队试用）|

---

## 三、Sprint 详情

### Sprint 1：基线收尾 + 高 ROI 小修（进行中）
**目标**：建立可信基线 + 补齐设计文档，为后续加固铺路。

| 交付物 | 状态 | 验收 |
|---|---|---|
| 源码统一（TH 权威源） | ✅ | md5 可验 |
| 文档治理（错误码/BUG/元数据） | ✅ | API.md §5 = 引擎 |
| PRD 5 份 | ✅ | 01_PRD/ 齐全 |
| 方法论 3 份 | 🟡 | 本文档 + coverage-audit + workflow |
| ISS-003 阶段二（review_evidence 不可写字段） | 🔴 | 13/13 + 阶段二测试 |
| autonomy_overrides 处置（删/实现） | 🔴 决策 | 见 improvement P1-S02 |

**依赖**：无（基线）

---

### Sprint 2：约束激活（纸面 → 刚性）✅ 完成（2026-07-14）
**目标**：落实 methodology-coverage-audit 的激活路径，把 4 条「仍纸面」约束（3/4/5/6）激活。

> ✅ **完成总结（2026-07-14）**：4 约束全部处理。约束 3/4/5 🟢 已激活，约束 6 🟡 部分激活（引擎刚性 + SKILL 教化，ctx 写入待实战）。详见 note 2026-07-14 四条目 + methodology-coverage-audit。

> 注：约束 1（ISS-003 阶段二，coverage-audit §六标最高优先级）已在 Sprint 1 承接（🔴 待办）；约束 2（P1-S04 auditor fallback）在 Sprint 5（依赖跨仓 fork 修复）。本 Sprint 聚焦约束 3-6——约束 1/2 因依赖/时机分流，非遗漏。

| 交付物 | 来源约束 | 验收 |
|---|---|---|
| 5 件套持久化 + **commander 派生改 create_session**（[设计提案](./design-commander-spawn.md)） | 约束 4 | ✅ leaf schema 5 字段 + create_session 强制 + worker 启动读 leaf + 测试 15/0 + pro 实证（commander d218bd5c） |
| milestone_add 流程教化（SKILL §13 加调用步骤）或删硬校验 | 约束 3 | ✅ 引擎 V3 已硬强制（复核，原"纸面"过期）+ §13.3/worker §2 教 milestone_add |
| ctx 竹节自动触发（心跳集成 get_session_context） | 约束 6 / ISS-007 | 🟡 引擎刚性 set-context≥85%→segment_pending（测试 7/0）+ SKILL §8 教 get_session_context；ctx 写入待实战 |
| drift 联动（set-session/migrate/restore 写 drift） | 约束 5 / P2-S03 | ✅ 三命令联动写 drift（测试 9/0）+ 顺带修复 restore tree_id bug |

**依赖**：Sprint 1

---

### Sprint 3：Phase D（CHANGELOG 已列）✅ 完成（2026-07-14）
**目标**：补齐 prune/migrate/watcher 的语义完整性。

> ✅ **完成总结（2026-07-14）**：D1/D2/D3 全部完成。全量 **215/0 零回归**（164 基线 + 51 新 D 测试）。详见 note 2026-07-14 Sprint 3 条目。

| 交付物 | 验收 | 状态 |
|---|---|---|
| D1：prune/archive 级联语义（父 prune 子怎么办） | 级联规则文档化 + 测试 | ✅ 引擎 cmdLeafSetStatus 级联（pruned 级联未 done 子 + drift；done 保留不下降；archived 不级联；root 防级联）+ 测试 19/0 + pro e2e |
| D2：migrate 版本号（schema 版本管理） | migrate 带 version + 兼容性测试 | ✅ SCHEMA_VERSION 单一信源 + SCHEMA_LADDER 逐级分发 + clamp 防漂移（保持 1.1，升 1.2 会破坏 auditor Case 8）+ 测试 10/0 |
| D3：watcher silence_minutes（噪音控制） | watcher 可静默 + 配置生效 | ✅ decideWatcherSilence 纯函数 + runOnce 静默跳过 + IPC watcher-silence + config 合并默认 + 测试 22/0（逻辑 mirror 契约 + 源码静态校验） |

**依赖**：Sprint 1

---

### Sprint 4：跨工作区 + TAO Watcher ✅ 完成（2026-07-14）
**目标**：堵跨工作区漏洞 + TAO 规则按角色区分。

> ✅ **完成总结（2026-07-14）**：四项全部完成。全量 **215/0 零回归** + 新增 sprint4-patches **71/0** = 286 全绿。详见 note 2026-07-14 Sprint 4 条目 + CHANGELOG [Unreleased]。

| 交付物 | 来源 | 验收 | 状态 |
|---|---|---|---|
| patches.cjs workspace_id 拦截（跨工作区 P1 Part B） | CHANGELOG | agent 调用方工作区锁 E_WORKSPACE_FORBIDDEN + 未指定强制到 caller ws（create_session + fork_session 双入口） | ✅ 测试 6 用例 + 源码静态 |
| main.cjs createAgentSession workspaceId 白名单（跨工作区 P2，sed 补丁） | CHANGELOG | 平台层 L386653 守卫 throw E_WORKSPACE_NOT_FOUND（兜底 automation/bot/直调） | ✅ 备份+锚点唯一+node-c+重启探活+happy path 实证 |
| TAO Watcher 按角色区分规则（root/commander/worker 各专属） | CHANGELOG + a8111bf5 事故 | RULE_ROLE_SCOPE 中心表 + maybeForLeaf 结构分发（补 isSharedSessionLeaf 纵深防御） | ✅ 测试 29 用例 + 表↔guard 一致性 12 项 |
| TaoWatcher 正常场景正负案例统计（P1-S05 决策保留/砍） | PRD + improvement | pro 26-tree 实测统计 + 命运决策 | ✅ 决策：保留+补可观测（nudge_log cap），落地+测试 5 用例 |

**依赖**：Sprint 1

---

### Sprint 5：安全加固根治（聚类 A/B）✅ 完成（2026-07-14）
**目标**：根治「约束只覆盖合规路径」（聚类 A）+ 「门禁互相架空」（聚类 B）。

> ✅ **完成总结（2026-07-14）**：四项全部完成。全量 **286/0 零回归** + 新增 sprint5 三测试 **81/0**（max-sessions 34 + patches-bypass 27 + gate-reachability 20）= 367 全绿。聚类 A/B **单边缓解全部落地**（engine max_sessions 硬护栏 + patches create_session 旁路登记 + SKILL auditor fallback + 门禁可达性审计无绕过链）；跨仓根治（SDK 回调 / subagent_trace_id / fork identity）**标记汇报**，不在 tree-harness 范围。详见 CHANGELOG [Unreleased] Sprint 5 + note 2026-07-14 Sprint 5 条目。

| 交付物 | 类型 | 验收 | 状态 |
|---|---|---|---|
| max_sessions 引擎硬护栏（**新增** `E_MAX_SESSIONS` + session_registry 四路径登记 + 同步 ERROR-CODES.md） | improvement P0 / 聚类 E | E_MAX_SESSIONS 定义 + 引擎硬拦 + 测试 34/0 | ✅ |
| create_session 旁路根治单边方案（patches findCallerTreesForBypassGuard + max_sessions 预检 + 旁路登记 + MCP 工具） | improvement P0-S01 / 聚类 A | patches 拦 create_session + 登记 + 测试 27/0 | ✅ 单边（跨仓根治标记） |
| 门禁前置可达性验证（聚类 B） | improvement / 验证 | done 门禁链无绕过链 + max_sessions session 写入完整 + 测试 20/0 | ✅ 无绕过链（无需修复） |
| auditor role 端到端 fallback（P1-S04 SKILL §13.4.5） | improvement | root 归档卡死 session + 重 fork + set-session + 红线 | ✅ 单边（跨仓 fork identity 标记） |
| create_session 旁路根治（Proma SDK 回调 + subagent_trace_id） | 跨仓 | 旁路操作引擎可见 | 🔴 跨仓标记（单边缓解已做） |

**依赖**：Sprint 1 + Proma SDK 协同（跨仓）

> ⚠️ 此 Sprint **部分依赖跨仓**（Proma SDK 回调 / fork identity），tree-harness 单边无法完全闭环。单边缓解（engine max_sessions + patches 旁路登记 + SKILL fallback）已落地降风险；跨仓根治标记汇报。

---

### Sprint 6：产品化验证 🟡 准备✅（2026-07-14）+ 外部待办
**目标**：从「孵化」走向「合并 + 团队验证」（success-metrics 的两层客户目标）。

> 🟡 **完成总结（2026-07-14）**：5 项「准备」全部完成（材料/设计/脚本/评估/backlog 齐备）。**执行（PR 提交/实验跑/团队试用）= 外部依赖**，标记汇报，见 [external-dependencies-backlog.md](./external-dependencies-backlog.md)。详见 note 2026-07-14 Sprint 6 条目 + CHANGELOG [Unreleased] Sprint 6。

| 交付物 | 单边状态 | 外部待办 | 产出 |
|---|---|---|---|
| 首个 Proma PR 草稿 | ✅ 准备 | 🔴 提交（用户 GitHub + 上游 review） | [first-pr-draft.md](./first-pr-draft.md) |
| 对照实验设计 | ✅ 设计 | 🟠 执行（跑 45 次任务） | [experiment-design.md](./experiment-design.md) |
| tree-state 聚合产品指标 | ✅ 脚本 + n=1 数据 | （单边可采，过程指标） | [aggregate-metrics.cjs](./aggregate-metrics.cjs) + [metrics-n1-20260714.json](./metrics-n1-20260714.json) |
| Q2 树形 UI 面板重评估 | ✅ 决策不做（v2 候选） | — | [q2-tree-ui-reevaluation.md](./q2-tree-ui-reevaluation.md) |
| 外部依赖 backlog | ✅ 整理标记 | E1-E5 外部清单 | [external-dependencies-backlog.md](./external-dependencies-backlog.md) |
| 真实团队试用 | — | 🟠 找 2-3 团队 + 反馈 | 见 backlog E2 |

**关键诚实修正**（颠覆预设）：
- 上游仓库核实为 **`proma-ai/Proma`**（非 `ErlichLiu/Proma`），AGPL 开源，TS monorepo，已迭代到 **v0.13.3**（tree-harness 补丁针对 v0.12.x，版本不同步）。
- 任务预设「补丁 I/J 低风险易合并」**不成立**：I 对上游有害（README 列自动更新为特性）、J 上游单实例无场景、F/H 方向相反于上游 #903（上游收敛 sdkSessionId 清除）。**没有一个现成补丁适合首个 PR**。
- 首个 PR 真正路径：基于 tree-harness 研究经验，在上游 v0.13.x 源码找真实改进点（方向 1：MCP 会话频道/模型一致性），适配 TS 源码 PR。
- 对照实验解决 success-metrics §三 gap：Layer1 边界界定（budget rate∈Layer1 / max_sessions count∈Layer2）。
- n=1 过程指标（230 唯一树）：完成率 17.4%（混测试树，需实验 T5 校准）/ 拦截率 39.1%（门禁有效）/ 失控树 65（全为 Sprint 4 cap 之前历史）。

**依赖**：Sprint 1-5（主体稳定）+ 外部（用户 GitHub / 上游维护者 / 真实团队 / Proma SDK 团队）

> ⚠️ 此 Sprint **执行全依赖外部**。子会话已把所有「单边能做」（材料/设计/脚本/评估/标记）做完；剩余 E1-E5 外部待办见 [external-dependencies-backlog.md](./external-dependencies-backlog.md)。

---

## 四、Sprint 间依赖

```
Sprint 1（基线）─┬─→ Sprint 2（约束激活）
                 ├─→ Sprint 3（Phase D）
                 ├─→ Sprint 4（跨工作区 + TAO）
                 └─→ Sprint 5（安全根治，+ 跨仓）
                          ↓
                     Sprint 6（产品化验证）
```

Sprint 2/3/4 可并行（不同子系统）；Sprint 5 部分依赖跨仓；Sprint 6 需主体稳定后。

---

## 五、横切关注（每个 Sprint 都要）

| 关注点 | 要求 |
|---|---|
| **文档引擎一致性**（聚类 D） | 每次引擎改动同步 ERROR-CODES.md / API.md / CLAUDE.md（CLAUDE.md P0 高发区） |
| **测试回归** | 每次改动跑零回归套件（76/0）+ 相关专项 |
| **部署同步** | 改完从 TH 权威源 → PRO dist（需用户重启 pro） |
| **CHANGELOG** | 每个 Sprint 完成后更新 CHANGELOG（事后记录） |
| **methodology-coverage-audit 复审** | 每 Sprint 末复核死硬约束状态（🔴→🟡→✅） |

---

## 六、版本里程碑

| 里程碑 | 含义 | 对应 Sprint |
|---|---|---|
| v0.17 | 基线 + 设计文档完整 | Sprint 1 完成 |
| v0.18 | 约束激活（纸面→刚性） | Sprint 2 完成 |
| v0.19 | Phase D + 跨工作区完整 | Sprint 3+4 完成 |
| v1.0-rc | 安全根治 + 首个 PR | Sprint 5+6 首个 PR |
| v1.0 | 真实团队验证通过 | Sprint 6 团队试用 |

---

## 七、诚实声明

- 本路线图是**事前承诺**，但 tree-harness 历史是研究驱动（非产品迭代），Sprint 周期/工作量估算**缺历史数据**（无真实团队节奏参照）
- Sprint 5（安全根治）**部分跨仓**，时间不可控
- Sprint 6（产品化）依赖 Proma 维护者响应 + 真实团队意愿，**外部依赖多**
- 建议每个 Sprint 开始时复核本计划，按实际调整（敏捷）
