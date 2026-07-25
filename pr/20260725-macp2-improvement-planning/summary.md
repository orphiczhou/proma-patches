# macp2 改进方案汇总（3 子会话论证后）

> 日期：2026-07-25 | 基于 06_TESTS/macp2-tree-evaluation-2026-07-25.md 改进建议 + 3 论证子会话

## 0. 论证结论矩阵

| 建议 | 层 | 可行性 | 工作量 | 引擎依赖 | 优先级 | 论证要点 |
|------|----|--------|--------|---------|--------|---------|
| **P0-A** 放开 auditor | SKILL/流程 | 高 | SKILL 文档 | **零引擎改动** | 高 | resolveAuditorIndep 已支持方案 B（root 背书 auditor → auditor 给全树配门禁）；macp2 问题是 commander 不知道建 auditor leaf |
| **P0-B** tree_init 绑 caller | 引擎 | 高 | 5 行/<1h | 自身 | 高 | cmdInit 加 callerSessionId 参数 + dispatch L5261 透传；优先级 `--session-id → caller → PROMA_SESSION_ID → PENDING_ROOT` |
| **P2-A** tree_id prefix 校验 | 引擎 | 高 | 5 行/<30min | 自身 | 中 | cmdInit L755 已有 PREFIX_RE，复用校验 tree_id（oeval-macp2 连字符前置拦截）|
| **P1-C** set-status 讲透 | SKILL | 高 | ~10 行 | 无 | **最高** | 根因：信息在 SKILL >800 行后，不在 brief/铁律；改 brief 模板 + worker 铁律 + lifecycle 醒目 |
| **P1-A** comm_log checklist | SKILL | 高 | ~8 行 | 无 | 中 | send_message 后必须 tree_log_communication 硬 checklist（§4 Step3 / §11）|
| **P1-B** progress 强制 | SKILL+引擎 | 可行 | ~21 行 | 建议配合 | 中 | SKILL 先教化；若下轮仍漏，引擎加 W_NO_PROGRESS warning（done 门禁不拦死）|
| **P0-C** coder/judge 接 LLM | 项目 | 可行 | 1500-1900 行/52-72h | 无 | 项目高 | PromaCloudLlmClient + sandbox 回填 + 自修复 + PlantUML 解析 + 7 硬约束 + withSoftTimeout；风险：PlantUML 解析（正则兜底 80% → Phase2 TS Compiler）|
| **P0-D** 多模型 + peer audit | 项目+proma | 可行 | 项目 280 行/8h + proma SKILL | P0-A 配合 | 中 | 多模型交叉（commander 子树指定不同渠道）+ A↔B↔C peer audit |
| **P1-D** 错误码重命名 | 项目 | — | 0.5h | 无 | **关闭** | 有意设计决策（api-spec v0.4:1006 说明保持原命名避免破坏透传链）；关闭建议，审计回复引用说明 |

## 1. proma 改造 vs 项目改进边界

| 纯 proma 改造（tree-harness） | 项目 + proma 各半 | 纯项目（multi-agent-collab-platform）|
|-------------------------------|-------------------|--------------------------------------|
| P0-B（引擎 tree_init 绑 caller）| P0-D 文档+模板（项目）/ SKILL 修订（proma）| P0-C（coder/judge 1500-1900 行）|
| P2-A（引擎 tree_id 校验）| | P1-D（审计回复引用）|
| P0-A（SKILL 教 commander 建 auditor）| | |
| P1-C / P1-A / P1-B（SKILL）| | |

## 2. 推荐执行方案（3 选 1，见 AskUserQuestion）

- **方案 A（推荐）**：proma 轻量改造（引擎 10 行 + SKILL ~50 行，1-2 天），修 macp2 核心缺口；项目 P0-C 下 Sprint
- **方案 B**：proma + 项目并行（+ coder/judge 1500-1900 行，7-10 天），全面但长
- **方案 C**：分批（第 1 批 proma → 第 2 批项目 P0-C → 第 3 批 P0-D 多模型）

## 3. 详细论证报告

- `engine-evaluation.md`（引擎层）
- `skill-evaluation.md`（SKILL 层）
- `project-evaluation.md`（项目层）
