# 交接：Dev bridge 端口遮蔽修复 + 运行时 DbC 验证（2026-06-24 16:10）

> 新会话从这里恢复 | 工作区: Proma改造探索 | 用户: 周星星
> 5 分钟恢复: 本文件 + PROJECT-INDEX.md + note.md 顶部条目 + wiki §19

## 一句话状态

**v0.7+ 引擎内联 MCP 改造的运行时验证全部完成：3 实例（dev/pro/release）bridge 端口 fallback 链修复，27 工具注册 + 4 关键 DbC 拦截通过对抗测试。下一步 V4-V8 深度加固。**

## 已完成（commit 待提交）

### Bridge 端口遮蔽修复（4 个 bat）
- `D:\Proma-dev\start-dev.bat` — 删 `PROMA_BRIDGE_HOST=0.0.0.0` + ASCII 化（中文 REM 注释会让 cmd.exe 一闪关闭）
- `D:\Proma-dev\start-pro.bat` — 同上
- `D:\Proma-dev\start-release.bat` — 同上（旧 bat 还在，但今天没动 — 等下次启动 release-fresh 时一起处理）
- `D:\Proma-dev\start-release-fresh.bat` — 同上

**根因**：`PROMA_BRIDGE_HOST=0.0.0.0` 让 dev/pro 绑 `0.0.0.0:19876`，与 release 的 `127.0.0.1:19876` 共存但被遮蔽（client 访问 127.0.0.1 永远路由到 release）。删除后端口 fallback 链生效：release@19876 / dev@19877 / pro@19878。

### Dev 实例清理
- 归档 3 个 tree MCP 联调测试会话（通过 `mcp__remote-session__remote_archive_session`）
  - `ae3f183e-4c52-421e-8b32-7a79e070a07b` — "tree MCP 联调测试（v0.7+ 引擎内联验证）"
  - `849ff044-b674-4220-9e68-3b1eacca1582` — "tree MCP 联调（MiniMax-M3）"
  - `35020007-6684-451a-81a2-d08afce8bad4` — "tree MCP 联调（DeepSeek官方）"
- mcpvfy tree（root_brief="验证 MCP 内联引擎"）备份到 `~/.proma-dev/agent-workspaces/default/.context/trees/_archive/mcpvfy-20260624/` 后删除

### Dev engine 运行时 DbC 对抗验证

直接 `require("D:/Proma-dev/resources/app/dist/tree-engine.cjs")` + 注入临时 treesRoot，跑完整生命周期 + 4 个对抗测试：

| # | 测试 | 结果 |
|---|------|------|
| 1 | init tree | ✅ PASS |
| 2 | validate clean tree | ✅ PASS, 0 issues |
| 3 | leaf add (UUID + parent=tid-root + path=A 大写) | ✅ PASS |
| 4 | leaf set-status done WITHOUT milestones | ✅ BLOCKED: `E_SCHEMA_INVALID` |
| 5 | leaf set-status done, milestone audit_pass=false | ✅ BLOCKED: `E_SCHEMA_INVALID: milestone not audit_pass=true` |
| 6 | event-append done with deliverable + valid self_check | ✅ PASS |
| 7 | audit-gate self-audit (auditor=added_by) | ✅ BLOCKED: `E_AUDITOR_NOT_INDEPENDENT` (V2) |
| 8 | audit-gate independent auditor (树中独立 leaf) | ✅ PASS |

**生效 DbC**：A5 self_check strict / A2 auditor 独立性白名单 / SP1 audit premature / A1 milestones 非空 + audit_pass

## 关键技术决策（新会话必读）

1. **PROMA_BRIDGE_HOST 默认应保持 127.0.0.1**：patches.cjs 的端口 fallback 链设计正确，问题是 `0.0.0.0` 让 dev 抢占 19876 阻止 fallback。LAN 可见应通过别的方式实现，不是覆盖 bindHost。
2. **Windows .bat 必须 ASCII only**：UTF-8 字符（含中文 REM 注释）会让 cmd.exe 静默 abort，无错误提示。`file xxx.bat` 必须返回 ASCII text。
3. **D:\Proma-dev\ 是多实例 launcher**：4 个主题 exe（white/green/coral/coral）+ 4 个 bat = 4 个 instance（dev/pro/release/release-fresh）。旧的 `D:\Proma-release\` 已被替代（仍保留兼容）。
4. **诊断 patches.cjs 加载状态**：让该实例 agent 调 `mcp__session__list_channels`，比扫端口更可靠。MCP 工具注册（1162 行）在 bridge 启动（1181 行）之前，bridge 失败不影响工具调用。

## 关键文件位置

| 文件 | 位置 |
|---|---|
| 改过的 bat | `D:/Proma-dev/start-{dev,pro,release,release-fresh}.bat`（**不在 git 仓库内**） |
| Dev engine | `D:/Proma-dev/resources/app/dist/tree-engine.cjs`（93KB，2026-06-23 部署） |
| Dev patches | `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`（111KB，2026-06-23 部署） |
| 备份 mcpvfy tree | `~/.proma-dev/agent-workspaces/default/.context/trees/_archive/mcpvfy-20260624/` |
| Wiki §19 | `workspace-files/.context/proma-dev-wiki.md` §十九（bridge 修复 + DbC 验证 + 命令签名备忘 + 心智模型） |
| 详细笔记 | `workspace-files/.context/note.md` 顶部 2 条（0.0.0.0 bug + Dev 运行时验证） |

## 下一步（新会话）

### 🔴 优先：V4-V8 深度加固（audit-attacks 暴露的 3 BYPASS + 2 GAP）

在 `D:/Proma-dev/resources/app/dist/tree-engine.cjs` 加 5 个 DbC 硬约束点：

- **V4** [ENABLER] `MS-free-auditpass`: milestone set-result 无条件设 audit_pass=true → 加独立 auditor 鉴权
- **V5** [BYPASS] `A3-omit-alignment`: brief_echo 省略 alignment 字段绕过独立审计 → alignment 必填
- **V6** [BYPASS] `A5-pass-false`: self_check 全 pass:false 通过 schema → 验 pass 值合法性
- **V7** [BYPASS] `CMD-done-no-audit`: commander 默认 verdict=skip 直接 done → 强制审计
- **V8** [GAP] `A4-budget0`: node_budget=0 被当默认值 10（|| 短路）→ 修短路逻辑
- **CP2-direct-forge** [BYPASS]: 直接改文件伪造 audit_gate.pass → 需 Layer 4 subagent_trace_id（平台层依赖，标注）

**推进方式**（自举验证延续）：派 SDK Agent 改 engine.cjs 加 5 个 DbC + dbc-spec 补 5 用例 + collaboration 审计子会话对抗。

### 其他方向
- **Phase D**: D1 prune/archive 语义拆分 / D2 migrate 版本号 / D3 watcher silence_minutes
- **Phase B-G**: 主动 Supervision / Capability Token / Hash Chain / Liveness
- **Layer 4**: 真·独立审计（subagent_trace_id，CLI 层极限是白名单）
- **历史树 schema 修复**: l1fix 等 8 issues（可用 migrate 的 role/added_by 修正规则）

## 三实例当前状态（可立即使用）

```text
release @ 127.0.0.1:19876  (Proma-black, PID 17624) — ISOLATED=0 共享正式版数据
dev     @ 127.0.0.1:19877  (Proma-white, PID 28028) — ISOLATED=1 数据 ~/.proma-dev/
pro     @ 127.0.0.1:19878  (Proma-green, PID 28344) — ISOLATED=1 数据 ~/.proma-pro/
```

## 新会话第一步

1. 读本文件 + PROJECT-INDEX.md + note.md 顶部 2 条（5 分钟恢复）
2. 决定优先级：V4-V8（推荐）/ Phase D / 历史树修复
3. V4-V8 用 Tree 思想：派 SDK Agent 改 engine.cjs 加 5 个 DbC + dbc-spec 补 5 用例 + collaboration 审计子会话对抗
