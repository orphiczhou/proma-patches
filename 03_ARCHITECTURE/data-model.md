# tree-state.json Formal Schema

> 维护: 周星星 + Proma Agent | 版本: 0.7+ (V10 Phase 3 + IHL R6)
> 来源: `D:/Proma-dev/resources/app/dist/tree-engine.cjs` (5045 行) + `proma-dev-patches.cjs` (3268 行)
> 配套: [ARCHITECTURE.md §5](./ARCHITECTURE.md) · [API.md §7](./API.md) · [ERROR-CODES.md](./ERROR-CODES.md)
> 用途: 补 design-files-mapping-2026-07-09.md §五 P1-11 缺口（"有 JSON 示例非 formal，8 种 event meta 未统一"）

---

## 0. 文件布局

```
~/.proma[-dev|-pro]/agent-workspaces/<workspace_slug>/{workspace-files/,}.context/trees/<tree_id>/
├── tree-state.json           ← 主状态文件（原子写 + 文件锁）
├── tree-state.backup.*.json  ← 自动备份（10 份滚动 + 时间戳）
├── call-log.jsonl            ← 工具调用审计日志（append-only）
└── deliverables/             ← 交付物根目录
    ├── <milestone.expect_outputs>     ← worker 产出
    └── subagent-outputs/              ← SubAgent 产出
```

**写约束**: 引擎内联（v0.7+，工作区零源码副本），所有读写必须走 `mcp__tree__*` MCP 工具；直接 `Read/Edit/cat tree-state.json` 绕过 MCP 会被 Layer 4 W-AUDIT-* 事后检测为篡改。

---

## 1. 顶层字段（tree-state.json 根对象）

| # | 字段名 | 类型 | 必填 | 约束 / 默认 | 来源 / 用途 |
|---|---|---|---|---|---|
| 1 | `schema_version` | string | ✅ | 当前值 `"0.7"`；语义版本（major.minor）；新增字段必须 bump | tree_init 时写入；migrate 时校验；引擎按版本路由校验链 |
| 2 | `tree_id` | string | ✅ | 正则 `^[a-z][a-z0-9_]{3,7}$`；全工作区唯一；不可变 | tree_init 入参；E_DUPLICATE_LEAF 拦重复 |
| 3 | `created_at` | ISO8601 string | ✅ | 例 `"2026-07-14T23:09:43.293+08:00"`；不可变；V10-timestamp-monotonic 校验后续事件 ts ≥ 此值 | tree_init 时 now() |
| 4 | `root_brief` | object | ✅ | 无固定 schema（自由 JSON）；典型含 `goal` / `boundary` / `in_scope` / `out_of_scope` | tree_init 入参；root leaf 的 brief 副本 |
| 5 | `root_dod` | object | ✅ | 必含 `max_depth` (int, 默认 3) / `node_budget` (int, 默认 20, macp2 后 10→20) / `deliverables_check` (string[]) / `quality_gates` (object[]) / `self_check` (string[]) | tree_init 入参；CP2/CP3 校验源 |
| 6 | `leaves` | map<leaf_id, leaf_obj> | ✅ | 至少含 1 个 root leaf；leaf_id 为 key；PENDING_ROOT 占位允许 | leaf_add 时追加；worker leaf 不能有 children |
| 7 | `heartbeats` | array<object> | ❌ | 默认 `[]`；Tao Watcher 周期巡逻（5min/圈）写入；每条含 `ts` / `leaf_id` / `verdicts` | tree_heartbeat_append；E_TS_NOT_MONOTONIC 校验 |
| 8 | `drift_log` | array<drift_obj> | ❌ | 默认 `[]`；3 层纠正（production/direction/rhythm） | tree_drift_append；done event 中 `drift_declaration=true` 时必有对应条目 |
| 9 | `_meta` | object | ❌ | 默认 `{}`；引擎内部字段（schema_version 迁移标记、备份计数器等） | tree_migrate / tree_backup 写入；非 API 直接读写 |
| 10 | `audit_meta` | object | ❌ | 子字段：`max_sessions` (int, macp2 后默认 30) / `review_required` (bool) / `max_subagent_spawn_per_leaf` (int, 默认 15) / `auditor_whitelist` (session_id[]) | tree_init 入参；V2 auditor 白名单；macp2 后 max_sessions 硬限 |
| 11 | `session_registry` | array<reg_obj> | ❌ (Sprint 5 必填) | macp2 后引入；每个 SDK-native create_session 必须注册；超过 max_sessions 抛 E_MAX_SESSIONS | tree_register_session；防 macp2 爆炸（4 分钟 207 会话事故） |

**最小可工作 tree-state.json 示例**:

```json
{
  "schema_version": "0.7",
  "tree_id": "e2e03",
  "created_at": "2026-07-14T23:09:43.293+08:00",
  "root_brief": { "goal": "...", "boundary": [...] },
  "root_dod": {
    "max_depth": 3,
    "node_budget": 20,
    "deliverables_check": ["..."],
    "quality_gates": [{"type": "self_check", "desc": "..."}],
    "self_check": ["..."]
  },
  "leaves": {
    "e2e03-root": { /* 见 §2 */ }
  },
  "heartbeats": [],
  "drift_log": [],
  "_meta": {},
  "audit_meta": {
    "max_sessions": 30,
    "review_required": true,
    "max_subagent_spawn_per_leaf": 15
  },
  "session_registry": []
}
```

---

## 2. leaf 全字段表（leaf_obj）

> 来源: tree_leaf_get 返回结构 + tree_leaf_add 入参 + 引擎内部字段（events/audit_gate/...）。
> 每字段标注: 类型 / 必填（创建时）/ 约束 / 默认 / 写入入口。

| # | 字段名 | 类型 | 必填 | 约束 / 默认 | 写入入口 |
|---|---|---|---|---|---|
| 1 | `leaf_id` | string | ✅ | 正则 `LEAF_NAME_RE`（见 §附录 A.3）；树内唯一 | tree_leaf_add 入参 / tree_init 自动生成 root |
| 2 | `session_id` | string (UUIDv4) | ✅ | 全树唯一（Bug B 修复）；PENDING_ROOT 占位允许 `"PENDING_ROOT"`；非 v4 / 全 0 / 全 f → E_INVALID_UUID_STRICT | tree_leaf_add 入参 / tree_leaf_set_session 修正 |
| 3 | `parent` | string (leaf_id) \| null | ✅ | root 为 null；其他必须指向已存在 active leaf；E_PARENT_MISSING 拦 | tree_leaf_add 入参 |
| 4 | `path` | string | ✅ | root 为 `<tree_id>-root`；子节点为 `parent.path + "/" + leaf_id`；用于 LEAF_NAME_RE path 段校验 | tree_leaf_add 入参 |
| 5 | `role` | enum | ✅ | `ROLE_ENUM`（见 §3）；非法 → E_SCHEMA_INVALID | tree_leaf_add 入参 |
| 6 | `status` | enum | ✅ | `STATUS_ENUM`（见 §4）；默认 `pending_brief`（root）/ `active`（其他）；非法 → E_STATUS_INVALID | tree_leaf_set_status |
| 7 | `model` | string | ❌ | 模型 ID（如 `glm-5.2`）；缺省继承父 | tree_leaf_add 入参 |
| 8 | `channel` | string | ❌ | 频道 ID；缺省继承父 | tree_leaf_add 入参 |
| 9 | `added_by` | string (UUIDv4) | ✅ | root 为 null；其他 = 父 leaf.session_id；E_BORROWED_IDENTITY 校验 caller | tree_leaf_add 入参（引擎自动从 callerSessionId 填） |
| 10 | `created_at` | ISO8601 string | ✅ | leaf_add 时 now()；不可变；后续 event ts ≥ 此值（V10-timestamp-monotonic） | 引擎自动 |
| 11 | `context_usage_pct` | number | ✅ | 默认 0；建议范围 0-100，但允许 >100（如严重溢出场景）；worker ≥85% 触发竹节交接建议 | tree_leaf_set_context |
| 12 | `last_event_type` | enum (EVENT_TYPE) \| null | ❌ | 默认 null；status-event sync 校验（done leaf 必为 `done` / `archived`）| tree_leaf_set_last_event / event_append 副作用 |
| 13 | `last_event_ts` | ISO8601 \| null | ❌ | 默认 null；时间戳单调（≥ created_at / ≥ 上一条 event） | 同上 |
| 14 | `events` | array<event_obj> | ✅ | 默认 `[]`；append-only；done leaf 必含 ≥1 条 `done` event + ≥1 条带 alignment 的 `brief_echo`（V5b） | tree_event_append |
| 15 | `audit_gate` | object | ✅ | 见 §6；默认 `{verdict:"required", auditor_session_id:null, ts:null}`；done 前必须 verdict=pass | tree_audit_gate |
| 16 | `audit_log` | array<audit_obj> | ❌ | 默认 `[]`；每条 `{auditor, ts, total, passed, failed, results:[{item,pass,evidence}]}`；R2-T7 + M2 校验 | tree_audit_append |
| 17 | `milestones` | array<milestone_obj> | ❌ (done 前必填) | 默认 `[]`；done 前必须非空 + 全部 audit_pass=true（V3） | tree_milestone_add / tree_milestone_set_result |
| 18 | `nudge_count` | integer | ✅ | 默认 0；Tao Watcher 周期审计违规累加；3→medium / 5→high / 7→E_LEAF_AUTO_PRUNED | tree_nudge_append（副作用 +1）/ tree_nudge_reset |
| 19 | `nudge_log` | array<nudge_obj> | ✅ | 默认 `[]`；每条 `{rule_id, severity, ts}` | tree_nudge_append |
| 20 | `drift_history` | array<drift_obj> | ❌ | 默认 `[]`；与 tree 顶层 `drift_log` 双向冗余（leaf 视角） | tree_drift_append（同步写两处） |
| 21 | `segment_chain` | array<segment_obj> | ❌ | 默认 `[]`；竹节交接历史（每条含 old_session_id → new_session_id + ts） | tree_segment_append |
| 22 | `brief` | object | ❌ (worker/commander 必填) | 默认 `{}`；五件套之一，含 `parent_intent`/`my_mission`/`in_scope`/`out_of_scope`/`why_this_exists` | tree_leaf_add 入参 / 指挥官下发 |
| 23 | `dod` | object | ❌ (worker/commander 必填) | 默认 `{}`；五件套之一，含 `deliverables`/`quality_gates`/`self_check`（结构对齐 tree_state 顶层 root_dod） | 同上 |
| 24 | `report_protocol` | object | ❌ (worker/commander 必填) | 默认 `{}`；五件套之一，含 `channels`（done/blocked 各自格式）/ `format`（"YAML"）/ `plan_ack_seconds`（默认 300）/ `escalation` | 同上 |
| 25 | `autonomy` | object | ❌ (worker/commander 必填) | 默认 `{}`；五件套之一，含 `can_decide` (string[]) / `must_report` (string[]) / `must_ask` (string[]) | 同上；tree_leaf_autonomy_override 可改 |
| 26 | `self_audit` | object | ❌ (worker/commander 必填) | 默认 `{}`；五件套之一，含 `milestones` / `audit_after_each_milestone` (bool, 默认 true) / `audit_agent_type` ("code-reviewer") / `max_self_corrections` (默认 2) / `drift_declaration_required` (默认 true) | 同上 |

---

## 3. ROLE_ENUM（4 种）

| Role | 含义 | 创建方式 | 权限 | 关键约束 |
|---|---|---|---|---|
| `root` | 树根；唯一信任锚 | `tree_init` 唯一创建 | 全局路由 + 校准 + 给他人 audit_gate=pass（自身由 root.session_id 自审） | 树内唯一；PENDING_ROOT 必须用 `tree_leaf_set_session` 修正；自审作为 Trust Anchor（resolveAuditorIndep 特例） |
| `commander` | 子指挥官；管理下属 | `fork_session` + `tree_leaf_add(role=commander)` | `leaf_add` + `tree_event_append` + 给下属 audit_gate | 嵌套深度 ≤ max_depth（默认 3）；可 fork 出 worker / 下级 commander / auditor |
| `worker` | 工人；只产出 | `create_session` + `tree_leaf_add(role=worker)` | 只读 tree + 只能给自己 append event + set 自己 status | 不能 `leaf_add`；done 前必有独立 auditor 签字（root 信任锚例外）；done 前必有 alignment brief_echo |
| `auditor` | 审计员；P0a 2026-07-08 新增 | `create_session` + `tree_leaf_add(role=auditor)` | 给他人 audit_gate / milestone_set_result / audit_append；不产出交付物 | 走简化协议（brief_echo+done+audit_gate，无 milestone/deliverables）；audit_gate=pass 由 root 或上级 auditor 背书 |

**role 校验**: `tree_leaf_add` 时 role 非 enum → `E_SCHEMA_INVALID`（注意：`E_ROLE_INVALID` 为文档遗留，引擎未定义）。

---

## 4. STATUS_ENUM（6 种）

| Status | 含义 | 触发条件 | 关键约束 |
|---|---|---|---|
| `pending_brief` | 等待 brief 注入 | tree_init 时 root 默认；PENDING_ROOT 占位符 | tree_leaf_set_session 修正 session_id 后通常同步转 active |
| `active` | 进行中 | leaf_add 后默认（非 root）；可被 nudge / drift | done 前不能 add 新 child（部分版本允许，依引擎版本） |
| `done` | 完成 | tree_leaf_set_status 主动调用 | DbC 硬门禁（见 §附录 A.6）：A1 deliverable 存在 + A7 done event + V5b alignment + V6 self_check + V10-status-event-sync |
| `pruned` | 剪枝 | 自动：nudge_count ≥ 7 → E_LEAF_AUTO_PRUNED | 不出现在 list_active；可手动转 active 恢复 |
| `archived` | 归档 | tree_leaf_set_status 主动 | 隐藏（list_active 不显示）；include_archived=true 才查到 |
| `segment_pending` | 竹节交接过渡态 | tree_segment_append 触发 | 新 session_id 接管后由引擎转回 active |

**状态流转规则** (`STATUS_TRANSITION_RULES`, P0-3 修复):

```
pending_brief → active (set-session 后)
active → done | pruned | archived | segment_pending
done → archived (不可回 active，P0-3 拦 E_STATUS_TRANSITION_INVALID)
pruned → active (可恢复)
archived → active (可恢复，但需 audit_gate 重新 required)
segment_pending → active (新 session 接管)
```

---

## 5. EVENT_TYPE_ENUM — 8 种事件 meta 差异表

> 来源: tree_event_append 入参 `type`；engine EVENT_TYPE_ENUM；meta 字段因 type 而异。
> 每种 event 的 meta schema 见下表。append-only（删不掉），所以 schema 错会永久卡 done 门禁（macp3 教训）。

| event type | 触发场景 | meta 必填字段 | meta 可选字段 | 引擎校验 |
|---|---|---|---|---|
| **`done`** | 全部 milestones 完成 + self_check 全过 | `self_check: [{item, pass:boolean, evidence:string≥10字}]`（V6 schema，至少 1 项 pass:true） / `deliverables: string[]` / `milestones: [{id, audit_pass, note_path}]`（**注：仅 done event 回填关键字段，完整 milestone schema 见 §7**） / `context_usage: number` / `drift_declaration: boolean` | `red_findings_resolved: [{finding_id, fix_method, fix_evidence≥20字}]`（P1b，仅 review_round 有 red 时） | caller === leaf.session_id（Bug A-1）；self_check schema；不能全 false |
| **`blocked`** | 卡点上报 | `obstacle: string` / `tried: string[]`（≥1）/ `options: [{id, desc, cost}]`（≥2）/ `wait_for: "decision"` | 无 | options 数量 ≥2 |
| **`plan`** | 拆解孙任务上报 | `sub_missions: [{name, dod, est_steps?}]`（≥1）/ `silence_ack_seconds: int 60-300`（默认 300）/ `status: string` | 无 | silence_ack_seconds 范围 |
| **`brief_echo`** | 收到 brief 后首条消息（worker）/ 对齐评估回填（commander 或独立 auditor） | worker 变体：`my_understanding: object` / `milestones_preview: string[]`（≥1）；alignment 回填变体：`alignment: int 0-100` / `auditor_session_id: UUIDv4` | `my_understanding.why_this_exists` | V5b: worker set-status done 时引擎查 events 必有 ≥1 条带 alignment+auditor_session_id 的 brief_echo（root 信任锚 auditor_session_id === root.session_id） |
| **`heartbeat_reply`** | sentinel agent 周期巡逻回应 | `verdicts: [{rule_id, pass:boolean, evidence?}]` | 无 | E_TS_NOT_MONOTONIC；rule_id 合法性 |
| **`nudge`** | Tao Watcher 违规提醒 | `rule_id: string`（如 `W-01`/`R-04`/`W-AUDIT-SELF`）/ `severity: enum(low/medium/high)` | 无 | rule_id 在 35 规则表内；副作用：nudge_count += 1，达 7 → E_LEAF_AUTO_PRUNED |
| **`limit`** | autonomy_override 限权 | `added_must_ask: string[]` / `removed_can_decide: string[]` | 无 | 字段非空（至少一边） |
| **`status_check`** | 状态自检留痕 | 无强制（自由 meta） | 任意 | 仅时间戳校验 |

### 5.1 额外事件类型（不在 EVENT_TYPE_ENUM 主表，引擎单独支持）

| event type | 触发场景 | meta 必填字段 | 关键校验 |
|---|---|---|---|
| **`subagent_spawn`** | worker spawn SubAgent（implement/research/review） | `subagent_id: "sub:<本leaf_id>:<序号>"` / `role: enum(implement/research/review)` / `purpose: string` / `output_ref: string`（相对 deliverables 根）/ `status: enum(done/failed)`；review 角色必填 `perspective: enum(G1-G5)` | subagent_id 父段必须=本leaf_id（E_SCHEMA_INVALID）；status=done 时 output_ref 文件必须存在+size>0（E_DELIVERABLE_MISSING / E_DELIVERABLE_EMPTY） |
| **`review_round`** | done 前 G1-G5 多 SubAgent 内容审查收敛（ISS-003，review_required=true 时强制） | `round_no: int` / `reviewers: [{reviewer_kind, reviewer_ref?, reviewer_session_id?, perspective, findings: [{severity, item, evidence≥10字}]}]` / `red_count: int` / `converged: boolean` / `independence: enum(self_delegated/independent)` | reviewer_kind:subagent 时 reviewer_ref 父段=本leaf_id 且必须溯源本 leaf 的 subagent_spawn 事件（E_REVIEW_FORGERY）；reviewer_kind:session 时 reviewer_session_id 走 UUID_RE；done 门禁：末轮 red_count===0 + 总轮数≤3 |

---

## 6. audit_gate 子结构

```json
{
  "verdict": "pass",                    // enum: pass | required | skip
  "auditor_session_id": "ce9a1e2f-...", // null 时未审计；pass/required 时必填 UUIDv4
  "ts": "2026-07-14T23:15:00.000+08:00",// null 时未审计；ISO8601
  "auto_upgrade": true                  // bool；root 作 Trust Anchor 时为 true（C5 修复后必显式传）
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `verdict` | enum | ✅ | `VERDICT_ENUM = ['pass', 'required', 'skip']`；默认 `required`（leaf_add 时） |
| `auditor_session_id` | UUIDv4 \| null | pass/required 时必填 | 必须 ≠ leaf.session_id（self-audit 禁）/ ≠ leaf.parent.session_id / ≠ root.session_id（除 root 自审特例外）；V2 白名单 / V10-auditor-active 三重校验 |
| `ts` | ISO8601 \| null | pass 时必填 | ≥ leaf.created_at；≥ 上一条 event ts；≤ now+60s |
| `auto_upgrade` | bool | ❌ | 默认 false；root 作 Trust Anchor 时 true（C5 修复后不允许 null auditor_session_id 隐式升级） |

**调用入口**: `tree_audit_gate(verdict, audit_session_id, reason?)`。
**关键修复**:
- Bug A-2 (IHL V10 P3): `caller === audit_session_id` 校验（堵 auditor #2 发现的 hasDone 漏洞）
- C5: root 自审必须显式传 `audit_session_id === leaf.session_id`，不允许 null
- V10-auditor-active: auditor leaf 自身必须 status=done + events 非空 + 自己 audit_gate.verdict=pass

---

## 7. milestone 子结构（milestones[i]）

```json
{
  "id": "M1",
  "desc": "data-model.md 产出（formal schema 表格 + 8 种 event 差异 + 各子结构）",
  "expect_outputs": ["data-model.md"],
  "status": "done",                     // 派生：从 audit_pass 推断
  "audit_pass": true,                   // V4: true 需独立 audit_session_id
  "note_path": "commander-trust-anchor-cold-start",
  "auditor_session_id": "124ccb14-..."  // V4 必填（audit_pass=true 时）
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `id` | string | ✅ | 同 leaf 内唯一；命名风格 `M1` / `M2` / `M2a`；建议短 |
| `desc` | string | ❌（建议）| 一句话描述里程碑目标 |
| `expect_outputs` | string[] | ✅ | V3 修复：必须非空数组；每项相对 deliverables 根（禁带 `deliverables/` 前缀，禁绝对路径，禁 `..`） |
| `status` | enum | ❌ | 派生字段，引擎推断；通常 `pending` / `done` |
| `audit_pass` | bool | ✅ | 默认 false；set-result 修改；done event 前必须所有 milestone 全 true |
| `note_path` | string | ❌ | 关联 `.note.md`（决策日志）路径；建议每个 milestone 配一份 |
| `auditor_session_id` | UUIDv4 | audit_pass=true 时必填 | V4 (v0.7 批次5)：必须独立于 leaf 自己 / 父 / 根（root 信任锚除外）；caller === audit_session_id 强校验 |

**调用入口**:
- `tree_milestone_add` — 创建（expect_outputs 必非空）
- `tree_milestone_set_result(audit_pass, audit_session_id?, note_path?)` — 设审计结果

**错误码**:
- `E_AUDITOR_NOT_INDEPENDENT` — auditor === leaf / 父 / 根
- `E_AUDITOR_NOT_DONE` / `E_AUDITOR_NO_EVENTS` / `E_AUDITOR_NOT_VERIFIED` — V10-auditor-active
- `E_BORROWED_IDENTITY` — V10-self-audit-forbidden-v2: caller ≠ audit_session_id

---

## 8. nudge_log 子结构（nudge_log[i]）

```json
{
  "rule_id": "W-AUDIT-SELF",
  "severity": "high",
  "ts": "2026-07-14T23:20:00.000+08:00"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `rule_id` | string | ✅ | Tao Watcher 35 规则之一；前缀分类：`W-*`（行为）/ `R-*`（关系）/ `C-*`（校准）/ `W-AUDIT-*`（篡改检测） |
| `severity` | enum | ✅ | `low` / `medium` / `high`；3→medium, 5→high, 7→强制 pruned |
| `ts` | ISO8601 | ✅ | 单调递增；≥ leaf.created_at |

**调用入口**: `tree_nudge_append(rule_id, severity?)`（副作用：nudge_count += 1）；`tree_nudge_reset()`（清空 nudge_count + nudge_log）。

---

## 9. drift 子结构（drift_history[i] / drift_log[i]）

```json
{
  "kind": "production",
  "severity": "mid",
  "action": "self_correct",
  "fork_to": null,
  "reason": "M2 自审第 1 轮 severity=mid，按 suggestion 自纠 1 次后过",
  "ts": "2026-07-14T23:25:00.000+08:00"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `kind` | enum | ✅ | `production`（生产偏差）/ `direction`（方向偏差）/ `rhythm`（节奏偏差） |
| `severity` | enum | ✅ | `low` / `mid` / `high`（注意：与 nudge 的 `medium` 拼写不同） |
| `action` | enum | ✅ | `nudge` / `limit` / `prune` / `self_correct` / `declare` / `handoff` |
| `fork_to` | leaf_id \| null | ❌ | 仅 action=handoff 时填（竹节交接 / 重 Fork） |
| `reason` | string | ❌ | 自纠 / 上报 / 升级的原因 |
| `ts` | ISO8601 | ✅ | 单调递增 |

**典型映射**（自审结果 → drift 记录）:

| 自审场景 | kind | severity | action |
|---|---|---|---|
| 自纠成功（1/2 次修正后 low） | production | low | self_correct |
| 2 次自纠仍 mid+，上报声明 | production | mid | declare |
| 撞 out_of_scope，请示指挥官 | direction | mid | declare |
| 上下文 ≥85% 主动声明 | rhythm | low | handoff |

**调用入口**: `tree_drift_append(kind, severity, action, fork_to?, reason?)`。
**双向写入**: 引擎同步写 leaf.drift_history 和 tree.drift_log（冗余便于跨 leaf 查询）。

---

## 10. session_registry 子结构（Sprint 5 / macp2 后引入）

```json
{
  "session_id": "8a00124d-76e2-4cfd-be49-4dc21fbd723a",
  "source": "create_session",          // enum: create_session | fork_session | leaf_add | bypass
  "caller": "124ccb14-5a38-45bc-8112-e894e9c4fd36",  // 调用方 session_id
  "ts": "2026-07-14T23:09:43.293+08:00"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `session_id` | UUIDv4 | ✅ | 全树唯一；与 leaf.session_id 一致或为 bypass 会话 |
| `source` | enum | ✅ | `create_session`（worker 正常派生）/ `fork_session`（commander 派生）/ `leaf_add`（leaf_add 同步登记）/ `bypass`（SDK-native create_session 但未入 leaf） |
| `caller` | UUIDv4 \| null | ✅ | root 为 null；其他 = 父 session_id |
| `ts` | ISO8601 | ✅ | 单调递增 |

**调用入口**: `tree_register_session(session_id, source, caller?)`。
**预算校验**: 引擎注册时比对 `audit_meta.max_sessions`（默认 30）；超过 → `E_MAX_SESSIONS`。
**背景**: macp2 事故（2026-07-08）4 分钟炸 207 会话，DeepSeek 余额打负；本字段是硬护栏。

---

## 11. segment_chain 子结构（竹节交接）

```json
{
  "segment_no": 1,
  "old_session_id": "abc-uuid-...",
  "new_session_id": "def-uuid-...",
  "ts": "2026-07-14T23:30:00.000+08:00",
  "reason": "context_usage_pct 85% 触发竹节交接"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `segment_no` | int | ✅ | 从 1 起；leaf 内递增 |
| `old_session_id` | UUIDv4 | ✅ | 上一段 session（接管前的） |
| `new_session_id` | UUIDv4 | ✅ | 新一段 session（接管后的）；leaf.session_id 同步更新为新值 |
| `ts` | ISO8601 | ✅ | 单调递增 |
| `reason` | string | ❌ | 典型："context_usage_pct 85%" / "新增 SubAgent 分工" / "skill 隔离" |

**调用入口**: `tree_segment_append(new_session_id)`（old_session_id 引擎自动从 leaf.session_id 取）。
**状态联动**: append 后 leaf.status 短暂为 `segment_pending`，新 session 第一次 event_append 后引擎转回 `active`。

---

## 12. heartbeats[i] 子结构

```json
{
  "ts": "2026-07-14T23:35:00.000+08:00",
  "leaf_id": "e2e03-B-worker",
  "verdicts": [
    {"rule_id": "W-01", "pass": true, "evidence": "brief_echo 存在"},
    {"rule_id": "W-AUDIT-SELF", "pass": true, "evidence": "audit_gate auditor ≠ leaf.session_id"}
  ]
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `ts` | ISO8601 | ✅ | Tao Watcher 周期（5 min/圈） |
| `leaf_id` | string | ✅ | 被巡逻的 leaf |
| `verdicts` | array | ✅ | 35 规则的判定结果 |

**调用入口**: `tree_heartbeat_append(heartbeat)`。
**查询**: `tree_heartbeat_tail(leaf_id?, n?)`。

---

## 附录 A — 关键正则与默认值

### A.1 ROLE_ENUM
```
['root', 'commander', 'worker', 'auditor']
```

### A.2 STATUS_ENUM
```
['active', 'done', 'pruned', 'archived', 'pending_brief', 'segment_pending']
```

### A.3 LEAF_NAME_RE
```regex
/^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$/
```
- 段 1 `prefix`: 小写字母开头，4-8 字符，仅 `[a-z0-9_]`
- 段 2 `path`: 树定位（root 空 / 子 `A` `B` `C` / 孙 `A1` `A2` / 曾孙 `A1a` `A1b`）；**不允许两个连续大写字母**（如 `RT` 非法）
- 段 3 `role`: 角色短名，可含连字符（如 `eval` `api` `ui`）
- 段 4 `suffix`: 可选；`s<N>` 表竹节 / `i<N>` 表尝试序号

**示例**: `e2e03-B-worker` = e2e03 项目第 2 子（B）执行 worker 角色。

### A.4 EVENT_TYPE_ENUM（event_types 字面值）

> 关键字 `event_types` 在多文档中作为搜索锚（grep event_types → 命中本节）；引擎常量名为 `EVENT_TYPE_ENUM`。

```
['done', 'blocked', 'plan', 'brief_echo', 'heartbeat_reply',
 'nudge', 'limit', 'status_check']
```
（额外：`subagent_spawn` / `review_round` 走专门校验链）

### A.5 VERDICT_ENUM
```
['pass', 'required', 'skip']
```

### A.6 默认配置（root_dod + audit_meta）

| 配置项 | 默认值 | 来源 |
|---|---|---|
| `max_depth` | 3 | root_dod；CP3 校验 |
| `node_budget` | 20 | root_dod（macp2 后 10→20）；CP2 校验 |
| `audit_meta.max_sessions` | 30 | macp2 后引入；E_MAX_SESSIONS |
| `audit_meta.max_subagent_spawn_per_leaf` | 15 | macp2 后引入；E_SUBAGENT_BUDGET_EXCEEDED |
| `audit_meta.review_required` | true | ISS-003；done 前 review_round 收敛；root_dod 显式覆盖时按 root_dod |
| `nudge_escalation` | 3→medium, 5→high, 7→pruned | tree_nudge_append 副作用 |
| `ts_tolerance` (future) | now + 60s | V10-timestamp-monotonic |
| `stale_tree_hours` | 24 | Tao Watcher 自动归档超时树 |
| `self_audit.max_self_corrections` | 2 | 五件套；超 → drift declare |
| `self_audit.audit_after_each_milestone` | true | 五件套 |
| `report_protocol.plan_ack_seconds` | 300 | 五件套；worker brief_echo 默认放行窗口 |

### A.7 STATUS_TRANSITION_RULES (P0-3)

```
pending_brief → active
active → done | pruned | archived | segment_pending
done → archived                （不可回 active）
pruned → active                （可恢复）
archived → active              （audit_gate 重新 required）
segment_pending → active
```

违例 → `E_STATUS_TRANSITION_INVALID`。

---

## 附录 B — done event 完整 meta 示例

```json
{
  "type": "done",
  "ts": "2026-07-14T23:40:00.000+08:00",
  "meta": {
    "self_check": [
      {
        "item": "data-model.md 落盘 deliverables/",
        "pass": true,
        "evidence": "fs.statSync deliverables/data-model.md 存在且 size > 0；路径相对 deliverables 根填写"
      },
      {
        "item": "顶层字段表柱 ≥9 字段",
        "pass": true,
        "evidence": "§1 表格列出 11 个顶层字段（schema_version 到 session_registry）"
      },
      {
        "item": "leaf 全字段表柱 ≥20 字段",
        "pass": true,
        "evidence": "§2 表格列出 26 个字段（leaf_id 到 self_audit）"
      },
      {
        "item": "8 种 event meta 差异表柱",
        "pass": true,
        "evidence": "§5 主表 8 行（done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check）+ §5.1 额外 2 行（subagent_spawn/review_round）"
      },
      {
        "item": "milestone / nudge / drift / session_registry 子结构表柱",
        "pass": true,
        "evidence": "§7 milestone 7 字段 / §8 nudge_log 3 字段 / §9 drift 6 字段 / §10 session_registry 4 字段 全部柱状"
      },
      {
        "item": "role / status 枚举表柱",
        "pass": true,
        "evidence": "§3 ROLE_ENUM 4 行（root/commander/worker/auditor 含权限+约束）；§4 STATUS_ENUM 6 行（含流转规则）"
      }
    ],
    "deliverables": ["data-model.md"],
    "milestones": [
      {
        "id": "M1",
        "audit_pass": true,
        "note_path": "commander-trust-anchor-cold-start"
      }
    ],
    "context_usage": 38,
    "drift_declaration": false
  }
}
```

---

## 附录 C — 跨文档一致性约定

| 字段名 | 文档同步源 | 同步目标 |
|---|---|---|
| `ROLE_ENUM` | 本文档 §3 + API.md §7.1 | tree-engine.cjs ROLE_ENUM 常量 |
| `STATUS_ENUM` | 本文档 §4 + API.md §7.2 | tree-engine.cjs STATUS_ENUM 常量 |
| `LEAF_NAME_RE` | 本文档 §附录 A.3 + API.md §7.3 | tree-engine.cjs LEAF_NAME_RE 常量 |
| `EVENT_TYPE_ENUM` | 本文档 §5 + API.md §7.4 | tree-engine.cjs EVENT_TYPE_ENUM 常量 |
| `VERDICT_ENUM` | 本文档 §6 + API.md §7.5 | tree-engine.cjs VERDICT_ENUM 常量 |
| 默认配置 | 本文档 §附录 A.6 + API.md §7.6 | tree-engine.cjs DEFAULT_* 常量 |

**铁律**: 新增字段 / 类型变更必须同时更新本文档 + API.md §7 + 引擎常量，否则触发 CLAUDE.md「文档引擎一致性 P0 高发区」告警。

---

## 修订历史

| 日期 | 版本 | 主要变更 |
|---|---|---|
| 2026-07-14 | 1.0 | e2e03 tree-system worker B 首次产出（补 P1-11 formal schema 缺口）；统一 8 种 event meta 差异；新增 Sprint 5 session_registry 子结构 |
