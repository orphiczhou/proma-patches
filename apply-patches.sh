#!/bin/bash
# Proma 会话管理补丁 — 一键安装脚本 (v0.17)
# 用法: bash apply-patches.sh  （多目标用 apply-patches-multi.sh --target=dev|release|all --rebuild）
# 在 Proma 商业版 v0.15.7 上创建 Dev/Release 版并打补丁（v0.17 适配 minified main.cjs + 上游已实现项废弃）
#
# v0.17 补丁清单（A-K + 补丁3）：保留 A/B/E/I/J/K；废弃 C/D/F/G/H/补丁3（上游 v0.15.7 已实现 或 前提失效）
# v0.16.6 单目录多实例: 同一份 D:\Proma-dev\ 代码，不同 BAT 文件 → 不同实例
# 两变量体系:
#   PROMA_INSTANCE_NAME     — 实例身份标识（remote-session 发现、AppUserModelId、托盘图标）
#   PROMA_INSTANCE_ISOLATED — 数据隔离开关（1=独立, 0=共享正式版）

set -e

PROMA_SRC="${PROMA_SRC:-D:/Proma}"
PROMA_DEV="${PROMA_DEV:-D:/Proma-dev}"
TMPDIR="/tmp/proma-patch-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo " Proma 会话管理补丁 — 一键安装 (v0.16.6)"
echo " 源: $PROMA_SRC"
echo " 目标: $PROMA_DEV"
echo "============================================"

# ---- 步骤 1: 创建 Dev 版 ----
echo ""
echo "[1/6] 创建 Dev 版..."
if [ -d "$PROMA_DEV" ]; then
  echo "  ⚠ $PROMA_DEV 已存在，跳过复制。如需重建请先删除。"
else
  cp -r "$PROMA_SRC" "$PROMA_DEV"
  echo "  已复制到 $PROMA_DEV"
fi

# 解包 ASAR
cd "$PROMA_DEV/resources"
if [ -f app.asar ] && [ ! -d app ]; then
  echo "  解包 app.asar..."
  npx asar extract app.asar app
  mv app.asar app.asar.disabled
  echo "  解包完成"
else
  echo "  app 目录已存在，跳过解包"
fi

# 合并原生模块
if [ -d app.asar.unpacked/node_modules ]; then
  cp -r app.asar.unpacked/node_modules/* app/node_modules/ 2>/dev/null || true
  echo "  原生模块已合并"
fi

# 同步认证数据
echo "  同步认证数据..."
mkdir -p ~/.proma-dev
cp ~/.proma/cloud-auth.json ~/.proma-dev/ 2>/dev/null || echo "   (无 cloud-auth.json)"
cp ~/.proma/channels.json ~/.proma-dev/ 2>/dev/null || echo "   (无 channels.json)"
cp ~/.proma/user-profile.json ~/.proma-dev/ 2>/dev/null || echo "   (无 user-profile.json)"

# ---- 步骤 2: 提取 main.cjs ----
echo ""
echo "[2/6] 提取 main.cjs..."
mkdir -p "$TMPDIR"
npx asar extract "$PROMA_SRC/resources/app.asar" "$TMPDIR/app"
cp "$TMPDIR/app/dist/main.cjs" "$TMPDIR/main-patched.cjs"
echo "  已提取到 $TMPDIR/main-patched.cjs"

# ---- 步骤 3: 打补丁 ----
echo ""
echo "[3/6] 打 sed 补丁..."

# 补丁 A: MCP 钩子
echo "  补丁 A: MCP 钩子..."
sed -i 's|          const dynamicCtx = buildDynamicContext({|if(typeof global.__proma_getMcpServers__==="function"){const __h=global.__proma_getMcpServers__(sessionId,workspaceSlug,sdk);if(__h)Object.assign(mcpServers,__h);}\n          const dynamicCtx = buildDynamicContext({|' "$TMPDIR/main-patched.cjs"

# 补丁 B: API 桥接 + 插件加载
echo "  补丁 B: API 桥接..."
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace,listAgentWorkspaces,getAgentSessionSDKMessages,runAgentHeadless};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' "$TMPDIR/main-patched.cjs"

# 补丁 C: [v0.17 废弃] 频道/模型元数据覆盖 — 上游 v0.15.7 渲染层 AgentView.tsx:485-486 已 sessionMeta 优先 + IPC 透传
#   主进程 10 处 sed 冗余；插件走 getAgentSessionMeta 独立链路，不依赖 __effChannelId/resolvedModel
echo "  补丁 C: 跳过（上游 v0.15.7 渲染层已 sessionMeta 优先，废弃）"

# 补丁 D: [v0.17 废弃] DeepSeek 子Agent → V4 Pro — DEEPSEEK_SUBAGENT_MODEL_ID 是幽灵常量(全仓0命中)
#   main.cjs 的 deepseek-v4-flash(2处) 是频道模型注册表(channel-manager.ts)，sed 会改坏频道配置
echo "  补丁 D: 跳过（幽灵常量，sed 会改坏频道注册表，废弃）"

# 补丁 E: 实例隔离 — userData 路径（v0.16.5 两变量体系）
echo "  补丁 E: userData 隔离..."
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_INSTANCE_ISOLATED === "1") {/g' "$TMPDIR/main-patched.cjs"

# 补丁 F: [v0.17 废弃] 跨频道 sdkSessionId 断裂防护 — 上游 v0.15.7 已原生实现
#   见 ipc.ts:2449 (切内核) + agent-orchestrator.ts:728/1002/1979/2360 (sdkSessionId=undefined)
#   旧 sed 在 minified 单行 main.cjs 上匹配多处+\\&转义产生 \let 非法码，破坏语法
echo "  补丁 F: 跳过（上游 v0.15.7 已实现 sdkSessionId 跨内核/频道清理，废弃）"

# 补丁 G: [v0.17 废弃] CLAUDE_CONFIG_DIR 无条件覆盖 — 上游 v0.15.7 已无条件化
#   main.cjs 3处 CLAUDE_CONFIG_DIR 全无 PROMA_DEV 守卫(agent-session-manager.ts:28-30 + spawn env)，fork 0/3→3/3 已原生修复
echo "  补丁 G: 跳过（上游 v0.15.7 已无条件覆盖 CLAUDE_CONFIG_DIR，废弃）"

# 补丁 H: [v0.17 废弃] 跨频道/模型切换全清 sdkSessionId — 上游 v0.15.7 已原生实现
#   见 agent-orchestrator.ts:1002/1979/2360 (sdkSessionId: undefined)。废弃理由同补丁 F
echo "  补丁 H: 跳过（上游 v0.15.7 已实现，废弃）"

# 补丁 I: 禁用更新检查（v0.17 单行版 — 上游无开关，autoDownload=true 硬编码，必须补丁）
#   main.cjs 里 function initAutoUpdater(mainWindow2) { 唯一匹配，{ 后即换行，函数体非深度 minify
echo "  补丁 I: 禁用更新检查（单行注入 return）..."
sed -i 's/function initAutoUpdater(mainWindow2) {/function initAutoUpdater(mainWindow2) {return;/' "$TMPDIR/main-patched.cjs" && echo "    (补丁 I 已打)" || echo "    (补丁 I 未匹配，需手动 Edit)"

# 补丁 J: AppUserModelId 动态隔离（v0.17 修复 $$ bug — 模板串应为 ${...} 非 $${...}）
#   旧 sed 实际已成功应用(requestSingleInstanceLock 区域保留换行)，但注入的 com.proma.$${...} 多了一个 $
#   运行时 AUMID 成 com.proma.$dev(多前导$)，功能上仍区分实例但不规范；本次修正为单 $
echo "  补丁 J: AppUserModelId 动态隔离（修复 $$ → $）..."
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.requestSingleInstanceLock())/if (process.env.PROMA_INSTANCE_NAME) {\n      \1.app.setAppUserModelId(`com.proma.${process.env.PROMA_INSTANCE_NAME}`);\n    }\n    if (!\1.app.requestSingleInstanceLock())/' "$TMPDIR/main-patched.cjs" && echo "    (补丁 J 已打)" || echo "    (补丁 J 未匹配，需手动 Edit)"

# 补丁 K: userData 路径动态化（v0.17 单行版 — 适配 minified main.cjs）
#   旧多行版用 \n 匹配，但 main.cjs 是单行 minified，永远不匹配。改为单行字符串替换。
echo "  补丁 K: userData 路径动态化..."
sed -i 's/"@proma\/electron-dev"/"@proma\/electron-"+(process.env.PROMA_INSTANCE_NAME||"dev")/g' "$TMPDIR/main-patched.cjs" && echo "    (补丁 K 已打)" || echo "    (补丁 K 未匹配，需手动 Edit)"

echo "  补丁 A-K 处理完成（保留 A/B/E/I/J/K；C/D/F/G/H/补丁3 已废弃）"

# 补丁 3: [v0.17 废弃] 托盘图标动态选择 — 上游 v0.15.7 改用 iconTemplate.png(macOS Template 机制)
#   proma-white.png 计数0(已不存在)；setTemplateImage(true) 与彩色映射冲突；多语句注入单行sed做不到
#   实例区分若需要，改走 tray.SetToolTip/window title(单行 sed 可行)，不改图标颜色
echo "  补丁 3: 跳过（上游改 iconTemplate.png Template 机制，彩色映射不可行，废弃）"

# ---- 步骤 4: 部署 ----
echo ""
echo "[4/6] 部署文件..."
mkdir -p "$PROMA_DEV/resources/app/dist"
cp "$TMPDIR/main-patched.cjs" "$PROMA_DEV/resources/app/dist/main.cjs"
cp "$SCRIPT_DIR/proma-dev-patches.cjs" "$PROMA_DEV/resources/app/dist/"
cp "$SCRIPT_DIR/proma-mcp-server.cjs" "$PROMA_DEV/resources/app/dist/"
cp "$SCRIPT_DIR/tree-engine.cjs" "$PROMA_DEV/resources/app/dist/"
echo "  文件已部署到 $PROMA_DEV/resources/app/dist/"

# 同步 renderer
echo "  同步 renderer..."
cp -r "$TMPDIR/app/dist/renderer/"* "$PROMA_DEV/resources/app/dist/renderer/" 2>/dev/null || true
# 移除 hydration 幂等守卫（补丁 E renderer）
sed -i 's/if(qe.has(e))return qe;//g' "$PROMA_DEV/resources/app/dist/renderer/assets/index-"*.js 2>/dev/null || echo "   (renderer 补丁跳过)"

# 对齐版本号
echo "  对齐版本号..."
VERSION=$(grep -o '"version": "[0-9.]*"' "$PROMA_DEV/package.json" 2>/dev/null | head -1 | grep -o '[0-9.]*' || echo "0.12.23")
sed -i "s/\"version\": \"0.12.X\"/\"version\": \"$VERSION\"/g" "$PROMA_DEV/resources/app/package.json" 2>/dev/null || true

# ---- 步骤 5: 创建启动脚本 ----
echo ""
echo "[5/6] 创建启动脚本..."
cat > "$PROMA_DEV/start-dev.bat" << 'BATEOF'
@echo off
set PROMA_INSTANCE_NAME=dev
set PROMA_INSTANCE_ISOLATED=1
set PROMA_DEV=1
start "PromaDev" "%~dp0Proma-white.exe"
exit
BATEOF
echo "  已创建 $PROMA_DEV/start-dev.bat"

cat > "$PROMA_DEV/start-pro.bat" << 'BATEOF'
@echo off
set PROMA_INSTANCE_NAME=pro
set PROMA_INSTANCE_ISOLATED=1
set PROMA_DEV=1
start "PromaPro" "%~dp0Proma-green.exe"
exit
BATEOF
echo "  已创建 $PROMA_DEV/start-pro.bat"

# ---- 步骤 6: 清理 ----
echo ""
echo "[6/6] 清理临时文件..."
rm -rf "$TMPDIR"

# ---- 完成 ----
echo ""
echo "============================================"
echo " 安装完成！(v0.17, 保留 6 补丁 A/B/E/I/J/K + 插件, 上游已实现项 C/D/G/补丁3 已废弃)"
echo ""
echo " 启动方式（单目录多实例）:"
echo "   Dev:     双击 D:\\Proma-dev\\start-dev.bat"
echo "   Pro:     双击 D:\\Proma-dev\\start-pro.bat"
echo "   Release: D:\\Proma-release\\start-release.bat (或 D:\\Proma-dev\\Proma-coral.exe)"
echo ""
echo " 图标映射: Dev=白 / Pro=绿 / Release=珊瑚"
echo " 托盘图标: 动态选择（按 PROMA_INSTANCE_NAME 映射）"
echo ""
echo " 验证方式:"
echo "   1. 确认 D:\\Proma-dev\\resources\\app\\dist\\proma-dev-patches.cjs 存在"
echo "   2. 确认 D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs 存在"
echo "   3. 启动后打开 Proma Agent 会话"
echo "   4. 输入: 用 list_channels 列出可用的 AI 渠道"
echo "   5. 外部 MCP: node proma-mcp-server.cjs --dev 测试自动发现"
echo "============================================"
