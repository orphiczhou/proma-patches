# V10 Phase 3 修复运行时验证总结 2026-06-26 14:00

> 验证会话: ce9a1e2f (release 实例, GLM-5.2) | 用户: 周星星
> 验证目标: commit `30eb4fa` (Bug A/B 修复) + commit `9c423b8` (TAO Watcher 防御)
> 验证方法: 直接调 mcp__tree__ 工具 + 派根指挥官端到端 + SubAgent 跟进校验
> 实例状态: dev/release 共享 dist `D:/Proma-dev/resources/app/dist/` (已重启加载最新代码)

## 一句话总结

**Bug A/B 修复运行时验证 PASS**（3 个独立执行者 + SubAgent 校验，证据强度高）。**TAO Watcher 防御部分 PASS + 发现 R-04/R-05/R-06 tree 级规则盲点**，本次立即应用 `applyNudge` 入口全局守卫补充修复（commit pending），彻底覆盖所有规则。

## 验证矩阵

| 执行者 | session | workspace | Bug A 验证 | Bug B 验证 | 备注 |
|--------|---------|-----------|------------|------------|------|
| 主 Agent | `ce9a1e2f` | proma | ✅ PASS | ✅ PASS | 直接调 mcp__tree__ 工具 |
| V4 Pro 指挥官 | `763e1d67` → 委派 `e457265b` | tree-2 | ✅ PASS | ✅ PASS | 委派给 tree-2 子会话执行 |
| GLM-5.2 指挥官 v1 | `0c1a4ca4` | **undefined** ❌ | 失败 | 失败 | E_NO_TREES_DIR |
| GLM-5.2 指挥官 v2 | `a2771f1b` | proma | ✅ PASS | ✅ PASS | 显式指定 workspace_id |

3 个执行者均返回预期错误码，**6 棵测试 tree 实际状态全部符合预期**（SubAgent 校验）。

## Bug A 验证详情

**测试场景**: commander（caller_session_id = X）尝试给 worker leaf（session_id = Y, X≠Y）写 `done` event，期望引擎拦截。

**修复点**: `cmdEventAppend` L1498 入口拦截（commit 30eb4fa A-1）+ `cmdAuditGate` L2337-2345 兜底（A-2）。

**返回码样本**（GLM-5.2 指挥官 v2）:
```json
{
  "ok": false,
  "error": {
    "code": "E_BORROWED_IDENTITY",
    "msg": "event_append rejected: caller \"a2771f1b-...\" cannot write done event to leaf \"glbu-A-worker\" (session=3e085b38-...). Only the leaf owner itself can mark done.",
    "help_topic": "self_audit_forbidden"
  }
}
```

**实际 tree 状态**（SubAgent 校验 6/26 14:00）:

| Tree | leaf 实际状态 | 符合预期 |
|------|--------------|----------|
| bugav | root + worker(pending_brief) | ✅ worker 未 done（拦截生效） |
| v4bu | root + worker(pending_brief) | ✅ |
| glbu | root + worker(pending_brief) | ✅ |

## Bug B 验证详情

**测试场景**: 同 session_id 在同 tree 中注册第二个 leaf，期望引擎拦截。

**修复点**: `cmdLeafAdd` L705-718 入口拦截 + 新错误码 `E_DUPLICATE_SESSION_ID`（commit 30eb4fa B-3）。

**返回码样本**（GLM-5.2 指挥官 v2）:
```json
{
  "ok": false,
  "error": {
    "code": "E_DUPLICATE_SESSION_ID",
    "msg": "session_id \"a2771f1b-...\" already used by leaf \"glbb-root\". Each session can only register one leaf per tree."
  }
}
```

**实际 tree 状态**:

| Tree | leaf 实际状态 | 符合预期 |
|------|--------------|----------|
| bugbv | 仅 root | ✅ worker 注册被拦截 |
| v4bb | 仅 root | ✅ |
| glbb | 仅 root | ✅ |

## TAO Watcher 防御验证（含盲点发现）

**测试场景**: 构造 bugav tree 让 bugav-A-worker 和 bugav-A2-worker 共享 session_id `4edacb8b`（绕过 B-3 拦截通过直接改 tree-state.json），两个 worker 都设 milestones=[{id:m1, status:done, audit_pass:false}] 触发 R-04 + C-02，等 TAO Watcher 巡逻观察 nudge_log。

**修复点**: `checkAllRules` 入口 `isSharedSessionLeaf` 守卫（commit 9c423b8），覆盖 Tier 1 子级规则 + Tier 2 全部规则。

**实际巡逻结果**（TAO Watcher 默认 5 分钟巡逻，05:45:58 + 05:46:38 UTC）:

| Leaf | nudge_log 内容 | 解读 |
|------|---------------|------|
| bugav-A-worker | 1 条 R-04 | tree 级规则未被守卫覆盖 |
| bugav-A2-worker | 1 条 R-04 | 同上 |
| 两者 | 无 C-02 | ✅ 子级规则守卫生效跳过 |

**结论**:
- ✅ **守卫覆盖验证 PASS**: 子级规则（C-02/C-03/C-06/C-13）+ Tier 2 规则（W-01/W-08/W-11/W-12/C-11/C-15）都被 `isSharedSessionLeaf` 守卫跳过，nudge_log 中无相应违规。
- ❌ **守卫盲点确认**: R-04/R-05/R-06 是 tree 级规则（接收 `tree` 不接收 `leaf`），内部循环 worker leaf **不走过守卫**，仍会触发 nudge。bugav tree 两个共享 session 的 worker 都收到了 R-04 nudge（`send_message=true` 会注入到共享 session_id 对应会话）。

**盲点风险**: 若共享 session_id 是某指挥官会话（如 a8111bf5 历史案例），R-04/R-05/R-06 nudge 会注入指挥官，导致思维混乱——即原 TAO Watcher 干扰问题未完全消除。

## 补充修复（本次应用）

**修复**: `applyNudge` 入口加全局 session_id 共享守卫，覆盖所有规则产生的 violation。

**修改位置**: `proma-dev-patches.cjs` L2140-2171（applyNudge 函数）

```javascript
async function applyNudge(tree, violation, cfg) {
  try {
    const freshState = JSON.parse(fs.readFileSync(tree.state_path, "utf8"));
    const leaf = freshState.leaves[violation.leaf_id];
    if (!leaf) return;

    // 全局守卫 (V10 Phase 3 followup 加固, 补 commit 9c423b8 盲点):
    // checkAllRules 入口的 isSharedSessionLeaf 守卫只覆盖接收 leaf 参数的子级规则
    // (C-02/C-03/C-06/C-13 + Tier2 全部), 但 R-04/R-05/R-06 是 tree 级规则, 接收
    // tree 参数, 内部循环 worker leaf 时不走过守卫. 运行时验证 (bugav tree) 证实
    // R-04 仍会对共享 session_id 的 leaf 触发 nudge. 这里在 applyNudge 入口加
    // 全局守卫, 覆盖所有规则产生的 violation, 彻底堵住鞭策错对象.
    if (leaf.session_id) {
      let sharedCount = 0;
      for (const l of Object.values(freshState.leaves)) {
        if (l.session_id === leaf.session_id) sharedCount++;
      }
      if (sharedCount > 1) {
        log("[Patch M] applyNudge tree=" + tree.tree_id + " leaf=" + leaf.leaf_id +
            " session_id " + leaf.session_id.slice(0, 8) + "... shared by " + sharedCount +
            " leaves, skip nudge (bug-b-repro or dirty data, defensive guard)");
        return;
      }
    }

    // ... 原有 nudge 逻辑
```

**设计权衡**:
- **双层守卫**: checkAllRules 入口守卫（早期跳过，避免无谓计算）+ applyNudge 入口守卫（兜底，覆盖所有规则）。两层共同保证彻底防御。
- **冗余但稳妥**: 即使未来新增规则忘了走守卫，applyNudge 兜底也能拦截。

**同步范围**: 3 份 patches.cjs 完全一致（2532 行）:
- `workspace-files/proma-dev-patches.cjs`（仓库版）
- `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`（部署版，待用户重启加载）
- `release/tree-system-v0.2.2/patch-l/proma-dev-patches.cjs`（patch-l 内联版）

## 跨工作区副产品发现

验证过程中**再次证实跨工作区问题运行时风险**（cross-workspace-tree-issue-2026-06-25.md 描述）:

- V4 Pro / GLM-5.2 v1 创建指挥官 session 时未指定 workspace_id → session 落到 "undefined" slug → `mcp__tree__*` 工具直接返回 `E_NO_TREES_DIR`
- V4 Pro 自己绕过（委派给 tree-2 workspace 的子会话 `e457265b`）
- GLM-5.2 v1 没绕过失败
- GLM-5.2 v2 显式指定 `workspace_id="743ff4fe-..."` 后通过

**结论**: 跨工作区问题（patches.cjs:446 create_session handler 不校验 workspace_id）是真实的运行时风险。建议 P1 修复（patches.cjs 加 workspace_id 校验拦截）。

## 最终结论

| 修复项 | 运行时验证 | 证据强度 |
|--------|------------|----------|
| Bug A (A-1 cmdEventAppend L1498) | ✅ PASS | 3 个独立执行者（主 Agent + V4 Pro + GLM-5.2）均返回 E_BORROWED_IDENTITY + 6 棵 tree 实际状态符合预期 |
| Bug A (A-2 cmdAuditGate L2337 兜底) | ⚪ 未单独验证 | A-1 入口已拦截，A-2 作为防御深度，端到端场景未触达 |
| Bug B (B-3 cmdLeafAdd L705-718) | ✅ PASS | 3 个独立执行者均返回 E_DUPLICATE_SESSION_ID + 3 棵 tree 仅 root |
| Bug B (B-4 resolveAuditorIndep L1897) | ⚪ 未单独验证 | B-3 入口已拦截，B-4 作为智能路由深度 |
| TAO Watcher 子级规则守卫 | ✅ PASS | bugav tree 验证 C-02 跳过 |
| TAO Watcher tree 级规则守卫 (盲点) | ⚠️ 9c423b8 部分失效 | R-04 在 bugav tree 触发了 2 次 nudge |
| TAO Watcher 全局守卫 (本次补充) | ⚪ 待用户重启后验证 | applyNudge 入口守卫逻辑覆盖所有规则，运行时需重启加载 |

**核心修复（Bug A/B）生产就绪**，TAO Watcher 防御需要用户重启 Proma 实例后再次跑端到端验证（重置 bugav nudge_log + 等巡逻 + 期望 R-04 也被跳过）。

## 测试 tree 一览（保留作为运行时证据）

`~/.proma/agent-workspaces/{proma, tree-2}/workspace-files/.context/trees/`:

| Tree | 类型 | 执行者 |
|------|------|--------|
| bugav | Bug A + TAO Watcher | 主 Agent (proma) |
| bugbv | Bug B | 主 Agent (proma) |
| v4bu | Bug A | V4 Pro 委派 (tree-2) |
| v4bb | Bug B | V4 Pro 委派 (tree-2) |
| glbu | Bug A | GLM-5.2 v2 (proma) |
| glbb | Bug B | GLM-5.2 v2 (proma) |

## 待用户操作

1. 🟡 **重启 Proma 实例**加载 patches.cjs 最新版（含 applyNudge 全局守卫）
2. 🟢 重启后可选: 重置 bugav nudge_log + 等巡逻 → 验证 R-04 也被跳过（彻底闭环）
3. 🟢 commit + push 本次修复（applyNudge 守卫 + 本文档）

## 关联文档

- [TAO Watcher 修复（commit 9c423b8）](./fix-tao-watcher-session-shared.md)
- [Bug A/B 修复验证（commit 30eb4fa）](./bug-fix-validation.md)
- [跨工作区问题报告](../cross-workspace-tree-issue-2026-06-25.md)
- [V10 Phase 3 收尾交接](../handoff/session-2026-06-25-v10-followup.md)
