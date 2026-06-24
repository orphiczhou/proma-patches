#!/usr/bin/env node
/**
 * audit-attacks.cjs — 独立审计员的对抗式攻击 harness
 * 目标：找出 dbc-spec (18/0 绿) 没覆盖的 DbC 硬约束绕过路径。
 * 通过 require patch-l/tree-engine.cjs 调引擎（M3：不再 spawn tree-state.js CLI，
 *   规避 Windows 引号问题的同时也消除对 tree-state.js 文件的依赖）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, 'core');
// 引擎 require（M3：内联引擎，消除对 tree-state.js 文件的 spawn 依赖）
// 自适应查找 tree-engine.cjs（让本文件在 test-sandbox/、skills/assets/、激活 assets/ 下都能定位 engine）
const _findEngine = () => {
  if (process.env.PROMA_TREE_ENGINE && fs.existsSync(process.env.PROMA_TREE_ENGINE)) return process.env.PROMA_TREE_ENGINE;
  const cands = [
    path.join(__dirname, '..', 'patch-l', 'tree-engine.cjs'),
    path.join(__dirname, '..', '..', '..', 'release', 'tree-system-v0.2.2', 'patch-l', 'tree-engine.cjs'),
    path.join(__dirname, '..', '..', '..', 'workspace-files', 'release', 'tree-system-v0.2.2', 'patch-l', 'tree-engine.cjs'),
    'D:\\Proma-dev\\resources\\app\\dist\\tree-engine.cjs',
    'D:\\Proma-release\\resources\\app\\dist\\tree-engine.cjs',
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  throw new Error('tree-engine.cjs not found. Set PROMA_TREE_ENGINE=<abs-path> or deploy engine to dist/.');
};
const engine = require(_findEngine());
engine.setTreesRoot(SANDBOX); // 原 CLI 用 __dirname，require 后必须显式注入

// 伪造的、树中不存在的 UUID（模拟 commander 凭空捏造一个"独立 auditor"）
const FAKE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const UUID = {
  root:   '00000000-0000-0000-0000-000000000001',
  worker: '00000000-0000-0000-0000-000000000002',
  auditor:'00000000-0000-0000-0000-000000000003',
  other:  '00000000-0000-0000-0000-000000000004',
};

// engine.run 是 async（返回 Promise），永不 throw。
// 成功 -> {ok:true, ...result}；失败 -> {ok:false, error:{code,msg}}。
async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  return { ok: !!out.ok, error: out.error || null, result: out, stdout: JSON.stringify(out) };
}

let counter = 100; // 避开 dbc-spec 的 tdb1-13
function freshTreeId() { counter++; const tid = `atk${counter}`; const d = path.join(SANDBOX, tid); if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); return tid; }
async function setupTree(budget) {
  const tid = freshTreeId();
  await run(['init', tid, '--root-brief', JSON.stringify({ parent_intent: 'audit' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: (budget === undefined ? 10 : budget), max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  return tid;
}
async function addWorker(tid, p) {
  const id = `${tid}-${p}-worker`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: id, session_id: UUID.worker, parent: `${tid}-root`, path: p, role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root })]);
  return id;
}
// v0.7 批次5: 确保树中有独立 auditor leaf（V4 set-result / V5b alignment / audit_gate 都需 auditor 在树）
async function ensureAuditorLeaf(tid) {
  await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: `${tid}-Aud-commander`, session_id: UUID.auditor, parent: `${tid}-root`, path: 'Aud', role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root })]);
}
function tamper(tree_id, fn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const s = JSON.parse(fs.readFileSync(sp, 'utf8')); fn(s); fs.writeFileSync(sp, JSON.stringify(s, null, 2));
}
function tamperLeaf(tree_id, leaf_id, fn) { tamper(tree_id, (s) => { if (s.leaves[leaf_id]) fn(s.leaves[leaf_id]); }); }

// 把 worker 配齐 done 前置（除被测项），但 expect_outputs 用攻击值
async function prep(tid, leafId, opts) {
  opts = opts || {};
  await ensureAuditorLeaf(tid);
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: opts.outputs === undefined ? ['real.md'] : opts.outputs })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.auditor })]);
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify(opts.doneMeta || { deliverables: [], self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  if (opts.auditGate !== false) await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', opts.auditor || UUID.auditor]);
}

const results = [];
function record(id, label, verdict, evidence) { results.push({ id, label, verdict, evidence }); console.log(`[${verdict}] ${id} ${label}\n      ${evidence}\n`); }

// 全部攻击场景包装进 async IIFE，保持原有顺序执行（await 串行）
(async () => {

// ---- A1 系列 ----
// 正控：真实文件存在 → done ok（证明 harness 没误伤）
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A1pos');
  const dir = path.join(SANDBOX, tid, 'deliverables'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'real.md'), 'x');
  await prep(tid, lid, { outputs: ['real.md'] });
  const r = await run(['leaf', 'set-status', tid, lid, 'done']);
  record('A1-pos', '正控: 真实文件存在 done 放行', r.ok ? '✓' : '⚠️', r.ok ? 'done ok（harness 正常）' : `FAIL ${JSON.stringify(r.error)}`);
}
// 攻击1a: expect_outputs=[] 空 → done
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A1empty');
  await prep(tid, lid, { outputs: [] });
  const r = await run(['leaf', 'set-status', tid, lid, 'done']);
  record('A1-empty', '空 expect_outputs 数组 done 绕过', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done 成功！零交付物即完成' : `被拦 ${r.error.code}`);
}
// 攻击1b: expect_outputs 缺省（milestone 无该字段）→ done
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A1miss');
  await ensureAuditorLeaf(tid);
  await run(['milestone', 'add', tid, lid, '--json', JSON.stringify({ id: 'M1', desc: 'm' })]); // 无 expect_outputs
  await run(['milestone', 'set-result', tid, lid, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.auditor })]);
  await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  const r = await run(['leaf', 'set-status', tid, lid, 'done']);
  record('A1-missing', '缺省 expect_outputs done 绕过', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done 成功！milestone 无任何交付物声明' : `被拦 ${r.error.code}`);
}
// 攻击1c: expect_outputs=[""] 空字符串 → done
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A1estr');
  await prep(tid, lid, { outputs: [''] });
  const r = await run(['leaf', 'set-status', tid, lid, 'done']);
  record('A1-emptystr', '空字符串 expect_outputs done 绕过', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done 成功！空串被 continue 跳过' : `被拦 ${r.error.code}`);
}
// 攻击1d: expect_outputs=[123,null,true] 非字符串 → done
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A1nonstr');
  await prep(tid, lid, { outputs: [123, null, true] });
  const r = await run(['leaf', 'set-status', tid, lid, 'done']);
  record('A1-nonstring', '非字符串 expect_outputs done 绕过', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done 成功！非字符串被 continue 跳过' : `被拦 ${r.error.code}`);
}
// 攻击1e: 绝对路径指向任意已存在文件（与工作无关）→ done
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A1abs');
  const anyFile = process.platform === 'win32' ? 'C:/Windows/win.ini' : '/etc/hosts';
  const exists = fs.existsSync(anyFile);
  await prep(tid, lid, { outputs: [anyFile] });
  const r = await run(['leaf', 'set-status', tid, lid, 'done']);
  record('A1-abspath', '绝对路径指向无关已存在文件 done 绕过', (r.ok && exists) ? '⚠️ BYPASS' : '✓/NA', r.ok ? `done 成功！交付物=${anyFile}（系统文件冒充产物）` : `被拦 ${r.error.code} (targetExists=${exists})`);
}

// ---- A2 系列：auditor 独立性是黑名单 ----
// 攻击2a: 伪造 UUID（树中不存在、非 added_by/root/null）→ audit pass 放行
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A2fake');
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok' })]);
  await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  const r = await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', FAKE]);
  record('A2-fabricated', '伪造 UUID auditor 冒充独立审计', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? `audit pass！auditor=${FAKE} 是凭空捏造、树中无对应 session` : `被拦 ${r.error.code}`);
}
// 攻击2b: auditor = worker 自己的 session_id（≠added_by≠root≠null）→ 放行
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A2self');
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok' })]);
  await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  const r = await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', UUID.worker]);
  record('A2-worker-self', 'worker 用自己 session_id 当 auditor', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? `audit pass！auditor=worker 自身 session（自审），因 ≠added_by≠root 蒙混过关` : `被拦 ${r.error.code}`);
}

// ---- A3：alignment 省略（V5b 后：brief_echo 无 alignment 合法，但 worker 拿不到 audit pass）----
// 攻击3: worker 发无 alignment 的 brief_echo，试图直接 audit pass（绕过对齐留痕）
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A3omit');
  await ensureAuditorLeaf(tid);
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: '理解了任务' })]); // 无 alignment，合法（标 pending）
  await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  const r = await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  record('A3-omit-alignment', '无 alignment 的 worker 绕过对齐留痕拿 audit pass', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'audit pass！alignment 从未留痕却通过审计' : `被拦 ${r.error.code}`);
}

// ---- A5：pass:false 结构合法 ----
// 攻击5: done event self_check 全 pass:false → 通过 schema
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'A5false');
  const r = await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'actually_failed', pass: false, evidence: '我其实没做' }] })]);
  record('A5-pass-false', 'self_check 全 pass:false 通过 schema', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done event 入库！self_check 自报失败但仍可记录 done，schema 只验结构不验 pass 值' : `被拦 ${r.error.code}`);
}

// ---- A4 系列 ----
// 攻击4a: node_budget=0 → 默认 10（|| 短路），可加多个 leaf
{
  const tid = await setupTree(0); // budget=0
  const a = await addWorker(tid, 'A4a0'); // root+1
  const r2 = await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: `${tid}-A4b0-worker`, session_id: UUID.other, parent: `${tid}-root`, path: 'A4b0', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root })]);
  record('A4-budget0', 'node_budget=0 被当默认值 10（|| 短路）', r2.ok ? '⚠️ GAP' : '✓', r2.ok ? 'budget=0 仍能加 leaf（0||10=10），预算=0 未被尊重' : `被拦 ${r2.error.code}`);
}
// 正控4b: archived leaf 正确排除出 activeCount
{
  const tid = await setupTree(2); // budget=2: root(1)+1
  const a = await addWorker(tid, 'A4b1'); // 2 active
  // 把 a 归档（先让 validate 干净：a 是 pending_brief worker，未 done，但归档前置要 validate。a 的 added_by=root 合法、parent 存在、path 一致 → 应 0 issue）
  const rArc = await run(['leaf', 'set-status', tid, a, 'archived']);
  // 归档后再加一个 worker
  const r2 = await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: `${tid}-A4b2-worker`, session_id: UUID.other, parent: `${tid}-root`, path: 'A4b2', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root })]);
  record('A4-archived-excluded', 'archived leaf 排除出 activeCount', r2.ok ? '✓' : '⚠️', r2.ok ? `加 leaf ok（archived 正确排除，activeCount 回到1<2）[archive=${rArc.ok?'ok':'FAIL:'+rArc.error.code}]` : `加 leaf 被拦 ${r2.error.code} [archive=${rArc.ok?'ok':'FAIL:'+rArc.error.code}]`);
}

// ---- HARDEN2：伪造 auditor 蒙混 validate 兜底 ----
// 攻击H2: 篡改 done worker，audit_gate pass + 伪造 UUID → validate 不报 issue
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'H2fake');
  tamperLeaf(tid, lid, (l) => { l.status = 'done'; l.audit_gate = { verdict: 'pass', auditor_session_id: FAKE, ts: '2026-06-23T00:00:00Z' }; });
  const r = await run(['validate', tid]);
  const issues = (r.result && r.result.issues) || [];
  const hit = issues.find((i) => /audit|independent/i.test(i.type || '') || /audit|independent|self.audit/i.test(i.detail || ''));
  record('H2-fabricated-auditor', '伪造 UUID auditor 蒙过 validate 兜底', hit ? '✓' : '⚠️ BYPASS', hit ? `validate 报出 issue: ${hit.type}` : `validate 干净（${issues.length} issues）！伪造 auditor=${FAKE} 不在黑名单，HARDEN2 兜底失效`);
}

// ---- commander done 无审计 ----
// 攻击: commander 默认 audit_gate.verdict=skip，done 时跳过审计门；HARDEN2 只查 worker
{
  const tid = await setupTree(); const cid = `${tid}-C-commander`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: cid, session_id: UUID.worker, parent: `${tid}-root`, path: 'C', role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root })]);
  // commander 无子节点 → children 检查通过；milestone+audit_pass
  await run(['milestone', 'add', tid, cid, '--json', JSON.stringify({ id: 'M1', expect_outputs: [] })]);
  await run(['milestone', 'set-result', tid, cid, 'M1', '--audit-pass', 'true']);
  const r = await run(['leaf', 'set-status', tid, cid, 'done']);
  record('CMD-done-no-audit', 'commander 默认 verdict=skip 直接 done 无审计', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'commander done！audit_gate.verdict=skip（默认），审计门未触发；HARDEN2 只查 worker 不查 commander' : `被拦 ${r.error.code}`);
}

// ---- milestone-set-result 无门 ----
// 攻击: 直接 set-result --audit-pass true，无任何审计校验
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'Ms1');
  await run(['milestone', 'add', tid, lid, '--json', JSON.stringify({ id: 'M1', expect_outputs: [] })]);
  const r = await run(['milestone', 'set-result', tid, lid, 'M1', '--audit-pass', 'true']);
  record('MS-free-auditpass', 'milestone set-result 无条件设 audit_pass=true', r.ok ? '⚠️ ENABLER' : '✓', r.ok ? 'audit_pass=true 入库！无独立性校验，是 done 绕过的关键放大器' : `被拦 ${r.error.code}`);
}

// ---- 控制点#1 CRITICAL: cmdRestore 全量旁路 ----
// 攻击: backup → 篡改 backup JSON 伪造 done worker（伪造 auditor）→ restore → validate 干净
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'R1'); // worker 未 done
  await run(['backup', tid, '--label', 'pre-attack']);
  // 找到 backup 文件
  const backups = fs.readdirSync(path.join(SANDBOX, tid)).filter(f => /\.backup\..*pre-attack\.json$/.test(f));
  if (backups.length === 0) {
    record('RST-restore-bypass', 'cmdRestore 绕过全部 DbC（伪造 done worker）', 'NA', '找不到 backup 文件');
  } else {
    const bpath = path.join(SANDBOX, tid, backups[backups.length - 1]);
    const st = JSON.parse(fs.readFileSync(bpath, 'utf8'));
    // 伪造：worker done + 独立(伪造) auditor + milestone audit_pass + 空 expect_outputs + done event
    const w = st.leaves[lid];
    w.status = 'done';
    w.audit_gate = { verdict: 'pass', auditor_session_id: FAKE, ts: '2026-06-23T00:00:00Z' };
    w.milestones = [{ id: 'M1', desc: 'forged', expect_outputs: [], status: 'done', audit_pass: true, note_path: null }];
    w.events = [
      { type: 'brief_echo', ts: '2026-06-23T00:00:00+08:00', meta: { ack: 'ok' } },
      { type: 'done', ts: '2026-06-23T00:00:01+08:00', meta: { self_check: [{ item: 'forged', pass: true, evidence: 'never actually did the work' }] } },
    ];
    w.last_event_type = 'done';
    fs.writeFileSync(bpath, JSON.stringify(st, null, 2));
    const rRest = await run(['restore', tid, backups[backups.length - 1]]);
    // 验证：leaf 是 done？validate 干净？
    const rGet = await run(['leaf', 'get', tid, lid]);
    const leafStatus = rGet.result && rGet.result.leaf && rGet.result.leaf.status;
    const rVal = await run(['validate', tid]);
    const valOk = rVal.result && rVal.result.ok;
    const bypassed = rRest.ok && leafStatus === 'done' && valOk;
    record('RST-restore-bypass', 'cmdRestore 绕过全部 DbC（伪造 done worker）', bypassed ? '⚠️ CRITICAL BYPASS' : '✓', bypassed
      ? `restore ok + leaf.status=done + validate ok！A1/A2/A5/A7/HARDEN2 全部被 restore 旁路，0 真实验收`
      : `未完全绕过 [restore=${rRest.ok} status=${leafStatus} validateOk=${valOk} err=${rRest.error&&rRest.error.code}]`);
  }
}

// ---- 控制点#1: cmdRestore 写回不合规（非伪造 auditor 版，验 restore 不跑 validate）----
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'R2');
  await run(['backup', tid, '--label', 'pre-attack2']);
  const backups = fs.readdirSync(path.join(SANDBOX, tid)).filter(f => /\.backup\..*pre-attack2\.json$/.test(f));
  const bpath = path.join(SANDBOX, tid, backups[backups.length - 1]);
  const st = JSON.parse(fs.readFileSync(bpath, 'utf8'));
  // 故意写一个 HARDEN2 会报的脏状态：done worker + auditor=added_by(root) 自审
  const w = st.leaves[lid];
  w.status = 'done';
  w.audit_gate = { verdict: 'pass', auditor_session_id: UUID.root, ts: '2026-06-23T00:00:00Z' };
  fs.writeFileSync(bpath, JSON.stringify(st, null, 2));
  const rRest = await run(['restore', tid, backups[backups.length - 1]]);
  const rVal = await run(['validate', tid]);
  const restored = rRest.ok;
  const dirtyAfter = !((rVal.result && rVal.result.ok)); // validate 现在能查出问题（说明脏数据被写回去了）
  record('RST-restore-dirty', 'cmdRestore 写回脏数据不拦截（不跑 validate）', (restored) ? '⚠️ BYPASS' : '✓', restored
    ? `restore ok！脏状态(done worker+自审 auditor)被写回，restore 未跑任何 DbC 校验；事后 validate ${dirtyAfter?'能查出':'未查出'}（证明数据已被污染）`
    : `restore 被拦 ${rRest.error.code}`);
}

// ---- 控制点#2: 不经 audit-gate 命令能否得到 verdict=pass ----
// set-session 不能改 audit_gate（已验证只改 session_id）。唯一旁路=restore/直接改文件。
// 用 tamper 模拟"直接改文件"（这是 CLI 之外，但 restore 是 CLI 内等价物，已在 RST 覆盖）
{
  const tid = await setupTree(); const lid = await addWorker(tid, 'Cp1');
  tamperLeaf(tid, lid, (l) => { l.audit_gate = { verdict: 'pass', auditor_session_id: FAKE, ts: '2026-06-23T00:00:00Z' }; });
  const rVal = await run(['validate', tid]);
  const issues = (rVal.result && rVal.result.issues) || [];
  const auditIssue = issues.find((i) => /audit|independent/i.test(i.type||'') || /audit|independent/i.test(i.detail||''));
  record('CP2-direct-forge', '直接改文件伪造 audit_gate.pass（伪造 auditor）', auditIssue ? '✓(部分)' : '⚠️ BYPASS', auditIssue ? `validate 报出: ${auditIssue.type}` : `validate 干净！伪造 pass+伪造 auditor 不被 detect，控制点#2 兜底失效`);
}

// ============ 汇总 ============
console.log('\n============================================================');
console.log('对抗攻击汇总');
console.log('============================================================');
const bypass = results.filter(r => r.verdict.includes('BYPASS') || r.verdict.includes('CRITICAL'));
const gaps = results.filter(r => r.verdict.includes('GAP') || r.verdict.includes('ENABLER'));
const ok = results.filter(r => r.verdict.includes('✓') && !r.verdict.includes('part'));
console.log(`总攻击: ${results.length} | ⚠️可绕过: ${bypass.length} | GAP/ENABLER: ${gaps.length} | ✓不可绕过: ${ok.length}`);
console.log('\n⚠️ 漏洞/绕过:');
for (const r of bypass) console.log(`  ${r.verdict.replace(/⚠️ /,'')}  ${r.id} — ${r.label}`);
console.log('\nGAP/放大器:');
for (const r of gaps) console.log(`  ${r.id} — ${r.label}`);
process.exit(0);
})();
