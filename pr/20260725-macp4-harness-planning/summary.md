# macp4 harness 改进方案汇总（2 论证子会话后）

> 日期：2026-07-25 | 基于 macp3 最终评估（C1 68/100，root done 门禁阻塞）+ 2 论证子会话
> 范围：**只 harness（引擎 + SKILL），不碰项目层**（coder/judge 4 缺陷 + judge 占位是测试指挥官任务）

## harness 改进矩阵（从 macp3 最终报告提取）

| 项 | 层 | 可行性 | 工作量 | 引擎依赖 | 优先级 | 论证要点 |
|----|----|--------|--------|---------|--------|---------|
| **P0-E** root done 门禁 | 引擎 | 高 | **1 行** | 自身 | 🔴 头号 | `!isAuditor` → `!isAuditor && leaf.role !== 'root'`（L1759）；auto_upgrade 只改 audit_gate 不改 milestone，root 被 milestone 拦；风险极低（root 仍过 done event L1914 + children L1929 门）|
| **P0-D** MCP 注入一致性 | 引擎 | 中 | 3 行 patches + app 长期 | 需 app 配合 | 🔴 | fork/重连 MCP 注入竞态；短期 fork identity 前 2s 延迟；长期 app 侧修时序 |
| **P1-B** E_NO_OWNERSHIP 中转 | 引擎 | 高 | ~12 行 | 自身 | 🟡 | R7-sibling-auditor：leaf_add 写 treeRole + assertOwnership 白名单（同 parent + target.treeRole=auditor → send 放行）；仅 send 开放（不能 fork/archive） |
| **P1-F** SKILL 教 root done | SKILL | 高 | ~25 行 | 不必须（建议 P0-E 配套）| 🟡 | §13.3a 扩展（正常/备选 milestone_add/诊断）+ §13.7 错误码；当前 §13.3a 过于乐观（说"写 done event → set done"但引擎 L1767 拦 milestone）|
| **P1-G** 待审 worker 清单 | SKILL | 高 | ~33 行 | 不必须 | 🟡 | 新增 §13.4.0a（6 步清单维护）+ §11 禁止项；防 C2 遗漏异厂商审 |
| **P1-H** alignment checklist | SKILL | 高 | ~17 行 | 无 | 🟡 | §6 末尾 5 项回填确认 + 并发排队 + §11 禁止项 |
| **P2-B** 知识沉淀 | memory | 高 | ~52 行 | 无 | 🟢 | 2 个 memory 文件（E_NO_OWNERSHIP + root done）+ MEMORY.md 索引 |
| **P2-C** 层级选择文档 | SKILL | 高 | ~20 行 | 无 | 🟢 | §4 Step2.1a 层级选择（macp3 扁平 3 层 vs macp2 4 层）|

## 关键发现

1. **P0-E 是 1 行修复**（头号 + 最简）。macp3 root 卡 done 门禁的根因：`cmdLeafSetStatus` milestone 检查对 role=root 无豁免，auto_upgrade 只管 audit_gate 不管 milestone。修 `!isAuditor` 加 `&& leaf.role !== 'root'` 即可。风险极低（root 仍过 done event + children 门）。

2. **4/5 SKILL 改进无需引擎配合**（P1-G/H/P2 纯 SKILL；P1-F 建议引擎 P0-E 配套使简洁，但不阻塞 SKILL 先改）。

3. **P1-B auditor 白名单**（~12 行）修 E_NO_OWNERSHIP 中转开销——leaf_add 写 treeRole + assertOwnership 白名单。仅 send 开放（留审计日志），不能 fork/archive auditor。

4. **P0-D MCP 注入需 app 配合**（长期），短期 3 行延迟降概率。

## 推荐执行方案（3 选 1，见 AskUserQuestion）

- **方案 A（推荐）harness 核心**：P0-E（1 行）+ P1-B（12 行）+ P1-F/G/H SKILL（75 行）。修 macp3 两个核心 harness 问题（root done 门禁 + E_NO_OWNERSHIP）+ SKILL 教化。
- **方案 B 全 harness**：A + P0-D（MCP 注入）+ P2-B/C（知识 + 文档）。
- **方案 C 最小**：只 P0-E（1 行）+ P1-F（root done 教）。

## 详细论证

- `engine-evaluation.md`（引擎 P0-E/P0-D/P1-B）
- `skill-evaluation.md`（SKILL P1-F/G/H + P2-B/C）
