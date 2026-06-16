"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function readPort() {
  const portFile = path.join(os.homedir(), ".proma-dev", "mcp-bridge-port.json");
  try { const cfg = JSON.parse(fs.readFileSync(portFile, "utf-8")); if (cfg.port >= 19876 && cfg.port <= 19895) return cfg.port; } catch (_) {}
  return 19876;
}
let PORT = readPort();

function callTool(name, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(args || {});
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/" + name, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 600000 }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({ error: "Invalid JSON: " + d.slice(0, 200) }); } });
    });
    req.on("error", (e) => reject(new Error(`Cannot reach Proma (${e.message}). Is Proma-dev running?`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out (10 min)")); });
    req.write(body); req.end();
  });
}

const TOOLS = [
  { name: "get_my_session_id", description: "Get YOUR CURRENT session ID.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "list_channels", description: "List all configured AI channels and models.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "list_workspaces", description: "List all agent workspaces.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "list_sessions", description: "List all sessions with metadata.", inputSchema: { type: "object", properties: { include_archived: { type: "boolean" }, workspace_id: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_session_info", description: "Get detailed session info.", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } },
  { name: "get_session_context", description: "Get token usage/context window.", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } },
  { name: "list_messages", description: "List message history with UUIDs.", inputSchema: { type: "object", properties: { session_id: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: ["session_id"] } },
  { name: "create_session", description: "Create a new session.", inputSchema: { type: "object", properties: { channel_id: { type: "string" }, model_id: { type: "string" }, title: { type: "string" }, workspace_id: { type: "string" } }, required: ["channel_id"] } },
  { name: "fork_session", description: "Fork an existing session.", inputSchema: { type: "object", properties: { source_session_id: { type: "string" }, up_to_message_uuid: { type: "string" }, title: { type: "string" }, new_channel_id: { type: "string" }, new_model_id: { type: "string" }, new_workspace_id: { type: "string" } }, required: ["source_session_id"] } },
  { name: "send_message", description: "Send message to a session (wait=true returns reply).", inputSchema: { type: "object", properties: { session_id: { type: "string" }, message: { type: "string" }, wait: { type: "boolean" }, notify: { type: "boolean" }, model_id: { type: "string" }, channel_id: { type: "string" } }, required: ["session_id", "message"] } },
];
const SERVER_INFO = { name: "proma-session", version: "1.0.0" };

const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", (line) => { try { const msg = JSON.parse(line); handle(msg); } catch (_) {} });
rl.on("close", () => process.exit(0));

function send(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function sendError(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;
  try {
    switch (method) {
      case "initialize": return send(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      case "tools/list": return send(id, { tools: TOOLS });
      case "tools/call": const result = await callTool(params.name, params.arguments || {}); return send(id, result);
      default: return sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) { return sendError(id, -32603, e instanceof Error ? e.message : String(e)); }
}

process.stderr.write(`[proma-mcp-server] Bridge port: ${PORT}\n`);
process.stderr.write(`[proma-mcp-server] Ready. 10 tools available.\n`);