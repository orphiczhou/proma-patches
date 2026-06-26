# 会话交接 — 2026-06-20 LAN [1211] 排查

> 交接时间: 2026-06-20 18:50 GMT+8
> 工作区根: `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files`

---

## 0. 一句话状态

**LAN 机器 (192.168.3.25, WS-VsCode, Win10) 上，UI 能正常使用 DeepSeek，但 MCP send_message 路径对所有非 GLM 模型报 [1211]。本地 (Win11) 相同代码完全正常。根因尚未找到。**

---

## 1. 已完成的工作

### v0.16.6 → v0.16.7 发布 (GitHub: orphiczhou/proma-patches)

| 提交 | 内容 |
|------|------|
| `0fa4a36` | 单目录多实例 + Pro 实例 + 动态托盘图标 |
| `18caf37` | LAN 局域网支持 + discover_instances + host:port 直连 |
| `625f3d3` | session-management SKILL v1.2.3→v1.3.0 (12 工具) |
| `16da8cf` | Q1/Q3 工作归档 |

### 本地环境

- `D:\Proma-dev\` 单目录，4 个 BAT 启动不同实例 (Dev/Pro/Release/Release-Fresh)
- 所有 BAT 默认 `PROMA_BRIDGE_HOST=0.0.0.0`
- 托盘图标按 `PROMA_INSTANCE_NAME` 动态选择

---

## 2. [1211] 排查进展

### 已排除的假设

| 假设 | 结论 |
|------|------|
| baseUrl 问题 | ❌ 两条 URL 通过 curl 都能正常调用 DeepSeek API |
| API key 问题 | ❌ curl 测试正常返回，key 有效 |
| main.cjs 不一致 | ❌ MD5 完全一致: `95534ee24e899582888eea983e11a73c` |
| patches.cjs 不一致 | ❌ 已同步为最新版: `b2d0da67dbb124fd964c4c4e28fbe0f8` |
| provider 类型 | ❌ deepseek/anthropic/anthropic-compatible/proma 全都不行 |
| normalizeAnthropicBaseUrlForSdk | ❌ LAN 用 `apply-patches.sh` 构建，代码相同 |

### 关键发现

1. **只有 GLM/zhipu-coding 能通** — 说明 remote-session 整条链路没问题
2. **直接 HTTP bridge 调用也 [1211]** — 排除 remote-session 传参问题
3. **本地完全正常** — 说明不是代码逻辑缺陷
4. **curl 直接调 API 正常** — 说明 API key/URL 都没问题
5. **LAN patches.cjs 原本是旧版** — 已通过 SSH 覆盖为新版，但问题依旧

### LAN 机器访问方式

- SSH: `user@192.168.3.25` 密码 `Abc!123`
- Proma HTTP: 192.168.3.25:19876 (release), 19877 (pro), 19878 (dev)
- 本会话目录下已安装 `node_modules/ssh2`，可直接用 Node.js SSH 连接

### 可能的下一步方向

1. **对比 SDK 版本**: 本地 `@anthropic-ai/claude-agent-sdk-win32-x64 v0.3.153`，LAN 机器版本待确认
2. **Node 版本差异**: 本地 v22.13.1，LAN v24.12.0
3. **对比 SDK 发出的实际 HTTP 请求**: 在 LAN 上抓包或用 `ANTHROPIC_LOG=debug` 看差异
4. **对比 app.asar.unpacked/ 目录**: LAN 和本地是否完全一致

---

## 3. 快速启动

```
你是接替诊断 Agent。工作区根: C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files

先读:
1. .context\PROJECT-INDEX.md — 项目全景
2. .context\handoff\session-2026-06-20-handoff.md — 本文档
3. .context\proma-dev-wiki.md — 技术 Wiki

核心任务: 排查 LAN 机器 (192.168.3.25) DeepSeek/MiniMax [1211] 根因
已确认: 代码一致、API key 有效、URL 正确、但 MCP 路径失败
怀疑: SDK 二进制差异或 Node 版本差异

频道: DeepSeek官方 (56ecefd2), 模型 V4 Pro
```

## 4. 关键文件

```
workspace-files/
  .context/proma-dev-wiki.md              ← 技术 Wiki
  .context/PROJECT-INDEX.md               ← 项目索引
  .context/handoff/                       ← 交接文档
  prompa-dev-patches.cjs                  ← 插件 (v0.16.7)
  proma-mcp-server.cjs                    ← MCP 桥接
  apply-patches.sh                        ← 一键部署

Proma 实例 (本地):
  D:\Proma\        (正式版)
  D:\Proma-dev\    (单目录多实例)
    start-dev.bat / start-pro.bat / start-release.bat / start-release-fresh.bat

LAN 机器:
  192.168.3.25  SSH: user / Abc!123
  D:\Proma-dev\  (同本地结构)
