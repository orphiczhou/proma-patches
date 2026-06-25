# Proma 改造项目主交接清单 2026-06-25 20:45

> 维护: 周星星 + Proma Agent (ef3bb7f0) | 创建: 2026-06-25 20:45
> 用途: 新会话主入口 | 上次更新: V10 Phase 3 收尾后
> 5 分钟拿全貌: §一 + §二 + §五
> 15 分钟理解 V10 收尾: + §三 + §四
> 30 分钟完整恢复: + §六 30 分钟档

---

## 一、当前状态摘要

**V10 Phase 3 收尾完成**（接力 a8111bf5，commit `30eb4fa`）。

- ✅ Bug A/B 4 处引擎修复 + 新错误码 `E_DUPLICATE_SESSION_ID`
- ✅ 代码同步到 workspace-files 顶层（用户指令"所有 cjs 在 workspace-files 一份"）
- ✅ 4 份 Bug 调查闭环报告 + V10 工程方法论 + 30 分钟入门向导
- ✅ 跨工作区问题深度调查报告（含 TAO Watcher 干扰指挥官根因）
- ⏳ 待用户决策 3 项：push / 重启 dev 验证 / 跨工作区清理
- 🔴 **遗留 2 个 P0 设计外问题**：跨工作区建树 + TAO Watcher 干扰 root

---

## 二、必读文档清单（按优先级）

### 🔴 P0 必读（5 分钟恢复状态）

| # | 文档 | 路径 | 一句话用途 |
|---|------|------|-----------|
| 1 | **本主交接清单** | `.context/handoff/master-handoff-2026-06-25.md` | 主入口，你正在读 |
| 2 | **V10 收尾交接** ⭐ | `.context/handoff/session-2026-06-25-v10-followup.md` | **本次新增核心 #1**，接力 a8111bf5 |
| 3 | **跨工作区问题报告** ⭐ | `.context/cross-workspace-tree-issue-2026-06-25.md` | **本次新增核心 #2**，含 TAO Watcher 根因 |
| 4 | PROJECT-INDEX | `.context/PROJECT-INDEX.md` | 项目全局索引（v0.16.5 + v0.7 + V4-V9 + V10） |

### 🟡 P1 深入读（15 分钟理解 V10 全貌）

| # | 文档 | 路径 | 用途 |
|---|------|------|------|
| 5 | note.md（顶部 5 条） | `.context/note.md` | 最新进度笔记 |
| 6 | Bug A/B 修复验证 | `.context/v10/bug-fix-validation.md` | 4 处修复的精确 diff + 验证方法 |
| 7 | commander-methodology-v10 | `.context/commander-methodology-v10.md` | V10 工程方法论（5h/17 节点实战沉淀） |
| 8 | project-onboarding-guide | `.context/project-onboarding-guide-2026-06-25.md` | 30 分钟新会话入门向导（图形化） |

### 🟢 P2 参考（按需读）

| # | 文档 | 路径 | 用途 |
|---|------|------|------|
| 9 | v10/bug-a-investigation | `.context/v10/bug-a-investigation.md` | Bug A 详细调查（532465c5 commander 谎报） |
| 10 | v10/bug-b-investigation | `.context/v10/bug-b-investigation.md` | Bug B 详细调查（15109031 session 歧义） |
| 11 | proma-dev-wiki | `.context/proma-dev-wiki.md` | 补丁命令、架构、测试记录 |
| 12 | v10-implementation-charter | `.context/plan/v10-implementation-charter.md` | V10 八大加固点章程 |
| 13 | progress-report-2026-06-25 | `.context/progress-report-2026-06-25.md` | 6/20→6/25 五天阶段性总结 |
| 14 | 早晨交接（followup-tree-mode） | `.context/handoff/session-2026-06-25-followup-tree-mode.md` | V4-V9 followup 收尾（早晨） |

---

## 三、本次新增的两份核心文档（重点说明）

### ⭐ 核心文档 #1：V10 收尾交接

**路径**: `.context/handoff/session-2026-06-25-v10-followup.md`

**作用**: 接力 a8111bf5 主线指挥官会话（因 TAO Watcher 干扰意外终止），完整记录 V10 Phase 3 收尾状态。

**为什么必读**:
- 包含 **a8111bf5 终止的根因**（TAO Watcher 监督消息发到根指挥官）
- 4 处代码修复的精确位置（L84/L705/L1498/L1897/L2337）+ 新错误码定义
- **4 个 Auditor 审查结论**（特别是 Auditor #2 `76e5d898` 发现的 hasDone 漏洞，建议已采纳）
- 代码同步策略（用户指令"所有 cjs 在 workspace-files 一份"）
- 当前 commit `30eb4fa` 的完整 32 文件变更清单

**关键章节**:
- §已完成（接力 a8111bf5）— 4 处修复 + 代码同步 + Auditor 结论 + 文档沉淀
- §未完成（需用户决策）— push / 重启 dev / 跨工作区
- §关键技术决策（新会话必读）— 6 条核心决策

**最重要的一句话**: Bug A 双重保障（A-1 入口拦截 + A-2 审计兜底），Auditor #2 独立发现 hasDone 漏洞证明 Tree 模式三层分离对抗确认偏误有效。

### ⭐ 核心文档 #2：跨工作区问题报告

**路径**: `.context/cross-workspace-tree-issue-2026-06-25.md`

**作用**: 跨工作区建 Tree 问题 + TAO Watcher 干扰指挥官问题的深度调查报告，**包含两个 P0 设计外问题的根因和修复方案**。

**为什么必读**:
- **问题 1 根因**：commander 跨工作区开 Tree（详见 §四 问题 1）
- **问题 2 根因**：TAO Watcher 干扰 root 指挥官（详见 §四 问题 2）
- 完整修复方案（短期 / 中期 / 长期，按优先级排）
- 关键文件位置 + 行号（main.cjs:386651 / patches.cjs:446 / session-management SKILL.md 行 71-78）
- 涉及会话拓扑（tree-2 创建者 7c9b6b65、审计链、undefined 孤儿）

**关键章节**:
- §一现象 — 9 个工作区清单 + 价值评估
- §二根因（确认） — 平台 + SKILL 双重放任
- §三影响范围 — 跨工作区 tree 数据隔离 / workspace_id 漂移 / 审计链断裂
- §四设计意图 vs 实际行为对照
- §五修复方案（按优先级） — P0/P1/P2 三档
- §六关键文件位置
- §七 TAO Watcher 干扰指挥官问题（独立立项）
- §八下一步建议（带工作量估算）

**最重要的一句话**: 两个 P0 问题不修复，将持续导致指挥官会话意外终止 + 审计链断裂。

---

## 四、必办事项（用户需推动）

### 🔴 问题 1：跨工作区建树会话问题

**现象**:
`~/.proma/agent-workspaces/` 下当前存在 **9 个工作区**（设计意图只有 1 个 `proma` 主工作区）：

| 工作区 | 价值 | 处理 |
|--------|------|------|
| `proma` | 主工作区，必须保留 | 不动 |
| `tree-2` | **含 v10-p2-e2e-report.md + v10p2-e2e tree-state.json** | **归档关键产出后清理** |
| `default` | 含大量历史会话子目录 | 评估后清理 |
| `tree-1` | 13 个空会话目录，无 tree-state.json | 直接删 |
| `undefined` | slug "undefined" bug 孤儿 | 直接删 |
| 4× `workspace-{ID}/` | 早期临时测试，无 .context | 直接删 |

**根因（确认）**:
1. `main.cjs:386651` `createAgentSession(title, channelId, workspaceId, modelId)` — **不校验 workspaceId 是否在索引中存在**
2. `proma-dev-patches.cjs:446` MCP `create_session` handler — 原样透传 `args.workspace_id`，无权限边界
3. `skills/session-management/SKILL.md` 模式 4（行 71-78）**明确教授** `create_session(workspace_id="xxx")` 跨工作区操作
4. **没有 `create_workspace` MCP 工具**，但 commander 能用任意 workspace_id 挂 session

**影响**:
- 跨工作区 tree 数据主工作区看不到（tree-2 的 v10p2-e2e 30 writes 在主工作区查不到）
- workspace_id 漂移导致 `mcp__tree__*` 直调失败（与 dev MCP workspace=null bug 同源）
- 审计链断裂（tree-2 的 auditor leaf 物理在 tree-2，主工作区 audit 覆盖不到）
- 磁盘膨胀（tree-2 含 21 个会话子目录 + 3 个 auto backup）

**修复路径**（详见 cross-workspace 报告 §五）:
- **P0 短期（30 分钟）**: 归档 tree-2 关键产出 → 清理 5 个无价值工作区
- **P1 中期（1 小时）**: patches.cjs:446 加 workspace_id 校验拦截（commander 不能跨工作区）
- **P2 长期（2 小时）**: main.cjs createAgentSession 加白名单（sed 补丁）+ session-management SKILL 模式 4 修订

### 🔴 问题 2：TAO Watcher 干扰 root 指挥官问题

**现象**:
a8111bf5 主线指挥官会话（"重新开始-进度控制V2 (fork)V10收尾"）因 TAO Watcher 把 worker 规则发给根指挥官，导致思维混乱意外终止。

4 个 Bug Auditor 子会话（`abf92aed` / `76e5d898` / `1795cea8` / `1cdd1ecf`）都收到了：
- `W-01 (high): worker 首条 assistant 消息无 brief_echo`
- `C-13 (mid): commander 缺 worker 子 leaf（需 ≥4 独立审查）`

**根因**:
TAO Watcher 没有按 leaf `role` 区分规则——对所有 leaf 用同样的检查项。root/commander 不应被 worker 规则约束（如 W-01 brief_echo 是 worker 视角的 SKILL §3.4 要求）。

**影响**:
- **所有指挥官会话稳定性**：不修复将持续导致指挥官会话意外终止
- 规则错配让指挥官被"机械检查"拖累，影响主线推进效率
- 已经导致 a8111bf5 V10 收尾使命未完成（接力会话 ef3bb7f0 才收尾）

**修复方案**（详见 cross-workspace 报告 §七）:
- TAO Watcher 按叶子 role 应用不同规则集
- **worker 规则**（W-01 brief_echo, W-08 leaf purity）只发给 role=worker 的 leaf
- **commander 规则**（C-13 缺 worker）只发给有下属的 commander leaf
- **root 规则**：豁免 W-01（root 无 supervisor，不需要 brief_echo 对齐）

**工作量估算**: 2-3 小时（patches.cjs 的 TAO Watcher 实现层 + SKILL 规则定义层）

---

## 五、3 项待用户决策

| # | 决策项 | 操作 | 风险 |
|---|--------|------|------|
| 1 | **push 4 个 commit 到 GitHub** | `cd workspace-files && git push origin master` | 推到公开仓库，4 个 commit 一次性公开 |
| 2 | **重启 dev 实例**验证 Bug A/B | 关闭 Proma-white → 重开 start-dev.bat | 需用户操作，影响 dev 当前会话 |
| 3 | **处理跨工作区 + TAO Watcher** | 详见 §四 两个 P0 问题 | 不修复将持续导致指挥官会话意外终止 |

**4 个待 push 的 commit**:
- `30eb4fa` V10 Phase 3 — Bug A/B 修复 + 代码同步（本次）
- `7d36cc7` V10 Phase 2 — root-as-trust-anchor + Agent helper
- `f98805d` 新建 v10v/vfa1/vfb/fupv 开发树
- `8c81cc5` PROJECT-INDEX/note/进度报告同步到 6/25

---

## 六、快速恢复路径

### 🚀 5 分钟（拿全貌）
1. 本文件 §一 + §二 + §五
2. PROJECT-INDEX 顶部（一句话定位 + Layer 1/2 完成度）
3. v10-followup §一句话状态

### 📚 15 分钟（理解 V10 收尾）
+ v10-followup 全文（接力 a8111bf5 的完整状态）
+ cross-workspace §一现象 + §二根因（理解两个 P0 问题）

### 🎓 30 分钟（深度理解）
+ v10/bug-fix-validation.md（4 处修复精确 diff + 验证方法）
+ v10/bug-a-investigation.md 前 50 行（commander 谎报的攻击路径）
+ commander-methodology-v10.md 前 80 行（V10 工程方法论概述）

### 🏆 60 分钟（完整入门）
+ project-onboarding-guide-2026-06-25.md（图形化 30 分钟入门向导）

---

## 七、当前实例状态

```text
dev     @ 127.0.0.1:19877  (Proma-white, D:/Proma-dev) — ISOLATED=1 数据 ~/.proma-dev/
  └ 含 V10 Phase 1+2+3 + Bug A/B 修复（dist 已更新 19:15，待重启加载）

release @ 127.0.0.1:19876  (Proma-coral, D:/Proma-dev) — ISOLATED=0 共享 ~/.proma/
  └ 用户明确指示"不同步 release"，本会话不动（仍停在 6/24 09:17）

正式版 (D:/Proma/) asar 打包 135MB，与 dev/release 完全分叉，不动
```

**两变量体系**:
- `PROMA_INSTANCE_NAME` 管身份（remote-session 发现、AppUserModelId）
- `PROMA_INSTANCE_ISOLATED` 管数据隔离（1=独立、0=共享）

---

## 八、关键 commit 时间线（最近 5 个）

| Hash | 时间 | 内容 |
|------|------|------|
| `30eb4fa` | 2026-06-25 20:33 | **V10 Phase 3** — Bug A/B 修复 + 代码同步 + 文档沉淀（本次接力） |
| `7d36cc7` | 2026-06-25 17:30 | V10 Phase 2 — root-as-trust-anchor + Agent helper 配套 |
| `f98805d` | 2026-06-25 早 | 新建 v10v/vfa1/vfb/fupv 开发树 + 历史树 heartbeat |
| `8c81cc5` | 2026-06-25 早 | PROJECT-INDEX/note/进度报告同步到 6/25 + 多份交接 + 架构方案 |
| `1757b5e` | 2026-06-23 | V10 Phase A — 12 DbC 校验点 |

---

## 九、新会话第一步

1. **读本文件 §一 + §二**（5 分钟拿全貌）
2. **读 v10-followup**（10 分钟理解接力状态）
3. **询问用户**：3 项决策（push / 重启 dev / 跨工作区+TAO Watcher）哪个先做？
4. **执行用户选择**

### 推荐优先级

如果用户没有明确指示，按以下顺序推进：

1. **P0 处理 TAO Watcher 干扰**（不修将持续导致指挥官会话意外终止，影响所有后续工作）
2. **P0 清理跨工作区**（5 个无价值工作区，30 分钟搞定，避免审计链继续断裂）
3. **P1 push commits**（让远端跟上本地，避免单点故障丢工作）
4. **P1 重启 dev 验证 Bug A/B**（运行时验证修复有效）
5. **P2 沉淀方法论**（把"接力收尾 + 跨工作区发现"沉淀到 commander-methodology-v10.md）

---

## 十、附：本次接力 ef3bb7f0 工作总结

**起点**: a8111bf5 主线指挥官会话因 TAO Watcher 干扰意外终止，V10 收尾使命未完成。

**做了什么**:
1. 回收 4 个 Bug Auditor 审查结果（abf92aed / 76e5d898 / 1795cea8 / 1cdd1ecf）
2. 验证 4 处代码修复在 dev dist 中（含 Auditor #2 建议的 hasDone 检查）
3. 同步代码到 workspace-files（顶层 tree-engine.cjs + proma-dev-patches.cjs + patch-l/）
4. commit `30eb4fa` V10 Phase 3（32 文件 +286k/-186k 行）
5. 写跨工作区调查报告（含 TAO Watcher 根因）
6. 写 V10 收尾交接文档（接力 a8111bf5）
7. 写本主交接清单

**未做（等用户决策）**: push / 重启 dev / 跨工作区清理 / TAO Watcher role 修复

**关键收获**: Tree 模式三层分离（实现/评价/洁净室）对抗确认偏误有效——Auditor #2 独立发现 hasDone 漏洞证明价值。

---

## 十一、维护约定

- 重大变更后更新本主交接清单的 §一状态摘要 + §八 commit 时间线
- 新增 P0 必读文档加入 §二 P0 表格
- 用户决策完成后从 §五 移到 §十本次工作总结
- 保持本文件 < 350 行（详细但不冗余）
