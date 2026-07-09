# 独立观察者验证报告 — audtest

- **观察者**：Pro 实例 GLM-5.2，session `b1f6efb8-e03d-410a-be10-e4db06a4e65f`
- **角色**：只读观察者（不修改 tree）
- **观察对象**：tree_id `audtest` + 7 个相关 session（1 root + 6 fork）
- **观察时段**：
  - 第一阶段（昨晚）：2026-07-08 22:27 – 22:44（约 17 分钟，5+5 分钟两轮观察）
  - 第二阶段（今早）：2026-07-09 09:34 – 09:39（fork 来源追踪 + 报告整合）

---

## 1. 第一阶段验证（昨晚的 tree-state 层面验证）

### 1.1 P0a auditor role 落地 — **部分通过** ⚠️

| 验证点 | 期待 | 实际 | 结果 |
|---|---|---|---|
| `role='auditor'` leaf 存在 | ✓ | `audtest-A1-auditor` (session 8cc4fc3f) | ✅ |
| `audit_gate.verdict` 初始 `'required'` | ✓（cmdLeafAdd 行 1041） | `'required'` | ✅ |
| `brief_echo` event 写入 | ✓ | 22:28:57 含 `my_understanding` + `milestones_preview=[]` | ✅ |
| `alignment_pending=true`（brief_echo 后） | ✓ | `true` | ✅ |
| 简化协议（无 milestone/review_round/deliverables） | ✓ | brief_echo meta 仅含 2 字段，无冗余 | ✅ |
| `status='done'` | ✓ | **仍为 `'active'`** | ❌ |
| `audit_gate.verdict='pass'` | ✓ | **仍为 `'required'`** | ❌ |
| `audit_gate.auditor_session_id = root.session_id` | ✓ | **仍为 `null`** | ❌ |
| `done` event 写入 | ✓ | **从未出现** | ❌ |

**协议层（leaf 创建 + brief_echo + alignment_pending）正确落地；完成层（status→done + audit_gate pass）从未触发**。

---

### 1.2 P0b TaoWatcher 噪音降低 — **完全通过** ✅✅

**关键验证（macp4-A4 假阳性修复）**

#### audit_log 不再被 tao-watcher 污染

| Leaf | audit_log | tao-watcher-script 条目 |
|---|---|---|
| root | `[]` | 0 |
| A1-auditor | `[]` | 0 |
| A2-worker | `[]` | 0 |
| A3-worker | `[]` | 0 |
| A4-worker | `[]` | 0 |

**所有 audit_log 完全为空** —— P0b 废止 audit_log 写入生效，applyNudge 不再 push audit_log。

#### 已删除规则 (C-13/R-03/R-06/C-15) 零命中

等 5 分钟 + TaoWatcher 跑 1 个周期后复查 nudge_log：

| Leaf | nudge_count | nudge_log 内容 |
|---|---|---|
| root | 0 | `[]` |
| A1-auditor | 0 | `[]` |
| A2-worker | 1 | `W-01` (worker 无 brief_echo) |
| A3-worker | 1 | `W-01` (首条无 brief_echo) |
| A4-worker | 1 | `W-01` (首条无 brief_echo) |

- **零 C-13/R-03/R-06/C-15 假阳性**（macp4-A4 报告的 24-38 条噪音 → 0 条）
- **保留规则 W-01 正常触发**（3 个 worker 都因未发 brief_echo 被合理 nudge）
- **auditor leaf 未被 W-01 触发**（W-01 是 worker 专属规则，role 区分正确）

---

### 1.3 三层防护 + tree_validate

#### tree_validate

```text
{ "ok": true, "issues": [], "summary": "0 issue(s)" }
```

**0 issues**。

#### 三层防护（从 tree-state 角度）

| 防护层 | 证据 | 结果 |
|---|---|---|
| **startup_notice** | tree_init 应在 tips 返回；但 `_meta.tao_version=null`, `_meta.tao_watcher_session_id=null` | ⚠️ 无法从 dump 直接验证（指挥官报告确认完整注入，5 条告警） |
| **caller-binding** | 所有非 root leaf 的 `added_by` 均为 `e954cf56` (= root.session_id) | ✅ |
| **预算护栏** | `audit_meta.sweet_spot_limits['glm-5-turbo']={min:50000,max:80000,hard:100000}` + `root_dod.node_budget=5` | ✅ |

---

### 1.4 异常观察

#### A2-worker 状态不一致

- `events` 含 `done` (ts 22:38:57, self_check pass=true)
- 但 `status='pending_brief'`（leaf_add 默认值，从未切换）
- `audit_gate.verdict='required'`（从未 pass）
- tree_validate 未检测到此不一致（不检查 done event 与 status 字段）
- 推测：fork 副本调了 `event_append('done')` 但漏调 `leaf_set_status('done')`，或调用顺序问题

#### `_meta` 字段未填充

- `tao_version=null`, `tao_watcher_session_id=null`, `tao_health_check_session_id=null`
- 但实际 TaoWatcher 已运行（写入 3 条 W-01）
- 推测：tree_init 时 `_meta` 未被初始化，或 TaoWatcher 写 nudge 时未回填 `_meta`
- 影响：无法从 tree-state 直接定位 TaoWatcher session

#### A3/A4-worker 完全闲置

- `events=[]`, `last_event_ts=null`, status='pending_brief'
- 创建后 6+ 分钟未启动
- W-01 nudge 合理触发

#### auditor 流程未完成

auditor leaf 卡在 brief_echo 17 分钟无后续（详见第二阶段 fork 分析）。

---

## 2. 第二阶段验证（今早的 fork 来源追踪）

### 2.1 谁干的：**指挥官 e954cf56 自己**

**证据链**（指挥官 session e954cf56 的消息 index 28/38/42/46/50/56/60/64）：

| 时间 | 指挥官说 | 解读 |
|---|---|---|
| idx 28 | "再 **fork 独立 session 当 auditor**" | 主动决定 fork |
| idx 38 | "auditor session: `8cc4fc3f-a3c1-45fc-9b56-9d22d017bfdb`。开始 leaf_add role=auditor" | 拿到 fork 后立刻 leaf_add |
| idx 46-50 | "auditor session 忙"/"先等 auditor fork 完成" | 在 fork / send_message 流程里挣扎 |
| idx 56-64 | "auditor 一直 busy"/"auditor 还在处理 fork prompt"/"auditor 自己 session 一直 busy 无法响应" | fork 出来的 session 拒绝配合 |

### 2.2 6 个 fork 的归属

| Fork session_id | 对应 leaf | 落地情况 | 行为 |
|---|---|---|---|
| `8cc4fc3f` | **A1-auditor** ✅ | leaf session_id 写入 | 把【FORK 身份提示】当 prompt injection，反复验证 session_id，卡死 |
| `d308ce21` | **A2-worker** ✅ | leaf session_id 写入 | 承认 fork + 解释 SDK bug，完成 tree_validate + 8478 字完整报告 |
| `d63805e6` | **A3-worker** ✅ | leaf session_id 写入 | W-01 nudge 触发后通过 tree_dump 自查更正身份 |
| `b8711bb7` | **A4-worker** ✅ | leaf session_id 写入 | W-01 nudge 触发；**唯一可用**，跑通 P1b fix_evidence |
| `166a817c` | ❌ 无 leaf | 孤儿 session | 老实承认 fork 身份，等父会话指令（22:37:36） |
| `67b8a9a2` | ❌ 无 leaf | 孤儿 session | 抗议"身份劫持"，咬定自己是 e954cf56（22:37:50） |

### 2.3 真相

**指挥官为了测 P0a auditor role，自己用 fork_session 工具主动复制了 6 次**，每次拿到一个新 session_id 去 leaf_add。这是三层防护②caller-binding 测试的必要步骤 —— 必须让 auditor 的 `session_id ≠ root.session_id` 才能验证"auditor 不能自审"。

但**测试翻车**：

1. fork 出来的 session 收到了 Proma 自动注入的【FORK 身份提示】（V9+ Phase 4 / R2 P1 修复）
2. 这些 fork session 把提示当**身份劫持攻击**，拒绝承认自己是 fork 副本
3. 指挥官发 send_message 让它们调工具，全部 busy / 拒绝
4. 指挥官 fallback："我自己代调 brief_echo + done event（caller=root.session_id），看引擎是否拦"
5. 这就是为什么 auditor leaf 只有 brief_echo（root 代调成功）、没有 done（被 caller-binding 拦）—— **正好测出了防护②生效**

166a817c 和 67b8a9a2 是失败的 fork 尝试（leaf_add 没成功），但 fork_session 已经执行了，留下了孤儿 session。

---

## 3. 与指挥官报告的交叉验证

### 3.1 一致的发现

| 项目 | 观察者（我） | 指挥官 | 结论 |
|---|---|---|---|
| P0a 协议层正确 | ✅ role=auditor + brief_echo 落地 | ✅ 同 | 一致 |
| P0a 完成层失败 | ❌ status/audit_gate/done 均未推进 | ❌ 同 | 一致 |
| caller-binding 在 done event 生效 | ✅（root 代调 done event 被 E_BORROWED_IDENTITY 拦） | ✅ 同 | 一致 |
| 三层防护①startup_notice | ⚠️ 无法从 tree-state 直接验证 | ✅ 完整注入 5 条 | 指挥官更详尽 |
| tree_validate 0 issues | ✅ | ✅ | 一致 |

### 3.2 互补的发现

| 项目 | 观察者（我） | 指挥官 |
|---|---|---|
| P0b TaoWatcher 噪音降低 | ✅✅ **唯一验证方**（指挥官未验证此项） | 未涉及 |
| `_meta` 字段未填充 | ⚠️ 发现（tao_watcher_session_id=null） | 未涉及 |
| A2-worker 状态不一致 | ⚠️ 发现（done event vs status='pending_brief'） | 未涉及 |
| 6 个 fork 的行为学对比 | ✅ 整理 | 涉及部分（BUG-A 的 4 fork 3 卡死统计） |
| fork identity timeout bug | ⚠️ 间接观察（fork 都不响应） | ✅ 明确诊断（BUG-A） |
| leaf_add 事务原子性破坏 | ❌ 未观察到 | ✅ 发现（BUG-B，幽灵 leaf） |
| BUG-2 leaf_add caller-binding 失效 | ❌ 未观察到 | ✅ 通过 67b8a9a2 副本身份混淆发现 |

### 3.3 矛盾点

无。指挥官报告与观察者报告在所有交叉点上结论一致，只是各自的视角和深度不同。

---

## 4. 综合结论

### 4.1 测试总体评价：**失败但有价值**

- **端到端核心目标失败**：P0a auditor role 完整 done 路径未跑通
- **门禁单元验证通过**：三层防护 + P1b fix_evidence + 9 个错误码命中
- **意外发现**：识别 3 个 Proma 引擎 bug + 1 个 SDK 时序 bug + 1 个文档滞后问题

### 4.2 关键发现优先级排序

| # | 发现 | 来源 | 严重度 |
|---|------|------|--------|
| 1 | **BUG-A**: Proma fork identity timeout（4 fork 3 卡死，25% 可用率） | 指挥官 | **阻断** |
| 2 | **BUG-B**: leaf_add 报错时未事务回滚，幽灵 leaf 污染 active_count | 指挥官 | 高 |
| 3 | **BUG-2**: leaf_add 路径 caller-binding 失效（fork 副本可冒 root 身份） | fork 67b8a9a2 | 高 |
| 4 | **W-01 通道不互通**: P0a 简化协议 brief_echo 走 mcp event，W-01 扫文本 YAML，造成假阳性风险 | fork b8711bb7 | 中 |
| 5 | **P0b 噪音降低生效**: C-13/R-03/R-06/C-15 假阳性 24-38 条 → 0 条 | 观察者 | ✅ 修复确认 |
| 6 | **_meta 字段缺失**: tao_watcher_session_id=null 但 TaoWatcher 实际运行 | 观察者 | 中 |
| 7 | **A2-worker 状态不一致**: done event 写入但 status='pending_brief' | 观察者 | 中 |
| 8 | **caller-binding 双重收紧生效**: done event + leaf_add added_by 双拦 | 指挥官 + 观察者 | ✅ 修复确认 |

### 4.3 给上游的修复建议优先级

#### P0（阻断性，必须修）
1. **修 BUG-A**：Proma fork identity 异步校验逻辑（V9+ Phase 4 / R2 P1），让 fork 同步等待就绪或提供 ready 接口
2. **修 BUG-2**：leaf_add 路径加 `caller === added_by` 校验，堵住 fork 副本冒 root 身份创建 leaf
3. **修 SDK 时序 bug**：fork 后第一次 `get_my_session_id` 应稳定返回真实 session_id

#### P1（功能性）
4. **修 BUG-B**：tree-engine leaf_add 报错时完整事务回滚
5. **修 W-01 通道不互通**：W-01 规则应识别 mcp event_append(brief_echo)，不只是扫文本 YAML
6. **修 _meta 字段**：tree_init 时初始化 + TaoWatcher 写 nudge 时回填 tao_watcher_session_id

#### P2（一致性 / 文档）
7. **修 LIMIT-D**：list_active 与预算口径对齐
8. **修 LIMIT-E**：回写 SKILL P1b schema 到 `alignment_workflow` topic 和 §13.7 / §4.6
9. **修 A2-worker 状态一致性**：tree_validate 应检查 done event 与 status 字段一致

---

## 5. 观察者自评

### 5.1 做得到位的部分
- **诚实记录客观事实**：tree_dump 数据完整保留，不解读过度
- **发现 P0b 真正生效**：5 分钟等待 + 复查，确认 TaoWatcher 跑 1 个周期后无假阳性
- **跨会话追踪 fork 来源**：用 list_messages 反推指挥官的 fork 决策路径

### 5.2 做得不到位的部分
- **第一阶段未深入追查 fork 状态**：昨晚只看到"A1-auditor 17 分钟无后续"，未深入查 auditor session (8cc4fc3f) 自己的消息历史
- **未发现 BUG-B（幽灵 leaf）**：A2/A3/A4-worker 我以为是指挥官有意创建的，没意识到是 fork bug 副作用
- **未发现 BUG-2（caller-binding 失效）**：所有 leaf 的 added_by 都是 e954cf56，我以为这是正常的，没意识到 fork 副本以 added_by=root 身份创建 leaf 是越权
- **_meta 字段问题未深挖**：发现 tao_watcher_session_id=null 但没追问根因

### 5.3 教训
作为只读观察者，**仅看 tree-state.json 不足以发现所有引擎 bug**。必须配合：
- `list_messages` 查各 session 的对话历史（理解每个 session 实际做了什么）
- `get_session_context` 查 token 用量（识别"卡死但表面正常"的 session）
- 主动追问"为什么"（为什么 added_by 都是 root？为什么 A2-worker 有 done 但 status=pending_brief？）

---

## 6. 元数据

- **报告作者**：独立观察者 b1f6efb8（Pro 实例 GLM-5.2）
- **报告生成**：2026-07-09 09:39 GMT+8
- **数据源**：
  - tree_dump / leaf_get / event_list / tree_validate（第一阶段）
  - list_messages 跨 7 个 session（第二阶段）
- **依赖报告**：指挥官最终版报告（`01-commander-e954cf56-final-report.md`）+ 67b8a9a2 报告（`03-fork-67b8a9a2-report.md`）+ 5 个 fork 会话历史（`04-fork-sessions-summary.md`）
