# 会话 2 任务交接 — B 流程（真实环境跑 v0.1）

## 0. 元信息

```yaml
event: handoff_to_new_commander
methodology_version: v1.0
your_session_id: 63b4e61a-5b0e-479a-82e9-0cbb481a30d8
your_role: 新会话指挥官（v0.1 真实环境验证官）
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
7. ✓ **作为指挥官工作时**：把 `tree-commander/SKILL.md` 的内容用 Read 读出来，然后**按其 14 条铁律 mentally apply**——你不需要"加载"它，只需要遵循它

`workspace_root` = `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`，所有 `.context/` 文档和 `skills/` 都在这个根下。

## 1. 任务一句话定义

**在真实环境（不模拟）加载 tree-commander Skill 跑一个端到端的小型真实任务，验证 v0.1 在生产场景下确实可用**。

## 2. 背景

「树形会话执行体系 v0.1」已通过 S1 测试，但 S1 是**模拟测试**——用 tree-state.js 直接跑命令，不真的 Fork 会话。**B 任务要补这个缺口**：在真实 Proma 环境下加载 tree-commander Skill，跑一个真实的小任务（非模拟），验证：

- tree-commander Skill 能正确触发并被加载
- tree-worker Skill 在 Fork 出来的子会话能正确触发
- HTTP 直连创建会话 + send_message 真能完成"指挥官派子会话干活"
- tree-state.js 的状态变迁能反映真实会话生命周期
- 端到端契约下发 + 事件上报 + done + 整合的完整流程能跑通

前任指挥官已经把方法论沉淀到 `.context/commander-methodology.md`，**你必须按这套方法论工作**。

## 3. 必读资料（按顺序读完，约 25 分钟）

```
1. workspace_root/.context/commander-methodology.md     # 方法论 v1.0（你工作的"宪法"）
2. workspace_root/.context/tree-commander-design.md     # 体系设计文档
3. workspace_root/skills/tree-commander/SKILL.md        # tree-commander Skill（你要加载用）
4. workspace_root/skills/tree-worker/SKILL.md           # tree-worker Skill（子会话加载）
5. workspace_root/.context/s1-test-plan.md              # S1 模拟测试方案（参考但不复用）
6. workspace_root/.context/trees/tree-state.js          # 状态脚本（直接调用）
7. workspace_root/.context/v0.1-audit-report.md         # 已知问题（避免触发）
```

`workspace_root` = `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`

## 4. 任务详细描述

### Phase 1：环境准备（15 分钟）

1. **获取主会话信息**：
   - `get_my_session_id` → 拿到自己的 session_id
   - 这是你的指挥官身份

2. **环境约束确认**：
   - 工作区 MCP 配置中 `proma-dev-session` 是**禁用**的
   - 你**没有** `mcp__session__*` 工具
   - 但可以用 **HTTP 直连**（curl + Bash）创建/管理子会话
   - Dev 实例在 `127.0.0.1:19876`（已确认在线）

3. **HTTP 直连速查**（来自 session-management Skill 模式 7）：

```bash
# 扫描端口（如不确定）
for port in $(seq 19876 19895); do
  curl -s --connect-timeout 1 "http://127.0.0.1:$port/get_instance_info"
done

# 创建子会话
curl -s -X POST "http://127.0.0.1:19876/create_session" \
  -H "Content-Type: application/json" \
  -d '{"channel_id":"proma-official","model_id":"claude-sonnet-4-6","title":"子会话 X"}'

# 发消息（wait=true 同步等待）
curl -s -X POST "http://127.0.0.1:19876/send_message" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"<sid>","message":"...","wait":true}'

# 查消息历史
curl -s -X POST "http://127.0.0.1:19876/list_messages" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"<sid>","limit":10}'
```

**注意**：响应是 MCP 包装的 JSON-RPC（外层 `{content:[{text:"..."}]}`，内层才是真 JSON）。grep 提取 session_id 时记得字符是 `\"id\"` 转义的。

### Phase 2：选择真实任务（10 分钟）

挑一个**有真实价值的小任务**作为验证场景。建议（按推荐度排序）：

**选项 A（推荐）**：用 tree-commander 写一份「Proma v0.2 启动公告」
- 真实业务价值：给项目团队看
- 复杂度：3-4 个子任务（公告草稿 / 技术细节 / 迁移指南 / 整合）
- 验证维度全：契约下发 / 事件路由 / 内审 / done / 整合

**选项 B**：用 tree-commander 整理 v0.1 验收文档
- 真实业务价值：归档项目记录
- 复杂度：2-3 个子任务

**选项 C（自定）**：你自己挑，但必须满足：
- 至少 2 个并行子任务
- 至少 1 个需要孙会话（子任务的子任务）
- 最终有 1 个整合会话产出单文件
- 真实可交付（不是为测试而测试）

**选定后**，把任务 brief 写到 `.context/handoff/b-task-brief.md`。

### Phase 3：作为指挥官执行任务（60-90 分钟）

按 commander-methodology.md §2 五步法：

1. **加载 tree-commander Skill**：
   - 调用 `Skill(skill="proma-workspace-proma:tree-commander")`
   - Skill 加载后你就成为指挥官
   - 严格按 Skill 里的 14 条铁律工作

2. **任务规划**（TaskCreate）：
   - tree_id = `bverify`（5 字符，全小写，不含连字符）
   - 拆 2-3 个子任务，每个有明确 brief/dod
   - 标记依赖（整合会话等所有子任务）

3. **初始化 tree-state**：
   ```bash
   node tree-state.js init bverify --root-brief '{...}' --root-dod '{...}'
   ```

4. **派子会话（HTTP 直连创建）**：
   - 对每个子任务：
     - `curl create_session` 创建子会话（**不用 fork_session，因为本次不需要继承你的指挥官上下文**——子会话是独立工作单元）
     - `curl send_message` 发 4 件套契约（按 tree-commander SKILL §6 模板）
     - 子会话首条消息要求加载 `tree-worker` Skill
   - 并行派（独立任务）

5. **事件路由 + 偏差检测**：
   - 子会话 brief_echo 上来 → 派路线图 Agent（subagent_type=researcher）审对齐度
   - 子会话 done 上来 → 派验收 Agent（subagent_type=code-reviewer）
   - 任何偏差走三档纠偏

6. **整合会话**：
   - 所有子任务 done 后
   - 派整合会话（也可以是新建的会话，**不 Fork**，因为整合是独立任务）
   - 发 brief + 所有子会话产出路径

7. **最终验收 + tree-state 完结**：
   - 整合会话 done → 验收 Agent 终审
   - `node tree-state.js leaf set-status bverify <integration-leaf> done`
   - `node tree-state.js validate bverify` → 应返回 `{ok:true, issues:[]}`

### Phase 4：审计与报告（30 分钟）

1. **派 code-reviewer 子 Agent 审计整个流程**：
   - tree-state.json 最终状态是否正确
   - 子会话产出质量是否达标
   - 是否有偏离 v0.1 spec 的地方
   - 是否触发了 v0.1 已知问题（S1-S5）

2. **沉淀文档**：
   - `.context/b-verify-report.md`：B 任务完整执行报告
   - 更新 `.context/note.md`：追加 v0.1 真实环境验证结果条目

3. **清理**：
   - 测试用的子会话归档（`curl archive_session`）
   - 但**保留** bverify tree-state.json（作为 v0.1 真实环境证据）

## 5. 工作流程（推荐顺序）

### Step 1：加载方法论 + 必读资料（25 分钟）
**不读不能开工**——你会跑偏。特别是 commander-methodology.md §1 十条原则。

### Step 2：环境准备（15 分钟）
按 Phase 1 走。

### Step 3：选任务 + 写 brief（10 分钟）
按 Phase 2 选项 A 推荐。把 brief 写到 `.context/handoff/b-task-brief.md`。

### Step 4：执行任务（60-90 分钟）
按 Phase 3。**严格按 commander-methodology.md §2 五步法**。

### Step 5：审计 + 报告（30 分钟）
按 Phase 4。

## 6. 禁止行为（铁律）

按 commander-methodology.md §6 反模式表，**特别强调**：

1. ✗ **不亲自写子任务产出**——派子会话写
2. ✗ **不用模拟方式**（不直接跑 tree-state.js 假装是子会话）——必须真 Fork/create 真实子会话
3. ✗ **不给子会话一句话任务**——必须 4 件套契约 + 让子会话加载 tree-worker Skill
4. ✗ **不直接读写 tree-state.json**——必须调 tree-state.js 子命令
5. ✗ **测试完不清理子会话**——必须 archive（保留可追溯）
6. ✗ **bverify tree-state.json 删掉**——必须保留作为 v0.1 真实环境证据
7. ✗ **触发 v0.1 已知问题**（特别是 S1 命名正则边界——避免用 `A-eval`/`n-root`/`NANJU-ROOT`/`nanju--eval`）
8. ✗ **超出 v0.1 范围**（v0.1 不做心跳/内审/竹节，B 任务也别用这些）
9. ✗ **不沉淀报告**——b-verify-report.md 必须落盘

## 7. 返回报告格式（最终交付）

完成后向你的指挥官（主会话）发 markdown 报告：

```markdown
# 会话 2 (B) 完成报告 — v0.1 真实环境验证

## 总评
✅ 通过 / ⚠️ 有条件通过 / ❌ 不通过
一句话结论：v0.1 在真实环境（非模拟）下 [能/不能] 端到端工作

## 选定的真实任务
- 任务名：...
- 子任务数：N
- tree_id：bverify
- 业务价值：...

## 执行结果

### 指挥官侧
- 加载 tree-commander Skill：✅/❌
- 任务规划（TaskCreate）：✅/❌
- tree-state 初始化：✅/❌
- 派子会话（HTTP 直连）：✅/❌ N 个
- 事件路由：✅/❌
- 偏差检测（如有）：...
- 整合会话：✅/❌
- 最终验收：✅/❌

### 子会话侧
- 加载 tree-worker Skill：N/M 个成功
- brief_echo 上报：N/M 个
- milestones 拆解：N/M 个
- done 上报：N/M 个
- self_check 完整：N/M 个

### tree-state.json 最终状态
- write_count: ?
- leaves 总数: ?
- drift_log 长度: ?
- heartbeat_log 长度: ?（v0.1 应为 0，没启心跳）
- validate 结果: ?

### 真实产出（业务交付物）
- 文件路径: ...
- 内容摘要: ...

## 发现的问题
- 编号、问题、严重程度、是否阻断、建议修复版本
- 特别标注是否触发 v0.1 已知问题（S1-S5）

## 审计结果
- code-reviewer 审计判定：✅/⚠️/❌
- 关键发现：...

## 产出文件清单
（绝对路径列表）

## 建议下一步
- v0.1 是否真的可以宣布生产可用？
- 是否需要 v0.1.2 hotfix？
- 是否影响 v0.2 启动？
```

报告字数控制在 **< 2500 字**。

---

## 关键提醒

1. **你的 session_id 是 `63b4e61a-5b0e-479a-82e9-0cbb481a30d8`**，标题是「B v3: real env test」（之前两个 B 会话因 DeepSeek 渠道瞬时问题卡死已归档，你是第 3 次尝试）
2. **不要修改会话 1 的产出**（C→A 任务在另一个会话进行）
3. **不要修改 v0.1 已通过的产出**（tree-state.js / tree-commander SKILL / tree-worker SKILL 的核心实现）—— 你只是验证它们，发现问题报告但不修
4. **如发现 v0.1 阻断级 bug**，立即停止测试，把 bug 报告发回主会话
5. **真实任务的产出**必须是真实可交付的（不是"为测试编的内容"）—— 这是 B 任务的核心价值
6. **完成或卡住时**用 send_message 把报告/卡点发回主会话
