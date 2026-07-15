# RELEASE_NOTES — v0.17.0 私有化发布

> **版本**：v0.17.0（2026-07-15）
> **发布性质**：私有化发布，包给团队内部使用，**不推公开 GitHub**
> **策略**：开源做壳（Proma 商业版 AGPL-3.0），闭源做肉（tree-engine + patches）
> **配套文档**：[CHANGELOG.md](./CHANGELOG.md) | [DEPLOYMENT.md](./DEPLOYMENT.md) | [README.md](./README.md)

---

## 一、发布范围

### 1.1 含（团队拿到的东西）

| 类别 | 内容 | 部署位置 |
|---|---|---|
| **SKILL（协议规范）** | commander SKILL（建树/派 worker/审计工作流）+ worker SKILL（5 件套/自审/done 门禁）| `~/.proma-dev/agent-workspaces/default/skills/` |
| **引擎 dist** | `tree-engine.cjs`（md5 `3efe6a2b`，含 prefix 前置校验 + isFlagged dead code 清理 + Sprint 5 max_sessions）| `D:/Proma-dev/resources/app/dist/` |
| **patches dist** | `proma-dev-patches.cjs`（含 create_session 旁路根治 + tao-watcher + max_sessions 预检）| 同上 |
| **MCP 桥接** | `proma-mcp-server.cjs`（外部 stdio MCP 桥接）| 同上 |
| **部署文档** | DEPLOYMENT.md（部署/升级/回滚/已知坑）+ RELEASE_NOTES.md（本文件）| 仓库根 |

### 1.2 不含（保留内部）

| 类别 | 原因 |
|---|---|
| **源码（tree-engine.cjs / proma-dev-patches.cjs 源文件）** | 闭源肉，团队拿 dist 不拿源 |
| **CLAUDE.md（项目内部记忆）** | 内部记忆文档，不发布 |
| **事故复盘细节**（postmortem-macp2 / nanju / e2e03 / e2e04 等 `.context/active/` 文档） | 内部留痕，已脱敏为通用术语进 SKILL |
| **内部测试代号**（macp2/nanju04/e2e03/e2e04 等） | 已脱敏为「调用形式事故 / 自审事故 / 既往假阳性事故」等通用术语 |
| **内部测试基础设施**（`.context/plan/*-test.cjs`） | 团队无需跑测试，dist 已通过全量 367/0 |

---

## 二、依赖

| 依赖 | 版本 / 说明 |
|---|---|
| **Proma 商业版** | v0.12.23+（AGPL-3.0，团队自行授权）|
| **pro 实例** | 必须已按 DEPLOYMENT.md §三 部署好（D:\Proma-dev + ~/.proma-dev 隔离数据）|
| **Node.js** | 18+（推荐 v22.x，dist 内 .cjs 文件由 Electron 内置 Node 加载，无需单独装）|
| **Windows 10/11** | 主要验证平台（bat 启动脚本依赖 cmd.exe）|
| **apply-patches.sh**（可选） | 首次部署用，升级 v0.17.0 不需要（直接 cp dist）|

---

## 三、部署（团队已有 pro 实例的升级路径）

### 3.1 升级步骤

```bash
# 1. 备份当前 dist（关键，回滚依赖）
cd D:/Proma-dev/resources/app/dist
cp tree-engine.cjs tree-engine.cjs.bak-pre-v0.17.0
cp proma-dev-patches.cjs proma-dev-patches.cjs.bak-pre-v0.17.0

# 2. 部署 v0.17.0 dist（从发布包 cp）
cp <release-pkg>/dist/tree-engine.cjs D:/Proma-dev/resources/app/dist/
cp <release-pkg>/dist/proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/

# 3. md5 校验（tree-engine 应为 3efe6a2b）
node -e "console.log(require('crypto').createHash('md5').update(require('fs').readFileSync('D:/Proma-dev/resources/app/dist/tree-engine.cjs')).digest('hex').slice(0,8))"
# 期望输出：3efe6a2b

# 4. 部署 SKILL（文件级即生效，无需重启）
cp -r <release-pkg>/skills/* ~/.proma-dev/agent-workspaces/default/skills/

# 5. 完全退出 pro（含托盘），重启
#    patches.cjs 在 Electron 主进程启动时 require，必须重启加载新引擎
```

### 3.2 验证清单

部署完成后**逐项验证**：

```text
[ ] pro 启动后，agent 调 mcp__tree__tree_help(topic="how_to_init")
    → 应返回 init 命令用法 + tips.next_steps
[ ] mcp__tree__tree_validate(tree_id=<任意测试树>)
    → 返回 {ok:true, issues:[]}
[ ] tree-engine.cjs md5 = 3efe6a2b
[ ] commander SKILL §14.1a 存在（自审事故教训段）
[ ] worker SKILL §4.6 触发条件含「worker 主动自检触发」
```

### 3.3 回滚

如部署异常，立即回滚：

```bash
cp D:/Proma-dev/resources/app/dist/tree-engine.cjs.bak-pre-v0.17.0 \
   D:/Proma-dev/resources/app/dist/tree-engine.cjs
cp D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs.bak-pre-v0.17.0 \
   D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs
# 重启 pro
```

详见 [DEPLOYMENT.md §七 回滚流程](./DEPLOYMENT.md)。

---

## 四、使用入口

### 4.1 commander（指挥官）

**职责**：建树 / 派 worker / 配 5 件套 / 审计工作流 / 跨树协调。

**SKILL 入口**：`skills/tree-commander/SKILL.md`

**关键章节**：
- §1 铁律（启动第一件事：先加载 SKILL §13.5 调用形式红线）
- §13 冷启动信任锚流程（root session 作 auditor 兜底）
- §13.5 SDK SubAgent 的位置（调用形式红线 + 收敛条件 + 预算护栏）
- §14 审计工作流（§14.1 何时触发 + §14.1a 自审事故教训 + §14.2 最小审计树结构）

**典型流程**：
1. `tree_init` 建树（设 `audit_meta.review_required` / `max_sessions`）
2. `leaf_add` 派 worker（5 件套持久化进 leaf）
3. `send_message` 给 worker 发 leaf_id
4. worker done 后 `audit_gate` + `leaf_set_status done`

### 4.2 worker（工人）

**职责**：接 leaf / 读 5 件套 / 干活 / §4.6 自审 / done 门禁。

**SKILL 入口**：`skills/tree-worker/SKILL.md`

**关键章节**：
- §1 铁律（9 条）
- §2.5 worker lifecycle（启动第一件事：`tree_leaf_get` 读 5 件套）
- §4 内部自审流程（§4.2 milestone 级 + §4.6 done 前 G1-G5 多视角）
- §8 命名规范摘要（prefix ≤8 字符）

**典型流程**：
1. 收到 send_message 后第一件事 `tree_leaf_get(自己的 leaf_id)` 读 5 件套
2. `milestone_add` 拆解任务为 M1/M2/...
3. 每个 Mi 干活 + §4.2 自审
4. 全部 Mi 完成 → §4.6 G1-G5 多视角审查（**主动触发**，不等 review_required）
5. `event_append done` + `audit_gate pass` + `leaf_set_status done`

---

## 五、关键机制速查

| 机制 | 入口 | 触发条件 | 错误码 |
|---|---|---|---|
| prefix 前置校验 | `tree_init` | `root_brief.prefix` 字段存在时按 `[a-z][a-z0-9_]{3,7}` 校验 | `E_NAME_INVALID` |
| review_round done 门禁 | `leaf_set_status done` | `leaf.audit_meta.review_required` 或 `state.audit_meta.review_required` 为 true | `E_REVIEW_NOT_CONVERGED` / `E_REVIEW_FORGERY` |
| max_sessions 硬护栏 | `leaf_add` / `set-session` / `register-session` / `create_session` 旁路 | distinct session 总数 > `audit_meta.max_sessions`（默认 50）| `E_MAX_SESSIONS` |
| caller-binding | `leaf_add` / `audit_gate` / `milestone set-result` / done event / `audit_append` | caller（调工具的 session）≠ `added_by` / `audit_session_id` | `E_BORROWED_IDENTITY` |
| subagent_spawn 溯源 | `event_append subagent_spawn` | `subagent_id` 父段 ≠ 本 leaf_id，或 `status=done` 时 output_ref 不存在/空 | `E_SCHEMA_INVALID` / `E_DELIVERABLE_MISSING` / `E_DELIVERABLE_EMPTY` |
| flagged 篡改检测 | `leaf_add`（父链扫描）| 祖先 `review_evidence.flagged=true` 且 events 无 `review_round` | `E_REVIEW_FLAGGED_BLOCK` |

详细错误码速查见 [ERROR-CODES.md](./ERROR-CODES.md) + commander SKILL §13.7。

---

## 六、已知限制（诚实声明）

| 限制 | 影响 | 缓解 |
|---|---|---|
| **§4.6 worker 主动触发依赖 worker 自觉** | worker 可能自主简化判断（如把"API 文档"判为"普通文档"不开自审） | commander 写 brief 时设 `review_required=true` 让引擎门禁强制（硬防线） |
| **patches 跨树预检 false positive** | 一个 commander 跨多棵测试树时，旧树 reached(max_sessions) 会误伤新树建 worker | 每棵测试树用独立 commander session；或事后调大旧树 max_sessions |
| **API list_messages 长自主轮假信号** | commander 在单个长未提交轮内完成全部工作时 API 全程 total=1，≠卡死 | 监督进度读 tree-state.json（文件通道），禁用 API list_messages 判进度 |
| **proma-dev/release dist 落后** | release dist 未同步到 v0.17.0 | 仅 pro 部署 v0.17.0；release 待单独同步 |

---

## 七、支持

- **部署问题**：查 [DEPLOYMENT.md §八 已知部署坑](./DEPLOYMENT.md)
- **协议问题**：查 commander SKILL §13.7 错误码速查表 + `mcp__tree__tree_help(topic=<topic>)`
- **回归问题**：`mcp__tree__tree_backup` + `tree_restore` 回滚 tree-state

---

## 八、致谢

v0.17.0 是 tree-system 多轮迭代（Sprint 1-6 + e2e03/04 + 真实项目测试 + 审计补审）的成果。每个事故（调用形式事故 / 自审事故 / 假阳性事故 / 假收敛事故）都沉淀为 SKILL 的协议红线，让 LLM 多 agent 协作从"靠 prompt 求着遵守"变成"绕不过的代码强制"。
