#!/usr/bin/env node
/**
 * tree-state.js — 树形会话执行体系 状态访问脚本 (补丁 4)
 *
 * 设计依据: tree-commander-design.md 附录 A
 *
 * 部署位置: <workspace>/.context/trees/tree-state.js
 * 调用方式: node tree-state.js <command> [args]
 *
 * 子命令分组:
 *   Query    : leaf get | leaf list-active | leaf list-all | tree dump
 *              drift list | heartbeat tail | event list
 *   Add      : leaf add | milestone add
 *   Update   : leaf set-status | leaf set-context | leaf set-last-event
 *              leaf autonomy-override | milestone set-result
 *   Append   : event append | drift append | heartbeat append | segment append
 *   Maintain : init | backup | restore | validate
 *
 * 示例:
 *   node tree-state.js init nanju --root-brief '{"parent_intent":"..."}' --root-dod '{"deliverables":[]}'
 *   node tree-state.js leaf add nanju --json '{"leaf_id":"nanju-root","session_id":"uuid","parent":null,"path":"","role":"root","model":"claude-sonnet-4-6","channel":"anthropic"}'
 *   node tree-state.js leaf get nanju nanju-root
 *   node tree-state.js leaf list-active nanju
 *   node tree-state.js leaf set-status nanju nanju-A-eval done
 *   node tree-state.js leaf set-context nanju nanju-A-eval 47
 *   node tree-state.js leaf set-last-event nanju nanju-A-eval plan
 *   node tree-state.js leaf autonomy-override nanju nanju-A-eval --json '{"added_must_ask":["x"],"reason":"..."}'
 *   node tree-state.js milestone add nanju nanju-A-eval --json '{"id":"M1","desc":"...","expect_outputs":["flow.mmd"]}'
 *   node tree-state.js milestone set-result nanju nanju-A-eval M1 --audit-pass true --note-path docs/x.note.md
 *   node tree-state.js event append nanju nanju-A-eval --type done --json '{"deliverables":["docs/x.md"]}'
 *   node tree-state.js drift append nanju nanju-A-eval --kind production --severity high --action prune --fork-to nanju-A1b-engine
 *   node tree-state.js heartbeat append nanju --json '{"verdicts":[]}'
 *   node tree-state.js segment append nanju nanju-A-eval new-session-uuid
 *   node tree-state.js tree dump nanju
 *   node tree-state.js drift list nanju --leaf nanju-A-eval
 *   node tree-state.js heartbeat tail nanju -n 20
 *   node tree-state.js event list nanju --type plan
 *   node tree-state.js backup nanju --label before-prune
 *   node tree-state.js restore nanju tree-state.backup.1234567890.before-prune.json
 *   node tree-state.js validate nanju
 */

'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');

// ============================================================
// 常量与枚举
// ============================================================

const LOCK_TIMEOUT_MS = 10000;
const LOCK_POLL_MS = 100;
const BACKUP_EVERY_N_WRITES = 10;
const BACKUP_KEEP_RECENT = 10;

// 命名正则 (§6.5): <prefix>-<path>-<role>[-<suffix>]
// prefix 段: [a-z][a-z0-9_]{3,7} — 小写字母开头，共 4-8 字符，不含连字符
//   合法: nanju, sweng, webv3, pguide  非法: NANJU, n, proma-guide
// path 段: 可选，根 leaf (如 nanju-root) 省略 path 段和其后的分隔符
//   把可选组整体改为 `(?:([A-Z]...)?-)?` — path 段连同其后分隔符一起可选，
//   既覆盖空 path 的根 leaf，也覆盖所有非根 leaf。
const LEAF_NAME_RE = /^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$/;

// 枚举 (附录 A.8)
const STATUS_ENUM = ['active', 'done', 'pruned', 'archived', 'segment_pending'];
const EVENT_TYPE_ENUM = ['done', 'blocked', 'plan', 'brief_echo', 'heartbeat_reply', 'nudge', 'limit', 'status_check'];
const DRIFT_KIND_ENUM = ['production', 'direction', 'rhythm'];
const DRIFT_SEVERITY_ENUM = ['low', 'mid', 'high'];
const DRIFT_ACTION_ENUM = ['nudge', 'limit', 'prune', 'self_correct', 'declare', 'handoff'];

// 错误码 (附录 A.1)
const E_LOCK_TIMEOUT = 'E_LOCK_TIMEOUT';
const E_TREE_NOT_FOUND = 'E_TREE_NOT_FOUND';
const E_LEAF_NOT_FOUND = 'E_LEAF_NOT_FOUND';
const E_SCHEMA_INVALID = 'E_SCHEMA_INVALID';
const E_STATUS_INVALID = 'E_STATUS_INVALID';
const E_NAME_INVALID = 'E_NAME_INVALID';
const E_PARENT_MISSING = 'E_PARENT_MISSING';
const E_DUPLICATE_LEAF = 'E_DUPLICATE_LEAF';
const E_BACKUP_CORRUPT = 'E_BACKUP_CORRUPT';
const E_IO = 'E_IO';
const E_UNKNOWN = 'E_UNKNOWN';

// 默认 audit_meta (附录 A.7 init)
const DEFAULT_AUDIT_META = {
  plan_ack_seconds: 300,
  max_self_corrections: 2,
  heartbeat_interval_minutes: 15,
  sweet_spot_limits: {
    'claude-sonnet-4-6': { min: 100000, max: 200000, hard: 300000 },
    'deepseek-v4-pro': { min: 150000, max: 250000, hard: 400000 },
    'glm-5-turbo': { min: 50000, max: 80000, hard: 100000 }
  }
};

// 工作区根: 脚本所在目录上溯到 .context/trees（脚本本身就在 trees/ 下）
// tree-state.js 位于 <workspace>/.context/trees/tree-state.js
const TREES_ROOT = __dirname;

// ============================================================
// 工具函数
// ============================================================

class TreeStateError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowIso() {
  // 带 +08:00 时区偏移的 ISO 时间（设计示例都带 +08:00）
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - tzOffsetMs);
  // local.toISOString() 给出 YYYY-MM-DDTHH:mm:ss.sssZ
  // 改写为带时区偏移的形式
  const iso = local.toISOString();
  // 替换 Z 为本地时区偏移
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
  const mm = String(absMin % 60).padStart(2, '0');
  return iso.replace('Z', `${sign}${hh}:${mm}`);
}

function parseJsonArg(str, label) {
  if (typeof str !== 'string') {
    throw new TreeStateError(E_SCHEMA_INVALID, `${label} is required`);
  }
  try {
    return JSON.parse(str);
  } catch (e) {
    throw new TreeStateError(E_SCHEMA_INVALID, `${label} is not valid JSON: ${e.message}`);
  }
}

function assertEnum(value, enumArr, label, errCode) {
  // errCode 可选，默认 E_SCHEMA_INVALID；调用方需要区分语义时可显式传
  // （例如 status 枚举失败用 E_STATUS_INVALID，与 schema 结构错误 E_SCHEMA_INVALID 区分）
  const code = errCode || E_SCHEMA_INVALID;
  if (!enumArr.includes(value)) {
    throw new TreeStateError(
      code,
      `${label} "${value}" not in allowed enum [${enumArr.join(', ')}]`
    );
  }
}

/**
 * 解析 leaf_id 中的 path 段
 * leaf_id 格式: <prefix>-<path>-<role>[-<suffix>]
 * path 段为空时（根节点）返回空字符串
 */
function parsePathFromLeafId(leaf_id) {
  const m = LEAF_NAME_RE.exec(leaf_id);
  if (!m) return null;
  // m[2] = path 段；可能为 undefined（根节点）
  return m[2] || '';
}

// ============================================================
// 路径定位
// ============================================================

function treeDir(tree_id) {
  if (typeof tree_id !== 'string' || !tree_id.trim()) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'tree_id is required');
  }
  // 禁止 tree_id 含路径分隔符或非法字符
  if (/[\\/\s]/.test(tree_id)) {
    throw new TreeStateError(E_SCHEMA_INVALID, `tree_id "${tree_id}" contains invalid characters`);
  }
  return path.join(TREES_ROOT, tree_id);
}

function statePath(tree_id) {
  return path.join(treeDir(tree_id), 'tree-state.json');
}

function lockPath(tree_id) {
  return path.join(treeDir(tree_id), '.lock');
}

function tmpPath(tree_id) {
  return path.join(treeDir(tree_id), 'tree-state.json.tmp');
}

function assertTreeExists(tree_id) {
  const dir = treeDir(tree_id);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new TreeStateError(E_TREE_NOT_FOUND, `tree "${tree_id}" directory not found at ${dir}`);
  }
  const sp = statePath(tree_id);
  if (!fs.existsSync(sp)) {
    throw new TreeStateError(E_TREE_NOT_FOUND, `tree-state.json not found at ${sp}`);
  }
}

// ============================================================
// 读写 & 并发锁
// ============================================================

async function withLock(tree_id, fn) {
  const lp = lockPath(tree_id);
  const startTime = Date.now();

  // 确保目录存在（init 之外可能也调用到锁，但 init 会自己处理目录创建）
  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    let fd;
    let lockAcquired = false;
    try {
      fd = fs.openSync(lp, 'wx'); // 原子创建
      fs.writeSync(fd, `${process.pid}_${Date.now()}`);
      fs.closeSync(fd);
      fd = null;
      lockAcquired = true;
    } catch (e) {
      if (fd) {
        try { fs.closeSync(fd); } catch (_) {}
        fd = null;
      }
      if (e.code === 'EEXIST') {
        // 检查锁是否过期
        let staleCleared = false;
        try {
          const stat = fs.statSync(lp);
          if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS) {
            try { fs.unlinkSync(lp); } catch (_) {}
            staleCleared = true;
          }
        } catch (_) {}
        if (staleCleared) continue; // 重试
        await sleep(LOCK_POLL_MS);
        continue;
      }
      // 其他错误（如 EPERM/EACCES）—— 锁获取本身失败
      const err = new TreeStateError(E_IO, `lock acquisition failed: ${e.message}`);
      err.cause = e;
      throw err;
    }

    // 锁已拿到，执行业务（业务错误必须原样抛出，不能转成 E_IO）
    try {
      return await fn();
    } finally {
      if (lockAcquired) {
        try { fs.unlinkSync(lp); } catch (_) {}
      }
    }
  }
  throw new TreeStateError(E_LOCK_TIMEOUT, `could not acquire lock within ${LOCK_TIMEOUT_MS}ms`);
}

function readState(tree_id) {
  const sp = statePath(tree_id);
  let raw;
  try {
    raw = fs.readFileSync(sp, 'utf8');
  } catch (e) {
    throw new TreeStateError(E_IO, `failed to read tree-state.json: ${e.message}`);
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    throw new TreeStateError(E_SCHEMA_INVALID, `tree-state.json is corrupt: ${e.message}`);
  }
  return state;
}

/**
 * 原子写入 + 自动备份
 * writeCount 持久化在 state._meta.write_count（落盘到 tree-state.json）
 * 设计：调用方拿 readState 的对象自然含 _meta.write_count，
 *      writeState 递增它并落盘，下次 readState 读出后能继续累加。
 */
function writeState(tree_id, state) {
  const dir = treeDir(tree_id);
  const sp = statePath(tree_id);
  const tp = tmpPath(tree_id);

  // 维护 _meta.write_count（持久化字段，序列化时保留）
  // 兼容老数据：若 state 上残留 __write_counter（仅内存字段），把它并入 _meta 后清除
  if (!state._meta || typeof state._meta !== 'object') {
    state._meta = {};
  }
  const legacyCounter = typeof state.__write_counter === 'number' ? state.__write_counter : 0;
  const persisted = typeof state._meta.write_count === 'number' ? state._meta.write_count : 0;
  const baseCount = Math.max(legacyCounter, persisted);
  const writeCount = baseCount + 1;
  state._meta.write_count = writeCount;
  // 清理内存残留（避免老字段双写）
  if (Object.prototype.hasOwnProperty.call(state, '__write_counter')) {
    delete state.__write_counter;
  }

  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch (e) {
    throw new TreeStateError(E_SCHEMA_INVALID, `failed to serialize state: ${e.message}`);
  }

  // 1. 写 .tmp
  try {
    fs.writeFileSync(tp, serialized, 'utf8');
  } catch (e) {
    throw new TreeStateError(E_IO, `failed to write tmp file: ${e.message}`);
  }

  // 2. 原子 rename（S3: Windows 重试 3-5 次 + 指数退避）
  // Windows 上目标文件被其他进程占用时 renameSync 抛 EPERM。
  // 单次 try/catch + 清理 tmp 会丢失本次状态更新，改为重试循环。
  const MAX_RENAME_RETRIES = 5;
  const BASE_RENAME_DELAY_MS = 50;
  let renamed = false;
  for (let attempt = 0; attempt < MAX_RENAME_RETRIES; attempt++) {
    try {
      fs.renameSync(tp, sp);
      renamed = true;
      break;
    } catch (e) {
      if (e.code === 'EPERM' && attempt < MAX_RENAME_RETRIES - 1) {
        // 指数退避: 50ms / 100ms / 200ms / 400ms
        const waitUntil = Date.now() + BASE_RENAME_DELAY_MS * Math.pow(2, attempt);
        while (Date.now() < waitUntil) { /* 同步自旋等待 */ }
        continue;
      }
      // 非 EPERM 或最后一次重试失败，清理 tmp 后抛出
      try { fs.unlinkSync(tp); } catch (_) {}
      throw new TreeStateError(E_IO, `failed to rename tmp file: ${e.message}`);
    }
  }
  if (!renamed) {
    try { fs.unlinkSync(tp); } catch (_) {}
    throw new TreeStateError(E_IO, 'failed to rename tmp file after retries');
  }

  // 3. 每 N 次写自动备份（基于持久化计数器，跨进程跨命令生效）
  if (writeCount % BACKUP_EVERY_N_WRITES === 0) {
    doBackup(tree_id, 'auto');
  }
}

// ============================================================
// 备份管理
// ============================================================

function listBackups(tree_id) {
  const dir = treeDir(tree_id);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  // 备份命名: tree-state.backup.<ts_ms>.<label>.json
  const re = /^tree-state\.backup\.(\d+)\.([^.]*)\.json$/;
  const backups = [];
  for (const name of entries) {
    const m = re.exec(name);
    if (!m) continue;
    backups.push({
      name,
      ts_ms: parseInt(m[1], 10),
      label: m[2],
      full: path.join(dir, name)
    });
  }
  backups.sort((a, b) => b.ts_ms - a.ts_ms);
  return backups;
}

function doBackup(tree_id, label) {
  const safeLabel = String(label || 'manual').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  const dir = treeDir(tree_id);
  const sp = statePath(tree_id);
  const backupName = `tree-state.backup.${Date.now()}.${safeLabel}.json`;
  const backupFull = path.join(dir, backupName);

  try {
    fs.copyFileSync(sp, backupFull);
  } catch (e) {
    throw new TreeStateError(E_IO, `backup failed: ${e.message}`);
  }

  // 保留最近 N 份
  const all = listBackups(tree_id);
  if (all.length > BACKUP_KEEP_RECENT) {
    for (let i = BACKUP_KEEP_RECENT; i < all.length; i++) {
      try { fs.unlinkSync(all[i].full); } catch (_) {}
    }
  }
  return backupName;
}

// ============================================================
// 命令: init
// ============================================================

async function cmdInit(args) {
  // init <tree_id> --root-brief '<json>' --root-dod '<json>' [--audit-meta '<json>']
  const { positional, opts } = parseArgs(args);
  const tree_id = positional[0];
  if (!tree_id) throw new TreeStateError(E_SCHEMA_INVALID, 'tree_id is required');

  if (!opts['root-brief']) throw new TreeStateError(E_SCHEMA_INVALID, '--root-brief is required');
  if (!opts['root-dod']) throw new TreeStateError(E_SCHEMA_INVALID, '--root-dod is required');

  const root_brief = parseJsonArg(opts['root-brief'], 'root-brief');
  const root_dod = parseJsonArg(opts['root-dod'], 'root-dod');
  const audit_meta_override = opts['audit-meta'] ? parseJsonArg(opts['audit-meta'], 'audit-meta') : null;

  const dir = treeDir(tree_id);
  // 如果目录已存在且已有 state 文件，报错（init 只能调一次）
  const sp = statePath(tree_id);
  if (fs.existsSync(sp)) {
    throw new TreeStateError(E_DUPLICATE_LEAF, `tree "${tree_id}" already initialized at ${sp}`);
  }

  // 创建目录（递归）
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new TreeStateError(E_IO, `failed to create tree directory: ${e.message}`);
  }

  const audit_meta = Object.assign({}, DEFAULT_AUDIT_META, audit_meta_override || {});

  const state = {
    version: '1.0',
    tree_id,
    created_at: nowIso(),
    last_heartbeat: null,
    root_brief,
    root_dod,
    leaves: {},
    heartbeat_log: [],
    drift_log: [],
    audit_meta,
    // _meta 内部元数据（writeState 首次调用时填 _meta.write_count=1）
    _meta: {}
  };

  // 直接写入（用锁保护目录创建后的首次写入）
  await withLock(tree_id, () => {
    writeState(tree_id, state);
  });

  return { tree: { tree_id, created_at: state.created_at, dir } };
}

// ============================================================
// 命令: leaf add
// ============================================================

async function cmdLeafAdd(args) {
  // leaf add <tree_id> --json '<leaf_initial_json>'
  const { positional, opts } = parseArgs(args);
  const tree_id = positional[0];
  assertTreeExists(tree_id);
  if (!opts.json) throw new TreeStateError(E_SCHEMA_INVALID, '--json is required');
  const input = parseJsonArg(opts.json, 'leaf json');

  // 必填字段
  const required = ['leaf_id', 'session_id', 'parent', 'path', 'role', 'model', 'channel'];
  for (const k of required) {
    if (!(k in input)) {
      throw new TreeStateError(E_SCHEMA_INVALID, `missing required field "${k}" in leaf json`);
    }
  }

  const { leaf_id, session_id, parent, path: leafPath, role, model, channel } = input;

  // 1. 命名校验
  if (!LEAF_NAME_RE.test(leaf_id)) {
    throw new TreeStateError(E_NAME_INVALID, `leaf_id "${leaf_id}" does not match naming spec ^<prefix>-<path>-<role>[-<suffix>]$`);
  }

  // 2. path 一致性
  const parsedPath = parsePathFromLeafId(leaf_id);
  if (parsedPath !== (leafPath || '')) {
    throw new TreeStateError(E_SCHEMA_INVALID, `path "${leafPath}" does not match path segment "${parsedPath}" in leaf_id "${leaf_id}"`);
  }

  // 3. parent 校验
  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);

    if (Object.prototype.hasOwnProperty.call(state.leaves, leaf_id)) {
      throw new TreeStateError(E_DUPLICATE_LEAF, `leaf "${leaf_id}" already exists`);
    }

    if (parent !== null) {
      if (!Object.prototype.hasOwnProperty.call(state.leaves, parent)) {
        throw new TreeStateError(E_PARENT_MISSING, `parent "${parent}" does not exist in leaves`);
      }
    }

    const now = nowIso();
    const leaf = {
      leaf_id,
      session_id,
      parent,
      path: leafPath,
      role,
      model,
      channel,
      status: 'active',
      created_at: now,
      last_event_ts: null,
      last_event_type: null,
      context_usage_pct: 0,
      drift_history: [],
      milestones: [],
      segment_chain: [],
      autonomy_overrides: {},
      events: []
    };
    state.leaves[leaf_id] = leaf;

    writeState(tree_id, state);
    result = { leaf };
  });
  return result;
}

// ============================================================
// 命令: leaf get / list-active / list-all
// ============================================================

async function cmdLeafGet(args) {
  const { positional } = parseArgs(args);
  const [tree_id, leaf_id] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');

  const state = readState(tree_id);
  if (!Object.prototype.hasOwnProperty.call(state.leaves, leaf_id)) {
    throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
  }
  return { leaf: state.leaves[leaf_id] };
}

async function cmdLeafListActive(args) {
  const { positional } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const state = readState(tree_id);
  const leaves = Object.values(state.leaves)
    .filter((l) => l.status === 'active')
    .map((l) => ({
      leaf_id: l.leaf_id,
      session_id: l.session_id,
      last_event_ts: l.last_event_ts,
      context_usage_pct: l.context_usage_pct
    }));
  return { leaves };
}

async function cmdLeafListAll(args) {
  const { positional } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const state = readState(tree_id);
  const leaves = Object.values(state.leaves);
  return { leaves };
}

// ============================================================
// 命令: tree dump
// ============================================================

async function cmdTreeDump(args) {
  const { positional } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const state = readState(tree_id);
  // _meta 是内部元数据字段，dump 时保留（含 write_count 计数器）
  // 历史 __write_counter 是仅内存字段，readState 不会读出来，无需清理
  return { tree: state };
}

// ============================================================
// 命令: drift list / heartbeat tail / event list
// ============================================================

async function cmdDriftList(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const state = readState(tree_id);

  const leafFilter = opts.leaf || null;
  const since = opts.since || null;
  let sinceMs = -Infinity;
  if (since) {
    const d = new Date(since);
    if (isNaN(d.getTime())) {
      throw new TreeStateError(E_SCHEMA_INVALID, `--since "${since}" is not a valid ISO date`);
    }
    sinceMs = d.getTime();
  }

  // drift_log 顶层是数组；条目结构由 drift append 决定
  const all = Array.isArray(state.drift_log) ? state.drift_log : [];
  const filtered = all.filter((d) => {
    if (leafFilter && d.leaf_id !== leafFilter) return false;
    if (since && d.ts) {
      const t = new Date(d.ts).getTime();
      if (!isNaN(t) && t < sinceMs) return false;
    }
    return true;
  });
  return { drifts: filtered };
}

async function cmdHeartbeatTail(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const state = readState(tree_id);

  const n = parseInt(opts.n || '20', 10);
  if (isNaN(n) || n < 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, `-n "${opts.n}" is not a non-negative integer`);
  }
  const leafFilter = opts.leaf || null;

  let beats = Array.isArray(state.heartbeat_log) ? state.heartbeat_log : [];
  if (leafFilter) {
    beats = beats
      .map((b) => {
        if (b.verdicts) {
          const vs = b.verdicts.filter((v) => v.leaf_id === leafFilter);
          if (vs.length === 0) return null;
          return Object.assign({}, b, { verdicts: vs });
        }
        return b;
      })
      .filter(Boolean);
  }
  const tail = beats.slice(-n);
  return { heartbeats: tail };
}

async function cmdEventList(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const state = readState(tree_id);

  const leafFilter = opts.leaf || null;
  const typeFilter = opts.type || null;
  if (typeFilter) assertEnum(typeFilter, EVENT_TYPE_ENUM, 'event type');

  // events 存在每个 leaf.events 数组里（append 时创建）
  const out = [];
  for (const leaf of Object.values(state.leaves)) {
    if (leafFilter && leaf.leaf_id !== leafFilter) continue;
    if (!Array.isArray(leaf.events)) continue;
    for (const ev of leaf.events) {
      if (typeFilter && ev.type !== typeFilter) continue;
        out.push({
          leaf_id: leaf.leaf_id,
          type: ev.type,
          ts: ev.ts,
          meta: ev.meta
        });
    }
  }
  // 按 ts 升序
  out.sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : 0;
    const tb = b.ts ? new Date(b.ts).getTime() : 0;
    return ta - tb;
  });
  return { events: out };
}

// ============================================================
// 命令: leaf set-status
// ============================================================

async function cmdLeafSetStatus(args) {
  const { positional } = parseArgs(args);
  const [tree_id, leaf_id, new_status] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!new_status) throw new TreeStateError(E_SCHEMA_INVALID, 'new_status is required');
  // status 不在枚举内属语义级错误，用 E_STATUS_INVALID 区别于 schema 结构错误
  assertEnum(new_status, STATUS_ENUM, 'status', E_STATUS_INVALID);

  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    const leaf = state.leaves[leaf_id];
    const from = leaf.status;

    // 切到 done 时校验：milestones 必须非空 + 所有 milestones 都 audit_pass=true
    // 严格路径：契约精神要求每个宣告完成的工作都有结构骨架（§3.5 milestones 是必填项）
    if (new_status === 'done') {
      const ms = Array.isArray(leaf.milestones) ? leaf.milestones : [];
      if (ms.length === 0) {
        throw new TreeStateError(
          E_SCHEMA_INVALID,
          `cannot set status=done: milestones must be non-empty (engineering principle: every deliverable must have a structural skeleton)`
        );
      }
      for (const m of ms) {
        if (m.status !== 'done' || m.audit_pass !== true) {
          throw new TreeStateError(
            E_SCHEMA_INVALID,
            `cannot set status=done: milestone "${m.id}" is not audit_pass=true`
          );
        }
      }
    }

    leaf.status = new_status;

    // 切到 pruned/archived 时追加 drift_history
    if (new_status === 'pruned' || new_status === 'archived') {
      const driftEntry = {
        ts: nowIso(),
        kind: 'rhythm',
        severity: 'mid',
        action: new_status === 'pruned' ? 'prune' : 'declare',
        reason: `status_change from ${from} to ${new_status}`,
        leaf_id,
        from,
        to: new_status
      };
      leaf.drift_history.push(driftEntry);
      if (Array.isArray(state.drift_log)) {
        state.drift_log.push(driftEntry);
      }
    }

    writeState(tree_id, state);
    result = { leaf: { leaf_id, status: new_status, from } };
  });
  return result;
}

// ============================================================
// 命令: leaf set-context
// ============================================================

async function cmdLeafSetContext(args) {
  const { positional } = parseArgs(args);
  const [tree_id, leaf_id, pctStr] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!pctStr) throw new TreeStateError(E_SCHEMA_INVALID, 'pct_int is required');

  const pct = parseInt(pctStr, 10);
  if (isNaN(pct) || pct < 0 || pct > 100 || String(pct) !== String(pctStr)) {
    throw new TreeStateError(E_SCHEMA_INVALID, `pct_int "${pctStr}" must be an integer 0-100`);
  }

  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    state.leaves[leaf_id].context_usage_pct = pct;
    writeState(tree_id, state);
    result = { leaf: { leaf_id, context_usage_pct: pct } };
  });
  return result;
}

// ============================================================
// 命令: leaf set-last-event
// ============================================================

async function cmdLeafSetLastEvent(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id, leaf_id, event_type] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!event_type) throw new TreeStateError(E_SCHEMA_INVALID, 'event_type is required');
  assertEnum(event_type, EVENT_TYPE_ENUM, 'event_type');

  const ts = opts.ts || nowIso();
  // ts 基本校验
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    throw new TreeStateError(E_SCHEMA_INVALID, `--ts "${ts}" is not a valid ISO date`);
  }

  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    const leaf = state.leaves[leaf_id];
    leaf.last_event_ts = ts;
    leaf.last_event_type = event_type;
    writeState(tree_id, state);
    result = { leaf: { leaf_id, last_event_ts: ts, last_event_type: event_type } };
  });
  return result;
}

// ============================================================
// 命令: leaf autonomy-override
// ============================================================

async function cmdLeafAutonomyOverride(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id, leaf_id] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!opts.json) throw new TreeStateError(E_SCHEMA_INVALID, '--json is required');
  const input = parseJsonArg(opts.json, 'override json');

  const ts = input.ts || nowIso();

  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    const leaf = state.leaves[leaf_id];

    // 合并到 autonomy_overrides
    const overrides = Object.assign({}, leaf.autonomy_overrides || {});
    if (Array.isArray(input.added_must_ask)) {
      overrides.added_must_ask = Array.from(new Set([...(overrides.added_must_ask || []), ...input.added_must_ask]));
    }
    if (Array.isArray(input.removed_can_decide)) {
      overrides.removed_can_decide = Array.from(new Set([...(overrides.removed_can_decide || []), ...input.removed_can_decide]));
    }
    overrides.reason = input.reason || overrides.reason || '';
    overrides.ts = ts;
    leaf.autonomy_overrides = overrides;

    // 追加 drift_history
    const driftEntry = {
      ts,
      leaf_id,
      kind: 'direction',
      severity: 'mid',
      action: 'limit',
      reason: input.reason || 'autonomy_override'
    };
    leaf.drift_history.push(driftEntry);
    if (Array.isArray(state.drift_log)) {
      state.drift_log.push(driftEntry);
    }

    writeState(tree_id, state);
    result = { leaf: { leaf_id, autonomy_overrides: overrides } };
  });
  return result;
}

// ============================================================
// 命令: milestone add / set-result
// ============================================================

async function cmdMilestoneAdd(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id, leaf_id] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!opts.json) throw new TreeStateError(E_SCHEMA_INVALID, '--json is required');
  const input = parseJsonArg(opts.json, 'milestone json');

  if (!input.id) throw new TreeStateError(E_SCHEMA_INVALID, 'milestone.id is required');
  if (typeof input.id !== 'string') {
    throw new TreeStateError(E_SCHEMA_INVALID, 'milestone.id must be a string');
  }
  if (input.desc !== undefined && typeof input.desc !== 'string') {
    throw new TreeStateError(E_SCHEMA_INVALID, 'milestone.desc must be a string');
  }
  if (input.expect_outputs !== undefined && !Array.isArray(input.expect_outputs)) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'milestone.expect_outputs must be an array');
  }

  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    const leaf = state.leaves[leaf_id];
    if (!Array.isArray(leaf.milestones)) leaf.milestones = [];
    for (const m of leaf.milestones) {
      if (m.id === input.id) {
        throw new TreeStateError(E_DUPLICATE_LEAF, `milestone "${input.id}" already exists in leaf "${leaf_id}"`);
      }
    }
    const ms = {
      id: input.id,
      desc: input.desc || '',
      expect_outputs: input.expect_outputs || [],
      status: 'pending',
      audit_pass: null,
      note_path: null
    };
    leaf.milestones.push(ms);
    writeState(tree_id, state);
    result = { milestone: ms };
  });
  return result;
}

async function cmdMilestoneSetResult(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id, leaf_id, milestone_id] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!milestone_id) throw new TreeStateError(E_SCHEMA_INVALID, 'milestone_id is required');

  const auditPassRaw = opts['audit-pass'];
  if (auditPassRaw === undefined) {
    throw new TreeStateError(E_SCHEMA_INVALID, '--audit-pass is required (true|false)');
  }
  let audit_pass;
  if (auditPassRaw === 'true' || auditPassRaw === true) audit_pass = true;
  else if (auditPassRaw === 'false' || auditPassRaw === false) audit_pass = false;
  else {
    throw new TreeStateError(E_SCHEMA_INVALID, `--audit-pass "${auditPassRaw}" must be true|false`);
  }
  const note_path = opts['note-path'] || null;

  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    const leaf = state.leaves[leaf_id];
    if (!Array.isArray(leaf.milestones)) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `milestone "${milestone_id}" not found in leaf "${leaf_id}"`);
    }
    let target = null;
    for (const m of leaf.milestones) {
      if (m.id === milestone_id) { target = m; break; }
    }
    if (!target) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `milestone "${milestone_id}" not found in leaf "${leaf_id}"`);
    }
    target.audit_pass = audit_pass;
    target.status = audit_pass ? 'done' : 'failed';
    if (note_path !== null) target.note_path = note_path;
    writeState(tree_id, state);
    result = { milestone: target };
  });
  return result;
}

// ============================================================
// 命令: event append
// ============================================================

async function cmdEventAppend(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id, leaf_id] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!opts.type) throw new TreeStateError(E_SCHEMA_INVALID, '--type is required');
  assertEnum(opts.type, EVENT_TYPE_ENUM, 'event type');

  if (!opts.json) throw new TreeStateError(E_SCHEMA_INVALID, '--json is required');
  const meta = parseJsonArg(opts.json, 'event meta');

  const ts = nowIso();
  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    const leaf = state.leaves[leaf_id];
    if (!Array.isArray(leaf.events)) leaf.events = [];
    const ev = { type: opts.type, ts, meta };
    leaf.events.push(ev);
    leaf.last_event_type = opts.type;
    leaf.last_event_ts = ts;
    writeState(tree_id, state);
    result = { event: ev };
  });
  return result;
}

// ============================================================
// 命令: drift append
// ============================================================

async function cmdDriftAppend(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id, leaf_id] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!opts.kind) throw new TreeStateError(E_SCHEMA_INVALID, '--kind is required');
  if (!opts.severity) throw new TreeStateError(E_SCHEMA_INVALID, '--severity is required');
  if (!opts.action) throw new TreeStateError(E_SCHEMA_INVALID, '--action is required');
  assertEnum(opts.kind, DRIFT_KIND_ENUM, 'drift kind');
  assertEnum(opts.severity, DRIFT_SEVERITY_ENUM, 'drift severity');
  assertEnum(opts.action, DRIFT_ACTION_ENUM, 'drift action');

  const fork_to = opts['fork-to'] || null;
  const reason = opts.reason || '';

  const ts = nowIso();
  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    // fork_to 校验
    if (fork_to && !Object.prototype.hasOwnProperty.call(state.leaves, fork_to)) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `--fork-to "${fork_to}" does not exist in leaves`);
    }

    const driftEntry = {
      ts,
      leaf_id,
      kind: opts.kind,
      severity: opts.severity,
      action: opts.action,
      reason
    };
    if (fork_to) driftEntry.fork_to = fork_to;

    // 双写
    const leaf = state.leaves[leaf_id];
    if (!Array.isArray(leaf.drift_history)) leaf.drift_history = [];
    leaf.drift_history.push(driftEntry);
    if (!Array.isArray(state.drift_log)) state.drift_log = [];
    state.drift_log.push(driftEntry);

    writeState(tree_id, state);
    result = { drift: driftEntry };
  });
  return result;
}

// ============================================================
// 命令: heartbeat append
// ============================================================

async function cmdHeartbeatAppend(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  if (!opts.json) throw new TreeStateError(E_SCHEMA_INVALID, '--json is required');
  const input = parseJsonArg(opts.json, 'heartbeat json');

  if (!Array.isArray(input.verdicts)) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'heartbeat.verdicts must be an array');
  }
  const ts = input.ts || nowIso();
  const next = input.next_heartbeat || null;

  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    const entry = { ts, verdicts: input.verdicts };
    if (next) entry.next_heartbeat = next;
    if (!Array.isArray(state.heartbeat_log)) state.heartbeat_log = [];
    state.heartbeat_log.push(entry);
    state.last_heartbeat = ts;
    writeState(tree_id, state);
    result = { heartbeat: entry };
  });
  return result;
}

// ============================================================
// 命令: segment append
// ============================================================

async function cmdSegmentAppend(args) {
  const { positional } = parseArgs(args);
  const [tree_id, leaf_id, new_session_id] = positional;
  assertTreeExists(tree_id);
  if (!leaf_id) throw new TreeStateError(E_SCHEMA_INVALID, 'leaf_id is required');
  if (!new_session_id) throw new TreeStateError(E_SCHEMA_INVALID, 'new_session_id is required');

  const ts = nowIso();
  let result = null;
  await withLock(tree_id, () => {
    const state = readState(tree_id);
    if (!state.leaves[leaf_id]) {
      throw new TreeStateError(E_LEAF_NOT_FOUND, `leaf "${leaf_id}" not found`);
    }
    const leaf = state.leaves[leaf_id];

    // session_id 唯一性校验（整个 leaves 中）
    for (const l of Object.values(state.leaves)) {
      if (Array.isArray(l.segment_chain) && l.segment_chain.includes(new_session_id)) {
        throw new TreeStateError(E_SCHEMA_INVALID, `session_id "${new_session_id}" already in segment_chain of leaf "${l.leaf_id}"`);
      }
      if (l.session_id === new_session_id) {
        throw new TreeStateError(E_SCHEMA_INVALID, `session_id "${new_session_id}" already used by leaf "${l.leaf_id}"`);
      }
    }

    if (!Array.isArray(leaf.segment_chain)) leaf.segment_chain = [];
    leaf.segment_chain.push(new_session_id);
    leaf.status = 'segment_pending';

    // drift_history 追加
    const driftEntry = {
      ts,
      leaf_id,
      kind: 'rhythm',
      severity: 'low',
      action: 'handoff',
      to_session: new_session_id,
      reason: 'segment_handoff'
    };
    leaf.drift_history.push(driftEntry);
    if (!Array.isArray(state.drift_log)) state.drift_log = [];
    state.drift_log.push(driftEntry);

    writeState(tree_id, state);
    result = { leaf: { leaf_id, status: leaf.status, segment_chain: leaf.segment_chain } };
  });
  return result;
}

// ============================================================
// 命令: backup / restore
// ============================================================

async function cmdBackup(args) {
  const { positional, opts } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const label = opts.label || 'manual';

  let backupName = null;
  await withLock(tree_id, () => {
    backupName = doBackup(tree_id, label);
  });
  return { backup: backupName, backups: listBackups(tree_id).slice(0, BACKUP_KEEP_RECENT).map((b) => b.name) };
}

async function cmdRestore(args) {
  const { positional } = parseArgs(args);
  const [tree_id, backup_file] = positional;
  assertTreeExists(tree_id);
  if (!backup_file) throw new TreeStateError(E_SCHEMA_INVALID, 'backup_file is required');

  // backup_file 可以是 basename（在 tree_dir 内）或绝对路径
  let full = backup_file;
  if (!path.isAbsolute(backup_file)) {
    full = path.join(treeDir(tree_id), backup_file);
  }
  if (!fs.existsSync(full)) {
    throw new TreeStateError(E_BACKUP_CORRUPT, `backup file not found: ${full}`);
  }

  // 先校验备份文件能解析为合法 schema
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    throw new TreeStateError(E_BACKUP_CORRUPT, `backup file is not valid JSON: ${e.message}`);
  }
  if (typeof parsed !== 'object' || !parsed || parsed.tree_id !== tree_id) {
    throw new TreeStateError(E_BACKUP_CORRUPT, `backup file schema invalid: tree_id mismatch or not an object`);
  }
  if (typeof parsed.leaves !== 'object' || Array.isArray(parsed.leaves)) {
    throw new TreeStateError(E_BACKUP_CORRUPT, `backup file schema invalid: leaves must be an object`);
  }

  let result = null;
  await withLock(tree_id, () => {
    // 恢复前先做一次安全备份
    doBackup(tree_id, 'before-restore');
    // 用 parsed 覆盖（写原子）
    // writeState 会基于 parsed._meta.write_count 续算；若无则从 0 起
    const state = parsed;
    if (!state._meta || typeof state._meta !== 'object') {
      state._meta = {};
    }
    // 恢复视为新基线：清零计数，下次写从 1 起
    state._meta.write_count = 0;
    writeState(tree_id, state);
    result = { restored_from: path.basename(full), tree_id };
  });
  return result;
}

// ============================================================
// 命令: validate
// ============================================================

async function cmdValidate(args) {
  const { positional } = parseArgs(args);
  const [tree_id] = positional;
  assertTreeExists(tree_id);
  const state = readState(tree_id);

  const issues = [];
  const leaves = state.leaves || {};
  const leafIds = Object.keys(leaves);

  // 检查 1: 所有 leaves 的 parent 引用都能找到
  for (const id of leafIds) {
    const leaf = leaves[id];
    if (leaf.parent !== null && leaf.parent !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(leaves, leaf.parent)) {
        issues.push({
          type: 'parent_missing',
          leaf_id: id,
          detail: `parent "${leaf.parent}" not found in leaves`
        });
      }
    }
  }

  // 检查 2: 所有 drift_history 的 fork_to（如有）指向存在的 leaf
  for (const id of leafIds) {
    const leaf = leaves[id];
    const dh = Array.isArray(leaf.drift_history) ? leaf.drift_history : [];
    for (const d of dh) {
      if (d.fork_to) {
        if (!Object.prototype.hasOwnProperty.call(leaves, d.fork_to)) {
          issues.push({
            type: 'fork_to_missing',
            leaf_id: id,
            detail: `drift_history fork_to "${d.fork_to}" not found in leaves`
          });
        }
      }
    }
  }

  // 检查 3: 所有 segment_chain 中的 session_id 唯一（跨 leaf 不重复，且与 leaf.session_id 不重复）
  const seenSessionIds = new Map(); // session_id -> first seen leaf_id
  for (const id of leafIds) {
    const leaf = leaves[id];
    if (leaf.session_id) {
      if (seenSessionIds.has(leaf.session_id)) {
        issues.push({
          type: 'duplicate_session_id',
          leaf_id: id,
          detail: `session_id "${leaf.session_id}" already used by leaf "${seenSessionIds.get(leaf.session_id)}"`
        });
      } else {
        seenSessionIds.set(leaf.session_id, id);
      }
    }
  }
  for (const id of leafIds) {
    const leaf = leaves[id];
    const chain = Array.isArray(leaf.segment_chain) ? leaf.segment_chain : [];
    for (const sid of chain) {
      if (seenSessionIds.has(sid)) {
        const firstLeaf = seenSessionIds.get(sid);
        if (firstLeaf !== id) {
          issues.push({
            type: 'duplicate_session_id',
            leaf_id: id,
            detail: `segment_chain session_id "${sid}" already claimed by leaf "${firstLeaf}"`
          });
        }
      } else {
        seenSessionIds.set(sid, id);
      }
    }
  }

  // 检查 4: 所有 leaf.path 与 leaf_id 解析出的 path 一致
  for (const id of leafIds) {
    const leaf = leaves[id];
    const parsedPath = parsePathFromLeafId(id);
    if (parsedPath === null) {
      // leaf_id 不符合命名规范
      issues.push({
        type: 'name_invalid',
        leaf_id: id,
        detail: `leaf_id does not match naming spec`
      });
    } else if (parsedPath !== (leaf.path || '')) {
      issues.push({
        type: 'path_mismatch',
        leaf_id: id,
        detail: `leaf.path "${leaf.path}" does not match path segment "${parsedPath}" from leaf_id`
      });
    }
  }

  // 检查 5: milestones.id 在同 leaf 内唯一
  for (const id of leafIds) {
    const leaf = leaves[id];
    const ms = Array.isArray(leaf.milestones) ? leaf.milestones : [];
    const seen = new Set();
    for (const m of ms) {
      if (seen.has(m.id)) {
        issues.push({
          type: 'duplicate_milestone',
          leaf_id: id,
          detail: `milestone.id "${m.id}" duplicated within leaf`
        });
      } else {
        seen.add(m.id);
      }
    }
  }

  // 输出: ok=true 仅当 issues 为空；issues 非空时 ok=false
  return { ok: issues.length === 0, issues };
}

// ============================================================
// 参数解析
// ============================================================

/**
 * 解析 CLI 参数。返回 { positional: string[], opts: {key: string} }
 * 支持 --flag value / --flag=value / -n value 三种形式
 */
function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        opts[key] = val;
      } else {
        const key = a.slice(2);
        // 下一个如果不是 -开头或不存在，作为值；否则视为 boolean flag
        if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          opts[key] = argv[i + 1];
          i++;
        } else if (i + 1 < argv.length && (argv[i + 1] === 'true' || argv[i + 1] === 'false')) {
          opts[key] = argv[i + 1];
          i++;
        } else {
          opts[key] = 'true';
        }
      }
    } else if (a.startsWith('-') && a.length > 1) {
      // -n value 形式
      const key = a.slice(1);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        opts[key] = argv[i + 1];
        i++;
      } else {
        opts[key] = 'true';
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

// ============================================================
// 主入口 & 路由
// ============================================================

async function dispatch(cmd, args) {
  switch (cmd) {
    // Maintain
    case 'init':
      return await cmdInit(args);
    case 'backup':
      return await cmdBackup(args);
    case 'restore':
      return await cmdRestore(args);
    case 'validate':
      return await cmdValidate(args);

    // Add
    case 'leaf':
      return await dispatchLeaf(args);
    case 'milestone':
      return await dispatchMilestone(args);

    // Append
    case 'event':
      return await dispatchEvent(args);
    case 'drift':
      return await dispatchDrift(args);
    case 'heartbeat':
      return await dispatchHeartbeat(args);
    case 'segment':
      return await dispatchSegment(args);

    // Query
    case 'tree':
      return await dispatchTree(args);

    default:
      throw new TreeStateError(E_UNKNOWN, `unknown command "${cmd}". Available: init, backup, restore, validate, leaf, milestone, event, drift, heartbeat, segment, tree`);
  }
}

async function dispatchLeaf(args) {
  if (args.length === 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'leaf requires a subcommand: get | list-active | list-all | add | set-status | set-context | set-last-event | autonomy-override');
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case 'get': return await cmdLeafGet(rest);
    case 'list-active': return await cmdLeafListActive(rest);
    case 'list-all': return await cmdLeafListAll(rest);
    case 'add': return await cmdLeafAdd(rest);
    case 'set-status': return await cmdLeafSetStatus(rest);
    case 'set-context': return await cmdLeafSetContext(rest);
    case 'set-last-event': return await cmdLeafSetLastEvent(rest);
    case 'autonomy-override': return await cmdLeafAutonomyOverride(rest);
    default:
      throw new TreeStateError(E_UNKNOWN, `unknown leaf subcommand "${sub}"`);
  }
}

async function dispatchMilestone(args) {
  if (args.length === 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'milestone requires a subcommand: add | set-result');
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case 'add': return await cmdMilestoneAdd(rest);
    case 'set-result': return await cmdMilestoneSetResult(rest);
    default:
      throw new TreeStateError(E_UNKNOWN, `unknown milestone subcommand "${sub}"`);
  }
}

async function dispatchEvent(args) {
  if (args.length === 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'event requires a subcommand: append | list');
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case 'append': return await cmdEventAppend(rest);
    case 'list': return await cmdEventList(rest);
    default:
      throw new TreeStateError(E_UNKNOWN, `unknown event subcommand "${sub}"`);
  }
}

async function dispatchDrift(args) {
  if (args.length === 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'drift requires a subcommand: append | list');
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case 'append': return await cmdDriftAppend(rest);
    case 'list': return await cmdDriftList(rest);
    default:
      throw new TreeStateError(E_UNKNOWN, `unknown drift subcommand "${sub}"`);
  }
}

async function dispatchHeartbeat(args) {
  if (args.length === 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'heartbeat requires a subcommand: append | tail');
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case 'append': return await cmdHeartbeatAppend(rest);
    case 'tail': return await cmdHeartbeatTail(rest);
    default:
      throw new TreeStateError(E_UNKNOWN, `unknown heartbeat subcommand "${sub}"`);
  }
}

async function dispatchSegment(args) {
  if (args.length === 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'segment requires a subcommand: append');
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case 'append': return await cmdSegmentAppend(rest);
    default:
      throw new TreeStateError(E_UNKNOWN, `unknown segment subcommand "${sub}"`);
  }
}

async function dispatchTree(args) {
  if (args.length === 0) {
    throw new TreeStateError(E_SCHEMA_INVALID, 'tree requires a subcommand: dump');
  }
  const [sub, ...rest] = args;
  switch (sub) {
    case 'dump': return await cmdTreeDump(rest);
    default:
      throw new TreeStateError(E_UNKNOWN, `unknown tree subcommand "${sub}"`);
  }
}

// ============================================================
// 启动
// ============================================================

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: { code: E_UNKNOWN, msg: 'no command given. Try: node tree-state.js init <tree_id> --root-brief ... --root-dod ...' }
    }) + '\n');
    process.exit(2);
  }
  const [cmd, ...args] = argv;
  try {
    const result = await dispatch(cmd, args);
    process.stdout.write(JSON.stringify(Object.assign({ ok: true }, result)) + '\n');
    process.exit(0);
  } catch (e) {
    const code = e && e.code ? e.code : E_UNKNOWN;
    const msg = e && e.message ? e.message : String(e);
    process.stdout.write(JSON.stringify({
      ok: false,
      error: { code, msg }
    }) + '\n');
    process.exit(code === E_LOCK_TIMEOUT ? 3 : 1);
  }
}

main().catch((e) => {
  // 兜底
  process.stdout.write(JSON.stringify({
    ok: false,
    error: { code: E_UNKNOWN, msg: `uncaught: ${e && e.message ? e.message : String(e)}` }
  }) + '\n');
  process.exit(1);
});
