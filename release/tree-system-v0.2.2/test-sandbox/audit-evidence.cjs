#!/usr/bin/env node
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const SB = path.join(__dirname, 'core');
const SC = path.join(SB, 'tree-state.js');
function run(a) {
  try {
    const out = execFileSync('node', [SC, ...a], { cwd: SB, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out.trim());
  } catch (e) {
    const out = e.stdout ? e.stdout.toString() : '';
    try { return JSON.parse(out.trim()); } catch (_) { return { ok: false, error: { code: 'E_EXEC', msg: (e.message || '').slice(0, 200), raw: out.slice(0, 200) } }; }
  }
}
const FAKE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const R = '00000000-0000-0000-0000-000000000001';
const W = '00000000-0000-0000-0000-000000000002';

const tid = 'evd1';
const d = path.join(SB, tid);
if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
run(['init', tid, '--root-brief', JSON.stringify({ p: 'x' }), '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }), '--session-id', R, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
const lid = `${tid}-R1-worker`;
run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: lid, session_id: W, parent: `${tid}-root`, path: 'R1', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: R })]);
console.log('[0] attack-before status =', run(['leaf', 'get', tid, lid]).leaf.status);
run(['backup', tid, '--label', 'attack']);
const bk = fs.readdirSync(d).filter(f => /\.backup\..*\.attack\.json$/.test(f))[0];
const st = JSON.parse(fs.readFileSync(path.join(d, bk), 'utf8'));
const w = st.leaves[lid];
w.status = 'done';
w.audit_gate = { verdict: 'pass', auditor_session_id: FAKE, ts: '2026-06-23T00:00:00+08:00' };
w.milestones = [{ id: 'M1', desc: 'forged', expect_outputs: [], status: 'done', audit_pass: true, note_path: null }];
w.events = [
  { type: 'brief_echo', ts: '2026-06-23T00:00:00+08:00', meta: { ack: 'ok' } },
  { type: 'done', ts: '2026-06-23T00:00:01+08:00', meta: { self_check: [{ item: 'forged', pass: true, evidence: 'never did the work' }] } },
];
w.last_event_type = 'done';
fs.writeFileSync(path.join(d, bk), JSON.stringify(st, null, 2));
console.log('[1] restore result =', JSON.stringify(run(['restore', tid, bk])));
const after = run(['leaf', 'get', tid, lid]).leaf;
console.log('[2] attack-after status =', after.status, '| audit_gate.verdict =', after.audit_gate.verdict, '| auditor =', after.audit_gate.auditor_session_id);
const v = run(['validate', tid]);
console.log('[3] validate ok =', v.ok, '| issues count =', v.issues ? v.issues.length : '?');
console.log('    >>> 一个 worker 凭 restore 即达 done，且 validate 全绿。A1/A2/A5/A7/HARDEN2 全部旁路。');

// A2-fabricated verbatim
console.log('\n--- A2-fabricated 原始证据 ---');
const tid2 = 'evd2';
const d2 = path.join(SB, tid2);
if (fs.existsSync(d2)) fs.rmSync(d2, { recursive: true, force: true });
run(['init', tid2, '--root-brief', JSON.stringify({ p: 'x' }), '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }), '--session-id', R, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
const lid2 = `${tid2}-A2-worker`;
run(['leaf', 'add', tid2, '--json', JSON.stringify({ leaf_id: lid2, session_id: W, parent: `${tid2}-root`, path: 'A2', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: R })]);
run(['event', 'append', tid2, lid2, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok' })]);
run(['event', 'append', tid2, lid2, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
const r2 = run(['audit', 'gate', tid2, lid2, '--verdict', 'pass', '--audit-session-id', FAKE]);
console.log('audit-gate --verdict pass --audit-session-id', FAKE, '(凭空捏造、树中不存在)');
console.log('结果 =', JSON.stringify(r2));
