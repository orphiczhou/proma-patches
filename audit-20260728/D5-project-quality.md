# D5 项目层质量审计报告

> **审计员**: audit-D5-commander (DeepSeek-V4)
> **审计对象**: multi-agent-collab-platform 测试底座（`D:/Codes/multi-agent-collab-platform/`）
> **审计范围**: 4 缺陷修复深度 + C1=86 拖分项真实性 + Sandbox 6/10 根因 + 86→95+ 路径
> **审计日期**: 2026-07-28
> **审计方法**: 独立源码审查 + 逐方法代码证据核验 + 修复档案交叉验证（不信 worker 自证）

---

## 一、执行摘要

**总体结论: 4 缺陷全部真修（深度修复），C1=86 评分诚实保守，Sandbox 6/10 "超出 scope"有部分合理性但非完全诚实。**

| 审计维度 | 结论 | 严重度 |
|----------|------|--------|
| 缺陷1 Judge LLM 接线 | ✅ 深度修复 — evaluateSoft 真 LLM 调用 + duck-type 契约校验替换编译期交叉断言 | 🟢 green |
| 缺陷2 Coder CWE-22 | ✅ 深度修复 — path.resolve 双向规范化 + 严格相等比对，堵死 ../ 穿越/绝对路径注入 | 🟢 green |
| 缺陷3 runGwt autofix | ✅ 深度修复 — 新增 applyGwtAutofixPatch（块格式解析+三道路径安全）+ 先应用再重跑的闭环 | 🟢 green |
| 缺陷4 evaluateCode | ✅ 深度修复 — codeDir/classDiagramPath 存在性校验堵死假通过路径，5/5 探针全 PASS | 🟢 green |
| macp11 G1 featuresMissingSteps | ✅ 深度修复 — 阈值分级（>50% reject / ≤50% soft / 0 不违例），17/17 探针全 PASS | 🟢 green |
| Sandbox 6/10 | ⚠️ "超出 scope"部分成立 — Docker/Firecracker 确属中期平台演进，但 Windows JobObject L1 内存限额 WAS 可实现（~200 行 native binding），未尝试 | 🟡 yellow |
| C1=86 评分诚实性 | ✅ 独立审计确认评分保守诚实 — 端到端只计 +4 非 +6，yellow 清理不重复加分，5 拖分项诚实列出 | 🟢 green |
| 剩余拖分项可修性 | 3 项中期（Sandbox OS / IPC stubs / 真 Electron E2E）+ 2 项短期（judge 占位清 / Judge IO 边界） | 🟢 green |

**关键发现**: FINAL-REPORT 声称的 4 缺陷全修经独立代码审查确认真实深度修复（非表面绕过），C1=86 评分经跨厂商独立签字（MiniMax-M3）且审计确认保守诚实。Sandbox 6/10 的"超出 harness scope"说辞对 L2 Docker/Firecracker 成立，但对 L1 Windows JobObject 内存限额存疑——该优化属于可在一轮迭代内完成的中等工作量改动。

---

## 二、缺陷 1-4 修复深度逐条审计

### 2.1 缺陷 1: Judge LLM 接线 — 🟢 深度修复

**原始缺陷**: `PromaCloudLlmClient` 只实现了 `generate`（coder 契约），被 `engine-factory.ts` 的编译期交叉类型断言 `as unknown as CoderLlmClient & JudgeLlmClient` 同时注入给 judge 引擎。Judge 调 `evaluateSoft` 时运行时崩溃。

**修复评估**: **深度修复**。两层改进：

**层 1 — 新增 evaluateSoft 真实现** (`src/common/proma-cloud-llm-client.ts` L399-445):
```typescript
async evaluateSoft(input: SoftEvalInput): Promise<SoftEvalOutput> {
  // 构造 4 维度专业评估 prompt（含评分标准）
  const prompt = [/* 角色设定 + 评分标准 + 文档内容 + JSON 格式要求 */].join('\n');
  // 调真实 LLM chat，超时 60s → score=0 + 超时 message
  const result = await this.chat(prompt, { timeoutMs: SOFT_EVAL_TIMEOUT_MS });
  // 解析 JSON score + 正则兜底 + 解析失败收敛
  return this.parseScoreJson(result.text, input.dimension);
}
```
- 非 mock/stub：真实调 `this.chat()` 走 Proma Cloud API
- 超时保护 (`SOFT_EVAL_TIMEOUT_MS`)
- 三层 JSON 解析容错（JSON.parse → 正则提取 → 收敛 fallback）
- 每个维度失败独立收敛（不拖垮整次 evaluateDocs）

**层 2 — 编译期断言替换为运行时 duck-type 校验** (`electron/engine-factory.ts` L104-116):
```typescript
function assertLlmClientContract(client: unknown, source: string): void {
  const generateType = typeof (client as { generate?: unknown }).generate;
  const evaluateSoftType = typeof (client as { evaluateSoft?: unknown }).evaluateSoft;
  if (generateType !== 'function' || evaluateSoftType !== 'function') {
    throw new Error(/* 清晰错误信息，拒绝 silent fallback */);
  }
}
```
- 旧代码：`client as unknown as CoderLlmClient & JudgeLlmClient`（编译期交叉断言，掩盖运行时契约缺失）
- 新代码：`assertLlmClientContract(client, ...)` 运行时验证 `generate` + `evaluateSoft` 都是 function
- 失败抛错而非 silent fallback（明确拒绝残缺 client 注入）

**代码证据**: 源文件 L399-445 / L104-116，独立确认实现真实。

**结论**: 🟢 **深度修复（深度）** — 不仅补了缺失方法，还从架构层预防同类问题（编译期断言 → 运行时契约校验）。修复爆炸半径小（2 文件），零新增依赖。

---

### 2.2 缺陷 2: Coder CWE-22 路径穿越 — 🟢 深度修复

**原始缺陷**: `generateCode` 的 `outputDir` 校验不充分，攻击者可通过 `outputDir: '../../etc'` 将代码生成到项目目录外。

**修复评估**: **深度修复**。`src/coder/coder-engine-stub.ts` L557-577:

```typescript
// path.resolve 规范化两端后严格相等比对：
//   · 展开 ../、./ → 拒绝目录穿越
//   · 解析为绝对路径 → 拒绝绝对路径偏移、盘符差异、盘符外路径
//   · 字符串严格相等 → 任何偏移即拒
const expectedOutputDir = path.resolve(input.projectRoot, '_code');
const actualOutputDir = path.resolve(input.outputDir);
if (actualOutputDir !== expectedOutputDir) {
  return fail(SYSTEM_INPUT_INVALID,
    'outputDir 必须等于 {projectRoot}/_code（CWE-22 防穿越）',
    { field: 'outputDir', expected: expectedOutputDir, actual: actualOutputDir });
}
```

**安全分析**:
| 攻击向量 | 是否被堵 | 原理 |
|----------|---------|------|
| `../` 目录穿越 | ✅ | `path.resolve` 展开 `..`，解析结果≠expected |
| 绝对路径注入 (`/etc/passwd`) | ✅ | `path.resolve` 绝对路径≠`path.resolve(projectRoot, '_code')` |
| 盘符差异 (`D:\other`) | ✅ | 同上，严格相等 |
| 分隔符差异 (`_code\\..\\_code`) | ✅ | `path.resolve` 规范化分隔符 |
| 多余路径段 (`_code/extra/deep`) | ✅ | 严格相等，额外段≠`_code` |
| symlink 间接穿越 | ⚠️ | `path.resolve` 不解析 symlink（需 `fs.realpathSync`），但 symlink 创建需本进程权限 |

**潜在残余风险**: symlink 间接穿越。如果 projectRoot 某子目录是 symlink 指向外部，`path.resolve` 不会展开。但：
- 创建 symlink 需要进程权限
- coder 引擎沙箱化执行子进程时不具备在 projectRoot 外创建 symlink 的能力
- 此项在 `applyGwtAutofixPatch` 中已显式拒绝（L1373-1380，`lstat.isSymbolicLink()` 检查）

**代码证据**: coder-engine-stub.ts L557-577，独立确认实现真实。

**结论**: 🟢 **深度修复（深度）** — `path.resolve` + 严格相等是最小最强路径安全范式，覆盖所有常见穿越向量。symlink 残余风险在 coder 上下文中不实际可触达。

---

### 2.3 缺陷 3: runGwt autofix 假修复 — 🟢 深度修复

**原始缺陷**: `runGwtWithAutofix` 调用 `llm.generate` 拿到 `fixOut.text`（LLM 生成的修复代码）后，**从未将修复文本写入磁盘**，直接重跑 GWT。代码未变 → 失败不变 → `fixedScenarios` 恒为空 → autofix 循环空转 3 轮后返回 `AUTOFIX_EXHAUSTED`。

**修复评估**: **深度修复**。三组件闭环：

**组件 1 — `applyGwtAutofixPatch` 新增方法** (`src/coder/coder-engine-stub.ts` L1337-1399):
```typescript
private async applyGwtAutofixPatch(
  patchText: string, projectRoot: string
): Promise<{ appliedFiles: string[]; error?: string }> {
  // 块正则：<<<FILE:path>>><<<CONTENT>>><<<END>>> 非贪婪匹配
  const blockRe = /<<<FILE:([^>]+)>>>[\s\S]*?<<<CONTENT>>>([\s\S]*?)<<<END>>>/g;
  // 三道路径安全：
  //   1. path.isAbsolute → 拒
  //   2. path.relative 含 .. → 拒（越界）
  //   3. fs.lstatSync.isSymbolicLink → 拒（symlink 劫持）
  // 支持多文件 batch 应用
  // patch 解析失败 → error 非空 + appliedFiles（出错前已写入的）
}
```
- 块格式正则解析（`<<<FILE:path>>><<<CONTENT>>><<<END>>>`）
- 三道路径安全防线（绝对路径 / `..` 穿越 / symlink）
- 支持单次多文件
- `match[2] ?? ''` 防御 undefined（macp11 F-R1-Y1）

**组件 2 — 主循环重构** (L1182-1220):
```typescript
// 缺陷3 修复：先把 fixOut.text 的 patch 真应用到文件系统
const patchRes = await this.applyGwtAutofixPatch(fixOut.text, input.projectRoot);
if (patchRes.error) {
  autofixLog.push({ ..., patchError: patchRes.error, appliedFiles: patchRes.appliedFiles });
  break;  // patch 失败不静默，不重跑
}
// 现在 spawnSafely 重跑 GWT —— 代码已真修改
spawnOut = await this.spawnSafely({ ... });
```
- 严格顺序：先应用 patch → 再重跑 GWT
- patch 失败记 `patchError` + `break`（不静默跳过）
- 成功路径记 `appliedFiles`（审计追溯）

**组件 3 — prompt 格式指令** (L1256-1264):
```
输出格式（必须严格遵守）：
<<<FILE:path/relative/to/projectRoot.ts>>>
<<<CONTENT>>>
<完整新内容>
<<<END>>>
```
- LLM 被指示输出结构化 patch 块
- 解析器与 prompt 指令契约对齐

**代码证据**: coder-engine-stub.ts L1182-1220 / L1337-1399 + types.ts L138-154。探针 2/2 PASS（有效 patch 真应用 + 非法 patch→patchError 不静默）。

**结论**: 🟢 **深度修复（深度）** — 根治了「LLM 生成修复但从未落盘」的空转根因，修复爆炸半径单文件，新增 1 私有方法 + 1 类型字段。三道路径安全防线覆盖 CWE-22/59/73。代码质量高（块格式比 unified diff 更简单确定性更强）。

---

### 2.4 缺陷 4: evaluateCode 假通过 — 🟢 深度修复

**原始缺陷**: `evaluateCode` L316-318 仅 TODO 注释占位，codeDir/classDiagramPath 缺失时：
1. `runClassConsistencyCheck` 的 `fs.readFileSync(classDiagramPath)` 抛 ENOENT
2. catch 返回空 `{ matchedClasses: [], missingInCode: [], missingInDiagram: [] }`
3. L328 `classConsistency.missingInCode.length > 0` → false（空数组）
4. `hardViolations=[]` → `verdict='pass'` ← **假通过！**

**修复评估**: **深度修复**。两步拦截（`src/judge/judge-engine-stub.ts` L316-339）:

**Step 2 — codeDir 存在性 + 非空** (L316-328):
```typescript
const codeDirAbs = path.resolve(input.projectRoot, input.codeDir);
if (!fs.existsSync(codeDirAbs) || this.isCodeDirEmpty(codeDirAbs)) {
  return errorResponse(JUDGE_ERROR_CODE.CODE_NOT_GENERATED,
    `codeDir 不存在或无源文件（.ts/.js）：${input.codeDir}`, requestId,
    { field: 'codeDir', codeDir: input.codeDir, resolved: codeDirAbs });
}
```

**Step 3 — classDiagramPath 存在性** (L330-339):
```typescript
const classDiagramAbs = path.resolve(input.projectRoot, input.classDiagramPath);
if (!fs.existsSync(classDiagramAbs)) {
  return errorResponse(JUDGE_ERROR_CODE.CLASS_DIAGRAM_MISSING,
    `classDiagramPath 不存在：${input.classDiagramPath}`, requestId,
    { field: 'classDiagramPath', ... });
}
```

**`isCodeDirEmpty` helper** (L1003-1028):
- 迭代栈（非递归），找到首个 `.ts`/`.js` 立即 `return false`
- `.d.ts` 不算源文件（类型声明非实现）
- 跳过 `node_modules`/`dist`/`.git`

**语义设计**: 缺失产物返回 `errorResponse`（"无法评判"），不是 `reject` verdict（"评判完了，不达标"）。比 macp10 文档描述的更诚实。

**代码证据**: judge-engine-stub.ts L316-339 / L1003-1028。探针 5/5 PASS（codeDir 不存在 / codeDir 空 / classDiagramPath 不存在 → 全 errorResponse，S4 对照正常 pass）。

**结论**: 🟢 **深度修复（深度）** — 两步拦截精准堵死假通过路径。`errorResponse` 语义比 verdict=reject 更诚实。`isCodeDirEmpty` 设计精良（early exit + 排除声明文件）。修复爆炸半径单文件，零新依赖。

---

## 三、macp11 G1 — featuresMissingSteps 参与 verdict

### 3.1 修复评估: 🟢 深度修复

**原始问题**: `runGwtExistenceCheck` 已计算 `{ featuresTotal, featuresWithSteps, featuresMissingSteps }`（L1036-1059），但 verdict 聚合段（原 L348-358）完全不看 `featuresMissingSteps`，只看 `classConsistency`。所有 feature 全部缺 step-definitions 仍 verdict='pass'。

**修复** (`src/judge/judge-engine-stub.ts` L348-385):

```typescript
const featuresTotal = gwtCoverage.featuresTotal;
const missingCount = gwtCoverage.featuresMissingSteps.length;
if (featuresTotal > 0 && missingCount > 0) {
  const pct = missingCount / featuresTotal;
  if (pct > 0.5) {
    hardViolations.push({
      rule: 'GWT_STEPS_MISSING',  // 🆕 新增 HardRule 枚举值
      severity: 'major',
      message: `[stub] GWT 步骤缺失 ${pctLabel}：超过 50% → reject`,
    });
  } else {
    softSuggestions.push({
      dimension: 'testability',
      score: gwtCoverage.featuresWithSteps / featuresTotal,
      message: `[stub] GWT 步骤缺失 ${pctLabel}：≤50%，建议补齐`,
    });
  }
}
const verdict = hardViolations.length > 0 ? 'reject' : 'pass';
```

| 场景 | featuresTotal | missingCount | pct | verdict | 探针 |
|------|:---:|:---:|:---:|--------|------|
| 无 .feature 文件 | 0 | 0 | N/A | pass | ✅ S3 |
| 3 feature 缺 1 (=33%) | >0 | 1/3 | ≤50% | pass + softSuggestion | ✅ S2 |
| 3 feature 缺 2 (=66%) | >0 | 2/3 | >50% | **reject** + hardViolation | ✅ S1 |

**代码证据**: L364-384 + `src/judge/types.ts` L41 (`GWT_STEPS_MISSING` 枚举)。探针 17/17 PASS。

**结论**: 🟢 **深度修复** — 阈值设计合理（50% 分界），三个边界全有独立探针。hardViolation/softSuggestion 分支清晰不互相干扰。

---

## 四、C1=86 拖分项深度分析

### 4.1 C1 各维度得分与剩余拖分项

C1 九维评分（来源：macp11 X-c1-revote.md，MiniMax-M3 异厂商独立签字）:

| # | 维度 | 满分 | 得分 | 失分 | 失分原因 | 本轮可修性 |
|---|------|:---:|:---:|:---:|----------|-----------|
| 1 | 可运行性 | 10 | 9 | -1 | renderer tsconfig 430 预存错误 | ⚠️ renderer JSX 环境修复需额外工作 |
| 2 | **Sandbox** | 10 | **6** | **-4** | 非 OS 级隔离（L2 Docker/Firecracker 缺失） + L1 原生限额降级 | 部分可修（见 §5） |
| 3 | Snapshot | 10 | 9 | -1 | 真实硬链接快照正常 | — |
| 4 | Coder 业务 | 15 | 15 | 0 | 缺陷 2+3 已全修 | — |
| 5 | Judge 业务 | 15 | 15 | 0 | 缺陷 4 + featuresMissingSteps 已全修 | — |
| 6 | LLM 基础设施 | 12 | 11 | -1 | judge evaluateDocs 文档加载 + 注释陈旧 | 短期可修 |
| 7 | **Electron IPC** | 10 | **5** | **-5** | 15/20 端点 stubData | 部分可修（见 §6） |
| 8 | 自动化测试 | 8 | 8 | 0 | 充足（单元 + 集成 + IPC 跨层） | — |
| 9 | **端到端** | 10 | **8** | **-2** | 无真实 Electron 进程级 E2E（renderer 仍 mock） | 中期 |
| | **合计** | **100** | **86** | **-14** | | |

### 4.2 拖分项分类与真实性评估

#### 🔴 不可在本轮 harness scope 修复（真中期平台演进）:

1. **端到端 -2** (8/10): 真实 Electron 进程级 E2E 需要 `renderer→ipcRenderer.invoke→真实 Electron 主进程` 的完整链路。macp11 S1 已做到 IPC handler 跨层（进程内），差距是启动真实 Electron app + renderer 进程。这确实需要平台级测试基础设施（Spectron/Playwright Electron），**属实超出本轮 scope**。

#### 🟡 部分可修、但选择不修（"超出 scope"说辞部分不诚实）:

2. **Sandbox -4** (6/10): 详见 §5。Docker/Firecracker（+2）确属中期；但 Windows JobObject L1 内存限额（+1~2）**可在 200 行内实现**，本轮未尝试。
3. **Electron IPC -5** (5/10): 详见 §6。guide/telemetry/project stubs 需新子系统；但 snapshot 4 端点（+1~2）**SnapShotManager 已就绪可快速接线**，本轮未尝试。

#### 🟢 短期可修（1-2 轮迭代）:

4. **LLM 基础设施 -1** (11/12): evaluateDocs 文档加载 TODO（L258-259）+ JSDoc 注释陈旧。~50 行改动。
5. **可运行性 -1** (9/10): renderer JSX 环境 430 预存错误。非新引入，属技术债清理。

---

## 五、Sandbox 6/10 深度审计 🔍

### 5.1 当前实现能力清单

Sandbox 模块位于 `src/sandbox/sandbox-manager.ts` + `types.ts`，~800 行：

| 能力 | 层级 | 实现状态 | 代码位置 |
|------|:---:|---------|---------|
| 文件系统工作区隔离（cwd + env 映射 + 路径守卫） | L0 | ✅ **真实** | sandbox-manager.ts prepareIsolation |
| 子进程 spawn（cwd 隔离 + env 沙箱化 + wallClock 超时） | L0 | ✅ **真实** | sandbox-manager.ts spawnIsolated |
| 进程树终止（零依赖 taskkill/SIGKILL） | L0 | ✅ **真实** | sandbox-manager.ts killTree |
| 资源使用采样（wallClock + childProcessCount） | L1 | ✅ **真实** | sandbox-manager.ts inspect |
| 挂钟超时监控 + 内存采样 → kill | L1 | ✅ **真实** | spawnIsolated 内置 wallClock watchdog |
| 原生 rlimit 内存限额（Unix） | L1 | ❌ **TODO** | applyLimits 注释"Phase 2" |
| Windows JobObject 内存限额 | L1 | ❌ **TODO** | detectCapability 返回 `wallclock_watchdog` |
| 网络白名单强制 | L1 | ❌ **未强制** | networkDenyByDefault 仅元数据记录 |
| Docker 容器隔离 | L2 | ❌ **未实现** | — |
| Firecracker microVM | L2 | ❌ **未实现** | — |
| macOS sandbox-exec | L2 | ❌ **未实现** | — |
| Windows AppContainer | L2 | ❌ **未实现** | — |

### 5.2 6/10 的评分拆解

估计评分逻辑：L0 全实现（3 分）+ L1 部分实现（2 分）+ L2 未开始（0 分）+ 代码架构设计良好（1 分）= **6/10**。

### 5.3 "超出本轮 harness scope" 说辞审计

| 缺失项 | 是否能在一轮 macp 迭代完成 | 工作量估计 | "超出 scope"是否诚实 |
|--------|:---:|-----------|:---:|
| L2 Docker/Firecracker | ❌ | Docker daemon 依赖 + 镜像管理 + CI 集成 = 重大工程 | ✅ 诚实 |
| L2 macOS sandbox-exec / Windows AppContainer | ❌ | OS 特定 API 集成 + 安全审计 | ✅ 诚实 |
| L1 原生 rlimit (Unix) | ✅ | ~100 行 `setrlimit` binding | ⚠️ 半诚实 |
| L1 Windows JobObject 内存限额 | ✅ | ~200 行 `win32-api` 或 child_process 包装 | ⚠️ 半诚实 |
| L1 网络白名单强制 | ✅ | Windows 防火墙规则 / 透明代理 = ~300 行 | ⚠️ 半诚实 |

**根因分析**: Sandbox L1 有三个可在一轮迭代内完成的改进：
1. **Windows JobObject 内存限额**: 使用 `node-win32-api` 或 PowerShell `New-Object System.Management.ManagementClass` 创建 JobObject 并设置 `JOB_OBJECT_LIMIT_JOB_MEMORY`，~200 行。这将使 `detectCapability` 返回 `mechanism='job_object'`。
2. **Unix rlimit 内存限额**: 使用 `posix.setrlimit` 或 Node `process.setrlimit` polyfill，~100 行。
3. **网络白名单**: 使用 Windows Firewall API 或 `child_process.exec('netsh advfirewall ...')`，~300 行。

这三项完成可使 Sandbox 从 6→8 或 9（+2~3）。

**结论**: 🟡 **YELLOW** — FINAL-REPORT 称"超出本轮 harness scope"对 L2 成立，但对 L1 的三个可改进项（JobObject / rlimit / 网络强制）不完全诚实。这些是中等工作量（总计 ~600 行），在 11 轮 macp 迭代中有机会推进但未做。然而，FINAL-REPORT §五已将其诚实列入 roadmap，非刻意掩盖。

---

## 六、Electron IPC 5/10 深度审计 🔍

### 6.1 20 端点状态

| 组 | 端点 | 状态 | 备注 |
|----|------|:---:|------|
| **guide (4)** | chat / previewPrototype / clickToFix / confirm | 🔧 **全 stub** | 需视觉/向导引擎子系统 |
| **coder (3)** | generateCode / applyFix / runGwt | ✅ **真实** | 经 engine-factory 注入真实引擎 |
| **judge (2)** | evaluateDocs / evaluateCode | ✅ **真实** | 同上 |
| **snapshot (4)** | create / list / rollback / delete | 🔧 **全 stub** | ⚠️ SnapshotManager 已就绪但 IPC 层未接线 |
| **telemetry (3)** | emit / emitBatch / query | 🔧 **全 stub** | 需 SQLite/批处理基础设施 |
| **project (4)** | list / open / delete / switchMode | 🔧 **全 stub** | 需项目管理子系统 |

### 6.2 为何 5/10 不是 7/10

**关键发现**: snapshot 组 4 个端点全部 stubData，但 `SnapshotManager` 类在 coder 引擎中已完整实现（createSnapshot / listSnapshots / rollbackToSnapshot / deleteSnapshot）。IPC handler 只需：
1. 取 `coder.snapshotManager` 引用（已在 engine-factory DI 框架中）
2. 调对应方法
3. 返回 ApiResponse

**工作量**: 每个 snapshot handler ~15 行，4 个 = ~60 行 + 类型适配。

`registerIpcHandlers` 已经有 `coder` 局部变量（L158），而 `coder` 是 `CoderEngine` 实例。但 `CoderEngine` 的 snapshot 端口是私有的（`private readonly snapshotManager`），需加 getter 或在 engine-factory 中暴露引用。

**工作量估计**: ~100 行（加 1 getter + 4 handler 接线），可在一轮迭代完成。

**快照 IPC 接线可使 IPC 从 5→6 或 7**（+1~2）。虽然不改变大局，但「全不可修」的说辞不完全准确。

### 6.3 真正的"本轮不可修"项

| 组 | 为何不可修 |
|----|-----------|
| guide (4) | 需视觉/向导引擎 — 独立子系统，非几行代码可 mock |
| telemetry (3) | 需 SQLite 写入 + 批量缓冲 + 查询 API — 中等子系统 |
| project (4) | 需项目管理 CRUD + session 创建 — 中等子系统 |

**结论**: 🟡 **YELLOW** — 15 stubs 中 snapshot 4 个（~27%）可在一轮迭代快速接线（SnapshotManager 已就绪），其余 11 个确需新子系统。FINAL-REPORT 称全部"超出 scope"略有过度概括，但核心结论（coder/judge 5 个关键端点已真实）正确，且导向不影响 C1 评分大局（+1~2 分改变）。

---

## 七、Judge 占位 16→\<5 分析

### 7.1 实际占位计数（独立代码审查）

FINAL-REPORT 声称 judge 占位 16→<5。**独立计数结果**:

| 功能 | 原始状态 (macp3) | 当前状态 (macp11) |
|------|:---:|:---:|
| evaluateDocs 7 硬约束检查器 | ❌ 空返回（7 个 TODO） | ✅ **6/7 真实现**（regex + fs） |
| CODE_CLASS_CONSISTENCY (evaluateDocs) | ❌ | ✅ 跳过（evaluateCode 专用） |
| evaluateSoft (LLM 4 维软评估) | ❌ | ✅ **真实 LLM 调用** |
| evaluateCode Step 2-3 存在性校验 | ❌ TODO 占位 | ✅ **真实现** |
| classConsistency 检查 (evaluateCode) | ❌ | ✅ **正则解析 .puml + fs 扫 _code/** |
| gwtExistence 检查 (evaluateCode) | ❌ | ✅ **fs 扫 features/ + step-definitions/** |
| featuresMissingSteps → verdict | ❌ | ✅ **阈值分级**（macp11 G1） |
| evaluateDocs 文档加载 (_meta.json) | ❌ TODO | ❌ **仍 TODO**（L258-259） |
| JSDoc 注释 | 正确 | ⚠️ **陈旧**（多处仍写"S1 占位"但代码已真实现） |

**实际剩余真占位**: **1 个**（文档加载）+ 若干陈旧注释（误导性）。

### 7.2 陈旧 JSDoc 问题

以下位置 JSDoc/注释仍标注"S1 占位"，但实际代码已真实实现：

- L234-236: evaluateDocs JSDoc 写"S1 占位" — 但 Step 3 硬检查、Step 4 软评估已真实
- L261: `// Step 3：硬约束检查（S1 占位）` — 实际 6 个 checker 全部真实现
- L264: `// Step 4：软约束评估（S1 占位）` — 实际 evaluateSoft 真实 LLM
- L292-293: evaluateCode JSDoc 写"S1 占位" — 但 classConsistency/gwtExistence 已真实现
- L485: `// 硬约束 / 软约束执行（S1 占位，S2 接入真实检查器）` — 已接入
- L490: `* S1 占位：返回空数组（认为无违例）` — 实际不返回空数组

**影响**: 对代码审查者产生误导（以为功能仍 stub），降低代码可维护性。**建议低优先级清理**（非功能缺陷）。

**结论**: 🟢 **GREEN（占位清理远超预期）** — "16→<5" 表述偏保守，实际剩余真占位仅 1 个（文档加载 TODO）+ 陈旧注释。Judge 引擎的实现完成度远高于 C1=11/12 给人的印象。

---

## 八、86→95+ 可行路径评估

### 8.1 分项回收估算

| # | 拖分项 | 当前 | 目标 | 回收 | 工作量 | 风险 | 推荐优先级 |
|---|--------|:---:|:---:|:---:|--------|------|:---:|
| 1 | LLM 基础设施 (judge 文档加载) | 11 | 12 | **+1** | ~50 行，1 轮迭代 | 低 | **P0** |
| 2 | 可运行性 (renderer tsconfig) | 9 | 10 | **+1** | 修 JSX 类型配置，~100 行 | 中（可能引入新错误） | P1 |
| 3 | Sandbox L1 JobObject + rlimit | 6 | 8 | **+2** | ~600 行，2 轮迭代 | 中（跨平台兼容） | P1 |
| 4 | IPC snapshot 4 端点接线 | 5 | 7 | **+2** | ~100 行，1 轮迭代 | 低 | **P0** |
| 5 | Sandbox L2 Docker/Firecracker | 8 | 10 | **+2** | Docker daemon + 镜像 + CI，重大 | 高（Infra 依赖） | P2 |
| 6 | IPC 其他 stubs (guide/telemetry/project) | 7 | 10 | **+3** | 需 3 个新子系统，重大 | 高 | P2 |
| 7 | 端到端 真实 Electron 进程 | 8 | 10 | **+2** | Spectron/Playwright Electron | 中 | P2 |
| 8 | Judge IO 边界（非 ENOENT 显式错误） | — | — | **(质量)** | ~100 行 | 低 | P1 |

### 8.2 推荐路线图

```
Phase A (短期，1-2 轮 macp 迭代):
  LLM 基础设施 11→12 (+1) + IPC snapshot 接线 5→7 (+2) + Judge IO 边界
  86 → 89

Phase B (中期，3-5 轮):
  Sandbox L1 原生限额 6→8 (+2) + 可运行性 9→10 (+1)
  89 → 92

Phase C (中长期，6-10 轮):
  Sandbox L2 Docker 8→10 (+2) + 端到端真实 Electron 8→10 (+2)
  92 → 96

Phase D (远期):
  IPC guide/telemetry/project 全接线 7→10 (+3) + Snapshot L2 增量
  96 → 98-100
```

### 8.3 可行性评估

- **86→89**: ✅ **高度可行** — 2 项均为低风险、小工作量（总计 ~150 行）
- **89→92**: ✅ **可行** — Sandbox L1 原生限额是实现题（非研究题），跨平台兼容性需注意
- **92→96**: ⚠️ **需平台演进** — Docker daemon 依赖改变部署模式；Electron 进程级 E2E 需测试基础设施
- **96→98+**: ⚠️ **需重大子系统投入** — guide/telemetry/project 后端非简单接线

**保守估计**：Phase A+B 在 1-2 周可达 92。Phase C 需 3-6 周。Phase D 月级。

---

## 九、额外发现的质量问题

### 9.1 未列入 FINAL-REPORT 的问题

| # | 发现 | 严重度 | 位置 | 建议 |
|---|------|:---:|------|------|
| 1 | **JSDoc 注释陈旧** — 多处标注"S1 占位"但代码已真实现 | 🟡 low | judge-engine-stub.ts L234-236 / L261 / L264 / L292-293 / L485 / L490 | 清理陈旧注释，标注实际实现状态 |
| 2 | **runGwtExistenceCheck 对非 ENOENT 错误静默返回空** | 🟡 low | judge-engine-stub.ts L1047-1057 | macp11 auditor 已列举，建议补充 `error.code !== 'ENOENT'` 日志 |
| 3 | **sandbox-manager.ts `applyLimits` 返回空数组但未执行** | 🟢 info | sandbox-manager.ts | 方法签名存在但实现为"仅记录 capability 不实际执行"，属诚实标注 |
| 4 | **evaluateDocs 文档加载 TODO 是可修复的功能缺口** | 🟡 medium | judge-engine-stub.ts L258-259 | 与 LLM 基础设施 -1 直接相关，~50 行可补 |
| 5 | **coder-engine-stub.ts `generateCode` 的 `outputDir` CWE-22 校验未覆盖 symlink** | 🟢 low | coder-engine-stub.ts L557-577 | 已在 applyGwtAutofixPatch 中覆盖 symlink（L1373-1380），但 generateCode 输出路径未做 symlink 检查。coder 沙箱上下文中不实际可触达 |

### 9.2 架构层面观察

1. **DI 框架成熟度好**: engine-factory.ts 的可选注入模式（LlmClient + sandbox + snapshot）设计清晰、可逆、业务路径零影响。这是 macp3 和 macp11 S1 的共同遗产。

2. **IPC handler testability hook (macp11 S1) 质量高**: `registerIpcHandlers(engines?)` 的可选参数模式是最小侵入式 DI——1 个可选参数 + 1 个 `export` + 5 处变量名替换，实现了完整的 IPC 跨层可测试性。

3. **Judge 引擎实现完整度被低估**: C1 评分中 LLM 基础设施 11/12 的 -1 分主要来自文档加载 TODO + 陈旧注释。实际 hard checks 6/7 + soft eval + classConsistency + gwtExistence + featuresMissingSteps 全部真实实现。Judge 是代码库中实现完成度最高的模块之一。

---

## 十、C1 评分标准合理性评估

### 10.1 FINAL-REPORT 是否诚实

| 声明 | 审计结论 | 证据 |
|------|:---:|------|
| C1=86 (MiniMax-M3 异厂商独立签字) | ✅ **诚实** | X-c1-revote.md 详列每维度评分依据，独立重跑 build/typecheck/probe |
| 端到端保守 +4 非 +6 | ✅ **诚实** | auditor 明确说"mock Electron → 保守只回收 +4" |
| G3 yellow 清理不重复加分 | ✅ **诚实** | 3 yellow 修复价值计入可靠性与报告闭环，不额外计分 |
| 5 拖分项诚实标注 | ✅ **诚实** | Sandbox/Electron IPC/端到端/LLM 基础设施/Judge IO 边界全部列出 |
| Sandbox "超出 scope" | ⚠️ **部分诚实** | L2 Docker/Firecracker 真超出；L1 Windows JobObject (~200行) 未超出但未尝试 |

### 10.2 评分标准合理性

C1 评估方法论（macp3 MiniMax 基线 → macp11 MiniMax 复评）跨多轮迭代保持一致性。**潜在偏向**:

- **featuresMissingSteps 等 Judge 业务修复可能被低估**: macp10 C1=79 时 Judge 业务 13/15（-2 因 featuresMissingSteps），macp11 修后到 15/15。但 LLM 基础设施从 11→11 不变（文档加载 TODO），而实际 Judge 整体完成度很高。可能存在"维度间权重分配"问题——文档加载 TODO 对产品价值影响远小于硬约束检查器全部真实实现。

- **Sandbox 6→6 不变隐含假设**: Sandbox 的 wallClock watchdog 是真隔离（比进程内执行强很多），评分标准若仅以"是否 OS 级"为二元切换，会低估当前 L0+L1 混合方案的安全价值。

---

## 十一、审计结论汇总

### 11.1 严重度分级

| 严重度 | 数量 | 项目 |
|:---:|:---:|------|
| 🔴 red | 0 | 无阻塞级问题 |
| 🟡 yellow | 3 | Sandbox "超出 scope"说辞部分不诚实 / IPC snapshot 可接线未尝试 / JSDoc 陈旧 |
| 🟢 green | 8 | 缺陷1-4 全深度修复 / macp11 G1 深度修复 / C1=86 打分诚实 / 86→89 短期可行 / Judge 实现度被低估 |

### 11.2 核心判断

1. **4 缺陷修复全部真实深度修复**（非表面绕过）。代码质量高，修复爆炸半径小，安全范式正确。
2. **C1=86 评分诚实保守** — 跨厂商独立签字（MiniMax-M3），独立审计确认无虚高。
3. **Sandbox 6/10** — "超出 scope"对 L2 成立，对 L1 的三个可改进项不完全诚实。但这些已在 FINAL-REPORT §五 roadmap 中诚实列入。
4. **86→92 短期可达**（2 项 P0 + 2 项 P1，~1000 行，1-2 周）。92→95+ 需中期平台演进。
5. **无未列入 FINAL-REPORT 的重大质量问题**。发现的问题均为低严重度（陈旧注释、文档加载 TODO、IO 边界）。

### 11.3 最终评价

**multi-agent-collab-platform 项目层质量：良好（C1=86/100），代码审计确认 4 缺陷深度修复，剩余拖分项诚实标注，短期路径明确可达 92。FINAL-REPORT §五 roadmap 覆盖所有已知拖分项。**

---

## 附录 A: 代码证据索引

| 缺陷 | 核心文件 | 关键行号 | 修复类型 |
|------|---------|---------|:---:|
| 1 | `electron/engine-factory.ts` | L104-116 | duck-type 契约校验 |
| 1 | `src/common/proma-cloud-llm-client.ts` | L399-445 | evaluateSoft 真实现 |
| 2 | `src/coder/coder-engine-stub.ts` | L557-577 | path.resolve 双向 + 严格相等 |
| 3 | `src/coder/coder-engine-stub.ts` | L1182-1220, L1337-1399 | applyGwtAutofixPatch + 主循环 |
| 3 | `src/coder/types.ts` | L138-154 | patchError + appliedFiles |
| 4 | `src/judge/judge-engine-stub.ts` | L316-339, L1003-1028 | Step 2-3 存在性 + isCodeDirEmpty |
| G1 | `src/judge/judge-engine-stub.ts` | L348-385 | featuresMissingSteps 阈值分级 |
| G1 | `src/judge/types.ts` | L41 | GWT_STEPS_MISSING 枚举 |
| G2 | `electron/main.ts` | L144-327 | registerIpcHandlers export + engines? |
| G2 | `electron/engine-factory.ts` | L55-64, L181-185 | coderSandbox/coderSnapshot DI |
| Sandbox | `src/sandbox/sandbox-manager.ts` | 全文 | L0+L1 实现 |
| IPC | `electron/main.ts` | L161-324 | 20 端点（5 真实 + 15 stub） |

## 附录 B: 审计方法自检

| # | 检查项 | 通过 | 证据 |
|---|--------|:---:|------|
| 1 | 缺陷1-4 逐条评估修复深度 | ✅ | §2.1-2.4，每条含代码行号 + 安全分析 |
| 2 | C1 拖分项逐项分析可修性 | ✅ | §4.2，分类为不可修/部分可修/短期可修 |
| 3 | Sandbox 6/10 根因分析 | ✅ | §5，逐能力检查实现状态 + 工作量估计 |
| 4 | 86→95+ roadmap 可行性评估 | ✅ | §8，四阶段 + 工作量估计 + 风险 |
| 5 | 每条 finding 有 severity + 代码证据 | ✅ | §11.1 汇总表 + 附录 A 代码索引 |
| 6 | 未发现重大遗漏 | ✅ | §9.1 列出额外发现，均为 low/medium |
