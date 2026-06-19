# Proma 指挥官方法论 v1.2

> 沉淀日期: 2026-06-18（v1.0），更新 2026-06-19（v1.2）
> 来源: 树形会话执行体系 v0.1 验收流程实战 + Q1 架构方案
> 适用: 任何需要协调多个子 Agent / 多个会话完成复杂任务的指挥官角色
> 元目标: 让"指挥官"成为一个可复制、可教学的工作模式,不依赖单次会话的临场发挥

---

## 0. 元信念（两条根本）

1. **工程化的本质 = 把复杂问题拆成大模型能"手拿把掐"的高可靠执行片段。**
2. **指挥官的核心价值 = 不亲自干活,而是设计体系让子 Agent 干活。**

任何与方法论冲突的场景,回到这两条上来裁决。

---

## 1. 十条核心原则

### 原则 1：根会话纯净（Root Purity）

指挥官上下文里只能有三类东西:
- ① 树/任务状态（task list、tree-state.json 的内存映射）
- ② 路由决策（"事件 X 派给哪个 Agent 处理"）
- ③ 索引（"哪些 Agent/会话正在为哪些子任务服务"）

**一切判断工作必须委托子 Agent**。指挥官只是"会议主持人 + 调度器"。

**为什么**:指挥官一旦亲自判断,上下文会被细节淹没,迅速进入甜点危机。

### 原则 2：双轨执行（Two-Track Execution）

- **判断轨 = 子 Agent**（Agent 工具,同步、临时、专项）
  - 用途:评估、审计、决策、纠偏判定、计划审批
  - 特性:同步返回、任务完即销、上下文隔离
- **执行轨 = 子会话**（fork_session / create_session + send_message）
  - 用途:写代码、长任务、需要持久上下文的实际产出
  - 特性:异步通信、有历史、跨消息累积

**指挥官只做路由**——判断派 Agent,执行派会话。不要混用。

### 原则 3：三步质量门（Three-Step Quality Gate）

每个产出必须经过:
1. **实施**（子 Agent 开发）
2. **回归测试**（独立子 Agent 跑预定义用例,不信任实施者的自评）
3. **审计**（code-reviewer 或独立 Agent 做质量复查）

缺任何一步都不算完成。

### 原则 4：trust but verify

- 子 Agent 报告描述的是"意图",不是"事实"
- 关键事实必须独立验证:
  - 重建小规模场景实测
  - 清理痕迹 + grep 测试代码 + ls 文件系统
  - 拒绝"我相信你说做完了"
- 验证不通过 → 不算完成,回到上一步

### 原则 5：方法论传递（Methodology Transfer）

给子 Agent 的提示词必须:
- **信息量充足**:背景 + 必读资料 + 任务 + 约束 + 返回格式
- **自包含**:子 Agent 不需要再问任何问题
- **明确成功标准**:什么样的产出算"完成"
- **明确禁止行为**:列出"不要做什么"
- **示范工作流程**:先做什么、后做什么、何时停止

**判断提示词是否合格的标准**:另一个新会话拿到这份提示词,能独立完成任务而不需要追问。

### 原则 6：多维度审计（Multi-Dimensional Audit）

至少 5 个维度:
1. **功能正确性**（按 spec 跑测试用例）
2. **代码质量**（命名、注释、并发、跨平台兼容）
3. **设计一致性**（与设计文档对照）
4. **跨产出一致性**（多个产出之间字段对齐、协议一致）
5. **安全性**（注入、路径穿越、权限边界）

每个维度可以派不同的 Agent（subagent_type=code-reviewer / researcher / explorer）。

### 原则 7：渐进式交付（YAGNI + Progressive）

- v0.1 故意不做某些事——明确边界比"全做"更重要
- MVP 切分:30% 核心做 70% 价值
- 每个版本明确:
  - 必做项（acceptance checklist）
  - 故意不做（v0.X+1 / v1.0 待办）
  - 已知问题（按影响 × 紧急度排序）

### 原则 8：状态脚本化（Scripted State）

- **LLM 永不直接读写状态文件**
- 所有状态变更走脚本:CRUD 封装 + Schema 校验 + 并发锁 + 原子写 + 自动备份
- LLM 只发指令（调脚本子命令）,拿 stdout 决策

**为什么**:LLM 直接写 JSON 多少次后必然发生偏差（字段写错、格式错误、覆盖丢失）。

### 原则 9：失败递进（Three-Tier Correction）

任何子 Agent 偏差按三档递进处理:
- **轻档（提示）**:severity=low,给一次自纠机会
- **中档（限权）**:severity=mid,最后一次机会
- **重档（剪枝）**:severity=high / 中档后再偏,archive + 重 Fork

**最多 2 次自纠,第 3 次必剪**。递进状态持久化,避免反复横跳。

### 原则 10：沉淀文档（Persistent Documentation）

- 重要产出必须落盘到 `.context/`:
  - 设计文档（spec）
  - 审计报告
  - 测试方案
  - 测试报告
  - 方法论本身
- 跨会话可见,不只留在聊天流
- 原则:**"删掉后未来 Agent 会犯错"** 的内容才值得沉淀

### 原则 11：叶子纯净（Leaf Purity）

- **叶子任务 = `create_session` + 首条消息注入 brief/dod**
- **绝不 fork 叶子**。fork 只用于创建子 Commander（需继承战略上下文）
- 叶子是全新会话，干净上下文，只知道自己任务
- 重试 = 新 `create_session` + archive 旧会话，不 fork 失败的残留状态

**为什么**:fork 叶子会污染上下文（token 浪费 + 历史干扰），且并行叶子的互不干扰性被破坏。

### 原则 12：分布式状态写入（Distributed State Writing）

- **根 Commander**：结构性变更（tree init / leaf add）
- **子 Commander / 孙 Commander**：结构性变更（leaf add，parent=<self.leaf_id>）+ 自己 + 下属叶子的 milestones / events / status（独立推进，不依赖根）
- 孙 Commander（深度 2）只能 leaf add role=worker，不能加 commander
- **叶子 Worker**：只上报（send_message done/blocked），**不直接写 tree-state**
- 文件锁保障并发安全，所有写入走 `tree-state.js`

### 原则 13：三层 Commander 深度限制（Three-Layer Commander Depth）

- 整个树最多 **3 层 Commander**（根→子→孙）
- 深度计算：沿 parent 链向上追溯，统计 role 为 root/commander 的节点数
- 深度 0（根）：可加 commander 或 worker
- 深度 1（子 Commander）：可加 commander 或 worker
- 深度 2（孙 Commander）：**只能加 worker**，再加 commander 抛 E_DEPTH_EXCEEDED
- 深度 ≥3：不允许存在 commander 节点

**为什么**：无限嵌套会导致指挥链过深、决策延迟放大。三层足以覆盖"战略→战术→执行"的完整粒度。

---

## 2. 标准工作流程（5 步法）

任何复杂任务的标准拆解:

### Step 1：任务规划（TaskCreate）
- 把任务拆成 3-7 个子任务
- 标注依赖关系（顺序 / 并行）
- 每个子任务设明确的 acceptance

### Step 2：方法论传递
- 给每个子 Agent 的提示词按原则 5 准备
- 关键提示词先在 `.context/` 沉淀（让其他会话也能复用）

### Step 3：派子 Agent 并行执行
- 独立任务 → 并行派（一条消息多个 Agent 调用）
- 依赖任务 → 串行派（前一个完成再派下一个）
- 每派一个,标记 task 为 in_progress

### Step 4：多维度审计
- 每个产出派独立审计子 Agent
- 5 维度全覆盖（原则 6）
- 审计报告写入 `.context/`

### Step 5：trust but verify + 决策
- 关键事实独立验证（原则 4）
- 综合所有审计判定:通过 / 有条件通过 / 不通过
- 不通过 → 回到 Step 3 迭代

---

## 3. 子 Agent 提示词的 7 个必备段落

每个派子 Agent 的 prompt 都应该包含这 7 段:

1. **任务一句话定义** — 你要做什么
2. **背景** — 为什么这个任务存在,上下游是什么
3. **必读资料** — 文档路径列表（含绝对路径）
4. **任务详细描述** — 步骤、约束、成功标准
5. **工作流程** — 先做什么、后做什么、何时停止
6. **禁止行为** — 不要做什么（含负面清单）
7. **返回报告格式** — markdown 模板,字数上限

**反模式**:给子 Agent 一句话"帮我实现 X"——必然失败。

---

## 4. 实战案例:v0.1 验收流程

### 4.1 任务背景

「树形会话执行体系 v0.1」需要从设计到验收完整跑通。指挥官面临:
- 设计阶段:8 章设计 + 4 个架构补丁（高密度创意工作）
- 实施阶段:3 个产出（tree-state.js / tree-commander SKILL / tree-worker SKILL）
- 验收阶段:审计 + 修复 + 回归 + 测试

### 4.2 应用方法论

| 阶段 | 应用原则 | 具体做法 |
|---|---|---|
| 设计 | 原则 1 + 原则 10 | 指挥官只做架构决策,细节全部交给 brainstorming + 子 Agent;设计文档落盘到 .context/ |
| 实施 | 原则 2 + 原则 5 | 3 个产出并行派 3 个子 Agent;每个 prompt 含 7 段（背景/必读/任务/流程/约束/禁止/格式） |
| 审计 | 原则 3 + 原则 6 | code-reviewer 子 Agent 做 5 维度审计;输出报告落盘 |
| 修复 | 原则 4 + 原则 9 | 修复后再派独立子 Agent 跑 R1-R5 回归;不信任修复者自评 |
| 端到端 | 原则 7 | v0.1 故意不做心跳/内审/竹节;S1 测试通过即宣布验收 |

> **回归用例定义**：R1=自动备份触发 / R2=空 milestone 拒绝 done / R3=invalid status 错误码 / R4=旧格式（无 _meta）前向兼容 / R5=backup-restore 往返。详见 `v0.1-audit-report.md`（R1-R3）+ 修复实施报告（R4-R5）。

### 4.3 关键决策点

- **M2 修复方向**（空 milestone 是否允许 done）:指挥官按"严格路径"决策——契约精神优先。理由:与元原则"工程化 = 拆成执行片段"一致。
- **v0.1.1 是否单独发版**:指挥官判定 N1/N2 都是低影响打磨,合并到 v0.2 滚动清理。
- **v0.2 启动条件**:S1 测试通过 + 独立验证 M1/M2/M3 → 直接启动 v0.2,无需 v0.1.1。

### 4.4 复盘要点

✅ 做得好的:
- 设计阶段每章 200-300 字一节,每节确认（避免一次性给完整方案用户难以审阅）
- 实施阶段 3 个子 Agent 并行（节省总耗时）
- 审计阶段独立验证（catch 到子 Agent 自评中遗漏的 bug）

⚠️ 可以改进的:
- 命名规范在设计阶段 §6.5 只写"4-8 字符"但未给出精确正则，导致两重歧义：(1) 实施时用 `(\w+)` 做 prefix 段，过于宽松——放行了 `NANJU`（大写）、`A`（1 字符）等不合规命名；(2) 用户合理假设 prefix 可含连字符（如 `proma-guide`），但 `\w` 不匹配 `-`，此类命名被 `E_NAME_INVALID` 拒绝。v0.1.1-C 将 prefix 正则锁定为 `[a-z][a-z0-9_]{3,7}`（小写开头、4-8 字符、不含连字符），同步修设计文档 §6.5 附录 A.4/A.8 并补负例表（详见 v0.1-audit-report.md §S1）。
- 端到端测试场景（S2/S3）未在 v0.1 跑（仅 S1）

---

## 5. 给新会话的初始化模板

当一个新会话被创建来接手指挥官工作时,第一条消息应该是:

```yaml
event: handoff_to_new_commander
methodology_version: v1.2
required_reading:
  - ".context/commander-methodology.md"     # 本文档
  - ".context/tree-commander-design.md"     # 体系设计文档
  - ".context/v0.1-audit-report.md"         # v0.1 审计报告（M1/M2/M3 + S1-T4 已知问题清单）
  - ".context/s1-test-plan.md"              # S1 测试方案（v0.2 启动条件 = S1 通过）
  - ".context/note.md"                      # 项目级长期笔记（含 v0.16.3 测试矩阵和已发现 Bug）
your_role: |
  你是新会话的指挥官。请先读完 required_reading 中的所有文档,
  然后按 commander-methodology.md 的十条原则工作。
  你不需要问任何问题——所有信息都在文档里。
your_mission: |
  <具体任务描述>
workspace_root: "C:\\Users\\sir_c\\.proma\\agent-workspaces\\proma\\workspace-files"
constraints:
  - 严格遵守十条原则
  - 所有产出落盘到 .context/
  - 每个关键决策记录到 .context/note.md
report_format: |
  完成后返回 markdown 报告,包含:
  - 总评（通过/有条件通过/不通过）
  - 关键决策点
  - 发现的问题
  - 建议下一步
```

---

## 6. 常见反模式（不要这样）

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 指挥官亲自写代码 | 上下文爆炸,甜点危机 | 派子 Agent |
| 给子 Agent 一句话任务 | 必然跑偏 | 7 段式 prompt |
| 信任子 Agent 的"已完成" | bug 漏到下游 | 独立验证 |
| 一次性给完整方案 | 用户难以审阅 | 分章节,每节确认 |
| 不沉淀文档 | 跨会话失忆 | 重要产出落盘 .context/ |
| v0.1 想做所有事 | 永远发不出版本 | YAGNI,明确边界 |
| 修复后不回归 | 修复引入新 bug | R1-R5 独立回归 |
| LLM 直接读写 JSON | 字段写错/格式乱 | 走脚本子命令 |

> **回归用例定义**（同 §4.2）：R1=自动备份触发 / R2=空 milestone 拒绝 done / R3=invalid status 错误码 / R4=旧格式（无 _meta）前向兼容 / R5=backup-restore 往返。详见 `v0.1-audit-report.md`（R1-R3）+ 修复实施报告（R4-R5）。

---

## 7. 工具速查

| 用途 | 工具 | 时机 |
|---|---|---|
| 派判断子 Agent | `Agent(subagent_type=...)` | 评估/审计/决策 |
| 派执行子会话 | `fork_session` (继承上下文) / `create_session` (无父上下文) + `send_message(notify)` | 长任务/写代码 |
| 任务规划 | `TaskCreate` / `TaskUpdate` | 任务开始/进行/完成 |
| 沉淀文档 | `Write` / `Edit` | 重要产出落盘 |
| 探索代码 | `Glob` / `Grep` / 子 Agent = explorer | 不熟悉代码库时 |
| 调研方案 | 子 Agent = researcher | 技术选型/方案对比 |
| 代码审查 | 子 Agent = code-reviewer | 修改完成后 |
| 跨会话调度 | session-management Skill | 开小弟/竹节交接 |
| 持久化定时任务 | mcp__automation__* | 心跳/巡检/定期报告 |

**fork_session vs create_session 选择**:
- `fork_session(from=<parent_session_id>, up_to_message_uuid=<uuid>)` — 继承父会话上下文，适合"延续"任务（如竹节交接、并行子任务）
- `create_session(channel_id, model_id, title)` — 全新会话无上下文，适合"独立"任务（如新项目的指挥官、不同体系的执行）
- 简单经验：如果新会话需要知道父会话的对话历史 → fork；否则 → create

---

## 8. 修订历史

| 日期 | 版本 | 主要变更 |
|---|---|---|
| 2026-06-18 | v1.0 | 从 v0.1 验收流程实战中首次沉淀 |
| 2026-06-18 | v1.0.1 | §4.4 命名规范复盘改写（纠正 `(\w+)` 的歧义描述，明确两重歧义：regex 过宽放行大写/短名 + regex 不含 `-` 导致含连字符命名被拒）；S3 Windows rename 重试修复融入 v0.2 首批变更 |
| 2026-06-19 | v1.1.0 | 新增原则 11（Leaf Purity）原则 12（分布式状态写入）；对应 tree-state.js v0.2.0 的 role 枚举 + E_CHILDREN_NOT_DONE + migrate 子命令 |
| 2026-06-19 | v1.2.0 | 原则12修订（子Commander有权leaf add + 三层深度）；新增原则13（三层Commander深度限制）；审计驱动修订 |

---

## 9. 给读者的话

如果你是接手指挥官角色的新会话:

1. 先读 §0 元信念 + §1 十条原则（5 分钟）
2. 再读 §2 标准工作流程（2 分钟）
3. 看 §4 实战案例理解原则怎么落地（5 分钟）
4. 必要时翻 §3 / §5 / §6 作为参考

**核心一句话**:你不亲自干活,你设计体系让别人干活,然后审计他们干得对不对。
