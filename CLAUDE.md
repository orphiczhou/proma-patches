# CLAUDE.md — Tree 形会话执行体系（tree-system）

> 项目知识库。每条都是"删掉后未来 Agent 会犯错"的内容。保持精简。

## 项目结构
- `tree-engine.cjs`（~4740 行）：树引擎核心（状态机、事件、审计门禁、caller-binding、SubAgent 入树）。git 源 = pro 部署版（md5 一致）。
- `skills/tree-commander/SKILL.md` + `skills/tree-worker/SKILL.md`：指挥官/工人手册。
- pro 部署：`D:/Proma-dev/resources/app/dist/tree-engine.cjs` + `~/.proma-dev/agent-workspaces/default/skills/`。
- release 部署：`D:/Proma-release/...`（userData `~/.proma-release`，部署前先 find 确认路径）。

## 🔴 P0 永久教训：SubAgent 调用形式必须钉死（否则成本爆炸）
**事故**（2026-07-08 macp2，详见 `.context/active/postmortem-macp2-subagent-cost-explosion-2026-07-08.md`）：SKILL 写"spawn SubAgent"没钉死调用形式 → DeepSeek commander 用 `create_session`/`fork_session`（真实会话=烧钱）当 reviewer，4 分钟炸 207 会话，DeepSeek 额度打负。

**铁律**（改 SKILL/写 brief 必须遵守）：
1. **SubAgent = 进程内 SDK Agent 工具**（in-process，不建独立会话、不在侧边栏）。给可直接复制的调用示例。
2. **🚫 严禁** `mcp__session__create_session` / `fork_session` / `mcp__collaboration__delegate_agent` 当 reviewer/SubAgent（这些=真实会话=成本爆炸口）。
3. **收敛条件必须有**：角色数上限（分档 1/3/5）+ 轮数上限（≤3）+ 停止条件（`red_count=0` 或升级，**不许靠新建会话重试**）。
4. **预算护栏**：tree `max_sessions`、worker `max_subagent_spawn` 硬上限；撞错（E_DUPLICATE_SESSION_ID 等）**修根因，禁换名重试**。
5. **Proma 心智模型**：Proma 原生 spawn = 真实会话 = 钱。"廉价 SubAgent"只存在于进程内 Agent 工具，必须 SKILL 显式指定。

**前置验证（任何 SubAgent 设计前）**：确认目标会话（如 pro commander）工具集**是否含进程内 Agent 工具**。若无 → 设计降维（单 reviewer 或 commander 自审）。

## 部署同步口诀（改 engine/SKILL 后）
1. `workspace-files/tree-engine.cjs` → `D:/Proma-dev/resources/app/dist/`（pro，cp 后需用户重启 pro app 才加载新引擎）
2. `workspace-files/skills/*` → `~/.proma-dev/agent-workspaces/default/skills/`（pro，SKILL 文件级即生效）
3. 同步前备份 `.bak-pre-<label>-<date>`；md5 校验源=pro。

## pro 测试要点（来自历次迭代）
- pro 用 `.proma-dev` userData（**非** `~/.proma`）。SKILL 同步错路径 = commander 读旧版（曾误判"SKILL 未生效"）。
- pro 冷启动慢（新会话几分钟零响应）；`remote_send_message wait=false` + sleep + `list_messages` total>1 才算启动。
- **pro 支持并发会话**（observer 与 commander 可并行，非早期 handoff 所说"串行"）——但并发 + 无护栏 = 成本爆炸风险，必须配合上面的预算护栏。
- commander 协调消息记在 worker 会话（commander 自身 list_messages total=1 正常）。
- tree_id 纯字母数字（连字符会 E_NAME_INVALID）。
- API list_messages 的 text 截断到 ~1KB；要精确结论发简短问题 wait=true。

## 文档引擎一致性（P0 高发区）
任何 SKILL 错误码/触发点/字段必须对照 tree-engine 实际校验逻辑（grep 错误码常量 + 看抛错条件）。历次审计抓出的 P0 都是文档与引擎不一致（如 E_REVIEW_FORGERY 触发点、output_ref 解析基准）。

## 测试
- `.context/plan/*-test.cjs`：harness 复用模式（require 引擎 → setTreesRoot(tmp) → setSessionVerifier(mock) → engine.run → 断言）。leaf_id path 段必须**大写字母开头**（LEAF_NAME_RE）。
- 改引擎后必跑相关测试 + `node -c` 语法检查。

## 当前机制状态（2026-07-08）
- SubAgent 入树引擎机制已落地 + 20/20 测试（subagent_spawn 事件 + reviewer_kind:subagent + 溯源 + independence 分层 + BUG-3 size>0）。
- **但 SKILL 调用形式未钉死**（macp2 事故根因）——待修复（见 postmortem §六）。
- review_required 子场景 rvreq1 验证 = PARTIAL（3 bug 已修，SubAgent 入树是其产物）。
