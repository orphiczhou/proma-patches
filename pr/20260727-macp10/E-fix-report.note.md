---
milestone: M1
topic: defect4-evaluateCode-fix
reversible: true
---

## 可选方案

- A. `errorResponse` 直接返回（语义「无法评判」）
- B. 加 `hardViolation` 使 `verdict=reject`（语义「评判失败」）

## 选择

A — codeDir/classDiagramPath 缺失均用 `errorResponse`

## 理由

codeDir 不存在 = 根本无法跑 class-consistency / gwt-existence，属「前置条件缺失，无法评判」，而非「评判完成发现不达标」。`errorResponse`（ok=false）语义比构造 `reject` verdict 更诚实。classDiagramPath 同理保持一致（避免两套语义混用）。brief 明示「两者都 acceptable，选语义更自洽的」。

## helper 设计决策

- 新增独立 `isCodeDirEmpty`（迭代栈），**不扩展 `collectTsFiles`** — 后者服务于 runClassConsistencyCheck 的 `.ts export class` 提取，单一职责；独立 helper 判断「目录有源文件」爆炸半径最小。
- `.ts`/`.js` 均算源文件（贴合 brief「无 .ts/.js」）；`.d.ts` 不算（类型声明非实现）；跳过 `node_modules`/`dist`/`.git`。

## 触发重审条件

- 若未来 evaluateCode 接口语义变更，要求「缺失产物也必须返回 verdict 结构（非 error 信封）」→ 切换方案 B（hardViolation → reject）。
- 若 `_code/` 产物规范扩展到 `.tsx`/`.jsx`/`.mjs` → 扩展 `isCodeDirEmpty` 扩展名判断。
