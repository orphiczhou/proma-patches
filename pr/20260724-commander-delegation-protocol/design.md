# P0-1: Commander 委派协议（解决星形退化）

> 日期：2026-07-24 | 接力第三棒 | 上一棒交接：handoff-20260724-second-leg.md

## 1. 问题根因

macp 实战（tests/002）暴露：root 建了 3 个 commander session（leaf_add role=commander）但**从未给 commander 发 brief**，转而直接 `send_message` 连 6 个 worker（leaf_add role=worker, parent=root）。

**后果**：树形退化为扁平星形——commander leaf 沦为"孤儿占位"，多级协调、上下文隔离、并行收敛等树形体系的核心优势全部落空。tree_dump 看 3 个 commander status=active 但 events 永远为空，6 个 worker 全挂在 root 下。

**根因分析（双因）**：
1. **协议未教清**：tree-commander SKILL §4 Step2「下发子会话」对所有 leaf_add 一视同仁，没区分"root 给 commander 下发"vs"commander 给 worker 下发"。root 误以为"建了 commander leaf = 委派完成"，实则 commander 从未收到 5 件套 brief，无法自主履职。
2. **引擎无信号**：cmdLeafAdd 接受任意 parent+role 组合（只要 parent 存在且非 worker/auditor），root 直接 leaf_add worker（parent=root）完全合法，引擎沉默放行，root 拿不到"你正在绕过 commander"的反馈。

## 2. 改动点

### 2.1 文档（必做）：skills/tree-commander/SKILL.md

**(a) §4 Step2 新增 §4.1 层级委派协议**（插在 Step2 现有内容之后、Step3 之前）：

核心规则三分：
- **root → commander**：root 用 `create_session`/`fork_session` 建 commander 会话 → `leaf_add(role=commander, parent=root)` → **首条 send_message 必须是 §3 五件套 brief**（让 commander 拿到任务书）→ commander 自主履职。
- **commander → worker**：commander 自己建 worker 会话 → 自己 `leaf_add(role=worker, parent=<commander_leaf_id>)` → 自己发五件套 brief。**root 不越级**。
- **例外**：单层树（无 commander，root 直辖 worker）允许 root 直接 leaf_add worker。引擎通过"树中是否存在 active commander"自动判定。

**反模式**（新增禁止行为 §11 第 14 条）：root 在已有 active commander 的情况下，仍直接 `leaf_add(role=worker, parent=root)` → 星形退化。引擎会返回 `W_STAR_DEGRADATION` warning（不拦死，但提示）。

**(b) §11 禁止行为清单加第 14 条**：
| 14 | root 在已有 active commander 时直接 leaf_add worker | commander 沦为孤儿，树退化为星形 | 把 worker 挂到 commander 下（parent=<commander_leaf_id>），由 commander 下发 |

**(c) §15 修订历史加 v2.7 条目**。

### 2.2 引擎（推荐）：tree-engine.cjs cmdLeafAdd 加软约束

**位置**：cmdLeafAdd 内，`state.leaves[leaf_id] = leaf; writeState(...)` 之前（L1224 附近），result 组装时。

**触发条件**（三与）：
```js
const parentLeaf = parent !== null ? state.leaves[parent] : null;
const isParentRoot = parentLeaf && parentLeaf.role === 'root';
const hasActiveCommander = Object.values(state.leaves).some(
  (l) => l.role === 'commander'
    && l.status !== 'archived'
    && l.status !== 'pruned'
    && l.leaf_id !== leaf_id  // 排除自己（当前若 add 的是 commander 不触发）
);
if (isParentRoot && role === 'worker' && hasActiveCommander) {
  // 触发 warning
}
```

**warning 载体**（双写）：
1. `result.warnings = [{ code: 'W_STAR_DEGRADATION', message, suggestion, active_commanders: [...] }]` — 即时返回给调用方。
2. `leaf.delegation_hint = 'star_degradation_warned'` — 持久化到 leaf 对象，`tree_leaf_get` / `tree_dump` 可见，便于事后审计追溯。

**为什么不 throw（拦死）**：
- 单层树场景（root 直辖少量 worker，无 commander）是合法的，拦死会误伤。
- 软约束保留 root 的应急越权能力（如 commander 全部宕机时 root 直接接管），只在事后可追溯。
- 引擎硬约束应保留给"确定性错误"（naming/identity/depth）；"协议建议"属于判断性范畴，软约束 + 文档教化更合适。

**向后兼容**：
- 旧 leaf 无 `delegation_hint` 字段 → `tree_leaf_get` 正常（字段缺失即未警告）。
- result.warnings 缺失时调用方按原逻辑（无 warning）处理，零回归。

### 2.3 部署

- `tree-engine.cjs` → `D:/Proma-dev/resources/app/dist/tree-engine.cjs`（cp 整文件 + node --check）
- `SKILL.md` → 工作区 skills 目录（不需部署到 dist，Skill 加载即生效）
- restart dev/pro（restart-{dev,pro}.ps1，ISOLATED=1）

## 3. 测试计划

### 3.1 引擎单测（node -e 内联）

**用例 A（星形退化触发 warning）**：
1. tree_init(prefix=t1)
2. leaf_add commander（parent=root）→ 无 warning
3. leaf_add worker（parent=root）→ **result.warnings 含 W_STAR_DEGRADATION**，leaf.delegation_hint='star_degradation_warned'

**用例 B（正常层级无 warning）**：
1. tree_init(prefix=t2)
2. leaf_add commander（parent=root）→ 无 warning
3. leaf_add worker（parent=commander）→ **无 warning**（parent 非 root）

**用例 C（单层树无 commander 无 warning）**：
1. tree_init(prefix=t3)
2. leaf_add worker（parent=root）→ **无 warning**（无 commander，root 直辖合法）

**用例 D（commander 全 archived 后 worker 无 warning）**：
1. tree_init(prefix=t4)
2. leaf_add commander → set-status archived
3. leaf_add worker（parent=root）→ **无 warning**（active commander 为空）

### 3.2 回归测试

- 现有 tree 操作（leaf_add commander / 正常 worker / milestone / event）零回归。
- `tree_validate` 通过。
- node --check tree-engine.cjs 通过。

### 3.3 功能实测（pro/dev 实例）

restart 后，在 pro 实例建测试树，复现用例 A，确认 warning 在 tree_dump / leaf_get 中可见。

## 4. 验收标准

- [ ] 用例 A-D 全部符合预期（warning 触发/不触发条件正确）
- [ ] SKILL.md §4.1 / §11#14 / §15 v2.7 已更新
- [ ] node --check 通过
- [ ] dev/pro 重启后功能正常
- [ ] 独立审计子会话 verdict=pass
