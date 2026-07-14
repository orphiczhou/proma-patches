#!/usr/bin/env node
/**
 * sync-doc-md5.cjs — 文档行数同步 + md5 现状报告（Sprint 3 D 收尾，2026-07-14）
 *
 * 设计教训（本次事故）：md5 散落在 CLAUDE/API/... 且同时出现在"权威源行"和"历史快照行"（如
 *   CLAUDE.md L56 的 BUG-2 修复时 md5 快照），盲替会把历史快照也改成当前值 → 失真。故本脚本
 *   **只自动同步行数**（机械、安全，wc -l 约定），**md5 仅报告当前权威值不自动替换**（人工判断
 *   哪些是权威行 vs 历史快照）。这落实了 note.md「md5 反复同步是坏实践 → 归 backlog 自动化」的
 *   审慎结论：能自动化的（行数）自动化，不能安全自动化的（md5 上下文判断）留人工。
 *
 * 用法：
 *   node .context/sync-doc-md5.cjs            # 同步行数 + 打印 md5 现状
 *   node .context/sync-doc-md5.cjs --check     # 只报告差异不改
 *   node .context/sync-doc-md5.cjs --report-md5 # 只打印当前权威 md5（供人工填）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = 'D:/codes/tree-harness';
const ENGINE = path.join(ROOT, 'tree-engine.cjs');
const PATCHES = path.join(ROOT, 'proma-dev-patches.cjs');

function md5of(p) {
  // Git Bash md5sum 偶发前导 '\'；strip 之。取第一个 token。
  const out = String(execSync('md5sum "' + p.replace(/\//g, '/') + '"'));
  return out.trim().split(/\s+/)[0].replace(/^\\+/, '');
}
function linesof(p) {
  // 用 wc -l 约定（末尾换行不计），与文档既有数字一致；split('\n') 会多 1。
  return parseInt(String(execSync('wc -l "' + p.replace(/\//g, '/') + '"')).trim().split(/\s+/)[0], 10);
}

const ENG_MD5 = md5of(ENGINE);
const ENG_LINES = linesof(ENGINE);
const PATCH_MD5 = md5of(PATCHES);
const PATCH_LINES = linesof(PATCHES);

if (process.argv.includes('--report-md5')) {
  console.log(`engine md5=${ENG_MD5} 行=${ENG_LINES}`);
  console.log(`patches md5=${PATCH_MD5} 行=${PATCH_LINES}`);
  process.exit(0);
}

console.log(`权威源: engine md5=${ENG_MD5} 行=${ENG_LINES} | patches md5=${PATCH_MD5} 行=${PATCH_LINES}`);
console.log(`（md5 仅报告不自动替换；行数自动同步 "数字 行" 模式）\n`);

const DOCS = ['CLAUDE.md', 'API.md', 'ARCHITECTURE.md', 'README.md', 'ERROR-CODES.md'];
const checkOnly = process.argv.includes('--check');

// 已知历史行数（engine / patches）→ 当前权威值。新增历史行数时往这里加。
//   只替换 "数字 行" 模式，避免误伤其它数字。
const ENG_OLD_LINES = ['4961', '4941', '4928', '4895', '3602', '3565'];
const PATCH_OLD_LINES = ['3129', '2658', '2532'];

let totalChanges = 0;
for (const doc of DOCS) {
  const fp = path.join(ROOT, doc);
  if (!fs.existsSync(fp)) { console.log('  跳过(不存在): ' + doc); continue; }
  let s = fs.readFileSync(fp, 'utf8');
  const before = s;
  for (const old of ENG_OLD_LINES) { if (old === String(ENG_LINES)) continue; s = s.replace(new RegExp(old + ' 行', 'g'), ENG_LINES + ' 行'); }
  for (const old of PATCH_OLD_LINES) { if (old === String(PATCH_LINES)) continue; s = s.replace(new RegExp(old + ' 行', 'g'), PATCH_LINES + ' 行'); }
  if (s !== before) {
    totalChanges++;
    console.log('  更新行数: ' + doc);
    if (!checkOnly) fs.writeFileSync(fp, s);
  } else {
    console.log('  行数已同步: ' + doc);
  }
}
console.log(checkOnly ? '[--check] 需更新行数的文档数: ' + totalChanges : '完成，更新 ' + totalChanges + ' 个文档的行数');
console.log('\n⚠️ md5 请人工核对权威行（CLAUDE L7/L8/L32/L48、ERROR-CODES L11、API L5）：');
console.log('   engine → ' + ENG_MD5 + ' | patches → ' + PATCH_MD5);
console.log('   历史快照行（dated 条目、BUG 修复时 md5）保持原值，勿改。');
