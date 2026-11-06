#!/usr/bin/env node
// PR 20261107-model-context: patch 1M context rules in deployed main.cjs
// Usage: node apply-model-context-patch.cjs <path-to-main.cjs>
// Idempotent: skips patterns already applied.
"use strict";
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("usage: node apply-model-context-patch.cjs <main.cjs path>");
  process.exit(2);
}
let src = fs.readFileSync(file, "utf8");

// [oldText, newText, label]
const edits = [
  [
    `"claude-opus-4-8",
        "claude-fable-5"
      ],`,
    `"claude-opus-4-8",
        "claude-opus-5",
        "claude-haiku-5",
        "claude-fable-5"
      ],`,
    "claude array += opus-5, haiku-5",
  ],
  [
    `deepseek: ["deepseek-v4"],`,
    `deepseek: ["deepseek-v4", "deepseek-flash"],`,
    "deepseek += deepseek-flash",
  ],
  [
    `glm: ["glm-5.2"],`,
    `glm: ["glm-5.2", "glm-5.3"],`,
    "glm += glm-5.3",
  ],
  [
    `mimo: ["mimo-v2.5"],`,
    `mimo: ["mimo-v2.5", "mimo-v2.6"],`,
    "mimo += mimo-v2.6",
  ],
  [
    `minimax: ["minimax-m3"],`,
    `minimax: ["minimax-m3", "m3.1"],`,
    "minimax += m3.1",
  ],
  [
    `kimi: ["k3"],`,
    `kimi: ["k3", "kimi-k3"],`,
    "kimi += kimi-k3",
  ],
  [
    `exclude: ["haiku"],`,
    `exclude: ["haiku-3", "haiku-4"],`,
    "exclude haiku -> haiku-3/haiku-4",
  ],
];

let applied = 0;
let skipped = 0;
for (const [oldText, newText, label] of edits) {
  if (src.includes(newText) && !src.includes(oldText)) {
    console.log(`SKIP  (already applied): ${label}`);
    skipped++;
    continue;
  }
  const count = src.split(oldText).length - 1;
  if (count !== 1) {
    console.error(`FAIL  ${label}: expected exactly 1 occurrence, found ${count}`);
    process.exit(1);
  }
  src = src.replace(oldText, newText);
  console.log(`APPLY ${label}`);
  applied++;
}

fs.writeFileSync(file, src);
console.log(`\nDone: ${applied} applied, ${skipped} skipped -> ${file}`);
