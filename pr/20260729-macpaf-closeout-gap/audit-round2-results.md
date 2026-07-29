# Audit Round 2: tree_init session_id UUID 校验对齐

**审计员**: DeepSeek-v4-pro（异厂商独立审计）  
**实施方**: GLM-5.2  
**日期**: 2026-07-29  
**范围**: `cmdInit` L1004-1015 session_id UUID strict 校验 + `tests/init-session-uuid.test.cjs` 15 单测

## Verdict: **pass** ✅

核心 macpaf 场景修复正确，设计决策合理，单测覆盖完整，无回归。

---

## 6 项逐项结论

### 1. UUID 校验落地 ✅

**证据**: `tree-engine.cjs:1012-1015`

```js
if (rootSessionId !== PENDING_ROOT && !isValidStrictUuidV4(rootSessionId)) {
  throw new TreeStateError(E_NAME_INVALID, ...);
}
```

- ✅ 复用 `isValidStrictUuidV4`（L267-272）：UUID_RE 格式检查 + 拒全 0/全 f，纯格式 boolean
- ✅ `PENDING_ROOT` 跳过（L1012 前置条件 `rootSessionId !== PENDING_ROOT`）：保留冷启动降级路径
- ✅ 校验位置在 root leaf 创建前（L1016），fail-fast 不落盘

### 2. 设计决策合理性 ✅

**`isValidStrictUuidV4` vs `assertMcpEntrySessionId` 差异分析**:

| 维度 | `isValidStrictUuidV4` (L267) | `assertMcpEntrySessionId` (L280) |
|------|----------------------------|----------------------------------|
| 格式校验 | UUID_RE + 拒全 0/全 f | UUID_RE + 拒全 0/全 f |
| Liveness | **不调** verifier | 调 `checkSessionAlive()` (L291) |
| 副作用 | 无（纯函数） | 外部 verifier 调用 |
| CLI 无 verifier | 直接返回 boolean | bypass 分支：仅拒占位 UUID (L300-303) |
| verifier 拒绝 | N/A | throw E_SESSION_NOT_ALIVE (L297-298) |

**合理性判断**: `isValidStrictUuidV4` 是正确的选择：

1. **tree_init 是创建操作，非加入操作**：root session_id 只需格式合法，不需要 liveness 校验。liveness 对 tree_init 无意义——树此时还不存在。
2. **verifier 注入有竞态风险**：若 verifier 已注入但 session registry 未就绪（冷启动），`assertMcpEntrySessionId` 可能抛 `E_SESSION_NOT_ALIVE` 阻断 tree_init（L297-298），而 `isValidStrictUuidV4` 无此风险。
3. **CLI 模式兼容**：`assertMcpEntrySessionId` 在 CLI 无 verifier 时走 bypass 分支（L300-303），对真实 UUID 也能放行——但引入了不必要的代码路径复杂度。
4. **性能**：省去一次外部 verifier 调用（即使廉价，也无必要）。

**代码注释 L1010 小修正建议**：注释写 "CLI/未注入 verifier 时 liveness 会误杀合规 init"，实际 `assertMcpEntrySessionId` 在无 verifier 时走 bypass 不会误杀真实 UUID。真正风险是 **verifier 注入但有竞态/瞬错** 时误杀。此建议不影响 verdict，属措辞优化。

### 3. 错误码 + 消息风格 ✅

**对比**:

| 位置 | 错误码 | 消息模式 |
|------|--------|---------|
| L936 (prefix) | `E_NAME_INVALID` | `root_brief.prefix "${val}": prefix must match [a-z]...` |
| L942 (tree_id) | `E_NAME_INVALID` | `tree_id "${val}" must match prefix rule...` |
| **L1013 (session_id)** | **`E_NAME_INVALID`** | **`session_id "${val}" must be a full UUID...`** |

- ✅ 错误码一致：`E_NAME_INVALID`（命名规范类错误，与 prefix/tree_id 同语义）
- ✅ 消息含实际值 + 格式要求 + 根因解释（macpaf 双锁死锁），比 L936/L942 更详细——合理，因为 UUID 校验不直观，需上下文帮助用户理解为什么"缩写不行"
- ✅ 双语提示（中英文），与其他 cmdInit 校验一致

### 4. 不破坏现有路径 ✅

**验证的 4 条路径**:

| 路径 | 代码行 | 行为 |
|------|--------|------|
| 三源全缺 → PENDING_ROOT | L1003 `|| PENDING_ROOT` + L1012 skip | ✅ T6 确认：PENDING_ROOT 正常写入 |
| callerSessionId 兜底（完整 UUID） | L1003 `callerSessionId` 位置 | ✅ T4 确认：完整 UUID 通过 |
| `--session-id` 参数（完整 UUID） | L1003 `opts['session-id']` 位置 | ✅ T1 确认：完整 UUID 通过 |
| `--session-id` 参数（缩写） | L1012-1015 拒绝 | ✅ T2 确认：缩写被拒 E_NAME_INVALID |

**grep 确认无其他影响**: 新增代码仅在 `cmdInit` 函数内（L1004-1015），不修改共享 helper、不影响其他 cmd 入口。`isValidStrictUuidV4` 是既有函数（L267），被 leaf_add（`assertMcpEntrySessionId` 内部 UUID_RE）+ leaf segment + audit gate 等多处复用——但 `cmdInit` 只用其 boolean 返回值，不改变函数本身。

### 5. 单测质量 ✅

**实测结果**: `node tests/init-session-uuid.test.cjs` → **15 PASS / 0 FAIL / 15 total**

**覆盖矩阵**:

| 测试 | 场景 | 断言数 | 覆盖要点 |
|------|------|--------|---------|
| T1 | 完整 UUID `--session-id` | 2 | 通过 + root.session_id 正确写入 |
| T2 | 缩写 `a9221192` | 3 | 拒绝 + E_NAME_INVALID + fail-fast 不落盘 |
| T3 | 非 UUID `my-session` | 2 | 拒绝 + E_NAME_INVALID |
| T4 | callerSessionId 兜底 | 2 | 通过 + root.session_id === caller |
| T5 | 全 0 / 全 f | 4 | 2 UUID × (拒绝 + 错误码) |
| T6 | PENDING_ROOT 兜底 | 2 | 通过 + root.session_id === PENDING_ROOT |

- ✅ 无伪测试：全部真实调用 `engine.run('init', ...)`，读 `tree-state.json` 核验
- ✅ 边界覆盖：完整 UUID / 缩写 / 非 UUID / 全 0 / 全 f / PENDING_ROOT / caller 兜底
- ✅ fail-fast 验证（T2）：拒绝后确认无 `tree-state.json` 残留
- ✅ 测试隔离：每个 case 独立 `mkTreeDir`（tmpdir + 时间戳 + 随机后缀）

### 6. PoC 实测 ✅

**独立 PoC 实测结果**: 13/14 PASS，1 FAIL 定位为预存行为（非本次改动引入）

**核心场景**:

| PoC | 输入 | 预期 | 实际 | 结论 |
|-----|------|------|------|------|
| PoC-1 | `session_id='a9221192'`（macpaf 实战缩写） | REJECT | **REJECT E_NAME_INVALID** ✅ | macpaf 场景已修复 |
| PoC-2 | `session_id='11111111-2222-4333-8444-555555555555'` | ACCEPT | **ACCEPT** ✅ | 正常路径未误伤 |
| PoC-3 边界 | 标准 v4/v1/大写 UUID | ACCEPT | **ACCEPT** ✅ | 合法 UUID 变体全通过 |
| PoC-3 边界 | 纯数字/缺连字符/超短/null-like | REJECT | **REJECT** ✅ | 非法格式全拦截 |

**唯一 FAIL 分析**:

```
PoC-3 空字符串 '' → ACCEPT (期望 REJECT)
```

**根因**: L1003 的 `||` 链——`opts['session-id']` 为 `''`（falsy）→ 短路到 `callerSessionId` → `process.env.PROMA_SESSION_ID` → `PENDING_ROOT` → L1012 跳过 UUID 校验。

**判断**: **预存行为，非本次改动引入**。`parseArgs` 将 `--session-id ''` 解析为空字符串，`||` 链自 macp2 即存在（L1003）。MCP 路径不受影响（用 `callerSessionId` 直传而非 `--session-id`）。建议后续在 `||` 解引用前加显式空字符串检查，但非本 PR 阻塞项。

---

## 发现的问题清单

| # | 严重度 | 描述 | 建议 |
|---|--------|------|------|
| 1 | **minor** | `--session-id ''`（空字符串）被 `||` 链静默降级到 PENDING_ROOT，不抛显式错误 | 预存行为，非本次改动引入。后续可在 L1003 `||` 之前加 `(opts['session-id'] !== undefined && opts['session-id'] !== '') ? opts['session-id'] : ...` 或等效逻辑。不影响 MCP 路径。 |
| 2 | **cosmetic** | L1010 注释 "CLI/未注入 verifier 时 liveness 会误杀合规 init" 不够精确——`assertMcpEntrySessionId` 在无 verifier 时走 bypass 不会误杀真实 UUID，真正风险是 verifier 注入但有竞态/瞬错 | 建议改为 "root session 是冷启动产物，verifier 注入但 session registry 未就绪时 liveness 可能误杀合规 init" |

---

## 审计方法

- 源码审查：`tree-engine.cjs` L232 (UUID_RE), L255-272 (isValidStrictUuidV4), L280-305 (assertMcpEntrySessionId), L920-1015 (cmdInit), L5711-5725 (checkSessionAlive)
- 单测执行：`node tests/init-session-uuid.test.cjs` → 15/15 PASS
- 独立 PoC：8 种 UUID 变体 + 空字符串边界，实测复现 macpaf 场景
- parseArgs 边界分析：`--session-id ''` / `--session-id=` 两种空值形式
- 回归核验：三源全缺/caller 兜底/--session-id 参数/PENDING_ROOT 四条路径
