# pro 实例运行时验证报告（macpaf tree）

> 日期：2026-07-28 21:30-21:40 GMT+8
> 验证目标：P0-1 caller 强制 + P0-2 HMAC 完整性在 **pro Electron 进程内多角色协作运行时**生效
> tree：macpaf（root GLM + commander DeepSeek + auditor MiniMax 异厂商，3 leaf）
> 区别于 `tests/verify-instance.cjs`（require engine 文件）：本验证在 pro 实例运行时（Electron 进程内 mcp__tree__* 工具）

---

## 一、部署 + 多角色协作（异厂商分工破锯齿智能）

| Leaf | Role | 厂商 | session | Status | 验证动作 |
|------|------|------|---------|--------|---------|
| macpaf-root | root | GLM-5.2 | a9221192 | active | tree_init + add leaf + audit_gate 信任锚背书 + 篡改测试 |
| macpaf-A1-commander | commander | DeepSeek-v4-pro | e7bfe8b3 | **done** ✅ | milestone M1 + event plan/brief_echo/done + deliverables + done |
| macpaf-Au-auditor | auditor | MiniMax-M3 | 2560e127 | **done** ✅ | brief_echo + 异厂商签 M1 + done（root 背书后）|

**异厂商分工**：root GLM 调度 / commander DeepSeek 执行 / auditor MiniMax 第三方独立签字（破 GLM↔DeepSeek 双向偏差）。

---

## 二、P0-1 运行时验证（caller 强制 + V10 全套闸门）

### CLI 兼容通道关闭实证
GLM root 首次误用缩写 `a9221192`（cwd 前缀）做 session_id，引擎接受但与 MCP wrapper 提取的真实完整 UUID 不等 → 后续 leaf_add 撞 **E_BORROWED_IDENTITY** + set_session 自救撞**防所有权劫持** → **双锁死锁，root 无法自救**（删空树 + 完整 UUID 重 init）。**正面佐证 P0-1 加固生效**。

### V10 全套闸门运行时实证
| 闸门 | 验证场景 | 结果 |
|------|---------|------|
| 闸门 A（caller===audit_session_id）| auditor 签 M1 | ✅ 2560e127 === 2560e127 |
| 闸门 B（auditor 独立）| MiniMax auditor vs commander.added_by(GLM root) | ✅ 异厂商独立 |
| V10-auditor-active | auditor 审 commander 前需 status=done | ✅ 撞 E_AUDITOR_NOT_INDEPENDENT 后补 done 通过 |
| schema 校验 | milestone 字段名 milestone_id→id | ✅ E_SCHEMA_INVALID |
| done 门禁 | deliverables 缺文件 | ✅ E_DELIVERABLE_MISSING |
| self_check 格式 | object→array | ✅ E_SELFCHECK_INVALID |
| audit_gate 闸门 | auditor audit_gate=required 拦 done | ✅ E_GATEKEEPER_REQUIRED（root 背书后解）|

---

## 三、P0-2 运行时验证（HMAC 签名链 + 篡改检测）

### HMAC 签名链运行时维护
- **每次 writeState 自动重签**：write_count=20（init + leaf + 多轮操作，每次自动签名）
- **字段 scope 精确**（设计实证）：
  - `macpaf-Au-auditor` mac 变化 `5eb3bdbd → 739e56d6`（audit_gate.verdict required→pass 是签名字段，触发重签）✅
  - `macpaf-root` mac 不变 `66d20931`（plan event **不在**签名字段 scope，符合设计——event 不签，只签关键状态字段）✅
- **tree_validate = 0 issues**（20 次 write 后 HMAC 链完整）

### 篡改检测运行时实测（D6-F2 闭合）
- **攻击手法**：Bash 直改 `macpaf-A1-commander.status: done→active`（绕过 writeState 签名，模拟 D6-F2 攻击者）
- **检测结果**：`tree_validate` 立即报 `E_STATE_INTEGRITY`
  ```
  tree-state.json integrity violation — tampered: leaf "macpaf-A1-commander"
  (scope: id|role|status|added_by|session_id|audit_gate.verdict|milestones[].audit_pass|audit_log)
  ```
  - 错误码 E_STATE_INTEGRITY ✅
  - msg 精确定位 leaf id ✅
  - msg 列出签名字段 scope ✅
- **恢复后**：tree_validate = 0 issues（备份恢复 + 清理临时文件）
- **结论**：readState 在 pro Electron 进程内运行时校验 HMAC，D6-F2「直接编辑 tree-state.json 改状态，引擎 validate 报 0 issues」的 P0 绕过口**已闭合**

---

## 四、新发现（后续 P2 增强，不阻塞）

1. **tree_init session_id 校验滞后**：leaf_add 严格 UUID 校验，但 tree_init 接受任意字符串（缩写 sid 被接受存为 root.session_id），与 MCP caller 完整 UUID 不等 → 后续操作撞 E_BORROWED_IDENTITY。**建议**：tree_init 加 UUID strict 校验（和 leaf_add 对齐）。
2. **root minimum activity guard**：root 背书他人（audit_gate）前需 events≥1（冷启动 root events 空撞 E_AUDITOR_NOT_INDEPENDENT）。**建议**：SKILL §13.3b 补"root 冷启动先发 plan event 才能背书"。
3. **HMAC 字段 scope 设计正确**：events 不在签名 scope（避免 event 追加触发全树重签），只签关键状态字段（status/audit_gate.verdict/milestones.audit_pass/audit_log）。运行时实证：event 追加不破坏其他 leaf mac。

---

## 五、结论

**P0-1（CLI 通道关闭 + caller 强制）+ P0-2（HMAC 完整性 + 篡改检测）在 pro Electron 进程内多角色协作运行时全部验证通过**。

- 实例：pro（Proma-green，D:/Proma-dev/ engine，md5 `6ae15f1f` = source）
- 多角色异厂商协作：root GLM + commander DeepSeek + auditor MiniMax
- 完整 done 闘环：commander + auditor done，tree_validate 0 issues
- D6-F1（CLI 绕过）+ D6-F2（tree-state 零校验）两个 P0 绕过口**在实例运行时已闭合**

**Co-Authored-By**: Claude `<noreply@anthropic.com>`
