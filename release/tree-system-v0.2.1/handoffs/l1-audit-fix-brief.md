# L1 测试报告迭代收敛 — 指挥官任务 Brief

> 下发时间: 2026-06-19 18:00 GMT+8
> 你的身份: 树形指挥官（Release 实例，DeepSeek V4 Pro 官方频道）
> 方法论版本: tree-commander SKILL v2.0 + 结构化文档多Agent终局验证方法论

---

## 0. 你的角色与约束

```yaml
your_role: 树形指挥官（根会话）
your_model: deepseek-v4-pro (DeepSeek 官方频道 56ecefd2)
your_instance: release
workspace_root: "C:\\Users\\sir_c\\.proma\\agent-workspaces\\proma\\workspace-files"
tree_id: l1fix
```

**关键约束**：
- 你的 workspace=null，必须用绝对路径读文件
- 所有子会话（worker）必须使用 `deepseek-v4-pro` 模型
- 使用 MCP `session` 系列工具（本地）创建和管理子会话
- 严格按 tree-commander 方法论执行：规划 → Fork → 下发契约 → 回收 → 整合

---

## 1. 任务定义

**对 L1 remote-session Release 验收测试报告进行迭代修正，修复审计发现的 3 个阻断 + 6 个严重问题，循环验证直到收敛。**

背景：Proma 改造项目的 remote-session MCP 工具（11 个远端工具）已完成 Release 实例验收测试。测试报告（第二版，17:41-18:30）声称"44/44 零失败，READY FOR RELEASE"。但经过 6 个独立 Agent 按「结构化文档多Agent终局验证方法论」审计后，发现了 3 个阻断和 6 个严重问题。报告结论不可采信。

你的任务是：作为指挥官，拆解修复工作为多个子任务，Fork 子会话并行执行，最终产出一份符合方法论标准的、可采信的最终报告。

---

## 2. 审计发现摘要（需修复的问题清单）

### 阻断（必须修）

| ID | 问题 | 修复方向 |
|----|------|---------|
| C-01 | 用例计数无法复算：报告"42/42 通过"但表格求和=40，性能数据"总用例 46"但方案规划 44 | 重新逐项核算，统一所有数字 |
| A3 | 跨 provider 切换覆盖退化：第一次测试(16:00)用 MiniMax 测了且通过，第二次(17:41)却以"GLM 禁令"跳过 | 用可用 provider 补测跨 provider 切换 |
| C1 | "READY FOR RELEASE"存在于未提交文件中，结论未固化 | commit 固化或降级结论 |

### 严重（必须修）

| ID | 问题 | 修复方向 |
|----|------|---------|
| C-02 | 总用例数无来源 | 统一为 44 并注明计算方式 |
| C-03 | 缺少集成测试结果独立表格 | 按方案模板补全 |
| C1(完整性) | 工具 1/2/3 零错误用例，但声称"每工具 ≥ 1" | 补测或修正声称 |
| C3(完整性) | instance="" 参数校验不完整 | 区分"参数缺失"和"空字符串"行为 |
| B1 | model vs model_id 字段不一致被静默丢弃（显示名 vs ID） | 明确追踪：复现→修复 or 记录为已知问题 |
| B4 | 集成覆盖退化(3/3→2/3)无解释 | 补测集成场景 2 或用替代 provider |
| A4 | 并发场景零覆盖 | 至少补 1 个基本并发用例 |

---

## 3. 关键文件

| 文件 | 绝对路径 |
|------|---------|
| 测试方案 | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\plan\remote-session-release-acceptance.md` |
| 当前报告（待修复） | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\remote-session-release-report.md` |
| 第一次测试报告（git版） | 通过 `git show e9a2be3:.context/remote-session-release-report.md` 查看 |
| 审查方法论 | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\Agent生成文档审查方法论参考.txt` |
| 树形体系设计 | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\tree-commander-design.md` |
| tree-commander SKILL | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\skills\tree-commander\SKILL.md` |
| tree-worker SKILL | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\skills\tree-worker\SKILL.md` |
| tree-state.js | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\trees\tree-state.js` |
| commander-methodology | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\commander-methodology.md` |
| 项目索引 | `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\PROJECT-INDEX.md` |

---

## 4. 建议的树形任务结构

```text
l1fix (指挥官)
  │
  ├── A: 补测缺失用例
  │     ├─ 跨 provider 切换 (MiniMax→DeepSeek)
  │     ├─ 工具 1/2/3 错误用例
  │     ├─ 并发 send_message 基本场景
  │     └─ model vs model_id 字段追踪
  │
  ├── B: 报告修正
  │     ├─ 统一用例计数
  │     ├─ 补全集成测试结果表格
  │     ├─ 修正回归检查清单
  │     └─ 修正结论措辞
  │
  └── C: 终局验证
        ├─ 按方法论做四维交叉审查回归
        ├─ 反事实攻击回归
        └─ commit 固化
```

## 5. 契约要求

### DoD (Definition of Done)
1. 所有 3 个阻断问题已修复
2. 所有 6 个严重问题已修复或标记为已知限制
3. 报告用例计数可复算（逐项加总一致）
4. 集成测试结果独立表格已补全
5. 跨 provider 切换已完成补测（至少一种非 DeepSeek provider）
6. model vs model_id 字段不一致已明确追踪结论
7. 最终报告已 commit 到 git
8. 通过终局验证（四维审查回归 + 反事实攻击回归，无阻断/严重新问题）
9. tree-state.json 完整记录全流程（leaves 状态、事件日志、milestones）

### Report 要求
- 每个子会话完成后输出结构化 done 报告
- 最终整合报告覆盖所有修复点
- 报告写入 `workspace-files/.context/remote-session-release-report.md`（覆写当前版本）
- 新增「测试迭代历史」节记录两轮测试的演变

### Autonomy（子会话自主权）
- 子会话可自主选择具体测试参数和验证方式
- 遇到需要决策的模糊点应发 plan 上行，不自行猜测
- 所有 MCP 调用使用 `mcp__session__*` 工具（本地），操作 Release 实例的会话

---

## 6. 执行顺序

1. **先读文件**：指挥官先读完所有关键文件（至少：测试方案、当前报告、审查方法论、tree-commander SKILL、tree-worker SKILL）
2. **规划**：拆解为具体 leaf，每个 leaf 写 brief + dod + report 模板
3. **Fork 子会话**：用 `mcp__session__fork_session` 创建 worker 会话
4. **下发任务**：用 `mcp__session__send_message` 向每个 worker 发送结构化 brief
5. **回收**：worker 完成后回收 done 报告
6. **整合**：汇总所有修复，更新最终报告
7. **验证**：启动终局验证子会话

---

## 7. 成功标准

- tree-state.json 的 `validate()` 返回 `{ok: true, issues: []}`
- 最终报告通过终局验证（四维审查 + 反事实攻击，零阻断/严重新问题）
- git log 显示最终报告 commit
- 整个过程作为 tree-commander v0.2 的真实环境验证案例

---

*本 brief 下发至指挥官会话。指挥官应在首条消息中回复 brief_echo 确认收到，并列出 milestones。*
