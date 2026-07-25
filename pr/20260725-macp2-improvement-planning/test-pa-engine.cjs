// 方案 A 引擎单测：P0-B（tree_init 绑 callerSessionId）+ P2-A（tree_id prefix 校验）
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const engine = require('D:/Codes/tree-harness/tree-engine.cjs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-pa-'));
engine.setTreesRoot(tmpRoot);
engine.setSessionVerifier(() => true);

const uuid = () => crypto.randomUUID();
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label} -- ${detail || ''}`); }
}

(async () => {
  // P0-B: tree_init 绑 callerSessionId
  console.log('\n[P0-B] tree_init 传 callerSessionId → root leaf session 绑定（消 PENDING_ROOT）');
  {
    const callerSid = uuid();
    const r = await engine.run('init', ['pab1', '--root-brief', JSON.stringify({prefix:'pab1',parent_intent:'t'}), '--root-dod', JSON.stringify({node_budget:5})], tmpRoot, callerSid);
    check('init ok', r.ok, JSON.stringify(r.error));
    const d = await engine.run('tree', ['dump', 'pab1'], tmpRoot, callerSid);
    check('root session_id = callerSessionId（非 PENDING_ROOT）', d.tree.leaves['pab1-root'].session_id === callerSid, d.tree.leaves['pab1-root'].session_id);
  }

  // P0-B 回退：不传 caller → PENDING_ROOT（向后兼容）
  console.log('\n[P0-B 回退] 不传 caller → PENDING_ROOT（CLI/金标准兼容）');
  {
    const r = await engine.run('init', ['pab2', '--root-brief', JSON.stringify({prefix:'pab2',parent_intent:'t'}), '--root-dod', JSON.stringify({node_budget:5})], tmpRoot, null);
    check('init ok（无 caller）', r.ok, JSON.stringify(r.error));
    const d = await engine.run('tree', ['dump', 'pab2'], tmpRoot, null);
    check('root session = PENDING_ROOT（回退）', d.tree.leaves['pab2-root'].session_id === 'PENDING_ROOT', d.tree.leaves['pab2-root'].session_id);
  }

  // P0-B: --session-id 优先于 caller
  console.log('\n[P0-B 优先级] --session-id 优先于 callerSessionId');
  {
    const callerSid = uuid();
    const explicitSid = uuid();
    const r = await engine.run('init', ['pab3', '--session-id', explicitSid, '--root-brief', JSON.stringify({prefix:'pab3',parent_intent:'t'}), '--root-dod', JSON.stringify({node_budget:5})], tmpRoot, callerSid);
    const d = await engine.run('tree', ['dump', 'pab3'], tmpRoot, callerSid);
    check('--session-id 优先（≠ caller）', d.tree.leaves['pab3-root'].session_id === explicitSid, d.tree.leaves['pab3-root'].session_id);
  }

  // P2-A: tree_id 含连字符 → 拒绝
  console.log('\n[P2-A] tree_id 含连字符（oeval-macp2）→ E_NAME_INVALID');
  {
    const r = await engine.run('init', ['oeval-macp2', '--root-brief', JSON.stringify({prefix:'oeval',parent_intent:'t'}), '--root-dod', JSON.stringify({node_budget:5})], tmpRoot, uuid());
    check('拒绝（含连字符）', !r.ok && r.error && r.error.code === 'E_NAME_INVALID', JSON.stringify(r.error));
    check('错误信息含 prefix rule', r.error && r.error.msg.includes('prefix rule'), r.error && r.error.msg);
  }

  // P2-A: tree_id 超长 → 拒绝
  console.log('\n[P2-A] tree_id 超长（toolongprefix 13 字符）→ E_NAME_INVALID');
  {
    const r = await engine.run('init', ['toolongprefix', '--root-brief', JSON.stringify({prefix:'toolong',parent_intent:'t'}), '--root-dod', JSON.stringify({node_budget:5})], tmpRoot, uuid());
    check('拒绝（超长 >8）', !r.ok && r.error && r.error.code === 'E_NAME_INVALID', JSON.stringify(r.error));
  }

  // P2-A: tree_id 合法 → 通过
  console.log('\n[P2-A] tree_id 合法（macp2，5 字符）→ 通过');
  {
    const r = await engine.run('init', ['macp2', '--root-brief', JSON.stringify({prefix:'macp2',parent_intent:'t'}), '--root-dod', JSON.stringify({node_budget:5})], tmpRoot, uuid());
    check('合法 tree_id 通过', r.ok, JSON.stringify(r.error));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
