# D2 引擎语义正确性审计报告 — Tree Harness FINAL-REPORT 对抗核验

> 审计员: audit2-D2-worker (GLM-5.2, ZLM 渠道)
> 审计对象: `pr/20260728-harness-final/FINAL-REPORT.md` 自评 7/7 ✅ + C1=86/100
> 审计日期: 2026-07-28
> 审计方法: 独立源头文档核验（读 `tree-engine.cjs` / `proma-dev-patches.cjs` 代码实证，不读并行审计产物）
> 维度: D2 — 引擎语义正确性对抗核验（读代码非听宣称）

---

## 一、执行摘要

- **总体判定**: FINAL-REPORT §3.1/§3.5/§3.6 引擎声称 **大部分有代码支撑（5/6 维度 GREEN 或部分 GREEN）**，但 §3.6「CLI 兼容通道兜底」把一个**持久存在、文档化的引擎级后门**包装成"macp11 应急方案"——这是本轮最严重的过度宣称。配合 §3.1「L3061 优先 L3091 放行」的信任锚机制，两者组合构成可被任意进程滥用的代调通道，C1=86 未对此扣分。
- **confidence**: **high**（所有结论均带 `tree-engine.cjs:行号` 代码实证 + SKILL/macp 归档原文交叉印证）
- **一句话核心结论**: V10 caller 校验三命令在 **MCP 生产路径**实施正确（GREEN），但其安全前提（caller 校验生效）被 `run()` 第 4 参数 `callerSessionId` 可省略这一"向后兼容"设计整体短路，该短路被 SKILL v2.9.7 §13.3b L956-959 白纸黑字教化为"应急通道"，FINAL-REPORT §3.6 进一步将其正当化为"兜底"——形成文档化后门，未计入 7/7 完成度扣分。

---

## 二、Findings 表

| # | Severity | 问题摘要 | 证据 (file:line / 原文 / 归档) | 对 7/7 或 C1=86 的影响 |
|---|----------|---------|------------------------------|----------------------|
| F1 | 🔴 RED | CLI 兼容通道是文档化引擎级后门，省略 `callerSessionId` 即绕过全部 V10 caller 校验 | `tree-engine.cjs:5646/5654`（run 第4参可省）+ `:1732/2341/3560`（caller 校验均以 callerSessionId 真值为前置）+ `:2769`（`!callerSessionId` 直接放行 root auto_upgrade）+ `skills/tree-commander/SKILL.md:956-959`（白纸黑字"绕过 caller 校验"）+ `pr/20260727-macp11/ROOT-PROXY-HANDOFF.md:6`（实战代调） | §3.6 把后门包装为"兜底"；§5 列为 roadmap "标准化"=短期不修。C1=86 未扣 |
| F2 | 🔴 RED | resolveAuditorIndep 闸门2 (L3061 root-as-auditor) + F1 CLI 通道 = 任意进程可假冒 root 给全树背书 pass | `tree-engine.cjs:3061-3075`（root 担任非 root leaf auditor 仅校验 root 自身 status/events，不校验调用方身份）+ L3560 caller 短路（F1）→ resolveAuditorIndep 放行 | §3.1「L3061 优先 L3091 放行」当标准协议，未提及安全前提（caller 校验须真生效） |
| F3 | 🟡 YELLOW | segment_add 零 caller 校验 + 不切 session_id，A2 根治方案（leaf_transfer_owner）本轮未实施 | `tree-engine.cjs:5302`（dispatchSegment 不传 caller）+ `:5419`（无 callerSessionId 形参）+ `:2874-2922`（cmdSegmentAppend 无 caller 校验 + L2900-2902 只 push segment_chain 不改 session_id）+ `pr/20260727-macp9/results.md:9/52`（A2 留候选未实施） | 标准 #3「引擎 segment_add 评估」标 ✅，实为"评估完选 A3 SKILL 绕过"，引擎未根治。部分达成 |
| F4 | 🟡 YELLOW | §3.1 术语混淆：commander done 不享受 auto_upgrade，是"初始 skip 放行" | `tree-engine.cjs:2767`（auto_upgrade 触发条件 `leaf.role === 'root'`，仅 root）+ `:1239/4103`（commander 初始 verdict='skip'）+ `:1904`（done 门禁 `verdict !== 'skip'` 短路放行）+ SKILL:909（自承 commander 无 auto_upgrade 标志） | 文档精度问题，不影响功能 |
| F5 | 🟡 YELLOW | SKILL 行号引用滞后 + §13.3a.2 前提过时（引擎已修 root 豁免） | SKILL:858 引用 auto_upgrade 在"L1961-1972"（实测 L2767-2778）+ SKILL:866/880 称"引擎 L1767 无 role=root 豁免"（实测 L1765 `!isAuditor && !isRoot` 已修，macp4 P0-E） | SKILL-代码漂移；D3 维度交叉发现 |
| F6 | 🟢 GREEN | V10 caller 校验三命令在 MCP 生产路径正确实施（堵 worker 借 auditor session） | `tree-engine.cjs:1732-1742`（cmdLeafSetStatus 三重 _isOwner/_isCreator/_isRootSelf）+ `:2341-2346`（cmdMilestoneSetResult caller===audit_session_id）+ `:3560-3565`（cmdAuditGate 同上）+ `proma-dev-patches.cjs:1989/1998/2003/2012`（callerSessionId 注入链完整） | MCP 路径 caller 校验真实有效 |
| F7 | 🟢 GREEN | worker 强制 audit_gate pass 才能 done（初始 verdict='required' 设计正确） | `tree-engine.cjs:1239/4103`（worker/auditor 初始 'required'）+ `:1904`（done 门禁 'required' 触发 E_GATEKEEPER_REQUIRED）+ `:3614-3632`（pass 时强制 alignment+done event+auditor 独立） | worker 无法跳过 audit_gate done，门禁设计正确 |
| F8 | 🟢 GREEN | resolveAuditorIndep V10-trust-anchor-fix 已删 null 放行支（cmdAuditGate 路径） | `tree-engine.cjs:3037-3044`（注释实证删除 `auditorSessionId === null` 放行 + L3044 必须显式 `=== leaf.session_id`） | 堵 worker 用 null 给 root 一键改 audit_gate（注：cmdEventAppend L2769 仍保留 !callerSessionId，见 F1） |

---

## 三、详细分析

### F1 🔴 CLI 兼容通道是文档化引擎级后门

**位置**: `tree-engine.cjs:5646`（run 主入口）/ `:1732` / `:2341` / `:3560` / `:2769`（caller 校验）/ `skills/tree-commander/SKILL.md:956-959`（教化）/ `pr/20260727-macp11/ROOT-PROXY-HANDOFF.md:6`（实战）

**问题**: FINAL-REPORT §3.6 把"`setTreesRoot + run(cmd, args)` 省略 callerSessionId 跳过 V10 caller 校验"描述为"macp11 兜底"，并在 §5 列为 roadmap「CLI 兼容通道标准化：caller 缺省降级文档化」。但代码实证显示，**所有 V10 caller 校验都以 `callerSessionId` 真值为前置条件**，省略即整体短路：

```js
// tree-engine.cjs:5646
async function run(cmd, args, treesRoot, callerSessionId) {  // 第4参可省
  ...
  const callerSid = callerSessionId || null;  // :5654 省略→null
  ...
  const result = await dispatch(cmd, args, callerSessionId);  // :5658 透传 undefined
}

// cmdLeafSetStatus :1732 — if 前置短路
if (callerSessionId) {
  const _isOwner = callerSessionId === leaf.session_id;
  ...
}

// cmdMilestoneSetResult :2341 — && 前置短路
if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId) { throw ... }

// cmdAuditGate :3560 — 同上
if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId) { throw ... }

// cmdEventAppend :2769 — !callerSessionId 直接放行 root auto_upgrade
const callerIsRootSelf = !callerSessionId || callerSessionId === leaf.session_id;
if ((!curGate || curGate.verdict === 'skip') && callerIsRootSelf) {
  leaf.audit_gate = { verdict: 'pass', auditor_session_id: leaf.session_id, ... auto_upgrade: true };
}
```

**SKILL v2.9.7 §13.3b L956-959 白纸黑字教化此后门为"应急通道"**：

```bash
# v2 直接 require tree-engine 跑（省略 callerSessionId = CLI 兼容模式，绕过 caller 校验）
node -e "const E=require('D:/Codes/tree-harness/tree-engine.cjs'); E.setTreesRoot('<treeDir>'); E.run(['leaf-set-status',...])"
```

**macp11 ROOT-PROXY-HANDOFF.md:6 实战**：

> root 当前会话丢失 mcp__tree__* 工具（模型切换后），改走 tree-engine CLI 兼容通道（... 省略 callerSessionId 跳过 V10 caller 校验，audit_session_id 诚实署名=root）

**后果**: 任意能 `require('tree-engine.cjs')` 的进程/会话（worker / 失联 v2 / 攻击者 / 任何 Proma 子进程）可用树中**真实存在且公开**的 `root.session_id`（写在 `tree-state.json` 明文里）调：
1. `run('audit',['gate',tree,leaf,'--verdict','pass','--audit-session-id',rootSid])` → L3560 caller 短路 → resolveAuditorIndep L3061 放行（见 F2）→ leaf.audit_gate=pass
2. `run('milestone',['set-result',tree,leaf,mid,'--audit-pass','true','--audit-session-id',rootSid])` → 同上 → milestone.audit_pass=true
3. `run('leaf',['set-status',tree,leaf,'done'])` → L1732 caller 短路 → 直达 done

叠加 `tree-state.json` 零完整性校验（D6 安全报告已记：直接编辑后 `validate` 返回 0 issues），攻击面进一步扩大——攻击者甚至不需要 require engine，直接编辑 JSON 即可伪造 done。

FINAL-REPORT 把这包装成"macp11 兜底"，但 macp11 的场景（root 模型切换丢工具）是**平台 bug**，正确修复方向是 §5 已列的「root idle 平台修复：tree_init 后强制启动 root agent 处理后续队列；模型切换不应丢失已注入 MCP 工具集」。用引擎后门兜底平台 bug，等于把 bug 的代价转嫁给安全边界。

**修复建议**:
1. **P0 区分 CLI 测试入口与生产入口**：`run()` 增加 `mode` 参数（`'cli-test' | 'production'`），`'cli-test'` 模式仅在 `process.env.PROMA_ALLOW_CLI_BYPASS === '1'` 时允许省略 caller（测试场景显式 opt-in），否则强制要求 callerSessionId。
2. **P0 引擎侧完整性校验**：`tree-state.json` 写入时附加 HMAC 签名（基于 workspace 密钥），`readState` 校验签名，堵直接编辑 JSON。
3. **P1 移除 SKILL §13.3b L956-959 教化**：CLI 应急通道不应进入 SKILL SOP，至少应标注"仅限本地开发测试，生产禁用"。
4. **P1 §5 roadmap 修正**：把"CLI 兼容通道标准化"改为"CLI 兼容通道下线 + 平台 root idle 修复"。

---

### F2 🔴 resolveAuditorIndep 闸门2 + CLI 通道 = 任意进程假冒 root 给全树背书

**位置**: `tree-engine.cjs:3061-3075`（root-as-auditor 分支）/ `:3560`（caller 校验，F1 短路）

**问题**: FINAL-REPORT §3.1 称「commander 用 root 代调 milestone_set_result（caller=root===audit_session_id=root，L3061 优先 L3091 放行）」为"标准协议"。代码实证 L3061 确实在 L3091（added_by 自审禁令）之前 return，但 L3061 分支本身有重大安全前提未在报告中提及：

```js
// tree-engine.cjs:3061-3075
if (leaf.role !== 'root' && auditorSessionId) {
  const rootLeaf = Object.values(state.leaves).find(
    (l) => l.parent === null && l.role === 'root' && l.session_id === auditorSessionId
  );
  if (rootLeaf && rootLeaf.leaf_id !== leaf.leaf_id) {
    // root 自身最低状态校验（审计员 P0 反馈：堵 root 被注入后一键背书）
    if (rootLeaf.status === 'archived' || rootLeaf.status === 'pruned') { return ... }
    if (!Array.isArray(rootLeaf.events) || rootLeaf.events.length === 0) { return ... }
    return null;  // root 担任非 root leaf 的 auditor，放行
  }
}
```

L3061 的设计意图（注释 L3048-3059）是修复"鸡生蛋"死锁：worker 占满 node_budget 无法创建独立 auditor，由 root 作 trust anchor 打破死锁。注释 L3066 自承"审计员 P0 反馈：堵 root 被注入后一键给所有 worker 背书 pass"，实际只加了 root 自身 status/events 校验。

**致命盲点**: L3061 **只校验 rootLeaf 自身状态，完全不校验"调用方是否真是 root"**。调用方身份校验依赖 cmdAuditGate L3560 的 `caller === audit_session_id`——但 F1 已证明 CLI 通道能整体短路该校验。两者组合：

```
攻击者 (任意 session X) 调:
  run('audit', ['gate', tree, victimLeaf, '--verdict', 'pass', '--audit-session-id', rootSid])
  ↓ callerSessionId=undefined → L3560 短路不抛
  ↓ resolveAuditorIndep(state, leaf, rootSid) → L3061 命中（rootSid 是真实 root.session_id）
  ↓ rootLeaf.status=active/done + events 非空 → return null 放行
  ↓ victimLeaf.audit_gate = { verdict:'pass', auditor_session_id: rootSid }
```

攻击者**甚至不需要 root idle / 模型切换**——只要 root 正常活跃（status=active/done + events 非空，这是 root 的常态），任意进程都能用 root.session_id 给任意 worker 背书 pass。

**与 L3091 优先级核验**: FINAL-REPORT §3.1 称"L3061 优先 L3091 放行"——**代码实证属实**（L3061 在 L3091 之前 return null），但这恰恰是问题所在：root 作 auditor 时绕过了 added_by 自审禁令（worker.added_by 可能就是 root，但 L3061 提前放行不查 added_by）。这是信任锚设计的固有 trade-off，但 FINAL-REPORT 把它当 feature 宣扬，未揭示其安全前提。

**后果**: 配合 F1，整个 V10 caller 校验体系存在一条 documented 通道被整体绕过。macp11 实战已证明此通道可工作（root 代调 J1/S1 全 pass，validate=0 issues），意味着任何掌握 root.session_id 的进程都能复刻 macp11 路径。

**修复建议**:
1. **P0 cmdAuditGate L3560 移除 CLI 短路**：caller 校验改为 `if (audit_session_id !== callerSessionId) throw`（无真值前置），CLI 测试场景显式传 caller。
2. **P1 resolveAuditorIndep L3061 增加 root 调用方校验**：要求调用方 caller 必须 === rootLeaf.session_id（与 root 自审 L3044 同范式），不依赖外层 cmdAuditGate。
3. **P2 引入"root 代调次数审计"**：root 给非自己子树的 leaf 背书 pass 时，记 high severity drift + 上行父会话确认。

---

### F3 🟡 segment_add 零 caller 校验 + 不切 session_id（设计 gap 未根治）

**位置**: `tree-engine.cjs:5302`（dispatch 不透传 caller）/ `:5419-5428`（dispatchSegment 无 caller 形参）/ `:2874-2922`（cmdSegmentAppend 无 caller 校验 + L2900-2902 不切 session_id）

**问题**: FINAL-REPORT 标准 #3「引擎 segment_add 评估」标 ✅，并归档 `pr/20260727-macp9/`（A1/A2/A3 三方案）。代码实证：

```js
// tree-engine.cjs:5419 — dispatchSegment 是唯一不接 callerSessionId 的 dispatch
async function dispatchSegment(args) {  // ← 无 callerSessionId 形参
  ...
  case 'append': return await cmdSegmentAppend(rest);  // ← 不传 caller
}

// tree-engine.cjs:2874 — cmdSegmentAppend 无任何身份校验
async function cmdSegmentAppend(args) {  // ← 无 callerSessionId 形参
  ...
  // L2900-2902: 只追加 segment_chain + 改 status，不改 session_id 也不改 added_by
  if (!Array.isArray(leaf.segment_chain)) leaf.segment_chain = [];
  leaf.segment_chain.push(new_session_id);
  leaf.status = 'segment_pending';
}
```

macp9/results.md:9 三方案论证结论：**A1（改 added_by 单字段）永久否决**（破坏 V10 L3091 自审禁令判据）；**A2（新增 leaf_transfer_owner ~50 行）最优**；**A3（纯 SKILL 绕过）兜底**。本轮选 A3，A2 留 macp11/12 候选（macp9/results.md:5/28）。**FINAL-REPORT §5 仍把 A2 列为 roadmap，本轮未实施**。

**后果**:
1. segment_add 本身风险有限（只追加 segment_chain，不改所有权；要夺权需配合 set-session，而 set-session 有 caller 校验 L2158）。
2. 但"上下文接力非权限接力"的设计制造了 macp6 实证的运营负担：v2 接力后 leaf.session_id 仍=旧 root、added_by 仍=null，v2 既非 owner 也非 creator，调 set-status/set-session/milestone_set_result 全撞 E_BORROWED_IDENTITY（SKILL §13.3b L924 实证 drift 19:11:04）。
3. 该运营负担**直接逼迫用户走 F1 CLI 后门**——SKILL §13.3b L956-959 的 CLI 应急通道正是为 v2 撞墙场景设计。F3 是 F1 后门被"需要"的根因之一。

**对 7/7 影响**: 标准 #3 字面是"评估"非"修复"，标 ✅ 在语义上成立（评估确实完成）。但对抗立场看，**评估完选择绕过而非根治**，且绕过路径（F1）本身是后门——这部分达成的质量远低于 ✅ 暗示的"已解决"。

**修复建议**: 实施 macp9 已论证的 A2 `leaf_transfer_owner`（cmdLeafTransferOwner，~50 行，caller 必传 + `segment_chain.includes(caller)` 校验 + 复用 cmdLeafSetSession），让 v2 接力后能自主调权限操作，从根因消除 F1 后门的"需求"。

---

### F4 🟡 §3.1 术语混淆：commander done 不享受 auto_upgrade

**位置**: `tree-engine.cjs:2767`（auto_upgrade 仅 root）/ `:1239/4103`（commander 初始 verdict='skip'）/ `:1904`（done 门禁 skip 短路）

**问题**: FINAL-REPORT §3.1 称「commander done 不需 audit_gate 代调（角色 audit_gate 初始=skip，macp5 实证）」。代码实证此声称**功能上成立**（commander 确实不需 audit_gate 代调就能 done），但术语混淆了两种不同机制：

| 机制 | 触发条件 | 代码位置 | 适用角色 |
|------|---------|---------|---------|
| auto_upgrade | 写 done event 且 role==='root' 且 audit_gate.verdict==='skip' | `tree-engine.cjs:2767-2778` | **仅 root** |
| 初始 skip 放行 | leaf 初始 verdict='skip' + done 门禁 `verdict !== 'skip'` 短路 | `:1239`（commander 初始 'skip'）+ `:1904`（短路） | commander（worker/auditor 初始 'required' 不享受） |

SKILL §13.3b L909 自承「commander 没有 auto_upgrade 标志，区别于 root」，但 FINAL-REPORT §3.1 笼统说"角色 audit_gate 初始=skip"未点明 commander 走的是"初始 skip 放行"而非"auto_upgrade 升级"。

**后果**: 读者（尤其是接力 agent）可能误以为 commander 也走 auto_upgrade 路径，混淆诊断。例如 §13.3a.3 诊断（SKILL L880）说"E_SCHEMA_INVALID → 大概率 milestone 检查未过"，但 commander/root 已有 milestone 豁免（L1765 `!isRoot`，见 F5），该诊断也已过时。

**修复建议**: §3.1 重述为「commander done 不需 audit_gate 代调：初始 verdict='skip' + done 门禁 L1904 skip 短路放行（区别于 root 的 auto_upgrade 主动升 pass）」。

---

### F5 🟡 SKILL 行号引用滞后 + §13.3a.2 前提过时

**位置**: `skills/tree-commander/SKILL.md:858/866/880`（行号 + 前提过时）

**问题**: SKILL v2.9.7 多处行号引用与当前 `tree-engine.cjs`（~302256 字节，经多轮迭代）漂移：

| SKILL 引用 | 实测位置 | 状态 |
|-----------|---------|------|
| L858 "auto_upgrade（tree-engine.cjs L1961-1972）" | `tree-engine.cjs:2767-2778`（cmdEventAppend 内） | 行号滞后 |
| L866/880 "引擎 L1767 无 role=root 豁免（当前状态，macp3 实证）" | `tree-engine.cjs:1765` `if (!isAuditor && !isRoot)` 已有 root 豁免（macp4 P0-E，L1762-1764 注释实证） | **前提过时** |

L866 §13.3a.2「备选路径（引擎未修时，milestone_add 绕过 L1767）」整段基于"引擎 L1767 无 root 豁免"这一**已失效前提**——引擎早已修复（macp4 P0-E），但 SKILL 仍保留为"当前状态"并指导 agent 走"给自己 milestone_add 1 条 expect_outputs 可空数组"的绕过路径。

**注**: 此 finding 属 SKILL 文档完整性（D3 维度）问题，D2 仅记录交叉发现。但行号漂移会间接影响 D2 审计——agent 按 SKILL 行号定位代码会找错，进而误判引擎语义。

**修复建议**: SKILL 行号引用改为函数名引用（如"cmdEventAppend 内 auto_upgrade 分支"），并在 §13.3a.2 标注"macp4 P0-E 已修，此备选路径仅作历史记录"。

---

### F6-F8 GREEN 详述（合并）

**F6 🟢 V10 caller 校验三命令在 MCP 生产路径正确实施**
- `cmdLeafSetStatus:1732-1742` 三重校验 `_isOwner(caller===leaf.session_id)` / `_isCreator(leaf.added_by!=null && caller===leaf.added_by)` / `_isRootSelf(role==='root' && caller===leaf.session_id)`
- `cmdMilestoneSetResult:2341-2346` + `cmdAuditGate:3560-3565` 校验 `audit_session_id && callerSessionId && audit_session_id !== callerSessionId → throw E_BORROWED_IDENTITY`
- `proma-dev-patches.cjs` callerSessionId 注入链完整：`__proma_getMcpServers__(sessionId,...)` L2012 → `__proma_createTreeMcpServer__(sdk,z,ws,sessionId)` L1998/2022 → `ctx={sessionId: callerSessionId}` L2003 → `callTreeState(ws,args,callerSessionId)` L1989/1995 → `engine.run(cmd,rest,ws.trees_dir,callerSessionId)` → dispatch → cmd
- 失守案例（worker 528b0925 借 auditor 404c724f session_id 调 audit_gate）在 MCP 路径已被 L3560 堵

**F7 🟢 worker 强制 audit_gate pass 才能 done**
- `tree-engine.cjs:1239/4103` worker/auditor 初始 `audit_gate.verdict='required'`（非 'skip'）
- `:1904` done 门禁 `gate.verdict !== 'skip' && !isPassVerdict(gate.verdict)` → 'required' 触发 `E_GATEKEEPER_REQUIRED`
- worker 无法跳过 audit_gate 直接 done（我审计中曾怀疑 worker 可跳过，代码核验后推翻——初始 required 设计正确）
- `:3614-3632` audit_gate pass 时强制 alignment brief_echo + done event + auditor 独立三重前置

**F8 🟢 resolveAuditorIndep V10-trust-anchor-fix 已删 null 放行支**
- `tree-engine.cjs:3037-3043` 注释实证：删除原 `(auditorSessionId === null || auditorSessionId === leaf.session_id)` 中的 null 放行支
- `:3044` 现条件 `leaf.role === 'root' && auditorSessionId === leaf.session_id`——必须显式传 root.session_id
- 堵 worker 用 `audit_session_id=null` 给 root 一键改 audit_gate（C5/A3 P0 攻击 1）
- **注**: 此修复仅覆盖 cmdAuditGate 路径；cmdEventAppend L2769 的 `!callerSessionId` 放行仍保留（F1），是 V10-trust-anchor-fix 的遗漏点

---

## 四、该维度对 FINAL-REPORT 真实完成度的结论

### 该维度宣称 7/7 真实达成: **6/7**（F1/F2 严重过度宣称，F3 部分达成）

### 该维度发现的过度宣称

1. **§3.6「CLI 兼容通道兜底」**（F1）：把引擎级后门包装为"macp11 应急方案"。代码实证所有 V10 caller 校验以 callerSessionId 真值为前置，省略即整体短路；SKILL §13.3b L956-959 白纸黑字教化"绕过 caller 校验"。这不是"兜底"而是 documented 后门。
2. **§3.1「L3061 优先 L3091 放行」当标准协议**（F2）：未揭示其安全前提（caller 校验须真生效），配合 F1 构成任意进程假冒 root 给全树背书 pass 的通道。
3. **标准 #3「引擎 segment_add 评估」标 ✅**（F3）：实为"评估完选 A3 SKILL 绕过"，A2 根治方案本轮未实施，引擎 gap 仍在。

### 该维度发现的遗漏

1. **tree-state.json 零完整性校验**（F1 后果）：直接编辑 JSON 后 `validate` 返回 0 issues（D6 安全报告已记），与 CLI 后门叠加扩大攻击面。FINAL-REPORT 未提及。
2. **cmdEventAppend L2769 `!callerSessionId` 放行**（F1）：V10-trust-anchor-fix 修了 cmdAuditGate 的 null 放行，但 cmdEventAppend 内的 auto_upgrade 触发条件仍保留 `!callerSessionId` 短路，是修复遗漏点。
3. **§5 roadmap 方向错误**（F1）："CLI 兼容通道标准化（caller 缺省降级文档化）"=固化后门，应改为"CLI 兼容通道下线 + 平台 root idle 修复"。

---

## 五、Roadmap 贡献

### P0（阻断级）
- **R-P0-1**: `run()` 区分 CLI 测试入口与生产入口（`mode` 参数 + 环境变量 opt-in），生产路径强制 callerSessionId，堵 F1 后门（F1）
- **R-P0-2**: `tree-state.json` 写入附加 HMAC 签名 + readState 校验，堵直接编辑 JSON（F1 后果）
- **R-P0-3**: cmdAuditGate L3560 caller 校验改为 `if (audit_session_id !== callerSessionId) throw`（无真值前置），CLI 测试显式传 caller（F2）
- **R-P0-4**: resolveAuditorIndep L3061 增加调用方校验（caller === rootLeaf.session_id），不依赖外层 cmdAuditGate（F2）

### P1（高优）
- **R-P1-1**: 实施 macp9 论证的 A2 `leaf_transfer_owner`（~50 行），从根因消除 F1 后门的"需求"（F3）
- **R-P1-2**: 移除 SKILL §13.3b L956-959 CLI 应急通道教化，或标注"仅限本地开发测试，生产禁用"（F1）
- **R-P1-3**: §5 roadmap 修正：CLI 兼容通道下线 + 平台 root idle 修复（替代"标准化"）（F1）
- **R-P1-4**: 引入"root 代调次数审计"：root 给非自己子树 leaf 背书 pass 时记 high severity drift + 上行确认（F2）

### P2（中优）
- **R-P2-1**: §3.1 术语精化：区分"commander 初始 skip 放行"vs"root auto_upgrade 升级"（F4）
- **R-P2-2**: SKILL 行号引用改函数名引用 + §13.3a.2 标注 macp4 P0-E 已修（F5）
- **R-P2-3**: cmdEventAppend L2769 `!callerSessionId` 放行收口（对齐 V10-trust-anchor-fix 哲学）（F1）

---

## 六、审计独立性声明

本审计仅读取以下源头文档（BRIEF-CONTEXT §三 白名单）：
- `tree-engine.cjs`（Grep 定位 + 关键函数精读：cmdLeafSetStatus/cmdMilestoneSetResult/cmdAuditGate/cmdSegmentAppend/cmdLeafSetSession/cmdEventAppend/resolveAuditorIndep/run/dispatch 全族）
- `proma-dev-patches.cjs`（callerSessionId 注入链 + segment_append handler）
- `pr/20260728-harness-final/FINAL-REPORT.md`（§3.1/§3.5/§3.6 + §5 roadmap）
- `pr/20260727-macp9/results.md`（segment_add 三方案论证）
- `pr/20260727-macp11/ROOT-PROXY-HANDOFF.md`（CLI 兼容通道实战）
- `skills/tree-commander/SKILL.md` v2.9.7（§13.3/§13.3a/§13.3b 身份继承矩阵）

**未读取** `audit-20260728/` 根目录任何 .md（D1/D3/D5 等并行审计产物），独立性保持。
