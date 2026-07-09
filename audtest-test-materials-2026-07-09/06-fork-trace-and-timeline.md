# Fork 调用追踪 + 时间线

> 整理者：独立观察者 b1f6efb8（Pro 实例 GLM-5.2）
> 整理时间：2026-07-09 09:39 GMT+8
> 目的：还原指挥官 e954cf56 在 2026-07-08 22:25 – 22:50 之间的 fork 决策路径，作为修复 Proma fork identity timeout bug 的素材

---

## 1. 完整时间线

| 时间（GMT+8） | 事件 | session | 证据 |
|---|---|---|---|
| 22:25:29 | 用户向指挥官派任务（P0a/P0b/P1b 端到端验证） | e954cf56 | msg idx 0, timestamp 1783520729172 |
| 22:25:58 | `tree_init` 成功，root leaf 创建 | e954cf56 | tree_dump `created_at: 2026-07-08T22:25:58.912+08:00` |
| 22:26:07 | `event_append(plan)` 成功 | e954cf56 | root.events[0].ts |
| 22:26:07 | **fork #1** → 8cc4fc3f（计划当 auditor） | e954cf56 → 8cc4fc3f | 8cc4fc3f created_at 1783520767849 |
| 22:26:47 | `leaf_add(audtest-A1-auditor, session=8cc4fc3f, added_by=e954cf56)` 成功 | e954cf56 | auditor leaf created_at 1783520767849... 实际 leaf created_at 22:26:47.849 |
| 22:28:57 | `event_append(brief_echo)`（root 代调）成功 | e954cf56 | auditor.events[0].ts |
| 22:28:57 | 尝试 `event_append(done)` 失败 → `E_BORROWED_IDENTITY`（caller=root ≠ leaf.session=auditor） | e954cf56 | 指挥官报告 B5 |
| 22:30 左右 | 指挥官反复 send_message 给 8cc4fc3f，全部 busy | e954cf56 | msg idx 46-64 |
| 22:31:59 | **fork #2** → d308ce21（计划替换卡死的 auditor） | e954cf56 → d308ce21 | d308ce21 created_at 1783521119564 |
| 22:34:58 | `leaf_add(audtest-A2-worker)` —— **fork bug 副作用**（d308ce21 自调） | d308ce21 | A2-worker leaf created_at 1783521119564... 实际 22:34:58.090 |
| 22:36:17 | **fork #3** → d63805e6 | e954cf56 → d63805e6 | d63805e6 created_at 1783521377977 |
| 22:37:06 | **fork #4** → b8711bb7 | e954cf56 → b8711bb7 | b8711bb7 created_at 1783521426753 |
| 22:37:36 | **fork #5** → 166a817c（孤儿，未被使用） | e954cf56 → 166a817c | 166a817c created_at 1783521456821 |
| 22:37:50 | **fork #6** → 67b8a9a2（孤儿，未被使用） | e954cf56 → 67b8a9a2 | 67b8a9a2 created_at 1783521470568 |
| 22:38:27 | `leaf_add(audtest-A3-worker)` + `leaf_add(audtest-A4-worker)` —— **fork bug 副作用** | （来源不明，疑似 fork 副本越权） | A3/A4-worker leaf created_at 22:38:27 |
| 22:38:57 | A2-worker 出现 `done` event（fork 副本越权写入） | d308ce21 | A2-worker.events[0].ts |
| 22:39:57 | TaoWatcher 周期 #1：A2/A3-worker 收到 W-01 nudge | TaoWatcher | nudge_log ts 2026-07-08T14:39:57.719Z |
| 22:41:32 | TaoWatcher 周期 #1：A4-worker 收到 W-01 nudge | TaoWatcher | nudge_log ts 2026-07-08T14:41:32.010Z |
| 22:42 左右 | 指挥官认识到 auditor session 全部卡死，开始用 b8711bb7 跑 P1b | e954cf56 | 指挥官报告 E1-E4 |
| 22:48:32 | d63805e6 通过 tree_dump 自查发现是 A3-worker owner，补 brief_echo | d63805e6 | d63805e6 msg idx 25 |
| 22:50:04 | 测试结束 | e954cf56 | e954cf56 updated_at 1783522304670 |
| 次日 09:34 | 观察者开始第二阶段（fork 来源追踪） | b1f6efb8 | 本次报告 |
| 次日 09:35 | 指挥官（继续）+ 67b8a9a2 收到"终止测试，写报告" | e954cf56 / 67b8a9a2 | msg idx 222 / 17 |
| 次日 09:39 | 观察者完成材料整合 | b1f6efb8 | 本目录 |

---

## 2. Fork 调用决策路径

```
e954cf56（真 root 指挥官）
├─ tree_init（建树）
├─ event_append(plan)（root 写 plan）
├─ fork #1: 8cc4fc3f → leaf_add(A1-auditor)
│   ├─ send_message(8cc4fc3f, 让它自调 brief_echo+done) → 全部 busy
│   ├─ root 代调 brief_echo → ok（无 caller 校验）
│   ├─ root 代调 done → E_BORROWED_IDENTITY ✅ 防护②生效
│   └─ root 调 audit_gate(pass) → E_AUDIT_PREMATURE ✅ 门禁前置
├─ fork #2: d308ce21 → 计划替换卡死的 auditor session
│   ├─ leaf_add(A2-worker) ← fork bug 副作用（d308ce21 自调）
│   ├─ archive(8cc4fc3f) → E_BORROWED_IDENTITY（caller=d308ce21 ≠ e954cf56）
│   └─ 完成 8478 字完整报告（最详尽）
├─ fork #3: d63805e6 → leaf_add(A3-worker)（fork bug 副作用）
│   ├─ 收到 W-01 nudge
│   ├─ tree_dump 自查 → 发现是 A3-worker owner
│   └─ 补 brief_echo + 身份更正报告
├─ fork #4: b8711bb7 → leaf_add(A4-worker)（fork bug 副作用）
│   ├─ 收到 W-01 nudge
│   ├─ ✅ 唯一可用，与指挥官通讯
│   └─ 跑通 P1b fix_evidence（brief_echo → review_round → done event）
├─ fork #5: 166a817c → 孤儿（未被使用）
│   └─ 老实承认 fork 身份后闲置
└─ fork #6: 67b8a9a2 → 孤儿（未被使用）
    ├─ 死磕"身份劫持"说
    ├─ tree_dump 自查发现是 fork 副本
    └─ 发现 BUG-2（leaf_add caller-binding 失效）
```

---

## 3. 关键问题：fork identity timeout 的时序

### 3.1 Proma V9+ Phase 4 / R2 P1 修复机制

每次 `fork_session` 调用，Proma 会：
1. 创建新 session（继承源 session 的对话历史 + cwd）
2. 异步注入【FORK 身份提示】user 消息（V9+ Phase 4 / R2 P1 标准机制）
3. 等待 fork identity 校验完成 → `fork_identity_status: 'ok' | 'timeout'`

### 3.2 timeout 状态的副作用

- session 进入"准备处理初始 prompt 但未真正启动"状态
- 所有 `send_message` 返回 `status: busy, error: Session is currently processing another message`
- `list_messages` 显示初始 fork prompt 一条 assistant 消息都没产出
- `get_session_context` 显示 `No usage data yet`（无 token 消耗）
- 间隔 8s/20s/45s/60s/90s 多次重试，状态不变

### 3.3 4 fork 3 卡死的分布

| Fork | 状态 | 消息数 | 是否被利用 |
|---|---|---|---|
| 8cc4fc3f | timeout | 25（含报告） | leaf_add 绑定为 A1-auditor，但 send_message 全 busy |
| d308ce21 | timeout | 124（最详尽报告） | leaf_add 绑定为 A2-worker，fork bug 副作用越权 |
| d63805e6 | **可用**（晚到） | 31 | leaf_add 绑定为 A3-worker，22:48 才补 brief_echo |
| b8711bb7 | **可用** | 127（次详尽） | leaf_add 绑定为 A4-worker，跑通 P1b |
| 166a817c | 不明 | 5（仅承认身份） | 未被绑 leaf，孤儿 |
| 67b8a9a2 | 不明 | 40（含完整报告） | 未被绑 leaf，孤儿 |

**实测可用率：2/6 = 33%**（指挥官最终报告说 25%，可能是把 166a817c 和 67b8a9a2 算进了失败侧）。

### 3.4 fork bug 副作用：幽灵 leaf

A2/A3/A4-worker leaf 的来源：

- **不是**指挥官 e954cf56 显式调用 `leaf_add` 创建的
- **是** fork 出来的 session（d308ce21、d63805e6、b8711bb7）在收到继承的 root 测试 prompt 后，**误以为自己是 root，自调 leaf_add 创建的**
- 证据：A2-worker.events[0] 是 done event（22:38:57），来自 d308ce21；A3/A4-worker.events 为空但 status='pending_brief'

**这是 Proma fork 机制的核心 bug**：fork 时继承了源 session 的完整 prompt（包括"建 leaf"指令），fork 副本误以为自己是指挥官，越权调 leaf_add。

而 caller-binding 在 leaf_add 路径**没有校验 caller === added_by**（BUG-2），所以这些越权写入全部成功。

---

## 4. 跨会话 send_message 路径分析

### 4.1 指挥官 → fork session 的 send_message

| 目标 fork | wait | notify | 结果 |
|---|---|---|---|
| 8cc4fc3f | true | - | busy（永久） |
| 8cc4fc3f | false | true | busy（永久） |
| d308ce21 | true | - | busy（永久，但 124 条消息说明后来通了？） |
| b8711bb7 | true | - | ✅ 可用，跑通 P1b |

**矛盾**：d308ce21 显示 124 条消息但又被认为"永久 busy"？推测：
- d308ce21 后期通了，但指挥官已经放弃它，转向 b8711bb7
- 或 d308ce21 的 124 条消息主要是 fork bug 副作用自调 leaf_add 时产生的（不是响应 send_message）

### 4.2 fork session 之间的间接通讯

- b8711bb7（A4-worker）→ e954cf56（root）：跑通 P1b 后通知 root
- d63805e6（A3-worker）：自查后补 brief_echo（未通知 root）
- 67b8a9a2（孤儿）：写完整报告到工作区级 .context/（未通知 root）

---

## 5. 修复建议（基于 fork 调用追踪）

### 5.1 短期（不修引擎）

1. **测试前探测**：fork 后立刻 `send_message(wait=true, timeout=5s)` 探测可用性，归档卡死 session 重 fork
2. **避免 fork session 继承 root prompt**：fork 时清除继承的"建 leaf"指令，或用更精细的 fork 选项

### 5.2 中期（修引擎）

3. **修 fork identity timeout**：timeout 后应释放 session 状态，或重试身份验证
4. **修 leaf_add caller-binding**：在 leaf_add 路径加 `caller === added_by` 校验（堵住 BUG-2 + 幽灵 leaf）
5. **修 leaf_add 事务原子性**：报错时完整回滚（修 BUG-B）

### 5.3 长期（协议演进）

6. **fork session 禁用继承 root prompt**：避免 fork 副本误以为自己是 root
7. **SDK 提供 `wait_for_session_ready(session_id, timeout)` 接口**：让指挥官能 polling 等就绪
8. **fork identity 提示改进**：当前提示被 fork 副本误认为 prompt injection，需要更明确的认证机制（如签名）

---

## 6. 元数据

- **数据来源**：Proma SDK `list_messages` 跨 7 个 session 的对话历史
- **时间戳基准**：所有 timestamp 来自 SDK 返回值（毫秒级），已转换为 GMT+8
- **完整性**：本时间线覆盖 22:25 – 22:50 的关键事件，省略了大量中间挣扎（如指挥官对 8cc4fc3f 的 8 次 send_message 重试）
