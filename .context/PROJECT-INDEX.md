# Proma 改造项目 — 知识索引

> 入口文档 | 维护: 周星星 | 最后更新: 2026-06-26 18:20（IHL R1-R6 Audit Tamper Detection 闭环后同步）

新会话从这里开始读，能 5 分钟拿到项目全貌和关键路径。

---

## 一、一句话定位

基于 **Proma 商业版（AGPL-3.0）**，通过 **sed 补丁 + 独立插件文件** 叠加闭源能力，目标是构建垂直化 AI 助手产品。**核心策略：开源做壳，闭源做肉。**

---

## 二、当前完成度（v0.16.5 + v0.7+ 引擎 + V4-V9 DbC + V10 内容校验 + Phase 3 Bug A/B 修复 + IHL R1-R6 Audit Tamper Detection）

### Layer 1 — MCP 基础设施 ✅ 完工（v0.16.5）

- **三开环境**：`D:\Proma\`（正式版不动）/ `D:\Proma-dev\`（隔离 `~/.proma-dev/`）/ `D:\Proma-release\`（共享正式版数据，`ISOLATED=0`）
- **22 个 MCP 工具**：11 本地 `mcp__session__*` + 11 远端 `mcp__remote-session__*`
- **外部 MCP 桥接**：`proma-mcp-server.cjs`（stdio）→ localhost HTTP bridge（19876-19895 自动选端口）
- **两变量体系**：`PROMA_INSTANCE_NAME` 管身份 + `PROMA_INSTANCE_ISOLATED` 管数据隔离（v0.16.5 修正）
- **会话间通信**：`send_message` 三模式 — `wait=true` 同步返回 / `notify=true` 异步通知 / `wait=false` + 轮询回收
- **11 个核心补丁** A-K（详见 wiki §5）：A-C 基础能力、D-E 渲染器、F 跨频道防护(被 H 替代)、G SDK 路径、H 跨频道/模型切换完整修复、I 禁更新、J AppUserModelId 隔离、K userData 动态路径
- **remote-session Release 验收**：⚠️ 有条件通过（39/40，1 个 fork new_title Bug，不阻断上线）
- **session-management Skill v1.3.0** + **GitHub 仓库** `orphiczhou/proma-patches` + `apply-patches.sh` v0.16.5

### Layer 2 — 树形会话执行体系 ✅ v0.2.2 + v0.7 Phase A + v0.7+ 引擎内联 + V4-V9 DbC + V10 内容校验 + Phase 3 Bug A/B 修复 + IHL R1-R6 Audit Tamper Detection（工作区零源码）

- **[2026-06-27 09:36] R1 洁净室测试 + Worker 生命周期规范**: 4 个 Commander（A 功能正确性 10 用例 / B 对抗攻击 12 用例 / C 端到端 8 用例 / D Prompt Injection 8 用例）共 **38 用例**并行测试，综合通过率 **89.5%**。**关键胜利**：D 系列 **8/8 全过**，V10 trust anchor 完美防御 Prompt Injection（含 6/26 历史注入重放 18/18）；A 系列 12 项 V10 安全机制 11 项生效；C 系列 E_BORROWED_IDENTITY 拦截验证 Bug A 修复到位。**关键漏洞**：**P0** B9 applyNudge 规则绕过（rule_id 任意）+ B12 expect_outputs 路径遍历（`/etc/passwd` 类无校验）+ **P1** Fork 幻觉（C1+C5 双重确认，fork 缺身份提示自主越权）+ Auditor 鸡生蛋死锁（worker 占满 node_budget 无法创建 auditor）+ B5 audit_log 伪造（PARTIAL，缺专用 W-AUDIT-TAMPER）。回收后产出综合分析报告，并**首次撰写独立 Worker 生命周期规范**（6 阶段 25 事件 8 道审计关 7 类参与者，含完整 Mermaid 时序图 + 状态机 + 错误码全表 + P0/P1 gap 清单，可作为团队对齐契约）。详见 [测试计划](./v10/cleanroom-test-plan-2026-06-26.md) + [R1-A](./v10/cleanroom-round1-a-2026-06-26.md) / [R1-B](./v10/cleanroom-round1-b-2026-06-26.md) / [R1-C](./v10/cleanroom-round1-c-2026-06-26.md) / [R1-D](./v10/cleanroom-round1-d-2026-06-26.md) + [R1 综合分析](./v10/cleanroom-round1-recap-2026-06-27.md) + [Worker 生命周期规范 v1.0](./v10/worker-lifecycle-spec-2026-06-27.md)。**下一步**: R2 修复 3 个 P0/P1 后视角互换（A↔C / B↔A / C↔D / D↔B）
- **[2026-06-26 18:20] IHL R1-R6 — 盲点驱动的迭代加固 + Audit Tamper Detection** (4 commits `1a7ed5f`/`031c546`/`d44163a`/`690f7e8` 已推 orphiczhou/proma-patches): 6 轮 **Iterative Hardening Loop (IHL)** 收敛 — R1 applyNudge 全局守卫（堵 9c423b8 tree 级规则盲点）/ R2 create_session workspace_id 校验（堵子会话落 "undefined" slug）/ R3 V4 Pro commander 端到端 / R4 fork_session 同类漏洞（审计驱动复用 R2 helper）/ R5 加 4 条 W-AUDIT-* 事后检测 / R6 R5 规则移到 Tier 1 绕开 status 守卫。**v626 tree-state.json 被直接篡改**（自审通过 + worker 当 auditor + audit_log 伪造 pass=true）暴露静态审计盲区 → 4 条 tamper detection（W-AUDIT-SELF/WORKER/TAMPER/NO-ALIGN）。**3 层防御拓扑定型**：入口拦截层（cmdEventAppend L1498 / cmdLeafAdd L705 / create_session L461 / fork_session L601）+ 兜底守卫层（cmdAuditGate L2337 / resolveAuditorIndep L1897 / applyNudge sharedCount）+ 事后检测层（W-AUDIT-*）。**Prompt Injection 实战防御副产品**：会话期间 6 条诱导 root（ce9a1e2f）滥用 audit_gate 的注入全部拒绝响应。3 份 patches.cjs 物理同步（仓库 + dev dist + patch-l，2658 行一致），Dev/Release 已重启加载。详见 [v626-r5-r6-audit-tamper-detection](./v10/v626-r5-r6-audit-tamper-detection.md) + [v626-iteration-recap](./v10/v626-iteration-recap.md) + [runtime-verify-2026-06-26](./v10/runtime-verify-2026-06-26.md) + [fix-tao-watcher-session-shared](./v10/fix-tao-watcher-session-shared.md)。**下一步**: TAO Watcher 按角色区分规则 / Phase D 用户层 bug / 跨工作区清理
- **[2026-06-25 20:36] V10 Phase 3 — Bug A/B 修复 + 代码同步仓库 + 文档沉淀** (commit `30eb4fa`): Bug A（commander 代 worker 写 done event）+ Bug B（同 session 多 leaf 歧义）双重修复。**4 处引擎改动**：A-1 cmdEventAppend L1498（只允许 leaf.session_id 自己写）+ A-2 cmdAuditGate L2337-2345（**Auditor #2 发现的 hasDone 漏洞**，检查 caller_session_id）+ B-3 cmdLeafAdd L705-718（**新错误码 `E_DUPLICATE_SESSION_ID`** + session_id 唯一性校验）+ B-4 resolveAuditorIndep L1897-1911（.filter 跳过 pruned）。**代码同步到 workspace-files 顶层 + patch-l/**（按用户指令"所有 cjs 在 workspace-files 一份"）。4 个 Auditor 审查回收（Auditor #2 价值再次证明）。a8111bf5 主线会话因 **TAO Watcher 规则错配**意外终止，bc005820 接力完成。详见 [v10-followup 交接](./active/session-2026-06-25-v10-followup.md) + [跨工作区问题报告](./active/cross-workspace-tree-issue-2026-06-25.md)。**下一步**: push 4 commits / 重启 dev 验证 / 跨工作区清理
- **[2026-06-25 17:55] V10 Phase 2 — root-as-trust-anchor + Agent helper 配套**: 详见 [v10/](./v10/) 17 份报告 + [v10-p2-e2e-report](./audit/v10-p2/v10-p2-e2e-report.md)。V10 8 大加固点（auditor-active / self-audit-v2 / uuid-strict / numeric-consistency / nudge-escalation / timestamp-monotonic / workspace-canonical / status-event-sync）+ Trust Anchor（root 自审特例解决鸡生蛋）+ D4 Helper 4 层自助文档（堵模型层失守）。164 测试全过，真实环境 V10 Phase 2 e2e 生产就绪
- **[2026-06-25 12:19] V10 Phase 1 — 8 大加固点 + 双轮收敛**: 把 V4-V9 的「字段存在性校验」升级为「内容有效性校验」。V4-V9 形式完整但实测对真实攻击 **0% 拦截**（audit-gate-test-20260625 失守案例）。Tree 模式三层分离（实现/评价/洁净室）：A1 代码层评 8/8 合格，**Cr 洁净室独立测试发现 10 个真实失守**（Cr 优先于 A1）。详见 [charter](./reference/plans/v10-implementation-charter.md) + [commander-methodology-v10](./reference/methodology/commander-methodology-v10.md)
- **[2026-06-25 08:35] V4-V9 followup（Tree 模式实战早期）**: 用 Tree 模式（4 commander 顺序 + 4 评价子 Agent + 洁净室 3 轮 31 测试 29 pass）落地 followup proposal，2 commit 入库（`efbf139` + `59357f1`）。C1 全量扫描 MCP schema、C2 修 3 个 gap（nudge_append 接口不兼容 / nudge_reset 工具缺失 / migrate dry_run）、C3 同步文档 role 枚举 + audit_append 结构、C4 加 milestone_empty_outputs 软警告。**洁净室发现 R2-T7**（audit_append results[i] 校验缺失，low，待用户决策 A/B/C）。**关键收获**：Tree 模式三层分离（实现/评价/洁净室）对抗确认偏误有效——R2-T7 是洁净室独立从 spec 写测试才暴露的（实现者+4 评价都漏）。dbc-spec 39/0、audit-attacks 18/0。**下一步**: 重启 dev/release 验证 C2/C4 / push GitHub / R2-T7 决策。详见 [followup 交接](./active/session-2026-06-25-followup-tree-mode.md) + [progress-report-2026-06-25](./active/progress-report-2026-06-25.md)
- **[2026-06-24] V4-V9 DbC 深度加固**: tree-engine.cjs **9 个硬约束点**（V4/V5b/V6/V8/CP2/V9 + 审计[1][2][3]），audit-attacks **18 攻击 0 BYPASS**，dbc-spec **36/0**。Tree 方法论（实现/测试/审计分离 + 自举 + 迭代收敛）：collaboration 独立审计子会话对抗发现并修复 3 个实现者盲点（alignment_pending 标志篡改 / budget 字符串 / symlink）。关键教训：**安全检查不依赖可篡改布尔标志，验 events 留痕**。V4/V5b 破坏性（milestone set-result 需 auditor；worker done 需 alignment 回填）。Layer4 残留（互审洗白/冒用）。详见 [note.md](./note.md) + wiki §二十。**下一步**: 重启 dev 验证 / tree-commander SKILL alignment 职责 / Layer4
- **[2026-06-23] v0.7+ 引擎内联 MCP**: tree-state.js(2428行)→`tree-engine.cjs` 内联进 patches.cjs 的 mcp__tree__*(27工具)，消除 spawn 包装，**工作区零源码泄漏**（agent 看不到改不到引擎代码）。`run(cmd,args,treesRoot?)`与CLI stdout等价；TREES_ROOT可注入；per-call treesRoot并发安全；findEngine自适应定位engine。验证: smoke+dbc-spec 21/0+audit-attacks 18/CRITICAL=0+A1独立审计子会话。部署 dist/(patches+engine)+激活SKILL+清理3处遗留。详见 [note.md](./note.md)。**下一步**: 重启验证/V4-V8/Phase D/Layer4
- **[2026-06-23] v0.7 Phase A 完成** (commit `1757b5e`)：tree-state.js **+12 DbC 校验点**（A1-A7 + HARDEN2/HARDEN6 + V1/V2/V3 审计加固），把 SKILL.md 的"应当"升级为代码"必须"，对应 CP1-CP6 + SP1 + 节点预算 + 加固#2/#6。**实施**: 4 批次真实子会话(自举) + commander 独立验收(dbc-spec 21/0) + 独立对抗审计发现 BLOCKER 已修 V1(restore旁路)/V2(auditor白名单)/V3(expect_outputs非空)。重构提取 collectValidateIssues + resolveAuditorIndep。详见 [note.md](./note.md)。**下一步**: 部署+T1-T4回归 / Phase D / V4-V8深度加固 / Phase B-G / Layer 4 subagent_trace_id
- **核心交付**：tree-state.js v0.2.2 + Phase A（ROLE_ENUM + E_DEPTH_EXCEEDED + 12 DbC + collectValidateIssues + resolveAuditorIndep 白名单 + migrate + 深度限制 + Worker禁子节点 + 根唯一性）、tree-commander SKILL v2.2、tree-worker SKILL v2.2、commander-methodology v1.2（13原则）
- **Q1 v2 验证**（2026-06-21）：全深度 3 层测试 + 3 轮独立 Agent Team 审计，发现 8 项问题（2 阻断/3 严重/2 中等/1 低），核心引擎功能正确但方法论合规性存在结构性缺陷
- **Q2 方案**（v1.1 更新）：(a) **tree-state.js v0.2.2 硬化**（修复 ROOT_PLACEHOLDER、CLI 手动注入、Events 空洞——~90行代码）；(b) 侧边栏树形可视化面板（需新补丁 L）
- **Q3 方案**（v1.2）：天道运行官硬约束流程执行体系（35条规则，audit-gate + Pulse + Auditor + 自检，不新增补丁）
- **技术报告**：[`.context/reference/design/technical-report-tree-system-issues.md`](./reference/design/technical-report-tree-system-issues.md) — Q1 v2 8 项问题详细分析与解决方案
- **已知限制**：notify未验证、心跳/内审仅方案、竹节交接未实现、I3并发竞态、Commander prune级联未定义

---

## 三、核心架构速查

### 修改方式：三层

| 层 | 文件 | 适用 |
|---|---|---|
| `main.cjs` | sed 字符串替换 | 常量改、小段注入（补丁 A-K） |
| `proma-dev-patches.cjs` | 独立插件文件 | 新增 MCP 工具（27 个 tree_* + 11 session_* + 11 remote_*）、复杂逻辑 |
| `tree-engine.cjs` | 内联进 patches.cjs 的 mcp__tree__*（v0.7+） | 树形会话引擎，工作区零源码泄漏（agent 看不到改不到） |

**铁律**：不可从开源源码重构建 main.cjs —— 商业版有 15 个闭源模块（cloudAuth/sync/billing），源构建会导致登录失败。**正确方式：商业版 main.cjs + sed 补丁 + 插件文件 + 内联引擎。**

### 11 个核心补丁

| 补丁 | 功能 | 关键 |
|---|---|---|
| A | MCP 钩子注入 | `global.__proma_getMcpServers__` |
| B | API 桥接 + 加载插件 | `global.__proma__` 导出 12 个函数 + `require("./proma-dev-patches.cjs")` |
| C1-5 | 频道+模型元数据覆盖 | MCP 创建会话走后端正确频道/模型/API Key |
| D+E | Renderer 同步 + 守卫移除 | UI 模型选择器与 metadata 同步 |
| F | 跨渠道 sdkSessionId 防护 | **已被补丁 H 替代** |
| G | CLAUDE_CONFIG_DIR 无条件覆盖 | 修复 Dev fork 失败 0/3 → 3/3 |
| H | 跨频道/跨 provider 模型切换完整修复（v2） | channelId 或 modelId 任一变化 → 清 sdkSessionId + 同步 meta |
| I | 禁用更新检查 | `initAutoUpdater` 首行 return，不弹更新对话框 |
| J | AppUserModelId 动态隔离 | `com.proma.{NAME}`，三版任务栏独立 |
| K | userData 路径动态化 | `electron-{NAME}`（v0.16.5 修正：双条件 ISOLATED+NAME） |

### 22 个 MCP 工具分组

**本地 `mcp__session__*`**（无 instance 参数，进程内直连 `global.__proma__`）：
`get_my_session_id` / `list_channels` / `list_workspaces` / `list_sessions` / `get_session_info` / `get_session_context` / `list_messages` / `create_session` / `fork_session` / `send_message` / `archive_session`

**远端 `mcp__remote-session__*`**（多一个 `instance` 参数，自动端口扫描）：
`remote_*` 一一对应上述 11 个

### 实例隔离规则

```
PROMA_INSTANCE_ISOLATED=1  →  @proma/electron-{NAME}/  +  ~/.proma-{NAME}/   (隔离)
PROMA_INSTANCE_ISOLATED=0  →  @proma/electron/         +  ~/.proma/         (共享正式版)
未设置                       →  默认共享（兼容旧脚本）
```

✅ **v0.16.5 已修复（补丁 K 修正）**：恢复 `ISOLATED === "1"` 条件。`NAME` 管身份，`ISOLATED` 管隔离，两变量各司其职。Release 设 `PROMA_INSTANCE_NAME=release` + `ISOLATED=0` 即可有独立身份同时共享数据。

---

## 四、关键文档导航

### 工程入口文档（仓库根，新人必读）

| 文档 | 路径 | 用途 |
|---|---|---|
| **README** | `workspace-files/README.md` | 项目主入口（Quick Start + 架构 + 文档导航） |
| **LICENSE** | `workspace-files/LICENSE` | AGPL-3.0 + 闭源插件 ADDENDUM |
| **CHANGELOG** | `workspace-files/CHANGELOG.md` | v0.16.0 → V10 P3 版本演进 |
| **ARCHITECTURE** | `workspace-files/ARCHITECTURE.md` | 系统架构 + 三层防御拓扑 + 关键设计决策 |
| **API** | `workspace-files/API.md` | 53 个 MCP 工具完整参考（12+12+29） |
| **SECURITY** | `workspace-files/SECURITY.md` | 安全模型 + 威胁模型 + 漏洞报告流程 |
| **DEPLOYMENT** | `workspace-files/DEPLOYMENT.md` | 三实例部署 step-by-step + 已知坑 |
| **DEVELOPMENT** | `workspace-files/DEVELOPMENT.md` | 开发指南 + Tree 模式 + IHL 方法论 |
| **TESTING** | `workspace-files/TESTING.md` | 测试金字塔 + 6 套金标准 + Tier 1/2 规则 |

### 知识沉淀（`.context/`）

| 文档 | 路径 | 用途 |
|---|---|---|
| **本索引** | `workspace-files/.context/PROJECT-INDEX.md` | 知识沉淀层入口 |
| **目录导航** | `workspace-files/.context/README.md` | `.context/` 目录速查（新人 30 秒上手） |
| **入门向导** | `workspace-files/.context/project-onboarding-guide-2026-06-25.md` | 图形化 30 分钟建立心智模型 |
| **Tree 运行机制总览** | `workspace-files/.context/v10/tree-system-overview-2026-07-03.md` | 图形化整合「约束+驱动+实现」三视角（10 分钟建立 Tree 体系心智模型，新人必读） |
| **长期笔记** | `workspace-files/.context/note.md` | 按日期追加的调研笔记（顶部最新） |
| **待解决问题清单** | `workspace-files/.context/待解决问题清单.md` | 开放问题/接口陷阱/已知坑追踪（🔴 待解决 / 🟡 已规避 / 🟢 已解决，解决后改状态不删除） |
| **技术 Wiki** | `workspace-files/.context/proma-dev-wiki.md` | 补丁命令 + 架构 + 测试记录 + 版本历史 |
| **活跃文档** | `workspace-files/.context/active/` | 当前还在用的（8 份交接/进度/审计） |
| **跨阶段参考** | `workspace-files/.context/reference/` | 设计/方法论/架构/方案/模板/测试计划 |
| **历史归档** | `workspace-files/.context/archive/` | 一次性历史报告（按主题分目录） |
| **V10 专题** | `workspace-files/.context/v10/` | V10 加固全集（自包含，24+ 份报告） |
| 总路线图 | `workspace-files/.context/reference/design/proma-innovation-plan.md` | 两层架构总览 + 优先级 |
| Layer 2 设计 | `workspace-files/.context/reference/design/tree-commander-design.md` v1.3 | 树形体系完整设计文档 |
| 树形方法论 | `workspace-files/.context/reference/methodology/commander-methodology.md` v1.2 | 13原则（含Leaf Purity+分布式写入+三层深度） |
| **进度审计** | `workspace-files/.context/archive/2026-06-handoff/progress-report-2026-06-19.md` | v0.1/v0.2 完成度全面摸底（已归档） |
| **Q1 方案** | `workspace-files/.context/reference/plans/q1-state-architecture.md` v1.1 | role枚举+深度限制+分布式写入 |
| **Q1 e2e验证** | `workspace-files/.context/archive/2026-06-q1q3-audit/q1-e2e-verification-report.md` | 7 leaf 端到端全通过（已归档） |
| **Q1 全深度验证** | `workspace-files/.context/archive/2026-06-q1q3-audit/q1-full-depth-report.md` | 10 leaf 3层 38/38 全通过（已归档） |
| **Q2 方案** | `workspace-files/.context/reference/plans/q2-tree-ui-panel.md` v1.0 | 侧边栏树形UI面板（未实施） |
| **最新交接 IHL R1-R6** | `.context/v10/v626-r5-r6-audit-tamper-detection.md` | 6 轮迭代加固 + Audit Tamper Detection（4 条 W-AUDIT-* 规则）+ Prompt Injection 实战防御。配套: v626-iteration-recap / runtime-verify-2026-06-26 / fix-tao-watcher-session-shared（均在 `.context/v10/`） |
| **最新交接 V10 Phase 3** | `.context/active/session-2026-06-25-v10-followup.md` | Bug A/B 修复 + commit 30eb4fa + 文档沉淀 |
| **跨工作区问题报告** | `.context/active/cross-workspace-tree-issue-2026-06-25.md` | 9 个工作区调查 + TAO Watcher 干扰根因 + 修复方案 |
| **V10 工程方法论** | `.context/reference/methodology/commander-methodology-v10.md` | 5h/17 节点 Tree 模式加固工程实战沉淀 |
| **V10 P2 e2e 报告** | `~/.proma/agent-workspaces/tree-2/workspace-files/.context/v10-p2-e2e-report.md` | 真实 MCP 环境 6 阶段测试（tree-2 工作区，待归档） |
| **V10 Phase 2 交接** | （隐含在 v10/ 文档集） | root-as-trust-anchor + D4 Helper + Phase 2 e2e |
| **V10 Phase 1 交接** | （隐含在 v10/ 文档集） | 8 大加固点 + 双轮收敛 + Cr 优先于 A1 |
| **最新交接（6/25 早晨）** | `.context/active/session-2026-06-25-followup-tree-mode.md` | V4-V9 followup + Tree 模式实战 + R2-T7 待决策 |
| **6/25 进度报告** | `.context/active/progress-report-2026-06-25.md` | 6/20→6/25 五天阶段性总结 |
| **V4-V9 加固交接（6/24）** | `.context/archive/2026-06-handoff/session-2026-06-24-v4v9-hardening.md` | 9 DbC 硬约束点交付（独立审计迭代收敛）（已归档） |
| **Bridge 修复（6/24）** | `.context/archive/2026-06-handoff/session-2026-06-24-bridge-port-and-dbc.md` | 0.0.0.0 端口遮蔽 + DbC 运行时验证（已归档） |
| **运行时验证（6/24）** | `.context/archive/2026-06-handoff/session-2026-06-24-runtime-verified.md` | 双实例 27 工具 + 4 DbC 拦截（已归档） |
| **引擎内联（6/23）** | `.context/reference/plans/tree-engine-inline-mcp.md` + `archive/2026-06-handoff/session-2026-06-23-v0.7plus-engine-inline.md` | tree-state.js(2428行) → tree-engine.cjs 内联 MCP（零源码泄漏） |
| **Phase A（6/23）** | `.context/archive/2026-06-handoff/session-2026-06-23-v0.7-phaseA-mcp.md` | 12 DbC 校验点（commit 1757b5e）（已归档） |
| **专家审议 v1/v2（6/23）** | `.context/reference/architecture/expert-review-2026-06-23/` + `reference/architecture/expert-review-v2-2026-06-23/` | 五层防御架构 + 30/30/40 论断 |
| **架构方案（6/23）** | `.context/reference/architecture/architecture-plan-2026-06-23/` | 7 份方案（root-cause/defense/roadmap/decision-log 等） |
| **v2 完整诊断（6/23）** | `.context/reference/design/tree-system-architecture-analysis-2026-06-23.md` | Layer 0-4 五层防御深度报告 |
| **Q1 v1.1 完结交接（6/19）** | `.context/archive/2026-06-handoff/session-2026-06-19-handoff.md` | Q1 v1.1 完结 → Q2 推进（已归档） |
| 树形审计方法论 | `workspace-files/.context/reference/methodology/tree-audit-methodology.md` | 终局验证 × 树形体系强制执行 |
| remote-session 验收 | `workspace-files/.context/reference/test-plans/remote-session-release-report.md` | Release 验收 39/40 有条件通过 |
| remote-session 提案 | `workspace-files/.context/reference/design/proposal-remote-session-mcp.md` | 远端工具设计 + 实例命名 |
| Layer 2 原始设计 | `workspace-files/.context/reference/design/proma-dev-wiki-timeline-pruner.md` | 时间线剪枝者早期方案 |
| 发布包 | `workspace-files/release/tree-system-v0.2.0/` | v0.2.0 初始版本（17 文件） |
| **Q3 硬约束方案** | `.context/reference/plans/q3-tao-hard-constraint.md` v1.2 | TAO Watcher（35 条规则，audit-gate + Pulse + Auditor） |
| **Tree 方法论** | `.context/active/session-2026-06-25-followup-tree-mode.md` §关键技术决策 | 实现/commander/评价/洁净室三层分离 |
| **followup proposal** | `.context/reference/design/tree-engine-followup-fixes-proposal.md` | V4-V9 后续专家评估清单（已落地） |
| Skill | `skills/tree-commander/SKILL.md` v2.2 / `skills/tree-worker/SKILL.md` v2.2 | Commander+Worker 操作手册（v2.2 已补 V5b alignment 回填） |
| Skill | `skills/session-management/SKILL.md` v1.3.0 | 会话管理技能 |
| 部署 README | `workspace-files/README.md` + `AGENT-PROMPT.md` | 安装流程 |
| GitHub | `orphiczhou/proma-patches` + `apply-patches.sh` v0.16.5 | 一键部署 |

### 源码文件（部署位置）

| 文件 | 部署路径 | 说明 |
|---|---|---|
| `proma-dev-patches.cjs` | `[安装目录]/resources/app/dist/` | 主插件，含 22 工具 + HTTP bridge |
| `proma-mcp-server.cjs` | 同上 | 外部 stdio MCP 桥接（零依赖） |
| `apply-patches.sh` | 仓库根 | 一键部署 |
| `uninstall.sh` | 仓库根 | 卸载 |

---

## 五、当前卡点与待办

### 🔴 卡点 / 待决策（6/26 18:20）

- ✅ **push commits 到 GitHub**（V10 P3 4 个 + IHL R1-R6 4 个共 8 个 commit 已推 `orphiczhou/proma-patches`，远程同步到 `690f7e8`）
- ✅ **重启 dev 实例运行时验证 Bug A/B**（Dev/Release 已重启加载最新 patches.cjs 2658 行 + tree-engine.cjs 3602 行，IHL R1-R6 全部运行时验证 PASS）
- 🟡 **跨工作区问题（设计外）**：9 个工作区（应只有 1 主 proma），详见 [cross-workspace-tree-issue-2026-06-25.md](./active/cross-workspace-tree-issue-2026-06-25.md)。**v10-p2-e2e-report 已归档**到 `.context/audit/v10-p2/`，剩余：清理 5 个无价值工作区（undefined / tree-1 / 4×workspace-*）+ main.cjs `createAgentSession` 加 workspaceId 白名单（跨工作区 P2）
- **TAO Watcher 规则错配（P0/P1 独立立项）**：监督规则不按 role 区分——worker 规则（W-01 brief_echo）发给根指挥官，导致 a8111bf5 思维混乱意外终止。**9c423b8 入口守卫已修 + R1 applyNudge 全局守卫已补**，但**根本问题（按 role 应用不同规则集）仍未解决**。修复方向：root/commander/worker 各有专属规则集
- **Release 严重落后 1131 行**：dev 3602 vs release 2471，用户明确指示"不同步 release 目录"
- **Layer 4 残留（平台层依赖）**：互审洗白 + 冒用真实 session，需 subagent_trace_id 绑定

### 🟡 已知限制

- **正式版与 dev/release 分叉**：`D:\Proma\` 已打包为 `app.asar`（135MB 单文件），未应用任何 sed 补丁，停在原始 v0.12.23；dev/release 的 dist 已远超（tree-engine.cjs 2602/2471 行）。正式版未来同步需重打包
- **三实例版本号一致但内容不同**：package.json 都是 v0.12.23，但 dev/tree-engine.cjs 2602 行 vs release 2471 行（release 是 fork 快照，已落后 131 行）
- **remote-session fork new_title 忽略**：Fork 后标题始终追加 "(fork)"（中等，不阻断）
- **GLM 全线配额耗尽**：DeepSeek 官方频道 V4 Pro/Flash 可用（channel `56ecefd2-...`）
- **notify 异步上报未验证**：所有子会话用 wait=true 同步模式
- **Commander prune/archive 级联未定义**（M5 / Phase D1）
- **start-release-fresh.bat 异常**：指向 `D:\Proma-dev\Proma-coral.exe`（应为 release 目录），且 ISOLATED=1 实际跑在 dev 路径下

### ✅ 已修复（2026-06-18 ~ 2026-06-26）

| 版本 | 修复内容 |
|------|---------|
| v0.16.3 | Bug 1（补丁 H v2：跨频道/跨provider切换）、Bug 4（fork 跨 sdkSession 候选循环试错）、Bug 5（send_message 同步 meta） |
| v0.16.4 | 补丁 I（禁更新）、补丁 J（AppUserModelId 隔离）、补丁 K（userData 动态路径） |
| v0.16.5 | 补丁 K 修正：恢复 `ISOLATED === "1"` 双条件检查，防止 Release 误隔离 |
| v0.2.1 → v0.2.2 | 洁净室审计 22 项修正 + L1Fix v2 审计（7 worker × 2 round）+ Q1 v1.1 架构升级（role枚举/深度限制/migrate/Leaf Purity）+ ROOT_PLACEHOLDER/CLI 注入/Events 空洞修复 |
| v0.7 Phase A（6/23） | 12 DbC 校验点（A1-A7 + HARDEN2/HARDEN6 + V1/V2/V3 审计加固）+ collectValidateIssues + resolveAuditorIndep 白名单 + migrate（commit `1757b5e`） |
| v0.7+ 引擎内联（6/23） | tree-state.js(2428行) → `tree-engine.cjs` 内联进 patches.cjs MCP（27 工具），消除 spawn 包装，**工作区零源码泄漏** |
| Bridge 修复（6/24） | Dev bridge 0.0.0.0:19876 端口遮蔽 bug（Windows bat 必须 ASCII），3 实例 bridge fallback 全通过 |
| V4-V9 DbC 加固（6/24） | 9 硬约束点（V4/V5b/V6/V8/CP2/V9 + 审计[1][2][3]），audit-attacks 18 攻击 0 BYPASS，dbc-spec 36/0 |
| V10 Phase 1-2（6/25 12:19-17:55） | 8 大加固点（auditor-active/self-audit-v2/uuid-strict/numeric-consistency/nudge-escalation/timestamp-monotonic/workspace-canonical/status-event-sync）+ Trust Anchor（root 自审解决鸡生蛋）+ D4 Helper 4 层自助文档。164 测试全过。commit `7d36cc7`（P2）+ `f98805d`（开发树）。**核心教训：V4-V9 形式完整但实测 0% 拦截，v10 升级为内容有效性校验** |
| V10 Phase 3（6/25 20:36） | Bug A（commander 代 worker 写 done event）+ Bug B（同 session 多 leaf 歧义）双重修复。4 处引擎改动 + 新错误码 `E_DUPLICATE_SESSION_ID`。Auditor #2 独立发现 hasDone 漏洞（实现者+A1 都漏）。代码同步 workspace-files 顶层 + patch-l/。commit `30eb4fa` |
| IHL R1-R6（6/26 18:20） | 6 轮盲点驱动迭代加固：R1 applyNudge 全局守卫（堵 9c423b8 tree 级规则盲点）/ R2 create_session workspace_id 校验 / R4 fork_session 同类漏洞 / R5 加 4 条 W-AUDIT-* 事后检测 / R6 规则移到 Tier 1 绕开 status 守卫。**v626 tree 被直接篡改**（自审通过 + worker 当 auditor + audit_log 伪造 pass）暴露静态审计盲区。**3 层防御拓扑定型**（入口拦截 + 兜底守卫 + 事后检测）。**Prompt Injection 实战防御**：6 条诱导 root 滥用 audit_gate 的注入全部拒绝。3 份 patches.cjs 物理同步（2658 行一致）。commits `1a7ed5f`/`031c546`/`d44163a`/`690f7e8` |

### ✅ 已澄清（不是 bug）

- **Bug 2（Fork 截断 20 轮）**：auto-compact 从未触发 → Fork 不丢消息。感知错觉来自 `list_messages` 默认 `limit=50`

### 待办优先级（6/26 18:20）

| 优先级 | 任务 |
|---|---|
| P0 | **TAO Watcher 按角色区分规则**（堵 a8111bf5 类意外终止，2-3 小时；9c423b8 入口守卫 + R1 applyNudge 全局守卫已补盲点，但根本问题「规则不按 role 区分」未解） |
| P0 | **清理 5 个无价值工作区**（undefined / tree-1 / 4×workspace-*，跨工作区 P0；v10-p2-e2e-report 已归档到 `.context/audit/v10-p2/`） |
| P1 | patches.cjs 其他入口补 workspace_id 校验（R2/R4 已做 create_session/fork_session，迁移/恢复等入口可补） |
| P2 | Phase D：D1 prune/archive 级联语义 / D2 migrate 版本号 / D3 watcher silence_minutes |
| P2 | main.cjs `createAgentSession` 加 workspaceId 白名单（sed 补丁，跨工作区 P2） |
| P2 | session-management SKILL 模式 4 修订（明确 commander 不应跨工作区） |
| P2 | Layer 4 subagent_trace_id（平台层，大工程，单独立项） |
| P3 | Q2 树形 UI 面板（补丁 L）实施 — 已让位给 v0.7+ 引擎内联 |
| P3 | 沉淀"IHL / Tree 模式多会话协作"为可复用 Skill / remote-session fork new_title / I3 并发竞态 |

---

## 六、快速命令速查

### 启动

```bash
# Dev 版（双开，隔离数据）
D:\Proma-dev\start-dev.bat   # PROMA_INSTANCE_NAME=dev + ISOLATED=1

# Release 版（日常使用，共享正式版数据）
D:\Proma-release\start-release.bat   # PROMA_INSTANCE_NAME=release + ISOLATED=0
```

### 部署插件（改完代码后）

```bash
# Dev 版
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/
cp proma-mcp-server.cjs D:/Proma-dev/resources/app/dist/
# 重启 Dev 实例

# Release 版（ASAR 不解包，插件放 asar 同级 dist/）
cp proma-dev-patches.cjs D:/Proma-release/resources/app/dist/
cp proma-mcp-server.cjs D:/Proma-release/resources/app/dist/
```

### 打补丁（重建 main.cjs 时）

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp /tmp/app/dist/main.cjs /tmp/main-patched.cjs
# 按 wiki §5 顺序执行 sed 补丁 A-K
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs
```

### Claude Code 外部 MCP 配置

```json
{
  "mcpServers": {
    "proma-dev-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"]
    }
  }
}
```

---

## 七、关键心智模型

1. **三层实例**：正式版（不可动，已被 asar 打包，与 dev/release 完全分叉）/ Dev（隔离双开调试）/ Release（NAME=release + ISOLATED=0，共享正式版数据）
2. **两变量体系**：`PROMA_INSTANCE_NAME` 管身份（remote-session 发现、AppUserModelId）/ `PROMA_INSTANCE_ISOLATED` 管数据隔离（1=独立、0=共享）
3. **三层修改**：sed 改 main.cjs（轻量补丁 A-K）/ patches.cjs 写 MCP 工具（27+11+11）/ tree-engine.cjs 内联（v0.7+ 工作区零源码）
4. **两类 MCP 工具**：本地 `session`（进程内直连 global.__proma__）/ 远端 `remote-session`（HTTP 自动发现 19876-19895，instance 参数）
5. **三种 send_message 模式**：wait 同步 / notify 异步 / fire-and-forget + 轮询
6. **树形体系三层 role**：root（根，唯一，结构性变更）/ commander（子/孙，fork创建，受深度限制≤3，leaf add+管理下属）/ worker（叶子，create_session 干净上下文，只上报不写 tree）
7. **AGPL 合规**：闭源插件通过 `global.__proma__` 桥接调用核心 API，不修改核心代码 → 不构成衍生作品
8. **DbC（Design by Contract）+ Zero Trust 仲裁**：把 SKILL.md 的"应当"升级为代码"必须"，9 硬约束点（V4/V5b/V6/V8/CP2/V9 + 审计[1][2][3]），安全检查不依赖可篡改布尔标志（验 events 留痕）
9. **Tree 模式三层分离**（对抗确认偏误）：实现（commander）/ 评价（独立子 Agent）/ 洁净室（独立团队，禁看实现者测试，从 spec 写测试）。R2-T7 是洁净室才暴露的（实现者+4 评价都漏）
10. **五层防御 Layer 0-4**（v2 架构）：Layer 1 事中硬约束（最缺，已做 12 DbC + 9 V4-V9）/ Layer 4 subagent_trace_id（平台层依赖，未做）
11. **30/30/40 论断**：prompt 30% + 模型 RLHF 30% + harness 40%（来自 Laban ICLR 2026 + Anthropic 多 Agent 实测）

---

## 八、维护约定

- 重大改动后更新本索引的"当前完成度"和"卡点待办"两节
- 新文档加入"关键文档导航"表
- 补丁新增/修改同步到 wiki §5 和本索引"11 个核心补丁"表
- 旧条目失效及时清理，保持索引 < 250 行
