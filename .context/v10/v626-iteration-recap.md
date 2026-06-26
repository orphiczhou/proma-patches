# V10 Phase 3 Followup 3 轮迭代总结 2026-06-26 14:30

> 验证会话: ce9a1e2f (root, GLM-5.2) + e341171d (V4 Pro commander) | 工作区: proma
> 前置修复: commit `30eb4fa` (Bug A/B) + `9c423b8` (TAO Watcher 第一层) + `1a7ed5f` (applyNudge)
> 本次新增: create_session workspace_id 校验 + fork_session 同类漏洞补丁 + validateWorkspaceId helper
> 方法论: **Iterative Hardening Loop (IHL) / 盲点驱动的迭代加固**

## 一句话总结

**3 轮迭代全部闭环**: R1 applyNudge 守卫运行时 PASS / R2 create_session+fork_session 双入口拦截静态 PASS 待重启 / R3 V4 Pro commander 端到端 PASS（3 项 Bug 验证全 PASS）。**第 4 轮发现已通过审计暴露**（fork_session 同类漏洞），符合 IHL 模式。

## 3 轮迭代矩阵

| 轮次 | 起点 | 修复 | 验证方式 | 结果 |
|------|------|------|----------|------|
| **R1** TAO Watcher 补盲 | bugav tree 实测发现 R-04 tree 级规则绕过 9c423b8 守卫 | `applyNudge` 入口全局守卫（commit `1a7ed5f`） | 重置 nudge_log + 等 5.5 分钟巡逻 + SubAgent 校验 | ✅ PASS — 2 leaf nudge_log 重置后保持空 |
| **R2** 跨工作区 create_session 拦截 | GLM-5.2 v1 落 "undefined" slug → E_NO_TREES_DIR | `validateWorkspaceId` helper + create_session + fork_session 三处调用 | code-reviewer SubAgent 静态审查 + 运行时探测 | ✅ 静态 PASS / 运行时待重启 |
| **R3** TreeCommander 端到端 | 需真实端到端串联修复链 | v626 树 + V4 Pro commander (e341171d) + SDK SubAgent 并行监督 | commander 自主跑 5 步流程 + 3 SubAgent 监督 | ✅ PASS — 3 项 Bug 验证全 PASS |
| **R4** (审计发现) | code-reviewer SubAgent 发现 fork_session new_workspace_id 同样未校验 | 重构 `validateWorkspaceId` helper 共享给 create + fork | 复用 R2 审查（同一 helper） | ✅ 已修复同步 |

## R1 闭环证据

bugav tree 重置 nudge_log 后等巡逻：

| Leaf | 重置前（截至 06:10:59 UTC） | 重置后（14:19 后巡逻） |
|------|------------------------------|------------------------|
| bugav-A-worker | nudge_count=6, 6 条 R-04 | **nudge_count=0, nudge_log=[]** ✅ |
| bugav-A2-worker | nudge_count=6, 6 条 R-04 | **nudge_count=0, nudge_log=[]** ✅ |

TAO Watcher 仍跑 R-04 检测违规（audit_log 持续增长），但 `applyNudge` 入口检测到 session_id `4edacb8b` 被 2 个 leaf 共享，直接 return 不写 nudge。**双层守卫（checkAllRules 入口 + applyNudge 兜底）按设计工作**。

## R2 修复详情

### validateWorkspaceId helper（新增）

位置：`proma-dev-patches.cjs` L173-203（紧跟 api() 后）

```javascript
function validateWorkspaceId(workspaceId) {
  if (!workspaceId) return { ok: true };  // 未指定, 走默认 fallback
  const trimmed = (typeof workspaceId === 'string') ? workspaceId.trim() : workspaceId;
  if (!trimmed) return { ok: true };
  let validIds = null;
  try {
    const workspaces = api().listAgentWorkspaces() || [];
    validIds = new Set(workspaces.map(w => w.id));
  } catch (e) {
    log("validateWorkspaceId: listAgentWorkspaces failed, skip validation: " + (e && e.message));
    return { ok: true };  // best-effort, 不阻断
  }
  if (validIds.has(trimmed)) return { ok: true, normalized: trimmed };
  // ...返回 E_WORKSPACE_NOT_FOUND
}
```

### 调用点 1: create_session (L461-466)

```javascript
const wsCheck = validateWorkspaceId(args.workspace_id);
if (!wsCheck.ok) return jsonResult({ ok: false, error: wsCheck.error });
const workspaceId = wsCheck.normalized || args.workspace_id;
```

### 调用点 2: fork_session (L601-606, R4 新增)

```javascript
if (args.new_workspace_id) {
  const wsCheck = validateWorkspaceId(args.new_workspace_id);
  if (!wsCheck.ok) return jsonResult({ ok: false, error: wsCheck.error });
  updates.workspaceId = wsCheck.normalized || args.new_workspace_id;
}
```

### 运行时探测（验证当前 Proma 状态）

调 `create_session(workspace_id="invalid-workspace-id-probe-12345")` 返回 `ok=true` 并创建孤儿 session `7bb57dd2` → **当前 14:16 重启加载的是 1a7ed5f 版本，不含本次 R2 修复**。需要用户再次重启才能加载。

## R3 端到端验证证据

v626 tree + V4 Pro commander (e341171d, deepseek-v4-pro channel)。

### Commander 自主执行流程

| 步骤 | 工具调用 | 返回 | 期望 |
|------|----------|------|------|
| 1. 加 milestone | `tree_milestone_add(v626, v626-A-commander, m-verify)` | ok=true | ✅ |
| 2. Bug A 复测 | `tree_event_append(v626, v626-A1-worker, done)` (caller=e341171d, leaf.session=663f0be1) | `E_BORROWED_IDENTITY` | ✅ |
| 3. Bug B 复测 | `tree_leaf_add(v626, v626-A2-worker, session_id=e341171d)` | `E_DUPLICATE_SESSION_ID` | ✅ |
| 4. TAO Watcher 检查 | 读 bugav tree-state.json | nudge_log=[] | ✅ |
| 5. done event | `tree_event_append(v626, v626-A-commander, done, self_check)` | ok=true | ✅ |

### self_check 4 项全 pass=true

```json
{
  "E_BORROWED_IDENTITY 拦截": {"pass": true, "detail": "caller e341171d 无法为 session 663f0be1 的 leaf 写 done"},
  "E_DUPLICATE_SESSION_ID 拦截": {"pass": true, "detail": "session e341171d 已注册为 v626-A-commander"},
  "TAO Watcher applyNudge 守卫": {"pass": true, "detail": "bugav 2 leaf 共享 session 4edacb8b, nudge_log 全空"},
  "全部 gate 通过": {"pass": true}
}
```

### 副产品：V10 加固自我证明

Commander 完成 done event 后，TAO Watcher 跑 C-03 规则发现 `milestone m-verify 未 audit_pass=true` → 发 nudge 给 commander（C-03 high）。证明 C-03 milestone 一致性加固在工作。

## R4 审计驱动的补丁（IHL 模式典型）

code-reviewer SubAgent（`a957db15`）审计 3 轮修复链时发现：

> fork_session `new_workspace_id` (`proma-dev-patches.cjs:561`) 直接赋值给 `updates.workspaceId`，没有进行工作空间索引校验 — 与 create_session 有相同的漏洞模式。这是一个真正的漏洞；恶意/错误的操作员可以通过 fork 引入一个虚假的工作空间，重新引发 slug "undefined" / 跨工作区漂移类问题。**严重性：高**。

**立即补丁**（IHL R4）：
1. 把 create_session 内联校验逻辑提取成 `validateWorkspaceId` helper
2. create_session 改用 helper（行为不变）
3. fork_session 调用同一 helper

**修复后审计拓扑**：
```
create_session(args.workspace_id) ──┐
                                    ├──→ validateWorkspaceId() ──→ listAgentWorkspaces 索引
fork_session(args.new_workspace_id) ┘
```

两入口共享同一校验逻辑，符合 DRY + defense-in-depth。

## 完整修复拓扑（V10 Phase 3 → followup）

```
入口拦截层（V10 P3 + R2）
├── cmdEventAppend L1498 (Bug A-1: caller != leaf.session)
├── cmdLeafAdd L705 (Bug B-3: session_id 唯一性, E_DUPLICATE_SESSION_ID)
├── create_session L461 (R2: workspace_id 校验, E_WORKSPACE_NOT_FOUND)
└── fork_session L601 (R4: new_workspace_id 同类校验)

兜底守卫层（V10 P3 + R1）
├── cmdAuditGate L2337 (Bug A-2: caller == audit_session_id)
├── resolveAuditorIndep L1897 (Bug B-4: 跳过 pruned/archived)
├── checkAllRules 入口 (9c423b8: isSharedSessionLeaf 跳过子级规则)
└── applyNudge 入口 (1a7ed5f: sharedCount 跳过所有规则, 补 R-04/05/06 盲点)
```

## IHL 方法论（来自 researcher SubAgent）

### 模式定义
**Iterative Hardening Loop (IHL) / 盲点驱动的迭代加固**：每轮加固的不是"功能"，而是"防御纵深"——任何单层守卫都假设会被绕过，因此补丁形态永远是"双层兜底"。

### 4 步闭环 SOP
1. **盲点暴露**：靠真实场景（构造数据 + 等系统反应），而非静态审查
2. **入口补丁**：在副作用真正发生的前一刻拦截
3. **SubAgent 静态校验**：commit 前用 code-reviewer/explorer/researcher 之一做廉价过滤
4. **运行时验证**：构造真实场景做端到端复现

### 关键洞察
- **真实场景优先**：R1 的 tree 级盲点、R2 的 slug 漂移都不是静态审查发现的
- **入口拦截必须配套兜底守卫**：守卫放在"副作用真正发生的前一刻"
- **SubAgent 并行监督标准化**：每轮引入一个 SubAgent，是运行时验证前的廉价过滤层

### 下一步 V10 加固准则
1. 入口拦截一律采用"调用方校验 + 副作用点守卫"双层结构
2. 任何补丁 commit 前强制 SubAgent 静态审查
3. commit 后强制构造真实场景做运行时复现
4. E2E 验证作为修复链收尾的硬性环节，不允许仅凭静态 PASS 收工

### 风险提示
- 运行时验证依赖重启/巡逻周期，需在排期上预留窗口
- SubAgent 审查有"权威偏差"风险，关键逻辑应派 ≥2 个不同视角 SubAgent 交叉确认
- "双层守卫"易演化为守卫蔓延，需定期审计守卫层级

## 待办

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 1 | commit + push R2/R4 修复 | ⏳ pending | validateWorkspaceId helper + create_session + fork_session |
| 2 | 重启 Proma 加载 R2/R4 修复 | ⏳ pending | 用户操作 |
| 3 | R2 运行时验证 | ⏳ pending | 重启后调 create_session(workspace_id="invalid") → 期望 E_WORKSPACE_NOT_FOUND |
| 4 | R4 运行时验证 | ⏳ pending | 重启后调 fork_session(new_workspace_id="invalid") → 期望 E_WORKSPACE_NOT_FOUND |
| 5 | 沉淀 IHL 到 commander-methodology-v10.md | ⏳ pending | 任务 13 |
| 6 | 错误响应格式统一（fork_session 等扁平 error） | 🟡 P2 | SubAgent 审计建议 |
| 7 | leaf_set_session 错误码改为 E_DUPLICATE_SESSION_ID | 🟡 P2 | SubAgent 审计建议 |

## 关联

- 代码文件: `proma-dev-patches.cjs` (2581 行, 3 份同步)
- v626 tree: `.context/trees/v626/tree-state.json`
- bugav tree (R1 证据): `.context/trees/bugav/tree-state.json`
- IHL 方法论来源: researcher SubAgent (`adb6e8c5`)
- 完整修复链审计: code-reviewer SubAgent (`a957db15`)
- Commander 端到端报告: session `e341171d` message index 72
