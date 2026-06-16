#!/bin/bash
# Proma 会话管理补丁 — 一键安装脚本 (v0.12)
# 用法: bash apply-patches.sh
# 在 Proma 商业版 v0.12.x 上创建 Dev 版并打上全部 6 个补丁

set -e

PROMA_SRC="${PROMA_SRC:-D:/Proma}"
PROMA_DEV="${PROMA_DEV:-D:/Proma-dev}"
TMPDIR="/tmp/proma-patch-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo " Proma 会话管理补丁 — 一键安装 (v0.12)"
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

# 补丁 C: 频道+模型覆盖
echo "  补丁 C: 频道/模型元数据覆盖..."
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' "$TMPDIR/main-patched.cjs"
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (C2 行号可能漂移，跳过)"
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' "$TMPDIR/main-patched.cjs" 2>/dev/null || echo "    (C3 行号可能漂移，跳过)"
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' "$TMPDIR/main-patched.cjs"
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' "$TMPDIR/main-patched.cjs"

# 补丁 D: DeepSeek V4 Pro (可选)
echo "  补丁 D: DeepSeek 子Agent → V4 Pro..."
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' "$TMPDIR/main-patched.cjs"

# 补丁 E: PROMA_DEV 隔离
echo "  补丁 E: userData 隔离..."
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_DEV === "1") {/g' "$TMPDIR/main-patched.cjs"

# 补丁 F: 跨渠道 sdkSessionId 断裂防护 (v0.12)
echo "  补丁 F: 跨渠道防护..."
sed -i 's@let existingSdkSessionId = sessionMeta?.sdkSessionId;@let existingSdkSessionId = sessionMeta?.sdkSessionId;if(existingSdkSessionId\\&\\&sessionMeta?.channelId\\&\\&channelId!==sessionMeta.channelId){existingSdkSessionId=void 0;}@' "$TMPDIR/main-patched.cjs"

echo "  补丁全部完成"

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
# 移除 hydration 幂等守卫
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
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma-white.exe"
BATEOF
echo "  已创建 $PROMA_DEV/start-dev.bat"

# ---- 步骤 6: 清理 ----
echo ""
echo "[6/6] 清理临时文件..."
rm -rf "$TMPDIR"

# ---- 完成 ----
echo ""
echo "============================================"
echo " 安装完成！(v0.12, 6 个补丁, 11 个 MCP 工具)"
echo ""
echo " 启动方式: 双击 D:\\Proma-dev\\start-dev.bat"
echo ""
echo " 验证方式:"
echo "   1. 检查 ~/.proma-dev/mcp-bridge-port.json"
echo "   2. 打开 Proma Agent 会话"
echo "   3. 输入: 用 list_channels 列出可用的 AI 渠道"
echo "============================================"
