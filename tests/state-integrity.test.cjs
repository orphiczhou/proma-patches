/**
 * P0-2 tree-state.json HMAC 完整性单测
 *
 * 验证 auditor D6-F2 要求：
 *   - T1: writeState→readState 正常往返 → 0 issues，_meta.integrity 存在
 *   - T2: 直接编辑 leaf.status active→done → E_STATE_INTEGRITY
 *   - T3: 直接加 audit_gate.verdict=pass → E_STATE_INTEGRITY
 *   - T4: 改 milestone.audit_pass null→true → E_STATE_INTEGRITY
 *   - T5: 老数据（删 _meta.integrity）+ 无关键状态 → warn 不拒
 *   - T6: 老数据删 integrity + 有 status=done → 拒绝（关键状态必须签名）
 *
 * 篡改模拟方式：直接 fs 读写 tree-state.json（绕过 writeState 签名），模拟攻击者手改文件。
 *
 * 用法：
 *   node tests/state-integrity.test.cjs
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// 生产模式（caller 校验生效；本测试所有写操作都带合规 caller）
delete process.env.TREE_ENGINE_ALLOW_CLI;

const engine = require('../tree-engine.cjs');
const { ERRORS } = engine;

const TEST_DIR = path.join(os.tmpdir(), `tree-integrity-${Date.now()}`);

const MOCK_ROOT = '22222222-2222-4222-8222-222222222222';
const MOCK_W = '33333333-3333-4333-8333-333333333333';

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS: ' + label); }
  else { failed++; console.error('  FAIL: ' + label); }
}

async function fails(promise, code, label) {
  try {
    const r = await promise;
    if (!r.ok && r.error && r.error.code === code) {
      passed++; console.log('  PASS: ' + label);
    } else {
      failed++;
      console.error(`  FAIL: ${label} — expected ${code}, got ${r.ok ? 'ok' : (r.error ? r.error.code : '?')}: ${r.error ? String(r.error.msg).slice(0, 140) : ''}`);
    }
  } catch (e) {
    failed++; console.error(`  FAIL: ${label} — unexpected throw: ${e.code || e.message}`);
  }
}

async function oks(promise, label) {
  try {
    const r = await promise;
    if (r.ok) { passed++; console.log('  PASS: ' + label); }
    else {
      failed++;
      console.error(`  FAIL: ${label} — expected ok, got ${r.error ? r.error.code : '?'}: ${r.error ? String(r.error.msg).slice(0, 140) : ''}`);
    }
  } catch (e) {
    failed++; console.error(`  FAIL: ${label} — unexpected throw: ${e.code || e.message}`);
  }
}

function statePathOf(tree) { return path.join(TEST_DIR, tree, 'tree-state.json'); }
function readRaw(tree) { return JSON.parse(fs.readFileSync(statePathOf(tree), 'utf8')); }
function writeRaw(tree, state) { fs.writeFileSync(statePathOf(tree), JSON.stringify(state), 'utf8'); }

async function setupTree(tree, workerId, opts) {
  let r = await engine.run('init', [tree,
    '--root-brief', JSON.stringify({ parent_intent: 'P0-2 integrity test' }),
    '--root-dod', JSON.stringify({ deliverables: ['state-integrity.test.cjs'] }),
    '--session-id', MOCK_ROOT
  ], TEST_DIR);
  if (!r.ok) throw new Error('init failed: ' + r.error.msg);

  r = await engine.run('leaf', ['add', tree, '--json', JSON.stringify({
    leaf_id: workerId, session_id: MOCK_W, parent: tree + '-root', path: 'A1',
    role: 'worker', model: 'test', channel: 'test', added_by: MOCK_ROOT
  })], TEST_DIR, MOCK_ROOT);
  if (!r.ok) throw new Error('add worker failed: ' + r.error.msg);

  if (opts && opts.milestone) {
    r = await engine.run('milestone', ['add', tree, workerId, '--json', JSON.stringify({
      id: 'M1', desc: 'test milestone', expect_outputs: ['x.txt']
    })], TEST_DIR, MOCK_W);
    if (!r.ok) throw new Error('add milestone failed: ' + r.error.msg);
  }
}

(async function main() {

console.log('\n=== Setup ===');
fs.mkdirSync(TEST_DIR, { recursive: true });
engine.setSessionVerifier((sid) => {
  if (![MOCK_ROOT, MOCK_W].includes(sid)) throw new Error(`session ${sid} not found`);
});

// TEST_TREE: worker active + milestone M1（audit_pass 未设）
const T = 'itest';
const W = T + '-A1-worker';
await setupTree(T, W, { milestone: true });
console.log(`Setup done: tree=${T}, worker=${W}`);

const sp = statePathOf(T);

// ============================================================
console.log('\n=== T1: 正常往返 — writeState→readState 0 issues, integrity 存在 ===');
const s1 = readRaw(T);
ok(s1._meta && s1._meta.integrity && s1._meta.integrity.algo === 'hmac-sha256',
   'T1a: _meta.integrity.algo = hmac-sha256');
ok(s1._meta.integrity.fields && s1._meta.integrity.fields.length === 8,
   'T1b: integrity.fields 列出 8 个 scope 字段');
ok(s1._meta.integrity.leaves && typeof s1._meta.integrity.leaves[W] === 'string' && s1._meta.integrity.leaves[W].length === 64,
   'T1c: worker leaf 有 64 字符 hex mac');
ok(typeof s1._meta.integrity.leaves[T + '-root'] === 'string',
   'T1d: root leaf 也有 mac');
ok(typeof s1._meta.integrity.key_id === 'string' && s1._meta.integrity.key_id.length === 8,
   'T1e: key_id = secret 前 8 位 hex');
await oks(engine.run('leaf', ['get', T, W], TEST_DIR), 'T1f: leaf get ok（readState 通过完整性校验）');

// 备份原始（已正确签名）state，T2-T4 每次篡改后 restore
const originalRaw = fs.readFileSync(sp, 'utf8');

// ============================================================
console.log('\n=== T2: 直接改 leaf.status active→done → E_STATE_INTEGRITY');
let s2 = JSON.parse(originalRaw);
s2.leaves[W].status = 'done';
writeRaw(T, s2);
await fails(engine.run('leaf', ['get', T, W], TEST_DIR), ERRORS.E_STATE_INTEGRITY,
           'T2: status 篡改 → E_STATE_INTEGRITY');
fs.writeFileSync(sp, originalRaw, 'utf8');

// ============================================================
console.log('\n=== T3: 直接加 audit_gate.verdict=pass → E_STATE_INTEGRITY');
let s3 = JSON.parse(originalRaw);
s3.leaves[W].audit_gate = { verdict: 'pass', audit_session_id: '00000000-0000-0000-0000-000000000000' };
writeRaw(T, s3);
await fails(engine.run('leaf', ['get', T, W], TEST_DIR), ERRORS.E_STATE_INTEGRITY,
           'T3: audit_gate.verdict 篡改 → E_STATE_INTEGRITY');
fs.writeFileSync(sp, originalRaw, 'utf8');

// ============================================================
console.log('\n=== T4: 改 milestone.audit_pass null→true → E_STATE_INTEGRITY');
let s4 = JSON.parse(originalRaw);
s4.leaves[W].milestones[0].audit_pass = true;
writeRaw(T, s4);
await fails(engine.run('leaf', ['get', T, W], TEST_DIR), ERRORS.E_STATE_INTEGRITY,
           'T4: milestone.audit_pass 篡改 → E_STATE_INTEGRITY');
fs.writeFileSync(sp, originalRaw, 'utf8');

// ============================================================
console.log('\n=== T5: 老数据删 _meta.integrity + 无关键状态 → warn 不拒');
const T5 = 'itest2';
const W5 = T5 + '-A1-worker';
await setupTree(T5, W5, {});  // active worker，无 milestone/done
let s5 = readRaw(T5);
delete s5._meta.integrity;
writeRaw(T5, s5);
await oks(engine.run('leaf', ['get', T5, W5], TEST_DIR),
         'T5: 老数据无关键状态 → readState warn 放行');

// ============================================================
console.log('\n=== T6: 老数据删 integrity + 有 status=done → 拒绝（关键状态必须签名）');
const T6 = 'itest3';
const W6 = T6 + '-A1-worker';
await setupTree(T6, W6, {});  // active worker
let s6 = readRaw(T6);
s6.leaves[W6].status = 'done';   // 模拟关键状态（迁移残留 / 攻击者手改）
delete s6._meta.integrity;        // 删签名
writeRaw(T6, s6);
await fails(engine.run('leaf', ['get', T6, W6], TEST_DIR), ERRORS.E_STATE_INTEGRITY,
           'T6: 老数据 status=done 无签名 → E_STATE_INTEGRITY');

// ============================================================
console.log('\n=== Teardown ===');
try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
console.log('Temp dir cleaned.');

console.log(`\n${'='.repeat(60)}`);
console.log(`RESULTS: ${passed} PASS / ${failed} FAIL / ${passed + failed} total`);
console.log('='.repeat(60));

if (failed > 0) process.exit(1);

})(); // end main
