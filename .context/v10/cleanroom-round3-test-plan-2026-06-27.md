# Proma 洁净室测试 Round 3 测试计划 — R3 P0 修复回归 + 视角互换

> 维护：周星星 / Proma Agent | 创建：2026-06-27 16:30 | 状态：准备派发（待用户重启 Dev 后）

---

## 一、R3 测试目标

1. **回归验证 R3 两处 P0 修复**（D2-B1 added_by 伪造 / D2-R3 worker 担任 auditor）
2. **R2 修复回归**（确保 R3 改动不破坏 R2 的 5 大修复：B9/B12/B5/Fork/Auditor）
3. **R3 边界探索**（占位 UUID 跳过 / root.added_by 兜底 / root 担任 added_by 等 code-reviewer 提出的边界）

---

## 二、R3 修复摘要（Commander 必读）

| 编号 | 攻击向量 | R3 修复 | 期望错误码 |
|---|---|---|---|
| **D2-B1** | `tree_leaf_add` 用任意 UUID 作 `added_by` | cmdLeafAdd 内 withLock 块中事前校验 added_by 必须是树内 leaf session_id；worker 不能担任 added_by；占位 UUID 跳过 | `E_BORROWED_IDENTITY`（消息含 `[D2-B1]` 标签） |
| **D2-R3** | `tree_audit_append` 用 worker session_id 作 auditor | cmdAuditAppend 内 withLock 块中拒绝 `auditorLeaf.role === 'worker'` | `E_AUDITOR_NOT_INDEPENDENT`（消息含 `[D2-R3]` 标签） |

---

## 三、视角互换规则

| Commander | 任务 | 重点 |
|---|---|---|
| **A** | D2-B1 直接复测 + 边界 | 攻击拦截 + 占位 UUID 跳过 + root.added_by 兜底 |
| **B** | D2-R3 直接复测 + 边界 | 攻击拦截 + audit_log_integrity 协同 + 与 audit_gate 区别 |
| **C** | R2 视角互换变体（端到端） | 跑 A2-C1..C8 变体验证 R3 未引入回归 |
| **D** | R3 新设计输入 + B5 升级 | root 担任 added_by / R3 边界 case / 提议完整性哈希 |

---

## 四、R3 测试用例（每个 Commander 必跑）

### R3-回归-D2-B1（每个 Commander 至少跑 1 次）
- 伪造任意 UUID 作 added_by → 期望 `E_BORROWED_IDENTITY [D2-B1]`
- worker.session_id 作 added_by 添加子 leaf → 期望 `E_BORROWED_IDENTITY [D2-B1]`
- 合法 commander.session_id 作 added_by → 期望 ok

### R3-回归-D2-R3（每个 Commander 至少跑 1 次）
- worker.session_id 作 auditor 给其他 leaf 写 audit_log → 期望 `E_AUDITOR_NOT_INDEPENDENT [D2-R3]`
- 合法 commander.session_id 作 auditor → 期望 ok

### R3-回归-R2-5大（B/D 系列）
- B12 路径遍历（event_append + milestone_add 双入口）→ `E_DELIVERABLE_MISSING`
- B9 nudge 白名单（INVALID-RULE-99）→ `E_NAME_INVALID`
- B5 外部 UUID 伪造（直接 JSON 篡改）→ audit_log_integrity ①
- Fork 身份注入 → `fork_identity_status: 'injected'`
- Auditor 死锁 → root 可担任非 root leaf auditor

---

## 五、R3 Commander brief 模板

### 通用前缀（所有 Commander 共享）

```
# Proma 洁净室测试 Round 3 — Commander {X}

你是 Proma tree-system 安全测试的 Commander。R3 刚修复了 2 个 P0 漏洞（D2-B1 added_by 伪造 / D2-R3 worker 担任 auditor），需要你验证修复是否生效 + 探索新攻击面。

## 第一步：patches 生效验证（必须先做）

调 mcp__tree__tree_nudge_append --rule-id INVALID-RULE-99（任意 tree_id 和 leaf_id 都行）
- 期望：返回 E_NAME_INVALID（rule_id 不在白名单）
- 如果返回 ok:true，立即停止并报告 "PATCHES_NOT_LOADED"，不要继续后续测试

## 报告路径陷阱（必读）

你的 cwd 是会话目录，不是 proma workspace。所有报告必须用绝对路径写到：
C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/v10/cleanroom-round3-{X}-2026-06-27.md

## tree_id 命名

引擎 leaf_id 不接受连字符，但 tree_id 宽松。推荐前缀：cr26r3{x}（如 cr26r3a、cr26r3b）

## 完成判定

- 跑完所有用例后立即写报告，不要无限扩展
- 报告格式：用例表（编号/操作/期望/实际/结论）+ 关键发现 + 通过率
- 通过率统计：(PASS 用例数 / 总用例数) × 100%
```

### Commander A — D2-B1 直接复测 + 边界探索

```
{通用前缀，X=A}

## A 任务清单（10 用例）

### D2-B1 主路径复测（5 用例）

A-R3-1: tree_init cr26r3a --root-brief '{}' --root-dod '{}'
A-R3-2: tree_leaf_add commander leaf（合法 added_by=root.session_id）→ 期望 ok
A-R3-3: tree_leaf_add worker leaf，added_by=伪造 UUID "11111111-2222-3333-4444-555555555555"
         → 期望 E_BORROWED_IDENTITY [D2-B1]
A-R3-4: tree_leaf_add 第二个 worker leaf，added_by=第一个 worker.session_id
         → 期望 E_BORROWED_IDENTITY [D2-B1]（worker 不能担任 added_by）
A-R3-5: tree_leaf_add 第二个 worker leaf，added_by=commander.session_id
         → 期望 ok（合法路径）

### D2-B1 边界探索（5 用例）

A-R3-6: 占位 UUID 跳过 — added_by="00000000-0000-0000-0000-000000000001"
         → 期望 ok（占位 UUID 跳过校验，依赖 tree_validate 事后检测 added_by_not_in_tree）
         验证：tree_validate 后续是否报告 added_by_not_in_tree issue？
A-R3-7: root.added_by 兜底 — 模拟历史 root（手动 JSON 写入 root.added_by="abcdef"），
         然后 leaf_add added_by="abcdef" → 期望？观察代码逻辑
A-R3-8: root 担任 added_by — root.session_id 作 added_by 添加 commander 子节点
         → 期望 ok（root 可创建子节点，与 resolveAuditorIndep root 扩展对齐）
A-R3-9: 自身 session_id 作 added_by — worker A 用自己 session_id 添加子 worker
         → 期望 E_BORROWED_IDENTITY [D2-B1]（worker 不能担任 added_by，即便加自己）
A-R3-10: 占位 UUID 边界 — added_by="00000000-0000-0000-0000-000000000000"（全 0）
         → 期望？这是占位还是全 0？验证 PLACEHOLDER_UUID_PATTERN_TOP 是否匹配

## A 报告要求

报告必须包含：
1. D2-B1 主路径 5/5 是否全部按预期（A-R3-3/4 拦截，A-R3-2/5 放行）
2. 边界探索的发现（特别是 A-R3-6/7/10 这些代码注释里提到的兜底逻辑）
3. 通过率 + 与 R2 D 视角 D2-B1 报告对比
```

### Commander B — D2-R3 直接复测 + audit_log_integrity 协同

```
{通用前缀，X=B}

## B 任务清单（10 用例）

### D2-R3 主路径复测（5 用例）

B-R3-1: tree_init cr26r3b --root-brief '{}' --root-dod '{}' --root.node_budget=10
B-R3-2: tree_leaf_add commander + worker_A + worker_B（合法路径）
B-R3-3: tree_audit_append（target=worker_B, auditor=worker_A.session_id）
         → 期望 E_AUDITOR_NOT_INDEPENDENT [D2-R3]
B-R3-4: tree_audit_append（target=worker_B, auditor=commander.session_id）
         → 期望 ok（合法路径）
B-R3-5: tree_validate → 期望无 audit_log_integrity issue（B-R3-4 后只有合法 audit_log）

### D2-R3 边界 + audit_log_integrity 协同（5 用例）

B-R3-6: 直接 JSON 篡改 — 写入 auditor_session_id=外部伪造 UUID（不在树）的 audit_log
         → tree_validate 期望 audit_log_integrity ①（外部 UUID 伪造路径，R2 已修复）
B-R3-7: 直接 JSON 篡改 — 写入 auditor_session_id=worker.session_id 的 audit_log
         → tree_validate 期望 audit_log_integrity ②（worker 担任 auditor）
         这验证：API 入口攻击（B-R3-3）被本块拦截，离线篡改仍由 validate 检出
B-R3-8: audit_gate 路径对比 — tree_audit_gate（target=worker, verdict=pass, auditor=worker.session_id）
         → 期望？resolveAuditorIndep 是否也拒绝 worker auditor？
B-R3-9: root 担任 auditor — tree_audit_append（target=worker, auditor=root.session_id）
         → 期望 ok（root 是 trust anchor，可担任 auditor）
B-R3-10: 占位 UUID 边界 — tree_audit_append auditor=占位 UUID
         → 期望 E_INVALID_UUID_STRICT（前置 isValidStrictUuidV4 已拒，D2-R3 修复块不触发）

## B 报告要求

报告必须包含：
1. D2-R3 主路径 5/5 是否全部按预期（B-R3-3 拦截，B-R3-4 放行）
2. audit_log_integrity 协同（B-R3-6/7 验证 API 入口 + 离线篡改两层防御）
3. 与 audit_gate 的语义一致性（B-R3-8）
4. 通过率 + 与 R2 D 视角 D2-R3 报告对比
```

### Commander C — R2 视角互换变体（端到端回归）

```
{通用前缀，X=C}

## C 任务清单（8 用例 — R2 视角互换变体）

跑 R2 A 视角的端到端用例变体，验证 R3 修复未引入回归。

C-R3-1: 3-leaf 树完整流程（root + commander + worker，含 fork_session 注册 leaf）
         - 跑 brief_echo / done / audit_gate / audit_append 全流程
         - 验证 R3 修复不影响合法流程
C-R3-2: 7-leaf 树并行（root + 2 commander + 4 worker）
         - root 担任 auditor 给 worker 写 audit_log
         - 验证 Auditor 死锁修复仍有效
C-R3-3: 跨频道切换
         - sdkSessionId 清空 + meta 同步
C-R3-4: 30+ 轮长任务
         - context_usage_pct 自然增长
C-R3-5: fork 续接 + 立即 send_message
         - 验证 Fork 身份提示不被覆盖（R2 Fork 修复）
C-R3-6: backup + restore dirty
         - V1 拦截
C-R3-7: archive 级联
         - 子 leaf 状态变化
C-R3-8: R2 5 大修复全回归（B12/B9/B5/Fork/Auditor 各 1 个核心用例）
         - 验证 R3 改动不破坏 R2 修复

## C 报告要求

报告必须包含：
1. 8 个用例的通过/失败详情
2. R3 修复对 R2 流程的影响（应该无影响）
3. 通过率 + 与 R2 C 视角报告对比
4. 如有 R3 修复引入的新 bug（如占位 UUID 跳过误伤合法用例），独立标记
```

### Commander D — R3 新设计输入 + B5 升级探索

```
{通用前缀，X=D}

## D 任务清单（8 用例 — R3 新攻击面探索）

D 视角：你之前发现了 D2-B1 和 D2-R3，现在 R3 修复后，找新的盲点。

D-R3-1: root.added_by 兜底攻击
         - 假设攻击者控制 root.added_by（如通过某种方式注入），能否绕过 D2-B1 校验？
         - 模拟：手动 JSON 写入 root.added_by="attacker-uuid"，然后 leaf_add added_by="attacker-uuid"
         - 期望：被 D2-B1 拦截？还是通过 isRootAddedBy 兜底？
D-R3-2: 占位 UUID 滥用
         - added_by="00000000-0000-0000-0000-000000000001"（合法占位）
         - 攻击者用占位 UUID 添加恶意 leaf → 是否被拦截？
         - 验证：占位 UUID 跳过是否成为新攻击向量？
D-R3-3: leaf.added_by 字段伪造
         - 攻击者直接 JSON 篡改 leaf.added_by 字段（绕过 cmdLeafAdd）
         - tree_validate 是否检测？（参考 added_by_not_in_tree 检查）
D-R3-4: B5 升级 — 跨 leaf 注入变体
         - commander A 越权审计 commander B 的 worker（无明确指派）
         - 当前 cmdAuditAppend 只校验 role，不校验"明确指派"
         - 期望：通过（D2-R3 修复未覆盖此场景）→ 提议 R4 引入 leaf.assigned_auditor
D-R3-5: tree-state.json 完整性哈希（R2 P1 提议）
         - 探索：能否通过直接 JSON 篡改注入合规格式数据？
         - 提议：_integrity.hash SHA-256 覆盖 leaves + heartbeat_log + drift_log + audit_meta
D-R3-6: 命名规范双层不一致（R2 P2）
         - tree_init 接受长前缀 + 连字符，leaf_add 严格
         - 验证：合法创建的 tree 是否会被 validate 检出 name_invalid？
D-R3-7: root archive 特权
         - root 可 active → archived 跳过 done/validate
         - 验证：R3 修复是否影响此特权？
D-R3-8: tree_health_check 工具提议
         - 当前 patches 生效检测靠手动调 INVALID-RULE-99
         - 提议：新增 tree_health_check 返回版本/补丁信息

## D 报告要求

报告必须包含：
1. 8 个用例的探索结果（很多是"提议"，不必跑通）
2. 新发现的盲点（如果 D-R3-1/2/4 发现绕过路径，详细描述攻击向量）
3. R4 修复建议（基于探索结果）
4. 与 R2 D 视角报告对比，R3 修复是否闭环了 D2-B1/D2-R3
```

---

## 六、派发配置

- channel_id: `56ecefd2-8e22-4c62-add5-16e8992c987d`（DeepSeek 官方）
- model_id: `deepseek-v4-pro`
- workspace_id: `b38b9e4e-8cd9-42ac-b7b5-0e6b75763c67`（tree-2）
- tree_id 前缀：`cr26r3{cmd}`（如 cr26r3a、cr26r3b、cr26r3c、cr26r3d）
- 派发方式：`mcp__session__send_message wait=false`（异步）
- 报告路径：`workspace-files/.context/v10/cleanroom-round3-{cmd}-2026-06-27.md`

---

## 七、验收标准

- **R3 主路径 100%**：D2-B1 + D2-R3 主路径拦截全部 PASS
- **R2 回归无破坏**：5 大修复（B9/B12/B5/Fork/Auditor）全部仍 PASS
- **视角互换通过率 ≥ 85%**
- **R4 提议产出**：D Commander 至少提出 2 个 R4 修复方向（D-R3-4/5/8 等）
- 不允许"PATCHES_NOT_LOADED"（用户重启 Dev 后必须确认 patches 加载）

---

## 八、产出索引

| 文件 | 路径 | 状态 |
|---|---|---|
| **R3 测试计划（本文档）** | `workspace-files/.context/v10/cleanroom-round3-test-plan-2026-06-27.md` | ✅ |
| R3 修复方案 | `workspace-files/.context/v10/bug-fix-r3-proposals-2026-06-27.md` | ✅ |
| R3 交接文件 | `workspace-files/.context/v10/R3-handoff-2026-06-27.md` | ✅ |
| R2 测试计划（参考） | `workspace-files/.context/v10/cleanroom-round2-test-plan-2026-06-27.md` | ✅ |
