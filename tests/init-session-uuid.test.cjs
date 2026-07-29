/**
 * tree_init session_id UUID strict 校验单测（轮 2, 2026-07-29, macpaf closeout-gap）
 *
 * 背景: macpaf pro 实战发现 tree_init 接受任意字符串做 session_id（GLM root 用 cwd 目录名
 * 缩写前缀 `a9221192` 被存为 root.session_id），与 MCP wrapper 提取的真实完整 UUID caller 不等
 * → 后续 leaf_add 撞 E_BORROWED_IDENTITY + set_session 防劫持双锁死锁。
 * 修复: cmdInit 入口对齐 leaf_add，加 UUID strict 校验，不合规抛 E_NAME_INVALID。
 *
 * 用法：
 *   node tests/init-session-uuid.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ENGINE_PATH = 'D:/Codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name} ${detail || ''}`); fail++; }
}

const FULL_UUID = '11111111-2222-4333-8444-555555555555'; // 合法完整 UUID（T1/T4 用）
const ABBR = 'a9221192';        // 8 字符缩写（macpaf 实战 GLM root 用的 cwd 目录名前缀）
const NON_UUID = 'my-session';  // 非 UUID 字符串

function mkTreeDir(label) {
  const d = path.join(os.tmpdir(), `init-uuid-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readState(dir, treeId) {
  const sp = path.join(dir, treeId, 'tree-state.json');
  return JSON.parse(fs.readFileSync(sp, 'utf8'));
}

(async () => {
  console.log('=== tree_init session_id UUID strict 校验单测 ===\n');

  // 测试不依赖 session liveness（cmdInit 用纯格式校验 isValidStrictUuidV4，不调 verifier）。
  // 设 verifier 仅防御性兜底（本组测试 session_id 走格式校验，verifier 不被触达）。
  engine.setSessionVerifier(() => true);

  // ================================================================
  // T1: 完整 UUID session_id (--session-id) → init 成功
  // ================================================================
  console.log('--- T1: 完整 UUID session_id → init 成功 ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t1');
    const T = 'iut1';
    const r = await engine.run('init',
      [T, '--root-brief', JSON.stringify({ g: 't1' }), '--root-dod', JSON.stringify({ a: 't1' }),
       '--session-id', FULL_UUID], D);
    check('T1 init 成功（完整 UUID）', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 80)));
    if (r.ok) {
      const st = readState(D, T);
      check('T1 root.session_id === 完整 UUID', st.leaves[`${T}-root`].session_id === FULL_UUID,
        'got ' + st.leaves[`${T}-root`].session_id);
    }
    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T2: 缩写 session_id (a9221192, 8 字符非 UUID) → 拒绝 E_NAME_INVALID
  // ================================================================
  console.log('\n--- T2: 缩写 session_id (a9221192) → 拒绝 E_NAME_INVALID ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t2');
    const T = 'iut2';
    const r = await engine.run('init',
      [T, '--root-brief', JSON.stringify({ g: 't2' }), '--root-dod', JSON.stringify({ a: 't2' }),
       '--session-id', ABBR], D);
    check('T2 init 被拒绝', !r.ok, r.ok ? 'SHOULD HAVE BEEN REJECTED' : '');
    check('T2 错误码 = E_NAME_INVALID', r.error && r.error.code === 'E_NAME_INVALID',
      r.error && r.error.code);
    // 关键：树目录不应被创建（fail-fast，不污染 fs）
    check('T2 拒绝后无 tree-state.json（fail-fast 不落盘）',
      !fs.existsSync(path.join(D, T, 'tree-state.json')));
    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T3: 非 UUID 字符串 (my-session) → 拒绝 E_NAME_INVALID
  // ================================================================
  console.log('\n--- T3: 非 UUID 字符串 (my-session) → 拒绝 E_NAME_INVALID ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t3');
    const T = 'iut3';
    const r = await engine.run('init',
      [T, '--root-brief', JSON.stringify({ g: 't3' }), '--root-dod', JSON.stringify({ a: 't3' }),
       '--session-id', NON_UUID], D);
    check('T3 init 被拒绝', !r.ok, r.ok ? 'SHOULD HAVE BEEN REJECTED' : '');
    check('T3 错误码 = E_NAME_INVALID', r.error && r.error.code === 'E_NAME_INVALID',
      r.error && r.error.code);
    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T4: 缺 --session-id 但传 callerSessionId（完整 UUID）→ init 成功（caller 兜底）
  //     这是 MCP 真实路径：MCP wrapper 从 SDK 透传真实完整 UUID caller，root.session_id 取自 caller。
  // ================================================================
  console.log('\n--- T4: 缺 --session-id，callerSessionId 完整 UUID 兜底 → init 成功 ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t4');
    const T = 'iut4';
    // 不传 --session-id；第 4 参数 callerSessionId 传完整 UUID（模拟 MCP wrapper 透传）
    const r = await engine.run('init',
      [T, '--root-brief', JSON.stringify({ g: 't4' }), '--root-dod', JSON.stringify({ a: 't4' })],
      D, FULL_UUID);
    check('T4 init 成功（caller 兜底）', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 80)));
    if (r.ok) {
      const st = readState(D, T);
      check('T4 root.session_id === caller 完整 UUID', st.leaves[`${T}-root`].session_id === FULL_UUID,
        'got ' + st.leaves[`${T}-root`].session_id);
    }
    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T5（附加回归）: 全 0 / 全 f UUID → 拒绝（isValidStrictUuidV4 拒 FORBIDDEN_UUIDS）
  //     验证复用的 helper 带来的额外防御（非本次 bug，但属同一校验面，值得锁定）。
  // ================================================================
  console.log('\n--- T5（回归）: 全 0 / 全 f UUID → 拒绝 E_NAME_INVALID ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    for (const bad of ['00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff']) {
      const D = mkTreeDir('t5');
      const T = 'iut5';
      const r = await engine.run('init',
        [T, '--root-brief', JSON.stringify({ g: 't5' }), '--root-dod', JSON.stringify({ a: 't5' }),
         '--session-id', bad], D);
      check(`T5 全 0/全 f "${bad.slice(0, 13)}..." 被拒绝`, !r.ok, r.ok ? 'SHOULD HAVE BEEN REJECTED' : '');
      check(`T5 "${bad.slice(0, 13)}..." 错误码 = E_NAME_INVALID`,
        r.error && r.error.code === 'E_NAME_INVALID', r.error && r.error.code);
    }
    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T6（附加回归）: 三源全缺 → PENDING_ROOT 兜底（不撞 UUID 校验，向后兼容）
  //     防御：本校验不能破坏既有的 PENDING_ROOT 冷启动降级路径。
  // ================================================================
  console.log('\n--- T6（回归）: 三源全缺 → PENDING_ROOT 兜底，不撞 UUID 校验 ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const saved = process.env.PROMA_SESSION_ID;
    delete process.env.PROMA_SESSION_ID;
    const D = mkTreeDir('t6');
    const T = 'iut6';
    // 无 --session-id、无 callerSessionId、无 PROMA_SESSION_ID → rootSessionId = PENDING_ROOT
    const r = await engine.run('init',
      [T, '--root-brief', JSON.stringify({ g: 't6' }), '--root-dod', JSON.stringify({ a: 't6' })], D);
    check('T6 init 成功（PENDING_ROOT 兜底，不撞 UUID 校验）', r.ok,
      r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 80)));
    if (r.ok) {
      const st = readState(D, T);
      check('T6 root.session_id === PENDING_ROOT', st.leaves[`${T}-root`].session_id === 'PENDING_ROOT',
        'got ' + st.leaves[`${T}-root`].session_id);
    }
    if (saved !== undefined) process.env.PROMA_SESSION_ID = saved;
    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL / ${pass + fail} total ===`);
  console.log(fail === 0 ? '✅ tree_init session_id UUID strict 校验单测全过' : '❌ 有失败项');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
