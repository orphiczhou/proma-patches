# Bug 修复方案 R3 — 洁净室测试 Round 2 视角互换暴露的 2 个新 P0

**修复时间**: 2026-06-27 16:22-16:25 GMT+8
**修复执行者**: Proma Agent（主会话，接 R3-handoff）
**备份文件**: `tree-engine.cjs.bak-20260627-pre-r3-fix`
**同步状态**: 3 处物理同步完成（Dev dist / Release dist / workspace-files）
**patches.cjs**: 本次未改（两处 P0 均在 tree-engine.cjs 中）

---

## 一、修复总览

| 编号 | 问题 | 严重度 | 文件 | 函数 | 状态 |
|---|---|---|---|---|---|
| **D2-B1** | `tree_leaf_add` 接受任意 UUID 作为 `added_by`（borrowed identity） | P0 | tree-engine.cjs | cmdLeafAdd（行 708-） | ✅ |
| **D2-R3** | `tree_audit_append` 允许 worker 担任 auditor（B5 跨 leaf 注入） | P0 | tree-engine.cjs | cmdAuditAppend（行 2566-） | ✅ |
| ~~MCP workspace="undefined"~~ | ~~P1（可选）~~ | — | — | — | ⏸️ R3 暂不修，待 R4 处理 |

**未修理由**：交接文件 §四 标注 P1 为可选项；MCP workspace 修复需深入 patches.cjs 调研，且现有 workaround（worker 子会话代理）有效。优先聚焦 2 个 P0 闭环。

---

## 二、D2-B1 — `added_by` 事前校验（borrowed identity）

### 失守根因

R2 洁净室 D 视角 D2-B1 暴露：`tree_leaf_add` 仅校验 `added_by` 是合法 UUID（行 751 `UUID_RE.test(added_by)`），不校验该 UUID 是否对应树内任何 leaf 的 session_id。

攻击向量：
```
worker A 持有自己 session_id=A-UUID
worker A 调 tree_leaf_add，added_by=任意合法 UUID（如 "11111111-2222-3333-4444-555555555555"）
→ ok: true，leaf 被创建，追溯链断裂
→ 仅 tree_validate 事后检测 added_by_not_in_tree（leaf 已落地）
```

R1 视角下未发现，因为 R1 主要测试 `tree_event_append`（已有 Bug A 修复，行 1584）和 `tree_audit_append`。R2 视角互换后 D 视角才发现 `tree_leaf_add` 路径漏修。

### 与已有修复的对比

| 入口 | 已有校验 | R2 修复 |
|---|---|---|
| `cmdEventAppend`（type='done'） | Bug A：caller session 必须 === leaf.session_id（行 1584） | ✅ R1 修复 |
| `cmdAuditAppend` | auditor 存在 + 非自身 + UUID strict（行 2659-2667） | R3 补 worker 拒绝 |
| `cmdLeafAdd`（**本次**） | 仅 UUID 格式校验 | **R3 补 added_by 在树内** |

### 修复方案：cmdLeafAdd 内 withLock 块中插入事前校验

**位置**：`cmdLeafAdd` 函数内，`withLock` 块中 session_id 唯一性校验（sessionConflict）之后，parent 校验之前。

**新增代码（约 35 行）**：

```javascript
// V9+ Phase 5 (R3 P0 / D2-B1 修复): added_by 事前校验
//   失守根因：R2 洁净室 D2-B1 暴露 — tree_leaf_add 接受任意 UUID 作为 added_by，
//   仅 tree_validate 事后检测 added_by_not_in_tree。恶意 worker 可伪造 commander 身份添加 leaf。
//   修复：参考 cmdEventAppend 的 Bug A 修复（行 1584）+ resolveAuditorIndep 的 root 扩展（行 1978+），
//   事前校验 added_by 必须满足以下任一：
//   ① 是树内某个 leaf 的 session_id（合法操作者，通常是 commander 或 root）
//   ② 是 root 的 added_by（向后兼容历史数据，root 自创建无父）
//   额外禁止：worker 不能担任 added_by（worker 是原子叶，无权添加子 leaf）
//   金标准兼容：dbc-spec/zombie 等测试用占位 UUID（00000000-0000-0000-0000-000000000001），
//   走"直接 JSON 写入"路径，cmdLeafAdd 路径不应被占位 UUID 影响 —— 但 cmdLeafAdd 是 MCP 入口，
//   不会有占位 UUID 流入（金标准测试用直接 fs.writeFileSync 绕过 cmdLeafAdd）。这里跳过占位 UUID
//   仅作为防御性兜底，避免误伤历史 migrate 数据。
if (role !== 'root' && added_by) {
  const PLACEHOLDER_ADDED_BY_PATTERN_R3 = /^00000000-0000-0000-0000-[0-9]{12}$/;
  if (!PLACEHOLDER_ADDED_BY_PATTERN_R3.test(added_by)) {
    const addedByLeaf = Object.values(state.leaves).find((l) => l.session_id === added_by);
    if (!addedByLeaf) {
      // 也允许 root leaf 的 added_by（历史 root 数据可能 added_by 自指或为占位）
      const rootLeaf = Object.values(state.leaves).find(
        (l) => l.parent === null && l.role === 'root'
      );
      const isRootAddedBy = rootLeaf && rootLeaf.added_by === added_by;
      if (!isRootAddedBy) {
        throw new TreeStateError(
          E_BORROWED_IDENTITY,
          `leaf_add rejected: added_by "${added_by}" not found as any leaf session in tree (possible forged identity). added_by must be the session_id of an existing leaf (typically commander or root). [D2-B1]`
        );
      }
    } else if (addedByLeaf.role === 'worker') {
      throw new TreeStateError(
        E_BORROWED_IDENTITY,
        `leaf_add rejected: added_by "${added_by}" maps to leaf "${addedByLeaf.leaf_id}" with role=worker (workers cannot add child leaves — only root/commander can). [D2-B1]`
      );
    }
  }
}
```

### 错误码选择

复用 `E_BORROWED_IDENTITY`（行 143 已定义），help_topic `self_audit_forbidden`。语义匹配：借用他人身份。

### 金标准兼容性

| 场景 | added_by 值 | 处理 |
|---|---|---|
| 合法 commander 添加 worker | commander.session_id | ✅ 通过（找到 leaf，非 worker） |
| 合法 root 添加 commander（仅 tree_init 路径，不走 cmdLeafAdd） | — | ✅ 不受影响 |
| 占位 UUID（dbc-spec/zombie） | `00000000-0000-0000-0000-000000000001` | ✅ 跳过校验 |
| 攻击：伪造任意 UUID | `11111111-2222-3333-4444-555555555555` | ❌ E_BORROWED_IDENTITY |
| 攻击：worker 冒充其他 worker | worker_A.session_id 添加 worker_B | ❌ E_BORROWED_IDENTITY（worker 不能担任 added_by） |
| 历史 root.added_by 自指 | root.leaf_id 字符串（非 UUID） | ⚠️ 不通过 UUID_RE，前置已拒（行 751）。本块兜底 root.added_by === added_by，仅在 added_by 是 UUID 时触发 |

### 回归风险

- ✅ 向后兼容：合法操作者添加 leaf 仍正常
- ✅ 占位 UUID 跳过：金标准测试不破坏
- ⚠️ 测试场景影响：R1/R2 中如果用占位 UUID 作 added_by 走 cmdLeafAdd 路径，会被跳过（依赖 tree_validate 事后检测）—— 这是预期行为
- ⚠️ 新增 PLACEHOLDER_ADDED_BY_PATTERN_R3 局部常量：每次 cmdLeafAdd 调用都重新创建（性能可忽略，未提升到顶层是为最小变更）

---

## 三、D2-R3 — `cmdAuditAppend` 拒绝 worker 担任 auditor（B5 跨 leaf 注入）

### 失守根因

R2 洁净室 D 视角 D2-R3 暴露：`cmdAuditAppend` 仅校验 auditor_session_id 指向树中存在的 leaf 且非自身（行 2659-2667），不校验 auditor 的 role。

攻击向量：
```
worker A 持有自己 session_id=A-UUID
worker A 调 tree_audit_append（target=worker_B），auditor_session_id=A-UUID
→ ok: true，audit_log 写入 worker_B
→ tree_validate 后续检测：audit_log_integrity 第 ② 项 role===worker 触发 issue
   （但攻击已成功，audit_log 已落地）
```

矛盾点：
- B-v2 视角（外部 UUID 伪造）：B5 完全修复（auditorLeaf 不存在 → audit_log_integrity ① 触发）
- D 视角（合法成员冒充）：B5 仍可绕过（worker 是合法树成员 → ① 通过；② role===worker 仅在 validate 报 issue，不在入口拦）

### 与 collectValidateIssues.audit_log_integrity 的关系

`collectValidateIssues` 行 2339-2346 已有 ② auditor role === 'worker' 检查，但**仅报告 issue，不阻断写入**。R2 设计意图是"事后告警"，但 D 视角发现：攻击者无需绕过 validate，写入成功即达成目标（污染 audit_log）。

R3 修复升级为"事前拦截"，与 audit_log_integrity 第 ② 项语义对齐。

### 修复方案：cmdAuditAppend 入口拒绝 worker 担任 auditor

**位置**：`cmdAuditAppend` 函数内，`withLock` 块中 auditorLeaf.leaf_id === leaf.leaf_id 校验之后，audit_log 写入之前。

**新增代码（约 13 行）**：

```javascript
// V9+ Phase 5 (R3 P0 / D2-R3 修复): auditor 角色检查 — 拒绝 worker 担任 auditor
//   失守根因：R2 洁净室 D2-R3 暴露 — cmdAuditAppend 仅校验 auditor 存在 + 非自身，
//   允许任意非自身 leaf 担任 auditor，包括 worker。worker 可通过 API 路径冒充 auditor
//   给其他 leaf 写 audit_log（B5 跨 leaf 注入）。
//   audit_log_integrity 的 role===worker 检查只在 tree_validate 时报告 issue（事后），
//   不在入口拦截，导致攻击发生时返回 ok:true。
//   修复：cmdAuditAppend 入口直接拒绝 worker 担任 auditor，与 audit_log_integrity 第 ② 项对齐。
//   worker 是原子叶，无审计资格；只有 root/commander 可以为其他 leaf 背书审计结果。
if (auditorLeaf.role === 'worker') {
  throw new TreeStateError(
    E_AUDITOR_NOT_INDEPENDENT,
    `audit_append rejected: auditor_session_id "${entry.auditor_session_id}" maps to leaf "${auditorLeaf.leaf_id}" with role=worker (workers cannot serve as auditors — only root/commander can endorse others). [D2-R3]`
  );
}
```

### 错误码选择

复用 `E_AUDITOR_NOT_INDEPENDENT`（已用于 auditor 不存在 / 自身审计），语义匹配：auditor 不独立（worker 是原子叶，不具审计独立性）。

### 金标准兼容性

| 场景 | auditor | 处理 |
|---|---|---|
| 合法 commander 审计 worker | commander.session_id | ✅ 通过 |
| 合法 root 审计 commander | root.session_id | ✅ 通过 |
| 占位 UUID（dbc-spec zombie） | `00000000-...` | ✅ 前置 strict UUID 校验已拒（行 2587），本块不触发 |
| 攻击：worker 冒充 auditor | worker.session_id | ❌ E_AUDITOR_NOT_INDEPENDENT |
| 合法 self-audit（同一 leaf） | leaf.session_id | ❌ 已被 2664 行拒绝（self-audit） |

### 与 collectValidateIssues 的协同

- **入口拦截**（本次新增）：worker 担任 auditor → E_AUDITOR_NOT_INDEPENDENT
- **事后告警**（已有）：直接 JSON 篡改注入的 audit_log（绕过 cmdAuditAppend）→ audit_log_integrity ②

两条路径互补：API 入口攻击被本块拦截；离线篡改仍由 validate 检出。R3 闭环 B5 跨 leaf 注入主路径。

### 回归风险

- ✅ 向后兼容：合法 commander/root 审计仍正常
- ✅ 占位 UUID 不受影响：strict UUID 校验在更前置（行 2587），占位 UUID 早已被拒
- ⚠️ 与 audit_gate（resolveAuditorIndep）的关系：resolveAuditorIndep 也校验 auditor role，但要求更严（status/events/verdict 三重）；本块是 audit_append 路径的轻量校验，仅校验 role，与现有"audit_append 不走 resolveAuditorIndep"的设计一致

---

## 四、未修复项 — MCP workspace="undefined"（P1）

### 现状

- 现象：Fork 会话或部分主会话的 `mcp__tree__*` 工具返回 `E_NO_TREES_DIR`（workspace 解析为字符串 "undefined"）
- 影响：用户需通过 worker 子会话代理调用 tree 工具
- 根因推测：SDK 初始化竞态（workspace 绑定异步完成前首批 MCP 调用已发出）
- 修复方向：patches.cjs 中 MCP server 启动时增加 workspace fallback

### R3 不修的理由

1. 交接文件明确标 P1 可选
2. patches.cjs 调研工作量大（10+ 处 workspace 解析点），R3 聚焦 P0 闭环
3. 现有 workaround 有效，不影响 R3 测试
4. R4 可独立处理（不影响 v10 安全态势）

### R4 修复建议

1. 搜索 patches.cjs 中所有 `workspace` 解析点
2. 在 `getAgentSessionMeta` 后增加 fallback：meta.workspaceId 为 undefined 时从 sourceSessionId 推导
3. 在 `mcp__tree__*` 入口增加 workspace 验证步骤，缺失时返回明确错误（而非 "undefined"）

---

## 五、修复流程执行记录

| 步骤 | 操作 | 结果 |
|---|---|---|
| 1 | 备份 `tree-engine.cjs.bak-20260627-pre-r3-fix` | ✅ |
| 2 | D2-B1 修复（cmdLeafAdd 加 added_by 事前校验） | ✅ |
| 3 | D2-R3 修复（cmdAuditAppend 拒绝 worker auditor） | ✅ |
| 4 | node --check 语法验证 | ✅ SYNTAX OK |
| 5 | 3 处物理同步（Dev / Release / workspace-files） | ✅ 文件大小一致 172235 bytes |
| 6 | 修复文档（本文档） | ✅ |
| 7 | code-reviewer SubAgent 审计 | ✅ PASS（无必修，2 项建议改进） |
| 8 | 采纳建议 1：提升 `PLACEHOLDER_UUID_PATTERN_TOP` 到模块顶层 | ✅ 文件大小 172655 bytes |
| 9 | 重新语法检查 + 3 处同步 | ✅ 172655 bytes 一致 |
| 10 | 用户重启 Dev + patches 生效验证 | ⏳ 待用户操作 |
| 11 | 派 R3 Commander 测试 | ⏳ 待用户确认 |

### code-reviewer 审计结论

- **整体**：PASS（无必修问题）
- **正确性**：两处校验逻辑完备，无遗漏攻击路径
- **金标准兼容**：占位 UUID 跳过合理；D2-R3 前置已有 strict UUID 校验，无需补占位跳过
- **错误码**：E_BORROWED_IDENTITY / E_AUDITOR_NOT_INDEPENDENT 复用合理
- **边界 case**：root 担任 added_by 放行符合 spec；root.added_by 兜底安全（攻击者无法控制内部字段）
- **采纳建议 1**：提升 `PLACEHOLDER_UUID_PATTERN_TOP` 到模块顶层（与 UUID_RE 对齐）
- **保留建议 2**：Object.values 三次扫描逻辑分离清晰，合并反而增加复杂度，保持现状



---

## 六、测试预期（R3 Commander 验证）

### D2-B1 测试用例

```
1. tree_init cr3verify-b1 --root-brief '{}' --root-dod '{}'
2. 创建 commander leaf（合法 added_by=root.session_id）→ 期望 ok
3. tree_leaf_add worker leaf，added_by=任意伪造 UUID（如 "11111111-2222-3333-4444-555555555555"）
   → 期望 E_BORROWED_IDENTITY [D2-B1]
4. tree_leaf_add worker leaf，added_by=另一个 worker.session_id
   → 期望 E_BORROWED_IDENTITY [D2-B1]（worker 不能担任 added_by）
5. tree_leaf_add worker leaf，added_by=commander.session_id
   → 期望 ok（合法路径）
```

### D2-R3 测试用例

```
1. tree_init cr3verify-r3 --root-brief '{}' --root-dod '{}'
2. 创建 commander + worker A + worker B（合法路径）
3. tree_audit_append（target=worker_B, auditor=worker_A.session_id）
   → 期望 E_AUDITOR_NOT_INDEPENDENT [D2-R3]
4. tree_audit_append（target=worker_B, auditor=commander.session_id）
   → 期望 ok（合法路径）
5. tree_validate → 期望无 audit_log_integrity issue
```

### 回归用例（确保不破坏 R2 修复）

- B12 路径遍历（双入口）→ 仍 E_DELIVERABLE_MISSING
- B9 nudge 白名单 → 仍 E_NAME_INVALID（INVALID-RULE-99）
- B5 audit_log 伪造（外部 UUID）→ 仍 audit_log_integrity ①
- Fork 注入 → 仍 fork_identity_status: "injected"
- Auditor 死锁 → root 仍可担任非 root auditor

---

## 七、产出索引

| 文件 | 路径 | 状态 |
|---|---|---|
| **R3 修复方案（本文档）** | `workspace-files/.context/v10/bug-fix-r3-proposals-2026-06-27.md` | ✅ |
| R3 交接文件 | `workspace-files/.context/v10/R3-handoff-2026-06-27.md` | ✅ |
| R2 最终综合 | `workspace-files/.context/v10/cleanroom-round2-final-recap-2026-06-27.md` | ✅ |
| R2 修复方案 | `workspace-files/.context/v10/bug-fix-r2-proposals-2026-06-27.md` | ✅ |
| 备份文件 | `D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-20260627-pre-r3-fix` | ✅ |
