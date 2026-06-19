# C4 证据审查 — tree-system-v0.2.0 可验证性问题报告

> 审查者: tree-worker (leaf: sq_audit-C4-evidence)
> 审查时间: 2026-06-19 18:29 GMT+8
> 审查会话: `2b6abf19-88d4-4f3c-bbad-8a01cf29bdf1`
> 审查方法: MCP session 工具实际查询 + 静态代码分析 + 文档交叉比对

---

## 审查摘要

| 维度 | 结果 |
|------|------|
| 审查的 session ID 总数 | 18 (3报告直接声明 + 5 L2子会话 + 10 B任务 tree-state.json) |
| 可验证 session 数 | 5 (全部来自 v01-real-test-report) |
| 不可验证 session 数 | 13 (B任务全部 + S1重测) |
| tree-state.json 可查 | 2/3 (bverify 存在, real 存在, pguide 已删除) |
| validate() 代码-文档一致性 | 5/5 检查项匹配, 1 处注释矛盾 |
| README/QUICKSTART CLI 准确性 | 2 处命令格式错误 |

---

## 问题列表

### E-01 | B任务指挥官 session 不可查

| 字段 | 值 |
|------|-----|
| **定位** | `verification-reports/b-verify-report.md:4` |
| **严重程度** | **阻断** |
| **描述** | 报告声称指挥官 session_id 为 `63b4e61a-5b0e-479a-82e9-0cbb481a30d8`。通过 `mcp__session__get_session_info` 和 `mcp__session__list_sessions(include_archived=true)`（共 134 个 session）查询，该 ID 不存在于当前实例。通过 `mcp__remote-session__remote_list_sessions(instance=release)` 查询同样不存在。报告声称该 session 在 GLM-5-Turbo 频道（`proma-official` 或 ZLM 频道）运行，但该频道的 session 在当前 DeepSeek 实例中不可访问。 |
| **证据** | `get_session_info("63b4e61a...")` → `"Session not found"`；`list_sessions(include_archived=true)` 无此 ID；`remote_list_sessions(instance=release)` 无此 ID |
| **修正建议** | 1) 若 B 任务确实在 GLM 频道执行，报告应明确标注"跨频道 session，无法从当前实例验证"；2) 建议在报告中附上 GLM 频道的 session 查询截图或导出作为旁证；3) 未来跨频道验证应在同报告内提供可交叉验证的引用 |

### E-02 | S1 重测执行 session 不可查 + tree-state.json 已销毁

| 字段 | 值 |
|------|-----|
| **定位** | `verification-reports/v01-retest-report.md:4` |
| **严重程度** | **阻断** |
| **描述** | 报告声称执行者 session 为 `b01c8a3f-cb8c-4c06-ada4-d2a89672a3e4`（Release 实例）。该 session 在实例的 134 个 session 中不存在。同时，报告 §清理 步骤声明已删除 `pguide/` 目录，tree-state.json 已不存在（验证确认 `pguide/tree-state.json` 为 NOT FOUND）。**这意味着 S1 重测的全部证据链已断裂**：无 session 可查、无 tree-state.json 可交叉验证。报告的 25 命令全部通过声称仅剩报告本身的断言。 |
| **证据** | `get_session_info("b01c8a3f...")` → `"Session not found"`；`list_sessions` 无此 ID；`pguide/tree-state.json` → NOT FOUND |
| **修正建议** | 1) 若为"Release 实例接替指挥官执行"，需说明为何 session 在实例列表中消失（是否被永久删除？）；2) 测试清理步骤应保留 tree-state.json 备份（至少保留一份 `--label s1-final` 的手动备份）；3) **强烈建议**重新执行 S1 测试并保留完整证据链后再宣称"全部通过" |

### E-03 | B 任务 10 个子会话 session 全部不可查

| 字段 | 值 |
|------|-----|
| **定位** | `verification-reports/b-verify-report.md:36-44`（子会话侧表格） |
| **严重程度** | **严重** |
| **描述** | bverify tree-state.json 中记录了 10 个 leaf 的 session_id（4 done + 6 archived），但所有 10 个 session 通过 `get_session_info` 均返回 "Session not found"。这些 session 在 GLM-5-Turbo 频道创建，在当前 DeepSeek 实例中不可访问。tree-state.json 是这些 session 存在过的**唯一证据**。 |
| **证据** | 10 个 session ID（`287c202f`, `6757d2fb`, `6696432d`, `fe3d3219`, `6a5df822`, `33acafa9`, `d33ee67a`, `e82a5b14`, `7e3fc4da`, `f33b6d71`）全部返回 "Session not found" |
| **修正建议** | 1) B 任务报告应声明"子会话在 GLM-5-Turbo 频道创建，跨频道无法从 DeepSeek 实例查询"；2) tree-state.json 作为唯一证据，其备份应与报告一起归档；3) 考虑在报告附录中列出所有 sub-session ID |

### E-04 | b-verify-report 未列出子会话 session ID

| 字段 | 值 |
|------|-----|
| **定位** | `verification-reports/b-verify-report.md:36-44` |
| **严重程度** | **严重** |
| **描述** | 报告子会话侧表格列出了 4 个成功 leaf 的指标（频道、SKILL 读取、brief_echo、产出字数等），但**未列出任何 session ID**。第三方读者无法从报告直接追溯到具体 session。需通过读取 `bverify/tree-state.json` 才能间接获取 session ID，且这些 session 在 GLM 频道不可查。 |
| **证据** | 报告 §执行结果 > 子会话侧 表格仅含指标列，无 session_id 列；对比 L2 报告同位置明确列出了 3 个子会话的 session_id |
| **修正建议** | 在子会话侧表格中增加 `session_id` 列（参照 v01-real-test-report.md 的格式）；至少列出最终成功代（i4）的 4 个 session ID |

### E-05 | v01-retest-report 缺少子会话 session ID + 全部证据已销毁

| 字段 | 值 |
|------|-----|
| **定位** | `verification-reports/v01-retest-report.md` 全文 |
| **严重程度** | **严重** |
| **描述** | 报告声称 3 个 leaf（A/B/F）全部 done、25 命令全部通过，但：1) 未列出任何子会话的 session ID；2) pguide 目录已删除，无法从 tree-state.json 交叉验证任何声称；3) 指挥官 session `b01c8a3f` 不可查。该报告的**全部关键声称均无法被第三方验证**。 |
| **证据** | 报告无 sub-session ID；`pguide/tree-state.json` 不存在；`b01c8a3f` session 不可查 |
| **修正建议** | 1) 重新执行 S1 测试，保留完整证据链（含 tree-state.json 备份）；2) 在新报告中列出所有 sub-session ID；3) 清理步骤不应删除 tree-state.json 的所有备份 |

### E-06 | README.md 快速开始命令与 tree-state.js 实际接口不匹配

| 字段 | 值 |
|------|-----|
| **定位** | `README.md:41-46` |
| **严重程度** | **严重** |
| **描述** | README "快速开始" 中的 CLI 命令与 tree-state.js 实际接口不一致：1) 第 41-42 行 `node core/tree-state.js init mytree "我的第一个树形任务"` — 实际 `init` 命令要求 `--root-brief '<json>' --root-dod '<json>'` 两个必选 JSON 参数，此命令会失败；2) 第 46 行 `node core/tree-state.js validate` — 缺少必需的 `<tree_id>` 参数，会直接报错。用户按照 README 操作无法完成快速开始。 |
| **证据** | `tree-state.js:408` init 签名: `init <tree_id> --root-brief '<json>' --root-dod '<json>' [--audit-meta '<json>']`；`tree-state.js:1212-1213` validate 签名: `validate <tree_id>` |
| **修正建议** | 修正 README 命令示例，使与 tree-state.js 实际 CLI 一致：`node core/tree-state.js init mytree --root-brief '{"parent_intent":"..."}' --root-dod '{"deliverables":[]}'` 和 `node core/tree-state.js validate mytree` |

### E-07 | QUICKSTART.md CLI 命令与实际接口不匹配

| 字段 | 值 |
|------|-----|
| **定位** | `QUICKSTART.md:21,57-58` |
| **严重程度** | **严重** |
| **描述** | QUICKSTART 中的命令与实际接口严重不符：1) 第 21 行 `node tree-state.js init mydemo "demo"` — 与 README 同样的问题，缺少 `--root-brief`/`--root-dod`；2) 第 57-58 行 `node tree-state.js leaf add mydemo-A-draft root "xxx-xxx-A" draft deepseek-v4-pro` — 实际 `leaf add` 只需要 `<tree_id>` 一个位置参数，leaf 数据通过 `--json '<json>'` 传入，JSON 包含 `{leaf_id, session_id, parent, path, role, model, channel}`。 |
| **证据** | `tree-state.js:463-464` leaf add 签名: `leaf add <tree_id> --json '<leaf_initial_json>'`，JSON 必填字段: `leaf_id, session_id, parent, path, role, model, channel` |
| **修正建议** | 重写 QUICKSTART 命令示例以匹配实际 CLI 签名 |

### E-08 | tree-state.js validate() 注释自相矛盾

| 字段 | 值 |
|------|-----|
| **定位** | `core/tree-state.js:1324-1328` |
| **严重程度** | **建议** |
| **描述** | validate() 函数末尾的注释存在内部矛盾：第一行注释说"ok=true 即使有 issues 也算 ok（设计 §A.7 输出 ok:false 是 schema 故障级）"，暗示 ok 仅在 schema 故障时为 false。但紧随其后的注释正确指出"issues 非空时 ok=false"，且实际代码 `return { ok: issues.length === 0, issues }` 确实是在 issues 非空时返回 ok=false。第一行注释是错误的，实际行为和后续注释是正确的。这不会导致运行时 bug，但会造成维护困惑。 |
| **证据** | 代码第 1324-1328 行：`// 输出: ok=true 即使有 issues 也算 ok` vs `return { ok: issues.length === 0, issues }` |
| **修正建议** | 删除或修正第 1324 行的误导性注释：改为 `// 输出: ok=true 仅当 issues 为空；issues 非空时 ok=false` |

### E-09 | B 和 S1 报告缺少"无法独立验证的声称"声明

| 字段 | 值 |
|------|-----|
| **定位** | `verification-reports/b-verify-report.md`、`verification-reports/v01-retest-report.md` |
| **严重程度** | **建议** |
| **描述** | v01-real-test-report.md §审计说明 包含"无法从 tree-state 独立验证的声称"一节，明确列出了 TaskCreate、methodology 加载、send_message 模式等无法交叉验证的项。这是一个良好的证据透明度实践，但 B 和 S1 报告完全缺少此类声明。对于 B 报告而言，大量声称（子会话执行细节、产出字数、self_check 完整性）均无法从 tree-state.json 独立验证，缺少此声明会误导读者认为所有声称均有证据支撑。 |
| **修正建议** | 为 B 和 S1 报告追加"无法独立验证的声称"章节，参照 L2 报告的格式 |

### E-10 | B 任务 tree-state.json 缺少 root leaf

| 字段 | 值 |
|------|-----|
| **定位** | `.context/trees/bverify/tree-state.json` |
| **严重程度** | **建议** |
| **描述** | bverify tree-state.json 包含 10 个 leaf，全部为子/孙 leaf（A-announce × 4 代、B-techdetail × 4 代、F-integrate、F1-review）。报告声称指挥官 session 为 `63b4e61a-5b0e-479a-82e9-0cbb481a30d8`，但 tree-state.json 中没有对应的 root leaf（如 `bverify-root`）。相比之下，real tree-state.json 正确包含了 `real-root`（session_id 指向 `511e6134`）。这意味着 B 任务的树形结构不完整 — 根节点未被注册到 tree-state。 |
| **证据** | bverify tree-state.json leaves: 10 个（无 root leaf）；报告 Line 4: 指挥官 session_id `63b4e61a`；real tree-state.json: 4 个（含 real-root） |
| **修正建议** | B 任务初始化时应在 tree-state 中注册 root leaf；若 root leaf 存在于其他 tree 或设计上故意省略，应在报告中说明 |

### E-11 | v01-real-test-report 证据链完整（正面发现）

| 字段 | 值 |
|------|-----|
| **定位** | `verification-reports/v01-real-test-report.md` + `real/tree-state.json` |
| **严重程度** | **信息** |
| **描述** | L2 验证报告的证据链是 3 份报告中唯一完整的：1) 指挥官 session `511e6134` 可查，created_at 2026-06-19 17:46:17 GMT+8 与报告声称的 17:47–17:52 吻合；2) 审查 session `263f8996` 可查，标题 "audit-L2-report — v01-real-test-report 自审计" 与报告一致；3) 3 个子会话 session 全部可查（A/B/F1），model/channel/title 与报告一致；4) tree-state.json write_count=23 与报告声称一致；5) 所有 4 个 leaf 的 session_id 与 MCP 查询结果完全匹配；6) 报告包含"无法独立验证的声称"透明度声明。此为本次审查中**唯一完全通过可验证性检查**的报告。 |
| **证据** | 5/5 `get_session_info` 返回有效 session；tree-state.json 4 leaves 的 session_id 与 MCP 查询一致 |

---

## validate() 代码-文档对比矩阵

| SKILL.md §5 声称的检查项 | tree-state.js 实现位置 | 实现匹配? | 备注 |
|---|---|---|---|
| parent 引用 | :1221-1232 | ✅ 完全匹配 | 检查所有 leaf.parent 指向存在的 leaf |
| fork_to | :1235-1249 | ✅ 完全匹配 | 检查 drift_history 中 fork_to 指向存在的 leaf |
| session_id 唯一 | :1252-1284 | ✅ 完全匹配 | 检查 leaf.session_id + segment_chain 全局唯一 |
| path 一致 | :1287-1304 | ✅ 完全匹配 | 检查 leaf.path 与 leaf_id 解析出的 path 段一致 |
| milestone.id 唯一 | :1307-1322 | ✅ 完全匹配 | 检查同一 leaf 内 milestone.id 不重复 |

**结论**: validate() 函数的 5 项检查与 SKILL.md §5 文档描述完全一致。代码 1324-1328 行注释存在内部矛盾但不影响功能正确性。

---

## 时间线一致性

| 验证任务 | 报告声称时间 | 可验证时间 | 一致性 |
|---------|------------|-----------|--------|
| B 任务 | 2026-06-18 18:18–18:40 GMT+8 | tree-state.json mtime: 2026-06-18 18:40:10 GMT+8 | ✅ 文件时间吻合 |
| S1 重测 | 2026-06-19 16:05-16:08 GMT+8 | **无可验证来源** | ❌ 无法验证 |
| L2 验证 | 2026-06-19 17:47–17:52 GMT+8 | 指挥官 created_at: 17:46:17 / F1 created_at: 17:50:22 / tree-state mtime: 17:51:58 | ✅ 完全吻合 |

---

## CHANGELOG / README 一致性

| 声明来源 | 声明内容 | 报告原文 | 一致? |
|---------|---------|---------|-------|
| CHANGELOG | B任务"3次尝试 ✅ 有条件通过" | b-verify-report "⚠️ 有条件通过" | ✅ |
| CHANGELOG | S1重测"25命令全部通过 ✅" | v01-retest-report "全部通过" | ✅ |
| CHANGELOG | L2"1次通过 0偏差 ✅" | v01-real-test-report "✅ 通过" drift_log=0 | ✅ |
| README | B任务"✅ 有条件通过（频道限制）" | b-verify-report "⚠️ 有条件通过" | ✅ |
| README | S1"✅ 全部通过" | v01-retest-report "全部通过" | ✅ |
| README | L2"✅ 1次通过 0偏差" | v01-real-test-report "✅ 通过" | ✅ |

---

## 统计摘要

| 类别 | 数量 |
|------|------|
| 阻断级问题 | 2 (E-01, E-02) |
| 严重级问题 | 5 (E-03, E-04, E-05, E-06, E-07) |
| 建议级问题 | 3 (E-08, E-09, E-10) |
| 信息（正面） | 1 (E-11) |
| **总计** | **11** |
| 完全可验证的报告 | 1/3 (v01-real-test-report) |
| 部分可验证的报告 | 1/3 (b-verify-report: tree-state.json 存在但 session 不可查) |
| 完全不可验证的报告 | 1/3 (v01-retest-report: session + tree-state 全部不可查) |
