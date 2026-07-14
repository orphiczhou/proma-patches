"use strict";
// Proma Dev Patches — Agent Session Management MCP Tools
// 提供 list_channels / list_sessions / get_session_info / get_session_context
//    create_session / fork_session / send_message
const { randomUUID } = require("node:crypto");
const path = require("path");
const fs = require("fs");

// ISS-004 纵深防御: 全局 uncaughtException 兜底.
//   注: Node EventEmitter 多 listener 并存, 加此 listener 不会移除 Electron 内置弹窗 handler ——
//   此 handler 的作用是 (a) EPIPE/ECONNRESET 降级为日志 (配合 bridge socket on-error 双保险, 防漏网);
//   (b) 其他未捕获异常结构化记录. 严格限定只吞 EPIPE/ECONNRESET, 其余 rethrow 触发 Electron 默认弹窗
//   (不掩盖真 bug). log 此时未定义, 用 console.error.
process.on("uncaughtException", (err) => {
  const code = err && err.code;
  if (code === "EPIPE" || code === "ECONNRESET") {
    try { console.error(`[proma-dev-patches] [swallowed] ${code}: ${err && err.message ? err.message : ''}`); } catch (_) {}
    return;  // 不退出, 不 rethrow
  }
  console.error(`[proma-dev-patches] [uncaughtException] ${(err && err.stack) || err}`);
  throw err;  // 其他异常 rethrow → Electron 默认弹窗 (不掩盖真 bug)
});

// ---- 远端实例 HTTP 调用 ----
const http = require("node:http");
const PORT_START = 19876;
const PORT_END = 19895;

function remoteHttpGet(port, path, host) {
  host = host || "127.0.0.1";
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host, port, path: "/" + path, method: "GET",
      timeout: 3000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
        catch (_) { reject(new Error("bad json")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

function remoteHttpPost(port, toolName, args, host) {
  host = host || "127.0.0.1";
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args || {});
    const buf = Buffer.from(body, "utf-8");
    const req = http.request({
      hostname: host, port, path: "/" + toolName, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": buf.length },
      timeout: 600000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
        catch (_) { resolve({ error: "Invalid JSON response" }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(buf);
    req.end();
  });
}

let instancePortCache = {};  // key=name → {host, port}
let instanceLastScan = 0;

async function discoverRemoteInstance(instanceName) {
  const cached = instancePortCache[instanceName];
  if (cached) return cached;
  // 支持 host:port 直连格式，跳过扫描
  const colonIdx = instanceName.lastIndexOf(":");
  if (colonIdx > 0) {
    const host = instanceName.slice(0, colonIdx);
    const port = parseInt(instanceName.slice(colonIdx + 1), 10);
    if (isNaN(port)) throw new Error(`Invalid port in '${instanceName}'. Use 'host:port' (e.g. '192.168.1.100:19876').`);
    // 直连验证
    const info = await remoteHttpGet(port, "get_instance_info", host);
    const name = (info && info.instance) || instanceName;
    instancePortCache[name] = { host, port };
    return { host, port };
  }
  // 本地端口扫描
  for (let p = PORT_START; p <= PORT_END; p++) {
    try {
      const info = await remoteHttpGet(p, "get_instance_info");
      if (info && info.instance === instanceName) {
        instancePortCache[instanceName] = { host: "127.0.0.1", port: p };
        return { host: "127.0.0.1", port: p };
      }
    } catch (_) { /* port not available */ }
  }
  // Fallback: 兼容未升级的旧实例（只有 proma_dev 布尔值，无 instance 字段）
  const fallbackMap = { dev: true, release: false };
  if (instanceName in fallbackMap) {
    for (let p = PORT_START; p <= PORT_END; p++) {
      try {
        const info = await remoteHttpGet(p, "get_instance_info");
        if (info && info.proma_dev === fallbackMap[instanceName] && !info.instance) {
          instancePortCache[instanceName] = { host: "127.0.0.1", port: p };
          return { host: "127.0.0.1", port: p };
        }
      } catch (_) { /* port not available */ }
    }
  }
  throw new Error(`No instance named '${instanceName}' found (scanned ${PORT_START}-${PORT_END}). Use 'host:port' format for LAN instances.`);
}

async function discoverInstances(opts) {
  opts = opts || {};
  const refresh = opts.refresh === true;
  const hosts = opts.hosts || [];

  // 缓存有效期内直接返回
  if (!refresh && instanceLastScan > 0 && (Date.now() - instanceLastScan < 60000) && hosts.length === 0) {
    const names = Object.keys(instancePortCache);
    if (names.length > 0) return { instances: names.map(n => ({ name: n, ...instancePortCache[n] })), cached: true };
  }

  const found = []; // [{name, host, port}]
  const seen = new Set();

  // 1. 扫描 localhost
  for (let p = PORT_START; p <= PORT_END; p++) {
    try {
      const info = await remoteHttpGet(p, "get_instance_info");
      const name = (info && info.instance) || null;
      if (name && !seen.has(name)) {
        seen.add(name);
        found.push({ name, host: "127.0.0.1", port: p });
        instancePortCache[name] = { host: "127.0.0.1", port: p };
      }
    } catch (_) { /* skip */ }
  }

  // 2. 探测指定的 LAN hosts
  for (const h of hosts) {
    for (let p = PORT_START; p <= PORT_END; p++) {
      try {
        const info = await remoteHttpGet(p, "get_instance_info", h);
        const name = (info && info.instance) || null;
        const key = `${h}:${p}`;
        if (name && !seen.has(name)) {
          seen.add(name);
          found.push({ name, host: h, port: p });
          instancePortCache[name] = { host: h, port: p };
        } else if (!name && info) {
          // 旧实例无 instance 字段，用 host:port 作为 key
          const fallbackName = `${h}:${p}`;
          if (!seen.has(fallbackName)) {
            seen.add(fallbackName);
            found.push({ name: fallbackName, host: h, port: p });
            instancePortCache[fallbackName] = { host: h, port: p };
          }
        }
      } catch (_) { /* skip */ }
    }
  }

  if (found.length === 0) return { instances: [], cached: false, message: "No instances found on localhost. Pass hosts: [\"192.168.x.x\"] to scan LAN." };
  instanceLastScan = Date.now();
  return { instances: found, cached: false };
}

const LOG_PREFIX = "[proma-dev-patches]";

function log(msg) {
  console.log(`${LOG_PREFIX} ${msg}`);
}

// ---- 辅助 ----
function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function api() {
  if (!global.__proma__) throw new Error("Plugin API bridge not initialized (global.__proma__ missing)");
  return global.__proma__;
}

// V10 Phase 3 followup (cross-workspace hardening):
// 校验 workspace_id 是否在 workspace 索引中合法. 用于 create_session + fork_session
// 双入口拦截, 避免 slug "undefined" 孤儿 / 跨工作区漂移 / mcp__tree__* 失败.
// 返回 {ok: true} 或 {ok: false, error: {...}}. best-effort: listAgentWorkspaces
// 抛错时不阻断 (返回 ok=true 但 log 警告, 与 list_sessions 等 house style 一致).
function validateWorkspaceId(workspaceId) {
  if (!workspaceId) return { ok: true };  // 未指定, 走默认 fallback
  // trim 防止 "   " 绕过
  const trimmed = (typeof workspaceId === 'string') ? workspaceId.trim() : workspaceId;
  if (!trimmed) return { ok: true };
  let validIds = null;
  let workspaces = null;
  try {
    workspaces = api().listAgentWorkspaces() || [];
    validIds = new Set(workspaces.map(w => w.id));
  } catch (e) {
    log("validateWorkspaceId: listAgentWorkspaces failed, skip validation: " + (e && e.message));
    return { ok: true };
  }
  if (validIds.has(trimmed)) return { ok: true, normalized: trimmed };
  // ISS-001 compat: 入参可能是 slug 而非 id (旧调用方/历史脚本/remote_create_session 旧逻辑残留).
  //   二次用 slug 匹配, 命中则 normalized 成 id (与下游 createAgentSession 期望的 workspaceId 单位对齐,
  //   也消除"validateWorkspaceId 用 id 索引、但调用方传 slug"的单位不匹配).
  if (workspaces && Array.isArray(workspaces)) {
    const bySlug = workspaces.find(w => w && w.slug === trimmed);
    if (bySlug && bySlug.id) return { ok: true, normalized: bySlug.id };
  }
  const validList = [...validIds].slice(0, 5).join(', ');
  const total = validIds.size;
  return {
    ok: false,
    error: {
      code: 'E_WORKSPACE_NOT_FOUND',
      msg: `workspace_id "${trimmed}" not in workspace index. Valid ids: ${validList}${total > 5 ? ` ...(${total} total)` : ''}. Use list_workspaces to see all.`,
      help_hint: 'Use mcp__session__list_workspaces to list valid workspace ids.',
      normalized: trimmed,
    }
  };
}

// ============================================================
// 层1加固 (caller ownership) — patches.cjs 身份冒用根治
// 设计文档: workspace-files/.context/plan/layer1-hardening-design.md
// 目标: 堵 send_message / fork_session / archive_session 的身份冒用漏洞。
//   sourceSessionId 是服务端注入的可信身份 (L1353 global.__proma_getMcpServers__
//   按 sessionId 闭包注入, agent 无法篡改自己身份), 但三个写工具从未用它做权限判定
//   → Agent A 可给任意 session B 注入消息 / fork 窃取上下文 / 归档破坏协作链。
//   加固 = 给三个写工具加 caller ownership 校验 (R1-R6), 并让 create_session /
//   fork_session 写 agentSession 级血缘字段。
//
// 新增血缘字段 (与官方 sdkSession 级 forkSourceSdkSessionId 严格区分, 运行时
//   updateAgentSessionMeta 是 generic merge, .cjs 不经 TS 类型检查, 可写自定义字段):
//   parentSessionId     — 谁创建/拥有我 (create_session + fork_session 都写, 用于 R2/R3/R4)
//   forkedFromSessionId — 我从哪个 agentSession fork 上下文 (仅 fork_session 写, 语义血缘)
//   delegationDepth     — 委派深度 (root/user 建=0, 子会话=parent.depth+1)
//   triggeredBy         — 'user' | 'agent' | 'automation' (R5 系统特权判定 + 审计)
//   ownerGrantedAt      — parentSessionId 写入时间戳 (审计/调试)
//
// 命名铁律 (D6): 绝不写 sourceSessionId / source_session_id / forked_from ——
//   这三个是 C-15 ruleC15 (L2587) 判定 "worker 是否 fork 建" 的依据, 官方从不写,
//   当前恒 undefined; 若 create_session 也写会破坏 C-15 语义 (误判 create 建的 worker
//   为 fork 建)。必须用全新字段名 parentSessionId / forkedFromSessionId。
// ============================================================

// D3: MAX_DELEGATION_DEPTH=10. tree-engine commander 限 3 层 (root→child→grandchild),
// session fork 链 (竹节交接/深度探索) 留余量到 10。R4 祖先链遍历也用此上限兜底。
const MAX_DELEGATION_DEPTH = 10;

// macp2 爆炸护栏 (2026-07-09, brief harness 评估新增): create_session 数量预算。
//   背景: macp2 commander 4 分钟扁平 create_session 207 reviewer（不入 tree，绕过 node_budget /
//   subagent_budget / TaoWatcher 全部）。delegationDepth 只防链式深递归，不防扁平重复。此为引擎层补充。
//   注: 行为约束（SKILL §13.5 + startup_notice）是治本，本预算是防御纵深（引擎硬拦）。
const CREATE_SESSION_BUDGET_WINDOW_MS = 60000;  // 60s 滚动窗口
const CREATE_SESSION_BUDGET_MAX = 20;           // 单 caller 60s 内最多 20 次（macp2 ~50/60s 远超）
const _createSessionBudgetMap = new Map();      // sourceSessionId -> [timestamps]
function checkCreateSessionBudget(sourceSid) {
  if (!sourceSid) return null;  // 外部/remote 无 caller 不限（走 R6 降级，已有 lineage 限制）
  const now = Date.now();
  const arr = (_createSessionBudgetMap.get(sourceSid) || []).filter(t => now - t < CREATE_SESSION_BUDGET_WINDOW_MS);
  if (arr.length >= CREATE_SESSION_BUDGET_MAX) {
    return { code: 'E_SESSION_BUDGET_EXCEEDED', count: arr.length };
  }
  arr.push(now);
  _createSessionBudgetMap.set(sourceSid, arr);
  // 偶发清理过期 key（防内存泄漏）
  if (_createSessionBudgetMap.size > 1000) {
    for (const [k, v] of _createSessionBudgetMap) {
      if (!v.some(t => now - t < CREATE_SESSION_BUDGET_WINDOW_MS)) _createSessionBudgetMap.delete(k);
    }
  }
  return null;
}

// Sprint 5 (聚类 A, improvement P0-S01 单边方案, 2026-07-14): create_session 旁路根治 — 定位 caller 所属 tree。
//   根因：SDK 原生 create_session 不经 mcp__tree__leaf add，tree engine 对其零感知（macp2 4 分钟 207 session
//   不入树，绕过 node_budget / subagent_budget / max_sessions 全部）。delegationDepth 只防链式深递归不防扁平重复。
//   本函数扫描所有 workspace 的 trees_dir，找 sourceSessionId 所属的 tree（在 leaves[].session_id 或 session_registry 里）。
//   返回 [{ trees_dir, tree_ids:[] }]，供 create_session handler 做 max_sessions 预检（create 前拒绝）+ 旁路登记（create 后）。
//   只读扫描，永不抛（异常返回 []，non-fatal —— 引擎侧 max_sessions 仍兜底）。
function findCallerTreesForBypassGuard(sourceSessionId) {
  if (!sourceSessionId) return [];
  let treeEngine;
  try { treeEngine = require("./tree-engine.cjs"); } catch (_) { return []; }
  if (!treeEngine || typeof treeEngine.findTreesBySession !== 'function') return [];
  const os = require("os");
  const home = os.homedir();
  const isIsolated = process.env.PROMA_INSTANCE_ISOLATED === "1" || process.env.PROMA_INSTANCE_NAME === "dev";
  const base = isIsolated ? path.join(home, ".proma-dev", "agent-workspaces") : path.join(home, ".proma", "agent-workspaces");
  const results = [];
  let wsEntries = [];
  try { wsEntries = fs.readdirSync(base); } catch (_) { return results; }
  for (const wsName of wsEntries) {
    const wsRoot = path.join(base, wsName);
    try { if (!fs.statSync(wsRoot).isDirectory()) continue; } catch (_) { continue; }
    const candidates = [
      path.join(wsRoot, "workspace-files", ".context", "trees"),
      path.join(wsRoot, ".context", "trees"),
    ];
    for (const treesDir of candidates) {
      try { if (!fs.existsSync(treesDir) || !fs.statSync(treesDir).isDirectory()) continue; } catch (_) { continue; }
      let treeIds = [];
      try { treeIds = treeEngine.findTreesBySession(treesDir, sourceSessionId); } catch (_) { treeIds = []; }
      if (treeIds && treeIds.length) results.push({ trees_dir: treesDir, tree_ids: treeIds });
    }
  }
  return results;
}

// 判定结果结构: { allow: bool, rule: string, reason: string, audit: bool }
//   allow=true 放行; audit=true 表示放行但记审计日志 (老会话兼容/系统特权/meta 丢失/外部 send)。

// R4 祖先链查询: sidA 与 sidB 之一是另一的祖先 (沿 parentSessionId 向上, ≤maxDepth)。
// 实现: 从 child 沿 parentSessionId 向上走能否到达 ancestor。O(depth) 次 getAgentSessionMeta,
//   不依赖 listAgentSessions 返回自定义字段 (getAgentSessionMeta 运行时全量), 带环保护。
function isAncestorOrDescendant(sidA, sidB, maxDepth) {
  maxDepth = maxDepth || MAX_DELEGATION_DEPTH;
  if (!sidA || !sidB || sidA === sidB) return false;
  let a;
  try { a = api(); } catch (_) { return false; }
  // 从 startSid 沿 parentSessionId 向上走, 看能否到达 seekSid
  function upChainReaches(startSid, seekSid, limit) {
    let cur = startSid;
    let hops = 0;
    const seen = new Set();
    while (cur && hops <= limit) {
      if (cur === seekSid) return true;
      if (seen.has(cur)) break;  // 环保护 (恶意/数据损坏形成环)
      seen.add(cur);
      let meta;
      try { meta = a.getAgentSessionMeta(cur); } catch (_) { meta = null; }
      if (!meta) break;
      cur = meta.parentSessionId;
      hops++;
    }
    return false;
  }
  // A 是 B 的祖先 ⇔ 从 B 向上能到 A;  B 是 A 的祖先 ⇔ 从 A 向上能到 B
  return upChainReaches(sidB, sidA, maxDepth) || upChainReaches(sidA, sidB, maxDepth);
}

// R5 系统特权 (心跳 automation)。D2 关键修正:
//   ⚠️ 0.13.16 automation 建会话直接调底层 createAgentSession (main.cjs L522554),
//   不经 patches 的 create_session handler → patches 写的 triggeredBy='automation' 写不进
//   automation 会话。因此 automation 识别必须用官方已有字段 meta.sourceAutomationId
//   (AgentSessionMeta 标准字段), 绝不能只依赖 triggeredBy。
//   triggeredBy 仍写 (给经 handler 的会话用), 但 R5 判定以 sourceAutomationId 为主。
//   收紧: automation 只允许 send (action==='send'), 同 workspace 才放行。
function isSystemPrivileged(srcMeta, tgtMeta, action) {
  if (action !== 'send') return false;  // automation 不能 fork/archive 他人 session
  if (!srcMeta) return false;
  const isAutomation = !!srcMeta.sourceAutomationId || srcMeta.triggeredBy === 'automation';
  if (!isAutomation) return false;
  // 同 workspace 才放行 (跨 workspace automation 仍需血缘)
  if (srcMeta.workspaceId && tgtMeta && tgtMeta.workspaceId &&
      srcMeta.workspaceId !== tgtMeta.workspaceId) return false;
  return true;
}

// caller ownership 核心校验 (R1-R6)。send_message / fork_session / archive_session 共用。
// action ∈ {'send','fork','archive'}。
// 返回 { allow, rule, reason, audit }。
function assertOwnership(sourceSid, targetSid, action) {
  // R6 外部/remote 降级 (sourceSessionId==null). D1 选项A: 外部仅允许 send, 禁 fork/archive。
  //   外部 stdio MCP (Claude Code) 和 remote_* 进来时 sourceSessionId=null, 无法做血缘;
  //   send 冒充危害 (注入消息) < fork 窃取上下文 / archive 破坏协作链, 故仅放行 send + 审计。
  if (!sourceSid) {
    if (action === 'send') {
      return { allow: true, rule: 'R6-external-send', audit: true,
        reason: 'external/remote caller: send allowed (D1-A), fork/archive denied' };
    }
    return { allow: false, rule: 'R6-external-deny', audit: true,
      reason: `external/remote caller: ${action} denied (D1-A: only send_message allowed)` };
  }

  let a, srcMeta, tgtMeta;
  try {
    a = api();
    srcMeta = a.getAgentSessionMeta(sourceSid);
    tgtMeta = a.getAgentSessionMeta(targetSid);
  } catch (e) {
    // api 异常不阻断 (best-effort, 信任闭包身份, 与 list_sessions house style 一致)
    return { allow: true, rule: 'ERR-api-bypass', audit: true,
      reason: 'ownership check api error (bypass): ' + (e && e.message ? e.message : String(e)) };
  }

  if (!tgtMeta) {
    return { allow: false, rule: 'E_TARGET_NOT_FOUND', audit: false,
      reason: `target session not found: ${targetSid}` };
  }
  if (!srcMeta) {
    // source meta 丢失不阻断: sourceSid 仍是可信的注入身份, meta 可能因 sessions.json
    // 延迟/GC 暂缺。放行 + 审计 (不阻断合法内部协作)。
    return { allow: true, rule: 'ALLOW_AUDIT-src-missing', audit: true,
      reason: `source meta missing (trusting injected sourceSid): ${sourceSid}` };
  }

  // R1 自循环 (模式2/3 fork 自己, worker 给自己总结)
  if (sourceSid === targetSid) {
    return { allow: true, rule: 'R1-self', audit: false, reason: 'self-loop' };
  }
  // R2 下行认领: target 的 parent 是 source (commander→worker, worker→reviewer)
  if (tgtMeta.parentSessionId === sourceSid) {
    return { allow: true, rule: 'R2-downstream', audit: false, reason: 'target owned by caller (downstream)' };
  }
  // R3 上行回报: source 的 parent 是 target (worker→commander, 反向必须允许, K2)
  if (srcMeta.parentSessionId === targetSid) {
    return { allow: true, rule: 'R3-upstream', audit: false, reason: 'caller reports to target (upstream)' };
  }
  // R4 多跳血缘 (祖先链, 子commander↔孙worker, 竹节交接链)
  if (isAncestorOrDescendant(sourceSid, targetSid, MAX_DELEGATION_DEPTH)) {
    return { allow: true, rule: 'R4-ancestor-chain', audit: false, reason: 'ancestor/descendant relation (multi-hop)' };
  }
  // R5 系统特权 (心跳 automation, D2: sourceAutomationId 识别)
  if (isSystemPrivileged(srcMeta, tgtMeta, action)) {
    return { allow: true, rule: 'R5-automation', audit: true,
      reason: 'automation heartbeat (sourceAutomationId), same-workspace send' };
  }
  // K9 / D5 老会话兼容: source 和 target 都无 parentSessionId (加固前建的)。
  //   P1 防借身份收紧：从"全 action allow+audit"改为"仅 send allow+audit，fork/archive deny"
  //   （与 R6 外部降级语义对齐：fork 窃取上下文 / archive 破坏协作链危害 > send，收紧迁移期老会话间冒用窗口）。
  //   send 放行保留 rule 'ALLOW_AUDIT-legacy'（test-layer1-ownership D5a/D5b 依赖此 rule 名断言）；
  //   fork/archive 改 DENY（test-layer1-ownership 未覆盖 both-legacy 的 fork/archive，无回归）。
  //   新→老 / 老→新（仅一方无 parentSessionId）不命中此块，仍走 E_NO_OWNERSHIP DENY（堵冒用，不变）。
  if (!srcMeta.parentSessionId && !tgtMeta.parentSessionId) {
    if (action === 'send') {
      return { allow: true, rule: 'ALLOW_AUDIT-legacy', audit: true,
        reason: 'both sessions pre-hardening (no lineage): send allow + audit (D5 backward compat; P1 tightened: fork/archive now denied)' };
    }
    return { allow: false, rule: 'DENY-legacy-no-lineage', audit: true,
      reason: `both sessions pre-hardening (no lineage): ${action} denied (D5 P1 tightened: only send_message allowed for legacy sessions without lineage; use create_session/fork_session with real parentSessionId to restore full delegation)` };
  }
  return { allow: false, rule: 'E_NO_OWNERSHIP', audit: true,
    reason: `no ownership: ${action} from ${sourceSid.slice(0, 8)} to ${targetSid.slice(0, 8)}` };
}

// 把 ownership 判定记审计日志 (DENY 必记, audit=true 的放行也记)。
function logOwnership(action, sourceSid, targetSid, decision) {
  const tag = decision.allow ? (decision.audit ? 'AUDIT' : 'ALLOW') : 'DENY';
  const src = sourceSid ? sourceSid.slice(0, 8) : '(external)';
  const tgt = targetSid ? targetSid.slice(0, 8) : '?';
  log(`[ownership:${tag}] action=${action} rule=${decision.rule} source=${src} target=${tgt} | ${decision.reason}`);
}

// ---- 7 个纯 handler（不依赖 sdk/zod，可在内部 MCP server 和 HTTP bridge 间共享）----
function createToolHandlers(sourceSessionId) {
  return {

    get_my_session_id: async (_args) => {
      return jsonResult({
        session_id: sourceSessionId || null,
        is_external: !sourceSessionId,
        hint: sourceSessionId ? "This is your own session ID. Use it with get_session_context, list_messages, etc." : "No session ID available (external MCP caller).",
      });
    },

    list_channels: async (_args) => {
      const a = api();
      const channels = a.listChannels();
      return jsonResult({
        channels: channels.map(c => ({
          id: c.id,
          name: c.name,
          provider: c.provider,
          enabled: !!c.enabled,
          agent_models: (c.models || []).filter(m => m.enabled !== false).map(m => ({
            id: m.id,
            name: m.name,
          })),
        })),
      });
    },

    list_workspaces: async (_args) => {
      const a = api();
      const workspaces = a.listAgentWorkspaces();
      return jsonResult({
        workspaces: workspaces.map(w => ({
          id: w.id,
          name: w.name,
          slug: w.slug,
          created_at: w.createdAt,
          updated_at: w.updatedAt,
        })),
      });
    },

    list_sessions: async (args) => {
      const a = api();
      let all = a.listAgentSessions();
      all = args.include_archived ? all : all.filter(s => !s.archived);
      if (args.workspace_id) all = all.filter(s => s.workspaceId === args.workspace_id);
      const limited = all.slice(0, args.limit ?? 50);

      // 批量查工作区名
      const wsNames = {};
      try {
        const wss = a.listAgentWorkspaces();
        wss.forEach(w => { wsNames[w.id] = w.name; });
      } catch (_) { /* best-effort */ }

      return jsonResult({
        count: limited.length,
        total: all.length,
        sessions: limited.map(s => ({
          id: s.id,
          title: s.title,
          channel_id: s.channelId,
          model_id: s.modelId,
          workspace_id: s.workspaceId,
          workspace_name: wsNames[s.workspaceId] || null,
          pinned: !!s.pinned,
          archived: !!s.archived,
          permission_mode: s.permissionMode,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
        })),
      });
    },

    get_session_info: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` });

      let channelInfo = null;
      if (meta.channelId) {
        const ch = a.getChannelById(meta.channelId);
        if (ch) channelInfo = { id: ch.id, name: ch.name, provider: ch.provider };
      }

      let workspaceInfo = null;
      if (meta.workspaceId) {
        const ws = a.getAgentWorkspace(meta.workspaceId);
        if (ws) workspaceInfo = { id: ws.id, name: ws.name, slug: ws.slug };
      }

      return jsonResult({
        id: meta.id,
        title: meta.title,
        channel_id: meta.channelId,
        model_id: meta.modelId,
        channel: channelInfo,
        workspace: workspaceInfo,
        pinned: !!meta.pinned,
        archived: !!meta.archived,
        permission_mode: meta.permissionMode,
        attached_directories: meta.attachedDirectories || [],
        attached_files: meta.attachedFiles || [],
        created_at: meta.createdAt,
        updated_at: meta.updatedAt,
      });
    },

    get_session_context: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` });

      // 从渠道配置中查模型的上下文窗口（作为 fallback）
      let configContextWindow = null;
      let configModelName = null;
      if (meta.channelId && meta.modelId) {
        try {
          const ch = a.getChannelById(meta.channelId);
          if (ch && ch.models) {
            const cm = ch.models.find(m => m.id === meta.modelId);
            if (cm) {
              configModelName = cm.name || meta.modelId;
              configContextWindow = cm.contextWindow || null;
            }
          }
        } catch (_) { /* channel lookup best-effort */ }
      }

      let usage = null, lastModel = null, contextWindow = null;
      let fallbackMsg = null;

      try {
        const msgs = a.getAgentSessionSDKMessages(args.session_id);
        if (msgs && msgs.length > 0) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].type === "result") {
              usage = msgs[i].usage || null;
              const mu = msgs[i].modelUsage;
              if (mu) {
                const keys = Object.keys(mu);
                if (keys.length > 0) {
                  lastModel = keys[0];
                  contextWindow = mu[lastModel].contextWindow || null;
                }
              }
              break;
            }
            // 检查是否有 billing_error
            if (msgs[i]._errorCode === "billing_error" && !fallbackMsg) {
              fallbackMsg = "Last turn failed: billing error (余额不足).";
            }
          }
        }
      } catch (_) { /* message read best-effort */ }

      // Fallback: 用渠道配置补充 contextWindow
      if (!contextWindow) contextWindow = configContextWindow;
      if (!lastModel) lastModel = configModelName || meta.modelId;

      if (!usage) {
        return jsonResult({
          session_id: args.session_id,
          title: meta.title,
          model: lastModel || null,
          context_window: contextWindow,
          message: fallbackMsg || "No usage data yet. Send a message and wait for it to complete.",
        });
      }

        const input = usage.input_tokens || 0;
        const output = usage.output_tokens || 0;
        const cache = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
        const pct = contextWindow ? ((input + output + cache) / contextWindow * 100).toFixed(1) + '%' : null;

        return jsonResult({
          session_id: args.session_id,
          title: meta.title,
          model: lastModel,
          context_window: contextWindow,
          usage: {
            input_tokens: input,
            output_tokens: output,
            cache_tokens: cache,
            total: input + output + cache,
            usage_pct: pct,
          },
        });
    },

    list_messages: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` });

      try {
        const msgs = a.getAgentSessionSDKMessages(args.session_id);
        if (!msgs || msgs.length === 0) {
          return jsonResult({ session_id: args.session_id, messages: [], count: 0, total: 0 });
        }

        const offset = args.offset ?? 0;
        const limit = Math.min(args.limit ?? 50, 200);
        const slice = msgs.slice(offset, offset + limit);

        const result = slice.map((m, i) => {
          const entry = {
            index: offset + i,
            type: m.type,
            uuid: m.uuid || null, // headless 的 user 消息可能没有 uuid
            timestamp: m._createdAt || m.timestamp || null,
            role: (m.message && m.message.role) ? m.message.role : (m.type === "user" ? "user" : m.type === "assistant" ? "assistant" : null),
          };
          if (m.type === "result") {
            entry.subtype = m.subtype || null;
            entry.duration_ms = m.duration_ms || null;
            if (m.usage) {
              entry.usage = {
                input_tokens: m.usage.input_tokens || 0,
                output_tokens: m.usage.output_tokens || 0,
                cache_tokens: (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0),
              };
            }
            if (m.result) entry.result_text = String(m.result).slice(0, 500);
          }
          if (m.message && m.message.content) {
            const texts = m.message.content.filter(c => c.type === "text").map(c => c.text);
            // DeepSeek 的 thinking block 不走 text，跳过
            const realTexts = m.message.content.filter(c => c.type === "text" && c.text).map(c => c.text);
            if (realTexts.length > 0) {
              entry.text = realTexts.join("\n").slice(0, 500);
              entry.text_full_length = realTexts.join("\n").length;
            }
          }
          if (m._errorCode) entry.error_code = m._errorCode;
          if (m._errorTitle) entry.error_title = m._errorTitle;
          return entry;
        });

        return jsonResult({
          session_id: args.session_id,
          count: result.length,
          total: msgs.length,
          offset,
          messages: result,
        });
      } catch (err) {
        return jsonResult({ error: `Read failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    },

    create_session: async (args) => {
      const a = api();

      const channel = a.getChannelById(args.channel_id);
      if (!channel) {
        return jsonResult({ error: `Channel not found: "${args.channel_id}". Use list_channels to see available channels.` });
      }

      let modelId = args.model_id;
      if (!modelId) {
        const models = channel.models || [];
        const first = models.find(m => m.enabled !== false);
        if (first) modelId = first.id;
        if (!modelId) {
          return jsonResult({ error: `No enabled models found for channel "${channel.name}". Check channel configuration.` });
        }
      }

      // V10 Phase 3 followup (cross-workspace hardening, cross-workspace-tree-issue §五 P1):
      // 校验 args.workspace_id 必须在 workspace 索引中合法. 之前直接透传, 导致
      // commander 跨工作区建 session → slug "undefined" bug 孤儿 / 跨工作区漂移 /
      // mcp__tree__* 工具失败. 运行时再现: GLM-5.2 v1 落 "undefined" slug → E_NO_TREES_DIR.
      const wsCheck = validateWorkspaceId(args.workspace_id);
      if (!wsCheck.ok) return jsonResult({ ok: false, error: wsCheck.error });
      let workspaceId = wsCheck.normalized || args.workspace_id;
      // 未指定 workspace_id 时不强制, createAgentSession 内部有 fallback, 加上
      // findTreesDirForWorkspace 的 slug "undefined" fallback 保护 (V10 已修).

      // Sprint 4 跨工作区 P1 Part B (cross-workspace-tree-issue §五 P1):
      // agent 调用方工作区锁定 — 堵平台 createAgentSession 不校验 workspaceId 导致
      //   9 工作区漂移. Part A (validateWorkspaceId / R2-R4) 只校验 workspace 存在, 但
      //   9 个工作区都在索引里所以拦不住 agent 跨工作区漂移. 本锁: agent 调用方
      //   (sourceSessionId 存在 = 非顶层 user/automation) 建子会话必须留在自己的
      //   workspace 内 —— 显式跨 → E_WORKSPACE_FORBIDDEN; 未指定 → 强制=调用方 workspace
      //   (防子会话 workspaceId=undefined 漂出 + 保证子树同工作区). 顶层 user/automation
      //   (无 sourceSessionId) 不受限 (跨工作区属 admin 操作). remote_create_session 是
      //   独立 handler, 不经此锁. 与 main.cjs createAgentSession 平台层校验 (P2) 互补.
      if (sourceSessionId) {
        try {
          const _callerMeta = a.getAgentSessionMeta(sourceSessionId);
          const _callerWs = _callerMeta && _callerMeta.workspaceId;
          if (_callerWs) {
            if (workspaceId && workspaceId !== _callerWs) {
              return jsonResult({ ok: false, error: { code: 'E_WORKSPACE_FORBIDDEN', msg: `create_session rejected: agent caller ${sourceSessionId.slice(0, 8)} is in workspace ${_callerWs.slice(0, 8)} but requested workspace ${workspaceId.slice(0, 8)}. Agents cannot cross workspaces (cross-workspace-tree-issue §五 P1). Cross-workspace creation is an admin/user operation, not an agent operation.` } });
            }
            if (!workspaceId) {
              // 未显式指定 → 强制到调用方 workspace (防 workspaceId=undefined 漂移 + 子树同工作区)
              workspaceId = _callerWs;
            }
          }
        } catch (e) { log(`[create_session] caller-workspace lock check skipped (non-fatal): ${e && e.message ? e.message : String(e)}`); }
      }

      // macp2 爆炸护栏 (2026-07-09): create_session 数量预算（在 delegationDepth 前, 成本低先拦）
      const _budgetHit = checkCreateSessionBudget(sourceSessionId);
      if (_budgetHit) {
        return jsonResult({ ok: false, error: { code: _budgetHit.code, msg: `create_session rejected: caller ${sourceSessionId ? sourceSessionId.slice(0, 8) : '(no-caller)'} created ${_budgetHit.count} sessions in last ${CREATE_SESSION_BUDGET_WINDOW_MS / 1000}s (max ${CREATE_SESSION_BUDGET_MAX}). Possible session-splosion (macp2 pattern: create_session used as reviewer, bypassing tree budget). Converge review, reuse sessions, or use in-process SubAgent (CLAUDE.md P0 红线).` } });
      }

      // Sprint 5 (聚类 A, improvement P0-S01 单边方案, 2026-07-14): create_session 旁路根治 — max_sessions 预检。
      //   根因：SDK 原生 create_session 不经 mcp__tree__leaf add，engine 对其零感知（macp2 207 session 不入树）。
      //   单边方案（子会话能做）：create 前查 caller 所属 tree 的 session 总数，达 max_sessions → 拒绝（钱没花）；
      //   create 后把新 session 登记到所属 tree session_registry（旁路可见，让 max_sessions/审计覆盖旁路 create）。
      //   跨仓根治（标记汇报，不做）：真正根治需 Proma SDK create_session 回调钩子 + subagent_trace_id（Layer 4 平台层）。
      let _pendingBypassRegister = null;
      if (sourceSessionId) {
        try {
          const _ownerTrees = findCallerTreesForBypassGuard(sourceSessionId);
          if (_ownerTrees.length) {
            const _eng = require("./tree-engine.cjs");
            for (const _ot of _ownerTrees) {
              for (const _tid of _ot.tree_ids) {
                const _sc = await _eng.run('tree', ['session-count', _tid], _ot.trees_dir);
                if (_sc && _sc.ok && _sc.reached) {
                  return jsonResult({ ok: false, error: { code: 'E_MAX_SESSIONS', msg: `create_session rejected: caller ${sourceSessionId.slice(0, 8)}'s tree "${_tid}" has ${_sc.count} sessions (max ${_sc.max}, reached). macp2-style session-splosion guard (聚类A 旁路根治). Archive sessions, reuse via segment handoff, or raise audit_meta.max_sessions.` } });
                }
              }
            }
            _pendingBypassRegister = _ownerTrees;
          }
        } catch (e) { log(`[create_session] max_sessions bypass precheck skipped (non-fatal): ${e && e.message ? e.message : String(e)}`); }
      }

      // 层1加固 §6: delegationDepth 预检 (createAgentSession 之前, 超限直接拒绝避免孤儿 session)
      let _newDepth = 0;
      if (sourceSessionId) {
        let _srcMeta = null;
        try { _srcMeta = a.getAgentSessionMeta(sourceSessionId); } catch (_) {}
        const _srcDepth = (_srcMeta && typeof _srcMeta.delegationDepth === 'number') ? _srcMeta.delegationDepth : 0;
        _newDepth = _srcDepth + 1;
        if (_newDepth > MAX_DELEGATION_DEPTH) {
          return jsonResult({ ok: false, error: { code: 'E_DELEGATION_TOO_DEEP', msg: `create denied: delegation depth ${_newDepth} > MAX_DELEGATION_DEPTH(${MAX_DELEGATION_DEPTH}). Source ${sourceSessionId.slice(0, 8)} already at depth ${_srcDepth}.` } });
        }
      }
      try {
        const meta = a.createAgentSession(args.title, args.channel_id, workspaceId, modelId);
        // 层1加固 K1: 补写 agentSession 级血缘 (commander 建的 worker 必须能被 ownership R2 认领,
        //   否则 tree 下发/开小弟全断). 命名铁律: 绝不写 source_session_id/forked_from (C-15 在用).
        try {
          if (sourceSessionId) {
            a.updateAgentSessionMeta(meta.id, {
              parentSessionId: sourceSessionId,
              delegationDepth: _newDepth,
              triggeredBy: 'agent',
              ownerGrantedAt: Date.now(),
            });
          } else {
            // 外部/automation: 不写 parentSessionId (避免外部冒认), depth=0
            a.updateAgentSessionMeta(meta.id, { delegationDepth: 0, triggeredBy: 'user' });
          }
        } catch (e) { log(`[create_session] lineage write failed (non-fatal): ${e && e.message ? e.message : String(e)}`); }
        // Sprint 5 (聚类 A): create 成功后登记旁路 session 到所属 tree session_registry
        //   （旁路可见，让 max_sessions/审计覆盖旁路 create_session —— macp2 型爆炸的根因缓解）。
        if (_pendingBypassRegister && meta && meta.id) {
          const _eng2 = require("./tree-engine.cjs");
          for (const _ot of _pendingBypassRegister) {
            for (const _tid of _ot.tree_ids) {
              try {
                await _eng2.run('tree', ['register-session', _tid, '--session-id', meta.id, '--source', 'create_session', '--caller', sourceSessionId], _ot.trees_dir);
              } catch (e) { log(`[create_session] bypass session register to tree "${_tid}" failed (non-fatal): ${e && e.message ? e.message : String(e)}`); }
            }
          }
        }
        log(`Session created: ${meta.id.slice(0, 8)} "${meta.title}" channel=${args.channel_id} workspace=${workspaceId || '(default)'} model=${modelId}`);
        return jsonResult({
          session: {
            id: meta.id,
            title: meta.title,
            channel_id: meta.channelId,
            model_id: meta.modelId,
            workspace_id: meta.workspaceId,
            created_at: meta.createdAt,
          },
          message: `Session created: ${meta.title} (${meta.id.slice(0, 8)}). Open the Proma sidebar (manual refresh) to see and switch to this session.`,
        });
      } catch (err) {
        return jsonResult({ error: `Failed to create session: ${err instanceof Error ? err.message : String(err)}` });
      }
    },

    fork_session: async (args) => {
      const a = api();

      const source = a.getAgentSessionMeta(args.source_session_id);
      if (!source) {
        return jsonResult({ error: `Source session not found: "${args.source_session_id}". Use list_sessions to find valid session IDs.` });
      }

      // 层1加固: caller 必须拥有 source 才能 fork (防任意 agent fork 他人 session 窃取完整上下文, 修 L693 区域漏洞)
      const _forkOwn = assertOwnership(sourceSessionId, args.source_session_id, 'fork');
      if (!_forkOwn.allow) {
        logOwnership('fork', sourceSessionId, args.source_session_id, _forkOwn);
        return jsonResult({ ok: false, error: { code: _forkOwn.rule, msg: `fork_session denied: ${_forkOwn.reason}` } });
      }
      if (_forkOwn.audit) logOwnership('fork', sourceSessionId, args.source_session_id, _forkOwn);

      // 层1加固 §6: delegationDepth 预检 (forkAgentSession 之前, 超限拒绝避免孤儿)
      const _forkSrcDepth = (typeof source.delegationDepth === 'number') ? source.delegationDepth : 0;
      const _forkNewDepth = _forkSrcDepth + 1;
      if (_forkNewDepth > MAX_DELEGATION_DEPTH) {
        return jsonResult({ ok: false, error: { code: 'E_DELEGATION_TOO_DEEP', msg: `fork denied: delegation depth ${_forkNewDepth} > MAX_DELEGATION_DEPTH(${MAX_DELEGATION_DEPTH}). Source ${args.source_session_id.slice(0, 8)} already at depth ${_forkSrcDepth}.` } });
      }

      if (!source.sdkSessionId) {
        return jsonResult({ error: `Cannot fork: source session "${source.title}" has no SDK session yet. Send at least one message in the session first.` });
      }

      try {
        // Bug 4 修复：SDK forkSession 单次只读一个 sdkSessionId 的 JSONL，跨 sdkSession
        // 的 UUID 解析会失败（agent session 在补丁 H 清空/sidechain/重建后关联多个 sdkSession）。
        // 收集候选 sdkSessionId 集合，逐一尝试 forkAgentSession，哪个成功用哪个。
        const candidateSdkIds = new Set();
        if (source.sdkSessionId) candidateSdkIds.add(source.sdkSessionId);
        if (source.forkSourceSdkSessionId) candidateSdkIds.add(source.forkSourceSdkSessionId);
        try {
          const msgs = a.getAgentSessionSDKMessages(args.source_session_id) || [];
          // 目标消息的 session_id 优先
          if (args.up_to_message_uuid) {
            const target = msgs.find(m => m.uuid === args.up_to_message_uuid);
            if (target && typeof target.session_id === "string" && target.session_id) {
              candidateSdkIds.add(target.session_id);
            }
          }
          // 兜底：历史所有 session_id 都纳入候选
          for (const m of msgs) {
            if (typeof m.session_id === "string" && m.session_id) candidateSdkIds.add(m.session_id);
          }
        } catch (_) { /* best-effort */ }

        let forked = null;
        let lastErr = null;
        for (const candSdk of candidateSdkIds) {
          try {
            forked = await a.forkAgentSession({
              sessionId: args.source_session_id,
              upToMessageUuid: args.up_to_message_uuid,
              _forceSdkSessionId: candSdk,
            });
            if (candSdk !== source.sdkSessionId) {
              log(`[fork_session] 跨 sdkSession fork 成功，使用 ${candSdk.slice(0, 8)} (默认是 ${source.sdkSessionId.slice(0, 8)})`);
            }
            break;
          } catch (e) {
            lastErr = e;
            const emsg = e instanceof Error ? e.message : String(e);
            // 候选缺失类错误继续尝试下一个；其他错误直接抛
            if (/not found in session|Invalid|Session.*not found|没有 SDK session|session not found/i.test(emsg)) {
              log(`[fork_session] 候选 ${candSdk.slice(0, 8)} 失败: ${emsg.slice(0, 100)}, 尝试下一个`);
              continue;
            }
            throw e;
          }
        }
        if (!forked) {
          throw lastErr || new Error("All sdkSessionId candidates failed");
        }

        const updates = {};
        // 层1加固: 写 agentSession 级血缘 (caller 认领 fork 产物, 区别于 sdkSession 级 forkSourceSdkSessionId)。
        //   命名铁律: 用 forkedFromSessionId (语义血缘), 不碰 source_session_id/forked_from (C-15 在用)。
        updates.parentSessionId = sourceSessionId || args.source_session_id;  // caller 认领 (内部用 sourceSessionId, 外部降级用 args)
        updates.forkedFromSessionId = args.source_session_id;                 // 语义血缘 (fork 才写)
        updates.delegationDepth = _forkNewDepth;                               // 从 source 继承 depth+1
        updates.triggeredBy = sourceSessionId ? 'agent' : 'user';
        updates.ownerGrantedAt = Date.now();
        if (args.title) updates.title = args.title;
        const effectiveChannelId = args.new_channel_id || source.channelId;
        if (effectiveChannelId) updates.channelId = effectiveChannelId;
        const effectiveModelId = args.new_model_id || source.modelId;
        if (effectiveModelId) updates.modelId = effectiveModelId;
        // V10 Phase 3 followup (cross-workspace hardening, 补 create_session 同类漏洞):
        // fork_session 的 new_workspace_id 之前直接透传, 是 create_session 防御的
        // 最直接绕过途径 (代码审计 SubAgent 发现). 共享 validateWorkspaceId helper.
        if (args.new_workspace_id) {
          const wsCheck = validateWorkspaceId(args.new_workspace_id);
          if (!wsCheck.ok) return jsonResult({ ok: false, error: wsCheck.error });
          // Sprint 4 跨工作区 P1 Part B (fork_session 同类漏洞): agent 调用方不能把 fork
          //   落到别的 workspace (堵 create_session 同源的跨工作区漂移). Part A 只校验存在.
          if (sourceSessionId) {
            try {
              const _callerMeta = a.getAgentSessionMeta(sourceSessionId);
              const _callerWs = _callerMeta && _callerMeta.workspaceId;
              if (_callerWs && wsCheck.normalized && wsCheck.normalized !== _callerWs) {
                return jsonResult({ ok: false, error: { code: 'E_WORKSPACE_FORBIDDEN', msg: `fork_session rejected: agent caller ${sourceSessionId.slice(0, 8)} is in workspace ${_callerWs.slice(0, 8)} but requested new_workspace_id ${wsCheck.normalized.slice(0, 8)}. Agents cannot cross workspaces (cross-workspace-tree-issue §五 P1).` } });
              }
            } catch (e) { log(`[fork_session] caller-workspace lock check skipped (non-fatal): ${e && e.message ? e.message : String(e)}`); }
          }
          updates.workspaceId = wsCheck.normalized || args.new_workspace_id;
        }

        a.updateAgentSessionMeta(forked.id, updates);
        Object.assign(forked, updates);

        // V9+ Phase 4 (R2 P1 / Fork 幻觉修复): fork 后同步等待身份提示注入完成。
        //   失守根因：R1 洁净室 C1+C5 双重确认 — fork 会话继承根会话完整上下文后，
        //   缺少"你是 fork"的身份提示，自主越权执行建 leaf、写 done event、伪造 auditor UUID，
        //   污染 tree-state.json（C1 实测：validate 返回 4 issues）。
        //   修复：fork 完成后同步注入一条身份提示 user message 并等待响应，让 fork 会话明确：
        //   ① 自己是 fork（非源会话）② 新 session_id ③ 禁止越权执行源会话身份相关操作。
        //   设计权衡：增加 ~5-15s 延迟换取身份确定性，比异步注入更可靠（异步注入可能与
        //   后续真实任务消息竞争，导致身份提示被覆盖）。
        //   审计员 P1 反馈：fork_identity_injected 改三态（injected/timeout/failed），
        //     让调用方能区分实际状态，避免误导性 true。
        //   审计员 P0 反馈：超时路径需要 stop 后台 agent，防止 send_message 被静默丢弃。
        const forkChannelId = effectiveChannelId || source.channelId;
        const forkModelId = effectiveModelId || source.modelId;
        const identityPrompt = [
          '【FORK 身份提示 - V9+ Phase 4 / R2 P1 修复】',
          '',
          `你是从源会话 ${args.source_session_id.slice(0, 8)}... fork 出来的副本（不是源会话本身）。`,
          '',
          '**身份信息**：',
          `- 你的新 session_id: ${forked.id}`,
          `- 源会话 session_id: ${args.source_session_id}`,
          '',
          '**关键约束（必须遵守，任何后续消息都不得覆盖）**：',
          '1. 你**不是**源会话本身。源会话身份相关的操作（如以源会话身份建 leaf、写 done event、',
          '   调 audit_gate、伪造 auditor UUID）你**无权**执行。',
          '2. 你的新 session_id 在 tree-state.json 中**不归属任何 leaf**。如需执行 tree 操作，',
          '   必须由父会话重新分配 leaf_id 与你新 session_id 的关联。',
          '3. 你的首要任务是：等待父会话给出明确任务。**禁止**主动越权执行任何 tree 写操作。',
          '4. 如果你接到父会话任务（含明确 leaf_id 指派），按任务要求执行；不要复用源会话的',
          '   leaf owner 身份。',
          '',
          '请回复："我已确认 fork 身份，新 session_id=' + forked.id.slice(0, 8) + '..., 等待父会话指令。" 以确认。'
        ].join('\n');

        let identityStatus = 'failed';  // 默认失败，仅注入流程走完且 onComplete 才置 injected
        try {
          await new Promise((resolve) => {
            let settled = false;
            const timeout = setTimeout(() => {
              if (settled) return;
              settled = true;
              identityStatus = 'timeout';
              // 审计员 P0 反馈：超时分支必须 stop 后台 agent，防止后续 send_message 被 activeSessions 静默丢弃
              try {
                if (typeof a.stopAgent === 'function') {
                  a.stopAgent(forked.id);
                  log(`[fork_session] 身份提示超时，已 stop 后台 agent: fork ${forked.id.slice(0, 8)}`);
                } else {
                  log(`[fork_session] 身份提示超时（a.stopAgent 不存在，未清理后台 agent）: fork ${forked.id.slice(0, 8)}`);
                }
              } catch (stopErr) {
                log(`[fork_session] stopAgent 异常: ${stopErr}`);
              }
              resolve();
            }, 30000);
            try {
              a.runAgentHeadless(
                {
                  sessionId: forked.id,
                  userMessage: identityPrompt,
                  channelId: forkChannelId,
                  modelId: forkModelId,
                  workspaceId: forked.workspaceId,
                  permissionModeOverride: 'bypassPermissions',
                },
                {
                  onComplete: () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    identityStatus = 'injected';
                    log(`[fork_session] 身份提示注入成功: fork ${forked.id.slice(0, 8)}`);
                    resolve();
                  },
                  onError: (e) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    identityStatus = 'failed';
                    log(`[fork_session] 身份提示注入失败（fork 仍返回成功）: ${e}`);
                    resolve();
                  },
                  onTitleUpdated: () => {},
                }
              );
            } catch (syncErr) {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              identityStatus = 'failed';
              log(`[fork_session] 身份提示注入同步异常: ${syncErr}`);
              resolve();
            }
          });
        } catch (identityErr) {
          identityStatus = 'failed';
          log(`[fork_session] 身份提示流程异常（不影响 fork 结果）: ${identityErr}`);
        }

        log(`Session forked: ${forked.id.slice(0, 8)} from ${args.source_session_id.slice(0, 8)} (identity: ${identityStatus})`);
        return jsonResult({
          session: {
            id: forked.id,
            title: forked.title,
            channel_id: forked.channelId,
            model_id: forked.modelId,
            workspace_id: forked.workspaceId,
            source_session_id: args.source_session_id,
            fork_source_sdk_session_id: forked.forkSourceSdkSessionId,
            created_at: forked.createdAt,
            fork_identity_status: identityStatus,  // injected / timeout / failed
          },
          message: `Session forked: ${forked.title} (${forked.id.slice(0, 8)}) from "${source.title}". Fork 身份提示状态: ${identityStatus}（V9+ Phase 4 R2 P1）。Open the Proma sidebar to see and switch to the forked session.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("没有 SDK session") || msg.includes("session not found") || (msg.includes("Session") && msg.includes("not found"))) {
          return jsonResult({ error: `Fork failed: SDK runtime GC'd (PROMA_DEV mode headless sessions are short-lived). Workaround: use remote-session tools to fork on a non-dev instance, or create the source session via the UI for a persistent runtime.` });
        }
        return jsonResult({ error: `Fork failed: ${msg}` });
      }
    },

    send_message: async (args) => {
      const a = api();

      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) {
        return jsonResult({ error: `Target session not found: "${args.session_id}".` });
      }

      // 层1加固: caller ownership 校验 (堵身份冒用核心漏洞 L712)。
      //   caller(sourceSessionId) 必须对 target 拥有所有权 (血缘/自循环/系统特权),
      //   否则任意 agent 可给 target 注入 user message 冒充指令/污染上下文。
      //   notify 回调 (onComplete 内 runAgentHeadless sourceSessionId) 不经此 handler, 天然免疫。
      const _sendOwn = assertOwnership(sourceSessionId, args.session_id, 'send');
      if (!_sendOwn.allow) {
        logOwnership('send', sourceSessionId, args.session_id, _sendOwn);
        return jsonResult({ ok: false, error: { code: _sendOwn.rule, msg: `send_message denied: ${_sendOwn.reason}` } });
      }
      if (_sendOwn.audit) logOwnership('send', sourceSessionId, args.session_id, _sendOwn);

      const channelId = args.channel_id || meta.channelId;
      if (!channelId) {
        return jsonResult({ error: "No channel available for this session." });
      }

      const modelId = args.model_id || meta.modelId;

      // 镜像补丁 H v2：跨频道/模型切换时同步 meta + 清空 sdkSessionId（修复 Bug 5）
      // send_message 走 runAgentHeadless 路径，不经过 main.cjs sendMessage() 入口的补丁 H
      // 这里在工具层显式同步，保证程序化切换模型时 meta 也正确更新
      if (meta && ((meta.channelId && channelId && channelId !== meta.channelId) ||
                   (meta.modelId && modelId && modelId !== meta.modelId))) {
        try {
          a.updateAgentSessionMeta(args.session_id, {
            channelId,
            sdkSessionId: void 0,
            ...(modelId ? { modelId } : {}),
          });
          log(`[send_message] 检测到模型/频道切换: ${meta.channelId}/${meta.modelId || "?"} → ${channelId}/${modelId || "?"}, 已同步 meta 并清空 sdkSessionId`);
        } catch (e) {
          log(`[send_message] meta 同步失败: ${e}`);
        }
      }

      const shouldWait = args.wait !== false;
      const shouldNotify = args.notify === true;

      // 外部调用（无 sourceSessionId）不允许 notify 模式
      if (shouldNotify && !sourceSessionId) {
        return jsonResult({ error: "notify=true is not supported from external MCP (no source session). Use wait=true (default) or wait=false without notify." });
      }

      let sourceChannelId = null;
      if (shouldNotify && sourceSessionId) {
        const sourceMeta = a.getAgentSessionMeta(sourceSessionId);
        sourceChannelId = sourceMeta?.channelId;
      }

      // Bug 6 修复（预检）：调 runAgentHeadless 前先检查会话是否忙碌。
      // main.cjs orchestrator.sendMessage 入口有 activeSessions 守卫，命中时会静默丢弃
      // 用户消息（在 appendSDKMessages 之前 return）。预检能避免调用方被骗成 "started"。
      if (typeof a.isAgentSessionActive === "function" && a.isAgentSessionActive(args.session_id)) {
        return jsonResult({
          session_id: args.session_id,
          status: "busy",
          error: `Session "${meta.title}" is currently processing another message. Wait for it to complete, or use a different session.`,
          hint: "For concurrent work, use multiple sessions instead of sending multiple messages to the same session in parallel.",
        });
      }

      try {
        const result = await new Promise((resolve, reject) => {
          a.runAgentHeadless(
            {
              sessionId: args.session_id,
              userMessage: args.message,
              channelId,
              modelId,
              workspaceId: meta.workspaceId,
              permissionModeOverride: "bypassPermissions",
            },
            {
              onComplete: () => {
                log(`Headless ${args.session_id.slice(0, 8)} completed`);
                if (shouldNotify && sourceSessionId && sourceChannelId) {
                  try {
                    a.runAgentHeadless(
                      { sessionId: sourceSessionId, userMessage: `[系统通知] 目标会话任务已完成\n\n- 会话: ${meta.title || "未命名"}(${args.session_id.slice(0, 8)})\n- 渠道: ${channelId}\n- 模型: ${modelId || "默认"}\n\n你可以切换到该会话查看完整结果。`, channelId: sourceChannelId, permissionModeOverride: "bypassPermissions" },
                      { onComplete: () => log(`Notify source OK`), onError: (e) => log(`Notify source err: ${e}`), onTitleUpdated: () => {} },
                    );
                  } catch (e) { log(`Notify source fail: ${e}`); }
                }
                if (shouldWait) resolve({ status: "completed" });
              },
              onError: (errMsg) => {
                log(`Headless ${args.session_id.slice(0, 8)} error: ${errMsg}`);
                if (shouldNotify && sourceSessionId && sourceChannelId) {
                  try {
                    a.runAgentHeadless(
                      { sessionId: sourceSessionId, userMessage: `[系统通知] 目标会话任务出错\n\n- 会话: ${meta.title || "未命名"}(${args.session_id.slice(0, 8)})\n- 错误: ${errMsg}`, channelId: sourceChannelId, permissionModeOverride: "bypassPermissions" },
                      { onComplete: () => {}, onError: () => {}, onTitleUpdated: () => {} },
                    );
                  } catch (e) {}
                }
                // Bug 6 修复（兜底）：去掉 shouldWait 包裹，让 wait=false 路径也能 reject。
                // 守卫拒绝/SDK 同步段错误时让调用方看到错误，而不是被骗成 "started"。
                // 异步 SDK 错误时 promise 已被 resolve("started")，reject 无效，行为不变。
                reject(new Error(errMsg));
              },
              onTitleUpdated: (title) => {
                try { a.updateAgentSessionMeta(args.session_id, { title }); } catch (_) {}
              },
            }
          );

          if (!shouldWait) resolve({ status: "started" });
        });

        if (result.status === "started") {
          return jsonResult({
            session_id: args.session_id,
            status: "started",
            notify: shouldNotify,
            message: shouldNotify
              ? `Fire-and-forget + async notify: message sent to "${meta.title}". When it completes, this session will receive a system notification.`
              : `Fire-and-forget: message sent to "${meta.title}".`,
          });
        }

        // wait=true 完成：读取最终输出
        let replyText = null;
        try {
          const msgs = a.getAgentSessionSDKMessages(args.session_id);
          if (msgs && msgs.length > 0) {
            // 取最后一条 assistant 消息
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i];
              if (m.type === "assistant" && m.message && m.message.content) {
                const texts = m.message.content.filter(c => c.type === "text").map(c => c.text);
                if (texts.length > 0) replyText = texts.join("\n");
                break;
              }
              if (m.type === "result" && m.result) {
                replyText = String(m.result);
                break;
              }
            }
          }
        } catch (_) { /* best-effort */ }

        return jsonResult({
          session_id: args.session_id,
          status: "completed",
          reply: replyText,
          message: replyText
            ? `Target session "${meta.title}" completed. See "reply" field for output.`
            : `Target session "${meta.title}" has finished processing (no text output captured).`,
        });
      } catch (err) {
        return jsonResult({
          session_id: args.session_id,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    archive_session: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` });
      // 层1加固: caller ownership 校验 (防任意 agent 归档他人 session → DoS / 破坏协作链)。
      //   注意 R5 isSystemPrivileged 只允许 action='send', 故 automation 不能 archive (符合预期: 心跳不应归档他人)。
      const _archOwn = assertOwnership(sourceSessionId, args.session_id, 'archive');
      if (!_archOwn.allow) {
        logOwnership('archive', sourceSessionId, args.session_id, _archOwn);
        return jsonResult({ ok: false, error: { code: _archOwn.rule, msg: `archive_session denied: ${_archOwn.reason}` } });
      }
      if (_archOwn.audit) logOwnership('archive', sourceSessionId, args.session_id, _archOwn);
      const archived = args.archived !== false; // default true
      a.updateAgentSessionMeta(args.session_id, { archived });
      log(`Session ${archived ? "archived" : "unarchived"}: ${args.session_id.slice(0, 8)} "${meta.title}"`);
      return jsonResult({ session_id: args.session_id, title: meta.title, archived });
    },

    discover_instances: async (args) => {
      return jsonResult(await discoverInstances(args));
    },

  };
}

// ---- 远端 Session MCP Server（通过 HTTP 代理到其他 Proma 实例）----
function createRemoteToolHandlers() {
  async function resolve(args) {
    const r = await discoverRemoteInstance(args.instance);
    return { host: r.host, port: r.port };
  }
  return {
    remote_list_channels: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "list_channels", {}, host));
    },
    remote_list_workspaces: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "list_workspaces", {}, host));
    },
    remote_list_sessions: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "list_sessions", args, host));
    },
    remote_get_session_info: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "get_session_info", args, host));
    },
    remote_get_session_context: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "get_session_context", args, host));
    },
    remote_list_messages: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "list_messages", args, host));
    },
    remote_create_session: async (args) => {
      const {host, port} = await resolve(args);
      // V10-workspace-canonical: 强制 workspace_id（堵 slug="undefined" 字符串污染 findTreesDirForWorkspace）。
      //   失守案例 532465c5：调用方传 workspace_id=undefined，被序列化成 "undefined" 字符串，
      //   下游 findTreesDirForWorkspace 直接返回 null，引擎层无感知。
      //   修复：调用方必须显式传 workspace_id；缺失时尝试 fallback 到当前实例激活 workspace（findCurrentWorkspaceSlug），
      //   仍无法确定则明确报错（不再静默放行 "undefined" 字符串）。
      let payload = Object.assign({}, args);
      if (!payload.workspace_id || payload.workspace_id === 'undefined' || payload.workspace_id === 'null') {
        // ISS-001 fix (cross-instance workspace_id resolution):
        //   旧实现 fallback 到【调用方本实例】的 slug (e.g. "proma"), 透传到目标实例必失败 ——
        //   目标实例索引里没有 "proma", 且 fallback 传 slug 而目标端 validateWorkspaceId 用 id 校验, 单位不匹配.
        //   新实现: 询问【目标实例】list_workspaces, 仅当存在 slug==="default" 的工作区时用其 id 兜底;
        //   否则明确报错 (宁可报错也不猜 —— 猜错会把会话静默建到错误工作区, 比报错更危险).
        //   禁止任何 fallback 回调用方 slug (会复活原 bug).
        let resolved = null;
        try {
          const lw = await remoteHttpPost(port, "list_workspaces", {}, host);
          const ws = Array.isArray(lw) ? lw : (Array.isArray(lw && lw.workspaces) ? lw.workspaces : []);
          const def = ws.find(w => w && w.slug === 'default');
          if (def && def.id) {
            resolved = def.id;
            log("[remote_create_session] workspace_id auto-resolved to target instance default workspace: " + def.id);
          }
        } catch (e) {
          log("[remote_create_session] list_workspaces on target instance failed: " + (e && e.message ? e.message : String(e)));
        }
        if (resolved) {
          payload.workspace_id = resolved;
        } else {
          return jsonResult({ ok: false, error: { code: 'E_WORKSPACE_REQUIRED', msg: 'remote_create_session: workspace_id could not be auto-resolved on target instance (no "default" workspace found, or list_workspaces failed). Pass workspace_id explicitly.', help_hint: 'Call mcp__remote-session__remote_list_workspaces with the same instance to list valid workspace ids.' } });
        }
      }
      return jsonResult(await remoteHttpPost(port, "create_session", payload, host));
    },
    remote_fork_session: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "fork_session", {
        source_session_id: args.source_session_id,
        up_to_message_uuid: args.up_to_message_uuid,
        title: args.title,
        new_channel_id: args.new_channel_id,
        new_model_id: args.new_model_id,
        new_workspace_id: args.new_workspace_id,
      }, host));
    },
    remote_send_message: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "send_message", {
        session_id: args.session_id,
        message: args.message,
        wait: args.wait !== false,
        model_id: args.model_id,
        channel_id: args.channel_id,
      }, host));
    },
    remote_archive_session: async (args) => {
      const {host, port} = await resolve(args);
      return jsonResult(await remoteHttpPost(port, "archive_session", args, host));
    },
    remote_get_my_session_id: async (args) => {
      return jsonResult({
        session_id: null,
        is_remote: true,
        instance: args.instance,
        hint: "This is a remote instance call. session_id is always null for remote operations.",
      });
    },
    remote_discover_instances: async (args) => {
      return jsonResult(await discoverInstances(args));
    },
  };
}

function createRemoteSessionMcpServer(sdk, z) {
  const h = createRemoteToolHandlers();
  const server = sdk.createSdkMcpServer({
    name: "remote-session",
    version: "1.0.0",
    tools: [
      sdk.tool("remote_list_channels", "List all channels on a REMOTE Proma instance. Use this FIRST before creating a remote session.", { instance: z.string().describe("Instance name (e.g. 'dev', 'release')") }, h.remote_list_channels, { annotations: { readOnlyHint: true } }),
      sdk.tool("remote_list_workspaces", "List all workspaces on a REMOTE Proma instance.", { instance: z.string().describe("Instance name (e.g. 'dev', 'release')") }, h.remote_list_workspaces, { annotations: { readOnlyHint: true } }),
      sdk.tool("remote_list_sessions", "List sessions on a REMOTE Proma instance.", { instance: z.string().describe("Instance name"), include_archived: z.boolean().optional(), workspace_id: z.string().optional(), limit: z.number().min(1).max(200).optional() }, h.remote_list_sessions, { annotations: { readOnlyHint: true } }),
      sdk.tool("remote_get_session_info", "Get session info from a REMOTE Proma instance.", { instance: z.string().describe("Instance name"), session_id: z.string().describe("Session ID on the remote instance") }, h.remote_get_session_info, { annotations: { readOnlyHint: true } }),
      sdk.tool("remote_get_session_context", "Get token usage from a session on a REMOTE Proma instance.", { instance: z.string().describe("Instance name"), session_id: z.string() }, h.remote_get_session_context, { annotations: { readOnlyHint: true } }),
      sdk.tool("remote_list_messages", "List messages from a session on a REMOTE Proma instance.", { instance: z.string().describe("Instance name"), session_id: z.string(), limit: z.number().min(1).max(200).optional(), offset: z.number().min(0).optional() }, h.remote_list_messages, { annotations: { readOnlyHint: true } }),
      sdk.tool("remote_create_session", "Create a new session on a REMOTE Proma instance.", { instance: z.string().describe("Instance name (e.g. 'dev', 'release')"), channel_id: z.string().describe("Channel ID on the remote instance"), model_id: z.string().optional(), title: z.string().optional(), workspace_id: z.string().optional() }, h.remote_create_session),
      sdk.tool("remote_fork_session", "Fork a session on a REMOTE Proma instance.", { instance: z.string().describe("Instance name"), source_session_id: z.string(), up_to_message_uuid: z.string().optional(), title: z.string().optional(), new_channel_id: z.string().optional(), new_model_id: z.string().optional(), new_workspace_id: z.string().optional() }, h.remote_fork_session),
      sdk.tool("remote_send_message", "Send a message to a session on a REMOTE Proma instance.", { instance: z.string().describe("Instance name"), session_id: z.string(), message: z.string(), wait: z.boolean().optional(), model_id: z.string().optional(), channel_id: z.string().optional() }, h.remote_send_message),
      sdk.tool("remote_archive_session", "Archive/unarchive a session on a REMOTE Proma instance.", { instance: z.string().describe("Instance name"), session_id: z.string(), archived: z.boolean().optional() }, h.remote_archive_session),
      sdk.tool("remote_get_my_session_id", "Get instance info for a REMOTE Proma instance. Always returns null session_id since you are not in that instance.", { instance: z.string().describe("Instance name") }, h.remote_get_my_session_id, { annotations: { readOnlyHint: true } }),
      sdk.tool("remote_discover_instances", "Scan and discover Proma instances on localhost and LAN. Returns cached results unless refresh=true.", { refresh: z.boolean().optional().describe("Force re-scan (default false, uses 60s cache)"), hosts: z.array(z.string()).optional().describe("LAN host IPs to probe, e.g. ['192.168.1.100', '192.168.1.101']") }, h.remote_discover_instances, { annotations: { readOnlyHint: true } }),
    ],
  });
  return server;
}

// ---- 内部 MCP Server（Agent 内部使用）----
function createSessionMcpServer(sdk, z, sourceSessionId) {
  const h = createToolHandlers(sourceSessionId);

  const server = sdk.createSdkMcpServer({
    name: "session",
    version: "1.0.0",
    tools: [

      sdk.tool(
        "get_my_session_id",
        "Get YOUR CURRENT session ID. Use this whenever you need to reference yourself — checking your own context usage, listing your own messages, or passing your ID to other sessions for async callbacks.",
        {},
        h.get_my_session_id,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "list_channels",
        "List all configured AI channels and their available agent models. Use this FIRST before creating a session to find valid channel_id and model_id values.",
        {},
        h.list_channels,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "list_workspaces",
        "List all agent workspaces. Use this to find workspace IDs for create_session / fork_session / list_sessions filtering.",
        {},
        h.list_workspaces,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "list_sessions",
        "List all agent sessions with their metadata (title, channel, model, workspace name/ID, archived status).",
        {
          include_archived: z.boolean().optional().describe("Include archived sessions (default: false)"),
          workspace_id: z.string().optional().describe("Filter by workspace ID (from list_workspaces). Omit to see all workspaces."),
          limit: z.number().min(1).max(200).optional().describe("Max results to return (default: 50)"),
        },
        h.list_sessions,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "get_session_info",
        "Get detailed information about a specific agent session, including its channel name, provider, and workspace.",
        { session_id: z.string().describe("The session ID to look up") },
        h.get_session_info,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "get_session_context",
        "Get the CURRENT context/token usage of an agent session. Returns input tokens, output tokens, total tokens, and context window size from the latest message.",
        { session_id: z.string().describe("The session ID to check context usage for.") },
        h.get_session_context,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "list_messages",
        "List messages (conversation history) for an agent session. Each message includes its UUID (use with fork_session), role, timestamp, and text content. Use this to inspect what a session has done and find the right message UUID to fork at.",
        {
          session_id: z.string().describe("The session ID to list messages for."),
          limit: z.number().min(1).max(200).optional().describe("Max messages to return (default: 50)"),
          offset: z.number().min(0).optional().describe("Skip first N messages for pagination (default: 0)"),
        },
        h.list_messages,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "create_session",
        "Create a NEW agent session with specified channel and model. The session will appear in the Proma sidebar after manual refresh. Use list_channels first to get valid channel/model IDs.",
        {
          channel_id: z.string().describe("Channel ID (from list_channels). Determines which AI provider/API to use."),
          model_id: z.string().optional().describe("Model ID within the channel. If omitted, the first enabled agent model is used."),
          title: z.string().optional().describe("Session display title. Auto-generated if omitted."),
          workspace_id: z.string().optional().describe("Workspace ID to associate. Uses current workspace if omitted."),
        },
        h.create_session
      ),

      sdk.tool(
        "fork_session",
        "FORK (clone) an existing agent session, preserving all conversation context up to the specified point. The forked session retains the source's workspace files and message history. Use list_sessions first to find the source session ID.",
        {
          source_session_id: z.string().describe("ID of the source session to fork (from list_sessions)."),
          up_to_message_uuid: z.string().optional().describe("SDK message UUID to fork at (inclusive). Omit to fork at the latest message (full copy)."),
          title: z.string().optional().describe("Custom title for the forked session. Default: '<original title> (fork)'"),
          new_channel_id: z.string().optional().describe("Override: use a different channel for the forked session."),
          new_model_id: z.string().optional().describe("Override: use a different model for the forked session."),
          new_workspace_id: z.string().optional().describe("Override: use a different workspace for the forked session."),
        },
        h.fork_session
      ),

      sdk.tool(
        "send_message",
        "Send a user message to an EXISTING agent session for autonomous processing. Three modes:\n- wait=true (default): blocks until target completes, returns result with \"reply\" field containing the assistant's final response text.\n- notify=true: fire-and-forget, but when target finishes, pushes a notification message back to the calling session (async callback). Not supported from external MCP.\n- neither: pure fire-and-forget, no notification.",
        {
          session_id: z.string().describe("Target session ID to send the message to."),
          message: z.string().describe("The user message / task to send to the session."),
          wait: z.boolean().optional().describe("Wait for target to complete before returning (default: true)."),
          notify: z.boolean().optional().describe("When target completes, push a notification back to the calling session (async callback). Only meaningful when wait=false."),
          model_id: z.string().optional().describe("Model ID override."),
          channel_id: z.string().optional().describe("Channel ID override."),
        },
        h.send_message
      ),

      sdk.tool(
        "archive_session",
        "Archive (or unarchive) an agent session. Archived sessions are hidden from default list_sessions. Use include_archived=true to see them.",
        {
          session_id: z.string().describe("The session ID to archive/unarchive."),
          archived: z.boolean().optional().describe("Set to false to unarchive. Default: true (archive)."),
        },
        h.archive_session
      ),

      sdk.tool(
        "discover_instances",
        "Scan and discover Proma instances on localhost and LAN. Returns cached results (60s TTL) unless refresh=true. Use hosts parameter to probe specific LAN IPs.",
        {
          refresh: z.boolean().optional().describe("Force re-scan instead of using cache (default: false)"),
          hosts: z.array(z.string()).optional().describe("LAN host IPs to probe, e.g. ['192.168.1.100']. Each is scanned on ports 19876-19895."),
        },
        h.discover_instances,
        { annotations: { readOnlyHint: true } }
      ),

    ],
  });

  return server;
}

// ---- 外部 MCP HTTP Bridge（让外部 stdio MCP server 能调用 7 个工具）----
function createExternalHttpBridge() {
  const http = require("node:http");
  const instanceName = process.env.PROMA_INSTANCE_NAME || (process.env.PROMA_DEV === "1" ? "dev" : "release");
  const handlers = createToolHandlers(null); // 外部调用无源会话

  const PORT_START = 19876;
  const PORT_END = 19895;

  function startServer(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        // CORS for local dev
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          return res.end();
        }

        // GET /get_instance_info — 用于 MCP 客户端自动发现实例身份
        const urlPath = (req.url || "/").slice(1).split("?")[0];
        if (req.method === "GET" && urlPath === "get_instance_info") {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            instance: instanceName,
            proma_dev: process.env.PROMA_DEV === "1",  // deprecated，保留向后兼容
            port: port,
          }));
        }

        const toolName = urlPath;
        const handler = handlers[toolName];

        if (!handler) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: `Unknown tool: ${toolName}` }));
        }

        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Method not allowed. Use POST." }));
        }

        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", async () => {
          try {
            const body = Buffer.concat(chunks).toString("utf-8");
            let args = {};
            try { args = JSON.parse(body || "{}"); } catch (_) { /* keep {} */ }
            const result = await handler(args);
            // ISS-004: 客户端可能在 handler await 期间断开, writeHead/end 对已关 socket 写 → 同步抛 EPIPE
            //   (socket.on('error') 拦不住同步 throw, 是 uncaughtException 残留路径). 包 try/catch 兜底.
            try {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } catch (_) {}
          } catch (e) {
            try {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
            } catch (_) {}
          }
        });
      });

      server.on("error", (e) => {
        if (e.code === "EADDRINUSE") return reject(e);
        log(`HTTP bridge error: ${e.message}`);
      });

      // ISS-004 fix: 连接级 socket error handler.
      //   当 MCP 客户端 (proma-mcp-server.cjs req.destroy()) 在 server 端 async handler 仍在 await
      //   (send_message 最长 600s) 时提前断开, server 写响应触发 EPIPE/ECONNRESET. 无 socket 级 handler
      //   时冒到 process uncaughtException → Electron 主进程弹窗. 这里吞连接级错误 (仅记日志不抛),
      //   server 级 error 仍走上面的 server.on("error"). socket 由 Node 自动 destroy/close, 无 fd 泄漏.
      server.on("connection", (socket) => {
        socket.on("error", (err) => {
          try { log(`[bridge-socket] ${err && err.code ? err.code : ''} ${err && err.message ? err.message : ''}`); } catch (_) {}
        });
      });

      const bindHost = process.env.PROMA_BRIDGE_HOST || "127.0.0.1";
      server.listen(port, bindHost, () => resolve(server));
    });
  }

  (async () => {
    for (let p = PORT_START; p <= PORT_END; p++) {
      try {
        const server = await startServer(p);
        const bindHost = process.env.PROMA_BRIDGE_HOST || "127.0.0.1";
        log(`External MCP HTTP bridge: http://${bindHost}:${p} (instance: ${instanceName})`);
        return;
      } catch (e) {
        if (e.code === "EADDRINUSE") continue;
        log(`HTTP bridge start error: ${e.message}`);
        return;
      }
    }
    log(`ERROR: No free port in range ${PORT_START}-${PORT_END}`);
  })();
}

// ============================================================
// 补丁 v0.7+: Tree 体系 MCP Server（mcp__tree__* — 27 工具直接调内联引擎）
// 引擎 tree-engine.cjs（同目录，从 tree-state.js 改造）导出 run(cmd,args)→{ok,error?,...result}。
// TREES_ROOT 由 callTreeState 按 workspace 注入（treeEngine.setTreesRoot），不再依赖 __dirname。
// 工作区无需 tree-state.js 源码 —— 引擎代码内联在 dist/，agent 看不到。
// ============================================================
(function registerTreeMcpServer() {
  // v0.7+: 引擎内联 —— 直接 require tree-engine.cjs（同目录），调 engine.run。
  // 不再 spawn node tree-state.js：工作区无需 tree-state.js 源码，agent 看不到引擎代码。
  const treeEngine = require("./tree-engine.cjs");

  // L2-root-cause (层2 身份校验根治，方案A): 注入 session 真实性 verifier。
  //   调 global.__proma__.getAgentSessionMeta 判断 session 是否真实存在（根因A根治：堵任意合规格式 UUID 注册）。
  //   __proma__ 未就绪 → null（bypass，同 Patch M 哲学，best-effort 不阻断）；
  //   session 真实存在 → true；不存在 → false（engine 据此 throw E_SESSION_NOT_ALIVE）。
  //   verifier 是无状态函数，require 后注入一次即可（与 callerSessionId 透传互补；详见设计文档 §三方案A）。
  treeEngine.setSessionVerifier((sid) => {
    if (!sid) return false;
    try {
      const a = global.__proma__;
      if (!a || typeof a.getAgentSessionMeta !== 'function') return null; // __proma__ 未就绪 → bypass
      const meta = a.getAgentSessionMeta(sid);
      return !!meta;                                    // session 真实存在 = true
    } catch (_) { return null; }                        // 异常不阻断（bypass）
  });

  // workspace → trees_dir 定位（复制 registerTreePanelIpc 内 discoverAllWorkspacesWithTrees 的核心；
  // 后者是 IIFE 局部函数，本模块级 createTreeMcpServer 无法访问，故独立实现一份）
  // V10-workspace-canonical: slug "undefined"/null/"" → fallback "default"（堵 JSON.stringify(undefined)→"undefined" 字符串）
  //   失守案例 532465c5：调用方传 workspace_id=undefined，被序列化成 "undefined" 字符串当 slug 用，
  //   findTreesDirForWorkspace 直接返回 null，引擎层完全不知道是 fallback 失败。
  function findTreesDirForWorkspace(workspaceSlug) {
    // V10-workspace-canonical: fallback —— 空值或字符串 "undefined" 都视为缺失，尝试 "default"。
    if (!workspaceSlug || workspaceSlug === 'undefined' || workspaceSlug === 'null') {
      workspaceSlug = 'default';
    }
    const os = require("os");
    const home = os.homedir();
    const isIsolated = process.env.PROMA_INSTANCE_ISOLATED === "1" || process.env.PROMA_INSTANCE_NAME === "dev";
    const base = isIsolated
      ? path.join(home, ".proma-dev", "agent-workspaces")
      : path.join(home, ".proma", "agent-workspaces");
    const wsRoot = path.join(base, workspaceSlug);
    try { if (!fs.existsSync(wsRoot) || !fs.statSync(wsRoot).isDirectory()) return null; } catch (_) { return null; }
    const candidates = [
      path.join(wsRoot, "workspace-files", ".context", "trees"),
      path.join(wsRoot, ".context", "trees"),
    ];
    for (const dir of candidates) {
      try {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
          return { trees_dir: dir, workspace_root: wsRoot };
        }
      } catch (_) {}
    }
    return null;
  }

  // 调内联引擎 engine.run(cmd, args)。返回 {ok,error?,...result}，与原 CLI stdout 一致。
  // 每次 call 前按 workspace 重设 TREES_ROOT（engine 模块级可变状态；Electron 主进程 JS 单线程，
  // MCP 调用串行，无竞态；dbc-spec 等独立进程各设各的）。
  // V10-self-audit-forbidden-v2: 新增 callerSessionId 透传到 engine.run（cmdAuditGate 校验 caller==audit_session_id）。
  async function callTreeState(workspaceSlug, args, callerSessionId) {
    const ws = findTreesDirForWorkspace(workspaceSlug);
    if (!ws) return { ok: false, error: { code: "E_NO_TREES_DIR", msg: `workspace "${workspaceSlug}" has no .context/trees/. Looked under ~/.proma[-dev]/agent-workspaces/${workspaceSlug}/{,workspace-files/}.context/trees/. Deploy tree-system to this workspace first.` } };
    const [cmd, ...rest] = Array.isArray(args) ? args : [];
    if (!cmd) return { ok: false, error: { code: "E_SCHEMA_INVALID", msg: "no tree command given" } };
    // per-call treesRoot: 显式安全，不依赖模块级共享 TREES_ROOT（多 workspace 并发场景防覆盖）
    return await treeEngine.run(cmd, rest, ws.trees_dir, callerSessionId);
  }

  global.__proma_createTreeMcpServer__ = function (sdk, z, workspaceSlug, callerSessionId) {
    const RO = { annotations: { readOnlyHint: true } };
    // V10-self-audit-forbidden-v2: callerSessionId 由 __proma_getMcpServers__(sessionId,...) 注入，
    //   透传到 callTreeState → engine.run → cmdAuditGate（校验 caller==audit_session_id，堵借身份）。
    //   失守案例：worker 528b0925 借 auditor 404c724f 的 session_id 调 audit_gate pass。
    const tt = (name, desc, schema, argBuilder, readOnly) => sdk.tool(
      name, desc, schema,
      async (args) => jsonResult(await callTreeState(workspaceSlug, argBuilder(args), callerSessionId)),
      readOnly ? RO : undefined
    );
    const J = JSON.stringify;
    return sdk.createSdkMcpServer({
      name: "tree",
      version: "0.7.0",
      tools: [
        // ---- V10-helper (D4 Layer 1): 自助文档元工具 ----
        // 任何 mcp__tree__* 调用前如果不确定用法，先 tree_help 拿 topic。
        // 13 个 topic 覆盖：建树 / auditor 注册 / V10 加固 / 错误码 / 常见错误 / 完整指南。
        // 错误返回也会自动附 help_topic 引用（run() catch 块）。
        tt("tree_help", "Get help on a tree-system topic. 13 topics available: how_to_init | how_to_register_auditor | role_semantics | v10_constraints | self_audit_forbidden | borrowed_identity | naming_convention | common_mistakes | alignment_workflow | nudge_escalation | audit_tree_structure | error_code_index | full_guide. Call this BEFORE guessing how a tool works. Also: when other mcp__tree__* tools return errors with help_topic, follow the help_hint and call this with that topic.", { topic: z.string() }, (a) => ["help", a.topic], true),
        // ---- Maintain ----
        tt("tree_init", "Initialize a new tree (creates tree dir + root leaf). Returns tips.next_steps — follow them to register auditor and avoid common mistakes.", { tree_id: z.string(), root_brief: z.record(z.any()), root_dod: z.record(z.any()), session_id: z.string().optional(), model: z.string().optional(), channel: z.string().optional(), audit_meta: z.record(z.any()).optional() }, (a) => ["init", a.tree_id, "--root-brief", J(a.root_brief), "--root-dod", J(a.root_dod), ...(a.session_id ? ["--session-id", a.session_id] : []), ...(a.model ? ["--model", a.model] : []), ...(a.channel ? ["--channel", a.channel] : []), ...(a.audit_meta ? ["--audit-meta", J(a.audit_meta)] : [])]),
        tt("tree_validate", "Run all tree invariants (parent links, session_id uniqueness, path, done-worker independent audit_gate, context overflow). Returns {ok, issues}.", { tree_id: z.string() }, (a) => ["validate", a.tree_id], true),
        tt("tree_backup", "Create a timestamped backup of tree-state.json.", { tree_id: z.string(), label: z.string().optional() }, (a) => ["backup", a.tree_id, ...(a.label ? ["--label", a.label] : [])]),
        tt("tree_restore", "Restore tree-state.json from a backup file (basename in tree dir, or absolute path). Refuses non-compliant backups (v0.7 V1).", { tree_id: z.string(), backup_file: z.string() }, (a) => ["restore", a.tree_id, a.backup_file]),
        tt("tree_migrate", "Run schema migration for a tree.", { tree_id: z.string(), dry_run: z.boolean().optional() }, (a) => ["migrate", a.tree_id, ...(a.dry_run ? ["--dry-run"] : [])]),
        // ---- Add ----
        tt("tree_leaf_add", "Add a leaf node. worker leaves can't have children; commander nesting depth <=3 enforced.", { tree_id: z.string(), leaf: z.record(z.any()).describe('Full leaf json: {leaf_id,session_id,parent,path,role,model,channel,added_by}') }, (a) => ["leaf", "add", a.tree_id, "--json", J(a.leaf)]),
        tt("tree_milestone_add", "Add a milestone to a leaf (expect_outputs must be non-empty per v0.7 V3).", { tree_id: z.string(), leaf_id: z.string(), milestone: z.record(z.any()) }, (a) => ["milestone", "add", a.tree_id, a.leaf_id, "--json", J(a.milestone)]),
        // ---- Update ----
        tt("tree_leaf_set_status", "Set leaf status (active|done|pruned|archived|segment_pending|pending_brief). done/archived trigger DbC hard gates (v0.7 Phase A).", { tree_id: z.string(), leaf_id: z.string(), status: z.string() }, (a) => ["leaf", "set-status", a.tree_id, a.leaf_id, a.status]),
        tt("tree_leaf_set_context", "Update leaf context_usage_pct (0-100+).", { tree_id: z.string(), leaf_id: z.string(), context_pct: z.number() }, (a) => ["leaf", "set-context", a.tree_id, a.leaf_id, String(a.context_pct)]),
        tt("tree_leaf_set_last_event", "Update leaf last_event_type/ts.", { tree_id: z.string(), leaf_id: z.string(), event_type: z.string(), ts: z.string().optional() }, (a) => ["leaf", "set-last-event", a.tree_id, a.leaf_id, a.event_type, ...(a.ts ? ["--ts", a.ts] : [])]),
        tt("tree_leaf_set_session", "Update leaf session_id (e.g. fix PENDING_ROOT root).", { tree_id: z.string(), leaf_id: z.string(), session_id: z.string() }, (a) => ["leaf", "set-session", a.tree_id, a.leaf_id, a.session_id]),
        tt("tree_milestone_set_result", "Set milestone audit result. V4 (v0.7 批次5): audit_pass=true requires independent --audit-session-id (real independent leaf session in tree).", { tree_id: z.string(), leaf_id: z.string(), milestone_id: z.string(), audit_pass: z.boolean(), audit_session_id: z.string().optional(), note_path: z.string().optional() }, (a) => ["milestone", "set-result", a.tree_id, a.leaf_id, a.milestone_id, "--audit-pass", String(a.audit_pass), ...(a.audit_session_id ? ["--audit-session-id", a.audit_session_id] : []), ...(a.note_path ? ["--note-path", a.note_path] : [])]),
        // ---- Append ----
        tt("tree_event_append", "Append an event (done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check). done requires self_check schema; brief_echo+alignment requires independent auditor (v0.7).", { tree_id: z.string(), leaf_id: z.string(), type: z.string(), meta: z.record(z.any()) }, (a) => ["event", "append", a.tree_id, a.leaf_id, "--type", a.type, "--json", J(a.meta)]),
        tt("tree_drift_append", "Append a drift (3-tier correction).", { tree_id: z.string(), leaf_id: z.string(), kind: z.string(), severity: z.string(), action: z.string(), fork_to: z.string().optional(), reason: z.string().optional() }, (a) => ["drift", "append", a.tree_id, a.leaf_id, "--kind", a.kind, "--severity", a.severity, "--action", a.action, ...(a.fork_to ? ["--fork-to", a.fork_to] : []), ...(a.reason ? ["--reason", a.reason] : [])]),
        tt("tree_heartbeat_append", "Append a heartbeat (sentinel agent patrol).", { tree_id: z.string(), heartbeat: z.record(z.any()) }, (a) => ["heartbeat", "append", a.tree_id, "--json", J(a.heartbeat)]),
        tt("tree_segment_append", "Append a segment (bamboo-joint handoff).", { tree_id: z.string(), leaf_id: z.string(), new_session_id: z.string() }, (a) => ["segment", "append", a.tree_id, a.leaf_id, a.new_session_id]),
        tt("tree_nudge_append", "Append a nudge (TAO Watcher).", { tree_id: z.string(), leaf_id: z.string(), rule_id: z.string(), severity: z.string().optional() }, (a) => ["nudge", "append", a.tree_id, a.leaf_id, "--rule-id", a.rule_id, ...(a.severity ? ["--severity", a.severity] : [])]),
        tt("tree_nudge_reset", "Reset leaf nudge_count + nudge_log.", { tree_id: z.string(), leaf_id: z.string() }, (a) => ["nudge", "reset", a.tree_id, a.leaf_id]),
        // ---- TAO ----
        tt("tree_audit_gate", "Set audit_gate verdict. pass/required requires independent auditor session (whitelist, v0.7 V2); pass requires a prior done event (v0.7 A7).", { tree_id: z.string(), leaf_id: z.string(), verdict: z.string(), audit_session_id: z.string().optional(), reason: z.string().optional() }, (a) => ["audit", "gate", a.tree_id, a.leaf_id, "--verdict", a.verdict, ...(a.audit_session_id ? ["--audit-session-id", a.audit_session_id] : []), ...(a.reason ? ["--reason", a.reason] : [])]),
        tt("tree_audit_append", "Append an audit report entry.", { tree_id: z.string(), leaf_id: z.string(), report: z.record(z.any()) }, (a) => ["audit", "append", a.tree_id, a.leaf_id, "--json", J(a.report)]),
        // ---- Query ----
        tt("tree_leaf_get", "Get a leaf by id.", { tree_id: z.string(), leaf_id: z.string() }, (a) => ["leaf", "get", a.tree_id, a.leaf_id], true),
        tt("tree_leaf_list_active", "List active (non-archived) leaves.", { tree_id: z.string() }, (a) => ["leaf", "list-active", a.tree_id], true),
        tt("tree_leaf_list_all", "List all leaves (including archived).", { tree_id: z.string() }, (a) => ["leaf", "list-all", a.tree_id], true),
        tt("tree_tree_dump", "Dump full tree state as JSON.", { tree_id: z.string() }, (a) => ["tree", "dump", a.tree_id], true),
        // Sprint 5 (聚类 A/E, 2026-07-14): session_registry 维护 — max_sessions 硬护栏（防 macp2 型会话爆炸）。
        tt("tree_register_session", "Register a bypass session_id (from create_session, not leaf_add) into the tree session_registry. Makes SDK-native create_session visible to the engine so the max_sessions guard + audit cover bypass sessions. Idempotent (dedup — already-registered sessions don't double-count). Throws E_MAX_SESSIONS if tree session count would exceed audit_meta.max_sessions.", { tree_id: z.string(), session_id: z.string(), source: z.string().optional(), caller: z.string().optional() }, (a) => ["tree", "register-session", a.tree_id, "--session-id", a.session_id, ...(a.source ? ["--source", a.source] : []), ...(a.caller ? ["--caller", a.caller] : [])]),
        tt("tree_session_count", "Get tree session count vs max_sessions (read-only budget precheck). Returns { count, max, reached }. reached=true means max_sessions hit — next session registration (leaf_add / register-session / set-session) will be rejected with E_MAX_SESSIONS.", { tree_id: z.string() }, (a) => ["tree", "session-count", a.tree_id], true),
        tt("tree_drift_list", "List drift entries.", { tree_id: z.string(), leaf_id: z.string().optional(), since: z.string().optional() }, (a) => ["drift", "list", a.tree_id, ...(a.leaf_id ? ["--leaf", a.leaf_id] : []), ...(a.since ? ["--since", a.since] : [])], true),
        tt("tree_heartbeat_tail", "Tail heartbeat log.", { tree_id: z.string(), leaf_id: z.string().optional(), n: z.number().optional() }, (a) => ["heartbeat", "tail", a.tree_id, ...(a.leaf_id ? ["--leaf", a.leaf_id] : []), ...(a.n ? ["-n", String(a.n)] : [])], true),
        tt("tree_event_list", "List events.", { tree_id: z.string(), leaf_id: z.string().optional(), type: z.string().optional() }, (a) => ["event", "list", a.tree_id, ...(a.leaf_id ? ["--leaf", a.leaf_id] : []), ...(a.type ? ["--type", a.type] : [])], true),
      ],
    });
  };

  log("[Patch v0.7+] Tree MCP server factory registered (mcp__tree__* — 28 tools: 27 wrapping tree-state.js + 1 tree_help meta-tool [V10-helper D4])");
})();


// ---- 注册全局钩子（内部 Agent MCP server）----
global.__proma_getMcpServers__ = function (sessionId, workspaceSlug, sdk) {
  try {
    let z;
    try { z = require("zod").z || require("zod"); } catch(_) { z = null; }
    if (!z) return undefined;
    const server = createSessionMcpServer(sdk, z, sessionId);
    const remoteServer = createRemoteSessionMcpServer(sdk, z);
    let treeServer;
    // V10-self-audit-forbidden-v2: 把 sessionId 透传给 tree MCP factory，
    //   最终传到 engine.cmdAuditGate 校验 caller==audit_session_id（堵借身份）。
    try { treeServer = global.__proma_createTreeMcpServer__(sdk, z, workspaceSlug, sessionId); }
    catch (e) { log("ERROR creating tree MCP server: " + (e && e.message ? e.message : String(e))); treeServer = undefined; }
    return Object.assign({ session: server, "remote-session": remoteServer }, treeServer ? { tree: treeServer } : {});
  } catch (err) {
    log(`ERROR creating MCP server: ${err instanceof Error ? err.message : String(err)}`);
    console.error(err);
    return undefined;
  }
};

// ---- 启动外部 MCP HTTP bridge ----
createExternalHttpBridge();

log("Agent session management MCP tools loaded (12 tools: get_my_session_id, list_channels, list_workspaces, list_sessions, get_session_info, get_session_context, list_messages, create_session, fork_session, send_message, archive_session, discover_instances) + 12 remote-session tools");

// ============================================================
// 补丁 L (v0.17): 树形 UI 面板 IPC handlers
// 提供 proma:get-tree-states（扫描 trees 目录）+ proma:navigate-to-session
// 不修改 main.cjs，通过 electron.ipcMain 在 patches.cjs 加载时注册
// ============================================================

(function registerTreePanelIpc() {
  let electron;
  try { electron = require("electron"); } catch (_) { electron = null; }
  if (!electron || !electron.ipcMain) {
    log("[Patch L] electron.ipcMain not available, skip tree panel IPC registration");
    return;
  }
  const ipcMain = electron.ipcMain;

  // workspace 发现 — 跟 WatcherManager 保持一致, 只扫当前实例对应目录
  // ISOLATED 实例 (dev) → ~/.proma-dev/agent-workspaces/
  // 非 ISOLATED 实例 (release/release-fresh) → ~/.proma/agent-workspaces/
  // 重要: 即使 workspace 没有 trees 目录也要返回 (UI 显示完整 workspace 列表)
  function discoverAllWorkspacesWithTrees() {
    const os = require("os");
    const home = os.homedir();
    const isIsolated = process.env.PROMA_INSTANCE_ISOLATED === "1" || process.env.PROMA_INSTANCE_NAME === "dev";
    const bases = isIsolated
      ? [path.join(home, ".proma-dev", "agent-workspaces")]
      : [path.join(home, ".proma", "agent-workspaces")];
    const found = [];
    for (const base of bases) {
      if (!fs.existsSync(base)) continue;
      let entries = [];
      try { entries = fs.readdirSync(base); } catch (_) {}
      for (const name of entries) {
        const wsRoot = path.join(base, name);
        let st;
        try { st = fs.statSync(wsRoot); } catch (_) { continue; }
        if (!st.isDirectory()) continue;
        const treesCandidates = [
          { dir: path.join(wsRoot, ".context", "trees"), kind: "direct" },
          { dir: path.join(wsRoot, "workspace-files", ".context", "trees"), kind: "workspace-files" }
        ];
        let matched = null;
        for (const tc of treesCandidates) {
          try {
            if (!fs.existsSync(tc.dir)) continue;
            const ts = fs.statSync(tc.dir);
            if (!ts.isDirectory()) continue;
            matched = tc;
            break;
          } catch (_) { continue; }
        }
        // 不管 trees 目录存不存在都 push (UI 需要显示完整 workspace 列表)
        // trees_dir 为 null 时, readTreesFromDir 会返回空数组 (readTreesFromDir 内部有 fs.existsSync 检查)
        found.push({
          workspace_slug: name,
          workspace_root: wsRoot,
          trees_dir: matched ? matched.dir : null,
          kind: matched ? matched.kind : "workspace-files",
          is_isolated: isIsolated
        });
      }
    }
    return found;
  }

  // 通过 Proma API 找当前激活 workspace slug
  // 启发式: listAgentSessions 中 updatedAt 最新的 session 的 workspaceId → getAgentWorkspace(slug)
  function findCurrentWorkspaceSlug() {
    try {
      const a = api();
      const sessions = a.listAgentSessions();
      if (!Array.isArray(sessions) || sessions.length === 0) return null;
      // 找最近活跃 session
      const sorted = sessions
        .filter(s => s.workspaceId)
        .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
      if (sorted.length === 0) return null;
      const ws = a.getAgentWorkspace(sorted[0].workspaceId);
      return ws && ws.slug ? ws.slug : null;
    } catch (_) {
      return null;
    }
  }

  // proma:get-tree-states — 按 workspace 分组返回 tree
  // 入参: { workspace_slug?: string, include_empty?: bool }
  //   workspace_slug 指定 → 只返回该 workspace 的 tree
  //   不指定 → 返回所有 workspace 的 tree, 按 workspace 分组
  ipcMain.handle("proma:get-tree-states", async (_event, arg) => {
    try {
      const requestedSlug = arg && arg.workspace_slug;
      const allWorkspaces = discoverAllWorkspacesWithTrees();
      if (allWorkspaces.length === 0) {
        return { ok: false, error: "no workspace with .context/trees/ found", workspaces: [], trees: [] };
      }

      function readTreesFromDir(treesDir, workspaceSlug) {
        const trees = [];
        let entries = [];
        try { entries = fs.readdirSync(treesDir); } catch (_) {}
        for (const name of entries) {
          if (name.endsWith(".js") || name.endsWith(".json") || name.endsWith(".md")) continue;
          const statePath = path.join(treesDir, name, "tree-state.json");
          if (!fs.existsSync(statePath)) continue;
          try {
            const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
            const leaves = {};
            let hasActiveLeaf = false;
            for (const [lid, leaf] of Object.entries(state.leaves || {})) {
              if (["active", "pending_brief", "segment_pending"].includes(leaf.status)) hasActiveLeaf = true;
              leaves[lid] = {
                leaf_id: leaf.leaf_id, session_id: leaf.session_id,
                parent: leaf.parent, path: leaf.path, role: leaf.role,
                model: leaf.model, channel: leaf.channel, status: leaf.status,
                created_at: leaf.created_at, added_by: leaf.added_by,
                last_event_ts: leaf.last_event_ts, last_event_type: leaf.last_event_type,
                context_usage_pct: leaf.context_usage_pct,
                milestones: Array.isArray(leaf.milestones) ? leaf.milestones.map(m => ({
                  id: m.id, status: m.status, audit_pass: m.audit_pass
                })) : [],
                events_count: Array.isArray(leaf.events) ? leaf.events.length : 0,
                audit_gate: leaf.audit_gate || null,
                nudge_count: leaf.nudge_count || 0,
                audit_log_count: Array.isArray(leaf.audit_log) ? leaf.audit_log.length : 0,
                nudge_log: Array.isArray(leaf.nudge_log) ? leaf.nudge_log.slice(-10).map(e => ({
                  ts: e.ts, rule_id: e.rule_id, severity: e.severity,
                  evidence: e.evidence, suggest: e.suggest,
                  nudge_count: e.nudge_count, send_message: e.send_message
                })) : [],
                audit_log: Array.isArray(leaf.audit_log) ? leaf.audit_log.slice(-10).map(e => ({
                  ts: e.ts, auditor: e.auditor, rule_id: e.rule_id,
                  pass: e.pass, evidence: e.evidence, degraded: e.degraded
                })) : []
              };
            }
            // 文件 stat 取 mtime
            let mtimeMs = 0;
            try { mtimeMs = fs.statSync(statePath).mtimeMs; } catch (_) {}
            // 计算 latest_activity_ts: 优先业务时间字段 max(last_heartbeat, leaves[].last_event_ts, created_at)
            // 修 race condition: mtime 是文件系统时间, watcher 跑过更新 tree-state.json 会让 mtime 变很新,
            // 把不活跃 tree 顶上来. 只在业务字段全空时退化用 mtime.
            // 用于 UI 第二层 tab 按最近活动时间倒排
            let latestTs = 0;
            try {
              if (state.last_heartbeat) {
                const t = new Date(state.last_heartbeat).getTime();
                if (!isNaN(t) && t > latestTs) latestTs = t;
              }
              if (state.created_at) {
                const t = new Date(state.created_at).getTime();
                if (!isNaN(t) && t > latestTs) latestTs = t;
              }
              for (const leaf of Object.values(state.leaves || {})) {
                if (leaf && leaf.last_event_ts) {
                  const t = new Date(leaf.last_event_ts).getTime();
                  if (!isNaN(t) && t > latestTs) latestTs = t;
                }
              }
            } catch (_) {}
            // 业务时间字段全空时退化用 mtime (新建 tree 还没产生业务事件)
            if (latestTs === 0) latestTs = mtimeMs;
            trees.push({
              tree_id: state.tree_id || name,
              workspace_slug: workspaceSlug,
              created_at: state.created_at,
              last_heartbeat: state.last_heartbeat,
              latest_activity_ts: latestTs,
              mtime_ms: mtimeMs,
              has_active_leaf: hasActiveLeaf,
              root_brief: state.root_brief,
              root_dod: state.root_dod,
              leaves,
              _meta: state._meta || {}
            });
          } catch (e) {
            trees.push({ tree_id: name, workspace_slug: workspaceSlug, error: "parse failed: " + e.message });
          }
        }
        return trees;
      }

      const workspaces = [];
      const allTrees = [];
      const currentSlug = requestedSlug || findCurrentWorkspaceSlug();
      // 从 Proma API 拿 slug → name 映射 (UI 第一层 tab 显示 name 而非 slug)
      const slugToName = {};
      try {
        const a = api();
        const allWs = a.listAgentWorkspaces();
        if (Array.isArray(allWs)) {
          for (const w of allWs) {
            if (w && w.slug && w.name) slugToName[w.slug] = w.name;
          }
        }
      } catch (_) {}
      for (const ws of allWorkspaces) {
        // 不指定 slug 时, 包含所有 workspace (即使没 tree 的也返回, 让 UI 显示完整列表)
        // 指定时只匹配的
        if (requestedSlug && ws.workspace_slug !== requestedSlug) continue;
        const trees = readTreesFromDir(ws.trees_dir, ws.workspace_slug);
        workspaces.push({
          workspace_slug: ws.workspace_slug,
          workspace_name: slugToName[ws.workspace_slug] || ws.workspace_slug,
          workspace_root: ws.workspace_root,
          trees_dir: ws.trees_dir,
          kind: ws.kind,
          is_isolated: ws.is_isolated,
          is_current: ws.workspace_slug === currentSlug,
          tree_count: trees.length,
          active_tree_count: trees.filter(t => t.has_active_leaf).length
        });        for (const t of trees) allTrees.push(t);
      }

      // 排序: 当前 workspace 在前, 然后按 tree 数量降序
      workspaces.sort((a, b) => {
        if (a.is_current !== b.is_current) return a.is_current ? -1 : 1;
        return b.tree_count - a.tree_count;
      });

      // 附加 session_title（人友好显示）：leaf.session_id → 会话名词
      const _sessionTitles = {};
      try {
        const _sessions = api().listAgentSessions();
        if (Array.isArray(_sessions)) {
          for (const _s of _sessions) {
            if (_s && _s.id && _s.title) _sessionTitles[_s.id] = _s.title;
          }
        }
      } catch (_) {}
      for (const _tree of allTrees) {
        if (_tree && _tree.leaves) {
          for (const _leaf of Object.values(_tree.leaves)) {
            if (_leaf && _leaf.session_id) {
              _leaf.session_title = _sessionTitles[_leaf.session_id] || null;
            }
          }
        }
        // tree.title: 会话名词优先（root leaf 的 session_title）, fallback root_brief.my_mission, 再 fallback tree_id
        let _treeTitle = _tree && _tree.tree_id;
        try {
          if (_tree && _tree.root_brief && _tree.root_brief.my_mission) _treeTitle = _tree.root_brief.my_mission;
          if (_tree && _tree.leaves) {
            const _rootLeaf = Object.values(_tree.leaves).find(function (l) { return l && (l.parent === null || l.parent === undefined); });
            if (_rootLeaf && _rootLeaf.session_title) _treeTitle = _rootLeaf.session_title;
          }
        } catch (_) {}
        if (_tree) _tree.title = _treeTitle;
      }

      return {
        ok: true,
        current_workspace_slug: currentSlug,
        workspaces,
        trees: allTrees
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e), workspaces: [], trees: [] };
    }
  });

  // proma:list-workspaces — 列出所有有 tree 的 workspace (轻量, 不读 tree-state)
  ipcMain.handle("proma:list-workspaces", async () => {
    const all = discoverAllWorkspacesWithTrees();
    const currentSlug = findCurrentWorkspaceSlug();
    return {
      ok: true,
      current_workspace_slug: currentSlug,
      workspaces: all.map(ws => ({
        workspace_slug: ws.workspace_slug,
        workspace_root: ws.workspace_root,
        is_isolated: ws.is_isolated,
        kind: ws.kind,
        is_current: ws.workspace_slug === currentSlug
      }))
    };
  });

  // proma:navigate-to-session — 通过 Proma 内置 tray:open-agent-session IPC 切换会话
  // 补丁 M+ v0.2: 不再用 proma:navigate-to-session 广播（renderer 没监听）
  // 改为复用 Proma 内置的 tray:open-agent-session 事件链
  // renderer 已监听这个事件并自动 setActiveTabId + updateSettings
  // ISS-002 fix (同名会话切换失效):
  //   审计反转: renderer 全程纯 sessionId 匹配, 无 title 歧义 (补 title 无效是预期的).
  //   真因大概率是 renderer listAgentSessions 与目标 session 不一致 (atom 未 flush/命中 miss) 或
  //   session 已失效. 旧"executeJavaScript click 兜底"无可靠选择器 (sidebar item 无 data-session-id),
  //   增量价值=0 且 DOM 耦合风险高, 已弃用.
  //   新方案 (备选A + 诊断): ①预热 renderer listAgentSessions 刷新 atom ②发主 IPC ③结构化诊断日志
  //   ④navigate-failed 让 tree 面板消费 (会话失效时 UI 提示, 见 proma-tree-view 注入段).
  ipcMain.on("proma:navigate-to-session", async (event, sessionId) => {
    try {
      const bw = electron.BrowserWindow && electron.BrowserWindow.fromWebContents(event.sender);
      if (!bw) return;
      // ① 预热: 让 renderer 的 listAgentSessions 先跑一次, 刷新 atom 与磁盘一致 (治 list miss 真因).
      //    失败不阻断 (旧版 preload 可能未暴露 listAgentSessions).
      try {
        await bw.webContents.executeJavaScript(
          "(window.electronAPI && window.electronAPI.listAgentSessions) ? window.electronAPI.listAgentSessions().then(function(s){window.__promaNavList=(s&&s.length)||0;}).catch(function(){}) : Promise.resolve()",
          true
        );
      } catch (_) {}
      // ② 验证 session 存在 + 拿 title
      let _navMeta = null;
      let _metaHit = false;
      try {
        const a = api();
        _navMeta = a.getAgentSessionMeta(sessionId);
        _metaHit = !!_navMeta;
      } catch (_) {}
      // 诊断: 记录命中情况, 便于定位真因 (V4 未运行时确认)
      log("[Patch L][nav-diag] sid=" + sessionId + " metaHit=" + _metaHit +
         " ws=" + (_navMeta && _navMeta.workspaceId ? _navMeta.workspaceId : 'null'));
      if (!_navMeta) {
        // ③ session 失效: 发 navigate-failed + 轻量 toast 提示 (V3, 不依赖 proma-tree-view.js 改动).
        //   proma:navigate-failed 供 tree 面板消费 (若已监听); toast 兜底让用户看到反馈, 非静默不动.
        bw.webContents.send("proma:navigate-failed", { sessionId, reason: "not-found" });
        try {
          const _shortSid = String(sessionId).slice(0, 8);
          bw.webContents.executeJavaScript(
            "(function(){try{var d=document.createElement('div');d.textContent='\\u4f1a\\u8bdd " + _shortSid + " \\u5df2\\u5931\\u6548\\u6216\\u4e0d\\u5b58\\u5728 (navigate-failed)';" +
            "d.setAttribute('style','position:fixed;top:16px;right:16px;z-index:99999;background:#c0392b;color:#fff;padding:10px 14px;border-radius:6px;font-size:13px;font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)');" +
            "document.body.appendChild(d);setTimeout(function(){try{d.remove();}catch(_){}},3500);}catch(e){}})()",
            true
          ).catch(function(){});
        } catch (_) {}
        log("[Patch L][nav-diag] session not found, sent navigate-failed + toast sid=" + sessionId);
        return;
      }
      // ④ 真正切换: 复用 Proma tray:open-agent-session 事件链 (纯 sessionId, renderer R.id===sessionId)
      bw.webContents.send("tray:open-agent-session", { sessionId, title: _navMeta.title });
      log("[Patch L][nav-diag] sent tray:open-agent-session sid=" + sessionId);
    } catch (e) {
      log("[Patch L] navigate-to-session error: " + (e && e.message));
    }
  });

  // proma:tree-view-ready — renderer 加载完成后请求初始数据
  ipcMain.handle("proma:tree-view-ready", async () => {
    return { ok: true, ts: Date.now() };
  });

  // proma:dom-dump — 调试用, 把 renderer DOM 结构写到文件
  // 用于诊断入口按钮注入位置. 文件名按 window 区分, 避免子窗口覆盖主窗口
  ipcMain.handle("proma:dom-dump", async (_event, arg) => {
    try {
      const os = require("os");
      const windowName = (arg && arg.windowName) || "main";
      const safeName = String(windowName).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      const dumpPath = path.join(
        os.homedir(),
        ".proma", "agent-workspaces", "proma", "workspace-files",
        "tao-engine", "dom-dump-" + safeName + ".txt"
      );
      fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
      const lines = [];
      lines.push("=== Proma DOM Dump (window=" + windowName + ") ===");
      lines.push("Time: " + new Date().toISOString());
      lines.push("URL: " + (arg && arg.url));
      lines.push("");
      const dumps = (arg && arg.dumps) || {};
      for (const [sel, info] of Object.entries(dumps)) {
        // __all_classes__ 是特殊字段: class 名数组
        if (sel === "__all_classes__") {
          lines.push("--- ALL CLASS NAMES in body (deduped) ---");
          if (Array.isArray(info)) {
            lines.push("  total: " + info.length);
            lines.push("  classes:");
            info.forEach(c => lines.push("    ." + c));
          }
          lines.push("");
          continue;
        }
        // __debug_labels__ 是特殊字段: 屏幕上红色数字标签对应的 DOM 信息
        if (sel === "__debug_labels__") {
          lines.push("--- DEBUG LABELS (red numbers on screen) ---");
          if (Array.isArray(info)) {
            info.forEach(item => {
              lines.push("  #" + item.n + " [" + item.where + "] <" + item.tag + ">");
              lines.push("    class: " + item.class);
              if (item.text) lines.push("    text: " + item.text);
              if (item.parent_class) lines.push("    parent_class: " + item.parent_class);
              if (item.rect) lines.push("    rect: x=" + item.rect.x + " y=" + item.rect.y + " w=" + item.rect.w + " h=" + item.rect.h);
            });
          }
          lines.push("");
          continue;
        }
        // __text_search__ 是特殊字段: 含特定关键词的元素
        if (sel === "__text_search__") {
          lines.push("--- TEXT SEARCH matches ---");
          if (Array.isArray(info)) {
            info.forEach((item, idx) => {
              lines.push("  [" + idx + "] <" + item.tag + "> keyword='" + item.keyword + "'");
              lines.push("    text: " + item.text);
              lines.push("    class: " + item.class);
              if (item.parent_class) lines.push("    parent_class: " + item.parent_class);
            });
          }
          lines.push("");
          continue;
        }
        // __project_info__ 是特殊字段: 单个项目按钮的 React fiber 信息 (调试入口定位用)
        if (sel === "__project_info__") {
          lines.push("--- PROJECT INFO (debug entry location) ---");
          lines.push("source: " + info.source);
          lines.push("textContent: " + info.textContent);
          lines.push("className: " + info.className);
          if (info.ariaLabel) lines.push("ariaLabel: " + info.ariaLabel);
          if (info.dataset) lines.push("dataset: " + JSON.stringify(info.dataset));
          lines.push("");
          lines.push("React prop keys (depth.field (type) = preview):");
          if (Array.isArray(info.reactPropKeys)) {
            info.reactPropKeys.forEach(p => lines.push("  " + p));
          }
          lines.push("");
          lines.push("workspaceNameToSlug cache (init from listAgentWorkspaces):");
          if (info.workspaceNameToSlug_cache && typeof info.workspaceNameToSlug_cache === 'object') {
            for (const [name, slug] of Object.entries(info.workspaceNameToSlug_cache)) {
              lines.push("  '" + name + "' → " + slug);
            }
          } else {
            lines.push("  (empty)");
          }
          lines.push("");
          continue;
        }
        lines.push("--- selector: " + sel + " ---");
        if (!info.found) {
          lines.push("  (not found)" + (info.error ? " error: " + info.error : ""));
        } else {
          lines.push("  parent_class: " + info.parent_class);
          lines.push("  child_count: " + info.child_count);
          lines.push("  outerHTML (first 3000 chars):");
          lines.push(info.outerHTML);
        }
        lines.push("");
      }
      fs.writeFileSync(dumpPath, lines.join("\n"));
      return { ok: true, path: dumpPath };
    } catch (e) {
      return { ok: false, error: String(e && e.message) };
    }
  });

  log("[Patch L] Tree panel IPC registered: proma:get-tree-states / proma:navigate-to-session / proma:tree-view-ready");
})();

// ============================================================
// 补丁 M (v0.18): TAO Watcher — 树形任务流程警察
// 设计原则:
//   1. 能用 Node.js 写的不用 LLM (零 token)
//   2. watcher 无状态, 每轮跑完即销
//   3. stall 检测用文件 mtime, 不调 list_messages
//   4. 违规 send_message 上限 2 次 ("事不过三"), 第 3 次起只记录
//   5. 生命周期跟随 Proma, 不做系统服务
//   6. 每个 workspace 一个独立 Watcher 实例
// ============================================================

const TAO_CONFIG_PATH = path.join(
  process.env.PROMA_TAO_CONFIG_DIR
    ? process.env.PROMA_TAO_CONFIG_DIR
    : path.join(homeDir(), ".proma", "agent-workspaces", "proma", "workspace-files"),
  "tao-engine", "config.json"
);

function homeDir() {
  try { return require("os").homedir(); } catch (_) { return process.env.USERPROFILE || process.env.HOME || "."; }
}

function loadTaoConfig() {
  try {
    if (fs.existsSync(TAO_CONFIG_PATH)) {
      const loaded = JSON.parse(fs.readFileSync(TAO_CONFIG_PATH, "utf8"));
      // D3 (2026-07-14): 合并默认字段（旧 config 无 silence_minutes/silenced_until 时补默认）
      // P1-S05 (2026-07-14): nudge_log_cap 默认 50（旧 config 无则补, 防 nudge_log 无限膨胀）
      return Object.assign({
        silence_minutes: 0,
        silenced_until: null,
        nudge_log_cap: 50,
      }, loaded);
    }
  } catch (e) {
    log("[Patch M] config load failed: " + (e && e.message));
  }
  return {
    enabled: false,
    interval_seconds: 300,
    stale_tree_hours: 24,
    nudge_send_limit: 2,
    nudge_log_cap: 50,       // P1-S05: nudge_log 保留最近 N 条（防膨胀, <=0 关闭）
    workspace_overrides: {},
    rules_enabled: [],
    silence_minutes: 0,      // D3: 用户设置的静默分钟数（展示用）
    silenced_until: null,    // D3: 实际生效的绝对截止时间戳(ms)；null=未静默
  };
}

// D3 (2026-07-14): watcher 静默决策 —— 纯函数，便于单测（patches.cjs 顶层有 electron 副作用，无法直接 require 整模块）。
//   silence_minutes: 配置展示用（用户设的静默分钟数）；silenced_until: 实际生效的绝对截止时间戳(ms)。
//   返回 { skip, remainingMs, reason }。nowMs 由调用方传入（生产用 Date.now()，测试可注入）。
function decideWatcherSilence(cfg, nowMs) {
  const until = cfg && typeof cfg.silenced_until === "number" ? cfg.silenced_until : null;
  if (until == null) return { skip: false, remainingMs: 0, reason: "not silenced" };
  if (nowMs >= until) return { skip: false, remainingMs: 0, reason: "silence window expired" };
  return { skip: true, remainingMs: until - nowMs, reason: "silenced until " + new Date(until).toISOString() };
}

function saveTaoConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(TAO_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(TAO_CONFIG_PATH, JSON.stringify(cfg, null, 2));
    return true;
  } catch (e) {
    log("[Patch M] config save failed: " + (e && e.message));
    return false;
  }
}

// ============================================================
// Workspace 发现: 只扫当前实例对应目录 (避免跨实例显示)
// ISOLATED 实例 (dev) → ~/.proma-dev/agent-workspaces/*
// 非 ISOLATED 实例 (release/release-fresh) → ~/.proma/agent-workspaces/*
// ============================================================

function discoverWorkspaces() {
  const os = require("os");
  const home = os.homedir();
  const isIsolated = process.env.PROMA_INSTANCE_ISOLATED === "1" || process.env.PROMA_INSTANCE_NAME === "dev";
  const candidates = isIsolated
    ? [path.join(home, ".proma-dev", "agent-workspaces")]
    : [path.join(home, ".proma", "agent-workspaces")];
  const found = [];
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    let entries = [];
    try { entries = fs.readdirSync(base); } catch (_) {}
    for (const name of entries) {
      // 每个工作区根目录形如 agent-workspaces/<slug>/, 内含 .context/trees/
      // 或 agent-workspaces/<slug>/workspace-files/.context/trees/
      const wsRoot = path.join(base, name);
      // S1 修复: statSync 包 try/catch, 防止符号链接/并发删除抛
      let st;
      try { st = fs.statSync(wsRoot); } catch (_) { continue; }
      if (!st.isDirectory()) continue;
      // 候选 trees 目录
      const treesCandidates = [
        path.join(wsRoot, ".context", "trees"),
        path.join(wsRoot, "workspace-files", ".context", "trees")
      ];
      for (const treesDir of treesCandidates) {
        let ts;
        try {
          if (!fs.existsSync(treesDir)) continue;
          ts = fs.statSync(treesDir);
        } catch (_) { continue; }
        if (!ts.isDirectory()) continue;
        found.push({
          workspace_id: name,
          workspace_root: path.dirname(path.dirname(treesDir)),  // 去掉 .context/trees
          trees_dir: treesDir,
          is_isolated: isIsolated
        });
        break;
      }
    }
  }
  return found;
}

// ============================================================
// Watcher 实例: 每个 workspace 一个
// ============================================================

class TAOWatcher {
  constructor(workspace) {
    this.workspace = workspace;
    this.timer = null;
    this.last_run_at = null;
    this.last_run_status = null;  // "ok" / "error"
    this.last_error = null;
    this.violations = {};  // leaf_id -> [{ rule_id, ts, evidence }]
    this.running = false;
  }

  start(intervalSeconds) {
    this.stop();
    this.stopped = false;
    const interval = Math.max(30, (intervalSeconds || 300) * 1000);
    this.timer = setInterval(() => { this.runOnce().catch(e => { this.last_error = String(e && e.message); }); }, interval);
    log("[Patch M] Watcher started for workspace=" + this.workspace.workspace_id + " interval=" + (interval / 1000) + "s");
    // 立即跑一次首次检查
    this.runOnce().catch(e => { this.last_error = String(e && e.message); });
  }

  stop() {
    this.stopped = true;  // 标记 stop, 让正在跑的 runOnce 在下一个 await 点检查后退出
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log("[Patch M] Watcher stopped for workspace=" + this.workspace.workspace_id);
    }
  }

  // 主检查流程
  async runOnce() {
    if (this.running) {
      log("[Patch M] Watcher[" + this.workspace.workspace_id + "] 上一轮未结束, 跳过");
      return;
    }
    this.running = true;
    try {
      const cfg = loadTaoConfig();
      // D3 (2026-07-14): 静默窗口检查 —— silenced_until 未过期则本轮跳过（减少噪音/成本）。
      //   过期后自动恢复正常（nowMs >= until → skip=false）。config-patch / silence IPC 可设/清。
      const now = Date.now();
      const _silence = decideWatcherSilence(cfg, now);
      if (_silence.skip) {
        log("[Patch M] Watcher[" + this.workspace.workspace_id + "] silenced, skip run (" + _silence.reason + ", " + Math.round(_silence.remainingMs / 1000) + "s remaining)");
        this.last_run_at = new Date().toISOString();
        this.last_run_status = "ok";
        this.last_error = null;
        return;
      }
      const staleMs = (cfg.stale_tree_hours || 24) * 3600 * 1000;

      // 1. 扫描 trees 目录
      let treeEntries = [];
      try { treeEntries = fs.readdirSync(this.workspace.trees_dir); } catch (_) {}
      const activeTrees = [];
      for (const name of treeEntries) {
        if (name.endsWith(".js") || name.endsWith(".json") || name.endsWith(".md")) continue;
        const statePath = path.join(this.workspace.trees_dir, name, "tree-state.json");
        if (!fs.existsSync(statePath)) continue;
        try {
          const stat = fs.statSync(statePath);
          const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
          const mtimeFresh = (now - stat.mtimeMs) < staleMs;
          const hasActiveLeaf = Object.values(state.leaves || {}).some(l =>
            ["active", "pending_brief", "segment_pending"].includes(l.status)
          );
          // 活跃 = mtime 24h 内 AND 有任意活跃 leaf (commander/worker 都算)
          if (mtimeFresh && hasActiveLeaf) {
            activeTrees.push({ tree_id: name, state, state_path: statePath, mtime: stat.mtimeMs });
          }
        } catch (e) {
          // 解析失败的 tree 跳过
        }
      }

      // 2. 对每个活跃 tree 跑规则检查
      let totalViolations = 0;
      for (const tree of activeTrees) {
        if (this.stopped) return;  // B3 修复: stop 后立即退出
        const violations = await checkAllRules(tree, this.workspace, cfg);
        for (const v of violations) {
          if (this.stopped) return;  // B3 修复: 在每个 nudge 前检查
          totalViolations++;
          // 写 nudge_log + send_message (受 nudge_send_limit 限制)
          await applyNudge(tree, v, cfg);
        }
      }

      this.last_run_at = new Date().toISOString();
      this.last_run_status = "ok";
      this.last_error = null;
    } catch (e) {
      this.last_run_at = new Date().toISOString();
      this.last_run_status = "error";
      this.last_error = String(e && e.message);
      log("[Patch M] Watcher[" + this.workspace.workspace_id + "] error: " + this.last_error);
    } finally {
      this.running = false;
    }
  }
}

// ============================================================
// WatcherManager: 管理 workspace -> Watcher 映射
// ============================================================

class TAOWatcherManager {
  constructor() {
    this.watchers = new Map();  // workspace_id -> TAOWatcher
    this.started = false;
  }

  startAll() {
    // S3 修复: 已启动时不再重复 start, 改为 reload
    if (this.started) {
      log("[Patch M] startAll called but already started, calling reload instead");
      return this.reload();
    }
    const cfg = loadTaoConfig();
    if (!cfg.enabled) {
      log("[Patch M] WatcherManager: globally disabled by config, skip start");
      return;
    }
    const workspaces = discoverWorkspaces();
    log("[Patch M] discovered " + workspaces.length + " workspace(s) with trees");
    for (const ws of workspaces) {
      const override = (cfg.workspace_overrides || {})[ws.workspace_id];
      const wsEnabled = override ? override.enabled !== false : true;
      const wsInterval = (override && override.interval_seconds) || cfg.interval_seconds || 300;
      if (!wsEnabled) {
        log("[Patch M] workspace " + ws.workspace_id + " disabled by override, skip");
        continue;
      }
      const watcher = new TAOWatcher(ws);
      this.watchers.set(ws.workspace_id, watcher);
      watcher.start(wsInterval);
    }
    this.started = true;
  }

  stopAll() {
    for (const [id, w] of this.watchers) {
      w.stop();
    }
    this.watchers.clear();
    this.started = false;
    log("[Patch M] all watchers stopped");
  }

  reload() {
    log("[Patch M] reloading watcher manager (config changed)");
    this.stopAll();
    this.startAll();
  }

  status() {
    const result = { started: this.started, watchers: [] };
    for (const [id, w] of this.watchers) {
      result.watchers.push({
        workspace_id: id,
        workspace_root: w.workspace.workspace_root,
        trees_dir: w.workspace.trees_dir,
        is_isolated: w.workspace.is_isolated,
        running: w.running,
        last_run_at: w.last_run_at,
        last_run_status: w.last_run_status,
        last_error: w.last_error,
        timer_active: !!w.timer
      });
    }
    return result;
  }
}

const taoWatcherManager = new TAOWatcherManager();

// ============================================================
// 规则实现: 15 条
// Tier 1 (零 IPC): C-02, C-03, C-06, C-13, R-01, R-03, R-04, R-05, R-06
// Tier 2 (HTTP bridge IPC): W-01, W-08, W-11, W-12, C-11, C-15
// ============================================================

// ---- Tier 1: 零 IPC 规则 ----

// C-02: 每个 milestone.expect_outputs 非空
function ruleC02(leaf, tree) {
  const violations = [];
  if (!Array.isArray(leaf.milestones)) return violations;
  for (const m of leaf.milestones) {
    if (!Array.isArray(m.expect_outputs) || m.expect_outputs.length === 0 ||
        m.expect_outputs.every(x => !x || !String(x).trim())) {
      violations.push({ rule_id: "C-02", leaf_id: leaf.leaf_id, severity: "low",
        evidence: "milestone '" + (m.id || "(no-id)") + "' has empty expect_outputs",
        suggest: "milestone set-result 需补 expect_outputs 或 milestone add 时填写" });
    }
  }
  return violations;
}

// C-03: leaf 已 done 但有 milestone 未 done
function ruleC03(leaf, tree) {
  if (leaf.status !== "done") return [];
  if (!Array.isArray(leaf.milestones) || leaf.milestones.length === 0) return [];
  const pending = leaf.milestones.filter(m => m.status !== "done");
  if (pending.length === 0) return [];
  return [{
    rule_id: "C-03", leaf_id: leaf.leaf_id, severity: "high",
    evidence: "leaf status=done 但有 " + pending.length + " 个 milestone 未 done: " + pending.map(m => m.id).join(", "),
    suggest: "milestone set-result 把 " + pending.map(m => m.id).join(", ") + " 标 audit_pass=true"
  }];
}

// C-06: commander 已 done 但有子 leaf 未 done (引用 tree-state.js 的 E_CHILDREN_NOT_DONE 校验, 这里只是复核)
function ruleC06(leaf, tree) {
  if (leaf.role !== "commander" || leaf.status !== "done") return [];
  const childIds = Object.keys(tree.state.leaves).filter(lid => tree.state.leaves[lid].parent === leaf.leaf_id);
  const notDone = childIds.filter(lid => tree.state.leaves[lid].status !== "done");
  if (notDone.length === 0) return [];
  return [{
    rule_id: "C-06", leaf_id: leaf.leaf_id, severity: "high",
    evidence: "commander status=done 但 " + notDone.length + " 个子 leaf 未 done: " + notDone.join(", "),
    suggest: "tree-state.js 应已拒绝此 done, 请手动检查; 或先把子 leaf set-status done"
  }];
}

// C-13: 文档审计场景 worker 审查 leaf >=4
function ruleC13(leaf, tree) {
  if (leaf.role !== "commander") return [];
  // 检查 brief 是否含 "review/审计/审查" 关键词 (从 root_brief 或 leaf 父链上的 brief)
  // v0.1 简化: 看 root_brief.in_scope + leaf 的所有 worker 子节点 brief
  const rootBrief = JSON.stringify(tree.state.root_brief || {}).toLowerCase();
  const isAuditScenario = /review|审计|审查|audit/.test(rootBrief);
  if (!isAuditScenario) return [];
  // 统计 role=worker 的子 leaf
  const workerChildren = Object.values(tree.state.leaves).filter(
    l => l.parent === leaf.leaf_id && l.role === "worker"
  );
  if (workerChildren.length >= 4) return [];
  return [{
    rule_id: "C-13", leaf_id: leaf.leaf_id, severity: "mid",
    evidence: "审计场景下 commander 仅有 " + workerChildren.length + " 个 worker 子 leaf (需 ≥4 独立审查)",
    suggest: "fork 至少 " + (4 - workerChildren.length) + " 个独立审查 worker"
  }];
}

// R-01: 唯一 root (parent=null 且 role=root)
function ruleR01(tree) {
  const roots = Object.values(tree.state.leaves).filter(l => l.parent === null);
  const violations = [];
  if (roots.length === 0) {
    violations.push({ rule_id: "R-01", leaf_id: null, severity: "high",
      evidence: "tree 无 root leaf (parent=null 缺失)",
      suggest: "通过 leaf add 创建 role=root leaf" });
  } else if (roots.length > 1) {
    violations.push({ rule_id: "R-01", leaf_id: roots[0].leaf_id, severity: "high",
      evidence: "tree 有 " + roots.length + " 个 parent=null leaf (根唯一性违反): " + roots.map(r => r.leaf_id).join(", "),
      suggest: "保留一个为 role=root, 其他改为有 parent" });
  } else if (roots[0].role !== "root") {
    violations.push({ rule_id: "R-01", leaf_id: roots[0].leaf_id, severity: "high",
      evidence: "parent=null leaf 角色 '" + roots[0].role + "' 不是 root",
      suggest: "leaf set-status 不行, 需通过 migrate 修复" });
  }
  return violations;
}

// R-03: 存在整合 leaf (done 时间最晚)
function ruleR03(tree) {
  const leaves = Object.values(tree.state.leaves);
  const doneLeaves = leaves.filter(l => l.status === "done");
  if (doneLeaves.length < 2) return [];  // 不够 2 个 done 不强求
  // 找最晚 done
  const sortedByTs = doneLeaves.sort((a, b) => {
    const ta = new Date(a.last_event_ts || a.created_at).getTime() || 0;
    const tb = new Date(b.last_event_ts || b.created_at).getTime() || 0;
    return tb - ta;
  });
  const latest = sortedByTs[0];
  // 检查它的 path/brief 是否含 "integrate/整合"
  // v0.1 简化: 看 leaf_id 或 path 是否含 integrate
  const looksLikeIntegrator = /integrat|整合|汇总/i.test(latest.leaf_id + " " + (latest.path || ""));
  if (looksLikeIntegrator) return [];
  // 警告: 最晚完成的 leaf 不像整合 leaf
  return [{
    rule_id: "R-03", leaf_id: latest.leaf_id, severity: "low",
    evidence: "最晚 done 的 leaf '" + latest.leaf_id + "' 不像整合 leaf (无 integrate/整合 关键词)",
    suggest: "如有整合 leaf 应最后完成; 或命名加 integrate 后缀"
  }];
}

// R-04: 所有 worker milestone audit_pass=true
function ruleR04(tree) {
  const violations = [];
  for (const leaf of Object.values(tree.state.leaves)) {
    if (leaf.role !== "worker") continue;
    if (!Array.isArray(leaf.milestones)) continue;
    for (const m of leaf.milestones) {
      if (m.status === "done" && m.audit_pass !== true) {
        violations.push({ rule_id: "R-04", leaf_id: leaf.leaf_id, severity: "mid",
          evidence: "worker milestone '" + m.id + "' status=done 但 audit_pass=" + JSON.stringify(m.audit_pass),
          suggest: "milestone set-result " + leaf.leaf_id + " " + m.id + " --audit-pass true" });
      }
    }
  }
  return violations;
}

// R-05: 三步质量门 (实施/回归/审计 leaf 都 done)
function ruleR05(tree) {
  const leaves = Object.values(tree.state.leaves);
  const doneCount = leaves.filter(l => l.status === "done").length;
  if (doneCount < 3) return [];  // 不够 3 个 done, 还没到验收阶段
  // v0.1 简化: 检查是否有 leaf 路径含 implement/regression/audit
  const hasImpl = leaves.some(l => /implement|实施|开发/i.test(l.leaf_id + (l.path || "")) && l.status === "done");
  const hasRegression = leaves.some(l => /regress|回归|test|测试/i.test(l.leaf_id + (l.path || "")) && l.status === "done");
  const hasAudit = leaves.some(l => /audit|审计|review|审查/i.test(l.leaf_id + (l.path || "")) && l.status === "done");
  if (hasImpl && hasRegression && hasAudit) return [];
  const missing = [];
  if (!hasImpl) missing.push("实施");
  if (!hasRegression) missing.push("回归测试");
  if (!hasAudit) missing.push("审计");
  return [{
    rule_id: "R-05", leaf_id: null, severity: "low",
    evidence: "tree 已有 " + doneCount + " 个 done leaf, 但缺质量门阶段: " + missing.join(", "),
    suggest: "整树完成前需补 " + missing.join(", ") + " 阶段的 leaf"
  }];
}

// R-06: 关键交付物验证者 != 产出者
function ruleR06(tree) {
  // v0.1 简化: 检查是否有任意两个 leaf 的 path 互补 (如 X + X-verify)
  const leaves = Object.values(tree.state.leaves);
  const violations = [];
  for (const leaf of leaves) {
    if (leaf.role !== "worker" || leaf.status !== "done") continue;
    // 看是否有 verify/audit/review leaf 关联
    const hasVerifier = leaves.some(l =>
      l !== leaf &&
      l.status === "done" &&
      l.session_id !== leaf.session_id &&
      new RegExp(leaf.leaf_id + "|verify|audit|review", "i").test(l.leaf_id + (l.path || ""))
    );
    if (!hasVerifier) {
      violations.push({ rule_id: "R-06", leaf_id: leaf.leaf_id, severity: "low",
        evidence: "worker '" + leaf.leaf_id + "' 已 done 但无独立验证 leaf",
        suggest: "fork 一个 verify/audit worker 独立检查" });
    }
  }
  return violations;
}

// ---- Tier 2: HTTP bridge IPC 规则 ----
// (在下个 Edit 追加, 因为需要 IPC 调用函数)

// ============================================================
// Sprint 4 TAO Watcher 按角色分发规则 (cross-workspace-tree-issue §七 + SECURITY 聚类 C)
// ============================================================
// 设计意图: 每条 leaf-scoped 规则有明确适用 role scope. 之前靠各规则函数自己的
//   `if (leaf.role !== X) return []` 自过滤 (散落易漏: 新规则忘加 guard → 错配).
//   本表是单一信源 + 结构防御层: dispatch 时按 leaf.role 只跑该 role 的规则, 即使某
//   函数 guard 写错/漏写也不会错配到其他 role (纵深防御, 补 isSharedSessionLeaf 守卫).
//   a8111bf5 根因 (worker 规则 W-01 经共享 session 注入根指挥官) 已被 isSharedSessionLeaf
//   修; 本表再加结构层: worker 规则 (W-01/W-08/W-11/W-12/W-AUDIT-NO-ALIGN) 结构上
//   绝不发给非 worker leaf, commander 规则 (C-06) 绝不发给 worker/root.
//   null = 所有 role 适用 (规则函数自带更细条件, 如 W-AUDIT-SELF 的 root 自审例外).
//   ⚠️ 本表必须与各 rule 函数的 role guard 完全一致, 否则引入回归 —— 测试强制静态校验.
//   tree-scoped 规则 (R-01/R-04/R-05) 不在此表 (无 leaf role 维度).
const RULE_ROLE_SCOPE = {
  // Tier 1 leaf-scoped
  'C-02': null,                    // ruleC02: 无 role guard (任何有 milestone 的 leaf)
  'C-03': null,                    // ruleC03: 无 role guard (任何 status=done leaf with pending milestone)
  'C-06': ['commander'],           // ruleC06: if (leaf.role !== "commander" || status !== done)
  'W-AUDIT-SELF': null,            // ruleAuditSelf: 无 role guard, root 自审例外 (函数内 if role===root return)
  'W-AUDIT-WORKER': null,          // ruleAuditWorker: 无 role guard (查 auditor leaf 的 role)
  'W-AUDIT-TAMPER': null,          // ruleAuditTamper: 无 role guard (查 audit_log 篡改痕迹)
  'W-AUDIT-NO-ALIGN': ['worker'],  // ruleAuditNoAlign: if (leaf.role !== "worker")
  // Tier 2 leaf-scoped (仅 active/pending_brief/segment_pending)
  'W-01': ['worker'],              // ruleW01: a8111bf5 根因 — worker 缺 brief_echo, worker 专属
  'W-08': ['worker'],              // ruleW08: worker leaf purity (不直调 tree 写工具)
  'W-11': ['worker'],              // ruleW11: worker 单条消息长度
  'W-12': ['worker'],              // ruleW12: worker 上行 event 字段合法
  'C-11': ['commander', 'root'],   // ruleC11: if (role !== "commander" && role !== "root")
};
// ruleId 对 leaf.role 是否适用. null/absent scope → 所有 role (规则自带更细条件).
function ruleAppliesToRole(ruleId, role) {
  const scope = RULE_ROLE_SCOPE[ruleId];
  if (!scope) return true;
  return scope.includes(role);
}
// role 感知的 leaf 规则分发: 不在 scope → 跳过 (结构防御, 补函数内自过滤).
function maybeForLeaf(ruleId, leaf, fn, tree) {
  if (!ruleAppliesToRole(ruleId, leaf.role)) return;
  maybe(ruleId, fn, leaf, tree);
}

// ============================================================
// checkAllRules: 对 tree 跑所有适用规则
// ============================================================

async function checkAllRules(tree, workspace, cfg) {
  const all = [];
  const rulesEnabled = (cfg.rules_enabled && cfg.rules_enabled.length > 0) ? cfg.rules_enabled : null;

  // 防御 (V10 Phase 3 followup): Bug B 复现树/历史脏数据中同 session_id 被多 leaf 复用,
  // 此种 tree 已是病态, TAO Watcher 不应对其任何 leaf 发 nudge (避免鞭策错对象,
  // 干扰主线指挥官). 根因: a8111bf5 同时在某 tree 是 root, 在另一 leaf (bug-b 复现)
  // 又被注册成 worker, TAO Watcher 跑 W-01 后通过 runAgentHeadless 把"worker 缺 brief_echo"
  // 注入根指挥官会话, 导致主线指挥官意外终止. 修复: session_id 共享 → 全部跳过.
  const sessionUsage = new Map();
  for (const leaf of Object.values(tree.state.leaves || {})) {
    if (!leaf.session_id) continue;
    sessionUsage.set(leaf.session_id, (sessionUsage.get(leaf.session_id) || 0) + 1);
  }
  const sharedSessions = new Set(
    [...sessionUsage.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  );
  function isSharedSessionLeaf(leaf) {
    return !!(leaf.session_id && sharedSessions.has(leaf.session_id));
  }

  function maybe(ruleId, fn, ...args) {
    if (rulesEnabled && !rulesEnabled.includes(ruleId)) return;
    try {
      const v = fn(...args);
      if (Array.isArray(v)) all.push(...v);
    } catch (e) {
      log("[Patch M] rule " + ruleId + " error: " + (e && e.message));
    }
  }

  // Tier 1
  maybe("R-01", ruleR01, tree);
  maybe("R-04", ruleR04, tree);
  maybe("R-05", ruleR05, tree);
  for (const leaf of Object.values(tree.state.leaves)) {
    if (isSharedSessionLeaf(leaf)) {
      log("[Patch M] tree=" + tree.tree_id + " leaf=" + leaf.leaf_id +
          " session_id shared by multiple leaves (bug-b-repro or dirty data), skip tier1 rules");
      continue;
    }
    maybeForLeaf("C-02", leaf, ruleC02, tree);
    maybeForLeaf("C-03", leaf, ruleC03, tree);
    maybeForLeaf("C-06", leaf, ruleC06, tree);
    // V10 Phase 3 followup R5 (移到 Tier 1, 不依赖 status): tamper detection 必须对
    // done leaf 跑, 因为篡改痕迹 (audit_gate=pass / audit_log pass=true) 都是 done
    // 之后才看的. 之前放在 Tier 2 (有 status 守卫) 导致 v626 全 done tree 永远检测不到.
    maybeForLeaf("W-AUDIT-SELF", leaf, ruleAuditSelf, tree);
    maybeForLeaf("W-AUDIT-WORKER", leaf, ruleAuditWorker, tree);
    maybeForLeaf("W-AUDIT-TAMPER", leaf, ruleAuditTamper, tree);
    maybeForLeaf("W-AUDIT-NO-ALIGN", leaf, ruleAuditNoAlign, tree);
  }

  // Tier 2 (IPC)
  for (const leaf of Object.values(tree.state.leaves)) {
    // 只对活跃 leaf 跑 IPC 规则
    if (!["active", "pending_brief", "segment_pending"].includes(leaf.status)) continue;
    if (isSharedSessionLeaf(leaf)) {
      log("[Patch M] tree=" + tree.tree_id + " leaf=" + leaf.leaf_id +
          " session_id shared by multiple leaves (bug-b-repro or dirty data), skip tier2 rules");
      continue;
    }
    maybeForLeaf("W-01", leaf, ruleW01, tree);
    maybeForLeaf("W-08", leaf, ruleW08, tree);
    maybeForLeaf("W-11", leaf, ruleW11, tree);
    maybeForLeaf("W-12", leaf, ruleW12, tree);
    maybeForLeaf("C-11", leaf, ruleC11, tree);
  }

  return all;
}

// ============================================================
// applyNudge: 应用违规 (写 nudge_log + send_message 上限控制)
// ============================================================

async function applyNudge(tree, violation, cfg) {
  try {
    // 读最新 state (其他 Agent 可能在 watcher 跑的同时改了)
    const freshState = JSON.parse(fs.readFileSync(tree.state_path, "utf8"));
    const leaf = freshState.leaves[violation.leaf_id];
    if (!leaf) return;  // leaf 已删, 跳过

    // 全局守卫 (V10 Phase 3 followup 加固, 补 commit 9c423b8 盲点):
    // checkAllRules 入口的 isSharedSessionLeaf 守卫只覆盖接收 leaf 参数的子级规则
    // (C-02/C-03/C-06/C-13 + Tier2 全部), 但 R-04/R-05/R-06 是 tree 级规则, 接收
    // tree 参数, 内部循环 worker leaf 时不走过守卫. 运行时验证 (bugav tree) 证实
    // R-04 仍会对共享 session_id 的 leaf 触发 nudge. 这里在 applyNudge 入口加
    // 全局守卫, 覆盖所有规则产生的 violation, 彻底堵住鞭策错对象.
    if (leaf.session_id) {
      let sharedCount = 0;
      for (const l of Object.values(freshState.leaves)) {
        if (l.session_id === leaf.session_id) sharedCount++;
      }
      if (sharedCount > 1) {
        log("[Patch M] applyNudge tree=" + tree.tree_id + " leaf=" + leaf.leaf_id +
            " session_id " + leaf.session_id.slice(0, 8) + "... shared by " + sharedCount +
            " leaves, skip nudge (bug-b-repro or dirty data, defensive guard)");
        return;
      }
    }

    // 初始化 audit_log/nudge_log/nudge_count
    if (!Array.isArray(leaf.nudge_log)) leaf.nudge_log = [];
    if (typeof leaf.nudge_count !== "number") leaf.nudge_count = 0;

    // 幂等: 30 秒内同一 rule_id 不重复 nudge
    const now = Date.now();
    const recentSame = leaf.nudge_log.find(
      e => e.rule_id === violation.rule_id && (now - new Date(e.ts).getTime()) < 30000
    );
    if (recentSame) return;

    // 增量 nudge_count (全局, 不分 rule)
    leaf.nudge_count += 1;
    const nudgeEntry = {
      ts: new Date().toISOString(),
      rule_id: violation.rule_id,
      severity: violation.severity,
      evidence: violation.evidence,
      suggest: violation.suggest,
      nudge_count: leaf.nudge_count,
      send_message: leaf.nudge_count <= (cfg.nudge_send_limit || 2)
    };
    leaf.nudge_log.push(nudgeEntry);

    // P1-S05 命运决策落地 (2026-07-14): 保留 TaoWatcher + 补可观测.
    //   决策依据 pro 26-tree 实测: vcb2=4 条 (真实价值, 捕获 W-01/W-08 违规) 但 macp2b=15052
    //   条 (nudge_log 无上限膨胀, 状态污染, 无行为效果). nudge_send_limit 只限 send_message
    //   不限 log → log 无限增长. 加 nudge_log 上限: 保留最近 N 条 (默认 50, cfg.nudge_log_cap
    //   可配, <=0 关闭). 用专用累计计数器 leaf.nudge_log_dropped_total 记历史总丢弃数
    //   (独立于哪些条目存活, 永远准确, 可观测: 一眼知道累计浪费多少).
    const _nudgeLogCap = (cfg && typeof cfg.nudge_log_cap === 'number') ? cfg.nudge_log_cap : 50;
    if (_nudgeLogCap > 0 && leaf.nudge_log.length > _nudgeLogCap) {
      const _dropped = leaf.nudge_log.length - _nudgeLogCap;
      leaf.nudge_log = leaf.nudge_log.slice(-_nudgeLogCap);
      leaf.nudge_log_dropped_total = (typeof leaf.nudge_log_dropped_total === 'number' ? leaf.nudge_log_dropped_total : 0) + _dropped;
      log("[Patch M] leaf " + leaf.leaf_id + " nudge_log capped to " + _nudgeLogCap + " (dropped " + _dropped + ", total_dropped=" + leaf.nudge_log_dropped_total + ")");
    }

    // P0b (2026-07-08): 废止 tao-watcher 写 audit_log（macp4-A4 实证 29-43 条噪音掩盖真审计结果）。
    //   tao-watcher 只保留 nudge_log + send_message（鞭策），不再污染 audit_log（审计结果专由独立 auditor leaf 写）。
    //   engine collectValidateIssues 仍跳过历史 tao-watcher-script 条目（防御性兼容旧数据）。

    // 保存
    fs.writeFileSync(tree.state_path, JSON.stringify(freshState, null, 2));

    // send_message (受 nudge_send_limit 限制, "事不过三" → 上限 2 次)
    if (nudgeEntry.send_message) {
      try {
        await sendWatcherNudgeMessage(leaf, violation, freshState, cfg);
      } catch (e) {
        log("[Patch M] send_message failed for " + leaf.leaf_id + ": " + (e && e.message));
      }
    } else {
      log("[Patch M] leaf " + leaf.leaf_id + " nudge_count=" + leaf.nudge_count + " 已达上限, 仅记录不提醒");
    }
  } catch (e) {
    log("[Patch M] applyNudge error: " + (e && e.message));
  }
}

// 通过 Proma API send_message 发鞭策消息到违规 leaf 会话
async function sendWatcherNudgeMessage(leaf, violation, state, cfg) {
  const a = api();
  const limit = (cfg && cfg.nudge_send_limit) || 2;
  const msg =
    "[TAO Watcher #" + leaf.nudge_count + "] 流程违规\n" +
    "规则: " + violation.rule_id + " (" + violation.severity + ")\n" +
    "证据: " + violation.evidence + "\n" +
    "建议: " + violation.suggest + "\n" +
    "——\n" +
    "这是机械检查提醒, 不评价内容质量。如有疑问请通过 blocked 消息回复, 或继续执行后自动消除。" +
    (leaf.nudge_count >= limit ? "\n已达 nudge 上限, 后续违规将仅记录不提醒。" : "");

  // 调 Proma runAgentHeadless 发 user message 到 leaf.session_id
  // 注意: 这会真正给目标会话注入消息, 让 Agent 看到
  await new Promise((resolve, reject) => {
    try {
      a.runAgentHeadless(
        {
          sessionId: leaf.session_id,
          userMessage: msg,
          permissionModeOverride: "bypassPermissions",
          triggeredBy: "tao-watcher"
        },
        {
          source: "tao-watcher",
          onError: (err) => reject(new Error(err)),
          onComplete: () => resolve()
        }
      );
    } catch (e) { reject(e); }
  });
}

// 启动 WatcherManager (Proma 启动后 5s 延迟, 避免与主进程启动竞争)
setTimeout(() => {
  // B1 修复: 检查 __proma__ 是否就绪, 否则延迟重试
  if (!global.__proma__) {
    log("[Patch M] global.__proma__ not ready at startup, retrying in 10s");
    setTimeout(() => {
      if (global.__proma__) {
        try { taoWatcherManager.startAll(); } catch (e) { log("[Patch M] retry startup error: " + (e && e.message)); }
      } else {
        log("[Patch M] global.__proma__ still not ready after 15s, give up");
      }
    }, 10000);
    return;
  }
  try {
    taoWatcherManager.startAll();
  } catch (e) {
    log("[Patch M] startup error: " + (e && e.message));
  }
}, 5000);

// Proma 退出时自动停止 (L2: 用 electron.app.before-quit 而非 process.beforeExit)
(function registerQuitHandler() {
  try {
    const electron = require("electron");
    if (electron && electron.app) {
      electron.app.on("before-quit", () => { taoWatcherManager.stopAll(); });
      return;
    }
  } catch (_) {}
  // fallback
  process.on("beforeExit", () => { taoWatcherManager.stopAll(); });
  process.on("exit", () => { taoWatcherManager.stopAll(); });
})();

// ============================================================
// Tier 2 规则: HTTP bridge IPC (调 Proma API 读会话消息)
// ============================================================

// 安全读取 leaf 会话的消息 (best-effort, 失败返回空数组)
function readLeafMessages(sessionId, limit) {
  try {
    const a = api();
    const meta = a.getAgentSessionMeta(sessionId);
    if (!meta) return [];
    const msgs = a.getAgentSessionSDKMessages(sessionId);
    if (!Array.isArray(msgs)) return [];
    const slice = msgs.slice(0, limit || 50);
    return slice;
  } catch (e) {
    log("[Patch M] readLeafMessages(" + sessionId + ") error: " + (e && e.message));
    return [];
  }
}

// 提取消息纯文本 (兼容 user/assistant/result 类型)
function msgText(m) {
  if (!m) return "";
  if (m.message && m.message.content) {
    if (typeof m.message.content === "string") return m.message.content;
    if (Array.isArray(m.message.content)) {
      return m.message.content.map(c => (c && c.text) ? c.text : "").join("\n");
    }
  }
  if (m.result) return String(m.result);
  return "";
}

// W-01: Worker 首条 assistant 消息含 event: brief_echo
function ruleW01(leaf, tree) {
  if (leaf.role !== "worker") return [];
  if (!["active", "pending_brief"].includes(leaf.status)) return [];
  const msgs = readLeafMessages(leaf.session_id, 10);
  if (msgs.length === 0) return [];  // 没消息读不到, 不判违规
  // 找第一条自身 assistant 消息
  const firstAssistant = msgs.find(m =>
    m.type === "assistant" ||
    (m.message && m.message.role === "assistant")
  );
  if (!firstAssistant) {
    return [{ rule_id: "W-01", leaf_id: leaf.leaf_id, severity: "high",
      evidence: "worker 无任何 assistant 消息 (未产出 brief_echo)",
      suggest: "Worker 首条回复必须含 event: brief_echo YAML 块" }];
  }
  const text = msgText(firstAssistant);
  if (/event:\s*brief_echo|brief_echo:/i.test(text)) return [];
  return [{ rule_id: "W-01", leaf_id: leaf.leaf_id, severity: "high",
    evidence: "worker 首条 assistant 消息无 brief_echo",
    suggest: "首条回复必须含 'event: brief_echo' YAML 块" }];
}

// W-08: Worker 没直接调 tree 写工具 (v0.7+: 引擎内联 MCP, 查 mcp__tree__* 写工具调用, 非 tree-state.js CLI)
function ruleW08(leaf, tree) {
  if (leaf.role !== "worker") return [];
  const msgs = readLeafMessages(leaf.session_id, 50);
  if (msgs.length === 0) return [];
  // v0.7+: worker 调任何 mcp__tree__* 写工具都违反 leaf purity（worker 只该 send_message 上报）。
  // 工具全名 mcp__tree__tree_<cmd>（MCP server name="tree", tool name="tree_init" 等）。
  const writeTools = /mcp__tree__tree_(init|backup|restore|migrate|leaf_add|leaf_set_status|leaf_set_context|leaf_set_last_event|leaf_set_session|milestone_add|milestone_set_result|event_append|drift_append|heartbeat_append|segment_append|nudge_append|audit_gate|audit_append)\b/i;
  for (const m of msgs) {
    const text = msgText(m);
    if (writeTools.test(text)) {
      return [{ rule_id: "W-08", leaf_id: leaf.leaf_id, severity: "high",
        evidence: "worker 会话含 mcp__tree__* 写工具调用 (违反 leaf purity)",
        suggest: "Worker 不应直接操作 tree 状态, 通过 send_message 上报让 Commander 操作" }];
    }
  }
  return [];
}

// W-11: 单条 assistant 消息长度 <= 5000 字符
function ruleW11(leaf, tree) {
  if (leaf.role !== "worker") return [];
  const msgs = readLeafMessages(leaf.session_id, 50);
  if (msgs.length === 0) return [];
  const violations = [];
  for (const m of msgs) {
    if (m.type !== "assistant" && !(m.message && m.message.role === "assistant")) continue;
    const text = msgText(m);
    if (text.length > 5000) {
      violations.push({ rule_id: "W-11", leaf_id: leaf.leaf_id, severity: "low",
        evidence: "assistant 消息 " + String(m.uuid || m.timestamp || "?").slice(0, 8) + " 长度 " + text.length + " > 5000",
        suggest: "拆分长消息或先落盘文件后只引用路径" });
    }
  }
  // 只报第一条违规 (避免一次 nudge 太多)
  return violations.slice(0, 1);
}

// W-12: 上行消息 event 字段必须 ∈ {done, blocked, plan, brief_echo}
function ruleW12(leaf, tree) {
  if (leaf.role !== "worker") return [];
  const msgs = readLeafMessages(leaf.session_id, 30);
  if (msgs.length === 0) return [];
  const validEvents = ["done", "blocked", "plan", "brief_echo"];
  const violations = [];
  for (const m of msgs) {
    if (m.type !== "assistant" && !(m.message && m.message.role === "assistant")) continue;
    const text = msgText(m);
    const evMatch = text.match(/event:\s*(\w+)/i);
    if (evMatch && !validEvents.includes(evMatch[1].toLowerCase())) {
      violations.push({ rule_id: "W-12", leaf_id: leaf.leaf_id, severity: "mid",
        evidence: "assistant 消息声明 event: " + evMatch[1] + " 不在合法集合 {done, blocked, plan, brief_echo}",
        suggest: "上行消息只能用 done/blocked/plan/brief_echo 之一" });
    }
    if (violations.length >= 1) break;  // 只报第一条
  }
  return violations;
}

// C-11: Commander 没直接 Read/Write tree-state.json 数据文件 (v0.7+: 合法途径是 mcp__tree__* 工具)
function ruleC11(leaf, tree) {
  if (leaf.role !== "commander" && leaf.role !== "root") return [];
  const msgs = readLeafMessages(leaf.session_id, 80);
  if (msgs.length === 0) return [];
  // v0.7+: 引擎已内联 MCP, 合法的状态变更途径是 mcp__tree__* 工具调用。
  // tree-state.json 是数据文件, 任何直接 Read/Write/Edit 都违规
  // （mcp__tree__* 工具调用不会在消息文本里产生 "Read tree-state.json" 字样，故无需再排除 CLI 模式）。
  const directAccessPattern = /\b(?:Read|Write|Edit)\b[^\n]{0,200}\btree-state\.json\b(?!s\b)/i;
  for (const m of msgs) {
    const text = msgText(m);
    if (directAccessPattern.test(text)) {
      return [{ rule_id: "C-11", leaf_id: leaf.leaf_id, severity: "mid",
        evidence: "commander/root 直接 Read/Write tree-state.json (违反 Leaf Purity)",
        suggest: "状态变更必须走 mcp__tree__* 工具, 不直接读写数据文件" }];
    }
  }
  return [];
}

// C-15: role=worker leaf 必须是 create_session 创建的 (无 source_session_id)
function ruleC15(leaf, tree) {
  if (leaf.role !== "worker") return [];
  try {
    const a = api();
    const meta = a.getAgentSessionMeta(leaf.session_id);
    if (!meta) return [];  // 元数据找不到, 不判
    // fork 创建的会话有 sourceSessionId, create_session 创建的没有
    if (meta.sourceSessionId || meta.source_session_id || meta.forked_from) {
      return [{ rule_id: "C-15", leaf_id: leaf.leaf_id, severity: "high",
        evidence: "worker session '" + leaf.session_id.slice(0, 8) + "...' 是 fork 创建 (source_session_id=" + (meta.sourceSessionId || meta.source_session_id || "?") + ")",
        suggest: "Worker 必须用 create_session 创建 (干净上下文), 不应用 fork_session" }];
    }
  } catch (e) {
    // 元数据查不到不算违规 (best-effort)
  }
  return [];
}

// ============================================================
// V10 Phase 3 followup R5 (audit tamper detection, v626 tree 攻击):
// v626 tree-state.json 被直接篡改出现自审通过 + worker 当 auditor + audit_log
// 伪造 pass=true 异常. 引擎层 resolveAuditorIndep L1912 本应拦 "auditor is the leaf
// itself", 但 tree-state.json 直接编辑绕过引擎 (Layer 4 攻击). TAO Watcher 必须检测.
// ============================================================

// W-AUDIT-SELF: leaf audit_gate=pass 但 auditor_session_id === leaf.session_id (自审)
//   例外: root leaf (trust anchor, 自审允许)
function ruleAuditSelf(leaf, tree) {
  if (!leaf.audit_gate || leaf.audit_gate.verdict !== "pass") return [];
  if (!leaf.audit_gate.auditor_session_id) return [];
  if (leaf.role === "root") return [];  // root 自审例外
  if (leaf.audit_gate.auditor_session_id === leaf.session_id) {
    return [{ rule_id: "W-AUDIT-SELF", leaf_id: leaf.leaf_id, severity: "high",
      evidence: "leaf audit_gate=pass 但 auditor " + leaf.audit_gate.auditor_session_id.slice(0, 8) + "... 是 leaf 自己 session (自审禁止, 非 root)",
      suggest: "tree-state.json 可能被直接篡改绕过引擎; 正常流程 resolveAuditorIndep 应拦 'auditor is the leaf itself'" }];
  }
  return [];
}

// W-AUDIT-WORKER: auditor 是另一个 worker leaf (互审洗白禁止)
//   设计意图: auditor 应是独立审计 leaf (commander / 专属 auditor leaf), worker 不能审别的 leaf
function ruleAuditWorker(leaf, tree) {
  if (!leaf.audit_gate || leaf.audit_gate.verdict !== "pass") return [];
  const auditorSid = leaf.audit_gate.auditor_session_id;
  if (!auditorSid) return [];
  const auditorLeaf = Object.values(tree.state.leaves || {}).find(l =>
    l.session_id === auditorSid && l.leaf_id !== leaf.leaf_id
  );
  if (!auditorLeaf) return [];  // auditor 不在树中, 别的规则管
  if (auditorLeaf.role === "worker") {
    return [{ rule_id: "W-AUDIT-WORKER", leaf_id: leaf.leaf_id, severity: "high",
      evidence: "leaf audit_gate=pass 但 auditor " + auditorLeaf.leaf_id + " role=worker (worker 不能审别的 leaf, 互审洗白禁止)",
      suggest: "auditor 应是独立审计 leaf (commander 或 root 派生的 auditor leaf), 不是 worker" }];
  }
  return [];
}

// W-AUDIT-TAMPER: audit_log 含 TAO Watcher pass=true 条目 (伪造痕迹)
//   TAO Watcher 的 audit_log 总是 pass=false (检测违规). pass=true 是直接篡改痕迹.
function ruleAuditTamper(leaf, tree) {
  if (!Array.isArray(leaf.audit_log)) return [];
  for (const entry of leaf.audit_log) {
    if (entry && entry.auditor === "tao-watcher-script" && entry.pass === true) {
      return [{ rule_id: "W-AUDIT-TAMPER", leaf_id: leaf.leaf_id, severity: "high",
        evidence: "audit_log 含 TAO Watcher pass=true 条目 (rule=" + entry.rule_id + ", ts=" + entry.ts + ") — TAO Watcher 从不写 pass=true, 这是直接篡改痕迹",
        suggest: "检查 tree-state.json 是否被手工编辑; TAO Watcher audit_log 应只有 pass=false" }];
    }
  }
  return [];
}

// W-AUDIT-NO-ALIGN: worker audit_gate=pass 但 events 无 brief_echo with alignment
//   V5b 引擎校验: worker audit pass 前必须有 brief_echo alignment event
//   如果 audit_gate=pass 但无 alignment event, 表明引擎校验被绕过 (直接篡改)
function ruleAuditNoAlign(leaf, tree) {
  if (leaf.role !== "worker") return [];
  if (!leaf.audit_gate || leaf.audit_gate.verdict !== "pass") return [];
  const evs = Array.isArray(leaf.events) ? leaf.events : [];
  const hasAlign = evs.some(e => e && e.type === "brief_echo" && e.meta &&
    e.meta.alignment !== undefined && e.meta.alignment !== null && e.meta.alignment !== "");
  if (!hasAlign) {
    return [{ rule_id: "W-AUDIT-NO-ALIGN", leaf_id: leaf.leaf_id, severity: "high",
      evidence: "worker audit_gate=pass 但 events 无 brief_echo with alignment (V5b 引擎校验应拦, 表明直接篡改)",
      suggest: "检查 tree-state.json 是否被手工编辑; worker audit pass 前必须有 alignment brief_echo event" }];
  }
  return [];
}

// ============================================================
// 补丁 M IPC handlers (供 UI 控制 watcher)
// ============================================================

(function registerWatcherIpc() {
  let electron;
  try { electron = require("electron"); } catch (_) { electron = null; }
  if (!electron || !electron.ipcMain) {
    log("[Patch M] electron.ipcMain not available, skip watcher IPC");
    return;
  }
  const ipcMain = electron.ipcMain;

  // proma:watcher-status — 获取所有 watcher 状态 + 配置
  ipcMain.handle("proma:watcher-status", async () => {
    const cfg = loadTaoConfig();
    return {
      ok: true,
      config: cfg,
      silence: decideWatcherSilence(cfg, Date.now()),  // D3: 暴露静默决策（skip/remainingMs/reason）
      manager_started: taoWatcherManager.started,
      watchers: taoWatcherManager.status().watchers
    };
  });

  // proma:watcher-silence -- D3: 静默 N 分钟 { minutes: N }；minutes<=0 清除静默
  //   设置 silenced_until = now + minutes*60000。watcher runOnce 检测未过期则跳过（减噪/省成本）。
  //   不重启 watcher（静默只影响 runOnce 内决策，timer 照常 tick；过期自动恢复）。
  ipcMain.handle("proma:watcher-silence", async (_event, arg) => {
    const minutes = arg && typeof arg.minutes === "number" ? arg.minutes : 0;
    const cfg = loadTaoConfig();
    if (minutes <= 0) {
      cfg.silence_minutes = 0;
      cfg.silenced_until = null;
    } else {
      const cap = Math.min(60 * 24 * 7, Math.max(1, Math.floor(minutes)));  // 1 分钟～7 天
      cfg.silence_minutes = cap;
      cfg.silenced_until = Date.now() + cap * 60 * 1000;
    }
    saveTaoConfig(cfg);
    return { ok: true, silence_minutes: cfg.silence_minutes, silenced_until: cfg.silenced_until };
  });

  // proma:watcher-toggle -- 全局开关 { enabled: bool }
  ipcMain.handle("proma:watcher-toggle", async (_event, arg) => {
    const cfg = loadTaoConfig();
    const newEnabled = arg && typeof arg.enabled === "boolean" ? arg.enabled : !cfg.enabled;
    cfg.enabled = newEnabled;
    saveTaoConfig(cfg);
    if (newEnabled) {
      taoWatcherManager.startAll();
    } else {
      taoWatcherManager.stopAll();
    }
    return { ok: true, enabled: newEnabled };
  });

  // proma:watcher-set-interval -- 设置默认 interval { interval_seconds: N }
  ipcMain.handle("proma:watcher-set-interval", async (_event, arg) => {
    if (!arg || typeof arg.interval_seconds !== "number") {
      return { ok: false, error: "interval_seconds (number) required" };
    }
    const cfg = loadTaoConfig();
    cfg.interval_seconds = Math.max(30, Math.min(3600, arg.interval_seconds));
    saveTaoConfig(cfg);
    // 重启 watcher 应用新 interval
    if (cfg.enabled) {
      taoWatcherManager.reload();
    }
    return { ok: true, interval_seconds: cfg.interval_seconds };
  });

  // proma:watcher-run-now -- 立即跑一次所有 watcher (手动触发, 不等 interval)
  ipcMain.handle("proma:watcher-run-now", async (_event, arg) => {
    const targetWsId = arg && arg.workspace_id;
    const runs = [];
    for (const [id, w] of taoWatcherManager.watchers) {
      if (targetWsId && id !== targetWsId) continue;
      // M7 修复: 检查 watcher 是否正在跑
      if (w.running) {
        runs.push({ workspace_id: id, ok: true, skipped: true, note: "上一轮未结束, 跳过" });
        continue;
      }
      try {
        await w.runOnce();
        runs.push({ workspace_id: id, ok: true, last_status: w.last_run_status, last_error: w.last_error });
      } catch (e) {
        runs.push({ workspace_id: id, ok: false, error: String(e && e.message) });
      }
    }
    return { ok: true, runs };
  });

  // proma:watcher-config-patch -- 局部更新 config (workspace_overrides / rules_enabled 等)
  ipcMain.handle("proma:watcher-config-patch", async (_event, arg) => {
    if (!arg || typeof arg !== "object") {
      return { ok: false, error: "config patch object required" };
    }
    const cfg = loadTaoConfig();
    for (const k of ["enabled", "interval_seconds", "stale_tree_hours", "nudge_send_limit", "nudge_log_cap", "workspace_overrides", "rules_enabled", "silence_minutes", "silenced_until"]) {
      if (k in arg) cfg[k] = arg[k];
    }
    saveTaoConfig(cfg);
    if (cfg.enabled) taoWatcherManager.reload();
    return { ok: true, config: cfg };
  });

  log("[Patch M] Watcher IPC registered: proma:watcher-status / toggle / set-interval / run-now / config-patch / silence");
})();

