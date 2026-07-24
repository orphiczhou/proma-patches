// P1-3 单测：可恢复错误自动记 drift
// 用例 A-E：验证 auto-drift 触发条件、挂载点定位、限频、不吞主错误
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const engine = require('D:/Codes/tree-harness/tree-engine.cjs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-p13-'));
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
async function driftCount(tree, leafId, callerSid) {
  const d = await engine.run('tree', ['dump', tree], tmpRoot, callerSid);
  const dh = d.tree.leaves[leafId] && d.tree.leaves[leafId].drift_history;
  return Array.isArray(dh) ? dh : [];
}

(async () => {
// 用例 A：leaf 存在时自动记 drift 到该 leaf（E_SELFCHECK_INVALID）
console.log('\n[A] leaf 存在时 auto-drift 到该 leaf');
{
  const { rootSid, rootLeafId } = await initTree('p13a');
  const wSid = uuid();
  await addLeaf('p13a', { leaf_id: 'p13a-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const before = (await driftCount('p13a', 'p13a-A1-worker', rootSid)).length;
  // 触发 E_SELFCHECK_INVALID: done self_check 空数组（caller=wSid 满足 done owner 校验）
  const r = await engine.run('event', ['append', 'p13a', 'p13a-A1-worker', '--type', 'done', '--json', JSON.stringify({ self_check: [] })], tmpRoot, wSid);
  check('event_append 失败 E_SELFCHECK_INVALID', !r.ok && r.error && r.error.code === 'E_SELFCHECK_INVALID', JSON.stringify(r.error));
  const dh = await driftCount('p13a', 'p13a-A1-worker', rootSid);
  check('worker drift_history +1', dh.length === before + 1, `before=${before} after=${dh.length}`);
  const last = dh[dh.length - 1];
  check('drift severity=low', last.severity === 'low', JSON.stringify(last));
  check('drift action=self_correct', last.action === 'self_correct', JSON.stringify(last));
  check('drift kind=production', last.kind === 'production', JSON.stringify(last));
  check('drift reason 含 [E_SELFCHECK_INVALID]', last.reason.includes('[E_SELFCHECK_INVALID]'), last.reason);
}

// 用例 B：leaf_add 失败（leaf 没建）时挂 caller leaf（root）
console.log('\n[B] leaf_add 失败时 auto-drift 挂 caller（root）');
{
  const { rootSid, rootLeafId } = await initTree('p13b');
  const before = (await driftCount('p13b', rootLeafId, rootSid)).length;
  // E_NAME_INVALID: leaf_id 大写 prefix
  const r = await addLeaf('p13b', { leaf_id: 'P13B-A1-worker', session_id: uuid(), parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('leaf_add 失败 E_NAME_INVALID', !r.ok && r.error && r.error.code === 'E_NAME_INVALID', JSON.stringify(r.error));
  const dh = await driftCount('p13b', rootLeafId, rootSid);
  check('root drift_history +1（挂 caller）', dh.length === before + 1, `before=${before} after=${dh.length}`);
  check('drift reason 含 [E_NAME_INVALID]', dh[dh.length - 1].reason.includes('[E_NAME_INVALID]'), dh[dh.length - 1].reason);
}

// 用例 C：不可恢复错误（E_UNKNOWN）不记 drift
console.log('\n[C] 不可恢复错误不记 drift');
{
  const { rootSid, rootLeafId } = await initTree('p13c');
  const before = (await driftCount('p13c', rootLeafId, rootSid)).length;
  const r = await engine.run('nonexistent-cmd', [], tmpRoot, rootSid);
  check('E_UNKNOWN 返回', !r.ok && r.error && r.error.code === 'E_UNKNOWN', JSON.stringify(r.error));
  const after = (await driftCount('p13c', rootLeafId, rootSid)).length;
  check('drift_history 不增（E_UNKNOWN 不在白名单）', after === before, `before=${before} after=${after}`);
}

// 用例 D：限频——30s 内同 code 只记一次
console.log('\n[D] 限频：30s 内同 code 只记 1 次');
{
  const { rootSid, rootLeafId } = await initTree('p13d');
  const wSid = uuid();
  await addLeaf('p13d', { leaf_id: 'p13d-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const before = (await driftCount('p13d', 'p13d-A1-worker', rootSid)).length;
  await engine.run('event', ['append', 'p13d', 'p13d-A1-worker', '--type', 'done', '--json', JSON.stringify({ self_check: [] })], tmpRoot, wSid);
  await engine.run('event', ['append', 'p13d', 'p13d-A1-worker', '--type', 'done', '--json', JSON.stringify({ self_check: [] })], tmpRoot, wSid);
  await engine.run('event', ['append', 'p13d', 'p13d-A1-worker', '--type', 'done', '--json', JSON.stringify({ self_check: [] })], tmpRoot, wSid);
  const dh = await driftCount('p13d', 'p13d-A1-worker', rootSid);
  check('3 次同 code 只记 1 drift', dh.length === before + 1, `before=${before} after=${dh.length}`);
}

// 用例 E：主错误返回不受 auto-drift 影响
console.log('\n[E] 主错误返回不受影响');
{
  const { rootSid, rootLeafId } = await initTree('p13e');
  const wSid = uuid();
  await addLeaf('p13e', { leaf_id: 'p13e-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const r = await engine.run('event', ['append', 'p13e', 'p13e-A1-worker', '--type', 'done', '--json', JSON.stringify({ self_check: [] })], tmpRoot, wSid);
  check('主错误正常返回 ok=false', !r.ok, JSON.stringify(r));
  check('error.code 正确', r.error && r.error.code === 'E_SELFCHECK_INVALID', JSON.stringify(r.error));
  check('error.msg 非空', r.error && r.error.msg && r.error.msg.length > 0, JSON.stringify(r.error));
  check('error 含 help_topic（E_SELFCHECK_INVALID 自解释）', r.error && 'help_topic' in r.error, JSON.stringify(r.error));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
