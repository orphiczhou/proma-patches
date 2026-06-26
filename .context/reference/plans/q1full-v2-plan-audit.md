# Q1 v2 方案审计报告

> 审计日期: 2026-06-20 | 审计者: Proma Agent (code-reviewer)
> 被审计方案: q1full-v2-verification-plan.md v2
> 对照基准: v1.1 方案 + tree-state.js v0.2.1 源码 + commander-methodology v1.2

## 总评

**不通过**

方案存在 3 个阻断级问题，执行前必须修订。

## 审计摘要

- 审计维度: 5/5
- 发现总数: 10
- 阻断: 3 / 严重: 3 / 建议: 4

---

## 逐维度发现

### 1. 功能正确性

| # | 问题 | 严重度 | 定位 |
|---|------|--------|------|
| 1.1 | **所有 leaf_id 违反 LEAF_NAME_RE 命名规范** — 形如 `q1full-v2-root` 的 leaf_id 均无法通过 `tree-state.js` L489 的正则校验。regex `([a-z][a-z0-9_]{3,7})-(?:([A-Z]...)?-)?(\w+)...` 中 path 段要求大写开头 (`[A-Z]`)，但 `-v2` 以小写 `v` 开头，导致 path 可选组整体被跳过，随后 `(\w+)` 匹配 `v2`，`(?:-(s\d+\|i\d+))?$` 无法匹配 `-root`/`-commander`/`-worker` 等剩余部分，regex 整体失败。**所有 leaf add 操作均会抛出 E_NAME_INVALID**。 | 阻断 | 全部 leaf_id（§二树结构、§三用例、§七会话策略） |
| 1.2 | **E2 用例触发机制不正确** — 用例描述 "JSON 手动构造 `{role:"worker",parent:null}` 后 validate" 依赖 `cmdValidate` 检测 `parent=null 但 role!=root`。但 `cmdValidate`(L1278-1397) 的 5 项检查（parent引用、fork_to、session_id唯一、path一致、milestone唯一）均不包含此校验。该校验仅存在于 `cmdLeafAdd`(L514-519)，绕过 leaf add 直接修改 JSON 后 validate 不会触发 E_SCHEMA_INVALID。 | 阻断 | §五 E2 行 |
| 1.3 | **R5 与 A6/R7 对 E_CHILDREN_NOT_DONE 的分析正确** — 代码 L782 `if (leaf.role === 'commander')` 守卫确认只有 commander 角色受子节点完成约束，root 不受限 (R5=成功)，worker 跳过检查 (B4=成功)。 | 值得肯定 | §三 R5, R7, A6 |
| 1.4 | **A3/A5 对 calcCommanderDepth 的分析正确** — L1455-1467 含 parent 自身向上统计 root/commander 节点数。以 q1full-v2-A-c1-commander 为父加 commander 时 depth=3 >= 3，触发 E_DEPTH_EXCEEDED。逻辑推导正确。 | 值得肯定 | §三 A3, A5 |

### 2. 完整性

| # | 问题 | 严重度 | 定位 |
|---|------|--------|------|
| 2.1 | **leaf 总数统计错误** — 方案声称 "总 leaf 数: 9 (含 root)"，但树图中实际有 10 个节点 (1 root + 4 commander + 5 worker)。叶子统计等式 `1+2+1+2+3=9` 中 "3 worker" 应为 4。底层 Commander/Worker 枚举单独计数 (4+5+1=10) 与等式矛盾。v1.1 方案继承此错误。 | 严重 | §二 叶子统计 |
| 2.2 | **无自动备份/restore 专用测试用例** — 方案在成功标准中提到 "自动备份生成 — 至少 1 个 backup 文件"，Phase 7 提及 "backup-restore 往返验证"，但无独立的 BKP/RST 用例（需显式触发 10 次写验证 auto backup，及 restore 往返验证）。依赖全局副作用验证，缺乏可追踪性。 | 严重 | §四能力矩阵 / §八 Phase 7 |
| 2.3 | **错误码覆盖率** — E1-E8 (8 个测试标签) 实际覆盖了 9 个不同错误码 (E_CHILDREN_NOT_DONE, E_DEPTH_EXCEEDED, E_SCHEMA_INVALID, E_PARENT_MISSING, E_DUPLICATE_LEAF, E_NAME_INVALID, E_STATUS_INVALID, E_LEAF_NOT_FOUND, E_TREE_NOT_FOUND)。E_BACKUP_CORRUPT 和 E_LOCK_TIMEOUT 未覆盖，但属于基础设施级错误，难以在正常流程中触发，可接受。 | 建议 | §五 |
| 2.4 | **M1 "显示 28 映射" 与代码不一致** — `ROLE_MIGRATION_MAP` 共 27 个条目 (L1475-1503)。期望值 28 可能来自 bverify 树实际数据（包含不在 map 中的兜底映射），但方案未说明此差异。若 bverify 树数据与预期不符，dry-run 输出可能不是 28。 | 建议 | §六 M1 |

### 3. 设计一致性

| # | 问题 | 严重度 | 定位 |
|---|------|--------|------|
| 3.1 | **会话创建策略 (原则 11) 均正确** — 全部 Commander 使用 fork_session (需继承上下文)，全部 Worker 使用 create_session (需干净上下文)。符合 Leaf Purity 原则。 | 值得肯定 | §七 |
| 3.2 | **原则 12 (分布式写入) 对齐** — 方案 B5 测试 Worker 不直接写 tree-state，A8 验证 Commander 分布式写入边界。符合原则 12。 | 值得肯定 | §三 B5, A8 |
| 3.3 | **原则 13 (三层深度) 对齐** — A3 测试合法 depth (1→2)，A5 测试超限拒绝 (depth>=3→E_DEPTH_EXCEEDED)。正确体现原则 13。 | 值得肯定 | §三 A3, A5 |
| 3.4 | **方案未明确 root leaf 创建步骤** — R0 仅执行 init 但 init (L410-460) 只创建空 `leaves:{}`，不创建 root leaf。R3 的 `leaf add --parent root` 隐式依赖已存在的 root leaf，但无步骤显式创建它。执行 Agent 需自行补充，存在遗漏风险。 | 严重 | §三 R0/R3 |

### 4. 可执行性

| # | 问题 | 严重度 | 定位 |
|---|------|--------|------|
| 4.1 | **leaf add CLI 语法与实现不匹配** — 方案中所有 `leaf add` 命令使用 `--role` / `--parent` 独立标志（如 `leaf add q1full-v2-A-commander --role commander --parent root`），但 tree-state.js L466-471 的 `cmdLeafAdd` 要求 `--json '<完整JSON>'` 单一参数，JSON 必须包含 `leaf_id, session_id, parent, path, role, model, channel` 七个必填字段。同样 `set-status --status` 应改为位置参数 (L746: `tree_id leaf_id new_status`)。方案中的命令字符串无法直接粘贴执行。 | 阻断 | §三全部 leaf add / set-status 操作列 |
| 4.2 | **模型和频道约束明确且可用** — 所有子会话锁定 deepseek-v4-flash + 频道 56ecefd2-8e22-4c62-add5-16e8992c987d，GLM 硬禁止。约束清晰可执行。v1.1 的短 UUID `56ecefd2` 已正确扩展为完整 UUID。 | 值得肯定 | §七 |
| 4.3 | **路径全部为绝对路径** — 树存储路径、SKILL 文件路径 (S1-S3)、migrate 前置检查 (M0)、报告输出路径均已从 v1.1 的相对路径更新为绝对路径。 | 值得肯定 | §二 / §六 / §六-B / §十一 |
| 4.4 | **执行顺序无死锁** — Phase 1→2a/2b/3 并行→4 串行→5/6→7，依赖链清晰无循环。 | 值得肯定 | §八 |

### 5. 与 v1.1 一致性

| # | 问题 | 严重度 | 定位 |
|---|------|--------|------|
| 5.1 | **leaf_id 全局替换正确** — 所有 leaf_id 从 `q1full-*` 一致改为 `q1full-v2-*`，无遗漏。但如 1.1 所述，改名引入了命名规范兼容性问题。 | 建议 | 全局 |
| 5.2 | **风险表正确更新** — "DeepSeek V4 Pro"→"V4 Flash"、概率从"中"→"低"、"GLM 频道误用"从"低"→"极低"、"workspace=null"从"中"→"低"。均反映 v2 改进。 | 值得肯定 | §十 |
| 5.3 | **报告路径与 tree_id 正确更新** — tree_id 从 `q1full`→`q1full-v2`，报告路径从相对→绝对。 | 值得肯定 | §十一 |
| 5.4 | **用例编号和逻辑保持一致** — R0-R7, A0-A8, B0-B5, C10-C15, W10-W13, W20-W22, C0-C4, E1-E8, M0-M4, S1-S3 与 v1.1 完全对应，无增删。 | 值得肯定 | §三 / §五 / §六 |

---

## 裁决

**不通过 (3 阻断 + 3 严重)**

### 阻断项 (必须修订方可执行)

1. **leaf_id 命名不兼容** (§1.1)：全部 `q1full-v2-*` 格式的 leaf_id 违反 LEAF_NAME_RE。建议方案：
   - 方案 A (推荐)：将前缀改为 `qfv2`，leaf_id 变为 `qfv2-root`、`qfv2-A-commander` 等，同时 tree_id 从 `q1full-v2` 改为 `qfv2`。`qfv2` (4 字符) 完全匹配 `[a-z][a-z0-9_]{3,7}`。
   - 方案 B：保持 tree_id=`q1full-v2`，leaf_id 改为 `q1full-root-v2`、`q1full-A-commander-v2` 等（v2 作为后缀 `-(s\d+\|i\d+)` 需调整为合法后缀格式如 `-v2`，但当前 regex 不支持 `v\d+`，需同步修改 regex）。

2. **E2 触发机制错误** (§1.2)：不能依赖 validate 检测 `parent=null 但 role!=root`。应改为通过 `leaf add --json` 构造此场景（传入 `role: "worker", parent: null`），由 `cmdLeafAdd` L514-519 抛出 E_SCHEMA_INVALID。

3. **CLI 语法不匹配** (§4.1)：所有 `leaf add` 命令需从 `--role/--parent` 改为 `--json '{"leaf_id":"...","session_id":"...","parent":"...","path":"...","role":"...","model":"...","channel":"..."}'`。`set-status` 需从 `--status` 标志改为位置参数。

### 严重项 (建议修订)

4. **leaf 总数统计** (§2.1)：将 "9" 改为 "10"，等式中的 "3 worker" 改为 "4 worker"。
5. **root leaf 创建步骤缺失** (§3.4)：在 R0 后增加显式的 `leaf add <root_leaf_id> --json '{parent:null,role:"root",...}'` 步骤。
6. **缺 backup/restore 专用用例** (§2.2)：增加显式 BKP 用例 (触发 10 次写后检查 backup 文件) 和 RST 用例 (backup→restore→validate 往返)。

### 低优先级建议

7. M1 "28 映射" 改为 "27+" 或标注"实际数量取决于 bverify 树数据"。
8. 方案中 §六-B 的编号建议改为独立 §七（当前嵌套在 §六下但实际是独立章节）。

---

## 审计完整性声明

本审计对照以下原始资料完成：
- `tree-state.js` v0.2.1 源码 (1760 行)，重点审查 L58-64 (命名正则)、L466-585 (leaf add)、L744-822 (set-status)、L1278-1397 (validate)、L1455-1467 (calcCommanderDepth)、L1475-1503 (ROLE_MIGRATION_MAP)
- `commander-methodology.md` v1.2 原则 11-13
- `q1-full-depth-verification.md` v1.1 逐项对比
