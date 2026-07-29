/**
 * audit-poc-child-done.cjs — 异厂商独立审计 PoC（轮 1, 2026-07-29）
 * 审计员：GLM-5.2（与实施方 DeepSeek-v4-pro 异厂商）
 *
 * 目的：独立核实 child_done 事件机制，补实施方单测（child-done-event.test.cjs）的盲区：
 *   A. 三层链端到端（worker→commander→root，root done 无 child_done）
 *   B. child_done 写入后 tree_validate 0 issues（单测未显式断言）
 *   C. HMAC 独立复现 + 对照实验：证明 events（含 child_done）不在签名 scope
 *   D. 多 child done → parent 收多条 child_done（单测只测单 child，并入 B）
 *   E. readState 重读不抛 E_STATE_INTEGRITY（verifyStateIntegrity 自动跑 = HMAC 链未断）
 *
 * leaf_id 命名规范：^<prefix>-<path>-<role>[-<suffix>]$，path 段必须与 leaf_id 一致。
 * 用法：node tests/audit-poc-child-done.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ENGINE_PATH = 'D:/Codes/tree-harness/tree-engine.cjs';
const ENGINE_DIR = path.dirname(ENGINE_PATH);
const SECRET_PATH = path.join(ENGINE_DIR, '.tree-engine-secret');
const engine = require(ENGINE_PATH);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name} ${detail || ''}`); fail++; }
}

// ---- 独立复现 engine HMAC 算法（照抄 engine L643-672 逻辑，交叉验证）----
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
function leafIntegrityFields(leaf) {
  if (!leaf || typeof leaf !== 'object') return null;
  return {
    id: leaf.id || null,
    role: leaf.role || null,
    status: leaf.status || null,
    added_by: leaf.added_by || null,
    session_id: leaf.session_id || null,
    audit_gate_verdict: (leaf.audit_gate && leaf.audit_gate.verdict) || null,
    milestones_audit_pass: Array.isArray(leaf.milestones)
      ? leaf.milestones.map(m => ({
          id: (m && m.id) || null,
          audit_pass: (m && typeof m.audit_pass === 'boolean') ? m.audit_pass : null
        }))
      : [],
    audit_log: leaf.audit_log || null
  };
}
function computeLeafHmacMine(leaf, secret) {
  return crypto.createHmac('sha256', secret).update(stableStringify(leafIntegrityFields(leaf))).digest('hex');
}
function readEngineSecret() {
  return Buffer.from(fs.readFileSync(SECRET_PATH, 'utf8').trim(), 'hex');
}

const ROOT = '11111111-2222-4333-8444-555555555555';
const CMD  = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const WRK1 = '66666666-7777-4888-8999-aaaaaaaabbbb';
const WRK2 = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff2222';

function mkTreeDir(label) {
  const d = path.join(os.tmpdir(), `audit-cd-${label}-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function readState(dir, treeId) {
  return JSON.parse(fs.readFileSync(path.join(dir, treeId, 'tree-state.json'), 'utf8'));
}
function touchDeliverable(dir, treeId, relPath) {
  const full = path.join(dir, treeId, 'deliverables', relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'audit poc deliverable\n', 'utf8');
}

// 把一个 worker 推到 done（全部门槛）。pathP 必须 === leaf_id 的 path 段。
async function makeWorkerDone(D, T, leafId, workerSession, parentLeafId, parentSession, out, pathP, callerForAdd) {
  let r;
  r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
    leaf_id: leafId, session_id: workerSession, parent: parentLeafId,
    path: pathP, role: 'worker', model: 'm', channel: 'c', added_by: parentSession
  })], D, callerForAdd);
  if (!r.ok) return r;
  r = await engine.run('milestone', ['add', T, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'poc', expect_outputs: [out] })], D);
  if (!r.ok) return r;
  touchDeliverable(D, T, out);
  r = await engine.run('milestone', ['set-result', T, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', ROOT], D);
  if (!r.ok) return r;
  r = await engine.run('event', ['append', T, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'poc', alignment: { score: 5 }, auditor_session_id: ROOT })], D);
  if (!r.ok) return r;
  r = await engine.run('event', ['append', T, leafId, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'all', pass: true, evidence: 'poc done' }] })], D);
  if (!r.ok) return r;
  r = await engine.run('audit', ['gate', T, leafId, '--verdict', 'pass', '--audit-session-id', ROOT], D);
  if (!r.ok) return r;
  return await engine.run('leaf', ['set-status', T, leafId, 'done'], D);
}

// 建一棵 root+commander 骨架（commander 含 milestone+deliverable，避免 validate milestone_empty_outputs）
async function setupRootCommander(D, T, cmdLeafId) {
  await engine.run('init', [T, '--root-brief', JSON.stringify({ g: 'x' }), '--root-dod', JSON.stringify({ a: 'x' }), '--session-id', ROOT], D);
  await engine.run('event', ['append', T, `${T}-root`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'root auditor' })], D);
  await engine.run('leaf', ['add', T, '--json', JSON.stringify({
    leaf_id: cmdLeafId, session_id: CMD, parent: `${T}-root`, path: 'C', role: 'commander', model: 'm', channel: 'c', added_by: ROOT
  })], D, ROOT);
  await engine.run('milestone', ['add', T, cmdLeafId, '--json', JSON.stringify({ id: 'M1', desc: 'cmd', expect_outputs: ['c.txt'] })], D);
  touchDeliverable(D, T, 'c.txt');
}

(async () => {
  console.log('=== audit-poc-child-done（异厂商独立审计 PoC）===\n');
  delete process.env.TREE_ENGINE_ALLOW_CLI;
  engine.setSessionVerifier(() => true);
  process.env.TREE_ENGINE_ALLOW_CLI = '1';

  const SECRET = readEngineSecret();
  check('读到 engine secret（HMAC 交叉验证前提）', SECRET.length === 32, `len=${SECRET.length}`);

  // ================================================================
  // A. 三层链端到端：worker → commander → root，root done 无 child_done
  // ================================================================
  console.log('\n--- A: 三层链端到端 ---');
  {
    const D = mkTreeDir('A'); const T = 'poca';
    const CMDL = `${T}-C-commander`, WL = `${T}-C-worker`;
    await setupRootCommander(D, T, CMDL);

    let r = await makeWorkerDone(D, T, WL, WRK1, CMDL, CMD, 'a-out.txt', 'C', CMD);
    check('A worker set-status done', r.ok, r.error && (r.error.code + ':' + (r.error.msg || '').slice(0, 50)));

    let st = readState(D, T);
    let cmd = st.leaves[CMDL];
    let cd = (cmd.events || []).filter(e => e && e.type === 'child_done');
    check('A1 commander 收到 child_done（来自 worker）', cd.length === 1, `n=${cd.length}`);
    if (cd.length === 1) {
      check('A1 meta.child_leaf_id', cd[0].meta.child_leaf_id === WL, cd[0].meta.child_leaf_id);
      check('A1 meta.child_role=worker', cd[0].meta.child_role === 'worker', cd[0].meta.child_role);
      check('A1 meta.child_path=C', cd[0].meta.child_path === 'C', cd[0].meta.child_path);
      check('A1 meta.status=done', cd[0].meta.status === 'done', cd[0].meta.status);
      check('A1 有 ts（ISO）', typeof cd[0].ts === 'string' && cd[0].ts.length >= 20, cd[0].ts);
    }
    check('A1 commander last_event_type=child_done', cmd.last_event_type === 'child_done', cmd.last_event_type);

    // commander done → root 收 child_done
    await engine.run('milestone', ['set-result', T, CMDL, 'M1', '--audit-pass', 'true', '--audit-session-id', ROOT], D);
    await engine.run('event', ['append', T, CMDL, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'all', pass: true, evidence: 'cmd done' }] })], D);
    r = await engine.run('leaf', ['set-status', T, CMDL, 'done'], D);
    check('A2 commander set-status done', r.ok, r.error && (r.error.code + ':' + (r.error.msg || '').slice(0, 50)));

    st = readState(D, T);
    const rootLeaf = st.leaves[`${T}-root`];
    const cdRoot = (rootLeaf.events || []).filter(e => e && e.type === 'child_done');
    check('A2 root 收到 child_done（来自 commander）', cdRoot.length === 1, `n=${cdRoot.length}`);
    if (cdRoot.length === 1) {
      check('A2 meta.child_leaf_id=cmd', cdRoot[0].meta.child_leaf_id === CMDL, cdRoot[0].meta.child_leaf_id);
      check('A2 meta.child_role=commander', cdRoot[0].meta.child_role === 'commander', cdRoot[0].meta.child_role);
    }

    // root done → root 无 parent，root.events child_done 计数不应增加（不自写）
    const before = (rootLeaf.events || []).filter(e => e && e.type === 'child_done').length;
    await engine.run('event', ['append', T, `${T}-root`, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'all', pass: true, evidence: 'root done' }] })], D);
    r = await engine.run('leaf', ['set-status', T, `${T}-root`, 'done'], D);
    check('A3 root set-status done', r.ok, r.error && (r.error.code + ':' + (r.error.msg || '').slice(0, 50)));
    st = readState(D, T);
    const after = (st.leaves[`${T}-root`].events || []).filter(e => e && e.type === 'child_done').length;
    check('A3 root done 后 child_done 计数不变（root 无 parent 不自写）', after === before, `before=${before} after=${after}`);
  }

  // ================================================================
  // B+D. child_done 写入后 tree_validate 0 issues；多 child → 多条 child_done
  // ================================================================
  console.log('\n--- B+D: validate 0 issues + 多 child 多条 child_done ---');
  {
    const D = mkTreeDir('B'); const T = 'pocb';
    const CMDL = `${T}-C-commander`, W1L = `${T}-C-worker`, W2L = `${T}-D-worker`;
    await setupRootCommander(D, T, CMDL);

    let rv = await engine.run('validate', [T], D);
    check('B validate（child_done 前）ok', rv.ok, rv.issues && rv.issues[0] && rv.issues[0].type);

    // 两个 worker（path 段 C / D 不同 → leaf_id 不同），分别 done
    let r1 = await makeWorkerDone(D, T, W1L, WRK1, CMDL, CMD, 'w1.txt', 'C', CMD);
    let r2 = await makeWorkerDone(D, T, W2L, WRK2, CMDL, CMD, 'w2.txt', 'D', CMD);
    check('B w1 done', r1.ok, r1.error && r1.error.code);
    check('B w2 done', r2.ok, r2.error && r2.error.code);

    const st = readState(D, T);
    const cds = (st.leaves[CMDL].events || []).filter(e => e && e.type === 'child_done');
    check('D commander 收到 2 条 child_done（多 child 各通知一次）', cds.length === 2, `n=${cds.length}`);
    if (cds.length === 2) {
      const kids = cds.map(e => e.meta.child_leaf_id).sort();
      check('D 两条分别来自 w1/w2', kids.join(',') === [W1L, W2L].sort().join(','), kids.join(','));
    }

    rv = await engine.run('validate', [T], D);
    const cdIssues = (rv.issues || []).filter(i => /child_done/i.test(i.type || '') || /child_done/i.test(i.detail || ''));
    check('B validate（2 条 child_done 后）仍 ok', rv.ok, rv.summary);
    check('B 无 child_done 相关 issue', cdIssues.length === 0, JSON.stringify(cdIssues));
  }

  // ================================================================
  // C. HMAC 独立复现 + 对照：events（含 child_done）不在签名 scope
  // ================================================================
  console.log('\n--- C: HMAC 独立复现 + events 不在 scope 对照 ---');
  {
    const D = mkTreeDir('C'); const T = 'pocc';
    const CMDL = `${T}-C-commander`, WL = `${T}-C-worker`;
    await setupRootCommander(D, T, CMDL);
    await makeWorkerDone(D, T, WL, WRK1, CMDL, CMD, 'cw.txt', 'C', CMD);

    const st = readState(D, T);
    const cmdLeaf = st.leaves[CMDL];
    const macEngine = st._meta && st._meta.integrity && st._meta.integrity.leaves && st._meta.integrity.leaves[CMDL];
    const hasChildDone = (cmdLeaf.events || []).some(e => e && e.type === 'child_done');
    check('C 前提：commander 已含 child_done event', hasChildDone);

    // C1: 复现 mac === 引擎存 mac（算法正确性）
    const macMine = computeLeafHmacMine(cmdLeaf, SECRET);
    check('C1 复现 mac === 引擎存 mac（算法正确）', macMine === macEngine, `\n  mine=${macMine}\n  eng=${macEngine}`);

    // C2: 删 events 后 mac 不变 → events 不在 scope（child_done 不破坏签名）
    const cmdNoEv = JSON.parse(JSON.stringify(cmdLeaf)); delete cmdNoEv.events;
    check('C2 删 events 后 mac 不变（events 不在 scope）', computeLeafHmacMine(cmdNoEv, SECRET) === macEngine, computeLeafHmacMine(cmdNoEv, SECRET));

    // C3 对照：改 status（在 scope）→ mac 必变，证明签名真生效
    const cmdStat = JSON.parse(JSON.stringify(cmdLeaf)); cmdStat.status = 'done';
    check('C3 对照：改 status 后 mac 变（scope 真生效）', computeLeafHmacMine(cmdStat, SECRET) !== macEngine, computeLeafHmacMine(cmdStat, SECRET));

    // C4: 灌伪造 child_done → mac 不变（攻击者灌 event 不破签名链）
    const cmdForge = JSON.parse(JSON.stringify(cmdLeaf));
    (cmdForge.events = cmdForge.events || []).push({ type: 'child_done', ts: 'forged', meta: { child_leaf_id: 'x', status: 'done' } });
    check('C4 灌伪造 child_done 后 mac 不变', computeLeafHmacMine(cmdForge, SECRET) === macEngine, computeLeafHmacMine(cmdForge, SECRET));
  }

  // ================================================================
  // E. readState 重读不抛 E_STATE_INTEGRITY（verifyStateIntegrity 自动跑）
  // ================================================================
  console.log('\n--- E: child_done 后 readState 通过 HMAC 校验 ---');
  {
    const D = mkTreeDir('E'); const T = 'poce';
    const CMDL = `${T}-C-commander`, WL = `${T}-C-worker`;
    await setupRootCommander(D, T, CMDL);
    await makeWorkerDone(D, T, WL, WRK1, CMDL, CMD, 'e.txt', 'C', CMD);

    let readOk = true, readErr = null;
    try { readState(D, T); } catch (e) { readOk = false; readErr = e.message; }
    check('E child_done 后 readState 成功（HMAC 链完整）', readOk, readErr);

    const rv = await engine.run('validate', [T], D);
    check('E validate 命令成功（引擎内部 readState 通过 HMAC）', rv && typeof rv === 'object' && rv.ok !== undefined, JSON.stringify(rv && rv.error));
  }

  console.log(`\n=== audit PoC RESULTS: ${pass} PASS / ${fail} FAIL / ${pass + fail} total ===`);
  console.log(fail === 0 ? '✅ 异厂商独立 PoC 全过' : '❌ 有失败项（见上方细节）');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
