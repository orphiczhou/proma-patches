# 层2 tree-engine 身份校验根治设计（纯设计，不改代码）

> **交付说明**：本设计原定写入 `workspace-files/.context/plan/layer2-tree-engine-design.md`。
> 当前子 Agent 处于 plan mode（harness 限制只能写 plan 文件），故完整设计先落在此处。
> 退出 plan mode 后，应由主会话将本文件内容复制/移动到上述目标路径，或直接以此为据实施。
> 配套层1文档：`workspace-files/.context/plan/layer1-hardening-design.md`（patches.cjs caller ownership）。

---

## 一、Context（背景与目标）

### 1.1 层1已完成（patches.cjs 加固）
- `send_message` / `fork_session` / `archive_session` 三大写工具加了 caller ownership 校验（R1–R6）。
- `create_session` / `fork_session` 写血缘字段：`parentSessionId` / `forkedFromSessionId` / `delegationDepth` / `triggeredBy` / `ownerGrantedAt`。
- helper：`assertOwnership(sourceSid, targetSid, action)`（patches.cjs L287）、`isAncestorOrDescendant`（L240）、`isSystemPrivileged`（L273）。
- session meta 查询通道：`global.__proma__.getAgentSessionMeta(sid)`（patches.cjs `api()` L169–172）。
- **层1堵的是「跨 session 操作的身份冒用」**（A 借 B 身份 send/fork/archive）。

### 1.2 层2要堵的（tree-engine 身份冒用根因）
层1管不到 tree-engine 内部的身份伪造。tree-engine 有 **3 个独立根因**：

| 根因 | 现状 | 危害 |
|------|------|------|
| **A（核心）session 真实性不校验** | `cmdLeafAdd` / `cmdAuditAppend` / `cmdAuditGate` / `resolveAuditorIndep` 只校验 UUID **格式**，从不校验 session **是否真实存在** | 任何合规格式 UUID（占位前缀 `00000000-...` / 随机生成的合法 v4 / 伪造的 `ffffffff-...`）都能注册成合法树成员或 auditor |
| **B（UUID 校验散落）** | 3 套校验混用 16+ 处：`UUID_RE`（宽松，放行一切 UUID 格式）/ `isValidStrictUuidV4`（拒全0全f，**但放行占位前缀 `00000000-0000-0000-0000-XXXX`**）/ `PLACEHOLDER_UUID_PATTERN`（占位补丁，跳过校验） | 各入口语义不一致；同一个 UUID 在不同入口判罚不同 |
| **C/D（金标准双面数据）** | 金标准（audit-attacks/dbc-spec/audit-extra）用 `00000000-0000-0000-0000-00000000000X` 模拟「真实但假的 session」（因独立测试进程无真实 Proma session）→ validate 路径必须 `PLACEHOLDER` 跳过占位 | validate 路径无法严格拒占位（伪造 auditor 用占位 UUID 能蒙过） |

### 1.3 目标
1. **UUID 校验统一**为 2 个语义函数（入口写入 vs validate 只读）。
2. **入口接入 session 真实性校验**（根因A 根治）。
3. **金标准重构**为「真实标记」模型，让 validate 路径也能严格拒占位。

---

## 二、集成边界调研结论（决定接入方式）

### 2.1 依赖方向：patches.cjs → tree-engine.cjs（单向）
- `proma-dev-patches.cjs` L1465：`const treeEngine = require("./tree-engine.cjs")`。
- **tree-engine 不能反向 require patches.cjs**（循环依赖）。但两者在**同一 Node 进程**运行，**共享 `global.__proma__`**。

### 2.2 tree-engine 已有「注入」先例（决定性证据）
tree-engine 不是纯静态模块，已有两套注入机制：
- **setter 注入**：`setTreesRoot(p)`（L3777）—— 调用方（MCP handler / dbc-spec）在调 `run` 前注入 trees 目录。
- **per-call 参数注入**：`run(cmd, args, treesRoot, callerSessionId)`（L3803）—— `callerSessionId` 已由 patches.cjs 透传（L1509、L1502 注释），用于 `cmdAuditGate` 校验 caller==audit_session_id（V10-self-audit-forbidden-v2）。

> **结论**：在 tree-engine 加 `setSessionVerifier(fn)` setter，完全符合既有 `setTreesRoot` / `callerSessionId` 的注入哲学，**零新概念**。

### 2.3 patches.cjs 现有注入点（代码位置）
`registerTreeMcpServer` IIFE（L1462 起）内，L1465 `require` 之后，已有 `treeEngine.setTreesRoot` 间接调用模式（通过 `callTreeState` per-call 注入 treesRoot）。新增 `setSessionVerifier` 应在 **require 之后立即注入一次**（verifier 是无状态函数，不需要 per-call）。

### 2.4 global.__proma__ 真实性查询能力（已验证可用）
- `api().getAgentSessionMeta(sid)`（patches.cjs L303/304 等多处）—— **同步**调用，返回 meta 对象或 `null`/抛错。
- tree-engine 的 cmd 临界区是同步的（withLock fn 为同步箭头，L3797 注释明确），verifier 必须同步 → **getAgentSessionMeta 满足**。
- patches.cjs 已有 `__proma__` 未就绪的延迟重试（Patch M，L2633–2640）—— tree-engine 直接依赖 global 会有就绪时序问题，**进一步支持用注入回调解耦**。

---

## 三、接入方式（核心决策）

### 3.1 推荐方案 A：注入 verifier 回调（最小侵入）

**tree-engine 侧新增（3 处，纯增量）：**
```js
// ① 模块级状态（紧邻 L199 TREES_ROOT）
let __verifySessionAlive = null;   // (sid) => boolean | null; null=未注入(CLI/测试兼容)

// ② setter（紧邻 setTreesRoot L3777）
function setSessionVerifier(fn) {
  __verifySessionAlive = (typeof fn === 'function') ? fn : null;
}

// ③ 真实性校验 helper（被 assertMcpEntrySessionId 调用）
function checkSessionAlive(sid) {
  if (!__verifySessionAlive) return { ok: true, bypass: 'no-verifier' }; // CLI/未注入→跳过(向后兼容)
  let alive;
  try { alive = __verifySessionAlive(sid); } catch (_) { alive = null; }
  if (alive === null || alive === undefined) return { ok: true, bypass: 'verifier-error' }; // best-effort不阻断(同 patches house style)
  return { ok: !!alive };
}
```
导出 `setSessionVerifier`（加入 L3832 `module.exports`）。

**patches.cjs 侧注入（1 处，require 之后）：**
```js
// registerTreeMcpServer IIFE 内, L1465 require 之后
treeEngine.setSessionVerifier((sid) => {
  if (!sid) return false;
  try {
    const a = global.__proma__;
    if (!a) return null;                  // __proma__ 未就绪 → bypass(同 Patch M 哲学)
    const meta = a.getAgentSessionMeta(sid);
    return !!meta;                        // session 真实存在 = true
  } catch (_) { return null; }            // 异常不阻断
});
```

**assertMcpEntrySessionId 内部调用**（见 §四函数定义）：格式校验通过后 → `checkSessionAlive(sid)` → 不真实则 `throw E_SESSION_NOT_ALIVE`。

### 3.2 为什么不是方案 B（tree-engine 直接调 global.__proma__）

| 维度 | 方案A（注入回调，推荐） | 方案B（直接调 global.__proma__） |
|------|----------------------|------------------------------|
| tree-engine 纯净性 | ✅ 保持「纯引擎，不依赖 Proma 运行时」 | ❌ 破坏（引擎耦合 global） |
| 可测试性 | ✅ 测试注入 mock verifier | ❌ 测试需 mock global.__proma__ |
| __proma__ 就绪时序 | ✅ patches 侧处理（Patch M 已有） | ❌ tree-engine 要复制延迟逻辑 |
| 改动量 | setter + 注入点（~15 行） | tree-engine 内 import global（更少但耦合） |
| 三态清晰度 | ✅ 生产=真verifier / 测试=mock / CLI=跳过 | ❌ 两态（有global/无global） |

> 方案 B 更省代码但牺牲解耦与可测试性。**主会话若优先极致简短可选 B**；本设计默认推荐 A。

### 3.3 最小侵入论证
1. **不改 `run` 签名**（不新增参数）→ patches.cjs / dbc-spec / audit-attacks 所有 `run(...)` 调用点零改动。
2. **复用 `setTreesRoot` 已有 setter 模式**→ agent 熟悉，零学习成本。
3. **verifier 未注入时全部跳过真实性校验**→ 现有不注入的测试（CLI、部分 dbc-spec）零改动即可通过。
4. `assertMcpEntrySessionId` / `assertValidatePathSessionId` 是**纯函数名替换**（16 处逐点换），不改控制流。

---

## 四、UUID 统一映射表（17 处 → 2 函数）

### 4.1 两个新函数的语义定义

```js
// ── 函数1：入口写入校验（MCP 进数据时）──
// 严格拒占位/伪造 + 调 verifier 验真实性。用于所有 cmdXxx 写入入口。
function assertMcpEntrySessionId(sid, field, ctx) {
  if (typeof sid !== 'string' || !sid) throw E_INVALID_UUID_STRICT;
  if (!UUID_RE.test(sid)) throw E_INVALID_UUID_STRICT;            // 必须合法 UUID 格式
  if (FORBIDDEN_UUIDS.has(sid.toLowerCase())) throw E_INVALID_UUID_STRICT; // 拒全0/全f
  if (PLACEHOLDER_UUID_PATTERN_TOP.test(sid)) throw E_INVALID_UUID_STRICT; // ★拒占位前缀 00000000-...-XXXX
  const alive = checkSessionAlive(sid);                           // ★真实性校验(根因A)
  if (!alive.ok && !alive.bypass) throw E_SESSION_NOT_ALIVE;      // session 不真实存在
  return true;
}

// ── 函数2：validate 只读校验 ──
// 仅 UUID 格式校验, 不调 verifier, 允许占位前缀(兼容历史 migrate + 金标准 zombie 数据)。
// 返回 boolean(不 throw, validate 路径收集 issue 而非阻断)。
function assertValidatePathSessionId(sid) {
  if (typeof sid !== 'string' || !sid) return false;
  if (sid === PENDING_ROOT) return true;        // root 过渡标记, validate 放行
  if (!UUID_RE.test(sid)) return false;
  if (FORBIDDEN_UUIDS.has(sid.toLowerCase())) return false; // 全0/全f 仍报 issue
  // 注意: 不拒占位前缀, 不调 verifier —— validate 是只读扫描, 兼容历史数据
  return true;
}
```

**关键语义区分**：
- `assertMcpEntrySessionId`：throw（阻断写入）+ 拒占位前缀 + **调 verifier 验真实性**（堵根因A）。
- `assertValidatePathSessionId`：return bool（收集 issue）+ 允许占位前缀 + 不调 verifier（兼容历史/金标准 zombie）。

### 4.2 映射表（逐处行号 + 当前校验 + 目标函数）

| # | 行号 | 位置 | 当前校验 | 路径类型 | → 目标函数 | 改动说明 |
|---|------|------|---------|---------|-----------|---------|
| 1 | L155 | `UUID_RE` 定义 | 定义 | — | 保留 | 被两函数复用 |
| 2 | L161 | `PLACEHOLDER_UUID_PATTERN_TOP` 定义 | 定义 | — | **保留并复用** | 从「跳过用」改为「入口拒绝用」（assertMcpEntrySessionId 内拒占位前缀） |
| 3 | L169 | `FORBIDDEN_UUIDS` 定义 | 定义 | — | 保留 | 被两函数复用 |
| 4 | L173 | `isValidStrictUuidV4` 定义 | 定义 | — | **删除/替换** | 拆为两个语义函数；保留过渡期可作 assertValidatePathSessionId 别名 |
| 5 | L748 | `cmdLeafAdd` session_id | `UUID_RE`（宽松） | **入口写入** | `assertMcpEntrySessionId` | + 真实性校验 |
| 6 | L757 | `cmdLeafAdd` added_by | `UUID_RE` | **入口写入** | `assertMcpEntrySessionId` | + 真实性校验 |
| 7 | L812 | `cmdLeafAdd` added_by PLACEHOLDER 跳过 | `PLACEHOLDER` 跳过 | **入口写入** | **删除跳过分支** | 统一走 assertMcpEntrySessionId（占位前缀直接拒，靠 verifier 放行测试 UUID） |
| 8 | L1356 | `cmdLeafSetSession` new_session_id | `UUID_RE` | **入口写入** | `assertMcpEntrySessionId` | + 真实性校验 |
| 9 | L1518 | cmdXxx audit_session_id（入口） | `isValidStrictUuidV4` | **入口写入** | `assertMcpEntrySessionId` | + 真实性；主会话实现时核对确切函数名 |
| 10 | L2051 | `resolveAuditorIndep` auditorSessionId | `isValidStrictUuidV4` | **入口写入**（cmdAuditGate 路径） | `assertMcpEntrySessionId` | 注意：此处当前 return 字符串非 throw，需适配为 issue 风格 or throw |
| 11 | L2206 | `collectValidateIssues` root session_id | `UUID_RE` | **validate 只读** | `assertValidatePathSessionId` | 允许占位前缀（兼容） |
| 12 | L2231 | `collectValidateIssues` addedBy | `UUID_RE` | **validate 只读** | `assertValidatePathSessionId` | 允许占位前缀 |
| 13 | L2354 | `collectValidateIssues` 局部 PLACEHOLDER 定义 | 定义 | validate 只读 | **删除** | 金标准重构后不再需要占位跳过（见 §五） |
| 14 | L2368 | `collectValidateIssues` auditor PLACEHOLDER 跳过 | `PLACEHOLDER` 跳过 | validate 只读 | **删除跳过 / 改严格** | 见 §五金标准重构（决策点） |
| 15 | L2505 | `cmdAuditGate` --audit-session-id | `isValidStrictUuidV4` | **入口写入** | `assertMcpEntrySessionId` | + 真实性 |
| 16 | L2629 | `cmdAuditAppend` entry.auditor_session_id | `isValidStrictUuidV4` | **入口写入** | `assertMcpEntrySessionId` | + 真实性 |
| 17 | L3041 | `cmdValidate` 回填 rootLeaf.session_id | `UUID_RE` | **validate 只读**（回填判定） | `assertValidatePathSessionId` | 允许占位前缀（回填兼容历史） |

**语义归纳**：
- **入口写入（assertMcpEntrySessionId）**：#5,6,7,8,9,10,15,16 —— 8 处，全部加真实性校验，拒占位前缀。
- **validate 只读（assertValidatePathSessionId）**：#11,12,17 —— 3 处，允许占位前缀，纯格式。
- **重构删除**：#4（拆分）、#7（跳过分支）、#13、#14（占位跳过）。

> 注：任务书称「16 处」，实际定位 13 处使用点 + 4 处定义 = 17 个标注点。映射表全列，主会话实现时以本表行号为准。

---

## 五、金标准重构方案（根因C/D 根治）

### 5.1 当前金标准占位 UUID 的两种混用（冲突根源）
`audit-attacks.cjs` 里有**两种语义完全不同**的「假 UUID」混在一起，是双面数据冲突的根源：

| 类型 | 值 | 用途 | 语义 | 当前处理 |
|------|----|----|------|---------|
| **脚手架占位 UUID** | `00000000-0000-0000-0000-00000000000{1,2,3,4}`（L33–36） | `setupTree`/`addWorker`/`ensureAuditorLeaf` 当**真实 session** 用（L52/57/62） | 测试环境下的「真实 session」 | UUID_RE 放行 + validate PLACEHOLDER 跳过 |
| **攻击向量 UUID** | `FAKE = ffffffff-ffff-ffff-ffff-ffffffffffff`（L31） | 模拟 commander 凭空捏造 auditor（L143 A2-fabricated） | 「树中不存在的伪造 auditor」 | FORBIDDEN_UUIDS 拒绝（isValidStrictUuidV4） |

**冲突**：占位前缀 `00000000-...-XXXX` 在 `isValidStrictUuidV4` 里**被放行**（它不是全0，是 ...0002），所以「伪造 auditor 用占位 UUID」能蒙过 audit_append/gate 的格式校验 → 只能靠 validate 的 PLACEHOLDER 跳过「反向兼容」，但跳过 = 无法严格拒占位 = 双面冲突。

### 5.2 重构核心：把「占位跳过」从 tree-engine 移到「测试注入的 verifier」

**理念**：tree-engine 统一严格校验（不再跳过占位）；测试通过注入 mock verifier 告诉引擎「这些 UUID 是真实的」。

#### 新写法（金标准测试侧，audit-attacks.cjs / dbc-spec.cjs / audit-extra.cjs）

```js
const engine = require(_findEngine());
engine.setTreesRoot(SANDBOX);

// ★ 新增：注入 mock session verifier（替代占位 UUID 的「真实性」语义）
const TEST_REAL_SESSIONS = new Set([
  UUID.root, UUID.worker, UUID.auditor, UUID.other,  // 脚手架占位 UUID → 测试视为「真实」
  // 其他测试需要的 session_id...
]);
engine.setSessionVerifier((sid) => TEST_REAL_SESSIONS.has(sid));
// → FAKE(全f) / 随机 UUID / 未注册 UUID → verifier 返回 false → assertMcpEntrySessionId 拒绝（符合攻击向量预期）
// → 脚手架占位 UUID → verifier 返回 true → 放行（符合正常测试流预期）

async function run(cmdArgs) { /* 不变 */ }
```

#### 旧写法（当前，要替换掉的）
```js
// audit-attacks.cjs 当前：靠占位 UUID 格式 + tree-engine 内 PLACEHOLDER 跳过
const FAKE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';        // 靠 FORBIDDEN_UUIDS 拒
const UUID = { root: '00000000-...-001', ... };              // 靠 UUID_RE 放行 + validate PLACEHOLDER 跳过
// tree-engine collectValidateIssues L2368: if (PLACEHOLDER.test(auditor)) continue;  ← 双面冲突点
```

### 5.3 重构后 collectValidateIssues（L2354–2370）的变化

**重构前**（双面冲突）：
```js
const PLACEHOLDER_UUID_PATTERN = /^00000000-0000-0000-0000-[0-9]{12}$/;  // L2354
...
if (PLACEHOLDER_UUID_PATTERN.test(auditorSession)) continue;  // L2368 跳过占位 → 无法严格拒伪造占位 auditor
```

**重构后**（统一严格）：
```js
// 删除 PLACEHOLDER 跳过。auditor_session_id 真实性由「写入时 assertMcpEntrySessionId + verifier」保证。
// validate 只做：assertValidatePathSessionId(auditorSession) 格式校验 + 树内 leaf 存在性交叉校验（已有 L2372）。
// 占位前缀数据若残留 → assertValidatePathSessionId 允许（兼容历史），但树内不存在 → 仍报 audit_log_integrity issue。
```

> **效果**：伪造 auditor（用占位前缀 UUID）在**写入时**就被 assertMcpEntrySessionId 拒（占位前缀拒绝 + verifier 说不存在）；即便绕过写入直接篡改 JSON，validate 也能报 issue（树内无对应 leaf）。双面冲突消除。

### 5.4 金标准改造范围（需主会话确认）
3 个金标准文件需同步改造（注入 mock verifier）：
- `skills/tree-commander/assets/audit-attacks.cjs`
- `skills/tree-commander/assets/dbc-spec.cjs`
- `release/tree-system-v0.2.2/test-sandbox/{audit-attacks,audit-extra,dbc-spec}.cjs`（release 副本同步）

**改造量**：每个文件 +3 行（`setSessionVerifier` + `TEST_REAL_SESSIONS` Set）。UUID 常量值**可不改**（占位前缀 UUID 由 verifier 放行，不再依赖格式跳过）。

---

## 六、风险点 + 需主会话决策点

### 6.1 决策点 D1：assertMcpEntrySessionId 校验顺序（verifier 优先 vs 格式优先）
**背景**：assertMcpEntrySessionId 既拒占位前缀，又调 verifier。金标准 `setupTree` 用占位前缀 UUID（`00000000-...-001`）当 root session_id，若格式校验在前 → 占位前缀被拒 → 金标准 setup 直接挂。

| 选项 | 校验顺序 | 金标准 UUID 值是否要改 | 侵入性 |
|------|---------|---------------------|--------|
| **D1-a（推荐）verifier 优先** | 先 verifier（verifier 说是真实的就放行，跳过占位前缀检查）→ 再格式 | ❌ 不改（占位前缀靠 verifier 放行） | 最小（金标准只加 setSessionVerifier） |
| **D1-b 格式优先** | 先格式（拒占位前缀）→ 再 verifier | ✅ 金标准全换成真实 v4 格式 UUID | 较大（金标准 UUID 常量全改） |

> **推荐 D1-a**：assertMcpEntrySessionId 内「若 verifier 返回 true → 跳过占位前缀拒绝」。金标准 UUID 值零改动。

### 6.2 决策点 D2：CLI 模式（`node tree-engine.cjs`）真实性防护缺失
CLI 模式无 `global.__proma__`、verifier 未注入 → assertMcpEntrySessionId 跳过真实性校验（仅格式）。
- **影响**：CLI 调用方失去真实性防护。
- **判断**：CLI 是本地可信操作（开发者手动跑），可接受。**默认接受**，无需决策；若主会话要求 CLI 也防护，需另设计（如 CLI 读 sessions.json）。

### 6.3 决策点 D3：resolveAuditorIndep（L2051）的 throw 适配
L2051 当前 `return '错误字符串'`（非 throw，是 resolveAuditorIndep 的 issue 风格）。assertMcpEntrySessionId 是 throw 风格。
- **选项**：要么 resolveAuditorIndep 内联格式+真实性校验（保持 return 风格），要么单独写一个 return 版本。
- **推荐**：resolveAuditorIndep 内联校验，保持 return 字符串风格（不破坏其调用方 cmdAuditGate 的错误处理）。

### 6.4 风险 R1：性能（每次写入多一次 getAgentSessionMeta）
cmdLeafAdd/cmdAuditAppend 每次写入多一次同步 `getAgentSessionMeta`。
- **评估**：patches.cjs 的 assertOwnership 已经每次 send/fork/archive 调 2 次 getAgentSessionMeta（src+tgt），生产验证可接受。
- **缓解**：verifier best-effort（异常/null 不阻断），无额外重试。

### 6.5 风险 R2：E_SESSION_NOT_ALIVE 新错误码
需新增：错误码常量 + `ERROR_TO_HELP` 映射（L219）+ `module.exports.ERRORS`（L3839）。
- help_topic 建议：`session_authenticity`（新增 help topic）或复用 `v10_constraints`。

### 6.6 风险 R3：向后兼容（老调用方不注入 verifier）
不注入 verifier 的调用方（CLI、未改造的 dbc-spec 副本）→ checkSessionAlive 返回 bypass → 跳过真实性校验 → 行为退化为「纯格式严格校验」（比现状更严：多了拒占位前缀）。
- **影响**：可能让某些用占位前缀 UUID 的老测试在「入口路径」失败（但 validate 路径仍兼容）。
- **缓解**：金标准同步注入 verifier（§5.4）；若有第三方老测试用占位前缀走入口 → 需他们也注入 verifier or 改 UUID。

### 6.7 需主会话决策汇总
1. **D1**：assertMcpEntrySessionId 校验顺序 → 推荐 D1-a（verifier 优先，金标准 UUID 不改）。
2. **A vs B**：接入方式 → 推荐方案 A（注入回调）。
3. **金标准改造**：是否接受改造 3 个金标准文件（+3 行/文件）注入 mock verifier。
4. **R2**：E_SESSION_NOT_ALIVE 的 help_topic 命名。

---

## 七、验证方式（实施后）

1. **金标准全绿**：`node skills/tree-commander/assets/dbc-spec.cjs`、`audit-attacks.cjs`、`audit-extra.cjs` 三套 18/0 + 攻击 harness 全过（注入 mock verifier 后）。
2. **攻击向量验证**：audit-attacks.cjs 的 A2-fabricated（FAKE UUID）、H2-fabricated-auditor 应被拦（✓ 而非 ⚠️ BYPASS）。
3. **生产真实性**：在真实 Proma 会话里用伪造/不存在的 UUID 调 `mcp__tree__tree_leaf_add` → 应返回 `E_SESSION_NOT_ALIVE`；用真实 session_id → 放行。
4. **回归**：层1 的 caller ownership（R1–R6）不受影响（patches.cjs assertOwnership 独立，不碰 tree-engine UUID 校验）。
5. **CLI 兼容**：`node tree-engine.cjs` CLI 模式下用占位前缀 UUID → verifier 未注入 → 格式校验拒占位前缀（行为变更，需确认 CLI 是否有此类用法；若有，CLI 也注入或放宽）。

---

## 八、实施顺序建议（供主会话排期）

1. tree-engine 加 `setSessionVerifier` / `checkSessionAlive` / `assertMcpEntrySessionId` / `assertValidatePathSessionId` + `E_SESSION_NOT_ALIVE`。
2. 16 处映射表逐点替换（入口→assertMcpEntrySessionId；validate→assertValidatePathSessionId；删除 #7/#13/#14 占位跳过）。
3. patches.cjs `registerTreeMcpServer` 注入真 verifier（§3.1）。
4. 3 个金标准文件注入 mock verifier（§5.4）。
5. 跑金标准 + 攻击 harness + 生产手测（§七）。

---

## 九、调研信息缺口（未编造，列出待查）

1. **L1518 确切函数名**：映射表 #9 标注「cmdXxx audit_session_id」，未读其所属函数体（L1518 在 cmdAuditAppend L2629 之外，可能是 cmdEventAppend 或 segment 相邻入口）。主会话实现时核对 —— 不影响设计结论（入口写入→assertMcpEntrySessionId）。
2. **getAgentSessionMeta 返回字段全集**：本设计只用「存在性」（!!meta），未依赖具体字段。若主会话要校验 session 状态（active/archived），需另查 AgentSessionMeta schema。
3. **release 副本同步策略**：`release/tree-system-v0.2.2/test-sandbox/` 与 `skills/tree-commander/assets/` 的金标准是否需保持一致 / 谁是源 —— 未确认，主会话定。

