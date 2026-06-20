# Q1 v2 全深度 3 层树形验证方案

> 版本: v2 | 日期: 2026-06-20 | 修订: 2026-06-20 (审计修复) | 制定: Proma Agent | 基于: v1.1 方案改写
> 对标: release/tree-system-v0.2.1/ 发布包
> 方法论: commander-methodology v1.2 (13 条原则)
> 目标: 完整验证 tree-state.js v0.2.1 全部能力，覆盖 3 层指挥官深度、role 枚举、错误路径、分布式写入

---

## 一、验证目标

证明 tree-state.js v0.2.1 + commander-methodology v1.2 + SKILL v2.2 在真实 Proma 环境下**完整体现 3 层树形指挥能力**，包括：

1. **role 三层枚举** (root / commander / worker) 全部创建并行使各自权限
2. **三层深度限制** — depth 0/1/2 加 commander 合法，depth>=3 触发 E_DEPTH_EXCEEDED
3. **分布式写入** — 根/commander/worker 各自写入正确
4. **E_CHILDREN_NOT_DONE** — 子节点未完成时拒绝父节点 done
5. **Worker 禁子节点** — 以 worker 为 parent 加 leaf 触发 E_SCHEMA_INVALID
6. **根唯一性** — 重复 parent=null 触发 E_SCHEMA_INVALID
7. **migrate 子命令** — 旧 role 映射正确
8. **自动备份** — 每 10 次写触发
9. **真实会话链路** — fork/create_session/send_message 端到端

---

## 二、验证树结构

> **命名规范**: leaf_id 必须匹配 LEAF_NAME_RE (tree-state.js L64): prefix 段 4-8 字符小写开头无连字符，path 段为单 token (不含内部连字符，多级路径拼接为如 Ac1、Ac1w1)，role 段为 root/commander/worker。

```
qfv2-root (depth 0, role=root)
|
+-- qfv2-A-commander (depth 1, role=commander, path=A)
|    创建: fork_session from qfv2-root
|    权限: leaf add commander/worker (parent=self)
|    +-- qfv2-Ac1-commander (depth 2, role=commander, path=Ac1)
|    |    创建: fork_session from qfv2-A-commander
|    |    权限: leaf add worker only (NOT commander -> E_DEPTH_EXCEEDED)
|    |    +-- qfv2-Ac1w1-worker (depth 3, role=worker, path=Ac1w1)
|    |    |    创建: create_session from qfv2-Ac1-commander
|    |    |    验证: 禁加子节点 (E_SCHEMA_INVALID)
|    |    +-- qfv2-Ac1w2-worker (depth 3, role=worker, path=Ac1w2)
|    |         创建: create_session from qfv2-Ac1-commander
|    |
|    +-- qfv2-Aw1-worker (depth 2, role=worker, path=Aw1)
|         创建: create_session from qfv2-A-commander
|         验证: 禁加子节点 (E_SCHEMA_INVALID)
|
+-- qfv2-B-worker (depth 1, role=worker, path=B)
|    创建: create_session from qfv2-root
|    验证: 禁加子节点 (E_SCHEMA_INVALID)
|
+-- qfv2-C-commander (depth 1, role=commander, path=C)
     创建: fork_session from qfv2-root, 等 A+B 全部 done 后启动
     权限: leaf add commander/worker
     +-- qfv2-Cc1-commander (depth 2, role=commander, path=Cc1)
          创建: fork_session from qfv2-C-commander
          +-- qfv2-Cc1w1-worker (depth 3, role=worker, path=Cc1w1)
               创建: create_session from qfv2-Cc1-commander
```

**叶子统计**：
- 总 leaf 数: **10** = 1 root + 4 commander + 5 worker
  - root leaf (qfv2-root) 由 leaf add 显式创建 (init 只创建空 leaves:{} 结构，不创建任何 leaf)
  - Commander: 4 (qfv2-A-commander, qfv2-Ac1-commander, qfv2-C-commander, qfv2-Cc1-commander)
  - Worker: 5 (qfv2-Aw1-worker, qfv2-Ac1w1-worker, qfv2-Ac1w2-worker, qfv2-B-worker, qfv2-Cc1w1-worker)
  - Root: 1

**树存储路径**: C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees/qfv2/

---

## 三、逐层测试用例

### Layer 0 - Root Commander (本会话)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| R0a | 初始化 | node tree-state.js init qfv2 --root-brief '{...}' --root-dod '{...}' | 创建树目录及 tree-state.json (leaves 为空 {}) |
| R0b | 显式创建 root leaf | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-root","session_id":"UUID","parent":null,"path":"","role":"root","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | root leaf 创建成功，role=root, parent=null |
| R1 | role 验证 | 检查 root leaf role | role = "root", parent = null |
| R2 | 根唯一性 | 尝试 leaf add 另一个 root (parent=null) | E_SCHEMA_INVALID (重复 parent=null) |
| R3 | root 加 commander | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-A-commander","session_id":"UUID","parent":"qfv2-root","path":"A","role":"commander","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 |
| R4 | root 加 worker | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-B-worker","session_id":"UUID","parent":"qfv2-root","path":"B","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 |
| R5 | root set-status done (不受子节点约束) | 子节点未 done 时 node tree-state.js leaf set-status qfv2 qfv2-root done | **成功** - tree-state.js L782 E_CHILDREN_NOT_DONE 仅检查 role==commander，role=root 不受此约束 |
| R6 | root brief/dod | 检查 root_brief/root_dod 完整性 | 必含 parent_intent/my_mission/why_this_exists/in_scope/out_of_scope |
| R7 | E_CHILDREN_NOT_DONE 仅适用 commander | 对比 root done vs commander done 行为差异 | root 不受约束 (R5=成功)，commander 受约束 (A6=拒绝) |

### Layer 1 - Commander qfv2-A-commander (depth 1, fork 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| A0 | 创建会话 | fork_session from qfv2-root | 返回有效 session_id |
| A1 | brief_echo | 子会话收到任务后回传 brief_echo | tree-state qfv2-A-commander events 含 brief_echo |
| A2 | 规划 milestones | qfv2-A-commander 规划 M1/M2/M3 | milestones 写入 tree-state |
| A3 | qfv2-A-commander 加 commander (到 depth 2) | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-Ac1-commander","session_id":"UUID","parent":"qfv2-A-commander","path":"Ac1","role":"commander","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 (depth 1-2 合法) |
| A4 | qfv2-A-commander 加 worker | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-Aw1-worker","session_id":"UUID","parent":"qfv2-A-commander","path":"Aw1","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 |
| A5 | E_DEPTH_EXCEEDED 深度限制 | 前置条件: qfv2-Ac1-commander 已创建。以 qfv2-Ac1-commander 为 parent 尝试 leaf add commander (role=commander, path=Ac1c2) | E_DEPTH_EXCEEDED (depth 已达上限 3，第 4 层拒绝) |
| A6 | qfv2-A-commander set-status done (子未完成) | 子节点 Ac1/Aw1 未 done 时 node tree-state.js leaf set-status qfv2 qfv2-A-commander done | E_CHILDREN_NOT_DONE |
| A7 | qfv2-A-commander set-status done (子已完成) | 所有子节点 done 后 node tree-state.js leaf set-status qfv2 qfv2-A-commander done | 成功, status=done |
| A8 | qfv2-A-commander 分布式写入 | 检查 qfv2-A-commander 是否只写了 parent=self 的 leaf + events | 不涉及结构性变更 (root 范围外) |

### Layer 1 - Worker qfv2-B-worker (depth 1, create_session 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| B0 | 创建会话 | create_session (非 fork) | 返回干净会话 (无历史上下文) |
| B1 | brief_echo | 收到任务后回传 brief_echo | tree-state qfv2-B-worker events 含 brief_echo |
| B2 | milestones | qfv2-B-worker 规划并完成 M1 | milestones 写入 |
| B3 | Worker 禁加子节点 | 尝试以 qfv2-B-worker 为 parent leaf add worker | E_SCHEMA_INVALID |
| B4 | Worker set-status done | 无子节点约束, node tree-state.js leaf set-status qfv2 qfv2-B-worker done | 成功 (Worker 跳过 E_CHILDREN_NOT_DONE) |
| B5 | Worker 不写 tree-state | 记录 Worker 开始前 _meta.write_count 值 (W_before)，Worker send_message 完成后再次检查 write_count (W_after) | W_after == W_before (差值=0，Worker 未调用 tree-state.js) |

### Layer 2 - Commander qfv2-Ac1-commander (depth 2, fork 从 qfv2-A-commander 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| C10 | 创建会话 | fork_session from qfv2-A-commander | 返回有效 session_id, 继承 A 上下文 |
| C11 | qfv2-Ac1-commander 加 worker | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-Ac1w1-worker","session_id":"UUID","parent":"qfv2-Ac1-commander","path":"Ac1w1","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 (depth 已达上限 3，但加 worker 不受深度限制) |
| C12 | qfv2-Ac1-commander 加另一个 worker | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-Ac1w2-worker","session_id":"UUID","parent":"qfv2-Ac1-commander","path":"Ac1w2","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 |
| C13 | qfv2-Ac1-commander send_message 派活 | send_message(wait=true) to qfv2-Ac1w1-worker | worker 正常回复 |
| C14 | qfv2-Ac1-commander set-status done | 所有子 worker done 后 node tree-state.js leaf set-status qfv2 qfv2-Ac1-commander done | 成功 |
| C15 | qfv2-Ac1-commander 上下文保留 | 用 list_messages 检查 qfv2-Ac1-commander 消息数 >= 2 (含 user+assistant) | 消息数 >= 2，brief_echo 事件已记录 |

### Layer 2 - Worker qfv2-Aw1-worker (depth 2, create_session 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| W10 | 创建会话 | create_session from qfv2-A-commander | 干净上下文 |
| W11 | 收任务 + brief_echo | send_message 下发任务 | brief_echo 正确 |
| W12 | 完成任务 + done | milestones done | node tree-state.js leaf set-status qfv2 qfv2-Aw1-worker done 成功 |
| W13 | 禁加子节点 | 尝试 leaf add | E_SCHEMA_INVALID |

### Layer 3 - Worker qfv2-Ac1w1-worker (depth 3, create_session 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| W20 | 创建会话 | create_session from qfv2-Ac1-commander | 干净上下文 |
| W21 | 完成任务 | 收到任务, 完成后 node tree-state.js leaf set-status qfv2 qfv2-Ac1w1-worker done | 成功 |
| W22 | 禁加子节点 | 尝试 leaf add | E_SCHEMA_INVALID |

### 延迟启动 Commander - qfv2-C-commander (depth 1, 等 A+B done)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| C0 | 前置条件 | 检查 A 和 B 状态 | 均为 done |
| C1 | 创建会话 | fork_session from qfv2-root | 成功 |
| C2 | qfv2-C-commander 加 commander | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-Cc1-commander","session_id":"UUID","parent":"qfv2-C-commander","path":"Cc1","role":"commander","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 |
| C3 | qfv2-Cc1-commander 加 worker | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-Cc1w1-worker","session_id":"UUID","parent":"qfv2-Cc1-commander","path":"Cc1w1","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | 成功 |
| C4 | 集成收束 | 所有 leaf done, root done | node tree-state.js validate qfv2 -> ok |

---

## 四、能力矩阵 (Capability Matrix)

| 能力 | v0.2.1 引入 | 验证位置 | 预期结果 |
|------|-----------|---------|---------|
| role = root | yes | R1 | 根 session, parent=null |
| role = commander | yes | A0, C10, C1 | fork 创建, 可加子节点 |
| role = worker | yes | B0, W10, W20 | create_session, 禁子节点 |
| 三层深度限制 | yes | A3(合法),A5(拒绝) | depth 0/1/2 加 commander 合法，已达上限 3 拒绝 |
| E_DEPTH_EXCEEDED | yes | A5 | 触及第 4 层 commander 报错 |
| E_CHILDREN_NOT_DONE | yes | A6 | 仅 commander role 触发，root 不受约束 (R5+R7) |
| E_SCHEMA_INVALID | yes | R2, B3, W13, W22, E1, E2 | role/结构违规拦截 |
| calcCommanderDepth | yes | A3(通过),A5(拒绝) | 深度计算正确 |
| migrate 子命令 | yes | 六 | 旧 role 映射正确 |
| 分布式写入 | yes | A8, B5 | 各司其职 |
| 自动备份 | yes | 全局, BKP1 | 每 10 写触发 + 手动 backup |
| backup/restore 往返 | yes | BKP1-BKP2 | 生成 backup 文件 + 从 backup 恢复成功 |
| validate | yes | 终局 | issues=[] |
| 根唯一性 | yes | R2 | 拒绝重复 root |
| Worker 禁子节点 | yes | B3, W13, W22 | 拒绝 |
| SKILL v2.2 | yes | S1-S3 | 版本号+load_on 移除 |
| 错误码全覆盖 | yes | E1-E8 | 8 个错误码全部触发 |

---

## 五、错误路径全覆盖

| 错误码 | 触发场景 | 测试位置 |
|--------|---------|---------|
| E_CHILDREN_NOT_DONE | Commander 在子节点未 done 时 done (仅 commander role 触发) | A6 |
| E_DEPTH_EXCEEDED | depth 已达上限 3，加 commander 触及第 4 层 | A5 |
| E_SCHEMA_INVALID | 重复 parent=null | R2 |
| E_SCHEMA_INVALID | worker 加子节点 | B3, W13, W22 |
| E_SCHEMA_INVALID | role 不在 ROLE_ENUM | E1 |
| E_SCHEMA_INVALID | parent=null 但 role!=root (通过 leaf add 触发，由 cmdLeafAdd L514-519 检测) | E2 |
| E_PARENT_MISSING | leaf add 用不存在的 parent_id | E3 |
| E_DUPLICATE_LEAF | 重复加同一 leaf_id | E4 |
| E_NAME_INVALID | 非法 leaf_id 格式 (如 NANJU 大写开头或缺少前缀段) | E5 |
| E_STATUS_INVALID | set-status 传入非法 status 值 | E6 |
| E_LEAF_NOT_FOUND | 操作不存在的 leaf_id | E7 |
| E_TREE_NOT_FOUND | validate 不存在的 tree_id | E8 |

### 错误路径快速用例

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| E1 | role 不在 ROLE_ENUM | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-bad-role","session_id":"UUID","parent":"qfv2-root","path":"","role":"invalid_role","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | E_SCHEMA_INVALID |
| E2 | parent=null 但 role!=root | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-E-worker","session_id":"UUID","parent":null,"path":"","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | E_SCHEMA_INVALID (由 cmdLeafAdd L514-519 检测：命名先通过，到达 L514 的 parent=null 校验) |
| E3 | parent 不存在 | node tree-state.js leaf add qfv2 --json '{"leaf_id":"qfv2-orphan","session_id":"UUID","parent":"nonexistent-leaf","path":"","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | E_PARENT_MISSING |
| E4 | 重复 leaf_id | 连续两次 leaf add qfv2-B-worker (第二次触发) | E_DUPLICATE_LEAF |
| E5 | 非法命名 | node tree-state.js leaf add qfv2 --json '{"leaf_id":"NANJU","session_id":"UUID","parent":"qfv2-root","path":"","role":"worker","model":"deepseek-v4-flash","channel":"56ecefd2-8e22-4c62-add5-16e8992c987d"}' | E_NAME_INVALID |
| E6 | 非法 status | node tree-state.js leaf set-status qfv2 qfv2-B-worker invalid_status | E_STATUS_INVALID |
| E7 | leaf 不存在 | node tree-state.js leaf set-status qfv2 nonexistent-leaf done | E_LEAF_NOT_FOUND |
| E8 | tree 不存在 | node tree-state.js validate nonexistent-tree | E_TREE_NOT_FOUND |

---

## 五-B、Backup/Restore 往返验证

> 审计要求: 增加独立的 backup/restore 专用测试用例，确保手动触发和恢复链路可追踪。

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| BKP1 | 手动 backup | 在所有 leaf 创建完成后，node tree-state.js backup qfv2 --label test | 返回 backup 文件名，在树目录下生成备份文件 (格式 backup-<timestamp>-test.json) |
| BKP2 | restore 往返验证 | node tree-state.js restore qfv2 <backup_file> (使用 BKP1 生成的备份文件名) | 成功恢复，写计数归零。随后 node tree-state.js validate qfv2 -> ok:true, issues=[] |

---

## 六、migrate 验证

> **前置条件**：bverify 树由 2026-06-18 B 任务持久化遗留，须已存在于 C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/trees/bverify/tree-state.json。
> 执行前先检查文件是否存在。若不存在，跳过 M1-M4 并在报告中标注"前置条件不满足"。

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| M0 | 前置条件检查 | ls 检查 bverify/tree-state.json | 文件存在 |
| M1 | 读取旧格式 tree (bverify) | node tree-state.js migrate bverify --dry-run | 显示映射列表 (实际数量取决于 bverify 树数据；ROLE_MIGRATION_MAP 含 27 个固定条目，另有不在 map 中的兜底映射) |
| M2 | 实际 migrate | node tree-state.js migrate bverify | 成功, role 正确更新 |
| M3 | migrate 后 validate | node tree-state.js validate bverify | ok, issues=[] |
| M4 | worker 有子节点自动提升 | migrate 时 worker 有 children -> commander | 日志输出提升信息 |

---

## 六-B、SKILL 版本验证 (v0.2.1 CHANGELOG 覆盖)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| S1 | tree-commander SKILL 版本 | grep v2.2 检查 SKILL.md | 返回匹配行 |
| S2 | tree-worker SKILL 版本 | grep v2.2 检查 SKILL.md | 返回匹配行 |
| S3 | tree-worker 不含 load_on | grep load_on 检查 SKILL.md | 返回空 (已改为 create_session) |

---

## 七、会话创建策略映射

**硬约束**：
- 所有子会话模型：**deepseek-v4-flash**
- 所有子会话频道：**56ecefd2-8e22-4c62-add5-16e8992c987d**
- GLM 任何模型：**禁止使用**

| Leaf | 创建方式 | 模型 | 频道 | 理由 |
|------|---------|------|------|------|
| qfv2-A-commander | fork_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Commander 需继承上下文 |
| qfv2-B-worker | create_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Worker 需干净上下文 |
| qfv2-Ac1-commander | fork_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Commander 需继承 |
| qfv2-Aw1-worker | create_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Worker 干净上下文 |
| qfv2-Ac1w1-worker | create_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Worker 干净上下文 |
| qfv2-Ac1w2-worker | create_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Worker 干净上下文 |
| qfv2-C-commander | fork_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Commander 需继承 |
| qfv2-Cc1-commander | fork_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Commander 需继承 |
| qfv2-Cc1w1-worker | create_session | deepseek-v4-flash | 56ecefd2-8e22-4c62-add5-16e8992c987d | Worker 干净上下文 |

---

## 八、执行顺序与依赖

```
Phase 1: root 初始化 + root leaf 创建 (R0a, R0b, R1-R7)
  |
  +-- Phase 2a: A-commander 创建 + Ac1-commander 创建 (A0-A8, C10-C15)
  |    +-- Phase 2b: Aw1-worker + Ac1w1/Ac1w2-worker 并行 (W10-W13, W20-W22)
  |
  +-- Phase 3: B-worker 并行 (B0-B5)
  |
  +-- Phase 4: 等 A+B done -> C-commander 延迟启动 (C0-C4)
  |
  +-- Phase 5: 错误路径专项 (E1-E8, 可在 Phase 1 后任意时间执行)
  |
  +-- Phase 5b: backup/restore 往返 (BKP1-BKP2)
  |
  +-- Phase 6: migrate (M0-M4) + SKILL (S1-S3)
  |
  +-- Phase 7: 终局 validate
```

---

## 九、成功标准

1. **所有用例通过** - 无跳过、无失败
2. **tree-state validate** - {"ok":true,"issues":[]}
3. **所有错误路径触发并返回正确错误码**
4. **自动备份生成** - 至少 1 个 backup 文件
5. **手动 backup/restore 往返成功** - BKP1 生成 backup 文件，BKP2 恢复后 validate 通过
6. **真实会话全部正常** - 无卡死、无超时
7. **分布式写入正确** - root/commander/worker 权限边界清晰
8. **migrate 无损** - bverify 树迁移后 validate 通过

---

## 十、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| DeepSeek V4 Flash 长消息卡死 | 低 | 全链路使用 V4 Flash，轻量模型卡死概率低于 Pro |
| 子会话 fork 链路断裂 | 低 | 每步验证 session_id 有效性 |
| GLM 频道误用 | 极低 | 硬约束：所有会话频道锁定，明确禁止 GLM |
| 执行时间过长 (>30min) | 中 | 子会话并行执行 (Phase 2a/2b/3 并行) |
| workspace=null 文件访问 | 低 | 所有路径用绝对路径 |

---

## 十一、报告格式

验证完成后输出 C:/Users/sir_c/.proma/agent-workspaces/proma/workspace-files/.context/q1-v2-final-report.md，格式：

    # Q1 v2 全深度 3 层验证报告
    ## 总评
    ## 执行摘要
    - tree_id: qfv2
    - 总 leaf: N
    - 真实会话: M
    - 通过/失败: X/Y
    - 错误路径触发: Z/Z
    ## Layer 0 结果 (Root)
    ## Layer 1 结果 (Commander + Worker)
    ## Layer 2 结果 (Commander + Worker)
    ## Layer 3 结果 (Worker)
    ## 错误路径结果
    ## Backup/Restore 结果
    ## migrate 结果
    ## tree-state 终局
    ## 发现的问题

---

## 十二、方案自审计声明

本方案在发布前需经过：
1. **完整性检查** - 是否覆盖了 v0.2.1 CHANGELOG 中每一项变更
2. **错误路径检查** - 是否每个错误码都有对应触发用例
3. **可行性检查** - 用例是否能在真实环境中执行 (不依赖模拟)
4. **依赖检查** - 执行顺序是否正确、是否有死锁依赖

审计结果记录在方案审计报告中，所有发现必须在方案发布前修订。

---

## 修订记录

| 日期 | 修订内容 |
|------|---------|
| 2026-06-20 | 初始版本 (v2) |
| 2026-06-20 | 审计修复 (3 阻断 + 3 严重 + 1 附加): (1) tree_id/leaf_id 前缀 q1full-v2->qfv2，路径段去内部连字符以匹配 LEAF_NAME_RE (2) E2 触发机制从 validate 改为 leaf add --json (3) 所有 CLI 语法统一为 --json/位置参数格式 (4) leaf 总数从 9 修正为 10 (5) 增加 R0b 显式创建 root leaf (6) 增加五-B BKP1/BKP2 backup/restore 用例 (7) M1 期望值从硬编码 28 改为取决于实际数据 |
