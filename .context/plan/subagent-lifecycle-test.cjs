#!/usr/bin/env node
/**
 * subagent-lifecycle-test.cjs — SubAgent 入树机制交叉验证 (2026-07-07)
 *
 * 被测改动 (tree-engine.cjs, SubAgent A):
 *   - EVENT_TYPE_ENUM 增 subagent_spawn (L80)
 *   - validateSubagentSpawnSchema (L1217): subagent_id 格式 + 父段锁 + role 枚举 + perspective/ purpose/ output_ref 必填 + assertSafeExpectOutputs (path-safe) + status 缺省 done + status=done 时 output_ref 文件存在 + size>0
 *   - validateReviewRoundSchema reviewer_kind 分支 (L1285):
 *       session (缺省): 老逻辑 UUID + ≠owner + ≠added_by
 *       subagent: reviewer_ref=sub:<本leaf>:<序号> + 禁 reviewer_session_id + 本 leaf.events 须有匹配 subagent_spawn (否则 E_REVIEW_FORGERY)
 *   - review_round.meta.independence 可选 (self_delegated|independent), 非法 → E_REVIEW_FORGERY (L1361)
 *   - cmdEventAppend L1996: type=subagent_spawn 走 validateSubagentSpawnSchema
 *   - BUG-3: cmdLeafSetStatus done 门禁 expect_outputs size>0 (L1460, E_DELIVERABLE_EMPTY)
 *
 * 测试方法: 独立沙箱, 每个场景独立小树互不污染. 落真实非空文件 (fs.writeFileSync), 不 mock.
 *   按 spec 写期望, 跑实际引擎, 诚实报 pass/fail. 失败不迁就引擎, 报上来让主会话判断.
 *
 * Harness 模式复用自 iss003-review-gate-test.cjs / p0-3-status-transition-test.cjs:
 *   - require(ENGINE_PATH); engine.setTreesRoot(SANDBOX); engine.setSessionVerifier(mock)
 *   - engine.run(cmd, args, treesRoot?, callerSessionId?) 永不 throw, 返回 {ok:true}|{ok:false,error:{code,msg}}
 *   - tamperLeaf 直接读改 tree-state.json (绕过 API 构造 from 状态 / 注入 review_round)
 *   - expectOk / expectFail 断言 + pass/fail 计数 + 末尾总结
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 引擎 setup
// ============================================================
const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

// 临时沙箱 (独立目录, 结束清理)
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-life-'));
engine.setTreesRoot(SANDBOX);

// mock session verifier (沿用占位 UUID 放行策略, 与 iss003/p0-3 一致)
engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

// 固定测试 UUID (每棵 tree 内 session_id 唯一)
const UUID = {
  root:    '00000000-0000-0000-0000-000000000001',  // tree init root + added_by
  worker:  '00000000-0000-0000-0000-000000000002',  // worker leaf session
  auditor: '00000000-0000-0000-0000-000000000003',  // milestone/audit_gate auditor
  other:   '00000000-0000-0000-0000-000000000004',  // 备用
  rev1:    '00000000-0000-0000-0000-000000000011',  // 独立 reviewer
};

// ============================================================
// run helper
// ============================================================
async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1), SANDBOX);
  return { ok: !!out.ok, error: out.error || null, result: out };
}

// ============================================================
// 断言
// ============================================================
const stats = { passed: 0, failed: 0 };
const results = [];
function pass(name, info) { stats.passed++; results.push({ name, status: 'PASS' }); console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; results.push({ name, status: 'FAIL', info }); console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

async function expectOk(name, cmdArgs) {
  const r = await run(cmdArgs);
  if (r.ok) { pass(name, 'ok'); return r; }
  fail(name, `期望成功, 实际失败 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 160)}`);
  return r;
}
async function expectFail(name, cmdArgs, expectedCode) {
  const r = await run(cmdArgs);
  if (r.ok) { fail(name, `期望失败 ${expectedCode}, 但命令成功了`); return r; }
  if (r.error && r.error.code === expectedCode) { pass(name, expectedCode); return r; }
  fail(name, `期望 ${expectedCode}, 实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 160)}`);
  return r;
}

// ============================================================
// 通用 setup helpers
// ============================================================
let counter = 0;
function freshTreeId() {
  counter++;
  return `subt${counter}`;  // leaf_id prefix 正则 [a-z][a-z0-9_]{3,7}
}

// auditMetaOverride (可选): 透传为 --audit-meta, 与 DEFAULT_AUDIT_META merge.
//   现有调用方不传第三参 → 行为不变 (走默认 audit_meta).
async function initTree(tid, auditMetaOverride) {
  const args = ['init', tid,
    '--root-brief', JSON.stringify({ parent_intent: 'subagent lifecycle test' }),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID.root, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic',
  ];
  if (auditMetaOverride !== undefined && auditMetaOverride !== null) {
    args.push('--audit-meta', JSON.stringify(auditMetaOverride));
  }
  return run(args);
}

async function addWorker(tid, leafPath, workerSession) {
  const leafId = `${tid}-${leafPath}-worker`;
  const r = await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId, session_id: workerSession || UUID.worker, parent: `${tid}-root`,
    path: leafPath, role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  if (!r.ok) {
    throw new Error(`addWorker(${leafId}) failed: ${r.error && r.error.code}: ${r.error && r.error.msg}`);
  }
  return leafId;
}

// 直接读改 tree-state.json (绕过 API 注入 review_round / 篡改 leaf 状态)
function tamperLeaf(tree_id, leaf_id, mutateFn) {
  const sp = path.join(SANDBOX, tree_id, 'tree-state.json');
  const state = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (state.leaves[leaf_id]) mutateFn(state.leaves[leaf_id]);
  fs.writeFileSync(sp, JSON.stringify(state, null, 2));
}

// 落非空产物到 deliverables/<rel>
function createDeliverable(tree_id, rel, content) {
  const fp = path.join(SANDBOX, tree_id, 'deliverables', rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content || 'non-empty subagent test deliverable\n');
  return fp;
}
// 落 0 字节产物
function createEmptyDeliverable(tree_id, rel) {
  const fp = path.join(SANDBOX, tree_id, 'deliverables', rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, '');
  return fp;
}

// 构造合法 subagent_spawn meta (默认 done + role=review + perspective=G1)
function spawnMeta(leafId, seq, overrides) {
  const base = {
    subagent_id: `sub:${leafId}:${seq}`,
    role: 'review',
    perspective: 'G1-correctness',
    purpose: 'review worker deliverable for correctness',
    output_ref: `subagent-outputs/${leafId}-${seq}.md`,
    status: 'done',
  };
  return Object.assign({}, base, overrides || {});
}

// ============================================================
// 测试场景
// ============================================================

// Case 1: subagent_spawn schema 合法 → ok
//   建树→建 worker leaf→先落真实非空 output 文件→append 合法 subagent_spawn → ok
async function case1_legal_spawn() {
  console.log('\n[1] subagent_spawn schema 合法 → ok');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C1');
  const meta = spawnMeta(leafId, 1);
  createDeliverable(tid, meta.output_ref, 'review report: all good\n');
  await expectOk('1 合法 subagent_spawn → ok',
    ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(meta)]);
}

// Case 2: subagent_spawn schema 非法
//   (a) subagent_id 父段≠leaf → 拒 E_SCHEMA_INVALID
//   (b) role 非枚举 → 拒 E_SCHEMA_INVALID
//   (c) output_ref 含 '..' → 拒 (path-safe, 应为 E_SCHEMA_INVALID 或 E_DELIVERABLE_MISSING — assertSafeExpectOutputs 走哪个)
async function case2_illegal_spawn_schema() {
  console.log('\n[2] subagent_spawn schema 非法 → 拒');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C2');

  // (a) subagent_id 父段≠本 leaf
  {
    const meta = spawnMeta(leafId, 1, { subagent_id: 'sub:someother-leaf:1' });
    createDeliverable(tid, meta.output_ref);
    // spec: subagent_id 父段≠leaf → 拒. 引擎 L1226 抛 E_SCHEMA_INVALID
    await expectFail('2a subagent_id 父段≠leaf → 拒',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(meta)],
      'E_SCHEMA_INVALID');
  }

  // (b) role 非枚举
  {
    const meta = spawnMeta(leafId, 2, { role: 'admin' });  // admin 不在 review|research|implement|audit
    createDeliverable(tid, meta.output_ref);
    await expectFail('2b role 非枚举 → 拒',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(meta)],
      'E_SCHEMA_INVALID');
  }

  // (c) output_ref 含 '..' (path traversal)
  //   assertSafeExpectOutputs 的错误码待确认 — 引擎里 expect_outputs 路径校验用 E_DELIVERABLE_MISSING (L1447),
  //   subagent_spawn 走同一 assertSafeExpectOutputs. 容忍 E_SCHEMA_INVALID 或 E_DELIVERABLE_MISSING.
  {
    const meta = spawnMeta(leafId, 3, { output_ref: '../escape.md' });
    const r = await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(meta)]);
    if (r.ok) {
      fail('2c output_ref 含 ".." → 拒', '命令成功了 (path-safe 未生效)');
    } else if (r.error && (r.error.code === 'E_SCHEMA_INVALID' || r.error.code === 'E_DELIVERABLE_MISSING')) {
      pass('2c output_ref 含 ".." → 拒', r.error.code);
    } else {
      fail('2c output_ref 含 ".." → 拒', `实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0,140)}`);
    }
  }
}

// Case 3: status=done output_ref 缺失 → E_DELIVERABLE_MISSING; 0 字节 → E_DELIVERABLE_EMPTY
async function case3_done_output_checks() {
  console.log('\n[3] status=done output_ref 缺失/空 → 拒 (BUG-3 闭环)');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C3');

  // (a) output_ref 文件不存在
  {
    const meta = spawnMeta(leafId, 1);  // 不落文件
    await expectFail('3a status=done output_ref 缺失 → E_DELIVERABLE_MISSING',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(meta)],
      'E_DELIVERABLE_MISSING');
  }

  // (b) output_ref 0 字节
  {
    const meta = spawnMeta(leafId, 2);
    createEmptyDeliverable(tid, meta.output_ref);
    await expectFail('3b status=done output_ref 0 字节 → E_DELIVERABLE_EMPTY',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(meta)],
      'E_DELIVERABLE_EMPTY');
  }
}

// Case 4: status=failed output_ref 可缺 → ok
async function case4_failed_no_output() {
  console.log('\n[4] status=failed output_ref 可缺 → ok');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C4');
  const meta = spawnMeta(leafId, 1, { status: 'failed' });
  delete meta.output_ref;  // A2 P0-1: 真正省略 output_ref（spawnMeta 默认带，须显式删才测到"failed 可省"）
  await expectOk('4 status=failed output_ref 缺 → ok',
    ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(meta)]);
}

// Case 5: v0.18 worker role 禁 session 分支 (reviewer_kind=session 缺省)
//   历史 (v0.17): 旧式 review_round (只带 reviewer_session_id 真实 UUID, 无 reviewer_kind) → ok (缺省 session, 向后兼容)
//   v0.18 (2026-07-16): leaf.role==='worker' 用 session 分支 (reviewer_kind='session' 或缺省) → 抛 E_REVIEW_SESSION_FORBIDDEN.
//     worker 自审必走 subagent 分支 (reviewer_kind:subagent + reviewer_ref 溯源 subagent_spawn).
//     session 分支仅 commander/auditor 他审用. 堵 nanju05/v172t (GLM worker 用 session + 占位 UUID 蒙混).
//   构造保留 (session 分支 review_round), 期望改 E_REVIEW_SESSION_FORBIDDEN.
async function case5_session_reviewer_compat() {
  console.log('\n[5] v0.18 worker session 分支禁 → E_REVIEW_SESSION_FORBIDDEN');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C5');
  // 注入旧式 review_round event (session 分支: 无 reviewer_kind, 缺省 session)
  tamperLeaf(tid, leafId, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({
      type: 'review_round',
      ts: '2026-07-07T01:00:00Z',
      meta: {
        round_no: 1,
        reviewers: [{
          perspective: 'G1-correctness',
          // 无 reviewer_kind 字段 → 缺省 session → v0.18 worker 拦
          reviewer_session_id: UUID.rev1,  // 独立 reviewer, ≠owner≠added_by
          findings: [{ severity: 'green', item: 'logic', evidence: 'all paths verified correct' }],
        }],
        red_count: 0,
        converged: true,
      },
    });
  });
  // 验证 v0.18 worker session 分支被拦: 直接调纯函数更干净 (省去 done 门禁配套前置).
  if (typeof engine.validateReviewRoundSchema === 'function') {
    try {
      const leaf = JSON.parse(fs.readFileSync(path.join(SANDBOX, tid, 'tree-state.json'), 'utf8')).leaves[leafId];
      const meta = leaf.events[leaf.events.length - 1].meta;
      engine.validateReviewRoundSchema(meta, leaf, leafId);
      fail('5 worker session 分支 → 应拦 E_REVIEW_SESSION_FORBIDDEN', 'validateReviewRoundSchema 通过了 (v0.18 未生效?)');
    } catch (e) {
      const code = e && e.code;
      if (code === 'E_REVIEW_SESSION_FORBIDDEN') {
        pass('5 worker session 分支 → E_REVIEW_SESSION_FORBIDDEN (v0.18 禁)', code);
      } else {
        fail('5 worker session 分支 → 应拦 E_REVIEW_SESSION_FORBIDDEN',
          `抛 ${code || '?'}: ${(e && e.message || String(e)).slice(0, 160)}`);
      }
    }
  } else {
    // 降级: 走 done 门禁路径 (由 case5b 覆盖 done 门禁下的同一断言)
    skip_or_pass_fallback('5 [降级] validateReviewRoundSchema 未导出, 由 case5b done 门禁覆盖',
      'see case5b');
  }
}

// Case 5b: 完整 done 门禁验证 v0.18 worker session 分支被拦
//   历史 (v0.17): 配齐 worker done 前置 + review_required=true + 旧式 review_round (session 缺省) → done ok
//   v0.18 (2026-07-16): worker session 分支 → validateReviewRoundSchema 抛 E_REVIEW_SESSION_FORBIDDEN → done 拒.
//     worker 自审须走 subagent 分支 (见 case6/14a). session 分支仅 commander/auditor.
async function case5b_session_reviewer_full_done() {
  console.log('\n[5b] v0.18 worker session 分支 → done 门禁拒 E_REVIEW_SESSION_FORBIDDEN');
  // 先建 auditor-commander 互背书环 (audit_gate pass 可用)
  const tid = freshTreeId();
  await initTree(tid);
  const audLeaf = `${tid}-Aud-commander`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: audLeaf, session_id: UUID.auditor, parent: `${tid}-root`, path: 'Aud',
    role: 'commander', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })]);
  const ts = '2026-07-07T00:00:00Z';
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.status = 'done';
    l.events = [{ type: 'done', ts, meta: { self_check: [{ item: 'root', pass: true, evidence: 'init' }] } }];
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.auditor, ts };
  });
  tamperLeaf(tid, audLeaf, (l) => {
    l.status = 'done';
    l.events = [{ type: 'done', ts, meta: { self_check: [{ item: 'aud', pass: true, evidence: 'init' }] } }];
    l.audit_gate = { verdict: 'pass', auditor_session_id: UUID.root, ts };
  });
  // worker leaf
  const leafId = await addWorker(tid, 'C5b');
  // 配齐 done 前置
  createDeliverable(tid, 'c5b-out.md', 'c5b deliverable\n');
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'c5b', expect_outputs: ['c5b-out.md'] })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.auditor]);
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json',
    JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.auditor })]);
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json',
    JSON.stringify({ self_check: [{ item: 'work_done', pass: true, evidence: 'c5b done' }] })]);
  await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.auditor]);
  // 开启 review_required
  tamperLeaf(tid, leafId, (l) => {
    if (!l.audit_meta) l.audit_meta = {};
    l.audit_meta.review_required = true;
  });
  // 注入旧式 review_round (无 reviewer_kind, 缺省 session)
  tamperLeaf(tid, leafId, (l) => {
    l.events.push({
      type: 'review_round', ts: '2026-07-07T01:00:00Z',
      meta: {
        round_no: 1,
        reviewers: [{
          perspective: 'G1-correctness',
          reviewer_session_id: UUID.rev1,  // ≠owner(UUID.worker) ≠added_by(UUID.root)
          findings: [{ severity: 'green', item: 'logic', evidence: 'all paths verified correct here' }],
        }],
        red_count: 0, converged: true,
      },
    });
  });
  // done 应拒: v0.18 worker session 分支被拦, validateReviewRoundSchema 抛 E_REVIEW_SESSION_FORBIDDEN
  await expectFail('5b worker session 分支 → done 门禁拒 E_REVIEW_SESSION_FORBIDDEN (v0.18 禁)',
    ['leaf', 'set-status', tid, leafId, 'done'], 'E_REVIEW_SESSION_FORBIDDEN');
}

// Case 6: review_round reviewer_kind=subagent 溯源
//   (a) 先 append 合法 subagent_spawn, 再写 review_round(reviewer_kind=subagent, reviewer_ref=对应id) → ok
//   (b) 不先 append subagent_spawn → E_REVIEW_FORGERY
async function case6_subagent_reviewer_trace() {
  console.log('\n[6] reviewer_kind=subagent 溯源');
  // (a) 先 spawn 再 review → ok
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C6a');
    const sm = spawnMeta(leafId, 1);
    createDeliverable(tid, sm.output_ref, 'subagent review report\n');
    await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
    // review_round 通过 tamperLeaf 注入 (EVENT_TYPE_ENUM 含但 cmdEventAppend 可能拒), 用纯函数校验
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: sm.subagent_id,  // sub:<leafId>:1, 与 spawn 匹配
        findings: [{ severity: 'green', item: 'logic', evidence: 'subagent review verified correct' }],
      }],
      red_count: 0, converged: true,
    };
    const ok6a = await validateRRviaFunction(tid, leafId, rrMeta, '6a 先 spawn 再 reviewer_kind=subagent → ok');
    if (!ok6a) {
      // 降级走 done 门禁
      await validateRRviaDone(tid, leafId, rrMeta, '6a [降级 done 门禁] 先 spawn 再 reviewer_kind=subagent → 放行', UUID.auditor, true);
    }
  }

  // (b) 不先 spawn → E_REVIEW_FORGERY
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C6b');
    // 不 append subagent_spawn, 直接构造 review_round
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: `sub:${leafId}:1`,  // 格式合法但本 leaf 无对应 spawn
        findings: [{ severity: 'green', item: 'logic', evidence: 'forged subagent reviewer here' }],
      }],
      red_count: 0, converged: true,
    };
    const ok6b = await validateRRviaFunction(tid, leafId, rrMeta, '6b 无匹配 subagent_spawn → E_REVIEW_FORGERY', 'E_REVIEW_FORGERY');
    if (!ok6b) {
      // 降级: 直接断言纯函数抛 E_REVIEW_FORGERY (上面已处理)
    }
  }
}

// Case 7: reviewer_kind=subagent 同时给 reviewer_session_id → 拒 E_REVIEW_FORGERY
async function case7_subagent_mutex_session_id() {
  console.log('\n[7] reviewer_kind=subagent 同时给 reviewer_session_id → 拒');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C7');
  const sm = spawnMeta(leafId, 1);
  createDeliverable(tid, sm.output_ref, 'mutex test\n');
  await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
  const rrMeta = {
    round_no: 1,
    reviewers: [{
      perspective: 'G1-correctness',
      reviewer_kind: 'subagent',
      reviewer_ref: sm.subagent_id,
      reviewer_session_id: UUID.rev1,  // 互斥: 不应出现
      findings: [{ severity: 'green', item: 'logic', evidence: 'mutex violation test case here' }],
    }],
    red_count: 0, converged: true,
  };
  await validateRRviaFunction(tid, leafId, rrMeta, '7 reviewer_kind=subagent + reviewer_session_id → 拒', 'E_REVIEW_FORGERY');
}

// Case 8: reviewer_ref 父段≠本 leaf → 拒 E_REVIEW_FORGERY
async function case8_reviewer_ref_wrong_parent() {
  console.log('\n[8] reviewer_ref 父段≠本 leaf → 拒');
  const tid = freshTreeId();
  await initTree(tid);
  const leafId = await addWorker(tid, 'C8');
  // 在另一个 leaf 上 spawn (借用别 leaf SubAgent)
  const otherLeaf = `${tid}-Oth-worker`;
  await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: otherLeaf, session_id: UUID.other, parent: `${tid}-root`, path: 'Oth',
    role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic', added_by: UUID.root,
  })]);
  const sm = spawnMeta(otherLeaf, 1);
  createDeliverable(tid, sm.output_ref, 'other leaf spawn\n');
  await run(['event', 'append', tid, otherLeaf, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
  // 本 leaf 用 otherLeaf 的 subagent_id 做 reviewer_ref
  const rrMeta = {
    round_no: 1,
    reviewers: [{
      perspective: 'G1-correctness',
      reviewer_kind: 'subagent',
      reviewer_ref: sm.subagent_id,  // sub:otherLeaf:1, 父段≠本 leaf
      findings: [{ severity: 'green', item: 'logic', evidence: 'borrowed subagent reviewer case' }],
    }],
    red_count: 0, converged: true,
  };
  await validateRRviaFunction(tid, leafId, rrMeta, '8 reviewer_ref 父段≠本 leaf → 拒', 'E_REVIEW_FORGERY');
}

// Case 9: independence 非法值 → 拒; 合法 (self_delegated/independent) → ok
//   v0.18: worker role 禁 session 分支 → independence 测试改走 **subagent 分支**.
//   independence 校验 (L1541) 在 reviewer_kind 分支之后共用, 用 subagent 分支同样能测到.
//   构造模式参照 case6: 先 append subagent_spawn (落 output_ref 文件), 再 review_round 用
//   reviewer_kind:'subagent' + reviewer_ref=sm.subagent_id (去 reviewer_session_id), 加 independence 字段.
async function case9_independence() {
  console.log('\n[9] independence (subagent 分支) 非法值 → 拒; 合法 → ok');

  // (a) 非法值 → E_REVIEW_FORGERY (independence 校验 L1541 共用)
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C9a');
    const sm = spawnMeta(leafId, 1);
    createDeliverable(tid, sm.output_ref, 'c9a subagent review report\n');
    await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: sm.subagent_id,  // sub:<leafId>:1, 与 spawn 匹配
        findings: [{ severity: 'green', item: 'logic', evidence: 'independence illegal value test' }],
      }],
      red_count: 0, converged: true,
      independence: 'bogus',  // 非法
    };
    await validateRRviaFunction(tid, leafId, rrMeta, '9a independence 非法值 → 拒 (subagent 分支, L1541 共用)', 'E_REVIEW_FORGERY');
  }

  // (b) 合法 self_delegated → ok
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C9b');
    const sm = spawnMeta(leafId, 1);
    createDeliverable(tid, sm.output_ref, 'c9b subagent review report\n');
    await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: sm.subagent_id,
        findings: [{ severity: 'green', item: 'logic', evidence: 'independence self delegated ok' }],
      }],
      red_count: 0, converged: true,
      independence: 'self_delegated',
    };
    await validateRRviaFunction(tid, leafId, rrMeta, '9b independence=self_delegated → ok (subagent 分支)');
  }

  // (c) 合法 independent → ok
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C9c');
    const sm = spawnMeta(leafId, 1);
    createDeliverable(tid, sm.output_ref, 'c9c subagent review report\n');
    await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: sm.subagent_id,
        findings: [{ severity: 'green', item: 'logic', evidence: 'independence independent value ok' }],
      }],
      red_count: 0, converged: true,
      independence: 'independent',
    };
    await validateRRviaFunction(tid, leafId, rrMeta, '9c independence=independent → ok (subagent 分支)');
  }
}

// Case 10: BUG-3 闭环 — worker done, expect_outputs 文件存在但 0 字节 → set-status done 拒 (E_DELIVERABLE_EMPTY);
//          写非空 → 放行
async function case10_bug3_empty_deliverable() {
  console.log('\n[10] BUG-3 闭环: expect_outputs 0 字节 → done 拒; 非空 → 放行');
  // (a) 0 字节 → 拒 E_DELIVERABLE_EMPTY
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C10a');
    // 配齐其他 done 前置 (让 BUG-3 成为唯一拦点)
    await prepareWorkerDonePrereqsExceptDeliverableCheck(tid, leafId);
    // 落 0 字节产物
    createEmptyDeliverable(tid, 'bug3.md');
    await expectFail('10a expect_outputs 0 字节 → E_DELIVERABLE_EMPTY',
      ['leaf', 'set-status', tid, leafId, 'done'], 'E_DELIVERABLE_EMPTY');
  }
  // (b) 写非空 → 放行
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C10b');
    await prepareWorkerDonePrereqsExceptDeliverableCheck(tid, leafId);
    // 覆盖写非空 (同名 bug3.md)
    createDeliverable(tid, 'bug3.md', 'now non-empty\n');
    await expectOk('10b expect_outputs 非空 → done 放行',
      ['leaf', 'set-status', tid, leafId, 'done']);
  }
}

// Case 11: v0.18 worker session 分支禁 — BUG-1 "假 UUID 蒙混" 取舍已被覆盖
//   历史 (v0.17, BUG-1 设计取舍): reviewer_kind=session (或缺省) + 格式合法的"假" UUID
//     (≠owner, ≠added_by, 但实际无对应 Proma session / session 已死) → 引擎**故意放行**.
//     原因: SDK SubAgent 没有真 Proma session_id, 强 checkSessionAlive 会误杀合法用法.
//     兜底: worker 自审必须走 reviewer_kind:subagent (诚实路径, 溯源 subagent_spawn).
//   v0.18 (2026-07-16): leaf.role==='worker' 用 session 分支直接抛 E_REVIEW_SESSION_FORBIDDEN
//     (在 UUID 校验之前), v0.17 BUG-1 的"假 UUID 取舍放行"已不再适用 — worker 根本进不了 session 分支.
//     留此 case 锁定 v0.18 新行为: worker session 分支被硬拦, 不再取舍放行.
//   断言: (1) validateReviewRoundSchema 纯函数对 worker session+假 UUID 抛 E_REVIEW_SESSION_FORBIDDEN;
//         (2) 完整 done 门禁对 worker session+假 UUID review_round 拒 E_REVIEW_SESSION_FORBIDDEN.
async function case11_session_fake_uuid_accepted() {
  console.log('\n[11] v0.18 worker session 分支禁: 假 UUID 不再取舍放行 → E_REVIEW_SESSION_FORBIDDEN');
  // (a) 纯函数路径: validateReviewRoundSchema 对 worker session + 假 UUID 抛 E_REVIEW_SESSION_FORBIDDEN
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C11a');
    // 假 UUID: 格式合法 (匹配 UUID_RE), ≠ owner(UUID.worker), ≠ added_by(UUID.root).
    //   v0.18 worker session 分支在 UUID 校验之前就拦, 假 UUID 是否合法已无关紧要.
    const fakeReviewerUUID = UUID.rev1;
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        // 无 reviewer_kind → 缺省 session → v0.18 worker 拦
        reviewer_session_id: fakeReviewerUUID,
        findings: [{ severity: 'green', item: 'logic', evidence: 'session-kind fake-uuid path now blocked by v0.18' }],
      }],
      red_count: 0, converged: true,
    };
    const ok11a = await validateRRviaFunction(tid, leafId, rrMeta,
      '11a session+格式合法假UUID → validateReviewRoundSchema 拒 E_REVIEW_SESSION_FORBIDDEN (v0.18 覆盖 BUG-1 取舍)',
      'E_REVIEW_SESSION_FORBIDDEN');
    // 纯函数未导出时降级到 (b) 的 done 门禁路径覆盖该断言
    if (!ok11a) {
      skip_or_pass_fallback('11a [降级] validateReviewRoundSchema 未导出, 由 11b done 门禁覆盖',
        'see 11b');
    }
  }

  // (b) 完整 done 门禁: 配齐前置 + review_required=true + worker session+假UUID review_round → done 拒
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C11b');
    // 配齐 done 前置 (含非空 deliverable, 让 review 门禁成为关键变量之一)
    await prepareWorkerDonePrereqsExceptDeliverableCheck(tid, leafId);
    createDeliverable(tid, 'bug3.md', 'c11b non-empty deliverable\n');  // helper 用 bug3.md 作 expect_outputs
    // 开启 review_required (让 review_round schema 校验在 done 门禁触发)
    tamperLeaf(tid, leafId, (l) => {
      if (!l.audit_meta) l.audit_meta = {};
      l.audit_meta.review_required = true;
    });
    // 注入 session+假UUID review_round (无 reviewer_kind → 缺省 session)
    tamperLeaf(tid, leafId, (l) => {
      l.events.push({
        type: 'review_round', ts: '2026-07-07T03:00:00Z',
        meta: {
          round_no: 1,
          reviewers: [{
            perspective: 'G1-correctness',
            reviewer_session_id: UUID.rev1,  // 格式合法假 UUID, ≠owner≠added_by
            findings: [{ severity: 'green', item: 'logic', evidence: 'session-kind fake-uuid now blocked by v0.18 worker-session ban' }],
          }],
          red_count: 0, converged: true,
        },
      });
    });
    // done 应拒: v0.18 worker session 分支被拦, 假 UUID 不再蒙混 — BUG-1 取舍被覆盖
    await expectFail('11b worker session+假UUID → done 门禁拒 E_REVIEW_SESSION_FORBIDDEN (v0.18 覆盖 BUG-1 取舍)',
      ['leaf', 'set-status', tid, leafId, 'done'], 'E_REVIEW_SESSION_FORBIDDEN');
  }
}

// Case 12: startup_notice 字段在 tree_init 与 leaf_add 结果里 (2026-07-08 macp2 事故后新功能)
//   背景: tree_init / leaf_add 的返回结果新增 startup_notice 字段 (字符串, ⚠️ 任务启动须知,
//         含 SubAgent 调用红线 + 预算). 引擎 tree-engine.cjs L788 / L1049.
//   断言: tree_init result 与 leaf_add result 各含 startup_notice (非空字符串, 含 "Agent" 红线词 + "macp2").
async function case12_startup_notice() {
  console.log('\n[12] startup_notice 在 tree_init + leaf_add 结果里');
  const tid = freshTreeId();

  // (a) tree_init 返回含 startup_notice
  //   run() 返回 {ok, error, result: out}; out 即引擎返回对象.
  //   tree_init out 形如 {tree, startup_notice, root_leaf, tips}.
  const rInit = await initTree(tid);
  const noticeInit = rInit.ok ? rInit.result.startup_notice : null;
  if (!rInit.ok) {
    fail('12a tree_init → 含 startup_notice', `tree_init 失败 ${rInit.error && rInit.error.code}`);
  } else if (typeof noticeInit !== 'string' || noticeInit.length === 0) {
    fail('12a tree_init → 含 startup_notice (非空字符串)',
      `实际 type=${typeof noticeInit} val=${String(noticeInit).slice(0, 80)}`);
  } else if (!noticeInit.includes('Agent')) {
    fail('12a tree_init startup_notice 含 "Agent" 红线词',
      `实际内容前 120: ${noticeInit.slice(0, 120)}`);
  } else if (!noticeInit.includes('macp2')) {
    fail('12a tree_init startup_notice 含 "macp2" 事故标记',
      `实际内容前 120: ${noticeInit.slice(0, 120)}`);
  } else {
    pass('12a tree_init → result.startup_notice 非空字符串且含 Agent + macp2',
      `len=${noticeInit.length}`);
  }

  // (b) leaf_add 返回含 startup_notice
  const leafId = await addWorker(tid, 'C12');
  // addWorker 内部已 expectOk 但只看 ok; 这里要拿 result 再断 startup_notice.
  //   重新取最新 leaf_add 结果: addWorker 不返回 result, 这里复跑一次同 leaf 会 E_DUPLICATE_LEAF_ID,
  //   故改用直接调 run 跑一个独立 leaf 拿 result.
  const leafId2 = `${tid}-C12b-worker`;
  const rAdd = await run(['leaf', 'add', tid, '--json', JSON.stringify({
    leaf_id: leafId2, session_id: UUID.other, parent: `${tid}-root`,
    path: 'C12b', role: 'worker', model: 'claude-sonnet-4-6', channel: 'anthropic',
    added_by: UUID.root,
  })]);
  const noticeAdd = rAdd.ok ? rAdd.result.startup_notice : null;
  if (!rAdd.ok) {
    fail('12b leaf_add → 含 startup_notice', `leaf_add 失败 ${rAdd.error && rAdd.error.code}`);
  } else if (typeof noticeAdd !== 'string' || noticeAdd.length === 0) {
    fail('12b leaf_add → startup_notice 非空字符串',
      `实际 type=${typeof noticeAdd} val=${String(noticeAdd).slice(0, 80)}`);
  } else if (!noticeAdd.includes('Agent')) {
    fail('12b leaf_add startup_notice 含 "Agent" 红线词',
      `实际内容前 120: ${noticeAdd.slice(0, 120)}`);
  } else {
    pass('12b leaf_add → result.startup_notice 非空字符串且含 Agent',
      `len=${noticeAdd.length}`);
  }
}

// Case 13: max_subagent_spawn_per_leaf 预算护栏 (2026-07-08 macp2 事故后新功能)
//   背景: cmdEventAppend type=subagent_spawn 时, 若本 leaf 已有 subagent_spawn 事件数 ≥
//         state.audit_meta.max_subagent_spawn_per_leaf (默认 15, tree_init audit_meta 可覆盖),
//         抛 E_SUBAGENT_BUDGET_EXCEEDED. 引擎 L2014-2023.
//   设计取舍: 用小上限(2)验证护栏 (避免造 15 个文件). 默认 15 = 5 reviewer × 3 轮.
//   断言:
//     上限=2 时, spawn #1 ok, spawn #2 ok, spawn #3 → E_SUBAGENT_BUDGET_EXCEEDED.
async function case13_subagent_budget_guardrail() {
  console.log('\n[13] max_subagent_spawn_per_leaf 预算护栏 (上限=2)');
  const tid = freshTreeId();
  // 用 audit_meta 把上限调到 2 (轻量测, 不必造 15 个文件)
  await initTree(tid, { max_subagent_spawn_per_leaf: 2 });
  const leafId = await addWorker(tid, 'C13');

  // spawn #1 (序号 1) → ok
  {
    const m1 = spawnMeta(leafId, 1);
    createDeliverable(tid, m1.output_ref, 'c13 spawn #1 report\n');
    await expectOk('13a spawn #1 (上限=2) → ok',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(m1)]);
  }

  // spawn #2 (序号 2) → ok
  {
    const m2 = spawnMeta(leafId, 2);
    createDeliverable(tid, m2.output_ref, 'c13 spawn #2 report\n');
    await expectOk('13b spawn #2 (上限=2) → ok',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(m2)]);
  }

  // spawn #3 (序号 3) → E_SUBAGENT_BUDGET_EXCEEDED (已有 2 ≥ max 2)
  {
    const m3 = spawnMeta(leafId, 3);
    createDeliverable(tid, m3.output_ref, 'c13 spawn #3 report (should be rejected)\n');
    await expectFail('13c spawn #3 (已有 2 ≥ 上限 2) → E_SUBAGENT_BUDGET_EXCEEDED',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(m3)],
      'E_SUBAGENT_BUDGET_EXCEEDED');
  }
}

// Case 14: review_round 在 event_append 时即校验 (2026-07-08 macp3 复盘新行为)
//   背景: cmdEventAppend 现在对 type=review_round 当场调 validateReviewRoundSchema
//         (以前只在 done 门禁时才校验). 这样 malformed review_round 在 append 时就拒
//         E_REVIEW_FORGERY / E_SCHEMA_INVALID, 不会静默写入后卡 done.
//   关键: 全部走 event append 路径 (不是 tamperLeaf 注入, 也不直接调纯函数),
//         以验证"append 即校验"真的接到了 cmdEventAppend 这一层.
//   断言:
//     14a: append 合法 review_round → ok (合法的能过 append 校验)
//     14b: append malformed (reviewer_kind:subagent + 同时带 reviewer_session_id) → E_REVIEW_FORGERY
//     14c: append malformed (无 reviewer_kind + reviewer_session_id 非 UUID 乱串) → E_REVIEW_FORGERY 或 E_SCHEMA_INVALID (宽松匹配)
//     14d: append review_round reviewer_kind:subagent + reviewer_ref 无对应 subagent_spawn (没先 spawn) → E_REVIEW_FORGERY
async function case14_review_round_append_validation() {
  console.log('\n[14] review_round 在 event_append 时即校验 (macp3)');

  // 14a: 合法 review_round → ok
  //   前置: 先 append 合法 subagent_spawn (并落 output 文件), 让 reviewer_ref 溯源有据.
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C14a');
    const sm = spawnMeta(leafId, 1);
    createDeliverable(tid, sm.output_ref, 'c14a subagent review report\n');
    await expectOk('14a-pre append 合法 subagent_spawn → ok',
      ['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
    // 合法 review_round: reviewer_kind:subagent + reviewer_ref=对应 subagent_id +
    //   findings(severity green, evidence ≥10 chars) + red_count:0 + converged:true +
    //   independence:self_delegated
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: sm.subagent_id,  // sub:<leafId>:1, 与 spawn 匹配
        findings: [{ severity: 'green', item: 'logic', evidence: 'c14a subagent review verified' }],
      }],
      red_count: 0,
      converged: true,
      independence: 'self_delegated',
    };
    await expectOk('14a append 合法 review_round → ok (证明合法的能过 append 校验)',
      ['event', 'append', tid, leafId, '--type', 'review_round', '--json', JSON.stringify(rrMeta)]);
  }

  // 14b: malformed (reviewer_kind:subagent + 同时带 reviewer_session_id 互斥违例) → E_REVIEW_FORGERY
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C14b');
    const sm = spawnMeta(leafId, 1);
    createDeliverable(tid, sm.output_ref, 'c14b subagent spawn\n');
    await run(['event', 'append', tid, leafId, '--type', 'subagent_spawn', '--json', JSON.stringify(sm)]);
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: sm.subagent_id,
        reviewer_session_id: UUID.rev1,  // 互斥: reviewer_kind:subagent 禁带 reviewer_session_id
        findings: [{ severity: 'green', item: 'logic', evidence: 'c14b mutex violation here' }],
      }],
      red_count: 0,
      converged: true,
      independence: 'self_delegated',
    };
    await expectFail('14b append malformed (subagent + reviewer_session_id 互斥) → E_REVIEW_FORGERY (append 即拒)',
      ['event', 'append', tid, leafId, '--type', 'review_round', '--json', JSON.stringify(rrMeta)],
      'E_REVIEW_FORGERY');
  }

  // 14c: v0.18 worker session 分支 (无 reviewer_kind) → 在 malformed UUID 校验之前就拦.
  //   历史 (v0.17): 无 reviewer_kind + reviewer_session_id 非 UUID 乱串 → E_REVIEW_FORGERY 或 E_SCHEMA_INVALID (宽松匹配).
  //   v0.18 (2026-07-16): leaf.role==='worker' 用 session 分支, 在 UUID 校验 (L1466) 之前先抛
  //     E_REVIEW_SESSION_FORBIDDEN (L1463-1464). malformed UUID 永远走不到.
  //   断言: expectFail E_REVIEW_SESSION_FORBIDDEN.
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C14c');
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        // 无 reviewer_kind → 缺省 session → v0.18 worker 先拦, 走不到 UUID 校验
        reviewer_session_id: 'abc-not-uuid',  // 非 UUID 乱串 (v0.18 下无关紧要)
        findings: [{ severity: 'green', item: 'logic', evidence: 'c14c non-uuid junk session' }],
      }],
      red_count: 0,
      converged: true,
    };
    await expectFail('14c append worker session 分支 → E_REVIEW_SESSION_FORBIDDEN (v0.18 先于 malformed 校验)',
      ['event', 'append', tid, leafId, '--type', 'review_round', '--json', JSON.stringify(rrMeta)],
      'E_REVIEW_SESSION_FORBIDDEN');
  }

  // 14d: reviewer_kind:subagent + reviewer_ref 无对应 subagent_spawn (没先 spawn) → E_REVIEW_FORGERY
  {
    const tid = freshTreeId();
    await initTree(tid);
    const leafId = await addWorker(tid, 'C14d');
    // 不 append subagent_spawn, 直接 append review_round
    const rrMeta = {
      round_no: 1,
      reviewers: [{
        perspective: 'G1-correctness',
        reviewer_kind: 'subagent',
        reviewer_ref: `sub:${leafId}:1`,  // 格式合法但本 leaf 无对应 spawn
        findings: [{ severity: 'green', item: 'logic', evidence: 'c14d no spawn forged reviewer' }],
      }],
      red_count: 0,
      converged: true,
      independence: 'self_delegated',
    };
    await expectFail('14d append reviewer_kind:subagent 无对应 subagent_spawn → E_REVIEW_FORGERY (append 即拒, 溯源失败)',
      ['event', 'append', tid, leafId, '--type', 'review_round', '--json', JSON.stringify(rrMeta)],
      'E_REVIEW_FORGERY');
  }
}

// ============================================================
// 内部 helper: 配齐 done 前置 (除 deliverable size 校验外)
//   milestone(audit_pass) + brief_echo + done event + audit_gate pass
//   rootLeaf.events 非空 (闸门2)
//   leaf.audit_meta.review_required 不开 (跳过 review 门禁, 让 BUG-3 成为唯一拦点)
async function prepareWorkerDonePrereqsExceptDeliverableCheck(tid, leafId) {
  // rootLeaf.events 非空
  tamperLeaf(tid, `${tid}-root`, (l) => {
    l.events = [{ type: 'plan', ts: '2026-07-07T00:00:00Z', meta: { summary: 'root bootstrap bug3' } }];
  });
  // milestone (audit_pass by root, root 当 auditor 走闸门2)
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'bug3', expect_outputs: ['bug3.md'] })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', UUID.root]);
  // brief_echo
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json',
    JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: UUID.root })]);
  // done event (worker 自己)
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json',
    JSON.stringify({ self_check: [{ item: 'work_done', pass: true, evidence: 'bug3 test setup done' }] })]);
  // audit_gate pass by root
  await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', UUID.root]);
}

// validateRRviaFunction: 优先用导出的纯函数 engine.validateReviewRoundSchema 校验.
//   expectCode 省略 = 期望 ok; 给 = 期望抛该错误码.
//   返回 true 表示处理完成 (用了纯函数路径); false 表示纯函数未导出, 调用方走降级.
async function validateRRviaFunction(tid, leafId, rrMeta, name, expectCode) {
  if (typeof engine.validateReviewRoundSchema !== 'function') return false;
  // 把 rrMeta 注入 leaf.events (纯函数读 leaf.events 做 subagent_spawn 溯源)
  tamperLeaf(tid, leafId, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({ type: 'review_round', ts: '2026-07-07T02:00:00Z', meta: rrMeta });
  });
  const leaf = JSON.parse(fs.readFileSync(path.join(SANDBOX, tid, 'tree-state.json'), 'utf8')).leaves[leafId];
  try {
    engine.validateReviewRoundSchema(rrMeta, leaf, leafId);
    if (!expectCode) { pass(name, 'validateReviewRoundSchema ok'); return true; }
    fail(name, `期望抛 ${expectCode}, 但 validateReviewRoundSchema 通过了`);
    return true;
  } catch (e) {
    const code = e && e.code;
    if (expectCode) {
      if (code === expectCode) { pass(name, code); return true; }
      fail(name, `期望 ${expectCode}, 实际抛 ${code}: ${(e && e.message || String(e)).slice(0, 160)}`);
      return true;
    }
    fail(name, `期望通过, 实际抛 ${code}: ${(e && e.message || String(e)).slice(0, 160)}`);
    return true;
  }
}

// 降级: 走完整 done 门禁路径校验 review_round (纯函数未导出时用)
async function validateRRviaDone(tid, leafId, rrMeta, name, auditorSession, openReviewRequired) {
  // 配齐 done 前置 (除 review 门禁)
  createDeliverable(tid, 'rrd-out.md', 'rr done gate\n');
  await run(['milestone', 'add', tid, leafId, '--json', JSON.stringify({ id: 'M1', desc: 'rr', expect_outputs: ['rrd-out.md'] })]);
  await run(['milestone', 'set-result', tid, leafId, 'M1', '--audit-pass', 'true', '--audit-session-id', auditorSession]);
  await run(['event', 'append', tid, leafId, '--type', 'brief_echo', '--json',
    JSON.stringify({ ack: 'ok', alignment: '95%', auditor_session_id: auditorSession })]);
  await run(['event', 'append', tid, leafId, '--type', 'done', '--json',
    JSON.stringify({ self_check: [{ item: 'work_done', pass: true, evidence: 'rr done gate setup' }] })]);
  await run(['audit', 'gate', tid, leafId, '--verdict', 'pass', '--audit-session-id', auditorSession]);
  if (openReviewRequired) {
    tamperLeaf(tid, leafId, (l) => {
      if (!l.audit_meta) l.audit_meta = {};
      l.audit_meta.review_required = true;
    });
  }
  // 注入 review_round
  tamperLeaf(tid, leafId, (l) => {
    if (!Array.isArray(l.events)) l.events = [];
    l.events.push({ type: 'review_round', ts: '2026-07-07T02:00:00Z', meta: rrMeta });
  });
  await expectOk(name, ['leaf', 'set-status', tid, leafId, 'done']);
}

// skip 兼容 (case5 降级标注用, 不计数为 fail)
function skip_or_pass_fallback(name, info) {
  console.log(`  \x1b[33m-\x1b[0m ${name}  ${info || ''}`);
}

// ============================================================
// 主入口
// ============================================================
async function main() {
  console.log('============================================================');
  console.log('subagent-lifecycle-test — SubAgent 入树机制交叉验证');
  console.log('被测引擎: ' + ENGINE_PATH);
  console.log('沙箱: ' + SANDBOX);
  console.log('============================================================');

  const cases = [
    { n: 1,  fn: case1_legal_spawn },
    { n: 2,  fn: case2_illegal_spawn_schema },
    { n: 3,  fn: case3_done_output_checks },
    { n: 4,  fn: case4_failed_no_output },
    { n: 5,  fn: case5_session_reviewer_compat },
    { n: '5b', fn: case5b_session_reviewer_full_done },
    { n: 6,  fn: case6_subagent_reviewer_trace },
    { n: 7,  fn: case7_subagent_mutex_session_id },
    { n: 8,  fn: case8_reviewer_ref_wrong_parent },
    { n: 9,  fn: case9_independence },
    { n: 10, fn: case10_bug3_empty_deliverable },
    { n: 11, fn: case11_session_fake_uuid_accepted },
    { n: 12, fn: case12_startup_notice },
    { n: 13, fn: case13_subagent_budget_guardrail },
    { n: 14, fn: case14_review_round_append_validation },
  ];

  const filter = process.argv.slice(2).filter((a) => !/^--/.test(a));

  try {
    for (const c of cases) {
      if (filter.length > 0 && !filter.includes(String(c.n))) continue;
      try {
        await c.fn();
      } catch (e) {
        fail(`case ${c.n} 异常`, `${e && e.code ? e.code + ': ' : ''}${(e && e.message || String(e)).slice(0, 200)}`);
      }
    }
  } finally {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m`);
  console.log('------------------------------------------------------------');
  if (stats.failed > 0) {
    console.log('\n失败用例:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.info || ''}`);
    });
  }
  process.exit(stats.failed > 0 ? 1 : 0);
}

main();
