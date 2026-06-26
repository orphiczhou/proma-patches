# v0.2 技术能力详解与迁移指南

> 基于树形会话执行体系设计文档 §10 v0.2 实施规范
> 目标读者：Proma 项目团队成员

---

## 概述

v0.2 是树形会话执行体系从 MVP 走向生产可用的关键版本。在 v0.1 验证了契约 + 事件通道 + 三档纠偏的核心闭环后，v0.2 聚焦于「自动巡检、事中纠偏、递进止损」三个维度，补齐了以下三大能力：

| 能力 | v0.1 状态 | v0.2 状态 |
|------|----------|----------|
| 事件通道（子→根上行） | ✅ 已实现 | ✅ 保持不变 |
| **心跳通道**（自动巡检） | ❌ 人工替代 | ✅ Proma automation |
| **内部自审**（里程碑自查） | ❌ 可选执行 | ✅ 铁律必须 |
| **三档纠偏**（递进止损） | ❌ 设计有/无执行 | ✅ 完整 nudge/limit/prune |
| Windows rename 重试 | ❌ 单次尝试 | ✅ 5 次指数退避 |

---

## 一、v0.2 三大新能力详解

### 1. 心跳通道（Heartbeat Channel）

**设计意图**

v0.1 仅有事件通道——子会话在完成、卡点或计划拆解时主动向根会话上报。这留下了一个致命盲区：子会话可能卡死、静默或「忘了说」，而根会话对此完全无感知。事件通道回答「正在发生什么」，心跳通道回答「为什么没发生」。两者互补，形成完整的全局感知网。

**工作机制**

心跳通道以 Proma 持久化定时任务（automation）为载体，核心配置如下：

- 调度类型：`interval`，间隔 15 分钟
- 会话模式：`reuse`（复用同一个心跳子会话，保留巡检上下文）
- 权限模式：`bypassPermissions`（无人值守全自动执行）

每次心跳触发时，按五步巡检流程执行：

1. **拉取活跃叶子**：运行 `tree-state.js leaf list-active <tree_id>` 获取全部 status=active 的叶子及其最近事件时间戳和上下文使用率。
2. **获取最近活动**：对每个叶子调 `mcp__session__list_messages(session_id, limit=3)`，检查最近三条消息的时间戳和内容。
3. **哨兵 Agent 判定**：将叶子列表 + 最近消息输入哨兵 Agent，按判定矩阵输出每片叶子的状态标签。
4. **异常叶子查问**：对「停滞」或「静默」叶子发送 `status_check` 消息，要求其报告当前进度和预计完成时间。
5. **写入心跳日志**：调 `tree-state.js heartbeat append` 持久化本次巡检的全部判定结果。

**哨兵 Agent 判定矩阵**

| 最近活动 | 上下文使用率 | 判定 | 对应动作 |
|---------|------------|------|---------|
| < 5 分钟 | < 85% | 🟢 active | 仅记录，不干预 |
| < 5 分钟 | ≥ 85% | 🟡 sweet_spot_risk | 调度竹节交接 |
| 5 ~ 30 分钟 | 任意 | 🟡 stale | 发送 status_check |
| > 30 分钟 | 任意 | 🔴 silent | status_check + 标记待纠偏 |

**去重规则**

心跳唤起时先过滤：若某叶子最近一次事件在 5 分钟内到达，自动跳过——事件通道能解决的事，心跳绝不重复。反之，事件 5 分钟未到，心跳必须接管。

**设计价值**

心跳通道让根会话从「被动等汇报」变为「主动巡检」，在大规模并行任务树（5+ 活跃叶子）场景下尤为关键。人工逐一检查每个叶子是否卡死在工程上不可行，而心跳通道以每 15 分钟不到 30 次 MCP 调用的成本，实现了全自动全局监控。

---

### 2. 内部自审必须化（Mandatory Internal Self-Audit）

**设计意图**

v0.1 的设计文档已定义了内部自审（补丁 3：递归自审原则），但在实际执行中是「建议做」而非「必须做」，导致多数会话跳过此步骤，偏差直到外部验收才被发现——纠偏代价显著高于事中拦截。v0.2 将内部自审从可选项升级为铁律（tree-worker 铁律 3），呼应体系的核心元原则：「每一步都有判断」。

**工作机制**

内部自审嵌入到每个里程碑 Mi 的完成流程中，形成闭环：

```
Mi 产出完成
  → 自 Fork code-reviewer 子 Agent
  → 子 Agent 输出对齐判定 {alignment, gaps, severity, suggestion}
  → severity == low: 通过，进入 M(i+1)
  → severity >= mid: 按 suggestion 自纠 → 再次审计
  → 第 2 次审计仍 >= mid: 放弃自纠，标记 drift，声明上报
```

审计 Prompt 模板固定输入四类信息并输出严格 JSON：

- **输入**：当前任务 brief（parent_intent / my_mission / in_scope / out_of_scope）+ dod（deliverables / quality_gates）+ 当前里程碑描述 + 实际产出路径
- **输出**：`{ alignment: 0-100, gaps: ["差距1", "差距2"], severity: "low|mid|high", suggestion: "修正建议" }`
- **检查点**：① 产出是否覆盖 Mi.desc 全部内容；② 是否有偏离 in_scope 的内容；③ 是否达到 quality_gates 最低标准

**自纠上限**

最多自纠 2 次（`max_self_corrections: 2`）。这一上限设计有两个目的：一是防止工人陷入无限自我修正循环浪费时间；二是 2 次自纠仍未达标时，偏差由内部升级到外部——在最终 done 上报中设置 `drift_declaration=true`，让外部纠偏从更高起点介入。

**drift_history 写入**

自纠结果不论成败均记录到 drift_history：
- 自纠成功（修正后 severity=low）：`{kind: production, severity: low, action: self_correct}`
- 仍有偏差（2 次后仍 mid+）：`{kind: production, severity: mid, action: declare}`

**使用场景**

适用于任何有明确 brief/dod 约束的执行任务。例如写 API 文档的里程碑，内部自审会检查：文档是否覆盖了全部端点（对齐度检查）、字段命名是否在 in_scope 内（边界检查）、是否含异常处理章节（quality_gate 检查）。对于关键里程碑，可升级审计 Agent 模型以提高判定准确度——不同模型交叉审计可避免同阵营思维同质化带来的盲区。

---

### 3. 三档纠偏实现（Three-Tier Correction）

**设计意图**

偏差检测和纠偏执行是两件事。v0.1 已有偏差检测能力（根会话可派 Agent 做验收判定），但纠偏动作依赖人工决策和手动执行——发现偏差后需要人判断「发提示还是剪枝」。v0.2 实现了完整的三档自动化纠偏决策树，让「检测 → 判定 → 执行 → 记录」形成全自动闭环。

**三档定义**

| 档位 | 触发条件 | 执行动作 | 对子会话影响 |
|------|---------|---------|------------|
| **轻档（nudge）** | severity=low；或哨兵发现 stale | 发送提示消息，指出偏差项 | 仅提示，不改变自主权 |
| **中档（limit）** | severity=mid 且 30 分钟内已收过 nudge；或 severity=high 首次 | 发送限权消息 + 调用 `autonomy-override` 缩小自主范围 | 增加 must_ask 项，移除部分 can_decide 项 |
| **重档（prune）** | severity=high 且已有限权记录；或中档限权后再次偏差 | archive 旧会话 + 重新 Fork（带 suggested_fork_from_uuid） | 旧会话归档，新会话从偏差前恢复点继续 |

**决策树（完整）**

```text
收到 Agent verdict:
  severity == low:
    → 轻档 nudge

  severity == mid:
    近 30 分钟内该 leaf 有 nudge 记录？
      YES → 升级到中档 limit（不再给第二次 nudge）
      NO  → 轻档 nudge（给一次自纠机会）

  severity == high:
    该 leaf 已有限权（autonomy_overrides 非空）？
      YES → 重档 prune（已给过最后一次机会）
      NO  → 中档 limit（给最后一次机会）
```

**递进状态持久化**

每一步纠偏动作都通过 `tree-state.js drift append` 写入 `tree-state.json` 的 `leaves[X].drift_history` 数组和顶层 `drift_log`。这意味着同一偏差的纠偏历史跨会话持久化——即使根会话重启，递进状态不丢失。核心设计原则：**同一偏差最多给 2 次纠正机会，第 3 次必剪枝**。

**双层纠偏全景**

v0.2 形成了完整的双层纠偏体系：

- **第 1 层（内部/事中）**：每个里程碑完成后自 Fork code-reviewer，自纠最多 2 次。内部 clean → 外部从轻档起；内部 drift → 外部起点抬高，可能直接跳中档。
- **第 2 层（外部/事后）**：事件通道（done 上报时验收 Agent 判定）+ 心跳通道（哨兵 Agent 节奏判定），三档递进执行。

两层叠加，从「事后才发现」变为「每步都在判断」，累计偏差始终可控。

---

## 二、v0.1 → v0.2 迁移指南

### 迁移前置检查清单

在开始迁移前，确认以下 v0.1 基线状态：

- [x] `tree-state.js` 已部署在 `.context/trees/tree-state.js`
- [x] tree-commander SKILL.md（v1.0）已就位
- [x] tree-worker SKILL.md（v1.0）已就位
- [x] 至少跑通过一次 v0.1 S1 验证（简单二叉树完整闭环）

### 迁移步骤

**第一步：升级 tree-worker SKILL.md**

v0.2 版本的核心变更是铁律 3 从「v0.1 可选」升级为「v0.2 必须」，并新增 §4 完整内部自审流程。操作要点：

1. 确认当前 tree-worker SKILL.md 文件路径为 `<workspace>/skills/tree-worker/SKILL.md`
2. 用 v2.0 版本覆盖（文件头部 `version: 2.0`）
3. 确认新增内容：§4 内部自审流程（含触发时机 §4.1、审计 Prompt 模板 §4.3、处理逻辑 §4.4、drift_history 写入 §4.5）
4. 确认 done 模板新增 `drift_declaration` 必填字段
5. 确认禁止行为清单第 3 条：跳过里程碑自审 → severity=high

**第二步：升级 tree-commander SKILL.md**

tree-commander 需要在 v0.1 基础上新增三块内容：

1. **§8 更新**：三档纠偏执行流程——从收到 verdict 到 nudge/limit/prune 的完整决策树，含验收 Agent prompt 骨架。验收 Agent 的输入为 `{leaf_id, brief, dod, deliverables_paths, self_check, drift_history}`，输出 `{pass, gaps, severity, suggested_fork_from_uuid}`。
2. **§9 新增**：心跳 automation 配置模板——含完整 YAML 配置（name/scheduleType/intervalMinutes/sessionMode/permissionMode/prompt）和五步巡检流程说明。
3. **§10 新增**：哨兵 Agent prompt 模板——含 §4.3 判定矩阵和 JSON 数组输出格式。

**第三步：创建心跳 automation**

在工作区下通过 automation MCP 工具创建持久化心跳任务：

- `name`: `tree-heartbeat-<tree_id>`（替换 `<tree_id>` 为实际树标识）
- `scheduleType`: `interval`
- `intervalMinutes`: 15（建议使用非整点分钟如 3/7/13/17 避免舰队峰值）
- `sessionMode`: `reuse`（同一自然日内复用子会话）
- `permissionMode`: `bypassPermissions`
- `prompt`: 按 §10.3 模板填写五步巡检流程，含 `tree-state.js leaf list-active` 调用、list_messages 调用、哨兵 Agent 派发、status_check 发送、heartbeat append 写入。

创建后立即执行一次 `run_automation_now` 试跑，确认巡检链路通畅。

**第四步：验证 S3 修复已生效**

检查 `tree-state.js` 中 `writeState` 函数的 rename 调用是否已替换为 `atomicRename`：

- 最多重试 5 次，指数退避 50ms → 100ms → 200ms → 400ms（总最大等待约 750ms）
- 仅 EPERM 错误触发重试，其他错误直接抛出
- 重试耗尽后清理 tmp 并抛 `E_IO`
- Windows 环境下此修复直接影响状态写入可靠性

可通过并发高负载场景验证：连续快速多次写入 tree-state.json，确认无 EPERM 导致的状态丢失。

**第五步：运行 S2 验收测试**

按设计文档 §10.7 的 S2 测试方案，依次验证三个场景：

- **S2a 心跳唤起**：创建 active 叶子后静置超过 5 分钟（不发送任何事件），确认 automation 触发后 heartbeat_log 有新记录，stale 叶子收到 status_check 消息。
- **S2b 内部自审**：发起一个故意轻度偏离 brief 的里程碑（如产出缺少 must_contain 中的一项），验证 worker 会话自动 Fork code-reviewer，且 drift_history 产生 self_correct 或 declare 记录。
- **S2c 三档纠偏升级**：模拟 mid 级产出偏差两次（间隔 < 30 分钟），验证第二次触发 limit——leaf.autonomy_overrides 被设置，drift_history 有 limit 记录。

### 回滚说明

如果迁移过程出现严重问题：

1. 暂时停用心跳 automation（`active: false`）
2. 回退 tree-worker SKILL.md 和 tree-commander SKILL.md 到 v0.1 版本
3. v0.1 核心闭环（事件通道 + 契约下发 + DoD 硬校验 + 剪枝）不受影响

v0.2 的三个新能力是**增强层**，非基础层——它们叠加在 v0.1 之上，回滚不会破坏已有功能。

---

*基于设计文档 v1.2 §10 v0.2 实施规范编写 | 2026-06-18*
