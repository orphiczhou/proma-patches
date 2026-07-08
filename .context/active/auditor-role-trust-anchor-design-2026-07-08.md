# 设计立项：auditor role 信任锚协议

> **立项日期**：2026-07-08
> **来源**：harness efficiency 调研报告 v3 §6.4.5 + 二轮 G5' 审计 NR5
> **状态**：待设计（P0a 落地前的拦路虎）
> **优先级**：P0-pre（auditor role 引入的前置依赖）

---

## 一、问题陈述

调研报告 v3 §6.2.1 设计引入 `auditor` role，但二轮 G5' 审计揭示**冷启动死锁未根除**：

### 当前设计（v3 §6.4.5）

> auditor leaf 自己 audit_gate=pass 需要"由 root.session_id 或上级 auditor 背书"

### 死锁分析

```
第一个 auditor leaf 的 audit_gate=pass 需要上级 auditor 背书
↓
上级 auditor 也需要自己的 audit_gate=pass
↓
无限回归 OR 回到 root.session_id 信任锚背书
↓
但 v3 §5.2a 已揭示：信任锚背书存在 audit_gate 时序倒挂副作用
（root 给自己 spawn 的 worker/auditor 直接 pass，
时戳在独立审计之前，违背"独立验证"本意）
```

**结论**：当前设计在冷启动期、转正常期、首个 auditor leaf 三个场景都有未解决问题。

---

## 二、设计目标

1. **解决冷启动死锁**：第一个 auditor leaf 能合法获得 audit_gate=pass
2. **避免信任锚时序倒挂**：不重蹈 §5.2a 揭示的覆辙
3. **防止无限背书链**：上级 auditor 背书不能无限向上递归
4. **与现有 §13.2 信任锚协议兼容**：冷启动期 root 当 auditor 的旧路径不破坏
5. **可测**：所有路径在 dbc-spec 金标准下可验证

---

## 三、设计选项

### 选项 A：provisional_pass + endorsement_depth（推荐）

**核心机制**：
- 引入 `audit_gate.verdict = 'provisional_pass'`（新 verdict 值）
- 引入 `audit_gate.endorsement_depth: int`（默认 0）
- 引入 `audit_gate.endorser_chain: [session_id]`（背书链路）

**冷启动期（无任何 auditor leaf 满足 V10-auditor-active）**：
- root 给 auditor leaf 设 `audit_gate.verdict = 'provisional_pass'` + `endorsement_depth = 0`
- `provisional_pass` **不满足 V10-auditor-active**（仍需独立审计转正）
- 转正常期：第一个独立 auditor 给该 auditor leaf 写正式 `audit_gate.verdict = 'pass'` + `endorsement_depth = 1`

**转正常期（已有 ≥1 auditor leaf 满足 V10-auditor-active）**：
- 新 auditor leaf 由已 done 的上级 auditor 背书
- `endorsement_depth = parent.endorsement_depth + 1`
- **硬上限 `endorsement_depth ≤ 2`**（类似 commander depth ≤2），超出拒绝

**worker audit_gate 路径**：
- 冷启动期：root 给 `provisional_pass`，独立 auditor 转正后写正式 `pass`
- 转正常期：独立 auditor leaf 直接写正式 `pass`

**时序倒挂副作用修复**：
- v3 §5.2a 揭示的"root 给自己 spawn 的 worker 直接设 pass"问题，通过 `provisional_pass` 标记解决
- `provisional_pass` 在 collectValidateIssues 时给 warning 不报错，但 `endorsement_chain` 留痕
- 任何 `provisional_pass` leaf 必须在 X 时间窗口（如 30 分钟）内获得正式 pass，否则自动降级为 `verdict = 'required'`

### 选项 B：bootstrap_auditor（一次性初始化）

**核心机制**：
- tree_init 时可选传 `bootstrap_auditor_session_id` 参数
- 该 session 自动注册为"种子 auditor"，endowment_depth = 0
- 第一个 worker done 后，种子 auditor 给它写 pass
- 后续 auditor leaf 由种子 auditor 背书

**优点**：避免信任锚背书，独立性强
**缺点**：tree_init 需要外部提供独立 session（实际操作复杂）；种子 auditor 本身的独立性如何保证？

### 选项 C：等概率抽签（auditor pool）

**核心机制**：
- 维护一个 auditor pool（多个独立 session）
- 每次 audit 需求时，从 pool 随机抽 1 个 auditor
- pool 内 auditor 互相背书（环形背书）

**优点**：完全去中心化，无 root 单点
**缺点**：复杂度高，pool 维护成本大，需要 5+ 独立 session 才有意义

---

## 四、推荐方案（选项 A）的详细设计

### 4.1 audit_gate schema 扩展

```typescript
audit_gate: {
  verdict: 'required' | 'skip' | 'pass' | 'provisional_pass' | 'fail',  // 新增 provisional_pass
  auditor_session_id: string,
  audit_session_id: string,  // caller === audit_session_id (V10-self-audit-forbidden)
  ts: number,
  reason: string,
  // 新增字段
  endorsement_depth: int,  // 0=未背书 / 1=直接背书 / 2=二级背书
  endorser_chain: [session_id],  // 背书链路（从 root.session_id 或 bootstrap 到当前）
  provisional_expires_at?: number  // verdict=provisional_pass 时的过期时间戳
}
```

### 4.2 V10-auditor-active 调整

当前 V10-auditor-active 三条件：
- `status === 'done'`
- `events` 非空
- `audit_gate.verdict === 'pass'`

**调整为**：
- `status === 'done'`
- `events` 非空
- `audit_gate.verdict === 'pass'`（**不包含 `provisional_pass`**）

→ 即 `provisional_pass` 的 leaf **不能当别人的 auditor**（强制转正后才能审别人）

### 4.3 resolveAuditorIndep 闸门 2 调整

当前闸门 2（行 2432-2446）：root 可担任任意非 root leaf 的 auditor

**调整为**：
- root 给 worker/commander leaf 设 `provisional_pass`（不能设正式 `pass`，除非该 leaf 已有独立审计背书）
- root 给 auditor leaf 设 `provisional_pass`（同样原则）
- 正式 `pass` 必须由已 done 的独立 auditor leaf 设（转正常期）

**例外**：root 自己（leaf_id=root）的 audit_gate 走 auto_upgrade 路径（v3 §13.3a 已有），不参与 provisional_pass 机制

### 4.4 endorsement_depth 上限

- `endorsement_depth = 0`：root 信任锚背书（provisional_pass）
- `endorsement_depth = 1`：独立 auditor 直接背书（正式 pass）
- `endorsement_depth = 2`：独立 auditor 经由另一个独立 auditor 背书（罕见，复杂树场景）
- `endorsement_depth > 2`：拒绝（E_ENDORSEMENT_DEPTH_EXCEEDED）

### 4.5 过期机制

- `verdict = 'provisional_pass'` 时强制设置 `provisional_expires_at = now + 30min`
- 每次访问该 leaf 时检查过期：
  - 过期未转正 → 自动降级为 `verdict = 'required'` + drift_append(severity=medium)
- 转正（独立 auditor 设正式 `pass`）时清除 `provisional_expires_at`

### 4.6 错误码新增

| 错误码 | 触发 | help_topic |
|--------|------|-----------|
| E_PROVISIONAL_EXPIRED | provisional_pass 过期未转正 | trust_anchor_protocol |
| E_ENDORSEMENT_DEPTH_EXCEEDED | endorsement_depth > 2 | trust_anchor_protocol |
| E_PROVISIONAL_AUDITOR_REJECTED | 用 provisional_pass leaf 当别人 auditor | trust_anchor_protocol |
| E_ROOT_CANNOT_FORMAL_PASS | root 试图给非自己 leaf 设正式 pass（必须 provisional_pass） | trust_anchor_protocol |

---

## 五、SKILL 影响范围

### commander §13 整章重写（v3 已列）

- §13.2 冷启动期 auditor = root.session_id → 改为 "root 设 provisional_pass"
- §13.3 步骤 6 audit_gate pass → 改为 "root 设 provisional_pass，独立 auditor 转正后改正式 pass"
- §13.4 转正常期 → 改为 "endorsement_depth 机制 + 上限 2"

### commander §13.3a root 自身 done（保留 auto_upgrade）

root 自己 audit_gate 走 auto_upgrade，不参与 provisional_pass 机制——但需要 SKILL 明示

### worker §10 审计角色章节调整

- auditor leaf lifecycle 三步走：brief_echo → done → audit_gate=pass（依赖背书转正）
- auditor leaf 自己 audit_gate=provisional_pass 时只能"待审"不能审别人

### startup_notice 不需要改（5 行红线不变）

---

## 六、测试策略

### 6.1 金标准兼容性扫描

需检查 dbc-spec / audit-attacks 测试是否假设：
- audit_gate.verdict 只有 4 个值（required/skip/pass/fail）—— 加入 provisional_pass 后兼容？
- audit_gate 无 endorsement_depth / endorser_chain 字段—— 加入后旧测试是否仍过？

### 6.2 新增测试用例

| 测试 | 验证 |
|------|------|
| test_cold_start_provisional_pass | 冷启动期 root 给 auditor leaf 设 provisional_pass 成功 |
| test_provisional_pass_cannot_be_auditor | provisional_pass leaf 当别人 auditor → E_PROVISIONAL_AUDITOR_REJECTED |
| test_endorsement_depth_limit | endorsement_depth=3 → E_ENDORSEMENT_DEPTH_EXCEEDED |
| test_provisional_expires | provisional_pass 30min 后自动降级 |
| test_normal_period_auditor_chain | 转正常期 auditor 互相背书的链路 |
| test_root_cannot_formal_pass | root 试图设正式 pass → E_ROOT_CANNOT_FORMAL_PASS |
| test_provisional_upgrade_to_formal | provisional_pass 经独立 auditor 转正 |

### 6.3 与 macp4 历史回放

- macp4-A4 历史用 commander role 假装 auditor → 引入新设计后，A4 leaf 应自动 migrate 为 `role=auditor` + `audit_gate.verdict=provisional_pass`（root 设）→ 后续独立 auditor 转正
- 回放测试应验证：A4 audit_gate 最终状态 = `pass` + `endorsement_depth=1` + `endorser_chain=[independent_auditor.session_id]`

---

## 七、迁移策略（与 v3 §9.5.1 协同）

### 7.1 tree-state.json schema 升级

`state.version: '1.0' → '1.1'`

### 7.2 engine cmdMigrate 加规则 6（引用 v3 §9.5.1 修正）

```javascript
// 行 3338 cmdMigrate 现有 5 条规则，加规则 6
if (state.version === '1.0' && targetVersion === '1.1') {
  // 扫描所有 leaf，识别"假装 auditor"（role=commander/worker 但 brief 含 audit/auditor 关键词）
  // 1. role 改为 'auditor'
  // 2. audit_gate.verdict='pass' 改为 'provisional_pass' + endorsement_depth=0
  // 3. grandfathered 标记（兼容旧数据，不强制立即转正）
  // 4. 写入 endorser_chain: [original_auditor_session_id]
}
```

### 7.3 grandfathered 字段（行 1220 复用）

migrate 后的 auditor leaf 加 `audit_meta.grandfathered = true`，validate 时给 warning 不报错，但 30 天后自动失效（强制重新审计）

---

## 八、实施顺序（与 v3 §9.4 P0a 协同）

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 本设计文档评审 + 定稿 | 本立项 |
| 2 | engine 加 audit_gate 新字段（verdict provisional_pass + endorsement_depth + endorser_chain） | 1 |
| 3 | engine 加 4 个新错误码 + help_topic | 2 |
| 4 | resolveAuditorIndep 闸门 2 改造（root 只设 provisional_pass） | 3 |
| 5 | cmdMigrate 加规则 6（数据迁移） | 4 |
| 6 | commander §13 整章重写（信任锚 + endorsement_depth） | 5 |
| 7 | worker §10 调整（auditor lifecycle 三步走） | 5 |
| 8 | 7 个新增测试用例 + 金标准兼容扫描 | 6+7 |
| 9 | dbc-spec + audit-attacks 测试更新 | 8 |
| 10 | feature flag PROMA_AUDITOR_ROLE_ENABLED=1 + 灰度 dev → release → pro | 9 |

---

## 九、开放问题（待定）

1. **provisional_expires_at 30 分钟合理吗？** macp4-A4 案例 auditor 持续 ~55 分钟，30 分钟可能太短
2. **endorsement_depth ≤ 2 够吗？** 复杂树（8-worker+）场景可能不够
3. **grandfathered 30 天失效是否激进？** 历史 audit_gate=pass 数据失效可能影响生产
4. **root 给自己 leaf 设正式 pass 的边界**：root 自己（leaf_id=root）走 auto_upgrade，但 root 给直属 worker 设呢？当前设计是只能 provisional_pass，但这意味着 root 永远不能独立完成 worker audit_gate（必须等独立 auditor 转正），可能影响小树效率

---

## 十、立项后下一步

1. **评审本设计**（用户 + 调研员 + 工程师）
2. **解决 §九 开放问题**
3. **进入实施顺序 §八 步骤 2**

---

**立项文件结束**（约 350 行）

**与 v3 报告关系**：本文件是 v3 §6.4.5 + §6.2.1 的子设计文档，解决 NR5（auditor role 冷启动死锁）。v3 报告定稿后，本设计作为 P0a 落地的前置依赖。
