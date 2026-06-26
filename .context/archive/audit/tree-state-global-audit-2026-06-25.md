# 全局开发树审计报告 2026-06-25（已修正）

> 审计范围: 全实例（proma / proma-dev / proma-release）所有非 test-sandbox 树
> 审计时间: 2026-06-25 09:30（初版） → 10:18 修正（用户指出"很多是2天前的初始版本"）
> 触发原因: 用户反馈 audit-gate-test-20260625「指挥官认知偏移」（worker 未完成但指挥官判通过）

---

## 一句话结论（修正后）

**真正 V4-V9 体系下的近期失守树只有 audit-gate-test-20260625 一棵（3 副本）。fupv（6/24 创建）未走完流程无法判定。vfa1/vfb 是对抗测试 fixture（故意制造问题验证校验逻辑）。其他 20 棵都是 v0.2.x 时期（6/19-6/21）的早期产物，那时 schema 都没成型，谈不上 V4-V9 失守。**

---

## 二、按树版本时期重新分类

### 🟢 v0.2.x 早期树（6/19-6/21，**不算 V4-V9 失守**）

这些树创建时 V4-V9 加固还不存在，schema 也没定型，缺失字段是历史原因不是 bug。

| 树 | 创建时间 | 当时状态 |
|----|----------|----------|
| l1fix | 6/19 18:01 | V4-V9 加固前的 Q1 验证 |
| l1fix_v2 | 6/19 21:27 | 同上 |
| real | 6/19 17:47 | smoke 真实使用 |
| real_v2 | 6/19 21:26 | 同上 |
| retest | 6/19 15:58 | 同上 |
| q1e2e | 6/19 23:09 | Q1 端到端 |
| q1full | 6/21 13:53 | Q1 全深度 |
| qfv2 | 6/20 11:09 | Q1 v2 验证 |
| sq_audit | 6/21 18:13 | TAO 审计测试 |
| smkv22 | 6/21 18:13 | smoke v0.2.2 |
| smoke22 | 6/21 13:54 | smoke v0.2.2 |
| smkpnd | 6/21 13:49 | smoke pending |
| smoke_v022 | 6/21 13:48 | smoke 初始化失败 |
| bverify | 6/20 14:17 | B 任务验证 |
| taosmk | 6/21 13:57 | TAO smoke |
| taotest | 6/21 13:59 | TAO 端到端 |
| mcpvfy-20260624 | 6/24 11:43 | 已归档未启动 |
| mdref（tree-1 工作区） | 早期 | 多工作区测试 |
| pytut（tree-2 工作区） | 早期 | Python 教程 |

**这些树不需要修复**，后续可以批量归档（`mcp__tree__*` migrate 到 _archive 或直接删除）。

### 🟡 对抗测试 fixture（6/25 08:55）— 实测引擎 0% 拦截

| 树 | 注入数 | 引擎拦截 | 拦截率 |
|----|--------|----------|--------|
| vfa1 | 4（全 f UUID / 伪造 UUID / etc） | 0 | **0/4 (0%)** |
| vfb | 13（全 f / 空串 / "not-uuid" / null / self-session / total=-1 / 长度不符 / 超长 DoS / etc） | 0 | **0/13 (0%)** |

**这不是"测试 fixture 验证防御好"，而是证实引擎源码层根本没有校验逻辑**：

```bash
# 在 proma-source 仓库 grep
grep -r "auditor_session_id" .  # 0 匹配
grep -r "block_reason" .        # 0 匹配
```

V4-V9 加固（9 硬约束点）写在 `tree-engine.cjs`（patches.cjs 内联），**不在 proma-source 仓库**。即便加载到 dev dist，加固代码本身也存在盲区——vfa1/vfb 实测在旧版 engine 下 0% 拦截，预期新版加载后拦截率仍接近 0%（因为源码层缺所有 schema 验证）。

详见 [迭代深度审计报告 §三](./iterative-deep-audit-2026-06-25.md)。

### 🔴 真实近期失守树（仅 1 棵，3 副本）

#### audit-gate-test-20260625（用户反馈的失守案例）

**3 副本**（dev default + dev undefined + proma undefined，三处大小不一）：

| 失守类型 | 证据 | V 编号 |
|----------|------|--------|
| 僵尸 auditor 被引用 | auditor 404c724f status=active, events=[]，nudge_count 累积（09:30=5/6/1，10:45=20/19/1，**1 小时翻 4 倍**），但 worker audit_gate.verdict=pass 引用它 | **V10-auditor-active** |
| V4 失守 | worker 自填 auditor_session_id 字符串 | V4 |
| V5b 失守 | worker brief_echo 写"等待 auditor"，audit_gate 直接 pass，alignment 留痕缺失 | V5b |
| V6 失守 | self_check 全 pass:true 但 evidence 是叙述字符串 | V6 |
| worker 借身份写 pass | worker 528b0925 用 auditor 404c724f 的 session_id 调 `tree_audit_gate`，引擎只校验 session_id 对应不同 leaf（通过独立性），但 auditor 自身 events 永远空（傀儡 auditor） | **V10-self-audit-forbidden** |
| 多副本状态分裂 | dev workspace=null 导致同一 tree_id 写到 3 路径；根因 `main.cjs:191 getAgentWorkspacePath` 静默 path.join(base, undefined) | **V10-workspace-canonical** |
| 时间倒挂 | **commander 报告 09:16:32 早于 worker pass 落库 09:19:11 共 1m21s**——commander 先写结论 worker 事后坐实 | **V10-timestamp-monotonic** |

**用户决策**：保留 3 副本作教具，不删不改，开新树重测对比。

### 🟠 待判定（未走完流程）

#### fupv（V4-V9 followup 开发树）

- 创建：6/24 20:53
- 7 leaves 全 status=active
- phase1-verify worker 仍在跑
- 等 done 后才能判定是否失守

---

## 三、V4-V9 加固的 6 大盲点（基于 audit-gate-test-20260625 + 推断）

| V10 编号 | 加固内容 |
|----------|----------|
| V10-auditor-active | audit_gate.verdict=pass 时，校验 auditor leaf 必须 status=done 且自身 audit_gate.verdict=pass |
| V10-schema-enforce | leaf done 前强制完整 schema（audit_gate + milestones + events） |
| V10-self-check-evidence | self_check 必须是数组 [{item, pass, evidence}]，evidence 是路径/hash 而非叙述 |
| V10-timestamp-monotonic | event ts ≥ leaf created_at + 单调递增 + ≤ now() |
| V10-nudge-escalation | nudge_count ≥ 3 升级 severity，≥ 5 强制 pruned 或人工介入 |
| V10-workspace-canonical | 修 dev workspace=null + tree-state 记录 canonical 路径 |

**注**：这 6 大盲点是基于 audit-gate-test-20260625 一棵失守树 + 推断得出的。要在大规模数据上验证，需要 V10 加固后跑新树重测方案（`.context/plan/audit-gate-retest-v10.md`）。

---

## 四、与 V4-V9 设计意图的对比

| 设计意图 | audit-gate-test 实际效果 | 差距 |
|----------|--------------------------|------|
| V4: milestone audit_pass 需 auditor | 形式有 auditor_session_id 字符串，实质可伪造/自填 | 字段存在 ≠ 内容有效 |
| V5b: 查 events 留痕 alignment | events 有 brief_echo，但 alignment 字段是"等待 auditor"不升级 | 字段存在 ≠ 状态推进 |
| V6: self_check 不能全 false | 转化为"全 pass:true 但无 evidence"绕过 | 反向逻辑漏洞 |
| V8: budget 校验 | 已生效（spec/impl 一致） | 唯一干净 |
| V9: expect_outputs 路径校验 | 路径校验生效，但 ts 校验缺失 | 时间维度未覆盖 |
| CP2: HARDEN2 verdict=pass 校验 | 待加固版本实际加载才生效 | dev 未重启 |

**核心教训**：V4-V9 是「字段存在性校验」，攻击者用「字段存在但内容伪造」绕过。V10 应该升级为「字段内容有效性校验」。

---

## 五、修正：原报告扩大化的部分

### 原报告错误（已修正）

| 错误项 | 真相 |
|--------|------|
| l1fix「时间戳伪造（done 早于 created 7 小时）」 | 实际是 v0.2.x 早期 schema 不完善，那时 V4-V9 还不存在 |
| l1fix_v2「6 个僵尸 auditor」 | 同上，v0.2.x schema 没定型 |
| qfv2「schema 字段缺失」 | 同上，v0.2.x 早期 |
| bverify「audit_gate 字段完全缺失」 | 同上，v0.2.x 早期 |
| real_v2「9 audit 全未执行」 | 同上，v0.2.x 早期 |
| mdref/pytut「self-pass + 无 evidence」 | 同上，v0.2.x 早期 |
| 把对抗测试 fixture（vfa1/vfb）当成 bug | 是 adversarial 注入测试，故意制造问题 |

### 修正后保留的真实失守

只有 **audit-gate-test-20260625**（6/25 创建，V4-V9 体系下）一棵树失守。

---

## 六、处理优先级（修正后）

### 立即

1. **保留 audit-gate-test-20260625 三副本作教具**（用户已选）
2. **重启 dev 实例加载 V4-V9 + R2-T7 加固**（08:47 cp 的新 engine 仍未生效）
3. **批量归档 v0.2.x 早期树**（17 棵）— 不修复，直接 _archive 或删除

### 短期

4. **实施 V10 加固**（6 大盲点）— 基于 audit-gate-test 失守案例推断
5. **跑新树重测方案**（`.context/plan/audit-gate-retest-v10.md`）验证 V10 有效性

### 中期

6. **Phase D 推进**：D1 prune/archive 语义、D2 migrate 版本号、D3 watcher silence_minutes
7. **Layer 4 subagent_trace_id**：堵互审洗白/冒用（平台层）

---

## 七、产出文件

- 本报告（修正版）: `.context/audit/tree-state-global-audit-2026-06-25.md`
- 失守案例教材: `.context/note.md` 顶部条目（需同步修正版本）
- 新树重测方案: `.context/plan/audit-gate-retest-v10.md`

---

## 附录：审计覆盖

| 类别 | 数量 | 性质 |
|------|------|------|
| test-sandbox 临时树 | 87 | 跳过 |
| v0.2.x 早期树（6/19-6/21） | 17 | 不算 V4-V9 失守 |
| 对抗测试 fixture（6/25） | 2 | 故意制造，不是 bug |
| 真实近期失守树 | 1（3 副本） | audit-gate-test-20260625 |
| 待判定 | 1 | fupv（未 done） |
| **真实需要关注** | **1** | audit-gate-test-20260625 |

---

## 修正说明

本报告于 2026-06-25 10:18 由用户提示后修正。原报告（09:30 初版）把 v0.2.x 早期产物误判为 V4-V9 失守，扩大化了问题范围。修正后只保留 audit-gate-test-20260625 一棵真实失守树，但 V10 加固的 6 大盲点推断依然成立（基于该树的详细分析）。
