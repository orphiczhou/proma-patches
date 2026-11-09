# Proma-Pro 重打进展（谱系 + 0.21.92 基线）

> 本文是**跨项目的积累页**：记录本项目（session-management patch kit，0.12–0.15 期）之后，
> Proma-Pro 定制版这条线怎么演进到 0.21.92，以及 2026-11-09 这一轮的做法与实测结论。
> 补丁代码本体在 **`orphiczhou/Proma-fix-patch`**；本文只做索引、判断依据和教训沉淀。

## 1. 谱系（两条线的分工）

| 时期 | 仓库 | 形态 | 目标 |
|---|---|---|---|
| 2026-06 ~ 2026-07 | `orphiczhou/proma-patches`（本项目） | `sed` 补丁 + 插件文件（`proma-dev-patches.cjs` / `proma-mcp-server.cjs`） | 双开、会话管理 MCP、模型元数据覆盖、跨渠道 sdkSessionId 防护 |
| 2026-09 ~ 现在 | `orphiczhou/Proma-fix-patch` | bundle 补丁脚本（`patch-main.cjs`）+ asar 工具链 + 6 阶段 SOP | Proma-Pro 四块改造：跨渠道子会话 / 1M 上下文 / Pro 数据隔离 / 绿图标+禁更新 |

两条线的关键差别：本项目改的是 **main.cjs 里的字符串 + asar 外部插件**；Proma 后期把主进程逻辑全部打进 `dist/main.cjs` 单文件 bundle，插件式注入（`require("./proma-dev-patches.cjs")`）不再适用，补丁必须直接改 bundle。因此 0.15 之后本项目只保留历史价值，活跃开发迁到 Proma-fix-patch。

## 2. 0.21.92 这一轮（2026-11-09）

### 版本事实

- 官方更新器通道最新：`https://api.proma.cool/api/v1/updates/latest.yml` → **0.21.92**（releaseDate 2026-11-04）
- GitHub `proma-ai/Proma` releases 停在 **0.19.58**，不能用来判断最新版（本项目 0.12 期的"看 releases"经验已经失效）
- 本机部署：`D:\Proma-Pro`（即 0.21.92，`start-pro.bat` + `PROMA_DEV=1`，桌面「Proma Pro」快捷方式指这里）；回滚保留 `D:\Proma-Pro-0.19.53`、`D:\Proma-Pro-0.14.23`（原 `D:\Proma-Pro` 的 0.14.23，已改名）。三者共用 `~/.proma-pro` 与 `@proma/electron-pro`，同一单实例锁只能开一个

### 与 0.19.53 相比的补丁面变化

| 变化 | 影响 | 处理 |
|---|---|---|
| `getAvailableAgentModels` 只改了 `note` 文案 | 整函数逐字匹配 0 命中 | B2 改**区间替换**（函数边界做锚点） |
| `launchDelegation` 改读 `record3.channelId` | 0.19.53 的 B3d 锚点消失 | 删除 B3d；跨渠道靠 B3c 写 `record3.channelId` |
| `inferCodexAlignedGPT5ContextWindow` 新增 gpt-6 分支 | E1 的 `switch (model)` 锚点失效 | E1 锚点换成函数头 + `const model` 两行 |
| 1M 规则表 glm 新增 `glm-5.3-flashx` | E2b 匹配串失配 | 跟随官方列表更新匹配串（`glm-` 前缀仍是超集） |
| 新增 `getEnabledAgentModelSource(channel)` | 官方渠道模型走 `agentModels` | 注入函数改用该 helper |
| `opencode-go-openai` provider 被官方停用 | 0.19.53 的 "GLM zai 字段 400 修复" 作废 | 整块归档，不再重打 |

改动点从 12 个降到 11 个（B3d 消失，新增可选 B2b 工具描述），diff 仍是 10 hunks。

### 实测结论（真实 App，非 mock）

- 数据隔离：`PROMA_DEV=1` 启动后 `%APPDATA%\@proma\electron-pro` 与 `~/.proma-pro` 同时被写入；181 条历史会话 + 渠道 + 登录态同机继承，无需重配
- **跨渠道子会话（核心）**：父会话 GLM（`zhipu-coding` / glm-5.3），`delegate_agent(modelId="deepseek-flash")` 派出的子会话 metadata 为 `channelId=DeepSeek 渠道 / modelId=deepseek-flash`，子会话落盘 `_channelProvider: "deepseek"`，回复「跨渠道 OK」，UI 显示 `DeepSeek · deepseek-flash`
- `list_available_agent_models` 返回 7 个模型 / 3 个渠道（GLM、DeepSeek、小米 MiMo），含 `channelId` / `channelName` / `provider` / `channelCount`
- 图标：exe 内嵌图标为绿色（408,142 字节 7 档 ico），`PromaPro.exe` 版本号 0.21.92

### 可复用的新做法（已写回 Proma-fix-patch 的 known-pitfalls 15–20）

1. **母本直接 robocopy 已安装目录**：`MSYS_NO_PATHCONV=1 robocopy "D:\Proma" "D:\Proma-Pro-<版本>" /E /R:1 /W:1`，运行中的 Electron 目录可读复制（736 文件 0 失败，2 秒）；比找 7za 解 setup 省事。git bash 里 `/E` 必须配 `MSYS_NO_PATHCONV=1`，否则被路径转换吃掉。
2. **rcedit v5 只导出 `exports`**：绝对路径 require 必然 MODULE_NOT_FOUND；用 `module.paths.push(<全局 node_modules>)` 后按包名 require。
3. **CDP 做渲染层验证**：`--remote-debugging-port=<port>` + Node 内置 `WebSocket`，`window.electronAPI` 有 429 个 IPC 方法（`listChannels` / `listAgentSessions` / `deleteAgentSession`），`Input.insertText` + `dispatchKeyEvent` 可把消息真正发进会话，端到端验证跨渠道；验证完必须关掉调试实例再正常重启。
4. **官方文案变动是最脆的锚点**：结构没变时优先区间替换，不要死磕逐字匹配。
5. **官方停用 provider 会让整块补丁作废**：重打前先 grep provider 是否还在，别把旧补丁硬套到已删除的代码路径上。

### 操作顺序（下次升级照抄）

1. `curl https://api.proma.cool/api/v1/updates/latest.yml` 确认最新版
2. 备份 `~/.proma-pro`（整目录 + 关键 json 到 `.bak-pre-<版本>/`）
3. `robocopy` 已安装 `D:\Proma` → `D:\Proma-Pro-<版本>`
4. `read-asar.cjs` 读 `package.json` 确认版本 → `--check` 主 cjs
5. 侦察锚点（对照 `references/patch-anchors.md` + 新版本基线）
6. `patch-main.cjs` 应用 → 计数 + `--check` + diff hunks 审计
7. 解包 asar → 合并 unpacked（skia 27,294,720 字节校验）→ 注入 main.cjs → 停用 asar
8. 绿 ico 两处 + rcedit 副本 exe + `app-update.yml` 断源 + `start-pro.bat`
9. `PROMA_DEV=1` 启动验证（数据目录 / 图标 / 跨渠道 / 1M），CDP 可做端到端
10. 打 portable zip（排除 `Proma.exe` 与 `app.asar.original`），把新基线写回 `Proma-fix-patch`

## 3. 本项目的历史模块（仍可作为参考）

- `proma-dev-patches.cjs`：11 个 session MCP 工具（`list_channels` / `create_session` / `fork_session` / `send_message` / `get_session_context` …）+ 模型元数据覆盖 + 跨渠道 `sdkSessionId` 防护。这些能力在 0.19+ 已被官方原生 MCP 工具与 Pi runtime 取代，**新版本不要再照搬**。
- `模块 A/B`（双开 dev / release 并行）：数据隔离思路演化成今天的 `PROMA_DEV=1` + `~/.proma-pro` + `@proma/electron-pro`。
- `模块 6`（图标）：演化成 `build-ico.cjs` + `green.ico`（408,142 字节），并踩出"旧部署目录的 icon.ico 是官方黑白 logo"这个坑。

## 4. 待办 / 可继续推进

- 上游反馈：0.19.53 期的 GLM-5.3 opencode-go 400 已提 issue `proma-ai/Proma#2065`；0.21.92 官方停用该渠道，issue 可按"已被替代方案解决"收尾。
- 跨渠道子会话的**官方内建**仍未出现（工具 schema 只有 `modelId`、无 `channelId`），所以补丁需长期跟。
- 1M 上下文规则若官方继续扩表（新增 glm/qwen/claude 型号），E1/E2 范围应收窄到"官方未覆盖的家族"，避免把官方有意限定的模型放大。
