# 天道鞭策消息模板

> 版本: v0.1-TAO | 用于: Pulse 子系统（stall 检测 → 推动继续）

---

## 三级鞭策格式

### 级别 1：温和提醒（nudge_count=1）

```
[天道鞭策 #1]
目标: {leaf_id} (role={role})
触发规则: {rule_id} {规则描述}
上次活跃: {时间} (距今 {N} 秒)
当前状态: {status}, milestones: {完成数}/{总数}

下一步要求: {具体指令}

已记录鞭策事件到 tree-state nudge_log。
回复 "done" 或 "blocked" 或继续执行。
3 次鞭策无响应将标记为 E_STALL_TIMEOUT。
```

### 级别 2：警告（nudge_count=2）

```
[天道警告 #2]
目标: {leaf_id} (role={role})
触发规则: {rule_id} {规则描述}
上次活跃: {时间} (距今 {N} 秒)
当前状态: {status}, milestones: {完成数}/{总数}
已鞭策次数: 2 / 3

严重程度: mid
这是最后一次温和提醒。下一次将升级为最终通知 + E_STALL_TIMEOUT。

下一步要求: {具体指令}

请立即响应：
- 如继续执行：回复 "continue" 并在 60 秒内有产出
- 如卡住：回复 "blocked" 并说明 blocker
- 如已完成：回复 "done" 并附 self_check
```

### 级别 3：最终通知（nudge_count=3）

```
[天道最终通知 #3]
目标: {leaf_id} (role={role})
触发规则: {rule_id} {规则描述}
上次活跃: {时间} (距今 {N} 秒)
当前状态: {status}, milestones: {完成数}/{总数}
已鞭策次数: 3 / 3

严重程度: high
E_STALL_TIMEOUT 已标记。

下一步: 已向父 Commander 上报 stall_timeout。
- Worker stall → 通知父 Commander 介入
- Commander stall → 通知祖父 Commander → ... → 最终到达 Root
- Root stall → 通知用户（send_message 到根会话）

如需恢复:
1. 父 Commander 通过 nudge reset 重置计数
2. 重新下发任务或派新 Agent
```

## Stall 判定矩阵

| 条件 | 判定 | 触发动作 |
|------|------|---------|
| leaf status=active 且最后 assistant 消息 > 90 秒前 | stall | nudge_count++ |
| leaf status=active 且 milestones 全部 done 但 status 未 done | 遗忘 done | nudge: 要求 set-status done |
| leaf status=active 且无任何 milestone | 违规 | nudge: 要求 milestone add |
| leaf 有 blocked 消息但 > 120 秒无后续 | 需介入 | nudge: 通知父 Commander |
| Commander 子节点全部 done 但自身未 done | 遗忘整合 | nudge: 要求整合 + set-status done |
| Root status=active 且最后消息 > 120 秒前 | Root stall | nudge: 直接通知用户 |

## 升级路径

```
鞭策 1 (severity=low)  → 温和提醒
鞭策 2 (severity=mid)  → 警告 + 倒计时
鞭策 3 (severity=high) → 最终通知 + E_STALL_TIMEOUT
                         ↓
                    向上冒泡到父 Commander
                         ↓
                    父 Commander 接管或重派
```

## 发送策略

使用 `send_message(target, nudge_msg, wait=true)` **顺序发送**，避免 I3 已知竞态（并发 wait=false 丢消息）。

多 leaf 同时需鞭策时，串行发送（每个阻塞 ~5-10 秒）。90 秒 stall 阈值远大于鞭策耗时，不影响总体延迟。

## 性能预算

- 单轮最多鞭策 5 个 leaf
- 超出排队到下一轮
- nudge_count >= 3 后不再鞭策，转 escalation
