"use strict";
// Proma External MCP Server — stdio ↔ HTTP bridge
// 零外部依赖，手动实现 MCP JSON-RPC over stdio
// 用法：node D:\Proma-dev\resources\app\dist\proma-mcp-server.cjs
// Claude Code 配置: { "proma-session": { "command": "node", "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs"] } }

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ---- 读取 HTTP bridge 端口 ----
function readPort() {
  const portFile = path.join(os.homedir(), ".proma-dev", "mcp-bridge-port.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(portFile, "utf-8"));
    if (cfg.port && cfg.port >= 19876 && cfg.port <= 19895) return cfg.port;
  } catch (_) { /* fall through */ }
  return 19876; // 默认（bridge 未启动时用默认端口）
}

let PORT = readPort();

// ---- HTTP 调用 ----
function callTool(name, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args || {});
    const req = http.request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/" + name,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 600000, // 10 分钟超时（send_message wait=true 可能很长）
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve({ error: "Invalid JSON response: " + data.slice(0, 200) }); }
      });
    });
    req.on("error", (e) => {
      reject(new Error(`Cannot reach Proma HTTP bridge (${e.message}). Is Proma-dev running?`));
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out (10 min)"));
    });
    req.write(body);
    req.end();
  });
}

// ---- 7 个工具定义 ----
const TOOLS = [
  {
    name: "get_my_session_id",
    description: "Get YOUR CURRENT session ID. Use this to reference yourself when checking context, listing messages, or passing your ID for async callbacks.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_channels",
    description: "List all configured AI channels and their available agent models. Use this FIRST before creating a session to find valid channel_id and model_id values.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_workspaces",
    description: "List all agent workspaces. Use this to find workspace IDs for create_session / fork_session / list_sessions filtering.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_sessions",
    description: "List all agent sessions with their metadata (title, channel, model, workspace name/ID, archived status).",
    inputSchema: {
      type: "object",
      properties: {
        include_archived: { type: "boolean", description: "Include archived sessions (default: false)" },
        workspace_id: { type: "string", description: "Filter by workspace ID (from list_workspaces). Omit to see all workspaces." },
        limit: { type: "number", description: "Max results to return (default: 50, max: 200)" },
      },
    },
  },
  {
    name: "get_session_info",
    description: "Get detailed information about a specific agent session, including its channel name, provider, and workspace.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string", description: "The session ID to look up" } },
      required: ["session_id"],
    },
  },
  {
    name: "get_session_context",
    description: "Get the CURRENT context/token usage of an agent session. Returns input tokens, output tokens, total tokens, and context window size from the latest message.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string", description: "The session ID to check context usage for." } },
      required: ["session_id"],
    },
  },
  {
    name: "list_messages",
    description: "List messages (conversation history) for an agent session. Each message includes its UUID (use with fork_session), role, timestamp, and text content.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "The session ID to list messages for." },
        limit: { type: "number", description: "Max messages to return (default: 50, max: 200)" },
        offset: { type: "number", description: "Skip first N messages for pagination (default: 0)" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "create_session",
    description: "Create a NEW agent session with specified channel and model. The session will appear in the Proma sidebar after manual refresh. Use list_channels first to get valid channel/model IDs.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Channel ID (from list_channels). Determines which AI provider/API to use." },
        model_id: { type: "string", description: "Model ID within the channel. If omitted, the first enabled agent model is used." },
        title: { type: "string", description: "Session display title. Auto-generated if omitted." },
        workspace_id: { type: "string", description: "Workspace ID to associate. Uses current workspace if omitted." },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "fork_session",
    description: "FORK (clone) an existing agent session, preserving all conversation context up to the specified point. The forked session retains the source's workspace files and message history. Use list_sessions first to find the source session ID.",
    inputSchema: {
      type: "object",
      properties: {
        source_session_id: { type: "string", description: "ID of the source session to fork (from list_sessions)." },
        up_to_message_uuid: { type: "string", description: "SDK message UUID to fork at (inclusive). Omit to fork at the latest message (full copy)." },
        title: { type: "string", description: "Custom title for the forked session. Default: '<original title> (fork)'" },
        new_channel_id: { type: "string", description: "Override: use a different channel for the forked session." },
        new_model_id: { type: "string", description: "Override: use a different model for the forked session." },
        new_workspace_id: { type: "string", description: "Override: use a different workspace for the forked session." },
      },
      required: ["source_session_id"],
    },
  },
  {
    name: "send_message",
    description: "Send a user message to an EXISTING agent session for autonomous processing. Three modes:\n- wait=true (default): blocks until target completes, returns result with \"reply\" field containing the assistant's final response text.\n- notify=true: fire-and-forget, but when target finishes, pushes a notification message back to the calling session (async callback). NOTE: notify=true is not supported from external MCP.\n- neither: pure fire-and-forget, no notification.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Target session ID to send the message to." },
        message: { type: "string", description: "The user message / task to send to the session." },
        wait: { type: "boolean", description: "Wait for target to complete before returning (default: true)." },
        notify: { type: "boolean", description: "When target completes, push a notification back to the calling session (async callback). Not supported externally." },
        model_id: { type: "string", description: "Model ID override." },
        channel_id: { type: "string", description: "Channel ID override." },
      },
      required: ["session_id", "message"],
    },
  },
];

const SERVER_INFO = { name: "proma-session", version: "1.0.0" };

// ---- MCP JSON-RPC over stdio ----
const rl = require("node:readline").createInterface({ input: process.stdin });
let buf = "";

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    handle(msg);
  } catch (_) { /* 忽略非 JSON 行 */ }
});

rl.on("close", () => {
  process.exit(0);
});

function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;

  // 通知类消息不需要回复
  if (id === undefined || id === null) {
    if (method === "notifications/initialized") {
      // 客户端确认初始化完成，无需操作
    }
    return;
  }

  try {
    switch (method) {
      case "initialize":
        return send(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case "tools/list":
        return send(id, { tools: TOOLS });

      case "tools/call": {
        const toolName = params.name;
        const toolArgs = params.arguments || {};
        const result = await callTool(toolName, toolArgs);
        return send(id, result);
      }

      default:
        return sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return sendError(id, -32603, e instanceof Error ? e.message : String(e));
  }
}

// 向 stderr 输出启动信息（stdio 的 stdout 被 MCP 协议独占）
process.stderr.write(`[proma-mcp-server] Bridge port: ${PORT}\n`);
process.stderr.write(`[proma-mcp-server] Ready. 10 tools available.\n`);
