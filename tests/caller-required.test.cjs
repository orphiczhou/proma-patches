/**
 * P0-1 caller-required 单测
 *
 * 验证 CLI 兼容通道关闭：
 *   - 生产模式（无 TREE_ENGINE_ALLOW_CLI）：写操作 caller 缺省 → E_CALLER_REQUIRED
 *   - 测试模式（TREE_ENGINE_ALLOW_CLI=1）：写操作 caller 缺省 → 放行
 *   - 显式传 mock caller：正常校验
 *
 * LEAF_NAME_RE: /^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\\d*(?:[a-z]\\d*)*)?-)?(\\w+)(?:-(s\\d+|i\\d+))?$/
 * ROLE_ENUM: ['root', 'commander', 'worker', 'auditor']
 *
 * 用法：
 *   node tests/caller-required.test.cjs                          # 生产模式测试
 *   TREE_ENGINE_ALLOW_CLI=1 node tests/caller-required.test.cjs  # 测试模式验证
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// 确保生产模式（不设 TREE_ENGINE_ALLOW_CLI）
delete process.env.TREE_ENGINE_ALLOW_CLI;

const engine = require('../tree-engine.cjs');
const { ERRORS } = engine;

const TEST_DIR = path.join(os.tmpdir(), `tree-caller-test-${Date.now()}`);
const TEST_TREE = 'ctest';
const MOCK_CALLER = '11111111-1111-4111-8111-111111111111';
const MOCK_ROOT = '22222222-2222-4222-8222-222222222222';
const MOCK_W = '33333333-3333-4333-8333-333333333333';
const MOCK_W2 = '55555555-5555-4555-8555-555555555555';
const MOCK_W_CLI = '66666666-6666-4666-8666-666666666666';
const MOCK_W3 = '77777777-7777-4777-8777-777777777777';
const MOCK_W4 = '88888888-8888-4888-8888-888888888888';
const MOCK_AUDITOR = '44444444-4444-4444-8444-444444444444';

const ALL_SESSIONS = [MOCK_CALLER, MOCK_ROOT, MOCK_W, MOCK_W2, MOCK_W_CLI, MOCK_W3, MOCK_W4, MOCK_AUDITOR];

let passed = 0;
let failed = 0;

async function assertRunFails(promise, expectedCode, label) {
  try {
    const result = await promise;
    if (!result.ok && result.error && result.error.code === expectedCode) {
      passed++;
      console.log(`  PASS: ${label}`);
    } else if (!result.ok) {
      failed++;
      console.error(`  FAIL: ${label} — expected ${expectedCode}, got ${result.error ? result.error.code : 'unknown'}: ${result.error ? result.error.msg.slice(0,120) : 'no error'}`);
    } else {
      failed++;
      console.error(`  FAIL: ${label} — expected ${expectedCode} but result.ok=true`);
    }
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${label} — unexpected throw: ${e.code || e.message}`);
  }
}

async function assertRunOk(promise, label) {
  try {
    const result = await promise;
    if (result.ok) {
      passed++;
      console.log(`  PASS: ${label}`);
    } else {
      failed++;
      console.error(`  FAIL: ${label} — expected ok but got ${result.error ? result.error.code : 'error'}: ${result.error ? result.error.msg.slice(0,120) : ''}`);
    }
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${label} — unexpected throw: ${e.code || e.message}`);
  }
}

// ============================================================
// Main
// ============================================================
(async function main() {

console.log('\n=== Setup ===');
fs.mkdirSync(TEST_DIR, { recursive: true });

// 注册 mock sessions
engine.setSessionVerifier((sid) => {
  if (!ALL_SESSIONS.includes(sid)) throw new Error(`session ${sid} not found`);
});

// 命名格式: <prefix>-<Path>-<role> where Path starts with uppercase
const ROOT_ID = `${TEST_TREE}-root`;                             // prefix=ctest, role=root
const WORKER1_ID = `${TEST_TREE}-A1-worker`;                      // prefix=ctest, path=A1, role=worker
const WORKER2_ID = `${TEST_TREE}-A2-worker`;                      // for test 1a
const WORKER_CLI_ID = `${TEST_TREE}-B1-worker`;                   // for test 2
const WORKER3_ID = `${TEST_TREE}-C1-worker`;                      // for test 3a
const WORKER4_ID = `${TEST_TREE}-D1-worker`;                      // for test 3b
const AUDITOR_ID = `${TEST_TREE}-E1-auditor`;                     // auditor leaf

// 1. init tree
console.log('Init tree...');
let r = await engine.run('init', [
  TEST_TREE,
  '--root-brief', JSON.stringify({ parent_intent: 'P0-1 unit test' }),
  '--root-dod', JSON.stringify({ deliverables: ['caller-required.test.cjs'] }),
  '--session-id', MOCK_ROOT
], TEST_DIR);
if (!r.ok) {
  console.error(`  FAIL: init tree: ${r.error.code}: ${r.error.msg}`);
  process.exit(1);
}

// 2. add worker leaf (caller=MOCK_ROOT=root.session_id, added_by=MOCK_ROOT → match)
// added_by 必须是树中已存在 leaf 的 session_id（cmdLeafAdd D2-B1 校验）
r = await engine.run('leaf', [
  'add', TEST_TREE,
  '--json', JSON.stringify({
    leaf_id: WORKER1_ID,
    session_id: MOCK_W,
    parent: ROOT_ID,
    path: 'A1',
    role: 'worker',
    model: 'test',
    channel: 'test',
    added_by: MOCK_ROOT
  })
], TEST_DIR, MOCK_ROOT);
if (!r.ok) {
  console.error(`  FAIL: add worker leaf: ${r.error.code}: ${r.error.msg}`);
  process.exit(1);
}

// 3. add event to root (required for root-as-auditor path)
r = await engine.run('event', [
  'append', TEST_TREE, ROOT_ID,
  '--type', 'plan',
  '--json', JSON.stringify({ plan_summary: 'P0-1 test setup' })
], TEST_DIR, MOCK_ROOT);
if (!r.ok) {
  console.error(`  FAIL: add root event: ${r.error.code}: ${r.error.msg}`);
  process.exit(1);
}

// 4. add milestone to worker
r = await engine.run('milestone', [
  'add', TEST_TREE, WORKER1_ID,
  '--json', JSON.stringify({ id: 'M1', desc: 'Test milestone', expect_outputs: ['test.txt'] })
], TEST_DIR, MOCK_W);
if (!r.ok) {
  console.error(`  FAIL: add milestone: ${r.error.code}: ${r.error.msg}`);
  process.exit(1);
}

// 4. add auditor leaf (for audit_gate tests requiring independent auditor)
r = await engine.run('leaf', [
  'add', TEST_TREE,
  '--json', JSON.stringify({
    leaf_id: AUDITOR_ID,
    session_id: MOCK_AUDITOR,
    parent: ROOT_ID,
    path: 'E1',
    role: 'auditor',
    model: 'test',
    channel: 'test',
    added_by: MOCK_ROOT
  })
], TEST_DIR, MOCK_ROOT);
if (!r.ok) {
  console.error(`  FAIL: add auditor leaf: ${r.error.code}: ${r.error.msg}`);
  process.exit(1);
}

// 6. add brief_echo to worker1 (required for audit_gate alignment check)
r = await engine.run('event', [
  'append', TEST_TREE, WORKER1_ID,
  '--type', 'brief_echo',
  '--json', JSON.stringify({ my_understanding: 'test', milestones_preview: ['M1'], alignment: 'aligned', auditor_session_id: MOCK_ROOT })
], TEST_DIR, MOCK_W);
if (!r.ok) {
  console.error(`  FAIL: add worker1 brief_echo: ${r.error.code}: ${r.error.msg}`);
  process.exit(1);
}

console.log(`Setup done: tree=${TEST_TREE}, root=${ROOT_ID}, worker1=${WORKER1_ID}, auditor=${AUDITOR_ID}\n`);

// ============================================================
// Test 1: 生产模式 — 写操作 caller 缺省抛 E_CALLER_REQUIRED
// ============================================================
console.log('=== Test 1: Production mode — caller absent throws E_CALLER_REQUIRED ===');

// 1a: leaf add without caller (added_by 用树中已存在的 root session 避免 D2-B1 先触发)
await assertRunFails(
  engine.run('leaf', [
    'add', TEST_TREE,
    '--json', JSON.stringify({
      leaf_id: `${TEST_TREE}-A2b-worker`,
      session_id: MOCK_W2,
      parent: ROOT_ID,
      path: 'A2b',
      role: 'worker',
      model: 'test',
      channel: 'test',
      added_by: MOCK_ROOT  // 树中已存在的 root session
    })
  ], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1a: leaf_add without caller → E_CALLER_REQUIRED'
);

// 1b: leaf set-status
await assertRunFails(
  engine.run('leaf', ['set-status', TEST_TREE, WORKER1_ID, 'done'], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1b: leaf set-status without caller → E_CALLER_REQUIRED'
);

// 1c: leaf set-session
await assertRunFails(
  engine.run('leaf', ['set-session', TEST_TREE, WORKER1_ID, MOCK_CALLER], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1c: leaf set-session without caller → E_CALLER_REQUIRED'
);

// 1d: milestone add
await assertRunFails(
  engine.run('milestone', [
    'add', TEST_TREE, WORKER1_ID,
    '--json', JSON.stringify({ id: 'M2', desc: 'Test M2', expect_outputs: ['x.md'] })
  ], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1d: milestone_add without caller → E_CALLER_REQUIRED'
);

// 1e: milestone set-result
await assertRunFails(
  engine.run('milestone', [
    'set-result', TEST_TREE, WORKER1_ID, 'M1',
    '--audit-pass', 'true',
    '--audit-session-id', MOCK_AUDITOR
  ], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1e: milestone set-result without caller → E_CALLER_REQUIRED'
);

// 1f: milestone update
await assertRunFails(
  engine.run('milestone', [
    'update', TEST_TREE, WORKER1_ID, 'M1',
    '--desc', 'Updated desc', '--expect-outputs', JSON.stringify(['x.md'])
  ], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1f: milestone_update without caller → E_CALLER_REQUIRED'
);

// 1g: event append done
await assertRunFails(
  engine.run('event', [
    'append', TEST_TREE, WORKER1_ID,
    '--type', 'done',
    '--json', JSON.stringify({ deliverables: ['test.txt'], self_check: [{item:'all',pass:true,evidence:'test'}] })
  ], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1g: event_append(done) without caller → E_CALLER_REQUIRED'
);

// 1h: audit gate
await assertRunFails(
  engine.run('audit', [
    'gate', TEST_TREE, WORKER1_ID,
    '--verdict', 'pass',
    '--audit-session-id', MOCK_AUDITOR
  ], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1h: audit_gate without caller → E_CALLER_REQUIRED'
);

// 1i: audit append
await assertRunFails(
  engine.run('audit', [
    'append', TEST_TREE, WORKER1_ID,
    '--json', JSON.stringify({
      auditor_session_id: MOCK_AUDITOR,
      total: 3, passed: 3, failed: 0,
      results: [{ id: 'C1', verdict: 'pass', note: 'ok' }]
    })
  ], TEST_DIR),
  ERRORS.E_CALLER_REQUIRED,
  '1i: audit_append without caller → E_CALLER_REQUIRED'
);

// ============================================================
// Test 2: 测试模式 TREE_ENGINE_ALLOW_CLI=1 放行
// ============================================================
console.log('\n=== Test 2: TREE_ENGINE_ALLOW_CLI=1 bypass ===');

process.env.TREE_ENGINE_ALLOW_CLI = '1';

// 2a: leaf add without caller + ALLOW_CLI=1
await assertRunOk(
  engine.run('leaf', [
    'add', TEST_TREE,
    '--json', JSON.stringify({
      leaf_id: WORKER_CLI_ID,
      session_id: MOCK_W_CLI,
      parent: ROOT_ID,
      path: 'B1',
      role: 'worker',
      model: 'test',
      channel: 'test',
      added_by: MOCK_ROOT
    })
  ], TEST_DIR),
  '2a: leaf_add without caller + ALLOW_CLI=1 → ok'
);

// 2b: milestone add without caller
await assertRunOk(
  engine.run('milestone', [
    'add', TEST_TREE, WORKER_CLI_ID,
    '--json', JSON.stringify({ id: 'M1', desc: 'Test', expect_outputs: ['x.txt'] })
  ], TEST_DIR),
  '2b: milestone_add without caller + ALLOW_CLI=1 → ok'
);

// 2c: event append done without caller
await assertRunOk(
  engine.run('event', [
    'append', TEST_TREE, WORKER_CLI_ID,
    '--type', 'done',
    '--json', JSON.stringify({ deliverables: ['x.txt'], self_check: [{item:'all',pass:true,evidence:'cli-test'}] })
  ], TEST_DIR),
  '2c: event_append(done) without caller + ALLOW_CLI=1 → ok'
);

// 2d-pre: add brief_echo to WORKER_CLI (required for audit_gate alignment check)
await assertRunOk(
  engine.run('event', [
    'append', TEST_TREE, WORKER_CLI_ID,
    '--type', 'brief_echo',
    '--json', JSON.stringify({ my_understanding: 'test-cli', milestones_preview: ['M1'], alignment: 'aligned', auditor_session_id: MOCK_ROOT })
  ], TEST_DIR),
  '2d-pre: brief_echo on WORKER_CLI → ok'
);

// 2d: audit gate without caller + ALLOW_CLI=1 (root as auditor)
await assertRunOk(
  engine.run('audit', [
    'gate', TEST_TREE, WORKER_CLI_ID,
    '--verdict', 'pass',
    '--audit-session-id', MOCK_ROOT
  ], TEST_DIR),
  '2d: audit_gate without caller + ALLOW_CLI=1 → ok'
);

delete process.env.TREE_ENGINE_ALLOW_CLI;
console.log('  (ALLOW_CLI flag cleared)');

// ============================================================
// Test 3: 显式传 mock caller → 正常校验
// ============================================================
console.log('\n=== Test 3: Explicit caller — normal validation ===');

// 3a: leaf add with matching caller=added_by (caller=MOCK_ROOT, added_by=MOCK_ROOT)
await assertRunOk(
  engine.run('leaf', [
    'add', TEST_TREE,
    '--json', JSON.stringify({
      leaf_id: WORKER3_ID,
      session_id: MOCK_W3,
      parent: ROOT_ID,
      path: 'C1',
      role: 'worker',
      model: 'test',
      channel: 'test',
      added_by: MOCK_ROOT
    })
  ], TEST_DIR, MOCK_ROOT),
  '3a: leaf_add with matching caller=added_by → ok'
);

// 3b: leaf add with mismatched caller≠added_by → E_BORROWED_IDENTITY
// added_by=MOCK_W 已在 setup 创建，caller=MOCK_ROOT≠MOCK_W
await assertRunFails(
  engine.run('leaf', [
    'add', TEST_TREE,
    '--json', JSON.stringify({
      leaf_id: WORKER4_ID,
      session_id: MOCK_W4,
      parent: ROOT_ID,
      path: 'D1',
      role: 'worker',
      model: 'test',
      channel: 'test',
      added_by: MOCK_W  // 树中已存在，但 ≠ caller MOCK_ROOT
    })
  ], TEST_DIR, MOCK_ROOT),
  ERRORS.E_BORROWED_IDENTITY,
  '3b: leaf_add with caller≠added_by → E_BORROWED_IDENTITY'
);

// 3c: event append done with caller=leaf.session_id
await assertRunOk(
  engine.run('event', [
    'append', TEST_TREE, WORKER1_ID,
    '--type', 'done',
    '--json', JSON.stringify({ deliverables: ['test.txt'], self_check: [{item:'all',pass:true,evidence:'test'}] })
  ], TEST_DIR, MOCK_W),
  '3c: event_append(done) with caller=leaf.session_id → ok'
);

// 3d: audit gate with caller=audit_session_id (root as auditor, caller=MOCK_ROOT)
await assertRunOk(
  engine.run('audit', [
    'gate', TEST_TREE, WORKER1_ID,
    '--verdict', 'pass',
    '--audit-session-id', MOCK_ROOT
  ], TEST_DIR, MOCK_ROOT),
  '3d: audit_gate with caller=audit_session_id → ok'
);

// ============================================================
// Teardown
// ============================================================
console.log('\n=== Teardown ===');
try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
console.log('Temp dir cleaned.\n');

// ============================================================
// Report
// ============================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`RESULTS: ${passed} PASS / ${failed} FAIL / ${passed + failed} total`);
console.log(`${'='.repeat(60)}`);

if (failed > 0) process.exit(1);

})(); // end main
