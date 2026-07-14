# Tree-Harness 待改进报告（逻辑不自洽 + 设计问题 + 优先级）

> 维护：周星星 | 产出：2026-07-09 会话 bbdefd1e（5 路 SubAgent 并行深读 + 父会话交叉印证）
> 配套文档：[design-files-mapping-2026-07-09.md](./design-files-mapping-2026-07-09.md)（设计文件结构映射/缺口）

---

## 〇、关键状态修正（父会话交叉印证，请先读）

5 路 SubAgent 基于各自读取的文档得出的结论，经父会话交叉比对，发现 **3 处状态声明冲突**，现修正如下（避免后续工作误判）：

### ✅ 修正 1：BUG-2（leaf_add caller-binding）实际「已解决」，非「待修」

- **SubAgent D/E 判定**：🔴 未解决（依据：`CLAUDE.md` 末段 + `audtest-test-materials-2026-07-09` 上午 10:06 + `handoff-post-audtest`）。
- **父会话核实**：`workspace-files/.context/note.md` 顶部（07-09 下午 harness 效率评估会话 `4fee5a45`）明确记录——
  - leaf_add caller-binding 已修复（3 处）+ set-status/milestone-add caller-binding（6 处）= 9 处，已部署 pro dist（备份 `.bak-pre-leafadd-caller-binding-20260709`）。
  - **pro 实证验证（17:00）**：探针 2 攻击 leaf_add（added_by=observer，caller=commander）→ `E_BORROWED_IDENTITY [P1-cmdLeafAdd-caller-binding]` 精准拦截，且不误伤合法 add。
  - **全面验证 vcb2（18:20-18:35）**：caller-binding 全分支 + §13 done 八步端到端全通，攻击拦截精准、owner/creator 放行无误伤。
- **真实结论**：BUG-2 **已于 07-09 下午修复并 pro 实证**。CLAUDE.md / audtest 材料 / handoff / tree-harness 版 note.md 标「待修」是**文档失同步**（这些文档停留在 07-09 上午或更早），非代码漏洞未修。→ 归入问题 **P1-D03 文档失同步**。

### ⚠️ 修正 2：存在两个并行、部分漂移的 `.context`

- `D:/codes/tree-harness/.context/` 与 `~/.proma/.../workspace-files/.context/` 的 `PROJECT-INDEX.md`、`待解决问题清单.md` md5 一致，但 **`note.md` 不同步**：tree-harness 版最新条目停在 **07-07**，workspace 版已到 **07-09**。
- SubAgent E 读的是 tree-harness 版，得出「note 落后实际 2 天」——这只对 tree-harness 版成立；workspace 版其实已更新。
- **结论**：这不是「note 忘更新」，而是「两个知识库在漂移」。→ 归入问题 **P1-D04 双 .context 治理**。

### ⚠️ 修正 3：TaoWatcher「0 触发」结论需限定场景

- SubAgent D/E 引用「TaoWatcher 0 真价值触发」，依据是 macp4-A4（auditor 错配场景）+ macp2/3/4。
- **父会话核实**：note.md vcb2 验证（07-09 18:20）记录 TaoWatcher **多次触发**（W-01 首条无 brief_echo ×2 + W-08 leaf purity 违规 ×2），证实 TaoWatcher 在 pro **确实运行**。macp2/3/4 的 0 触发是「leaf 合规/规则没命中」而非「watcher 没跑」。
- **结论**：TaoWatcher 不是「完全没产出」，而是「auditor 错配场景下大量假阳性 + 正常 worker 场景产出待统计」。P0b 收窄（删 6 条高噪音规则）已让假阳性 24-38→0。

---

## 一、摘要：三类系统性问题

综合 5 路发现，tree-harness 的问题可归为三大类：

1. **设计层**：约束体系存在「同构盲区」（只覆盖 tree 内合规路径，对 create_session 旁路无效）；门禁之间存在「互相架空链」；role 三分类不全（auditor role 端到端不可用）。
2. **文档层**：文档与引擎大面积失同步（行数/错误码/工具数/BUG 状态）；散落 + 命名冲突（BUG-2 同名两漏洞、wiki 两版）；两个 `.context` 漂移；产品设计文档（PRD/类图/时序图/team-config）缺位。
3. **方法论层**：「形式完整 ≠ 内容有效」原则未推广到方法论自身（大量「死的硬约束」）；缺预算护栏与人类 checkpoint；SubAgent 调用形式等关键纪律靠事故驱动补丁式沉淀。

---

## 二、逻辑不自洽清单（跨文档矛盾 / 状态冲突）

| 编号 | 矛盾点 | 证据 A | 证据 B | 影响 |
|---|---|---|---|---|
| **L-01** | BUG-2 状态 | CLAUDE.md/audtest/handoff 标「待修」 | note.md（workspace 版）记「已修+pro实证」 | 交接误判漏洞状态，重复劳动 |
| **L-02** | BUG-2 命名冲突 | SECURITY §3.6「BUG-2=leaf_add session_id唯一性（已修）」 | CLAUDE「BUG-2=leaf_add caller-binding」 | 同名两漏洞，审计混淆 |
| **L-03** | 行数/错误码数 | ARCHITECTURE/API「3602行/2658行/21校验/37错误码」 | 实测 4879/3098 行/42 错误码 | 基础元数据全线失真 |
| **L-04** | 防御拓扑维度 | ARCHITECTURE §6「五层洋葱」 | §7「三层防御」+ layer1/layer2 两套独立防御 | 读者无法判断攻击向量归哪层 |
| **L-05** | wiki 两版 | 顶层 proma-dev-wiki「插件工具 10 个」 | .context/proma-dev-wiki（73KB）53 工具 | 顶层版严重误导 |
| **L-06** | 定位摇摆 | README「AI 军队指挥系统」(产品) | 使用场景「提交给 Proma 团队的功能参考」(上游补丁) | 该当工具/产品/方法论不清 |
| **L-07** | caller-binding「全链路」 | note.md 07-07「攻击重放 12/12 全链路生效」 | 07-09 发现 leaf_add 是漏网之鱼（后已修） | 「全链路」声明不成立 |
| **L-08** | TaoWatcher 运行状态 | note.md 07-03「active=false」 | 07-09 vcb2 多次触发 | 当前 active 状态需核实 |
| **L-09** | P0-2 audit_gate 死锁真因 | 中期评审 07-04「引擎三重死锁」 | repro 07-07「引擎完备，SKILL 协议误用」 | 正式文档若仍写「引擎问题」即过期 |
| **L-10** | 双 .context note.md | tree-harness 版（停 07-07） | workspace 版（到 07-09） | 两个知识库漂移 |
| **L-11** | auditor role 记录 | note.md 完全无此条目 | 07-08 已引入 auditor role（commit 3852c61） | 核心机制未回灌知识库 |
| **L-12** | 频道稳定性 | note.md 06-18「GLM 最稳」 | note.md 07-07「DeepSeek 更稳」 | 未统一口径 |
| **L-13** | leaf_add 约束文档 | API.md §4.2 未提 added_by 校验 | 引擎 L899-933 有 added_by 树内校验 | Agent 写契约时不知 added_by 约束 |

---

## 三、设计问题清单（按严重度）

> 状态图例：🔴 未解决 ｜ ⚪ 部分修复 ｜ 🟡 已规避（软约束） ｜ 🟢 已解决

### P0 — 阻断级 / 已造成实际损失

| 编号 | 问题 | 类型 | 根因 | 状态 |
|---|---|---|---|---|
| **P0-S01** | 约束同构盲区：caller-binding/TaoWatcher/预算护栏只覆盖 tree 内合规路径，create_session 旁路完全不可见 | 约束盲区/成本失控 | tree engine 与 Proma SDK 间无 SubAgent/会话创建回调；约束都在 `mcp__tree__*` 入口 | 🟡 已规避（startup_notice 红线 + 软护栏，非真修复） |
| **P0-S02** | SubAgent 调用形式未钉死 + 无收敛条件（macp2 根因，4 分钟炸 207 会话，DeepSeek 额度打负） | 成本失控/文档失同步 | 设计假设「SubAgent=廉价进程内」未在 SKILL 钉死、未验证、无收敛条件 | 🟢 已解决（07-08，SKILL §13.5/§4.6 红线 + node_budget 硬上限 + 90/90 测试绿）— 但 P0-S01 根盲区未根治 |
| **P0-S03** | done event 自动同步 status 架空全部 done 门禁（中期评审总崩点） | 逻辑不自洽/安全漏洞 | cmdEventAppend 原行 1945-1953 `if done→status=done`，门禁集中在另一入口 | 🟢 已解决（07-04，删自动同步 + collectValidateIssues，P0-1 专项 4/4） |
| **P0-S04** | audit_gate 三重死锁（中期评审 P0，后被 repro 推翻为 SKILL 协议误用） | 设计缺陷 | 引擎闸门2 完备，真因是 SKILL §6 教错 auditor 路径 | 🟢 已解决（07-07，SKILL §13 冷启动信任锚，引擎无需改） |
| **P0-D01** | Layer 2（项目主体，80% 代码）零用户场景，实现自证需求 | 产品设计缺位 | 走「实战驱动」路径，从未做 PRD 正向设计 | 🔴 未解决 |
| **P0-D02** | 无 team-config（角色↔模型↔工具↔成本矩阵）— macp2 直接根因之一 | 方法论缺位 | 角色定义强但无统一团队配置文档 | 🔴 未解决 |
| **P0-D03** | tree-engine.cjs/patches.cjs 多版本不同步（CLAUDE.md「git源=pro md5一致」声明不成立） | 源码治理/文档失同步 | tree-engine 4版/patches 6版，最新分散（engine在WS、patches在PRO） | ⚪ 部分修复（07-09 晚：TH 已确立为权威源，汇聚最新内容 md5 42ba5d51/cbc0f133，CLAUDE.md 口诀已改；遗留 WS废弃/release同步/旧副本清理待决策） |

### P1 — 严重级

| 编号 | 问题 | 类型 | 根因 | 状态 |
|---|---|---|---|---|
| **P1-S01** | 状态机零流转校验 + tao-watcher 绕过 MCP 直改 tree-state | 设计缺陷 | 原 setStatus 无流转白名单；watcher 在 patches.cjs 直改文件 | ⚪ 部分修复（07-07 加 STATUS_TRANSITION_RULES；watcher MCP 化未做） |
| **P1-S02** | autonomy_overrides 死字段（写而不读，零约束力） | 设计缺陷/逻辑不自洽 | 字段写入但全引擎无消费点（2026-07-11 grep 确认：cmdLeafAdd L1054 初始化 + leaf_autonomy_override 工具 L1825 写入，零读取） | ⚪ 已标注待决策（tree-engine L1825 加死字段警告注释；删除字段 vs 实现限权消费待决策） |
| **P1-S03** | ISS-003 done 门禁不耦合内容审查（worker 多子Agent 自审可绕过） | 约束盲区 | done 不校验审查收敛证据，worker 自报 self_check 即可 done | ⚪ 部分修复（阶段一 13/13；**阶段二务实最小集 2026-07-14：flagged 动态化**——新增 isFlagged 从 events 计算，堵「新 leaf done-未审不阻断下游」gap，防篡改 review_evidence.flagged 字段；cmdReviewRound/Layer2/R-08 未做，events 自写性根本限制下 ROI 低） |
| **P1-S04** | P0a auditor role 完整 done 路径不可用（audtest 端到端失败） | 设计缺陷/环境耦合 | caller-binding 要求 auditor 自调 done + Proma fork identity timeout 叠加，无协议级 fallback | 🔴 未解决（设计正确，需 Proma 修 fork 或 SKILL 加 fallback） |
| **P1-S05** | TaoWatcher auditor 错配场景假阳性（安全剧场） | 约束盲区/成本失控 | role 三分类无 auditor → 规则误套；audit_log 不区分来源 | ⚪ 部分修复（07-09 P0b 删 6 规则，假阳性 24-38→0；正常场景待统计） |
| **P1-S06** | leaf_add 报错未事务回滚，幽灵 leaf 污染 active_count（BUG-B） | 逻辑不自洽 | cmdLeafAdd 报错路径无完整回滚 | ⚪ **待重新核实**（2026-07-11 代码审查 cmdLeafAdd L816-1070：所有 throw 在 push L1064 前，push/writeState 间无 throw，**cmdLeafAdd 本身无事务问题**；幽灵 leaf 疑 fork 副作用，见 BUG-REGISTRY） |
| **P1-D01** | 文档与引擎大面积失同步（行数/错误码/工具数/BUG 状态） | 文档失同步 | 4 处文档各自维护，引擎改动后同步靠人工 | 🟡 已规避（CLAUDE.md 自述 P0 高发区，但未治理） |
| **P1-D02** | 错误码字典不全（API 37 vs 引擎 42，缺 E_SESSION_NOT_ALIVE/E_NO_OWNERSHIP） | 文档失同步 | 错误码未从引擎常量自动生成 | 🔴 未解决 |
| **P1-D03** | BUG-2 同名两漏洞 + 多文档状态不一致 | 文档失同步/命名冲突 | BUG 编号无全局唯一性 | 🔴 未解决（见 L-01/L-02） |
| **P1-D04** | 双 `.context` 漂移（note.md 两版本） | 文档治理 | 两个并行知识库无统一 | 🔴 未解决（见 L-10） |
| **P1-D05** | 架构类图/时序图/formal schema 缺失 | 架构文档缺位 | 用 ASCII 图替代形式化产物 | 🔴 未解决 |
| **P1-M01** | 审计树 §14 结构整章失效（nanju 实战 0 个独立审计 leaf） | 方法论↔实现 gap | 方法论先行、引擎滞后（role=auditor 7/8 才补） | ⚪ 部分修复（P0a 补 role，但 P1-S04 端到端不可用） |
| **P1-M02** | workflow 缺失致 commander 行为不可预测（冷启动信任锚流程滞后） | 方法论缺位 | 协议滞后于引擎能力 | 🟢 已解决（07-07 SKILL §13 补信任锚流程） |
| **P1-M03** | 无预算护栏文档（会话数/subagent/轮数硬上限） | 方法论缺位 | 重质量门轻成本门 | 🟡 已规避（SKILL v2.5 软约束，引擎硬护栏落地状态待确认） |
| **P1-M04** | 无人类 checkpoint（macp2/macp4 用户上线才发现） | 方法论缺位 | 无人类审查者角色 | 🔴 未解决 |
| **P1-M05** | 「形式≠内容」原则未推广到方法论自身（大量死的硬约束） | 方法论自指盲区 | V10 原则只用于引擎校验 | 🔴 未解决 |

### P2 — 中等级

| 编号 | 问题 | 状态 |
|---|---|---|
| **P2-S01** | 数值收敛≠内容收敛（review_round 假收敛，red 降 yellow 蒙混） | ⚪ 部分修复（07-09 P1b fix_evidence 加 red_findings_resolved 跨事件校验） |
| **P2-S02** | 5 件套契约未持久化 + milestone_add 从未被调用（done 门禁形同虚设） | 🔴 未解决 |
| **P2-S03** | drift_log 留痕不一致（set-session/migrate/restore 不写 drift，幽灵 archive） | 🔴 未解决 |
| **P2-S04** | ctx 全 0，竹节交接永不自动触发（心跳不集成 get_session_context） | 🔴 未解决 |
| **P2-S05** | commander 竹节交接不继承 worker ownership（ISS-006） | 🔴 未解决 |
| **P2-S06** | 越权创建不可逆 + 无修复工具（逼 root 直改 tree-state 违反铁律#1） | 🔴 未解决 |
| **P2-S07** | leaf_add caller-binding 路径（已于 07-09 修复，见修正 1） | 🟢 已解决 |
| **P2-D01** | 场景文档过期（使用场景/时间线剪枝者停在 v0.10，49 工具 vs 10 工具） | 🔴 未解决 |
| **P2-D02** | 定位摇摆（补丁/产品/方法论三说） | 🔴 未解决 |
| **P2-D03** | 安全投入缺 PRD 级 ROI 论证（中期评价「过度设计」） | 🔴 未解决 |
| **P2-D04** | 产品成功指标完全缺位（研发完成度≠产品成功） | 🔴 未解决 |

### P3 — 低级

| 编号 | 问题 | 状态 |
|---|---|---|
| **P3-S01** | 命名正则漏洞（LEAF_NAME_RE 第3捕获组 \w+ 非枚举，A1w/A1r 合法） | 🔴 未解决 |
| **P3-S02** | W-01 通道不互通（mcp event vs 文本 YAML） | 🔴 未解决 |
| **P3-S03** | ISS-010 audit_log_integrity 历史脏数据 316 处 | ⚪ 部分修复（新增已堵，历史待清理） |
| **P3-S04** | root archive 特权（active→archived 跳过 done/validate） | 🔴 未解决（疑有意设计，需文档化） |
| **P3-S05** | 时区表示不统一（nudge_log UTC vs events +08:00） | 🔴 未解决 |
| **P3-S06** | tree_id 命名不一致（init 允许连字符，leaf_add 禁） | 🔴 未解决 |

---

## 四、系统性根因（5 聚类）

23 条安全/设计问题 + 13 条逻辑不自洽，按根因聚类为 5 类。**修单点不如治根因**：

### 聚类 A —「约束只覆盖合规路径，旁路不可见」（最致命）
- **成员**：P0-S01（create_session 盲区）、P1-S01（watcher 绕过 MCP）、P2-S06（越权不可逆无工具）、P3-S02（W-01 通道不互通）、L-07（caller-binding 全链路声明）、L-13（leaf_add 约束文档）
- **根因**：tree engine 与 Proma SDK 之间无双向契约（无 create_session 回调、无 session 身份强绑定、watcher 在 patches.cjs 直改文件）。所有约束都在 `mcp__tree__*` 入口校验，agent 用 SDK 原生能力旁建/旁写时引擎零感知。
- **本质**：**约束只能约束走协议的人，约束不了不走协议的人**——这是「代码强制约束」架构的根本盲区。
- **根治方向**：平台层 `subagent_trace_id` + capability-based 工具调用 + event hash chain（SECURITY.md §4.3 远期路线，需跨仓）。

### 聚类 B —「门禁之间互相架空 / 协议编队不可达」
- **成员**：P0-S03（done event 架空门禁，已修）、P0-S04（audit_gate 死锁，已修）、P1-S03（done 不耦合内容审查）、P1-S04（auditor done 路径不可用）、P2-S02（5 件套未持久化 milestone 门禁形同虚设）
- **根因**：门禁堆栈假设「协议编队可达」，但实际存在多条 status 写入入口、信任锚未落地、fork session 不可靠、milestone 工具从未被调用。
- **本质**：**门禁越多 ≠ 越安全，关键是门禁之间不能有绕过链，且每个门禁前置必须真可达**。中期评审「最严重漏洞修复成本最低（删一行）」即此警示。
- **根治方向**：每个门禁前置做可达性验证；状态写入单一入口；协议死锁期给合规降级路径（非逼违规）。

### 聚类 C —「role 分类不全 + 规则按字符串/计数误判」
- **成员**：P1-S02（autonomy_overrides 死字段）、P1-S05（TaoWatcher 假阳性）、P2-S01（数值≠内容收敛）、P3-S01（命名正则漏洞）
- **根因**：role 三分类（root/commander/worker）覆盖不全；TaoWatcher 用 leaf_id 关键字 + 计数匹配语义合规；约束用形式指标（UUID 格式/关键词/red_count）代替语义判断。
- **本质**：**形式合规必然被 agent 用形式合规绕过**。
- **根治方向**：auditor role 已落（P0a）但端到端不可用（P1-S04）；引入声明式 workflow_type（build/audit/integration）让规则按 type 适配。

### 聚类 D —「文档与引擎失同步」（高频 P0 来源）
- **成员**：L-01~L-05、L-09~L-13、P1-D01~D05、P2-D01、P3-S03
- **根因**：SKILL/SECURITY/CLAUDE/note.md/ARCHITECTURE/API 五处文档各自维护；引擎改动后同步靠人工；BUG 编号无全局唯一性；两个 `.context` 漂移。
- **本质**：CLAUDE.md 自述「文档引擎一致性 P0 高发区」——历次审计抓出的 P0 多为此类。
- **根治方向**：错误码/字段从引擎常量自动生成文档；BUG 全局注册表；统一 `.context` 为单一真相源。

### 聚类 E —「成本失控无硬护栏」
- **成员**：P0-S01、P0-S02（macp2 成本爆炸）
- **根因**：设计假设「SubAgent=廉价进程内」未验证；Proma 原生 spawn=真实会话=钱；无角色数/轮数/会话数硬上限；撞错后换名重试无刹车。
- **本质**：**重质量门轻成本门**。
- **根治方向**：CLAUDE.md P0 教训已沉淀（5 条铁律），team-config + cost-guardrails 需成文（P0-D02），SDK 监控盲区（聚类 A）未根治。

---

## 五、优先级与推进路径

### 5.1 Top 7 优先级（综合 可独立性 + 损失史 + ROI）

| 排序 | 编号 | 问题 | 理由 | 工作量 |
|---|---|---|---|---|
| **1** | P1-S02 | autonomy_overrides 死字段 | 「写而不读」= 零约束力硬伤；低成本高诊断价值（若重构丢失则关联其他门禁漏洞） | 小（grep + 排查） |
| **2** | P1-S06 | leaf_add 事务回滚（BUG-B） | 越权写 tree-state + 幽灵 leaf 污染预算；修复点已知 | 小 |
| **3** | P1-D01/D03/D04 | 文档治理三件套（错误码自动生成 + BUG 注册表 + 统一 .context） | 系统性根因（聚类 D），防未来复发，每次审计都踩 | 中 |
| **4** | P1-S04 | auditor role 端到端 fallback | 解锁已投入的 P0a/P0b；SKILL 加 fallback 可短期落地 | 中 |
| **5** | P0-D01/D02 | Layer2 用户场景 + team-config | 补齐项目主体 80% 代码的「为什么」+ macp2 根因之一 | 中（文档为主） |
| **6** | P1-S05 | TaoWatcher 正常 worker 场景正负案例统计 | 收窄后（P0b）价值待验证，决定「保留/重设计/砍掉」 | 中 |
| **7** | P0-S01 | 约束同构盲区（create_session 旁路） | 最致命但有经济损失史；根治需跨仓，短期单边方案可降风险 | 大（跨仓） |

> 注：BUG-2（原 Top1 候选）已修正为「已解决」，故不在 Top7；P0-S03/S04 已解决亦不在列。

### 5.2 推进路径建议（三档）

**🟢 立即可做（1-3 天，无需决策）**
- P1-S02 grep 核实 autonomy_overrides 消费点（丢失则修，从未实现则删字段）
- P1-S06 leaf_add 报错路径加事务回滚
- P1-D03 BUG 命名冲突清理（BUG-2 重命名）+ CLAUDE.md 同步 BUG-2 已修
- P1-D04 统一两个 `.context`（短期：写同步脚本；长期：tree-harness 为唯一源）
- L-03 行数/错误码元数据校正（或删除具体数字）

**🟡 需用户决策（讨论后推进）**
- P1-S04 auditor fallback 方案（A SKILL 放开 / B 等 Proma 修 fork / C root 代调）—— audtest 留了 A/B/C 选项待定
- P1-S05 TaoWatcher 命运（保留补可观测 / 重设计 / 砍掉减负）
- P0-D01/D02 产品设计文档补建的优先级与范围（是否现在做 PRD 正向设计）
- P2-D03 安全投入 ROI 论证（是否补 threat-model-justification，回答「21 DbC 是否过度」）

**🔴 需跨仓/长期（Proma SDK 协同）**
- P0-S01 约束同构盲区根治（subagent_trace_id + create_session 回调 + capability-based 调用）
- P1-S01 tao-watcher MCP 化（watcher 不再直改 tree-state）
- P1-M04 人类 checkpoint 机制（定义人类审查者在树形体系中的角色）

---

## 六、附录：note.md 独家发现速查（SubAgent E 提炼）

> 以下信息**仅存在于 note.md，未进入任何正式文档**，对后续工作有高参考价值：

| # | 发现 | 类型 | 证据 |
|---|---|---|---|
| 1 | root 自调走闸门2 当 auditor 可全程走通（推翻中期评审「引擎死锁」判断） | 设计决策 | note 07-07 P0-2 |
| 2 | pro 用 `.proma-dev` userData，SKILL 同步要 3 处（dev/release/pro） | 已知坑 | note 07-07 多条 |
| 3 | DeepSeek 执行 SKILL 有波动（同 SKILL 一次 1 错一次 7 错），需多次 run 取中位数 | 已知坑 | note 07-07 |
| 4 | dist 部署 = cp 即生效，无需构建（迭代门槛极低，易把不稳定 engine 推 Pro） | 技术细节 | note 07-07 |
| 5 | 0.13.16 跨版本迁移 5 个关键坑（CRLF/sed 非唯一/补丁F跳过/补丁B用12函数版/asar extract） | 已知坑 | note 06-27 |
| 6 | 官方 session 能力只给 UI 用，agent 调不到 → 自研 22 工具必须整体保留 | 设计决策 | note 06-27 |
| 7 | automation 建会话不经 patches handler → R5 必须用 sourceAutomationId 识别（非 triggeredBy） | 已知坑 | note 06-27 |
| 8 | session-cleaner v2.0.0 SKILL 误导（调不存在的 proma 命令），v1.0.0 才可用 | 已知坑 | note 07-03 |
| 9 | caller_session_id 记的是会话目录 ID 非 agent session_id（影响安全归因精度） | 隐含待办 | note 07-03 |
| 10 | P1b fix_evidence / auditor role / macp2 教训 / P0a —— 均未回灌 note.md | 文档失同步 | note 缺失 vs active/07-08 |

---

## 七、给「系统性推进」讨论的锚点

本报告 + 配套的 [design-files-mapping](./design-files-mapping-2026-07-09.md) 已把 tree-harness 的「设计文件缺口」与「设计问题」全貌摊开。建议系统性推进时围绕**三个核心抉择**展开：

1. **文档治理 vs 功能加固，先做哪个？**
   - 文档治理（聚类 D）是每次审计的 P0 来源，ROI 高且防复发；但纯治理无新能力产出。
   - 功能加固（聚类 A/B/C）能提升系统真实安全性，但工作量大、部分需跨仓。

2. **产品设计正向补建，是否现在做？**
   - tree-harness 80% 代码（Layer 2）无 PRD，长期「自证需求」。补 Layer2 场景 + 成功指标能矫正方向，但会暂停加固工作。

3. **TaoWatcher 与 auditor role 的命运**
   - 两者都「投入了但端到端不可用/产出存疑」。是补可观测性救活，还是承认沉没成本砍掉减负？

> 期待与你就上述抉择 + Top7 优先级讨论推进方案。
