# 团队配置（Team Config）

> 维护：周星星 | 产出：2026-07-11 会话 bbdefd1e（产品设计补建）
> 配套：[product-positioning.md](./product-positioning.md) · [cost-guardrails.md](./cost-guardrails.md) · [../CLAUDE.md](../CLAUDE.md) §P0 教训

本文定义 tree-system 的**角色 ↔ 模型 ↔ 工具 ↔ 成本上限**矩阵。这是 macp2 成本爆炸事故的**直接根因之一**（SubAgent C 指出：无 team-config → SubAgent 调用形式未钉死 → DeepSeek commander 用 create_session 当 reviewer → 4 分钟炸 207 会话）。

---

## 一、角色枚举与职责（4 角色）

| 角色 | 职责 | 权限 | 限制 |
|---|---|---|---|
| **root** | 信任锚；建树；audit_gate 把关 | 全权；冷启动可自调当 auditor（闸门2 信任锚特例） | 不自审（trust anchor 特例除外）；parent=null 唯一 |
| **commander** | 协调；派 worker/auditor；归档；alignment 回填 | mcp__tree__* 协调工具；派子节点 | 嵌套深度 ≤ 3；不能自审自己派出的 worker |
| **worker** | 原子叶；实现任务；brief_echo→done | 进程内 Agent 工具做 G1-G5 自审；调 event_append/set-status 自己 | **不能有子节点**；不能当 added_by；不能直读 tree-state.json |
| **auditor**（P0a 新增） | 独立审计 leaf；审查产出 | 独立 session；简化协议（brief_echo+done+audit_gate，无 milestone） | **不能当 parent/operator**（同 worker）；不能自审（需 root 信任锚背书） |

---

## 二、角色 ↔ 模型矩阵

> 模型特性基于 commander-methodology §4.2 + note.md 观测。**模型 ID 以实际 Proma 频道为准**（频道稳定性随时间变，note 06-18 说 GLM 稳、07-07 说 DeepSeek 稳，需实测）。

| 角色 | 推荐模型 | 理由 | 风险/护栏 |
|---|---|---|---|
| **root** | GLM-5.2 / Claude | 信任锚要稳，少量高质量决策 | 成本低（root 调用少） |
| **commander** | GLM-5.2（直接动手型） | 协调需理解力 + 执行力 | 需配 SubAgent 红线（§三）防 create_session 滥用 |
| **worker** | GLM-5.2（执行）／DeepSeek V4 Pro（试错型，秒回） | 执行任务，量大需便宜 | DeepSeek 是 macp2 事故主角，**必须配预算护栏 + 收敛条件** |
| **auditor** | Claude（质量优先）／DeepSeek V4 Pro | 审查要高质量，量少 | 独立 session，避免与被审者同模型同频道（防互审洗白） |
| **洁净室 Cr** | Claude / 不同模型 | 多视角要差异 | 禁看实现者测试 |

### 模型降级策略（macp2 postmortem §六 P2）
当首选模型不可用/太贵：
1. **降级到更便宜模型**（Claude→DeepSeek→GLM），但保持角色纪律不变
2. **降维设计**：无进程内 Agent 工具时 → 单 reviewer 或 commander 自审（不 spawn 多 agent）
3. **绝不用 spawn 真实会话替代**（create_session/fork_session = 钱）

---

## 三、角色 ↔ 工具矩阵（⚠️ macp2 P0 红线）

| 工具类 | root | commander | worker | auditor | 说明 |
|---|---|---|---|---|---|
| `mcp__tree__*`（协调：init/leaf_add/audit_gate/...） | ✅ | ✅ | 🟡（仅自己 leaf 的 event_append/set-status） | 🟡（仅自己 leaf） | caller-binding 校验身份 |
| **进程内 SDK Agent 工具**（自审 G1-G5） | ✅ | ✅ | ✅ | ✅ | **SubAgent 唯一合法形式** |
| `create_session` / `fork_session` | ✅（建会话） | ✅ 正常派生（[design-commander-spawn](../05_PROJECT_PLAN/design-commander-spawn.md)）/ 🚫 **禁当 reviewer/SubAgent** | 🚫 | 🚫 | **= 真实会话 = 钱**（macp2 红线：禁当 reviewer，**非**禁正常派生 commander/worker 会话）|
| `delegate_agent`（collaboration） | ✅ | 🚫 **禁当 reviewer/SubAgent** | 🚫 | 🚫 | 同上（commander 正常派生用 create_session，不用 delegate_agent）|
| 直读/直写 tree-state.json | 🚫 | 🚫 | 🚫 | 🚫 | 铁律#1，只能走 mcp__tree__* |

### 🔴 SubAgent 调用形式红线（CLAUDE.md P0 永久教训）
> **SubAgent = 进程内 SDK Agent 工具**（in-process，不建独立会话、不在侧边栏）。
> **🚫 严禁** `create_session`/`fork_session`/`delegate_agent` 当 reviewer/SubAgent —— 这些是真实会话，是成本爆炸口。

**前置验证（任何 SubAgent 设计前）**：确认目标会话（如 pro commander）工具集**是否含进程内 Agent 工具**。若无 → 设计降维（单 reviewer 或 commander 自审）。

---

## 四、角色 ↔ 成本上限

| 角色 | 约束 | 默认值 | 来源 |
|---|---|---|---|
| tree（全局） | `node_budget`（active leaf 数） | 20 | root_dod.node_budget（macp2 后 10→20） |
| tree（全局） | `max_sessions` | （待硬落地） | macp2 postmortem P1 |
| worker | `max_subagent_spawn_per_leaf` | 15 | E_SUBAGENT_BUDGET_EXCEEDED |
| 单 caller | create_session 60s 窗口 | ≤ 20 | E_SESSION_BUDGET_EXCEEDED（07-09 新增） |
| commander | 嵌套深度（tree-role-depth，root→child→grandchild） | ≤ 3 | E_DEPTH_EXCEEDED（engine 层）|
| session 委派链（create/fork delegation depth） | ≤ 10 | E_DELEGATION_TOO_DEEP（patches 层 MAX_DELEGATION_DEPTH，**区别于** commander 嵌套）|
| review 收敛 | 角色数 / 轮数 | 2/3/5 分档（对齐 worker SKILL §4.6 字数分档），轮 ≤ 3 | SKILL §13.5（macp2 后） |

> 详细护栏机制见 [cost-guardrails.md](./cost-guardrails.md)。

---

## 五、激活条件（何时建哪个角色）

```
建树 → 必有 root（信任锚，tree_init 自动）
  │
  ├─ 任务需并行/协调？ ─是→ 派 commander（depth≤3）
  │     │
  │     ├─ 有实现子任务？ ─是→ 派 worker（执行，brief_echo→done）
  │     │
  │     └─ 需独立审查？ ─是→ 派 auditor（role=auditor，独立 session）
  │           │
  │           └─ 冷启动期（无可用 auditor session）→ root 自调当 auditor（闸门2 信任锚）
  │
  └─ 任务简单/单步？ ─是→ root 直接派 worker，不经 commander
```

### 不可替代性检验（建角色前必问）
建一个新角色前，问自己：
1. **这个角色的产出，能否由现有角色（root/commander/worker）之一替代？** 能则不建。
2. **这个角色是否需要独立 session（防利益冲突）？** 是则用 auditor。
3. **这个角色是否有明确收敛条件（角色数/轮数/停止）？** 无则不建（防 macp2）。

---

## 六、团队配置实例（参考）

### 实例 A：小模块并行实现（场景 1）
```
root（GLM-5.2，信任锚 + 审计把关）
├── commander-1（GLM-5.2，协调微服务A）
│   ├── worker-A1（GLM-5.2，实现 API）
│   ├── worker-A2（DeepSeek，实现 UI）
│   └── auditor-A（Claude，独立审 A1/A2）  ← 不同模型防洗白
└── commander-2（GLM-5.2，协调微服务B）...
```
- 角色：1 root + 2 commander + N worker + N auditor
- 成本：node_budget 20，subagent_spawn 15

### 实例 B：设计文档多视角评审（场景 4）
```
root
├── worker-D（GLM-5.2，产出设计 v0.1）
└── 审查层（≥4 独立 leaf，铁律1）
    ├── reviewer-架构（Claude）
    ├── reviewer-安全（Claude）
    ├── reviewer-UX（DeepSeek）
    └── reviewer-成本（DeepSeek）
```
- 收敛：review_round red_count=0 才算收敛（P1b fix_evidence）

---

## 七、当前 gap（待补）

| gap | 影响 | 优先级 |
|---|---|---|
| `max_sessions` 引擎硬护栏未落地（SKILL v2.5 仅软约束） | macp2 型爆炸根盲区未根治 | P0（聚类 A） |
| auditor 端到端 fallback 不可用（P1-S04，fork identity timeout） | auditor role 在当前环境难用 | P1 |
| 模型频道稳定性未统一口径（note 06-18 vs 07-07 矛盾） | 模型选择缺依据 | P2 |
| 无模型成本实测数据（单价/速度/质量三角） | 成本权衡靠经验 | P2（待 success-metrics 对照实验补） |
