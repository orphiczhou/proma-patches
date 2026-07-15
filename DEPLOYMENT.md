# Proma 改造项目 — 部署指南

> 文档类型: P1 工程文档（部署）
> 维护: 周星星 | 创建: 2026-06-26
> 配套文档: [`.context/PROJECT-INDEX.md`](./.context/PROJECT-INDEX.md) | [`README.md`](./README.md) | [`.context/note.md`](./.context/note.md) | [`DEVELOPMENT.md`](./DEVELOPMENT.md) | [`TESTING.md`](./TESTING.md)

---

## 一、前置条件

### 1.1 软件依赖

| 组件 | 版本 | 说明 |
|---|---|---|
| **Proma 商业版** | v0.12.23 | 必须安装在 `D:\Proma\`（asar 打包后的原始包，作为对照） |
| **Node.js** | 18+ | 推荐 v22.x；脚本使用 `npx asar` 解包，需要 Node 自带 npm |
| **Git** | 任意 | 用于克隆 `orphiczhou/proma-patches` 仓库 |
| **Windows 10/11** | — | 本项目主要在 Windows 上验证，bat 启动脚本依赖 cmd.exe |
| **Bash** | — | Git Bash / WSL 均可；`apply-patches.sh` 用 bash 语法 |
| **VSCode**（可选） | 推荐 | 编辑 sed 补丁、查看 571007 行 main.cjs |

### 1.2 目录约定（硬约束）

本项目所有路径已硬编码在脚本与文档中，部署前请确认：

| 路径 | 角色 | 备注 |
|---|---|---|
| `D:\Proma\` | **正式版**（不可动） | 已 asar 打包（135MB），作为对照基线，**禁止修改** |
| `D:\Proma-dev\` | **多实例 launcher 目录** | 4 个主题 exe + start-*.bat，承载 dev/pro/release/release-fresh |
| `~/.proma/` | 正式版 + Release 共享数据 | `ISOLATED=0` 时使用 |
| `~/.proma-dev/` | Dev 实例独立数据 | `ISOLATED=1` 时使用 |
| `~/.proma-pro/` | Pro 实例独立数据 | `ISOLATED=1` 时使用 |
| `~/.proma-release-fresh/` | Release-Fresh 独立数据 | `ISOLATED=1` 时使用 |

### 1.3 凭据数据（首次部署必须同步）

Dev/Pro/Release-Fresh 是**隔离实例**，首次部署必须从正式版同步登录态：

```bash
cp ~/.proma/cloud-auth.json ~/.proma-dev/
cp ~/.proma/channels.json ~/.proma-dev/
cp ~/.proma/user-profile.json ~/.proma-dev/
cp -r "%APPDATA%/@proma/electron/Network" "%APPDATA%/@proma/electron-dev/"
cp -r "%APPDATA%/@proma/electron/Session Storage" "%APPDATA%/@proma/electron-dev/"
cp -r "%APPDATA%/@proma/electron/Local Storage" "%APPDATA%/@proma/electron-dev/"
```

Release 实例 `ISOLATED=0`，**共享 `~/.proma/`，无需同步**。

### 1.4 仓库克隆

```bash
git clone https://github.com/orphiczhou/proma-patches
cd proma-patches
```

仓库根包含：
- `apply-patches.sh` — 一键 sed 补丁部署脚本（v0.16.6）
- `proma-dev-patches.cjs` — 主插件（22 MCP 工具 + HTTP bridge）
- `proma-mcp-server.cjs` — 外部 stdio MCP 桥接（零依赖）
- `skills/` — tree-commander / tree-worker / session-management SKILL
- `uninstall.sh` — 卸载脚本
- `tree-engine.cjs` — Tree 状态引擎（v0.7+ 内联进 patches.cjs）

---

## 二、三种部署模式对比

### 2.1 模式总览

| 模式 | 目录 | 数据隔离 | EXE | 推荐场景 |
|---|---|---|---|---|
| **A. 双开 Dev** | `D:\Proma-dev\` | `ISOLATED=1`，独立 `~/.proma-dev/` | `Proma-white.exe` | 开发调试、跑测试套件 |
| **B. Release 共享** | `D:\Proma-dev\` | `ISOLATED=0`，共享 `~/.proma/` | `Proma-coral.exe` | 日常使用、对接真实工作区 |
| **C. 直改正式版** | `D:\Proma\` | 无（asar 打包） | `Proma.exe` | **不推荐**，破坏对照基线 |

### 2.2 选择决策树

```
你要做什么？
├── 改 patches.cjs / tree-engine.cjs / 写新 SKILL → 选 A（隔离调试）
├── 用 Tree 体系做真实任务（生产场景）         → 选 B（共享数据）
└── 想直接 patch 正式版？                      → 别选 C，会破坏对照基线
                                                 选 A 调试通过 → cp 到 B → 用 B
```

### 2.3 三实例运行架构（成功部署后的标准拓扑）

```
release @ 127.0.0.1:19876  (start-release.bat, Proma-coral)   ← 共享 ~/.proma/
dev     @ 127.0.0.1:19877  (start-dev.bat,     Proma-white)   ← 独立 ~/.proma-dev/
pro     @ 127.0.0.1:19878  (start-pro.bat,     Proma-green)   ← 独立 ~/.proma-pro/
（端口 fallback 链：先启动的占 19876，后启动的自动 +1）
```

---

## 三、模式 A：Dev 部署（step-by-step）

> 目标：在 `D:\Proma-dev\` 部署隔离开发版，可同时与正式版运行不冲突。

### 3.1 步骤 1：复制 Proma 到 Dev 目录

```bash
cp -r D:/Proma D:/Proma-dev
```

### 3.2 步骤 2：解包 ASAR

```bash
cd D:/Proma-dev/resources
npx asar extract app.asar app
mv app.asar app.asar.disabled   # 让 Electron 加载 app/ 目录而非 app.asar
```

### 3.3 步骤 3：合并原生模块

```bash
cp -r app.asar.unpacked/node_modules/* app/node_modules/
```

> 缺失此步可能导致 native module 加载失败（如 keytar / better-sqlite3）。

### 3.4 步骤 4：同步认证数据

```bash
mkdir -p ~/.proma-dev
cp ~/.proma/cloud-auth.json     ~/.proma-dev/
cp ~/.proma/channels.json       ~/.proma-dev/
cp ~/.proma/user-profile.json   ~/.proma-dev/

# Electron 缓存目录同步（关键，否则登录态丢失）
cp -r "%APPDATA%/@proma/electron/Network"        "%APPDATA%/@proma/electron-dev/"
cp -r "%APPDATA%/@proma/electron/Session Storage" "%APPDATA%/@proma/electron-dev/"
cp -r "%APPDATA%/@proma/electron/Local Storage"   "%APPDATA%/@proma/electron-dev/"
```

### 3.5 步骤 5：运行 apply-patches.sh

```bash
cd /path/to/proma-patches
bash apply-patches.sh dev
```

脚本会自动完成：
- 提取商业版 `main.cjs` 到临时目录
- 按顺序执行 sed 补丁 A-K（11 个补丁）
- 部署 `proma-dev-patches.cjs` / `proma-mcp-server.cjs` / `tree-engine.cjs` 到 `D:/Proma-dev/resources/app/dist/`
- 生成 `start-dev.bat` 启动脚本

### 3.6 步骤 6：确认 start-dev.bat 配置

`D:\Proma-dev\start-dev.bat` 必须满足：

```bat
@echo off
set PROMA_INSTANCE_NAME=dev
set PROMA_INSTANCE_ISOLATED=1
set PROMA_DEV=1
"D:\Proma-dev\Proma-white.exe"
```

**关键校验**：
- `PROMA_INSTANCE_NAME=dev` —— 身份标识，决定 AppUserModelId / userData 路径
- `PROMA_INSTANCE_ISOLATED=1` —— 数据隔离（补丁 K 双条件之一）
- **不能出现** `set PROMA_BRIDGE_HOST=0.0.0.0` —— 会触发端口遮蔽 bug（详见 §八）
- **必须 ASCII only**，REM 注释也不能含中文（详见 §八）

### 3.7 步骤 7：启动 Proma-white.exe

双击 `start-dev.bat`。托盘出现白色图标即成功。

### 3.8 步骤 8：验证

在 Dev 实例的 Agent 会话中说：

> "用 list_channels 列出可用频道"

应返回 4 个频道。完整验证清单见 §五。

---

## 四、模式 B：Release 部署（step-by-step）

> 目标：在 `D:\Proma-dev\` 多实例 launcher 下部署 Release 实例，与正式版共享 `~/.proma/`。

### 4.1 前提

模式 A 已完成（D:\Proma-dev 已建立），仅追加 Release launcher。

### 4.2 步骤 1：再次运行 apply-patches.sh（如未运行）

```bash
bash apply-patches.sh release
```

> Release 与 Dev 共享 `D:\Proma-dev\resources\app\dist\`（同一份代码），仅靠环境变量区分身份。

### 4.3 步骤 2：确认 start-release.bat 配置

`D:\Proma-dev\start-release.bat` 必须满足：

```bat
@echo off
set PROMA_INSTANCE_NAME=release
set PROMA_INSTANCE_ISOLATED=0
"D:\Proma-dev\Proma-coral.exe"
```

**关键校验**：
- `PROMA_INSTANCE_NAME=release`
- `PROMA_INSTANCE_ISOLATED=0` —— **共享** `~/.proma/`（与正式版互斥，不能同时跑）
- 无 `PROMA_DEV=1`（v0.16.5 后两变量体系分离，NAME 管身份 / ISOLATED 管隔离）
- ASCII only

### 4.4 步骤 3：启动 Proma-coral.exe

**前提**：正式版（`D:\Proma\Proma.exe`）必须**已退出**（共享 `~/.proma/` 会文件锁冲突）。

双击 `start-release.bat`。托盘出现珊瑚色图标即成功。

### 4.5 步骤 4：验证

在 Release 实例 Agent 会话中调 `mcp__session__list_channels` → 应返回与正式版相同的 4 个频道（因为共享数据）。

---

## 五、部署后验证清单

部署后**必须逐项验证**，任一失败需排查（见 §八）：

### 5.1 MCP 工具注册

```text
[ ] mcp__session__list_channels → 返回 4 个频道
[ ] mcp__session__list_workspaces → 返回工作区列表
[ ] mcp__session__get_my_session_id → 返回当前 session UUID
[ ] mcp__tree__tree_validate(tree_id=任意测试树) → 返回 {ok:true, issues:[]}
```

### 5.2 实例发现（remote-session）

```text
[ ] mcp__session__discover_instances(refresh=true)
    → 应同时返回 release@19876 + dev@19877（如已启动 pro 还有 pro@19878）
[ ] mcp__remote-session__remote_list_channels(instance="dev")
    → 返回与本地 list_channels 相同的 4 个频道
```

### 5.3 HTTP bridge 监听

```bash
netstat -ano | grep -E ":1987[6-9]"
```

应看到每个已启动实例各占一个端口，且**全部为 `127.0.0.1:1987x`**（不能出现 `0.0.0.0:1987x`）。

### 5.4 SKILL 激活

```text
[ ] ~/.claude/skills/tree-commander/SKILL.md 存在
[ ] ~/.claude/skills/tree-worker/SKILL.md 存在
[ ] ~/.claude/skills/session-management/SKILL.md 存在
```

激活命令（如未自动激活）：

```bash
mkdir -p ~/.claude/skills
cp -r proma-patches/skills/* ~/.claude/skills/
```

### 5.5 Tree 引擎可用性

在 Agent 会话中：

```text
> mcp__tree__tree_help(topic="how_to_init")
应返回 init 命令用法 + tips.next_steps

> mcp__tree__tree_init(tree_id="deploy-smoke", root_brief={...}, root_dod={max_depth:3, node_budget:10})
应返回 {ok:true, tips:{next_steps:[...], skill_reference, pro_tip}}

> mcp__tree__tree_validate(tree_id="deploy-smoke")
应返回 {ok:true, issues:[]}
```

### 5.6 配置 MCP 客户端（Claude Code 等）

`~/.claude/mcp.json` 或等价配置：

```json
{
  "mcpServers": {
    "proma-dev-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"]
    },
    "proma-release-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--release"]
    }
  }
}
```

---

## 六、升级流程

### 6.1 代码升级（不改 main.cjs）

适用：仅修改 `proma-dev-patches.cjs` / `tree-engine.cjs` / `proma-mcp-server.cjs`。

```bash
# 1. 拉最新代码
cd /path/to/proma-patches
git pull

# 2. 备份当前部署版本
cp D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs \
   D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs.bak-$(date +%Y%m%d)-pre-upgrade
cp D:/Proma-dev/resources/app/dist/tree-engine.cjs \
   D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-$(date +%Y%m%d)-pre-upgrade

# 3. 部署新版
cp proma-dev-patches.cjs  D:/Proma-dev/resources/app/dist/
cp tree-engine.cjs        D:/Proma-dev/resources/app/dist/
cp proma-mcp-server.cjs   D:/Proma-dev/resources/app/dist/

# 4. **必须重启实例才加载新代码**（patches.cjs 在 Electron 主进程启动时 require）
```

### 6.2 main.cjs 升级（sed 补丁改动）

适用：修改了补丁 A-K 中任一 sed 命令。

```bash
# 1. 重新提取商业版 main.cjs
npx asar extract D:/Proma/resources/app.asar /tmp/proma-app
cp /tmp/proma-app/dist/main.cjs /tmp/main-patched.cjs

# 2. 按 wiki §5 顺序执行所有 sed 补丁（A → K）
#    推荐直接 bash apply-patches.sh 重新跑完整流程

# 3. 备份 + 部署
cp D:/Proma-dev/resources/app/dist/main.cjs \
   D:/Proma-dev/resources/app/dist/main.cjs.bak-$(date +%Y%m%d)-pre-main-upgrade
cp /tmp/main-patched.cjs D:/Proma-dev/resources/app/dist/main.cjs

# 4. 重启 Dev/Release 实例
```

### 6.3 SKILL 升级

```bash
cp -r proma-patches/skills/* ~/.claude/skills/
# SKILL 是按需加载的，无需重启实例；下次会话自动读到新版
```

### 6.4 v0.17.0 私有化发布升级（2026-07-15）

> 首次正式发布版本。详细发布说明见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。本节给团队已有 pro 实例的具体升级路径。

**前提**：pro 实例已按 §三 部署好（`D:/Proma-dev` + `~/.proma-dev` 隔离数据）。

**步骤**：

```bash
# 1. 完全退出 pro（含托盘），避免文件锁冲突

# 2. 备份当前 dist（关键，回滚依赖）
cd D:/Proma-dev/resources/app/dist
cp tree-engine.cjs        tree-engine.cjs.bak-pre-v0.17.0
cp proma-dev-patches.cjs  proma-dev-patches.cjs.bak-pre-v0.17.0

# 3. 部署 v0.17.0 dist（从发布包 cp）
cp <release-pkg>/dist/tree-engine.cjs        D:/Proma-dev/resources/app/dist/
cp <release-pkg>/dist/proma-dev-patches.cjs  D:/Proma-dev/resources/app/dist/

# 4. md5 校验（tree-engine 应为 3efe6a2b）
node -e "console.log(require('crypto').createHash('md5').update(require('fs').readFileSync('D:/Proma-dev/resources/app/dist/tree-engine.cjs')).digest('hex').slice(0,8))"
# 期望输出：3efe6a2b

# 5. 部署 SKILL（文件级即生效，无需重启）
cp -r <release-pkg>/skills/* ~/.proma-dev/agent-workspaces/default/skills/

# 6. 启动 pro（patches.cjs 在 Electron 主进程启动时 require，加载新引擎）
```

**验证**：

```text
[ ] pro 启动后，agent 调 mcp__tree__tree_help(topic="how_to_init") → 返回 tips.next_steps
[ ] tree-engine.cjs md5 = 3efe6a2b
[ ] commander SKILL §14.1a 存在（自审事故教训）
[ ] worker SKILL §4.6 触发条件含「worker 主动自检触发」
```

**v0.17.0 关键变更**：
- 引擎：prefix 前置校验（cmdInit）+ isFlagged dead code 清理 + Sprint 5 max_sessions 硬护栏
- SKILL：commander §14.1a（自审事故教训）+ §13.5（调用形式事故收敛）+ worker §4.6（主动触发强化）+ 全面脱敏
- 测试：367/0 全量绿 + prefix-init-test 17/0 新增

**回滚**：

```bash
cp D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-pre-v0.17.0 \
   D:/Proma-dev/resources/app/dist/tree-engine.cjs
cp D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs.bak-pre-v0.17.0 \
   D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs
# 重启 pro（SKILL 无需回滚，文件级即生效）
```

---

## 七、回滚流程

### 7.1 单文件回滚（推荐）

```bash
# 假设 6/26 升级失败，要回滚到 6/25 版本
cp D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-20260625-pre-upgrade \
   D:/Proma-dev/resources/app/dist/tree-engine.cjs

# 重启实例生效
```

### 7.2 全量回滚（多个 .bak-* 一起回滚）

```bash
# 列出所有备份
ls D:/Proma-dev/resources/app/dist/*.bak-*

# 按日期选择目标版本，逐个 cp 回原名
for f in proma-dev-patches.cjs tree-engine.cjs main.cjs proma-mcp-server.cjs; do
  cp "D:/Proma-dev/resources/app/dist/${f}.bak-20260625-pre-upgrade" \
     "D:/Proma-dev/resources/app/dist/${f}"
done

# 重启所有实例
```

### 7.3 tree-state.json 级回滚（Tree 数据）

Tree 引擎自带 `tree_backup` / `tree_restore` 子命令：

```text
> mcp__tree__tree_backup(tree_id="my-tree", label="pre-rollback")
> mcp__tree__tree_restore(tree_id="my-tree", backup_file="<timestamp-label>.json")
```

> V1 加固后，`tree_restore` 前会自动跑 `collectValidateIssues`，确保 backup 合规才能恢复（详见 `.context/note.md` 6/23 Phase A 条目）。

---

## 八、已知部署坑（高频踩坑速查）

### 8.1 0.0.0.0:19876 端口遮蔽 bug（**最常见**）

**现象**：
- `discover_instances` 漏看 dev/pro 实例（只返回 release）
- `mcp__remote-session__remote_*(instance="dev")` 报 "No instance named 'dev' found"
- 但 Dev 实例本身的 agent 能正常调 `mcp__session__*`

**根因**：start-*.bat 设了 `set PROMA_BRIDGE_HOST=0.0.0.0`，导致 dev bridge 绑 `0.0.0.0:19876`。Windows 上 `0.0.0.0:port` 与 `127.0.0.1:port` 可共存（不同 socket），但所有 `127.0.0.1:19876` 流量被路由到 release，dev 完全收不到。

**验证**：

```bash
netstat -ano | grep ":19876"
# 看到 0.0.0.0:19876 (dev) + 127.0.0.1:19876 (release) 共存 = 中招
```

**修复**：删除 start-*.bat 中的 `set PROMA_BRIDGE_HOST=0.0.0.0` 一行。让 patches.cjs 的端口 fallback 链正常工作（dev 试 19876 失败 → fallback 19877）。

详见 `.context/note.md` 6/24 条目。

### 8.2 bat 文件必须 ASCII only

**现象**：双击 start-*.bat 后 cmd 窗口一闪关闭，Proma-white.exe 完全没启动。

**根因**：Windows cmd.exe 默认按系统 ANSI 编码（中文 Windows 是 GBK）解析 .bat。UTF-8 多字节字符（含中文 REM 注释）会让 cmd.exe 解析失败，整个脚本静默 abort。

**验证**：

```bash
file D:/Proma-dev/start-dev.bat
# "ASCII text" = OK
# "Unicode text, UTF-8 text" = 有毒
```

**修复**：所有 `D:\Proma-dev\*.bat` **必须 ASCII only**，REM 注释也不能含中文/UTF-8。

### 8.3 userData 路径迁移（补丁 K 双条件）

**现象**：Dev 实例登录态丢失，或与正式版串数据。

**根因**：补丁 K 早期版本只查 `PROMA_INSTANCE_NAME`，导致 Release（NAME=release）也走 `electron-release/` 隔离路径，丢失共享语义。

**修复**（v0.16.5 已修）：补丁 K 改为**双条件**：

```text
ISOLATED === "1"  →  @proma/electron-{NAME}/   +  ~/.proma-{NAME}/   (隔离)
ISOLATED === "0"  →  @proma/electron/          +  ~/.proma/          (共享正式版)
未设置              →  默认共享（兼容旧脚本）
```

**校验**：
- Dev: `PROMA_INSTANCE_NAME=dev` + `PROMA_INSTANCE_ISOLATED=1`
- Release: `PROMA_INSTANCE_NAME=release` + `PROMA_INSTANCE_ISOLATED=0`
- 两个变量**各司其职**，不能合并

### 8.4 补丁 H 长命令破坏 sed（必须 Edit 工具或 .sh 脚本）

补丁 H（跨频道/跨 provider 模型切换完整修复 v2）的注入内容含 `&&`，通过 shell 直接调 sed 会被解析为命令分隔符破坏文件。

**正确做法**：
- 用 Edit 工具直接修改 main.cjs（不要 sed）
- 或把 sed 命令写到 .sh 脚本里 `bash xxx.sh` 执行

`apply-patches.sh` 已封装好，不要手动复现补丁 H 的 sed 命令。

### 8.5 patches.cjs 静默加载失败

**现象**：`mcp__session__list_channels` 不可用，但 Proma 主进程没报错。

**根因**：patches.cjs 1181 行 `createExternalHttpBridge()` 是同步调用但内部是 async IIFE，**IIFE 内部错误不冒泡**，main.cjs 570900 行的 try/catch 会吞掉错误继续。

**诊断技巧**：判定 patches.cjs 是否加载最有效的方法是让实例 agent 列工具 + 调 `mcp__session__list_channels`，**远胜于扫端口**。

### 8.6 正式版 ASAR 与 Dev dist 完全分叉

`D:\Proma\resources\app.asar`（135MB 单文件）是 v0.12.23 原始版，**无任何 sed 补丁**。`D:\Proma-dev\resources\app\dist\` 已远超（tree-engine.cjs 4928 行 vs 正式版 0）。

**禁止**直接修改正式版 asar —— 一旦破坏，重建 Dev 流程会失败。

### 8.7 Proma-coral 与 Proma-black 数据冲突

Release（`Proma-coral.exe`, ISOLATED=0）与正式版（`Proma.exe`）共享 `~/.proma/`。**两者不能同时运行**（Electron 单实例锁 + 文件锁）。

**正确操作**：先完全退出正式版（含托盘），再启动 Release。

### 8.8 PROMA_BRIDGE_HOST 与 LAN 可见的取舍

某些场景需要局域网内其他机器访问 Dev bridge（如远程调试）。当前默认 `127.0.0.1` 牺牲了 LAN 可见。

**正确方案**：在 patches.cjs 里改成"试 19877 成功后再 alias 0.0.0.0"，而不是粗暴覆盖 bindHost。当前 v0.16.6 未实现此能力，留待后续。

---

## 九、卸载流程

### 9.1 仅回滚代码（保留 Dev 目录）

```bash
cd /path/to/proma-patches
bash uninstall.sh
```

回滚 main.cjs 到商业版原始版，删除 patches.cjs / tree-engine.cjs / proma-mcp-server.cjs。

### 9.2 完全删除 Dev 环境

```bash
# 1. 退出所有 Proma 实例（含托盘）
# 2. 删除 Dev 目录
rm -rf D:/Proma-dev
# 3. 删除隔离数据（如不再需要）
rm -rf ~/.proma-dev ~/.proma-pro ~/.proma-release-fresh
rm -rf "%APPDATA%/@proma/electron-dev"
# 4. 正式版不受影响
```

---

## 十、相关文档导航

| 文档 | 用途 |
|---|---|
| [`.context/PROJECT-INDEX.md`](./.context/PROJECT-INDEX.md) | 项目索引（5 分钟拿全貌） |
| [`.context/project-onboarding-guide-2026-06-25.md`](./.context/project-onboarding-guide-2026-06-25.md) | 30 分钟图形化向导 |
| [`.context/note.md`](./.context/note.md) | 长期调研笔记（按日期追加在顶部） |
| [`.context/proma-dev-wiki.md`](./.context/proma-dev-wiki.md) | 完整技术 Wiki（含补丁命令 §5） |
| [`README.md`](./README.md) | 仓库 README（含交互式 Agent 安装流程） |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | 开发指南（Tree 模式 + IHL 方法论） |
| [`TESTING.md`](./TESTING.md) | 测试指南（6 套件 164 测试） |
| [`apply-patches.sh`](./apply-patches.sh) | 一键部署脚本 |

---

## 十一、维护约定

- 重大部署流程变更（新增补丁、新增实例、新增 SKILL）必须同步更新本文 §三/§四/§五
- 新踩坑记录追加到 §八（不要修改已记录条目，留作历史教材）
- 部署后验证清单（§五）随 MCP 工具增减同步
- 行数控制 < 700 行；超出时拆分子文档
