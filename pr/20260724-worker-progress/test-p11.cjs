// P1-1 单测：brief_echo 自动转 active + progress event
// 用例 A-E
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const engine = require('D:/Codes/tree-harness/tree-engine.cjs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-p11-'));
engine.setTreesRoot(tmpRoot);
engine.setSessionVerifier(() => true);

const uuid = () => crypto.randomUUID();
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} -- ${detail || ''}`); }
}
async function initTree(tid) {
  const rootSid = uuid();
  const r = await engine.run('init', [tid, '--session-id', rootSid,
    '--root-brief', JSON.stringify({ prefix: tid, parent_intent: 'test' }),
    '--root-dod', JSON.stringify({ node_budget: 20 })], tmpRoot, rootSid);
  if (!r.ok) throw new Error('init failed: ' + (r.error && r.error.msg));
  return { rootSid, rootLeafId: `${tid}-root` };
}
async function addLeaf(tree, leafObj, callerSid) {
  return await engine.run('leaf', ['add', tree, '--json', JSON.stringify(leafObj)], tmpRoot, callerSid);
}
async function dump(tree, callerSid) {
  return (await engine.run('tree', ['dump', tree], tmpRoot, callerSid)).tree;
}

(async () => {
// 用例 A：worker 首条 brief_echo → pending_brief 转 active
console.log('\n[A] worker brief_echo 自动转 active');
{
  const { rootSid, rootLeafId } = await initTree('p11a');
  const wSid = uuid();
  const addR = await addLeaf('p11a', { leaf_id: 'p11a-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('worker 初始 pending_brief', addR.leaf.status === 'pending_brief', addR.leaf.status);
  const r = await engine.run('event', ['append', 'p11a', 'p11a-A1-worker', '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'do X', milestones_preview: ['m1'] })], tmpRoot, wSid);
  check('brief_echo ok', r.ok, JSON.stringify(r.error));
  const t = await dump('p11a', rootSid);
  check('status 转 active', t.leaves['p11a-A1-worker'].status === 'active', t.leaves['p11a-A1-worker'].status);
}

// 用例 B：commander brief_echo 不受影响（初始即 active）
console.log('\n[B] commander brief_echo 不变');
{
  const { rootSid, rootLeafId } = await initTree('p11b');
  const cmdSid = uuid();
  const addR = await addLeaf('p11b', { leaf_id: 'p11b-A-commander', session_id: cmdSid, parent: rootLeafId, path: 'A', role: 'commander', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('commander 初始 active', addR.leaf.status === 'active', addR.leaf.status);
  await engine.run('event', ['append', 'p11b', 'p11b-A-commander', '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'cmd' })], tmpRoot, cmdSid);
  const t = await dump('p11b', rootSid);
  check('commander status 仍 active', t.leaves['p11b-A-commander'].status === 'active', t.leaves['p11b-A-commander'].status);
}

// 用例 C：幂等——第二条 brief_echo（alignment 回填）不改 status
console.log('\n[C] 幂等：第二条 brief_echo 不改 status');
{
  const { rootSid, rootLeafId } = await initTree('p11c');
  // root 先写 plan event（让 root.events 非空，满足闸门2 让 root 当 auditor）
  await engine.run('event', ['append', 'p11c', rootLeafId, '--type', 'plan', '--json', JSON.stringify({ plan_id: 'p1', summary: 'test' })], tmpRoot, rootSid);
  const wSid = uuid();
  await addLeaf('p11c', { leaf_id: 'p11c-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  await engine.run('event', ['append', 'p11c', 'p11c-A1-worker', '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'x' })], tmpRoot, wSid);
  // 第二条 brief_echo（alignment 回填，by root 当 auditor，走闸门2）
  const alignR = await engine.run('event', ['append', 'p11c', 'p11c-A1-worker', '--type', 'brief_echo', '--json', JSON.stringify({ alignment: '0.92 (aligned)', auditor_session_id: rootSid })], tmpRoot, rootSid);
  check('alignment 回填 ok（闸门2 放行）', alignR.ok, JSON.stringify(alignR.error));
  const t = await dump('p11c', rootSid);
  check('幂等：status 仍 active', t.leaves['p11c-A1-worker'].status === 'active', t.leaves['p11c-A1-worker'].status);
  check('alignment_pending 清除', t.leaves['p11c-A1-worker'].alignment_pending === false, String(t.leaves['p11c-A1-worker'].alignment_pending));
}

// 用例 D：progress event 能 append
console.log('\n[D] progress event append');
{
  const { rootSid, rootLeafId } = await initTree('p11d');
  const wSid = uuid();
  await addLeaf('p11d', { leaf_id: 'p11d-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  await engine.run('event', ['append', 'p11d', 'p11d-A1-worker', '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'x' })], tmpRoot, wSid);
  const r = await engine.run('event', ['append', 'p11d', 'p11d-A1-worker', '--type', 'progress', '--json', JSON.stringify({ step: 'coding sec3', percent: 50 })], tmpRoot, wSid);
  check('progress event append ok', r.ok, JSON.stringify(r.error));
  const t = await dump('p11d', rootSid);
  const types = t.leaves['p11d-A1-worker'].events.map(e => e.type);
  check('events 含 progress', types.includes('progress'), JSON.stringify(types));
}

// 用例 E：done event 不自动转 done（status=done 由 set-status 唯一入口）
console.log('\n[E] done event 不自动转 done');
{
  const { rootSid, rootLeafId } = await initTree('p11e');
  const wSid = uuid();
  await addLeaf('p11e', { leaf_id: 'p11e-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  await engine.run('event', ['append', 'p11e', 'p11e-A1-worker', '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: 'x' })], tmpRoot, wSid);
  const r = await engine.run('event', ['append', 'p11e', 'p11e-A1-worker', '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'done', pass: true, evidence: 'file written to deliverables/x.md with content' }] })], tmpRoot, wSid);
  check('done event ok', r.ok, JSON.stringify(r.error));
  const t = await dump('p11e', rootSid);
  check('status 仍 active（done 不自动转）', t.leaves['p11e-A1-worker'].status === 'active', t.leaves['p11e-A1-worker'].status);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
