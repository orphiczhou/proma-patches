#!/usr/bin/env node
/**
 * audit-extra.cjs — 独立审计员补充对抗 harness（针对 V4-V9 + CP2 的实现者盲区）
 * 复用 audit-attacks.cjs 的引擎 require 策略。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, 'core');
const _findEngine = () => {
  if (process.env.PROMA_TREE_ENGINE && fs.existsSync(process.env.PROMA_TREE_ENGINE)) return process.env.PROMA_TREE_ENGINE;
  const cands = [
    path.join(__dirname, '..', 'patch-l', 'tree-engine.cjs'),
    'D:\\Proma-dev\\resources\\app\\dist\\tree-engine.cjs',
    'D:\\Proma-release\\resources\\app\\dist\\tree-engine.cjs',
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  throw new Error('tree-engine.cjs not found');
};
const engine = require(_findEngine());
engine.setTreesRoot(SANDBOX);
// L2-root-cause (层2 身份校验根治): 注入 mock session verifier（替代旧占位 UUID 跳过）。
//   测试环境无真实 Proma session，占位前缀 UUID（00000000-...-XXX）视为真实 session（放行）；
//   非占位 UUID（伪造合法 v4）→ false → assertMcpEntrySessionId 拒(E_SESSION_NOT_ALIVE) / resolveAuditorIndep 拒(E_AUDITOR_NOT_INDEPENDENT)。
//   FAKE(全f) 在 FORBIDDEN_UUIDS 由格式校验拦截（不到 verifier）。详见设计文档 §五。
engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',
  workerA: '00000000-0000-0000-0000-000000000002',
  auditor: '00000000-0000-0000-0000-000000000003',
  workerB: '00000000-0000-0000-0000-000000000004',
  workerC: '00000000-0000-0000-0000-000000000005',
};
const FAKE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  return { ok: !!out.ok, error: out.error || null, result: out };
}
let counter = 300;
function freshTreeId(budget) {
  counter++; const tid = `axk${counter}`;
  const d = path.join(SANDBOX, tid);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  // 直接造 init：手动调 engine run
  return { tid, budget };
}
async function setupTree(budget) {
  const { tid } = freshTreeId();
  await run(['init', tid, '--root-brief', JSON.stringify({ parent_intent: 'audit' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: (budget === undefined ? 10 : budget), max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  return tid;
}
async function setupTreeRawDod(dodObj) {
  const { tid } = freshTreeId();
  await run(['init', tid, '--root-brief', JSON.stringify({ parent_intent: 'audit' }),
    '--root-dod', JSON.stringify(dodObj),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic']);
  return tid;
}
async function addLeaf(tid, p, role, sid) {
  const id = `${tid}-${p}-${role}`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: id, session_id: sid, parent: `${tid}-root`, path: p, role, model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root })]);
  return id;
}
function tamperLeaf(tree_id, leaf_id, fn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (s.leaves[leaf_id]) fn(s.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
}
function makeDeliverable(tid, rel) {
  const dir = path.join(SANDBOX, tid, 'deliverables');
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'x');
}
// 把 worker 配齐 done 前置（用独立 auditor + 真 alignment）
async function prepDone(tid, leafId, opts) {
  opts = opts || {};
  await addLeaf(tid, 'Aud', 'commander', UUID.auditor); // 独立 auditor leaf
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: opts.outputs || ['real.md'] })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  if (opts.briefAlignment !== false) {
    await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.auditor })]);
  } else {
    await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok' })]); // 无 alignment → pending=true
  }
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json', JSON.stringify({ deliverables: [], self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', opts.auditor || UUID.auditor]);
}

const results = [];
function rec(id, label, verdict, evidence) { results.push({ id, label, verdict, evidence }); console.log(`[${verdict}] ${id} ${label}\n      ${evidence}\n`); }

(async () => {

// ============================================================
// 攻击 A: alignment_pending 文件篡改绕过 V5b 门 + validate 兜底盲区
// 设计：worker 无 alignment（pending=true）→ tamper 设 pending=false → audit pass → done；validate 不查 pending
// ============================================================
{
  const tid = await setupTree();
  const lid = await addLeaf(tid, 'Atp', 'worker', UUID.workerA);
  await prepDone(tid, lid, { outputs: ['real.md'], briefAlignment: false }); // 无 alignment → pending=true；audit gate 此时应失败，但 prepDone 强行 pass...
  // prepDone 里 audit gate pass 在 pending=true 时会被拦，重新试一次确认
  // 先造交付物
  makeDeliverable(tid, 'real.md');
  // 此时 leaf.alignment_pending 应为 true（无 alignment brief_echo）
  const leaf1 = (await run(['leaf', 'get', tid, lid])).result.leaf;
  rec('X-pending-state', '无 alignment brief_echo 后 alignment_pending 状态', leaf1.alignment_pending === true ? '✓' : '⚠️',
      `alignment_pending=${leaf1.alignment_pending} (期望 true)`);
  // 篡改：直接清 pending
  tamperLeaf(tid, lid, (l) => { l.alignment_pending = false; });
  // audit gate pass（此时 pending=false，门放行）
  const rGate = await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  // done
  const rDone = await run(['leaf', 'set-status', tid, lid, 'done']);
  const leafStatus = (await run(['leaf', 'get', tid, lid])).result.leaf.status;
  // validate 是否报 alignment_pending 篡改
  const rVal = await run(['validate', tid]);
  const valOk = rVal.result && rVal.result.ok;
  const bypassed = rGate.ok && rDone.ok && leafStatus === 'done';
  rec('X-tamper-clear-pending', '篡改 alignment_pending=false 绕过 V5b 门拿 done',
      bypassed ? '⚠️ BYPASS' : '✓',
      bypassed ? `gate ok + done ok + status=done！篡改 pending 绕过对齐门；validate ${valOk?'干净(盲区)':'报错'}` : `未绕过 [gate=${rGate.ok} done=${rDone.ok} status=${leafStatus} err=${rDone.error&&rDone.error.code}]`);
  rec('X-validate-blind-to-pending', 'validate 是否检查 alignment_pending 篡改',
      valOk ? '⚠️ BLIND' : '✓',
      valOk ? `validate 干净！alignment_pending=false 是篡改的，validate 不查此字段 → V5b 兜底盲区` : `validate 报 ${rVal.result.issues.length} issue(s)`);
}

// ============================================================
// 攻击 B: SKILL 流程破坏 — 按 SKILL §3.1（brief_echo 无 alignment）走的 worker 能否 done？
// ============================================================
{
  const tid = await setupTree();
  const lid = await addLeaf(tid, 'Bsk', 'worker', UUID.workerA);
  makeDeliverable(tid, 'real.md');
  await addLeaf(tid, 'Aud', 'commander', UUID.auditor);
  await run(['milestone', 'add', tid, lid, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['real.md'] })]);
  await run(['milestone', 'set-result', tid, lid, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  // SKILL §3.1 标准 brief_echo：my_understanding + milestones_preview，无 alignment
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ my_understanding: { parent_intent: 'x', my_mission: 'y' }, milestones_preview: ['M1 x'] })]);
  await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  // 母会话独立 auditor 想 pass
  const rGate = await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  const rDone = rGate.ok ? await run(['leaf', 'set-status', tid, lid, 'done']) : null;
  rec('X-skill-flow-blocked', 'SKILL §3.1 标准 worker（brief_echo 无 alignment）能否 audit pass+done',
      (rGate.ok && rDone && rDone.ok) ? '✓(可done)' : '⚠️ 流程破坏',
      (rGate.ok && rDone && rDone.ok) ? '能 done（说明 alignment 由别处回填）' : `按 SKILL 走的 worker 被 V5b 门挡住：gate=${rGate.ok?'ok':'拦:'+rGate.error.code}；SKILL 未教 worker/母会话回填 alignment 到 brief_echo`);
}

// ============================================================
// 攻击 C: 互审洗白 — worker A 用 worker B（独立 leaf）当 auditor 清 alignment / milestone
// ============================================================
{
  const tid = await setupTree();
  const lidA = await addLeaf(tid, 'Cm', 'worker', UUID.workerA);
  const lidB = await addLeaf(tid, 'Cb', 'worker', UUID.workerB); // 独立 worker B（合法 path）
  makeDeliverable(tid, 'real.md');
  await run(['milestone', 'add', tid, lidA, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['real.md'] })]);
  // V4: A 的 milestone 用 B 当 auditor（A、B 独立，B≠A.added_by(root)）
  const rMs = await run(['milestone', 'set-result', tid, lidA, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.workerB]);
  // V5b: A 的 brief_echo 用 B 当 alignment auditor
  const rEcho = await run(['event', 'append', tid, lidA, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.workerB })]);
  const leafA = (await run(['leaf', 'get', tid, lidA])).result.leaf;
  rec('X-cross-worker-audit', '两个独立 worker 互相当 auditor（形式独立）洗白',
      (rMs.ok && rEcho.ok && leafA.alignment_pending === false) ? '⚠️ 形式放行' : '✓',
      (rMs.ok && rEcho.ok && leafA.alignment_pending === false) ? `A 用 B 当 auditor：milestone audit_pass=${rMs.ok}、brief_echo alignment_pending=${leafA.alignment_pending}。引擎只验形式独立(≠self/≠added_by/真实存在)，不识别两个 worker 串通` : `被拦 ms=${rMs.error&&rMs.error.code} echo=${rEcho.error&&rEcho.error.code}`);
}

// ============================================================
// 攻击 D: V8 budget 类型混淆（字符串/布尔/对象/负数）
// ============================================================
async function tryAddExtra(tid, sid) {
  return await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: `${tid}-Dx-worker`, session_id: sid, parent: `${tid}-root`, path: 'Dx', role: 'worker', model: 'm', channel: 'c', added_by: UUID.root })]);
}
{
  // budget="0" 字符串
  const tid = await setupTreeRawDod({ deliverables: [], node_budget: "0", max_depth: 3 });
  const r1 = await addLeaf(tid, 'D1', 'worker', UUID.workerA); // root + 1 = 2 active
  const r2 = await tryAddExtra(tid, UUID.workerB);
  rec('X-v8-string-zero', 'node_budget="0"(字符串) 是否被当默认 10',
      r2.ok ? '⚠️ BYPASS' : '✓', r2.ok ? `字符串"0"被当默认10，root+2 leaf 仍能加！预算0 未被尊重` : `被拦 ${r2.error.code}（字符串0 被正确处理）`);
}
{
  // budget=true
  const tid = await setupTreeRawDod({ deliverables: [], node_budget: true, max_depth: 3 });
  await addLeaf(tid, 'D2', 'worker', UUID.workerA);
  const r2 = await tryAddExtra(tid, UUID.workerB);
  rec('X-v8-bool', 'node_budget=true 是否被当默认 10', r2.ok ? '⚠️ 回退10' : '✓', r2.ok ? `true 当 10，可加` : `被拦 ${r2.error.code}`);
}
{
  // budget=-1 负数
  const tid = await setupTreeRawDod({ deliverables: [], node_budget: -1, max_depth: 3 });
  const r1 = await run(['leaf', 'add', tid, '--json', JSON.stringify({ leaf_id: `${tid}-D3-worker`, session_id: UUID.workerA, parent: `${tid}-root`, path: 'D3', role: 'worker', model: 'm', channel: 'c', added_by: UUID.root })]);
  rec('X-v8-negative', 'node_budget=-1 行为', r1.ok ? '⚠️ 异常放行' : '✓(更严)',
      r1.ok ? `负数 budget 居然能加 leaf！activeCount(1) 应 >= -1 被拦但放行` : `被拦 ${r1.error.code}（负数=禁止任何 leaf，比 0 更严，安全）`);
}
{
  // budget="5" 字符串数字
  const tid = await setupTreeRawDod({ deliverables: [], node_budget: "5", max_depth: 3 });
  await addLeaf(tid, 'D4a', 'worker', UUID.workerA);
  await addLeaf(tid, 'D4b', 'worker', UUID.workerB);
  await addLeaf(tid, 'D4c', 'worker', UUID.workerC);
  const r5 = await tryAddExtra(tid, '00000000-0000-0000-0000-000000000006');
  rec('X-v8-string-5', 'node_budget="5"(字符串) 是否被当默认 10', r5.ok ? '⚠️ 回退10' : '✓', r5.ok ? `"5" 当 10，第5个 leaf 仍能加（本应限5）` : `被拦 ${r5.error.code}`);
}

// ============================================================
// 攻击 E: V9 Windows 盘符/UNC/遍历变体
// ============================================================
async function v9Case(name, outputs, preCreate) {
  const tid = await setupTree();
  const lid = await addLeaf(tid, 'E' + name, 'worker', UUID.workerA);
  await addLeaf(tid, 'Aud', 'commander', UUID.auditor);
  makeDeliverable(tid, 'real.md');
  if (preCreate) try { preCreate(tid); } catch (e) {}
  await run(['milestone', 'add', tid, lid, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: outputs })]);
  await run(['milestone', 'set-result', tid, lid, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.auditor })]);
  await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  const r = await run(['leaf', 'set-status', tid, lid, 'done']);
  return r;
}
{
  const win = process.platform === 'win32';
  // C:\Windows\win.ini (反斜杠)
  let r = await v9Case('bslash', [win ? 'C:\\Windows\\win.ini' : '/etc/hosts']);
  rec('X-v9-backslash-abs', 'V9: C:\\Windows\\win.ini (反斜杠绝对路径)', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done！系统文件冒充产物' : `被拦 ${r.error.code}`);
  // C:/Windows/win.ini (正斜杠)
  r = await v9Case('fwdslash', [win ? 'C:/Windows/win.ini' : '/etc/hosts']);
  rec('X-v9-fwdslash-abs', 'V9: C:/Windows/win.ini (正斜杠绝对路径)', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done！' : `被拦 ${r.error.code}`);
  // /c/Windows/ (git bash 风格)
  if (win) {
    r = await v9Case('gitbash', ['/c/Windows/win.ini']);
    rec('X-v9-gitbash', 'V9: /c/Windows/win.ini (git-bash 风格)', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done！' : `被拦 ${r.error.code}`);
    // UNC \\host\share
    r = await v9Case('unc', ['\\\\localhost\\c$\\Windows\\win.ini']);
    rec('X-v9-unc', 'V9: UNC \\\\localhost\\c$\\...', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done！UNC 访问' : `被拦 ${r.error.code}`);
    // 长路径前缀 \\?\C:\
    r = await v9Case('longpath', ['\\\\?\\C:\\Windows\\win.ini']);
    rec('X-v9-longpath', 'V9: \\\\?\\C:\\Windows (长路径前缀)', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done！' : `被拦 ${r.error.code}`);
  }
  // .. 混合大小写 + 编码
  r = await v9Case('dotdot', ['../../../../../../etc/hosts']);
  rec('X-v9-dotdot', 'V9: ../../etc/hosts (遍历)', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done！逃出 deliverables' : `被拦 ${r.error.code}`);
  r = await v9Case('dotdot-mixed', ['sub/../../real.md']); // 规范化后仍在 droot 内 → 应放行(合法)
  rec('X-v9-dotdot-mixed', 'V9: sub/../../real.md (规范化后合法)', r.ok ? '✓(合法放行)' : '⚠️', r.ok ? '放行(规范化后仍在 deliverables 内，正确)' : `被拦 ${r.error.code}`);
  r = await v9Case('urlenc', ['%2e%2e%2f%2e%2e%2freal.md']);
  rec('X-v9-urlenc', 'V9: %2e%2e%2f URL编码遍历', r.ok ? '⚠️ BYPASS' : '✓', r.ok ? 'done！URL编码逃逸' : `被拦 ${r.error.code}（字面文件名不存在）`);
  // 符号链接逃逸：在 deliverables/ 建 symlink 指向外部文件
  if (win) {
    r = await v9Case('symlink', ['link.txt'], (tid) => {
      try {
        fs.symlinkSync('C:\\Windows\\win.ini', path.join(SANDBOX, tid, 'deliverables', 'link.txt'), 'file');
      } catch (e) { /* 权限不足则跳过 */ }
    });
    const linkExists = fs.existsSync(path.join(SANDBOX, 'unused'));
    rec('X-v9-symlink', 'V9: deliverables/ 下符号链接指向外部文件', r.ok ? '⚠️ BYPASS(若链接建成)' : '✓/NA', r.ok ? 'done！symlink 逃逸 deliverables 沙箱' : `被拦 ${r.error.code}（symlink 可能未建成或 path 校验拦截）`);
  }
}

// ============================================================
// 攻击 F: V5b 多 brief_echo — 第一条无 alignment(pending=true)，第二条带独立 auditor 清 pending（合法路径确认）
// ============================================================
{
  const tid = await setupTree();
  const lid = await addLeaf(tid, 'Fmulti', 'worker', UUID.workerA);
  makeDeliverable(tid, 'real.md');
  await addLeaf(tid, 'Aud', 'commander', UUID.auditor);
  await run(['milestone', 'add', tid, lid, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['real.md'] })]);
  await run(['milestone', 'set-result', tid, lid, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: '理解' })]); // 无 alignment → pending=true
  const mid = (await run(['leaf', 'get', tid, lid])).result.leaf;
  // 第二条 brief_echo 带 alignment + 独立 auditor → 清 pending
  await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: '回填', alignment: '90%', auditor_session_id: UUID.auditor })]);
  const after = (await run(['leaf', 'get', tid, lid])).result.leaf;
  await run(['event', 'append', tid, lid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  const rGate = await run(['audit', 'gate', tid, lid, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  const rDone = await run(['leaf', 'set-status', tid, lid, 'done']);
  rec('X-multi-echo-clear', 'V5b: 多 brief_echo 第二条带独立 auditor 清 pending (合法路径)',
      (after.alignment_pending === false && rGate.ok && rDone.ok) ? '✓(符合设计)' : '⚠️',
      `首条无align→pending=${mid.alignment_pending}；二条带align+独立auditor→pending=${after.alignment_pending}；gate=${rGate.ok} done=${rDone.ok}`);
}

// ============================================================
// 攻击 G: V5b worker 自己当 alignment auditor（应被拦）
// ============================================================
{
  const tid = await setupTree();
  const lid = await addLeaf(tid, 'Gself', 'worker', UUID.workerA);
  const rEcho = await run(['event', 'append', tid, lid, '--type', 'brief_echo', '--json', JSON.stringify({ ack: 'ok', alignment: '100%', auditor_session_id: UUID.workerA })]);
  rec('X-self-auditor-align', 'V5b: worker 用自己 session 当 alignment auditor', rEcho.ok ? '⚠️ BYPASS' : '✓', rEcho.ok ? 'brief_echo 入库！自审 alignment 蒙混' : `被拦 ${rEcho.error.code}`);
}

// ============================================================
// 攻击 H: commander 无 alignment 拿 audit pass（设计确认，非漏洞）
// ============================================================
{
  const tid = await setupTree();
  const cid = await addLeaf(tid, 'Hcmd', 'commander', UUID.workerA);
  makeDeliverable(tid, 'real.md');
  await addLeaf(tid, 'Aud', 'commander', UUID.auditor);
  await run(['milestone', 'add', tid, cid, '--json', JSON.stringify({ id: 'M1', desc: 'm', expect_outputs: ['real.md'] })]);
  await run(['milestone', 'set-result', tid, cid, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  // commander 发 done event（commander 也要 events? done 前置 worker 才查 events；commander 不查）
  await run(['event', 'append', tid, cid, '--type', 'done', '--json', JSON.stringify({ self_check: [{ item: 'x', pass: true, evidence: 'e' }] })]);
  // commander audit pass（无 alignment，role!==worker 不查 pending）
  const rGate = await run(['audit', 'gate', tid, cid, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  rec('X-commander-no-align-pass', 'V5b: commander 无 alignment 拿 audit pass',
      rGate.ok ? '✓(设计)' : '⚠️', rGate.ok ? 'commander pass（设计：alignment 是 worker 概念，commander 不查 pending；但 commander done 仍需 milestones+子done）' : `被拦 ${rGate.error.code}`);
}

// ============================================================
// 汇总
// ============================================================
console.log('\n============================================================');
console.log('补充对抗汇总');
console.log('============================================================');
const bypass = results.filter(r => r.verdict.includes('BYPASS') || r.verdict.includes('CRITICAL') || r.verdict.includes('BLIND'));
const flow = results.filter(r => r.verdict.includes('流程破坏') || r.verdict.includes('形式'));
const ok = results.filter(r => r.verdict.includes('✓') && !r.verdict.includes('形式') && !r.verdict.includes('回退'));
console.log(`总: ${results.length} | ⚠️新绕过/盲区: ${bypass.length} | 流程/设计问题: ${flow.length} | ✓不可绕过: ${ok.length}`);
console.log('\n⚠️ 新绕过/盲区:');
for (const r of bypass) console.log(`  ${r.id} — ${r.label}`);
console.log('\n流程/设计问题:');
for (const r of flow) console.log(`  ${r.id} — ${r.label}`);
process.exit(0);
})();
