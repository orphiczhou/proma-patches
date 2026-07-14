#!/usr/bin/env node
/**
 * sprint3-d3-silence-test.cjs — Sprint 3 Phase D / D3：TAO Watcher silence_minutes 测试 (2026-07-14)
 *
 * 被测改动 (proma-dev-patches.cjs, Sprint 3 D3):
 *   - loadTaoConfig: 默认加 silence_minutes=0 / silenced_until=null；旧 config 合并默认
 *   - decideWatcherSilence(cfg, nowMs): 纯函数，返回 {skip, remainingMs, reason}
 *   - runOnce: loadTaoConfig 后检 silence，未过期则本轮跳过（减噪/省成本），过期自动恢复
 *   - IPC proma:watcher-silence {minutes}: 设 silenced_until=now+minutes*60000（<=0 清除）
 *   - IPC proma:watcher-status 暴露 silence 决策；config-patch 白名单加 silence_minutes/silenced_until
 *
 * ⚠️ 测试局限（诚实声明）：patches.cjs 顶层有 electron 副作用（require 会 hang），无法直接 require
 *    整模块单测。故本文件 mirror decideWatcherSilence 纯逻辑 + silence 设置算术做契约测试。
 *    若未来 patches.cjs 导出 decideWatcherSilence（或抽到独立 require-safe 模块），应改 require 实测。
 *
 * 测试矩阵:
 *   1. 未静默（silenced_until=null）→ skip=false
 *   2. silenced_until 未来 → skip=true + remainingMs>0
 *   3. silenced_until 过去 → skip=false（自动恢复）
 *   4. silence 设置算术：minutes→silenced_until ≈ now+minutes*60000；<=0 清除
 *   5. loadTaoConfig 默认合并（旧 config 无 silence 字段 → 补默认）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PATCHES_PATH = 'D:/codes/tree-harness/proma-dev-patches.cjs';

// ---- mirror: decideWatcherSilence（与 patches.cjs 同名函数逻辑一致）----
//   维护时两处必须同步。reason 字符串仅用于日志，断言不依赖其精确文本。
function decideWatcherSilence(cfg, nowMs) {
  const until = cfg && typeof cfg.silenced_until === 'number' ? cfg.silenced_until : null;
  if (until == null) return { skip: false, remainingMs: 0, reason: 'not silenced' };
  if (nowMs >= until) return { skip: false, remainingMs: 0, reason: 'silence window expired' };
  return { skip: true, remainingMs: until - nowMs, reason: 'silenced until ' + new Date(until).toISOString() };
}

// ---- mirror: silence IPC 设置算术（proma:watcher-silence 核心逻辑）----
//   minutes<=0 → 清除；否则 silenced_until = now + clamp(minutes,1,7*1440)*60000
function applySilence(cfg, minutes, nowMs) {
  const out = Object.assign({}, cfg);
  if (minutes <= 0) {
    out.silence_minutes = 0;
    out.silenced_until = null;
  } else {
    const cap = Math.min(60 * 24 * 7, Math.max(1, Math.floor(minutes)));
    out.silence_minutes = cap;
    out.silenced_until = nowMs + cap * 60 * 1000;
  }
  return out;
}

// ---- mirror: loadTaoConfig 默认合并（D3 新增字段）----
function mergeDefaults(loaded) {
  return Object.assign({ silence_minutes: 0, silenced_until: null }, loaded || {});
}

const stats = { passed: 0, failed: 0 };
function pass(name, info) { stats.passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}  ${info || ''}`); }
function fail(name, info) { stats.failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}  ${info || ''}`); }

// 静态校验：patches.cjs 源码确实含 D3 改动（防止 mirror 与实际脱节）
function verifySource() {
  console.log('\n[Source] 静态校验 patches.cjs 含 D3 改动');
  const src = fs.readFileSync(PATCHES_PATH, 'utf8');
  const checks = [
    ['decideWatcherSilence 纯函数定义', /function decideWatcherSilence\s*\(/],
    ['loadTaoConfig 默认 silence_minutes', /silence_minutes:\s*0/],
    ['loadTaoConfig 默认 silenced_until', /silenced_until:\s*null/],
    ['runOnce 静默跳过分支', /_silence\.skip/],
    ['IPC proma:watcher-silence', /"proma:watcher-silence"/],
    ['status 暴露 silence', /silence:\s*decideWatcherSilence/],
    ['config-patch 白名单含 silence_minutes', /"silence_minutes"/],
    ['config-patch 白名单含 silenced_until', /"silenced_until"/],
  ];
  for (const [name, re] of checks) {
    if (re.test(src)) pass(name, ''); else fail(name, 'patches.cjs 缺该 D3 改动');
  }
}

// ============================================================
// 测试 1-3: decideWatcherSilence 决策矩阵
// ============================================================
function test_silence_decision() {
  console.log('\n[Test-1..3] decideWatcherSilence 决策矩阵');
  const now = 1700000000000;  // 固定锚点（注入 nowMs，不依赖 Date.now）
  // 1. 未静默
  let d = decideWatcherSilence({ silenced_until: null }, now);
  if (d.skip === false) pass('未静默 → skip=false', ''); else fail('未静默应 skip=false', JSON.stringify(d));
  // 2. 未来（+10min）
  d = decideWatcherSilence({ silenced_until: now + 10 * 60 * 1000 }, now);
  if (d.skip === true && d.remainingMs === 10 * 60 * 1000) pass('静默未来 → skip=true, remainingMs=10min', ''); else fail('静默未来', JSON.stringify(d));
  // 3. 过去（-1min）→ 自动恢复
  d = decideWatcherSilence({ silenced_until: now - 60 * 1000 }, now);
  if (d.skip === false) pass('静默过期 → skip=false（自动恢复）', ''); else fail('过期应 skip=false', JSON.stringify(d));
  // 边界：silenced_until === now（恰好到期）→ 不静默
  d = decideWatcherSilence({ silenced_until: now }, now);
  if (d.skip === false) pass('恰好到期 (until===now) → skip=false', ''); else fail('恰好到期应 skip=false', JSON.stringify(d));
  // 非法类型（字符串）→ 当 null 处理
  d = decideWatcherSilence({ silenced_until: 'oops' }, now);
  if (d.skip === false) pass('silenced_until 非数 → skip=false（容错）', ''); else fail('非数应 skip=false', JSON.stringify(d));
}

// ============================================================
// 测试 4: silence 设置算术（applySilence mirror IPC 核心）
// ============================================================
function test_apply_silence() {
  console.log('\n[Test-4] applySilence 设置算术（minutes → silenced_until）');
  const now = 1700000000000;
  // 30 分钟
  let cfg = applySilence({}, 30, now);
  if (cfg.silence_minutes === 30 && cfg.silenced_until === now + 30 * 60 * 1000) pass('30min → silenced_until=now+30min', ''); else fail('30min 设置', JSON.stringify(cfg));
  // 联动决策：设 30min 后立即判 → skip=true，remainingMs≈30min
  let d = decideWatcherSilence(cfg, now);
  if (d.skip === true && d.remainingMs === 30 * 60 * 1000) pass('设 30min 后决策 skip=true (联动)', ''); else fail('设后决策', JSON.stringify(d));
  // 设后过 31min → 过期恢复
  d = decideWatcherSilence(cfg, now + 31 * 60 * 1000);
  if (d.skip === false) pass('设 30min 后 +31min → 过期恢复', ''); else fail('应过期恢复', JSON.stringify(d));
  // <=0 清除
  cfg = applySilence({ silenced_until: now + 99999 }, 0, now);
  if (cfg.silence_minutes === 0 && cfg.silenced_until === null) pass('minutes=0 → 清除静默', ''); else fail('0 应清除', JSON.stringify(cfg));
  cfg = applySilence({ silenced_until: now + 99999 }, -5, now);
  if (cfg.silenced_until === null) pass('minutes=-5 → 清除静默', ''); else fail('负数应清除', JSON.stringify(cfg));
  // clamp 上限 7 天
  cfg = applySilence({}, 999999, now);
  if (cfg.silence_minutes === 60 * 24 * 7) pass('超大 minutes → clamp 7 天', ''); else fail('应 clamp 7 天', '实际 ' + cfg.silence_minutes);
}

// ============================================================
// 测试 5: loadTaoConfig 默认合并
// ============================================================
function test_config_default_merge() {
  console.log('\n[Test-5] loadTaoConfig 默认合并（旧 config 无 silence 字段 → 补默认）');
  // 旧 config（无 D3 字段）
  let cfg = mergeDefaults({ enabled: true, interval_seconds: 300 });
  if (cfg.silence_minutes === 0 && cfg.silenced_until === null) pass('旧 config 补 silence 默认', ''); else fail('旧 config 合并', JSON.stringify(cfg));
  if (cfg.enabled === true) pass('合并保留原字段 enabled=true', ''); else fail('合并不应丢原字段', JSON.stringify(cfg));
  // 新 config（已有 D3 字段）→ 不覆盖
  cfg = mergeDefaults({ silence_minutes: 60, silenced_until: 12345 });
  if (cfg.silence_minutes === 60 && cfg.silenced_until === 12345) pass('已有 silence 字段不被默认覆盖', ''); else fail('不应覆盖已有值', JSON.stringify(cfg));
}

(async () => {
  console.log('============================================================');
  console.log('Sprint 3 Phase D / D3 — TAO Watcher silence_minutes 测试');
  console.log('PATCHES_PATH =', PATCHES_PATH, '(patches.cjs 非 require-safe → 纯逻辑 mirror 契约测试)');
  console.log('============================================================');
  try {
    verifySource();
    test_silence_decision();
    test_apply_silence();
    test_config_default_merge();
  } catch (e) {
    console.log('\n[FATAL]', e && e.stack ? e.stack : e);
    stats.failed++;
  }
  console.log('\n------------------------------------------------------------');
  console.log(`结果: \x1b[32m通过 ${stats.passed}\x1b[0m / \x1b[31m失败 ${stats.failed}\x1b[0m`);
  console.log('------------------------------------------------------------');
  process.exit(stats.failed === 0 ? 0 : 1);
})();
