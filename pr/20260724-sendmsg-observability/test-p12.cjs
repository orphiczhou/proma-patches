// P1-2 单测：tree_log_communication / tree_communication_list
// 用例 A-E
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const engine = require('D:/Codes/tree-harness/tree-engine.cjs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-p12-'));
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
// 用例 A：log + 自动定位 target leaf + 更新 last_event
console.log('\n[A] communication log 定位 target leaf + 更新 last_event');
{
  const { rootSid, rootLeafId } = await initTree('p12a');
  const wSid = uuid();
  await addLeaf('p12a', { leaf_id: 'p12a-A-commander', session_id: uuid(), parent: rootLeafId, path: 'A', role: 'commander', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  await addLeaf('p12a', { leaf_id: 'p12a-A1-worker', session_id: wSid, parent: 'p12a-A-commander', path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const r = await engine.run('communication', ['log', 'p12a', '--target', wSid, '--direction', 'out', '--note', 'send brief'], tmpRoot, rootSid);
  check('log ok', r.ok, JSON.stringify(r.error));
  check('target_leaf_id 定位 worker', r.communication.target_leaf_id === 'p12a-A1-worker', r.communication.target_leaf_id);
  check('direction=out', r.communication.direction === 'out', r.communication.direction);
  check('caller_session_id=root', r.communication.caller_session_id === rootSid, r.communication.caller_session_id);
  const t = await dump('p12a', rootSid);
  check('worker last_event_type=communication_out', t.leaves['p12a-A1-worker'].last_event_type === 'communication_out', t.leaves['p12a-A1-worker'].last_event_type);
  check('communication_log 顶层有 1 条', Array.isArray(t.communication_log) && t.communication_log.length === 1, JSON.stringify(t.communication_log && t.communication_log.length));
}

// 用例 B：target 不在树内（target_leaf_id=null，不崩）
console.log('\n[B] target 不在树内 → target_leaf_id=null');
{
  const { rootSid } = await initTree('p12b');
  const randomSid = uuid();
  const r = await engine.run('communication', ['log', 'p12b', '--target', randomSid, '--direction', 'out'], tmpRoot, rootSid);
  check('log ok (target 不在树内)', r.ok, JSON.stringify(r.error));
  check('target_leaf_id=null', r.communication.target_leaf_id === null, r.communication.target_leaf_id);
}

// 用例 C：note 记录 + 不截内容（无 message 字段）
console.log('\n[C] note 记录 + entry 无 message 字段（不截内容）');
{
  const { rootSid, rootLeafId } = await initTree('p12c');
  const wSid = uuid();
  await addLeaf('p12c', { leaf_id: 'p12c-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const r = await engine.run('communication', ['log', 'p12c', '--target', wSid, '--note', 'nudge: 加快进度'], tmpRoot, rootSid);
  check('note 记录', r.communication.note === 'nudge: 加快进度', r.communication.note);
  check('entry 无 message 字段（不截内容）', !('message' in r.communication), JSON.stringify(r.communication));
  check('entry 有 ts', typeof r.communication.ts === 'string', r.communication.ts);
}

// 用例 D：list 过滤（按 leaf）
console.log('\n[D] communication list 按 leaf 过滤');
{
  const { rootSid, rootLeafId } = await initTree('p12d');
  const w1Sid = uuid(), w2Sid = uuid();
  await addLeaf('p12d', { leaf_id: 'p12d-A-commander', session_id: uuid(), parent: rootLeafId, path: 'A', role: 'commander', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  await addLeaf('p12d', { leaf_id: 'p12d-A1-worker', session_id: w1Sid, parent: 'p12d-A-commander', path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  await addLeaf('p12d', { leaf_id: 'p12d-A2-worker', session_id: w2Sid, parent: 'p12d-A-commander', path: 'A2', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  await engine.run('communication', ['log', 'p12d', '--target', w1Sid, '--direction', 'out'], tmpRoot, rootSid);
  await engine.run('communication', ['log', 'p12d', '--target', w2Sid, '--direction', 'out'], tmpRoot, rootSid);
  const r1 = await engine.run('communication', ['list', 'p12d', '--leaf', 'p12d-A1-worker'], tmpRoot, rootSid);
  check('list --leaf A1 只返回 1 条', r1.communications.length === 1, JSON.stringify(r1.communications.length));
  check('该条 target_leaf_id=A1', r1.communications[0].target_leaf_id === 'p12d-A1-worker', JSON.stringify(r1.communications[0].target_leaf_id));
  const rAll = await engine.run('communication', ['list', 'p12d'], tmpRoot, rootSid);
  check('list 全部返回 2 条', rAll.communications.length === 2, JSON.stringify(rAll.communications.length));
}

// 用例 E：direction=in（root 收到 worker 回复）+ 默认 direction=out
console.log('\n[E] direction=in + 默认 out');
{
  const { rootSid, rootLeafId } = await initTree('p12e');
  const wSid = uuid();
  await addLeaf('p12e', { leaf_id: 'p12e-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const rIn = await engine.run('communication', ['log', 'p12e', '--target', wSid, '--direction', 'in'], tmpRoot, rootSid);
  check('direction=in ok', rIn.communication.direction === 'in', rIn.communication.direction);
  const tIn = await dump('p12e', rootSid);
  check('worker last_event_type=communication_in', tIn.leaves['p12e-A1-worker'].last_event_type === 'communication_in', tIn.leaves['p12e-A1-worker'].last_event_type);
  const rDefault = await engine.run('communication', ['log', 'p12e', '--target', wSid], tmpRoot, rootSid);
  check('默认 direction=out', rDefault.communication.direction === 'out', rDefault.communication.direction);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
