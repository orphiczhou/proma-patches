# macp11-J1 修复报告 — G1 featuresMissingSteps 参与 verdict + G3 三 yellow 清算

- **leaf**: macp11-J1-worker (session=0bb09366, GLM-5.2)
- **parent**: macp11-J-commander (82753422)
- **基线**: macp10 C1=79 → 目标 85+
- **范围**: G1(Judge 业务 +2) + G3 三 yellow(F-R1-Y1 / F-R1-Y2 / F-E1-Y1)
- **验证**: typecheck(0) + build(0) + 探针 probe-macp11-j1.cjs(0, 17 断言全 PASS)

---

## 一、G1 — featuresMissingSteps 参与 verdict 聚合（核心，+2）

### 1.1 问题定位（修前）

`src/judge/judge-engine-stub.ts` `evaluateCode`：
- L346 已计算 `const gwtCoverage = await this.runGwtExistenceCheck(input);`
- `runGwtExistenceCheck`（L1009-1055）已返回 `{ featuresTotal, featuresWithSteps, featuresMissingSteps: string[] }`
- **但 L348-358 verdict 聚合只看 `classConsistency`，`featuresMissingSteps` 完全不参与** —— `featuresTotal` 个 feature 中即便全部缺 step-definitions，verdict 仍是 `pass`，Judge 业务核心硬约束漏判。

### 1.2 修复方案（增量，不重构聚合整体结构）

在 verdict 聚合段（原 L348-358）增加 featuresMissingSteps 阈值分级分支：

| featuresTotal | missingCount/Total | 阈值 | verdict 影响 | 落点 |
|---|---|---|---|---|
| 0（无 .feature / features/ 不存在） | — | — | 不算违例（gwtCoverage 已返回 0/[]） | 无 hardViolation / 无 softSuggestion |
| >0 | pct > 50% | 拒绝 | **hard violation `GWT_STEPS_MISSING` (severity=major) → verdict=reject** | hardViolations.push |
| >0 | 0 < pct ≤ 50% | 建议 | **softSuggestion (dimension=testability) → 不影响 verdict** | softSuggestions.push |
| >0 | 0 | — | 不算违例（全部 feature 有 step-definitions） | 无 |

### 1.3 源码改动

**① `src/judge/types.ts` — HardRule 枚举增量加 `GWT_STEPS_MISSING`**

原 enum 7 项硬约束规则无 `GWT_STEPS_MISSING`（仅有 `GWT_FEATURE_MISSING`，语义是 .feature 文件缺失 ≠ step 缺失）。增量加：

```ts
export type HardRule =
  | 'PRD_REQUIRED_FIELD_MISSING'
  | 'PLANTUML_SYNTAX_INVALID'
  | 'API_SCHEMA_INCOMPLETE'
  | 'SPRINT_GRANULARITY_INVALID'
  | 'ROLE_RESPONSIBILITY_OVERLAP'
  | 'GWT_FEATURE_MISSING'
  | 'CODE_CLASS_CONSISTENCY'
  | 'GWT_STEPS_MISSING';   // 🆕 macp11 G1：feature 无对应 step-definitions (>50% 缺失 → reject)
```

**② `src/judge/judge-engine-stub.ts` — verdict 聚合段（原 Step 6）**

- 新增 `const softSuggestions: VerdictResult['softSuggestions'] = [];` 变量（原代码内联 `softSuggestions: []` 无变量声明）
- 保留 `CODE_CLASS_CONSISTENCY` 分支不动
- 新增 featuresMissingSteps 阈值分级分支：

```ts
const hardViolations: VerdictResult['hardViolations'] = [];
const softSuggestions: VerdictResult['softSuggestions'] = [];
// classConsistency 分支（保留不动）...
if (classConsistency.missingInCode.length > 0 || classConsistency.missingInDiagram.length > 0) {
  hardViolations.push({ rule: 'CODE_CLASS_CONSISTENCY', severity: 'major', /* ... */ });
}
// 🆕 G1 分支：featuresMissingSteps 阈值分级
const featuresTotal = gwtCoverage.featuresTotal;
const missingCount = gwtCoverage.featuresMissingSteps.length;
if (featuresTotal > 0 && missingCount > 0) {
  const pct = missingCount / featuresTotal;
  const pctLabel = `${missingCount}/${featuresTotal} (${(pct * 100).toFixed(1)}%)`;
  if (pct > 0.5) {
    hardViolations.push({
      rule: 'GWT_STEPS_MISSING',
      severity: 'major',
      targetPath: input.featureRoot,
      message: `[stub] GWT 步骤缺失 ${pctLabel}：超过 50% feature 无对应 step-definitions → reject`,
    });
  } else {
    softSuggestions.push({
      dimension: 'testability',
      targetPath: input.featureRoot,
      message: `[stub] GWT 步骤缺失 ${pctLabel}：≤50% feature 无对应 step-definitions，建议补齐 step-definitions`,
      score: gwtCoverage.featuresWithSteps / featuresTotal,
    });
  }
}
const verdict = hardViolations.length > 0 ? 'reject' : 'pass';
```

Step 7 信封返回的 `softSuggestions: []` 改为引用新变量 `softSuggestions`。

### 1.4 schema 适配说明（必须按源码真实 schema，非 brief 伪代码）

brief 伪代码写的 softSuggestions 项 `{rule,severity,message}` 与 `SoftSuggestion` 真实 schema 不符。实际 schema（`src/judge/types.ts` L62-71）：

```ts
interface SoftSuggestion {
  dimension: SoftDimension;  // 'logical-consistency' | 'testability' | 'completeness' | 'readability'
  targetPath: string;
  message: string;
  score: number;             // 0-1（<0.6 标记需改进）
}
```

- **dimension** 选 `testability`（step 缺失 = 可测试性维度缺口）
- **score** = `featuresWithSteps / featuresTotal`（覆盖度，场景2 = 2/3 ≈ 0.667）
- **targetPath** = `input.featureRoot`（对齐现有 `CODE_CLASS_CONSISTENCY` 用 `input.classDiagramPath` 的"input 路径作 targetPath"约定）

### 1.5 探针验证（probe-macp11-j1.cjs）

探针 require 编译产物 `dist/src/judge/judge-engine-stub.js`，注入 mock LlmClient（evaluateCode 不调 LLM，mock 避免 PromaCloudLlmClient 构造副作用）。在 os.tmpdir() 构造最小 fixture（`_code/foo.ts` 含 `export class Foo` + `03_ARCHITECTURE/class-diagram.puml` 含 `class Foo` → classConsistency 对齐不出违例，隔离 G1 效果）。3 场景 17 断言全 PASS：

| 场景 | fixture | 期望 | 结果 |
|---|---|---|---|
| 1 | 3 feature 仅 `a.steps.ts` → 缺 2/3 (66.7% > 50%) | `verdict==='reject'` + hardViolations 含 `GWT_STEPS_MISSING` + message 含 `2/3 (66.7%)` | ✅ PASS (6 断言) |
| 2 | 3 feature `a.steps.ts`+`b.steps.ts` → 缺 1/3 (33.3% ≤ 50%) | `verdict==='pass'` + hardViolations 空 + softSuggestions 非空 + dimension=`testability` + message 含 `1/3 (33.3%)` + score=2/3 | ✅ PASS (7 断言) |
| 3 | features/ 不存在 → featuresTotal=0 | `verdict==='pass'` + 无 `GWT_STEPS_MISSING` + softSuggestions 空 | ✅ PASS (4 断言) |

---

## 二、G3 三 yellow 清算

### 2.1 F-R1-Y1 — coder-engine-stub.ts `match[2]` undefined 防御

**位置**: `src/coder/coder-engine-stub.ts` `applyGwtAutofixPatch` 内（原 L1349）

**问题**: `const content = match[2].replace(/^\r?\n/, '');` —— `match[2]` 来自 block 正则的 CONTENT 捕获组，理论上必为 string（`([\s\S]*?)` 可匹配空串但不 undefined），但极端输入下若 `match[2]` 为 undefined，`.replace` 会抛 `TypeError: Cannot read properties of undefined`，中断整批 patch 应用。

**修复**（可选链兜底，最小改动）：

```ts
// F-R1-Y1 防御（macp11）：match[2] 理论上必为 string，极端输入下保留 undefined 防御
const content = (match[2] ?? '').replace(/^\r?\n/, '');
```

### 2.2 F-R1-Y2 — AutofixLogEntry 加 `appliedFiles` + push 透传

**⚠️ 行号/路径漂移（must_report）**：brief 写"src/judge/types.ts L138-148"，实际 `AutofixLogEntry` 定义在 **`src/coder/types.ts` L138-148**（judge/types.ts 无此类型，coder-engine-stub.ts L53 从 `../coder/types` 导入）。目标类型清晰，不阻塞。

**改动 3 处**：

① `src/coder/types.ts` — `AutofixLogEntry` 加可选字段：

```ts
export interface AutofixLogEntry {
  attempt: number;
  fixedScenarios: string[];
  remainingFailures: string[];
  patchError?: string;
  /** 🆕 macp11 F-R1-Y2：本轮实际写入磁盘的文件相对路径列表（posix 风格）。
   *  来源：applyGwtAutofixPatch 返回的 appliedFiles 透传。
   *  即便 patchError 非空也可能含部分写入，便于审计/回滚定位。 */
  appliedFiles?: string[];
}
```

② `src/coder/coder-engine-stub.ts` autofixLog.push 两处（原 L1190 错误分支 + L1214 成功分支）—— `applyGwtAutofixPatch` 已返回 `{ appliedFiles: string[]; error?: string }`（原 L1338-1394 已计算），透传进 push：

```ts
// 错误分支（patchRes.error 非空）
autofixLog.push({
  attempt: attempts,
  fixedScenarios: [],
  remainingFailures: failedBefore,
  patchError: patchRes.error,
  appliedFiles: patchRes.appliedFiles,   // 🆕 出错前已部分写入的文件
});

// 成功分支
autofixLog.push({
  attempt: attempts,
  fixedScenarios,
  remainingFailures: failedAfter,
  appliedFiles: patchRes.appliedFiles,   // 🆕 本轮应用的文件
});
```

`patchRes` 在 while 循环体内声明（原 L1185），两处 push 同属一次循环迭代，作用域可见，无需改控制流。

### 2.3 F-E1-Y1 — 探针先落盘再写报告时序

详见 `J1-fix-report.note.md`（含 probe 路径 / probe mtime / note mtime 佐证 note 晚于探针落盘）。

---

## 三、验证结果（三验证全绿）

| 验证 | 命令 | 退出码 |
|---|---|---|
| typecheck | `./node_modules/.bin/tsc --noEmit -p tsconfig.build.json` | **0** ✅ |
| build | `npm run build`（= tsc -p tsconfig.build.json → dist/） | **0** ✅ |
| G1 探针 | `node probe-macp11-j1.cjs` | **0** ✅ (3 场景 17 断言全 PASS) |

> 🔴 typecheck 必须用 `tsconfig.build.json`（默认 tsconfig 含 src/renderer 430 个预存在错误，非本 scope）。

---

## 四、must_report 项（行号/字段漂移，非阻塞）

1. **F-R1-Y2 路径漂移**：brief 写 `src/judge/types.ts L138-148`，实际 `AutofixLogEntry` 在 **`src/coder/types.ts` L138-148**。已按真实位置修复。
2. **autofixLog.push 有两处**（brief 写"L1190-1195"一处）：实际 L1190 错误分支 + L1214 成功分支，两处均已透传 `appliedFiles`。
3. **SoftSuggestion schema 与 brief 伪代码不符**：brief 写 `{rule,severity,message}`，实际 schema 是 `{dimension,targetPath,message,score}`。已按真实 schema 适配（dimension=testability, score=覆盖度）。
4. **HardRule enum 无 `GWT_STEPS_MISSING`**：brief must_contain 要求此规则名 → 增量加枚举值（非重构）。

以上 4 项均属"按源码真实字段名调整"，未越 out_of_scope（未重构 verdict 聚合整体结构，仅增量加分支）。

---

## 五、out_of_scope 未触碰

- macp10 其他已 pass 项未动
- src/renderer 下 430 个预存在错误忽略（用 tsconfig.build.json）
- verdict 聚合整体结构未重构，仅增量加 featuresMissingSteps 分支 + softSuggestions 变量
