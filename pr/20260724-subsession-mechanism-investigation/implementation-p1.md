# P1 实施记录：depth>0 子会话委派限制提示

> 实施者：dc4cc332（pi 子会话，P1 实施）
> 实施日期：2026-07-25
> 改动文件：`D:/Codes/tree-harness/proma-dev-patches.cjs`

---

## 实施内容

### 落地點 A（必做）：扩展 create_session / fork_session 的 delegationDepth 超限报错

两处报错信息从简短技术描述扩展为"明确提示 + 3 种替代方案"。

### 落地點 B（可选，不做）

A 已足够清晰：depth>0 的会话尝试 create_session 或 fork_session 时会直接看到详细提示和替代方案。不做 B 的工具描述注入。

---

## 改动详情

### 改动点 1：`create_session` handler（L1157）

**改动前：**
```javascript
return { ok: false, error: { code: 'E_DELEGATION_TOO_DEEP', msg: `create denied: delegation depth ${_newDepth} > MAX_DELEGATION_DEPTH(${MAX_DELEGATION_DEPTH}). Source ${sourceSessionId.slice(0, 8)} already at depth ${_srcDepth}.` } };
```

**改动后：**
```javascript
return { ok: false, error: { code: 'E_DELEGATION_TOO_DEEP', msg: `create denied: delegation depth ${_newDepth} > MAX_DELEGATION_DEPTH(${MAX_DELEGATION_DEPTH}). Source ${sourceSessionId.slice(0, 8)} already at depth ${_srcDepth}. 当前会话 delegationDepth=${_srcDepth}（协作子会话），P0 后 collaboration 工具已不可见，不能继续委派。替代方案：(1) 请父会话用 mcp__collaboration__delegate_agent 委派；(2) 启用 proma-dev-session MCP 后用 mcp__session__create_session；(3) 用户手动开新会话。` } };
```

### 改动点 2：`fork_session` handler（L1244）

**改动前：**
```javascript
return { ok: false, error: { code: 'E_DELEGATION_TOO_DEEP', msg: `fork denied: delegation depth ${_forkNewDepth} > MAX_DELEGATION_DEPTH(${MAX_DELEGATION_DEPTH}). Source ${args.source_session_id.slice(0, 8)} already at depth ${_forkSrcDepth}.` } };
```

**改动后：**
```javascript
return { ok: false, error: { code: 'E_DELEGATION_TOO_DEEP', msg: `fork denied: delegation depth ${_forkNewDepth} > MAX_DELEGATION_DEPTH(${MAX_DELEGATION_DEPTH}). Source ${args.source_session_id.slice(0, 8)} already at depth ${_forkSrcDepth}. 当前会话 delegationDepth=${_forkSrcDepth}（协作子会话），P0 后 collaboration 工具已不可见，不能继续委派。替代方案：(1) 请父会话用 mcp__collaboration__delegate_agent 委派；(2) 启用 proma-dev-session MCP 后用 mcp__session__create_session；(3) 用户手动开新会话。` } };
```

---

## 验证

### 语法检查

```
$ node --check /d/Codes/tree-harness/proma-dev-patches.cjs
(exit code 0, no output)
```

✅ **通过**

### 逻辑不变性

| 检查项 | 结果 |
|--------|------|
| 错误码 `E_DELEGATION_TOO_DEEP` | ✅ 不变 |
| 返回结构 `{ ok: false, error: { code, msg } }` | ✅ 不变 |
| 触发条件 `_newDepth > MAX_DELEGATION_DEPTH` | ✅ 不变 |
| 其他工具行为 | ✅ 不受影响（只改报错文本） |

报错信息扩展后，仅 `msg` 字段更详细，抛错条件、错误码、返回结构全部不变。

---

## depth>0 会话看到提示的路径分析

P1 依赖两件事同时成立才能让 depth>0 Agent 看到提示：

1. **P0 先修好了**：Pi 运行时 depth>0 的会话不再看到 `mcp__collaboration__delegate_agent` 工具（伪可用陷阱已消除）
2. **P1 扩展报错**：Agent 尝试用 `create_session` 或 `fork_session` 创建子会话时，会遇到 `E_DELEGATION_TOO_DEEP` 错误，此时报错文本已包含完整替代方案

### 覆盖的运行时

| 运行时 | `create_session` 工具可用？ | `fork_session` 工具可用？ | P1 提示路径 |
|--------|--------------------------|--------------------------|------------|
| **Pi** | ✅ 始终注入（`__proma_getPiCustomTools__`） | ✅ 始终注入 | 调 create_session / fork_session → E_DELEGATION_TOO_DEEP + 详细提示 |
| **Claude** | ✅ 通过补丁 L MCP 注入 | ✅ 通过补丁 L MCP 注入 | 同上 |

### 典型对话流（Pi depth>0）

```
Agent: 我需要创建子会话来并行处理...
Tool call: create_session(title="...", ...)
→ Error: E_DELEGATION_TOO_DEEP
  当前会话 delegationDepth=2（协作子会话），P0 后 collaboration 工具已不可见，不能继续委派。
  替代方案：(1) 请父会话用 mcp__collaboration__delegate_agent 委派；
  (2) 启用 proma-dev-session MCP 后用 mcp__session__create_session；
  (3) 用户手动开新会话。

Agent: 理解了，当前会话无法委派。我会建议用户...
```

Agent 不会被误导试错多轮。

---

## 总结

- **改了什么**：`proma-dev-patches.cjs` 中 `create_session` 和 `fork_session` 两处 `E_DELEGATION_TOO_DEEP` 报错，`msg` 字段追加了中文提示（当前深度 + P0 说明 + 3 种替代方案）
- **不改什么**：错误码、触发条件、返回结构、`__proma_getPiCustomTools__` 工具描述（B 不做）
- **验证结论**：`node --check` 通过，逻辑不变，报错文本从 ~120 字扩展到 ~220 字（含中文替代方案）
