# A3+A4 统一评价报告

> 评价者: A3+A4 统一 auditor（v10v-A3A4-auditor leaf，独立上下文）
> 评价对象: C3 root-as-trust-anchor + D4 helper 配套
> 评价日期: 2026-06-25
> 上游方案: `.context/plan/agent-helper-and-skill-auto-trigger.md`（D4）+ charter（C3 spec 内嵌）
> 上游 charter: `.context/plan/v10-implementation-charter.md`

---

## 总体判定

| 维度 | 判定 |
|------|------|
| C3 root-as-trust-anchor | **不合格（有严重安全失守）** |
| D4 helper 配套 | **合格（功能完整、测试覆盖合理）** |
| core 同步状态 | **已同步（D4-fix 已完成）** |
| 测试回归 | **金标准 6 套全过（但未覆盖 C3 致命漏洞）** |
| **整体** | **需迭代（C3 必须返工修复 2 个 P0 失守）** |

---

## Part 1: C3 root-as-trust-anchor 评价

### 4 处改动逐项

#### 改动 1: resolveAuditorIndep root 信任锚 — **【不合格，P0 失守】**

**位置**: patch-l/tree-engine.cjs:1843-1873（同 dist）；core/tree-state.js:1776-1806

**代码片段**（patch-l:1849-1851）：
```js
if (leaf.role === 'root' && (auditorSessionId === null || auditorSessionId === leaf.session_id)) {
  return null;  // root 自审放行
}
```

**致命缺陷**：放行条件中 `auditorSessionId === null` 这一支**完全绕过 caller 校验**。结合 cmdAuditGate:2244 的 caller 校验：
```js
if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId) {
  throw ...E_BORROWED_IDENTITY...;
}
```
当 `audit_session_id === null` 时，短路逻辑跳过整个 caller 校验，直接进入 resolveAuditorIndep，root 信任锚分支放行。

**实测攻击验证**（独立跑 exploit 脚本确认）：

```
=== ATTACK 1: worker 用 audit_session_id=null 给 root 调 audit_gate pass ===
[attack root via null audit_session_id, caller=WORKER] true
  *** ATTACK 1 SUCCEEDED ***
  root.audit_gate: {"verdict":"pass","auditor_session_id":null,"ts":"2026-06-25T16:59:45.260+08:00"}
```

**影响**：任何 worker 调 `mcp__tree__tree_audit_gate(leaf_id=<root>, verdict=pass)`（不传 audit_session_id），即可：
1. 把 root.audit_gate 改为 `{verdict:pass, auditor_session_id:null}`
2. 覆盖 root 已有的合法 audit_gate（包括 fail 状态，抹掉真实审计结果）
3. 整个 trust chain 立即被攻陷（root 是信任锚）

**修复建议**：root 信任锚放行条件必须严格收紧——只允许 `auditorSessionId === leaf.session_id`（root 自己），不允许 `auditorSessionId === null`。或者，在 caller 校验前补一道：root 自审必须显式传 `audit_session_id === callerSessionId === root.session_id`。

---

#### 改动 2: cmdAuditGate root 自审分支（仅文档注释） — **【合格】**

**位置**: patch-l/tree-engine.cjs:2240-2249

C3 报告自评估："本次改动**仅添加文档注释**说明 root 自审的合法路径，未改逻辑（逻辑天然正确）"。代码本身正确：原 V10-self-audit-forbidden-v2 校验天然允许 `callerSessionId === audit_session_id === root.session_id` 的 root 自审。

**问题**：注释里说"worker 借 root session_id 调用时，caller=worker.session_id ≠ audit_session_id=root.session_id，仍被此校验拦"——这个论断**只对 worker 显式传 audit_session_id 的情况成立**。对于 worker 不传 audit_session_id（即 audit_session_id=null）的攻击向量，此校验失效（见改动 1 致命缺陷）。

---

#### 改动 3: cmdEventAppend 自动升级 root audit_gate — **【不合格，P0 失守】**

**位置**: patch-l/tree-engine.cjs:1594-1604；core/tree-state.js:1521-1534

**代码片段**：
```js
if (opts.type === 'done' && leaf.role === 'root') {
  const curGate = leaf.audit_gate;
  if (!curGate || curGate.verdict === 'skip') {
    leaf.audit_gate = {
      verdict: 'pass',
      auditor_session_id: leaf.session_id,
      ts: nowIso(),
      auto_upgrade: true
    };
  }
}
```

**致命缺陷**：cmdEventAppend 函数定义 `async function cmdEventAppend(args)` **没有 callerSessionId 形参**（patch-l:1429）。意味着任何角色（包括 worker）都能给任何 leaf（包括 root）写 done event，自动触发 trust-anchor auto_upgrade。

**实测攻击验证**（独立跑 exploit 脚本确认）：

```
=== ATTACK: worker 调用 event append 给 root 写 done event ===
worker append done to root, caller=WORKER: true
root.audit_gate: {"verdict":"pass","auditor_session_id":"11111111-...","ts":"...","auto_upgrade":true}
root.status: done
  *** ATTACK SUCCEEDED: worker 通过 event append 给 root 写 done 触发 auto_upgrade ***
```

**影响**：任何 worker 调 `mcp__tree__tree_event_append(leaf_id=<root>, type=done, ...)`，即可：
1. 把 root.audit_gate 从 skip 升级为 pass（auto_upgrade=true）
2. root 立即变成"信任锚已通过自审"状态
3. 整个 trust chain 一键被攻陷

**修复建议**：cmdEventAppend 必须接收 callerSessionId 并校验 caller 是 leaf 拥有者（或 commander 祖先）。或更窄：auto_upgrade 触发条件加 `callerSessionId === leaf.session_id`（root 自己才能触发 root 自审）。

---

#### 改动 4: cmdLeafAdd 拒绝 role=root — **【合格】**

**位置**: patch-l/tree-engine.cjs:655-664；core/tree-state.js:588-597

**代码片段**：
```js
if (role === 'root') {
  throw new TreeStateError(
    E_SCHEMA_INVALID,
    `leaf_add cannot create root leaf; use 'init' command instead. ...`
  );
}
```

实施正确。T6 测试验证通过。

---

### 攻击面分析

#### 攻击 1（已确认失守）: worker 用 audit_session_id=null 给 root 调 audit_gate pass

- **是否绕过 V10-self-audit-forbidden-v2**：✓ 绕过（caller 校验短路）
- **是否绕过 V10-trust-anchor 改动 1**：✗ 改动 1 的 root 信任锚放行条件包含 `auditorSessionId === null`，攻击者正好命中
- **是否需要新增 caller===leaf.session_id 双重校验**：是的，强烈建议

#### 攻击 2（已确认失守）: worker 通过 event_append 给 root 写 done event 触发 auto_upgrade

- **是否绕过 cmdEventAppend**：✓ 绕过（cmdEventAppend 完全没有 caller 形参）
- **是否绕过 V10-trust-anchor 改动 3**：✗ 改动 3 的 auto_upgrade 触发条件只看 `opts.type === 'done' && leaf.role === 'root'`，不校验 caller
- **修复方向**：cmdEventAppend 必须接收 callerSessionId 形参，dispatch 透传

### 鸡生蛋解决？

C3 方案的设计目标"root 自审 → commander 由 root 背书 → worker 由 commander 背书"在概念上成立，但实施有两个 P0 漏洞，导致 trust chain **可以被任何 worker 一键攻陷**，根本不需要走"鸡生蛋"流程。

### T7 测试场景

T7 测试"root 给非直接子 worker audit_gate pass"反映的是 V2 的 `auditor=added_by` 约束：直接子（commander.added_by=root.session_id）不能由 root 作 auditor。这是 V2 的设计约束，不是 C3 的缺陷。production 用法 root→commander→worker，worker.added_by=commander，root 可作 worker 的 auditor。

但 T7 **没有覆盖** "worker 通过 event_append 给 root 写 done 触发 auto_upgrade" 这个攻击向量——T7 只测了 root 自己写 done event（caller=UUID.root）的合法路径。

---

## Part 2: D4 helper 配套评价

### 4 层配套逐项

#### Layer 1: mcp__tree__tree_help 工具 — **【合格】**

- **位置**: patch-l/tree-engine.cjs:2766-3261（HELP_TOPICS 表）+ 3265-3289（cmdHelp 函数）+ patches.cjs:1160（MCP 注册）
- **13 个 topic 全部写了**：how_to_init / how_to_register_auditor / role_semantics / v10_constraints / self_audit_forbidden / borrowed_identity / naming_convention / common_mistakes / alignment_workflow / nudge_escalation / audit_tree_structure / error_code_index / full_guide（grep 验证 13 个 entry）
- **内容质量**：每个 topic 都有 title / related / content / 关键词覆盖。`self_audit_forbidden` 内容含失守案例 + V10 修复代码 + 正确流程，实用性强。
- **65996e8b 案例覆盖**：`common_mistakes` topic 完整列出 5 个错误（建空树/编造命名/调用顺序错乱/借身份/报告早于落库）+ 4 阶段失守模式（瞎试/瞎编/嘴硬/后补），覆盖 65996e8b 教训。

#### Layer 2: tree_init tips 注入 — **【合格】**

- **位置**: patch-l/tree-engine.cjs:608-627（buildInitTips 函数 + cmdInit 注入）
- **4 条 next_steps**：how_to_register_auditor / v10_constraints / common_mistakes / full_guide
- **skill_reference**：`skills/tree-commander/SKILL.md`（正确路径）
- **pro_tip**：含 V10-uuid-format-strict 提醒

H3 测试验证 next_steps 长度=4 + 每条提及 tree_help + skill_reference 含 SKILL.md + pro_tip 存在，全部通过。

#### Layer 3: 错误码附 help 引用 — **【合格】**

- **位置**: patch-l/tree-engine.cjs:177-214（ERROR_TO_HELP 映射表）+ 167-170（TreeStateError 改造）+ 3480-3489（run() catch 块）
- **集中映射设计正确**：TreeStateError 构造函数挂 `this.help_topic = ERROR_TO_HELP[code] || null`，run() catch 块据此生成 `error.help_topic` + `error.help_hint`
- **33 个错误码全映射**：grep 验证 21 个旧码 + 13 个 V10 新码（注：error_code_index topic 中说 33 个，实际表中是 34 项，含 E_TREE_NOT_VALIDATED，比 spec 多 1 个，但都映射了）
- **TreeStateError 构造函数改动正确**：方案 B（集中映射）实施，零侵入所有 throw 点
- **run() catch 块改动正确**：`error = { code, msg }` + 条件附 `help_topic` + `help_hint`

#### Layer 4: SKILL description 强化 — **【合格】**

- **位置**: skills/tree-commander/SKILL.md frontmatter + skills/tree-worker/SKILL.md frontmatter
- **关键词覆盖**：建树 / 端到端测试 / V10 验证 / audit_gate 测试 / 派子会话 / Fork worker / Fork auditor / 并行 Agent / 多 Agent 协作 / 树形任务分解 / 任何 mcp__tree__* 工具调用前的规范加载
- **tree-worker SKILL**：被 Fork / 5 件套契约 / brief_echo / milestone 自审 / Worker 角色

### 集中映射设计验证

- **ERROR_TO_HELP 表完整**：33+ 错误码全部映射，V10 16 个新码 100% 映射到对应 topic
- **TreeStateError 构造函数**：`this.help_topic = ERROR_TO_HELP[code] || null`，挂载点正确
- **run() catch 块**：先尝试从 `e.help_topic`（已挂载），fallback 到 ERROR_TO_HELP[code]，逻辑正确

### 测试匹配验证

- **dbc-spec.cjs**: 按 `r.error.code` 匹配（grep 验证）→ help_topic 字段加上去不影响 code 匹配 ✓
- **audit-attacks.cjs**: 按 `r.error.code` 匹配（grep 验证）→ 不影响 ✓
- **v10-cleanroom.cjs**: 按 `r.error.code` 匹配 → 不影响 ✓
- **v10-regression.cjs**: 按 `r.error.code` 匹配 → 不影响 ✓

**结论**：help_topic / help_hint 字段加在 error 对象上不破坏任何现有金标准测试。D4 报告自评估"不破坏"判定正确。

### 测试覆盖率

helper-test.cjs 6 用例：
- H1: help(how_to_init) 内容质量 ✓
- H2: unknown topic 错误处理（含 Available 列表）✓
- H3: tree_init tips 注入（4 条 next_steps + skill_reference + pro_tip）✓
- H4: E_BORROWED_IDENTITY → help_topic='self_audit_forbidden' ✓
- H5: E_NAME_INVALID + E_INVALID_UUID_STRICT → help_topic ✓
- H6: 13 topic 完整性 + 互不相同 ✓

**覆盖度评估**：合理但偏窄。仅测试了 2 个 V10 错误码（E_BORROWED_IDENTITY / E_INVALID_UUID_STRICT）的 help_topic 映射，剩余 14 个 V10 错误码未单独验证 help_topic 正确性。建议未来加 H7 用例批量验证所有 16 个 V10 错误码。

---

## Part 3: 3 处 diff 验证

### core vs patch-l

```bash
$ diff core/tree-state.js patch-l/tree-engine.cjs | wc -l
128
```

剩余 128 行差异**全部是合理差异**（已独立核对前 80 行）：
- TREES_ROOT 改造（core 用 `__dirname`，patch-l 用 `let TREES_ROOT` + setTreesRoot）
- main() → run() CLI shim 重构
- 注释微调（main() catch 块 vs run() catch 块）

**D4 helper 改动已回写 core**（D4-fix 任务完成）：grep 验证 core 含 48 处 D4 标记（HELP_TOPICS / ERROR_TO_HELP / cmdHelp / tree_help / help_topic / help_hint / buildInitTips），与 patch-l 一致。

**C3 trust-anchor 改动已存在于 core**：grep 验证 core 含 5 处 `V10-trust-anchor` 标记（与 patch-l 一致，patch-l 多 2 处是 SKILL 内联引用）。

### patch-l vs dist

```bash
$ diff patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/tree-engine.cjs | wc -l
0
```

**完全逐字一致** ✓

### patch-l patches.cjs vs dist patches.cjs

```bash
$ diff patch-l/proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs | wc -l
0
```

**完全逐字一致** ✓

### core 同步状态结论

**core 已同步**（D4-fix 已完成）。C3+D4 全部改动在 3 处文件中字面一致（除合理的 wrapper 差异外）。

---

## Part 4: 测试回归

| 测试套件 | 期望 | 实测 | 状态 |
|---------|------|------|------|
| v10-trust-anchor-test | 18/18 通过 | **18/18 通过** | ✓ |
| helper-test | 6/6 通过 | **6/6 通过** | ✓ |
| v10-cleanroom | 54/54 通过 | **54/54 通过** | ✓ |
| dbc-spec | 48/0 通过 | **48/0 通过** | ✓ |
| audit-attacks | 18 总/0 可绕过 | **18 总 / 0 可绕过 / 17 不可绕过 / 1 部分（CP2-direct-forge baseline）** | ✓ |
| v10-regression | 14/14 通过 | **14/14 通过** | ✓ |

**全部 6 套测试通过，0 退化。**

**但测试覆盖盲区**：6 套测试都没覆盖我发现的 C3 两个 P0 攻击向量（worker 用 audit_session_id=null 给 root 调 audit_gate / worker 通过 event_append 给 root 触发 auto_upgrade）。**测试通过 ≠ 实施安全**。

---

## 最终结论

### 一句话

**整体不合格，C3 必须返工**：D4 helper 配套完整合格可收敛；C3 trust-anchor 有 2 个 P0 致命失守（root 信任锚被 worker 一键攻陷），必须修复后才能收敛。

### 后续建议

#### 必修（P0，C3-fix 任务）

1. **修复改动 1 放行条件**：`resolveAuditorIndep` 中 root 信任锚放行条件去掉 `auditorSessionId === null` 这一支，只保留 `auditorSessionId === leaf.session_id`。或要求 root 自审必须显式传 audit_session_id。

2. **修复改动 3 caller 校验缺失**：`cmdEventAppend` 接收 callerSessionId 形参，dispatch 透传。auto_upgrade 触发条件加 `callerSessionId === leaf.session_id`（root 自己才能触发）。

3. **加测试用例覆盖攻击向量**：v10-trust-anchor-test.cjs 加 T8/T9：
   - T8: worker 用 audit_session_id=null 给 root 调 audit_gate pass（应拒）
   - T9: worker 通过 event_append 给 root 写 done event（应拒或 auto_upgrade 不触发）

#### 可选（P2）

4. **helper-test 加 H7**：批量验证 16 个 V10 错误码的 help_topic 映射（当前只测了 2 个）。

5. **方案文档补全**：`.context/plan/v10-trust-anchor.md` 不存在（C3 报告承认），建议 C 任务补写或主会话确认 spec 已在 C3 任务指令中完整传达。

#### 已收敛（D4 部分）

D4 helper 配套**推荐收敛**——4 层配套（help 工具 / init tips / 错误附 help / SKILL description）全部按方案实施，测试通过，core 已同步，可直接进入下一阶段。

---

## 评价者签名

- 评价者：v10v-A3A4-auditor（独立上下文，禁看 C3/D4 实施报告除决策点章节外）
- 评价方法：独立读 spec + 独立读代码 + 独立跑 exploit 验证 + 独立跑 6 套金标准测试
- 关键发现：C3 改动 1 + 改动 3 的两个 P0 失守（独立 exploit 脚本确认）
- 报告生成：2026-06-25
