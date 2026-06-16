"use strict";
// Proma Dev Patches — Agent Session Management MCP Tools
// 提供 10 个会话管理 MCP 工具
const { randomUUID } = require("node:crypto");
const path = require("path");
const fs = require("fs");

const LOG_PREFIX = "[proma-dev-patches]";

function log(msg) {
  console.log(`${LOG_PREFIX} ${msg}`);
}

function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function api() {
  if (!global.__proma__) throw new Error("Plugin API bridge not initialized (global.__proma__ missing)");
  return global.__proma__;
}

function createToolHandlers(sourceSessionId) {
  return {

    get_my_session_id: async (_args) => {
      return jsonResult({
        session_id: sourceSessionId || null,
        is_external: !sourceSessionId,
        hint: sourceSessionId ? "This is your own session ID." : "No session ID available (external MCP caller).",
      });
    },

    list_channels: async (_args) => {
      const a = api();
      const channels = a.listChannels();
      return jsonResult({
        channels: channels.map(c => ({
          id: c.id, name: c.name, provider: c.provider, enabled: !!c.enabled,
          agent_models: (c.models || []).filter(m => m.enabled !== false).map(m => ({ id: m.id, name: m.name })),
        })),
      });
    },

    list_workspaces: async (_args) => {
      const a = api();
      const workspaces = a.listAgentWorkspaces();
      return jsonResult({
        workspaces: workspaces.map(w => ({
          id: w.id, name: w.name, slug: w.slug, created_at: w.createdAt, updated_at: w.updatedAt,
        })),
      });
    },

    list_sessions: async (args) => {
      const a = api();
      let all = a.listAgentSessions();
      all = args.include_archived ? all : all.filter(s => !s.archived);
      if (args.workspace_id) all = all.filter(s => s.workspaceId === args.workspace_id);
      const limited = all.slice(0, args.limit ?? 50);
      const wsNames = {};
      try { const wss = a.listAgentWorkspaces(); wss.forEach(w => { wsNames[w.id] = w.name; }); } catch (_) {}
      return jsonResult({
        count: limited.length, total: all.length,
        sessions: limited.map(s => ({
          id: s.id, title: s.title, channel_id: s.channelId, model_id: s.modelId,
          workspace_id: s.workspaceId, workspace_name: wsNames[s.workspaceId] || null,
          pinned: !!s.pinned, archived: !!s.archived, permission_mode: s.permissionMode,
          created_at: s.createdAt, updated_at: s.updatedAt,
        })),
      });
    },

    get_session_info: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` });
      let channelInfo = null, workspaceInfo = null;
      if (meta.channelId) { const ch = a.getChannelById(meta.channelId); if (ch) channelInfo = { id: ch.id, name: ch.name, provider: ch.provider }; }
      if (meta.workspaceId) { const ws = a.getAgentWorkspace(meta.workspaceId); if (ws) workspaceInfo = { id: ws.id, name: ws.name, slug: ws.slug }; }
      return jsonResult({
        id: meta.id, title: meta.title, channel_id: meta.channelId, model_id: meta.modelId,
        channel: channelInfo, workspace: workspaceInfo, pinned: !!meta.pinned, archived: !!meta.archived,
        permission_mode: meta.permissionMode, attached_directories: meta.attachedDirectories || [],
        attached_files: meta.attachedFiles || [], created_at: meta.createdAt, updated_at: meta.updatedAt,
      });
    },

    get_session_context: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` });
      let configContextWindow = null, configModelName = null;
      if (meta.channelId && meta.modelId) {
        try { const ch = a.getChannelById(meta.channelId); if (ch?.models) { const cm = ch.models.find(m => m.id === meta.modelId); if (cm) { configModelName = cm.name || meta.modelId; configContextWindow = cm.contextWindow || null; } } } catch (_) {}
      }
      let usage = null, lastModel = null, contextWindow = null, fallbackMsg = null;
      try {
        const msgs = a.getAgentSessionSDKMessages(args.session_id);
        if (msgs?.length) for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].type === "result") {
            usage = msgs[i].usage || null;
            const mu = msgs[i].modelUsage; if (mu) { const keys = Object.keys(mu); if (keys.length > 0) { lastModel = keys[0]; contextWindow = mu[lastModel].contextWindow || null; } }
            break;
          }
          if (msgs[i]._errorCode === "billing_error" && !fallbackMsg) fallbackMsg = "Last turn failed: billing error.";
        }
      } catch (_) {}
      if (!contextWindow) contextWindow = configContextWindow;
      if (!lastModel) lastModel = configModelName || meta.modelId;
      if (!usage) return jsonResult({ session_id: args.session_id, title: meta.title, model: lastModel || null, context_window: contextWindow, message: fallbackMsg || "No usage data yet." });
      const input = usage.input_tokens || 0, output = usage.output_tokens || 0, cache = (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      const pct = contextWindow ? ((input + output + cache) / contextWindow * 100).toFixed(1) + '%' : null;
      return jsonResult({ session_id: args.session_id, title: meta.title, model: lastModel, context_window: contextWindow, usage: { input_tokens: input, output_tokens: output, cache_tokens: cache, total: input + output + cache, usage_pct: pct } });
    },

    list_messages: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Session not found: ${args.session_id}` });
      try {
        const msgs = a.getAgentSessionSDKMessages(args.session_id);
        if (!msgs?.length) return jsonResult({ session_id: args.session_id, messages: [], count: 0, total: 0 });
        const offset = args.offset ?? 0, limit = Math.min(args.limit ?? 50, 200);
        const slice = msgs.slice(offset, offset + limit);
        return jsonResult({ session_id: args.session_id, count: slice.length, total: msgs.length, offset, messages: slice.map((m, i) => {
          const entry = { index: offset + i, type: m.type, uuid: m.uuid || null, timestamp: m._createdAt || m.timestamp || null, role: (m.message?.role) || (m.type === "user" ? "user" : m.type === "assistant" ? "assistant" : null) };
          if (m.type === "result") { entry.subtype = m.subtype || null; entry.duration_ms = m.duration_ms || null; if (m.usage) entry.usage = { input_tokens: m.usage.input_tokens || 0, output_tokens: m.usage.output_tokens || 0, cache_tokens: (m.usage.cache_read_input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0) }; if (m.result) entry.result_text = String(m.result).slice(0, 500); }
          if (m.message?.content) { const ts = m.message.content.filter(c => c.type === "text" && c.text).map(c => c.text); if (ts.length > 0) { entry.text = ts.join("\n").slice(0, 500); entry.text_full_length = ts.join("\n").length; } }
          if (m._errorCode) entry.error_code = m._errorCode;
          return entry;
        }) });
      } catch (err) { return jsonResult({ error: `Read failed: ${err instanceof Error ? err.message : String(err)}` }); }
    },

    create_session: async (args) => {
      const a = api();
      const channel = a.getChannelById(args.channel_id);
      if (!channel) return jsonResult({ error: `Channel not found: "${args.channel_id}".` });
      let modelId = args.model_id;
      if (!modelId) { const first = (channel.models || []).find(m => m.enabled !== false); if (first) modelId = first.id; }
      if (!modelId) return jsonResult({ error: `No enabled models for channel "${channel.name}".` });
      try {
        const meta = a.createAgentSession(args.title, args.channel_id, args.workspace_id, modelId);
        log(`Session created: ${meta.id.slice(0, 8)}`);
        return jsonResult({ session: { id: meta.id, title: meta.title, channel_id: meta.channelId, model_id: meta.modelId, workspace_id: meta.workspaceId, created_at: meta.createdAt }, message: `Created: ${meta.title}` });
      } catch (err) { return jsonResult({ error: `Failed: ${err instanceof Error ? err.message : String(err)}` }); }
    },

    fork_session: async (args) => {
      const a = api();
      const source = a.getAgentSessionMeta(args.source_session_id);
      if (!source) return jsonResult({ error: `Source not found: "${args.source_session_id}".` });
      if (!source.sdkSessionId) return jsonResult({ error: `Cannot fork: no SDK session yet.` });
      try {
        const forked = await a.forkAgentSession({ sessionId: args.source_session_id, upToMessageUuid: args.up_to_message_uuid });
        const updates = {}; if (args.title) updates.title = args.title; if (args.new_channel_id) updates.channelId = args.new_channel_id; if (args.new_model_id) updates.modelId = args.new_model_id; if (args.new_workspace_id) updates.workspaceId = args.new_workspace_id;
        if (Object.keys(updates).length > 0) { a.updateAgentSessionMeta(forked.id, updates); Object.assign(forked, updates); }
        log(`Session forked: ${forked.id.slice(0, 8)}`);
        return jsonResult({ session: { id: forked.id, title: forked.title, channel_id: forked.channelId, model_id: forked.modelId, workspace_id: forked.workspaceId, source_session_id: args.source_session_id, created_at: forked.createdAt }, message: `Forked: ${forked.title}` });
      } catch (err) { const msg = err instanceof Error ? err.message : String(err); return jsonResult({ error: `Fork failed: ${msg}` }); }
    },

    send_message: async (args) => {
      const a = api();
      const meta = a.getAgentSessionMeta(args.session_id);
      if (!meta) return jsonResult({ error: `Target not found: "${args.session_id}".` });
      const channelId = args.channel_id || meta.channelId; if (!channelId) return jsonResult({ error: "No channel available." });
      const modelId = args.model_id || meta.modelId, shouldWait = args.wait !== false, shouldNotify = args.notify === true;
      if (shouldNotify && !sourceSessionId) return jsonResult({ error: "notify=true not supported from external MCP." });
      let sourceChannelId = null;
      if (shouldNotify && sourceSessionId) { const sm = a.getAgentSessionMeta(sourceSessionId); sourceChannelId = sm?.channelId; }
      try {
        const result = await new Promise((resolve, reject) => {
          a.runAgentHeadless({ sessionId: args.session_id, userMessage: args.message, channelId, modelId, workspaceId: meta.workspaceId, permissionModeOverride: "bypassPermissions" }, {
            onComplete: () => { if (shouldNotify && sourceSessionId && sourceChannelId) try { a.runAgentHeadless({ sessionId: sourceSessionId, userMessage: `[通知] 目标已完成: ${meta.title}`, channelId: sourceChannelId, permissionModeOverride: "bypassPermissions" }, { onComplete: () => {}, onError: () => {}, onTitleUpdated: () => {} }); } catch (_) {} if (shouldWait) resolve({ status: "completed" }); },
            onError: (errMsg) => { if (shouldWait) reject(new Error(errMsg)); },
            onTitleUpdated: (title) => { try { a.updateAgentSessionMeta(args.session_id, { title }); } catch (_) {} },
          });
          if (!shouldWait) resolve({ status: "started" });
        });
        if (result.status === "started") return jsonResult({ session_id: args.session_id, status: "started", notify: shouldNotify });
        let replyText = null;
        try { const msgs = a.getAgentSessionSDKMessages(args.session_id); if (msgs?.length) for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m.type === "assistant" && m.message?.content) { const ts = m.message.content.filter(c => c.type === "text").map(c => c.text); if (ts.length > 0) { replyText = ts.join("\n"); break; } } if (m.type === "result" && m.result) { replyText = String(m.result); break; } } } catch (_) {}
        return jsonResult({ session_id: args.session_id, status: "completed", reply: replyText });
      } catch (err) { return jsonResult({ session_id: args.session_id, status: "error", error: err instanceof Error ? err.message : String(err) }); }
    },

  };
}

function createSessionMcpServer(sdk, z, sourceSessionId) {
  const h = createToolHandlers(sourceSessionId);
  const server = sdk.createSdkMcpServer({ name: "session", version: "1.0.0", tools: [
    sdk.tool("get_my_session_id", "Get YOUR CURRENT session ID.", {}, h.get_my_session_id, { annotations: { readOnlyHint: true } }),
    sdk.tool("list_channels", "List all configured AI channels and models.", {}, h.list_channels, { annotations: { readOnlyHint: true } }),
    sdk.tool("list_workspaces", "List all agent workspaces.", {}, h.list_workspaces, { annotations: { readOnlyHint: true } }),
    sdk.tool("list_sessions", "List all agent sessions with metadata.", { include_archived: z.boolean().optional(), workspace_id: z.string().optional(), limit: z.number().min(1).max(200).optional() }, h.list_sessions, { annotations: { readOnlyHint: true } }),
    sdk.tool("get_session_info", "Get detailed session info.", { session_id: z.string() }, h.get_session_info, { annotations: { readOnlyHint: true } }),
    sdk.tool("get_session_context", "Get token usage/context window.", { session_id: z.string() }, h.get_session_context, { annotations: { readOnlyHint: true } }),
    sdk.tool("list_messages", "List message history with UUIDs.", { session_id: z.string(), limit: z.number().min(1).max(200).optional(), offset: z.number().min(0).optional() }, h.list_messages, { annotations: { readOnlyHint: true } }),
    sdk.tool("create_session", "Create a new session.", { channel_id: z.string(), model_id: z.string().optional(), title: z.string().optional(), workspace_id: z.string().optional() }, h.create_session),
    sdk.tool("fork_session", "Fork an existing session.", { source_session_id: z.string(), up_to_message_uuid: z.string().optional(), title: z.string().optional(), new_channel_id: z.string().optional(), new_model_id: z.string().optional(), new_workspace_id: z.string().optional() }, h.fork_session),
    sdk.tool("send_message", "Send message to a session.", { session_id: z.string(), message: z.string(), wait: z.boolean().optional(), notify: z.boolean().optional(), model_id: z.string().optional(), channel_id: z.string().optional() }, h.send_message),
  ]});
  return server;
}

function createExternalHttpBridge() {
  const http = require("node:http");
  const handlers = createToolHandlers(null);
  const PORT_START = 19876, PORT_END = 19895;
  const portFile = path.join(require("os").homedir(), ".proma-dev", "mcp-bridge-port.json");
  function startServer(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }); return res.end(); }
        const toolName = (req.url || "/").slice(1).split("?")[0];
        const handler = handlers[toolName];
        if (!handler) { res.writeHead(404); return res.end(JSON.stringify({ error: `Unknown tool: ${toolName}` })); }
        if (req.method !== "POST") { res.writeHead(405); return res.end(JSON.stringify({ error: "Use POST." })); }
        let body = ""; req.on("data", c => body += c); req.on("end", async () => {
          try { let args = {}; try { args = JSON.parse(body || "{}"); } catch (_) {} const result = await handler(args); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result)); }
          catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
      });
      server.on("error", e => { if (e.code === "EADDRINUSE") reject(e); });
      server.listen(port, "127.0.0.1", () => resolve(server));
    });
  }
  (async () => {
    for (let p = PORT_START; p <= PORT_END; p++) {
      try { const server = await startServer(p); fs.mkdirSync(path.dirname(portFile), { recursive: true }); fs.writeFileSync(portFile, JSON.stringify({ port: p })); log(`External MCP: http://127.0.0.1:${p}`); return; }
      catch (e) { if (e.code === "EADDRINUSE") continue; log(`HTTP bridge error: ${e.message}`); return; }
    }
    log(`ERROR: No free port in ${PORT_START}-${PORT_END}`);
  })();
}

global.__proma_getMcpServers__ = function (sessionId, workspaceSlug, sdk) {
  try { let z; try { z = require("zod").z || require("zod"); } catch(_) { z = null; } if (!z) return undefined; const server = createSessionMcpServer(sdk, z, sessionId); return { session: server }; }
  catch (err) { log(`ERROR: ${err.message}`); return undefined; }
};

createExternalHttpBridge();
log("10 tools: get_my_session_id, list_channels, list_workspaces, list_sessions, get_session_info, get_session_context, list_messages, create_session, fork_session, send_message");
log("External MCP bridge available");