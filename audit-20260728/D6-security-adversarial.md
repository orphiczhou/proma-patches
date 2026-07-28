# D6 — Tree Harness 安全对抗审计（红队视角）

- **审计员**: audit-D6-commander (GLM-5.2)
- **日期**: 2026-07-28
- **审计对象**: tree-engine.cjs (md5 3e10bf8e, 5425 行) + proma-dev-patches.cjs + SKILL §13.3b/§13.6.1 + FINAL-REPORT §3.6
- **审计立场**: 红队 / 对抗性。假设存在恶意或被攻陷的 Proma session，寻找"无需修改引擎即可利用"的绕过路径
- **结论摘要**: 引擎的 V10 caller-binding 防线在 **MCP 调用路径**上是有效的，但在 **CLI 兼容通道 + 直接文件编辑**两条路径上完全失效，且 CLI 通道已被 FINAL-REPORT §3.6 + SKILL §13.3b **双重正式文档化为合理路径**——这把一个 P0 级绕过口升格成了 supported feature。tree-state.json 零完整性校验，使全部 caller-binding 对抗直接文件编辑时归零。

---

## 0. 攻击者能力假设（威胁模型）

Proma 所有 session（root / commander / worker / auditor）在同一台机器、同一用户权限下运行，共享：
1. 文件系统读写（Bash 工具可直接读写 `D:/Codes/tree-harness/tree-engine.cjs` 和 `<workspace>/.context/trees/<tree_id>/tree-state.json`）
2. Node.js 执行（Bash 可 `node -e` 或 `node script.cjs` 直接 `require()` 引擎）
3. MCP 工具 `tree_dump` / `tree_leaf_get` 可读出任意 leaf 的 `session_id`、`added_by`、`audit_gate` 等全部字段（含 root.session_id）
4. MCP 工具 `tree_help` 公开披露所有校验规则（含 CLI 兼容通道的存在）

**关键**: 攻击者不需要任何提权。一个普通 worker session 天然具备上述全部能力。

---

## 1. 攻击面清单（按 severity 排序）

| ID | 攻击向量 | Severity | 利用条件 | 影响 |
|----|---------|----------|---------|------|
| F1 | CLI 兼容通道绕过 V10 caller 校验 | 🔴 red | 本机 Bash + 知道 root.session_id（tree_dump 即得） | worker 自伪造完整 done 闭环，零 auditor 介入 |
| F2 | tree-state.json 零完整性校验 | 🔴 red | 本机文件写权限 | 一键改 leaf.status=done + audit_gate=pass，引擎下次 validate 报 0 issues |
| F3 | 假信号：done/self_check/review_round/subagent_spawn 内容可伪造 | 🔴 red | 能写 event（任意 session） | review_required=true 门禁在能写 event 的攻击者面前形同虚设 |
| F4 | root 信任锚可背书任意非 root leaf | 🟡 yellow | root 被攻陷或恶意 / 或配合 F1 冒 root 署名 | 一键给全树 worker 背书 pass |
| F5 | audit_append 路径校验弱于 audit_gate | 🟡 yellow | 能调 audit_append（CLI 或 MCP） | 注入伪造审计证据，污染审计链可信度 |
| F6 | patches.cjs 跨 session 写工具权限过宽 | 🟡 yellow | 任意 session（自承认，已部分缓解） | send_message 向真实 root 注入伪指令 |
| F7 | "v2 接力 + 旧 root 失联"是社会掩护，非必需 | 🟡 yellow | 同 F1 | 攻击比 brief 设想更简单；drift 留痕是纯自觉 |
| F8 | 多层级树 L2 commander 越权 | 🟢 green | 同 F1（无独立新增面） | F1 子集，MCP 路径已有 caller-binding |
| F9 | 引擎对异常 state 的容错 | 🟢 green | — | 多数异常抛 E_SCHEMA_INVALID 不崩；但 F2 下内部自洽的篡改无法察觉 |
| F10 | proma-dev-patches.cjs MCP 注册注入 | 🟢 green | — | handler 静态注册，callerSessionId 注入链可信；但被 F1 整体绕过 |

---

## 2. V10 三闸门逐闸门绕过分析

V10 self-audit 禁令由三处闸门组成。逐个分析绕过路径：

### 闸门 A — `callerSessionId === audit_session_id`（cmdAuditGate L3560 / cmdMilestoneSetResult L2341 / cmdAuditAppend L3701）

**设计**: MCP wrapper 把调用方 session_id 透传为 callerSessionId，引擎比对 callerSessionId 是否等于 audit_session_id，防止 worker 借 root 的 session_id 冒名背书。

**绕过路径**:
- **CLI 兼容通道（F1，P0）**: 校验条件写为 `if (audit_session_id && callerSessionId && audit_session_id !== callerSessionId)`。当 CLI 调用 `run(cmd, args)` 省略第 4 参 callerSessionId 时，`callerSessionId === undefined`，整个 `if` 短路跳过。攻击者只要 `require('tree-engine.cjs'); engine.run('audit-gate', [...])` 即可绕过此闸门。
- **直接编辑 tree-state.json（F2，P0）**: 闸门只在校验"调用动作"时生效，对文件中已存在的 `audit_gate.verdict='pass'` 字段不做事后校验。

### 闸门 B — `resolveAuditorIndep` 独立性（L3031-3120）

**设计**: 校验 auditor 不是 leaf 自身、不是 leaf.added_by、是树中真实存在且 done+events+audit_gate=pass 的 leaf。L3091 `if (leaf.added_by && auditorSessionId === leaf.added_by)` 拦 worker 自审。

**绕过路径**:
- **root 信任锚（F4，黄）**: L3044 `leaf.role==='root' && auditorSessionId === leaf.session_id` 直接放行 root 自审；L3061-3074 进一步放行 **root 担任任意非 root leaf 的 auditor**（只校验 root status≠archived/pruned + events≥1，门槛极低）。攻击者只需把 audit_session_id 填为 root.session_id（经 tree_dump 即得），闸门 B 即返回 null 放行。
- **闸门 B 与闸门 A 是 AND 关系，但 F1 已经绕掉闸门 A**：剩下闸门 B 单独无法阻止"冒 root 署名"——因为 root.session_id 是公开值，且 root 作为 trust anchor 天然放行。
- **L3091 的 added_by 检查只对 worker 有效**: worker.added_by=commander，所以 worker 自审被拦；但攻击者填 audit_session_id=root.session_id 时，root ≠ worker.added_by（commander），不触发 L3091。

### 闸门 C — done 门禁内容校验（cmdLeafSetStatus L1754-1845）

**设计**: 切 done 时校验 milestones 非空 + 全部 audit_pass=true + expect_outputs 非空 + deliverables 文件存在 + 路径安全 + brief_echo+done 双事件 + (worker) review_round 收敛。

**绕过路径**: 此闸门**内容校验是真实的，无法靠 caller 绕过**。但攻击者可以"满足"它：
1. milestone_set_result 经 F1 绕闸门 A + F4 绕闸门 B → milestone.audit_pass=true ✓
2. audit_gate 经同样路径 → audit_gate.verdict=pass ✓
3. 写 deliverables 文件到 `<deliverables_root>/<outPath>`（攻击者有文件写权限）→ 文件存在性 ✓
4. event_append done + self_check（格式合法，见 F3）→ 双事件 ✓
5. (worker) 写格式合法的 subagent_spawn + review_round（见 F3）→ review 收敛 ✓
6. set-status done → **全部门禁通过，tree_validate = 0 issues**

**结论**: V10 三闸门在 MCP 路径形成有效纵深，但 CLI 通道（F1）+ root 信任锚（F4）+ 假信号（F3）+ 文件编辑（F2）四者组合下，三闸门全部可绕，且最终 state 通过 tree_validate。

---

## 3. CLI 兼容通道滥用风险（≥3 个场景）

引擎 `run(cmd, args, treesRoot, callerSessionId)` 的第 4 参 callerSessionId 为可选；省略时所有 `if (callerSessionId)` 守卫短路。SKILL §13.3b L956-964 + FINAL-REPORT §3.6 L76-80 已将其正式化为"应急通道"。

### 场景 1 — worker 自伪造 done 闭环（P0，无需 v2 剧场）

```bash
# 攻击者：任意 worker session
node -e "
const e = require('D:/Codes/tree-harness/tree-engine.cjs');
e.setTreesRoot('C:/Users/.../.context/trees');
const me = '<my_worker_session_id>';
const root = '<root_session_id>';   // tree_dump 即得
// 1. 绕闸门 A+B：milestone audit_pass=true，冒 root 署名
e.run('milestone set-result', ['audit', '<my_leaf>', 'M1', '--audit-pass=true', '--audit-session-id='+root]);
// 2. 同理 audit_gate pass
e.run('audit gate', ['audit', '<my_leaf>', '--verdict=pass', '--audit-session-id='+root]);
// 3. 写 deliverables 文件（略）
// 4. done event（CLI 绕 caller===session 校验）+ self_check 格式合法
e.run('event append', ['audit', '<my_leaf>', '--type=done', '--meta={"self_check":[{"item":"x","pass":true,"evidence":"..."}]}']);
// 5. set-status done
e.run('leaf set-status', ['audit', '<my_leaf>', 'done']);
"
```

结果：worker 在**零 auditor 介入**下完成 done 闭环。brief 担心的"v2 接力 + 旧 root 失联"剧场在此完全多余——直接走 CLI 即可。

### 场景 2 — 跨身份篡改他人 leaf（杀竞争对手 / 恶意 prune）

```bash
# 把别的 worker 的 active leaf → pruned（CLI 绕 cmdLeafSetStatus caller-binding）
e.run('leaf set-status', ['audit', '<victim_leaf>', 'pruned']);
# 或偷换 ownership（CLI 绕 cmdLeafSetSession L2158 creator 校验）
e.run('leaf set-session', ['audit', '<victim_leaf>', '--session-id=<attacker_session>']);
```

L2158 守卫 `if (callerSessionId)` 在 CLI 下短路，攻击者可把任意 leaf 的 session_id 改成自己，**夺取 done-event 所有权**。

### 场景 3 — 注入伪造 audit_log 证据（污染审计链）

```bash
# audit_append 路径校验最弱（L3772 跳过 V10-auditor-active），CLI 绕 caller 校验
e.run('audit append', ['audit', '<target_leaf>', '--json', JSON.stringify({
  auditor_session_id: '<root_or_any_commander_sid>',
  total: 5, passed: 5, failed: 0,
  results: [{item:'i1',pass:true,evidence:'ok',severity:'green'}, /* x5 */]
})]);
```

audit_log 是审计证据落盘，被注入后 auditor 复审会读到伪造的 green 结果，影响下游判断。

### 场景 4 — 用 SKILL §13.3b "应急协议"作社会掩护（F7）

攻击者刻意制造"v2 接力 + 旧 root 失联"剧场，然后走 CLI 应急 + `tree_drift_append(severity=high, reason='CLI 应急绕过 caller 校验')`。这样在 drift_log 中看起来是"按 SKILL §13.3b 走的合规应急"，实际是利用文档化通道完成的 done 伪造。**SKILL L963 "用后必须留痕"是纯自觉要求**，恶意 worker 不会自留痕；即便留痕，drift_append 也只是"声明"，不阻断已完成的事实。

---

## 4. audit_log 篡改路径（≥2 个）

### 路径 1 — audit_append 入口注入（F5）

如上场景 3。audit_append（L3669）只做轻量校验：auditor 存在 + 非自身 + 非 worker（L3780-3798）。它**故意跳过** V10-auditor-active 的 status=done/events/audit_gate.verdict 三重校验（L3772-3779 注释自承"audit_append 是审计证据落盘，不要求 auditor 自身已完成审计工作"）。后果：一个刚注入、events=[] 的 active commander 即可被用作 auditor 写 audit_log。配合 F1 CLI 绕 caller 校验，可用任意非 worker session_id 署名。

### 路径 2 — 直接编辑 tree-state.json（F2）

`audit_log` 数组存在 leaf 的 JSON 字段里（`leaf.audit_log`）。Bash 直接编辑 tree-state.json 追加任意 audit_log 条目，引擎无完整性校验，下次 readState 信任为 ground truth。tree_validate 的 `audit_log_integrity` 检查只看"role===worker 不能当 auditor"等**结构性**规则，不校验条目是否对应真实的 audit_append 调用（无 call_log 对账，无 hash chain）。

### 路径 3 — audit_gate verdict 字段篡改（F2 子集）

`leaf.audit_gate.verdict` 是普通 JSON 字段。直接编辑 tree-state.json 把 `'fail'` 改成 `'pass'`，引擎无事后校验。done 门禁（L检查 audit_gate.verdict）会读到篡改后的 'pass' 放行。

---

## 5. 假信号攻击场景（≥3 个）

### 场景 A — 伪造 done event + self_check（F3）

done event 的 self_check schema（L2555-2606）只校验**格式**：必填、非空数组、每项有 item(string)/pass(bool)/evidence(string)、至少 1 项 pass=true。攻击者写 `self_check=[{item:"任务完成",pass:true,evidence:"已交付全部产物"}]` 即过 schema。引擎不校验 evidence 真实性，不核对 self_check.item 是否对应实际工作。

### 场景 B — 伪造 review_round + subagent_spawn 链（F3，v0.17.1 教训的当前形态）

v0.18 已堵 worker 用 session 分支（E_REVIEW_SESSION_FORBIDDEN L1627），强制 worker 走 `reviewer_kind=subagent` + `reviewer_ref` 溯源 `subagent_spawn` event。**但代码注释明文承认**（L1508-1509 / L1542-1543 / L1872）：

> "events 是 worker 可写的，review_round 结构校验【仅防格式伪造】，【不防内容伪造】"
> "和 review_round / self_check 同安全级别 —— events 是 worker 可写，本函数【仅防格式伪造】"

攻击链：worker 先 event_append 一条格式合法的 `subagent_spawn`（meta.subagent_id=<伪 UUID>），再 event_append `review_round`（reviewer_kind=subagent，reviewer_ref 指向刚写的 subagent_spawn.subagent_id，reviewers 全 green 废话）。schema 全过，"子 Agent"从未真实运行。**这正是 v0.17.1 教训的当前残留面**——引擎层只把"session 分支逃逸口"堵了，"subagent 分支内容伪造"靠 commander 抽样（SKILL §4 Step4）+ 人工核验，不是引擎硬拦。

### 场景 C — 伪造 brief_echo（冷启动 root 信任锚滥用 F4）

brief_echo 是 auditor 简化协议的必要事件。一个被攻陷的 root（或经 F1 冒 root 署名的攻击者）可给任意 leaf 注入 brief_echo + done，再以 root 信任锚身份（L3061-3074）给该 leaf audit_gate=pass，完成"凭空审计"。冷启动期 root 是全局信任锚，天然放行，这是设计本身的单点信任风险。

---

## 6. 多层级树（≥3 层）信任边界

### L2 commander 越权面（F8，绿）

MCP 路径下 L2 commander 对兄弟子树的操作受 caller-binding 约束：
- set-status / set-session / milestone_* / event_append(done) 都校验 caller 是 owner/creator/root-self
- L2 commander 无法直接操作兄弟 commander 的子树（caller ≠ 受害 leaf.added_by）

**但**：这条边界**只在 MCP 路径有效**。F1 CLI 通道下，L2 commander 同样可 `require()` 引擎绕过全部 caller-binding。即 F8 是 F1 的子集，无独立新增面，但意味着"多层级树的信任边界在 CLI 通道下同样失效"。

### 冷启动 root 信任锚滥用（F4，黄）

root 作为 trust chain 起点（L3044）有自审特权，且扩展为可审任意非 root leaf（L3061-3074，"鸡生蛋死锁修复"）。设计权衡注释（L3053-3057）承认这是"自然延伸"。**风险**: 如果 root 本身是恶意 commander（或被攻陷），它可以一键给全树所有 worker 背书 pass——而冷启动期所有 worker 都默认用 root 当 auditor（SKILL §13.2/§13.0），这是设计常态，不是异常。最小校验（root status≠archived + events≥1）门槛极低，一个写了 1 条 plan event 的恶意 root 即满足。

---

## 7. proma-dev-patches.cjs MCP 工具注册安全性（F10，绿）

### 注入风险评估

- handler 注册是**静态**的（buildTreeTable + renderClaude，L2008），无动态 `eval()` / `new Function()` / `require(opts.x)`
- callerSessionId 经 `__proma_getMcpServers__(sessionId, ...)` 按 sessionId 闭包注入（L1999-2000），agent 无法篡改自己的 caller 身份——**这条注入链本身可信**（V9+ Phase 4 修复）
- fork 时同步注入身份提示 user message（L1353-1459），降 MCP 工具注入竞态

### 已知残留面（patches.cjs L592-594 自承认）

> "sourceSessionId 是服务端注入的可信身份... 但三个写工具（send_message / fork / archive）从未用它做权限判定 → Agent A 可给任意 session B 注入消息 / fork 窃取上下文 / 归档破坏协作链"

已部分缓解（L734/L803 注释）：send 放行（危害低 + 审计留痕），fork/archive 加保护。**残余风险**: send_message 仍可给任意 session（含真实 root）注入 user message——与 F1 组合，攻击者可向真实 root 注入"请给 worker X 代调 audit_gate pass"的**伪指令**，让 root 在不知情下成为攻击工具。

### 与 F1 的关系

F1 的 `require(engine)` 直接绕过整个 MCP 层——patches.cjs 的 callerSessionId 注入链根本不经过。即 patches 层再可信，对 F1 也无防御价值。

---

## 8. 引擎对异常 tree-state.json 的容错（F9，绿）

- 多数结构异常抛 E_SCHEMA_INVALID / E_LEAF_NOT_FOUND，不崩溃
- SCHEMA_VERSION 版本管理（D2）+ migrate 回灌
- withLock 串行化写入，防并发损坏

**但 F2 下**: 若攻击者编辑后保持内部自洽（parent 链完整 / session 唯一 / done 门禁字段齐全），引擎无法察觉篡改——readState 信任文件，tree_validate 只查一致性不查完整性。**call_log**（appendCallLog L5660）记录了所有"经引擎"的调用，但 (a) 它是独立文件可被同步篡改，(b) F2 直接编辑根本不经过引擎、不入 call_log，无对账机制。

---

## 9. 缓解建议（按优先级）

### P0 — 必须修复

1. **CLI 通道加 caller 兜底（F1）**: 把 `if (callerSessionId)` 守卫改为"CLI 模式下用 audit_session_id 之外的可信源兜底"，或要求 CLI 调用必须显式声明 `--caller=<session>` 并写入 call_log。彻底解法：**取消 CLI 兼容通道对写操作的放行**——金标准测试改用 mock callerSessionId，而非省略。
2. **tree-state.json 完整性链（F2）**: 引入 hash chain（每条写入含 prev_hash + 内容 hash），或对关键字段（status / audit_gate.verdict / milestone.audit_pass / audit_log）做 HMAC 签名。readState 校验链完整性，断裂即拒并报警。这是唯一能对抗直接文件编辑的手段。
3. **收敛 SKILL §13.3b CLI 应急通道的文档化（F7）**: 把 CLI 应急从"合理路径"降级为"仅在 root 长时间 verifiable 失联（≥3 道防线全撞）才用的最后手段"，并要求 drift_append 后**强制人工复核**才算闭环，而非自声明。

### P1 — 应尽快修复

4. **review_round / subagent_spawn 内容核验（F3）**: subagent_spawn event 应携带不可伪造的执行证据（如 subagent session 的真实 ctx token / SDK 侧签发的回执），而非 worker 可自写的 UUID。这是 v0.17.1 教训的未竟部分。
5. **audit_append 提级到 V10-auditor-active（F5）**: 让 audit_append 也走完整 resolveAuditorIndep（或至少要求 auditor status=done），堵"刚注入的 active commander 写 audit_log"。
6. **root 信任锚审计（F4）**: root 作为 auditor 的所有 audit_gate/milestone 背书，强制进独立审计流（如要求第二 auditor 复核 root 的批量背书行为），降低单点信任风险。
7. **patches.cjs send_message 权限收窄（F6）**: 至少对 root / auditor session 的入站 user message 做 source 校验或人工确认闸，防伪指令注入。

### P2 — 防御纵深

8. **call_log 与 state 对账（F2/F9）**: 定期跑 reconcile 工具，核对 leaf 字段变化是否都有对应 call_log 条目；无对账条目的字段变更即篡改嫌疑。
9. **多 auditor 冷启动（F4）**: 冷启动期就建 ≥2 个异厂商 auditor，避免全树单点依赖 root 信任锚。

---

## 10. 自查 check-list

- [x] V10 三闸门逐闸门绕过分析（§2 闸门 A/B/C）
- [x] CLI 兼容通道滥用场景 ≥3 个（§3 场景 1/2/3/4，共 4 个）
- [x] audit_log 篡改路径 ≥2 个（§4 路径 1/2/3，共 3 个）
- [x] 假信号攻击场景 ≥3 个（§5 场景 A/B/C，共 3 个）
- [x] 每条 finding 有 severity + 攻击路径 + 缓解建议（§1 表 + §9 分级）
- [x] brief 三问回答（CLI 是特性还是漏洞 / 是否文档化 / 恶意 worker 能否伪造 done）—— 见 §0 + §3 场景 1 + §9 P0-3
- [x] 每个攻击向量有具体路径描述 + 利用条件 + 影响评估（§1 表 + 各小节）
- [x] severity 用 red/yellow/green 标注（§1 表）
- [x] 含"攻击面清单""绕过路径""CLI滥用风险""缓解建议"四要素

## 11. 对抗性结论

**FINAL-REPORT §3.6 把 CLI 兼容通道称为"兜底"是严重低估**。它事实上是：
1. **文档化的 V10 全量绕过口**（SKILL §13.3b L956-964 给出了可直接复制的 require 代码）
2. **任何本机 session 可利用**（无需提权、无需真 root 配合、无需 v2 剧场）
3. **与 tree-state.json 零完整性校验叠加后不可检测**（篡改后 tree_validate = 0 issues）

**真实安全完成度评估**: 引擎 V10 caller-binding 在 MCP 路径是扎实的（值得肯定），但**安全模型建立在"攻击者只用 MCP 路径"的假设上**，该假设在 Proma 单机多 session 共享文件系统的真实环境下不成立。建议把 D6 安全维度从 FINAL-REPORT 暗示的 "green/已兜底" 下调为 **🔴 red（存在可实际利用的 P0 级绕过，无需修改引擎即可利用）**，并把 P0-1/P0-2/P0-3 列入 roadmap 的首要项。

---

*审计员声明: 本报告基于 tree-engine.cjs (md5 3e10bf8e) + proma-dev-patches.cjs + SKILL v2.9.7 + FINAL-REPORT §3.6 的静态代码审查，未做 PoC 执行（按 brief out_of_scope "不修改引擎做 PoC"）。所有攻击路径均有源码行号锚点，可由独立 auditor 复核。*
