#!/bin/bash
# =============================================================================
# apply-patches-multi.sh — 多目标补丁部署（apply-patches.sh 的多目标包装）
# =============================================================================
# 把 tree-harness 补丁打到 D:/Proma-dev 和/或 D:/Proma-release
# （两个独立的单目录多实例目录）。
#
# 用法:
#   bash apply-patches-multi.sh                       # 默认 --target=dev（开发频繁更新）
#   bash apply-patches-multi.sh --target=dev          # 只打 D:/Proma-dev
#   bash apply-patches-multi.sh --target=release      # 只打 D:/Proma-release
#   bash apply-patches-multi.sh --target=all          # 两个都打
#   bash apply-patches-multi.sh --target=dev --rebuild  # 先删 D:/Proma-dev 再重建（跟最新商业版）
#
# 部署策略（用户架构）:
#   - D:/Proma-dev:     开发测试，频繁更新补丁（跟最新商业版 D:/Proma）
#   - D:/Proma-release: 稳定/调试，低频更新（仅大版本用 --rebuild）
#   - 两目录各自内部都是单目录多实例（start-dev/pro/release*.bat，由 apply-patches.sh 建）
#
# 注意: apply-patches.sh 若检测到目标已存在会跳过复制。要基于最新商业版重建，
#       必须传 --rebuild（会 rm -rf 目标目录后重建）。--rebuild 是破坏性操作。
# =============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TARGET="dev"
REBUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target=*) TARGET="${1#*=}" ;;
    --rebuild)  REBUILD=1 ;;
    -h|--help)
      head -24 "$0" | tail -22
      exit 0
      ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
  shift
done

case "$TARGET" in
  dev)     TARGETS=("D:/Proma-dev") ;;
  release) TARGETS=("D:/Proma-release") ;;
  all)     TARGETS=("D:/Proma-dev" "D:/Proma-release") ;;
  *) echo "未知 --target: $TARGET（应为 dev/release/all）" >&2; exit 1 ;;
esac

PROMA_SRC="${PROMA_SRC:-D:/Proma}"

for t in "${TARGETS[@]}"; do
  echo "============================================"
  echo " 打补丁到 $t  (target=$TARGET, rebuild=$REBUILD)"
  echo " 源商业版: $PROMA_SRC"
  echo "============================================"
  if [[ $REBUILD -eq 1 && -d "$t" ]]; then
    echo "  --rebuild: 删除现有 $t 重建..."
    rm -rf "$t"
  fi
  PROMA_SRC="$PROMA_SRC" PROMA_DEV="$t" bash apply-patches.sh
  echo ""
done

echo "============================================"
echo "✅ 多目标部署完成: ${TARGETS[*]}"
echo "============================================"
if [[ $REBUILD -eq 0 ]]; then
  echo "提示: 若目标已存在，apply-patches.sh 会跳过复制。要跟最新商业版重建，加 --rebuild。"
fi
