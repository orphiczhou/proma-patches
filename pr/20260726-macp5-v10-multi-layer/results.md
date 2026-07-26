# macp5 SKILL 改进 — 实施结果（方案 A 纯 SKILL，V10 多层级张力）

> 日期：2026-07-26 | 基于 macp4 实战 V10 多层级张力 + 2 论证子会话共识
> 方案 A（用户选）：纯 SKILL，0 引擎改动
> 论证：d2f72b0f（引擎层）+ 16114f4f（SKILL 层）
> 审计：eecdf7f5（pass_with_minor → 2 YELLOW 修复 → pass）

## 0. TL;DR

macp4 实战暴露 L2 commander 自己 done 撞 V10 三路径墙（E_BORROWED_IDENTITY / E_AUDITOR_NOT_INDEPENDENT / auditor 不 active）。2 论证子会话共识：**不是引擎 V10 硬伤，是树结构错误（auditor 放 commander 子树，added_by 关系）+ root idle gap（平台 bug）**。不改 V10（A1 子树信任锚回归风险高，破坏 L3091 自审禁令）。

方案 A 纯 SKILL：§13.3b 教正确树结构（auditor 挂 root 子节点）+ root 代调协议 + root idle 3 道防线。tree-commander v2.9.3 → v2.9.4，~120 行 SKILL，0 引擎。审计 pass_with_minor → 2 YELLOW（行号引用）修复 → pass。

## 1. 根因（引擎层论证纠偏）

引擎本质是 **L3091**（非任务描述的 L2341）：
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

**root idle gap**（平台 SDK 层，本 PR 不改）：fire-and-forget 派 root 后 root idle，root 代调走不通 → SKILL 教 3 道防线应急。

## 2. SKILL 改动（7 处，tree-commander v2.9.3 → v2.9.4）

| 章节 | 行号 | 改动 |
|------|------|------|
| version | 21 | 2.9.3 → 2.9.4 |
| §4 Step2.1a | 267 | +callout（多层级 root 信任锚警示） |
| §13.0 | 791 | +1 条术语（L2 commander ≠ root） |
| §13.3a 序言 | 851 | +1 句（root 多层级澄清，含 L3107 引用） |
| **§13.3b（新增）** | 886-919 | L2 commander 多层级 done 路径（正确树结构 + root 代调协议 + root idle 3 道防线） |
| §13.4.0 | 930 | +多层级说明（auditor 挂 root 子节点） |
| §13.7 | 1018-1019 | +E_AUDITOR_NOT_INDEPENDENT 条目 + E_BORROWED_IDENTITY 多层级栏注 |

**砍掉**（依赖 A1 引擎扩展，方案 A 不改引擎）：§13.3c（B2 自主 done 双轨）+ §13.4 子树信任锚说明。留作 macp6 候选（若 macp5 实战证 A2 不够再上 A3-2 引擎委派原语）。

## 3. 审计（eecdf7f5，pass_with_minor → pass）

**verdict**：pass_with_minor → 2 YELLOW 修复 → **pass**

**4 GREEN**：
- §13.3b 核心协议与引擎语义对齐（正确树结构 + root 代调 + 三路径诊断全 trace 正确）
- macp2/macp3 单 commander 树回归干净（所有新增 scope 到"多层级树 ≥3 层"，单 commander 树走既有流程不受影响）
- root idle 3 道防线可操作（wait=true 真实工具签名 + 转 2 层树逻辑扁平化可行 + §13.6 兜底已存在）
- §13.7 错误码表 E_AUDITOR_NOT_INDEPENDENT / E_BORROWED_IDENTITY 新增条目准确

**2 YELLOW（已修复）**：
1. **§13.3a 序言 L3091 引用错** → commander 自身 done 实际撞 **L3107** `auditor is the leaf itself`（L3061 找 rootLeaf 失败后落到 L3107；L3091 不触发，因 commander.added_by=root≠commander）。与 macp4 memory A 节实测错误信息一致。
2. **§13.3b L3042 引用错** → root 给 auditor 配门禁走 **L3061** root-as-auditor 分支（L3042 是 L3044 self-audit 注释行；auditor role≠root 不进入 L3044 分支）。

**附注**（非 macp5 范围，未修）：§13.4.0 step A `role='auditor'` 与 §12 命名规范 enum `root|commander|worker` 不一致，但引擎 ROLE_ENUM（L87）含 'auditor' 合法，是 macp2 遗留文档漂移，本轮不拦。

## 4. 部署

| 目标 | 状态 |
|------|------|
| release SKILL（source） | v2.9.4，grep 验证 7 处 + 2 修复全 ✅ |
| pro SKILL（cp 同步） | v2.9.4，diff SAME，旧版 backup `SKILL.md.bak-v2.9.3` |
| 引擎 | 0 改动（纯 SKILL 文档） |

## 5. 后续（macp5 实战验证）

- 派 macp5 实战指挥官（pro，3 层树）验证 §13.3b：L2 commander 用 root 代调协议走通 done + root idle 3 道防线（防线 1 活性探测 + 防线 3a 转 2 层树应急）
- macp5 实战要点：root 指挥官用 **wait=true 派遣**（防线 2）防 root idle gap；auditor 挂 root 子节点（非 commander 子树）
- 项目层 4 缺陷（交测试指挥官，不变）

## 6. 交付物

- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.9.4）
- `D:/Codes/tree-harness/pr/20260726-macp5-v10-multi-layer/`（design + results）
- pro 同步：`C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md`
