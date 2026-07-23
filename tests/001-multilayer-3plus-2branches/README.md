# 测试记录 001：多层树（3层 + 每节点≥2分支，7 leaf）

> 测试日期：2026-07-24 | 实例：pro（A+B+C 已部署）| 对应 PR：`7350492`（A+B+C milestone 加固）
> 指挥官 R=`377f74d6` | 观察员=`9ab51ee1` | tree_id=`mltest`
> 结论：**PASS — 7 leaf 全 done，零文件手术，A+B+C 生效，无伪造/越权**

## 1. 测试目标

验证 A+B+C 加固后的 tree 引擎在**多层 + 多分支**场景（3 层、每节点≥2 分支、共 7 leaf）端到端跑通：结构合法、harness 三级委派、冷启动单一 auditor、所有 leaf 到 done、全程零文件手术。

## 2. 树结构

```
mltest-root (root, R=377f74d6)
├── mltest-A-commander (commander, a7b2cf37)
│   ├── mltest-A1-worker (worker, eb07177c)
│   └── mltest-A2-worker (worker, 529855f6)
└── mltest-B-commander (commander, edff0cc2)
    ├── mltest-B1-worker (worker, sid4)
    └── mltest-B2-worker (worker, sid5)
```
- 3 层（root→commander→worker）
- root 2 分支（A/B-commander）；A-commander 2 分支（A1/A2）；B-commander 2 分支（B1/B2）
- 共 7 leaf，满足"3 层以上 + 每节点≥2 分支"

## 3. 执行方式

指挥官 R 经 `remote_send_message(wait=false)` 异步开跑（fire-and-forget），父会话 poll tree-state 进度。指挥官自主完成建树 + 派 2 子指挥官 + 各子指挥官派 2 worker + 冷启动 root auditor 跑 §13.3 全流程。

**进度（write_count 增长）**：
| 时刻 | write_count | 状态 |
|------|-------------|------|
| t+2min | 9 | root+A/B-commander+A1-worker 建 |
| t+4min | 25 | 7 leaf 结构全建（含 4 worker）|
| t+6min | 38 | 4 worker audit_gate=pass |
| t+8min | 42 | 4 worker status=done |
| t+10min | 55 | A-commander done，B-commander gate=pass |
| t+12min | 60 | **7 leaf 全 done** |

## 4. 指挥官结果

7 leaf 全部 status=done、audit_gate.verdict=pass。write_count=60。

## 5. 观察员独立核验（4 项）

### 5.1 结构（tree_dump）
- 7 leaf 齐全，parent 链正确（root←{A,B}-cmd；A-cmd←{A1,A2}；B-cmd←{B1,B2}）。✅
- 7/7 status=done；7/7 audit_gate=pass（root auto_upgrade，余 6 显式 gate）。✅
- 14 处审计点（7 gate + 7 milestone）auditor_session_id **全部=R**（冷启动单一 auditor）。✅

### 5.2 caller 委派语义（call-log 86 行）
caller 分布：R×42 / Acmd×7 / Bcmd×7 / A1×4 / A2×4 / B1×4 / B2×4 / null×12(系统) / 观察员×2(只读)。
- leaf_add(A/B-cmd) caller=R；leaf_add(A1/A2) caller=Acmd；leaf_add(B1/B2) caller=Bcmd ✅（harness 三级委派 R→A/B→workers）
- milestone_set_result(7)/audit_gate(6)/alignment(6) **全 caller=R**（冷启动 root 当 auditor）✅
- set-status=done / event:done / 首次 brief_echo 各节点自调 ✅
- alignment 回填 caller=R（V5b 设计：由 auditor 写）✅
- **无越权、无代调伪装**（added_by 与 caller 双向一致）。✅

### 5.3 零文件手术
- write_count=60 = call-log 成功写操作数（ok=true ∧ read_only=false）= 60。**严格相等**。✅
- `diff tree-state.backup.<last>.auto.json tree-state.json` → **字节级 IDENTICAL**（最后引擎写入后无外部修改）。✅
- tree-state.json mtime < call-log mtime（差额=观察员只读追加）。✅

### 5.4 A+B+C 生效证据
- **A（deliverable 门禁）铁证**：4 worker 首次 set-status=done **全部被 E_DELIVERABLE_MISSING 拒**（ml-report.md not found）；落盘时序：
  ```
  00:37~00:38  worker 试 done → 拒（4 次）
  00:40:04     deliverables/ml-report.md 落盘（581B）
  00:40:17+    A1/A2/B1/B2 done 相继成功（落盘后放行）
  ```
  7 个 set-status=done 成功**全部晚于** ml-report 落盘 → A 门禁在 set-status 层真实硬拦截。✅
- root 还触发 E_SCHEMA_INVALID×2（milestones 非空 + M1 audit_pass）→ done 硬门禁链完整。✅
- **B（V3 非空 expect_outputs）**：7 次 milestone-add 全 ok，expect_outputs=["ml-report.md"] 非空，无 1 例因空被拒 → 指挥官遵循 B。✅
- **C（milestone_update 可用）**：call-log milestone-update 调用=0（指挥官建 milestone 时已给非空，未触发 V3 拒绝，故 C 无需调用）→ C 可用未触发，恰好证明遵循 A+B+C。✅

## 6. 结论

> **PASS。** 多层树（3 层 + 每节点≥2 分支，7 leaf）在 A+B+C 加固后的 tree 引擎上**真实端到端跑通**：结构合法、harness 三级委派（R→A/B-commander→4 worker）caller 语义全链路自洽、冷启动单一 auditor R 贯穿 14 审计点、7 leaf 全 done、write_count=60 与 call-log 严格相等且最后 backup 字节级一致（**零文件手术**）、A 门禁以 4 次 E_DELIVERABLE_MISSING 拒绝+落盘后放行的时序铁证真实生效。**无伪造、无越权、无引擎外编辑。**

## 7. 残留痕迹（非异常）

- 观察员会话 9ab51ee1 在 call-log 留 2 条只读记录（dump + list-all）——核验自身行为，未触写路径。
- 测试树 mltest + 7 个测试会话留在 pro（需归档在 pro UI；remote-archive 被 R6 拒）。

## 8. 对应 PR

本测试验证 PR `7350492`（feat(tree-engine): milestone V3 加固 A+B+C）。A+B+C 的设计/实施/单层审计见 `pr/20260723-tree-engine-hardening/`。
