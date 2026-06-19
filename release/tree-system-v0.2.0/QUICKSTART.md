# 快速启动教程

> 目标：10 分钟内跑通第一个树形任务

---

## 前置条件

1. Proma Release 或 Dev 实例正在运行
2. 当前会话可以调用 `mcp__session__*` 系列工具
3. Node.js 可用（运行 tree-state.js）

---

## 任务：写一篇 100 行文档，用树形体系执行

### Step 1: 初始化状态文件

```bash
cd C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\trees
node tree-state.js init mydemo "demo"
```

产出：`trees/mydemo/tree-state.json`

### Step 2: 规划树结构

```
mydemo-root（指挥官，当前会话）
  ├── mydemo-A-draft   → 子会话：写文档主体
  └── mydemo-B-review  → 子会话：审查文档质量
```

### Step 3: 创建子会话并设置 leaf 状态

用 MCP 工具创建两个子会话：

```
mcp__session__create_session(
  channel_id="56ecefd2-8e22-4c62-add5-16e8992c987d",
  model_id="deepseek-v4-pro",
  title="demo-A — 文档草稿"
)
→ session_id: "xxx-xxx-A"

mcp__session__create_session(
  channel_id="56ecefd2-8e22-4c62-add5-16e8992c987d",
  model_id="deepseek-v4-pro",
  title="demo-B — 文档审查"
)
→ session_id: "xxx-xxx-B"
```

用 tree-state.js 注册 leaf：

```bash
node tree-state.js leaf add mydemo-A-draft root "xxx-xxx-A" draft deepseek-v4-pro
node tree-state.js leaf add mydemo-B-review root "xxx-xxx-B" review deepseek-v4-pro
```

### Step 4: 为每个 leaf 写 5 件套契约

**给 A（draft）的任务**：

```
mcp__session__send_message(
  session_id="xxx-xxx-A",
  message="你是 tree-worker (leaf: mydemo-A-draft)。

## 任务简报 (brief)
- 写一篇 80-120 行的文档，主题：'为什么树形会话比单会话更适合复杂任务'
- 包含：引言、三个论点、一个案例、结论

## 交付物 (dod)
- draft.md（写入 workspace-files/.context/demo/draft.md）
- 80+ 行
- 无 emoji

## 自检 (self_audit)
- 行数达标？结构完整？论点有证据？

首条回复必须是 brief_echo。",
  wait=true
)
```

**给 B（review）的任务**：

```
mcp__session__send_message(
  session_id="xxx-xxx-B",
  message="你是 tree-worker (leaf: mydemo-B-review)。

## 任务简报 (brief)
- 审查 A 的产出 draft.md
- 从 4 个维度评估：逻辑一致性、论据充分性、结构完整性、可读性

## 交付物 (dod)
- review.md（写入 workspace-files/.context/demo/review.md）

## 自检 (self_audit)
- 4 维度都覆盖？每个维度有具体引用？

首条回复必须是 brief_echo。",
  wait=true
)
```

### Step 5: 记录事件

每个子会话完成后，用 tree-state.js 记录：

```bash
node tree-state.js event add mydemo-A-draft done '{"deliverables":["demo/draft.md"],"lines":105,"self_check":"PASS"}'
node tree-state.js event add mydemo-B-review done '{"deliverables":["demo/review.md"],"verdict":"PASS"}'
```

### Step 6: 验证

```bash
node tree-state.js validate
# 期望输出: {"ok":true,"issues":[]}

node tree-state.js dump
# 查看完整状态
```

### Step 7: 整合

指挥官汇总 A 和 B 的产出，写入最终报告。

---

## 进阶：带终局验证的完整流程

如果你需要产出高可信度文档（如验收报告），使用树形审计方法论：

1. 按 `methodologies/tree-audit-methodology.md` 规划至少 7 个 leaf
2. 阶段一：4 个审查员并行审查
3. 阶段二：2 个攻击员并行攻击
4. 修正后重新 Fork 审查员做回归
5. 收敛判定通过后方可 declare done

---

## 常见问题

**Q: 子会话创建后没有响应？**
A: 检查频道余额/配额。已验证可用频道：DeepSeek 官方（deepseek-v4-pro/v4-flash）。

**Q: Fork 的子会话丢上下文？**
A: 不要用 Fork，用 create_session 创建全新子会话。Fork 适合需要继承上下文的孙会话。

**Q: tree-state.js 命令报错？**
A: 检查 tree_id 是否匹配、leaf_id 是否已存在、JSON 参数是否正确转义。

**Q: brief_echo 没收到？**
A: 用 `list_messages` 检查子会话是否已回复。DeepSeek 长消息可能 >60s。

---

## 下一步

- 读 `methodologies/commander-methodology.md` 了解 14 条铁律
- 读 `skills/tree-commander/SKILL.md` 了解完整指挥官操作规范
- 看 `handoffs/` 中的示例了解真实任务 brief 怎么写
