# 跨工作区开 Tree 问题调查报告

> 调查日期: 2026-06-25 | 调查会话: ef3bb7f0 | 用户发起: 周星星
> 结论: commander 跨工作区开 Tree 是**设计外行为**，根因是 Proma 平台 `createAgentSession` 不校验 `workspaceId`，且 session-management SKILL 模式 4 明确教授此用法。

---

## 一、现象

`~/.proma/agent-workspaces/` 下当前存在 **9 个工作区**：

| 工作区 | 创建时间 | 性质 | 价值 |
|--------|----------|------|------|
| `workspace-1775185214379` | 2026-04-10 | 早期临时（仅基础 Skills） | 无 |
| `workspace-1778510916164` | 2026-05-13 | 临时（含 session-management SKILL） | 无 |
| `workspace-1776227916908` | 2026-06-21 | 临时 | 无 |
| `workspace-1779015714856` | 2026-06-19 | 临时 | 无 |
| `default` | 2026-06-19 | 默认工作区（大量历史会话子目录） | 评估 |
| `tree-1` | 2026-06-23 | V10 测试工作区 1（13 个会话子目录，无 tree-state.json） | 无 |
| `undefined` | 2026-06-24 | slug "undefined" bug 孤儿（仅 audit-gate-test 残留） | 无（清理） |
| `tree-2` | 2026-06-25 | V10 P2 e2e 测试（21 个会话 + v10p2-e2e 树 + v10-p2-e2e-report.md） | **有重要产出** |
| `proma` | 2026-06-19 | 主工作区，PROJECT-INDEX + 全部方法论 + 交付物 | **必须保留** |

**设计意图**：1 个主工作区（`proma`），其他全是设计外。

---

## 二、根因（确认）

### 2.1 平台允许 commander 任意创建/指定工作区

证据链：

1. **`main.cjs:386651` `createAgentSession(title, channelId, workspaceId, modelId)`** — **不校验 `workspaceId` 是否在索引中存在**，直接写入 `meta.workspaceId` 字段
2. **`proma-dev-patches.cjs:446`** MCP `create_session` handler — 把 `args.workspace_id` **原样透传**给 `createAgentSession`，无权限边界
3. **没有 `create_workspace` MCP 工具** — `mcp__session__list_workspaces` 是只读，没有创建工具。commander 不能直接 create_workspace，但能 `create_session(workspace_id=任意值)` — 由于 `createAgentSession` 不校验，**只要 workspaceId 是已存在工作区的 id**，session 就能挂上去
4. tree-1/tree-2 是**先由用户手动建好工作区**（在 Proma UI 里），再由 commander 用其 id 开会话

### 2.2 SKILL 教授此用法（设计层放任）

`skills/session-management/SKILL.md` 模式 4（行 71-78）**明确教授**：

```
create_session(workspace_id="xxx") → 在指定工作区创建会话
```

这是 Proma 官方文档层面对跨工作区操作的"允许"声明。

### 2.3 tree-commander SKILL 设计不带 workspace_id

`tree-commander/SKILL.md` §4 工作流只调 `create_session(channel_id, model_id)` **不带 workspace_id 参数**——所以**设计意图是 commander 不应该跨工作区**。但平台 + session-management SKILL 双重放任，导致 commander 实际可以跨。

### 2.4 slug "undefined" 已修但孤儿残留

`findTreesDirForWorkspace` (patches.cjs:1101-1106) V10 已加 `"undefined"|"null"|"''"` → fallback `"default"` 保护。但 `~/.proma/agent-workspaces/undefined/` 是 V10 修复前的孤儿（`audit-gate-test-20260625/tree-state.json` 残留）。

---

## 三、影响范围

### 3.1 跨工作区 tree 数据隔离
- tree-2 的 `v10p2-e2e/tree-state.json`（30 次写操作、5 个 leaf、含审计链 `7c9b6b65→15109031→52551d11`）**主工作区看不到**
- 主工作区的 `mcp__tree__tree_leaf_list` 等工具无法访问 tree-2 数据
- 主工作区审计链完整性受损

### 3.2 workspace_id 漂移 → mcp__tree__* 失败
- 补丁 V10 注释（patches.cjs:765-771, 1098-1101）记录失守案例 `532465c5`
- 调用方传 `workspace_id=undefined`，被序列化成字符串 `"undefined"` 当 slug 用
- `findTreesDirForWorkspace` 返回 null → mcp__tree__* 直调不可用
- **与 dev MCP workspace=null bug 同源**

### 3.3 审计链断裂
- tree-2 `v10p2-C-auditor` (leaf) 由 session `15109031` 担任
- 该会话物理位于 tree-2 工作区
- 主工作区 `audit/` 目录审计**无法覆盖**

### 3.4 磁盘膨胀
- tree-2 含 21 个会话子目录 + 3 个 auto backup
- tree-1 含 13 个会话子目录
- 每个工作区都有自己的 `.claude/` 配置副本

---

## 四、设计意图 vs 实际行为对照

| 项目 | 设计意图 | 实际行为 | 差距 |
|------|----------|----------|------|
| 工作区数量 | 1 主（proma） | 9 个（主 + 4 临时 + default + 2 测试 + 1 孤儿） | **8 个设计外** |
| commander 工作区权限 | tree-commander SKILL 全文未提及 workspace_id | SKILL 模式 4 教授跨工作区，平台不拦 | **设计 vs SKILL 矛盾** |
| workspace 隔离 | 设计上 tree 数据应集中在主工作区 | tree-2 测试数据在 tree-2，主工作区看不到 | **审计链断裂** |
| slug fallback | "default"（V10 修） | 修复前残留 `undefined/` 工作区 | **孤儿清理** |
| create_session 校验 | 应拒绝 workspace_id 不存在 | 直接透传，无校验 | **平台层缺陷** |

---

## 五、修复方案（按优先级）

### 🔴 P0 短期（清理）

立即可做：

1. **归档 tree-2 关键产出**：把 `tree-2/workspace-files/.context/v10-p2-e2e-report.md` + `v10p2-e2e/tree-state.json` 拷贝到 `proma/workspace-files/.context/audit/v10-p2/` 后删 tree-2
2. **直接删 `undefined/`**（slug bug 孤儿，无价值）
3. **直接删 4 个 `workspace-{ID}/`**（早期临时，无 .context 产出）
4. **评估 `default/`**：含大量历史会话子目录（005fa927/00e787f9... 全是 UUID），看是否有重要对话
5. **直接删 `tree-1/`**（13 个空会话目录，`.context/trees/` 仅有 tao-* 模板，**无 tree-state.json**）

### 🟡 P1 中期（patches.cjs 拦截）

在 patches 层加边界：

```javascript
// proma-dev-patches.cjs:446 create_session handler 加校验
const validWorkspaces = await a.listAgentWorkspaces();
const validIds = new Set(validWorkspaces.map(w => w.id));
if (args.workspace_id && !validIds.has(args.workspace_id)) {
  return { ok: false, error: `E_WORKSPACE_NOT_FOUND: workspace_id "${args.workspace_id}" not in index` };
}
// commander 类型会话应强制 workspace_id = 调用方所在 workspace
const mySession = await a.getMySessionId();
const myMeta = await a.getSessionInfo(mySession);
if (myMeta.role === 'commander' && args.workspace_id && args.workspace_id !== myMeta.workspaceId) {
  return { ok: false, error: `E_WORKSPACE_FORBIDDEN: commander cannot cross workspaces` };
}
```

同样在 `fork_session` handler 行 532 的 `new_workspace_id` 覆盖路径加拦截。

### 🟢 P2 长期（平台层 + SKILL 修订）

平台层（main.cjs）：
- `createAgentSession` (L386651) 加白名单校验：`workspaceId` 必须能在 `getAgentWorkspace(id)` 找到，否则抛 `E_WORKSPACE_NOT_FOUND`
- 这是根本性修复，但需要 sed 补丁（修改商业版 main.cjs）

SKILL 修订：
- `session-management` SKILL 模式 4 改写：明确 commander 不应跨工作区，跨工作区属于 admin 操作（需用户手动）
- `tree-commander` SKILL §4 加 workspace 锁定章节：`commander 全程在 root 指定的 workspace 内操作`

---

## 六、关键文件位置

### 调查涉及
- **SKILL**:
  - `proma/skills/session-management/SKILL.md`（模式 4，行 71-78，教授跨工作区）
  - `proma/workspace-files/release/tree-system-v0.2.1/skills/tree-commander/SKILL.md`（§4 工作流不带 workspace_id，符合设计）
- **代码**:
  - `D:\Proma-dev\resources\app\dist\main.cjs:386651`（`createAgentSession` 无 workspace 校验）
  - `D:\Proma-dev\resources\app\dist\main.cjs:385794`（`createAgentWorkspace` 仅按 name 去重，不防滥用）
  - `D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs:446`（MCP `create_session` handler 原样透传 workspace_id）
  - `D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs:765-771, 1098-1106`（V10 slug "undefined" fallback）

### 涉及会话（跨工作区操作的实际执行者）
- **tree-2 创建者**: `7c9b6b65-910b-43ba-89e5-ab5a5fe747d2`（V10 P2 测试根）
- **tree-2 审计链**: `7c9b6b65` → `15109031-2c5d-42d6-b200-2fb2c16b5374` → `52551d11-b9a1-47aa-8644-c696f04999c6`
- **undefined 孤儿**: `audit-gate-test-20260625` tree（09:07 测试，触发 V10 失守案例）

### 各工作区现状
- `proma/workspace-files/.context/audit/` 不存在（建议创建，归档 tree-2 产出）
- `tree-2/workspace-files/.context/v10-p2-e2e-report.md`（8185 字节，关键报告）
- `tree-2/workspace-files/.context/trees/v10p2-e2e/tree-state.json`（30 writes，5 leaf）

---

## 七、附：TAO Watcher 干扰指挥官的问题（关联）

a8111bf5 主线指挥官会话意外终止的根因——**TAO Watcher 把 worker 规则（W-01 brief_echo）发给根指挥官**，导致指挥官思维混乱。这是另一个设计外问题：

### 现象
- 4 个 Bug Auditor 子会话（abf92aed / 76e5d898 / 1795cea8 / 1cdd1ecf）都被 TAO Watcher 发了 `W-01 (high) worker 缺 brief_echo` + `C-13 (mid) commander 缺 worker` nudge
- a8111bf5 根指挥官收到 W-01 后被强制要求用 brief_echo YAML 块回复，但根指挥官本身不是 worker，应该豁免

### 根因
TAO Watcher 没有按 role 区分规则——对所有 leaf 用同样的检查项。

### 修复方案（独立立项）
- TAO Watcher 按叶子 role 应用不同规则集
- root/commander/worker 各有专属规则
- worker 规则（W-01 brief_echo, W-08 leaf purity）只发给 worker
- commander 规则（C-13 缺 worker）只发给有下属的 commander
- root 规则（无 supervisor，豁免 W-01）

---

## 八、下一步建议

| 优先级 | 任务 | 工作量 |
|--------|------|--------|
| P0 | 归档 tree-2 关键产出 → 清理 tree-1/undefined/workspace-* | 30 分钟 |
| P0 | 排查 TAO Watcher 干扰指挥官问题（影响所有指挥官会话稳定性） | 1-2 小时 |
| P1 | patches.cjs 加 workspace_id 校验拦截 | 1 小时 |
| P1 | TAO Watcher 加 role 区分 | 2-3 小时 |
| P2 | main.cjs createAgentSession 加白名单（sed 补丁） | 2 小时 |
| P2 | session-management SKILL 模式 4 修订 | 30 分钟 |
| P3 | 沉淀"commander 跨工作区问题"为可复用教训到 commander-methodology-v10.md | 30 分钟 |

---

## 九、关联文档

- [V10 Phase 3 收尾交接](./handoff/session-2026-06-25-v10-followup.md)
- [commander-methodology-v10.md](./commander-methodology-v10.md)（v10 工程方法论）
- [v10/bug-a-investigation.md](./v10/bug-a-investigation.md)（Bug A 调查）
- [v10/bug-b-investigation.md](./v10/bug-b-investigation.md)（Bug B 调查）
