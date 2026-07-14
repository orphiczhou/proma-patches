# Layer 2 用户场景（树形会话执行体系）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（产品设计补建）
> 配套：[product-positioning.md](./product-positioning.md) · [../使用场景-Agent团队协作开发流程.md](../使用场景-Agent团队协作开发流程.md)（Layer 1 场景，v0.10）

本文补齐 **Layer 2（树形会话执行体系，占项目代码量 80%）的用户场景**——这是 design-mapping 识别的 P0 缺口：项目主体长期「实现丰满、PRD 骨感」，无场景说明「为什么用户需要一棵树」。

---

## 一、为什么需要 Layer 2（区别于 Layer 1）

| 层 | 解决的问题 | 类比 |
|---|---|---|
| Layer 1（会话管理）| 管理 N 个会话（创建/fork/切换/竹节） | 给 agent 一双手（操作能力） |
| **Layer 2（树形执行）** | **让 N 个 agent 有纪律地协作** | **给 agent 一支军队（纪律 + 指挥）** |

Layer 1 解决「能不能操作」，Layer 2 解决「协作会不会失控」。**没有 Layer 2，多 agent 协作只能靠 prompt 求着 agent 遵守纪律，而 agent 会走捷径（macp2/audit-gate-test/v626 实证）。**

---

## 二、目标用户

**AI 应用开发团队 Lead**（团队的技术指挥者）：负责把一个项目拆成子任务、调度多个 agent 并行开发、对产出质量把关。痛点：多 agent 协作失控（成本爆炸/质量无保障/上下文腐化）。

---

## 三、场景 1：并行实现 + 独立审计（核心场景）⭐

**As a** 团队 Lead，**I want** 把一个模块拆成 N 个子任务让 agent 并行实现，并对每个产出独立审计，**so that** 既提速（并行）又保质（审计防走捷径）。

**痛点**：直接 spawn N 个 agent 并行，会出现——① 某个 agent 伪完成（没做对就报告 done）② agent 互相抄袭低质产出 ③ 失控时成本爆炸（macp2）。

**tree-system 解法**：
```
root（Lead）建树，下发 5 件套契约（brief/dod/expect_outputs/...）
├── commander-1（协调微服务A）
│   ├── worker-A1（实现 API）—— done 前必须 alignment 回填 + self_check
│   ├── worker-A2（实现 UI）
│   └── auditor-A（独立 session 审查 A1/A2 产出，防自审）
├── commander-2（协调微服务B）...
└── root 汇总，audit_gate 把关（worker done 需 auditor pass）
```
- **门禁**：worker 声明 done 前必须 brief_echo 对齐 + self_check + 独立 auditor 审查（caller-binding 防冒充）
- **预算护栏**：node_budget / subagent_spawn 硬上限，堵 macp2 型爆炸
- **审计独立性**：auditor 是独立 leaf（P0a），不能自审（E_BORROWED_IDENTITY）

**可衡量收益**：并行 N 倍速 + 审计拦截伪完成 + 单任务成本有上限。

**所需能力**：tree_init / leaf_add / milestone / audit_gate / caller-binding / node_budget。

---

## 四、场景 2：对抗式洁净室测试

**As a** 团队 Lead，**I want** 对一组 agent 产出做独立洁净室测试（实现者不参与测试设计），**so that** 暴露确认偏误，发现实现者盲点。

**痛点**：让实现者自己测自己的产出，会按实现逻辑设计测试（确认偏误），漏掉真实失守。

**tree-system 解法**（已在 V10 Phase 1 验证有效）：
```
root 下发测试 charter
├── A1（代码层评）—— 评实现 8/8 合格
├── Cr（洁净室）—— 独立从 spec 写测试，发现 10 个真实失守 ← 多视角的价值
└── root 收敛：Cr 优先于 A1（代码层合格 ≠ 实际安全）
```
- **洁净室铁律**：测试 agent 禁看实现者测试，从 spec 写，从攻击路径推导
- **多视角**：功能正确性 / 对抗攻击 / 端到端 / Prompt injection（V10 洁净室 4 commander 38 用例实证）

**可衡量收益**：V10 Phase 1 案例中，洁净室抓到 A1 代码层评全漏的 10 个失守。

**所需能力**：tree_init / 多 commander 并行 / audit_gate / 洁净室方法论（commander-methodology-v10 §4.1）。

---

## 五、场景 3：长任务竹节交接 + 上下文甜点区

**As a** 团队 Lead，**I want** 一个跨多会话的长任务保持上下文在「甜点区」（不溢出不丢失），**so that** 长任务不因上下文腐化而失忆或爆炸。

**痛点**：长任务跑久了两端死——上下文溢出（模型忘前面）或上下文过载（成本爆炸 + 噪音）。

**tree-system 解法**：
- **竹节交接（segment）**：当 leaf context 接近阈值，fork 新 session 继承 ownership + 历史，旧 session 归档
- **上下文甜点区**：心跳监测 ctx_usage_pct，自动触发竹节
- **5 件套契约持久化**：新竹节不丢 brief/dod（防契约丢失）

> ⚠️ 当前 gap：竹节交接自动触发未实现（心跳未集成 get_session_context，ISS-007/P2-S04）。这是 v1 待补项，非设计缺失。

**可衡量收益**：长任务可持续 + 上下文成本可控。

**所需能力**：segment_append / leaf_set_context / ctx 监测（待补）。

---

## 六、场景 4：多视角设计评审

**As a** 团队 Lead，**I want** 一份设计文档用多个独立 agent 从不同视角评审（架构/安全/UX/成本），**so that** 设计质量多维保障，单视角盲点被补上。

**痛点**：单个 reviewer 视角单一，且 reviewer 可能附和实现者（互审洗白）。

**tree-system 解法**（nanju 项目实战案例）：
```
root 下发设计任务
├── worker-D（产出设计文档 v0.1）
├── 审查层（≥4 个独立 leaf，铁律 1）
│   ├── reviewer-架构
│   ├── reviewer-安全
│   ├── reviewer-UX
│   └── reviewer-成本
└── root 收敛：red findings 必须修，review_round 收敛（review_evidence 防假收敛）
```
- **≥4 独立审查 leaf**（tree-audit-methodology 铁律 1）
- **review_round 收敛校验**：red_count=0 才算收敛（P1b fix_evidence 防「red 降 yellow 蒙混」）
- **flagged 阻断**：祖先 leaf 有 flagged 未补审，拒绝建子 leaf（ISS-003，防「在未审查设计上启动实现」）

**可衡量收益**：设计质量多视角 + 防互审洗白 + 防假收敛。

**所需能力**：tree_init / 多 reviewer leaf / review_round / E_REVIEW_FLAGGED_BLOCK。

---

## 七、场景 5：事故复盘 + 加固迭代（IHL）

**As a** 团队 Lead，**I want** 一次事故（如成本爆炸/安全失守）被系统化复盘并转化为加固，**so that** 同类事故不复发。

**痛点**：事故后口头总结，下次换个场景又踩同样坑。

**tree-system 解法**（IHL 方法论，已在 macp2/audit-gate/v626 验证）：
```
事故（如 macp2 成本爆炸）
→ 洁净室多 agent 分析根因（SKILL 模糊 / 无护栏 / 无收敛）
→ IHL 迭代加固（R1 全局守卫 / R2 workspace 校验 / ... / R6 规则前移）
→ 每轮洁净室回归验证（堵回归）
→ 沉淀进 CLAUDE.md P0 教训 + SKILL 红线
```
- **盲点驱动迭代**（IHL）：每轮针对上轮盲点
- **永久教训沉淀**：CLAUDE.md P0（如 SubAgent 调用形式必须钉死）

**可衡量收益**：事故教训系统化沉淀，同类问题复发率下降。

**所需能力**：洁净室测试 / IHL 方法论 / CLAUDE.md 教训沉淀。

---

## 八、场景与能力映射矩阵

| 场景 | 核心 tree 能力 | 关键门禁/护栏 |
|---|---|---|
| 1 并行+审计 | tree_init/leaf_add/audit_gate | caller-binding / node_budget / 独立 auditor |
| 2 洁净室测试 | 多 commander / Cr 优先 | 洁净室铁律 / audit_gate |
| 3 竹节交接 | segment_append / ctx 监测 | ctx 阈值（待补） |
| 4 多视角评审 | ≥4 reviewer leaf / review_round | E_REVIEW_FLAGGED_BLOCK / 收敛校验 |
| 5 事故复盘 | IHL 迭代 / 洁净室回归 | CLAUDE.md P0 沉淀 |

---

## 九、用户感知价值总结

对 AI 开发团队 Lead，Layer 2 提供**三个不可替代的价值**（Layer 1 / 裸 prompt 都给不了）：

1. **纪律保障**：agent 走捷径被代码拦截（非靠 prompt 自觉）—— 防伪完成/自审/篡改
2. **成本可控**：预算护栏 + 收敛条件 —— 防 macp2 型爆炸
3. **质量多维**：独立审计 + 洁净室 + 多视角 —— 防确认偏误

这正是 tree-harness 作为「纪律强制层」的产品价值（见 [product-positioning.md §三](./product-positioning.md)）。

---

## 十、待验证 / 待补

- **场景 3（竹节）** 自动触发未实现（ISS-007）—— 影响场景可用性，v1 待补
- **场景 4（评审）** nanju 实战中 §14 独立审计 leaf 结构曾失效（0 个独立 leaf，P1-M01）—— P0a auditor role 已补，但端到端 fallback 待修（P1-S04）
- **场景需真实团队验证**：当前场景基于研究者自用工作流抽象（n=1），需 2-3 个真实 AI 团队试用验证可复制性
