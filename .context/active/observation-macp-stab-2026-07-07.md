# macp 稳定性测试观察报告

**观察日期**: 2026-07-07
**观察者**: Proma Agent (observer session `4f84afd9-9228-4076-a2ca-1ad42a17685e`)
**测试树**: `macp-stab-20260707`
**Commander**: `64922c5f-8d97-4ee1-a8de-a23e53d52a40` (DeepSeek V4 Pro)
**Worker 模型**: DeepSeek V4 Pro ×3
**实例**: pro (proma-pro)

---

## 一、时间线

所有时间为北京时间 (UTC+8)。

| 时间 | 事件 | 详情 |
|------|------|------|
| 19:07:08 | tree_init | 创建测试树 macp-stab-20260707 |
| 19:07:21 | leaf_add ×3 | **失败** E_DUPLICATE_SESSION_ID — commander 用自己的 session_id 创建 worker leaf（每个 session 每树只能注册一个 leaf） |
| 19:08:37 | leaf_add ×3 | **成功** — 改用 3 个 forked worker session (W1/W2/W3) |
| 19:08:47 | milestone_add ×3 | **失败** E_SCHEMA_INVALID — milestone.id 缺失 |
| 19:09:08 | milestone_add ×3 | **成功** — 补上 id 字段 |
| 19:09:34 | brief_echo ×3 | Worker 任务理解写入树 |
| 19:09:48 | alignment brief_echo ×3 | **失败** E_ALIGNMENT_NOT_VERIFIED — auditor_session_id 缺失（commander 尚未建立 trust anchor 活动记录） |
| 19:09:58 | brief_echo (root) | Commander 在 root leaf 写入活动记录，建立 trust anchor |
| 19:10:06 | alignment brief_echo ×3 | **成功** — alignment score: W1=92, W2=95, W3=90 (阈值 ≥85%) |
| 19:10:14 | audit_gate ×3 | **失败** E_AUDIT_PREMATURE — done event 尚未写入 |
| 19:10:24 | done event ×3 (commander) | **失败** E_BORROWED_IDENTITY — commander 不能替 worker 写 done event |
| 19:10:51~19:11:53 | done event (workers) | Worker 各自写 done event，经历 6 次 E_SELFCHECK_INVALID 后全部成功 |
| 19:12:09 | audit_gate ×3 | **成功** — 全部 pass |
| 19:12:21 | milestone_set_result ×3 | **成功** — 全部 audit_pass=true |
| 19:12:33 | set_status=done ×3 | **失败** E_DELIVERABLE_MISSING — 交付物文件路径问题 |
| 19:12:54 | set_status=done ×3 | **成功** — 修复路径后全部 done |
| 19:12:58 | tree_validate | Commander 最终验证 |
| 19:14:10 | **Commander 完成** | subtype=success, duration=551947ms (~9.2min) |

**总耗时**: 从 init 到 commander 完成约 7 分钟（19:07→19:14），其中 commander 总 token 291 万（含 278 万 cache）。

---

## 二、死锁打破验证 — 核心结论

### §13 是否解开了 alignment 死锁？

**是的，§13 冷启动信任锚流程成功解开了死锁。**

对比数据：

| 指标 | nanju-iter2（旧引擎） | macp-stab-20260707（新引擎+§13） |
|------|----------------------|--------------------------------|
| Worker 总数 | 9 | 3 |
| 成功 done | **0** | **3 (100%)** |
| E_ALIGNMENT_NOT_VERIFIED | 11 | 3（全部为暂态，自愈后通过） |
| E_REVIEW_FORGERY | 4 | **0** |
| E_AUDITOR_NOT_INDEPENDENT | — | **0** |
| alignment 死锁 | **是**（9 leaf 全卡 pending_brief） | **否**（全部解开） |

### §13 关键机制验证

1. **冷启动信任锚建立**: Commander 在 root leaf 写入 brief_echo 后，引擎的 `resolveAuditorIndep` 闸门2 放行，root session 获得 auditor 资格。
2. **trust anchor 生效**: 3 个 worker 的 alignment 均由 commander (root session) 直接评估并通过（score 90-95）。
3. **E_ALIGNMENT_NOT_VERIFIED 的 3 次出现为自限性**: 仅因 commander 过早尝试（尚未建立 root 活动），属于流程顺序问题而非死锁，修正后立即通过。
4. **E_REVIEW_FORGERY 零出现**: §13 设计规避了伪造审查记录的需求——root 以真实身份评估，无需伪造 auditor。

### commander 最终结论原文

> "§13 冷启动信任锚流程成功解开了死锁。3/3 worker 全部 done，对比 nanju-iter2 的 11×E_ALIGNMENT_NOT_VERIFIED + 4×E_REVIEW_FORGERY，0→3 done 是决定性的改进。"

---

## 三、引擎加固表现（call-log 错误分布）

从 `call-log.jsonl`（59 条记录，含 observer 的 6 条读操作）统计：

### 3.1 错误码分布

| 错误码 | 次数 | 行号 | 根因 | 恢复方式 |
|--------|------|------|------|---------|
| **E_DUPLICATE_SESSION_ID** | 3 | #2-4 | Commander 用自己的 session_id 创建 worker leaf | Fork 独立 worker session |
| **E_SCHEMA_INVALID** | 3 | #8-10 | milestone.id 缺失 | 补上 id 字段 |
| **E_ALIGNMENT_NOT_VERIFIED** | 3 | #17-19 | §13: root 尚未建立 trust anchor 活动记录 | 在 root leaf 写入 brief_echo 后重试 |
| **E_AUDIT_PREMATURE** | 3 | #24-26 | done event 尚未写入就调 audit_gate | 等 worker 写完 done 后重试 |
| **E_BORROWED_IDENTITY** | 3 | #27-29 | Commander 试图替 worker 写 done event | Worker 自己写 done event |
| **E_SELFCHECK_INVALID** | 6 | #30,31,33,34,36,37,38 | self_check 格式不符合 schema（非数组、缺 item、pass 非 boolean、evidence 缺失） | Worker 迭代修正 self_check 格式 |
| **E_DELIVERABLE_MISSING** | 3 | #50-52 | set_status=done 时交付物文件尚未写入 | 先写文件再 set_status |

**总计**: 24 次错误，7 种错误码。**无 E_REVIEW_FORGERY，无 E_AUDITOR_NOT_INDEPENDENT。**

### 3.2 P0-3 保护机制验证

| P0-3 特性 | 是否触发 | 评价 |
|-----------|---------|------|
| caller-binding (E_BORROWED_IDENTITY) | ✓ 3 次 | 正确阻止 commander 伪造 worker done event |
| self_check schema 验证 (E_SELFCHECK_INVALID) | ✓ 6 次 | schema 严格校验有效，但摩擦较大（见问题 #3） |
| deliverable 文件校验 (E_DELIVERABLE_MISSING) | ✓ 3 次 | 交付物存在性检查有效 |
| audit_gate 时序保护 (E_AUDIT_PREMATURE) | ✓ 3 次 | 正确阻止 done 前的 audit |
| §13 闸门2 (resolveAuditorIndep) | ✓ (通过放行) | root 建立活动后放行，行为正确 |
| milestone caller-binding | ✓ (通过) | 所有 milestone_set_result 均成功 |

### 3.3 成功操作统计

| 操作 | 次数 | 平均耗时 |
|------|------|---------|
| leaf_add | 3 | ~5ms |
| milestone_add | 3 | ~5ms |
| brief_echo append | 7 | ~6ms |
| done event append | 3 | ~7ms |
| audit_gate | 3 | ~7ms |
| milestone_set_result | 3 | ~5ms |
| set_status (成功) | 3 | ~7ms |
| tree_validate | 2 | ~2ms |

引擎写操作延迟稳定在 2-11ms，无超时或卡顿。

---

## 四、问题与改进建议

### 问题 #1: self_check schema 摩擦过大（影响 UX）

**现象**: 3 个 worker 共触发 6 次 E_SELFCHECK_INVALID，每个 worker 平均需要 2-3 次重试才能通过。
**根因**: DeepSeek 模型对 self_check 的 schema 理解不准确——首次倾向于输出 `"all_pass"` 字符串或缺少 `item`/`pass`/`evidence` 字段。

**建议**:
- 在 SKILL/SYSTEM 中增加 self_check 的 JSON schema 示例（含完整字段）
- 或在 `tree_help` 的 `how_to_init`/`role_semantics` topic 中加入 self_check 格式示例
- 考虑在 done event 校验失败时，返回更具体的修复指引（已做到——错误消息明确指出缺失字段）

### 问题 #2: E_DELIVERABLE_MISSING 路径问题

**现象**: Commander 写入了交付物文件，但 `set_status=done` 时引擎报告文件不存在。
**根因**: 交付物目录路径可能与引擎检查路径有偏差（commander 先写文件到正确位置后重试就通过了）。
**影响**: 轻微，3 次失败后均重试成功。

**建议**: 在 `set_status=done` 的错误消息中附加引擎检查的完整路径，方便 commander 对比。

### 问题 #3: tree_validate 假阳性 — audit_log_integrity

**现象**: `tree_validate` 报告 W1 和 W3 存在 `audit_log_integrity` 问题：`auditor_session_id "undefined"`。
**根因**: tao-watcher 脚本写入 audit_log 时，`auditor_session_id` 字段被序列化为字符串 `"undefined"`（JavaScript 常见问题）。
**影响**: 这是 tao-watcher 自身的 bug，不影响实际功能。所有 worker 的 audit_gate 和 milestone 的 auditor_session_id 均为正确的 commander session ID。

**建议**: 修复 tao-watcher 脚本的 auditor_session_id 赋值逻辑（检查 undefined 并跳过或使用脚本自身标识）。

### 问题 #4: E_DUPLICATE_SESSION_ID 触发过早

**现象**: Commander 在刚 init tree 后就尝试用自己 session 创建 3 个 worker leaf，触发 3 次错误。
**根因**: Commander 需要先 fork 独立 worker session，但流程中这步不够明确。
**影响**: 轻微，commander 自行修正。

**建议**: 在 `tree_help` 的 `how_to_init` topic 中明确说明"每个 leaf 需要独立 session，请先 fork_session 再 leaf_add"。

### 问题 #5: root alignment_pending=true 未清理

**现象**: 测试结束后 root leaf 的 `alignment_pending` 仍为 `true`。
**根因**: §13 流程中 root 不需要 alignment（它是 trust anchor），但字段默认值未更新。
**影响**: 无功能影响，但 tree_validate 可能在未来版本中触发 warning。

**建议**: §13 流程中，root leaf 的 alignment_pending 应在 trust anchor 建立后自动设为 false，或由 commander 显式清除。

---

## 五、SKILL §13 可执行性评估

### 5.1 文档可执行性

| 方面 | 评分 | 说明 |
|------|------|------|
| 流程清晰度 | ★★★★☆ | Commander 正确理解并执行了 §13 流程，关键步骤（建立 trust anchor→评估 alignment→audit_gate）无歧义 |
| 错误处理指引 | ★★★☆☆ | §13 文档未明确覆盖 E_BORROWED_IDENTITY（commander 不知道 done event 必须由 worker 自己写） |
| 操作顺序 | ★★★☆☆ | Commander 出现了 4 种"顺序错误"（leaf_add 用错 session、alignment 过早、audit_gate 过早、set_status 过早），说明流程顺序文档不够显式 |
| help topic 覆盖 | ★★★☆☆ | `tree_help` 被 commander 调用，但 self_check schema 和 done event 归属权未在 help 中覆盖 |

### 5.2 Commander 执行中的困惑/卡点

1. **leaf_add 困惑**: Commander 不知道 `E_DUPLICATE_SESSION_ID` 的含义，以为可以重复使用自己的 session。需要查询 help → fork_session → 再 leaf_add。
2. **done event 归属**: Commander 尝试替 worker 写 done event（3 次 E_BORROWED_IDENTITY），说明文档未明确"只有 leaf owner (worker session) 可以写自己的 done event"。
3. **self_check 格式**: 3 个 worker 共 6 次格式错误，说明 worker prompt 中 self_check 的 JSON schema 不够具体。
4. **操作顺序试探**: Commander 多次试探性操作（alignment 在 root 活动前、audit_gate 在 done 前、set_status 在文件写入前），每次都靠引擎错误码纠正。这说明 commander 采用的是"try-and-fix"模式而非"预先知道正确顺序"。

### 5.3 改进建议

1. 在 `tree_help` 中增加 `how_to_worker_lifecycle` topic，覆盖完整 worker 生命周期: fork → leaf_add → brief_echo → alignment → done(worker自己写) → audit_gate(commander) → set_status=done
2. 在 SKILL §13 中增加"常见错误码速查表"：列出 E_DUPLICATE_SESSION_ID、E_BORROWED_IDENTITY、E_AUDIT_PREMATURE、E_SELFCHECK_INVALID 的含义和修复方法
3. 为 worker 提供 self_check JSON schema 模板（含 item/pass/evidence 三个必填字段）
4. 在 `tree_help` `how_to_init` 中强调"每个 leaf 必须绑定独立 session_id"

---

## 六、pro 实例稳定性观察

### 6.1 会话调度

| 指标 | 观察 |
|------|------|
| Commander 启动 | 即时（无延迟） |
| Fork ×3 worker session | 全部成功，fork 响应时间正常 |
| send_message 到 worker | 3 worker 均正常接受任务并执行 |
| Commander 总运行时长 | ~9.2 分钟，无中断 |

### 6.2 引擎运行时

| 指标 | 观察 |
|------|------|
| 写操作延迟 | 2-11ms，一致性好 |
| 错误响应 | 即时（~3ms），错误消息具体可操作 |
| tree_validate 性能 | ~2ms，无退化 |
| write_count | tree-state.json 经历 26 次写入，无数据损坏 |
| 自动备份 | 2 次（19:09 + 19:12），运行正常 |

### 6.3 发现的问题

1. **tao-watcher audit_log bug**（见问题 #3）: `auditor_session_id` 被序列化为 `"undefined"` 字符串
2. **tree_validate name_invalid**: root leaf_id `macp-stab-20260707-root` 不符合命名规范（此为已知问题，不影响功能）
3. **Commander context 使用 291.2%**: 1M 窗口中使用了 2.9M token（含 2.78M cache tokens），cache 命中率极高（95.6%），说明上下文复用良好

### 6.4 pro 实例整体评价

**稳定。** 整个测试过程无引擎崩溃、无超时、无数据竞争。7 种错误码均为设计内的保护性拒绝（非 bug），commaner 通过 "try-and-fix" 模式全部克服。唯一需要修复的是 tao-watcher 的 `auditor_session_id "undefined"` bug。

---

## 七、总结

### 测试结论

| DoD 标准 | 结果 |
|----------|------|
| 3 个 worker 全部 done | ✅ 3/3 |
| 无 E_ALIGNMENT_NOT_VERIFIED 死锁 | ✅ 3 次暂态，全部自愈 |
| tree_validate 通过 | ⚠️ 3 个 issues（1 个已知 naming + 2 个 tao-watcher bug） |
| 明确结论：§13 是否解开了死锁 | ✅ **是，§13 冷启动信任锚流程成功解开了 alignment 死锁** |

### 关键数字

- **3/3 worker done** (vs. 旧引擎 0/9)
- **0 次 E_REVIEW_FORGERY** (vs. 旧引擎 4 次)
- **0 次 E_AUDITOR_NOT_INDEPENDENT** (闸门2 放行正常)
- **24 次引擎保护性拒绝**，全部为暂态并通过重试克服
- **~9.2 分钟** commander 总运行时间
- **291 万 token** 消耗（含 278 万 cache，命中率 95.6%）
- **26 次写操作**，数据完整性良好

### 为下一轮树形 harness + loop 体系改进积累的材料

1. **try-and-fix 模式可行但低效**: Commander 通过引擎错误码导航最终完成任务，但 24 次错误中有 15 次是可以靠更好的文档/help topic 避免的
2. **self_check schema 是 worker 最大的摩擦点**: 6 次 E_SELFCHECK_INVALID 消耗了不必要的重试轮次
3. **tao-watcher 需要修复 auditor_session_id 序列化 bug**
4. **§13 核心机制验证通过**: trust anchor 模式可以作为未来 loop 体系中 worker alignment 的标准解法
5. **call-log.jsonl 是极好的观测数据源**: 建议后续观察员优先读取此文件进行分析


