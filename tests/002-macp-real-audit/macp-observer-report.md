# macp 树形审计 — 最终观察报告

**观察员**: Proma Agent（DeepSeek-v4-pro / pi 运行时，session `f4c2e18c`）
**观察周期**: 2026-07-24 11:36 → 12:18 GMT+8（~42 分钟）
**观察对象**: `tree_id="macp"`，根指挥官 session `3198f263`（GLM-5.2 / ZLM 渠道）
**树结构**: root → 3 commander(A/B/C) → 6 worker，三渠道（GLM-5.2 / DeepSeek pi / MiniMax-M3）
**探查方法**: 3 轮 collaboration 子会话探查（DeepSeek pi × 3）+ 父会话 3 轮直接观察

---

## 一、完整执行时间线

```
阶段 0 — 消息投递 + 冷启动 (T-5min → T+0)
  ~11:29  用户通过 send_message 向 root session 发送审计任务
  ~11:34  tree_init（延迟 ~5min = plan_ack_seconds=300）

阶段 1 — 建树 (T+0 → T+4.5min, 11:34-11:39)
  11:34:36  tree_init ✅
  11:35:46  event::plan（审计维度：A1/A2/B1/B2/C1/C2 六维度）
  11:35:46  3 commander session 创建（GLM/MiniMax/DeepSeek）
  11:36:11  ❌ leaf_add ×6 失败（path="macp/A" 应为 "A"，E_SCHEMA_INVALID）
  11:37:29  ✅ 3 commander leaf 就位（修正 path="A/B/C"）
  11:37:48  6 worker session 创建
  11:38:33  ❌ leaf_add ×6 失败（同样的 path 格式错误）
  11:38:56  ✅ 6 worker leaf 就位（path="A1/A2/B1/B2/C1/C2"）

阶段 2 — Milestone + 校验 (T+4.5min → T+6.5min, 11:39-11:41)
  11:39:13  ❌ milestone_add ×6 失败（E_SCHEMA_INVALID: milestone.id 缺失）
  11:39:24  ❌ milestone_add ×6 失败（E_DELIVERABLE_MISSING: 绝对路径）
  11:40:07  ✅ 6 milestone 创建成功（修正为相对路径）
  11:41:08  tree_validate ✅

阶段 3 — Worker 并行审计 (T+6.5min → T+37.5min, 11:41-12:12)
  [Root 静默期 — 等待 worker 产出]
  11:44     🎉 A1 报告就位 (DeepSeek pi, PRD一致性, 27KB)
  11:52     🎉 A2 报告就位 (GLM-5.2, UX审计, 21KB)
  11:59     🎉 B1 报告就位 (GLM-5.2, 架构一致性, 27KB)
  12:02     🎉 B2 报告就位 (DeepSeek pi, API规范, 42KB) ← 最大
  12:04     🎉 C1 报告就位 (MiniMax-M3, 实现差距, 15KB) ← 最小
  12:12     🎉 C2 报告就位 (GLM-5.2, 测试覆盖, 33KB) ← 最后

阶段 4 — 爆裂式收敛 (T+41min → T+42min, 12:15-12:16)
  12:15:55  A1 brief_echo（对齐度 92%）
  12:15:57  A2 brief_echo（对齐度 93%）
  12:15:59  B1 brief_echo（对齐度 90%）
  12:16:02  B2 brief_echo（对齐度 91%）
  12:16:03  C1 brief_echo（对齐度 89%）
  12:16:06  C2 brief_echo（对齐度 92%）
  12:16:07  A2 milestone_set_result audit_pass=true ✅
  12:16:08  B1 milestone_set_result audit_pass=true ✅
  12:16:09  B2 milestone_set_result audit_pass=true ✅
  12:16:10  C1 milestone_set_result audit_pass=true ✅
  12:16:11  C2 milestone_set_result audit_pass=true ✅
  [A1 milestone 在更早轮次已完成]

当前 (12:18) — 待完成
  ⏳ 9 非root leaf 置 done
  ⏳ macp-root-summary.md 写入
  ⏳ root audit_gate + done
```

---

## 二、多渠道表现总结

### 2.1 渠道产出对比

| 渠道 | Leaf | 审计维度 | 报告大小 | 产出时间 | 对齐度 | 质量评级 |
|------|------|---------|---------|---------|--------|---------|
| **DeepSeek pi** | A1 | PRD一致性 | 27KB | 11:44 (最早) | 92% | ⭐⭐⭐⭐⭐ |
| **GLM-5.2 ZLM** | A2 | UX审计 | 21KB | 11:52 | 93% | ⭐⭐⭐⭐⭐ |
| **GLM-5.2 ZLM** | B1 | 架构一致性 | 27KB | 11:59 | 90% | ⭐⭐⭐⭐⭐ |
| **DeepSeek pi** | B2 | API规范 | 42KB | 12:02 | 91% | ⭐⭐⭐⭐⭐ |
| **MiniMax-M3** | C1 | 实现差距 | 15KB | 12:04 | 89% | ⭐⭐⭐ |
| **GLM-5.2 ZLM** | C2 | 测试覆盖 | 33KB | 12:12 | 92% | ⭐⭐⭐⭐⭐ |

### 2.2 各渠道特征

**DeepSeek pi（2 worker + 1 commander）**:
- ✅ **首个产出**：A1 在 milestone 就位后仅 4 分钟即完成 27KB 报告
- ✅ **最大报告**：B2 产出 42KB（API 全量端点映射 + 错误码核对）
- ✅ **pi 运行时完全可用**：树 MCP 工具、文件读写、Bash 均正常
- ⚠️ B2 报告缺严重性分级（无 P0/P1/P2），但 root 仍给予 91% 对齐度
- ⚠️ C-commander（DeepSeek pi）与所有 commander 一样，完全未被激活

**GLM-5.2 ZLM（root + 4 worker + 1 commander）**:
- ✅ **主力渠道**：承担 root + 4/6 worker 任务
- ✅ **质量稳定**：A2/B1/C2 对齐度 90-93%，结构完整
- ⚠️ **高失败率**：root 在建树阶段有 32.4% 工具调用失败率
- ⚠️ root 需要 2 轮"失败→自检→修正"循环才能正确使用 leaf_add
- ✅ **收敛执行力强**：在 C2 到达后 4 分钟内完成全部背书

**MiniMax-M3（1 worker + 1 commander）**:
- ✅ **成功产出**：C1 在 12:04 完成，虽为最小报告（15KB）但覆盖了全部 35 源文件
- ⚠️ **最晚激活**：C1 session 在观察开始后近 30 分钟才有产出
- ⚠️ **报告最弱**：15KB 为 6 份中最短，评分 32/100（加权 53.75）
- ⚠️ B-commander（MiniMax）完全未激活

---

## 三、树形体系关键发现

### 3.1 执行模式：星形而非树形

**设计意图**：root → 3 commander（各管 2 worker）→ 6 worker 的多级树形

**实际执行**：root 直连 6 worker 的扁平星形
- 3 个 commander session 创建后**从未收到 brief**
- 所有 leaf_add、milestone_add、brief_echo、milestone_set_result 均由 root 直接操作
- worker 的任务分发通过 `send_message` 直接投递（不经过 tree 系统）

**影响**：树形多级协调优势完全未发挥。好处是简单直接、收敛快；代价是 root 成为单点瓶颈。

### 3.2 "静默期"真相：等待而非冻结

观察中最大的误判是将 root 的 30 分钟无活动解读为"冻结"。实际情况：
- Root 在 11:41 完成拓扑编排后进入**等待阶段**
- Worker 报告在 11:44-12:12 间陆续到达
- C2（12:12）是最后一块拼图，到达后 root 立即在 4 分钟内启动收敛

**教训**：tree 系统的 call-log 只记录 tree MCP 工具调用。root 在等待期间通过 send_message 与 worker 交互（发任务、收结果），这些不出现在 call-log 中。树状态 `pending_brief` 并不意味"无活动"。

### 3.3 收敛爆裂模式

12:15-12:16 的 16 秒内，root 连续完成：
- 6 个 brief_echo（对齐度评估）
- 5 个 milestone_set_result（全部 audit_pass=true）

这是一个**批量收敛**模式：root 等待所有 worker 完成，然后一次性背书。这种模式的优点是效率高（无需逐个响应），风险是如果某个 worker 永久卡住，整个树将无限等待。

### 3.4 命名约定问题（32.4% 失败率根因）

| 错误类型 | 次数 | 阶段 |
|---------|------|------|
| leaf_add path="macp/A" 应为 "A" | 12 | 建树 |
| milestone_add id 字段名错误 | 6 | milestone |
| milestone_add expect_outputs 绝对路径 | 6 | milestone |

**根本原因**：GLM-5.2 在 tree_init 后未充分理解 `naming_convention`（前缀-路径-角色格式），依赖"试错→修正"模式。tree_init 返回的 `tips.next_steps` 没有提供足够具体的代码示例。

### 3.5 未激活的体系组件

| 组件 | 状态 | 影响 |
|------|------|------|
| heartbeat | 无 heartbeat_log | 无健康监控 |
| TAO watcher | 未激活 | 无自动纠偏 |
| drift | 全空 | 24 次失败零 drift 记录 |
| audit_gate | 全部 skip | 无独立审计门禁 |
| commander | 全惰性 | 树形退化 |
| nudge | 全 0 | 无推进提醒 |

---

## 四、定量总结

### 4.1 call-log 统计（最终：103 行）

| 指标 | 初期(11:41) | 收敛期(12:16) | 最终(12:18) |
|------|-----------|-------------|-----------|
| 总调用 | 72 | 78 | 103 |
| 成功/失败 | 48/24 | 53/25 | 78/25 |
| 失败率 | 33.3% | 32.1% | **24.3%** |
| Root 调用 | 52 (72%) | 57 (73%) | 82 (80%) |
| 匿名(系统) | 18 (25%) | 18 (23%) | 18 (17%) |
| Observer | 2 (3%) | 3 (4%) | 3 (3%) |

**失败率从 33.3% → 24.3%**：因为收敛阶段（brief_echo + milestone_set_result）零失败，稀释了建树阶段的错误率。

### 4.2 报告矩阵

| 报告 | 大小 | 发现数 | P0 | P1 | P2 | 评分 | 对齐度 |
|------|------|--------|----|----|-----|------|--------|
| A1-PRD | 27KB | 12 | 2 | 5 | 5 | 7.0/10 | 92% |
| A2-UX | 21KB | 21 | 0 | 11 | 10 | 75/100 | 93% |
| B1-架构 | 27KB | 17 | 0 | 5 | 12 | 7.0/10 | 90% |
| B2-API | 42KB | — | 4 | — | — | 3.5/5 | 91% |
| C1-实现 | 15KB | 11 | 3 | 5 | 3 | 32/100 | 89% |
| C2-测试 | 33KB | 20 | 3 | 8 | 9 | 5.5/10 | 92% |

**六维度总发现**：81+ 项问题，其中 P0 阻断级 12 项

### 4.3 时间效率

| 阶段 | 耗时 | 占比 |
|------|------|------|
| Fire-and-forget 启动延迟 | ~5min | 12% |
| 建树（含纠错） | ~7min | 16% |
| Worker 并行审计 | ~31min | 72% |
| 收敛背书 | ~16s | <1% |

**关键洞察**：72% 的时间花在 worker 审计阶段。这是正确的——审计质量需要时间。建树和收敛的开销占比小但容易出错（命名/路径问题）。

---

## 五、三渠道交叉验证

### 同一问题、不同视角

| 交叉点 | A1 (PRD, DeepSeek) | B1 (架构, GLM) | C1 (实现, MiniMax) |
|--------|---------------------|-----------------|---------------------|
| Agent间协作机制 | P0: 文件交接 vs 并行矛盾 | P1: SessionRouter归属不一 | P0: Agent实例缺失 |
| 沙箱安全 | 未提及 | P1: L0无OS强制+L1无路径限制 | P0: sandbox模块0%实现 |
| PlantUML | P2: 快消型"极简"定义不明 | P2: class-diagram引用断链 | 未审计 |

**三模型在架构层面发现互补**：DeepSeek 关注 PRD 逻辑一致性，GLM 关注技术可行性，MiniMax 关注代码现实。这是多模型审计的核心价值。

---

## 六、经验教训（更新版）

### ✅ 做得好的

1. **多模型并行审计产出质量高**：6 份报告覆盖六维度，总计约 180KB，81+ 项发现
2. **DeepSeek pi 运行时验证通过**：文件读写、Bash、tree MCP 调用、长报告生成均正常
3. **MiniMax-M3 成功参与**：虽为最小报告，但完成了全部 35 源文件遍历
4. **收敛爆裂模式高效**：16 秒内完成全部背书，证明批量收敛可行性
5. **Root 有等待-收敛策略**：不急于逐个背书，等待全部到达后统一处理
6. **对齐度评估机制**：brief_echo 提供了 89-93% 的量化对齐度量

### ⚠️ 卡住的

1. **Commander 层完全架空**：3 个 session 创造但从未使用，树形退化为星形
2. **树状态更新滞后**：worker 实际已完成报告，但 tree dump 仍显示 `pending_brief`
3. **C2 延迟问题**：GLM-5.2 worker 耗时最长（~33min），可能是 worker session 启动慢或 GLM 推理慢
4. **C1 报告偏弱**：15KB 为最薄报告，虽 root 给予 audit_pass，质量值得交叉审查

### 🔧 该改进的

1. **tree_init 后给出代码级 naming 示例**（前报告建议，依然有效）
2. **Commander 委派协议标准化**（前报告建议，依然有效）
3. **Worker progress tracking**：worker 产出应实时反映到 tree 状态（至少 brief_echo 应在报告落盘时触发）
4. **Milestone 创建前置条件放宽**：允许 `expect_outputs` 在文件不存在时创建
5. **Heartbeat 机制激活**：树有配置但从未使用，应在 tree_init 时默认激活
6. **Drift 自动记录**：对可恢复错误自动 append drift
7. **降低 plan_ack_seconds**：300 秒启动延迟过长，可考虑异步启动 + 即时 ack

---

## 七、终局评估

### 树收敛状态 (12:18)

```
Q1: 6 worker 报告全部落盘且非空    ✅ 6/6 (180KB total)
Q2: 每个 worker audit_pass=true   ✅ 6/6 (milestone done)
Q3: brief_echo 对齐度             ✅ 6/6 (89-93%)
Q4: 9 non-root leaf done          ⏳ pending
Q5: macp-root-summary.md          ⏳ pending
Q6: root audit_gate + done        ⏳ pending
```

**收敛进度: ~75%**（报告+milestone 完成，leaf done + summary 待完成）

### 预测

Root 在 12:16 完成背书后，下一步大概率是：
1. 将 9 个 non-root leaf 置为 `done`
2. 基于 6 份报告 + brief_echo 对齐度写 `macp-root-summary.md`
3. 完成 root self-check 和 done

预计 **12:25-12:30 完成完全收敛**。

---

## 八、观察方法自评

- **观察架构**：父会话 3 轮直接观察 + 3 轮 collaboration 子会话探查
- **观察覆盖**：完整覆盖 init → plan → leaf_add（含失败自愈）→ milestone_add → worker 并行审计 → 收敛背书
- **子会话效率**：3 个子会话（DeepSeek pi × 3）均成功完成探查并返回结构化报告，总耗时 ~4 分钟
- **局限性**：无法观察 send_message 内容，无法确定 root→worker 的具体任务文本
- **pi 运行时 v0.20 验证**：✅ 本次观察 + 3 子会话 + 前一观察报告，DeepSeek pi 运行时在 tree MCP、文件系统、Bash、collaboration 等工具上均运作正常

---

*报告生成时间: 2026-07-24 12:20 GMT+8*
*观察员: Proma Agent (DeepSeek-v4-pro, session f4c2e18c)*
*参与探查子会话: a3be2cb3, 80c49086, 9902953c (all DeepSeek-v4-pro)*
