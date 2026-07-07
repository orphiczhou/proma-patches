# Tree Harness 中期修复 — 交接文档

> **给新会话**：接手 `tree-harness-midterm-review.md` 暴露的 tree harness 系统性问题修复。
> **交接者**：Proma Agent（会话 d66e3600，2026-07-04 16:55）| **维护**：周星星
> **上游报告**（必读全文）：`workspace-files/.context/tree-harness-midterm-review.md`（4 Agent 洁净室，nanju 活案例，18 leaf）

> **✅ 进度（2026-07-04 17:30，会话 0fbed5a1）**：**P0-1 已修复验证，暂不部署**（用户确认仅 commit + 文档）。
> - 改动：删 `cmdEventAppend` done event 自动同步 status（原 line 1945-1953）+ **连带**删 `collectValidateIssues` 误报前半段（原 line 2547-2557，否则合规中间态被误报）+ 注释。`tree-engine.cjs` 15 增 24 删，4306 行。
> - 测试：P0-1 专项（`.context/plan/p0-1-sync-fix-test.cjs`）4/4 + ISS-003 baseline 13/13 + stash baseline 对比**零回归**（v10 18/6、dbc-spec 45/3 改前改后完全一致；失败是 workspace engine 相对 dist 的既存差异，与 P0-1 无关）。
> - **⚠️ P0-1 不是"删 1 行"**：`cmdLeafSetStatus`（line 1406-1419）要求 set-status done 前先有 done event，合规路径必然有"done event 已写、status 仍 active"中间态，`collectValidateIssues` 必须连带改。详见 `note.md` 顶部条目。
> - **下一步（阶段 A 继续）**：P0-2（先复核 C3 是否真闭环——读 `resolveAuditorIndep` 行 ~2245；再 SKILL 加死锁期降级）→ P0-3（状态机流转白名单 + `E_STATUS_TRANSITION_INVALID`）→ 一起部署 dev/release dist。

---

## 一、一句话任务

tree harness **骨架优秀，但门禁刚性被一行代码（P0-1）架空**，且存在多个"死的硬约束"和结构性死锁。本次任务：按 **P0 → P1 → P2** 顺序修复，恢复门禁刚性 + 给死锁提供合规逃生通道。**P0-1 是头号优先级，且解锁上一轮 ISS-003 阶段一的工作。**

---

## 二、⚠️ 头号依赖：ISS-003 阶段一在 P0-1 修复前是空转的

上一轮（commit `c448947`）我做了 ISS-003 阶段一：在 `cmdLeafSetStatus` done 门禁加了 review_round 收敛校验（+13/13 测试通过）。

**但这份工作在 P0-1 面前完全失效**：
- P0-1（`tree-engine.cjs:1945-1953`）：`cmdEventAppend` 写 done event 时自动 `leaf.status='done'`
- 后果：worker 写完 done event，status 直接转 done，**无需调 `cmdLeafSetStatus`**
- 我加在 `cmdLeafSetStatus` 的 review 门禁 → 永远不触发（B6 实证：milestones=[] / audit_gate=required / 无 alignment，却 done）

**所以：必须先删 P0-1 line 1952，ISS-003 阶段一的 review 门禁才生效。** 这是本轮最高优先级，且让上一轮工作从"空转"变"生效"。

---

## 三、当前状态（接手前必读）

### 未部署的改动（2 批，都在 workspace-files；dist 已回滚未发布）

**1. commit `c448947`**（2026-07-04，分支 `release-0.13.16-hardening`）：ISS-001/002/003阶段一/004 修复
- ISS-001 `remote_create_session` 跨实例 workspace_id 兜底（patches.cjs，问目标实例 default）
- ISS-002 同名会话切换（patches.cjs，**title 假设证伪**——renderer 纯 sessionId 匹配，改预热 listAgentSessions + 失效 toast）
- **ISS-003 阶段一 done 门禁 review 校验（tree-engine.cjs +150 行）—— ⚠️ P0-1 修复前空转**
- ISS-004 EPIPE（patches.cjs，bridge 连接级 socket on-error + res.end try/catch + uncaughtException 限定 EPIPE/ECONNRESET）
- 13/13 测试通过，代码审计无阻断
- **用户指示未部署**（dist 回滚），仅 commit

**2. 文档更新**（已 commit）：待解决清单（4 ISS 状态）+ note.md（2026-07-04 条目）+ PROJECT-INDEX + `.context/plan/iss-fix-plan-v2.md` + `.context/plan/iss003-review-gate-test.cjs`

### 部署状态
| 位置 | patches.cjs | tree-engine.cjs | 状态 |
|------|-------------|-----------------|------|
| workspace-files（源） | 3109 行 | 4315 行 | 最新（含 ISS 修复 + 中期评审基线） |
| dev dist | 3036 行 | 3869 行 | 改前（已回滚） |
| release dist | 3036 行 | 4140 行 | 改前（已回滚） |

备份：`.bak-pre-iss-fix-20260704`（workspace-files）+ `.bak-pre-iss-deploy-20260704`（dev/release dist）。

---

## 四、要解决的问题（P0 → P1 → P2，含已验证行号）

> 行号基于当前 workspace-files/tree-engine.cjs（4315 行）。改引擎后行号会偏移，**以 grep 为准**。

### 🔴 P0-1 done event 自动同步 status（总崩点，4 源全中）
- **代码**：`tree-engine.cjs:1945-1953`
  ```js
  if (opts.type === 'done' && leaf.status !== 'done') {
    // 注释自欺"不绕过门禁"...
    leaf.status = 'done';   // ← line 1952, 删这行
  }
  ```
- **后果**：架空 `cmdLeafSetStatus` 的 8 道 done 门禁（milestones / audit_pass / expect_outputs / deliverables 落盘 / brief_echo+done / **review_round 收敛** / audit_gate / children 全 done）。B6 实证：8 道一道没过却 done
- **修复**：删 line 1952，让 status 由 `cmdLeafSetStatus` 唯一入口写入。**成本：删 1 行**
- **依赖**：修了它，ISS-003 阶段一 + 所有 done 门禁才生效

### 🔴 P0-2 audit_gate 三重死锁（V5b + V10 + 信任锚）
- **死锁链**：V5b 要求 alignment event 的 auditor=tree-leaf session；V10 要求 audit_gate.pass 由 V10-active auditor 调用；首个 V10-active leaf 需信任锚 C3（标注"实施中"）→ 三重闭环不可达
- **实证**：13/13 worker alignment 缺失；A-commander 双向证伪（Solution A root 自审被 E_AUDIT_PREMATURE 拒 / Solution B fresh auditor 被 E_ALIGNMENT_NOT_VERIFIED 拒）→ commander 发明 **C-b 决议**（"实质门禁，形式待审"）作设计外永久兜底
- **代码层 root 后门**（V-04）：`resolveAuditorIndep` line ~2245-2258 允许任意非 root leaf 用 root 当 auditor 直接 pass → 独立审计降级为 root 单点信任
- **⚠️ 复核点**：上一轮我认知"C3 已 2026-06-25 落地"（root 自审特例行 2082-2084 / auto_upgrade 行 1965-1975 / root 担任 auditor 行 2099-2113）。但报告说仍三重死锁——**需复核 C3 是否真闭环，还是只解了 root 这一支，commander 派的独立 auditor leaf 仍死锁**
- **短期修复**：SKILL 加"死锁期合规降级"（显式 `audit_gate_bootstrap_deadlock=true` + SDK code-reviewer 替代 V10-active auditor）—— 把 C-b 决议合规化
- **长期修复**：落地信任锚 C3 全链路，让首个 audit_gate.pass 可达

### 🔴 P0-3 状态机零流转校验 + tao-watcher 绕过 MCP
- **代码**：`cmdLeafSetStatus` line 1256 只校验 `new_status ∈ STATUS_ENUM`，**无 from→to 流转矩阵**。pending_brief→pruned / done→active / archived→active 全合法（archived 不是终态！）
- **tao-watcher 绕过 MCP**（= nanju ISSUE-004 RCA）：直改 tree-state.json 写 nudge_log，**从不调 `tree_nudge_append`** → `cmdNudgeAppend` 的 prune-at-7（line 3061-3062）从未运行（B1 nudge_count=42 仍 active 3.3h）
- **修复**：
  - 加流转白名单 + `E_STATUS_TRANSITION_INVALID`
  - tao-watcher MCP 化（调 `tree_nudge_append` 而非直改文件）；或引擎层 nudge_log schema 校验（拒绝不符合 cmdNudgeAppend 格式的条目）

### 🟠 P1（8 项重大设计问题）

| # | 问题 | 修复 | 成本 |
|---|------|------|------|
| P1-1 | §14 审计树整章失效（nanju 0 个独立审计 leaf；§14 vs worker §4.6 两套机制未声明优先级） | SKILL 明确：文档级用 §4.6，跨文件架构级用 §14；§14.1 加 task_scope 门槛 | 低（文档） |
| P1-2 | 5 件套未持久化（leaf 无 brief/dod；milestone_add 从未调用，18/18 milestones=[]） | leaf 加 brief/dod/milestones 字段；milestone_add 在下发 5 件套时自动注册 | 中 |
| P1-3 | drift 留痕不一致（12 archived 但 drift_log 仅 4 条；set-session/migrate/restore 不写 drift） | 三处补 drift；restore 后扫死叶补 drift | 中 |
| P1-4 | ctx 全 0，竹节交接永远不触发（心跳 22 次只读不写 ctx，set-context 调用 0 次） | cmdHeartbeatAppend 收到 verdicts 后自动 set-context；或 validate 加异常检测 | 低 |
| P1-5 | validation+archive+budget 死锁（node_budget=10 硬编码 line 966；archive 被 validation 阻断；root 违规直改 tree-state.json archive 8 死叶） | archive 不硬依赖 validate；新增 `tree_leaf_purge` 合规逃生；node_budget 可配置 | 中 |
| P1-6 | 越权创建不可逆 + 无修复工具（无 transfer_ownership / audit_log 清理；A-commander 被迫重建 4 全新 leaf，4 倍工作量） | leaf.add 校验 parent.role 与 caller.session 一致；新增 transfer_ownership + audit_log 清理 | 中 |
| P1-7 | worker 自任状态机仲裁者（22 次 set-status 16 次 worker 自改，commander 6 次全失败 E_TREE_NOT_VALIDATED） | 状态机仲裁权限收敛（worker 只能改自己 active↔done，不能 pruned/archived） | 中 |
| P1-8 | 命名正则漏洞（LEAF_NAME_RE line 64 第 3 组 `\w+` 非 `(root\|commander\|worker)` 枚举；A1w/A1r 命名合法） | 第 3 组改枚举 | 低 |

### 🟡 P2
- W-01 检测 bug（查文本而非工具调用首条；GLM-5.2 tool-call-first 永远 fail）
- checkSessionAlive fail-open（V-06，MCP 入口强制注入 verifier，异常时 fail-closed）

---

## 五、修复路线图（建议 3 阶段）

### 阶段 A：解锁刚性（1-2 天，必做）
1. **P0-1** 删 tree-engine.cjs:1952 → 恢复 done 门禁刚性 → **解锁 ISS-003 阶段一**
2. **P0-2 短期** SKILL 加死锁期降级（C-b 合规化）
3. **P0-3** 状态机流转白名单 + E_STATUS_TRANSITION_INVALID
4. 部署 dev/release dist + 重启验证（**部署前确认用户**——上一轮我部署后用户让回滚）

### 阶段 B：补设计 gap（3-5 天）
5. P1-2 5 件套持久化
6. P1-5 archive 死锁修复 + tree_leaf_purge 逃生
7. P1-6 越权修复（transfer_ownership + audit_log 清理）
8. P1-8 命名正则枚举化
9. P1-7 状态机仲裁权限收敛

### 阶段 C：体系完善（后续）
10. P0-2 长期（信任锚 C3 全链路落地）
11. P0-3 tao-watcher MCP 化 + nudge_log schema 校验
12. P1-1 §14 vs §4.6 边界
13. P1-3 drift 留痕补全
14. P1-4 ctx 集成心跳
15. P2

---

## 六、关键陷阱/约束（避免重蹈覆辙）

1. **ISS-003 阶段一在 P0-1 修复前空转** —— 头号依赖，先删 P0-1 line 1952
2. **C-b 决议是设计外兜底** —— commander 被迫发明的"实质门禁形式待审"，要么合规化进 SKILL（P0-2 短期），要么修死锁（P0-2 长期）
3. **root 直改 tree-state.json 违反铁律#1** —— archive 死锁逼的，需合规逃生通道（P1-5）。nanju 案例已发生
4. **不能假设 MCP 是唯一写入路径** —— tao-watcher 直改文件绕过引擎校验（nanju ISSUE-004 RCA 教训）。引擎层需 schema 校验
5. **门禁越多越安全的错觉** —— P0-1 提醒：8 道门禁被 1 行代码架空。关键是门禁间不能有绕过链，不是门禁数量
6. **部署需用户确认** —— 上一轮（2026-07-04）我部署后用户让回滚（"不要发布，仅文档+git"）。新会话部署前务必确认
7. **"死约束"识别** —— V5b/§14/三档纠偏/ctx 竹节/milestone_add 在 nanju 实战中从未真正执行。修复时优先验证"是否真生效"，别只看代码存在

---

## 七、新会话第一步建议

1. **读上游报告全文**：`workspace-files/.context/tree-harness-midterm-review.md`
2. **读本交接文档 + PROJECT-INDEX**（恢复上下文）
3. **验证 P0-1**：`grep -n "opts.type === 'done' && leaf.status !== 'done'" tree-engine.cjs` 确认 line 1945-1953
4. **复核 P0-2 C3 是否真闭环**：上一轮我认知 C3 已落地，但报告说仍死锁——读 `resolveAuditorIndep`（行 ~2245）+ 信任锚相关代码，确认 commander 派独立 auditor leaf 是否仍死锁
5. **决策阶段 A 起点**：建议先修 P0-1（删一行）+ 部署 + 跑 ISS-003 测试（`.context/plan/iss003-review-gate-test.cjs`）验证 review 门禁是否真生效
6. **方法论**：用 Tree 模式（4 Agent 洁净室）推进 P0-2/P0-3，参考 R1 洁净室方法论（`.context/v10/cleanroom-round1-*`）。Tree 模式三层分离（实现/评价/洁净室）对抗确认偏误

---

## 八、文件索引

| 用途 | 路径 |
|------|------|
| **上游报告（必读）** | `workspace-files/.context/tree-harness-midterm-review.md` |
| 本交接文档 | `workspace-files/.context/active/handoff-tree-harness-fix-2026-07-04.md` |
| ISS 修复方案 v2 | `workspace-files/.context/plan/iss-fix-plan-v2.md` |
| ISS-003 测试（13/13） | `workspace-files/.context/plan/iss003-review-gate-test.cjs` |
| nanju ISSUE-004 RCA（= P0-3 实证） | `D:/codes/multi-agent-collab-platform/.context/issue-004-rca.md` |
| 引擎（4315 行） | `workspace-files/tree-engine.cjs` |
| 插件（3109 行） | `workspace-files/proma-dev-patches.cjs` |
| tree-commander SKILL v2.3 | `workspace-files/skills/tree-commander/SKILL.md` |
| tree-worker SKILL v2.3 | `workspace-files/skills/tree-worker/SKILL.md` |
| 待解决问题清单 | `workspace-files/.context/待解决问题清单.md` |
| 项目索引 | `workspace-files/.context/PROJECT-INDEX.md` |
| 长期笔记 | `workspace-files/.context/note.md`（顶部 2026-07-04 条目） |

---

## 九、关键 P0 行号速查（grep 锚点）

```
P0-1:  grep -n "opts.type === 'done' && leaf.status !== 'done'" tree-engine.cjs
       → line 1945-1953, 删 line 1952 (leaf.status = 'done')
P0-2:  grep -n "resolveAuditorIndep\|auto_upgrade\|callerIsRootSelf" tree-engine.cjs
       → resolveAuditorIndep ~2245-2258 (root 后门), auto_upgrade ~1965-1975
P0-3:  grep -n "STATUS_ENUM\|assertEnum.*new_status\|nudge_count >= 7" tree-engine.cjs
       → line 68 (STATUS_ENUM), line 1256 (cmdLeafSetStatus 校验), line 3061 (prune-at-7 dead code)
P1-8:  grep -n "LEAF_NAME_RE" tree-engine.cjs → line 64 (第3组 \w+ → 枚举)
P1-5:  grep -n "node_budget\|E_TREE_NODE_BUDGET_EXCEEDED" tree-engine.cjs → line 963-971
```

---

## 十、历史 commit（最近）

- `c448947`（2026-07-04）：ISS-001/002/003阶段一/004（未部署，本轮交接的上游）
- `0126556`：docs(issues) 待解决清单加 ISS-002
- `1325e6e`：feat(tree-view) 会话名词化 + combobox
- `afa26aa`：docs(note) Layer A+C 闭环测试
- `48793b0`：feat(tree-engine) Layer A 统一 call_log + Layer C 聚合分析

---

*交接完成。新会话从「第七节 第一步」开始。*
