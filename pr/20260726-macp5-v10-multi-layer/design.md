# macp5 SKILL 改进 design — V10 多层级张力（方案 A 纯 SKILL）

> 日期：2026-07-26 | 基于 macp4 实战暴露的 V10 多层级张力 + 2 论证子会话共识
> 方案 A（用户选）：纯 SKILL，0 引擎改动
> 论证档案：d2f72b0f（引擎层）+ 16114f4f（SKILL 层），2 delegation resultSummary

## 0. TL;DR

macp4 实战暴露 L2 commander 自己 done 时撞 V10 三路径墙（E_BORROWED_IDENTITY / E_AUDITOR_NOT_INDEPENDENT / auditor 不 active）。2 论证子会话共识：**不是引擎 V10 硬伤，是树结构错误（auditor 放 commander 子树，added_by 关系）+ root idle gap（平台 bug）**。不改 V10（A1 子树信任锚回归风险高，破坏 L3091 自审禁令）。

方案 A 纯 SKILL：B3 概念澄清（L2 commander ≠ root）+ §13.3b 教正确树结构（auditor 挂 root 子节点）+ root 代调协议 + root idle 3 道防线。

## 1. 根因（引擎层论证纠偏）

**引擎本质是 L3091（非任务描述的 L2341）**：
```javascript
// tree-engine.cjs L3091, resolveAuditorIndep 内
if (leaf.added_by && auditorSessionId === leaf.added_by)
  return 'auditor=added_by (self-audit forbidden)';
```
commander 派生的所有 leaf（worker + auditor），commander 都不能配门禁（commander 是 added_by，命中 L3091）。

**macp4 三路径复盘**（commander 给自己 worker 配 milestone_set_result(audit_pass=true, audit_session_id=X)）：
- ① X=root → E_BORROWED_IDENTITY（caller=commander≠root，L2341 拦）
- ② X=commander 自己 → resolveAuditorIndep L3061 找 rootLeaf 失败 → L3091 `auditor=added_by`（worker.added_by=commander）→ E_AUDITOR_NOT_INDEPENDENT
- ③ X=auditor → E_BORROWED_IDENTITY（caller≠auditor）

**macp4 结构错误**：auditor 放 commander 子树（added_by=commander），commander 永远无法给它配门禁。**正确结构**：auditor 挂 root 子节点（commander 的兄弟，added_by=root）+ root 配门禁（root 代调，caller=root===audit_session_id=root，L3061 root-as-auditor 放行）。

**root idle gap**（平台 SDK 层，本 PR 不改）：fire-and-forget 派 root 后 root idle，root 代调走不通 → SKILL 必须教 3 道防线应急。

## 2. 改动点（方案 A，~100-120 行 SKILL）

| 章节 | 行号 | 改动 | 方案 |
|------|------|------|------|
| §4 Step2.1a | 251 | +1 callout（多层级 root 警示，L2 commander 无法自己 done） | B3 |
| §13.0 前置术语 | 783 | +1 条"L2 commander ≠ root"定义 | B3 |
| §13.3a 序言 | 846 | +1 句（'root' 多层级澄清） | B3 |
| §13.4.0 建 auditor leaf | 887 | +多层级说明（auditor 挂 root 子节点，不能在 commander 子树） | A2 |
| **§13.3b（新增）** | 880 后 | L2 commander 多层级 done 路径 + 正确树结构 + root 代调协议 + root idle 3 道防线 | A2/B1 |
| §13.7 错误码表 | 970 | +E_AUDITOR_NOT_INDEPENDENT 条目 + E_BORROWED_IDENTITY 多层级栏注 | B1 |

**砍掉**（依赖 A1 引擎扩展，方案 A 不改引擎故不做）：
- §13.3c（B2 自主 done 双轨）
- §13.4 转正常期子树信任锚说明
- 留作 macp6 候选（若 macp5 实战证 A2 不够再上 A3-2 引擎委派原语）

## 3. §13.3b 核心内容（新增章节，~50 行）

1. **适用场景**：多层级树（≥3 层，root→commander→worker），L2 commander 想给自己或自己子树 worker 配 done 门禁
2. **正确树结构（关键）**：L2 commander 子树的 auditor 必须是 **root 子节点**（commander 的兄弟，`parent=root, added_by=root`），**不能在自己子树下**（`added_by=commander` 会让 commander 永远无法配门禁，L3091）
3. **root 代调协议**：commander 给 worker/auditor 配 milestone_set_result/audit_gate 时，`audit_session_id` 填**树根 root.session_id**（不是 commander 自己），send_message 请 root 代调（caller=root===audit_session_id=root，L3061 root-as-auditor 放行）
4. **root idle 3 道防线**（macp4 实证 root idle gap）：
   - **防线 1（活性探测前置，必做）**：commander 请 root 代调前，先 ping `send_message(root, wait=true)`，3-5s 超时 → 探测失败转防线 3
   - **防线 2（派遣期预防，写进 tree-iterative-development SOP）**：父会话派 root 指挥官用 wait=true，或 fire-and-forget 后立即 ping 确认活
   - **防线 3（root idle 应急）**：① 转 2 层树（prune 中间 commander，root 直管 worker，绕开 L2 done 问题）② §13.6 极端应急（done event + archived 形式闭环）
5. **三路径撞墙应对**：撞 E_BORROWED_IDENTITY/E_AUDITOR_NOT_INDEPENDENT 时，查是否走了"commander 自己配门禁"错误路径 → 改走 root 代调

## 4. 测试计划

1. **SKILL grep 验证**：§13.3b 新增 + §13.0/§4/§13.3a/§13.4.0/§13.7 改动全 ✅
2. **cp pro + restart**：tree-commander v2.9.3 → v2.9.4
3. **macp5 实战验证**（小规模 3 层树）：派指挥官用 §13.3b 走通 L2 commander done + 验证 root idle 3 道防线（尤其防线 1 活性探测 + 防线 3 转 2 层树应急）
4. **回归**：macp2/macp3 单 commander 树不受影响（纯文档改动，引擎零改动）

## 5. 自审 + 审计

- **父会话自审**：SKILL grep + 章节结构检查 + 与 L3091 引擎语义一致性
- **派独立审计子会话**：审查 §13.3b 内容正确性（正确树结构 + root 代调协议 + 3 道防线可操作性）+ 与引擎 L3091/L2341/L3061 语义一致 + macp2/macp3 回归不破

## 6. 交付物

- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.9.3 → v2.9.4）
- `D:/Codes/tree-harness/pr/20260726-macp5-v10-multi-layer/`（design + results）
- pro 同步：`C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md`
