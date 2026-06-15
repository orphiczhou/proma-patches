# Proma 开发版 Wiki

> 最后更新: 2026-06-15 | 维护者: 周星星

---

## 一、核心概念：源码 ≠ 运行版本

**重要区分：**

| | 源码仓库 | 运行版本 |
|---|---|---|
| **位置** | `proma-source/` | `D:\Proma\`、`D:\Proma-dev\`、`D:\Proma-release\` |
| **来源** | GitHub `ErlichLiu/Proma` | 商业版安装包 |
| **版本** | v0.12.23（开源） | v0.12.1（商业，含闭源模块） |
| **用途** | 学习架构、理解代码逻辑 | 实际运行和调试 |
| **修改方式** | `git` 管理 TypeScript 改动 | `sed` 在编译后的 `main.cjs` 上打补丁 |

**关键事实：dev 版和 release 版不是从源码构建的，而是从商业正式版 `D:\Proma\` 拷贝 → 解包 → sed 打补丁生成的。** 源码仓库仅用于理解代码，修改记录在 Git 中，但实际部署走的是 sed 补丁流程。

---

## 二、概述

在日常使用 Proma 正式版的同时，维护**调试版**（开发用）和**发行版**（日常用补丁版）。三版分工明确，用户数据按需共享或隔离。

### 三版架构

| | 正式版 | Dev发行版 | 调试版 |
|---|---|---|---|
| **路径** | `D:\Proma\` | `D:\Proma-release\` | `D:\Proma-dev\` |
| **用途** | 官方原版 | 日常使用（补丁版） | 开发调试 |
| **启动方式** | 正常双击 | `start-release.bat` | `start-dev.bat` |
| **用户数据** | `~/.proma/` | `~/.proma/`（共享） | `~/.proma-dev/`（独立） |
| **PROMA_DEV** | - | - | `=1` |
| **双开** | - | ❌（与正式版互斥） | ✅（可同时） |
| **代码加载** | `app.asar`（原版） | `app.asar`（补丁） | `app/` 目录（解包） |
| **图标** | 黑色 | 渐变色（proma-gradient） | 白色 |
| **Electron userData** | `@proma/electron/` | `@proma/electron/`（共享） | `@proma/electron-dev/`

---

## 二、创建开发版的步骤

### 1. 复制正式版

```bash
cp -r D:/Proma D:/Proma-dev
```

### 2. 解包 ASAR

```bash
cd D:/Proma-dev/resources
npx asar extract app.asar app
mv app.asar app.asar.disabled   # 让 Electron 加载 app/ 目录
```

### 3. 合并原生模块

ASAR 解包后的 `app/` 缺少 `app.asar.unpacked` 中的原生模块，需合并：

```bash
cp -r app.asar.unpacked/node_modules/* app/node_modules/
```

### 4. 创建启动脚本

创建 `D:\Proma-dev\start-dev.bat`：

```bat
@echo off
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma.exe"
```

`PROMA_DEV=1` 强制使用 `~/.proma-dev/` 配置目录和 `%APPDATA%/@proma/electron-dev/` Electron 用户数据。

### 5. 同步认证数据

从正式版同步登录态：

```bash
# Proma 配置层
cp ~/.proma/cloud-auth.json ~/.proma-dev/
cp ~/.proma/channels.json ~/.proma-dev/
cp ~/.proma/user-profile.json ~/.proma-dev/

# Electron 会话层（cookies、session storage 等）
cp -r %APPDATA%/@proma/electron/Network %APPDATA%/@proma/electron-dev/
cp -r %APPDATA%/@proma/electron/Session Storage %APPDATA%/@proma/electron-dev/
cp -r %APPDATA%/@proma/electron/Local Storage %APPDATA%/@proma/electron-dev/
```

> **注意：** 两个版本共享同一套 cloud token 会导致 token 刷新时互相踢下线。长期方案需在 dev 版独立登录。

---

## 三、代码修改方法

### 核心原则：在商业版 main.cjs 上打字符串补丁，不要从开源代码重建

开源代码（v0.10.28）缺少商业版（v0.12.1+）的云认证（cloudAuth / Google OAuth）等闭源模块。如果从开源代码重新构建 `main.cjs`，商业功能会丢失。

### 正确流程

1. 从正式版 `app.asar` 提取原版 `main.cjs`：

```bash
npx asar extract D:/Proma/resources/app.asar /tmp/extracted
cp /tmp/extracted/dist/main.cjs <工作目录>/
```

2. 在 `main.cjs` 上用 `sed` 打补丁（参见第四节）

3. 将补丁后的 `main.cjs` 部署到开发版：

```bash
cp main.cjs D:/Proma-dev/resources/app/dist/main.cjs
```

4. 重启开发版验证

### 源码级修改（可选）

如果是开源代码中**已存在**的逻辑，可以直接修改 TypeScript 源码：

```bash
cd proma-source
# 修改 .ts 文件
# 用 esbuild 构建
./node_modules/@esbuild/win32-x64/esbuild.exe \
  apps/electron/src/main/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=apps/electron/dist/main.cjs \
  --external:electron \
  --external:@anthropic-ai/claude-agent-sdk
```

但必须确保修改的文件在商业版中也存在且逻辑一致。

---

## 四、当前已应用的补丁

### 补丁 1：DeepSeek 子 Agent 使用 V4 Pro

**文件：** `agent-model-routing.ts` → `main.cjs`

**改动：**

```typescript
// 改前
export const DEEPSEEK_SUBAGENT_MODEL_ID = 'deepseek-v4-flash'

// 改后
export const DEEPSEEK_SUBAGENT_MODEL_ID = 'deepseek-v4-pro'
```

**sed 命令：**

```bash
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' main.cjs
```

**效果：** 当主 Agent 使用 DeepSeek 系列模型时，所有子 Agent（explorer、researcher、code-reviewer）强制路由到 `deepseek-v4-pro` 而非 `deepseek-v4-flash`。

**影响范围：**
- SDK 环境变量 `CLAUDE_CODE_SUBAGENT_MODEL`
- 系统 prompt 中的 SubAgent 委派策略说明

### 补丁 2：PROMA_DEV 环境变量触发 userData 隔离

**文件：** `index.ts` → `main.cjs`

**改动：**

```typescript
// 改前
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), '@proma/electron-dev'))
}

// 改后
if (!app.isPackaged || process.env.PROMA_DEV === '1') {
  app.setPath('userData', join(app.getPath('appData'), '@proma/electron-dev'))
}
```

**sed 命令：**

```bash
sed -i 's/if (!import_electron[0-9]*\.app\.isPackaged) {/if (!import_electron48.app.isPackaged || process.env.PROMA_DEV === "1") {/g' main.cjs
```

**效果：** 设置 `PROMA_DEV=1` 后，即使 `app.isPackaged === true`，也能隔离 Electron userData 路径，使开发版和正式版可以同时运行。

**根因：** `app.isPackaged` 在 electron-builder 构建的版本中始终为 `true`（无论是否使用 ASAR），原逻辑无法区分"解包运行的开发版"和"正式打包版"。

---

## 五、项目文件结构

```
d:\桌面\Agent 编程方法论实验-南大大一\
├── proma-source/                        # 工作源码（已修改）
│   ├── apps/electron/src/main/
│   │   ├── index.ts                     # 补丁2：PROMA_DEV userData隔离
│   │   └── lib/
│   │       └── agent-model-routing.ts   # 补丁1：deepseek-v4-pro
│   └── ...
├── proma-source-backup-20260615-170316/  # 原始源码备份
│
D:\
├── Proma/                                # 正式版（保持不动）
└── Proma-dev/                            # 开发版
    ├── start-dev.bat                     # 启动脚本
    └── resources/
        ├── app.asar.disabled             # 已禁用
        ├── app/                          # 解包代码
        │   └── dist/
        │       ├── main.cjs              # 已打补丁
        │       └── preload.cjs           # 商业版原版
        └── app.asar.unpacked/            # 原生模块
```

---

## 六、日常开发流程

1. 在 `proma-source/` 中修改 TypeScript 源码
2. 对于商业版已有逻辑：走源码修改 + esbuild 构建
3. 对于商业版新增逻辑（cloudAuth 等）：在商业版 main.cjs 上直接 sed 补丁
4. 部署到 `D:\Proma-dev\resources\app\dist\`
5. 双击 `start-dev.bat` 启动验证
6. 验证通过后提交到 Git

---

## 七、正式版升级后的影响分析

### dev 版和 release 版会不会失效？

**不会直接失效，但需要注意版本漂移问题。**

正式版（`D:\Proma\`）由 electron-updater 自动升级，升级时会替换：
- `Proma.exe`
- `resources/app.asar`
- `resources/app.asar.unpacked/`

我们的 dev 版和 release 版是**独立副本**，不会被自动升级触碰，所以：

| 场景 | dev 版 | release 版 |
|---|---|---|
| **正式版升级后能否运行** | ✅ 能（独立副本） | ✅ 能（独立副本） |
| **版本漂移** | 停在 v0.12.1，正式版变新 | 停在 v0.12.1，正式版变新 |
| **数据兼容性** | 无影响（`~/.proma-dev/` 独立） | ⚠️ 风险：如果新版改了数据格式，旧版 release 读写 `~/.proma/` 可能出错 |
| **cloud-auth token** | 独立，不影响 | 共享 `~/.proma/`，正式版刷新后 token 变化，release 版需重新同步 |

### 升级后的操作步骤

当正式版自动升级到新版本后：

```bash
# 1. 从新正式版提取最新 main.cjs
npx asar extract D:\Proma\resources\app.asar /tmp/new-app

# 2. 对最新 main.cjs 重新打补丁
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' /tmp/new-app/dist/main.cjs
sed -i 's/"iconTemplate\.png"/"proma-gradient.png"/g' /tmp/new-app/dist/main.cjs

# 3. 重新打包到 release 版
npx asar pack /tmp/new-app D:\Proma-release\resources\app.asar

# 4. （如需要）同步 dev 版：解包 + 打补丁 + 放回 app/ 目录
```

**原则：每次正式版升级后，重新从最新版提取 main.cjs 打补丁，不跨版本复用旧的 main.cjs。**

---

## 九、已知问题

1. **cloud-auth token 共享冲突：** 两个版本共用同一套 token，一方刷新后另一方会失效。临时方案：重新同步 `cloud-auth.json`。长期方案：dev 版独立登录 Google OAuth。

2. **渲染器（renderer）无法从源码构建：** 商业版渲染器包含闭源组件，当前使用商业版原版 renderer。如需修改 UI，需在商业版 `app/` 中定位对应的 JS bundle 进行字符串替换。

3. **Windows 构建环境：** esbuild 通过 Git Bash 运行会 segfault，需使用 Windows 原生 `esbuild.exe`（路径：`node_modules/@esbuild/win32-x64/esbuild.exe`）。

---

### 补丁 3：白色应用图标（Windows 任务栏）

**问题：** 默认图标为黑色，在 Windows 深色任务栏上显示为黑块加白框，视觉效果差。

**方法：**
1. 从 `resources/proma-logos/proma-white.png` 用 `png-to-ico` 转换为 ICO
2. 用 `rcedit` 将白色 ICO 嵌入 `Proma.exe` 的资源段
3. 因 EXE 被进程锁死，存为新文件 `Proma-white.exe`
4. `start-dev.bat` 指向 `Proma-white.exe`

**注意：** 生产版未改动。如需生产版也换图标，重启电脑后运行：
```bash
ren D:\Proma\Proma.exe Proma-black.exe
ren D:\Proma\Proma-white.exe Proma.exe
```

---

## 十、版本记录

| 日期 | 版本 | 改动 |
|---|---|---|
| 2026-06-15 | v0.4 | 源码从 v0.10.28 rebase 到 v0.12.23；新增源码备份；明确"源码≠运行版本"关系 |
| 2026-06-15 | v0.3 | 新增 Dev发行版（D:\Proma-release\）；渐变色图标；三版架构确立 |
| 2026-06-15 | v0.2 | 开发版更换白色应用图标（proma-white）；托盘图标修复 |
| 2026-06-15 | v0.1 | 初始创建开发版；应用补丁1（deepseek-v4-pro）和补丁2（PROMA_DEV userData隔离）；双开支持 |
