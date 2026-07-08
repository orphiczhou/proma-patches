# 交接文件：Tree Harness 效率优化实施（基于调研报告）

> **交接给**：本工作区（Proma改造探索，本地实例）新会话，模型 **GLM-5.2**，用**子 Agent 群**配合实施
> **发起**：2026-07-08 21:xx，会话 7075b95e
> **任务性质**：基于独立调研报告，实施 Tree Harness 硬约束机制的效率优化
> **项目位置**：`D:/codes/tree-harness/`（已独立的 git 仓库，分支 `release-0.13.16-hardening`）

---

## 一、你的任务

按调研报告的优化建议，实施 Tree Harness 硬约束机制改造，让约束**更少更聪明**（减少高摩擦低价值的硬门，堵真实盲区，根治"逼 agent 找出路"的设计缺陷）。

**先读调研报告**（权威 + 自带审计置信度标注）：
- 主报告：`D:/codes/tree-harness/research-2026-07-harness-efficiency/harness-efficiency-research-report-2026-07-08.md`（63KB，8 节，含约束效率矩阵 + workaround 模式 + 覆盖盲区 + 优化建议分档 + harness 演进方向）
- 审计响应 v1/v2（报告被独立审计过两轮，揭示置信度边界 + 修正点）：同目录 `harness-efficiency-research-audit-response-*.md`
- 角色第一人称 postmortem：`D:/codes/tree-harness/macp4-postmortem/`（root + W1-W4 + 2 auditor 的执行问题报告，一手 workaround 证据）
- 任务书：同目录 `research-brief-harness-efficiency-2026-07-08.md`

## 二、背景（必读，否则会重蹈覆辙）

1. **先读 `D:/codes/tree-harness/CLAUDE.md`**——P0 永久教训（SubAgent 调用形式必须钉死 + 收敛条件 + 预算护栏；macp2 事故 207 会话爆炸打负 DeepSeek 余额）。
2. **项目历程**：SubAgent 入树机制 → macp2 事故（207 会话爆炸）→ 三层防护修复（startup_notice + SKILL 红线 + 引擎预算护栏）→ review_round append 即校验修复 → 三级验证（rvreq2 单/macp3 双/macp4 4 全量）全 PASS。当前 engine + SKILL 已部署 Pro + 重启生效。
3. **现有测试基线（不可破）**：
   - `D:/codes/tree-harness/.context/plan/subagent-lifecycle-test.cjs`：30/30
   - `p0-3-status-transition-test.cjs`：19/19
   - `iss003-review-gate-test.cjs`：13/13
   - 改 engine 后必跑这三套 + `node -c` 语法检查，全绿才算稳。

## 三、调研核心裁决（供你定位，细节看报告）

发起人假设"硬约束效率太低、没约束好、逼 agent 找出路"——**整体基本成立**：
- **效率低**：部分成立（多数约束有价值；但 **TaoWatcher** 在 auditor 错配场景零价值 + 假阳性噪音；**V4 独立门**在 auditor role 缺位时硬启动是设计层问题）
- **没约束好**：成立（3 盲区：SDK 侧 create_session 爆炸 engine 看不见 / tree-state timing 差"报完成时 worker 还在跑" / 数值收敛≠内容收敛）
- **逼 agent 找出路**：完全成立（3 类设计缺陷：SKILL 模糊 / **role 类型缺失致规则误套** / 约束硬但配套缺失）

## 四、优化建议（按优先级 + 依赖实施）

### P0a — 引入 auditor role（最高优先级，基石，~1000-1500 行）
**根因**：V4 独立门硬启动，agent 不得不用 commander/worker 假装 auditor → macp4 撞 15 次 E_AUDITOR_NOT_INDEPENDENT + A4 用 commander 假装触发 24-38 条 C-13 假阳性。
**做**：
- engine 加 `role: "auditor"` enum（ROLE_ENUM 行 84）；评估 12+ 处分支让 auditor 豁免（cmdLeafAdd 行 835/906、initialStatus 1020、audit_gate 默认 verdict 1041、done 门禁 1498、commander children 1576、archived 1595、cmdLeafSetSession isCreator 1698、resolveAuditorIndep 2415/2432、collectValidateIssues 2697/2712）
- auditor leaf 走简化协议（跳 milestone/review_round，保留 done event/audit_gate）
- 解决 auditor 自审死锁（auditor 自己 audit_gate=pass 需 root 或上级 auditor 背书）
- 衔接 §13.4 转正常期（root 信任锚保留作冷启动兜底）
- SKILL：commander §13 整章重写（信任锚/转正常期/auditor 协议）+ worker §10 调整
- 数据迁移：state.version 1.0→1.1 + migrate 脚本
- **成本**：engine ~500-700 行 + SKILL ~300-500 + 测试 + 迁移 ≈ 1000-1500 行

### P0b — TaoWatcher 收窄（必须在 P0a 之后，避免规则文案改两遍）
**关键架构事实**：TaoWatcher 不在 engine，在 `proma-dev-patches.cjs`（**4 份副本**：根/.context/release/proma-session-patch-kit）的 `tao-watcher-script` + `tao-rules.json`（35 规则数据文件）。engine 只留数据接口（`_meta.tao_watcher_session_id` + collectValidateIssues 行 2773-2775 跳过 tao-watcher-script 条目）。
**做**（推荐选项 B 收窄）：
- 列保留白名单（stall 检测 + W-09 撞墙 + W-11 消息长度 + W-12 上行类型等 ~11 条低成本）
- 删 R-03/R-06/C-13/C-15 + W-10/W-13 等高噪音语义规则（改 `tao-rules.json`）
- 改 4 份 `proma-dev-patches.cjs` 的 `tao-watcher-script`：废止 audit_log 写入权限，只留 nudge
- SKILL 同步删规则引用
- **必须在 P0a 后**：auditor role 引入后 C-13/R-03/R-06 自动豁免 auditor，文案只改一遍

### P1a — 撞墙强制 escalate
agent 反复撞同一硬约束（macp3 有 4 连撞）不切策略 → 引擎/协议加"撞同一错误 N 次→强制 blocked 上行"。

### P1b — self_check 加 fix_evidence
review_round red_count=0 但文档没改（macp4-W3 数值收敛≠内容收敛）→ done event self_check 加 `red_findings_resolved` 字段，强制 worker 声明每条 red 怎么修的（对照交付物）。

### P2 — status/timing 观测差修复（拆两层）
- 5.2a 闸门2 信任锚策略致 audit_gate 时序倒挂（macp4-W3：root 给 spawn 的 worker 直接设 audit_gate=pass，时戳在独立审计前）
- 5.2b commander 基于 tree-state 判 done 时 worker session 可能还在跑 → 加"worker session 真实 done 确认"机制

### P3+ — SDK 会话爆炸检测（跨仓需求）
macp2 盲区：engine 看不见 SDK 侧 create_session/fork_session 滥用。需 Proma app 层（proma-source）配合，非 tree-engine 可独立解决。记进待办，本次可能不做。

### 6.3 放宽/合并（低风险重构）
- caller-binding 表达式重复 → 抽 helper `assertCallerIsAuditor`（8 处 throw E_BORROWED_IDENTITY：行 923/929/1730/1914/2006/2928/2972/3049，分 3 类：caller-binding×3 + resolveAuditorIndep×3 + UUID×2）
- resolveAuditorIndep 调用重复 → 抽 `assertAuditorIndependent`
- UUID 严格校验重复 → 抽 `assertStrictUuidV4`

## 五、执行方式（方法论）

- **模型**：你（主会话）GLM-5.2；派生的子 Agent / 子会话**也 GLM-5.2**。
- **子 Agent 群**（参考本工作区已验证的多轮审计迭代方法论）：
  - 实施 SubAgent：engine 改 / SKILL 改 / 测试 / 迁移脚本（按依赖串行或并行）
  - 审计 SubAgent（3-4 路并行）：引擎契约一致性 / schema 文档对齐 / bug 正确性 / 安全不变量未破
  - 修复 P0/P1 → 收敛审计 → 重测
- **顺序**：P0a 先（基石，最大）→ 完成后再 P0b（依赖 P0a）→ P1a/P1b/P2 可并行 → P3 记待办
- **绝不破坏**：现有 30/19/13 测试全绿 + caller-binding 安全语义 + macp2 三层防护（这是用真金白银教训换的，别回退）。
- **成本纪律**（macp2 教训）：子 Agent 用内置 Agent 工具（进程内），🚫禁 create_session/fork_session 当 reviewer；收敛条件（角色/轮数/停止）；预算护栏别关。

## 六、部署 + 验证（实施完成后）

- 本地测试全绿 → cp engine + SKILL 到 Pro（`D:/Proma-dev/resources/app/dist/` + `~/.proma-dev/agent-workspaces/default/skills/`，先 `.bak-pre-auditor-role-<date>`）→ 用户重启 Pro
- Pro 重测：建小树验 auditor role 流程 + 三层防护不回退 + TaoWatcher 噪音降低
- 部署同步口诀 + 回滚备份见 CLAUDE.md

## 七、关键路径索引

| 内容 | 路径 |
|---|---|
| 项目（git 仓库） | `D:/codes/tree-harness/` |
| engine | `D:/codes/tree-harness/tree-engine.cjs` |
| SKILL | `D:/codes/tree-harness/skills/tree-{commander,worker}/SKILL.md` |
| 测试 | `D:/codes/tree-harness/.context/plan/*-test.cjs` |
| TaoWatcher 数据 | `D:/codes/tree-harness/.context/trees/tao-rules.json` |
| TaoWatcher 逻辑（4 副本） | `proma-dev-patches.cjs`（根 + .context/release + proma-session-patch-kit）的 `tao-watcher-script` |
| 调研报告 | `D:/codes/tree-harness/research-2026-07-harness-efficiency/` |
| 角色 postmortem | `D:/codes/tree-harness/macp4-postmortem/` |
| Pro engine | `D:/Proma-dev/resources/app/dist/tree-engine.cjs` |
| Pro SKILL | `C:/Users/sir_c/.proma-dev/agent-workspaces/default/skills/` |
| Pro 测试遗迹 | `C:/Users/sir_c/.proma-dev/agent-workspaces/default/.context/trees/{macp2,rvreq2,macp3,macp4}/` |
| CLAUDE.md（P0 教训） | `D:/codes/tree-harness/CLAUDE.md` |

## 八、完成标准

1. P0a（auditor role）落地 + 测试（新增 auditor role 测试 + 现有 30/19/13 不破）
2. P0b（TaoWatcher 收窄）落地 + 噪音降低验证
3. P1a/P1b/P2 按精力推进（至少 P1b self_check fix_evidence，治内容收敛盲区）
4. 多轮审计收敛 + 本地全绿
5. 部署 Pro + 重测验证
6. 写交付报告 + commit 到 `release-0.13.16-hardening`

**首步**：读 CLAUDE.md + 调研主报告（§四优化建议 + §六分档 + §七演进方向）+ macp4-postmortem，然后从 P0a 开干。
