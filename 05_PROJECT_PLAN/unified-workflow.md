# 统一工作流（Unified Workflow）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（方法论补建）
> 配套：[../skills/tree-commander/SKILL.md](../skills/tree-commander/SKILL.md) §13 · [../skills/tree-worker/SKILL.md](../skills/tree-worker/SKILL.md) §2.5 · [../.context/reference/methodology/](../.context/reference/methodology/)

本文把分散在 commander SKILL §13 / worker SKILL §2.5 / tree-audit-methodology / DEVELOPMENT / TESTING 的工作流**串联成一份端到端流程**，并补上 SubAgent C 指出的**缺失环节：人类 checkpoint**（macp2/macp4 事故都是用户上线才发现，缺人类审查者角色）。

---

## 一、端到端工作流总览

```
① 建树 + 5 件套契约 ──→ ② Worker 生命周期 ──→ ③ 事件路由/纠偏
                                                      │
              ⑥ done 门禁（8 道）←── ⑤ 审计（auditor）←──┘
                      │
              ⑦ 归档/汇总 ← 人类 checkpoint（关键节点）
```

---

## 二、阶段详解

### ① 建树 + 下发 5 件套契约
- **调用**：`tree_init`（root）→ 下发 **5 件套**（brief / dod / expect_outputs / role / 收敛条件）
- **门禁**：root 唯一性 / node_budget / naming
- **产出**：root leaf + 5 件套（⚠️ 当前仅消息层流转，未持久化进 leaf schema，Sprint 2 补）
- **文档**：commander SKILL §13.1 / [team-config.md](../01_PRD/team-config.md)

### ② Worker 生命周期（9 阶段）
worker 从创建到 done 的完整生命周期：
1. leaf_add（commander 派，caller-binding 校验 caller=added_by）
2. status=`pending_brief`（初始）
3. **brief_echo**（worker 主动，对齐 brief → status 转 active）
4. 实现（worker 用进程内 Agent 工具做 G1-G5 自审，🚫禁 create_session）
5. review_round（收敛：red_count=0 或升级，轮≤3）
6. **done event**（worker 主动，附 self_check）
7. milestone_set_result（如有里程碑）
8. audit_gate（auditor 审查）
9. set-status done（owner/creator 放行）
- **文档**：worker SKILL §2.5 / commander SKILL §6

### ③ 事件路由 + 三档纠偏
- **事件类型**：done / blocked / plan / brief_echo / heartbeat_reply / nudge / limit / status_check
- **三档纠偏**（drift）：轻微（nudge）/ 中（direction drift）/ 重（status demote）
- **nudge 升级**：nudge_count ≥ 7 → E_LEAF_AUTO_PRUNED 强制 pruned
- **文档**：commander SKILL §7 / [ERROR-CODES.md](../ERROR-CODES.md)

### ④ 审计（§14 独立 auditor）
- **独立审计 leaf**：role=auditor，独立 session（P0a）
- **协议**：brief_echo + done + audit_gate（简化，无 milestone）
- **冷启动信任锚**：无可用 auditor session 时，root 自调当 auditor（闸门2）
- **铁律**：禁自审（E_BORROWED_IDENTITY）
- **文档**：commander SKILL §13.4 / §14 / [team-config.md](../01_PRD/team-config.md)
- ⚠️ gap：端到端 fallback 不可用（P1-S04，Sprint 5 修）

### ⑤ done 门禁（set-status 转 done，对齐引擎 cmdLeafSetStatus done 路径）
worker 声明 done（set-status done）前，引擎过 8 道门禁（对齐 tree-engine.cjs cmdLeafSetStatus done 路径 + 引擎自注释）：
1. milestones 非空 + 全 audit_pass
2. expect_outputs 非空 + 非空字符串
3. deliverables 存在 + 相对路径 + 非空 + 非 symlink（[A1] → E_DELIVERABLE_MISSING）
4. brief_echo + done 双事件存在（含 V5b alignment 前置）
5. review_round 收敛（E_REVIEW_NOT_CONVERGED / E_REVIEW_FORGERY）← ISS-003
6. audit_gate.verdict pass/skip
7. V10-status-event-sync：done event 存在（E_STATUS_EVENT_MISMATCH）
8. commander 子节点全 done（E_CHILDREN_NOT_DONE）

> 注：A7（E_AUDIT_PREMATURE）在 cmdAuditGate 路径、V6（E_SELFCHECK_INVALID）在 cmdEventAppend 路径，**非 set-status done 门禁**；caller-binding 适用于所有 status 变更，非 done 独占。
> **文档**：tree-engine.cjs cmdLeafSetStatus done 路径 + [ERROR-CODES.md](../ERROR-CODES.md)（以引擎为准，行号随版本变，引用函数名而非硬编码行号）

### ⑥ 归档/汇总
- root 汇总所有 worker 产出
- 归档完成的 leaf（root 特权：active→archived 跳过 done/validate，P3-S04）
- **文档**：commander SKILL §10

---

## 三、🟡 人类 Checkpoint（建议方案，待排期 — SubAgent C gap）

> ⚠️ **状态声明（2026-07-11 审计修正）**：本节是**设计建议**，**尚未落地**（无引擎字段 / 无 SKILL 指令 / 无 Sprint 承接）。macp2/macp4 都是用户上线后发现——本节定义了应有的介入点，但落地需排期（建议 Sprint 2.5 或独立项）——**暂无 Sprint 承接**（sprint-plan 未列入，待补）。

**问题**：macp2（207 会话爆炸）/ macp4（auditor 假阳性）都是**用户上线后才发现**，tree-system 内无人类介入点。tree-system 把纪律交给代码，但**最终质量责任仍在人类**——需要定义人类何时介入。

### 人类审查者角色定义
| 节点 | 人类动作 | 触发条件 | 防什么 |
|---|---|---|---|
| **建树前** | 审 5 件套契约（brief/dod/expect_outputs 合理） | tree_init 后、worker 派发前 | 任务拆解错误 / 期望产出模糊 |
| **关键 done 前** | 抽检关键 worker 产出（非全检） | 标记为「人工验收」的 expect_outputs | agent 伪完成蒙混（ISS-003）|
| **审计争议时** | 仲裁 auditor 与 worker 分歧 | audit_gate verdict 争议 | auditor 假阳性 / worker 假收敛 |
| **事故/异常时** | 复盘 + 决策（如 macp2 型爆炸） | 反指标触发（成本爆炸/安全失守） | 同类事故复发 |
| **上线前** | 最终验收 | tree 整体 done 前 | 整体质量把关 |

### 实现机制（建议）
- tree-state 加 `human_checkpoint` 字段：标记需人类确认的节点
- SKILL 教 commander「遇到 human_checkpoint 节点，停下等人类」
- 与 methodology-coverage-audit 联动：human_checkpoint 是「纸面门禁」的兜底（纸面门禁靠人类补）

### 与 nanju 模板对照
nanju workflow §2.3 明确「第二阶段人机交互评审，只有人类有权将状态从待审改为已确认」。tree-harness 当前**缺这一环**——本节补齐。

---

## 四、工作流文档分布索引

端到端流程散在多文档，下表指明各段详细在哪：

| 阶段 | 详细文档 |
|---|---|
| 建树 + 契约 | commander SKILL §13.1 / [team-config.md](../01_PRD/team-config.md) |
| Worker 生命周期 | worker SKILL §2.5 / commander SKILL §6 |
| 事件路由 | commander SKILL §6 |
| 三档纠偏 | commander SKILL §7 |
| 审计 | commander SKILL §13.4 / §14 / [team-config.md](../01_PRD/team-config.md) |
| done 门禁 | ARCHITECTURE §7 / [ERROR-CODES.md](../ERROR-CODES.md) |
| 灾难恢复 | commander SKILL §10 / §F1-F4 |
| 测试评审 | tree-audit-methodology / [methodology-coverage-audit.md](./methodology-coverage-audit.md) |
| 预算护栏 | [cost-guardrails.md](../01_PRD/cost-guardrails.md) |

---

## 五、灾难恢复（workflow 视角 R1-R4，区别于 commander SKILL §10 的 F1-F4）

> 编号说明：本节用 **R1-R4**（workflow 恢复），避免与 [commander SKILL §10 的 F1-F4](../skills/tree-commander/SKILL.md)（子会话崩溃/根崩溃/tree-state损坏/配额耗尽）冲突。两套编号指代不同，勿混。

| 场景 | 恢复动作 |
|---|---|
| R1 根崩溃 | tree_backup → tree_restore（V1 拒不合规备份） |
| R2 5 件套丢失 | ⚠️ 当前未持久化（约束 4），靠消息历史重建；Sprint 2 补持久化（design-commander-spawn）|
| R3 worker 卡死 | root 归档 + 重派（P1-S04 fallback 同理） |
| R4 tree-state 损坏 | tree_validate + 手动修复 / restore |

---

## 六、与现有文档的关系

本文是**工作流的索引与串联**，不替代各 SKILL/方法论文档的细节。读本文知全貌，需细节跳转对应文档。

**未来**：理想状态是把分散的工作流收敛进本文 + SKILL，消除「6+ 文档拼凑」的认知负担。但当前以「索引 + 补人类 checkpoint」为第一步，全面收敛留待后续。
