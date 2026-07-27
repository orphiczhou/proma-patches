# R-fix-report — 缺陷3 runGwt autofix 假修复（macp10-R1-worker）

> 里程碑：M1（修缺陷3 代码 + 探针 + typecheck/build 双绿）
> 作者：macp10-R1-worker（GLM-5.2）
> 日期：2026-07-27
> 状态：完成，待 audit_gate

---

## 1. 缺陷3 根因

**位置**：`src/coder/coder-engine-stub.ts` `runGwtWithAutofix`（原 L1171-1188）

**原实现**（缺陷代码）：
```ts
const fixOut = await this.llm.generate({
  role: 'fullstack-dev',
  prompt: this.buildGwtAutofixPrompt(input, parsed, spawnOut),
  projectRoot: input.projectRoot,
  maxTokens: 4096,
});
// LLM 修复彻底失败 → 终止循环
if (fixOut.finishReason === 'error' || fixOut.text.trim().length === 0) {
  break;
}
// ⚠️ 缺陷：fixOut.text 生成后，下面直接重跑 GWT，从未把 fixOut.text 应用到文件系统！
spawnOut = await this.spawnSafely({ ... 'cucumber-js' ... });
parsed = this.parseTestReport(spawnOut);
```

**根因链**：
1. `fixOut.text`（LLM 生成的修复文本）拿到后，**没有任何代码把它写入磁盘**。
2. 紧接着 `spawnSafely` 重跑 GWT，此时**被测代码与上一轮完全相同**。
3. 于是 `failedBefore === failedAfter`，`fixedScenarios = failedBefore.filter(f => !failedAfter.includes(f))` **恒为空数组**。
4. `autofixLog` 每轮记录 `fixedScenarios: []`，循环耗尽 `AUTOFIX_MAX_ATTEMPTS = 3`（L160）仍失败 → `exhausted = true` → 返回 `AUTOFIX_EXHAUSTED` 错误信封。
5. 用户侧表现：autofix "跑了 3 轮" 但每轮零修复 = **假修复**，生产阻塞级。

**macp6 实证**：该缺陷是 C1 复评中 Coder 业务逻辑 -2 分的拖分项，不修 C1 无法 85+。

---

## 2. patch 格式约定（块格式）

为让 `fixOut.text` 可被确定性解析并落盘，约定 LLM 输出**块格式**（简单、可正则解析、支持多文件）：

```
<<<FILE:path/relative/to/projectRoot.ts>>>
<<<CONTENT>>>
<该文件的完整新内容，首行紧接 CONTENT 标记下一行>
<<<END>>>
```

**规则**：
- 单次输出可含**多个** `<<<FILE>>>` 块（多文件并行修复）。
- `path` 必须**相对 `projectRoot`**；禁绝对路径、禁 `..` 目录遍历、禁 symlink。
- `<<<CONTENT>>>` 标记**下一行**起到 `<<<END>>>` **前一行**止为文件完整内容；解析时去掉 CONTENT 标记后紧跟的首个换行（`\r?\n`），保留文件原本的尾部换行。
- 只输出 patch 块，不要额外解释或 markdown 围栏。

该格式通过 `buildGwtAutofixPrompt` 末尾的输出指令告知 LLM（见 §5）。

---

## 3. applyGwtAutofixPatch 实现

**位置**：`src/coder/coder-engine-stub.ts` 文件系统辅助方法区（`safeReadFile` 之后，`buildAutofixPrompt` 之前）

**签名**：
```ts
private async applyGwtAutofixPatch(
  patchText: string,
  projectRoot: string,
): Promise<{ appliedFiles: string[]; error?: string }>
```

**实现要点**：
- **块正则**：`/<<<FILE:([^>]+)>>>[\s\S]*?<<<CONTENT>>>([\s\S]*?)<<<END>>>/g`，非贪婪匹配每个块；`exec` 循环提取 `(path, content)`。
- **content 规整**：`match[2].replace(/^\r?\n/, '')` 去掉 CONTENT 标记行换行，保留文件正文。
- **路径安全**（三道防线）：
  1. `path.isAbsolute(relRaw)` → 拒（绝对路径）
  2. `path.relative(projectRoot, resolved).startsWith('..')` 或结果仍绝对 → 拒（越界遍历）
  3. `fs.lstatSync(resolved).isSymbolicLink()` → 拒（symlink 劫持）
- **写入**：`fsp.mkdir(dirname, { recursive: true })` 确保父目录 + `fsp.writeFile(resolved, content, 'utf8')`；`appliedFiles` 收集 posix 风格相对路径（`\\` → `/`）。
- **错误返回**：任一块失败立即返回 `{ appliedFiles, error: '<原因>' }`（块号 + 理由）；**零块匹配**返回 `error: 'patch 未匹配任何 <<<FILE>>><<<CONTENT>>><<<END>>> 块'`。
- **复用**：`existsPath`（L1278）/ `fsp`（L34 import）/ `path`（L32）/ `fs`（L33），无新增依赖。

**返回契约**：`error` 非空 ⇒ 调用方（`runGwtWithAutofix`）须记 `patchError` + `break`，**不静默跳过重跑**。

---

## 4. runGwtWithAutofix 主循环改造

**位置**：`src/coder/coder-engine-stub.ts` `runGwtWithAutofix` while 循环内（原 L1178-1188 之间插入）

**改造后**（核心 diff）：
```ts
// LLM 修复彻底失败 → 终止循环
if (fixOut.finishReason === 'error' || fixOut.text.trim().length === 0) {
  break;
}

// 缺陷3 修复（macp10-R1）：先把 fixOut.text 的 patch 真应用到文件系统，再重跑 GWT。
// 治既往空转：原实现直接重跑，代码未变 → failedBefore==failedAfter → 假修复。
// 非空 patch 解析/应用异常 → 记 patchError + break（不静默跳过重跑）。
const patchRes = await this.applyGwtAutofixPatch(fixOut.text, input.projectRoot);
if (patchRes.error) {
  autofixLog.push({
    attempt: attempts,
    fixedScenarios: [],
    remainingFailures: failedBefore,
    patchError: patchRes.error,
  });
  break;
}

spawnOut = await this.spawnSafely({ ... 'cucumber-js' ... });  // ← 现在是「真修过代码后」的重跑
parsed = this.parseTestReport(spawnOut);
```

**关键不变量**：
- `spawnSafely`（重跑 GWT）**严格在** `applyGwtAutofixPatch` 成功（`error` 为空）之后；patch 未应用绝不重跑。
- patch 应用失败 → `autofixLog` 记 `patchError` + `fixedScenarios: []` + `remainingFailures: failedBefore`（如实反映「未修复」）+ `break`；调用方/审计可从 `autofixLog[i].patchError` 追溯每轮失败原因。

---

## 5. buildGwtAutofixPrompt 格式指令

**位置**：`src/coder/coder-engine-stub.ts` `buildGwtAutofixPrompt`（原 L1230-1241 return 数组末尾追加）

追加的指令行：
```ts
'',
'输出格式（必须严格遵守，否则修复不会被应用）：',
'用如下块格式给出每个需修改文件的完整新内容（可多文件多块）：',
'<<<FILE:path/relative/to/projectRoot.ts>>>',
'<<<CONTENT>>>',
'<该文件的完整新内容，首行紧接 CONTENT 标记下一行>',
'<<<END>>>',
'约束：path 必须相对 projectRoot（禁绝对路径 / 禁 .. 遍历）；只输出 patch 块，不要额外解释或 markdown 围栏。',
```

效果：LLM 收到的 prompt 末尾明确约定输出 schema，与 `applyGwtAutofixPatch` 的解析契约对齐。

---

## 6. AutofixLogEntry 类型扩展

**位置**：`src/coder/types.ts` L138-142

```ts
export interface AutofixLogEntry {
  attempt: number;
  fixedScenarios: string[];
  remainingFailures: string[];
  /** 非空 patch 解析/应用异常原因（缺陷3 修复 macp10-R1）。
   *  存在则该轮 fixOut.text 非空但 patch 未成功应用 → 未重跑 GWT 即 break（不静默）。 */
  patchError?: string;
}
```

`patchError` 为可选字段，向后兼容（既有调用方无需改动）；api-spec §2.4 输出 Schema 的 `autofixLog` 透传该字段。

---

## 7. 探针验证（patch 真应用）

**测试文件**：`06_TESTS/unit-coder-gwt-autofix.test.ts`（范式对齐 `unit-llm-mock.test.ts`，DI 注入 mock LlmClient + fake sandbox/snapshot）

**用例 1 — 有效 patch 真应用 + 重跑**：
- mock `llm.generate` 返回固定 patch：`<<<FILE:src/steps/doc-steps.ts>>>\n<<<CONTENT>>>\nexport const fixed = true;\n<<<END>>>`
- fake `spawnIsolated`：第 0 次返回 `exitCode=1, stdout='FAIL doc-compliance-scenario'`（触发 autofix），第 1 次返回 `exitCode=0, stdout='PASS ...'`
- 触发 `engine.runGwt({ enableAutofix: true, featurePaths: ['06_TESTS/features/doc-compliance.feature'], ... })`

**断言结果（全过）**：
| 断言 | 结果 | 证据 |
|---|---|---|
| patch 真写入磁盘 | ✅ | `fs.readFileSync(root/src/steps/doc-steps.ts) === 'export const fixed = true;\n'` |
| spawnSafely 重跑发生 | ✅ | `spawnIsolated` 被调 **2 次**（初始 fail + patch 应用后重跑 pass） |
| mock generate 被调 | ✅ | 1 次（进入循环，重跑后 failed=0 即 break） |
| allPassed | ✅ | `res.data.allPassed === true`（失败 scenario 被真修掉，非假修复） |
| autofixLog 无 patchError | ✅ | 每项 `patchError === undefined` |

**用例 2 — 非法 patch → patchError + 不重跑（不静默）**：
- mock `llm.generate` 返回非空但无块文本：`'建议把 step 改成异步加载，但未按约定给 patch 块。'`

**断言结果（全过）**：
| 断言 | 结果 | 证据 |
|---|---|---|
| 不重跑 | ✅ | `spawnIsolated` 仅被调 **1 次**（初始 fail；patch 应用失败 → break） |
| autofixLog 记 patchError | ✅ | `log[0].patchError` 为 >10 字符的非空字符串 |
| 不二次重试 | ✅ | `mockGenerate` 被调 1 次（patch 失败即 break） |

**运行结果**：
```
✓ 06_TESTS/unit-coder-gwt-autofix.test.ts (2 tests) 49ms
Test Files  1 passed (1)
     Tests  2 passed (2)
TEST_EXIT 0
```

**结论**：缺陷3「fixOut.text 生成但从未写入」已根治；patch 真应用后才重跑，patch 失败被显式记录而非静默。

---

## 8. typecheck / build 双绿证据

| 命令 | exit | 说明 |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.build.json` | **0** ✅ | 项目真正的 typecheck 配置（include 仅 `electron/preload/common/judge/coder`） |
| `npm run build`（= `tsc -p tsconfig.build.json`） | **0** ✅ | 编译产出 dist |
| `npx vitest run unit-coder-gwt-autofix` | **0** ✅ | 探针 2 passed |

### ⚠️ must_report：dod 字面命令 `npx tsc --noEmit` 与项目实际配置偏差

dod `quality_gates.script` 写的是 `npx tsc --noEmit && npm run build`。实测：

- `npx tsc --noEmit`（用默认 `tsconfig.json`）→ **exit 2**，**430 个错误，全部位于 `src/renderer/`**（7 个 `.ts/.tsx` 文件）。
- 错误类型：`TS7026`（JSX.IntrinsicElements 不存在）、`TS2875`（`react/jsx-runtime` 找不到）、`TS7031`/`TS7006`（隐式 any）—— 均为 **renderer JSX 类型环境预先存在的问题**。
- **关键**：`coder-engine-stub.ts` 与 `types.ts` 在默认配置下 **零错误**（`grep -E "coder-engine-stub|coder/types" /tmp/tsc_default.log` 返回空）→ 本次修改未引入任何新错误。
- 项目实际 typecheck/build 用 `tsconfig.build.json`，其 `include` 不含 `src/renderer/**`（renderer 不参与 build），故 `npm run build` exit 0。

**处置**：本次按项目实际配置（`tsconfig.build.json`）验证双绿，主体修改干净；dod 字面命令的 renderer 报错属预先存在环境问题，建议后续单独修 renderer JSX 配置（不在 macp10-R1 in_scope 内，已列入 out_of_scope 边界）。

---

## 9. 改动文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/coder/types.ts` | 修改 | `AutofixLogEntry` 加 `patchError?: string` 可选字段 |
| `src/coder/coder-engine-stub.ts` | 新增方法 | `applyGwtAutofixPatch(patchText, projectRoot)` |
| `src/coder/coder-engine-stub.ts` | 修改 | `runGwtWithAutofix` 主循环插入 patch 应用 + patchError break 分支 |
| `src/coder/coder-engine-stub.ts` | 修改 | `buildGwtAutofixPrompt` 末尾追加 patch 格式输出指令 |
| `06_TESTS/unit-coder-gwt-autofix.test.ts` | 新增 | 探针测试（2 用例，验证 patch 真应用 + patchError 不静默） |

**未改动**（in_scope 边界确认）：`evaluateCode`（缺陷4，macp10-E-commander）、macp10 树结构、第三方依赖（零新增）。

---

## 10. self_check 对照（与 done event 一致）

| # | 检查项 | pass | 证据 |
|---|---|---|---|
| 1 | fixOut.text 经 applyGwtAutofixPatch 真应用 patch 后再重跑 GWT | true | coder-engine-stub.ts `runGwtWithAutofix` 主循环：`applyGwtAutofixPatch` 调用成功（`patchRes.error` 为空）后才 `spawnSafely` 重跑；探针用例 1 断言 `spawnIsolated` 调 2 次 + 文件写入 |
| 2 | 非空 patch 解析失败/应用异常 → autofixLog 记 patchError + break（不静默） | true | `if (patchRes.error) { autofixLog.push({...,patchError:patchRes.error}); break; }`；探针用例 2 断言 `log[0].patchError` 非空 + `spawnIsolated` 仅 1 次 |
| 3 | typecheck exit 0 | true | `tsc --noEmit -p tsconfig.build.json` exit 0；coder 相关文件零错误（默认 tsconfig 的 430 错全在 src/renderer，预先存在非本次引入） |
| 4 | build exit 0 | true | `npm run build`（= `tsc -p tsconfig.build.json`）exit 0，dist 产出 |
| 5 | 探针验证：monkey-patch llm.generate 返回固定 patch，断言文件写入 + 重跑发生 | true | `unit-coder-gwt-autofix.test.ts` 2 用例全过：文件内容精确匹配 + spawnIsolated 2 次（用例1）/ patchError + 1 次（用例2） |

---

## 附：决策记录（.note.md 等价）

- **patch 格式选块格式而非 unified diff**：块格式正则解析简单、确定性高，LLM 输出完整文件内容避免 diff 应用歧义；unified diff 需引入 diff 库或手写 hunk 应用器，超出"零新增依赖"边界。可逆（后续可换 diff，只需改 `applyGwtAutofixPatch` + prompt 指令）。
- **patch 应用失败 break 而非 continue**：patch 失败意味着 LLM 输出不符合契约，重跑 GWT 必然得到相同失败（浪费一次 spawn）；break + 记 patchError 让上层明确感知并可在审计中追溯，优于静默继续。
- **`patchError` 设为可选字段**：向后兼容既有 `autofixLog` 消费者（generateCode 链等），api-spec Schema 透传不破坏。
