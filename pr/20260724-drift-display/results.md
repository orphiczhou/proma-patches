# PR 结果：drift_history UI 显示修复

> 日期 2026-07-24 | verdict: **CONVERGED（审计 pass）**

## 实施（drift-display-impl a7737ef9）

| 文件 | 改动 | 行号 | node --check |
|------|------|------|--------------|
| proma-dev-patches.cjs | IPC handler leaf 映射加 drift_history（slice(-10).map ts/kind/severity/action/fork_to/reason）| L2154 | ✅ |
| release/.../proma-tree-view.js | 违规区块重构为 nudge+drift 双 section（hasNudge/hasDrift/皆空三段逻辑），复用 ptv-violation-* CSS | L731-776 | ✅ |

零 nudge 回归、零新 CSS、纯 additive。

## 部署

- 复制 source → D:/Proma-dev/resources/app/dist/（patches.cjs + proma-tree-view.js）。
- restart pro（加载）。dev 共享 dist（未重启，下次重启加载）。

## 独立审计（drift-display-audit 800c629c，verdict: pass）

1. **代码核验**：dist patches.cjs 含 drift_history 字段（get-tree-states leaf 映射）；dist tree-view.js 含 偏移记录 + hasDrift 三段逻辑。✅
2. **功能实测**：tree_drift_append(mltest-A1-worker, kind=production, severity=high, action=prune, reason="审计测试-违规显示") → tree_leaf_get 确认 drift_history 含该条目（kind/severity/action/reason 对）。✅
3. **IPC 通路**：handler 读 leaf.drift_history → 映射 → 返回含 drift_history → renderer 读 leaf.drift_history 渲染。链路闭合，无断点。✅
4. **nudge 零回归**：nudge_log 仍在 IPC 映射 + renderer。✅

审计员注入的测试 drift 留在 mltest-A1-worker，可供肉眼验证 UI 渲染（打开树面板详细信息应见"↕ 偏移记录"区块）。

## 残留

- 肉眼 UI 验证（用户）：打开 pro 树面板 mltest-A1-worker 详情，确认"↕ 偏移记录"显示。审计验证了数据+代码通路，渲染视觉由用户确认。
- dev 未重启（共享 dist 已更新，下次重启加载）。
- release（宿主）未部署（避免杀会话）。
