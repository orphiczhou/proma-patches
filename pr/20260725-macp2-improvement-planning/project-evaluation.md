# multi-agent-collab-platform 项目层改进论证

> **论证人**：项目层改进论证员  
> **论证日期**：2026-07-25  
> **论证对象**：P0-C（coder/judge 接入 LLM）、P0-D（多模型交叉 + peer audit）、P1-D（错误码重命名）  
> **数据源**：macp2-tree-evaluation-2026-07-25.md §5、§六、§7.2 + src/ 源码全文 + mlaudit-reports/ 12 P0 基线  
> **约束**：只读论证，不改代码。聚焦 multi-agent-collab-platform 项目改进，区分 proma 改造。

---

## 一、P0-C：coder/judge-stub 接入真实 LLM 调用

### 1.1 现状评估

#### coder-engine-stub.ts（593 行，17 处实质性 TODO）

| 维度 | 现状 | 严重度 |
|------|------|--------|
| **LLM 客户端** | `StubLlmClient` 返回 `'[stub] LLM 未接入，返回占位文本'` + `tokensUsed=0` | 🔴 核心阻断 |
| **generateCode** | 调 stub LLM → 跳过 sandbox 执行 → `autofixAttempts=0` → `snapshotCreated=true`（硬编码）→ 返回写死 `outputFiles/testReport{8/8/0}` | 🔴 核心阻断 |
| **applyFix** | 调 stub LLM → 返回 `modifiedFiles: ['src/components/login-form.tsx']`（硬编码）→ actual modification 未执行 | 🔴 核心阻断 |
| **runGwt** | 跳过 sandbox → 返回写死 2 个`passed` scenario → `autofixLog=[]` → `triggeredSnapshot=false` | 🔴 核心阻断 |
| **自修复循环** | `AUTOFIX_MAX_ATTEMPTS = 3` 已定义，但循环体未实现（`autofixAttempts = 0` 硬编码） | 🔴 |
| **入参校验** | `validateGenerateCodeInput` / `validateFixSpec` / `validateRunGwtInput` 三方法**全部真实实现**（projectRoot / 枚举 / action-delete-newValue 互斥） | 🟢 可复用 |

#### judge-engine-stub.ts（498 行，14 处实质性 TODO）

| 维度 | 现状 | 严重度 |
|------|------|--------|
| **runHardChecks** | 直接 `return []`，7 项硬约束全不存在（PRD 必填项 / PlantUML 语法 / API Schema / Sprint 粒度 / 角色职责 / GWT 存在性 / 代码-类图一致性） | 🔴 核心阻断 |
| **runSoftEval** | 调 `StubLlmClient` 返回 `score: 0.85`（写死），4 维度均无真实评估 | 🔴 |
| **runClassConsistencyCheck** | 返回写死 `matchedClasses: ['ProjectService', 'SnapshotService']`，不做真实 .puml 解析+代码比对 | 🔴 |
| **runGwtExistenceCheck** | 返回写死 `featuresTotal: 3, featuresWithSteps: 3`，不做 features/ + step-definitions/ 扫描 | 🔴 |
| **withSoftTimeout** | **完全未实现超时保护**：代码 `return p` + 注释 "S1 占位：直接 await"，60s 超时形同虚设 | 🔴 高危 |
| **入参校验** | `validateEvaluateDocsInput` / `validateEvaluateCodeInput` 两方法**全部真实实现**（targetDirectory 枚举 / checks 枚举 / 必填字段） | 🟢 可复用 |

#### 占位密度统计

| 文件 | GLM 计数 | MiniMax 修正 | 真实 TODO | 核心业务逻辑 |
|------|---------|-------------|----------|------------|
| coder-engine-stub.ts | 55 | 17 | 17 | 0 |
| judge-engine-stub.ts | 39 | 14 | 14 | 0 |

**GLM 把步骤注释、"S1 占位"、"S2 TODO" 标签全计数导致虚高。** 真实 TODO 密度 ~2.9%（17/593）和 ~2.8%（14/498），核心方法 `generateCode` / `applyFix` / `runGwt` / `runHardChecks` / `runSoftEval` / `runClassConsistencyCheck` / `runGwtExistenceCheck` **七者全为 0 业务逻辑**——文件名诚实标注 `-stub`，但占位密度不到 3% 不代表接近可用。

### 1.2 需实施的工件

| # | 工件 | 行数估算 | 技术难度 | 依赖 |
|---|------|---------|---------|------|
| 1 | **PromaCloudLlmClient** — 对接 Proma Cloud API（参考 proma-cloud-sdk SKILL），实现 `LlmClient` 接口，支持 GLM 5.1（coder）和 deepseek-v4-flash（judge） | 200-250 行 | 中 | mcp__proma_cloud__get_credentials |
| 2 | **coder sandbox 集成** — `generateCode` 的 Step 4：调 `sandboxManager.spawnIsolated` 在隔离环境执行 LLM 生成的代码，收集 stdout/stderr/exitCode 映射为 `testReport` + `gwtResults` | 200-250 行 | 中 | sandbox-manager.ts |
| 3 | **coder 自修复循环** — `generateCode` 的 Step 5：GWT 失败时循环调 LLM 生成修复补丁 → sandbox 重跑 → 重判，上限 3 次，超限 → `CODER_AUTOFIX_EXHAUSTED` | 100-150 行 | 中 | #2 + PromaCloudLlmClient |
| 4 | **coder 快照触发** — `generateCode` Step 6：成功后调 `snapshotManager.createSnapshot(triggerType='init')`；`runGwt` 失败时创建 `triggerType='pre-error'` 快照 | 80-120 行 | 低 | snapshot 模块 |
| 5 | **judge 7 项硬约束** — 逐项实现真实检查器：PRD 必填字段（正则扫 md）、PlantUML 语法（TS Compiler API 解析 .puml）、API Schema 完整性（解析 api-spec.md 端点表）、Sprint 粒度规则、角色职责矩阵、GWT 文件存在性、class-consistency | 400-500 行 | **高** | TypeScript Compiler API |
| 6 | **PlantUML TypeScript Compiler API 解析** — 架构 §1.2 指定用 TS Compiler API 解析 .puml 文件提取类/接口清单，是 #5 中 PLANTUML_SYNTAX_INVALID + CODE_CLASS_CONSISTENCY 两项的依赖 | 200-300 行 | **高** | typescript npm 包 |
| 7 | **judge 软约束 LLM 集成** — `runSoftEval` 替换 StubLlmClient 为真实 deepseek-v4-flash，逐维度读文档内容 → LLM 语义评估 → 返回 0-1 评分 | 100-150 行 | 中 | PromaCloudLlmClient + #8 |
| 8 | **withSoftTimeout 真实实现** — `Promise.race([p, rejectAfter(60000)])`，超时抛 `JUDGE_LLM_TIMEOUT`，被 evaluateDocs 捕获后返回 errorResponse | 30-40 行 | 低 | 无 |
| 9 | **集成胶水 + 文件存在性校验** — coder: `featurePaths` 存在性 / `_meta.json#documents` 契约校验 / `preModifySnapshotId` 存在性 / `dataAiId` 存在性 / scope 边界；judge: `_code/` 非空 / `classDiagramPath` 存在 | 150-200 行 | 低 | fs / snapshot |
| **合计** | | **~1460-1960 行** | | |

### 1.3 可行性

**可行。** 五个关键前提均满足：

1. **LLM 接入通道已就绪**：Proma Cloud API 经过 proma-cloud-sdk SKILL 验证，`mcp__proma_cloud__get_credentials` + Anthropic Messages / OpenAI Chat Completions 接口可用，coder 用 GLM 5.1（ZLM 渠道）、judge 用 deepseek-v4-flash（DeepSeek 渠道）均为已有 preset
2. **Sandbox 骨架可用**：`sandboxManager.spawnIsolated` 的 `prepareIsolation`（cwd+env 映射+路径守卫）+ `spawnIsolated`（spawn+watchdog+wallClock 超时+内存采样+SIGTERM→SIGKILL）全真实实现，仅降级监控（非 OS 级隔离）——对代码执行场景足够
3. **契约清晰**：coder/judge 接口已严格对齐 api-spec §2.2-2.4 / §4.1-4.2，TypeScript 类型在 `src/coder/types.ts` 和 `src/judge/types.ts` 中完成；入参校验已全部实现
4. **错误码体系就绪**：`CODER_ERROR_CODE` / `JUDGE_ERROR_CODE` / `SYSTEM_ERROR_CODE` 常量在 `src/common/error-codes.ts` 中完整定义，`errorResponse` 信封在 `src/common/api-response.ts` 中
5. **自修复循环设计已有**：`AUTOFIX_MAX_ATTEMPTS=3` + `autofixLog` 数据结构已定义，只需填充循环体

### 1.4 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| **PlantUML 解析复杂度超预期** | 中 | #5+#6 延后 3-5 天 | 先做正则兜底解析（覆盖 80% 用例），TS Compiler API 细致解析做 Phase 2 |
| **LLM 生成代码 quality 不可控** | 高 | 自修复循环频繁触发，耗时膨胀 | 自修复上限 3 次 + wallClock 总超时兜底；prompt 模板迭代（复用 brief 中 agent role 精准化经验） |
| **Proma Cloud 费用** | 低 | 超额消费 | `create_app_key` 设 quota 上限；自修复循环上限避免无限重试 |
| **withSoftTimeout 与 LLM 超时冲突** | 低 | judge 流程卡死 | 60s 外层超时 + LLM 调用自身有 Proma Cloud 侧超时（通常 30-120s），双保险 |
| **契约冲突（ApiResponse 信封 vs preload raw 形状）** | 中 | 联调时返回数据不可用 | 非本次范围（已知问题，macp2-A1a-worker-report.md §已知问题 已记录）；本次仅实现 SRC 侧，联调另排 |

### 1.5 工作量

| 估算维度 | 数值 |
|---------|------|
| 代码行数 | **~1500-1900 行**（中位 ~1700） |
| 开发工时 | **40-56 小时**（含 PlantUML 解析的 8-16h 不确定性） |
| 测试工时 | **12-16 小时**（硬约束 7 项的单元测试 + sandbox 集成测试 + 自修复端到端） |
| **总计** | **52-72 小时（约 7-10 个工作日）** |

按 1 名全职 dev：**1.5-2 周**。若拆分 coder 和 judge 两人并行：**1 周**。

### 1.6 优先级

**P0 — 最高优先。** 理由：

- C1 评分从 macp 基线 32/100 仅拉至 47/100（MiniMax 独立打分），主因就是 coder/judge **0 业务逻辑**。这是 C1 责任区 3 个 P0（整库可运行、沙箱、coder/judge）中**唯一未实质推进的一项**
- 没有 coder/judge 真实实现，"项目推进"维度的所有后续工作（测试、联调、端到端验证）无法开展
- 当前 macp2 树形任务的"条件 PASS"裁定已将此项列为核心下一轮重点

### 1.7 实施大纲

**Phase 1：LLM 通道 + 超时（Day 1-2，~350 行）**
- 实现 `PromaCloudLlmClient`（`src/common/proma-cloud-llm-client.ts`），对接 proma-cloud-sdk SKILL
- 实现 `withSoftTimeout` 真实超时（`Promise.race` + `rejectAfter`）
- 暴露 `createCoderEngine({ llm: new PromaCloudLlmClient({ channel: 'zlm' }) })` 等构造器入口
- 在 coder/judge 中将 `StubLlmClient` 替换为 `PromaCloudLlmClient`

**Phase 2：coder 核心链路（Day 3-4，~450 行）**
- `generateCode` 的 sandbox 回填：LLM 生成 → `sandboxManager.spawnIsolated` 执行 → 收集 testReport/gwtResults
- 自修复循环：GWT 失败 → LLM 生成 fix → sandbox 重跑 → 判定 → 循环（上限 3 次）
- 快照触发：成功后 `snapshot.createSnapshot(triggerType='init')`，失败后 `triggerType='pre-error'`
- `applyFix` / `runGwt` 同模式接入

**Phase 3：judge 硬约束 + PlantUML（Day 5-7，~500 行）**
- PlantUML 解析器（优先正则提取类/接口清单，兜底 TS Compiler API）
- 7 项硬约束逐项实现（每项 50-80 行，含正则/文件扫描/规则校验）
- 软约束 LLM 集成（读文档 → deepseek-v4-flash 语义评估 → 4 维度评分）

**Phase 4：集成胶水 + 测试（Day 8-10，~350 行 + 测试）**
- 文件存在性校验（featurePaths / _meta.json / preModifySnapshotId / dataAiId / scope）
- 单元测试：7 项硬约束每项 2-3 个 case
- 集成测试：coder sandbox 执行 + judge 文档判定端到端
- 自修复循环端到端（构造 2 个 fail + 1 次 fix 成功 case）

---

## 二、P0-D（🆕 对抗审查新增）：多模型交叉 + Commander Peer Audit

### 2.1 问题溯源

DeepSeek-v4-pro（W5）对抗审查发现两个初版评估未覆盖的维度：

1. **认知多样性退化**：macp（上轮）使用 DeepSeek/GLM/MiniMax 三模型交叉，macp2（本轮）全 GLM-5.2 单模型 —— "用结构优化换取认知同质化"
2. **commander audit 方法论漏洞**：commander 的 audit_gate 全 `skip`（因 V10 冷启动约束只有 root 能配 audit_gate），root 信任锚把信任给了 commander 但**从未验证 commander 的工作质量**——审计学意义上 "信任无验证" 等同于 "无审计"

**两个问题叠加的后果**：单一模型（GLM-5.2）的 commander 产出无人复核 → 错误/偏见/低质量产出在树内逐层放大，root 无感知。

### 2.2 方案论证

#### 2.2.1 多模型交叉

**方案**：下轮树形任务在 root brief 时即指定不同 commander 子树使用不同模型/渠道。例如：

```
macp3-root brief:
  - A-commander: DeepSeek-v4-pro / deepseek 渠道（逻辑严密型，负责架构+API）
  - B-commander: MiniMax-M3 / minimax 渠道（代码现实派，负责实现+审查）
  - C-commander: GLM-5.2 / zlm 渠道（均衡型，负责测试+文档）
```

**组织方式**：在 root 的 5 件套 brief 中为每个 commander 指定 `modelHint` / `channelHint` 字段，commander 在 `create_session` 或 `leaf_add` 时遵循。

#### 2.2.2 Commander Peer Audit

**方案**：A commander 审查 B 的产出，B 审查 C 的产出，C 审查 A 的产出（环形互审）。

**协议**：
1. A commander done 后，产出（deliverables）交 B 审查
2. B 以 `leaf_add(role=auditor, parent=自己)` 的方式建 auditor worker，或 B 自己以 commander 身份审 A 的产出
3. B 调用 `judge.evaluateDocs` / `judge.evaluateCode` 对 A 产出做独立判定
4. B 产出一份 `peer-audit-report.md`（含 verdict + hardViolations + softSuggestions）
5. B 通过 `audit_gate` / `send_message` 将 peer audit 结论上报 root
6. **关键改进**：peer audit 的结果作为 root 决策输入——如果 peer audit 发现 major 违例，root 可拒绝该 commander 的 done 声明

### 2.3 归属分析：项目改进 vs proma 改造

这是本论证的核心区分点。

| 子项 | 归属 | 理由 |
|------|------|------|
| **多模型交叉：root brief 中指定 modelHint/channelHint** | 🟡 **项目 + proma 各半** | 项目侧：定义 brief 模板中的 modelHint 字段，commander 在 create_session 时遵循（~50 行，项目层）。proma 侧：tree-harness 需要 `tree_leaf_add` 支持 model/channel 参数透传到 session 创建（引擎改造），或至少保证 create_session 可指定渠道 |
| **多模型交叉：commander 子树使用不同模型** | 🟢 **proma 改造为主** | tree-harness / tree-commander SKILL 需支持"每个 commander 从 brief 中读取 modelHint 并在 create_session 时使用"。项目层只负责在 brief 中填写 hint 字段 |
| **Peer audit：A→B→C 环形互审协议** | 🟡 **项目 + proma 各半** | 项目侧：peer-audit-report.md 模板 + 审查流程文档化（~100 行，项目层）。proma 侧：tree-commander SKILL 需增加 "commander done 后等待 peer audit 结果" 的协议步骤；引擎可能需支持 audit_gate 的非 root 背书（当前 V10 冷启动约束 root-only） |
| **Peer audit：audit_gate 放开给 commander 的 auditor** | 🔴 **proma 改造** | 这是 P0-A（放开禁 fork auditor）的延伸——引擎 V10 冷启动约束需要根修改。项目层无法自行解决 |

### 2.4 可行性

| 子项 | 可行？ | 当前障碍 |
|------|--------|---------|
| 多模型交叉（brief 指定 modelHint） | ✅ 条件可行 | 需确认 `create_session` / `leaf_add` 支持渠道参数透传（树引擎现状待查）；若不支持则需 proma 引擎改造 |
| Peer audit 协议文档化 | ✅ 可行 | 纯文档工作，无技术障碍 |
| Peer audit 的 audit_gate 非 root 背书 | ⚠️ 依赖 P0-A | 需引擎先放开 V10 冷启动约束（已列 P0-A），否则 peer auditor 撞 `E_AUDITOR_NOT_INDEPENDENT` / `E_BORROWED_IDENTITY` |

### 2.5 工作量

| 子项 | 归属 | 行数/工时 |
|------|------|----------|
| 项目层：brief 模板增加 modelHint + channelHint 字段，commander brief 协议更新 | 项目 | ~50 行 / 2h |
| 项目层：peer-audit-report.md 模板 + 环形互审流程文档（`docs/peer-audit-protocol.md`） | 项目 | ~150 行 / 4h |
| 项目层：在 test-plan 中追加 TC-PEER-* 用例（peer audit 判定 + 拒绝 + 超时场景） | 项目 | ~80 行 / 2h |
| proma 层：tree-commander SKILL 增加 modelHint 读取 + create_session 指定渠道步骤 | proma | SKILL 修订 / 4-8h |
| proma 层：tree-commander SKILL 增加 peer audit 协议步骤（commander done → wait peer → audit_gate） | proma | SKILL 修订 / 4-8h |
| proma 层：引擎放开 V10 冷启动 audit_gate 约束（P0-A 所列） | proma | 引擎修改 / 估算在 engine-evaluation.md |
| **项目层合计** | | **~280 行 / 8h** |
| **proma 层合计** | | **SKILL 修订 / 8-16h + 引擎改造（另估）** |

### 2.6 优先级

**P0 — 但分阶段交付。** 理由：

- DeepSeek 对抗审查发现的多模型同质化是**方法论层面**的漏洞，不修则下轮树形任务仍面临 GLM 评 GLM 的乐观偏差风险
- 但 peer audit 的 audit_gate 依赖 P0-A 引擎改造——可在引擎改完前先用文档 + SKILL 步骤推进，引擎就绪后切换为自动化
- 建议：**下个 Sprint 先做项目层 + SKILL 层（多模型交叉 + peer audit 协议文档化），引擎改完后自动升级**

### 2.7 实施大纲

**项目层（下个 Sprint，~8h，纯文档+模板）**

1. **`docs/peer-audit-protocol.md`**（~100 行）：定义环形互审协议
   - A 审 B / B 审 C / C 审 A 的配对规则
   - 审查维度：hardViolations（7 项硬约束）+ softSuggestions（4 维度）+ 实质完整性（产出是否回应 brief 全部要求）
   - 判定结果：pass / minor（条件 pass）/ major（建议拒绝）
   - 争议升级：major 争议上报 root 裁决
2. **`templates/peer-audit-report.md`**（~50 行）：审查报告模板
   - 审查对象（commander leaf_id / 产出文件名）
   - verdict + hardViolations 列表 + softSuggestions 列表
   - 审查人签名 + timestamp
3. **brief/commander 模板更新**（~50 行）：在 5 件套中增加
   - `modelHint` 字段：commander 子树使用的推荐模型
   - `peerAuditor` 字段：A commander 的 brief 中标注 "your auditor: B-commander"
   - `peerAuditGate` 字段：done checklist 增加 "等待 peer auditor 审查通过"
4. **test-plan 补充**（~80 行）：追加 TC-PEER-* 用例
   - TC-PEER-001：peer auditor 发现 major 违例 → commander 拒绝
   - TC-PEER-002：peer audit 超时（auditor 无响应）→ root 介入
   - TC-PEER-003：环形互审 A→B→C→A 完整闭环

**proma 层（协调 tree-harness 团队，SKILL 修订 + 引擎配合）**

5. tree-commander SKILL：增加 modelHint 读取 + create_session 渠道指定步骤
6. tree-commander SKILL：done 协议增加 peer audit 步骤（commander done → 等待 peer auditor → 收到 pass 才真 done）
7. 引擎：按 P0-A 方案 B（root 背书 auditor）放开 audit_gate 非 root 约束

---

## 三、P1-D：B2-P0-4 错误码重命名

### 3.1 现状详查

macp-B2-worker.md P0-4 原始建议：

> 将 `GUIDE_INTERNAL_JUDGE_FAILED` 重命名为 `GUIDE_JUDGE_EVALUATION_FAILED` 并收录

macp2-tree-evaluation 初版 §3.2：

> B2-P0-4 错误码收录 ... 但 GUIDE_INTERNAL_JUDGE_FAILED 未按 P0-4 要求重命名（api-spec.md:974 仍用旧名）

**实际查阅 api-spec.md §8.5（v0.4）发现：项目团队已就此事做出明确设计决策。**

api-spec.md:1006 原文：

> **命名与归属说明**（*APISPEC-SUPPLEMENT*）：`GUIDE_INTERNAL_JUDGE_FAILED` 虽以 `GUIDE_` 前缀开头，但其语义是"跨 Agent 桥接包装"（guide 调 judge 失败的 wrap），非 guide 自身业务错误……此命名前缀与归属的既有张力已在 agent-comm 标注，**v0.4 收录时保持原命名以避免破坏 agent-comm §5.3 既有的透传链引用与埋点归因。**

**结论：这是有意的设计决策，不是遗漏。** 团队在 v0.4 中选择了向后兼容（保留旧名免破坏透传链），并在文档中给出了完整的理由说明。

### 3.2 当前引用分布

| 文件 | 引用次数 | 引用形式 |
|------|---------|---------|
| `04_API_SPEC/api-spec.md` | ~10 处 | 错误码总表 §8.3 + 跨 Agent 详解 §8.5 + 命名说明 |
| `04_API_SPEC/agent-comm.md` | ~6 处 | §5.3 嵌套示例 + 版本对齐声明 |
| `04_API_SPEC/frontend-backend-api.md` | ~3 处 | 错误码映射表 + switch case |
| `06_TESTS/test-plan.md` | 2 处 | TC-EXCEPT-148 + 错误码索引 |
| `src/common/error-codes.ts` | 未直接引用 | 错误码常量使用独立命名体系（基于 api-spec 但不 1:1 映射） |

### 3.3 可行性分析

| 选项 | 工作量 | 风险 | 收益 |
|------|--------|------|------|
| **A：执行重命名** `GUIDE_INTERNAL_JUDGE_FAILED` → `GUIDE_JUDGE_EVALUATION_FAILED` | ~2h（全局替换 4 文件 ~20 处） | 破坏 agent-comm §5.3 透传链引用（埋点归因 / innerCode 字段） | 符合 `<DOMAIN>_<ERROR>` 命名规范 |
| **B：保留旧名 + 关闭建议** | ~0.5h（在 mlaudit 回复中说明设计决策） | 无 | 无收益，但无破坏 |
| **C：保留旧名 + 文档补注**（在 P0-4 审计回复中引用 api-spec:1006 的说明，关闭此建议） | ~0.5h | 无 | 消除误会，避免下轮审计重复提出 |

**推荐 C。** api-spec v0.4 的设计决策有充分理由：
1. agent-comm §5.3 的嵌套错误示例 + frontend-backend-api 的 switch case + test-plan 的 TC-EXCEPT-148 均已使用旧名
2. 重命名需全部同步更新，且埋点归因中的 `innerCode` 字段历史数据会断裂
3. 命名规范冲突已有文档说明（`APISPEC-SUPPLEMENT` 标注），不是未意识到的错误
4. macp2 评估 §3.2 的 "未按 P0-4 要求重命名" 是因为评估员未注意到 v0.4 的命名说明——这是审计沟通问题，非工程质量问题

### 3.4 工作量

| 选项 | 行数 | 工时 |
|------|------|------|
| C（推荐） | ~10 行（mlaudit 审计回复 + P0-4 关闭说明） | 0.5h |
| A + 同步所有透传引用 | ~20 处替换 + 测试用例更新 | ~2h |

### 3.5 优先级

**P2 — 低优先。** 理由：

- 旧名已正式收录于 api-spec v0.4，有充分设计决策依据
- 不影响功能实现——coder/judge 接入 LLM（P0-C）远优先
- 如果团队决定仍执行重命名，建议排在下个 Sprint 末，作为文档清理任务

### 3.6 实施大纲（推荐 C）

1. 在 `mlaudit-reports/` 下新增 `macp-B2-P0-4-closure.md`（或更新 macp-B2-worker.md），内容：
   - 引用 api-spec.md:1006 的命名说明
   - 明确标注 "设计决策：v0.4 保持原命名以避免破坏透传链，关闭此建议"
   - 更新 macp2-tree-evaluation §3.2 的 "部分" 为 "✅ 收录（设计决策保留旧名，见 api-spec:1006）"
2. 若团队坚持重命名：参考选项 A，全局替换 + 更新 TC-EXCEPT-148 用例

---

## 四、项目层整体方案：下个 Sprint 做什么

### 4.1 Sprint 目标

**将 C1 评分从 47/100 推至 ≥70/100**，核心手段：coder/judge 真实 LLM 接入。

### 4.2 Sprint 任务排序

| 优先级 | # | 任务 | 工时 | 交付物 | 归属 |
|--------|---|------|------|--------|------|
| **P0** | 1 | P0-C Phase 1：PromaCloudLlmClient + withSoftTimeout | 12-16h | `src/common/proma-cloud-llm-client.ts` | 项目 |
| **P0** | 2 | P0-C Phase 2：coder 核心链路（sandbox + 自修复 + 快照） | 16-20h | coder-engine.ts（从 -stub 升级为正式模块） | 项目 |
| **P0** | 3 | P0-C Phase 3：judge 硬约束 + PlantUML 解析 | 20-24h | judge-engine.ts（从 -stub 升级为正式模块） | 项目 |
| **P0** | 4 | P0-C Phase 4：集成胶水 + 单元测试 + 集成测试 | 12-16h | test/ 目录 + 端到端脚本 | 项目 |
| **P0** | 5 | P0-D 项目层：peer audit 协议文档 + 模板 + test-plan | 8h | `docs/peer-audit-protocol.md` + 模板 + TC-PEER-* | 项目 |
| **P1** | 6 | P1-D：B2-P0-4 审计回复（关闭或执行重命名） | 0.5-2h | mlaudit 更新 | 项目 |
| — | 7 | P0-D proma 层：tree-commander SKILL modelHint + peer audit 步骤 | 8-16h | SKILL 修订 | proma |
| — | 8 | 可选：多模型交叉实战验证（tree-commander SKILL 支持后跑一轮 macp3） | 4h（root brief 编写+观察） | macp3 树 | 项目+proma |

### 4.3 依赖关系

```
P0-C (1→2→3→4) 串行依赖
    Phase 1（LLM 通道）→ Phase 2（coder 集成）→ Phase 3（judge 集成）→ Phase 4（测试）
P0-D 项目层 (5) 与 P0-C 无依赖，可并行
P1-D (6) 与所有任务无依赖，随时可做
P0-D proma 层 (7) 依赖 tree-harness 团队排期，与项目并行
```

### 4.4 人员配置建议

| 角色 | 人数 | 负责 |
|------|------|------|
| **dev-coder** | 1 人 | P0-C: PromaCloudLlmClient + coder 核心链路 + sandbox 集成（Phase 1+2，28-36h） |
| **dev-judge** | 1 人 | P0-C: judge 硬约束 + PlantUML 解析 + 软约束 LLM（Phase 3，20-24h） |
| **dev-integration** | 0.5 人 | P0-C: 集成胶水 + 测试（Phase 4，12-16h）；兼 P0-D 项目层（8h）+ P1-D（0.5-2h） |

> 若只有 1 人：按 Phase 1→2→3→4 串行，预计 **1.5-2 周**（P0-D/P1-D 穿插在等 LLM 调用返回的空隙）。

---

## 五、项目改进 vs proma 改造：边界总结

| 改进项 | multi-agent-collab-platform（项目） | tree-harness / proma（平台） |
|--------|-------------------------------------|-------------------------------|
| **P0-C**：coder/judge 接入 LLM | ✅ **全部**：PromaCloudLlmClient + sandbox 集成 + 自修复 + PlantUML 解析 + 硬约束 7 项 + withSoftTimeout（~1500-1900 行） | — |
| **P0-D**：多模型交叉（brief 指定 modelHint） | 项目层：brief 模板增加 modelHint 字段（~50 行） + 文档化 | proma 层：tree-commander SKILL 读取 modelHint 并透传 create_session |
| **P0-D**：peer audit 协议 | 项目层：peer-audit-protocol.md + 模板 + TC-PEER-*（~280 行） | proma 层：tree-commander SKILL done 协议增加 peer audit 步骤；引擎放开 audit_gate 约束（P0-A） |
| **P1-D**：错误码重命名 | 项目层：审计回复文档关闭（~10 行）；若执行重命名（~20 处替换） | — |
| **P0-A**：放开禁 fork auditor | — | 🔴 纯 proma/引擎改造（另见 engine-evaluation.md） |
| **P0-B**：tree_init 绑 session | — | 🔴 纯 proma/引擎改造（另见 engine-evaluation.md） |

### 建议协作方式

1. **项目团队先启动 P0-C**（最大块，不依赖 proma 改造）
2. **项目团队并行交付 P0-D 项目层**（文档+模板，不依赖引擎）
3. **tree-harness 团队在 P0-C 执行期间完成 P0-A/P0-B + tree-commander SKILL 修订**
4. **P0-C 交付后跑 macp3 实战验证**——此时多模型交叉（P0-D proma 层已就绪）+ peer audit（引擎+SKILL 已就绪）可真实联动

---

## 附录 A：数据源与核验方法

| 数据源 | 用途 |
|--------|------|
| `macp2-tree-evaluation-2026-07-25.md` §5 P0-C/P0-D/P1-D + §六 + §7.2 MiniMax 代码复审 | 改进建议出处 + 对抗审查修正数据 |
| `src/coder/coder-engine-stub.ts`（593 行全文） | 逐方法核验核心业务逻辑现状 |
| `src/judge/judge-engine-stub.ts`（498 行全文） | 逐方法核验硬约束/软约束/超时实现现状 |
| `src/sandbox/sandbox-manager.ts`（全文） | 核验 sandbox 可用性（prepareIsolation / spawnIsolated / watchdog 全真实，降级监控而非假实现） |
| `electron/main.ts`（331 行全文） | 核验 IPC 骨架状态（19 空壳 + 1 半空壳，对 P0-C 无依赖） |
| `04_API_SPEC/api-spec.md:965-1010` | 核验 GUIDE_INTERNAL_JUDGE_FAILED 是否已重命名 + 设计决策说明 |
| `04_API_SPEC/agent-comm.md` grep 结果 | 核验错误码跨文件引用数 |
| `.context/mlaudit-reports/macp-B2-worker.md` §P0-4 | P1-D 原始建议出处 |
| `src/common/error-codes.ts` | 核验错误码常量体系 |

**论证方法**：逐文件读全文（非 grep 采样），与 macp2 评估中的 GLM/MiniMax 结论交叉验证。关键发现：
- MiniMax 对占位密度的修正（55→17, 39→14）被本论证采纳
- api-spec v0.4 对 GUIDE_INTERNAL_JUDGE_FAILED 的 "保持原命名" 设计决策被本论证发现（评估未注意到）
- sandbox 的 "降级实现" 标签在 P0-C 场景下足够——代码执行场景不需要 OS 级隔离

---

*论证报告完成：2026-07-25 ~15:15 GMT+8*  
*配合阅读：`engine-evaluation.md`（P0-A / P0-B 引擎层）+ `skill-evaluation.md`（P1-A / P1-B / P1-C SKILL 层）*
