# 专家组审议问题清单 — 8 个决议题

> **日期**: 2026-06-23 14:41
> **配套**: `00-handoff.md` + `../tree-system-architecture-analysis-2026-06-23.md`
> **用法**: 每题给出选项 → 选 → 给理由。起草人推荐仅供参考，欢迎挑战
> **格式**: 每题含【背景】【选项】【利弊】【起草人推荐】【风险】

---

## 议题 1：核心论断是否接受？

### 背景

v2 报告的核心论断：

> **这不是 prompt 写得不够好的问题。靠 prompt 解 30%，剩下 70% 必须靠架构层硬约束 + 严格限制层级深度。**

具体分配：
- ❌ 30% 是 prompt 表达不够结构化（可优化）
- ❌ 30% 是模型本身 RLHF 副产物（sycophancy / reward hacking，prompt 改不动）
- ✅ 40% 是 Agent harness 缺少硬约束层（可改）

### 选项

- **A. 完全接受**：30/30/40 分配合理，按 v2 报告推进
- **B. 接受方向但调整比例**：比如 prompt 占比应该更高（40%+），harness 占比更低
- **C. 部分接受**：方向对，但"prompt 改不动 RLHF"过于绝对，prompt engineering 还是有空间的
- **D. 不接受**：核心问题还是 prompt 写得不够好，架构层改造过度

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 直接进入实施，省时间 | 比例拍脑袋，没量化数据支撑 |
| B | 更严谨 | 需要补充实验数据 |
| C | 留出 prompt 优化空间 | 可能拖延架构改造 |
| D | 工作量小 | 治标不治本，6 个月后还会回来 |

### 起草人推荐

**A. 完全接受**。理由：
1. 三家调研结论惊人一致（学术 + 工业 + 框架经验）
2. Anthropic / OpenAI 自己的官方文档都承认 multi-agent 不可靠
3. 用户已实测过 prompt 优化（35 条 TAO 规则），效果有限
4. 30/30/40 是定性分配，不需要精确数字

### 风险

- 如果实际比例是 50/30/20（prompt 占大头），那 v0.7 投入产出比可能不如继续优化 prompt
- 没有量化方法验证（除非专门跑一组对比实验）

---

## 议题 2：三层防御架构是否采纳？

### 背景

v2 报告提出 5 层架构（Layer 0-4），当前只有 Layer 0（prompt）+ Layer 3 部分（TAO Watcher 数据合规审计）。

```
Layer 4: 模型层契约（v0.7+ Proma 平台改造）
Layer 3: 监督平面（"天道"）— 部分有
Layer 2: 主动 supervision（事件驱动）— 完全缺
Layer 1: Hard Gate（Capability + DbC + Schema + hash chain）— 完全缺
Layer 0: prompt 软约束 — 已有
```

### 选项

- **A. 完全采纳，按 P0→P1→P2 推进**（P0 = Layer 1，P1 = Layer 2，P2 = 强化 Layer 3，P3 = Layer 4）
- **B. 只做 Layer 1（P0）观察效果，Layer 2/3/4 暂缓**
- **C. Layer 1 + Layer 2 都做（P0+P1）**，Layer 3 强化 / Layer 4 暂缓
- **D. 自定义组合**（请说明）

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 完整 defense in depth | 工作量大（5-6 周编码） |
| B | 最小投入，快速验证 | Layer 1 单层防御，Layer 2 缺失时 commander 仍可能漏接 |
| C | 平衡，覆盖 80% 痛点 | Layer 3 不强化，liveness 缺失可能漏"硬死" |
| D | 灵活 | 需要重新评估 |

### 起草人推荐

**C. Layer 1 + Layer 2 都做**。理由：
1. Layer 1（Hard Gate）解决"事中拦截"
2. Layer 2（主动 supervision）解决"worker 失败即时接管"
3. Layer 3 已有 TAO Watcher，强化（加 liveness）可以放到 P2
4. Layer 4 是 Proma 平台改造，依赖 Anthropic / Proma 官方，本项目不可控

### 风险

- Layer 1 + Layer 2 同时改 tree-state.js，可能有合并冲突
- 主动 supervision 改 commander SKILL.md，可能影响现有 16 个历史 tree 的续跑

---

## 议题 3：层级深度硬限制怎么定？

### 背景

qfv2 实测跑到 **5 层深**（root → C → Cr → Ccr1 → worker），远超工业极限。

每层指令保真度掉 39%（Laban ICLR 2026），5 层下来 = **92% 信息丢失**。

Erlang OTP 工业上 3-5 层就停；Anthropic 自己只用 2 层。

### 选项

- **A. 严格 depth ≤ 2**（1 commander + N worker，无 sub-commander）
- **B. depth ≤ 3**（root → sub-commander → worker，sub-commander 必须更强模型）
- **C. depth ≤ 4**（容忍 1 层额外嵌套）
- **D. 不硬限制，只加 warning + 审计**（保持现状但提示）

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 工业最佳实践，Anthropic 同款 | 业务受限，qfv2 式大任务无法表达 |
| B | 平衡，覆盖 80% 业务 | sub-commander 强模型成本高 |
| C | 兼容现有 qfv2 | 第 4 层 worker 决策质量断崖 |
| D | 不破坏现有数据 | 治标不治本 |

### 起草人推荐

**B. depth ≤ 3**。理由：
1. 80% 任务 depth ≤ 2 能搞定（扁平化 + worker multi-step plan）
2. 大任务确实需要 sub-commander 时，强制用更强模型（如 Claude Opus 4.x）兜底
3. depth ≥ 4 明确禁掉，避免 qfv2 式失控重演
4. 配套：`root_dod.max_depth` 字段让用户可配置（默认 3，硬上限 5）

### 风险

- qfv2 这种已经跑出来的 5 层 tree 无法继续 add leaf
- 业务方可能抱怨"限制太严"
- sub-commander 强模型成本（Claude Opus 比 DeepSeek 贵 10×）

### 关联代码草案

```js
// tree-state.js cmdLeafAdd 加 depth 校验
const depth = computeLeafDepth(state, args.parent);
const maxDepth = state.root_dod?.max_depth || 3;
if (depth >= maxDepth) {
  throw new TreeStateError(E_TREE_DEPTH_EXCEEDED, ...);
}

// role 加 enum 校验
const ALLOWED_ROLES = ['root', 'commander', 'worker', 'auditor', 'integrator'];
if (!ALLOWED_ROLES.includes(args.role)) {
  throw new TreeStateError(E_ROLE_INVALID, ...);
}
```

---

## 议题 4：Capability Token 是否上 P0？

### 背景

v2 报告建议给 worker 颁发 capability token（fork 时），工具调用前校验。源自 seL4 / Fuchsia 的 capability-based security。

```js
// commander fork worker 时颁发:
{
  "worker_id": "w_20260623_001",
  "tools": ["read_file", "grep"],          // 没有 write_file / bash
  "write_paths": ["workspace/temp/"],
  "ttl_seconds": 1800,
  "max_tokens": 8000,
  "parent": "commander_20260623_root"
}

// worker 调 write_file → token 里没有该工具 → 直接 throw
```

### 选项

- **A. P0 立即做**（v0.7 第一个里程碑）
- **B. P1 跟 DbC 一起做**（v0.7 第二个里程碑）
- **C. P2 中期做**（先看 DbC 效果）
- **D. 不做**（依赖 DbC 就够了）

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 最强约束，从源头杜绝越权 | 实现复杂（要改 Proma 平台工具调用层） |
| B | 平衡，跟 DbC 互补 | 工作量大 |
| C | 风险低，先验证 DbC | 单 DbC 可能不够（worker 自己调工具时绕过） |
| D | 工作量小 | worker 仍能用 write_file 伪造产出 |

### 起草人推荐

**B. P1 跟 DbC 一起做**。理由：
1. DbC 是"函数调用前校验"，Capability 是"工具调用前校验"，互补不重叠
2. 单 DbC 不够（worker 调 write_file 时绕过 tree-state.js）
3. 但 Capability 改 Proma 平台工具调用层，依赖 Proma 官方，复杂度高
4. 折中：先做 DbC（P0，1-2 天），看效果再决定 Capability 是 P1 还是 P2

### 关键风险

**Capability token 不能放 prompt 里**。理由：LLM 会"读"到自己的 token，可能学会自降权或绕过。Token 必须存在 tree-state.js / 外部 store，**仅工具调用时同步校验**，LLM 永远不直接接触 token 内容。

这个约束决定了 Capability 实现的复杂度——不是简单的 prompt 注入，而是要改 Proma 的工具调用拦截层。

---

## 议题 5：v0.5 / v0.6 / v0.7 怎么合并？

### 背景

现在有三套计划：
- **v0.5**（v1 审议时已批准方向）：4 个用户反馈 bug（剪枝语义 / skill 全局 / watcher / 命名）
- **v0.6**（v1 审议草稿）：Phase 6 审计硬约束 8 个子步骤（CP1-CP6 + SP1 + SP4）
- **v0.7**（v2 报告建议）：按三层防御架构重写，覆盖 v0.5 + v0.6 + 新增 Capability/主动 supervision/depth 限制

### 选项

- **A. 全部合并为 v0.7**，按三层架构重写优先级
- **B. v0.5 / v0.6 / v0.7 三套并行**（v0.5 先做用户层 bug，v0.6 做 DbC，v0.7 做 Capability + 主动 supervision）
- **C. v0.5 + v0.6 合并为 v0.7**（用户层 bug + DbC），Capability + 主动 supervision 推到 v0.8
- **D. 自定义组合**

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 一致性最好，避免散乱 | 工作量大（5-6 周编码），周期长 |
| B | 渐进式，可观察 | 三套计划管理复杂 |
| C | 平衡，先把 80% 痛点解决 | Capability 推后，worker 仍能伪造 |
| D | 灵活 | 需要重新设计 |

### 起草人推荐

**A. 全部合并为 v0.7**。理由：
1. v0.5 / v0.6 高度耦合（都改 tree-state.js + commander/worker SKILL.md）
2. 分批做反而增加 migrate 次数（每次都要让历史数据合规）
3. 一次性 commit 减少协调成本
4. 用户偏好"全部修完一次性 commit"（v1 审议已确认）

### 风险

- v0.7 工作量约 5-6 周编码，用户可能等不及
- 中间任何一步出错，整个 v0.7 阻塞

### v0.7 工作量估算

| Phase | 内容 | 时间 | 文件数 |
|---|---|---|---|
| Phase A | DbC（v0.6 Phase 6 全部 8 子步骤）+ depth/role 校验 | 4-5 小时 | tree-state.js + 2 SKILL.md |
| Phase B | Capability Token 机制 | 2-3 天 | tree-state.js + patches.cjs + 2 SKILL.md |
| Phase C | 主动 supervision（commander 持 worker lifecycle） | 2-3 天 | commander SKILL.md + tree-state.js |
| Phase D | v0.5 用户层 bug（剪枝 / skill 全局 / watcher 简化） | 4 小时 | 3-4 文件 |
| Phase E | Event hash chain + Snapshot | 1-2 天 | tree-state.js |
| Phase F | Liveness heartbeat 加到 TAO Watcher | 半天 | patches.cjs |
| Phase G | 部署 + 用户验证 + wiki + commit | 用户配合 | - |
| **总计** | | **2-3 周** | **15+ 文件** |

---

## 议题 6：复杂任务用 A/B/C 哪种方案？

### 背景

层级深度限制后，大任务怎么拆？三种替代方案：

- **方案 A 扁平化**：root 直接管 N worker（最多 10）
- **方案 B meta-tree**：多个独立 tree 协调
- **方案 C 折中**：depth ≤ 3 + sub-commander 强模型

### 选项

- **A. 默认方案 A，备选 B**（depth ≤ 2 优先，超大任务用 meta-tree）
- **B. 默认方案 C**（容忍 1 层 sub-commander，业务灵活）
- **C. 三种方案都支持，用户在 root_dod 里选**（max_depth + tree_mode 字段）
- **D. 只支持方案 A**（最严格，业务受限）

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 工业最佳实践 | 大任务用户要拆 meta-tree，学习成本 |
| B | 业务灵活 | sub-commander 强模型成本高 |
| C | 完整支持 | 实现复杂，三种模式都要测 |
| D | 实现最简 | 大任务无法表达 |

### 起草人推荐

**C. 三种方案都支持**。理由：
1. 用户业务多样（小任务扁平化，大任务 meta-tree，特殊场景 sub-commander）
2. root_dod 字段（`max_depth` + `tree_mode`）让用户在 brief 里声明
3. 默认值：max_depth=3, tree_mode=flat（方案 A）
4. tree-state.js 校验时按 root_dod 走

### 风险

- 三种模式都要测试，工作量增加
- meta-tree 跨 tree 协调机制需要单独设计（v0.8 候选）

---

## 议题 7：migrate 策略 — 历史 16 个 tree 怎么办？

### 背景

现有 16 个历史 tree 数据。其中 qfv2 是 5 层深，其他大多是 2 层。

强制 migrate 可能让"已经收尾的 tree"重新出现 warning。

### 选项

- **A. 强制 migrate**（所有历史 tree 必须符合新 schema）
- **B. 只对新 tree 生效**（历史 tree 保留原样，新 tree 必须合规）
- **C. 不覆盖策略**（按版本号判断，skill 更新才覆盖）
- **D. 强制回滚超限数据**（qfv2 这种 5 层强制截断到 3 层）

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 数据一致性 | 历史 archived tree 可能 warning 泄露 |
| B | 不破坏历史 | 数据不一致 |
| C | 渐进式 | 复杂 |
| D | 严格 | qfv2 数据丢失 |

### 起草人推荐

**B + C 组合**：只对新 tree 生效 + skill 更新才覆盖（v1 审议时已选不覆盖策略）。理由：
1. 历史 archived tree 已经收尾，强行 migrate 没意义
2. qfv2 这种活跃的 5 层 tree，下次 add leaf 时会被 depth 校验拦住，自然限制
3. skill 用版本号判断，避免覆盖用户在新 ws 手改的内容

### 风险

- 历史 tree 数据 schema 不一致，未来 debug 困难
- qfv2 这种 5 层 tree 续跑时被拦，用户体验差

---

## 议题 8：v0.7 完成后怎么验证？

### 背景

v0.7 是机制层改造，验证方法要更严格。

### 选项

- **A. 重跑 mdref / pytut 同样的测试**（对比 v0.1 vs v0.7 的 CP1-CP6 是否消失）
- **B. 加 depth / role 压力测试**（人为构造 5 层 tree，验证是否被拦）
- **C. 加 Capability Token 攻击测试**（worker 尝试调越权工具，验证是否被拒）
- **D. 全部都做**

### 利弊

| 选项 | 优点 | 缺点 |
|---|---|---|
| A | 复现性最强 | 只能验证 CP1-CP6，不能验证 depth/capability |
| B | 验证 depth 限制 | 不验证审计可信度 |
| C | 验证 capability | 不验证 depth |
| D | 完整 | 工作量大 |

### 起草人推荐

**D. 全部都做**。理由：
1. v0.7 改动面大，单一测试不够
2. A 验证 v0.6 Phase 6 的 8 个 DbC 子步骤
3. B 验证议题 3 的 depth 限制
4. C 验证议题 4 的 Capability Token
5. 三组测试互不重叠

### 测试矩阵

| 测试 | 验证什么 | 通过条件 |
|---|---|---|
| T1: 重跑 mdref | CP1-CP6 是否消失 | 6 个 CP 全部 ✅ |
| T2: 重跑 pytut | 同上 | 6 个 CP 全部 ✅ |
| T3: depth 压力 | depth ≤ 3 是否被拦 | 尝试 add depth=4 leaf → throw |
| T4: role enum | 自由文本 role 是否被拒 | role="custom" → throw |
| T5: capability 攻击 | worker 越权调 write_file | throw E_CAPABILITY_DENIED |
| T6: 主动 supervision | worker 失败 commander 是否接管 | mock worker fail → commander retry |

---

## 总结：起草人的整体推荐

| 议题 | 推荐 |
|---|---|
| 1 核心论断 | A 完全接受 |
| 2 三层架构 | C Layer 1 + Layer 2 |
| 3 层级深度 | B depth ≤ 3 |
| 4 Capability Token | B P1 跟 DbC 一起 |
| 5 计划合并 | A 全部合并为 v0.7 |
| 6 复杂任务方案 | C 三种都支持 |
| 7 migrate 策略 | B + C 只对新 tree + 不覆盖 |
| 8 测试方法 | D 全部都做 |

**预计工作量**：2-3 周编码 + 用户验证。**交付**：v0.7 release + 完整测试报告 + wiki + commit。

---

> **本清单由 Proma Agent 撰写，2026-06-23 14:41**
> **请专家组逐题给判断 + 理由，不需要全部同意起草人推荐**
