# 阶段总结 — 2026-07-15 晚（e2e04 负面验证 + thdev 调度 + gap audit）

> 维护：主会话 a5c20252（GLM-5.2，ZLM cbb12a0b）| 时间 2026-07-15 02:34 | 分支 `release-0.13.16-hardening`
> 上一手：[handoff-2026-07-15.md](./handoff-2026-07-15.md)（00:16 交接）+ [e2e03](./e2e03-verification-2026-07-14.md)（07-14）
> 性质：主会话 a5c20252 接手后的**本阶段成果整合 + 状态 + 待续 + 教训**，供下个会话/用户快速恢复 context。

---

## 〇、TL;DR

本阶段完成 4 项工作 + 暴露 5 条教训，**4 个 commit 全提交，工作区干净**：
- ✅ **e2e04 负面场景验证**（drift/flagged/max_sessions 三机制）→ Sprint 1-5 机制实证矩阵 **8/8**
- ✅ **P1 修复** e2e03 产物瑕疵 + CLAUDE.md 跨树预检陷阱
- ✅ **thdev tree 调度**（W1 删 dead code + W2 方向1 深化 + W3 文档）
- ✅ **设计 vs 实现 gap audit**（4 类，真 gap = human_checkpoint 等 4 项）

| commit | 内容 |
|---|---|
| `eace551` | e2e04 负面场景验证（drift/flagged/max_sessions 三机制补齐）|
| `02ed53e` | P1 修复 e2e03 瑕疵 + CLAUDE.md 跨树陷阱 + 发现C确认 dead code |
| `c583559` | thdev W1 删 isFlagged dead code + W3 文档同步 |
| `f0f6ced` | W2 first-pr-draft 方向1 源码深化（stale-meta gap 成立）|

---

## 一、e2e04 负面场景验证（commit eace551，详见 [e2e04 报告](./e2e04-verification-2026-07-15.md)）

在 pro（引擎 5532fa5f + patches 339082af + SKILL 8b2d20f2）由 GLM-5.2 commander + 编排方精确驱动三棵小树，补齐 e2e03 未演练的三机制：

| 场景 | 结果 | 关键证据 |
|---|---|---|
| ③ E_MAX_SESSIONS | ✅ | 第3个 worker 在 **create_session 阶段**被拦（patches 前置预检，session 未建立=钱没花），双层护栏协同 |
| ① drift 三档联动 | ✅ | drift_append×3 递进（low/nudge→mid/limit→high/prune），drift_history+drift_log 双写 |
| ② flagged 篡改检测 | ✅ | 篡改 C-commander（伪造 audit_gate.pass）→ E_REVIEW_FLAGGED_BLOCK 拦；补 review_round 后放行。证 isFlagged 从 events 动态派生、不看 audit_gate 字段 |

**Sprint 1-5 机制实证矩阵 8/8**（e2e03 + e2e04 合并）。三项额外发现：A. patches 跨树预检 false positive / B. worker 不能当 parent（L1072）/ **C. isFlagged 动态 worker 分支 = dead code（SubAgent 核实确认）**。

---

## 二、P1 修复 + 发现 C（commit 02ed53e）

- e2e03 产物 3 瑕疵修复（drift kind escalation→production / source segment→create_session / data-model 附录A.3 role 描述纠正）
- ARCHITECTURE §3.1 pro userData `.proma-pro`→`.proma-dev`
- CLAUDE.md 加 **commander 跨树预检 false positive 陷阱**（e2e04 踩坑）+ userData 条更新
- 发现 C（isFlagged dead code）SubAgent 全引擎核实确认：isFlagged 唯一调用点 L1092 + worker 不能当 parent → 动态分支走不到

---

## 三、thdev tree 调度（commit c583559 + f0f6ced）

用 tree-system 调度 thdev tree（主会话 a5c20252 作 root，workspace=proma）派 3 worker 独立子会话处理单边深化。

| Worker | 结果 |
|---|---|
| **W1 删 dead code** ✅ | tree-engine.cjs L1361 删第3动态分支 + **全量测试 16/0 零回归** + 部署 pro（dist `818f6cb2` + 重启加载新引擎）|
| **W2 方向1 深化** ✅ 颠覆性 | clone proma-ai/Proma（HEAD **v0.14.20**）+ first-pr-draft §九 116 行实证：方向1 gap **成立**（stale-meta 漂移：session.meta 创建后永不回写，功能性消费者读陈旧值）。TS 草案 sendMessage 单点守卫 ~15 行。就绪度 65-70%，建议 Issue 先行 |
| **W3 文档** ✅ | CHANGELOG（e2e04+dead code）+ sprint-plan（引擎版本+端到端8/8）|

**🔴 余额阻塞**：GLM-5.2 两渠道（ZLM cbb12a0b + proma-official）都 billing_error/unknown_error。worker 卡，**核心验证由主会话补完**（W1 测试 16/0 + W2 源码核实 L621→被 W2 深化纠正）。thdev tree done 门禁未走完（worker 卡 + self_audit_forbidden 不让 root 代写 done），但实质成果全提交。

---

## 四、设计 vs 实现 gap audit（4 类）

| 类别 | 内容 | 性质 |
|---|---|---|
| 🔴 **真未落地**（单边可做） | **human_checkpoint**（unified-workflow §八 5 介入点，明标"尚未落地无 Sprint 承接"）/ **中档限权替代机制**（autonomy_override 删后未补）/ **TaoWatcher file-log**（Sprint4 follow-up）/ **Layer2 完整 review_round 文件相关性校验** | 设计完未实现 |
| 🟡 **跨仓根治**（远期） | Layer4：subagent_trace_id / capability-based / event hash chain / E4 SDK 回调 / E5 fork identity | 单边无法 |
| ⚪ **v1 有意不做** | Q2 树形 UI（v2 候选）/ 垂直化产品 / Layer4 模型契约 | 范围决策 |
| 📊 **外部数据** | success-metrics 实测（需 E3 跑 45 次） | 需实验 |

**最显著真 gap = human_checkpoint**（有设计 + 有 macp2/macp4 真实需求证据 + 零 Sprint 承接）。

---

## 五、🔴 关键教训（5 条，已入 note.md / CLAUDE.md）

1. **GLM 余额不足**：glm-5.2 两渠道都 billing_error。worker 卡，核心验证主会话补完。包月 Max 可能不含 glm-5.2（待用户确认含哪个 model）。
2. **主会话浅判错误**：L621 快速 grep 判"方向1 不成立"，W2 深入读源码纠正为"成立"。**复杂 gap 不能浅 grep**——最深刻教训。
3. **隶属子会话 + workspace**：create_session 默认去 default 工作区（南大项目），须显式 `workspace_id=proma`；隶属靠 tree leaf（added_by=root），**不靠 fork**（fork 继承主会话 489 条历史太重）。
4. **W-08 leaf purity + archive 时机**：worker 不直接写 tree（上报 commander，root 写 event）；archive 跑中的 worker 丢上下文（应等停再 archive）。
5. **监督读 tree-state.json**（e2e03 教训延续）：文件通道是 ground truth，API 消息数不可靠。

---

## 六、待续清单

**外部依赖**（E1-E5，详见 [external-dependencies-backlog.md](../05_PROJECT_PLAN/external-dependencies-backlog.md)）：
- 🔴 **E1 首个 PR**：W2 深化已就绪（方向1 stale-meta + TS 草案），建议 **Issue 先行**（proma-ai/Proma，附 §九 证据）→ PR。target v0.14.x。
- 🟠 E2 团队试用 / E3 对照实验（~$45-225）/ 🟡 E4-E5 跨仓根治（Layer4）

**第 1 类真 gap**（单边可做）：
- human_checkpoint 立 Sprint（引擎字段 + SKILL 指令 + 检查表，中等工作量）
- 中档限权替代 / TaoWatcher file-log / Layer2 完整（轻量 follow-up）

**pro 残留清理**：e2e03/e2e04/thdev 的 idle/archived 会话（remote 无法归档，走 pro 本地 UI）。

---

## 七、当前可信基线

- **全量测试**：367/0（+ thdev W1 删 dead code 后 16 文件零回归，引擎 md5 `818f6cb2`）
- **pro 引擎**：`818f6cb2`（删 dead code，dist 部署 + 重启加载新引擎；dead code 不可达，运行时零行为差异）
- **Sprint 1-5 机制实证矩阵**：8/8（e2e03 正向 + e2e04 负面）
- **工作区**：干净（4 commit 全提交，HEAD `f0f6ced`）

---

> 本阶段由主会话 a5c20252 于 2026-07-15 晚执行。下个会话接手可读本总结 + note.md 顶部 thdev/e2e04 条目 + handoff-2026-07-15.md 恢复 context。
