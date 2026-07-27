# macp10-E1 缺陷4 修复报告 — evaluateCode 假通过

> **worker**: macp10-E1-worker (GLM-5.2/ZLM)
> **milestone**: M1
> **目标文件**: `src/judge/judge-engine-stub.ts` evaluateCode（L316-318 TODO 占位）
> **结论**: ✅ **已修复** — 缺失产物（codeDir 不存在/空、classDiagramPath 不存在）现返回 `errorResponse`，绝不 `verdict=pass`。typecheck/build 双绿，探针 4 场景全 PASS。

---

## 1. 缺陷4 根因（L316-318 TODO 占位）

### 问题代码（修复前）
`src/judge/judge-engine-stub.ts` L316-318：

```typescript
// Step 2-3：存在性校验（S2 实现）
// TODO(S2)：fs.existsSync(codeDir) 空目录 → JUDGE_CODE_NOT_GENERATED
// TODO(S2)：fs.existsSync(classDiagramPath) → JUDGE_CLASS_DIAGRAM_MISSING
```

**根因**：Step 2-3 仅注释占位，**从未实现文件系统存在性校验**。validateEvaluateCodeInput（L406-415）只校验 `codeDir`/`classDiagramPath` 是非空字符串，**不校验文件系统存在性**（那是 Step 2-3 的职责）。

### 假通过路径追踪（核心证据）

evaluateCode 调用链在 codeDir 缺失时：

1. Step 2-3 跳过（TODO 占位）→ 不拦截
2. Step 4 `runClassConsistencyCheck(input)`（L880-926）执行：
   - L889 `fs.readFileSync(classDiagramPath)` 抛 ENOENT
   - L895-901 catch → `return { matchedClasses: [], missingInCode: [], missingInDiagram: [] }`（**空对象**）
   - L899 注释自欺：「读取失败返回空（调用方已有 JUDGE_CLASS_DIAGRAM_MISSING 检查）」——**调用方根本没检查**（就是 TODO）
3. Step 6 L328：`classConsistency.missingInCode.length > 0 || missingInDiagram.length > 0` → 空数组 → **条件 false**
4. `hardViolations=[]` → L336 `verdict = hardViolations.length > 0 ? 'reject' : 'pass'` → **`verdict='pass'` 假通过！**

劣质/缺失代码以此通过 judge 把关进入下游，是 C1 Judge 业务 -2 分根因。

---

## 2. Step 2 实现 — codeDir 存在性 + 非空校验

**决策**：codeDir 缺失/空用 `errorResponse(JUDGE_CODE_NOT_GENERATED)` 直接返回，**语义「无法评判」**（根本无法跑一致性检查），比构造 `reject` verdict（语义「评判完了，不达标」）更诚实。classDiagramPath 同语义保持一致。

**新代码**（替换 L316-318 TODO）：

```typescript
// Step 2：codeDir 存在性 + 非空校验（JUDGE_CODE_NOT_GENERATED）
// 缺陷4 修复：原 TODO 占位跳过校验，codeDir 不存在/空目录时 runClassConsistencyCheck
//   读失败返回空对象（L895-901 catch ENOENT）→ hardViolations=[] → verdict='pass' 假通过。
//   现强制：codeDir 不存在 或 无 .ts/.js 源文件 → errorResponse(JUDGE_CODE_NOT_GENERATED)。
const codeDirAbs = path.resolve(input.projectRoot, input.codeDir);
if (!fs.existsSync(codeDirAbs) || this.isCodeDirEmpty(codeDirAbs)) {
  return errorResponse(
    JUDGE_ERROR_CODE.CODE_NOT_GENERATED,
    `codeDir 不存在或无源文件（.ts/.js）：${input.codeDir}`,
    requestId,
    { field: 'codeDir', codeDir: input.codeDir, resolved: codeDirAbs },
  );
}
```

**关键点**：
- `path.resolve(input.projectRoot, input.codeDir)` — 路径语义与 `runClassConsistencyCheck` L884 一致（codeDir 相对 projectRoot）
- `fs.existsSync` 判存在 + `isCodeDirEmpty` 判空目录（无 .ts/.js）
- 双 trigger：目录不存在 OR 存在但无源文件，均归 `JUDGE_CODE_NOT_GENERATED`

---

## 3. Step 3 实现 — classDiagramPath 存在性校验

```typescript
// Step 3：classDiagramPath 存在性校验（JUDGE_CLASS_DIAGRAM_MISSING）
// 与 Step 2 同语义：类图缺失 = 无法评判一致性，返回 error 而非构造假 verdict。
const classDiagramAbs = path.resolve(input.projectRoot, input.classDiagramPath);
if (!fs.existsSync(classDiagramAbs)) {
  return errorResponse(
    JUDGE_ERROR_CODE.CLASS_DIAGRAM_MISSING,
    `classDiagramPath 不存在：${input.classDiagramPath}`,
    requestId,
    { field: 'classDiagramPath', classDiagramPath: input.classDiagramPath, resolved: classDiagramAbs },
  );
}
```

**注意**：validateEvaluateCodeInput L411-415 对空字符串 `classDiagramPath` 也返回 `CLASS_DIAGRAM_MISSING`（语义「必填字段空」），与本处「文件系统不存在」同码——可接受，两者都属于「类图缺失」语义族，调用方按同一码处理即可。

---

## 4. helper — `isCodeDirEmpty`（新增私有方法）

放在 `collectTsFiles`（L929-946）之后、`runGwtExistenceCheck` 之前。**不改动 `collectTsFiles`**（它服务于 runClassConsistencyCheck 的 `.ts export class` 提取，保持单一职责），新增独立 helper 判断「目录是否有源文件」。

```typescript
/**
 * 判断 codeDir 是否"无源文件"（递归扫描后无 .ts/.js）。
 * 用于 evaluateCode Step 2：codeDir 存在但无源文件 → JUDGE_CODE_NOT_GENERATED。
 * 跳过 node_modules / dist / .git；.d.ts 类型声明不算源文件（非实现）。
 * 迭代实现（栈），找到首个源文件即返回 false，避免全目录扫描。
 */
private isCodeDirEmpty(dir: string): boolean {
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '.git'].includes(entry.name)) {
          stack.push(path.join(current, entry.name));
        }
      } else if (
        entry.isFile()
        && !entry.name.endsWith('.d.ts')
        && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))
      ) {
        return false;
      }
    }
  }
  return true;
}
```

**设计要点**：
- 迭代栈（非递归）— 找到首个源文件立即 `return false`，不全扫
- `.ts` / `.js` 均算源文件（贴合 brief「无 .ts/.js」要求；兼容 JS 产物项目）
- `.d.ts` 不算（类型声明非实现）
- 跳过 `node_modules` / `dist` / `.git`（与 `collectTsFiles` L939 一致）

---

## 5. 探针验证 — 缺失产物真拦截

探针脚本：`.context/trees/macp10/probe/E1-probe.cjs`（require dist 编译产物 `dist/src/judge/judge-engine-stub.js`，4 场景）。

### 探针核心逻辑

```javascript
const { judgeEngineStub } = require('D:/Codes/multi-agent-collab-platform/dist/src/judge/judge-engine-stub.js');

// S1: codeDir 不存在（_code/ 未创建）
await run('S1_codeDir_missing');

// S2: codeDir 空目录（存在但无源文件）
fs.mkdirSync(path.join(tmpRoot, '_code'), { recursive: true });
await run('S2_codeDir_empty');

// S3: codeDir 有源文件，classDiagramPath 不存在
fs.writeFileSync(path.join(tmpRoot, '_code', 'foo.ts'), 'export class Foo {}\n');
await run('S3_puml_missing');

// S4 对照：产物齐全 → 正常评判（不因缺失产物 error）
fs.writeFileSync(path.join(tmpRoot, '03_ARCHITECTURE', 'class-diagram.puml'), '@startuml\nclass Foo\n@enduml\n');
await run('S4_control');
```

### 实际输出（exit 0）

```text
[probe] tmpRoot=C:\Users\sir_c\AppData\Local\Temp\macp10-E1-probe-L4dwe9
{"scene":"S1_codeDir_missing","ok":false,"verdict":null,"code":"JUDGE_CODE_NOT_GENERATED","message":"codeDir 不存在或无源文件（.ts/.js）：_code/","hardViolations":null}
{"scene":"S2_codeDir_empty","ok":false,"verdict":null,"code":"JUDGE_CODE_NOT_GENERATED","message":"codeDir 不存在或无源文件（.ts/.js）：_code/","hardViolations":null}
{"scene":"S3_puml_missing","ok":false,"verdict":null,"code":"JUDGE_CLASS_DIAGRAM_MISSING","message":"classDiagramPath 不存在：03_ARCHITECTURE/class-diagram.puml","hardViolations":null}
{"scene":"S4_control","ok":true,"verdict":"pass","code":null,"message":null,"hardViolations":0}

=== ASSERTIONS ===
PASS  S1 codeDir 不存在 → JUDGE_CODE_NOT_GENERATED
PASS  S2 codeDir 空目录 → JUDGE_CODE_NOT_GENERATED
PASS  S3 classDiagramPath 不存在 → JUDGE_CLASS_DIAGRAM_MISSING
PASS  S4 对照 verdict ∈ {pass,reject}（产物齐全正常评判）
PASS  缺陷4 核心：S1-S3 无一 verdict=pass 假通过

=== ALL PASS — 缺陷4 已修复 ===
```

**解读**：
- S1/S2/S3 三种缺失产物场景全部 `ok=false` 返回对应错误码，**verdict=null（非 pass）** — 假通过堵住
- S4 对照（产物齐全）`verdict=pass, hardViolations=0` — Step 2-3 **未误拦**合法场景（puml class Foo ↔ _code/foo.ts export class Foo 一致 → 正常 pass）。此 pass 非假通过，证明修复精准无副作用

---

## 6. typecheck + build 双绿证据

命令（在 `D:/Codes/multi-agent-collab-platform`）：

```bash
$ npm run typecheck    # = tsc --noEmit -p tsconfig.build.json
> multi-agent-collab-platform@1.0.0 typecheck
> tsc --noEmit -p tsconfig.build.json
# (无输出，exit 0)

$ npm run build        # = tsc -p tsconfig.build.json (emit dist/)
> npm run compile
> tsc -p tsconfig.build.json
# (无输出，exit 0)
```

**产物校验**：

```text
dist/src/judge/judge-engine-stub.js  mtime=2026-07-27 21:13:00  ← 本次 build 产物
grep isCodeDirEmpty            → 2 处（定义 + evaluateCode 调用）
grep JUDGE_CODE_NOT_GENERATED  → 5 处（error-codes 定义 + Step2 errorResponse + 其他引用）
grep JUDGE_CLASS_DIAGRAM_MISSING → 4 处
```

修复已编译进 dist 产物，typecheck + build 双绿（exit 0）。

---

## 7. self_check 映射（done event 5 项对照）

| # | 检查项 | pass | evidence |
|---|--------|------|----------|
| 1 | codeDir 不存在 → JUDGE_CODE_NOT_GENERATED | ✅ | 探针 S1 `code=JUDGE_CODE_NOT_GENERATED, ok=false`，Step2 errorResponse 命中 |
| 2 | codeDir 空目录（无源文件）→ JUDGE_CODE_NOT_GENERATED | ✅ | 探针 S2 同码；isCodeDirEmpty 迭代栈扫无 .ts/.js 返回 true |
| 3 | classDiagramPath 不存在 → JUDGE_CLASS_DIAGRAM_MISSING | ✅ | 探针 S3 `code=JUDGE_CLASS_DIAGRAM_MISSING, ok=false`，Step3 existsSync 拦截 |
| 4 | typecheck exit 0 + build exit 0 | ✅ | `npm run typecheck` / `npm run build` 均无报错 exit 0；dist 产物 mtime 21:13 含 isCodeDirEmpty×2 |
| 5 | 探针验证：缺失产物时 verdict≠pass（reject 或 error） | ✅ | S1-S3 verdict 全 null（error 返回），无一 pass；S4 对照产物齐全方 pass |

---

## 8. 改动范围确认（out_of_scope 未碰）

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/judge/judge-engine-stub.ts` | ✅ 改 | evaluateCode L316-318 实装 Step2/3 + 新增 isCodeDirEmpty helper（单文件内） |
| `src/common/error-codes.ts` | ❌ 未碰 | 错误码 CODE_NOT_GENERATED/CLASS_DIAGRAM_MISSING 已就绪（L53-54） |
| `validateEvaluateCodeInput` L406-415 | ❌ 未碰 | 字符串非空校验保持原样（文件系统存在性是 Step 2-3 职责） |
| 缺陷3 runGwt | ❌ 未碰 | R-commander 负责 |
| macp10 树结构 | ❌ 未碰 | root 负责 |
| 新增依赖 | ❌ 无 | 仅用 Node 内置 fs（L31 已 `import * as fs from 'node:fs'`） |

**改动爆炸半径**：单文件（judge-engine-stub.ts），新增 1 私有 helper + 替换 3 行 TODO 为 2 个存在性校验块。无对外接口签名变化，无新依赖，router 层（judgeEngineStub.evaluateCode 调用方）零改动。
