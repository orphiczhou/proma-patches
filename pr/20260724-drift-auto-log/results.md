# P1-3: Drift 自动记录 — 实施与审计结果

> 日期：2026-07-24 | 接力第三棒 | design.md 同目录

## 1. 实施摘要

### 1.1 引擎改动：tree-engine.cjs

**(a) 新增常量** `RECOVERABLE_ERROR_CODES`（enum 区，L89-97）：11 个可恢复错误码白名单。
```
E_NAME_INVALID / E_SCHEMA_INVALID / E_SELFCHECK_INVALID / E_DELIVERABLE_MISSING /
E_ALIGNMENT_NOT_VERIFIED / E_BORROWED_IDENTITY / E_AUDIT_PREMATURE /
E_GATEKEEPER_REQUIRED / E_PARENT_MISSING / E_DUPLICATE_LEAF / E_DUPLICATE_SESSION_ID
```

**(b) `run()` catch 块加 auto-drift**（L5550 附近）：错误返回前，若错误码在白名单 + tree 存在 + 能定位挂载 leaf，自动 `dispatch('drift', ...)` 记一条 `production/low/self_correct`。
- **挂载点定位**：优先 `ids.leaf_id` 对应 leaf；否则 caller session 对应 leaf（leaf_add 失败时 leaf 没建，挂操作者）。
- **限频**：同 leaf + 同 code 30 秒内只记一次（reason 含 `[code]` 标记 + ts 比较）。
- **silent fail**：整段 try-catch，auto-drift 异常不影响主错误返回。

**(c) 审计反馈修复**：`dispatch('drift', ...)` 改 `await`（原 fire-and-forget 有 unhandled rejection 理论风险；await 让外层 try-catch 完整覆盖，延迟仅 drift 写入时间 ~10ms，错误路径可接受）。

### 1.2 不记 drift 的错误（环境/系统/规划）

`E_IO` / `E_LOCK_TIMEOUT` / `E_TREE_NOT_FOUND` / `E_LEAF_NOT_FOUND` / `E_UNKNOWN` / `E_TREE_NODE_BUDGET_EXCEEDED` / `E_MAX_SESSIONS` / `E_DEPTH_EXCEEDED` / `E_REVIEW_FORGERY` / `E_REVIEW_NOT_CONVERGED` / `E_INVALID_UUID_STRICT`（待观察）。

## 2. 部署

| 目标 | 状态 |
|------|------|
| source tree-engine.cjs | node --check OK |
| dev/pro dist | cp + node --check OK + diff identical |
| dev/pro 实例 | restart-{dev,pro}.ps1 (ISOLATED=1) LAUNCHED |

## 3. 单测结果

**脚本**：`pr/20260724-drift-auto-log/test-p13.cjs`（5 用例 16 子用例）

```
[A] leaf 存在时 auto-drift 到该 leaf               6 PASS（E_SELFCHECK_INVALID + severity/action/kind/reason）
[B] leaf_add 失败时 auto-drift 挂 caller（root）    3 PASS（E_NAME_INVALID + 挂 root leaf）
[C] 不可恢复错误（E_UNKNOWN）不记 drift             2 PASS
[D] 限频：3 次同 code 只记 1 drift                  1 PASS
[E] 主错误返回不受影响                              4 PASS（ok=false + code + msg + help_topic）
=== 16 passed, 0 failed ===
```

**回归**：P0-1 单测 17/17 同步复跑全过（零回归）。

## 4. 独立审计

**审计员**：独立子会话（release 本地，DeepSeek-V4-Pro，session=879159d3）
**Verdict**：**conditional_pass → 已升级为 pass**

审计结论：
- 白名单合理性 PASS：11 码全部满足"可恢复试错"定义；E_REVIEW_FORGERY / E_REVIEW_NOT_CONVERGED 合理排除（作弊/结构性阻断，非 honest mistake）。
- 挂载点定位 PASS：leaf 存在挂该 leaf；leaf_add 失败回退 caller leaf；CLI 无 caller 场景安全跳过。
- 限频 PASS：30s 同 code 只记一次，`[code]` 标记 + ts 比较健壮，`Array.isArray` 防御到位。
- silent fail PASS（附建议）：try-catch 完整，主错误隔离；**建议 dispatch('drift') 加 await 或 .catch 消除 unhandled rejection → 已采纳（改 await）**。
- 锁/重入安全 PASS：主 dispatch withLock 在 throw 前已 finally 释放；readState 纯读无锁；drift 锁独立获取不嵌套。
- 回归 PASS：成功路径不进 catch，零影响；call_log / 手动 drift_append 路径无破坏。
- 单测 PASS：16/16 绿；9 个未独立测试的白名单码通过机制统一性论证安全。

**升级理由**：审计唯一的 conditional 条件（unhandled rejection 防御）已用 `await` 修复，复跑 16/16 + P0-1 17/17 零回归，升至 pass。

## 5. 后续观察点

- **E_INVALID_UUID_STRICT**：审计建议 macp 实战观察 agent 使用占位 UUID 的频率。若高频且符合"试错→修正"模式，下一轮补入白名单。当前判断（占位 UUID 多属"凑合"而非"试错"）可接受。
- macp 类实战再跑时，确认 drift_log 不再为空，且记录的错误码分布与 call-log 失败分布对齐。

## 6. 交付物

- `D:/Codes/tree-harness/tree-engine.cjs`（RECOVERABLE_ERROR_CODES + run catch auto-drift）
- `D:/Codes/tree-harness/pr/20260724-drift-auto-log/{design.md, results.md, test-p13.cjs}`
