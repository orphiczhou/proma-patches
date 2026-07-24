# P1-1: Worker progress 实时反映（brief_echo 自动转 active + progress event）

> 日期：2026-07-24 | 接力第三棒

## 1. 问题根因

macp 实战（tests/002）暴露：worker 完成 brief_echo（复述理解）甚至 done 报告后，tree_dump 显示 leaf.status 仍是 `pending_brief`——状态滞后。

**根因（双因）**：

1. **brief_echo 不触发状态转换**：worker 初始 status=`pending_brief`（cmdLeafAdd L1190）。写首条 brief_echo 后，引擎只清 `alignment_pending`（L2389），**不改 status**。导致 worker 已回应 brief、已开始履职，但 tree 仍显示"待 brief"——commander 心跳巡检看到 pending_brief 会误判"worker 还没动"，发出冗余 status_check。

2. **缺中间进度上报机制**：worker 干活过程中（可能数十分钟）没有轻量的事件可记。done 是终点、blocked 是异常、plan 是拆解——都不是"进度汇报"。worker 只能通过 send_message 私下向 commander 汇报，tree 看不到（P1-2 要解决的问题）。

## 2. 改动点

### 2.1 引擎（核心）：brief_echo 自动转 active

**位置**：`cmdEventAppend` 函数（L2337+），在 `leaf.last_event_ts = ts`（L2655）之后加。

**逻辑**：
```js
// P1-1: brief_echo 自动转 active —— worker 写首条 brief_echo 时
//   status: pending_brief → active。解决状态滞后。
if (opts.type === 'brief_echo' && leaf.role === 'worker' && leaf.status === 'pending_brief') {
  leaf.status = 'active';
}
```

**三条件**：
- `opts.type === 'brief_echo'`：只在 brief_echo 事件触发（done/blocked/plan 等不动）。
- `leaf.role === 'worker'`：commander/auditor 初始即 active，不需要转。
- `leaf.status === 'pending_brief'`：只在待 brief 状态触发；已 active/done 时幂等不动。

**效果**：worker 写首条 brief_echo（复述理解）后，status 自动 `pending_brief → active`，反映"worker 已收到 brief 并开始履职"。commander 回填 alignment（第二条 brief_echo）时 status 已 active，幂等不动。

**安全性**：
- 幂等：只在 `pending_brief` 时转，重复 brief_echo 不反复改。
- 不影响 done 路径：`set-status done` 检查的是 milestones/audit_gate/deliverables，不依赖 status=active。
- 不影响 audit_gate：brief_echo alignment 校验（L2376）照常，alignment_pending 处理（L2389）照常。

### 2.2 引擎（增强）：新增 `progress` event type

**位置**：`EVENT_TYPE_ENUM`（L79）末尾加 `'progress'`。

**语义**：worker 主动上报中间进度，不触发状态转换。建议 meta：
```yaml
meta:
  step: "<当前步骤描述>"          # 必填，非空字符串
  outputs_so_far: ["<已产出文件>"]  # 可选
  eta: "<预计剩余时间>"            # 可选
  percent: <0-100>               # 可选
```

**轻量设计**：引擎只加枚举（让 progress event 合法可 append），**不加强制 schema 校验**（避免过度约束；agent 滥用由 commander 巡检发现，不是引擎职责）。

### 2.3 文档：tree-commander SKILL.md

1. **§6 事件路由表加 progress 行**：
   | 事件 | 触发 | 指挥官动作 | 工具 |
   | progress | worker 主动报进度 | ① 登记事件 ② 更新 context_usage（如 meta.percent 提供）③ 正常仅记录 | tree_event_append(type=progress) |

2. **§6 补 brief_echo 状态联动说明**：worker 首条 brief_echo 后 status 自动 active（v2.8 引擎行为）。

3. **§5 工具速查 + §11**：EVENT_TYPE 数量从 10 → 11（加 progress）。

4. **§15 修订历史加 v2.8**。

## 3. 测试计划

### 3.1 引擎单测（test-p11.cjs）

**用例 A（核心：brief_echo 转active）**：
1. init + leaf_add worker → status=pending_brief
2. worker 写 brief_echo（meta={my_understanding,milestones_preview}）
3. **断言**：worker.status === 'active'

**用例 B（commander brief_echo 不受影响）**：
1. init + leaf_add commander → status=active
2. commander 写 brief_echo
3. **断言**：commander.status 仍 'active'（本来就 active）

**用例 C（幂等：第二条 brief_echo 不改）**：
1. 用例 A 后，再写一条 brief_echo（alignment 回填）
2. **断言**：status 仍 'active'（不反复改）

**用例 D（progress event 能 append）**：
1. init + leaf_add worker + brief_echo（转 active）
2. worker 写 progress（meta={step:'coding',percent:50}）
3. **断言**：event append 成功，leaf.events 含 progress

**用例 E（done event 不自动转 done）**：
1. worker 写 done event（self_check 合法）
2. **断言**：status 仍 'active'（不是 done；done 由 set-status 唯一入口）

### 3.2 回归测试

- P0-1（17/17）+ P1-3（16/16）复跑零回归。
- 现有 brief_echo alignment 校验路径无破坏。
- node --check 通过。

## 4. 验收标准

- [ ] 用例 A-E 全部符合预期
- [ ] EVENT_TYPE_ENUM 含 progress
- [ ] SKILL §6 / §5 / §15 v2.8 已更新
- [ ] node --check 通过
- [ ] P0-1 + P1-3 单测零回归
- [ ] 独立审计 verdict=pass
