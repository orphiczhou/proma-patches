# P1-3: Drift 自动记录（捕获可恢复错误的试错）

> 日期：2026-07-24 | 接力第三棒

## 1. 问题根因

macp 实战（tests/002）24 次工具调用失败（naming/path/schema 错），**零 drift 记录**。试错全部发生在 root/commander 的"静默修正"里——错一次改一次重试，但 tree-state 的 `drift_history` / `drift_log` 没有任何痕迹。

**后果**：
- 事后无法复盘"哪些错误高频出现、卡在哪一步"（macp 报告只能从 call-log 反推，drift_log 空空）。
- 三档纠偏机制（§7）失去输入——drift_history 是纠偏决策的依据，没有 drift 就无法量化偏差趋势。
- 协议要求"试错要留痕"（方法论原则 9），但引擎不主动捕获，全靠 agent 自觉调 `tree_drift_append`，而 agent 在赶进度时普遍漏调。

**根因**：引擎的错误返回路径（`run()` catch 块）只写 `call_log`，不写 `drift_log`。call_log 记的是"发生了什么"，drift_log 记的是"偏差与纠偏"——后者才是体系自省的原料。

## 2. 改动点

### 2.1 引擎：tree-engine.cjs `run()` catch 块加 auto-drift

**位置**：`run(cmd, args, treesRoot, callerSessionId)` 函数（L5526）的 catch 块，`appendCallLog` 之后、return `{ok:false, error}` 之前。

**逻辑**：
```text
catch (e):
  code = e.code || E_UNKNOWN
  msg = e.message
  ... appendCallLog(...)                      // 现有

  # P1-3: 可恢复错误自动记 drift
  if ids.tree_id && RECOVERABLE_ERROR_CODES.has(code):
    try:
      state = readState(ids.tree_id)           # 纯读，不加锁
      if state:
        # 定位 drift 挂载 leaf：优先 ids.leaf_id 对应 leaf；否则 caller session 对应 leaf
        target = ids.leaf_id if (ids.leaf_id && state.leaves[ids.leaf_id])
                 else (find leaf by session_id === callerSid)
        if target:
          leaf = state.leaves[target]
          # 限频：30s 内同 error_code 不重复（reason 含 [code] 标记）
          recent = leaf.drift_history.some(d =>
            d.reason.includes("[code]") && now - d.ts < 30000)
          if !recent:
            dispatch('drift', ['append', tree_id, target,
              '--kind', 'production', '--severity', 'low',
              '--action', 'self_correct',
              '--reason', `auto-logged recoverable error [${code}]: ${msg[:120]}`])
    catch _: silent                            # auto-drift 失败不影响主错误返回
```

### 2.2 可恢复错误码白名单

**记 drift（agent 试错，改了能继续）**：
- `E_NAME_INVALID`（naming 错：path 含 prefix、leaf_id 不符正则）
- `E_SCHEMA_INVALID`（schema 错：缺字段、milestone 字段名错、expect_outputs 绝对路径）
- `E_SELFCHECK_INVALID`（done 的 self_check 格式错）
- `E_DELIVERABLE_MISSING`（产物未落盘）
- `E_ALIGNMENT_NOT_VERIFIED`（缺 alignment 回填）
- `E_BORROWED_IDENTITY`（caller 错，换对 caller 能继续）
- `E_AUDIT_PREMATURE`（步骤顺序错）
- `E_GATEKEEPER_REQUIRED`（缺门禁）
- `E_PARENT_MISSING`（parent 不存在，改 parent 能继续）
- `E_DUPLICATE_LEAF` / `E_DUPLICATE_SESSION_ID`（重复，换 id 能继续）

**不记（环境/系统/规划问题，非试错）**：
- `E_IO` / `E_LOCK_TIMEOUT`（系统瞬时故障）
- `E_TREE_NOT_FOUND` / `E_LEAF_NOT_FOUND`（对象不存在，没法挂 drift）
- `E_UNKNOWN`（未分类）
- `E_TREE_NODE_BUDGET_EXCEEDED` / `E_MAX_SESSIONS`（预算超限，是规划问题不是试错）
- `E_DEPTH_EXCEEDED`（结构问题）

### 2.3 drift 挂载点定位（关键设计）

leaf_add 失败时，目标 leaf 还没创建（`state.leaves[leaf_id]` 不存在）——但这是 macp 高频错误场景。解决方案：

1. **优先**：`ids.leaf_id` 对应 leaf 存在 → 挂该 leaf（event/milestone/set-status 等操作失败时）。
2. **回退**：查 `callerSessionId` 对应的 leaf（`state.leaves` 里 `session_id === callerSid` 的）→ 挂操作者 leaf。leaf_add 失败时 caller 是 root/commander，挂到他们头上。
3. **都没有**：跳过（CLI 测试场景，无 caller）。

这样 macp 实战中"root 调 leaf_add path='macp/A' 失败"→ drift 自动挂到 root leaf，捕获到试错。

### 2.4 限频（防 drift_log 刷爆）

同一 leaf + 同一 error_code，30 秒内只记一次。
- 实现：`reason` 字段含 `[code]` 标记，查 `drift_history` 最近 30s 有无含同标记的条目。
- 效果：root 反复试同一个错（如连续 3 次 path 写错），只记 1 条；改了新错（不同 code）才记新条目。

### 2.5 silent fail

auto-drift 整段包 try-catch，失败（如 readState 异常、dispatch drift 异常）silent 不抛——**绝不影响主错误返回**。auto-drift 是"尽力而为"的增强，不能引入新故障路径。

## 3. 测试计划

### 3.1 引擎单测（test-p13.cjs）

**用例 A（leaf 存在时自动记 drift）**：
1. init + leaf_add worker（成功）
2. 对 worker 调 `event_append type=done` 但 self_check 格式错（空数组）→ E_SELFCHECK_INVALID
3. **断言**：worker.drift_history 多一条，severity=low, action=self_correct, reason 含 `[E_SELFCHECK_INVALID]`

**用例 B（leaf 不存在时挂 caller leaf）**：
1. init（root session = callerSid）
2. leaf_add path 格式错（E_NAME_INVALID，leaf 没创建）
3. **断言**：root.drift_history 多一条（挂到 caller=root），reason 含 `[E_NAME_INVALID]`

**用例 C（不可恢复错误不记 drift）**：
1. init
2. 调一个不存在的命令 → E_UNKNOWN
3. **断言**：root.drift_history 不增加

**用例 D（限频：30s 内同 code 不重复）**：
1. init + leaf_add worker
2. 连续 2 次 event_append done self_check 错（同 code）
3. **断言**：worker.drift_history 只多 1 条（第 2 次被限频）

**用例 E（主错误返回不受影响）**：
1. 触发任意可恢复错误
2. **断言**：run() 仍返回 `{ok:false, error:{code,msg}}`（auto-drift 不吞错误）

### 3.2 回归测试

- 现有 leaf_add / event / milestone 路径零回归（成功路径不进 catch，不受影响）。
- CLI 测试场景（callerSid=null）正常（回退逻辑跳过）。
- node --check 通过。

## 4. 验收标准

- [ ] 用例 A-E 全部符合预期
- [ ] auto-drift 不影响主错误返回（silent fail）
- [ ] 限频生效（30s 同 code 不重复）
- [ ] node --check 通过
- [ ] 独立审计 verdict=pass
