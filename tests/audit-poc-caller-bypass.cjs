/**
 * P0-1 独立审计 PoC：CLI 兼容通道关闭攻击实测
 *
 * 攻击者模型（D6-F1）：攻击者 require('tree-engine.cjs') 后直接 engine.run，
 *   不传 callerSessionId（模拟 CLI 退化通道），尝试伪造 worker done 闭环。
 *
 * 期望（生产模式，无 TREE_ENGINE_ALLOW_CLI）：
 *   - done 闭环三步（event append done / audit_gate pass / leaf set-status done）全拦
 *   - 伪造 caller（≠owner/creator）也被 E_BORROWED_IDENTITY 拦
 *   - TREE_ENGINE_ALLOW_CLI=1 放行 caller 校验（但其他门禁仍生效）
 *   - 范围探测：drift/segment 等无 caller-binding 的写操作 CLI 可写（P0-1 范围外）
 *
 * 用法：node tests/audit-poc-caller-bypass.cjs
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// 确保生产模式
delete process.env.TREE_ENGINE_ALLOW_CLI;

const engine = require('../tree-engine.cjs');

const TEST_DIR = path.join(os.tmpdir(), `audit-poc-caller-${Date.now()}`);
const TREE = 'apoc'; // 4-8 chars lowercase, matches PREFIX_RE
const ROOT = '11111111-2222-4333-8444-555555555555';
const WORKER = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const ATTACKER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'; // 攻击者伪造的 session
const AUDITOR = '99999999-8888-4777-8666-555555555555';

// 注册 mock verifier（让上述 session 通过真实性校验）
engine.setSessionVerifier((sid) => [ROOT, WORKER, ATTACKER, AUDITOR].includes(sid));

const ROOT_ID = `${TREE}-root`;
const WORKER_ID = `${TREE}-A1-worker`;

let blocked = 0;
let allowed = 0;
let otherBlock = 0;

function report(label, r, expectation) {
  // expectation: 'MUST_BLOCK_CALLER' | 'MUST_BLOCK_BORROWED' | 'MUST_ALLOW' | 'PROBE_RANGE_GAP'
  if (!r.ok && r.error && r.error.code === 'E_CALLER_REQUIRED') {
    blocked++;
    console.log(`  [BLOCKED:E_CALLER_REQUIRED] ${label}`);
    return expectation === 'MUST_BLOCK_CALLER' ? 'PASS' : 'INFO';
  } else if (!r.ok && r.error && r.error.code === 'E_BORROWED_IDENTITY') {
    blocked++;
    console.log(`  [BLOCKED:E_BORROWED_IDENTITY] ${label}`);
    return expectation === 'MUST_BLOCK_BORROWED' ? 'PASS' : 'INFO';
  } else if (!r.ok) {
    otherBlock++;
    console.log(`  [BLOCKED:${r.error.code}] ${label} — ${r.error.msg.slice(0, 90)}`);
    return 'OTHER_GATE';
  } else {
    allowed++;
    console.log(`  [ALLOWED] ${label}`);
    return expectation === 'MUST_ALLOW' ? 'PASS' : (expectation === 'PROBE_RANGE_GAP' ? 'GAP_CONFIRMED' : 'UNEXPECTED');
  }
}

(async function main() {
  console.log(`\n=== PoC Setup: tree=${TREE} dir=${TEST_DIR} ===`);
  console.log(`Production mode (TREE_ENGINE_ALLOW_CLI=${process.env.TREE_ENGINE_ALLOW_CLI || 'unset'})\n`);

  // ---- 建立合法树状态（用真实 caller 走正常路径）----
  let r = await engine.run('init', [
    TREE,
    '--root-brief', JSON.stringify({ parent_intent: 'P0-1 audit PoC' }),
    '--root-dod', JSON.stringify({ deliverables: ['audit-poc.cjs'] }),
    '--session-id', ROOT
  ], TEST_DIR);
  if (!r.ok) { console.error(`init failed: ${r.error.code}: ${r.error.msg}`); process.exit(1); }

  // ROOT 加 worker（caller=ROOT=added_by，正常）
  r = await engine.run('leaf', [
    'add', TREE,
    '--json', JSON.stringify({
      leaf_id: WORKER_ID, session_id: WORKER, parent: ROOT_ID,
      path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: ROOT
    })
  ], TEST_DIR, ROOT);
  if (!r.ok) { console.error(`leaf add worker failed: ${r.error.code}: ${r.error.msg}`); process.exit(1); }

  // WORKER 加 milestone（caller=WORKER=owner，正常）
  r = await engine.run('milestone', [
    'add', TREE, WORKER_ID,
    '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['x.txt'] })
  ], TEST_DIR, WORKER);
  if (!r.ok) { console.error(`milestone add failed: ${r.error.code}: ${r.error.msg}`); process.exit(1); }

  // ROOT 先发 plan event（brief_echo 的 auditor minimum-activity guard 要求 root 有 ≥1 event）
  r = await engine.run('event', [
    'append', TREE, ROOT_ID,
    '--type', 'plan',
    '--json', JSON.stringify({ plan_summary: 'P0-1 audit PoC' })
  ], TEST_DIR, ROOT);
  if (!r.ok) { console.error(`root plan event failed: ${r.error.code}: ${r.error.msg}`); process.exit(1); }

  // WORKER brief_echo（audit_gate 前置）
  r = await engine.run('event', [
    'append', TREE, WORKER_ID,
    '--type', 'brief_echo',
    '--json', JSON.stringify({ my_understanding: 'poc', milestones_preview: ['M1'], alignment: 'aligned', auditor_session_id: ROOT })
  ], TEST_DIR, WORKER);
  if (!r.ok) { console.error(`brief_echo failed: ${r.error.code}: ${r.error.msg}`); process.exit(1); }

  // 加独立 auditor leaf（resolveAuditorIndep 需要）
  r = await engine.run('leaf', [
    'add', TREE,
    '--json', JSON.stringify({
      leaf_id: `${TREE}-E1-auditor`, session_id: AUDITOR, parent: ROOT_ID,
      path: 'E1', role: 'auditor', model: 'm', channel: 'c', added_by: ROOT
    })
  ], TEST_DIR, ROOT);
  if (!r.ok) { console.error(`auditor leaf add failed: ${r.error.code}: ${r.error.msg}`); process.exit(1); }

  console.log('Setup OK: root + worker(M1,brief_echo) + auditor\n');

  // ============================================================
  // Attack 1: D6-F1 done 闭环（生产模式，全部不传 caller）
  // ============================================================
  console.log('=== Attack 1: D6-F1 done-closure (production, no caller) ===');
  r = await engine.run('event', [
    'append', TREE, WORKER_ID,
    '--type', 'done',
    '--json', JSON.stringify({ deliverables: ['x.txt'], self_check: [{ item: 'all', pass: true, evidence: 'forged' }] })
  ], TEST_DIR);
  report('1A. event append done (no caller)', r, 'MUST_BLOCK_CALLER');

  r = await engine.run('audit', [
    'gate', TREE, WORKER_ID,
    '--verdict', 'pass', '--audit-session-id', AUDITOR
  ], TEST_DIR);
  report('1B. audit_gate pass (no caller)', r, 'MUST_BLOCK_CALLER');

  r = await engine.run('leaf', ['set-status', TREE, WORKER_ID, 'done'], TEST_DIR);
  report('1C. leaf set-status done (no caller)', r, 'MUST_BLOCK_CALLER');

  r = await engine.run('milestone', [
    'set-result', TREE, WORKER_ID, 'M1',
    '--audit-pass', 'true', '--audit-session-id', AUDITOR
  ], TEST_DIR);
  report('1D. milestone set-result pass (no caller)', r, 'MUST_BLOCK_CALLER');

  // ============================================================
  // Attack 2: 伪造 caller（攻击者用自己的 session 当 caller）
  // ============================================================
  console.log('\n=== Attack 2: forged caller (attacker session ≠ owner/creator) ===');
  r = await engine.run('leaf', ['set-status', TREE, WORKER_ID, 'done'], TEST_DIR, ATTACKER);
  report('2A. set-status done with attacker caller', r, 'MUST_BLOCK_BORROWED');

  r = await engine.run('event', [
    'append', TREE, WORKER_ID,
    '--type', 'done',
    '--json', JSON.stringify({ deliverables: ['x.txt'], self_check: [{ item: 'all', pass: true, evidence: 'forged' }] })
  ], TEST_DIR, ATTACKER);
  report('2B. event append done with attacker caller', r, 'MUST_BLOCK_BORROWED');

  r = await engine.run('audit', [
    'gate', TREE, WORKER_ID,
    '--verdict', 'pass', '--audit-session-id', AUDITOR
  ], TEST_DIR, ATTACKER);
  report('2C. audit_gate with attacker caller ≠ audit_session_id', r, 'MUST_BLOCK_BORROWED');

  // ============================================================
  // Bypass: TREE_ENGINE_ALLOW_CLI=1 放行 caller 校验
  // ============================================================
  console.log('\n=== Bypass: TREE_ENGINE_ALLOW_CLI=1 (caller check skipped) ===');
  process.env.TREE_ENGINE_ALLOW_CLI = '1';
  // caller 校验应被跳过；可能撞其他门禁（如 done 需 audit_gate），但不应是 E_CALLER_REQUIRED
  r = await engine.run('leaf', ['set-status', TREE, WORKER_ID, 'active'], TEST_DIR);
  report('3A. set-status active ALLOW_CLI=1 (caller bypass)', r, 'MUST_ALLOW');

  r = await engine.run('event', [
    'append', TREE, WORKER_ID,
    '--type', 'done',
    '--json', JSON.stringify({ deliverables: ['x.txt'], self_check: [{ item: 'all', pass: true, evidence: 'cli' }] })
  ], TEST_DIR);
  report('3B. event append done ALLOW_CLI=1 (caller bypass)', r, 'MUST_ALLOW');

  delete process.env.TREE_ENGINE_ALLOW_CLI;

  // ============================================================
  // Range probe: P0-1 范围外的写操作（无 caller-binding）
  // ============================================================
  console.log('\n=== Range probe: write ops WITHOUT caller-binding (outside P0-1 scope) ===');
  r = await engine.run('drift', [
    'append', TREE, WORKER_ID,
    '--kind', 'production', '--severity', 'low', '--action', 'self_correct', '--reason', 'forged'
  ], TEST_DIR);
  report('4A. drift append (no caller, no binding)', r, 'PROBE_RANGE_GAP');

  // segment 是位置参数 [tree, leaf, new_session_id]
  r = await engine.run('segment', [
    'append', TREE, WORKER_ID, ATTACKER
  ], TEST_DIR);
  report('4B. segment append (no caller)', r, 'PROBE_RANGE_GAP');

  r = await engine.run('communication', [
    'log', TREE, '--target', WORKER, '--direction', 'out', '--note', 'forged-comm'
  ], TEST_DIR);
  report('4C. communication log (opts.caller fallback, no binding)', r, 'PROBE_RANGE_GAP');

  // ============================================================
  // Teardown + Summary
  // ============================================================
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${blocked} BLOCKED(caller/borrowed) / ${allowed} ALLOWED / ${otherBlock} BLOCKED(other gate)`);
  console.log(`${'='.repeat(60)}`);
})();
