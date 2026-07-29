# macpaf 实战后续 — leaf 自动收尾 gap 调研 + 3 轮迭代计划

> 日期：2026-07-29
> 触发：macpaf pro 实战（2026-07-28 21:30-21:48）收尾时发现 leaf（root）不自动 done，需用户手工提示
> 关联：`pr/20260728-audit-fix/pro-instance-verification.md`（macpaf P0-1/P0-2 运行时验证）+ memory `leaf-auto-closeout-gap` / `audit-fix-resign-pass-flow`

---

## 一、macpaf 实战验证总结（已完成，详见 pro-instance-verification.md）

pro 实例（新 engine）多角色协作运行时验证 P0-1/P0-2：
- **3 leaf done**：root（GLM）+ commander（DeepSeek）+ auditor（MiniMax 异厂商）
- **P0-1 运行时**：CLI 兼容通道关闭（缩写 sid 撞 E_BORROWED_IDENTITY 双锁）+ V10 全套闸门（A/B/C + schema/deliverables/self_check/gatekeeper）
- **P0-2 运行时**：HMAC 签名链（20 次 write 后完整 + 字段 scope 精确）+ 篡改检测（E_STATE_INTEGRITY 实测）
- **D6-F1 + D6-F2 绕过口在实例运行时闭合**

---

## 二、leaf auto-closeout gap 调研（本次新发现）

### 现象
root 在子 leaf（commander @21:36 / auditor @21:32）全 done 后，自己 @21:40 完成篡改测试 task 后 **idle，没自动 done**。用户 @21:48 手工提示，root 才收尾（event done + set-status done, cascaded=[]）。

### 根因两层
1. **leaf 主动性不足（浅层）**：leaf 把单轮任务边界（"只做篡改测试"）当成整体边界，没主动对照 `root_dod.accept_criteria`（"三 leaf done"）补齐自己能闭环的部分。root 自反思记了 pro memory `root-dod-closeout-proactivity`。
2. **系统无依赖通知（深层）**：leaf 是独立 session，idle 后无主动操作；**tree 引擎在子 leaf done 时不给 parent 推事件**，parent 不知道子 leaf 已 done。无 `child_done` 事件机制 → 必须外部触发（父会话派 task / 用户手工）。

### 改进三层
| 层 | 措施 | 彻底度 |
|----|------|--------|
| 父会话调度 | macp 流程末尾显式派 root closeout | 兜底（依赖调度者记得）|
| leaf 主动性 | 每轮对照 `leaf_dod.accept_criteria` 主动补齐 | 中（依赖 leaf 自觉）|
| **引擎 child_done 事件** | leaf done 时给 parent 推事件 → parent 感知 → 主动收尾 | **根本解**（事件驱动替代被动等）|

---

## 三、macpaf 发现的其他 P2 候选

1. **tree_init session_id 校验滞后**：leaf_add 严格 UUID 校验，但 tree_init 接受任意字符串（GLM root 用缩写 `a9221192` 被接受存为 root.session_id），与 MCP caller 完整 UUID 不等 → 后续 leaf_add 撞 E_BORROWED_IDENTITY + set_session 防劫持双锁死锁。
2. **root minimum activity guard**：root 背书他人（audit_gate）前需 events≥1（冷启动 events 空撞 E_AUDITOR_NOT_INDEPENDENT），SKILL 未文档化。

---

## 四、3 轮迭代计划（本轮执行）

每轮闭环：design → 实施 → 验证（单测/实例）→ commit + push。

### 轮 1：child_done 事件机制（引擎 P2，根本解 leaf auto-closeout）
- **目标**：leaf `set-status done` 时，引擎自动给 `parent.added_by`（或 parent.session_id）写一条 `child_done` 事件，让 parent 感知依赖满足。
- **实施**：`tree-engine.cjs` `cmdLeafSetStatus` done 分支 + 新 `tree_event_append` 给 parent（type=child_done, meta={child_leaf, status}）。引擎层能写事件（event_append 已有），但**唤醒 parent session** 需平台层（引擎写事件到 parent 的 event 流，parent 下次被触发时看到 child_done → 主动收尾）。
- **验证**：单测（leaf done 后 parent events 含 child_done）+ 实例（macpaf2 tree 验证）。
- **风险**：引擎能否实时唤醒 parent session（可能只能写事件，非实时推）。若只能写事件，配合 SKILL 教化（parent 被唤醒时查 child_done 收尾）。

### 轮 2：tree_init session_id 校验对齐
- **目标**：tree_init 加 session_id UUID strict 校验（和 leaf_add 对齐），避免缩写 sid 存为 root.session_id。
- **实施**：`tree-engine.cjs` `cmdInit` 加 UUID 格式校验（不合规抛 E_NAME_INVALID 或 E_SCHEMA_INVALID）。
- **验证**：单测（缩写 sid 拒绝 / 完整 UUID 通过）。

### 轮 3：root activity guard + leaf 主动性 SKILL 教化
- **目标**：SKILL §13.3b 补"root 冷启动先发 plan event 才能背书"+ leaf 每轮对照 DoD 主动收尾。
- **实施**：`tree-commander/SKILL.md` §13.3b 补 root activity guard + 新增"leaf 主动性收尾"小节。
- **验证**：实例（macpaf3 验证 root 自动 plan + 主动 done）。

---

## 五、执行记录

（3 轮逐个执行，结果回填）

**Co-Authored-By**: Claude `<noreply@anthropic.com>`
