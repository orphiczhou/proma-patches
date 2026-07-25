# SKILL 层改进论证报告

> **论证对象**：macp2 评估报告 §5 中 P1-A / P1-B / P1-C 三项 SKILL 层改进建议
> **论证方法**：逐条对照当前 tree-commander SKILL (v2.9.1) 和 tree-worker SKILL (v2.2) 的现有协议、定位差距、给出具体改动方案
> **约束**：只读论证，不实际修改 SKILL 文件
> **日期**：2026-07-25

---

## 前置发现：三个 P1 项的共同模式

经逐条对照后发现，三个 P1 项有**共同特征**：

> **信息在 SKILL 中已存在（以 advisory / 深层文档 / 分散形式），但缺乏"硬 Checklist 化"和"醒目位置强调"。**

这决定了 SKILL 层的改进方向不是"从零新建协议"，而是"把已存在的正确信息从 advisory 升级为 mandatory、从文档深处提升到醒目位置"。

---

## 一、P1-A：send_message 后必须紧接 tree_log_communication（硬 checklist）

### 1.1 macp2 暴露的问题

> 评估报告 §4.3：comm_log ~10% 漏记（3-4 条），集中在 **L3→L4 brief** 高发漏点：A1→A1a brief、A1→A1b brief 在 progress 自述"已发"但 comm_log 无对应记录；B1b→B1 done 由 B1 代报、C1a→C1 done 由 C1 代报。

### 1.2 当前 SKILL 协议回顾

tree-commander **§6 外部通信记录协议 (v2.9)** 已有完整协议：

```yaml
# 已有协议（advisory 模式）
mcp__session__send_message(session_id=<worker_session>, message="<brief/nudge/追问>")
mcp__tree__tree_log_communication(tree_id, target_session_id=<worker_session>,
  direction='out', note='发送 5 件套 brief')
```

- 工具已就绪：`tree_log_communication` (v2.9) + `tree_communication_list` (v2.9)
- 引擎自动处理：定位 target leaf → 更新 last_event_ts → 追加 communication_log
- 但**措辞是"协议教化"**，非硬约束
- 原文："靠协议教化（同 'done 即 set-status' 模式）；macp 实战若再证普遍漏调，再考虑自动 hook"

**macp2 已再证普遍漏调**——应从此句触发升级。

### 1.3 可行性：✅ 完全可行（零引擎依赖）

当前 engine 已有 `tree_log_communication` 工具和完整的 communication_log 查询链路。SKILL 层只需要把 advisory 升级为 mandatory，**不需要任何引擎改动**。

### 1.4 风险：极低

- 纯文档改动，不影响任何运行时行为
- 本质是强化已存在且验证有效的协议
- 唯一风险：如果 commander 仍不遵守（"教化"再失效），则需要回到 engine auto-hook 方案（但那是下一步的事）

### 1.5 工作量：小（~8 行改动，3 处修改）

| 修改位置 | 当前状态 | 改为 |
|----------|---------|------|
| **tree-commander §4 Step3 事件路由** | 只提 `tree_event_append`，不提 comm_log | 新增一行："【必须】每次 `send_message` 给树内 leaf 后，**紧接** `tree_log_communication(tree_id, target_session_id=<session>, direction='out', note='…')`——漏记一次即违规" |
| **tree-commander §11 禁止行为**（新增 #15） | 无对应条目 | 新增 #15："send_message 给树内 leaf 后漏记 tree_log_communication → 心跳无法感知通信活动，误判冻结" |
| **tree-commander §6 协议措辞** | "靠协议教化…macp 实战若再证…再考虑自动 hook" | 改为："**硬要求**（macp2 实战再证 ~10% 漏记后升级）：每次 send_message 后必须紧接 tree_log_communication。漏记 = 协议违规，属 §11 禁止行为 #15" |

#### 可选：tree-worker SKILL 补充

| 修改位置 | 当前状态 | 改为 |
|----------|---------|------|
| tree-worker（新增简注） | 无 comm_log 相关要求 | 在 worker 上行消息模板区域加注："worker 通过 send_message 发送 done/blocked/plan/brief_echo 给 commander 时，**也**建议调 tree_log_communication（direction='in'），增强双向可观测性" |

> 注：worker 侧的 comm_log 漏记主要发生在"由父代报"场景（如 B1b→B1 done 由 B1 代报），因此 worker 侧加注为辅助，核心约束在 commander 侧。

### 1.6 优先级：P1 🟡（中等优先）

- 漏洞已再证（macp2 ~10% 漏记），符合 v2.9 当初设定的升级触发条件
- 改动极小、零风险
- 效果：如果 commander 遵守硬 checklist，comm_log 覆盖率从 ~90% 提升到接近 100%

---

## 二、P1-B：worker 层强制至少 1 条中间 progress event

### 2.1 macp2 暴露的问题

> 评估报告 §4.2：B1/A1a/A1b 三 leaf 中间无 progress（直接跳到 done），违背 macp §3 观察员点名的 "worker progress tracking" 要求。进度对父/心跳不透明。

### 2.2 当前 SKILL 协议回顾

tree-commander **§6 progress event 用法 (v2.8)** 已有协议：

```yaml
# 已有协议（advisory 模式）
mcp__tree__tree_event_append(tree_id, leaf_id=<self>, type='progress',
  meta={step: "正在写第 3 节", outputs_so_far: ["reports/draft-sec3.md"], percent: 60, eta: "15min"})
```

但关键措辞：
- "worker 长任务（>10 分钟）中途**可主动**报进度"（emphasis added）
- "progress **不触发状态转换、不强制 schema（轻量）**"
- "commander 在心跳巡检时**可**读最近 progress 判断进度"（emphasis added）

**tree-worker SKILL v2.2：完全没有 progress event 相关章节。**

问题根源：
1. tree-worker 不知道要发 progress——其 SKILL 中 zero coverage
2. tree-commander 把 progress 定义为"可选轻量"——无约束力
3. **引擎 done 门禁无 progress 校验**——无法强制

### 2.3 可行性

| 方案 | 可行性 | 说明 |
|------|--------|------|
| **纯 SKILL 层**（不加引擎门禁） | ✅ 可行 | tree-worker 新增 progress 章节 + tree-commander 措辞从"可主动"改为"必须至少 1 条" |
| **SKILL + 引擎 warning** | ✅ 可行（需引擎配合） | 引擎 cmdLeafSetStatus done 门禁：若 worker events 无 progress → 返回 `W_NO_PROGRESS` warning（不拦死） |
| **SKILL + 引擎硬约束** | ⚠️ 过度 | 短任务（单文件小改、< 5 分钟完成）不应强制 progress；硬约束会误伤 |

**建议路线**：先做纯 SKILL 层改动，观察下一轮 macp 是否改善；若仍普遍缺失（如 macp2 的 3/5 worker 无 progress），再加引擎 warning 门禁。

### 2.4 风险：中低

- 纯 SKILL 改动：零风险（文档改动）
- SKILL + 引擎 warning：低风险（warning 不拦流程，但可能产生噪音——短任务误报）
- 核心风险：**纯 SKILL 层改动与 P1-A v2.9 同质——"教化"模式，可能再被忽略**（证据：macp2 中 3/5 worker 无 progress，说明 v2.8 advisory 模式已经失效）

### 2.5 工作量

#### 方案 A：纯 SKILL 层（推荐先做）

| 修改位置 | 当前状态 | 改为 | 行数 |
|----------|---------|------|------|
| **tree-worker SKILL 新增 §2.6**（或 §3.0）"中间进度上报" | 无任何 progress 章节 | 新章节：要求长任务（>10 分钟 或 >3 个里程碑 或 deliverable >1000 字）**必须在 done 之前至少发 1 条 progress event**。模板：`tree_event_append(type='progress', meta={step, outputs_so_far, percent, eta})`。短任务（< 5 分钟单文件）例外 | ~15 行 |
| **tree-worker §2.5 lifecycle 阶段 6 "干活"** | 无 progress 步骤 | 在阶段 6 中插入："中途（完成 ≥1 个里程碑后）→ tree_event_append(type=progress)" | ~2 行 |
| **tree-worker §7 禁止行为**（新增 #13） | 无对应条目 | "长任务直达 done 无中间 progress——进度对父不透明" | ~1 行 |
| **tree-commander §6 progress event 用法** | "可主动" | 改为："worker **应**在 done 之前至少发 1 条 progress（短任务 < 5 分钟除外）。commander 心跳巡检据此判断进度，缺失 progress 视为进度不透明" | ~3 行 |

**合计**：~21 行改动，集中在 tree-worker SKILL。

#### 方案 B：SKILL + 引擎 warning（推荐后续跟进）

在方案 A 基础上，引擎 cmdLeafSetStatus 加：

```
若 leaf.role=worker 且 events 中无 type=progress 且 leaf 运行时长 > 10 分钟:
  → 返回 ok:true, warning: { code: "W_NO_PROGRESS", message: "worker done 前未发 progress event，进度对父不透明" }
  → 不拦 set-status done（warning 模式）
```

**工作量**：引擎 ~10 行 + 测试。

### 2.6 是否需要引擎配合

**短期**：不需要。纯 SKILL 层改动可以做。

**中期**：建议配合。纯 SKILL 层的 v2.8 advisory 已在 macp2 中被 3/5 worker 忽略——说明 SKILL"教化"对 progress 的约束力不足。引擎 warning 是轻量 enforcement，不拦流程但留可追溯痕迹，与 §6 的 "macp 实战若再证普遍漏调，再考虑自动 hook" 逻辑一致。

**注意**：引擎 warning 需要加"运行时长"判断（短任务不应触发），否则噪音大。推荐阈值：leaf 从 `added_at` 到 done event 的 duration > 10 分钟 → 触发 warning。

### 2.7 优先级：P1 🟡（中等优先，建议引擎配合一起做）

- 纯 SKILL 层改动性价比不如 P1-A/P1-C 高（无引擎 enforcement 的情况下与 v2.8 同质）
- 若能与引擎 warning 门禁一起上线，效果会显著提升
- **建议排在 P1-C 之后、P1-A 之后**

---

## 三、P1-C：brief 模板预置 "set-status caller=owner（worker 自己）"规则讲透

### 3.1 macp2 暴露的问题

> 评估报告 §5 P1-C：4 个 worker 各卡一轮"等 root 通知 set-status"，来回成本高。

### 3.2 当前 SKILL 协议回顾

这是一个**信息已在但位置不对**的典型案例。

**已有的正确信息**：

1. **tree-commander §13.3 步骤前置条件表**：明确步骤 7 `set-status done` 调用者 = worker，说明 "worker = commander 用 send_message 让 worker 自己调（caller=worker.session_id）。⚠️ commander 绝不能代调 caller=worker 的工具（→ E_BORROWED_IDENTITY）"
2. **tree-worker §2.5 worker lifecycle 阶段 9**：标注 "worker 主动 → tree_leaf_set_status(status=done)"，且说明 "步骤 8 通过后自己调"
3. **tree-worker §2.5 阶段 9 注释**："若卡在这，先确认 commander 是否已调步骤 8（上行 blocked 催一下）"

### 3.3 为什么会卡（根因分析）

虽然信息存在，但 macp2 仍有 4/5 worker 各浪费一轮来回。根因有三：

#### 根因 1：set-status 与 audit_gate 的"邻接混淆"

worker 生命周期的步骤 8 和 9 是紧邻的：

```
步骤 8: audit_gate pass  ← commander 调（caller=root）
步骤 9: set-status done  ← worker 调（caller=worker）
```

由于步骤 8 是 commander 的"最后一个动作"（给 worker 背书），worker 容易错误推断"commander 做完步骤 8 后会顺带做步骤 9"——**把 set-status done 当作 commander 的义务链的延续，而非自己的独立责任**。这是一个认知 UX 问题：在 worker 的心理模型里，步骤 7（done event）、步骤 9（set-status done）都是"完成"相关动作，但步骤 8（audit_gate pass）是 commander 的"中间阻断"——commander 做完 8 后，worker 需要"回过神来"自己做 9。

#### 根因 2：信息在文档深处，不在 brief 模板里

§13.3 表格和 §2.5 lifecycle 表格是正确的，但它们：
- 在文档 > 800 行之后（§13.3）
- 在 SKILL 的中后段（tree-worker §2.5）
- **不在 worker 收到的第一份文件——5 件套 brief 里**

brief 模板（tree-commander §3）的 5 个段（brief / dod / report / autonomy / self_audit）没有一段预置了"谁调 set-status"。worker 解码 brief 后，除非主动翻阅 worker SKILL 的 §2.5 lifecycle，否则不会接触到这个信息。

#### 根因 3：tree-worker §1 铁律没有覆盖

tree-worker §1 铁律 9 条覆盖了 brief_echo、milestone、自审、note、上下文、done self_check、结构化上行、禁直写 JSON、禁越界——**唯独没有"set-status done 必须自己调"这一条**。如果这是一条铁律（违例即被 E_BORROWED_IDENTITY 拦），它应该进铁律。

### 3.4 可行性：✅ 完全可行（零引擎依赖）

- 信息已在，只是位置和醒目度问题
- 改动纯文档，零风险
- 不需要引擎配合（E_BORROWED_IDENTITY 已存在——规则不清导致误撞，不是引擎缺校验）

### 3.5 风险：极低

- 纯文档改动
- 不改变任何协议语义，只改变信息的"何时被看到"和"以什么形式被看到"

### 3.6 工作量：小（~10 行改动，3+1 处修改）

#### 改动 1：tree-commander §3 brief 模板预置（最关键）

在 §3.4 autonomy 段增加一行，让 worker 收到 brief 的第一刻就知道：

```yaml
# tree-commander §3.4 autonomy 段，新增：
autonomy:
  can_decide: [...]
  must_report: [...]
  must_ask: [...]
  final_step: "完成所有产出 + 收到 audit_gate pass 后，**你（worker）自己调 tree_leaf_set_status(status=done)**。commander 不代调（代调被引擎 E_BORROWED_IDENTITY 拦截）"
```

这行直接进入 brief 模板，每个 worker 收到的第一条消息就包含这个信息。

#### 改动 2：tree-worker §1 铁律新增 #10

```markdown
| 10 | **set-status done 必须 worker 自己调** — commander 代调被 E_BORROWED_IDENTITY 拦；步骤 8 audit_gate pass 由 commander 完成，步骤 9 set-status done 是你自己的事 | 引擎硬拦，worker 卡"等通知"浪费时间 |
```

#### 改动 3：tree-worker §2.5 lifecycle 阶段 8→9 之间加醒目警示

```markdown
| 8. audit_gate pass | commander | ... | （被动）等待门禁背书 |
| ⚠️ **衔接规则** | — | — | **步骤 8 是 commander 的最后一步，步骤 9 是你（worker）自己的事——不要等 commander 通知你调 set-status，audit_gate pass 本身就是"可以 set-status"的信号** |
| 9. set-status done | **worker 主动** | ... | 步骤 8 通过后自己调 |
```

#### 改动 4（可选）：tree-commander §13.3 八步末尾加醒目警示

```text
# 在 §13.3 八步代码块末尾加：
⚠️ 步骤 7（set-status done）是 worker 自己调。commander 做完步骤 6（audit_gate pass）后，
   send_message 通知 worker "audit_gate pass，你可以 set-status done"——但执行者是 worker。
   commander 代调步骤 7 → E_BORROWED_IDENTITY。
```

### 3.7 优先级：P1 🟡→ 🔴（三个 P1 中最高）

- 成本极低（~10 行，纯文档）
- 根因最清晰（不是"不知道要做什么"而是"不知道该谁做"）
- 影响面明确：macp2 4/5 worker 各浪费一轮来回
- 在 brief 模板预置后，**每个未来 worker 都会在收到的第一条消息中看到这个规则**
- **建议最先做、立即做**

---

## 四、SKILL 层整体方案总结

### 4.1 三项改动一览

| 项目 | 改动量 | 引擎依赖 | 风险 | 优先级 | 改动文件 |
|------|--------|---------|------|--------|---------|
| **P1-C** set-status caller 规则讲透 | ~10 行 | 无 | 极低 | 🔴 最高 | tree-commander §3 + tree-worker §1/§2.5 |
| **P1-A** comm_log 硬 checklist | ~8 行 | 无 | 极低 | 🟡 中 | tree-commander §4/§6/§11 + tree-worker（可选） |
| **P1-B** progress 强制至少 1 条 | ~21 行 | 建议配合 | 中低 | 🟡 中 | tree-worker（新增 §2.6）+ tree-commander §6 |

### 4.2 实施顺序建议

```
第一轮（立即）: P1-C
  → 成本最低、根因最清晰、每个未来 worker 立即受益

第二轮（同时）: P1-A + P1-B（纯 SKILL 层）
  → P1-A 改动小可立即上线
  → P1-B 先做纯 SKILL 层，观察下轮 macp 效果

第三轮（观察后）: P1-B 引擎 warning
  → 若纯 SKILL 层 P1-B 仍漏（同 v2.8→macp2 模式），加引擎 W_NO_PROGRESS warning
```

### 4.3 不改引擎能做到什么程度

| 目标 | 纯 SKILL 层效果 | 加引擎配合后效果 |
|------|----------------|-----------------|
| comm_log 零漏记 | 硬 checklist 可接近 100%，但依赖 commander 遵守 | 引擎 auto-hook（但侵入高，暂不建议） |
| progress 零缺失 | 教化模式，与 v2.8 同质——可能仍有 worker 忽略 | warning 门禁可强制留痕 |
| set-status caller 不混淆 | brief 预置 + 铁律 + 醒目警示 → 预计可消除大部分"等 root 通知" | 不需要引擎改动（E_BORROWED_IDENTITY 已有） |

**结论**：P1-C 完全不需要引擎配合即可取得好效果。P1-A 也不需要引擎配合（工具已有，只缺硬 checklist）。P1-B 建议引擎配合，纯 SKILL 层效果有限（v2.8 已证实）。

### 4.4 需要引擎配合的项目

| 项目 | 引擎改动 | 工作量 | 建议 |
|------|---------|--------|------|
| P1-B 强制 progress | cmdLeafSetStatus：worker done 时无 progress + 运行 > 10 分钟 → W_NO_PROGRESS warning（不拦死） | ~10 行 + 测试 | 建议做，但可在纯 SKILL 层上线后观察一轮再决定 |

---

## 五、论证者备注

### 5.1 论证方法

- 对照了三份文件：macp2 评估报告（§5 P1-A/B/C）、tree-commander SKILL v2.9.1（1040 行，完整阅读）、tree-worker SKILL v2.2（完整阅读）
- 论证焦点：SKILL 层能做什么、改哪里（§几 + 加什么）、是否需要引擎配合
- 未评估引擎层改动细节（P0-A/B 属引擎层）、未评估项目改动（P0-C/P1-D 属项目层）

### 5.2 关键结论

三个 P1 项都遵循同一模式：**信息在 SKILL 中已存在，但以 advisory / 深层 / 分散形式存在，缺乏硬 Checklist 化和醒目强调。** 这意味着修复成本极低（合计 ~39 行改动），且无需等待引擎迭代即可上线 P1-C 和 P1-A。

### 5.3 对 future 的启示

P1-A 的 v2.9 当初设计了"先教化、再观察、必要时自动 hook"的渐进路径——macp2 评估触发了升级条件。P1-B 的 v2.8 同样遵循此模式（先 advisory、macp2 再证漏 → 升级）。建议在 SKILL 中为类似的"先教化后强制"协议显式标注触发条件，避免未来反复论证同一问题。

---

*论证完成：2026-07-25*
*论证方：Proma Agent（Pro 实例 session `8e02ddc6`），只读论证*
