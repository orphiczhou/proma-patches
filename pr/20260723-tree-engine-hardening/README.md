# PR 档案：tree-engine 加固（milestone 缺口 + 存储安全）

> 日期：2026-07-23 | 调研/实施/审计均在 release 本地 + pro 远程会话完成
> 触发：多层 commander 树检测（systest2）观察员发现引擎缺口
> 结论：**A+B+C 加固已部署 + 审计收敛（verdict: pass）**

## 背景（为什么做）

systest2 多层检测（root→A-commander→A1-worker）跑通，但观察员用引擎 call-log + 4 份备份交叉核验，发现 **A-commander 的 done 靠了一次直接编辑 tree-state.json**（非引擎 API）：M1 建 milestone 时漏了 expect_outputs（空数组），引擎当时放行 → 后续 set-status(done) 被 E_DELIVERABLE_MISSING 拦 → 加 M2 绕道无效 → 因无 milestone-update API + milestone_add(同id) 被 E_DUPLICATE_LEAF 拒，**只能文件手术**填 M1.expect_outputs 才解开。

根因三连：① milestone_add 不强制 V3（expect_outputs 非空）；② milestone_set_result 不校验空；③ 无 milestone-update API。附带安全隐患：tree-state.json 是明文 JSON，agent 全盘写权限下可绕过所有引擎 caller 身份闸门直接篡改。

## 改进方案（A+B+C+D + 存储议题）

- **A**：milestone_add 强制 V3（reject 空 expect_outputs）——堵入口。
- **B**：milestone_set_result reject 空 expect_outputs——纵深防御。
- **C**：新增 milestone_update API（改 desc/expect_outputs，caller 身份校验，拒绝改已 audit_pass 的）——合法修复路径，消灭文件手术。
- **D**（存储安全）：用户提议 tree-state 改 DB 或 protected-location。**调研结论**：Proma 无 DB 可复用（纯 JSON/JSONL）；agent 全盘写、SDK 无路径沙箱→DB/移目录都防不住直改。**真正有效**：P1(A+B+C) + P2(篡改检测 write_count+hash) + P3(canUseTool 拦 Write/Edit)。本轮做 P1（A+B+C）；P2/P3 留后续。

## 收敛结果

A+B+C 实施到 source（tree-harness/tree-engine.cjs + proma-dev-patches.cjs）→ 部署 dist → 重启 pro → systest3 实测 + abc-audit 独立审计：
- A 生效（空 expect_outputs → E_DELIVERABLE_MISSING，端到端实测）
- C 生效（milestone_update 改 desc/expect_outputs ok + 落盘）
- 零文件手术（write_count 7=7 自洽）
- 缺口闭合（A 堵入口 + C 合法路径 + B 兜底）
- **verdict: pass**（1 条 yellow：补 B 动态测试，非阻断）

## 目录索引

| 路径 | 内容 |
|------|------|
| `01-observer-reports/multilayer-systest2.md` | 多层检测观察员报告（缺口发现，call-log+备份交叉核验）|
| `02-research/storage-hardening-research.md` | 调研报告（Proma 存储 + DB/protected-location 评估 + A+B+C 设计 + 分阶段推荐）|
| `03-results/abc-test.md` | A+B+C 实测（systest3，A 拒空 + C update 验证）|
| `03-results/abc-audit.md` | 独立审计报告（部署核验 + 证据链 + 零文件手术 + 收敛判定）|
| `04-proposal-and-decision.md` | 改进方案 A+B+C+D + 用户存储建议 + 决策记录 |

## 关键文件改动（已 git 提交 tree-harness）

- `tree-engine.cjs`：cmdMilestoneAdd 加 V3 空拒绝（~L2070）、cmdMilestoneSetResult 加空拒绝（~L2163）、新增 cmdMilestoneUpdate（~L2209）+ dispatchMilestone case 'update'（~L5185）。
- `proma-dev-patches.cjs`：buildTreeTable 加 tree_milestone_update 工具条目（~L426）。

## 残留（后续）

- P2（篡改检测 write_count+SHA-256 hash）+ P3（canUseTool 拦 Write/Edit）未做——见 02-research §5 推荐。
- B 的动态触发测试（set-result audit_pass=true on 空 milestone）未补——A 已堵入口，正常路径构造不出，建议后续补纵深证据。
- release（宿主）未部署 A+B+C（避免杀会话）；dev/pro 已部署。
