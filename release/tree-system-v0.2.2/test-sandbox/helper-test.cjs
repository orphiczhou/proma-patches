#!/usr/bin/env node
/**
 * helper-test.cjs — V10-helper (D4) 配套测试
 *
 * 验证 3 层配套：
 *   H1: mcp__tree__tree_help('how_to_init') 返回非空 + 含建树关键词
 *   H2: mcp__tree__tree_help('unknown_topic') 返回可用 topic 列表
 *   H3: tree_init 返回值含 tips.next_steps（4 条）+ skill_reference
 *   H4: 触发 E_BORROWED_IDENTITY 错误，error 含 help_topic='self_audit_forbidden'
 *   H5: 触发 E_NAME_INVALID 错误，error 含 help_topic='naming_convention'
 *       （额外：触发 E_AUDITOR_NOT_DONE 等 V10 错误码 → help_topic='how_to_register_auditor'）
 *   H6: 13 个 topic 全部返回非空且互不相同
 *
 * 用法：node helper-test.cjs
 * 期望：6/6 通过
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SANDBOX = path.join(__dirname, 'core');

// ---- engine require ----
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

// ---- 统计 ----
const stats = { passed: 0, failed: 0 };
const failures = [];
function pass(name, info) {
  stats.passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`);
}
function fail(name, info) {
  stats.failed++;
  failures.push({ name, info });
  console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`);
}

// ---- 测试 runner：每个 case 用独立 tmp dir，互不干扰 ----
async function withSandbox(name, fn) {
  const tmpDir = path.join(require('os').tmpdir(), `helper-test-${name}-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    return await fn(tmpDir);
  } finally {
    // 清理（best effort）
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function run(treesRoot, cmdArgs, callerSessionId) {
  let out;
  if (callerSessionId) {
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1), treesRoot, callerSessionId);
  } else {
    out = await engine.run(cmdArgs[0], cmdArgs.slice(1), treesRoot);
  }
  return out;
}

// ---- 测试 UUID（合法 v4 风格占位符，V10-uuid-format-strict 接受非全 0/全 f）----
const UUID = {
  caller: '11111111-1111-4111-8111-111111111111',  // worker A 自己
  workerA: '11111111-1111-4111-8111-111111111111',
  workerB: '22222222-2222-4222-8222-222222222222',  // 另一个 leaf
  auditor: '33333333-3333-4333-8333-333333333333',
};

// ---- 测试用例 ----

// H1: help('how_to_init') 返回非空 + 含建树关键词
async function H1() {
  const r = await engine.run('help', ['how_to_init']);
  if (!r.ok) return fail('H1: help(how_to_init) ok', `error: ${r.error && r.error.code}`);
  if (!r.topic || r.topic !== 'how_to_init') return fail('H1: topic field', `got ${r.topic}`);
  if (!r.title) return fail('H1: title field', 'missing');
  if (!r.content || r.content.length < 100) return fail('H1: content non-empty', `len=${r.content && r.content.length}`);
  // 关键词：tree_id / root_brief / root_dod
  const keywords = ['tree_id', 'root_brief', 'root_dod'];
  const missing = keywords.filter((k) => r.content.indexOf(k) < 0);
  if (missing.length > 0) return fail('H1: keywords', `missing: ${missing.join(',')}`);
  if (!r.skill_reference) return fail('H1: skill_reference', 'missing');
  pass('H1: help(how_to_init) 返回非空 + 含建树关键词', `len=${r.content.length}, topic=${r.topic}`);
}

// H2: help('unknown_topic') 返回错误 + 含 Available 列表
async function H2() {
  const r = await engine.run('help', ['nonexistent_topic_xyz']);
  if (r.ok) return fail('H2: help(unknown) should fail', 'returned ok=true');
  if (!r.error) return fail('H2: error field', 'missing');
  if (r.error.code !== 'E_UNKNOWN') return fail('H2: error code', `got ${r.error.code}`);
  const msg = r.error.msg || '';
  if (msg.indexOf('Available') < 0) return fail('H2: msg has Available', `msg=${msg.slice(0, 100)}`);
  // 至少列出几个 topic
  const requiredTopics = ['how_to_init', 'how_to_register_auditor', 'full_guide'];
  const missingTopics = requiredTopics.filter((t) => msg.indexOf(t) < 0);
  if (missingTopics.length > 0) return fail('H2: lists topics', `missing: ${missingTopics.join(',')}`);
  pass('H2: help(unknown) 返回错误 + 含 Available topic 列表', `code=${r.error.code}`);
}

// H3: tree_init 返回值含 tips.next_steps（4 条）+ skill_reference
async function H3() {
  await withSandbox('H3', async (tmpDir) => {
    const r = await run(tmpDir, ['init', 'h3tree', '--root-brief', JSON.stringify({parent_intent: 'x'}), '--root-dod', JSON.stringify({deliverables: []})]);
    if (!r.ok) return fail('H3: init ok', `error: ${r.error && r.error.code}`);
    if (!r.tips) return fail('H3: tips field', 'missing');
    if (!Array.isArray(r.tips.next_steps)) return fail('H3: next_steps array', `got ${typeof r.tips.next_steps}`);
    if (r.tips.next_steps.length !== 4) return fail('H3: next_steps length=4', `got ${r.tips.next_steps.length}`);
    // 每条都提到 tree_help
    const allHaveHelp = r.tips.next_steps.every((s) => s.indexOf('tree_help') >= 0 || s.indexOf('mcp__tree__tree_help') >= 0);
    if (!allHaveHelp) return fail('H3: each next_step mentions tree_help', 'some lack mention');
    if (!r.tips.skill_reference) return fail('H3: skill_reference', 'missing');
    if (r.tips.skill_reference.indexOf('SKILL.md') < 0) return fail('H3: skill_reference path', `got ${r.tips.skill_reference}`);
    if (!r.tips.pro_tip) return fail('H3: pro_tip', 'missing');
    pass('H3: tree_init tips.next_steps（4条）+ skill_reference + pro_tip', `len=${r.tips.next_steps.length}`);
  });
}

// H4: 触发 E_BORROWED_IDENTITY → error.help_topic='self_audit_forbidden'
async function H4() {
  await withSandbox('H4', async (tmpDir) => {
    // init
    await run(tmpDir, ['init', 'h4tree', '--root-brief', JSON.stringify({parent_intent:'x'}), '--root-dod', JSON.stringify({deliverables:[]})]);
    // add worker A
    await run(tmpDir, ['leaf', 'add', 'h4tree', '--json', JSON.stringify({
      leaf_id: 'h4tree-A-worker', session_id: UUID.workerA,
      parent: 'h4tree-root', path: 'A', role: 'worker', model: 'm', channel: 'c',
      added_by: UUID.workerA,
    })]);
    // borrowed identity: caller=workerA, audit_session_id=workerB
    const r = await run(tmpDir,
      ['audit', 'gate', 'h4tree', 'h4tree-A-worker', '--verdict', 'pass', '--audit-session-id', UUID.workerB],
      UUID.workerA  // callerSessionId = worker A
    );
    if (r.ok) return fail('H4: should reject', 'audit_gate returned ok=true');
    if (r.error.code !== 'E_BORROWED_IDENTITY') return fail('H4: code E_BORROWED_IDENTITY', `got ${r.error.code}`);
    if (r.error.help_topic !== 'self_audit_forbidden') return fail('H4: help_topic', `got ${r.error.help_topic}`);
    if (!r.error.help_hint || r.error.help_hint.indexOf('self_audit_forbidden') < 0) return fail('H4: help_hint', `got ${r.error.help_hint}`);
    pass('H4: E_BORROWED_IDENTITY → help_topic=self_audit_forbidden', `code=${r.error.code}`);
  });
}

// H5: 触发 E_NAME_INVALID → help_topic='naming_convention'
//     额外：触发 E_INVALID_UUID_STRICT → help_topic='v10_constraints'
async function H5() {
  await withSandbox('H5', async (tmpDir) => {
    await run(tmpDir, ['init', 'h5tree', '--root-brief', JSON.stringify({parent_intent:'x'}), '--root-dod', JSON.stringify({deliverables:[]})]);

    // H5a: E_NAME_INVALID
    const r5a = await run(tmpDir, ['leaf', 'add', 'h5tree', '--json', JSON.stringify({
      leaf_id: 'invalid_name_no_prefix', session_id: UUID.workerA,
      parent: 'h5tree-root', path: 'A', role: 'worker', model: 'm', channel: 'c',
      added_by: UUID.workerA,
    })]);
    if (r5a.ok) return fail('H5a: name invalid should reject', 'returned ok');
    if (r5a.error.code !== 'E_NAME_INVALID') return fail('H5a: code E_NAME_INVALID', `got ${r5a.error.code}`);
    if (r5a.error.help_topic !== 'naming_convention') return fail('H5a: help_topic', `got ${r5a.error.help_topic}`);

    // H5b: E_INVALID_UUID_STRICT (milestone set-result with all-zero UUID)
    await run(tmpDir, ['leaf', 'add', 'h5tree', '--json', JSON.stringify({
      leaf_id: 'h5tree-A-worker', session_id: UUID.workerA,
      parent: 'h5tree-root', path: 'A', role: 'worker', model: 'm', channel: 'c',
      added_by: UUID.workerA,
    })]);
    await run(tmpDir, ['milestone', 'add', 'h5tree', 'h5tree-A-worker', '--json', JSON.stringify({
      id: 'M1', desc: 'x', expect_outputs: ['out.txt']
    })]);
    const r5b = await run(tmpDir, ['milestone', 'set-result', 'h5tree', 'h5tree-A-worker', 'M1', '--audit-pass', 'true', '--audit-session-id', '00000000-0000-0000-0000-000000000000']);
    if (r5b.ok) return fail('H5b: invalid uuid should reject', 'returned ok');
    if (r5b.error.code !== 'E_INVALID_UUID_STRICT') return fail('H5b: code E_INVALID_UUID_STRICT', `got ${r5b.error.code}`);
    if (r5b.error.help_topic !== 'v10_constraints') return fail('H5b: help_topic v10_constraints', `got ${r5b.error.help_topic}`);

    pass('H5: E_NAME_INVALID→naming_convention + E_INVALID_UUID_STRICT→v10_constraints', `codes: ${r5a.error.code}, ${r5b.error.code}`);
  });
}

// H6: 13 个 topic 全部返回非空且互不相同
async function H6() {
  const topics = [
    'how_to_init', 'how_to_register_auditor', 'role_semantics', 'v10_constraints',
    'self_audit_forbidden', 'borrowed_identity', 'naming_convention', 'common_mistakes',
    'alignment_workflow', 'nudge_escalation', 'audit_tree_structure', 'error_code_index',
    'full_guide',
  ];
  if (topics.length !== 13) return fail('H6: 13 topics', `got ${topics.length}`);
  const contents = {};
  const titles = {};
  for (const t of topics) {
    const r = await engine.run('help', [t]);
    if (!r.ok) return fail(`H6: help(${t}) ok`, `error: ${r.error && r.error.code}`);
    if (!r.content || r.content.length < 50) return fail(`H6: help(${t}) non-empty`, `len=${r.content && r.content.length}`);
    if (!r.title) return fail(`H6: help(${t}) title`, 'missing');
    contents[t] = r.content;
    titles[t] = r.title;
  }
  // 内容互不相同（取首 100 字符做指纹）
  const fingerprints = {};
  let collisions = 0;
  for (const t of topics) {
    const fp = contents[t].slice(0, 100);
    if (fingerprints[fp]) {
      collisions++;
      console.log(`    warn: ${t} collides with ${fingerprints[fp]} on first 100 chars`);
    }
    fingerprints[fp] = t;
  }
  if (collisions > 0) return fail('H6: topics unique', `${collisions} collisions`);
  // 长度差异检查（13 个互不相同应长度不全等）
  const lens = Object.values(contents).map((c) => c.length);
  const uniqueLens = new Set(lens).size;
  if (uniqueLens < 5) return fail('H6: topic lengths vary', `only ${uniqueLens} unique lengths`);
  pass('H6: 13 topic 全部返回非空且互不相同', `topics=${topics.length}, unique_lens=${uniqueLens}`);
}

// ---- 主 ----
(async () => {
  console.log('=== helper-test.cjs — V10-helper (D4) 配套测试 ===\n');
  console.log('-- H1: help(how_to_init) --');
  await H1();
  console.log('-- H2: help(unknown) --');
  await H2();
  console.log('-- H3: tree_init tips --');
  await H3();
  console.log('-- H4: borrowed identity help_topic --');
  await H4();
  console.log('-- H5: name invalid + uuid strict help_topic --');
  await H5();
  console.log('-- H6: 13 topics --');
  await H6();

  console.log('\n=== 统计 ===');
  console.log(`  通过: ${stats.passed}`);
  console.log(`  失败: ${stats.failed}`);
  if (failures.length > 0) {
    console.log('\n-- 失败详情 --');
    for (const f of failures) console.log(`  ${f.name}: ${f.info}`);
    process.exit(1);
  }
  console.log('\n\x1b[32m=== ALL PASS ===\x1b[0m');
})();
