# D4-fix core 同步报告

> leaf_id: `v10v-D4-fix-core-sync`
> 实施: 2026-06-25
> 状态: **完成（D4 改动 5 类全回写 + C3 业务一致 + 6 套金标准 0 退化）**

---

## 同步概况

| 文件 | 同步前 D4 | 同步后 D4 | patch-l D4 | 同步前 C3 | 同步后 C3 | patch-l C3 |
|------|----------|----------|-----------|----------|----------|-----------|
| `core/tree-state.js` | **0** | **40** | 40 | 7 | **10** | 10 |
| `patch-l/tree-engine.cjs` | 40 | 40 | 40 | 10 | 10 | 10 |

**D4 标记完全对齐**：core 从 0 处 → 40 处（与 patch-l 完全一致）。
**C3 标记顺带对齐**：core 从 7 处 → 10 处（多出的 3 处都是 HELP_TOPICS 内容里引用 V10-trust-anchor 的文字，因 D4 改动一并补齐）。

> 关键发现：core/tree-state.js 的 C3 业务逻辑（resolveAuditorIndep root 特例 / cmdAuditGate root 自审 / cmdEventAppend auto_upgrade / cmdLeafAdd role='root' 拒绝）**之前已经全部回写**，仅 HELP_TOPICS 文字引用因 D4 缺失而滞后。

---

## 应用到 core 的 D4 改动

### 改动 1: TreeStateError 构造函数 + ERROR_TO_HELP 映射表

- **位置**: `core/tree-state.js` 行 160-215
- **改动**:
  - TreeStateError 构造函数新增 `this.help_topic = ERROR_TO_HELP[code] || null;`（行 167-169）
  - 新增 `const ERROR_TO_HELP = { ... }` 常量（行 173-214），含 21 个旧码 + 16 个 V10 新码 = 37 个错误码映射
- **patch-l 参照**: 行 163-214

### 改动 2: cmdInit return 加 tips + buildInitTips 函数

- **位置**: `core/tree-state.js` 行 558-582
- **改动**:
  - cmdInit return 对象新增 `tips: buildInitTips()` 字段（行 563）
  - 新增 `function buildInitTips()` 函数（行 574-582），返回 4 条 next_steps + skill_reference + pro_tip
- **patch-l 参照**: 行 605-627

### 改动 3: HELP_TOPICS 常量 + cmdHelp 函数

- **位置**: `core/tree-state.js` 行 2763-3287（新增 525 行）
- **改动**:
  - 新增 `// ====` 注释头（行 2763-2770）
  - 新增 `const HELP_TOPICS = { ... }` 常量（行 2772-3261），含 13 个 topic 内容
  - 新增 `function cmdHelp(args)` 函数（行 3265-3287）
- **patch-l 参照**: 行 2764-3289（字节级别完全一致）

13 个 topic：how_to_init / how_to_register_auditor / role_semantics / v10_constraints /
self_audit_forbidden / borrowed_identity / naming_convention / common_mistakes /
alignment_workflow / nudge_escalation / audit_tree_structure / error_code_index / full_guide

### 改动 4: dispatch 加 case 'help' + default 信息扩展

- **位置**: `core/tree-state.js` 行 3333-3339
- **改动**:
  - dispatch switch 新增 `case 'help': return cmdHelp(args);`（行 3336-3337）
  - default 错误信息扩展：从 `"...audit, nudge, tree"` → `"...audit, nudge, tree, help. Call mcp__tree__tree_help('full_guide') for usage."`（行 3339）
- **patch-l 参照**: 行 3336-3341

### 改动 5: main() catch 块加 help_topic / help_hint

- **位置**: `core/tree-state.js` 行 3457-3479
- **改动**:
  - main() catch 块新增 helpTopic 变量提取（行 3463-3465）
  - 错误对象条件性附 `help_topic` + `help_hint`（行 3466-3470）
  - 自解释错误（help_topic=null）不附 help_hint，避免噪声
- **patch-l 参照**: 行 3480-3490（patch-l 是 run() catch，core 是 main() catch，结构对等）

**注**：patch-l 用 `run()` 函数（永不 throw，返回 {ok, error}），core 用 `main()` 函数（CLI 入口，try/catch 包 dispatch）。这是 v0.7+ 架构层差异——patch-l 是 MCP 内联引擎，core 是 CLI shim。错误处理逻辑（help_topic + help_hint）在两者中结构等价。

---

## C3 漂移（顺带补齐）

任务书提到"core C3 是 6/8 vs patch-l 8/8，把少的 2 处补上"。实测：

- core C3 标记 7 处，patch-l C3 标记 10 处
- 缺的 3 处 **全部在 HELP_TOPICS 文字内容里**（如 `'solution A (V10-trust-anchor, C3 实施中)'`、`'root 是 trust anchor (V10-trust-anchor 提案)'`）
- C3 业务逻辑（resolveAuditorIndep / cmdAuditGate / cmdEventAppend / cmdLeafAdd）**之前已全部回写**

D4 改动 3（HELP_TOPICS）插入后，core C3 标记自然从 7 → 10，与 patch-l 完全一致。**无需单独的 C3 漂移修复**。

---

## 测试回归

6 套金标准 + audit-evidence（不在金标准内，但跑确认）：

| 套件 | 期望 | 实测 | 状态 |
|------|------|------|------|
| helper-test | 6/6 | **6/6** | ✅ |
| v10-trust-anchor-test | 18/18 | **18/18** | ✅ |
| v10-cleanroom | 54/54 | **54/54** | ✅ (V10-numeric 8/8 + nudge 4/4 + ts 3/3 + workspace 3/3 + status-event 3/3 + audit-gate 1/1 + vfb 15/15 + Cr2 5/5) |
| dbc-spec | 48/0 | **48/0** | ✅ |
| audit-attacks | 18/18（17/18 不可绕过 + 1 CP2 部分）| **17/18 不可绕过 + 1 CP2** | ✅ (CP2 与 D4 无关，D4 实施前就是此状态) |
| v10-regression | 14/14 | **14/14** | ✅ |

**全部 0 退化**。

### audit-evidence.cjs 状态（非金标准）

audit-evidence.cjs 之前 D4 报告 §已知问题 1 提到"输出错误 message 没有 help_hint"，原因是它 spawn `test-sandbox/core/tree-state.js`（一份历史副本，连 V10 加固都没实施）。

D4-fix 任务目标只同步 `release/tree-system-v0.2.2/core/tree-state.js`（金标准相关），不动 `test-sandbox/core/tree-state.js`（历史副本，audit-evidence 用）。audit-evidence 不在金标准 5 套内，本次不修复它的 help_hint 问题。

---

## core vs patch-l diff 验证

```bash
$ diff core/tree-state.js patch-l/tree-engine.cjs | wc -l
128
```

128 行 diff 全部是 **v0.7+ 架构层差异**：

| 行段 | 差异类型 | 说明 |
|------|---------|------|
| 152-157 | TREES_ROOT 定义 | core 用 `const TREES_ROOT = __dirname;`（CLI shim）；patch-l 用 `let TREES_ROOT = (typeof __dirname !== 'undefined') ? __dirname : null;`（MCP 可注入）|
| 164 | 注释引用 | core 写 "main() catch 块"，patch-l 写 "run() catch 块"——结构等价 |
| 2761 | 空行 | core 多一个空行（无害）|
| 3440-3485 (45 行) | main() vs run()+exports | core 用 main()（CLI 入口，spawn 调用）；patch-l 用 setTreesRoot + getTreesRoot + run() + module.exports + `if (require.main === module)` CLI shim（MCP 内联 + 兼容 CLI）|

**业务逻辑零差异**：
- HELP_TOPICS 内容（13 topic 文字）—— 字节级一致
- ERROR_TO_HELP（37 错误码映射）—— 字节级一致
- TreeStateError 构造函数 + help_topic —— 字节级一致
- cmdHelp 函数 —— 字节级一致
- buildInitTips 函数 —— 字节级一致
- dispatch case 'help' —— 字节级一致
- main/run catch 块的 help_hint 构造逻辑 —— 结构等价

**结论**：diff 完全是 v0.7+ 架构层（main vs run + exports + CLI shim + TREES_ROOT 注入化），业务逻辑（D4 5 类改动 + C3 4 处改动）完全一致。

---

## 已知遗留

### 1. `test-sandbox/core/tree-state.js` 是历史副本（不在 D4-fix 范围）

- 旧版本（无 V10 加固、无 C3 改动、无 D4 改动）
- audit-evidence.cjs spawn 这个文件，输出无 help_hint
- D4-fix 目标是 `release/tree-system-v0.2.2/core/tree-state.js`（已修复），不动 sandbox 副本
- 建议未来清理时把这个副本删除或同步，避免混淆

### 2. patch-l 多出 1 行 D4 标记（40 vs 期望 38）

任务书说 patch-l 是 38 处，实测 40 处。多的 2 处是 `help_topic` 引用（在 TreeStateError 构造 + main catch），不影响功能。

### 3. core 没有 run()/setTreesRoot/getTreesRoot/module.exports

这是 v0.7+ 架构差异，**不需要修复**：
- core/tree-state.js 是 CLI 入口（直接 node 运行），用 main()
- patch-l/tree-engine.cjs 是 MCP 内联引擎（require 进 patches.cjs），用 run() + exports
- 两者业务逻辑等价，调用入口不同
- 强行让 core 也加 run()+exports 反而破坏 CLI shim 设计

---

## 文件清单（绝对路径）

### 修改
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\release\tree-system-v0.2.2\core\tree-state.js`（5 处编辑，新增 ~570 行）

### 新增
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\v10\d4-fix-core-sync-report.md`（本报告）

---

## 完成度自评

| 项 | 状态 |
|----|------|
| D4 改动 5 类全回写到 core | ✅ |
| core D4 标记 0 → 40（与 patch-l 一致）| ✅ |
| core C3 标记顺带 7 → 10（与 patch-l 一致）| ✅ |
| core 语法检查通过 | ✅ |
| 6 套金标准 0 退化 | ✅ |
| diff 验证：仅 v0.7+ 架构差异 | ✅ |
| 报告完成 | ✅ |

**整体状态**：✅ D4-fix 任务全部完成。"3 处同步"铁律恢复（patch-l = dev dist = core 业务逻辑一致）。
