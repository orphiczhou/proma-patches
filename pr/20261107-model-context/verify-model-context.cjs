#!/usr/bin/env node
// PR 20261107-model-context: verify inferred contextWindow against patched main.cjs
// Extracts the real context-window module from the deployed file and runs assertions.
"use strict";
const fs = require("fs");

const file = process.argv[2] || "/d/Proma-release/resources/app/dist/main.cjs".replace("/d/", "D:/");
const src = fs.readFileSync(file, "utf8");

// --- extract function block (matchesContextRule .. resolveAgentSdkModelId) ---
const fnStart = src.indexOf("function matchesContextRule(model, pattern) {");
const declMarker = "var DEFAULT_CONTEXT_WINDOW, ONE_MILLION_CONTEXT_WINDOW";
const declEnd = src.indexOf(";", src.indexOf("CONTEXT_WINDOW_CONFIG", src.indexOf(declMarker)));
if (fnStart < 0 || declMarker < 0 || declEnd < 0) {
  console.error("extract failed: function block not found");
  process.exit(1);
}
const fnBlock = src.slice(fnStart, declEnd + 1);

// --- extract module init body (assignments inside init_context_window) ---
const modStart = src.indexOf('"../../packages/shared/src/utils/context-window.ts"() {');
if (modStart < 0) {
  console.error("extract failed: init_context_window body not found");
  process.exit(1);
}
const bodyAnchor = src.indexOf('"use strict"', modStart);
const cfgAnchor = src.indexOf("CONTEXT_WINDOW_CONFIG = {", modStart);
if (bodyAnchor < 0 || cfgAnchor < 0) {
  console.error("extract failed: module body anchors not found");
  process.exit(1);
}
// brace-balance the CONTEXT_WINDOW_CONFIG object literal, include trailing ';'
const cfgBrace = src.indexOf("{", cfgAnchor);
let depth = 1, j = cfgBrace + 1;
while (depth > 0 && j < src.length) {
  const ch = src[j];
  if (ch === "{") depth++;
  else if (ch === "}") depth--;
  j++;
}
while (src[j] === " " || src[j] === "\n" || src[j] === "\r") j++;
if (src[j] === ";") j++;
const modBody = src.slice(bodyAnchor, j);

const RETURN = "return { matchesContextRule: matchesContextRule, supports1MContext: supports1MContext, inferContextWindow: inferContextWindow, inferAgentSdkContextWindow: inferAgentSdkContextWindow, resolveAgentSdkModelId: resolveAgentSdkModelId, RULES: AGENT_SDK_1M_CONTEXT_RULES, CONFIG: CONTEXT_WINDOW_CONFIG };";
const code = fnBlock + "\n(function(){ " + modBody + "\n " + RETURN + " })()";
const mod = eval(code);

// --- expectations: [modelId, provider|null, expectedWindow] ---
// provider=null -> test supports1MContext/inferContextWindow path only
const cases = [
  // new models (this patch)
  ["glm-5.3", "zhipu-coding", 1e6],
  ["glm-5.3-flash", "zhipu-coding", 1e6],
  ["GLM-5.3", "zhipu-coding", 1e6],
  ["glm-5.3-flashx", "zhipu-coding", 1e6],
  ["deepseek-flash", "deepseek", 1e6],
  ["claude-opus-5-5", "anthropic", 1e6],
  ["claude-haiku-5-5", "anthropic", 1e6],
  ["claude-sonnet-5-5", "anthropic", 1e6],
  ["claude-fable-5-1", "anthropic", 1e6],
  ["kimi-k3", "proma", 1e6],
  ["mimo-v2.6-pro", "xiaomi", 1e6],
  ["mimo-v2.6-flash", "xiaomi", 1e6],
  ["M3.1-Flash-Preview", "minimax", 1e6],
  // regressions: must stay 1M
  ["glm-5.2", "zhipu-coding", 1e6],
  ["deepseek-v4-pro", "deepseek", 1e6],
  ["deepseek-v4.1-flash-expires-on-0910", "deepseek", 1e6],
  ["minimax-m3", "minimax", 1e6],
  ["mimo-v2.5", "xiaomi", 1e6],
  ["claude-sonnet-4-6", "anthropic", 1e6],
  ["k3", "kimi-coding", 1e6],
  // negative controls: must stay 200K
  ["glm-5.1", "zhipu-coding", 2e5],
  ["glm-5-turbo", "zhipu-coding", 2e5],
  ["MiniMax-M2.7-highspeed", "minimax", 2e5],
  ["claude-haiku-4-5", "anthropic", 2e5],
  ["glm-4.6", "zhipu-coding", 2e5],
];

let pass = 0, fail = 0;
for (const [id, provider, expected] of cases) {
  const got = provider
    ? mod.inferAgentSdkContextWindow(id, provider)
    : mod.inferContextWindow(id);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id} (${provider}): expected ${expected}, got ${got}`);
}

// [1m] suffix behavior for Agent SDK path (display sanity)
const suffixChecks = [
  ["glm-5.3-flash", "zhipu-coding"],
  ["deepseek-flash", "deepseek"],
];
for (const [id, provider] of suffixChecks) {
  const resolved = mod.resolveAgentSdkModelId(id, provider);
  console.log(`INFO  resolveAgentSdkModelId(${id}, ${provider}) -> ${resolved}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
