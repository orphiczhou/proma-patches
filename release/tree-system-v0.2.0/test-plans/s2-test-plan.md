# S2 v0.2 验收测试方案

> **测试目标**：端到端验证 v0.2 新增三项能力（心跳通道 + 内部自审 + 三档纠偏）
> **设计依据**：`tree-commander-design.md §10.7`
> **测试形态**：混合（tree-state.js 命令序列 + 真实 Agent/Fork 交互）
> **预期通过标准**：3 个场景全部通过，drift_log / heartbeat_log 记录完整，纠偏链递进正确
> **预估耗时**：30-60 分钟（含 Proma automation 等待）

---

## 0. 元信息

### 0.1 v0.2 变更范围

| # | 能力 | v0.1 | v0.2 |
|---|---|---|---|
| 1 | 心跳通道 | ❌ | ✅ Proma automation + 哨兵 Agent |
| 2 | 内部自审 | ⚠️ 可选 | ✅ 必须（每 Mi 后 Fork code-reviewer） |
| 3 | 三档纠偏 | ❌ 设计有/无实现 | ✅ nudge/limit/prune 完整链路 |
| 4 | Windows rename 重试 | ❌ 单次 | ✅ 5 次重试 + 指数退避 |

### 0.2 已知前置条件

- tree-state.js 已含 S3 rename 重试修复（v0.1.1-S3）
- tree-state.js LEAF_NAME_RE 已锁定为 `[a-z][a-z0-9_]{3,7}`（v0.1.1-C）
- tree-commander SKILL.md v2.0 已创建（含心跳 automation 模板 + 哨兵/验收 Agent prompt）
- tree-worker SKILL.md v2.0 已创建（含内部自审流程 + drift_declaration 规范）
- S1 回归测试已通过（write_count=10 触发自动备份 ✅，validate ✅，负例拒绝 ✅）

---

## 1. S2a：心跳唤起（哨兵检测 + status_check 发送）

### 场景
有 2 个 active 叶子，其中 B 超过 5 分钟无活动。心跳 automation 触发后哨兵 Agent 判定 B 为"停滞"，发送 status_check。

### 前提
- tree 已 init（pguide）
- A leaf 有最近活动（< 5 分钟）
- B leaf 无活动 > 5 分钟

### 验证步骤

**步骤 1：准备环境**
```bash
cd "<workspace>/.context/trees"
rm -rf pguide2
node tree-state.js init pguide2 --root-brief '{"parent_intent":"v0.2 S2a test"}' --root-dod '{"deliverables":[]}'
node tree-state.js leaf add pguide2 --json '{"leaf_id":"pguide2-A-x","session_id":"mock-active","parent":null,"path":"A","role":"x","model":"claude-sonnet-4-6","channel":"anthropic"}'
node tree-state.js leaf add pguide2 --json '{"leaf_id":"pguide2-B-y","session_id":"mock-stale","parent":null,"path":"B","role":"y","model":"claude-sonnet-4-6","channel":"anthropic"}'
# 给 A 设最近活动
node tree-state.js leaf set-last-event pguide2 pguide2-A-x plan --ts "$(node -e 'console.log(new Date().toISOString())')"
# B 不设活动，模拟静默 > 5 分钟
```

**步骤 2：模拟心跳巡检**
```bash
node tree-state.js leaf list-active pguide2
# 预期：返回 2 个 active 叶子 [pguide2-A-x, pguide2-B-y]
```

**步骤 3：模拟哨兵 Agent 判定（手动模拟）**
```bash
# 对 B 发送 status_check（模拟哨兵动作）
node tree-state.js leaf set-last-event pguide2 pguide2-B-y status_check
# 记录一次心跳
node tree-state.js heartbeat append pguide2 --json '{
  "verdicts": [
    {"leaf_id":"pguide2-A-x","verdict":"active","action":"none"},
    {"leaf_id":"pguide2-B-y","verdict":"stale","action":"status_check"}
  ],
  "ts": "'"$(node -e 'console.log(new Date().toISOString())')"'",
  "next_heartbeat": "'"$(node -e 'console.log(new Date(Date.now()+900000).toISOString())')"'"
}'
```

**步骤 4：验证 heartbeat_log**
```bash
node tree-state.js heartbeat tail pguide2 -n 5
# 预期：返回 1 条心跳记录，verdicts 含 2 项，B 的 action="status_check"
node tree-state.js leaf get pguide2 pguide2-B-y
# 预期：last_event_type="status_check"
```

### 通过标准
- [ ] `heartbeat append` 成功后 heartbeat_log 有记录
- [ ] `leaf list-active` 正确列出 active 叶子
- [ ] `stale` 叶子 `last_event_type` 变更为 `status_check`
- [ ] 清理 pguide2 目录

---

## 2. S2b：内部自审触发（里程碑后自查 + 纠偏记录）

### 场景
叶子 A 在完成 M1 后，产出意图偏差（如产出缺预期图表）。自 Fork 的 code-reviewer 检测到偏差 severity=low，A 自纠后重审通过。

### 前提
- tree 已 init（pguide2）
- A leaf 有 1 个 milestone

### 验证步骤

**步骤 1：准备环境**
```bash
node tree-state.js milestone add pguide2 pguide2-A-x --json '{"id":"M1","desc":"产出含 3 项分析","expect_outputs":["report.md"]}'
node tree-state.js milestone set-result pguide2 pguide2-A-x M1 --audit-pass true --note-path "report.note.md"
```

**步骤 2：模拟自审发现低严重度偏差**
```bash
# 追加 drift_history：自纠成功
node tree-state.js drift append pguide2 pguide2-A-x --kind production --severity low --action self_correct --reason "产出缺第 3 项分析，已补全后重审通过"
```

**步骤 3：验证 drift_history**
```bash
node tree-state.js drift list pguide2 --leaf pguide2-A-x
# 预期：1 条记录，severity=low，action=self_correct
node tree-state.js leaf get pguide2 pguide2-A-x
# 预期：drift_history 含 self_correct 记录
```

**步骤 4：模拟自审发现中严重度偏差（自纠 2 次仍 mid）**
```bash
# 追加 drift_history：宣告偏差
node tree-state.js drift append pguide2 pguide2-A-x --kind production --severity mid --action declare --reason "2 次自纠后产出仍缺关键 API 列表"
```

**步骤 5：验证 drift 双写**
```bash
node tree-state.js drift list pguide2
# 预期：drift_log 中也有对应记录（双写）
node tree-state.js leaf get pguide2 pguide2-A-x
# 预期：drift_history 含 2 条（self_correct + declare）
```

### 通过标准
- [ ] `drift append` 双写生效（leaf.drift_history + 顶层 drift_log）
- [ ] `action=self_correct` 和 `action=declare` 区分正确
- [ ] severity 枚举 low/mid/high 校验正确

---

## 3. S2c：三档纠偏执行（轻档 nudge → 中档 limit 升级）

### 场景
叶子 B 的产出有 mid 级方向偏差，且近 30 分钟内已收过 nudge。按决策树应升级到中档限权。

### 前提
- tree 已 init
- B leaf 已有 1 条 nudge 记录（近 30 分钟）

### 验证步骤

**步骤 1：先给 B 追加一条 nudge 记录**
```bash
node tree-state.js drift append pguide2 pguide2-B-y --kind direction --severity low --action nudge --reason "技术选型偏离项目栈，注意用 REST 非 GraphQL"
```

**步骤 2：模拟 30 分钟后再次检测到方向偏差 mid**
```bash
# 中档限权
node tree-state.js leaf autonomy-override pguide2 pguide2-B-y --json '{
  "added_must_ask": ["技术选型变更"],
  "removed_can_decide": ["API 设计"],
  "reason": "中档纠偏：30 分钟内再次发现方向偏差",
  "ts": "'"$(node -e 'console.log(new Date().toISOString())')"'"
}'
node tree-state.js drift append pguide2 pguide2-B-y --kind direction --severity mid --action limit --reason "中档限权：近 30 分钟已 nudge 过仍偏"
```

**步骤 3：验证递进状态**
```bash
node tree-state.js leaf get pguide2 pguide2-B-y
# 预期：
# - drift_history 含 2 条（nudge + limit）
# - autonomy_overrides 已设置（added_must_ask + removed_can_decide）
node tree-state.js drift list pguide2 --leaf pguide2-B-y
# 预期：2 条记录，severity low→mid，action nudge→limit
```

**步骤 4：模拟重档剪枝（mid 后再偏 → high）**
```bash
# 标记旧 leaf 为 pruned
node tree-state.js leaf set-status pguide2 pguide2-B-y pruned
# 创建新 leaf（i2 后缀）
node tree-state.js leaf add pguide2 --json '{"leaf_id":"pguide2-B-y-i2","session_id":"mock-new","parent":null,"path":"B","role":"y","model":"claude-opus-4-7","channel":"anthropic"}'
# 记录剪枝
node tree-state.js drift append pguide2 pguide2-B-y --kind direction --severity high --action prune --fork-to pguide2-B-y-i2 --reason "中档限权后再偏，升级到重档剪枝"
```

**步骤 5：验证剪枝完整性**
```bash
node tree-state.js leaf get pguide2 pguide2-B-y
# 预期：status="pruned"
node tree-state.js leaf get pguide2 pguide2-B-y-i2
# 预期：status="active", leaf_id 含 i2 后缀
node tree-state.js drift list pguide2
# 预期：drift_log 含所有 3 条纠偏记录（nudge + limit + prune）
```

### 通过标准
- [ ] 三档递进链完整：nudge → limit → prune
- [ ] `autonomy_overrides` 正确设置（中档限权）
- [ ] 剪枝后旧 leaf status=pruned，新 leaf status=active 且含 i2 后缀
- [ ] drift_log 三条记录 severity 递进 low→mid→high
- [ ] 最终 validate 通过
- [ ] 清理 pguide2 目录

---

## 4. 额外验证：S3 rename 重试（v0.1.1-S3）

### 验证方法
S3 是防御性修复（Windows rename 在并发占用下的重试），常规单线程测试不会触发 EPERM。验证方式：
1. **代码审查**：检查 `writeState` 函数 rename 段是否为 5 次重试循环 + 指数退避
2. **语法/基本功能**：跑 S1 回归（已通过）
3. **压力测试**（可选，v0.3 做）：并发 10 进程同时写同一 tree-state.json，确认无 E_IO

---

## 5. 测试通过标准

### v0.2 发布门（全部通过才宣布 v0.2 可用）

| # | 检查项 | 验证方式 |
|---|---|---|
| 1 | S1 回归通过 | 跑 S1 全 25 步（已通过） |
| 2 | S2a 心跳记录 | heartbeat_log 写入 + status_check 触发 |
| 3 | S2b 内部自审 | drift_history self_correct/declare 记录 |
| 4 | S2c 三档递进 | nudge→limit→prune 链完整 |
| 5 | S3 rename 重试 | 代码审查 + 基本功能测试 |
| 6 | validate 通过 | `node tree-state.js validate <tree_id>` 返回 issues=[] |
| 7 | 自动备份触发 | write_count=10/20/30 时备份文件生成 |

### 已知限制
- **心跳 automation 真触发**：需在 Proma 中创建 automation 并等 15 分钟。S2a 当前用 `heartbeat append` 命令模拟
- **哨兵 Agent 真调用**：需真实 agent session。S2a 当前用手动 `leaf set-last-event` 模拟
- **fork_session 真剪枝**：需真实 fork + archive。S2c 当前用 `leaf set-status pruned` + `leaf add` 模拟

v0.3 应将模拟步骤升级为端到端真实交互。

---

## 6. 清理步骤

```bash
cd "<workspace>/.context/trees"
rm -rf pguide2
ls pguide2 2>/dev/null && echo "FAIL" || echo "CLEANED"
```

---

## 修订历史

| 日期 | 版本 | 主要变更 |
|---|---|---|
| 2026-06-18 | v1.0 | 初版。基于设计文档 §10.7 草稿扩展，覆盖 S2a/S2b/S2c + S3 验证 |
