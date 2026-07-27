# macp7 SKILL 改进 — 实施结果（P0 接力协议 + idle 多维核验）

> 日期：2026-07-27 | 基于 macp6 实战 P0 两项
> 方案：纯 SKILL，tree-commander v2.9.4 → v2.9.5
> 审计：60ba6af9（pass_with_minor → 3 yellow 修 → pass）

## 0. TL;DR

macp6 P0 两项 SKILL 盲区修复：① §13.3b 接力协议补章（segment_add gap + 身份继承矩阵 + emergent 协作 + CLI 应急）② §13.6 idle 多维核验（4 维度 + ≥2 判定）。审计 pass_with_minor → **3 yellow 修（F1/F2/F3 引擎语义事实修正）** → pass。

## 1. 改动（2 处）

### §13.3b 接力协议补章（macp6 实证）
- **segment_add 不改 session_id/added_by**（纯上下文接力）—— 审计 F2 修正（原写"更新 session_id"是事实错误，cmdSegmentAppend L2900 只追加 segment_chain）
- **身份继承矩阵**：v2 可自调 event_append/milestone_add/segment_add；需旧 root 代调 set-status/set-session/milestone_set_result/audit_gate —— 审计 F1 修正（set-status 需旧 root 代调或先 set-session 转所有权，cmdLeafSetStatus L1733 `_isOwner` 双重校验）
- **emergent v2+旧 root 协作**（旧 root 权限锚 + v2 上下文接力）
- **CLI 应急通道**（绕过整个 P1 防线 + 命令按卡点选 + 强制 drift 留痕）—— 审计 F3 补充

### §13.6 idle 多维核验（§13.6.0，macp6 实证）
- 4 维度（mtime + tool calls + ping + heartbeat）
- 判定规则 ≥2 项指向 idle 才 prune
- GLM-5.2 usage_pct 虚高避坑（关联 glm-context-calc-inaccurate memory）

## 2. 审计（60ba6af9，pass_with_minor → pass）

**4 green**：milestone_set_result/audit_gate 矩阵正确 / idle 多维覆盖合理 / emergent 协作方向正确 / macp2-5 回归无忧

**3 yellow（已修）**：
- **F1（P0）**：矩阵 set-status 行"v2 可自调"错 → 改"需旧 root 代调或先 set-session 转所有权"（cmdLeafSetStatus L1733 `_isOwner=caller===leaf.session_id` 双重校验）
- **F2（P0）**：开篇"segment_add 更新 session_id"事实错误 → 改"不改 session_id/added_by"（cmdSegmentAppend L2900 只追加 segment_chain + 改 status）
- **F3（P1）**：CLI 应急说明不足 → 补三句（绕过整个 P1 防借身份防线 + 命令按卡点选 set-session/set-status/milestone_set_result + 强制 tree_drift_append 留痕）

**审计员核心贡献**：读 tree-engine.cjs 核验引擎语义，发现父会话基于 macp6 表象的**事实错误**（segment_add 改 session_id 是 v2 后续 set-session 做的，不是 segment_add 本身）。异厂商 collaboration 核验胜利。

## 3. 部署

- release SKILL v2.9.5 + pro cp SAME + tree-harness/skills git 副本 SAME
- 0 引擎改动（纯 SKILL 文档）

## 4. 后续

- **macp8**：P1 SKILL（audit_log schema severity + auditor ≥2 events + §13.3c emergent 协作教化）+ 小实战验证（接力场景 + idle 探测）
- **macp9**：引擎 segment_add 评估（改引擎同步 added_by vs SKILL 绕过 vs 新增 leaf_transfer_owner 工具）
- **macp10-11**：项目层缺陷3/4 + C1 权威复评 + 综合 + 终版
