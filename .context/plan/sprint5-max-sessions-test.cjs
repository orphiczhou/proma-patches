#!/usr/bin/env node
/**
 * sprint5-max-sessions-test.cjs — Sprint 5 / 聚类 A+E：max_sessions 引擎硬护栏测试 (2026-07-14)
 *
 * 被测改动 (tree-engine.cjs, Sprint 5):
 *   - E_MAX_SESSIONS 错误码 + audit_meta.max_sessions（默认 50）
 *   - tree-state.session_registry：distinct session 登记簿（leaf_add / set-session / register-session / init root 四路径）
 *   - countSessions / getMaxSessions / registerSessionToState（PENDING_ROOT/非UUID 不占额度）
 *   - tree register-session（旁路登记，供 patches create_session）/ tree session-count（预检）
 *   - migrate 规则14 回灌旧树 session_registry
 *   - findTreesBySession 导出（供 patches 定位 caller 所属 tree）
 *
 * 测试矩阵 (16):
 *   T1  init 真实 root UUID → registry 1 + count 1
 *   T2  init PENDING_ROOT（不传 session）→ registry 0（root 不占额度）
 *   T3  leaf_add 登记 → count 增长 + registry entry 字段（leaf_id/source/caller）
 *   T4  max_sessions 拦 leaf_add（projected > max → E_MAX_SESSIONS）
 *   T5  register-session 旁路登记成功 + source='create_session'
 *   T6  register-session 去重（已登记 → registered=false，count 不变）
 *   T7  register-session 超 max → E_MAX_SESSIONS
 *   T8  set-session 登记（堵绕过链）→ count 增长
 *   T9  set-session 超 max → E_MAX_SESSIONS
 *   T10 session-count reached 边界（count==max → reached=true）
 *   T11 max_sessions 自定义（audit_meta 覆盖默认 50）
 *   T12 migrate 回灌（旧树无 session_registry → 回灌 leaves session）
 *   T13 node_budget vs max_sessions 独立（node_budget 宽 / max_sessions 紧 → max_sessions 先拦）
 *   T14 findTreesBySession 命中 leaves[].session_id
 *   T15 findTreesBySession 命中 session_registry（旁路登记可见）
 *   T16 findTreesBySession 未命中 → []
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 's5-maxsess-'));
// mock verifier：占位 UUID（00000000-...-0000000000XX）放行，其余判 not alive（与 sprint3 同模式）
engine.setSessionVerifier((sid) => /^00000000-0000-0000-0000-[0-9a-f]{12}$/i.test(sid));

const UUID = {
  root:  '00000000-0000-0000-0000-000000000001',
  c1:    '00000000-0000-0000-0000-000000000010',
  w1:    '00000000-0000-0000-0000-000000000101',
  w2:    '00000000-0000-0000-0000-000000000102',
  w3:    '00000000-0000-0000-0000-000000000103',
  bp1:   '00000000-0000-0000-0000-00000000b001',  // bypass register-session 用
  bp2:   '00000000-0000-0000-0000-00000000b002',
  ss1:   '00000000-0000-0000-0000-000000005001',  // set-session 换的新 session
};

async function run(caller, cmdArgs) {
  const cmd = cmdArgs[0];
  const args = cmdArgs.slice(1);
  return engine.run(cmd, args, SANDBOX, caller || null);
}

let counter = 0;
function freshTreeId() { counter++; return `s5ms${counter}`; }

async function initTree(tid, opts) {
  opts = opts || {};
  const auditMeta = opts.audit_meta || {};
  const args = ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 's5 max_sessions test' }),
    '--root-dod', JSON.stringify({ deliverables: ['out.md'], node_budget: opts.node_budget || 30 }),
    '--model', 'glm-5-2', '--channel', 'zlm'];
  if (opts.rootSession !== undefined && opts.rootSession !== null) args.push('--session-id', opts.rootSession);
  if (Object.keys(auditMeta).length) args.push('--audit-meta', JSON.stringify(auditMeta));
  return run(null, args);
}

async function addLeaf(caller, tid, leaf_id, session_id, parent, role, pathSeg) {
  return run(caller, ['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id, session_id, parent, path: pathSeg, role, model: 'glm-5-2', channel: 'zlm', added_by: caller,
  })]);
}

function readState(tree_id) {
  return JSON.parse(fs.readFileSync(path.join(SANDBOX, tree_id, 'tree-state.json'), 'utf8'));
}

async function sessionCount(tid) {
  const r = await run(null, ['tree', 'session-count', tid]);
  return r;
}
async function registerSession(tid, sid, caller, source) {
  return run(null, ['tree', 'register-session', tid, '--session-id', sid, '--source', source || 'create_session', ...(caller ? ['--caller', caller] : [])]);
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function assert(cond, name, info) { if (cond) pass(name, info); else fail(name, info); }

// ============================================================
async function main() {
  console.log(`Sprint 5 max_sessions test — sandbox: ${SANDBOX}`);
  console.log(`engine md5 基线：authority source (D:/codes/tree-harness/tree-engine.cjs)\n`);

  // T1: init 真实 root UUID → registry 1 + count 1
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    const st = readState(tid);
    const sc = await sessionCount(tid);
    assert(Object.keys(st.session_registry).length === 1, 'T1 init root UUID → registry 1', `got ${Object.keys(st.session_registry).length}`);
    assert(sc.ok && sc.count === 1 && sc.max === 50 && sc.reached === false, 'T1 session-count count=1 max=50', `count=${sc.count} max=${sc.max}`);
    assert(st.session_registry[UUID.root] && st.session_registry[UUID.root].leaf_id === `${tid}-root`, 'T1 registry entry leaf_id=root', JSON.stringify(st.session_registry[UUID.root]));
  }

  // T2: init PENDING_ROOT（不传 session）→ registry 0（root 不占额度）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: null });  // 不传 --session-id → PENDING_ROOT
    const st = readState(tid);
    const sc = await sessionCount(tid);
    assert(Object.keys(st.session_registry).length === 0, 'T2 PENDING_ROOT → registry 0（不占额度）', `got ${Object.keys(st.session_registry).length}`);
    assert(sc.ok && sc.count === 0, 'T2 session-count count=0', `count=${sc.count}`);
    assert(st.leaves[`${tid}-root`].session_id === 'PENDING_ROOT', 'T2 root leaf session=PENDING_ROOT', st.leaves[`${tid}-root`].session_id);
  }

  // T3: leaf_add 登记 → count 增长 + registry entry 字段
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    const leaf = `${tid}-L1-worker`;
    const r = await addLeaf(UUID.root, tid, leaf, UUID.w1, `${tid}-root`, 'worker', 'L1');
    assert(r.ok, 'T3 leaf_add ok', r.error && r.error.code);
    const st = readState(tid);
    const sc = await sessionCount(tid);
    assert(Object.keys(st.session_registry).length === 2, 'T3 registry 2（root+w1）', `got ${Object.keys(st.session_registry).length}`);
    assert(sc.count === 2, 'T3 count=2', `count=${sc.count}`);
    const entry = st.session_registry[UUID.w1];
    assert(entry && entry.leaf_id === leaf && entry.source === 'leaf_add' && entry.caller === UUID.root, 'T3 registry entry 字段', JSON.stringify(entry));
  }

  // T4: max_sessions 拦 leaf_add（projected > max → E_MAX_SESSIONS）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root, audit_meta: { max_sessions: 3 } });
    await addLeaf(UUID.root, tid, `${tid}-L1-worker`, UUID.w1, `${tid}-root`, 'worker', 'L1');  // count=2
    await addLeaf(UUID.root, tid, `${tid}-L1b-worker`, UUID.w2, `${tid}-root`, 'worker', 'L1b'); // count=3=max
    const r3 = await addLeaf(UUID.root, tid, `${tid}-L1c-worker`, UUID.w3, `${tid}-root`, 'worker', 'L1c'); // projected 4>3
    assert(!r3.ok && r3.error && r3.error.code === 'E_MAX_SESSIONS', 'T4 第4 session → E_MAX_SESSIONS', r3.error && r3.error.code);
    // 确认 max 仍是 3（被拦后未污染）
    const sc = await sessionCount(tid);
    assert(sc.count === 3 && sc.max === 3, 'T4 拦截后 count=3 max=3（未污染）', `count=${sc.count} max=${sc.max}`);
  }

  // T5: register-session 旁路登记成功 + source='create_session'
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    const r = await registerSession(tid, UUID.bp1, UUID.root, 'create_session');
    assert(r.ok && r.registered === true, 'T5 register-session registered=true', JSON.stringify(r));
    const st = readState(tid);
    assert(st.session_registry[UUID.bp1] && st.session_registry[UUID.bp1].source === 'create_session', 'T5 registry entry source=create_session', JSON.stringify(st.session_registry[UUID.bp1]));
    assert(st.session_registry[UUID.bp1].leaf_id === null, 'T5 旁路登记 leaf_id=null（无 leaf）', String(st.session_registry[UUID.bp1].leaf_id));
  }

  // T6: register-session 去重（已登记 → registered=false）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    await registerSession(tid, UUID.bp1, UUID.root);
    const before = (await sessionCount(tid)).count;
    const r2 = await registerSession(tid, UUID.bp1, UUID.root);  // 重复
    assert(r2.ok && r2.registered === false, 'T6 重复 register → registered=false', JSON.stringify(r2));
    const after = (await sessionCount(tid)).count;
    assert(before === after, 'T6 count 不变（去重）', `before=${before} after=${after}`);
  }

  // T7: register-session 超 max → E_MAX_SESSIONS
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root, audit_meta: { max_sessions: 2 } });
    await registerSession(tid, UUID.bp1, UUID.root);  // count=2=max reached
    const r2 = await registerSession(tid, UUID.bp2, UUID.root);  // +1 → 3>2
    assert(!r2.ok && r2.error && r2.error.code === 'E_MAX_SESSIONS', 'T7 register 超 max → E_MAX_SESSIONS', r2.error && r2.error.code);
  }

  // T8: set-session 登记（堵绕过链）→ count 增长
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    const leaf = `${tid}-L1-worker`;
    await addLeaf(UUID.root, tid, leaf, UUID.w1, `${tid}-root`, 'worker', 'L1');  // count=2
    const before = (await sessionCount(tid)).count;
    // worker 的 added_by=root，set-session caller 必须是 owner(added_by=root)
    const r = await run(UUID.root, ['leaf', 'set-session', tid, leaf, UUID.ss1]);
    assert(r.ok, 'T8 set-session ok', r.error && r.error.code);
    const after = (await sessionCount(tid)).count;
    assert(after === before + 1, 'T8 set-session 后 count+1（新 session 登记）', `before=${before} after=${after}`);
    const st = readState(tid);
    assert(st.session_registry[UUID.ss1] && st.session_registry[UUID.ss1].source === 'set_session', 'T8 registry entry source=set_session', JSON.stringify(st.session_registry[UUID.ss1]));
  }

  // T9: set-session 超 max → E_MAX_SESSIONS
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root, audit_meta: { max_sessions: 2 } });
    const leaf = `${tid}-L1-worker`;
    await addLeaf(UUID.root, tid, leaf, UUID.w1, `${tid}-root`, 'worker', 'L1');  // count=2=max
    const r = await run(UUID.root, ['leaf', 'set-session', tid, leaf, UUID.ss1]);  // +1 → 3>2
    assert(!r.ok && r.error && r.error.code === 'E_MAX_SESSIONS', 'T9 set-session 超 max → E_MAX_SESSIONS', r.error && r.error.code);
    // leaf.session_id 未被污染（干净失败）
    const st = readState(tid);
    assert(st.leaves[leaf].session_id === UUID.w1, 'T9 干净失败 leaf.session_id 未变', st.leaves[leaf].session_id);
  }

  // T10: session-count reached 边界（count==max → reached=true）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root, audit_meta: { max_sessions: 2 } });
    await addLeaf(UUID.root, tid, `${tid}-L1-worker`, UUID.w1, `${tid}-root`, 'worker', 'L1');  // count=2
    const sc = await sessionCount(tid);
    assert(sc.count === 2 && sc.max === 2 && sc.reached === true, 'T10 count==max → reached=true', `count=${sc.count} max=${sc.max} reached=${sc.reached}`);
  }

  // T11: max_sessions 自定义（audit_meta 覆盖默认 50）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root, audit_meta: { max_sessions: 100 } });
    const sc = await sessionCount(tid);
    assert(sc.max === 100, 'T11 audit_meta.max_sessions=100 覆盖默认', `max=${sc.max}`);
  }

  // T12: migrate 回灌（旧树无 session_registry → 回灌 leaves session）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    await addLeaf(UUID.root, tid, `${tid}-L1-worker`, UUID.w1, `${tid}-root`, 'worker', 'L1');
    // 模拟旧树：删 session_registry 字段
    const sp = path.join(SANDBOX, tid, 'tree-state.json');
    const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
    delete st.session_registry;
    fs.writeFileSync(sp, JSON.stringify(st, null, 2));
    // migrate
    const r = await run(null, ['migrate', tid]);
    assert(r.ok, 'T12 migrate ok', r.error && r.error.code);
    const st2 = readState(tid);
    assert(st2.session_registry && Object.keys(st2.session_registry).length === 2, 'T12 回灌 2 session（root+w1）', `got ${st2.session_registry ? Object.keys(st2.session_registry).length : 'null'}`);
    assert(st2.session_registry[UUID.root] && st2.session_registry[UUID.w1], 'T12 回灌 root+w1 均在', JSON.stringify(Object.keys(st2.session_registry)));
    // migrate change 记录
    const backfillChange = r.changes && r.changes.find(c => typeof c.field === 'string' && c.field === 'session_registry');
    assert(backfillChange, 'T12 migrate changes 含 session_registry backfill', JSON.stringify(r.changes && r.changes.filter(c => c.field === 'session_registry')));
  }

  // T13: node_budget vs max_sessions 独立（node_budget 宽 / max_sessions 紧 → max_sessions 先拦）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root, node_budget: 10, audit_meta: { max_sessions: 3 } });
    await addLeaf(UUID.root, tid, `${tid}-L1-worker`, UUID.w1, `${tid}-root`, 'worker', 'L1');  // count=2
    await addLeaf(UUID.root, tid, `${tid}-L1b-worker`, UUID.w2, `${tid}-root`, 'worker', 'L1b'); // count=3=max
    const r3 = await addLeaf(UUID.root, tid, `${tid}-L1c-worker`, UUID.w3, `${tid}-root`, 'worker', 'L1c'); // projected 4>3
    assert(!r3.ok && r3.error && r3.error.code === 'E_MAX_SESSIONS', 'T13 max_sessions=3 先于 node_budget=10 拦', `${r3.error && r3.error.code}（node_budget active=3<10 不会拦，故必为 max_sessions）`);
  }

  // T14: findTreesBySession 命中 leaves[].session_id
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    await addLeaf(UUID.root, tid, `${tid}-L1-worker`, UUID.w1, `${tid}-root`, 'worker', 'L1');
    const found = engine.findTreesBySession(SANDBOX, UUID.w1);
    assert(Array.isArray(found) && found.includes(tid), 'T14 findTreesBySession 命中 leaf session', JSON.stringify(found));
  }

  // T15: findTreesBySession 命中 session_registry（旁路登记可见）
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    await registerSession(tid, UUID.bp1, UUID.root);  // 旁路登记
    const found = engine.findTreesBySession(SANDBOX, UUID.bp1);
    assert(Array.isArray(found) && found.includes(tid), 'T15 findTreesBySession 命中 registry（旁路可见）', JSON.stringify(found));
  }

  // T16: findTreesBySession 未命中 → []
  {
    const tid = freshTreeId();
    await initTree(tid, { rootSession: UUID.root });
    const found = engine.findTreesBySession(SANDBOX, '00000000-0000-0000-0000-0fffunknown00');  // 不存在
    // 注意：未命中应返回不含 tid 的数组（可能含其他 test tree，但不能含本 tid）
    assert(!found.includes(tid), 'T16 未命中 → 不含本 tree', JSON.stringify(found));
    assert(engine.findTreesBySession(SANDBOX, null).length === 0, 'T16 null session → []', 'not empty');
  }

  console.log(`\n========================================`);
  console.log(`Sprint 5 max_sessions: ${stats.passed} passed, ${stats.failed} failed (of 16+ assertions)`);
  console.log(`========================================`);
  process.exit(stats.failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2); });
