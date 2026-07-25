# macp4 SKILL + Memory 实施报告

> **实施人**: macp4 SKILL 实施员
> **日期**: 2026-07-25 22:22 GMT+8
> **输入**: `skill-evaluation.md` P1-F/G/H + P2-B/C 论证

---

## 一、改动清单

### P1-F：§13.3a root done 路径扩展为三子节

| 位置 | 改动 | 行数 |
|------|------|------|
| `SKILL.md` §13.3a（原 L809-817） | 从单段"auto_upgrade 简化路径"扩展为三个子节 | ~30 行新增 |

**§13.3a.1 正常路径**：引擎已修 L1767 豁免时，写 done event → auto_upgrade → set-status done。

**§13.3a.2 备选路径**：引擎未修时（当前状态，macp3 实证），root 先 milestone_add 给自己 → milestone_set_result → done event → set-status done。expect_outputs=[] 空数组若引擎拒则用占位。

**§13.3a.3 诊断**：set-status done 撞 E_SCHEMA_INVALID → 查 milestones（走备选）；E_GATEKEEPER_REQUIRED → 查 done event；非以上 → 翻 §13.7。

---

### P1-G：§13.4.0a 待审 worker 清单维护流程

| 位置 | 改动 | 行数 |
|------|------|------|
| `SKILL.md` §13.4.0 步骤 D 后 | 新增 §13.4.0a（6 步清单流程） | ~18 行 |
| `SKILL.md` §11 禁止行为 | 新增 #16：root 中转链不维护待审清单 | ~2 行 |

6 步：记（派 worker 时记录）→ 更（worker done 更新状态）→ 转（中转给 auditor）→ 划（审完划掉）→ 催（定期核对未审）→ 验（全树 done 前最终遍历）。

清单格式建议 `.context/pending-audit.md`。全清单空 = 审查闭环完成。

---

### P1-H：§6 brief_echo alignment 回填确认清单

| 位置 | 改动 | 行数 |
|------|------|------|
| `SKILL.md` §6 回填机制末尾 | 新增"回填完成确认清单"（5 项 + 并发规则） | ~15 行 |
| `SKILL.md` §11 禁止行为 | 新增 #17：commander 漏回填 alignment | ~2 行 |

5 项 checklist：brief_echo 写入 ✅ → 评估执行 ✅ → 回填 event append ✅ → comm_log 记录 ✅ → 下一 worker 才能开始。

并发规则：≥2 worker brief_echo → 按 leaf_id 字典序排队，禁止并发评估+并发回填。

---

### P2-B：知识沉淀（auto memory）

| 文件 | 改动 | 行数 |
|------|------|------|
| `.claude/memory/macp3-e-no-ownership.md` | **新增** — E_NO_OWNERSHIP 中转协议记忆 | ~30 行 |
| `.claude/memory/macp3-root-done-gate.md` | **新增** — root done 门禁记忆 | ~25 行 |
| `.claude/memory/MEMORY.md` | 索引区前追加 2 行 | +2 行 |

两个 memory 文件以"已知模式 + 条件"写法，即使引擎修了也能帮助理解 SKILL 里的兼容代码。

---

### P2-C：§4 Step2.1a 层级选择指导

| 位置 | 改动 | 行数 |
|------|------|------|
| `SKILL.md` §4 Step2.1 后 | 新增 §4 Step2.1a（条件表 + 权衡说明） | ~18 行 |

条件表：worker≤6 → 3 层；7-12 → 3 层+多 commander；>12 → 4 层；≤3 → 2 层。
权衡：3 层链条短延迟低但 commander 负载高；4 层多一级中转但子域隔离。
macp3 选 3 层原因说明 + C2 遗漏提示（3 层需维护待审清单）。

---

### §13.7 错误码速查表

| 位置 | 改动 | 行数 |
|------|------|------|
| `SKILL.md` §13.7 表末 | 新增 `E_SCHEMA_INVALID` 行（root done 门禁场景） | +1 行 |

---

### version + §15

| 位置 | 改动 |
|------|------|
| `SKILL.md` §0 | `version: 2.9.2` → `2.9.3` |
| `SKILL.md` §15 | 新增 v2.9.3 条目（P1-F/G/H + P2-C 摘要） |

---

## 二、改动统计

| 层 | 新增节 | 修改节 | 新增行数 |
|----|--------|--------|---------|
| tree-commander SKILL | 3（§4 Step2.1a + §6 checklist + §13.4.0a） | 4（§0, §11, §13.3a, §13.7, §15） | ~90 |
| auto memory | 2 新文件 + MEMORY.md 索引 | — | ~60 |
| **总计** | | | **~150** |

---

## 三、cp pro 结果

```
release: C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-commander/SKILL.md
pro:     C:/Users/sir_c/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md

✅ cp 成功（1159 行）
✅ pro SKILL version = 2.9.3
```

memory 文件已按约束仅写入 release（`C:/Users/sir_c/.proma/agent-workspaces/proma/.claude/memory/`），不 cp 到 pro（pro 的 `.claude/memory` 不一定存在）。

---

## 四、验证结果

| 验证项 | grep 结果 |
|--------|----------|
| §13.3a 三子节（§13.3a.1 / .2 / .3） | ✅ L846-877（三子节 + 诊断） |
| §13.4.0a 待审清单 | ✅ L911（§13.4.0a 节标题） |
| §6 回填完成确认清单 | ✅ L466（checklist 标题 + 5 项） |
| §4 Step2.1a 层级选择 | ✅ L251（§4 Step2.1a） |
| version 2.9.3 | ✅ L21 |
| §15 v2.9.3 条目 | ✅ L1147 |
| §11 #16 / #17 | ✅ L716-717 |
| §13.7 E_SCHEMA_INVALID root done | ✅ L983 |
| memory 文件存在 | ✅ macp3-e-no-ownership.md + macp3-root-done-gate.md |
| MEMORY.md 索引 2 行 | ✅ E_NO_OWNERSHIP + root done 门禁 |
| pro cp | ✅ version 2.9.3, 1159 行 |

---

## 五、风险/注意点

1. **P1-F + P0-E 联动**：引擎侧 P0-E 已修 L1767（`!isAuditor && !isRoot`），root done 走 §13.3a.1 正常路径即可。§13.3a.2 备选路径在已修引擎上是冗余代码，但保留作为"不确定引擎版本"时的兼容说明。若未来确认所有部署均已修，可降级 §13.3a.2 为"旧版引擎兼容说明"。

2. **P1-H 并发效率**：硬 checklist 要求排队处理 brief_echo，轻度降低 commander 并发响应速度。brief_echo 评估通常几秒，可接受。若未来 worker > 20，可改"每 3 个一批"。

3. **P1-G 清单维护负担**：root 已承担中转调度 + 心跳 + 纠偏，加清单维护可能 overload。若 root 上下文接近甜点（85%），建议把清单维护委派给独立 tracker leaf 或 SDK SubAgent。

4. **memory 不在 pro**：P2-B memory 文件仅写入 release。若 pro 需要，需用户手动同步或后续补充。
