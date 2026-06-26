# 03 — v0.7 实施路线图

> **日期**: 2026-06-23
> **性质**: 实施计划（待专家组批准）
> **配套**: `06-decision-log.md`（所有关键决策的选项/选择/理由）
> **依赖**: `expert-review-v2-2026-06-23/01-questions.md`（8 个决议题）、`tree-system-architecture-analysis-2026-06-23.md`（v2 诊断报告）、`expert-review-2026-06-23/03-v0.6-revised-plan-draft.md`（原 v0.6 计划）、`architecture-analysis-2026-06-23.md`（路线评估）

---

## 1. 计划合并总览

### 1.1 合并逻辑

| 原计划 | 内容 | 合并后 |
|---|---|---|
| **v0.5** | 4 个用户层 bug（剪枝语义 / skill 全局 / watcher / 命名） | v0.7 Phase D |
| **v0.6** | Phase 6 审计硬约束 8 个子步骤（CP1-CP6 + SP1 + SP4） | v0.7 Phase A |
| **v2 新增** | depth ≤ 3 / role enum / Capability Token / 主动 supervision / event hash chain / liveness | v0.7 Phase A（depth/role）+ Phase B（supervision）+ Phase C（Capability）+ Phase E（hash chain）+ Phase F（liveness） |

**合并理由**：
1. v0.5 / v0.6 高度耦合（都改 tree-state.js + commander/worker SKILL.md），分批做反而增加 migrate 次数
2. 一次性 commit 减少协调成本，避免三次 migrate 用户数据
3. v2 诊断报告明确了架构层硬约束是根本解法——分散实施等于持续暴露于已知风险

### 1.2 总览大表

| Phase | 优先级 | 内容 | 文件数 | 估算时间 | 依赖 | 来源 |
|---|---|---|---|---|---|---|
| **A** | P0 | DbC 硬约束（CP1-CP6+SP1+SP4）+ depth/role 校验 | tree-state.js + 2 SKILL.md | 4-5 小时 | 无（先做） | v0.6 Phase 6 + v2 §6/§9 |
| **B** | P1 | 主动 Supervision（commander 持 worker lifecycle） | commander SKILL.md + tree-state.js | 2-3 天 | Phase A（共用 tree-state.js） | v2 §4.6 Erlang OTP |
| **C** | P1 | Capability Token（Fork 时颁发，工具调用前校验） | patches.cjs + tree-state.js + 2 SKILL.md | 2-3 天 | Phase A（需 tree-state.js schema 基础） | v2 §4.7 seL4/Fuchsia |
| **D** | P1 | 用户层 Bug 修复（剪枝/skill 全局/watcher 简化） | 3-4 文件 | 4 小时 | 无（独立改动） | 原 v0.5 |
| **E** | P2 | Event Hash Chain + Snapshot | tree-state.js | 1-2 天 | Phase A（event 操作基础） | v2 §4.9 Event Sourcing |
| **F** | P2 | Liveness Heartbeat | patches.cjs | 半天 | Phase B（supervisor 基础） | v2 §5 P1 项 |
| **G** | — | 部署 + 验证 + Wiki + Commit | — | 用户配合 | Phase A-F 全部完成 | — |

**建议执行顺序**：A + D 并行（互不依赖）→ B → C → E + F 并行 → G

---

## 2. Phase A — DbC 硬约束（P0，4-5 小时）

> 目标：把 skill.md 里的"应当"升级为 tree-state.js 子命令层的"必须"。覆盖 v0.6 Phase 6 全部 8 个子步骤 + v2 新增 depth/role 校验。

### A1: 文件存在性校验（CP1）— 对应 v0.6 §6.1

| 维度 | 内容 |
|---|---|
| **问题** | `leaf set-status done` 不验 `milestone.expect_outputs` 文件真在磁盘上。Worker 声称产出 8556 bytes 但文件不存在也 pass。 |
| **改什么文件** | `release/tree-system-v0.2.2/core/tree-state.js` — `cmdLeafSetStatus`（约 line 817-898） |
| **加什么校验** | `status=done` + `role=worker` 时，遍历 `milestones[].expect_outputs[]`，逐个 `fs.existsSync()` |
| **新增字段** | `state._deliverables_root`（state 顶层，初始化为 `<tree_dir>/deliverables`） |
| **新增错误码** | `E_DELIVERABLE_MISSING` |
| **代码草案** | 见 v0.6 计划 §6.1 |
| **风险** | 现有 tree 数据 expect_outputs 路径写法不统一（绝对/相对），migrate 时需 normalize |

### A2: auditor 独立性校验（CP2）— 对应 v0.6 §6.2

| 维度 | 内容 |
|---|---|
| **问题** | `audit-gate` 只校验 UUID 格式，不校验是不是 commander 自己。大量 auditor_session_id=commander。 |
| **改什么文件** | `cmdAuditGate`（约 line 1689-1723） |
| **加什么校验** | `verdict=pass/required` 时，校验 `auditor !== commander && auditor !== root && auditor !== null` |
| **新增错误码** | `E_AUDITOR_NOT_INDEPENDENT` |
| **配套** | commander SKILL.md §7 加铁律："派 Agent 后必须把返回的 session_id 写入 audit_gate.auditor_session_id。该字段为 null 或等于自己 = audit 无效。" |
| **代码草案** | 见 v0.6 计划 §6.2 |

### A3: alignment 字段保护（CP3）— 对应 v0.6 §6.3

| 维度 | 内容 |
|---|---|
| **问题** | commander 自填对齐度 "98%"、"97%"。 |
| **改什么文件** | `cmdEventAppend`（brief_echo 事件的 meta.alignment 校验） |
| **加什么校验** | alignment 字段存在时，必须附带 `auditor_session_id`，否则返 `E_ALIGNMENT_NOT_VERIFIED` |
| **新增错误码** | `E_ALIGNMENT_NOT_VERIFIED` |
| **配套** | commander SKILL.md §7："brief_echo 上行时 alignment 数值必须由 Agent 输出注入，不能由 commander 自己写入。commander 自己写 = 视为 0% 对齐，自动 nack。" |
| **风险** | 现有 brief_echo 数据可能无 auditor_session_id，migrate 打 warning 但不强制补全 |

### A4: 节点数硬上限（CP4）— 对应 v0.6 §6.4

| 维度 | 内容 |
|---|---|
| **问题** | `leaf add` 无节点数校验，tree-2 飙到 14 节点。 |
| **改什么文件** | `cmdLeafAdd`（约 line 514-650） |
| **加什么校验** | `activeCount >= maxLeaves` 时 throw，`maxLeaves` 来源优先级：args.max-leaves > root_dod.node_budget > 默认 10 |
| **新增字段** | `root_dod.node_budget`（默认 10） |
| **新增错误码** | `E_TREE_NODE_BUDGET_EXCEEDED` |
| **代码草案** | 见 v0.6 计划 §6.4 |

### A5: self_check schema 校验（CP5）— 对应 v0.6 §6.5

| 维度 | 内容 |
|---|---|
| **问题** | worker 的 self_check 是字符串 `"all_pass"` 而非 `[{item, pass, evidence}]` 数组。 |
| **改什么文件** | `cmdEventAppend` 或 `cmdLeafSetStatus` |
| **加什么校验** | done 事件上行时，校验 self_check 为 non-empty array，每项含 `item`(string)、`pass`(boolean)、`evidence`(string) |
| **新增错误码** | `E_SELFCHECK_INVALID` |
| **风险** | 现有 done 事件的 self_check 都是字符串。migrate 时把字符串 `"all_pass"` 自动转为 `[{item: "legacy", pass: true, evidence: "migrated from string"}]`，打 warning |

### A6: archived 前强制 validate（CP6）— 对应 v0.6 §6.6

| 维度 | 内容 |
|---|---|
| **问题** | validate 失败 13 处仍续跑 + 收尾 + backup。 |
| **改什么文件** | `tree set-status archived` 子命令 |
| **加什么校验** | `target=tree` + `new_status=archived` 时，先跑 `validateTree(state)`，`!ok || issues.length > 0` 则 throw |
| **新增错误码** | `E_TREE_NOT_VALIDATED` |
| **风险** | 现有已 archived 的 tree 已违反此规则，migrate 打 warning 但不强制 unarchive |

### A7: audit 时序校验（SP1）— 对应 v0.6 §6.7

| 维度 | 内容 |
|---|---|
| **问题** | A1 audit_gate.ts 早于 plan 事件 0.3 秒（时序倒挂）。 |
| **改什么文件** | `cmdAuditGate` |
| **加什么校验** | `audit-gate pass` 时校验 `leaf.events` 中存在 `ts < audit_ts` 的 done 事件，否则返 `E_AUDIT_PREMATURE` |
| **新增错误码** | `E_AUDIT_PREMATURE` |

### A8: commander context 保护（SP4）— 对应 v0.6 §6.8

| 维度 | 内容 |
|---|---|
| **问题** | commander context 671% 无任何 drift 预警。 |
| **改什么文件** | commander SKILL.md §9 "心跳通道"部分 + 新增 `tree-state.js context check <tree>` 子命令 |
| **加什么机制** | commander 每次处理完一批事件后调 `get_session_context(self)`，`context_usage_pct > 80` 时 append drift kind=context severity=high，backup + 提示用户 Fork root |
| **风险** | DeepSeek V4 Pro 实际能否稳定调用 get_session_context 并写 drift，未验证 |

### A9: 层级深度硬限制 + role enum 校验（v2 新增）— 对应 01-questions.md 议题 3

| 维度 | 内容 |
|---|---|
| **问题** | `tree-state.js` 的 `role` 字段是自由文本，`leaf add` 无 depth 校验。qfv2 实测跑到 5 层深。 |
| **改什么文件** | `cmdLeafAdd`（加 depth 校验 + role enum 校验） |
| **加什么校验** | (a) `computeLeafDepth()` 遍历 parent 链计算深度，`depth >= maxDepth` 时 throw `E_TREE_DEPTH_EXCEEDED`；(b) role 必须为 `root/commander/worker/auditor/integrator` 之一，否则 throw `E_ROLE_INVALID` |
| **新增字段** | `root_dod.max_depth`（默认 3，硬上限 5） |
| **新增错误码** | `E_TREE_DEPTH_EXCEEDED`、`E_ROLE_INVALID` |
| **代码草案** | 见 v2 报告 §9.1 + §9.2（computeLeafDepth + role enum + root_dod 扩展） |
| **风险** | qfv2 这种已跑出来的 5 层 tree 下次 add leaf 会被拦，用户体验差但安全必须 |

### Phase A 错误码汇总

| 错误码 | 子步骤 | 触发条件 |
|---|---|---|
| `E_DELIVERABLE_MISSING` | A1 | done 时 expect_outputs 文件不存在 |
| `E_AUDITOR_NOT_INDEPENDENT` | A2 | auditor 为 null / commander / root |
| `E_ALIGNMENT_NOT_VERIFIED` | A3 | alignment 无 auditor_session_id |
| `E_TREE_NODE_BUDGET_EXCEEDED` | A4 | activeCount >= maxLeaves |
| `E_SELFCHECK_INVALID` | A5 | self_check 非数组或缺少必填字段 |
| `E_TREE_NOT_VALIDATED` | A6 | archive 前 validate 失败 |
| `E_AUDIT_PREMATURE` | A7 | audit-gate pass 时无 ts < audit_ts 的 done 事件 |
| `E_TREE_DEPTH_EXCEEDED` | A9 | depth >= max_depth |
| `E_ROLE_INVALID` | A9 | role 不在允许 enum 内 |

---

## 3. Phase B — 主动 Supervision（P1，2-3 天）

> 目标：commander 持有 worker lifecycle，worker 失败立即接管（不等 TAO Watcher 下个 tick）。对应 v2 报告 Layer 2。

### B1: commander SKILL.md 加 worker lifecycle 管理

| 维度 | 内容 |
|---|---|
| **改什么文件** | `skills/tree-commander/SKILL.md` |
| **加什么** | §X "Worker Lifecycle Management"：child spec（restart 策略、shutdown 超时、max_restarts）、失败立即接管流程、防抖窗口配置 |
| **防抖窗口** | Erlang OTP 式 `max_restarts`/`max_seconds`：10 秒内重启 4 次 → supervisor 自杀向上 escalate |

### B2: tree-state.js 加 child spec 字段

| 维度 | 内容 |
|---|---|
| **改什么文件** | `release/tree-system-v0.2.2/core/tree-state.js` |
| **加什么字段** | `leaf.child_spec`：`{ restart: 'permanent'|'transient'|'temporary', max_restarts: number, max_seconds: number, shutdown_timeout_ms: number }` |
| **关联** | `cmdLeafAdd` 时可选写入 child_spec，默认 `{ restart: 'transient', max_restarts: 3, max_seconds: 600, shutdown_timeout_ms: 30000 }` |

### B3: commander SKILL.md 加接管流程

| 维度 | 内容 |
|---|---|
| **接管流程** | (1) fork 前审查 → (2) 下发 brief → (3) listen 状态变更 event → (4) done/fail 时检查 child_spec → (5) fail 时根据 restart 策略决定 retry/escalate → (6) retry 超 max_restarts 时 escalate 到 root |

---

## 4. Phase C — Capability Token（P1，2-3 天）

> 目标：Fork 时给 worker 颁发 capability token，工具调用前校验。对应 v2 报告 §4.7 seL4/Fuchsia 的 capability-based security。

### C1: patches.cjs 加工具调用拦截

| 维度 | 内容 |
|---|---|
| **改什么文件** | `proma-dev-patches.cjs` |
| **加什么** | 在 MCP 工具调用路径上加拦截层：每次 `write_file`/`bash` 等敏感工具调用前，查 tree-state.js 的 capability store，校验 token 是否包含该工具权限 |
| **复杂度** | 需要改 Proma 平台工具调用层，这是本 Phase 工作量的主要来源 |

### C2: tree-state.js 加 token 颁发/校验

| 维度 | 内容 |
|---|---|
| **改什么文件** | `tree-state.js` |
| **加什么** | `cmdCapabilityIssue`（Fork 时颁发 token）、`cmdCapabilityCheck`（工具调用前校验） |
| **token schema** | `{ worker_id, tools: string[], write_paths: string[], ttl_seconds, max_tokens, parent, issued_at }` |
| **安全约束** | token 不能放 prompt 里（LLM 会读到并学会自降权）。token 存在 tree-state.js / 外部 store，仅工具调用时同步校验，LLM 永远不直接接触 token 内容。 |

### C3: 关联 — Fork 时自动颁发 token

| 维度 | 内容 |
|---|---|
| **关联** | commander SKILL.md + worker SKILL.md：Fork worker 时自动调 `cmdCapabilityIssue`，token ttl 默认 30min |
| **worker 侧** | worker 调用 write_file/bash 等工具时，patches.cjs 拦截层查 token，无权限直接 throw `E_CAPABILITY_DENIED` |

---

## 5. Phase D — 用户层 Bug 修复（P1，4 小时）

> 目标：修复原 v0.5 计划的 4 个用户层 bug。与 Phase A 并行（互不依赖）。

### D1: 剪枝语义拆分

| 维度 | 内容 |
|---|---|
| **问题** | prune 语义混乱（标记/删除/归档混在一起）。 |
| **修法** | 拆 prune（标记）/ archive（统一）语义，加 `archived_session` 字段，worker 禁自剪 |
| **改什么文件** | tree-state.js + worker SKILL.md + commander SKILL.md |
| **工作量** | 60 min |

### D2: skill 自带基础设施 + 全局

| 维度 | 内容 |
|---|---|
| **问题** | skill 不自带所需基础设施（依赖外部安装），skill 不全局（需手动拷贝到每个 workspace）。 |
| **修法** | migrate-existing-workspaces.cjs 改为不覆盖策略（版本号比较）；skill 部署脚本改为全局同步 |
| **改什么文件** | migrate-existing-workspaces.cjs + 部署脚本 |
| **工作量** | 40 min |

### D3: watcher 简化

| 维度 | 内容 |
|---|---|
| **问题** | watcher 设计模糊，用户不理解监控范围。 |
| **修法** | 删除 setTimeout 自调度重构（过度设计）；加 `last_activity_ts` + `silence_minutes` 字段；status IPC 返回这两个字段；浮窗 UI 第二层 tab 上加 silence badge（>60min 灰色"静默 N min"） |
| **改什么文件** | patches.cjs（TAO Watcher 部分） |
| **工作量** | 15 min |

### D4: 命名规范化（如有）

| 维度 | 内容 |
|---|---|
| **问题** | 字段命名不统一（历史遗留）。 |
| **修法** | 统一命名约定，不改变语义 |
| **改什么文件** | tree-state.js |
| **工作量** | 15 min |

---

## 6. Phase E — Event Hash Chain + Snapshot（P2，1-2 天）

> 目标：每个 event 包含 `prev_hash`，形成不可篡改链。worker 伪造 auditor_session_id 时链会断。对应 v2 报告 §4.9。

| 维度 | 内容 |
|---|---|
| **改什么文件** | `tree-state.js` — `cmdEventAppend` |
| **加什么** | (a) 每个 event append 时计算 `prev_hash = SHA256(prev_event)`；(b) `cmdValidateChain` 子命令全链验证；(c) `cmdSnapshot` 子命令（序列化当前 state + event log，用于 debug replay） |
| **新增字段** | `event.hash`、`state.last_hash` |
| **依赖** | Phase A（event 操作基础 + 错误码体系已建立） |

---

## 7. Phase F — Liveness Heartbeat（P2，半天）

> 目标：加到 TAO Watcher，区分"软违规"（慢但不死）和"硬死"（卡住不动）。对应 v2 报告 §5 P1 项。

| 维度 | 内容 |
|---|---|
| **改什么文件** | `proma-dev-patches.cjs`（TAO Watcher 部分） |
| **加什么** | (a) 每个被监控 session 定期 ping `get_session_context`；(b) 连续 N 次 ping 无响应 → append drift kind=liveness severity=critical；(c) 与 commander context 保护（A8）互补——A8 是 commander 自查，F 是外部 watchdog |
| **依赖** | Phase B（supervision 基础有了后，liveness 才有上下文） |

---

## 8. Phase G — 部署 + 验证 + Wiki + Commit（用户配合）

| 步骤 | 内容 | 执行人 |
|---|---|---|
| G1 | 全部代码改动合并到 release 目录 | Agent |
| G2 | 运行 6 组测试（见 §11） | Agent + 用户 |
| G3 | migrate 16 个历史 tree | Agent |
| G4 | 更新 wiki（proma-dev-wiki.md）+ PROJECT-INDEX.md | Agent |
| G5 | Git commit（一次性，单 commit） | 用户确认后 |
| G6 | 用户验证（手动跑实际任务） | 用户 |

---

## 9. 工作量估算总表 + 甘特图

### 9.1 工作量估算

| Phase | 内容 | 估算 | 文件数 | 新增错误码 |
|---|---|---|---|---|
| A | DbC 硬约束 + depth/role | 4-5 小时 | 3 | 9 个 |
| B | 主动 Supervision | 2-3 天 | 2 | 0（复用 Phase A 错误码体系） |
| C | Capability Token | 2-3 天 | 3 | 2（E_CAPABILITY_DENIED + E_TOKEN_EXPIRED） |
| D | 用户层 Bug 修复 | 4 小时 | 4 | 0 |
| E | Event Hash Chain + Snapshot | 1-2 天 | 1 | 1（E_CHAIN_BROKEN） |
| F | Liveness Heartbeat | 半天 | 1 | 0 |
| G | 部署 + 验证 + Wiki + Commit | 用户配合 | 5 | — |
| **总计** | | **2-3 周编码 + 验证** | **15+** | **12+** |

### 9.2 文本版甘特图

```
Week 1                  Week 2                  Week 3
| M  T  W  T  F | S  S | M  T  W  T  F | S  S | M  T  W  T  F |
|==============|       |               |       |               |
| A: DbC ├────┤        |               |       |               |
| D: Bug F ixes ├┤     |               |       |               |
|               | B: Supervision ├─────┤       |               |
|               | C: Capability ├───────┤       |               |
|               |               | E: Hash ├──┤  |               |
|               |               | F: Live ├┤    |               |
|               |               |               | G: Deploy ├──┤|
|==============|       |               |       |               |
A+D 并行 ──────> B ───> C ───> E+F 并行 ───> G
```

**关键路径**：A → B → C → G（A 和 D 可并行，E 和 F 可并行，但 C 依赖 A 的 schema 基础，B 不依赖 C）

---

## 10. 文件改动清单

| # | 文件 | Phase | 改动范围 |
|---|---|---|---|
| 1 | `release/tree-system-v0.2.2/core/tree-state.js` | A, B, C, D1, D4, E | **最大改动**：9 个 DbC 校验 + depth 计算 + role enum + child_spec 字段 + capability token 颁发/校验 + hash chain + snapshot + 剪枝语义 + 命名规范化。预计新增 300-400 行 |
| 2 | `skills/tree-commander/SKILL.md` | A(配套), B, C(配套), D1 | worker lifecycle 管理章 + 接管流程 + Fork 时颁发 capability token + 审计铁律 + context 保护自检 |
| 3 | `skills/tree-worker/SKILL.md` | A(配套), C(配套), D1 | capability token 说明 + self_check schema 要求 + 禁自剪 + 禁跨兄弟写 |
| 4 | `proma-dev-patches.cjs` | C, D3, F | 工具调用拦截层（capability check）+ watcher silence 字段 + liveness heartbeat |
| 5 | `migrate-existing-workspaces.cjs` | D2 | 不覆盖策略（版本号比较） |
| 6 | 部署脚本 / `apply-patches.sh` | D2 | skill 全局同步 |
| 7 | `release/tree-system-v0.2.2/core/tree-state.js` 错误码模块 | A, C, E | 新增 12+ 错误码常量 |
| 8 | `workspace-files/.context/proma-dev-wiki.md` | G | 更新 wiki：v0.7 架构 + 错误码表 + child_spec schema + capability token 说明 |
| 9 | `workspace-files/.context/PROJECT-INDEX.md` | G | 更新当前完成度 + 卡点待办 |
| 10 | 测试脚本 / test harness | G | 6 组测试的自动化脚本（见 §11） |
| 11-15 | 历史 tree 数据 migrate 产生的临时/备份文件 | G | 16 个历史 tree 的 migrate 输出 |

---

## 11. 测试矩阵

> 提取自 `01-questions.md` 议题 8。6 组测试全部执行。

| 测试 ID | 测试内容 | 验证目标 | 通过条件 | 对应议题 |
|---|---|---|---|---|
| **T1** | 重跑 mdref 相同任务 | CP1-CP6 是否消失 | 6 个 CP 全部通过（不再出现文件幻觉/自审自过/alignment 自填/节点数失控/self_check 字符串/validate 失败续跑） | 议题 8-A |
| **T2** | 重跑 pytut 相同任务 | 同上 | 6 个 CP 全部通过 | 议题 8-A |
| **T3** | depth 压力测试 | depth ≤ 3 限制是否生效 | 人为构造 depth=4 → `leaf add` throw `E_TREE_DEPTH_EXCEEDED` | 议题 8-B |
| **T4** | role enum 校验 | 自由文本 role 是否被拒 | `role="custom_role"` → throw `E_ROLE_INVALID` | 议题 8-B |
| **T5** | capability 攻击测试 | worker 越权调 write_file 是否被拒 | worker 调 write_file（token 里无此工具）→ throw `E_CAPABILITY_DENIED` | 议题 8-C |
| **T6** | 主动 supervision 测试 | worker 失败 commander 是否接管 | mock worker fail → commander 检测到 status=fail → 按 child_spec 策略 retry/escalate | 议题 8-C |

### 11.1 测试执行时机

| 测试 | 执行时机 | 执行人 |
|---|---|---|
| T1-T2 | Phase A 完成后立即执行 | Agent |
| T3-T4 | Phase A（A9 完成后）立即执行 | Agent |
| T5 | Phase C 完成后执行 | Agent |
| T6 | Phase B 完成后执行 | Agent |
| 全量回归 | Phase G 部署前 | Agent + 用户 |

---

## 12. Migrate 策略

> 提取自 `01-questions.md` 议题 7。采用 **B + C 组合**。

### 12.1 核心策略

| 策略 | 内容 |
|---|---|
| **只对新 tree 生效** | 历史 16 个 tree 保留原样，不做强制 migrate。新 create 的 tree 必须完全合规。 |
| **不覆盖策略** | 用版本号判断，只有 skill 版本更新时才覆盖。避免覆盖用户在新 ws 手改的 skill 内容。 |

### 12.2 特殊情况处理

| 情况 | 处理方式 |
|---|---|
| **qfv2（5 层深）** | 保留原样。下次 add leaf 时被 depth 校验（A9）拦住：`E_TREE_DEPTH_EXCEEDED`。用户可选择：(a) 扁平化重组织；(b) split 成 meta-tree；(c) 手动提升 max_depth 到 5（不推荐但允许，硬上限 5） |
| **其他 2 层 tree** | 完全不受影响。新 add leaf 时正常通过 depth ≤ 3 校验。 |
| **已 archived tree** | 不做任何改动。migrate 时不强制符合 CP6（archived 前必须 validate）——打 warning 但不 unarchive。 |
| **历史 self_check 字符串** | `"all_pass"` → 自动转为 `[{item: "legacy", pass: true, evidence: "migrated from string"}]`，打 warning。 |

### 12.3 版本号机制

```js
// migrate-existing-workspaces.cjs
if (fs.existsSync(dst)) {
  const srcVer = parseSkillVersion(src);  // 从 SKILL.md 头部提取 version 字段
  const dstVer = parseSkillVersion(dst);
  if (compareSemver(srcVer, dstVer) <= 0) {
    console.log(`[migrate] skip ${wsSlug}/${skillName}: dst ${dstVer} >= src ${srcVer}`);
    continue;  // 不覆盖
  }
}
fs.cpSync(src, dst, { recursive: true });
```

---

## 附录 A: 与 01-questions.md 的决议对照

| 议题 | 本路线图对应 | 选择 |
|---|---|---|
| 1 核心论断 | Phase A（DbC）是直接应用 30/30/40 中可改的 40% | A 完全接受 |
| 2 三层架构 | Phase A（Layer 1）+ Phase B（Layer 2）= 议题推荐 C | C Layer 1+2 |
| 3 层级深度 | Phase A9（depth ≤ 3 + role enum） | B depth ≤ 3 |
| 4 Capability Token | Phase C（P1 而非 P0） | B P1 跟 DbC 一起 |
| 5 计划合并 | 全部合并为 v0.7（本路线图） | A 全部合并 |
| 6 复杂任务方案 | root_dod.max_depth + tree_mode 支持三种方案 | C 三种都支持 |
| 7 migrate 策略 | §12（只对新 tree + 不覆盖） | B + C 组合 |
| 8 测试方法 | §11（6 组测试全部做） | D 全部都做 |

---

> **本路线图由 Proma Agent 撰写，2026-06-23**
> **配套文档**: `06-decision-log.md`
> **状态**: 待专家组批准
