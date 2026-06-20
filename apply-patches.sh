#!/bin/bash
# Proma 会话管理补丁 — 一键安装脚本 (v0.16.6)
# 用法: bash apply-patches.sh
# 在 Proma 商业版 v0.12.x 上创建 Dev 版并打上全部补丁 A-K + 动态托盘图标
#
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

# 补丁 C1-5: 频道+模型元数据覆盖
echo "  补丁 C: 频道/模型元数据覆盖..."
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' "$TMPDIR/main-patched.cjs"
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (C2 行号可能漂移，跳过)"
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (C3 行号可能漂移，跳过)"
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' "$TMPDIR/main-patched.cjs"
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' "$TMPDIR/main-patched.cjs"

# 补丁 D: DeepSeek 子Agent → V4 Pro (可选)
echo "  补丁 D: DeepSeek 子Agent → V4 Pro..."
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' "$TMPDIR/main-patched.cjs"

# 补丁 E: 实例隔离 — userData 路径（v0.16.5 两变量体系）
echo "  补丁 E: userData 隔离..."
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_INSTANCE_ISOLATED === "1") {/g' "$TMPDIR/main-patched.cjs"

# 补丁 F: 跨频道 sdkSessionId 断裂防护
echo "  补丁 F: 跨频道防护..."
sed -i 's@let existingSdkSessionId = sessionMeta?.sdkSessionId;@let existingSdkSessionId = sessionMeta?.sdkSessionId;if(existingSdkSessionId\\&\\&sessionMeta?.channelId\\&\\&channelId!==sessionMeta.channelId){existingSdkSessionId=void 0;}@' "$TMPDIR/main-patched.cjs"

# 补丁 G: CLAUDE_CONFIG_DIR 无条件覆盖（修复 fork 失败 0/3 → 3/3）
echo "  补丁 G: CLAUDE_CONFIG_DIR 无条件覆盖..."
sed -i 's@if (!\(import_electron[0-9]*\)\.app\.isPackaged || process.env.PROMA_DEV === "1") {@if (!\1.app.isPackaged || process.env.PROMA_DEV === "1" || true) {@g' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (补丁 G 模式可能漂移，需手动 Edit 工具修复，见 wiki §5 补丁 G)"

# 补丁 H: 跨频道/模型切换全清 sdkSessionId + 同步 meta（v2）
echo "  补丁 H: 跨频道换模型全清..."
sed -i 's@let existingSdkSessionId = sessionMeta?.sdkSessionId;@let existingSdkSessionId = sessionMeta?.sdkSessionId;if(existingSdkSessionId\\&\\&sessionMeta?.channelId\\&\\&channelId\\&\\&(channelId!==sessionMeta.channelId||(modelId\\&\\&modelId!==sessionMeta.modelId))){existingSdkSessionId=void 0;try{updateAgentSessionMeta(sessionId,{channelId,sdkSessionId:void 0,...(modelId?{modelId}:{})});}catch(_){}}@' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (补丁 H 行号可能漂移，需手动 Edit 修复，见 wiki §5 补丁 H)"

# 补丁 I: 禁用更新检查
echo "  补丁 I: 禁用更新检查..."
sed -i 's/function initAutoUpdater(mainWindow2) {\n  win = mainWindow2;/function initAutoUpdater(mainWindow2) {\n  return;\n  win = mainWindow2;/' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (补丁 I 模式可能漂移，需手动 Edit)"

# 补丁 J: AppUserModelId 动态隔离
echo "  补丁 J: AppUserModelId 动态隔离..."
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.requestSingleInstanceLock())/if (process.env.PROMA_INSTANCE_NAME) {\n      \1.app.setAppUserModelId(`com.proma.$${process.env.PROMA_INSTANCE_NAME}`);\n    }\n    if (!\1.app.requestSingleInstanceLock())/' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (补丁 J 模式可能漂移，需手动 Edit)"

# 补丁 K: userData 路径动态化（v0.16.5 修正版 — 双条件检查）
echo "  补丁 K: userData 路径动态化..."
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged || process.env.PROMA_INSTANCE_ISOLATED === "1") {\n      \1\.app\.setPath("userData", (0, import_path[0-9]*\.join)(\1\.app\.getPath("appData"), "@proma\/electron-dev"));\n    }/if (process.env.PROMA_INSTANCE_ISOLATED === "1" \&\& process.env.PROMA_INSTANCE_NAME) {\n      \1.app.setPath("userData", (0, import_path10.join)(\1.app.getPath("appData"), `@proma\\/electron-$${process.env.PROMA_INSTANCE_NAME}`));\n    }/' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (补丁 K 模式可能漂移，需手动 Edit 修复，见 wiki §5 补丁 K)"

echo "  补丁 A-K 全部完成"

# 补丁 3: 托盘图标动态选择（v0.16.6）
echo "  补丁 3: 托盘图标动态选择..."
sed -i 's@return (0, import_path[0-9]*\.join)(resourcesDir, "proma-white\.png");@const __trayIconMap={dev:"proma-white.png",release:"proma-coral.png",pro:"proma-emerald.png"};return (0, import_path9.join)(resourcesDir, __trayIconMap[process.env.PROMA_INSTANCE_NAME]||"proma-white.png");@' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (补丁 3 模式可能漂移，需手动 Edit 修复，见 wiki §5 补丁 3)"

# ---- 步骤 4: 部署 ----
echo ""
echo "[4/6] 部署文件..."
mkdir -p "$PROMA_DEV/resources/app/dist"
cp "$TMPDIR/main-patched.cjs" "$PROMA_DEV/resources/app/dist/main.cjs"
cp "$SCRIPT_DIR/proma-dev-patches.cjs" "$PROMA_DEV/resources/app/dist/"
cp "$SCRIPT_DIR/proma-mcp-server.cjs" "$PROMA_DEV/resources/app/dist/"
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
start "PromaDev" "D:\Proma-dev\Proma-white.exe"
exit
BATEOF
echo "  已创建 $PROMA_DEV/start-dev.bat"

cat > "$PROMA_DEV/start-pro.bat" << 'BATEOF'
@echo off
set PROMA_INSTANCE_NAME=pro
set PROMA_INSTANCE_ISOLATED=1
set PROMA_DEV=1
start "PromaPro" "D:\Proma-dev\Proma-green.exe"
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
echo " 安装完成！(v0.16.6, 11 个补丁 A-K + 动态托盘图标, 22 个 MCP 工具)"
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
