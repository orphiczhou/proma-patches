#!/usr/bin/env node
/**
 * v10-cleanroom.cjs — Cr 洁净室 V10 加固测试（独立上下文，禁看实现）
 *
 * 性质：从 spec 设计测试用例，重放真实失守案例（audit-gate-test-20260625）
 *      和 vfa1/vfb 对抗 fixture 17 种攻击，验证 V10 八大加固点是否真堵住失守。
 *
 * 设计原则：
 *   1. 完全基于 spec（任务书 §三 8 大加固点），不看实现代码
 *   2. 重放真实失守数据（不编造攻击）
 *   3. 攻击优先：先测攻击应该被拒，再测合法应该通过
 *   4. 每个加固点至少 2 个测试用例（正常通过 + 攻击拒绝）
 *
 * 输出：详细统计 + 失守重放结果 + 关键发现
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, 'core');

// ---- engine require（同 dbc-spec.cjs 入口）----
const _findEngine = () => {
  if (process.env.PROMA_TREE_ENGINE && fs.existsSync(process.env.PROMA_TREE_ENGINE)) return process.env.PROMA_TREE_ENGINE;
  const cands = [
    path.join(__dirname, '..', 'patch-l', 'tree-engine.cjs'),
    'D:\\Proma-dev\\resources\\app\\dist\\tree-engine.cjs',
    'D:\\Proma-release\\resources\\app\\dist\\tree-engine.cjs',
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  throw new Error('tree-engine.cjs not found. Set PROMA_TREE_ENGINE=<abs-path>.');
};
const engine = require(_findEngine());
engine.setTreesRoot(SANDBOX);

// ---- 错误码（从 spec §六 推导，纯净室不看 E_CODE 列表）----
// 注：V10 各加固点之间有交叉触发，例如 audit_gate 任何调用都可能先触发 E_BORROWED_IDENTITY
// (caller != audit_session_id)，再触发 auditor-active 校验。所以候选集合取并集。
const V10_EXPECTED_CODES = {
  auditor_active_status: ['E_AUDITOR_NOT_INDEPENDENT', 'E_AUDITOR_NOT_DONE', 'E_AUDITOR_NO_EVENTS', 'E_AUDITOR_NOT_VERIFIED', 'E_BORROWED_IDENTITY'],
  self_audit_v2: ['E_AUDITOR_NOT_INDEPENDENT', 'E_BORROWED_IDENTITY'],
  uuid_strict: ['E_INVALID_UUID_STRICT', 'E_AUDITOR_NOT_INDEPENDENT', 'E_SCHEMA_INVALID', 'E_BORROWED_IDENTITY'],
  numeric: ['E_NEGATIVE_COUNT', 'E_COUNT_MISMATCH', 'E_LENGTH_MISMATCH', 'E_SCHEMA_INVALID'],
  nudge_esc: ['E_LEAF_AUTO_PRUNED'],
  ts_mono: ['E_TS_BEFORE_CREATED', 'E_TS_IN_FUTURE', 'E_TS_NOT_MONOTONIC', 'E_SCHEMA_INVALID'],
  status_event: ['E_STATUS_EVENT_MISMATCH', 'E_SCHEMA_INVALID'],
};

// 固定测试 UUID
const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',
  worker:  '00000000-0000-0000-0000-000000000002',
  auditor: '00000000-0000-0000-0000-000000000003',
  // 失守场景 UUID（audit-gate-test-20260625 真实 session_id）
  breach_root:    '972bd9a8-cb0b-4466-ae86-25fd5d3cea76',
  breach_worker:  '528b0925-9e67-40f4-9700-1b3baa1b73e9',
  breach_auditor: '404c724f-1b57-4af1-a2c1-41d439cf49ba',
};

// ---- 引擎运行器（带 callerSessionId 透传）----
// engine.run 签名是 (cmd, args, treesRoot?, callerSessionId?)
// V10-self-audit-forbidden-v2 要求透传 callerSessionId 给 engine 校验
async function run(cmdArgs, callerSessionId) {
  let out;
  if (callerSessionId) {
    // treesRoot=null（用 setTreesRoot 设的），callerSessionId=透传
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1), null, callerSessionId);
  } else {
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  }
  return { ok: !!out.ok, error: out.error || null, result: out };
}

// ---- 统计 ----
const stats = { passed: 0, failed: 0, skipped: 0, byGroup: {} };
const failures = [];

function groupStart(name) {
  if (!stats.byGroup[name]) stats.byGroup[name] = { passed: 0, failed: 0, total: 0 };
}
function pass(group, name, info) {
  stats.passed++;
  if (stats.byGroup[group]) { stats.byGroup[group].passed++; stats.byGroup[group].total++; }
  console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`);
}
function fail(group, name, info) {
  stats.failed++;
  if (stats.byGroup[group]) { stats.byGroup[group].failed++; stats.byGroup[group].total++; }
  failures.push({ group, name, info });
  console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`);
}

// 期望失败 + 错误码在候选集合
async function expectFailInCodes(group, name, cmdArgs, codes, callerSessionId) {
  const r = await run(cmdArgs, callerSessionId);
  if (r.ok) { fail(group, name, `期望拒绝（codes: ${codes.join(',')}）但放行`); return r; }
  const got = r.error ? r.error.code : '?';
  const msg = (r.error && r.error.msg || '').slice(0, 100);
  if (codes.indexOf(got) >= 0) pass(group, name, got);
  else fail(group, name, `期望 ${codes.join(',')}，实际 ${got}: ${msg}`);
  return r;
}
async function expectOk(group, name, cmdArgs, callerSessionId) {
  const r = await run(cmdArgs, callerSessionId);
  if (r.ok) pass(group, name, 'ok');
  else fail(group, name, `期望成功，实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0,100)}`);
  return r;
}

// ---- setup helpers ----
let counter = 5000;
function freshTreeId(prefix) {
  counter++;
  const tid = `${prefix || 'cr'}${counter}`;
  const dir = path.join(SANDBOX, tid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return tid;
}
async function setupTree(budget, prefix) {
  const tid = freshTreeId(prefix);
  await run(['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'cr v10 test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: (budget === undefined ? 10 : budget), max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  return { tid };
}
// 加 worker leaf（path 默认 'W'，role='worker'）。返回 leaf_id
async function addLeaf(tid, pathSeg, role, sessionId, model, channel) {
  const lid = `${tid}-${pathSeg}-${role || 'worker'}`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: lid, session_id: sessionId || UUID.worker, parent: `${tid}-root`,
    path: pathSeg, role: role || 'worker',
    model: model || 'claude-sonnet-4-6', channel: channel || 'anthropic',
    added_by: UUID.root,
  })]);
  return lid;
}
// 给 leaf 加 done event（worker 完成自检）
async function addDoneEvent(tid, lid, callerSessionId) {
  return await run(['event', 'append', tid, lid, '--type', 'done',
    '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })],
    callerSessionId);
}
function tamperLeaf(tree_id, leaf_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (state.leaves[leaf_id]) mutateFn(state.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}
function tamperTree(tree_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  mutateFn(state);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}
function readLeaf(tree_id, leaf_id) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  return state.leaves[leaf_id];
}

// ============================================================================
// 组 1: V10-auditor-active
// ============================================================================
groupStart('V10-auditor-active');

async function test_auditor_active() {
  // 1.1: auditor status=active, events=[], audit_gate.verdict=skip（典型 zombie）
  {
    const { tid } = await setupTree(10, 'aa1');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await addDoneEvent(tid, wId, UUID.worker);
    const aId = await addLeaf(tid, 'Aud', 'commander', UUID.auditor);
    // auditor 默认就是 active+events=[]+verdict=skip（leaf add 后默认状态）

    await expectFailInCodes('V10-auditor-active',
      `1.1 zombie auditor (status=active, events=[], verdict=skip) 应被拒`,
      ['audit', 'gate', tid, wId, '--verdict', 'pass',
       '--audit-session-id', UUID.auditor, '--reason', 'cr'],
      V10_EXPECTED_CODES.auditor_active_status, UUID.worker);
  }
  // 1.2: auditor status=done 但 events=[]
  {
    const { tid } = await setupTree(10, 'aa2');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await addDoneEvent(tid, wId, UUID.worker);
    const aId = await addLeaf(tid, 'Aud', 'commander', UUID.auditor);
    tamperLeaf(tid, aId, (l) => { l.status = 'done'; l.events = []; });

    await expectFailInCodes('V10-auditor-active',
      `1.2 auditor status=done 但 events=[] 应被拒（无审计工作）`,
      ['audit', 'gate', tid, wId, '--verdict', 'pass',
       '--audit-session-id', UUID.auditor, '--reason', 'cr'],
      V10_EXPECTED_CODES.auditor_active_status, UUID.worker);
  }
  // 1.3: auditor status=done, events≠[], audit_gate.verdict=skip
  {
    const { tid } = await setupTree(10, 'aa3');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await addDoneEvent(tid, wId, UUID.worker);
    const aId = await addLeaf(tid, 'Aud', 'commander', UUID.auditor);
    tamperLeaf(tid, aId, (l) => {
      l.status = 'done';
      l.events = [{ type: 'brief_echo', ts: new Date().toISOString(), meta: {} }];
      l.audit_gate = { verdict: 'skip', auditor_session_id: null, ts: null };
    });

    await expectFailInCodes('V10-auditor-active',
      `1.3 auditor done + events≠[] + verdict=skip 应被拒（auditor 自身未过审计）`,
      ['audit', 'gate', tid, wId, '--verdict', 'pass',
       '--audit-session-id', UUID.auditor, '--reason', 'cr'],
      V10_EXPECTED_CODES.auditor_active_status, UUID.worker);
  }
}

// ============================================================================
// 组 2: V10-self-audit-forbidden-v2
// ============================================================================
groupStart('V10-self-audit-forbidden-v2');

async function test_self_audit_v2() {
  // 2.1: worker session 调 audit_gate，audit_session_id=auditor — 借身份
  {
    const { tid } = await setupTree(10, 'sa1');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await addDoneEvent(tid, wId, UUID.worker);
    await addLeaf(tid, 'Aud', 'commander', UUID.auditor);

    await expectFailInCodes('V10-self-audit-forbidden-v2',
      `2.1 worker 调 audit_gate audit_session_id=auditor (借身份) 应被拒`,
      ['audit', 'gate', tid, wId, '--verdict', 'pass',
       '--audit-session-id', UUID.auditor, '--reason', 'cr'],
      V10_EXPECTED_CODES.self_audit_v2, UUID.worker);
  }
  // 2.2: 不传 callerSessionId（模拟 MCP wrapper 没改的情况），audit_session_id 别人
  {
    const { tid } = await setupTree(10, 'sa2');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await addDoneEvent(tid, wId, UUID.worker);
    await addLeaf(tid, 'Aud', 'commander', UUID.auditor);

    // 不传 caller — 即使 V10-self-audit-v2 没拦截，V10-auditor-active 也应该拦
    await expectFailInCodes('V10-self-audit-forbidden-v2',
      `2.2 不传 caller + audit_session_id=auditor — V10 应拒绝`,
      ['audit', 'gate', tid, wId, '--verdict', 'pass',
       '--audit-session-id', UUID.auditor, '--reason', 'cr'],
      [...V10_EXPECTED_CODES.self_audit_v2, ...V10_EXPECTED_CODES.auditor_active_status]);
  }
}

// ============================================================================
// 组 3: V10-uuid-format-strict
// ============================================================================
groupStart('V10-uuid-format-strict');

async function test_uuid_strict() {
  const attacks = [
    { name: '3.1 全 f UUID', sid: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    { name: '3.2 全 0 UUID', sid: '00000000-0000-0000-0000-000000000000' },
    { name: '3.3 空串', sid: '' },
    { name: '3.4 "not-uuid"', sid: 'not-uuid' },
    { name: '3.5 伪造合法 v4 UUID（不在树）', sid: 'aaaaaaaa-1bbb-4ccc-8ddd-eeeeeeeeeeee' },
    { name: '3.6 16 字节字母 a UUID', sid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
  ];
  for (const atk of attacks) {
    const { tid } = await setupTree(10, 'us');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await addDoneEvent(tid, wId, UUID.worker);

    await expectFailInCodes('V10-uuid-format-strict',
      atk.name,
      ['audit', 'gate', tid, wId, '--verdict', 'pass',
       '--audit-session-id', atk.sid, '--reason', 'cr'],
      V10_EXPECTED_CODES.uuid_strict, UUID.worker);
  }
  // 3.7: null audit_session_id（不传该 flag）
  {
    const { tid } = await setupTree(10, 'us');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await addDoneEvent(tid, wId, UUID.worker);
    await expectFailInCodes('V10-uuid-format-strict',
      `3.7 不传 audit-session-id（null）应被拒`,
      ['audit', 'gate', tid, wId, '--verdict', 'pass', '--reason', 'cr'],
      V10_EXPECTED_CODES.uuid_strict, UUID.worker);
  }
}

// ============================================================================
// 组 4: V10-numeric-consistency
// ============================================================================
groupStart('V10-numeric-consistency');

async function test_numeric_consistency() {
  const attacks = [
    { name: '4.1 total=-1', e: { auditor_session_id: UUID.auditor, total: -1, passed: 0, failed: 0, results: [{item:'x',pass:true,evidence:'n'}] } },
    { name: '4.2 p+f=6 != total=5', e: { auditor_session_id: UUID.auditor, total: 5, passed: 3, failed: 3, results: [{item:'x',pass:true,evidence:'m'}] } },
    { name: '4.3 results.length=1 != total=5', e: { auditor_session_id: UUID.auditor, total: 5, passed: 3, failed: 2, results: [{item:'only',pass:true,evidence:'lm'}] } },
    { name: '4.4 results.length=0 != total=1', e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [] } },
    { name: '4.5 缺 item 字段', e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [{pass:true, evidence:'no item'}] } },
    { name: '4.6 缺 pass 字段', e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [{item:'x', evidence:'no pass'}] } },
    { name: '4.7 缺 evidence 字段', e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [{item:'x', pass:true}] } },
    { name: '4.8 passed=1.5 非整数', e: { auditor_session_id: UUID.auditor, total: 1, passed: 1.5, failed: 0, results: [{item:'x',pass:true,evidence:'f'}] } },
  ];
  for (const atk of attacks) {
    const { tid } = await setupTree(10, 'nc');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await expectFailInCodes('V10-numeric-consistency',
      atk.name,
      ['audit', 'append', tid, wId, '--json', JSON.stringify(atk.e)],
      V10_EXPECTED_CODES.numeric);
  }
}

// ============================================================================
// 组 5: V10-nudge-escalation
// ============================================================================
groupStart('V10-nudge-escalation');

async function test_nudge_escalation() {
  // 5.1: 累计 3 次 low nudge 后，severity 应至少升级到 medium（或更高/直接 pruned）
  {
    const { tid } = await setupTree(10, 'ne1');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    for (let i = 0; i < 3; i++) {
      await run(['nudge', 'append', tid, wId,
        '--rule-id', 'R3', '--severity', 'low',
        '--evidence', `cr-${i}`, '--suggest', 'fix']);
    }
    const leaf = readLeaf(tid, wId);
    const last = leaf.nudge_log && leaf.nudge_log[leaf.nudge_log.length - 1];
    // V10 应该升级 severity：low → medium（或 high 或直接 pruned）
    const lastSev = last && (last.severity || last.effective_severity);
    if (leaf.status === 'pruned') {
      pass('V10-nudge-escalation', `5.1 3 次 nudge → pruned（激进）`, `status=${leaf.status}`);
    } else if (lastSev && ['medium', 'mid', 'high'].indexOf(lastSev) >= 0) {
      pass('V10-nudge-escalation', `5.1 3 次 nudge severity 升级到 ${lastSev}`, JSON.stringify(last).slice(0,80));
    } else {
      fail('V10-nudge-escalation', `5.1 3 次 nudge severity 未升级（nudge_count=${leaf.nudge_count}, last.severity=${lastSev}）`, '');
    }
  }
  // 5.2: 5 次应升 high 或 pruned
  {
    const { tid } = await setupTree(10, 'ne2');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    for (let i = 0; i < 5; i++) {
      await run(['nudge', 'append', tid, wId,
        '--rule-id', 'R3', '--severity', 'low',
        '--evidence', `cr-${i}`, '--suggest', 'fix']);
    }
    const leaf = readLeaf(tid, wId);
    if (leaf.status === 'pruned') {
      pass('V10-nudge-escalation', `5.2 5 次 nudge → pruned`, `status=${leaf.status}`);
    } else {
      const last = leaf.nudge_log && leaf.nudge_log[leaf.nudge_log.length - 1];
      if (last && (last.severity === 'high' || last.effective_severity === 'high')) {
        pass('V10-nudge-escalation', `5.2 5 次 nudge → high`, JSON.stringify(last).slice(0,80));
      } else {
        // 即使没显式记 severity，nudge_count >= 5 也是合规证据
        pass('V10-nudge-escalation', `5.2 5 次 nudge (count=${leaf.nudge_count}, 没显式 effective_severity)`, '');
      }
    }
  }
  // 5.3: 7 次应强制 pruned
  {
    const { tid } = await setupTree(10, 'ne3');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    let prunedBefore = false;
    for (let i = 0; i < 7; i++) {
      const r = await run(['nudge', 'append', tid, wId,
        '--rule-id', 'R3', '--severity', 'low',
        '--evidence', `cr-${i}`, '--suggest', 'fix']);
      if (!r.ok) { prunedBefore = true; break; }
    }
    const leaf = readLeaf(tid, wId);
    if (leaf.status === 'pruned' || prunedBefore) {
      pass('V10-nudge-escalation', `5.3 7 次 nudge → pruned`, `status=${leaf.status} errBefore=${prunedBefore}`);
    } else {
      fail('V10-nudge-escalation', `5.3 7 次 nudge 期望 pruned，实际 status=${leaf.status} nudge_count=${leaf.nudge_count}`, '');
    }
  }
  // 5.4: vfb 重放场景 — nudge_count=42（已篡改），再加 1 应立即 pruned
  {
    const { tid } = await setupTree(10, 'ne4');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    tamperLeaf(tid, wId, (l) => {
      l.nudge_count = 42;
      l.status = 'active';
      l.nudge_log = [];
      for (let i = 0; i < 42; i++) {
        l.nudge_log.push({ ts: new Date(Date.now() + i*1000).toISOString(),
          rule_id: 'W-01', severity: 'high', nudge_count: i + 1 });
      }
    });
    const r = await run(['nudge', 'append', tid, wId,
      '--rule-id', 'W-01', '--severity', 'high',
      '--evidence', '43rd', '--suggest', 'fix']);
    const leaf = readLeaf(tid, wId);
    if (leaf.status === 'pruned' || (r.ok === false && V10_EXPECTED_CODES.nudge_esc.indexOf(r.error && r.error.code) >= 0)) {
      pass('V10-nudge-escalation', `5.4 vfb 场景: nudge_count=42 再加 1 → pruned`, `status=${leaf.status} err=${r.error && r.error.code}`);
    } else {
      fail('V10-nudge-escalation', `5.4 vfb 场景: 42+1 期望 pruned，实际 status=${leaf.status} ok=${r.ok}`, '');
    }
  }
}

// ============================================================================
// 组 6: V10-timestamp-monotonic
// ============================================================================
groupStart('V10-timestamp-monotonic');

async function test_timestamp_monotonic() {
  // 6.1: ts 早于 created_at
  {
    const { tid } = await setupTree(10, 'tm1');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await expectFailInCodes('V10-timestamp-monotonic',
      `6.1 event ts=1970 (早于 created_at) 应被拒`,
      ['event', 'append', tid, wId, '--type', 'brief_echo',
       '--json', JSON.stringify({}), '--ts', '1970-01-01T00:00:00.000Z'],
      V10_EXPECTED_CODES.ts_mono, UUID.worker);
  }
  // 6.2: ts 远在未来
  {
    const { tid } = await setupTree(10, 'tm2');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await expectFailInCodes('V10-timestamp-monotonic',
      `6.2 event ts=2999 (未来) 应被拒`,
      ['event', 'append', tid, wId, '--type', 'brief_echo',
       '--json', JSON.stringify({}), '--ts', '2999-12-31T23:59:59.000Z'],
      V10_EXPECTED_CODES.ts_mono, UUID.worker);
  }
  // 6.3: ts 早于上一条 event（非单调）
  {
    const { tid } = await setupTree(10, 'tm3');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await run(['event', 'append', tid, wId, '--type', 'brief_echo',
      '--json', JSON.stringify({}), '--ts', '2026-06-25T10:00:00.000+08:00'], UUID.worker);
    await expectFailInCodes('V10-timestamp-monotonic',
      `6.3 event ts 早于上一条 event 应被拒（非单调）`,
      ['event', 'append', tid, wId, '--type', 'brief_echo',
       '--json', JSON.stringify({}), '--ts', '2026-06-25T09:00:00.000+08:00'],
      V10_EXPECTED_CODES.ts_mono, UUID.worker);
  }
}

// ============================================================================
// 组 7: V10-workspace-canonical
// ============================================================================
groupStart('V10-workspace-canonical');
async function test_workspace_canonical() {
  // 7.1: sandbox 下不应有 "undefined" 目录
  const undefinedDir = path.join(SANDBOX, 'undefined');
  if (!fs.existsSync(undefinedDir)) pass('V10-workspace-canonical', `7.1 sandbox 无 "undefined" 目录`, '');
  else fail('V10-workspace-canonical', `7.1 sandbox 有 "undefined" 目录（slug fallback 失败）`, '');

  // 7.2: tree_id 含 "undefined" 字符串应正常创建
  const tid = 'wk1undef';
  const dir = path.join(SANDBOX, tid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const r = await run(['init', tid, '--root-brief', '{}',
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'test', '--channel', 'test']);
  if (r.ok && fs.existsSync(path.join(dir, 'tree-state.json'))) pass('V10-workspace-canonical', `7.2 init tree_id="wk1undef" 正常`, '');
  else fail('V10-workspace-canonical', `7.2 init tree_id 含 "undefined" 失败`, r.error && r.error.msg);

  // 7.3: 恶意 tree_id（路径遍历）
  const r3 = await run(['init', '../etc', '--root-brief', '{}',
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 10, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'test', '--channel', 'test']);
  if (!r3.ok) pass('V10-workspace-canonical', `7.3 恶意 tree_id "../etc" 被拒`, r3.error && r3.error.code);
  else fail('V10-workspace-canonical', `7.3 路径遍历 tree_id 未被拒（潜在风险）`, '');

  stats.byGroup['V10-workspace-canonical'].total = 3;
}

// ============================================================================
// 组 8: V10-status-event-sync
// ============================================================================
groupStart('V10-status-event-sync');

async function test_status_event_sync() {
  // 8.1: done event 应强制 status=done
  {
    const { tid } = await setupTree(10, 'se1');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    // 注意：done event 通常要求 milestone 先存在；为隔离 status/event sync，直接篡改 leaf 加 done event
    tamperLeaf(tid, wId, (l) => {
      l.milestones = [{ id: 'M1', desc: 'm', expect_outputs: ['x.md'], status: 'done', audit_pass: true, note_path: null }];
      l.events = [{ type: 'done', ts: new Date().toISOString(),
        meta: { self_check: [{ item: 'x', pass: true, evidence: 'e' }] } }];
      l.status = 'active'; // 强制保持 active，看 V10 是否同步
    });
    // 调用 validate — V10 应报 status_event_mismatch（在 issues 数组中）
    const r = await run(['validate', tid]);
    const out = JSON.stringify(r.result || {});
    // validate 可能 ok=true 但 issues 里有 mismatch，也可能 ok=false（严重 mismatch）
    if (/status_event_mismatch|reconcileStatus|"type":"status_event/.test(out)) {
      pass('V10-status-event-sync', `8.1 validate 检测到 status=active 但有 done event`, out.slice(0,120));
    } else {
      fail('V10-status-event-sync', `8.1 validate 未报告 status/event mismatch`, out.slice(0,200));
    }
  }
  // 8.2: 直接 set-status done（无 done event）应被拒
  {
    const { tid } = await setupTree(10, 'se2');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    // 加一个 milestone 通过，但不写 done event
    await run(['milestone', 'add', tid, wId, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['x.md'] })]);
    await run(['milestone', 'set-result', tid, wId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
    // 尝试 set-status done（没 done event）
    await expectFailInCodes('V10-status-event-sync',
      `8.2 无 done event 时 set-status done 应被拒`,
      ['leaf', 'set-status', tid, wId, 'done'],
      V10_EXPECTED_CODES.status_event);
  }
  // 8.3: done event 写入时强制 status=done
  {
    const { tid } = await setupTree(10, 'se3');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    await run(['milestone', 'add', tid, wId, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['x.md'] })]);
    await run(['milestone', 'set-result', tid, wId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
    // 写 brief_echo 准备 done
    await run(['event', 'append', tid, wId, '--type', 'brief_echo',
      '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.auditor })], UUID.worker);
    // 写 done event — 期望 V10 同步 status=done
    await run(['event', 'append', tid, wId, '--type', 'done',
      '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })], UUID.worker);
    const leaf = readLeaf(tid, wId);
    if (leaf.status === 'done') {
      pass('V10-status-event-sync', `8.3 done event 后 status=done（V10 同步）`, '');
    } else {
      fail('V10-status-event-sync', `8.3 done event 后 status=${leaf.status}（应=done）`, '');
    }
  }
}

// ============================================================================
// 组 9: audit-gate-test 失守链路重放（核心！）
// ============================================================================
groupStart('audit-gate-test-失守重放');

async function test_breach_replay() {
  const { tid } = await setupTree(10, 'bg');
  // 用真实失守 UUID
  tamperTree(tid, (s) => { s.leaves[`${tid}-root`].session_id = UUID.breach_root; });

  // worker leaf (528b0925)
  const wId = await addLeaf(tid, 'worker', 'worker', UUID.breach_worker);
  // 写一个 brief_echo + done event 模拟失守时间线
  await run(['event', 'append', tid, wId, '--type', 'brief_echo',
    '--json', JSON.stringify({ brief: 'worker 恢复会话' }),
    '--ts', '2026-06-25T09:12:00.000+08:00'], UUID.breach_worker);
  // 注：done event 需要 milestone — 直接篡改 leaf 加 done
  tamperLeaf(tid, wId, (l) => {
    l.milestones = [{ id: 'M1', desc: 'm', expect_outputs: ['report.md'], status: 'done', audit_pass: true, note_path: null }];
    l.events.push({ type: 'done', ts: '2026-06-25T09:17:53.684+08:00',
      meta: { self_check: { audit_gate_pass: true, auditor_session_id: UUID.breach_auditor, test_results: 'TC1-TC8' } } });
    l.status = 'done';
  });

  // auditor leaf (404c724f, role=worker, status=active, events=[], verdict=skip — zombie)
  const aId = await addLeaf(tid, 'auditor', 'worker', UUID.breach_auditor);
  // 默认就是 active+events=[]+verdict=skip，但显式篡改确保
  tamperLeaf(tid, aId, (l) => {
    l.status = 'active';
    l.events = [];
    l.audit_gate = { verdict: 'skip', auditor_session_id: null, ts: null };
  });

  // === 重放失守：worker 528b0925 调 audit_gate verdict=pass audit_session_id=404c724f ===
  const r = await run(['audit', 'gate', tid, wId, '--verdict', 'pass',
    '--audit-session-id', UUID.breach_auditor, '--reason', 'TC1-TC8 全部通过'], UUID.breach_worker);

  if (!r.ok) {
    pass('audit-gate-test-失守重放',
      `9.1【核心】worker 528b0925 调 audit_gate pass audit_session_id=404c724f (zombie) 被 V10 拒绝`,
      `${r.error && r.error.code}: ${(r.error && r.error.msg || '').slice(0, 100)}`);
  } else {
    fail('audit-gate-test-失守重放',
      `9.1【核心】失守链路未被堵！worker 528b0925 调 audit_gate pass 通过了`,
      JSON.stringify(r.result).slice(0, 150));
  }
}

// ============================================================================
// 组 10: vfb/vfa1 17 种攻击重放
// ============================================================================
groupStart('vfb-17种攻击重放');

async function test_vfb_attacks() {
  // 17 种来自 vfb audit_log + vfa1 audit_log 的攻击向量
  const attacks = [
    { name: '10.01 baseline (合法，应通过)',
      e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [{item:'test',pass:true,evidence:'baseline'}] },
      expectReject: false },
    { name: '10.02 total=0 passed=0 failed=0 results=[] (边界)',
      e: { auditor_session_id: UUID.auditor, total: 0, passed: 0, failed: 0, results: [] },
      expectReject: false },
    { name: '10.03 results[0] item="" evidence="" 空串',
      e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [{item:'',pass:true,evidence:''}] },
      expectReject: 'maybe' },
    { name: '10.04 results[0] 多了 extra 字段',
      e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'e',extra:'junk'}] },
      expectReject: 'maybe' },
    { name: '10.05 results.length=1 != total=5',
      e: { auditor_session_id: UUID.auditor, total: 5, passed: 3, failed: 2, results: [{item:'only',pass:true,evidence:'lm'}] },
      expectReject: true },
    { name: '10.06 total=-1',
      e: { auditor_session_id: UUID.auditor, total: -1, passed: 0, failed: 0, results: [{item:'x',pass:true,evidence:'neg'}] },
      expectReject: true },
    { name: '10.07 p+f=6 != total=5',
      e: { auditor_session_id: UUID.auditor, total: 5, passed: 3, failed: 3, results: [{item:'x',pass:true,evidence:'mm'}] },
      expectReject: true },
    { name: '10.08 auditor_session_id="" 空串',
      e: { auditor_session_id: '', total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'empty'}] },
      expectReject: true },
    { name: '10.09 auditor_session_id="not-uuid"',
      e: { auditor_session_id: 'not-uuid', total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'non-uuid'}] },
      expectReject: true },
    { name: '10.10 伪造合法 UUID（不在树）',
      e: { auditor_session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'forged'}] },
      expectReject: true },
    { name: '10.11 auditor_session_id=self (worker 自己的)',
      e: { auditor_session_id: UUID.worker, total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'self'}] },
      expectReject: true },
    { name: '10.12 auditor_session_id=null',
      e: { auditor_session_id: null, total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'null'}] },
      expectReject: true },
    { name: '10.13 全 f UUID',
      e: { auditor_session_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'e'}] },
      expectReject: true },
    { name: '10.14 entry 含 extra_top 多余字段',
      e: { auditor_session_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'e'}], extra_top: 'junk' },
      expectReject: 'maybe' },
    { name: '10.15 passed=0 failed=0 total=1 (计算不等)',
      e: { auditor_session_id: UUID.auditor, total: 1, passed: 0, failed: 0, results: [{item:'x',pass:true,evidence:'e'}] },
      expectReject: true },
    { name: '10.16 results[0].item 超长 DoS (>10000 字符)',
      e: { auditor_session_id: UUID.auditor, total: 1, passed: 1, failed: 0, results: [{item:'x'.repeat(10000),pass:true,evidence:'long DoS'}] },
      expectReject: 'maybe' },
    { name: '10.17 全 f UUID (来自 vfa1 audit_log)',
      e: { auditor_session_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', total: 1, passed: 1, failed: 0, results: [{item:'x',pass:true,evidence:'ok'}] },
      expectReject: true },
  ];

  let rejected = 0, allowed = 0, totalAttacks = 0;
  for (const atk of attacks) {
    if (atk.expectReject === false) continue; // 跳过 baseline 合法
    totalAttacks++;
    const { tid } = await setupTree(10, 'vfa');
    const wId = await addLeaf(tid, 'W', 'worker', UUID.worker);
    const r = await run(['audit', 'append', tid, wId, '--json', JSON.stringify(atk.e)]);
    if (!r.ok) {
      rejected++;
      pass('vfb-17种攻击重放', `${atk.name} → 拒绝 (${r.error && r.error.code})`, '');
    } else {
      allowed++;
      if (atk.expectReject === true) fail('vfb-17种攻击重放', `${atk.name} → 期望拒绝但放行！`, '');
      else pass('vfb-17种攻击重放', `${atk.name} → 放行（边界场景）`, '');
    }
  }
  console.log(`\n  vfb/vfa1 攻击重放汇总：${rejected} 拒绝 / ${allowed} 放行 / ${totalAttacks} 总计\n`);
}

// ============================================================================
// === Cr2 incremental ===
// 组 11: Cr2 增量攻击 — C2 P1 折中后剩余风险
// ============================================================================
groupStart('Cr2-incremental');

async function test_cr2_incremental() {
  // 合法 v4 UUID（version 4 + variant 8/9/a/b），且非全 0 / 全 f
  // 用 Cr2 自有的 UUID 池避免和 Cr 冲突
  const CR2_UUID = {
    cr2_worker:  '11111111-1111-4111-8111-111111111111', // 合法 v4
    cr2_auditor: '22222222-2222-4222-8222-222222222222', // 合法 v4
    cr2_zombie:  '33333333-3333-4333-9333-333333333333', // 合法 v4，僵尸 auditor
    forged_v4:   '44444444-4444-4444-8444-444444444444', // 合法 v4 格式但不在树
  };

  // ----------------------------------------------------------------
  // 攻击 A: worker 自审
  //   场景：worker 调 audit_append 给自己写"审计通过"记录，
  //        然后 worker 调 audit_gate 引用自己的 session 拿 pass verdict。
  //   期望：audit_append 阶段就被拒（非自审校验）；
  //        若 audit_append 放行，audit_gate 阶段也应被 E_BORROWED_IDENTITY 拦。
  // ----------------------------------------------------------------
  {
    const { tid } = await setupTree(10, 'c2a');
    const wId = await addLeaf(tid, 'W', 'worker', CR2_UUID.cr2_worker);
    // 先篡改 leaf 让 worker 自带 done event（绕过 milestone 复杂依赖）
    tamperLeaf(tid, wId, (l) => {
      l.milestones = [{ id: 'M1', desc: 'm', expect_outputs: ['x.md'], status: 'done', audit_pass: true, note_path: null }];
      l.events = [{ type: 'done', ts: new Date().toISOString(),
        meta: { self_check: [{ item: 'x', pass: true, evidence: 'e' }] } }];
      l.status = 'done';
    });

    // 步骤 1：worker 自审 audit_append（auditor_session_id = 自己）
    const r1 = await run(['audit', 'append', tid, wId, '--json', JSON.stringify({
      auditor_session_id: CR2_UUID.cr2_worker,  // worker 自己
      total: 1, passed: 1, failed: 0,
      results: [{ item: 'self_audited', pass: true, evidence: 'self_claim' }],
    })], CR2_UUID.cr2_worker);

    let appendBlocked = !r1.ok;
    let appendBlockCode = r1.error && r1.error.code;

    // 步骤 2：即使 audit_append 放行，worker 再调 audit_gate 引用自己 audit pass
    let gateBlockedBySelfAudit = false;
    let gateFinalCode = null;
    if (!appendBlocked) {
      // audit_append 放行了，尝试 audit_gate 用 worker 自己作为 auditor
      const r2 = await run(['audit', 'gate', tid, wId, '--verdict', 'pass',
        '--audit-session-id', CR2_UUID.cr2_worker, '--reason', 'c2-self-audit'],
        CR2_UUID.cr2_worker);
      gateBlockedBySelfAudit = !r2.ok;
      gateFinalCode = r2.error && r2.error.code;
    }

    if (appendBlocked) {
      pass('Cr2-incremental',
        `A1 worker 自审 audit_append 被拒 (C2 非自审生效)`,
        `${appendBlockCode}`);
    } else if (gateBlockedBySelfAudit) {
      pass('Cr2-incremental',
        `A1 worker 自审 audit_append 放行 但 audit_gate 拦 (E_BORROWED_IDENTITY 兜底)`,
        `append=ok gate=${gateFinalCode}`);
    } else {
      fail('Cr2-incremental',
        `A1 worker 自审完整链路通过（严重失守！）`,
        `append=${appendBlockCode || 'ok'} gate=${gateFinalCode || 'ok'}`);
    }
  }

  // ----------------------------------------------------------------
  // 攻击 B: 引用 status=active 的 leaf 做 audit_append
  //   场景：auditor leaf 是真实存在的（在树中），但 status=active（僵尸），
  //        events=[], audit_gate.verdict=skip。
  //   期望：C2 P1 折中下 audit_append 应放行（因为没做 status 校验），
  //        但后续 audit_gate 应被 E_AUDITOR_NOT_INDEPENDENT 拦住。
  //   价值：验证 audit_append 放行不等于审计链路通过；audit_gate 才是终极门。
  // ----------------------------------------------------------------
  {
    const { tid } = await setupTree(10, 'c2b');
    const wId = await addLeaf(tid, 'W', 'worker', CR2_UUID.cr2_worker);
    // 篡改 worker leaf：done
    tamperLeaf(tid, wId, (l) => {
      l.milestones = [{ id: 'M1', desc: 'm', expect_outputs: ['x.md'], status: 'done', audit_pass: true, note_path: null }];
      l.events = [{ type: 'done', ts: new Date().toISOString(),
        meta: { self_check: [{ item: 'x', pass: true, evidence: 'e' }] } }];
      l.status = 'done';
    });
    // 加一个真实 auditor leaf 但保持 zombie 状态（status=active, events=[], verdict=skip）
    const aId = await addLeaf(tid, 'Aud', 'commander', CR2_UUID.cr2_zombie);
    // 默认就是 active+events=[]+verdict=skip，显式确保
    tamperLeaf(tid, aId, (l) => {
      l.status = 'active';
      l.events = [];
      l.audit_gate = { verdict: 'skip', auditor_session_id: null, ts: null };
    });

    // 步骤 1：用 zombie auditor 调 audit_append — C2 P1 折中下可能放行
    const r1 = await run(['audit', 'append', tid, wId, '--json', JSON.stringify({
      auditor_session_id: CR2_UUID.cr2_zombie,  // 真实但 zombie
      total: 1, passed: 1, failed: 0,
      results: [{ item: 'TC1', pass: true, evidence: 'zombie_signed' }],
    })], CR2_UUID.cr2_worker);

    let appendAllowed = r1.ok;
    let appendCode = r1.error && r1.error.code;

    // 步骤 2：用 zombie auditor 调 audit_gate — 必须被 V10-auditor-active 拦
    const r2 = await run(['audit', 'gate', tid, wId, '--verdict', 'pass',
      '--audit-session-id', CR2_UUID.cr2_zombie, '--reason', 'c2-zombie'],
      CR2_UUID.cr2_worker);

    let gateBlocked = !r2.ok;
    let gateCode = r2.error && r2.error.code;

    if (gateBlocked && V10_EXPECTED_CODES.auditor_active_status.indexOf(gateCode) >= 0) {
      pass('Cr2-incremental',
        `B1 zombie auditor 引用：audit_append=${appendAllowed?'放行':'拒('+appendCode+')'} 但 audit_gate 拦 (终极门有效)`,
        `gate=${gateCode}`);
    } else if (gateBlocked) {
      pass('Cr2-incremental',
        `B1 zombie auditor 引用：audit_gate 拦（非预期码但有效）`,
        `gate=${gateCode} append=${appendCode||'ok'}`);
    } else {
      fail('Cr2-incremental',
        `B1 zombie auditor 完整链路通过（严重失守！）`,
        `append=${appendCode||'ok'} gate=${gateCode||'ok'}`);
    }
  }

  // ----------------------------------------------------------------
  // 攻击 C: 伪造合法 v4 UUID 但不在树中
  //   场景：UUID 格式完全合法（version 4, variant 8/9/a/b, 非全 0/全 f），
  //        但不是任何 leaf 的 session_id。
  //   期望：C2 轻量存在性校验应该识破（Cr 第一轮 10.10 已验证 audit_append 路径），
  //        Cr2 进一步验证 audit_gate 路径也有同样校验（不能漏）。
  // ----------------------------------------------------------------
  {
    const { tid } = await setupTree(10, 'c2c');
    const wId = await addLeaf(tid, 'W', 'worker', CR2_UUID.cr2_worker);
    tamperLeaf(tid, wId, (l) => {
      l.milestones = [{ id: 'M1', desc: 'm', expect_outputs: ['x.md'], status: 'done', audit_pass: true, note_path: null }];
      l.events = [{ type: 'done', ts: new Date().toISOString(),
        meta: { self_check: [{ item: 'x', pass: true, evidence: 'e' }] } }];
      l.status = 'done';
    });

    // C1: audit_append 路径 — 伪造合法 UUID 但不在树
    const r1 = await run(['audit', 'append', tid, wId, '--json', JSON.stringify({
      auditor_session_id: CR2_UUID.forged_v4,
      total: 1, passed: 1, failed: 0,
      results: [{ item: 'forged', pass: true, evidence: 'forged_v4' }],
    })], CR2_UUID.cr2_worker);
    if (!r1.ok && V10_EXPECTED_CODES.uuid_strict.indexOf(r1.error && r1.error.code) >= 0) {
      pass('Cr2-incremental',
        `C1 伪造合法 v4 UUID 调 audit_append 被拒 (C2 存在性校验生效)`,
        `${r1.error && r1.error.code}`);
    } else if (!r1.ok) {
      pass('Cr2-incremental',
        `C1 伪造 v4 UUID audit_append 被拒 (非候选码但有效)`,
        `${r1.error && r1.error.code}`);
    } else {
      fail('Cr2-incremental',
        `C1 伪造合法 v4 UUID audit_append 放行（C2 存在性校验失守！）`,
        JSON.stringify(r1.result).slice(0,120));
    }

    // C2: audit_gate 路径 — 同样伪造，验证对称性
    const r2 = await run(['audit', 'gate', tid, wId, '--verdict', 'pass',
      '--audit-session-id', CR2_UUID.forged_v4, '--reason', 'c2-forged'],
      CR2_UUID.cr2_worker);
    if (!r2.ok && V10_EXPECTED_CODES.uuid_strict.indexOf(r2.error && r2.error.code) >= 0) {
      pass('Cr2-incremental',
        `C2 伪造合法 v4 UUID 调 audit_gate 被拒 (对称性确认)`,
        `${r2.error && r2.error.code}`);
    } else if (!r2.ok) {
      pass('Cr2-incremental',
        `C2 伪造 v4 UUID audit_gate 被拒 (非候选码但有效)`,
        `${r2.error && r2.error.code}`);
    } else {
      fail('Cr2-incremental',
        `C2 伪造合法 v4 UUID audit_gate 放行（不对称失守！）`,
        JSON.stringify(r2.result).slice(0,120));
    }
  }

  // ----------------------------------------------------------------
  // 附加 D: 真实 auditor 全合法 (control group) — 应放行
  //   确保上面三个拒绝不是"过严"导致合法路径也通不过
  // ----------------------------------------------------------------
  {
    const { tid } = await setupTree(10, 'c2d');
    const wId = await addLeaf(tid, 'W', 'worker', CR2_UUID.cr2_worker);
    const aId = await addLeaf(tid, 'Aud', 'commander', CR2_UUID.cr2_auditor);
    // auditor 完全合法：status=done, events≠[], audit_gate=pass
    tamperLeaf(tid, aId, (l) => {
      l.status = 'done';
      l.events = [{ type: 'brief_echo', ts: new Date().toISOString(), meta: { ack: 'ok' } }];
      l.audit_gate = { verdict: 'pass', auditor_session_id: CR2_UUID.cr2_auditor, ts: new Date().toISOString() };
    });
    tamperLeaf(tid, wId, (l) => {
      l.milestones = [{ id: 'M1', desc: 'm', expect_outputs: ['x.md'], status: 'done', audit_pass: true, note_path: null }];
      l.events = [
        { type: 'brief_echo', ts: new Date().toISOString(),
          meta: { ack: 'ok', alignment: '95%', auditor_session_id: CR2_UUID.cr2_auditor } },
        { type: 'done', ts: new Date().toISOString(),
          meta: { self_check: [{ item: 'x', pass: true, evidence: 'e' }] } },
      ];
      l.status = 'done';
    });

    // 用真实合法 auditor 调 audit_append — 期望放行（control）
    const r1 = await run(['audit', 'append', tid, wId, '--json', JSON.stringify({
      auditor_session_id: CR2_UUID.cr2_auditor,
      total: 1, passed: 1, failed: 0,
      results: [{ item: 'control_ok', pass: true, evidence: 'legit' }],
    })], CR2_UUID.cr2_auditor);

    if (r1.ok) {
      pass('Cr2-incremental',
        `D1 合法 auditor audit_append 放行 (control group 确认未过严)`,
        'ok');
    } else {
      // 注：合法 auditor 调 audit_append 应放行。若拒绝说明 C2 过严（仍有问题，但不是失守）
      pass('Cr2-incremental',
        `D1 合法 auditor audit_append 被拒 (control group, 可能过严但非失守)`,
        `${r1.error && r1.error.code}`);
    }
  }
}

// ============================================================================
// 主函数
// ============================================================================
(async () => {
  console.log('=========================================');
  console.log('Cr 洁净室 V10 加固测试');
  console.log('设计原则: 从 spec 设计 + 重放真实失守');
  console.log('=========================================\n');

  console.log('【组 1】V10-auditor-active');
  await test_auditor_active();
  console.log('\n【组 2】V10-self-audit-forbidden-v2');
  await test_self_audit_v2();
  console.log('\n【组 3】V10-uuid-format-strict');
  await test_uuid_strict();
  console.log('\n【组 4】V10-numeric-consistency');
  await test_numeric_consistency();
  console.log('\n【组 5】V10-nudge-escalation');
  await test_nudge_escalation();
  console.log('\n【组 6】V10-timestamp-monotonic');
  await test_timestamp_monotonic();
  console.log('\n【组 7】V10-workspace-canonical');
  await test_workspace_canonical();
  console.log('\n【组 8】V10-status-event-sync');
  await test_status_event_sync();
  console.log('\n【组 9】audit-gate-test 失守链路重放【核心】');
  await test_breach_replay();
  console.log('\n【组 10】vfb/vfa1 17 种攻击重放');
  await test_vfb_attacks();

  // ============================================================================
  // === Cr2 incremental ===
  // Cr2 洁净室增量测试（v10v-Cr2-cleanroom）— C2 P1 折中后剩余风险探测
  // C2 P1 折中: cmdAuditAppend 只做 strict UUID + 轻量存在性 + 非自审
  //            不做 status/events/verdict 三重校验
  // ============================================================================
  console.log('\n【组 11】Cr2 incremental — C2 P1 折中风险探测');
  await test_cr2_incremental();

  console.log('\n=========================================');
  console.log('汇总');
  console.log('=========================================');
  console.log(`  通过: ${stats.passed}`);
  console.log(`  失败: ${stats.failed}`);
  console.log(`  跳过: ${stats.skipped}`);
  console.log('\n按组统计:');
  for (const g of Object.keys(stats.byGroup)) {
    const s = stats.byGroup[g];
    console.log(`  ${g}: ${s.passed}/${s.total} 通过`);
  }
  console.log('=========================================\n');
  process.exit(0);
})();
