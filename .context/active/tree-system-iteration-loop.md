# Tree-System 持续迭代改进 Loop（固定方法论）

> 维护：周星星 | 2026-07-17 确立 | 每个主会话按此 Loop 工作

---

## Loop 总览

```
┌─────────────────────────────────────────────────────────────┐
│  ① commit 当前改动                                          │
│  ↓                                                          │
│  ② 派 commander + observer（DeepSeek auditor）到 Pro        │
│     测试当前 engine/SKILL 改动（端到端验证）                  │
│  ↓                                                          │
│  ③ 派 commander + observer 到 Pro                           │
│     用 nanju S1 真实项目测试（发现真实问题）                  │
│  ↓                                                          │
│  ④ 主会话用 subAgent 进程内审计 + 迭代改进                   │
│     （读 tree-state / commander 会话 / 代码 / auditor 报告）  │
│  ↓                                                          │
│  ⑤ commit 改进                                              │
│  ↓                                                          │
│  ⑥ 回到 ②（测试改进）                                        │
└─────────────────────────────────────────────────────────────┘
```

## 各步详细

### ① commit 当前改动
- `cd /d/codes/tree-harness && git add -A && git commit -m "feat(tree-system): v0.XX ..."`
- 分支 `release-0.13.16-hardening`（本地，闭源不 push）
- commit message 含：版本 + 改动摘要 + 测试结果 + engine md5 + Co-Authored-By

### ② 测试当前改动（commander + observer 到 Pro）
- **commander**：GLM-5.2，`create_session(channel_id=57d0f98e, model_id=GLM-5.2, workspace_id=eb5e3f9c)`
- **observer/auditor**：DeepSeek（不同模型），commander 按 §13.4.1 派 `create_session(channel_id=d54cd84a, model_id=deepseek-v4-pro)`
- brief 模板：建小树（review_required=true）→ worker 产设计文档/代码 → DeepSeek auditor 审 → commander done
- 监督：读 `.proma-pro/agent-workspaces/default/.context/trees/<tree_id>/tree-state.json`（§6 判活三步）
- 验证：engine/SKILL 新改动实战生效（如 v0.22 yellow_findings_resolved / v0.23 死锁修复）

### ③ 真实项目测试（nanju S1，commander + observer 到 Pro）
- 同 ② 但 brief = nanju S1 任务（真实代码产出）
- nanju 资料在 `D:\Codes\multi-agent-collab-platform\`（architecture / sprint-plan / exploration）
- **多路并行**：commander 多派 worker（各模块同时跑），加速 S1
- worker 产 TS 代码到 `deliverables/src/` + §4.6 自审 + DeepSeek auditor 审

### ④ subAgent 进程内审计 + 迭代改进
- 派 **SDK Agent**（进程内，`subagent_type=general-purpose` 或 `Explore`）审计：
  - 读 tree-state（全 leaf events/audit_log/audit_gate）
  - 读 worker 产出代码（质量/编译/架构一致性）
  - 读 auditor audit_log（findings 准确性/severity/verdict）
  - 读 commander 会话（为什么卡/不推进/没遵守 SKILL）
- **识别闭环断点**（Agent 工程即闭环工程——CLAUDE.md 第一性原理）
- 改进 engine/SKILL（引擎硬拦优先 > SKILL 教化，因为 GLM 不可靠）
- 测试（sprint-vXXX + 全量回归）

### ⑤ commit 改进
- 同 ①

### ⑥ 回到 ②
- Loop 继续，直到 tree-system 在真实项目上稳定闭环

## 关键约束（红线）

1. **SubAgent 只用进程内 Agent 工具**（禁 create_session/fork 当 reviewer——macp2 红线）
2. **监督读 tree-state events**（不靠 status/write_count 假信号——§6 判活三步）
3. **改引擎走完整流程**（源 + node -c + sprint 测试 + 全量回归 + 部署 pro dist + 重启）
4. **SKILL 部署 .proma-pro**（分离 bug 修复后，不是 .proma-dev）
5. **commit 前测试全绿**（sprint + 全量 0 回归）

## pro 参数

| 项 | 值 |
|---|---|
| 实例 | pro（127.0.0.1:19877）|
| workspace | eb5e3f9c |
| GLM | channel 57d0f98e / GLM-5.2 |
| DeepSeek | channel d54cd84a / deepseek-v4-pro |
| SKILL | ~/.proma-pro/agent-workspaces/default/skills/ |
| tree | ~/.proma-pro/agent-workspaces/default/.context/trees/ |
| engine | D:/Proma-dev/resources/app/dist/tree-engine.cjs |

## 演进记录（每轮 Loop 填）

| 轮次 | 版本 | 改动 | 测试 | 实战 | 发现的 gap |
|---|---|---|---|---|---|
| 1 | v0.18-v0.21 | 4 引擎硬拦 + 分离 bug + tree-auditor SKILL | sprint-v018~v021 全绿 | v172t~v22t + nanjuS1 | yellow 真空 + auditor→worker fixer 缺 |
| 2 | v0.22 | yellow_findings_resolved + fix leaf §13.4.6 | sprint-v022 4/0 | ns1b 多路并行 19TS 154.5KB | E_AUDIT_RED_BLOCKED 死锁 + fix leaf 教化失效 |
| 3 | v0.23 | red 阈值死锁修复（只看最新 audit_log）| sprint-v023 3/0 | 待测 | fix leaf 引擎化（第六硬拦候选） |
