# P0-1: Commander 委派协议（解决星形退化）— 实施与审计结果

> 日期：2026-07-24 | 接力第三棒 | design.md 同目录

## 1. 实施摘要

### 1.1 引擎改动：tree-engine.cjs cmdLeafAdd

**位置**：`cmdLeafAdd` 函数内，leaf 对象组装 → writeState → result 返回段（约 L1219-1250）。

**改动**：
1. leaf 对象新增 `delegation_hint: null` 字段（初始 null，向后兼容旧 leaf）。
2. 在 `state.leaves[leaf_id] = leaf` 之前，检查星形退化条件：
   - `parent.role === 'root'`（parent 是 root leaf）
   - `role === 'worker'`（当前 add 的是 worker）
   - 树中存在 ≥1 个 active commander（`role==='commander' && status!=='archived' && status!=='pruned' && leaf_id!==当前`）
3. 满足时：`leaf.delegation_hint = 'star_degradation_warned'` + `result.warnings = [{code:'W_STAR_DEGRADATION', message, suggestion, active_commanders}]`。
4. **不 throw**（软约束，单层树/应急接管场景合法）。

### 1.2 文档改动：skills/tree-commander/SKILL.md（v2.6 → v2.7）

1. **§4 Step 2.1 新增「层级委派协议」**：root→commander→worker 三分规则表 + 越级反模式（正/误对比）+ 例外（单层树 / 应急接管）。
2. **§11 禁止行为新增第 14 条**：root 越级 leaf_add worker（已有 active commander 时）→ 星形退化。
3. **§15 修订历史新增 v2.7 条目**（2026-07-24）。

## 2. 部署

| 目标 | 路径 | 状态 |
|------|------|------|
| source | D:/Codes/tree-harness/tree-engine.cjs | 已改 + node --check OK |
| dev/pro dist | D:/Proma-dev/resources/app/dist/tree-engine.cjs | 已 cp（diff 确认 identical）+ node --check OK |
| dev 实例 | restart-dev.ps1 (ISOLATED=1) | LAUNCHED |
| pro 实例 | restart-pro.ps1 (ISOLATED=1) | LAUNCHED |
| SKILL.md | 工作区 skills/（Proma 加载即生效，无需部署 dist） | 已改 |

## 3. 单测结果

**脚本**：`pr/20260724-commander-delegation-protocol/test-p01.cjs`（5 用例 17 子用例）

```
[A] root 已有 active commander 时越级 add worker     6 PASS（触发 W_STAR_DEGRADATION + delegation_hint + active_commanders）
[B] worker 挂 commander 下（正常层级）              3 PASS（无 warning）
[C] 单层树 root 直辖 worker（无 commander）          2 PASS（无 warning）
[D] commander archived 后 root 越级                 3 PASS（无 warning）
[E] commander pruned 后 root 越级                   3 PASS（无 warning，补审计微瑕）
=== 17 passed, 0 failed ===
```

覆盖：触发条件正向（A）+ 三种不触发反向（B 正常层级 / C 单层树 / D-E commander 失活）。

## 4. 独立审计

**审计员**：独立子会话（release 本地，DeepSeek-V4-Pro，session=74b5b747）
**Verdict**：**PASS**

审计结论摘要：
- 代码正确性 PASS：三与条件完备，null guard / archived·pruned 排除 / role 短路均正确。
- 向后兼容 PASS：`result.warnings` 与 `delegation_hint` 全引擎无旧消费方（grep 确认仅新增代码引用），旧 leaf 读 delegation_hint 返回 undefined 等价"未触发"。
- 软约束 vs 硬约束 PASS：星形退化属"判断性建议"非"确定性错误"，不拦死 + 事后可追溯（delegation_hint）设计正确。单层树/应急接管合法路径不误伤。
- 文档完整性 PASS：§4 Step2.1 / §11#14 / §15 v2.7 三处与引擎行为精确一致。
- 回归风险 PASS：commander 正常 add / root 直辖单层 / 加 commander / 加 auditor 四路径均不误触发。
- 单测充分性 PASS：14/14 绿（审计时）；审计指出 pruned 场景未覆盖（非阻塞）→ 已补用例 E，现 17/17 绿。

## 5. 后续观察点

- macp 类实战再跑时，确认 root 收到 W_STAR_DEGRADATION 后是否会改走 commander 下发（行为改变实测）。
- 若实战中 warning 频繁触发且都属于合法越权（如 commander 全宕），考虑在 SKILL 补"批量应急"指引。

## 6. 交付物

- `D:/Codes/tree-harness/tree-engine.cjs`（cmdLeafAdd 软约束）
- `D:/Codes/tree-harness/pr/20260724-commander-delegation-protocol/{design.md, results.md, test-p01.cjs}`
- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.7，§4 Step2.1 / §11#14 / §15）
