# v0.1 重测报告（S1 简单二叉树）

> **执行时间**: 2026-06-19 16:05-16:08 (GMT+8)
> **执行者**: Proma Agent (Release 实例, session `b01c8a3f-cb8c-4c06-ada4-d2a89672a3e4`)
> **测试方案**: s1-test-plan.md v1.0
> **总耗时**: ~3 分钟
> **结论**: **全部通过**

---

## 命令执行统计

- 总命令数: 25 (基础)
- 成功: 25
- 失败: 0
- 跳过: 0

## 7 项验证维度核对

| # | 验证项 | 结果 | 证据 |
|---|--------|------|------|
| 4.1 | 契约下发完整记录 | ✅ | `root_brief` 含 parent_intent/my_mission/why_this_exists/in_scope/out_of_scope; `root_dod` 含 deliverables/quality_gates/self_check; 每个 leaf brief_echo 复述了对应子任务要素 |
| 4.2 | 事件路由正确 append | ✅ | `event list` 返回 6 条 (3 leaf × 2 events)，leaf_id 正确，type 分别为 brief_echo/done |
| 4.3 | milestones 按预期推进 | ✅ | 3 leaf 各含 M1/M2，全部 status=done, audit_pass=true, note_path 已设 |
| 4.4 | F 启动时机在 A/B done 后 | ✅ | F created_at (16:07:05) > A last_event_ts (16:06:38) > B last_event_ts (16:06:59) |
| 4.5 | 最终 validate 通过 | ✅ | `{"ok":true,"issues":[]}` |
| 4.6 | drift_log 为空 | ✅ | `drift list` → `{"ok":true,"drifts":[]}` |
| 4.7 | _meta.write_count = 25 | ✅ | dump 确认 write_count=25 |

## 自动备份验证 (§5)

- write_count=10 (A set-status done) → `tree-state.backup.1781856402167.auto.json` ✅
- write_count=20 (F add M1) → `tree-state.backup.1781856432384.auto.json` ✅
- M1 修复 (每 10 次写触发 auto backup) 回归通过

## M2 严格校验验证

- A set-status done 时 milestones 非空 + 全部 audit_pass=true → 放行 ✅
- B set-status done 时同条件 → 放行 ✅
- F set-status done 时同条件 → 放行 ✅
- M2 修复 (空 milestone 拒绝 done) 未触发 (happy path)，严格校验路径正常

## 关键字段最终状态

| 字段 | 预期 | 实际 | 匹配 |
|------|------|------|------|
| version | "1.0" | "1.0" | ✅ |
| tree_id | "pguide" | "pguide" | ✅ |
| Object.keys(leaves).length | 3 | 3 | ✅ |
| A/B/F status | all "done" | all "done" | ✅ |
| 每个 leaf events.length | 2 | 2 | ✅ |
| 每个 leaf milestones.length | 2 | 2 | ✅ |
| 所有 milestones audit_pass | true | true | ✅ |
| 所有 milestones status | "done" | "done" | ✅ |
| heartbeat_log | [] | [] | ✅ |
| drift_log | [] | [] | ✅ |
| _meta.write_count | 25 | 25 | ✅ |

## 已知风险或意外发现

无。全部 25 步一次通过，无重试、无错误、无跳过。

## 清理

- [x] 已删除 pguide/ 目录
- [x] 未影响其他 tree 目录或 tree-state.js

---

## 修订历史

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-06-19 | v1.0 | v0.1 S1 重测，全 25 步通过。Release 实例接替指挥官执行。 |
