# 方法论覆盖度审计（Methodology Coverage Audit）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（方法论补建）
> 配套：[../.context/tree-harness-midterm-review.md](../.context/tree-harness-midterm-review.md)（中期评价，死硬约束清单来源）· [../.context/active/improvement-report-2026-07-09.md](../.context/active/improvement-report-2026-07-09.md) P1-M05

本文回应 improvement-report **P1-M05**：「形式≠内容有效」原则（V10 核心洞察）只用于引擎校验，**未推广到方法论自身**——大量方法论条款「形式写了但实战从未执行」（中期评价称之为「死的硬约束」）。本文逐条审计这些约束的纸面/实战状态。

---

## 一、审计目的

V10 教会团队「字段存在 ≠ 内容有效」（如 audit_gate.verdict 字段存在不等于审计真做了）。但方法论体系自身存在同样的「形式完整 ≠ 实战执行」盲区。本审计：

1. 对照中期评价（2026-07-04，nanju 4-Agent 洁净室）识别的「死硬约束清单」
2. 逐条标注**当前**（2026-07-11，经基线建设 + PRD 补建后）的纸面/实战状态
3. 推动方法论从「纸面门禁」走向「刚性门禁」

---

## 二、死硬约束清单 × 当前状态

> 中期评价（2026-07-04）在 nanju 实战中发现 6 类「形式有、实战无」的方法论条款。下表核实每条的当前状态。

| # | 约束 | 中期评价时（07-04）| 当前状态（07-11）| 修复进展 |
|---|---|---|---|---|
| 1 | **V5b alignment 回填**（done 前 brief_echo 对齐度） | 13/13 worker 缺失 | 🟡 **部分激活** | P0-1 修复（删 done 自动同步 status）恢复门禁刚性 + ISS-003 阶段一补 review 门禁；阶段二（review_evidence 不可写字段）未做 |
| 2 | **§14 独立审计 leaf**（≥4 独立 reviewer） | 18 leaf 中 0 个独立审计 leaf | 🟡 **机制有，端到端 gap** | P0a 新增 `role=auditor`；但端到端 fallback 不可用（P1-S04，fork identity timeout） |
| 3 | **milestone_add 工具**（里程碑非空门禁） | 18/18 leaf `milestones=[]` | 🟢 **已激活** | 引擎 V3 硬强制 done 前 milestones 非空+全 audit_pass（L1476，dbc-spec 验证）+ §13.3/worker §2 教 milestone_add（2026-07-14 复核，原"纸面"判断过期基于 07-04 V3 前） |
| 4 | **5 件套契约持久化**（leaf 含 brief/dod） | leaf 对象无 brief/dod 字段 | 🟢 **已激活** | 引擎 leaf schema 加 5 字段 + SKILL 教化 + 测试 15/0 + pro 实证（2026-07-14 Sprint 2，见 note 收尾条目） |
| 5 | **三档纠偏决策树**（drift_history） | drift_history 全空 | 🟢 **已激活** | set-session/migrate/restore 联动写 drift（2026-07-14 Sprint 2）+ drift_append 工具；状态变更全留痕 |
| 6 | **ctx_pct 竹节交接**（上下文甜点区自动护航） | ctx 永远 0，22 次心跳只读不写 | 🟡 **部分激活** | 引擎竹节刚性触发（set-context≥85%→segment_pending，2026-07-14）+ SKILL §8 教哨兵 get_session_context 写真实 ctx；ctx 写入待实战验证（ISS-007 / P2-S04） |

---

## 三、状态汇总

```
已激活（刚性）：3 / 6（5 件套持久化 / drift 留痕 / milestone 门禁，2026-07-14 Sprint 2）
部分激活      ：3 / 6（V5b alignment / §14 auditor / ctx 竹节）
仍纸面        ：0 / 6
```

**结论**：中期评价 7 天后，6 条死硬约束中**无一条完全激活**，3 条部分激活，3 条仍纸面。方法论「形式≠内容」盲区**仍未系统治理**——这正是本审计要推动的。

---

## 四、各约束的激活路径

### 约束 1（V5b alignment）— 接近激活
- ✅ P0-1 已堵「done event 自动同步 status 架空门禁」
- ✅ ISS-003 阶段一已加 review 门禁（13/13 测试）
- ⚠️ 阶段二（review_evidence 不可写字段 + Layer2 findings-产出相关性 + R-08 巡逻）未做 → 仍可被「events 自写性」绕过
- **激活条件**：ISS-003 阶段二落地

### 约束 2（§14 auditor）— 机制有但端到端断
- ✅ P0a 新增 role=auditor + 简化协议
- ⚠️ Proma fork identity timeout 导致 auditor session 卡死（P1-S04）
- **激活条件**：P1-S04 的 SKILL fallback（root 归档卡死 session + 重 fork）或 Proma 修 fork

### 约束 3（milestone_add）— ✅ 已激活（2026-07-14 Sprint 2 复核）
- ✅ 引擎 V3 硬强制：cmdLeafSetStatus done 前置 milestones 非空 + 全部 audit_pass=true（L1476/L1496）。dbc-spec V3 用例验证
- ✅ SKILL 教化：commander §13.3 步骤 1 教 milestone_add（root 冷启动配 done 前置）；worker §2 步骤 2 教 milestone 拆解 + milestone_add 持久化（2026-07-14 补）
- 📝 原"纸面"判断过期：基于 07-04 中期评价（V3 之前 18/18 milestones=[]）。V3 引入后 done 门禁硬强制，milestone 非空率对 done leaf = 100%

### 约束 4（5 件套持久化）— ✅ 已激活（2026-07-14 Sprint 2）
- ✅ leaf schema 加 brief/dod/report_protocol/autonomy/self_audit（cmdInit root L770 + cmdLeafAdd L1056）
- ✅ commander SKILL §4 Step 2 强制 create_session + 混合任务书；worker SKILL §2 启动 tree_leaf_get 读 leaf；§7/F1 fork 边界标注
- ✅ 5 件套持久化测试 15/0（`.context/plan/sprint2-five-piece-test.cjs`）
- ✅ pro 实证：commander d218bd5c tree_init→leaf_get，brief/dod 完整回填（47s）
- 详见 [design-commander-spawn.md](./design-commander-spawn.md) §八 + note 2026-07-14 收尾条目

### 约束 5（三档纠偏 / drift 留痕）— ✅ 已激活（2026-07-14 Sprint 2）
- ✅ set-session/restore/migrate 三个状态变更命令自动联动写 drift（双写 leaf.drift_history + state.drift_log）
- ✅ drift_append 工具保留（agent 手动记录偏差）
- ✅ 顺带修复 restore tree_id mismatch bug（pre-existing P1：tree-state.json 加 tree_id 自描述 + migrate 规则 13 补旧树）
- 测试 `.context/plan/sprint2-drift-linkage-test.cjs` 9/0

### 约束 6（ctx 竹节）— 🟡 部分激活（2026-07-14 Sprint 2）
- ✅ 引擎刚性：cmdLeafSetContext ctx≥阈值（audit_meta.ctx_segment_threshold 默认 85）→ 自动 segment_pending + drift handoff（替代 SKILL §8.3 v0.3 未实现）。测试 sprint2-ctx-segment-test.cjs 7/0
- 🟡 SKILL 软约束：§8.1 步骤 2 教哨兵调 get_session_context + leaf_set_context 写真实 ctx（治"ctx 永远 0"）；§8.3 sweet_spot_risk → commander 竹节交接流程（create_session + segment_append + set-session + set-status active）
- ⚠️ 待实战验证：哨兵心跳是否真执行 get_session_context（需真实长任务观察）

---

## 五、方法论自审机制（推广 V10 原则）

V10 的「内容有效性」原则应成为方法论自身的常规自审。建议：

### 5.1 定期审计（每 Sprint）
每个 Sprint 末跑一次本审计，对照死硬约束清单核实状态变化（🔴→🟡→✅）。

### 5.2 新增方法论条款的「实战验证」门槛
任何新方法论条款（SKILL 规则 / 门禁 / 工作流步骤）合入前，必须回答：
- 这条条款**有对应的引擎强制**吗？（无则只是纸面）
- 这条条款**在真实任务中执行过**吗？（nanju/真实团队验证）
- 这条条款**有可观测的执行证据**吗？（tree-state 留痕）

三问任一为否 → 标记为「纸面」，不计入「已覆盖」。

### 5.3 「纸面门禁」标记机制
在 SKILL / 方法论文档里，对每个条款标注：
- `[刚性]` = 引擎强制 + 实战验证 + 可观测
- `[软约束]` = 仅 SKILL 协议，靠 agent 遵守
- `[纸面]` = 形式有，实战从未执行

让读者一眼区分「真门禁」与「纸面门禁」。

---

## 六、与 improvement-report 的联动

本审计的 6 条约束对应 improvement-report 的：
- P1-S03（ISS-003 done 不耦合内容审查）→ 约束 1
- P1-S04（auditor fallback）→ 约束 2
- P2-S02（5 件套未持久化 + milestone 未调用）→ 约束 3、4
- P2-S03（drift 留痕不一致）→ 约束 5
- P2-S04（ctx 全 0 竹节不触发）→ 约束 6

**修复优先级**：约束 1（接近激活，ISS-003 阶段二即闭环）> 约束 2（解锁 P0a 投入）> 约束 6（长任务核心）> 约束 4（崩溃恢复）> 约束 3/5（次要）。

---

## 七、诚实声明

本审计基于中期评价（07-04）+ 本轮基线建设的核实。**约束 3/4/6 的「仍纸面」判断基于代码审查（字段/调用缺失），未在最新版做端到端实战复测**。建议下次真实任务（如团队实例）后，用 tree-state 数据复核本表状态。
