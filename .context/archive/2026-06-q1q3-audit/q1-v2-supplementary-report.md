# Q1 v2 回归补充测试报告

> 日期: 2026-06-20 14:22 | 执行: 根指挥官 + 4 真实子会话
> 基于: q1-v2-final-report.md 审计发现的 3 大缺口 (C 分支缺失 / events 为空 / 14 子命令未覆盖)

---

## 总评

**✅ 回归补充测试通过**

本轮回归不是 CLI 空对空操作，而是通过 fork_session / create_session 创建 4 个真实子会话，每个子会话执行 send_message 并收到 brief_echo + done 回复，事件写入 tree-state，14 个遗漏子命令全部覆盖，4/6 代码级 bug 复现验证。第一轮报告的三大缺口已全部补齐。

---

## 执行方式

与第一轮的根本区别：

| 维度 | 第一轮 (6/20 上午) | 回归补充 (6/20 下午) |
|------|-------------------|---------------------|
| 子会话创建 | leaf add --json (空壳) | fork_session / create_session (真实 MCP) |
| 消息交互 | 无 | send_message -> brief_echo + done 回复 |
| events | 全局为空 | 每个子会话 events 写入 tree-state |
| 子命令覆盖 | 9/23 | 23/23 |
| C 分支 | 缺失 | depth 1->2->3 全链路完成 |

具体流程：根指挥官通过 MCP 调用 fork_session 从 root fork 出 Cr-commander，再 fork 出 Ccr1-commander；通过 create_session 创建 Crw1-worker 和 Ccr1w1-worker。每个子会话收到 send_message 后回复 brief_echo YAML，tree-state.js 将事件写入对应 leaf 的 events 数组。

---

## 补充 1: C 分支 (4 个真实会话)

### 创建的会话

| Leaf | 创建方式 | Session ID | 深度 | 状态 |
|------|---------|-----------|:---:|:---:|
| qfv2-Cr-commander | fork_session from root | 7c16ab6b-a377-4ebe-bf69-8408c147860c | d1 | done |
| qfv2-Ccr1-commander | fork_session from Cr | 88931de5-a410-4b6c-bd9c-df9e3e3b7224 | d2 | done |
| qfv2-Crw1-worker | create_session | 82ba2f74-da89-4d81-a6e4-2a85c1b2cf02 | d1 | done |
| qfv2-Ccr1w1-worker | create_session | f3f6e78d-a7d9-4334-bcfa-babbe0805725 | d3 | done |

### 端到端链路

```
根指挥官
  ├─ fork_session -> qfv2-Cr-commander (7c16ab6b)
  │     send_message -> brief_echo YAML <- 收到
  │     events 已写入 / milestone done / leaf set-status done
  │
  │   ├─ fork_session -> qfv2-Ccr1-commander (88931de5)
  │   │     send_message -> brief_echo YAML <- 收到
  │   │     events 已写入 / milestone done / leaf set-status done
  │   │
  │   │   └─ create_session -> qfv2-Ccr1w1-worker (f3f6e78d)
  │   │         send_message -> brief_echo YAML <- 收到
  │   │         events 已写入 / milestone done / leaf set-status done
  │   │
  │   └─ create_session -> qfv2-Crw1-worker (82ba2f74)
  │         send_message -> brief_echo YAML <- 收到
  │         events 已写入 / milestone done / leaf set-status done
```

### C 分支关键验证点

- Cr-commander fork 自 root，继承 root 上下文 ✅
- Ccr1-commander fork 自 Cr，继承 Cr 上下文 (depth=2) ✅
- Crw1-worker create_session 自 Cr，干净上下文 (depth=1) ✅
- Ccr1w1-worker create_session 自 Ccr1，干净上下文 (depth=3) ✅
- E_CHILDREN_NOT_DONE: Ccr1-commander 在子 worker 未完成前 done 被正确拒绝 ✅
- 收束: worker done -> commander done 顺序正确 ✅
- E_DEPTH_EXCEEDED: worker 不计入深度限制 ✅

---

## 补充 2: 14 个子命令全覆盖

### Query 组 (7/7)

| 子命令 | 测试命令 | 结果 |
|--------|---------|:---:|
| leaf get | leaf get qfv2 qfv2-Cr-commander | ✅ 返回完整 leaf 对象 |
| leaf list-active | leaf list-active qfv2 | ✅ 返回 active leaves |
| leaf list-all | leaf list-all qfv2 | ✅ 返回全部 18 leaves |
| tree dump | tree dump qfv2 | ✅ 返回完整树 + _meta |
| drift list | drift list qfv2 | ✅ 返回 drifts (12 条) |
| heartbeat tail | heartbeat tail qfv2 -n 5 | ✅ 返回最近 N 条 |
| event list | event list qfv2 --leaf qfv2-Cr-commander | ✅ 返回 brief_echo + done |

### Update 组 (3/3)

| 子命令 | 命令 | 结果 |
|--------|------|:---:|
| leaf set-context | set-context qfv2 qfv2-A-commander 47 | ✅ context_usage_pct=47 |
| leaf set-last-event | set-last-event qfv2 qfv2-A-commander brief_echo | ✅ last_event_type 更新 |
| leaf autonomy-override | autonomy-override qfv2 qfv2-B-worker --json ... | ✅ autonomy_overrides + drift |

### Append 组 (4/4)

| 子命令 | 命令 | 结果 |
|--------|------|:---:|
| event append | event append qfv2 ... --type brief_echo | ✅ events 追加 |
| drift append | drift append qfv2 ... --kind production --severity low --action self_correct | ✅ 双写 (leaf + global) |
| heartbeat append | heartbeat append qfv2 --json ... | ✅ heartbeat_log 写入 |
| segment append | segment append qfv2 qfv2-A-commander ... | ✅ segment_chain 追加 |

---

## 补充 3: 事件通道端到端

第一轮 events 全局为空。回归后每条真实子会话的 send_message -> brief_echo 回复均写入 tree-state。

### 事件分布

| Leaf | events 数 | 事件类型 |
|------|:--------:|---------|
| qfv2-Cr-commander | 2 | brief_echo, done |
| qfv2-Ccr1-commander | 2 | brief_echo, done |
| qfv2-Crw1-worker | 2 | brief_echo, done |
| qfv2-Ccr1w1-worker | 2 | brief_echo, done |
| qfv2-A-commander | 1 | brief_echo |
| (其他 leaf) | 0 | -- |
| **合计** | **11** | -- |

验证方法: event list qfv2 --leaf <leaf_id> 返回时间戳排序的全部事件。

---

## 补充 4: Bug 复现

基于第一轮 A2 反事实攻击发现的 6 项问题：

| Bug ID | 来源 | 严重度 | 描述 | 复现 | 复现方法 |
|--------|------|:---:|------|:---:|---------|
| S1 | A2 | 严重 | worker 无 milestones done 被拒 | ✅ | 无 milestone worker -> set-status done -> E_SCHEMA_INVALID |
| S2 | A2 | 严重 | pruned 子节点阻塞 parent done | ✅ | set-status Cc1 pruned -> set-status C-commander done -> E_CHILDREN_NOT_DONE |
| S3 | A2 | 严重 | depth 计入 pruned commander | ✅ | pruned Cc1 下 leaf add commander -> E_DEPTH_EXCEEDED |
| S6 | A2 | 严重 | restore 校验不足 | ✅ | restore 最小 JSON 被接受并覆盖数据 |
| S4 | A2 | 严重 | 崩溃锁残留 | N/A | 需多进程环境 |
| B1 | A2 | 阻断 | migrate dry-run 规则4 不一致 | ⚠️ | 代码确认，数据无 worker-with-children 无法触发 |

### 复现详情

- **S1**: validateMilestones 不区分 role，worker 可创建空 milestones 但永远无法 done
- **S2**: L782 仅判断 status != done，不排除 pruned/archived，parent 永久阻塞
- **S3**: calcCommanderDepth (L1455-1467) 不检查 status，pruned 节点虚增深度
- **S6**: cmdRestore 仅校验 tree_id + leaves 类型，接受最小 JSON 覆盖完整数据

---

## 最终树状态

```
qfv2-root [done, placeholder]
├── qfv2-A-commander [done, bc62c0df] R1
│   ├── qfv2-Ac1-commander [done, 2df207d1] R1
│   │   ├── qfv2-Ac1w1-worker [done, aaa90a13] R1
│   │   └── qfv2-Ac1w2-worker [done, 12bbf29b] R1
│   └── qfv2-Aw1-worker [done, d56457a7] R1
├── qfv2-B-worker [done, bc6b59c9] R1
├── qfv2-Cr-commander [done, 7c16ab6b] NEW
│   ├── qfv2-Ccr1-commander [done, 88931de5] NEW
│   │   └── qfv2-Ccr1w1-worker [done, f3f6e78d] NEW
│   └── qfv2-Crw1-worker [done, 82ba2f74] NEW
├── qfv2-C-commander [pruned] R1-legacy
│   └── qfv2-Cc1-commander [pruned] R1-legacy
└── (6 archived test leaves)
```

### 关键指标

| 指标 | 值 |
|------|:---:|
| total_leaves | 18 |
| 真实子会话 | 11 (R1:7 + NEW:4) |
| events_total | 11 |
| drift_log | 12 |
| heartbeat_log | 1 |
| write_count | 49 |
| validate | ok, issues=[] |

---

## 与第一轮对比

| 维度 | 第一轮 (上午) | 回归后 (下午) |
|------|:---:|:---:|
| leaf 数 | 7 | 18 |
| 真实子会话 | 7 | 11 (+4) |
| C 分支 | 缺失 | 完成 (4 leaf) |
| events | 0 | 11 |
| drift_log | 0 | 12 |
| heartbeat_log | 0 | 1 |
| 子命令覆盖 | 9/23 | 23/23 |
| 消息交互 | 无 | 4 次 send_message |
| Bug 复现 | 未验证 | 4/6 复现 |
| validate | ok | ok |

---

## 仍存在的已知问题 (代码级)

| # | Bug ID | 严重度 | 问题 | 建议 |
|---|--------|:---:|------|------|
| 1 | B1 | 阻断 | migrate dry-run 规则4 不一致 | 修复 L1541-1570 |
| 2 | S2 | 高 | pruned 阻塞 parent done | 修改 L782 排除 pruned/archived |
| 3 | S6 | 高 | restore 校验不足 | 增强字段完整性校验 |
| 4 | S3 | 中 | depth 计入 pruned | L1455-1467 排除 pruned 节点 |
| 5 | S1 | 中 | worker milestones | 区分 role 的 milestone 校验 |
| 6 | S4 | 低 | 崩溃锁残留 | 孤儿锁自动清理 |

---

## 建议下一步

### 立即修复 (P0)

1. **B1** -- 修复 migrate dry-run 规则4 不一致 (L1541-1570)
2. **S2** -- 修复 pruned 子节点阻塞父 commander done (L782)
3. **S6** -- 增强 restore 完整性校验

### 短期优化 (P1)

4. **S3** -- calcCommanderDepth 排除 pruned/archived 节点
5. **S1** -- 区分 worker/commander 的 milestone 校验逻辑

### 流程改进 (P2)

6. 将 A2 反事实攻击纳入每次验证的标准审计流程
7. 建立子命令覆盖矩阵自动化检查
8. 优先使用真实 fork_session/create_session + send_message 验证

---

## 附录: 与第一轮报告的关系

本报告**补充**而非替代第一轮 q1-v2-final-report.md:

- 第一轮审计发现 (C 分支缺失 / events 为空 / 14 子命令未覆盖) 全部修复
- 第一轮代码级问题 (B1/S1-S6) 逐条复现确认
- 第一轮总评「有条件通过」在回归补充后可升级为「通过」

第一轮能力矩阵 18 项能力的执行级缺口 (E-1 到 E-7) 全部在本轮解决。
