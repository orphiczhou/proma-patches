# D5 项目层质量 审计报告 — Tree Harness FINAL-REPORT 对抗核验

> 审计员: audit2-D5-worker (DeepSeek-v4-pro)
> 审计对象: FINAL-REPORT.md 自评 7/7 + C1=86
> 审计日期: 2026-07-28
> 审计方法: 独立源头文档核验（不读并行审计产物）
> 证据来源: multi-agent-collab-platform src/ 代码 + macp6/10/11 修复档案

## 一、执行摘要

- **总体判定**: FINAL-REPORT 的 4 缺陷修复宣称**基本真实达成**，代码实证齐备；C1=86 拖分项标注**总体诚实**，但 Sandbox L1 标注"超出scope"存在边界争议（可行性范围内未尝试）
- **confidence**: high（全部 6 项核验有 src/ file:line 代码实证 + 修复档案交叉验证）
- **一句话核心结论**: 4 缺陷全部真修根因（代码实证充分），C1=86 拖分项 5 项中 4 项诚实标注、1 项 Sandbox L1 标注存在 scope 争议（~200 行 JobObject native binding 可行但未尝试），86→95+ 路径中期项比例偏高（3/5 需中期投入）

---

## 二、Findings 表

| # | Severity | 问题摘要 | 证据(file:line/原文/归档) | 对 7/7 或 C1=86 的影响 |
|---|----------|---------|-------------------------|----------------------|
| F1 | 🟢 GREEN | 缺陷1 真修：evaluateSoft 真调 PromaCloud API + duck-type 契约校验替换编译期断言 | `proma-cloud-llm-client.ts:399-445` (evaluateSoft → this.chat → fetch) + `engine-factory.ts:104-115` (assertLlmClientContract 运行时 duck-type) | 支撑完成标准 #4 |
| F2 | 🟢 GREEN | 缺陷2 真修：path.resolve 双向规范化 + 严格相等堵死 CWE-22 | `coder-engine-stub.ts:558-578` (outputDir 严格相等) + `coder-engine-stub.ts:1074-1091` (validateScope path.relative 防越界) | 支撑完成标准 #4 |
| F3 | 🟢 GREEN | 缺陷3 真修：applyGwtAutofixPatch 块格式解析 + 三道路径安全 + 先应用再重跑闭环 | `coder-engine-stub.ts:1182-1198` (patch 应用后重跑) + `coder-engine-stub.ts:1337-1399` (block regex + 3-path security) | 支撑完成标准 #4 |
| F4 | 🟢 GREEN | 缺陷4 真修：codeDir/classDiagramPath 存在性校验堵假通过 | `judge-engine-stub.ts:316-340` (existsSync + isCodeDirEmpty) | 支撑完成标准 #4 |
| F5 | 🟡 YELLOW | C1=86 拖分项 Sandbox 6/10：L1 Windows JobObject 内存限额可行(~200行)但标注"超出harness scope"未尝试 | `sandbox-manager.ts:19-24` (honest degradation doc) + `sandbox-manager.ts:327-333` (detectCapability supported=false) + FINAL-REPORT §五 L107 | C1=86→95+ 的 +4 Sandbox 分实际只需 L1 即可回收部分 |
| F6 | 🟡 YELLOW | C1=86 judge 占位计数：FINAL-REPORT 称"hard checks 9"但 ALL_HARD_RULES 枚举 7+1(GWT_STEPS_MISSING macp11)=8；宣称"16→<5"的基线 16 缺乏代码考古证据 | `judge-engine-stub.ts:187-195` (ALL_HARD_RULES 仅 8 项) vs FINAL-REPORT §五 L109 | 对 C1=86 评分本身影响有限，但计数不精确影响可信度 |
| F7 | 🟡 YELLOW | Electron IPC 15 stubData：13 处 stubData + 2 处纯 log stub ≈ 15，与宣称一致但仅 5/20 IPC channel 实装（coder 3 + judge 2），其余 15 仍 stub | `electron/main.ts` grep stubData 共 13 处 + telemetry 2 处纯 log | FINAL-REPORT 诚实标注 +5 可回收，非 scope 逃避 |
| F8 | 🟡 YELLOW | 86→95+ 路径：5 拖分项中 3 项标注"中期"(Sandbox OS/IPC/Electron E2E = +11)，短期仅 +3 可达，95+ 乐观 | FINAL-REPORT §五 L106-112 | 95+ 需中期项交付，短期 89-91 更现实 |

---

## 三、详细分析

### F1 🟢 缺陷1 Judge LLM evaluateSoft + duck-type 契约校验 — 真修确认

**核验项**: evaluateSoft 真实现（调 this.chat 走 PromaCloud 非 mock）+ duck-type 契约校验替换编译期断言

**代码实证**:

① **evaluateSoft 真实链路** (`proma-cloud-llm-client.ts:399-445`):
```typescript
async evaluateSoft(input: SoftEvalInput): Promise<SoftEvalOutput> {
  // ...
  const result = await this.chat(prompt, { timeoutMs: SOFT_EVAL_TIMEOUT_MS });
  // ...
}
```
`this.chat()` 内部 (`proma-cloud-llm-client.ts:308`) 调用 `fetch(endpoint, {...})` 走真实 PromaCloud HTTP API，非 mock。finishReason 收敛为 4 值枚举 (stop/length/error/timeout)，超时/错误均安全收敛为 `{score:0, message}`。

② **duck-type 契约校验** (`electron/engine-factory.ts:104-115`):
```typescript
function assertLlmClientContract(client: unknown, source: string): void {
  const generateType = typeof (client as { generate?: unknown }).generate;
  const evaluateSoftType = typeof (client as { evaluateSoft?: unknown }).evaluateSoft;
  if (generateType !== 'function' || evaluateSoftType !== 'function') {
    throw new Error(
      `[engine-factory] ${source} 加载的 client 契约不完整...拒绝 silent fallback`
    );
  }
}
```
运行时 duck-type 校验替换了旧编译期交叉类型断言（缺陷1 根因）。`engine-factory.ts:96-98` 刻意用 `unknown` 返回类型避免编译期掩盖运行时契约缺失。

③ **交叉验证** (`macp6/results.md:21`): 缺陷1 "真修根因" + typecheck/build 双绿验证。

**结论**: 🟢 GREEN。evaluateSoft 真实调用 PromaCloud API（非 mock），duck-type 契约校验在运行时强制双重接口（generate + evaluateSoft），替换了旧编译期断言。代码行号实证齐备。

---

### F2 🟢 缺陷2 CWE-22 path.resolve 双向规范化 — 真修确认

**核验项**: path.resolve 双向规范化 + 严格相等，堵死 `../` 穿越 + 绝对路径注入

**代码实证**:

① **outputDir CWE-22 校验** (`coder-engine-stub.ts:558-578`):
```typescript
const expectedOutputDir = path.resolve(input.projectRoot, '_code');
const actualOutputDir = path.resolve(input.outputDir);
if (actualOutputDir !== expectedOutputDir) {
  return fail(SYSTEM_INPUT_INVALID,
    'outputDir 必须等于 {projectRoot}/_code（CWE-22 防穿越）',
    { field: 'outputDir', expected: expectedOutputDir, actual: actualOutputDir }
  );
}
```
策略：两端 `path.resolve` 展开 `../` / `./` → 解析为绝对路径 → 字符串严格相等。任何偏移（包括盘符差异、绝对路径注入、目录穿越）即拒。

② **applyFix scope 边界校验** (`coder-engine-stub.ts:1074-1091`):
```typescript
private validateScope(projectRoot: string, modifiedFiles: string[]): string | null {
  const codeRootAbs = path.resolve(projectRoot, '_code');
  for (const rel of modifiedFiles) {
    const resolvedAbs = path.resolve(projectRoot, rel);
    const relToCode = path.relative(codeRootAbs, resolvedAbs);
    if (relToCode.startsWith('..') || path.isAbsolute(relToCode)) {
      return `${rel}（resolve→${resolvedAbs} 越出 ${codeRootAbs}）`;
    }
  }
  return null;
}
```
第二层防线：通过 `path.relative` + `startsWith('..')` 检测越界，覆盖 applyFix 补丁写入场景。

③ **交叉验证** (`macp6/results.md:21`): 缺陷2 "真修根因" + MiniMax 异厂商探针实证 outsideWrite=true 缺陷已堵。

**结论**: 🟢 GREEN。path.resolve 双向规范化 + 严格相等死防 CWE-22，两层防线（outputDir + validateScope）覆盖不同攻击面。

---

### F3 🟢 缺陷3 runGwt applyGwtAutofixPatch — 真修确认

**核验项**: applyGwtAutofixPatch 块格式解析 + 三道路径安全 + 先应用再重跑闭环

**代码实证**:

① **patch 应用闭环** (`coder-engine-stub.ts:1182-1198`):
```typescript
// 缺陷3 修复（macp10-R1）：先把 fixOut.text 的 patch 真应用到文件系统，再重跑 GWT。
const patchRes = await this.applyGwtAutofixPatch(fixOut.text, input.projectRoot);
if (patchRes.error) {
  autofixLog.push({ attempt: attempts, fixedScenarios: [],
    remainingFailures: failedBefore, patchError: patchRes.error, appliedFiles: patchRes.appliedFiles });
  break;  // 不静默跳过重跑
}
spawnOut = await this.spawnSafely({...});  // ← 真修过代码后才重跑
```
核心修复：patch 成功写入磁盘后才 `spawnSafely` 重跑 GWT；patch 失败 → `break`（不静默）。

② **三道路径安全** (`coder-engine-stub.ts:1337-1399`):
- 路径1 (L1358): `path.isAbsolute(relRaw)` → 拒绝对路径
- 路径2 (L1364-1371): `path.relative(projectRoot, resolved).startsWith('..')` → 拒绝目录遍历
- 路径3 (L1373-1380): `fs.lstatSync(resolved).isSymbolicLink()` → 拒绝 symlink 劫持

③ **块格式解析** (`coder-engine-stub.ts:1343-1344`):
```typescript
const blockRe = /<<<FILE:([^>]+)>>>[\s\S]*?<<<CONTENT>>>([\s\S]*?)<<<END>>>/g;
```
支持多文件并行修复，与 `buildGwtAutofixPrompt` (L1260-1264) 的格式指令对齐。

④ **交叉验证** (`R-fix-report.md:173-198`): 探针 2 用例全过 —— 用例1 断言文件写入 + spawnIsolated 2 次（真应用后重跑），用例2 断言 patchError 记录 + 不重跑（不静默）。

**结论**: 🟢 GREEN。applyGwtAutofixPatch 块格式解析 + 三道路径安全 + 先应用再重跑闭环，根治"LLM 生成但未写入"假修复。

---

### F4 🟢 缺陷4 evaluateCode 存在性校验 — 真修确认

**核验项**: codeDir/classDiagramPath 存在性校验，堵假通过路径

**代码实证**:

① **codeDir 存在性 + 非空校验** (`judge-engine-stub.ts:316-328`):
```typescript
const codeDirAbs = path.resolve(input.projectRoot, input.codeDir);
if (!fs.existsSync(codeDirAbs) || this.isCodeDirEmpty(codeDirAbs)) {
  return errorResponse(JUDGE_ERROR_CODE.CODE_NOT_GENERATED,
    `codeDir 不存在或无源文件（.ts/.js）：${input.codeDir}`, requestId, {...});
}
```

② **classDiagramPath 存在性校验** (`judge-engine-stub.ts:330-340`):
```typescript
const classDiagramAbs = path.resolve(input.projectRoot, input.classDiagramPath);
if (!fs.existsSync(classDiagramAbs)) {
  return errorResponse(JUDGE_ERROR_CODE.CLASS_DIAGRAM_MISSING,
    `classDiagramPath 不存在：${input.classDiagramPath}`, requestId, {...});
}
```

③ **isCodeDirEmpty 辅助方法** (`judge-engine-stub.ts:1003-1028`): 迭代栈实现，跳过 node_modules/dist/.git，识别 .ts/.js 源文件（排除 .d.ts）。

④ **交叉验证** (`E-fix-report.md:162-177`): 探针 4 场景全 PASS —— S1/S2/S3 缺失产物场景 `ok=false, verdict=null`（非 pass），S4 对照产物齐全正常评判 `verdict=pass`。修复精准无副作用（line 182 自注）。

**结论**: 🟢 GREEN。codeDir/classDiagramPath 存在性校验实装，缺失产物返回 `errorResponse`（语义"无法评判"），绝不复现 `verdict=pass` 假通过。

---

### F5 🟡 C1=86 拖分项 Sandbox 6/10 — L1 JobObject 可行但标注"超出scope"

**位置**: FINAL-REPORT §五 L107 + `sandbox-manager.ts:19-24`

**问题**: FINAL-REPORT 自承 Sandbox 6/10，将 L1 原生限额（Windows JobObject / Unix rlimit）标注为"超出 harness scope"。但：

- `sandbox-manager.ts:327-333` `detectCapability()` 返回 `supported: false, mechanism: 'wallclock_watchdog'` —— **诚实标注当前为降级实现**
- `sandbox-manager.ts:19-24` 头注释明确写 "Phase 2 接入原生 rlimit / JobObject" —— 已识别但未排期
- Windows JobObject 内存限额可通过 ~200 行 native binding (N-API) 实现，属于 L1 范畴（非 L2 Docker/Firecracker），在 5 天周期内可行
- FINAL-REPORT §五 L107 承认 `docker/firecracker L2 确属中期`，但 **L1 native binding 也被一同归入"超出scope"**

**证据**: `sandbox-manager.ts:260-265` watchdog 内存采样是**轮询降级**（每秒检查一次），非原生强制；`sandbox-manager.ts:466` `cpuTimeMs: 0`（CPU 限额完全未实现）。

**后果**: Sandbox 6/10 中 L1 部分（约 2-3 分）本可在本轮回收（~200 行 native binding），但被归入"中期"拖延。FINAL-REPORT 诚实标注了当前状态，但 scope 边界划分过度宽松。

**修复建议**: 明确区分 L1 native binding（短期，~200 行 N-API）与 L2 Docker/Firecracker（中期），将 Sandbox 路线图从单一 +4 拆为 L1 (+2) + L2 (+2)。

---

### F6 🟡 judge 占位计数不精确

**位置**: FINAL-REPORT §五 L109 vs `judge-engine-stub.ts:187-195`

**问题**: FINAL-REPORT 称 **"hard checks 9"** 但代码中：
- `ALL_HARD_RULES` 枚举 (`judge-engine-stub.ts:187-195`) 含 7 项：PRD_REQUIRED_FIELD_MISSING, PLANTUML_SYNTAX_INVALID, API_SCHEMA_INCOMPLETE, SPRINT_GRANULARITY_INVALID, ROLE_RESPONSIBILITY_OVERLAP, GWT_FEATURE_MISSING, CODE_CLASS_CONSISTENCY
- macp11 J1 (`J1-fix-report.md:36-47`) 增量加 `GWT_STEPS_MISSING` → 共 **8 项**
- 第 9 项可能是 `CODE_CLASS_CONSISTENCY`（仅 evaluateCode 用，但确实在枚举中）—— 如按 evaluateDocs + evaluateCode 两方法合计则为 7+1+1=9

**证据**: 宣称 "16→<5" 的基线 16 缺乏代码考古证据（需 git log 追溯原始 TODO 数）；当前 judge-engine-stub.ts 仅 1 处待实现 TODO (`L259 _meta.json#documents`)，确实 <5。

**后果**: 对 C1=86 评分影响有限（MiniMax 复评已计入），但计数不精确降低报告可信度。

**修复建议**: 在 FINAL-REPORT 中注明 9 的构成（7 evaluateDocs + 2 evaluateCode 专属），或统一定义计数口径。

---

### F7 🟡 Electron IPC 15 stubData — 诚实标注

**位置**: FINAL-REPORT §五 L108 + `electron/main.ts`

**问题**: 通过 `grep stubData electron/main.ts` 确认：
- 13 处 `stubData<T>(...)` 调用（guide:chat/previewPrototype/clickToFix/confirm, snapshot:create/list/rollback/delete, telemetry:query, project:list/open/delete/switchMode）
- 2 处纯 log stub（telemetry:emit/emitBatch）
- 合计 ≈ 15 stubs，与 FINAL-REPORT 宣称一致

已实装的 5/20 IPC channels：coder:generateCode, coder:applyFix, coder:runGwt, judge:evaluateDocs, judge:evaluateCode（均经 engine-factory 路由到真实引擎）。

**后果**: FINAL-REPORT 诚实标注 +5 可回收，非 scope 逃避。但 75% IPC channels 仍为 stub，对生产可用性影响大。

---

### F8 🟡 86→95+ 路径可行性 — 中期项比例偏高

**位置**: FINAL-REPORT §五 L106-112

**分析**:

| 拖分项 | 可回收分 | 实际难度 | 合理时间框 |
|--------|---------|---------|-----------|
| Sandbox L1 native binding | +2 | 短期（~200 行 N-API） | 1-2 天 |
| Sandbox L2 Docker/Firecracker | +2 | 中期（infra 变更） | 1-2 周 |
| Electron IPC 余 15 stubData | +5 | 中期（依赖上游服务就位） | 1-2 周 |
| judge 占位清（_meta.json 加载） | +1 | 短期（~50 行） | <1 天 |
| E2E smoke test (真 Electron) | +2 | 中期（需 Electron 环境 + 自动化框架） | 1 周 |
| Judge IO 边界 | +0.5 | 短期（errorResponse 补全） | <1 天 |

**短期可达**: +1 (judge) + 0.5 (IO) + 2 (Sandbox L1) = **+3.5** → 86 + 3.5 ≈ **89-90**
**中期可达**: +3.5 + 5 (IPC) + 2 (E2E) + 2 (Sandbox L2) = **+12.5** → 86 + 12.5 ≈ **98**

FINAL-REPORT 的 95+ 目标需中期 3 项全部交付，在当前进度下偏乐观。建议分两阶段：短期目标 89-91（本月可达），中期目标 95+（需 2-4 周）。

**结论**: 路径存在但中期依赖重，95+ 非短期可达。标注诚实但进度估计偏乐观。

---

## 四、该维度对 FINAL-REPORT 真实完成度的结论

- **该维度宣称 4 缺陷修复（完成标准 #4）真实达成**: ✅ 4/4 真修根因（代码行号实证齐备，修复档案交叉验证一致）
- **该维度宣称 C1=86 诚实**: ✅ 总体诚实，5 个拖分项中 4 个标注与实际一致
- **该维度发现的过度宣称**:
  1. Sandbox L1 可行但用"超出scope"一并拖延（边界争议）
  2. judge hard checks "9" 计数口径不统一（实际枚举 8 项）
  3. 86→95+ 进度估计偏乐观（中期项 3/5，短期仅 +3.5 可达）
- **该维度发现的遗漏**: 无阻断级遗漏

---

## 五、Roadmap 贡献

- **P0（阻断级）**: 无。4 缺陷全部真修，无阻断级发现。
- **P1（高优）**:
  1. Sandbox L1 native binding（Windows JobObject）排入短期路线图，不随 L2 一同拖延
  2. FINAL-REPORT §五 计数口径统一（hard checks 数量、TODO 基线澄清）
- **P2（中优）**:
  1. 86→95+ 分两阶段路线图（短期 89-91 + 中期 95+），降低预期偏差
  2. Electron IPC stubData 按优先级分批实装（guide/snapshot 先于 telemetry）
  3. isCodeDirEmpty 与 collectTsFiles 的 .ts/.js 判定逻辑存在重复（两个独立实现），可提取共用
