# 首个 Proma PR 草稿（Sprint 6 产品化准备）

> 维护：周星星 | 产出：2026-07-14 tree-harness 子会话
> 配套：[sprint-plan.md](./sprint-plan.md) Sprint 6 · [../01_PRD/success-metrics.md](../01_PRD/success-metrics.md) §二A 维护者维度

本文是 success-metrics 维护者维度**首个里程碑**（从「孵化」走向「合并」）的准备材料。
⚠️ **提交 PR = 外部依赖**（需用户 GitHub + 上游维护者响应），本文做**材料准备 + 适用性评估**，提交本身标记外部。

---

## 〇、TL;DR（诚实结论，颠覆任务预设）

**任务预设「选补丁 I/J（低风险易合并、独立、不依赖 tree-engine）」经核实不成立。** tree-harness 的全部 11 个补丁（A-K）都是为「研究者多实例 + 闭源插件层」设计的，**没有一个**是上游 `proma-ai/Proma` 的「低风险易合并」候选：

| 补丁 | 任务预设 | 核实结论 |
|---|---|---|
| I 禁更新检查 | 候选 | ❌ **对上游有害**：README 把"自动更新"列为桌面体验特性，禁更新违背产品方向 |
| J AppUserModelId 动态隔离 | 候选 | ❌ **上游不需要**：上游单实例，`com.proma.{NAME}` 动态化是为 dev/pro/release 三实例隔离，上游无此场景 |
| F/H 跨渠道 sdkSessionId 清除 | 备选 | ❌ **方向相反**：上游 v0.13.3 #903 刚把 sdkSessionId 清除**收敛为仅 thinking-signature 跨模型不兼容一处**，tree-harness F/H 是"跨渠道就清"（激进），与上游刚修的"过度清除致上下文丢失"bug 相反 |

**真正可行的首个 PR 路径不是「提交现成补丁」，而是「在上游 v0.13.x 源码里找一个上游也有的真实改进点，做适配的 TS 源码 PR」**。本文 §四给出推荐方向。

这个结论本身就是 Sprint 6 的**关键诚实修正**——success-metrics 维护者维度"补丁合并率"的基线不应是"提交 N 个现成补丁等合并"，而是"找到上游真正需要的改进"。

---

## 一、上游事实修正（颠覆 success-metrics 的前提假设）

success-metrics / sprint-plan / product-positioning 反复假设「向 `ErlichLiu/Proma` 上游提 PR」。**经 GitHub 核实，事实如下**：

| 维度 | 文档假设 | 核实事实 |
|---|---|---|
| 上游仓库 | `ErlichLiu/Proma` | **`proma-ai/Proma`**（`ErlichLiu/Proma` 是 release 分发别名，仓库主体在 proma-ai 组织） |
| 仓库可触达 | 隐含开源 | ✅ **AGPL-3.0 开源**，社区版完整源码 |
| 技术栈 | （未明确） | **Bun workspace monorepo + TypeScript**（`apps/electron/src/main/lib/*.ts`），非打包后 minified main.cjs |
| 维护者态度 | 待提交试探 | ✅ **设 PR Bounty（赠金）计划，明确欢迎 PR**（README「贡献」节 + PR Bounty 图） |
| 版本 | 与 tree-harness 补丁同步 | ❌ **已迭代到 v0.13.3**，tree-harness 补丁针对 **v0.12.x**，**版本不同步** |
| 上游关键修复 | （未知） | **v0.13.3 #903 已自行处理 sdkSessionId 清除逻辑**（见 §三补丁 F/H） |

**对 success-metrics 的影响**：维护者维度"补丁合并率"的分子分母都需重新定义。不是"tree-harness 补丁 → 上游"，而是"基于 tree-harness 研究经验，为上游 v0.13.x 贡献适配的源码改进"。

---

## 二、补丁形态的根本障碍：sed 补丁 ≠ 源码 PR

tree-harness 全部补丁是针对**打包后 minified main.cjs** 的 sed 字符串替换（apply-patches.sh）。上游是 **TypeScript 源码**（`agent-session-manager.ts` / `agent-orchestrator.ts` / `chat-service.ts` 等）。

- **上游不接受 minified main.cjs 的 patch**——PR 必须是 TS 源码修改。
- 每个 sed 补丁要 PR 上游，必须**反向适配成 TS 源码改动**：定位上游对应函数 → 理解上游实现 → 提等价的最小源码修改 → 验证不破坏上游测试。
- 适配工作量 ≈ 重新实现（sed 补丁的"哪里改"信息在 minified 代码里几乎不可读，等于重新做需求分析）。

这是"上游适用性"的核心成本，不是"复制粘贴 sed 命令"。

---

## 三、补丁逐个上游适用性评估

### 补丁 I：禁用更新检查（`initAutoUpdater` 首行 return）

```bash
sed 's/function initAutoUpdater(mainWindow2) {\n  win = mainWindow2;/...return;.../'
```

- **tree-harness 用途**：dev/pro/release 三实例不被官方更新覆盖（研究者运维需求）。
- **上游价值**：❌ **有害**。上游 README 明确「桌面体验：自动更新」是产品特性。上游用户**需要**更新。提交"禁更新"PR 等于让上游自废武功。
- **结论**：**不可 PR 上游**。这是研究者多实例运维的私有需求，不是产品改进。

### 补丁 J：AppUserModelId 动态隔离（`com.proma.{NAME}`）

```bash
sed 's/...requestSingleInstanceLock()/...setAppUserModelId(`com.proma.${PROMA_INSTANCE_NAME}`).../'
```

- **tree-harness 用途**：三实例任务栏图标区分（dev 白 / pro 绿 / release 珊瑚）。
- **上游价值**：❌ **场景不存在**。上游是单实例应用（`requestSingleInstanceLock` 本就保证单实例）。动态 AppUserModelId 是为绕过单实例锁做多开，上游无此需求。
- **边界**：若上游未来想做"用户自定义实例标识/多开"，这个思路有参考价值，但当前不是 PR 候选。
- **结论**：**不适合首个 PR**。

### 补丁 F（v0.12）/ H（v2）：跨渠道 sdkSessionId 清除

```bash
# F: channelId 不一致 → 清 sdkSessionId
# H: channelId 或 modelId 任一变化 → 清 sdkSessionId + 同步 meta
```

- **tree-harness 用途**：v0.12 时代 UI 切换渠道报 "Session 已失效"，靠"跨渠道就清"规避。
- **上游事实**：❌ **方向相反，已被上游 #903 否决**。上游 v0.13.3 release notes #903 明确：
  > 「长任务断连后上下文保留……将 `sdkSessionId` 的主动清除**收敛为仅 thinking-signature 跨模型不兼容这一处**——此前 session-not-found 等场景也会误清。」

  上游发现"清除 sdkSessionId → resume 指针丢失 → 上下文冷启动从零重做"是更严重的 bug，所以**收敛清除**。tree-harness F/H 的"跨渠道就清"正是上游刚修掉的"过度清除"。
- **结论**：**不可 PR 上游**。补丁 F/H 是 v0.12 时代的权宜，上游 v0.13.x 已用更优方案（保留 resume + 仅 thinking-signature 清）覆盖。

### 补丁 A（MCP 钩子）/ B（API 桥接 + 插件加载）

- **A**：`global.__proma_getMcpServers__` 动态注入 MCP server。上游已有工作区级 MCP 配置（README「Skills & MCP」），是否需要"SDK 调用时动态注入"取决于上游架构——**需源码核实**，中价值。
- **B**：导出 12 个 API 到 `global.__proma__` 供闭源插件调用。**上游不需要**（上游没有 ADDENDUM 闭源插件层，所有逻辑在源码内）。
- **结论**：A 中价值但需核实，B 不适合。

### 补丁 C1-5（频道+模型元数据覆盖）/ D（DeepSeek 子Agent 升级）/ E（userData 隔离）/ G（CLAUDE_CONFIG_DIR）/ K（userData 动态化）

- C/D：业务偏置（C 让 MCP 建的会话用元数据频道；D 把子 agent 模型换 V4 Pro）——上游架构可能不同，**需源码核实**。
- E/G/K：**全为多实例隔离**（PROMA_DEV / PROMA_INSTANCE_ISOLATED），上游单实例不需要。
- **结论**：C/D 中价值需核实，E/G/K 不适合。

### 总结矩阵

| 补丁 | 上游价值 | sed→TS 适配成本 | 首个 PR？ |
|---|---|---|---|
| I 禁更新 | ❌ 有害 | — | 否 |
| J AppUserModelId | ❌ 无场景 | — | 否 |
| F/H 跨渠道清 | ❌ 方向相反(#903) | — | 否 |
| B API 桥接 | ❌ 上游不需要插件层 | — | 否 |
| E/G/K 多实例隔离 | ❌ 上游单实例 | — | 否 |
| A MCP 钩子 | 🟡 中，需核实 | 高 | 备选 |
| C 元数据覆盖 | 🟡 中，需核实 | 高 | 备选 |
| D 子agent模型 | 🟡 偏置，需核实 | 中 | 备选 |

**没有一个是"低风险易合并"。** 备选（A/C/D）都需要先在上游 TS 源码核实对应 bug/改进点是否真实存在 + 适配源码，工作量高。

---

## 四、推荐的首个 PR 路径

既然现成补丁不适用，首个 PR 应走**「基于 tree-harness 研究经验，为上游 v0.13.x 贡献适配源码改进」**。推荐方向（按可行性与上游契合度排序）：

### 方向 1（推荐）：MCP 会话的频道/模型一致性（补丁 C 的上游化）

**痛点**（tree-harness 补丁 C 的研究动机）：当 Agent 通过某种方式（SDK / 外部）创建会话时，会话元数据里的 `channelId`/`modelId` 可能与实际 SDK 调用使用的不一致，导致 API key 解密用错渠道、标题生成用错渠道。

**上游化**：在上游 v0.13.x 的 `agent-session-manager.ts` / `agent-orchestrator.ts` 里，核实「外部创建会话时 channelId/modelId 一致性」是否已被覆盖。若上游有等价 gap → 提最小源码 PR。

**为何推荐**：
- 是真实的一致性问题（非多实例私有需求），上游单实例用户也可能踩。
- tree-harness 补丁 C 的研究经验直接复用（知道痛点在哪）。
- 工作量中等（定位上游对应函数 + 最小守卫）。

### 方向 2（备选）：MCP 动态注入钩子（补丁 A 的上游化）

**痛点**：上游 MCP 是工作区级静态配置。若用户想在「特定 Agent 会话运行时动态注入额外 MCP server」（如 tree-harness 的 tree MCP），上游无此钩子。

**上游化**：核实上游 `agent-orchestrator.ts` 的 SDK 调用路径是否有动态 MCP 注入点。若有需求 → 提钩子 PR。

**为何备选**：上游可能认为工作区级配置已足够，需先在 Issue 讨论。

### 方向 3（备选）：tree-system 整体（非补丁，是 Layer 2）

tree-system（tree-engine + DbC 门禁 + 审计）本身是 tree-harness 的核心价值，但它**依赖 `global.__proma__` 桥接**（补丁 B），且是 5000+ 行闭源引擎。要 PR 上游需重构为上游接受的形态（可能是独立 package 或 SKILL 而非引擎内联）。**这是大工程，不适合首个 PR**，但可能是 v1 终极目标。

---

## 五、完整 PR 材料（按方向 1 准备，提交前需源码核实）

> ⚠️ 以下材料是**模板**，`[需源码核实]` 处必须在 clone 上游 v0.13.x 源码、定位对应函数后填实。提交前不可跳过。

### PR 标题（草）

```text
fix(agent-session): ensure channelId/modelId consistency for externally-created sessions
```

### PR 描述（草）

```markdown
## 问题
[需源码核实] 当 Agent 会话通过 [外部 SDK / IPC / API] 创建时，session meta 的
channelId/modelId 可能与实际 SDK 调用不一致，导致：
- API key 用错渠道解密（decryptApiKey(channelId)）
- 标题自动生成用错渠道
- 跨渠道切换时 sdkSessionId 状态错乱

## 根因
[需源码核实，定位 agent-session-manager.ts / agent-orchestrator.ts 对应函数]

## 修复
在 [函数] 加最小守卫：[channelId/modelId 一致性校验 / 优先用 meta 值]。

## 不做什么
- 不改 sdkSessionId 清除策略（v0.13.3 #903 已收敛为仅 thinking-signature，本 PR 不触碰）
- 不引入多实例概念

## 测试
- [ ] bun test 通过
- [ ] 新增 [一致性] 测试用例
- [ ] typecheck 通过

## AGPL 合规
本改动基于对上游 v0.13.x 源码的独立分析，不包含任何闭源衍生代码。
```

### 合并理由（给维护者）

1. **架构契合**：补丁是上游已有函数的最小守卫，不引入新概念（无多实例/无插件层）。
2. **可维护**：改动集中、有测试、符合上游「TypeScript 不用 any / 新增 IPC 同步改 shared+main+preload+renderer」约定。
3. **AGPL 合规**：源码级独立改动，不携带 tree-harness 闭源 ADDENDUM 组件。
4. **低侵入可回滚**：单一守卫，revert 成本低。

### 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 上游已用其他方式覆盖此 gap | 中 | 提交前源码核实；若已覆盖，转 Issue 讨论 |
| 适配 TS 源码时理解偏差 | 中 | 先在上游 fork 跑通 + bun test |
| 版本漂移（上游 v0.13.3 → 新版） | 低 | PR 基于最新 main |
| 维护者认为非问题 | 中 | PR 描述给清晰复现 + 实证 |

### 回滚方案

- PR 级：单 commit，revert 一步。
- tree-harness 侧：本 PR 不动 tree-harness 任何文件（tree-harness 补丁 C 仍独立维护，二者不耦合）。

---

## 六、外部依赖（提交 PR 需要的，子会话做不了）

| 外部步骤 | 谁做 | 阻塞 |
|---|---|---|
| clone 上游 `proma-ai/Proma` v0.13.x 源码 | 用户/后续会话 | 方向 1 的「源码核实」 |
| 在上游 fork 验证 gap 真实存在 + 复现 | 用户/后续会话 | PR 描述填实 |
| fork 到 `orphiczhou/Proma`（已存在）+ 提 PR | 用户 GitHub | 实际提交 |
| 上游维护者 review/merge | ErlichLiu | 合并率数据（success-metrics §二A） |

> 注：`orphiczhou/Proma`（fork，patch-kit 所在仓）已存在（patch-kit README 第 47/425 行 clone 地址证实）。首个 PR 从这个 fork 提到 `proma-ai/Proma`。

---

## 七、对 success-metrics 的修正建议

基于本文发现，success-metrics §二A 维护者维度需修正：

| 原指标 | 修正 |
|---|---|
| 补丁合并率（提交→合并）≥60% | "提交"的定义从"tree-harness 补丁"改为"为上游适配的源码 PR" |
| 关键补丁合并数 ≥5/12 | "12 补丁"前提不成立（多数不适合上游），改为"上游接受的改进点数" |
| 上游仓库 | `proma-ai/Proma`（非 `ErlichLiu/Proma`） |

这些修正待用户确认后回写 success-metrics.md。

---

## 八、不做什么（诚实边界）

- **不强行提补丁 I/J**：明知对上游有害/无场景，提了浪费维护者时间 + 损害 tree-harness 信誉。
- **不凭 sed 补丁臆造 TS 源码 PR**：必须源码核实，否则是猜测。
- **不碰 tree-engine/patches 闭源组件**：它们是 ADDENDUM 闭源，不能进上游 PR。
- **不替代用户的 GitHub 操作**：提交是外部依赖，子会话只准备材料。

---

## 九、方向 1 源码核实实证（W2 · 2026-07-15 clone 核实）

> 本节是对 §四方向 1 + §五模板中所有 `[需源码核实]` 占位的**实证回填**。核实基于 clone 上游 main 的真实 TS 源码，给出 file:function:line 级证据。
> 维护：thdev-B-worker（W2）｜ 产出：2026-07-15

### 9.1 核实方法与版本事实（含重要修正）

- **clone**：`proma-ai/Proma` main → `D:/codes/Proma-upstream`（exit 0，未污染 tree-harness 仓）。
- ⚠️ **版本修正**：clone HEAD = **v0.14.20**（`apps/electron/package.json` version），**已超出本文 §一假设的 v0.13.3**。#903 在 v0.13.3 落地，main 又向前迭代了一个小版本（最新 commit `2a3d9b37` #1142）。**首个 PR 必须 target 最新 main（v0.14.x），而非 v0.13.3**。
- **#903 commit 实证**（`git log`）：
  - `2c9408c9` `refactor(agent): sdkSessionId 清除收敛为仅 thinking-signature 一处 (#903)`
  - `58773654` `fix(agent): 长任务断连后保留 sdkSessionId，避免上下文丢失重启 (#903) (#905)`
  - 源码注释佐证（`agent-orchestrator.ts:674-677`）：「仅在确定旧会话永久无效时（thinking-signature）才清除磁盘 meta；其余场景保留，新 SDK 会话产生的 sdkSessionId 会通过 onSessionId 回调自动覆盖。」

### 9.2 gap 真实性判定：**部分真实 ——「stale-meta 漂移」**

方向 1 的原表述「create_session 后 channelId/modelId 与实际 SDK 调用不一致」**经核实需精确化**：上游不存在「create_session 写 A、紧接着 SDK 调用用 B」的直接矛盾（创建路径与运行路径在 automation/collaboration 场景下是一致的，见 9.3）。真实 gap 是更隐蔽的**「session.meta 的 channelId/modelId 创建后永不回写，却被功能性消费者读取」**：

| 维度 | 核实结论 | 证据 |
|---|---|---|
| 创建时写入 | ✅ `createAgentSession` 把 channelId/modelId 直接存入 meta | `agent-session-manager.ts:188-205` |
| 运行时取值 | ✅ `sendMessage` 用**每次调用的 input** channel/model，不读 meta | `agent-orchestrator.ts:789,879,895`；`generateTitle:547-566` |
| 运行后回写 | ❌ **从不**把 input 的 channel/model 同步回 meta | 全仓 `updateAgentSessionMeta(...channelId/modelId)` 零命中 |
| 创建后任何路径更新 | ❌ **无**。3 个通用 IPC 更新器仅 pin/archive/completion | `ipc.ts:1828(TOGGLE_PIN)/1843(CLEAR_COMPLETION_STATE)/1860(TOGGLE_ARCHIVE)` |
| 对照（CHAT 老路径） | CHAT 有 `updateConversationMeta({modelId,channelId})`，Agent 没有 | `ipc.ts:1201` |
| 功能性消费者读取 | ⚠️ **存在**，会读到陈旧值 | 见 9.3 第 4 点 |

**结论：gap 真实，但属「陈旧元数据漂移」而非「创建即矛盾」。** 当 input 的 channel/model ≠ 创建默认值时（UI 会话中途切换渠道 / automation 复用 session 模式），meta 与实际运行值发散，功能性消费者读到错误值。

### 9.3 定位（file:function:line）

1. **写入点（唯一）**：`agent-session-manager.ts:188` `createAgentSession(title?, channelId?, workspaceId?, modelId?)` → `:197-205` 写入 meta，**此后全生命周期不再变更**。
2. **运行取值点**：`agent-orchestrator.ts:788` `sendMessage(input)` → `:789` 解构 `channelId/modelId`（来自 input）；`:879` `getChannelById(channelId)`；`:895` `decryptApiKey(channelId)`；`:547-566` `generateTitle({channelId,modelId})`。**全部用 input 值，零回写**。
3. **IPC 透传点**：`ipc.ts:2208-2219` `AGENT_IPC_CHANNELS.SEND_MESSAGE` → 直接 `runAgent(input, ...)`，**不与 session.channelId 做一致性校验/同步**。
4. **功能性消费者（读到陈旧值即受害）**：
   - `agent-collaboration-tools.ts:375,411,465` —— 委派摘要/恢复 `getDelegationSummary` 读 `session.channelId/modelId`。
   - `feishu-bridge.ts:542,562` —— 飞书 Session 镜像用 `session.channelId ?? default ?? settings` 作为镜像绑定渠道（**首选 session 值**），`:563` modelId 却走 `botConfig.defaultModelId`（与 session 解耦，本身也是一处不一致）。
5. **发散场景**：
   - UI 会话中途切换渠道：renderer **无任何 IPC 能更新 Agent session 的 channelId/modelId**（9.2 表已证），故切换后 session.channelId 停留在创建默认值。
   - automation 复用模式：`automation-scheduler.ts:156` `reuseSessionId` + `:207-208` 运行用 `automation.channelId/modelId`，若 ≠ 复用 session 的存储值 → 漂移。（新建模式 `:158` 创建与 `:207-208` 运行同值，一致。）
6. **#903 清除点（不可触碰）**：`agent-orchestrator.ts:677,1758,2126` 均为「仅 thinking-signature 清 sdkSessionId」。

### 9.4 与 #903 的关系（方向调整的关键）

- 方向 1 的修复**必须是「把实际使用的 channel/model 回写 meta」**（一致性强化），**绝不是「channel 变化就清 sdkSessionId」**（后者即补丁 F/H，已被 #903 commit `2c9408c9` 明确否决为「过度清除致上下文丢失」）。
- 二者**同向不冲突**：#903 的哲学是「保持 session 状态真实、不过度清除 resume 指针」；本修复补的是「**写入真实值**」这一面 —— 让 meta 的 channel/model 如实反映运行实际，同时**完全不动 sdkSessionId**（resume 指针照常保留；channel 真变了时新 sdkSessionId 由 `:675` 所述 onSessionId 回调自动覆盖）。
- 这是把草案 §五「不做什么」里「不改 sdkSessionId 清除策略」从承诺升级为**架构论证**。

### 9.5 TS 改动草案（最小守卫）

**位置**：`agent-orchestrator.ts` `sendMessage` 内，API Key 解密成功（`:907`）之后、`activeSessions.set`（`:909`）之前。此时 channel 已校验、key 已解密，且尚未抢占槽位。

```ts
// 2.2 同步本轮实际使用的 channelId/modelId 到 session meta
// 避免存储值与运行值漂移（功能性消费者：飞书镜像 feishu-bridge.ts:542、
// 委派摘要 agent-collaboration-tools.ts:375 会读取 session.channelId/modelId）。
// 与 #903 同向：仅写入真实值，绝不触碰 sdkSessionId / resume 指针。
// 只覆盖入参确实提供的字段（modelId 在 IPC 路径可能为 undefined，不可误清）。
try {
  const currentMeta = getAgentSessionMeta(sessionId)
  if (currentMeta) {
    const updates: Partial<AgentSessionMeta> = {}
    if (channelId !== undefined && currentMeta.channelId !== channelId) {
      updates.channelId = channelId
    }
    if (modelId !== undefined && currentMeta.modelId !== modelId) {
      updates.modelId = modelId
    }
    if (Object.keys(updates).length > 0) {
      updateAgentSessionMeta(sessionId, updates)
    }
  }
} catch { /* 会话可能已删除 */ }
```

**为什么只覆盖已定义字段**：IPC Agent 发送路径（`ipc.ts:2209`）的 `AgentSendInput.modelId` 可能为空，若用 `{ channelId, modelId }` 整体写入会把已存在的 modelId 误清为 undefined。逐字段守卫避免回归。

**改动量**：单点、约 15 行、无新概念、无新 IPC、无多实例/插件层。完全符合 §五「合并理由」的架构契合 + 低侵入可回滚。

### 9.6 测试方案

1. **单元测试**（`agent-session-manager.test.ts` 已存在）：建 session(channelId=A, modelId=M1)，模拟 `sendMessage` 入参 (channelId=B, modelId=M2)，断言 `getAgentSessionMeta(id).channelId === 'B' && modelId === 'M2'`。
2. **不误清回归**：建 session(modelId=M1)，`sendMessage` 入参 modelId=undefined，断言 session.modelId **仍为 M1**（守卫不覆盖空值）。
3. **不动 sdkSessionId 回归**：建 session(sdkSessionId=S, channelId=A)，`sendMessage` 入参 channelId=B，断言 session.sdkSessionId **仍为 S**（#903 resume 保留不被破坏）。
4. **现有套件**：`bun test`（agent-session-manager.test / agent-model-routing.test / agent-workspace-manager.test 等）全绿 + `tsc --noEmit` typecheck 通过。

### 9.7 就绪度与诚实风险评估

**就绪度：~65-70%（可提交，但非「一眼就合」）。**

| 风险 | 等级 | 缓解 |
|---|---|---|
| 维护者认为 session.channelId 是「创建默认值，by design 不可变」 | **高** | 以 9.3 第 4 点反驳：飞书镜像/委派摘要**功能性读取**它 → 它必须反映真实 → 不是纯元数据。领投用 feishu-mirror 漂移做 concrete harm。**或先开 Issue 讨论「session.channelId 语义」再提 PR。** |
| UI 是否允许 Agent 会话中途切渠道（若锁定则 gap 收窄） | 中 | 残留核实项（9.8）；即便 UI 锁定，automation 复用 + 飞书镜像仍成立 |
| 版本漂移 v0.14.20 → 新版 | 低 | PR 基于 main HEAD；本核实已在最新 main 验证 |
| modelId undefined 误清 | 低 | 9.5 守卫逐字段覆盖 + 9.6 回归测试覆盖 |

**诚实建议**：方向 1 是「一致性强化」PR，不是「修明显崩溃」。最稳路径是**先开一个 Issue**（标题如「Agent session channelId/modelId never synced after creation → stale in feishu mirror & delegation summary」），附 9.3 证据，让维护者先确认「session.channelId 应为创建默认还是当前值」的语义，再提 PR。这避免「by design」被直接关 PR 的风险，也符合 §六「外部依赖需维护者响应」的现实。

### 9.8 残留核实项（提 PR 前需补）

- [~] **renderer 侧**：Agent 会话 UI 是否允许中途切换渠道/模型？若允许 → 切换后 AgentSendInput 带新值、session.meta 不更新（本 gap 的 UI 路径实证）；若锁定 → gap 收窄到 automation 复用 + 飞书镜像。需读 `apps/electron/src/renderer/components/agent/*` + `atoms/agent-atoms.ts`。
  - **[部分闭合 · 2026-07-15 W2 复核]** 已在 IPC 层证明：main 侧无任何「更新 agent session channelId/modelId」的 handler——§9.2 已全量枚举 `updateAgentSessionMeta` 调用点（30+），IPC 通道仅 `TOGGLE_PIN`(`ipc.ts:1828`)/`CLEAR_COMPLETION_STATE`(`:1843`)/`TOGGLE_ARCHIVE`(`:1860`)/`RENAME`(`:1780`)/`SET_PERMISSION_MODE`(`:2310`)/`ATTACH_DIR`(`:2568,2584`)/`ATTACH_FILE`(`:2608,2622`)，无一写 channel/model。故 renderer **即便** UI 暴露切换入口，也无对应 IPC 能持久化 → 切换后 `AgentSendInput` 带新值而 meta 停留旧值，**gap 在 IPC 层已成立，不依赖 renderer 是否锁定**。renderer 核实仅用于判断「UI 是否暴露该入口」(影响严重度评级，不影响 gap 存在性)。
- [x] **复现路径已锁定**：automation reuse 模式 = 最干净实证——`automation-scheduler.ts:156` 复用旧 session（存储 channel A）+ `:207-208` 运行用 `automation.channelId`(B)，无需 UI 即可触发 stale-meta（见 9.3 第 5 点，源码已核实）。
- [ ] feishu-bridge.ts:563 modelId 走 `botConfig.defaultModelId` 而非 session.modelId —— 是否应一并统一为 session.modelId（另一处不一致，可纳入本 PR 或单列）。
- [ ] 在上游 fork 实跑复现：建 session(channel A) → 中途用 channel B 发消息 → 查 feishu 镜像绑定记录的渠道（实证 9.3 第 4 点的 harm）。

### 9.9 小结

方向 1 **成立但需语义前置确认**：gap 真实（stale-meta 漂移，源码实证）、修复最小（sendMessage 单点守卫 ~15 行）、与 #903 同向不冲突、有测试抓手。主要不确定性是维护者对「session.channelId 语义」的判定 —— 故推荐 **Issue 先行 → PR 跟进**，而非直接砸 PR。这与本文 §〇「找到上游真正需要的改进」+ §六「提交是外部依赖」的诚实基调一致。
