# Proma 改造项目 — 知识索引

> 入口文档 | 维护: 周星星 | 最后更新: 2026-06-20 11:00

新会话从这里开始读，能 5 分钟拿到项目全貌和关键路径。

---

## 一、一句话定位

基于 **Proma 商业版（AGPL-3.0）**，通过 **sed 补丁 + 独立插件文件** 叠加闭源能力，目标是构建垂直化 AI 助手产品。**核心策略：开源做壳，闭源做肉。**

---

## 二、当前完成度（v0.16）

### Layer 1 — MCP 基础设施 ✅ 完工（v0.16.5）

- **三开环境**：`D:\Proma\`（正式版不动）/ `D:\Proma-dev\`（隔离 `~/.proma-dev/`）/ `D:\Proma-release\`（共享正式版数据，`ISOLATED=0`）
- **22 个 MCP 工具**：11 本地 `mcp__session__*` + 11 远端 `mcp__remote-session__*`
- **外部 MCP 桥接**：`proma-mcp-server.cjs`（stdio）→ localhost HTTP bridge（19876-19895 自动选端口）
- **两变量体系**：`PROMA_INSTANCE_NAME` 管身份 + `PROMA_INSTANCE_ISOLATED` 管数据隔离（v0.16.5 修正）
- **会话间通信**：`send_message` 三模式 — `wait=true` 同步返回 / `notify=true` 异步通知 / `wait=false` + 轮询回收
- **11 个核心补丁** A-K（详见 wiki §5）：A-C 基础能力、D-E 渲染器、F 跨频道防护(被 H 替代)、G SDK 路径、H 跨频道/模型切换完整修复、I 禁更新、J AppUserModelId 隔离、K userData 动态路径
- **remote-session Release 验收**：⚠️ 有条件通过（39/40，1 个 fork new_title Bug，不阻断上线）
- **session-management Skill v1.3.0** + **GitHub 仓库** `orphiczhou/proma-patches` + `apply-patches.sh` v0.16.5

### Layer 2 — 树形会话执行体系 ✅ v0.2.1 + v0.7 Phase A（Layer 1 Hard Gate 已落地）

- **[2026-06-23] v0.7 Phase A 完成** (commit `1757b5e`)：tree-state.js **+12 DbC 校验点**（A1-A7 + HARDEN2/HARDEN6 + V1/V2/V3 审计加固），把 SKILL.md 的"应当"升级为代码"必须"，对应 CP1-CP6 + SP1 + 节点预算 + 加固#2/#6。**实施**: 4 批次真实子会话(自举) + commander 独立验收(dbc-spec 21/0) + 独立对抗审计发现 BLOCKER 已修 V1(restore旁路)/V2(auditor白名单)/V3(expect_outputs非空)。重构提取 collectValidateIssues + resolveAuditorIndep。详见 [note.md](./note.md)。**下一步**: 部署+T1-T4回归 / Phase D / V4-V8深度加固 / Phase B-G / Layer 4 subagent_trace_id
- **核心交付**：tree-state.js v0.2.2 + Phase A（ROLE_ENUM + E_DEPTH_EXCEEDED + 12 DbC + collectValidateIssues + resolveAuditorIndep 白名单 + migrate + 深度限制 + Worker禁子节点 + 根唯一性）、tree-commander SKILL v2.2、tree-worker SKILL v2.2、commander-methodology v1.2（13原则）
- **Q1 v2 验证**（2026-06-21）：全深度 3 层测试 + 3 轮独立 Agent Team 审计，发现 8 项问题（2 阻断/3 严重/2 中等/1 低），核心引擎功能正确但方法论合规性存在结构性缺陷
- **Q2 方案**（v1.1 更新）：(a) **tree-state.js v0.2.2 硬化**（修复 ROOT_PLACEHOLDER、CLI 手动注入、Events 空洞——~90行代码）；(b) 侧边栏树形可视化面板（需新补丁 L）
- **Q3 方案**（v1.2）：天道运行官硬约束流程执行体系（35条规则，audit-gate + Pulse + Auditor + 自检，不新增补丁）
- **技术报告**：[`.context/technical-report-tree-system-issues.md`](technical-report-tree-system-issues.md) — Q1 v2 8 项问题详细分析与解决方案
- **已知限制**：notify未验证、心跳/内审仅方案、竹节交接未实现、I3并发竞态、Commander prune级联未定义

---

## 三、核心架构速查

### 修改方式：两层

| 层 | 文件 | 适用 |
|---|---|---|
| `main.cjs` | sed 字符串替换 | 常量改、小段注入（补丁 A-G） |
| `proma-dev-patches.cjs` | 独立插件文件 | 新增 MCP 工具、复杂逻辑 |

**铁律**：不可从开源源码重构建 main.cjs —— 商业版有 15 个闭源模块（cloudAuth/sync/billing），源构建会导致登录失败。**正确方式：商业版 main.cjs + sed 补丁 + 插件文件。**

### 11 个核心补丁

| 补丁 | 功能 | 关键 |
|---|---|---|
| A | MCP 钩子注入 | `global.__proma_getMcpServers__` |
| B | API 桥接 + 加载插件 | `global.__proma__` 导出 12 个函数 + `require("./proma-dev-patches.cjs")` |
| C1-5 | 频道+模型元数据覆盖 | MCP 创建会话走后端正确频道/模型/API Key |
| D+E | Renderer 同步 + 守卫移除 | UI 模型选择器与 metadata 同步 |
| F | 跨渠道 sdkSessionId 防护 | **已被补丁 H 替代** |
| G | CLAUDE_CONFIG_DIR 无条件覆盖 | 修复 Dev fork 失败 0/3 → 3/3 |
| H | 跨频道/跨 provider 模型切换完整修复（v2） | channelId 或 modelId 任一变化 → 清 sdkSessionId + 同步 meta |
| I | 禁用更新检查 | `initAutoUpdater` 首行 return，不弹更新对话框 |
| J | AppUserModelId 动态隔离 | `com.proma.{NAME}`，三版任务栏独立 |
| K | userData 路径动态化 | `electron-{NAME}`（v0.16.5 修正：双条件 ISOLATED+NAME） |

### 22 个 MCP 工具分组

**本地 `mcp__session__*`**（无 instance 参数，进程内直连 `global.__proma__`）：
`get_my_session_id` / `list_channels` / `list_workspaces` / `list_sessions` / `get_session_info` / `get_session_context` / `list_messages` / `create_session` / `fork_session` / `send_message` / `archive_session`

**远端 `mcp__remote-session__*`**（多一个 `instance` 参数，自动端口扫描）：
`remote_*` 一一对应上述 11 个

### 实例隔离规则

```
PROMA_INSTANCE_ISOLATED=1  →  @proma/electron-{NAME}/  +  ~/.proma-{NAME}/   (隔离)
PROMA_INSTANCE_ISOLATED=0  →  @proma/electron/         +  ~/.proma/         (共享正式版)
未设置                       →  默认共享（兼容旧脚本）
```

✅ **v0.16.5 已修复（补丁 K 修正）**：恢复 `ISOLATED === "1"` 条件。`NAME` 管身份，`ISOLATED` 管隔离，两变量各司其职。Release 设 `PROMA_INSTANCE_NAME=release` + `ISOLATED=0` 即可有独立身份同时共享数据。

---

## 四、关键文档导航

| 文档 | 路径 | 用途 |
|---|---|---|
| **本索引** | `workspace-files/.context/PROJECT-INDEX.md` | 入口 |
| 总路线图 | `workspace-files/.context/proma-innovation-plan.md` | 两层架构总览 + 优先级 |
| 完整技术 Wiki | `workspace-files/.context/proma-dev-wiki.md`（更新至 v0.16.5/v0.2.1） | 补丁命令、架构、测试记录、版本历史 |
| Layer 2 设计 | `workspace-files/.context/tree-commander-design.md` v1.3 | 树形体系完整设计文档 |
| 树形方法论 | `workspace-files/.context/commander-methodology.md` v1.2 | 13原则（含Leaf Purity+分布式写入+三层深度） |
| **进度审计** | `workspace-files/.context/progress-report-2026-06-19.md` | v0.1/v0.2 完成度全面摸底 |
| **Q1 方案** | `workspace-files/.context/plan/q1-state-architecture.md` v1.1 | role枚举+深度限制+分布式写入 |
| **Q1 e2e验证** | `workspace-files/.context/q1-e2e-verification-report.md` | 7 leaf 端到端全通过 |
| **Q1 全深度验证** | `workspace-files/.context/q1-full-depth-report.md` | 10 leaf 3层 38/38 全通过 |
| **Q2 方案** | `workspace-files/.context/plan/q2-tree-ui-panel.md` v1.0 | 侧边栏树形UI面板（未实施） |
| **最新交接** | `workspace-files/.context/handoff/session-2026-06-19-handoff.md` | Q1 v1.1 完结 → Q2 推进 |
| 树形审计方法论 | `workspace-files/.context/tree-audit-methodology.md` | 终局验证 × 树形体系强制执行 |
| remote-session 验收 | `workspace-files/.context/remote-session-release-report.md` | Release 验收 39/40 有条件通过 |
| remote-session 提案 | `workspace-files/.context/proposal-remote-session-mcp.md` | 远端工具设计 + 实例命名 |
| Layer 2 原始设计 | `workspace-files/.context/proma-dev-wiki-timeline-pruner.md` | 时间线剪枝者早期方案 |
| 发布包 | `workspace-files/release/tree-system-v0.2.0/` | v0.2.0 初始版本（17 文件） |
| Skill | `skills/tree-commander/SKILL.md` v2.2 / `skills/tree-worker/SKILL.md` v2.2 | Commander+Worker 操作手册 |
| Skill | `skills/session-management/SKILL.md` v1.3.0 | 会话管理技能 |
| 部署 README | `workspace-files/README.md` + `AGENT-PROMPT.md` | 安装流程 |
| GitHub | `orphiczhou/proma-patches` + `apply-patches.sh` v0.16.5 | 一键部署 |

### 源码文件（部署位置）

| 文件 | 部署路径 | 说明 |
|---|---|---|
| `proma-dev-patches.cjs` | `[安装目录]/resources/app/dist/` | 主插件，含 22 工具 + HTTP bridge |
| `proma-mcp-server.cjs` | 同上 | 外部 stdio MCP 桥接（零依赖） |
| `apply-patches.sh` | 仓库根 | 一键部署 |
| `uninstall.sh` | 仓库根 | 卸载 |

---

## 五、当前卡点与待办

### 🔴 卡点

- **I3 并发竞态丢消息**：同一会话并发 fire-and-forget send_message 存在竞态条件，3 条并发中 2 条静默丢失。需排查 `runAgentHeadless` 并发守卫
- **cloud-auth token 共享冲突**：Release 共享正式版数据时，token 刷新互相踢下线

### 🟡 已知限制

- **remote-session fork new_title 忽略**：Fork 后标题始终追加 "(fork)"，new_title 参数不生效（中等严重度，不阻断）
- **GLM 全线配额耗尽**：ZLM-CodingPlan 和 proma-official 的 GLM 模型均不可用。已验证可用：DeepSeek官方频道的 V4 Pro/Flash + MiniMax-M3
- **notify 异步上报未验证**：所有子会话用 wait=true 同步模式，真正的事件通道异步路由未测试
- **Commander prune/archive 级联未定义**（M5）

### ✅ 已修复（2026-06-18 ~ 2026-06-19）

| 版本 | 修复内容 |
|------|---------|
| v0.16.3 | Bug 1（补丁 H v2：跨频道/跨provider切换）、Bug 4（fork 跨 sdkSession 候选循环试错）、Bug 5（send_message 同步 meta） |
| v0.16.4 | 补丁 I（禁更新）、补丁 J（AppUserModelId 隔离）、补丁 K（userData 动态路径） |
| v0.16.5 | 补丁 K 修正：恢复 `ISOLATED === "1"` 双条件检查，防止 Release 误隔离 |
| v0.2.1 | 洁净室审计 22 项修正 + L1Fix v2 审计（7 worker × 2 round） + Q1 v1.1 架构升级（role枚举/深度限制/migrate/Leaf Purity） |

### ✅ 已澄清（不是 bug）

- **Bug 2（Fork 截断 20 轮）**：auto-compact 从未触发 → Fork 不丢消息。感知错觉来自 `list_messages` 默认 `limit=50`

### 待办优先级

| 优先级 | 任务 |
|---|---|
| P0 | Q3 硬约束体系设计+实施（进度控制） |
| P1 | Q2 树形UI面板实施（补丁 L：proma-tree-view.js + IPC + index.html 注入） |
| P1 | I3 并发竞态修复 |
| P2 | remote-session fork new_title 修复 |
| P2 | v0.3 心跳/内审/竹节交接编码实现 |
| P3 | 模型列表缓存优化、IME 卡顿（已提 issue proma-ai/Proma#870） |

---

## 六、快速命令速查

### 启动

```bash
# Dev 版（双开，隔离数据）
D:\Proma-dev\start-dev.bat   # PROMA_INSTANCE_NAME=dev + ISOLATED=1

# Release 版（日常使用，共享正式版数据）
D:\Proma-release\start-release.bat   # PROMA_INSTANCE_NAME=release + ISOLATED=0
```

### 部署插件（改完代码后）

```bash
# Dev 版
cp proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/
cp proma-mcp-server.cjs D:/Proma-dev/resources/app/dist/
# 重启 Dev 实例

# Release 版（ASAR 不解包，插件放 asar 同级 dist/）
cp proma-dev-patches.cjs D:/Proma-release/resources/app/dist/
cp proma-mcp-server.cjs D:/Proma-release/resources/app/dist/
```

### 打补丁（重建 main.cjs 时）

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/app
cp /tmp/app/dist/main.cjs /tmp/main-patched.cjs
# 按 wiki §5 顺序执行 sed 补丁 A-K
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs
```

### Claude Code 外部 MCP 配置

```json
{
  "mcpServers": {
    "proma-dev-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"]
    }
  }
}
```

---

## 七、关键心智模型

1. **三层实例**：正式版（不可动）/ Dev（隔离双开调试）/ Release（NAME=release + ISOLATED=0，共享正式版数据）
2. **两变量体系**：`PROMA_INSTANCE_NAME` 管身份（remote-session 发现、AppUserModelId）/ `PROMA_INSTANCE_ISOLATED` 管数据隔离（1=独立、0=共享）
3. **两层修改**：sed 改 main.cjs（轻量）/ 插件文件写复杂逻辑（自由）
4. **两类 MCP 工具**：本地 `session`（进程内直连）/ 远端 `remote-session`（HTTP 自动发现，instance 参数）
5. **三种 send_message 模式**：wait 同步 / notify 异步 / fire-and-forget + 轮询
6. **树形体系三层 role**：root（根，唯一，结构性变更）/ commander（子/孙，fork创建，受深度限制，leaf add+管理下属）/ worker（叶子，create_session 干净上下文，只上报不写 tree）
7. **AGPL 合规**：闭源插件通过 `global.__proma__` 桥接调用核心 API，不修改核心代码 → 不构成衍生作品

---

## 八、维护约定

- 重大改动后更新本索引的"当前完成度"和"卡点待办"两节
- 新文档加入"关键文档导航"表
- 补丁新增/修改同步到 wiki §5 和本索引"11 个核心补丁"表
- 旧条目失效及时清理，保持索引 < 250 行
