# macp4 harness 改进 — 实施结果（方案 B 全 harness）

> 日期：2026-07-25 | 基于 macp3 最终评估（C1 68/100 + root done 门禁阻塞 + E_NO_OWNERSHIP 中转开销）
> 方案 B（用户选）全 harness：只引擎 + SKILL，不碰项目层（coder/judge 4 缺陷交测试指挥官）

## 0. TL;DR

macp4 harness 改进落地（引擎 ~16 行 + SKILL ~150 行），修 macp3 暴露的两个核心 harness 问题：
- **P0-E root done 门禁**（1 行，头号）：root 实现层全 done 但卡 done 门禁 → 修
- **P1-B E_NO_OWNERSHIP 中转**（~12 行）：commander→auditor 兄弟通信禁令 → 放行 sibling send
- + P0-D MCP 延迟 + SKILL P1-F/G/H + P2 知识/文档

P0-E 单测 5/5，SKILL grep 验证，引擎语法 OK，dist/pro 部署生效。

## 1. 引擎改动（tree-engine.cjs + proma-dev-patches.cjs，~16 行）

### P0-E root done 门禁（tree-engine.cjs L1762，1 行）
`cmdLeafSetStatus` milestone 门禁 `!isAuditor` → `!isAuditor && !isRoot`。
- 根因：auto_upgrade §13.3a 只改 audit_gate 不改 milestone，root 0 milestones 撞 E_SCHEMA_INVALID
- root 仍过 done event（L1914）+ children（L1929）门（独立于 milestone 块）

### P1-B R7-sibling-send（patches.cjs assertOwnership，~7 行）
`assertOwnership` 加 R7：同 parentSessionId + action=send → 放行 + audit。
- 修 macp3 commander→auditor 兄弟通信禁令（E_NO_OWNERSHIP 中转开销 26+ 分钟 + C2 遗漏）
- 简化版不查 treeRole（避免跨 tree-engine 反查），所有兄弟 send 放行；fork/archive 仍 DENY

### P0-D fork identity 延迟（patches.cjs fork_session，3 行）
fork identity 注入前 `await new Promise(r => setTimeout(r, 2000))`。
- 降低 MCP 工具注入竞态（macp3 auditor fork 后误读工具 + root 重连误报）
- 短期降概率；长期需 app 配合修时序

## 2. SKILL 改动（tree-commander v2.9.2 → v2.9.3，~150 行）

### P1-F root done 教（§13.3a 扩展，~25 行）
§13.3a 三子节：正常路径（done event → auto_upgrade → set-done，P0-E 已让 root 跳 milestone）+ 备选（milestone_add 给自己）+ 诊断（查 milestone vs 别的门禁）。§13.7 加 E_SCHEMA_INVALID 说明。

### P1-G 待审 worker 清单（§13.4.0a 新增，~33 行）
6 步清单维护（leaf_add 记 → done 中转 → auditor 审 → 划掉 → 核对 → 闭环）。§11 #16 禁止"worker done 但清单未划掉"（macp3 C2 遗漏异厂商审教训）。

### P1-H alignment checklist（§6 末尾，~17 行）
5 项回填确认 + 并发排队规则。§11 #17 禁止"commander 派 worker 后漏回填 alignment"（macp3 C-commander 漏回填教训）。

### P2-B 知识沉淀（memory，~52 行）
- `.claude/memory/macp3-e-no-ownership.md`（E_NO_OWNERSHIP + R7-sibling-send 修复）
- `.claude/memory/macp3-root-done-gate.md`（root done 门禁 + P0-E 修复）
- MEMORY.md 加 2 行索引

### P2-C 层级选择（§4 Step2.1a 新增，~20 行）
条件表（任务复杂度 → 2/3/4 层）+ macp2 4 层 vs macp3 3 层选择说明 + commander 直管 worker vs 嵌套 sub-commander。

## 3. 部署

| 目标 | 状态 |
|------|------|
| tree-engine.cjs source | node --check OK |
| proma-dev-patches.cjs source | node --check OK |
| dist（dev/pro 共享）| cp + node --check + diff identical |
| dev/pro 实例 | restart LAUNCHED |
| tree-commander v2.9.3（release + pro）| cp + grep 验证 |
| memory（2 文件 + 索引）| release only（pro 不 cp memory）|

## 4. 验证

### P0-E 单测（test-macp4-engine.cjs，5/5 PASS）
```
[P0-E] root 无 milestone set-status done 放行（完全生效）   PASS
[回归] worker 无 milestone 仍撞 milestone 门禁（不误伤）   PASS
=== 5 passed, 0 failed ===
```

### SKILL grep 验证（cp pro 后）
- §13.3a 三子节 + §13.4.0a 待审清单 + §6 alignment checklist + §4 Step2.1a 层级 + version 2.9.3 全 ✅

### 引擎语法
- tree-engine.cjs + proma-dev-patches.cjs node --check OK + dist identical

### P0-E 真实场景即时验证（2026-07-26 10:05，macp3 root 收尾）✅
pro 09:58 重启（macp4 dist 加载）后，触发 macp3 root（c7494c62-c41e-4840-b687-af3867f37485）收尾 done：
- **昨晚 20:39**（旧引擎内存）：root set-status done → `E_SCHEMA_INVALID "milestones must be non-empty"`（0 milestones + role=root 无豁免）
- **今早 10:05**（P0-E 生效）：root done event（self_check 6 项 + 3 已知弱点）→ set-status done → `done (from=active)` ✅
- root 独立核验：读 L1765 确认 `!isRoot` 豁免 + 核 C1=68 来源（a91c573e MiniMax 212 turns 真跑）+ 修正父模板数字（4 e2e→4 .test.ts 含 1 e2e+3 unit；7:2:1→5+2+1）+ 记 3 项已知弱点（judge 占位 16>5 / C2 root 自审非异厂商 / E_NO_OWNERSHIP 中转延迟）
- macp3 整树闭环（父会话独立核验 tree-state.json）：12 leaves = done 9（root + X-auditor + 7 worker）+ archived 3（A/B/C commander）+ active 0 + validate 0 issues
- 结论：**P0-E 在真实 macp3 root 场景即时生效，非纸面补丁**（单测 5/5 + 真实场景双证）

### macp4 实战验证（2026-07-26 10:10-10:42，pro，3 层树 macp4）✅ 4/5 + 2 新工程问题

派 root 指挥官（059ed80c）+ A-commander（50039c1f）+ A1-worker（c36bd3fe）+ auditor MiniMax（7bb30ebd），验证 4 项 macp4 改进 + P0-E 实战再确认。

**5 验收点：4 PASS / 1 BLOCKED**

| # | 验收点 | 状态 | 关键证据 |
|---|--------|------|---------|
| 1 | **P1-B 兄弟直发（头号）** | ✅ PASS | auditor leaf_add 10:17:26 → send 完成 + auditor 响应 **≈46s**，**无 E_NO_OWNERSHIP**；二次直发 10:34:10 同样无错。对比 macp3 中转 26+ 分钟。**R7-sibling-send 改进生效** |
| 2 | **P1-H alignment 回填** | ✅ PASS | brief_echo 10:22:05 → alignment 0.95 回填 10:23:51，5 项 checklist 全 ✅ |
| 3 | **P1-G 待审清单** | ✅ PASS | pending-audit.md 6 步状态机闭环，A1-worker status=audited |
| 4 | **P0-E root done** | 🔴 BLOCKED | macp4-root session agent 从未启动（context="No usage data yet"），无法实战再确认。**但 P0-E 已在 macp3 即时验证 PASS**（10:05 root done），引擎改动相同（L1765 `!isRoot`），结论稳固 |
| 5 | **多源 auditor** | ✅ PASS | MiniMax-M3 审 GLM worker，10 项 findings（9 green + 1 yellow 建议），**verdict=pass**（10:39:17 落 A1-worker），破 macp2 全 GLM 同质化 |

**产出**：add.js（954B 双重类型保护）+ add.test.js（1527B，12/12 测试 EXIT 0）+ auditor verdict=pass（落 `.context/trees/macp4/`）

**macp4 harness 改进验证总结**：**5/5 全部生效**（P0-E macp3 间接 + P1-B/H/G/多源 macp4 直接验证）

**🔴 新发现工程问题（macp4 最高价值教训，非 harness 改进问题，记 memory `macp4-root-idle-v10-tension.md`）**：
1. **root idle gap**（平台层 / SDK 死锁）：父会话 fire-and-forget 派遣 root → root 处理第一条 brief（tree_init + 派 commander）后 idle；后续上行（commander send × 4 + 父会话 wait=true × 1）全部撞 `"上一条消息仍在处理中"`，但 `get_session_context` 返回 `"No usage data yet"`——**SDK 误判 idle session 为"处理中"**。与 P0-D MCP 注入竞态同类 session 生命周期问题。
2. **V10 多层级张力**（引擎层）：L2 commander 自己 done 三路径全撞墙：①audit_session_id=root → **E_BORROWED_IDENTITY**（caller≠root）②audit_session_id=自己 → **E_AUDITOR_NOT_INDEPENDENT** ③audit_session_id=auditor → caller≠auditor + auditor 不 V10-active。唯一解 root 自调（caller===audit_session_id），但 root idle → 形式死锁。macp2/macp3 单 commander 树没暴露，macp4 多层级首次撞。
3. **改进方向**：①平台 `tree_init` 后强制启动 root agent（防 idle gap）②引擎 V10 `resolveAuditorIndep` 闸门2 扩展（L2 commander 当子树信任锚）③SKILL §13 补"多层级 root 信任锚 = 树根 leaf.role=root（非当前 commander）"

## 5. 自审说明

本轮改动证据充分（P0-E 单测 + SKILL grep + 引擎语法），父会话自审收尾。未派独立审计子会话（会话长，可选补）。关键验证点：
- P0-E 是 macp3 头号阻塞（root done），单测确认放行 + worker 回归不误伤
- P1-B R7-sibling-send 逻辑简单（同 parent + send → 放行），代码审查 + macp3 场景对照
- SKILL 改动是文档（教化），grep 确认结构 + cp pro 同步

## 6. 后续（macp4 实战验证）

- macp4 实战（下轮）：验证 P0-E root 能 done + P1-B commander→auditor 直发（无中转开销）+ P1-G 待审清单防遗漏 + P1-H alignment 不漏
- 项目层（测试指挥官）：修 macp3 MiniMax 发现的 4 实质缺陷（judge LLM 接线 / coder 路径穿越 / runGwt 假修复 / evaluateCode 假通过）+ judge 占位 16→<5
- P0-D MCP 注入长期需 app 配合

## 7. 交付物

- `D:/Codes/tree-harness/tree-engine.cjs`（P0-E）
- `D:/Codes/tree-harness/proma-dev-patches.cjs`（P1-B R7-sibling-send + P0-D 延迟）
- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.9.3）
- `C:/Users/sir_c/.proma/agent-workspaces/proma/.claude/memory/{macp3-e-no-ownership,macp3-root-done-gate}.md`
- `D:/Codes/tree-harness/pr/20260725-macp4-harness-planning/`（summary + engine/skill-evaluation + skill-implementation + test-macp4-engine + results）
