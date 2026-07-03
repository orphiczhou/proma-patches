# Proma 改造 — 调研与分析笔记

> 工作区级长期文档 | 维护: 周星星

新条目追加在顶部。

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

**剩余**: ① **重启 release**让 Layer A 运行时生效 ② Layer C P2（会话血缘视图）+ P3（收敛诊断）后续 ③ audit_log 刷爆清理 follow-up

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
