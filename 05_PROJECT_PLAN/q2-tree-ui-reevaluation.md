# Q2 树形 UI 面板（补丁 L）重评估

> 维护：周星星 | 产出：2026-07-14 tree-harness 子会话
> 配套：[sprint-plan.md](./sprint-plan.md) Sprint 6「Q2 树形 UI 面板（补丁 L）重评估」· [../01_PRD/product-positioning.md](../01_PRD/product-positioning.md) §五 out-of-scope

## 一、背景

补丁 L（树形 UI 浮窗）是 tree-harness 早期的 renderer 层可视化尝试：
- **形态**：renderer 注入 `proma-tree-view.js`（48KB）+ `proma-tree-view.css`（14KB）+ `index.html` + `preload.cjs` 桥接，在 Proma UI 里浮窗展示树结构、切换 leaf session、看 drift/nudge。
- **历史**（见 [../.context/archive/2026-06-handoff/session-2026-06-22-patch-m-plus.md](../.context/archive/2026-06-handoff/session-2026-06-22-patch-m-plus.md)）：2026-06-22 开发到 80%，卡在「入口按钮定位」（依赖 minified DOM class `.tabbar-bg`/`.automation-entry`，脆弱）。
- **现状**：代码仍在 `release/tree-system-v0.2.2/patch-l/`（旧版快照），**未进入当前 pro 部署**（pro 当前是 engine 内联后的形态，无 UI 面板）。

## 二、引擎内联（v0.7+）后的价值变化

引擎内联（tree-engine.cjs 作为独立插件文件 require 进 patches.cjs，工作区零源码泄漏）改变了补丁 L 的价值定位：

| 维度 | 引擎内联前（v0.6-） | 引擎内联后（v0.7+） |
|---|---|---|
| 后端逻辑可见性 | 散落，可能泄漏 | ✅ 零源码泄漏（内联） |
| 用户看树的方式 | **需要** UI 面板（否则看不到） | tree_dump（文本 JSON）+ aggregate-metrics.cjs 已可分析 |
| UI 面板的必要性 | 较高（配套可视化） | **降低**（后端已自洽，UI 变可选增强） |

**关键洞察**：引擎内联解决的是「后端逻辑零源码泄漏」，与「用户可视化看树」**正交**。内联后，UI 面板从「必须配套」降为「锦上添花」。

## 三、做/不做评估

### 不做的理由（权重高）

1. **当前用户是研究者 n=1**：success-metrics §六诚实声明 tree-harness 仅研究者自用。n=1 场景下，`tree_tree_dump`（JSON）+ 刚做的 [aggregate-metrics.cjs](./aggregate-metrics.cjs) 已能满足树状态分析需求，浮窗 UI 边际价值低。
2. **renderer 注入脆弱**：依赖 Proma minified bundle 的 DOM class（`.tabbar-bg`/`.automation-entry`），Proma 每次升级可能坏（历史已踩）。维护成本高、回归风险高。
3. **产品化阶段优先级**：success-metrics 团队维度的核心赌注是「后端纪律机制（audit_gate/max_sessions/竹节）让多 agent 更可靠可控」——这是**后端价值**，不需要 UI 证明。UI 面板是 v1 之后的体验优化，非 v1 验证目标。
4. **AGPL 边界**：renderer 是上游开源 AGPL 层，tree-view.js 若要 PR 上游需重构为上游接受的 React 组件（上游是 React 18 + Jotai + Tailwind），工作量等于重写。
5. **精力分配**：Sprint 6 的外部依赖（PR/团队试用/对照实验）已经很多，UI 面板会分散有限精力。

### 做的理由（权重低）

1. **团队试用的体验门槛**：真实团队（非研究者）可能更习惯可视化面板而非 JSON dump。但这是**团队试用反馈后**才该响应的需求，现在做是过早优化。
2. **树状态直觉化**：浮窗能直观看到「哪些 leaf 卡住 / 哪些 drift」。但 aggregate-metrics.cjs 的 gap 诊断已覆盖这个需求（文本形式）。

## 四、决策

> **🔴 v1 不做。标记为 v2 候选，触发条件待定。**

### 触发条件（满足任一则重新评估）

1. **团队试用反馈**（外部）：≥2 个试用团队主动提出「需要可视化看树」→ 响应做。
2. **研究者日常负担**：n=1 自用时 `tree_dump` + aggregate-metrics.cjs 明显不够用（如频繁需要实时切换 leaf session）→ 做精简版。
3. **上游接受 tree-system**（远期）：若 tree-system 以某种形态 PR 上游成功，UI 面板作为配套体验值得做（此时用上游 React 栈重写，不再脆弱注入）。

### 若未来做的方向（避免重复踩坑）

- **不做 renderer 注入**（脆弱），改走 **Proma 原生 IPC + 一个独立 webview/窗口**（独立 HTML，通过 mcp__session__* 拉数据渲染），与 Proma bundle 解耦，升级不坏。
- 或作为 **独立 Electron 小工具**（读 ~/.proma-dev tree-state.json 渲染），完全脱离 Proma renderer。
- 数据源用 tree_tree_dump / aggregate-metrics.cjs 的聚合，复用现有后端。

## 五、对 sprint-plan / success-metrics 的影响

- sprint-plan Sprint 6「Q2 树形 UI 面板重评估」→ **✅ 已评估，决策不做（v2 候选）**。
- product-positioning §五 out-of-scope「树形 UI 可视化面板 → 留给 Proma 上游（ISS-002）」→ **维持 out-of-scope**，本评估印证该决策（脆弱性 + 优先级）。
- 不消耗 Sprint 6 精力，聚焦 PR/实验/团队试用三个外部依赖。
