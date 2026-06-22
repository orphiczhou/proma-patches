"use strict";
// Proma Dev Patches — Agent Session Management MCP Tools
// 提供 list_channels / list_sessions / get_session_info / get_session_context
//    create_session / fork_session / send_message
const { randomUUID } = require("node:crypto");
const path = require("path");
const fs = require("fs");

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

      try {
        const meta = a.createAgentSession(args.title, args.channel_id, args.workspace_id, modelId);
        log(`Session created: ${meta.id.slice(0, 8)} "${meta.title}" channel=${args.channel_id} model=${modelId}`);
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
        if (args.title) updates.title = args.title;
        const effectiveChannelId = args.new_channel_id || source.channelId;
        if (effectiveChannelId) updates.channelId = effectiveChannelId;
        const effectiveModelId = args.new_model_id || source.modelId;
        if (effectiveModelId) updates.modelId = effectiveModelId;
        if (args.new_workspace_id) updates.workspaceId = args.new_workspace_id;

        a.updateAgentSessionMeta(forked.id, updates);
        Object.assign(forked, updates);

        log(`Session forked: ${forked.id.slice(0, 8)} from ${args.source_session_id.slice(0, 8)}`);
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
          },
          message: `Session forked: ${forked.title} (${forked.id.slice(0, 8)}) from "${source.title}". Open the Proma sidebar to see and switch to the forked session.`,
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
      return jsonResult(await remoteHttpPost(port, "create_session", args, host));
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
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          }
        });
      });

      server.on("error", (e) => {
        if (e.code === "EADDRINUSE") return reject(e);
        log(`HTTP bridge error: ${e.message}`);
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

// ---- 注册全局钩子（内部 Agent MCP server）----
global.__proma_getMcpServers__ = function (sessionId, workspaceSlug, sdk) {
  try {
    let z;
    try { z = require("zod").z || require("zod"); } catch(_) { z = null; }
    if (!z) return undefined;
    const server = createSessionMcpServer(sdk, z, sessionId);
    const remoteServer = createRemoteSessionMcpServer(sdk, z);
    return { session: server, "remote-session": remoteServer };
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
        for (const tc of treesCandidates) {
          try {
            if (!fs.existsSync(tc.dir)) continue;
            const ts = fs.statSync(tc.dir);
            if (!ts.isDirectory()) continue;
          } catch (_) { continue; }
          found.push({
            workspace_slug: name,
            workspace_root: wsRoot,
            trees_dir: tc.dir,
            kind: tc.kind,
            is_isolated: isIsolated
          });
          break;
        }
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
            trees.push({
              tree_id: state.tree_id || name,
              workspace_slug: workspaceSlug,
              created_at: state.created_at,
              last_heartbeat: state.last_heartbeat,
              mtime_ms: mtimeMs,
              has_active_leaf: hasActiveLeaf,
              root_brief: state.root_brief,
              root_dod: state.root_dod,
              leaves,
              _meta: state._meta || {}
            });
          } catch (e) {
            trees.push({ tree_id: name, workspace_slug, error: "parse failed: " + e.message });
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
  ipcMain.on("proma:navigate-to-session", (event, sessionId) => {
    try {
      const bw = electron.BrowserWindow && electron.BrowserWindow.fromWebContents(event.sender);
      if (bw) {
        // 验证 session 存在（避免切换到不存在的 session）
        try {
          const a = api();
          const meta = a.getAgentSessionMeta(sessionId);
          if (!meta) {
            log("[Patch L] navigate-to-session: session " + sessionId + " not found (可能是 Chat 会话或测试数据)");
            bw.webContents.send("proma:navigate-failed", { sessionId, reason: "not-found" });
            return;
          }
        } catch (_) {}
        // 真正切换: 复用 Proma 的 tray:open-agent-session 事件
        bw.webContents.send("tray:open-agent-session", { sessionId });
        log("[Patch L] navigate-to-session: " + sessionId);
      }
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
      return JSON.parse(fs.readFileSync(TAO_CONFIG_PATH, "utf8"));
    }
  } catch (e) {
    log("[Patch M] config load failed: " + (e && e.message));
  }
  return {
    enabled: false,
    interval_seconds: 300,
    stale_tree_hours: 24,
    nudge_send_limit: 2,
    workspace_overrides: {},
    rules_enabled: []
  };
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
      const staleMs = (cfg.stale_tree_hours || 24) * 3600 * 1000;
      const now = Date.now();

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
// checkAllRules: 对 tree 跑所有适用规则
// ============================================================

async function checkAllRules(tree, workspace, cfg) {
  const all = [];
  const rulesEnabled = (cfg.rules_enabled && cfg.rules_enabled.length > 0) ? cfg.rules_enabled : null;

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
  maybe("R-03", ruleR03, tree);
  maybe("R-04", ruleR04, tree);
  maybe("R-05", ruleR05, tree);
  maybe("R-06", ruleR06, tree);
  for (const leaf of Object.values(tree.state.leaves)) {
    maybe("C-02", ruleC02, leaf, tree);
    maybe("C-03", ruleC03, leaf, tree);
    maybe("C-06", ruleC06, leaf, tree);
    maybe("C-13", ruleC13, leaf, tree);
  }

  // Tier 2 (IPC)
  for (const leaf of Object.values(tree.state.leaves)) {
    // 只对活跃 leaf 跑 IPC 规则
    if (!["active", "pending_brief", "segment_pending"].includes(leaf.status)) continue;
    maybe("W-01", ruleW01, leaf, tree);
    maybe("W-08", ruleW08, leaf, tree);
    maybe("W-11", ruleW11, leaf, tree);
    maybe("W-12", ruleW12, leaf, tree);
    maybe("C-11", ruleC11, leaf, tree);
    maybe("C-15", ruleC15, leaf, tree);
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

    // 写 audit_log (区别于 nudge_log: audit_log 是审计结果, nudge_log 是鞭策)
    if (!Array.isArray(leaf.audit_log)) leaf.audit_log = [];
    leaf.audit_log.push({
      ts: new Date().toISOString(),
      auditor: "tao-watcher-script",
      rule_id: violation.rule_id,
      pass: false,
      evidence: violation.evidence,
      degraded: false  // 脚本检查不算 degraded
    });

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

// W-08: Worker 没跑 tree-state.js 写命令 (v0.1 检查 user 消息中的 bash 命令调用)
function ruleW08(leaf, tree) {
  if (leaf.role !== "worker") return [];
  const msgs = readLeafMessages(leaf.session_id, 50);
  if (msgs.length === 0) return [];
  // 找 user 角色的 tool_use 调用, 检查是否含 tree-state.js 写命令
  const writeCmds = /tree-state\.js\s+(leaf\s+add|leaf\s+set-status|milestone\s+add|milestone\s+set-result|event\s+append|drift\s+append|heartbeat\s+append|segment\s+append|init|backup|restore)/i;
  for (const m of msgs) {
    const text = msgText(m);
    if (writeCmds.test(text)) {
      return [{ rule_id: "W-08", leaf_id: leaf.leaf_id, severity: "high",
        evidence: "worker 会话含 tree-state.js 写命令调用 (违反 leaf purity)",
        suggest: "Worker 不应直接修改 tree-state, 通过 send_message 上报让 Commander 操作" }];
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

// C-11: Commander 没直接 Read/Write tree-state.json (检查 tool_use)
function ruleC11(leaf, tree) {
  if (leaf.role !== "commander" && leaf.role !== "root") return [];
  const msgs = readLeafMessages(leaf.session_id, 80);
  if (msgs.length === 0) return [];
  // S5 修复: 精确匹配 .json (非 .js) + 排除 CLI 调用
  // 违规模式: Read/Write/Edit 直接操作 tree-state.json (注意 .json 必须紧跟, 不能是 .js)
  // CLI 合法: node tree-state.js xxx 或 tree-state.js <子命令>
  const directAccessPattern = /\b(?:Read|Write|Edit)\b[^\n]{0,200}\btree-state\.json\b(?!s\b)/i;
  const cliCallPattern = /\b(?:node\s+)?tree-state\.js\s+(?:leaf|milestone|event|drift|heartbeat|segment|init|backup|restore|validate|migrate|audit|nudge)\b/i;
  for (const m of msgs) {
    const text = msgText(m);
    if (directAccessPattern.test(text) && !cliCallPattern.test(text)) {
      return [{ rule_id: "C-11", leaf_id: leaf.leaf_id, severity: "mid",
        evidence: "commander/root 直接 Read/Write tree-state.json (违反 Leaf Purity)",
        suggest: "状态变更必须走 tree-state.js CLI 子命令, 不直接读写文件" }];
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
      manager_started: taoWatcherManager.started,
      watchers: taoWatcherManager.status().watchers
    };
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
    for (const k of ["enabled", "interval_seconds", "stale_tree_hours", "nudge_send_limit", "workspace_overrides", "rules_enabled"]) {
      if (k in arg) cfg[k] = arg[k];
    }
    saveTaoConfig(cfg);
    if (cfg.enabled) taoWatcherManager.reload();
    return { ok: true, config: cfg };
  });

  log("[Patch M] Watcher IPC registered: proma:watcher-status / toggle / set-interval / run-now / config-patch");
})();

