#!/usr/bin/env node
/**
 * tree-state 聚合产品指标 — success-metrics §六补采
 *
 * 定位：**过程指标**（success-metrics 拆两档：过程指标单边可采 vs 终验指标外部）。
 * 本脚本单边可跑（研究者 n=1 自用数据），不依赖团队试用/对照实验/PR 合并。
 *
 * 扫描 pro / release / stable 三实例 userData 下所有 tree-state.json，聚合：
 *   1. 建树完成率（root done / 总树）        — success-metrics B「可靠」
 *   2. 拦截率（audit_gate block / flagged / E_MAX_SESSIONS / 真实 nudge 违规）
 *   3. 成本分布（session 数 / leaf 数 / node_budget 占用 / nudge_log 膨胀检测）
 *
 * 只读分析工具，零引擎改动。健壮处理：leaves 是 map（非数组）、events 在 leaf 内、
 * 老树无 session_registry（distinct session 回退）、不同 version、_archive 子目录。
 *
 * 用法：
 *   node aggregate-metrics.cjs                 # 默认扫三实例，打印 summary
 *   node aggregate-metrics.cjs --json          # 仅输出 JSON（机器消费）
 *   node aggregate-metrics.cjs --out report.json   # 落盘 JSON
 *   PROMA_INSTANCE=pro node aggregate-metrics.cjs  # 限定单实例
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 1. 发现所有 tree-state.json ----
const INSTANCE_ROOTS = [
  { name: 'pro',     base: path.join(os.homedir(), '.proma-dev') },
  { name: 'release', base: path.join(os.homedir(), '.proma-release') },
  { name: 'stable',  base: path.join(os.homedir(), '.proma') },
];

function findTreeStates(base) {
  const out = [];
  if (!fs.existsSync(base)) return out;
  function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === 'tree-state.json') {
        out.push(full);
        continue; // 树目录内可能含 .bak，不再下钻
      }
      if (e.isDirectory()) walk(full);
    }
  }
  walk(base);
  return out;
}

// ---- 2. 单树分析 ----
// 成本失控检测阈值（macp2b 实测 nudge_log=15052；正常树 <10）
const NUDGE_INFLATION_THRESHOLD = 200;
const SESSION_INFLATION_THRESHOLD = 50; // = max_sessions 默认值

function analyzeTree(filePath, instance) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { error: 'parse-failed: ' + e.message, path: filePath, instance };
  }

  const leaves = (raw.leaves && typeof raw.leaves === 'object')
    ? Object.values(raw.leaves) : [];
  const treeId = raw.tree_id || path.basename(path.dirname(filePath));
  const isArchive = /[/\\]_archive[/\\]/.test(filePath);

  // status 分布 + root
  const statusCount = {};
  for (const l of leaves) statusCount[l.status] = (statusCount[l.status] || 0) + 1;
  const rootLeaf = leaves.find(l => l.role === 'root');
  const rootDone = !!(rootLeaf && rootLeaf.status === 'done');
  const doneLeaves = statusCount.done || 0;

  // events（在 leaf 内）+ 拦截信号
  const eventTypeCount = {};
  let totalEvents = 0, flaggedCount = 0, maxSessionsHits = 0;
  for (const l of leaves) {
    for (const e of (l.events || [])) {
      eventTypeCount[e.type] = (eventTypeCount[e.type] || 0) + 1;
      totalEvents++;
      if (e.type === 'flagged') flaggedCount++;
      // E_MAX_SESSIONS 可能在 event meta / 文本
      const blob = JSON.stringify(e);
      if (blob.includes('E_MAX_SESSIONS') || blob.includes('MAX_SESSIONS')) maxSessionsHits++;
    }
  }

  // audit_gate verdict 分布 + 拦下数
  const gateVerdictCount = {};
  let gateBlocked = 0; // 被审计门拦下（block，或 required 但未 done）
  for (const l of leaves) {
    const g = l.audit_gate;
    if (g && g.verdict) {
      gateVerdictCount[g.verdict] = (gateVerdictCount[g.verdict] || 0) + 1;
      if (g.verdict === 'block') gateBlocked++;
      else if (g.verdict === 'required' && l.status !== 'done') gateBlocked++;
    }
  }

  // nudge_log（TAO watcher 违规）+ audit_log
  let nudgeTotal = 0, auditLogTotal = 0;
  for (const l of leaves) {
    nudgeTotal += Array.isArray(l.nudge_log) ? l.nudge_log.length : 0;
    auditLogTotal += Array.isArray(l.audit_log) ? l.audit_log.length : 0;
  }

  // session 成本（registry 优先，老树 distinct 回退）
  let sessionCount;
  let sessionSource;
  if (raw.session_registry && typeof raw.session_registry === 'object') {
    sessionCount = Object.keys(raw.session_registry).length;
    sessionSource = 'session_registry';
  } else {
    const set = new Set();
    for (const l of leaves) if (l.session_id) set.add(l.session_id);
    sessionCount = set.size;
    sessionSource = 'distinct-leaf-session (fallback)';
  }

  const meta = raw.audit_meta || {};
  const maxSessions = meta.max_sessions != null ? meta.max_sessions : null;
  const nodeBudget = meta.node_budget != null ? meta.node_budget : null;
  const maxSpawn = meta.max_subagent_spawn_per_leaf != null ? meta.max_subagent_spawn_per_leaf : null;

  // 失控信号
  const nudgeInflated = nudgeTotal > NUDGE_INFLATION_THRESHOLD;
  const sessionInflated = sessionCount > SESSION_INFLATION_THRESHOLD;
  const budgetUsed = nodeBudget != null ? leaves.length / nodeBudget : null;

  return {
    treeId, instance, path: filePath, isArchive, version: raw.version,
    createdAt: raw.created_at,
    leafCount: leaves.length,
    statusCount, rootDone, doneLeaves,
    totalEvents, eventTypeCount, flaggedCount, maxSessionsHits,
    gateVerdictCount, gateBlocked,
    nudgeTotal, auditLogTotal,
    sessionCount, sessionSource, maxSessions, nodeBudget, maxSpawn,
    budgetUsed, // leaf / node_budget 占用比
    flags: { nudgeInflated, sessionInflated },
  };
}

// ---- 3. 全局聚合 ----
// 同一 tree_id 常跨 workspace 副本重复（default + undefined + workspace-files 各一份）。
// 去重：按 treeId 保留最完整副本（leafCount*1000 + events 打分），每树只计一次。
function dedupeByTreeId(trees) {
  const best = {};
  for (const t of trees) {
    if (t.error) continue;
    const score = t.leafCount * 1000 + t.totalEvents;
    if (!best[t.treeId] || score > best[t.treeId]._score) {
      best[t.treeId] = Object.assign({}, t, { _score: score });
    }
  }
  return Object.values(best).map(t => { delete t._score; return t; });
}

function aggregate(trees, opts) {
  opts = opts || {};
  const fileCount = trees.length;
  let live = trees.filter(t => !t.error && !t.isArchive);
  const archived = trees.filter(t => !t.error && t.isArchive);
  const errors = trees.filter(t => t.error);
  let dedupInfo = null;
  if (opts.dedup !== false) {
    const before = live.length;
    live = dedupeByTreeId(live);
    dedupInfo = { beforeFileCount: before, afterUniqueTrees: live.length, removedDuplicates: before - live.length };
  }

  const totalLive = live.length;
  const completed = live.filter(t => t.rootDone).length;
  const completionRate = totalLive ? completed / totalLive : null;

  // 拦截：任一拦截信号（gateBlocked / flagged / maxSessionsHits）
  const intercepted = live.filter(t => t.gateBlocked > 0 || t.flaggedCount > 0 || t.maxSessionsHits > 0);
  const interceptionRate = totalLive ? intercepted.length / totalLive : null;

  // 成本分布
  const sessions = live.map(t => t.sessionCount).filter(n => typeof n === 'number');
  const leaves = live.map(t => t.leafCount).filter(n => typeof n === 'number');
  const stat = arr => arr.length ? {
    n: arr.length, min: Math.min(...arr), max: Math.max(...arr),
    mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
    median: arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)],
  } : null;

  // 失控树（macp2 型）
  const inflated = live.filter(t => t.flags.nudgeInflated || t.flags.sessionInflated);

  // 按实例分组
  const byInstance = {};
  for (const inst of INSTANCE_ROOTS) {
    const sub = live.filter(t => t.instance === inst.name);
    if (!sub.length) continue;
    byInstance[inst.name] = {
      trees: sub.length,
      completed: sub.filter(t => t.rootDone).length,
      completionRate: +(sub.filter(t => t.rootDone).length / sub.length).toFixed(3),
      intercepted: sub.filter(t => t.gateBlocked > 0 || t.flaggedCount > 0 || t.maxSessionsHits > 0).length,
      totalSessions: sub.reduce((a, t) => a + t.sessionCount, 0),
      totalLeaves: sub.reduce((a, t) => a + t.leafCount, 0),
    };
  }

  return {
    summary: {
      scannedFiles: fileCount, dedup: dedupInfo,
      parseErrors: errors.length,
      liveTrees: totalLive, archivedTrees: archived.length,
      completionRate: completionRate != null ? +completionRate.toFixed(3) : null,
      completion: { completed, total: totalLive },
      interceptionRate: interceptionRate != null ? +interceptionRate.toFixed(3) : null,
      interception: { interceptedTrees: intercepted.length, total: totalLive },
      flaggedEventsTotal: live.reduce((a, t) => a + t.flaggedCount, 0),
      gatesBlockedTotal: live.reduce((a, t) => a + t.gateBlocked, 0),
      maxSessionHitsTotal: live.reduce((a, t) => a + t.maxSessionsHits, 0),
      nudgeTotal: live.reduce((a, t) => a + t.nudgeTotal, 0),
      auditLogTotal: live.reduce((a, t) => a + t.auditLogTotal, 0),
      costControl: {
        inflatedTrees: inflated.length, // 反指标：应=0（success-metrics B「成本爆炸次数」）
        inflatedTreeIds: inflated.map(t => ({ treeId: t.treeId, nudge: t.nudgeTotal, session: t.sessionCount, reason: [t.flags.nudgeInflated && 'nudge', t.flags.sessionInflated && 'session'].filter(Boolean) })),
        sessionDist: stat(sessions),
        leafDist: stat(leaves),
      },
      byInstance,
    },
    trees: live, // 每树明细
    archived: archived.map(t => ({ treeId: t.treeId, instance: t.instance })),
    errors: errors,
  };
}

// ---- 4. 人类可读 summary ----
function pct(x) { return x == null ? 'N/A' : (x * 100).toFixed(1) + '%'; }

function printSummary(report) {
  const s = report.summary;
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' tree-harness 产品指标聚合（过程指标 · 研究者 n=1 自用）');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`扫描文件: ${s.scannedFiles}（解析失败 ${s.parseErrors}） | 活树 ${s.liveTrees}（唯一 tree_id${s.dedup ? `，去重 ${s.dedup.removedDuplicates} 副本` : '，未去重'}）+ 归档 ${s.archivedTrees}`);
  console.log('');
  console.log('【可靠】建树完成率（root done / 活树）');
  console.log(`  ${s.completion.completed}/${s.completion.total} = ${pct(s.completionRate)}  (目标 ≥ 80%)`);
  console.log('');
  console.log('【质量】拦截信号（任一：audit_gate block / flagged / E_MAX_SESSIONS）');
  console.log(`  涉及树: ${s.interception.interceptedTrees}/${s.interception.total} = ${pct(s.interceptionRate)}`);
  console.log(`  明细: gate 拦下 ${s.gatesBlockedTotal} | flagged 事件 ${s.flaggedEventsTotal} | E_MAX_SESSIONS 命中 ${s.maxSessionHitsTotal}`);
  console.log(`  TAO 违规 nudge 总计 ${s.nudgeTotal} | audit_log 条目总计 ${s.auditLogTotal}`);
  console.log('');
  console.log('【成本】成本分布 + 失控检测（反指标：inflatedTrees 应=0）');
  console.log(`  失控树（macp2 型）: ${s.costControl.inflatedTrees}`);
  if (s.costControl.inflatedTrees) {
    for (const t of s.costControl.inflatedTreeIds) {
      console.log(`    ⚠ ${t.treeId}: nudge=${t.nudge} session=${t.session} reason=${t.reason.join('+')}`);
    }
  }
  if (s.costControl.sessionDist) {
    const d = s.costControl.sessionDist;
    console.log(`  session 数: n=${d.n} min=${d.min} max=${d.max} mean=${d.mean} median=${d.median}`);
  }
  if (s.costControl.leafDist) {
    const d = s.costControl.leafDist;
    console.log(`  leaf 数:   n=${d.n} min=${d.min} max=${d.max} mean=${d.mean} median=${d.median}`);
  }
  console.log('');
  console.log('【按实例】');
  for (const [inst, d] of Object.entries(s.byInstance)) {
    console.log(`  ${inst}: ${d.trees} 树（完成 ${d.completed}=${pct(d.completionRate)}，拦截 ${d.intercepted}）| ${d.totalSessions} session / ${d.totalLeaves} leaf`);
  }
  console.log('');
  // 未完成树清单（gap 诊断）
  const incomplete = report.trees.filter(t => !t.rootDone && t.leafCount > 1);
  if (incomplete.length) {
    console.log('【gap 诊断】未完成（root 非 done 且 >1 leaf）的活树:');
    for (const t of incomplete.slice(0, 12)) {
      console.log(`  - ${t.treeId} [${t.instance}] leaves=${t.leafCount} status=${JSON.stringify(t.statusCount)} events=${t.totalEvents} gate=${JSON.stringify(t.gateVerdictCount)}`);
    }
    if (incomplete.length > 12) console.log(`  ... 还有 ${incomplete.length - 12} 棵`);
  }
  console.log('═══════════════════════════════════════════════════════════');
}

// ---- 5. main ----
function main() {
  const argv = process.argv.slice(2);
  const jsonOnly = argv.includes('--json');
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;
  const instFilter = process.env.PROMA_INSTANCE;

  const roots = instFilter
    ? INSTANCE_ROOTS.filter(r => r.name === instFilter)
    : INSTANCE_ROOTS;

  const allTrees = [];
  for (const r of roots) {
    const files = findTreeStates(r.base);
    for (const f of files) allTrees.push(analyzeTree(f, r.name));
  }

  const report = aggregate(allTrees, { dedup: !argv.includes('--no-dedup') });

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
    process.stderr.write(`[written] ${outFile}\n`);
  }
  if (jsonOnly) {
    process.stdout.write(JSON.stringify(report.summary, null, 2) + '\n');
  } else {
    printSummary(report);
  }
}

main();
