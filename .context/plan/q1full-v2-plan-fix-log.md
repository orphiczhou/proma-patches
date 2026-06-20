# Q1 v2 方案修复日志

## 修复日期: 2026-06-20
## 修复者: Proma Agent (基于审计报告 q1full-v2-plan-audit.md)
## 对照基准: tree-state.js v0.2.1 (LEAF_NAME_RE L64, cmdLeafAdd L466-585, cmdValidate L1278-1397)

---

## 修复项

| # | 问题 | 严重度 | 修复内容 | 状态 |
|---|------|--------|---------|------|
| 1 | leaf_id 命名不兼容 LEAF_NAME_RE | **阻断** | tree_id 从 q1full-v2 改为 qfv2 (4 字符，符合 [a-z][a-z0-9_]{3,7})。所有 leaf_id 前缀同步更改。附加修复: 路径段内部连字符移除 (如 A-c1 -> Ac1, A-c1-w1 -> Ac1w1) 以匹配 path 段 regex 单 token 格式。共涉及 9 个 leaf_id 的路径格式修正。 | 已修复 |
| 2 | E2 触发机制错误 | **阻断** | E2 用例从 JSON 手动构造后 validate 改为 leaf add --json (parent:null, role:worker) -> E_SCHEMA_INVALID。cmdValidate (L1278-1397) 不含 parent=null + role!=root 校验，该校验仅在 cmdLeafAdd (L514-519) 中。 | 已修复 |
| 3 | CLI 语法不匹配 | **阻断** | 所有 leaf add 命令从 --role/--parent 独立标志改为 --json 单一参数 (含 leaf_id, session_id, parent, path, role, model, channel 七个必填字段)。所有 set-status 命令从 --status 标志改为位置参数 (tree_id leaf_id new_status)。所有命令统一加 node 前缀。 | 已修复 |
| 4 | leaf 总数统计错误 | **严重** | 总 leaf 数从 9 修正为 10 (= 1 root + 4 commander + 5 worker)。原等式中的 worker 计数从 3 修正为 5。增加 root leaf 显式说明 (init 不创建 leaf，需 leaf add 创建)。 | 已修复 |
| 5 | 缺少 root leaf 显式创建步骤 | **严重** | R0 拆分为 R0a (init) + R0b (leaf add qfv2-root)。R0b 使用正确的 --json 语法，parent=null, role=root。同步更新 Phase 1 描述和执行顺序图。 | 已修复 |
| 6 | 缺少 backup/restore 专用测试用例 | **严重** | 增加五-B 独立章节，含 BKP1 (手动 backup --label test) 和 BKP2 (restore + validate 往返验证) 两个用例。同步更新能力矩阵、执行顺序 (Phase 5b)、成功标准 (第 5 项)。 | 已修复 |

## 低优先级修复 (审计建议项)

| # | 问题 | 严重度 | 修复内容 | 状态 |
|---|------|--------|---------|------|
| 7 | M1 期望值与代码不一致 | 建议 | 期望值从 28 映射 改为动态描述 (取决于 bverify 树数据；ROLE_MIGRATION_MAP 含 27 个固定条目，另有兜底映射)。 | 已修复 |
| 8 | 六-B 编号嵌套 | 建议 | 维持原结构未变更 (审计标注为低优先级建议，不阻断执行)。 | 保持 |

## 附加发现与修复

| # | 发现 | 说明 | 处理 |
|---|------|------|------|
| A1 | 路径段内部连字符冲突 | 审计建议将前缀改为 qfv2，但 leaf_id 如 qfv2-A-c1-commander 仍因 path 段含内部连字符而无法匹配 LEAF_NAME_RE。regex 将 path 解析为单 token (不含 -)，多级路径需拼接 (如 A-c1 -> Ac1)。此问题在审计中未被识别为独立项，但在执行 leaf_id 命名修复时发现并修正。 | 全部 path 段已去连字符拼接，与 parsePathFromLeafId 的 group 2 提取逻辑一致 |

## 验证清单

- [x] tree_id 全部替换为 qfv2 (文件内容中 0 处旧 tree_id 残留；仅修订记录中 1 处引用旧值作为变更说明)
- [x] 所有 leaf_id 前缀 qfv2 (9 个叶子节点 + 错误用例临时 ID 已全部更新)
- [x] 路径段去内部连字符 (0 处 A-c1- 等残留)
- [x] leaf add 命令全部使用 --json 语法 (0 处 --role/--parent 标志残留)
- [x] set-status 命令全部使用位置参数 (0 处 --status 标志残留)
- [x] E2 用例使用 leaf add 触发 (含 L514-519 代码定位注释)
- [x] leaf 总数: 10
- [x] R0 拆分为 R0a + R0b
- [x] BKP1/BKP2 用例存在且语法正确
- [x] M1 期望值修正为动态描述
- [x] 能力矩阵含 backup/restore 往返行
- [x] 执行顺序含 Phase 5b
- [x] 成功标准含手动 backup/restore
- [x] 修订记录已添加
- [x] 树存储路径更新为 qfv2/
- [x] 报告模板 tree_id 更新为 qfv2

## 修复后文件

- 方案文件: q1full-v2-verification-plan.md
- 本日志: q1full-v2-plan-fix-log.md
- 审计报告: q1full-v2-plan-audit.md
