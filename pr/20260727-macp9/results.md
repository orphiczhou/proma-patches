# macp9 引擎 segment_add 评估 — 实施结果（论证 + SKILL 纠错）

> 日期：2026-07-27 | 基于 macp6 segment_add gap + macp7 §13.3b 接力协议落地后评估
> 论证：2943d36f（引擎层）+ 36ce02a6（SKILL 绕过层）
> 决策：短期 A3（SKILL 纠错）+ 中期 A2（leaf_transfer_owner，留 macp11/12 候选）

## 0. TL;DR

macp9 评估 segment_add gap 是否改引擎根治。2 论证子会话共识：**A1（改 added_by 单字段）永久否决**（破坏 V10 信任锚 L3091）；**A2（新增 leaf_transfer_owner）最优**（~50 行，复用 segment_chain 授权）；**A3（SKILL 绕过）兜底**（短期性价比最高）。本轮走 A3（SKILL 纠错 macp7 矩阵 milestone_add 错 + 补 audit_append + emergent 精化 + 失联/多级预案）+ memory 纠正。A2 留 macp11/12 候选（接力高频证据）。

## 1. 论证结论（2 子会话）

### 引擎层（2943d36f）
- **A1 改 added_by 单字段** ❌ 永久否决：破坏 V10 自审禁令 L3091（auditor=added_by）的判据 + 所有 _isCreator 路径 + collectValidateIssues L3254。改单字段 = 推翻 macp2-6 P1 防借身份修复的语义地基
- **A1' 新增 added_by_chain 数组** 🥈 次选：不破坏 L3091，但需扩展 4-5 处 _isCreator 的 includes 判断（回归面中）
- **A2 新增 leaf_transfer_owner 工具** 🥇 最优（若改引擎）：~50 行，复用 segment_chain 做授权凭据（只有接力进链的 session 能调），不动 added_by，回归面小
- **A3 纯 SKILL 绕过** 🥉 兜底：macp7 §13.3b 已完备，0 引擎改动

### SKILL 绕过层（36ce02a6）
- 完备性 = **中**（主力覆盖 + CLI 应急 + V10 底线守住，但有缺口）
- 🔴 **缺口 1（必修）**：macp7 矩阵 milestone_add 标错（cmdMilestoneAdd L2248 三重校验，v2 撞 E_BORROWED_IDENTITY）
- 🟡 缺口 2-4：audit_append 遗漏 / 旧 root 失联预案缺失 / 多级接力权限锚未定义
- 推荐：立即修 SKILL + 中期 A2 引擎轻改

## 2. 决策：短期 A3 + 中期 A2

- **本轮 macp9**：A3 SKILL 纠错（零风险，立即可做）
- **macp11/12 候选**：A2 leaf_transfer_owner（若 macp10-11 接力高频 ≥3 次/项目 或旧 root idle 拖累闭环）
- **A1 永久否决**

## 3. SKILL 纠错（tree-commander v2.9.6 → v2.9.7）

1. **矩阵 milestone_add 行**：从"✅ v2 可自调"改"❌ 需旧 root 代调"（macp9 论证修正 macp7 错）
2. **矩阵补 audit_append 行**：需 auditor 自调或旧 root 代调（dispatchAudit L3974 caller 校验）
3. **emergent 协作 v2 能力精化**：v2 只能 event_append + leaf_get + 写报告（macp7 说"v2 做 milestone_add/set-status"错，全需旧 root 代调）
4. **旧 root 失联预案**：v2 接力后 ping 探测 → 活走 emergent / 失联走 CLI 应急 + drift 留痕 / 失联超 10min 上行父会话
5. **多级接力权限锚**：v_n 权限锚都是 v1（树根）；建议避免多级，优先 leaf_set_session 一次转所有权

## 4. memory 纠正

`macp6-segment-relay-gap.md` A 节：原写"segment_add 更新 leaf.session_id"不准（macp7 审计 60ba6af9 核验：segment_add 只追加 segment_chain，不改 session_id；macp6 tree-state root.session_id=v2 是 v2 后续 set-session 改的）。已纠正。

## 5. 部署

- release SKILL v2.9.7 + pro cp SAME + tree-harness/skills git 副本 SAME
- 0 引擎改动（A3 纯 SKILL）

## 6. 后续

- **macp10**：项目层缺陷3/4（交测试指挥官）+ C1 权威复评
- **macp11**：综合实战 + harness 完成度评估；若接力高频证据出现 → 上 A2 leaf_transfer_owner
- A2 实施大纲（备用，~50 行）：`cmdLeafTransferOwner(tree_id, leaf_id, new_session_id)`，caller 必传 + `segment_chain.includes(caller)` 校验 + 复用 cmdLeafSetSession 唯一性/registerSessionToState + status=active + drift 留痕
