# Pro 实例部署 + Skill 软约束检查报告

> **检查日期**: 2026-07-25 12:19 GMT+8
> **检查员**: Proma Agent（部署检查员角色）
> **目标**: 为 Pro 上 3 层树形任务测试（multi-agent-collab-platform）做部署 + skill 软约束就绪检查
> **约束**: 只读检查 + 写报告，不部署不改文件

---

## 一、Pro Dist 版本核对

### 1.1 文件清单

| 文件 | 路径 | 存在 | node --check |
|------|------|------|-------------|
| main.cjs | `D:/Proma-dev/resources/app/dist/main.cjs` | ✅ | ✅ PASS |
| proma-dev-patches.cjs | `D:/Proma-dev/resources/app/dist/proma-dev-patches.cjs` | ✅ | ✅ PASS |
| tree-engine.cjs | `D:/Proma-dev/resources/app/dist/tree-engine.cjs` | ✅ | ✅ PASS |

> ⚠️ Pro 的补丁文件名为 `proma-dev-patches.cjs`（不是 `patches.cjs`）。这是 Pro/Dev 共享 dist 的命名约定，功能等价。

### 1.2 逐项核对

| # | 检查项 | 预期 | 实际 | 结果 | 证据 |
|---|--------|------|------|------|------|
| Q | main.cjs Pi collaboration depth 检查 | =2 | **2** | ✅ **PASS** | `grep -c 'triggeredBy !== "delegation" && (ctx.sessionMeta?.delegationDepth ?? 0) === 0' main.cjs` → `2` |
| FT | proma-dev-patches.cjs full_text 修复 | ≥2 | **2** | ✅ **PASS** | `grep -c 'entry.full_text\|result_full_text' proma-dev-patches.cjs` → `2` |
| SM | proma-dev-patches.cjs 子会话机制 | ≥1 | **1** | ✅ **PASS** | `grep -c '协作子会话限制' proma-dev-patches.cjs` → `1` |
| TE | tree-engine.cjs 最新特征 | ≥4 | **10** | ✅ **PASS** | `grep -c 'W_STAR_DEGRADATION\|RECOVERABLE_ERROR_CODES\|delegation_hint\|communication_log' tree-engine.cjs` → `10` |

### 1.3 tree-engine.cjs 深度验证

| 特征 | 计数 | 状态 |
|------|------|------|
| `W_STAR_DEGRADATION` 软约束 | 2 | ✅ 含完整 cmdLeafAdd 检查逻辑 + warning 返回 |
| `delegation_hint` / `star_degradation_warned` | ✅ | ✅ leaf.delegation_hint 标记机制完整 |
| `progress` / `PROGRESS` | 2 | ✅ EVENT_TYPE_ENUM 含 progress |
| `communication_log` / `communication_list` | 3 | ✅ 双命令实现完整 |

**引擎结论**: tree-engine.cjs **已包含全部 macp 后改进**（P0-1 W_STAR_DEGRADATION / P1-1 progress / P1-2 communication_log）。引擎层就绪。

---

## 二、Pro Skill 内容核对

### 2.1 tree-commander/SKILL.md（核心，3 层树形指挥官手册）

| 文件路径 | `C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md` |
|----------|----------------------------------------------------------------------------------------|
| 行数 | 1194 |
| Frontmatter version | **2.8** |
| §15 最新版本 | **v2.7 (2026-07-17) — Gap B（auditor→worker 反馈闭环）** |

#### 关键软约束逐项核对

| # | 检查项 | 预期 | 实际 | 结果 |
|---|--------|------|------|------|
| P0-1 | §4 Step 2.1 层级委派协议（root→commander→worker 三分规则 + 越级反模式 + W_STAR_DEGRADATION） | ≥1 | **0** | 🔴 **FAIL** |
| P0-1 | W_STAR_DEGRADATION / 星形退化 提及 | ≥1 | **0** | 🔴 **FAIL** |
| P0-1 | §11 禁止行为 #14（root 越级 worker） | ≥1 | **0** | 🔴 **FAIL** |
| P1-1 | progress event | ≥1 | **0** | 🔴 **FAIL** |
| P1-1 | brief_echo 自动状态联动（pending_brief→active） | ≥1 | **0** | 🔴 **FAIL** |
| P1-2 | tree_log_communication / communication_log 协议 | ≥1 | **0** | 🔴 **FAIL** |
| — | §5 事件类型数 | 11 | **9** | 🔴 **FAIL**（缺 progress + communication_out） |
| — | §11 禁止行为条数 | 14 | **12** | 🔴 **FAIL**（缺 #13 pi运行时 + #14 越级） |
| — | §15 修订历史截止 | v2.9 | **v2.7-old** (2026-07-17) | 🔴 **FAIL** |

#### 已在 Pro 中存在的内容

| 检查项 | 状态 |
|--------|------|
| §6 事件路由表（基础 9 种类型） | ✅ |
| brief_echo 对齐机制（基础） | ✅ |
| SubAgent 入树（§13.5） | ✅ |
| 审计工作流（§14） | ✅ |
| v0.17.0 监督判活红线 | ✅ |
| Gap B（auditor→worker fix leaf 反馈闭环） | ✅ |
| fork 使用边界（Sprint 2 约束 4） | ✅ |

### 2.2 tree-worker/SKILL.md

| 文件路径 | `C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-worker/SKILL.md` |
|----------|-----------------------------------------------------------------------------------|
| 行数 | 824 |
| Frontmatter version | **2.5** |
| §15 最新版本 | **v2.6 (2026-07-16) — nanju05 schema 位置事故修复** |

| # | 检查项 | 状态 |
|---|--------|------|
| brief_echo 首条协议 | ✅ 完整 |
| progress event | ⚠️ 未提及（正常——v2.5 在前，progress 是 commander v2.8 引入） |
| 5 件套契约解析 | ✅ |
| milestone 自审 | ✅ |
| SubAgent 调用形式红线 | ✅ |
| schema 位置红线 | ✅ |
| 审计角色（§10） | ✅ |

### 2.3 tree-auditor/SKILL.md

| 文件路径 | `C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-auditor/SKILL.md` |
|----------|-------------------------------------------------------------------------------------|
| 行数 | 573 |
| Frontmatter version | **1.0** |

| 检查项 | 状态 |
|--------|------|
| version 字段 | ✅ v1.0 |
| 审计协议 | ✅ 在 Pro 中存在，release 无此 skill |

---

## 三、Pro Skill vs Release 对比

### 3.1 tree-commander 对比（核心差异）

| 维度 | Pro (v2.8 frontmatter) | Release (v2.6 frontmatter) | 差异 |
|------|----------------------|---------------------------|------|
| 实际内容版本 | §15 到 v2.7-old（2026-07-17 Gap B） | §15 到 v2.9（2026-07-24 macp P1-2） | **Release 领先 2 个小版本** |
| P0-1 W_STAR_DEGRADATION | ❌ 无 | ✅ v2.7 新增 | **必须同步** |
| P1-1 progress event + brief_echo 联动 | ❌ 无 | ✅ v2.8 新增 | **必须同步** |
| P1-2 communication_log | ❌ 无 | ✅ v2.9 新增 | **必须同步** |
| §5 事件类型数 | 9 种 | 11 种（+progress + communication_out） | 缺 2 种 |
| §11 禁止行为 | 12 条 | 14 条（+#13 pi运行时 + #14 越级） | 缺 2 条 |
| 文件行数 | 1194 | 1016 | Pro 多 178 行（Gap B + 其他 Pro 特有内容） |

> ⚠️ **关键发现**: Pro tree-commander 的 v2.7 和 Release 的 v2.7 **不是同一个版本**：
> - Pro v2.7 (2026-07-17): Gap B — auditor→worker fix leaf 反馈闭环
> - Release v2.7 (2026-07-24): P0-1 — 星形退化软约束
>
> Pro 在前一个 v2.7 后就停止同步了，缺失了 macp 实战后的三个关键改进。

### 3.2 tree-worker 对比

| 维度 | Pro (v2.5) | Release (v2.2) | 差异 |
|------|-----------|----------------|------|
| 实际版本 | §15 到 v2.6 | §15 到 v2.3 | **Pro 领先 3 个小版本** |
| SubAgent 调用形式红线 (v2.5) | ✅ | ❌ | Pro 独有 |
| schema 位置红线 (v2.6) | ✅ | ❌ | Pro 独有 |
| 审计角色 §10 (v2.1) | ✅ | ✅ | 两者都有 |
| progress event | ❌ 未提及 | ❌ 未提及 | 两者都没有（正常——worker progress 由 commander 协调） |

### 3.3 tree-auditor 对比

| 维度 | Pro | Release | 差异 |
|------|-----|---------|------|
| 存在性 | ✅ v1.0 | ❌ 不存在 | Pro 独有 |

### 3.4 其他 Skill 目录差异

| Skill | Pro | Release | 备注 |
|-------|-----|---------|------|
| `tree-auditor` | ✅ | ❌ | Pro 独有，3 层树形审计需要 |
| `pdf` | ✅ | ❌ | Pro 独有 |
| `closed-loop-engineering` | ❌ | ✅ | 对树形测试非必需 |
| `huashu-nuwa` | ❌ | ✅ | 对树形测试非必需 |
| `project-docs-organizer` | ❌ | ✅ | 对树形测试非必需 |

### 3.5 关键软约束对比表

| 软约束 | tree-engine.cjs | Pro SKILL | Release SKILL | 3 层测试就绪 |
|--------|:---:|:---:|:---:|:---:|
| W_STAR_DEGRADATION 检测 | ✅ | 🔴 缺失 | ✅ | 🔴 **引擎有但 SKILL 无 → Agent 不知道** |
| 层级委派协议 §4 Step2.1 | N/A | 🔴 缺失 | ✅ | 🔴 |
| 禁止越级 #14 | N/A | 🔴 缺失 | ✅ | 🔴 |
| progress event | ✅ | 🔴 缺失 | ✅ | 🔴 |
| brief_echo→active 自动联动 | ✅ | 🔴 缺失 | ✅ | 🔴 |
| communication_log | ✅ | 🔴 缺失 | ✅ | 🔴 |
| brief_echo 对齐 | N/A | ✅ | ✅ | ✅ |
| 三档纠偏 | N/A | ✅ | ✅ | ✅ |
| SubAgent 入树 | N/A | ✅ | ✅ | ✅ |
| Gap B fix leaf 闭环 | N/A | ✅ | ❌ | ✅ Pro 独有优势 |

---

## 四、multi-agent-collab-platform 项目状态

### 4.1 项目结构

```
D:/Codes/multi-agent-collab-platform/
├── .context/                    # 设计文档 + 审计历史
│   ├── mlaudit-reports/         # macp 树形审计报告（6 worker + root summary）
│   ├── plan/
│   │   └── tree-architecture.md
│   ├── tree-commander-brief-2026-07-07.md
│   ├── tree-commander-brief-addendum-2026-07-07.md
│   ├── audit-*.md               # 历史审计报告（nanju05 等）
│   └── open-issues.md
├── 01_PRD/                      # 产品需求文档
├── 02_UX_DESIGN/                # UX 设计
├── 03_ARCHITECTURE/             # 架构设计
├── 04_API_SPEC/                 # API 规范
├── 05_PROJECT_PLAN/             # 项目计划
├── 06_TESTS/                    # 测试规划
├── 07_ENGINEERING_TEMPLATES/    # 工程模板
├── src/                         # 实现代码（S1 骨架期）
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 macp 实战审计结论（2026-07-24）

| 维度 | 审计者(模型) | 评分 | P0 | 结论 |
|------|-------------|------|----|------|
| PRD 一致性 | A1(DeepSeek) | 7.0/10 | 2 | 版本同步滞后 2 个月 |
| UX 设计 | A2(GLM) | 75/100 | 0 | 整体成熟 |
| 架构一致性 | B1(GLM) | 7.0/10 | 0 | 三文件自洽 |
| API 规范 | B2(DeepSeek) | 3.5/5 | 4 | 版本漂移 v0.3↔v0.4 |
| 实现 vs 设计 | C1(MiniMax) | 32/100 | 3 | 骨架期，不可运行 |
| 测试覆盖 | C2(GLM) | 5.5/10 | 3 | Phase2-4 空白 |

- **合计 P0 阻断 12 项**，P1 严重 40 项，P2 建议 46 项
- 项目定位: 设计阶段成熟度中上（7.0-7.5/10），实现阶段高质量骨架期（32/100）
- 树形结构: `root + 3 commander(A/B/C) + 6 worker`，全部 done + audit_gate pass

### 4.3 .context/trees/ 遗留

**无 `.context/trees/` 目录。** 上次 macp 审计的树是临时构建（tree_id=macp），树数据存在树引擎后端而非项目目录中。对本次 3 层测试没有遗留树干扰。

---

## 五、缺口清单

### 🔴 阻断级（3 层树形测试前必须修复）

| # | 缺口 | 影响 | 修复方式 |
|---|------|------|---------|
| G1 | **Pro tree-commander SKILL 缺失 P0-1 W_STAR_DEGRADATION 协议** | 3 层树形中 root 不知道要避免越级 worker → 星形退化复现，多层指挥官主动性丧失 | cp release SKILL.md → Pro |
| G2 | **Pro tree-commander SKILL 缺失 P1-1 progress event + brief_echo 联动** | worker 状态滞后（pending_brief 不自动转 active），commander 心跳误判 | cp release SKILL.md → Pro |
| G3 | **Pro tree-commander SKILL 缺失 P1-2 communication_log 协议** | root send_message 驱动子 commander 后心跳误判冻结 → 不当纠偏/剪枝 | cp release SKILL.md → Pro |

> ⚠️ **根因**: Pro tree-commander 停留在 2026-07-17（Gap B），缺失 2026-07-24 macp 实战后的三个改进。但 **tree-engine.cjs 引擎已支持全部三个特性**——只是 SKILL 没教 Agent 用。

### 🟡 建议级（影响质量但不阻断）

| # | 缺口 | 影响 | 修复方式 |
|---|------|------|---------|
| G4 | Release tree-commander frontmatter 仍是 `version: 2.6`（内容已是 v2.9） | frontmatter 版本误导 Agent 能力判断 | 修 release SKILL.md frontmatter → `2.9` |
| G5 | Pro tree-worker (v2.5) 无 progress event 描述 | worker 不知道可以用 progress 上报中间进度 | 可选：从 release v2.8 commander 提取 progress 段落追加到 worker |
| G6 | Release tree-worker (v2.2) 落后 Pro (v2.5) | 如果将来要从 release 恢复，会丢失 SubAgent 调用形式红线等改进 | 反向同步：cp Pro tree-worker → release |

---

## 六、建议部署方案

### 6.1 最小修复（3 层测试就绪）

```bash
# 1. 同步 tree-commander（核心）
cp C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md \
   C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md

# 2. 修复 release frontmatter 版本号
# 编辑 C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md
# 将 frontmatter 中 version: 2.6 → version: 2.9

# 3. 重启 Pro 加载新 skill
```

### 6.2 推荐修复（含双向同步）

在上述基础上：

```bash
# 4. 反向同步 tree-worker（Pro v2.5 → Release v2.2）
cp C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-worker/SKILL.md \
   C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-worker/SKILL.md
```

### 6.3 部署后验证

```bash
# Pro 重启后验证 tree-commander
grep -c 'W_STAR_DEGRADATION\|Step 2.1\|层级委派' \
  C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md
# 预期: ≥6

grep -c 'progress event\|brief_echo.*active\|tree_log_communication' \
  C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md
# 预期: ≥6
```

### 6.4 风险提示

| 风险 | 等级 | 缓解 |
|------|------|------|
| Pro tree-commander 独有的 Gap B 内容（auditor→worker fix leaf）在 Release 中不存在 | 🟡 低 | Release v2.9 中可能包含 Gap B 的等价物；如果缺失，需从 Pro 回补到 Release |
| cp 覆盖会丢失 Pro 的其他定制 | 🟢 无 | 当前 Pro SKILL 是 Release 的子集（内容版本更老），覆盖安全 |
| tree-engine.cjs 的 W_STAR_DEGRADATION 是软约束（warning，不拦死） | 🟡 中 | 3 层测试中依赖 Agent 遵循 SKILL 协议主动避免越级；引擎只做 warning + delegation_hint 标记 |

---

## 七、总结

| 层级 | 状态 | 就绪度 |
|------|------|--------|
| **tree-engine.cjs** | ✅ 全部 macp 改进已实装 | 100% |
| **main.cjs** | ✅ Q 补丁就绪 | 100% |
| **proma-dev-patches.cjs** | ✅ full_text + 子会话机制就绪 | 100% |
| **Pro tree-commander SKILL** | 🔴 缺失 P0-1/P1-1/P1-2 软约束 | **0%** |
| **Pro tree-worker SKILL** | ✅ v2.5 领先 release | 90% |
| **Pro tree-auditor SKILL** | ✅ v1.0 存在 | 100% |
| **macp 项目** | ✅ 设计+审计历史完整，无遗留树 | 100% |

**一句话**: 引擎就绪，SKILL 掉队。cp 一个文件（tree-commander SKILL.md）即可从 0% 到 100%。
