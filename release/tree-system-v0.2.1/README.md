# Proma 树形会话执行体系 v0.2.1

> 一句话：让一个根会话（指挥官）可靠地调度 N 个子会话（工人）+ N 个子 Agent 完成大型任务，每一步都有判断防偏题。

---

## 这是什么

一套基于 Proma 会话 Fork + send_message + tree-state.js 的**多层级任务编排系统**。核心思想：复杂任务 → 拆解为树形结构 → 并行分派给多个子会话执行 → 结构化契约保底 → 事件通道上下行 → 终局验证收敛。

**定位**：Proma 改造项目 Layer 2 的初始可用版本。Layer 1（MCP 基础设施，v0.16.5）之上的第一层上层建筑。

---

## 版本状态

| 项目 | 值 |
|------|-----|
| 版本号 | **v0.2.1** |
| 发布日期 | 2026-06-19 |
| 状态 | **Alpha** — Q1 v1.1 架构升级落地，3 层深度验证通过 |
| 验证环境 | Proma Release 实例 / DeepSeek V4 Pro |
| 已知限制 | notify 异步上报未验证、心跳/内审仅方案未编码、并发竞态待修复 |

---

## 快速开始（5 分钟）

### 前提

- Proma Release 或 Dev 实例已运行
- 有一个 Agent 会话可作为"指挥官"
- 了解基本的 MCP session 工具使用

### 步骤

1. **读指挥官方法论**: `methodologies/commander-methodology.md`
2. **读指挥官 SKILL**: `skills/tree-commander/SKILL.md`
3. **初始化 tree-state**:
   ```bash
   node core/tree-state.js init mytree --root-brief '{"parent_intent":"我的第一个树形任务"}' --root-dod '{"deliverables":[]}'
   ```
4. **规划 leaf 结构**，为每个 leaf 写 5 件套契约（brief/dod/report/autonomy/self_audit）
5. **Fork 子会话** + **send_message 下发任务**
6. **回收 done 事件** + **整合产出**
7. **validate**: `node core/tree-state.js validate mytree`

详细教程见 `QUICKSTART.md`。

---

## 目录结构

```
tree-system-v0.2.1/
├── README.md                          # 本文件
├── QUICKSTART.md                      # 快速启动教程
├── CHANGELOG.md                       # 版本变更记录
├── progress-report-2026-06-19.md      # 开发进度摸底报告
│
├── core/
│   └── tree-state.js                  # 状态管理引擎（~1680 行，v0.2.1）
│
├── skills/                            # Agent 可加载的 SKILL 文件
│   ├── tree-commander/
│   │   └── SKILL.md                   # 指挥官操作手册 v2.2
│   └── tree-worker/
│       └── SKILL.md                   # 工人操作手册 v2.2
│
├── methodologies/                     # 方法论文档
│   ├── commander-methodology.md       # 指挥官方法论 v1.2（13条原则）
│   ├── audit-methodology.md           # 原始终局验证方法论
│   └── tree-audit-methodology.md      # 树形审计方法论（强制执行版）
│
├── design/
│   ├── tree-commander-design.md       # 完整设计文档 v1.3
│   ├── q1-state-architecture.md       # Q1 状态架构方案 v1.1（547 行）
│   └── q2-tree-ui-panel.md            # Q2 树形 UI 面板方案 v1.0（298 行）
│
├── test-plans/                        # 测试方案
│   ├── s1-test-plan.md                # S1 模拟测试
│   └── s2-test-plan.md                # S2 心跳/内审/三档纠偏
│
├── verification-reports/              # 验证报告
│   ├── b-verify-report.md             # B 任务：v0.1 首次真实验证
│   ├── v01-retest-report.md           # v0.1 S1 简单二叉树重测
│   ├── v01-real-test-report.md        # L2：v0.1 DeepSeek 频道真实验证
│   └── q1-e2e-verification-report.md  # Q1 v1.1 端到端验证报告
│
└── handoffs/                          # 交接文档示例
    ├── b-task-brief.md                # B 任务 brief
    └── l1-audit-fix-brief.md          # L1 审计任务 brief
```

---

## 核心概念

### role 三层枚举（v0.2.1 新增）

```
root       — 根指挥官，唯一能结构性变更 tree（init/leaf add）
commander  — 子/孙指挥官，fork 创建，能 leaf add(parent=self) + 管理下属
worker     — 叶子执行者，create_session 创建，干净上下文，只上报不写 tree
```

### 三层深度限制（v0.2.1 新增）

```
深度0: root           → leaf add commander ✅ / worker ✅
深度1: commander(子)  → leaf add commander ✅ / worker ✅
深度2: commander(孙)  → leaf add commander ❌ E_DEPTH_EXCEEDED / worker ✅
```

### 树形任务结构

```
根会话（root）
  ├─ A: commander(子) — fork 创建
  │   ├─ A1: worker（create_session 创建）
  │   └─ A2: commander(孙) — 深度1可再加 commander
  │       └─ A2a: worker
  ├─ B: worker（与 A 并行）
  └─ C: commander(子) — 等 A、B 完成后启动
```

### 5 件套契约

每个子会话收到的结构化任务描述：

| 契约 | 内容 |
|------|------|
| **brief** | 任务一句话 + 我的使命 + 为什么存在 + 范围内/外 |
| **dod** | 交付物清单 + 质量门 + 自检标准 |
| **report** | 完成后输出的报告模板 |
| **autonomy** | 子会话可自主决策的范围 |
| **self_audit** | 自审维度和通过标准 |

### 事件通道

| 事件类型 | 方向 | 含义 |
|---------|------|------|
| brief_echo | ↑ | 工人确认收到并理解任务 |
| plan | ↑ | 工人需要指挥官决策 |
| done | ↑ | 工人完成任务，附交付物 |
| blocked | ↑ | 工人遇到无法自主解决的阻塞 |
| heartbeat_reply | ↑ | 定期存活信号回应（v0.2 方案，未编码） |

### 状态管理

`tree-state.js` 是整个体系的**唯一真相源**（Single Source of Truth）。v0.2.1 提供：
- 树拓扑管理（增删改查、父子关系、路径定位）
- role 三层枚举（root/commander/worker）+ 深度限制
- 事件日志（brief_echo/done/blocked/plan 结构化持久化）
- 版本追踪（每次状态变更自增版本号+自动备份）
- 自审记录（milestone 级别的自审结果写入）
- 收敛验证（validate() 检查拓扑完整性、role约束、深度限制）
- migrate 子命令（28 旧 role 映射 + worker 有子节点自动提升）
- E_CHILDREN_NOT_DONE / E_DEPTH_EXCEEDED 错误保护

---

## 已验证的场景

| 场景 | 结果 | 证据 |
|------|------|------|
| Q1 e2e 验证：3 层树（root→commander→commander+worker） | ✅ 全链路通过 | q1-e2e-verification-report.md |
| B 任务：GLM-5-Turbo 4 子会话 | ✅ 有条件通过（频道限制） | b-verify-report.md |
| S1 重测：简单二叉树 25 命令 | ✅ 全部通过 | v01-retest-report.md |
| L2 验证：DeepSeek-v4-flash 3 子会话 | ✅ 1 次通过 0 偏差 | v01-real-test-report.md |
| l1fix_v2 审计：多 Agent 审计驱动修订 | ✅ 收敛通过 | l1fix_v2-fixer-report.md |

---

## 已知限制

1. **notify 异步上报未验证**：所有已验证任务均使用 wait=true 同步模式
2. **心跳机制仅方案**：S2 测试方案已定义，代码未实现
3. **内审/三档纠偏仅方案**：v0.2 设计文档 §10 已定义，未编码
4. **竹节交接仅方案**：上下文 >85% 甜点时的接力机制未实现
5. **并发竞态**：send_message fire-and-forget 并发存在消息丢失风险（L1 I3 发现）
6. **频道兼容性**：GLM 配额不稳定，DeepSeek 偶尔长消息卡死

---

## 依赖

- Proma Release/Dev 实例（含 MCP session 工具集）
- Node.js（运行 tree-state.js）
- Git Bash 或等效终端（Windows）

---

## 下一步（v0.3 计划）

- [ ] 心跳机制编码实现
- [ ] 内审/三档纠偏编码实现
- [ ] notify 异步事件通道真实验证
- [ ] 竹节交接实现
- [ ] 自动化 smoke test（Proma automation 定时任务）
- [ ] 频道兼容性矩阵正式文档

---

*本发布包是人类和 AI Agent 双可读的。人类读方法论和设计文档获得概念框架；Agent 读 SKILL 文件和 tree-state.js 获得可执行指令。*
