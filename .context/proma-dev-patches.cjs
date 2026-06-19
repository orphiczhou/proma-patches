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

function remoteHttpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port, path: "/" + path, method: "GET",
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

function remoteHttpPost(port, toolName, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args || {});
    const buf = Buffer.from(body, "utf-8");
    const req = http.request({
      hostname: "127.0.0.1", port, path: "/" + toolName, method: "POST",
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

let instancePortCache = {};

async function discoverRemoteInstance(instanceName) {
  if (instancePortCache[instanceName]) return instancePortCache[instanceName];
  for (let p = PORT_START; p <= PORT_END; p++) {
    try {
      const info = await remoteHttpGet(p, "get_instance_info");
      if (info && info.instance === instanceName) {
        instancePortCache[instanceName] = p;
        return p;
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
          instancePortCache[instanceName] = p;
          return p;
        }
      } catch (_) { /* port not available */ }
    }
  }
  throw new Error(`No instance named '${instanceName}' found (scanned ${PORT_START}-${PORT_END})`);
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

  };
}

// ---- 远端 Session MCP Server（通过 HTTP 代理到其他 Proma 实例）----
function createRemoteToolHandlers() {
  return {
    remote_list_channels: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "list_channels", {});
      return jsonResult(result);
    },
    remote_list_workspaces: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "list_workspaces", {});
      return jsonResult(result);
    },
    remote_list_sessions: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "list_sessions", args);
      return jsonResult(result);
    },
    remote_get_session_info: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "get_session_info", args);
      return jsonResult(result);
    },
    remote_get_session_context: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "get_session_context", args);
      return jsonResult(result);
    },
    remote_list_messages: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "list_messages", args);
      return jsonResult(result);
    },
    remote_create_session: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "create_session", args);
      return jsonResult(result);
    },
    remote_fork_session: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "fork_session", {
        source_session_id: args.source_session_id,
        up_to_message_uuid: args.up_to_message_uuid,
        title: args.title,
        new_channel_id: args.new_channel_id,
        new_model_id: args.new_model_id,
        new_workspace_id: args.new_workspace_id,
      });
      return jsonResult(result);
    },
    remote_send_message: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "send_message", {
        session_id: args.session_id,
        message: args.message,
        wait: args.wait !== false,
        model_id: args.model_id,
        channel_id: args.channel_id,
      });
      return jsonResult(result);
    },
    remote_archive_session: async (args) => {
      const port = await discoverRemoteInstance(args.instance);
      const result = await remoteHttpPost(port, "archive_session", args);
      return jsonResult(result);
    },
    remote_get_my_session_id: async (args) => {
      return jsonResult({
        session_id: null,
        is_remote: true,
        instance: args.instance,
        hint: "This is a remote instance call. session_id is always null for remote operations.",
      });
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

      server.listen(port, "127.0.0.1", () => resolve(server));
    });
  }

  (async () => {
    for (let p = PORT_START; p <= PORT_END; p++) {
      try {
        const server = await startServer(p);
        log(`External MCP HTTP bridge: http://127.0.0.1:${p} (instance: ${instanceName})`);
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

log("Agent session management MCP tools loaded (11 tools: get_my_session_id, list_channels, list_workspaces, list_sessions, get_session_info, get_session_context, list_messages, create_session, fork_session, send_message, archive_session) + 11 remote-session tools");
log("External MCP bridge available (use instance auto-discovery on ports 19876-19895)");
