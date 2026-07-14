# 产品定位（Product Positioning）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（产品设计补建，确认框架：上游补丁 + 两层客户 + AI 开发团队）
> 配套：[../README.md](../README.md) · [../.context/active/design-files-mapping-2026-07-09.md](../.context/active/design-files-mapping-2026-07-09.md) · [layer2-user-scenarios.md](./layer2-user-scenarios.md)

本文是 PRD 域的**纲领文档**，统合历史定位摇摆、声明项目边界、论证安全投入 ROI。其他 PRD 文档（场景/指标/team-config/护栏）均以本文为根基。

---

## 一、一句话定位

> **tree-harness 是 Proma 上游增强补丁的孵化场，为 AI 开发团队提供多 agent 协作的代码级纪律强制层——把「靠 prompt 求着 agent 遵守」变成「绕不过的代码强制」。**

---

## 二、两层客户（核心框架）

### 直接客户：Proma 官方维护者
- **角色**：决定是否将 tree-harness 孵化的补丁合并到 Proma 主线
- **衡量标准**：补丁是否架构契合 / 可维护 / 不破坏现有功能 / AGPL-3.0 合规 / 低侵入可回滚
- **PRD 对其的义务**：清晰的补丁清单（11 补丁 A-K + tree-engine + patches）、补丁可独立开关、回滚机制、变更说明

### 最终受益者：AI 开发团队（小团队 Lead + Agent）
- **角色**：用集成补丁的 Proma 驱动多 agent 协作开发（设计→拆解→并行开发→汇总→审计）
- **痛点**（均有实证）：
  - 多 agent 协作失控 → macp2 事故（4 分钟炸 207 会话，DeepSeek 额度打负）
  - agent 走捷径（伪完成/自审自过/字段篡改）→ audit-gate-test / v626 篡改实证
  - 上下文腐化 → 长任务历史污染
- **衡量标准**：多 agent 比单 agent 完成更**快**（并行）/ 更**省**（预算护栏）/ 更**可靠**（纪律门禁）
- **PRD 对其的义务**：清晰使用场景 / 可预期纪律收益 / 成本可控（预算护栏 + 收敛条件）

---

## 三、核心价值主张

> **让 AI agent 协作像军队指挥一样有纪律。**

通过 tree-system（树形会话执行 + DbC 门禁 + 独立审计 + 预算护栏 + caller-binding 身份校验），把多 agent 协作从「自觉遵守 prompt」升级为「代码强制不可绕过」。这是 tree-harness 区别于「再多写点 prompt」的根本差异。

---

## 四、定位统合（消除历史摇摆）

SubAgent A 发现四份文档对定位说法不一，现按维度统合（它们不矛盾，是不同维度）：

| 文档 | 原说法 | 维度 | 统合后处置 |
|---|---|---|---|
| README | AI 军队指挥系统 | 价值主张 | ✅ 保留（价值主张） |
| PROJECT-INDEX | 垂直化 AI 助手产品 | 商业形态 | 🟡 暂不取主线（垂直化是未来可能，当前非 v1 目标） |
| 使用场景 | 提交给 Proma 的功能参考 | 产出形式 | ✅ 采纳为主线（上游补丁） |
| 时间线剪枝者 | 给 Agent 装管理会话的双手 | 技术本质 | ✅ 保留（基础设施层） |

**统合结论**：
- **技术本质** = 基础设施（会话管理 + 纪律强制）
- **产出形式** = Proma 上游补丁
- **价值主张** = 军队指挥系统（代码级纪律）
- **服务对象** = AI 开发团队
- **商业形态** = v1 不预设（先证明补丁价值，垂直化/独立产品是后续可能）

---

## 五、项目边界（in / out of scope）

### In scope（v1）
- **tree-system**：树形会话执行体系（建树 / DbC 门禁 / 独立审计 / 预算护栏 / caller-binding）
- **MCP 基础设施**：22 个 session/remote 工具 + 11 个核心补丁 A-K + 三实例隔离
- **安全加固**：DbC 21 + V10 八大 + IHL 6 轮（防 agent 走捷径）
- **方法论资产**：Commander/Worker/Auditor SKILL + 洁净室测试 + IHL 迭代

### Out of scope（明确不做 / 留给上游或未来）
| 项 | 原因 | 归属 |
|---|---|---|
| 树形 UI 可视化面板 | 需改 Proma renderer（打包 bundle，难） | 留给 Proma 上游（ISS-002） |
| Layer 2 主动 Supervision | 设计完成未实现 | 未来 v2 |
| Layer 4 模型契约平台层 | 依赖未就绪 | 未来 |
| 垂直业务逻辑（行业定制） | 非基础设施职责 | 未来垂直化产品 |
| 模型层（训练/微调） | 非 tree-harness 职责 | 不做 |
| ~~竹节交接自动触发（ctx 阈值）~~ | ~~原列 out-of-scope（2026-07-11 审计发现矛盾）~~ | ✅ 已纳入 Sprint 2（v0.18，见 [sprint-plan](../05_PROJECT_PLAN/sprint-plan.md) + [design-commander-spawn](../05_PROJECT_PLAN/design-commander-spawn.md)），**非 out-of-scope**，从本表移除 |

---

## 六、安全投入的 ROI 论证（回应 SubAgent A「过度设计」质疑）

21 DbC + V10 八大加固 + IHL 6 轮迭代的投入合理性，建立在「AI agent 会走捷径」这一**有实证**的假设上：

| 实证 | 损失 | 对应加固 |
|---|---|---|
| macp2（2026-07-08）| 4 分钟炸 207 会话，DeepSeek 额度打负（真金白银） | create_session budget 护栏 + SKILL §13.5 红线 |
| audit-gate-test（2026-06-25）| commander 972bd9a8 自审自判循环（伪完成） | caller-binding + audit_gate 独立性 |
| 528b0925 | worker 拿僵尸 session 自审 pass | resolveAuditorIndep + W-AUDIT-WORKER |
| v626（2026-06-26）| tree-state.json 被直接篡改 | W-AUDIT-TAMPER 事后检测 |
| vfa1/vfb | 13 种伪造 UUID 全过（V4-V9 时代） | V10 内容有效性校验 |

**结论**：安全加固的 ROI = 防止上述真实损失，**非过度设计**。每一类加固都有对应的实证攻击。当前的 gap 不是「加固太多」，而是「约束只覆盖 tree 内合规路径，对 create_session 旁路无效」（聚类 A，见 improvement-report）——这是加固的**方向**问题，不是**程度**问题。

---

## 七、成功的前提条件

tree-harness 要成功（补丁被合并 + 团队受益），依赖：
1. **补丁质量**：低侵入、可回滚、架构契合 Proma（直接客户标准）
2. **纪律有效性**：约束真正覆盖旁路（聚类 A 根治），非纸面门禁
3. **成本可控**：预算护栏 + 收敛条件，杜绝 macp2 型爆炸
4. **可上手性**：清晰场景 + SKILL + 文档（团队标准）

这四点对应 success-metrics.md 的可衡量指标。

---

## 八、PRD 域文档导航（本轮交付 5 份，2026-07-11；user-personas / functional-requirements / non-functional-requirements 等 P2 缺口留后续 Sprint）

| 文档 | 用途 | 状态 |
|---|---|---|
| [user-stories.md](./user-stories.md) | 标准 user stories（As-a/I-want/so-that + 验收 + MoSCoW），供 sprint/测试引用 | ✅ |
| [layer2-user-scenarios.md](./layer2-user-scenarios.md) | Layer 2（树形体系）用户场景——补齐项目主体 80% 代码的「为什么」 | ✅ |
| [success-metrics.md](./success-metrics.md) | 产品成功指标（两层客户各自的可衡量标准） | ✅ |
| [team-config.md](./team-config.md) | 角色↔模型↔工具↔成本矩阵（macp2 根因之一） | ✅ |
| [cost-guardrails.md](./cost-guardrails.md) | 预算护栏专文（macp2 教训） | ✅ |
