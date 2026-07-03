# Proma 改造项目

> 基于 Proma 商业版（AGPL-3.0）的多 Agent 树形会话执行体系。
> **核心策略：开源做壳，闭源做肉。**

[![Version](https://img.shields.io/badge/version-v0.16.5%20%2B%20V10%20Phase%203-blue.svg)](.context/PROJECT-INDEX.md)
[![Layer 1](https://img.shields.io/badge/Layer%201-MCP%20%E5%9F%BA%E7%A1%80%E8%AE%BE%E6%96%BD-brightgreen.svg)](#layer-1--mcp-基础设施)
[![Layer 2](https://img.shields.io/badge/Layer%202-%E6%A0%91%E5%BD%A2%E4%BC%9A%E8%AF%9D%E6%89%A7%E8%A1%8C%E4%BD%93%E7%B3%BB-orange.svg)](#layer-2--树形会话执行体系)
[![DbC](https://img.shields.io/badge/DbC-21%20%E6%A0%A1%E9%AA%8C%E7%82%B9%20%2B%20V10%208%20%E5%8A%A0%E5%9B%BA-red.svg)](#21-dbc-校验点速查)
[![IHL](https://img.shields.io/badge/IHL-6%20%E8%BD%AE%E8%BF%AD%E4%BB%A3%E5%8A%A0%E5%9B%BA-purple.svg)](#v10-phase-3--ihl-迭代加固)
[![License](https://img.shields.io/badge/license-AGPL--3.0%20%2B%20ADDENDUM-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/repo-orphiczhou%2Fproma--patches-black.svg)](https://github.com/orphiczhou/proma-patches)

---

## 一句话定位

> 通过 **sed 补丁 + 独立插件文件** 给 Proma 商业版（写字楼）加装 AI 军队指挥系统（安保系统），让 LLM 多 agent 协作从"靠 prompt 求着遵守"变成"绕不过的代码强制"。

---

## 项目状态（截至 2026-06-26）

| 维度 | 状态 |
|---|---|
| 当前版本 | **v0.16.5 + V10 Phase 3 + IHL 6 轮迭代加固** |
| Layer 1 — MCP 基础设施 | 完工。22 个 session/remote 工具 + 11 个核心补丁 |
| Layer 2 — 树形会话执行体系 | 接近完工。27 个 tree 工具 + 21 DbC + V10 八大加固 + IHL 6 轮 |
| 主代码量 | tree-engine.cjs **3602 行** + proma-dev-patches.cjs **2658 行** + main.cjs sed 补丁 11 处 |
| 部署实例 | Dev `D:\Proma-dev\`（隔离）+ Release `D:\Proma-release\`（共享） |
| 上游仓库 | [orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches)（私有） |
| 测试覆盖 | dbc-spec 48/0 + audit-attacks 18/0 + v10-cleanroom 54/54 + v10-regression 14/0 |

---

## 目录

- [核心交付](#核心交付)
- [Quick Start（5 分钟）](#quick-start5-分钟)
- [架构图](#架构图)
- [三层实例说明](#三层实例说明)
- [21 DbC 校验点速查](#21-dbc-校验点速查)
- [V10 Phase 3 — IHL 迭代加固](#v10-phase-3--ihl-迭代加固)
- [文档导航矩阵](#文档导航矩阵)
- [快速命令速查](#快速命令速查)
- [License 声明](#license-声明)
- [贡献](#贡献)

---

## 核心交付

### Layer 1 — MCP 基础设施

22 个 MCP 工具 + 11 个核心补丁 + 三实例隔离体系，把 Proma 商业版从单机应用改造成可被外部 MCP 客户端操控的 Agent 平台。

**11 个核心补丁（A-K）**：

| 补丁 | 功能 | 关键 |
|---|---|---|
| A | MCP 钩子注入 | `global.__proma_getMcpServers__` |
| B | API 桥接 + 加载插件 | 导出 12 个核心 API 给 patches.cjs |
| C1-5 | 频道+模型元数据覆盖 | MCP 创建会话走后端正确频道/模型 |
| D+E | Renderer 同步 + 守卫移除 | UI 模型选择器与 metadata 同步 |
| F | 跨渠道 sdkSessionId 防护 | 已被补丁 H v2 替代 |
| G | CLAUDE_CONFIG_DIR 无条件覆盖 | 修复 Dev fork 失败 0/3 → 3/3 |
| H | 跨频道/跨 provider 模型切换完整修复 | channelId 或 modelId 任一变化 → 清 sdkSessionId + 同步 meta |
| I | 禁用更新检查 | `initAutoUpdater` 首行 return |
| J | AppUserModelId 动态隔离 | `com.proma.{NAME}`，三版任务栏独立 |
| K | userData 路径动态化 | `electron-{NAME}`（v0.16.5 修正：双条件 ISOLATED+NAME） |

**22 个 MCP 工具**：

- 本地 `mcp__session__*`（11 个，进程内直连 `global.__proma__`）：`get_my_session_id` / `list_channels` / `list_workspaces` / `list_sessions` / `get_session_info` / `get_session_context` / `list_messages` / `create_session` / `fork_session` / `send_message` / `archive_session`
- 远端 `mcp__remote-session__*`（11 个，HTTP 自动端口扫描 19876-19895）：与本地一一对应的 `remote_*` 工具

**send_message 三模式**：`wait=true` 同步返回 / `notify=true` 异步通知 / `wait=false` + 轮询回收。

---

### Layer 2 — 树形会话执行体系

27 个 `mcp__tree__*` 工具 + 21 DbC 硬约束点 + V10 八大加固 + IHL 6 轮迭代，构建一套让 AI 多 agent 协作像军队指挥一样有纪律的执行体系。

**三层角色（像军队编制）**：

```
                    用户
                      │
              ╔═══════════════╗
              ║   ROOT 司令   ║  ← 唯一，定战略
              ╚══════╤════════╝
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      commander  commander  commander  ← 拆任务 + 管下属
          │          │
       ┌──┴──┐    ┌──┴──┐
       ▼     ▼    ▼     ▼
     worker worker worker worker  ← 干活 + 上报，不指挥
```

**三条铁律（已硬化进代码，绕不过）**：

| 铁律 | 实现位置 | 错误码 |
|---|---|---|
| root 唯一 | `cmdInit` | `E_DUPLICATE_LEAF` |
| 深度 ≤ 3 | `cmdLeafAdd` | `E_DEPTH_EXCEEDED` |
| worker 不能再 fork | `cmdLeafAdd` + role enum | `E_ROLE_INVALID` |

**27 个 mcp__tree__* 工具**：`tree_init` / `tree_leaf_add` / `tree_leaf_get` / `tree_leaf_list_active` / `tree_leaf_list_all` / `tree_leaf_set_status` / `tree_leaf_set_session` / `tree_leaf_set_context` / `tree_leaf_set_last_event` / `tree_leaf_autonomy_override` / `tree_milestone_add` / `tree_milestone_set_result` / `tree_event_append` / `tree_event_list` / `tree_audit_append` / `tree_audit_gate` / `tree_nudge_append` / `tree_nudge_reset` / `tree_drift_append` / `tree_drift_list` / `tree_segment_append` / `tree_heartbeat_append` / `tree_heartbeat_tail` / `tree_validate` / `tree_migrate` / `tree_backup` / `tree_restore` / `tree_tree_dump` / `tree_help`

---

## Quick Start（5 分钟）

### 前置

- Windows 11（macOS/Linux 同理，路径替换即可）
- 已安装 Proma 商业版到 `D:\Proma\`
- Node.js ≥ 18（用于 `npx asar`）
- Git Bash（执行 `apply-patches.sh`）
- Claude Code（可选，用于外部 MCP 桥接）

### 步骤

```bash
# 1. clone 本仓库
git clone https://github.com/orphiczhou/proma-patches.git
cd proma-patches

# 2. 一键打补丁（自动解包 asar + 应用 11 补丁 + 部署插件）
bash apply-patches.sh

# 3. 启动三层实例中的一个
#    - Dev 版（隔离双开调试）
D:/Proma-dev/start-dev.bat          # PROMA_INSTANCE_NAME=dev  +  ISOLATED=1

#    - Release 版（日常使用，共享正式版数据）
D:/Proma-release/start-release.bat  # PROMA_INSTANCE_NAME=release  +  ISOLATED=0

# 4. 验证：在 Proma 里开 Agent 会话，调一个 tree 工具
#    对 AI 说："用 mcp__tree__tree_init 创建一棵测试树"
```

### 验证清单

- [ ] Proma 启动后任务栏图标正确（Dev 白色 / Release 珊瑚色）
- [ ] 对 AI 说"用 list_channels 列出可用渠道" → 返回 JSON
- [ ] 对 AI 说"用 mcp__tree__tree_init 创建一棵测试树" → 返回 `tree_id`
- [ ] 对 AI 说"用 mcp__tree__tree_help how_to_init" → 返回使用帮助

### 外部 MCP 客户端接入

Claude Code 配置（`.claude/mcp.json`）：

```json
{
  "mcpServers": {
    "proma-dev-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"]
    },
    "proma-dev-tree": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"]
    }
  }
}
```

Release 版改用 `--release` 参数并修正路径。

---

## 架构图

```
┌──────────────────────────────────────────────────────────┐
│  Proma 商业版（开源 + 闭源混合）                          │
│  ────────────────────────────────────────────────────    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  闭源插件层（不开源，受 ADDENDUM 保护）            │    │
│  │  ──────────────────────────────────────────      │    │
│  │                                                  │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  树形会话执行体系（Tree System）            │  │    │
│  │  │  tree-engine.cjs（3602 行，21 DbC 校验点） │  │    │
│  │  │                                            │  │    │
│  │  │  - 三层角色：root / commander / worker     │  │    │
│  │  │  - 27 个 mcp__tree__* MCP 工具             │  │    │
│  │  │  - V10 八大加固 + IHL 6 轮迭代             │  │    │
│  │  │  - TAO Watcher 35 条监督规则               │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  │                                                  │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  MCP 基础设施（proma-dev-patches.cjs）     │  │    │
│  │  │  - 22 个 session/remote 工具               │  │    │
│  │  │  - localhost HTTP bridge (19876-19895)     │  │    │
│  │  │  - 外部 MCP 接入（proma-mcp-server.cjs）   │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────┘    │
│       ↑ 加补丁的方式（不重写主楼）：                      │
│       sed 补丁（11 个 A-K）→ 改 main.cjs（轻量）          │
│       独立插件文件          → patches.cjs（自由）         │
│       内联引擎              → tree-engine.cjs（核心）     │
└──────────────────────────────────────────────────────────┘
```

### 修改方式：三层

| 层 | 文件 | 适用 |
|---|---|---|
| `main.cjs` | sed 字符串替换 | 常量改、小段注入（补丁 A-K） |
| `proma-dev-patches.cjs` | 独立插件文件 | 新增 MCP 工具、复杂业务逻辑 |
| `tree-engine.cjs` | 内联进 patches.cjs 的 mcp__tree__*（v0.7+） | 树形会话引擎，工作区零源码泄漏 |

**铁律**：不可从开源源码重构建 main.cjs —— 商业版有 15 个闭源模块（cloudAuth / sync / billing / SDK），源构建会导致登录失败。**正确方式：商业版 main.cjs + sed 补丁 + 插件文件 + 内联引擎。**

---

## 三层实例说明

| 实例 | 路径 | 数据目录 | ISOLATED | 适用场景 |
|---|---|---|---|---|
| 正式版 | `D:\Proma\` | `~/.proma/` | — | 不可动，已被 asar 打包（135MB），作为对照 |
| Dev 版 | `D:\Proma-dev\` | `~/.proma-dev/` | `1` | 隔离双开调试，可与正式版同时运行 |
| Release 版 | `D:\Proma-release\` | `~/.proma/`（共享） | `0` | 日常替代使用，与正式版互斥 |

### 实例隔离规则

```
PROMA_INSTANCE_ISOLATED=1  →  @proma/electron-{NAME}/  +  ~/.proma-{NAME}/   (隔离)
PROMA_INSTANCE_ISOLATED=0  →  @proma/electron/         +  ~/.proma/         (共享正式版)
未设置                       →  默认共享（兼容旧脚本）
```

**两变量体系**（v0.16.5 修正）：
- `PROMA_INSTANCE_NAME` 管身份（remote-session 发现、AppUserModelId、任务栏图标颜色）
- `PROMA_INSTANCE_ISOLATED` 管数据隔离（1=独立 `~/.proma-{NAME}/`，0=共享 `~/.proma/`）

---

## 21 DbC 校验点速查

Design by Contract（契约式编程）—— 每个 tree-engine 子命令就像海关，前置/后置/不变式三层检查，把 SKILL.md 的"应当"升级为代码"必须"。

| 批次 | 时间 | 数量 | 堵什么 |
|---|---|---|---|
| **Phase A** | 6/23 | 12 点 | 文件幻觉 / 自审自过 / 节点失控 / 伪自检 / validate 失败续跑 / 时序倒挂（CP1-CP6 + SP1 + 加固#2/#6 + V1/V2/V3） |
| **V4-V9** | 6/24 | 9 点 | budget 短路 / alignment 标志篡改 / milestone 自审 / expect_outputs 路径遍历 / symlink 逃逸 |
| **R2-T7 + M2** | 6/25 早晨 | 2 处 | audit_append results[i] 三元组 / total 整数类型 |
| **V10 八大** | 6/25 下午 | 8 点 | 僵尸 auditor / UUID 严格 / 数值一致性 / 借身份 / nudge 升级 / 时间戳单调 / workspace canonical / status-event 同步 |
| **C5 root 信任锚修复** | 6/25 下午 | 2 处 | worker 用 null 给 root 调 audit_gate pass / worker 给 root 写 done event 触发 auto_upgrade |
| **Bug A/B + IHL** | 6/25-6/26 | 6 处 | commander 代 worker 写 done event / 同 session 多 leaf 歧义 / workspace_id 校验 / tamper detection 4 规则 |

**对抗测试金标准**（每轮加固都跑这些）：

| 测试套件 | 通过率 |
|---|---|
| `test-sandbox/dbc-spec.cjs` | **48/0** |
| `test-sandbox/audit-attacks.cjs` | **18 攻击 / 0 BYPASS** |
| `test-sandbox/v10-cleanroom.cjs` | **54/54** |
| `test-sandbox/v10-regression.cjs` | 14/0 |
| `test-sandbox/audit-extra.cjs` | 21 case |
| 真实环境 e2e（V10 P2） | 6 阶段全通过 |

---

## V10 Phase 3 — IHL 迭代加固

V10 升级把"字段存在性校验"升级为"内容有效性校验"。在 V10 Phase 3 之后，**IHL（Iterative Hardening Loop / 盲点驱动的迭代加固）** 闭环运行 6 轮，每轮发现一个真实场景盲点 → 入口补丁 → SubAgent 静态校验 → 运行时验证。

| 轮次 | Commit | 修复 | 验证 |
|---|---|---|---|
| R1 | `1a7ed5f` | applyNudge 全局守卫（补 9c423b8 tree 级规则盲点） | bugav 重置 + 巡逻 PASS |
| R2 | `031c546` | create_session workspace_id 校验 | invalid id → `E_WORKSPACE_NOT_FOUND` |
| R3 | v626 树 | V4 Pro commander 端到端 | self_check 4/4 PASS |
| R4 | `031c546` | fork_session 同类漏洞补丁（审计驱动） | 复用 R2 helper |
| R5 | `d44163a` | 4 条 W-AUDIT-* tamper detection | 设计盲点（Tier 2 status 守卫跳过） |
| R6 | `690f7e8` | R5 移到 Tier 1 绕开 status 守卫 | v626 巡逻 8 违规全覆盖 |

**最终防御拓扑（3 层）**：

```
入口拦截层: cmdEventAppend L1498 / cmdLeafAdd L705 / create_session L461 / fork_session L601
兜底守卫层: cmdAuditGate L2337 / resolveAuditorIndep L1897 / checkAllRules / applyNudge
事后检测层: W-AUDIT-SELF / W-AUDIT-WORKER / W-AUDIT-TAMPER / W-AUDIT-NO-ALIGN
```

**IHL 方法论沉淀**：
- 模式：`盲点暴露（真实场景）→ 入口补丁 → SubAgent 静态校验 → 运行时验证 → 发现新盲点`
- 关键洞察：真实场景优先于静态审查；入口拦截必须配套兜底守卫；tamper detection 必须对 all leaf 跑（不走 status 守卫）

---

## 文档导航矩阵

### 入口与索引（必读）

| 文档 | 路径 | 用途 |
|---|---|---|
| **Project Index** | [`.context/PROJECT-INDEX.md`](.context/PROJECT-INDEX.md) | 项目索引（5 分钟拿全貌 + 关键路径） |
| **图形化向导** | [`.context/project-onboarding-guide-2026-06-25.md`](.context/project-onboarding-guide-2026-06-25.md) | 30 分钟建立完整心智模型（图形化 + 类比 + 通俗） |
| **Tree 运行机制总览** | [`.context/v10/tree-system-overview-2026-07-03.md`](.context/v10/tree-system-overview-2026-07-03.md) | 图形化整合「约束+驱动+实现」三视角（10 分钟吃透 Tree 体系，新人必读） |
| **进度笔记** | [`.context/note.md`](.context/note.md) | 长期调研笔记（按日期追加在顶部） |
| **完整技术 Wiki** | [`.context/proma-dev-wiki.md`](.context/proma-dev-wiki.md) | 补丁命令、架构、测试记录、版本历史（73KB） |
| **最新进度报告** | [`.context/active/progress-report-2026-06-25.md`](.context/active/progress-report-2026-06-25.md) | 6/20→6/25 五天阶段性总结 |

### 设计与方案

| 文档 | 路径 | 用途 |
|---|---|---|
| Tree 体系设计 | [`.context/reference/design/tree-commander-design.md`](.context/reference/design/tree-commander-design.md) v1.3 | 树形体系完整设计文档 |
| Commander 方法论 | [`.context/reference/methodology/commander-methodology.md`](.context/reference/methodology/commander-methodology.md) v1.2 | 13 原则（Leaf Purity + 分布式写入 + 三层深度） |
| V10 工程方法论 | [`.context/reference/methodology/commander-methodology-v10.md`](.context/reference/methodology/commander-methodology-v10.md) | 5h/17 节点 Tree 模式加固工程实战沉淀 |
| 五层防御架构 | [`.context/reference/architecture/architecture-plan-2026-06-23/`](.context/reference/architecture/architecture-plan-2026-06-23/) | Layer 0-4 完整诊断（7 份方案） |
| 完整诊断报告 | [`.context/reference/design/tree-system-architecture-analysis-2026-06-23.md`](.context/reference/design/tree-system-architecture-analysis-2026-06-23.md) | Layer 0-4 五层防御深度报告 |
| Q3 硬约束方案 | [`.context/reference/plans/q3-tao-hard-constraint.md`](.context/reference/plans/q3-tao-hard-constraint.md) v1.2 | TAO Watcher 35 条规则 |

### V10 加固专题

| 文档 | 路径 | 用途 |
|---|---|---|
| V10 双轮收敛 | [`.context/v10/convergence-judgment.md`](.context/v10/convergence-judgment.md) | V10 双轮收敛报告 |
| C1 实施报告 | [`.context/v10/c1-implementation-report.md`](.context/v10/c1-implementation-report.md) | 8 大加固点 |
| C2 修复报告 | [`.context/v10/c2-fix-report.md`](.context/v10/c2-fix-report.md) | P0/P1/P2 修复 |
| C5 信任锚修复 | [`.context/v10/c5-trust-anchor-fix-report.md`](.context/v10/c5-trust-anchor-fix-report.md) | root 信任锚 |
| A5 验证报告 | [`.context/v10/a5-verify-report.md`](.context/v10/a5-verify-report.md) | 独立验证 |
| R5/R6 设计 | [`.context/v10/v626-r5-r6-audit-tamper-detection.md`](.context/v10/v626-r5-r6-audit-tamper-detection.md) | tamper detection 完整工程设计 |
| IHL 迭代总结 | [`.context/v10/v626-iteration-recap.md`](.context/v10/v626-iteration-recap.md) | R1-R4 详细 |

### 交接文档（按时间倒序）

| 文档 | 时段 |
|---|---|
| [`.context/active/session-2026-06-25-v10-followup.md`](.context/active/session-2026-06-25-v10-followup.md) | V10 Phase 3 + Bug A/B 修复 |
| [`.context/active/session-2026-06-25-followup-tree-mode.md`](.context/active/session-2026-06-25-followup-tree-mode.md) | V4-V9 followup + Tree 模式实战 |
| [`.context/archive/2026-06-handoff/session-2026-06-24-v4v9-hardening.md`](.context/archive/2026-06-handoff/session-2026-06-24-v4v9-hardening.md) | V4-V9 9 硬约束点交付 |
| [`.context/archive/2026-06-handoff/session-2026-06-24-bridge-port-and-dbc.md`](.context/archive/2026-06-handoff/session-2026-06-24-bridge-port-and-dbc.md) | Bridge 修复 + DbC 运行时验证 |
| [`.context/archive/2026-06-handoff/session-2026-06-23-v0.7plus-engine-inline.md`](.context/archive/2026-06-handoff/session-2026-06-23-v0.7plus-engine-inline.md) | 引擎内联 MCP |
| [`.context/archive/2026-06-handoff/session-2026-06-23-v0.7-phaseA-mcp.md`](.context/archive/2026-06-handoff/session-2026-06-23-v0.7-phaseA-mcp.md) | Phase A 12 DbC 校验点 |

### 部署源码（绝对路径）

| 文件 | 部署路径 |
|---|---|
| 引擎部署版 | `D:\Proma-dev\resources\app\dist\tree-engine.cjs`（3602 行） |
| 插件部署版 | `D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs`（2658 行） |
| MCP 桥接 | `D:\Proma-dev\resources\app\dist\proma-mcp-server.cjs` |
| 仓库源 | `workspace-files/tree-engine.cjs` + `proma-dev-patches.cjs`（与部署版字字节同步） |

---

## 快速命令速查

### 启动

```bash
# Dev 版（双开，隔离数据）
D:\Proma-dev\start-dev.bat           # PROMA_INSTANCE_NAME=dev  +  ISOLATED=1

# Release 版（日常使用，共享正式版数据）
D:\Proma-release\start-release.bat   # PROMA_INSTANCE_NAME=release  +  ISOLATED=0
```

### 部署插件（改完代码后）

```bash
# Dev 版
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/
cp tree-engine.cjs       D:/Proma-dev/resources/app/dist/
cp proma-mcp-server.cjs  D:/Proma-dev/resources/app/dist/
# 重启 Dev 实例

# Release 版（ASAR 不解包，插件放 asar 同级 dist/）
cp proma-dev-patches.cjs D:/Proma-release/resources/app/dist/
cp tree-engine.cjs       D:/Proma-release/resources/app/dist/
cp proma-mcp-server.cjs  D:/Proma-release/resources/app/dist/
```

### 一键打补丁

```bash
bash apply-patches.sh
```

### 卸载

```bash
bash uninstall.sh
# 或手动：
#   rm -rf D:/Proma-dev ~/.proma-dev         （Dev 版）
#   rm -rf D:/Proma-release                  （Release 版）
```

---

## 关键心智模型（11 条）

1. **三层实例**：正式版（不动）/ Dev（隔离双开调试）/ Release（NAME=release + ISOLATED=0，共享正式版数据）
2. **两变量体系**：`PROMA_INSTANCE_NAME` 管身份 / `PROMA_INSTANCE_ISOLATED` 管数据隔离
3. **三层修改**：sed 改 main.cjs（轻量补丁 A-K）/ patches.cjs 写 MCP 工具（27+11+11）/ tree-engine.cjs 内联（v0.7+ 工作区零源码）
4. **三类 MCP 工具**：本地 `session`（进程内直连 `global.__proma__`）/ 远端 `remote-session`（HTTP 自动发现 19876-19895）/ `tree`（27 个 Tree 操作）
5. **三种 send_message 模式**：wait 同步 / notify 异步 / fire-and-forget + 轮询
6. **树形体系三层 role**：root（根，唯一，结构性变更）/ commander（子/孙，fork 创建，受深度限制 ≤ 3）/ worker（叶子，create_session 干净上下文，只上报不写 tree）
7. **AGPL 合规**：闭源插件通过 `global.__proma__` 桥接调用核心 API，不修改核心代码 → 不构成衍生作品
8. **DbC（Design by Contract）+ Zero Trust 仲裁**：把 SKILL.md 的"应当"升级为代码"必须"，21 硬约束点，安全检查不依赖可篡改布尔标志（验 events 留痕）
9. **Tree 模式三层分离**（对抗确认偏误）：实现（commander）/ 评价（独立子 Agent）/ 洁净室（独立团队，禁看实现者测试，从 spec 写测试）
10. **五层防御 Layer 0-4**：Layer 0 行为引导（SKILL.md）/ Layer 1 事中硬约束（DbC 21 点 + V10 + IHL）/ Layer 2 主动 Supervision（设计完成，未实现）/ Layer 3 TAO Watcher（60%，缺 Liveness）/ Layer 4 模型契约（subagent_trace_id，平台层依赖）
11. **30/30/40 论断**：prompt 30% + 模型 RLHF 30% + harness 40%（来自 Laban ICLR 2026 + Anthropic 多 Agent 实测）

---

## License 声明

本仓库采用 **双许可证** 模型。完整文本见 [LICENSE](LICENSE)。

### 开源部分（AGPL-3.0）

下列组件按 GNU Affero General Public License v3.0 发布：

- 本仓库的 `apply-patches.sh`、`uninstall.sh`、`README.md`、`CHANGELOG.md` 等部署脚本与文档
- 所有 `.context/` 目录下的设计与方案文档（除非明确标注受 ADDENDUM 约束）
- 配置模板与示例

### 闭源部分（受 ADDENDUM 保护）

下列组件为闭源附加组件，**不适用 AGPL-3.0**，版权所有 © 2026 周星星 (orphiczhou)，保留所有权利：

- `proma-dev-patches.cjs`（主插件，含 27 + 11 + 11 个 MCP 工具）
- `tree-engine.cjs`（含 tree-state 引擎逻辑、21 DbC、TAO Watcher 规则）
- `proma-mcp-server.cjs`（外部 stdio MCP 桥接）
- `skills/` 下的核心方法论文件

**允许**：阅读、学习、内部使用（在自己的 Proma 部署中应用补丁）。
**禁止**：复制、修改、再分发、商业使用上述闭源组件。
**商业授权**：如需商业使用或参与开发，请通过 [orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches) 联系作者。

### 双许可证边界

- **上游 Proma 商业版**（`D:\Proma\*`）：AGPL-3.0（由上游作者授权）
- **本仓库开源壳**（部署脚本 + 文档）：AGPL-3.0
- **本仓库闭源插件**（引擎 + 主插件 + MCP 桥接 + 方法论 Skill）：本 ADDENDUM
- **用户工作区数据**（`~/.proma*/` 下所有 tree-state.json、会话、消息、deliverables）：归属用户

---

## 贡献

欢迎通过 [orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches) 提交 Issue 和 Pull Request。

- **工程文档**：见 `DEVELOPMENT.md`（待补）和 [`.context/reference/methodology/commander-methodology-v10.md`](.context/reference/methodology/commander-methodology-v10.md)
- **提交规范**：参考现有 commit message 风格（V10 Phase X / vX.Y.Z / Bug A/B）
- **代码审查**：使用 Tree 模式三层分离（实现 / 评价 / 洁净室），见 [`.context/active/session-2026-06-25-followup-tree-mode.md`](.context/active/session-2026-06-25-followup-tree-mode.md)

提交贡献即表示你授予版权持有人永久、不可撤销、免版税的许可，以使用、修改和再分发你的贡献。

---

## 相关链接

- **GitHub 仓库**：[orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches)
- **完整变更日志**：[CHANGELOG.md](CHANGELOG.md)
- **完整许可证**：[LICENSE](LICENSE)
- **图形化入门向导**：[`.context/project-onboarding-guide-2026-06-25.md`](.context/project-onboarding-guide-2026-06-25.md)
- **Tree 运行机制总览**：[`.context/v10/tree-system-overview-2026-07-03.md`](.context/v10/tree-system-overview-2026-07-03.md)（10 分钟吃透 Tree 体系）
- **项目索引**：[`.context/PROJECT-INDEX.md`](.context/PROJECT-INDEX.md)

---

> 维护：周星星 (orphiczhou) | 最后更新：2026-06-26
> 配合 [`PROJECT-INDEX.md`](.context/PROJECT-INDEX.md) + [`note.md`](.context/note.md) 食用，新会话 5 分钟拿全貌。
