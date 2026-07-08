# Tree Harness 硬约束效率优化 — 交付报告（2026-07-08）

> 基于 handoff-harness-improvement-2026-07-08.md + 调研报告实施。P0a + P0b + P1b 落地，多轮审计收敛，全量测试 90/90 绿，已部署 Pro。

## 一、改动总览

| 优先级 | 改动 | 状态 | 测试 |
|--------|------|------|------|
| **P0a** | 引入 auditor role（engine + SKILL + migrate + help） | ✅ 完成 | auditor-role-test 20/20 |
| **P0b** | TaoWatcher 收窄（tao-rules 删 6 条 + patches.cjs 2 份 + engine 白名单） | ✅ 完成 | 基线不破 30/19/13 |
| **P1b** | self_check fix_evidence（review_round finding_id + done red_findings_resolved） | ✅ 完成 | p1b-fix-evidence-test 8/8 |
| 审计 | P0a 3 路并行审计 + P0b/P1b 自检 | ✅ 收敛 | 全量 90/90 |

## 二、P0a — 引入 auditor role（基石）

### 根因
V4 独立门在 auditor role 缺位时硬启动 → agent 用 commander/worker 假装 auditor → macp4 撞 15 次 E_AUDITOR_NOT_INDEPENDENT + macp4-A4 用 commander 假装触发 C-13/R-03 假阳性 24-38 条。

### 关键设计决策
**resolveAuditorIndep 不改** —— 现有 root trust anchor（行 2432-2446：root 可担任任意非 root leaf 的 auditor）天然支持 root 给 auditor leaf 背书 audit_gate=pass；通用路径（行 2467-2490）支持上级 auditor 背书下级。auditor 自审被行 2478 拦。→ engine 改动从报告估的 500-700 行降到 ~120 行。

### engine 改动（D:/codes/tree-harness/tree-engine.cjs）
1. ROLE_ENUM 加 'auditor'（行 84）
2. cmdLeafAdd audit_gate verdict：auditor='required'（行 1041，不能自审）
3. cmdLeafSetStatus done 门禁：`if(!isAuditor)` 包裹 milestone/expect_outputs/deliverables + brief_echo+done 扩展到 auditor（简化协议）
4. collectValidateIssues HARDEN6：加 auditor 到 context overflow
5. cmdInit state.version 1.0→1.1
6. cmdMigrate 规则 5 audit_gate verdict 补 auditor + 规则 12 version 升级
7. **审计 P1 修复**：auditor 叶子节点约束 —— cmdLeafAdd 行 980（parent）+ 行 930（added_by）+ collectValidateIssues 行 2657 三处加 `|| role === 'auditor'`（auditor 同 worker 不能当 parent/operator）
8. help topic：role_semantics + how_to_register_auditor 重写为 P0a 方案 + naming_convention 加 auditor

### SKILL 改动
- commander §13.4 重写（auditor 创建流程 6 步 + 简化协议 + 担任他人 auditor + root 信任锚兜底）
- commander §13.2 改"绝不要让 auditor 自审"（原"绝不要 fork 独立 auditor leaf"）
- commander §14.2 加"审查 leaf 用 role=auditor"（防 macp4 重蹈）
- worker §10 全章改 role=auditor（开头/§10.2/§10.3/§10.4 done 格式去 milestone）

### 测试（auditor-role-test.cjs 20/20）
1. auditor 创建（verdict=required）2. done 简化协议（无 milestone）3. 缺 done event→E_SCHEMA_INVALID 4. root 背书 5. 自审被拒 6. auditor→auditor 链 7. auditor 背书 worker 8. migrate version 9. auditor 当 parent 被拒 10. auditor 当 added_by 被拒

## 三、P0b — TaoWatcher 收窄

### 根因
TaoWatcher 在 auditor 错配场景零价值 + 假阳性噪音（macp4-A4：24-38 假阳性 nudge + 29-43 噪音 audit_log）。

### 改动
- **tao-rules.json**：删 6 条高噪音语义规则（C-13/C-15/R-03/R-06/W-10/W-13），35→29 条。保留 stall(W-09)/消息长度(W-11)/上行类型(W-12)等低成本规则
- **patches.cjs 2 份**（根 + release/patch-l，含 tao-watcher）：
  - checkAllRules 删 4 个 maybe 调用（R-03/R-06/C-13/C-15）
  - applyNudge 废止 audit_log 写入（保留 nudge_log + send_message）—— 治噪音掩盖真审计结果
- **engine NUDGE_RULE_WHITELIST**：删 R-03/R-06/C-13/C-15（与 tao-rules 同步）
- 副本 .context/ + proma-session-patch-kit/ 是精简版（不含 tao-watcher），无需改

### 噪音降低验证
macp4-A4 场景的 C-13/R-03/R-06 假阳性（24-38 条）+ audit_log 噪音（29-43 条）应消失（规则删除 + audit_log 不再写）。Pro 重测最终确认。

## 四、P1b — self_check fix_evidence（治内容收敛盲区）

### 根因
macp4-W3 假收敛：review_round red 降 yellow（red_count=0 收敛）但文档没改，done event self_check 只查文件存在（bar 太低）。

### engine 改动
1. **validateReviewRoundSchema**：findings 加可选 `finding_id`（向后兼容，若存在必须非空字符串）
2. **cmdEventAppend done event**：加 `meta.red_findings_resolved` 跨事件关联校验 —— 读 leaf 历史 review_round red findings（带 finding_id 的），要求 done event 声明每条 red 怎么处理：
   - `fix_method`: edit_file（改了文档）/ downgrade（降级理由）/ other
   - `fix_evidence`: ≥20 字
   - 每个 red finding_id 必须被覆盖
   - 向后兼容：无 review_round 或 red 无 finding_id → red_findings_resolved 可省略
3. help how_to_worker_lifecycle + worker SKILL §3.1：加 red_findings_resolved schema 说明

### 测试（p1b-fix-evidence-test.cjs 8/8）
1. finding_id 合法 2. finding_id 非字符串→E_REVIEW_FORGERY 3. 缺 red_findings_resolved→E_SELFCHECK_INVALID 4. 覆盖所有 red→ok 5. 缺某 red→E_SELFCHECK_INVALID 6. fix_evidence<20字→E_SELFCHECK_INVALID 7. 无 red 可省略（向后兼容）

### 审计发现并修复的 bug
P1b 测试 SubAgent 抓到 copy-paste bug：red_findings_resolved 校验代码误用 `leafId`（驼峰，validateReviewRoundSchema 参数名），但 cmdEventAppend 作用域变量是 `leaf_id`（蛇形）→ ReferenceError 被封装成 E_UNKNOWN 而非 E_SELFCHECK_INVALID。修复：6 处 leafId→leaf_id（sed 行 2133-2157）。修复后 8/8 全绿。

## 五、审计收敛

### P0a 3 路并行审计（SubAgent）
1. **引擎契约一致性**：auditor lifecycle 可跑通；P1 发现 auditor 叶子节点约束未硬拦（已修）
2. **文档对齐**：P1 发现 naming_convention help 漏 auditor（已修）；P2 §14 未交叉引用 role=auditor（已修）
3. **bug 与安全不变量**：macp2 三层防护 + caller-binding 8 处 + V10 八加固 + 预算护栏 + root 信任锚 全部未破；P2 auditor 当 parent（已升 P1 修）

### P0b/P1b 自检 + 测试
- P0b：删规则，向后兼容（基线 30/19/13 全绿）
- P1b：测试 8/8 抓到 leafId bug 并修复

### 最终全量测试（90/90）
- auditor-role-test 20/20
- subagent-lifecycle-test 30/30
- p0-3-status-transition-test 19/19
- iss003-review-gate-test 13/13
- p1b-fix-evidence-test 8/8

## 六、安全不变量未破（macp2 真金白银教训）

- ✅ caller-binding 8 处 throw E_BORROWED_IDENTITY（行 923/929/1730/1914/2006/2928/2972/3049）逻辑零改动
- ✅ caller===audit_session_id（cmdAuditGate 行 2926）堵借身份
- ✅ 预算护栏（node_budget + max_subagent_spawn）auditor leaf 计入
- ✅ startup_notice + SKILL §13.5 调用形式红线 未改
- ✅ review_round append 即时校验 未改
- ✅ V10 八加固错误码常量全在
- ✅ root 信任锚不被滥用（伪造 root session 找不到 rootLeaf → 拒）

## 七、部署状态（Pro）

### 已 cp + md5 校验源=Pro 一致
- `D:/Proma-dev/resources/app/dist/tree-engine.cjs`（备份 .bak-pre-auditor-role-20260708）
- `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`（备份同上）
- `~/.proma-dev/agent-workspaces/default/skills/tree-commander/SKILL.md`（备份同上）
- `~/.proma-dev/agent-workspaces/default/skills/tree-worker/SKILL.md`（备份同上）
- tao-rules.json（两份，数据文件）

### 待用户操作
**重启 Pro app**（engine + patches.cjs 需重启加载；SKILL 文件级即生效）。重启后重测：
1. 建小树验 auditor role 流程（leaf_add role=auditor → 简化协议 done → root 背书）
2. 三层防护不回退（startup_notice + caller-binding + 预算护栏）
3. TaoWatcher 噪音降低（C-13/R-03/R-06 假阳性消失 + audit_log 不再被污染）

### 回滚
`mv tree-engine.cjs.bak-pre-auditor-role-20260708 tree-engine.cjs`（4 个文件同理）+ 重启 Pro。

## 八、改动统计

- engine: +78/-35 行（P0a ~43 + P1b ~50 + P0b NUDGE_RULE_WHITELIST -4 + help）
- commander SKILL: +50/-5
- worker SKILL: +46/-26
- patches.cjs: 2 份各删 4 maybe + 废止 audit_log（~-15 行/份）
- tao-rules.json: 35→29 条
- 新增测试: auditor-role-test 20 用例 + p1b-fix-evidence-test 8 用例
- 总改动远小于报告估的 1000-1500 行（因 resolveAuditorIndep 天然支持 auditor，engine 改动从 500-700 降到 ~120）

## 九、未做（按优先级留待后续）

- **P1a 撞墙强制 escalate**：engine 加 leaf.error_history + 同 error_hash≥3 次→E_RETRY_LIMIT_EXCEEDED + drift handoff。调研报告 §6.4.1。
- **P2 status/timing 观测差**：5.2a 闸门2 信任锚时序 + 5.2b commander 判 done 时 worker 还在跑。需 root cooldown_check + session silence 检测（后者跨仓）。
- **P3+ SDK 会话爆炸检测**：跨 Proma SDK 仓需求，patches.cjs MCP wrapper 拦截 create_session + session_registry 比对。
- **6.3 helper 抽取**：caller-binding 8 处重复 → 抽 assertCallerIsAuditor/assertAuditorIndependent/assertStrictUuidV4（0 agent 摩擦，engine 维护成本）。
