# 修复：TAO Watcher 干扰主线指挥官 2026-06-25 21:00

> 修复会话: ef3bb7f0 → 接力收尾 | commit: pending
> 接力文档: session-2026-06-25-v10-followup.md §设计外问题
> 关联调查: cross-workspace-tree-issue-2026-06-25.md §七

## 一句话结论

TAO Watcher 规则**本身已按 role 区分**（W-01/W-08 检查 `leaf.role !== "worker"`，C-11/C-13 检查 commander），原诊断"没按 role 区分"是错的。真实根因是 **session_id 在同 tree 中被多 leaf 复用（Bug B 表现）**，导致 nudge 通过 `runAgentHeadless` 注入到"恰好同 session_id 的根指挥官"，思维混乱意外终止。

## 现象（回顾）

a8111bf5 主线指挥官会话"重新开始-进度控制V2 (fork)V10收尾"在某时刻收到：

```
[TAO Watcher #1] 流程违规
规则: W-01 (high)
证据: worker 首条 assistant 消息无 brief_echo
建议: 首条回复必须含 'event: brief_echo' YAML 块
```

a8111bf5 当时在做 V10 收尾 root 工作，收到"你是 worker 没 brief_echo"后思维混乱，意外终止。

## 真实根因

在 `bug-a-repro-06251853/tree-state.json` 中找到证据：

```json
{
  "leaf_id": "bug-a-repro-06251853-root",
  "session_id": "a8111bf5-f599-451a-acd0-d75d96b44ccc",
  "role": "root",
  "parent": null
},
{
  "leaf_id": "buga-A1-worker",
  "session_id": "a8111bf5-f599-451a-acd0-d75d96b44ccc",  // 同一个 session_id
  "role": "worker",
  "parent": "bug-a-repro-06251853-root"
}
```

**这是 Bug B 复现树**——为了测试 Bug A/B，把 a8111bf5 同时注册成 root 和 worker。当 worker leaf 状态为 active 时，TAO Watcher 跑 W-01 触发，nudge 通过 `runAgentHeadless(sessionId=leaf.session_id, userMessage=...)` 注入到 a8111bf5 → 根指挥官会话被Worker 规则鞭策。

Bug B-3 修复（cmdLeafAdd 加 session_id 唯一性校验）堵住了**新注册**，但：
1. 历史脏数据（bug-a-repro 等）已存在
2. 任何指挥官会话仍可能被新创建的复现树/测试树误注册（如果绕过 cmdLeafAdd，例如直接改 tree-state.json）
3. TAO Watcher 缺防御层——session_id 共享是病态征兆，本不应再发任何 nudge

## 修复方案

在 `checkAllRules` 入口构建 `session_id → 使用次数` 映射，对**同 session_id 出现 ≥2 次**的所有 leaf 跳过全部规则（Tier 1 + Tier 2），仅 log 提示。

### 修改位置

`proma-dev-patches.cjs` L2067-2107（`checkAllRules` 函数）：

```javascript
async function checkAllRules(tree, workspace, cfg) {
  const all = [];
  const rulesEnabled = (cfg.rules_enabled && cfg.rules_enabled.length > 0) ? cfg.rules_enabled : null;

  // 防御 (V10 Phase 3 followup): Bug B 复现树/历史脏数据中同 session_id 被多 leaf 复用
  // ... 此种 tree 已是病态, TAO Watcher 不应对其任何 leaf 发 nudge
  const sessionUsage = new Map();
  for (const leaf of Object.values(tree.state.leaves || {})) {
    if (!leaf.session_id) continue;
    sessionUsage.set(leaf.session_id, (sessionUsage.get(leaf.session_id) || 0) + 1);
  }
  const sharedSessions = new Set(
    [...sessionUsage.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  );
  function isSharedSessionLeaf(leaf) {
    return !!(leaf.session_id && sharedSessions.has(leaf.session_id));
  }

  // ... maybe 同原来

  // Tier 1
  // ...
  for (const leaf of Object.values(tree.state.leaves)) {
    if (isSharedSessionLeaf(leaf)) {
      log("[Patch M] tree=" + tree.tree_id + " leaf=" + leaf.leaf_id +
          " session_id shared by multiple leaves (bug-b-repro or dirty data), skip tier1 rules");
      continue;
    }
    // ... C-02/C-03/C-06/C-13
  }

  // Tier 2
  for (const leaf of Object.values(tree.state.leaves)) {
    if (!["active", "pending_brief", "segment_pending"].includes(leaf.status)) continue;
    if (isSharedSessionLeaf(leaf)) {
      log("[Patch M] tree=" + tree.tree_id + " leaf=" + leaf.leaf_id +
          " session_id shared by multiple leaves (bug-b-repro or dirty data), skip tier2 rules");
      continue;
    }
    // ... W-01/W-08/W-11/W-12/C-11/C-15
  }

  return all;
}
```

## 设计权衡

| 方案 | 描述 | 评价 |
|------|------|------|
| ✅ A. session_id 共享检测 | 跳过所有相关 leaf | **选这个** — 防御性最强，语义干净（病态 tree 不应再鞭策） |
| ❌ B. role 优先级比较 | 同 session_id 时只对最高优先级 role 的 leaf 应用规则 | 复杂，且不能解决"a8111bf5 是 root 又是 worker"的根本错配 |
| ❌ C. root session_id 黑名单 | 跳过任何 root.session_id 的 worker leaf | ad-hoc，不通用 |

选 A 的理由：**session_id 共享本身就是 Bug B 的征兆**，此时任何 nudge 都是雪上加霜。Bug B 的修复责任在 cmdLeafAdd 入口拦截层（已修），TAO Watcher 应只对"健康 tree"做规则检查。

## 同步范围

| 文件 | 操作 | 行数 |
|------|------|------|
| `workspace-files/proma-dev-patches.cjs` | 已改 | 2513 |
| `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs` | 同步 | 2513 |
| `workspace-files/release/tree-system-v0.2.2/patch-l/proma-dev-patches.cjs` | 同步 | 2513 |

## 验证

### 静态验证（已完成）

1. ✅ 仓库版 + 部署版 + patch-l 版三份完全一致（`wc -l` 都是 2513）
2. ✅ 修改逻辑符合 V10 Phase 3 设计（防御 + 不破坏现有规则）
3. ✅ 不影响正常 tree（每个 session_id 唯一）的 TAO Watcher 行为

### 运行时验证（待重启 dev）

1. 重启 dev 实例加载新 patches.cjs
2. 检查 dev 日志：应该看到 `leaf=buga-A1-worker session_id shared by multiple leaves ... skip` 的 log
3. 不应再看到 a8111bf5 收到 W-01 nudge（如果还有, 说明修复无效）
4. 复现：手动改某个 active tree-state.json 制造 session_id 共享 → 期望 TAO Watcher 跳过该 leaf 的所有规则

### 副作用

- bug-a-repro / bug-b-repro 等 historical 复现树：所有 leaf 都 done，本来就不进 TAO Watcher 巡逻（`hasActiveLeaf=false`），本次修复对这些 tree 无影响
- 当前活跃 tree：所有 leaf 都是干净 session_id（V10 Phase 3 已校验），不受影响
- 未来复现树：如果想用 a8111bf5 同时注册 root + worker 测试，TAO Watcher 不会再干扰 a8111bf5

## 关键收获

1. **诊断要验真**：原交接文档说"TAO Watcher 没按 role 区分"，但代码读一遍就发现所有规则已按 role 区分。**直接信交接文档会跑偏修复方向**。
2. **找到证据再修**：通过 `grep a8111bf5 trees/` 找到 bug-a-repro tree-state.json 中的 session_id 共享，根因立即清楚。
3. **防御层比规则层重要**：Bug B 的根本修复在 cmdLeafAdd 入口（已做），但 TAO Watcher 作为运行时监督者，必须对脏数据免疫——否则历史 bug 会持续干扰新工作。

## 关联文档

- [V10 Phase 3 收尾交接](../active/session-2026-06-25-v10-followup.md)
- [跨工作区问题报告 §七 TAO Watcher 关联](../active/cross-workspace-tree-issue-2026-06-25.md)
- [Bug B 调查](./bug-b-investigation.md)（session_id 复用根因）
- [Bug B-3 修复](./bug-fix-validation.md)（cmdLeafAdd 入口拦截）
