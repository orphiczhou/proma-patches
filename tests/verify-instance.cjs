/**
 * 实例 engine 端到端验证（require 实例实际加载的 engine 文件）
 * 验证 P0-1（caller 强制）+ P0-2（HMAC 完整性）在 pro/dev/release 实例 engine 上生效。
 *
 * 用法：
 *   node tests/verify-instance.cjs                                              # 默认 pro/dev engine
 *   node tests/verify-instance.cjs D:/Proma-release/resources/app/dist/tree-engine.cjs  # release engine
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ENGINE_PATH = process.argv[2] || 'D:/Proma-dev/resources/app/dist/tree-engine.cjs';
const engine = require(ENGINE_PATH);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name} ${detail || ''}`); fail++; }
}
// leaves 可能是数组或对象 {[id]: leaf}；对象形式下 leaf 内部 id 字段可能缺失，用 key 注入
function leafList(state) {
  const ls = state.leaves;
  if (Array.isArray(ls)) return ls;
  if (ls && typeof ls === 'object') {
    return Object.entries(ls).map(([id, leaf]) => ({ ...(leaf || {}), id: (leaf && leaf.id) || id }));
  }
  return [];
}

(async () => {
  console.log(`=== 实例 engine 验证 ===`);
  console.log(`engine: ${ENGINE_PATH}\n`);

  const src = fs.readFileSync(ENGINE_PATH, 'utf8');
  check('engine 含 E_CALLER_REQUIRED (P0-1)', src.includes('E_CALLER_REQUIRED'));
  check('engine 含 verifyStateIntegrity (P0-2)', src.includes('verifyStateIntegrity'));

  delete process.env.TREE_ENGINE_ALLOW_CLI;
  engine.setSessionVerifier(() => true);

  const ROOT = '11111111-2222-4333-8444-555555555555';
  const W = '66666666-7777-4888-8999-aaaaaaaaaaaa';

  // ===== P0-2: tree-state HMAC 完整性 =====
  console.log('\n--- P0-2: tree-state HMAC 完整性 ---');
  const D1 = path.join(os.tmpdir(), `verify-p02-${Date.now()}`);
  fs.mkdirSync(D1, { recursive: true });
  const T = 'vpth';
  const WID1 = `${T}-A1-worker`; // leaf_id 格式 <tree>-<path>-<role>，path=A1

  let r = await engine.run('init', [T, '--root-brief', JSON.stringify({ g: 't' }), '--root-dod', JSON.stringify({ a: 't' }), '--session-id', ROOT], D1);
  check('init tree', r.ok, r.error && r.error.msg);

  r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
    leaf_id: WID1, session_id: W, parent: `${T}-root`,
    path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: ROOT
  })], D1, ROOT);
  check('leaf add worker', r.ok, r.error && (r.error.code + ': ' + (r.error.msg||'').slice(0,70)));

  const sp = path.join(D1, T, 'tree-state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  check('integrity 字段存在', !!st._meta && !!st._meta.integrity);
  check('integrity.algo = hmac-sha256', st._meta && st._meta.integrity && st._meta.integrity.algo === 'hmac-sha256');
  const signedIds = st._meta && st._meta.integrity ? Object.keys(st._meta.integrity.leaves || {}) : [];
  check('leaves 签名 map ≥ 2 (root+worker)', signedIds.length >= 2, JSON.stringify(signedIds));

  // 篡改 status=done（模拟攻击者直接编辑文件，绕过 writeState 签名）
  const st2 = JSON.parse(fs.readFileSync(sp, 'utf8'));
  // 直接定位原对象引用（leafList 返回 spread 副本，改副本不持久）
  const ls = st2.leaves;
  const target = Array.isArray(ls) ? ls.find(l => l.id === WID1) : (ls && ls[WID1]);
  if (!target) {
    check('找到 worker leaf 做篡改', false, `${WID1} not found (keys=${JSON.stringify(Array.isArray(ls) ? ls.map(l => l.id) : Object.keys(ls || {}))})`);
  } else {
    target.status = 'done';  // 直接改原对象
    fs.writeFileSync(sp, JSON.stringify(st2));  // 写回（绕过 writeState 签名）
    // engine.run wrapper catch TreeStateError → 返回 {ok:false, error}（不 throw）
    const rget = await engine.run('leaf', ['get', T, WID1], D1);
    check('篡改 status=done 被检测 (E_STATE_INTEGRITY)',
      !rget.ok && rget.error && /E_STATE_INTEGRITY/.test(rget.error.code),
      rget.error ? rget.error.code : 'ok=true (NOT blocked!)');
  }

  // ===== P0-1: CLI caller 缺省拒绝 =====
  console.log('\n--- P0-1: CLI caller 缺省拒绝 ---');
  const D2 = path.join(os.tmpdir(), `verify-p01-${Date.now()}`);
  fs.mkdirSync(D2, { recursive: true });
  const T2 = 'vpone';
  const WID2 = `${T2}-A1-worker`;
  await engine.run('init', [T2, '--root-brief', JSON.stringify({ g: 't' }), '--root-dod', JSON.stringify({ a: 't' }), '--session-id', ROOT], D2);
  await engine.run('leaf', ['add', T2, '--json', JSON.stringify({
    leaf_id: WID2, session_id: W, parent: `${T2}-root`,
    path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: ROOT
  })], D2, ROOT);

  // 生产模式：不传 caller（第 4 参）→ E_CALLER_REQUIRED
  r = await engine.run('leaf', ['set-status', T2, WID2, 'active'], D2);
  check('CLI caller 缺省 → E_CALLER_REQUIRED', !r.ok && r.error && r.error.code === 'E_CALLER_REQUIRED', r.error && r.error.code);

  // 正常 caller（MCP 模式，caller=W=owner）→ 通过
  r = await engine.run('leaf', ['set-status', T2, WID2, 'active'], D2, W);
  check('MCP caller 正常路径通过', r.ok, r.error && (r.error.code + ': ' + (r.error.msg||'').slice(0,60)));

  // ALLOW_CLI=1 测试模式 → 放行
  process.env.TREE_ENGINE_ALLOW_CLI = '1';
  r = await engine.run('leaf', ['set-status', T2, WID2, 'active'], D2);
  check('ALLOW_CLI=1 测试模式放行', r.ok, r.error && r.error.code);
  delete process.env.TREE_ENGINE_ALLOW_CLI;

  fs.rmSync(D1, { recursive: true, force: true });
  fs.rmSync(D2, { recursive: true, force: true });

  console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL / ${pass + fail} total ===`);
  console.log(fail === 0 ? '✅ 实例 engine P0-1/P0-2 验证全过' : '❌ 有失败项');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
