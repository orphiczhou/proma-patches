# Tree 引擎 V4-V9 加固后续修改建议（专家评估用）

> 维护: 周星星 / Proma Agent | 日期: 2026-06-24 | 状态: 待专家评估安排
> 自包含文档，无需回看对话历史。所有文件路径为绝对/相对 workspace-files。

---

## 一、背景与基线

### 1.1 项目
Proma 树形会话执行体系核心引擎 `tree-engine.cjs`（v0.7+ 内联 MCP，27 工具）。2026-06-24 完成 V4-V9 DbC 深度加固，用 Tree 方法论（实现/测试/审计分离 + 自举 + 迭代收敛）3 轮迭代。

### 1.2 已完成（评估基线，无需再议）

| 项 | 内容 | 状态 |
|---|---|---|
| 9 DbC 硬约束点 | V4/V5b/V6/V8/CP2/V9 + 审计[1][2][3]（tree-engine.cjs core→patch-l→dist 三处同步） | ✅ 已部署 dev |
| MCP Gap #5 | `tree_milestone_set_result` schema 加 `audit_session_id`（patches.cjs:1135） | ✅ 已部署 dist（M8） |
| 测试收敛 | audit-attacks 18/0 BYPASS，dbc-spec 36/0，audit-extra 21 case（审计留）[1][2][3] 全堵 | ✅ |
| 独立审计签字 | M7 子会话（DeepSeek V4 Pro）"可部署"，硬链接/TOCTOU/边界全验证 | ✅ |
| 文档沉淀 | note.md 顶部 + wiki §二十 + handoff/session-2026-06-24-v4v9-hardening.md | ✅ |
| 备份 | dist/tree-engine.cjs.bak-20260624-pre-v4v8 + dist/proma-dev-patches.cjs.bak-20260624-pre-mcp-gap | ✅ 可回滚 |

### 1.3 多源发现汇总
- **dev 会话功能测试**（`~/.proma-dev/.../30aa68d9.../.context/tree-test-report.md`，28 工具正例 + 门禁负例）→ 5 处差异
- **独立测试子会话**（端到端 MCP，发现 MCP gap #5，已修）
- **独立审计子会话**（对抗，签字可部署 + Layer4 残留确认）

---

## 二、待修清单（按优先级）

### 🔴 P0 必修 — MCP Schema Gap（同类问题）

#### #3 `nudge_append` 缺 `rule_id`
- **现象**：通过 MCP 调 `tree_nudge_append` **必失败**——引擎要求 `--rule-id`，schema 未暴露
- **根因**：
  - `engine.cjs:2083`：`if (!opts['rule-id']) throw new TreeStateError(E_SCHEMA_INVALID, '--rule-id is required');`
  - `patches.cjs:1141`：`tt("tree_nudge_append", ..., { tree_id, leaf_id, nudge: z.record(z.any()) }, (a) => ["nudge", "append", a.tree_id, a.leaf_id, "--json", J(a.nudge)])` —— schema 只有 `{tree_id, leaf_id, nudge}`，handler 只传 `--json`，**无 `--rule-id`**
- **修复**（patches.cjs:1141，~1 行）：
  ```js
  // schema 加 rule_id，handler 传 --rule-id
  tt("tree_nudge_append", "Append a nudge (TAO Watcher). Requires rule_id.", 
    { tree_id: z.string(), leaf_id: z.string(), rule_id: z.string(), nudge: z.record(z.any()) }, 
    (a) => ["nudge", "append", a.tree_id, a.leaf_id, "--rule-id", a.rule_id, "--json", J(a.nudge)])
  ```
- **影响**：`nudge_append` 从"必失败"变"可用"。零破坏性（必填参数对齐引擎）
- **验证**：MCP 调 `tree_nudge_append(tree_id, leaf_id, rule_id="C-02", nudge={...})` → 成功
- **依赖**：改 patch-l/proma-dev-patches.cjs + cp dist + **重启 dev**

#### 全量 MCP schema 扫描（建议，防同类遗漏）
- **问题**：#5（milestone_set_result）和 #3（nudge_append）都是"引擎要求某参数，MCP schema 漏暴露"。**修 #5 时没顺带扫其他工具，导致 #3 漏到 dev 测试才发现**——同类问题应系统排查
- **建议**：派独立子会话对照 `engine.cjs` 每个命令的必填参数（grep `'--xxx is required'` / `opts['xxx']` 校验）vs `patches.cjs` 对应工具 schema，列出所有缺口
- **已知候选**：`cmdNudgeAppend(--rule-id)` 已确认；其他 append/set 命令的必填字段待查
- **产出**：缺口清单表（工具 | 引擎必填参数 | schema 是否暴露 | 修复方案）+ 统一批量修复
- **执行**：DeepSeek V4 Pro 子会话（claude-sonnet 余额不足），role=test

---

### 🟡 P1 建议 — 文档同步（非 bug，提升可用性）

#### #1 role 枚举文档不准
- **现象**：SKILL.md §12 声称 role=`\w+`，实际引擎限制 `[root, commander, worker]`（其他抛 `E_SCHEMA_INVALID`）
- **性质**：引擎更严是**好的**（堵越界 role），文档滞后
- **建议**：SKILL.md §12 更新 role 枚举说明为 `[root, commander, worker]`
- **影响**：纯文档，零代码改动

#### #4 `audit_append` report 结构未文档化
- **现象**：引擎 `cmdAuditAppend` 要求 report 含 `{auditor_session_id, total, passed, failed, results[]}`，SKILL 未完整文档化
- **建议**：SKILL.md / wiki §十八 补 `audit_append` report 结构模板
- **影响**：纯文档

---

### 🟢 P2 可选 — 设计权衡（改变行为，需评估）

#### #2 `milestone_add` expect_outputs 检查时机
- **现象**：dev 报告 `milestone_add` 接受空 `expect_outputs:[]`，但 `done` 时 V3 拦（`E_DELIVERABLE_MISSING`）
- **当前设计**：`milestone_add` 不验非空（允许声明时为空，运行时填充），`leaf set-status done` 时 V3 验（`cmdLeafSetStatus` line 877-891）
- **dev 期望**：`milestone_add` 时就拦空 `expect_outputs`（V3 规则前置到 add）
- **权衡**：
  - **当前（灵活）**：milestone 可"先建后填"，但空 expect_outputs 的 milestone 可存在一段时间（done 时才暴露）
  - **dev 建议（严格）**：声明即验，堵住"空交付物 milestone 存在期"，但失去"先建后填"灵活性
- **建议**：**保持当前**（done 时 V3 验已足够堵 done 绕过；若要更严，加 `milestone_add` 软警告——validate 报 issue 不拦 add，两全）
- **影响**：改则破坏"先建后填"工作流，需评估现有 SKILL 流程是否依赖

---

### ⚪ Layer4 残留 — CLI 极限（需平台层，非本轮）

#### 互审洗白 + 冒用真实 session
- **现象**：
  1. 两个独立 worker 互相当 auditor（形式独立 vs 实质独立）→ milestone audit_pass=true + alignment 留痕都通过
  2. 篡改文件用树中真实独立 leaf 的 session_id 当 auditor → cmdAuditGate 查 events 也放过（events 格式合法）
- **根因**：CLI 层 `resolveAuditorIndep` 只验形式独立（≠self/≠added_by/真实存在），不验"那个 session 是否真的做了审计工作"
- **修复方向**：平台层 `subagent_trace_id` 绑定真实 session（agent 无法冒用他人 session_id，每次 MCP 调用的 session 身份由平台背书）
- **性质**：已知设计边界，**记录非 bug**。需 Proma 平台层支持，超出 tree-engine.cjs 范围
- **文档**：已在 note.md / wiki §二十 / SKILL 标注

---

## 三、执行建议

### 3.1 推荐顺序
1. **P0 #3**（nudge_append rule_id）：1 行修复 + cp dist + 重启 dev
2. **P0 全量扫描**：派 DeepSeek 子会话列 MCP schema 缺口清单（对照 engine 必填参数）
3. **P0 缺口统一修复**：根据清单批量改 patches.cjs + 部署 + 重启
4. **P1 文档**：#1 role + #4 audit_append（SKILL 更新，零代码风险）
5. **P2 #2**：评估后决定（建议保持当前，或加 validate 软警告）
6. **Layer4**：单独立项（平台层 subagent_trace_id，大工程）

### 3.2 角色分离（Tree 方法论，本轮已验证有效）
| 角色 | 执行者 | 职责 |
|---|---|---|
| 实现 | 主会话 / SDK Agent | 改 patches.cjs + 部署 |
| 测试 | 独立子会话（DeepSeek V4 Pro） | 端到端 MCP + 功能正例（仿 dev tree-test-report 28 工具覆盖）+ 对抗（audit-attacks） |
| 审计 | 独立子会话（DeepSeek V4 Pro） | 对抗找新绕过 + 签字 |

> 本轮教训：实现者自测有盲区（聚焦 tree-engine.cjs，漏 patches.cjs MCP schema）。**必须派独立子会话端到端 MCP 验证**（不只 require 引擎测试）。dev 的功能性测试（28 工具正例）补了对抗测试的 MCP schema 盲区——两者互补。

### 3.3 验证标准
- P0 修复后：
  - dev 风格功能测试：28 工具正例全绿（含 nudge_append / milestone_set_result 等曾 gap 的工具）
  - dbc-spec 36/0 + audit-attacks 18/0 不退化
  - 重启 dev + 27 工具注册确认
- MCP 端到端关键路径：nudge_append / milestone_set_result(audit_session_id) / audit_append(report) 正例可用

### 3.4 回滚
- dist 备份：
  - `D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-20260624-pre-v4v8`
  - `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs.bak-20260624-pre-mcp-gap`
- 任何阶段失败可 `cp` 备份恢复 + 重启 dev

---

## 四、关键文件位置

| 文件 | 位置 | 说明 |
|---|---|---|
| 引擎逻辑源 | `workspace-files/release/tree-system-v0.2.2/core/tree-state.js` | 唯一逻辑源 |
| 引擎内联版 | `.../release/tree-system-v0.2.2/patch-l/tree-engine.cjs` | 与 dist 字节一致 |
| 引擎部署 | `D:/Proma-dev/resources/app/dist/tree-engine.cjs` | dev 运行时加载 |
| MCP wrapper 源 | `.../release/tree-system-v0.2.2/patch-l/proma-dev-patches.cjs` | tree_* 工具 schema（27 工具，~1135-1152 行） |
| MCP wrapper 部署 | `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs` | dev 运行时加载 |
| 正向测试 | `.../test-sandbox/dbc-spec.cjs` | 36 用例 |
| 对抗测试 | `.../test-sandbox/audit-attacks.cjs` | 18 攻击 |
| 审计补充集 | `.../test-sandbox/audit-extra.cjs` | 21 case（审计子会话留） |
| dev 功能测试报告 | `~/.proma-dev/agent-workspaces/default/30aa68d9-c3de-450f-ae31-cee963ed1d08/.context/tree-test-report.md` | 28 工具正例 + 门禁负例 |
| SKILL 文档 | `workspace-files/skills/{tree-commander,tree-worker}/SKILL.md` | role/audit_append 等文档点 |
| 完整加固笔记 | `workspace-files/.context/note.md` 顶部条目 | V4-V9 + M8 全记录 |
| Wiki | `workspace-files/.context/proma-dev-wiki.md` §二十 | 加固总结 |
| handoff | `workspace-files/.context/handoff/session-2026-06-24-v4v9-hardening.md` | 新会话入口 |

---

## 五、待评估决策点（请专家定）

| # | 决策 | 建议 |
|---|---|---|
| 1 | P0 #3（nudge_append rule_id）是否立即修？ | **是**（1 行，零破坏性，堵必失败工具） |
| 2 | P0 全量 MCP schema 扫描是否派子会话做？ | **是**（防再漏同类，~30 分钟子会话） |
| 3 | P2 #2 milestone_add expect_outputs 时机：保持当前 vs 改前置？ | **保持当前**（done 时 V3 够），或加 validate 软警告 |
| 4 | Layer4 何时立项？ | 单独立项（平台 subagent_trace_id，大工程） |
| 5 | 文档 #1/#4 谁负责更新？ | SKILL 维护者（零代码风险，可并行） |
| 6 | 是否补 dev 风格功能测试到 test-sandbox（28 工具正例集）？ | **建议**（补对抗测试的 MCP schema 盲区，长期回归保护） |

---

## 六、核心教训（供专家参考）

1. **引擎层测试不够**：require 引擎跑 dbc-spec/audit-attacks 全绿 ≠ MCP 接口可用。MCP wrapper（patches.cjs）的 schema 可能漏参数（#5/#3）。**必须端到端 MCP 验证**。
2. **功能性测试 vs 对抗测试互补**：dev 的 28 工具正例发现 MCP schema gap；我的 audit-attacks 发现 DbC 绕过。**两类测试都要有**。
3. **独立子会话真实有效**：本轮 collaboration/DeepSeek 子会话抓到实现者 4 个盲点（[1][2][3] + MCP gap #5）。Tree 方法论"实现/测试/审计分离"价值实证。
4. **修一类问题要顺带扫同类**：修 #5（milestone_set_result）时没扫其他工具，导致 #3（nudge_append）漏到 dev 测试才发现。**P0 全量扫描**就是补这个。
