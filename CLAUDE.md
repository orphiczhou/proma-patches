# CLAUDE.md — Tree 形会话执行体系（tree-system）

> 项目知识库。每条都是"删掉后未来 Agent 会犯错"的内容。保持精简。

## 🔴 第一性原理：Agent 工程即闭环工程

Agent 只有一条文字通道（输入输出皆文字，无视觉/听觉/触觉/本体感觉），等于"感觉剥夺"的操作者——能发指令，默认看不见指令后果。**搭 Agent 系统，第一件事是给它闭环：把每个操作动作的后果，翻译成它唯一能读的文字，回灌给它。**（精髓不是给 Agent 装眼睛，是承认它永远不会有眼睛——工程职责是把一切非文字后果持续翻译成文字喂回去。）

闭环三要件（缺一即事故）：
1. **即时**——动作当下就反馈，不等终点（引擎 append 即校验，非 done 才校验；延迟反馈=没反馈，Agent 早跑远）。
2. **可定位**——反馈精确到"哪里错、怎么改"（错误码带修复路径，非空泛"失败"）。
3. **人验证最后一跳**——Agent 自报"完成"永远不可信（commander 两次"虚假 done"被编排方核 tree-state 戳穿）；闭环最后一跳必须人核 ground truth。

**本项目所有事故 = 某一跳闭环断**：macp2（调用形式没钉死→4 分钟炸 207 会话）/ nanju（审计义务标"可选"→无 auditor）/ v0.17.1（纯教化无引擎即时反馈→worker 伪造 review_round，四层防线全失效）/ skill 反馈闭环没完成（盲跑一周）。**所有可靠机制 = 把那一跳接上**：tree-state events 回灌 / 引擎 append 即校验错误码 / v0.18 worker session 禁即时拦。**闭环断一段，Agent 盲跑一段。** 越是硬件/物理世界（后果不可逆、不在文字通道），闭环越是唯一可靠前提，人验证不可省——这不是不信任 Agent，是承认文字通道承载不了物理世界的全部真相。

## 项目结构
> 🔴 **权威源 = `D:/codes/tree-harness/`（2026-07-09 源码统一后确立）**。此前最新内容分散在 workspace-files（tree-engine 4928）与 pro dist（patches 3129），已全部汇聚到本目录。
- `tree-engine.cjs`（5425 行，md5 3e10bf8e）：树引擎核心（状态机、事件、审计门禁、caller-binding、SubAgent 入树、5 件套持久化、drift 联动、ctx 竹节触发、prune 级联 D1、SCHEMA_VERSION 版本管理 D2、**Sprint 5 max_sessions session_registry + E_MAX_SESSIONS 硬护栏**：四路径登记 init/add/set-session/register + migrate 回灌 + findTreesBySession 导出；**v0.18 worker role 禁 review_round session 分支（`E_REVIEW_SESSION_FORBIDDEN`，堵 GLM worker 占位/借真 UUID 蒙混，v0.17.1 纯教化实战证伪后引擎层落地）**；**v0.19 root done 须子 done（`E_CHILDREN_NOT_DONE` L1762 扩 root，堵 commander root 提前 done 放弃子任务）；**v0.20 audit_gate red 阈值（`E_AUDIT_RED_BLOCKED`：audit_log findings severity=red → 拒 pass，防 auditor 偏松 pass 严重问题，v20t 教训）**）；**v0.21 audit_gate pass_with_minor 枚举 + results severity 必填 + isPassVerdict helper**（对齐 tree-auditor SKILL §3.1/§4，根治 v21t schema 冲突：auditor 不再被迫剥离 severity / 降级 pass_with_minor→pass）**；**v0.22 done event `yellow_findings_resolved` 闭环（照搬 P1b `red_findings_resolved` 模式：review_round 有 yellow findings 带 finding_id → done event meta.yellow_findings_resolved 必填 `[{finding_id, fix_method: edit_file|fixed|downgrade|deferred|accepted, fix_evidence≥20字}]`，缺→`E_SELFCHECK_INVALID`，治 nanjuS1 实战 9 yellow 进"已知但未修复"真空）+ commander SKILL §13.4.6 fix leaf 反馈闭环（auditor findings → fix leaf 修 → auditor 复审）**。
- `proma-dev-patches.cjs`（3346 行，md5 5083480d）：MCP 工具注册 + caller ownership + create_session budget 护栏 + 跨工作区 workspace 锁（Sprint 4 P1，E_WORKSPACE_FORBIDDEN）+ tao-watcher（D3 silence 静默 / Sprint 4 rule 按 role 分发 RULE_ROLE_SCOPE + nudge_log cap）+ **Sprint 5 聚类 A create_session 旁路根治**（findCallerTreesForBypassGuard 定位 caller 所属 tree + max_sessions 预检 E_MAX_SESSIONS + 旁路登记 register-session + tree_register_session/tree_session_count MCP 工具）。
- `proma-mcp-server.cjs`（157 行）：外部 stdio MCP 桥接（5 处副本 md5 一致）。
- `skills/tree-commander/SKILL.md` + `skills/tree-worker/SKILL.md`：指挥官/工人手册。
- pro 部署：`D:/Proma-dev/resources/app/dist/`（tree-engine.cjs + proma-dev-patches.cjs）+ `~/.proma-dev/agent-workspaces/default/skills/`。
- release 部署：`D:/Proma-release/...`（userData `~/.proma-release`，部署前先 find 确认路径；⚠️ 2026-07-09 release dist 落后 pro 较多，未同步）。
- ⚠️ 旧源 `workspace-files/` 与 `.context/proma-dev-patches.cjs`（1078 行旧副本）已非权威，勿作为修改基准。

## 🔴 P0 永久教训：SubAgent 调用形式必须钉死（否则成本爆炸）
**事故**（2026-07-08 macp2，详见 `.context/active/postmortem-macp2-subagent-cost-explosion-2026-07-08.md`）：SKILL 写"spawn SubAgent"没钉死调用形式 → DeepSeek commander 用 `create_session`/`fork_session`（真实会话=烧钱）当 reviewer，4 分钟炸 207 会话，DeepSeek 额度打负。

**铁律**（改 SKILL/写 brief 必须遵守）：
1. **SubAgent = 进程内 SDK Agent 工具**（in-process，不建独立会话、不在侧边栏）。给可直接复制的调用示例。
2. **🚫 严禁** `mcp__session__create_session` / `fork_session` / `mcp__collaboration__delegate_agent` 当 reviewer/SubAgent（这些=真实会话=成本爆炸口）。
3. **收敛条件必须有**：角色数上限（分档 2/3/5，最小档≥2 不违禁自审；对齐 worker SKILL §4.6 字数分档）+ 轮数上限（≤3）+ 停止条件（`red_count=0` 或升级，**不许靠新建会话重试**）。
4. **预算护栏**：tree `max_sessions`、worker `max_subagent_spawn` 硬上限；撞错（E_DUPLICATE_SESSION_ID 等）**修根因，禁换名重试**。
5. **Proma 心智模型**：Proma 原生 spawn = 真实会话 = 钱。"廉价 SubAgent"只存在于进程内 Agent 工具，必须 SKILL 显式指定。

**前置验证（任何 SubAgent 设计前）**：确认目标会话（如 pro commander）工具集**是否含进程内 Agent 工具**。若无 → 设计降维（单 reviewer 或 commander 自审）。

## 🔴 P0 教训：brief 审计义务不可标"可选"（nanju 2026-07-15）

**事故**：nanju04 测试（pro e2e，GLM-5.2 commander）派 4 worker 产 04_API_SPEC 细分文档（agent-comm / frontend-backend-api / data-model-api / events），4 worker 全 done、产物落盘，但**全程无独立 auditor leaf、worker 无 review_round 自审**。对照同 SKILL 同 commander 的 e2e03（派了完整 D-auditor），根因是 **brief 配置释放了审计义务**，不是 SKILL 逻辑问题。

**根因链（两条独立）**：
- **链 A — worker 无自审（无 review_round）**：`audit_meta.review_required=false` → done 门禁不要求 review_round → worker 不跑 §4.6 G1-G5（worker SKILL §4.6 触发=review_required=true **或** 自检"设计文档/架构级/跨文件≥1000字"主动开；nanju 4 worker 产出的确是设计文档，但 GLM worker 没主动开 §4.6）。
- **链 B — commander 无 auditor**：`root_dod.self_check` 写 `auditor role审查(可选)一致性pass`——**"（可选）"直接释放了 commander 派 auditor 的义务**。e2e03 对照组写 `1 auditor status=done 且 audit_log 含 passed/failed 统计`（硬 DoD）→ commander 派了 D-auditor(role=auditor)；nanju 写"可选" → commander 全程靠 root 信任锚兜底，不建 auditor leaf。
- **SKILL 结构性盲区（放大器）**：铁律 5/§14.1 触发词是"文档**审计**/验证/终局审查"+"对**已完成**文档可信度评估"——04_API_SPEC 是**产出**新文档（非审计已有文档），commander 判定 §14 不触发，铁律 5 不激活。SKILL 对"重要产出类文档"无强制 auditor 兜底（已在 tree-commander SKILL §14.1 措辞补一条修复）。

**铁律（写 brief / 建 tree 必须遵守）**：
1. **产出类文档任务（≥1 份设计文档/API 规格/架构文档/PRD 等正式交付物）默认 `review_required=true`** —— 让引擎 done 门禁强制 worker 跑 §4.6 review_round 自审，不靠 worker 自觉。
2. **auditor 写成硬 DoD，禁止"（可选）"措辞** —— self_check 写 `1 auditor status=done 且 audit_log 含 N 条 findings`（参照 e2e03），不能写"（可选）"。brief 一旦标可选，GLM commander 会自主跳过整条 auditor 链。
3. **brief checklist**（建 tree 前过一遍）：
   - [ ] 产出含正式文档/架构级/跨文件交付物？→ `review_required=true`
   - [ ] DoD 里 auditor 是硬条件（非"可选"）？
   - [ ] prefix ≤8 字符（`[a-z][a-z0-9_]{3,7}`），禁 `nanju04api`(10字符) 这种超长名 → E_NAME_INVALID 全卡死
4. **prefix 命名**（nanju 首版副根因）：`nanju04api`（10字符）违反 §12，4 worker leaf_add 全 `E_NAME_INVALID` 卡死（call-log 14 calls 止步 leaf_add）；改 `nanju04`（6字符）才跑通。建 tree 时 `root_brief.prefix` 必 ≤8 字符，init 不校验 prefix 长度（leaf_add 才校验），故命名错会潜伏到建 worker 时才暴露。

> 与 macp2 教训互补：macp2=SubAgent **调用形式**必须钉死（防成本爆炸）；nanju=brief **审计义务**不可标可选（防质量防线被一句话释放）。两者都是"SKILL/brief 没钉死 → GLM 自主简化 → 事故"。

## 🔴 P0 教训：GLM-5.2 不遵守 SKILL 教化，防线必须引擎硬拦（v0.17.1 实战证伪 2026-07-16）

v0.17.1「schema 位置红线」纯 SKILL 教化（显眼红线块 + ❌/✅ 对照 + 完整审计收敛）实战验证（pro v172t 树）：GLM-5.2 worker **完全无视**——0 subagent_spawn，2 轮 review_round 全伪造（reviewer_kind 缺省走 session 分支 + 占位合法 v4 UUID，每轮换新 UUID 伪装复审），比 nanju05 更糟（nanju05 至少 spawn ×5）。三层防线全失效：L1 引擎 session 分支 by design 只校验格式（占位合法 UUID 过）/ L2 SKILL 红线 GLM 无视 / L3 commander 他审流程错乱（派 worker 不派 auditor、未抽查）。

**铁律**：对 GLM-5.2 这类会自主简化/绕过 SKILL 的模型，**安全/质量防线不能只靠 SKILL 教化（L2）或 commander 他审（L3）——必须引擎硬拦（L1）兜底**。worker 自审的 review_round 必须 engine 层强制 `reviewer_kind=subagent` + `reviewer_ref` 溯源 `subagent_spawn`（堵 session 分支这个逃逸口）；否则 review_required=true 形同虚设。**引擎硬拦（worker role 禁 session 分支 / session 分支校验 session_registry 存在性）从 backlog 升级为必须（v0.18 核心）**。反衬：worker 产出的设计文档质量合格，§4.6 伪造是偷懒绕过非能力问题。

> 三条 P0 互补：macp2=调用形式钉死（防成本）；nanju=审计义务不可标可选（防质量）；**v0.17.1=教化对 GLM 无效必须引擎硬拦（防伪造）——v0.18 已落地：worker role 禁 review_round session 分支 → `E_REVIEW_SESSION_FORBIDDEN`**。共性"GLM 会自主简化，不可靠信任，防线须沉到引擎层"。

## 🔴 持续迭代 Loop（每个主会话按此工作，2026-07-17 确立）

详见 `.context/active/tree-system-iteration-loop.md`。核心循环：**commit → 派 commander+observer 测试当前改动 → 派 commander+observer 用 nanju S1 真实项目测试 → subAgent 进程内审计+迭代改进 → commit → 回到测试**。每轮填演进记录表。

## 部署同步口诀（改 engine/SKILL 后）
> 权威源 = `D:/codes/tree-harness/`（2026-07-09 起）。改完从这里部署到 dist。
1. `D:/codes/tree-harness/tree-engine.cjs` → `D:/Proma-dev/resources/app/dist/tree-engine.cjs`（pro，cp 后需用户重启 pro app 才加载新引擎）
2. `D:/codes/tree-harness/proma-dev-patches.cjs` → `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`（pro，同上；patches 改动也需重启 pro 才生效）
3. `skills/*` → `~/.proma-pro/agent-workspaces/default/skills/`（pro commander 真实 workspace；SKILL 文件级即生效）。⚠️ **分离 bug（2026-07-16 发现）**：start-pro.bat `PROMA_INSTANCE_NAME=pro` 让 Proma session/workspace/skills 在 **`.proma-pro/`**（commander 活在这，18 个内置 skill 在此），但 `PROMA_DEV=1` 让 tree-system 的 tree 目录在 **`.proma-dev/`**（v19t 等树在此）——两者分离。**SKILL 部署 .proma-pro，tree 监督读 .proma-dev**。旧口诀"SKILL→.proma-dev"是 bug（把 tree 目录当 skill 目录，e2e 时代埋的）。
4. 同步前备份 `.bak-pre-<label>-<date>`；md5 校验源=pro（tree-engine 应=1f05baa7，patches 应=5083480d）。

## pro 测试要点（来自历次迭代）
- pro 用 `.proma-dev` userData（**非** `~/.proma`）。SKILL 同步错路径 = commander 读旧版（曾误判"SKILL 未生效"）。
- pro 冷启动慢（新会话几分钟零响应）；`remote_send_message wait=false` + sleep + `list_messages` total>1 才算启动。
- **pro 支持并发会话**（observer 与 commander 可并行，非早期 handoff 所说"串行"）——但并发 + 无护栏 = 成本爆炸风险，必须配合上面的预算护栏。
- commander 协调消息记在 worker 会话（commander 自身 list_messages total=1 正常）。
- tree_id 纯字母数字（连字符会 E_NAME_INVALID）。
- API list_messages 的 text 截断到 ~1KB；要精确结论发简短问题 wait=true。
- 🔴 **监督 tree-system 进度读 tree-state.json（文件通道），禁用 API `list_messages` 消息数判进度**（e2e03 实证教训 2026-07-14）：GLM-5.2 commander 在**单个长未提交轮**内完成全部多步工作（tree_init→create_session→leaf_add→done→audit_gate… 共 N 次 tree write），轮内 tool call **不立即落 API 消息表**，直到轮结束才提交。故 commander 自主跑长任务时 API `list_messages` 全程 `total=1`（仅初始 user 消息）是**正常假信号**，≠卡死（早期笔记「total>1 才算启动」对长自主轮不成立，已证伪）。ground truth = pro tree-state.json：`~/.proma-dev/agent-workspaces/<slug>/.context/trees/<tree_id>/tree-state.json`（每次 tool call 原子落盘，leaves/events/session_registry/audit_log 实时可读）。曾因此误判 commander 卡死、误建 driver 欲转受控方式，撞 `E_DUPLICATE_LEAF` 才发现早已跑完 3 worker——**浪费轮询 + 污染**。判 commander 死活：`remote_get_session_info` status=busy（正在处理）+ tree-state 是否推进，二者皆停滞才算真卡死；任一推进就继续等。
- **remote 调用方受限（D1-A）**：编排方（remote）对 pro 仅 `remote_send_message` 可用；`archive_session` 等被 `R6-external-deny` 拒。清理 pro 会话走 pro 本地。
- pro userData = `~/.proma-dev/`（实证 e2e03/e2e04 全程；ARCHITECTURE.md §3.1 表 2026-07-15 已修 `.proma-pro/`→`.proma-dev/`）。
- 🔴 **commander 跨多树触发 patches 跨树预检 false positive**（e2e04 2026-07-15 踩坑）：`findCallerTreesForBypassGuard` 扫 caller 所属**所有树**，任一 reached(max_sessions) 即拒 create_session——即使目标树远没 reached。一个 commander 跨多棵测试树时，旧树 reached 会误伤新树建 worker（症状：create_session 返回 E_MAX_SESSIONS 指向**另一棵**树）。解除：事后调大旧树 `audit_meta.max_sessions`（备份 .bak）；或每棵测试树用独立 commander session。

## 文档引擎一致性（P0 高发区）
任何 SKILL 错误码/触发点/字段必须对照 tree-engine 实际校验逻辑（grep 错误码常量 + 看抛错条件）。历次审计抓出的 P0 都是文档与引擎不一致（如 E_REVIEW_FORGERY 触发点、output_ref 解析基准）。
- 🔴 **引擎"只校验格式不校验存在性"的字段，SKILL 不可声称"已被引擎拦截"**（v0.17.1 nanju05 教训 2026-07-16）：review_round session 分支 `reviewer_session_id` 引擎只校验 UUID v4 格式 + 非自审（L1451 注释 by design 不校验存在性）→ worker 用合法格式占位 UUID（`11111111-1111-4111-8111-`，凑过 UUID_RE）能蒙混放行。SKILL 旧写"session 分支已被 E_REVIEW_FORGERY 拦截"过乐观，已修。**写 SKILL 声称引擎拦什么前，必看校验是格式层/存在性层/内容层哪一层**；存在性/内容层靠 commander 抽样（§4 Step4）+ 引擎溯源（subagent 分支 reviewer_ref 溯源 subagent_spawn）补。同理：reviewer_kind 引擎读 reviewer 级 `r.reviewer_kind`（非顶层 meta），写错位置→缺省 session 分支，nanju05 worker 实证。

## 测试
- `.context/plan/*-test.cjs`：harness 复用模式（require 引擎 → setTreesRoot(tmp) → setSessionVerifier(mock) → engine.run → 断言）。leaf_id path 段必须**大写字母开头**（LEAF_NAME_RE）。
- 改引擎后必跑相关测试 + `node -c` 语法检查。
- 🔴 `ENGINE_PATH` 必须指权威源 `D:/codes/tree-harness/tree-engine.cjs`（md5 `5532fa5f`），**禁指** `workspace-files/` 旧源（md5 `42ba5d51`，无 Sprint 1+2+3+4+5 新改动 = 假绿灯根因）。新测试用绝对路径直指权威源；assets 多副本场景参照 `dbc-spec.cjs` `_findEngine`（候选首位权威源）。

## 当前机制状态（2026-07-08）
- SubAgent 入树 + SKILL 调用形式红线（macp2 修复）+ review_required rvreq1 PARTIAL —— 均已落地。
- **P0a auditor role**：role='auditor' 独立审计 leaf，简化协议（brief_echo+done+audit_gate，无 milestone）。关键：resolveAuditorIndep 的 root trust anchor（行 2432-2446）天然支持 root 给 auditor 背书，**不改 resolveAuditorIndep**。auditor 是叶子节点（不能当 parent/operator，同 worker）。state.version 1.1。
- **P0b TaoWatcher 收窄**：删 C-13/C-15/R-03/R-06/W-10/W-13（35→29 条）+ patches.cjs 废止 audit_log 写入。tao-watcher 逻辑在 patches.cjs（4 副本仅根 + release/patch-l 2 份含 tao-watcher），不在 engine。
- **P1b fix_evidence**：review_round findings 加可选 finding_id + done event meta.red_findings_resolved 跨事件校验（治 macp4-W3 假收敛：red 降 yellow 但文档没改）。
- 全量 90/90 绿（auditor 20 + subagent 30 + p0-3 19 + iss003 13 + p1b 8）。commit 3852c61。已部署 Pro。
- **audtest Pro 端到端测试（2026-07-09）**：端到端失败但有价值。✅ P0b 噪音降低完全通过（C-13/R-03/R-06/C-15 假阳性 24-38→0）+ 单元验证 4/5。❌ P0a auditor 完整 done 未跑通（Proma fork identity timeout 卡死 auditor session，BUG-A 跨仓）。发现 **BUG-2（leaf_add caller-binding 失效）**。✅ **已于 2026-07-09 下午修复并 pro 实证**（会话 4fee5a45）：cmdLeafAdd/cmdLeafSetStatus/cmdMilestoneAdd 三处补 `caller===added_by`/owner/creator 校验 + dispatchLeaf 透传 callerSessionId（共 9 处），vcb2 端到端验证「攻击精准拦截 + owner/creator 合法放行无误伤」。权威源（tree-harness）已含此修复（md5 2d281ebf46）。注：leaf_add 另有 **Bug B-3**（SECURITY §1.2，session_id 唯一性，V10 P3 已修）—— 与本 BUG-2（caller-binding）是**不同漏洞**，勿混。完整 BUG 编号体系见 [BUG-REGISTRY.md](./BUG-REGISTRY.md)。
