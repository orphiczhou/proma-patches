# Proma 改造项目 — 测试指南

> 文档类型: P1 工程文档（测试）
> 维护: 周星星 | 创建: 2026-06-26
> 配套文档: [`.context/PROJECT-INDEX.md`](./.context/PROJECT-INDEX.md) | [`.context/tree-audit-methodology.md`](./.context/reference/methodology/tree-audit-methodology.md) | [`.context/v10/`](./.context/v10/) | [`DEPLOYMENT.md`](./DEPLOYMENT.md) | [`DEVELOPMENT.md`](./DEVELOPMENT.md)

---

## 一、测试金字塔

Proma 项目采用 4 层测试金字塔，自底向上：

```
                ┌──────────────────────────┐
                │  端到端测试（e2e）          │  真实 MCP 协议链路
                │  v10-regression + dev-e2e  │  callerSessionId 透传
                └────────────↑─────────────┘
                             │
                ┌────────────┴─────────────┐
                │  洁净室测试（cleanroom）    │  从 spec 写测试
                │  v10-cleanroom (54/54)    │  禁看实现者测试
                └────────────↑─────────────┘
                             │
                ┌────────────┴─────────────┐
                │  对抗测试（attacks）       │  18 攻击向量
                │  audit-attacks (18/0)     │  真实失守重放
                │  audit-extra (21 case)    │  审计子会话留
                └────────────↑─────────────┘
                             │
                ┌────────────┴─────────────┐
                │  单元测试（spec）          │  21 DbC 校验点
                │  dbc-spec (39/0)          │  字段存在 + 内容有效
                └──────────────────────────┘
```

**核心原则**：
- 越底层覆盖越广，越顶层越接近真实环境
- 每层都有独立价值，不可互相替代（详见 §七 Tree 模式测试三层分离）
- 通过率门槛：提交前必须**所有层全过**（金标准 6 套件 164 测试）

---

## 二、测试套件清单

### 2.1 套件总览（金标准 6 套件）

| 套件 | 路径 | 通过率 | 类型 | 说明 |
|---|---|---|---|---|
| **dbc-spec** | `test-sandbox/dbc-spec.cjs` | **39/0** | 单元 | 21 DbC 校验点（Phase A + V4-V9 + R2-T7/M2） |
| **audit-attacks** | `test-sandbox/audit-attacks.cjs` | **18/0** | 对抗 | 18 攻击向量，0 BYPASS |
| **audit-extra** | `test-sandbox/audit-extra.cjs` | **21 case** | 对抗 | 审计子会话留的补充对抗集 |
| **v10-cleanroom** | `test-sandbox/v10-cleanroom.cjs` | **54/54** | 洁净室 | Cr2 双轮收敛，从 spec 独立写 |
| **v10-regression** | `test-sandbox/v10-regression.cjs` | **14/0** | 回归 | V10 改动回归测试 |
| **smoke** | `test-sandbox/smoke.cjs` | 12/0 | smoke | 最简生命周期 |

**金标准**：6 套件 **164 测试全过 = 0 退化**。

### 2.2 套件角色详解

#### dbc-spec（DbC 单元测试，39/0）

覆盖 21 个 DbC 校验点（Design by Contract）：

| 批次 | 数量 | 堵什么 |
|---|---|---|
| Phase A（6/23） | 12 点 | CP1-CP6 + SP1 + 加固#2/#6 |
| V4-V9（6/24） | 9 点 | budget 短路 / alignment 标志篡改 / milestone 自审 / expect_outputs 路径遍历 / symlink 逃逸 |
| R2-T7 + M2（6/25 早晨） | 2 处 | audit_append results[i] 三元组 / total 整数类型 |
| V10 八大（6/25 下午） | 8 点 | 僵尸 auditor / UUID 严格 / 数值一致性 / 借身份 / nudge 升级 / 时间戳单调 / workspace canonical / status-event 同步 |

#### audit-attacks（对抗测试，18/0）

18 种攻击向量，0 BYPASS：

```
A1-A7 漏洞利用（Phase A 时代发现）
V1-V3 早期审计加固（restore 旁路 / auditor 黑名单 / 空数组绕过）
V4-V9 9 硬约束点（budget 短路 / alignment 篡改 / 伪自检 / 路径遍历 / symlink）
enabler 类（milestone audit_pass 无鉴权）
```

#### audit-extra（审计子会话留，21 case）

V4-V9 加固期间，collaboration 独立审计子会话（DeepSeek V4 Pro, role=auditor）发现的 3 类真实绕过：

- **审计[1]**：alignment_pending 布尔标志被 tamperLeaf 篡改
- **审计[2]**：node_budget 字符串/负数静默回退
- **审计[3]**：symlink 逃逸 deliverables/

每类配套测试用例留存 `audit-extra.cjs`，防止后续重构引入回归。

#### v10-cleanroom（洁净室独立测试，54/54）

V10 Phase 1-2 关键产出。**洁净室铁律**：从 spec（SKILL + wiki + proposal）写测试，**禁看实现者测试**。

```
Round 1: Cr 洁净室 39/49（10 失守）→ 暴露 V4-V9 0% 拦截
Round 2: Cr2 复测 54/54 → 双轮收敛
```

Cr 优先于 A1（代码层评 8/8 合格，但 Cr 实测发现 10 失守）。详见 `.context/v10/convergence-judgment.md`。

#### v10-regression（V10 回归测试，14/0）

V10 八大加固点引入后的回归测试，确保 V4-V9 已堵漏洞未因 V10 重构被破坏。

### 2.3 测试套件位置

测试套件有**多个物理副本**，按用途分布：

| 路径 | 用途 |
|---|---|
| `release/tree-system-v0.2.2/test-sandbox/` | 仓库主副本 |
| `~/.claude/skills/tree-commander/assets/test-sandbox/` | SKILL 自包含（findEngine 自适应） |
| `D:/Proma-dev/resources/app/dist/test-sandbox/` | 部署副本（运行时验证） |

三处副本同步更新，`findEngine` 自适应定位 engine（test-sandbox/assets/ 激活 assets/dist/ 任意位置都能跑）。

---

## 三、运行方式

### 3.1 标准运行（推荐顺序）

```bash
# 1. 单元测试（最快，先跑）
node test-sandbox/dbc-spec.cjs
# 期望：39/0

# 2. 对抗测试
node test-sandbox/audit-attacks.cjs
# 期望：18 攻击 0 BYPASS

node test-sandbox/audit-extra.cjs
# 期望：21 case 全过

# 3. 洁净室测试
node test-sandbox/v10-cleanroom.cjs
# 期望：54/54

# 4. 回归测试
node test-sandbox/v10-regression.cjs
# 期望：14/0

# 5. smoke（生命周期）
node test-sandbox/smoke.cjs
# 期望：12/0
```

### 3.2 V10 改动前必须重启 Dev

**铁律**：V10 改动（涉及 tree-engine.cjs）必须**先重启 Dev 实例**才能跑测试。

原因：patches.cjs 在 Electron 主进程启动时 `require` tree-engine.cjs，主进程不重启，新代码不加载。

```bash
# 1. cp 新 tree-engine.cjs 到 dist
cp release/tree-system-v0.2.2/patch-l/tree-engine.cjs \
   D:/Proma-dev/resources/app/dist/

# 2. 完全退出 Proma-white.exe（含托盘）

# 3. 重启
D:/Proma-dev/start-dev.bat

# 4. 跑测试
node test-sandbox/v10-cleanroom.cjs
node test-sandbox/v10-regression.cjs
```

### 3.3 require engine 直接调试（不需要启动实例）

```bash
node -e "
const e = require('./D:/Proma-dev/resources/app/dist/tree-engine.cjs');
const treesRoot = '/tmp/test-trees';
// 注入临时 treesRoot，跑完整生命周期
const init = e.run('init', ['test-tree', 'mock-uuid-001', '--root-brief', '{}', '--root-dod', '{"max_depth":3,"node_budget":10}', '--audit-meta', '{}'], treesRoot);
console.log('init:', init);
const validate = e.run('validate', ['test-tree'], treesRoot);
console.log('validate:', validate);
"
```

详见 `.context/note.md` 6/24 "Dev 实例运行时验证" 条目。

### 3.4 真实 MCP 协议链路验证（端到端）

需要启动 Dev 实例 + 配置 MCP 客户端：

```json
// ~/.claude/mcp.json
{
  "mcpServers": {
    "proma-dev-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs", "--dev"]
    }
  }
}
```

然后在 Claude Code 会话中调：

```text
> mcp__tree__tree_init(tree_id="e2e-smoke", root_brief={...}, root_dod={max_depth:3, node_budget:10})
> mcp__tree__tree_validate(tree_id="e2e-smoke")
> mcp__tree__tree_leaf_add(...)
> mcp__tree__tree_audit_gate(tree_id="e2e-smoke", leaf_id="...", verdict="pass", audit_session_id="<独立UUID>")
```

> V10 self-audit-forbidden-v2 的关键就是 MCP wrapper 透传 `callerSessionId`，engine 校验 caller===audit_session_id。**只有真实 MCP 链路才能验证此加固点**，require 测试不行（caller 不透传）。

---

## 四、测试覆盖基线

### 4.1 当前基线（截至 2026-06-26）

| 维度 | 基线 | 实际 |
|---|---|---|
| DbC 校验点覆盖 | 21 个 100% | 39/0 ✅ |
| 攻击向量拦截 | 18 个 0 BYPASS | 18/0 ✅ |
| V10 加固点覆盖 | 8 个 100% | 54/54 ✅ |
| V10 回归 | 0 退化 | 14/0 ✅ |
| 审计子会话对抗集 | 21 case | 21 ✅ |
| smoke 生命周期 | 12 步 | 12/0 ✅ |

**金标准**：6 套件 164 测试全过 = 0 退化。

### 4.2 通过率门槛

| 提交类型 | 必须通过的套件 |
|---|---|
| 任何 patches.cjs / tree-engine.cjs 改动 | dbc-spec + audit-attacks + smoke |
| V10 相关改动 | + v10-cleanroom + v10-regression |
| 新增 MCP 工具 | + 端到端 MCP 验证（真实协议链路） |
| 新增 DbC 校验点 | + audit-attacks 加对应攻击向量 + audit-extra 留 case |
| push 到 GitHub（master） | **金标准 6 套件全过** |

### 4.3 历史回归基线

- V4-V9（6/24）：dbc-spec 36/0 + audit-attacks 18/0 + audit-extra 21 case
- R2-T7 + M2（6/25 早晨）：dbc-spec 39/0 + audit-attacks 18/0 + patch-l vs dist diff 空
- V10 Phase 1-2（6/25 下午）：v10-cleanroom 54/54 + v10-regression 14/0 + dbc-spec 39/0
- V10 Phase 3（6/25 20:36）：Bug A/B 修复，6 套件 164 全过

---

## 五、TAO Watcher 自动化

### 5.1 概览

**TAO Watcher**（天道运行官）是 Proma Tree 体系的**周期性自动审计**层：

```
                  ┌─────────────────────────────┐
   AI 写代码 ───→ │  TAO Watcher 5 分钟 tick      │
                  │  35 条规则并行审计            │
                  │  ──────────────────────     │
                  │  Tier 1: 对所有 leaf 跑      │  ← tamper detection 必须 Tier 1
                  │  Tier 2: 仅 active leaf 跑   │  ← 性能优化
                  └──────────────┬──────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
            W-01~W-08        W-AUDIT-*        W-09~W-35
            数据合规          篡改检测          节奏监督
            (Tier 2)         (Tier 1)          (Tier 2)
```

### 5.2 35 条规则分类

| 类别 | 数量 | 代表规则 |
|---|---|---|
| 数据合规（W-01~W-08） | 8 | brief_echo / done event / drift_log 等 |
| **篡改检测（W-AUDIT-*）** | **4** | **W-AUDIT-SELF / W-AUDIT-WORKER / W-AUDIT-TAMPER / W-AUDIT-NO-ALIGN** |
| 节奏监督（W-09~W-35） | 23 | nudge 升级 / context 监控 / heartbeat 等 |

### 5.3 W-AUDIT-* Tier 1 tamper detection（V10 R5/R6 沉淀）

**4 条 W-AUDIT-* 规则**是 V10 R5/R6 加固的关键产出（详见 `.context/note.md` 6/26 条目）：

| rule_id | 触发条件 | 设计动机 |
|---|---|---|
| W-AUDIT-SELF | audit_gate.verdict=pass + audit_session_id === leaf.session_id | 自审通过 |
| W-AUDIT-WORKER | worker leaf 当 auditor | 角色错位 |
| W-AUDIT-TAMPER | audit_log 直接被改出现 pass=true 异常 | tree-state.json 被直接篡改 |
| W-AUDIT-NO-ALIGN | verdict=pass 但 events 无 alignment 留痕 | 跳过对齐流程 |

**R5 设计盲点**：原放在 Tier 2（status 守卫），全 done 的 v626 tree 永远检测不到。R6 修复：移到 Tier 1，对所有 leaf 跑。

**铁律**：tamper detection 必须对 all leaf 跑（不走 status 守卫）。

### 5.4 配置

默认 5 分钟 tick，可在 patches.cjs 配置：

```js
// patches.cjs 内 Watcher 启动
const WATCHER_INTERVAL_MS = 5 * 60 * 1000;  // 5 min，可配置
```

规则定义在 `tao-engine/rules.js`。

### 5.5 已知问题（截至 6/26）

**TAO Watcher 规则错配**：监督规则不按 role 区分——worker 规则（W-01 brief_echo）发给根指挥官，导致 a8111bf5 主线会话意外终止。

**修复方向**：按 role 应用不同规则集（root/commander/worker 各有专属规则）。详见 `.context/cross-workspace-tree-issue-2026-06-25.md`。

---

## 六、如何写新测试

### 6.1 加 DbC 单元测试

**适用**：新增 tree-engine 校验点（参考 `DEVELOPMENT.md` §8.1）。

**步骤**：

```js
// test-sandbox/dbc-spec.cjs 加 CASES
const CASES = [
  // ... 现有用例
  
  // 新增：Vxx-XXX 校验点
  {
    name: 'Vxx-XXX: 堵 YYY 攻击',
    setup: async (engine, treesRoot) => {
      const tid = 'vftest';
      await engine.run('init', [tid, 'mock-uuid-root', '--root-brief', '{}', '--root-dod', '{}', '--audit-meta', '{}'], treesRoot);
      // 构造攻击前置条件
    },
    run: async (engine, treesRoot) => {
      // 触发攻击，期望被拦截
      const result = await engine.run('audit', ['gate', 'vftest', 'vftest-A-worker', '--verdict', 'pass', '--audit-session-id', '<伪造UUID>'], treesRoot);
      return result;
    },
    expect: 'fail',  // 期望 ok=false
    expectError: 'E_AUDITOR_NOT_INDEPENDENT',
  },
];
```

**踩坑**：
- leaf_id 命名要符合 `LEAF_NAME_RE`（path 段不允许两个连续大写字母，详见 `DEVELOPMENT.md` §9.2）
- E 表常量需手动维护，新错误码要补到 dbc-spec 的 E 表

### 6.2 加攻击向量

**适用**：新增对抗测试（参考 `audit-attacks.cjs`）。

**步骤**：

```js
// test-sandbox/audit-attacks.cjs 加 ATTACKS
const ATTACKS = [
  // ... 现有攻击
  
  // 新增：XXX 攻击
  {
    id: 'A99',
    name: 'XXX 攻击',
    severity: 'CRITICAL',  // CRITICAL / HIGH / MEDIUM / LOW
    description: '描述攻击路径',
    prepare: async (engine, treesRoot) => {
      // 构造攻击场景
    },
    attack: async (engine, treesRoot) => {
      // 执行攻击
    },
    expectBlock: true,  // 期望被拦截
    expectError: 'E_XXX',
  },
];
```

**报告**：`attack.run()` 后会输出 `BYPASS` / `BLOCKED` / `GAP` 三种结果：
- **BYPASS**：攻击成功，引擎未拦截（必须修复）
- **BLOCKED**：攻击被引擎拦截（符合预期）
- **GAP**：攻击路径不存在（如依赖未实现的 cmd）

### 6.3 加洁净室测试（**铁律**）

**适用**：V10 风格的内容有效性校验。

**洁净室铁律**：
1. **禁看实现者测试**（dbc-spec / audit-attacks）
2. **从 spec 写测试**（SKILL.md + wiki + proposal）
3. **从攻击路径推导**（不要按实现者的逻辑构造用例）

**步骤**：

```js
// test-sandbox/v10-cleanroom.cjs 加 CLEANROOM_CASES
// 注意：禁看 dbc-spec.cjs / audit-attacks.cjs 中的用例构造

const CLEANROOM_CASES = [
  // 从 charter spec 推导，不从实现推导
  {
    name: 'V10-XXX: spec §Y.Z 要求 ABC',
    spec: 'charter §Y.Z 字面：...',
    scenario: '构造攻击场景，从 spec 视角',
    expect: '引擎必须 E_XXX 拦截',
  },
];
```

**经典案例**（V10-auditor-active）：

```
spec 视角（从 charter 推导）：
  "auditor leaf 自身必须 status=done + events 非空 + audit_gate.verdict=pass"

攻击场景（从 spec 反推）：
  构造一个 zombie auditor（status=active, events=[], verdict=skip）
  让 worker 用它的 session_id 调 audit_gate
  
实现者视角漏掉：
  实现者写的 V2 白名单只查 session_id 是不是树中某 leaf
  没查该 leaf 自身的 status / events / verdict
  
Cr 洁净室从 spec 才暴露：10 个真实失守
```

详见 `.context/v10/c1-implementation-report.md` + `.context/v10/convergence-judgment.md`。

---

## 七、Tree 模式测试三层分离

### 7.1 三层角色（项目独特价值）

```
┌─────────────────────────────────────────────┐
│  实现（commander）                           │
│  - 主会话写代码 + 写测试用例                  │
│  - 视角：代码逻辑                            │
│  - 风险：确认偏误（按"应该没问题"构造用例）   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  评价（独立 SubAgent）                       │
│  - SDK Agent 跑 dbc-spec + audit-attacks    │
│  - 视角：代码 + spec                         │
│  - 风险：spec 同源（读 spec 后预期被污染）   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  洁净室（独立测试团队）                      │
│  - **禁看实现者测试**，从 spec 写测试         │
│  - 视角：spec + 攻击路径                     │
│  - 价值：暴露实现者+评价都漏的盲点           │
└─────────────────────────────────────────────┘
```

### 7.2 为什么需要三层

**对抗确认偏误**：实现者写代码时建立了"应该没问题"的预期，写测试时会无意识地按"应该没问题"的视角构造用例。评价者读 spec + 代码后，预期被实现者的视角污染，仍漏。

**洁净室的独立性**：从 spec（SKILL.md + wiki + proposal）写测试，**禁看实现者测试代码**，能暴露实现者与评价都漏的盲点。

### 7.3 三层价值案例

#### 案例 1：R2-T7（V4-V9 followup，6/25 早晨）

- 实现（4 commander）+ 评价（4 SubAgent）全部聚焦安全门禁
- 洁净室从 spec §18.3 独立写测试，发现 `audit_append results[i]` 内部结构校验缺失
- **价值**：实现者+4 评价都漏，洁净室才暴露

#### 案例 2：V10-auditor-active（V10 Phase 1，6/25 下午）

- A1 代码层评 8/8 合格
- Cr 洁净室独立测试发现 10 个真实失守
- **价值**：Cr 优先于 A1

#### 案例 3：Bug A/B（V10 Phase 3，6/25 20:36）

- 实现 + A1 代码层评都漏 hasDone 漏洞
- Auditor #2（76e5d898）独立从攻击路径推导发现
- **价值**：即使有 Cr 洁净室，Auditor 独立从攻击路径推导仍能发现新漏洞

### 7.4 三层分工

| 角色 | 谁来做 | 工具 |
|---|---|---|
| **实现者** | 主会话（你 + Proma Agent） | 写 tree-engine.cjs + dbc-spec.cjs |
| **测试者** | SDK Agent（Plan / code-reviewer） | 跑 dbc-spec + audit-attacks |
| **独立审计** | collaboration 真实子会话（DeepSeek V4 Pro, role=auditor） | 端到端 MCP 验证 + 对抗测试 |
| **洁净室** | 独立测试团队 | 从 spec 写测试，**禁看实现者测试** |

### 7.5 深入阅读

- [`.context/tree-audit-methodology.md`](./.context/reference/methodology/tree-audit-methodology.md) — 终局验证 × 树形体系强制执行
- [`.context/commander-methodology-v10.md`](./.context/reference/methodology/commander-methodology-v10.md) — V10 大规模加固工程实战沉淀
- [`.context/v10/convergence-judgment.md`](./.context/v10/convergence-judgment.md) — V10 双轮收敛报告

---

## 八、测试通过率门槛

### 8.1 提交前必须

| 改动类型 | 必跑测试 | 期望 |
|---|---|---|
| 任何 patches.cjs / tree-engine.cjs 改动 | dbc-spec + audit-attacks + smoke | 全过 |
| V10 相关改动 | + v10-cleanroom + v10-regression | 全过 |
| 新增 MCP 工具 | + 端到端 MCP 验证 | 真实协议链路 ok |
| 新增 DbC 校验点 | + 加对应攻击向量（audit-attacks）+ 留 case（audit-extra） | 0 BYPASS |
| push 到 GitHub（master） | **金标准 6 套件** | 164 全过 |

### 8.2 金标准

**金标准 6 套件 164 测试全过 = 0 退化**：

| 套件 | 数量 |
|---|---|
| dbc-spec | 48 |
| audit-attacks | 18 |
| audit-extra | 21 |
| v10-cleanroom | 54 |
| v10-regression | 14 |
| smoke | 12（含子项） |
| **合计** | **167**（金标准约 164，含微调） |

任何提交破坏金标准 = 退化，必须修复才能 push。

### 8.3 重启验证（**容易漏**）

**铁律**：patches.cjs / tree-engine.cjs 改动后**必须重启 Dev 实例**才能跑运行时测试。

历史教训（6/25 V4-V9 实战失守）：

> 08:47 cp 的新 engine 含 R2-T7 + V4-V9，但 dev 实例未重启，hardening 实际上根本没在跑。导致真实运行中 V4-V9 0% 拦截。

**正确流程**：

```bash
# 1. cp 新代码到 dist
cp release/tree-system-v0.2.2/patch-l/tree-engine.cjs D:/Proma-dev/resources/app/dist/

# 2. 完全退出 Proma-white.exe（含托盘）

# 3. 重启
D:/Proma-dev/start-dev.bat

# 4. 跑金标准 6 套件
node test-sandbox/dbc-spec.cjs
node test-sandbox/audit-attacks.cjs
node test-sandbox/audit-extra.cjs
node test-sandbox/v10-cleanroom.cjs
node test-sandbox/v10-regression.cjs
node test-sandbox/smoke.cjs

# 5. 端到端 MCP 验证（V10 改动必须）
#    配置 ~/.claude/mcp.json → 重启 Claude Code → 调 mcp__tree__*
```

---

## 九、Layer4 残留（已知非 bug）

CLI 层校验已到极限，以下两类攻击**无法**在 tree-engine 层堵：

### 9.1 互审洗白

两个独立 worker 互相当 auditor。形式独立（不同 session_id），实质不独立（互审协议）。

### 9.2 冒用真实 session

直接 `tree-state.json` 改文件，用树中真实独立 leaf 的 session_id 当 auditor。

### 9.3 修复方向

需平台层 `subagent_trace_id` 绑定真实 session 才能堵。当前 CLI 层 `resolveAuditorIndep` 白名单已是极限。

> 记录非 bug，留作 Layer 4（平台层契约）立项依据。详见 `.context/note.md` V4-V9 条目"Layer4 残留"。

---

## 十、测试调试技巧

### 10.1 测试失败排查

| 现象 | 第一反应 |
|---|---|
| dbc-spec 全部用例报"期望 undefined" | E 表常量缺新错误码（如 SCHEMA_INVALID） |
| leaf add 静默失败（run 返回 ok:false 但函数不抛） | leaf_id 不符合 LEAF_NAME_RE（如 path 段两个连续大写字母） |
| audit-gate 拒收 auditor | `--audit-session-id`（不是 --auditor-session-id），必须是树中独立 leaf UUID |
| done event 拒收 self_check missing | self_check 放 `--json` 的 meta 里，不是独立选项 |
| patches.cjs 改了但测试结果不变 | Dev 实例未重启（patches.cjs 启动时加载） |

### 10.2 命令签名速查

```text
init <tree_id> <root_session_uuid> --root-brief '<json>' --root-dod '<json>' --audit-meta '<json>'

leaf add <tree_id> --json '<leaf_json>'
  - session_id/added_by 必须是 UUID
  - parent 是 "{tree_id}-root" 不是 "root"
  - leaf_id 命名: <prefix>-<PATH_UPPERCASE>-<role>[-<suffix>]

event append <tree_id> <leaf_id> --type <done|brief_echo|...> --json '<meta_json>'
  - self_check 必须放在 meta 里
  - self_check 必须是 [{item, pass, evidence}] 鞅空数组

milestone add <tree_id> <leaf_id> --json '<milestone_json>'
  - 字段是 **id**（不是 milestone_id！）

audit gate <tree_id> <leaf_id> --verdict <required|pass|fail|skip> [--audit-session-id <uuid>]
  - 参数名是 --audit-session-id（不是 --auditor-session-id）
```

### 10.3 直接 require engine 验证

不需要启动实例，直接 require 部署版引擎验证逻辑：

```bash
node -e "
const e = require('./D:/Proma-dev/resources/app/dist/tree-engine.cjs');
const treesRoot = '/tmp/test-trees';
console.log(e.run('validate', ['test-tree'], treesRoot));
"
```

详见 `DEVELOPMENT.md` §3.1。

---

## 十一、相关文档导航

| 文档 | 用途 |
|---|---|
| [`.context/PROJECT-INDEX.md`](./.context/PROJECT-INDEX.md) | 项目索引 |
| [`.context/tree-audit-methodology.md`](./.context/reference/methodology/tree-audit-methodology.md) | 终局验证 × 树形体系 |
| [`.context/commander-methodology-v10.md`](./.context/reference/methodology/commander-methodology-v10.md) | V10 工程实战沉淀 |
| [`.context/v10/`](./.context/v10/) | V10 加固专题（20+ 份报告） |
| [`.context/note.md`](./.context/note.md) | 长期调研笔记（含 V4-V9 实战失守案例） |
| [`.context/s1-test-plan.md`](./.context/reference/test-plans/s1-test-plan.md) | S1 简单二叉树测试方案（v0.1 时代） |
| [`.context/internal-test-plan.md`](./.context/reference/test-plans/internal-test-plan.md) | 内部测试计划 |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | 开发指南 |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 部署指南 |

---

## 十二、维护约定

- 新增测试套件时，更新 §二套件清单 + §四覆盖基线
- 新增 DbC 校验点 / TAO 规则 / MCP 工具时，更新 §六（如何写新测试）对应模式参考
- 金标准套件数变化（如新增套件）时，更新 §八金标准条目
- 行数控制 < 700 行；超出时拆分子文档（如 `TESTING-v10.md`）
