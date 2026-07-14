# e2e04 — tree-system 负面场景验证报告

> 维护: 周星星 + Proma Agent（主会话 a5c20252）| 日期: 2026-07-15
> 性质: e2e03 之后的「负面场景机制验证」，补 e2e03 未演练的 drift 联动 / flagged 篡改 / E_MAX_SESSIONS 三机制
> 实例: pro（127.0.0.1:19877，userData `~/.proma-dev/`，引擎 `5532fa5f` + patches `339082af` + SKILL `8b2d20f2`，三者=权威源）
> 定位: 与 e2e03 互补——e2e03 验证 GLM 自主协作（正向端到端），e2e04 验证机制在异常输入下拦截/检测（负面）。编排方精确驱动 commander 调工具构造异常态，读 tree-state.json 监督。

---

## 〇、TL;DR

三场景全部通过 + 三项额外发现：

| 场景 | 结果 | 关键证据 |
|---|---|---|
| **③ E_MAX_SESSIONS** | ✅ | 第3个 worker 在 **create_session 阶段**被 E_MAX_SESSIONS 拦（patches 前置预检，Sprint 5 聚类 A），session 未建立=**钱没花**；session_registry count=3/max=3/reached=true |
| **① drift 三档联动** | ✅ | drift_append×3 递进（direction/low/nudge → direction/mid/limit → production/high/prune），leaf.drift_history + state.drift_log 双写各 3 条 |
| **② flagged 篡改检测** | ✅ | 篡改 C-commander（done+伪造audit_gate.pass+flagged+无review_round）→ leaf_add 子被 **E_REVIEW_FLAGGED_BLOCK** 拦（即使伪造了 audit_gate.pass）；补 review_round 后放行 |

**额外发现**（e2e04 副产物，记入待改进）：
- **A. patches 跨树预检 false positive**：`findCallerTreesForBypassGuard` 扫 caller 所属**所有树**，commander 合法跨树时被旧树 reached 状态误伤（保守策略的代价）。
- **B. 引擎硬约束**：worker/auditor 是原子叶子**不能当 parent**（L1072-1082，仅 commander 可有子）——commander 自主调 tree_help 核实并正确识别。
- **C. isFlagged 动态 worker 分支疑似 dead code**：动态分支只对 `role=worker`（done worker+review_required），但 worker 不能当 parent → 该分支在 leaf_add 父链拦截路径（L1088-1100，isFlagged 唯一调用点）实际走不到。

---

## 一、测试设置

| 项 | 值 |
|---|---|
| 实例 | pro（127.0.0.1:19877，ISOLATED=1，userData `~/.proma-dev/`）|
| commander | `d5b039b9-2ce7-49e8-9751-32d49fef94be`（GLM-5.2，root 信任锚，一个 commander 贯穿三棵树）|
| workspace / channel / model | `eb5e3f9c` / `57d0f98e`（GLM）/ GLM-5.2 |
| 三棵树 | `e2e04max`（场景③）/ `e2e04drf`（场景①）/ `e2e04flg`（场景②）|
| 执行模式 | **编排方精确驱动**：逐场景自包含 prompt 下发 commander → commander 调 `mcp__tree__*` 工具 → 编排方读 tree-state.json 监督（落实 e2e03 教训：文件通道是 ground truth，不靠 API 消息数）|
| 红线遵守 | ① SubAgent 仅进程内 Agent 工具（未派任何 create_session/fork 当 reviewer）；② 监督读 tree-state.json；③ 零引擎/patches/SKILL 改动（367/0 基线不动；篡改仅场景②模拟攻击，且只改 pro 测试树的 tree-state.json，不动权威源 dist）|

**pro 启动**：本次开始时 pro 未运行（仅 release@19876），编排方 `start-pro.bat` 拉起 pro@19877，sleep 45s + discover 确认可达。pro dist md5 三校验 = 权威源（5532fa5f/339082af/8b2d20f2）。

---

## 二、场景③ E_MAX_SESSIONS 硬护栏（双层护栏 + patches 前置预检"钱没花"）

### 设计
建 `e2e04max` 树，`audit_meta={max_sessions:3, review_required:false}`。commander 作 root（占 1 session 额度），建 3 个 worker session，期望第 3 个触发 E_MAX_SESSIONS。

### 结果（比原设计更好的发现）
原设计预期第 3 个 worker 在 **engine leaf_add 层**（L1121-1128，projected count > max）被拦。实际 commander 跑出来：第 3 个 worker 在更前置的 **patches create_session 层**就被拦——

```
create_session worker C → error.code = E_MAX_SESSIONS
msg = "caller d5b039b9's tree 'e2e04max' has 3 sessions (max 3, reached)"
→ sessionC 从未建立
```

**三方一致铁证**：
1. pro sessions 列表只有 `e2e04max-A` + `e2e04max-B`，**无 e2e04max-C**（sessionC 没建=钱没花）；
2. tree-state.session_registry 恰 3 个（commander d5b039b9 + A d15c7387 + B 3c1b2af5），C 没登记；
3. `tree_session_count` 返回 `{count:3, max:3, reached:true}`；
4. leaves 只有 root + A + B，C 未落库。

**registry source 字段副发现**：A/B 的 `source:"create_session"`（非 `leaf_add`）——证明 patches 在 create_session handler 内主动调 register-session 旁路登记（Sprint 5 聚类 A），C 因 create_session 被拦所以没登记，闭环一致。

### 机制价值
max_sessions 是**双层护栏**：
- **patches 层 create_session 前置预检**（Sprint 5 聚类 A，`findCallerTreesForBypassGuard`+预检）：在 session 真正创建前拦，**钱没花**。这是 macp2 型爆炸（4 分钟 207 session）的真正前置防线。
- **engine 层 leaf_add 兜底**（L1121-1128）：leaf_add 登记时 projected > max 拦。本场景因 patches 前置先拦未走到此层；该层已被单元测试 sprint5-max-sessions-test 34/0 覆盖。

真实端到端路径下，**patches 前置预检先于 engine 兜底生效**——这是比单元测试更硬的实证。

---

## 三、场景① drift 三档联动（drift_append 留痕 + 双写）

### 设计
建 `e2e04drf` 树。原设计"A-worker 下挂 A1-worker 演示 D1 级联"被引擎硬约束否决（见额外发现 B：worker 不能当 parent）。聚焦 e2e03 真正的 gap——**drift_append 三档留痕**（D1 prune 级联 sd3e2e/Sprint 3 已验证，不重复）。

对 `e2e04drf-A-worker` 连续 3 次 drift_append，模拟 commander 三档递进纠偏。

### 结果（铁证）
`e2e04drf-A-worker.drift_history` 恰 3 条，severity/action 严格递进：

| # | kind | severity | action | reason |
|---|---|---|---|---|
| 1 | direction | low | nudge | 轻档:产出超出in_scope边界 |
| 2 | direction | mid | limit | 中档:同一偏差再现,限权 |
| 3 | production | high | prune | 重档:第三次偏差,剪枝 |

`state.drift_log` 同步 3 条（cmdDriftAppend L2476-2481 双写 leaf.drift_history + state.drift_log 确认）。

### 机制价值
- drift_append 工具在 pro 真实 MCP 调用下，kind/severity/action 枚举校验 + 双写留痕均生效。
- 三档递进（nudge/limit/prune + low/mid/high）可被 commander 正确连续记录，构成纠偏审计链。
- e2e03 的 ⚪"drift 联动未演练"补上。

---

## 四、场景② flagged 篡改检测（E_REVIEW_FLAGGED_BLOCK + 动态 review_round 解除）

### 设计
建 `e2e04flg` 树，`audit_meta={review_required:true}`。建 C-commander（commander 可当 parent，避开 worker-当-parent 禁止，见发现 B）。编排方直接编辑 tree-state.json 模拟攻击者绕门禁，验证 isFlagged 父链拦截（L1088-1100，isFlagged 唯一调用点）。

### 篡改组（模拟绕门禁攻击）
编排方编辑 tree-state.json，把 C-commander 篡成：
- `status: 'done'`（绕门禁直接 done）
- `audit_gate: {verdict:'pass', auditor_session_id:root}`（**伪造** audit_gate 背书）
- `review_evidence: {flagged: true}`（标记未审）
- events **无 review_round**

commander 调 `leaf_add e2e04flg-C1-worker(parent=e2e04flg-C-commander)` → 引擎扫父链 isFlagged(C)：hasReview=false（无 review_round）+ review_evidence.flagged===true → return true → **throw E_REVIEW_FLAGGED_BLOCK**。

实测返回：
```
error.code = E_REVIEW_FLAGGED_BLOCK
error.message = "cannot add leaf under e2e04flg-C-commander: ancestor flagged (done without review).
                 Run G1-G5 review first (append a review_round event), then retry."
```
C1-worker 未落库（present=False）。

**核心证明**：攻击者伪造了 `audit_gate=pass`，但 flagged 仍拦——因 `isFlagged`（L1355）只看 events 里的 review_round + review_evidence.flagged，**根本不看 audit_gate 字段**。这正是 P1-S03「flagged 动态计算、不再依赖 review_evidence 静态字段、防直接篡改蒙混」的核心价值。

### 对照组（补 review_round 动态解除）
编排方再编辑 tree-state.json，给 C-commander events append 一条 `type=review_round` event（保留 review_evidence.flagged=true 不变）。commander 重新 `leaf_add C1-worker` → isFlagged(C)：hasReview=true → **return false**（hasReview 优先于静态 flagged）→ 放行，**C1-worker 落库**（present=True，role=worker, status=pending_brief, parent=C-commander）。

### 机制价值
- flagged 父链拦截（L1088-1100）真实 MCP 下生效，堵「在未审产出上建子 leaf」（ISS-003 场景）。
- isFlagged 从 events 动态派生：有 review_round→放行；补审路径自动解除，无需专门清除命令。
- **flagged 不依赖 audit_gate 静态字段**：伪造 audit_gate=pass 蒙混不过（篡改组铁证）。
- e2e03 的 🟡「flagged 等价门禁」补上真实 flagged 拦截。

---

## 五、额外发现（e2e04 副产物）

### A. patches 跨树预检 false positive（Sprint 5 聚类 A 的保守代价）
**现象**：场景① 初次执行时，commander(d5b039b9) 是 e2e04max + e2e04drf 两棵树的 root。create_session 建 e2e04drf worker 时被拦：`E_MAX_SESSIONS: "caller d5b039b9's tree 'e2e04max' has 3 sessions (max 3, reached)"`——即使 e2e04drf 自己 max_sessions=10、registry 仅 1，远未 reached。

**根因**：patches `findCallerTreesForBypassGuard(sourceSessionId)` 扫描 caller 所属**所有树**，任一 reached 即拒（保守策略：宁可误伤也不放过跨树爆炸）。

**定性**：非 bug，是 Sprint 5 聚类 A 单边方案的**已知保守代价**。真实使用（一个 commander 一棵树）不触发；e2e04 用一个 commander 跨多测试树是特例。**解除**：事后把 e2e04max.max_sessions 3→20（备份 .bak-pre-maxrelax-20260715），场景③结论不受影响，本身佐证错误信息提示的恢复路径「raise audit_meta.max_sessions」。**后续**：若需 commander 合法跨树，可给预检加「目标树」参数，但弱化反爆炸保守性——记入待改进，不急。

### B. 引擎硬约束：worker/auditor 不能当 parent（L1072-1082）
场景① 原设计「A-worker 下挂 A1-worker」被引擎拒（`parent is a worker (atomic leaf). Only commanders can have children`）。commander 自主调 `tree_help(role_semantics)` 核实并正确识别、汇报「step5 引擎层不可行」，未盲目重试。引擎 L1072-1082：parent role∈{worker,auditor} → throw E_SCHEMA_INVALID，只有 commander/root 可有子。**价值**：role 语义约束真实 MCP 下生效 + commander 能自主调 help 诊断。

### C. isFlagged 动态 worker 分支 = dead code（SubAgent 核实确认）
`isFlagged`（L1355）三分支：(1) hasReview→false (2) `review_evidence.flagged===true`→true（静态）(3) `status==='done' && role==='worker' && isReviewRequired`→true（动态 worker）。SubAgent 全引擎核实结论：**#3 是 dead code**。证据链：(a) isFlagged 全引擎仅 1 调用点 cmdLeafAdd 父链扫描 L1092；(b) worker 不能当 parent（L1072-1082，且 segment_append 只改 session 不改 parent、migrate 规则4 是数据修复不建新父子，无路径让 worker 进祖先链）；(c) cmdMigrate 不调 isFlagged，只设静态 `review_evidence.flagged`（规则11 L3798-3821 标记存量 done worker）。故 done worker 永不是新 leaf 祖先 → #3 走不到。**静态分支 #2（migrate 标记）才是有效路径**（e2e04 场景②实证）。建议：可删 #3（L1361）或补注释标防御性（仅手工篡改 tree-state 让 worker 当 parent 时才有意义，但那是引擎防不住的 Layer4 攻击）。

---

## 六、Sprint 1-5 机制实证矩阵（e2e03 + e2e04 合并）

| # | 机制 | e2e03 | e2e04 | 合并 |
|---|---|---|---|---|
| 1 | 5 件套持久化（S2）| ✅ | — | ✅ |
| 2 | create_session 派生（S2）| ✅ | — | ✅ |
| 3 | done 门禁 8 道（S1）| ✅ gate7 | — | ✅ |
| 4 | auditor 审+独立性（P0a/S5）| ✅ | — | ✅ |
| 5 | max_sessions 护栏（S5）| ✅ 就位未触上限 | ✅ **触上限（patches 前置预检钱没花）** | ✅✅ |
| 6 | **drift 联动（S2）**| ⚪ 未触发 | ✅ **drift_append×3 留痕双写** | ✅ |
| 7 | **flagged 篡改检测（S1）**| 🟡 等价门禁 | ✅ **E_REVIEW_FLAGGED_BLOCK + 动态解除** | ✅ |
| 8 | 协作并行效果 | ✅ 2x | — | ✅ |

**结论**：e2e03 的 3 项未触发/等价（drift / flagged / max_sessions 上限）全部由 e2e04 补齐真实触发。**Sprint 1-5 新机制 8/8 实证完成**。

---

## 七、成本

| 维度 | 值 | 评估 |
|---|---|---|
| tree 内 session | e2e04max 3 / e2e04drf 2 / e2e04flg 2 + commander 1 = **8** | 远低于 macp2 的 207；worker 不干活，单 session 成本 < e2e03 |
| 编排方附加 session | **0**（全程读 tree-state，无 driver/observer 误建——落实 e2e03 §8.1 教训）| 干净 |
| 模型 / 墙钟 | 全程 GLM-5.2 / ~35 分钟（含 pro 冷启动 + 两次中途诊断/篡改）| 可接受 |
| 篡改备份 | e2e04max `.bak-pre-maxrelax` / e2e04flg `.bak-pre-tamper` | 可回溯 |

---

## 八、结论 + 后续

**e2e04 负面场景验证通过**：tree-system 补丁形式在 pro 上由 GLM-5.2 commander + 编排方精确驱动，三机制（E_MAX_SESSIONS 双层护栏 / drift 三档联动 / flagged 篡改检测）在真实 MCP 异常输入下全部如期拦截/检测。**Sprint 1-5 新机制实证矩阵 8/8 完成**（e2e03 + e2e04 合并）。

**方法学要点**：编排方精确驱动（逐场景自包含 prompt + 读 tree-state 监督）适合负面场景（需精确构造异常态），与 e2e03 自主协作互补。e2e03 教训落实：全程 tree-state.json 为 ground truth，零 API 消息数误判，零 idle 误建会话。

**后续**：P1 修 e2e03 产物 3 瑕疵 + ARCHITECTURE §3.1（~10 分钟，免费）；额外发现 A/B/C 记入待改进；P2 团队对照实验 / 首个上游 PR；P3 跨仓根治。

**产物**：本报告 + `~/.proma-dev/.../trees/e2e04{max,drf,flg}/tree-state.json`（含 .bak 备份）。

---

> e2e04 由主会话 a5c20252 于 2026-07-15 执行。commander d5b039b9（GLM-5.2）。本报告同步 note.md 顶部 + git 提交。
