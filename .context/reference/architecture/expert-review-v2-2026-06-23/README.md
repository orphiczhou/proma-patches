# 专家组审议包 v2 — Proma Tree 体系架构层诊断

> **打包日期**: 2026-06-23 14:41
> **打包人**: Proma Agent（周星星的工作 AI 助手）
> **审议目标**: 决定 v2 报告的核心论断是否批准，以及 v0.5 / v0.6 / v0.7 怎么合并

---

## 阅读顺序

### 最少阅读（20 分钟，赶时间）

1. `00-handoff.md` — 项目背景 + 核心论断 + 三层架构 + 决议题概览
2. `01-questions.md` — 8 个详细决议题（含选项、利弊、推荐）
3. `../tree-system-architecture-analysis-2026-06-23.md` §0 + §1.5 + §6 — TL;DR + qfv2 实测 + 层级深度对比

### 完整审议（60 分钟）

4. `../tree-system-architecture-analysis-2026-06-23.md` §2-§10 — 用户问题答案 + 三层防御 + 框架借鉴 + 优先级 + 风险
5. `../expert-review-2026-06-23/01-test-summary.md` — 测试报告（CP1-CP6）
6. `../expert-review-2026-06-23/03-v0.6-revised-plan-draft.md` — 原 v0.6 草稿（被本 v2 修正）

---

## 文件清单

| 文件 | 内容 | 大小 |
|---|---|---|
| `00-handoff.md` | 交接文件（背景+核心论断+三层架构+决议题概览） | ~12 KB |
| `01-questions.md` | **8 个详细决议题（核心讨论稿）** | ~14 KB |
| `../tree-system-architecture-analysis-2026-06-23.md` | v2 完整报告（30+ 参考链接） | ~22 KB |

---

## 一句话总结

**Tree 体系不可靠的根因不是 prompt 写得不够好，是三个结构性问题叠加：LLM 物理特性（每多 1 层掉 39% 准确率）+ Agent harness 缺硬约束层（事中无人拦）+ 当前 tree 实际跑到 5 层深（远超工业极限）。靠 prompt 解 30%，剩下 70% 必须靠架构层硬约束 + 严格限制层级深度。**

---

## 8 个核心决议题

1. **核心论断是否接受**（30% prompt + 30% 模型 + 40% harness 分配）？
2. **三层防御架构是否采纳**（Layer 0-4，当前只有 Layer 0 + Layer 3 部分）？
3. **层级深度硬限制怎么定**（2 vs 3 vs 4）？
4. **Capability Token 是否上 P0**（不能放 prompt 里，实现复杂）？
5. **v0.5 / v0.6 / v0.7 怎么合并**（A 全部合并 vs B 三套并行）？
6. **复杂任务用 A/B/C 哪种方案**（扁平化 / meta-tree / 折中）？
7. **migrate 策略**：16 个历史 tree 强制还是只对新生效？
8. **测试方法**：v0.7 完成后怎么验证（6 组测试矩阵）？

详见 `01-questions.md`。

---

## 关键证据（3 条）

1. **学术**：Laban ICLR 2026 — 单轮→多轮准确率掉 39%（15 个模型 × 20 万对话）
2. **工业**：Anthropic 多 Agent research system — 自己只用 2 层，**3 层以上无公开生产案例**
3. **实测**：qfv2 tree 跑到 5 层深（root → C → Cr → Ccr1 → worker），1 root + 8 sub-commander + 9 worker，**92% 信息丢失**

---

## 不要重复讨论的

- 不修改 main.cjs（AGPL）
- v0.5 的 4 个 bug 修复方向（用户已批准）
- 倒竖时间线视觉（用户被劝住过）
- 浮窗 UI 改造（v0.4.5 已完成）
- "天道"作为周期审计的定位（v1 已确认）

---

## 可以挑战的

- 起草人对"30/30/40"的分配比例（拍脑袋）
- "depth ≤ 3"的判断（可能太严）
- "Capability Token 不能放 prompt 里"（是否有折中）
- migrate 不覆盖策略（历史 5 层 tree 是否应强制回滚）
- DeepSeek V4 Pro 作为 commander 模型的能力边界

---

## 不要做的

- ❌ 不要建议用 LangGraph / AutoGen 重写 Proma（用户明确不重写，只借鉴机制）
- ❌ 不要重新讨论浮窗 UI（已稳定）
- ❌ 不要建议换模型（DeepSeek V4 Pro 是用户当前选择）

---

> **本审议包由 Proma Agent 打包，2026-06-23 14:41**
> **请专家组审议后通过用户周星星反馈结论**
