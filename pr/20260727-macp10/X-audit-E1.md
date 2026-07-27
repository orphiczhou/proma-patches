# X-audit-E1 — macp10-E1-worker 缺陷4 修复独立审查

> **审计员**: macp10-X-auditor (MiniMax-M3, 异厂商独立)
> **审计对象**: macp10-E1-worker (GLM-5.2, session=`a86dde96-32cc-420e-8bff-cbcf83f083e1`)
> **审计目标**: 缺陷4 evaluateCode 假通过（judge-engine-stub.ts evaluateCode L316-318 TODO 占位实装 + isCodeDirEmpty helper）
> **审计时点**: 2026-07-27 21:44-21:46 GMT+8
> **审计方式**: 不信任 worker 自证，独立写探针（probe-x-macp10-e1.cjs）+ 跑探针 + 读代码核验 + git diff 范围核查

---

## 一、审计结论

**verdict: pass_with_minor**（audit_log verdict 写法 = "pass_with_minor"，engine audit_gate 写法 = "pass"）

- 修复闭环已落实，缺失产物真拦截（codeDir 缺失/空 → JUDGE_CODE_NOT_GENERATED；classDiagramPath 缺失 → JUDGE_CLASS_DIAGRAM_MISSING）
- 缺失产物时 verdict=null（假通过堵住）
- isCodeDirEmpty helper 正确（迭代栈 / .ts/.js 算源文件 / .d.ts 排除 / node_modules+dist+.git 跳过）
- typecheck/build 双绿
- 我独立写探针 5/5 PASS（与 worker 自报一致）

**1 条 yellow finding（非阻断）**：worker 报告 §5 引用 `.context/trees/macp10/probe/E1-probe.cjs` 但实际**未落盘**（目录为空），worker 自证缺乏独立可复现性。

---

## 二、详细审计 findings

### G1 完整性 — worker 是否覆盖 brief.in_scope 8 项

| # | brief 要求 | worker 实施 | evidence |
|---|----------|-----------|---------|
| 1 | 改 judge-engine-stub.ts evaluateCode L316-318 | ✅ | L316-340 替换 TODO 为实装（Step2 codeDir 检查 + Step3 classDiagramPath 检查） |
| 2 | Step2 fs.existsSync(codeDir) + 空目录判断 → JUDGE_CODE_NOT_GENERATED | ✅ | L320-328 `fs.existsSync(codeDirAbs) \|\| this.isCodeDirEmpty(codeDirAbs)` → errorResponse(JUDGE_ERROR_CODE.CODE_NOT_GENERATED) |
| 3 | Step3 fs.existsSync(classDiagramPath) → JUDGE_CLASS_DIAGRAM_MISSING | ✅ | L332-340 |
| 4 | 缺失产物绝不能 verdict=pass | ✅ | 两处均 `return errorResponse(...)`（早返，不进入 Step 6 verdict 聚合） |
| 5 | 用 Node 内置 fs，必要时加私有 helper | ✅ | L31 已 `import * as fs from 'node:fs'`；新增 isCodeDirEmpty 私有方法（L976-） |
| 6 | 跑探针验证缺失产物真拦截 | ⚠️ | worker 自报 4 场景全 PASS，但探针文件未落盘（详见 G4） |
| 7 | typecheck + build 双绿 | ✅ | 见 §三独立验证 |
| 8 | 写 E-fix-report.md | ✅ | .context/trees/macp10/deliverables/E-fix-report.md 已落盘 |

### G2 一致性 — 修复内部 + 跨文件自洽

- ✅ Step 1 入参校验（validation）→ Step 2/3 存在性校验 → Step 4 runClassConsistencyCheck 链路正确
- ✅ `path.resolve(input.projectRoot, input.codeDir)` 与 `runClassConsistencyCheck` L884 路径语义一致
- ✅ `JUDGE_ERROR_CODE.CODE_NOT_GENERATED` / `JUDGE_CLASS_DIAGRAM_MISSING` 错误码已就绪（错误码定义未改，E-fix-report §2 边界确认正确）
- ✅ validateEvaluateCodeInput L406-415 字符串非空校验与本处文件系统存在性校验职责分明（前者管"字段空"，后者管"文件不存在"，同码 `CLASS_DIAGRAM_MISSING` 语义统一可接受）
- ✅ isCodeDirEmpty 与 collectTsFiles L951-968 拆分合理（前者判"有无源文件"，后者收集 .ts 用于 class 提取），单一职责
- ✅ isCodeDirEmpty L977-998 实现要点：迭代栈防栈溢出；`entry.isDirectory()` 跳过 node_modules/dist/.git；`.d.ts` 排除（类型声明非实现）

### G3 规范性 — 报告 + 实现符合工程规范

- ✅ E-fix-report.md 必含 5 项（根因 + Step2/3 实现 + 探针验证 + typecheck/build + 改动范围确认）全覆盖
- ✅ 决策记录 .note.md 完整（errorResponse vs hardViolation 选择 + helper 设计 + 触发重审条件）
- ✅ 改动爆炸半径控制（单文件 1 个新 helper + 3 行 TODO 替换为 2 个存在性校验块）

### G4 可验证性 — 关键声称可独立复现

| 声称 | evidence | 可复现 |
|------|---------|-------|
| typecheck exit 0 | `tsc --noEmit -p tsconfig.build.json` exit 0（我独立跑 ✅） | ✅ |
| build exit 0 | `npm run build` exit 0 + dist mtime 21:24 | ✅ |
| 探针 4 场景全 PASS | **worker 自报，但探针文件未落盘**（详见 F-E1-Y1） | ⚠️ |
| 我独立写探针 5/5 PASS | probe-x-macp10-e1.cjs 实跑（见 §3.2） | ✅ |

### G5 安全维度 — 路径读取安全（CWE-22 / CWE-73）

**✅ 已审计的输入处理**：
- L320 `path.resolve(input.projectRoot, input.codeDir)`：规范化路径，防 `..` 拼接
- L332 `path.resolve(input.projectRoot, input.classDiagramPath)`：同上
- `fs.existsSync` + `fs.readdirSync`（在 isCodeDirEmpty 内）只读访问，不执行不可信内容

**🟢 安全维度无 yellow/red finding**（evaluateCode 是只读检查，不引入新写入能力）

### 🔵 Yellow findings

| 编号 | finding | severity | 证据 | 修复建议 |
|------|---------|---------|------|---------|
| F-E1-Y1 | **E-fix-report.md §5 引用 `.context/trees/macp10/probe/E1-probe.cjs` 探针文件未落盘**（目录 `.context/trees/macp10/` 下仅 `deliverables/`，无 `probe/` 子目录）。worker 自证"4 场景全 PASS"无法独立第三方复现。这是**自审可观测性缺陷**，非修复正确性问题（我独立写探针 5/5 验证通过） | yellow | `ls -la .context/trees/macp10/` 仅 `deliverables/` 子目录 | E1 worker 应将探针脚本 commit 到 `.context/trees/macp10/probe/E1-probe.cjs`，与 R1 worker 探针（已落盘 `06_TESTS/unit-coder-gwt-autofix.test.ts`）保持同等可复现性 |

---

## 三、独立验证记录

### 3.1 git diff 范围核查

```bash
$ git diff --stat HEAD
 src/judge/judge-engine-stub.ts |  61 +++++++++++++++++-
```

- ✅ E1 只改了 judge-engine-stub.ts 单文件（61 +/-, 含新增 isCodeDirEmpty helper）
- ✅ 未触碰 src/renderer（typecheck 430 错预先存在非本次引入）

### 3.2 我独立写探针（probe-x-macp10-e1.cjs）

> 设计原则：**不复用 worker 自报**，独立写探针逻辑 + 独立断言形状。

```bash
$ node probe-x-macp10-e1.cjs
[probe-X] tmpRoot=C:\Users\sir_c\AppData\Local\Temp\macp10-X-E1-probe-viGK6D
---RAW RESULTS---
{"scene":"S1_codeDir_missing","ok":false,"error":{"code":"JUDGE_CODE_NOT_GENERATED", ... }}
{"scene":"S2_codeDir_empty","ok":false,"error":{"code":"JUDGE_CODE_NOT_GENERATED", ... }}
{"scene":"S3_puml_missing","ok":false,"error":{"code":"JUDGE_CLASS_DIAGRAM_MISSING", ... }}
{"scene":"S4_control","ok":true,"data":{"verdict":"pass","hardViolations":[], ... }}

PASS S1 codeDir 缺失 → ok=false, code=JUDGE_CODE_NOT_GENERATED, verdict=null
PASS S2 codeDir 空目录 → ok=false, code=JUDGE_CODE_NOT_GENERATED, verdict=null
PASS S3 classDiagramPath 缺失 → ok=false, code=JUDGE_CLASS_DIAGRAM_MISSING, verdict=null
PASS S4 控制组 产物齐全 → ok=true, verdict=pass（不误拦）
PASS 缺陷4 核心：S1-S3 verdict 全 null（无假通过）
=== SUMMARY ===
PASS=5 FAIL=0
EXIT=0
```

**结论**：
- ✅ S1-S3 缺失产物全部正确返回对应错误码 + verdict=null（假通过堵住）
- ✅ S4 对照组产物齐全时 verdict='pass'（修复未误拦合法场景）
- ✅ S4 classConsistency.matchedClasses=['Foo']（puml 与 _code/foo.ts 一致）

### 3.3 dist 产物核查

```bash
$ grep -c "isCodeDirEmpty" dist/src/judge/judge-engine-stub.js
2
```

- ✅ dist 产物含 isCodeDirEmpty（1 处定义 + 1 处 evaluateCode 调用）
- ✅ dist 产物 mtime 21:24 是 macp10 build 产物（不是旧 build）

---

## 四、worker 自审 vs 异厂商独立审查差异

| 项 | worker self_check (GLM-5.2) | 我的独立审查 (MiniMax-M3) |
|----|---------------------------|------------------------|
| 5 项自检条目 | 全 pass=true | 我独立探针验证一致 |
| 探针文件路径 | E-fix-report §5 引用 `.context/trees/macp10/probe/E1-probe.cjs` | **该文件实际不存在**，我自写 `probe-x-macp10-e1.cjs` 替代 |
| 安全维度审计 | worker 未做（CWE 清单） | 我做：CWE-22/73 检查 `path.resolve` 规范化正确，无新写入能力 |
| 真实探针结果 | worker 自报 4/4 PASS | 我自写探针 5/5 PASS（多一项核心断言：S1-S3 verdict 全 null） |
| yellow finding | worker 未标 | 我发现 F-E1-Y1（探针未落盘） |

**关键差异**：
1. worker 自审盲区：E1-probe.cjs 引用但未落盘，第三方无法复现 — 靠异厂商 auditor 写新探针兜底
2. worker 安全审计缺位：evaluateCode 是只读检查，安全风险低，但仍应过 CWE 清单确认 — 我补上
3. 我额外加一条核心断言（"S1-S3 verdict 全 null 无假通过"），比 worker 探针更明确验证缺陷4 根因消除

---

## 五、verdict 与给 E1-worker 的 audit_gate

**verdict: pass_with_minor**

依据 §4 阈值表：
- 最高 severity = yellow（F-E1-Y1 探针未落盘，非安全非阻断）
- 无 red/high
- 无 mid 安全 yellow（CWE-204/307/200 未命中）

**engine `tree_audit_gate` 写法**：`verdict="pass"`（yellow 是工程规范类，非安全问题，audit_gate 直接 pass；audit_log verdict 标 "pass_with_minor" 供 SKILL 追溯）

**reason 首句**注：`"等效 pass_with_minor（audit_log verdict），F-E1-Y1 yellow（探针未落盘）待下次 worker commit 补落盘；按 §4.2 阈值表 red=0 yellow=1(非安全) green=N"`

---

## 六、C1 复评贡献（详见 X-c1-revote.md）

E1 修复为 macp10 C1 贡献：
- Judge 业务逻辑 +2（回收 macp6 估扣的 -2，缺陷4 evaluateCode 假通过中 codeDir/classDiagramPath 部分闭环）
- featuresMissingSteps 仍未参与 verdict（macp3 暴露的子问题，macp10 in_scope 外）-2 仍

完整 C1 评估见 **X-c1-revote.md**（macp10 综合 C1 = 79/100, MiniMax-M3 异厂商独立签字，未达 85+ 目标，诚实标注拖分项）。