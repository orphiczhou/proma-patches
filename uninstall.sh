#!/bin/bash
set -e
PROMA_DEV="${PROMA_DEV:-D:/Proma-dev}"
echo "卸载 Proma 会话管理补丁..."
echo "将删除: $PROMA_DEV, ~/.proma-dev"
read -p "确认? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then echo "已取消"; exit 0; fi
rm -rf "$PROMA_DEV"
rm -rf ~/.proma-dev
rm -rf "$APPDATA/@proma/electron-dev"
echo "卸载完成。"