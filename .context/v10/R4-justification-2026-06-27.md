# R4 修复统一论证 — 占位 UUID 攻击链根因分析与修复方案

> 维护：周星星 / Proma Agent | 创建：2026-06-27 17:20
> 背景：R3 修复 D2-B1 + D2-R3 后，D 视角发现占位 UUID 攻击链（新 P0）
> 决策依据：用户选择"记录下来，统一论证"——本文档是 R4 修复的必要性 + 方案合理性 + 金标准兼容性论证

---

## 一、执行摘要

### 核心结论

R3 修复闭环了 D2-B1 + D2-R3 的**外部 UUID 伪造主路径**，但暴露了一个**更深的根因**：金标准兼容逻辑（占位 UUID skip）与安全严格性之间存在系统性冲突，每轮修复都会在"兼容性边界"引入新的绕过路径。

**R3 修复引入的回归**（主会话完整验证）：
- cmdLeafAdd 行 742 `session_id` 用宽松的 `UUID_RE`，允许占位 UUID（`00000000-0000-0000-0000-XXXXXXXXXXXX`，10^12 种组合）作为 session_id 创建 leaf
- 占位 leaf 一旦创建，就是"合法树成员"，可担任 auditor 绕过 D2-R3
- 主会话实测：占位 commander 成功注入 audit_log，tree_validate 未检出

**推荐 R4 修复批次**（详见 §五）：
- **R4-P0**（必修）：cmdLeafAdd + cmdAuditAppend MCP 入口统一拒绝占位 UUID
- **R4-P1**（强烈建议）：tree-state.json 完整性哈希（防离线篡改）
- **R4-P2**（打磨）：命名规范统一 + health_check 工具 + MCP workspace 修复

### 关键论证点

1. **金标准兼容不是阻碍**：金标准测试（dbc-spec/zombie）走 `fs.writeFileSync` 直接 JSON 写入，**不走 MCP 入口**。R4 在 MCP 入口拒绝占位 UUID 零破坏金标准。
2. **真正的攻击面是 MCP 入口**：运行时 API 是远程攻击者能触达的边界；fs 直写需要本地 fs 权限，是另一层威胁（由完整性哈希防护）。
3. **修复成本极低**：R4-P0 仅需 ~30 行代码改动（升级 UUID_RE → strict + 占位拒绝），无新依赖，无 schema 变更。

---

## 二、占位 UUID 攻击链威胁建模

### 2.1 攻击链完整步骤（主会话在 cr26r3verify tree 实测确认）

```
[攻击者目标] 在 tree 中注入合法外观的 audit_log，绕过 D2-B1 + D2-R3 双重防御

Step 1: 创建占位 commander leaf
  POST mcp__tree__tree_leaf_add
  {
    leaf_id: "cr26r3v-D-commander",
    session_id: "00000000-0000-0000-0000-000000000077",  ← 占位 UUID
    parent: "cr26r3verify-root",
    role: "commander",
    added_by: "<合法 root session_id>"                  ← 合法（攻击者知悉 root session）
  }
  
  引擎校验链：
    ✓ UUID_RE.test(session_id) — 占位 UUID 格式合法
    ✓ leaf_id 命名规范
    ✓ parent 存在
    ✓ added_by 事前校验（R3 D2-B1 修复）— root session 合法
    ✗ 未校验：session_id 是否占位 UUID
  
  结果：ok:true，占位 commander 创建成功

Step 2: 占位 commander 给目标 leaf 写 audit_log
  POST mcp__tree__tree_audit_append
  {
    leaf_id: "cr26r3v-C-worker",
    auditor_session_id: "00000000-0000-0000-0000-000000000077",
    total: 1, passed: 1, failed: 0,
    results: [{item:"attack", pass:true, evidence:"placeholder injection"}]
  }
  
  引擎校验链：
    ✓ isValidStrictUuidV4(auditor_session_id) — FORBIDDEN_UUIDS 只含全 0/全 f，...077 通过
    ✓ auditorLeaf 查找 — cr26r3v-D-commander.session_id 匹配
    ✓ auditorLeaf.leaf_id !== leaf.leaf_id — 非自身
    ✓ auditorLeaf.role !== 'worker' — role=commander（R3 D2-R3 修复只拦 worker）
    ✗ 未校验：auditor_session_id 是否占位 UUID
  
  结果：ok:true，audit_log 写入成功（audit_log_count=2）

Step 3: tree_validate 事后检测
  GET mcp__tree__tree_validate
  
  collectValidateIssues 检查：
    ✓ audit_log_integrity ① auditor 存在 — cr26r3v-D-commander 在树中
    ✓ audit_log_integrity ② auditor role !== 'worker' — role=commander
    ✓ audit_log_integrity ③ 数值一致 — 1=1+0
  
  结果：未报告 audit_log_integrity issue，攻击隐身
```

### 2.2 攻击向量特征

| 维度 | 评估 |
|---|---|
| **攻击复杂度** | 低（3 次 MCP 调用，无需 fs 权限） |
| **所需权限** | MCP 工具调用权限（任何 Commander/worker session） |
| **可知信息** | root session_id（树成员公开）+ tree_id（可观察） |
| **绕过层数** | 3 层（D2-B1 修复 + D2-R3 修复 + audit_log_integrity） |
| **占位 UUID 空间** | 10^12（足够任何攻击场景） |
| **检测概率** | 0%（tree_validate 不报告） |

### 2.3 现实威胁评估

**高威胁场景**：
- 多 Commander 协作的开放环境（如洁净室测试本身）
- 一个被入侵的 Commander 可注入任意 audit_log，污染其他 Commander 的审计结果
- 由于 audit_log 是 trust anchor 的关键证据，污染后可诱导 root 做错误决策（如 archive 未完成的 worker）

**低威胁场景**：
- 单用户单 tree（无多 Commander 协作）
- tree-state.json 不被外部观察（audit_log 不影响决策）

**结论**：威胁等级 **P0**——攻击成本极低，绕过层数多，检测概率为零，影响 trust anchor 完整性。

---

## 三、金标准兼容性精细论证（关键）

### 3.1 占位 UUID 在金标准中的真实用途

**调研 dbc-spec/audit-attacks/audit-extra 等金标准测试**（基于 isValidStrictUuidV4 注释 行 157-172 + collectValidateIssues PLACEHOLDER_UUID_PATTERN 注释 行 2309-2311）：

金标准用占位 UUID 模拟两种场景：
1. **zombie leaf**：session_id 是占位 UUID，对应不存在的 session（模拟"已死"的 leaf）
2. **audit-attacks**：audit_log 中 auditor_session_id 是占位 UUID，模拟外部伪造

**关键事实**：金标准测试**通过 `fs.writeFileSync` 直接写 tree-state.json** 实现这些场景，**不走 cmdLeafAdd / cmdAuditAppend MCP 入口**。

### 3.2 MCP 入口 vs validate 路径的金标准兼容性矩阵

| 路径 | 金标准是否走 | R4 拒占位 UUID 是否破坏金标准 |
|---|---|---|
| `cmdLeafAdd`（MCP 入口） | ❌ 不走（金标准用 fs 直写） | ✅ **不破坏**（可安全拒占位） |
| `cmdAuditAppend`（MCP 入口） | ❌ 不走 | ✅ **不破坏**（可安全拒占位） |
| `cmdAuditGate`（MCP 入口） | ❌ 不走 | ✅ **不破坏** |
| `collectValidateIssues`（validate 路径） | ✅ 走（金标准调 validate） | ⚠️ **破坏**（必须保留占位跳过） |
| `collectValidateIssues.added_by_not_in_tree` | ✅ 走 | ⚠️ **当前已不跳过占位**（行 2240 直接查找，主会话验证确认） |

**核心论证**：
- **R4 在 MCP 入口拒占位 UUID 是安全的**（金标准不走 MCP 入口）
- **R4 不能动 collectValidateIssues 的占位跳过**（金标准调 validate，需要兼容 zombie 场景）
- 当前 `added_by_not_in_tree` 检查**没有占位跳过**（行 2240），这是设计选择——金标准 zombie leaf 的 added_by 应该被检出（zombie 是异常状态）

### 3.3 论证结论

R4-P0 修复（cmdLeafAdd + cmdAuditAppend MCP 入口拒占位 UUID）**与金标准 100% 兼容**，零回归风险。这是修复占位 UUID 攻击链的最优路径。

---

## 四、R4 各修复项方案论证

### 4.1 R4-P0-A：cmdLeafAdd session_id 升级 strict 校验（核心修复）

**位置**：tree-engine.cjs 行 742-747

**现状**：
```javascript
// v0.2.2-修复#4: session_id 必须是合法 UUID（堵住 CLI 手动注入占位符）
if (!UUID_RE.test(session_id)) {
  throw new TreeStateError(E_SCHEMA_INVALID, '...');
}
```

**问题**：注释说"堵住 CLI 手动注入占位符"，但 `UUID_RE` 实际**不拒占位**（只查格式）。实现与注释不一致。

**修复方案**：
```javascript
// V9+ Phase 6 (R4 P0): session_id strict 校验 — 拒绝占位 UUID
//   失守根因：R3 D 视角发现占位 UUID 攻击链 — UUID_RE 允许 00000000-...-XXXXXXXXXXXX 模式
//   作为 session_id 创建 leaf，绕过 D2-B1（占位 leaf 成为合法树成员）。
//   修复：升级为 isValidStrictUuidV4 + PLACEHOLDER 拒绝。金标准兼容：dbc-spec/zombie 走
//   fs.writeFileSync 直写路径，不走 cmdLeafAdd MCP 入口，无破坏。
if (!isValidStrictUuidV4(session_id)) {
  throw new TreeStateError(E_INVALID_UUID_STRICT,
    `session_id "${session_id}" not strict UUID v4 (placeholder/zero/broadcast rejected)`);
}
if (PLACEHOLDER_UUID_PATTERN_TOP.test(session_id)) {
  throw new TreeStateError(E_INVALID_UUID_STRICT,
    `session_id "${session_id}" matches placeholder pattern — MCP entry rejects placeholder UUID. ` +
    `Real session_id required (use mcp__session__create_session or fork_session). [R4-A]`);
}
```

**错误码**：复用 `E_INVALID_UUID_STRICT`，msg 含 `[R4-A]` 标签。

**金标准兼容**：✅ 见 §三论证

**回归风险**：低。合法用户用 mcp__session__create_session / fork_session 拿到的 session_id 都是真 v4 UUID，不受影响。

### 4.2 R4-P0-B：cmdAuditAppend auditor 占位拒绝（防御纵深）

**位置**：tree-engine.cjs 行 2587-2590（isValidStrictUuidV4 之后）

**现状**：
```javascript
if (!isValidStrictUuidV4(entry.auditor_session_id)) {
  throw new TreeStateError(E_INVALID_UUID_STRICT, '...');
}
```

isValidStrictUuidV4 的 FORBIDDEN_UUIDS 只含全 0/全 f，不拒占位 UUID（`...-000000000077`）。

**修复方案**：在 strict 校验后增加占位拒绝
```javascript
// V9+ Phase 6 (R4 P0): 占位 UUID auditor 拒绝
//   防御纵深：即使 R4-A 漏网（如未来某入口未覆盖），audit_append 入口也独立拒绝占位 auditor。
if (PLACEHOLDER_UUID_PATTERN_TOP.test(entry.auditor_session_id)) {
  throw new TreeStateError(E_INVALID_UUID_STRICT,
    `audit_append rejected: auditor_session_id "${entry.auditor_session_id}" matches placeholder pattern. ` +
    `Real session_id required. [R4-B]`);
}
```

**论证**：这是 R4-A 的防御纵深。即便攻击者通过其他入口（如未来新增的 leaf 创建工具）注入占位 leaf，audit_append 仍拒绝其担任 auditor。

**金标准兼容**：✅（同 §三论证）

### 4.3 R4-P0-C：collectValidateIssues 占位检测？

**结论**：**不做**。collectValidateIssues 是 validate 路径，金标准会调，必须保留占位跳过（兼容 zombie 场景）。

R4-A + R4-B 已足够封堵 MCP 入口攻击链。离线 fs 篡改由 R4-P1 完整性哈希防护。

### 4.4 R4-P1-A：tree-state.json 完整性哈希（防离线篡改）

**威胁**：攻击者有 fs 权限，绕过所有 MCP 入口校验，直接篡改 tree-state.json

**方案**：
```javascript
// writeState 时
const hashPayload = JSON.stringify({
  leaves: state.leaves,
  heartbeat_log: state.heartbeat_log,
  drift_log: state.drift_log,
  audit_meta: state.audit_meta
}) + state._integrity.salt;
state._integrity.hash = crypto.createHash('sha256').update(hashPayload).digest('hex');

// readState 时
const expectedHash = computeHash(state);
if (state._integrity.hash && state._integrity.hash !== expectedHash) {
  throw new TreeStateError(E_INTEGRITY_VIOLATION, 'tree-state.json tampered');
}
```

**salt 来源**：tree_init 时生成随机 32 字节 salt，写入 `_integrity.salt`（首次写入后不可改）

**论证**：威胁建模上，fs 篡改需要本地访问权限，是比 MCP 攻击更高门槛的威胁。但 trust anchor 完整性值得这层防护。

**成本**：~50 行代码 + 1 次 SHA-256/读写（性能可忽略）+ tree-state.json schema 加 `_integrity` 字段（需 migrate）

### 4.5 R4-P1-B：移除 root.added_by 兜底

**位置**：tree-engine.cjs cmdLeafAdd 中 `isRootAddedBy` 检查（R3 修复引入）

**论证**：root 作为 trust anchor 用自己的 session_id 担任 added_by 即可，不需要兜底。当前兜底是历史数据防御性兼容，但实际 root.added_by 通常是 null（cmdInit 行 660 写入 null），兜底逻辑基本死代码。

**风险**：极低。如果有历史 tree 的 root.added_by 是非 null 非 session_id 的值，移除后会拒绝该 tree 的新 leaf_add。需要 migrate 检查。

### 4.6 R4-P2 项（简述）

| 编号 | 修复 | 论证 |
|---|---|---|
| R4-P2-A | tree_id 入口统一命名校验 | 避免"永久不可归档 tree"陷阱（D6 发现） |
| R4-P2-B | tree_health_check 工具 | 替代手动 INVALID-RULE-99 测试，运维必需 |
| R4-P2-C | root archive 特权文档化 | 消除歧义，零代码变更 |
| R4-P2-D | MCP workspace="undefined" 修复 | R2 遗留 P1，patches.cjs workspace 解析 fallback |

---

## 五、修复优先级矩阵

```
                  影响范围
              低           高
          ┌──────────┬──────────┐
   高     │ R4-P0-A  │ R4-P0-A  │ ← 必修（攻击链根节点）
          │ R4-P0-B  │          │
   攻     │          │          │
   击  ───┼──────────┼──────────┤
   难  低 │ R4-P1-B  │ R4-P1-A  │ ← 强烈建议（离线防护）
   度     │ R4-P2-*  │          │
          └──────────┴──────────┘
```

**推荐批次**：

| 批次 | 内容 | 时间 | 价值 |
|---|---|---|---|
| **R4 批次 1** | R4-P0-A + R4-P0-B | 1.5h | 封堵占位 UUID 攻击链（必修） |
| R4 批次 2 | R4-P1-A + R4-P1-B | 2h | 完整性哈希 + 移除兜底 |
| R4 批次 3 | R4-P2-A/B/C/D | 2h | 工具链打磨 + R2 P1 闭环 |

---

## 六、统一论证："兼容性绕过"模式

### 6.1 R1 → R2 → R3 的修复-绕过-再修复循环

| 轮次 | 修复 | 引入的绕过 | 根因 |
|---|---|---|---|
| R1→R2 | B5 audit_log 伪造 → collectValidateIssues.audit_log_integrity | D2-R3 视角：合法 worker 通过 API 担任 auditor | 入口校验（cmdAuditAppend）与 validate 校验（collectValidateIssues）语义不一致 |
| R2→R3 | D2-B1 added_by 伪造 → cmdLeafAdd 事前校验 + 占位 skip | R3 视角：占位 UUID 作 session_id 创建 leaf | UUID_RE（宽松）与 isValidStrictUuidV4（strict）选择不一致 + 占位 skip 兼容逻辑 |
| R3→R4 | 占位 UUID 攻击链 → cmdLeafAdd session_id strict + cmdAuditAppend 占位拒绝 | （待发现） | 预测：可能在 `_integrity.salt` 管理 / migrate 路径 |

### 6.2 根因模式：兼容性边界漏洞

**模式描述**：每轮修复为了兼容历史数据/金标准测试，在某些边界（占位 UUID / null / 兜底逻辑）放宽校验。这些放宽成为下一轮攻击的入口。

**模式表现**：
1. **注释 vs 实现不一致**：cmdLeafAdd 行 742 注释说"堵占位符"，实现 UUID_RE 不堵
2. **入口 vs validate 语义不一致**：cmdAuditAppend 不查 role，validate 查 role；D2-R3 修入口，但占位 leaf 让 validate 也失效
3. **金标准兼容逻辑过宽**：PLACEHOLDER_UUID_PATTERN 匹配 10^12 种 UUID，远超金标准实际需求（金标准只用 ...001/...002 等少数）

### 6.3 系统性修复方向

**短期（R4）**：封堵当前攻击链（MCP 入口 strict）
**中期（R5 建议）**：
1. **统一 UUID 校验层**：所有 session_id / auditor_session_id / added_by 入口统一用 `assertValidSessionUuid(v, {allow_placeholder: false})`
2. **金标准兼容性测试**：建立自动化测试，每次修复后跑金标准，确认兼容性边界不扩大
3. **注释-实现一致性检查**：lint 规则，注释提到"拒绝 X"时实现必须真拒绝

**长期**：trust anchor 完整性重新设计（签名机制而非哈希）

---

## 七、推荐执行计划

### 推荐方案：R4 批次 1（必修）+ 批次 3 R4-P2-D（MCP workspace）

**理由**：
- 批次 1（R4-P0-A/B）封堵真实 P0 攻击链，必须修
- R4-P2-D（MCP workspace="undefined"）是 R2 遗留 P1，影响 Fork 会话，与 R4-P0 同批修可一次性闭环
- 批次 2（完整性哈希）可推迟到 R5（fs 攻击门槛高，非紧急）
- 批次 3 其他 P2 可分散处理

**预计时间**：3 小时（R4-P0-A/B + 子 Agent 审计 + 重启 + R4 Commander 验证 + MCP workspace 修复）

**预期成果**：
- 占位 UUID 攻击链封堵
- D2-B1 + D2-R3 双重防御加固
- MCP workspace="undefined" 修复
- R3 → R4 演进：通过率 ~90% → 目标 ≥ 97%

### 替代方案对比

| 方案 | 时间 | 闭环范围 | 风险 |
|---|---|---|---|
| **推荐**：R4-P0 + MCP workspace | 3h | 占位攻击链 + Fork workspace | 低 |
| 最小：仅 R4-P0-A | 1h | 仅 cmdLeafAdd（攻击链根节点） | 中（R4-B 防御纵深缺失） |
| 完整：R4 全部 P0+P1+P2 | 6h | 全部 R4 项 | 中（完整性哈希需 schema migrate） |
| 推迟：仅记录，不修 | 0h | 无 | 高（占位攻击链 P0 持续暴露） |

---

## 八、决策建议

基于本论证，**强烈建议执行"推荐方案"（R4-P0 + MCP workspace）**：

1. **威胁等级 P0**：占位 UUID 攻击链零检测、低成本、影响 trust anchor
2. **修复成本极低**：~30 行代码 + 1.5h（不含审计和验证）
3. **金标准兼容性论证充分**：MCP 入口与 validate 路径的金标准兼容性矩阵清晰
4. **MCP workspace P1 同批修**：R2 遗留问题，影响 Fork 会话日常使用
5. **R5 可处理 P1/P2**：完整性哈希、命名统一等非紧急项可推迟

如用户确认，本会话可立即开始 R4 批次 1（备份 → 修复 → 审计 → 同步 → 等待用户重启 → 验证）。

---

## 九、附录：R3 主会话验证记录

### 实测 tree: cr26r3verify

```
cr26r3verify-root (session=3653b4b4-...)
├── cr26r3v-A-commander (session=aaaaaaaa-...) ← 合法
│   └── cr26r3v-B-worker (session=bbbbbbbb-..., added_by=00000000-...-001 占位) ← 占位 added_by
│       └── cr26r3v-C-worker (session=cccccccc-..., 合法)
│           ├── audit_log[0]: auditor=aaaaaaaa (commander, 合法 - 主会话 B5 测试)
│           └── audit_log[1]: auditor=00000000-...-077 (占位 commander, 攻击注入) ← 攻击成功
└── cr26r3v-D-commander (session=00000000-...-077 占位) ← 攻击 leaf
```

### tree_validate 结果

```
2 issues:
  1. name_invalid: cr26r3verify-root (tree_id 含连字符)
  2. added_by_not_in_tree: cr26r3v-B-worker (added_by=占位 ...001)  ← 检出
```

**未检出**：
- cr26r3v-D-commander session_id=占位 ...077（无 session_id 占位检测）
- cr26r3v-C-worker audit_log[1] auditor=占位 ...077（占位 commander 在树中，audit_log_integrity 通过）

---

*R4 论证完成。核心结论：占位 UUID 攻击链是 P0 真实威胁，修复成本极低，金标准兼容性论证充分，建议立即执行 R4 批次 1。*
