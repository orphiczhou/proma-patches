# D4 实战验证可信度对抗核验 — Tree Harness FINAL-REPORT 对抗核验

> 审计员: audit2-D4-worker (DeepSeek-v4-pro)
> 审计对象: FINAL-REPORT.md 自评 7/7 + C1=86
> 审计日期: 2026-07-28
> 审计方法: 独立源头文档核验（不读并行审计产物）

## 一、执行摘要

- 总体判定: **FINAL-REPORT §二 C1 演进轨迹存在 2 处红线过度宣称 + 3 处黄线模糊/gap；异厂商签字链表层有效但基线不可验证、macp6 观察员评语被包装为 C1 推断夸大 4-7 分**
- confidence: **high**（所有 finding 均有归档文件原文引用 + session ID 交叉比对）
- 一句话核心结论: macp10/11 的 MiniMax 异厂商签字真实独立（GREEN），但 macp3 基线不可验证 + macp6 "观察员 80-83"实为 GLM 自评包装（RED），CLI 兼容通道虽诚实兜底但暴露平台 P0 绕过口未修（YELLOW），整体 C1=86 可信度因基线断链和 macp6 过度宣称而需下调置信区间。

---

## 二、Findings 表

| # | Severity | 问题摘要 | 证据(file:line/原文/归档) | 对 7/7 或 C1=86 的影响 |
|---|----------|---------|-------------------------|----------------------|
| F1 | 🔴 RED | macp3 C1=68 "MiniMax 签字" 基线不可验证 — 归档缺失 | `pr/` 目录无 macp3 子目录；macp10 X-c1-revote.md L95-97 引为"权威基线"但无独立可查 auditor session | 整条 C1 链基线悬空，68→79→86 全链可信度打折 |
| F2 | 🔴 RED | macp6 results.md 将观察员非正式评语包装为"C1 推断 80-83（观察员异厂商推断）"，正式复评仅 76 | macp6 results.md L14 "C1 推断…80-83/100（观察员异厂商推断）" vs macp6 results.md L82 "v2 自评诚实（标注 C1 增量估算非异厂商签字）" 自相矛盾；macp10 X-c1-revote.md L27 定 macp6=76 | 过度宣称 4-7 分；FINAL-REPORT §二用 76 纠正但未披露原始夸大 |
| F3 | 🟡 YELLOW | CLI 兼容通道省略 callerSessionId 绕过 V10 校验 — memory 标记为 P0 绕过口 | ROOT-PROXY-HANDOFF.md L6 "省略 callerSessionId 跳过 V10 caller 校验"；memory `tree-engine-cli-recovery` 标记"任意 session 可伪造 done 零 auditor 介入" | 诚实兜底但暴露平台安全 gap 未修；FINAL-REPORT §3.6 未提此为 P0 绕过口 |
| F4 | 🟡 YELLOW | macp11 root idle 第三起复发 — 平台修复未落地 | macp11 results.md L49-65 "root idle 复发"；ROOT-PROXY-HANDOFF 全程记录 CLI 应急人工介入；FINAL-REPORT §五仅列"root idle 平台修复"为后续 roadmap 非已完成 | 表明 §3.2 idle 多维核验只管检测不管根因；7/7 完成标准过度乐观 |
| F5 | 🟡 YELLOW | macp11 auditor 启动依赖父会话人工补发 brief — 树引擎未自动激活 | ROOT-PROXY-HANDOFF.md L17 "release 父会话直接 remote_send_message 补发 brief 解锁异厂商 C1 复评"；macp11 results.md L63-64 记载 auditor "0 events" | §3.4 "auditor ≥2 events" 宣称的自动化程度被实战打破 |
| F6 | 🟢 GREEN | macp10/11 异厂商独立性确认真实 — auditor 独立于全 GLM 链 | macp10 X-auditor session=cb05aadd (MiniMax-M3) ≠ worker R1/E1 (GLM-5.2)；macp11 X-auditor session=22b8407c (MiniMax-M3) ≠ worker J1/S1 (GLM-5.2)；均独立写探针+独立跑命令 | 异厂商签字机制有效，破 macp2 GLM 同质化教训 |
| F7 | 🟢 GREEN | macp11 E2E +4 保守计分诚实 — 明确区分 IPC 路由层 vs 进程级 | macp11 X-c1-revote.md L20 "保守只回收 +4（不是 +6）"；X-audit-S1.md L33 "它是 IPC 注册/路由层跨层 E2E，不是 renderer→真实 Electron 主进程的进程级 E2E" | 诚实标注 mock 边界，未夸大 |
| F8 | 🟢 GREEN | 三 yellow 清理证据链完整可追溯 | macp11 X-audit-J1.md §2 逐条复核 F-R1-Y1/F-R1-Y2/F-E1-Y1 源码落点与报告一致；独立 probe 17/17 PASS | F-R1-Y1 防御编程 + F-R1-Y2 appliedFiles 透传 + F-E1-Y1 时序证明成立 |

---

## 三、详细分析（每条 RED/YELLOW 必须展开）

### F1 🔴 macp3 C1=68 "MiniMax 签字" 基线不可验证

**位置**: FINAL-REPORT.md §二 L29 "macp3 (MiniMax 签字) 68 ← 基线，权威"

**问题**: macp3 实战归档 **不存在于** `D:/Codes/tree-harness/pr/` 目录下。可查归档最早为 macp6（`pr/20260727-macp6/`），macp7/9/10/11 齐全但 macp3 缺失。C1 演进链的"权威基线"完全依赖 macp10 X-c1-revote.md §4.3 中的一句话背书：

> macp10 X-c1-revote.md L95: `macp3 终评 | MiniMax-M3 | 异厂商 | ✅ | 68 | 低（基线，权威）`

此声称来自 macp10 MiniMax auditor（cb05aadd），该 auditor 本身是可信的 — 但它只能证明"我被告知 macp3=68"，不能证明 macp3 的真实 auditor session 归属。

**证据**:
- `ls D:/Codes/tree-harness/pr/` → macp6, macp7, macp9, macp10, macp11（无 macp3）
- FINAL-REPORT.md §六 归档清单仅列 macp6/7/9/10/11，不含 macp3
- macp3 auditor session ID / 报告 / 探针 / 签字文件 **全部不可查**
- macp2 教训（GLM 自评 70→MiniMax 下调 47）恰恰说明必须独立验证基线

**后果**: C1 演进链 68→79→86 的"68"节点悬空。若 macp3 实际为 GLM 自评（类似 macp2），则整条链的绝对分数需下调 ~20 分（参考 macp2 70→47 偏差）。即便 macp3 确实为 MiniMax 签字，无归档也使第三方复现不可能。

**修复建议**: 补归档 macp3 全部交付物（auditor session ID + 报告 + 探针 + 签字），或标注 C1 链基线为"未验证"而非"权威"。

---

### F2 🔴 macp6 "观察员 C1 推断 80-83" 实为过度宣称

**位置**: macp6 results.md L14 + L62-64

**问题**: macp6 results.md 在多处将 macp6 MiniMax 观察员（a67044a9）的**非正式评语**包装为"C1 推断 80-83/100（观察员异厂商推断）"，但：

1. **文档内部自相矛盾**:
   - macp6 results.md L14 (§0 TL;DR): "C1 推断：macp3 68 → **80-83/100（观察员异厂商推断**，保守 80 中位 83，权威待 macp7）"
   - macp6 results.md L82 (§8 自审): "v2 自评诚实（**标注 C1 增量估算非异厂商签字**，权威待 macp7）"
   - 同一文档既说是"观察员异厂商推断"又说是"非异厂商签字"

2. **被后续正式复评否定**:
   - macp10 X-c1-revote.md L27: macp6=**76**/100（MiniMax-M3 正式复评）
   - FINAL-REPORT.md §二 L31: "macp6 (GLM 估算) **76** ← 自评，待复核"
   - macp10 正式 MiniMax C1 复评比 macp6 宣称的"观察员推断 80-83"**低 4-7 分**

3. **夸大机制还原**: macp6 MiniMax 观察员 a67044a9 的职责是"异厂商双审 C+J2 修复质量"（G1-G5 审计），**不是**做 C1 综合评分。macp6 results.md 将观察员的非正式评语（"迄今最成功"）转换为量化 C1 分数 80-83，属于**过度推导**。

**证据**:
- macp6 results.md L14: "C1 推断：macp3 68 → **80-83/100（观察员异厂商推断**，保守 80 中位 83，权威待 macp7）"
- macp6 results.md L82: "v2 自评诚实（**标注 C1 增量估算非异厂商签字**，权威待 macp7）"
- macp10 X-c1-revote.md L27: 总表 macp6=76
- FINAL-REPORT.md §二 L31: "macp6 (GLM 估算) 76"
- macp10 X-c1-revote.md L37: "macp6 估的 76 假设'缺陷3+4 修复可回收 +4'…但 macp6 估的 +8 自身有水分"

**后果**: FINAL-REPORT §二虽然最终用了 76（纠正后），但未披露 macp6 原始宣称 80-83 是过度宣称。这对审计透明度是损害——如果不读 macp6 results.md 原文，无法发现这次夸大。

**修复建议**: FINAL-REPORT §二加脚注说明 macp6 原始 results.md 曾宣称 80-83（过度），经 macp10 正式复评纠正为 76。

---

### F3 🟡 CLI 兼容通道省略 callerSessionId 绕过 V10 校验

**位置**: ROOT-PROXY-HANDOFF.md L6; macp11 results.md L57-62

**问题**: macp11 root idle 后使用 CLI 应急通道（`tree-engine.cjs` + `setTreesRoot` + `run`），**省略 callerSessionId** 参数以跳过 V10 caller 校验。虽然本次使用诚实（drift 留痕 + audit_session_id 真实署名），但 memory `tree-engine-cli-recovery` 明确标记此通道为：

> "同一通道在对抗模型下是**P0 绕过口**（任意 session 可 require 引擎自伪造 done 零 auditor 介入）+ tree-state.json 零完整性校验（直接编辑后 validate=0 issues）"

**证据**:
- ROOT-PROXY-HANDOFF.md L6: "省略 callerSessionId 跳过 V10 caller 校验，audit_session_id 诚实署名=root"
- ROOT-PROXY-HANDOFF.md L14: "`validate macp11` = 0 issues。alignment 回填（asid=root）+ drift declare 留痕均已落盘"
- S-commander-summary.md L39-40: "CLI 应急绕过 caller 校验已 drift_append（severity=high, action=declare, ts=22:57:03），审计链可追溯"
- memory `tree-engine-cli-recovery.md` D6 安全视角修订: "同一通道在对抗模型下是 P0 绕过口"
- FINAL-REPORT.md §3.6: 将此描述为"CLI 兼容通道兜底"但未提 P0 安全含义

**后果**: FINAL-REPORT §3.6 将 CLI 通道描述为积极的"兜底"方案，但回避了其作为 P0 安全绕过口的对抗含义。在对抗审计视角下，一个允许任意 session 绕过 auditor 的通道不应被列为"完成标准达成"的正面证据。

**修复建议**: 
1. FINAL-REPORT §3.6 加安全警告（CLI 通道是 P0 绕过口，仅应急用）
2. 引擎层加 CLI 调用签名（最小：要求 `--caller-session-id` 并写入 audit_log）
3. tree-state.json 加 HMAC 或至少 checksum 防裸编辑

---

### F4 🟡 macp11 root idle 第三起复发 — 平台修复未落地

**位置**: macp11 results.md L49-65; ROOT-PROXY-HANDOFF.md 全文

**问题**: macp11 的 root idle 是继 macp4（A 节 root idle gap）和 macp6（idle 误判 prune J）后的**第三起** root 不可用事件。macp7 的 §13.6 idle 多维核验只解决了"检测"问题（不误判 prune），但**没有解决根因**（模型切换丢 MCP 工具 + SDK 队列锁死）。

FINAL-REPORT §五将"root idle 平台修复"列为**后续 roadmap**（非已完成）：
> FINAL-REPORT.md L103: "root idle 平台修复：tree_init 后强制启动 root agent 处理后续队列；模型切换不应丢失已注入 MCP 工具集"

这意味着 7/7 完成标准中的 #1（"P0 接力协议补章 + idle 多维核验"）实际只完成了"检测"那半，根因修复仍在 roadmap。

**证据**:
- macp11 results.md L51-55: 完整触发链（越级上报 → error_during_execution → 模型切换丢工具）
- ROOT-PROXY-HANDOFF.md L4-6: root 当前会话丢失 mcp__tree__* / mcp__session__* 工具
- FINAL-REPORT.md L103: "root idle 平台修复" 列在 §五"超出本轮 harness scope"
- macp6 results.md L55: "隔夜 12h 父会话误判'context 溢出'" — 第一起
- macp4 引用（macp11 results.md L50）: "macp4 A 节 root idle gap"

**后果**: 7/7 完成标准宣称"idle 多维核验 ✅"是片面真相——检测能力有了，但 idle 根因未修，实战中仍需 CLI 应急人工介入。这应从"已完成"降级为"部分完成（检测维 ✅ / 根因修复 ❌）"。

**修复建议**: FINAL-REPORT §一 #1 标注"部分完成：多维核验 ✅ / 根因修复 → roadmap"。

---

### F5 🟡 macp11 auditor 启动依赖父会话人工补发 brief

**位置**: ROOT-PROXY-HANDOFF.md L17; macp11 results.md L63-64

**问题**: macp11 root idle 导致 leaf_add X-auditor 成功但 brief 未发出（error 中断），auditor 处于 0 events 状态。最终由 **release 父会话直接 `remote_send_message` 补发 brief** 才解锁异厂商 C1 复评。

这与 FINAL-REPORT §3.4 "auditor ≥2 events" 宣称的树引擎自动化程度不符——auditor 的激活在实战中依赖了：
1. 父会话检测到 root idle
2. 父会话人工判断需要补发 brief
3. 父会话通过 `remote_send_message` 跨实例注入 brief

这三步都是**平台外人工介入**，不是树引擎自动完成的。

**证据**:
- macp11 results.md L63-64: "release 父会话直接 `remote_send_message` 补发 brief 解锁异厂商 C1 复评"
- ROOT-PROXY-HANDOFF.md L17: "macp11-X-auditor (22b8407c, MiniMax-M3)：gate=required 待办，需完成 G1-G5 异厂商独立审查"
- macp11 results.md L22 (树结构): "macp11-X-auditor (MiniMax-M3) ← done 00:00:19（异厂商独立签字）" — auditor 最终完成但启动依赖人工

**后果**: auditor 激活路径的鲁棒性不足。如果父会话没有检测到或没有介入，macp11 的 C1=86 异厂商签字就不会发生。这不是可复现的自动化流程。

**修复建议**: 树引擎加 leaf_add 后的 brief 自动投递（不依赖 root 转发），或至少 engine 层在 leaf status=active 且 events=[] 超时后自动告警。

---

### F6 🟢 macp10/11 异厂商独立性确认真实

**位置**: macp10 X-c1-revote.md L3; macp11 X-c1-revote.md L3

**问题**: 验证 auditor 是否真为异厂商（MiniMax-M3）而非 GLM-5.2 同模型自审。

**核验结果**: ✅ **确认真实独立**

**macp10**:
- Auditor: cb05aadd-5714-4b62-aebe-02e4a1cf9790 (MiniMax-M3)
- 被审对象: R1-worker (GLM-5.2, 7ea6012d) + E1-worker (GLM-5.2, a86dde96)
- Commander: GLM-5.2 × 2; Root: GLM-5.2
- 独立验证动作: 独立写探针 probe-x-macp10-e1.cjs (5/5 PASS) + 独立 typecheck/build + git stash 对比
- 发现 worker 自审盲区: F-R1-Y1 (CONTENT 首换行剥除边缘) + F-R1-Y2 (appliedFiles 信息丢失) + F-E1-Y1 (探针未落盘)

**macp11**:
- Auditor: 22b8407c-6d62-439b-afcd-13656c4b45d6 (MiniMax-M3)
- 被审对象: J1-worker (GLM-5.2, 0bb09366) + S1-worker (GLM-5.2)
- Commander: GLM-5.2 × 2; Root: GLM-5.2
- 独立验证动作: 独立跑 probe-macp11-j1.cjs (3 场景 17/17 PASS) + 独立 vitest e2e-ipc-cross-layer (3/3 PASS) + 独立 typecheck/build
- 发现既有边界: J1 IO 错误语义边界 (非 ENOENT→featuresTotal=0→pass) + S1 Electron mock 边界

**证据**:
- macp10 X-audit-R1.md L3-4: "审计员: macp10-X-auditor (MiniMax-M3, 异厂商独立) / 审计对象: macp10-R1-worker (GLM-5.2)"
- macp10 X-audit-E1.md L3-4: 同上结构
- macp11 X-audit-J1.md L3-6: "审计员：macp11-X-auditor，MiniMax-M3，session 22b8407c / 被审：macp11-J1-worker，GLM-5.2 / 独立性：审计员与 worker/commander/root 模型及 session 均不同"
- macp11 X-audit-S1.md L3-6: 同上结构
- macp10 X-c1-revote.md §4.2: 独立性声明完整

**后果**: 异厂商签字机制在 macp10/11 中有效运作，破了 macp2 "全 GLM 同质化自评 70→异厂商复评 47" 的教训。FINAL-REPORT 对此的宣称可信。

---

### F7 🟢 macp11 E2E +4 保守计分诚实

**位置**: macp11 X-c1-revote.md L20; X-audit-S1.md L33

**问题**: 验证 macp11 端到端 +4（非 +6）是否诚实保守而非掩盖不足。

**核验结果**: ✅ **确认诚实保守**

**证据**:
- macp11 X-c1-revote.md L20: "因 Electron/renderer 为 mock，保守只回收 +4（不是 +6）"
- X-audit-S1.md L33 (yellow finding): "Electron 本体与 renderer 进程没有启动；`electron` 模块、`ipcMain` 和 `app.whenReady` 均为 Vitest mock…它是'IPC 注册/路由层跨层 E2E'，不是 renderer→真实 Electron 主进程的进程级 E2E"
- X-audit-S1.md §2 跨层真实性复核: 详细列出 6 项验证（handler 注册 spy + 真实引擎实例 + mock LLM 被调 + 文件副作用 + ApiResponse 信封 + fetch 未联网）
- macp11 X-c1-revote.md §3 诚实保留拖分项 #4: "端到端 8/10 而非 10/10：测试 mock 了 Electron 与 app lifecycle"

auditor 在报告中明确标注了 mock 边界，拒绝将 IPC handler 跨层测试夸大为完整系统 E2E。+4 分回收逻辑自洽：从 macp10 的 4/10（纯进程内集成）提升到 8/10（IPC handler 注册/路由层），但不到 10/10（缺真实 Electron 进程）。

**后果**: macp11 的 E2E 评分诚实可靠。FINAL-REPORT 对此的宣称可信。

---

### F8 🟢 三 yellow 清理证据链完整可追溯

**位置**: macp11 X-audit-J1.md §2; J1-fix-report.md

**问题**: 验证 macp10 遗留的三条 yellow findings 是否真在 macp11 中修复闭环。

**核验结果**: ✅ **确认闭环**

**证据**:
- **F-R1-Y1 (CONTENT 首换行剥除)**: macp11 J1-fix-report.md 记载 `coder-engine-stub.ts` 改用 `(match[2] ?? '').replace(...)` 防御编程；X-audit-J1.md L21 独立确认 "对极端 undefined 捕获值有防御"
- **F-R1-Y2 (appliedFiles 未透传)**: macp11 J1-fix-report.md 记载 `coder/types.ts L139-157` 增加可选 `appliedFiles?: string[]`；两处 `autofixLog.push` 均透传 `patchRes.appliedFiles`；X-audit-J1.md L21 独立确认
- **F-E1-Y1 (探针未落盘)**: macp11 J1-fix-report.note.md 记载探针先落盘 + mtime 证据；X-audit-J1.md L22 独立确认 "交付物与 note 均存在"

独立 probe 验证: `node probe-macp11-j1.cjs` → 3 场景 17/17 PASS (X-audit-J1.md §1 G1 行)

**后果**: 三 yellow 清理真实闭环，FINAL-REPORT 对此的宣称可信。

---

## 四、逐条核验回应（任务 6 条）

### 1. macp3 C1=68 基线: 是真 MiniMax 异厂商签字还是 GLM 自评？

**判定**: 🔴 **无法独立验证**。macp3 归档缺失于 `pr/` 目录。macp10 X-c1-revote MiniMax auditor (cb05aadd) 引为"权威基线"但此声称本身无独立可查证据。若按 macp2 先例（GLM 自评 70→MiniMax 复评 47），基线不可验证意味着整条 C1 链的绝对分数可信度打折。

### 2. macp10 C1=79 (+3): X-c1-revote.md 真异厂商独立？

**判定**: 🟢 **确认独立**。Auditor session=cb05aadd (MiniMax-M3)，独立于全 GLM-5.2 链（root + 2 commander + 2 worker）。独立写探针 probe-x-macp10-e1.cjs (5/5 PASS)，独立验证 git stash 前后 typecheck 一致性，独立发现 3 yellow（worker 自审盲区）。+3 回收核算清晰：Coder 业务 +2 (缺陷3) + 自动化测试 +1 (R1 新增 2 用例)；缺陷4 回收 +2 被 featuresMissingSteps 未修 -2 抵消。

### 3. macp11 C1=86 (+7): featuresMissingSteps + E2E + yellow 清 真应用？

**判定**: 🟢 **确认真应用**。独立验证通过：
- G1 featuresMissingSteps verdict: `judge-engine-stub.ts L364-385` 阈值分支真存在 (>50%→reject, ≤50%→soft)，独立 probe 17/17 PASS
- G2 E2E: `06_TESTS/e2e-ipc-cross-layer.test.ts` 3/3 PASS，独立 vitest 验证，auditor 诚实标注 mock 边界 (+4 非 +6)
- G3 yellow 清: 三条源码落点独立确认（见 F8）
- 保守计分诚实：E2E +4（非 +6），yellow 清不重复加分，保留 5 拖分项诚实标注

### 4. macp6 GLM 估算 76 vs macp10 复评 79: GLM 自评这次没乐观偏差？

**判定**: 🟡 **部分真但误导**。GLM 对 macp6 的正式 C1 估算是 76（macp10 复评确认），但 macp6 results.md 曾将观察员非正式评语包装为"C1 推断 80-83（观察员异厂商推断）"（见 F2）。GLM 自评 76 接近 MiniMax 复评 79（差 +3 来自 macp10 新增修复），说明这次 GLM 估算相对准确 — **但这不能掩盖 macp6 results.md 中 80-83 的过度宣称**。FINAL-REPORT §二用 76 纠正了但未披露原始夸大。

### 5. 观察员签字链: 每轮 auditor 是否真异厂商 (MiniMax) 而非 GLM 自审？

**判定**: 🟢 **macp10/11 确认异厂商**。macp10 auditor cb05aadd (MiniMax-M3) + macp11 auditor 22b8407c (MiniMax-M3)，均独立于全 GLM-5.2 链。macp6 观察员 a67044a9 也是 MiniMax-M3，但其角色是"G1-G5 质量审查"非"C1 综合评分"——macp6 results.md 将其评语夸大为 C1 分数（见 F2）。**macp3 auditor 不可验证**（见 F1）。

### 6. macp11 ROOT-PROXY-HANDOFF.md: CLI 兼容通道实战

**判定**: 🟡 **诚实兜底但暴露 P0 安全 gap**。本次使用诚实（drift 留痕 + audit_session_id 真实署名 + validate=0），但通道本身是 P0 绕过口（memory `tree-engine-cli-recovery` D6 安全修订）。root idle 复发（第三起）说明平台 gap 未修，CLI 通道从"应急"变成了"常规依赖"。FINAL-REPORT §3.6 将其列为正面"兜底"方案但未提安全含义。

---

## 五、该维度对 FINAL-REPORT 真实完成度的结论

- **该维度宣称 7/7 真实达成**: 6/7（#5 "C1 权威复评 85+ MiniMax 签字" 基本达成但基线不可验证；#1 "idle 多维核验" 只完成检测半维，根因修复仍在 roadmap）
- **该维度发现的过度宣称**:
  1. macp6 results.md C1 80-83 过度宣称（F2，-4~7 分夸大）
  2. 7/7 #1 "idle 多维核验" 实际只完成检测侧，根因修复未落地（F4）
  3. FINAL-REPORT §3.6 CLI 通道描述回避 P0 安全含义（F3）
- **该维度发现的遗漏**:
  1. macp3 基线归档缺失，C1 链首节点不可验证（F1）
  2. auditor 激活依赖父会话人工介入，非引擎自动化（F5）

---

## 六、Roadmap 贡献

- **P0（阻断级）**:
  1. 补归档 macp3 全部交付物（auditor session + 报告 + 探针），否则标注 C1 基线为"未验证"
  2. FINAL-REPORT §二加脚注披露 macp6 原始宣称 80-83 的过度宣称及 macp10 纠正过程
  3. CLI 通道加最小安全签名（`--caller-session-id` 写入 audit_log），tree-state.json 加完整性校验

- **P1（高优）**:
  1. 平台修复 root idle 根因（模型切换不丢 MCP 工具 + SDK 队列不锁死）
  2. 树引擎加 leaf_add 后 brief 自动投递（不依赖 root 转发）+ auditor 0 events 超时告警
  3. 7/7 #1 从"已完成"降级为"部分完成（检测 ✅ / 根因 → roadmap）"

- **P2（中优）**:
  1. macp6 results.md 修订 §0/§5 的 C1 推断措辞（明确标注为"非正式估算，非异厂商签字"）
  2. 建立 C1 基线归档强制检查（每轮 C1 复评必须有独立 auditor session ID + 报告 + 探针，缺一不可接受为基线）
