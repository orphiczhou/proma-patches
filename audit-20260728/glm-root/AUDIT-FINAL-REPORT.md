# AUDIT-FINAL-REPORT — Tree Harness 工程对抗性审计总报告

> **审计指挥官**: audit2-root (GLM-5.2, ZLM-CodingPlan 渠道, session=bf983cca-cd23-4406-adfb-25186c4e7c6a)
> **异厂商签字 auditor**: audit2-X-auditor (MiniMax-M3, MiniMax-CodingPlan 渠道, session=2282d381) — 详见 `auditor-signoff.md`
> **审计对象**: `D:/Codes/tree-harness/pr/20260728-harness-final/FINAL-REPORT.md` 自评 7/7 ✅ + C1=86/100
> **审计日期**: 2026-07-28
> **审计性质**: 对抗性独立审计（不盲信 FINAL-REPORT 自评，macp2 教训：GLM 自评 70 → MiniMax 复评 47）
> **树结构**: audit2 树，2-layer（root → 6 维度 audit-worker + 1 异厂商 auditor），8 leaves，国内三家顶模（GLM-5.2 / DeepSeek-v4-pro / MiniMax-M3）+ 双核心（claude 渐变 GLM / pi 渐变 DeepSeek+MiniMax）

---

## 📋 误判纠正 Addendum（2026-07-28 12:5x，优先级高于正文）

> **正文 §九/六/十 含 pre-correction "auditor partial/stall" 叙事，已被本 Addendum 取代。** 完整权威签字见 `auditor-signoff.md`（29385B / 291 行，auditor 12:49:14 完整产出）。

### A.1 auditor 实际完整完成（非 partial）

我（root）12:38 基于"文件稳定 8965B + SDK 处理中"误判 auditor 撞 token-limit stall，走了 archive clean closeout。**这是误判** — auditor MiniMax-M3 是慢 turn（读 ~200KB 源文档+6 报告+写综合签字单 turn 耗 ~57min），12:31 看到的 8965B+placeholder 是**partial flush 非 final**，18min 后（12:49:14）产出完整签字 29385B/291 行 + done event（6 项 self_check 全 pass）。**这是 macp6 false-idle 错误的重复**（已 drift_append severity=high 留痕）。

**纠正后 auditor 实际交付**（全部到位，非 partial）：
- **C1 = 82/100**（vs FINAL-REPORT 86，-4 不达 85+）— 九维独立打分，核心 challenge 端到端 8→6
- **7/7 = PASS 2 / PARTIAL 4 / FAIL 2（~3.5/7）**
- **uphold 22 条** worker findings（D1-F1/F2/F3/F5/F6 + D2-F1/F2 + D3-F1/F2/F3/F7 + D5-F1~F4 + D6-F1/F2/F3/F8 + D4-F3~F8）
- **challenge down 6 条**（D4-F1 证伪 / D1-F4 降 YELLOW / D5-F6 / D3-F8 / D6-F4 / D6-F5）
- **challenge up 6 条**（A-1 git 未提交 / A-2 仓指混 / A-3 CLAUDE.md md5 矛盾 / A-4 过时注释误算 / A-5 cmdEventAppend null 放行 / A-6 macp6 措辞）
- **过度宣称 4 项** + **Roadmap P0×7**（含 1 条反向：撤回 CLI 标准化，应 CLI 下线）

树状态纠正：archive 保持（terminal 无法转 done，E_STATUS_TRANSITION_INVALID），但 audit_gate pass 已配（macp3-C 先例：archived leaf 可配 gate）+ milestone pass + done event 齐全，**实质交付完整**。

### A.2 D4-F1 证伪（macp3 归档实际存在）

D4-F1 RED 称"macp3 C1=68 基线不可验证 — 归档缺失"。**auditor 异厂商独立证伪**：macp3 归档实际在 `D:/Codes/multi-agent-collab-platform/06_TESTS/macp3-tree-evaluation-final-2026-07-25.md`（34299B，含 MiniMax-M3 auditor 评估 + 九维表 + tree_id=macp3 全树审计）。D4 只 grep `pr/` 目录就断言"无归档"是**搜索范围错**（D4 的源头文档白名单限定了 pr/，但 macp3 归档在测试底座的 06_TESTS/）。

**纠正影响**：
- D4-F1 从 RED 降级为 **证伪（worker scope-limited oversight，非 fabrication）**
- §六.2 "C1=86 三个虚高点"中的 **#1 macp3 基线悬空 → 撤回**（基线可验证）
- C1 链 68→79→86 的"68"节点不再悬空
- **C1=82 verdict 不变**（driven by CLI 后门 + 端到端通胀 + Judge 缺陷 + 自动化覆盖 + git 未提交，非基线悬空）

### A.3 §六.2 / §十.3 纠正

**§六.2 C1=86 虚高点（原 3 个 → 纠正后 2 个）**：
1. ~~macp3 基线悬空~~ → **撤回**（archive 存在）
2. **CLI 后门 P0 未扣分** — 保留（D2+D6 RED，auditor uphold + 列最严重 P0）
3. **macp6 过度宣称 80-83 历史** — 保留（D4-F2，auditor A-6 措辞调整但事实成立）

新增虚高点（auditor A-1）：**C1 打分对象代码未进 git**（HEAD=macp3 188bb82，16 条 dirty/untracked 含全部 macp6-11 改动），第三方不可复现，`git stash` 即蒸发。

**§十.3 三个 P0 诚信问题（原 → 纠正后）**：
1. **CLI 兼容通道是后门非兜底** — 保留（D2+D6 收敛，auditor uphold 最严重 P0）
2. ~~C1 链基线不可验证~~ → **替换为：C1 证据基底未进 git**（auditor A-1，归档完整性 P0）
3. **教化方向与 v0.17.1 相悖** — 保留（D1 F3，auditor uphold）

### A.4 核心结论不变

🔴 **FINAL-REPORT 7/7 + C1=86 过度宣称**结论不变。auditor 异厂商完整签字 **C1=82 / 7/7≈3.5/7** 确认。三大支柱仍然成立：(1) CLI 后门 P0（D2+D6+D4 三方独立 + auditor uphold）(2) 7/7 全 PARTIAL/FAIL 非全 PASS（D1+D3+D4 + auditor 独立核验）(3) 教化方向悖 v0.17.1（D1 F3 + auditor uphold）。**异厂商自检机制有效** — auditor 独立证伪 D4-F1 正是本审计自纠错能力的证明。

---

## 一、执行摘要（真实完成度判定）

### 1.1 核心结论

🔴 **FINAL-REPORT 自评 7/7 + C1=86 属系统性过度宣称。** 经 7 维度独立对抗审计（6 audit-worker + 1 MiniMax 异厂商 auditor），发现 **16 条 RED + 25 条 YELLOW + 20 条 GREEN** findings。7/7 完成标准中**无一条完全 PASS**（7/7 全为 PARTIAL — 有实质工作但均欠完整），C1=86 含一处未扣分的 P0 引擎级后门 + C1 演进链基线悬空。

**真实完成度**: **5/7 PARTIAL + 2/7 PARTIAL（非树引擎交付物）**。FINAL-REPORT 把"实战未撞"等同"协议完备"、把"应急兜底"正当化为"完成标准达成"，掩盖了 SOP 文档本身的硬伤（D3 5 RED）与引擎层 P0 后门（D2+D6 独立收敛 5 RED）。

### 1.2 三大跨维度收敛（强证据，非单点偏差）

1. **🔴 CLI 兼容通道 = P0 引擎级后门**（D2 引擎语义 + D6 安全对抗 独立收敛）
   - `tree-engine.cjs:5646` `run(cmd, args, treesRoot, callerSessionId)` 第 4 参可省 → 9+ 处 `if (callerSessionId && ...)` caller 校验全短路
   - D2 F1+F2（引擎语义视角）+ D6 F1+F2+F3（安全对抗视角，3 条 P0）从不同角度独立验证同一漏洞
   - FINAL-REPORT §3.6 把它定性为"兜底"，§5 列为 roadmap"标准化"= 短期不修 → **C1=86 未对此扣分**

2. **🔴 FINAL-REPORT 7/7 过度宣称**（D1 需求覆盖 + D3 SKILL 完备 + D4 实战验证 多维度指向）
   - D1 4 RED: macp2 五铁律零覆盖 + nanju 四铁律零覆盖 + v0.17.1 方向背离 + 标准 4/5 非 harness 交付物
   - D3 5 RED: §13.7 错误码表 9/51（17.6%）+ §13.6 idle 漏 comm_log + §14.2 vs §14.6 fix 矛盾 + step7 漏码 + final_step 角色误导
   - D4 2 RED: macp3 C1=68 基线不可验证（归档缺失）+ macp6 过度宣称 80-83（观察员评语包装为异厂商推断）

3. **🔴 教化 vs 引擎硬拦方向背离**（D1 F3 + D2 F1 + D6 多处）
   - CLAUDE.md v0.17.1 教训: "GLM 教化无效，防线必须引擎硬拦"
   - FINAL-REPORT 6 项改进: **5/6 纯 SKILL 教化**，仅 1 项引擎层（v0.21 audit_log severity）
   - 方向与 v0.17.1 实战教训相悖 — 教化型约定可被 GLM 自主绕过（D6 攻击面证实）

### 1.3 C1=86 评估（root 初判，auditor 独立签字见 `auditor-signoff.md`）

| 问题 | 影响 | 来源 |
|------|------|------|
| macp3 C1=68 基线不可验证 | C1 演进链基线悬空，68→79→86 全链可信度打折 | D4 F1 |
| macp6 过度宣称 80-83 历史 | 观察员评语包装为异厂商推断，正式复评仅 76（-4~-7） | D4 F2 |
| CLI 后门 P0 未扣分 | C1=86 含未量化的 P0 引擎级后门（任意进程可假冒 root 背书 pass） | D2+D6 |
| 4 缺陷真修（GREEN） | 4 缺陷代码实证真修，但拖分项 4 YELLOW（Sandbox L1 scope 争议等） | D5 |

**root 综合初判**: C1=86 虚高。真实 C1 区间应在 auditor 独立签字后确定（预计下调），但**下调幅度 ≠ macp2 的 70→47 暴跌**（因 macp10/11 异厂商签字机制真实有效 D4 F6 GREEN + 4 缺陷真修 D5 GREEN，这两个是实质进展）。

---

## 二、审计方法与独立性

### 2.1 对抗审计立场

依据 macp2 教训（全 GLM 树自评 C1=70，MiniMax 异厂商复评 47，-23 暴跌）+ memory `tree-task-evaluation-multi-model`：评估单模型/同厂商产出必须异厂商多模型对抗。本审计：
- **6 维度 worker 双核心分配**: D1/D4/D5=DeepSeek-v4-pro（pi 渐变），D2/D3/D6=GLM-5.2（claude 渐变）
- **auditor 异厂商**: MiniMax-M3（独立于 GLM-root + DeepSeek/GLM-workers）
- **立场**: 找 red/yellow 而非确认 green；读代码/归档核验非听文档宣称

### 2.2 独立性硬规则（全程遵守）

🔴 所有 7 个审计 leaf 被明确指示**绝不读** `D:/Codes/tree-harness/audit-20260728/` 根目录的任何 .md 文件 — 因检测到**并行审计会话**（audit-root，DeepSeek-v4-pro root，tree_id=audit，早 11 分钟启动）已将 D1/D3/D5 报告落到该目录。读并行产物会污染本审计的独立性。6 worker + auditor 全部在 done event self_check 中声明"仅读源头文档白名单，未读并行审计产物"。

### 2.3 源头文档白名单（worker 只读这些）

- `pr/20260728-harness-final/FINAL-REPORT.md`（被审对象）
- `CLAUDE.md` / `ARCHITECTURE.md` / `SECURITY.md` / `API.md` / `ERROR-CODES.md` / `BUG-REGISTRY.md`
- `tree-engine.cjs`（~302KB，Grep 定位关键函数非全读）/ `proma-dev-patches.cjs` / `apply-patches.sh`
- `skills/tree-commander/SKILL.md` v2.9.7 / `skills/tree-worker/SKILL.md` / `skills/tree-auditor/SKILL.md` / `skills/tree-iterative-development/SKILL.md`
- `pr/20260727-macp{6,7,9,10,11}/`（实战归档）
- 测试底座 `D:/Codes/multi-agent-collab-platform/`（仅 D5 维度深读 src/）

### 2.4 树协议合规

- 所有 6 worker + auditor 全部走完整 V10 协议：brief_echo → alignment 回填（root 代回填 auditor_session_id=root.session_id 冷启动信任锚）→ done event（self_check）→ root 代调 milestone_set_result + audit_gate（caller=root===audit_session_id=root，L3061 闸门 2 放行，零 V10 撞击）→ worker 自调 set-status done
- **tree_validate(audit2) 零 issue**（结构一致性校验通过）
- 所有 send_message 后紧接 tree_log_communication（§6 硬要求，无漏记）

---

## 三、7 维度 Findings 汇总

| 维度 | 审计员（模型） | RED | YELLOW | GREEN | 关键发现（最重 RED） |
|------|--------------|-----|--------|-------|---------------------|
| **D1 需求覆盖** | DeepSeek-v4-pro | 4 | 2 | 3 | macp2 五铁律零覆盖（CLAUDE.md:27-35 vs FINAL-REPORT 6 项改进 0/6）；nanju 四铁律零覆盖；v0.17.1 方向背离（5/6 纯教化） |
| **D2 引擎语义** | GLM-5.2 | 2 | 3 | 3 | CLI 兼容通道=文档化引擎后门（tree-engine.cjs:5646 callerSessionId 可省→9+处 caller 校验短路）；L3061 root-as-auditor+CLI=任意进程假冒 root 背书 pass |
| **D3 SKILL 完备** | GLM-5.2 | 5 | 8 | 3 | §13.7 错误码表 9/51（17.6%）；§13.6 idle 漏 comm_log（矛盾 §6/§11#15）；§14.2 vs §14.6 fix 强制矛盾 |
| **D4 实战验证** | DeepSeek-v4-pro | 2 | 3 | 3 | macp3 C1=68 基线不可验证（归档缺失）；macp6 过度宣称 80-83（观察员评语包装为异厂商推断） |
| **D5 项目质量** | DeepSeek-v4-pro | 0 | 4 | 4 | 4 缺陷真修（GREEN，src file:line 实证）；Sandbox L1 scope 争议（~200 行 JobObject 可行未尝试） |
| **D6 安全对抗** | GLM-5.2 | 3 | 5 | 4 | CLI null-mode P0×3：系统绕过 V10 + auto_upgrade defense-in-depth 自毁 + audit_gate 自我背书 |
| **合计** | — | **16** | **25** | **20** | — |

**Severity 分布说明**: 16 RED 中，D2+D6 贡献 5 条（CLI 后门相关，跨维度收敛强证据）；D1+D3 贡献 9 条（需求/SKILL 协议层过度宣称）；D4 贡献 2 条（C1 链基线问题）。D5 是唯一 0 RED 维度（4 缺陷真修确认）。

详细分维度报告见 `D1-requirements-coverage.md` / `D2-engine-semantics.md` / `D3-skill-completeness.md` / `D4-combat-validation.md` / `D5-project-quality.md` / `D6-security-adversarial.md`。

---

## 四、跨维度收敛详析（强证据）

### 4.1 🔴 CLI 兼容通道 = P0 引擎级后门（D2 + D6 独立收敛）

**这是本轮审计最重发现**。D2（引擎语义，GLM-5.2）与 D6（安全对抗，GLM-5.2）从两个不同角度独立收敛到同一漏洞，构成强证据（非单点偏差）。

**D2 引擎语义视角**（F1 + F2 RED）:
- `tree-engine.cjs:5646` `async function run(cmd, args, treesRoot, callerSessionId)` — 第 4 参 `callerSessionId` 可省
- `:5654` `const callerSid = callerSessionId || null` — 省略即 null
- 全部 9+ 处 caller 校验均以 `callerSessionId` 真值为前置：
  - `cmdLeafSetStatus:1732` `if (callerSessionId) { ... _isOwner/_isCreator/_isRootSelf ... }`
  - `cmdMilestoneSetResult:2341` `if (audit_session_id && callerSessionId && ...)` 
  - `cmdAuditGate:3560` 同上
  - `cmdEventAppend:2769` `const callerIsRootSelf = !callerSessionId || ...` — **CLI 模式 `!undefined`=true，任意调用方触发 root auto_upgrade**
- **结果**: CLI shim (`node tree-engine.cjs <cmd>`) 或 `require()+run()` 不传 callerSessionId → callerSessionId=undefined → 9 处守卫全部静默跳过
- `SKILL.md:956-959` 白纸黑字教化"省略 callerSessionId 绕过 caller 校验"作为"应急通道"

**D6 安全对抗视角**（F1 + F2 + F3 RED，全标 P0）:
- F1: CLI null-mode 系统性绕过全部 V10 caller-binding（9+ 处 `if (callerSessionId && ...)` 短路模式）
- F2: root 信任锚 auto_upgrade 的 defense-in-depth 自毁（`:2762-2777` 注释明言"即便 caller 校验被绕过也不会触发"，代码却相反 — `callerIsRootSelf = !callerSessionId || ...` CLI 模式任意方触发 root.audit_gate skip→pass）
- F3: CLI 模式 audit_gate 自我背书（caller 校验被跳过 + resolveAuditorIndep L3061-3074 root-as-auditor 放行 → worker 可冒 root.session_id 给自己写 pass）

**攻击链端到端可复现**（D6 详述）:
1. 恶意 worker W（有 Bash/Write 工具，leaf 可读 tree-state.json）
2. W 读 `<workspace>/.context/trees/<tree>/tree-state.json` 获取 root.session_id
3. W 执行 `node tree-engine.cjs audit gate <tree> W --verdict pass --audit-session-id <root.session_id>`
4. callerSessionId=undefined → 全部校验短路 → audit_gate=pass 写入，**零 auditor 介入，零 drift 留痕**（drift 仅在错误路径触发，成功越权 silent）

**FINAL-REPORT 处理方式**:
- §3.6 把它定性为"macp11 兜底方案"（积极包装）
- §5 列为 roadmap"CLI 兼容通道标准化：caller 缺省降级文档化"（短期不修）
- **C1=86 未对此 P0 后门扣分**

**审计判定**: 🔴 **RED P0**。这不是"兜底"是"后门"。FINAL-REPORT 把后门当资产列入"完成标准达成"是严重低估。

### 4.2 🔴 FINAL-REPORT 7/7 过度宣称（D1 + D3 + D4 多维度指向）

**D1 需求覆盖 4 RED**（范围错配）:
- F1: macp2 五铁律零覆盖 — CLAUDE.md:27-35 五条（SubAgent 进程内 / 禁 create_session reviewer / 收敛条件 2/3/5 / 预算护栏 / Proma 心智模型 spawn=钱），FINAL-REPORT 6 项改进 0/6 覆盖
- F2: nanju 四铁律零覆盖 — CLAUDE.md:40-55（review_required / auditor 硬 DoD / brief checklist / prefix≤8）
- F3: v0.17.1 方向背离 — CLAUDE.md:58-64"GLM 教化无效必须引擎硬拦"，FINAL-REPORT 6 项仅 1 项引擎变更
- F4: 标准 4/5 非 harness 交付物 — 7/7 中 2 项（29%）属 multi-agent-collab-platform 应用层非 tree-harness

**D1 核心洞察**: "FINAL-REPORT 6 项改进解决'树建好后怎么跑'的操作问题，但 CLAUDE.md 核心诉求是'建树前必须钉死什么'的预防性铁律 — 两者正交维度，FINAL-REPORT 以操作改进宣称覆盖源头需求基准，属范围错配。"

**D3 SKILL 完备 5 RED**（协议内部硬伤）:
- F1: §13.7 错误码速查表 9/51（17.6%）— 指挥官关键码 E_CHILDREN_NOT_DONE / E_MAX_SESSIONS / E_REVIEW_NOT_CONVERGED 全缺
- F2: §13.6.0 idle 多维核验 4 项清单漏 communication_log 检查（矛盾 §6/§11#15 强制要求）
- F3: §14.2 "最少 7 leaf 含 fix 缺一不算完成" vs §14.6 "fix 可选" — 数字口径 + 强制性双重矛盾
- F4: §13.3 step7 漏做触发列表漏 E_CHILDREN_NOT_DONE + E_DELIVERABLE_EMPTY
- F5: §3.4 autonomy final_step 模板对 commander/auditor 角色方向性误导

**D3 核心洞察**: "SKILL v2.9.7 是'实战驱动补丁堆叠'产物 — 每次 macp 撞墙就补一段，但从未做过整体一致性回归。FINAL-REPORT 把'实战未撞'等同'协议完备'。"

**D4 实战验证 2 RED**（C1 链基线问题）:
- F1: macp3 C1=68 "MiniMax 签字"基线不可验证 — `pr/` 目录无 macp3 子目录，auditor session/报告/探针全不可查
- F2: macp6 将观察员非正式评语包装为"C1 推断 80-83（观察员异厂商推断）"，正式复评仅 76（-4~-7）

### 4.3 🔴 教化 vs 引擎硬拦方向背离（D1 + D2 + D6）

**CLAUDE.md v0.17.1 教训**（L58-64）: "GLM-5.2 不遵守 SKILL 教化，防线必须引擎硬拦（v0.17.1 实战证伪）"

**FINAL-REPORT 6 项改进方向审计**:
| # | 改进 | 层次 | 与 v0.17.1 方向 |
|---|------|------|----------------|
| §3.1 | §13.3b 多层级 done 接力协议 | 纯 SKILL（0 引擎改动） | ✗ 教化型，GLM 可自主绕过 |
| §3.2 | idle 探测多维核验 | 纯 SKILL | ✗ 教化型 |
| §3.3 | audit_log schema severity v0.21 | **引擎层** | ✓ 唯一引擎硬约束 |
| §3.4 | auditor ≥2 events | 纯 SKILL | ✗ 教化型 |
| §3.5 | emergent v2 协作教化 | 纯 SKILL | ✗ 教化型 |
| §3.6 | CLI 兼容通道兜底 | 操作流程 | ✗ 且是后门（D2+D6） |

**结论**: 6 项中仅 1 项（§3.3 v0.21）是引擎层硬约束，其余 5 项纯 SKILL 教化。与 v0.17.1"教化无效必须引擎硬拦"方向相悖。D6 攻击面分析证实：教化型约定（如 §13.3b "root 代调"依赖 caller=root）可被 CLI null-mode 一键绕过。

---

## 五、FINAL-REPORT 7/7 逐条独立核验

> root 初判，auditor MiniMax 异厂商独立签字见 `auditor-signoff.md`。判定标准: PASS（完全达成）/ PARTIAL（有实质工作但欠完整）/ FAIL（未达成）。

| # | FINAL-REPORT 标准 | root 初判 | 核验依据 | 关键扣分点 |
|---|------------------|----------|---------|-----------|
| 1 | P0 接力协议补章（§13.3b）+ idle 多维核验 | **PARTIAL** | §13.3b 协议补章有（macp7）；但 idle 多维核验 §13.6.0 漏 comm_log（D3 F2 RED）；root idle 根因（模型切换丢 MCP）未修，macp11 第三起复发（D4 F4 YELLOW） | "检测"半完成，"根因"在 roadmap |
| 2 | P1 audit_log schema + auditor≥2events + emergent 协作 | **PARTIAL** | audit_log severity v0.21 引擎强制（D1 F7 GREEN）；auditor≥2events 实战合规；但 audit_log 内容可伪造（D6 F4 YELLOW — 只防 schema 不防内容真实，red 阈值只扫最新一条） | 引擎防格式，内容真实靠 auditor 抽查（流程非强制） |
| 3 | 引擎 segment_add 评估 | **PARTIAL** | macp9 三方案论证完成（A1 改 added_by 永久否决 / A2 leaf_transfer_owner 留候选 / A3 SKILL 绕过）；但 A2 根治未实施，本轮选 A3 绕过（D2 F3 YELLOW） | "评估完"≠"根治"，引擎 segment_add 仍零 caller 校验 |
| 4 | 项目层 4 缺陷全修 + C1 85+ | **PARTIAL** | 4 缺陷代码真修（D5 F1-F4 GREEN，src file:line 实证：proma-cloud-llm-client.ts:399-445 / coder-engine-stub.ts:558-578 等）；但 C1=86 含未扣分 CLI 后门 + 基线悬空（D4 F1）+ Sandbox L1 scope 争议（D5 F5 YELLOW） | 4 缺陷真修 ✓，但 C1=86 分数本身虚高 |
| 5 | C1 权威复评 85+（MiniMax 异厂商签字） | **PARTIAL** | macp10/11 X-auditor 独立性真实（D4 F6 GREEN — session cb05aadd/22b8407c MiniMax-M3 ≠ GLM workers）；但 macp3 C1=68 基线不可验证（D4 F1 RED），演进链基线悬空 | 签字机制有效 ✓，但基线断链使绝对分数打折 |
| 6 | 综合实战验证 | **PARTIAL** | macp7-11 五轮实战有改进；但 §3.6 CLI 兜底实为 P0 后门（D2+D6 RED），把后门当资产列入"完成标准"是严重低估；macp11 root idle 第三起复发（D4 F4） | 含后门当资产 + 平台根因未修 |
| 7 | tree-iterative-development 终版 + 归档 | **PARTIAL** | SKILL v1.4 存在于 `.proma-pro/skills/`；但源目录 `D:/Codes/tree-harness/skills/tree-iterative-development/` **不存在**（D1 F6 YELLOW）— 违反 CLAUDE.md"权威源=tree-harness/"原则 | 部署端有，源端缺位（部署同步 bug 嫌疑） |

**7/7 真实达成**: **0/7 完全 PASS，7/7 PARTIAL，0/7 FAIL**。FINAL-REPORT 自评"7/7 ✅ 全达成"过度宣称。各项均有实质工作（非 FAIL），但均欠完整（非 PASS）。

**最严重过度宣称**: 标准 6（综合实战验证含 CLI 后门当资产）+ 标准 1（idle 根因未修只完成检测）。

---

## 六、C1=86 评估

### 6.1 C1 演进链可信度（D4 核验）

```
macp2 (GLM 自评)      70  ↓ MiniMax 复评 47（-23 暴跌，乐观偏差教训）
macp3 (MiniMax 签字)  68  ← 🔴 基线不可验证（归档缺失，D4 F1 RED）
macp4-5               —   harness 改进轮（无 C1 复评）
macp6 (GLM 估算)      76  ← 🔴 原始宣称 80-83 过度（D4 F2 RED），正式复评纠正为 76
macp10 (MiniMax 复评) 79  ← +3 修复回收（GREEN，签字独立）
macp11 (MiniMax 复评) 86  ← +7 攻拖分项（GREEN，但含未扣分 CLI 后门）
```

### 6.2 C1=86 的三个虚高点

1. **macp3 基线悬空**（D4 F1）: C1 链"68"节点无归档可查，若 macp3 实为 GLM 自评（类似 macp2），整链绝对分数需下调 ~20 分。即便 macp3 真为 MiniMax 签字，无归档使第三方复现不可能。
2. **CLI 后门 P0 未扣分**（D2+D6）: C1=86 未对 P0 引擎级后门（任意进程可假冒 root 背书 pass）扣分。这是 SECURITY §2.1"自审自过"威胁模型的教科书实例，应在 C1 中重扣。
3. **macp6 过度宣称历史**（D4 F2）: macp6 曾宣称 80-83（观察员评语包装为异厂商推断），被 macp10 正式复评纠正为 76。FINAL-REPORT §二虽用 76 但未披露原始夸大，损害审计透明度。

### 6.3 C1=86 的两个实质支撑（非全盘否定）

1. **macp10/11 异厂商签字机制真实有效**（D4 F6 GREEN）: X-auditor session（cb05aadd/22b8407c MiniMax-M3）确实独立于 GLM workers，独立写探针、独立跑命令。机制层面破除了 macp2 GLM 同质化教训。
2. **4 缺陷真修**（D5 F1-F4 GREEN）: evaluateSoft 真实现 + duck-type 契约校验 + CWE-22 path.resolve 双向规范化 + applyGwtAutofixPatch + evaluateCode 存在性校验，全部 src file:line 代码实证 + 修复档案交叉验证。

### 6.4 root C1 综合初判

**C1=86 虚高，但下调幅度 ≠ macp2 的 70→47 暴跌**。因 macp10/11 签字机制真实 + 4 缺陷真修是实质进展（非 macp2 的"不可运行空壳"）。真实 C1 应反映:
- CLI 后门 P0 扣分（ SECURITY 威胁模型维度）
- 基线悬空降置信（不能确认 68 真实）
- SKILL 协议硬伤扣分（D3 5 RED）
- 4 缺陷真修 + 异厂商机制加分（GREEN 支撑）

**root 不给具体分**（避免 GLM-root 自评偏差），具体签字分由 MiniMax auditor 独立确定（见 `auditor-signoff.md`）。

---

## 七、后续 Roadmap（优先级签字）

> 综合 D1-D6 worker 建议 + root 跨维度整合。auditor 独立签字调整见 `auditor-signoff.md`。

### P0（阻断级，必须立即修 — 安全/可信度根基）

| # | 项 | 来源 | 工作量 | 说明 |
|---|---|------|--------|------|
| P0-1 | **CLI 兼容通道后门封堵** | D2 F1+F2 + D6 F1+F2+F3 | 引擎层 ~50-100 行 | `run()` 第 4 参 callerSessionId 改为必填（缺省抛 E_CLI_CALLER_REQUIRED）；或加 CLI 调用签名 + tree-state.json HMAC 防裸编辑。移除 SKILL §13.3b L956-959"绕过 caller 校验"教化 |
| P0-2 | **auto_upgrade defense-in-depth 修正** | D6 F2 | ~10 行 | `tree-engine.cjs:2762-2777` `callerIsRootSelf = !callerSessionId \|\| ...` 逻辑修正（CLI 模式不能 `!undefined`=true 触发 root auto_upgrade）。使代码与注释"即便 caller 校验被绕过也不会触发"一致 |
| P0-3 | **macp3 C1 基线补归档** | D4 F1 | 归档补全 | 补 macp3 全部交付物（auditor session ID + 报告 + 探针 + 签字文件）到 `pr/2026072X-macp3/`；或 FINAL-REPORT §二 标注 C1 链基线为"未验证"而非"权威" |

### P1（高优，短期修 — 协议完备/实战痛点）

| # | 项 | 来源 | 说明 |
|---|---|------|------|
| P1-1 | §13.7 错误码速查表补全 9/51→≥40/51 | D3 F1 | 含 E_CHILDREN_NOT_DONE / E_MAX_SESSIONS / E_REVIEW_NOT_CONVERGED / E_DELIVERABLE_EMPTY / E_AUDITOR_NOT_DONE 等指挥官关键码 |
| P1-2 | §13.6.0 idle 多维核验加 communication_log 检查 | D3 F2 | 与 §6/§11#15 强制要求一致（macp6 误判根因正是漏看 comm_log） |
| P1-3 | §14.2 vs §14.6 fix 强制性统一 | D3 F3 | 删 §14.6"可选"标注，统一为强制；§14.3 补 fix 角色 in_scope 模板 |
| P1-4 | §13.3 step7 漏做触发列表补码 | D3 F4 | 加 E_CHILDREN_NOT_DONE + E_DELIVERABLE_EMPTY |
| P1-5 | root idle 平台修复 | D4 F4 | tree_init 后强制启动 root agent 处理后续队列；模型切换不丢已注入 MCP 工具集（macp11 第三起复发） |
| P1-6 | segment_add A2 `leaf_transfer_owner` 实施 | D2 F3 | macp9 留候选 (~50 行)，根治 v2 接力 E_BORROWED_IDENTITY，不再依赖旧 root 代调 |
| P1-7 | audit_log 内容真实性防御 | D6 F4 | 不只扫最新一条 audit_log；历史 red 不可被新条目静默清洗（v0.23"只看最新"是回归） |
| P1-8 | macp2/nanju 铁律嵌入 SKILL §1 | D1 F1+F2 | SubAgent 进程内 / 禁 create_session reviewer / 收敛条件 / review_required / auditor 硬 DoD 等预防性约束钉死（非仅 startup_notice 教化） |

### P2（中优，中期演进 — 文档精度/项目层补完）

| # | 项 | 来源 | 说明 |
|---|---|------|------|
| P2-1 | v0.17.1 方向对齐：增加引擎层 anti-forgery | D1 F3 + D6 | 不只 SKILL 教化（review_round reviewer_kind=subagent + reviewer_ref 溯源引擎强制） |
| P2-2 | §3.4 final_step 模板按角色分化 | D3 F5 | worker/commander/auditor 三套模板，避免 commander/auditor 角色误导 |
| P2-3 | §11 禁止行为计数更新 12→17 | D3 F7 | metadata 一致性 |
| P2-4 | Sandbox L1 Windows JobObject 实施 | D5 F5 | ~200 行 native binding，C1=86→95+ 的 +4 Sandbox 分实际只需 L1 即可回收部分 |
| P2-5 | Electron IPC 15 stubData 实装 | D5 F7 | 当前仅 5/20 IPC channel 实装（coder 3 + judge 2） |
| P2-6 | judge 占位真补 16→<5 | D5 F6 | hard checks 9 + soft eval 4 维补全（注意：ALL_HARD_RULES 实测 8 项，非宣称 9，计数需校正） |
| P2-7 | review_round 内容真实性引擎防御 | D6 F5 | 引擎自认"仅防格式伪造不防内容伪造"，需 reviewer session 实质内容校验 |
| P2-8 | session_liveness 后台回收 | D6 F6 | 真实 session 失效（余额耗尽/超时）后 leaf 自动 inactive，防僵尸 auditor/僵尸 root |
| P2-9 | audit_gate immutability | D6 F7 | pass 一旦写入不可重写/撤销，加签名链 |
| P2-10 | tree-iterative-development 源目录补建 | D1 F6 | `D:/Codes/tree-harness/skills/tree-iterative-development/` 创建，符合"权威源=tree-harness/"原则 |
| P2-11 | 身份继承矩阵补全常用工具 | D3 F6 | §13.3b 矩阵加 tree_drift_append / tree_log_communication / tree_heartbeat_append 等 |

### Roadmap 优先级签字说明

- **P0 三项是本轮审计的核心交付**：CLI 后门封堵（P0-1）+ auto_upgrade 修正（P0-2）+ 基线补归档（P0-3）。前两项是引擎层安全根基，第三项是 C1 链可信度根基。不修这三项，FINAL-REPORT 任何"完成"宣称都建立在后门 + 悬空基座上。
- **P1 八项是协议完备性补救**：D3 5 RED + D4 root idle + D2 segment_add + D6 audit_log + D1 铁律嵌入。修后 SKILL v2.9.7 → v2.9.8 可达"协议完备"。
- **P2 十一项是中期演进**：项目层 C1 86→95+ 路径（Sandbox/IPC/judge）+ 文档精度 + 引擎纵深防御。

---

## 八、跨 root 交叉验证（Meta Finding）

### 8.1 并行审计会话发现

审计启动时发现**并行审计会话** `audit-root-Claude`（session=378c1e4b，实际 DeepSeek-v4-pro，tree_id=audit，早 11 分钟启动）已在 audit-20260728/ 根目录产出 D1/D3/D5 报告。本审计（audit2-root，GLM-5.2）据此：
1. 输出落 `audit-20260728/glm-root/` 子目录隔离
2. 6 worker + auditor 全程被指示**不读**并行产物（独立性硬规则）
3. 本节是 worker 独立审计完成后，root 层面的 meta 对比（不污染 worker 独立性）

### 8.2 双 root 独立审计的价值

两 root（GLM-root + DeepSeek-root）独立审计同一对象，构成**异厂商 root 级对抗**：
- 若两 root 结论收敛 → 强证据（非单 root 偏差）
- 若两 root 结论分歧 → 暴露不确定性，需人工裁决

**Meta 结论**: 两 root 独立产出同维度报告（D1/D3/D5 量级相当：并行 29040/21703/32931B vs 本审计 24863/45479/16280B），说明各维度问题客观存在（非本 audit2 单方面构造）。详细内容对比留作后续工作（需用户授权读并行产物，或由用户人工对比）。

### 8.3 异厂商对抗哲学的体现

本审计 + 并行审计共同构成**三层异厂商对抗**:
1. **worker 层**: D1/D4/D5=DeepSeek vs D2/D3/D6=GLM（双核心）
2. **auditor 层**: MiniMax-M3（异厂商独立签字）
3. **root 层**: GLM-root（本）vs DeepSeek-root（并行）

这打破了 macp2"全 GLM 树自评"的同质化教训。memory `tree-task-evaluation-multi-model` 的方法论在本审计中得到完整实践。

---

## 九、auditor 异厂商签字（MiniMax-M3 独立 verdict）

MiniMax-M3 auditor（session=2282d381）独立完成两阶段签字，**核心异厂商 verdict 已交付**：

### 9.1 auditor 独立签字结果

| 项 | FINAL-REPORT 自评 | **auditor 异厂商签字** | 差距 |
|----|------------------|----------------------|------|
| **C1 综合分** | 86/100（达 85+ 目标） | **82/100** | **-4，不达 85+** |
| **7/7 完成标准** | 7/7 全达成 | **PASS 2 / PARTIAL 4 / FAIL 2（真实 ~3.5/7）** | 过度宣称 |

### 9.2 C1=82 的三个 challenge down（auditor 独立调分，非 worker 平均）

| 维度 | macp11 签字 | **auditor 签字** | Δ | auditor 独立理由 |
|------|----------:|----------:|---:|------|
| 端到端 | 8 | **6** | **-2** | 🔴 主 challenge：macp10 把"进程内集成测试"判 4/10，macp11 对"进程内+mock注册表"判 8/10（+4），同性质两轮差 4 分判据不一致。真实增量值 +2，给 6/10 |
| Judge 业务 | 15 | **14** | **-1** | `runGwtExistenceCheck` 非 ENOENT 读错误→`featuresTotal=0`→pass（`:1072-1078`）是真缺陷，与"假通过"红线冲突 |
| 自动化测试 | 8 | **7** | **-1** | 满分 8/8 与 29 个 ts 文件、sandbox 550+snapshot 903 行零覆盖、仅 24 用例不相称 |
| Coder 业务 | 14 | **15** | **+1** | 阶段1 扣 1 撤回：22 处"占位"grep 经核实多为过时注释/docstring/mock，D5 F1-F3 代码实证成立 |

### 9.3 auditor 7/7 逐条签字

| # | 标准 | auditor 签字 | 理由 |
|---|------|------------|------|
| 1 | P0 接力+idle | **PARTIAL** | 协议真实，macp10 零撞击可信；但 root idle 第三起复发 + §13.6.0 漏 comm_log（D3-F2 uphold） |
| 2 | audit_log severity+auditor events | **PASS** | 唯一实至名归的引擎层硬拦（代码复核成立） |
| 3 | segment_add 评估 | **PARTIAL** | 评估交付但 gap 未修（D2-F3 uphold，A2 未实施） |
| 4 | 4 缺陷+C1 85+ | **FAIL** | 4 缺陷真修 ✓，但 C1 85+ 不成立（签 82）+ git HEAD macp3 16 条未提交 |
| 5 | C1 权威复评 85+ | **FAIL** | 签字流程真实（D4-F6 uphold），但 85+ 数值断言不成立 |
| 6 | 综合实战验证 | **PARTIAL** | macp11 暴露 root idle + auditor 0 events + CLI 绕过，写"全 PASS"过度 |
| 7 | SKILL 终版+归档 | **PARTIAL** | `tree-iterative-development/` 源目录缺位（D1-F6 uphold）+ v1.4 版本号未 bump |

### 9.4 auditor 漏报补充（challenge up — 新发现）

auditor 独立补充两条 6 worker 均未覆盖的 finding：
1. **git HEAD 仍 macp3 `188bb82`，macp6-11 全部改动 16 条 dirty/untracked 未提交** — 第三方不可复现，与 7/7 标准 7"归档"FAIL 直接相关
2. **CLI 兼容通道被 macp11 当成功经验写入 `results.md §3`** — 把 P0 后门当资产，方向性错误（uphold D2+D6 RED）

### 9.5 🔴 Partial 完成的诚实声明

auditor MiniMax-M3 大单 turn（读 ~200KB 源文档+6 报告+写签字）**撞输出 token 上限**，在写完 §〇 TL;DR + §一 九维 C1 签字表 + §二 7/7 核验表 + `<!-- SECTION-3-PLACEHOLDER -->` 后 turn stall（文件 12:31 至今稳定 8965B 无增长，SDK 持续"处理中"，ping 两次均"上一条处理中"）。

**核心异厂商 verdict（C1=82, 7/7=3.5/7, 关键 challenge）已完整交付并落盘** `auditor-signoff.md` §〇-二。缺失 §三 challenge/uphold 详细表 + §四 roadmap 签字 + §五落款（但 §〇-二 已含 challenge 要点 + 9.2/9.3 表是 root 据 auditor §一/二 整理）。

**root 处理**：接受 partial（核心 verdict 在，守审计诚实不 fabricate 缺失章节），milestone audit_pass=true（实质达成），auditor leaf 走 `archived` clean closeout（macp3-C 先例，保留 partial 交付），drift_append 留痕（kind=production, severity=mid）。

**root 接受 auditor 签字的独立性**：auditor C1=82 与 root 不给具体分（避 GLM 自评偏差）兼容；auditor 7/7=3.5/7 比 root 7/7=0 PASS 更宽松（root 全 PARTIAL，auditor 含 2 PASS + 2 FAIL），双方独立判定略有差异正是异厂商对抗的价值（非同款偏差）。

---

## 十、总结论

### 10.1 对 FINAL-REPORT 7/7 + C1=86 的最终判定

| 项 | FINAL-REPORT 自评 | audit2 独立核验 | 差距 |
|----|------------------|----------------|------|
| 7/7 完成标准 | 7/7 ✅ 全达成 | **auditor 签字: PASS 2 / PARTIAL 4 / FAIL 2（~3.5/7）**；root 初判 7/7 PARTIAL | 过度宣称 |
| C1 分 | 86/100（达 85+） | **auditor 异厂商签字 82/100（-4，不达 85+）** | 过度宣称 |
| Harness 改进 | 6 项核心改进 | 5/6 纯 SKILL 教化（与 v0.17.1 方向悖），1 项引擎层 | 方向性问题 |
| 异厂商签字 | macp10/11 MiniMax 86 | **本审计 MiniMax-M3 签 82**（vs FINAL 86，-4） | 签字机制有效（D4 F6），分数下调 |

### 10.2 不是 macp2 式空壳（公平评价）

虽 7/7 过度宣称，但 FINAL-REPORT **非 macp2 式"不可运行空壳"**:
- ✓ 4 缺陷真修（D5 4 GREEN，src file:line 代码实证 + 修复档案交叉验证）
- ✓ macp10/11 异厂商签字机制真实独立（D4 F6 GREEN）
- ✓ §13.3b 多层级 done 协议有实战验证（macp10 零 V10 撞击）
- ✓ audit_log severity v0.21 是真实引擎层加固

### 10.3 三个 P0 级诚信问题

1. **CLI 兼容通道是后门非兜底**（D2+D6 跨维度收敛 5 RED）— 把 P0 后门当资产列入"完成标准"
2. **C1 链基线不可验证**（D4 F1）— macp3=68 无归档，演进链基座悬空
3. **教化方向与 v0.17.1 教训相悖**（D1 F3）— 5/6 纯 SKILL 教化，可被 GLM 自主绕过（D6 攻击面证实）

### 10.4 给用户的建议

1. **立即修 P0 三项**（CLI 后门封堵 + auto_upgrade 修正 + macp3 基线补归档）
2. **C1 重评**：以 auditor MiniMax 签字分为准，下调 FINAL-REPORT 自评 86
3. **方向校正**：增加引擎层 anti-forgery 加固，减少纯 SKILL 教化（对齐 v0.17.1）
4. **SKILL v2.9.8**：修 D3 5 RED（错误码表补全 + idle 加 comm_log + §14 统一 + step7 补码 + final_step 角色分化）

---

## 十一、归档清单

| 文件 | 内容 |
|------|------|
| `AUDIT-FINAL-REPORT.md`（本文件） | root 综合总报告 |
| `D1-requirements-coverage.md` | D1 需求覆盖审计（DeepSeek，RED×4 + YELLOW×2 + GREEN×3） |
| `D2-engine-semantics.md` | D2 引擎语义审计（GLM，RED×2 + YELLOW×3 + GREEN×3） |
| `D3-skill-completeness.md` | D3 SKILL 完备性审计（GLM，RED×5 + YELLOW×8 + GREEN×3） |
| `D4-combat-validation.md` | D4 实战验证审计（DeepSeek，RED×2 + YELLOW×3 + GREEN×3） |
| `D5-project-quality.md` | D5 项目层质量审计（DeepSeek，GREEN×4 + YELLOW×4） |
| `D6-security-adversarial.md` | D6 安全对抗审计（GLM，RED×3 P0 + YELLOW×5 + GREEN×4） |
| `auditor-signoff.md` | MiniMax-M3 异厂商独立签字 |

**树状态**: tree_validate(audit2) = {ok:true, issues:[]}

---

**审计完成**。8 leaves 全 done，7 维度对抗审计全完成，真实完成度确认（7/7 PARTIAL），后续 roadmap（P0×3 + P1×8 + P2×11）优先级清晰，MiniMax 异厂商签字打破同款偏差。

**Co-Authored-By**: audit2-root (GLM-5.2) + audit2-X-auditor (MiniMax-M3)
