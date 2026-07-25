# SKILL 层改进实施报告

> **来源**: macp2 评估报告 §5 改进建议（P1-C / P1-A / P0-A）
> **实施日期**: 2026-07-25
> **实施方案**: 方案 A（P1-C + P1-A + P0-A 流程）
> **改动范围**: tree-commander (v2.9.1→2.9.2) + tree-worker (v2.5→2.6)
> **引擎改动**: 零行（P0-A 引擎闸门2→闸门3 已天然支持，见 engine-evaluation.md）

---

## 改动总览

| # | 项目 | 文件 | 位置 | 行数 |
|---|------|------|------|------|
| 1 | P1-C | tree-commander | §3.4 autonomy 段 | +1 行 |
| 2 | P1-C | tree-worker | §1 铁律 #10 | +1 行 |
| 3 | P1-C | tree-worker | §2.5 lifecycle 衔接警示 | +1 行 |
| 4 | P1-C | tree-commander | §13.3 八步末尾警示 | +1 行 |
| 5 | P1-A | tree-commander | §4 Step3 事件路由 | +2 行 |
| 6 | P1-A | tree-commander | §11 禁止行为 #15 | +1 行 |
| 7 | P1-A | tree-commander | §6 措辞升级 | ~3 行改 |
| 8 | P0-A | tree-commander | §13.4.0 建 auditor 协议 | +28 行 |
| — | version | 两个文件 | §0 + §15/§11 | ~4 行 |

---

## 逐条改动记录

### 改动 1: P1-C — tree-commander §3.4 autonomy 段加 `final_step`

**位置**: tree-commander §3.4 autonomy 模板，`must_ask` 之后

**改前**: autonomy 只有 `can_decide`/`must_report`/`must_ask` 三字段

**改后**: 新增 `final_step` 字段:
```yaml
final_step: "完成所有产出 + 收到 audit_gate pass 后，**你（worker）自己调 tree_leaf_set_status(status=done)**。commander 不代调（代调被引擎 E_BORROWED_IDENTITY 拦截）"
```

**意图**: 让 worker 在收到 5 件套 brief 的第一刻就知道 set-status done 必须自己调——这是最关键的信息投放位置（论证 §3.3 根因 2）

---

### 改动 2: P1-C — tree-worker §1 铁律新增 #10

**位置**: tree-worker §1 铁律表，原 9 条末尾

**改前**: 铁律 9 条，无 set-status caller 规则

**改后**: 新增 #10:
```
| 10 | **set-status done 必须 worker 自己调** — commander 代调被 E_BORROWED_IDENTITY 拦；步骤 8 audit_gate pass 由 commander 完成，步骤 9 set-status done 是你自己的事 | 引擎硬拦，worker 卡"等通知"浪费时间 |
```

**意图**: 将 P1-C 规则提升到铁律级别（论证 §3.3 根因 3：tree-worker §1 铁律没有覆盖此规则）

---

### 改动 3: P1-C — tree-worker §2.5 lifecycle 阶段 8→9 之间加醒目衔接规则

**位置**: tree-worker §2.5 lifecycle 表格，阶段 8 和 9 之间

**改前**: 阶段 8（audit_gate pass）和阶段 9（set-status done）紧邻，无衔接说明

**改后**: 在两行之间插入醒目行:
```
| ⚠️ **衔接规则** | — | — | **步骤 8 是 commander 的最后一步，步骤 9 是你（worker）自己的事——不要等 commander 通知你调 set-status，audit_gate pass 本身就是"可以 set-status"的信号** |
```

**意图**: 直接打破"邻接混淆"（论证 §3.3 根因 1：步骤 8/9 紧邻导致 worker 误以为 commander 会顺带做步骤 9）

---

### 改动 4: P1-C — tree-commander §13.3 八步末尾加警示

**位置**: tree-commander §13.3 ⚠️ 关键约束段末尾

**改前**: 关键约束覆盖步骤 0/1/5/6，无步骤 7 约束

**改后**: 新增:
```
- **步骤 7**：set-status done 必须 worker 自己调（caller=worker）。commander 做完步骤 6（audit_gate pass）后 send_message 通知 worker "audit_gate pass，你可以 set-status done"——但执行者是 worker。commander 代调步骤 7 → `E_BORROWED_IDENTITY`
```

**意图**: commander 侧也明确"步骤 7 不是我的事"（对称 P1-C 的 worker 侧铁律）

---

### 改动 5: P1-A — tree-commander §4 Step3 事件路由加 comm_log 硬要求

**位置**: tree-commander §4 Step3 事件路由段末尾

**改前**: 只提 `tree_event_append`，不提 comm_log

**改后**: 新增醒目行:
```
**【必须】每次 `send_message` 给树内 leaf 后，紧接 `tree_log_communication(tree_id, target_session_id=<session>, direction='out', note='…')`——漏记一次即违规（§11 #15）。**
```

**意图**: 把 comm_log 从"§6 文档深处的 advisory"提升到"§4 工作流程的硬 check"

---

### 改动 6: P1-A — tree-commander §11 禁止行为新增 #15

**位置**: tree-commander §11 禁止行为表，原 #14 之后

**改前**: 禁止行为 14 条，无 comm_log 漏记条目

**改后**: 新增 #15:
```
| 15 | send_message 给树内 leaf 后漏记 tree_log_communication | 心跳巡检看不到通信活动，误判 target leaf 冻结（macp2 实战 ~10% 漏记触发升级） | 每次 send_message 后紧接 tree_log_communication（§6 硬要求）。commander 心跳读 communication_log 感知 IPC 活动 |
```

**意图**: 漏记 = 协议违规，纳入禁止行为清单，与 #15 违规后果挂钩

---

### 改动 7: P1-A — tree-commander §6 措辞从 advisory 升级为硬要求

**位置**: tree-commander §6 外部通信记录协议末尾段

**改前**:
```
**为什么不用自动 hook**：send_message 是核心 IPC，自动 hook 需透传 workspaceSlug 到 session handler，侵入风险高于 P1 优先级。当前靠协议教化（同 "done 即 set-status" 模式）；macp 实战若再证普遍漏调，再考虑自动 hook。
```

**改后**:
```
**硬要求**（macp2 实战再证 ~10% 漏记后升级）：每次 send_message 后必须紧接 tree_log_communication。漏记 = 协议违规，属 §11 禁止行为 #15。
```

**意图**: v2.9 当初设计的"先教化、再观察、必要时自动 hook"渐进路径——macp2 评估触发了升级条件。措辞从"靠协议教化…若再证…再考虑"改为"硬要求…漏记=违规"

---

### 改动 8: P0-A — tree-commander §13.4 转正常期加建 auditor leaf 协议

**位置**: tree-commander §13.4 转正常期，原有 2 行内容之后

**改前**: §13.4 仅 2 行简单说明"root 把 auditor leaf 喂到 V10-auditor-active"

**改后**: 新增 §13.4.0 子节（~28 行），含:
- **四步流程**：A. fork auditor leaf → B. auditor 自己 done → C. root 闸门2 背书 → D. auditor 闸门3 给全树配门禁
- **关键认知**：引擎闸门2→闸门3 已天然支持，macp2 问题是 commander 不知道建 auditor；冷启动→正常期过渡；auditor set-status 也要自己调

**意图**: 教 commander 建独立 auditor leaf，打通 P0-A 全自主 done 闭环（引擎零改动）

**风险**: 该流程依赖 commander 正确理解四步协议。若 commander 跳过步骤 C（root 不背书 auditor），auditor 无法满足闸门3 的 audit_gate=pass 前置。已通过 §13.4.0 关键认知段说明 V10 冷启动约束的打破方式。

---

## 版本变化

| 文件 | 旧版本 | 新版本 |
|------|--------|--------|
| tree-commander/SKILL.md | v2.9.1 | **v2.9.2** |
| tree-worker/SKILL.md | v2.5 | **v2.6** |

- tree-commander §15 新增 v2.9.2 条目：macp2 改进（P1-C + P1-A + P0-A）
- tree-worker §11 新增 v2.6 条目：P1-C set-status caller 铁律 + lifecycle 衔接警示

---

## cp + 验证结果

### cp（release → pro）

```
release: C:/Users/sir_c/.proma/agent-workspaces/proma/skills/
pro:     C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/

tree-commander/SKILL.md → cp ✅
tree-worker/SKILL.md    → cp ✅
```

### grep 验证

| 文件 | 搜索模式 | 命中 |
|------|---------|------|
| tree-commander | `final_step` | ✅ L153（§3.4）+ L1064（§15） |
| tree-commander | `#15` | ✅ L258（§4）+ L402（§6）+ L1064（§15） |
| tree-commander | `建.*auditor leaf` | ✅ L825-832（§13.4.0） |
| tree-commander | `2.9.2` | ✅ L21（§0）+ L1064（§15） |
| tree-worker | `set-status.*自己调` | ✅ L55（§1 #10）+ L112（§2.5） |
| tree-worker | `version: 2.6` | ✅ L30（§0） |

### diff release vs pro

```
tree-commander: IDENTICAL ✅
tree-worker:    IDENTICAL ✅
```

---

## 风险 / 注意点

| 项目 | 风险 | 等级 | 缓解 |
|------|------|------|------|
| P1-C final_step | worker 仍可能忽略（brief 模板新增字段，同"教化"模式） | 🟢 低 | 三处同步强化（brief 模板 + 铁律 + lifecycle 衔接），比单点 advisory 强得多 |
| P1-C 铁律 #10 | 无引擎硬拦（E_BORROWED_IDENTITY 只在代调时触发，不能在 worker "等通知"时拦） | 🟡 中 | worker 卡住时会上行 blocked（§2.5 原有逻辑），commander 收到 blocked 应意识到是 set-status caller 问题 |
| P1-A 硬要求 | 同 v2.9 advisory——"教化"升级为"硬要求"后 commander 仍可能漏记 | 🟡 中 | 与 #15 禁止行为联动，心跳巡检可通过 communication_log 发现漏记（缺失的 send_message 无对应 log），但需下一轮 macp 验证 |
| P0-A 建 auditor | commander 可能跳过步骤 C（不背书 auditor），导致 auditor 卡在闸门3 | 🟡 中 | §13.4.0 关键认知段已说明 V10 约束和闸门2 打破方式；若下轮 macp 仍出现此问题，可考虑引擎 buildInitTips 加 auditor 委派指引（engine-evaluation §2.5） |
| tree-worker v2.5→v2.6 | 版本号与 tree-worker §11 修订历史中的旧 v2.6 (nanju05) 冲突 | ✅ 已修复 | 旧 v2.6 条目（2026-07-16 nanju05）更正为 v2.5.1——该条目写入时 §0 实际为 v2.5，是修订历史标签不一致的遗留 bug。修复后新旧条目版本号不冲突：v2.5.1 (nanju05) → v2.6 (macp2 P1-C) |
| §13.4.0 四步流程清晰度 | 流程较长（~28 行），commander 首次阅读可能跳过 | 🟢 低 | 四步编号（A/B/C/D）+ 代码块格式清晰，关键认知段总结核心要点 |

---

## 改动统计

| 文件 | 新增行 | 修改行 | 删除行 | 净增 |
|------|--------|--------|--------|------|
| tree-commander/SKILL.md | +35 | ~3 | ~4 | ~+31 |
| tree-worker/SKILL.md | +6 | 0 | 0 | +6 |
| **合计** | **+41** | **~3** | **~4** | **~+37** |

---

*实施完成: 2026-07-25 16:45 GMT+8*
*实施方: Proma Agent (Pi SDK) · tree-commander v2.9.2 + tree-worker v2.6*
