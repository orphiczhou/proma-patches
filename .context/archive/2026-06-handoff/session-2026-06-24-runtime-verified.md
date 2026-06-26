# 交接：v0.7+ 引擎内联 MCP — 运行时双实例验证完成（2026-06-24）

> 新会话从这里恢复 | 工作区: Proma改造探索 | 用户: 周星星
> 5 分钟恢复: 本文件 + PROJECT-INDEX.md + note.md

## 一句话状态
**tree 引擎内联 MCP 改造全部完成，dev + release 双实例运行时验证通过（27工具注册 + DbC 4/4 拦截 + validate 真实执行）。下一步 V4-V8 深度加固。**

## 已完成（commit `d389b8b` + 2026-06-24 运行时验证）

### 源码改造（6 任务）
- M1: tree-state.js(2428行)→`patch-l/tree-engine.cjs`（TREES_ROOT 可注入 + run 等价 CLI + shim + exports，**cmd/12DbC/文件锁零改动**，git rename 83% 实证）
- M2: patches.cjs spawn→engine.run + W-08/C-11 改查 mcp__tree__*
- M3: dbc-spec/audit-attacks execFile→require engine.run（async 化 + findEngine 自适应）
- M4: commander SKILL.md CLI→mcp__tree__* + assets 自包含
- MED M1: run() per-call treesRoot 并发加固
- A1: collaboration 独立审计子会话通过

### 部署（dist/ + 激活 skill）
- dev dist/: patches.cjs + tree-engine.cjs（备份 .bak-20260623-pre-inline）
- release dist/: patches.cjs + tree-engine.cjs（备份 .bak-20260624-pre-inline）
- 激活 skill: `~/.proma/agent-workspaces/proma/skills/tree-commander/`（MCP 版 SKILL.md + assets）
- 清理 proma/tree-1/tree-2 三处遗留 tree-state.js → 工作区零源码泄漏

### 运行时验证（2026-06-24）
- **dev**: 27 工具全注册 + tree_init/validate/list_active 链路通 + **DbC 对抗测试 4/4 拦截**（无 deliverable done→E_SCHEMA_INVALID；自审自→E_AUDITOR_NOT_INDEPENDENT）
- **release**: list-active + validate 真实执行（l1fix 跑出 8 个历史 schema issues，证明引擎校验有效）

## 关键技术决策（新会话必读）
1. **spawn→require**: tree-state.js 曾暴露在工作区（agent 可改）→ 内联进 dist/（agent 看不到）
2. **run(cmd,args,treesRoot?)**: 与原 CLI stdout 字节级等价，永不 throw；MCP/dbc-spec 调用方零改动
3. **TREES_ROOT 可注入**: 解决 require 后 `__dirname` 指向 dist/ 的障碍；MCP 用 per-call treesRoot
4. **findEngine 自适应**: 验收工具在 test-sandbox/assets/激活 assets/dist/ 任意位置都能定位 engine
5. **CLI shim 保留**: `node tree-engine.cjs <cmd>` 向后兼容
6. **DbC 检查顺序**: auditor 独立性(A2) 先于 audit 时序(A7)——先验"谁在审"再验"有没有东西审"（dev 对抗测试实测确认）

## 关键文件位置
| 文件 | 源 | 部署 |
|---|---|---|
| tree-engine.cjs | `release/tree-system-v0.2.2/patch-l/` | `D:/Proma-{dev,release}/resources/app/dist/` |
| proma-dev-patches.cjs | 同上 | 同上 |
| dbc-spec/audit-attacks | `release/.../test-sandbox/` + `skills/tree-commander/assets/` | — |
| commander SKILL.md | `workspace-files/skills/tree-commander/` | `~/.proma/.../skills/tree-commander/`（激活）|
| 原 tree-state.js（Phase A 源）| `release/.../core/tree-state.js` | **保留**（engine.cjs 源头 + 基线对照）|
| 方案 + 实施 | `.context/plan/tree-engine-inline-mcp.md` + `note.md` | — |

## 下一步（新会话）

### 🔴 优先：V4-V8 深度加固（audit-attacks 暴露的 3 BYPASS + 2 GAP）
在 `engine.cjs` 加 5 个 DbC 硬约束点：
- **V4** [ENABLER] `MS-free-auditpass`: milestone set-result 无条件设 audit_pass=true → 加独立 auditor 鉴权
- **V5** [BYPASS] `A3-omit-alignment`: brief_echo 省略 alignment 字段绕过独立审计 → alignment 必填
- **V6** [BYPASS] `A5-pass-false`: self_check 全 pass:false 通过 schema → 验 pass 值合法性
- **V7** [BYPASS] `CMD-done-no-audit`: commander 默认 verdict=skip 直接 done → 强制审计
- **V8** [GAP] `A4-budget0`: node_budget=0 被当默认值 10（|| 短路）→ 修短路逻辑
- **CP2-direct-forge** [BYPASS]: 直接改文件伪造 audit_gate.pass → 需 **Layer 4 subagent_trace_id**（平台层依赖，标注）

### 其他方向
- **Phase D**: D1 prune/archive 语义拆分 / D2 migrate 版本号 / D3 watcher silence_minutes
- **Phase B-G**: 主动 Supervision / Capability Token / Hash Chain / Liveness
- **Layer 4**: 真·独立审计（subagent_trace_id，CLI 层极限是白名单）
- **历史树 schema 修复**: l1fix 等 8 issues（可用 migrate 的 role/added_by 修正规则）

### dev 测试垃圾（可选清理）
- 会话: `ae3f183e` / `849ff044` / `35020007`（tree MCP 联调测试，可归档）
- tree 数据: `~/.proma-dev/agent-workspaces/default/.context/trees/mcpvfy/`

## 自举验证模式（延续）
本次用 SDK Agent（M3/M4 并行实现）+ collaboration 真实子会话（A1 独立审计）+ dev agent 运行时对抗测试，**三次验证"实现/测试/审计分离"有效**。继续用此模式推进 V4-V8（派 implementer 加 DbC + auditor 对抗验证 + 真实子会话验收）。

## 新会话第一步
1. 读本文件 + PROJECT-INDEX.md + note.md（5 分钟恢复）
2. 决定优先级：V4-V8（推荐）/ Phase D / 历史树修复
3. V4-V8 用 Tree 思想：派 SDK Agent 改 engine.cjs 加 5 个 DbC + dbc-spec 补 5 用例 + collaboration 审计子会话对抗
