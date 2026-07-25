// macp4 P0-E 单测：root role done 门禁（root 跳 milestone，不再撞 E_SCHEMA_INVALID）
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const engine = require('D:/Codes/tree-harness/tree-engine.cjs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-mp4-'));
engine.setTreesRoot(tmpRoot);
engine.setSessionVerifier(() => true);

const uuid = () => crypto.randomUUID();
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} -- ${detail || ''}`); }
}

(async () => {
  console.log('\n[P0-E] root 无 milestone 时 set-status done 不再撞 milestone 门禁');
  {
    const rootSid = uuid();
    const initR = await engine.run('init', ['mp4e', '--session-id', rootSid,
      '--root-brief', JSON.stringify({ prefix: 'mp4e', parent_intent: 't' }),
      '--root-dod', JSON.stringify({ node_budget: 5 })], tmpRoot, rootSid);
    check('tree_init ok', initR.ok, JSON.stringify(initR.error));

    // root 写 done event（触发 auto_upgrade: audit_gate skip → pass）
    const doneR = await engine.run('event', ['append', 'mp4e', 'mp4e-root',
      '--type', 'done',
      '--json', JSON.stringify({ self_check: [{ item: 'root done test', pass: true, evidence: 'P0-E verification: root done without milestone' }] })
    ], tmpRoot, rootSid);
    check('root done event ok（auto_upgrade audit_gate pass）', doneR.ok, JSON.stringify(doneR.error));

    // root set-status done（P0-E 前：E_SCHEMA_INVALID "milestones must be non-empty"；P0-E 后：放行或撞别的非 milestone 门禁）
    const setR = await engine.run('leaf', ['set-status', 'mp4e', 'mp4e-root', 'done'], tmpRoot, rootSid);
    if (setR.ok) {
      check('root set-status done 放行（P0-E 完全生效）', true);
    } else {
      // 即使失败，错误不应是 milestone（P0-E 生效 = milestone 门禁过了）
      const isMilestoneErr = setR.error && setR.error.msg && setR.error.msg.includes('milestones must be non-empty');
      check('root set-status done 不撞 milestone 门禁（P0-E 生效）', !isMilestoneErr,
        `error: ${JSON.stringify(setR.error)}`);
      if (!isMilestoneErr) {
        console.log(`    (注：撞了别的门禁，非 milestone——P0-E milestone 豁免生效，其他门禁如 children/audit 是预期)`);
      }
    }
  }

  // 回归：worker 仍需 milestone（P0-E 只豁免 root，不误伤 worker）
  console.log('\n[回归] worker 无 milestone 仍撞 E_SCHEMA_INVALID（P0-E 不误伤 worker）');
  {
    const rootSid = uuid();
    await engine.run('init', ['mp4w', '--session-id', rootSid,
      '--root-brief', JSON.stringify({ prefix: 'mp4w', parent_intent: 't' }),
      '--root-dod', JSON.stringify({ node_budget: 5 })], tmpRoot, rootSid);
    // root 先 done（满足 children 门禁前置）
    await engine.run('event', ['append', 'mp4w', 'mp4w-root', '--type', 'plan', '--json', JSON.stringify({plan_id:'p1'})], tmpRoot, rootSid);
    await engine.run('event', ['append', 'mp4w', 'mp4w-root', '--type', 'done',
      '--json', JSON.stringify({ self_check: [{ item: 'root done', pass: true, evidence: 'for children gate' }] })], tmpRoot, rootSid);

    const wSid = uuid();
    // leaf_add worker（无 milestone）
    const addR = await engine.run('leaf', ['add', 'mp4w', '--json', JSON.stringify({
      leaf_id: 'mp4w-A1-worker', session_id: wSid, parent: 'mp4w-root', path: 'A1',
      role: 'worker', model: 'm', channel: 'c', added_by: rootSid
    })], tmpRoot, rootSid);
    check('leaf_add worker ok', addR.ok, JSON.stringify(addR.error));

    // worker 写 brief_echo + alignment + done event（走完前置，只差 milestone）
    await engine.run('event', ['append', 'mp4w', 'mp4w-A1-worker', '--type', 'brief_echo',
      '--json', JSON.stringify({ my_understanding: 'test', milestones_preview: [] })], tmpRoot, wSid);
    await engine.run('event', ['append', 'mp4w', 'mp4w-A1-worker', '--type', 'brief_echo',
      '--json', JSON.stringify({ alignment: '0.9', auditor_session_id: rootSid })], tmpRoot, rootSid);
    await engine.run('event', ['append', 'mp4w', 'mp4w-A1-worker', '--type', 'done',
      '--json', JSON.stringify({ self_check: [{ item: 'w done', pass: true, evidence: 'worker test' }] })], tmpRoot, wSid);
    // audit_gate pass（root 背书）
    await engine.run('audit', ['gate', 'mp4w', 'mp4w-A1-worker', '--verdict', 'pass', '--audit-session-id', rootSid], tmpRoot, rootSid);

    // worker set-status done（无 milestone → 应撞 milestone 门禁，证明 P0-E 不误伤 worker）
    const wSetR = await engine.run('leaf', ['set-status', 'mp4w', 'mp4w-A1-worker', 'done'], tmpRoot, wSid);
    check('worker 无 milestone 仍撞 milestone 门禁（P0-E 不误伤 worker）',
      !wSetR.ok && wSetR.error && wSetR.error.msg && wSetR.error.msg.includes('milestones must be non-empty'),
      JSON.stringify(wSetR.error));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
