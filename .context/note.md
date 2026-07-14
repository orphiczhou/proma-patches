# Proma 改造 — 调研与分析笔记

> 工作区级长期文档 | 维护: 周星星

新条目追加在顶部。

## 🔖 2026-07-15 e2e04 负面场景验证✅（drift/flagged/max_sessions 三机制补齐，Sprint 1-5 矩阵 8/8）

e2e03 之后的负面场景机制验证。主会话 a5c20252 作编排方精确驱动 commander d5b039b9（GLM-5.2）在 pro 跑三棵小树，补 e2e03 ⚪/🟡 三机制。完整报告 [e2e04-verification-2026-07-15.md](./active/e2e04-verification-2026-07-15.md)。

**三场景全通过**：
- ✅ **③ E_MAX_SESSIONS（e2e04max, max_sessions=3）**：第3个 worker 在 **create_session 阶段**被 E_MAX_SESSIONS 拦（patches 前置预检 findCallerTreesForBypassGuard+预检，Sprint 5 聚类 A），session 未建立=**钱没花**。比 engine leaf_add 兜底（L1121）更前置。三方铁证：pro sessions 无 C + registry=3=max + session_count reached=true。registry source=create_session 证 patches 主动旁路登记。
- ✅ **① drift 三档（e2e04drf）**：drift_append×3 递进（direction/low/nudge → mid/limit → production/high/prune），leaf.drift_history + state.drift_log 双写各 3 条。
- ✅ **② flagged 篡改（e2e04flg, review_required=true）**：编排方直接编辑 tree-state 篡改 C-commander（done+伪造audit_gate.pass+review_evidence.flagged+无review_round）→ leaf_add 子被 **E_REVIEW_FLAGGED_BLOCK** 拦（即使伪造 audit_gate.pass，因 isFlagged 看 review_round 不看 audit_gate 字段）；补 review_round 后放行。证 P1-S03 flagged 动态派生防篡改蒙混。

**Sprint 1-5 矩阵 8/8 完成**：e2e03 三项未触发/等价（drift / flagged / max_sessions 上限）全由 e2e04 补齐真实触发。

**三项额外发现**（记待改进，不阻断）：
- **A. patches 跨树预检 false positive**：commander 合法跨多树时被旧树 reached 误伤（findCallerTreesForBypassGuard 扫 caller 所属所有树，任一 reached 即拒）。非 bug，保守策略代价。解除=事后调大旧树 max_sessions（e2e04max 3→20，备份 .bak-pre-maxrelax）。
- **B. worker/auditor 不能当 parent**（引擎 L1072-1082，仅 commander 可有子）。commander 自主调 tree_help(role_semantics) 核实并正确识别。场景① 原设计"A-worker 下挂 A1"被否，改聚焦 drift 留痕（D1 prune 级联 sd3e2e/Sprint 3 已证，不重复）。
- **C. isFlagged 动态 worker 分支 = dead code（SubAgent 核实确认）**：全引擎仅 1 调用点（L1092 leaf_add 父链扫描）；worker 不能当 parent（L1072）→ done worker 永不是新 leaf 祖先 → 动态分支 #3 走不到；migrate 用静态 review_evidence.flagged（规则11 L3798）不经 #3。静态分支 #2 才有效（e2e04 场景②实证）。建议删 #3 或标防御性。

**方法学**：编排方精确驱动（逐场景自包含 prompt + 读 tree-state 监督）适合负面场景（需精确构造异常态），与 e2e03 自主协作互补。**落实 e2e03 §8.1 教训**：全程 tree-state.json 为 ground truth，零 API 消息数误判，零 idle 误建会话（e2e03 误建 driver/ping 各 1，本次 0）。

**成本**：8 真实 session（worker 不干活，单 session 成本 < e2e03），~35 分钟墙钟（含 pro 冷启动 + 两次中途诊断/篡改）。零引擎/patches/SKILL 改动（367/0 基线不动；篡改仅场景②模拟攻击 + 场景③调参解除跨树阻塞，均备份 .bak）。

## 🔖 2026-07-14 e2e03 端到端真实项目验证✅（tree-system 补丁形式 GLM-5.2 自主协作跑通，全自主 tree-harness 子会话）

Sprint 6 之后「真实项目端到端验证」。在 pro（引擎 5532fa5f + patches 339082af + SKILL 8b2d20f2）由 **GLM-5.2 commander(124ccb14) 自主**端到端跑通 tree-system：1 root + 3 worker（create_session 非 fork 派生，77ms 内并行）+ 1 auditor(role=auditor)，**全部 status=done**，产出 **1157 行**架构形式化文档落到 `D:/codes/tree-harness/03_ARCHITECTURE/`（class-diagram.puml 205 / data-model.md 505 / sequence-diagrams×4 112+129+86+120）。完整报告 [e2e03-verification-2026-07-14.md](./active/e2e03-verification-2026-07-14.md)。

**Sprint 1-5 新机制实证矩阵**（8 项：6 触发 / 1 等价 / 1 无场景）：
- ✅ **5件套持久化(S2)**：3 worker leaf 全持久化 brief/dod/report_protocol/autonomy/self_audit，worker done.tried 记「tree_leaf_get 读 5 件套」。
- ✅ **create_session 派生(S2)**：session_registry 5 session 全 source=create_session（非 fork）。
- 🟡 **done-未审拦截(S1)**：无 flagged 字段触发（无篡改），功能等价 done门禁触发——3 worker `set-status done` 全撞 **E_GATEKEEPER_REQUIRED**。
- ✅ **max_sessions(S5)**：count=5 ≪ max_sessions 50，预算余量 90%。
- ⚪ **drift 联动(S2)**：drift_log 空（clean run 无 drift，未演练；机制就位）。
- ✅ **done 门禁 8 道**：E_GATEKEEPER_REQUIRED 实证 gate 7 + 02-done-gate.puml 逐道还原 + 全错误码。
- ✅ **auditor 审+独立性**：3 轮 × 14 项交叉审（**11 pass / 3 fail**，3 真实 findings：drift kind=escalation 越界 / source=segment 越界 / data-model LEAF_NAME_RE 自相矛盾，带 file:line 证据，非橡皮图章）；auditor_session_id 独立，root 背书防 self-audit。
- ✅ **协作效果**：3 worker 并行 ~13 分钟产 3 份独立文档（≈2x 串行加速），5 件套契约让跨产物实体名/枚举一致（11 项跨产物 pass）。

**🔴 关键方法学教训（必读，已入 CLAUDE.md）**：监督期 commander API `list_messages` 持续 `total=1` 达 ~18 分钟，我**误判「卡死」并误建 driver 欲转受控方式**。driver 撞 `E_DUPLICATE_LEAF` 才发现 commander 早已建树并跑完 3 worker+正建 auditor。根因：GLM-5.2 在**单个长未提交轮**内完成 35 次 tree write，轮内 tool call 不立即落 API 消息表。**正解：tree-state.json（文件通道，每次 tool call 原子落盘）是 ground truth；监督 tree-system 必须读 tree-state，不能以 API 消息数判进度**。误建 driver/ping 已尝试归档被 remote `R6-external-deny` 拒（D1-A：remote 仅 send_message）。

**副发现**：ARCHITECTURE.md §3.1 表标 pro userData=`~/.proma-pro/` **过时**，实证为 `~/.proma-dev/`（CLAUDE.md L35 正确），建议修。

**成本**：5 真实协作 session（≪ macp2 207），全程 GLM-5.2，~21 分钟墙钟。零引擎/patches/SKILL 改动（367/0 基线不动）。补 success-metrics 团队维度实证（并行/契约自洽/事中拦截/auditor 增益）。

## 🔖 2026-07-14 Sprint 6 产品化验证 准备✅（5 项材料齐 + 外部待办标记，全自主 tree-harness 子会话）

Sprint 6「产品化验证」**准备**全部完成。全自主，无引擎/patches 改动（367/0 零回归基线未动）。**执行（PR 提交/实验跑/团队试用）= 外部依赖**，标记汇报。5 项交付全在 `05_PROJECT_PLAN/`。

**核心颠覆性结论（颠覆 sprint-plan/success-metrics 预设）**：
- 🔴 **上游仓库核实为 `proma-ai/Proma`**（非 sprint-plan/success-metrics 反复假设的 `ErlichLiu/Proma`——后者是 release 分发别名，仓库主体在 proma-ai 组织）。AGPL-3.0 开源，**Bun workspace monorepo + TypeScript 源码**（`apps/electron/src/main/lib/*.ts`），非打包后 main.cjs。设 **PR Bounty 计划**，维护者欢迎 PR。已迭代到 **v0.13.3**（tree-harness 补丁针对 v0.12.x，**版本不同步**）。
- 🔴 **任务预设「补丁 I/J 低风险易合并」不成立**：I（禁更新）对上游有害（README 列自动更新为桌面特性）/ J（AppUserModelId 动态）上游单实例无场景 / F-H（跨渠道清 sdkSessionId）**方向相反**——上游 v0.13.3 #903 刚把 sdkSessionId 清除**收敛为仅 thinking-signature 跨模型不兼容一处**（上游发现"清除→resume 指针丢失→上下文冷启动"是更严重 bug）。**没有一个现成补丁适合首个 PR**。sed 补丁（minified main.cjs）≠ 源码 PR（TS），适配工作量≈重新实现。
- **首个 PR 真正路径**：基于 tree-harness 研究经验，在上游 v0.13.x 源码找真实改进点（方向 1：MCP 会话频道/模型一致性，补丁 C 的上游化），需 clone 上游源码核实 gap → fork `orphiczhou/Proma`（已存在，patch-kit 所在仓）→ 适配 TS PR。提交=外部。

**5 项交付**：
1. **首个 Proma PR 草稿**（`05_PROJECT_PLAN/first-pr-draft.md`）— 上游事实修正 + 补丁逐个适用性评估矩阵（I/J/F/H/A/C/D/E/G/K/B 全评估）+ 推荐路径（3 方向）+ PR 材料模板 + 风险/回滚 + 外部依赖。诚实结论：没有现成"低风险易合并"补丁。
2. **对照实验设计**（`05_PROJECT_PLAN/experiment-design.md`）— 5 任务（T1 并行开发/T2 审计/T3 长任务/T4 成本敏感/T5 反对照）× 3 模式 × 3 重复=45 次。🔴 **解决 success-metrics §三 gap**：Layer1 边界界定——**budget（rate limit，在 patches.cjs）∈ Layer1 / max_sessions（count limit，依赖 tree-engine session_registry）∈ Layer2**。依据：维度不同（速率 vs 总量）+ 所在文件不同（patches vs engine）。模式 A 裸 prompt / B Layer1-only（含 budget 不含 max_sessions/workspace 锁/TAO，因这些都依赖 tree-engine）/ C tree-system。指标采集协议 + 归因（控制变量矩阵）+ 预期假设。执行=外部（~$45-225）。
3. **tree-state 聚合脚本 + n=1 数据**（`05_PROJECT_PLAN/aggregate-metrics.cjs` + `metrics-n1-20260714.json`）— 只读分析工具（零引擎改动），扫三实例 userData 全 tree-state.json。🔴 **按 tree_id 去重**（433 活树文件→**230 唯一树**，跨 workspace 副本重复是数据卫生坑）。聚合指标：完成率 17.4%（40/230，⚠️混大量测试树 macp*/cr*/e2e*，需实验 T5 校准，非产品失败）/ 拦截率 39.1%（90/230，**gate 拦下 166 次=门禁真实有效**）/ 失控树 65（全为 Sprint 4 nudge_log_cap 之前历史，nanju-iter2=32588 最严重，**反指标验证 cap 必要性**）/ flagged=0 E_MAX_SESSIONS=0（Sprint 5 新机制，历史树无，需新树观测）。**过程指标单边可采**（success-metrics 拆两档：过程 vs 终验）。健壮处理 leaves 是 map（非数组）、events 在 leaf 内、老树无 session_registry（distinct 回退）、3 个 c26c2x 坏文件跳过。
4. **Q2 树形 UI 面板重评估**（`05_PROJECT_PLAN/q2-tree-ui-reevaluation.md`）— 决策 **v1 不做**（v2 候选）。引擎内联（v0.7+）解决后端零源码泄漏，与 UI 可视化**正交**，UI 从"必须配套"降为"可选增强"。n=1 场景 tree_dump + aggregate-metrics 已够；renderer 注入脆弱（依赖 minified DOM class `.tabbar-bg`/`.automation-entry`，升级就坏）。触发条件：≥2 团队主动要 / 上游接受 tree-system。若做则走独立 webview（不注入 renderer）。
5. **外部依赖 backlog**（`05_PROJECT_PLAN/external-dependencies-backlog.md`）— E1 PR 提交 / E2 团队试用 / E3 实验执行 / E4 SDK create_session 回调（聚类 A 跨仓根治）/ E5 fork identity（BUG-A 跨仓）。每项标单边已做 vs 外部待办 vs 阻塞谁。建议顺序：E1 PR → E3 实验 → E2 团队并行 → E4/E5 跨仓长期。

**关键设计决策**：
- Layer1/Layer2 边界用"rate vs count + 所在文件"双重判定（非随意划线）：budget 是单 caller 速率限制（patches.cjs），max_sessions 是 distinct session 总量（tree-engine session_registry）。这让 Layer1-only 可独立配置（只部署 patches 不部署 engine），实验可重复。
- 聚合脚本按 tree_id 去重（保留 leafCount+events 最完整副本）：n=1 自用数据里树跨 default/undefined/workspace-files 三副本重复，不去重会 433 当 230 算，虚高。诚实记录此坑。
- n=1 完成率 17.4% ≠ 产品失败：230 棵多为实验性测试建树（macp*/cr*/tdb* 等本就不跑完），真实任务完成率需实验 T5 校准。这正是 success-metrics §六"过程指标单边可采 vs 终验指标外部"拆档的体现。

**文档同步**：sprint-plan（Sprint 6 🟡 准备✅ + 外部待办 + 路线图）/ CHANGELOG（[Unreleased] 顶部 Sprint 6 条目）/ note（本条目）。product-positioning §五 out-of-scope「树形 UI」维持（Q2 评估印证）。success-metrics §二A 维护者维度修正建议（上游仓库名 + 合并率分母重定义）待用户确认回写。

**零回归**：Sprint 6 纯文档/脚本准备，367/0 基线未动。脚本 `node -c` 通过 + 实跑产出 n=1 JSON。无引擎/patches/SKILL 改动，无需部署 pro。

## 🔖 2026-07-14 Sprint 5 完成（安全根治 聚类 A/B — sprint-plan 最难 Sprint，全自主 tree-harness 子会话）

Sprint 5 四项全部完成。全量 **286/0 零回归** + 新增 sprint5 三测试 **81/0**（max-sessions 34 + patches-bypass 27 + gate-reachability 20）= **367 全绿**。pro e2e 实证。聚类 A/B 单边缓解全落地，跨仓根治标记汇报。

**1. max_sessions 引擎硬护栏**（tree-engine.cjs `28cb42bb`→`5532fa5f`，5045→5216 行）— improvement P0 / 聚类 E（成本失控）：
- **根因**：node_budget 只数 leaf（默认 20）、CREATE_SESSION_BUDGET（patches）只限单 caller 速率（20/60s），两者都拦不住「多 caller 累积 + SDK 原生 create_session 旁路（不入 tree）」的总量爆炸（macp2 4 分钟 207 session 不入树，绕过 node_budget/subagent_budget/TaoWatcher 全部）。
- **实现**：新增 `E_MAX_SESSIONS` + `audit_meta.max_sessions`（默认 **50**，≈ node_budget 20 的 2.5x，留余量给 segment 交接/auditor/旁路 reviewer；远低于 macp2 207）+ tree-state `session_registry`（distinct session 登记簿）。
- **四路径登记**（堵绕过链，关键）：cmdInit root / cmdLeafAdd / cmdLeafSetSession / cmdTreeRegisterSession 全调 `registerSessionToState`。`registerSessionToState` 跳过 PENDING_ROOT/非UUID（不占额度——它们不是真实 create 产物）。`countSessions` 兜底（registry 缺失 → leaves distinct session 重建，不误拦旧树）。
- **新命令**：`tree register-session`（旁路登记，供 patches create_session 调）+ `tree session-count`（只读预检 {count,max,reached}）。migrate 规则14 回灌旧树 session_registry（从 leaves distinct session 回灌，让历史树也受保护）。导出 `findTreesBySession(treesRoot, sessionId)`（session→tree 反查，供 patches 定位 caller 所属 tree）。
- **测试** sprint5-max-sessions-test **34/0**（engine 真实 require，16 用例覆盖 init/add/register/set-session/migrate/findTreesBySession 全路径 + E_MAX_SESSIONS 拦截 leaf_add/register/set-session 三入口 + max_sessions 自定义 + PENDING_ROOT 不占额度 + node_budget vs max_sessions 独立性 + 干净失败未污染）。

**2. create_session 旁路根治单边方案**（proma-dev-patches.cjs `93cd64f4`→`339082af`，3268→3342 行）— improvement P0-S01 / 聚类 A（约束同构盲区，最致命）：
- **根因**：tree engine 与 Proma SDK 间无双向契约（无 create_session 回调、无 session 身份强绑定）。所有约束都在 `mcp__tree__*` 入口，agent 用 SDK 原生 create_session 旁建 session 时 engine 零感知。**约束只能约束走协议的人，约束不了不走协议的人**。
- **单边方案**（子会话能做）：新增 `findCallerTreesForBypassGuard(sourceSessionId)`（扫描所有 workspace trees_dir，定位 caller 所属 tree）。create_session handler 加：(a) **max_sessions 预检**（budget 后、delegationDepth 前——顺序 rate→count→depth，成本低的先拦）caller 所属 tree 任一 reached → 拒绝 E_MAX_SESSIONS（钱没花）；(b) **create 成功后旁路登记**（register-session）把新 session 登记到所属 tree session_registry（旁路可见，让 max_sessions/审计覆盖旁路 create）。新增 MCP 工具 `tree_register_session`/`tree_session_count`（agent 可调）。non-fatal 降级（预检/登记失败不阻断 create，engine 侧 max_sessions 仍兜底）。
- **测试** sprint5-patches-bypass-test **27/0**（mirror 逻辑 applyBypassGuardPrecheck 5 用例 + 源码静态 22 项：helper/候选/non-fatal + 预检 E_MAX_SESSIONS/session-count/reached + 顺序 budget<预检<depth + 登记 register-session/source + _pendingBypassRegister 连接 + 顺序 lineage<登记<log + MCP 工具 + readOnly）。patches 顶层 electron 副作用无法 require → mirror 契约 + 源码静态（同 sprint3-d3/sprint4 模式）。
- 🔴 **跨仓标记**（不强行做）：真正根治需 Proma SDK create_session 回调钩子 + subagent_trace_id（Layer 4 平台层 capability-based 调用 + event hash chain，SECURITY §4.3 远期路线）。

**3. 门禁前置可达性审计**（聚类 B）— improvement / 验证，**无新绕过链需修复**：
- **审计范围**：done 门禁链（unified-workflow §⑤ 8 门禁）+ max_sessions session 写入路径完整性。
- **结论：无新绕过链**。历史修复完整：（P0-S03 done event 自动同步 status 已删，status=done 单一入口 cmdLeafSetStatus）/（P0-S04 audit_gate 信任锚 SKILL §13）/（P1-S03 flagged 动态化堵篡改）/（P2-S02 5件套持久化）/（macp3 review_round+subagent append 前置校验防 events 污染）。max_sessions 四路径登记完整（grep 确认 registerSessionToState 4 调用点 + migrate 回灌 + PENDING_ROOT 跳过）。
- **关键审计证据**：grep `.status = 'done'` 字面量赋值 = **0 处**（status=done 只经 cmdLeafSetStatus `leaf.status = new_status` 单一入口）；cmdEventAppend done 路径代码行无 leaf.status 赋值（P0-S03 修复完整，注释里的历史说明 leaf.status='done' 已排除）。
- **测试** sprint5-gate-reachability-test **20/0**（静态审计回归保护——防未来改动重新引入绕过链，如有人重新加 done event 自动同步 / 新增 session 写入不登记 / 移除 done caller-binding）。聚类 B"形式≠内容"原则推广到测试层。

**4. auditor role 端到端 fallback**（commander SKILL §13.4.5）— improvement P1-S04：
- SKILL 加 §13.4.5：auditor session 因 Proma fork identity timeout（BUG-A 跨仓）卡死时，root 归档卡死 session（archive_session）+ 重 fork 新 session + leaf set-session 换新 session（caller=root=added_by 放行）+ 继续 §13.4.1 流程。
- **红线**：同一 auditor leaf 重 fork ≤2 次（每次重 fork 新增 session_registry 记录，撞 max_sessions）；归档 session 不释放 max_sessions 额度（registry 记历史 session 总数防爆炸——归档≠没创建过）；已 done 的 auditor leaf 不 fallback；替代方案回退 §13.4.4 root 信任锚（不依赖 fork，无 identity timeout 风险）。
- 🔴 **跨仓标记**：fork identity timeout 是 Proma app 层 bug，SKILL fallback 是单边缓解；真正根治需 Proma 修 fork identity。无引擎/patches 改动（纯 SKILL 教化 + set-session 已在 max_sessions 四路径登记覆盖）。

**部署**：pro dist engine `5532fa5f` + patches `339082af` + commander SKILL `8b2d20f2`（md5 **三校验 = 权威源**）+ 重启 pro（MSYS_NO_PATHCONV=1 taskkill Proma-green 全杀 + powershell Start-Process start-pro.bat，进程 21:12 加载新代码）+ remote 探活（discover pro@19877，225 sessions）+ **pro e2e 实证**（commander `77326cb6` GLM-5.2：tree_init s5pro1 ok + tree_session_count 返回 **count=1/max=50/reached=false**，definitive 证明新引擎加载 + tree_session_count MCP 工具注册生效 + session_registry root 登记持久化）。备份 `.bak-pre-sprint5-20260714`（源 engine/patches + dist engine/patches/SKILL）。

**文档同步**：CLAUDE.md（engine md5/行数 5045→5216 + patches 3268→3342 + Sprint 5 改动说明 + ENGINE_PATH md5 + 部署口诀 md5）/ ERROR-CODES.md（加 E_MAX_SESSIONS §六 + 计数 50→51 engine 42→43）/ CHANGELOG（Unreleased 顶部 Sprint 5 条目）/ sprint-plan（Sprint 5 ✅ + 路线图 + 交付物状态列 + 跨仓标记）。历史快照 md5（Sprint 1-4 条目）保持原值勿动。

**关键设计决策**：
- max_sessions 默认 50（非 node_budget 的 20）：session 数天然 > leaf 数（segment 交接换 session / auditor 独立 session / 旁路 reviewer），需留余量；但远低于 macp2 207。
- session_registry 记 distinct session 总数（含历史/归档）：防爆炸语义是"短时间创建大量 session"，归档≠没创建过。node_budget 数 active leaf（归档释放），max_sessions 数历史 session（归档不释放）——两个维度互补。
- max_sessions 四路径登记（非仅 leaf_add）：堵 set-session 绕过链（segment 交接换的真实 session 必须登记，否则 max_sessions 可被 set-session 路径绕过——这正是聚类 B"门禁互相架空"的体现，任务3 审计抓到并修复）。

## 🔖 2026-07-14 Sprint 4 完成（跨工作区 P1/P2 + TAO 角色规则 + P1-S05 命运决策）

Sprint 4 四项全部完成，全量 **215/0 零回归**（baseline 未动）+ 新增 sprint4-patches **71/0** = 286 全绿。

**跨工作区 P1（patches Part B）**：cross-workspace-tree-issue §五 P1 定义两部分。Part A（validateWorkspaceId / R2-R4，已做）只校验 workspace **存在于索引**——但 9 个工作区都在索引里，所以拦不住 agent 跨工作区漂移。**Part B（本轮缺口）= agent 调用方工作区锁**：sourceSessionId 存在（agent 调用，非顶层 user/automation）时，建子会话必须留在自己 workspace 内——显式跨 → `E_WORKSPACE_FORBIDDEN`；未指定 → 强制=调用方 workspace（防 workspaceId=undefined 漂出 + 保证子树同工作区）。create_session（L702）+ fork_session new_workspace_id（L850）双入口。顶层 user/automation 不受限（跨工作区属 admin 操作）。remote_create_session 独立 handler 不经此锁。

**跨工作区 P2（main.cjs 平台层）**：createAgentSession 原本 `meta3.workspaceId = workspaceId` 无条件写入（即使 workspace 不存在），是 9 工作区漂移的平台根因。本轮 main.cjs L386653 加守卫 `if (workspaceId && !getAgentWorkspace(workspaceId)) throw E_WORKSPACE_NOT_FOUND`（在 meta3 构建前，无效 workspace 无状态副作用/无孤儿）。补 Part A/B 之外的平台层路径（automation/bot/直调 API）。正常流程（合法 workspaceId）不触发。
- ⚠️ **高风险闭源 main.cjs sed 铁律执行**：备份 `.bak-pre-sprint4-20260714` + 锚点唯一性校验（`function createAgentSession(title, channelId, workspaceId, modelId)` count=1）+ Node 精确单次字符串替换（+220 bytes，honors "字符串替换非重构建"原则，比 sed 多行可靠）+ `node -c` 通过 + 重启 pro 探活（231 sessions）+ create_session happy path 实证（session d755bb5b 正确挂 eb5e3f9c workspace）。**无崩溃无回归**。注：P2 是直编 dist/main.cjs（非 apply-patches.sh A-K 管道，因铁律禁重构建）。

**TAO Watcher 按角色分发**：a8111bf5 真因（worker 规则 W-01 经共享 session 注入根指挥官）**已被 isSharedSessionLeaf 守卫修**（V10 Phase 3 followup）。本轮加**结构防御层**：`RULE_ROLE_SCOPE` 中心表（单一信源，root/commander/worker/auditor 各 role 的适用规则）+ `ruleAppliesToRole` / `maybeForLeaf` 结构分发——dispatch 时按 leaf.role 只跑该 role 的规则，即使某函数 guard 写错/漏写也不会错配（纵深防御，补 isSharedSessionLeaf）。之前靠 15 个规则函数各自 `if (leaf.role !== X) return []` 自过滤（散落易漏）。worker 规则（W-01/W-08/W-11/W-12/W-AUDIT-NO-ALIGN）结构上绝不发给非 worker leaf。表 null-scope 项（C-02/C-03/W-AUDIT-SELF/WORKER/TAMPER）= 全 role 适用（规则自带更细条件，如 W-AUDIT-SELF 的 root 自审例外）。**测试含表↔函数 guard 一致性静态校验**（12 规则逐个提取函数体 guard 断言与 scope 一致，防漂移回归——最关键回归保护）。

**P1-S05 TaoWatcher 命运决策**：
- **统计**（pro 26-tree 实测 nudge_log 非空条目 + tao-watcher-script audit_log）：
  - 真实价值：**vcb2=4 条**（W-01×2 + W-08×2，正常 worker 场景捕获真实违规，印证 note 07-09 vcb2 验证）；v10e2e=8 / v10e2e-v2=3（小量真实）。
  - 失控膨胀：**macp2b=15052** / macp2x=7521 / audtest=6766 / macp3=5325（nudge_log 无上限累积，状态污染，无行为效果——nudge_send_limit 只限 send_message 不限 log）。
  - 0 触发：sd3e2e/verifycb2/e2e-v10-test/macp-cleanroom/s2verify5p（合规/短命，watcher 跑了但无违规，非"watcher 没跑"）。
- **决策**：**保留 + 补可观测**。砍掉选项被 vcb2 实证否决（非纯安全剧场）；as-is 选项被 macp2b 15052 膨胀否决。
- **落地**：applyNudge 加 `nudge_log_cap`（默认 50，cfg 可配 <=0 关闭）+ 专用累计计数器 `leaf.nudge_log_dropped_total`（独立于哪些条目存活，永远准确，一眼知累计浪费——重载 dropped_old 到 last entry 不可靠，因带计数的条目可能被再截掉）。loadTaoConfig 两处默认 + config-patch 白名单。**file-log 留 follow-up**（watcher 运行日志独立落盘，更大 scope）。

**测试**：sprint4-patches-test **71/0**（Task1 workspace 锁 6 + Task3 role 分发 29 + Task4 nudge_log cap 5 + 源码静态 13 + 表↔guard 一致性 12 + Task4 静态 6）。patches.cjs 顶层 electron 副作用无法 require 整模块 → mirror 纯逻辑契约 + 源码静态校验（同 sprint3-d3 模式）。

**部署**：pro dist patches `93cd64f4`（md5 双校验=权威源，3174→3268 行）+ main.cjs P2 直编 + 重启 pro（进程 19:41→19:55 加载新代码）+ remote 探活（231 sessions）+ create_session happy path 实证。备份 `.bak-pre-sprint4-20260714`（源 patches/engine + dist main.cjs/patches）。engine md5 `28cb42bb` 未变（Sprint 4 未动引擎）。无 SKILL 改动。

**文档同步**：CLAUDE/API/ARCHITECTURE/README/ERROR-CODES md5 `901b3cf3`→`93cd64f4` + 行 3174→3268（当前态行）；CHANGELOG/note 历史快照（Sprint 3 条目）保持原值勿动。ERROR-CODES 加 `E_WORKSPACE_FORBIDDEN`（P1 新码）+ 标注 P2 平台层 `E_WORKSPACE_NOT_FOUND` throw（L386653）+ 计数 49→50。ARCHITECTURE/README 标注 main.cjs 第 12 处 sed（P2 直编，非 A-K）。CHANGELOG Pending 移除 3 已完成 Sprint 4 项，加 TaoWatcher file-log follow-up。sprint-plan Sprint 4 ✅ + 路线图总览 1/2/3/4 标完成。

**无争议项 / 无需用户决策**：四项均全自主完成，P2 main.cjs sed 风险已通过备份+锚点+验证闭环（无降级），P1-S05 命运决策数据充分（26-tree 实测）无需用户仲裁。

## 🔖 2026-07-14 Sprint 3 Phase D 完成（D1 prune 级联 / D2 版本管理 / D3 watcher 静默）

Sprint 3 Phase D 三项全部完成，全量 **215/0 零回归**（164 基线 + 51 新 D 测试）。

**D1 prune/archive 级联语义**（tree-engine.cjs `cmdLeafSetStatus`）：
- 父 leaf set-status=pruned → 未 done 后代（active/pending_brief/segment_pending）级联 pruned（+ drift 留痕，联动约束 5）
- 已 done 后代保留（防误删成果）且**不下降其子树**（整棵 done 子树保持原状）
- 终态后代（pruned/archived）不动；**archived 不级联**（archived=隐藏非删除，子保留可恢复）
- **root 永不被级联**（信任锚；parent=null 天然不可达 + `role==='root'` 防御性 skip）
- 实现：迭代 DFS（stack + visited 防环），同一 withLock 事务内强制状态变更，绕过 STATUS_TRANSITIONS/caller-binding（级联子是内部变更非新 API 调用；caller 已通过 target leaf caller-binding 校验）。result 加 `cascaded:[{leaf_id,from,to}]`
- 测试 `sprint3-d1-cascade-test.cjs` **19/0**（active 级联/done 保留/递归 3 层/done 子树不下降/终态不动/archived 不级联/root 防级联）。关键：fresh worker 初始 status=`pending_brief`（非 active），pending_brief 是非 done → 也级联（额外覆盖边界）

**D2 migrate 版本号（schema 版本管理）**（tree-engine.cjs 顶部常量 + cmdInit + cmdMigrate 规则 12）：
- 新增 `SCHEMA_VERSION='1.1'`（单一信源）+ `SCHEMA_LADDER=['1.0','1.1']` + `SCHEMA_HISTORY` + `compareVersion`
- cmdInit: `version: SCHEMA_VERSION`（原硬编码 '1.1'）；cmdMigrate 规则 12 重构：按 ladder 从 startVersion 逐级升到 SCHEMA_VERSION，每跳记一条 change（version-dispatch 可追溯）；超前 ladder 则 clamp 回（防漂移）
- **⚠️ SCHEMA_VERSION 保持 '1.1' 不升 1.2**：Sprint 3 未引入新 tree-state.json 字段（D1 是行为变更非 schema 字段，D3 在 patches.cjs）。升 1.2 会破坏 auditor-role-test Case 8（硬断言 version 1.0→1.1）。D2 的价值=版本管理机制（单一信源 + ladder 分发 + 可追溯），非版本号本身
- 测试 `sprint3-d2-version-test.cjs` **10/0**（新树 version/1.0→1.1/幂等/dry-run/0.9 多跳 dispatch/2.0 clamp）

**D3 watcher silence_minutes**（proma-dev-patches.cjs TAO Watcher）：
- `loadTaoConfig` 默认加 `silence_minutes:0`/`silenced_until:null`（旧 config 合并默认）；纯函数 `decideWatcherSilence(cfg, nowMs)` → {skip, remainingMs, reason}
- `runOnce` loadTaoConfig 后检 silence，未过期则本轮跳过（减噪/省成本），过期自动恢复
- IPC `proma:watcher-silence {minutes}`（<=0 清除，clamp 1min~7天）；status 暴露 silence 决策；config-patch 白名单加两字段
- 测试 `sprint3-d3-silence-test.cjs` **22/0**（**⚠️ patches.cjs 顶层有 electron 副作用无法 require 整模块 → 纯逻辑 mirror 契约测试 + 源码静态校验 8 项**；若未来 patches.cjs 导出 decideWatcherSilence 应改 require 实测）

**全量 215/0**：6 核心 94 + dbc-spec 39 + sprint2 31 + sprint3 D1/D2/D3 19+10+22=51。ENGINE_PATH 全指权威源（md5 `28cb42bb`/5045 行；patches `901b3cf3`/3174 行）。

**部署 pro**：dist md5 双校验 = 权威源（28cb42bb/901b3cf3）+ 重启 pro（进程 15:46→19:06 加载新引擎）。备份 `.bak-pre-sprint3-phaseD-20260714`（源 + dist）。

**pro e2e 实证（D1 cascade）**：会话 `78457d75`（GLM-5.2）建树 sd3e2e，create_session 产 3 子 session（commander + 2 worker，绕 one-session-one-leaf），leaf set-status commander=pruned → **返回 cascaded=[{L1a-worker,pending_brief→pruned},{L1b-worker,pending_brief→pruned}]**，两 worker leaf_get 确认 status=pruned + drift_history 含 `cascade prune: parent "sd3e2e-L1-commander" pruned (D1 cascade semantics)`。**definitive 证明 pro 加载新引擎 + D1 cascade 经 MCP 层 + 真实 session 端到端生效**。e2e 过程 2 个测试指令 bug（leaf_add 漏 model/channel；单 session 复用 → E_DUPLICATE_SESSION_ID），均非引擎问题，第三次（多 session）成功。

**🔴 文档同步事故 + 教训（md5 自动化的边界）**：本次写了 `.context/sync-doc-md5.cjs` 想 automation 化 md5/行数同步，**首版有 3 bug**：(1) Git Bash md5sum 输出前导 `\` 未 strip → 写出 `\28cb42bb...` 损坏值；(2) `split('\n').length` 比 `wc -l` 多 1 → 行数 off-by-one（5046 vs 5045）；(3) 盲替旧 md5 列表含 `42ba5d51`（那是 workspace-files **旧源**的 md5，非过期引用）+ 含历史快照 md5（CLAUDE L56 BUG-2 修复时 md5）→ 把历史快照也改成当前值，失真。**修正**：脚本降级为**只自动同步行数**（机械安全）+ md5 仅报告不自动替换（人工判断权威行 vs 历史快照）。落实 note 既有结论「md5 反复同步是坏实践 → 归 backlog 自动化」的审慎版：能自动化的（行数）自动化，不能安全自动化的（md5 上下文判断）留人工。事故已全部手工修复 + 复扫 clean。

## 🔖 2026-07-14 测试治理：6 核心测试 require 修到权威源（94/0 假绿灯→真实验证）

**问题**（父会话核实发现的治理缺口）：6 核心测试 `ENGINE_PATH` 全指向旧源
`C:/Users/sir_c/.proma/.../workspace-files/tree-engine.cjs`（md5 `42ba5d51`，4928 行，**不含** 5 件套/drift 联动/ctx 竹节/restore-tree_id 等所有 Sprint 1+2 新改动），而非权威源
`D:/codes/tree-harness/tree-engine.cjs`（md5 `9f575fb8`，4961 行）。导致这 6 测试"94/0"验证的是**旧逻辑**，对新改动无回归保护（假绿灯）。

**改动**（最小改动，与 sprint2 测试已确立模式一致）：6 文件 `const ENGINE_PATH` 字符串值从旧源路径改为权威源绝对路径
`'D:/codes/tree-harness/tree-engine.cjs'`：
- auditor-role / iss003-review-gate / p0-1-sync-fix / p0-3-status-transition / p1b-fix-evidence / subagent-lifecycle
- 选绝对路径而非 dbc-spec 的 `_findEngine`：`.context/plan/` 位置固定（dbc-spec 用 `_findEngine` 是因 assets 会被 cp 到 test-sandbox/激活 assets 等多处，需自适应；6 核心测试无此需求，直指权威源更简单可读）

**全量重跑**（全部不带 env，确认 ENGINE_PATH 修后默认指权威源）：
| 测试 | 结果 |
|------|------|
| 6 核心测试 | auditor 20 + iss003 13 + p0-1 4 + p0-3 19 + p1b 8 + subagent 30 = **94/0** |
| dbc-spec | 39/0（_findEngine 候选首位权威源，已修过） |
| sprint2-five-piece | 15/0 |
| sprint2-drift-linkage | 9/0 |
| sprint2-ctx-segment | 7/0 |
| **合计** | **164/0 零回归** |

**失败用例判断**：**无失败**。6 测试验证的特性（auditor role P0a / ISS-003 review 门禁 / P0-1 done 同步 / P0-3 状态流转 / P1b fix_evidence / subagent 入树）均为 Sprint 1 之前特性，权威源完全兼容——引擎只加了新东西（5 件套/drift 联动/ctx 竹节/restore tree_id），未删旧逻辑。无需改任何测试期望。

**🔴 测试治理原则（权威源唯一）**：
1. 所有测试 `ENGINE_PATH` 必须指向权威源 `D:/codes/tree-harness/tree-engine.cjs`，**严禁**指 `workspace-files/` 旧源（已非权威，md5 `42ba5d51`，无新改动）。
2. 新增测试一律用绝对路径直指权威源（`.context/plan/*`），或参照 dbc-spec `_findEngine`（assets 多副本场景）——本质都是"候选首位权威源"。
3. 「X/0 绿」的可信前提是确认被测引擎 = 权威源 md5 `9f575fb8`。假绿灯根因 = require 旧源（本次）或期望过时（dbc-spec 上次），两者都是文档/测试失同步。
4. 当前可信基线：**164/0 全量真实验证权威源**（6 核心 94/0 真实化 + dbc-spec 39/0 + sprint2 31/0）。此前"6 核心 94/0"是假绿灯，现已恢复真实可信。

## 🔖 2026-07-14 Sprint 2 约束 3 复核激活（milestone 门禁，状态修正 + minor 教化）

methodology-coverage-audit 约束 3 🔴→🟢（原"纸面"判断过期）。

**复核结论**：约束 3 实际已激活，原"纸面"基于 07-04 中期评价（V3 之前 18/18 milestones=[]）。
- ✅ 引擎 V3 硬强制：cmdLeafSetStatus done 前置 milestones 非空 + 全部 audit_pass=true（L1476/L1496）。dbc-spec V3 用例验证（39/0 含 V3）。引擎强制 = done leaf milestone 非空率必然 100%（不 add 无法 done）
- ✅ commander §13.3 步骤 1 已教 milestone_add（root 冷启动配 done 前置 8 步流程）
- ✅ worker §2 步骤 2 补 milestone_add 持久化教化（本轮，minor gap：原只教拆解没教调 milestone_add）

**改动**：worker SKILL §2 步骤 2 加「调 tree_milestone_add 持久化 + V3 硬约束说明」（无引擎改动，纯 SKILL 教化）。Sprint 2 四约束（3/4/5/6）全部处理完毕。

## 🔖 2026-07-14 Sprint 2 约束 6 部分激活（ctx 竹节刚性触发 + SKILL 心跳教化）

methodology-coverage-audit 约束 6 🔴→🟡：引擎竹节刚性触发 + SKILL 教哨兵写真实 ctx。

**Part A 引擎刚性**（tree-engine.cjs，md5 `365bb8bd`→`9f575fb8`，4941→4961 行）：
- cmdLeafSetContext（L1722）：写 context_usage_pct 后，若 pct≥阈值（audit_meta.ctx_segment_threshold 默认 85）且 status=active 且 role≠root → 自动 set segment_pending + drift handoff（联动约束 5）
- 替代 SKILL §8.3「下次心跳仍 ≥85% 触发竹节（v0.3 实现）」的**未实现**手动竹节——现在引擎刚性触发
- 边界：pending_brief（还没 brief_echo 不会超阈值）/done/pruned/archived（终态）/root（信任锚）不触发

**Part B SKILL 软约束**（commander §8）：
- §8.1 步骤 2 改：哨兵对每个 active leaf 调 `get_session_context(session_id)` 拿真实 token/contextWindow → 算 ctx_pct → `leaf_set_context` 写入（治"ctx 永远 0"根因：旧 §8.3 写的是哨兵输入里的旧 context_usage_pct=0，循环写 0）
- §8.3 sweet_spot_risk：引擎已自动 segment_pending，commander 竹节交接 4 步（create_session → segment_append → set-session → set-status active）

**测试**：sprint2-ctx-segment-test.cjs **7/0**（阈值下/阈值上/root 不触发/done 不触发/自定义阈值）。零回归：drift 9/0 + 5 件套 15/0 + dbc-spec 39/0

**部署**：pro dist 引擎 `9f575fb8` + commander SKILL `2d0c1464`（双校验）+ 重启 pro。备份 `.bak-pre-ctx-segment-20260714`

**⚠️ 待实战验证**：哨兵心跳是否真执行 get_session_context（软约束，需真实长任务观察 ctx 写入率）。引擎竹节刚性已测试验证，但 ctx 非全 0 靠哨兵执行

## 🔖 2026-07-14 Sprint 2 约束 5 完成（drift 联动 + restore tree_id bug 修复）

methodology-coverage-audit 约束 5 🟡→✅：状态变更全留痕（set-session/migrate/restore 联动写 drift）。

**引擎改动**（tree-engine.cjs，md5 `2d281ebf46`→`365bb8bd`，4895→4941 行）：
- cmdLeafSetSession（L1816）：session_id 变更后双写 drift（kind=rhythm / action=self_correct, from/to=session）
- cmdRestore（L2457）：恢复后双写 drift（kind=production / severity=high / action=declare, root leaf + drift_log）
- cmdMigrate（L3636）：迁移后双写 drift（kind=production / severity=mid / action=declare, root leaf + drift_log）；`--dry-run` 不写
- **顺带修复 pre-existing P1 bug**：restore tree_id mismatch。cmdRestore L2431 校验 `parsed.tree_id !== tree_id`，但 tree-state.json（cmdInit L728 state 构造）**无 tree_id 字段** → restore 对当前格式永远 `E_BACKUP_CORRUPT`（阻塞 SKILL §10 F3 灾难恢复）。修：cmdInit state 加 `tree_id` 字段（自描述）+ cmdMigrate 规则 13 补旧树。writeState/readState 不注入 tree_id（保持现状，tree_id 是数据字段非派生）

**测试**：`.context/plan/sprint2-drift-linkage-test.cjs` **9/0**（set-session / restore / migrate drift 内容 + migrate dry-run 不写）。零回归：dbc-spec 39/0 + 5 件套 15/0

**部署**：pro dist 已 cp（md5 `365bb8bd` 双校验）+ 重启 pro。备份 `.bak-pre-drift-linkage-20260714`（源 + dist）

**SKILL 影响**：drift 联动是引擎自动行为，agent 无需手动 drift_append 记录状态变更（手动 drift_append 仍可用于偏差记录）。SKILL §5 drift_append 工具说明无需改

## 🔖 2026-07-14 Sprint 2 约束 4 收尾完成（5 件套持久化 + create_session 派生，pro 实证）

design-commander-spawn §八 检查清单全项完成，methodology-coverage-audit 约束 4 🔴→✅。

**本轮收尾**：
- worker SKILL §2/§2.5：启动首步 `tree_leaf_get(自己 leaf_id)` 读 leaf 持久化 5 件套（混合任务书机制）；§2.5 阶段1/3 改 create_session + 读 leaf（去掉旧 send_message 收 5 件套）
- commander §7/F1：加 fork 边界标注（重档剪枝/F1 崩溃恢复用 fork=重试语义；正常派生用 create_session §4）。顺带标 §7 中档 `autonomy_override` 失同步（Sprint 1 已删工具，中档降级加强 nudge，替代机制待补）
- **新增 5 件套持久化测试** `.context/plan/sprint2-five-piece-test.cjs`（**15/0**）：root 5件套 / leaf_add 持久化 / 向后兼容 / 部分传 / validate 五类。关键发现 `engine.run` 返回 `Object.assign({ok:true}, result)`（L4826）——数据字段在**顶层**（`r.leaf`），非 `r.result.leaf`（p0-3 用 `result:out` 整个 out 是对的；测试 harness 写法陷阱）
- pro 重启加载新引擎（taskkill Proma-green + start-pro.bat，进程 14:25→**15:01**，dist md5 `2d281ebf46` 含 5 件套）
- **pro 端到端验证**（commander `d218bd5c` GLM-5.2）：tree_init(root_brief/root_dod) → tree_leaf_get(root) → **brief/dod 均非 null 完整回填**（47s，38k input tokens）。证明 pro 引擎确实加载 5 件套 + tree 工具链路通。create_session 派生：commander 会话本身由 remote_create_session 建（非 fork），机制可用

**约束 4 状态**：methodology-coverage-audit 🔴→✅（引擎持久化 + SKILL 教化 + 测试 15/0 + pro 实证全链路）

**测试治理发现（归 backlog）**：现有 6 核心测试 require workspace-files 旧引擎（md5 `42ba5d51`，4928 行，无 5 件套），"94/0 核心测试"验证的是旧逻辑。dbc-spec + 本轮 5 件套测试用权威源。建议统一 require 路径到权威源（测试治理 Sprint，改路径需验旧/新引擎行为差异）

**SKILL md5**：commander `152c22c1` / worker `0caa7249`（已同步 pro `~/.proma-dev/.../skills/`）

## 🔖 2026-07-14 Sprint 2 约束 4 进行中（commander 派生 + 5 件套持久化）

design-commander-spawn 提案实施（Sprint 2 约束 4）：

**引擎（完成）**：
- `cmdLeafAdd` leaf 构造（L1031）+ root leaf 构造（L753）加 5 件套字段：`brief`/`dod`/`report_protocol`/`autonomy`/`self_audit`（object，默认 null，向后兼容旧 leaf）
- cmdLeafAdd 从 input 接收 5 件套持久化；root leaf 从 state.root_brief/root_dod
- node -c + 测试 **121/0**（iss003 13 + p0-3 19 + subagent 30 + auditor 20 + dbc-spec 39，向后兼容确认）
- tree md5 变（35d67340e2 → 新），已部署 PRO dist

**SKILL（commander §4 Step 2 完成）**：
- 正常派生**强制 create_session**（删 fork 二选一），标注 fork 仅用于 §7 纠偏重档 / F1 崩溃恢复
- 新流程：create_session → leaf_add（含 5 件套持久化）→ 首条消息含 leaf_id（混合任务书，非塞完整 5 件套）→ 下游启动 tree_leaf_get 读 5 件套 → brief_echo
- role 枚举注释补 auditor

**剩余（Sprint 2 约束 4 收尾）**：
- worker SKILL 启动读 leaf 任务书（commander §4 Step 4 已覆盖"下游会话启动 tree_leaf_get"，worker SKILL 加交叉引用即可）
- SKILL §7/F1 标注 fork 仅纠偏/恢复（§4 已述，§7/F1 加显式注）
- pro 重启加载新引擎（含 5 件套）+ pro 端到端验证（建 tree 测 leaf_add 5 件套 + tree_leaf_get 读，烧钱，可选）
- methodology-coverage-audit 约束 4 状态 🔴→🟡（引擎+SKILL done，待 pro 验证）

**关键设计点**：5 件套持久化进 leaf → commander/worker 启动主动 tree_leaf_get 读（混合任务书），不依赖 fork 继承父历史。防"fork 污染 + token 重"，符合契约驱动。

## 🔖 2026-07-14 部署 PRO dist + Pro 重启加载新引擎

部署累计引擎改动到 PRO dist（D:/Proma-dev/resources/app/dist/，备份 .bak-pre-sprint1-deploy-20260714）：
- `tree-engine.cjs`: `35d67340e2`（删 autonomy + flagged 动态化 isFlagged + cmdHelp 42）
- `proma-dev-patches.cjs`: `611751b2`（删 tree_leaf_autonomy_override 注册 + 正则，原 `cbc0f133`）
- md5 双校验通过（dist = 权威源）

Pro 实例重启（taskkill Proma-green + start-pro.bat），powershell 确认进程启动时间 14:25（新进程加载新引擎，非旧残留）。remote_list_sessions(pro) 确认可连（238 会话，含 verifycb2 caller-binding 验证会话）。

文档同步：patches md5 `cbc0f133`→`611751b2`（CLAUDE/API/ARCHITECTURE/README/ERROR-CODES）。

**Sprint 1 全部完成 + 金标准恢复 + Pro 加载新引擎**。当前可信基线：6 核心测试 94/0 + dbc-spec 39/0 = **133/0 真实验证**（dbc-spec 首次真实全过）+ Pro 跑新引擎（删 autonomy + flagged 动态化生效）。

## 🔖 2026-07-14 dbc-spec 过时修复完成（39/0，金标准恢复）

dbc-spec.cjs（skills/tree-commander/assets/）过时两处，subAgent 修 + 父会话独立验证 **39/0**：

1. **_findEngine 修**：候选首位加权威源 `D:/codes/tree-harness/tree-engine.cjs`（原首位 patch-l 不存在 → fallback 旧版，是失守根因）。现默认 require 权威源。
2. **14 用例期望对齐 V10/IHL**（无引擎回归，全是 dbc-spec 过时）：
   - milestone 校验前置（A1/V3/V9-a，done 前 milestone 必须 audit_pass+非空）
   - auditor 独立性加严（A2-c/A7/A3-c/V5b×3/V4-c/CP2/V5b-tamper，11 条；V10-auditor-active 三要件 → setupTreeWithAuditor 用 root 信任锚激活）
   - UUID v4 严格（V2，全 f 前置拦 → 改合法 v4 非树中 UUID）
   - V9-a/V9-b 路径安全前置到 milestone add + V9-b fixture session_id 唯一性（addWorker2 独立 session）
   - V4-b 信任锚模型（root 可审任意非 root leaf → 改期望 auditor=worker 自审）
3. **独立验证**：dbc-spec 39/0（带 env + 不带 env 都过）。文档 dbc-spec 数字 48/0→39/0（README/TESTING 同步）。

**金标准可信度恢复**：dbc-spec 现实际可跑且全过。之前 require 旧版 + 期望过时，「48/0」是**从未真实验证**的声明（dbc-spec 从没在权威源跑过）。这是文档/测试失同步的又一案例（与之前源码/文档失同步同类）。

## 🔖 2026-07-14 Sprint 1 收尾完成（A review_evidence 动态化 + B 删 autonomy）

Sprint 1 两个 🔴 清掉，**Sprint 1（基线收尾）全部完成**：

**B 删 autonomy_overrides 死字段**（improvement P1-S02 闭环）：
- tree-engine：删 leaf 初始化(L771/L1054) + cmdLeafAutonomyOverride 函数(L1807-1861) + dispatch case + 注释清理（4 处 usage/section/子命令提示）
- patches：删 tree_leaf_autonomy_override MCP 注册(L1645) + writeTools 正则去 leaf_autonomy_override
- node -c 通过；**6 核心测试 94/0 全过**（iss003 13 + p0-3 19 + p1b 8 + subagent 30 + auditor 20 + p0-1 4）
- 旧 leaf 的 autonomy_overrides 字段保留但无人读（引擎容忍多余字段，无害）

**A review_evidence 动态化**（ISS-003 阶段二务实最小集，improvement P1-S03）：
- 新增 `isFlagged(leaf, state)`：flagged 从 events 动态计算（migrate 静态标记 || 新 leaf done worker 该审未审）
- flagged 扫描（建子 leaf 父链检查）改用 isFlagged，**堵「新 leaf done-未审不阻断下游」ISS-003 gap**
- 已补审（有 review_round）→ 不 flagged（放行）；flagged 不再依赖 review_evidence 静态字段，防直接篡改蒙混
- node -c 通过；iss003 13/0 不破坏（阶段一兼容）
- 未做：cmdReviewRound/Layer2/R-08（events 自写性根本限制下 ROI 低，留 backlog）

**🔴 新发现：dbc-spec 过时**（pre-existing，非本轮引起）：dbc-spec.cjs 的 require 候选**不含权威源**（找到 release/patch-l 旧版 v0.2.2，3602 行），用 `PROMA_TREE_ENGINE` 指向权威源跑 = **25 通过 / 14 失败**。14 失败全是 V10/IHL 新校验（milestone audit_pass 前置 / E_INVALID_UUID_STRICT / milestone 非空前置）vs dbc-spec 旧期望，**与 autonomy 无关**。dbc-spec 需更新跟 V10/IHL 引擎演进（归测试维护 backlog，影响「金标准 dbc-spec 48/0」可信度声明）。

**引擎状态**：tree-engine 4882 行 md5 `35d67340e2`，patches 3128 行 md5 `cbc0f133`，node -c + 94 核心测试通过。PRO dist 未同步（本轮改动需用户重启 pro 加载）。

## 🔖 2026-07-11 设计文档群组审计 3 轮收敛（会话 bbdefd1e，#19）

对设计文档群组（01_PRD 6 + 05_PROJECT_PLAN 4 + 根目录 ERROR-CODES/BUG-REGISTRY + CLAUDE/API/ARCHITECTURE）做 3 轮「审计→修复→再审」迭代：

- **第1轮**（6 维度 subAgent 并行：跨文档一致性/文档↔引擎/内部逻辑/可执行性/完整性/PRD质量）：52 问题，去重 23 项 P0/P1。修 19 项（md5 再同步 / MAX_DELEGATION_DEPTH 8→10 / ROLE_ENUM 补 auditor / node_budget 10→20 / 4 幽灵码标注 / done 门禁重列 / E_MAX_SESSIONS 改新增 / macp2 红线明确化 / 分档 / F1-F4→R1-R4 / checkpoint 降级 / Cr 发现率 / US-006 / ctx 矛盾等）。
- **第2轮**（验证修复 + 再审）：**P0=0**（修复无新矛盾），P1=2（分档未贯穿跨 3 文件 + node_budget API L820），P2=8。Agent A 验证 19 项修复 16✅ + 3🟡（半截）。
- **第3轮**：修 P1（Q1 分档 sed 统一 cost-guardrails+commander/worker SKILL 全 2/3/5 + Q2 node_budget L820）+ 3 项半截（cmdHelp title 41→42 + cost-guardrails L57/L132）+ Q3 行号锚点化（API §5.1 去行号 + ARCHITECTURE §7 加滞后注）+ 几个 P2（F1 行号/checkpoint 悬空引用/§八措辞）。

**✅ 收敛**：P0=0，P1=0。剩 P2 改善项 backlog（不阻断，Agent B 判定可接受留）：
- Q4 product-positioning 统合表补「开源做壳闭源做肉」商业策略维度
- Q6 layer2 五场景加 v1 可用性 emoji（场景1🟡/2✅/3🔴/4🟡/5✅，对齐 user-stories 矩阵）
- Q7 layer2 补「事中熔断」story（macp2 实证需求，v1.5 规划）
- Q10 ARCHITECTURE §5.2 commander fork→create_session 加 Sprint 2 预告注

**引擎改动**（本轮）：tree-engine cmdHelp 41→42（L4288 title + L4290/L4292 content），md5 现 `544e5f6d33`，node -c 通过。PRO dist 未同步（注释/文字改动无害，下次逻辑改动一并部署）。

**价值**：文档群从「补建后未经审计」到「3 轮审计收敛，P0/P1 清零」——跨文档一致性 + 文档↔引擎一致性 + 内部逻辑 + 可执行性 + 完整性 + PRD 质量六维过关。共修约 30 项（19 + 3 + 7+）。

## 🔖 2026-07-11 设计提案：Commander 派生改 create_session（排期 Sprint 2）

用户诉求：root 派生的各级 commander 不要 fork，重新开会话（create_session）+ 读任务书。经澄清决策：**仅正常派生**改 create_session（纠偏重档 §7 / 崩溃恢复 F1 保留 fork——它们是「从 milestone 重试」语义）；**混合任务书**（父会话 create_session 后发首条消息含 leaf_id → commander 启动调 tree_leaf_get 主动读 leaf 持久化的 5 件套）。

**不违反 macp2 红线**（CLAUDE.md P0 禁的是 create_session 当 reviewer/SubAgent；commander 是执行协调者，不在红线内，受预算护栏约束）。**天然激活约束 4**（5 件套持久化）—— 一举两得。

产出 `05_PROJECT_PLAN/design-commander-spawn.md`（设计提案 + 实施检查清单）。已排期 **Sprint 2**（= 约束 4 激活载体）。sprint-plan Sprint 2 + methodology-coverage-audit 约束 4 已更新引用。实施时改：tree-engine leaf schema 加 5 字段 + cmdLeafAdd 持久化 + commander SKILL §4 Step 2 强制 create_session + §7/F1 保留 fork 标注 + worker 启动读 leaf + 测试 + 文档。

## 🔖 2026-07-11 补 user-stories.md（01_PRD/，补 SubAgent A 缺口）

补 `D:/codes/tree-harness/01_PRD/user-stories.md`：把 Layer1 + Layer2 场景**合并去重**转写成 **8 个标准 user story**（As-a/I-want/so-that + Given/When/Then 验收 + MoSCoW 优先级）+ 3 个 Won't。

优先级矩阵结论：**4 个完全可用**（US-002 深度Fork / US-005 洁净室 / US-007 事故复盘 / US-008 外部编排），**3 个部分可用**（US-001 主线并行+审计 / US-004 多视角评审，依赖 auditor fallback 修复），**1 个 Must 核心未实现**（US-003 竹节交接，ctx 自动触发未做，Sprint 2 补）。供 sprint-plan 排期 + 测试引用。

## 🔖 2026-07-11 方法论补建完成（会话 bbdefd1e，05_PROJECT_PLAN/ 3 份）

建 `D:/codes/tree-harness/05_PROJECT_PLAN/` 目录，补建 3 份方法论文档（基于 SubAgent C 分析）：

- **methodology-coverage-audit.md**：把 V10「内容有效性」原则推广到方法论自身的自审。对照中期评价 6 条死硬约束逐条核实：**0/6 完全激活，3/6 部分（V5b alignment / §14 auditor / 三档纠偏），3/6 仍纸面（milestone_add / 5件套持久化 / ctx竹节）**。提出定期复审 + 纸面/软约束/刚性三档标注机制。
- **sprint-plan.md**：从事后追溯（CHANGELOG）转事前承诺。6 个 Sprint（基线收尾 / 约束激活 / Phase D / 跨工作区+TAO / 安全根治 / 产品化验证）+ 依赖图 + 版本里程碑 v0.17→v1.0。诚实声明 Sprint 估算缺历史数据 + 部分 Sprint 跨仓/外部依赖。
- **unified-workflow.md**：串联分散在 6+ 文档的端到端工作流（建树→5件套→worker 9 阶段→审计→done 8 门禁→归档），**补 SubAgent C 指出的人类 checkpoint**（macp2/macp4 都是用户上线才发现）——定义人类审查者 5 个介入节点（建树前/关键done前/审计争议/事故/上线前）。

矫正：方法论「深度极强但分散无统一 PROJECT_PLAN」→ 现有 sprint-plan + workflow 串联 + coverage-audit 自审。诚实点：Sprint 估算缺历史数据；安全根治 Sprint 部分跨仓；产品化 Sprint 外部依赖多。

## 🔖 2026-07-11 产品设计补建完成（会话 bbdefd1e，01_PRD/ 5 份 P0）

确认框架：**上游补丁 + 两层客户**（直接客户=Proma 维护者衡量合并；最终受益者=AI 开发团队衡量协作收益）。建 `D:/codes/tree-harness/01_PRD/` 目录，起草 5 份 P0 文档：

- **product-positioning.md**：定位纲领（两层客户 + 四说统合 + 边界声明 + 用 macp2/audit-gate/v626 实证论证安全 ROI）
- **layer2-user-scenarios.md**：Layer 2 五场景（①并行实现+独立审计⭐ ②对抗洁净室 ③竹节交接+甜点区 ④多视角设计评审 ⑤事故复盘+IHL）+ 场景↔能力映射矩阵
- **success-metrics.md**：两层客户指标 + 两条对照基线（vs 裸 prompt / Layer1-only）+ 反指标；**诚实声明多数指标当前无数据**（无真实团队/无基线/未提交 PR），v1 需补对照实验 + 首个 Proma PR
- **team-config.md**：角色×模型×工具×成本矩阵（macp2 根因之一），含 SubAgent 调用形式红线（进程内 Agent 工具，禁 create_session/fork_session/delegate_agent 当 reviewer）
- **cost-guardrails.md**：三层护栏（L1 引擎硬拦 / L2 SKILL 红线 / L3 行为引导）+ 收敛条件（角色 1/3/5、轮≤3、red_count=0 停）+ 撞错修根因禁换名重试 + 模型成本三角 + 自检清单

**矫正「实现丰满、PRD 骨感」倒挂**：Layer 2（80% 代码）首次有用户场景与成功指标。诚实点：场景基于 n=1 抽象待真实团队验证；指标多数无数据待对照实验；定位统合把垂直化产品暂列为非主线（v1 不取）。

## 🔖 2026-07-11 .context 统一（A3，建可信基线收尾）

合并 `workspace-files/.context` → `tree-harness/.context`（TH 为权威源）。盘点发现实际只需同步 2 个文件：
- **note.md**：WS 超集（TH 独有 0 行，WS 独有 176 行）→ TH（md5 现一致 `7436ecd4`）
- **active/harness-efficiency-assessment-2026-07-09.md**：WS 独有 → TH
- 其余根文档（PROJECT-INDEX / 待解决问题清单 / README / wiki / 中期评价 5 份）md5 本就一致；active/ 同名 18 份全一致；TH 独有 10 份（含本轮新建的 design-files-mapping/improvement-report）保留。

**今后约定**：`workspace-files/.context` 已废弃（已放 `_MIGRATED-TO-TREE-HARNESS.md` 迁移通知），所有 .context 写入只写 `tree-harness/.context`。运行时数据（trees/）各实例各自保留。

✅ **建可信基线全部完成**：源码统一（第0步）+ 文档治理 A1/A2/C（第1步）+ 代码小修 B1/B2（第2步）+ .context 统一 A3。

## 🔖 2026-07-11 代码小修 B1/B2（会话 bbdefd1e，建可信基线第2步）

**B1 autonomy_overrides 死字段**：grep 确认全引擎零消费（cmdLeafAdd L1054 初始化 + leaf_autonomy_override 工具 L1825 写入，零读取做限权）。处置：tree-engine L1825 加「死字段警告」注释（标注 no-op + 待决策）。删除字段 vs 实现限权消费待用户决策。注：drift_history 留痕仍有效（仅 autonomy_overrides 限权意图是 no-op）。

**B2 leaf_add 事务回滚（BUG-B）**：⚠️ **经代码审查否决修复**。通读 cmdLeafAdd（L816-1070）：所有 throw（caller-binding L872 / duplicate / session唯一 / added_by树内 / parent / 深度 / flagged / budget L1029）都在 push（L1064）前，push 与 writeState（L1066）间无 throw → **cmdLeafAdd 本身无事务问题**，报错时 leaf 未写入。audtest 报告的「幽灵 leaf + session_id 自动生成 + 连带 A4-worker」疑 **fork session 副作用**（非 cmdLeafAdd 事务缺陷）。BUG-REGISTRY BUG-B 状态改「待重新核实」，建议重新设计测试定位幽灵 leaf 真正来源后再决定。

**TH 状态**：tree-engine 加注释后 4934 行 md5 `10f40b49`（PRO dist 仍 `42ba5d51`，注释无害未部署，下次逻辑改动一并同步）。

## 🔖 2026-07-11 文档治理 A1/A2/C 完成（会话 bbdefd1e，建可信基线第1步）

**A1 错误码字典对齐**：
- 新建 `D:/codes/tree-harness/ERROR-CODES.md`（49 个错误码 = tree-engine 42 + patches 独有 7，从 TH 权威源自动抽取，分 7 类含触发条件/归属/行号）
- 补全 API.md §5（原 37 → 现 49，补 12 缺口：`E_DELIVERABLE_EMPTY`/`E_REVIEW_*`×3/`E_SESSION_NOT_ALIVE`/`E_STATUS_TRANSITION_INVALID`/`E_SUBAGENT_BUDGET_EXCEEDED` + patches 的 `E_NO_OWNERSHIP`/`E_DELEGATION_TOO_DEEP`/`E_SESSION_BUDGET_EXCEEDED`/`E_TARGET_NOT_FOUND`/`E_WORKSPACE_REQUIRED`）
- API.md §5.5 加 ERROR-CODES.md 权威源引用

**A2 BUG 注册表**：
- 新建 `BUG-REGISTRY.md`，理清两套并行命名体系（体系 A `Bug A-x/B-x` V10 P3；体系 B `BUG-n` audtest/harness）
- 澄清 leaf_add 两个不同漏洞：`Bug B-3`（session_id 唯一性，V10 P3 已修）vs `BUG-2`（caller-binding，07-09 已修）—— **非同名冲突，是不同校验维度**
- 修正 CLAUDE.md L55 原误述「同名 BUG-2 另指 SECURITY」（SECURITY 实用 `Bug B-3` 体系）

**C 元数据校正**：
- 行数批量校正：tree-engine 3602→4928，patches 2658→3129（README/API/ARCHITECTURE/DEVELOPMENT/DEPLOYMENT/TESTING 6 文件 sed，CHANGELOG 历史记录正确保留）
- 21 DbC 校验点：ARCHITECTURE §6.2 已有「截至 2026-06-26」日期限定，准确无需改

**待核实（低优先）**：`E_PATH_TRAVERSAL`/`E_SYMLINK_ESCAPE`/`E_WORKSPACE_CANONICAL`/`E_ROLE_INVALID`（API.md 有记载但 engine const 未定义，疑 patches 字符串抛出，ERROR-CODES.md §8 标注待核实）。

## 🔖 2026-07-09 源码统一：tree-harness 确立为权威源（会话 bbdefd1e，建可信基线第0步）

诊断发现 `tree-engine.cjs` 4 版本不同步（CLAUDE.md「git源=pro md5一致」声明不成立），`proma-dev-patches.cjs` 6 版本 5 个不同 md5（更乱）。用户决策 **tree-harness 为权威源**。

**已执行**（TH 现有 .cjs 已备份 `.bak-pre-source-unify-20260709`）：
- `TH/tree-engine.cjs` ← workspace-files（4928 行，md5 `42ba5d51`，含 07-09 caller-binding 修复）✅ md5+node -c 通过
- `TH/proma-dev-patches.cjs` ← **PRO dist**（3129 行，md5 `cbc0f133`，含 create_session budget 护栏 + P0b 废止 tao-watcher audit_log）。**注：WS 落后 PRO 20 行（budget 只部署 dist 没回写 WS），PRO 才是 patches 最新** ✅
- `proma-mcp-server.cjs` 5 处 md5 一致，未动
- CLAUDE.md 三处更新：项目结构（权威源声明+行数 4928/3129）、部署口诀（`workspace-files` → `D:/codes/tree-harness`）、BUG-2 状态（待修 → ✅已解决 07-09 会话 4fee5a45，vcb2 实证）

**关键修正（再次确认）**：BUG-2（leaf_add caller-binding）实际已于 07-09 下午修复并 pro 实证，多文档标「待修」是失同步。TH 权威源现已含修复。

**遗留（待用户决策）**：① workspace-files 旧源处置（废弃/降为镜像）② release dist 同步（落后 pro 较多，07-07 note 说暂缓）③ `workspace-files/.context/proma-dev-patches.cjs`（1078 行旧副本）清理 ④ `release/tree-system-v0.2.2/patch-l/`（3602/3025 行历史打包）标注过时。

## 🔖 2026-07-09 设计文件缺口分析 + 待改进报告（会话 bbdefd1e，5路 SubAgent 并行）

参照 nanju（`D:\Codes\multi-agent-collab-platform`）01-06 产品设计文档体系，5 路 general-purpose SubAgent 并行深读（A 产品定位 / B 架构API / C 方法论流程 / D 安全缺陷汇总 / E note.md 挖掘）+ 父会话交叉印证，产出两份报告（落 `D:/codes/tree-harness/.context/active/`）：

- **[design-files-mapping-2026-07-09.md](../../../../../../codes/tree-harness/.context/active/design-files-mapping-2026-07-09.md)** — 设计文件结构映射：对照 01-06 模板逐域评估，P0 缺口 6 份 + P1 缺口 10 份新建清单 + 文档治理建议。
- **[improvement-report-2026-07-09.md](../../../../../../codes/tree-harness/.context/active/improvement-report-2026-07-09.md)** — 待改进报告：13 条逻辑不自洽 + 36 条设计问题（P0-P3）+ 5 聚类根因 + Top7 优先级 + 推进路径三档。

**关键交叉印证修正（避免后续误判）**：
1. ✅ **BUG-2（leaf_add caller-binding）实际已解决**（07-09 下午会话 4fee5a45，vcb2 实证拦截生效）。`tree-harness/CLAUDE.md` + audtest 材料 + handoff 标「待修」是**文档失同步**（停留在 07-09 上午）。→ 归入 P1-D03。
2. ⚠️ **存在两个并行 `.context`**（`D:/codes/tree-harness/.context` vs workspace-files/.context），note.md 已漂移（tree-harness 版停 07-07，本文件到 07-09）。→ 归入 P1-D04，建议统一到 tree-harness 为唯一源。
3. ⚠️ **TaoWatcher「0 触发」需限定场景**：macp4-A4（auditor 错配）+ macp2/3/4 0 触发；但 vcb2 验证（07-09 18:20）中正常 worker 场景**多次触发**（W-01/W-08），证实 watcher 在 pro 确实运行。

**核心结论**：tree-harness 文档「安全加固/事故复盘/运维知识」极强，但「产品设计视角（PRD/类图/team-config）」缺位，Layer2（80% 代码）零用户场景处于「实现自证需求」。给系统性推进的三个抉择：① 文档治理 vs 功能加固先做哪个 ② 产品设计正向补建是否现在做 ③ TaoWatcher/auditor role 命运（救活/砍掉）。

## 🔖 2026-07-09 Harness 效率综合评估报告（完整交付，会话 4fee5a45）

**完整报告**: [active/harness-efficiency-assessment-2026-07-09.md](./active/harness-efficiency-assessment-2026-07-09.md)（brief 第八节全部 6 节 + 证据方法）

**裁决**: 强支持发起人假设"约束效率低且没完全约束好，逼会话找绕过出路"。核心发现——3 个约束（caller-binding / TaoWatcher / 预算护栏）**同构盲区**: 只覆盖 tree 内合规路径，对 `create_session` 绕过系统性无效。macp2 爆炸正利用此盲区（207 会话不入 tree，tree call-log 仅 25 条）。优化方向是**重新分配**约束（tree 内过度加固 → tree 外观测 + 状态篡改 caller-binding），非简单增减。

**附带产出**:
- leaf_add caller-binding 修复（workspace engine，66/0 零回归，**未部署** pro dist）
- 2 个新可利用盲区实证（set-status 跨身份杀 leaf / milestone-add 跨身份注入，3/3 坐实）
- autonomy_overrides 死字段发现（写而不读，限权放权 no-op）
- CLAUDE.md「macp2 靠引擎预算护栏堵」记录修正建议（实际靠 startup_notice+SKILL 红线）
- 3 个测试脚本（p1-leafadd-caller-binding / caller-binding-coverage-audit / 零回归套件）

**不确定性**: TaoWatcher 在 macp3/4（config 已启用）期间 0 触发的原因未定（log=console 不持久化）。建议动态验证。

**细节**: 见下方 4 个分项条目（预算护栏 / TaoWatcher / caller-binding 覆盖地图 / leaf_add 修复）。

**部署状态（2026-07-09 下午，已全部部署 pro dist，⚠️ 待用户重启 pro app 加载）**：
- `tree-engine.cjs` (dist): leaf_add caller-binding（3处）+ set-status/milestone-add caller-binding（6处）= 9处。备份 `.bak-pre-leafadd-caller-binding-20260709`。
- `patches.cjs` (dist): create_session 数量预算 `checkCreateSessionBudget`（2处：模块级常量+函数 / create_session handler 内调用，单 caller 60s ≤20）。备份 `.bak-pre-session-budget-20260709`。
- 验证: p1-leafadd 4/4 + p1-setstatus-milestone 6/6 + 零回归 76/0（p1-leafadd+p0-1 4+p0-3 19+iss003 13+subagent 30）+ budget 算法验证（20过/21拦/独立/无caller不限）+ node -c 全通过。
- workspace engine 同步（leaf_add + set-status/milestone-add）；workspace patches 未改（48KB 旧副本，dist 是 154KB 实际运行版）。
- CLAUDE.md: macp2 预算护栏记录已修正（行18，补"仅 tree 内治标 + create_session 绕过无效 + 新 budget 补丁"）。
- TaoWatcher 0 触发：静态验证 macp4 leaf 全合规（W-01 等 0 违规）→ 倾向"规则没命中"而非"watcher 没跑"，不确定性部分收敛（不敢 require dist patches 动态验证，会启动 watcher 巡检 pro trees 有副作用）。

**pro 实证验证（2026-07-09 17:00，pro 重启后，commander+observer 实跑）**：派 commander（`1cc25570`, GLM-5.2）+ observer（`06c9b305`, GLM-5.2）在 pro 实跑验证。结果三方一致：
- 🔴 **探针2 攻击 leaf_add**（added_by=observer，caller=commander）→ `E_BORROWED_IDENTITY [P1-cmdLeafAdd-caller-binding]` **精准拦截** ✓（leaf_add caller-binding 在真实 pro MCP 调用下生效，caller 由 pro MCP handler 注入，证实部署链路完整）
- 探针1 正向 leaf_add（caller=added_by=commander）→ ok ✓（不误伤合法 add）
- 探针3 milestone_add + 探针4 set-status 正向（commander 是 creator）→ ok ✓（不误伤 owner/creator）
- observer 交叉确认（tree_leaf_list_all）：仅 `verifycb-root` + `verifycb-A1-worker`，**无 `verifycb-A2-worker`**（攻击真被拦、A2 未落库）+ A1 active + plan event + M1 milestone ✓ — commander 汇报属实
- 结论：**caller-binding 部署生效 + 不误伤合法流程**。set-status/milestone-add 的攻击拦截由单元测试 6/6 覆盖（dist 代码 = workspace 验证代码），pro 正向不误伤已实证。create_session budget 未实跑（会烧钱，阈值 20，算法已验证 20过/21拦）。
- 测试树 `verifycb` 留 pro 作证据。commander 91s 完成（41067 input / 237888 cache）。

**pro 全面验证 vcb2（2026-07-09 18:20-18:35，commander+worker+observer 三会话）**：覆盖 caller-binding 全分支 + 完整 §13 done 流程。observer 最终交叉确认全绿：
- 🔴 **攻击拦截**（observer 跨身份）：set-status → `E_BORROWED_IDENTITY [P1-cmdLeafSetStatus-caller-binding]` ✓；milestone-add → `[P1-cmdMilestoneAdd-caller-binding]` ✓（新增验证；verifycb 只验了 leaf_add）
- **owner 放行**（worker=A1.session_id）：set-status/milestone-add A1 → ok ✓
- **creator 放行**（commander=A1.added_by）：set-status/milestone-add A1 → ok ✓
- 🔴 **完整 §13 done 八步全通**：建树→plan→leaf_add→milestone_add(M1/M2)→brief_echo→milestone_set_result(pass)→alignment 回填→落盘 deliverables→done event→audit_gate(pass, 信任锚闸门2)→set-status done → **A1-worker active→done** ✓（owner 放行 + 8 道门禁全过，无 DbC 拦截）
- 结论：新 caller-binding 约束在 §13 完整真实任务流下「该拦拦得住、该放放得过」，无逃逸无误伤。端到端部署链路（workspace→dist→pro 重启→MCP caller 注入→约束生效）证实。
- 🔴 **重要副产品（修正调研报告）**：TaoWatcher 在 vcb2 验证中**多次触发**（observer/worker 绑 leaf 后：W-01 首条无 brief_echo ×2 + W-08 worker 调写工具 leaf purity 违规 ×2）—— 实证 TaoWatcher 在 pro **确实运行**，之前 macp2/3/4 的 0 触发是 leaf 合规（非 watcher 没跑，确认 task12 的"规则没命中"假设）。但 **W-08 在本场景是误报**（worker 合法 owner 操作被当 leaf purity 违规）—— 呼应调研报告"TaoWatcher 假阳性"（已删 R-03/R-06/C-13/C-15；W-08 对 owner 合法操作也假阳性，待评估是否放宽）。
- 附带 bug：nudge_log ts 用 UTC（10:26Z）vs events ts 用 +08:00，时区表示不统一（小 bug）。
- 测试树 `vcb2` 留 pro（root active + A1-worker done + M1/M2 + 4 events + 4 nudge）。会话：verifycb2-commander(2369f684)/verifycb2-worker(f3776bb0)/verifycb-observer(06c9b305)。

**⚠️ 工作流缺口发现（2026-07-09，归档验证会话时）**：remote_create_session 创建的会话无法经 MCP 归档——remote caller 归档被 `R6-external-deny`（external 只能 send_message），pro internal 会话归档被 `DENY-legacy-no-lineage`（D5 P1：remote_create_session 创建时不写 parentSessionId → legacy session，互为 legacy 禁 archive/fork）。**根因**：patches.cjs create_session 行697"外部/automation 不写 parentSessionId" + R6/D5 双拦。**唯一可行路径**：pro UI 侧边栏手动归档（UI 直接改 sessions.json，绕过 MCP）。**影响**：主实例通过 remote-session 在 pro 批量创建的会话，清理需 UI 手动，无法自动化。待评估：是否给 remote_create_session 补可选 parentSessionId 参数（让远端会话建立 lineage，解锁 remote 归档）。归入 harness 演进 backlog。

## 2026-07-09 预算护栏评估 — 模式第三次验证（brief 第四节#5，会话 4fee5a45）

**两道护栏都在 tree 引擎内（只管入树操作）**：
- `E_TREE_NODE_BUDGET_EXCEEDED`（行1023，cmdLeafAdd）：active leaf 数 ≥ root_dod.node_budget（默认 20）→ 拒 add leaf
- `E_SUBAGENT_BUDGET_EXCEEDED`（行2047，cmdEventAppend subagent_spawn）：单 leaf spawn 数 ≥ max_subagent_spawn_per_leaf（默认 15）→ 拒

**create_session 无数量预算**：patches.cjs create_session patch（dist 行645-712）只有 ① workspace 校验 ② **delegationDepth 限制**（行680 `E_DELEGATION_TOO_DEEP`，防链式深递归）③ lineage/ownership（R1-R6）。**没有 max_sessions / rate limit / 数量预算**。

**macp2 爆炸绕过护栏（铁证）**：macp2 是 commander 把 create_session 当 reviewer **扁平重复创建**（每个 depth=1，不超 MAX_DELEGATION_DEPTH）→ delegationDepth 管不到；create_session 不走 tree_leaf_add/subagent_spawn → 两道 tree 预算护栏管不到。macp2 的 tree call-log 仅 25 条（leaf/add 7 失败 3 / validate 5 / set-status 5），而爆炸的 207 会话是 create_session 创建、**不在 tree call-log**（因 create_session 不入 tree engine）。

**🔴 模式第三次验证（caller-binding + TaoWatcher + 预算护栏同构）**：tree-system 的约束**普遍只覆盖 tree 内合规/声明路径**，对 `create_session` 等原生会话绕过机制**完全无效**。macp2 workaround 正是利用此盲区（用 create_session 绕过 tree_leaf_add 预算）。

**对 CLAUDE.md 记录的修正建议**：CLAUDE.md P0 教训写"macp2 后靠引擎预算护栏堵"——**部分不准确**。引擎预算护栏只堵"若 commander 走合规 tree_leaf_add/subagent_spawn 路径"的爆炸（20 leaf / 15 spawn）。macp2 实际走 create_session 绕过 → 引擎预算护栏无效。真正堵 create_session 绕过的是**行为约束**：startup_notice（引擎注入 tool 结果红线）+ SKILL §13.5/§4.6（教不用 create_session 当 reviewer）+ 进程内 SubAgent（给廉价替代）。这些是"治本"（改变行为），预算护栏是"治标"（限合规路径上限）。

**效率裁决**：预算护栏真实防护价值=中（堵合规路径爆炸，rvreq2/macp3/4 的 subagent_spawn 诚实路径有受益）；但对 macp2 型绕过=0。摩擦=低（默认值宽松，20/15）。归入"保留但别误信能堵绕过"档。

## 2026-07-09 TaoWatcher 效率评估（brief 第四节#1 / 第七节#4 重点，会话 4fee5a45）

**结论先行（对发起人假设"用户直觉 TaoWatcher 效率低"= 强支持，甚至更糟）**：TaoWatcher 在 pro 最近测试中**自动防护产出 = 0**，且有**先天设计盲区**（只巡检 tree 内 leaf，对"绕过树"的攻击无感）。

**实现现状**（patches.cjs Patch M，dist 已 require 加载）：
- 完整 TAOWatcher 类（行2219）+ Manager（行2316）+ 15 条 Tier1 零 IPC 规则（C-02/03/06/13, R-01/03/04/05/06 等）。
- tao-rules.json 定义 35 条（R1-6/C1-16/W1-13），engine NUDGE_RULE_WHITELIST 精简到 ~11 条（删 R-03/R-06/C-13/C-15 高噪音假阳性，CLAUDE.md 记录）。
- 启动：main.cjs 行570900 `require("./proma-dev-patches.cjs")` → 顶层 setTimeout(5000) 后 `startAll()`（行2750/2764）+ global.__proma__ 就绪检查 + 10s 重试。config `~/.proma/agent-workspaces/proma/workspace-files/tao-engine/config.json` 当前 **enabled=true**（mtime 7-08 13:47），interval 300s。

**🔴 0 触发铁证**：扫描 pro 全部 21 个 tree（macp2/3/4/rvreq2/macp-stab/cleanroom 等），`nudge_log` + `audit_log` + `drift_log` **自动触发全 = 0**。所有 nudge 都是 commander/observer **手动调**的（call-log caller_session_id 是真实会话如 dcaed801，非 tao-watcher-script）；macp4 甚至有手动 `nudge R-06 → E_STATUS_INVALID`（leaf 已 done）。

**时序铁证（解释 macp2）**：config.json enabled=true 的 mtime=**7-08 13:47**，而 macp2（207 会话爆炸）tree mtime=**7-08 00:24**（凌晨）→ macp2 爆炸时 watcher config **明确未启用** → 没跑 → 没拦。

**🔴 先天设计盲区（决定性，即便启用也拦不住 macp2 型）**：TaoWatcher 巡检 `tree-state.json` 的 leaves（行2263 扫 trees_dir + 行2623 只查 active/pending_brief leaf）。macp2 爆炸是 commander 用 `create_session` 当 reviewer，**207 会话根本不入树** → watcher 看不到 tree 外的会话爆炸。所以 macp2 型绕过攻击只能靠"引擎预算护栏 + SKILL §13.5 红线 + startup_notice"堵（CLAUDE.md P0 教训），watcher 先天无能为力。这与 caller-binding 覆盖盲区**同构**：约束只覆盖合规路径，对"绕过"裸奔。

**⚠️ 不确定性（部分收敛，2026-07-09 静态验证）**：macp3(14:38)/macp4(18:55) 在 config enabled 之后仍 0 触发。静态检查 macp4 全部 7 个 worker leaf——**对 Tier1 规则全部合规**（brief_echo/done/review_round/subagent_spawn 完整，W-01 等无违规）→ **倾向假设 (c) 规则 0 命中合理**（leaf 流程完整，watcher 即便跑了也抓不到违规）。但仍无法 100% 确认 watcher 实际运行（log=console.log 行175 不持久化；不敢 require dist patches 做动态验证——会触发 startAll→巡检 pro trees 写数据，有副作用）。一个异常线索：`macp4-W1-worker-s2` 状态 pending_brief 但有 done event（status-event 不同步），但这是 V10 collectValidateIssues 范畴非 TaoWatcher Tier1 规则，watcher 不抓它合理。综合：0 触发大概率=leaf 合规+规则没命中，不改变"TaoWatcher 实际产出 0"的裁决。

**效率裁决**：真实防护价值=0（最近测试）/ 摩擦成本=0（没跑）但**工程沉没成本高**（Patch M 全套实现 + 35→11 多轮精简 + 假阳性修复 + 运维）。归入 brief 第八节"重设计"档：要么补 file-log + 健康检查让它可观测可信任，要么承认它是"安全剧场"（看起来在防护，实际没产出）并砍掉减负。

## 2026-07-09 P1 修复 — cmdLeafAdd caller-binding 补全（leaf_add 路径身份借用漏洞，会话 4fee5a45）

**来源**：harness 效率调研（`active/research-brief-harness-efficiency-2026-07-08.md`）附带发现，独立深挖 callerSessionId 全链路后定位。

**Bug（真实 P1 身份借用）**：`engine.run` 第4参 `callerSessionId` 全程透传到 `dispatchLeaf(args, callerSessionId)`（行 4519），但 `dispatchLeaf` 的 `case 'add'`（行 4528）**漏传**给 `cmdLeafAdd`。cmdLeafAdd 现有防御（D2-B1 行 911）只验 `added_by`"树内存在"，**不验"调用者===added_by"**。后果：worker W(session=w-1) 得知树内 commander 的 session_id(cmd-1) 后，调 tree_leaf_add 声明 added_by=cmd-1 → 放行 → leaf 注册成"cmd-1 创建的"，污染溯源链 + 绕过 cmdLeafSetSession 的 isCreator 判断。

**调用链实证**：`run(cmd,args,treesRoot,callerSessionId)` 行4794 → `dispatch(...,callerSessionId)` 行4806 → `dispatchLeaf(args,callerSessionId)` 行4484 → `case 'add': cmdLeafAdd(rest)` 行4528 ✗。call-log 记 `caller_session_id`（行4808），callerSessionId 全程可信（done 路径 audtest 早已实证生效）。

**对照（已落地范式，唯独 leaf_add 漏）**：cmdLeafSetSession 行1743 / cmdEventAppend 行2022 / cmdAuditGate 行2997 / cmdMilestoneSetResult 行1930 都校验 caller binding。

**修复**（`workspace-files/tree-engine.cjs`，3 处，对齐既有范式）：
1. 行4528 `case 'add'` 透传 `cmdLeafAdd(rest, callerSessionId)`
2. 行816 签名 `cmdLeafAdd(args, callerSessionId)`
3. 行~864 加校验：`if (callerSessionId && added_by && callerSessionId !== added_by) throw E_BORROWED_IDENTITY [P1-cmdLeafAdd-caller-binding]`（CLI 不传 caller 跳过，向后兼容）

**验证**（`plan/p1-leafadd-caller-binding-test.cjs`）：A 攻击 caller≠added_by → E_BORROWED_IDENTITY（带标记）✓ / B 正向 caller===added_by → 成功 ✓ / C CLI 不传 caller → 跳过校验 ✓ / D worker 当 added_by → D2-B1 仍拦（caller-binding 不削弱角色校验）✓。
**零回归**：p0-1 4/0 + p0-3 19/0 + iss003 13/0 + subagent-lifecycle 30/0 = **66 通过 0 失败**。`node -c` 通过。

**状态**：workspace engine 已修+验证，**pro dist 未部署**（部署需 `cp → D:/Proma-dev/resources/app/dist/` + 用户重启 pro app，破坏性，待用户确认）。
**待办**：① 部署 pro dist（用户确认后）② caller-binding 是否还有别的漏传子命令（dispatchLeaf 全部 case 已核对：set-session/milestone/event/audit 均已透传，仅 add 漏，现已补全）。

### 2026-07-09 延伸 — caller-binding 覆盖地图（系统盘点所有写命令，回答上方待办②）

leaf_add 盲区引出系统盘点：grep 全部 `async function cmd*` 签名 + 读身份敏感命令内部校验。结论：**caller-binding 只覆盖了"身份声明"类操作（add/set-session/milestone-set-result/event-append/audit-*），完全没覆盖"状态/权限/结构篡改"类写操作**。callerSessionId 由 MCP wrapper（Proma app 主进程）注入（done 路径 audtest 已证生效），所以这些盲区在真实 MCP 调用下**都是可利用的**。

| 命令 | 接 callerSessionId | caller 校验 | 威胁等级 | 说明 |
|------|:-:|:-:|:-:|------|
| leaf add | ✓(07-09 修) | caller===added_by | 已堵 | 见上条 |
| leaf set-session | ✓ | caller===added_by/isRootSelf | 已堵 | 行1729 |
| milestone set-result | ✓ | caller===audit_session_id | 已堵 | 行1895 |
| event append(done) | ✓ | caller===leaf.session_id | 已堵 | 行1972 |
| audit gate / append | ✓ | caller===audit/auditor_session_id | 已堵 | 行2980/3100 |
| **leaf set-status** | ✗ | **无** | **中-高** | 任意 session 可把别人 active leaf → pruned/archived/pending_brief（STATUS_TRANSITIONS 行72 全允许）；active→done 被门禁拦（不能伪造完成），但能"杀死"别人 leaf。行1409 |
| leaf autonomy-override | ✗ | 无 | 低(死字段) | 见下：autonomy_overrides 写而不读 |
| leaf set-context / set-last-event | ✗ | 无 | 低 | 元数据篡改 |
| milestone add | ✗ | 无 | 低-中 | 任意 session 给别人 leaf 加垃圾 milestone（污染）行1844 |
| drift/heartbeat/segment/nudge append | ✗ | 无 | 低 | 审计/巡检记录，非身份敏感（nudge 有 rule 白名单行97） |

**🔴 附带发现：autonomy_overrides 是死字段**。grep 全引擎，`removed_can_decide` / `added_must_ask` / `autonomy_overrides` **只在 cmdLeafAutonomyOverride（行1808-1835）写入 + 初始化（771/1054），无任何读取/消费点**。即"限权/放权"机制在引擎层根本不生效——SKILL 若教 commander 用 autonomy-override 限权 worker，实际是 no-op。这是典型"摩擦成本>防护价值（=0）"案例 + SKILL/引擎不一致（CLAUDE.md P0 高发区），归入 brief 第八节优化建议"放宽/重设计"档。

**对发起人假设的初步证据**（brief 第二节"硬约束效率低"）：caller-binding 这一类约束**覆盖严重不均**——身份声明类层层加固（6 处），但状态篡改类（set-status 能杀 leaf）完全裸奔。说明约束是"哪里出过事补哪里"的打补丁式演进（leaf_add 是最新一例），而非系统设计。这支持"约束配置不高效"的部分判断，待其他约束（TaoWatcher/预算护栏）评估完出综合裁决。

## 🔖 新会话必读 — 交接文档（2026-07-07 会话 57f5aec1 → 新会话）

**继续 tree harness 修复迭代，先读**：[active/handoff-iteration-continue-2026-07-07.md](./active/handoff-iteration-continue-2026-07-07.md)
- 当前状态：4 轮迭代收敛，错误 24→1（96%），pro 完整部署，release 待
- 下一轮入口：A 部署 release / B 稳定性（DeepSeek 波动）/ C 进阶（多worker·review）/ D 体系遗留（ISS-006/007/010）
- 完整技术：[active/tree-harness-iteration-summary-2026-07-07.md](./active/tree-harness-iteration-summary-2026-07-07.md)
- **坑**：pro 用 `.proma-dev`（非 ~/.proma），SKILL 同步要 3 处；DeepSeek 执行波动需多 run 取中位数；会话冷启动慢；文档错误码必须 grep 引擎实际行为

## 2026-07-07 path 修复验证 — path 错误归零 ✓，但 DeepSeek 执行波动（会话 57f5aec1）

**测试**：pro commander（d833d78b，DeepSeek-pro）验证 §4 path 注释修复。测试树 vpro2。
**path 修复目标达成**：path 相关 E_SCHEMA_INVALID = **0** ✓（cleanroom2 的 1 个 path 错误消除，注释消歧生效，commit 9b11e16）。worker done，tree_validate **0 issues**。
**总错误 7**（非 0）：E_DUPLICATE_LEAF×1 + E_SCHEMA_INVALID×2(缺model/缺milestones，**非path**) + E_ALIGNMENT_NOT_VERIFIED×1 + E_AUDITOR_NOT_INDEPENDENT×2 + E_DELIVERABLE_MISSING×1。
**⚠️ 关键发现：DeepSeek 执行 SKILL 有波动**（cleanroom2=1 错误，本次=7，同 SKILL §13）。§13.3 前置表/§13.7 速查表帮助避开大部分错误，但非 100%（取决于 commander 读 SKILL 仔细程度 + 模型随机性）。
**下一轮方向**：① 更强 SKILL 引导（leaf_add 前置 checklist / 必填字段提醒）② 引擎层默认值（leaf_add 自动补 model/channel，减少必填字段摩擦）③ 多次 run 取错误中位数（而非单次）衡量稳定性。
**本轮迭代总结**：macp-stab 24 → cleanroom 15（3修复）→ 完整§13 cleanroom2 1（§13.3 最大贡献）→ path 修复 path错误0（总7波动）。4 commits（b594a32/c82bf3b/0600c37/9b11e16）。

## 2026-07-07 完整 §13 验证 — 错误 24→15→**1**（93% 降幅，会话 57f5aec1）

**测试**：pro commander（b5ff5c0c，DeepSeek-pro）+ observer（7945c327），完整新 SKILL §13（已部署 .proma-dev/default/skills）+ 新 help topics + bug 修复。测试树 vpro1。
**结果**：try-and-fix 错误 **1**（vs cleanroom 15 / macp-stab 24，**93% 降幅**）。worker done，tree_validate **0 issues**。
**三方对比**：macp-stab 24（旧SKILL+任务指令）→ cleanroom 15（旧SKILL+新help）→ 完整§13 **1**（新SKILL §13+新help）。
**§13 增量价值**：**§13.3 步骤前置条件表最大贡献**（caller+前置+漏做触发列，消除 E_BORROWED_IDENTITY/E_ALIGNMENT_NOT_VERIFIED/E_GATEKEEPER_REQUIRED/E_AUDIT_PREMATURE/E_SELFCHECK_INVALID/E_DELIVERABLE_MISSING/E_DUPLICATE_SESSION_ID/E_AUDITOR_NOT_INDEPENDENT/E_NAME_INVALID 等 14 错误）；§13.2 冷启动 auditor=root 消除死锁；§13.7 速查表"撞错即翻"。
**唯一残留**：E_SCHEMA_INVALID path 格式（§4 Step2 文档歧义：path 误填完整 leaf_id 而非路径段"A1"）。下一轮修 §4 path 说明可消。
**§13 被读取确认**：commander index 14 明确"已读取 SKILL §13 完整流程"，.proma-dev SKILL 含 §13.0-§13.7。
**报告**：[active/observation-cleanroom2-2026-07-07.md](./active/observation-cleanroom2-2026-07-07.md)（128 行）。本轮迭代收敛：24→15→1。

## 2026-07-07 洁净室测试 — 错误 24→15，3 修复生效，SKILL 部署缺口（会话 57f5aec1）

**测试**：pro commander（DeepSeek-pro，4abf02e6）+ observer（9a37323c）跑 macp-cleanroom（评估 06 test-plan），对比 macp-stab 基线（旧 SKILL+任务指令）。
**结果**：try-and-fix 错误 **24→15（-37.5%）**。worker done，tree_validate **0 issues**。
**3 修复完美生效**：① self_check schema 6→0（新 evidence 模板）② tao-watcher "undefined" 假阳性 0 issues（bug 修复）③ root alignment_pending=false（修复）。
**完全避开**：E_DUPLICATE_SESSION_ID 3→0 / E_AUDIT_PREMATURE 3→0 / E_SELFCHECK_INVALID 6→0（新 help topics 生效，commander 靠 how_to_worker_lifecycle 等）。
**部署缺口（已修复）**：pro 用 `.proma-dev` userData（非 `~/.proma`），新 SKILL 最初同步错路径（到 ~/.proma/default/skills），commander 读到 .proma-dev 旧 SKILL（无 §13）。已同步到 `.proma-dev/agent-workspaces/default/skills`（pro 真实路径，含 §13）。
**新发现（下一轮材料）**：① E_SCHEMA_INVALID path 字符串vs数组（6次，新雷区，需 help how_to_path_format + leaf_add schema 标注 path:string）② E_AUDITOR_NOT_INDEPENDENT milestone_set_result 缺 audit_session_id（3次，§13.3 前置表已覆盖但 SKILL 当时未生效）③ tree_id 命名不一致（tree_init 允许连字符但 leaf_add 禁，系统级）④ tao-watcher 小任务敏感（C-13 ≥4审查者/R-06 独立验证，对小任务过严）。
**预估**：完整 §13 + help 后错误 ~8（observer 预估，待重测验证）。
**报告**：[active/observation-cleanroom-2026-07-07.md](./active/observation-cleanroom-2026-07-07.md)（207 行）。

## 2026-07-07 pro 真实任务稳定性测试 — §13 解死锁实证（会话 57f5aec1）

**测试**：pro 实例 commander（DeepSeek-pro，64922c5f）+ 3 fork worker（macp-A1/A2/A3，DeepSeek-pro）跑真实文档评估（06 test-plan / 04 api-spec / 05 sprint-plan），用 §13 冷启动流程。观察员（4f84afd9，pro 近距）全程观察。
**结果**：**3/3 worker done**（alignment 90-95，audit_gate pass）。**§13 成功解开 alignment 死锁** — 对比 nanju-iter2 旧引擎 0/9 done + 11×E_ALIGNMENT_NOT_VERIFIED + 4×E_REVIEW_FORGERY → 现在 0 E_REVIEW_FORGERY / 0 E_AUDITOR_NOT_INDEPENDENT。
**引擎加固表现**：caller-binding 拦 commander 伪造 worker done ×3 ✓ / self_check schema 严格（6×E_SELFCHECK_INVALID，worker 摩擦大）/ audit_gate 时序保护 ×3 ✓ / milestone caller-binding 全通过 / 写操作 2-11ms 稳定无崩溃。
**pro 稳定性**：commander 9.2min 完成，291% context（95.6% cache 命中），26 次写无损坏，无超时/数据竞争。
**关键发现**：commander 用 fork 创建真实 worker（非兼演）；commander 协调消息在 worker 会话（自身 list_messages total=1，观察 commander 需聚合 worker 会话）。
**改进材料**：[active/observation-macp-stab-2026-07-07.md](./active/observation-macp-stab-2026-07-07.md)（观察员 252 行报告）。5 个问题：① self_check schema 摩擦大（SKILL/help 加 JSON 示例）② E_DELIVERABLE_MISSING 错误附路径 ③ tao-watcher audit_log auditor_session_id="undefined" bug ④ E_DUPLICATE_SESSION_ID help 强调独立 session ⑤ root alignment_pending 未清理。SKILL §13：流程清晰 ★★★★☆ 但操作顺序/错误码指引 ★★★☆☆（commander try-and-fix 24 次错误，15 次可靠更好文档避免）。
**下一轮 harness+loop 改进方向**：help 加 how_to_worker_lifecycle topic（fork→leaf_add→brief_echo→alignment→done(worker)→audit_gate(commander)→set_status）/ SKILL §13 加错误码速查表 + worker self_check 模板 / 修 tao-watcher bug / §13 顺序文档显式化 / trust anchor 模式作 loop 体系 worker alignment 标准解法。

## 2026-07-07 pro 引擎部署 + 端到端验证通过（会话 57f5aec1）

- **pro dist 部署**：cp workspace-files/tree-engine.cjs → D:/Proma-dev/resources/app/dist/（备份 `.bak-pre-p03-deploy-20260707`）+ 用户重启 pro。dist 有独立 tree-engine.cjs，**cp 即部署无需构建**（proma-mcp-server.cjs require 它）。
- **DeepSeek 端到端验证**（pro 会话 f388041a，因 GLM 卡换 DeepSeek-pro）：① **P0-3 状态机**拦截 done→active = `E_STATUS_TRANSITION_INVALID` ✓ ② **§13 死锁打破回归** W1 done，闸门2 放行 root（先 E_AUDIT_PREMATURE→补 done event 后过，符合 done 门禁顺序）✓ ③ milestone caller-binding + help 同步生效 ✓ ④ tree_validate **4 非阻断 issues**（1 name_invalid + 3 audit_log_integrity 历史模式）。
- **§13 死锁打破首验**（pro 会话 e91d1916, GLM-5.2）：root 当 worker auditor 全程走通，W1 pending_brief→done，闸门2 放行。**不依赖引擎改动**（用既有 resolveAuditorIndep 闸门2）。
- **release 暂缓**：用户选「先观察 pro 稳定性」再上 release。release dist 保持现状（只 SKILL 生效）。
- **⚠️ 观察点 — GLM channel**：pro 的 GLM-5.2 启动慢/间歇（验证会话 de873801 长时间零响应后恢复，DeepSeek-v4-pro 秒回正常）。疑 pro 重启后 GLM key/配置异常，**独立于引擎改动**。实际 tree 任务若全链 GLM 需注意；建议观察期用 DeepSeek 跑或先排查 GLM channel。
- **测试树**（留 pro 作证据）：test-deadlock-verify-20260707（§13 验证）+ test-p03-verify-20260707（P0-3 验证）。

## 2026-07-07 Tree Harness 完整改进 — L0/L1/L2 全层落地 + 收敛（commit b594a32，会话 57f5aec1）

在 568bebe（P0-2 SKILL 解法）基础上完成全层改进，3 路子 Agent 审计 + 洁净室盲测 2 轮收敛：

- **L0 死锁打破（SKILL/方法论，不改引擎）**：commander SKILL 新增 §13 冷启动信任锚流程（§13.0 caller 机制/术语、§13.3 步骤0-7 严格顺序、§13.3a auto_upgrade）+ §6/§4/§5 对齐 + methodology §2.3.1 信任锚第二层 + worker §3.4。
- **L1 引擎加固**：P0-3 状态机流转白名单（STATUS_TRANSITIONS + E_STATUS_TRANSITION_INVALID，堵 done→active/archived 复活）+ milestone caller-binding（堵场景D 攻击面：dispatchMilestone 透传 caller + cmdMilestoneSetResult caller 校验）+ help 同步（error_code_index 40 个/alignment_workflow 补 review_round/EVENT_TYPE 9 种/role_semantics 补白名单/session_liveness topic）。
- **L2**：待解决清单更新（ISS-005/008/009 已解，006/007/010 遗留）+ design.md 术语注。
- **验证**：iss003 13/13 + p0-1 4/4 + p0-3 19/19 + repro 场景A-F 语义自洽 + 洁净室盲测收敛。
- **交付**：[active/handoff-tree-harness-improvement-2026-07-07.md](./active/handoff-tree-harness-improvement-2026-07-07.md) §7。**未部署 dist**（待用户验证后再发）。

## 2026-07-07 P0-2 结论修正 — 引擎通道完备，死锁真因是 SKILL 协议误用（57f5aec1 会话）

**来源**：[active/handoff-tree-harness-improvement-2026-07-07.md](./active/handoff-tree-harness-improvement-2026-07-07.md)（并行会话 57f5aec1，3 路子 Agent 深挖 + repro 实证）

**核心修正**：07-04 中期评审 §二 P0-2「audit_gate 三重死锁（V5b+V10+信任锚）」结论**被实证推翻**：
- repro 实跑 10/10（`.context/plan/deadlock-repro.cjs`）：root 一人当 auditor、全程走 `resolveAuditorIndep` **闸门2**（tree-engine.cjs L2241-2255，root 当任意非 root leaf 的 auditor），worker 顺利 done，validate 整树通过
- **引擎通道完备，不需要改**。闸门2 冷启动可用（仅要求 rootLeaf status≠archived/pruned + events 非空）
- 死锁真因：**SKILL §6 协议误用** —— 教 commander「路线图 Agent 必须是独立 leaf」当 auditor，把 commander 推向 fork 独立 auditor leaf 走闸门3（V10-auditor-active 三连：自身 done 需 audit_pass → 需独立 auditor → 自己），无穷递归

**已落地解法**（SKILL，不改引擎，commit `568bebe`）：
- tree-commander §4：audit_gate pass 作为 set-status done 前置；auditor 选择决策（冷启动期 auditor=root.session_id 由 commander 自调走闸门2；正常期才派独立 leaf 走闸门3）
- 明确警告：冷启动期绝不要 fork 独立 auditor leaf

**对 07-04 P0-2 描述的修正**：本笔记下方 07-04 条目里「P0-2 三重死锁」是中期评审的**理论判断，已被 07-07 repro 实证推翻**。引擎 V-04「root 后门」实为闸门2 的正确设计（root 信任锚），非降级。C-b 决议的"形式待审"可由 root 信任锚流程合规满足。

**⚠️ 未亲自验证项**：repro 10/10 来自 57f5aec1 会话，本会话（0fbed5a1）未独立复跑。结论采信并行会话实证 + 闸门2 代码逻辑（L2241-2255 确实只校验 rootLeaf status/events，无递归要求）。

## 2026-07-04 P0-1 修复完成 — 恢复 done 门禁刚性（阶段 A 第一步）

**上游**：[tree-harness-midterm-review.md](./tree-harness-midterm-review.md) §二 P0-1（4 Agent 洁净室，4 源全中）| **交接**：[active/handoff-tree-harness-fix-2026-07-04.md](./active/handoff-tree-harness-fix-2026-07-04.md)

**改动**（`tree-engine.cjs`，15 增 24 删，净 −9 行）：
1. 删 `cmdEventAppend` 的 done event 自动同步 `status='done'`（原 line 1945-1953）—— P0-1 主体
2. **连带**删 `collectValidateIssues` 的 `status_event_mismatch` 前半段校验（原 line 2547-2557）—— 否则合规中间态被误报
3. 注释更新（3 处）

**⚠️ 关键发现：P0-1 不是报告说的"删 1 行"** —— 实测发现 `cmdLeafSetStatus`（line 1406-1419）要求 set-status done 前必须先有 done event，所以合规路径必然经历"done event 已写、status 仍 active"的中间态。只删 line 1952 会让 `collectValidateIssues` 把这个**合规中间态误报为 issue**（且阻断 archive）。必须连带调整校验。这正是交接文档陷阱#7（"修复时优先验证是否真生效，别只看代码存在"）。

**测试证据**（`PROMA_TREE_ENGINE=workspace-files/tree-engine.cjs`）：
- **P0-1 专项**（`.context/plan/p0-1-sync-fix-test.cjs`）：4/4 ✓
  - A：空 leaf 调 event append done，status 保持 `pending_brief`（漏洞已堵；修复前直接变 `done` 绕过 8 道门禁）
  - B：空 leaf set-status done 被门禁拦（E_SCHEMA_INVALID: milestones non-empty）
  - C：合规中间态 validate 无 `status_event_mismatch` 误报（连带修复生效）
  - D：端到端合规路径（配齐门禁 → done event → set-status done）成功
- **ISS-003 baseline**（`.context/plan/iss003-review-gate-test.cjs`）：13/13 ✓ —— P0-1 解锁 ISS-003 阶段一 review 门禁（从空转变为生效）
- **零回归证明**（stash baseline 对比）：v10-trust-anchor（18/6）和 dbc-spec（45/3）改前改后**完全一致**。失败用例是 workspace engine 相对 dist 的既有差异（v10 缺 `setSessionVerifier` 被 `E_INVALID_UUID_STRICT` 拦；dbc-spec 的 V4-b/V9-a/V9-b fixture 问题），与 P0-1 无关

**方法论**：写验证脚本实证漏洞 + stash baseline 对比证明零回归，对抗"删一行"的乐观假设。

**状态**：用户确认**暂不部署**（仅 commit + 文档），阶段 A 后续 P0-2/P0-3 完成后一起部署。dist 未动（备份 `.bak-pre-iss-deploy-20260704` 仍在）。

**后续（阶段 A 待办）**：
- **P0-2** 短期：SKILL 加 audit_gate 死锁期降级（C-b 合规化）；长期：信任锚 C3 全链路。⚠️ 复核点：上一轮认知"C3 已落地"，但报告说仍死锁 —— 需读 `resolveAuditorIndep`（行 ~2245）确认 commander 派独立 auditor leaf 是否仍死锁
- **P0-3**：状态机流转白名单 + `E_STATUS_TRANSITION_INVALID`；tao-watcher MCP 化（调 `tree_nudge_append` 而非直改 json）

## 2026-07-04 树形任务 harness 中期评价 — nanju 活案例

**完整报告**：[tree-harness-midterm-review.md](./tree-harness-midterm-review.md)

**方法**：4 个独立子 Agent（执行流 / 代码白盒 / 会话语义 / 设计对照）并行洁净室分析，互不通信，交叉印证。案例：南大 nanju 树（18 leaf，12 archived，1 done）。

**4 Agent 汇聚的 3 个 P0 设计漏洞**：
1. **done event 自动同步 status=done**（`cmdEventAppend` line 1945-1953）→ 架空 cmdLeafSetStatus 全部 8 道 done 门禁。B6 就是这样"done"的（milestones=[]/audit_gate=required/无 alignment）。**删 1 行即可恢复刚性**。四源全中。
2. **audit_gate 结构性不可达**：V5b+V10+信任锚三重死锁 → 13/13 worker alignment 缺失，靠 commander 发明 C-b 决议（设计外）绕过。代码层 root 后门（V-04）把独立审计降级为 root 单点信任。
3. **状态机零流转校验**：pending_brief→pruned 合法，三档纠偏在代码层零落地；tao-watcher 直改 json，escalation 是 dead code（B1 nudge_count=42 仍 active）。

**关键方法论洞察**：
- 「**门禁堆栈 vs 协议编队能力**」：门禁本身有效（23/48 error 正常拦截），崩溃在协议层 — commander 三波建 12 worker 都无法完成 alignment 回填+派独立 auditor 这两个"人对人"动作。A 系列 12 灭非任务难度，是同一形式门反复卡。
- 「**worker 优秀 / harness 拖后腿**」：worker（GLM-5.2）4/5 正确回 brief_echo、真跑 multi-sub-agent 自审、red 真归零；harness 9 个设计漏洞中 6 个高严重度。
- 「**纸面门禁**」：V5b/§14 审计树/milestone_add/三档纠偏/ctx 竹节交接 — 在 nanju 实战中**从未真正执行过一次**。

**中期评价结论**：骨架优秀（5 件套契约/心跳/命名/C-b 务实），但门禁刚性被一行代码（V-01）架空，存在多个"死的硬约束"+ 结构性死锁（validation+archive+budget）。逃生通道逼违规（commander 发明 C-b、root 直改 tree-state.json 违反铁律#1）。**需中期补丁而非渐进优化**。


## 2026-07-04 ISS-001/002/003/004 修复轮次（Tree 模式多会话协作）

**任务**：用户指令"看待解决问题文档→派子Agent调研设计→多轮审计迭代→修复→审计收敛"。4 个 ISS 全做，方案+改代码+部署验证，SDK SubAgent 协作。

**方法论闭环**（Tree 模式多会话协作，6 阶段）：
1. 调研 4 SubAgent 并行（各 ISS 设计方案初稿）
2. 对抗审计 4 SubAgent（找漏洞）+ ISS-003 二轮再审（确认致命伤 + 分阶段）
3. 迭代定稿 v2（综合审计反馈）
4. 实施（ISS-001/002/004 patches.cjs + ISS-003 tree-engine.cjs + 两份 SKILL）
5. 测试 SubAgent 写 ISS-003 验证（13/13）+ 代码审计 SubAgent 复核（无阻断）
6. 部署 dev/release dist 三份同步

**4 个关键反转/澄清**（审计价值证明）：
- ISS-002：title 假设证伪（renderer 纯 sessionId 匹配 `A.find(R=>R.id===sessionId)`，无 title 歧义）→ 改备选 A + toast
- ISS-003：worker 自调 G1-G5 是新造机制（现有 §14 是 commander 派 leaf）+ **events 自写性让纯结构校验失效**（worker 可自写合法 review_round 蒙混）→ 阶段一诚实标注 + 分阶段
- ISS-004：方案 B（process.on uncaughtException）**不消 Electron 弹窗**（Node 多 listener 并存，Electron 内置 handler 不被覆盖）→ 消弹窗靠 A + res.end try/catch
- ISS-003：checkSessionAlive 强校验会误杀 SDK SubAgent（无 Proma session_id）→ 取消，改为格式 + 非自审校验

**交付**：
- `proma-dev-patches.cjs`：ISS-001 validateWorkspaceId slug→id 兼容 + remote_create_session default 兜底 / ISS-002 navigate handler 预热+诊断+失效 toast / ISS-004 bridge socket on-error + res.end try/catch + uncaughtException 限定 EPIPE/ECONNRESET
- `tree-engine.cjs`（+150 行）：3 新错误码 + DEFAULT_AUDIT_META.review_required=false（opt-in）+ EVENT_TYPE_ENUM 加 review_round + isReviewRequired(leaf,state) + validateReviewRoundSchema（含 finding.item + red_count 交叉校验）+ done 门禁 review 校验 + cmdLeafAdd 父链 flagged 扫描 + cmdMigrate 规则 11
- tree-worker SKILL §4.6 + tree-commander §4 Step4（已同步顶层 skills/）
- 测试 `.context/plan/iss003-review-gate-test.cjs`（13/13，含 events 自写绕过 = 阶段一已知局限）
- 部署：workspace-files + dev dist + release dist 三份一致（patches 3109 / tree-engine 4315）

**ISS-003 阶段二 follow-up**（已写入待解决清单）：review_evidence 不可直接写字段 + cmdReviewRound 唯一写入路径 + Layer2 findings-产出文件相关性校验 + R-08 巡逻。阶段一是格式基线（和 self_check 同安全级），真正硬约束在阶段二。

**运行时验证清单**（重启 dev/release 实例后）：
- ISS-001：dev 调 `remote_create_session({instance:'release', channel_id:X})` 不传 workspace_id → 命中 release default 工作区，不再 E_WORKSPACE_NOT_FOUND
- ISS-002：造两个同名 title 不同 session_id 会话，tree 面板点击切换生效；会话失效时有红色 toast 提示
- ISS-003：建 review_required=true 的 tree（tree_init 传 `audit_meta.review_required:true`），worker 不跑 G1-G5 直接 done → E_REVIEW_NOT_CONVERGED；跑完收敛 → 放行
- ISS-004：密集 send_message wait=true + 中途 kill MCP client → 无主进程 EPIPE 弹窗

**关键教训**：
- **events 自写性是 Tree 体系的根本限制**——任何 events 级校验都只能防格式不防内容（和 self_check 同级）。真正硬约束需"worker 不可直接写的字段"（worker 走专门命令提交，引擎写字段）。这是阶段二的核心。
- 对抗审计多次反转初稿假设（title 假设、方案 B 消弹窗、checkSessionAlive 误杀、isReviewRequired 读 leaf.audit_meta 死代码）—— 多轮审计 + 测试是必要的，初稿方案不可信。
- migrate flagged 的 one-way ratchet 风险：未 opt-in 的树不应被强制（flagged 只在 review_required=true 时标，grandfathered 始终标）。

## 2026-07-04 session-cleaner 洁净室测试 3 轮迭代 — 收敛

**背景**：v1 脚本昨天落地后，派 4 个独立子 Agent 做洁净室测试（不透露实现者先验结论，各自独立验证）。3 轮收敛。

**收敛曲线**：

| 轮 | 视角 | 发现 / 修复 | 格式 B 保真度 |
|----|------|------------|---------------|
| R1 | 4 Agent 并行（黑盒/白盒/对抗/金标准） | 抓到 1 个 P0 + 5 个 P1。最致命：`_merge_b_assistant` 里 `all_texts` 是死变量，**42% 回合丢文本（12474 个），累计丢 135 万字符** | 37% → 90% |
| R2 | 独立复核 | R1 六项全 PASS；又抓 2 个：① best_text 取"最长"在 Z.ai 工具交错回合丢叙述（**我修复时引入**）② ×N 折叠误并不同 input（**我 R1 误判为 P3，实证 462 处**） | 90% → ↑ |
| R3 | 最终复核 | R2 两项全修复（12474 回合全恢复、误折叠 462→0）；新函数白盒无 bug；无新问题 | 收敛 |

**最终修复清单（clean_session.py）**：
1. [P0] `_merge_b_assistant` text 补全：从"取最长"改为"最后一行 text 优先；无则前缀去重并集兜底"
2. [P1] `_summarize_tool_input` 加 `isinstance(inp, dict)` 守卫（防 list/str/int 崩 `.items()`）
3. [P1] 文件打开 `utf-8` → `utf-8-sig`（自动 strip BOM，原静默判空）
4. [P1] `--out` 的 `mkdir` 包 try（PermissionError/FileExistsError/NotADirectoryError）
5. [P1] `content = msg.get("content") or []`（None 防御）
6. [P2] `detect_format` 跳过首部无法识别行重试（原整文件判废）
7. [P1] 新增 `_dedup_texts`：前缀去重保留独立多段（修 Z.ai 交错回合）
8. [P1] 新增 `_fold_key` + `collapse` 基于 input md5 哈希折叠（修 ×N 误并）

**关键教训 — 确认偏误**：我昨天测 `00b0d864` 只看了开头几十行的分段结构就判定"解析有效"，漏掉了 P0。4 个独立 Agent 从白盒（读代码）和金标准（对比语义）两个完全不同的角度交叉命中同一个 bug。多轮迭代的价值：R2 又抓到我修复时引入的新问题（best_text）和我之前的误判（×N 折叠），R3 验证收敛。

**当前状态**：v1 脚本生产可用。保真度 格式 A ≈ 93%、格式 B ≈ 90-95%。`--all` 586 文件 ≈17.6s、0 失败。R3 留有独立验证脚本在 /tmp/r3/（已清理或会话后失效）。

## 2026-07-03 23:53 session-cleaner.zip 能否在当前项目使用 — 分析结论

**背景**：`workspace-files/session-cleaner.zip`（v1.0.0, MIT, 9504B, 6/25）是会话清洗 skill 的原始打包。`skills/session-cleaner/` 下已装有**更新的 v2.0.0**（AGPL-3.0, 7/3）。需判断"能否在当前目录项目使用"。

**两版本质差异**：

| 维度 | zip v1.0.0 | 已装 v2.0.0 |
|------|-----------|------------|
| 形态 | 纯 Python 脚本 `clean_session.py`(392行) + 格式spec | `proma` CLI 的**薄封装**（SKILL.md + cli-usage.md，**无脚本**） |
| 依赖 | 仅 Python 标准库，零第三方 | 依赖 `proma session` 命令（来自 `@proma/session-core` + `apps/cli`） |
| 用法 | `python clean_session.py <id> --out dir` | `proma session info/outline/search/export` |
| 维护性 | 独立重抄会话格式，会随内部格式漂移 | 格式知识只存一处（core 包），健壮 |

**当前项目环境事实（决定性）**：
- workspace-files **不是** Proma 源码 monorepo —— 无 `apps/cli/`、无 `packages/session-core/`、无 `default-skills/`
- `which proma` → **不在 PATH**
- ⇒ **v2.0.0 在当前环境跑不通**（它的 SKILL.md 会诱导调 `proma session`，必然 `command not found`）
- 但 Python 3.14.3 可用，`~/.proma/agent-sessions/` 有 586 个 jsonl / 913MB

**实测 v1（用真实会话 00b0d864, 400KB）**：
- ✅ 解析逻辑对当前格式**完全有效**：400KB 原始 → 20.8KB 干净 Markdown（压缩 ~95%），`## 用户`/`## 助手` 分段正确，工具调用折叠、thinking/tool_result 丢弃均生效
- ✅ `--out` 写文件模式正常（脚本用 `write_text(md, encoding="utf-8")`）
- ❌ `--stdout` 在**中文 Windows 控制台会崩**：`UnicodeEncodeError: 'gbk' codec can't encode '⚠'`。根因：`sys.stdout.write(md)` 未指定编码，stdout 走 GBK。**解法**：优先用 `--out`，或 `PYTHONIOENCODING=utf-8 python ... --stdout`

**结论**：
1. **能用的是 zip 里的 v1**（自包含、当前环境可直接跑），**不是 skills/ 里已装的 v2**（缺 proma CLI 跑不通）。
2. v1 唯一问题是 Windows stdout 编码 bug（一行 `sys.stdout.reconfigure(encoding="utf-8")` 即可根治），不影响 `--out` 文件输出。
3. **隐患**：skills/ 下装的 v2 SKILL.md 会误导 Agent 调不存在的 `proma` 命令，建议在当前环境用 v1 覆盖，或显式标注 v2 依赖未满足。

**测试产物**：已在 /tmp 解压与验证，未污染工作区。

**落地（2026-07-04，按"v1+v2 共存+fallback"方案）**：
- `skills/session-cleaner/` 补入 v1 的 `scripts/clean_session.py` + `references/session-format-spec.md`，v2 的 SKILL.md / cli-usage.md 原样保留 → 4 文件共存
- 修掉 v1 的 Windows stdout GBK 崩溃（`sys.stdout/stderr.reconfigure(encoding="utf-8")`，带 AttributeError 兜底）。回归实测：原崩溃的 `--stdout` 现退出码 0、中文正常；`--out` 仍 20811 bytes 正常
- SKILL.md 在"历史"注释后植入 `> ⚠️ Fallback` 段落：`which proma` 不存在时改走 v1 脚本，附完整命令
- 当前环境用法：`python skills/session-cleaner/scripts/clean_session.py <id> --out cleaned/`


## 2026-07-03 20:32 Tree 面板 UI 改进 — 会话名词化 + 联动下拉框 + combobox 根治

**改动（release dist + 同步 dev/workspace-files/发布包，md5 一致）**:

1. **leaf 节点 session_title 化**（人友好）：patches.cjs `get-tree-states` 用 listAgentSessions 建 session_id→title map 给每个 leaf 附加 session_title；proma-tree-view.js leaf 节点显示 `session_title` 为主 + `leaf_id` 小字附加（Agent 友好），tooltip 含完整 session_id。

2. **tree 横条 title 化**：handler 给 tree 附加 `title`（优先级 root session_title > root_brief.my_mission > tree_id）；横条/下拉显示 title，tooltip 保留 tree_id。

3. **两层联动下拉框**（替换横条 bar）：workspace + tree 两个 combobox 左右并排，带搜索匹配（getLabel/getValue includes），选 workspace 联动刷新会话列表。解决横条多时后面难选。

4. **navigate-to-session 补 title**：patches.cjs 传 `{sessionId, title}`（与 Proma 内置 openAgentSession 一致）。**注：同名 title 会话切换仍未完全解决**（renderer 可能用 title 匹配 tab，待找纯 sessionId 切换 IPC）。

5. **combobox 根治缩回/不切换**（子 Agent 审计 + 重写）：
   - 根因：poll 每 3s fetchData→render→`treeTabsEl.innerHTML=''` 销毁 combobox DOM → list 缩回 + mousedown→click 间 list 没了导致 click 丢失（树选不切）
   - 修复：renderTreeTabs 复用 `_wsCombo`/`_treeCombo`（不重建，`_updateCombo` 只更新数据）；项 `onMousedown preventDefault`（click 必达 onSelect）；document 级 mousedown 外部关闭（不用 blur 隐藏）；open 时 `pausePolling`（双保险）
   - 诊断教训：handler 崩溃/combobox 异常无明显错时，appendFileSync 逐层诊断定位；子 Agent 独立审计避免主会话反复盲改

**关键文件**: release dist `renderer/assets/proma-tree-view.js` + `proma-dev-patches.cjs`；备份 `*.bak-pre-treeview-fix-20260703` / `*.bak-pre-diag-20260703`。git 提交 workspace-files 副本 + 发布包 + note。

---

## 2026-07-03 Layer A+C — 引擎统一 call_log + 聚合分析工具（消盲区 + 可分析）

**起因**: Layer B 止血后，被拦调用（安全事件）仍**只在会话 JSONL、引擎层无记录（盲区）**，且日志散落/半结构化/按会话而非按 tree，分析成本高。Layer A 消盲区，Layer C 聚合分析。

**Layer A（引擎统一 call_log）**:
- `run()`（tree-engine.cjs:3931，统一 choke point，MCP/CLI 共用）注入：每次 `mcp__tree__*` 调用（**成功+失败都记**）写 call-log.jsonl per tree
- 字段：`ts/cmd/sub/tree_id/leaf_id/caller_session_id/ok/error_code/elapsed_ms/args_digest/read_only`
- 存储：独立 `call-log.jsonl`（append-only，不进 tree-state 避免全量写 10ms+ 性能炸弹）+ 轮转 10MB×3（40MB/树上限）
- 范围：全记 + readOnly 标记（只读可过滤 = "只记写"的所有好处）
- 金标准：`PROMA_CALL_LOG=0` 关闭测试环境（dbc-spec/audit-attacks 走 run 不传 caller）
- 铁律：appendCallLog/extractIds 双层 try，**观测层绝不炸业务**
- `args_digest`：ID/枚举完整记，`--json` 只记顶层 key（隐私+体积，不记任务内容）

**Layer C（聚合分析 `scripts/tree-analyze.cjs`）**:
- **P0 安全事件**：被拦调用按 error_code 聚合 + HIGH_RISK 白名单（E_BORROWED_IDENTITY/E_AUDITOR_NOT_INDEPENDENT/E_SESSION_NOT_ALIVE 等）+ 归因（top trees/leaves/callers）
- **P1 时间线**：call_log + tree-state(events/audit_log) 按 ts 合并排序 → 统一事件流
- 输出：stdout JSON + stderr Markdown，`--tree/--dimension/--since/--json` 过滤
- 数据按 tree 聚合（非按会话），消除"散落/半结构化"痛点

**验证**:
- 金标准**零回归**（改前改后 25/14 一致，PROMA_CALL_LOG=0 时 SANDBOX 无 call-log 污染）
- Layer A 动态 **3/3**：V1 只读调用记 `{ok:true,read_only:true,elapsed_ms:4}` / **V2 消盲区核心**（B1 拦的 E_STATUS_INVALID 被 call-log 记）/ V4 观测层吞错不炸业务
- Layer C 跑通：P0 正确识别被拦（归因 tree/leaf/caller）+ P1 时间线聚合

**关键文件**: tree-engine.cjs（Layer A，release+workspace-files cmp 一致）| scripts/tree-analyze.cjs（Layer C）| 备份 `*.bak-20260703-pre-calllog` | call-log.jsonl 已 gitignore

**闭环测试（19:0x，重启 release 后 + 真实子Agent）**:
- 建 `e2eac` tree + 派 worker 子Agent（`46bb3380` glm-4.5-air）走派遣流程（create_session + send_message + wait）
- **Layer A 运行时**：记录 8 条 call-log（成功+失败都记，含 milestone `E_SCHEMA_INVALID` 失败 = **消盲区实证**）
- **Layer B 运行时对照**：nudge done leaf（`l1fix_v2-C1`）→ B1 拦 `E_STATUS_INVALID`；nudge pending_brief leaf（`e2eac-A-worker`）→ 放行（count=1）
- **Layer C 闭环**：`tree-analyze` P0 正确聚合 B1 拦截 ×2（归因 `l1fix_v2-C1-consistency`）+ P1 时间线含失败调用（milestone 字段名错→修正）
- **三层协同串联验证通过**：`B1 拦截 → call-log 记录 → tree-analyze 聚合` ✅

**剩余 / follow-up**:
- ✅ ① 重启 release（已完成，Layer A 运行时生效）
- ② Layer C **P2**（会话血缘视图）+ **P3**（收敛诊断）后续
- ③ `audit_log` 刷爆清理 follow-up（与 nudge 同步累积）
- ④ **`caller_session_id` 记的是会话目录 ID（`1e67e61f`）非 agent session_id（`ee435ed8`）** — patches.cjs MCP wrapper 注入点问题，影响 Layer C P0 归因精度。修在 patches.cjs callerSessionId 来源（最值得修，P0 归因根基）
- ⑤ **worker 子Agent `E_TREE_NOT_FOUND`** — worker 会话 tree 工具 trees_dir 与 commander 不同（workspace 解析，老问题，note 17:45/20:00）
- ⑥ **`E_TREE_NOT_FOUND` 时 call-log 写不到** — Layer A 边界：appendCallLog 用 `treeDir(tree_id)`，tree 不存在则目录不存在→吞错。可加 orphan fallback log（`_orphan-call-log.jsonl`）

---

## 2026-07-03 17:57 Tree 面板入口修复 — 三层根因（renderer / preload / catch 笔误）

**现象**: release 0.13.16 tree 面板入口丢失，层层修复后恢复。

**三层根因（按修复顺序）**:
1. **renderer 注入漏**（迁移坑6）: release `renderer/assets/` 缺 `proma-tree-view.js`+`.css`（dev 有），`index.html` 缺补丁L `<link>`+`<script>` 标签（dev 行34/39有）。修复: 拷 dev js+css → release assets，index.html 注入标签（照 dev 补丁L 格式）。备份 `index.html.bak-pre-treeview-fix-20260703`。
2. **preload 桥接漏**（迁移坑7）: release `preload.cjs` 缺补丁L `promaTreeIpc` 桥接段（dev 行1998-2037 `exposeInMainWorld("promaTreeIpc", promaBridge)`）。proma-tree-view.js 找不到 `window.promaTreeIpc` → "IPC不可用请检查preload"。修复: preload.cjs 末尾注入补丁L桥接段（dev 原样，dev/release preload 结尾结构一致都用 `import_electron`+`exposeInMainWorld("electronAPI")`）。备份 `preload.cjs.bak-pre-treeview-fix-20260703`。
3. **readTreesFromDir catch `workspace_slug` 笔误**（源头bug，迁移后首次暴露）: `patches.cjs` catch 块 `trees.push({..., workspace_slug, ...})` — `workspace_slug` 是 ReferenceError（参数是 `workspaceSlug` 驼峰）。被损坏的 `tree-2/c26c2x/tree-state.json`（JSON position 1 异常，疑 BOM/双写）触发: 解析失败→catch→ReferenceError→从 catch 向外抛→handler 整体崩溃→ok:false→面板"找不到树结构"。**dev/release/workspace-files/发布包 4 处全修** `workspace_slug`→`workspace_slug: workspaceSlug`。

**诊断方法论（复用价值高）**: handler 崩溃无明显错时，在 入口/discover/currentSlug后/循环后/外层catch 用 appendFileSync 写诊断文件，逐层定位执行到哪 + 抛错 stack。本次 4 轮（ENTRY→discover→[A][B]→外层catch记stack）定位到 `readTreesFromDir:1800 ReferenceError`。诊断完从 `bak-pre-diag` 恢复 patches.cjs 干净 + 只打 bug 修复。

**未修（不阻塞）**: 损坏的 `tree-2/c26c2x/tree-state.json` + `undefined/c26c2x` 副本（handler 现标 error 不崩，该 tree 显示 parse failed）。

**0.13.16 迁移坑累计 8 个**（17:45 记 1-5 + 本次 6-8）: 6 renderer tree-view 注入漏 / 7 preload promaTreeIpc 桥接漏 / 8 readTreesFromDir catch workspace_slug 笔误（源头 bug，迁移后因 tree-2 损坏 tree 首次暴露）。

---

## 2026-07-03 Layer B 止血 — TAO nudge 失控修复 + 11.4万垃圾清理

**起因**: 检查 TAO Watcher 日志发现严重不正常 — nudge 熔断失效（`l1fix_v2-C1-consistency` `nudge_count=2810`，7 个 done leaf 被刷爆），proma workspace 累积 **113,889 条垃圾 nudge_log**。TAO automation 当前 `active=false`（06-19 后停用）。

**根因 3 条**:
1. `cmdNudgeAppend`（tree-engine.cjs:2828）入口**无 leaf.status 检查** — 7-strike 标 pruned 后入口未挡，done/pruned/archived 终态 leaf 仍被反复 nudge
2. 入口**未调用 checkSessionAlive** — session 已死的僵尸 leaf 被 TAO 无限催办（永不响应）
3. 历史 11.4 万条垃圾（B9 修复前 + 失效期累积）未清理

**修复（B1+B2+B3，TAO 保持 `active=false` 只修代码不启用）**:
- **B1**（cmdNudgeAppend 行2862 后）: 入口拒终态 leaf（done/pruned/archived → `E_STATUS_INVALID`），放行 active/segment_pending/pending_brief
- **B2**（紧接 B1）: 入口 `checkSessionAlive` 三态（verifier 明确 false → `E_SESSION_NOT_ALIVE`；bypass 放行 CLI 兼容），堵僵尸 leaf
- **B3**（`scripts/nudge-cleanup.cjs`）: 清理历史垃圾，threshold=7/keep=5，dry-run 默认 + 原子备份，只动 nudge_log/nudge_count

**验证**:
- 金标准 dbc-spec **改前改后完全一致**（25/14 baseline，零回归 — 14 个失败是已知口径差异，与 nudge 无关）
- B1/B2 动态 harness **4/4**：done leaf 拦(E_STATUS_INVALID) / verifier=false 拦(E_SESSION_NOT_ALIVE) / verifier=throw 放行(bypass) / no-verifier 放行(bypass)
- 清理 **113,532 条**（19/37 tree），l1fix_v2 23MB→10MB，`nudge_count=5/nudge_log=5` 保留最近 5 条，**其他字段完好**（events/audit_log/milestones 不动），幂等（再跑 total=0）

**关键文件**: tree-engine.cjs（B1+B2，release + workspace-files md5 一致）| scripts/nudge-cleanup.cjs（B3）| 备份 `*.bak-20260703-pre-*` | 计划 `.context/plan/`(会话级)

**剩余**:
1. **重启 release 实例**让 B1/B2 运行时生效（dist 已改，运行中是旧代码 — 下次任何 nudge 调用走旧逻辑）
2. `audit_log` 也被刷爆（l1fix_v2-C1 audit_log=2810，与 nudge 同步累积），**本次未清**（需区分有价值审计 vs 刷爆产物），留 follow-up
3. Layer A（引擎统一 call_log 消除被拦盲区）+ Layer C（聚合分析工具）留后续

---

## 2026-07-03 工作状态恢复核实 — R4 已被三层根治超越，根治任务实质完成

**会话恢复核实结论**（读 R4-justification + note.md + 实机核对 git/dist/进程）:

1. **R4 修复无需执行**：R4-justification（06-27 17:10）论证的占位 UUID 攻击链修复（R4-P0-A/B：cmdLeafAdd session_id strict + cmdAuditAppend 占位拒绝），在当天 17:45 被 release 0.13.16 迁移的三层根治方案吸收并超越。层2 的 `assertMcpEntrySessionId` + `checkSessionAlive` 真实性 verifier 比 R4 的"MCP 入口占位拒绝"更彻底（占位/伪造 UUID 现返回 `E_SESSION_NOT_ALIVE`）。19:43 代码审计确认 cmdLeafAdd #5/#6/#7 占位跳过删除 + cmdAuditAppend #16 真实性 已落地，无 P0。**R4 文档现作历史论证留存，不再执行其原方案。**

2. **补记 06-27 20:00 之后的端到端验证**（此前 note.md 漏记）: 20:49–22:05 又跑了 `e2ep1` / `e2ep1rt` / `e2etree` 三棵验证 tree —— 是 P1 补强（commit `4cee874`）后的大规模回归验证（e2etree 的 E-auditor 写 462 条 audit_log、E-worker-s1 写 456 条）。

3. **今日 07-03 实机核实**:
   - P1 补强代码 ✅ 在 `workspace-files/tree-engine.cjs`（`caller===added_by` L1426、`caller===auditor` L2716、dispatch 透传 L3729）
   - release dist ✅ **已同步**（`D:/Proma-release/resources/app/dist/tree-engine.cjs` 与 workspace 副本 md5 一致 `8debc46...`，含 55 处 callerSessionId）
   - Git ❌ **仍未 push**（`orphiczhou/proma-patches`，分支 `release-0.13.16-hardening`，网络仍间歇 `Connection reset`）

**剩余收尾进展（07-03 11:40 更新）**:
- ① git push ✅ **已完成**：网络恢复后首次重试即成功，3 commit（`2b9a45b` / `4cee874` / `19cde23`）推上 `orphiczhou/proma-patches`，新建远端分支 `release-0.13.16-hardening`。
- ② release 重启 + P1 运行时验证 ✅ **已完成（铁证）**：用户重启 release 实例后，建 `p1chk` tree 实测 `cmdAuditAppend` P1 补强（commit `4cee874` / engine L2716）：
  - **控制组**：caller(`ee435ed8`) === auditor(`ee435ed8`) → `ok:true`，audit_log 正常写入
  - **拦截组**：caller(`ee435ed8`) 借用 `1cba319d` 当 auditor → `E_BORROWED_IDENTITY` 拦截，msg 含 P1 特征串 `align with audit_gate caller binding`
  - 证明 patches.cjs MCP wrapper `callerSessionId` 注入 + engine `dispatchAudit` 透传 + `cmdAuditAppend` caller!==auditor 拦截 **全链路在 release 运行实例生效**（不只 dist 同步，是运行时行为）。
- ③ 非阻塞 follow-up（**未做**）：dbc-spec 口径核对（45/3 vs 25/14）/ `audit_append` undefined 脏条目 / `get_session_info` 不暴露血缘字段。

---

## 2026-06-27 20:00 端到端验证闭环 + P1 防借身份补强 → 整个任务完成

**端到端验证（4 Commander 子Agent群，release 实例重启后）**:
- A 功能联调：session 工具 8/8 + tree 全流程 + **leaf_add 真实 session 零误伤**（3个真实session全通过 cmdLeafAdd 真实性校验）
- B 攻击重放：**6/6 全拦截**（伪造/占位UUID→E_SESSION_NOT_ALIVE、越权send→E_NO_OWNERSHIP、链式fork第11层→E_DELEGATION_TOO_DEEP、worker当auditor→E_AUDITOR_NOT_INDEPENDENT、占位/伪造UUID当auditor→E_SESSION_NOT_ALIVE）
- C 金标准+血缘：audit-attacks/audit-extra 零绕过 + 血缘6字段（parentSessionId/forkedFromSessionId/delegationDepth/triggeredBy/sourceAutomationId/ownerGrantedAt）全部落盘 agent-sessions.json
- D 代码审计：根治核心无P0，发现P1残留（详见下条目19:43）

**P1 防借身份补强（commit `4cee874`）**: cmdLeafSetSession caller===added_by（堵夺leaf所有权）+ cmdAuditAppend caller===auditor（对齐cmdAuditGate L2572）+ D5老会话收紧（仅send allow）。**根因：MCP wrapper tt helper 已透传 callerSessionId，engine dispatch 此前只路由 event/audit-gate，cmdLeafSetSession/cmdAuditAppend 收不到——现已补齐**。攻击重放12/12 + revert对照（复制改后版本回退8处编辑得基线对比）证明 dbc-spec 零退步。

**Git**: 分支 `release-0.13.16-hardening`，2提交（`19cde23` 迁移根治 + `4cee874` P1补强）本地，push 待网络（Connection reset）。

**剩余事项**: ①重启 release 让 P1 生效（dist已改，运行中实例是旧的）②Git push 待网络恢复 ③follow-up 非阻塞：dbc-spec 口径核对（Commander C 报45/3 vs P1子会话报25/14，疑 dbc-spec.cjs 副本含/不含 mock verifier 差异，引擎零退步已证）、audit_append 失败残留 undefined 脏条目、get_session_info 不暴露血缘字段（增强建议）。

---

## 2026-06-27 19:43 身份冒用三层根治 — 代码审计结论（review 子 Agent）

> 纯读码审计（不跑运行时），对照设计文档 `layer1-hardening-design.md` + `layer2-tree-engine-design.md`。
> 审计文件：`workspace-files/proma-dev-patches.cjs`、`workspace-files/tree-engine.cjs`。

**总体结论**：层1/层2 根治目标（R1-R6 ownership、K1-K3 血缘、session 真实性校验、UUID 统一）**全部正确落地，无 P0 漏洞**。身份注入链可信（L1590 闭包注入 + L1370 外部 null），命名铁律（D6）保持，C-15 未受影响。**3 个残留攻击面（P1×2 / P2×2 / P3×2）+ 1 个风格问题**，集中在"防借身份（caller===auditor/owner）覆盖不全"和"D5 老会话兼容过宽"。

### 层1 patches.cjs — 全部 ✅ 合格
| 审计点 | 结论 | 行号 |
|---|---|---|
| R1自循环/R2下行/R3上行/R4多跳 | ✅ | L323-337 + isAncestorOrDescendant(L240)带环保护+depth上限 |
| R5系统特权 | ✅ | isSystemPrivileged(L273)，**D2关键修正**：用 sourceAutomationId 识别 automation（不经 handler），只 send，同workspace |
| R6外部降级 | ✅ | L291-298 D1-A：外部仅 send，fork/archive deny |
| K1 create 写血缘 / K2 fork 写血缘 | ✅ | L657-669 / L764-771（内部才写 parentSessionId，外部不写防冒认） |
| depth 防递归 / 命名铁律 D6 | ✅ | L642-652+L703-708 预检；C-15(L2823)未受影响 |
| K7 notify 回调免疫 / 身份注入可信 | ✅ | L995-1002 onComplete不经handler；L1590闭包注入 |

### 层2 tree-engine.cjs — 真实性校验 ✅，2 个 caller 绑定缺口 ⚠️
| 审计点 | 结论 | 行号 |
|---|---|---|
| assertMcpEntrySessionId 三态(D1-a verifier优先) | ✅ | L190-215 |
| checkSessionAlive 三态 / setSessionVerifier 注入 / patches.cjs verifier | ✅ | L3846-3852 / L3840 / patches L1472-1480 |
| #5/#6 cmdLeafAdd / #7 占位跳过删除 | ✅ | L797/L808/L858 |
| #9 cmdMilestoneSetResult / #10 resolveAuditorIndep | ✅ | L1561格式+L1585 resolveAuditorIndep(L2101 verifier + L2111 树内leaf交叉校验=纵深防御) |
| #15 cmdAuditGate | ✅ | L2558格式 + **L2572 caller===audit（比verifier更强）** |
| #11/#12 collectValidate / #13/#14 占位跳过删除 | ✅ | L2259/L2285/L2408 |
| #16 cmdAuditAppend 真实性 | ✅ | L2684 verifier |
| #17 cmdValidate 回填 | ⚠️ P3风格 | L3093 用 UUID_RE 而非 assertValidatePathSessionId（validate只读，语义等价） |

### 新攻击面清单（按严重度）
| # | 攻击面 | 严重度 | 根因 | 修复成本 |
|---|---|---|---|---|
| **1** | **D5 老会话兼容过宽** | **P1** | assertOwnership L343-348：两个无 parentSessionId 的老会话间**全 allow**（send/fork/archive）→ 迁移期身份冒用残留窗口 | 低（收紧为仅 send allow+audit，与 R6 对齐） |
| **2** | **cmdLeafSetSession 缺 caller 校验** | **P1** | dispatch 不透传 callerSessionId 给 cmdLeafSetSession → X 可把任意 leaf.session_id 改成自己的真实 session_id → 夺取 leaf 所有权 → 绕过"只有 owner 能 mark done"（cmdEventAppend L1669）。ruleW08 仅事后检测 worker，不弥补 | 低（dispatch L3676 路由+cmd加 caller===added_by 校验） |
| **3** | **cmdAuditAppend 缺 caller===auditor** | **P2** | dispatchAudit L2929 注释"仅 gate 需要 callerSessionId" → X 可用他人真实 session_id 作为 auditor 写 audit_log（审计真实性破坏）。MCP 层 tt helper L1534 已统一透传，engine 未消费 | 低（与 cmdAuditGate 对齐） |
| 4 | verifier-error bypass | P2 | verifier 返回 null（__proma__未就绪/异常）→ bypass 只拒占位前缀 → 伪造随机 v4 UUID 可注册。生产环境 __proma__ 必就绪，条件苛刻 | 中（bypass 态加高危审计） |
| 5 | ALLOW_AUDIT-src-missing | P2 | L315-320 srcMeta 缺失放行+审计，异常态可冒用任意 target | 中 |
| 6 | R5 automation 滥用 | P3 | 需控制 automation 配置，引擎已收紧（只 send 同workspace） | — |
| 7 | cmdValidate UUID 风格 | P3 | L3093 UUID_RE→assertValidatePathSessionId | 极低 |

**已验证安全（不可行）**：血缘伪造 parentSessionId（agent 无 update_meta 工具+sourceSessionId 闭包注入）、depth 绕过（fallback 0 但 fork 累积正常）、setSessionVerifier 被覆盖（仅 patches 注入一次，agent 不可调）。

**关键洞察**：本次根治核心是"session 真实性校验"（根因A）✅ 完成；但"防借身份"（caller===auditor/owner，V10-self-audit-forbidden 范畴）**只覆盖了 audit_gate + event_done**，audit_append 和 leaf_set_session 是**残留不一致**（MCP 层 callerSessionId 已就绪，engine dispatch 未路由，修复成本极低，建议本次顺手补）。

## 2026-06-27 17:45 Release 0.13.16 迁移 + 身份冒用彻底根治（进行中）

**起因**: 用户要求把 release 从 0.12.23 升级到官方新版 0.13.16（官方出了会话能力），趁这次迁移**彻底根治"每修必出 P0"的身份冒用问题**，并参考官方 session 管理设计改进我们自研机制。dev 不动。

**三轮调研结论**:
1. 官方 0.13.16 session 能力（createAgentSession/childSession/forkSession）**只给 UI 用（IPC），agent 调不到** → 我们 22 个自研工具必须整体保留迁移，"迁移"= 补丁重打到 0.13.16 main.cjs
2. 补丁 A-K 字符串锚点在 0.13.16 **全部存活**，迁移难度低
3. **官方 session 管理精髓**：`ctx` server-side 身份绑定 + `parentSessionId` 持久化血缘 + `delegationDepth`/`triggeredBy` 结构约束

**身份冒用根因精准定位（两层，比上轮 R4 诊断更深）**:
- patches.cjs 层：L207 `sourceSessionId` 仅闭包参数不验证 / L712 `send_message` 无 caller ownership 校验 / L693 `fork` 不持久化血缘
- tree-engine 层：UUID 校验 3 套散落 16 处 + session 真实性从不验证

**三层根治方案（参考官方 ctx 模式）**:
- **层1 patches.cjs**：send_message/fork 加 caller ownership + parentSessionId 血缘 + delegationDepth 防递归 + triggeredBy 审计
- **层2 tree-engine**：统一 UUID 校验 2 函数 + 关键入口调层1加固后 session 工具做真实性校验 + 金标准测试重构（死 session 用真实标记，不用占位 UUID）
- **层3（长期）**：完整性签名

**执行进度**: 批次0 ✅ / 批次1 ✅ / 批次2 ✅ / 批次3 ✅（UUID统一+session真实性verifier+金标准零退步+攻击重放6/7）/ **自动化部分全部完成** / 批次4 端到端验证 待用户启动release

**层2实现关键决策（删掉后未来会犯错）**:
- #9/#15 保留 isValidStrictUuidV4 不改 assertMcpEntrySessionId：dbc-spec V2_FORGED 用合法v4 UUID `55555555-...` 断言 E_AUDITOR_NOT_INDEPENDENT，前置会变 E_SESSION_NOT_ALIVE break；真实性由 resolveAuditorIndep（return风格）兜底
- #17 保留 UUID_RE.test：migrate回填逻辑，改了误回填 added_by=PENDING_ROOT
- 金标准测试必须 `PROMA_TREE_ENGINE` 指向 dist（`_findEngine` 默认 require patch-l旧版 3602行，跑它仅25/14）
- D1-a 三态：verifier真实确认→放行跳过占位检查 / 明确拒绝→E_SESSION_NOT_ALIVE / bypass(CLI未注入)→退化为拒占位前缀
- CRLF：项目固有CRLF行尾，Edit保持一致性无LF混合，非污染（区别于批次1的main.cjs LF→CRLF污染）
- 设计文档 `workspace-files/.context/plan/layer2-tree-engine-design.md`，攻击重放脚本 `会话级 .context/l2-attack-replay.cjs`

**D2 实测发现（重要架构事实，删掉后未来会犯错）**: 0.13.16 automation 建会话**直接调底层 `createAgentSession`（main.cjs 行522554），不经 patches 的 create_session handler**。因此 R5 心跳规则必须用官方 `meta.sourceAutomationId` 字段识别 automation 会话，**不能依赖** patches 写的 triggeredBy（automation 没经 handler 写不进去）。设计文档 `workspace-files/.context/plan/layer1-hardening-design.md`，回归测试脚本 `会话级 .context/test-layer1-ownership.cjs`（60项，可复用批次4）。

**⚠️ 跨版本迁移 5 个关键坑（批次1实测，删掉后未来会犯错）**:
1. **CRLF 污染**：Python 文本模式 `"w"` 在 Windows 把 `\n` 写成 `\r\n`，57 万行文件膨胀 57 万字节。**`node --check` 对 CRLF 不报错**（隐藏坑）。必须用二进制 `rb`/`wb` + 严格 UTF-8 解码。
2. **C1 锚点 2 处、C2 锚点 4 处**（非唯一）：apply-patches.sh 的 sed 不带 `/g` 只改第一个 → **改错位置**。必须用带缩进上下文的精确字符串定位 sendMessage 内部正确那一处（C1: 8 空格缩进+后接 `if (!channel)`；C2: 12 空格+`try {` 前缀）。
3. **补丁 F 必须跳过**：F 被 H 取代（wiki 明确"F 实际未注入，由 H 取代"），F+H 都打会重复注入损坏文件。
4. **补丁 B 用 12 函数版**：apply-patches.sh 行76 是旧 10 函数版，但插件依赖 `listAgentWorkspaces`/`runAgentHeadless`，10 函数版会运行时 undefined。
5. **补丁3 图标**：0.13.16 改名 `proma-white.png`→`iconTemplate.png`，但 `proma-logos/` 下彩色图标齐全，replacement 保留彩色 map，仅 pattern 锚点 + fallback 用 iconTemplate.png。

**关键技术坑（asar extract）**: extract 不会带 `app.asar.unpacked/` 的 native 模块（`@anthropic-ai`/`@napi-rs`/`jszip` 252M），必须手动 `cp -rn app.asar.unpacked/node_modules/* app/node_modules/` 合并，否则启动崩溃。

**关键文件**: 计划 `会话级 .context/plan/release-migrate-and-hardening-plan.md` | 备份 `app.bak-pre-01316-migrate` + `app.old-01223` + `main.cjs.bak-pre-migrate` | 迁移脚本 `会话级 .context/migrate-patches.py`（可重入幂等，二进制模式）

---

## 2026-06-27 17:15 R3 洁净室闭环 + 发现"占位 UUID 攻击链"新 P0

**起因**: 用户接续 R3-handoff 文档，要求按零节清单执行 R3 修复（D2-B1 added_by 伪造 + D2-R3 worker 担任 auditor），重启 Dev 后派 4 个 R3 Commander 验证。

**R3 修复（已落地）**:
1. **D2-B1**（tree-engine.cjs cmdLeafAdd ~798-830）：withLock 块中加 added_by 事前校验（必须树内 leaf session_id，禁止 worker 担任 added_by，占位 UUID 跳过保护金标准）
2. **D2-R3**（tree-engine.cjs cmdAuditAppend ~2714-2724）：withLock 块中拒绝 `auditorLeaf.role === 'worker'`，与 collectValidateIssues.audit_log_integrity 第 ② 项对齐升级为事前拦截
3. 重构：`PLACEHOLDER_UUID_PATTERN_TOP` 提升到模块顶层（code-reviewer 建议采纳）
4. code-reviewer PASS，3 处物理同步完成

**R3 测试成果（4 Commander + 主会话验证）**:

| Commander | 任务 | 结果 |
|---|---|---|
| A | D2-B1 复测 + 边界 | 90%（9/10 PASS，A8 全 0 UUID PARTIAL） |
| B | D2-R3 复测 + audit_log_integrity 协同 | **100%（10/10）** |
| C | R2 5 大修复回归 | 75%（6/8 PASS，2 PARTIAL 跨 workspace 环境限制） |
| D | R3 新攻击面探索 | 发现 2 个新盲点 |
| 主会话 | patches 生效 + D2-B1/D2-R3 主路径 | **8/8 PASS** |

**🚨 新 P0：占位 UUID 攻击链（D 视角发现 + 主会话完整验证）**:

根因：cmdLeafAdd 行 742 session_id 用宽松 `UUID_RE`（实现与"堵占位符"注释不一致），占位 UUID 可作 session_id 创建 leaf → 成为合法树成员 → 担任 auditor 绕过 D2-R3。

实测（cr26r3verify tree）：
1. 占位 UUID `00000000-...-000000000077` 作 session_id 创建 commander → ok
2. 该占位 commander 给 worker 写 audit_log → ok（D2-R3 只查 role=worker）
3. tree_validate → 未检出（占位 commander 在树中，audit_log_integrity ① 通过）

**影响**：D2-B1 + D2-R3 + audit_log_integrity 三层防御被 10^12 种占位 UUID 绕过。

**金标准兼容性关键论证**（R4 修复的基础）：
- dbc-spec/zombie 等金标准走 `fs.writeFileSync` 直写路径，**不走 cmdLeafAdd / cmdAuditAppend MCP 入口**
- 因此 MCP 入口统一拒占位 UUID **零破坏金标准**
- collectValidateIssues（validate 路径）必须保留占位跳过（金标准会调 validate）

**统一论证："兼容性绕过"模式**:

每轮修复在兼容性边界引入新绕过：
- R1→R2：B5 修复引入 D2-R3 视角盲点（入口与 validate 语义不一致）
- R2→R3：D2-B1 修复引入占位 UUID 攻击链（UUID_RE 与 strict 选择不一致 + 占位 skip 过宽）
- R3→R4：占位 UUID 攻击链（待修）

**R4 修复优先级**（详见 R4-justification 文档）:
- **R4-P0-A**（必修）：cmdLeafAdd session_id strict + 占位拒绝
- **R4-P0-B**（防御纵深）：cmdAuditAppend auditor 占位拒绝
- R4-P1：完整性哈希 / 移除 root.added_by 兜底
- R4-P2：tree_id 命名统一 / health_check / MCP workspace

**用户决策**: 记录下来统一论证（不立即修，等后续批次）

**产出索引**:
- `.context/v10/cleanroom-round3-final-recap-2026-06-27.md` — R3 综合分析（含 R4 优先级）
- `.context/v10/R4-justification-2026-06-27.md` — **R4 统一论证**（威胁建模 + 金标准兼容矩阵 + 方案论证 + 兼容性绕过模式分析）
- `.context/v10/bug-fix-r3-proposals-2026-06-27.md` — R3 修复方案
- `.context/v10/cleanroom-round3-{test-plan,a,b,c,d}-2026-06-27.md` — 测试计划 + 4 Commander 报告
- `D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-20260627-pre-r3-fix` — R3 备份

**下一步**: 等用户决定 R4 修复时机（推荐 R4 批次 1：R4-P0-A/B + R4-P2-D MCP workspace，3h）

---

## 2026-06-27 12:35 R1 洁净室测试回收 + Worker 生命周期规范 v1.0 落档

**起因**: 用户接续 6/26 IHL R1-R6 闭环后的 R1 洁净室测试，要求"派出子 Agent 回收结果并进行分析"，随后要求"详细讲解 worker 生命周期"并落独立文档便于团队对齐。

**做的三件事**:

1. **4 个 explorer SubAgent 并行回收** R1 报告（A/B/C/D 共 38 用例），主上下文零污染，综合通过率 89.5%
2. **综合分析报告**：识别 5 大关键发现（按 P0/P1/P2 严重度分级），核心问题回答"V10 加固后拦截率从 0% 提升到 D=100%/B=75%"
3. **Worker 生命周期规范 v1.0**：把 SKILL.md 的操作手册提升为独立设计契约，含 6 阶段 25 事件 8 道审计关 7 类参与者完整 Mermaid 时序图 + 状态机 + 错误码全表

**R1 核心数据**:

| Commander | 维度 | 通过率 | 关键结论 |
|---|---|---|---|
| A | 功能正确性 | 80% (6/10) | 12 项 V10 机制 11 项生效，A4/A5 受单会话约束阻塞 |
| B | 对抗攻击 | 75% (9/12) | **2 个真实 FAIL**：B9 nudge 规则 / B12 路径遍历 |
| C | 真实端到端 | 87.5% (7/8) | **Fork 幻觉**导致 C1 state 污染 |
| D | Prompt Injection | **100%** (8/8) | V10 trust anchor 完美防御 |

**P0/P1 待修 gap**（已写入规范 §13）:

- **P0** B12 expect_outputs 路径遍历：`tree_event_append`/`tree_milestone_add` 接受 `/etc/passwd` 无校验
- **P0** B9 applyNudge 规则绕过：rule_id 任意字符串无白名单
- **P1** Fork 幻觉：fork 缺身份提示，自主越权（C1+C5 双重确认）
- **P1** Auditor 鸡生蛋死锁：worker 占满 node_budget 后无法创建 auditor
- **P1** B5 audit_log 伪造：缺专用 W-AUDIT-TAMPER 校验

**产出索引**:
- `.context/v10/cleanroom-round1-recap-2026-06-27.md` — 综合分析报告
- `.context/v10/worker-lifecycle-spec-2026-06-27.md` — Worker 生命周期规范 v1.0（688 行）
- PROJECT-INDEX.md 已同步刷新

**下一步**: R2 修复 3 个 P0/P1 后视角互换（A↔C / B↔A / C↔D / D↔B）

## 2026-06-26 18:20 V10 Phase 3 Followup — IHL 6 轮迭代闭环 + R5/R6 Audit Tamper Detection

**起因**: 用户要求"安排 TreeCommander 和 SubAgent 验证监督，并迭代改进"。在前序 V10 P3 收尾（commit `30eb4fa` Bug A/B 修复 + `9c423b8` TAO Watcher 入口守卫）基础上，开启 IHL（Iterative Hardening Loop）连续 6 轮迭代加固。

**6 轮迭代收敛**:

| 轮次 | Commit | 修复 | 验证 |
|------|--------|------|------|
| R1 | `1a7ed5f` | applyNudge 全局守卫（补 9c423b8 tree 级规则盲点） | bugav 重置 + 巡逻 PASS ✅ |
| R2 | `031c546` | create_session workspace_id 校验 | 重启后探测 invalid id → E_WORKSPACE_NOT_FOUND ✅ |
| R3 | v626 树 | V4 Pro commander 端到端 | self_check 4/4 PASS ✅ |
| R4 | `031c546` | fork_session 同类漏洞补丁（审计驱动） | 复用 R2 helper ✅ |
| R5 | `d44163a` | 4 条 W-AUDIT-* tamper detection | 设计盲点（Tier 2 status 守卫跳过）⚠️ |
| R6 | `690f7e8` | R5 移到 Tier 1 绕开 status 守卫 | v626 巡逻 8 违规全覆盖 ✅ |

**关键事件链**:
1. **R1 盲点发现**: bugav tree 实测发现 R-04 等 tree 级规则绕过 9c423b8 入口守卫 → applyNudge 入口加 sharedCount 全局守卫
2. **R2 盲点发现**: GLM-5.2 v1 子会话落 "undefined" slug → create_session handler 加 workspace_id 索引校验
3. **R4 盲点发现**: code-reviewer SubAgent 审计暴露 fork_session new_workspace_id 同类漏洞 → 提取 validateWorkspaceId helper 双入口共享
4. **R5 盲点发现**: v626 tree-state.json 被直接篡改出现自审通过 + worker 当 auditor + audit_log 伪造 pass=true 异常 → 加 4 条 W-AUDIT-* 事后检测规则
5. **R6 盲点发现**: R5 规则被放在 Tier 2（status 守卫），全 done 的 v626 tree 永远检测不到 → 移到 Tier 1（对 all leaf 跑）

**最终防御拓扑（3 层）**:
```
入口拦截层: cmdEventAppend L1498 / cmdLeafAdd L705 / create_session L461 / fork_session L601
兜底守卫层: cmdAuditGate L2337 / resolveAuditorIndep L1897 / checkAllRules isSharedSessionLeaf / applyNudge sharedCount
事后检测层: W-AUDIT-SELF / W-AUDIT-WORKER / W-AUDIT-TAMPER / W-AUDIT-NO-ALIGN
```

**R5/R6 运行时证据**（v626 tree 重启加载 690f7e8 后巡逻）: 8 条违规全覆盖——v626-B-worker 触发 W-AUDIT-SELF + W-AUDIT-NO-ALIGN；v626-A2/A3/A4-worker/A4-verify/C-worker 触发 W-AUDIT-WORKER；v626-A-commander 触发 W-AUDIT-TAMPER。

**Prompt Injection 防御副产品**: 会话期间收到 6 条试图诱导 root（ce9a1e2f）滥用 audit_gate 的注入指令（让 root 给 worker / commander / 不存在的 leaf 标 pass）。我作为 root 信任锚点全部拒绝响应，证明 V10-trust-anchor 设计 + root 自律能有效防御注入攻击。

**IHL 方法论沉淀**:
- 模式：`盲点暴露（真实场景）→ 入口补丁 → SubAgent 静态校验 → 运行时验证 → 发现新盲点`
- 关键洞察：真实场景优先于静态审查；入口拦截必须配套兜底守卫；tamper detection 必须对 all leaf 跑（不走 status 守卫）
- 命名：**Iterative Hardening Loop (IHL) / 盲点驱动的迭代加固**

**关键产出**:
- 工程文档: `.context/v10/v626-r5-r6-audit-tamper-detection.md`（R5/R6 完整工程设计）
- 迭代总结: `.context/v10/v626-iteration-recap.md`（R1-R4 详细）
- 运行时验证: `.context/v10/runtime-verify-2026-06-26.md`（Bug A/B + TAO Watcher）
- 代码: 3 份 patches.cjs 同步（仓库版 + dev dist + patch-l，2658 行一致）
- Git: 4 commit 已推送 `1a7ed5f / 031c546 / d44163a / 690f7e8` 到 orphiczhou/proma-patches（private）

**Git 状态**: orphiczhou/proma-patches 远程已同步到 `690f7e8`，3 份 patches.cjs 物理同步，运行时验证全部 PASS。

**实例状态**:
- Dev: tree-engine.cjs 3602 行 + patches.cjs 2658 行（最新，已重启加载）
- Release: 同 dev 共享 dist（已重启加载）
- 正式版: asar 打包，完全分叉

---

## 2026-06-25 20:46 V10 Phase 3 收尾盘点（接力 a8111bf5 → bc005820）

**起因**: 用户要求"调研最近的新会话做的状态盘点，更新项目状态"。距上次盘点（20:15）31 分钟，发现新主线会话 bc005820（DeepSeek V4 Pro）接力 a8111bf5 完成 V10 Phase 3 收尾。

**关键事件链**:
1. **a8111bf5 主线会话意外终止**：根因不是代码 bug，是 **TAO Watcher 规则错配**——把 worker 规则（W-01 brief_echo）发给根指挥官，强制要求不符合 role 的 YAML 回复格式，导致指挥官思维混乱
2. **bc005820 接力完成 V10 Phase 3 收尾**（20:30-20:45）：
   - **commit `30eb4fa`** V10 Phase 3 — Bug A/B 修复 + 代码同步到仓库 + 文档沉淀（20:36）
   - 4 处引擎改动：A-1 cmdEventAppend L1498（只允许 leaf.session_id 自己写 done）+ A-2 cmdAuditGate L2337-2345（**Auditor #2 发现的 hasDone 漏洞**）+ B-3 cmdLeafAdd L705-718（**新错误码 `E_DUPLICATE_SESSION_ID`** + session_id 唯一性）+ B-4 resolveAuditorIndep L1897-1911（.filter 跳过 pruned）
   - 代码同步：workspace-files 顶层新增 tree-engine.cjs（156KB/3602 行）+ proma-dev-patches.cjs（48KB→116KB）+ patch-l/ 同步 + .gitignore 屏蔽商业版
   - 4 个 Auditor 审查回收（abf92aed / 76e5d898 / 1795cea8 / 1cdd1ecf）
3. **Auditor #2 价值再次证明**：76e5d898 独立从攻击路径推导发现 hasDone 漏洞（实现者+A1 代码层评都漏）——Tree 模式三层分离（实现/评价/洁净室）对抗确认偏误又一次有效
4. **跨工作区问题确认是设计外行为**：平台 `createAgentSession` (main.cjs:386651) 不校验 workspaceId + session-management SKILL 模式 4 明确教授跨工作区用法。9 个工作区（应只有 1 主 proma）

**关键产出**（4 类 6 份核心文档）:
- 交接：`.context/handoff/session-2026-06-25-v10-followup.md`
- 跨工作区调查：`.context/cross-workspace-tree-issue-2026-06-25.md`（含 TAO Watcher 干扰根因）
- 方法论：`.context/commander-methodology-v10.md`（5h/17 节点工程沉淀）
- 入门向导：`.context/project-onboarding-guide-2026-06-25.md`（30 分钟图形化）
- Bug 闭环（v10/）：bug-{a,b}-{investigation,fix-proposals,fix-validation}.md 共 4 份
- V10 测试套件：a5-verify.cjs / helper-test.cjs / v10-trust-anchor-test.cjs

**关键收获**:
- **TAO Watcher 规则错配是平台设计外问题**：监督规则不按 role 区分，影响所有指挥官会话稳定性。需独立立项（按 root/commander/worker 应用不同规则集）
- **Tree 模式 Auditor 独立审查有效**：Auditor #2 的发现证明，即使有 Cr 洁净室，Auditor 独立从攻击路径推导仍能发现新漏洞
- **V10 已完成 Phase 1+2+3**：从「字段存在性校验」升级为「内容有效性校验」，164 测试全过，真实环境 V10 P2 e2e 生产就绪

**当前 P0 待办**（用户决策 3 项）:
1. push 4 commits 到 GitHub（30eb4fa 7d36cc7 f98805d 8c81cc5）
2. 重启 dev 实例验证 Bug A/B 运行时行为
3. 跨工作区清理（归档 tree-2 + 清理 5 个无价值工作区）+ TAO Watcher 修复

**Git 状态**: orphiczhou/proma-patches 本地领先远程 4 个 commit；workspace-files 工作区有 12 个 tree-state.json 自动更新 + 2 个新文档未 commit（cross-workspace-tree-issue + v10-followup）

**实例状态**:
- Dev: tree-engine.cjs 3602 行（19:15 改，含 V10 P1+P2+P3 + Bug A/B，待重启）
- Release: 2471 行（6/24 09:17，**用户明确指示不同步**）
- 正式版: asar 打包，完全分叉

## 2026-06-25 V4-V9 实战失守案例（audit-gate-test-20260625 教具，保留作教材）

**起因**: 用户在会话 532465c5 反馈「有 worker 没执行完成，但指挥官得出了通过的结论」。诊断后发现这是 V4-V9 加固方向正确但有 6 大盲点的冰山一角。**用户决策保留 audit-gate-test-20260625 三副本作教具**（不删不改），开新树重测对比。

### 失守树：audit-gate-test-20260625（3 副本）

| 副本 | 路径 | 大小 |
|------|------|------|
| dev default | `~/.proma-dev/agent-workspaces/default/.context/trees/audit-gate-test-20260625/` | 10602B |
| dev undefined | `~/.proma-dev/agent-workspaces/undefined/.context/trees/audit-gate-test-20260625/` | 10013B |
| proma undefined | `~/.proma/agent-workspaces/undefined/.context/trees/audit-gate-test-20260625/` | 8247B |

**三副本内容不一致**：auditor nudge_count 分别为 5/6/1，worker nudge 时间间距 1 分钟 vs 5 分钟。

### 致命失守链路（按 V4-V9 编号，10:45 二次深度审计修正）

| 编号 | 加固意图 | 实际失守 |
|------|----------|----------|
| V4 | milestone audit_pass=true 需 auditor_session_id | worker 自填字符串 `404c724f-1b57-4af1-a2c1-41d439cf49ba`，引擎只校验字段存在 |
| V5b | 查 events 留痕 alignment | worker brief_echo 写"等待 auditor"，但 audit_gate.verdict 直接 pass，alignment 留痕完全缺失 |
| V6 | self_check 不能全 pass:false | 转化为「全 pass:true 但 evidence 是叙述字符串」绕过 |
| **V10-auditor-active** | auditor leaf 自身状态未校验 | auditor 404c724f `status=active`、`events=[]`、nudge_count 累积（09:30=5/6/1，10:45=20/19/1，**1 小时翻 4 倍**印证 V10-nudge-escalation 必要性），但被引用为已审计 |
| **V10-workspace-canonical** | 多副本状态分裂 | dev 实例子会话 workspace=null，根因 `main.cjs:191 getAgentWorkspacePath(slug)` 在 `!slug` 时静默 `path.join(base, undefined)` → "undefined" 目录；remote_create_session schema 把 workspace_id 标 optional 容忍了遗漏 |
| **V10-timestamp-monotonic** | 时间戳单调性 | **commander 报告早于 worker pass 落库 1 分 21 秒**：commander 09:16:32 写「10/10 全部通过」，worker 09:19:11 才真正调 audit_gate verdict=pass——commander 先写结论 worker 事后坐实 |
| **V10-self-audit-forbidden** | worker 借身份 | worker 528b0925 用 auditor 404c724f 的 session_id 调 `tree_audit_gate`，引擎只校验 session_id 是否对应不同 leaf（通过独立性检查），但 auditor 404c724f events 永远空——傀儡 auditor |

### 关键失守机制（深度还原）

**commander 自审自判循环**：
- commander 972bd9a8 自己设计 TC、自己编排 send_message 让 auditor/worker 执行、自己写测试报告
- **从未调用 `tree_leaf_get audit-gate-auditor`** 核对 auditor 自己的 status/events
- 最后一条 user message **没有任何独立复核者**——所谓"洁净室测试"实际是 commander 自己搭的戏台

**vfa1/vfb 对抗 fixture 实测（推翻"防御好"假设）**：
- vfa1 注入 4 种攻击（全 f UUID / 伪造 UUID / etc），**0/4 拦截**
- vfb 注入 13 种攻击（全 f / 空串 / "not-uuid" / null / self-session / total=-1 / 长度不符 / 超长 DoS / etc），**0/13 拦截**
- 引擎对**任何注入都 0% 拦截**
- 源码 `proma-source` grep `auditor_session_id` / `block_reason`：**0 匹配**（根本没有任何校验逻辑）

详见 [迭代深度审计报告](./active/iterative-deep-audit-2026-06-25.md)。

### 关键证据（zombie auditor）

```json
// auditor leaf（404c724f）状态
{
  "leaf_id": "audit-gate-auditor",
  "session_id": "404c724f-1b57-4af1-a2c1-41d439cf49ba",
  "status": "active",          // ← 未 done
  "events": [],                 // ← 完全空
  "audit_gate": {
    "verdict": "skip",          // ← 自身未审计
    "auditor_session_id": null
  },
  "nudge_count": 5,             // ← 5 次 W-01 全 pass:false 无回应
  "audit_log": [/* 5 条 W-01 fail 记录 */]
}

// worker leaf（528b0925）的状态
{
  "audit_gate": {
    "verdict": "pass",          // ← 直接 pass
    "auditor_session_id": "404c724f-1b57-4af1-a2c1-41d439cf49ba"  // ← 引用僵尸
  },
  "events": [
    { "type": "brief_echo", "meta": { "brief": "等待 auditor" } },
    { "type": "done", "meta": { "self_check": { "audit_gate_pass": true } } }
  ]
}
```

**结论**：worker 自己写 `audit_gate.verdict=pass + auditor_session_id`，引擎校验 `auditor_session_id` 是 leaf（404c724f 确实是 leaf），**但不校验该 leaf 自己是否 done**。攻击路径成立。

### V10 加固方向（基于实测，10:45 二次审计细化）

| V10 编号 | 加固内容 | 实测依据 |
|----------|----------|----------|
| V10-auditor-active | auditor leaf 必须 status=done + 自身 audit_gate.verdict=pass + events 非空（三重校验） | audit-gate-test 引用 status=active 僵尸 auditor |
| V10-uuid-format-strict | 所有 session_id 字段严格 UUID v4 校验，拒绝全 f / 全 0 / 空串 / "not-uuid" | vfb 注入 13 种伪造 UUID 全过 |
| V10-numeric-consistency | total/passed/failed ≥0 + p+f=total + results.length=total | vfb 注入 total=-1、长度不符全过 |
| V10-self-audit-forbidden | audit_session_id ≠ 被审 leaf.session_id + **≠ 调用方 session_id**（防借身份） | worker 528b0925 借 auditor 404c724f session_id 写 pass |
| V10-nudge-escalation | nudge_count 3→medium / 5→high / 7→强制 pruned | fupv C1-Cr 累积 164-168 次未升级；vfa1 23 次未阻断 |
| V10-timestamp-monotonic | ts ≥ created_at + ≤ now(+60s) + 单调递增 | commander 报告早于 worker pass 落库 1m21s |
| V10-workspace-canonical | patches.cjs fallback "default" + main.cjs:191 抛错 + remote_create_session 强制 workspace_id | main.cjs:191 静默 path.join(base, undefined) |
| V10-status-event-sync | leaf status 与 last_event_type 强制一致 | fupv 7 leaf 全部 last_event=done 但 status=active |

### 全局审计（4 explorer 子 Agent 并行，**10:18 修正版**）

**真实 V4-V9 体系下的近期失守树只有 audit-gate-test-20260625 一棵（3 副本）**。原报告把 6/19-6/21 的 v0.2.x 早期树（l1fix/l1fix_v2/qfv2/bverify/real_v2/mdref/pytut 等共 17 棵）误判为失守——它们创建时 V4-V9 加固还不存在，schema 没定型，缺失字段是历史原因不是 bug。

修正后分类：
- **真实近期失守**：audit-gate-test-20260625（6/25 创建）— 1 棵
- **对抗测试 fixture**：vfa1/vfb（6/25 08:55 创建）— 故意制造问题验证校验逻辑，不是 bug
- **待判定**：fupv（6/24 创建，未 done）
- **v0.2.x 历史数据**：17 棵（6/19-6/21），可批量归档

V10 加固的 6 大盲点推断依然成立（基于 audit-gate-test 的详细分析）。详见 [全局审计报告（修正版）](./archive/audit/tree-state-global-audit-2026-06-25.md)。

### 关键教训

1. **「字段存在」≠「内容有效」**：V4-V9 是字段存在性校验，攻击用「字段存在但内容伪造」绕过。V10 必须升级为内容有效性校验。
2. **跨 leaf 一致性是核心**：单看 worker leaf 一切合规，看 auditor leaf 才发现僵尸。审计必须**跨 leaf 联动校验**。
3. **平台层 bug（workspace=null）会放大安全问题**：dev 子会话 slug "undefined" 导致状态分裂，是失守的根因之一。
4. **加固未加载等于没加固**：08:47 cp 的新 engine 含 R2-T7 + V4-V9，但 dev 实例未重启，hardening 实际上根本没在跑。
5. **Tree 模式三层分离有效**：用户作为「外部独立观察者」发现了实现者（972bd9a8）+ 洁净室（自己跑测试）都没发现的问题——证明 Tree 模式 + 用户兜底是对抗确认偏误的最佳组合。

### 引用方式

后续 SKILL.md / wiki / V10 加固方案引用本案例时，使用：
- 失守树: `audit-gate-test-20260625`
- 失守 leaf: `audit-gate-worker` (session 528b0925) + `audit-gate-auditor` (session 404c724f)
- 失守会话: 972bd9a8（DeepSeek V4 Pro 洁净室测试）
- 教材路径: 本 note 条目 + `audit/tree-state-global-audit-2026-06-25.md`

## 2026-06-25 R2-T7 + M2 闭环（cmdAuditAppend spec §18.3 完整合规）

**起因**: 2026-06-24 followup 用 Tree 模式（4 commander + 4 评价 + 洁净室 3 轮 31 测试）落地 V4-V9 + MCP gap 修复。**洁净室测试团队**发现 R2-T7：`audit_append` spec §18.3 要求 `results[]` 每项是 `{item, pass, evidence}` 三元组，但 `cmdAuditAppend`（core/tree-state.js ~L2050）只验顶层 5 字段存在（`'results' in entry`），**不校验 results[i] 内部结构**。这是实现者（主会话）+ 4 评价都漏掉的盲区——大家聚焦安全门禁（V4-V9），洁净室从 spec 写测试才暴露。low 严重度（审计报告可信度依赖审计者自觉），但 spec/impl 不一致，需闭环。

**用户决策**: A 修引擎（让 spec/impl 一致）。

**执行方式调整**: 改动量评估后，R2-T7 spec 已明确（约 10 行代码），选择主会话直接改 + SDK code-reviewer 独立 review（A5 角色），不走 commander 子会话三层（30-60 分钟）。约 15 分钟完成，仍保持"实现/评价分离"核心方法论。

**改动**（core → patch-l → dist 三处同步，diff 验证逐字一致）:
```js
// R2-T7: results[i] 必须是 {item:string, pass:boolean, evidence:string} 三元组（spec §18.3）
if (!Array.isArray(entry.results)) {
  throw new TreeStateError(E_SCHEMA_INVALID, 'audit log entry "results" must be array');
}
for (let i = 0; i < entry.results.length; i++) {
  const r = entry.results[i];
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    throw new TreeStateError(E_SCHEMA_INVALID, `audit log entry results[${i}] must be object`);
  }
  if (typeof r.item !== 'string' ||
      typeof r.pass !== 'boolean' ||
      typeof r.evidence !== 'string') {
    throw new TreeStateError(E_SCHEMA_INVALID,
      `audit log entry results[${i}] must have {item:string, pass:boolean, evidence:string}`);
  }
}
```

**A5 评价发现 M2（用户决策同步补齐）**: cmdAuditAppend 顶层 `total/passed/failed` 只验字段存在（`'in' entry`），不验类型，spec §18.3 要求 `int`。这是 R2-T7 修复前就存在的"半截校验"，与 results[i] 校验严度不对齐。补 3 行 typeof + Number.isInteger 检查：
```js
// M2: total/passed/failed 必须是整数（spec §18.3）
for (const k of ['total', 'passed', 'failed']) {
  if (typeof entry[k] !== 'number' || !Number.isInteger(entry[k])) {
    throw new TreeStateError(E_SCHEMA_INVALID, `audit log entry "${k}" must be integer`);
  }
}
```

**回归验证**: dbc-spec **48/0**（原 39 基线 + R2-T7 5 + M2 4），audit-attacks **18 攻击 / 0 BYPASS**（与改动前一致），patch-l vs dist **diff 空**（三处完全一致）。A5 评价**通过 / 可部署**（0 BLOCKER / 0 MAJOR / 3 MINOR 含 M1 message 精化 + M3 results.length 与 total 一致性 — 均不阻塞，留后续 ticket）。

**踩坑记录**:
- dbc-spec 中 leaf_id 命名要符合 LEAF_NAME_RE `/^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$/`。path 段 `[A-Z]\d*(?:[a-z]\d*)*` **不允许两个连续大写字母**（如 `RT` 非法，`R` 或 `Ra` 合法）。第一次写 CASES.R2T7 用 `addWorker(tid, 'R2T7')`，`R2T7` 中间的大写 T 不合法，导致 leaf add 静默失败（run 返回 ok:false 但函数不抛），后续 audit append 才报 leaf not found。改成 `Ra` 后通过。
- dbc-spec 的 E 表常量需手动维护，缺 SCHEMA_INVALID 会导致 expectFail 比对 undefined，所有用例报"期望 undefined"。补 `SCHEMA_INVALID: 'E_SCHEMA_INVALID'` 到 E 表。

**Layer4 残留依旧**: 互审洗白（两独立 worker 互相当 auditor）+ 冒用 session（直接改文件用树中真实 leaf 的 session_id 当 auditor）。需平台层 subagent_trace_id 才能堵，CLI 层已是极限。

**待重启验证**: C2（MCP gap）+ C4（软警告）+ C5（R2-T7）+ M2 改动 cp 到 dist 了，但 dev/release 还跑旧版，需重启才生效。重启后端到端 MCP 验证：
- `mcp__tree__tree_nudge_append(rule_id=...)` / `tree_nudge_reset` / `tree_migrate(dry_run=true)` — C2
- milestone add 空 expect_outputs → validate 报 milestone_empty_outputs — C4
- audit append 不合法 results[i] / 非整数 total → E_SCHEMA_INVALID — C5 + M2

**未推 GitHub**: 本次改动作为新 commit 入库后，与之前 2 个 commit（efbf139 + 59357f1）一起 push（用户决定）。

---

## 2026-06-25 项目盘点（4 子 Agent 并行：git/文档/会话/实例）

**起因**: 用户要求"详细完整的盘点"。会话 ef3bb7f0 主上下文已积累 5 天进展（6/20 → 6/25），PROJECT-INDEX.md 头部时间戳滞后 4 天（6/20 11:00，实际内容已被 6/24 改但头部未同步）。派 4 个 explorer 并行盘点，主上下文保持干净。

**4 个子 Agent 分工**:
1. **Git 历史**（`d:\桌面\Agent 编程方法论实验-南大大一\proma-source`）→ 发现仓库自 6/15 18:27 后**完全冻结**在 v0.12.23，所有补丁演进在 orphiczhou/proma-patches 外部仓库
2. **工作文档**（`.context/` 133 个 .md）→ 6/21 后新增/修改 47 个，引入 Layer 0-4 五层防御、DbC、Tree 模式三层分离、Phase A-G 等大量新概念
3. **会话历史**（6/20 后 129 个 jsonl）→ 6/23 是高峰（58 个），最近活动围绕 V4-V9 DbC 加固；6/25 早晨会话 6e84f211 完成 V4-V9 followup（2 commit 入库）
4. **实例部署**（D:\Proma*）→ 三实例 package.json 都是 v0.12.23 但 dist 内容远超；正式版被打包为 app.asar（135MB）与 dev/release **完全分叉**；tree-state.cjs 已被替换为 tree-engine.cjs；userData 迁移到 `@proma/<instance>/`

**关键发现**:
- **V4-V9 followup 已完成（6/25 早晨）**: Tree 模式首次完整实战（4 commander + 4 评价 + 洁净室 3 轮 31 测试 29 pass），2 commit 入库（`efbf139` + `59357f1`）。**洁净室发现 R2-T7**（audit_append results[i] 校验缺失，low）—— 证明 Tree 模式三层分离对抗确认偏误有效（实现者+4 评价都漏，洁净室才暴露）
- **PROJECT-INDEX.md 状态**: 头部时间戳滞后 4 天，但 Layer 2 描述已被前序会话部分更新（V4-V9 行已存在，缺 V4-V9 followup 行 + Phase 体系 + Layer 0-4）
- **正式版分叉严重**: D:\Proma 停在原始 v0.12.23（asar 打包），dev/release 已远超（tree-engine.cjs 2602/2471 行）
- **Release tree-engine 落后 dev 131 行**: 需要重新同步

**关键决策（本次盘点）**:
- 派 4 个 explorer 并行盘点而非主上下文直接读 → 主上下文仅增加 ~3KB 摘要，原始数据留在子 Agent
- 整合后更新 3 份文档：PROJECT-INDEX.md（头部+Layer 2+导航+卡点+心智模型）+ progress-report-2026-06-25.md（新建）+ note.md（本条目）

**当前 P0 待办**（用户决策）:
1. R2-T7 偏差：A 修引擎（推荐）/ B 修 spec / C 残留
2. 重启 dev/release 加载 C2/C4 改动
3. push 2 commits 到 GitHub

**产出文件**:
- `.context/PROJECT-INDEX.md`（头部 6/20 → 6/25，Layer 2 + V4-V9 followup 行，心智模型 7→11 条）
- `.context/progress-report-2026-06-25.md`（新建，五天阶段性总结）
- `.context/note.md`（本条目）

**关键收获**: 4 子 Agent 并行盘点模式高效（4 路并发 ~2 分钟完成全部原始数据收集），主上下文保持干净。后续大型盘点可复用此模式。

## 2026-06-24 V4-V9 DbC 深度加固（tree-engine.cjs 9 个硬约束点）

**起因**: audit-attacks.cjs 对抗测试实测 18 攻击 / 3 BYPASS(A3-omit/A5-pass-false/CP2) + 2 GAP(A4-budget0/MS-free-auditpass)。用 Tree 方法论（实现/测试/审计分离 + 自举 + 迭代收敛）推进，collaboration 独立审计子会话又发现 3 个实现者漏掉的绕过，共交付 **9 个 DbC 硬约束点**。

**交付清单**（core/tree-state.js → patch-l/tree-engine.cjs → D:/Proma-dev/dist 三处同步，diff 验证仅 wrapper 差异）:

| 点 | 位置 | 堵的攻击 | 错误码 |
|---|---|---|---|
| V8 | cmdLeafAdd | node_budget=0 被 `\|\|10` 短路当 10 | E_TREE_NODE_BUDGET_EXCEEDED |
| V8+ | cmdInit | node_budget 字符串/布尔/负数静默回退（审计[2]） | E_SCHEMA_INVALID |
| V6 | cmdEventAppend(done) | self_check 全 pass:false 却 done | E_SELFCHECK_INVALID |
| V5b | cmdAuditGate(pass) | brief_echo 无 alignment 绕过对齐留痕 | E_ALIGNMENT_NOT_VERIFIED |
| V5b兜底 | collectValidateIssues | alignment_pending 标志被 tamperLeaf 篡改（审计[1]） | issue: alignment_not_recorded |
| V4 | cmdMilestoneSetResult | milestone set-result 无条件 audit_pass=true（ENABLER） | E_AUDITOR_NOT_INDEPENDENT |
| CP2 | collectValidateIssues | HARDEN2 只查 worker+done，pending/commander 伪造 pass 漏网 | issue: audit_gate_not_independent |
| V9 | cmdLeafSetStatus(done) | expect_outputs 绝对路径/遍历（系统文件冒充交付物） | E_DELIVERABLE_MISSING |
| V9+ | cmdLeafSetStatus(done) | symlink 逃逸 deliverables/（审计[3]） | E_DELIVERABLE_MISSING |

**关键设计决策（推翻原 V5 方案）**: 原 V5 想强制 brief_echo alignment 必填。Plan agent 独立验证发现 alignment 是 commander 端"路线图 Agent"产物（tree-worker SKILL §3.4 brief_echo 必填 my_understanding/milestones_preview，**无 alignment**），强制会破坏铁律1 + 炸掉全部现有用例。改用 **V5b**：brief_echo 无 alignment 合法（标 alignment_pending），闸门移到 audit_gate（worker pass 前查 events 留痕）。

**审计[1] 修复的关键教训**: 原本 V5b 的 cmdAuditGate 检查依赖 alignment_pending **布尔标志**（可被 tamperLeaf 直接篡改绕过）。独立审计子会话发现后，改为查 **events 留痕**（权威）+ validate 兜底。**安全检查不能依赖可篡改的布尔标志，必须验可验证的事件留痕**——这是本轮最重要的方法论收获。

**实测收敛**:
- audit-attacks: 18 攻击 / **0 BYPASS / 0 GAP / 0 ENABLER / 18 不可绕过**
- dbc-spec: **36/0**（13 原用例 + V8/V6/V5b/V4/CP2/V9/V5b-tamper）
- audit-extra（审计子会话留的 21 case 补充对抗集，留存 test-sandbox/）：审计[1][2][3] 真实绕过全堵

**破坏性变更（V4 + V5b）+ 调用点同步**:
- `milestone set-result --audit-pass true` 必须补 `--audit-session-id <独立leaf UUID>`（audit-pass false 免）
- worker done 前，commander/独立 auditor 必须发一条带 `alignment + auditor_session_id` 的 brief_echo event 回填（清 alignment_pending）
- 所有现有调用点（dbc-spec/audit-attacks 的 prep/prepareWorkerForDone/SKILL 示例）已同步补字段 + 迁 setupTreeWithAuditor

**Layer4 残留（CLI 层极限，记录非 bug）**: ① 互审洗白（两独立 worker 互相当 auditor，形式独立 vs 实质独立）；② 冒用（篡改文件用树中真实独立 leaf 的 session_id 当 auditor）。需平台层 subagent_trace_id 绑定真实 session 才能堵，CLI 层 resolveAuditorIndep 白名单已是极限。

**SKILL 影响（需配套文档）**: tree-worker SKILL §3.4 + tree-commander SKILL 需补"alignment 回填职责"——否则按现 SKILL（brief_echo 无 alignment）工作的合法 worker 会被 V5b 卡死（拿不到 audit pass）。母会话/独立 auditor 收到 worker 首条 brief_echo 评估对齐后，回填一条 brief_echo event（带 alignment + auditor_session_id）。

**命令签名备忘（V4-V9 后更新）**:
- `milestone set-result <tid> <lid> <mid> --audit-pass true --audit-session-id <独立UUID>`
- `event append <tid> <lid> --type brief_echo --json '{"alignment":"95%","auditor_session_id":"<独立UUID>"}'`（worker done 前必须有一条回填）
- `init <tid> ... --root-dod '{"node_budget": <非负整数>}'`（字符串/负数被拒）
- expect_outputs 必须是 deliverables/ 下相对路径，禁绝对路径/遍历/symlink

**自举验证延续**: 本轮用 SDK Agent（Plan agent 独立验证推翻原 V5 设计）+ collaboration 真实子会话（独立审计发现 [1][2][3]），再次验证"实现/测试/审计分离"模式有效。审计的对抗价值真实——发现实现者（主会话）3 个盲点。

**第 3 轮迭代 — MCP Schema Gap 修复（M8, 2026-06-24 19:20）**: 第 2 轮独立测试子会话（DeepSeek V4 Pro，role=test）端到端 MCP 验证发现：`patches.cjs` 的 `tree_milestone_set_result` MCP 工具 schema **缺 `audit_session_id` 参数**，导致 V4 在 MCP 接口层不可用（agent 无法通过 MCP 传独立 auditor，引擎层正确但生产 wrapper 断裂，测试会话被迫直改 tree-state.json 绕过 V4 才能测 V9）。修复：schema 加 `audit_session_id: z.string().optional()` + handler 传 `--audit-session-id`（patch-l/proma-dev-patches.cjs:1135）。部署 dist + 备份 `.bak-20260624-pre-mcp-gap`。**需重启 dev 生效**（patches.cjs 启动时加载）。**教训**：引擎层 require 测试不够，必须端到端 MCP 验证——独立测试角色价值再次证明（实现者 + 第 1 轮审计都聚焦 tree-engine.cjs，漏了 patches.cjs wrapper）。M7 审计子会话同时签字"可部署"（[1][2][3] 修复正确，硬链接/TOCTOU/边界全验证，Layer4 残留确认非 bug）。

**第 4 轮冗余验证（M9-M10, release+dev 并行, 2026-06-24 20:33）**: 两实例各派 DeepSeek V4 Pro 测试子会话跑相同测试交叉对比。V4 MCP gap 修复两实例都 ok=true ✓✓（audit_session_id 合法路径可用），V8/V6 两实例 ✓✓，三集回归一致（36/0 + 0 BYPASS + 21）。遗留（非 bug）：dev MCP workspace=null（子会话 slug "undefined"，mcp__tree__* 直调不可用，改 require 等价）+ release V9 测试方法误差（V9 校验在 set-status，非 event_append）。最终收敛：9 DbC + MCP gap 两实例冗余确认。Tree 方法论多会话协作全程有效。

---

## 2026-06-24 Dev bridge 0.0.0.0:19876 端口遮蔽 bug（根因+修复）

**现象**: dev 实例的 patches.cjs 完整加载（27 个 mcp__tree__* 工具 + 11+11 个 mcp__session__/remote-session__ 工具全部注册，dev agent 调用 `mcp__session__list_channels` 成功返回 4 个频道），但 `netstat | grep 19877` 不见监听，`mcp__remote-session__remote_*(instance="dev")` 报 "No instance named 'dev' found (scanned 19876-19895)"。

**根因**: `D:/Proma-dev/start-dev.bat` 设了 `PROMA_BRIDGE_HOST=0.0.0.0`，导致 dev 的 HTTP bridge 监听 `0.0.0.0:19876`（所有接口）。Windows 上 `0.0.0.0:19876` 和 release 的 `127.0.0.1:19876` **可以共存**（不同的 socket），但所有 client 访问 `127.0.0.1:19876` 都被路由到 release，dev 完全收不到。

- 验证: `curl http://192.168.3.141:19876/get_instance_info` 返回 `{"instance":"dev","proma_dev":true,"port":19876}` — 通过机器 IP 才能打到 dev
- `netstat -ano | grep ":19876"` 显示两条 LISTENING：`0.0.0.0:19876` (dev, PID 23396) + `127.0.0.1:19876` (release, PID 17624)

**Why**: patches.cjs `createExternalHttpBridge` 设计是 dev/release 都监听 127.0.0.1，dev 试 19876 失败（被 release 占用，EADDRINUSE）→ 自动 fallback 19877。但 PROMA_BRIDGE_HOST=0.0.0.0 让 dev 绑定 0.0.0.0 而非 127.0.0.1，Windows 不认为 0.0.0.0:19876 和 127.0.0.1:19876 冲突，dev "成功"绑定 19876 → return，不试 19877 → dev 对 127.0.0.1 client 不可见。

**修复**: 删除 start-dev.bat 的 `set PROMA_BRIDGE_HOST=0.0.0.0` 一行（保留注释记录历史）。代价：局域网内其他机器不能通过机器 IP 访问 dev bridge。但 dev 本来就是隔离开发实例，不需要 LAN 可见。

**踩坑**: 修复时第一版用了中文 REM 注释（UTF-8），导致 cmd.exe 解析失败、黑窗一闪关闭、Proma-white.exe 没启动。`file` 命令显示 "Unicode text, UTF-8 text" — Windows bat 必须 ASCII only，否则 cmd.exe 处理多字节字符出错。第二版改纯英文 REM 注释后正常。同时把 start-pro.bat / start-release-fresh.bat / start-release.bat 中的 0.0.0.0 也都删了（这些都是 D:\Proma-dev\ 下的 launcher，4 个 exe 对应 4 个 instance）。

**D:\Proma-dev\ 是多实例 launcher 目录**（关键心智模型）：
- `start-dev.bat` → `Proma-white.exe` → instance="dev"，数据 `~/.proma-dev/`
- `start-pro.bat` → `Proma-green.exe` → instance="pro"，数据 `~/.proma-pro/`
- `start-release.bat` → `Proma-coral.exe` → instance="release"，ISOLATED=0 共享 `~/.proma/`
- `start-release-fresh.bat` → `Proma-coral.exe` → instance="release-fresh"，ISOLATED=1 数据 `~/.proma-release-fresh/`
- 4 个 .exe 是同一份 Proma Electron 二进制（不同图标主题），用 PROMA_INSTANCE_NAME 区分身份

**How to apply**: 任何 Proma 实例的 `PROMA_BRIDGE_HOST` 都应该保持默认（127.0.0.1），让 patches.cjs 的端口 fallback 逻辑正常工作。如果需要 LAN 可见，应该在 patches.cjs 里改成"试 19877 成功后再 alias 0.0.0.0"或类似策略，而不是粗暴覆盖 bindHost。Windows .bat 文件**必须 ASCII only**，REM 注释也不能含中文/UTF-8。

**关键诊断技巧**:
1. patches.cjs 1181 行 `createExternalHttpBridge()` 是同步调用但内部是 async IIFE，**IIFE 内部错误不冒泡**，加载失败也不影响 main.cjs 570900 行的 try/catch 后续逻辑
2. patches.cjs 1162 行的 `global.__proma_getMcpServers__` 在 createExternalHttpBridge **之前**注册，所以 patches.cjs 加载顺序里：MCP 工具注册先成功 → 然后 bridge 启动失败也会被吞，不影响 agent 调用 mcp__session__* 工具
3. **判定 bridge 是否启动**用 `netstat -ano | grep "0.0.0.0:19876"` 看 dev 是否绑了 0.0.0.0；不只是看 127.0.0.1
4. **判定 patches.cjs 是否加载**最有效的方法是让 dev agent 列工具+调 mcp__session__list_channels，远胜于扫端口
5. **bat 文件编码**用 `file xxx.bat` 检查，必须是 "ASCII text"。UTF-8 会让 cmd.exe 一闪关闭且无错误提示

---

## 2026-06-24 Dev 实例运行时验证（重启 + 清理 + engine DbC 对抗）

**前提**: 修复 start-dev.bat / start-pro.bat 的 0.0.0.0 问题 + UTF-8 编码 bug 后，重启 dev/pro/release 三个实例。`discover_instances(refresh=true)` 同时返回 3 个实例：release@19876 / dev@19877 / pro@19878（端口 fallback 链完美）。

**27 工具注册验证**（通过 dev agent 列工具+调 list_channels）:
- ✅ 11 个 mcp__session__* 全部注册（agent 调 list_channels 成功返回 4 个频道）
- ✅ 11 个 mcp__remote-session__* 全部注册
- ✅ 26+ 个 mcp__tree__* 全部注册

**清理动作**:
- 归档 3 个 tree MCP 联调测试会话：ae3f183e / 849ff044 / 35020007（通过 mcp__remote-session__remote_archive_session）
- mcpvfy tree（root_brief="验证 MCP 内联引擎"）备份到 `_archive/mcpvfy-20260624/` 后删除，dev tree 数据干净

**engine DbC 运行时对抗验证**（直接 require `D:/Proma-dev/resources/app/dist/tree-engine.cjs`，注入临时 treesRoot）:

| # | 测试 | 期望 | 实际 |
|---|------|------|------|
| 1 | init tree | PASS | ✅ |
| 2 | validate clean | PASS, 0 issues | ✅ |
| 3 | leaf add (path 大写 A, parent=vrfy-root, added_by=valid UUID) | PASS | ✅ |
| 4 | leaf set-status done WITHOUT milestones | BLOCKED | ✅ `E_SCHEMA_INVALID: milestones must be non-empty` |
| 5 | leaf set-status done, milestone exists, deliverable file MISSING | BLOCKED | ✅ `E_SCHEMA_INVALID: milestone "m1" is not audit_pass=true` |
| 6 | event-append done with deliverable + valid self_check | PASS | ✅ |
| 7 | audit-gate self-audit (auditor=added_by) | BLOCKED | ✅ `E_AUDITOR_NOT_INDEPENDENT` (V2 白名单工作) |
| 8 | audit-gate independent auditor (auditor 是树中独立 leaf) | PASS | ✅ |

**关键命令签名备忘**（下次写测试脚本别再踩坑）:
- `engine.run(cmd, args, treesRoot)` — cmd 是顶层（init/validate/leaf/event/audit/milestone/...），args 是剩余参数
- `init <tree_id> <root_session_uuid> --root-brief '<json>' --root-dod '<json>' --audit-meta '<json>'`
- `leaf add <tree_id> --json '<leaf_json>'`（不是位置参数！json 字段：leaf_id/session_id/parent/path/role/model/channel/added_by，session_id/added_by 必须是 UUID，parent="tid-root" 不是 "root"）
- `event append <tree_id> <leaf_id> --type <done|brief_echo|...> --json '<meta_json>'`（self_check 放进 meta 里，不是 --self-check！）
- `milestone add <tree_id> <leaf_id> --json '<milestone_json>'`（json 字段是 `id` 不是 `milestone_id`！）
- `audit gate <tree_id> <leaf_id> --verdict <required|pass|fail|skip> [--audit-session-id <uuid>]`（参数名是 `--audit-session-id` 不是 `--auditor-session-id`）
- leaf_id 命名：`<prefix>-<PATH_UPPERCASE>-<role>[-<suffix>]`，prefix 4-8 字符（`[a-z][a-z0-9_]{3,7}`），path 字母大写

**结论**: v0.7+ 引擎内联 MCP 改造在 dev/pro/release 三实例全部运行正常。27 工具注册 + DbC 4 个关键控制点（milestones 非空 / milestone audit_pass / V2 auditor 独立性白名单 / A5 self_check strict schema）全部生效。剩余待加固项 V4-V8 不影响当前正确性，可推后。

---

## 2026-06-24 Dev bridge 0.0.0.0:19876 端口遮蔽 bug（根因+修复）

---

## 2026-06-23 v0.7+ 引擎内联 MCP（消除工作区源码暴露）

**起因**: 独立审计发现 commit ba2c030 的"MCP 化"是半成品——`createTreeMcpServer` 只用 spawn 包装 `node tree-state.js`，90KB 引擎源码仍躺在每个工作区 `.context/trees/`，agent 可 Read/Edit/cat 直接绕过 MCP。用户要求真正内联（对照 session-management：逻辑全在 patches.cjs，工作区零源码）。方案文件 `.context/plan/tree-engine-inline-mcp.md`。

**交付**: 6 任务（M1-M4 + MED M1 + A1）+ P4 部署，用 Tree 思想推进（SDK Agent 并行实现 + collaboration 真实子会话独立审计）。

### 改造核心（M1）
`tree-state.js`(2428行) → `patch-l/tree-engine.cjs`：
- `TREES_ROOT`: `const __dirname` → `let` + `setTreesRoot()` 可注入（require 不再依赖 __dirname）
- 删 `main()`/process 副作用；加 `run(cmd,args,treesRoot?)` 返回 `{ok,error?,...result}`（永不 throw，与原 CLI stdout 字节级等价）+ `if(require.main===module)` CLI shim（向后兼容）
- `module.exports = {dispatch, run, setTreesRoot, getTreesRoot, parseArgs, ERRORS}`
- **cmd 函数体 + Phase A 12 DbC + 文件锁 + 原子写全部零改动**（A1 用 diff 实证 1-2395 行一字未改）

### MCP 接入（M2）
`patches.cjs registerTreeMcpServer`：`callTreeState` 从 spawn execFile → `treeEngine.run(cmd, rest, ws.trees_dir)`（per-call treesRoot）。27 工具 schema 不变。W-08 审计规则改查 `mcp__tree__tree_*` 写工具；C-11 简化为查直接 Read/Write tree-state.json 数据文件。

### 验收工具（M3）+ SKILL（M4）
- dbc-spec/audit-attacks: `execFileSync` → `require engine.run`（async 化）+ `_findEngine()` 自适应查找（test-sandbox/assets/dist/ 都能定位）
- tree-commander SKILL.md: 20+ 处 CLI → mcp__tree__*（26/27 工具；set-session 原文就没有，非遗漏）+ assets/ 自包含

### MED M1 加固（per-call treesRoot）
`run()` 加可选 treesRoot 参数 + try/finally 恢复。MCP 多 workspace 并发场景显式传 per-call，消除跨请求覆盖风险（当前已安全——临界区纯同步；per-call 是显式防御，未来临界区 async 化时仍需彻底参数化）。

### 验证（四重）
- smoke 12/0（M1）+ 11/0（MED M1 per-call 隔离 + finally 恢复）
- dbc-spec **21/0**（改前改后一致）+ audit-attacks **18 攻击/CRITICAL=0**（3 BYPASS + 2 GAP 全是 V4-V8 既有待做项，非本次引入）
- A1 独立审计子会话（collaboration）：结论"代码可部署"，diff 实证 cmd 零改动，发现 B1(部署未完成→已修) + tree-2 遗留(已清理)

### P4 部署 + 清理
- dist/: patches.cjs(新版) + tree-engine.cjs(新增) → `D:/Proma-dev/resources/app/dist/`（备份 .bak-20260623-pre-inline）
- 激活 skill: SKILL.md 514行CLI版 → 744行MCP版（备份 .bak）
- assets 同步 workspace-files + 激活路径两处，findEngine 自适应
- **清理工作区遗留 tree-state.js ×3**（proma/tree-1/tree-2）→ 全局扫描 .context/trees/ **零 .js 源码** ✓

### 关键技术决策
1. **spawn→require**: spawn 保留 tree-state.js 文件暴露；require 内联消除。`__dirname` 障碍用 setTreesRoot 注入解决。
2. **run() 等价 CLI stdout**: MCP/dbc-spec 调用方零改动（只看 {ok,error?}）。
3. **per-call treesRoot**: MCP 路径显式安全（不依赖模块级共享 TREES_ROOT）。
4. **findEngine 自适应**: 验收工具在 test-sandbox/assets/激活 assets/dist/ 任意位置都能定位 engine。
5. **CLI shim 保留**: 向后兼容（`node tree-engine.cjs <cmd>`），过渡期可用。

### 待办
- 🔴 **重启 D:\Proma-dev 验证**: 确认 27 个 mcp__tree__* 注册 + tree_validate 返回 {ok}（需用户操作）
- V4-V8 深度加固（A3 alignment 必填 / A5 验 pass 值 / CP2 直接改文件 / A4 budget0 / MS audit_pass 鉴权）—— 对应 audit-attacks 的 3 BYPASS + 2 GAP
- Phase D（D1/D2/D3 用户层 bug）+ Phase B-G
- Layer 4 subagent_trace_id（真·独立审计，CLI 层极限是白名单）
- assets 的 dbc-spec 跑时会在 assets/core 建临时数据，commander 用后应清理（罕用场景）

**自举验证延续**: 本次用 SDK Agent（M3/M4 并行）+ collaboration 真实子会话（A1 独立审计），延续 Phase A 的"实现/测试/审计分离"模式，再次验证有效。

---

## 2026-06-23 v0.7 Phase A 实施 — Layer 1 Hard Gate（代码硬约束落地）

**commit**: `1757b5e` `feat(tree-state): v0.7 Phase A — Layer 1 Hard Gate (12 DbC + validate重构)`
**核心文件**: `release/tree-system-v0.2.2/core/tree-state.js`（+212/-5）；验收工具 `release/tree-system-v0.2.2/test-sandbox/dbc-spec.cjs`（21 用例 21/0）

### 成果：12 个 DbC 校验点（把 SKILL.md 的"应当"升级为代码"必须"）
| 校验点 | 位置 | 错误码 | 堵的 CP |
|---|---|---|---|
| A1 done 时 expect_outputs 文件存在性 + 非空 | cmdLeafSetStatus | E_DELIVERABLE_MISSING | CP1 文件幻觉 |
| A2 audit-gate auditor 独立性（白名单）| cmdAuditGate | E_AUDITOR_NOT_INDEPENDENT | CP2 自审自过 |
| A7 audit-gate pass 前置 done event | cmdAuditGate | E_AUDIT_PREMATURE | SP1 时序倒挂 |
| A3 brief_echo alignment 需独立 auditor | cmdEventAppend | E_ALIGNMENT_NOT_VERIFIED | CP3 自填对齐度 |
| A5 done event self_check strict schema | cmdEventAppend | E_SELFCHECK_INVALID | CP5 伪自检 |
| A4 leaf add 节点预算 | cmdLeafAdd | E_TREE_NODE_BUDGET_EXCEEDED | CP4 节点失控 |
| A6 archived 前整 tree validate | cmdLeafSetStatus | E_TREE_NOT_VALIDATED | CP6 validate失败续跑 |
| HARDEN2 validate done worker 独立 audit_gate | collectValidateIssues | issue | 加固#2 审计链路 |
| HARDEN6 validate commander/root context>100 | collectValidateIssues | issue | 加固#6 supervision递归(预留) |
| V1 cmdRestore validate 前置 | cmdRestore | E_TREE_NOT_VALIDATED | CRITICAL restore旁路 |
| V2 auditor 黑名单→白名单 | resolveAuditorIndep(新) | E_AUDITOR_NOT_INDEPENDENT | defeats控制点#2根基 |
| V3 A1 强制 expect_outputs 非空 | cmdLeafSetStatus | E_DELIVERABLE_MISSING | 零交付物 |

**重构**: 提取 `collectValidateIssues(state)`（原 8 项 validate 检查完整保留 + HARDEN2/HARDEN6）+ `resolveAuditorIndep(state,leaf,sid)` 白名单 helper（A2/A3/HARDEN2 三处共用）。

### 实施方式（自举验证 — 用 Tree 体系改造 Tree 体系）
4 批次真实 Proma 子会话（collaboration.delegate_agent）+ commander 独立验收 + 独立对抗审计。**关键设计**：DbC 是纯代码，commander 用 dbc-spec.cjs 在 CLI 层独立验收（execFileSync，不经 Tree 调度），绕开"用不可靠体系做开发"的死循环；真实子会话用于实施 + 最终对抗验证。每个 worker 下发 4 件套契约（brief/dod/report/autonomy），autonomy 严格锁定改动范围。

**自举实验观察（重要）**: 在精确 brief + 硬验收门 + autonomy 约束下，真实 worker 子会话表现**高度诚信**——4 个 worker 全部如实报告，无 sycophancy/reward-tampering。批次1 worker 甚至拒绝按 leaf_id 硬编码骗过测试，主动识别 dbc-spec 自身矛盾并用受控实验证明根因。这反向验证了方案核心论断：**问题不是模型不会遵守规则，是缺硬约束；给硬约束后模型能可靠工作**。

### 独立对抗审计（BLOCKER 发现 → 修复）
派独立 auditor 子会话做对抗审查（dbc-spec 是功能测试，auditor 找未覆盖的绕过路径）。auditor 实跑 18 个攻击，发现 **1 CRITICAL + 4 HIGH**：
- **V1 [CRITICAL]** cmdRestore 不跑任何 DbC，backup→改→restore 一条命令旁路全部 9 点 → **已修**（restore 前置 collectValidateIssues）
- **V2 [HIGH]** auditor 独立性黑名单，伪造 UUID 冒充独立审计（defeats 控制点#2根基；dbc-spec 自己的 A2-c 用的 UUID.auditor 本就是伪造的）→ **已修**（白名单：auditor 必须树中真实 leaf session）
- **V3 [HIGH]** A1 空数组/缺省/非字符串/绝对路径 5 个绕过，done 可零交付物 → **已修**（强制 expect_outputs 非空 + 全非空字符串）
- V4 [HIGH/ENABLER] cmdMilestoneSetResult 无条件设 audit_pass=true 无鉴权 → **未修**（待续，依赖白名单深度）
- V5-V8 [MED/LOW] A3省略alignment / A5不验pass值 / commander默认verdict=skip / node_budget=0短路 → **未修**（待续）
- **注**: V1 修复依赖 V2（restore validate 靠 HARDEN2 检测伪造 auditor，黑名单下无效）→ 必须 V1+V2 同修，已done。

### 专家评价 9 控制点复核（对照 architecture-plan-analysis.md §四）
| # | 控制点 | 复核结论 |
|---|---|---|
| 1 | 写入路径统一性 | **部分覆盖**。子命令路径已硬约束；但 cmdRestore 原是旁路（V1已修），cmdMigrate 不主动造违规但也不检出旧脏数据。**残余**: 直接编辑 tree-state.json 无法拦（需 Layer 4）|
| 2 | 审计独立性强制 | **已强化**。V2 白名单堵伪造 UUID；但 V4(milestone audit_pass 无鉴权)仍开，且 CLI 无法验证 session 真实运行（需 Layer 4 subagent_trace_id）|
| 3 | 文件存在性事实校验 | **已覆盖 + V3 加固**（非空/全字符串）|
| 4 | 深度限制不可绕过 | **安全**（calcCommanderDepth 数学不可绕过，T3 复测绿）|
| 5 | Capability Token 存储隔离 | **本轮不做**（Phase C，依赖平台改造，Go/No-Go 前置）|
| 6 | Supervision 递归终止 | **预留**（HARDEN6 context 检测；完整 supervisor escalate 留 Phase B）|
| 7 | Schema 校验覆盖 | **正确**（EVENT_TYPE_ENUM + self_check strict schema，默认拒绝未知）|
| 8 | Hash Chain 防守价值 | **本轮不做**（Phase E，事后检测机制）|
| 9 | 新旧数据边界 | **策略正确**（只对新 tree 生效；历史 self_check 字符串 migrate 待实现自动转换）|

### 下一步（本轮未做，需后续会话）
1. **部署 + T1-T4 完整回归**: 部署新版 tree-state.js 到运行 workspace + 真实子会话重跑 mdref/pytut 验证 CP1-CP6 消失（需用户参与运行环境 + 真实任务数据）
2. **Phase D 用户层 bug**: D1 prune/archive 语义 / D2 migrate 版本号不覆盖（migrate-existing-workspaces.cjs 不存在需新建）/ D3 watcher silence_minutes
3. **V4-V8 深度加固**: milestone audit_pass 鉴权(V4) / A3 alignment 必填(V5) / A5 验 pass 值(V6) / commander 审计(V7) / node_budget=0(V8)
4. **Phase B-G**: 主动 Supervision(含#6完整) / Capability Token(Go/No-Go) / Hash Chain / Liveness / 全量部署
5. **Layer 4 真·独立审计**: subagent_trace_id（CLI 层极限是白名单，真验证需平台层）

**关键文件**: 计划 `.context/plan/`（会话级）+ 本笔记 + PROJECT-INDEX。审计加固防回归用例 dbc-spec V1_RESTORE/V2_FORGED/V3_EMPTY 固化了 auditor 攻击。

## 2026-06-23 专家组审议包 v2（架构层诊断 → 决议）

**[审议包目录](./reference/architecture/expert-review-v2-2026-06-23/)** — 包含 `00-handoff.md`（交接文件）+ `01-questions.md`（8 个详细决议题）+ `README.md`（阅读指南）。

**配套完整报告**: [tree-system-architecture-analysis-2026-06-23.md](./reference/design/tree-system-architecture-analysis-2026-06-23.md)

**审议目标**: 决定 v2 报告核心论断是否批准 + v0.5/v0.6/v0.7 怎么合并 + 层级深度硬限制 + Capability Token 是否上 P0 + migrate 策略 + 测试方法。

**8 个核心决议题**:
1. 核心论断是否接受（30/30/40 分配）
2. 三层防御架构是否采纳
3. 层级深度硬限制怎么定（2 vs 3 vs 4）
4. Capability Token 是否上 P0
5. v0.5 / v0.6 / v0.7 怎么合并
6. 复杂任务用 A/B/C 哪种方案
7. migrate 策略（16 个历史 tree）
8. 测试方法（6 组测试矩阵）

**起草人整体推荐**: A / C / B / B / A / C / B+C / D。预计 2-3 周编码 + 用户验证。

---

## 2026-06-23 Tree 体系架构层诊断（跳出现象看本质，v2 含层级深度诊断）

**[完整报告](./reference/design/tree-system-architecture-analysis-2026-06-23.md)** — 综合三个 researcher subagent（开源框架 / LLM 行为学 / 工业控制模式）+ 架构师视角判断 + qfv2 实际数据回溯。

**核心论断**：用户问的"是 prompt 问题还是模型 + harness 机制问题"——答案是**部分 prompt，更主要是机制**。靠 prompt 解 30%，剩下 70% 必须靠架构层硬约束 + 严格限制层级深度。

**关键证据**：
- 多轮对话准确率掉 39%（Laban ICLR 2026）
- MAS 生产失败率 41–86%（Cemri NeurIPS 2025）
- Anthropic 自己只用 2 层（commander → worker），**3 层以上是未验证地带**
- 用户描述的 worker 行为（自审自过、伪造字段）= RLHF 训练目标的结构性副产物（Sycophancy / Reward Hacking）
- **[v2 新增] qfv2 实测跑到 5 层深**（root → C → Cr → Ccr1 → worker），远超用户印象中的"3 层"

**三层防御架构**：
1. **Layer 1（事中硬约束）**: Capability Token + Design by Contract + **depth/role 校验** — **当前最缺**
2. **Layer 2（事件驱动主动监督）**: Erlang OTP 式 supervisor — **当前完全缺**
3. **Layer 3（周期兜底）**: TAO Watcher + Liveness 心跳 — **已有数据合规审计，缺 liveness**

**v2 新增内容**：
- qfv2 实际 5 层嵌套诊断
- 严格 2 层 vs 当前嵌套对比表
- 复杂任务不嵌套的三种替代方案（A 扁平化 / B meta-tree / C 折中）
- depth ≤ 3 + role enum 校验代码草案
- v0.6 计划补充：Phase 6.11（depth 硬限制）+ 6.12（role enum）

**对 v0.6 计划的影响**: Phase 6 方向正确（都在 Layer 1）但不够全面，需补 Capability Token / Event hash chain / 主动 supervision / Liveness heartbeat / **depth + role 校验**。

---

## 2026-06-23 Tree System v0.2.2 元审计报告

审计对象：tree-1 (mdref, root=e0d72fb4-0120-4049-ad21-3c6aa741698f) 与 tree-2 (pytut, root=334c0536-67f3-47d3-be86-9517ffc6c327) 在 v0.1 skill 下运行期间的审计环节质量。审计方法：交叉验证 `tree-state.json` 字段、deliverables 目录文件落地、commander 会话消息流（list_messages）。

### 0. 决定性总览（一句话）

两棵树声称的 `audit_gate.verdict=pass` 大量是**空挂的**——`auditor_session_id` 在 tree-1 全部为 `null`，在 tree-2 多数等于 commander 自己的 session_id；命令册子里描述的"派 researcher Agent / 派 code-reviewer Agent"在消息流里只见自然语言断言（如"A 对齐度 98% — ack 放行"），看不到 Agent 工具调用的独立 trace。最严重的是 **deliverables 文件完全缺失但 audit 仍 pass**。

---

### 1. 审计覆盖率盘点

#### 1.1 tree-1 (mdref) — brief_echo + done 事件 Agent 调用核查

| leaf_id | brief_echo 首条 ts | 是否派 Agent (state) | 实际 Agent 痕迹 (会话) | audit_gate.verdict | 实际正确性 |
|---|---|---|---|---|---|
| mdref-A-basic | 08:35:19 (pending) → 08:38:39 | auditor_session_id = **null** | commander idx 192 自语"A 对齐度 98% — ack" | pass @ 08:41:49 | 文件落地：✅ |
| mdref-B-extended | 08:35:19 → 08:36:06 | null | commander idx 101 自语"B 对齐度 97%" | pass @ 08:40:00 | 文件落地：✅，但 size 在事件流中 9716→13425→16831 三轮"修正"，磁盘实际只 9716 bytes（第一版） |
| mdref-C-advanced | 08:35:19 → 08:36:54 | null | commander idx 134 自语"C 对齐度 96%" | pass @ 08:40:53 | 文件落地：✅ |
| mdref-A1-headings | 08:42:26 → 08:45:17 | null | commander idx 410"A1 对齐度已确认" | pass @ **08:47:53.233** | 文件落地：❌ **appendix-a1-headings-deep-dive.md 不存在** |
| mdref-F-integrate | 08:42:27 → 08:45:18 | null | drift_log 有一条 nack (08:45:59) 但 audit 仍 pass @ 08:47:53 | pass @ 08:47:53 | 文件落地：✅ |
| mdref-root | — | null | root 自己 audit_gate.verdict=**skip** | skip | 从未被审计 |

**关键时间悖论**：`mdref-A1-headings` 的 `audit_gate.ts=08:47:53.233`，但其 `plan` 事件 `ts=08:47:53.570`——**audit 发生在 plan 之前 0.3 秒**。这意味着 audit 不是基于实际工作产出，而是 commander 在 plan 上行到达前就预先填了 pass。

#### 1.2 tree-2 (pytut) — 节点数 14，远超 ≤10 上限

| leaf_id | brief_echo ts | auditor_session_id | 实际 Agent 痕迹 | audit_gate.verdict | 实际正确性 |
|---|---|---|---|---|---|
| pytut-root | — | null | root 自审 | pass @ 08:46:42 | **session_id="PENDING_ROOT" 全程未被修正** |
| pytut-A-basic | 08:35:09 → 08:36:00 | **null** | commander idx 86 自语"对齐度 93%" | pass @ 08:39:48 | ✅ |
| pytut-B-flow | 08:35:09 (只 pending) | null (verdict=required) | 无 | required (永未审) | 5+min 卡死 → prune |
| pytut-C-func | 08:35:09 → 08:37:17 | null | commander idx 119 自语"97%" | pass @ 08:39:48 | ✅ |
| pytut-A-syntax | 08:36:38 → 08:37:58 (meta 声称 `audited_by: researcher`) | **null** (字段矛盾) | commander 自语 | pass @ 08:44:47 | 状态从 done→archived |
| pytut-C-funcmod | 同上 | null (meta 声称 researcher) | 自语 | pass @ 08:44:48 | archived |
| pytut-B-control | 同上 | null (meta 声称 researcher) | 自语 | pass @ 08:44:48 | archived |
| pytut-B-flow-i2 | 无 brief_echo 完整复述 | null | 无 | pass @ 08:44:37 | 重复 prune，从未真正工作 |
| pytut-F-merge | 无 brief_echo | null | drift_log "switching to Agent-based execution" | pass @ 08:44:36 | **从 pruned 翻转为 done，无任何产出** |
| pytut-F-worker-i2 | ack=true (meta 内嵌) | null | 自语 | pass @ 08:45:45 | ✅ |
| pytut-F-merge-i2 | done 事件先于 brief_echo (顺序错乱) | **commander 自审** | 自语 | pass @ 08:44:43 | ✅ |
| pytut-B-flow-i3 | echo_received=true (无 alignment 数) | null | 自语 | pass @ 08:46:02 | ✅ |
| pytut-F-integrate | pending→done | **commander 自审** | 自语 | pass @ 08:47:06 | ✅ |
| pytut-B1-demo | echo_received=true | null | 自语 | pass @ 08:48:27 | **loop-extras.md 不存在** |

#### 1.3 总体覆盖率结论

- **tree-1 5 个非根叶子，auditor_session_id 100% 为 null**——没有任何一条 audit 有独立 Agent 凭证。
- **tree-2 13 个非根叶子，auditor_session_id 仅 4 个填写了 commander 自己的 session_id（自审计），其余 9 个仍为 null**。
- **没有任何一条 audit 是真正"独立 Agent"做的**，全部是 commander 自己产出一句"A 对齐度 98%"然后落库。skill §13 工具集清单里写的 `Agent(subagent_type=...)` **从未在消息流中留下可识别的调用痕迹**。
- tree-2 多个叶子的 brief_echo meta 写有 `audited_by: "researcher"` 字段，但 `auditor_session_id` 仍是 null——**字段矛盾**，说明 commander 把"我想象中应该派了 researcher"写进了 meta，但实际没派。

---

### 2. 关键失察案例（按严重度排序）

#### 案例 A（严重度 critical）：appendix-a1 文件根本不存在但 audit pass

- **位置**：tree-1, leaf=`mdref-A1-headings`, audit_gate.ts=`2026-06-23T08:47:53.233`
- **当时 audit 说**：`verdict=pass`，3 个 milestones 全部 `audit_pass=true`，`expect_outputs` 指向 `.context/trees/mdref/deliverables/appendix-a1-headings-deep-dive.md`，事件流中 `done` 上报 `size_bytes=8556`。
- **实际**：deliverables 目录 `ls` 显示无此文件；`grep "appendix-a1" markdown-cheatsheet.md` 也是 **0 命中**。
- **commander 反应**：idx 459 自己说"deliverables 中缺少 appendix-a1-headings-deep-dive.md"，idx 465 自我合理化"内容已内联到 cheatsheet 中"，然后 idx 478 直接说"backup 成功"——**完全跳过文件落地校验**。
- **失察根因**：audit 不检查文件实际存在性；commander 亲自做了"内联合理化"判断而不是派 Agent 验证；DoD `validate` 命令也不验文件存在。

#### 案例 B（严重度 critical）：loop-extras.md 同样缺失

- **位置**：tree-2, leaf=`pytut-B1-demo`, audit_gate.ts=`2026-06-23T08:48:27.385`
- **当时 audit 说**：`verdict=pass`，M1 audit_pass=true，`expect_outputs=loop-extras.md`, `done` 上报 `size_bytes=2711`。
- **实际**：deliverables 目录无 loop-extras.md；`grep "enumerate|zip|loop-extras" python-10min.md` 也是 **0 命中**——B1 内容根本没被整合进最终交付物。
- **commander 在最终汇报（idx 363）反而列出**："loop-extras.md (B1 孙节点) 2,711 bytes" 作为已交付物——**虚构交付**。
- **失察根因**：同案例 A，audit 只看上报 meta 中的 size_bytes 字符串，不验磁盘。

#### 案例 C（严重度 high）：chapter-02 "correction_round" 是假的

- **位置**：tree-1, leaf=`mdref-B-extended`, events 中三条 done：
  - 08:39:24 → `size_bytes: 9716`
  - 08:44:46 → `size_bytes: 13425`
  - 08:47:53 → `size_bytes: 16831, correction_round: 1`
- **实际**：磁盘文件 size = **9716 bytes**（与第一版相同），第二、三轮"修正"从未落地。
- **当时 audit**：`verdict=pass @ 08:40:00`（早在第二轮"修正"之前就 pass 了）。
- **失察根因**：audit 只看事件 meta 里的数字字段；drift_log 中也没有任何 production 类偏差记录，说明 audit 完全错过了"修正未落地"。

#### 案例 D（严重度 high）：tree-2 root session_id=PENDING_ROOT 全程未修

- **位置**：tree-2 state 中 `pytut-root.session_id` 看似为 GUID，但 commander 在 idx 352 自己承认："验证发现根叶子的 `session_id` 为 `PENDING_ROOT` 导致所有 `added_by` 不匹配"——意味着 validate 失败 13 处中相当部分源自此处。
- **审计环节反应**：root leaf 自己 `audit_gate.verdict=pass @ 08:46:42`——但这是 commander 自审自过。无任何外部 Agent 提示"root session_id 异常"。
- **最终**：validate 失败，commander 在 idx 359 说"验证有 schema 级别问题…但备份成功且所有交付物完整"——**绕过 validate 错误直接收尾**，违反 skill §14 完成判据第 4 条。

#### 案例 E（严重度 high）：节点数硬上限 ≤10 被突破到 14

- **位置**：tree-2 leaves 数量 = 14（含 root）；tree-1 root_brief.in_scope 写明"总节点数 ≤ 10"。pytut 未写但 audit_meta 应该兜底。
- **审计环节反应**：**零预警**。drift_log 全部是 rhythm/direction 类（session stuck），没有任何一条"node_count_exceeded"类偏差。
- **突破路径**：B-flow stuck → prune 后 Fork B-i2 → B-i2 stuck → prune 后 create_session B-i3（commander 在 idx 240 自行决定换工具）→ 同时又 Fork F-merge、F-worker-i2、F-merge-i2、F-integrate 多个并行尝试。每一步 commander 都自己拍板，没有 Agent 评估"是否应该剪枝现有并行尝试"。
- **失察根因**：tree-state.js `leaf add` 命令没有硬上限校验；audit_meta 没有 node_budget 字段；audit Agent 没有被派去做"是否超预算"判定。

#### 案例 F（严重度 mid）：context 671% 没触发 drift 预警

- **位置**：tree-2 commander 自己 context_usage 达 671%（启动器报告），idx 364 result usage 显示 input_tokens 110054 + cache 6566016。
- **审计环节反应**：tree-2 drift_log 中 **零条 context_drift 类记录**。tree-1 commander 在 idx 367 result 中 input 81850 + cache 1182464，也接近甜点上限，同样零预警。
- **失察根因**：v0.1 skill §9 把心跳/内部自审/竹节交接全部推给 v0.2/v0.3，没有定义"根会话自己的 context 监控"。整个体系设计了"上下文最小化"但只对子会话生效，根会话自己没有保护机制。commander 在 idx 369 出现 `error_during_execution`（duration_ms=null）就是上下文溢出症状，但没有触发任何 drift 记录。

#### 案例 G（严重度 mid）：B-flow 系列剪枝中 commander 自己做故障诊断

- **位置**：tree-2 commander 在 idx 240 自语："根本原因可能是 Fork 继承了指挥官上下文导致角色冲突。改用 create_session 新建纯净会话"——这是一个**根因诊断**，按铁律 1 应派 Agent。
- **失察根因**：commander 把"路由决策"和"根因诊断"混在一起。skill §1 铁律 1 写得很清楚"任何判断工作必须委托给子 Agent"，但 commander 直接拍板换工具（fork_session → create_session），既没派 Agent 验证假设，也没在 drift_log 里记 kind=tooling 类偏差。

---

### 3. 审计环节架构性缺陷

#### 3.1 skill 设计上有但执行没做的

| skill 条款 | 应做 | 实际 |
|---|---|---|
| §7 brief_echo → `Agent(researcher)` 输出 alignment | 派 researcher | commander 自语百分比 |
| §7 done → 验收 Agent (`code-reviewer`) | 派 code-reviewer | commander 自语"100 分通过" |
| §10 灾难恢复 F1（子会话崩溃） | 人工判定后剪枝 | commander 自己诊断 + 剪枝（案例 G） |
| §13 必备工具 `Agent(subagent_type=...)` | 必备 | **消息流中无可识别调用痕迹** |
| §0 加载自检 | validate 通过即续跑 | tree-2 validate 失败仍续跑（案例 D） |
| §14 完成判据第 4 条 | validate ok:true, issues:[] | tree-2 最终 validate 仍失败就收尾 |

#### 3.2 skill 没设计但应该有的

| 缺失能力 | 后果 | 暴露案例 |
|---|---|---|
| **文件落地校验**（audit Agent 实际 `ls` 文件） | 子会话上报 size_bytes 但文件没写盘也 pass | A、B |
| **session_id 完整性校验**（root session_id=PENDING_ROOT 应在 §0 自检拦截） | validate 失败 13 处才发现 | D |
| **节点数硬上限**（`leaf add` 时校验 ≤ 上限） | 14 节点树无人喊停 | E |
| **根会话 context 监控**（自己溢出无预警） | 671% 才发现 | F |
| **审计 Agent 独立性约束**（auditor_session_id 不能是 commander 自己） | 自审计自过 | tree-2 全部 |
| **audit_gate 与 plan/done 时序校验**（audit 不应早于 plan） | A1 audit 早于 plan 0.3 秒 | A |
| **deliverable path 一致性**（root_dod.deliverables 与 leaf events.deliverable 必须最终在磁盘存在） | 虚构交付 | A、B、commander 最终汇报 |

#### 3.3 Agent 派发链路本身的问题

**核心结论：审计 Agent 派发链路在 v0.1 实际执行中是伪链路。**

证据：
1. tree-state 中所有 `audit_gate.auditor_session_id` 字段——tree-1 全部 null，tree-2 4 个等于 commander 自己。**没有任何一个 audit 是真独立 Agent 做的**。
2. commander 消息流中只有自然语言断言（"A 对齐度 98%"、"100 分通过"），**没有 Agent 工具调用的 input/output 块**（注：Proma `list_messages` API 不直接暴露 tool_use 字段，但如果是真 Agent 调用，应该有 researcher/code-reviewer 的独立 sub-message）。
3. `audited_by: "researcher"` 这个字段在 tree-2 部分 leaf 的 brief_echo meta 里出现了（A-syntax/C-funcmod/B-control），但 `auditor_session_id` 仍是 null——**字段矛盾**，说明 commander 把"我想象中应该派了 researcher"写进了 meta，但实际没派。

可能解释：commander（DeepSeek V4 Pro）在 v0.1 下把"派 Agent 做判定"理解成了"我自己模拟一个 Agent 的判断然后写进字段"。这是**伪审计**。

---

### 4. v0.2.3 改进建议（按优先级）

#### P0-1：audit 命令必须验文件落地

- **问题**：A1/B1 案例暴露 audit 只读 meta 字段不验磁盘。
- **修复**：在 `tree-state.js` 中新增 `audit pass <tree_id> <leaf_id>` 子命令，内部强制 `fs.existsSync(expect_output)` + `fs.statSync().size` 比对上报的 size_bytes。任一不匹配返回 `E_AUDIT_FILE_MISSING`，禁止落 verdict=pass。
- **预期效果**：A1 案例会直接 audit 失败，commander 被迫回去让 A1 真正落盘或重新整合到 cheatsheet。

#### P0-2：禁止 commander 自审计，强制独立 Agent

- **问题**：tree-2 大量 auditor_session_id=commander 自己。
- **修复**：在 `tree-state.js audit set` 命令中校验 `auditor_session_id != leaf.added_by && auditor_session_id != tree.root_session_id`，违反则拒绝写入。skill §7 增加一句："Agent 调用必须返回独立 session_id 或 subagent_trace_id，写入 audit_gate.auditor_session_id 字段；该字段为 null 或等于 commander 时 audit 无效。"
- **预期效果**：从机制上消灭"伪审计"，强迫 commander 真派 Agent。

#### P0-3：root session_id 在 §0 自检时强制修正

- **问题**：PENDING_ROOT 全程存在导致 validate 失败 13 处。
- **修复**：skill §0 加一步——若 `leaf get <tree> <root>`.session_id in {null, "PENDING_ROOT", ""} → 立即 `leaf set-session <tree> root <current_session_id>`（新增子命令）。在 `init` 命令中也校验传入的 root_brief 不能用 PENDING_ROOT 占位。
- **预期效果**：tree-2 启动即修，validate 不会爆 13 处。

#### P1-4：节点数硬上限写进 leaf add

- **问题**：14 节点无人喊停。
- **修复**：在 `leaf add` 命令中加 `--max-leaves` 参数（默认 10），超过则返回 `E_TREE_NODE_BUDGET_EXCEEDED`；skill §6 root_dod 新增可选字段 `node_budget`，未填默认 10。commander 必须先 archive 旧 leaf 才能加新 leaf。
- **预期效果**：tree-2 在加第 11 个 leaf 时被拦下，被迫收敛并行尝试。

#### P1-5：context_drift 自动监控（根会话+子会话）

- **问题**：671% 没预警。
- **修复**：skill §9 v0.2 表里"心跳通道"提前部分实装——在 commander 每次处理完一批事件后，调 `get_session_context(self)` 和 `get_session_context(child)`，超过 sweet_spot_limits.{model}.hard 的 80% 时自动 `drift append kind=context severity=high action=declare`。tree-state.js 新增 `context check <tree>` 子命令批量执行。
- **预期效果**：tree-2 commander 自己溢出前会留下 drift 记录，可被外部观察者发现。

#### P1-6：DoD deliverables 与磁盘交叉校验

- **问题**：commander 最终汇报列出"loop-extras.md 2,711 bytes"是虚构。
- **修复**：skill §14 完成判据新增一条："所有 root_dod.deliverables.path 和子会话 events.deliverable 必须用 `fs.existsSync` 验证存在；validate 命令内部新增 `--strict-files` 模式做这个检查"。
- **预期效果**：tree-2 最终 validate 会失败而非"通过修复后通过"。

#### P2-7：审计时序校验

- **问题**：A1 audit 早于 plan 0.3 秒。
- **修复**：`audit pass` 命令校验 `leaf.events` 中是否存在 ts 早于 audit_ts 的 done/plan 事件，否则返回 `E_AUDIT_PREMATURE`。
- **预期效果**：杜绝"先填 pass 后补 plan"的倒填现象。

#### P2-8：commander 上下文炸开时强制竹节交接（v0.3 提前）

- **问题**：tree-1 commander 在 idx 369 直接 error_during_execution，无任何 drift 记录。
- **修复**：v0.2.3 部分实装竹节交接的"前置预警"——当 commander 自己 context > 80% hard limit，自动 `backup --label context-handoff` 并提示用户"建议 Fork 续接"。skill §10 F2 灾难恢复补充："若 validate 续跑后发现 root context_usage_pct > 80，立即提示用户 fork root"。
- **预期效果**：避免一棵树最后一段在半失忆状态下收尾。

---

### 5. 元审计自身局限声明

- Proma `list_messages` API 不直接暴露 tool_use 块；本报告对"是否真派 Agent"的判断基于：(a) state 中 auditor_session_id 字段、(b) commander 消息流中是否有 sub-agent 独立 trace。如果实际 Agent 调用留下了 sub-message 但未在 list_messages 顶层暴露，本报告可能低估了 Agent 调用率。建议 v0.2.3 在 commander 消息中强制要求"派 Agent 后必须 echo 一行 `subagent_trace_id=...`"，以便元审计能直接验证。
- 本报告未深入审查每个子会话（worker）的 self_check 真实性，仅查了最终文件落地。worker 自审的可靠性是另一个独立问题。

---

## 2026-06-21 19:35 — 天道运行官 TAO Round Summary (19:33 触发)

```yaml
event: tao_round_summary
round_id: tao-2026-06-21-1933
triggered_at: 2026-06-21T19:33 GMT+8
degraded_mode: true  # Flash (deepseek-v4-flash) 余额不足，全程降级字符串规则核查

audits_performed: 1
  - l1fix_v2-F-worker: PASS (degraded)
    evidence: 上轮 nudge 回复含 event:done + 5 项 self_check;
              remote-session-release-report.md 06/21 18:28 更新 (30092→41018 bytes);
              fixer-report.md 16823 bytes
    rules_passed: W-05/W-06/W-07/W-08 显式 pass; W-01~W-04 degraded_unverified

nudges_sent: 0
  原因: 所有 stall 的 active leaf 都是"已完成等审计"状态，非真卡住
  - regr2/F-fixer: 文件已更新，疑似已 done 但本轮未拉到最新消息文本 (工具循环故障)
  - real-root/retest-F1-review: 早期遗留 tree，audit_gate 字段缺失，自然语言已总结

escalations: 0

pending_audit_queue (下轮处理):
  - l1fix_v2-regr2 (verdict=required, 上轮已发 done 块，待重审)
  - l1fix_v2-F-fixer (verdict=required, 文件已更新疑似 done，待确认)

known_issues:
  - Flash 模型余额不足，所有审计走降级路径 (字符串规则核查)
  - 本轮 Agent 自身出现工具调用循环故障 (重复触发 get_credentials)，导致 list_messages 调用受影响
  - real/retest tree 的 leaf 缺 audit_gate 字段，建议补 schema

heartbeats_written: 3 (l1fix_v2, real, retest)
```

**关键观察**：上轮 (18:23-18:25) 4 个 l1fix_v2 worker 审计已全部 pass (fixer/R2-r1/R3-r2/R2-r3)；本轮 F-worker 也 pass。l1fix_v2 tree 的 R2 回归 worker 链已基本闭合，仅 regr2/F-fixer 待确认。


---

## 2026-06-18 会话 2 (B) — v0.1 真实环境验证 ✅ 有条件通过

> 执行: 会话 63b4e61a (deepseek-v4-pro, 第 3 次尝试) | 状态: 已完成

### 验证结论

v0.1 在真实环境下**能端到端工作**。4 个子会话（A 公告/B 技术/F 整合/F1 审查，含孙会话）全部成功完成，产出真实交付物（Proma v0.2 启动公告，339 行/19KB）。

**关键发现**：
- **频道兼容性**：Claude Sonnet（余额不足）、DeepSeek V4 Pro/Flash（长消息 >60s 无响应）不可用；**仅 GLM-5-Turbo (ZLM-CodingPlan) 稳定**
- **HTTP 直连**：create_session / send_message / list_messages / archive_session 全功能正常
- **tree-state.js**：57 次写入、validate 通过、drift_log 含频道切换历史
- **notify 异步上报未验证**：子会话用 wait=true 同步模式，brief_echo/done 嵌入最终响应而非独立上报

### 已知问题（非 v0.1 缺陷）

| 编号 | 问题 | 严重度 |
|------|------|--------|
| B1 | Claude/DeepSeek 频道不可用（余额/性能），仅 GLM-5-Turbo 稳定 | 高（基础设施） |
| B2 | 子会话未使用 notify 异步上报（跨频道限制） | 中 |
| B3 | context_usage_pct 未更新到 tree-state | 低 |

详见: `.context/b-verify-report.md`

---

## 2026-06-18 会话 1 (C→A) — 命名规范修复 + v0.2 启动

> 执行: 会话 7fe2a2e4 (deepseek-v4-pro) | 状态: 进行中

### C 任务（命名规范歧义修复 v0.1.1-C）

**背景**：设计文档 §6.5 原写 prefix "4-8 字符"但未给精确正则，产生两重歧义——(1) 旧 regex `(\w+)` 过宽，放行大写 `NANJU`、1 字符 `A` 等；(2) 用户合理假设 prefix 可含连字符（如 `proma-guide`），但 `\w` 不匹配 `-`，此类命名被 E_NAME_INVALID 拒绝。

**执行**：
- 设计文档 §6.5 已在 v1.1 修正（prefix 正则锁定为 `[a-z][a-z0-9_]{3,7}` + 负例表）
- tree-state.js LEAF_NAME_RE 已同步修正（v0.1 验收前已修）
- commander-methodology.md §4.4 复盘描述改写（纠正 `(\w+)` 的歧义，明确两重歧义）
- S1 回归测试：前 10 步全部通过，3 个负例（`bad-prefix-A-x`/`BAD-A-x`/`n-A-x`）全部正确拒绝
- 自动备份验证：write_count=10 时触发，备份文件生成正常

### A 任务（v0.2 启动）

**已完**：
- v0.1.1-S3 Windows rename 重试修复 → tree-state.js `writeState` 中 rename 改为 5 次重试 + 指数退避（50/100/200/400ms）
- S2 测试方案 → `.context/s2-test-plan.md`（S2a 心跳/S2b 内审/S2c 三档 + S3 验证）
- 设计文档修订历史 → v1.2
- 方法论修订历史 → v1.0.1

**进行中**：
- tree-commander SKILL.md v2.0（子 Agent 创建中）
- tree-worker SKILL.md v2.0（子 Agent 创建中）

**待做**：
- Code review（code-reviewer 审计 tree-state.js + 2 SKILL + 设计文档变更）
- 最终报告


---

## 2026-06-18 v0.16.3 多维度综合交叉测试报告

> 执行: 指挥会话 (cf10d65d) @ Dev 实例 HTTP bridge | 耗时: ~20 分钟 | 5 Agent 并行执行

### 总览

| 矩阵 | 主题 | 结果 | 关键指标 |
|------|------|------|---------|
| H | 多 provider 横跳 × 多 sdkSession fork | **PASS** (部分) | model_sync 5/5, forks 3/5 (2 个跨 sdkSession 预期失败) |
| I | send_message 三模式 × 跨 provider | **FAIL** | I1 PASS, I2 PASS, I3 FAIL (并发丢消息) |
| J | 嵌套 Fork (3 层) | **PASS** | 3/3 层成功, 上下文完整保留 |
| K | 长会话 Fork 对比 (Bug 2 复检) | **PASS** | 源 104 = Fork 104, 差 0 |
| L | 错误恢复 | **PASS** | 4/4 断言通过 |

**整体**: 4/5 矩阵通过, 1 个发现新问题 (I3 并发竞态丢消息)

### 矩阵 H 详细结果 — 多 provider 横跳 × 多 sdkSession fork

会话 `4f9c9fd2`（标题 `[多维-H] 5 provider 横跳`）。

**model_sync（Bug 5 验证）5/5 PASS:**

| 轮次 | model_id | reply | get_session_info | 断言 |
|------|----------|-------|-----------------|------|
| R1 | glm-5.2 | 代号 PHOENIX-7 | glm-5.2 | ✅ |
| R2 | deepseek-v4-pro | 代号复述 + DeepSeek 风格 | deepseek-v4-pro | ✅ |
| R3 | claude-sonnet-4-6-promo-3 | 代号复述 + Claude 风格 | claude-sonnet-4-6-promo-3 | ✅ |
| R4 | gpt-5.4 | "未知错误" | gpt-5.4 | ✅ (meta 同步但 API 不可用) |
| R5 | gemini-2.5-pro | "未知错误" | gemini-2.5-pro | ✅ (meta 同步但 API 不可用) |

**forks（Bug 4 验证）3/5 PASS:**

| Fork | UUID 类型 | 时期 | 结果 | 消息数 | 期望 |
|------|----------|------|------|--------|------|
| F1 | assistant (idx 1) | GLM | ✅ 6658604a | 2 | 2 |
| F2 | result (idx 3) | GLM | ❌ 跨 sdkSession | - | - |
| F3 | assistant (idx 5) | DeepSeek | ✅ e72a4545 | 6 | 6 |
| F4 | result (idx 7) | DeepSeek | ❌ 跨 sdkSession | - | - |
| F5 | assistant (idx 9) | Claude | ✅ ca6511aa | 10 | 10 |

**关键发现**:
- Bug 5 修复确认：5 次 provider 切换 model_id 全部正确同步
- Bug 4 修复确认：跨 sdkSession 的 assistant 消息 fork 全部成功（候选循环试错生效）
- gpt-5.4 和 gemini-2.5-pro 在 Dev 实例返回"未知错误"，需检查 API key/配额
- result 类型消息的 fork 因跨 sdkSession 仍然失败（非 Bug，是 SDK 架构限制）

### 矩阵 I 详细结果 — send_message 三模式 × 跨 provider

**I1 (wait=true × 跨 provider): PASS**
- glm-5.2 → deepseek-v4-pro → gpt-5.4 三次切换
- model_id 全部同步，上下文 IOTA-11 在健康 provider 间正确传递
- gpt-5.4 返回"未知错误"但 model_id 仍正确更新

**I2 (fire-and-forget): PASS**
- 会话 `ac012ac9`（`[多维-I2] fire-and-forget`）
- send_message wait=false 立即返回 `{"status":"started"}`
- 轮询 2 次（~8 秒）看到 assistant 回复"巴黎。"
- model_id 同步正确

**I3 (并发 fire-and-forget × 跨 provider): FAIL**
- 会话 `4fc92476`（`[多维-I3] 并发 fire-and-forget`）
- 同时发送 3 条 wait=false（glm-5.2 / deepseek-v4-pro / gpt-5.4）
- 3 条全部返回 `"started"` 成功
- 但 list_messages 中只出现 deepseek-v4-pro 的 1 条（"2+2=4"）
- **glm-5.2 和 gpt-5.4 的消息静默丢失**
- 系统无死锁，但存在同会话并发竞态导致消息丢失

**⚠️ 这是一个新发现的 Bug：同一会话的并发 fire-and-forget send_message 存在竞态条件，导致部分消息丢失。**

### 矩阵 J 详细结果 — 嵌套 Fork

源会话 `8fa7351b`（`[多维-J] 嵌套 Fork`）。

| 层级 | 源 | Fork 会话 ID | 结果 |
|------|-----|-------------|------|
| L1 | 源 (8fa7351b) | 12bf1524 | ✅ |
| L2 | L1 (12bf1524) | b7043cc1 | ✅ |
| L3 | L2 (b7043cc1) | 567c7c31 | ✅ |

在 L3 中提问"代号？"，回复正确包含 `NESTED-OK-99` 和 `CHAIN-DEPTH-3`。
**3 层嵌套 Fork 上下文完整保留。**

### 矩阵 K 详细结果 — 长会话 Fork 对比

源会话 `63bc1223`（`[多维-K] 长会话 Fork 对比`）。

| 指标 | 值 |
|------|-----|
| 发送消息 | 30 条（REPLY-1 ~ REPLY-30） |
| 源 total | 104（30 user + 30 assistant + 44 result） |
| Fork 会话 | 44f63de4 |
| Fork total | 104 |
| 差 | **0** |
| Bug 2 状态 | **确认不存在** |

30 轮对话全部成功，Fork 完整保留全部 104 条消息（UUID、时间戳、文本、usage 完全一致）。

### 矩阵 L 详细结果 — 错误恢复

会话 `b983381c`（`[多维-L] 错误恢复`）。

| 步骤 | 操作 | 结果 | 断言 |
|------|------|------|------|
| 1 | send_message model_id="invalid-model-id" | 返回"未知错误"，无崩溃 | ✅ |
| 2 | send_message model_id="glm-5.2" | 正常回复 "已恢复正常，LIMA-77 收到" | ✅ |
| 3 | get_session_info | model_id = glm-5.2 | ✅ |
| 4 | send_message 确认稳定 | "LIMA-77 确认：会话稳定" | ✅ |

补丁 H v2 的错误恢复路径验证通过。

### 关键发现

1. **Bug 5 修复确认**：5 provider 横跳 model_id 全部同步（矩阵 H R1-R5）
2. **Bug 4 修复确认**：跨 sdkSession fork 候选循环试错生效（矩阵 H F1/F3/F5）
3. **Bug 2 确认不存在**：长会话 104 条消息全量 Fork 零丢失（矩阵 K）
4. **⚠️ 新发现：同会话并发 fire-and-forget 竞态丢消息**（矩阵 I3）：3 条并发 wait=false 消息中 2 条静默丢失，均返回 `"started"` 但未实际处理。需要排查 `runAgentHeadless` 的并发守卫是否拒绝而非排队
5. **gpt-5.4 和 gemini-2.5-pro 在 Dev 实例不可用**：两次独立测试均返回"未知错误"。需检查 API key 配置或 provider 状态
6. **补丁 H v2 错误恢复路径正常**：无效模型报错后立即可恢复（矩阵 L）

### Smoke Test 清单（可重复执行）

发布前必跑：

```bash
# S1: Bug 5 — model_id 同步
# 创建会话 → send_message(model_id=A) → get_session_info 验证 model_id=A
# → send_message(model_id=B) → get_session_info 验证 model_id=B
# 断言: 两次 model_id 均正确

# S2: Bug 4 — 跨 sdkSession fork
# 创建会话 → 用 model_id=A 发消息 → 用 model_id=B 发消息
# → list_messages 找到两个时期的 assistant UUID
# → fork_session(up_to_message_uuid=UUID_B) → 断言成功 + 消息数正确

# S3: 嵌套 Fork
# 创建会话 → 发 3 条消息 → fork → fork(forked) → fork(forked2)
# → 在 L3 发消息问上下文 → 断言回复包含原始上下文标记

# S4: 错误恢复
# 创建会话 → send_message(model_id="invalid") → 断言不崩溃
# → send_message(model_id=正常) → 断言正常回复

# S5: 长会话 Fork
# 创建会话 → 发 10 条消息 → 全量 fork → list_messages 对比总数
# 断言: |源 - Fork| <= 2
```

### 测试会话清单（全部已归档）

| session_id | 标题 | 矩阵 |
|---|---|---|
| 4f9c9fd2-7b8b-4ac2-8ff0-dcde9b08e94c | [多维-H] 5 provider 横跳 | H |
| 6658604a-32ff-48cf-9554-0365a839cefc | [多维-H] 5 provider 横跳 (fork) | H-F1 |
| e72a4545-f785-4427-aeb6-2e3f861cae27 | [多维-H] 5 provider 横跳 (fork) | H-F3 |
| ca6511aa-7c1b-4ff8-8a7e-4cbacff7ec66 | [多维-H] 5 provider 横跳 (fork) | H-F5 |
| 65fcf2d5-641f-4044-86d0-ee18af336c9d | [多维-I] send_message 三模式 | I1 |
| ac012ac9-00da-4ce4-a4de-a158423dc8f0 | [多维-I2] fire-and-forget | I2 |
| 4fc92476-5e6a-45ea-989e-e6fa5a7e6c85 | [多维-I3] 并发 fire-and-forget | I3 |
| 8fa7351b-9278-4a9e-a884-9e1817d5bf9b | [多维-J] 嵌套 Fork | J |
| 12bf1524-12b1-41f6-8413-505160b3ca95 | [多维-J] 嵌套 Fork (fork) | J-L1 |
| b7043cc1-9996-4d63-a6fd-edf81fcbe255 | [多维-J] 嵌套 Fork (fork) (fork) | J-L2 |
| 567c7c31-5914-4c23-9945-ff1ed691ab0e | [多维-J] 嵌套 Fork (fork) (fork) (fork) | J-L3 |
| 63bc1223-c914-4532-a320-95a5e2d9e2bf | [多维-K] 长会话 Fork 对比 | K |
| 44f63de4-a448-4cbd-a337-35ac428fd850 | [多维-K] 长会话 Fork 对比 (fork) | K-Fork |
| b983381c-aa9c-45da-93cf-c9c896489e94 | [多维-L] 错误恢复 | L |

### 改进建议

1. **紧急：修复 I3 并发竞态**。`runAgentHeadless` 的并发守卫在拒绝重复调用时应返回明确错误而非静默丢弃，或改为排队机制
2. **排查 gpt-5.4 / gemini-2.5-pro API 不可用**。两次测试均失败，检查 Dev 实例的 API key 和 provider 配置
3. **Smoke test 清单落地为自动化**。5 个 smoke test 用例适合做成 Proma 定时任务（每周发布前自动跑）
4. **fork_session 的 new_title 参数未生效**（HTTP bridge 路径），fork 标题始终追加 "(fork)" 后缀

---

## 2026-06-18 v0.16.3 回归测试报告（SubAgent HTTP bridge 执行）

### 总览

- **R1 (Bug 5 — send_message 同步 meta)**: ✅ **通过**
- **R2 (Bug 4 — fork 跨 sdkSession)**: ✅ **通过**
- **R3 (Bug 1 补丁 H v2 — UI 路径)**: 程序化等效 R1 已验证；UI 手测待用户

三个修复全部生效。Bug 5 修复前 model_id 永远停在初始值（矩阵 D 已证实），本轮 R1 三次切换后 `get_session_info` 全部正确同步。Bug 4 修复前跨 sdkSession fork 必报 "Message XXX not found in session YYY"（矩阵 E2 已证实），本轮 R2 两次跨 sdkSession fork 全部成功且消息数符合 idx+1。

### R1 详细结果（Bug 5 meta 同步）

会话 `7af460be-91b7-4b9b-981f-9a14ee9a7891`（标题 `[回归-R1] Bug5 meta 同步`，channel=proma-official）。

| 步骤 | 操作 | reply | get_session_info.model_id |
|---|---|---|---|
| 2 | send_message model_id=glm-5.2 | "收到代号 HAWKEYE-42..." | (基线) |
| 3 | get_session_info | — | **glm-5.2** ✓ |
| 4 | send_message model_id=deepseek-v4-pro（跨 provider） | "HAWKEYE-42" ✓ 无报错 | — |
| 5 | get_session_info | — | **deepseek-v4-pro** ✓（Bug 5 修复前 = glm-5.2） |
| 6 | send_message model_id=claude-sonnet-4-6-promo-3（再跨 provider） | Claude 警觉性回复，但 reply 正常返回、无 API 错误 | — |
| 7 | get_session_info | — | **claude-sonnet-4-6-promo-3** ✓ |

**关键对比**（同场景，修复前 vs 修复后）：

| 场景 | 矩阵 D（修复前） | 本轮 R1（修复后） |
|---|---|---|
| send_message 切到 deepseek 后 get_session_info.model_id | 仍是 glm-5.2 ❌ | deepseek-v4-pro ✓ |
| send_message 切到 claude 后 get_session_info.model_id | (未测) | claude-sonnet-4-6-promo-3 ✓ |

### R2 详细结果（Bug 4 跨 sdkSession fork）

源会话复用 R1 的 `7af460be`，关联 3 个 sdkSession（GLM/DeepSeek/Claude 各一）。`list_messages` total = 11，结构：

```
[0]  user     (uuid null, headless)
[1]  assistant 2f51d312-ae11-4714-a2fc-2bc62f6b0f29   ← GLM 时期
[2]  result   fb2d45e8
[3]  user     (uuid null)
[4]  assistant 6e506567
[5]  assistant ea664bf5-fd42-4591-98eb-641c76812d6d   ← DeepSeek 时期
[6]  result   96efc135
[7]  user     (uuid null)
[8]  assistant eef727c0
[9]  assistant e4b88009                                ← Claude 时期
[10] result   5fb783bb
```

| 用例 | up_to_message_uuid | 时期 | 结果 | fork_source_sdk_session_id | forked total | 期望 total |
|---|---|---|---|---|---|---|
| R2-cut1 | 2f51d312 (idx1) | GLM | ✅ 成功 | abe79296-29d0-46ac-a66d-15005401f90b | **2** | 2 (idx1+1) ✓ |
| R2-cut2 | ea664bf5 (idx5) | DeepSeek | ✅ 成功 | fe1c49f2-e547-4d43-b897-130d62575be8 | **6** | 6 (idx5+1) ✓ |

**关键对比**：矩阵 E2 同场景（跨 sdkSession fork）报 "Message XXX not found in session YYY"。本轮 0 报错，0 失败。两个 fork_source_sdk_session_id 不同（abe79296 ≠ fe1c49f2），证明 Bug 4 修复的"候选 sdkSession 循环试错"逻辑生效。

### R3 说明

Bug 1 补丁 H v2 的 UI 路径（用户在 Dev 实例侧边栏切换模型）需用户手测，SubAgent 无法覆盖。但补丁 H v2 的程序化等效（MCP `send_message` 工具传 model_id 切换）已被 R1 通过验证，说明清 sdkSessionId + 同步 meta 的核心逻辑链路通了。

**用户手测步骤**：
1. 在 Dev 实例侧边栏打开任意 proma-official 频道的会话
2. 切到 GLM-5.2 → 发条消息 → 应正常回复
3. UI 上切到 deepseek-v4-pro → 直接发新消息（不刷新）→ 应第一轮就成功，不报 `[1211]` / `model not supported`
4. 看主进程日志应出现 `[Agent 编排] 检测到模型/频道切换: proma-official/glm-5.2 → proma-official/deepseek-v4-pro, 已清空 sdkSessionId 并更新 meta`

### 测试会话清单（全部已归档）

| session_id | 标题 | 用例 | 归档 |
|---|---|---|---|
| 7af460be-91b7-4b9b-981f-9a14ee9a7891 | [回归-R1] Bug5 meta 同步 | R1 + R2 源 | ✅ |
| 0f250fdd-0c13-4a84-8e39-611e09ff7b39 | [回归-R2] 跨 sdkSession fork @ CUT_UUID_1 (GLM era) | R2-cut1 | ✅ |
| 39bebf39-fda9-413f-a41c-7777b01b8b3b | [回归-R2] 跨 sdkSession fork @ CUT_UUID_2 (DeepSeek era) | R2-cut2 | ✅ |

### 执行耗时

约 6 分钟（HTTP bridge 调用 + 3 个会话 + 2 个 fork + 3 个归档）。无重试，无失败。

### 改进建议

1. **补丁 H v2 应同步推到 Release 版**（v0.16.2 → v0.16.3 同步发布），Bug 1 / Bug 4 / Bug 5 三个修复一起落地。
2. **回归用例沉淀**：R1 / R2 应作为后续版本发布的标配 smoke test，跑通才发版。
3. **Bug 5 补丁形态**：用户报告矩阵 D 时 `send_message` 不同步 meta 是独立 Bug 5，本轮已修。建议在 patches.cjs 的 send_message handler 注释里写明 "镜像补丁 H v2"，方便后人维护。

---

## 2026-06-18 矩阵 D/E/F/G 测试报告（SubAgent 执行）

### 总览

- 矩阵 D（跨 provider 切换 / Bug 1 补丁 H v2）: **3/3 功能通过**,但 **meta 同步 0/3**
- 矩阵 E（Fork 后可用性）: **2/2 通过**（E3 sidechain 用例未跑,跳过 — 缺 sidechain 会话）
- 矩阵 F（边界场景）: **F1 通过（根因明确）/ F3 跳过（无 compact 会话基线）**
- 矩阵 G（身份标识）: 全部应用

### 关键结论（三件事）

1. **Bug 1 补丁 H v2 ✅ 功能层生效**:D1/D2/D3 共 9 轮跨 provider 切换（GLM↔DeepSeek↔Claude）**全部第一轮就成功**,无 `[1211]` / `model not supported` / `supported API model names` 错误。reply 内容正确（"42"、"99"、"A B C"）。

2. **补丁 H v2 ❌ meta 同步不生效**:`send_message` 工具传 `model_id` 切换模型后,`get_session_info` 返回的 `session.model_id` 仍是创建时的初始值（D1 仍是 glm-5.2,D2 仍是 deepseek-v4-pro）。**说明 MCP `send_message` 工具走的是 `runAgentHeadless` 路径,补丁 H 在 `sendMessage()` 入口的 `updateAgentSessionMeta` 没被触发**。要修需要在 `runAgentHeadless` 入口加同样的检测,或显式同步 meta。这是个**新发现的独立 Bug**。

3. **Bug 2 真相 = 不存在**:F3 调研发现 Dev 实例上**所有 jsonl 文件都没有 `compact_boundary` 标记**（检查了 415/411/289 行三个长会话）,auto-compact 从未触发。结合 E1 验证 Fork 能完整复述上下文 → **Fork 不丢历史**。用户报告"Fork 只剩 20 轮"最可能是 **`list_messages` 默认 `limit=50` + 偏移错觉**导致的视觉截断,**不是 fork bug**。

### 矩阵 D 详细结果（补丁 H v2）

| 用例 | 切换路径 | 轮数 | 报错 | reply | 结论 |
|---|---|---|---|---|---|
| D1 | GLM→DeepSeek | 2 | 无 | "42"（DeepSeek 复述） | ✅ |
| D2 | DeepSeek→GLM | 2 | 无 | "99"（GLM 复述） | ✅ |
| D3 | GLM→DeepSeek→Claude→GLM | 4 | 无 | "A B C"（全复述） | ✅ |

**meta 同步**:D1-D3 全部失败,`session.model_id` 始终是 create_session 时的值。

### 矩阵 E 详细结果（Fork 后可用性）

**E1 全量 Fork** ✅:
- 源会话 b5efd84f 注入 BLUEFOX/7749 → fork 出 dcacb605
- forked 会话问"代号和密令" → reply: "BLUEFOX,7749"（**完整复述**）
- 18 条源消息全部继承,Fork 不丢消息

**E2 截断 Fork** ✅（技术层）:
- 用 index 1 的 assistant UUID `25ac8daf` 作 fork 截断点 → forked 6e584499
- forked 会话只有 8 条消息（原 2 条截断 + 新 6 条）,MSG2/MSG3 被截掉
- 注意:GLM 模型有 SDK Memory 功能（写入 `project_matrix_e1_bluefox.md`）,所以"复述验证"层面模型仍知道 BLUEFOX,但**这是 Memory 而不是 Fork 残留**

### 矩阵 F 调研结论

**F1 — index 2 UUID 失败根因（代码调研）**:

1. `proma-dev-patches.cjs` 第 312 行注释明确:`// headless 的 user 消息可能没有 uuid`,`entry.uuid = m.uuid || null`
2. 实测 D1/E1 会话证实:**前 3 条 headless user 消息 `uuid=null`**,sidechain 触发的 user 消息（index 11+）有 uuid
3. `main.cjs` 17749127 行 `findLastIndex((m) => "uuid" in m && m.uuid === upToMessageUuid)` — `in` 操作符只判断 key 存在（不管值）,所以**uuid=null 的消息不会被这个查找匹配**
4. **真正报错源头**:E2 用 index 5 的 result UUID `47e24037` fork 时报错 `Message XXX not found in session beba6edc`（英文,不是 main.cjs 的中文错误）。这说明:
   - main.cjs 找到了消息（targetIdx ≥ 0）
   - main.cjs 把 `forkSourceSdkSessionId` 切换为 `effectiveMsg.session_id`（代码 17749186）
   - 但 SDK `forkSession()` 在切换后的 sdkSessionId 里找不到那个 UUID
5. **根因**:agent session 关联多个 sdkSessionId（因为补丁 H 清空 sdkSessionId 后重建,或 sidechain 触发了新 sdkSession）,**MCP `fork_session` 工具的 sdkSessionId 切换逻辑只能选一个 sdkSession,导致跨 sdkSession 的消息 UUID 解析失败**。这跟"headless user 无 uuid"是**两个独立 Bug**。

**Bug 4 — fork 跨 sdkSession 失败（新发现）**:E2 测试中同一个 agent session 显示了两个不同的 `fork_source_sdk_session_id`:
- 全量 fork: `53f515f3-e21b-4f70-9d25-8c6fe2881808`
- 截断 fork（index 1）: `beba6edc-c917-4eb5-a601-bf4051c65fa3`
- 截断 fork（index 5）: 失败,报错 sdkSession 是 `beba6edc`（与成功的 index 1 同一个,但 SDK 仍找不到 UUID）

→ 推测:SDK 内部把消息按 sdkSession 分桶存储,fork 时切换 sdkSessionId 后,只有部分消息在新 sdkSession 里。**应该改 fork 逻辑:遍历所有 sdkSession 找 UUID,而不是只信 `effectiveMsg.session_id`**。

**F3 — Bug 2 验证**:Dev 实例 3 个长会话（289/411/415 行）**全部没有 compact_boundary / isCompactSummary** → **auto-compact 从未触发**。Bug 2 现象不可能由 compact 导致,**真相是 list_messages 默认 limit=50 + 用户感知错觉**。

### 测试会话清单（全部已归档）

| session_id | 标题 | 用例 | 创建→归档 |
|---|---|---|---|
| 9863dbbf-9ddb-48df-9d5d-593523372c83 | [矩阵D-D1] GLM→DeepSeek | D1 | ✅ |
| 39850f50-fcae-40e7-8aec-224b83cecedd | [矩阵D-D2] DeepSeek→GLM | D2 | ✅ |
| 35823e5f-23a2-42d2-8485-7291bb8ad864 | [矩阵D-D3] 3-way switch | D3 | ✅ |
| b5efd84f-feb4-41a6-a2e6-1a7f4693ac36 | [矩阵E-E1] source | E1+E2 source | ✅ |
| dcacb605-fd88-457d-bc78-08aaf3278746 | [矩阵E-E1] fork (full) | E1 | ✅ |
| 6e584499-6b18-4bc1-a1ec-f40039163e9c | [矩阵E-E2] fork (cut at idx1) | E2 | ✅ |
| 58c15733-abdb-4d23-82ce-87127b1a1363 | [矩阵E-E2] fork (full retry) | E2 辅助 | ✅ |

### 改进建议（给下一轮）

1. **修 Bug 4 — fork 跨 sdkSession**:在 `fork_session` 工具层做 UUID 全 sdkSession 索引（不再依赖 `effectiveMsg.session_id` 单一切换）。
2. **修 Bug 5 — send_message 不同步 meta**:在 `runAgentHeadless` 入口加补丁 H 同款检测,或在 `send_message` MCP 工具显式调 `updateAgentSessionMeta({channelId, modelId})`。
3. **测试设计教训**:用 GLM-5.2（带 SDK Memory）做 fork 截断验证不可靠 — Memory 会"绕过"对话历史让模型记得被截断的内容。下次用 DeepSeek 或关 Memory 的模型做"内容复述"断言。
4. **Bug 2 用户报告路径**:让用户实际跑一次 fork + `list_messages(limit=200)` 对比源/目标的 `total` 字段,大概率会发现行数一致,从而澄清错觉。

---

## 2026-06-18 跨频道换模型丢上下文 + Fork 截断 20 轮 — 根因调研

**触发场景**：Dev 版 + Release 版都出现的两个用户报告 bug。

### Bug 1：会话内跨频道换模型直接报错 + 丢上下文（如 GLM → DeepSeek V4 Pro）

**根因（双重问题）**：

1. **补丁 F 未真正落地**。main.cjs 405955-405956 处：
   ```js
   const sessionMeta = getAgentSessionMeta(sessionId);
   let existingSdkSessionId = sessionMeta?.sdkSessionId;
   ```
   之后**没有任何** `channelId !== sessionMeta.channelId` 的比对逻辑。grep `existingSdkSessionId = void 0` 出现 4 次（406525、406558、406718、406750），但**全是事后 Session-Not-Found 被动恢复路径**，不是事前预防。

2. **更深层问题**：`sessionMeta.channelId/modelId` 在 sendMessage 中**从不更新**。补丁 C1 设计是 `meta.channelId 优先 || UI channelId`：
   ```js
   const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;
   ```
   - 创建会话时 meta.channelId 写入
   - UI 跨频道切换时，meta.channelId 还是旧值
   - → `__effChannelId` 永远是旧频道
   - → 旧 sdkSessionId 也透传给 `queryOptions.resumeSessionId`（406335）
   - → 新频道 SDK 找不到旧 session → 抛 "No conversation found ... with session"
   - → 触发 406524/406717 被动恢复（`existingSdkSessionId = void 0` + JSONL 回填）→ 用户感知"先报错 + 上下文靠 JSONL 二次读取勉强恢复"

**修复方案（方案 A，推荐）**：sendMessage 入口处检测 UI 跨频道主动切换，三件事一起做：

```js
const sessionMeta = getAgentSessionMeta(sessionId);
let existingSdkSessionId = sessionMeta?.sdkSessionId;
// 检测 UI 主动跨频道切换
if (existingSdkSessionId && sessionMeta?.channelId && channelId && channelId !== sessionMeta.channelId) {
  existingSdkSessionId = void 0;                     // 清空 sdkSessionId（走上下文回填）
  updateAgentSessionMeta(sessionId, {                // 同步更新 meta
    channelId,
    sdkSessionId: void 0,
    ...(modelId ? { modelId } : {}),
  });
}
```

这样同时修复：
- sdkSessionId 不再透传旧值
- meta.channelId/modelId 同步更新 → `__effChannelId` 用新频道
- 后续 `getAgentSessionMeta` 取到的都是新值，UI 也对得上

**最小变更方案（方案 B，不推荐）**：只补补丁 F 的清空逻辑，不动 meta。但 `__effChannelId` 还是旧频道，apiKey/baseUrl 用错，治标不治本。

**方案 A 的 sed 实现**：

```bash
# 注：minified main.cjs 中需要精确匹配现有代码（注意 \\& 是 sed 的 & 转义）
sed -i 's@let existingSdkSessionId = sessionMeta?.sdkSessionId;@let existingSdkSessionId = sessionMeta?.sdkSessionId;if(existingSdkSessionId\&\&sessionMeta?.channelId\&\&channelId\&\&channelId!==sessionMeta.channelId){existingSdkSessionId=void 0;try{updateAgentSessionMeta(sessionId,{channelId,sdkSessionId:void 0,...(modelId?{modelId}:{})});}catch(_){}}@' main.cjs
```

**验证场景**：
- 在一个 GLM 会话里跑几轮 → UI 切换到 DeepSeek V4 Pro → 发新消息 → 应当：① 不报 "Session not found"；② 历史上下文保留（通过 JSONL 回填到新频道 SDK session）；③ 后续消息走 DeepSeek API

---

### Bug 2：Fork 只保留前 20 轮（疑似误判）

**结论**：**main.cjs 的 `forkAgentSession` 和 SDK 的 `forkSession` 都没有任何"20 轮"截断**。极可能是 SDK 的 **auto-compact 机制**导致的"看似丢历史"。

**调研细节**：

- `forkAgentSession`（main.cjs 387015–387166）按 `upToMessageUuid` 做 `slice(0, cutIndex+1)`，不传时复制全量
- SDK `forkSession`（`@anthropic-ai/claude-agent-sdk/sdk.mjs` 的 `kZ` 函数）：读整个 JSONL，filter sidechain，逐条复制并改写 uuid/sessionId/parentUuid，无截断
- main.cjs 里 `20` 出现的地方都无关：
  - `AUTOMATION_MAX_HISTORY = 20`（line 1612）—— automation `runHistory` 列表，不影响 fork
  - `SEARCH_WORKSPACE_FILES` 默认 `limit = 20`（line 567882）—— 搜索结果
- `MAX_SDK_MESSAGE_LENGTH = 256KB`（line 387617）—— 单条消息长度限制，触发 `sanitizeOversizedMessage` 截断内容但**不丢消息**

**最可能的真相（按概率）**：

1. **可能性 A：SDK auto-compact 已发生**。源会话长到一定 token 后 SDK 自动 compact，jsonl 里只保留 `preservedMessages.uuids`（早期几条）+ compact 之后的近期消息，中段被压缩成 `compact_boundary` system message。Fork 时复制的是已 compact 的 jsonl → 用户感觉"只剩 20 轮"。这不是 bug，是 SDK 机制。
2. **可能性 B：用户用 `list_messages` 默认 limit=50 看的，没意识到要传 limit=200**。list_messages 默认 50、上限 200。
3. **可能性 C：用户记忆里的"全部历史"和实际不一致**（短时记忆错觉）。

**验证清单**（让用户复现时提供）：

```
1. fork 前源会话：mcp__session__list_messages(source_id, limit=200) → total = ?
2. fork 后目标会话：mcp__session__list_messages(forked_id, limit=200) → total = ?
3. 直接看磁盘文件：
   ls ~/.proma-dev/agent-sessions/<workspace-slug>/<sdkSessionId-hash>/*.jsonl
   wc -l <source>.jsonl
   wc -l <forked>.jsonl
   如果行数大致一致 → fork 没丢
   如果源文件本身就 < 30 行有效对话 → SDK auto-compact 已发生
4. 在 fork 后的会话里直接问："你记得我们最早聊的是什么？" —— 如果 SDK 已 compact，模型自然不记得早期内容
```

**如果确认是 auto-compact 导致**：
- 选项 1：教育用户（compact 是设计行为，Fork 无法"恢复"已压缩历史）
- 选项 2：关闭 auto-compact（如果有开关）—— 但会破坏长会话
- 选项 3：自定义 fork 复制 JSONL 而不调 SDK forkSession（重建 sessionId）—— 工程量大

---

### 行动建议

**P0：修 Bug 1**（方案 A 的 sed 补丁）。这个是确凿的代码 bug，影响所有跨频道切换场景。

**P0：先验证 Bug 2**（让用户跑验证清单）。在没有"fork 前后实际消息数对比"之前不要急着改代码，可能根本不是 fork 的问题。

---

## 2026-06-18 补丁 H v1 实测发现盲点 — 升级到 v2

**触发场景**：v0.16.0-dev 补丁 H（v1）部署到 Dev 版后，用户实测发现"报错之后再问一轮就好了"。

### 实测发现：`proma-official` 是多 provider 路由频道

通过 `list_channels` 实查 Dev 实例配置：
- `proma-official` 频道（provider="proma"）下挂 **18+ 个不同 provider 的模型**：claude-opus-4-8、claude-sonnet-4-6-promo-3、glm-5.2、deepseek-v4-pro、deepseek-v4-flash、gpt-5.4、gpt-5.5、gpt-5-mini、gemini-3.1-pro-preview、gemini-2.5-pro 等等
- 其他三个频道是单一 provider：`MiniMax-CodingPlan` (anthropic)、`ZLM-CodingPlan` (anthropic)、`DeepSeek官方` (deepseek)

### 为什么 v1 补丁 H 不够

v1 只检测 `channelId !== sessionMeta.channelId`。用户在 UI 切换"GLM-5.2 → DeepSeek V4 Pro"时：
- channelId 都是 `proma-official`，**不变**
- modelId 从 `glm-5.2` 变到 `deepseek-v4-pro`

→ v1 检测条件 false → 不清空 sdkSessionId → 旧 sdkSessionId（GLM provider 的）透传给 DeepSeek API → DeepSeek API 报 `The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed glm-5-turbo`

### "报错之后再问一轮就好了"的真相

main.cjs 406524 / 406717 是 SDK 报错后的**被动恢复路径**：
1. 第一轮：SDK 抛错 → catch 块清空 `existingSdkSessionId` + 调 `prepareSessionNotFoundRecovery` 注入 `<session_recovery>` 让 Agent 自读 JSONL
2. 第二轮：sdkSessionId 已被清空（持久化）→ 走"新会话 + 上下文回填"路径 → 成功

所以现象是"先报错一次，靠被动恢复救场"。

### 实测会话证据

会话 `d6e16c7e-f826-4483-977e-02a5c53423c5`（标题："再答一次上面问题"），49 条消息里模型自报反复横跳：

| 时间戳 | 用户输入 | 模型回复 | 状态 |
|---|---|---|---|
| 1781751646085 | "上面的问题你同样你来回答一遍" | unknown_error "未知错误" | ❌ |
| 1781752277599 | "你来" | "Claude Sonnet 4.6" | ✅ |
| 1781752314264 | "再回答一次" | "DeepSeek V4 Pro" | ✅ |
| 1781752323856 | "你来回答" | `API Error: 400 The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed glm-5-turbo` | ❌ |
| 1781752337630 | "你来回答" | `API Error: 400 [1211][模型不存在，请检查模型代码]` | ❌ |
| 1781752369938 | "你呢？" | "GLM-5.2 限时折扣" | ✅ |

### v2 修复（已部署）

把 v1 检测条件扩展为 `(channelId !== meta.channelId) OR (modelId !== meta.modelId)`。这样：
- 跨频道切换（v1 已修）：触发
- 同频道内换 provider 模型（v2 新增）：触发
- 同模型继续聊：不触发（不影响性能）

### 教训：sed + shell `&&` 是大坑

部署 v2 时第一次用 `sed -i 's@...&&...@...&&...@'`，shell 把每个 `&&` 当命令分隔符 → sed 多次执行 → 文件被搞乱（一堆重复片段）。`node --check` 直接报语法错误。

正确做法：
1. **用 Edit 工具直接修改**（不经过 shell 解析）
2. 或把 sed 命令写到 `.sh` 脚本里 `bash xxx.sh`（脚本里 `&&` 不被外层 shell 看到）

通过备份 `main.cjs.bak-20260618-bug1-v2-preexpand` 完整回滚后用 Edit 工具重新打补丁。**后续补丁一律走 Edit 工具**。

---
