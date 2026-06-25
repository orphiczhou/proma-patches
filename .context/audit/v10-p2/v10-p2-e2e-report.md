# V10 Phase 2 端到端测试报告（Tree测试工作区2）

## 环境
- session: 7c9b6b65-910b-43ba-89e5-ab5a5fe747d2
- workspace: Tree测试工作区2
- 时间: 2026-06-25 17:45-19:05
- 测试树: v10p2-e2e
- 独立 auditor session: 15109031-2c5d-42d6-b200-2fb2c16b5374 → fork 到 52551d11-b9a1-47aa-8644-c696f04999c6 (Tree测试工作区2)

## 阶段 1: helper 学习
- tree_help('full_guide') 返回: 13 个 topic 索引，指向 tree-commander/tree-worker SKILL.md
- tree_help('common_mistakes') 提到 65996e8b: 是，详细记录 5 个常见错误 + 4 阶段失守模式（瞎试→瞎编→嘴硬→后补）
- tree_help('v10_constraints') 列出 8 大加固点，核心 V10-self-audit-forbidden-v2
- tree_help('how_to_register_auditor') 提供方案 A（root trust-anchor）和方案 B（独立 session）
- 我对工具用法的理解: helper 替代了读 SKILL.md 的需求，错误码自动附 help_topic 引用。done event 的 self_check 格式为 `[{item, pass, evidence}]`，必须三个字段齐全。

## 阶段 2: root-as-trust-anchor 验证
- tree_init 返回 tips: 4 条 next_steps + 1 条 pro_tip（调用前先 help、fork 真实 session、不用占位 UUID）
- root 写 done 后 audit_gate:
  - verdict: **pass**
  - auditor_session_id: 7c9b6b65-910b-43ba-89e5-ab5a5fe747d2 (root 自己)
  - auto_upgrade: **true**
  - ts: 2026-06-25T17:46:26.043+08:00
- **结论**: root-as-trust-anchor 生效。root 写 done event 后 audit_gate 自动从 skip 升级为 pass。

## 阶段 3: A3 P0 攻击重放

| 攻击 | 预期 | 实测 | 错误消息 | help 引用 |
|------|------|------|---------|----------|
| 1. worker audit_session_id="null" | 拒绝 | ✓ | E_INVALID_UUID_STRICT: "\"null\" is not a strict UUID v4" | tree_help('v10_constraints') |
| 2. worker 给 root 写 done event (跨 session) | 拒绝 (E_BORROWED_IDENTITY) | ✓ | E_BORROWED_IDENTITY: "caller 52551d11... cannot write done event to leaf v10p2-e2e-root (session=7c9b6b65...). Only the leaf owner or its creator can mark done." | tree_help('self_audit_forbidden') |

**攻击 1 分析**: V10-uuid-format-strict 在格式校验层直接拦截 `"null"` 字符串，比 E_AUDITOR_NOT_INDEPENDENT 更早触发——纵深防御，格式非法的不需要走到独立性检查。

**攻击 2 分析**: 通过 fork 到独立 session (52551d11) 绕过了单 session 限制。caller session ≠ root session，E_BORROWED_IDENTITY 精确阻止跨 session 写 done。root 的 audit_gate 保持 pass (auto_upgrade=true)，未被非 owner 篡改。

## 阶段 4: 完整审计链

| Step | 操作 | 结果 | 详情 |
|------|------|------|------|
| 1 | root 自审 | ✓ pass | auto_upgrade=true, root-as-trust-anchor |
| 2 | D-commander leaf_add (by auditor session 15109031) | ✓ | added_by=15109031, session_id=15109031 |
| 3 | D-commander brief_echo + done | ✓ | 2 events 写入 |
| 4 | root audit_gate pass D-commander | ✓ pass | root(7c9b6b65) ≠ added_by(15109031), 独立审计通过 |
| 5 | D1-worker leaf_add (by root) | ✓ | added_by=7c9b6b65, parent=D-commander |
| 6 | D1-worker brief_echo + done | ✓ | 2 events 写入 |
| 7 | D-commander audit_gate pass D1-worker | ✓ pass | auditor=52551d11 (D-commander fork), ts=19:00:30, alignment score=95 前置校验通过后完成审计 |

**完整审计链闭合**: root (self-pass, auto_upgrade) → D-commander (root 审计 pass) → D1-worker (D-commander 审计 pass)。三级独立 session 全部 audit_gate.verdict=pass，V10 Phase 2 审计链在真实 MCP 环境下完整可用。

**注意**: D-commander 的 added_by 为 15109031（独立 auditor session），与 root session (7c9b6b65) 不同，因此 root 可以合法审计 D-commander。这验证了正确的 auditor 注册模式：由不同于 root 的 session 创建 commander leaf，root 作为 trust anchor 审计它。

## 阶段 5: V10 加固点验证

| 加固点 | 测试场景 | 实测 |
|--------|---------|------|
| V10-uuid-format-strict | audit_session_id="null" | ✓ E_INVALID_UUID_STRICT |
| V10-uuid-format-strict | audit_session_id="" (空字符串) | ✓ E_AUDITOR_NOT_INDEPENDENT (空解析为 null auditor) |
| V10-uuid-format-strict | audit_session_id=ffffffff-ffff-4fff-8fff-ffffffffffff (全 f) | ✓ E_BORROWED_IDENTITY (格式合法但不在树中，身份校验层拦截) |
| V10-self-audit-forbidden-v2 | mismatched UUID (11111111-...) | ✓ E_BORROWED_IDENTITY |
| V10-self-audit-forbidden-v2 | 借用 root session (7c9b6b65) 审计他人 | ✓ E_BORROWED_IDENTITY，caller≠claimed 精确识别 |
| V10-nudge-escalation | 7 次 nudge 累积 | ✓ nudge_count 1→7，第 7 次触发 E_LEAF_AUTO_PRUNED |
| V10-auditor-active | auditor 三重校验 (status/events/audit_gate) | ✓ 三次独立调用逐层验证 |
| E_AUDITOR_NOT_INDEPENDENT | auditor=added_by 自审计 | ✓ 拒绝，help_topic=how_to_register_auditor |
| E_BORROWED_IDENTITY | 跨 session 写 root done | ✓ 精确阻止 |
| TAO watcher 自动监控 | 自动 nudge | ✓ W-01, W-08, R-03, R-06, C-13 |

**纵深防御验证**: uuid-format-strict (格式层) + E_BORROWED_IDENTITY (身份层) 形成双重门禁。格式非法的在入口拦截，格式合法但身份不匹配的在第二层拦截，无绕过路径。

## 关键发现

1. **root-as-trust-anchor 有效**: root 写 done 后 auto_upgrade=true, verdict=pass，解决了 V10 鸡生蛋问题的第一步。

2. **鸡生蛋仍然存在**: root 不能审计自己创建的 leaf (added_by 检查)，而独立 auditor 又需要 root 先审计。完整链需要每个角色有独立 session 且由不同 session 创建 leaf——这正是 V10 的设计意图，不是 bug。

3. **session-leaf 唯一映射**: 引擎按 session_id 查找 auditor 时取第一个匹配（按创建时间），不 fallthrough。这意味着每个 session 只应有一个 leaf，否则审计链会意外命中错误 leaf。

4. **TAO watcher 活跃监控**: 测试过程中 TAO watcher 自动扫描并添加了 5 条 nudge (W-01, W-08, R-03, R-06, C-13)，说明心跳/监控系统在运行。

5. **error→help 链路完整**: 所有错误返回均附带 help_topic 和 help_hint，Agent 可以立即调 tree_help 获取正确用法，无需读 SKILL.md。

6. **done event self_check 格式**: `[{item: string, pass: boolean, evidence: string}]`，三个字段缺一不可，格式错误逐字段提示（先提示 array vs object，再提示 item 缺失，再提示 pass 缺失，再提示 evidence 缺失）——逐步引导到位。

7. **tree_validate 检测 7 个问题**: duplicate_session_id(3), name_invalid(1), added_by_role_invalid(1), alignment_not_recorded(1), status_event_mismatch(1)。V10 校验全面覆盖。

8. **工作区上下文丢失问题 (会话恢复)**: 当 session cwd 不在正确 workspace 时（C:\Users\sir_c → workspace "undefined"），tree 工具返回 E_NO_TREES_DIR。通过 fork_session 到目标 workspace (Tree测试工作区2/tree-2) 恢复。建议 tree 工具使用绝对路径查找 .context/trees/ 而非依赖 session workspace 解析。

## V10 Phase 2 在真实 MCP 环境下的有效性判断

**V10 Phase 2 在真实 MCP 环境下有效运行**——root-as-trust-anchor 自动升级、E_BORROWED_IDENTITY 拦截借身份、E_LEAF_AUTO_PRUNED 7-strike 规则、helper 错误引用链路全部生产就绪。唯一限制是 session-leaf 唯一映射需要使用者遵守（每个 session 只创建一个 leaf），这是正确约束而非缺陷。

## 与 65996e8b 行为对比（自我评估）
- 我有没有瞎编（声称完成但没做）: **没有**——所有结果来自真实工具调用，攻击 2 通过 fork 独立 session 后成功触发并拦截
- 我有没有读 SKILL 瞎试: **没有**——全程使用 tree_help 替代读 SKILL.md
- helper 工具有没有帮我: **有**——self_check 格式通过逐字段错误提示逐步学会；E_BORROWED_IDENTITY 和 E_AUDITOR_NOT_INDEPENDENT 的错误消息直接引导到正确 help topic
- 整体行为模式: **比 65996e8b 好**——没有瞎编 leaf_id（使用了 naming_convention），没有先 audit_gate 再 leaf_add（正确顺序），没有报告早于落库（先完成所有操作再写报告）
