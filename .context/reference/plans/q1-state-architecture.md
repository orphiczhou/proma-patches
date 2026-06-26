# Q1: 树形会话执行体系 — 状态更新架构与叶子创建机制

> 版本: v1.1 | 日期: 2026-06-19 | 类型: 开发方案 | 状态: ⚠️ 待确认
> v1.1 修订: 子 Commander 有权 leaf add + 三层 Commander 深度限制（根→子→孙）

---

## 一、问题背景

当前 v0.1 实现存在三个架构缺陷：

1. **叶子任务不是干净上下文**：B 验证中所有子会话用 `fork_session` 创建，带着父会话全部历史，上下文污染、token 浪费
2. **状态更新权责不清**：tree-state.json 任何人都能写，但没有明确的"谁该更新什么"的边界定义
3. **role 字段是自由文本**：没有正式区分"能继续拆解的子 Commander"和"原子执行的叶子 Worker"

用户核心诉求：
- 叶子任务是**全新会话**（create_session），只注入 brief/dod 作为首条消息，不继承任何历史
- 枝杈 Commander 可以自己管理下属子树的状态
- 树形结构要有清晰的层级语义

---

## 二、目标架构

```
深度 0: 🎯 根 Commander（root）
│   权限：leaf add(commander/worker) / set-status / drift / init
│   创建方式：用户手动启动的会话
│
├─ 深度 1: 🔀 子 Commander A（commander, fork 自根）
│   │   权限：leaf add(commander/worker) / 管理自己+下属
│   │   创建方式：fork_session(根) + 继承战略上下文
│   │   │
│   │   ├─ 🍃 叶子 A1（worker, create_session）
│   │   │   权限：只上报 done/blocked
│   │   │
│   │   └─ 深度 2: 🔀 孙 Commander A2（commander, fork 自A）
│   │       权限：leaf add(只能worker) / 管理自己+下属
│   │       │
│   │       └─ 🍃 叶子 A2a（worker, create_session）
│   │
│   └─ 深度 1: 🔀 子 Commander B（commander, fork 自根）
       │   权限：同子 Commander A
       │
       └─ 🍃 叶子 B1（worker, create_session）
```

### 会话创建策略

| 节点类型 | 创建方式 | 上下文 | 首条消息 |
|---------|---------|--------|---------|
| 子 Commander | `fork_session` | 继承父 Commander 的战略上下文 | fork 时自带历史 + 追加 brief/dod |
| 叶子 Worker | `create_session` | **完全干净** | brief/dod 作为首条 user message |
| 重试（同节点） | `create_session` 新会话 + archive 旧会话 | 干净 | 同上 + 上次失败的教训 |

### 为什么叶子必须用 create_session？

- **上下文隔离**：叶子只需要知道自己的任务（brief/dod），不需要知道指挥官聊了什么
- **token 节省**：不用为无关历史付费
- **可并行**：多个叶子互不干扰，各自独立执行
- **可重试**：失败后新建一个干净会话重跑，不会带着失败的残留状态

---

## 三、状态更新权限模型

### 三层权限（v1.1 修订）

```
┌──────────────────────────────────────────────────────┐
│  操作              │ 根  │ 子Cmd │ 孙Cmd │ 叶子 │ 锁  │
├──────────────────────────────────────────────────────┤
│ init (创建 tree)   │ ✅  │  ❌   │  ❌   │ ❌   │ Yes │
│ leaf add (commander)│ ✅ │  ✅   │  ❌   │ ❌   │ Yes │
│ leaf add (worker)  │ ✅  │  ✅   │  ✅   │ ❌   │ Yes │
│ leaf set-status    │ ✅  │  ✅   │  ✅   │ ❌   │ Yes │
│ milestone add      │ ✅  │  ✅   │  ✅   │ ❌   │ Yes │
│ milestone set-result│ ✅ │  ✅   │  ✅   │ ❌   │ Yes │
│ event append       │ ✅  │  ✅   │  ✅   │ ❌   │ Yes │
│ leaf set-context   │ ✅  │  ✅   │  ✅   │ ❌   │ Yes │
│ drift append       │ ✅  │  ✅   │  ✅   │ ❌   │ Yes │
│ backup / validate  │ ✅  │  ✅   │  ✅   │ ✅   │ No  │
│ tree dump / leaf get│ ✅ │  ✅   │  ✅   │ ✅   │ No  │
└──────────────────────────────────────────────────────┘
```

### 原则（v1.1 修订）

1. **子 Commander 有权 `leaf add`**——添加 `parent=<self.leaf_id>` 的子节点，不依赖根
2. **深度限制**——最多 3 层 Commander（根/子/孙），第 3 层只能加 worker
3. **叶子只读 + 上报**——叶子通过 `send_message` 把 done/blocked 上报给父 Commander，由父 Commander 写 tree-state
4. **读操作无限制**——任何节点都能读 tree-state（用于自检对齐）
5. **文件锁保证并发安全**——多节点同时写入时排队

### 三层 Commander 深度限制

整个树最多 **3 层 Commander**（根→子→孙），第 4 层起只能是叶子 Worker：

```
第1层（深度 0）: root      → 可加 role=commander 或 role=worker
第2层（深度 1）: commander → 可加 role=commander 或 role=worker
第3层（深度 2）: commander → 只能加 role=worker，不能再拆 Commander
第4层+       : 不允许存在 commander
```

深度计算：沿 parent 链向上追溯，统计 role 为 `root` 或 `commander` 的节点数（不含自身），即为当前深度。

### 子 Commander 的自主权

子 Commander 收到父 Commander 派发的 brief/dod 后，**完全自主管理自己的子树**：

1. 自己拆解 milestones → 调 `milestone add` 写入自己的 leaf
2. 执行每个 milestone → 调 `milestone set-result` 记录结果
3. 需要拆分任务时 → **直接调 `leaf add`**，添加 `parent=<self.leaf_id>` 的子节点：
   - `role=commander`：fork_session 创建，继承战略上下文，可继续拆解（受深度限制）
   - `role=worker`：create_session 创建，干净上下文，原子执行
4. 完成后调 `leaf set-status <self> done`（E_CHILDREN_NOT_DONE 自动校验子节点）

**关键原则：tree-state 和 session 管理统一在 Commander 手中。** 子 Commander 既创建 session 又更新 tree，不再"开 session 的是一只手，写 tree 的是另一只手"。

---

## 四、role 字段正式化

当前 role 是自由文本 `\w+`。需要正式化为枚举：

| role | 语义 | 创建方式 | 权限 |
|------|------|---------|------|
| `root` | 根指挥官，唯一能结构性变更 tree | 用户手动创建 | 全部 |
| `commander` | 子指挥官，可以拆解任务、派叶子 | fork_session | 写自己+下属的状态 |
| `worker` | 叶子执行节点，原子任务 | create_session | 只读 + 上报 |

### leaf_id 命名规范更新

```
<prefix>-<path>-<role>[-<suffix>]

示例:
  nanju-root           — 根 Commander
  nanju-A-commander    — 枝杈 A，子 Commander
  nanju-A1-worker      — 叶子 A1，Worker
  nanju-A1-worker-s1   — 叶子 A1 的第一次重试
```

### tree-state.js 变更

在 `cmdLeafAdd` 中增加 role 枚举校验：

```javascript
const ROLE_ENUM = ['root', 'commander', 'worker'];
// 在 assertEnum 中加入 role 校验
```

---

## 五、tree-state.js 代码变更清单

### 5.1 role 枚举校验（新增）

- 位置：`cmdLeafAdd` 函数，约第 478 行
- 变更：添加 `assertEnum(role, ROLE_ENUM, 'role')`
- 影响：现有 bverify 等树的旧数据需要迁移（role 为 announce/techdetail 等 → 改为 worker）

### 5.2 leaf add 权限标记（新增）

- 新增 `added_by` 字段记录是哪个会话创建的 leaf
- 用途：审计追踪，知道每个 leaf 是谁加的
- 字段：`added_by: string (session_id)`

### 5.3 leaf add 深度限制

- 新增 `calcCommanderDepth(tree_id, leaf_id)` 函数：沿 parent 链向上追溯，统计 role 为 root/commander 的节点数
- 在 `cmdLeafAdd` 中，当 role=commander 时，检查 parent 的深度：
  - depth 0（父是 root）→ 允许（创建第 2 层 commander）
  - depth 1（父是 commander）→ 允许（创建第 3 层 commander）
  - depth ≥ 2 → 拒绝，抛出 `E_DEPTH_EXCEEDED`
- 当 role=worker 时无深度限制（任何 commander 都能加叶子）

### 5.4 leaf set-status 增加约束

- commander 角色 set-status done 前检查所有子 leaf 是否 done
- 新增错误码 `E_CHILDREN_NOT_DONE`

### 5.5 数据迁移脚本

- 新建 `tree-state.js migrate <tree_id>` 子命令
- 将旧 role（announce/techdetail/integrate/review 等）自动映射为 worker
- 将 parent=null 的非根叶子 → role=worker

---

## 六、方法论变更（commander-methodology.md）

### 新增原则：叶子纯净原则（Leaf Purity）

```
叶子任务 = create_session + 首条消息注入 brief/dod
绝不 fork 叶子。fork 只用于创建子 Commander。
```

### 新增原则：分布式状态写入

```
- 根 Commander：结构性变更（leaf add/set-status）
- 子 Commander：自己 + 下属叶子的 milestones/events
- 叶子 Worker：只上报，不直接写 tree-state
```

### 更新的 7 段式 prompt 模板

给叶子 Worker 下发的 prompt 必须包含：
1. 任务简报（从 brief 提取）
2. DoD（从 dod 提取）
3. 产出路径（绝对路径）
4. 铁律（模型/频道限制）
5. 上报格式（done/blocked 的 YAML 结构）
6. 禁止行为
7. 完成信号

---

## 七、验证方案

### 7.1 S1 模拟验证（tree-state.js 命令序列）

```bash
# 创建 tree
node tree-state.js init testrole --root-brief '{...}' --root-dod '{...}'

# 根 Commander（root role）
node tree-state.js leaf add testrole --json '{"leaf_id":"testrole-root","session_id":"uuid1","parent":null,"path":"","role":"root","model":"deepseek-v4-pro","channel":"56ecefd2"}'

# 子 Commander（commander role）— 应成功
node tree-state.js leaf add testrole --json '{"leaf_id":"testrole-A-commander","session_id":"uuid2","parent":"testrole-root","path":"A","role":"commander","model":"deepseek-v4-flash","channel":"56ecefd2"}'

# 叶子 Worker（worker role）— 应成功
node tree-state.js leaf add testrole --json '{"leaf_id":"testrole-A1-worker","session_id":"uuid3","parent":"testrole-A-commander","path":"A1","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2"}'

# 非法 role — 应拒绝
node tree-state.js leaf add testrole --json '{..."role":"announce"...}'  # E_SCHEMA_INVALID

# === 深度限制测试 ===

# 深度 1: 子 Commander 可以加孙 Commander（深度 2）— 应成功
node tree-state.js leaf add testrole --json '{"leaf_id":"testrole-A2-commander","session_id":"s5","parent":"testrole-A-commander","path":"A2","role":"commander","model":"deepseek-v4-flash","channel":"56ecefd2","added_by":"s2"}'

# 深度 2: 孙 Commander 再加曾孙 Commander — 应拒绝（E_DEPTH_EXCEEDED）
node tree-state.js leaf add testrole --json '{"leaf_id":"testrole-A2a-commander","session_id":"s6","parent":"testrole-A2-commander","path":"A2a","role":"commander","model":"deepseek-v4-flash","channel":"56ecefd2","added_by":"s5"}'

# 深度 2: 孙 Commander 加叶子 Worker — 应成功
node tree-state.js leaf add testrole --json '{"leaf_id":"testrole-A2a-worker","session_id":"s7","parent":"testrole-A2-commander","path":"A2a","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2","added_by":"s5"}'

# 子 Commander 独立更新自己的 milestone — 应成功
node tree-state.js milestone add testrole testrole-A-commander --json '{"id":"M1","desc":"拆解任务","expect_outputs":["plan.md"]}'
node tree-state.js milestone set-result testrole testrole-A-commander M1 --audit-pass true

# 子 Commander 设自己的 status 为 done（孙 Commander 未 done）— 应拒绝 E_CHILDREN_NOT_DONE
node tree-state.js leaf set-status testrole testrole-A-commander done

# validate — 应 ok
node tree-state.js validate testrole
```

### 7.2 真实环境端到端验证

用 L2-real 同款流程，但严格遵循新架构：
- 根 Commander（当前会话，V4 Pro）
- 子 Commander（fork_session，V4 Flash）
- 叶子 Worker（create_session，V4 Flash，干净上下文 + brief/dod）
- 验证：叶子是否只知道自己任务、tree-state 是否由子 Commander 独立更新
- 验证：E_CHILDREN_NOT_DONE 错误码触发（子 Commander 有未完成子节点时不能 done）

---

## 八、不与 v0.1 冲突

本方案是 v0.1 的**语义补丁**，不破坏现有功能：
- `parent` 字段已存在，只是没被充分利用
- `role` 从自由文本改为枚举，需迁移旧数据但不影响逻辑
- 文件锁机制不变
- 21 个子命令不变
- 新增的权限校验是添加性的，不影响已有调用

---

## 九、实施步骤

| 步骤 | 内容 | 预估工作量 | 状态 |
|------|------|-----------|------|
| 1 | tree-state.js: role 枚举校验 + added_by 字段 | 小 | ✅ |
| 2 | tree-state.js: E_CHILDREN_NOT_DONE + E_DEPTH_EXCEEDED 校验 | 小 | ⚠️ 需加深度检查 |
| 3 | tree-state.js: leaf add 深度限制（calcCommanderDepth） | 小 | 🆕 新增 |
| 4 | tree-state.js: migrate 子命令 | 中 | ✅ |
| 5 | 方法论文档更新：Leaf Purity + 分布式写入 + 三层深度 | 中 | ⚠️ 需修订 |
| 6 | S1 模拟验证（含深度限制用例） | 小 | ⚠️ 需补测 |
| 7 | 真实环境端到端验证 | 大 | 待做 |
| 8 | 迁移 bverify 等旧 tree 数据 | 小 | ✅ |
