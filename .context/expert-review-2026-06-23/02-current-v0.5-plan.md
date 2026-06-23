# v0.5 实施计划 — 详细步骤

> 日期: 2026-06-23 08:55
> 决策已锁定（用户 4 项选择）:
> - 问题 3: 拆分语义（prune=标记 / archive=整树完成后统一）
> - 问题 1+2: 全套（scripts/ + default-skills）
> - 问题 4: 方案 C（per-workspace + 自适应 interval）
> - 节奏: **全部修完一次性 commit**（一个 feature commit + 一个 wiki commit）
> 状态: **待用户最终审批，不动代码**

---

## 执行顺序

按依赖关系 + 风险控制：

```
[Phase 1] 问题 3 剪枝语义拆分（P0, 最严重，先做）
   ↓
[Phase 2] 问题 1+2 skill 自带 + 全局（P1，依赖 Phase 1 的 tree-state.js 新版）
   ↓
[Phase 3] 问题 4 watcher 自适应（P2，独立）
   ↓
[Phase 4] 部署 + 用户验证
   ↓
[Phase 5] wiki + commit（一次性）
```

---

## Phase 1: 问题 3 — 剪枝语义拆分

### 改动文件
1. `release/tree-system-v0.2.2/core/tree-state.js`
2. `skills/tree-commander/SKILL.md`
3. `skills/tree-worker/SKILL.md`

### 步骤 1.1: tree-state.js 加权限校验 + archived_session 字段

**位置**: `cmdLeafSetStatus` 函数（第 ~855-925 行）

**改动 A**：set-status 加角色权限校验
```js
// 在 leaf.status = new_status; 之前加:
if (new_status === 'pruned' || new_status === 'archived') {
  // 只有 commander 角色的 leaf 才能剪枝/归档
  // worker 不能自剪（防止 worker 把自己标 pruned 逃避审计）
  const isSelfCommander = leaf.role === 'commander';
  // 注：caller 上下文无法直接拿到（CLI 无 session），改用环境变量
  // PROMA_TREE_CALLER_ROLE=commander 时允许
  const callerRole = process.env.PROMA_TREE_CALLER_ROLE || 'unknown';
  if (!isSelfCommander && callerRole !== 'commander') {
    throw new TreeStateError(
      E_PERMISSION_DENIED,  // 新增错误码
      `cannot set status=${new_status}: only commander role can prune/archive. ` +
      `worker "${leaf_id}" cannot self-prune. Use PROMA_TREE_CALLER_ROLE=commander if you are commander.`
    );
  }
}
```

**改动 B**：加 `archived_session` 字段（独立于 status）
- 在 migrate 函数里补全：所有 leaves 加 `archived_session: false`
- 新建 leaf（cmdLeafAdd）默认 `archived_session: false`

```js
// migrate 函数（第 ~1882 行）里加:
for (const leaf of Object.values(state.leaves || {})) {
  if (leaf.archived_session === undefined) {
    leaf.archived_session = false;
    changes.push(`leaf ${leaf.leaf_id}: added archived_session=false (default)`);
  }
}
```

**改动 C**：加新错误码 `E_PERMISSION_DENIED`

### 步骤 1.2: commander SKILL.md §7 重档剪枝拆分

**位置**: 第 ~370-396 行的"重档剪枝"块

**旧**:
```
archive_session(子会话)
fork_session(...)
set-status <旧leaf> pruned
drift append action=prune
```

**新**:
```
# 重档剪枝（仅标记，不归档）:
send_message(子会话, "你已被剪枝，停止主动行为，等待重 Fork")
PROMA_TREE_CALLER_ROLE=commander tree-state.js leaf set-status <tree> <旧leaf> pruned
drift append kind=<x> severity=high action=prune fork-to=<新leaf>
fork_session(suggested_fork_from_uuid) 创建新会话
tree-state.js leaf add 新 leaf
```

**关键变化**: 删掉 `archive_session` 调用。pruned 只是状态标记。

### 步骤 1.3: commander SKILL.md §4 收尾加"统一归档"

**位置**: §4 工作流第 [7] 收尾步骤

**新加**:
```
[7] 收尾
   - node tree-state.js backup <tree_id> --label "milestone-<name>"
   - **统一归档**（新）:
     for leaf in tree.leaves:
       if leaf.session_id and not leaf.archived_session:
         archive_session(leaf.session_id)
         # 直接写 archived_session=true（绕过 set-status 权限校验，
         # 因为这是元数据字段，不是 status 字段）
         # 通过新子命令: tree-state.js leaf mark-archived <tree> <leaf>
   - tree-state.js tree set-status <tree_id> archived (整个 tree 标 archived)
   - 总结交付物 + drift_log 摘要给用户
```

加新子命令 `leaf mark-archived <tree> <leaf>`：仅设 `archived_session=true`，不改 status。

### 步骤 1.4: worker SKILL.md 加铁律

**位置**: 铁律列表（第 ~36-100 行）

**新加铁律**:
```
### 铁律 10：永远不能 set-status 自己为 pruned/archived

worker 不能自剪。剪枝判定权归 commander（路由级决策）。
如果你觉得自己应该被剪枝（如上下文将爆），上行 `blocked` 给 commander，
让 commander 决定是否剪枝 + Fork 续接。

违反 = 直接执行失败，会被审计 Agent 抓到。
```

---

## Phase 2: 问题 1+2 — skill 自带基础设施 + 全局

### 改动文件
1. 新建 `skills/tree-commander/scripts/tree-state.js`（cp 自 Phase 1 改完的版本）
2. 新建 `skills/tree-commander/scripts/tao/`（5 个文件）
3. 新建 `skills/tree-commander/scripts/init-workspace.cjs`
4. 改 `skills/tree-commander/SKILL.md` §0 加载自检
5. 新建一次性脚本 `migrate-existing-workspaces.cjs`（放 workspace-files/，跑完删）

### 步骤 2.1: 建 skill scripts/ 目录

```
skills/tree-commander/
  SKILL.md
  scripts/
    tree-state.js          # cp 自 release/.../core/tree-state.js（Phase 1 改完的版本）
    init-workspace.cjs     # 新写
    tao/
      tao-rules.json       # cp 自 .context/trees/
      tao-audit-prompt.md
      tao-nudge-template.md
      tao-watcher-prompt.md
      tao-health-check-prompt.md
```

### 步骤 2.2: 写 init-workspace.cjs（约 40 行）

```js
#!/usr/bin/env node
// 首次激活时把 scripts/* cp 到当前 workspace 的 .context/trees/
// 调用方式: node init-workspace.cjs <workspace_root>
const path = require('path');
const fs = require('fs');

const workspaceRoot = process.argv[2];
if (!workspaceRoot) {
  console.error('usage: node init-workspace.cjs <workspace_root>');
  process.exit(1);
}

const scriptDir = __dirname;
const targetTreesDir = path.join(workspaceRoot, '.context', 'trees');

// 1. mkdir .context/trees/
fs.mkdirSync(targetTreesDir, { recursive: true });

// 2. cp tree-state.js
fs.copyFileSync(
  path.join(scriptDir, 'tree-state.js'),
  path.join(targetTreesDir, 'tree-state.js')
);

// 3. cp tao/* (5 个文件)
const taoDir = path.join(targetTreesDir, 'tao');
fs.mkdirSync(taoDir, { recursive: true });
const taoSrc = path.join(scriptDir, 'tao');
for (const name of fs.readdirSync(taoSrc)) {
  fs.copyFileSync(path.join(taoSrc, name), path.join(taoDir, name));
}

console.log(`[init-workspace] tree-state.js + tao/* 已部署到 ${targetTreesDir}`);
```

### 步骤 2.3: 改 commander SKILL.md §0 加载自检

**位置**: §0 加载自检（第 ~17-28 行）

**新**:
```
1. 确认 tree-state.js 是否存在: ls <workspace>/.context/trees/tree-state.js
   - 不存在 → 跑自动初始化（新）:
     node <skill_dir>/scripts/init-workspace.cjs <workspace_root>
     完成后继续下一步
   - 存在 → 检查版本:
     node <workspace>/.context/trees/tree-state.js --version
     如果版本低于 <skill_dir>/scripts/tree-state.js 的版本 → 提示用户升级
2. 决定 tree_id ...
3. 跑 validate ...
4. 宣告 ...
```

### 步骤 2.4: 复制 skill 到 default-skills（手动 + 一次性脚本）

```bash
# 直接 cp（bash）:
cp -r skills/tree-commander ~/.proma/default-skills/
cp -r skills/tree-worker ~/.proma/default-skills/
```

### 步骤 2.5: 写 migrate-existing-workspaces.cjs

```js
// 把 default-skills 里的 tree-commander/worker 同步到现有 5 个 workspace
// 跑完即可删
const fs = require('fs');
const path = require('path');
const os = require('os');

const defaultSkillsDir = path.join(os.homedir(), '.proma', 'default-skills');
const workspacesRoot = path.join(os.homedir(), '.proma', 'agent-workspaces');

for (const wsSlug of fs.readdirSync(workspacesRoot)) {
  const wsSkills = path.join(workspacesRoot, wsSlug, 'skills');
  if (!fs.existsSync(wsSkills)) continue;
  for (const skillName of ['tree-commander', 'tree-worker']) {
    const src = path.join(defaultSkillsDir, skillName);
    const dst = path.join(wsSkills, skillName);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    console.log(`[migrate] ${wsSlug}/skills/${skillName} updated`);
  }
}
```

跑一次后删掉。

### 步骤 2.6: Proma 实例重启验证
- 关 Dev → 重启 → 新 workspace 加载 commander 应该自动 init

---

## Phase 3: 问题 4 — Watcher 自适应 interval

### 改动文件
- `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`
- **不**同步 release 镜像（用户已确认）

### 步骤 3.1: TAOWatcher 类加活动度判断

**位置**: `runOnce()` 函数（第 ~1601-1660 行）

**改动**: 在 activeTrees 收集阶段，额外计算每个 ws 的 `last_activity_ts`，根据 silence 决定本次 tick 是否真的跑规则：

```js
async runOnce() {
  if (this.running) { ... }
  this.running = true;
  try {
    const cfg = loadTaoConfig();
    const staleMs = (cfg.stale_tree_hours || 24) * 3600 * 1000;
    const now = Date.now();

    // === 新增: 算 workspace 整体活动度 ===
    let wsLastActivity = 0;
    let treeEntry = [];
    try { treeEntry = fs.readdirSync(this.workspace.trees_dir); } catch (_) {}
    const activeTrees = [];
    for (const name of treeEntry) {
      if (name.endsWith(".js") || name.endsWith(".json") || name.endsWith(".md")) continue;
      const statePath = path.join(this.workspace.trees_dir, name, "tree-state.json");
      if (!fs.existsSync(statePath)) continue;
      try {
        const stat = fs.statSync(statePath);
        const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
        // 业务活动度（不用 mtime，避免 watcher 自己更新干扰）
        let bizTs = 0;
        if (state.last_heartbeat) bizTs = Math.max(bizTs, new Date(state.last_heartbeat).getTime() || 0);
        if (state.created_at) bizTs = Math.max(bizTs, new Date(state.created_at).getTime() || 0);
        for (const leaf of Object.values(state.leaves || {})) {
          if (leaf && leaf.last_event_ts) {
            bizTs = Math.max(bizTs, new Date(leaf.last_event_ts).getTime() || 0);
          }
        }
        wsLastActivity = Math.max(wsLastActivity, bizTs);

        const mtimeFresh = (now - stat.mtimeMs) < staleMs;
        const hasActiveLeaf = Object.values(state.leaves || {}).some(l =>
          ["active", "pending_brief", "segment_pending"].includes(l.status)
        );
        if (mtimeFresh && hasActiveLeaf) {
          activeTrees.push({ tree_id: name, state, state_path: statePath, mtime: stat.mtimeMs });
        }
      } catch (e) {}
    }

    // === 新增: 自适应跳过 ===
    const silenceMin = wsLastActivity > 0 ? (now - wsLastActivity) / 60000 : Infinity;
    this.last_activity_ts = wsLastActivity > 0 ? new Date(wsLastActivity).toISOString() : null;
    this.silence_minutes = silenceMin;

    if (silenceMin > 120) {
      // 静默超 2h: 跳过本次检查, 但保留 timer
      this.last_run_at = new Date().toISOString();
      this.last_run_status = "skipped_silent";
      log(`[Patch M] Watcher[${this.workspace.workspace_id}] silence=${silenceMin.toFixed(0)}min > 120min, skip`);
      return;
    }

    // 调整下次 interval（动态）...
    // 见步骤 3.2

    // 跑规则（原有逻辑）
    let totalViolations = 0;
    for (const tree of activeTrees) { ... }
    ...
  }
}
```

### 步骤 3.2: 动态 interval（用 reschedule 而不是 setInterval）

**位置**: `start(intervalSeconds)` 函数（第 ~1581-1589 行）

**改动**: 把 `setInterval` 改成自调度 `setTimeout`，每次 runOnce 后根据 silence 算下次 interval：

```js
start(intervalSeconds) {
  this.stop();
  this.stopped = false;
  this.baseIntervalSec = intervalSeconds || 300;
  this._scheduleNext(0);  // 立即首次
  log(`[Patch M] Watcher started for workspace=${this.workspace.workspace_id} baseInterval=${this.baseIntervalSec}s`);
}

_scheduleNext(delaySec) {
  if (this.stopped) return;
  this.timer = setTimeout(async () => {
    await this.runOnce().catch(e => { this.last_error = String(e && e.message); });
    // 根据 silence 算下次 interval
    const nextDelay = this._computeNextIntervalSec();
    this._scheduleNext(nextDelay);
  }, Math.max(30, delaySec) * 1000);
}

_computeNextIntervalSec() {
  const silence = this.silence_minutes || 0;
  if (silence < 5) return this.baseIntervalSec;        // 活跃: 5min
  if (silence < 30) return Math.max(10, this.baseIntervalSec * 2);  // 半静默: 10min
  return Math.max(30, this.baseIntervalSec * 6);       // 静默: 30min
}

stop() {
  this.stopped = true;
  if (this.timer) {
    clearTimeout(this.timer);
    this.timer = null;
  }
}
```

### 步骤 3.3: status IPC 返回新字段

**位置**: `TAOWatcherManager.status()` 第 ~1716-1732 行

```js
result.watchers.push({
  workspace_id: id,
  workspace_root: w.workspace.workspace_root,
  trees_dir: w.workspace.trees_dir,
  is_isolated: w.workspace.is_isolated,
  running: w.running,
  last_run_at: w.last_run_at,
  last_run_status: w.last_run_status,
  last_error: w.last_error,
  timer_active: !!w.timer,
  // 新增:
  last_activity_ts: w.last_activity_ts || null,
  silence_minutes: w.silence_minutes || null,
  current_interval_sec: w._computeNextIntervalSec ? w._computeNextIntervalSec() : null
});
```

### 步骤 3.4: 浮窗 UI 显示活动度（可选）
- 在第二层 tree tab 上加 silence_minutes badge
- > 60min 显示灰色"静默 N min"

---

## Phase 4: 部署 + 用户验证

### 部署清单
- [ ] cp `release/.../core/tree-state.js`（Phase 1 改完版）→ 所有现有 workspace 的 `.context/trees/`
- [ ] cp 改完的 `skills/tree-commander/` → Dev 实例工作区（含 scripts/）
- [ ] cp 改完的 `skills/tree-commander/` + `skills/tree-worker/` → `~/.proma/default-skills/`
- [ ] 跑 `migrate-existing-workspaces.cjs`
- [ ] 改完的 `proma-dev-patches.cjs` 已直接在 `D:/Proma-dev/`（Phase 3）

### 验证清单
- [ ] Dev 重启 → 旧 workspace 加载 commander skill 应不报错
- [ ] **新 workspace** 加载 commander skill → 自动 init `.context/trees/`
- [ ] 测试剪枝场景：人为触发一个 worker 偏差 → commander 重档剪枝 → 旧 leaf 应只标 pruned，会话不被 archive
- [ ] 整树完成后调统一归档 → 所有 leaves archived_session=true
- [ ] watcher status IPC 显示 last_activity_ts + silence_minutes
- [ ] 静默 ws（无活动 > 2h）跑 tick 应输出 "skip" 日志

---

## Phase 5: wiki + commit（一次性）

### 步骤 5.1: 更新 wiki
- `proma-dev-wiki.md` 加 v0.5 完整版本记录（一段大表）
- patch-L 版本表加 v0.5 行
- 加新章节 "v0.5 架构修复" 详述 4 个 bug 的修法

### 步骤 5.2: commit（一次性）
按用户选择，全部修完一个 feature commit + 一个 wiki commit：

```bash
git add skills/tree-commander/ skills/tree-worker/
git add release/tree-system-v0.2.2/core/tree-state.js
git add proma-dev-patches.cjs  # 注意：dev 目录文件不在 git 仓库, 这条实际不执行
# 实际只 add 在 workspace-files/ 仓库里的文件

git commit -m "feat(v0.5): tree 体系架构修复 - 剪枝语义拆分 + skill 全局化 + watcher 自适应"
```

### 步骤 5.3: 重新启用问题 B 排序的重新诊断（独立任务，不在 v0.5 内）
- v0.5 完成后单独 dump 数据诊断问题 B

---

## 风险与回滚

### 风险点
1. **tree-state.js 改动可能破坏现有 tree 数据**
   - 缓解：migrate 自动补 archived_session 字段
   - 回滚：从 backup 恢复 tree-state.json
2. **default-skills cp 覆盖现有 skill**
   - 缓解：跑 migrate 前先 backup 各 ws 的 skills/
3. **watcher 自适应 interval 改 setTimeout 后并发行为变化**
   - 缓解：先 dry-run 看 log，确认 skip 行为正常

### 回滚方案
- tree-state.js: `git checkout` 上一个版本 + restore tree-state.backup
- skills: 从 backup cp 回原版
- watcher: 从 git 上一个 patches.cjs 版本 cp 回 dev

---

## 工作量估算

| Phase | 时间估算 | 文件数 |
|---|---|---|
| Phase 1（剪枝） | 60 min | 3 |
| Phase 2（skill 全局） | 40 min | 8 新建 + 2 改 |
| Phase 3（watcher） | 30 min | 1 改 |
| Phase 4（部署验证） | 用户配合 | - |
| Phase 5（commit） | 10 min | wiki |
| **总计** | **~2.5 小时编码 + 用户验证** | **13 个文件** |

---

## 待用户决策点（仅一个）

看完本计划，告诉我：
1. ✅ 直接开干
2. 调整某些步骤（指出哪里）
3. 先做某个 Phase，其他暂缓
4. 还需要补充什么我没考虑到的
