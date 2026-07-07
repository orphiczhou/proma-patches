# Tree Harness 改进方案 — 2026-07-07（基于 nanju-iter2 死锁复盘 + 实证）

> **作者**：Proma Agent（会话 57f5aec1）｜ **委托**：周星星
> **上游**：`tree-system-execution-report-2026-07-07.md`（nanju-iter2 v2 报告）+ `handoff-tree-harness-fix-2026-07-04.md`
> **方法**：3 路子 Agent 深挖（引擎代码根因 / 历史文档 / repro 实证）+ 主线亲自读核心函数 + repro 实跑确认
> **用户决策**：全面改进并落地 ｜ 死锁哲学=root 信任锚强化(G1) ｜ 改源+git commit，暂不部署

---

## TL;DR — 方案重心已修正

0707 报告结论"alignment/audit_gate **设计层死锁，commander 无解**"经实证**被推翻**。

- **repro 实跑**（`57f5aec1.../.context/plan/deadlock-repro.cjs`，10/10 通过）：root 一人当 auditor、全程走 `resolveAuditorIndep` **闸门2**（tree-engine.cjs L2241-2255），worker 顺利 done，validate 整树通过。**引擎通道完备，不需要改。**
- **真正根因**：commander **协议误用**——SKILL §6 L320 明文教"路线图 Agent 必须是独立 leaf"，把 commander 推向 fork 独立 auditor leaf 走闸门3（V10-auditor-active），而闸门3 对冷启动期 leaf 是无穷递归死路。
- **方案重心**：从"改引擎破死锁"转向"**改 SKILL/方法论固化 root 信任锚冷启动流程**"。更安全（不动安全逻辑）、更简单、天然适配"改源不部署"（SKILL 改动不需发 dist）。

---

## 一、死锁根因（实证）

### 1.1 引擎机制（已逐行确认）

`resolveAuditorIndep`（tree-engine.cjs L2211-2301）三道闸门：

| 闸门 | 规则 | 冷启动可用 |
|---|---|---|
| ① root 自审（L2224）| `leaf.role==='root' && auditor===leaf.session_id` | ✅ |
| **② root 当任意非 root leaf 的 auditor（L2241-2255）** | 仅要求 rootLeaf status≠archived/pruned + events 非空 | **✅ 死锁正解** |
| ③ 非 root auditor（L2290-2299）| V10-auditor-active 三连：status=done + events 非空 + 自身 audit_gate=pass | ❌ 冷启动递归 |

死锁卡点：`cmdAuditGate` L2732 caller 校验 `callerSessionId !== audit_session_id` → `E_BORROWED_IDENTITY`。**worker 不能自己调 audit_gate 给自己 pass，必须 auditor 自己调**。commander 误以为要 fork 一个"独立 auditor leaf"来调，但该 leaf 走闸门3 自己也要 done → 递归。

### 1.2 正确冷启动流程（repro 场景 B 实证）

root（commander 自己，caller=root.session_id）按严格顺序给 worker 配齐 4 件事，全程走闸门2：

1. `milestone-add`（worker 的里程碑 + expect_outputs）+ `milestone-set-result --audit-pass true --audit-session-id <root>`（闸门2 放行）
2. worker 自己写 `brief_echo`（无 alignment）
3. **root 自己**写一条带 alignment 的 `brief_echo` event 到 worker，`meta.auditor_session_id=<root>`（闸门2 放行，V5b 前置）
4. worker 自己写 `done` event（带 self_check）
5. **root 自己**调 `audit-gate <worker> pass --audit-session-id <root>`（caller===audit_session_id，闸门2 放行）
6. worker 自己 `leaf-set-status done`

**全程无需 fork 任何独立 auditor leaf。** 复杂树若要长期独立 auditor，root 先用此流程把 auditor leaf 喂到 V10-auditor-active（repro 场景 A 实证），之后该 auditor 可走闸门3 审后续 worker。

### 1.3 对 0707 报告的修正

| 0707 原说法 | 实证修正 |
|---|---|
| "设计层死锁，commander 不读写 tree-state.json 不 patch 引擎无解" | ❌ 引擎闸门2 已给 root 通道，commander 走对协议即可解 |
| "降级 A 真正形态=新建 worker+跳过 leaf+直落 deliverables，方法论应固化" | ⚠️ 这是现场发明。既然 root 通道是正解，降级 A 降级为"极端应急模式"，非首选 |
| "C-b 决议（实质门禁形式待审）需合规化" | ❌ root 通道解死锁后，C-b 废弃，不合规化 |
| "audit_log_integrity 是 help 未收录错误码" | ❌ 它是 `collectValidateIssues` 内部检查项（L2558-2617），不是错误码；316 处是历史脏数据 |
| "E_NO_OWNERSHIP 是 tree 错误码 help 漏收" | ❌ 它在 patches.cjs L380-381（session 层），不属于 tree 错误码体系 |
| "trust-anchor 方案A（C3）未落地" | ⚠️ C3 已落地（闸门2），只是 SKILL/方法论没教 commander 用它 |

---

## 二、改进方案（三层）

### L0 — 死锁打破（改 SKILL/方法论，**不改引擎**）

| # | 文件 | 位置 | 改动 |
|---|---|---|---|
| L0-1 | `skills/tree-commander/SKILL.md` | §6 L320 "路线图 Agent 必须是独立 leaf" | **修正死路**：改为"冷启动期（树内无 done+events+audit_gate=pass 的 auditor leaf）commander **必须**用 root.session_id 当 alignment+audit_gate auditor；正常期可派独立 leaf" |
| L0-2 | `skills/tree-commander/SKILL.md` | §4 Step4 done 质量门 | **补缺**：在"验收"与"set-status done"之间插入"auditor 调 audit_gate(pass)"步骤，注明 caller 必须=audit_session_id |
| L0-3 | `skills/tree-commander/SKILL.md` | 新增 §13「冷启动信任锚流程」 | **新增**：定义冷启动判定 + root 配齐 4 件事的严格顺序（§1.2）+ 转正常期触发条件（首个 worker done 后可派独立 auditor）|
| L0-4 | `reference/commander-methodology-v10.md` | §2.3 信任锚 | **扩写**：root 自审 root（已有）+ **root 当任意 worker auditor（新增，闸门2）** + caller===audit_session_id 硬约束说明 |
| L0-5 | `skills/tree-worker/SKILL.md` | §3.4 注脚 | 补"冷启动期 commander 用 root.session_id 直接背书，worker 不要伪造 auditor_session_id" |

### L1 — 引擎加固（改 tree-engine.cjs，需 git，暂不部署）

| # | 改动 | 位置 | 说明 |
|---|---|---|---|
| L1-1 | **P0-3 状态机流转白名单** | `cmdLeafSetStatus` L1249-1258 | 加 from→to 白名单 + `E_STATUS_TRANSITION_INVALID`（done→active 禁；archived 不可复活；pruned→done 需重置）。当前只校验枚举，0 流转校验 |
| L1-2 | **help 同步** | help 字符串（L3675+ alignment_workflow / L3782 error_code_index / EVENT_TYPE help） | error_code_index 标题"33 个"重新统计；alignment_workflow 补 review_round/G1-G5/red_count 收敛；EVENT_TYPE 补 review_round（第9种）；注明 E_NO_OWNERSITY 在 session 层、audit_log_integrity 是 validate 检查项 |

### L2 — 体系完善

| # | 改动 | 说明 |
|---|---|---|
| L2-1 | 术语统一 | "5 件套"统一（design.md 仍叫"4 件套"，v1.2 不知此术语）|
| L2-2 | 降级 A 固化（降级为极端应急）| SKILL 补"引擎/协议彻底失效时的应急：新建 worker+跳过 tree leaf+直落 deliverables"，非首选 |
| L2-3 | C-b 决议废弃 | root 通道解死锁后，C-b 不再需要 |
| L2-4 | W-08 vs §4.6 冲突标注 | worker §4.6 "SDK SubAgent 填合法 UUID"的伪造风险已知（阶段二 Layer2 根治），SKILL 显式标注为已知局限 |

### 引擎可选便利化（nice-to-have，未列入必做）

`tree_leaf_endorse`（root 一键给 worker 配齐 alignment+audit_gate）减少多步摩擦。但 repro 证明手动多步完全可用，便利化非必须。**本轮不做**，留作后续。

---

## 三、验证计划

1. **repro 回归**：`deadlock-repro.cjs` 改后重跑，场景 B 仍 10/10（证明文档改动不破坏引擎行为）
2. **baseline 零回归**：`iss003-review-gate-test.cjs`（13/13）+ `p0-1-sync-fix-test.cjs`（4/4）+ dbc-spec 改后全过
3. **P0-3 新增测试**：状态机流转白名单专项（done→active 拦 / archived→active 拦 / 合法流转放行）
4. **help 一致性**：改后 grep 锚点重新统计错误码数，与 error_code_index 标题一致

---

## 四、部署策略（用户已定）

- **SKILL/方法论改动**（L0/L2）：直接改 `proma/skills/` + `workspace-files/skills/`（双份同步），Proma 重载即生效，**不需发 dist**
- **引擎改动**（L1）：改 `workspace-files/tree-engine.cjs` + git commit，**暂不复制到 dev/release dist**（用户验证后再发）
- 备份：改动前 `.bak-pre-improvement-20260707`

---

## 五、实施顺序

1. 备份（tree-engine.cjs + SKILL.md 双份）
2. L0 SKILL/方法论（核心，解死锁）
3. L1-1 P0-3 状态机白名单 + 新增测试
4. L1-2 help 同步（SubAgent）
5. L2 术语/降级A/C-b（SubAgent）
6. 全量验证（repro + baseline + P0-3）
7. git commit + 交付文档 + CLAUDE.md 更新

---

## 六、关键陷阱（避免重蹈）

1. **不要改 resolveAuditorIndep**——repro 证明闸门2 完备，改它反而可能破坏 V10 防伪造
2. **SKILL §6 L320 是死锁文档源头**——改这里比改引擎更关键
3. **caller===audit_session_id 是硬约束**——文档必须教，否则 commander 还会误用
4. **引擎改动必须跑 baseline 零回归**——P0-3 状态机可能影响现有流转测试
5. **不部署 dist**——用户明确，引擎改动只 commit

---

*方案定稿。实施从备份 + L0 开始。*

---

## 七、实施完成与验证（2026-07-07 收敛定稿）

### 7.1 实施结果

| 层 | 改动 | 状态 | 验证 |
|---|---|---|---|
| **L0** | SKILL §13 冷启动信任锚流程（caller 机制/§13.0 术语/§13.3 步骤0-7/§13.3a auto_upgrade）+ §6/§4/§5 对齐 + methodology §2.3.1 + worker §3.4 | ✅ 两轮审计收敛 | 洁净室复测：新 commander 能走通 worker done 闭环 |
| **L1-a** | P0-3 状态机流转白名单（STATUS_TRANSITIONS + E_STATUS_TRANSITION_INVALID）| ✅ | p0-3 新测试 19/19 |
| **L1-b** | milestone caller-binding（堵场景 D 攻击面：dispatchMilestone 透传 caller + cmdMilestoneSetResult caller 校验）| ✅ | repro 场景 D 已堵（D1/D2 → E_BORROWED_IDENTITY）|
| **L1-c** | help 同步（error_code_index 40 个 / alignment_workflow 补 review_round / EVENT_TYPE 9 种 / role_semantics 补白名单 / session_liveness topic）| ✅ | help 一致性自检通过 |
| **L2** | 待解决清单更新（ISSUE-005/008/009 已解，006/007/010 遗留）+ design.md 术语注 | ✅ | — |

### 7.2 关键修正（推翻 0707 报告结论）

0707 报告原结论"alignment/audit_gate **设计层死锁，commander 无解**"经 repro 实证**被推翻**：
- `resolveAuditorIndep` **闸门2**（L2241-2255）一直允许 root 当任意 worker 的 auditor，repro 场景 B 10/10 全通过
- 死锁根因是 **SKILL §6 L320 教错**（"路线图 Agent 必须是独立 leaf"→ commander fork 独立 auditor 走闸门3 → 无穷递归）
- **引擎不需要改即可解死锁**；本次引擎改动（P0-3 + milestone caller-binding）是顺带加固，非解死锁

### 7.3 验证统计

| 测试 | 结果 |
|---|---|
| iss003-review-gate-test | 13/13 ✅（零回归）|
| p0-1-sync-fix-test | 4/4 ✅（零回归）|
| p0-3-status-transition-test（新）| 19/19 ✅ |
| deadlock-repro 场景 A-F | 全语义自洽 ✅（B 10/10 root 通道；D 攻击面已堵；F auto_upgrade 实证）|
| 洁净室盲测（2 轮）| 第2轮通过（blocker 全解）|

### 7.4 遗留（本次未做，记录为后续课题）

- **ISSUE-006** 竹节交接 ownership 不迁移（patches.cjs 层，需引擎↔patches 回调）
- **ISSUE-007** commander context 自动竹节 + session 通信可靠性（notify/wait）
- **ISSUE-010** audit_log_integrity 316 处历史脏数据清理（需 migrate 规则/清理工具）
- dbc-spec.cjs 测试脚本 API 过时（setSessionVerifier），非本次引入，待单独修

### 7.5 部署状态

按用户决策：**改源 + git commit，暂不部署 dist**。
- SKILL/方法论改动（proma/skills/）：Proma 重载即生效，不需发 dist
- 引擎改动（workspace-files/tree-engine.cjs）：已 git commit，**未复制到 dev/release dist**（用户验证后再发）
- 备份：`.bak-pre-improvement-20260707`（tree-engine.cjs + SKILL + patches + 4 份方法论）
