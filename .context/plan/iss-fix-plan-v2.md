# 4 个 ISS 修复方案 v2（经第一轮对抗审计迭代定稿）

> 2026-07-04 | 调研(4 SubAgent) → 对抗审计(4 SubAgent) → 迭代定稿 | ISS-003 经用户确认取阶段一

## ISS-001 remote_create_session workspace_id 兜底（定稿）

**根因**：`proma-dev-patches.cjs:1142-1170` fallback 用调用方本实例 slug；双重缺陷（slug vs 目标端 id 校验单位不匹配，行 1160 vs validateWorkspaceId 行 187）。

**定稿改动**：
1. fallback 段（1142-1170）：未传 workspace_id 时，调目标实例 list_workspaces，**只 find(slug==='default')**，命中用其 id；否则报 `E_WORKSPACE_REQUIRED`（hint 含"调 remote_list_workspaces"）；**禁止 slug fallback 复活**；list_workspaces 失败也报 E_WORKSPACE_REQUIRED。
2. `validateWorkspaceId`（179-204）：命中失败时二次尝试 slug→id 解析（防 V2 回归——显式传 slug 的旧调用方不被卡）。
3. **砍**：recency/first 启发式、cache。

**验证**：跨实例不传 workspace_id → 命中目标 default 工作区；显式传合法 id/slug → 零回归；目标无 default → 明确报错。

---

## ISS-002 同名会话切换（定稿，备选A + 修V3 + 诊断）

**根因**（审计反转）：renderer 纯 sessionId 匹配，**无 title 歧义**。sidebar item 实证无 `data-session-id`（dom-dump 证实）→ executeJavaScript 兜底无选择器，增量价值=0。真因大概率是 listAgentSessions 未 flush/命中 miss 或 session 失效。

**定稿改动**（patches.cjs:1903-1927 navigate-to-session handler）：
1. **备选 A**：预热 listAgentSessions（executeJavaScript 调 renderer 的 listAgentSessions 刷新 atom）→ 发主 IPC `tray:open-agent-session {sessionId, title}`。
2. **加诊断日志**：记录 metaHit / metaWorkspace / IPC 发送，便于未来定位（V4 真因未运行时确认）。
3. **修 V3**：tree 面板（proma-tree-view.js 注入段）加 `proma:navigate-failed` 监听，会话失效时 UI 提示（而非静默不动）。
4. **砍**：executeJavaScript click 兜底（无可靠选择器，DOM 耦合风险）。

**验证**：同名会话点击切换生效（若真因=list miss）；会话失效时有 UI 提示；非同名/新建零回归。

---

## ISS-003 done 门禁耦合审查（定稿，阶段一最小核心）

**根因**：done 门禁（tree-engine.cjs:1250-1273）只校验 audit_gate.verdict + events 数量 + self_check schema，不校验 G1-G5 审查收敛；R-06（patches.cjs:2464-2485）只标记不阻断。

**阶段一定稿改动**：
1. **done 门禁结构校验**（cmdLeafSetStatus 1250-1273 后追加）：worker + review_required 时，events[] 须含 ≥1 条 `review_round` 事件，schema `{round_no, reviewers:[{perspective, reviewer_session_id, findings:[{severity,item,evidence}]}], red_count, converged}`；末轮 `red_count===0` + `total_rounds≤3`。
2. **取消 reviewer_session_id 活性强校验**（审计致命伤）：只校验 UUID 格式 + `≠leaf.session_id` + `≠leaf.added_by`；**不调 checkSessionAlive**（SDK SubAgent 无 Proma session_id，强校验误杀合规 worker）。活性/内容真实性降为 commander 验收抽样。
3. **migrate flagged（非豁免）**：存量 done worker leaf 标 `review_evidence={grandfathered:true, flagged:true}`；下游 B 层 leaf 创建前必须补审清除 flagged（堵"问题文档合法 done"）。
4. **默认 opt-in**：新 tree `audit_meta.review_required` 默认 `false`（防金标准回归）；测试用 `PROMA_REVIEW_DISABLE=1` 旁路（仿 PROMA_CALL_LOG 先例 tree-engine.cjs:3933）。nanju 类树显式 opt-in。
5. **SKILL**：tree-worker §4.6 G1-G5 协议 + 分档（<1000字2/G1+G3，1000-5000字3，>5000字5）；§4.2 单 code-reviewer 降级为 milestone 轻量检查（消歧三轨）。
6. **6 核心测试**：结构通/不过、伪造收敛被拦、grandfathering flagged、空 findings、red_count>0 拦 done、3 轮上限。
7. **错误码**：`E_REVIEW_NOT_CONVERGED`、`E_REVIEW_FORGERY`。

**阶段二（follow-up，写入待解决清单）**：cmdReviewRound 专用命令、reviewer role + root 信任锚快速通道、Layer2 findings-产出相关性校验（A5 废话真防线）、R-08（改名避冲突）事后巡逻、剩余 12 测试。

**验证**：review_required=true 的 worker 不审直接 done → E_REVIEW_NOT_CONVERGED；跑 G1-G5 收敛 → 放行；grandfathered leaf 不阻断存量但下游拦截；金标准测试（review_required=false 默认）零回归。

---

## ISS-004 EPIPE 主进程异常（定稿，A + res.end补强 + B限定版）

**根因**：bridge server（patches.cjs:1375-1462，非~980）连接级 socket 无 on('error')；handler async res.end（1429）客户端先断 → EPIPE 冒 uncaughtException → Electron 弹窗。

**定稿改动**：
1. **方案 A**（line 1442 后、1443 listen 前）：`server.on('connection', socket => socket.on('error', err => { try{log(...)}catch(_){} }))`。
2. **res.end 补强**（审计发现，攻接近100%）：行 1429/1432 的 `res.end(...)` 包 try/catch（catch 内 res.end 再抛 EPIPE 是 socket.on-error 拦不住的同步 throw 残留路径）。
3. **方案 B 限定版**（顶部 require 后）：`process.on('uncaughtException', err => { if(EPIPE||ECONNRESET){log;return;} throw err; })` —— 严格限定两种 code，其余 rethrow 触发 Electron 默认弹窗（不掩盖真 bug）。
4. **日志可达性**：log 至少改 console.error（Electron stderr 某些版本进 crash log）；文件日志列为可选 follow-up。

**验证**：密集 send_message wait=true + 中途 kill MCP client → 无主进程弹窗 + 日志见 [bridge-socket] EPIPE。

---

## 实施顺序
1. ISS-001（patches.cjs fallback + validateWorkspaceId）—— 简单独立
2. ISS-004（patches.cjs bridge A + res.end + B）—— 简单独立
3. ISS-002（patches.cjs handler + tree-view V3）—— 中等
4. ISS-003 阶段一（tree-engine.cjs done 门禁 + migrate + SKILL + 测试）—— 复杂

## 部署同步
改完 workspace-files 顶层 → cp 到 D:/Proma-dev/resources/app/dist/ + D:/Proma-release/resources/app/dist/（tree-engine.cjs 内联在 patches.cjs，但工作区顶层有独立 tree-engine.cjs 副本，需核实同步关系）。
