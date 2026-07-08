# 归档：Tree Harness 硬约束效率调研

> **归档日期**：2026-07-08
> **归档原因**：调研定稿（v3），转入实施阶段
> **相关 active 文档**：`active/auditor-role-trust-anchor-design-2026-07-08.md`（NR5 立项，待实施）

---

## 文件清单

| 文件 | 角色 | 行数 |
|------|------|------|
| `research-brief-harness-efficiency-2026-07-08.md` | 任务书（发起人原始假设 + 评估对象 + 证据来源） | 88 |
| `harness-efficiency-research-report-2026-07-08.md` | **调研报告 v3 定稿**（720 行） | 720 |
| `harness-efficiency-research-audit-response-2026-07-08.md` | 一轮审计响应（12 red 详解） | 240 |
| `harness-efficiency-research-audit-response-v2-2026-07-08.md` | 二轮审计响应（5 新 red + 修复对照） | 240 |

---

## 调研时间线

| 时刻 | 事件 |
|------|------|
| 2026-07-08 19:01 | 调研员接收任务书，开始一手证据收集 |
| 2026-07-08 19:30 | v1 报告完成（580 行） |
| 2026-07-08 19:35 | 一轮 5 视角独立审计（G1-G5）派生 |
| 2026-07-08 19:55 | 一轮审计响应：揭示 12 个 red（数据/完整性/推理/偏见/落地） |
| 2026-07-08 20:00 | 计划 A 修复启动（v1 → v2） |
| 2026-07-08 20:25 | v2 报告完成（720 行） |
| 2026-07-08 20:30 | 二轮 5 视角独立审计（G1'-G5'）派生 |
| 2026-07-08 20:35 | 二轮审计响应：11/12 一轮 red 修复，引入 5 新 red |
| 2026-07-08 20:45 | v3 定稿（修 NR1-NR4，NR5 立项） |
| 2026-07-08 20:48 | 归档到本目录 |

---

## 核心结论（v3 定稿）

**基于一手证据 + 两轮独立审计**：

1. **硬约束机制存在系统性设计缺陷**——约半数约束防护价值成立（caller-binding/milestone/§13/V10），其余（audit_gate V4/TaoWatcher/预算护栏）需要重设计或价值验证
2. **V4 在 auditor role 缺位时硬启动本身就是设计层问题**（不只是配套缺失）
3. **TaoWatcher 在 auditor 错配场景下零防护价值**（macp4-A4 单点证据）
4. **3 个覆盖盲区**：SDK 侧会话爆炸 / status/timing 观测差 / 数值收敛 ≠ 内容收敛
5. **三类 workaround 设计缺陷**：SKILL 模糊 + role 类型缺失 + 配套缺失

---

## 修复优先级（落地路线图）

详见 `harness-efficiency-research-report-2026-07-08.md` §9.4：

| 优先级 | 改动 | 依赖 |
|--------|------|------|
| **P0-pre** | auditor role 信任锚协议子设计（NR5） | `active/auditor-role-trust-anchor-design-2026-07-08.md` |
| **P0a** | 引入 auditor role（engine ~500-700 行 + SKILL §13 整章重写） | P0-pre 定稿 |
| **P0b** | TaoWatcher 收窄（基于 P0a 后规则按 role 适配） | P0a |
| **P1a** | 撞墙强制 escalate（error_hash 设计） | 独立 |
| **P1b** | self_check 加 fix_evidence（需先改 review_round schema 加 finding_id） | 独立 |
| **P2'** | status/timing cooldown（engine E_COOLDOWN_ACTIVE + patches.cjs 层） | 独立 |
| **P2** | rvreq2 诚实路径 playbook 固化（仅 ≤2-worker 场景） | P0a |
| **P3+** | SDK 会话爆炸检测（跨 Proma SDK 仓需求） | 跨仓 |

---

## 引用入口

- **PROJECT-INDEX.md 更新**：本目录应被 `D:/codes/tree-harness/.context/PROJECT-INDEX.md` 引用为"已完成调研"
- **CLAUDE.md 更新**：本调研揭示的 V4 设计层问题 + auditor role 缺位应记入 P0 教训
- **NR5 设计**：见 `active/auditor-role-trust-anchor-design-2026-07-08.md`（P0-pre，待评审）
