# 对照实验设计（Sprint 6 产品化验证）

> 维护：周星星 | 产出：2026-07-14 tree-harness 子会话
> 配套：[../01_PRD/success-metrics.md](../01_PRD/success-metrics.md) §三对照基线 + §六数据 gap · [sprint-plan.md](./sprint-plan.md) Sprint 6

本文设计 success-metrics §三两条基线（裸 prompt / Layer1-only）的对照实验，**解决 §六 gap**（"Layer1 含/不含 07-09 create_session budget"未界定）。
⚠️ **执行实验 = 外部依赖**（需跑真实任务，烧钱 + 时间 + 真实 agent）。本文做**设计 + 协议**，执行标记外部。

---

## 一、实验问题（要回答什么）

success-metrics §三 要求两条基线证明 tree-system 的价值：

1. **vs 裸 prompt**：tree-system 应在**质量**和**成本可控**上显著优于（速度可能持平或略优）。
2. **vs Layer1-only**：tree-system 应在「伪完成拦截 / 成本爆炸防护」上显著优于。

实验要量化回答：**在相同任务、相同模型、相同初始 prompt 下，三种模式的（速度/成本/质量）差异是多少？**

---

## 二、三模式定义（🔴 解决 §三 gap：Layer1 边界）

gap 原文（success-metrics §六）："Layer 1 含/不含 07-09 create_session budget 未界定"。本节钉死三层边界，使实验可重复：

### 模式 A：裸 prompt（baseline-prompt）

- **有什么**：人直接指挥多个 agent + 自然语言 prompt 约束（"你先做 X，你做 Y，最后汇总"）。
- **没有什么**：**零 Layer1 工具**——agent 不能 create_session/fork/send_message（无法程序化协作），不能 tree_*（无门禁）。所有协调靠人肉复制粘贴 + prompt。
- **代表**：tree-system 之前的原始多 agent 协作（macp2 事故前的状态）。
- **预期短板**：成本爆炸（无 budget）、伪完成（无审计）、协调靠人（慢）。

### 模式 B：Layer1-only（baseline-layer1）🔴 边界界定

- **有什么**：Layer1 的 22 个 session/remote MCP 工具（create_session/fork/send_message/get_session_context 等），agent 可程序化协作。
- **关键界定（解决 gap）**：
  - ✅ **含** 07-09 `create_session` budget（rate limit：单 caller 20 次/60s）——这是 Layer1 patches.cjs 的基础护栏，**属于 Layer1**。
  - ✅ **含** IPC 桥接 + 外部 MCP 接入。
  - ❌ **不含** tree-engine 任何东西（无 tree_init / 无 DbC 门禁 / 无 audit_gate / 无 TAO watcher）。
  - ❌ **不含** Sprint 5 `max_sessions`（session_registry 总量硬护栏）——**它依赖 tree-engine 的 session_registry**，属于 Layer2，不在 Layer1-only。
  - ❌ **不含** Sprint 4 workspace 锁（依赖 tree-engine leaves 定位 caller tree）。
- **代表**："有会话管理双手，无纪律层"——agent 能自由协作但无强制纪律。
- **预期短板**：仍可能成本爆炸（budget 只限单 caller 速率，不限多 caller 累积——这正是 macp2 根因）、伪完成（无审计）、跨工作区漂移（无锁）。

> **界定依据**：07-09 create_session budget 在 `proma-dev-patches.cjs`（Layer1 文件），是 rate limit（速率维度）；max_sessions 在 `tree-engine.cjs`（Layer2 文件），是 count limit（总量维度，依赖 session_registry）。两者维度不同、所在文件不同，故 budget∈Layer1、max_sessions∈Layer2。这条边界让 Layer1-only 可独立配置（只部署 patches.cjs，不部署 tree-engine）。

### 模式 C：tree-system（full）

- **有什么**：Layer1 全部 + Layer2 完整（tree-engine：27 tree 工具 + 21 DbC + V10 + audit_gate 独立审计 + max_sessions + workspace 锁 + TAO watcher + 竹节交接）。
- **代表**：tree-harness 完整产品形态。
- **预期优势**：伪完成拦截（audit_gate）、成本爆炸防护（max_sessions + 预算护栏）、可靠（竹节 + drift）。

### 配置隔离（实验可重复）

| 模式 | pro 部署 | skills |
|---|---|---|
| A 裸 prompt | 不部署 patches/tree-engine（仅原生 Proma） | 无 |
| B Layer1-only | 部署 patches.cjs，**不部署** tree-engine.cjs | 仅 session SKILL |
| C tree-system | 部署 patches + tree-engine（当前 pro 状态） | session + tree-commander/worker SKILL |

三实例（dev/pro/release）天然支持三模式并行隔离运行，不互相污染。

---

## 三、任务集（3-5 个典型任务）

### 选取标准

任务必须能**区分**三模式（即在质量/成本上有差异化表现），否则是无效对照。标准：

1. **需要多 agent**：单 agent 能做完的任务无法体现协调价值。
2. **有"走捷径"诱惑**：任务存在伪完成可能（agent 可能糊弄），才能体现审计价值。
3. **有成本失控风险**：任务可被无限拆分/重试，才能体现预算护栏价值。
4. **可客观验收**：有机器可判的完成标准（测试通过/文件产出/规范符合），减少主观。

### 任务清单（5 个，覆盖三优势维度）

| # | 任务 | 主要体现维度 | 验收标准（客观） |
|---|---|---|---|
| T1 | **多文件并行开发**：给定接口 spec，拆成 3-4 个独立模块并行实现 + 集成测试通过 | 速度（并行）+ 成本 | 集成测试全绿 + 模块间接口契约不破 |
| T2 | **代码审查 + 独立审计**：实现一个有微妙 bug 的功能（如并发写），三层（实现/评价/洁净室）审查 | 质量（伪完成拦截） | auditor 抓出的 bug 数 / 实际 bug 数；洁净室失守率 |
| T3 | **长任务流式 + 上下文管理**：在一个长会话里持续推进一个演进项目（≥10 轮），中途竹节交接 | 可靠（上下文不腐化） | 最终交付完整度 + 上下文丢失次数 |
| T4 | **成本敏感任务**：一个可被无限探索的任务（如"穷举所有边界情况"），看是否预算爆炸 | 成本（爆炸防护） | 是否触发 max_sessions / 是否超预设 token 上限 |
| T5 | **对照基线（简单任务）**：单文件小功能（如排序函数 + 测试），预期三模式无显著差异 | 对照（应无差异） | 测试通过 + token 接近 |

T5 是**反对照**：若 T5 三模式差异显著，说明实验设计有混淆变量（如 prompt 不同），需排查。

### 任务参数化（控制变量）

每个任务固定：
- **模型**：commander/auditor 用同一模型（如 GLM-5.2 或 Sonnet），worker 用同一便宜模型。
- **初始 prompt**：三模式用**同一份**任务描述（仅协调方式不同）。
- **预算上限**：三模式都被告知"预算 X token"，但只有 C 有硬护栏执行。
- **重复**：每任务每模式跑 **3 次**，取中位数（降噪）。

---

## 四、指标采集协议

### 速度

| 指标 | 采集 | 单位 |
|---|---|---|
| 墙钟时间 | 任务开始（建树/首条消息）→ 验收通过的耗时 | 分钟 |
| 并行度 | 同时活跃 agent session 数峰值 | 个 |
| 串行 vs 并行比 | 实际并行执行时间 / 总依赖链长度 | 比值 |

**采集工具**：tree-state（C 模式）的 leaf created_at/last_event_ts 时间戳；A/B 模式用 session context 的 timestamp。

### 成本

| 指标 | 采集 | 单位 |
|---|---|---|
| 总 token（input+output） | 各 session context 累加 | token |
| session 数 | distinct session 总数 | 个 |
| 是否超预算 | 实际 token / 预设上限 | 布尔 + 比值 |
| 成本爆炸 | 是否触发 max_sessions / 单 caller budget / 出现 macp2 型累积 | 布尔 |

**采集工具**：`get_session_context` 逐 session 拉 token；C 模式可直接用 [aggregate-metrics.cjs](./aggregate-metrics.cjs)。

### 质量

| 指标 | 采集 | 单位 |
|---|---|---|
| 伪完成拦截率 | auditor 抓到的伪完成 / 总 done attempt | %（目标 ≥20% 说明门禁有效） |
| 洁净室失守率 | Cr 抓到失守数 / 洁净室测试数 | %（目标 ≥10%） |
| 人工抽检通过率 | 人工随机抽 N 个交付物评是否真完成 | % |
| 验收一次通过率 | 首次验收即通过 / 总任务 | % |

**采集工具**：C 模式 audit_gate verdict + audit_log；A/B 模式靠人工审计（这正是 tree-system 的价值——A/B 无自动审计）。

---

## 五、归因方法（确保差异来自模式，非混淆）

### 控制变量矩阵

| 变量 | 是否固定 | 说明 |
|---|---|---|
| 任务内容 | ✅ 固定 | 同一 spec |
| 模型 | ✅ 固定 | 同 channel+model |
| 初始 prompt | ✅ 固定 | 同一份（仅协调方式不同） |
| 预算上限（声明） | ✅ 固定 | 都被告知 X token |
| 预算执行 | ❌ 变（这是自变量） | A 无执行 / B rate limit / C 硬护栏 |
| 协调方式 | ❌ 变（这是自变量） | A 人肉 / B session 工具 / C tree |
| 操作者 | ✅ 固定 | 同一人/同一 commander prompt |

### 归因逻辑

- **T1 速度差异** → 归因协调方式（A 串行人肉 / B-C 并行程序化）。
- **T2 质量差异** → 归因是否有审计层（A-B 无自动审计 / C 有 audit_gate）。
- **T4 成本差异** → 归因护栏强度（A 无 / B rate / C rate+count+总量）。
- **T5 应无差异** → 若有，排查 prompt/模型混淆。

### 统计显著性

- n=3 重复，报告 median + range（非均值，n 太小不做 t 检验）。
- 结论用"方向性"语言（"C 显著优于 A"）而非精确 p 值，诚实承认 n 小。

---

## 六、预期结果假设（实验前预判，便于事后对照）

基于 tree-harness 实测经验（macp2 事故 / vcb2 验证 / nanju 实战）：

| 任务 | A 裸 prompt | B Layer1-only | C tree-system |
|---|---|---|---|
| T1 速度 | 最慢（人肉串行） | 快（并行） | 快（并行，略低于 B 因门禁开销） |
| T1 成本 | 高（重试无序） | 中 | 中（有护栏） |
| T2 伪完成拦截 | 0%（无审计） | 0%（无审计） | ≥20%（audit_gate） |
| T4 成本爆炸 | 高风险 | 中风险（budget 限速率不限总量） | 0%（max_sessions） |
| T5 | ≈ | ≈ | ≈ |

**核心赌注**：C 在 T2（质量）和 T4（成本）上显著优于 A/B；速度上 C ≈ B（门禁开销可忽略）但 >> A。

---

## 七、执行计划（外部依赖）

| 步骤 | 谁做 | 产出 |
|---|---|---|
| 1. 准备 3 实例（A/B/C 配置） | 用户 | 三实例隔离运行 |
| 2. 写 5 任务 spec + 验收脚本 | 后续会话 | spec/ 目录 |
| 3. 跑 T5（对照，先验证实验设计） | 用户/团队 | T5 数据 |
| 4. 跑 T1-T4（每任务每模式 3 次） | 用户/团队 | 原始数据 |
| 5. 聚合 + 归因分析 | 后续会话 | 实验报告 |
| 6. 回填 success-metrics §二B | 后续会话 | 指标从"待测"变实测 |

**成本估算**：5 任务 × 3 模式 × 3 重复 = 45 次任务运行。按每次 ~$1-5 token，总 ~$45-225 + 时间（每次 10-30 分钟，串行 ~10-20 小时）。

---

## 八、诚实边界

- **n=3 重复统计力弱**：结论是方向性的，不声称统计显著。
- **任务选取有偏**：T1-T4 都是为体现 tree-system 优势选的，可能高估 C 优势（T5 反对照部分缓解）。
- **操作者即研究者**：n=1 操作者，无法排除操作者对 C 模式更熟练的混淆（需团队试用补充，见外部 backlog）。
- **质量指标部分靠人工**：A/B 无自动审计，"伪完成"靠人工评，有主观性（这正是 tree-system 要消除的，但实验本身受其影响）。
