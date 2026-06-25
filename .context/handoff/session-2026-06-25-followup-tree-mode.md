# 交接：V4-V9 followup（Tree 模式实战 + MCP gap 批量修复 + R2-T7 待决策）2026-06-25 08:29

> 新会话从这里恢复 | 工作区: Proma改造探索 | 用户: 周星星
> 5 分钟恢复: 本文件 + note.md 顶部 + wiki §二十 + tree-engine-followup-fixes-proposal.md

## 一句话状态

**V4-V9 加固后续（followup）完成：用 Tree 模式（4 commander 顺序 + 4 评价子 Agent + 洁净室测试团队）落地 proposal，2 个 commit 入库（efbf139 + 59357f1）。洁净室发现 R2-T7（audit_append results[i] 校验缺失，low，待用户决策）。C2/C4 改动 cp dist 但 dev/release 未重启。**

## 已完成

### 2 个 commit（orphiczhou/proma-patches）
- `efbf139` feat(tree): V4-V9 DbC 深度加固 + MCP schema gap 修复（9 硬约束点）
- `59357f1` feat(tree): V4-V9 followup — MCP gap 批量修复 + 文档同步 + milestone 软警告

### followup 4 任务（Tree 模式，开发树 fupv，DeepSeek V4 Pro 子会话）
| Commander | 任务 | 评价 | 结果 |
|---|---|---|---|
| C1 | MCP schema 全量扫描 | A1 ✓ 清单可用 | 3 缺口（nudge_append 接口不兼容 / nudge_reset 工具缺失 / migrate dry_run） |
| C2 | MCP gap 批量修复 | A2 ✓ 修复合格 | patches.cjs 3 处改 + 部署 diff 0 + engine 层 nudge append/reset/migrate 全 ok |
| C3 | 文档同步 | A3 ✓ 文档合格 | SKILL §12 role 枚举 [root,commander,worker] + §5/wiki§十八 audit_append report 结构，release+dev 同步 |
| C4 | milestone 软警告 | A4 ✓ 软警告合格 | collectValidateIssues 三处同步加 milestone_empty_outputs issue + dbc-spec 39/0 |
| Cr | 洁净室测试（3 轮） | — | 31 独立测试 29 pass，6 DbC 黑盒复现，签字通过 |

### Tree 模式实战价值（再次验证）
- 实现者（主会话）协调，4 commander 顺序执行 + 4 评价子 Agent 独立 review + 洁净室团队独立验证
- **洁净室发现 R2-T7**：audit_append results[i] 校验缺失（实现者测试 + 4 评价都漏，洁净室不看实现者测试才暴露）
- 教训：实现者自测有盲区，独立角色（评价 + 洁净室）真实有效

## 关键技术决策（新会话必读）

1. **Tree 模式三层分离**：实现（commander）/ 评价（子 Agent）/ 洁净室（独立团队），每层独立上下文。角色分离是对抗确认偏误的核心。
2. **洁净室铁律**：从 spec（SKILL + wiki + proposal）写测试，**禁看实现者测试**（dbc-spec/audit-attacks/audit-extra）。R2-T7 的发现证明价值——实现者 + 评价都聚焦安全门禁，洁净室才查 audit_append results[i] 子结构。
3. **C2 MCP gap 根因**：patches.cjs 的 tree_* 工具 schema 漏暴露引擎必填参数（nudge_append handler 传 --json 但 engine 读 opts['rule-id'] → 必失败）。**引擎层 require 测试不够，必须端到端 MCP 验证**。
4. **C4 软警告语义**：milestone 空 expect_outputs → validate 报 issue（不拦 add，保"先建后填"灵活）+ done 时 V3 仍拦（不退化）。
5. **DeepSeek V4 Pro 子会话**：claude-sonnet 余额不足，用 DeepSeek 官方 channel（`56ecefd2-8e22-4c62-add5-16e8992c987d`）+ `deepseek-v4-pro`，性价比高，足够跑 commander/评价/洁净室任务。
6. **开发树 fupv**：本次 followup 用 mcp__tree__tree_init 建开发树（tree_id=fupv），C1-C4+Cr 各注册为 commander leaf（fupv-C1-commander 等），event append done 记录交付。**真实使用了 V4-V9 加固后的 Tree 体系**。

## 待决策（用户定）

### 🔴 R2-T7 偏差（洁净室发现，low，spec/impl 不一致）
- **现象**：wiki §18.3 spec 要求 audit_append report 的 `results[]` 每项为 `{item, pass, evidence}` 三元组，但引擎 `cmdAuditAppend`（core/tree-state.js ~L2047）只验顶层字段（auditor_session_id/total/passed/failed/results 非空），**不校验 results[i] 内部结构**
- **影响**：low（审计报告可信度依赖审计者自觉，不影响安全门禁）
- **选项**：
  - **A. 修引擎**（C5 commander 加 results[i] 三元组校验，让 spec/impl 一致）—— 推荐（闭环洁净室发现）
  - **B. 修 spec**（wiki §18.3 改"建议三元组但不强制"）
  - **C. 记录残留**（接受 low）

### 🟡 重启验证（C2/C4 改动）
- C2 改 patches.cjs（MCP gap：nudge_append/nudge_reset/migrate）+ C4 改 engine（软警告），已 cp dist
- 但 dev/release 运行中是旧版（启动时加载），**需重启才生效**
- 重启后端到端 MCP 验证：`mcp__tree__tree_nudge_append(rule_id=...)` / `tree_nudge_reset` / `tree_migrate(dry_run=true)` / milestone 软警告 validate

### 🟢 push（2 commit 推 GitHub）
- `git push origin master`（推 orphiczhou/proma-patches，用户决定）

## 关键文件位置

| 文件 | 位置 |
|---|---|
| 逻辑源（C4 改） | workspace-files/release/tree-system-v0.2.2/core/tree-state.js |
| 内联版（同步） | .../patch-l/tree-engine.cjs |
| 部署版（cp） | D:/Proma-dev/resources/app/dist/tree-engine.cjs |
| MCP wrapper 源（C2 改） | .../patch-l/proma-dev-patches.cjs（tree_* ~1120-1152） |
| MCP wrapper 部署 | D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs |
| proposal（followup 清单） | workspace-files/.context/tree-engine-followup-fixes-proposal.md |
| 开发树 fupv | workspace-files/.context/trees/fupv/（C1-C4+Cr leaf，含 done event） |
| SKILL（C3 改） | skills/tree-commander/SKILL.md（§5/§12）+ release/dev 激活路径同步 |
| Wiki | .context/proma-dev-wiki.md（§十八 audit_append + §二十 V4-V9 + §20.8 MCP gap/冗余） |
| note | .context/note.md（顶部 V4-V9 条目 + M8/M9-M10 补注；followup 待补） |
| 测试 | test-sandbox/{dbc-spec(39/0),audit-attacks(18/0),audit-extra(21)}.cjs |
| 备份 | dist/tree-engine.cjs.bak-20260624-pre-v4v8 + dist/proma-dev-patches.cjs.bak-20260624-pre-mcp-gap |
| 上个 handoff | .context/handoff/session-2026-06-24-v4v9-hardening.md |
| 本会话计划 | 6e84f211.../.context/serene-prancing-moonbeam.md（V4-V9 计划，followup 在对话） |

## 三实例当前状态

```text
release @ 127.0.0.1:19876 (D:/Proma-dev/start-release.bat, Proma-coral) — ISOLATED=0 共享 ~/.proma/
dev     @ 127.0.0.1:19877 (D:/Proma-dev/start-dev.bat, Proma-white) — ISOLATED=1 数据 ~/.proma-dev/
（pro/release-fresh 未启动）
```

两实例都已加载 V4-V9 + MCP gap #5 milestone_set_result（上次重启）。**C2/C4 改动（这次 followup）未加载**，需再重启。

## 下一步（新会话）

### 推荐顺序
1. **读本文件 + note.md 顶部 + wiki §二十 + proposal**（5 分钟恢复）
2. **决策 R2-T7**（用户定 A/B/C；建议 A，派 C5 commander 修引擎加 results[i] 三元组校验 + A5 评价 + 部署 + dbc-spec 补用例）
3. **提示用户重启 dev/release**（加载 C2/C4 改动）+ 端到端 MCP 验证（nudge_append/nudge_reset/migrate/软警告）
4. **push**（可选，2 commit 推 GitHub）

### 其他方向
- **Layer4 subagent_trace_id**：堵互审洗白/冒用 session（平台层，大工程，单独立项）
- **Phase D**：prune/archive 语义、migrate 版本号、watcher silence_minutes
- **真实使用**：用加固后引擎跑实际任务（端到端验证 alignment 回填流程等，比纯测试更有说服力）
- **沉淀方法论 Skill**：把"Tree 模式多会话协作（commander/评价/洁净室 + V4-V9 体系自举）"沉淀成可复用 Skill
- **dev MCP workspace=null 排查**：dev 子会话 slug "undefined" 导致 mcp__tree__* 直调不可用（影响 dev 实例 Tree 可用性）

### 待清理（可选）
- 开发树 fupv（followup 完成，可归档或留作 Tree 模式实战参考）
- test-sandbox/core 临时数据（各轮测试残留）

## 新会话第一步

1. 读本文件 + note.md 顶部 + wiki §二十（5 分钟恢复）
2. 问用户 R2-T7 决策（A 修引擎 / B 修 spec / C 残留）
3. 若 A：派 C5 commander（DeepSeek V4 Pro，channel `56ecefd2-8e22-4c62-add5-16e8992c987d`）改 `cmdAuditAppend`（core ~L2047）加 results[i] 三元组校验 + A5 评价 + 三处同步 + dbc-spec 补用例 + 部署
4. 若 B/C：直接记录 + 询问下一步（重启验证 / push / 其他方向）
