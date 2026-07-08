# Tree Harness 硬约束效率调研 · 产出全集

> **打包日期**：2026-07-08 21:01
> **位置**：`D:/codes/tree-harness/research-2026-07-harness-efficiency/`
> **性质**：本目录是本次调研的全部产出汇总，独立于 `.context/` 维护约定，方便外部引用与归档
> **来源镜像**：
>   - 调研报告 + audit response + 任务书：`.context/active/`（活跃）+ `.context/archive/2026-07-harness-efficiency-research/`（归档）
>   - NR5 设计：`.context/active/auditor-role-trust-anchor-design-2026-07-08.md`（待实施）

---

## 文件清单（按阅读顺序）

| # | 文件 | 角色 | 大小 | 阅读优先级 |
|---|------|------|------|----------|
| 1 | `research-brief-harness-efficiency-2026-07-08.md` | 任务书（发起人原始假设 + 评估对象 + 证据来源） | 7 KB | ⭐⭐⭐ 必读 |
| 2 | `harness-efficiency-research-report-2026-07-08.md` | **调研报告 v3 定稿**（720 行） | 63 KB | ⭐⭐⭐ 必读 |
| 3 | `harness-efficiency-research-audit-response-2026-07-08.md` | 一轮审计响应（12 red 详解 + 修复计划） | 18 KB | ⭐⭐ 推荐读 |
| 4 | `harness-efficiency-research-audit-response-v2-2026-07-08.md` | 二轮审计响应（5 新 red + 修复对照） | 11 KB | ⭐⭐ 推荐读 |
| 5 | `auditor-role-trust-anchor-design-2026-07-08.md` | NR5 立项：auditor role 信任锚协议子设计（P0-pre） | 12 KB | ⭐ 选读 |
| 6 | `archive-readme.md` | 归档目录原 README（时间线 + 落地路线图） | 3 KB | 参考 |

---

## 核心结论（v3 定稿）

**基于一手证据 + 两轮 5 视角独立审计**：

1. **硬约束机制存在系统性设计缺陷**——约半数约束防护价值成立（caller-binding / milestone / §13 / V10），其余（audit_gate V4 / TaoWatcher / 预算护栏）需要重设计或价值验证
2. **V4 在 auditor role 缺位时硬启动本身就是设计层问题**（不只是配套缺失）
3. **TaoWatcher 在 auditor role 错配场景下零防护价值**（macp4-A4 单点证据，未做正负案例推广）
4. **3 个覆盖盲区**：SDK 侧会话爆炸 / status/timing 观测差 / 数值收敛 ≠ 内容收敛
5. **三类 workaround 设计缺陷**：SKILL 模糊 + role 类型缺失 + 配套缺失

---

## 调研时间线

| 时刻 | 事件 |
|------|------|
| 19:01 | 调研员接收任务书，开始一手证据收集 |
| 19:30 | v1 报告完成（580 行） |
| 19:35 | 一轮 5 视角独立审计派生（G1-G5） |
| 19:55 | 一轮审计响应：揭示 12 个 red |
| 20:00 | 计划 A 修复启动（v1 → v2） |
| 20:25 | v2 报告完成（720 行） |
| 20:30 | 二轮 5 视角独立审计派生（G1'-G5'） |
| 20:35 | 二轮审计响应：11/12 一轮 red 修复，引入 5 新 red |
| 20:45 | v3 定稿（修 NR1-NR4，NR5 立项） |
| 21:01 | 本目录打包 |

---

## 落地路线图

```
P0-pre: auditor-role-trust-anchor-design 评审 + 定稿（NR5 已立项）
   ↓
P0a: 引入 auditor role（engine ~500-700 行 + SKILL §13 整章重写 ~300-500 行 + 测试 + 数据迁移 = 总计 ~1000-1500 行 + 文档）
   ↓
P0b: TaoWatcher 收窄（基于 P0a 后规则按 role 适配，改 tao-rules.json + patches.cjs ×4 副本 + SKILL）
   ↓
P1a/P1b 并行: 撞墙 escalate (error_hash) / fix_evidence（需先改 review_round schema 加 finding_id）
   ↓
P2'/P2: cooldown / rvreq2 playbook（仅 ≤2-worker 场景）
   ↓
P3+: SDK 爆炸检测（跨 Proma SDK 仓需求）
```

---

## 引用方式

- **报告路径**（绝对路径）：`D:/codes/tree-harness/research-2026-07-harness-efficiency/harness-efficiency-research-report-2026-07-08.md`
- **本目录**（外部引用入口）：`D:/codes/tree-harness/research-2026-07-harness-efficiency/`
- **.context 内镜像**（按维护约定）：
  - `.context/active/` —— 5 个调研文件（活跃，NR5 设计 + 报告 + audit response ×2 + 任务书）
  - `.context/archive/2026-07-harness-efficiency-research/` —— 归档（含 README + 4 个核心文件）

---

## 备注

- 本目录与 `.context/` 内的文件**内容完全一致**，是同一份产出的两份拷贝
- 如有修订，**以 `.context/active/` 为准**（active 是工作目录，本目录是打包快照）
- 如需引用本次调研，建议引用本目录路径（更稳定，不参与 .context 维护）
