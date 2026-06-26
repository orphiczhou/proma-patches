# Changelog

All notable changes to **Proma 改造项目** are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/), adheres to [Semantic Versioning](https://semver.org/).

仓库地址：[orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches)

---

## [Unreleased]

### Pending
- TAO Watcher 按角色区分规则（root/commander/worker 各有专属规则集），堵 a8111bf5 类意外终止
- patches.cjs 加 workspace_id 拦截补丁（跨工作区 P1）
- Phase D：D1 prune/archive 级联语义 / D2 migrate 版本号 / D3 watcher silence_minutes
- main.cjs `createAgentSession` 加 workspaceId 白名单（sed 补丁，跨工作区 P2）
- Layer 4 subagent_trace_id（平台层依赖，大工程，单独立项）
- Q2 树形 UI 面板（补丁 L）实施 — 已让位给 v0.7+ 引擎内联
- Release 严重落后 dev 1131 行，按用户指示暂不同步

---

## [V10 Phase 3 + IHL] - 2026-06-26

### Added
- **IHL（Iterative Hardening Loop）方法论成型**，盲点驱动的 6 轮迭代加固闭环
  - 模式：`盲点暴露（真实场景）→ 入口补丁 → SubAgent 静态校验 → 运行时验证 → 发现新盲点`
  - 命名：Iterative Hardening Loop / 盲点驱动的迭代加固
- **Layer 4 攻击向量识别**：直接编辑 `tree-state.json` 绕过引擎
- **三层防御拓扑**：
  - 入口拦截层：`cmdEventAppend L1498` / `cmdLeafAdd L705` / `create_session L461` / `fork_session L601`
  - 兜底守卫层：`cmdAuditGate L2337` / `resolveAuditorIndep L1897` / `checkAllRules` / `applyNudge`
  - 事后检测层：`W-AUDIT-SELF` / `W-AUDIT-WORKER` / `W-AUDIT-TAMPER` / `W-AUDIT-NO-ALIGN`
- **4 条 W-AUDIT-* tamper detection 规则**：
  - `W-AUDIT-SELF`：worker 自审通过
  - `W-AUDIT-WORKER`：worker 当 auditor
  - `W-AUDIT-TAMPER`：audit_log 伪造 pass=true
  - `W-AUDIT-NO-ALIGN`：worker pass 无 alignment
- **`validateWorkspaceId` helper**：`create_session` + `fork_session` 双入口共享，复用 R2 实现
- **6 个新 commit 全部已 push 到 orphiczhou/proma-patches**：
  - `1a7ed5f` R1：applyNudge 全局守卫
  - `031c546` R2/R4：workspace_id 校验
  - `d44163a` R5：4 条 W-AUDIT-* tamper detection
  - `690f7e8` R6：R5 规则移到 Tier 1（对 all leaf 跑，绕开 status 守卫）
  - `9c423b8` TAO Watcher 入口守卫（V10 P3 前置）
  - `30eb4fa` Bug A/B 双重修复 + 文档沉淀

### Changed
- `proma-dev-patches.cjs` 行数 2532 → **2658**（+126 行）
- `tree-engine.cjs` 行数 3565 → **3602**（+37 行，含 Bug A/B + IHL R5/R6）
- 三份 patches.cjs 物理同步（仓库版 + dev dist + patch-l）一致

### Fixed
- **Bug A**（commander 代 worker 写 done event）：`cmdEventAppend L1498` 加 caller 校验，只允许 `leaf.session_id` 自己写 done event
- **Bug A-2**（Auditor #2 独立发现的 hasDone 漏洞）：`cmdAuditGate L2337-2345` 检查 caller_session_id
- **Bug B**（同 session 多 leaf 歧义）：新错误码 `E_DUPLICATE_SESSION_ID` + `cmdLeafAdd L705-718` session_id 唯一性校验
- **Bug B-4**：`resolveAuditorIndep L1897-1911` `.filter` 跳过 pruned
- **TAO Watcher 规则错配（部分）**：a8111bf5 主线会话因 worker 规则发给 root 意外终止，IHL R1 入口守卫缓解

### Security
- **Prompt Injection 防御副产品**：会话期间收到 6 条试图诱导 root 滥用 `audit_gate` 的注入指令（让 root 给 worker / commander / 不存在的 leaf 标 pass），V10-trust-anchor 设计 + root 自律全部拒绝

---

## [V10 Phase 1/2] - 2026-06-25

### Added
- **V10 八大加固点**，把"字段存在性校验"升级为"内容有效性校验"：
  - `V10-auditor-active`：auditor leaf 必须 status=done + 自身 audit_gate.verdict=pass + events 非空（三重校验）
  - `V10-self-audit-v2`：audit_session_id ≠ 被审 leaf.session_id + ≠ 调用方 session_id（防借身份）
  - `V10-uuid-strict`：所有 session_id 字段严格 UUID v4 校验，拒绝全 f / 全 0 / 空串 / 字符串伪造
  - `V10-numeric-consistency`：total/passed/failed ≥ 0 + p+f=total + results.length=total
  - `V10-nudge-escalation`：nudge_count 3→medium / 5→high / 7→强制 pruned
  - `V10-timestamp-monotonic`：ts ≥ created_at + ≤ now(+60s) + 单调递增
  - `V10-workspace-canonical`：patches.cjs fallback "default" + remote_create_session 强制 workspace_id
  - `V10-status-event-sync`：leaf status 与 last_event_type 强制一致
- **Trust Anchor（root 自审特例）**：解决鸡生蛋问题（root 是信任锚点时允许 root 自审）
- **D4 Helper 4 层自助文档**：堵模型层失守时的兜底（`tree_help` 13 topics）
- **C5 root 信任锚修复**：
  - 攻击向量 1：worker 用 null 给 root 调 audit_gate pass → root 信任锚不再放行 null
  - 攻击向量 2：worker 给 root 写 done event 触发 auto_upgrade → `cmdEventAppend` 加 caller 校验
- **双轮收敛**：C1→C2→Cr→Cr2→A1→A2→DBC fix→dev E2E→C3 trust anchor→C5 fix→A5 verify
- **6 套金标准 0 退化**：164 测试全过（24+6+54+48+18+14）
- **commit `7d36cc7`**（P2）+ **`f98805d`**（开发树）

### Changed
- `tree-engine.cjs` 行数 2471 → **3565**（+1094 行）
- 洁净室 Cr 优先于 A1 代码层评（Cr 发现 10 个真实失守 vs A1 8/8 合格）

### Security
- **audit-gate-test-20260625 教具案例保留作 V10 加固方向依据**（3 副本不删不改）
- vfa1 注入 4 种攻击 + vfb 注入 13 种攻击（旧引擎 0% 拦截）→ V10 后全部拦截

---

## [V4-V9 DbC 加固] - 2026-06-24

### Added
- **9 个 V4-V9 硬约束点**：
  - V4：milestone `audit_pass=true` 需 auditor_session_id
  - V5b：worker done 需 events alignment 回填（查 events 留痕，不查可篡改布尔标志）
  - V6：self_check 不能全 pass:false
  - V8：worker budget 严格校验
  - CP2：alignment_pending 篡改防护（改为查 events）
  - V9：expect_outputs 路径不是绝对路径/symlink 逃逸
  - 审计[1][2][3]：审计报告三重校验
- **Tree 方法论成型**（实现/测试/审计分离 + 自举 + 迭代收敛）
  - 实现（主会话）/ 评价（SDK Agent）/ 独立审计（collaboration 真实子会话 DeepSeek V4 Pro, role=auditor）/ 洁净室（独立团队）
  - 关键教训：安全检查不依赖可篡改布尔标志，验 events 留痕
- **audit-attacks 18 攻击 0 BYPASS**
- **dbc-spec 36/0**
- **commit `efbf139`** + **`59357f1`**（V4-V9 followup Tree 模式实战）
- **R2-T7**（洁净室发现）：`audit_append` `results[i]` 校验缺失，spec §18.3 要求三元组 `{item, pass, evidence}`
- **M2**：`audit_append` 顶层 `total/passed/failed` 整数类型校验

### Changed
- Tree 模式首次完整实战（4 commander + 4 评价 + 洁净室 3 轮 31 测试 29 pass）
- 4 个评价子 Agent + 洁净室独立团队对抗确认偏误，发现 3 个实现者盲点（alignment_pending 标志篡改 / budget 字符串 / symlink）

### Fixed
- **Bridge 端口遮蔽 bug**：Dev bridge `0.0.0.0:19876`（Windows bat 必须 ASCII），3 实例 bridge fallback 全通过

---

## [v0.7+ 引擎内联] - 2026-06-23

### Added
- **tree-state.js (2428 行) → `tree-engine.cjs` 内联进 patches.cjs**
- **工作区零源码泄漏**：agent 看不到改不到引擎代码（v0.7 之前 tree-state.js 是工作区独立脚本，agent 可以 Read/Edit/cat 绕过 MCP，独立审计发现这是漏洞）
- **27 个 `mcp__tree__*` MCP 工具**（消除 spawn 包装）
- **per-call `treesRoot` 并发安全**：`run(cmd, args, treesRoot?)` 与 CLI stdout 等价
- **`TREES_ROOT` 可注入 + `findEngine` 自适应定位 engine**

### Changed
- 部署模式：`dist/`（patches + engine）+ 激活 SKILL + 清理 3 处遗留
- 验证：smoke + dbc-spec 21/0 + audit-attacks 18/CRITICAL=0 + A1 独立审计子会话

---

## [v0.7 Phase A] - 2026-06-23

### Added
- **12 个 DbC 校验点**（commit `1757b5e`）：
  - A1-A7：CP1-CP6（文件幻觉 / 自审自过 / 节点失控 / 伪自检 / validate 失败续跑 / 时序倒挂）+ SP1
  - HARDEN2 / HARDEN6：加固 #2/#6
  - V1/V2/V3 审计加固：restore 旁路 / auditor 白名单 / expect_outputs 非空
- **把 SKILL.md 的"应当"升级为代码"必须"**
- **ROLE_ENUM 硬化**：`['root', 'commander', 'worker']`，自由文本 role 一律拒绝
- **E_DEPTH_EXCEEDED**：深度限制 ≤ 3（堵 qfv2 式 5 层嵌套）
- **`collectValidateIssues` + `resolveAuditorIndep` 白名单 + `migrate`**
- **Worker 禁子节点 + 根唯一性**
- **实施方式**：4 批次真实子会话（自举）+ commander 独立验收（dbc-spec 21/0）+ 独立对抗审计

---

## [Tree System v0.2.x] - 2026-06-21

### Added
- Q1 v2 全深度验证（10 leaf 3 层 38/38 全通过）
- Q1 v1.1 架构升级（role 枚举 / 深度限制 / migrate / Leaf Purity）
- ROOT_PLACEHOLDER / CLI 注入 / Events 空洞修复
- 洁净室审计 22 项修正 + L1Fix v2 审计（7 worker × 2 round）

### Fixed
- 8 项 Q1 v2 验证发现的问题（2 阻断 / 3 严重 / 2 中等 / 1 低）

---

## [v0.16.5] - 2026-06-19

### Fixed
- **补丁 K 修正**：恢复 `ISOLATED === "1"` 双条件检查（v0.16.4 误删），防止 Release 误隔离
- **remote-session Release 验收**：39/40 有条件通过（1 个 fork new_title Bug，不阻断上线）

### Changed
- 两变量体系定型：`PROMA_INSTANCE_NAME` 管身份 + `PROMA_INSTANCE_ISOLATED` 管数据隔离

---

## [v0.16.4] - 2026-06-18

### Added
- **补丁 I**（禁更新检查）：`initAutoUpdater` 首行 return，不弹更新对话框
- **补丁 J**（AppUserModelId 动态隔离）：`com.proma.{NAME}`，三版任务栏独立
- **补丁 K**（userData 路径动态化）：`electron-{NAME}`

### Fixed
- **补丁 H v2**（跨频道/跨 provider 模型切换完整修复）：channelId 或 modelId 任一变化 → 清 sdkSessionId + 同步 meta
- **Bug 4**（fork 跨 sdkSession 候选循环试错）
- **Bug 5**（send_message 同步 meta）
- **补丁 G**（CLAUDE_CONFIG_DIR 无条件覆盖）：修复 Dev fork 失败 0/3 → 3/3

### Changed
- v0.16.3 多维度综合交叉测试报告通过

---

## [v0.16.3] - 2026-06-18

### Added
- 矩阵 D/E/F/G 测试报告（SubAgent HTTP bridge 执行）
- v0.16.3 回归测试报告（SubAgent HTTP bridge 执行）

### Fixed
- 跨频道换模型丢上下文根因调研
- 补丁 H v1 实测发现盲点 → 升级到 v2

---

## [v0.16.0] - 2026-06-15

### Added
- **项目初始版本**
- **11 个核心补丁 A-K**：
  - A：MCP 钩子注入（`global.__proma_getMcpServers__`）
  - B：API 桥接 + 加载插件（导出 12 个核心 API）
  - C1-5：频道+模型元数据覆盖
  - D+E：Renderer 同步 + 守卫移除
  - F：跨渠道 sdkSessionId 防护（后被 H v2 替代）
  - G：CLAUDE_CONFIG_DIR 无条件覆盖
  - H：跨频道/跨 provider 模型切换完整修复
  - I：禁更新检查
  - J：AppUserModelId 动态隔离
  - K：userData 路径动态化
- **22 个 MCP 工具**（11 本地 `mcp__session__*` + 11 远端 `mcp__remote-session__*`）
- **session-management Skill v1.3.0**
- **GitHub 仓库** `orphiczhou/proma-patches` 建立
- **apply-patches.sh** v0.16.5 一键部署
- **三实例运行环境**：Dev（隔离）/ Release（共享）/ 正式版（不动）
- **localhost HTTP bridge**：端口 19876-19895 自动选
- **send_message 三模式**：wait 同步 / notify 异步 / fire-and-forget + 轮询

---

## 版本号说明

- **vX.Y.Z**（如 v0.16.5）：Layer 1 MCP 基础设施层版本号
- **V10 Phase X**：Layer 2 树形会话执行体系的大版本里程碑
- **IHL R1-R6**：Iterative Hardening Loop 的迭代轮次（V10 之后的持续加固）
- **commit hash**：具体提交标识，可追溯到 orphiczhou/proma-patches

## 测试金标准

每个版本发布前都跑以下金标准套件，要求 0 退化：

| 套件 | 当前通过率 |
|---|---|
| `test-sandbox/dbc-spec.cjs` | 48/0 |
| `test-sandbox/audit-attacks.cjs` | 18 攻击 / 0 BYPASS |
| `test-sandbox/v10-cleanroom.cjs` | 54/54 |
| `test-sandbox/v10-regression.cjs` | 14/0 |
| `test-sandbox/audit-extra.cjs` | 21 case |
| 真实环境 e2e（V10 P2） | 6 阶段全通过 |

---

## 链接

- **GitHub**：[orphiczhou/proma-patches](https://github.com/orphiczhou/proma-patches)
- **README**：[README.md](README.md)
- **LICENSE**：[LICENSE](LICENSE)（AGPL-3.0 + ADDENDUM）
- **Project Index**：[`.context/PROJECT-INDEX.md`](.context/PROJECT-INDEX.md)
- **图形化向导**：[`.context/project-onboarding-guide-2026-06-25.md`](.context/project-onboarding-guide-2026-06-25.md)
- **Keep a Changelog**：https://keepachangelog.com/
- **Semantic Versioning**：https://semver.org/

---

> 维护：周星星 (orphiczhou) | 最后更新：2026-06-26
