# nanju-iter2 自举建树 — 重启交接文档

> **给**：重启后的 proma 工作区根会话（你自己，会话 c5ac0e97）
> **日期**：2026-07-07
> **背景**：用户要求"用课题项目 nanju 测试 tree 结构"，在南大项目工作区建树形指挥官自举完成文档迭代。模型全链 GLM-5.2。用户选了"先发布 P0-1 修复再跑"+"04/05/06 + 跨层一致性"。
> **为何重启**：P0-1 已发布到 dist，需重启 Proma 实例加载新引擎。重启后当前会话历史保留，从本文档接手。

---

## 一句话任务

重启后：① 验证 P0-1 已生效 → ② 在南大项目工作区建 GLM-5.2 指挥官会话 → ③ 下发 brief → ④ 监督其自主建树执行 nanju 文档迭代。

---

## 已完成（重启前，本次会话做的）

1. ✅ **P0-1 发布**：workspace 源（tree-engine 4306行 + patches）→ dev + release 两套 dist。验证 P0-1 锚点=0、review 门禁 isReviewRequired=6。备份 `.bak-pre-p01-publish-20260707`（两套 dist 的 tree-engine.cjs + proma-dev-patches.cjs）。
2. ✅ **SKILL v2.3 同步**：proma 工作区 tree-commander + tree-worker SKILL（v2.3，含 ISS-003 §4.6）→ default（南大）工作区。备份 `.bak-pre-p01-publish-20260707`。
3. ✅ **方法论放置**：4 个方法论文件（commander-methodology v1.2 / commander-methodology-v10 / tree-audit-methodology v1.0 / tree-commander-design v1.3）→ default + proma 的 `skills/tree-commander/reference/`。
4. ✅ **指挥官 brief 撰写**：`D:\Codes\multi-agent-collab-platform\.context\tree-commander-brief-2026-07-07.md`（10 节，自包含）。
5. ✅ **任务清单**：TaskCreate #1-4 已完成，#5-6 待重启后执行。

---

## 重启后第一步（按序执行）

### Step 1：验证 P0-1 生效（重启后实例已加载新 dist）
```bash
# P0-1 锚点应为 0（漏洞已修复）
grep -c "opts.type === 'done' && leaf.status !== 'done'" "D:/Proma-dev/resources/app/dist/tree-engine.cjs"
# review 门禁应 > 0
grep -c "isReviewRequired" "D:/Proma-dev/resources/app/dist/tree-engine.cjs"
```
或直接 `mcp__tree__tree_help(topic="how_to_init")` 确认 mcp__tree__* 可用。

### Step 2：在南大项目工作区建指挥官会话（GLM-5.2）
```
mcp__session__create_session(
  channel_id='cbb12a0b-3d21-476d-9812-d37bb5642cda',   # ZLM-CodingPlan
  model_id='GLM-5.2',
  workspace_id='0f21b16e-5189-4d1e-a33b-1b74cfe61608',  # 南大项目 (default)
  title='nanju-iter2 指挥官')
```

### Step 3：下发 brief（首条消息）
读取 `D:\Codes\multi-agent-collab-platform\.context\tree-commander-brief-2026-07-07.md` 全文，用 `mcp__session__send_message` 发给指挥官会话（wait=false，让它自主跑）。首条消息要点明：
- 你是 nanju-iter2 指挥官，完整执行所附 brief
- tree_id = `nanju-iter2`
- 先加载 tree-commander SKILL + `skills/tree-commander/reference/` 方法论
- 模型全链 GLM-5.2（fork 的 worker 继承，不切换）

### Step 4：监督（不全程阻塞）
指挥官自主建树。你用 `mcp__session__list_messages` / `mcp__tree__tree_leaf_list_active` 阶段性查进度。
**关键检查点**（复发检测）：
- worker 是否真跑 §4.6（`tree_event_list` 查 review_round event，末轮 red_count=0）
- 指挥官是否回填 brief_echo alignment（红线 3，否则 worker 卡 E_ALIGNMENT_NOT_VERIFIED）
- 是否有"v0.1 草稿直达 done"复发（ISSUE-001 教训）
- 跨层 D 项 #1/#3 是否修（影响未来 B 层）

---

## 关键参数速查

| 项 | 值 |
|---|---|
| 南大项目工作区 id | `0f21b16e-5189-4d1e-a33b-1b74cfe61608`（slug=default） |
| GLM-5.2 渠道 id | `cbb12a0b-3d21-476d-9812-d37bb5642cda`（ZLM-CodingPlan） |
| GLM-5.2 model_id | `GLM-5.2`（大写） |
| tree_id | `nanju-iter2` |
| 指挥官 leaf_id | `nanju-root` |
| brief 路径 | `D:\Codes\multi-agent-collab-platform\.context\tree-commander-brief-2026-07-07.md` |
| 课题根 | `D:\Codes\multi-agent-collab-platform` |
| 文档质量标准 | `D:\Codes\multi-agent-collab-platform\.context\设计阶段-文档产出清单与质量标准.md` |
| 课题 open-issues | `D:\Codes\multi-agent-collab-platform\.context\open-issues.md` |

---

## 备份与回滚

| 操作 | 命令 |
|---|---|
| dist 回滚（dev） | `cp D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-pre-p01-publish-20260707 D:/Proma-dev/resources/app/dist/tree-engine.cjs`（patches 同理） |
| dist 回滚（release） | 同上，路径换 `D:/Proma-release` |
| SKILL 回滚 | `cp .../default/skills/tree-commander/SKILL.md.bak-pre-p01-publish-20260707 .../default/skills/tree-commander/SKILL.md`（worker 同理） |
| 方法论回滚 | reference/ 是新增目录，`rm -rf` 即回滚 |

---

## 用户强调（不要忘）

- 🔴 **模型全链 GLM-5.2**：指挥官 + 所有 worker + 所有 SDK 子 Agent 一律 GLM-5.2，不切换。
- 🔴 **06_TESTS 也要生成**：test-plan.md + features/*.feature（覆盖 P0 用户故事）。
- 🔴 **范围**：04/05/06 文档迭代 + 跨层一致性（ISSUE-003 五条），**不含 B 层编码**。
- 🔴 **指挥官自主**：让它自己构建计划 + 建树执行，你只下发 brief + 监督，不 micromanage。

---

## 相关文档索引

| 用途 | 路径 |
|---|---|
| 本交接文档 | `workspace-files/.context/active/handoff-nanju-iter2-bootstrap-2026-07-07.md` |
| 指挥官 brief | `D:\Codes\multi-agent-collab-platform\.context\tree-commander-brief-2026-07-07.md` |
| tree harness 中期评审（P0 来源） | `workspace-files/.context/tree-harness-midterm-review.md` |
| 待解决问题清单（ISS-003 等） | `workspace-files/.context/待解决问题清单.md` |
| harness 修复交接（P0-1/P0-2/P0-3） | `workspace-files/.context/active/handoff-tree-harness-fix-2026-07-04.md` |

---

*交接完成。重启后从「重启后第一步」继续。*
