#!/usr/bin/env node
// tree-analyze.cjs — Tree 体系执行分析（Layer C，2026-07-03）
//
// 聚合 call-log.jsonl（Layer A）+ tree-state.json → P0 安全事件 + P1 执行时间线。
// 消除"日志散落/半结构化/按会话而非按tree"的分析痛点。
//
// 数据源（按 tree 聚合，非按会话）:
//   - call-log.jsonl（含轮转 .1/.2/.3）— 每次 mcp__tree__* 调用，成功+失败都记（Layer A 消盲区）
//   - tree-state.json 的 events / audit_log — 业务事件 + 审计记录
//
// 用法:
//   node tree-analyze.cjs                                  # 全 tree，全维度
//   node tree-analyze.cjs --tree <id>                      # 单 tree
//   node tree-analyze.cjs --dimension security             # 仅 P0 安全事件
//   node tree-analyze.cjs --dimension timeline             # 仅 P1 时间线
//   node tree-analyze.cjs --since 2026-07-01               # call_log 时间过滤
//   node tree-analyze.cjs --workspace <dir>                # 自定义 trees 目录
//   node tree-analyze.cjs --json                           # 仅 JSON（默认 stdout=JSON + stderr=Markdown）

const fs = require('fs');
const path = require('path');

// 高危错误码白名单（安全事件核心，来自 V10 加固 + L2 根因A + B1/B2）
const HIGH_RISK_CODES = new Set([
  'E_BORROWED_IDENTITY', 'E_AUDITOR_NOT_INDEPENDENT', 'E_AUDIT_PREMATURE',
  'E_ALIGNMENT_NOT_VERIFIED', 'E_SELFCHECK_INVALID', 'E_TS_NOT_MONOTONIC',
  'E_SESSION_NOT_ALIVE', 'E_INVALID_UUID_STRICT', 'E_LEAF_AUTO_PRUNED',
]);

function parseArgs(argv) {
  const o = { workspace: 'C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees', tree: null, dimension: 'all', since: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') o.workspace = argv[++i];
    else if (argv[i] === '--tree') o.tree = argv[++i];
    else if (argv[i] === '--dimension') o.dimension = argv[++i];
    else if (argv[i] === '--since') o.since = argv[++i];
    else if (argv[i] === '--json') o.json = true;
  }
  return o;
}

function listTrees(treesDir, treeFilter) {
  if (treeFilter) return [treeFilter];
  return fs.readdirSync(treesDir).filter(d => { try { return fs.statSync(path.join(treesDir, d)).isDirectory(); } catch (_) { return false; } });
}

// 读 call-log.jsonl（含 .1/.2/.3 轮转，按 ts 排序）
function loadCallLog(treesDir, treeFilter, since) {
  const entries = [];
  const sinceMs = since ? Date.parse(since) : null;
  for (const t of listTrees(treesDir, treeFilter)) {
    const tdir = path.join(treesDir, t);
    const files = [];
    for (let i = 3; i >= 1; i--) { const f = path.join(tdir, `call-log.jsonl.${i}`); if (fs.existsSync(f)) files.push(f); }
    const cur = path.join(tdir, 'call-log.jsonl'); if (fs.existsSync(cur)) files.push(cur);
    for (const f of files) {
      let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (sinceMs && e.ts && Date.parse(e.ts) < sinceMs) continue;
          entries.push(e);
        } catch (_) {}
      }
    }
  }
  entries.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return entries;
}

// 读 tree-state 的 events / audit_log（业务事件流）
function loadTreeStateLogs(treesDir, treeFilter) {
  const out = [];
  for (const t of listTrees(treesDir, treeFilter)) {
    const sp = path.join(treesDir, t, 'tree-state.json');
    let j; try { j = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch (_) { continue; }
    for (const [lid, leaf] of Object.entries(j.leaves || {})) {
      for (const ev of (leaf.events || [])) out.push({ tree_id: t, leaf_id: lid, kind: 'event', ts: ev.ts, event_type: ev.type });
      for (const al of (leaf.audit_log || [])) out.push({ tree_id: t, leaf_id: lid, kind: 'audit', ts: al.ts, auditor: al.auditor_session_id, total: al.total, passed: al.passed, failed: al.failed });
    }
  }
  return out;
}

// P0 安全事件：被拦调用聚合 + 高危明细 + 归因
function analyzeSecurity(callLog) {
  const blocked = callLog.filter(e => e.ok === false);
  const total = callLog.length;
  const byCode = {};
  for (const e of blocked) {
    const c = e.error_code || 'E_UNKNOWN';
    if (!byCode[c]) byCode[c] = { count: 0, first_ts: e.ts, last_ts: e.ts, callers: {}, trees: {}, leaves: {} };
    const b = byCode[c];
    b.count++;
    if (e.ts && (!b.first_ts || e.ts < b.first_ts)) b.first_ts = e.ts;
    if (e.ts && (!b.last_ts || e.ts > b.last_ts)) b.last_ts = e.ts;
    const cs = e.caller_session_id || '<none>';
    b.callers[cs] = (b.callers[cs] || 0) + 1;
    if (e.tree_id) b.trees[e.tree_id] = (b.trees[e.tree_id] || 0) + 1;
    if (e.leaf_id && e.leaf_id !== '<in-json>') b.leaves[e.leaf_id] = (b.leaves[e.leaf_id] || 0) + 1;
  }
  const highRisk = blocked.filter(e => HIGH_RISK_CODES.has(e.error_code))
    .map(e => ({ ts: e.ts, tree_id: e.tree_id, leaf_id: e.leaf_id, caller_session_id: e.caller_session_id, cmd: e.cmd + (e.sub && e.sub !== e.cmd ? '/' + e.sub : ''), error_code: e.error_code, error_msg: e.error_msg, audit_session_id: e.args_digest && e.args_digest.audit_session_id }));
  const rank = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ id: k, count: v }));
  return {
    total_calls: total,
    total_blocked: blocked.length,
    block_rate: total ? +(blocked.length / total).toFixed(4) : 0,
    by_error_code: Object.fromEntries(Object.entries(byCode).map(([c, b]) => [c, { count: b.count, first_ts: b.first_ts, last_ts: b.last_ts, top_callers: rank(b.callers, 5), top_trees: rank(b.trees, 5), top_leaves: rank(b.leaves, 5) }])),
    high_risk_count: highRisk.length,
    high_risk_events: highRisk.slice(-50),
  };
}

// P1 执行时间线：call_log + events/audit 合并按 ts
function analyzeTimeline(callLog, stateLogs) {
  const merged = [];
  for (const e of callLog) merged.push({ src: 'call', ts: e.ts, tree_id: e.tree_id, leaf_id: e.leaf_id, desc: `${e.cmd}${e.sub && e.sub !== e.cmd ? '/' + e.sub : ''} ${e.ok ? '✓' : '✗ ' + (e.error_code || '')}`, ok: !!e.ok });
  for (const e of stateLogs) {
    const desc = e.kind === 'event' ? `event:${e.event_type || '?'}` : `audit ${e.passed}/${e.total}`;
    merged.push({ src: e.kind, ts: e.ts, tree_id: e.tree_id, leaf_id: e.leaf_id, desc, ok: e.kind === 'audit' ? (e.failed === 0) : true });
  }
  merged.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return { total_events: merged.length, timeline: merged.slice(-200) };
}

function mdSecurity(s) {
  const L = [`## P0 安全事件`, `- 总调用 ${s.total_calls}，被拦 ${s.total_blocked}（拦截率 ${(s.block_rate * 100).toFixed(1)}%）`, `- 高危事件 ${s.high_risk_count} 条`];
  const codes = Object.entries(s.by_error_code).sort((a, b) => b[1].count - a[1].count);
  if (codes.length) {
    L.push(`- 按错误码:`);
    for (const [c, b] of codes) {
      L.push(`  - ${HIGH_RISK_CODES.has(c) ? '🔴' : '⚠️'} \`${c}\`: ${b.count} 次（${(b.first_ts || '?').slice(0, 10)}→${(b.last_ts || '?').slice(0, 10)}）`);
      if (b.top_trees.length) L.push(`      trees: ${b.top_trees.map(x => `${x.id}×${x.count}`).join(', ')}`);
      if (b.top_leaves.length) L.push(`      leaves: ${b.top_leaves.map(x => `${x.id}×${x.count}`).join(', ')}`);
    }
  } else L.push(`- ✅ 无被拦调用`);
  if (s.high_risk_events.length) {
    L.push(`- 高危明细（最近 ${Math.min(s.high_risk_events.length, 10)} 条）:`);
    for (const e of s.high_risk_events.slice(-10)) L.push(`  - ${(e.ts || '?').slice(11, 19)} [${e.tree_id}/${e.leaf_id || '-'}] ${e.cmd} → ${e.error_code}${e.audit_session_id ? ' (auditor:' + String(e.audit_session_id).slice(0, 8) + ')' : ''}`);
  }
  return L.join('\n');
}
function mdTimeline(t) {
  const L = [`## P1 执行时间线（最近 ${Math.min(t.timeline.length, 40)} / ${t.total_events} 条）`];
  for (const e of t.timeline.slice(-40)) {
    const mark = e.src === 'call' ? (e.ok ? '·' : '✗') : (e.src === 'audit' ? '🛡' : '▸');
    L.push(`- ${mark} ${(e.ts || '?').slice(11, 19)} [${e.tree_id}/${e.leaf_id || '-'}] ${e.desc}`);
  }
  return L.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.workspace)) { console.error('ERROR: workspace 不存在: ' + opts.workspace); process.exit(1); }
  const callLog = loadCallLog(opts.workspace, opts.tree, opts.since);
  const stateLogs = (opts.dimension === 'all' || opts.dimension === 'timeline') ? loadTreeStateLogs(opts.workspace, opts.tree) : [];
  const report = { generated_at: new Date().toISOString(), opts: { workspace: opts.workspace, tree: opts.tree, dimension: opts.dimension, since: opts.since }, summary: { call_log_entries: callLog.length, state_log_entries: stateLogs.length }, dimensions: {} };
  if (opts.dimension === 'all' || opts.dimension === 'security') report.dimensions.security = analyzeSecurity(callLog);
  if (opts.dimension === 'all' || opts.dimension === 'timeline') report.dimensions.timeline = analyzeTimeline(callLog, stateLogs);

  if (opts.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(JSON.stringify(report, null, 2));  // stdout = JSON（机器可读）
  console.error('# Tree Analysis Report');
  console.error(`> workspace: ${opts.workspace} | tree: ${opts.tree || 'ALL'} | since: ${opts.since || '-'} | call_log: ${callLog.length} 条\n`);
  if (report.dimensions.security) console.error(mdSecurity(report.dimensions.security) + '\n');
  if (report.dimensions.timeline) console.error(mdTimeline(report.dimensions.timeline));
}
main();
