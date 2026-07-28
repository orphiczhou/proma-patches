# D6 安全对抗审计报告 — Tree Harness FINAL-REPORT 对抗核验

> 审计员: audit2-D6-worker (GLM-5.2, ZLM 渠道)
> 审计对象: FINAL-REPORT.md 自评 7/7 + C1=86（§3.6 CLI 兼容通道兜底 / 引擎 V10 加固）
> 审计日期: 2026-07-28
> 审计方法: 攻击者视角独立源头文档核验（tree-engine.cjs V10 加固点 + proma-dev-patches.cjs MCP 注入 + macp11 实战归档），未读 audit-20260728/ 根目录任何并行审计产物

---

## 一、执行摘要

- **总体判定**: 🔴 **CLI 兼容通道是 P0 后门，FINAL-REPORT §3.6 把它定性为"兜底"是严重低估**。V10 加固在 **MCP 入口路径**（`proma-dev-patches.cjs` L1989-1995 注入 callerSessionId）上确实坚固，但在 **CLI / `require()+run()` 路径**上系统性失效——而该路径被 macp11 实战使用、被 FINAL-REPORT §3.6 正式接纳、甚至被 Roadmap §5 提议"标准化"。
- **confidence**: **high**（每条 finding 均有 file:line 代码证据 + 原文引用，攻击链可端到端复现）
- **核心结论（一句话）**: V10 的 9+ 道 caller-binding 校验**全部**用 `if (callerSessionId && ...)` 模式实现，只要调用方走 CLI shim（`tree-engine.cjs` L5762 `run(cmd, args)` 不传第 4 参）或 `require()+run()`，callerSessionId 即为 undefined，**全部身份校验被短路**；macp11 实战的"省略 callerSessionId 跳过 V10 caller 校验"（ROOT-PROXY-HANDOFF L6）不是兜底，是任何拥有 Bash/文件系统访问的 leaf 都能复用的越权通道，且成功调用**不自动留 drift 痕**。

---

## 二、Findings 表

| # | Severity | 问题摘要 | 证据 (file:line / 原文 / 归档) | 对 7/7 或 C1=86 的影响 |
|---|----------|---------|------------------------------|----------------------|
| F1 | 🔴 RED (P0) | CLI null-mode 系统性绕过全部 V10 caller-binding：9+ 处校验全用 `if (callerSessionId && ...)`，CLI/require 路径 callerSessionId=undefined 全部短路 | tree-engine.cjs L5646/L5654/L5754-5762 + L1032/L1732/L2158/L2251/L2341/L2416/L2522/L3560/L3701；proma-dev-patches.cjs L1989-1995；FINAL-REPORT L80 | §3.6 宣称的"兜底"实为后门；7/7 第 6 项"综合实战验证"含 CLI 兜底＝把后门当资产 |
| F2 | 🔴 RED (P0) | root 信任锚 auto_upgrade 的 defense-in-depth 自毁：`callerIsRootSelf = !callerSessionId \|\| ...`，CLI 模式 `!undefined`=true → 任意调用方可触发 root.audit_gate skip→pass | tree-engine.cjs L2762-2777（注释明言"即便 caller 校验被绕过也不会触发"，代码却相反）；SECURITY §3.5 C5 | 直接推翻 C5 P0 修复承诺；root 信任锚可被 worker 一键背书 |
| F3 | 🔴 RED (P0) | CLI 模式 audit_gate 自我背书：caller 校验（L3560）被跳过 + resolveAuditorIndep 的 root-as-auditor 分支（L3061-3074）放行 → worker 可冒 root.session_id 给自己写 pass | tree-engine.cjs L3560/L3061-3074；ROOT-PROXY-HANDOFF L6；SECURITY §2.1 自审自过 | audit_gate=pass 在 CLI 路径下完全失去"独立审计"语义 |
| F4 | 🟡 YELLOW | audit_log 内容伪造：引擎只校验 schema+数值一致性+severity 枚举，不校验内容真实；red 阈值只扫**最新一条** audit_log（旧 red 被 append 覆盖即清零） | tree-engine.cjs L3639-3651（只看 `_latestAudit`）/ L3783-3796（只查 auditor.role!==worker）；引擎自述 L3772-3779 | 合谋/单 auditor 可全 green 蒙混；v0.23"只看最新"让历史 red 可被新条目静默清洗 |
| F5 | 🟡 YELLOW | review_round 内容伪造（引擎自认）：worker 可自写格式合法的全 green review_round + subagent_spawn 溯源链蒙混 done 门禁 | tree-engine.cjs L1508-1509 / L4852-4853 原文"仅防格式伪造，不防内容伪造"/ L1599-1707 schema 校验 | done 门禁对"内容伪造"无引擎层防御，全靠 auditor 抽查（§4 Step4 是流程非强制） |
| F6 | 🟡 YELLOW | session_liveness 无后台回收：真实 session 失效（余额耗尽/超时）后 leaf 仍 active，可被持续借身份；CLI 路径 verifier 未注入→退化为纯格式校验 | tree-engine.cjs L272-298（bypass=best-effort）/ L3085-3090；SECURITY §2.3 僵尸 auditor | 僵尸 auditor / 僵尸 root 可作为长期越权载体 |
| F7 | 🟡 YELLOW | audit_gate pass 不可撤销 + CLI 可翻 fail→pass：无 immutability，cmdAuditGate 接受任意 verdict 重写；恶意方可反复重写直到 pass | tree-engine.cjs L3540-3541（verdict 枚举含 pass+fail）/ L3654-3658（直接覆写 leaf.audit_gate） | pass 一旦在 CLI 路径写入即失去审计权威性，无回滚/签名链 |
| F8 | 🟡 YELLOW | drift 留痕对成功 CLI 调用非强制：auto-drift 仅在 RECOVERABLE_ERROR_CODES 错误路径触发，成功越权零留痕 | tree-engine.cjs L5669-5699（`if (...RECOVERABLE_ERROR_CODES.has(code))` 仅 catch 分支） | FINAL-REPORT "macp11 留 drift 痕"是自觉声明非引擎强制；silent 绕过可行 |
| G1 | 🟢 GREEN | V10 strict UUID v4 + session liveness 在 MCP 入口真实有效（verifier 注入）：堵占位/全 0/全 f/非 v4/伪造 UUID | tree-engine.cjs L276-298（assertMcpEntrySessionId）/ L3078-3090；proma-dev-patches.cjs L1936 verifier 注入 | MCP 路径 UUID 伪造攻击面已关闭（v10-cleanroom 54/54 实证） |
| G2 | 🟢 GREEN | resolveAuditorIndep V10-auditor-active 三重校验（status=done + events 非空 + 自身 audit_gate=pass）在 MCP 路径有效 | tree-engine.cjs L3110-3119 | 堵僵尸 auditor（audit-gate-test 404c724f 类）在 MCP 路径已关 |
| G3 | 🟢 GREEN | W-AUDIT-* 4 条 tamper detection 移至 Tier 1（对 all leaf 跑），事后检测直接编辑 tree-state.json 的 self-audit / worker-当-auditor 模式 | SECURITY §3.8 / §3.7 R5/R6；patches.cjs L2491-2570 | Layer 4 攻击有事后兜底（但见 F1：CLI 路径绕过不触发这些模式） |
| G4 | 🟢 GREEN | C5 删除 `auditorSessionId===null` 放行支：堵 worker 不传 audit_session_id 一键改写 root.audit_gate | tree-engine.cjs L3037-3046；SECURITY §3.5 | MCP 路径 null-audit_session_id 自审已关闭（但见 F2：CLI null-caller 重新打开缺口） |

---

## 三、详细分析（RED / YELLOW 逐条展开）

### F1 🔴 CLI null-mode 系统性绕过全部 V10 caller-binding（P0 后门）

**位置**: 
- CLI 入口: `tree-engine.cjs` L5754 `if (require.main === module)` + L5762 `run(cmd, args)`（**不传第 4 参 callerSessionId**）
- run 签名: `tree-engine.cjs L5646 async function run(cmd, args, treesRoot, callerSessionId)` + L5654 `const callerSid = callerSessionId || null`
- 全部 9 处 caller-binding 校验（均 `if (callerSessionId && ...)` 短路模式）:
  - `cmdLeafAdd` L1032 `if (callerSessionId && added_by && callerSessionId !== added_by)`
  - `cmdLeafSetStatus` L1732 `if (callerSessionId) { ... _isOwner/_isCreator/_isRootSelf ... }`
  - `cmdLeafSetSession` L2158 `if (callerSessionId)`
  - `cmdMilestoneAdd` L2251 `if (callerSessionId)`
  - `cmdMilestoneSetResult` L2341 `if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId)`
  - `cmdMilestoneUpdate` L2416 `if (callerSessionId)`
  - `cmdEventAppend` L2522 `if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id)`
  - `cmdAuditGate` L3560 `if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId)`
  - `cmdAuditAppend` L3701 `if (callerSessionId && callerSessionId !== entry.auditor_session_id)`

**问题**: V10 把"caller 身份校验"作为对抗借身份攻击（worker 528b0925 借 auditor 404c724f）的核心防线，但实现上**全部以 callerSessionId 真值作为守卫前提**。CLI shim（`node tree-engine.cjs <cmd>`）与 macp11 实战的 `require('tree-engine.cjs') + setTreesRoot + run(cmd, args)` 都不传 callerSessionId，导致 callerSessionId=undefined，9 处守卫**全部静默跳过**。代码注释反复出现"CLI 调用（dbc-spec 等）不传 caller，跳过此校验（向后兼容）"——这是把测试兼容性摆在了安全之上。

**证据（原文）**:
- FINAL-REPORT.md §3.6 L80: 「tree-engine.cjs 直接调引擎 `setTreesRoot + run(cmd, args)`，**省略 callerSessionId** 跳过 V10 caller 校验（引擎降级非 V10 路径），`audit_session_id` 诚实署名」
- ROOT-PROXY-HANDOFF.md L6: 「改走 tree-engine CLI 兼容通道（... `setTreesRoot` + `run`，**省略 callerSessionId 跳过 V10 caller 校验**，audit_session_id 诚实署名=root）」
- tree-engine.cjs L1031-1035 注释自认: 「CLI 不传 caller（undefined）跳过，向后兼容金标准测试」

**攻击场景（端到端可复现）**:
1. 恶意 worker W（session_id 已在树中，拥有 Bash/Write 工具）想给自己伪造 audit_gate=pass 而不依赖真实 auditor。
2. W 读 `<workspace>/.context/trees/<tree>/tree-state.json`（leaf 可读），获取 root.session_id（或任意已 done 的 commander session_id）。
3. W 执行: `node D:/Codes/tree-harness/tree-engine.cjs audit gate <tree> W --verdict pass --audit-session-id <root.session_id>`（或等价 `require()+run()`）。
4. 引擎: callerSessionId=undefined → L3560 caller 校验短路跳过；resolveAuditorIndep 走 L3061-3074 root-as-auditor 分支，root active+有 events → return null 放行；L3592-3651 done event 存在 + 最新 audit_log 无 red → **W.audit_gate.verdict=pass 落盘**。
5. call-log.jsonl 记 `caller_session_id: null`，但无任何 W-AUDIT-* 规则触发（auditor=root 非 self / 非 worker）。攻击零可观测痕迹。

**后果**: V10 宣称的"9 道加固 0 BYPASS"（SECURITY §3.4/§7.1）只在 MCP 路径成立。CLI 路径下 audit_gate / milestone_set_result / leaf_set_status / leaf_set_session / event_append(done) / audit_append / leaf_add 的身份校验全部失效。SECURITY §2.3 把"直接编辑 tree-state.json"列为 Layer 4 残留风险，但 CLI 路径是**比直接编辑更优的攻击面**——它产出引擎合规的写操作（通过所有 schema 校验），比裸改 JSON 更难被 W-AUDIT-* 检测。

**威胁模型映射**: SECURITY §2.1「自审自过 / 字段篡改」+ §2.3「Layer 4 直接编辑」+ §4.2「冒用 session」。FINAL-REPORT 把它当兜底，实际是 §4.2 所列"堵不住"风险的引擎内嵌版本。

**修复建议**:
1. **P0**: CLI shim 与 `run()` 在 callerSessionId 缺省时，对身份敏感写操作（audit_gate / milestone_set_result / leaf_set_session / leaf_set_status / event_append done / audit_append / leaf_add）**默认拒绝**而非降级，强制要求显式 `--caller-session-id` 参数并校验其合法性。
2. **P0**: 引入引擎层"调用来源标记"（mcp_injected vs cli_explicit），W-AUDIT-* 增加规则: 身份敏感写操作若 call_log 显示 caller_session_id=null 即 high severity 告警。
3. **P1**: 废弃 FINAL-REPORT §5 Roadmap「CLI 兼容通道标准化（caller 缺省降级文档化）」——标准化后门等于永久放弃该路径的安全保证。

---

### F2 🔴 root auto_upgrade 信任锚 defense-in-depth 自毁

**位置**: `tree-engine.cjs` L2762-2777

**问题**: C5 修复（SECURITY §3.5）为堵"worker 给 root 写 done event 触发 auto_upgrade"，加了 defense-in-depth 条件 `callerIsRootSelf`。但代码实现为:
```js
// L2769
const callerIsRootSelf = !callerSessionId || callerSessionId === leaf.session_id;
// L2770
if ((!curGate || curGate.verdict === 'skip') && callerIsRootSelf) {
  leaf.audit_gate = { verdict: 'pass', auditor_session_id: leaf.session_id, ... auto_upgrade: true };
}
```
L2764-2766 注释明言「即便 caller 校验被绕过（如新增 caller 不传的路径）也不会触发」——但 `!callerSessionId` 这一分支**正是 caller 不传的路径**，且它使 callerIsRootSelf=true。注释的承诺与代码的实现直接矛盾。

**证据**: tree-engine.cjs L2762-2766 注释 vs L2769 代码（见上）。SECURITY §3.5 C5「失守 2」明言该守卫是 defense-in-depth。

**攻击场景**: 与 F1 同入口。恶意 worker W 执行 `node tree-engine.cjs event append <tree> <root_leaf_id> --type done`（CLI 不传 caller）。L2522 done-event caller 校验短路 → 写入 done event → L2767 role===root + L2769 `!undefined`=true → **root.audit_gate 从 skip 一键升 pass**（auditor=root.session_id, auto_upgrade=true）。整棵树的信任锚被 worker 单方面激活。

**后果**: 信任锚（trust anchor）是整棵树审计链的根，一旦 pass 即可作为 auditor 给任意非 root leaf 背书（resolveAuditorIndep L3061-3074）。worker 先激活 root 信任锚，再用 root.session_id 给自己 audit_gate=pass（见 F3），形成闭环越权。

**威胁模型映射**: SECURITY §2.1「自审自过」+ §3.5 C5「失守 2」（C5 修复被自身的 `||` 子句重新打开）。

**修复建议**: `callerIsRootSelf` 应严格为 `callerSessionId === leaf.session_id`（删除 `!callerSessionId ||`），CLI 模式下 root done event 不触发 auto_upgrade（如需测试兼容，用独立 `--allow-auto-upgrade` 显式 flag + 环境变量白名单）。

---

### F3 🔴 CLI 模式 audit_gate 自我背书（root.session_id 冒用）

**位置**: `tree-engine.cjs` L3560（caller 校验）+ L3061-3074（resolveAuditorIndep root-as-auditor 分支）

**问题**: cmdAuditGate 的 caller===audit_session_id 校验（L3560 `if (audit_session_id && callerSessionId && ...)`) 在 CLI 模式因 callerSessionId=undefined 短路。此后引擎进入 resolveAuditorIndep，若 audit_session_id 指向 root.session_id 且 root 满足 active+有≥1 event（L3061-3074），返回 null 放行。这意味着 **caller 是谁引擎完全不关心**，只看 audit_session_id 指向的 leaf 是否合格——而 audit_session_id 是调用方任意指定的字符串参数。

**证据**: 
- tree-engine.cjs L3555-3565 注释「CLI 调用（dbc-spec 等）不传 caller，跳过此校验（向后兼容）」
- tree-engine.cjs L3061 `if (leaf.role !== 'root' && auditorSessionId) { ... rootLeaf find ... return null 放行 }`
- ROOT-PROXY-HANDOFF.md L6「audit_session_id 诚实署名=root」——"诚实署名"是调用方自觉声明，引擎无校验手段。

**攻击场景**: 见 F1 攻击场景第 3-4 步。worker 用任意已 done 的 leaf session_id（不止 root，任何已 done 的 commander/auditor 都行——L3110 要求 auditor.status==='done' + L3117 自身 audit_gate=pass）作为 `--audit-session-id`，即可让引擎把 worker.audit_gate 置 pass。

**后果**: audit_gate=pass 的"独立审计"语义在 CLI 路径下完全空心化。FINAL-REPORT §3.1 宣称的「commander 用 root 代调 milestone_set_result（caller=root===audit_session_id=root，L3061 优先 L3091 放行）」是合规用法，但引擎无法区分"合法 root 代调"与"worker 冒 root 代调"——两者走完全相同的代码路径，差别仅在调用方自觉。

**威胁模型映射**: SECURITY §2.1「自审自过」（528b0925 worker 拿 404c724f session_id 调 audit_gate 的 V4-V9 时代攻击，在 CLI 路径下完全复现，V10 加固无效）。

**修复建议**: 同 F1。额外: resolveAuditorIndep 的 root-as-auditor 分支应额外校验 caller（要求 caller===auditorSessionId），把 caller 透传进 resolveAuditorIndep，而非只在 cmdAuditGate 外层校验。

---

### F4 🟡 audit_log 内容伪造 + "只看最新一条"让历史 red 可被静默清洗

**位置**: `tree-engine.cjs` L3639-3651（red 阈值只扫最新条目）+ L3783-3796（audit_append 不校验内容）

**问题**: 
1. cmdAuditAppend 只校验 schema（字段存在 + 数值一致 + severity 枚举 + auditor 非自身 + auditor.role!=='worker'），**不校验 findings 内容是否真实**。L3783-3796 注释自述「轻量校验（存在 + 非自审），跳过 V10-auditor-active ... audit_append 是"审计证据落盘"，不要求 auditor 自身已完成审计工作」——这是承认 audit_log 是 auditor 自填的叙述，引擎不背书。
2. cmdAuditGate 的 red 阈值（L3639-3651）只看 `leaf.audit_log[leaf.audit_log.length - 1]`（最新一条）。L3635-3637 注释「v0.23 修复死锁... 只看 leaf.audit_log 最后一个 entry（最新复审结果）。auditor 复审追加新 entry（无 red）= resolve 旧 red」——这本是为解 false-positive，但副作用是: **恶意 auditor 先写一条含 red 的真实 audit_log（骗取可信度），再追加一条全 green 的假 audit_log，旧 red 即被静默清零**，audit_gate 顺利 pass。

**证据**: tree-engine.cjs L3639-3651 原文 + L3783-3796 注释。SECURITY §4.1/§4.2 明确「引擎只对走 mcp__tree__* 接口的调用生效... W-AUDIT-* 规则只能事后检测」。

**攻击场景**: 合谋 auditor（或 CLI 路径自任 auditor）给 leaf 写 audit_log: round1={results:[{item:X,severity:red}]} 看似严谨；再 append round2={results:[{item:X,severity:green,pass:true}]} 无实质修复。引擎 L3640 取 round2 无 red → audit_gate pass。真实防线只剩 commander §4 Step4 抽查——但抽查是流程约束，非引擎强制。

**后果**: audit_log 的"严重问题已解决"信号可被 append-only 特性 + "只看最新"逻辑联合清洗。

**威胁模型映射**: SECURITY §2.1「字段篡改（字段存在但内容伪造）」。

**修复建议**: red 阈值应保留历史 red 的 finding_id 追踪（参考 review_round 的 red_findings_resolved 机制 L2611-2657），要求"覆盖旧 red 的新条目"必须显式声明旧 finding_id 的 fix_method + fix_evidence，而非简单 append 新全 green 条目即清零。

---

### F5 🟡 review_round 内容伪造（引擎自认"仅防格式不防内容"）

**位置**: `tree-engine.cjs` L1508-1509 / L4852-4853（引擎自述）/ L1599-1707（schema 校验）

**问题**: 引擎在 help 文本与代码注释中**反复明言** review_round 结构校验不防内容伪造:
- L1508-1509: 「诚实标注: events 是 worker 可写的, review_round 结构校验【仅防格式伪造】(空/缺/结构错/自审), 【不防内容伪造】(worker 可自写格式合法的 review_round 蒙混, 如全 green 废话)」
- L4852-4853: 「review_round 结构校验**仅防格式伪造**... **不防内容伪造**——worker 可自写一份格式合法的 review_round（全 green 废话）蒙混 done 门禁」
- L1543（subagent_spawn 同级别声明）

schema 校验（L1599-1707）确实严密: perspective 必填、reviewer_kind=subagent 必须 reviewer_ref 溯源到本 leaf 的 subagent_spawn 事件（L1650-1654）、evidence≥10 字符、red_count 与实际 red 数一致。但这些都能被 worker 自填: worker 先 append 5 条 subagent_spawn event（sub:leaf:1..5），再 append 1 条 review_round 含 5 个 reviewer（每个 reviewer_kind=subagent + reviewer_ref 匹配 + findings 全 green + red_count=0）→ 完全合规，done 门禁放行。

**证据**: 见上原文引用。预算护栏 L320 `max_subagent_spawn_per_leaf: 15` 足够容纳 5 reviewer×3 轮。

**攻击场景**: worker 不调任何真实 SubAgent，纯靠 append subagent_spawn + review_round 事件即可过 done 门禁的 isReviewRequired 校验（L1873-1895）。macp2/3 教训（brief 提示「fork 初始 messages 自述不可信」）的根因正是 events 可自写。

**后果**: done 门禁的"多 SubAgent G1-G5 收敛"要求在内容层失效，真实防线完全压在事后 audit_gate（但 audit_gate 见 F3/F4 同样可绕）。

**威胁模型映射**: SECURITY §2.1「伪完成 / 字段篡改」。

**修复建议**: 内容伪造在纯引擎层确实难防（SECURITY §4.3 列为长期路线）。短期: 在 audit_gate 的 resolveAuditorIndep 通过后，对 worker 的 review_round 做"reviewer session 真实活跃度"二次校验（reviewer_ref 溯源的 subagent_spawn 是否有对应 SDK 返回痕迹），或引入 commander §4 Step4 抽查的引擎层强制（随机抽 N% review_round 要求 auditor 复核）。

---

### F6 🟡 session_liveness 无后台回收（真实 session 失效后 leaf 僵尸化）

**位置**: `tree-engine.cjs` L272-298（checkSessionAlive bypass 语义）+ L3085-3090

**问题**: 
1. CLI 路径下 verifier 未注入（L1996 `assertMcpEntrySessionId` 仅在 MCP 注入 verifier 时真实校验，否则 L295-298 退化为"严格格式 + 拒占位前缀"，**不查 session 是否真实存活**）。任意合法 v4 UUID（即便是已失效 session）都通过。
2. 即使 MCP 路径首次注册时校验了 session 存活，引擎**无后台/定时 reaper**重新校验已注册 leaf 的 session 存活性。真实 session 因余额耗尽/超时/进程退出失效后，对应 leaf 仍 status=active，其 session_id 仍可被借身份（resolveAuditorIndep 只查树内 leaf 状态，不查 Proma 平台 session 是否还活着）。

**证据**: tree-engine.cjs L289-298 bypass 分支注释「bypass(no-verifier=CLI / verifier-error=best-effort) → 退化为严格格式，拒占位前缀」。SECURITY §2.3「v626-A-worker audit_gate=pass by auditor 1cec707d（v626-B-worker, role=worker）」就是僵尸 session 被借身份的实战案例。

**攻击场景**: 某 commander session 因额度耗尽失效（但 leaf 仍 active + audit_gate=pass）。恶意 worker 用该失效 session_id 当 auditor 调 audit_gate（CLI 路径不查存活）→ 引擎只查 leaf 状态合格即放行。僵尸 session 成为长期可复用的越权身份。

**后果**: liveness 校验是"一次性注册时"而非"持续"，失效 session 形成僵尸身份池。

**威胁模型映射**: SECURITY §2.3「worker 当 auditor / 僵尸 auditor」。

**修复建议**: 引擎增加 tree_validate 时的 session reaper 规则（定期或 validate 时调 verifier 复查所有 active leaf 的 session），失效即标 archived；CLI 路径强制要求注入 verifier 或显式 `--no-verifier-acknowledge` flag。

---

### F7 🟡 audit_gate pass 不可撤销 + CLI 可反复翻 fail→pass

**位置**: `tree-engine.cjs` L3540-3541（verdict 枚举）+ L3654-3658（直接覆写）

**问题**: cmdAuditGate 接受 verdict ∈ {required, pass, pass_with_minor, fail, skip}（L3540），L3654 `leaf.audit_gate = { verdict, auditor_session_id, ts }` 直接覆写，**无 immutability 保护**。一次 pass 之后，没有任何机制阻止同一/另一 caller 再次调 audit_gate 把 verdict 改回 pass（即便中间有合法 auditor 设了 fail）。结合 F3（CLI 路径 caller 不可信），恶意方可"反复重试直到 pass"。

**证据**: tree-engine.cjs L3654-3658 + L3574 `from = leaf.audit_gate || {...}`（只读旧值用于 result 汇报，不做状态机约束）。无任何"pass 后锁定"或"fail 不可逆"逻辑。

**攻击场景**: 合法 auditor 给 leaf 设 verdict=fail（发现问题）。恶意方走 CLI 路径直接 `audit gate <tree> <leaf> --verdict pass --audit-session-id <any_done_session>` → 覆写为 pass。引擎不记"曾被 fail"的历史（audit_gate 字段只存当前值，事件层 audit_gate 变更也不强制留痕）。

**后果**: 审计结论无最终性，pass 失去权威。

**威胁模型映射**: SECURITY §2.1「字段篡改」+ §4.2。

**修复建议**: 引入 audit_gate 状态机（fail→pass 需新 auditor 且 audit_log 新增无 red 条目；pass 后 24h 内不可被非 root 覆写）；每次 audit_gate 变更强制 append 一条 audit_gate_change event 留痕。

---

### F8 🟡 drift 留痕对成功 CLI 调用非强制（silent 绕过）

**位置**: `tree-engine.cjs` L5669-5699

**问题**: run() 的 auto-drift 逻辑只在 **catch 分支**（错误返回路径）且错误码 ∈ RECOVERABLE_ERROR_CODES 时触发（L5674 `if (ids.tree_id && RECOVERABLE_ERROR_CODES.has(code))`）。成功的 CLI 越权调用（如 F1/F3 的 audit_gate pass）走 try 分支 L5658-5662，**只 append call-log（caller_session_id=null），不 append drift**。FINAL-REPORT / ROOT-PROXY-HANDOFF 宣称"macp11 留 drift 痕"是 macp11 root 自觉声明，不是引擎强制。

**证据**: tree-engine.cjs L5669 注释「试错未被体系捕获。这里在错误返回路径自动补记」——明确只在错误路径。L5692-5694 drift append 在 catch 内。ROOT-PROXY-HANDOFF L14「drift declare 留痕均已落盘」是 root 手动调 drift append，非引擎自动。

**攻击场景**: 恶意 worker 走 CLI 成功伪造 audit_gate pass（F3），引擎返回 ok:true + call-log 记 caller_session_id=null。worker 不主动调 drift append → 该次越权零 drift 痕。事后审计若不专门扫 call-log 的 null caller，完全不可见。

**后果**: "CLI 兜底会留 drift 痕"是错觉，成功越权可静默。

**威胁模型映射**: SECURITY §2.3 Layer 4（事后检测依赖留痕，留痕可被绕过即检测失效）。

**修复建议**: run() 在 callerSessionId=null 且命令为身份敏感写操作时，**成功路径也强制 auto-drift**（severity=low, kind=observability），把"CLI null-caller 写操作"作为可观测信号固化下来。

---

## 四、该维度对 FINAL-REPORT 真实完成度的结论

- **该维度涉及的宣称真实达成**: 4/7（MCP 路径的 V10 加固确实坚固——G1/G2/G3/G4 实证有效；audit_log schema severity 强制 §3.3 属实）
- **发现的过度宣称**:
  1. **§3.6「CLI 兼容通道兜底」严重误判**: 把 P0 后门当兜底资产。文中"省略 callerSessionId 跳过 V10 caller 校验（引擎降级非 V10 路径）"是对安全的直白妥协，但被包装为"兜底"。**实际效果: 任何有 Bash 的 leaf 都能绕过全部 V10 caller-binding**。
  2. **7/7 第 6 项「综合实战验证」含「CLI 兜底（macp11）」**: 把启用后门当作完成标志，该项应判部分达成（实战跑通≠安全闭环）。
  3. **Roadmap §5「CLI 兼容通道标准化（caller 缺省降级文档化）」**: 提议把后门永久合法化，方向错误。
  4. **SECURITY §3.4「V10 八大加固 164 测试全过」**: 测试集（dbc-spec/audit-attacks/v10-cleanroom）全部走 MCP 或 require()+run() 不传 caller，**没有一个测试覆盖"恶意 leaf 走 CLI 越权"场景**——这是测试矩阵的系统性盲区。
- **发现的遗漏**:
  1. 引擎代码注释（L1508-1509 / L4852-4853）自认 review_round/audit_log"仅防格式不防内容伪造"，但 SECURITY §3.4 / FINAL-REPORT 未在风险章节显式列出该已知缺口对 C1 的影响。
  2. auto_upgrade 的 C5 defense-in-depth 自毁（F2）是 SECURIITY §3.5 C5 修复的 regression，SECURITY 未捕获。
  3. session_liveness 无后台回收（F6）在 SECURITY §4 已知限制中未列出。

---

## 五、Roadmap 贡献

- **P0（阻断级）**:
  - **CLI null-mode 身份敏感写操作默认拒绝**: 改 `run()` / CLI shim，callerSessionId 缺省时拒绝 audit_gate / milestone_set_result / leaf_set_status / leaf_set_session / event_append(done) / audit_append / leaf_add（F1）。**这是阻断 F1/F2/F3 的根因修复，单点修复闭环 3 个 RED**。
  - **auto_upgrade callerIsRootSelf 收紧**: 删 `!callerSessionId ||` 子句（F2）。
  - **撤回 FINAL-REPORT §5「CLI 兼容通道标准化」提议**，改为"CLI 路径仅允许只读命令"。

- **P1（高优）**:
  - audit_log red 阈值引入 finding_id 追踪，防"append 新全 green 条目静默清洗旧 red"（F4）。
  - run() 成功路径对 null-caller 身份敏感写操作强制 auto-drift（F8）。
  - audit_gate 状态机 + 变更 event 留痕（F7）。
  - 测试矩阵新增"恶意 leaf CLI 越权"红队套件（补 §7.1 盲区）。

- **P2（中优）**:
  - session_liveness 后台 reaper（F6）。
  - review_round reviewer 真实活跃度二次校验（F5，部分依赖平台 subagent_trace_id，对齐 SECURITY §4.3 长期路线）。

---

## 六、审计独立性声明

本报告仅基于以下源头文档: SECURITY.md / BUG-REGISTRY.md / tree-engine.cjs（关键函数精读）/ proma-dev-patches.cjs（MCP 注入路径）/ FINAL-REPORT.md / ROOT-PROXY-HANDOFF.md。**未读取** `D:/Codes/tree-harness/audit-20260728/` 根目录下任何并行审计会话产物（D1/D3/D5 等 .md），独立性保持。
