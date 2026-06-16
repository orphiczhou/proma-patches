"use strict";
// Proma Dev Patches — Agent Session Management MCP Tools
// 提供 list_channels / list_sessions / get_session_info / get_session_context
//    create_session / fork_session / send_message
const { randomUUID } = require("node:crypto");
const path = require("path");
const fs = require("fs");

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

    list_sessions: async (args) => {
      const a = api();
      const all = a.listAgentSessions();
      const filtered = args.include_archived ? all : all.filter(s => !s.archived);
      const limited = filtered.slice(0, args.limit ?? 50);
      return jsonResult({
        count: limited.length,
        total: filtered.length,
        sessions: limited.map(s => ({
          id: s.id,
          title: s.title,
          channel_id: s.channelId,
          model_id: s.modelId,
          workspace_id: s.workspaceId,
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
        const forked = await a.forkAgentSession({
          sessionId: args.source_session_id,
          upToMessageUuid: args.up_to_message_uuid,
        });

        const updates = {};
        if (args.title) updates.title = args.title;
        if (args.new_channel_id) updates.channelId = args.new_channel_id;
        if (args.new_model_id) updates.modelId = args.new_model_id;
        if (args.new_workspace_id) updates.workspaceId = args.new_workspace_id;

        if (Object.keys(updates).length > 0) {
          a.updateAgentSessionMeta(forked.id, updates);
          Object.assign(forked, updates);
        }

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
        require("fs").appendFileSync(
          require("path").join(require("os").homedir(), ".proma-dev", "fork-debug.log"),
          JSON.stringify({ ts: new Date().toISOString(), action: "fork_error", error: msg, stack: err?.stack?.slice(0, 500) }) + "\n"
        );
        if (msg.includes("没有 SDK session") || msg.includes("session not found")) {
          return jsonResult({ error: `Fork failed: the source session may not have been started. Send a message in "${source.title}" first, then retry.` });
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
                if (shouldWait) reject(new Error(errMsg));
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

        return jsonResult({
          session_id: args.session_id,
          status: "completed",
          message: `Target session "${meta.title}" has finished processing.`,
        });
      } catch (err) {
        return jsonResult({
          session_id: args.session_id,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

  };
}

// ---- 内部 MCP Server（Agent 内部使用）----
function createSessionMcpServer(sdk, z, sourceSessionId) {
  const h = createToolHandlers(sourceSessionId);

  const server = sdk.createSdkMcpServer({
    name: "session",
    version: "1.0.0",
    tools: [

      sdk.tool(
        "list_channels",
        "List all configured AI channels and their available agent models. Use this FIRST before creating a session to find valid channel_id and model_id values.",
        {},
        h.list_channels,
        { annotations: { readOnlyHint: true } }
      ),

      sdk.tool(
        "list_sessions",
        "List all agent sessions with their metadata (title, channel, model, workspace, archived status).",
        {
          include_archived: z.boolean().optional().describe("Include archived sessions (default: false)"),
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
        "Send a user message to an EXISTING agent session for autonomous processing. Three modes:\n- wait=true (default): blocks until target completes, returns result directly.\n- notify=true: fire-and-forget, but when target finishes, pushes a notification message back to the calling session via runAgentHeadless (async callback).\n- neither: pure fire-and-forget, no notification.",
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

    ],
  });

  return server;
}

// ---- 外部 MCP HTTP Bridge（让外部 stdio MCP server 能调用 7 个工具）----
function createExternalHttpBridge() {
  const http = require("node:http");
  const handlers = createToolHandlers(null); // 外部调用无源会话

  const PORT_START = 19876;
  const PORT_END = 19895;
  const portFile = path.join(require("os").homedir(), ".proma-dev", "mcp-bridge-port.json");

  function startServer(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        // CORS for local dev
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          return res.end();
        }

        const toolName = (req.url || "/").slice(1).split("?")[0];
        const handler = handlers[toolName];

        if (!handler) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: `Unknown tool: ${toolName}` }));
        }

        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Method not allowed. Use POST." }));
        }

        let body = "";
        req.on("data", c => body += c);
        req.on("end", async () => {
          try {
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

      server.listen(port, "127.0.0.1", () => resolve(server));
    });
  }

  (async () => {
    for (let p = PORT_START; p <= PORT_END; p++) {
      try {
        const server = await startServer(p);
        fs.mkdirSync(path.dirname(portFile), { recursive: true });
        fs.writeFileSync(portFile, JSON.stringify({ port: p }));
        log(`External MCP HTTP bridge: http://127.0.0.1:${p}`);
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
    return { session: server };
  } catch (err) {
    log(`ERROR creating MCP server: ${err instanceof Error ? err.message : String(err)}`);
    console.error(err);
    return undefined;
  }
};

// ---- 启动外部 MCP HTTP bridge ----
createExternalHttpBridge();

log("Agent session management MCP tools loaded (7 tools: list_channels, list_sessions, get_session_info, get_session_context, create_session, fork_session, send_message)");
log("External MCP bridge available (read ~/.proma-dev/mcp-bridge-port.json for port)");
