# P1-1: Worker progress 实时反映 — 实施与审计结果

> 日期：2026-07-24 | 接力第三棒 | design.md 同目录

## 1. 实施摘要

### 1.1 引擎改动：tree-engine.cjs

**(a) EVENT_TYPE_ENUM 新增 `progress`**（L79）：10 → 11 种。worker 可主动报中间进度，不强制 schema（轻量），不触发状态转换。

**(b) cmdEventAppend brief_echo 自动转 active**（L2655 后，约 L2660）：
```js
if (opts.type === 'brief_echo' && leaf.role === 'worker' && leaf.status === 'pending_brief') {
  leaf.status = 'active';
}
```
worker 写首条 brief_echo（复述理解）时，status 自动 `pending_brief → active`。解决状态滞后。三条件保证幂等 + 角色隔离 + 类型隔离。

**(c) help 文本同步**（L5130）：EVENT_TYPE_ENUM 数量 10 → 11，列表加 progress。

### 1.2 文档改动：skills/tree-commander/SKILL.md（v2.7 → v2.8）

1. **§6 事件路由表加 progress 行** + **brief_echo 状态联动段**（引擎自动转 active 说明）+ **progress event 用法段**（worker 端 meta 示例）。
2. **§5 event_list 描述**：类型数 8 → 11（同步修正历史 stale 计数，补全 review_round/subagent_spawn/progress）。
3. **§15 修订历史 v2.8**。

## 2. 部署

| 目标 | 状态 |
|------|------|
| source tree-engine.cjs | node --check OK |
| dev/pro dist | cp + node --check OK + diff identical |
| dev/pro 实例 | restart-{dev,pro}.ps1 (ISOLATED=1) LAUNCHED |
| SKILL.md v2.8 | 已改（加载即生效） |

## 3. 单测结果

**脚本**：`pr/20260724-worker-progress/test-p11.cjs`（5 用例 12 子用例）

```
[A] worker brief_echo 自动转 active          3 PASS
[B] commander brief_echo 不变                 2 PASS
[C] 幂等：第二条 brief_echo 不改 status        3 PASS（alignment 回填 + status 幂等 + alignment_pending 清除）
[D] progress event append                    2 PASS
[E] done event 不自动转 done                  2 PASS
=== 12 passed, 0 failed ===
```

**回归**：P0-1（17/17）+ P1-3（16/16）同步复跑零回归。

## 4. 独立审计

**审计员**：独立子会话（release 本地，DeepSeek-V4-Pro，session=36a2ef7b）
**Verdict**：**PASS**

审计结论：
- brief_echo 转 active 正确性 PASS：三条件（type/role/status）完备，type 隔离保证 done/blocked 不会误触发；幂等性实证（用例 C）。
- 不破坏 done 路径 PASS：P1-1 代码在 P0-1 注释块之前，只做 pending_brief→active，绝不碰 status=done；cmdLeafSetStatus 仍是 done 唯一入口，8 道门禁不受影响。
- progress event 设计 PASS：只加枚举不强制 schema 合理（引擎不当 schema police，约定 step 必填优于强制）；滥用风险低（不过闸门、可追溯、commander 巡检可发现）。
- 文档一致性 PASS：引擎 help L5130 + SKILL §5/§6/§15 全部同步；指出 §5 历史 stale（8 是漏更 subagent_spawn 等），本次一并修正为 11。
- 回归风险 PASS：alignment 校验（L2376）/ alignment_pending 流程（L2389）/ cmdAuditGate 不依赖 status；`pending_brief→active` 转换在 STATUS_TRANSITIONS 白名单内。
- 单测 PASS：12/12 绿；边界（auditor brief_echo / done leaf 写 brief_echo / progress 空 meta）均论证无风险。

## 5. 后续观察点

- **progress schema 强化**：审计建议观察实战滥用模式后再决定是否加最小 schema（如 step 非空）。当前不强制。
- macp 类实战再跑时，确认 worker brief_echo 后 status 即时转 active，commander 心跳不再误判"worker 没动"。

## 6. 交付物

- `D:/Codes/tree-harness/tree-engine.cjs`（EVENT_TYPE_ENUM +progress + cmdEventAppend brief_echo→active）
- `D:/Codes/tree-harness/pr/20260724-worker-progress/{design.md, results.md, test-p11.cjs}`
- `C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md`（v2.8）
