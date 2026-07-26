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

## 5. macp5 实战验证（2026-07-26 20:46-21:03+，pro，3 层树 macp5）✅ §13.3b 验证成功

派 root 指挥官（d3c56ae2）+ A-commander（a61b4e09）+ A1-worker（d6b6fc5a）+ auditor MiniMax（296a9c12），验证 §13.3b（L2 commander 多层级 done 路径）。

**5 验收点：全 PASS**（A-commander 最终报告 + 父会话 tree-state 核验）

| # | 验收点 | 状态 | 关键证据 |
|---|--------|------|---------|
| 1 | auditor parent=macp5-root（正确结构） | ✅ PASS | tree-state: macp5-auditor.parent=macp5-root（commander 兄弟，非 commander 子树）；added_by=d3c56ae2(root)。macp4 结构错误规避 |
| 2 | commander send 请 root 代调 | ✅ PASS | comm_log 2 次代调记录（worker 门禁 @20:50 + commander 门禁 @20:55），走 root 代调协议 |
| 3 | root 代调成功 | ✅ PASS（观察员精确化）| worker milestone M1+audit_gate pass @20:52:47 + commander milestone M-self audit_pass=true @20:57:29（commander audit_gate 始终 skip，用 done event 直接 done，详见发现 1）+ auditor audit_gate pass @21:04:39，caller=root===audit_session_id=root，L3061 放行，**零 E_BORROWED_IDENTITY/E_AUDITOR_NOT_INDEPENDENT**（仅 1 次 E_AUDIT_PREMATURE drift auto-corrected）|
| 4 | commander done 走通 | ✅ PASS | milestone M-self（root 代调）+ done event（自调 @20:58:14）+ set-status done（active→done）。**未撞 V10 三路径墙**（macp4 撞墙规避）|
| 5 | root 活 | ✅ PASS | 响应延迟 < 3 分钟（20:50→20:52 + 20:55→20:57），macp4 root idle 规避 |

**重大发现（A-commander 报告 + 父会话 tree-state 核验）**：
1. **commander done 不需 audit_gate pass（commander 角色 audit_gate 初始="skip"，设计如此）**：实战 commander audit_gate.verdict="skip"（始终，无 auto_upgrade 标志），set-status done 直接放行。**真正机制（观察员 MiniMax-M3 异厂商独立核验修正）**：commander 角色 audit_gate 初始状态被引擎设为 "skip"（设计如此，非临时状态），done event + set-status done 即可，无需 audit_gate 升级路径——**区别于 root P0-E 的 auto_upgrade=true**（root 有 auto_upgrade 标志，commander 没有；A-commander 报告的"auto_upgrade skip→pass"不准确，观察员异厂商核验修正）。drift E_AUDIT_PREMATURE（20:57:31）= root 试图显式调 audit_gate for commander 撞 "no done event"，commander 写 done event @20:58:14 后直接 set-status done（无需重试 audit_gate）。**§13.3b 可简化**（macp6 候选）：删 commander audit_gate 代调步骤，只保留 root 代调 milestone_set_result + done event。
2. **L3061 信任锚优先于 L3091**：root 能给 added_by=root 的 commander 配 milestone_set_result（未撞 L3091 `auditor=added_by`）。L3061 root-as-auditor 分支优先。

**收尾完成 ✅（21:05 全树闭环）**：auditor 第5次提醒 @21:04:12 → root 代调 audit_gate pass @21:04:39 → auditor set-status done @21:04:55 → root 自己 done @21:05:01。**全树 4 leaves 全 done**（root:pass + commander:skip + auditor:pass + worker:pass），macp4 root idle gap 规避（root 活到最后，响应 auditor 第5次提醒）。

**§13.3b 实战验证结论（全链路闭环 ✅）**：
- ✅ 正确树结构（auditor 挂 root 子节点）是 macp4 结构错误的正解
- ✅ root 代调协议（caller=root===audit_session_id=root，L3061）让 L2 commander 走通 done
- ✅ macp4 root idle 规避（root 活，响应 < 3 分钟，全程零 idle）
- 📝 §13.3b 可简化（audit_gate 不需要，只要 milestone_set_result root 代调 + done event）—— macp6 候选 SKILL 优化
- 🎯 **macp4 撞墙的 V10 三路径（E_BORROWED_IDENTITY/E_AUDITOR_NOT_INDEPENDENT/auditor 不 active）在 macp5 全部规避，零撞击**

**产出**：add.js + add.test.js + add.note.md（落 .context/macp5-verify/）+ worker 12/12 测试 EXIT 0

**观察员独立核验（MiniMax-M3 异厂商，session=4d3aea3d）**：verdict 认同主体结论（5 验收点 PASS + 2 重大发现认同），差异 3 项已采纳（发现 1 机制修正 + 验收点 3 精确化 + auditor 占位说明）。异厂商视角发现父会话采纳 A-commander 不准确报告（"auto_upgrade"），修正为"commander 初始 skip"。

**⚠️ auditor 占位提醒（观察员差异 3）**：本次 auditor 是"结构验证占位"（brief_echo 明示 mission=结构验证 auditor 占位，未实际审查工作）。§13.3b 验证的是**树结构 + 代调协议**，**不是实际审计质量**——不可推论为"独立异厂商 auditor 审查通过 worker 工作"。

## 6. 后续

- 项目层 4 缺陷（交测试指挥官，父会话不改）：judge LLM 接线 / coder 路径穿越 / runGwt 假修复 / evaluateCode 假通过
- §13.3b 简化（macp6 候选）：commander done 不需 audit_gate pass，SKILL 可删 audit_gate 步骤（实战发现 audit_gate="skip" 也 done）
- root idle gap 长期需平台修（tree_init 强制启动 root agent）

## 7. 交付物

- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.9.4）
- `D:/Codes/tree-harness/pr/20260726-macp5-v10-multi-layer/`（design + results）
- pro 同步：`C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md`
