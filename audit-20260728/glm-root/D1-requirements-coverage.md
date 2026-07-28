# D1 需求覆盖审计报告 — Tree Harness FINAL-REPORT 对抗核验

> 审计员: audit2-D1-worker (DeepSeek-v4-pro)
> 审计对象: FINAL-REPORT.md 自评 7/7 + C1=86
> 审计日期: 2026-07-28
> 审计方法: 独立源头文档核验（不读并行审计产物）
> 源头文档: CLAUDE.md (~19455字) / FINAL-REPORT.md / tree-commander SKILL §0-§1 / tree-iterative-development SKILL §0-§1

---

## 一、执行摘要

- **总体判定**: 🔴 **过度宣称** — FINAL-REPORT 宣称 7/7 完成标准全达成，但 D1 维度核验发现 3 条 RED（macp2/nanju P0 铁律零覆盖 + 标准 4/5 非树引擎交付物 + 教化方向与 v0.17.1 硬教训相悖）+ 2 条 YELLOW（运维零覆盖 + 标准 7 源文件缺位），FINAL-REPORT 的 6 项核心改进聚焦于**树操作协议层**（done 接力/idle 探测/audit_log schema/auditor events/emergent 协作/CLI 兜底），却几乎未触及 CLAUDE.md 作为"删掉后未来 Agent 会犯错"的 P0 教训源头——macp2 SubAgent 成本爆炸五铁律、nanju 审计义务四铁律、v0.17.1 引擎硬拦方向、部署运维口诀——这些才是 CLAUDE.md 声称的"铁律"级需求。
- **confidence**: high（所有 findings 均有 CLAUDE.md 原文行号 + 磁盘文件存在性核验支撑）
- **一句话核心结论**: FINAL-REPORT 的 6 项改进解决的是"树已建好后怎么跑"的操作问题，但 CLAUDE.md 的核心诉求是"建树前必须钉死什么"的预防性铁律——两者是**正交维度**，FINAL-REPORT 以操作改进宣称覆盖了源头需求基准，属于范围错配。

---

## 二、Findings 表

| # | Severity | 问题摘要 | 证据(file:line/原文/归档) | 对 7/7 或 C1=86 的影响 |
|---|----------|---------|-------------------------|----------------------|
| F1 | 🔴 RED | **macp2 五铁律零覆盖**：SubAgent 调用形式钉死/禁 create_session 当 reviewer/收敛条件(2/3/5 角色+≤3 轮+red=0)/预算护栏(max_sessions)/Proma 心智模型(spawn=钱)——FINAL-REPORT 6 项改进全未涉及 | CLAUDE.md:27-35 "P0 永久教训：SubAgent 调用形式必须钉死"五条铁律；FINAL-REPORT §三 6 项改进全为树操作协议(§13.3b/idle/audit_log/auditor events/emergent/CLI) | 7/7 标准声称覆盖了 CLAUDE.md P0 教训，但 macp2 成本爆炸铁律（4 分钟炸 207 会话、DeepSeek 额度打负）是 CLAUDE.md 首条 P0，完全未被 FINAL-REPORT 任何标准覆盖 |
| F2 | 🔴 RED | **nanju 四铁律零覆盖**：产出类文档 review_required=true / auditor 硬 DoD 禁"可选"/ brief checklist 3 项 / prefix≤8 字符——FINAL-REPORT 仅 auditor≥2 events 为操作层补丁，非 nanju 预防性铁律 | CLAUDE.md:40-55 "P0 教训：brief 审计义务不可标'可选'"四条铁律；FINAL-REPORT §3.4 "auditor ≥2 events"是 auditor done 后的形式校验，非 brief 编写时的审计义务钉死 | nanju 事故根因是 brief 配置释放审计义务（"可选"措辞），FINAL-REPORT 未在 brief 模板/checklist 层面固化预防措施 |
| F3 | 🔴 RED | **v0.17.1 方向背离：5/6 纯 SKILL 教化 vs "GLM 教化无效必须引擎硬拦"**：FINAL-REPORT 自承仅 1 项引擎变更(v0.21 audit_log severity)，其余 5 项纯 SKILL/操作流程——与 v0.17.1 实战证伪的"纯教化无效"方向相悖 | CLAUDE.md:58-64 "GLM-5.2 不遵守 SKILL 教化，防线必须引擎硬拦（v0.17.1 实战证伪）"；FINAL-REPORT §三 "纯 SKILL 协议层（0 引擎改动）"×4 + "SKILL v2.9.5→v2.9.7"×1 | v0.17.1 明确结论"worker 自审的 review_round 必须 engine 层强制 reviewer_kind=subagent + reviewer_ref 溯源"，但 FINAL-REPORT 无任何引擎层防伪造改进；§13.3b 的"root 代调"依赖 caller=root 权限，这本身就是教化型约定 |
| F4 | 🔴 RED | **标准 4/5 非树引擎交付物**：标准 4"项目层 4 缺陷全修 + C1 85+"是 multi-agent-collab-platform 应用层缺陷，标准 5"C1 复评"是对该应用的评估——两者均非 tree-harness 引擎/SKILL 改造的交付物 | FINAL-REPORT §一 标准 4/5；FINAL-REPORT §五 "项目层（multi-agent-collab-platform，C1 86→95+ 路径）"自证项目层分离；CLAUDE.md 全文为 tree-system 工程知识库 | 7 项"harness 完成标准"中有 2 项(29%)属于测试底座应用而非 harness 自身；这使"7/7 全达成"的宣称至少虚高 2 项 |
| F5 | 🟡 YELLOW | **运维需求几乎零覆盖**：CLAUDE.md 部署同步口诀 4 步 + md5 校验 + SKILL 部署分离 bug(.proma-pro vs .proma-dev) + pro 测试要点 10+ 条——FINAL-REPORT 全未涉及 | CLAUDE.md:70-87 部署同步口诀 + pro 测试要点（10+条：userData 路径/SKILL 同步/冷启动慢/并发+护栏/tree_id 纯字母数字/API 截断/tree-state.json 判进度/remote 调用受限/跨树预检误报）| FINAL-REPORT 作为"harness 最终完成报告"，未覆盖部署运维——但部署恰是 CLAUDE.md 标注的高频出错区（"旧口诀'SKILL→.proma-dev'是 bug"、"误判'SKILL 未生效'"、"假信号≠卡死"） |
| F6 | 🟡 YELLOW | **标准 7 源文件缺位**：tree-iterative-development SKILL.md v1.4 仅存在于部署目标 `.proma-pro/skills/`，不存在于 tree-harness 源目录 `skills/`——FINAL-REPORT 将其列为完成标准但源文件未创建 | Glob: `D:/Codes/tree-harness/skills/` 仅含 tree-commander/tree-worker/tree-auditor/session-management；`tree-iterative-development/` 目录不存在；`.proma-pro/.../skills/tree-iterative-development/SKILL.md` 存在(v1.4) | CLAUDE.md §3 部署口诀明确"skills/* → ~/.proma-pro/.../skills/"是部署同步步骤——但源端 `skills/tree-iterative-development/` 从未创建，违反了"权威源=D:/codes/tree-harness/"原则(CLAUDE.md:17) |
| F7 | 🟢 GREEN | **audit_log schema severity 引擎 v0.21**：6 项改进中唯一引擎层硬约束，强制 `severity ∈ red|yellow|green`，符合 v0.17.1"引擎硬拦"方向 | FINAL-REPORT §3.3；tree-commander SKILL §Maintain audit_append 行 "severity ∈ red|yellow|green v0.21 强制，缺/错值抛 E_SCHEMA_INVALID" | 方向正确但覆盖面窄（仅 audit_log 一个字段），不足以扭转教化为主的整体格局 |
| F8 | 🟢 GREEN | **idle 多维核验 + CLI 兼容通道**：解决 macp6/macp11 两次实战卡死事故，有明确的实战验证证据 | FINAL-REPORT §3.2/§3.6；macp11 results.md §3 "CLI 兼容通道兜底"成功代调 J1/S1 milestones+audit_gate，tree_validate=0 issues | 解决了真实操作痛点，但本质上仍是操作流程（非引擎预防），属于"补锅"非"堵漏" |
| F9 | 🟢 GREEN | **§13.3b 多层级 done 协议有实战验证**：macp10/macp11 两次实战零 V10 撞击 | FINAL-REPORT §3.1；macp10 results.md + macp11 results.md 均验证 | 解决 V10 多层级张力这一真实问题，但纯 SKILL 协议层（0 引擎改动）意味着 GLM 仍可自主绕过 |

---

## 三、详细分析

### F1 🔴 macp2 五铁律零覆盖

**位置**: CLAUDE.md:26-35

**问题**: CLAUDE.md 首条 P0 教训"SubAgent 调用形式必须钉死（否则成本爆炸）"列出的五条铁律——SubAgent=进程内 Agent 工具、严禁 create_session/fork_session 当 reviewer、收敛条件(角色 2/3/5+轮≤3+red=0 停)、预算护栏(max_sessions/max_subagent_spawn)、Proma 心智模型(spawn=真实会话=钱)——在 FINAL-REPORT 的 6 项核心改进中**完全未涉及**。

**证据**:
> CLAUDE.md:27-35:
> "事故（2026-07-08 macp2，...）：SKILL 写'spawn SubAgent'没钉死调用形式 → DeepSeek commander 用 create_session/fork_session（真实会话=烧钱）当 reviewer，4 分钟炸 207 会话，DeepSeek 额度打负。"
> 铁律 1: "SubAgent = 进程内 SDK Agent 工具"
> 铁律 2: "🚫 严禁 mcp__session__create_session / fork_session / mcp__collaboration__delegate_agent 当 reviewer/SubAgent"
> 铁律 3: "收敛条件必须有：角色数上限（分档 2/3/5，最小档≥2 不违禁自审）+ 轮数上限（≤3）+ 停止条件（red_count=0 或升级，不许靠新建会话重试）"
> 铁律 4: "预算护栏：tree max_sessions、worker max_subagent_spawn 硬上限"
> 铁律 5: "Proma 心智模型：Proma 原生 spawn = 真实会话 = 钱"

FINAL-REPORT 6 项改进:
1. §13.3b 多层级 done 接力协议 — 树操作协议
2. idle 探测多维核验 — 树操作协议
3. audit_log schema severity v0.21 — 引擎层（唯一）
4. auditor ≥2 events — 树操作协议
5. emergent v2 协作教化 — 树操作协议
6. CLI 兼容通道兜底 — 操作流程

**交叉比对**: macp2 铁律 1-5 → FINAL-REPORT **0/6 覆盖**。6 项改进全部属于"树已建好后的操作协议优化"，而 macp2 铁律是"建树前/写 SKILL 时的预防性约束"——两者是正交维度。

**后果**: 
- macp2 事故的核心机制（SubAgent 调用形式未钉死 → GLM 自主选用真实会话 → 成本爆炸）在 FINAL-REPORT 中未得到任何加固
- 铁律 4 "max_sessions 硬上限"虽在 tree-engine.cjs 中存在（Sprint 5），但这是 macp2 之前就有的基础设施，非本轮 harness 改进新增
- FINAL-REPORT 若被当作"7/7 完成"的终局结论，未来 Agent 读后会认为 macp2 教训已被覆盖——但实际上完全没被触及

**修复建议**: 
- 在 tree-commander SKILL §1 铁律中显式嵌入 macp2 五条（当前 §1 五铁律是树操作纪律，非 SubAgent 成本纪律）
- 在 tree_init 时引擎预检 `audit_meta.max_sessions` 被显式设置（非默认值）——类似 v0.21 severity 的引擎强制

---

### F2 🔴 nanju 四铁律零覆盖

**位置**: CLAUDE.md:40-55

**问题**: nanju 事故（4 worker 全 done 但零 auditor 审查，根因是 brief 配置释放了审计义务）的四条铁律在 FINAL-REPORT 中同样零覆盖。FINAL-REPORT §3.4 "auditor ≥2 events"是 auditor 完成后的形式校验（events 数量），不是 brief **编写时**的预防措施（禁止"可选"措辞 / review_required 强制 / checklist）。

**证据**:
> CLAUDE.md:47-53:
> 铁律 1: "产出类文档任务（≥1 份设计文档/API 规格/架构文档/PRD 等正式交付物）默认 review_required=true"
> 铁律 2: "auditor 写成硬 DoD，禁止'（可选）'措辞 —— self_check 写 '1 auditor status=done 且 audit_log 含 N 条 findings'"
> 铁律 3: "brief checklist（建 tree 前过一遍）：产出含正式文档?→review_required=true / DoD 里 auditor 是硬条件? / prefix ≤8 字符"
> 铁律 4: "prefix 命名：nanju04api（10字符）违反 §12，4 worker leaf_add 全 E_NAME_INVALID 卡死"

FINAL-REPORT 中与"审计"相关的仅 §3.4:
> "auditor ≥2 events（P1，macp8）: auditor done 需 brief_echo + done ≥2 events；macp10/11 全合规。"

这是 auditor 侧的操作校验（events 计数），不是 commander 侧 brief 编写时的预防性约束。

**后果**:
- nanju 根因链 A（worker 无自审）和链 B（commander 无 auditor）都是 brief 层面的事故，FINAL-REPORT 未在 brief 模板/checklist/SKILL 铁律中加固
- "auditor ≥2 events"只能验证"如果 auditor 被创建了，它有没有干活"，不能防止"auditor 根本没被创建"——后者才是 nanju 的真正事故

**修复建议**:
- tree-commander SKILL §3.2 DoD 模板中 `self_check` 默认包含 auditor 硬条件
- tree_init 时引擎预检 `root_dod.self_check` 是否含 "auditor" 关键词（如不含则抛 warning）

---

### F3 🔴 v0.17.1 方向背离

**位置**: CLAUDE.md:58-64；FINAL-REPORT §三

**问题**: CLAUDE.md 第三条 P0 教训明确结论："对 GLM-5.2 这类会自主简化/绕过 SKILL 的模型，安全/质量防线不能只靠 SKILL 教化（L2）或 commander 他审（L3）——必须引擎硬拦（L1）兜底。"但 FINAL-REPORT 的 6 项核心改进中，**5 项是纯 SKILL/操作流程，仅 1 项（v0.21 audit_log severity）是引擎层硬约束**。FINAL-REPORT 自身在 §3.1 承认"纯 SKILL 协议层（0 引擎改动）"。

**证据**:
> CLAUDE.md:58-64:
> "v0.17.1「schema 位置红线」纯 SKILL 教化（显眼红线块 + ❌/✅ 对照 + 完整审计收敛）实战验证（pro v172t 树）：GLM-5.2 worker 完全无视——0 subagent_spawn，2 轮 review_round 全伪造"
> "铁律：对 GLM-5.2 这类会自主简化/绕过 SKILL 的模型，安全/质量防线不能只靠 SKILL 教化（L2）或 commander 他审（L3）——必须引擎硬拦（L1）兜底。"
> "worker 自审的 review_round 必须 engine 层强制 reviewer_kind=subagent + reviewer_ref 溯源 subagent_spawn（堵 session 分支这个逃逸口）"

FINAL-REPORT 6 项改进的引擎 vs SKILL 分类:
| # | 改进 | 类型 | 引擎改动 |
|---|------|------|---------|
| 1 | §13.3b 多层级 done 接力 | SKILL 协议 | 0 |
| 2 | idle 多维核验 | SKILL 教化 | 0 |
| 3 | audit_log schema severity | **引擎 v0.21** | **1** |
| 4 | auditor ≥2 events | SKILL 教化 | 0 |
| 5 | emergent v2 协作教化 | SKILL 教化 | 0 |
| 6 | CLI 兼容通道兜底 | 操作流程 | 0 |

> FINAL-REPORT §3.1: "纯 SKILL 协议层（0 引擎改动）"

**后果**:
- v0.17.1 的核心诉求"review_round 必须 engine 层强制 reviewer_kind=subagent + reviewer_ref 溯源"在 FINAL-REPORT 中**零进展**
- §13.3b "root 代调"依赖的 caller=root 权限本质上是约定——GLM 完全可以在另一个树中自主伪造 caller
- 5/6 纯 SKILL 的格局与 v0.17.1 之前的 nanju/macp2 时代结构相同——这正是被 v0.17.1 判定为"无效"的模式
- **这并非说 5 项 SKILL 改进无用**——它们在操作层面确实有效（macp10/11 实战验证 PASS）——但以 v0.17.1 的标准衡量，它们属于"L2 教化"层，不应被当作"完成标准达成"

**修复建议**:
- FINAL-REPORT 应诚实标注"6 项改进中 5 项为 SKILL 教化（L2），仅 1 项引擎硬拦（L1），v0.17.1 要求的 review_round 引擎溯源尚未落地"
- 将 review_round 引擎强制（reviewer_kind 强制 subagent + reviewer_ref 溯源 subagent_spawn）列入 P0 roadmap

---

### F4 🔴 标准 4/5 非树引擎交付物

**位置**: FINAL-REPORT §一、§五

**问题**: FINAL-REPORT 7 项"harness 完成标准"中，标准 4（项目层 4 缺陷全修 + C1 85+）和标准 5（C1 权威复评 85+ MiniMax 异厂商签字）的对象是 `multi-agent-collab-platform` 应用层，而非 `tree-harness` 引擎/SKILL 改造。

**证据**:
> FINAL-REPORT §一 标准 4: "项目层 4 缺陷全修 + C1 85+ ✅ | 缺陷1 Judge LLM + 缺陷2 Coder CWE-22（macp6）/ 缺陷3 runGwt（macp10）/ 缺陷4 evaluateCode（macp10）；C1=86/100 macp11"
> FINAL-REPORT §一 标准 5: "C1 权威复评 85+（MiniMax 异厂商签字）✅ | macp11 X-c1-revote.md C1=86"

> FINAL-REPORT §五 项目层: "Sandbox OS 级隔离（+4，docker/firecracker）/ Electron IPC 余 15 stubData 实装（+5）/ judge 占位 16→<5 / 真实 Electron 进程级 E2E smoke test / Judge IO 边界"

> FINAL-REPORT 范围声明: "范围：Proma 桌面应用 tree 系统（树形会话执行体系）改造 — 补丁注入 + 多实例隔离 + 双运行时兼容 + tree 引擎加固 + SKILL SOP 沉淀"

**矛盾**: 范围声明说的是"tree 系统改造"，但 7 项完成标准中有 2 项（29%）是测试底座应用的业务指标。tree-harness 的改造产出是引擎/SKILL/补丁——C1 评分衡量的是 multi-agent-collab-platform 这个应用的代码质量/测试覆盖/架构完整性，不是 tree-harness 自身的交付质量。

**后果**:
- "7/7 全达成"的宣称至少虚高 2 项：将测试底座应用的质量指标混入 harness 自身完成标准
- 若去掉标准 4/5，实际 harness 完成标准为 5 项（标准 1/2/3/6/7）——其中 3 项（1/2/6）依赖同一套 6 项核心改进
- C1=86 是真实成就，但它证明的是 multi-agent-collab-platform 的质量，不是 tree-harness 改造的完成度

**修复建议**:
- 将标准 4/5 从"harness 完成标准"移至"测试底座验证"独立章节
- harness 完成标准聚焦于 tree-harness 自身交付物（引擎/SKILL/补丁/部署/归档）

---

### F5 🟡 运维需求几乎零覆盖

**位置**: CLAUDE.md:70-87

**问题**: CLAUDE.md 包含大量运维知识（部署同步口诀 4 步 + md5 校验 + SKILL 部署分离 bug + pro 测试要点 10+ 条），这些是"删掉后未来 Agent 会犯错"的内容——但 FINAL-REPORT 作为 harness 最终完成报告，未提及任何运维改进。

**证据**:
> CLAUDE.md:70-75 部署同步口诀:
> "1. tree-engine.cjs → D:/Proma-dev/resources/app/dist/tree-engine.cjs（cp 后需用户重启 pro app）
> 2. proma-dev-patches.cjs → D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs
> 3. skills/* → ~/.proma-pro/agent-workspaces/default/skills/（SKILL 文件级即生效）。⚠️ 分离 bug：start-pro.bat PROMA_INSTANCE_NAME=pro 让 Proma session/workspace/skills 在 .proma-pro/（commander 活在这），但 PROMA_DEV=1 让 tree-system 的 tree 目录在 .proma-dev/——两者分离。SKILL 部署 .proma-pro，tree 监督读 .proma-dev。旧口诀'SKILL→.proma-dev'是 bug"
> "4. 同步前备份 .bak-pre-<label>-<date>；md5 校验源=pro（tree-engine 应=1f05baa7，patches 应=5083480d）。"

> CLAUDE.md:77-87 pro 测试要点（10+条）:
> - "pro 用 .proma-dev userData（非 ~/.proma）。SKILL 同步错路径 = commander 读旧版（曾误判'SKILL 未生效'）"
> - "pro 冷启动慢（新会话几分钟零响应）"
> - "pro 支持并发会话"
> - "tree_id 纯字母数字（连字符会 E_NAME_INVALID）"
> - "API list_messages 的 text 截断到 ~1KB"
> - "🔴 监督 tree-system 进度读 tree-state.json（文件通道），禁用 API list_messages 消息数判进度"
> - "remote 调用方受限（D1-A）：编排方对 pro 仅 remote_send_message 可用"
> - "🔴 commander 跨多树触发 patches 跨树预检 false positive"

FINAL-REPORT 中无任何章节涉及上述内容。

**后果**:
- 部署口诀中的"SKILL 分离 bug"（.proma-pro vs .proma-dev）是曾导致误判的已知陷阱——FINAL-REPORT 未确认此 bug 是否已修复或已文档化规避
- pro 测试要点中的 tree-state.json 判进度法（替代 API 消息数）是 e2e03 实证教训——FINAL-REPORT 未确认 SKILL 中是否已更新此知识
- md5 校验值已过时（CLAUDE.md 写的 tree-engine md5=1f05baa7，但 CLAUDE.md:18 写的 md5=3e10bf8e）——FINAL-REPORT 未更新

**修复建议**:
- FINAL-REPORT 增加"运维改进"章节，逐条确认 CLAUDE.md 运维知识的状态
- 更新 CLAUDE.md 中过时的 md5 值

---

### F6 🟡 标准 7 源文件缺位

**位置**: FINAL-REPORT §一 标准 7；磁盘核验

**问题**: FINAL-REPORT 标准 7 宣称"tree-iterative-development 终版 v1.4"——但该 SKILL 文件仅存在于部署目标 `.proma-pro/skills/`，不存在于 tree-harness 源目录 `skills/`。

**证据**:
```bash
# 磁盘核验结果
$ ls D:/Codes/tree-harness/skills/
session-management/ tree-auditor/ tree-commander/ tree-worker/
# tree-iterative-development/ 目录不存在

$ ls C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/
... tree-iterative-development/SKILL.md (v1.4, 存在) ...
```

> CLAUDE.md:17: "🔴 权威源 = D:/codes/tree-harness/（2026-07-09 源码统一后确立）"

> CLAUDE.md §3 部署口诀: "skills/* → ~/.proma-pro/agent-workspaces/default/skills/（pro commander 真实 workspace；SKILL 文件级即生效）"

tree-iterative-development SKILL.md v1.4 的内容质量是好的（§1.1 含 macp3-11 九轮迭代实证表，§10.1 进度快照完整），CLAUDE.md §9 文件索引甚至列出了 `skills/` 应含此文件。问题纯粹是**源文件未创建**——部署到了 Proma workspace 但源码目录未同步。

**后果**:
- CLAUDE.md 的"权威源=tree-harness/"原则被违反：源目录缺少一个 SKILL 文件
- git 仓库中缺失此文件——未来 clone 后无法从源重建部署
- FINAL-REPORT 标准 7 "tree-iterative-development 终版"技术上成立（文件存在且内容完整），但交付不完整（源端缺失）

**修复建议**:
- `mkdir -p D:/Codes/tree-harness/skills/tree-iterative-development && cp` 从 Proma workspace 同步回源
- `git add + commit` 到 release-0.13.16-hardening 分支

---

### F7-F9 🟢 GREEN 确认项

**F7 audit_log schema severity v0.21**:
- 6 项改进中唯一引擎层硬约束，强制 `severity ∈ red|yellow|green`
- 符合 v0.17.1 "引擎硬拦"方向
- 有 macp10/11 实战验证（X-audit results[] 每项含 severity 零撞击）
- **局限**: 覆盖面窄（仅 audit_log 一个字段的枚举校验），不足以扭转教化为主（5/6）的整体格局

**F8 idle 多维核验 + CLI 兼容通道**:
- 解决 macp6（J 误判 prune）和 macp11（root idle 复发）两次真实事故
- macp11 results.md §3 验证 CLI 兼容通道成功代调 J1/S1 milestones+audit_gate
- **局限**: 本质是操作流程（CLI 应急 + idle 判断经验），非引擎预防（root idle 根因——模型切换丢 MCP 工具——未被修复）

**F9 §13.3b 多层级 done 协议**:
- macp10/macp11 两次实战零 V10 撞击，有明确验证证据
- 解决 macp4-6 暴露的 V10 多层级张力
- **局限**: 纯 SKILL 协议层（0 引擎改动），依赖 GLM commander 遵守约定——这正是 v0.17.1 判定不可靠的模式

---

## 四、该维度对 FINAL-REPORT 真实完成度的结论

### FINAL-REPORT 宣称与核验结论对照

| FINAL-REPORT 标准 | 宣称状态 | D1 核验 | 说明 |
|---|---|---|---|
| 1. P0 接力协议 + idle 多维核验 | ✅ | 🟡 部分达成 | 协议本身有效且经验证，但纯 SKILL 教化（0 引擎改动），与 v0.17.1"引擎硬拦"方向相悖 |
| 2. audit_log severity + auditor ≥2 events + emergent | ✅ | 🟡 部分达成 | v0.21 引擎变更是唯一硬约束（方向正确），但其余为教化 |
| 3. segment_add 评估 | ✅ | 🟢 达成 | 三方案论证完整，A3 本轮落地合理 |
| 4. 项目层 4 缺陷 + C1 85+ | ✅ | 🔴 非 harness 交付物 | multi-agent-collab-platform 应用层指标，非 tree-harness 改造产出 |
| 5. C1 复评 85+ MiniMax 签字 | ✅ | 🔴 非 harness 交付物 | 同上，是测试底座应用的评估 |
| 6. 综合实战验证 | ✅ | 🟡 部分达成 | macp7-11 实战验证真实，但验证的是操作协议改进，非 CLAUDE.md 核心铁律 |
| 7. tree-iterative-development v1.4 + 归档 | ✅ | 🟡 源文件缺位 | 内容完整但源目录缺失文件，git 仓库不完整 |

### 真实完成度

- **该维度宣称 7/7 真实达成: 3/7**（标准 3/6/7 的核心意图基本达成；标准 1/2 部分达成但方向偏；标准 4/5 不应计入 harness 完成标准）
- **过度宣称**:
  1. 以操作协议改进宣称覆盖了 CLAUDE.md 的 P0 铁律需求（macp2 五铁律/nanju 四铁律零覆盖）
  2. 以 1 项引擎变更(v0.21)宣称对齐了 v0.17.1"必须引擎硬拦"方向（实际 5/6 纯教化）
  3. 以测试底座应用指标（C1=86）充填 harness 自身完成标准（标准 4/5）
- **遗漏**:
  1. SubAgent 成本爆炸预防（macp2 五铁律）——CLAUDE.md 首条 P0
  2. brief 审计义务钉死（nanju 四铁律）——CLAUDE.md 第二条 P0
  3. review_round 引擎强制溯源——v0.17.1 核心诉求
  4. 部署运维文档化——CLAUDE.md 高频出错区
  5. 源文件 git 完整性（tree-iterative-development SKILL 源端缺失）

---

## 五、Roadmap 贡献

### P0（阻断级——FINAL-REPORT 若未修正则误导未来 Agent）

1. **FINAL-REPORT 诚实标注覆盖边界**：在 §一 增加"未覆盖的 CLAUDE.md P0 铁律"章节，列出 macp2 五铁律/nanju 四铁律/v0.17.1 引擎硬拦/运维需求——当前 7/7 宣称已覆盖但实际未触及
2. **标准 4/5 重新分类**：从"harness 完成标准"移至"测试底座验证"独立章节，harness 完成标准聚焦于 tree-harness 自身交付物
3. **review_round 引擎溯源列入 P0 roadmap**：v0.17.1 的核心诉求（reviewer_kind 强制 subagent + reviewer_ref 溯源 subagent_spawn）不能无限期停留在"已记 memory"

### P1（高优——下次迭代优先修）

4. **macp2 五铁律嵌入 tree-commander SKILL §1**：当前 §1 五铁律是树操作纪律，需新增 SubAgent 成本纪律铁律
5. **nanju 预防措施引擎化**：tree_init 时预检 `root_dod.self_check` 是否含 "auditor" 关键词（warning 级别）
6. **tree-iterative-development 源文件创建**：`mkdir + cp + git add`，补齐 git 仓库完整性

### P2（中优——持续改进）

7. **运维知识从 CLAUDE.md 迁移到 SKILL/文档**：部署口诀 + pro 测试要点 → tree-iterative-development SKILL 或独立运维文档
8. **CLAUDE.md md5 值更新**：tree-engine md5 标注已过时（1f05baa7 vs 3e10bf8e）
9. **引擎硬拦比例提升**：下次迭代目标至少 50% 改进为引擎层（vs 当前 1/6=17%）
