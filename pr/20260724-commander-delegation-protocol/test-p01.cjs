// P0-1 单测：W_STAR_DEGRADATION 软约束
// 用例 A-D：验证 root 越级 leaf_add worker 的 warning 触发条件
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const engine = require('D:/Codes/tree-harness/tree-engine.cjs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-p01-'));
engine.setTreesRoot(tmpRoot);
engine.setSessionVerifier(() => true);  // mock：所有 session 视为真实

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
async function setStatus(tree, leafId, status, callerSid) {
  return await engine.run('leaf', ['set-status', tree, leafId, status], tmpRoot, callerSid);
}

(async () => {
// 用例 A：root 已有 commander 时越级 add worker -> 期望 W_STAR_DEGRADATION
console.log('\n[A] root 已有 active commander 时越级 add worker');
{
  const { rootSid, rootLeafId } = await initTree('casea');
  const cmdSid = uuid();
  const cmdR = await addLeaf('casea', { leaf_id: 'casea-A-commander', session_id: cmdSid, parent: rootLeafId, path: 'A', role: 'commander', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('add commander ok', cmdR.ok, cmdR.error && cmdR.error.msg);
  check('commander 无 warning', !cmdR.warnings, JSON.stringify(cmdR.warnings));

  const wSid = uuid();
  const wR = await addLeaf('casea', { leaf_id: 'casea-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('add worker ok', wR.ok, wR.error && wR.error.msg);
  check('worker 触发 W_STAR_DEGRADATION', wR.warnings && wR.warnings.some(w => w.code === 'W_STAR_DEGRADATION'), JSON.stringify(wR.warnings));
  check('worker leaf.delegation_hint=star_degradation_warned', wR.leaf && wR.leaf.delegation_hint === 'star_degradation_warned', wR.leaf && wR.leaf.delegation_hint);
  check('warning.active_commanders 含 commander', wR.warnings && wR.warnings[0].active_commanders && wR.warnings[0].active_commanders.includes('casea-A-commander'), JSON.stringify(wR.warnings && wR.warnings[0].active_commanders));
}

// 用例 B：worker 挂 commander 下 -> 期望无 warning
console.log('\n[B] worker 挂 commander 下（正常层级）');
{
  const { rootSid, rootLeafId } = await initTree('caseb');
  const cmdSid = uuid();
  await addLeaf('caseb', { leaf_id: 'caseb-A-commander', session_id: cmdSid, parent: rootLeafId, path: 'A', role: 'commander', model: 'm', channel: 'c', added_by: rootSid }, rootSid);

  const wSid = uuid();
  const wR = await addLeaf('caseb', { leaf_id: 'caseb-A1-worker', session_id: wSid, parent: 'caseb-A-commander', path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: cmdSid }, cmdSid);
  check('add worker under commander ok', wR.ok, wR.error && wR.error.msg);
  check('无 warning（parent 非 root）', !wR.warnings, JSON.stringify(wR.warnings));
  check('leaf.delegation_hint=null', wR.leaf && wR.leaf.delegation_hint === null, wR.leaf && wR.leaf.delegation_hint);
}

// 用例 C：无 commander 时 root 直辖 worker -> 期望无 warning
console.log('\n[C] 单层树 root 直辖 worker（无 commander）');
{
  const { rootSid, rootLeafId } = await initTree('casec');
  const wSid = uuid();
  const wR = await addLeaf('casec', { leaf_id: 'casec-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('add worker ok', wR.ok, wR.error && wR.error.msg);
  check('无 warning（无 commander）', !wR.warnings, JSON.stringify(wR.warnings));
}

// 用例 D：commander 全 archived 后 root 越级 -> 期望无 warning
console.log('\n[D] commander archived 后 root 越级');
{
  const { rootSid, rootLeafId } = await initTree('cased');
  const cmdSid = uuid();
  await addLeaf('cased', { leaf_id: 'cased-A-commander', session_id: cmdSid, parent: rootLeafId, path: 'A', role: 'commander', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const archR = await setStatus('cased', 'cased-A-commander', 'archived', rootSid);
  check('archive commander ok', archR.ok, archR.error && archR.error.msg);

  const wSid = uuid();
  const wR = await addLeaf('cased', { leaf_id: 'cased-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('add worker after commander archived ok', wR.ok, wR.error && wR.error.msg);
  check('无 warning（commander 已 archived）', !wR.warnings, JSON.stringify(wR.warnings));
}

// 用例 E：commander pruned 后 root 越级 -> 期望无 warning（补审计微瑕：pruned 场景）
console.log('\n[E] commander pruned 后 root 越级');
{
  const { rootSid, rootLeafId } = await initTree('casee');
  const cmdSid = uuid();
  await addLeaf('casee', { leaf_id: 'casee-A-commander', session_id: cmdSid, parent: rootLeafId, path: 'A', role: 'commander', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  const pruneR = await setStatus('casee', 'casee-A-commander', 'pruned', rootSid);
  check('prune commander ok', pruneR.ok, pruneR.error && pruneR.error.msg);

  const wSid = uuid();
  const wR = await addLeaf('casee', { leaf_id: 'casee-A1-worker', session_id: wSid, parent: rootLeafId, path: 'A1', role: 'worker', model: 'm', channel: 'c', added_by: rootSid }, rootSid);
  check('add worker after commander pruned ok', wR.ok, wR.error && wR.error.msg);
  check('无 warning（commander 已 pruned）', !wR.warnings, JSON.stringify(wR.warnings));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
