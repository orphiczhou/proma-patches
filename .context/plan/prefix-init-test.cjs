#!/usr/bin/env node
/**
 * prefix-init-test.cjs — cmdInit root_brief.prefix 前置校验验收测试 (2026-07-15)
 *
 * 被测改动 (tree-engine.cjs cmdInit, v0.7 批次6):
 *   root_brief 解析后、writeState 前, 加 PREFIX_RE = /^[a-z][a-z0-9_]{3,7}$/ 校验.
 *   root_brief.prefix 字段存在且不匹配 → E_NAME_INVALID (前置拦截).
 *   字段不存在 → 跳过 (兼容现有合法 tree —— root_brief 不强制含 prefix).
 *
 * 核心目标 (防 nanju04api 事故重演):
 *   nanju04api 10 字符超长 prefix 潜伏到 leaf_add (L963) 才 E_NAME_INVALID,
 *   worker 已靠 create_session+send 产了文件但 leaf 没入树. 前置到 init 即拦.
 *
 * 引擎调用约定 (参考 iss003-review-gate-test.cjs):
 *   - engine.run(cmd, args, treesRoot?, callerSessionId?) 永不 throw,
 *     返回 {ok:true,...} | {ok:false,error:{code,msg}}
 *   - 测试前 engine.setTreesRoot(SANDBOX); engine.setSessionVerifier(mock)
 *
 * 测试场景 (6):
 *   1. 合法 prefix 4 字符 "test" → init ok
 *   2. 合法 prefix 8 字符 (上限) "testabcd" → init ok
 *   3. 超长 prefix "nanju04api" (10 字符, nanju04api 事故重演) → E_NAME_INVALID
 *   4. 大写 prefix "Test" → E_NAME_INVALID
 *   5. 连字符 prefix "te-st" → E_NAME_INVALID
 *   6. root_brief 无 prefix 字段 (兼容性, 现有测试模式) → init ok
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- 引擎 require (权威源) ----
const ENGINE_PATH = 'D:/codes/tree-harness/tree-engine.cjs';
const engine = require(ENGINE_PATH);

// ---- 临时沙箱 ----
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-init-'));

// ---- mock session verifier (占位 UUID 放行, 沿用 iss003 模式) ----
engine.setSessionVerifier((sid) => {
  if (typeof sid === 'string' && /^00000000-0000-0000-0000-[0-9]{12}$/.test(sid)) return true;
  return false;
});

const UUID_ROOT = '00000000-0000-0000-0000-000000000001';

// ---- run helper ----
async function run(cmdArgs) {
  const out = await engine.run(cmdArgs[0], cmdArgs.slice(1));
  return { ok: !!out.ok, error: out.error || null, result: out };
}

// ---- 断言 ----
const stats = { passed: 0, failed: 0, skipped: 0 };
const results = [];
function pass(name, info) { stats.passed++; results.push({ name, status: 'PASS', info }); console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; results.push({ name, status: 'FAIL', info }); console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }
function skip(name, info) { stats.skipped++; results.push({ name, status: 'SKIP', info }); console.log(`  \x1b[33m-\x1b[0m ${name}  ${info || ''}`); }

async function expectFail(name, cmdArgs, expectedCode) {
  const r = await run(cmdArgs);
  if (r.ok) { fail(name, `期望失败 ${expectedCode}, 但命令成功了`); return r; }
  if (r.error && r.error.code === expectedCode) { pass(name, expectedCode); return r; }
  fail(name, `期望 ${expectedCode}, 实际 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
  return r;
}
async function expectOk(name, cmdArgs) {
  const r = await run(cmdArgs);
  if (r.ok) { pass(name, 'ok'); return r; }
  fail(name, `期望成功, 实际失败 ${r.error ? r.error.code : '?'}: ${(r.error && r.error.msg || '').slice(0, 140)}`);
  return r;
}

// ---- tree_id 计数器 (符合 leaf_id prefix 正则) ----
let counter = 0;
function freshTreeId() {
  counter++;
  return `trev${counter}`;  // 4 字符 prefix, 合法
}

// ---- 通用 init 参数构造 ----
function initArgs(tid, briefObj) {
  return ['init', tid,
    '--root-brief', JSON.stringify(briefObj),
    '--root-dod', JSON.stringify({ deliverables: [], node_budget: 20, max_depth: 3 }),
    '--session-id', UUID_ROOT, '--model', 'claude-sonnet-4-6', '--channel', 'anthropic',
  ];
}

// ---- 测试场景 ----

// 场景 1: 合法 prefix 4 字符 "test" → init ok
async function case1() {
  console.log('\n场景 1: 合法 prefix 4 字符 "test" → 期望 init ok');
  const tid = freshTreeId();
  await expectOk('合法 prefix "test" (4 字符)', initArgs(tid, { parent_intent: 'case1', prefix: 'test' }));
}

// 场景 2: 合法 prefix 8 字符 (上限) → init ok
async function case2() {
  console.log('\n场景 2: 合法 prefix 8 字符 (上限) "testabcd" → 期望 init ok');
  const tid = freshTreeId();
  await expectOk('合法 prefix "testabcd" (8 字符上限)', initArgs(tid, { parent_intent: 'case2', prefix: 'testabcd' }));
}

// 场景 3: 超长 prefix "nanju04api" (10 字符) → E_NAME_INVALID (nanju04api 事故重演)
async function case3() {
  console.log('\n场景 3: 超长 prefix "nanju04api" (10 字符, nanju04api 事故) → 期望 E_NAME_INVALID');
  const tid = freshTreeId();
  await expectFail('超长 prefix "nanju04api" 被前置拦截',
    initArgs(tid, { parent_intent: 'case3', prefix: 'nanju04api' }), 'E_NAME_INVALID');
}

// 场景 4: 大写 prefix "Test" → E_NAME_INVALID
async function case4() {
  console.log('\n场景 4: 大写 prefix "Test" → 期望 E_NAME_INVALID');
  const tid = freshTreeId();
  await expectFail('大写 prefix "Test" 被拦截',
    initArgs(tid, { parent_intent: 'case4', prefix: 'Test' }), 'E_NAME_INVALID');
}

// 场景 5: 连字符 prefix "te-st" → E_NAME_INVALID
async function case5() {
  console.log('\n场景 5: 连字符 prefix "te-st" → 期望 E_NAME_INVALID');
  const tid = freshTreeId();
  await expectFail('连字符 prefix "te-st" 被拦截',
    initArgs(tid, { parent_intent: 'case5', prefix: 'te-st' }), 'E_NAME_INVALID');
}

// 场景 6: root_brief 无 prefix 字段 (兼容性, 现有测试模式) → init ok
async function case6() {
  console.log('\n场景 6: root_brief 无 prefix 字段 (兼容性) → 期望 init ok');
  const tid = freshTreeId();
  await expectOk('root_brief 无 prefix 字段 (兼容现有测试)',
    initArgs(tid, { parent_intent: 'case6 no prefix' }));
}

// ---- 主入口 ----
(async function main() {
  console.log('============================================================');
  console.log('prefix-init-test — cmdInit root_brief.prefix 前置校验验收测试');
  console.log('被测引擎: ' + ENGINE_PATH);
  console.log('沙箱: ' + SANDBOX);
  console.log('============================================================');

  engine.setTreesRoot(SANDBOX);

  const filter = process.argv.slice(2).filter((a) => !/^--/.test(a));
  const cases = [
    { n: 1, fn: case1 }, { n: 2, fn: case2 }, { n: 3, fn: case3 },
    { n: 4, fn: case4 }, { n: 5, fn: case5 }, { n: 6, fn: case6 },
  ];

  try {
    for (const c of cases) {
      if (filter.length > 0 && !filter.includes(String(c.n))) continue;
      try {
        await c.fn();
      } catch (e) {
        fail(`场景 ${c.n} 异常`, `${e && e.code ? e.code + ': ' : ''}${(e && e.message || String(e)).slice(0, 200)}`);
      }
    }
  } finally {
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m / \x1b[33m跳过 ${stats.skipped}\x1b[0m`);
  console.log('------------------------------------------------------------');
  if (stats.failed > 0) {
    console.log('\n失败用例:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.info}`);
    });
  }
  process.exit(stats.failed > 0 ? 1 : 0);
})();
