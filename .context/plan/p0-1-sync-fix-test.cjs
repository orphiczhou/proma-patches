#!/usr/bin/env node
/**
 * p0-1-sync-fix-test.cjs — P0-1 done event 自动同步 status 漏洞验证 (2026-07-04)
 *
 * 上游报告 P0-1 (tree-harness-midterm-review.md §二):
 *   cmdEventAppend line 1945-1953 写 done event 时自动 leaf.status='done',
 *   架空 cmdLeafSetStatus 的 8 道 done 门禁 (milestones/audit_pass/expect_outputs/
 *   deliverables/brief_echo+done/review_round/audit_gate/children).
 *
 * 本脚本实证:
 *   A. 修复前: 空 leaf (无任何 done 前置) 调 event append done → status 被自动改成 done (漏洞)
 *      修复后: status 保持 active (门禁刚性恢复)
 *   B. 空 leaf 调 set-status done → 必须被门禁拦 (E_SCHEMA_INVALID: milestones non-empty)
 *      (这条无论修复前后都应拦, 但修复前 worker 根本不必走这条路径 —— event append done 已绕过)
 *   C. 合规中间态 (done event 已写, status=active) 跑 validate:
 *      修复前: 若仅删 line 1952, collectValidateIssues 会误报 status_event_mismatch
 *      修复后(连带改): 不误报, 中间态合法
 *      修复后(未连带改): 误报 → 本脚本据此判断 collectValidateIssues 是否需连带调整
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'p01-sync-'));
engine.setTreesRoot(SANDBOX);
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid));

const UUID_ROOT = '00000000-0000-0000-0000-000000000001';
const UUID_WORKER = '00000000-0000-0000-0000-000000000002';

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function info(name, val) { console.log(`  \x1b[36mℹ\x1b[0m ${name}: ${val}`); }

async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  return { ok: !!out.ok, error: out.error || null, result: out };
}

function readLeafStatus(tree_id, leaf_id) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  return state.leaves[leaf_id] ? state.leaves[leaf_id].status : '(missing)';
}

async function main() {
  console.log('============================================================');
  console.log('P0-1 done event 自动同步 status 漏洞验证');
  console.log('引擎: ' + ENGINE_PATH);
  console.log('沙箱: ' + SANDBOX);
  console.log('============================================================');

  // --- 场景 A: 空 leaf 调 event append done, 看 status 是否被自动改 ---
  console.log('\n[A] 空 leaf (无 milestone/audit_gate/deliverable) 调 event append done');
  const tidA = 'p01a';
  await run(['init', tidA,
    '--root-brief', JSON.stringify({ parent_intent: 'p0-1 test A' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID_ROOT, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  const workerA = `${tidA}-W1-worker`;
  await run(['leaf', 'add', tidA, '--json', JSON.stringify({
    leaf_id: workerA, session_id: UUID_WORKER, parent: `${tidA}-root`, path: 'W1',
    role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID_ROOT,
  })]);
  const beforeA = readLeafStatus(tidA, workerA);
  info('event append done 前 status', beforeA);
  // worker 直接写 done event, 不配任何门禁前置
  const rEv = await run(['event', 'append', tidA, workerA, '--type', 'done', '--json',
    JSON.stringify({ self_check: [{ item: 'fake_done', pass: true, evidence: 'no gate checks done' }] })]);
  if (!rEv.ok) { fail('event append done 命令成功', rEv.error && rEv.error.code + ': ' + (rEv.error.msg || '').slice(0, 120)); }
  const afterA = readLeafStatus(tidA, workerA);
  info('event append done 后 status', afterA);

  if (afterA === 'done') {
    // 漏洞存在: done event 自动转 status=done, 绕过全部门禁
    fail('A2 status 未被自动改成 done (门禁刚性)', `实际 status="${afterA}" —— P0-1 漏洞存在: done event 绕过 8 道门禁`);
  } else {
    pass('A2 status 未被自动改成 done (门禁刚性)', `status="${afterA}" —— P0-1 已修复, done event 不再同步 status`);
  }

  // --- 场景 B: 空 leaf 直接调 set-status done, 应被门禁拦 ---
  console.log('\n[B] 空 leaf 调 set-status done → 门禁必须拦截');
  const tidB = 'p01b';
  await run(['init', tidB,
    '--root-brief', JSON.stringify({ parent_intent: 'p0-1 test B' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID_ROOT, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  const workerB = `${tidB}-W1-worker`;
  await run(['leaf', 'add', tidB, '--json', JSON.stringify({
    leaf_id: workerB, session_id: UUID_WORKER, parent: `${tidB}-root`, path: 'W1',
    role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID_ROOT,
  })]);
  const rSet = await run(['leaf', 'set-status', tidB, workerB, 'done']);
  if (!rSet.ok && rSet.error && /milestones|E_SCHEMA_INVALID/.test(rSet.error.code + rSet.error.msg)) {
    pass('B 空 leaf set-status done 被门禁拦', rSet.error.code);
  } else {
    fail('B 空 leaf set-status done 被门禁拦', rSet.ok ? '竟然成功了 (门禁失效)' : `错误码不符: ${rSet.error && rSet.error.code}`);
  }

  // --- 场景 C: 合规中间态 (done event 已写, status=active) 跑 validate ---
  console.log('\n[C] 合规中间态 (done event 已写, status=active) validate 检测');
  // 复用 tidA 的 workerA: 它已有 done event, status=active (修复后) 或 done (修复前)
  const rVal = await run(['validate', tidA]);
  const issues = (rVal.result && rVal.result.issues) || [];
  const mismatchIssues = issues.filter((i) => i.type === 'status_event_mismatch');
  info('validate issues 总数', issues.length);
  info('status_event_mismatch 条数', mismatchIssues.length);
  if (mismatchIssues.length > 0) {
    info('mismatch 详情', mismatchIssues[0].detail.slice(0, 120));
  }
  // 判定逻辑:
  //   - 修复前 (P0-1 同步生效): workerA status=done, 不会有 mismatch
  //   - 仅删 line 1952 (未连带改 collectValidateIssues): workerA status=active + 有 done event → mismatch 误报
  //   - 删 line 1952 + 连带改 collectValidateIssues: workerA 合规中间态, 无 mismatch
  const statusA_for_C = readLeafStatus(tidA, workerA);
  if (statusA_for_C !== 'done') {
    // 修复后场景: status≠done + 有 done event = 合规中间态, 不应报 mismatch
    if (mismatchIssues.length === 0) {
      pass('C 合规中间态无误报 status_event_mismatch', `status="${statusA_for_C}" + done event, validate 无 mismatch`);
    } else {
      fail('C 合规中间态无误报 status_event_mismatch', `误报 ${mismatchIssues.length} 条 —— 需连带调整 collectValidateIssues`);
    }
  } else {
    // 修复前场景 (status=done): 此项不适用, 跳过判定
    info('C 判定', `status="done" (P0-1 未修复, 修复后再判)`);
  }

  // --- 场景 D: 端到端合规路径 (配齐门禁前置 → done event → set-status done 成功) ---
  console.log('\n[D] 端到端合规路径: 配齐门禁 → done event → set-status done 应成功');
  // 内联最小合规 setup (仿 ISS-003 setupTreeWithAuditor 的 3-leaf 互背书终态, 独立沙箱)
  const tidD = 'p01d';
  await run(['init', tidD,
    '--root-brief', JSON.stringify({ parent_intent: 'p0-1 test D' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID_ROOT, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  // 用 tamperLeaf 给 root 直接置 done (绕过门禁, 仅当测试脚手架, 不影响本场景验证)
  const UUID_AUD = '00000000-0000-0000-0000-000000000003';
  const rootD = `${tidD}-root`;
  const audD = `${tidD}-Aud-commander`;
  const othD = `${tidD}-Oth-commander`;
  await run(['leaf', 'add', tidD, '--json', JSON.stringify({ leaf_id: audD, session_id: UUID_AUD, parent: rootD, path: 'Aud', role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID_ROOT })]);
  const UUID_OTH = '00000000-0000-0000-0000-000000000004';
  await run(['leaf', 'add', tidD, '--json', JSON.stringify({ leaf_id: othD, session_id: UUID_OTH, parent: rootD, path: 'Oth', role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID_ROOT })]);
  const tsD = '2026-07-04T00:00:00Z';
  const tamper = (lid, fn) => {
    const sp = path.join(SANDBOX, tidD, 'tree-state.json');
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    fn(s.leaves[lid]);
    fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  };
  tamper(rootD, (l) => { l.status = 'done'; l.events = [{ type: 'done', ts: tsD, meta: { self_check: [{ item: 'root', pass: true, evidence: 'init' }] } }]; l.audit_gate = { verdict: 'pass', auditor_session_id: UUID_AUD, ts: tsD }; l.last_event_ts = tsD; l.last_event_type = 'done'; });
  tamper(audD, (l) => { l.status = 'done'; l.events = [{ type: 'done', ts: tsD, meta: { self_check: [{ item: 'aud', pass: true, evidence: 'init' }] } }]; l.audit_gate = { verdict: 'pass', auditor_session_id: UUID_OTH, ts: tsD }; l.last_event_ts = tsD; l.last_event_type = 'done'; });
  tamper(othD, (l) => { l.status = 'done'; l.events = [{ type: 'done', ts: tsD, meta: { self_check: [{ item: 'oth', pass: true, evidence: 'init' }] } }]; l.audit_gate = { verdict: 'pass', auditor_session_id: UUID_AUD, ts: tsD }; l.last_event_ts = tsD; l.last_event_type = 'done'; });

  const workerD = `${tidD}-W1-worker`;
  await run(['leaf', 'add', tidD, '--json', JSON.stringify({ leaf_id: workerD, session_id: UUID_WORKER, parent: rootD, path: 'W1', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID_ROOT })]);
  // 配齐 done 门禁前置: deliverable 文件 + milestone(audit_pass) + brief_echo + done event + audit_gate pass
  const delDir = path.join(SANDBOX, tidD, 'deliverables');
  fs.mkdirSync(delDir, { recursive: true });
  fs.writeFileSync(path.join(delDir, 'out.md'), 'content\n');
  await run(['milestone', 'add', tidD, workerD, '--json', JSON.stringify({ id: 'M1', desc: 'd', expect_outputs: ['out.md'] })]);
  await run(['milestone', 'set-result', tidD, workerD, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID_AUD]);
  await run(['event', 'append', tidD, workerD, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID_AUD })]);
  // 关键: done event 写完后, status 应仍是 pending_brief (P0-1 修复后)
  const statusAfterDoneEvt = readLeafStatus(tidD, workerD);
  info('D done event 后 status (应非 done)', statusAfterDoneEvt);
  await run(['event', 'append', tidD, workerD, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'work', pass: true, evidence: 'all gates passed legitimately' }] })]);
  const statusAfterDoneEvt2 = readLeafStatus(tidD, workerD);
  info('D done event 后 status (再次确认)', statusAfterDoneEvt2);
  await run(['audit', 'gate', tidD, workerD, '--verdict', 'pass', '--audit-session-id', UUID_AUD]);
  // 走 cmdLeafSetStatus done —— 应成功 (合规路径畅通)
  const rDone = await run(['leaf', 'set-status', tidD, workerD, 'done']);
  if (rDone.ok && readLeafStatus(tidD, workerD) === 'done') {
    pass('D 合规路径 set-status done 成功', '门禁前置配齐后 done 达成, 路径畅通');
  } else {
    fail('D 合规路径 set-status done 成功', rDone.error ? rDone.error.code + ': ' + (rDone.error.msg || '').slice(0, 100) : '未知失败');
  }

  // 清理
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}

  console.log('\n------------------------------------------------------------');
  console.log(`\x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m`);
  console.log('------------------------------------------------------------');
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
