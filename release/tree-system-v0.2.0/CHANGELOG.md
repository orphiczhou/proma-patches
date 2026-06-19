# Changelog

## v0.2.0 (2026-06-19) — 初始版本

### 核心交付

- **tree-state.js** v1.0：1551 行，完整的状态管理引擎
  - 树拓扑管理（leaf 增删改查、父子关系、路径定位）
  - 事件日志（brief_echo/done/blocked/plan 结构化持久化）
  - 版本追踪 + 自动备份（每 10 次写触发）
  - milestone 严格校验（空 milestone 拒绝 done）
  - validate() 拓扑完整性检查
  - Windows rename 重试（5 次指数退避 50/100/200/400ms）
  - 命名规范：LEAF_NAME_RE = `[a-z][a-z0-9_]{3,7}`

- **tree-commander SKILL** v2.0：指挥官操作手册
  - 14 条铁律（根会话纯净、双轨执行、事件路由等）
  - 5 件套契约模板（brief/dod/report/autonomy/self_audit）
  - 偏差检测与纠偏机制（drift_log）
  - 竹节交接流程（v0.3 实现）

- **tree-worker SKILL** v2.0：工人操作手册
  - 9 条铁律（首条 brief_echo、禁直接写 tree-state 等）
  - 4 种上行消息模板（done/blocked/plan/brief_echo）
  - 5 件套契约解读流程
  - 上下文最小化规则

### 方法论文档

- **commander-methodology.md** v1.0：14 条铁律 + 双轨执行
- **tree-audit-methodology.md** v1.0：融合原始终局验证方法论 + 树形体系
  - 5 条铁律（并行多Agent / 迭代收敛 / 攻击独立 / 修正回归 / 证据结论）
  - 最少 7 leaf 强制要求
  - 收敛三条件 + 违规检测清单

### 验证记录

- **B 任务**（2026-06-18）：GLM-5-Turbo，4 子会话，3 次尝试 ✅ 有条件通过
- **S1 重测**（2026-06-19）：简单二叉树，25 命令全部通过 ✅
- **L2 验证**（2026-06-19）：DeepSeek-v4-flash，3 子会话，1 次通过 0 偏差 ✅

### 已知限制

- notify 异步上报未验证
- 心跳/内审/三档纠偏仅方案未编码
- 竹节交接仅方案
- 并发竞态（send_message fire-and-forget）

---

## v0.1（2026-06-18）— 原型验证

- tree-state.js 初始实现
- tree-commander + tree-worker SKILL v1.0
- commander-methodology 草案
- S1 全链路模拟测试
- B 任务真实验证
