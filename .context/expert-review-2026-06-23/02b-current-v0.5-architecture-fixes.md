# v0.5 架构修复计划 — Tree 体系 4 个 bug

> 日期: 2026-06-23 08:50
> 来源: 用户李总在新工作区（tree 测试 1/2）实测发现
> 状态: **调研完毕，待用户拍板**

---

## 问题 1：Commander skill 不自带基础设施

### 现状
- `skills/tree-commander/SKILL.md` 加载自检（§0）要求 `<workspace>/.context/trees/tree-state.js` 存在
- 但 skill 目录 `skills/tree-commander/` 只有 `SKILL.md` 一个文件
- tree-state.js / tao-rules.json / 4 个 prompts 全靠用户手动 cp 进每个新 workspace
- 用户在新 workspace 用 commander 时报 "tree-state.js 未部署，无法启动指挥体系"

### 推荐方案
让 skill 自带 `scripts/` 子目录，首次激活自动 init：

```
skills/tree-commander/
  SKILL.md
  scripts/
    tree-state.js                  ← 复制自 release/tree-system-v0.2.2/core/
    init-workspace.cjs             ← 首次激活时跑：cp scripts/* → <workspace>/.context/trees/
    tao/
      tao-rules.json
      tao-audit-prompt.md
      tao-nudge-template.md
      tao-watcher-prompt.md
      tao-health-check-prompt.md
```

SKILL.md §0 加载自检改为：
```text
1. 检查 <workspace>/.context/trees/tree-state.js
2. 不存在 → 调 node <skill_dir>/scripts/init-workspace.cjs
3. init 脚本：mkdir + cp scripts/* → <workspace>/.context/trees/
4. 完成后继续原有 §0 流程
```

**好处**：用户开新 workspace 直接加载 skill 就能用，零手动 cp。

### 工作量
- 中等。需要把 release/core 的 tree-state.js + 5 个 prompts 整合进 skill 目录
- 写 init 脚本（30 行 cjs）
- 改 SKILL.md §0

---

## 问题 2：Commander / Worker 应是全局 skill

### 现状
- 当前 `skills/tree-commander/` 在 `~/.proma/agent-workspaces/proma/skills/`（绑定 proma workspace）
- 用户在"南大项目""tree测试1"等 workspace 加载时**根本没有这个 skill**
- 用户期望：装一次，所有 workspace 都能用

### 关键发现
**Proma 已有 `default-skills` 全局分发机制**：
- `~/.proma/default-skills/<skill-name>/` 是 skill 模板
- `main.cjs` 的 `copyDefaultSkills(workspaceSlug)`：每次**新建 workspace** 时，把 default-skills 整个 cp 到新 ws 的 skills/
- 已经在用：seedDefaultSkills 在启动时把 bundled skills 同步到 default-skills

### 推荐方案
1. 把 `skills/tree-commander/` 和 `skills/tree-worker/` 复制到 `~/.proma/default-skills/`
2. 对现有 5 个 workspace 手动 cp（写个一次性脚本，跑完删）
3. 以后新 workspace 自动获得

### 注意
- default-skills 是 "只读模板"，每次新建 ws 都会覆盖复制（如果用户在新 ws 改了 skill，新 ws 同名会被覆盖？需看 cpSync 是否覆盖 — `cpSync(recursive: true)` 会覆盖）
- 现有 workspace 不会自动获得，必须手动 cp

### 工作量
- 小。cp 2 个目录 + 写 1 个一次性脚本

---

## 问题 3：剪枝行为错误（最严重）

### 现状
- `tree-state.js` 的 `STATUS_ENUM = ['active', 'done', 'pruned', 'archived', 'segment_pending', 'pending_brief']`
- commander SKILL.md §7 "重档剪枝"指令组合：
  ```
  archive_session(子会话)        ← 真的把会话扔归档区
  fork_session(suggested_fork_from_uuid)
  tree-state.js leaf set-status <旧leaf> pruned
  drift append kind=<x> severity=high action=prune
  ```
- 用户反馈：**会话还在跑就被标 pruned** → 状态机说剪了，会话还在归档区跑

### 用户明确区分
- **剪枝（prune）= 标记**：不再主动沟通（不 send_message），状态变 pruned
- **归档（archive）= 整树完成后统一**：所有叶子都 done/pruned 后，统一 archive

### 根因
1. commander §7 把 archive_session 和 prune 混在一起，过早归档
2. archive_session 是 Proma 软归档（session 还能跑），状态机和实际不同步
3. worker skill 没有"剪枝权限"约束 — worker 可能自己改 status

### 推荐方案（拆分语义）

**改 tree-state.js**：
- `set-status` 加权限校验：只有 commander 角色能调 `pruned` / `archived`
- 加新字段 `archived_session: bool`：标记会话是否真归档（独立于 status）

**改 commander SKILL.md §7**：
- 重档剪枝（偏差 high + 已限权过）：
  ```
  # 旧: archive_session + set-status pruned + drift append + fork
  # 新:
  send_message(子会话, "你已被剪枝，停止主动行为")  ← 软停止
  set-status <旧leaf> pruned                        ← 仅状态标记
  drift append action=prune
  fork_session(...)
  # 不调 archive_session
  ```
- 整树完成（所有 leaves status ∈ {done, pruned}）后：
  ```
  for leaf in tree.leaves:
    if leaf.session_id and not leaf.archived_session:
      archive_session(leaf.session_id)              ← 此时才归档
      set leaf.archived_session = true
  tree set-status archived
  ```

**改 worker SKILL.md**：
- 加铁律：worker 永远不能 set-status 自己为 pruned/archived
- worker 只能上行 `done` / `blocked` / `plan` 给 commander
- 剪枝判定权归 commander（路由级决策）

### 工作量
- 中等偏大。要改 3 个文件：tree-state.js、commander SKILL.md、worker SKILL.md
- 加 archived_session 字段要跑 migrate（向后兼容）

---

## 问题 4：Watcher 设计模式不明

### 现状
- `TAOWatcherManager.startAll()` 启动时调 `discoverWorkspaces()`（找所有有 .context/trees/ 的 ws）
- 每个 workspace 起一个 `TAOWatcher`，按 `interval_seconds`（默认 5min）周期跑
- 不管 workspace 活跃与否，都按 5min 跑
- 用户困惑：是 per-workspace 还是统一？监控所有 ws 还是只监控活跃的？

### 用户期望（猜测）
- 资源省（不要 5 个 ws × 5 min = 25 次/h 全跑）
- 活跃 ws 才检查
- 静默 ws（30 min 无活动）跳过或降频

### 三种方案对比

| 方案 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| **A. per-workspace 现状** | 每个 ws 一个 timer | 实现简单 | 5 ws 都跑，浪费 |
| **B. 统一 manager + 活动感知** | 一个 timer 扫所有 ws，只跑活跃的 | 资源最省 | 实现复杂，长尾 ws 也会被扫 |
| **C. per-workspace + 自适应 interval（推荐）** | 每个 ws 一个 timer，按活跃度动态调 interval | 平衡，资源省，独立 | 需要活动度判断逻辑 |

### 推荐方案 C 详解

每个 watcher 加活动度判断：
```js
// 跑 tick 时:
const lastActivity = max(leaves[].last_event_ts, last_heartbeat, created_at);
const silenceMin = (now - lastActivity) / 60000;

if (silenceMin < 5) interval = 5;          // 活跃
else if (silenceMin < 30) interval = 10;   // 中等
else if (silenceMin < 120) interval = 30;  // 半静默
else {
  // 静默 > 2h：跳过这次 tick，但保留 timer，下次再判断
  log("workspace X 静默 2h+, 跳过本次检查");
  return;
}
```

加 IPC 让用户看每个 ws 的活动度：
```js
// proma:watcher:status 返回每个 ws 的:
{
  workspace_id,
  running,
  last_activity_ts,         // 业务时间
  silence_minutes,          // 距上次活动多久
  current_interval,         // 当前实际 interval
  last_run_at,
  last_run_status
}
```

**全局开关保留**（`cfg.enabled`）+ **per-ws override 保留**（`workspace_overrides`）。

### 工作量
- 小。改 TAOWatcher 加活动度判断 + 改 status IPC

---

## 当前 todo + v0.5 候选（其他未做项）

| 项 | 来源 | 状态 |
|---|---|---|
| 问题 B 排序 mtime（v0.4.5-b） | 上次会话遗留 | ❌ 修复无效，待重新诊断 |
| Split view（点击树叶 → 同屏切会话） | 用户 v0.2 原始需求 | ⏸️ 降级到 v0.5/v0.6 |
| 倒竖时间线视觉 | 用户被劝住 | ❌ 不做 |
| B2 文件竞态（watcher 与 Agent 并发写） | v0.3 优化 | ⏸️ 待做 |
| S2 nudge_log 无限增长 | v0.3 优化 | ⏸️ 待做 |
| L6 IPC 缓存 | v0.3 优化 | ⏸️ 待做 |

---

## 4 个新问题的优先级建议

| 优先级 | 问题 | 理由 |
|---|---|---|
| **P0** | 问题 3（剪枝行为错误） | 状态机错误，会话在归档区跑=数据错乱，最严重 |
| **P1** | 问题 1 + 2（skill 自带基础设施 + 全局） | 用户体验阻塞，开新 workspace 用不了 |
| **P2** | 问题 4（watcher 设计） | 资源问题，不阻塞功能 |

建议顺序：**3 → 1+2（一起做，互相关联）→ 4**。

---

## 待用户拍板的决策点

见 AskUserQuestion 4 个问题。
