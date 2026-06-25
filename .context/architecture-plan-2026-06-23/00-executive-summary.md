# 执行摘要：Proma Tree 体系架构改进方案

> **读者**: 周星星
> **预计阅读**: 5 分钟
> **前提**: 已审阅 v2 专家审议包（`expert-review-v2-2026-06-23/`）
> **本文件性质**: 在 v2 核心论断获批后，浓缩方案全貌供决策确认

---

## 1. 核心论断

**Tree 体系不可靠不是 prompt 写得不够好。三者叠加：LLM 物理特性（不可改）+ Agent harness 缺硬约束层（可改）+ 层级深度严重失控（可改）。**

| 因子 | 占比 | 性质 | 对策 |
|------|:---:|------|------|
| Prompt 表达不够结构化 | 30% | 可优化 | 重构 SKILL.md 为结构化指令 |
| 模型 RLHF 副产物（sycophancy / reward hacking） | 30% | **不可改**（prompt 改不动训练目标） | 用代码硬约束抵消模型捷径倾向 |
| Agent harness 缺硬约束层 | 40% | **可改，且必须改** | v0.7 五层防御架构 |

---

## 2. 关键证据（3 条独立来源，结论一致）

| # | 来源 | 发现 | 含义 |
|---|------|------|------|
| 1 | **学术** — Laban ICLR 2026 | 单轮→多轮，15 个模型平均准确率掉 **39%** | 每多一层委托，指令保真度断崖下跌 |
| 2 | **工业** — Anthropic 官方 | 多 Agent 研究系统**只用 2 层**，3 层以上无公开生产案例 | 业界最优团队也把层级控制在 2 以内 |
| 3 | **实测** — qfv2 tree 数据 | 实际跑到 **5 层深**（root → C → Cr → Ccr1 → worker），1 root + 8 sub-commander + 9 worker | 5 层叠加：0.61^5 ≈ **8% 信息残留**，92% 丢失 |

**三方独立来源（学术 / 工业 / 实测）指向同一个结论：层级深度是委托可靠性的头号杀手，必须硬限制。**

---

## 3. 五层防御架构

```
┌──────────────────────────────────────────────────────────┐
│ Layer 4: 模型层契约         │ v0.8 候选   │ Proma 平台改造  │
│ subagent_trace_id + capability-based tools              │
├──────────────────────────────────────────────────────────┤
│ Layer 3: 监督平面（"天道"）  │ P2 强化     │ 已有 TAO Watcher │
│ TAO Watcher + Liveness 心跳 + 完善 35 规则              │
├──────────────────────────────────────────────────────────┤
│ Layer 2: 主动 supervision   │ P1 新增     │ ← 当前完全缺失  │
│ commander 持 worker lifecycle handle，失败即时接管       │
├──────────────────────────────────────────────────────────┤
│ Layer 1: Hard Gate（代码层） │ P0 新增     │ ← 当前完全缺失  │
│ Capability Token + DbC + State Schema + Hash Chain      │
│ + depth ≤ 3 硬限制 + role enum 校验                     │
├──────────────────────────────────────────────────────────┤
│ Layer 0: prompt 软约束      │ 已有        │ 35 条 TAO 规则   │
│ "应当"、"铁律" — 可被模型选择性忽略                      │
└──────────────────────────────────────────────────────────┘
```

**当前状态**: 只有 Layer 0（软的，不可靠）+ Layer 3 部分（周期的，被动的事后审计）。

**v0.7 目标**: 补齐 Layer 1 + Layer 2，把"应当"升级为"必须"，把"事后发现"升级为"事中拦截"。

---

## 4. v0.7 合并计划

v0.5（4 个用户 bug）+ v0.6（8 个 DbC 子步骤）+ v0.7 新增机制 **全部合并为一个 v0.7**，按五层架构重写优先级。

| Phase | 内容 | 工作量 | 改什么 |
|-------|------|:---:|--------|
| **A** | DbC + depth/role 硬校验 | 4-5 小时 | tree-state.js + 2 SKILL.md |
| **B** | Capability Token 机制 | 2-3 天 | tree-state.js + patches.cjs + 2 SKILL.md |
| **C** | 主动 supervision（lifecycle handle） | 2-3 天 | commander SKILL.md + tree-state.js |
| **D** | v0.5 用户层 bug（剪枝 / skill 全局 / watcher） | 4 小时 | 3-4 文件 |
| **E** | Event hash chain + Snapshot | 1-2 天 | tree-state.js |
| **F** | Liveness heartbeat（TAO Watcher 强化） | 半天 | patches.cjs |
| **G** | 部署 + 测试 + wiki + commit | 用户配合 | — |
| **合计** | | **2-3 周** | **15+ 文件** |

---

## 5. 8 个关键决策

| # | 议题 | 推荐选项 | 一句话理由 |
|---|------|---------|-----------|
| 1 | 核心论断是否接受 | **A. 完全接受** | 三家调研结论惊人一致，30/30/40 是定性分配无需精确数字 |
| 2 | 三层防御架构是否采纳 | **C. Layer 1 + 2 都做** | 覆盖 80% 痛点，Layer 3 已有基础，Layer 4 依赖平台暂缓 |
| 3 | 层级深度硬限制 | **B. depth ≤ 3** | 80% 任务扁平化搞定，大任务留 sub-commander 出口但必须强模型 |
| 4 | Capability Token | **B. P1 跟 DbC 一起** | 互补不重叠，但依赖 Proma 平台改造，先做 DbC 看效果 |
| 5 | v0.5/v0.6/v0.7 合并 | **A. 全部合并为 v0.7** | 高度耦合，分批增加 migrate 次数，用户偏好一次性 commit |
| 6 | 复杂任务拆解方案 | **C. 三种都支持** | 用户在 root_dod 选 tree_mode，默认扁平化 |
| 7 | 历史 tree 迁移策略 | **B + C 组合** | 只对新 tree 生效，不覆盖已有数据，qfv2 续跑时自然被拦 |
| 8 | v0.7 验证方法 | **D. 全部都做** | 改动面大，6 组测试互不重叠（CP 复测 + depth + role + capability + supervision） |

---

## 6. Fork 机制验证结论

**已实证确认：Fork 完美保留系统提示词和 Skill 上下文。** 这意味着不是"worker 没收到规则"，而是**模型看到全部规则但仍然选择性忽略**。这排除了"Fork 丢提示词"的假设，锁定了真正的根因——软约束在跨 session 压力下被模型系统性绕过。因此**路线 A（工具层硬约束）优先级最高**：既然模型能看到规则但不遵守，就让代码在写入路径上强制拦截。

---

## 7. 关键风险

| # | 风险 | 影响 | 缓解措施 |
|---|------|------|---------|
| 1 | **v0.7 工作量 2-3 周，中间阻塞全部无法交付** | 用户等不及 | 按 Phase 分步 commit，Phase A+D 先交付（1-2 天），后续 Phase 渐进叠加 |
| 2 | **Capability Token 依赖 Proma 平台改造** | 可能无法在 patches.cjs 层面实现 | Phase B 先做可行性验证（半天），如平台不可行则降级为纯 DbC 方案 |
| 3 | **depth ≤ 3 限制过严，qfv2 式大任务无处安放** | 业务受限 | 配套方案 C（三种拆解模式），用户可在 root_dod 声明 max_depth 和 tree_mode |

---

## 8. 与用户四个问题的对应

| Q | A | 对应方案章节 |
|---|----|-------------|
| 是 prompt 问题还是机制问题？ | **30% prompt + 30% 模型 + 40% harness**。不只是 prompt，机制层缺硬约束是主因 | `01-five-layer-defense.md` |
| "天道"机制够不够？ | **作为 Layer 3 兜底够，作为唯一防线不够。** 当前 Proma 把天道当唯一防线所以不可靠 | `01-five-layer-defense.md` §Layer 3 |
| 开源框架有现成的吗？ | **没完全解决的**，但有大量可借鉴（LangGraph State Schema / MetaGPT SOP / Erlang OTP Supervisor / seL4 Capability / CrewAI 五层防御） | `01-five-layer-defense.md` §业界借鉴 |
| "严格 2 层"是什么？ | **Anthropic 只用 2 层（1 commander + N worker）。** qfv2 实测跑到 5 层。v0.7 硬限 depth ≤ 3，sub-commander 必须更强模型 | `02-depth-limits.md` |

---

## 下一步

1. **确认 8 个决策** — 逐条确认推荐选项或给出替代选项
2. **批准 v0.7 合并方案** — 确认 Phase A-G 的优先级和时间安排
3. **进入实施** — Agent 按 `03-implementation-roadmap.md` 逐 Phase 执行

---

> **本摘要由 Proma Agent 撰写，2026-06-23**
> **详细设计见本目录下 01-06 号文件**
