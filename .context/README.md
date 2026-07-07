# `.context/` 目录导航

> 维护：周星星 | 最后整理：2026-07-04（新增 Tree harness 中期评价）
>
> 本文件由文档归档方案自动生成。`.context/` 是 Proma 改造项目的知识中心——所有非代码产物（设计、计划、交接、审计、测试报告、运行时数据）都沉淀在这里。

---

## 一、新人 30 秒上手

1. **第一站**：读 [`PROJECT-INDEX.md`](./PROJECT-INDEX.md) ——项目全貌、当前完成度、卡点、关键文档表
2. **第二站**：读 [`project-onboarding-guide-2026-06-25.md`](./project-onboarding-guide-2026-06-25.md) ——30 分钟图形化入门
3. **第三站**：按需进入下面的子目录找细节

---

## 二、目录结构速查

```
.context/
├── PROJECT-INDEX.md          ← 入口索引（必读）
├── README.md                  ← 本文件
├── note.md                    ← 长期累积笔记（运行时持续追加）
├── tree-harness-midterm-review.md   ← Tree harness 中期评价（nanju 活案例 4-Agent 交叉印证，2026-07-04）
├── project-onboarding-guide-2026-06-25.md   ← 30 分钟入门向导
├── proma-dev-wiki.md          ← 完整技术 Wiki（补丁/架构/版本史）
├── proma-dev-patches.cjs      ← 主插件源码（22 工具 + HTTP bridge）
├── proma-mcp-server.cjs       ← 外部 stdio MCP 桥接
├── ssh-check.js               ← SSH 自检脚本
│
├── active/                    ← 当前正在推进的工作（活跃文档）
├── reference/                 ← 长期参考资料（设计/方法论/计划/模板）
│   ├── design/                ← 设计文档
│   ├── methodology/           ← 方法论沉淀
│   ├── architecture/          ← 架构方案与专家审议（自包含整体）
│   ├── plans/                 ← 各类实施方案
│   ├── prompts/               ← Tao Watcher / Auditor Prompt 模板
│   └── test-plans/            ← 测试计划与验收报告
├── archive/                   ← 已完结、不再活跃的历史产出
│   ├── 2026-06-l1fix/         ← L1Fix 及 L1Fix v2 系列审计报告
│   ├── 2026-06-q1q3-audit/    ← Q1 v1/v2 与 Q3 收敛审计
│   ├── 2026-06-early-versions/← v0.1 / v01 / v02 / b-verify 早期版本报告
│   ├── 2026-06-mcp-test/      ← MCP 早期测试
│   ├── 2026-06-handoff/       ← 历史 session handoff 与早期 progress report
│   ├── audit/                 ← 历史 audit 报告（a1/a2/c1-c4/w 等）
│   └── deliverables/          ← 三个早期交付包（bverify/real/retest）
│
├── v10/                       ← V10 加固工程文档全集（20+ 份报告）
├── audit/v10-p2/              ← V10 Phase 2 e2e 报告与 tree-state（保留原位）
├── trees/                     ← 运行时 tree-state 数据（24 个 tree 子目录）
└── user-assets/               ← 用户资源
```

---

## 三、按用途查找

### 我要看「现在在干什么」

进 [`active/`](./active/)，里面有当前 8 份活跃文档：

- `master-handoff-2026-06-25.md` —— 主交接
- `session-2026-06-25-v10-followup.md` —— V10 Phase 3 Bug A/B 修复
- `session-2026-06-25-followup-tree-mode.md` —— V4-V9 followup Tree 模式实战
- `session-2026-06-25-ef3bb7f0-recap.md` —— ef3bb7f0 主线 recap
- `cross-workspace-tree-issue-2026-06-25.md` —— 跨工作区问题调查
- `cross-workspace-cleanup-2026-06-25.md` —— 跨工作区清理方案
- `progress-report-2026-06-25.md` —— 6/20→6/25 五天总结
- `iterative-deep-audit-2026-06-25.md` —— 迭代深度审计

### 我要查「设计原理 / 方法论」

- **Tree harness 中期评价**：[`tree-harness-midterm-review.md`](./tree-harness-midterm-review.md) —— nanju 活案例 4-Agent 洁净室交叉印证 3 个 P0 设计漏洞（done event 架空门禁 / audit_gate 三重死锁 / 状态机零流转）+ 优先修复表（2026-07-04）
- 设计文档：[`reference/design/`](./reference/design/) —— 8 份（tree-commander-design / technical-report / proma-innovation-plan / proposal-remote-session-mcp / 等）
- 方法论：[`reference/methodology/`](./reference/methodology/) —— 3 份（commander-methodology v1.2 + v10 + tree-audit-methodology）
- 架构方案：[`reference/architecture/`](./reference/architecture/) —— 3 个自包含整体（architecture-plan-2026-06-23 + expert-review v1/v2）

### 我要查「实施方案」

进 [`reference/plans/`](./reference/plans/)，13 份方案文件，包括：
`v10-implementation-charter.md` / `q1-state-architecture.md` / `q2-tree-ui-panel.md` / `q3-tao-hard-constraint.md` / `tree-engine-inline-mcp.md` / `audit-gate-retest-v10.md` / `agent-helper-and-skill-auto-trigger.md` 等。

### 我要查「测试计划 / 验收报告」

进 [`reference/test-plans/`](./reference/test-plans/)：`internal-test-plan.md` / `s1-test-plan.md` / `s2-test-plan.md` / `remote-session-release-report.md`。

### 我要查「Prompt 模板」

进 [`reference/prompts/`](./reference/prompts/)：4 份 Tao 系列（`tao-audit-prompt.md` / `tao-health-check-prompt.md` / `tao-nudge-template.md` / `tao-watcher-prompt.md`）。注：配套的 `tao-rules.json` 保留在 `trees/` 顶层（可能被运行时子树引用）。

### 我要查「V10 加固工程」

进 [`v10/`](./v10/) —— V10 Phase 1-3 全集（charter / C1-C5 / A1-A5 / Cr / Cr2 / D4 / e2e / bug-a / bug-b 共 20+ 份）。Phase 2 e2e 报告另在 [`audit/v10-p2/`](./audit/v10-p2/)（保留原位，含 tree-state.json）。

### 我要查「历史审计 / 早期版本」

- L1Fix 系列（25 份）：[`archive/2026-06-l1fix/`](./archive/2026-06-l1fix/)
- Q1/Q3 审计（7 份）：[`archive/2026-06-q1q3-audit/`](./archive/2026-06-q1q3-audit/)
- 早期版本（5 份）：[`archive/2026-06-early-versions/`](./archive/2026-06-early-versions/)（v0.1 / v01 / v02 / b-verify）
- MCP 测试：[`archive/2026-06-mcp-test/`](./archive/2026-06-mcp-test/)
- 历史 handoff（18 份）：[`archive/2026-06-handoff/`](./archive/2026-06-handoff/)
- 历史 audit（10 份）：[`archive/audit/`](./archive/audit/)（a1/a2/c1-c4/w-walkthru 等）
- 早期交付包（3 个目录）：[`archive/deliverables/`](./archive/deliverables/)（bverify-deliverable / real-deliverable / retest-deliverable）

### 我要看「运行时数据」

`trees/` 下 24 个子目录都是真实跑过的 tree-state（bug-a/b、l1fix、q1e2e、q1full、smoke、taotest、v10v、v626 等）。这些是运行时产物，**不要手动改**。

---

## 四、维护约定

1. **新文档落位规则**：
   - 当前正在推进 → `active/`
   - 设计/方法论/方案/模板 → `reference/<子类>/`
   - 阶段性完结的报告 → `archive/<主题或日期>/`
   - 运行时 tree-state → `trees/<tree-id>/`

2. **从 active 撤离**：当一份 active 文档对应的工作完结，移到对应的 archive 子目录，并更新 `PROJECT-INDEX.md` 的链接。

3. **新增 archive 子目录**：按 `<年-月>-<主题>` 命名（如 `2026-06-l1fix`）。

4. **修改本 README**：目录结构变化时同步更新「目录结构速查」一节。

5. **链接保持相对路径**：从 `.context/` 内部引用其他文档时，用 `./active/xxx.md` / `./reference/design/xxx.md` 形式，确保在任何工具里都能点开。

6. **PROJECT-INDEX.md 是唯一入口**：所有「项目当前状态」的描述以它为准；本 README 只描述目录结构，不重复项目状态。
