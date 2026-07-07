# 观察报告：完整 §13 验证测试（三方对比）

**观察时间**: 2026-07-07 20:31-20:37 GMT+8
**观察对象**: pro commander `b5ff5c0c-dcc5-4357-bf8b-406ff852189a`（"完整§13验证 commander"）
**测试树**: `vpro1`（2 leaves: root + 1 worker）
**观察员**: pro 实例（本会话）

---

## 一、三方错误对比表

| 错误码 | macp-stab (旧SKILL+旧help) | cleanroom (旧SKILL+新help) | 本次 (完整§13+新help) | §13 消除效果 |
|--------|--------------------------|--------------------------|----------------------|-------------|
| `E_SCHEMA_INVALID` (path) | 多次 | 多次 | **1** | §4 Step2 leaf_add 文档的 path 参数说明不够精确 |
| `E_BORROWED_IDENTITY` | 多次 | 多次 | **0** | §13.0 caller 术语 + §13.3 caller 标注列 消除 |
| `E_ALIGNMENT_NOT_VERIFIED` | 多次 | 多次 | **0** | §13.3 步骤4 前置条件表 消除 |
| `E_GATEKEEPER_REQUIRED` | 多次 | 多次 | **0** | §13.3 步骤6→7 顺序 + §13.7 速查表 消除 |
| `E_NAME_INVALID` | 有 | 有 | **0** | §12 完整正负例 + help naming_convention 消除 |
| `E_AUDIT_PREMATURE` | 有 | 有 | **0** | §13.3 步骤5→6 顺序（done event 先于 audit_gate）消除 |
| `E_SELFCHECK_INVALID` | 有 | 有 | **0** | §13.3 步骤5 self_check schema 消除 |
| `E_DELIVERABLE_MISSING` | 有 | 有 | **0** | §13.3 步骤1 expect_outputs + 步骤7 前置约束 消除 |
| `E_DUPLICATE_SESSION_ID` | 有 | 有 | **0** | §13.7 速查表 消除 |
| 冷启动死锁（Fork 独立 auditor） | 有 | 有 | **0** | §13.2 "绝不要 fork 独立 auditor leaf" 红字警告 消除 |

| **总计** | **~24** | **~15** | **1** | **93% vs cleanroom, 96% vs macp-stab** |

---

## 二、完整 §13 效果评估（vs cleanroom 增量价值）

### 2.1 §13.3 步骤前置条件表 — 最大增量贡献

cleanroom 没有 §13.3 表，commander 每次从头推理调用顺序和 caller 归属，频繁触发 `E_BORROWED_IDENTITY`、`E_GATEKEEPER_REQUIRED`、`E_ALIGNMENT_NOT_VERIFIED`。

本次 commander 在 index 28-70 的消息中，严格按照 §13.3 八步（0→1→2→3→4→5→6→7）执行，每一步的 caller（root/worker）和前置条件都从表里查到，**零协议级错误**：
- 步骤0: root 写 plan event → root.events 非空（闸门2 前置）
- 步骤1: milestone_add（root 调）→ OK
- 步骤2: milestone_set_result audit_pass=true, audit_session_id=root → 闸门2 放行
- 步骤3: worker 发送 brief_echo → OK
- 步骤4: root 回填 alignment brief_echo, auditor_session_id=root → OK
- 步骤5: worker 写 done event (caller=worker) → self_check 3/3 pass
- 步骤6: root 调 audit_gate pass, caller===audit_session_id → OK
- 步骤7: worker 调 set-status done → OK

### 2.2 §13.7 错误码速查表 — 本次未触发但质量防护到位

因只有 1 次错误，速查表未大规模使用。但 commander 遇到 `E_SCHEMA_INVALID` 后快速定位为 path 格式问题并重试，说明"撞错即翻"的思维模型已建立。

### 2.3 §13.2 冷启动 auditor=root — 彻底消除死锁

cleanroom 曾尝试 fork 独立 auditor leaf 导致冷启动死锁。本次 commander 完全遵循 §13.2 红线，所有 `auditor_session_id` 一律填 `root.session_id`，零死锁。

### 2.4 §13.0 前置术语（caller/V10-auditor-active）— 理解正确

Commander 正确理解 caller=root 和 caller=worker 的边界：自己调了所有 root 步骤，通过 `send_message` 让 worker 调了 worker 步骤（步骤3 brief_echo、步骤5 done、步骤7 set-status done），**零 E_BORROWED_IDENTITY**。

---

## 三、§13 被读取使用确认

- **确认时间**: 20:32 CST（commander message index 14）
- **确认文本**: "已读取 SKILL §13 完整流程、help topics 和 test-plan.md。现在开始执行。"
- **文件路径**: `~/.proma-dev/agent-workspaces/default/skills/tree-commander/SKILL.md`
- **文件版本**: 标注 v2.2，实际含 v2.3 内容（ISS-003 + §13 完整 + §14 审计工作流）
- **§13 子节完整度**: §13.0-§13.7 全部存在，含 §13.3 步骤前置条件表和 §13.7 错误码速查表
- **§2.5 状态**: **不存在** — 用户任务指令提到"§2.5"但 SKILL §2 只有 3 条前置检查（工具可用/列树/validate），无 §2.5 子节。建议补充或从任务指令中移除引用。

---

## 四、Cleanroom 4 个新问题检查

### 4.1 path 格式 — 唯一残留错误
Commander 第一次 `leaf_add` 将 `path` 填为完整 `leaf_id`（"vpro1-A1-worker"）而非路径段（"A1"），触发 `E_SCHEMA_INVALID`。修正后通过。**根因**: SKILL §4 Step2 的 leaf_add 模板注释 `path: "<prefix>-root → ... → <本 leaf_id>"` 容易让人误填完整 leaf_id。建议改为 `path: "A1"  # 路径段，非完整 leaf_id（引擎自动解析）`。

### 4.2 milestone audit_session_id — 无问题
Commander 在 `milestone_set_result` 中正确填入 `audit_session_id=root.session_id`（冷启动期，闸门2），无 `E_BORROWED_IDENTITY`。

### 4.3 tree_id 命名 — 无问题
使用 `vpro1`（4 字符、小写字母开头、无连字符），符合 naming_convention 规范。

### 4.4 tao-watcher 小任务 — 2 条 audit 标记但非 commander 失误
worker leaf 的 `nudge_log` 和 `audit_log` 中各 2 条记录（W-01: brief_echo 延迟, W-08: leaf purity），但这些是 tao-watcher 自动脚本在 fork 阶段检测到的：
- W-01：worker 首条 assistant 消息是 fork 身份确认（"我已确认 fork 身份..."），非任务 brief_echo。`send_message=true` 已触发通知。
- W-08：worker 按 commander 指令调用 `tree_event_append` 和 `tree_leaf_set_status`（这是协议要求，caller=worker 必须 worker 自己调），属于预期行为。

**这 2 条是 tao-watcher 的正常工作**（自动检测并记录），非 commander 的 try-and-fix 错误，不影响 worker done 流程。

---

## 五、新发现

### 5.1 预估 ~8 过于保守 — 实际仅 1
完整 §13 的增量效果远超预期。仅 §13.3 前置条件表一项就消除了 cleanroom 中大量的顺序错、caller 错、门禁漏等问题（~14→1）。

### 5.2 唯一剩余错误根因在 §4 Step2 文档
`leaf_add` path 参数说明的歧义性导致了唯一的 `E_SCHEMA_INVALID`。不是 §13 覆盖范围的问题，而是 §4 模板的措辞问题。

### 5.3 树创建在 .proma-dev 工作区
Commander 使用 `.proma-dev` 工作区下的 SKILL，因此 tree 数据写入 `C:\Users\sir_c\.proma-dev\agent-workspaces\default\.context\trees\vpro1\`，而非 `.proma-pro`。这确保了测试隔离（不与之前的 macp-stab/cleanroom 数据混在一起）。

### 5.4 Worker 执行零错误
Worker (session `c7813629`) 严格按 tree-worker SKILL 三步（brief_echo → 干活 → done event）执行，自检 3/3 pass，产出 90 行 3KB 评估报告，无 try-and-fix。

### 5.5 执行效率
- Commander 总耗时: 310,441ms (~5.2 分钟)
- Worker 总耗时: 67,870ms (~1.1 分钟) + set-status 约 7s
- 全程耗时: ~3.5 分钟（commander + worker 并行部分重叠）
- tree_validate: 0 issues

---

## 六、下一轮建议

1. **修复 §4 Step2 path 文档歧义**: 将 `path: "<prefix>-root → ... → <本 leaf_id>"` 改为 `path: "A1"  # 路径段，与 leaf_id 的 path 部分一致，不是完整 leaf_id`。可消除最后 1 个错误。

2. **补充 §2.5 或更新任务指令**: 当前 SKILL §2 无 §2.5 子节。如果确实需要新增 §2.5 前置检查项，应在 SKILL 中补充；否则更新 verify 测试的任务指令移除引用。

3. **tao-watcher W-01/W-08 规则优化**: fork 身份确认阶段的首条消息不应被 W-01 检测（worker 尚未收到任务）；W-08 对 worker 直接调 tree 写工具的检测需要区分"commander 指令下的合法调用"vs"worker 越权调用"。

4. **多 worker 场景验证**: 本次仅 1 个 worker。建议下一轮测试包含 2+ worker 并行，验证 §13.4（转正常期）和闸门2→3 切换的机制。

5. **review_required=true 场景**: 本次 `audit_meta.review_required=false`。建议下一轮开启 ISS-003 opt-in，验证 review_round event 流程和 commander 抽查 findings 真实性的路径。

---

## 七、结论

**完整 §13（§13.0-§13.7 + §13.3 前置条件表 + §13.7 速查表）将 try-and-fix 错误从 cleanroom 的 15 次降至 1 次（93% 降幅），远超预估的 ~8 次。** 唯一残留错误是 §4 Step2 的 path 参数文档歧义，非 §13 覆盖范围问题。§13 的成功关键在于 §13.3 步骤前置条件表（caller 列 + 前置条件列 + 漏做触发列）一次性消除了协议级最常见的 10+ 类错误码。
