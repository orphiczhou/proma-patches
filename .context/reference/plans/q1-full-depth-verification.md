# Q1 v1.1 全深度 3 层树形验证方案

> 版本: v1.1 | 日期: 2026-06-19 | 制定: Proma Agent | 审计: 1 轮 (3阻断+5严重已修)
> 对标: `release/tree-system-v0.2.1/` 发布包
> 方法论: commander-methodology v1.2 (13 条原则)
> 目标: 完整验证 tree-state.js v0.2.1 全部能力，覆盖 3 层指挥官深度、role 枚举、错误路径、分布式写入

---

## 一、验证目标

证明 tree-state.js v0.2.1 + commander-methodology v1.2 + SKILL v2.2 在真实 Proma 环境下**完整体现 3 层树形指挥能力**，包括：

1. **role 三层枚举** (root / commander / worker) 全部创建并行使各自权限
2. **三层深度限制** — depth 0→1→2 合法，depth≥3 触发 E_DEPTH_EXCEEDED
3. **分布式写入** — 根/commander/worker 各自写入正确
4. **E_CHILDREN_NOT_DONE** — 子节点未完成时拒绝父节点 done
5. **Worker 禁子节点** — 以 worker 为 parent 加 leaf 触发 E_SCHEMA_INVALID
6. **根唯一性** — 重复 parent=null 触发 E_SCHEMA_INVALID
7. **migrate 子命令** — 旧 role 映射正确
8. **自动备份** — 每 10 次写触发
9. **真实会话链路** — fork/create_session/send_message 端到端

---

## 二、验证树结构

```
q1full-root (depth 0, role=root, 本会话)
│
├─ q1full-A-commander (depth 1, role=commander)
│   创建: fork_session from root
│   权限: leaf add commander/worker (parent=self)
│   ├─ q1full-A-c1-commander (depth 2, role=commander)
│   │   创建: fork_session from A
│   │   权限: leaf add worker only (NOT commander → E_DEPTH_EXCEEDED)
│   │   ├─ q1full-A-c1-w1-worker (depth 3, role=worker)
│   │   │   创建: create_session from A-c1
│   │   │   验证: 禁加子节点 (E_SCHEMA_INVALID)
│   │   └─ q1full-A-c1-w2-worker (depth 3, role=worker)
│   │       创建: create_session from A-c1
│   │
│   └─ q1full-A-w1-worker (depth 2, role=worker)
│       创建: create_session from A
│       验证: 禁加子节点 (E_SCHEMA_INVALID)
│
├─ q1full-B-worker (depth 1, role=worker)
│   创建: create_session from root
│   验证: 禁加子节点 (E_SCHEMA_INVALID)
│
└─ q1full-C-commander (depth 1, role=commander)
    创建: fork_session from root, 等 A+B 全部 done 后启动
    权限: leaf add commander/worker
    └─ q1full-C-c1-commander (depth 2, role=commander)
        创建: fork_session from C
        └─ q1full-C-c1-w1-worker (depth 3, role=worker)
            创建: create_session from C-c1
```

**叶子统计**：
- 总 leaf 数: 9 (含 root) = 1 root + 2 depth-1 commander + 1 depth-1 worker + 2 depth-2 commander + 3 worker
- Commander: 4 (q1full-A-commander, q1full-A-c1-commander, q1full-C-commander, q1full-C-c1-commander)
- Worker: 5 (q1full-A-w1-worker, q1full-A-c1-w1-worker, q1full-A-c1-w2-worker, q1full-B-worker, q1full-C-c1-w1-worker)
- Root: 1

---

## 三、逐层测试用例

### Layer 0 — Root Commander (本会话)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| R0 | 初始化 | `tree-state.js init q1full --root-brief '{...}' --root-dod '{...}'` | 创建 trees/q1full/tree-state.json |
| R1 | role 验证 | 检查 root leaf role | role = "root", parent = null |
| R2 | 根唯一性 | 尝试 leaf add 另一个 root (parent=null) | E_SCHEMA_INVALID (重复 parent=null) |
| R3 | root 加 commander | `leaf add q1full-A-commander --role commander --parent root` | 成功 |
| R4 | root 加 worker | `leaf add q1full-B-worker --role worker --parent root` | 成功 |
| R5 | root set-status done (不受子节点约束) | 子节点未 done 时 set-status done | **成功** — tree-state.js L782 E_CHILDREN_NOT_DONE 仅检查 `role==='commander'`，role='root' 不受此约束。root 只要有合法 milestones 即可 done |
| R6 | root brief/dod | 检查 root_brief/root_dod 完整性 | 必含 parent_intent/my_mission/why_this_exists/in_scope/out_of_scope |
| R7 | E_CHILDREN_NOT_DONE 仅适用 commander | 对比 root done vs commander done 行为差异 | root 不受约束 (R5=成功)，commander 受约束 (A6=拒绝)。验证代码 L782 `if(leaf.role==='commander')` 守卫 |

### Layer 1 — Commander q1full-A-commander (depth 1, fork 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| A0 | 创建会话 | `fork_session` from root | 返回有效 session_id |
| A1 | brief_echo | 子会话收到任务后回传 brief_echo | tree-state q1full-A-commander events 含 brief_echo |
| A2 | 规划 milestones | q1full-A-commander 规划 M1/M2/M3 | milestones 写入 tree-state |
| A3 | q1full-A-commander 加 commander (到 depth 2) | `leaf add q1full-A-c1-commander --role commander --parent q1full-A-commander` | 成功 (depth 1→2 合法) |
| A4 | q1full-A-commander 加 worker | `leaf add q1full-A-w1-worker --role worker --parent q1full-A-commander` | 成功 |
| A5 | E_DEPTH_EXCEEDED 深度限制 | **前置条件: q1full-A-c1-commander 已创建 (C10)。** 以 q1full-A-c1-commander 为 parent 尝试 `leaf add X --role commander` | E_DEPTH_EXCEEDED (depth 已达上限 3，第 4 层拒绝) |
| A6 | q1full-A-commander set-status done (子未完成) | 子节点 A-c1/A-w1 未 done 时 set-status done | E_CHILDREN_NOT_DONE |
| A7 | q1full-A-commander set-status done (子已完成) | 所有子节点 done 后 set-status done | 成功, status=done |
| A8 | q1full-A-commander 分布式写入 | 检查 q1full-A-commander 是否只写了 parent=self 的 leaf + events | 不涉及结构性变更(root范围外) |

### Layer 1 — Worker q1full-B-worker (depth 1, create_session 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| B0 | 创建会话 | `create_session` (非 fork) | 返回干净会话 (无历史上下文) |
| B1 | brief_echo | 收到任务后回传 brief_echo | tree-state q1full-B-worker events 含 brief_echo |
| B2 | milestones | q1full-B-worker 规划并完成 M1 | milestones 写入 |
| B3 | Worker 禁加子节点 | 尝试 `leaf add X --role worker --parent q1full-B-worker` | E_SCHEMA_INVALID |
| B4 | Worker set-status done | 无子节点约束, 直接 done | 成功 (Worker 跳过 E_CHILDREN_NOT_DONE) |
| B5 | Worker 不写 tree-state | 记录 Worker 开始前 `_meta.write_count` 值 (W_before)，Worker send_message 完成后再次检查 write_count (W_after) | W_after == W_before（差值=0，Worker 未调用 tree-state.js） |

### Layer 2 — Commander q1full-A-c1-commander (depth 2, fork 从 q1full-A-commander 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| C10 | 创建会话 | `fork_session` from q1full-A-commander | 返回有效 session_id, 继承 A 上下文 |
| C11 | q1full-A-c1-commander 加 worker | `leaf add q1full-A-c1-w1-worker --role worker --parent q1full-A-c1-commander` | 成功 (depth 已达上限 3，但加 worker 不受深度限制) |
| C12 | q1full-A-c1-commander 加另一个 worker | `leaf add q1full-A-c1-w2-worker --role worker --parent q1full-A-c1-commander` | 成功 |
| C13 | q1full-A-c1-commander send_message 派活 | send_message(wait=true) to q1full-A-c1-w1-worker | worker 正常回复 |
| C14 | q1full-A-c1-commander set-status done | 所有子 worker done 后 | 成功 |
| C15 | q1full-A-c1-commander 上下文保留 | 用 `list_messages` 检查 q1full-A-c1-commander 消息数 ≥ 2 (含 user+assistant)，验证 fork 继承的上下文非空 | 消息数 ≥ 2，brief_echo 事件已记录 |

### Layer 2 — Worker q1full-A-w1-worker (depth 2, create_session 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| W10 | 创建会话 | `create_session` from q1full-A-commander | 干净上下文 |
| W11 | 收任务 + brief_echo | send_message 下发任务 | brief_echo 正确 |
| W12 | 完成任务 + done | milestones done | set-status done 成功 |
| W13 | 禁加子节点 | 尝试 leaf add | E_SCHEMA_INVALID |

### Layer 3 — Worker q1full-A-c1-w1-worker (depth 3, create_session 创建)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| W20 | 创建会话 | `create_session` from q1full-A-c1-commander | 干净上下文 |
| W21 | 完成任务 | 收到任务, 完成后 done | 成功 |
| W22 | 禁加子节点 | 尝试 leaf add | E_SCHEMA_INVALID |

### 延迟启动 Commander — q1full-C-commander (depth 1, 等 A+B done)

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| C0 | 前置条件 | 检查 A 和 B 状态 | 均为 done |
| C1 | 创建会话 | `fork_session` from root | 成功 |
| C2 | q1full-C-commander 加 commander | `leaf add q1full-C-c1-commander --role commander --parent q1full-C-commander` | 成功 |
| C3 | q1full-C-c1-commander 加 worker | `leaf add q1full-C-c1-w1-worker --role worker --parent q1full-C-c1-commander` | 成功 |
| C4 | 集成收束 | 所有 leaf done, root done | validate ok |

---

## 四、能力矩阵 (Capability Matrix)

| 能力 | v0.2.1 引入 | 验证位置 | 预期结果 |
|------|-----------|---------|---------|
| role = root | ✅ | R1 | 根 session, parent=null |
| role = commander | ✅ | A0, C10, C1 | fork 创建, 可加子节点 |
| role = worker | ✅ | B0, W10, W20 | create_session, 禁子节点 |
| 三层深度限制 | ✅ | A3(合法),A5(拒绝) | depth 0/1/2 加 commander 合法，已达上限 3 拒绝 |
| E_DEPTH_EXCEEDED | ✅ | A5 | 触及第 4 层 commander 报错 |
| E_CHILDREN_NOT_DONE | ✅ | A6 | 仅 commander role 触发，root 不受约束 (R5+R7) |
| E_SCHEMA_INVALID | ✅ | R2, B3, W13, W22, E1, E2 | role/结构违规拦截 |
| calcCommanderDepth | ✅ | A3(通过),A5(拒绝) | 深度计算正确 |
| migrate 子命令 | ✅ | §六 | 旧 role 映射正确 |
| 分布式写入 | ✅ | A8, B5 | 各司其职 |
| 自动备份 | ✅ | 全局 | 每 10 写触发 |
| validate | ✅ | 终局 | issues=[] |
| 根唯一性 | ✅ | R2 | 拒绝重复 root |
| Worker 禁子节点 | ✅ | B3, W13, W22 | 拒绝 |
| SKILL v2.2 | ✅ | S1-S3 | 版本号+load_on 移除 |
| 错误码全覆盖 | ✅ | E1-E8 | 8 个错误码全部触发 |

---

## 五、错误路径全覆盖

| 错误码 | 触发场景 | 测试位置 |
|--------|---------|---------|
| E_CHILDREN_NOT_DONE | Commander 在子节点未 done 时 done（仅 commander role 触发） | A6 |
| E_DEPTH_EXCEEDED | depth 已达上限 3，加 commander 触及第 4 层 | A5 |
| E_SCHEMA_INVALID | 重复 parent=null | R2 |
| E_SCHEMA_INVALID | worker 加子节点 | B3, W13, W22 |
| E_SCHEMA_INVALID | role 不在 ROLE_ENUM | E1 |
| E_SCHEMA_INVALID | parent=null 但 role≠root | E2 |
| E_PARENT_MISSING | leaf add 用不存在的 parent_id | E3 |
| E_DUPLICATE_LEAF | 重复加同一 leaf_id | E4 |
| E_NAME_INVALID | 非法 leaf_id 格式（如 "NANJU" 大写开头或 "A-B" 缺少前缀段） | E5 |
| E_STATUS_INVALID | set-status 传入非法 status 值 | E6 |
| E_LEAF_NOT_FOUND | 操作不存在的 leaf_id | E7 |
| E_TREE_NOT_FOUND | validate 不存在的 tree_id | E8 |

### 错误路径快速用例

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| E1 | role 不在 ROLE_ENUM | `leaf add X --role invalid_role --parent root` | E_SCHEMA_INVALID |
| E2 | parent=null 但 role≠root | JSON 手动构造 `{role:"worker",parent:null}` 后 validate | E_SCHEMA_INVALID |
| E3 | parent 不存在 | `leaf add X --role worker --parent nonexistent-leaf` | E_PARENT_MISSING |
| E4 | 重复 leaf_id | 连续两次 `leaf add q1full-B-worker --role worker --parent root` | E_DUPLICATE_LEAF (第二次) |
| E5 | 非法命名 | `leaf add NANJU --role worker --parent root` | E_NAME_INVALID |
| E6 | 非法 status | `set-status q1full-B-worker --status invalid_status` | E_STATUS_INVALID |
| E7 | leaf 不存在 | `set-status nonexistent-leaf --status done` | E_LEAF_NOT_FOUND |
| E8 | tree 不存在 | `tree-state.js validate nonexistent-tree` | E_TREE_NOT_FOUND |

---

## 六、migrate 验证

> **前置条件**：bverify 树由 2026-06-18 B 任务持久化遗留，须已存在于 `trees/bverify/tree-state.json`。
> 执行前先检查：`ls trees/bverify/tree-state.json`。若不存在，跳过 M1-M4 并在报告中标注"前置条件不满足"。

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| M0 | 前置条件检查 | `ls trees/bverify/tree-state.json` | 文件存在 |
| M1 | 读取旧格式 tree (bverify) | `tree-state.js migrate bverify --dry-run` | 显示 28 映射 |
| M2 | 实际 migrate | `tree-state.js migrate bverify` | 成功, role 正确更新 |
| M3 | migrate 后 validate | `tree-state.js validate bverify` | ok, issues=[] |
| M4 | worker 有子节点自动提升 | migrate 时 worker 有 children → commander | 日志输出提升信息 |

---

## 六-B、SKILL 版本验证（v0.2.1 CHANGELOG 覆盖）

| # | 用例 | 操作 | 期望 |
|---|------|------|------|
| S1 | tree-commander SKILL 版本 | `grep "v2.2" skills/tree-commander/SKILL.md` | 返回匹配行 |
| S2 | tree-worker SKILL 版本 | `grep "v2.2" skills/tree-worker/SKILL.md` | 返回匹配行 |
| S3 | tree-worker 不含 load_on | `grep "load_on" skills/tree-worker/SKILL.md` | 返回空 (已改为 create_session) |

---

## 七、会话创建策略映射

| Leaf | 创建方式 | 模型 | 频道 | 理由 |
|------|---------|------|------|------|
| q1full-A-commander | fork_session | deepseek-v4-flash | 56ecefd2 | Commander 需继承上下文 |
| q1full-B-worker | create_session | deepseek-v4-flash | 56ecefd2 | Worker 需干净上下文 |
| q1full-A-c1-commander | fork_session | deepseek-v4-flash | 56ecefd2 | Commander 需继承 |
| q1full-A-w1-worker | create_session | deepseek-v4-flash | 56ecefd2 | Worker 干净上下文 |
| q1full-A-c1-w1-worker | create_session | deepseek-v4-flash | 56ecefd2 | Worker 干净上下文 |
| q1full-A-c1-w2-worker | create_session | deepseek-v4-flash | 56ecefd2 | Worker 干净上下文 |
| q1full-C-commander | fork_session | deepseek-v4-flash | 56ecefd2 | Commander 需继承 |
| q1full-C-c1-commander | fork_session | deepseek-v4-flash | 56ecefd2 | Commander 需继承 |
| q1full-C-c1-w1-worker | create_session | deepseek-v4-flash | 56ecefd2 | Worker 干净上下文 |

---

## 八、执行顺序与依赖

```
Phase 1: root 初始化 (R0-R7)
  │
  ├─ Phase 2a: A-commander 创建 + A-c1-commander 创建 (A0-A8, C10-C15)
  │   └─ Phase 2b: A-w1-worker + A-c1-w1/w2-worker 并行 (W10-W13, W20-W22)
  │
  ├─ Phase 3: B-worker 并行 (B0-B5)
  │
  ├─ Phase 4: 等 A+B done → C-commander 延迟启动 (C0-C4)
  │
  ├─ Phase 5: 错误路径专项 (E1-E8, 可在 Phase 1 后任意时间执行)
  │
  ├─ Phase 6: migrate (M0-M4) + SKILL (S1-S3)
  │
  └─ Phase 7: 终局 validate + backup-restore 往返验证
```

---

## 九、成功标准

1. **所有用例通过** — 无跳过、无失败
2. **tree-state validate** — `{"ok":true,"issues":[]}`
3. **所有错误路径触发并返回正确错误码**
4. **自动备份生成** — 至少 1 个 backup 文件
5. **真实会话全部正常** — 无卡死、无超时
6. **分布式写入正确** — root/commander/worker 权限边界清晰
7. **migrate 无损** — bverify 树迁移后 validate 通过

---

## 十、风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| DeepSeek V4 Pro 长消息卡死 | 中 | 所有子会话用 V4 Flash，指挥官用短 prompt |
| 子会话 fork 链路断裂 | 低 | 每步验证 session_id 有效性 |
| GLM 频道误用 | 低 | 硬约束：所有会话只用 DeepSeek 官方频道 |
| 执行时间过长 (>30min) | 中 | 子会话并行执行 (Phase 2a/2b/3 并行) |
| workspace=null 文件访问 | 中 | 所有路径用绝对路径 |

---

## 十一、报告格式

验证完成后输出 `q1-full-depth-report.md`，格式：

```markdown
# Q1 v1.1 全深度 3 层验证报告

## 总评
✅ / ⚠️ / ❌

## 执行摘要
- tree_id: q1full
- 总 leaf: N
- 真实会话: M
- 通过/失败: X/Y
- 错误路径触发: Z/Z

## Layer 0 结果 (Root)
| 用例 | 结果 | 证据 |

## Layer 1 结果 (Commander + Worker)
| 用例 | 结果 | 证据 |

## Layer 2 结果 (Commander + Worker)
| 用例 | 结果 | 证据 |

## Layer 3 结果 (Worker)
| 用例 | 结果 | 证据 |

## 错误路径结果
| 错误码 | 触发 | 结果 |

## migrate 结果
| 用例 | 结果 |

## tree-state 终局
- validate: ...
- write_count: ...
- backup_count: ...
- 树结构: (draw)

## 发现的问题
| # | 问题 | 严重度 |
```

---

## 十二、方案自审计声明

本方案在发布前需经过：
1. **完整性检查** — 是否覆盖了 v0.2.1 CHANGELOG 中每一项变更
2. **错误路径检查** — 是否每个错误码都有对应触发用例
3. **可行性检查** — 用例是否能在真实环境中执行（不依赖模拟）
4. **依赖检查** — 执行顺序是否正确、是否有死锁依赖

审计结果记录在方案审计报告中，所有发现必须在方案发布前修订。
