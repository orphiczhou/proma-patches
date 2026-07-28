# D2 — Tree Harness 引擎语义审计报告

| 项 | 值 |
|---|---|
| 审计对象 | `D:/Codes/tree-harness/tree-engine.cjs` |
| 实际行数 | **5766 行**(任务契约称 5425 行,实际多 341 行,存在增量) |
| 审计角色 | leaf_id=`audit-D2-commander`,tree_id=`audit` |
| 审计方法 | 纯源码静态阅读,逐路径核验,**不信任 SKILL/FINAL-REPORT 声称** |
| 严重度图例 | 🔴 red=与声称矛盾/可绕过安全门 / 🟡 yellow=设计权衡需明示/防御纵深缺口 / 🟢 green=源码与声称一致 |

## 0. 总览结论(先给判定)

| 关键问题 | 判定 |
|---|---|
| CLI 兼容通道(省略 callerSessionId)是不是 V10 的致命绕过? | **🟡 不是致命绕过,但是"受信任边界"的隐含假设**。生产路径走 MCP wrapper(`__proma_getMcpServers__` 注入 callerSessionId,非调用方可控),CLI 仅测试/应急。但若 server 进程被攻破可直接调 `engine.run()`,全部 V10 防线失效。 |
| segment_add 身份继承矩阵 SKILL 说的和源码一致吗? | **🟢 身份继承一致(不改 session_id/added_by),但 🟡 完全无 caller 校验**,可被恶意追加 segment_chain。 |
| root 的 milestone 门禁豁免,SKILL §13.3a 声称"当前无豁免"是真的吗? | **🔴 源码直接矛盾**。L1765 明确 `if (!isAuditor && !isRoot)` 跳过 milestone 门禁,root **有**豁免。 |
| resolveAuditorIndep 三闸门逻辑是否如 SKILL 宣称? | **🟢 基本一致**,边界条件清晰,信任锚例外合理。 |
| auto_upgrade / brief_echo 状态联动是引擎内置还是 SKILL 协议层? | **🟢 引擎内置**(L2746 brief_echo→active / L2767 root done→audit_gate pass)。FINAL-REPORT "纯协议层 0 引擎改动"声称不准确。 |

---

## 1. M1 — V10 caller 校验 + segment_add 身份继承

### F1 🟡 V10 caller 校验的「AND 短路」模式 — CLI 全跳过(设计权衡)

V10 的 caller===audit_session_id 硬约束在源码里有 **4 处**,全部采用同一短路模式:

| 位置 | 函数 | 源码 |
|---|---|---|
| L2341 | `cmdMilestoneSetResult` | `if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId)` |
| L3560 | `cmdAuditGate` | `if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId)` |
| L2522 | `cmdEventAppend`(done event) | `if (opts.type === 'done' && callerSessionId && callerSessionId !== leaf.session_id)` |
| L3701 | `cmdAuditAppend` | `if (callerSessionId && callerSessionId !== entry.auditor_session_id)` |

**关键**:条件是 `audit_session_id && callerSessionId && ...` —— 两者**都存在**且不等才拒。CLI 调用不传 caller(`callerSessionId=undefined`),整个条件为 false → **跳过校验**。

L2340 / L3554 注释明确写道:"CLI 调用(dbc-spec 等)不传 caller,跳过此校验(向后兼容)"。

**对抗性判定**:这不是 bug,是显式设计权衡(金标准测试兼容)。但 SKILL 若教 commander"V10 拦死了借身份",必须补一句:**仅在 MCP wrapper 路径下成立**。引擎无法区分"CLI 测试调用"与"攻击者直接 require engine.run()",边界完全由调用方是否传 caller 决定。

### F2 🟢 caller-binding 范式一致性(状态/归属类操作)

状态与归属类命令采用统一的 `if (callerSessionId)` 三选一守门(owner / creator / root-self):

| 位置 | 函数 | 允许的 caller |
|---|---|---|
| L1732-1742 | `cmdLeafSetStatus` | owner(session_id) ∥ creator(added_by) ∥ root-self |
| L2159-2164 | `cmdLeafSetSession` | **仅 creator(added_by) ∥ root-self**(更严,改 session_id=夺权) |
| L2252-2257 | `cmdMilestoneAdd` | owner ∥ creator ∥ root-self |
| L2417-2426 | `cmdMilestoneUpdate` | owner ∥ creator ∥ root-self |

注意 **L2159 `cmdLeafSetSession` 比 `cmdLeafSetStatus` 更严**:set-session 不允许 owner(只允许 creator/root-self),因为改 session_id 等于转移 done-event 所有权,这是更重的操作。范式合理 ✓。

### F3 🟡 segment_add 完全无 caller 校验(身份继承对,但缺鉴权)

`dispatch` L5301-5302:
```js
case 'segment':
  return await dispatchSegment(args);   // ← 不透传 callerSessionId
```
`dispatchSegment` L5419 与 `cmdSegmentAppend` L2874 均不接收 callerSessionId 形参。

**后果**:任何 session 都能给任意 leaf 追加 `segment_chain`,并把 `leaf.status` 强制改为 `'segment_pending'`(L2902)。攻击面:恶意 worker 可把活跃兄弟 leaf 一键竹节化,扰乱 commander 协作编排。

**对照声称**:任务契约问"segment_add 是否真的只追加 segment_chain 不改 session_id/added_by" — **是,这点 SKILL 说的对**(见 F4)。但"缺 caller 校验"是 SKILL 未披露的副作用。

### F4 🟢 segment_add 身份继承矩阵 — 与 SKILL 声称一致

L2900-2902:
```js
if (!Array.isArray(leaf.segment_chain)) leaf.segment_chain = [];
leaf.segment_chain.push(new_session_id);
leaf.status = 'segment_pending';
```
**只动两处**:`segment_chain` 数组 push + `status` 改 `segment_pending`。**不动** `leaf.session_id`、`leaf.added_by`、`leaf.role`、`leaf.parent`。

这印证了 memory `macp6-idle-misjudge.md` 记录的"segment_add 不切 leaf.session(CLI 应急化解)"——身份归属不变,所以竹节交接后原 session 仍是该 leaf 的 owner,可继续操作。SKILL 声称 ✓。

附带:drift 双写留痕(L2914 写 `leaf.drift_history`,L2916 写 `state.drift_log`),`severity:'low'` `action:'handoff'`,可审计 ✓。

### F5 🟢 segment_chain session_id 唯一性校验(L3165)

`collectValidateIssues` 检查 3(L3165-3198)会扫描全树 `segment_chain` 跨 leaf 唯一性 + 与 `leaf.session_id` 不重复。`cmdSegmentAppend` 入口 L2891-2898 也做了运行时唯一性预检。双层防线 ✓。

---

## 2. M2 — resolveAuditorIndep 三闸门 + done 门禁 + CLI 兼容通道

### F6 🟢 resolveAuditorIndep 三闸门(L3031-3120)— 与 SKILL 声称一致

逐路径核验三闸门触发条件:

**闸门 1 — root 自审放行(L3044-3046)**
```js
if (leaf.role === 'root' && auditorSessionId === leaf.session_id) {
  return null;  // root 自审放行(必须显式传 root 自己的 session_id,不允许 null)
}
```
边界:`auditorSessionId` 必须显式等于 `leaf.session_id`,**null 不放行**(L3037-3043 V10-trust-anchor-fix 删除了 null 放行支,堵 worker 用 null 一键改 root.audit_gate)。✓

**闸门 2 — root 担任非 root leaf 的 auditor(L3061-3075)**
```js
if (leaf.role !== 'root' && auditorSessionId) {
  const rootLeaf = Object.values(state.leaves).find(
    (l) => l.parent === null && l.role === 'root' && l.session_id === auditorSessionId
  );
  if (rootLeaf && rootLeaf.leaf_id !== leaf.leaf_id) {
    if (rootLeaf.status === 'archived' || rootLeaf.status === 'pruned') return ... 'must be active/done';
    if (!Array.isArray(rootLeaf.events) || rootLeaf.events.length === 0) return ... 'events empty';
    return null;  // trust anchor 死锁修复
  }
}
```
边界:auditor 必须是树中真实 root leaf(parent=null + role=root + session 匹配);且 root 自身须状态活跃 + 已有 ≥1 event(审计员 P0 反馈修复,堵 root 被注入后一键背书)。✓ 这正是 memory `multi-layer-tree-commander.md` 记录的"audit门禁冷启动回流root信任锚"机制。

**闸门 3 — 通用独立 auditor(L3077-3119)**
- L3077 `auditorSessionId` 非空
- L3079 严格 UUID v4(`isValidStrictUuidV4`,拒全 0/全 f/非 v4)
- L3085-3089 session 活跃性(`checkSessionAlive`,verifier 拒绝则拦,未注入则 bypass)
- **L3091 自审禁令**:`if (leaf.added_by && auditorSessionId === leaf.added_by) return 'auditor=added_by (self-audit forbidden)'`
- L3096-3106 auditor 必须是树中真实活跃 leaf(过滤 pruned/archived)
- L3107 auditor 不能是自己
- L3110-3119 **V10-auditor-active**:auditor leaf 自身必须 `status='done'` + events 非空 + 自己 `audit_gate.verdict=pass/pass_with_minor`

三闸门逻辑与 SKILL §13 声称一致,边界条件充分 ✓。

### F7 🟢 L3091 自审禁令边界条件 — 正确但有隐含前提

```js
if (leaf.added_by && auditorSessionId === leaf.added_by) return 'auditor=added_by (self-audit forbidden)';
```

**边界**:`leaf.added_by` 必须存在才校验。
- root leaf 的 `added_by` 通常为 null(无父创建它)→ 跳过此检查,但 root 走闸门 1 已放行,无影响。
- worker/commander 的 `added_by` 存在(创建它的 commander/root session)→ added_by 不能当自己的 auditor ✓。

**隐含前提**:此禁令依赖 `leaf.added_by` 字段被正确填充。若通过 CLI 通道手工注入 leaf(`cmdLeafAdd` CLI 模式跳过 L1032 caller 校验),可构造 `added_by=null` 的 leaf 绕过此禁令。但闸门 3 的其他子项(L3096 auditor 必须真实存在)仍兜底。综合判定 green,但属"防御纵深依赖字段完整性"。

### F8 🔴 done 门禁 root/auditor 豁免 — 与 SKILL §13.3a 声称"当前无豁免"直接矛盾

L1763-1765:
```js
// macp4 P0-E: root 也跳过 milestone 门禁(auto_upgrade §13.3a 只改 audit_gate 不改 milestone,
//   root 0 milestones 撞 E_SCHEMA_INVALID)。root 仍过 done event + children 门(独立于本块)。
if (!isAuditor && !isRoot) {
  // ... milestone 非空 + audit_pass + expect_outputs + deliverables 落盘 全部在此块
}
```

**源码事实**:`role==='root'` 和 `role==='auditor'` **都跳过** milestone/expect_outputs/deliverables 三道门禁。

**任务契约声称**:SKILL §13.3a 声称"root 当前无豁免"。

**🔴 直接矛盾**。源码注释 L1763 明确写"macp4 P0-E: root 也跳过 milestone 门禁",这是 macp4 实战后增的修复(root 0 milestones 撞 E_SCHEMA_INVALID 的解药)。若 SKILL §13.3a 至今仍写"当前无豁免",则 SKILL 文本落后于引擎实现 —— **需 D3 核实 SKILL 文本并修订**。

**公正评估**:这不是引擎 bug(豁免逻辑自洽:root/auditor 是信任锚/审计者,产物是 verdict 而非交付物,milestone 门禁对它们无意义)。问题在 SKILL 描述与源码脱节。

### F9 🟢 done 门禁全链路完整(8 道门,worker 路径)

worker(非 root/auditor)走 `set-status=done` 须过 8 道:
1. **L1746 状态机白名单**(`STATUS_TRANSITIONS[from].includes(new_status)`,堵 done→active 回退)
2. **L1765 milestone 非空 + 全 audit_pass**(root/auditor 豁免,见 F8)
3. **L1784 expect_outputs 非空 + 非空字符串**(V3 堵零交付物)
4. **L1798 deliverables 落盘 + 拒绝对路径 + 路径遍历 + size>0 + 拒 symlink**(V9 物理产物钉死)
5. **L1848 brief_echo+done 双事件**(worker/auditor 强制 ≥2 events)
6. **L1868 review_round 收敛**(review_required 时,≤3 轮 + 末轮 red=0)
7. **L1901 audit_gate verdict=pass/pass_with_minor**(非 skip)
8. **L1911 V10-status-event-sync**(必须先有 done event 再 set-status)
9. **L1927 commander/root 子全 done + 子 audit_gate≠required**(v0.24 fix_required gate)

链路完整,防御纵深充分 ✓。

### F10 🟡 Bug A 修复(defense-in-depth 第二道)有缺口

L3601-3610(audit_gate pass 路径内):
```js
// Bug A 修复:验证 done event 的写入者身份
const callerOfDone = doneEvent.meta && doneEvent.meta.caller_session_id;
if (callerOfDone && callerOfDone !== leaf.session_id) {
  throw new TreeStateError(E_BORROWED_IDENTITY, ... 'done event was written by ..., not by leaf itself');
}
```

**问题**:done event 的构造在 L2700:`const ev = { type: opts.type, ts, meta };` —— **引擎不自动把 callerSessionId 注入 `meta.caller_session_id`**。`meta` 来自调用方传入的 `--meta` 参数。

**后果链**:
- 若调用方(MCP wrapper / agent)在 `--meta` 里**没主动**传 `caller_session_id`,则 `callerOfDone=undefined` → L3605 `if (callerOfDone && ...)` 短路 → **跳过校验**。
- 第一道防线 L2522(`if (callerSessionId && ...)`)在 MCP 路径仍拦,但 CLI 路径 + meta 不记 caller 时**两道同时失效**。

**公正评估**:不算完全失效(L2522 在 MCP 路径仍有效),但"done event 留痕 caller 身份"的设计意图未落地 —— 引擎应在 L2700 自动注入 `meta.caller_session_id = callerSessionId || null`,Bug A 修复才能真正生效。当前实现依赖调用方诚实,属防御纵深缺口。

---

## 3. auto_upgrade / brief_echo / audit_gate v0.21 枚举

### F11 🟢 auto_upgrade 引擎内置(非纯协议层)

L2767-2778:
```js
if (opts.type === 'done' && leaf.role === 'root') {
  const curGate = leaf.audit_gate;
  const callerIsRootSelf = !callerSessionId || callerSessionId === leaf.session_id;
  if ((!curGate || curGate.verdict === 'skip') && callerIsRootSelf) {
    leaf.audit_gate = {
      verdict: 'pass',
      auditor_session_id: leaf.session_id,
      ts: nowIso(),
      auto_upgrade: true
    };
  }
}
```

**触发条件**:type=done ∧ role=root ∧ (无 gate 或 verdict=skip) ∧ callerIsRootSelf。
- **显式 fail/required 不被覆盖** ✓(L2761 注释)
- **callerIsRootSelf 含 `!callerSessionId`**(L2769)→ CLI 通道下任何人给 root 写 done event 都触发。但 L2522 入口校验在 MCP 路径已拦 worker 给 root 写 done,CLI 路径才是这个 `!callerSessionId` 分支的实际触发点。

**对照声称**:FINAL-REPORT §3 声称"6 项核心改进大部分是纯 SKILL 协议层(0 引擎改动)" —— **不准确**。auto_upgrade 是 `cmdEventAppend` 内的引擎硬编码逻辑(L2767-2778),非 SKILL 协议层。同理 brief_echo 自动转 active(L2746)也是引擎内置。

### F12 🟢 brief_echo 状态联动引擎内置

L2746-2748:
```js
if (opts.type === 'brief_echo' && leaf.role === 'worker' && leaf.status === 'pending_brief') {
  leaf.status = 'active';
}
```
- 仅 worker 触发(commander/auditor 初始即 active)
- 仅 pending_brief → active(幂等,不改 done 路径)
- 堵"worker 已回应 brief 但 tree 仍显示 pending_brief"的 commander 心跳误判

引擎内置 ✓,与 SKILL 声称一致。

### F13 🟢 audit_gate v0.21 pass_with_minor 枚举完整

- **L3527 `isPassVerdict`**:`v === 'pass' || v === 'pass_with_minor'`(pass_with_minor 视为放行)
- **L3540 枚举校验**:`['required','pass','pass_with_minor','fail','skip']`
- **L3579**:pass_with_minor 触发 `resolveAuditorIndep`(独立性硬约束)
- **L3592**:pass_with_minor 走 done event 时序校验(A7)
- **L3633-3651 red 阈值**:v0.20 扫所有历史 audit_log → **v0.23 修复为只看最新一条**(ns1b 死锁教训:旧 red append-only 不可清除,真实修复后复审仍被拦)。仅 `severity='red'` 阻断,yellow(green)放行 —— mid 由 SKILL 教化加权,引擎只兜底 red。
- **severity 必填**:L3686 audit_log entry schema 要求 `results:[{item,pass,evidence,severity}]`,L1671 review_round 也校验 `['red','yellow','green'].includes(f.severity)`。

v0.21 语义实现完整 ✓。

---

## 4. CLI 兼容通道绕过项汇总(F14 🟡)

任务契约要求列出"CLI 兼容通道(省略 callerSessionId)绕过的具体校验项"。逐函数核验如下表:

| # | 函数 | 行号 | 守门条件 | CLI 绕过后果 |
|---|---|---|---|---|
| 1 | `cmdLeafAdd` | L1032 | `if (callerSessionId && added_by && ...)` | 借任意 added_by 注册 leaf |
| 2 | `cmdLeafSetStatus` | L1732 | `if (callerSessionId)` | 跨身份杀 leaf(prune/archive 他人) |
| 3 | `cmdLeafSetSession` | L2159 | `if (callerSessionId)` | 夺权:改 leaf.session_id 转移所有权 |
| 4 | `cmdMilestoneAdd` | L2252 | `if (callerSessionId)` | 给他人 leaf 注入 milestone |
| 5 | `cmdMilestoneSetResult` | L2341 | `if (audit_session_id && callerSessionId && ...)` | 伪造 audit_pass(需过 resolveAuditorIndep) |
| 6 | `cmdMilestoneUpdate` | L2416 | `if (callerSessionId)` | 篡改 milestone desc/expect_outputs(已 audit_pass 的仍被 L2439 拦) |
| 7 | `cmdAuditGate` | L3560 | `if (audit_session_id && callerSessionId && ...)` | 伪造 audit verdict(需过 resolveAuditorIndep) |
| 8 | `cmdAuditAppend` | L3701 | `if (callerSessionId && ...)` | 伪造 audit_log 背书 |
| 9 | `cmdEventAppend`(done) | L2522 | `if (callerSessionId && ...)` | 代写他人 leaf 的 done event |
| 10 | auto_upgrade | L2769 | `!callerSessionId ∥ ...` | CLI 写 root done → 自动 audit_gate pass |

**关键缓解**:#5 和 #7 即使 CLI 跳过 caller 校验,仍须过 `resolveAuditorIndep`(L2347 / L3580)—— auditor 必须是树中真实独立活跃 leaf,不能凭空伪造。所以 CLI 通道**不是无条件绕过**,而是"借树中已有身份"才能绕。

**对抗性判定**:
- **不是致命绕过**(对生产路径):MCP wrapper 由 `__proma_getMcpServers__(sessionId, ...)` 注入 callerSessionId(L3553 / L4621),调用方无法伪造。memory `tree-engine-cli-recovery.md` 记录的"省略 callerSessionId 走 CLI 兼容模式"是 root 会话恢复后的应急通道,非攻击面。
- **是隐含信任边界**:引擎假设"能调 engine.run() 的都是可信方"。若 server 进程被攻破或 agent 直接 require engine,所有 V10 防线归零。SKILL 应明示这一假设。

---

## 5. self_check 逐项核对

| 任务契约 self_check 项 | 核验结果 | 证据 |
|---|---|---|
| V10 caller 校验完整性逐路径 | ✓ 4 处全核验 | F1 表(L2341/L3560/L2522/L3701) |
| segment_add 身份继承矩阵逐项 | ✓ 不改 session_id/added_by,但无 caller 校验 | F3/F4(L2900-2902) |
| 三闸门边界条件 | ✓ 闸门1/2/3 触发条件清晰 | F6(L3044/L3061/L3077) |
| CLI 兼容通道绕过项列表 | ✓ 10 项列出 | F14 表 |
| 每条 finding 有 severity + 行号 | ✓ red/yellow/green 全标注 | 全文 |

### 5.1 质量门禁字面自检(dod.must_contain)

- **源码行号引用**:全文 30+ 处 `Lxxxx` 行号佐证(L1032/L1035/L1732/L1765/L2159/L2252/L2341/L2417/L246/L2522/L2700/L2746/L2767/L2769/L2874/L2900/L2902/L3031/L3044/L3061/L3077/L3091/L3110/L3165/L3527/L3540/L3560/L3579/L3592/L3604/L3633/L3686/L3701 等),**不依赖 SKILL 宣称**,逐条源码核验 ✓
- **声称 vs 源码对照**:F4/F6/F8/F11/F12 均含"SKILL 声称 / 任务契约声称 → 源码事实 → 判定"三段式对照 ✓
- **severity red/yellow/green**:F1-F14 全部标注(🔴×1 P0-1 + 🟡×5 + 🟢×8)✓
- **V10 caller 校验**:F1 表 + F14 表双覆盖 ✓
- **segment_add**:F3/F4/F5 三条专项 ✓
- **resolveAuditorIndep**:F6/F7 两条专项(三闸门 + L3091 自审禁令)✓

---

## 6. P0 级必须上报(任务契约 `must_report`)

> 发现引擎实际行为与 SKILL 声称严重不一致(P0 级)须上报。

**🔴 P0-1:SKILL §13.3a 声称"root milestone 门禁当前无豁免"与源码 L1765 `if (!isAuditor && !isRoot)` 直接矛盾**。源码明确豁免 root 和 auditor,注释 L1763 标注这是 macp4 P0-E 修复。需 D3 核实 SKILL 文本:
- 若 SKILL 确实写"无豁免"→ SKILL 落后于引擎,需修订
- 若任务契约对 SKILL 的转述有误 → 以源码为准,root 有豁免是事实

**🟡 P1-2:auto_upgrade(L2767)与 brief_echo→active(L2746)是引擎内置硬编码,FINAL-REPORT §3 "纯 SKILL 协议层(0 引擎改动)"声称不准确**。这两处是引擎行为,非协议层教化。

**🟡 P1-3:segment_add(L2874)完全无 caller 校验**,可被恶意追加 segment_chain + 强制 status='segment_pending'。SKILL 未披露此副作用。

**🟡 P1-4:Bug A 修复(L3604)依赖调用方在 meta 传 caller_session_id,引擎 L2700 不自动注入**,defense-in-depth 第二道在默认情况下失效。

---

## 7. 审计局限性说明

1. **未跑实际测试**(任务 out_of_scope),所有判定基于静态阅读。
2. **未核实 SKILL 文本原文**(D3 职责),F8 / P0-1 的"SKILL 声称"来自任务契约转述,需 D3 交叉核实。
3. **`checkSessionAlive` verifier 真实性校验**未深入(L3085-3089),其 `alive.bypass` 分支(verifier 未注入/异常时 bypass 不阻断)是否构成新绕过,需独立核验 —— 潜在 🟡 风险,本报告标记为待查项。
4. 引擎实际 5766 行,任务契约称 5425 行,**增量 341 行**未在本审计范围内逐一核验(本审计聚焦契约指定的 10 个语义点)。

---

**审计结论**:引擎核心语义(V10 caller / 三闸门 / done 门禁 / auto_upgrade / brief_echo / v0.21 枚举)实现质量高,防御纵深充分,**与 SKILL 声称大体一致**,唯 1 处直接矛盾(root milestone 豁免,F8/P0-1)+ 3 处需明示的设计权衡(CLI 信任边界 / segment 无鉴权 / Bug A meta 缺口)。**未发现引擎层致命绕过**,CLI 通道风险定性为"受信任边界假设"而非"V10 致命缺陷"。
