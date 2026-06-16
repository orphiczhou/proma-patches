#!/bin/bash
# Proma 会话管理补丁 — 一键安装脚本
set -e
PROMA_SRC="${PROMA_SRC:-D:/Proma}"
PROMA_DEV="${PROMA_DEV:-D:/Proma-dev}"
TMPDIR="/tmp/proma-patch-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo " Proma 会话管理补丁 — 一键安装"
echo "============================================"

echo ""
echo "[1/6] 创建 Dev 版..."
if [ -d "$PROMA_DEV" ]; then
  echo "  $PROMA_DEV 已存在，跳过复制"
else
  cp -r "$PROMA_SRC" "$PROMA_DEV"
  echo "  已复制到 $PROMA_DEV"
fi
cd "$PROMA_DEV/resources"
if [ -f app.asar ] && [ ! -d app ]; then
  echo "  解包 app.asar..."
  npx asar extract app.asar app
  mv app.asar app.asar.disabled
fi
if [ -d app.asar.unpacked/node_modules ]; then
  cp -r app.asar.unpacked/node_modules/* app/node_modules/ 2>/dev/null || true
fi
mkdir -p ~/.proma-dev
cp ~/.proma/cloud-auth.json ~/.proma-dev/ 2>/dev/null || true
cp ~/.proma/channels.json ~/.proma-dev/ 2>/dev/null || true
cp ~/.proma/user-profile.json ~/.proma-dev/ 2>/dev/null || true

echo ""
echo "[2/6] 提取 main.cjs..."
mkdir -p "$TMPDIR"
npx asar extract "$PROMA_SRC/resources/app.asar" "$TMPDIR/app"
cp "$TMPDIR/app/dist/main.cjs" "$TMPDIR/main-patched.cjs"

echo ""
echo "[3/6] 打补丁..."
sed -i 's|          const dynamicCtx = buildDynamicContext({|if(typeof global.__proma_getMcpServers__==="function"){const __h=global.__proma_getMcpServers__(sessionId,workspaceSlug,sdk);if(__h)Object.assign(mcpServers,__h);}\n          const dynamicCtx = buildDynamicContext({|' "$TMPDIR/main-patched.cjs"
sed -i 's|^init_index();$|init_index();\nglobal.__proma__={createAgentSession,forkAgentSession,listAgentSessions,getAgentSessionMeta,updateAgentSessionMeta,deleteAgentSession,listChannels,getChannelById,getAgentWorkspace,listAgentWorkspaces,getAgentSessionSDKMessages,runAgentHeadless};\ntry{require("./proma-dev-patches.cjs");}catch(e){console.error("[Plugin] load failed:",e);}|' "$TMPDIR/main-patched.cjs"
sed -i 's@const channel = getChannelById(channelId);@const __effChannelId = getAgentSessionMeta(sessionId)?.channelId || channelId;\n        const channel = getChannelById(__effChannelId);@' "$TMPDIR/main-patched.cjs"
sed -i '405686,405695{s@apiKey = decryptApiKey(channelId);@apiKey = decryptApiKey(__effChannelId);@}' "$TMPDIR/main-patched.cjs" 2>/dev/null || true
sed -i '405150,406160{s@this.autoGenerateTitle(sessionId, userMessage, channelId,@this.autoGenerateTitle(sessionId, userMessage, __effChannelId,@}' "$TMPDIR/main-patched.cjs" 2>/dev/null || true
sed -i 's@let resolvedModel = modelId || DEFAULT_MODEL_ID;@let resolvedModel = getAgentSessionMeta(sessionId)?.modelId || modelId || DEFAULT_MODEL_ID;@' "$TMPDIR/main-patched.cjs"
sed -i 's@model: modelId || DEFAULT_MODEL_ID,@model: resolvedModel,@' "$TMPDIR/main-patched.cjs"
sed -i 's/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g' "$TMPDIR/main-patched.cjs"
sed -i 's/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged || process.env.PROMA_DEV === "1") {/g' "$TMPDIR/main-patched.cjs"
echo "  补丁完成"

echo ""
echo "[4/6] 部署..."
mkdir -p "$PROMA_DEV/resources/app/dist"
cp "$TMPDIR/main-patched.cjs" "$PROMA_DEV/resources/app/dist/main.cjs"
cp "$SCRIPT_DIR/proma-dev-patches.cjs" "$PROMA_DEV/resources/app/dist/"
cp "$SCRIPT_DIR/proma-mcp-server.cjs" "$PROMA_DEV/resources/app/dist/"
cp -r "$TMPDIR/app/dist/renderer/"* "$PROMA_DEV/resources/app/dist/renderer/" 2>/dev/null || true
sed -i 's/if(qe.has(e))return qe;//g' "$PROMA_DEV/resources/app/dist/renderer/assets/index-"*.js 2>/dev/null || true
VERSION=$(grep -o '"version": "[0-9.]*"' "$PROMA_DEV/package.json" 2>/dev/null | head -1 | grep -o '[0-9.]*' || echo "0.12.23")
sed -i "s/\"version\": \"0.12.X\"/\"version\": \"$VERSION\"/g" "$PROMA_DEV/resources/app/package.json" 2>/dev/null || true

echo ""
echo "[5/6] 创建启动脚本..."
cat > "$PROMA_DEV/start-dev.bat" << 'BATEOF'
@echo off
set PROMA_DEV=1
start "" "D:\Proma-dev\Proma-white.exe"
BATEOF

echo ""
echo "[6/6] 清理..."
rm -rf "$TMPDIR"

echo ""
echo "============================================"
echo " 安装完成！双击 D:\\Proma-dev\\start-dev.bat 启动"
echo "============================================"