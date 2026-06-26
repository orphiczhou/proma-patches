# Proma v0.2 技术能力详解

> 本文档为 Proma v0.2 启动公告的「技术细节」层，面向项目技术成员，深入阐述三大新能力的设计原理与运行机制。

---

## 一、心跳通道（Heartbeat）

### 触发机制

心跳通道依托 **Proma automation** 模块实现定时驱动。v0.2 的默认心跳周期为 **每 15 分钟**，由 automation 任务调度器发起一次全局巡检，无需 Commander 或子会话主动触发。巡检时，调度器读取 `tree-state.json` 中所有 `active` 状态的叶节点，逐一评估其最近活动时间戳、输出记录和上报心跳。

### 判定矩阵（4 种状态）

巡检结果按以下矩阵分类：

| 状态 | 判定条件 | 含义 |
|------|---------|------|
| **active** | 最近一次活动距今 < 15 min | 子会话正常推进，无需干预 |
| **stale** | 活动间隔在 15~45 min 之间 | 可能处于耗时操作，记录警告但暂不介入 |
| **silent** | 活动间隔 > 45 min 且无任何输出 | 推定卡死或意外终止，触发三档纠偏评估 |
| **sweet_spot_risk** | 上下文 token 用量接近压缩临界点 | 有信息丢失风险，提示子会话尽快完成阶段性输出 |

`sweet_spot_risk` 是 v0.2 新引入的特殊状态，专门应对长对话上下文压缩导致契约记忆丢失的问题——这是 v0.1 阶段暴露的核心痛点之一。

### 与事件通道的协同

心跳通道和事件通道是互补的双通道机制：

- **事件通道（push）**：子会话完成里程碑后，主动向 Commander 上报 `plan` / `done` / `blocked` 消息，属于主动推送。
- **心跳通道（pull）**：automation 定时轮询各叶节点状态，属于被动兜底。

当事件通道正常时，心跳仅作为背景监控；一旦子会话进入 `silent` 状态（未主动上报），心跳通道即成为唯一的异常检测手段，触发后续纠偏流程。

---

## 二、内部自审（Internal Self-Audit）

### 里程碑触发机制

每当子会话完成一个预定里程碑（Milestone），工作流会自动 Fork 一个专用的 **code-reviewer** Agent 执行对齐校验。这一机制将质量门控内嵌到执行流程中，而非留到最终交付才发现偏差。

### Audit Agent Prompt 设计

Audit Agent 接收三类输入：

1. **当前里程碑的产出内容**（文件路径或文本片段）
2. **原始 brief.dod**（交付标准，包含 must_contain、min_length 等约束）
3. **对齐校验指令**：要求逐条核查产出是否满足 DoD，返回结构化评估报告。

返回格式为标准化 JSON：

```json
{
  "severity": "low | mid | high",
  "findings": [
    { "item": "must_contain 缺少关键词 X", "suggestion": "..." }
  ],
  "correction_needed": true
}
```

### 2 次自纠流程

- 若 `severity < mid`（仅有低危发现），子会话记录日志后继续推进。
- 若 `severity >= mid`，子会话进入**自纠模式**：根据 findings 修改产出，重新触发 Audit Agent 验证，最多循环 **2 次**。
- 若连续 2 次自纠后仍未通过，子会话停止自主修正，通过 `blocked` 通道上报 Commander，由 Commander 决策是否升级纠偏档位。

这一设计避免了子会话在无法自愈的偏差中无限循环，同时给了轻微偏差足够的自主修复空间。

---

## 三、三档纠偏（Three-Tier Correction）

### 触发条件与分档逻辑

三档纠偏由 Commander 根据心跳通道检测结果或子会话上报的 blocked 信号发起，severity 决定使用哪一档：

### 轻档：nudge（severity = low）

Commander 向子会话发送一条结构化修正消息，内容包含偏差描述和重新对焦的 brief 摘要。子会话收到 **nudge** 后，应在下一轮输出中主动修正方向，无需重启会话。nudge 是最轻量的干预手段，保留子会话已积累的上下文和工作进度。

### 中档：limit 权限（severity = mid）

对子会话实施工具权限收窄：禁止写入 `out_of_scope` 路径、限制高风险 Bash 命令、强制要求每次写入前回显目标路径。Commander 同步更新 `tree-state.json` 中该叶节点的 `permission_scope` 字段。此档保留会话继续执行，但在约束下运作，防止偏差扩散。

### 重档：archive + re-fork（severity = high）

当子会话偏差严重（如连续 2 次 nudge 无效、输出严重越界）或进入 `silent` 状态超时，Commander 执行以下操作序列：

1. 将当前叶节点状态置为 `archived`，快照其最后输出到 `drift_history` 记录中。
2. 基于原始子会话契约（brief + dod）重新 Fork 一个新的叶节点。
3. 新叶节点继承已完成的里程碑进度（通过 `completed_milestones` 字段传递），从未完成的里程碑处续接执行。

### drift_history 持久化

每一次纠偏动作（无论哪一档）均写入 `tree-state.json` 的 `drift_history` 数组，记录字段包括：

```json
{
  "timestamp": "2026-06-18T09:30:00Z",
  "leaf_id": "bverify-B-techdetail",
  "severity": "low",
  "action": "nudge",
  "reason": "missing must_contain keyword: nudge",
  "audit_findings_ref": "M2-audit-001"
}
```

`drift_history` 的持久化设计服务于两个目的：一是供 Commander 判断同一子会话的累计偏差趋势（如多次 low 累积是否应升档）；二是为事后复盘提供完整的纠偏轨迹，持续改善 brief 撰写质量和子会话执行规范。

---

*文档版本：v0.2.0 | 生成时间：2026-06-18*
