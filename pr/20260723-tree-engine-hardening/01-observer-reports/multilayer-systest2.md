# 观察员报告：多层 commander 树检测（systest2）

> 观察员会话：pro/a277022f | 日期 2026-07-23 | 只读核验
> 核验对象：systest2（root→A-commander→A1-worker 三层）
> R=68f359f9(root/auditor) C=61316321(A-commander) W=8c4bd010(A1-worker)

## 核验项 1：tree-state 结构（tree_tree_dump）

| 子项 | 观察值 | 结论 |
|---|---|---|
| (a) 3 leaf + parent 链 | root(parent=null)/A-commander(parent=root)/A1-worker(parent=A-commander); path ""/"A"/"A1" | ✅ 链完整 |
| (b) A1-worker done+audit | status=done; audit_gate.verdict=pass, auditor=R | ✅ |
| (c) A-commander done+audit | status=done; audit_gate.verdict=pass, auditor=R | ✅ |
| (d) root status | status=done（曲折路径，见疑点①）| ✅ |
| (e) 所有 auditor=R | root.M1/A-cmd.M1+M2/A1.M1 + 3 audit_gate + 2 alignment 全 =R | ✅ 冷启动单一 auditor |

## 核验项 2：caller 身份语义（call-log 35 条）

caller_session_id 去重：R=23次 / C=7次 / W=4次 / 观察员=1次(只读) / null=4次(引擎内部)。
- leaf_add(A-commander) caller=R；leaf_add(A1-worker) caller=C（C 加自己的 worker）✅
- 全部 milestone_set_result/audit_gate/alignment caller=R（冷启动 root）✅
- A1-worker brief_echo/done caller=W；A-commander brief_echo/done caller=C ✅
- session 注册链：R 注册 C、C 注册 W（harness 三级委派真实）✅
- **无越权、无代调伪装**。W 从不碰 audit；C 只写自己 event+加 W；R 独占 audit 且 caller===auditor。

## 疑点① root status —— 双闸门机制（非 bug）

root.status=done（不是 active）。call-log 显示 root 闭合卡了一轮（47s）：
```
event done(root) ✅ → audit_gate auto_upgrade=pass ✅（review_required=false 自动放过）
set-status(done) ❌ E_SCHEMA_INVALID "milestones must be non-empty"
milestone-add(root, M1, expect_outputs=[report2.md]) ✅ → milestone-set-result ✅ → set-status(done) ✅
```
**根因**：引擎对 done 设两道独立硬闸门——①审计闸门（auto_upgrade 可放过）；②结构闸门（milestones 非空，auto_upgrade 绕不过）。root 走标准 API 自愈。**正确 DbC 强制，非 bug。**

## 疑点② A-commander 的 M1 —— 真·引擎缺口（靠文件手术）

A-commander 的 done **不是纯引擎 API 达成，靠了一次直接编辑 tree-state.json**。M1.expect_outputs 跨备份演变：
```
11:31 auto backup: [] 空
11:33 before-M1-fix backup: [] 仍空
当前态: ["report2.md"] 被填上
```
而 11:33 备份后 call-log 对 A-commander 只有 leaf-get(读)+set-status(成功)，**中间无任何 milestone-add/set-result/update** → M1.expect_outputs 从 [] 变 ["report2.md"] 只能是直接改文件。

完整事件链：
```
milestone-add(M1, expect_outputs=[])   ← 建空，引擎放行（V3 没校验非空！）
milestone-set-result(M1, audit_pass=true) ← 引擎放行（不校验空！）
set-status(done) → E_DELIVERABLE_MISSING ← 结构闸门拦
milestone-add(M1 重加) → E_DUPLICATE_LEAF ← 不能覆盖
加 M2 绕道 → 仍拦（结构闸门查"每个"milestone）
backup "before-M1-fix" → 直接改 tree-state.json 填 M1.expect_outputs → set-status(done) ✅
```

**根因（引擎设计缺口三连）**：
1. `milestone_add` 不强制 V3（expect_outputs 非空）——SKILL 规定非空但引擎没校验。
2. `milestone_set_result` 不校验空 expect_outputs——milestone 可 audit_pass=true 却结构非法（自相矛盾态）。
3. 无 milestone-update API + milestone_add(同id) 被 E_DUPLICATE_LEAF 拒——建空后引擎内无任何 API 能修，只能文件手术。

**附带安全隐患**：直接编辑 tree-state.json 能绕过所有 caller 身份闸门（E_BORROWED_IDENTITY 等）——引擎信任文件，任何有文件访问权的 agent 都能篡改。

## 总评

3 层 commander 树（root→A-commander→A1-worker）、harness 三级会话委派（R→C→W）、冷启动单一 auditor 均**真实跑通、无伪造、无越权**，最终 validate=ok、report2.md 真实落盘。但"3 层全跑通"有**一处诚实瑕疵需打星号**：A-commander 的 done 因 M1 建 empty expect_outputs 且引擎无 milestone-update 接口，**靠一次手动直接编辑 tree-state.json 才解开**。建议补 milestone-update 接口并让 milestone_set_result 拒绝空 expect_outputs + milestone_add 强制 V3，从根上消除文件手术。
