# 专家组审议包 — Proma Tree 体系 v0.6 计划

> **打包日期**: 2026-06-23 09:30
> **打包人**: Proma Agent（周星星的工作 AI 助手）
> **审议目标**: 决定 v0.6 修订计划是否批准

---

## 阅读顺序

### 最少阅读（20 分钟，赶时间）
1. `00-handoff.md` — 项目背景 + 现状 + 7 个决议题
2. `01-test-summary.md` — 测试报告核心结论（CP1-CP6）
3. `03-v0.6-revised-plan-draft.md` §0 + §7 — 起草人的修订建议 + 待决议题

### 完整审议（60 分钟）
4. `02-current-v0.5-plan.md` — 现有 v0.5 计划（已批准的 4 个 bug 修复）
5. `02b-current-v0.5-architecture-fixes.md` — v0.5 调研过程（4 个 bug 现状）
6. `04-source-tao-audit.md` — 原始 TAO 审计（35 条规则覆盖矩阵）
7. `05-source-meta-audit.md` — 元审计 Agent 综合报告（决定性总览）

---

## 文件清单

| 文件 | 内容 | 大小 |
|---|---|---|
| `00-handoff.md` | 交接文件（背景+现状+决议题） | ~6 KB |
| `01-test-summary.md` | 测试报告核心结论 | ~6 KB |
| `02-current-v0.5-plan.md` | 现有 v0.5 计划 | ~10 KB |
| `02b-current-v0.5-architecture-fixes.md` | v0.5 调研过程 | ~7 KB |
| `03-v0.6-revised-plan-draft.md` | **v0.6 修订计划草稿（核心讨论稿）** | ~10 KB |
| `04-source-tao-audit.md` | 原始 TAO 审计报告 | ~12 KB |
| `05-source-meta-audit.md` | 元审计 Agent 综合报告 | ~14 KB |

---

## 一句话总结

**Tree 体系处于"形式闭环、实质不闭环"的 v0.1 阶段，不能上生产。审计链路是伪链路（commander 自审自过、文件未落盘也 pass）。v0.6 计划把 skill 里的"应当"升级为 tree-state.js 子命令层的"必须"。请专家组判断是否批准。**

---

## 7 个核心决议题

1. Phase 6 是否应该作为 P0？
2. Phase 6 是 8 步一次性做，还是只做 P0 两步先看效果？
3. migrate 策略：强制 vs 只对新 tree 生效？
4. commander 行为问题：硬校验让 commander 卡死时是否回退？
5. Proma 平台层 Agent 凭证缺失：先推平台改造还是先工具层 hack？
6. Phase 3 是否完全不动 watcher 代码？
7. Phase 6 完成后怎么验证？

详见 `00-handoff.md` §6。
