# Proma 改造项目 — 开发指南

> 文档类型: P1 工程文档（开发）
> 维护: 周星星 | 创建: 2026-06-26
> 配套文档: [`.context/PROJECT-INDEX.md`](./.context/PROJECT-INDEX.md) | [`.context/commander-methodology-v10.md`](./.context/reference/methodology/commander-methodology-v10.md) | [`.context/tree-audit-methodology.md`](./.context/reference/methodology/tree-audit-methodology.md) | [`DEPLOYMENT.md`](./DEPLOYMENT.md) | [`TESTING.md`](./TESTING.md)

---

## 一、本地环境

### 1.1 必备工具

| 工具 | 版本 | 用途 |
|---|---|---|
| **Node.js** | 18+（推荐 v22.x） | 跑测试套件、asar 解包 |
| **Git** | 任意 | 仓库管理（`orphiczhou/proma-patches`） |
| **VSCode** | 推荐 | 编辑代码、查看 571007 行 main.cjs、调试 patches.cjs |
| **Bash** | — | `apply-patches.sh` / 测试脚本（Git Bash 或 WSL） |
| **Windows Terminal** | 推荐 | 替代 cmd.exe，支持 UTF-8 + 多标签 |

### 1.2 仓库目录结构（克隆后的视角）

```
proma-patches/                        ← orphiczhou/proma-patches 仓库根
├── apply-patches.sh                  ← 一键 sed 补丁部署（v0.16.6）
├── uninstall.sh                      ← 卸载
├── proma-dev-patches.cjs             ← 主插件（22 MCP 工具 + HTTP bridge）
├── proma-mcp-server.cjs              ← 外部 stdio MCP 桥接
├── tree-engine.cjs                   ← Tree 状态引擎（v0.7+ 内联）
├── skills/
│   ├── tree-commander/SKILL.md       ← v2.2（指挥官操作手册）
│   ├── tree-worker/SKILL.md          ← v2.2（工人操作手册）
│   ├── session-management/SKILL.md   ← v1.3.0
│   └── ...
├── tao-engine/                       ← TAO Watcher 35 条规则
├── release/
│   └── tree-system-v0.2.2/           ← 发布包快照
└── README.md / AGENT-PROMPT.md       ← 入口文档
```

### 1.3 部署后路径（与开发版同源）

```
D:\Proma-dev\resources\app\dist\
├── main.cjs                  ← 商业版（571007 行）+ sed 补丁 A-K 注入
├── preload.cjs               ← 85650 行，Electron renderer 桥接
├── proma-dev-patches.cjs     ← 主插件（约 3000+ 行）
├── proma-mcp-server.cjs      ← stdio MCP 桥接
└── tree-engine.cjs           ← Tree 引擎（4928 行，含 21 DbC + V10 八大加固）
```

### 1.4 .context/ 文档导航

`.context/` 是项目知识库（133+ 份 .md），主要入口：

| 文档 | 用途 |
|---|---|
| `PROJECT-INDEX.md` | 索引（5 分钟拿全貌） |
| `project-onboarding-guide-2026-06-25.md` | 30 分钟图形化入门向导 |
| `note.md` | 长期调研笔记（按日期追加在顶部） |
| `proma-dev-wiki.md` | 完整技术 Wiki（补丁命令 / 测试记录 / 版本历史） |
| `commander-methodology.md` | Commander 13 原则 v1.2 |
| `commander-methodology-v10.md` | V10 大规模加固工程实战沉淀 |
| `tree-audit-methodology.md` | 终局验证 × 树形体系强制执行 |
| `handoff/` | 历次交接文档（按日期） |
| `plan/` | 设计方案（v0.7 Phase A、tree-engine-inline-mcp、q3-tao-hard-constraint 等） |
| `v10/` | V10 加固专题（20+ 份报告） |
| `audit/` | 审计报告（iterative-deep-audit / tree-state-global-audit） |

---

## 二、修改 main.cjs 的铁律

### 2.1 不可从开源源码重构建

**铁律**：**禁止**从 `proma-source/`（GitHub `ErlichLiu/Proma` 开源仓库）用 esbuild 重构建 main.cjs。

**原因**：Proma 商业版包含 **15 个闭源模块**（cloudAuth、sync、billing、SDK 等），开源源码不包含这些模块。从源码构建的 main.cjs 部署到 Dev 实例后，cloudAuth 模块缺失，**直接跳登录页无法使用**。

> 已验证：6/15 前的实验中，源码构建版部署后无法登录，被废弃。

### 2.2 正确方式：商业版 main.cjs + sed 补丁

```
商业版 main.cjs (571007 行, 含 15 闭源模块)
        │
        ▼
   sed 字符串替换（补丁 A-K，11 个补丁）
        │
        ▼
   main.cjs（打补丁后）
        │
        ▼
   cp 到 D:/Proma-dev/resources/app/dist/main.cjs
```

完整 sed 补丁命令清单见 `.context/proma-dev-wiki.md` §5（基础补丁 + 插件系统补丁 A-K）。

### 2.3 备份策略（**铁律**）

每次修改前**必须**备份：

```bash
DATE=$(date +%Y%m%d)
TAG="pre-XXX"   # 描述性后缀，如 pre-v10-auditor-active

cp D:/Proma-dev/resources/app/dist/main.cjs \
   D:/Proma-dev/resources/app/dist/main.cjs.bak-${DATE}-${TAG}
```

回滚直接 `cp .bak-* 回原名`。

### 2.4 补丁 H 特殊处理

补丁 H（跨频道/跨 provider 模型切换完整修复 v2）的注入内容含 `&&`，**不能**通过 shell 直接调 sed（`&&` 会被解析为命令分隔符破坏文件）。

**正确做法**：
1. 用 VSCode / Edit 工具直接修改 main.cjs
2. 或把 sed 命令写到 .sh 脚本里 `bash xxx.sh` 执行（`apply-patches.sh` 已封装）

> 历史教训：曾用 shell 直接调 sed 跑补丁 H，文件被搞乱（每次 grep `&&` 触发 sed 重跑），通过 `main.cjs.bak-20260618-bug1-v2-preexpand` 回滚。

---

## 三、patches.cjs / tree-engine.cjs 调试方法

### 3.1 直接 require 引擎验证

不需要启动 Proma 实例，直接 require 部署版引擎验证逻辑：

```bash
node -e "
const e = require('./D:/Proma-dev/resources/app/dist/tree-engine.cjs');
const treesRoot = '/tmp/test-trees';
const result = e.run('validate', ['test-tree'], treesRoot);
console.log(JSON.stringify(result, null, 2));
"
```

关键 API：

```js
// 引擎顶层导出
const engine = require('./tree-engine.cjs');
engine.run(cmd, args, treesRoot?)  // 等价 CLI stdout，永不 throw
engine.dispatch(...)               // CLI 入口
engine.setTreesRoot(path)          // 注入 treesRoot
engine.getTreesRoot()
engine.parseArgs(argv)
engine.ERRORS                     // 错误码常量表
```

### 3.2 常用调试命令

```bash
# smoke 测试（最简生命周期）
node test-sandbox/smoke.cjs

# DbC 单元测试
node test-sandbox/dbc-spec.cjs

# 对抗测试
node test-sandbox/audit-attacks.cjs

# V10 洁净室独立测试
node test-sandbox/v10-cleanroom.cjs
```

### 3.3 log 输出位置

| 组件 | 输出位置 |
|---|---|
| Proma 主进程 | Dev Tools Console（Proma-white.exe 窗口内） + `%APPDATA%/@proma/electron-dev/logs/` |
| patches.cjs `[Plugin]` 前缀日志 | 主进程 console，可在 Dev Tools 看 |
| tree-engine.cjs | 不直接 console.log；通过 `run()` 返回值查看 |
| patches.cjs `createExternalHttpBridge` IIFE 错误 | **被吞**（IIFE 内部错误不冒泡），需手动加 try/catch + console.error |

### 3.4 patches.cjs 备份策略

```bash
DATE=$(date +%Y%m%d)
TAG="pre-XXX"

cp D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs \
   D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs.bak-${DATE}-${TAG}

cp D:/Proma-dev/resources/app/dist/tree-engine.cjs \
   D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-${DATE}-${TAG}
```

### 3.5 三处源码同步（core → patch-l → dist）

tree-engine.cjs 有三处物理副本，改动后**必须**三处同步：

| 路径 | 角色 |
|---|---|
| `release/tree-system-v0.2.2/core/tree-state.js` | 逻辑源（开发版） |
| `release/tree-system-v0.2.2/patch-l/tree-engine.cjs` | 内联版（同步） |
| `D:/Proma-dev/resources/app/dist/tree-engine.cjs` | 部署版 |

同步后用 `diff` 验证逐字一致：

```bash
diff release/tree-system-v0.2.2/patch-l/tree-engine.cjs \
     D:/Proma-dev/resources/app/dist/tree-engine.cjs
# 应该为空（除了 wrapper 差异）
```

---

## 四、SKILL 文件结构与激活

### 4.1 目录结构

```
skills/
├── tree-commander/
│   ├── SKILL.md            ← 元数据 + 操作手册
│   ├── assets/             ← 自包含测试资产（dbc-spec 等）
│   └── examples/           ← 示例代码
├── tree-worker/
│   └── SKILL.md
└── session-management/
    └── SKILL.md
```

### 4.2 SKILL.md 元数据

```markdown
---
name: tree-commander
description: |
  Proma 树形会话指挥官 Skill。当用户任务复杂、需多 Agent 协作、需要保留
  子任务记录时触发。用于判断是否调用 tree-engine.cjs + mcp__tree__* 工具
  建树、派子会话、终局验收。
  触发词：「建树」「指挥官」「多 Agent」「分发任务」「并行 Agent」
  「spawn 子 Agent」「终局验收」。
version: 2.2
---

# 树形指挥官操作手册
...
```

**关键字段**：
- `name` — Skill 唯一标识（小写 + 连字符）
- `description` — 触发逻辑（关键词冗余，提高自动命中）
- `version` — 语义版本

### 4.3 激活路径

| 层级 | 路径 | 作用域 |
|---|---|---|
| **全局** | `~/.claude/skills/<skill-name>/SKILL.md` | 所有 Claude Code 会话可见 |
| **工作区级** | `<workspace>/.claude/skills/<skill-name>/SKILL.md` | 仅当前工作区 |

激活命令：

```bash
# 全局激活（推荐 tree-commander / tree-worker / session-management）
mkdir -p ~/.claude/skills
cp -r proma-patches/skills/* ~/.claude/skills/

# 工作区级激活（仅对特定 workspace 启用）
mkdir -p <workspace>/.claude/skills
cp -r proma-patches/skills/tree-commander <workspace>/.claude/skills/
```

### 4.4 SKILL description 优化（V10 沉淀）

V10 D4 Helper 报告证明：**SKILL description 关键词冗余**能显著提高自动触发命中率。tree-commander SKILL.md frontmatter 加了 15 个关键词，tree-worker 加了 7 个。

详见 `.context/v10/d4-helper-report.md`（D4 Helper 4 层自助文档系统）。

---

## 五、Git 工作流

### 5.1 主仓库

**orphiczhou/proma-patches**（GitHub，私有）— Proma 改造主仓库。

> 注：`proma-source`（南大实验目录）自 6/15 18:27 后冻结在 v0.12.23，所有补丁演进在 orphiczhou/proma-patches 外部仓库。

### 5.2 分支策略

| 分支 | 用途 |
|---|---|
| `master` | 主线，所有通过测试的提交 |
| `feature/*` | 新功能（如 `feature/v10-trust-anchor`） |
| `fix/*` | Bug 修复（如 `fix/bug-a-borrowed-identity`） |

### 5.3 commit 规范

使用 Conventional Commits：

| 前缀 | 用途 |
|---|---|
| `feat` | 新功能（如 `feat(tree-state): v0.7 Phase A — Layer 1 Hard Gate`） |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `refactor` | 重构（无行为变化） |
| `test` | 测试相关 |
| `chore` | 杂项（构建、配置、版本号） |

### 5.4 push 时机（**铁律**）

**push 前必须**：

1. `node test-sandbox/dbc-spec.cjs` 全过（48/0）
2. `node test-sandbox/audit-attacks.cjs` 全过（18 攻击 0 BYPASS）
3. V10 改动：`node test-sandbox/v10-cleanroom.cjs` + `node test-sandbox/v10-regression.cjs` 全过（54+14）
4. 重启 Dev 实例运行时验证（patches.cjs 启动时加载，必须重启）

**金标准**：6 套件 164 测试全过 = 0 退化。

### 5.5 常用 Git 命令

```bash
# 查看本地领先远程多少
git log --oneline origin/master..HEAD

# push（master 是 destructive，需用户确认）
git push origin master

# 创建 feature 分支
git checkout -b feature/v10-trust-anchor

# 合并到 master（feature 分支测试全过后）
git checkout master
git merge --no-ff feature/v10-trust-anchor
```

---

## 六、Tree 模式三层开发方法论（核心）

### 6.1 三层分离（项目独特价值）

```
┌─────────────────────────────────────────────┐
│  实现（commander）                           │
│  - 主会话（你 + Proma Agent）写代码           │
│  - 写 tree-engine.cjs / patches.cjs          │
└──────────────────┬──────────────────────────┘
                   │ 自审（容易确认偏误）
                   ▼
┌─────────────────────────────────────────────┐
│  评价（独立 SubAgent）                       │
│  - SDK Agent（Plan / code-reviewer）         │
│  - 跑 dbc-spec + audit-attacks              │
│  - 独立从代码视角找漏洞                      │
└──────────────────┬──────────────────────────┘
                   │ 仍可能与实现同源（spec 同源）
                   ▼
┌─────────────────────────────────────────────┐
│  洁净室（独立测试团队）                      │
│  - **禁看实现者测试**，从 spec 写测试         │
│  - 从攻击路径推导                            │
│  - 暴露实现者 + 评价都漏的盲点               │
└─────────────────────────────────────────────┘
```

### 6.2 为什么需要三层

**对抗确认偏误**：实现者写代码时建立了"应该没问题"的预期，写测试时会无意识地按"应该没问题"的视角构造用例。评价者读 spec + 代码后，预期被实现者的视角污染，仍漏。

**洁净室的独立性**：从 spec（SKILL.md + wiki + proposal）写测试，**禁看实现者测试代码**，能暴露实现者与评价都漏的盲点。

### 6.3 经典案例：R2-T7

6/25 V4-V9 followup 实战中，洁净室独立测试发现 `audit_append` 的 `results[i]` 内部结构校验缺失：

- spec §18.3 要求 `results[]` 每项是 `{item, pass, evidence}` 三元组
- `cmdAuditAppend`（core/tree-state.js ~L2050）只验顶层 5 字段存在
- 实现者（主会话）+ 4 评价 SubAgent **全部聚焦安全门禁**，**全部漏掉**这个 spec/impl 不一致
- 洁净室从 spec 独立写测试才暴露

详见 `.context/note.md` 6/25 R2-T7 + M2 闭环条目。

### 6.4 经典案例：V10-auditor-active

6/25 V10 Phase 1 实战中，V4-V9 加固看似完美（audit-attacks 18 攻击 0 BYPASS），但真实运行中失守：

- A1 代码层评 8/8 合格
- Cr 洁净室独立测试发现 **10 个真实失守**
- 失守案例：worker 拿僵尸 auditor 的 session_id 调 audit_gate，4 道检查全过

→ Cr 优先于 A1。详见 `.context/v10/convergence-judgment.md` + `.context/commander-methodology-v10.md`。

### 6.5 角色分工

| 角色 | 谁来做 | 工具 |
|---|---|---|
| **实现者** | 主会话（你 + Proma Agent） | 写 tree-engine.cjs |
| **测试者** | SDK Agent（Plan / code-reviewer） | 跑 dbc-spec + audit-attacks |
| **独立审计** | collaboration 真实子会话（DeepSeek V4 Pro, role=auditor） | 端到端 MCP 验证 + 对抗测试 |
| **洁净室** | 独立测试团队 | 从 spec 写测试，**禁看实现者测试** |

### 6.6 深入阅读

- [`.context/commander-methodology-v10.md`](./.context/reference/methodology/commander-methodology-v10.md) — V10 大规模加固工程实战沉淀（5h/17 节点）
- [`.context/commander-methodology.md`](./.context/reference/methodology/commander-methodology.md) v1.2 — Commander 13 原则
- [`.context/tree-audit-methodology.md`](./.context/reference/methodology/tree-audit-methodology.md) — 终局验证 × 树形体系强制执行
- [`.context/v10/convergence-judgment.md`](./.context/v10/convergence-judgment.md) — V10 双轮收敛报告

---

## 七、IHL（Iterative Hardening Loop）方法论

### 7.1 模式定义

**IHL**（盲点驱动的迭代加固）是 Proma 项目沉淀的**可复用工程方法论**：

```
盲点暴露（真实场景）
        │
        ▼
  入口补丁（在 tree-engine 关键 cmd 加校验）
        │
        ▼
  SubAgent 静态校验（code-reviewer 读代码确认逻辑）
        │
        ▼
  运行时验证（真实场景重放，验证补丁生效）
        │
        ▼
  发现新盲点（运行时仍有遗漏）
        │
        └────→ 回到「入口补丁」（下一轮）
```

### 7.2 6/26 经典案例：R1-R6 6 轮迭代加固

V10 Phase 3 Followup（详见 `.context/note.md` 6/26 18:20 条目）：

| 轮次 | Commit | 修复 | 验证 |
|---|---|---|---|
| R1 | `1a7ed5f` | applyNudge 全局守卫（补 9c423b8 tree 级规则盲点） | bugav 重置 + 巡逻 PASS |
| R2 | `031c546` | create_session workspace_id 校验 | 重启后探测 invalid id → E_WORKSPACE_NOT_FOUND |
| R3 | v626 树 | V4 Pro commander 端到端 | self_check 4/4 PASS |
| R4 | `031c546` | fork_session 同类漏洞补丁（审计驱动） | 复用 R2 helper |
| R5 | `d44163a` | 4 条 W-AUDIT-* tamper detection | 设计盲点（Tier 2 status 守卫跳过）⚠️ |
| R6 | `690f7e8` | R5 移到 Tier 1 绕开 status 守卫 | v626 巡逻 8 违规全覆盖 |

### 7.3 最终防御拓扑（3 层）

```
入口拦截层
  cmdEventAppend L1498       — 只允许 leaf.session_id 自己写 done
  cmdLeafAdd L705            — session_id 唯一性校验（E_DUPLICATE_SESSION_ID）
  create_session L461        — workspace_id 索引校验
  fork_session L601          — 同上（提取 validateWorkspaceId helper 双入口共享）

兜底守卫层
  cmdAuditGate L2337         — caller_session_id === audit_session_id（防借身份）
  resolveAuditorIndep L1897  — 白名单 + 跳过 pruned
  checkAllRules              — isSharedSessionLeaf + applyNudge sharedCount

事后检测层
  W-AUDIT-SELF               — 自审通过检测
  W-AUDIT-WORKER             — worker 当 auditor 检测
  W-AUDIT-TAMPER             — audit_log 伪造 pass=true 检测
  W-AUDIT-NO-ALIGN           — 无 alignment 留痕检测
```

### 7.4 IHL 关键洞察

1. **真实场景优先于静态审查**：R1/R2/R3 都是真实运行场景才暴露的盲点，静态审查（Plan agent + code-reviewer）漏
2. **入口拦截必须配套兜底守卫**：单点拦截总有遗漏（如 R5 设计盲点），必须多层叠加
3. **tamper detection 必须对 all leaf 跑**：R5 失败因为放在 Tier 2（status 守卫），全 done 的 v626 tree 永远检测不到；R6 移到 Tier 1 才生效
4. **每轮派一个 SubAgent** 做 code-reviewer / explorer / researcher，作为运行时验证前的廉价过滤层

### 7.5 副产品：Prompt Injection 防御

6/26 实战中收到 6 条试图诱导 root 滥用 audit_gate 的注入指令（让 root 给 worker / commander / 不存在的 leaf 标 pass）。**V10-trust-anchor 设计 + root 自律**能有效防御注入攻击 —— root 信任锚点全部拒绝响应。

### 7.6 深入阅读

- `.context/v10/v626-r5-r6-audit-tamper-detection.md` — R5/R6 完整工程设计
- `.context/v10/v626-iteration-recap.md` — R1-R4 详细
- `.context/v10/runtime-verify-2026-06-26.md` — 运行时验证（Bug A/B + TAO Watcher）

---

## 八、常见开发任务

### 8.1 加一个新 DbC 校验点（参考 V4-V9 模式）

**步骤**：

1. **定位**：在 `tree-engine.cjs` 的对应 cmd 函数（如 `cmdAuditGate`、`cmdLeafSetStatus`）找到插入点
2. **设计校验**：明确"堵什么攻击" + "校验什么字段" + "什么错误码"
3. **写代码**：在 cmd 入口前置 throw `TreeStateError(E_XXX, ...)`
4. **加单元测试**：编辑 `test-sandbox/dbc-spec.cjs`，加 CASES.XXX 用例
5. **加攻击向量**：编辑 `test-sandbox/audit-attacks.cjs`，加 attack 用例
6. **三层验证**：实现 → 评价（SDK code-reviewer）→ 洁净室（从 spec 写测试）
7. **三处同步**：core → patch-l → dist
8. **重启 Dev 实例**运行时验证

**模式参考**（V4-V9 现有 9 个硬约束点）：

| 点 | 位置 | 堵的攻击 | 错误码 |
|---|---|---|---|
| V8 | cmdLeafAdd | node_budget=0 被 `\|\|10` 短路 | E_TREE_NODE_BUDGET_EXCEEDED |
| V6 | cmdEventAppend(done) | self_check 全 pass:false | E_SELFCHECK_INVALID |
| V5b | cmdAuditGate(pass) | brief_echo 无 alignment 绕对齐留痕 | E_ALIGNMENT_NOT_VERIFIED |
| V4 | cmdMilestoneSetResult | milestone set-result 无条件 audit_pass=true | E_AUDITOR_NOT_INDEPENDENT |
| V9 | cmdLeafSetStatus(done) | expect_outputs 绝对路径/symlink | E_DELIVERABLE_MISSING |

**踩坑**（V5b 修正案例）：
- 原查 `alignment_pending` 布尔标志（可被 `tamperLeaf` 直接篡改绕过）
- 改为查 **events 留痕**（权威）+ validate 兜底
- **铁律**：安全检查不能依赖可篡改的布尔标志，必须验可验证的事件留痕

### 8.2 加一个新 TAO 规则（参考 W-AUDIT-* 模式）

**步骤**：

1. **设计规则**：明确 rule_id（如 W-AUDIT-TAMPER）+ 触发条件 + 严重度
2. **写代码**：在 `tao-engine/rules.js` 加规则定义
3. **选 Tier**：
   - Tier 1：对所有 leaf 跑（tamper detection 必须 Tier 1，否则被 status 守卫跳过）
   - Tier 2：仅对 active leaf 跑（性能优化）
4. **加测试**：编辑 `test-sandbox/` 对应测试套件
5. **运行时验证**：用真实失守树（如 v626）巡逻

**模式参考**（W-AUDIT-* 4 条 Tier 1 规则）：

| rule_id | 触发条件 | Tier | 严重度 |
|---|---|---|---|
| W-AUDIT-SELF | audit_gate.verdict=pass + audit_session_id === leaf.session_id | 1 | high |
| W-AUDIT-WORKER | worker leaf 当 auditor | 1 | high |
| W-AUDIT-TAMPER | audit_log 直接被改出现 pass=true 异常 | 1 | high |
| W-AUDIT-NO-ALIGN | verdict=pass 但 events 无 alignment 留痕 | 1 | medium |

### 8.3 加一个新 MCP 工具（参考 proma-dev-patches.cjs 模式）

**步骤**：

1. **设计 schema**：明确工具名（`mcp__tree__tree_xxx`）+ 参数 + 返回值
2. **写 handler**：在 `proma-dev-patches.cjs` 的 `registerTreeMcpServer` 加工具定义
3. **桥接 engine**：handler 内调 `treeEngine.run(cmd, args, ws.trees_dir)`（per-call treesRoot）
4. **加 SKILL 文档**：更新 `skills/tree-commander/SKILL.md` 工具清单
5. **加 SKILL description 关键词**：V10 D4 沉淀，提高自动触发命中率
6. **加错误码引用**：扩展 `ERROR_TO_HELP` 映射表，让 Agent 犯错时反查正确用法
7. **加 D4 Helper topic**（如规则复杂）：`tree_help(topic="xxx")` 添加新 topic
8. **测试**：smoke + dbc-spec + audit-attacks 全过
9. **三处同步** + **重启实例**

**模式参考**（V10 Helper 4 层）：

| Layer | 实现 | 目标 |
|---|---|---|
| L1 元工具 | `mcp__tree__tree_help(topic)` 13 个 topic | 按需查询规则 |
| L2 注入 tips | `tree_init` 返回 `tips.next_steps` | 首次使用引导 |
| L3 错误码引用 | `ERROR_TO_HELP` 37 个错误码 + 自动挂 `help_topic` | 犯错时反向学习 |
| L4 SKILL description | tree-commander 加 15 个关键词 | 自动触发 |

详见 `.context/v10/d4-helper-report.md`。

---

## 九、代码风格与约定

### 9.1 命名

| 类型 | 约定 | 示例 |
|---|---|---|
| 函数 | camelCase | `cmdEventAppend` |
| 错误码 | E_UPPER_SNAKE_CASE | `E_AUDITOR_NOT_INDEPENDENT` |
| 常量 | UPPER_SNAKE_CASE | `ROLE_ENUM`, `LEAF_NAME_RE` |
| leaf_id | `<prefix>-<PATH_UPPER>-<role>` | `pguide-A-flow`（prefix 4-8 字符，path 大写） |
| tree_id | 小写 + 连字符 | `audit-gate-test-20260625` |
| commit | Conventional Commits | `feat(tree-state): v0.7 Phase A` |

### 9.2 LEAF_NAME_RE（关键正则）

```
^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$
```

**注意**：path 段 `[A-Z]\d*(?:[a-z]\d*)*` **不允许两个连续大写字母**（如 `RT` 非法，`R` 或 `Ra` 合法）。

历史踩坑：第一次写 CASES.R2T7 用 `addWorker(tid, 'R2T7')`，`R2T7` 中间的大写 T 不合法，导致 leaf add 静默失败。改成 `Ra` 后通过。

### 9.3 命令签名约定

```text
init <tree_id> <root_session_uuid> --root-brief '<json>' --root-dod '<json>' --audit-meta '<json>'

leaf add <tree_id> --json '<leaf_json>'
  leaf_json 字段: leaf_id, session_id, parent, path, role, model, channel, added_by
  - session_id/added_by 必须是 UUID
  - parent 是 "{tree_id}-root" 不是 "root"
  - leaf_id 命名: <prefix>-<PATH_UPPERCASE>-<role>[-<suffix>]
  - prefix 长度 4-8 字符 ([a-z][a-z0-9_]{3,7})

event append <tree_id> <leaf_id> --type <done|brief_echo|...> --json '<meta_json>'
  meta_json 字段: note/deliverable/size_bytes/self_check 等
  - self_check 必须放在 meta 里，不是 --self-check 选项
  - self_check 必须是 [{item, pass, evidence}] 非空数组

milestone add <tree_id> <leaf_id> --json '<milestone_json>'
  milestone_json 字段是 **id**（不是 milestone_id！）, description, expect_outputs

audit gate <tree_id> <leaf_id> --verdict <required|pass|fail|skip> [--audit-session-id <uuid>]
  - 参数名是 --audit-session-id（不是 --auditor-session-id）
  - audit-session-id 必须是树中真实独立 leaf 的 session_id（V2 白名单）
```

---

## 十、相关文档导航

| 文档 | 用途 |
|---|---|
| [`.context/PROJECT-INDEX.md`](./.context/PROJECT-INDEX.md) | 项目索引 |
| [`.context/commander-methodology-v10.md`](./.context/reference/methodology/commander-methodology-v10.md) | V10 大规模加固工程实战沉淀 |
| [`.context/commander-methodology.md`](./.context/reference/methodology/commander-methodology.md) | Commander 13 原则 v1.2 |
| [`.context/tree-audit-methodology.md`](./.context/reference/methodology/tree-audit-methodology.md) | 终局验证 × 树形体系 |
| [`.context/v10/`](./.context/v10/) | V10 加固专题（20+ 份报告） |
| [`.context/note.md`](./.context/note.md) | 长期调研笔记 |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 部署指南 |
| [`TESTING.md`](./TESTING.md) | 测试指南 |

---

## 十一、维护约定

- 新增 DbC / TAO 规则 / MCP 工具时，更新 §八（常见开发任务）的对应模式参考表
- 新增方法论沉淀（如新的 Iterative Hardening Loop 案例）追加到 §七
- 行数控制 < 700 行；超出时拆分子文档（如 `DEVELOPMENT-tao-rules.md`）
