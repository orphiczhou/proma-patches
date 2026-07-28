# BRIEF-CONTEXT — audit2 树维度审计员共享上下文

> 你是 audit2 树的 D{N} audit-worker（维度审计员）。本文档是 6 个维度审计员的共享上下文。你的具体维度任务由 root 通过 send_message 另发，本文档提供全局背景 + 通用规则。

## 一、审计对象

**目标工程**: Tree Harness 工程（Proma 桌面应用 tree 系统改造），位于 `D:/Codes/tree-harness/`

**被审核心产物**: `pr/20260728-harness-final/FINAL-REPORT.md` — 自称 7/7 完成 + C1=86/100（MiniMax 异厂商签字），周期 2026-07-23→07-28（5 天 11 轮 macp 迭代）

## 二、对抗审计立场（必读）

🔴 **不盲信 FINAL-REPORT 自评**。历史教训：macp2 实战中 GLM 自评 C1=70，异厂商 MiniMax 复评仅 47（-23 暴跌）。单模型自评存在系统性乐观偏差。你的任务是**对抗性核验**——找 red/yellow，而非确认 green。

**对抗原则**：
1. 读源头文档核验，非听宣称（FINAL-REPORT 说"已修"不算，要看代码/归档证据）
2. 每条 finding 必须有 evidence（file:line 或原文引用或归档文件路径）
3. 宁可多报 red/yellow，不可漏报。green 要有充分证据支撑
4. C1 复评打分**不归你管**（留给 MiniMax auditor），你只评估维度真实状态

## 三、🔴 独立性硬规则（违反即审计污染）

**绝对禁止读取** `D:/Codes/tree-harness/audit-20260728/` 根目录下的任何 `.md` 文件（如 D1-requirements-coverage.md / D3-skill-completeness.md / D5-project-quality.md 等）——这些是**并行审计会话**（audit-root DeepSeek-root）的产物，读取会污染你的独立性。

**你只能读以下源头文档**：
- `pr/20260728-harness-final/FINAL-REPORT.md`（被审对象）
- `CLAUDE.md`（项目知识库 ~19455 字，P0 教训源头）
- `ARCHITECTURE.md` / `SECURITY.md` / `API.md` / `ERROR-CODES.md` / `BUG-REGISTRY.md`（项目设计文档）
- `tree-engine.cjs`（引擎源码 ~302256 字节，读关键函数非全读）
- `proma-dev-patches.cjs`（补丁注入源 ~191122 字节）
- `apply-patches.sh`（补丁应用脚本）
- `skills/tree-commander/SKILL.md` v2.9.7 / `skills/tree-worker/SKILL.md` / `skills/tree-auditor/SKILL.md` / `skills/tree-iterative-development/SKILL.md`
- `pr/20260727-macp{6,7,9,10,11}/`（实战归档：results.md / X-audit-*.md / fix-report.md 等）
- 测试底座：`D:/Codes/multi-agent-collab-platform/`（仅 D5 项目层质量维度需要深读）

## 四、输出规范

**报告路径**（必写，引擎验证用）:
`C:/Users/sir_c/.proma-pro/agent-workspaces/default/.context/trees/audit2/deliverables/D{N}-<dimension>.md`

写完后再 `cp` 一份到 `D:/Codes/tree-harness/audit-20260728/glm-root/D{N}-<dimension>.md`（最终交付位置，用户看这个）。两份都要有。

**报告格式**（强制）:
```markdown
# D{N} <维度名> 审计报告 — Tree Harness FINAL-REPORT 对抗核验

> 审计员: audit2-D{N}-worker (<模型>)
> 审计对象: FINAL-REPORT.md 自评 7/7 + C1=86
> 审计日期: 2026-07-28
> 审计方法: 独立源头文档核验（不读并行审计产物）

## 一、执行摘要
- 总体判定: <FINAL-REPORT 该维度宣称是否真实达成 / 过度宣称 / 部分达成>
- confidence: high/medium/low
- 一句话核心结论

## 二、Findings 表
| # | Severity | 问题摘要 | 证据(file:line/原文/归档) | 对 7/7 或 C1=86 的影响 |
|---|----------|---------|-------------------------|----------------------|
| F1 | 🔴 RED | ... | ... | ... |
| F2 | 🟡 YELLOW | ... | ... | ... |
| F3 | 🟢 GREEN | ... | ... | ... |

## 三、详细分析（每条 RED/YELLOW 必须展开）
### F1 🔴 ...
**位置**: <file:line>
**问题**: ...
**证据**: <原文引用或代码片段>
**后果**: ...
**修复建议**: ...

## 四、该维度对 FINAL-REPORT 真实完成度的结论
- 该维度宣称 X/7 真实达成: <数字>
- 该维度发现的过度宣称: <列表>
- 该维度发现的遗漏: <列表>

## 五、Roadmap 贡献
- P0（阻断级）: ...
- P1（高优）: ...
- P2（中优）: ...
```

## 五、Report Protocol（树协议，按序执行）

1. **brief_echo 首条**（收到 brief 后立即）: `mcp__tree__tree_event_append(tree_id='audit2', leaf_id='audit2-D{N}-worker', type='brief_echo', meta={my_understanding:'<复述你的维度任务>', milestones_preview:['写 D{N}-*.md 报告']})`
2. **独立读源头文档** + 对抗审计
3. **写报告**到 deliverables/ 路径 + cp 到 glm-root/
4. **done event**（带 self_check）: `mcp__tree__tree_event_append(tree_id='audit2', leaf_id='audit2-D{N}-worker', type='done', meta={self_check:[{item:'deliverable 落盘', pass:true, evidence:'<路径>'},{item:'findings severity 分级齐全', pass:true, evidence:'RED×N YELLOW×N GREEN×N'},{item:'独立性保持(未读并行产物)', pass:true, evidence:'仅读源头文档列表'}]})`
5. **等 root 代调**: root 会主动代调 `milestone_set_result(audit_pass=true)` + `audit_gate(pass)`（caller=root 闸门2 放行）。你 done event 后**不用催**，root 在线主动代调
6. **root 通知你后**: 调 `mcp__tree__tree_leaf_set_status(tree_id='audit2', leaf_id='audit2-D{N}-worker', status='done')` 自完成（caller=worker=owner）

## 六、约束

- **国内渠道**: 你是 DeepSeek-v4-pro 或 GLM-5.2（ZLM/DeepSeek 官方）
- **只读不修改**: 不改 tree-engine.cjs / SKILL 源码，只审计出报告
- **findings severity**: red（阻断/过度宣称/安全漏洞）/ yellow（部分覆盖/模糊/间接）/ green（真修/合规/充分证据）
- **深度优先**: 读代码核验非听文档宣称；引用具体 file:line 或归档文件原文
- **预算**: 单 leaf 内可用内置 Agent 工具（进程内），禁用 create_session/fork_session 当 reviewer（macp2 事故教训）

## 七、root 联系

root = audit2-root（GLM-5.2, session=bf983cca-cd23-4406-adfb-25186c4e7c6a, ZLM 渠道）。卡点 send_message 给 root（用 mcp__session__send_message）。
