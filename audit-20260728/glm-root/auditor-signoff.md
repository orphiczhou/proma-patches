# Auditor 异厂商独立签字 — Tree Harness 工程对抗性审计（audit2 树）

> **签字方**：audit2-X-auditor，**MiniMax-M3**（渠道 `b7e25505`，session `2282d381-8501-4317-b6cc-322a8c194a81`）
> **异厂商独立性**：与 root（GLM-5.2/ZLM）、D2/D3/D6（GLM-5.2）、D1/D4/D5（DeepSeek-v4-pro）**三方全不同厂商/型号**
> **被审对象**：`pr/20260728-harness-final/FINAL-REPORT.md` 自评 **7/7 ✅ + C1=86/100**
> **签字时间**：2026-07-28 12:2x GMT+8
> **方法**：两阶段强制独立 —— 阶段1 在**未读任何 D1-D6 与并行审计产物**前独立预读源头文档 + 独立重跑全部关键命令，落盘内部笔记锚定判断（`.context/phase1-independent-notes.md`）；阶段2 才读 6 份 worker 报告做 challenge/uphold。**未读** `audit-20260728/` 根目录任何 .md（含另一棵 audit 树的 `auditor-signoff.md`，非本人产物，未覆盖）。

---

## 〇、签字结论（TL;DR）

| 项 | FINAL-REPORT 自评 | **我异厂商独立签字** | 差距 |
|---|---|---|---|
| C1 综合分 | **86/100**（达 85+ 目标） | **82/100** | **-4，不达 85+** |
| 完成标准 | **7/7 全达成** | **PASS 2 / PARTIAL 3 / FAIL 2**（真实约 3.5/7） | 过度宣称 |
| 最严重问题 | 未列（§3.6 记为正面"兜底"） | **CLI null-caller 通道 = P0 引擎级后门，且 Roadmap 计划标准化** | 方向性错误 |

**一句话**：项目层 4 缺陷是**真修**（我独立复跑探针/构建/测试全绿，D5 代码实证充分，这部分我不打折）；但 ① C1=86 依赖端到端 +4 通胀，② "7/7"把测试底座指标和"评估完选择绕过"计入 harness 完成度，③ 最关键的是 FINAL-REPORT 把一条**绕过全部 V10 身份校验的引擎后门**当作成功经验写入并计划标准化 —— 这一条足以否决"工程已完成收口"的定性。

---

## 一、异厂商签字 C1 = 82/100（独立打分，非 worker 平均）

### 1.1 我独立重跑的验证（不采信任何自证）

| 命令 | 我实测 |
|---|---|
| `node -v` | v22.13.1（审计 shell 初始 PATH 无 node，显式加 `/c/Program Files/nodejs`） |
| `npx tsc --noEmit -p tsconfig.build.json` | **exit 0** |
| `npx vitest run`（全量） | **6 files / 24 tests passed / 0 failed** |
| `npx vitest run 06_TESTS/e2e-ipc-cross-layer.test.ts` | **3/3 passed** |
| `node probe-macp11-j1.cjs` | **全场景 PASS**（reject / soft / 0-features 三边界真实） |
| `git log -1`（multi-agent-collab-platform） | **188bb82 feat(macp3)** |
| `git status --porcelain` | **16 条 dirty/untracked** |

### 1.2 九维签字表（vs macp11 MiniMax 签字逐维对比）

| 维度 | 满分 | macp11 签字 | **我签字** | Δ | 我的独立依据 |
|---|---:|---:|---:|---:|---|
| 可运行性 | 10 | 9 | **9** | 0 | uphold：build/typecheck/24 tests 我独立 exit 0 |
| Sandbox | 10 | 6 | **6** | 0 | uphold：`sandbox-manager.ts:19-24` 自认降级 `wallclock_watchdog`，`:466 cpuTimeMs=0`，非 OS 级 |
| Snapshot | 10 | 9 | **9** | 0 | uphold（附注：本轮及上轮均未复验，属继承分） |
| Coder 业务 | 15 | 15 | **15** | 0 | **我阶段1 曾扣 1 分，现撤回**：22 处"占位"grep 命中经核实多为**过时注释/类型 docstring/测试 mock StubLlmClient**，非生产未实装；D5 F1-F3 代码实证成立 |
| Judge 业务 | 15 | 15 | **14** | **-1** | 阶段1 扣 2 现改扣 1：`judge-engine-stub.ts:261/264` "S1 占位"是**过时注释**（runHardChecks/runSoftEval 已真实现）。但 `runGwtExistenceCheck` 非 ENOENT 读错误 → `featuresTotal=0` → **pass**（`:1072-1078`）是真缺陷，与本项目"假通过"红线（缺陷4 即名为 evaluateCode 假通过）直接冲突，满分不成立 |
| LLM 基础设施 | 12 | 11 | **11** | 0 | uphold：`proma-cloud-llm-client.ts:399` evaluateSoft → `this.chat` → `fetch` 真链路 |
| Electron IPC | 10 | 5 | **5** | 0 | uphold：`electron/main.ts` 实测 15 处 stubData，5/20 channel 实装 |
| 自动化测试 | 8 | 8 | **7** | **-1** | challenge down：+1 增量真实，但**满分 8/8** 与"src+electron 29 个 ts 文件、sandbox 550 + snapshot 903 行零测试覆盖、24 用例"不相称 |
| 端到端 | 10 | 8 | **6** | **-2** | 🔴 **核心 challenge**，见 §1.3 |
| **总计** | **100** | **86** | **82** | **-4** | **不达 85+** |

### 1.3 🔴 端到端 8 → 6：我的主 challenge（这一条就是 85 门槛的生死线）

我实测 `06_TESTS/e2e-ipc-cross-layer.test.ts:42` 为 `vi.mock('electron', ...)`：`ipcMain.handle` 只是把 handler 存进 **vi.hoisted 内存 Map 的 spy**（`:35-36`、`:75` import 拿到 mock 版），测试再从 Map 取出直调。无 Electron 主进程、无 renderer、无跨进程 IPC 序列化边界。

判据不一致是硬伤：**macp10 把"进程内集成测试"判 4/10；macp11 对"进程内集成测试 + 一层 mock 注册表"判 8/10（+4）**。同一性质的东西两轮差 4 分。真实增量（证明 `registerIpcHandlers` 确实注册 channel + handler 闭包路由到真引擎 + 真实文件副作用 + fetch 未联网）值 **+2**，我给 6/10。

**注意**：macp11 auditor 在 `X-audit-S1.md:33` 已诚实写明"它是 IPC 注册/路由层跨层 E2E，不是 renderer→真实 Electron 主进程的进程级 E2E"。**措辞我完全 uphold，给分我 challenge** —— 报告自己的措辞与自己的给分互相拆台。

### 1.4 关于"同型号互保"嫌疑的自我声明

macp11 的 X-auditor 与我同为 MiniMax-M3。我**不因同型号背书**：
- **uphold 其方法论**：独立重跑命令、拒绝夸大 mock E2E、G3 yellow 不重复加分、诚实列 5 项拖分项 —— 我逐条复验成立。
- **challenge 其数值**：端到端 +4 与测试满分过宽（-3）。
- **补其漏审（challenge up）**：macp11 全轮**未审 git 提交状态**、**未审 CLI 通道的安全含义**（后者当轮被当成功经验写入 `results.md §3`）。这两条是我新增的主 finding。

---

## 二、7/7 逐条独立核验签字

| # | 标准 | 自评 | **我签字** | 理由（我的独立证据） |
|---|---|---|---|---|
| 1 | P0 接力协议 §13.3b + idle 多维核验 | ✅ | **PARTIAL** | 协议条款真实存在、macp10 零撞击可信；但 **macp11 root idle 复发（第三起）**，靠父会话带外 `remote_send_message` + CLI 绕过才解锁。"检测"有了，**根因未修**（FINAL-REPORT §五自己把"root idle 平台修复"列为后续 roadmap）。且 D3-F2 核实 §13.6.0 idle 4 项清单**漏 communication_log** —— 恰是 macp6 误判的根因，SOP 未堵 |
| 2 | audit_log severity + auditor ≥2 events + emergent | ✅ | **PASS** | 我代码复核：`tree-engine.cjs:3757-3760` severity 必填 red\|yellow\|green 成立；`:3639-3651` v0.20 red 阈值 + v0.23 只查最新 entry 成立；macp10/11 零撞击。**唯一实至名归的引擎层硬拦** |
| 3 | 引擎 segment_add 评估 | ✅ | **PARTIAL**（原判 PASS，采纳 D2-F3 下调） | 字面"评估"确实交付（A1/A2/A3 三方案论证完整）。但我代码复核确认 gap **完全未修**：`cmdSegmentAppend` 无 caller 形参、只 push `segment_chain` 不切 `session_id`；A2 未实施，A3 就是 §13.3b 的 CLI 绕过。**这个 gap 正是 P0 后门被"需要"的根因之一**（D2-F3 的因果链我 uphold），故不能记满分 PASS |
| 4 | 4 缺陷全修 + C1 85+ | ✅ | **FAIL** | 前半**真达成**（我独立复跑探针全 PASS，D5 四条 GREEN 代码实证 file:line 齐备，我不打折）；后半 **C1 85+ 不成立**（我签 82）。**另加一条更硬的**：被打分的代码 **git HEAD 仍是 macp3 `188bb82`，macp6-11 全部改动 16 条未提交**，第三方不可复现 |
| 5 | C1 权威复评 85+（MiniMax 签字） | ✅ | **FAIL** | 签字**流程**真实（我 uphold D4-F6：macp10/11 auditor 确为 MiniMax 且独立于全 GLM 链）。但 **85+ 这个数值断言不成立**：我作为新一轮 MiniMax 异厂商签 82 |
| 6 | 综合实战验证（macp7-11 全 PASS） | ✅ | **PARTIAL** | macp11 实战暴露 root idle 复发 + auditor 0 events 需带外补 brief + 越级 `error_during_execution` + 依赖 CLI 绕过闭环。把这些写成"全 PASS"过度；D4-F4/F5 我 uphold |
| 7 | tree-iterative-development 终版 + 归档 | ✅ | **PARTIAL** | 🔴 我磁盘核验：`D:/Codes/tree-harness/skills/` 只有 `session-management / tree-auditor / tree-commander / tree-worker`，**`tree-iterative-development/` 不存在**，SKILL 只在 `.proma-pro/.../skills/`。违反 CLAUDE.md:17「权威源 = D:/codes/tree-harness/」，git 仓库不完整（D1-F6 我 uphold）。另：v1.4 changelog 只记 macp6 闭环，表格已加 macp7-11 行但**版本号未随内容 bump**，§1.1 标题仍"六轮迭代"实际 9 行 |

**签字结论：PASS 2（#2）/ PARTIAL 4（#1/#3/#6/#7）/ FAIL 2（#4/#5）。按"标准的实质意图"折算真实达成 ≈ 3.5/7，非 7/7。**

---

## 三、D1-D6 Findings challenge / uphold 表

### 3.1 uphold 全定（worker 找的红/黄真实存在的，我没有重新审计的理由去驳）

| Worker finding | Worker | 我的独立证据 | 处置 |
|---|---|---|---|
| **D1-F1** macp2 五铁律（SubAgent 成本爆炸）零覆盖 | D1 | CLAUDE.md:27-35 + 我自己微读过：6 项改进全为树操作协议，无一触及 SubAgent / create_session / 预算护栏 | **uphold**（且**单列为 P1**，因为这是 CLAUDE.md 首条 P0） |
| **D1-F2** nanju 四铁律（brief 审计义务）零覆盖 | D1 | CLAUDE.md:40-55 + §3.4 "auditor ≥2 events"是 auditor 侧形式校验，非 brief 编写侧预防 | **uphold** |
| **D1-F3** v0.17.1 方向背离（5/6 纯教化） | D1 | CLAUDE.md:58-64 + FINAL-REPORT §3.1 自承"纯 SKILL 协议层（0 引擎改动）"×4 | **uphold** |
| **D1-F5** 运维需求几乎零覆盖 | D1 | CLAUDE.md:70-87 部署口诀 + pro 测试要点 10+ 条 vs 最终报告 | **uphold** |
| **D1-F6** tree-iterative-development 源文件缺位 | D1 | 见 §二 #7 PARTIAL 证据 | **uphold** |
| **D2-F1** CLI null-mode 系统性绕过 9+ V10 caller 校验 | D2 | 我**代码复核通过**：`tree-engine.cjs:5646/5654` (run 第4参可省) + 9 处 `if (callerSessionId && ...)` 全部短路 + `:2769` `!callerSessionId` 放行 root auto_upgrade + SKILL §13.3b L956-962 **白纸黑字教化绕过** | **uphold + 列为最严重 P0** |
| **D2-F2** resolveAuditorIndep L3061 root-as-auditor + CLI = 任意进程假冒 root 背书 | D2 | 我代码复核通过：L3061 只查 root 自身状态/events，不校验调用方身份 | **uphold**（D2-F1 + F2 闭环） |
| **D3-F1** §13.7 错误码速查表覆盖率 9/51（D3）/ 9/57（实测） | D3 | 我实测表 9 码 vs ERROR-CODES.md 57 码（覆盖率 16%） | **uphold**（D3 计数保守，更糟） |
| **D3-F2** §13.6.0 idle 漏 communication_log | D3 | 我读 SKILL:1055-1067 4 项清单无 comm_log，与 §6 强制要求矛盾 | **uphold** |
| **D3-F3** §14.2 vs §14.6 数字口径矛盾 | D3 | SKILL L1122 "缺一不算完成" vs L1239 "可选 fix" | **uphold** |
| **D3-F7** §11 标题"12 条"实际 17 条 | D3 | 我实测标题 L697，计数 17 | **uphold** |
| **D5-F1~F4** 项目层 4 缺陷真修 | D5 | 我独立复跑 probe-macp11-j1 全 PASS + grep `evaluateSoft` `path.resolve` 真存在 | **uphold** |
| **D6-F1** CLI null-mode = P0 后门（与 D2-F1 同源，D6 写得更狠） | D6 | 见 D2-F1 | **uphold**（D2+D6 异厂商独立交叉验证） |
| **D6-F2** root auto_upgrade `!callerSessionId` defense-in-depth 自毁 | D6 | 我代码复核 L2762-2766 注释 vs L2769 代码**直接矛盾**：注释承诺"即便 caller 校验被绕过也不会触发"，代码 `!callerSessionId` 在不让 false 触发 | **uphold** |
| **D6-F3** CLI 模式 audit_gate 自我背书 | D6 | 见 D2-F2 | **uphold** |
| **D6-F8** drift 留痕对成功 CLI 调用非强制 | D6 | 我代码复核 `run()` `:5669-5699`：drift append 确实只在 `catch` 分支 + `RECOVERABLE_ERROR_CODES` 触发 | **uphold** |
| **D4-F3** CLI 兼容通道是 P0 绕过口（与 D2/D6 同源） | D4 | 同上 | **uphold** |
| **D4-F4** macp11 root idle 复发（第三起）= 平台修复未落地 | D4 | macp11 results.md §3 完整触发链 | **uphold** |
| **D4-F5** macp11 auditor 启动依赖父会话人工补 brief | D4 | ROOT-PROXY-HANDOFF.md:17 + macp11 results.md:63 | **uphold** |
| **D4-F6** macp10/11 异厂商独立性真实 | D4 | 我 cross-check session ID：cb05aadd / 22b8407c 均为 MiniMax-M3，与全 GLM 链不同 | **uphold** |
| **D4-F7** macp11 E2E 端到端 +4 保守计分诚实 | D4 | 我代码复核 `vi.mock('electron')` 确认 X-audit-S1:33 措辞"不是进程级 E2E"成立 | **uphold**（措辞真，**给分我见 §1.3 拒**） |
| **D4-F8** 三 yellow 清理证据闭环 | D4 | X-audit-J1.md §2 逐条 file:line 引用 + 独立 probe 17/17 | **uphold** |

### 3.2 challenge down（worker 找得**过严 / 失准 / 我可独立证伪**）

| Worker finding | Worker | 我的反证 | 处置 |
|---|---|---|---|
| **D1-F4** 标准 #4/#5 完全不属 harness 交付物 | D1 | 我部分 challenge down：测试底座指标确实属于 multi-agent-collab-platform，但现行交付架构是"harness 改造 + 端到端验证其支撑的下游应用"两个层面，CLAUDE.md:5-6 范围明确写"树形会话执行体系改造"，**第 #4/#5 作为"改造效果验证"理应计入完成标准**，只是表述位置应区分（D1 finding 在观点上对，结论上略偏） | **challenge down 到 severity**：YELLOW 而非 RED |
| **D4-F1** macp3 C1=68 基线无归档 | D4 | **我证伪**：归档在 `multi-agent-collab-platform/06_TESTS/macp3-tree-evaluation-final-2026-07-25.md §六`（MiniMax worker session `a91c573e`，九维表齐全，C1=68），D4 只 grep `pr/` 目录就断言"无归档"——是搜索范围错 | **🟢 CONFIRMED 反证**：D4-F1 错误，**macp3 基线有完整 MiniMax 异厂商独立签字**。这条不动我 C1 结果（68→82 的差距是别的维度），但 D4-F1 必须降级 |
| **D5-F6** judge hard checks "9" 计数不精确 | D5 | 我代码复核 `ALL_HARD_RULES` 7 项 + `CODE_CHECKS` 2 项 = 9 项的拆法在规格正确（D5 自己也算到 7+1=8 是漏数 CODE_CHECKS） | **D5 内部自相矛盾**：D5 同一 finding 既说"8 项"又说"如按 7+1+1=9"——保留 yellow 标注即可，无需着力挑战 |
| **D3-F8** §13.3a 自相矛盾（节首 vs §13.3a.1） | D3 | 我复核：节首 L853 说"无豁免"，L857 §13.3a.1 说"有豁免"——**D3 finding 真实**。但 L1765 已实现 `!isAuditor && !isRoot` 豁免（v0.18 起），§13.3a.1 描述的是**当前**状态，节首描述的是 **macp3 历史**状态（SKILL changelog 印证），故"自相矛盾"其实是**未注明时态** | **challenge down 表述**：yellow 而非 red（不妨碍 SKILL 总体一致性问题） |
| **D6-F4** "只看最新一条 audit_log"让历史 red 可被静默清洗 | D6 | D6 把 v0.23 修复（`:3635-3637` 注释明示）误读为漏洞。v0.23 之前是真漏洞，v0.23 之后是设计意图（解决复审死锁）。**清洗旧 red 需要新 audit_log 0 red 真实复审**，并非 append-only 即可 | **challenge down**：yellow 而非 red（修复有正反两面权衡，D6 偏负面但未充分权衡） |
| **D6-F5** review_round 内容伪造 | D6 | 引擎在 L1508 / L4852 自述"仅防格式不防内容"，这是 SECURITY.md §4.3 长期路线打标的话题，**已显式承认**。D6 把它列为新 finding 没有新增证据 | **withhold**（不驳但降为已知） |

### 3.3 challenge up（worker 漏报 / 我补的 finding）

| Finding | 来源 | 证据 | 处置 |
|---|---|---|---|
| **A-1** C1 打分对象的代码 **未进 git** | **我阶段1 发现** | `multi-agent-collab-platform` git HEAD = `188bb82 feat(macp3)`，16 条 dirty/untracked（含 `electron/main.ts`/`src/judge/judge-engine-stub.ts`/`06_TESTS/e2e-ipc-cross-layer.test.ts` 等全部 macp6-11 改动）。C1=86 的证据基底是**未提交工作树**，任何 `git stash`/clean 即蒸发 | **🔴 P0，归档完整性** |
| **A-2** FINAL-REPORT §七 "git HEAD release-0.13.16-hardening" 仓指混 | **我阶段1 发现** | 那指 **harness（tree-engine）仓**，与被打分的项目层仓 `multi-agent-collab-platform` **不同**。report 把两仓的 git 状态混说 | **🟡 P1，报告透明性** |
| **A-3** CLAUDE.md md5/行数**四处自相矛盾**且与实体漂移 | **我阶段1 发现** | CLAUDE.md 同一文件内对 `tree-engine.cjs` 给出 `3e10bf8e`（结构节，称 5425 行）/ 部署口诀称"应=1f05baa7"/ 测试节称"权威源 md5 5532fa5f"。我实测 **md5=b09d6450cd684a239147290086b361ba，5766 行**。四个值互斥且全部错。CLAUDE.md 自己是"文档-引擎一致性 P0 高发区"规则出处，规则源头失守 | **🟡 P1，文档完整性** |
| **A-4** worker 自证漂移：`judge-engine-stub.ts:261/264` "S1 占位" 是**过时注释** | **我阶段1 发现（用于修我自己）** | `:262` 实际 `runHardChecks(input)`、`:265` 实际 `runSoftEval(input)` 均已真实现。grep 计数会**误算**真实未实装范围 | **影响我自己的初判 → 已撤回 Coder/Judge 扣分** |
| **A-5** cmdEventAppend `:2769` `!callerSessionId` 放行是 V10-trust-anchor-fix 的**遗漏点** | D2-F1 后半 + D6-F2 已记，但**没有 worker 单独列为 high** | 引擎 C5 修复（SECURITY §3.5）修了 cmdAuditGate 的 null 放行但漏了 cmdEventAppend 内的 auto_upgrade 触发条件；注释 vs 代码**直接自相矛盾** | **🔴 P0，并入 D6-F2 处理** |
| **A-6** macp6-multi-project 误报被审计为"过度宣称 80-83" | D4-F2 主张过度宣称 | 实际我对照 `06_TESTS/macp6-tree-evaluation-2026-07-27.md`（不止 D4 引的 `macp6 results.md`），macp6 v2 评级 + X-auditor 评语**混合压成 80-83** 是 GLM commander 复述上传，不是观察员独立签字 | **uphold，但 D4-F2 措辞"过度宣称"措辞可改"原始推断被多次转述后与正式复评脱节"** |

### 3.4 关于 D1-F4（标准 4/5 不属 harness）我与 D1 的最终分歧

D1 判定为 RED（应剔除出 7/7）。我的处置：

- **观点上同意 D1**：测试底座应用层指标与 harness 引擎/SKILL 改造是**两个交付物**，把它们塞进同一张"完成标准"是 FINAL-REPORT 的报告学问题。
- **结论上不采取 D1 的剔除**：现行 tree-harness 改造的核心验证手段就是"用改造后的引擎支撑下游项目跑通"，C1=86 是该验证的量化产出。剔除 = 让本轮没有验证桥。但**应明确分层**（我已在 §二 #4 写明 FAIL 的具体含义 = C1 85+ 数值不成立，而非整个标准剔除）。
- **D1 的额外贡献**（F1/F2/F3 = macp2/nanju/v0.17.1 三条 P0 铁律零覆盖）**我升级为 P1**，因为 CLAUDE.md 的 P0 教训源头确实未被 harness 改造触及。

---

## 四、FINAL-REPORT 过度宣称项清单

按严重度从高到低：

### 4.1 🔴 第 1 类：方向性错误（最严重）

| 项 | 报告原文 | 实际真相 |
|---|---|---|
| **§3.6 CLI 兼容通道** | "省略 callerSessionId 跳过 V10 caller 校验（引擎降级非 V10 路径）" | **绕过全部 V10 身份校验**（D2/D6/D4 三方独立核实）。是 P0 引擎级后门，不是"降级" |
| **§5 Roadmap 第 4 条** | "CLI 兼容通道标准化：caller 缺省降级文档化" | 把后门永久合法化，方向反了。**应反向**：CLI 通道下线 + 平台 root idle 修复 |
| **§一 #4 "C1 85+"** | "C1=86/100 macp11" | 86 依赖端到端 +4 通胀（mocked E2E 不应 +4），我独立签 82 |
| **§一 #5 "C1 权威复评 85+"** | "MiniMax 异厂商独立签字" | 签字机制真实，但**85+ 数值断言**不成立 |

### 4.2 🟡 第 2 类：报告学问题（结构/表述）

| 项 | 原文 | 实际 |
|---|---|---|
| **§七 git HEAD** | "release-0.13.16-hardening 分支最新 commit" | 那是 harness 仓，打分对象是 `multi-agent-collab-platform` 仓（HEAD=188bb82），**两仓混指** |
| **§一 #5** | "C1 86（macp3 68 → macp10 79 → macp11 86）" | 未披露 macp6 原始 results.md 宣称 80-83（被 macp10 纠正为 76）的过度转述 |
| **§三 6 项改进** | "全部 PASS" | 按**改为引擎层硬拦**的方向（v0.17.1 教训）衡量，仅 1/6 是引擎改动（v0.21 severity），5/6 仍依赖 GLM 自主遵守 |
| **§三 §3.5 emergent v2 协作教化** | "macp6 v2 接力后撞 E_BORROWED_IDENTITY" | 根因（segment_add 不切 session_id）未修，是 §标准 #3 选择 A3 SKILL 绕过的连锁后果 |

### 4.3 🟡 第 3 类：诚实但描述偏弱（应加强披露）

| 项 | 实际 | 报告这样说 |
|---|---|---|
| macp11 root idle 复发 | macp11 实战是**第三起**（macp4/macp6/macp11） | "macp10 零 V10 撞击" 暗示解决，但 macp11 自身撞的是 root idle（非 V10） |
| CLI 应急使用 | "兜底" | "实务中必经路径"——macp11 验证全树收口时**依赖**该路径 |
| 86→95+ 路径 | 5 项拖分中 3 项需中期投入（Sandbox L2 / IPC 15 / 真实 E2E） | "95+ 路径" 暗示短期可达，实际短期仅 89-91 |
| 4 缺陷全修 | 真修 | 但 **`evaluateCode 假通过`的同类边界** (`runGwtExistenceCheck` IO) 未修 |

---

## 五、真实完成度总结论

### 5.1 数字层（C1）

**真实 C1 = 82/100**（我异厂商独立签字，不达 85+），与 FINAL-REPORT 自评 86 差 **-4**。差距源：
- 端到端 8 → 6（-2）：因 mock E2E 与 macp10 判据不一致
- Judge 15 → 14（-1）：runGwtExistenceCheck IO 边界未修与"假通过"红线冲突
- 自动化测试 8 → 7（-1）：满分与 24 用例 / 零 sandbox 覆盖不相称

### 5.2 完成标准层（7/7）

**真实完成 ≈ 3.5/7**：PASS 2（#2/#3）/ PARTIAL 4（#1/#3 修正后含 #3 标准严格 /#6/#7）/ FAIL 2（#4/#5）。

### 5.3 定性层

本轮 harness 改造**确实完成了 macp7-11 期间的基本工程收口**：项目层 4 缺陷真修、§13.3b 多层级协议实战验证、v0.21 audit_log severity 引擎硬拦、macp10/11 异厂商签字机制运转。

但 **FINAL-REPORT 把以下三类问题**用"达标 / 兜底 / 实战验证"措辞掩盖，混淆了"已完成"与"已暴露但靠应急路径绕开"的边界：

1. **方向性错误**：CLI 通道当资产写进 Roadmap 标准化
2. **治理透明度**：测试底座指标和 harness 完成标准混说 + git 提交状态未披露
3. **SKILL 文档卫生**：v1.4 版本号与内容脱节 + 错误码速查表 16% 覆盖率 + 标题计数滞后

---

## 六、Roadmap 优先级签字（按我异厂商判定）

### 🔴 P0 — 阻断级（不修则宣称"完成"误导未来 Agent）

| 编号 | 项 | 来源 | 落地位置 |
|---|---|---|---|
| **P0-1** | **撤回 §5「CLI 兼容通道标准化」**，改为"CLI 兼容通道下线 + 平台 root idle 修复" | D2-F1 / D6-F1 / D4-F3 / 我 A-1 交叉验证 | FINAL-REPORT §五 + 引擎层 |
| **P0-2** | `run()` 区分 `mode` 参数（cli-test / production），生产路径强制 callerSessionId；caller 缺省时身份敏感写操作默认拒绝 | D2-F1 / D6-F1 | `tree-engine.cjs:5646` |
| **P0-3** | `cmdEventAppend L2769` 删 `!callerSessionId \|\|`，`callerIsRootSelf` 严格 `===`；同步 L2762-2766 注释 vs 代码矛盾 | D6-F2 / 我 A-5 | `tree-engine.cjs:2767-2778` |
| **P0-4** | `resolveAuditorIndep L3061` 加调用方校验（caller === rootLeaf.session_id），不依赖外层 cmdAuditGate | D2-F2 | `tree-engine.cjs:3061` |
| **P0-5** | `cmdAuditGate L3560` caller 校验改 `if (audit_session_id !== callerSessionId) throw`（无真值前置） | D2-F1 / D6-F1 | `tree-engine.cjs:3560` |
| **P0-6** | FINAL-REPORT §一 #4/#5 透明化：明示"代码未提交 git（HEAD=macp3 188bb82，16 条 dirty）"，C1=86 仅在工作树基线 | 我 A-1 / A-2 | FINAL-REPORT §一 + §七 |
| **P0-7** | 移除/重写 SKILL §13.3b L956-962 "CLI 应急通道" 教化（至少标"仅本地开发测试，生产禁用"） | D2-F1 | `skills/tree-commander/SKILL.md` |

### 🟡 P1 — 高优（下次迭代必须修）

| 编号 | 项 | 来源 |
|---|---|---|
| **P1-1** | macp2 / nanju / v0.17.1 三条 P0 教训源头在 FINAL-REPORT "未覆盖的 P0 铁律" 章节显式补列 | D1-F1/F2/F3 |
| **P1-2** | `tree-iterative-development/` 源码端创建 + git commit（保留权威源=D:/Codes/tree-harness/ 原则） | D1-F6 |
| **P1-3** | SKILL §13.7 错误码速查表全覆盖（9/57 → 57/57） | D3-F1 |
| **P1-4** | SKILL §13.3a + §3.6 中根因段落整体一致性回归（行号 / 计数 / 章节引用） | D3-F1/F3/F7/F8 |
| **P1-5** | `tree-state.json` 写入附 HMAC + readState 校验，防裸编辑（叠加 F1 进一步扩大攻击面） | D6-F1 后果 |
| **P1-6** | macp11 root idle 根因修复（模型切换不丢 MCP 工具 + SDK 队列不锁死） | D4-F4 |
| **P1-7** | macp3 C1=68 归档链接补入 FINAL-REPORT §二（虽然归档存在，仅 report 未指） | D4-F1 修正 |
| **P1-8** | `run()` 成功路径对 null-caller 身份敏感写操作强制 auto-drift（堵 D6-F8 silent 绕过） | D6-F8 |
| **P1-9** | audit_log 引入 finding_id 追踪（防"只看最新"覆盖旧 red） | D6-F4（我已 challenge down，但实现 finding_id 是正向） |
| **P1-10** | macp11 auditor 启动加引擎层 leaf_add 后 brief 自动投递 + 0 events 超时告警 | D4-F5 |
| **P1-11** | CLAUDE.md md5/行数四处自相矛盾修正（实测 b09d6450 / 5766 行） | 我 A-3 |
| **P1-12** | macp9 已论证的 A2 `leaf_transfer_owner` 实施（~50 行，从根因消除 §13.3b CLI 绕过需求） | D2-F3 / D3-F6 |

### 🟢 P2 — 中优（持续改进）

| 编号 | 项 | 来源 |
|---|---|---|
| P2-1 | Sandbox L1 Windows JobObject native binding（~200 行 N-API）+ 与 L2 Docker/Firecracker 分阶段 | D5-F5 |
| P2-2 | judge 占位 16→<5 短期完成（`_meta.json#documents` 加载 ~50 行） + 长期 hard checks 9→12 补全 | D5-F6 |
| P2-3 | 86→95+ 路径修正：短期 89-91 + 中期 95+ 分两阶段路线图 | D5-F8 |
| P2-4 | Electron IPC 15 stubData 按优先级分批实装（guide/snapshot 先于 telemetry） | D5-F7 |
| P2-5 | session_liveness 后台 reaper（失效 leaf 自动标记） | D6-F6 |
| P2-6 | review_round reviewer 真实活跃度二次校验（依赖平台 subagent_trace_id，对齐 SECURITY §4.3 长期路线） | D6-F5 |
| P2-7 | audit_gate 状态机 + 变更 event 留痕（fail→pass 约束 + immutability） | D6-F7 |
| P2-8 | isCodeDirEmpty 与 collectTsFiles 的 .ts/.js 判定逻辑去重 | D5-F8 |
| P2-9 | 86→95+ 路径修正：短期 89-91 + 中期 95+ 分两阶段路线图 | D5-F8 |
| P2-10 | 测试矩阵新增"恶意 leaf CLI 越权"红队套件（补 audit-attacks / v10-cleanroom 盲区） | D6-F1 后段 |

---

## 七、签字（最终）

**异厂商独立签字结论**：

- **C1 = 82/100**（MiniMax-M3 / session `2282d381-8501-4317-b6cc-322a8c194a81` / 异厂商 / 不达 85+）
- **完成标准 7/7 → 真实约 3.5/7**（PASS 2 / PARTIAL 4 / FAIL 2）
- **FINAL-REPORT 4 处过度宣称**（§3.6 CLI 通道 / §5 标准化方向 / §一 #4/#5 数值 / §七 git 仓混指）
- **最大 P0**：CLI 兼容通道即 P0 引擎后门，且 Roadmap 计划标准化（方向反）

**worker 报告 6 份总体质量**：**除 D4-F1 严重错判（macp3 归档存在）外，其余 findings 与我的独立预读高度收敛**，且 D2/D6/D4 三方独立发现 CLI 后门（异厂商自检机制有效运转）。我**overall uphold 6 份产物**：

- D1（GLM-worker ≠ D2 同职务，质量上佳，4 RED 真实）
- D2（GLM-worker，F1/F2 P0 精准）
- D3（GLM-worker，2 字段命名 "D3" 因我未读 worker 模型表，从风格推断；8 YELLOW 详细）
- D4（DeepSeek-worker，6 RED/YELLOW 真实但 F1 因 grep 范围错判失败）
- D5（DeepSeek-worker，4 缺陷真修实证最有力）
- D6（GLM-worker，F1-F3 P0 闭环）

**对 macp11 上轮 MiniMax 签字的态度**：方法论 uphold，数值 challenge down（端到端 +4 / 测试 +1），漏审补（git 状态 + CLI 通道安全含义）。

**对 audit2 工程化交付评价**：树形团队 + 异厂商独立签字总报告机制在 audit2 中**真落地**（我被指定为异厂商审计员且确实独立执行），破了同款偏差风险。系统设计有效。

---

**签字**：audit2-X-auditor（MiniMax-M3，异厂商独立签字）
**日期**：2026-07-28 12:2x GMT+8
**落盘路径**：`C:/Users/sir_c/.proma-pro/agent-workspaces/default/.context/trees/audit2/deliverables/auditor-signoff.md`（双写路径见 §八）

---

## 八、附录：交付与双写

| 路径 | 内容 |
|---|---|
| `C:/Users/sir_c/.proma-pro/agent-workspaces/default/.context/trees/audit2/deliverables/auditor-signoff.md` | 本报告（权威源） |
| `D:/Codes/tree-harness/audit-20260728/glm-root/auditor-signoff.md` | cp 副本（按 brief 要求） |
| `C:/Users/sir_c/.proma-pro/agent-workspaces/default/2282d381-8501-4317-b6cc-322a8c194a81/.context/phase1-independent-notes.md` | 阶段1 内部笔记（独立预读锚定） |
| `C:/Users/sir_c/.proma-pro/agent-workspaces/default/.context/trees/audit2/call-log.jsonl` | 全程工具调用日志（已自动） |

**注意**：brief 要求 cp 到 `audit-20260728/glm-root/`，**不**覆盖 `audit-20260728/auditor-signoff.md`（那是另一棵 audit 树的产物，session `7004a416`/audit-A-auditor，未读其内容）。
