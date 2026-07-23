# 观察员完整报告：mltest 多层树核验

> 观察员会话：pro/9ab51ee1 | 日期 2026-07-24 | 只读核验
> 数据源：tree_tree_dump + call-log.jsonl(86行) + deliverables/ + 6 个 auto backup

## 核验项 1 — 结构（tree_tree_dump）

| 子项 | 观察值 | 结论 |
|---|---|---|
| (a) 7 leaf | mltest-root + A/B-commander + A1/A2/B1/B2-worker | ✅ 恰好 7 |
| (b) parent 链 | root←{A,B}-cmd；A-cmd←{A1,A2}；B-cmd←{B1,B2} | ✅ 3 层，每节点 2 分支 |
| (c) status+gate | 7/7 done；7/7 audit_gate=pass（root auto_upgrade） | ✅ |
| (d) 单一 auditor | 7 gate + 7 milestone = 14 处 auditor_session_id 全=R | ✅ 冷启动锚定 |

## 核验项 2 — caller 委派语义（call-log 86 行）

caller 分布：R×42 / Acmd×7 / Bcmd×7 / A1×4 / A2×4 / B1×4 / B2×4 / null×12(系统只读) / 观察员×2(只读)。

| 操作 | 预期 caller | 实测 | 结论 |
|---|---|---|---|
| leaf_add(A/B-commander) | R | R×2 | ✅ |
| leaf_add(A1/A2) | Acmd | Acmd×2 | ✅ |
| leaf_add(B1/B2) | Bcmd | Bcmd×2 | ✅ |
| milestone_add | R→{root,A/B-cmd}；Acmd→{A1,A2}；Bcmd→{B1,B2} | 完全吻合 | ✅ |
| milestone_set_result(7) | 全 R | R×7 | ✅ |
| audit_gate(6) | 全 R | R×6（root auto_upgrade） | ✅ |
| set-status=done | 节点自调 | 各节点自调自己 | ✅ |
| event done + 首次 brief_echo | 节点自调 | worker/commander 各自调 | ✅ |
| event brief_echo(alignment) | R 回填 | 6 个全=R（V5b 设计） | ✅ |

**越权/代调检测**：added_by（tree-state）与 caller_session_id（call-log）双向一致；session_registry.caller 完整记录 create_session 真实调用者（R→Acmd/Bcmd→workers）。**无越权、无代调伪装**。

观察员痕迹：9ab51ee1 出现 2 次（dump + list-all），均 read_only=true，零写。

## 核验项 3 — 零文件手术

| 子项 | 观察值 | 结论 |
|---|---|---|
| write_count vs call-log | write_count=60；call-log 成功写（ok=true ∧ read_only=false）=60 | ✅ 严格相等 |
| 失败/只读分类 | 失败写=6，只读=20，总写(含失败)=66（60+6） | ✅ |
| 引擎外编辑 | diff(最后 backup, tree-state.json) = 字节级 IDENTICAL | ✅ 无外部修改 |
| mtime | tree-state(00:43:56) < call-log(00:45:17)，差额=观察员只读追加 | ✅ |

## 核验项 4 — A+B+C 生效证据

**A 门禁铁证**（deliverable 物理落盘）：4 worker 首次 set-status=done 全部被 E_DELIVERABLE_MISSING 拒（ml-report.md not found）。落盘时序：
```
00:37~00:38  worker 试 done → E_DELIVERABLE_MISSING 拒（4 次）
00:40:04     deliverables/ml-report.md 落盘（581B，内容真实）
00:40:17  A1 done 成功   ← 落盘后 13s 放行
00:40:36  A2 done 成功
00:40:48  B1 done 成功
00:40:59  B2 done 成功
00:42:52  A-cmd done    （层级归并）
00:43:00  B-cmd done
00:43:56  root done     （最后归并）
```
7 个 set-status=done 成功全部晚于 ml-report 落盘；event:done（不受门禁）可在落盘前记录 → A 门禁在 set-status 层真实硬拦截。

**额外门禁链**：root 触发 E_SCHEMA_INVALID×2（① milestones must be non-empty ② M1 is not audit_pass=true）→ done 硬门禁链完整（milestone 非空 + audit_pass + deliverable 落盘）。

**B 规则**（V3 非空 expect_outputs）：7 次 milestone-add 全 ok=true，每行 milestone_keys 含 expect_outputs，tree-state 中 7 个 milestone expect_outputs=["ml-report.md"] 非空 → 无 1 例因空被拒。

**C 规则**（milestone_update 可用）：call-log milestone-update 调用=0。指挥官建 milestone 时已直接给非空，未触发 V3 拒绝，故 C 无需调用 → C 可用但未触发，恰好证明遵循 A+B+C。

## 一句话总评

> **真实跑通，无伪造**：7 leaf/3 层/每节点 2 分支结构属实；harness 三级委派（R→A/B→4 workers）caller 语义全链路自洽；冷启动单一 auditor R 贯穿 14 审计点；A 门禁以 4 次 E_DELIVERABLE_MISSING 拒绝 + 落盘后放行的时序铁证真实生效，B 被遵循、C 可用未触发；write_count=60 与 call-log 严格相等、最后 backup 与 state 字节级一致 → 零文件手术，无越权、无代调伪装、无引擎外编辑。
