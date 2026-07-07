# 洁净室测试观察报告 — macp-cleanroom-20260707

**观察时间**: 2026-07-07 20:07–20:20 GMT+8
**观察者**: Proma Agent（观察员，pro 实例近距离）
**观察对象**: pro commander session `4abf02e6-0e44-451d-a0a2-06c5c8947bda`，测试树 `macp`（因原 tree_id `macp-cleanroom-20260707` 含连字符与 leaf_add 命名规范不一致，commander 重建为 `macp`）
**对比基线**: macp-stab（旧 SKILL + 靠任务指令），24 次 try-and-fix 错误

---

## 1. 最终树状态

| leaf_id | role | status | session_id | events |
|---------|------|--------|-----------|--------|
| `macp-root` | root | active | `4abf02e6...` | brief_echo (mission) |
| `macp-A-commander` | commander | active | `e17f73cb...` | 无（被 nudged 2× C-13） |
| `macp-A1-worker` | worker | **done** | `b0ee69bb...` | brief_echo#1 → brief_echo#2(alignment) → done |

**tree_validate**: **0 issues** ✅（对比 macp-stab 的 audit_log_integrity 假阳性）

**Worker 评估结论**: `test-plan.md` 不包含独立的"审查记录"章节。文档 §0-§7 共 8 章节，结尾引用了不存在的 §4.6。建议补充含审查人/日期/结论字段的审查记录章节。

---

## 2. 错误数对比表（macp-stab vs cleanroom）

| 错误码 | macp-stab (基线) | cleanroom (本次) | 变化 | 说明 |
|--------|:---:|:---:|:---:|------|
| `E_SCHEMA_INVALID` | 3 | **6** | +3 ⬆ | path 数组 vs 字符串混淆×5 + 缺 model×1 |
| `E_DUPLICATE_SESSION_ID` | 3 | **0** | -3 ✅ | **完全消除** |
| `E_AUDIT_PREMATURE` | 3 | **0** | -3 ✅ | **完全消除** |
| `E_BORROWED_IDENTITY` | 3 | **2** | -1 ⬇ | commander 代写 done + worker 代调 audit_gate |
| `E_SELFCHECK_INVALID` | 6 | **0** | -6 ✅ | **完全消除** |
| `E_DELIVERABLE_MISSING` | 3 | **1** | -2 ⬇ | worker 侧 expect_outputs 文件缺 |
| `E_ALIGNMENT_NOT_VERIFIED` | 3 | **1** | -2 ⬇ | root events 空触发 minimum activity guard |
| `E_AUDITOR_NOT_INDEPENDENT` | 0 | **3** | +3 🆕 | **新增错误类型**: milestone_set_result 缺 audit_session_id |
| `E_NAME_INVALID` | 0 | **2** | +2 🆕 | tree_id 含连字符 + prefix 超长 |
| **总计** | **24** | **15** | **-9 (-37.5%)** | |

### 按分类汇总

| 分类 | macp-stab | cleanroom | 变化 |
|------|:---:|:---:|:---:|
| 身份/借用错误 (DUPLICATE, BORROWED, AUDITOR) | 6 | 5 | -1 |
| Schema/命名错误 | 3 | 8 | +5 ⬆ |
| Worker 生命周期错误 (SELFCHECK, DELIVERABLE) | 9 | 1 | -8 ✅ |
| 对齐错误 (ALIGNMENT, PREMATURE) | 6 | 1 | -5 ✅ |

---

## 3. 五个修复效果评估

### 修复 1: self_check schema 摩擦（vs macp-stab 6×E_SELFCHECK_INVALID）

**效果**: ✅✅✅ **完全修复**

- cleanroom: **0 次** E_SELFCHECK_INVALID
- Worker 的 done event 使用新模板 `self_check: [{item, pass, evidence}]`，一次通过，无 schema 摩擦
- 新 evidence 模板（`"item": "M1: 确认审查记录章节存在性", "pass": true, "evidence": "..."`）与 MCP schema 完全对齐

**证据**（来自 tree event）:
```json
"self_check": [
  {"item": "M1: 确认审查记录章节存在性", "pass": true, "evidence": "已读取 test-plan.md (264行)..."},
  {"item": "M2: 审查记录字段完整性检查", "pass": true, "evidence": "因审查记录章节不存在..."},
  {"item": "M3: 评估报告输出", "pass": true, "evidence": "评估结论：test-plan.md 审查记录章节不完整..."}
]
```

### 修复 2: tao-watcher audit_log "undefined" 假阳性

**效果**: ✅✅✅ **完全修复**

- tree_validate(macp): **0 issues**（对比 macp-stab 的 audit_log_integrity 假阳性）
- audit_log 条目均含正确的 auditor、rule_id、pass、evidence 字段，无 "undefined" 值
- 即使 tao-watcher 对 commander（C-13：审计场景需 ≥4 审查者）和 worker（W-01：首条消息无 brief_echo；R-06：done 后无独立验证 leaf）产生了 audit_log 条目，tree_validate 未报 audit_log_integrity 问题

### 修复 3: root alignment_pending

**效果**: ✅✅✅ **完全修复**

- macp-root: `alignment_pending: false` ✅
- macp-A1-worker: `alignment_pending: false` ✅
- 对比 macp-stab：root alignment_pending=true 未清理 → 现在已修复

### 修复 4: SKILL §13.7 速查表 + §13.3 前置条件表

**效果**: ⚠️ **未生效（SKILL 未部署到 pro 实例）**

- Commander 在 `~/.proma/agent-workspaces/default/skills/tree-commander/SKILL.md` 未找到 SKILL
- 随后在 `.proma-dev` 路径找到 SKILL，但**没有 §13**（旧版 SKILL）
- Commander 明确报告："SKILL 里没有 §13。让我读 §5 工具速查和 §12 命名规范"
- **结论**: 新 SKILL（含 §13）未部署到 pro 实例的测试环境。Commander 靠旧 SKILL §5 + §12 + help topics 完成了任务

### 修复 5: help topic 覆盖度

**效果**: ✅✅ **有效但可增强**

Commander 在本轮测试中成功使用了以下 help topics：
- `how_to_init` — 建树流程（被调用）
- `how_to_worker_lifecycle` — worker 生命周期（被调用）
- `naming_convention` — 命名规范（被调用，解决了 E_NAME_INVALID）
- `alignment_workflow` — cold-start 模式（被调用，解决了 alignment 回填）
- `role_semantics` — 角色语义（推测被调用，理解 root vs commander vs worker）

**但以下错误未被 help topic 覆盖，产生了摩擦**：
- path 格式（字符串 vs 数组）：5 次 E_SCHEMA_INVALID 的根因—**需要 help topic**
- milestone_set_result 需要 audit_session_id：3 次 E_AUDITOR_NOT_INDEPENDENT 的根因—**已在 SKILL §13.3 前置表覆盖但未部署**
- tree_init 与 leaf_add 命名规则不一致（tree_init 允许连字符但 leaf_add 不允许）—**系统级一致性问题**

---

## 4. 新发现问题 + 改进建议

### 4.1 E_SCHEMA_INVALID 上升（3→6）：path 格式混淆

**问题**: Commander 花了 5 轮尝试理解 path 必须是字符串（如 `"A1"`）而非数组。MCP 的类型系统把 JSON 字符串 path 转换成了数组，增加了调试难度。

**建议**: 
- 新增 help topic `how_to_path_format`，明确 path 格式：`"A1"`（字符串，非数组）
- leaf_add 的 MCP schema description 显式标注 path 为 string

### 4.2 E_AUDITOR_NOT_INDEPENDENT：新增错误类型

**问题**: milestone_set_result 需要显式传 `audit_session_id`，commander 3 次未传。在 macp-stab 中这个错误被归入 E_BORROWED_IDENTITY 或未触发（因为 macp-stab 可能没走到 milestone 审计阶段）。

**建议**: 
- SKILL §13.3 前置条件表应包含 milestone_set_result 的 audit_session_id 要求
- help topic `how_to_worker_lifecycle` 或新 topic `how_to_milestone_audit` 应覆盖此要求
- 考虑 milestone_set_result 若调用者 session_id 与 milestone 所在 leaf 的 parent 的 session_id 一致时自动通过，减少摩擦

### 4.3 tree_init vs leaf_add 命名不一致

**问题**: `tree_init` 允许 tree_id 含连字符（如 `macp-cleanroom-20260707`），但 `leaf_add` 的 prefix 校验禁止连字符。Commander 被迫重建树。

**建议**: 
- 统一 tree_init 和 leaf_add 的命名校验规则
- 或在 tree_init 时提前警告 tree_id 会影响后续 leaf_add
- help topic `naming_convention` 应覆盖 tree_id 的约束

### 4.4 SKILL 部署问题

**问题**: 新 SKILL（含 §13 冷启动流程 + §13.3 前置条件表 + §13.7 错误码速查表）未部署到 pro 实例。Commander 找到了旧版 SKILL（`.proma-dev` 路径），但无 §13。

**建议**: 
- 部署新 SKILL 到 pro 实例后再跑一次验证测试
- 对比"有 §13"vs"无 §13"的错误分布差异，量化 §13 的价值

### 4.5 Tao-watcher nudges

**问题**: 
- C-13（mid×2）: "审计场景下 commander 仅有 1 个 worker 子 leaf（需 ≥4 独立审查）" — 对小任务来说过于激进
- W-01（high）: "worker 首条 assistant 消息无 brief_echo" — 时序问题（brief_echo 在 worker 处理中稍后才写）
- R-06（low）: "worker 已 done 但无独立验证 leaf" — 小任务不需要独立验证

**建议**: 
- 增加小任务模式（≤3 milestones），放宽 C-13 和 R-06 的阈值
- W-01 增加 grace period，给 worker 写 brief_echo 的窗口期

---

## 5. SKILL §13 可执行性评估

### 评估结论: **Commander 靠自己完成了任务，但未用到 §13**

| 维度 | 评估 | 说明 |
|------|------|------|
| SKILL §13 可用性 | ❌ 不可用 | pro 实例上的 SKILL 无 §13 |
| help topics 作为替代 | ✅ 有效 | 4 个 topic 提供了足够的流程知识 |
| 错误自恢复能力 | ✅✅ 强 | 15 次错误后均成功修复，无卡死 |
| 最终交付质量 | ✅✅✅ 完美 | worker done, 3 milestones 全 pass, audit_gate pass, 0 validation issues |
| 对比 macp-stab（靠任务指令） | 相当 | cleanroom 完成时间 ~13min (20:07→20:20)，macp-stab ~20min；cleanroom 总 token 83K+24K，macp-stab 预估 ~120K+50K |
| 缺少 §13 的代价 | ~3-5 次可避免错误 | E_AUDITOR_NOT_INDEPENDENT(×3)、部分 E_NAME_INVALID 可通过前置表避免 |

### 假设：若 §13 可用，预估总错误数

| 场景 | 预估错误数 |
|------|:---:|
| 无 §13（本次实测） | 15 |
| 有 §13.7 速查表 | ~12（减少 E_SCHEMA_INVALID 的 path 问题 + E_AUDITOR_NOT_INDEPENDENT） |
| 有 §13.3 前置表 | ~10（额外减少 E_ALIGNMENT_NOT_VERIFIED 和部分 BORROWED_IDENTITY） |
| 有完整 §13 + help topics | ~8（接近"靠任务指令"的 macp-stab 水平，但错误类型更良性） |

---

## 6. 总结

### 确认修复的 3 项
1. **self_check schema**: 0 次 E_SELFCHECK_INVALID（vs 6），新模板完美工作 ✅
2. **tao-watcher "undefined" 假阳性**: tree_validate 0 issues ✅
3. **root alignment_pending**: false ✅

### 未确认的 1 项
4. **SKILL §13.7/§13.3**: 未部署到 pro 实例，无法评估 ⚠️

### 部分确认的 1 项
5. **help topics**: 有效覆盖建树、命名、对齐流程，但 path 格式和 milestone 审计仍需补充

### 新发现
- 3 种新型错误（E_AUDITOR_NOT_INDEPENDENT×3, E_NAME_INVALID×2, path 数组混淆×5）
- tree_init/leaf_add 命名规则不一致（系统级问题）
- Tao-watcher 对小任务过于敏感

### 下一轮建议
1. **立即**: 部署新 SKILL（含 §13）到 pro 实例，重跑 cleanroom 测试
2. **短期**: 新增 help topic `how_to_path_format` 和 `how_to_milestone_audit`
3. **中期**: 统一 tree_init/leaf_add 命名校验；tao-watcher 增加小任务模式
4. **验证**: 有 §13 后再跑一轮，目标错误数 <8
