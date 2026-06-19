# Changelog

## v0.2.1 (2026-06-19) — Q1 v1.1 架构升级

### 核心变更

- **tree-state.js** v0.2.1：1551→1680 行
  - **role 三层枚举**：root / commander / worker，正式区分指挥层级
  - **三层深度限制**：depth 0(root)→1(commander)→2(commander)，depth≥3 禁止加 commander（E_DEPTH_EXCEEDED）
  - **E_CHILDREN_NOT_DONE**：Commander set-status done 时子节点必须全部 done
  - **calcCommanderDepth()**：自动计算当前节点距根 commander 的距离
  - **migrate 子命令**：28 旧 role 映射 + worker 有子节点自动提升 commander
  - **分布式写入**：根做结构性变更，子/孙 Commander 做 leaf add(parent=self)+milestones/events/status，Worker 只上报不写 tree
  - **根唯一性校验**：重复 parent=null → E_SCHEMA_INVALID
  - **Worker 禁子节点**：以 worker 为 parent 加 leaf → E_SCHEMA_INVALID
- **commander-methodology.md** v1.0→v1.2：13 条原则（新增 Leaf Purity + 分布式写入 + 三层深度）
- **tree-commander-design.md** v1.0→v1.3：role 枚举 + ROLE_ENUM 示例
- **tree-commander SKILL** v2.1→v2.2：版本引用更新
- **tree-worker SKILL** v2.1→v2.2：load_on 改为 create_session

### 新增文件

- `design/q1-state-architecture.md`：Q1 独立方案 v1.1（547 行）
- `design/q2-tree-ui-panel.md`：Q2 独立方案 v1.0（298 行）
- `verification-reports/q1-e2e-verification-report.md`：Q1 端到端验证报告
- `progress-report-2026-06-19.md`：开发进度摸底报告

### 验证记录

- **Q1 e2e 验证**（2026-06-19）：3 层树（root→commander→commander+worker），全链路通过 ✅
- **l1fix_v2 审计**：多 Agent 审计驱动修订，收敛通过 ✅
- **v1.1 S1 回归**：全命令通过 ✅
- **v1.1 migrate**：bverify 树迁移通过 ✅

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
  - 4 条铁律（严禁直接读写 tree-state.json、必须下发 5 件套、三步质量门、三档递进纠偏）
  - 12 条禁止行为（根会话亲自写代码、一句话任务等）
  - 5 件套契约模板（brief/dod/report/autonomy/self_audit）
  - 偏差检测与纠偏机制（drift_log）
  - 竹节交接流程（v0.3 实现）

- **tree-worker SKILL** v2.1：工人操作手册
  - 9 条铁律（首条 brief_echo、禁直接写 tree-state 等）
  - 4 种上行消息模板（done/blocked/plan/brief_echo）
  - 5 件套契约解读流程
  - 上下文最小化规则

### 方法论文档

- **commander-methodology.md** v1.0.1：10条核心原则 + 2条元信念 + 双轨执行
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
- 心跳机制仅方案（S2 测试方案已定义，代码未实现）
- 内审/三档纠偏仅方案（v0.2 设计文档 §10 已定义，未编码）
- 竹节交接仅方案
- 并发竞态（send_message fire-and-forget）
- 频道兼容性：GLM 配额不稳定，DeepSeek 偶尔长消息卡死

---

## v0.1（2026-06-18）— 原型验证

- tree-state.js 初始实现
- tree-commander + tree-worker SKILL v1.0
- commander-methodology 草案
- S1 全链路模拟测试
- B 任务真实验证
