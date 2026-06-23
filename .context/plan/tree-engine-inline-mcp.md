# 方案：tree 引擎内联进 MCP（消除工作区暴露的 tree-state.js）

> 起草: 2026-06-23 | 状态: 待执行 | 关联: handoff/session-2026-06-23-v0.7-phaseA-mcp.md
> 工作区: Proma改造探索 | 用户: 周星星

## 一、目标（一句话）

把 `tree-state.js`（2428 行 / 90KB）的引擎逻辑**真正内联**进 `dist/tree-engine.cjs`，让 `mcp__tree__*` 直接调内联函数（不再 spawn CLI），**工作区里不再有任何 tree-state.js 源码文件**，agent 读不到、改不到。状态数据 `tree-state.json` 保留在工作区（数据不是代码）。

对照范本：`session-management` skill 的 `mcp__session__*` / `mcp__remote-session__*` —— 逻辑全在 `proma-dev-patches.cjs`，agent 在工作区看不到一行源码。

## 二、现状诊断（证据，确认是半成品）

| 项 | 现状（commit ba2c030） | 问题 |
|---|---|---|
| MCP 实现 | `createTreeMcpServer`（patches.cjs:1060-1163）27 工具 handler 全走 `callTreeState()` → `execFileAsync("node", [tree-state.js, ...args])`（:1099-1102） | spawn 薄包装，零代码内联 |
| 引擎文件 | `release/tree-system-v0.2.2/core/tree-state.js` 90KB，部署时必须 cp 到每个工作区 `.context/trees/` | agent 可 Read/Edit/cat/node 直接绕过 MCP |
| 缺文件兜底 | 工作区无 tree-state.js → `E_NO_TREE_STATE_JS`（:1100） | 证明文件本该在工作区 |
| 自相矛盾 | patches.cjs 审计规则 W-08（:2259）/ C-11（:2317）仍在查"agent 是否直接操作 tree-state.js" | 规则前提就是文件暴露，半成品铁证 |

## 三、目标架构

```
dist/                              ← Electron 安装目录，agent 完全看不到
├── proma-dev-patches.cjs          ← 改：createTreeMcpServer 从 spawn 改 require engine
├── tree-engine.cjs                ← 新：tree-state.js 改造版（TREES_ROOT 可注入 + export，cmd 逻辑零改）
├── preload.cjs / proma-tree-view.*← 不动
└── proma-mcp-server.cjs           ← 不动

<workspace>/.context/trees/        ← 工作区，agent 可见（但只剩数据）
└── <tree_id>/
    ├── tree-state.json            ← 状态数据（保留）
    ├── .lock / *.tmp              ← 文件锁（保留）
    └── tree-state.backup.*.json   ← 自动备份（保留）
   （不再有 tree-state.js）

skills/tree-commander/             ← skill 自包含
├── SKILL.md                       ← 改：CLI 调用 → mcp__tree__* 工具调用
└── assets/                        ← 新：验收/攻击工具随 skill 走，需用时拷到工作区临时目录
    ├── dbc-spec.cjs
    └── audit-attacks.cjs
```

## 四、require 化障碍清单 + 解法（已逐条核实代码）

| # | 障碍 | 位置 | 解法 |
|---|---|---|---|
| 1 | `const TREES_ROOT = __dirname` | :120 | 改 `let TREES_ROOT=null` + `setTreesRoot(p)`。MCP 每次 call 前 `engine.setTreesRoot(trees_dir)`（已由 `findTreesDirForWorkspace` 算出） |
| 2 | `main()` + `process.argv` + `process.exit` + `process.stdout` | :2396-2428 | require 化时整段删除。输出/退出是 CLI 专属，MCP 直接拿 dispatch 返回值 |
| 3 | 27 个 `cmdXxx(args)` 签名是 args 数组 + 内部 `parseArgs` | :1869+ | **不改**。MCP 层已经在 patches.cjs 把结构化参数拼成 args 数组（argBuilder），直接喂 `dispatch(cmd, args)` |
| 4 | `withLock` 文件锁 `.lock` | :229 | **照搬**。MCP 同进程 + dbc-spec 独立进程仍可能并发，锁必须留 |
| 5 | `writeState` 同步 rename 自旋重试 | :343-359 | **照搬**（仅 Windows EPERM 才进自旋，常态不阻塞）。标注为已知技术债，本轮不动 |
| 6 | migrate 规则8 `path.resolve(TREES_ROOT,'..','..')` 推 workspace_root | :2209 | 无障碍，treesRoot 仍是 trees/ 绝对路径，推断成立 |
| 7 | `nowIso()` 用 `new Date()` | :135 | 纯函数，无障碍 |
| 8 | dbc-spec/audit-attacks 用 `execFileSync('node',[SCRIPT,...])` | dbc-spec:53 | 改 require engine.dispatch（独立 node 进程仍算独立验收，不经 MCP/不经 Tree commander）|

**结论：engine 改造 = 改 TREES_ROOT（1 处）+ 删 main 段（1 段）+ 加 export 块（1 块）。cmd 函数体、DbC 校验、文件锁、原子写全部原样保留。Phase A 的 12 个 DbC 零风险。**

## 五、实施步骤（按 Tree 思想拆 milestone，可派子会话/子Agent）

### Phase 1 — 引擎改造（地基，主会话亲自做，精确至上）
- [ ] **M1** `tree-state.js` → `tree-engine.cjs`：
  - 复制 core/tree-state.js 为 patch-l/tree-engine.cjs
  - TREES_ROOT 改可注入（`let` + `setTreesRoot` + `getTreesRoot`）
  - 删 main()/process 副作用段
  - 加 `module.exports = { dispatch, setTreesRoot, getTreesRoot, ERRORS, parseArgs }`
  - 加 `if (require.main === module)` CLI shim（让 dbc-spec 过渡期可继续 execFile，向后兼容）
  - **DoD**: `node -c tree-engine.cjs` 语法 OK；独立 require 后 `setTreesRoot(tmpDir); dispatch('init', [...])` 能建树

### Phase 2 — 三路并行（派 SDK Agent，依赖 M1）
- [ ] **M2** patches.cjs `createTreeMcpServer`：spawn `callTreeState` → `engine.setTreesRoot(trees_dir); engine.dispatch(cmd, args)`。保留 27 工具 schema 不变。DoD: 语法 OK，workspace 定位逻辑不变
- [ ] **M3** dbc-spec.cjs + audit-attacks.cjs：`execFileSync` → require engine（setTreesRoot 到 sandbox core/）。断言期望（E 错误码、UUID）一字不改。DoD: `node dbc-spec.cjs` 仍输出 21/0；audit-attacks 18 攻击结果与基线一致
- [ ] **M4** tree-commander/SKILL.md 重写：所有 `node .context/trees/tree-state.js <cmd>` → `mcp__tree__*`（用 handoff §5 映射表，34 处）。顶部加 v0.7+ 说明。tree-worker SKILL.md 不改（铁律8）。assets/ 放 dbc-spec + audit-attacks。DoD: grep 无残留 `tree-state.js` CLI 调用

### Phase 3 — 独立对抗审计（派 collaboration 子会话，真实可见）
- [ ] **A1** auditor 独立子会话，对抗视角验收：
  - dbc-spec 21 用例全绿（行为等价）
  - audit-attacks 18 攻击无新增绕过（重点查 V1 restore / V2 auditor 白名单 / V3 expect_outputs 非空 在内联后是否仍生效）
  - 工作区扫描：确认任何工作区 `.context/trees/` 下无 tree-state.js / tree-engine.cjs 源码泄漏
  - 检查 patches.cjs 审计规则 W-08/C-11 是否已同步改为查 mcp__tree__* 调用（若未改，报 BLOCKER）
  - 输出: 审计报告 + BLOCKER/HIGH 清单

### Phase 4 — 综合 + 部署验证（主会话，需用户参与）
- [ ] 修复 A1 发现的问题
- [ ] 同步 patch-l 源 → D:\Proma-dev\resources\app\dist\（patches.cjs + tree-engine.cjs）
- [ ] 提示用户重启 D:\Proma-dev，新建 session 验证 27 个 mcp__tree__* 注册 + `tree_validate` 返回 {ok}
- [ ] commit（feat: tree 引擎内联 MCP，消除工作区源码暴露）
- [ ] 更新 PROJECT-INDEX + note.md + handoff

## 六、验收标准（硬门槛）

1. `node dbc-spec.cjs` → **通过 21 / 失败 0**（行为与 CLI 版完全等价）
2. `node audit-attacks.cjs` → 18 攻击，CRITICAL=0（V1/V2/V3 仍堵住）
3. 任意工作区 `.context/trees/` 下 `find -name "tree-state.js" -o -name "tree-engine.cjs"` → **空**（零源码泄漏）
4. tree-commander/SKILL.md `grep "node.*tree-state.js"` → **0 命中**
5. patches.cjs 的 W-08/C-11 审计规则已改为查 mcp__tree__*（不再查 tree-state.js 文件操作）
6. 部署后 MCP `tree_validate` / `tree_leaf_add` / `tree_audit_gate` 返回 `{ok:true}`

## 七、风险与回滚

| 风险 | 缓解 |
|---|---|
| engine 内联后某 DbC 行为漂移 | dbc-spec 21 + audit-attacks 18 双重回归，任一红即阻断 |
| `setTreesRoot` 全局可变状态在并发下错乱 | Electron 主进程 JS 单线程，MCP 调用串行；每 call 前重设。dbc-spec 独立进程各设各的。可接受 |
| writeState 同步 rename 自旋阻塞主进程 | 仅 Windows EPERM 触发，常态不进入。标注技术债，本轮不动 |
| dbc-spec 找不到 dist/engine 路径 | engine 同时支持 require + CLI shim（require.main 判断），过渡期 dbc-spec 可继续 execFile shim |
| 回滚 | 保留 core/tree-state.js 原件不动；engine.cjs 是新增文件；patches.cjs 改动集中在 1060-1163 段，git revert 即可 |

## 八、Tree 思想推进方式（子会话/子Agent 分工）

| 阶段 | 执行单元 | 工具 | 理由 |
|---|---|---|---|
| M1 引擎改造 | 主会话亲自 | Edit | 地基，精确至上，改动小（~30 行）|
| M2/M3/M4 | 3 个 SDK Agent 并行 | Agent | 机械改写，独立，可并行 |
| A1 审计 | collaboration 真实子会话 | delegate_agent | 独立角色 + 真实可见 + 保留记录，符合"审计必须独立"精神 |
| 综合/部署 | 主会话 | — | 需跨步骤断言 + 用户参与重启 |

每个子单元下发 4 件套契约（brief/dod/report/autonomy），autonomy 严格锁定改动范围（呼应 Phase A 自举验证模式）。
