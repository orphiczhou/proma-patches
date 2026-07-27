# macp10 项目层缺陷3/4 + C1 权威复评 — 实施结果

> 日期：2026-07-27（21:00 派 → 22:03 root done）
> 树：pro 实例 `macp10`（6 leaves，全 done）
> 指挥官：e5c0c063（GLM-5.2 ZLM cbb12a0b）
> auditor：cb05aadd（MiniMax-M3 b7e25505，异厂商独立签字）
> 模式：§13.3b 多层级 done SKILL v2.9.7

## 0. TL;DR

- **缺陷3 runGwt 假修复** ✅ 真修（applyGwtAutofixPatch 三道路径安全 + patchError break + 探针 2/2）— MiniMax-M3 verdict=**pass**（2 yellow）
- **缺陷4 evaluateCode 假通过** ✅ 真修（codeDir/classDiagramPath 缺失拦截 + verdict=null + isCodeDirEmpty helper + 探针 5/5）— verdict=**pass_with_minor**（1 yellow）
- **§13.3b 多层级 done 协议** ✅ 零 V10 撞击实战验证（auditor 兄弟挂 root + commander 用 root 代调 milestone_set_result + commander done 不需 audit_gate 代调）
- **C1 权威复评** = **79/100**（MiniMax-M3 异厂商独立签字，未达 85+ 目标 6 分，诚实标注拖分项 → macp11 收口）

## 1. 树结构与执行

```
macp10-root (GLM-5.2, 你)         ← status=done 22:03
├── macp10-R-commander (GLM-5.2)  ← done 21:37 (修缺陷3)
│   └── macp10-R1-worker (GLM-5.2) ← done 21:23
├── macp10-E-commander (GLM-5.2)  ← done 21:35 (修缺陷4)
│   └── macp10-E1-worker (GLM-5.2) ← done 21:19
└── macp10-X-auditor (MiniMax-M3) ← done 21:51 (异厂商独立)
```

- 全 6 leaves done，milestones 全 audit_pass=true（root 代调 per §13.3b）
- 总跨度：~66 分钟（20:57 tree_init → 22:03 root done）
- 异厂商审计员 MiniMax-M3 破 GLM 同款偏差（macp2 教训：GLM 自评 70 → MiniMax 下调 47）

## 2. C1 评分（X-c1-revote.md 节选）

| 维度 | 满分 | macp3 (MiniMax 基线) | macp6 (GLM 估) | **macp10 (MiniMax 复评)** |
|------|----:|---:|---:|---:|
| 可运行性 | 10 | 8 | 9 | **9** |
| Sandbox | 10 | 6 | 6 | **6** |
| Snapshot | 10 | 9 | 9 | **9** |
| Coder 业务逻辑 | 15 | 11 | 13 | **15** ⬆ |
| Judge 业务逻辑 | 15 | 11 | 13 | **13** |
| LLM 基础设施 | 12 | 8 | 11 | **11** |
| Electron IPC | 10 | 5 | 5 | **5** |
| 自动化测试 | 8 | 6 | 6 | **7** ⬆ |
| 端到端 | 10 | 4 | 4 | **4** |
| **总计** | **100** | **68** | **76** | **79** |

vs macp6 GLM 估 76：+3（缺陷3 回收 +2 Coder / 自动化测试 +1）；缺陷4 回收被 featuresMissingSteps 残留 -2 抵消（Judge 业务持平 13）。

## 3. 3 条 yellow findings（非阻断，macp11 P1 清）

| ID | leaf | 问题 | 修复建议 |
|----|------|------|---------|
| F-R1-Y1 | R1 | `match[2].replace(/^\r?\n/, '')` 仅剥首换行；LLM 偏离 prompt 单行 `<<<CONTENT>>>content` 时首字符被吞 | 改 strip 标记行 / 加 log 警告 |
| F-R1-Y2 | R1 | `appliedFiles` 数组未透传 `AutofixLogEntry`（types.ts 无该字段） | 加可选字段 + push 时透传 |
| F-E1-Y1 | E1 | E-fix-report §5 引用 `probe/E1-probe.cjs` 当时未落盘（**注：22:10 核验已存在**，auditor 21:44 检查时序问题） | worker 探针先落盘再写报告 |

无 red finding（CWE-22/59/73 安全维度全过）。

## 4. harness 改进实战验证（macp7-9 全 PASS）

| 改进项 | macp10 实战证据 |
|-------|---------------|
| §13.3b 多层级 done 接力协议 | ✅ root 代调 milestone_set_result 全 pass；commander done 直接放行（角色 audit_gate=skip 初始）；零 E_BORROWED_IDENTITY / E_AUDITOR_NOT_INDEPENDENT |
| audit_log schema severity v0.21 | ✅ auditor 写 results[] 每项带 severity ∈ {red\|yellow\|green}，零 E_SCHEMA_INVALID |
| auditor ≥2 events | ✅ X-auditor 3 events（brief_echo×2 + done） |
| idle 多维核验 | ✅ 无 leaf 误判 prune（macp6 J 教训规避） |
| emergent v2 协作教化 | ✅ N/A（macp10 无 v2 接力，纯 §13.3b 三层） |

**结论**：macp7-9 SKILL v2.9.7 + 引擎 v0.21 在真实多层级项目实战全 PASS。

## 5. macp11 收口路线（推 C1 → 85+）

按 X-c1-revote §2.2 拖分项 + §5.2 建议：

| 优先级 | 修复项 | 维度回收 | 目标分 |
|-------|-------|--------|------|
| **P0** | featuresMissingSteps 参与 verdict（runGwtExistenceCheck） | Judge +2 | 81 |
| **P0** | judge 占位 16→<5（hard checks 9 + soft eval 4 维补全） | LLM 基础设施 +1 | 82 |
| **P0** | 1 个真系统 E2E（renderer→IPC→真引擎→LLM mock） | 端到端 +4-6 | 86-88 ✅ |
| P1 | F-R1-Y2 appliedFiles 透传 + F-E1-Y1 探针落盘时序 | 清 yellow | — |

理论可达 **86-88**，超 85+ 目标。

## 6. 交付物清单

| 文件 | 内容 |
|------|------|
| `R-fix-report.md` / `.note.md` | R1-worker 缺陷3 修复报告 + 决策记录 |
| `E-fix-report.md` / `.note.md` | E1-worker 缺陷4 修复报告 + 决策记录 |
| `X-audit-R1.md` | R1 异厂商独立审查（verdict=pass，2 yellow） |
| `X-audit-E1.md` | E1 异厂商独立审查（verdict=pass_with_minor，1 yellow） |
| `X-c1-revote.md` | macp10 综合 C1=79/100 复评（MiniMax-M3 签字） |
| `results.md`（本文件） | 归档总结 |

## 7. 后续

- **macp11**（本轮派出）：综合实战 + 攻 3 拖分项推 C1→85+ + 清 3 yellow + harness 完成度评估
- **macp12**（buffer）：若 macp11 E2E 未收敛，buffer 用
- 终止条件检查清单（harness 完成标准 7 项）：1-3, 5-6 ✅；4（项目层 + C1 85+）部分（缺陷1-4 全修 ✅，C1=79 待 macp11）；7（终版归档）待 macp11 后写 `pr/20260728-harness-final/`
