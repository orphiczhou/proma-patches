# A+B+C 加固：实测 + 独立审计（systest3）

> 测试员：pro/cfe822d2 | 审计员：pro/8aa6742c | 日期 2026-07-23
> 测试树：systest3（A+B+C 验证专用）

## A+B+C 实测（abc-verify）

| 步骤 | 操作 | 结果 |
|---|---|---|
| 6 | milestone_add(M1, expect_outputs=[]) | **E_DELIVERABLE_MISSING** + msg "expect_outputs must not be empty" ✅ A 生效 |
| 7 | milestone_add(M1, expect_outputs=["r3.md"]) | ok（非空通过）|
| 8 | milestone_update(M1, desc="已更新描述") | **ok** ✅ C 生效（改 desc）|
| 9 | milestone_update(M1, expect_outputs=["r3.md","extra.md"]) | **ok** ✅ C 生效（改 expect_outputs）|
| 10 | leaf_get → M1 落盘 | desc="已更新描述"、expect_outputs=["r3.md","extra.md"] ✅ C 改动持久化 |
| 11 | validate | ok, 0 issues |

**A 生效**：空 expect_outputs 被引擎硬拦（E_DELIVERABLE_MISSING）。
**C 生效**：milestone_update 合法改 desc/expect_outputs，落盘确认。
**B**：正常流程不命中（A 已堵入口，构造不出空 milestone 去 set-result）——纵深兜底，静态在位。

## 独立审计（abc-audit，verdict: pass）

### 部署核验（dist 落盘，5/5）
| 加固 | 位置 | 核验 |
|---|---|---|
| C cmdMilestoneUpdate | tree-engine.cjs:2209 | ✅ |
| C dispatch case 'update' | tree-engine.cjs:5185 | ✅ |
| A 空 expect_outputs 拒绝 | tree-engine.cjs:2070-2072 | ✅ |
| B set-result 空拒绝 | tree-engine.cjs:2163-2169 | ✅ |
| C tree_milestone_update 工具 | patches.cjs:426 | ✅ |

### systest3 证据链（call-log + tree_dump 交叉）
- A：`milestone-add` 空 → ok:false, E_DELIVERABLE_MISSING，msg 与 dist A 校验文案 **1:1 一致**。
- C：`milestone-add` 非空 ok → `milestone-update` ok ×2 → tree_dump M1 desc/expect_outputs 落盘自洽。
- 端到端贯通。

### 零文件手术核验
write_count=7，call-log 成功写操作=7（init+plan+register+leaf_add+milestone_add非空+update×2），**7=7 精确自洽**。被拒的空 add 正确未计写盘（校验阶段拦截）；3 次读不计。**无引擎外 tree-state.json 直接编辑痕迹**——M1 改动确由 milestone-update 走引擎接口完成。

### 收敛判定
> **CONVERGED。verdict: pass。**

A+B+C 真实部署生效 + 端到端自洽：A 拦入口（实测）、C 给合法 update 路径（实测+落盘）、write_count 7=7 证零文件手术。"空 expect_outputs 需文件手术修复"缺口已闭合（A 堵入口 + C 合法修复 + B 纵深兜底）。

**1 条 yellow（非阻断）**：B 仅有静态代码证据（systest3 未走到 set-result），建议后续补 `set-result(audit_pass=true, 空expect_outputs)` 动态拒绝用例，把 B 从"静态在位"升级为"端到端实测"。
