# Proma 改造项目 — 知识索引

> 入口文档 | 维护: 周星星 | 最后更新: 2026-06-18

新会话从这里开始读，能 5 分钟拿到项目全貌和关键路径。

---

## 一、一句话定位

基于 **Proma 商业版（AGPL-3.0）**，通过 **sed 补丁 + 独立插件文件** 叠加闭源能力，目标是构建垂直化 AI 助手产品。**核心策略：开源做壳，闭源做肉。**

---

## 二、当前完成度（v0.16）

### Layer 1 — MCP 基础设施 ✅ 完工（v0.16.4）

- **三开环境**：`D:\Proma\`（正式版不动）/ `D:\Proma-dev\`（隔离 `~/.proma-dev/`）/ `D:\Proma-release\`（**v0.16.4 起隔离** `~/.proma-release/`）
- **22 个 MCP 工具**：11 本地 `mcp__session__*` + 11 远端 `mcp__remote-session__*`
- **外部 MCP 桥接**：`proma-mcp-server.cjs`（stdio）→ localhost HTTP bridge（19876-19895 自动选端口）
- **实例字符串命名**：`PROMA_INSTANCE_NAME` + `PROMA_INSTANCE_ISOLATED`，`--instance <name>` 自动端口扫描发现
- **会话间通信**：`send_message` 三模式 — `wait=true` 同步返回 / `notify=true` 异步通知 / `wait=false` + 轮询回收
- **10 个核心补丁** A-K（详见 wiki §5）：补丁 A-C/H 基础能力 + 补丁 D/E 渲染器 + 补丁 G SDK 路径 + **补丁 I 禁更新 / 补丁 J 应用 ID / 补丁 K 动态路径**（v0.16.4 新增）
- **session-management Skill v1.3.0**：9 大使用模式 + "第一判断"远端隔离关卡
- **GitHub 仓库**：`orphiczhou/proma-patches`，`apply-patches.sh` 一键部署

### Layer 2 — 时间线的剪枝者 ⏳ 未启动

设计已成型（见 timeline-pruner 文档）：树形任务编排、竹节式自动交接、并行调度+剪枝、可视化侧边栏。**等 Layer 1 Release 验收通过后启动。**

---

## 三、核心架构速查

### 修改方式：两层

| 层 | 文件 | 适用 |
|---|---|---|
| `main.cjs` | sed 字符串替换 | 常量改、小段注入（补丁 A-G） |
| `proma-dev-patches.cjs` | 独立插件文件 | 新增 MCP 工具、复杂逻辑 |

**铁律**：不可从开源源码重构建 main.cjs —— 商业版有 15 个闭源模块（cloudAuth/sync/billing），源构建会导致登录失败。**正确方式：商业版 main.cjs + sed 补丁 + 插件文件。**

### 7 个核心补丁

| 补丁 | 功能 | 关键 |
|---|---|---|
| A | MCP 钩子注入 | `global.__proma_getMcpServers__` |
| B | API 桥接 + 加载插件 | `global.__proma__` 导出 12 个函数 + `require("./proma-dev-patches.cjs")` |
| C1-5 | 频道+模型元数据覆盖 | MCP 创建会话走后端正确频道/模型/API Key |
| D+E | Renderer 同步 + 守卫移除 | UI 模型选择器与 metadata 同步 |
| F | 跨渠道 sdkSessionId 防护 | 避免 "Session 已失效" |
| G | CLAUDE_CONFIG_DIR 无条件覆盖 | 修复 Dev fork 失败 0/3 → 3/3 |

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

✅ **v0.16.4 已修复**（补丁 K）：userData 路径已动态化为 `electron-${PROMA_INSTANCE_NAME}`。

---

## 四、关键文档导航

| 文档 | 路径 | 用途 |
|---|---|---|
| **本索引** | `workspace-files/.context/PROJECT-INDEX.md` | 入口 |
| 总路线图 | `workspace-files/.context/proma-innovation-plan.md` | 两层架构总览 + 优先级 |
| 完整技术 Wiki | `workspace-files/.context/proma-dev-wiki.md`（833 行） | 补丁命令、架构、测试记录 |
| Layer 2 设计 | `workspace-files/.context/proma-dev-wiki-timeline-pruner.md` | 时间线剪枝者完整方案 |
| remote-session 提案 | `workspace-files/.context/proposal-remote-session-mcp.md` | 远端工具设计 + 实例命名 |
| 商业化路线 | `proma-business-plan.md` | 闭源模块清单 + 合规 + 定价 |
| 部署 README | `workspace-files/README.md` | 给 Agent 读的安装流程 |
| Agent 安装提示词 | `workspace-files/AGENT-PROMPT.md` | 一键安装/卸载 |
| Skill | `skills/session-management/SKILL.md`（v1.3.0） | Agent 内置技能 |
| 测试报告 | `workspace-files/.context/mcp-test-report.md` | MCP 工具测试 |
| 内部测试计划 | `workspace-files/.context/internal-test-plan.md` | |

### 源码文件（部署位置）

| 文件 | 部署路径 | 说明 |
|---|---|---|
| `proma-dev-patches.cjs` | `[安装目录]/resources/app/dist/` | 主插件，含 22 工具 + HTTP bridge |
| `proma-mcp-server.cjs` | 同上 | 外部 stdio MCP 桥接（零依赖） |
| `apply-patches.sh` | 仓库根 | 一键部署 |
| `uninstall.sh` | 仓库根 | 卸载 |

---

## 五、当前卡点与待办

### 🟢 v0.16.1 跨频道切换修复 Dev 验证 ✅ 通过 + 发现两个新 bug

- **2026-06-18 上午**：补丁 H（v1 → v2）调研→部署→实测全链路完成。SubAgent 跑矩阵 D/E/F/G（10 用例 7 会话）验证：**补丁 H v2 功能层完全生效**，9 轮跨 provider 切换（GLM↔DeepSeek↔Claude）全部第一轮就成功。
- **同期发现 Bug 4**：fork 跨 sdkSession 失败（agent session 关联多 sdkSession 时 UUID 解析报错）
- **同期发现 Bug 5**：send_message 走 runAgentHeadless 路径，不触发补丁 H 的 meta 同步（功能正常但 meta 仍是旧值）
- **同期澄清 Bug 2**：用户报告"Fork 只剩 20 轮"真相是 list_messages 默认 limit=50 + 感知错觉，Dev 实例无 auto-compact
- **下一步**：补丁 H 同步到 Release；Bug 4/5 进入修复队列

### 🔴 卡点：remote-session Release 验收未通过

- **时间**：2026-06-17，会话 `b18c436b`
- **现象**：11/11 工具返回正常，中文无乱码，但用户判定验收不通过
- **缺失**：具体失败原因未记录在案
- **下一步**：重新跑验收，定位问题

### ⚠️ 已知 Bug

- **cloud-auth token 共享冲突**：Dev 和 Release 共用 token，一方刷新后另一方失效
- **userData 目录名硬编码**：见上节"实例隔离规则"⚠️

### ✅ v0.16.4 系统改进（2026-06-19）

- **补丁 I**：禁用更新检查（Dev + Release 启动不再弹更新对话框）
- **补丁 J**：AppUserModelId 动态隔离（修复 Dev 退出时正式版快捷方式失效）
- **补丁 K**：userData 路径动态化（修硬编码 `electron-dev` 已知 bug）
- **Release 托盘图标**：白色 → 珊瑚色
- **Release 启动脚本**：改为隔离 profile，新增 `start-release-fresh.bat`
- **IME 卡顿问题**：已提交 proma-ai/Proma#870，待作者跟进

### ✅ 已修复（2026-06-18 v0.16.3）

- **Bug 1**（跨频道切换丢上下文）— 补丁 H v2（Dev v0.16.1 + Release v0.16.3 同步）
- **Bug 4**（fork 跨 sdkSession）— main.cjs `forkAgentSession` 入口加 `_forceSdkSessionId` 透传 + patches.cjs `fork_session` 收集候选 sdkSessionId 循环试错
- **Bug 5**（send_message 不同步 meta）— patches.cjs `send_message` handler 镜像补丁 H 逻辑（同步 meta + 清空 sdkSessionId）

### ✅ 已澄清（不是 bug）

- **Bug 2（Fork 截断 20 轮）真相 = 不存在**（2026-06-18 矩阵 F3 验证）：Dev 实例 3 个长会话（289/411/415 行 JSONL）全部没有 `compact_boundary` 标记，auto-compact 从未触发。Fork 也不丢消息（E1 实测能完整复述）。用户感知"只剩 20 轮"是 `list_messages` 默认 `limit=50` + 偏移错觉

### 待办优先级

| 优先级 | 任务 |
|---|---|
| P0 | v0.16.3 重启 Dev + Release 实例，回归测试（验证 Bug 4/5 修复） |
| P0 | remote-session Release 验收重测 + 修复 |
| P1 | Layer 2 时间线剪枝者启动 |
| P3 | 模型列表缓存优化 |

---

## 六、快速命令速查

### 启动

```bash
# Dev 版（双开，独立数据）
D:\Proma-dev\start-dev.bat   # 设置 PROMA_DEV=1 + PROMA_INSTANCE_NAME=dev

# Release 版（与正式版互斥，共享数据）
D:\Proma-release\start-release.bat   # PROMA_INSTANCE_NAME=release
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
# 按 wiki §5 顺序执行 sed 补丁 A-G
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

1. **三层实例**：正式版（不可动）/ Dev（隔离双开调试）/ Release（共享数据日常用）
2. **两层修改**：sed 改 main.cjs（轻量）/ 插件文件写复杂逻辑（自由）
3. **两类 MCP 工具**：本地 `session`（进程内直连）/ 远端 `remote-session`（HTTP 自动发现）
4. **三种 send_message 模式**：wait 同步 / notify 异步 / fire-and-forget + 轮询
5. **AGPL 合规**：闭源插件通过 `global.__proma__` 桥接调用核心 API，不修改核心代码 → 不构成衍生作品（参考商业版自身 15 个闭源模块先例）

---

## 八、维护约定

- 重大改动后更新本索引的"当前完成度"和"卡点待办"两节
- 新文档加入"关键文档导航"表
- 补丁新增/修改同步到 wiki §5 和本索引"7 个核心补丁"表
- 旧条目失效及时清理，保持索引 < 250 行
