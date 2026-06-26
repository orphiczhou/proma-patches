# 会话 1 任务交接 — C→A 流程（命名规范修订 + v0.2 启动）

## 0. 元信息

```yaml
event: handoff_to_new_commander
methodology_version: v1.0
your_session_id: 359188cf-6af9-44eb-9606-ffdc16b817a9
your_role: 新会话指挥官
your_model: deepseek-v4-pro (DeepSeek 官方渠道)
your_workspace: null  # ⚠️ 你的会话没有 workspace，文件访问只能走绝对路径
workspace_root: "C:\\Users\\sir_c\\.proma\\agent-workspaces\\proma\\workspace-files"
```

### ⚠️ 关键约束（必读，违反必失败）

**你的会话 workspace=null**，意味着：
1. ✗ **不要用 Skill 工具加载** `tree-commander` / `tree-worker` / `session-management`（你看不到它们）
2. ✗ **不要用相对路径读文件**（如 `.context/xxx.md` 会失败）
3. ✗ **不要用 Glob/Grep 不带 path 参数**（默认查你的 cwd，可能不在工作区）
4. ✓ **必须用 Read 工具 + 绝对路径**读所有文档（如 `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\commander-methodology.md`）
5. ✓ **Glob/Grep 必须带 path 参数**指定工作区目录的绝对路径
6. ✓ **遇到"SKILL.md 缺失"错误时立即停止**——这是因为 workspace=null，不是真缺失。文件实际存在，用 Read 读绝对路径即可

`workspace_root` = `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`，所有 `.context/` 文档和 `skills/` 都在这个根下。

## 1. 任务一句话定义

**修命名规范歧义（C 任务）→ 启动 v0.2 设计与实施（A 任务）**。两步顺序执行，C 完成后立即推进 A。

## 2. 背景

你是「Proma 改造探索」工作区的新指挥官会话。前任指挥官完成了「树形会话执行体系 v0.1」的全流程（设计→实施→审计→修复→回归→S1 测试→最终验收）。**v0.1 已通过验收**，但有 2 个待办需要你接手：

- **C 任务**（v0.1.1 命名规范歧义修复）：设计文档 §6.5 没说清 prefix 不能含连字符，导致 `proma-guide` 这类常见命名不合法。需要修设计文档 + 同步修 tree-state.js 正则。
- **A 任务**（v0.2 启动）：按设计文档 §9.1，v0.2 范围是「加心跳通道 + 内部自审 + 三档纠偏」。

前任指挥官已经把方法论沉淀到 `.context/commander-methodology.md`，**你必须按这套方法论工作**。

## 3. 必读资料（按顺序读完，约 20 分钟）

```
1. workspace_root/.context/commander-methodology.md     # 方法论 v1.0（你工作的"宪法"）
2. workspace_root/.context/tree-commander-design.md     # 体系设计文档（9 章 + 4 补丁 + 附录 A）
3. workspace_root/.context/v0.1-audit-report.md         # v0.1 审计报告（含已知问题 S1-S5/T1-T4）
4. workspace_root/.context/s1-test-plan.md              # S1 测试方案（v0.1 通过验收的依据）
5. workspace_root/.context/note.md                      # 项目级长期笔记
```

`workspace_root` = `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`

## 4. 任务详细描述

### C 任务：命名规范歧义修复（预计 30 分钟）

**问题**：设计文档 §6.5 写 prefix "4-8 字符"，但没说不能含连字符。实际 tree-state.js 的 LEAF_NAME_RE 正则 `(\w+)` 不含 `-`，所以 `proma-guide` / `web-v3` 这类含连字符的命名会被 `E_NAME_INVALID` 拒绝。这是设计文档与实现不一致的歧义。

**修复要求**（按 v0.1.1-S1 审计建议）：

1. **修设计文档 §6.5**（`tree-commander-design.md`）：
   - 在「格式」段加一行明确约束：**prefix 段正则 `[a-z][a-z0-9_]{3,7}`（小写字母开头，4-8 字符，不含连字符）**
   - 在「完整示例」段补一列说明：所有 prefix 必须无连字符（如 `nanju` ✅ / `proma-guide` ❌ → 用 `pguide`）
   - 同步说明 role 段约束（建议也用 `[a-z][a-z0-9_]*`，但保持 v0.1 兼容，role 可暂时宽松）

2. **修 tree-state.js LEAF_NAME_RE**（`workspace_root/.context/trees/tree-state.js`）：
   - 当前：`^(\w+)-([A-Z]\d*(?:[a-z]\d*)*)?-(\w+)(?:-(s\d+|i\d+))?$`
   - 改为：`^([a-z][a-z0-9_]{3,7})-([A-Z]\d*(?:[a-z]\d*)*)?-(\w+)(?:-(s\d+|i\d+))?$`
   - 注意：保留 path 段（如 `A1a`）和 suffix 段（`s\d+`/`i\d+`）不变
   - 同步更新正则上方的注释，说明 prefix 约束

3. **跑回归验证**：
   - 用 s1-test-plan.md §3 的命令序列跑前 10 步（init + leaf add × 2 + A 的 milestone 流程），验证 `pguide-A-flow` 仍合法
   - 跑 1 个负例：`leaf add ... --json '{"leaf_id":"bad-prefix-A-x",...}'` 应被拒绝（prefix 含连字符）
   - 测试完清理 tree 目录

4. **同步更新 commander-methodology.md §4.4**（"可以改进"段第 1 条）：把"命名规范在设计阶段没有完全锁定（实施时才发现 prefix 不能含连字符）"改写为更准确的描述（参考 v0.1-audit-report.md S1 段）。

### A 任务：v0.2 设计与实施启动（预计 2-4 小时）

C 任务通过后立即推进 A 任务。**v0.2 范围**（按设计文档 §9.1）：
- 心跳通道（Proma automation + 哨兵 Agent）
- 内部自审（每个会话内 Fork code-reviewer Agent）
- 三档纠偏（轻档 nudge / 中档限权 / 重档剪枝）

**实施方法**（按 commander-methodology.md §2 五步法）：

1. **任务规划**（TaskCreate）：把 v0.2 拆成 5-7 个子任务
2. **方法论传递**：每个子任务的子 Agent prompt 按 §3 七段式（背景/必读/任务/流程/约束/禁止/格式）
3. **派子 Agent 并行执行**：v0.2 涉及多个独立模块（心跳 spec / 内审 prompt / 纠偏决策树 / 哨兵 Agent / 心跳 automation），尽量并行
4. **多维度审计**：每个产出派 code-reviewer 审计
5. **trust but verify**：关键功能（如心跳真的能唤起 / 竹节交接真能保存上下文）必须独立验证

**v0.2 必修的 v0.1.1-S3**（Windows rename 重试 3-5 次 + 退避）—— 在 v0.2 首个 PR 顺手修，因为 v0.2 心跳场景必现并发。

**v0.2 故意不做**（YAGNI，按方法论原则 7）：
- 模板复用（v1.0）
- Mermaid 可视化导出（v1.0）
- 完整的跨工作区协作

## 5. 工作流程

### Step 1：加载方法论 + 必读资料（20 分钟）
按 §3 顺序读完 5 个文档。**不读不能开工**——你会跑偏。

### Step 2：C 任务（30 分钟）
1. 修设计文档 §6.5
2. 修 tree-state.js 正则 + 注释
3. 跑 s1-test-plan.md 前 10 步验证
4. 跑 1 个负例验证拒绝
5. 清理测试 tree
6. 修 commander-methodology.md §4.4 描述

### Step 3：C 任务自审 + 独立验证（10 分钟）
- 派 code-reviewer 子 Agent 审计你修的 3 个文件
- 重建小规模场景实测（如方法论的 trust but verify 原则）
- 不通过 → 回到 Step 2

### Step 4：A 任务 - v0.2 设计（30-60 分钟）
- 在 `tree-commander-design.md` 末尾加 v0.2 章节
- 5 个模块各 200-300 字 spec
- 派 researcher 子 Agent 调研"Proma automation + 哨兵 Agent 的最佳集成方式"（可选）

### Step 5：A 任务 - v0.2 实施（1-2 小时）
- 拆 5-7 个子任务（TaskCreate）
- 并行派子 Agent 实施（tree-state.js 加心跳命令 / tree-commander SKILL 加心跳调度 / tree-worker SKILL 启用内审 / 等等）
- 每个产出派 code-reviewer 审计

### Step 6：A 任务 - 端到端测试（30-60 分钟）
- 设计 v0.2 的 S2 测试方案（含心跳触发 + 内审触发 + 纠偏触发）
- 派子 Agent 实施测试
- 派子 Agent 验证

### Step 7：沉淀 + 报告（10 分钟）
- 把 v0.2 设计章节、测试方案、测试报告写到 `.context/`
- 更新 commander-methodology.md §8 修订历史（加 v1.0.1 / v1.1）
- 返回最终报告

## 6. 禁止行为（铁律）

按 commander-methodology.md §6 反模式表，**特别强调**：

1. ✗ **不亲自写代码**——所有实施派子 Agent
2. ✗ **不给子 Agent 一句话任务**——必须 7 段式 prompt
3. ✗ **不信任子 Agent 的"已完成"**——必须独立验证
4. ✗ **不直接读写 tree-state.json**——必须调 tree-state.js 子命令
5. ✗ **不一次性给完整方案**——分章节、分模块、每步确认
6. ✗ **不沉淀文档**——重要产出必须落盘到 `.context/`
7. ✗ **v0.2 想做所有事**——YAGNI，明确边界
8. ✗ **修复后不回归**——必须 R1-R3 跑一遍
9. ✗ **用 rm -rf 清理测试 tree**——用 archive 或显式删 tree 目录但保留 drift_log 历史
10. ✗ **方法论自身不迭代**——v0.2 完成后必须更新 §8 修订历史

## 7. 返回报告格式（最终交付）

完成后向你的指挥官（主会话）发 markdown 报告：

```markdown
# 会话 1 (C→A) 完成报告

## 总评
✅ 通过 / ⚠️ 有条件通过 / ❌ 不通过
一句话结论

## C 任务执行结果
- 设计文档 §6.5 修改：✅/❌
- tree-state.js 正则修改：✅/❌
- 回归测试：✅/❌
- commander-methodology §4.4 修改：✅/❌
- C 任务审计结果：✅/❌

## A 任务执行结果
- v0.2 设计章节：✅/❌（行数 / 字数）
- v0.2 实施子任务数：N
- v0.2 实施审计通过率：N/M
- v0.2 S2 测试方案：✅/❌
- v0.2 S2 测试实施：✅/❌
- v0.1.1-S3 修复：✅/❌
- v0.2 最终判定：✅ 通过 / ⚠️ 有条件通过 / ❌ 不通过

## 关键决策点（5-10 条）
- 决策 1：... 理由：...
- 决策 2：... 理由：...

## 发现的问题
- 编号、问题、严重程度、建议修复版本

## 产出文件清单
（绝对路径列表）

## 建议下一步
（v0.3 启动条件 / v0.2.1 待办 / 等）
```

报告字数控制在 **< 2000 字**。

---

## 关键提醒

1. **你的 session_id 是 `7fe2a2e4-332c-4b05-9557-232815c2b44f`**，标题是「C-A: 命名规范 + v0.2 启动」（显示乱码是终端编码问题，不影响实际）
2. **不要修改其他会话的产出**（特别是会话 2 在做的 B 任务）
3. **遇到不确定时优先用 AskUserQuestion 问主会话**（通过 send_message 给主会话发问题）
4. **完成或卡住时**用 send_message 把报告/卡点发回主会话（主会话 session_id 通过 get_my_session_id 获取主会话上下文）
5. **如方法论与设计文档冲突，以方法论为准**（v1.0 方法论是 v0.1 验收后沉淀的，比设计文档更新）
