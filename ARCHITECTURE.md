# Proma 改造项目 — 架构文档

> 维护: 周星星 + Proma Agent | 版本: V10 Phase 3 + IHL R6（2026-06-26）
> 配套文档: [PROJECT-INDEX.md](.context/PROJECT-INDEX.md) · [API.md](./API.md) · [SECURITY.md](./SECURITY.md)

---

## 一、定位与一句话概述

**基于 Proma 商业版（AGPL-3.0），通过 sed 补丁 + 独立插件文件 + 内联引擎的方式叠加闭源能力，目标是构建垂直化 AI 助手产品。核心策略：开源做壳，闭源做肉。**

最新完成度：**Layer 1 MCP 基础设施完工（v0.16.5）+ Layer 2 树形会话引擎 V10 Phase 3 + IHL 6 轮迭代加固（2026-06-26）**。

### 1.1 三层架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                     Proma 商业版（AGPL-3.0）                       │
│            main.cjs (571K 行，含 15 个闭源模块)                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Layer 1 — MCP 基础设施 (v0.16.5)                            │  │
│  │   sed 补丁 A-K (11 个) + proma-dev-patches.cjs              │  │
│  │   · 12 本地 session 工具 + 12 远端 remote-session 工具      │  │
│  │   · stdio MCP server + HTTP bridge (localhost:19876-95)     │  │
│  └─────────────────────┬──────────────────────────────────────┘  │
│                        │ global.__proma__ 桥接                    │
│  ┌─────────────────────▼──────────────────────────────────────┐  │
│  │ Layer 2 — 树形会话执行体系 (V10 Phase 3 + IHL R6)            │  │
│  │   tree-engine.cjs (5045 行, 工作区零源码)                    │  │
│  │   · 29 个 mcp__tree__* 工具                                 │  │
│  │   · DbC 21 校验点 + V10 八大加固 + C5 Trust Anchor           │  │
│  │   · TAO Watcher 35 规则 + W-AUDIT-* tamper detection        │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Layer 0/3/4 — 防御层                                         │  │
│  │   Layer 0 行为引导 (SKILL.md)                                │  │
│  │   Layer 3 TAO Watcher 周期审计 ✅                            │  │
│  │   Layer 4 subagent_trace_id ⏳ 远期                          │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、修改模型：三层叠加

### 2.1 不可重构建的铁律

商业版 `main.cjs`（571K 行，0.12.23）含 **15 个闭源模块**（cloudAuth / sync / billing / SDK 等）。**从开源源码重构建会导致登录失败**——已实测验证。正确方式是 **商业版 main.cjs + sed 补丁 + 独立插件文件 + 内联引擎**。

### 2.2 三层文件分工

| 层 | 文件 | 部署路径 | 用途 |
|---|---|---|---|
| **sed 补丁层** | `main.cjs` | `D:/Proma-dev/resources/app/dist/main.cjs` | 字符串替换，11 个补丁 A-K + Sprint 4 直编 createAgentSession workspace 白名单（P2），常量改 / 小段注入 |
| **独立插件层** | `proma-dev-patches.cjs` | 同上（3268 行）| 新增 MCP 工具 / 复杂逻辑 / HTTP bridge / TAO Watcher |
| **内联引擎层** | `tree-engine.cjs` | 同上（5045 行）| 树形会话引擎（v0.7+ 内联，工作区零源码泄漏）|

### 2.3 11 个 sed 补丁

| 补丁 | 功能 | 关键改动 |
|---|---|---|
| A | MCP 钩子注入 | `global.__proma_getMcpServers__` |
| B | API 桥接 + 加载插件 | `global.__proma__` 导出 12 个函数 + `require("./proma-dev-patches.cjs")` |
| B2/B3 | 桥接扩展 | 补 `runAgentHeadless` / `listAgentWorkspaces` |
| C1-5 | 频道 + 模型元数据覆盖 | MCP 创建会话走后端正确 channel/model/API Key |
| D+E | Renderer 同步 + 守卫移除 | UI 模型选择器与 metadata 同步 |
| F | 跨渠道 sdkSessionId 防护 | **已被 H 替代** |
| G | CLAUDE_CONFIG_DIR 无条件覆盖 | 修复 Dev fork 失败 0/3 → 3/3 |
| H | 跨频道/跨 provider 模型切换完整修复 | channelId 或 modelId 任一变化 → 清 sdkSessionId + 同步 meta |
| I | 禁用更新检查 | `initAutoUpdater` 首行 return |
| J | AppUserModelId 动态隔离 | `com.proma.{NAME}`，三版任务栏独立 |
| K | userData 路径动态化 | `electron-{NAME}`（v0.16.5 修正：双条件 ISOLATED+NAME）|

完整补丁命令详见 [.context/proma-dev-wiki.md §5](.context/proma-dev-wiki.md)。

---

## 三、三开环境拓扑

### 3.1 实例矩阵

| 实例 | 路径 | 启动脚本 | EXE | NAME | ISOLATED | userData | 双开 |
|---|---|---|---|---|---|---|---|
| 正式版 | `D:\Proma\` | 双击 | `Proma.exe`（黑）| - | - | `~/.proma/` | - |
| Dev | `D:\Proma-dev\` | `start-dev.bat` | `Proma-white.exe`（白）| `dev` | `1` | `~/.proma-dev/` | ✅ |
| Release | `D:\Proma-dev\` | `start-release.bat` | `Proma-coral.exe`（珊瑚）| `release` | `0` | `~/.proma/`（共享）| ❌ |
| Pro | `D:\Proma-dev\` | `start-pro.bat` | `Proma-green.exe`（绿）| `pro` | `1` | `~/.proma-pro/` | ✅ |
| Release-Fresh | `D:\Proma-dev\` | `start-release-fresh.bat` | 同 Release | `release-fresh` | `1` | `~/.proma-release-fresh/` | ✅ |

### 3.2 两变量体系（v0.16.5 修正）

```
PROMA_INSTANCE_NAME       管身份（remote-session 发现、AppUserModelId、托盘图标）
PROMA_INSTANCE_ISOLATED   管数据隔离（1=独立 ~/.proma-{NAME}/，0=共享 ~/.proma/）
```

**铁律**：`PROMA_INSTANCE_NAME` 管身份，`PROMA_INSTANCE_ISOLATED` 管数据隔离，两变量各司其职。Release 设 `NAME=release + ISOLATED=0` 即可有独立身份同时共享正式版数据。

### 3.3 启动脚本示例

```bash
# start-dev.bat
set PROMA_INSTANCE_NAME=dev
set PROMA_INSTANCE_ISOLATED=1
"D:\Proma-dev\Proma-white.exe"

# start-release.bat
set PROMA_INSTANCE_NAME=release
set PROMA_INSTANCE_ISOLATED=0
"D:\Proma-dev\Proma-coral.exe"
```

### 3.4 端口分配

```
release        @ 127.0.0.1:19876   (D:/Proma-dev/start-release.bat, Proma-coral)
dev            @ 127.0.0.1:19877   (D:/Proma-dev/start-dev.bat, Proma-white)
pro            @ 127.0.0.1:19878   (启动后占用)
release-fresh  @ 127.0.0.1:19879   (启动后占用)
```

HTTP bridge 在 19876-19895 范围内自动选端口，启动顺序决定具体绑定。

---

## 四、MCP 桥接架构

### 4.1 两种 MCP 调用路径

```
┌──────────────────────────────────────────────────────────────┐
│  Claude Code / 外部 MCP 客户端                                │
│  (stdio MCP 配置 mcpServers.proma-dev-session)                │
└────────────────────┬─────────────────────────────────────────┘
                     │ stdio
                     ▼
        ┌────────────────────────────────┐
        │ proma-mcp-server.cjs            │  ← 零依赖 stdio 桥
        │   --dev / --release / --pro     │
        └────────────────────┬───────────┘
                             │ HTTP (localhost:19876-95)
                             ▼
        ┌────────────────────────────────┐
        │ Proma Electron 主进程           │
        │ proma-dev-patches.cjs           │
        │   HTTP bridge handler           │
        └────────────────────┬───────────┘
                             │ 进程内 global.__proma__
                             ▼
        ┌────────────────────────────────┐
        │ main.cjs 核心 API               │
        │ createAgentSession / forkAgent / │
        │ listChannels / listSessions ...  │
        └────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Proma Agent 内部（同一 Electron 主进程）                     │
│                                                              │
│  Agent SDK → sdk.createSdkMcpServer({name:"tree"})           │
│           │                                                  │
│           ▼                                                  │
│  tree-engine.cjs (require("./tree-engine.cjs"))              │
│           │                                                  │
│           ▼                                                  │
│  tree-state.json (磁盘)                                       │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 三类 MCP 工具

| 类别 | 前缀 | 入口 | 数量 |
|---|---|---|---|
| **本地 session** | `mcp__session__*` | 进程内直连 `global.__proma__` | 12 |
| **远端 remote-session** | `mcp__remote-session__*` | HTTP bridge 自动发现端口 | 12 |
| **Tree** | `mcp__tree__*` | 进程内调用内联引擎 | 29 |

完整工具清单见 [API.md](./API.md)。

### 4.3 send_message 三模式

| 模式 | 参数 | 行为 |
|---|---|---|
| 同步 | `wait=true` | 阻塞至目标会话完成，返回最终 reply |
| 异步通知 | `notify=true` | fire-and-forget，完成后推送通知回调用会话 |
| 轮询 | `wait=false` | 立即返回，调用方主动 list_messages 轮询 |

---

## 五、树形会话引擎数据模型

### 5.1 tree-state.json 结构

每棵树持久化在磁盘上：

```
~/.proma[-dev]/agent-workspaces/<workspace_slug>/{workspace-files/,}.context/trees/<tree_id>/
├── tree-state.json           ← 主状态（原子写 + 文件锁）
├── tree-state.backup.*.json  ← 自动备份（10 份滚动）
└── deliverables/             ← 交付物目录
```

简化结构：

```json
{
  "schema_version": "0.7",
  "tree_id": "nanju",
  "created_at": "2026-06-25T08:00:00Z",
  "root_brief": { "goal": "...", "boundary": [...] },
  "root_dod": {
    "max_depth": 3,
    "node_budget": 20,
    "deliverables_check": ["..."]
  },
  "leaves": {
    "nanju-root": {
      "leaf_id": "nanju-root",
      "session_id": "abc-uuid-v4...",
      "role": "root",                    // root | commander | worker
      "status": "active",                // active | done | pruned | archived
                                         // | pending_brief | segment_pending
      "parent": null,
      "path": "nanju-root",
      "added_by": null,
      "context_usage_pct": 42,
      "events": [
        { "type": "brief_echo", "ts": "...", "meta": { "alignment": "..." } },
        { "type": "done", "ts": "...", "meta": { "self_check": [...] } }
      ],
      "audit_gate": {
        "verdict": "pass",               // pass | required | skip
        "auditor_session_id": "...",
        "ts": "...",
        "auto_upgrade": true             // root trust anchor 自动升级
      },
      "audit_log": [
        { "auditor": "...", "ts": "...", "total": 5, "passed": 5,
          "failed": 0, "results": [{ "item": "...", "pass": true, "evidence": "..." }] }
      ],
      "milestones": [
        { "id": "m1", "expect_outputs": ["..."], "audit_pass": false }
      ],
      "nudge_count": 0,
      "nudge_log": [...],
      "last_event_type": "done",
      "last_event_ts": "..."
    }
  },
  "heartbeats": [...],
  "drift_log": [...]
}
```

### 5.2 三层 role 枚举

```
ROLE_ENUM = ['root', 'commander', 'worker', 'auditor']
```

| Role | 创建方式 | 权限 | 关键约束 |
|---|---|---|---|
| **root** | `tree_init` 唯一创建 | 全局路由 + 校准 | 唯一性强制；PENDING_ROOT 必须用 `set-session` 修正；自审作为 Trust Anchor |
| **commander** | `fork_session` 创建 | `leaf add` + 管理下属 | 嵌套深度 ≤ 3（默认），role enum 限制 |
| **worker** | `create_session` 创建 | 只读 tree + 只上报 event | 不能 add leaf；done 前必须有独立 auditor 签字 |

### 5.3 状态枚举

```
STATUS_ENUM = ['active', 'done', 'pruned', 'archived',
               'pending_brief', 'segment_pending']
```

- `active` — 进行中
- `done` — 完成（触发 DbC 硬门禁）
- `pruned` — 剪枝（自动 nudge_count ≥ 7 触发）
- `archived` — 归档（隐藏，list_active 不显示）
- `pending_brief` — 等待 Brief 注入（root 占位符）
- `segment_pending` — 竹节交接过渡态

### 5.4 工作合同五件套（root → commander）

每次 root fork 一个 commander，**第一条消息必须包含**：

```
┌────────────────────────────────────────────────┐
│ 📋 BRIEF       任务简报（为什么 / 边界 / 完成标准）│
│ 🎯 DoD         Definition of Done              │
│                交付物清单 + 自检脚本 + 验收标准  │
│ 📡 REPORT      汇报协议（done/blocked/plan 三种）│
│ 🛑 AUTONOMY    自主度（can_decide/must_report/  │
│                must_ask）                       │
│ 🔍 SELF_AUDIT  自审（每里程碑 Fork code-reviewer）│
└────────────────────────────────────────────────┘
```

---

## 六、五层防御架构（洋葱模型）

```
                  ┌─────────────────────────────────┐
   AI 想偷懒 ───→ │  Layer 0：行为引导（SKILL.md）   │  "请你这样做"
                  │  prompt 里的"应当""必须"          │  ← 软约束
                  └──────────────┬──────────────────┘
                                 ▼
                  ┌─────────────────────────────────┐
                  │  Layer 1：Hard Gate ✅ 完成      │  "你必须这样做"
                  │  DbC 21 校验点 + V10 八大加固    │  ← 硬约束（写入前）
                  │  + C5 Trust Anchor 修复          │     事中拦截 ~80%
                  └──────────────┬──────────────────┘
                                 ▼
                  ┌─────────────────────────────────┐
                  │  Layer 2：主动 Supervision ⏳    │  "摔倒立刻扶"
                  │  commander 持 worker 生命线      │  ← 事件驱动（未做）
                  │  Erlang OTP 防抖窗口             │     事中接管 ~15%
                  └──────────────┬──────────────────┘
                                 ▼
                  ┌─────────────────────────────────┐
                  │  Layer 3：TAO Watcher ✅ 部分    │  "巡警 5 min 一圈"
                  │  周期审计 + 35 规则              │  ← 周期被动
                  │  + W-AUDIT-* tamper detection   │     事后兜底 ~5%
                  └──────────────┬──────────────────┘
                                 ▼
                  ┌─────────────────────────────────┐
                  │  Layer 4：模型契约 ⏳ 远期       │  "身份证 + 门禁卡"
                  │  subagent_trace_id 真凭证        │  ← 平台层（不可控）
                  │  capability-based 工具调用       │     真签名
                  └─────────────────────────────────┘
```

### 6.1 各层完成度

```
Layer 0 行为引导（SKILL.md）          ████████████████████ 100% ✅
Layer 1 Hard Gate（DbC 21 + V10）     ███████████████████░  95% ✅
Layer 2 主动 Supervision              ░░░░░░░░░░░░░░░░░░░░   0% ⏳ 设计完成
Layer 3 TAO Watcher                   ████████████████░░░░  80% 🟡 +tamper detection
Layer 4 模型层契约                    █░░░░░░░░░░░░░░░░░░░   5% 🟡 雏形
```

### 6.2 Layer 1 DbC 21 校验点（截至 2026-06-26）

| 批次 | 数量 | 堵什么 |
|---|---|---|
| **Phase A**（6/23）| 12 | CP1-CP6（文件幻觉/自审自过/节点失控/伪自检/validate 失败续跑/时序倒挂）+ SP1 + 加固 #2/#6 |
| **V4-V9**（6/24）| 9 | budget 短路 / alignment 标志篡改 / milestone 自审 / expect_outputs 路径遍历 / symlink 逃逸 |
| **R2-T7 + M2**（6/25）| 2 | audit_append results[i] 三元组 / total 整数类型 |
| **V10 八大**（6/25）| 8 | 僵尸 auditor / UUID 严格 / 数值一致性 / 借身份 / nudge 升级 / 时间戳单调 / workspace canonical / status-event 同步 |
| **C5 + Bug A/B**（6/25-26）| 4 | Trust Anchor null 放行 / caller 透传 / 代写 done event / session_id 唯一性 |

### 6.3 Layer 3 TAO Watcher 35 规则分类

| 类别 | 前缀 | 数量 | 用途 |
|---|---|---|---|
| 行为引导 | W-* | ~10 | brief_echo / leaf purity / autonomy 等活跃 leaf 行为 |
| 关系约束 | R-* | ~10 | 父子 / 跨 leaf / 跨工作区关系 |
| 校准 | C-* | ~10 | audit gate / events / deliverable 校准 |
| 篡改检测 | W-AUDIT-* | 4 | 自审 / worker 当 auditor / audit_log 伪造 / no alignment |

---

## 七、三层防御拓扑（V10 Phase 3 + IHL R6 新增）

> ⚠️ 下图中的 `L行号` 引用可能滞后（engine 加注释后漂移 100-680 行），**以 `grep 函数名 tree-engine.cjs` 实际定位为准**（如 `grep -n "async function cmdEventAppend" tree-engine.cjs`）。行号引用是历史快照，函数名稳定。

```
┌────────────────────────────────────────────────────────────────┐
│  入口拦截层 (V10 P3 + R2/R4)                                    │
│  调用方校验，副作用前一刻拦截                                    │
├────────────────────────────────────────────────────────────────┤
│ ├── cmdEventAppend L1498        Bug A-1: caller != leaf.session │
│ ├── cmdLeafAdd L705             Bug B-3: session_id 唯一性       │
│ ├── create_session L461         R2:    workspace_id 索引校验     │
│ └── fork_session L601           R4:    new_workspace_id 同类    │
│                                                                │
│ 兜底守卫层 (V10 P3 + R1)                                        │
│ 入口被绕过后的二道防线                                           │
├────────────────────────────────────────────────────────────────┤
│ ├── cmdAuditGate L2337          Bug A-2: caller==audit_session │
│ ├── resolveAuditorIndep L1897   Bug B-4: .filter 跳过 pruned   │
│ ├── checkAllRules isSharedSessionLeaf  9c423b8: 子级规则守卫    │
│ └── applyNudge sharedCount      R1:     全规则兜底（补 tree 级） │
│                                                                │
│ 事后检测层 (R5/R6)                                              │
│ 对抗 Layer 4 直接编辑 tree-state.json                           │
├────────────────────────────────────────────────────────────────┤
│ ├── W-AUDIT-SELF     自审检测 (root 例外)                       │
│ ├── W-AUDIT-WORKER   worker 当 auditor (互审洗白)               │
│ ├── W-AUDIT-TAMPER   audit_log 含 pass=true (伪造痕迹)          │
│ └── W-AUDIT-NO-ALIGN worker pass 无 alignment event             │
└────────────────────────────────────────────────────────────────┘
```

### 7.1 三层防御协同

- **入口拦截** — 阻止 99% 常规误用（commander 代写、worker 借身份、跨工作区漂移）
- **兜底守卫** — 阻止入口被绕过 / 新规则未覆盖的边界情况
- **事后检测** — 检测 Layer 4 直接篡改（引擎拦截不到的攻击向量）

### 7.2 IHL 6 轮迭代收敛（2026-06-26）

Iterative Hardening Loop（IHL）/ 盲点驱动的迭代加固：

| 轮次 | Commit | 起点 | 修复 |
|---|---|---|---|
| R1 | `1a7ed5f` | bugav tree 实测发现 R-04 绕过 9c423b8 守卫 | applyNudge 入口全局守卫 |
| R2 | `031c546` | GLM-5.2 v1 落 "undefined" slug | validateWorkspaceId helper |
| R3 | v626 树 | 端到端串联修复链验证 | V4 Pro commander + SubAgent 监督 |
| R4 | `031c546` | code-reviewer 发现 fork_session 同类漏洞 | helper 共享给 fork_session |
| R5 | `d44163a` | v626 tree-state.json 被直接篡改 | 4 条 W-AUDIT-* tamper detection |
| R6 | `690f7e8` | R5 规则被 Tier 2 status 守卫跳过 | R5 移到 Tier 1（对 all leaf 跑）|

---

## 八、数据流图

### 8.1 用户操作 → tree-state.json

```
┌──────────────────────────────────────────────────────────────┐
│ 用户在 Proma UI 操作 Agent                                    │
│   ↓                                                          │
│ Agent SDK 调用 mcp__tree__tree_leaf_set_status(tree_id, ...)  │
│   ↓                                                          │
│ sdk.createSdkMcpServer handler (proma-dev-patches.cjs L1190) │
│   ↓ callerSessionId 透传                                      │
│ callTreeState(workspaceSlug, args, callerSessionId)          │
│   ↓ 找 trees_dir                                              │
│ treeEngine.run(cmd, args, treesRoot, callerSessionId)         │
│   ↓                                                          │
│ ┌────────────────────────────────────────────┐               │
│ │ cmdLeafSetStatus (tree-engine.cjs)          │               │
│ │  ├── Precondition (DbC V10 校验)            │               │
│ │  │   ✓ leaf 存在                            │               │
│ │  │   ✓ status 在枚举内                      │               │
│ │  │   ✓ done → 必有独立 auditor 签字         │               │
│ │  │   ✓ done → 必有 done event 留痕          │               │
│ │  │   ✓ done → expect_outputs 文件真实存在   │               │
│ │  │   ✓ caller 校验 (Bug A)                  │               │
│ │  ├── Apply: leaf.status = 'done'            │               │
│ │  └── Postcondition: validate()              │               │
│ └────────────────┬───────────────────────────┘               │
│                  ↓ atomic write + file lock                   │
│         tree-state.json (磁盘)                                │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 TAO Watcher 周期巡逻

```
proma-dev-patches.cjs setInterval(checkAllRules, 5min)
   ↓
loadAllTreesWithActiveLeaves()
   ↓
for each tree:
  for each leaf (Tier 1, all):
    run W-AUDIT-* (篡改检测，对 done leaf 也跑)
  for each active leaf (Tier 2):
    run W-* / R-* / C-* (行为引导)
   ↓
违规 → applyNudge(rule_id, severity)
   ↓
nudge_count:
  3 → medium
  5 → high
  7 → 强制 pruned (E_LEAF_AUTO_PRUNED)
```

---

## 九、关键设计决策

### 9.1 为什么 sed 补丁而非 fork？

**约束**：商业版 `main.cjs` 含 15 个闭源模块（cloudAuth / sync / billing），从开源源码重构建会导致登录失败（已实测）。

**结论**：保留商业版 `main.cjs` 原样，用 sed 字符串替换 + 独立插件文件叠加能力。这避免了重构建风险，同时让补丁可独立维护（`orphiczhou/proma-patches`）。

### 9.2 为什么 tree-engine 内联？

**问题**：v0.7 之前 `tree-state.js` 是工作区独立脚本（2428 行），agent 可以 Read / Edit / cat 绕过 MCP 直接读改状态文件。

**修复**：v0.7+ 把整个引擎**内联进 patches.cjs 的 mcp__tree__***（部署在 `D:/Proma-dev/resources/app/dist/tree-engine.cjs`，工作区无源码副本）。Agent 看不见也改不到引擎代码，所有操作必须走 MCP 工具 → engine.run() → DbC 校验链。

### 9.3 为什么三层防御拓扑？

**IHL 6 轮迭代得出的工程经验**：

1. **入口拦截易被绕过** — 新规则覆盖不全时（如 R1 发现的 tree 级规则盲点），需要兜底守卫
2. **守卫放在副作用前一刻** — applyNudge（即将落盘 nudge_log）而非 checkAllRules（仅检测），确保守卫真正生效
3. **Layer 4 攻击只能事后检测** — 直接编辑 tree-state.json 完全绕过引擎，必须用 TAO Watcher 周期扫描篡改痕迹（W-AUDIT-*）

### 9.4 为什么 root 作为 Trust Anchor？

**鸡生蛋问题**：root 是信任链起点，但 root.added_by=null，没人能给 root 写 audit_gate=pass，导致任何树都无法启动（root 永远过不了 V10-auditor-active 三重校验）。

**解决**：root 自审作为信任锚。`resolveAuditorIndep` 加 root 特例：`if (leaf.role === 'root' && auditorSessionId === leaf.session_id) return null;`。但 C5 修复关键约束：**必须显式传 root.session_id，不允许 null**，否则 worker 一键改写 root.audit_gate。

### 9.5 为什么三层 role 而非自由文本？

**问题**：v0.2.x 的 role 字段是自由文本，SKILL.md §13 只举例 `root/eval/api/ui`，无 enum 限制，导致 qfv2 跑出 5 层嵌套（root → C → Cr → Ccr1 → worker），LLM 指令保真度每层掉 39%（Laban ICLR 2026），5 层 = 92% 信息丢失。

**修复**：`ROLE_ENUM = ['root', 'commander', 'worker', 'auditor']`（P0a 加 auditor），role 非法抛 `E_SCHEMA_INVALID`（`E_ROLE_INVALID` 为文档遗留，引擎未定义）；`E_DEPTH_EXCEEDED` 硬限 depth ≤ 3；worker 不能 add leaf。

---

## 十、相关文档

| 文档 | 用途 |
|---|---|
| [API.md](./API.md) | 53 个 MCP 工具完整 schema + 错误码字典 |
| [SECURITY.md](./SECURITY.md) | 威胁模型 + 防御矩阵 + 已修复历史 |
| [.context/PROJECT-INDEX.md](.context/PROJECT-INDEX.md) | 项目入口索引 |
| [.context/project-onboarding-guide-2026-06-25.md](.context/project-onboarding-guide-2026-06-25.md) | 30 分钟图形化入门 |
| [.context/proma-dev-wiki.md](.context/proma-dev-wiki.md) | 完整技术 Wiki（补丁命令 + 版本历史）|
| [.context/reference/design/tree-system-architecture-analysis-2026-06-23.md](.context/reference/design/tree-system-architecture-analysis-2026-06-23.md) | 五层防御深度报告 |
| [.context/reference/methodology/commander-methodology-v10.md](.context/reference/methodology/commander-methodology-v10.md) | V10 工程方法论 |
| [.context/v10/v626-r5-r6-audit-tamper-detection.md](.context/v10/v626-r5-r6-audit-tamper-detection.md) | IHL 6 轮 + 三层防御拓扑工程文档 |
| [.context/note.md](.context/note.md) | 长期调研笔记（按日期追加在顶部）|

---

## 十一、维护约定

- 重大架构层变更（如 Layer 2 启动 / Layer 4 落地 / 新增补丁）必须更新本文档
- 工具 schema 修改同步到 [API.md](./API.md)
- 安全防御新增 / 已修复漏洞同步到 [SECURITY.md](./SECURITY.md)
- 日常进展追加到 [.context/note.md](.context/note.md) 顶部
- 保持本文档 < 800 行，超出时拆分子文档
