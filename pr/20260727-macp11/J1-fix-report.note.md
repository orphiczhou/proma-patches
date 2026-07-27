# J1-fix-report 决策笔记 — G3 方案选型 + F-E1-Y1 探针落盘时序

---
milestone: m2
topic: g3-fix-decisions-and-probe-timing
reversible: true
---

## F-E1-Y1 探针先落盘再写报告时序（本 note 核心约束）

**规则**：worker 写探针后必须**先确认探针已落盘**（捕获 mtime），**再**写 fix-report / note，确保报告引用的探针路径在报告成文时已真实存在（治既往"报告写了但探针没落盘"的时序缺陷）。

**执行证据**（本 leaf 实际时序）：

| 步骤 | 动作 | mtime |
|---|---|---|
| 1 | Write `probe-macp11-j1.cjs` 到项目根 | **2026-07-27 22:36:54** (+08:00) |
| 2 | typecheck + build（探针在产物之前已落盘） | build 产物 dist/ 22:38 |
| 3 | 跑 `node probe-macp11-j1.cjs` → 17 断言全 PASS | exit 0 |
| 4 | Write `J1-fix-report.md`（主报告引用探针路径） | 22:4x（晚于探针） |
| 5 | Write `J1-fix-report.note.md`（本文件，note 自己 mtime 见下方） | 22:4x（最晚） |

**探针路径**：`D:/Codes/multi-agent-collab-platform/probe-macp11-j1.cjs`（项目根，size=8828 bytes）
**探针 mtime**：`2026-07-27 22:36:54.789816800 +0800`
**note 自己 mtime**：`2026-07-27 22:40:04.001775800 +0800`（成文于步骤 5，晚于探针 22:36:54 约 3 分 10 秒，证明"先落盘"时序成立）。时序链：probe 22:36:54 < J1-fix-report.md 22:39:28 < note 22:40:04。

> 引擎/审计复核可 `ls -la --time-style=full-iso D:/Codes/multi-agent-collab-platform/probe-macp11-j1.cjs` 验证探针 mtime 早于本 note mtime。

---

## G3 三 yellow 方案选型

### F-R1-Y1 match[2] undefined 防御

**可选方案**：
- A. 可选链 `(match[2] ?? '').replace(...)`（最小改动，空串兜底）
- B. if 守卫 `if (match[2]) { ... } else { continue/return error }`（改控制流）
- C. 非空断言 `match[2]!.replace(...)`（不安全，治标不治本）

**选择**：A（可选链兜底）

**理由**：block 正则 `([\s\S]*?)` 保证 match[2] 正常路径必为 string（可空串），undefined 仅极端异常输入。A 不改控制流、不破坏现有 patch 应用语义（空串走原逻辑），符合"防御编程"最小侵入原则。B 引入新 error 分支超出"加防御"范围；C 掩盖问题。

### F-R1-Y2 appliedFiles 透传

**可选方案**：
- A. AutofixLogEntry 加 `appliedFiles?: string[]`（可选字段），push 处透传 patchRes.appliedFiles
- B. 复用现有 patchError 字段塞 appliedFiles（字符串拼接）
- C. 新增独立 AppliedFilesLog 类型

**选择**：A

**理由**：applyGwtAutofixPatch 已返回 `{ appliedFiles, error? }`（数据源已存在），只需在 log entry 开个可选字段透传 —— 增量、类型安全、向后兼容（旧消费者不读 appliedFiles 不受影响）。B 破坏类型语义；C 过度设计。

### G1 SoftSuggestion schema 适配（关联 G3 的"按源码真实 schema"原则）

brief 伪代码 softSuggestions 项 `{rule,severity,message}` 与真实 `SoftSuggestion` schema `{dimension,targetPath,message,score}` 不符。按真实 schema：dimension=`testability`（step 缺失属可测试性维度），score=`featuresWithSteps/featuresTotal`（覆盖度）。**未越 out_of_scope**（schema 适配是"按源码真实字段名调整"，非重构）。

---

## 触发重审条件

- 若 macp11-X-auditor 复核认为 GWT_STEPS_MISSING 阈值（>50% reject / ≤50% suggest）应调整 → 重审阈值常量（当前硬编码 0.5）
- 若 SoftSuggestion.dimension 应改 `completeness`（完整性）而非 `testability` → 重审维度选型
- 若 appliedFiles 应为必填（非可选）→ 需确认所有 push 路径都能提供，重审可选性

---

## 关联

- 主报告：`J1-fix-report.md`（G1 verdict 聚合 + G3 改动详情 + 三验证结果）
- 探针：`D:/Codes/multi-agent-collab-platform/probe-macp11-j1.cjs`
