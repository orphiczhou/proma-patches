# 树形 Harness 迭代总结 — Tree 形会话执行体系改进

> **日期**：2026-07-07（会话 57f5aec1，工作区 Proma改造探索）
> **范围**：Tree 形会话执行体系（tree-engine.cjs + tree-commander/worker SKILL + help topics）
> **方法**：多轮审计迭代收敛 + pro 实例稳定性测试 + 观察员近距离验证
> **状态**：pro 完整部署验证通过，release 待部署

---

## 一、背景与起点

### 1.1 0707 报告的悲观结论
nanju-iter2 树（本实例旧引擎）跑 multi-agent-collab-platform 文档迭代，**9 worker 全卡 `pending_brief`，0 done**。报告认定 `alignment/audit_gate` **设计层死锁**，commander 在不读写 tree-state.json / 不 patch 引擎前提下**无解**。死锁信号：11×`E_ALIGNMENT_NOT_VERIFIED` + 4×`E_REVIEW_FORGERY`。

### 1.2 推翻结论
`deadlock-repro.cjs` 实跑场景 A-F 实证：`resolveAuditorIndep` **闸门2**（tree-engine.cjs L2241-2255）一直允许 **root 会话当任意 worker 的 auditor**（`auditor=root.session_id` 且 `worker.added_by=root`）。死锁真因是 **SKILL §6 教错**（要求"auditor 必须是独立 leaf"→ commander fork 独立 auditor 走闸门3 → 循环依赖）。**引擎不需要改即可解死锁**，修 SKILL 协议即可。

---

## 二、改进对象

| 层 | 文件 | 改进类型 |
|---|---|---|
| 引擎核心 | `workspace-files/tree-engine.cjs` | P0-3 状态机 + milestone caller-binding + bug 修复 + help topics |
| Commander 手册 | `skills/tree-commander/SKILL.md` | §13 冷启动流程 + §13.3 前置条件表 + §13.7 错误码速查表 |
| Worker 手册 | `skills/tree-worker/SKILL.md` | §2.5 lifecycle 全景 + §3.1 self_check evidence |
| Help topics | tree-engine HELP_TOPICS | how_to_worker_lifecycle + how_to_init 独立 session + self_check 示例 |

---

## 三、四轮迭代历程

| 轮次 | 测试 | try-and-fix 错误 | 信息源 | 关键改进/发现 |
|---|---|:---:|---|---|
| 1 | macp-stab | **24** | 旧 SKILL + 任务指令 | 基线，发现 5 问题（self_check/tao-watcher/path/E_DUP/session）|
| 2 | cleanroom | **15**（-37.5%）| 旧 SKILL + 新 help topics | 3 修复完美生效（self_check 6→0 / tao-watcher 0 issues / root alignment_pending false）|
| 3 | 完整 §13（cleanroom2）| **1**（-93% vs cleanroom）| 完整新 SKILL §13 + help | §13.3 步骤前置条件表最大贡献，消除 14 协议级错误 |
| 4 | path 修复验证 | path错误**0**（总 7）| path 注释消歧 | path 达标 + 发现 DeepSeek 执行波动 |

**总降幅**：24 → 1（最佳 run），**96%**。

---

## 四、核心技术成果

### 4.1 §13 冷启动信任锚流程（死锁打破核心，L0）
commander SKILL 新增 §13.0-§13.7：root 会话自己当 worker 的 auditor（引擎闸门2 放行），打破"已 done auditor 鸡生蛋"递归。**不改引擎，纯协议修正**。

### 4.2 §13.3 步骤前置条件表（最大增量贡献）
8 步表格（步骤|调用者|前置条件|产物|漏做触发），observer cleanroom2 确认这是消除 14 协议级错误（E_BORROWED_IDENTITY/E_ALIGNMENT/E_GATEKEEPER/E_AUDIT_PREMATURE/E_SELFCHECK/E_DELIVERABLE/E_DUPLICATE/E_AUDITOR_NOT_INDEPENDENT/E_NAME_INVALID）的关键。

### 4.3 §13.7 错误码速查表
7 错误码（触发点|含义|修复方法）+ "撞错即翻"通用排查。审计迭代修正 P0：E_AUDIT_PREMATURE 触发点（set-status→audit_gate pass）、E_MILESTONE_INCOMPLETE→E_SCHEMA_INVALID、E_BORROWED_IDENTITY 触发点补全 6 处。

### 4.4 P0-3 状态机白名单（引擎加固，L1）
`STATUS_TRANSITIONS` + `E_STATUS_TRANSITION_INVALID`，堵 done→active/archived 复活。测试 19/19。

### 4.5 milestone caller-binding（引擎加固，L1）
`dispatchMilestone` 透传 caller + `cmdMilestoneSetResult` caller 校验，堵场景 D 攻击面（worker 用非法 caller 改 milestone）。

### 4.6 Bug 修复（3 个）
1. **tao-watcher audit_log "undefined"**：校验端跳过 `auditor==='tao-watcher-script'` 条目（机械巡检非 auditor，cmdAuditAppend 强制 auditor_session_id，无绕过漏洞）
2. **root alignment_pending**：`cmdInit` root 置 false + brief_echo 分支 `&& leaf.role!=='root'`（信任锚不参与 alignment）
3. **E_DELIVERABLE_MISSING 路径**：错误消息附 `resolved:` 全路径

### 4.7 help topics 扩展
新增 `how_to_worker_lifecycle`（8 阶段 lifecycle + self_check JSON 模板 + 常见错误码）+ `how_to_init` 补"每 leaf 独立 session" + `alignment_workflow` 加 self_check 示例。topic 数 14→15。

---

## 五、量化效果

| 指标 | 改进前（0707/旧引擎）| 改进后（pro 完整 §13）|
|---|:---:|:---:|
| 冷启动 worker done | 0/9 | **3/3**（macp-stab）/ **1/1**（cleanroom×）|
| try-and-fix 错误 | —（死锁，无 done）| **24→1**（96%）|
| E_REVIEW_FORGERY | 4 | **0** |
| E_ALIGNMENT_NOT_VERIFIED 死锁 | 11（阻断）| 0-3（暂态自愈）|
| self_check schema 摩擦 | — | 6→**0** |
| tao-watcher 假阳性 | audit_log_integrity | **0 issues** |
| root alignment_pending | =true 未清理 | **false** |
| tree_validate | 332 issues | **0 issues** |

---

## 六、关键发现（为下一轮积累）

1. **§13.3 步骤前置条件表是最大贡献**：caller+前置+漏做触发三列一次性消除协议级错误。比错误码速查表（事后查）更有效（事前避）。
2. **DeepSeek 执行 SKILL 有波动**：同 §13，cleanroom2=1 错误，path 验证=7 错误。取决于模型当次读 SKILL 仔细度。→ 需更强引导（checklist）或引擎默认值。
3. **pro 部署缺口**：pro 用 `.proma-dev` userData（非 `~/.proma`），SKILL 需同步到 `.proma-dev/agent-workspaces/default/skills`。首次同步错路径导致 cleanroom commander 读旧 SKILL。
4. **commander 协调消息分散**：commander 的 fork/send_message 协调记录在 worker 会话（作为 user 消息），不在 commander 自身 list_messages（total=1）。观察 commander 决策需聚合 worker 会话。
5. **pro 会话冷启动慢**：每次新会话几分钟零响应才启动（DeepSeek/GLM 都有）。pro 实例稳定性观察点。
6. **try-and-fix 模式可行但低效**：commander 靠引擎错误码导航，24 次错误中 15 次可靠更好文档/help 避免。文档改进直接降错误。

---

## 七、部署状态

| 实例 | tree-engine | SKILL | 状态 |
|---|---|---|---|
| **pro**（.proma-dev）| ✓ 新（help+bug+P0-3+caller-binding）| ✓ 新（§13/§13.3/§13.7/§2.5）| 完整验证通过 |
| **release**（.proma-release）| ✗ 旧 | ✗ 旧 | 待部署 |
| 本实例（~/.proma/proma）| — | ✓ 新（git 源）| 开发源 |

**回滚备份**：`.bak-pre-p03-deploy-20260707` / `.bak-pre-lifecycle-20260707`（pro dist + .proma-dev SKILL）。

---

## 八、下一轮改进路线

### 8.1 稳定性（解决执行波动）— P0
- SKILL 加 `leaf_add` 前置 checklist（必填字段：leaf_id/session_id/parent/path/role/model/channel/added_by）
- 引擎 `leaf_add` 自动补默认 `model`/`channel`（从 root 继承），减少必填字段摩擦
- 多次 run 取错误中位数衡量稳定性（而非单次）

### 8.2 多 worker 场景验证 — P1
本轮均单 worker。需 2+ worker 并行，验证 §13.4（转正常期）+ 闸门2→3 切换。

### 8.3 review_required=true — P1
本轮 `audit_meta.review_required=false`。需开启 ISS-003 opt-in，验证 review_round event 流程 + commander 抽查 findings 真实性。

### 8.4 tao-watcher 优化 — P2
- W-01：fork 身份确认阶段的首条消息不应被检测（worker 尚未收到任务）
- W-08：区分"commander 指令下 worker 合法调 tree 写工具"vs"worker 越权调用"
- C-13/R-06：增加小任务模式（≤3 milestones 放宽阈值）

### 8.5 系统级一致性 — P2
- `tree_init` 允许 tree_id 含连字符但 `leaf_add` 禁 → 统一命名校验
- §2.5 引用：commander SKILL §2 无 §2.5（worker 有），任务指令勿混淆

### 8.6 体系级（来自 0707 报告遗留）
- ISS-006 竹节交接 ownership 迁移（patches.cjs 层）
- ISS-007 commander context 自动竹节 + session 通信可靠性
- ISS-010 audit_log 历史脏数据清理

---

## 九、交付物清单

### Git commits（4，分支 release-0.13.16-hardening）
- `b594a32` 冷启动死锁正解 + P0-3 状态机 + milestone caller-binding + help 同步
- `c82bf3b` 错误码速查表 + 前置条件表 + worker lifecycle + bug 修复（688 行）
- `0600c37` 完整 §13 验证报告（错误 1，93% 降幅）
- `9b11e16` §4 path 文档消歧（path 错误归零）

### 观察报告（4 份，.context/active/）
- `observation-macp-stab-2026-07-07.md`（252 行，macp-stab 稳定性测试）
- `observation-cleanroom-2026-07-07.md`（207 行，cleanroom 3 修复验证）
- `observation-cleanroom2-2026-07-07.md`（128 行，完整 §13 三方对比）
- `handoff-tree-harness-improvement-2026-07-07.md`（改进方案 + 实施）

### 测试脚本
- `p0-3-status-transition-test.cjs`（19/19）
- `iss003-review-gate-test.cjs`（13/13）
- `deadlock-repro.cjs`（场景 A-F，死锁机制实证）

### 沉淀文档
- `note.md`（4 条 2026-07-07 条目，含部署/验证/波动）
- `待解决问题清单.md`（ISS-005/008/009 已解，006/007/010 遗留）
- 本总结文档

---

## 十、方法论沉淀

### 10.1 多轮审计迭代收敛
实施 → 多路并行审计（完整性/一致性/引擎契约交叉验证/bug 正确性）→ 修复 P0/P1/P2 → 收敛审计 → 洁净室测试 → 再迭代。本轮 3 路审计抓出 P0×3（E_MILESTONE_INCOMPLETE 引擎不存在 / E_AUDIT_PREMATURE 触发点错 / 步骤7 错误码错），文档引擎一致性收敛。

### 10.2 子 Agent 保持主 context
全程 20+ 子 Agent：侦察（事故现场/产物）→ repro 验证 → 实施改动 → 多路审计 → pro 观察员。主会话只回收结构化结论，context 保持健康。

### 10.3 pro 实例稳定性测试 + 观察员
真实任务（multi-agent-collab-platform 文档评估）+ 近距离观察员（同实例，读 tree-state/call-log/leaf 事件）+ 三方对比（macp-stab/cleanroom/cleanroom2）。比单次测试更可信。

### 10.4 文档引擎一致性
SKILL 错误码/触发点必须对照引擎实际校验逻辑（不只看错误码常量，看抛错条件）。审计抓出的 P0 都是文档与引擎行为不一致（E_AUDIT_PREMATURE 在 audit_gate 而非 set-status；E_MILESTONE_INCOMPLETE 引擎根本没这个码）。

---

## 十一、一句话结论

**Tree 形会话执行体系的冷启动死锁是 SKILL 协议误用而非引擎缺陷**；通过 §13 冷启动信任锚流程（root 当 worker auditor）+ §13.3 步骤前置条件表 + 引擎加固（P0-3/caller-binding/bug修复），try-and-fix 错误从基线的 24 降至 1（96%），0707 报告的"0 done 死锁"变为"全 done + 0 issues"。剩余的 DeepSeek 执行波动是下一轮稳定性改进的入口。
