# 树形任务 harness 中期评价 — nanju 活案例对照分析

> 2026-07-04 | 多 Agent 团队洁净室分析 | 维护: 周星星
> 方法：4 个独立子 Agent（执行流 / 代码 / 会话语义 / 设计对照）并行，互不通信，交叉印证。
> 案例规模：18 leaf = active 5 + archived 12 + done 1。任务：南大多 Agent 协同开发平台。

## 一、证据基线（四源交叉）

| 数据源 | 规模 | 来源 |
|--------|------|------|
| tree-state.json | 566KB / 18 leaf / drift 4 / heartbeat 22 / events 78 | `default/.context/trees/nanju/` |
| call-log.jsonl | 284 次 mcp__tree__* 调用 / 48 error | 同上 |
| 节点会话 | root/A-cmd/A1/A1w/A1r/B6/B1 清洗后 5–218KB | session-cleaner skill 清洗 |
| tree-engine.cjs | 4315 行 bundled / 21 个 cmd / 33 个 E_xxx | proma 工作区 |
| 设计文档 | tree-commander SKILL v2.3 / tree-worker / 使用场景 / 剪枝者方案 | proma 工作区 |

## 二、交叉确认的 P0 漏洞（4 Agent 汇聚，最高置信）

### P0-1 ⚠️ done event 自动同步 status，架空全部 done 门禁（**总崩点**）

- **代码**：`cmdEventAppend` line 1945-1953 — `if (type==='done' && leaf.status!=='done') leaf.status='done'`
- **后果**：`cmdLeafSetStatus` 精心构筑的 8 道 done 门禁（milestones 非空 / 每 milestone audit_pass / expect_outputs / deliverables 文件存在 / brief_echo+done 双事件 / review_round 收敛 / audit_gate pass / status_event 一致 / children 全 done）**全部空转**。worker 写完 done event，status 直接转 done，无需再调 set-status。
- **实证**：B6 是唯一"done"节点，但它的 `milestones=[]` / `audit_gate.verdict=required, auditor_session_id=null` / events 无 alignment event — **8 道门禁一道都没过**。B6 自己在 done event meta 里声明 `C_b_gate_pending`（4 项形式门全 pending）。
- **命中**：执行流(L3) + 代码(V-01 Critical) + 语义(D2) + 设计(D2/D8) — **四源全中**
- **修复成本**：删 1 行（line 1952），让 status 由 cmdLeafSetStatus 唯一入口写入

### P0-2 ⚠️ audit_gate 结构性不可达（V5b + V10 + 信任锚三重死锁）

- **死锁链**：V5b 要求 alignment event 的 auditor=tree leaf session；V10 要求 audit_gate.pass 必须由 V10-active auditor leaf 调用；首个 V10-active leaf 需"信任锚自审 Solution A 的 C3"（标注"实施中"）。三重前置闭环不可达。
- **实证**：13/13 有 brief_echo 的 worker **全部 alignment 缺失**。A-commander 双向证伪 Solution A（root 自审被 E_AUDIT_PREMATURE 拒）/ Solution B（fresh auditor 被 E_ALIGNMENT_NOT_VERIFIED 拒）。commander 被迫发明 **C-b 决议**（"实质门禁，形式待审"）作为设计外永久兜底。
- **代码层 root 后门**（V-04, line 2245-2258）：`resolveAuditorIndep` 允许任意非 root leaf 用 root 当 auditor 直接 pass — root 自己 audit_gate 自动 skip→pass，链路自洽，**独立审计降级为 root 单点信任**。
- **命中**：执行流(L9) + 代码(V-04/V-05) + 语义(D4) + 设计(D4) — **四源全中**
- **设计者已知死锁但未在 SKILL 给合规降级路径**，逼 commander 现场发明 C-b

### P0-3 状态机零流转校验，三档纠偏在代码层零落地

- **代码**：`cmdLeafSetStatus` line 1256 只校验 `new_status ∈ STATUS_ENUM`，**无任何 from→to 流转矩阵**。pending_brief→pruned / done→active / archived→active 全部合法（archived 不是终态！）。
- **实证**：A1-A4 从 pending_brief 直接 prune（跳过 nudge/limit 两档）。drift_log 把 reason 标成 `rhythm`，但真实原因是 root 越权补救（应为 governance）。
- **会话层补证**（语义 D2）：tao-watcher 直接编辑 tree-state.json 写 nudge_log，**从不调 tree_nudge_append MCP**，cmdNudgeAppend(prune-at-7) 从未运行 — B1 nudge_count 涨到 42 仍 active 3.3h。"nudge→limit→prune 递进"只剩"nudge 噪音 + 偶发手动 prune"。
- **命中**：代码(V-02) + 设计(D3) + 语义(D2) + 执行流旁证

## 三、重大设计层问题（P1）

| # | 问题 | 证据 | 命中源 |
|---|------|------|--------|
| P1-1 | **§14 审计树结构整章失效**：设计要求 ≥7 独立审查 leaf（C1-C4+A1A2+fix），nanju 实际 **0 个**独立审计 leaf。所谓"14 审查 leaf"是 worker §4.6 的 SDK 子Agent 自审，与 §14 独立 leaf 是两套机制，设计未声明优先级 | deliverables 标榜 vs tree-state 实际 0 个 C/Audit 命名 leaf | 设计(D1/D12) + 语义 |
| P1-2 | **5 件套契约未持久化**：tree-state leaf 对象无 brief/dod 字段，仅消息层流转。milestone_add 工具从未被调用，18/18 leaf `milestones=[]`。done 门禁"milestones 非空"硬校验形同虚设；F2 根崩溃恢复时 5 件套全丢 | 设计(D2) + 语义(D5 契约两极分化：A1 散文 brief 失败 / A1w 完整 YAML 成功) | 设计 + 语义 |
| P1-3 | **drift 留痕不一致**：12 archived 但 drift_log 仅 4 条。set-session（所有权转移）/ migrate / restore 路径**都不写 drift**；存在"幽灵 archive"（A1w-A4w archive 既不在 call-log 也不在 drift_log） | 代码(V-07) + 执行流(L4/L5) | 代码 + 执行流 |
| P1-4 | **ctx 全 0，竹节交接永远不触发**：心跳 22 次只读不写 ctx，set-context 调用 0 次。设计依赖 ctx_pct 触发 sweet_spot_risk → 竹节交接，ctx 永远 0 → 竹节交接永远不自动触发。get_session_context 从未集成进心跳 | 代码(V-10) + 执行流(L6) + 设计(D5) | 三源 |
| P1-5 | **validation + archive + budget 死锁**：node_budget=10 硬编码；archive 被 validation 阻断（830 issues）；死叶 audit_log 残渣不可清 → budget 撞满 → 新工作被堵。root 被迫**违规直改 tree-state.json**（违反铁律#1）archive 8 死叶 | 执行流(L4 旁证) + 语义(D7) + 设计(D10 ISSUE-002 结构性) | 三源 |
| P1-6 | **越权创建不可逆 + 无修复工具**：root 越级建 worker 导致会话所有权归 root（commander send_message 全 E_NO_OWNERSHIP）+ audit_log 出现 W-AUDIT-TAMPER。harness 无 transfer_ownership、无 audit_log 清理工具 → A-commander 被迫重建 4 个全新 leaf（w 系列，4 倍工作量） | 执行流(根因1) + 语义(D6) | 执行流 + 语义 |
| P1-7 | **worker 自任状态机仲裁者**：22 次 set-status 中 16 次由 worker 自己改自己，commander 6 次全失败（E_TREE_NOT_VALIDATED）。门禁设计假设 commander 仲裁，实际 worker 自任 | 执行流(L2) + 代码(V-01 旁证) | 执行流 + 代码 |
| P1-8 | **命名正则漏洞**：`LEAF_NAME_RE` line 64 第 3 捕获组用 `\w+` 而非 `(root\|commander\|worker)` 枚举，A1w/A1r 命名合法（w/r 编码进 path 段）。role 字段层有 assertEnum 拦，但 leaf_id 字符串层不查 | 代码(V-03) + 设计(D6) | 代码 + 设计 |

## 四、方法论洞察（4 Agent 的独立总结汇聚）

### 洞察 1：「门禁堆栈 vs 协议编队能力」的对照实验场（执行流分析师）

- 门禁堆栈本身**有效**：23/48 error 是设计门禁正常拦截（borrowed identity / not validated / not independent / premature / alignment not verified）
- 真正崩溃在**协议层编队**：A-commander 三波建 12 个 worker，8 个实质产出完成且自审通过，但 commander **始终没有能力**完成 alignment 回填 + 派独立 auditor 这两个"人对人"编队动作
- A 系列 12 灭**不是任务难度问题**，是同一个形式门反复卡住 → budget 撞顶 → 重启 → 又卡同一门

### 洞察 2：「worker 优秀 / harness 拖后腿」（语义分析师）

- worker（GLM-5.2）**4/5 正确**回 brief_echo、严格守协议、真跑 multi-sub-agent 自审、red 真归零（A1r 22 RED→0、B6 16 yellow→9 自改→复审 0）
- commander 纪律性强（不擅动 V5b/V10、每步报 root、双向证伪 bootstrap 死锁、ISSUE-004 主动 flag）
- root 决策质量高但归因偶尔失准（ISSUE-004 初次误信 escalation，3hr 后 RCA 翻案）
- **harness 是瓶颈**：D1-D9 九个设计漏洞中 6 个高严重度

### 洞察 3：「纸面门禁 vs 刚性门禁」 — 大量"死的硬约束"

以下设计在 nanju 实战中**从未真正执行过一次**：
- V5b alignment 回填（13/13 worker 缺失）
- §14 审计树 7-leaf 结构（0 个独立审计 leaf）
- milestone_add 工具（18/18 leaf milestones=[]）
- 5 件套持久化（leaf 对象无 brief/dod 字段）
- 三档纠偏决策树（drift_history 全空）
- ctx_pct 触发竹节交接（ctx 永远 0）

## 五、过度设计 vs 欠设计（设计对照分析师）

### 过度设计
- **§14 审计 7-leaf 对文档级任务过度**：nanju A 层是 4 份设计文档，worker §4.6 自审已 red 归零。强制 commander 再 Fork 7 独立 leaf 做同维度审查是 7 倍冗余。§14.1 触发条件没区分"任务本身是审计"vs"任务产出后要被审计"。
- **V5b 对 tree-leaf auditor 的硬依赖过度耦合**：与 V10 + 信任锚形成死锁。

### 欠设计
- **pending_brief 阶段是纠偏盲区**：三档决策树假设"已收到 verdict"，pending_brief 阶段没 verdict，W-01 直接 prune 跳过两档
- **milestone 与 done 门禁耦合在 C-b 下崩溃**：门禁不可达时 commander 该怎么办，设计未预见
- **worker 命名 w/r 后缀无合规出口**：逼 commander 自创
- **心跳缺 get_session_context 集成**：ctx 维度从未真正监测
- **无原生重试机制**：A1→A1w→A1r 全是手动建新会话+新 leaf_id+重发 brief，无 prompt diff / retry counter / 失败原因传递

## 六、中期评价结论

**骨架优秀，但门禁刚性被一行代码架空，且存在多个"死的硬约束"和结构性死锁。**

1. **5 件套契约理念、心跳通道、命名规范、C-b 务实降级**是体系亮点 — worker 拿到完整 YAML 都能产出高质量工作
2. **当前形态下 §14 审计工作流和 done 门禁硬校验在多层实战中是死的**，靠 C-b 务实接受兜底
3. **体系需要中期补丁而非渐进优化**：P0-1（一行）→ P0-2（合规降级路径）→ P0-3（状态机）能恢复门禁刚性
4. **逃生通道逼违规**：死锁期 commander 发明 C-b（设计外）、root 直改 tree-state.json（违反铁律#1） — 设计提供了原则但没提供合规逃生通道

## 七、优先修复建议

| 优先级 | 漏洞 | 修复 | 成本 |
|--------|------|------|------|
| **P0** | done event 自动同步 status（V-01） | 删 line 1952 一行；status 由 cmdLeafSetStatus 唯一入口 | 低 |
| **P0** | audit_gate 三重死锁（V5b+V10+信任锚） | 短期：SKILL 加"死锁期降级"（显式声明 `audit_gate_bootstrap_deadlock=true` + SDK code-reviewer 替代）；长期：落地信任锚 C3 | 中 |
| **P0** | 状态机零流转校验（V-02） | 加流转白名单 + E_STATUS_TRANSITION_INVALID | 中 |
| **P1** | §14 vs §4.6 适用边界 | SKILL 明确：文档级用 §4.6，跨文件架构级用 §14；§14.1 加 task_scope 门槛 | 低（文档） |
| **P1** | 5 件套未持久化 | leaf 对象新增 brief/dod/milestones 字段；milestone_add 在下发 5 件套时自动注册 | 中 |
| **P1** | drift 留痕不一致（V-07） | cmdLeafSetSession/migrate/restore 补 drift；restore 后扫死叶补 drift | 中 |
| **P1** | ctx 全 0（V-10） | cmdHeartbeatAppend 收到 verdicts 后自动 set-context；或 validate 加异常检测 | 低 |
| **P1** | validation+archive+budget 死锁 | archive 不硬依赖 validate；新增 tree_leaf_purge 合规逃生；node_budget 可配置 | 中 |
| **P1** | 越权不可逆 | leaf.add 校验 parent.role 与 caller.session 一致性；新增 transfer_ownership + audit_log 清理 | 中 |
| **P1** | 命名正则（V-03） | 第 3 组改 `(root\|commander\|worker)` | 低 |
| **P2** | W-01 检测 bug | 查文本而非工具调用首条 | 低 |
| **P2** | checkSessionAlive fail-open（V-06） | MCP 入口强制注入 verifier；异常时 fail-closed | 中 |

## 八、附录：4 Agent 报告产出位置

- 执行流：树状态 + call-log 双源交叉（284 调用全扫，48 error 解剖）
- 代码：tree-engine.cjs 4315 行白盒（V-01 ~ V-12，行号定位）
- 语义：6 节点会话清洗于 `/tmp/nj-analyze/*.clean.md`（会话后失效）
- 设计：12 项差距表（D1-D12）

## 九、本次分析的方法论价值

- **洁净室 + 多视角交叉**是验证复杂 harness 的有效手段：4 个独立数据源汇聚同一结论，置信度远高于单视角
- **活案例 > 设计文档**：纸面门禁（V5b/§14/三档纠偏）在实战中大面积失效，只有跑一棵真树才暴露
- **"删一行恢复刚性"（V-01）**：最严重漏洞修复成本最低 — 提醒设计者警惕"门禁越多越安全"的错觉，关键是门禁之间不能有绕过链
