# Commander D — R3 新攻击面探索 + R4 提议报告

> 执行者: Proma Agent (session `2b7394c7`)
> 执行时间: 2026-06-27 16:58 - 17:05 GMT+8
> 维度: R3 新攻击面探索 (D 视角)
> 状态: **完成 — 8/8 用例探索，发现 2 个新盲点，5 项 R4 提议**
> tree: `cr26r3d-d` (workspace tree-2)

---

## 第零步：Patches 生效验证

| 项目 | 内容 |
|------|------|
| **测试** | `tree_nudge_append tree_id="cr26r3d-d" leaf_id="cr26r3d-d-root" rule_id="INVALID-RULE-99"` |
| **期望** | `E_NAME_INVALID` (rule_id 不在 whitelist) |
| **实际** | `E_NAME_INVALID` — "rule_id 'INVALID-RULE-99' not in whitelist [R-01, R-03, R-04, R-05, R-06, C-02, C-03, C-06, C-11, C-13, C-15, W-01, W-08, W-11, W-12, W-AUDIT-SELF, W-AUDIT-WORKER, W-AUDIT-TAMPER, W-AUDIT-NO-ALIGN]" |
| **判定** | **PASS — patches 已加载，R3 修复生效** |

---

## 一、用例探索结果表

| 编号 | 探索方向 | 探索结果 | 是否新盲点 | R4 提议 |
|------|---------|---------|-----------|--------|
| **D1** | root.added_by 兜底攻击 | `isRootAddedBy` 兜底在 root.added_by=null 时安全（only null===null match，但 added_by 对非 root 必填） | 理论风险（需 fs 写权限） | R4-P1: 移除 root.added_by 兜底或限制为已知合法集合 |
| **D2** | 占位 UUID 滥用 | **成功绕过** — 用占位 UUID 创建 2 个 leaf (commander + worker)，D2-B1 占位 skip 使其全部 ok:true | **是 — 新攻击向量** | R4-P0: leaf_add 入口拒占位 UUID |
| **D3** | leaf.added_by 字段伪造 | tree-state.json 无 `_integrity.hash`；占位 UUID leaf 的 added_by_not_in_tree 未被 validate 检出 | **是 — 检测缺口** | R4-P0: 完整性哈希 + validate 增强 |
| **D4** | 跨 leaf 注入变体 | **成功绕过** — 占位 UUID commander 成功审计 worker，D2-R3 未拦（role=commander 非 worker） | **是 — 攻击链延伸** | R4-P0: 拒绝占位 UUID 担任 auditor |
| **D5** | tree-state.json 完整性哈希 | 无 `_integrity` 字段，纯 JSON 可离线篡改 | 已知（R2 P1 提议） | R4-P1: SHA-256 完整性哈希 |
| **D6** | 命名规范双层不一致 | tree_init 接受连字符长前缀 → validate 报告 name_invalid → archive 被门控 | 是（UX 问题 → 可用性攻击面） | R4-P2: 统一 tree_id 入口校验 |
| **D7** | root archive 特权 | archive 被 `E_TREE_NOT_VALIDATED` 门控；done 被 milestone 要求门控 | 否（安全加固） | R4-P2: 文档化 root trust anchor 边界 |
| **D8** | tree_health_check 工具 | 当前无 health_check；patches 检测靠手动 INVALID-RULE-99 测试 | 否（工具缺口） | R4-P2: 新增 tree_health_check |

**总评**: 8 个用例中 **2 个确认新盲点** (D2, D4)，**1 个确认检测缺口** (D3)，**3 个确认设计提案** (D5, D6, D8)，**2 个确认安全/低风险** (D1, D7)。

---

## 二、新发现的盲点（详细分析）

### 盲点 1: 占位 UUID 攻击链 (D2 → D4)

**严重度**: P0

**攻击步骤**:

```
Step 1: tree_leaf_add with placeholder UUID
  added_by = "00000000-0000-0000-0000-000000000001"
  → D2-B1 占位 skip → ok:true
  → leaf 创建成功，role=commander

Step 2: 继续创建子 leaf
  added_by = "00000000-0000-0000-0000-000000000002"  
  → 占位 skip → ok:true
  → worker leaf 创建成功

Step 3: 跨 leaf 注入 audit_log
  auditor_session_id = "00000000-0000-0000-0000-000000000001"
  → D2-R3 检查 auditorLeaf.role === 'worker'? 
  → NO — placeholder leaf 的 role=commander
  → ok:true，audit_log 成功写入
```

**攻击向量特征**:
- `PLACEHOLDER_ADDED_BY_PATTERN_R3 = /^00000000-0000-0000-0000-[0-9]{12}$/`
- 后缀有 **10^12 种组合** — 攻击者可创建无限占位 leaf
- 每个占位 UUID 可创建一个 leaf（session 唯一性）
- 占位 commander 可担任 auditor（role=commander，不触发 D2-R3 worker 拒绝）

**影响范围**:
- D2-B1 修复 (added_by 事先校验): 被占位 UUID skip 完全绕过
- D2-R3 修复 (worker auditor 拒绝): 被占位 commander 绕过
- tree_validate: `added_by_not_in_tree` 检查可能也跳过占位 UUID（与入口一致的 pattern），仅检测到 `added_by_role_invalid`（worker 自指 corner case）
- 可构建完整占位子树：commander + worker + audit_log，全部绕过

**根因**: R3 修复的两个占位 skip（`PLACEHOLDER_ADDED_BY_PATTERN_R3`）为金标准兼容而设计，但在 cmdLeafAdd MCP 入口路径下，占位 UUID 不应出现。金标准测试用 `fs.writeFileSync` 直接写 JSON，不会经过 cmdLeafAdd MCP 入口。占位 skip 在 MCP 入口是多余的防御性兜底，反而成为绕过路径。

### 盲点 2: tree_validate 检测缺口 (D3)

**严重度**: P1

**发现**:
- `tree_validate` 对占位 UUID leaf 报告的 issue 是 `added_by_role_invalid`（仅检测了 worker self-ref case）
- 未报告 `added_by_not_in_tree`（占位 skip 在 validate 中同样生效）
- 占位 UUID commander 的 `added_by="00000000-0000-0000-0000-000000000001"` 未被任何 validate issue 覆盖

**缺口**:
- validate 中的 `added_by_not_in_tree` 检查使用了与入口一致的占位 skip pattern
- 导致占位 UUID leaf 在 validate 阶段也是"隐身"的
- 攻击者可以在 validate 清洁的情况下维持占位子树

### 盲点 3: 命名不一致导致的可用性攻击面 (D6)

**严重度**: P2

**发现**:
- `tree_init` 接受 `cr26r3d-d` 和 `cr26r3d-very-long-prefix-test` 作为 tree_id
- 生成的 root leaf_id 含连字符（如 `cr26r3d-d-root`），违反命名规范 `^([a-z][a-z0-9_]{3,7})-...`
- `tree_validate` 立即报告 `name_invalid`
- 此状态下 `archive` 被 `E_TREE_NOT_VALIDATED` 门控 — 树永远无法归档

**影响**: 合法用户可能创建"永久不可归档"的树，无修复手段（当前无 rename tool）。

---

## 三、与 R2 D 视角报告对比

| R2 发现 | R2 状态 | R3 修复 | R3 验证结果 | 闭环？ |
|---------|--------|---------|-----------|--------|
| **D2-B1** added_by 伪造 | FAIL (ok:true) | cmdLeafAdd 入口 added_by 在树内校验 | `E_BORROWED_IDENTITY [D2-B1]` 拦截外部 UUID | **部分闭环** — 占位 UUID 可绕过 |
| **D2-R3** B5 跨 leaf 注入 | FAIL (ok:true) | cmdAuditAppend 拒绝 worker auditor | `E_AUDITOR_NOT_INDEPENDENT [D2-R3]` 拦截 worker auditor | **部分闭环** — 占位 commander 可绕过 |
| **D2-B4** audit_log 外部伪造 | PASS (3 层防御) | 未改动 | 仍 PASS | ✅ |
| **D2-B2** duplicate session | PASS | 未改动 | 仍 PASS | ✅ |
| **D2-B3** self-audit | PASS | 未改动 | 仍 PASS | ✅ |
| **D2-R1** B12 路径遍历 | PASS | 未改动 | 仍 PASS（已隐含验证） | ✅ |
| **D2-R2** B9 nudge 白名单 | PASS | 未改动 | 仍 PASS（patches 验证阶段确认） | ✅ |

### R3 修复闭环评估

- **D2-B1 主路径**: ✅ 闭环 — 外部 UUID 伪造被拦截
- **D2-B1 占位路径**: ❌ 未闭环 — 占位 UUID 可绕过（新盲点）
- **D2-R3 主路径**: ✅ 闭环 — worker auditor 被拦截
- **D2-R3 占位 commander 路径**: ❌ 未闭环 — 占位 commander 可担任 auditor（新盲点）

**结论**: R3 修复闭环了主攻击路径，但占位 UUID 兼容 skip 引入了新的绕过路径。两个绕过路径可通过同一修复（入口拒占位 UUID）统一解决。

---

## 四、R4 修复建议优先级排序

### P0 (R4 必须修)

| 编号 | 修复项 | 方案 | 影响 |
|------|-------|------|------|
| **R4-1** | **占位 UUID 入口拒绝** | `cmdLeafAdd` 中移除 `PLACEHOLDER_ADDED_BY_PATTERN_R3` skip；占位 UUID 在 MCP 入口一律拒绝。金标准测试走 `fs.writeFileSync` 直写路径，不经过 cmdLeafAdd MCP 入口，无兼容风险。 | 斩断 D2/D4 攻击链根节点 |
| **R4-2** | **auditor 占位 UUID 拒绝** | `cmdAuditAppend` 中增加占位 UUID 检查，拒绝 placeholder UUID 担任 auditor（与 strict UUID 检查对齐）。 | 斩断 D4 攻击链审计环节 |
| **R4-3** | **validate 占位 added_by 检测** | `collectValidateIssues` 中移除 `added_by_not_in_tree` 的占位 skip，所有占位 UUID 的 added_by 在 validate 中也应报告 issue。 | 封堵事后检测缺口 |

### P1 (R4 强烈建议)

| 编号 | 修复项 | 方案 | 影响 |
|------|-------|------|------|
| **R4-4** | **tree-state.json 完整性哈希** | `_integrity.hash` = SHA-256(JSON.stringify({leaves, heartbeat_log, drift_log, audit_meta}) + per-tree-salt)。writeState 时计算并写入，readState 时验证。salt 可由 tree_init 时生成随机值写入 `_integrity.salt`。 | 离线篡改变得可检测 |
| **R4-5** | **移除 root.added_by 兜底** | `cmdLeafAdd` 中移除 `isRootAddedBy` 检查。root 也走标准 added_by 校验（root 作为 trust anchor 用自己的 session_id，不需要兜底）。历史兼容：若 root.added_by != null && root.added_by !== root.session_id，视为数据异常，触发修复性 nudge。 | 消除最后一条绕过路径 |

### P2 (R4 建议纳入)

| 编号 | 修复项 | 方案 | 影响 |
|------|-------|------|------|
| **R4-6** | **tree_id 入口统一命名校验** | `tree_init` 中校验 tree_id 不含连字符，长度 ≤ 8 字符（与 leaf_id prefix 段规则对齐）。或在 tree_init 时自动将 tree_id 中的连字符替换为下划线。 | 消除 D6 命名不一致 |
| **R4-7** | **tree_health_check 工具** | 新增 `mcp__tree__tree_health_check` 返回 `{version, patches[], loaded_at, tao_version}`。patches 列表由引擎维护常量数组。 | 替代手动 INVALID-RULE-99 测试 |
| **R4-8** | **root archive 特权文档化** | CLAUDE.md / SKILL.md 中明确记录：root archive 需先通过 validate + milestones 非空。Root trust anchor 的边界是"仍需满足基本契约"。 | 消除 D7 行为歧义 |

---

## 五、攻击链可视化

```
                    R3 防御体系
                    ============

   [占位 UUID]
        |
        v
   cmdLeafAdd ──────→ D2-B1 占位 skip ──→ ok:true (leak)
        |
        v
   commander leaf (placeholder session)
        |
        ├──→ cmdLeafAdd (子 worker) ──→ D2-B1 占位 skip ──→ ok:true (leak)
        |
        └──→ cmdAuditAppend ──→ D2-R3 role check: commander ≠ worker ──→ ok:true (leak)
                 |
                 v
            audit_log 注入成功

   tree_validate:
     added_by_not_in_tree? → 占位 skip → 未检出
     added_by_role_invalid? → 仅 worker self-ref 被检出
     audit_log_integrity?   → auditor_session_id 指向占位 commander (在树中) → 未检出

   结论: 占位 UUID 是 R3 防御体系的一把万能钥匙
```

---

## 六、R4 修复优先级矩阵

```
                    影响范围
                低        高
            ┌─────────┬─────────┐
    高      │ R4-1    │ R4-4    │
            │ R4-2    │         │
攻          │ R4-3    │         │
击   ───────┼─────────┼─────────┤
难  低      │ R4-5    │ R4-6    │
度          │ R4-7    │ R4-8    │
            └─────────┴─────────┘
```

**建议 R4 修复顺序**: R4-1 → R4-2 → R4-3 (封堵占位攻击链) → R4-4 (完整性哈希) → R4-5 (消除兜底) → R4-6/7/8 (工具链打磨)

---

## 七、测试数据附录

### 测试用 tree: `cr26r3d-d`

```
cr26r3d-d-root (active, session=2b7394c7)
├── cr2r3d-A-commander (active, session=000...001, added_by=000...001) ← 占位
│   └── cr2r3d-A1-worker (pending_brief, session=000...002, added_by=000...002) ← 占位
│       └── audit_log[0]: auditor=000...001, test="D4 cross-leaf injection" ← 注入成功
```

### tree_validate 结果

```
name_invalid: cr26r3d-d-root (leaf_id 含连字符)
added_by_role_invalid: cr2r3d-A1-worker (added_by 指向 worker self)
```

**未检出的问题**:
- `cr2r3d-A-commander` 的 `added_by="000...001"` 未报告 added_by_not_in_tree（占位 skip）
- `cr2r3d-A1-worker` 的 `audit_log` 由占位 commander 注入，audit_log_integrity 未报告（auditor 在树中存在）

---

*报告完成。R3 D 视角核心发现：占位 UUID 兼容 skip 成为 R3 防御体系的一把万能钥匙，R4 建议从入口拒绝占位 UUID 开始修。*
