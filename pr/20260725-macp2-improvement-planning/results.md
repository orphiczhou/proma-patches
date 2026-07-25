# macp2 方案 A 改进 — 实施与审计结果（收敛）

> 日期：2026-07-25 | 基于 06_TESTS/macp2-tree-evaluation-2026-07-25.md + 3 论证子会话
> 方案：A（proma 轻量改造）—— 用户选定

## 0. TL;DR

基于 macp2 评估（条件 PASS，核心仅形式达标）+ 3 论证子会话（引擎/SKILL/项目），方案 A 执行：
- **引擎 10 行**（P0-B + P2-A）
- **SKILL ~37 行**（P1-C + P1-A + P0-A 流程）
- 审计 **7 维度全 PASS**，9/9 单测，dev/pro 部署生效

## 1. 引擎改动（tree-engine.cjs）

### P0-B：tree_init 绑 callerSessionId（消 PENDING_ROOT 死锁）
- `cmdInit(args)` → `cmdInit(args, callerSessionId)`（L739）
- rootSessionId 优先级：`--session-id → callerSessionId → PROMA_SESSION_ID → PENDING_ROOT`（L825）
- dispatch init case 透传 callerSessionId（L5273）
- 向后兼容：CLI/金标准不传 caller → undefined → 退化原三级逻辑

### P2-A：tree_id prefix 校验前置
- `cmdInit` 复用 `PREFIX_RE`（L756）校验 tree_id（L763）
- 前置拦截含连字符（`oeval-macp2`）/超长（>8 字符），消"init 通过 → leaf_add 才炸"不一致

## 2. SKILL 改动（tree-commander v2.9.2 + tree-worker v2.6）

### P1-C：set-status caller=owner 讲透（4 处，覆盖 3 根因）
1. tree-commander §3.4 autonomy 加 `final_step`（worker 收 brief 第一条消息即看到）
2. tree-commander §13.3 八步末尾警示（步骤 7 worker 自己调）
3. tree-worker §1 铁律新增 #10（set-status 必须 worker 自己调，E_BORROWED_IDENTITY）
4. tree-worker §2.5 lifecycle 阶段 8→9 醒目衔接（audit_gate pass = set-status 信号，不等通知）

### P1-A：comm_log 硬 checklist（3 处，macp2 ~10% 漏记触发升级）
1. tree-commander §4 Step3：【必须】send_message 后紧接 tree_log_communication
2. tree-commander §11 新增 #15（漏记 comm_log 违规）
3. tree-commander §6 措辞：v2.9 advisory → mandatory

### P0-A 流程：建 auditor leaf 协议（§13.4.0，~28 行，引擎零改动）
- 四步：root fork role=auditor leaf → auditor 自己 done → root 闸门2 背书 audit_gate pass → auditor 闸门3 给全树配门禁
- 教 commander 建独立 auditor（macp2 audit 全回流 root 的根因是 commander 不知道建 auditor）

### 附加修复
- tree-worker §11 旧 v2.6 标签 bug（§0 v2.5 但 §11 有 v2.6 条目）→ 更正为 v2.5.1

## 3. 部署

| 目标 | 状态 |
|------|------|
| tree-engine.cjs source | node --check OK |
| dist/tree-engine.cjs（dev/pro 共享）| cp + node --check + diff identical |
| tree-commander v2.9.2（release + pro）| cp + diff identical |
| tree-worker v2.6（release + pro）| cp + diff identical |
| dev/pro 实例 | restart-{dev,pro}.ps1 LAUNCHED |

## 4. 单测（test-pa-engine.cjs，9/9 PASS）

```
[P0-B] 绑 callerSessionId → root session 绑定（非 PENDING_ROOT）   PASS
[P0-B 回退] 无 caller → PENDING_ROOT（CLI 兼容）                    PASS
[P0-B 优先级] --session-id 优先于 caller                            PASS
[P2-A] tree_id 含连字符 → E_NAME_INVALID                           PASS
[P2-A] tree_id 超长 → E_NAME_INVALID                                PASS
[P2-A] tree_id 合法（macp2）→ 通过                                 PASS
=== 9 passed, 0 failed ===
```

## 5. 独立审计（7c6d17c6）— VERDICT: PASS

7 维度全 PASS（无 PARTIAL/FAIL）：
- 引擎 P0-B ✅（优先级链正确，向后兼容）
- 引擎 P2-A ✅（前置拦截准确，无破坏性，已知活跃树 macp/macp2/nanju/sweng 不受影响）
- SKILL P1-C ✅（4 处覆盖 3 根因：邻接混淆/不在 brief/铁律缺失）
- SKILL P1-A ✅（三层约束：check→违规条目→强制力）
- SKILL P0-A ✅（四步协议，引擎零改动声明准确）
- Version 一致 ✅（2.9.2 + 2.6，旧 bug 修复）
- 部署完整 ✅（dist + pro + 9/9 单测）

## 6. 后续（未做，方案 A 范围外）

- **P1-B progress 强制**：纯 SKILL 层效果有限（v2.8 advisory 已被 macp2 3/5 worker 忽略），建议下轮加引擎 `W_NO_PROGRESS` warning（done 门禁不拦死）。审计备注：可观察下轮 macp 效果后决定。
- **P0-C coder/judge 接 LLM**（项目，1500-1900 行，7-10 天）：下 Sprint
- **P0-D 多模型交叉 + peer audit**：第 3 批（引擎 P0-A 配合 + SKILL + 项目模板）
- **P1-D 错误码重命名**：关闭（api-spec v0.4 有意设计决策）

## 7. 交付物

- `D:/Codes/tree-harness/tree-engine.cjs`（P0-B + P2-A）
- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.9.2）
- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-worker/SKILL.md`（v2.6）
- `D:/Codes/tree-harness/pr/20260725-macp2-improvement-planning/`（summary + engine/skill/project-evaluation + skill-implementation + test-pa-engine + results）
