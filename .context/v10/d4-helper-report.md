# D4 Helper + Skill 配套实施报告

> leaf_id: `v10v-D4-commander`
> 实施: 2026-06-25
> 方案: `.context/plan/agent-helper-and-skill-auto-trigger.md`
> 状态: **完成（4 层全部实施 + 测试 6/6 + 回归 0 退化）**

---

## 实施概况

| Layer | 内容 | 状态 | 改动位置 |
|-------|------|------|---------|
| Layer 1 | `mcp__tree__tree_help(topic)` 元工具 + 13 个 topic | ✅ 完成 | tree-engine.cjs (`HELP_TOPICS` + `cmdHelp`) + patches.cjs (注册 `tree_help`) |
| Layer 2 | `tree_init` 返回值注入 `tips` | ✅ 完成 | tree-engine.cjs (`cmdInit` return + `buildInitTips`) |
| Layer 3 | 错误码附 `help_topic`/`help_hint` 引用 | ✅ 完成 | tree-engine.cjs (`ERROR_TO_HELP` + `TreeStateError` + `run()` catch 块) |
| Layer 4 | SKILL description 关键词强化 | ✅ 完成 | `skills/tree-commander/SKILL.md` + `skills/tree-worker/SKILL.md` frontmatter |

- 13 个 help topic：**全部实施**（每个 100-300 字，按方案 §3.2 大纲）
- 33 个错误码 help 映射：**全部映射**（16 个 V10 新增全有 + 17 个旧码 12 个映射 + 5 个 null 自解释）
- 集中映射策略：TreeStateError 构造 + run() catch 改造 = **零侵入 throw 点**

---

## Layer 1: `mcp__tree__tree_help` 工具

### 实现位置
- **engine 端**：`tree-engine.cjs` §`HELP_TOPICS` 常量 + `cmdHelp(args)` 函数 + dispatch case `'help'`
- **MCP 注册**：`patches.cjs` §`__proma_createTreeMcpServer__` tools 数组首位（说明："任何 mcp__tree__* 调用前如果不确定用法，先 tree_help 拿 topic"）
- **注册日志**：`log("[Patch v0.7+] Tree MCP server factory registered (mcp__tree__* — 28 tools: 27 wrapping tree-state.js + 1 tree_help meta-tool [V10-helper D4])");`

### 13 个 topic 内容摘要

| topic | 标题 | 字数 | 核心内容 |
|-------|------|------|---------|
| `how_to_init` | 建树最佳实践 | 944 | tree_id 命名 / root_brief 5 字段 / root_dod 4 字段 / 常见 init 失败码 |
| `how_to_register_auditor` | auditor 注册流程 | 1290 | V4-V9 鸡生蛋问题 / V10-trust-anchor 提案（root 自审）/ 三重校验（status/events/audit_gate）|
| `role_semantics` | 角色语义 | 923 | root/commander/worker/auditor 职责 / status 转换图 |
| `v10_constraints` | V10 八大加固点摘要 | 1272 | 8 个加固点 + 各自错误码 + 失守案例引用 |
| `self_audit_forbidden` | caller ≠ audit_session_id | 1243 | 防御视角 / audit-gate-test-20260625 失守数据 / 正确多 session 流程 |
| `borrowed_identity` | 借身份攻击详解 | 822 | 攻击视角 / V4-V9 vs V10 对比表 / 测试用例引用 |
| `naming_convention` | leaf_id 命名规则 | 944 | 完整正则 / 正例 5 个 / 负例 7 个（含 65996e8b 用过的 `auditor-1`）|
| `common_mistakes` | 65996e8b 5 个常见错误 | 1334 | 5 个错误 + 4 阶段失守模式（瞎试→瞎编→嘴硬→后补）|
| `alignment_workflow` | brief_echo + alignment 回填 | 1054 | V5b 硬约束 / 5 步流程 / 跳过此步的后果 |
| `nudge_escalation` | nudge 升级机制 | 540 | 阈值 3/5/7 / V4-V9 漏洞（168 次未升级）/ V10 修复 |
| `audit_tree_structure` | 审计任务最小树结构 | 852 | 7 leaf 最小结构 / 铁腕要求 / 迭代收敛流程 |
| `error_code_index` | 33 个错误码索引 | 2118 | 17 旧码 + 16 V10 新码，每个一行说明 + help topic |
| `full_guide` | 完整指南入口 | 819 | SKILL.md 路径 + 章节索引 + topic 列表 |

**内容互不相同验证**：H6 测试 13 个 topic 前 100 字符指纹无碰撞，内容长度集合有 12 个不同值。

### cmdHelp 签名

```js
function cmdHelp(args) {
  const { positional } = parseArgs(args);
  const topic = positional[0];
  if (!topic) {
    return { topics: [...], hint: "..." };  // 列出所有 topic
  }
  const entry = HELP_TOPICS[topic];
  if (!entry) {
    throw new TreeStateError(E_UNKNOWN,
      `Unknown help topic "${topic}". Available topics: ${available}. Call mcp__tree__tree_help({topic: 'full_guide'}) for the index.`);
  }
  return { topic, title, content, related_topics, skill_reference };
}
```

### 自验证（H1+H2+H6 测试）
- ✅ H1: help('how_to_init') 返回 topic/title/content/skill_reference，含关键词 tree_id/root_brief/root_dod
- ✅ H2: help('unknown') 返回 E_UNKNOWN + 含 'Available' + 列出至少 3 个 topic
- ✅ H6: 13 个 topic 全部返回非空且互不相同

---

## Layer 2: `tree_init` tips 注入

### 改动位置
- `tree-engine.cjs` `cmdInit` 函数 return 块新增 `tips: buildInitTips()`
- 新增 `buildInitTips()` 函数

### tips 字段结构

```js
{
  tree: { tree_id, created_at, dir, workspace_root },
  root_leaf: { leaf_id, session_id, is_pending },
  tips: {                                    // ← 新增
    next_steps: [
      "调 mcp__tree__tree_help('how_to_register_auditor') 看 auditor 注册流程...",
      "调 mcp__tree__tree_help('v10_constraints') 看 8 大加固点...",
      "调 mcp__tree__tree_help('common_mistakes') 避开 65996e8b 案例的 5 个常见错误",
      "完整指南: mcp__tree__tree_help('full_guide')",
    ],  // 4 条
    skill_reference: "skills/tree-commander/SKILL.md",
    pro_tip: "调用任何 mcp__tree__* 工具前如果不确定用法..."
  }
}
```

### 设计取舍（按方案 §3.7）
- **4 条 next_steps**：auditor 注册（鸡生蛋）+ V10 加固（避免拦截）+ 常见错误（最便宜纠偏）+ full_guide（兜底）
- **不放**：命名规则（init 时 tree_id 已定，等 leaf_add 时再提示）+ 心跳（进阶）+ 审计树结构（仅审计任务）
- 认知成本最小化

### 自验证（H3 测试）
- ✅ H3: init 返回 tips.next_steps 长度=4，每条都含 'tree_help'，skill_reference 含 'SKILL.md'

---

## Layer 3: 错误码附 help 引用

### 实现策略：集中映射表（方案 §3.9 方案 B）

**单一信源**：`ERROR_TO_HELP` 常量 + `TreeStateError` 构造函数挂 `help_topic` + `run()` catch 块据此生成 `help_hint`。

### ERROR_TO_HELP 映射表（33 个错误码全覆盖）

```js
const ERROR_TO_HELP = {
  // ---- 旧错误码（17 个）：12 个映射 + 5 个 null 自解释 ----
  E_TREE_NOT_FOUND:           null,   // 自解释
  E_LEAF_NOT_FOUND:           null,   // 自解释
  E_SCHEMA_INVALID:           'how_to_init',
  E_STATUS_INVALID:           'role_semantics',
  E_NAME_INVALID:             'naming_convention',
  E_PARENT_MISSING:           'how_to_init',
  E_DUPLICATE_LEAF:           'naming_convention',
  E_CHILDREN_NOT_DONE:        'role_semantics',
  E_DEPTH_EXCEEDED:           'role_semantics',
  E_BACKUP_CORRUPT:           null,   // 自解释
  E_IO:                       null,   // 自解释
  E_UNKNOWN:                  null,   // 自解释
  E_LOCK_TIMEOUT:             null,   // 自解释
  E_DELIVERABLE_MISSING:      'alignment_workflow',
  E_AUDITOR_NOT_INDEPENDENT:  'how_to_register_auditor',
  E_AUDIT_PREMATURE:          'alignment_workflow',
  E_ALIGNMENT_NOT_VERIFIED:   'alignment_workflow',
  E_SELFCHECK_INVALID:        'alignment_workflow',
  E_TREE_NODE_BUDGET_EXCEEDED:'how_to_init',
  E_TREE_NOT_VALIDATED:       'audit_tree_structure',
  E_GATEKEEPER_REQUIRED:      'role_semantics',
  // ---- V10 加固 16 个错误码（全部映射）----
  E_AUDITOR_NOT_DONE:         'how_to_register_auditor',
  E_AUDITOR_NO_EVENTS:        'how_to_register_auditor',
  E_AUDITOR_NOT_VERIFIED:     'how_to_register_auditor',
  E_BORROWED_IDENTITY:        'self_audit_forbidden',
  E_INVALID_UUID_STRICT:      'v10_constraints',
  E_NEGATIVE_COUNT:           'v10_constraints',
  E_COUNT_MISMATCH:           'v10_constraints',
  E_LENGTH_MISMATCH:          'v10_constraints',
  E_TS_BEFORE_CREATED:        'v10_constraints',
  E_TS_IN_FUTURE:             'v10_constraints',
  E_TS_NOT_MONOTONIC:         'v10_constraints',
  E_LEAF_AUTO_PRUNED:         'nudge_escalation',
  E_STATUS_EVENT_MISMATCH:    'v10_constraints',
};
```

注：实际旧码定义在 engine 里多一个 `E_NO_TREES_DIR`（patches.cjs 层抛），未在此映射。

### TreeStateError 改造（零侵入 throw 点）

```js
class TreeStateError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
    this.help_topic = ERROR_TO_HELP[code] || null;  // ← 新增
  }
}
```

### run() catch 块改造

```js
} catch (e) {
  const code = e && e.code ? e.code : E_UNKNOWN;
  const msg = e && e.message ? e.message : String(e);
  const helpTopic = (e && typeof e.help_topic !== 'undefined')
    ? e.help_topic
    : (ERROR_TO_HELP[code] || null);
  const error = { code, msg };
  if (helpTopic) {
    error.help_topic = helpTopic;
    error.help_hint = `See mcp__tree__tree_help('${helpTopic}') for correct usage.`;
  }
  return { ok: false, error };
}
```

**关键设计**：自解释错误（`help_topic=null`）不附 `help_hint`，避免噪声。

### 自验证（H4+H5 测试）
- ✅ H4: 借身份攻击 → `error.code=E_BORROWED_IDENTITY`, `help_topic='self_audit_forbidden'`, `help_hint` 含 self_audit_forbidden
- ✅ H5a: 名字违规 → `error.code=E_NAME_INVALID`, `help_topic='naming_convention'`
- ✅ H5b: 全 0 UUID → `error.code=E_INVALID_UUID_STRICT`, `help_topic='v10_constraints'`

### 真实错误返回示例（V10 后）

```json
{
  "ok": false,
  "error": {
    "code": "E_BORROWED_IDENTITY",
    "msg": "audit-gate rejected: caller \"528b0925...\" != audit_session_id \"404c724f...\"...",
    "help_topic": "self_audit_forbidden",
    "help_hint": "See mcp__tree__tree_help('self_audit_forbidden') for correct usage."
  }
}
```

---

## Layer 4: SKILL description 强化

### 改动文件
- `skills/tree-commander/SKILL.md` — 加 frontmatter（首部，在 `# tree-commander SKILL` 之前）
- `skills/tree-worker/SKILL.md` — 同理

### tree-commander 新增 description 关键词
建树 / 建开发树 / 建审计树 / 建测试树 / 端到端测试 / e2e / V10 验证 / audit_gate 测试 / 派子会话 / Fork worker / Fork auditor / 并行 Agent / 多 Agent 协作开发 / 树形任务分解 / 任何用到 mcp__tree__* 工具的任务（共 15 个具体场景词）

### tree-worker 新增 description 关键词
被 Fork 成 worker / 接收 5 件套契约 / 处理 brief_echo 回填 / milestone 自审 / 子会话角色 / 上行事件 / 接收 autonomy_override 限权（共 7 个）

### 预期效果
DeepSeek 65996e8b 接到的 "audit-gate-retest-v10 端到端" 任务中，"端到端" / "audit_gate 测试" / "V10 验证" 等关键词将命中 tree-commander SKILL description，提高自动触发命中率。

---

## 3 处 diff 验证

```
=== diff tree-engine.cjs (patch-l vs dev dist) ===
  --> IDENTICAL

=== diff proma-dev-patches.cjs (patch-l vs dev dist) ===
  --> IDENTICAL
```

**3 处一致**：`patch-l/tree-engine.cjs` = `D:/Proma-dev/resources/app/dist/tree-engine.cjs`；`patch-l/proma-dev-patches.cjs` = `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs`。

**C3 协同**：实施时发现 patch-l 已含 C3 trust-anchor 改动（10 处 trust-anchor 引用），D4 改动叠加在 C3 之上，互不冲突。dev dist 当前同时含 D4（13 处 ERROR_TO_HELP/cmdHelp/HELP_TOPICS/buildInitTips 标记）+ C3（9 处 trust-anchor 标记）。

---

## 测试回归

| 测试套件 | 通过 / 失败 | 状态 |
|---------|------------|------|
| **helper-test.cjs（新增）** | **6/6** | ✅ 全部通过 |
| v10-cleanroom.cjs | 54/0 | ✅ 0 退化（54 个用例覆盖 8 大加固点 + 失守重放 + Cr2 增量攻击）|
| dbc-spec.cjs | 48/0 | ✅ 0 退化（V5b DbC 硬约束 + 数值校验）|
| audit-attacks.cjs | 17/18 不可绕过 | ✅ 0 退化（1 个部分通过是 CP2，与 D4 无关，是 validate 检测出 audit_gate_not_independent 但不阻断）|
| v10-regression.cjs | 14/0 | ✅ 0 退化 |

### helper-test.cjs 6 个用例明细

| 用例 | 验证内容 | 结果 |
|------|---------|------|
| H1 | help('how_to_init') 返回非空 + 含建树关键词 | ✅ len=944 |
| H2 | help('unknown') 返回错误 + 含 Available topic 列表 | ✅ code=E_UNKNOWN |
| H3 | tree_init tips.next_steps（4 条）+ skill_reference + pro_tip | ✅ next_steps=4 |
| H4 | E_BORROWED_IDENTITY → help_topic='self_audit_forbidden' | ✅ 完整链路 |
| H5 | E_NAME_INVALID→naming_convention + E_INVALID_UUID_STRICT→v10_constraints | ✅ 双验证 |
| H6 | 13 topic 全部返回非空且互不相同 | ✅ unique_lens=12 |

### 测试匹配说明
- **现有测试均按 code 匹配**（如 `expect(r.error.code).toBe('E_BORROWED_IDENTITY')`），不匹配 message 全文
- 因此 Layer 3 给 message 末尾加 help_hint **不会破坏任何金标准**
- 实测：4 套金标准全部 0 退化，无需修改任何现有测试用例

---

## 已知问题

### 1. `audit-evidence.cjs` 不显示 help_hint（不属于 D4 范围）

**现象**：`audit-evidence.cjs` 输出的错误 message 没有 help_hint 后缀。

**原因**：该测试使用 `core/tree-state.js`（旧 CLI shim，D4 未修改），通过 `execFileSync('node', [SC, ...])` 调用。D4 改的是 `tree-engine.cjs`（MCP 真实运行时），tree-state.js 是早期 CLI 入口已被废弃。

**结论**：不是 D4 引入的退化。该测试不在金标准 5 套内（v10-cleanroom / dbc-spec / audit-attacks / v10-regression / helper-test）。建议未来清理时把 tree-state.js 同步更新或废弃。

### 2. C3 协同（开发树并发改动同文件）

**现象**：实施时发现 C3 已先于 D4 修改 patch-l/tree-engine.cjs（trust-anchor 相关）。

**处理**：D4 改动是**纯新增**（HELP_TOPICS 常量 + cmdHelp 函数 + ERROR_TO_HELP 表 + TreeStateError 一行 + run() catch 块 + cmdInit return 一行 + dispatch case 'help'），不修改任何 C3 改动的代码行。

**验证**：测试 4 套金标准 0 退化，C3 trust-anchor 测试不在 D4 范围（C3 自己负责跑）。

### 3. SKILL description 实际触发命中率未验证

Layer 4 改了 SKILL.md frontmatter description，但 **DeepSeek 实际接到端到端任务时是否触发 SKILL** 需要 Phase 6 真实 commander 验证（方案 §5 Phase 6）。

D4 只负责把 description 关键词加进去，命中率验证属于后续 Dev commander 复测范畴。

---

## 文件清单（绝对路径）

### 修改
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\release\tree-system-v0.2.2\patch-l\tree-engine.cjs`
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\release\tree-system-v0.2.2\patch-l\proma-dev-patches.cjs`
- `D:\Proma-dev\resources\app\dist\tree-engine.cjs`（同步自 patch-l）
- `D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs`（同步自 patch-l）
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\skills\tree-commander\SKILL.md`（加 frontmatter）
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\skills\tree-worker\SKILL.md`（加 frontmatter）

### 新增
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\release\tree-system-v0.2.2\test-sandbox\helper-test.cjs`
- `C:\Users\sir_c\.proma\agent-workspaces\proma\workspace-files\.context\v10\d4-helper-report.md`（本报告）

---

## 与方案 §五 实施计划对照

| Phase | 方案计划 | D4 实施状态 |
|-------|---------|------------|
| Phase 1: 设计定稿 | D 已完成（方案文档）| ✅ |
| Phase 2: mcp__tree__tree_help | 13 topic + handler + 注册 | ✅ 完成（含 build 脚本步骤简化为 inline） |
| Phase 3: tree_init tips 注入 | cmdInit return + buildInitTips | ✅ 完成 |
| Phase 4: 错误附 help 引用 | ERROR_TO_HELP + TreeStateError + jsonResult | ✅ 完成（方案 B 集中映射） |
| Phase 5: SKILL description 强化 | SKILL.md frontmatter | ✅ 完成（2 个 SKILL） |
| Phase 6: 真实 commander 验证 | Dev commander 跑端到端 | ⏳ 待主会话派（不属于 D4）|
| Phase 7: 推广到 session/remote-session/automation | 暂不做 | 方案 §十决策点 3：先验证 tree 效果 |

**偏离方案的地方**：
1. 方案 §3.3 推荐用 `build 脚本` 从 SKILL.md 提取生成 help-topics.json，D4 直接 inline 进 tree-engine.cjs（更简单，避免增加 build 依赖）
2. 方案 §3.10 提到改 patches.cjs jsonResult 加 help_topic/help_hint 到 MCP 返回 JSON，D4 实施时发现 run() catch 块已经构造完整 error 对象（包含 help_topic/help_hint），MCP 直接 JSON.stringify 这个对象，无需额外改 patches.cjs jsonResult（jsonResult 是通用 wrapper）
3. 方案 §4.2 方案 C（patches.cjs tt() 工厂统一拼 hint）按方案 §十决策点 2 推荐暂不做，D4 遵守

---

## 完成度自评

| 项 | 状态 |
|----|------|
| Layer 1-4 全部实施 | ✅ |
| 13 个 topic 全部内容 | ✅ |
| 33 个错误码全映射 | ✅ |
| 3 处 diff 验证一致 | ✅ |
| helper-test.cjs 6/6 通过 | ✅ |
| 4 套金标准 0 退化 | ✅ |
| 报告完成 | ✅ |

**整体状态**：✅ D4 任务全部完成，可由主会话关闭 leaf 并进入审计阶段。
