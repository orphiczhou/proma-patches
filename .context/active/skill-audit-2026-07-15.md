# SKILL 迁移审计报告（2026-07-15 18:52）

**审计对象**：
- `D:/codes/tree-harness/skills/tree-commander/SKILL.md` — §14.1/§14.1a（nanju 根因+铁律）/ §13.5（macp2 收敛）
- `D:/codes/tree-harness/skills/tree-worker/SKILL.md` — §4.6（主动触发+收敛）/ §8（prefix 教训）

**迁移出处**：`CLAUDE.md` L15-45（macp2 + nanju P0 段）；引擎 `tree-engine.cjs`（prefix 正则/前置校验/review 门禁）

**审计方法**：6 维度并行（C1-C4 + A1-A2），进程内 Explore subagent 独立验证 + 主审读源交叉核对。

---

## 总评

**通过: 4 / 警告(yellow): 9 / 阻断(red): 0**

迁移的**协议逻辑、根因链、铁律、checklist 全部正确落地**，与 CLAUDE L15-45 源和引擎实现一致。**无阻断级问题**（无逻辑错误、无引擎不一致、无内部路径泄露、无 CLAUDE 外部引用残留）。

**发布前必修（脱敏类，非逻辑类）**：5 处事故专有名词 / 模型代号需泛化（C3-1 / C3-2 / C4-1 ~ C4-3）。这些是"私有化发布"的清理工作，不影响协议正确性。

---

## C1 一致性（SKILL vs CLAUDE 源 + 引擎）— **passed（1 yellow）**

| ✓/⚠ | 项 | 证据 |
|---|---|---|
| ✓ | prefix 正则 SKILL `[a-z][a-z0-9_]{3,7}` = 引擎 LEAF_NAME_RE | `tree-engine.cjs:63` |
| ✓ | PREFIX_RE 前置校验 SKILL = 引擎 cmdInit 实现 | `tree-engine.cjs:738-740`（防御性 `prefix!==undefined`） |
| ✓ | review 门禁 SKILL（review_round + 末轮 red=0 + 轮≤3）= 引擎 | `tree-engine.cjs:1691-1722` |
| ✓ | subagent_spawn 父段/output_ref 校验 = 引擎 | `tree-engine.cjs:1378-1428` |
| ✓ | max_sessions 四路径登记 = 引擎 | `tree-engine.cjs:1127/1989/3937` + init |
| ⚠ Y | worker §4.6 条件 1 措辞 `brief.audit_meta.review_required` 与引擎路径不一致 | `worker/SKILL.md:409` vs `tree-engine.cjs:1346-1355`（实际读 `leaf.audit_meta` → 回退 `state.audit_meta`） |

**C1-Y1 详情**：worker §4.6 条件 1 写 `brief.audit_meta.review_required === true`，但引擎实际路径是 `leaf.audit_meta.review_required`（叶级覆盖）→ `state.audit_meta.review_required`（树级回退）→ 默认 false。CLAUDE L34 明确"audit_meta 在 init 时只挂在 tree state 上，不在 leaf 上"。所以 worker 实际**读不到**此字段（在 leaf.brief 外），措辞"brief.audit_meta..."会让 GLM 误以为需自检。语义对（"true 时引擎强制"），措辞不精确。

---

## C2 完整性（协议教训迁全?）— **passed（1 yellow + 1 提示）**

| ✓/⚠ | 项 | 证据 |
|---|---|---|
| ✓ | macp2 5 铁律全迁 commander §13.5（调用形式/撞错修根因/收敛/预算护栏/心智模型/前置验证） | `commander/SKILL.md:857-881` |
| ✓ | nanju 根因链 A/B/盲区三条全迁 commander §14.1a | `commander/SKILL.md:976-979` |
| ✓ | nanju 4 铁律 + brief checklist 全迁 commander §14.1a | `commander/SKILL.md:981-989` |
| ✓ | nanju 链 A worker 主动触发迁 worker §4.6 | `worker/SKILL.md:408-415` |
| ✓ | prefix 铁律双向迁移（commander 自查 + worker 上行） | `commander/SKILL.md:984` + `worker/SKILL.md:708` |
| ⚠ Y | CLAUDE L45 macp2↔nanju 对比总结未显式迁 | CLAUDE.md:45 vs commander §14.1a（链描述有，对比总结无） |
| ⚠ 提示 | CLAUDE L43 "init 不校验 prefix 长度" 现已过时（cmdInit 已加 PREFIX_RE 前置校验），CLAUDE 未同步 | CLAUDE.md:43 vs `tree-engine.cjs:738-740` |

**C2-Y1 详情**：CLAUDE L45「macp2 = SubAgent **调用形式**必须钉死（防成本爆炸）；nanju = brief **审计义务**不可标可选（防质量防线被一句话释放）」的对比总结在 commander §14.1a 没显式呈现。两节分别描述了链，但读者难一眼看出"这是两类互补事故"。建议在 commander §14.1a 末尾加一句对比。

**C2-提示**：CLAUDE L43「init 不校验 prefix 长度（leaf_add 才校验），故命名错会潜伏到建 worker 时才暴露」——这是事故**当时**的引擎状态描述。我前一轮已改引擎（v0.7 批次6 PREFIX_RE 前置），现在 init **会校验**。SKILL（commander §14.1a 第 3 条「引擎 init 已前置校验」+ worker §8「引擎 init/leaf_add 会 E_NAME_INVALID 拦截」）已用新事实 ✓。**问题在 CLAUDE L43 本身现在过时**，应同步更新（不属 SKILL 审计范围，但发布前 CLAUDE 内部需修）。

---

## C3 规范性（措辞/格式）— **passed（多 yellow，脱敏不彻底）**

| ✓/⚠ | 项 | 证据 |
|---|---|---|
| ✓ | 格式统一（markdown 红线框 / checklist / 表格） | 两 SKILL 全段 |
| ✓ | 双向引用清晰（commander §13.5 ↔ worker §4.6） | `commander:870` ↔ `worker:431` |
| ⚠ Y | 新迁内容含具体事故代号 `nanju04` / `nanju04api` | `commander:972/977/984`, `worker:415/708` |
| ⚠ Y | 新迁内容含模型代号 `GLM` / `GLM worker` | `commander:977` |
| ⚠ Y | 现有红线框（非新迁）含 `DeepSeek / 207 会话 / 额度打负 / 4 分钟` | `commander:865`, `worker:427` |
| ⚠ Y | 内部事故代号 `macp2 / macp3 / macp4` 在多章节作为协议术语 | commander 多处 / worker 多处 |

**C3-1 详情（新迁脱敏）**：commander §14.1a 整段用「nanju04 教训」「GLM worker」「nanju04api 10字符」作为反面教材。私有化发布应泛化为「自审事故」「某些 commander / 模型」「超长 prefix（如 10 字符）」。这些代号对外部读者无意义，且暴露内部测试代号体系。

**C3-2 详情（现有红线脱敏）**：commander L865 / worker L427 macp2 红线框的「DeepSeek 误用 / 4 分钟炸 207 会话 / 额度打负」属 SKILL 现有内容（非本轮新迁），但既然目标是"私有化发布"，这两处也应一并脱敏为「某 commander 误用 / 短时炸百级会话 / 成本爆炸」。

**注**：`macp2` 在 SKILL 内已是协议术语（如「macp2 红线」「macp2 循环放大器」），可保留为版本标记（类似「CVE-XXXX」），但作为发布文档建议改为「调用形式事故」类通用术语。

---

## C4 可发布性（私有化发布）— **passed（脱敏 yellow，无硬阻断）**

| ✓/⚠ | 项 | 证据（Explore A 报告） |
|---|---|---|
| ✓ | 无 `CLAUDE.md` 外部引用残留 | 全文 0 匹配 |
| ✓ | 无 pro/release 部署路径泄露（`D:/Proma-dev` / `~/.proma-dev` / `patches.cjs` / `md5`） | 全文 0 匹配 |
| ✓ | 无内部测试基础设施引用（`.context/plan` / `-test.cjs` / `e2e03` / `e2e04`） | 全文 0 匹配 |
| ⚠ Y | 事故专有名词未充分泛化（同 C3） | 见 C3-1 / C3-2 |
| ⚠ Y | 内部事故代号 macp2/nanju04 作为术语仍存 | 全文多处 |

**C4 结论**：**迁移本身没误带 CLAUDE 内部内容**（部署口诀/pro 测试要点/文档引擎一致性等 CLAUDE L47-72 内部段都没进 SKILL ✓）。阻断发布的只有「事故专有名词脱敏」一项清理工作（C3-1 / C3-2），属措辞类，不涉及协议逻辑。

---

## A1 反向映射（SKILL 声称 vs 引擎实际）— **passed（1 yellow，同 C1）**

| ✓/⚠ | 项 | 证据 |
|---|---|---|
| ✓ | LEAF_NAME_RE prefix 段一致 | `tree-engine.cjs:63` |
| ✓ | PREFIX_RE 前置校验一致 | `tree-engine.cjs:738-740` |
| ✓ | review_round done 门禁条件一致（review_required + ≥1 round + red=0 + 轮≤3） | `tree-engine.cjs:1691-1722` |
| ✓ | reviewer_kind:subagent 溯源一致（禁 session_id + 父段 + 溯源 subagent_spawn） | `tree-engine.cjs:1464-1481` |
| ✓ | subagent_spawn 父段 + output_ref size>0 校验一致 | `tree-engine.cjs:1378-1428` |
| ✓ | max_sessions 四路径登记 + E_MAX_SESSIONS 一致 | `tree-engine.cjs:1127/1989/3937` |
| ⚠ Y | worker §4.6 条件 1 措辞 `brief.audit_meta` vs 引擎 `leaf.audit_meta → state.audit_meta` 路径 | 同 C1-Y1 |

---

## A2 反事实攻击（GLM 按 SKILL 跑能被绕过?）— **passed（2 yellow，结构性非逻辑性）**

### A2-1 ⚠ §4.6 主动触发 GLM 真会主动开?

**SKILL 防线**：worker §4.6 条件 2 列 3 类触发（正式交付物 / 跨文件≥2 / 单文件≥1000字）+ nanju 教训段强调"不要等 brief 标 review_required，条件 2 是 worker 自己的判断"。

**反事实**：GLM 在长任务中可能自主简化判断——把「API 文档」判为「普通文档」非「正式交付物」，或把「同模块跨文件」误判为「单文件」。这是 nanju 重演的本质风险（GLM 不是没读到 SKILL，是自主简化）。

**结论**：SKILL 已尽力强化（教训段 + 红线框 + 双向引用），但 GLM 自主性是**本质上限**，非 SKILL 缺陷。**建议**：commander §14.1a 第 1 条「产出类文档任务默认 review_required=true」是**真正硬防线**（引擎门禁强制，不依赖 worker 自觉）——SKILL 已强调此条 ✓。worker 主动触发是补充防线，依赖 worker 行为。

**Severity: yellow（结构性风险，已尽可能强化）**

### A2-2 ⚠ prefix 防线 worker 真会上行 blocked?

**SKILL 防线**：worker §8 L708 教训段「收到 send_message 后第一件事 tree_leaf_get，若返回 E_LEAF_NOT_FOUND / E_NAME_INVALID → 立即上行 blocked 告知 commander，不要继续产文件」。

**反事实**：worker 可能：① 没读 §8（命名规范是次要章节，长任务中 GLM 可能跳过）；② 收到错误后理解成「我自己 leaf_id 错」而非「commander tree 命名错」；③ 直接忽略错误继续产文件。

**关键缓解**：引擎已强制 leaf_add 拦截非法 prefix（`E_NAME_INVALID`）——worker 即使不主动上行 blocked，**也不会污染 tree**（leaf 没入树），最坏只是浪费 token 产了无用文件。所以此防线失效的代价**有界**。

**Severity: yellow（防线依赖 worker 行为，但失效代价有界，引擎硬拦是真正防线）**

### A2-3 ✓ 收敛条件真能拦成本爆炸?

**多防线已落地**：
- 引擎硬上限 `audit_meta.max_sessions`（E_MAX_SESSIONS）—— 四路径登记
- done 门禁 review_round 轮数 ≤3
- patches.cjs 旁路登记（findCallerTreesForBypassGuard）覆盖 create_session 旁路（Sprint 5 根治）
- SKILL commander §13.5 L874-877 显式列了 max_sessions + max_subagent_spawn + 四路径 + patches 旁路 ✓

**结论**：macp2 场景（commander/worker 误用 create_session 当 reviewer）现在被 patches 旁路登记 + max_sessions 硬拦双覆盖。SKILL 措辞对齐引擎实际防御。

**Severity: pass**

---

## 发布前必修清单（阻断级：0；建议级：5）

> 所有「必修」均为脱敏类（不影响协议正确性），不修也能跑，但不符合"私有化发布"标准。

| 优先级 | 项 | 位置 | 建议改法 |
|---|---|---|---|
| 建议-高 | C3-1 / C4-1 新迁 nanju04/nanju04api 代号 | commander §14.1a L972/977/984, worker §4.6 L415, §8 L708 | 改为「自审事故（2026-07-15）」/「超长 prefix（如 10 字符）」 |
| 建议-高 | C3-2 / C4-2 现有 macp2 红线 DeepSeek/207会话/4分钟 | commander §13.5 L865, worker §4.6 L427 | 改为「某 commander 误用 / 短时炸百级会话 / 成本爆炸」 |
| 建议-高 | C3 / C4 GLM 模型代号 | commander §14.1a L977 | 改为「某些 commander / 模型」 |
| 建议-中 | C1-Y1 / A1-Y1 §4.6 条件 1 措辞 | worker §4.6 L409 | 改为「引擎强制：叶级 `leaf.audit_meta.review_required` 或树级 `state.audit_meta.review_required` 为 true 时，done 门禁强制 review_round（worker 不需自检此字段，引擎自动校验）」 |
| 建议-低 | C2-Y1 macp2↔nanju 对比未显式呈现 | commander §14.1a 末尾 | 加一句「与 §13.5 互补：§13.5 = 调用形式必须钉死（防成本爆炸）；本节 = 审计义务不可标可选（防质量防线被一句话释放）」 |

**附（非 SKILL 范围）**：CLAUDE.md L43「init 不校验 prefix 长度」描述现已过时（引擎 v0.7 批次6 已前置校验），CLAUDE 内部需同步更新。

---

## 审计员自评

本次审计非橡皮图章。**找到的真实问题**：
1. **措辞不一致**（C1/A1）：§4.6 条件 1 `brief.audit_meta` vs 引擎 `leaf.audit_meta → state.audit_meta` —— 是迁移时的措辞简化失真
2. **脱敏不彻底**（C3/C4）：新迁内容仍带 nanju04/GLM/nanju04api 等内部代号 —— "可发布"目标的清理工作未做
3. **CLAUDE 源过时**（C2 提示）：CLAUDE L43 描述的引擎行为已变（前置校验已加），CLAUDE 未同步

**没找到阻断级问题**：协议逻辑、根因链、铁律、checklist 全部正确，与引擎实现一致。

**结构性风险已诚实标注**（A2-1/A2-2）：GLM 自主简化和 worker 行为依赖是本质上限，SKILL 已尽力强化但无法消除——靠引擎硬防线（review_required 强制门禁 + leaf_add E_NAME_INVALID 拦截 + max_sessions 硬上限）兜底。
