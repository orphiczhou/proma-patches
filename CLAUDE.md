# CLAUDE.md — Tree 形会话执行体系（tree-system）

> 项目知识库。每条都是"删掉后未来 Agent 会犯错"的内容。保持精简。

## 项目结构
> 🔴 **权威源 = `D:/codes/tree-harness/`（2026-07-09 源码统一后确立）**。此前最新内容分散在 workspace-files（tree-engine 4928）与 pro dist（patches 3129），已全部汇聚到本目录。
- `tree-engine.cjs`（5216 行，md5 5532fa5f）：树引擎核心（状态机、事件、审计门禁、caller-binding、SubAgent 入树、5 件套持久化、drift 联动、ctx 竹节触发、prune 级联 D1、SCHEMA_VERSION 版本管理 D2、**Sprint 5 max_sessions session_registry + E_MAX_SESSIONS 硬护栏**：四路径登记 init/add/set-session/register + migrate 回灌 + findTreesBySession 导出）。
- `proma-dev-patches.cjs`（3342 行，md5 339082af）：MCP 工具注册 + caller ownership + create_session budget 护栏 + 跨工作区 workspace 锁（Sprint 4 P1，E_WORKSPACE_FORBIDDEN）+ tao-watcher（D3 silence 静默 / Sprint 4 rule 按 role 分发 RULE_ROLE_SCOPE + nudge_log cap）+ **Sprint 5 聚类 A create_session 旁路根治**（findCallerTreesForBypassGuard 定位 caller 所属 tree + max_sessions 预检 E_MAX_SESSIONS + 旁路登记 register-session + tree_register_session/tree_session_count MCP 工具）。
- `proma-mcp-server.cjs`（157 行）：外部 stdio MCP 桥接（5 处副本 md5 一致）。
- `skills/tree-commander/SKILL.md` + `skills/tree-worker/SKILL.md`：指挥官/工人手册。
- pro 部署：`D:/Proma-dev/resources/app/dist/`（tree-engine.cjs + proma-dev-patches.cjs）+ `~/.proma-dev/agent-workspaces/default/skills/`。
- release 部署：`D:/Proma-release/...`（userData `~/.proma-release`，部署前先 find 确认路径；⚠️ 2026-07-09 release dist 落后 pro 较多，未同步）。
- ⚠️ 旧源 `workspace-files/` 与 `.context/proma-dev-patches.cjs`（1078 行旧副本）已非权威，勿作为修改基准。

## 🔴 P0 永久教训：SubAgent 调用形式必须钉死（否则成本爆炸）
**事故**（2026-07-08 macp2，详见 `.context/active/postmortem-macp2-subagent-cost-explosion-2026-07-08.md`）：SKILL 写"spawn SubAgent"没钉死调用形式 → DeepSeek commander 用 `create_session`/`fork_session`（真实会话=烧钱）当 reviewer，4 分钟炸 207 会话，DeepSeek 额度打负。

**铁律**（改 SKILL/写 brief 必须遵守）：
1. **SubAgent = 进程内 SDK Agent 工具**（in-process，不建独立会话、不在侧边栏）。给可直接复制的调用示例。
2. **🚫 严禁** `mcp__session__create_session` / `fork_session` / `mcp__collaboration__delegate_agent` 当 reviewer/SubAgent（这些=真实会话=成本爆炸口）。
3. **收敛条件必须有**：角色数上限（分档 2/3/5，最小档≥2 不违禁自审；对齐 worker SKILL §4.6 字数分档）+ 轮数上限（≤3）+ 停止条件（`red_count=0` 或升级，**不许靠新建会话重试**）。
4. **预算护栏**：tree `max_sessions`、worker `max_subagent_spawn` 硬上限；撞错（E_DUPLICATE_SESSION_ID 等）**修根因，禁换名重试**。
5. **Proma 心智模型**：Proma 原生 spawn = 真实会话 = 钱。"廉价 SubAgent"只存在于进程内 Agent 工具，必须 SKILL 显式指定。

**前置验证（任何 SubAgent 设计前）**：确认目标会话（如 pro commander）工具集**是否含进程内 Agent 工具**。若无 → 设计降维（单 reviewer 或 commander 自审）。

## 部署同步口诀（改 engine/SKILL 后）
> 权威源 = `D:/codes/tree-harness/`（2026-07-09 起）。改完从这里部署到 dist。
1. `D:/codes/tree-harness/tree-engine.cjs` → `D:/Proma-dev/resources/app/dist/tree-engine.cjs`（pro，cp 后需用户重启 pro app 才加载新引擎）
2. `D:/codes/tree-harness/proma-dev-patches.cjs` → `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`（pro，同上；patches 改动也需重启 pro 才生效）
3. `skills/*` → `~/.proma-dev/agent-workspaces/default/skills/`（pro，SKILL 文件级即生效）
4. 同步前备份 `.bak-pre-<label>-<date>`；md5 校验源=pro（tree-engine 应=5532fa5f，patches 应=339082af）。

## pro 测试要点（来自历次迭代）
- pro 用 `.proma-dev` userData（**非** `~/.proma`）。SKILL 同步错路径 = commander 读旧版（曾误判"SKILL 未生效"）。
- pro 冷启动慢（新会话几分钟零响应）；`remote_send_message wait=false` + sleep + `list_messages` total>1 才算启动。
- **pro 支持并发会话**（observer 与 commander 可并行，非早期 handoff 所说"串行"）——但并发 + 无护栏 = 成本爆炸风险，必须配合上面的预算护栏。
- commander 协调消息记在 worker 会话（commander 自身 list_messages total=1 正常）。
- tree_id 纯字母数字（连字符会 E_NAME_INVALID）。
- API list_messages 的 text 截断到 ~1KB；要精确结论发简短问题 wait=true。
- 🔴 **监督 tree-system 进度读 tree-state.json（文件通道），禁用 API `list_messages` 消息数判进度**（e2e03 实证教训 2026-07-14）：GLM-5.2 commander 在**单个长未提交轮**内完成全部多步工作（tree_init→create_session→leaf_add→done→audit_gate… 共 N 次 tree write），轮内 tool call **不立即落 API 消息表**，直到轮结束才提交。故 commander 自主跑长任务时 API `list_messages` 全程 `total=1`（仅初始 user 消息）是**正常假信号**，≠卡死（早期笔记「total>1 才算启动」对长自主轮不成立，已证伪）。ground truth = pro tree-state.json：`~/.proma-dev/agent-workspaces/<slug>/.context/trees/<tree_id>/tree-state.json`（每次 tool call 原子落盘，leaves/events/session_registry/audit_log 实时可读）。曾因此误判 commander 卡死、误建 driver 欲转受控方式，撞 `E_DUPLICATE_LEAF` 才发现早已跑完 3 worker——**浪费轮询 + 污染**。判 commander 死活：`remote_get_session_info` status=busy（正在处理）+ tree-state 是否推进，二者皆停滞才算真卡死；任一推进就继续等。
- **remote 调用方受限（D1-A）**：编排方（remote）对 pro 仅 `remote_send_message` 可用；`archive_session` 等被 `R6-external-deny` 拒。清理 pro 会话走 pro 本地。
- pro userData = `~/.proma-dev/`（实证 2026-07-14 e2e03 全程；ARCHITECTURE.md §3.1 表标 `.proma-pro/` **过时**待修，勿信）。

## 文档引擎一致性（P0 高发区）
任何 SKILL 错误码/触发点/字段必须对照 tree-engine 实际校验逻辑（grep 错误码常量 + 看抛错条件）。历次审计抓出的 P0 都是文档与引擎不一致（如 E_REVIEW_FORGERY 触发点、output_ref 解析基准）。

## 测试
- `.context/plan/*-test.cjs`：harness 复用模式（require 引擎 → setTreesRoot(tmp) → setSessionVerifier(mock) → engine.run → 断言）。leaf_id path 段必须**大写字母开头**（LEAF_NAME_RE）。
- 改引擎后必跑相关测试 + `node -c` 语法检查。
- 🔴 `ENGINE_PATH` 必须指权威源 `D:/codes/tree-harness/tree-engine.cjs`（md5 `5532fa5f`），**禁指** `workspace-files/` 旧源（md5 `42ba5d51`，无 Sprint 1+2+3+4+5 新改动 = 假绿灯根因）。新测试用绝对路径直指权威源；assets 多副本场景参照 `dbc-spec.cjs` `_findEngine`（候选首位权威源）。

## 当前机制状态（2026-07-08）
- SubAgent 入树 + SKILL 调用形式红线（macp2 修复）+ review_required rvreq1 PARTIAL —— 均已落地。
- **P0a auditor role**：role='auditor' 独立审计 leaf，简化协议（brief_echo+done+audit_gate，无 milestone）。关键：resolveAuditorIndep 的 root trust anchor（行 2432-2446）天然支持 root 给 auditor 背书，**不改 resolveAuditorIndep**。auditor 是叶子节点（不能当 parent/operator，同 worker）。state.version 1.1。
- **P0b TaoWatcher 收窄**：删 C-13/C-15/R-03/R-06/W-10/W-13（35→29 条）+ patches.cjs 废止 audit_log 写入。tao-watcher 逻辑在 patches.cjs（4 副本仅根 + release/patch-l 2 份含 tao-watcher），不在 engine。
- **P1b fix_evidence**：review_round findings 加可选 finding_id + done event meta.red_findings_resolved 跨事件校验（治 macp4-W3 假收敛：red 降 yellow 但文档没改）。
- 全量 90/90 绿（auditor 20 + subagent 30 + p0-3 19 + iss003 13 + p1b 8）。commit 3852c61。已部署 Pro。
- **audtest Pro 端到端测试（2026-07-09）**：端到端失败但有价值。✅ P0b 噪音降低完全通过（C-13/R-03/R-06/C-15 假阳性 24-38→0）+ 单元验证 4/5。❌ P0a auditor 完整 done 未跑通（Proma fork identity timeout 卡死 auditor session，BUG-A 跨仓）。发现 **BUG-2（leaf_add caller-binding 失效）**。✅ **已于 2026-07-09 下午修复并 pro 实证**（会话 4fee5a45）：cmdLeafAdd/cmdLeafSetStatus/cmdMilestoneAdd 三处补 `caller===added_by`/owner/creator 校验 + dispatchLeaf 透传 callerSessionId（共 9 处），vcb2 端到端验证「攻击精准拦截 + owner/creator 合法放行无误伤」。权威源（tree-harness）已含此修复（md5 2d281ebf46）。注：leaf_add 另有 **Bug B-3**（SECURITY §1.2，session_id 唯一性，V10 P3 已修）—— 与本 BUG-2（caller-binding）是**不同漏洞**，勿混。完整 BUG 编号体系见 [BUG-REGISTRY.md](./BUG-REGISTRY.md)。
