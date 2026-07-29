/**
 * child_done 事件机制单测（轮 1, 2026-07-29）
 * 验证 leaf done 成功后引擎自动给 parent leaf 写 child_done 事件。
 *
 * 用法：
 *   node tests/child-done-event.test.cjs
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

const ROOT = '11111111-2222-4333-8444-555555555555';
const CMD  = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CMD2 = 'cccccccc-dddd-4eee-8fff-999999999999';
const WRK  = '66666666-7777-4888-8999-aaaaaaaabbbb';
const WRK3 = 'bbbbbbbb-cccc-4ddd-8eee-ffffffff1111';

function mkTreeDir(label) {
  const d = path.join(os.tmpdir(), `cd-test-${label}-${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readState(dir, treeId) {
  const sp = path.join(dir, treeId, 'tree-state.json');
  return JSON.parse(fs.readFileSync(sp, 'utf8'));
}

// 写 deliverable 文件（绕过 done 门禁 E_DELIVERABLE_MISSING）
function touchDeliverable(dir, treeId, relPath) {
  const full = path.join(dir, treeId, 'deliverables', relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'test deliverable for child_done event test\n', 'utf8');
}

(async () => {
  console.log('=== child_done 事件机制单测 ===\n');

  delete process.env.TREE_ENGINE_ALLOW_CLI;
  engine.setSessionVerifier(() => true);

  // ================================================================
  // T1: worker done → parent（commander）events 含 type=child_done
  // ================================================================
  console.log('--- T1: worker done → parent commander events 含 child_done ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t1');
    const T = 'cdt1';

    let r = await engine.run('init', [T, '--root-brief', JSON.stringify({ g: 't1' }), '--root-dod', JSON.stringify({ a: 't1' }), '--session-id', ROOT], D);
    check('T1 init tree', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // root needs ≥1 event to serve as auditor
    r = await engine.run('event', ['append', T, `${T}-root`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'root brief for auditor eligibility' })], D);
    check('T1 root brief_echo', r.ok, r.error && r.error.code);

    // add commander C under root
    r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
      leaf_id: `${T}-C-commander`, session_id: CMD, parent: `${T}-root`,
      path: 'C', role: 'commander', model: 'm', channel: 'c', added_by: ROOT
    })], D, ROOT);
    check('T1 add commander', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // add worker W under commander
    r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
      leaf_id: `${T}-C-worker`, session_id: WRK, parent: `${T}-C-commander`,
      path: 'C', role: 'worker', model: 'm', channel: 'c', added_by: CMD
    })], D, CMD);
    check('T1 add worker', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // milestone + deliverable for worker
    r = await engine.run('milestone', ['add', T, `${T}-C-worker`, '--json', JSON.stringify({
      id: 'M1', desc: 'test milestone', expect_outputs: ['w-out.txt']
    })], D);
    check('T1 milestone add', r.ok, r.error && r.error.code);
    touchDeliverable(D, T, 'w-out.txt');

    // set milestone audit_pass=true (root as auditor)
    r = await engine.run('milestone', ['set-result', T, `${T}-C-worker`, 'M1', '--audit-pass', 'true', '--audit-session-id', ROOT], D);
    check('T1 milestone set-result audit_pass=true', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // brief_echo + done events for worker (required for worker done gate)
    // brief_echo must carry alignment + auditor_session_id for audit_gate pass
    r = await engine.run('event', ['append', T, `${T}-C-worker`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'test', alignment: { score: 5 }, auditor_session_id: ROOT })], D);
    check('T1 worker brief_echo', r.ok, r.error && r.error.code);

    r = await engine.run('event', ['append', T, `${T}-C-worker`, '--type', 'done', '--json', JSON.stringify({
      self_check: [{ item: 'all', pass: true, evidence: 'test done for child_done' }]
    })], D);
    check('T1 worker done event', r.ok, r.error && r.error.code);

    // worker default audit_gate=required → need pass before done
    r = await engine.run('audit', ['gate', T, `${T}-C-worker`, '--verdict', 'pass', '--audit-session-id', ROOT], D);
    check('T1 worker audit_gate pass', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));
    // ACTION: set worker status to done
    r = await engine.run('leaf', ['set-status', T, `${T}-C-worker`, 'done'], D);
    check('T1 worker set-status done', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // VERIFY: commander events contains child_done
    const st = readState(D, T);
    const commander = st.leaves[`${T}-C-commander`];
    const cdEvents = (Array.isArray(commander.events) ? commander.events : []).filter(e => e && e.type === 'child_done');
    check('T1 commander events 含 child_done', cdEvents.length === 1, `found ${cdEvents.length}`);
    if (cdEvents.length === 1) {
      const cd = cdEvents[0];
      check('T1 child_done.meta.child_leaf_id = worker', cd.meta.child_leaf_id === `${T}-C-worker`, cd.meta.child_leaf_id);
      check('T1 child_done.meta.child_role = worker', cd.meta.child_role === 'worker', cd.meta.child_role);
      check('T1 child_done.meta.child_path = C', cd.meta.child_path === 'C', cd.meta.child_path);
      check('T1 child_done.meta.status = done', cd.meta.status === 'done', cd.meta.status);
    }
    check('T1 commander last_event_type = child_done', commander.last_event_type === 'child_done', commander.last_event_type);

    delete process.env.TREE_ENGINE_ALLOW_CLI;
    // keep D for T5 (same tree)
  }

  // ================================================================
  // T2: commander done → parent（root）events 含 child_done
  // ================================================================
  console.log('\n--- T2: commander done → parent root events 含 child_done ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t2');
    const T = 'cdt2';

    let r = await engine.run('init', [T, '--root-brief', JSON.stringify({ g: 't2' }), '--root-dod', JSON.stringify({ a: 't2' }), '--session-id', ROOT], D);
    check('T2 init tree', r.ok, r.error && r.error.code);

    // root needs ≥1 event to serve as auditor
    r = await engine.run('event', ['append', T, `${T}-root`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'root brief' })], D);
    check('T2 root brief_echo', r.ok, r.error && r.error.code);

    // add commander C2 under root (no children — will pass children check)
    r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
      leaf_id: `${T}-X-commander`, session_id: CMD2, parent: `${T}-root`,
      path: 'X', role: 'commander', model: 'm', channel: 'c', added_by: ROOT
    })], D, ROOT);
    check('T2 add commander', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // milestone + deliverable for commander
    r = await engine.run('milestone', ['add', T, `${T}-X-commander`, '--json', JSON.stringify({
      id: 'M1', desc: 'test', expect_outputs: ['c-out.txt']
    })], D);
    check('T2 milestone add', r.ok, r.error && r.error.code);
    touchDeliverable(D, T, 'c-out.txt');

    // set milestone audit_pass=true (root as auditor)
    r = await engine.run('milestone', ['set-result', T, `${T}-X-commander`, 'M1', '--audit-pass', 'true', '--audit-session-id', ROOT], D);
    check('T2 milestone set-result', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // done event for commander
    r = await engine.run('event', ['append', T, `${T}-X-commander`, '--type', 'done', '--json', JSON.stringify({
      self_check: [{ item: 'all', pass: true, evidence: 'commander done for child_done test' }]
    })], D);
    check('T2 commander done event', r.ok, r.error && r.error.code);

    // ACTION: set commander status to done
    r = await engine.run('leaf', ['set-status', T, `${T}-X-commander`, 'done'], D);
    check('T2 commander set-status done', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // VERIFY: root events contains child_done for commander
    const st = readState(D, T);
    const root = st.leaves[`${T}-root`];
    const cdEvents = (Array.isArray(root.events) ? root.events : []).filter(e => e && e.type === 'child_done');
    check('T2 root events 含 child_done', cdEvents.length === 1, `found ${cdEvents.length}`);
    if (cdEvents.length >= 1) {
      const cd = cdEvents[0];
      check('T2 child_done.meta.child_leaf_id = commander', cd.meta.child_leaf_id === `${T}-X-commander`, cd.meta.child_leaf_id);
      check('T2 child_done.meta.child_role = commander', cd.meta.child_role === 'commander', cd.meta.child_role);
    }

    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T3: root done → 无 parent，不写 child_done（不报错）
  // ================================================================
  console.log('\n--- T3: root done → 无 parent，不写 child_done ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t3');
    const T = 'cdt3';

    let r = await engine.run('init', [T, '--root-brief', JSON.stringify({ g: 't3' }), '--root-dod', JSON.stringify({ a: 't3' }), '--session-id', ROOT], D);
    check('T3 init tree', r.ok, r.error && r.error.code);

    // root done requires done event (line 2100-2108), exempt from milestones (isRoot check)
    r = await engine.run('event', ['append', T, `${T}-root`, '--type', 'done', '--json', JSON.stringify({
      self_check: [{ item: 'all', pass: true, evidence: 'root done test' }]
    })], D);
    check('T3 root done event', r.ok, r.error && r.error.code);

    // ACTION: set root to done (root has no children → children check passes)
    r = await engine.run('leaf', ['set-status', T, `${T}-root`, 'done'], D);
    check('T3 root set-status done', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // VERIFY: root.events should NOT contain child_done (root has no parent)
    const st = readState(D, T);
    const rootLeaf = st.leaves[`${T}-root`];
    const cdSelf = (Array.isArray(rootLeaf.events) ? rootLeaf.events : [])
      .filter(e => e && e.type === 'child_done');
    check('T3 root.events 不含 child_done（root 无 parent）', cdSelf.length === 0, `found ${cdSelf.length} child_done events`);

    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T4: leaf done 但 parent 已 pruned/archived → 跳过（不报错，done 仍成功）
  //     测试 archived parent 场景：archived 不级联，子 leaf 仍可存在且 done
  // ================================================================
  console.log('\n--- T4: parent archived → 跳过 child_done（done 仍成功）---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t4');
    const T = 'cdt4';

    let r = await engine.run('init', [T, '--root-brief', JSON.stringify({ g: 't4' }), '--root-dod', JSON.stringify({ a: 't4' }), '--session-id', ROOT], D);
    check('T4 init tree', r.ok, r.error && r.error.code);

    // root brief_echo for auditor eligibility
    r = await engine.run('event', ['append', T, `${T}-root`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'root for auditor' })], D);
    check('T4 root brief_echo', r.ok, r.error && r.error.code);

    // add commander C3 under root
    r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
      leaf_id: `${T}-Z-commander`, session_id: CMD2, parent: `${T}-root`,
      path: 'Z', role: 'commander', model: 'm', channel: 'c', added_by: ROOT
    })], D, ROOT);
    check('T4 add commander', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // Set up commander C3 for done (no children, so children check passes)
    r = await engine.run('milestone', ['add', T, `${T}-Z-commander`, '--json', JSON.stringify({
      id: 'M1', desc: 'test', expect_outputs: ['c3-out.txt']
    })], D);
    check('T4 milestone add', r.ok, r.error && r.error.code);
    touchDeliverable(D, T, 'c3-out.txt');

    r = await engine.run('milestone', ['set-result', T, `${T}-Z-commander`, 'M1', '--audit-pass', 'true', '--audit-session-id', ROOT], D);
    check('T4 milestone set-result', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    r = await engine.run('event', ['append', T, `${T}-Z-commander`, '--type', 'done', '--json', JSON.stringify({
      self_check: [{ item: 'all', pass: true, evidence: 'C3 done' }]
    })], D);
    check('T4 C3 done event', r.ok, r.error && r.error.code);

    // Commander done (no children)
    r = await engine.run('leaf', ['set-status', T, `${T}-Z-commander`, 'done'], D);
    check('T4 C3 set-status done', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // Archive commander C3 (done→archived, no cascade)
    r = await engine.run('leaf', ['set-status', T, `${T}-Z-commander`, 'archived'], D);
    check('T4 C3 archived', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // Add worker W3 under archived commander
    r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
      leaf_id: `${T}-Z-worker`, session_id: WRK3, parent: `${T}-Z-commander`,
      path: 'Z', role: 'worker', model: 'm', channel: 'c', added_by: CMD2
    })], D, CMD2);
    check('T4 add worker under archived parent', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // Set up W3 for done
    r = await engine.run('milestone', ['add', T, `${T}-Z-worker`, '--json', JSON.stringify({
      id: 'M1', desc: 'test', expect_outputs: ['w3-out.txt']
    })], D);
    check('T4 W3 milestone add', r.ok, r.error && r.error.code);
    touchDeliverable(D, T, 'w3-out.txt');

    r = await engine.run('milestone', ['set-result', T, `${T}-Z-worker`, 'M1', '--audit-pass', 'true', '--audit-session-id', ROOT], D);
    check('T4 W3 milestone set-result', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    r = await engine.run('event', ['append', T, `${T}-Z-worker`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'test', alignment: { score: 5 }, auditor_session_id: ROOT })], D);
    check('T4 W3 brief_echo', r.ok, r.error && r.error.code);

    r = await engine.run('event', ['append', T, `${T}-Z-worker`, '--type', 'done', '--json', JSON.stringify({
      self_check: [{ item: 'all', pass: true, evidence: 'W3 done under archived parent' }]
    })], D);
    check('T4 W3 done event', r.ok, r.error && r.error.code);

    // worker default audit_gate=required → need pass
    r = await engine.run('audit', ['gate', T, `${T}-Z-worker`, '--verdict', 'pass', '--audit-session-id', ROOT], D);
    check('T4 W3 audit_gate pass', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // ACTION: set W3 to done — parent is archived, _notifyParentChildDone should skip
    r = await engine.run('leaf', ['set-status', T, `${T}-Z-worker`, 'done'], D);
    check('T4 W3 set-status done（parent archived，done 仍成功）', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // VERIFY: C3 events should NOT contain child_done from W3 (parent was archived → skipped)
    const st = readState(D, T);
    const archivedCommander = st.leaves[`${T}-Z-commander`];
    const cdFromW3 = (Array.isArray(archivedCommander.events) ? archivedCommander.events : [])
      .filter(e => e && e.type === 'child_done' && e.meta && e.meta.child_leaf_id === `${T}-Z-worker`);
    check('T4 archived parent 不含 W3 的 child_done', cdFromW3.length === 0, `found ${cdFromW3.length} (should skip archived parent)`);

    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  // T5: child_done event 不触发 parent done 门禁
  //     （child_done 写后 parent 仍 active，需独立 done 流程）
  // ================================================================
  console.log('\n--- T5: child_done 不触发 parent done 门禁 ---');
  {
    process.env.TREE_ENGINE_ALLOW_CLI = '1';
    const D = mkTreeDir('t5');
    const T = 'cdt5';

    let r = await engine.run('init', [T, '--root-brief', JSON.stringify({ g: 't5' }), '--root-dod', JSON.stringify({ a: 't5' }), '--session-id', ROOT], D);
    check('T5 init tree', r.ok, r.error && r.error.code);

    // root brief_echo for auditor eligibility
    r = await engine.run('event', ['append', T, `${T}-root`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'root for auditor' })], D);
    check('T5 root brief_echo', r.ok, r.error && r.error.code);

    // add commander
    r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
      leaf_id: `${T}-P-commander`, session_id: CMD, parent: `${T}-root`,
      path: 'P', role: 'commander', model: 'm', channel: 'c', added_by: ROOT
    })], D, ROOT);
    check('T5 add commander', r.ok, r.error && r.error.code);

    // add worker under commander
    r = await engine.run('leaf', ['add', T, '--json', JSON.stringify({
      leaf_id: `${T}-P-worker`, session_id: WRK, parent: `${T}-P-commander`,
      path: 'P', role: 'worker', model: 'm', channel: 'c', added_by: CMD
    })], D, CMD);
    check('T5 add worker', r.ok, r.error && r.error.code);

    // set up worker for done
    r = await engine.run('milestone', ['add', T, `${T}-P-worker`, '--json', JSON.stringify({
      id: 'M1', desc: 'test', expect_outputs: ['t5-out.txt']
    })], D);
    check('T5 milestone add', r.ok, r.error && r.error.code);
    touchDeliverable(D, T, 't5-out.txt');

    r = await engine.run('milestone', ['set-result', T, `${T}-P-worker`, 'M1', '--audit-pass', 'true', '--audit-session-id', ROOT], D);
    check('T5 milestone set-result', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    r = await engine.run('event', ['append', T, `${T}-P-worker`, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'test', alignment: { score: 5 }, auditor_session_id: ROOT })], D);
    check('T5 worker brief_echo', r.ok, r.error && r.error.code);

    r = await engine.run('event', ['append', T, `${T}-P-worker`, '--type', 'done', '--json', JSON.stringify({
      self_check: [{ item: 'all', pass: true, evidence: 'worker done for T5' }]
    })], D);
    check('T5 worker done event', r.ok, r.error && r.error.code);

    // worker default audit_gate=required → need pass
    r = await engine.run('audit', ['gate', T, `${T}-P-worker`, '--verdict', 'pass', '--audit-session-id', ROOT], D);
    check('T5 worker audit_gate pass', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // Set worker to done → child_done written to commander
    r = await engine.run('leaf', ['set-status', T, `${T}-P-worker`, 'done'], D);
    check('T5 worker set-status done', r.ok, r.error && (r.error.code + ': ' + (r.error.msg || '').slice(0, 60)));

    // VERIFY: commander has child_done event
    let st = readState(D, T);
    let cmdr = st.leaves[`${T}-P-commander`];
    const hasChildDone = (Array.isArray(cmdr.events) ? cmdr.events : [])
      .some(e => e && e.type === 'child_done');
    check('T5 commander 有 child_done 事件', hasChildDone);

    // KEY ASSERTION: commander status is STILL active (not done)
    // child_done is just a notification, it does NOT trigger the done gate
    check('T5 commander status 仍为 active（child_done 不触发 done 门禁）',
      cmdr.status === 'active' || cmdr.status === 'pending_brief',
      `status=${cmdr.status}`);

    // Verify: commander CANNOT be set to done without its own done event + milestones
    // (it has an active child that IS done, but still needs its own gate)
    r = await engine.run('leaf', ['set-status', T, `${T}-P-commander`, 'done'], D);
    check('T5 commander 无 done event 时 set-status done 被拒绝',
      !r.ok,
      r.ok ? 'SHOULD HAVE BEEN REJECTED (gate bypassed!)' : r.error.code);

    delete process.env.TREE_ENGINE_ALLOW_CLI;
  }

  // ================================================================
  console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL / ${pass + fail} total ===`);
  console.log(fail === 0 ? '✅ child_done 事件机制单测全过' : '❌ 有失败项');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
