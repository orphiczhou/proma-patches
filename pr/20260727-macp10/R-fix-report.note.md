---
milestone: M1
topic: defect3-rungwt-autofix-patch
reversible: true
---

# 决策记录 — 缺陷3 runGwt autofix 假修复

## 可选方案与选择

### patch 格式：块格式 vs unified diff
- **选择**：块格式 `<<<FILE:path>>><<<CONTENT>>><<<END>>>`
- **理由**：正则解析简单、确定性高；LLM 直接输出完整文件内容，避免 diff hunk 应用歧义（行号漂移/上下文不匹配）；零新增依赖（unified diff 需引入 diff 库或手写 hunk 应用器，越出 "无新增依赖" 边界）。

### patch 应用失败处置：break vs continue
- **选择**：`break` + `autofixLog` 记 `patchError`
- **理由**：patch 失败意味着 LLM 输出不符合契约，重跑 GWT 必得相同失败（浪费一次 spawn 配额且不改变结果）；break + patchError 让上层明确感知，审计可从 `autofixLog[i].patchError` 追溯每轮失败原因，优于静默 continue 的假收敛。

### `patchError` 字段：AutofixLogEntry 可选字段 vs 新类型
- **选择**：`AutofixLogEntry.patchError?: string`（可选字段）
- **理由**：向后兼容既有 `autofixLog` 消费者（generateCode 链等无需改动）；api-spec §2.4 输出 Schema 透传可选字段不破坏契约。

## 触发重审条件

- 若 LLM 在固定块格式下解析成功率 < 70%（线上 patchError 频次过高）→ 考虑加 fallback unified diff 支持，或强化 `buildGwtAutofixPrompt` 格式约束。
- 若 `patchError` 占 autofixLog 比例 > 30% → 复查 prompt 是否给出足够失败上下文（stderr/features）。

## 内联自审（worker 会话无内置 SubAgent 工具，按 worker-self-audit-no-subagent 范式走内联 G1-G3 + 硬证据，未伪造 review_round）

| 视角 | 检查 | 结果 | 证据 |
|---|---|---|---|
| G1 完整性 | brief.in_scope 7 项是否全实现 | ✅ | R-fix-report.md §10 self_check 5 项逐条对账；types.ts 扩展 + applyGwtAutofixPatch + 主循环改造 + buildGwtAutofixPrompt 指令 + 探针 + 双绿 |
| G3 可执行性 | 能否真跑通（治假修复） | ✅ | 探针 `unit-coder-gwt-autofix.test.ts` 2 用例全过（文件写入精确匹配 + spawnIsolated 2 次/1 次）；typecheck+build exit 0 |
| G5 格式合规 | dod.deliverables.must_contain + quality_gate | ✅ | must_contain 5 项 grep 全 [OK]；quality_gate 双绿（tsconfig.build.json 配置） |

## out_of_scope 边界确认

- 未改 `evaluateCode`（缺陷4，macp10-E1-worker 负责）
- 未改 macp10 树结构（root 负责）
- 零新增第三方依赖（仅用 node:fs / node:path / 已有 existsPath）
- 改动文件：types.ts、coder-engine-stub.ts、新增 unit-coder-gwt-autofix.test.ts（均在 in_scope 内）
