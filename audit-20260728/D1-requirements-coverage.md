# D1 需求覆盖审计报告 — Tree Harness FINAL-REPORT vs 源头需求

> **审计类型**: 需求覆盖度独立审计（对抗性）
> **审计者**: audit-D1-commander (Proma Agent)
> **日期**: 2026-07-28 11:33 GMT+8
> **被审对象**: `pr/20260728-harness-final/FINAL-REPORT.md` (harness 开发最终完成报告)
> **源头需求文档**:
> - `CLAUDE.md` (105 行, ~19455 字) — 项目知识库, P0 教训, 部署/测试规范
> - `ARCHITECTURE.md` — 三层架构 + 三开环境拓扑 + 不可重构建铁律
> - `SECURITY.md` — DbC + Trust Anchor + 三层防御拓扑 + 威胁模型
> - `API.md` — 53 MCP 工具参考
> - `BUG-REGISTRY.md` — 已知缺陷全局注册表
> - `README.md` — 项目入口 + v0.17.0 私有化发布
> - `skills/tree-commander/SKILL.md` v2.9.7 §0-§1
> - `skills/tree-worker/SKILL.md` v2.5 §0-§1
> - `skills/tree-auditor/SKILL.md` §0-§1

---

## 一、总体判定

```yaml
overall_verdict: "FINAL-REPORT 过度宣称"
confidence: high
summary: |
  FINAL-REPORT 声称 7/7 完成标准全部达成，但经逐条与 CLAUDE.md 源头需求比对，
  发现多项关键遗漏和过度宣称:
  
  1. FINAL-REPORT 聚焦于 "Harness 开发" (macp7-11 SKILL 改进 + 项目层缺陷修复)，
     但 CLAUDE.md 作为"删掉后未来 Agent 会犯错"的项目知识库，其 P0 教训的核心诉求
     是引擎层硬约束（非 SKILL 教化）。FINAL-REPORT 6 项核心改进中 4 项为纯 SKILL 层，
     仅 1 项 (v0.21 severity) 为引擎变更。
  
  2. CLAUDE.md 中至少 5 大类需求在 FINAL-REPORT 中完全未被提及或覆盖。
  
  3. 7/7 标准中有 2 项为非树引擎交付物（标准 4 项目层、标准 5 C1 复评），
     1 项无法核实（标准 7 SKILL v1.4 文件不存在于磁盘）。
```

---

## 二、需求-实现映射表

### 2.1 CLAUDE.md P0 教训覆盖

| # | CLAUDE.md 需求 | FINAL-REPORT 声称覆盖 | 实际状态 | Severity | 证据 |
|---|---|---|---|---|---|
| P0-1 | **闭环三要件**：即时/可定位/人验证最后一跳 | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L7-14 以"第一性原理"定义闭环三要件为 Agent 工程核心。FINAL-REPORT 未将 6 项改进映射到这三要件，无法判断闭环完整性。v0.21 severity 强制可算"可定位"，但"即时"（append 即校验）和"人验证最后一跳"无对应。 |
| P0-2a | **macp2 铁律 1**: SubAgent = 进程内 Agent 工具，给调用示例 | §3.5 "emergent v2 协作教化" | 🟡 **部分覆盖** | YELLOW | CLAUDE.md L29-31 要求 SKILL 显式指定进程内 Agent 工具并给可复制示例。FINAL-REPORT §3.5 是 v2 能力精化（event_append + leaf_get + 写报告），未涉及 SubAgent 调用形式。但 worker SKILL startup_notice (L17-22) 有相关教化。 |
| P0-2b | **macp2 铁律 2**: 严禁 create_session/fork_session 当 reviewer | §3.5 "emergent v2 协作教化" | 🟡 **部分覆盖** | YELLOW | worker SKILL startup_notice 有禁令，但 FINAL-REPORT 未验证 macp2 事故是否会在 harness 改进后重演。 |
| P0-2c | **macp2 铁律 3**: 收敛条件（角色上限 2/3/5 + 轮数 ≤3 + red_count=0 停止） | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L32 要求收敛条件必须有。FINAL-REPORT 未提及任何收敛条件改进。 |
| P0-2d | **macp2 铁律 4**: 预算护栏（max_sessions, max_subagent_spawn 硬上限） | 未提及 | 🟡 **间接覆盖** | YELLOW | CLAUDE.md L33。引擎已有 E_SUBAGENT_BUDGET_EXCEEDED 和 max_sessions。FINAL-REPORT 未验证这些护栏在 harness 改进后仍有效。 |
| P0-2e | **macp2 铁律 5**: Proma 心智模型（spawn=真实会话=钱） | 未提及 | 🟡 **间接覆盖** | YELLOW | worker SKILL startup_notice L20-21 提及，但为既有教化非新改进。 |
| P0-3a | **nanju 铁律 1**: 产出类文档默认 review_required=true | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L48。FINAL-REPORT 未提 review_required 默认策略改进。 |
| P0-3b | **nanju 铁律 2**: auditor 硬 DoD，禁"可选"措辞 | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L49。FINAL-REPORT 未审核 brief 模板是否消除了"可选"措辞。 |
| P0-3c | **nanju 铁律 3**: brief checklist（3 项） | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L50-53。FINAL-REPORT 未提 brief checklist 机制。 |
| P0-3d | **nanju 铁律 4**: prefix 命名 ≤8 字符 | 未提及 | 🟢 **已在引擎层** | GREEN | CLAUDE.md L54。引擎 leaf_add 已校验 LEAF_NAME_RE（大写字母开头），E_NAME_INVALID 存在。 |
| P0-4 | **v0.17.1 GLM 教化无效必须引擎硬拦** | 未直接提及 | 🟡 **部分覆盖** | YELLOW | CLAUDE.md L58-64。v0.18 E_REVIEW_SESSION_FORBIDDEN predates harness work (2026-07-16)。FINAL-REPORT 未新增引擎层 anti-forgery 加固。§3.5 "emergent v2 协作教化" 本身仍是教化方案，与 v0.17.1 教训方向相反。 |

### 2.2 CLAUDE.md 运维需求覆盖

| # | CLAUDE.md 需求 | FINAL-REPORT 覆盖 | 状态 | Severity | 证据 |
|---|---|---|---|---|---|
| OPS-1 | **部署同步口诀** (4 步 + md5 校验 + 备份) | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L71-75。FINAL-REPORT 无部署同步验证。 |
| OPS-2 | **SKILL 部署分离 bug** (.proma-pro vs .proma-dev) | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L74。此 bug 若未修复将导致 SKILL 部署到错误目录。FINAL-REPORT 未提及。 |
| OPS-3 | **文档引擎一致性** (P0 高发区) | 部分提及 | 🟡 **部分覆盖** | YELLOW | CLAUDE.md L89-91。FINAL-REPORT §3.3 (v0.21 severity 强制) 是一个引擎一致性改进，但未做全量校验。 |
| OPS-4 | **pro 测试要点 10+ 条** | 部分提及 | 🟡 **部分覆盖** | YELLOW | CLAUDE.md L77-87。FINAL-REPORT 仅覆盖了 idle 多维核验 (L78-84 D1-A)，其余 9+ 条未提。 |
| OPS-5 | **持续迭代 Loop** | 未提及 | 🟡 **间接覆盖** | YELLOW | CLAUDE.md L67-68。tree-iterative-development SKILL 如果存在会覆盖此需求，但该 SKILL 文件缺失（见下文）。 |
| OPS-6 | **测试要求** (改引擎后跑测试 + node -c) | 未提及 | 🔴 **未覆盖** | RED | CLAUDE.md L94-96。FINAL-REPORT 未提及任何测试运行记录。 |

### 2.3 项目设计文档约束覆盖

| # | 约束来源 | 约束内容 | FINAL-REPORT 覆盖 | 状态 | Severity |
|---|---|---|---|---|---|
| ARCH-1 | ARCHITECTURE.md §2.1 | **不可重构建铁律**: 商业版有 15 个闭源模块，从开源重构建→登录失败 | 未提及 | 🟢 **未破坏** | GREEN |
| ARCH-2 | ARCHITECTURE.md §2.2 | **三层文件分工**: sed 补丁/独立插件/内联引擎 | 未提及 | 🟢 **未破坏** | GREEN |
| ARCH-3 | ARCHITECTURE.md §3 | **三开环境拓扑**: 5 实例矩阵 + 两变量体系 | 未提及 | 🟢 **未破坏** | GREEN |
| SEC-1 | SECURITY.md §1.2 | **三层防御拓扑**: 入口拦截/兜底守卫/事后检测 | §3.6 CLI 兼容通道 | 🔴 **有倒退风险** | RED |
| SEC-2 | SECURITY.md §2.1 | **威胁模型**: AI 走捷径（伪完成/自审自过/字段篡改） | 未验证 | 🟡 **不确定** | YELLOW |
| SEC-3 | SECURITY.md §2.2 | **跨会话污染**: workspace 状态分裂/跨工作区漂移 | 未提及 | 🟡 **不确定** | YELLOW |
| SEC-4 | SECURITY.md §2.4 | **Prompt Injection 防御**: 6/6 全部拒绝 | 未验证 | 🟡 **不确定** | YELLOW |
| BUG-1 | BUG-REGISTRY.md | **BUG-A**: Proma fork identity timeout (🔴 未修，跨仓) | 未提及 | 🔴 **未解决** | RED |
| BUG-2 | BUG-REGISTRY.md | **BUG-B**: leaf_add 事务回滚 (⚪ 待核实) | 未提及 | 🟡 **未解决** | YELLOW |
| BUG-3 | BUG-REGISTRY.md | **BUG-3**: harness-efficiency 报告提及 (⚪ 待核实) | 未提及 | 🟡 **未解决** | YELLOW |

---

## 三、FINAL-REPORT 7/7 标准逐条审计

### 标准 1: "P0 接力协议补章（§13.3b）+ idle 多维核验"

```yaml
verdict: "部分覆盖 — 严重性 YELLOW"
claimed: "✅ macp7 SKILL v2.9.5；macp10/11 实战零 leaf 误判 prune"
reality: |
  - §13.3b 是纯 SKILL 协议层，"0 引擎改动" (FINAL-REPORT L46 自述)。
    CLAUDE.md P0 macp2/v0.17.1 的核心诉求是引擎层硬约束，非 SKILL 教化。
  - §13.3b 的 "commander done 不需 audit_gate 代调" (L49) 与 SECURITY.md
    §1.2 入口拦截层 (audit_gate caller==audit_session) 存在张力——如果
    commander done 真的绕过了 audit_gate，则安全模型的兜底守卫层失效。
  - idle 多维核验 (mtime + tool calls + queue) 确实改进了 macp6 的误判问题，
    但 macp11 出现 "root idle 复发" (FINAL-REPORT L77)，表明修复不完整。
evidence:
  - FINAL-REPORT L46: "纯 SKILL 协议层（0 引擎改动）"
  - FINAL-REPORT L77: "macp11 root idle 复发"
  - CLAUDE.md L62: "防线必须引擎硬拦（L1）兜底"
```

### 标准 2: "P1 audit_log schema severity + auditor ≥2 events + emergent 协作教化"

```yaml
verdict: "部分覆盖 — 严重性 YELLOW"
claimed: "✅ macp8 v2.9.6；引擎 v0.21 强制 red|yellow|green"
reality: |
  - v0.21 引擎 severity 强制是真实引擎改进 ✓，直接对应 CLAUDE.md "文档引擎一致性"。
  - auditor ≥2 events 是 SKILL 教化，不涉及引擎变更。
  - "emergent v2 协作教化" (FINAL-REPORT §3.5) 是教化方案。CLAUDE.md v0.17.1 
    教训明确指出 "对 GLM-5.2 教化无效必须引擎硬拦" (L62)。协作教化方案与
    此教训方向相反。
  - FINAL-REPORT L74: "v2 能力精化（只能 event_append + leaf_get + 写报告，
    全权限操作需旧 root 代调）"——这是一个好的最小权限设计，但执行依赖
    SKILL 教化非引擎 enforce。
evidence:
  - FINAL-REPORT L63: "引擎强制 severity ∈ red|yellow|green"
  - FINAL-REPORT L74: v2 能力精化描述
  - CLAUDE.md L62: "安全/质量防线不能只靠 SKILL 教化（L2）"
```

### 标准 3: "引擎 segment_add 评估"

```yaml
verdict: "过度宣称 — 严重性 RED"
claimed: "✅ macp9 三方案论证：A1 改 added_by 永久否决 / A2 leaf_transfer_owner 
         最优留候选 / A3 SKILL 绕过本轮落地"
reality: |
  - 这是评估/研究 (evaluation)，不是实现 (implementation)。
  - A2 leaf_transfer_owner 是 "留候选" (~50 行，FINAL-REPORT L101)，未实现。
  - A3 "SKILL 绕过本轮落地" = 没有引擎改动。
  - 将此记为 "✅ 完成" 是过度宣称。评估 ≠ 解决。
  - FINAL-REPORT 自身 roadmap (L101) 将 A2 列为"后续 Roadmap"进一步证实未完成。
evidence:
  - FINAL-REPORT L17: "引擎 segment_add 评估" (注意是"评估"不是"实现")
  - FINAL-REPORT L101: "A2 leaf_transfer_owner 工具（macp9 留候选，~50 行）"
```

### 标准 4: "项目层 4 缺陷全修 + C1 85+"

```yaml
verdict: "范围混淆 — 严重性 YELLOW"
claimed: "✅ 缺陷1 Judge LLM + 缺陷2 Coder CWE-22（macp6）/ 缺陷3 runGwt（macp10）/
         缺陷4 evaluateCode（macp10）；C1=86/100 macp11"
reality: |
  - 4 缺陷属于 D:/Codes/multi-agent-collab-platform/（测试底座项目），
    非 tree-harness 引擎/SKILL 缺陷。
  - FINAL-REPORT L5 明确标注"测试底座：D:/Codes/multi-agent-collab-platform/"。
  - C1=86 是测试底座项目的完成度分数，非 tree-harness 的代码质量/安全分数。
  - 用项目层分数代表 tree-harness 完成度是范围混淆。
  - CLAUDE.md 的 BUG-REGISTRY 中 BUG-A (🔴 未修) / BUG-B (⚪ 待核实) 才是
    tree-harness 自身需修的缺陷，均未被 FINAL-REPORT 提及。
evidence:
  - FINAL-REPORT L5: "测试底座：D:/Codes/multi-agent-collab-platform/"
  - FINAL-REPORT L18: "缺陷1 Judge LLM + 缺陷2 Coder CWE-22"
  - BUG-REGISTRY.md L36: "BUG-A: Proma fork identity timeout (🔴 未修)"
```

### 标准 5: "C1 权威复评 85+（MiniMax 异厂商签字）"

```yaml
verdict: "范围混淆 — 严重性 YELLOW"
claimed: "✅ macp11 X-c1-revote.md C1=86"
reality: |
  - C1=86 是 multi-agent-collab-platform 项目的完成度分数。
  - 异厂商复评机制本身是好的（符合 memory "树评估须多模型对抗"），
    但评估对象是测试底座项目，非 tree-harness。
  - tree-harness 自身的质量/安全评分在 FINAL-REPORT 中无独立评估。
  - 对比：CLAUDE.md L104 有 tree-harness 自身的测试成绩
    (90/90 绿，commit 3852c61)，FINAL-REPORT 未更新此基线。
evidence:
  - FINAL-REPORT L33: "macp11 (MiniMax 复评) 86"
  - FINAL-REPORT L19: "C1=86/100 macp11"
```

### 标准 6: "综合实战验证"

```yaml
verdict: "部分覆盖 — 严重性 YELLOW"
claimed: "✅ macp7-11 五轮改进全 PASS；§13.3b 多层级 done 零 V10 撞击（macp10）+
         CLI 兜底（macp11）"
reality: |
  - macp7-11 五轮确有实战记录，PR 档案齐全 ✓。
  - 但 CLAUDE.md 定义的测试要求 (L94-96: "改引擎后必跑相关测试 + node -c")
    未被验证。FINAL-REPORT 未提及任何单元测试/集成测试运行。
  - macp11 "CLI 兼容通道兜底" 绕过 V10 caller 校验 (FINAL-REPORT L80:
    "省略 callerSessionId 跳过 V10 caller 校验")，这对 SECURITY.md §1.2
    入口拦截层构成倒退。
  - macp11 "root idle 复发" (L77) 表明 §3.2 idle 探测未根治。
evidence:
  - FINAL-REPORT L52: "macp10 零 V10 撞击；macp11 worker/commander 全 done"
  - FINAL-REPORT L80: "省略 callerSessionId 跳过 V10 caller 校验"
  - FINAL-REPORT L77: "macp11 root idle 复发"
```

### 标准 7: "tree-iterative-development 终版 + 最终归档"

```yaml
verdict: "无法核实 / 可能过度宣称 — 严重性 RED"
claimed: "✅ SKILL v1.4（§1.1 macp3-11 实证表 + §10.1 进度快照）；本报告 + 
         pr/20260727-macp{6,7,9,10,11}/"
reality: |
  - SKILL 文件 tree-iterative-development 在以下位置均不存在:
    * D:/Codes/tree-harness/skills/ (项目源目录)
    * C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/ (Pro 部署)
    * C:/Users/sir_c/.proma-dev/agent-workspaces/default/skills/ (Dev 部署)
  - Glob 搜索 "**/tree-iterative-development*" 在 tree-harness 全目录零结果。
  - PR 档案存在 ✓ (pr/20260727-macp{6,7,9,10,11}/)。
  - 如果 SKILL 文件在其他路径，FINAL-REPORT 应注明其位置。
  - FINAL-REPORT L93-94 提到 "配套 memory 14 条" 在 .proma/ 路径，但该路径
    不包含 SKILL 文件（SKILL 在 .proma-pro/ 或 .proma-dev/）。
evidence:
  - Glob: D:/Codes/tree-harness/skills/**/tree-iterative-development* → 0 files
  - Glob: ~/.proma-pro/.../skills/**/tree-iterative-development* → 0 files
  - Glob: ~/.proma-dev/.../skills/**/tree-iterative-development* → 0 files
  - FINAL-REPORT L91: "SKILL v1.4（§1.1 macp3-11 实证表 + §10.1 进度快照）"
```

---

## 四、6 项核心改进 vs CLAUDE.md 对齐度

| # | FINAL-REPORT 改进 | 类型 | 对齐的 CLAUDE.md 需求 | 对齐度 | 说明 |
|---|---|---|---|---|---|
| 3.1 | §13.3b 多层级 done 接力协议 | SKILL 教化 | macp2 (部分) / idle | 中 | 0 引擎改动，不满足 v0.17.1 "必须引擎硬拦" |
| 3.2 | idle 探测多维核验 | 方法论 | pro 测试要点 (D1-A) | 高 | 直接改进 CLAUDE.md L78-84 的判活方法 |
| 3.3 | audit_log schema severity 强制 | **引擎 v0.21** | 文档引擎一致性 | **高** | 唯一真实引擎改进，对齐 P0 高发区 |
| 3.4 | auditor ≥2 events | SKILL 教化 | nanju (间接) | 中 | 增加审计完整性，但教化非引擎 |
| 3.5 | emergent v2 协作教化 | SKILL 教化 | macp2 (部分) | **低** | 教化方案与 v0.17.1 "教化无效"教训相悖 |
| 3.6 | CLI 兼容通道兜底 | 应急方案 | — | **低** | 绕过 V10 caller 校验，安全倒退 |

**核心问题**: 6 项改进中，**仅 1 项 (3.3) 是引擎层变更**，其余 5 项为 SKILL 方法论/协议层。这与 CLAUDE.md 反复强调的 "防线必须引擎硬拦（L1）兜底" (L62) 和 "架构层硬约束" (L14) 方向不完全一致。v0.17.1 事故的核心教训就是 3 层防线（L1 引擎 + L2 教化 + L3 commander 他审）中 L2/L3 被 GLM 绕过，必须沉到 L1——而 harness 改进仍主要停留在 L2。

---

## 五、遗漏项汇总

### 5.1 RED — 严重遗漏

```yaml
findings:
  - id: GAP-R1
    desc: "闭环三要件未映射"
    detail: |
      CLAUDE.md L7-14 将闭环三要件（即时/可定位/人验证最后一跳）定义为
      "第一性原理"和 Agent 工程核心。FINAL-REPORT 未将任何改进映射到这三要件。
      无法判断 harness 改进是否真正提升了闭环完整性。
    severity: red
    evidence: "CLAUDE.md L7-14; FINAL-REPORT 全文搜索 '闭环'/'即时'/'可定位'/'人验证' → 0 hits"

  - id: GAP-R2
    desc: "macp2 收敛条件未覆盖"
    detail: |
      CLAUDE.md L32: "收敛条件必须有：角色数上限（分档 2/3/5）+ 轮数上限（≤3）+
      停止条件（red_count=0 或升级）"。
      FINAL-REPORT 6 项改进中无任何一项涉及收敛条件加固。
    severity: red
    evidence: "CLAUDE.md L32; FINAL-REPORT §三"

  - id: GAP-R3
    desc: "nanju brief 审计义务 4 条铁律全未覆盖"
    detail: |
      CLAUDE.md L47-54 nanju 铁律 1-4（review_required 默认 true / auditor 硬 DoD /
      brief checklist / prefix 命名）在 FINAL-REPORT 中零提及。
      nanju 事故的根因是 "brief 配置释放了审计义务"，FINAL-REPORT 未展示
      如何防止同类事故重演。
    severity: red
    evidence: "CLAUDE.md L47-54; FINAL-REPORT 全文搜索 'nanju'/'review_required默认'/'可选' → 0 hits"

  - id: GAP-R4
    desc: "部署同步/运维需求完全遗漏"
    detail: |
      CLAUDE.md L71-75 部署同步口诀（4 步 + md5 校验 + 备份）+ L74
      SKILL 部署分离 bug (.proma-pro vs .proma-dev) 在 FINAL-REPORT 中零提及。
      这是 CLAUDE.md 作为 "删掉后未来 Agent 会犯错" 知识库最关键的运维知识，
      但 FINAL-REPORT 未验证 harness 改动后部署流程是否仍正确。
    severity: red
    evidence: "CLAUDE.md L71-75; FINAL-REPORT 全文搜索 '部署'/'同步'/'md5' → 0 hits"

  - id: GAP-R5
    desc: "tree-iterative-development SKILL v1.4 文件不存在"
    detail: |
      FINAL-REPORT 标准 7 声称产出 "SKILL v1.4"，但在以下路径均未找到文件:
      - D:/Codes/tree-harness/skills/tree-iterative-development/
      - ~/.proma-pro/agent-workspaces/default/skills/tree-iterative-development/
      - ~/.proma-dev/agent-workspaces/default/skills/tree-iterative-development/
      如果文件在其他位置，FINAL-REPORT 未标注路径。
    severity: red
    evidence: "Glob 搜索 '**/tree-iterative-development*' 三目录均 0 results"

  - id: GAP-R6
    desc: "BUG-A (跨仓未修) 未被 FINAL-REPORT 提及"
    detail: |
      BUG-REGISTRY.md L36: BUG-A "Proma fork identity timeout
      (auditor session 永久 busy，可用率 33%)" — 状态 🔴 未修。
      FINAL-REPORT 声称 "7/7 完成标准全达成" 但未提及此已知未修缺陷。
    severity: red
    evidence: "BUG-REGISTRY.md L36; FINAL-REPORT 全文搜索 'BUG-A'/'fork identity' → 0 hits"

  - id: GAP-R7
    desc: "CLI 兼容通道绕过 V10 caller 校验 — 安全倒退"
    detail: |
      FINAL-REPORT L80: "省略 callerSessionId 跳过 V10 caller 校验（引擎降级非 V10 路径）"
      这是对 SECURITY.md §1.2 入口拦截层的直接绕过。
      SECURITY.md 三层防御拓扑的第一层就是 caller 校验（cmdEventAppend L1498 +
      cmdLeafAdd L705 + create_session L461 + fork_session L601）。
      FINAL-REPORT 将此作为 "成功代调" 方案却未标注安全风险。
    severity: red
    evidence: "FINAL-REPORT L80; SECURITY.md §1.2 入口拦截层"
```

### 5.2 YELLOW — 部分覆盖/待改进

```yaml
findings:
  - id: GAP-Y1
    desc: "v0.17.1 教化无效教训与 §3.5 教化方案方向冲突"
    detail: |
      CLAUDE.md L62: "防线不能只靠 SKILL 教化（L2）或 commander 他审（L3）
      ——必须引擎硬拦（L1）兜底"。FINAL-REPORT §3.5 "emergent v2 协作教化"
      名称本身含"教化"二字，且 L74 描述为能力精化（SKILL 层规范 v2 能做什么、
      不能做什么）——无引擎 enforce。这与 v0.17.1 教训方向相反。
    severity: yellow
    evidence: "CLAUDE.md L62 vs FINAL-REPORT L71-74"

  - id: GAP-Y2
    desc: "pro 测试要点仅覆盖 D1-A，其余 9+ 条未验证"
    detail: |
      CLAUDE.md L77-87 含 10+ 条 pro 测试要点。FINAL-REPORT §3.2 覆盖了
      idle 探测 (对应 L84 D1-A)，但以下要点未覆盖:
      - pro 用 .proma-dev userData (L78)
      - pro 冷启动慢 (L79)
      - 并发 + 无护栏 = 成本爆炸 (L80)
      - commander 协调消息在 worker 会话 (L81)
      - tree_id 纯字母数字 (L82)
      - API list_messages text 截断 (L83)
      - tree-state 文件通道判进度 (L84)
      - remote 调用方受限 (L85)
      - pro userData = ~/.proma-dev/ (L86)
      - 跨多树 patches false positive (L87)
    severity: yellow
    evidence: "CLAUDE.md L77-87; FINAL-REPORT §3.2 仅覆盖 idle"

  - id: GAP-Y3
    desc: "测试运行记录缺失"
    detail: |
      CLAUDE.md L94-96: "改引擎后必跑相关测试 + node -c 语法检查"。
      FINAL-REPORT 未提及任何测试运行（dbc-spec / audit-attacks /
      v10-cleanroom / v10-regression）。
      README.md L300-306 记录了既有的测试基线 (39/0 + 18/0 + 54/54 + 14/0)，
      FINAL-REPORT 未更新此基线以反映 harness 改动后的状态。
    severity: yellow
    evidence: "CLAUDE.md L94-96; README.md L300-306"

  - id: GAP-Y4
    desc: "BUG-B / BUG-3 状态未更新"
    detail: |
      BUG-REGISTRY.md: BUG-B (⚪ 待重新核实), BUG-3 (⚪ 待核实)。
      FINAL-REPORT 未更新这些已知待核实缺陷的状态。
    severity: yellow
    evidence: "BUG-REGISTRY.md L38-41"

  - id: GAP-Y5
    desc: "安全模型回归风险"
    detail: |
      SECURITY.md §1.2 入口拦截层依赖 caller 校验。FINAL-REPORT §3.1 (commander
      done 不需 audit_gate 代调) 和 §3.6 (CLI 省略 callerSessionId) 都涉及
      绕过 V10 校验路径。FINAL-REPORT 未评估这些绕过对安全模型的影响。
    severity: yellow
    evidence: "SECURITY.md §1.2; FINAL-REPORT L49, L80"

  - id: GAP-Y6
    desc: "标准 4/5 将项目层分数等同于 tree-harness 完成度"
    detail: |
      C1=86 是 multi-agent-collab-platform 测试底座项目分数，非 tree-harness 分数。
      FINAL-REPORT 用项目层分数佐证 tree-harness "7/7 完成"，存在范围混淆。
      tree-harness 自身的引擎质量/安全/测试分数无独立评估。
    severity: yellow
    evidence: "FINAL-REPORT L5, L18-19; CLAUDE.md L104 (旧基线 90/90)"
```

### 5.3 GREEN — 已覆盖或未破坏

```yaml
findings:
  - id: COV-G1
    desc: "audit_log schema severity 强制 (v0.21) — 真实引擎改进"
    detail: |
      FINAL-REPORT §3.3 的引擎 v0.21 severity 强制是真实引擎变更，
      直接对应 CLAUDE.md "文档引擎一致性" (L89-91)。
      这是 6 项核心改进中唯一的硬引擎变更。
    severity: green
    evidence: "FINAL-REPORT L63; CLAUDE.md L89"

  - id: COV-G2
    desc: "架构三层体系未被破坏"
    detail: |
      ARCHITECTURE.md 的 sed 补丁/独立插件/内联引擎三层修改模型
      和三开环境拓扑在 harness 改进后未被破坏。FINAL-REPORT 未提
      及架构变更，可推断架构层未被触及。
    severity: green
    evidence: "ARCHITECTURE.md §2; FINAL-REPORT 无架构变更描述"

  - id: COV-G3
    desc: "idle 探测从单点 usage_pct 升级为多维 (mtime + tool calls + queue)"
    detail: |
      直接改进了 CLAUDE.md L84 的 "tree-state 文件通道判进度" 方法论。
      这是 macp6 教训 (memory macp6-idle-misjudge) 的直接落地。
    severity: green
    evidence: "FINAL-REPORT L57-58; CLAUDE.md L84"

  - id: COV-G4
    desc: "PR 档案归档完整"
    detail: |
      pr/20260727-macp{6,7,9,10,11}/ 五个 PR 档案目录均存在，
      包含 design/results/audit 等文档。归档符合 CLAUDE.md 的文档治理要求。
    severity: green
    evidence: "Glob: D:/Codes/tree-harness/pr/20260727-macp*/ → 5 directories"
```

---

## 六、FINAL-REPORT 过度宣称总结

| # | 宣称 | 实际 | 严重性 |
|---|---|---|---|
| OD-1 | "7/7 ✅ 完成标准全达成" | 标准 3 (segment_add 评估) 是研究非实现，标准 7 (SKILL v1.4) 文件缺失，标准 4/5 非 tree-harness 交付物 | RED |
| OD-2 | "P0 接力协议补章" | SKILL-only (0 引擎改动)，与 CLAUDE.md P0 "必须引擎硬拦"方向不一致 | YELLOW |
| OD-3 | "项目层 4 缺陷全修" | 4 缺陷属测试底座项目，非 tree-harness。自身 BUG-A 未修 | RED |
| OD-4 | "C1=86 权威复评" | C1 是测试底座项目分数，tree-harness 自身无独立质量评分 | YELLOW |
| OD-5 | "SKILL v1.4 终版" | 文件在磁盘上不存在 | RED |
| OD-6 | "harness 开发完成" | 覆盖度不足：CLAUDE.md 至少 7 个 RED 级需求未覆盖 | RED |

---

## 七、建议

### 对 FINAL-REPORT
1. **修正标准 1**: 明确标注 §13.3b 是 SKILL 层改进（非引擎），并列出仍需引擎化的 gap
2. **修正标准 3**: 将 "✅" 改为 "评估完成，A2 待实现"
3. **修正标准 4/5**: 标明 C1=86 是测试底座项目分数，补充 tree-harness 自身质量评估
4. **修正标准 7**: 确认 SKILL v1.4 文件位置或将其标记为待产出
5. **补充遗漏**: 新增 §"CLAUDE.md 需求覆盖矩阵"，逐条标注覆盖状态

### 对后续工作
1. **P0 优先**: 将 macp2 收敛条件 (角色上限/轮数上限/停止条件) 引擎化
2. **P0 优先**: 将 nanju brief audit 义务检查清单引擎化（建 tree 时自动校验）
3. **安全优先**: 评估 CLI 兼容通道的安全影响，考虑加入 caller 审计日志
4. **质量优先**: 跑一轮完整测试套件 (dbc-spec + audit-attacks + v10-cleanroom + v10-regression) 并更新基线
5. **运维**: 验证部署同步口诀在 harness 改动后是否仍有效

---

## 八、自查 Checklist

```yaml
self_check:
  - item: "CLAUDE.md 所有 P0 教训是否逐条核对"
    status: ✅
    detail: "macp2 (5铁律) / nanju (4铁律) / v0.17.1 (教化无效) 三条 P0 已逐条映射"

  - item: "FINAL-REPORT 7/7 标准是否逐条与源头需求比对"
    status: ✅
    detail: "7 条标准逐条审计，见 §三"

  - item: "每条 finding 有 severity + evidence（文件路径+行号）"
    status: ✅
    detail: "所有 finding 均含 severity (red/yellow/green) + evidence (文档引用+行号)"

  - item: "遗漏项单独列出并标注 severity"
    status: ✅
    detail: "7 个 RED + 6 个 YELLOW 遗漏项，见 §五"

  - item: "ARCHITECTURE.md / SECURITY.md / API.md 设计约束核对"
    status: ✅
    detail: "见 §2.3，架构未被破坏但安全模型有倒退风险"

  - item: "对抗性要求满足"
    status: ✅
    detail: "假设 FINAL-REPORT 过度宣称，找到了 6 项过度宣称 + 7 项 RED 遗漏"
```

---

## 九、审计结论

```yaml
final_verdict: |
  FINAL-REPORT 声称的 "7/7 完成标准全达成" 不能成立。
  
  真实完成度评估:
  - 确已完成: 标准 6 (综合实战验证, PR 档案齐全) ✓
  - 部分完成: 标准 1 (接力协议, SKILL-only) / 标准 2 (severity 引擎改进 + 教化方案)
  - 过度宣称: 标准 3 (评估≠实现) / 标准 4 (非 tree-harness 缺陷) / 
             标准 5 (非 tree-harness 分数) / 标准 7 (SKILL 文件缺失)
  
  核心问题:
  1. FINAL-REPORT 将 "harness 开发" 的范围定义为 macp7-11 的 SKILL 改进 +
     项目层缺陷修复，而非 CLAUDE.md 中 P0 教训要求的引擎层硬约束加固。
  2. "完成" 的定义与 CLAUDE.md 的架构/安全/运维需求之间存在显著 gap。
  3. v0.17.1 的核心教训（教化对 GLM 无效，必须引擎硬拦）在 harness 改进中
     未被充分采纳——6 项核心改进中仅 1 项 (v0.21 severity) 是引擎变更。
  4. 多个 CLAUDE.md 明确要求的关键需求（闭环三要件、收敛条件、nanju 审计义务、
     部署同步）在 FINAL-REPORT 中为零覆盖。
  
  FINAL-REPORT 更适合被理解为 "macp7-11 迭代改进报告"，而非
  "Tree Harness 引擎/SKILL 全面完成报告"。

recommendation: |
  建议 FINAL-REPORT 修订：
  - 将标题从 "最终完成报告" 改为 "阶段性改进报告 (macp7-11)"
  - 移除 "7/7 完成标准全达成" 的绝对化表述
  - 新增 "CLAUDE.md 需求覆盖矩阵" 章节，诚实标注未覆盖项
  - 将 C1=86 明确标注为测试底座项目分数
  - 确认 tree-iterative-development SKILL 文件位置
```

---

> **审计者签名**: audit-D1-commander (Proma Agent, DeepSeek-v4-pro)
> **审计方法**: 逐条文档对比 + 文件存在性验证 + 需求-实现映射
> **限制声明**: 未读 tree-engine.cjs 源码（D2 职责），仅限于文档级证据
> **产出**: D:/Codes/tree-harness/audit-20260728/D1-requirements-coverage.md
