#!/usr/bin/env node
// nudge-cleanup.cjs — TAO nudge 历史垃圾清理（Layer B / B3，2026-07-03）
//
// 清理 tree-state.json 中失控累积的 nudge_log + 重置 nudge_count。
// 失守根因: B9 修复前 + 失效期累积（proma workspace ~11 万条，l1fix_v2-C1 nudge_count=2810）。
//
// 安全:
//   - 默认 --dry-run，只出报告不落盘
//   - 落盘前原子备份（*.bak-<date>-pre-nudge-cleanup）
//   - 只动 leaf.nudge_log / leaf.nudge_count，绝不碰 events/audit_log/drift_*/milestones/status/segment_chain
//   - 幂等：再跑同参数 total_removed=0
//   - 原子写：write .tmp → rename，规避半截写
//
// 用法:
//   node nudge-cleanup.cjs                                   # 默认 proma workspace, dry-run
//   node nudge-cleanup.cjs --no-dry-run                      # 实跑（落盘）
//   node nudge-cleanup.cjs --workspace <dir> --threshold 10 --keep 3
//   node nudge-cleanup.cjs --no-backup                       # 跳过备份（不建议）
//
// 注意: 落盘时确保无其他进程在写 tree-state.json（关 Proma 或 TAO 停用时）。TAO 已 active=false。

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const opts = {
    workspace: 'C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees',
    threshold: 7,    // nudge_count > threshold 才清理（对齐 7-strike）
    keep: 5,         // 保留最近 N 条 nudge_log 作历史样本
    dryRun: true,    // 默认只出报告
    backup: true,    // 默认备份
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace') opts.workspace = argv[++i];
    else if (a === '--threshold') opts.threshold = parseInt(argv[++i], 10);
    else if (a === '--keep') opts.keep = parseInt(argv[++i], 10);
    else if (a === '--no-dry-run') opts.dryRun = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-backup') opts.backup = false;
    else if (a === '-h' || a === '--help') {
      console.log('用法: node nudge-cleanup.cjs [--workspace <dir>] [--threshold N] [--keep N] [--no-dry-run] [--no-backup]');
      process.exit(0);
    }
  }
  opts.stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return opts;
}

function cleanupTree(tsPath, opts) {
  const treeDir = path.basename(path.dirname(tsPath));
  const raw = fs.readFileSync(tsPath, 'utf8');
  const j = JSON.parse(raw);
  const report = { tree: treeDir, leaves_touched: 0, nudge_log_removed: 0, leaf_details: [] };
  let touched = 0;

  for (const [lid, leaf] of Object.entries(j.leaves || {})) {
    if (!leaf || typeof leaf !== 'object') continue;
    if (typeof leaf.nudge_count !== 'number') leaf.nudge_count = 0;
    if (!Array.isArray(leaf.nudge_log)) leaf.nudge_log = [];
    if (leaf.nudge_count <= opts.threshold) continue;   // 阈值以下不动

    const beforeLog = leaf.nudge_log.length;
    const beforeCount = leaf.nudge_count;
    const kept = leaf.nudge_log.slice(-opts.keep);        // 保留最近 N 条
    const removed = beforeLog - kept.length;

    leaf.nudge_log = kept;
    leaf.nudge_count = kept.length;                       // count = log.length 语义自洽

    touched++;
    report.nudge_log_removed += removed;
    report.leaf_details.push({
      leaf_id: lid,
      status: leaf.status || '?',
      before_count: beforeCount, after_count: leaf.nudge_count,
      before_log: beforeLog, after_log: kept.length,
    });
  }

  report.leaves_touched = touched;
  if (touched === 0) { report.skipped = true; return report; }

  if (!opts.dryRun) {
    if (opts.backup) {
      const bak = tsPath + '.bak-' + opts.stamp + '-pre-nudge-cleanup';
      fs.copyFileSync(tsPath, bak);                        // 先备份（原子 copy）
      report.backup = bak;
    }
    // 原子写：write .tmp → rename（Windows 需先 unlink 目标）
    const tmp = tsPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
    try { fs.unlinkSync(tsPath); } catch (_) {}
    fs.renameSync(tmp, tsPath);
    report.written = true;
  }
  return report;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.workspace)) {
    console.error('ERROR: workspace 目录不存在: ' + opts.workspace);
    process.exit(1);
  }
  const reports = [];
  for (const entry of fs.readdirSync(opts.workspace)) {
    const tsPath = path.join(opts.workspace, entry, 'tree-state.json');
    if (!fs.existsSync(tsPath)) continue;
    try { reports.push(cleanupTree(tsPath, opts)); }
    catch (e) { reports.push({ tree: entry, error: e.message }); }
  }
  const totalRemoved = reports.reduce((a, r) => a + (r.nudge_log_removed || 0), 0);
  const treesTouched = reports.filter(r => r.leaves_touched > 0).length;
  const summary = {
    mode: opts.dryRun ? 'DRY-RUN (未落盘 — 加 --no-dry-run 实跑)' : 'WRITE (已落盘)',
    workspace: opts.workspace,
    threshold: opts.threshold,
    keep: opts.keep,
    backup: opts.backup,
    total_removed: totalRemoved,
    trees_touched: treesTouched,
    trees_scanned: reports.length,
  };
  console.log(JSON.stringify({ summary, reports }, null, 2));
}
main();
