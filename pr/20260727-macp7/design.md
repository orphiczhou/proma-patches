# macp7 SKILL 改进 design — P0 接力协议 + idle 多维核验

> 日期：2026-07-27 | 基于 macp6 实战 7 新发现中的 P0 两项
> 方案：纯 SKILL（0 引擎改动），tree-commander v2.9.4 → v2.9.5
> 依据：macp6 实战（pr/20260727-macp6/results.md）+ 观察员 MiniMax 完整评价 + memory macp6-segment-relay-gap.md

## 0. TL;DR

macp6 实战暴露 2 个 P0 SKILL 盲区：① segment_add 接力不改 added_by，v2 撞 E_BORROWED_IDENTITY（引擎 gap，SKILL 教绕过）② idle 探测"No usage data"误判 J 实际产出完成被 prune。macp7 纯 SKILL 教化：§13.3b 接力协议补章（身份继承矩阵 + emergent 协作 + CLI 应急）+ §13.6 idle 多维核验（4 维度 + ≥2 判定）。

## 1. 改动 1：§13.3b 接力协议补章

**根因（macp6 drift 19:11:04 实证）**：`tree_segment_add` 更新 leaf.session_id（上下文接力），但不改 added_by（权限链）。root 引擎自建 added_by=null，v2 接力后 leaf.session_id=v2 但 added_by=null → v2 调 set-status 撞 `E_BORROWED_IDENTITY: caller v2 is not the creator (added_by=null)`。

**SKILL 教化（不改引擎）**：
1. **身份继承矩阵**：明确 v2 接力后哪些工具可自调（event_append/milestone_add/set-status）vs 哪些需旧 root 代调（milestone_set_result/audit_gate，V10 caller===audit_session_id 硬约束）
2. **emergent v2+旧 root 协作模式**：macp6 涌现有效（旧 root 权限锚 + v2 上下文接力），建议主动采用 + 协作约定（旧 root 接力后 send_message 告知 v2 约束）
3. **CLI 应急通道**：v2 撞 E_BORROWED_IDENTITY 卡死时 require tree-engine + 省略 callerSessionId（CLI 兼容模式绕过 caller 校验）

## 2. 改动 2：§13.6 idle 探测多维核验

**根因（macp6 J 实证）**：J 21:50 已完成修复，但 send_message 撞队列锁 + get_session_context 返回"No usage data yet"（假信号）→ root 22:00 误判 idle → prune + 重派 J2，浪费 ~10min。

**SKILL 教化**：
1. **4 维度核验清单**：产出文件 mtime + tool calls 计数 + send ping + heartbeat/last_event
2. **判定规则**：≥2 项指向 idle 才 prune；仅"No usage data"或单次 send 撞锁 ≠ idle
3. **避坑**：GLM-5.2 usage_pct 虚高不可信（用户纠正，macp6 实证 661% 实际未溢出）

## 3. 测试计划

1. SKILL grep 验证（§13.3b 接力补章 + §13.6.0 idle 多维 + version 2.9.5）
2. cp release → pro + tree-harness/skills（git 副本）
3. 审计（collaboration，身份继承矩阵引擎语义 + idle 多维可操作性 + CLI 应急安全性）
4. macp8 小实战验证（接力场景 + idle 探测，观察员评价）

## 4. 自审 + 审计

- 父会话自审：grep + 结构检查 + 与 macp6 实证一致
- 派独立审计子会话（collaboration）：审查身份继承矩阵 + idle 多维 + CLI 应急

## 5. 交付物

- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.9.5）
- pro 同步 + tree-harness/skills/ git 副本
- 本 design + results（审计后补）
