# 错误码字典（Error Code Reference）

> 维护：周星星 | 产出：2026-07-09 会话 bbdefd1e（从 TH 权威源 `tree-engine.cjs` + `proma-dev-patches.cjs` 自动抽取）
> 配套：[API.md](./API.md) §5（本文件为错误码的唯一权威源，API.md §5 引用此处）
> 未来迁移：`04_API_SPEC/error-codes.md`（待 tree-harness 整体迁移到编号目录结构时）

---

## 说明

- **来源**：`tree-engine.cjs`（md5 `28cb42bb`，42 个 `const E_*`）+ `proma-dev-patches.cjs`（md5 `93cd64f4`，layer1 ownership/会话/跨工作区错误码）。
- **排查法**：遇到错误码 → 本文件查触发条件 → `grep -n "E_XXX" tree-engine.cjs` 看抛出点 → 对照 SKILL 协议。
- **合计**：51 个错误码（engine 43 + patches 独有 8；Sprint 5 新增 `E_MAX_SESSIONS`）。
- **缺口补全**：API.md 原 37 个，本次补全 12 个缺口（见文末附录）。

---

## 一、基础 / 通用（engine）

| 错误码 | 触发条件 | 行 |
|---|---|---|
| `E_LOCK_TIMEOUT` | tree-state.json 文件锁等待超时（并发写冲突） | L124 |
| `E_IO` | 文件读写 IO 错误 | L138 |
| `E_UNKNOWN` | 未分类的内部错误 | L139 |
| `E_BACKUP_CORRUPT` | tree-state 备份文件损坏（restore 时） | L137 |

## 二、树 / 叶子结构（engine）

| 错误码 | 触发条件 | 行 |
|---|---|---|
| `E_TREE_NOT_FOUND` | tree_id 在 trees 目录中不存在 | L125 |
| `E_LEAF_NOT_FOUND` | leaf_id 在树中不存在 | L126 |
| `E_SCHEMA_INVALID` | tree-state.json schema 校验失败 | L127 |
| `E_STATUS_INVALID` | new_status 不在 STATUS_ENUM 内 | L128 |
| `E_STATUS_TRANSITION_INVALID` | 非法状态流转（如 done→active），P0-3 修复引入 STATUS_TRANSITION_RULES | L130 |
| `E_NAME_INVALID` | tree_id/leaf_id 命名违反正则（连字符、非法字符等） | L131 |
| `E_PARENT_MISSING` | leaf_add 时 parent leaf 不存在/非 active | L132 |
| `E_DUPLICATE_LEAF` | leaf_id 在树中已存在 | L133 |
| `E_DUPLICATE_SESSION_ID` | session_id 在树中重复（Bug B-3 修复） | L134 |
| `E_CHILDREN_NOT_DONE` | 父叶子有未 done 的子叶子，无法 done | L135 |
| `E_DEPTH_EXCEEDED` | 超过最大嵌套深度（commander ≤3） | L136 |
| `E_TREE_NOT_VALIDATED` | tree 未通过 collectValidateIssues | L150 |

## 三、审计门禁（engine）

| 错误码 | 触发条件 | 行 |
|---|---|---|
| `E_GATEKEEPER_REQUIRED` | 操作需要审计门禁（audit_gate）但未通过 | L140 |
| `E_DELIVERABLE_MISSING` | done 时交付物文件缺失 | L142 |
| `E_DELIVERABLE_EMPTY` | done 时交付物文件为空 | L177 |
| `E_AUDITOR_NOT_INDEPENDENT` | auditor 不独立（与被审计者同 session/同身份链） | L143 |
| `E_AUDIT_PREMATURE` | 审计过早（被审计者未 done 就审） | L144 |
| `E_ALIGNMENT_NOT_VERIFIED` | done 前未回填 alignment（brief_echo 对齐度） | L146 |
| `E_SELFCHECK_INVALID` | done event 的 self_check schema 无效 | L147 |
| `E_AUDITOR_NOT_DONE` | V10-auditor-active：auditor leaf status≠done | L155 |
| `E_AUDITOR_NO_EVENTS` | V10-auditor-active：auditor leaf events 为空 | L156 |
| `E_AUDITOR_NOT_VERIFIED` | V10-auditor-active：auditor 自己的 audit_gate.verdict≠pass | L157 |

## 四、review 门禁（engine，ISS-003 / P1b）

| 错误码 | 触发条件 | 行 |
|---|---|---|
| `E_REVIEW_NOT_CONVERGED` | worker done 但 review_round 未收敛/未跑 | L173 |
| `E_REVIEW_FORGERY` | review_round schema 伪造/自审（非法自写） | L174 |
| `E_REVIEW_FLAGGED_BLOCK` | 父链有 flagged leaf，需先补审 | L175 |

## 五、V10 加固（engine，八大加固点）

| 错误码 | 触发条件 | 加固点 | 行 |
|---|---|---|---|
| `E_BORROWED_IDENTITY` | caller≠audit_session_id（借身份）；07-09 扩展到 leaf_add/set-status/milestone-add 的 caller!==added_by/owner | self-audit-forbidden-v2 + caller-binding | L158 |
| `E_INVALID_UUID_STRICT` | UUID 全 0/全 f/非 v4 格式 | uuid-format-strict | L159 |
| `E_NEGATIVE_COUNT` | self_check total/passed/failed < 0 | numeric-consistency | L160 |
| `E_COUNT_MISMATCH` | passed+failed ≠ total | numeric-consistency | L161 |
| `E_LENGTH_MISMATCH` | results.length ≠ total | numeric-consistency | L162 |
| `E_TS_BEFORE_CREATED` | event ts 早于 leaf.created_at | timestamp-monotonic | L163 |
| `E_TS_IN_FUTURE` | event ts 晚于 now+60s | timestamp-monotonic | L164 |
| `E_TS_NOT_MONOTONIC` | event ts 早于上一条 event | timestamp-monotonic | L165 |
| `E_STATUS_EVENT_MISMATCH` | leaf.status 与 events 不同步（status-event-sync，P0-1 修复） | status-event-sync | L167 |

## 六、预算 / 护栏（engine）

| 错误码 | 触发条件 | 行 |
|---|---|---|
| `E_TREE_NODE_BUDGET_EXCEEDED` | active leaf 数 ≥ root_dod.node_budget（默认 20） | L149 |
| `E_SUBAGENT_BUDGET_EXCEEDED` | 单 leaf subagent_spawn 数 ≥ max_subagent_spawn_per_leaf（默认 15） | L179 |
| `E_MAX_SESSIONS` | **Sprint 5 (聚类 A/E, 2026-07-14)**：tree 总会话数（distinct `session_registry` 计数）> `audit_meta.max_sessions`（默认 50，防 macp2 型会话爆炸；覆盖 leaf_add / set-session / 旁路 create_session 登记的 session；PENDING_ROOT/占位不占额度） | max_sessions guard（`cmdLeafAdd` / `cmdLeafSetSession` / `cmdTreeRegisterSession`） | 新增 |
| `E_LEAF_AUTO_PRUNED` | nudge_count ≥ 7 强制 pruned（V10-nudge-escalation） | L166 |
| `E_SESSION_NOT_ALIVE` | session 真实性校验失败（layer2 verifier，session 不存在/已死） | L171 |

## 七、patches layer1（caller ownership / 会话，proma-dev-patches.cjs）

| 错误码 | 触发条件 | 归属规则 | 行 |
|---|---|---|---|
| `E_NO_OWNERSHIP` | caller ownership 拒绝：caller 与目标 session 无血缘/权限（堵跨 session 冒用，R1-R6） | R1-R6 lineage | L405 |
| `E_DELEGATION_TOO_DEEP` | create/fork 委派深度 > MAX_DELEGATION_DEPTH（防链式深递归） | delegationDepth | L712/L769 |
| `E_SESSION_BUDGET_EXCEEDED` | 单 caller 60s 内 create_session > 20（macp2 爆炸护栏，2026-07-09） | checkCreateSessionBudget | L269 |
| `E_TARGET_NOT_FOUND` | 目标 session 不存在（send_message/fork 的 target） | ownership resolve | L360 |
| `E_WORKSPACE_REQUIRED` | remote_create_session 无法自动解析 workspace_id（ISS-001 修复兜底） | remote 兜底 | L1226 |
| `E_WORKSPACE_NOT_FOUND` | workspace_id 不在实例索引（patches Part A `validateWorkspaceId` L221；**Sprint 4 P2** main.cjs `createAgentSession` 平台层同码 throw L386653，兜底 automation/bot/直调 API） | workspace 校验 | L221 / main.cjs L386653 |
| `E_WORKSPACE_FORBIDDEN` | **Sprint 4 P1**：agent 调用方建子会话跨到自己 workspace 之外（create_session / fork_session Part B 锁，堵 9 工作区漂移） | caller-workspace lock | L702/L850 |
| `E_NO_TREES_DIR` | trees 目录不存在 | 初始化 | L1604 |

---

## 八、文档遗留错误码（已核实，引擎未实现）

以下错误码出现在 `API.md` 但经 2026-07-11 审计核实，**引擎/patches 零定义**（grep `const E_` 与字符串抛出均无命中），属文档遗留/虚构：

| 错误码 | 状态 | 核实方向 |
|---|---|---|
| `E_PATH_TRAVERSAL` | ❌ 文档遗留，引擎未实现 | 路径遍历校验存在（cmdLeafSetStatus），但抛 `E_DELIVERABLE_MISSING`，非独立码 |
| `E_SYMLINK_ESCAPE` | ❌ 文档遗留，引擎未实现 | symlink 校验同上，抛 `E_DELIVERABLE_MISSING` |
| `E_WORKSPACE_CANONICAL` | ❌ 文档遗留，引擎未实现 | workspace 规范化无独立错误码 |
| `E_ROLE_INVALID` | ❌ 文档遗留，引擎未实现 | role 非法实抛 `E_SCHEMA_INVALID`（assertEnum 默认），非独立码 |

> 2026-07-11 审计定论：这 4 个码在引擎/patches 完全不存在。路径/symlink 校验抛 `E_DELIVERABLE_MISSING`，role 非法抛 `E_SCHEMA_INVALID`。API.md §5 已同步标注为文档遗留。

---

## 附录：API.md §5 缺口补全清单（本次补全 12 个）

API.md 原 37 个错误码，本次对照权威源补全以下缺口：

**engine 缺口（7）**：`E_DELIVERABLE_EMPTY` / `E_REVIEW_NOT_CONVERGED` / `E_REVIEW_FORGERY` / `E_REVIEW_FLAGGED_BLOCK` / `E_SESSION_NOT_ALIVE` / `E_STATUS_TRANSITION_INVALID` / `E_SUBAGENT_BUDGET_EXCEEDED`

**patches 缺口（5）**：`E_NO_OWNERSHIP` / `E_DELEGATION_TOO_DEEP` / `E_SESSION_BUDGET_EXCEEDED` / `E_TARGET_NOT_FOUND` / `E_WORKSPACE_REQUIRED`

> 补全动作：在 API.md §5 错误码字典追加以上 12 个（详见下个步骤），并加指向本文件的引用。

---

## 维护约定

- **新增错误码**：engine 加 `const E_XXX` 或 patches 抛出后，**必须同步本文件**（CLAUDE.md「文档引擎一致性 P0 高发区」）。
- **理想方案**：用脚本从 `const E_*` 自动生成本文件，杜绝滞后（归入元数据自动校验 backlog）。
- **版本标记**：V10/IHL/P0-x/ISS-xxx/日期 标注引入版本，便于追溯。
