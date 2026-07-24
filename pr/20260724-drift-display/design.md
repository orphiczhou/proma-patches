# PR 设计：drift_history UI 显示修复

> 日期 2026-07-24 | 类型：bug fix（UI 数据盲区）| 影响面：所有有 drift 的树
> 触发：用户报"违规记录一律显示无违规记录"

## Context（为什么做）

树面板"详细信息-违规记录"区块只读 `leaf.nudge_log`，但系统的**主要违规/纠偏数据在 `drift_history`**（drift_append / 状态切换 / 会话交接 / 上下文超限写入）。`drift_history` 在 IPC handler（不传）+ renderer（不读）中**完全没有路径**——所以大多数树（有 drift 无 nudge）显示"无违规记录"即使 drift_history 有大量条目。

观察员实测确认：同 leaf 加 nudge + drift，nudge 显示、drift 不显示。

## 根因

| 数据 | IPC handler 传？ | renderer 读？ |
|------|-----------------|--------------|
| nudge_log | ✅ patches.cjs:2149 | ✅ tree-view.js:732 |
| drift_history | ❌ 缺 | ❌ 缺 |

## 修复设计（2 处，~30 行）

### 改动1：IPC handler 加 drift_history（proma-dev-patches.cjs）

位置：`registerTreePanelIpc` 的 get-tree-states handler，leaf 映射对象（L2148 `nudge_log` 之后）。

加：
```js
drift_history: Array.isArray(leaf.drift_history) ? leaf.drift_history.slice(-10).map(d => ({
  ts: d.ts, kind: d.kind, severity: d.severity, action: d.action,
  fork_to: d.fork_to, reason: d.reason
})) : [],
```

参照现有 nudge_log（L2149）的 slice(-10).map 模式。drift 字段：kind(production/direction/rhythm)、severity(low/mid/high)、action(nudge/limit/prune/self_correct/declare/handoff)、fork_to、reason、ts。

### 改动2：renderer 加偏移记录区块（proma-tree-view.js）

位置：违规记录区块（L731-751）。重构逻辑——nudge + drift 都显示，两者皆空才"无违规"。

把现有 L731-751 替换为：
```js
// 违规记录（nudge_log）+ 偏移记录（drift_history）
const hasNudge = leaf.nudge_log && leaf.nudge_log.length > 0;
const hasDrift = leaf.drift_history && leaf.drift_history.length > 0;

if (hasNudge) {
  detailEl.appendChild(h('div', { className: 'ptv-detail-section-title' }, '⚠ 违规记录 (' + leaf.nudge_log.length + ')'));
  const logWrap = h('div', { className: 'ptv-violation-list' });
  const sorted = leaf.nudge_log.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  for (const v of sorted) {
    const entry = h('div', { className: 'ptv-violation-entry ptv-severity-' + v.severity });
    entry.appendChild(h('div', { className: 'ptv-violation-header' }, [
      h('span', { className: 'ptv-violation-rule' }, v.rule_id),
      h('span', { className: 'ptv-violation-sev ptv-severity-' + v.severity }, v.severity),
      h('span', { className: 'ptv-violation-ts' }, formatRelative(v.ts))
    ]));
    entry.appendChild(h('div', { className: 'ptv-violation-evidence' }, v.evidence || '(无证据)'));
    if (v.suggest) entry.appendChild(h('div', { className: 'ptv-violation-suggest' }, '→ ' + v.suggest));
    if (v.send_message === false) entry.appendChild(h('div', { className: 'ptv-violation-note' }, '(已达 nudge 上限, 仅记录)'));
    logWrap.appendChild(entry);
  }
  detailEl.appendChild(logWrap);
}

if (hasDrift) {
  detailEl.appendChild(h('div', { className: 'ptv-detail-section-title' }, '↕ 偏移记录 (' + leaf.drift_history.length + ')'));
  const driftWrap = h('div', { className: 'ptv-violation-list' });
  const dsorted = leaf.drift_history.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  for (const d of dsorted) {
    const sev = d.severity || 'low';
    const entry = h('div', { className: 'ptv-violation-entry ptv-severity-' + sev });
    entry.appendChild(h('div', { className: 'ptv-violation-header' }, [
      h('span', { className: 'ptv-violation-rule' }, (d.kind || 'drift') + ' · ' + (d.action || '-')),
      h('span', { className: 'ptv-violation-sev ptv-severity-' + sev }, sev),
      h('span', { className: 'ptv-violation-ts' }, formatRelative(d.ts))
    ]));
    if (d.reason) entry.appendChild(h('div', { className: 'ptv-violation-evidence' }, d.reason));
    if (d.fork_to) entry.appendChild(h('div', { className: 'ptv-violation-suggest' }, '→ fork 到 ' + d.fork_to));
    driftWrap.appendChild(entry);
  }
  detailEl.appendChild(driftWrap);
}

if (!hasNudge && !hasDrift) {
  detailEl.appendChild(h('div', { className: 'ptv-detail-section-title' }, '✓ 无违规记录'));
}
```

复用现有 CSS（`ptv-violation-entry` / `ptv-severity-*` / `ptv-violation-header` 等）——零新 CSS。

## 文件改动

| 文件 | source | 部署 dist |
|------|--------|-----------|
| proma-dev-patches.cjs | D:/Codes/tree-harness/ | D:/Proma-dev/resources/app/dist/（dev/pro 共享）|
| proma-tree-view.js | D:/Codes/tree-harness/release/tree-system-v0.2.2/patch-l/ | D:/Proma-dev/resources/app/dist/ |

## 测试计划

1. 部署后 restart pro。
2. 给某 tree 的 leaf 加 drift（tree_drift_append kind=production severity=high action=prune reason="测试"）。
3. 打开树面板详细信息 → 应看到"↕ 偏移记录 (1)"区块 + drift 内容。
4. 同时验证 nudge_log 仍正常显示（不回归）。
5. 无 drift 无 nudge 的 leaf → 仍"✓ 无违规记录"。

## 风险

低——纯 additive（新增 drift_history 传递 + 渲染），不改现有 nudge 逻辑/CSS。最坏情况：drift_history 字段名/结构与引擎不符 → 渲染空（fallback 到无违规），不崩。
