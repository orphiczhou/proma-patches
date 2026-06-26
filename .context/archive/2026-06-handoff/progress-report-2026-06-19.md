# Proma 改造项目 — 开发进度摸底报告

> 审计时间: 2026-06-19 22:00 GMT+8 | 审计人: Proma Agent
> 范围: tree-state.js + v0.1/v0.2 交付物 + 补丁体系 A-K

---

## 一、总体结论

**底线：v0.1 可发布，v0.2 不可发布，Q1/Q2 几乎从零开始。**

v0.1 核心交付物（tree-state.js 22 命令 + 2 个 SKILL + S1 测试）全部完工且已验证。v0.2 设计写好了但实施基本为零——S2 测试没跑、审计报告没写、SESSION1 有虚报。Q1/Q2 方案里列的 tree-state.js 变更（role 枚举、E_CHILDREN_NOT_DONE、migrate）全部未实现。

---

## 二、tree-state.js 现状（Q1 的改造对象）

| 检查项 | 状态 |
|--------|------|
| 22 个子命令 | ✅ 全部实现 |
| role 枚举校验 (ROLE_ENUM) | ❌ 不存在，role 是自由文本 \w+ |
| added_by 字段 | ❌ 不存在 |
| E_CHILDREN_NOT_DONE 错误码 | ❌ 不存在 |
| migrate 子命令 | ❌ 不存在 |
| set-status done 检查子节点 | ❌ 不存在，只检查了 milestones |
| LEAF_NAME_RE 正则 | ✅ `[a-z][a-z0-9_]{3,7}` |

**一句话：tree-state.js 是个功能完整的"账本"，但没有任何权限模型和语义约束。Q1 方案要加的 5 样东西全部要从零写。**

---

## 三、v0.1 完成情况

### 已完成 ✅

| 类别 | 项目 | 状态 |
|------|------|------|
| 核心 | tree-state.js (1551行, 22命令) | ✅ |
| 核心 | tree-commander SKILL.md v2.1 (734行) | ✅ |
| 核心 | tree-worker SKILL.md v2.1 (441行) | ✅ |
| 核心 | commander-methodology.md v1.0.1 | ✅ |
| 测试 | S1 模拟测试 (25步) | ✅ 全通过 |
| 测试 | B 真实环境验证 | ⚠️ 有条件通过 |
| 修复 | M1 自动备份 | ✅ |
| 修复 | M2 空milestone拒绝done | ✅ |
| 修复 | M3 E_STATUS_INVALID 错误码 | ✅ |
| 修复 | S1 命名正则 | ✅ v0.1.1-C |
| 修复 | S3 Windows rename重试 | ✅ v0.1.1-S3 |

### 已知未修问题

| 编号 | 问题 | 严重度 |
|------|------|--------|
| S2 | nowIso() 时区依赖 | 中 |
| S4 | tree-worker/commander 字段未对齐 | 低 |
| S5 | 备份命名 <1ms 碰撞 | 低（极罕见） |
| T1-T4 | 轻微问题（parseArgs脆弱/dead code/交叉引用/占位符） | 低 |
| B1 | Claude/DeepSeek 频道不可用 | 高（基础设施） |
| B2 | 子会话未用 notify 异步上报 | 中 |
| B3 | context_usage_pct 未更新到 tree-state | 低 |

---

## 四、v0.2 完成情况

| 项目 | 状态 | 备注 |
|------|------|------|
| v0.2 设计章节 | ✅ 已写 | §10 心跳/内审/三档纠偏 spec 完整 |
| S3 rename 重试修复 | ✅ | 5次重试+指数退避 |
| 心跳 automation 模板 | ✅ 已写 | tree-commander §8 |
| 哨兵 Agent prompt | ✅ 已写 | tree-commander §8.2 |
| 内部自审流程 | ✅ 已写 | tree-worker §4 |
| 三档纠偏执行流程 | ✅ 已写 | tree-commander §7 |
| S2 测试方案 | ✅ 文档存在(261行) | **但测试未执行！全部3个场景零执行** |
| S2 测试执行 | ❌ 未跑 | S2a/S2b/S2c 全部为模拟命令 |
| v0.2 审计报告 | ❌ 未创建 | release-commander-handoff 要求的 P0 |
| SKILL.md 虚报审计 | ⚠️ 未做 | 文件时间戳(Jun19)晚于SESSION1(Jun18) |

### SESSION1 虚报详情

handoff 文档记录 SESSION1 声称"创建了 tree-commander/tree-worker SKILL.md"，但：
- 文件时间戳 Jun 19 18:30/18:31（SESSION1 在 Jun 18 执行）
- 文件版本已是 v2.1（含审计方法论），不可能是 SESSION1 原始产出
- 根因推测：SESSION1 workspace=null，写了内容但未落盘，后续被其他会话覆盖

---

## 五、补丁体系现状（Q2 的前置条件）

### 已部署补丁：A→K，共 11 个（v0.16.5）

| 补丁 | 功能 |
|------|------|
| A | MCP 钩子注入 |
| B/B2/B3 | API 桥接 + runAgentHeadless + listAgentWorkspaces |
| C1-C5 | 频道+模型元数据覆盖 |
| D | Renderer 版本同步 |
| E | hydration 幂等守卫移除 |
| F | 跨渠道防护（已被 H 替代） |
| G | CLAUDE_CONFIG_DIR 无条件覆盖 |
| H v2 | 跨渠道/跨 provider 完整修复 |
| I | 禁用更新检查 |
| J | AppUserModelId 动态隔离 |
| K | userData 路径动态化 |

### Q2 前置发现

| 项目 | 状态 | 影响 |
|------|------|------|
| index.html 补丁 | ❌ 从未打过 | Q2 需首次注入 script/css 引用 |
| IPC handler 注册模式 | ✅ 已摸清 | 可复用 main.cjs 末尾注入点 |
| 会话导航 API | ❌ 不存在 | 需新建 agent:navigate-session push 通道 |
| preload bridge 模式 | ✅ 可复用 | 仿照 agent:title-updated 推送模式 |
| 下一个补丁编号 | **补丁 L** | 沿用 A→K 递增惯例 |

### 导航 API 技术风险

会话导航需从 main 进程 push 到 renderer 触发 React 状态变更，需要：
1. main.cjs 新增 push channel（补丁 L-1）
2. preload.cjs 暴露 onNavigateSession 监听器（补丁 L-2）
3. renderer JS bundle 注入订阅逻辑（补丁 L-3）

v0.1 MVP 可先用"复制 session_id 到剪贴板"作为 fallback，点击节点后在侧边栏手动搜索跳转。

---

## 六、Q1+Q2 实施起点

### Q1 需改 tree-state.js

| 变更 | 类型 | 预估行数 |
|------|------|---------|
| ROLE_ENUM 常量 + 校验 | 新增 | ~3 行 |
| added_by 字段 | 新增 | ~2 行 |
| E_CHILDREN_NOT_DONE 错误码 | 新增 | ~1 行 |
| set-status 子节点检查 | 新增 | ~20 行 |
| migrate 子命令 | 新增 | ~50 行 |

### Q2 需新建/改的文件

| 文件 | 类型 | 预估行数 |
|------|------|---------|
| proma-tree-view.js | 新建 | ~250 行 |
| proma-tree-view.css | 新建 | ~100 行 |
| index.html sed 注入 | 修改 | ~3 行 |
| main.cjs IPC handler (补丁 L) | 修改 | ~40 行 |
| preload.cjs bridge (补丁 L-2) | 修改 | ~15 行 |

### 方法论文档变更

| 文件 | 变更 |
|------|------|
| commander-methodology.md | 新增 Leaf Purity 原则 + 分布式写入原则 |
| tree-commander-design.md | role 枚举 spec + 修订历史 |

---

## 七、优先级建议

```
P0 (阻塞 v0.2):
  1. Q1 实施 (role枚举 → E_CHILDREN_NOT_DONE → migrate → S1验证)
  2. S2 测试执行 (至少命令行部分)
  3. v0.2 审计报告 (审计 SESSION1 产出)

P1 (v0.2 发布后):
  4. Q2 v0.1 MVP (树形面板 + 复制session_id fallback)
  5. S2/S4/S5 修复或明确接受

P2 (v0.3+):
  6. Q2 v0.2 (真正导航 + 多tree切换 + 动画)
  7. T1-T4 轻微问题
  8. 竹节交接 / 灾难恢复
```
