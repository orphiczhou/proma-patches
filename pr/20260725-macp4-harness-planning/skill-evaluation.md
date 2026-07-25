# macp4 SKILL + 流程层改进论证

> **论证对象**: tree-commander v2.9.2 + tree-worker v2.6（harness SKILL/流程层，不碰引擎内部）
> **输入**: macp3 最终评估报告 §七 P1-F/G/H + P2-B/C
> **论证人**: macp4 SKILL + 流程层改进论证员
> **日期**: 2026-07-25
> **性质**: 只读论证，不执行写操作

---

## 〇、前置分析：macp3 暴露的 SKILL/流程层问题全景

macp3 最终评估确认了三个 SKILL/流程层改进点（P1-F/G/H）和两个知识/文档沉淀点（P2-B/C）。本节先做问题链追溯，理清宏观逻辑。

### 问题链 1：root 不知如何 done（P1-F）

```
root 20:50 实现层 100% done
  → 尝试 set-status done
  → 引擎 L1767: 0 milestones + role=root 无豁免 → E_SCHEMA_INVALID
  → root 保持 active（等评估）
```

**SKILL 层根因**: §13.3a "root 自身 done" 只讲了 auto_upgrade 的 happy path（写 done event → auto_upgrade → set-status done），但 **root 实际撞 `E_SCHEMA_INVALID` 时无备选路径**。SKILL 没有教：
- auto_upgrade 的前提条件（是否有前置要求？引擎真的生效了吗？）
- 备选路径 A：root milestone_add 给自己（满足 L1767 milestone 检查）
- 备选路径 B：走 archive 闭环（done event + 不 set-done）
- 如何诊断"auto_upgrade 未生效 vs 我漏了前置步骤"

### 问题链 2：待审 worker 遗漏 C2（P1-G）

```
commander → root → auditor 中转链
  auditor 审了 6 worker（A1/A2/A3/B1/B2/C1）
  C2 被 root 自审（auditor_session_id=root, audit_log=0）
  C2 漏了异厂商（MiniMax）审查
```

**SKILL 层根因**: §13.4.0 auditor 协议教了"如何建 auditor leaf + 四步流程"，但 **没有教 commander/root 在"中转链"上维护待审 worker 清单**。macp3 的架构是"commander 派 worker → worker done → root 中转给 auditor → auditor 审"，root 是中转枢纽，但 root 没有一个"待审队列"视角来确保所有 worker 都被 auditor 审到了。C2 从 root 指间滑落。

### 问题链 3：C-commander alignment 中期漏回填（P1-H）

```
C-commander 收到 C1/C2 brief_echo
  → 评估了对齐度（alignment=0.95）
  → 但中期漏回填 alignment event 到 worker leaf
  → 并发处理遗漏（同时处理多个 worker）
```

**SKILL 层根因**: §6 brief_echo 回填机制教了"必须回填"，但 **没有给 commander 一个硬 checklist** 确保每个派出的 worker 都有对应的 alignment 回填完成。commander 的 mind 在并发调度中被摊薄——"派了"不等于"对齐已回填"。需要一个类似 P1-A comm_log 的硬 checklist 保证每一步都留痕。

### 问题链 4：知识断层（P2-B）

macp3 的两大发现——E_NO_OWNERSHIP 中转协议（§2.2）+ root done 门禁（§4）——是跨轮次有价值的经验，但目前还在评估报告里，没有沉淀到 auto memory。macp4 的 Agent 如果不读 macp3 评估报告，可能重蹈覆辙。

### 问题链 5：层级选择隐式（P2-C）

macp3 从 macp2 的 4 层（root→cmd→sub-cmd→worker）扁平化为 3 层（root→cmd→worker）。这个设计决策在 macp3 实战中是 **隐式的**——root 初始建树时选了 3 层，但 SKILL 没有教"何时该选 3 层 vs 4 层"，也没有解释扁平化的利弊。

---

## 一、P1-F：SKILL 教 root done 路径

### 1.1 当前 SKILL 状态

**§13.3a "root 自身 done"**（tree-commander v2.9.2 L442-447）：

```text
root（commander 自己）的 leaf 要 done 时，**不需要**走 §13.3 八步。引擎 auto_upgrade 机制
（tree-engine.cjs L1961-1972）：root 写自己的 done event（caller=root，带 self_check）→ audit_gate
自动从 skip 升为 pass（auto_upgrade=true）。即 root 只需：
  tree_event_append(type=done, meta={self_check}) → tree_leaf_set_status(status=done)
```

**§13.3a 本身是清晰的**：它明确说了"不需要走八步"、"引擎 auto_upgrade"、"root 只需写 done event → set-status done"。

但 **macp3 实战暴露了一个关键 gap**：

- 引擎检查 L1767（milestone 非空且全部 audit_pass=true）在 `set-status done` 时触发，auto_upgrade 只处理 audit_gate（skip→pass）， **不豁免 milestone 检查**。
- root 0 milestones + role=root 在 L1767 无豁免 → 即使写了 done event 触发 auto_upgrade，`set-status done` 仍然撞 `E_SCHEMA_INVALID`。
- §13.3a 的"root 只需 A→B"描述 **过于乐观**——它隐含假设 auto_upgrade 能覆盖全部 done 前置，但引擎实际不是这样设计的。

### 1.2 论证：可行性分析

**问题本质**：§13.3a 的 auto_upgrade 路径是否真的能让 root done？需要拆解引擎的三个独立检查：

| 检查项 | 引擎位置 | 对 role=root 是否有豁免 | auto_upgrade 是否覆盖 |
|--------|---------|----------------------|---------------------|
| milestone 非空 + 全部 audit_pass | L1767 | **无豁免**（macp3 实测撞墙） | **否**（auto_upgrade 只处理 audit_gate） |
| events 含 done event | L1399 附近 | 需确认 | **是**（写 done event 触发 auto_upgrade） |
| audit_gate verdict=pass | L1399 附近 | skip→pass（auto_upgrade=true） | **是** |

**所以 §13.3a 的实际效果**：root 写 done event 后，auto_upgrade 让 audit_gate 从 skip 升 pass，但 **L1767 的 milestone 检查仍在**。root 仍需绕过 milestone 检查才能 set-status done。

**三种路径的可行性**：

#### 路径 A：root 给自己 milestone_add（利用 L1767）

```text
root: tree_milestone_add(tree_id, leaf_id=<root>, milestone={id:"M-root-done", desc:"全树实现层 done", expect_outputs:[]})
root: tree_milestone_set_result(tree_id, leaf_id=<root>, milestone_id="M-root-done", audit_pass=true, audit_session_id=<root.session_id>)
root: tree_event_append(type=done, meta={self_check})  # 触发 auto_upgrade
root: tree_leaf_set_status(status=done)                 # L1767: 1 milestone audit_pass=true ✅
```

| 维度 | 评估 |
|------|------|
| 可行性 | 🟢 高 — 利用已有机制，无需引擎改动 |
| 风险 | 🟢 低 — milestone_add / set_result 是 root 已有权限（闸门2） |
| 工作量 | 🟢 极小 — 3 行工具调用，§13.3a 加一段解释 |
| 副作用 | 🟡 需确认 expect_outputs=[] 空数组是否被引擎接受（可能要求 ≥1） |

#### 路径 B：走 archive 闭环（done event + 不 set-done）

```text
root: tree_event_append(type=done, meta={self_check})
root: tree_leaf_set_status(status=archived)  # 或保持 active 但记录完成
```

| 维度 | 评估 |
|------|------|
| 可行性 | 🟡 中 — archive 不需要 milestone 检查，但语义是"归档"而非"完成" |
| 风险 | 🟡 中 — 状态语义错位（archive≠done），影响后续查询/统计 |
| 工作量 | 🟢 极小 |
| 副作用 | 🔴 高 — 树中 root archived 而非 done，可能影响 validate / 心跳 / 恢复逻辑 |

#### 路径 C：标注 role=root 的 done 门禁特殊性

不新增过程，只在 SKILL 中标注"root done 引擎限制说明"，让 root 知难而退（走路径 A 或等引擎修）。

| 维度 | 评估 |
|------|------|
| 可行性 | 🟢 高 — 纯文档 |
| 风险 | 🟢 低 |
| 工作量 | 🟢 极小 — §13.3a 加一段 warning |
| 副作用 | 🔴 如果没有路径 A 配合，等于告诉 root "你 done 不了" |

### 1.3 建议方案

**推荐路径 A + C 组合**（路径 A 为主路线 + §13.3a 补诊断说明）：

```
改 §13.3a，分为三个子节：

§13.3a.1 正常路径（auto_upgrade 直接过）
  条件：引擎 L1767 对 role=root 有豁免，或 root 已有 milestone
  操作：写 done event → set-status done

§13.3a.2 备选路径（milestone_add 绕过 L1767）
  条件：引擎 L1767 无 role=root 豁免（当前状态）
  操作：root 先 milestone_add 给自己（1 条）+ milestone_set_result → done event → set-status done

§13.3a.3 诊断
  set-status done 撞 E_SCHEMA_INVALID → 检查是否有 milestone
  E_GATEKEEPER_REQUIRED → 检查是否写了 done event（auto_upgrade 依赖 done event）
```

**具体改动**：

| 改哪节 | 改什么 | 新增行数 |
|--------|--------|---------|
| §13.3a（L442-447） | 从单段扩展为三个子节（正常路径 / 备选路径 / 诊断）+ 标注当前引擎 L1767 行为 | ~20 行 |
| §13.7 错误码速查表 | 新增 `E_SCHEMA_INVALID` 在 root set-status done 场景的特殊处理（"先 milestone_add 给自己"） | ~5 行 |

### 1.4 是否需要引擎配合

**不必须**（路径 A 可用现有机制绕过），但强烈建议引擎侧修 L1767 对 role=root 豁免（减少 SKILL 复杂度）：

- **引擎小修（推荐）**: L1767 加 `|| leaf.role === 'root'` 豁免。修改后 §13.3a 可简化为单路径（写 done event → set-status done），§13.3a.2 降级为"旧版引擎兼容说明"。
- **不在本次 SKILL 论证范围**，仅标注为"引擎配合建议"。

### 1.5 优先级：🟡 P1（中高）

**理由**: 虽然 macp3 root 保持 active 等评估是"有意"（等 C1 评估），但 macp4 如果实现层再 100% 而 root 仍卡 done，会是系统性阻塞。**SKILL 侧低成本改动（~25 行）即可解决，应优先做。**

---

## 二、P1-G：流程 待审 worker 清单（防 C2 遗漏）

### 2.1 当前 SKILL 状态

**§13.4.0 建 auditor leaf 协议**教了四步流程（建 auditor leaf → auditor 完成工作 → root 背书 auditor → auditor 审全树），但聚焦在"如何建 auditor"而非"auditor 审谁"。**没有任何一节**教 root（中转身）维护"待审 worker 清单"。

**§13.4.0 步骤 D** 说"auditor 可以给任意 worker leaf 配门禁，不限子树范围"，但这是能力声明，不是流程指导。

### 2.2 论证

**macp3 C2 遗漏的根因链**：

```
1. C2 是最后一个 done 的 worker（时序靠后）
2. root 中转时，已审了 6 worker（A1/A2/A3/B1/B2/C1）
3. C2 done 后，root 可能"以为 auditor 会自然继续审"或"忘记 C2 也在待审清单里"
4. root 没有"待审 worker 清单"视角 → C2 滑落 → root 自审代替（auditor_session_id=root）
```

**问题本质**：中转链（commander→root→auditor）中，root 需要承担"审计划度员"角色——追踪"哪些 worker 已 done 等审、哪些已审、哪些还没做"——但 §13.4.0 没有教这个角色的操作流程。

### 2.3 建议方案

#### 方案 S1：纯 SKILL 清单（无需引擎配合）

在 §13.4.0 步骤 D 之后新增"§13.4.0a 待审 worker 清单维护流程"：

```text
root 在中转链上的待审清单操作:
  1. 每当 commander 派 worker → root 在待审清单记一行 {leaf_id, commander, status='pending_done'}
  2. worker done → 更新 status='pending_audit'，准备中转给 auditor
  3. root 中转给 auditor → 更新 status='in_audit'
  4. auditor audit_gate pass → 更新 status='audited'，划掉
  5. 定时检查待审清单：status='pending_audit' 超过 N 分钟未进入 'in_audit' → 主动中转
  6. 树全面 done 前做最终遍历：待审清单中 status!='audited' 的按条排查

清单格式: 可用 .context/ 下维护一个 pending-audit.md 或直接在 tree events 中用 plan/status_check 记录
```

| 维度 | 评估 |
|------|------|
| 可行性 | 🟢 高 — 纯流程规范，不依赖引擎 |
| 风险 | 🟡 中 — root 在并发场景下仍可能忘记维护清单（但至少有了规范可追责） |
| 工作量 | 🟡 中 — 新节 ~30 行 + §13.4.0 步骤 D 后交叉引用 |
| 副作用 | 🟢 低 |

#### 方案 S2：引擎配合"待审队列"（可选增强）

在 tree 引擎加 `tree_audit_queue_add` / `tree_audit_queue_list` / `tree_audit_queue_done` 工具，让 root 在中转时不必手动维护清单。

| 维度 | 评估 |
|------|------|
| 可行性 | 🟡 中 — 需要引擎改动，不在本次论证范围 |
| 风险 | 🟡 中 — 新增引擎概念，可能引入 bug |
| 工作量 | 🔴 高 — 引擎新命令 + schema + 校验 + MCP 暴露 |
| 副作用 | 🟡 新增工具可能增加认知负担 |

### 2.4 推荐

**先做 S1（纯 SKILL），S2 作为引擎 backlog**。S1 解决 80% 的遗漏问题（root 有清单视角后，C2 类遗漏概率大幅下降）。S2 作为长期增强（自动校验队列完整性）。

**具体改动**：

| 改哪节 | 改什么 | 新增行数 |
|--------|--------|---------|
| §13.4.0 步骤 D 后 | 新增 §13.4.0a "待审 worker 清单维护流程"（6 步操作 + 格式建议） | ~30 行 |
| §13.4.0 步骤 D | 末尾加一行 "→ 待审清单维护见 §13.4.0a" | ~1 行 |
| §11 禁止行为 | 新增 #N "root 中转链上不维护待审 worker 清单导致漏审" | ~2 行 |

### 2.5 是否需要引擎配合

**不必须**（S1 纯 SKILL 可行）。引擎配合（S2 待审队列）是 nice-to-have，优先级低。

### 2.6 优先级：🟡 P1（中）

**理由**: C2 遗漏是 macp3 具体实例，macp4 若继续存在多 worker 并行 done + 中转审场景，漏审概率非零。但不像 P0-E 那样阻塞整体闭环。

---

## 三、P1-H：SKILL commander brief_echo alignment 对齐 checklist

### 3.1 当前 SKILL 状态

**§6 brief_echo 回填机制**（L311-355）已经教得很详细：
- 回填步骤（1-5）
- auditor 选择决策（冷启动/正常期）
- 不做的后果（E_ALIGNMENT_NOT_VERIFIED → worker 卡死）
- V5b 硬约束说明

**§4 Step3 事件路由**表中 brief_echo 行也说"③ 回填 alignment event（V5b 必须）"。

**所以当前 SKILL "教"得够**——commander 知道应该回填。**问题不是"不知道"，而是"在并发场景下忘记做"**。

### 3.2 论证

**macp3 C-commander alignment 漏回填的根因**：

```
C-commander 同时处理 C1 和 C2 的 brief_echo
  → 评估了 C1 对齐（alignment=0.95）
  → 评估了 C2 对齐
  → 但只回填了其中一个（并发打断）
  → 另一个 worker 永远拿不到 alignment → audit_gate 卡 E_ALIGNMENT_NOT_VERIFIED
```

这是典型的 **"并发摊薄注意力"问题**——commander 知道要回填（§6 教了），但并发调度中某条 worker 的回填被其他事件打断后没有恢复机制。

### 3.3 建议方案

**加硬 checklist（类似 P1-A comm_log 的升级路径）**：

在当前 §6 brief_echo 回填机制末尾加一个 **"回填完成确认清单"**：

```text
commander 收到 worker brief_echo 后，必须在下发下一个 worker 前完成以下确认：

回填完成确认清单（逐条 ✅ 后才能继续）:
  [ ] worker 的 brief_echo event 已写入（worker 自写）
  [ ] alignment 评估已执行（≥85% 或 <85% 走纠偏）
  [ ] alignment 回填 event 已 append 到 worker leaf
  [ ] tree_log_communication 已记录（send_message 后紧接，§11 #15）
  [ ] 下一个 worker 的 brief_echo 才能开始评估

并发场景特殊规则:
  - 同时收到 ≥2 worker brief_echo → 按 leaf_id 字典序排队，一个完成回填再处理下一个
  - 禁止并发评估 + 并发回填（context switching 导致遗漏）
```

同时，在 §4 Step3 事件路由表中 brief_echo 行加一个"必须"标注，指向这个 checklist。

| 维度 | 评估 |
|------|------|
| 可行性 | 🟢 高 — 纯流程约束 |
| 风险 | 🟡 中 — commander 仍可能在压力下跳过（但至少有了可追责规范） |
| 工作量 | 🟢 低 — ~15 行 |
| 副作用 | 🟡 轻度降低并发效率（排队处理 brief_echo 而非并行）— 可接受，brief_echo 本身很快 |

### 3.4 具体改动

| 改哪节 | 改什么 | 新增行数 |
|--------|--------|---------|
| §6 brief_echo 回填机制末尾 | 新增"回填完成确认清单"（5 项 checklist + 并发规则） | ~15 行 |
| §4 Step3 事件路由表 brief_echo 行 | "③ 回填 alignment event" 后加 "→ 必须逐条完成 §6 回填确认清单" | ~1 行 |
| §11 禁止行为 | 新增 #N "收到 worker brief_echo 后未逐条完成回填确认清单就继续派下一个 worker" | ~1 行 |

### 3.5 是否需要引擎配合

**不需要**。纯流程规范。

### 3.6 优先级：🟡 P1（中）

**理由**: macp3 实战暴露了真实遗漏——说明"教了"不等于"能做到"。但不像 P0-E（root done）那样阻塞闭环，也不像 P1-G（C2 遗漏）那样直接损害审计覆盖率。是流程加固。

---

## 四、P2-B：知识沉淀 — auto memory

### 4.1 当前记忆状态

当前 `.claude/memory/MEMORY.md` 索引 6 条：

```
- 子会话并行保上下文新鲜
- Git Bash tasklist 陷阱
- tree MCP 运行时兼容
- PR 档案位置
- release 派子会话渠道
- 树形迭代开发 SOP
```

**没有** E_NO_OWNERSHIP 中转协议和 root done 门禁的记忆。

### 4.2 论证：该沉淀什么

macp3 的两大发现适合沉淀到 auto memory：

| 发现 | 适合写 memory 的理由 | 不适合的理由 |
|------|-------------------|-------------|
| E_NO_OWNERSHIP 中转协议 | 跨 macp 轮次复用（macp4 仍可能走中转链）；commander 须知"兄弟不通信要经 root 中转"的延迟开销 | 如果 macp4 引擎修了 E_NO_OWNERSHIP（兄弟可通信），部分内容会过时 |
| root done 门禁 | 跨轮次复用（macp4 root 也可能撞同一堵墙）；是已知模式 | 如果引擎修了 L1767 豁免，路径会简化 |

**建议写法**：不以"事实断言"而以"已知模式 + 条件"写，即使引擎改了也能帮助理解为什么 SKILL 里有那段 §13.3a 兼容代码。

### 4.3 建议方案

**新增/修改文件**：

#### 文件 1：`.claude/memory/tree-e-no-ownership-transit.md`（新文件）

```markdown
# E_NO_OWNERSHIP 中转协议（macp3 实战沉淀）

## 问题
树形会话体系中，兄弟 leaf（commander→worker）不直接通信。
macp3 实证：commander 的中转链 = commander→root→auditor→root→commander。

## 已知模式
- 中转协议 **可以 work**（macp3: auditor 成功审了 6/7 worker）
- 但存在 **延迟开销**（auditor 空闲 26+ 分钟才接到首个请求）
- 且有 **遗漏风险**（C2 被 root 自审而非异厂商审）

## 应对（供 macp4+）
- 走中转链时，root 必须维护 **待审 worker 清单**（tree-commander SKILL §13.4.0a）
- 如果引擎开放兄弟通信（auditor role 白名单），优先走直连而非中转
- 中转链不是不可用，但需主动管理

## 来源
macp3 最终评估报告 §2.2, §七 P1-B
```

#### 文件 2：`.claude/memory/tree-root-done-gate.md`（新文件）

```markdown
# root done 门禁（macp3 实战沉淀）

## 问题
root（commander 自己）无法 set-status done：
- 引擎 L1767 检查 milestone 非空 + audit_pass=true
- role=root 无豁免
- auto_upgrade（§13.3a）只处理 audit_gate，不豁免 milestone 检查

## 已知模式
- root 0 milestones → set-status done 撞 E_SCHEMA_INVALID
- 引擎 auto_upgrade 让 audit_gate skip→pass，但不管 milestone

## 应对（供 macp4+）
- 路径 A（SKILL 教）：root 先 milestone_add 给自己 → set-status done
- 路径 B（引擎修）：L1767 加 role=root 豁免（推荐）
- 路径 C（应急）：走 archive 闭环（done event + archived）
- 当前 SKILL 默认路径 A（tree-commander §13.3a.2）

## 来源
macp3 最终评估报告 §四, §七 P0-E
```

#### 文件 3：MEMORY.md（改一行 + 加两行索引）

在索引区新增：
```
- [E_NO_OWNERSHIP 中转协议](tree-e-no-ownership-transit.md) — macp3 实证：兄弟不通信的中转开销+遗漏风险；应对=待审清单+优先直连
- [root done 门禁](tree-root-done-gate.md) — macp3 实证：root 0 milestones 撞 L1767；应对=milestone_add 给自己
```

| 维度 | 评估 |
|------|------|
| 可行性 | 🟢 高 — 纯文件新增 |
| 风险 | 🟢 低 — 不会破坏已有流程 |
| 工作量 | 🟡 中 — 2 新文件（~50 行）+ MEMORY.md 改 2 行 |

### 4.4 优先级：🟢 P2（长期）

**理由**: 对 macp4 有参考价值，但不阻塞。macp4 Agent 会加载 macp3 评估报告 + 两个 SKILL + 这些 memory。先于 macp4 实施前沉淀好即可。

---

## 五、P2-C：文档 — macp3 扁平 3 层 vs macp2 4 层设计选择

### 5.1 当前 SKILL 状态

**§4 Step2.1 "层级委派协议"**（v2.7）已经讲了：
- root→commander→worker 的委派路径
- 越级反模式（root 越级 leaf_add worker → W_STAR_DEGRADATION）
- "单层树合法"例外（无 commander 时 root 直辖 worker）

但 **没有讲** 什么时候该选 3 层（root→cmd→worker）vs 4 层（root→cmd→sub-cmd→worker），也没有解释 macp3 为什么从 macp2 的 4 层扁平化为 3 层。

### 5.2 论证

macp3 的扁平化是 **有意识的改进**，不是随机选择：

| 维度 | macp2 4 层 | macp3 3 层 |
|------|-----------|-----------|
| 结构 | root→cmd→sub-cmd→worker | root→cmd→worker |
| 委派深度 | 3 级 | 2 级 |
| commander 自主性 | sub-cmd 缓冲了 commander 的直接压力 | commander 直管 worker，压力更大但链条更短 |
| 中转开销 | sub-cmd 增加一层中转 → 更慢 | 少一层中转 → 更快 |
| 适用场景 | 大规模项目（worker > 10）、需要子域分隔 | 中小规模项目（worker ≤ 10）、任务同质 |

macp3 的结果支持 3 层可行性：7 worker 全 done，commander 全 archived。但 C2 遗漏提示 3 层中 commander 的负载更高（要同时管更多 worker）。

### 5.3 建议方案

在 §4 Step2.1 内或之后加 **"层级选择指导"** 子节：

```text
§4 Step2.1a 层级选择指导

| 条件 | 推荐层数 | 结构 |
|------|---------|------|
| worker ≤ 6，任务同质、不需要子域分隔 | 3 层 | root→cmd→worker（macp3 模式） |
| worker 7-12，任务可分组 | 3 层 + 多个 commander | root→cmd-A→workers-A + cmd-B→workers-B |
| worker > 12，跨子域、需要独立 auditee | 4 层 | root→cmd→sub-cmd→worker（macp2 模式） |
| 极简任务（≤ 3 worker） | 2 层 | root→worker（单层树，§4 Step2.1 例外） |

macp3 选择 3 层的原因: 12 leaf 中 7 worker 任务同质（coder/judge 相关），
不需要 sub-cmd 子域分隔，扁平化减少一级中转延迟。
```

| 维度 | 评估 |
|------|------|
| 可行性 | 🟢 高 — 纯文档 |
| 风险 | 🟢 低 — 指导性原则，不是铁律 |
| 工作量 | 🟢 低 — ~20 行 |

### 5.4 具体改动

| 改哪节 | 改什么 | 新增行数 |
|--------|--------|---------|
| §4 Step2.1 结尾 | 新增 §4 Step2.1a "层级选择指导"（条件表 + macp3 选择说明） | ~20 行 |

### 5.5 优先级：🟢 P2（长期）

**理由**: 对 macp4 建树时有指导价值，但不如 P1 各项紧迫。

---

## 六、SKILL/流程整体方案

### 6.1 改进总览

```
tree-commander v2.9.2 → v2.10.0（建议版本号）
  改动:
    §4 Step2.1a NEW    层级选择指导（P2-C）
    §6 回填确认清单      brief_echo alignment 回填硬 checklist（P1-H）
    §11 #N NEW         禁止漏维护待审清单（P1-G）
    §11 #N NEW         禁止未完成回填确认清单就继续（P1-H）
    §13.3a REWRITE     root done 路径扩展（正常/备选/诊断）（P1-F）
    §13.4.0a NEW       待审 worker 清单维护流程（P1-G）
    §13.7 错误码速查    加 E_SCHEMA_INVALID root done 场景（P1-F）
    §15 修订历史        v2.10.0 条目

tree-worker v2.6 → v2.7（建议版本号）
  无需改动（P1-F/G/H 全部在 commander 侧）

.claude/memory/
  tree-e-no-ownership-transit.md NEW   E_NO_OWNERSHIP 中转协议记忆（P2-B）
  tree-root-done-gate.md        NEW   root done 门禁记忆（P2-B）
  MEMORY.md                     EDIT  加 2 行索引（P2-B）
```

### 6.2 改动统计

| 层 | 新增节 | 修改节 | 新增行数 | 删除行数 |
|----|--------|--------|---------|---------|
| tree-commander SKILL | 2（§4 Step2.1a + §13.4.0a） | 3（§6, §11, §13.3a） | ~70 | ~5（§13.3a 旧单段被替换） |
| tree-worker SKILL | 0 | 0 | 0 | 0 |
| auto memory | 2 新文件 | MEMORY.md | ~55 | 0 |
| **总计** | | | **~125** | **~5** |

### 6.3 与 P0-E（引擎 root done 门禁）的关系

| 场景 | 路径 |
|------|------|
| 引擎已修 L1767（role=root 豁免） | §13.3a 简化为"写 done event → set-status done"，§13.3a.2 降级为"旧版兼容" |
| 引擎未修 | §13.3a.2 是主路径（milestone_add 绕过 L1767），§13.3a.1 标注"需引擎配合" |
| 不确定引擎是否修了 | §13.3a.3 诊断步骤帮助 root 判断当前引擎行为 |

这样 SKILL 改动与引擎改动解耦——不管引擎修不修，SKILL 都能教 root 怎么 done。

---

##七、引擎配合需求分析

### 7.1 需要引擎配合

| 改进点 | 引擎改动 | 优先度 | 理由 |
|--------|---------|--------|------|
| P0-E root done 门禁 | L1767 加 `|| leaf.role === 'root'` 豁免 | 🔴 P0 | macp3 闭环最后一道门没开。SKILL 可以用 milestone_add 绕过，但不如引擎直接豁免干净 |
| P1-G 待审 worker 清单 | 新增 `tree_audit_queue_*` 工具（可选） | 🟢 P2 | S1 纯 SKILL 已解决 80% |

### 7.2 不需要引擎配合

| 改进点 | SKILL 侧可独立完成 |
|--------|-------------------|
| P1-F root done 路径 | §13.3a 路径 A（milestone_add）+ 诊断 |
| P1-G 待审清单 | §13.4.0a 纯流程（6 步） |
| P1-H alignment 回填 checklist | §6 硬 checklist |
| P2-B 知识沉淀 | auto memory 文件 |
| P2-C 层级选择 | §4 Step2.1a |

**结论**：五项 SKILL/流程改进中，四项无需引擎配合即可完整落地。仅 P0-E（root done 引擎豁免）建议引擎配合以使 SKILL 更简洁，但不是前置条件。

---

## 八、优先级排序 & 实施建议

### 8.1 优先级矩阵

| # | 改进点 | 层 | 优先级 | 工作量 | 引擎依赖 | 阻塞性 |
|---|--------|----|--------|--------|---------|--------|
| P1-F | root done 路径 | SKILL | 🟡 P1（中高） | ~25 行 | 可选（不依赖） | 如果 macp4 root 也要 done，可能阻塞 |
| P1-G | 待审 worker 清单 | SKILL | 🟡 P1（中） | ~33 行 | 可选（S2） | C2 类遗漏概率降低 |
| P1-H | alignment 回填 checklist | SKILL | 🟡 P1（中） | ~17 行 | 无 | 避免并发遗漏 |
| P2-B | 知识沉淀 | Memory | 🟢 P2（低） | ~52 行 | 无 | 不阻塞 |
| P2-C | 层级选择指导 | SKILL | 🟢 P2（低） | ~20 行 | 无 | 不阻塞 |

### 8.2 推荐实施顺序

```
Phase 1（macp4 启动前必做，30 分钟）:
  1. P1-F（root done 路径）— 解决 macp3 暴露的最大 SKILL gap
  2. P1-H（alignment 回填 checklist）— 防并发遗漏

Phase 2（macp4 建树前做，30 分钟）:
  3. P1-G（待审 worker 清单）— 防 C2 类遗漏
  4. P2-C（层级选择指导）— 帮 macp4 建树时做正确选择

Phase 3（macp4 进行中或之前，15 分钟）:
  5. P2-B（知识沉淀）— 写 auto memory
```

### 8.3 风险提示

1. **P1-F + P0-E 联动风险**：如果 engine 侧同步修 L1767（role=root 豁免），§13.3a.2 的 milestone_add 路径会变成多余的兼容代码。建议实施前与引擎侧沟通，避免 SKILL 刚改完引擎又改了导致重复劳动。

2. **P1-H 并发效率**：硬 checklist 要求排队处理 brief_echo 而非并行，可能轻度降低 commander 响应速度。考虑到 brief_echo 本身只需几秒评估，排队开销可接受。如果 future macp 中 worker 数量 > 20，可改为"每 3 个一批"而非逐个排队。

3. **P1-G 清单维护负担**：root 已承担中转调度 + heartbeat 巡检 + 纠偏，再加清单维护可能 overload。如果 root 上下文已接近甜点（85%），建议把清单维护委派给一个独立 "tracker" leaf 或 SDK SubAgent。

---

## 九、附录：关键引用

### A.1 macp3 评估报告相关行

- §2.2 E_NO_OWNERSHIP 最终复核 → "中转协议最终 work，但 C2 遗漏异厂商审查"
- §四 root done 门禁 → "root 0 milestones + role=root 无豁免 L1767"
- §七 P0-E → "修 root role done 门禁（新头号）"
- §七 P1-F → "tree-commander SKILL 教 root done 路径"
- §七 P1-G → "C2 类异厂商审查遗漏修复"
- §七 P1-H → "commander brief_echo alignment 对齐 checklist"
- §七 P2-B → "E_NO_OWNERSHIP 中转协议 + root done 门禁发现沉淀 auto memory"
- §七 P2-C → "文档化 macp3 扁平 3 层 vs macp2 4 层的设计选择"

### A.2 SKILL 版本与行号

- tree-commander v2.9.2: §13.3a (L442-447), §13.4.0 (L479-528), §6 (L311-355), §4 Step3 (L196-210), §4 Step2.1 (L163-198)
- tree-worker v2.6: §2.5 lifecycle (L128-163), §3.4 brief_echo (L322-357)
