# 交接文档：树形 Harness 迭代继续

> **来源会话**：57f5aec1（2026-07-07，Proma改造探索工作区）
> **交接对象**：新会话（继续 tree harness 修复迭代）
> **当前状态**：4 轮迭代收敛，错误 24→1（96%），pro 完整部署，release 待
> **首选下一步**：见【下一步入口】，推荐 A（部署 release）或 B（稳定性）

---

## 新会话快速恢复（3 步）

1. **读本交接** + [`tree-harness-iteration-summary-2026-07-07.md`](./tree-harness-iteration-summary-2026-07-07.md)（阶段总结，182 行，完整技术细节）
2. **检查现状**：`cd workspace-files && git log --oneline -6`（看 5 commits）+ 确认 pro 实例在线（`mcp__remote-session__remote_discover_instances`）
3. **选下一步入口**（见下），用 AskUserQuestion 和用户确认优先级

**一句话现状**：Tree 形会话执行体系的冷启动死锁（0707 报告认定的"设计层无解"）已由 §13 冷启动信任锚流程解开（SKILL 协议修正，不改引擎死锁逻辑），错误 24→1，pro 完整部署验证通过。剩余 DeepSeek 执行波动 + release 部署 + 进阶场景。

---

## 已完成（不要重做）

### 4 轮迭代（错误演进）
| 轮 | 错误 | 关键 |
|---|:---:|---|
| macp-stab | 24 | 基线，5 问题 |
| cleanroom | 15 | 3 修复完美（self_check/tao-watcher/root）|
| 完整 §13 | 1 | §13.3 前置条件表最大贡献 |
| path 修复 | path0（总7）| path 达标 + 发现波动 |

### 5 commits（分支 release-0.13.16-hardening）
- `b594a32` 冷启动死锁正解 + P0-3 状态机 + milestone caller-binding
- `c82bf3b` 错误码速查表 + 前置条件表 + worker lifecycle + bug 修复（688 行）
- `0600c37` 完整 §13 验证（错误 1，93% 降幅）
- `9b11e16` §4 path 文档消歧（path 错误归零）
- `5b8370d` 迭代总结（阶段交付）

### pro 完整部署（已验证）
- **引擎** `D:/Proma-dev/resources/app/dist/tree-engine.cjs`：新（help topics + P0-3 + caller-binding + bug 修复）
- **SKILL** `C:/Users/sir_c/.proma-dev/agent-workspaces/default/skills/`：新（§13/§13.3/§13.7/§2.5）
- 验证：3 worker done + tree_validate 0 issues + 错误 1-7（波动）

---

## 下一步入口（选一个继续）

### 入口 A：部署 release（最快闭环，推荐先行）
release 实例还停在旧版。pro 已验证，把同一套改动部署到 release。
```
# 引擎
cp workspace-files/tree-engine.cjs D:/Proma-release/resources/app/dist/tree-engine.cjs
# （先备份 .bak-pre-lifecycle-20260707）
# SKILL（release userData 路径需先确认，类似 .proma-dev 但 .proma-release）
# 重启 release 实例（用户操作）
# 验证：建测试树跑 §13，错误应 <10
```
**关键**：先 `find` 确认 release 的 userData 路径（`.proma-release`？），不要重蹈 pro 的"同步错路径"覆辙。

### 入口 B：下一轮稳定性（解决 DeepSeek 执行波动，推荐主线）
path 验证发现同 §13 不同 run 错误 1-7 波动。根因：commander 读 SKILL 仔细度 + 必填字段摩擦。
1. **SKILL 加 leaf_add 前置 checklist**（commander SKILL §4 Step2 后）：列出必填字段（leaf_id/session_id/parent/path/role/model/channel/added_by），commander add 前逐项确认
2. **引擎 leaf_add 自动补默认**：`model`/`channel` 从 root 继承（减少必填字段，需改 tree-engine.cjs cmdLeafAdd + 测试）
3. **多 run 取中位数**：跑 3-5 次同任务，统计错误分布（而非单次判定）
4. 多轮审计 + 洁净室验证（同本轮方法）

### 入口 C：进阶场景验证
本轮均单 worker + review_required=false。拓展：
- **多 worker 并行**（2+ worker）：验证 §13.4（转正常期）+ 闸门2→3 切换
- **review_required=true**（ISS-003 opt-in）：验证 review_round event 流程 + commander 抽查 findings 真实性
- **tao-watcher 优化**：W-01（fork 身份确认不应触发）/ W-08（区分 commander 指令 vs worker 越权）/ C-13+R-06（小任务模式）

### 入口 D：0707 遗留课题（体系级，需改 patches.cjs 或深改引擎）
- **ISS-006** 竹节交接不继承 worker ownership（E_NO_OWNERSHIP）— patches.cjs 层
- **ISS-007** commander context 自动竹节 + session 通信可靠性（notify/wait）
- **ISS-010** audit_log 历史脏数据清理（316 处 undefined，旧树）

---

## 关键路径索引

| 内容 | 路径 |
|---|---|
| git 源（SKILL + 引擎）| `C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/` |
| 本实例运行 SKILL | `~/.proma/agent-workspaces/proma/skills/` |
| **pro SKILL**（pro 真实读）| `C:/Users/sir_c/.proma-dev/agent-workspaces/default/skills/` |
| **pro 引擎** | `D:/Proma-dev/resources/app/dist/tree-engine.cjs` |
| release 引擎（待部署）| `D:/Proma-release/resources/app/dist/tree-engine.cjs` |
| 阶段总结 | `.context/active/tree-harness-iteration-summary-2026-07-07.md` |
| 观察报告 ×4 | `.context/active/observation-{macp-stab,cleanroom,cleanroom2}-2026-07-07.md` |
| 改进方案 handoff | `.context/active/handoff-tree-harness-improvement-2026-07-07.md` |
| 待解决问题清单 | `.context/待解决问题清单.md`（ISS-005/008/009 已解）|
| 测试脚本 | `workspace-files/.context/plan/p0-3-status-transition-test.cjs`（19/19）+ 会话级 `.context/plan/deadlock-repro.cjs` |
| 回滚备份 | `.bak-pre-p03-deploy-20260707` / `.bak-pre-lifecycle-20260707`（pro dist + .proma-dev SKILL）|

**部署同步口诀**（改动后 cp 三处）：
1. `proma/skills/` → `workspace-files/skills/`（git 源）
2. `proma/skills/` → `.proma-dev/agent-workspaces/default/skills/`（pro）
3. `workspace-files/tree-engine.cjs` → `D:/Proma-dev/.../dist/`（pro 引擎，cp 后需用户重启）

---

## 坑与教训（避免重蹈）

1. **pro 用 `.proma-dev` userData，不是 `~/.proma`**！SKILL 同步到 `~/.proma/agent-workspaces/default/skills` pro 读不到（本实例路径）。pro 真实路径 = `C:/Users/sir_c/.proma-dev/agent-workspaces/default/skills/`。cleanroom 测试因此误判"SKILL 未生效"。**部署 SKILL 前先 `find` 确认实例 userData**。
2. **DeepSeek 执行 SKILL 有波动**（同 §13，错误 1-7）。单次测试不代表性，**多 run 取中位数**。GLM-5.2 在 pro 启动慢/间歇（验证用 DeepSeek-pro）。
3. **pro 会话冷启动慢**（新会话几分钟零响应才启动）。`remote_send_message wait=false` + `sleep 300` + `list_messages` 查 total，total>1 才算启动。
4. **commander 协调消息分散在 worker 会话**（commander 自身 list_messages total=1 是正常的）。观察 commander 决策要聚合 worker 会话的 user 消息 + tree 数据（call-log.jsonl/tree-state.json）。
5. **pro 串行调度**：commander 跑时 observer 排队（total=1）。commander 完成后 observer 才启动。别误判 observer 卡死。
6. **文档引擎一致性**：SKILL 错误码/触发点必须对照 tree-engine 实际校验逻辑（grep 错误码常量 + 看抛错条件）。审计抓出的 P0×3 都是文档与引擎不一致（E_AUDIT_PREMATURE 在 audit_gate 非 set-status；E_MILESTONE_INCOMPLETE 引擎根本没这码；E_BORROWED_IDENTITY 触发点 6 处非 2）。
7. **list_messages 的 text 字段截断**（text_full_length vs text）。要 commander 精确结论，发简短问题 wait=true 让它基于上下文回答（不重跑）。
8. **tree_id 命名**：`tree_init` 允许连字符但 `leaf_add` 禁（prefix 段规则）。建议用纯字母（如 `vpro1`）避免 E_NAME_INVALID。

---

## 方法论（保持）

1. **多轮审计迭代收敛**：实施 → 3 路并行审计（完整性/一致性/引擎契约/bug 正确性）→ 修复 P0/P1/P2 → 收敛审计 → 洁净室测试 → 迭代。文档引擎不一致是 P0 高发区。
2. **子 Agent 保持主 context**：侦察/实施/审计/观察员都用子 Agent，主会话只回收结构化结论。pro 观察员 = 近距离（同实例，读 tree 数据），非远观。
3. **pro 稳定性测试**：真实任务（multi-agent-collab-platform 文档评估）+ 观察员 + 三方对比（基线/上轮/本轮）。比单次测试可信。
4. **用户决策点用 AskUserQuestion**：部署/下一轮/范围选择，给选项 + 推荐 + 简述。

---

## 推荐新会话开场（给新会话的建议）

```
1. Read 本交接 + tree-harness-iteration-summary-2026-07-07.md
2. cd workspace-files && git log --oneline -6（确认 5 commits 在）
3. mcp__remote-session__remote_discover_instances（确认 pro/release 在线）
4. AskUserQuestion：下一步入口 A/B/C/D？（推荐 A 部署 release 或 B 稳定性）
5. 按入口执行，保持多轮审计 + 子 Agent + pro 测试
```

**别重做**：§13/§13.3/§13.7/P0-3/caller-binding/3 bug 修复都已落地验证。除非审计/测试发现新问题，不要重改这些。

**首要警惕**：任何 SKILL 错误码改动，必须 grep tree-engine.cjs 确认引擎实际抛错条件（文档引擎一致性是 P0 高发区）。

---

## 一句话交接

0707 的"设计层死锁无解"已被 §13 推翻并修复（错误 24→1，全 done + 0 issues）。pro 完整部署。下一轮入口：A 部署 release / B 解决 DeepSeek 执行波动 / C 进阶场景 / D 体系遗留。详细技术见阶段总结，坑与路径见本交接。
