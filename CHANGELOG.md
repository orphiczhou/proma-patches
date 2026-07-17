# Changelog

All notable changes to **Proma 改造项目** are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/), adheres to [Semantic Versioning](https://semver.org/).

仓库地址：[orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches)

---

## [v0.17.0] - 2026-07-15 — 首次私有化发布

> **首次正式发布版本**。包给团队内部使用，不推公开 GitHub。源码闭源（开源做壳，闭源做肉）。发布产物含 SKILL（协议规范 + 既往事故教训脱敏）+ 引擎 dist + 部署文档。

### 引擎（tree-engine.cjs）

- **prefix 前置校验**（cmdInit，v0.7 批次6）：`root_brief.prefix` 字段存在时按 `[a-z][a-z0-9_]{3,7}`（4-8 字符）校验，防超长 prefix（如 10 字符）潜伏到 leaf_add 才 `E_NAME_INVALID`（建 worker 时已产文件但 leaf 没入树的死锁）。防御性校验：prefix 字段不存在则跳过，兼容现有合法 tree。
- **isFlagged dead code 清理**（e2e04 发现 C 核实）：删除 `isFlagged` 三分支中的 #3（worker 分支，因 worker 不能当 parent 而不可达），零行为变化（dead code 不可达），flagged 拦截机制不变（静态分支 #2 仍是有效路径）。
- **Sprint 5 max_sessions 硬护栏**：`audit_meta.max_sessions`（默认 50）+ session_registry 四路径登记（init/add/set-session/register）+ patches create_session 旁路根治（findCallerTreesForBypassGuard + 旁路登记）。防多 caller 累积 + SDK 原生 create_session 旁路的总量爆炸。

### SKILL（发布化）

- **commander §14.1/§14.1a**：自审事故根因链（链 A worker 无自审 / 链 B commander 无 auditor / SKILL 盲区放大器）+ 4 铁律 + brief checklist + §13.5↔§14.1a 互补对比段。
- **commander §13.5**：调用形式事故收敛细则（角色 2/3/5 分档 + 轮≤3 + red_count=0 停 + 禁新建会话重试）+ 预算护栏（max_sessions + max_subagent_spawn）+ 心智模型 + 前置验证降维。
- **worker §4.6**：自审主动触发条件强化（条件 1 引擎强制 `leaf.audit_meta → state.audit_meta` 措辞精确化 + 条件 2 worker 主动自检"设计文档/跨文件/≥1000 字"）+ 收敛条件 + prefix 上行 blocked 防线。
- **脱敏 + 收敛审计 pass**：DeepSeek/207会话/4分钟/打负 → 某模型/百级会话/短时/额度耗尽；nanju04/macp2/macp3/macp4 → 自审事故/调用形式事故/既往复盘/既往假阳性；GLM worker → worker。6 维度审计（C1-C4 + A1 + A2）5 pass + 1 yellow（A2 脱敏必然代价），原 9 yellow → 修复后 1 yellow，无新 red，私有化发布就绪。

### 验证

- **e2e03 正向**（pro 端到端，2026-07-14）：commander 完整建树→派 worker→done→audit_gate 全流程跑通，证 tree-system 在真实 pro 实例可用。
- **e2e04 负面场景**（pro，2026-07-15）：三机制矩阵 8/8（E_MAX_SESSIONS 双层护栏 / drift 三档联动 / flagged 篡改检测），补齐 e2e03 未演练的负面路径。详见下方 [Unreleased] e2e04 条目。
- **真实项目测试**（pro e2e，2026-07-15）：派 4 worker 产 API 文档，发现 brief 配置释放审计义务的根因（链 A/B），驱动 SKILL §14.1a + §4.6 主动触发强化。
- **审计补审**（2026-07-15）：6 维度并行审计（C1-C4 + A1 + A2），进程内 Explore subagent 独立验证 + 主审读源交叉核对。报告：`.context/active/skill-audit-2026-07-15.md`。

### 测试

- 全量 **367/0**（含 Sprint 5 max_sessions 34 + patches-bypass 27 + gate-reachability 20 + 历史套件 286）。
- prefix 前置校验新增 **prefix-init-test 17/0**（合法 4 字符 / 合法 8 字符上限 / 超长 10 字符 E_NAME_INVALID / 大写 / 连字符 / 无 prefix 字段兼容性）。
- 零回归（前置校验防御性：prefix 字段不存在则跳过，现有合法 tree 不受影响）。

### 部署

- pro dist md5（tree-engine.cjs）：**`3efe6a2b`**（含 prefix 前置校验 + isFlagged dead code 清理）。
- 升级流程见 [DEPLOYMENT.md §六](./DEPLOYMENT.md)（§6.4 v0.17.0 具体步骤）。
- SKILL 文件级即生效（cp 到 `~/.proma-dev/agent-workspaces/default/skills/`，无需重启）。

### 发布说明

- 详细发布说明：[RELEASE_NOTES.md](./RELEASE_NOTES.md)
- 部署指南：[DEPLOYMENT.md](./DEPLOYMENT.md)

---

## [Unreleased]

### 2026-07-17 v0.22 engine done event `yellow_findings_resolved` + commander §13.4.6 fix leaf 反馈闭环（补 yellow 闭环 / auditor→fixer 复审）

nanjuS1 实战（v0.21 真实项目代码闭环）暴露两个 gap：① **Gap A — yellow 闭环缺失**：worker review_round 产 9 yellow findings（带 finding_id）但 worker "非 red 不修"，done event 也无字段约束 yellow 处置 → 9 yellow 进"已知但未修复"真空（red 有 P1b `red_findings_resolved` 跨事件校验兜底，yellow 无对应机制）。② **Gap B — auditor→worker 反馈闭环缺**：auditor findings 没有结构化路径回流到 fix leaf 修复 + auditor 复审。两 gap 都属"闭环断一段"——v0.22 把这两跳接上。

**engine v0.22 两项修复**：
1. **Gap A — done event `yellow_findings_resolved`**（照搬 P1b `red_findings_resolved` 模式）：worker review_round findings 含 `severity=yellow` 且带 `finding_id` → done event `meta.yellow_findings_resolved` 必填数组，每项 `{finding_id, fix_method: edit_file|fixed|downgrade|deferred|accepted, fix_evidence≥20字}`。缺字段 / finding_id 不匹配 / fix_evidence 太短 → `E_SELFCHECK_INVALID`。治 nanjuS1 实战 9 yellow 真空：worker 必须对每条 yellow 明确处置（改文件 / 已修 / 降级 / 延后 / 接受），并给≥20字证据，闭环最后跳。
2. **Gap B — commander SKILL §13.4.6 fix leaf 反馈闭环**：auditor findings（red/yellow）→ commander 建 fix leaf（或复用 worker）按 findings 修复 → auditor 复审（重跑 audit_gate）→ 确认修复才 done。补 auditor→fixer→复审结构化反馈路径（之前 auditor 产出 findings 后无强制回流）。

- tree-engine.cjs md5 `04a74e62`→`3e10bf8e`，5388→5425 行
- 测试：sprint-v022 **4/0** + 全量 **0 回归**
- 演进链（"GLM/DeepSeek 不可靠 → 引擎硬拦"第五个候选"yellow 闭环"落地）：v0.18 worker session 禁 → v0.19 root done 须子 → v0.20 red 阈值 → v0.21 pass_with_minor + severity 必填 → **v0.22 yellow_findings_resolved（yellow 闭环）**

### 2026-07-17 v0.21 engine audit_gate pass_with_minor + severity 必填（根治 SKILL↔engine schema 冲突）

v21t 实战 + 特派员报告暴露 tree-auditor SKILL §3.1/§6.3（`results:[{item,severity,evidence}]`，subAgent 起草的 review_round 风格）与 engine audit_log schema（`{item,pass,evidence}`）**冲突**——auditor（DeepSeek A2）读了 SKILL 按 §3/§4 首次提交，被 engine schema 拒：① results 强制 pass 字段（SKILL 给 severity 无 pass）→ 7 次试错（48 轮卡 schema）→ 妥协剥离 severity；② audit_gate verdict 枚举缺 pass_with_minor（SKILL §4.1 给 pass_with_minor）→ 被迫 pass_with_minor→pass。auditor 没橡皮图章（顶层 audit_log 有 `severity_counts` + `verdict:pass_with_minor` + `cwe_hits`），橡皮图章在 engine 层。**双管齐下根治**：SKILL v1.1（对齐 engine）+ engine v0.21（根治）。

**engine v0.21 四项修复**：
1. **audit_gate verdict 加 `pass_with_minor` 枚举**（对齐 SKILL §4.1，auditor 不再被迫降级）。
2. **`isPassVerdict` helper**（pass + pass_with_minor 放行，统一放行判定逻辑）。
3. **results[] severity 必填**（v0.20 可选 red/yellow/green → 必填；auditor 必标 severity，引擎 red 阈值才有效，根治 v21t "11 findings 全无 severity → red 阈值没法触发"）。
4. **audit_append 报错一次性 schema**（非逐字段挤牙膏，auditor 试错成本骤降）+ 新增 help topic `audit_append_schema`。

- tree-engine.cjs md5 `41c08f89`→`04a74e62`，5279→5388 行
- 测试：sprint-v021 **4/0** + 全量 **0 回归**
- SKILL：tree-auditor v1.1 修订（§3.1/§6.3 schema 对齐 engine + §4.1 engine 枚举警告）+ engine v0.21（根治）双管齐下
- 演进链（"GLM/DeepSeek 不可靠 → 引擎硬拦"第四个候选落地）：v0.18 worker session 禁 → v0.19 root done 须子 → v0.20 red 阈值 → **v0.21 pass_with_minor + severity 必填**

### 2026-07-17 v0.20 auditor 审计防线三改进（不同模型 + 方法论 SKILL + 引擎 red 阈值）

v20t 实战 + DeepSeek 特派员交叉审暴露 auditor 偏松（GLM auditor 发现 mid 安全 CWE-204 鉴权缺失却 verdict=pass）。三改进堵审计防线 gap：

1. **commander SKILL §13.4.1**：auditor 用 `create_session` 选**不同模型**（非 fork 继承同模型），破同款推理偏差（如 GLM commander → DeepSeek auditor）。
2. **tree-auditor 独立方法论 SKILL**（skills/tree-auditor/SKILL.md，478 行 v1.0）：审什么（G1-G5 + G5 安全 CWE 分类 10 项）/ verdict 阈值表（red→required / mid 安全→pass_with_minor / 禁橡皮图章）/ 多模型交叉分档（普通/安全敏感/§14 审计树）/ §14 审计任务。
3. **引擎 audit_gate red 阈值**（tree-engine）：cmdAuditAppend results 加 severity（可选 red/yellow/green，向后兼容）+ cmdAuditGate verdict=pass 时扫描 audit_log，有 red → `E_AUDIT_RED_BLOCKED`（防 auditor 偏松 pass critical，v20t 教训）。

- 新错误码 `E_AUDIT_RED_BLOCKED`（engine 错误码 44→45）
- tree-engine.cjs md5 `51888140`→`41c08f89`，5251→5279 行
- 测试：sprint-v020-audit-red-test.cjs **4/0**（red 拦 / yellow 放行 / 无 severity 兼容 / 非法 severity 拦）+ 全量 0 回归
- SKILL：commander §13.4.1 改 + tree-auditor 新

### 2026-07-16 v0.19 commander 编排 Gap1：root done 须子 done

v0.18 实战（v18t 树）暴露 commander（role=root）提前 root done 放弃子任务（子 worker/auditor 没 done）。根因：`E_CHILDREN_NOT_DONE`（L1762）只校验 commander 不校验 root。修复：扩到 `|| role==='root'`（无子 root 放行，不误伤单 root 树）。

- tree-engine.cjs L1762 一行 + 错误消息，md5 `e10f93b2`→`51888140`（行数 5251 不变）
- 测试：sprint-v019-root-children-test.cjs **3/0**（root 有子未 done 拦 / 有子 done 放行 / 无子放行）+ 全量 0 回归
- Gap2/3（auditor 时机 / worker 状态）Phase 3 发现复杂（误伤 §14 审计任务 / 破坏 pending_brief→done）记 backlog

### 2026-07-16 v0.18 引擎硬拦：worker role 禁 review_round session 分支

v0.17.1 纯 SKILL 教化实战证伪（v172t + nanju05：GLM worker 用 session 分支 + 占位/借真合法 v4 UUID 蒙混 review_round，0 subagent_spawn）后，**引擎层硬拦落地**。tree-engine validateReviewRoundSchema：`leaf.role==='worker'` 用 session 分支 → `E_REVIEW_SESSION_FORBIDDEN`（worker 自审必须 subagent 分支 + reviewer_ref 溯源 subagent_spawn）。append 时（L2266）+ done 门禁（L1706）双校验点。commander/auditor 不受影响。

- 新错误码 `E_REVIEW_SESSION_FORBIDDEN`（engine 错误码 43→44）
- tree-engine.cjs md5 `5532fa5f`→`e10f93b2`，5216→5251 行
- 测试：sprint-v018-worker-session-test.cjs **8/0**（worker session 拦 / 缺省走 session 拦 / subagent 放行 / commander 放行 / 撞错恢复）+ iss003/subagent-lifecycle 测试迁 subagent 分支，**全量 0 回归**
- SKILL：worker §4.6 + commander §13.5.2 补 v0.18 引擎硬拦说明

### 2026-07-15 e2e04 负面场景验证✅ + isFlagged dead code 清理（零引擎语义变化）

e2e03 之后的**负面场景机制验证**。在 pro（引擎 `5532fa5f` + patches `339082af` + SKILL `8b2d20f2`）由 GLM-5.2 commander + 编排方精确驱动三棵小树，补齐 e2e03 未演练的三机制。完整报告 [.context/active/e2e04-verification-2026-07-15.md](./.context/active/e2e04-verification-2026-07-15.md)。

**三场景全通过 + Sprint 1-5 机制实证矩阵 8/8**：
- ✅ **E_MAX_SESSIONS 双层护栏**（e2e04max, max_sessions=3）：第3个 worker 在 **create_session 阶段**被拦（patches 前置预检 `findCallerTreesForBypassGuard`，session 未建立=**钱没花**），比 engine leaf_add 兜底更前置；registry count=3/max=3/reached=true。
- ✅ **drift 三档联动**（e2e04drf）：drift_append×3 递进（direction/low/nudge → mid/limit → production/high/prune），leaf.drift_history + state.drift_log 双写各 3 条。
- ✅ **flagged 篡改检测**（e2e04flg, review_required=true）：篡改 C-commander（done + 伪造 audit_gate.pass + review_evidence.flagged + 无 review_round）→ leaf_add 子被 **E_REVIEW_FLAGGED_BLOCK** 拦（即使伪造 audit_gate.pass，因 isFlagged 看 review_round 不看 audit_gate 字段）；补 review_round 后放行。证 P1-S03 flagged 从 events 动态派生、防篡改蒙混。
- e2e03 三项未触发/等价（drift / flagged / max_sessions 上限）全由 e2e04 补齐真实触发 → **Sprint 1-5 新机制实证矩阵 8/8 完成**（e2e03+e2e04 合并）。

**三项额外发现**（记待改进，不阻断）：A. patches 跨树预检 false positive（保守策略代价）；B. worker/auditor 不能当 parent（引擎 L1072-1082）；**C. isFlagged 动态 worker 分支 = dead code（见下）**。

**isFlagged 动态 worker 分支删除（dead code，e2e04 发现 C 核实）**（tree-engine.cjs `isFlagged` L1355-1363，已部署 pro：dist md5 `818f6cb2` + 重启加载，2026-07-15）：
- e2e04 SubAgent 全引擎核实：`isFlagged` 三分支中 #3（`status==='done' && role==='worker' && isReviewRequired`）是 dead code——isFlagged 全引擎仅 1 调用点（cmdLeafAdd 父链扫描 L1092），而 worker 不能当 parent（L1072-1082，segment_append 只改 session 不改 parent），故 done worker 永不是新 leaf 祖先，#3 走不到。
- 删除 #3（git diff 2+/2-，**净 0 行**），保留有效路径：#1 hasReview→false + #2 `review_evidence.flagged===true`（migrate 规则11 静态标记，e2e04 场景②实证）。L1361 注释标 "2026-07-15 e2e04 核实"。
- **零行为变化**：dead code 不可达，删除零语义影响、零回归（不触测试套件）。flagged 拦截机制不变（静态分支 #2 仍是有效拦截路径）。

**文档同步**：note（e2e04 条目，已写）/ sprint-plan（e2e04 完成 + dead code 清理状态）/ 本 CHANGELOG 条目。**API.md + ERROR-CODES.md 的 `E_REVIEW_FLAGGED_BLOCK` 高层描述（"父链有 flagged leaf，需先补审"）不涉及 isFlagged 三分支细节，无需改**（静态分支仍提供拦截）。**ARCHITECTURE.md / 03_ARCHITECTURE/data-model.md 无 isFlagged/flagged 提及，无需改**。引擎 md5/行数同步走 `sync-doc-md5.cjs` 单独流程（不盲替历史快照）；CLAUDE.md 更新不在本同步范围。

**零回归**：e2e04 零引擎/patches/SKILL 改动（367/0 基线不动，篡改仅场景②模拟攻击 + 场景③调参解除跨树阻塞，均备份 .bak）；dead code 删除零语义影响（不可达分支）。pro dist 已从 `5532fa5f` 更新为 `818f6cb2`（删 dead code + 重启加载新引擎；dead code 不可达，运行时零行为差异）。全量测试 16 文件零回归。

### Sprint 6 产品化验证 准备✅（2026-07-14，外部待办）

Sprint 6「产品化验证」的 5 项**准备**全部完成。**执行（PR 提交/实验跑/团队试用）= 外部依赖**，标记汇报，不在 tree-harness 单边范围。无引擎/patches 改动（367/0 零回归基线未动）。

**5 项交付**（全在 `05_PROJECT_PLAN/`）：
- **首个 Proma PR 草稿**（[first-pr-draft.md](./05_PROJECT_PLAN/first-pr-draft.md)）— 🔴 颠覆任务预设：核实上游=`proma-ai/Proma`（非 `ErlichLiu/Proma`），AGPL 开源 TS monorepo，已到 v0.13.3（补丁针对 v0.12.x 不同步）。补丁 I（禁更新）对上游有害 / J（AppUserModelId）上游单实例无场景 / F-H（跨渠道清 sdkSessionId）方向相反于上游 #903（上游收敛清除）。**没有一个现成补丁适合首个 PR**；真正路径=基于研究经验在上游 v0.13.x 找真实改进点（方向 1：MCP 会话频道/模型一致性），需源码核实后适配 TS PR。提交标记外部。
- **对照实验设计**（[experiment-design.md](./05_PROJECT_PLAN/experiment-design.md)）— 5 任务 × 3 模式 × 3 重复。🔴 **解决 success-metrics §三 gap**：Layer1 边界界定——budget（rate limit，patches.cjs）∈ Layer1 / max_sessions（count limit，依赖 tree-engine session_registry）∈ Layer2。模式 A 裸 prompt / B Layer1-only（含 budget 不含 max_sessions）/ C tree-system。指标采集（速度/成本/质量）+ 归因方法 + 预期假设。执行=外部（45 次 ~$45-225）。
- **tree-state 聚合产品指标脚本 + n=1 数据**（[aggregate-metrics.cjs](./05_PROJECT_PLAN/aggregate-metrics.cjs) + [metrics-n1-20260714.json](./05_PROJECT_PLAN/metrics-n1-20260714.json)）— 只读分析工具，扫描三实例 tree-state.json，按 tree_id 去重（433 文件→230 唯一树）。聚合：完成率 17.4%（混测试树需校准）/ 拦截率 39.1%（gate 拦下 166 次，门禁有效）/ 失控树 65（全为 Sprint 4 nudge_log_cap 之前历史，验证 cap 必要性）。**过程指标单边可采**（success-metrics 拆两档：过程 vs 终验）。
- **Q2 树形 UI 面板（补丁 L）重评估**（[q2-tree-ui-reevaluation.md](./05_PROJECT_PLAN/q2-tree-ui-reevaluation.md)）— 决策 **v1 不做**（v2 候选）。引擎内联（v0.7+）解决后端零源码泄漏，与 UI 可视化正交，UI 从"必须配套"降为"可选增强"。n=1 场景下 tree_dump + aggregate-metrics 已够；renderer 注入脆弱（依赖 minified DOM class）。触发条件：团队试用反馈/上游接受 tree-system。
- **外部依赖 backlog**（[external-dependencies-backlog.md](./05_PROJECT_PLAN/external-dependencies-backlog.md)）— 整理 5 类外部依赖（E1 PR 提交 / E2 团队试用 / E3 实验执行 / E4 SDK 回调 / E5 fork identity），每项标单边已做 vs 外部待办 vs 阻塞谁。建议执行顺序：E1 PR → E3 实验 → E2 团队并行 → E4/E5 跨仓长期。

**对 success-metrics 的修正建议**（待用户确认回写）：维护者维度"补丁合并率"分母从"tree-harness 补丁"改为"为上游适配的源码 PR"；上游仓库 `ErlichLiu/Proma` → `proma-ai/Proma`。

**零回归**：Sprint 6 是文档/脚本准备，不改引擎/patches，367/0 基线未动。脚本 `node -c` 通过。

### Sprint 5 完成（安全根治 聚类 A/B，2026-07-14）

Sprint 5 四项全部完成。全量 **286/0 零回归**（baseline 未动）+ 新增 sprint5 三测试 **81/0**（max-sessions 34 + patches-bypass 27 + gate-reachability 20）= 367 全绿。

**1. max_sessions 引擎硬护栏**（tree-engine.cjs，md5 `28cb42bb`→`5532fa5f`，5045→5216 行）— improvement P0 / 聚类 E：
- 新增 `E_MAX_SESSIONS` 错误码 + `audit_meta.max_sessions`（默认 50，≈ node_budget 20 的 2.5x，留余量给 segment/auditor/旁路 reviewer；远低于 macp2 的 207）。
- tree-state 加 `session_registry`（distinct session 登记簿）。**四路径登记**（堵绕过链）：cmdInit root / cmdLeafAdd / cmdLeafSetSession / cmdTreeRegisterSession。`registerSessionToState` 跳过 PENDING_ROOT/非UUID（不占额度）。`countSessions` 兜底（registry 缺失 → leaves distinct session 重建）。
- 新增命令 `tree register-session`（旁路登记，供 patches 调）+ `tree session-count`（只读预检 {count,max,reached}）。migrate 规则14 回灌旧树 session_registry。导出 `findTreesBySession`（session→tree 反查）。
- 防 macp2 型会话爆炸：node_budget 只数 leaf、CREATE_SESSION_BUDGET 只限单 caller 速率，两者都拦不住"多 caller 累积 + SDK 原生 create_session 旁路（不入树）"的总量爆炸。max_sessions 在 session_registry 层统计 distinct session 总数硬拦。

**2. create_session 旁路根治单边方案**（proma-dev-patches.cjs，md5 `93cd64f4`→`339082af`，3268→3342 行）— improvement P0-S01 / 聚类 A：
- 新增 `findCallerTreesForBypassGuard(sourceSessionId)`：扫描所有 workspace trees_dir，定位 caller 所属 tree（leaves session 或 registry）。
- create_session handler 加 **max_sessions 预检**（budget 后、delegationDepth 前）：caller 所属 tree 任一 reached → 拒绝 E_MAX_SESSIONS（钱没花）。
- create 成功后**旁路登记**（register-session）：把新 session_id 登记到所属 tree session_registry，让 SDK 原生 create_session 对 engine 可见（macp2 207 session 不入树的根因缓解）。
- 新增 MCP 工具 `tree_register_session` / `tree_session_count`（agent 可调）。
- 🔴 **跨仓需求标记**（单边缓解，不强行做）：真正根治需 Proma SDK create_session 回调钩子 + subagent_trace_id（Layer 4 平台层 capability-based 调用 + event hash chain，SECURITY §4.3 远期路线）。

**3. 门禁前置可达性审计**（聚类 B）— improvement / 验证（无绕过链，无需修复）：
- 审计 done 门禁链（unified-workflow §⑤ 8 门禁）+ max_sessions session 写入路径完整性。
- **结论：无新绕过链**。历史修复（P0-S03 done 单一入口 / P0-S04 audit_gate 信任锚 / P1-S03 flagged 动态化 / P2-S02 5件套持久化）+ max_sessions 四路径完整登记 = done 门禁链前置可达。
- 关键审计点：status=done 无字面量赋值（只经 cmdLeafSetStatus `=new_status` 单一入口）；done event 不自动同步 status（P0-S03 修复完整）；registerSessionToState 四调用点（init/add/set-session/register）+ migrate 回灌 + PENDING_ROOT 跳过。
- 测试 sprint5-gate-reachability-test 20/0（静态审计回归保护：防未来改动重新引入绕过链，如有人重新加 done event 自动同步或新增 session 写入不登记）。

**4. auditor role 端到端 fallback**（commander SKILL §13.4.5）— improvement P1-S04：
- SKILL 加 §13.4.5 auditor session 卡死 fallback：Proma fork identity timeout（BUG-A 跨仓）导致 auditor session 卡死时，root 归档卡死 session + 重 fork + leaf set-session 换新 session + 继续 §13.4.1 流程。
- 红线：同一 auditor leaf 重 fork ≤2 次（勿无限重试撞 max_sessions）；归档 session 不释放 max_sessions 额度（registry 记历史 session 总数防爆炸）；替代方案回退 §13.4.4 root 信任锚（不依赖 fork，无 identity timeout 风险）。
- 🔴 **跨仓标记**：fork identity timeout 是 Proma app 层 bug，本节是单边缓解；真正根治需 Proma 修 fork identity。

**测试**：sprint5-max-sessions-test **34/0**（engine 真实 require，覆盖 init/add/register/set-session/migrate/findTreesBySession 全路径 + E_MAX_SESSIONS 拦截 + max_sessions 自定义 + node_budget 独立性）+ sprint5-patches-bypass-test **27/0**（mirror 逻辑 + 源码静态校验，patches 无法 require）+ sprint5-gate-reachability-test **20/0**（聚类 B 静态审计回归保护）。零回归：6 核心 94 + dbc-spec 39 + sprint2 31 + sprint3 51 + sprint4-patches 71 = **286/0**。

**部署**：pro dist engine `5532fa5f` + patches `339082af` + commander SKILL `8b2d20f2`（md5 三校验 = 权威源）+ 重启 pro（进程 21:12 加载新代码）+ remote 探活（225 sessions）+ **pro e2e 实证**（commander 77326cb6 GLM-5.2 建树 s5pro1 + tree_session_count 返回 count=1/max=50/reached=false，证明新引擎加载 + tree_session_count MCP 工具注册 + session_registry root 登记持久化）。备份 `.bak-pre-sprint5-20260714`（源 engine/patches + dist engine/patches/SKILL）。

**跨仓依赖汇总**（标记汇报，单边缓解已做，跨仓根治不在 tree-harness 范围）：
- create_session SDK 回调钩子 + subagent_trace_id（聚类 A 根治，Layer 4 平台层）
- Proma fork identity timeout 修复（P1-S04 根治，BUG-A）

### Sprint 4 完成（跨工作区 + TAO Watcher，2026-07-14）

Sprint 4 四项全部完成。全量 **215/0 零回归**（baseline 未动）+ 新增 sprint4-patches **71/0** = 286 全绿。

**跨工作区 P1**（patches.cjs，md5 `901b3cf3`→`93cd64f4`，3174→3268 行）— agent 调用方工作区锁定（cross-workspace-tree-issue §五 P1 Part B）：
- `validateWorkspaceId`（Part A / R2-R4）只校验 workspace 存在，9 个工作区都在索引里所以拦不住 agent 跨工作区漂移。Part B 锁：agent 调用方（sourceSessionId 存在）建子会话必须留在自己 workspace 内 —— 显式跨 → `E_WORKSPACE_FORBIDDEN`；未指定 → 强制=调用方 workspace（防 workspaceId=undefined 漂出 + 子树同工作区）。顶层 user/automation 不受限（跨工作区属 admin 操作）。create_session + fork_session 双入口。
- 测试：sprint4-patches-test Task1（6 用例：顶层放行 / 未指定强制 / 同 ws 放行 / 跨 ws FORBIDDEN / callerWs 缺失 best-effort / fork 同类）。

**跨工作区 P2**（main.cjs 直编，非 apply-patches.sh）— `createAgentSession` 平台层 workspace 白名单：
- main.cjs L386653 加守卫 `if (workspaceId && !getAgentWorkspace(workspaceId)) throw E_WORKSPACE_NOT_FOUND`（在 meta3 构建前，无效 workspace 无状态副作用/无孤儿 session）。补 Part A/B 之外的平台层路径（automation / bot / 直调 API）。正常流程（合法 workspaceId）不触发。
- ⚠️ 高风险闭源 main.cjs sed：备份 `.bak-pre-sprint4-20260714` + 锚点唯一性校验（`function createAgentSession(...)` count=1）+ Node 精确单次替换 +220 bytes + `node -c` 通过 + 重启 pro 探活（231 sessions）+ create_session happy path 实证（session d755bb5b 正确挂 eb5e3f9c workspace）。**无崩溃、无回归**。

**TAO Watcher 按角色分发规则**（patches.cjs）— RULE_ROLE_SCOPE 中心表 + 结构防御：
- 之前靠 15 个规则函数各自 `if (leaf.role !== X) return []` 自过滤（散落易漏：新规则忘加 guard → 错配）。新增 `RULE_ROLE_SCOPE` 单一信源 + `ruleAppliesToRole` / `maybeForLeaf` 结构分发层：dispatch 时按 leaf.role 只跑该 role 的规则，即使某函数 guard 写错/漏写也不会错配（纵深防御，补 isSharedSessionLeaf 守卫）。a8111bf5 根因（worker 规则 W-01 经共享 session 注入根指挥官）已被 isSharedSessionLeaf 修，本表再加结构层：worker 规则（W-01/W-08/W-11/W-12/W-AUDIT-NO-ALIGN）结构上绝不发给非 worker leaf。
- 测试：sprint4-patches-test Task3（a8111bf5 不变式：worker 规则不发 root/commander/auditor + commander 专属 + commander+root + null-scope 全 role）+ **表↔函数 guard 一致性静态校验**（12 规则逐个提取函数体 guard 断言与 scope 一致，防漂移回归）。

**P1-S05 TaoWatcher 命运决策**（patches.cjs）— 保留 + 补可观测：
- **统计**（pro 26-tree 实测）：vcb2=4 条 nudge（真实价值，捕获 W-01×2/W-08×2，印证 note 07-09）vs macp2b=15052 条（nudge_log 无上限膨胀，状态污染，无行为效果）。0 触发树（sd3e2e/verifycb2/e2e-v10-test）= 合规/短命，非 watcher 没跑。
- **决策**：保留（vcb2 实证非纯安全剧场）+ 补可观测（nudge_log cap）。砍掉选项被数据否决。
- **落地**：applyNudge 加 `nudge_log_cap`（默认 50，cfg 可配，<=0 关闭）+ 专用累计计数器 `leaf.nudge_log_dropped_total`（独立于条目存活，永远准确，一眼知累计浪费）。loadTaoConfig 两处默认 + config-patch 白名单。file-log 留 follow-up（更大 scope）。
- 测试：sprint4-patches-test Task4（未超 cap 不截 / 超 cap 截到 50+droppedTotal / cap=0 关闭 / 多次截断累计 / 保留最近 N 条）。

**测试**：sprint4-patches-test **71/0**（Task1 6 + Task3 29 + Task4 5 + 源码静态 13 + 表↔guard 一致性 12 + Task4 静态 6）。patches.cjs 顶层 electron 副作用无法 require → mirror 纯逻辑契约 + 源码静态校验（同 sprint3-d3 模式）。零回归：6 核心 94 + dbc-spec 39 + sprint2 31 + sprint3 51 = **215/0**。

**部署**：pro dist patches `93cd64f4`（md5 双校验 = 权威源）+ main.cjs P2 直编 + 重启 pro（进程 19:55 加载新代码）+ remote 探活（231 sessions）+ create_session happy path 实证。备份 `.bak-pre-sprint4-20260714`（源 patches/engine + dist main.cjs/patches）。无 SKILL 改动（patches 层 + main.cjs 平台层，均非 SKILL 协议变更）。

### Sprint 3 Phase D 完成（prune 级联 / 版本管理 / watcher 静默，2026-07-14）

Phase D 三项全部完成。全量 **215/0 零回归**（164 基线 + 51 新 D 测试）。

**引擎**（tree-engine.cjs，md5 `9f575fb8`→`28cb42bb`，4961→5045 行）：
- **D1 prune/archive 级联语义**（cmdLeafSetStatus）：父 pruned → 未 done 后代级联 pruned（+ drift 留痕）；已 done 保留且不下降子树；终态不动；archived 不级联；root 防级联。迭代 DFS + 同 withLock 事务，绕过 STATUS_TRANSITIONS/caller-binding（级联子是内部变更）。result 加 `cascaded`
- **D2 migrate 版本管理**：新增 `SCHEMA_VERSION`（单一信源，当前 '1.1'）+ `SCHEMA_LADDER` + `SCHEMA_HISTORY` + `compareVersion`；cmdInit 用 SCHEMA_VERSION；cmdMigrate 规则 12 按 ladder 逐级分发（多跳可追溯）+ clamp 防漂移。**不升 1.2**（无新 schema 字段；升 1.2 破坏 auditor-role-test Case 8）

**patches**（proma-dev-patches.cjs，md5 `611751b2`→`901b3cf3`，3129→3174 行）：
- **D3 watcher silence_minutes**：loadTaoConfig 默认 silence_minutes/silenced_until + 旧 config 合并；纯函数 `decideWatcherSilence(cfg, nowMs)`；runOnce 静默跳过（过期自动恢复）；IPC `proma:watcher-silence {minutes}`（clamp 1min~7天）；status 暴露 silence；config-patch 白名单加两字段

**测试**（3 新增，全用权威源引擎）：sprint3-d1-cascade-test 19/0 + sprint3-d2-version-test 10/0 + sprint3-d3-silence-test 22/0。零回归：6 核心 94 + dbc-spec 39 + sprint2 31 = 164。D3 因 patches.cjs 顶层 electron 副作用无法 require → 纯逻辑 mirror 契约测试 + 源码静态校验 8 项

**部署**：pro dist 引擎 `28cb42bb` + patches `901b3cf3`（md5 双校验 = 权威源）+ 重启 pro（进程 15:46→19:06）。备份 `.bak-pre-sprint3-phaseD-20260714`（源 + dist）。无 SKILL 改动（D1/D2 引擎内部行为 + D3 IPC，均非 SKILL 协议变更）

**pro 实证**：会话 `78457d75`（GLM-5.2）建树 sd3e2e + 3 子 session，set-status commander=pruned → 返回 cascaded=[2 workers pending_brief→pruned]，leaf_get 确认两 worker=pruned + drift 留痕。D1 cascade 经 pro MCP + 真实 session 端到端生效

**工具**：新增 `.context/sync-doc-md5.cjs`（行数自动同步 + md5 现状报告；md5 不自动替换——盲替会失真历史快照，见 note 事故记录）

### Sprint 2 完成（约束激活，2026-07-14）

methodology-coverage-audit 6 条死硬约束：3/4/5 🟢 已激活，6 🟡 部分激活（1/2 在 Sprint 1/5）。

**引擎**（tree-engine.cjs，md5 `2d281ebf46`→`9f575fb8`，4895→4961 行）：
- 约束 4：leaf schema 加 5 件套（brief/dod/report_protocol/autonomy/self_audit，cmdInit L770 + cmdLeafAdd L1056）
- 约束 5：set-session/restore/migrate 三命令联动写 drift（双写 leaf.drift_history + state.drift_log）
- 约束 6：cmdLeafSetContext ctx≥阈值（默认 85）→ 自动 segment_pending + drift handoff（替代 SKILL §8.3 v0.3 未实现）
- **顺带修复 pre-existing P1 bug**：restore tree_id mismatch（tree-state.json 加 tree_id 自描述 + migrate 规则 13 补）

**SKILL**：
- commander §4 Step 2 强制 create_session + 混合任务书；§7/F1 fork 边界标注；§7 中档 autonomy_override 失同步标注；§8 心跳集成 get_session_context + sweet_spot_risk 竹节交接
- worker §2 启动 tree_leaf_get 读 leaf 5 件套 + milestone_add 持久化教化；§2.5 派生/读 5 件套改 create_session

**测试**（3 新增，全用权威源引擎）：sprint2-five-piece-test 15/0 + sprint2-drift-linkage-test 9/0 + sprint2-ctx-segment-test 7/0。零回归 dbc-spec 39/0

**部署**：pro dist 引擎 `9f575fb8` + commander SKILL `2d0c1464` + worker SKILL `8e14bc81`（重启 pro 加载）

**pro 实证**：commander d218bd5c（GLM-5.2）tree_init→leaf_get 验证 5 件套 brief/dod 完整回填（47s）

### Pending
- Layer 4 subagent_trace_id（平台层依赖，大工程，单独立项）
- Q2 树形 UI 面板（补丁 L）实施 — 已让位给 v0.7+ 引擎内联
- Release 严重落后 dev 1131 行，按用户指示暂不同步
- TaoWatcher file-log 可观测（Sprint 4 P1-S05 决策保留后的 follow-up：watcher 运行日志独立落盘，不依赖 tree-state.json nudge_log）

---

## [V10 Phase 3 + IHL] - 2026-06-26

### Added
- **IHL（Iterative Hardening Loop）方法论成型**，盲点驱动的 6 轮迭代加固闭环
  - 模式：`盲点暴露（真实场景）→ 入口补丁 → SubAgent 静态校验 → 运行时验证 → 发现新盲点`
  - 命名：Iterative Hardening Loop / 盲点驱动的迭代加固
- **Layer 4 攻击向量识别**：直接编辑 `tree-state.json` 绕过引擎
- **三层防御拓扑**：
  - 入口拦截层：`cmdEventAppend L1498` / `cmdLeafAdd L705` / `create_session L461` / `fork_session L601`
  - 兜底守卫层：`cmdAuditGate L2337` / `resolveAuditorIndep L1897` / `checkAllRules` / `applyNudge`
  - 事后检测层：`W-AUDIT-SELF` / `W-AUDIT-WORKER` / `W-AUDIT-TAMPER` / `W-AUDIT-NO-ALIGN`
- **4 条 W-AUDIT-* tamper detection 规则**：
  - `W-AUDIT-SELF`：worker 自审通过
  - `W-AUDIT-WORKER`：worker 当 auditor
  - `W-AUDIT-TAMPER`：audit_log 伪造 pass=true
  - `W-AUDIT-NO-ALIGN`：worker pass 无 alignment
- **`validateWorkspaceId` helper**：`create_session` + `fork_session` 双入口共享，复用 R2 实现
- **6 个新 commit 全部已 push 到 orphiczhou/proma-patches**：
  - `1a7ed5f` R1：applyNudge 全局守卫
  - `031c546` R2/R4：workspace_id 校验
  - `d44163a` R5：4 条 W-AUDIT-* tamper detection
  - `690f7e8` R6：R5 规则移到 Tier 1（对 all leaf 跑，绕开 status 守卫）
  - `9c423b8` TAO Watcher 入口守卫（V10 P3 前置）
  - `30eb4fa` Bug A/B 双重修复 + 文档沉淀

### Changed
- `proma-dev-patches.cjs` 行数 2532 → **2658**（+126 行）
- `tree-engine.cjs` 行数 3565 → **3602**（+37 行，含 Bug A/B + IHL R5/R6）
- 三份 patches.cjs 物理同步（仓库版 + dev dist + patch-l）一致

### Fixed
- **Bug A**（commander 代 worker 写 done event）：`cmdEventAppend L1498` 加 caller 校验，只允许 `leaf.session_id` 自己写 done event
- **Bug A-2**（Auditor #2 独立发现的 hasDone 漏洞）：`cmdAuditGate L2337-2345` 检查 caller_session_id
- **Bug B**（同 session 多 leaf 歧义）：新错误码 `E_DUPLICATE_SESSION_ID` + `cmdLeafAdd L705-718` session_id 唯一性校验
- **Bug B-4**：`resolveAuditorIndep L1897-1911` `.filter` 跳过 pruned
- **TAO Watcher 规则错配（部分）**：a8111bf5 主线会话因 worker 规则发给 root 意外终止，IHL R1 入口守卫缓解

### Security
- **Prompt Injection 防御副产品**：会话期间收到 6 条试图诱导 root 滥用 `audit_gate` 的注入指令（让 root 给 worker / commander / 不存在的 leaf 标 pass），V10-trust-anchor 设计 + root 自律全部拒绝

---

## [V10 Phase 1/2] - 2026-06-25

### Added
- **V10 八大加固点**，把"字段存在性校验"升级为"内容有效性校验"：
  - `V10-auditor-active`：auditor leaf 必须 status=done + 自身 audit_gate.verdict=pass + events 非空（三重校验）
  - `V10-self-audit-v2`：audit_session_id ≠ 被审 leaf.session_id + ≠ 调用方 session_id（防借身份）
  - `V10-uuid-strict`：所有 session_id 字段严格 UUID v4 校验，拒绝全 f / 全 0 / 空串 / 字符串伪造
  - `V10-numeric-consistency`：total/passed/failed ≥ 0 + p+f=total + results.length=total
  - `V10-nudge-escalation`：nudge_count 3→medium / 5→high / 7→强制 pruned
  - `V10-timestamp-monotonic`：ts ≥ created_at + ≤ now(+60s) + 单调递增
  - `V10-workspace-canonical`：patches.cjs fallback "default" + remote_create_session 强制 workspace_id
  - `V10-status-event-sync`：leaf status 与 last_event_type 强制一致
- **Trust Anchor（root 自审特例）**：解决鸡生蛋问题（root 是信任锚点时允许 root 自审）
- **D4 Helper 4 层自助文档**：堵模型层失守时的兜底（`tree_help` 13 topics）
- **C5 root 信任锚修复**：
  - 攻击向量 1：worker 用 null 给 root 调 audit_gate pass → root 信任锚不再放行 null
  - 攻击向量 2：worker 给 root 写 done event 触发 auto_upgrade → `cmdEventAppend` 加 caller 校验
- **双轮收敛**：C1→C2→Cr→Cr2→A1→A2→DBC fix→dev E2E→C3 trust anchor→C5 fix→A5 verify
- **6 套金标准 0 退化**：164 测试全过（24+6+54+48+18+14）
- **commit `7d36cc7`**（P2）+ **`f98805d`**（开发树）

### Changed
- `tree-engine.cjs` 行数 2471 → **3565**（+1094 行）
- 洁净室 Cr 优先于 A1 代码层评（Cr 发现 10 个真实失守 vs A1 8/8 合格）

### Security
- **audit-gate-test-20260625 教具案例保留作 V10 加固方向依据**（3 副本不删不改）
- vfa1 注入 4 种攻击 + vfb 注入 13 种攻击（旧引擎 0% 拦截）→ V10 后全部拦截

---

## [V4-V9 DbC 加固] - 2026-06-24

### Added
- **9 个 V4-V9 硬约束点**：
  - V4：milestone `audit_pass=true` 需 auditor_session_id
  - V5b：worker done 需 events alignment 回填（查 events 留痕，不查可篡改布尔标志）
  - V6：self_check 不能全 pass:false
  - V8：worker budget 严格校验
  - CP2：alignment_pending 篡改防护（改为查 events）
  - V9：expect_outputs 路径不是绝对路径/symlink 逃逸
  - 审计[1][2][3]：审计报告三重校验
- **Tree 方法论成型**（实现/测试/审计分离 + 自举 + 迭代收敛）
  - 实现（主会话）/ 评价（SDK Agent）/ 独立审计（collaboration 真实子会话 DeepSeek V4 Pro, role=auditor）/ 洁净室（独立团队）
  - 关键教训：安全检查不依赖可篡改布尔标志，验 events 留痕
- **audit-attacks 18 攻击 0 BYPASS**
- **dbc-spec 36/0**
- **commit `efbf139`** + **`59357f1`**（V4-V9 followup Tree 模式实战）
- **R2-T7**（洁净室发现）：`audit_append` `results[i]` 校验缺失，spec §18.3 要求三元组 `{item, pass, evidence}`
- **M2**：`audit_append` 顶层 `total/passed/failed` 整数类型校验

### Changed
- Tree 模式首次完整实战（4 commander + 4 评价 + 洁净室 3 轮 31 测试 29 pass）
- 4 个评价子 Agent + 洁净室独立团队对抗确认偏误，发现 3 个实现者盲点（alignment_pending 标志篡改 / budget 字符串 / symlink）

### Fixed
- **Bridge 端口遮蔽 bug**：Dev bridge `0.0.0.0:19876`（Windows bat 必须 ASCII），3 实例 bridge fallback 全通过

---

## [v0.7+ 引擎内联] - 2026-06-23

### Added
- **tree-state.js (2428 行) → `tree-engine.cjs` 内联进 patches.cjs**
- **工作区零源码泄漏**：agent 看不到改不到引擎代码（v0.7 之前 tree-state.js 是工作区独立脚本，agent 可以 Read/Edit/cat 绕过 MCP，独立审计发现这是漏洞）
- **27 个 `mcp__tree__*` MCP 工具**（消除 spawn 包装）
- **per-call `treesRoot` 并发安全**：`run(cmd, args, treesRoot?)` 与 CLI stdout 等价
- **`TREES_ROOT` 可注入 + `findEngine` 自适应定位 engine**

### Changed
- 部署模式：`dist/`（patches + engine）+ 激活 SKILL + 清理 3 处遗留
- 验证：smoke + dbc-spec 21/0 + audit-attacks 18/CRITICAL=0 + A1 独立审计子会话

---

## [v0.7 Phase A] - 2026-06-23

### Added
- **12 个 DbC 校验点**（commit `1757b5e`）：
  - A1-A7：CP1-CP6（文件幻觉 / 自审自过 / 节点失控 / 伪自检 / validate 失败续跑 / 时序倒挂）+ SP1
  - HARDEN2 / HARDEN6：加固 #2/#6
  - V1/V2/V3 审计加固：restore 旁路 / auditor 白名单 / expect_outputs 非空
- **把 SKILL.md 的"应当"升级为代码"必须"**
- **ROLE_ENUM 硬化**：`['root', 'commander', 'worker']`，自由文本 role 一律拒绝
- **E_DEPTH_EXCEEDED**：深度限制 ≤ 3（堵 qfv2 式 5 层嵌套）
- **`collectValidateIssues` + `resolveAuditorIndep` 白名单 + `migrate`**
- **Worker 禁子节点 + 根唯一性**
- **实施方式**：4 批次真实子会话（自举）+ commander 独立验收（dbc-spec 21/0）+ 独立对抗审计

---

## [Tree System v0.2.x] - 2026-06-21

### Added
- Q1 v2 全深度验证（10 leaf 3 层 38/38 全通过）
- Q1 v1.1 架构升级（role 枚举 / 深度限制 / migrate / Leaf Purity）
- ROOT_PLACEHOLDER / CLI 注入 / Events 空洞修复
- 洁净室审计 22 项修正 + L1Fix v2 审计（7 worker × 2 round）

### Fixed
- 8 项 Q1 v2 验证发现的问题（2 阻断 / 3 严重 / 2 中等 / 1 低）

---

## [v0.16.5] - 2026-06-19

### Fixed
- **补丁 K 修正**：恢复 `ISOLATED === "1"` 双条件检查（v0.16.4 误删），防止 Release 误隔离
- **remote-session Release 验收**：39/40 有条件通过（1 个 fork new_title Bug，不阻断上线）

### Changed
- 两变量体系定型：`PROMA_INSTANCE_NAME` 管身份 + `PROMA_INSTANCE_ISOLATED` 管数据隔离

---

## [v0.16.4] - 2026-06-18

### Added
- **补丁 I**（禁更新检查）：`initAutoUpdater` 首行 return，不弹更新对话框
- **补丁 J**（AppUserModelId 动态隔离）：`com.proma.{NAME}`，三版任务栏独立
- **补丁 K**（userData 路径动态化）：`electron-{NAME}`

### Fixed
- **补丁 H v2**（跨频道/跨 provider 模型切换完整修复）：channelId 或 modelId 任一变化 → 清 sdkSessionId + 同步 meta
- **Bug 4**（fork 跨 sdkSession 候选循环试错）
- **Bug 5**（send_message 同步 meta）
- **补丁 G**（CLAUDE_CONFIG_DIR 无条件覆盖）：修复 Dev fork 失败 0/3 → 3/3

### Changed
- v0.16.3 多维度综合交叉测试报告通过

---

## [v0.16.3] - 2026-06-18

### Added
- 矩阵 D/E/F/G 测试报告（SubAgent HTTP bridge 执行）
- v0.16.3 回归测试报告（SubAgent HTTP bridge 执行）

### Fixed
- 跨频道换模型丢上下文根因调研
- 补丁 H v1 实测发现盲点 → 升级到 v2

---

## [v0.16.0] - 2026-06-15

### Added
- **项目初始版本**
- **11 个核心补丁 A-K**：
  - A：MCP 钩子注入（`global.__proma_getMcpServers__`）
  - B：API 桥接 + 加载插件（导出 12 个核心 API）
  - C1-5：频道+模型元数据覆盖
  - D+E：Renderer 同步 + 守卫移除
  - F：跨渠道 sdkSessionId 防护（后被 H v2 替代）
  - G：CLAUDE_CONFIG_DIR 无条件覆盖
  - H：跨频道/跨 provider 模型切换完整修复
  - I：禁更新检查
  - J：AppUserModelId 动态隔离
  - K：userData 路径动态化
- **22 个 MCP 工具**（11 本地 `mcp__session__*` + 11 远端 `mcp__remote-session__*`）
- **session-management Skill v1.3.0**
- **GitHub 仓库** `orphiczhou/proma-patches` 建立
- **apply-patches.sh** v0.16.5 一键部署
- **三实例运行环境**：Dev（隔离）/ Release（共享）/ 正式版（不动）
- **localhost HTTP bridge**：端口 19876-19895 自动选
- **send_message 三模式**：wait 同步 / notify 异步 / fire-and-forget + 轮询

---

## 版本号说明

- **vX.Y.Z**（如 v0.16.5）：Layer 1 MCP 基础设施层版本号
- **V10 Phase X**：Layer 2 树形会话执行体系的大版本里程碑
- **IHL R1-R6**：Iterative Hardening Loop 的迭代轮次（V10 之后的持续加固）
- **commit hash**：具体提交标识，可追溯到 orphiczhou/proma-patches

## 测试金标准

每个版本发布前都跑以下金标准套件，要求 0 退化：

| 套件 | 当前通过率 |
|---|---|
| `test-sandbox/dbc-spec.cjs` | 48/0 |
| `test-sandbox/audit-attacks.cjs` | 18 攻击 / 0 BYPASS |
| `test-sandbox/v10-cleanroom.cjs` | 54/54 |
| `test-sandbox/v10-regression.cjs` | 14/0 |
| `test-sandbox/audit-extra.cjs` | 21 case |
| 真实环境 e2e（V10 P2） | 6 阶段全通过 |

---

## 链接

- **GitHub**：[orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches)
- **README**：[README.md](README.md)
- **LICENSE**：[LICENSE](LICENSE)（AGPL-3.0 + ADDENDUM）
- **Project Index**：[`.context/PROJECT-INDEX.md`](.context/PROJECT-INDEX.md)
- **图形化向导**：[`.context/project-onboarding-guide-2026-06-25.md`](.context/project-onboarding-guide-2026-06-25.md)
- **Keep a Changelog**：https://keepachangelog.com/
- **Semantic Versioning**：https://semver.org/

---

> 维护：周星星 (orphiczhou) | 最后更新：2026-06-26
