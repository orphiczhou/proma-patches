# 设计提案：Commander 派生改 create_session + 混合任务书

> 维护：周星星 | 提出：2026-07-11 会话 bbdefd1e
> 状态：**已排期 Sprint 2**（约束激活），方案已定，待实施
> 配套：[sprint-plan.md](./sprint-plan.md) Sprint 2 · [methodology-coverage-audit.md](./methodology-coverage-audit.md) 约束 4 · [../skills/tree-commander/SKILL.md](../skills/tree-commander/SKILL.md) §4 Step 2

---

## 一、背景与动机

**现状**：commander SKILL §4 Step 2（L189-190）派生子会话时，`fork_session` / `create_session` **二选一，没强制**：

```
1. fork_session(from=<parent_session>, ...)  或  create_session(...)
2. 首条消息 = §3 的 5 件套完整 YAML
```

**问题**：选 fork 时，子 commander 会**继承父会话全部历史**（root 的对话、其他 commander 的消息），导致：
1. **上下文污染**——commander 被无关历史干扰，偏离任务书
2. **token 浪费**——fork 复制历史，每次调用都为父历史付费
3. **违背契约驱动**——commander 应靠 5 件套任务书运转，而非靠继承

**用户诉求**（2026-07-11）：root 派生下来的各级 commander，不要 fork，重新开会话（create_session），然后读取任务书。

---

## 二、决策（用户已拍板）

| 维度 | 决策 |
|---|---|
| **范围** | 仅**正常派生**（root→commander→子 commander 的建人流程）改 create_session。纠偏重档（§7）/ 崩溃恢复（F1，§10 灾难恢复）**保留 fork**——它们是「从某 milestone 重试」语义，fork 才能继承到该点历史 |
| **任务书获取** | **混合**：父会话 create_session 后发首条消息（含 `leaf_id` + 一句话引导）→ commander 启动后用 `leaf_id` 调 `tree_leaf_get` 主动读 leaf 持久化的完整 5 件套 |
| **附带价值** | 此变更天然激活 methodology-coverage-audit **约束 4**（5 件套持久化）—— 一举两得 |

---

## 三、为什么不违反 macp2 红线

CLAUDE.md P0 教训：禁 `create_session`/`fork_session`/**`delegate_agent` 当 reviewer/SubAgent**（自审场景，4 分钟炸 207 会话）。

**本提案不违反**，因为：
- macp2 红线针对的是 **SubAgent/reviewer**（自审场景，要廉价进程内）
- commander 是**执行协调者**（要独立真实会话跑实际任务，需侧边栏可见可追踪），用 create_session 派生**不在红线内**
- 前提：受预算护栏约束（node_budget / create_session budget / 收敛条件）

---

## 四、实施方案

### 4.1 引擎（tree-engine.cjs）
- leaf 对象（cmdLeafAdd L1037-1063）加 5 字段：`brief`/`dod`/`report_protocol`/`autonomy`/`self_audit`（**object 嵌套**，默认 `{}`）
- `cmdLeafAdd`：input 可选传 5 件套，持久化进 leaf
- `tree_leaf_get`：自动返回含 5 件套（已有，无需改）
- **向后兼容**：旧 leaf 无这些字段，读取默认空对象（migrate 补默认值）

### 4.2 SKILL commander §4 Step 2
- 正常派生**强制 `create_session`**（删 fork 选项）
- 新派生流程：
  ```
  1. create_session(channel_id, model_id, title=<命名规范>)
  2. leaf_add(leaf_id, session_id, ..., brief=<5件套之brief>, dod=<...>, ...)  # 持久化 5 件套
  3. send_message(首条: 含 leaf_id + "你的任务书在 leaf <id>，调 tree_leaf_get 读")
  4. commander 启动 → tree_leaf_get(leaf_id) 读 5 件套 → brief_echo 对齐
  ```
- §7 纠偏重档 / F1 崩溃恢复：**保留 fork**，加标注「仅这些场景用 fork（需继承到 milestone 历史）」

### 4.3 SKILL worker
- worker 启动同理：用 leaf_id 调 tree_leaf_get 读自己的 5 件套（worker 派生也是 commander 做的，机制一致）

### 4.4 测试
- leaf_add 持久化 5 件套（断言 leaf.brief/dod/... 非空）
- commander 启动读任务书流程（create_session → leaf_add → 读 → brief_echo）
- 向后兼容（旧 leaf 无 5 件套字段，migrate 补默认）

### 4.5 文档
- methodology-coverage-audit 约束 4：🔴→✅（本提案实施即激活）
- CLAUDE.md / sprint-plan / note 同步

---

## 五、利弊评估

**利**：
1. 上下文隔离——commander 不被父历史污染，纯契约驱动
2. 成本省——create_session 不复制历史，每次调用 token 更少
3. 激活约束 4——5 件套持久化，崩溃恢复/竹节交接不丢契约
4. 符合「契约驱动」设计哲学

**弊/风险**：
1. 需引擎改动（leaf schema）—— 中等复杂度，需测试 + 向后兼容
2. 5 件套字段结构设计（已推荐 object 嵌套）
3. SKILL 流程改动较大（§4 Step 2 重写 + commander 启动新增「读任务书」步骤）

---

## 六、与 Sprint 2 / 约束 4 的关系

本提案 = **sprint-plan Sprint 2「约束激活」里约束 4（5 件套持久化）的实施载体**。Sprint 2 的约束 4 激活路径 = 本提案。

实施本提案 → 约束 4 自动激活（methodology-coverage-audit 约束 4 🔴→✅）。

---

## 七、待定细节（实施时最终决策）

| 细节 | 推荐 | 决策时机 |
|---|---|---|
| 5 件套字段结构 | object 嵌套（brief:{background,goal,in_scope,...}） | 实施时确认 |
| leaf_add 参数扩展 | input.brief/dod/... 可选传 | 实施时 |
| commander 启动读任务书的 SKILL 措辞 | 「§X 启动：tree_leaf_get(leaf_id) → brief_echo」 | 实施时 |
| 首条消息内容 | leaf_id + 一句话引导（非完整 5 件套，避免冗余） | 实施时 |

---

## 八、实施检查清单（Sprint 2 用）

- [x] 引擎：leaf schema 加 5 字段 + cmdLeafAdd 持久化 + migrate 兼容（md5 2d281ebf46）
- [x] SKILL commander §4 Step 2：强制 create_session + 新派生流程
- [x] SKILL commander §7/F1：保留 fork + 标注（+ §7 中档 autonomy_override 失同步标注）
- [x] SKILL worker：启动读 leaf 任务书（§2/§2.5）
- [x] 测试：持久化 + 读流程 + 向后兼容（`.context/plan/sprint2-five-piece-test.cjs` 15/0）
- [x] 文档：coverage-audit 约束4 ✅ / sprint-plan / CLAUDE.md / note
- [x] node -c + 零回归 + 部署 PRO dist + 重启 pro + **pro 端到端验证通过**（commander d218bd5c 实证 brief/dod 回填，2026-07-14）
