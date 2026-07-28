# Tree Harness 工程 — 对抗性审计最终报告

> **审计日期**: 2026-07-28
> **审计树**: `audit`（树形团队：1 root + 6 commander + 1 auditor，7 leaf 跨 3 模型厂商）
> **审计对象**: Tree Harness 工程 FINAL-REPORT（`pr/20260728-harness-final/FINAL-REPORT.md`），声称 7/7 完成，C1=86
> **审计立场**: 对抗性（假设 FINAL-REPORT 过度宣称，找证据反驳或确认）
> **审计团队**: DeepSeek-v4-pro (D1/D3/D5) + GLM-5.2 (D2/D4/D6) + MiniMax-M3 (auditor)

---

## 一、真实完成度判定

### FINAL-REPORT 7/7 逐条独立核验

| # | FINAL-REPORT 声称 | Root 判定 | Auditor (MiniMax-M3) 独立判定 | 证据 |
|---|-------------------|:---------:|:----------------------------:|------|
| 1 | P0 接力协议补章 + idle 多维核验 | ⚠️ 部分 | ⚠️ YELLOW | SKILL §13.3b 存在但 D3 发现 4 RED 矛盾 |
| 2 | P1 audit_log schema severity + auditor ≥2 events + emergent 协作教化 | ✅ 达成 | ⚠️ YELLOW | 引擎 v0.21 强制生效；协作教化方向与 v0.17.1 教训反向 |
| 3 | 引擎 segment_add 评估 | ✅ 达成 | 🔴 **RED** | **Auditor 推翻**：评估≠实现，A2 leaf_transfer_owner 仍在后续 Roadmap |
| 4 | 项目层 4 缺陷全修 + C1 85+ | ✅ 达成 | ⚠️ YELLOW | **Auditor 指正**：缺陷属测试底座项目非 tree-harness，范围混淆 |
| 5 | C1 权威复评 85+ | ✅ 达成 | ⚠️ YELLOW | **Auditor 指正**：机制真实但范围混淆（同标准4） |
| 6 | 综合实战验证 | ✅ 达成 | ⚠️ YELLOW | **Auditor 指正**：实战真实但 CLI 兜底是 P0 安全倒退 |
| 7 | tree-iterative-development 终版 + 归档 | ❌ 未达成 | 🔴 RED | SKILL v1.4 文件在磁盘上不存在 |

**Root 初判完成度: 5.5-6/7**（偏宽容，对标准 3/4/5/6 判定过宽）
**Auditor 独立判定: 3.5-4/7**（MiniMax-M3 异厂商交叉验证，纠正同厂商偏差）
**采纳 Auditor 判定**（以异厂商独立评估为准，遵循 macp2 教训：同厂商自评偏乐观）

---

## 二、七维度关键发现

### D1 需求覆盖（DeepSeek-v4-pro）: 7 RED + 6 YELLOW

**核心结论: FINAL-REPORT 过度宣称**

| ID | Severity | 发现 |
|----|----------|------|
| P0-1 | 🔴 RED | 闭环三要件（即时/可定位/人验证最后一跳）未在 FINAL-REPORT 中映射 |
| P0-2c | 🔴 RED | macp2 收敛条件（角色上限+轮数≤3+red_count=0）未覆盖 |
| P0-3a | 🔴 RED | nanju 审计义务（review_required=true 默认策略）未覆盖 |
| P0-3b | 🔴 RED | nanju auditor 硬 DoD 禁"可选"措辞未覆盖 |
| OPS-1 | 🔴 RED | 部署同步口诀（4步+md5校验+备份）未覆盖 |
| OPS-2 | 🔴 RED | SKILL 部署分离 bug（.proma-pro vs .proma-dev）未覆盖 |
| SEC-1 | 🔴 RED | CLI 兼容通道与 SECURITY.md 三层防御拓扑有倒退风险 |
| STD-7 | 🔴 RED | tree-iterative-development SKILL v1.4 文件缺失 |

### D2 引擎语义（GLM-5.2）: 1 RED + 5 YELLOW

**核心结论: SKILL §13.3a 与引擎 L1765 直接矛盾**

| ID | Severity | 发现 |
|----|----------|------|
| F8 | 🔴 RED | **SKILL §13.3a 声称 root milestone 无豁免，但引擎 L1765 `if(!isAuditor&&!isRoot)` 明确豁免 root**——直接矛盾。root done 实际走 §13.3a.1 正常路径即可，§13.3a.2 备选路径是冗余 |
| F1 | 🟡 YELLOW | CLI 兼容通道 AND 短路模式：不传 caller 全跳过，10 项校验被绕过 |
| F3 | 🟡 YELLOW | segment_add dispatch 不透传 caller，无鉴权 |
| F10 | 🟡 YELLOW | done event 不自动注入 caller_session_id，防御纵深缺口 |
| F11 | 🟡 YELLOW | auto_upgrade/brief_echo 联动是引擎内置非纯 SKILL 协议层（FINAL-REPORT "0引擎改动"不准确） |

### D3 SKILL 完备性（DeepSeek-v4-pro）: 4 RED + 8 YELLOW

**核心结论: SKILL v2.9.7 存在内部矛盾影响可执行性**

| ID | Severity | 发现 |
|----|----------|------|
| F1 | 🔴 RED | §11 标题"12条"实为17条，计数严重滞后 |
| F2 | 🔴 RED | §14.2 fix leaf 强制 vs §14.6 fix leaf "可选"——操作者不知是否必须建 fix leaf |
| F3 | 🔴 RED | §14.2 7 leaf 结构 vs §14.3 仅6个角色模板（缺 fix）——按模板派会漏 fix |
| F4 | 🔴 RED | §13.3a 声称"不走§13.3八步"但备选路径复用步骤1-2——逻辑自相矛盾 |
| F6 | 🟡 YELLOW | §13.7 错误码速查表仅覆盖 9/51 错误码，遗漏 E_CHILDREN_NOT_DONE 等关键码 |
| F7 | 🟡 YELLOW | idle 多维核验漏 communication_log 检查（§6 强制记 comm_log 的核心目的就是防误判 idle） |

### D4 实战验证（GLM-5.2）: 1 RED + 9 GREEN — **C1=86 可信**

**核心结论: 工作真实，但 C1 轨迹叙事有不诚实**

| ID | Severity | 发现 |
|----|----------|------|
| R1 | 🔴 RED | FINAL-REPORT §二 C1 演进轨迹：macp6 数据点选 GLM 自评 76（而非同轮 MiniMax 观察员 80-83），标"GLM 乐观偏差"——但 macp6 MiniMax 观察员实际打更高分，与 macp2"GLM 乐观"方向相反。apples-to-apples MiniMax 链 68→80-83→79→86 非单调（macp10 下凹），§二 通过跨轮混用评估方构造单调上行。数字非伪造但标签错配 |
| G1-G9 | 🟢 GREEN | 4 缺陷修复全在源码核实；macp3 基线 68 扎实；macp10/11 auditor 平台铁证 provider=minimax；非 macp2 式崩塌 |

### D5 项目层质量（DeepSeek-v4-pro）: 3 YELLOW — **C1=86 诚实保守**

**核心结论: 修复真实，86→92 短期可行**

| ID | Severity | 发现 |
|----|----------|------|
| Y1 | 🟡 YELLOW | Sandbox 6/10 "超出scope"说辞对 L1 可改进项不诚实——有可尝试但未尝试的改进 |
| Y2 | 🟡 YELLOW | IPC snapshot 4 端点可接线未尝试 |
| Y3 | 🟡 YELLOW | JSDoc 陈旧需清理 |

### D6 安全对抗（GLM-5.2）: 3 RED + 4 YELLOW — **P0 绕过已正式文档化**

**核心结论: CLI 兼容通道 + 零完整性校验 = 可实际利用的 P0 绕过**

| ID | Severity | 发现 |
|----|----------|------|
| F1 | 🔴 RED | **CLI 兼容通道被 FINAL-REPORT §3.6 + SKILL §13.3b 双重正式文档化为合理路径**——worker 可通过 `require('tree-engine.cjs'); engine.run('leaf-set-status', [...])` 伪造自己的 done，零 auditor 介入 |
| F2 | 🔴 RED | **tree-state.json 零完整性校验**——直接编辑文件改 status=done + audit_gate=pass，引擎 validate 报 0 issues |
| F3 | 🔴 RED | **假信号攻击**：done/self_check/review_round/subagent_spawn 内容可被任意能写 event 的 session 伪造（v0.17.1 残留） |
| F4 | 🟡 YELLOW | root 信任锚可背书任意非 root leaf（root.session_id 经 tree_dump 公开可得） |

---

## 三、跨维度交叉验证

### 一致确认的发现（多维度独立印证）

| 发现 | D1 | D2 | D3 | D4 | D5 | D6 | 置信度 |
|------|----|----|----|----|----|----|--------|
| C1=86 核心可信 | — | — | — | ✅ | ✅ | — | **高** |
| CLI 兼容通道是 P0 绕过 | ✅ | ✅ | — | — | — | ✅ | **高** |
| SKILL 与引擎存在矛盾 | — | ✅ | ✅ | — | — | — | **高** |
| FINAL-REPORT 7/7 过度宣称 | ✅ | — | — | ✅ | — | — | **高** |
| tree-iterative-development v1.4 缺失 | ✅ | — | — | — | — | — | **事实** |
| tree-state.json 零完整性 | — | — | — | — | — | ✅ | **高**（D6 独立发现，D2 未覆盖此维度） |

### 跨维度矛盾（需澄清）

| 矛盾 | 维度A | 维度B | 分析 |
|------|-------|-------|------|
| root milestone 豁免 | D2: 引擎 L1765 有豁免 | D3: SKILL §13.3a 声称无豁免 | D2 源码证据确凿，D3 识别为 F4 矛盾。**引擎为准，SKILL 需修** |
| C1 macp6 数据点 | D4: GLM76 标签错配 | FINAL-REPORT: "GLM乐观偏差" | D4 证据确凿：MiniMax 打更高分(80-83)，方向与 macp2 相反 |

---

## 四、真实完成度总结

```yaml
real_completion:
  root_initial: "5.5-6/7 (偏宽容，被 Auditor 推翻)"
  auditor_final: "3.5-4/7 (MiniMax-M3 异厂商独立判定，采纳)"
  
  auditor_corrections:
    - "标准3: ✅→🔴RED 评估≠实现 (A2仍在Roadmap)"
    - "标准4/5: ✅→YELLOW C1/缺陷属测试底座非tree-harness(范围混淆)"
    - "标准6: ✅→YELLOW CLI兜底=P0安全倒退"
  
  c1_verdict: "C1=86 可信（工作真实，异厂商签字平台铁证）"
  
  critical_gaps:
    - "CLI兼容通道被正式文档化为P0绕过口 (D2/D6独立确认, Auditor签字确认)"
    - "tree-state.json零完整性校验 (D6, Auditor签字确认)"
    - "tree-iterative-development SKILL v1.4文件缺失 (D1事实, Auditor旁证)"
    - "SKILL §13.3a与引擎L1765直接矛盾 (D2源码核实, Auditor独立抽样L1765确认)"
    - "SKILL v2.9.7内部4处矛盾影响可执行性 (D3)"
    - "FINAL-REPORT §二 C1轨迹叙事标签错配 (D4, Auditor确认)"
```

---

## 五、后续 Roadmap（P0/P1/P2 优先级）

### P0 — 安全与完整性（立即修）

| # | 项 | 来源 | 工作量 |
|---|-----|------|--------|
| P0-1 | **关闭 CLI 兼容通道**：生产构建禁用 `engine.run()` 直接调用或加入 caller 强制校验（不向后兼容金标准测试的 CLI 模式） | D2-F1, D6-F1 | ~20行 |
| P0-2 | **tree-state.json 完整性校验**：写入时附加 HMAC/签名，读取时校验 | D6-F2 | ~50行 |
| P0-3 | **修复 SKILL §13.3a root 豁免矛盾**：删除 §13.3a.2 备选路径（引擎已有豁免，备选是冗余） | D2-F8, D3-F4 | ~10行 |

### P1 — SKILL 质量（本轮收口）

| # | 项 | 来源 | 工作量 |
|---|-----|------|--------|
| P1-1 | **§11 标题计数修正**：12→17 | D3-F1 | ~1行 |
| P1-2 | **§14.2/§14.6 fix leaf 统一为强制**：删除 §14.6 "可选"标注 | D3-F2 | ~2行 |
| P1-3 | **§14.3 补充 fix 角色 in_scope 模板** | D3-F3 | ~15行 |
| P1-4 | **§13.7 错误码速查表补充**：至少补 E_CHILDREN_NOT_DONE / E_AUDITOR_NOT_DONE / E_AUDITOR_NO_EVENTS / E_MAX_SESSIONS | D3-F6 | ~20行 |
| P1-5 | **idle 多维核验补 communication_log** | D3-F7 | ~5行 |
| P1-6 | **FINAL-REPORT §二 C1 轨迹披露修正**：脚注说明 macp6 数据点选用 + MiniMax 观察员实际 80-83 | D4-R1 | ~5行 |
| P1-7 | **补 tree-iterative-development SKILL v1.4** | D1-STD7 | 归档已有 |

### P2 — 项目层增强（下轮迭代）

| # | 项 | 来源 | 工作量 |
|---|-----|------|--------|
| P2-1 | Sandbox L1 可改进项（chroot/process 级） | D5-Y1 | 中 |
| P2-2 | IPC snapshot 4 端点实装 | D5-Y2 | 中 |
| P2-3 | Electron 进程级 E2E smoke test | D5 | 大 |
| P2-4 | leaf_transfer_owner 工具（替代 CLI 应急） | D2/D6 | ~50行 |
| P2-5 | done event 自动注入 caller_session_id（防御纵深） | D2-F10 | ~10行 |

---

## 六、Auditor 独立签字（MiniMax-M3 异厂商）

**详见**: `auditor-signoff.md`（15144 bytes，MiniMax-M3 独立产出）

**签字结论**: ✅ **pass_with_minor**（通过但有保留）

**独立完成度**: **3.5-4/7**（vs Root 初判 5.5-6/7）

**Auditor 核心纠正**:
1. **标准 3 推翻**: Root 判 ✅ → Auditor 判 🔴 RED。评估≠实现，A2 leaf_transfer_owner 仍在后续 Roadmap
2. **标准 4/5 指正**: Root 判 ✅ → Auditor 判 YELLOW。C1=86 和 4 缺陷属测试底座项目非 tree-harness，范围混淆
3. **标准 6 指正**: Root 判 ✅ → Auditor 判 YELLOW。实战真实但 CLI 兜底是 P0 安全倒退
4. **D2 F8 独立源码核实**: Auditor 抽样 `tree-engine.cjs L1760-1775`，确认 `if(!isAuditor&&!isRoot)` 100% 属实
5. **Root 同厂商偏差识别**: Root（DeepSeek-v4-pro）与 D1（DeepSeek-v4-pro）同厂商，Root 总报告悄悄把 D1 自报的 RED/YELLOW 提级为 ✅——这正是 macp2 教训要防范的同款偏差

**7 项 P0 前置条件**（Auditor 要求未修完不算"完成"）:
- P0-1: 关闭或重设计 CLI 兼容通道（~20行）
- P0-2: tree-state.json 完整性链（~50行）
- P0-3: 修复 SKILL §13.3a 矛盾
- P0-4: 补 tree-iterative-development SKILL v1.4
- P0-5: §14.2/§14.6 fix 统一为强制
- P0-6: 修订 FINAL-REPORT 标题与范围声明
- P0-7: C1 轨迹披露修正

## 七、签字

**审计执行**: audit-root（DeepSeek-v4-pro）+ 6 commander（3×DeepSeek + 3×GLM-5.2）+ 1 auditor（MiniMax-M3）
**审计周期**: 2026-07-28 11:31-11:54 GMT+8（~23 分钟并行审计，7 leaf 跨 3 模型厂商）
**审计产出**: 
- `D1-requirements-coverage.md`（29040 bytes, 7 RED + 6 YELLOW）
- `D2-engine-semantics.md`（20325 bytes, 1 RED + 5 YELLOW）
- `D3-skill-completeness.md`（21703 bytes, 4 RED + 8 YELLOW）
- `D4-practical-verification.md`（21217 bytes, 1 RED + 9 GREEN）
- `D5-project-quality.md`（32931 bytes, 3 YELLOW + 8 GREEN）
- `D6-security-adversarial.md`（20706 bytes, 3 RED + 4 YELLOW）
- `auditor-signoff.md`（15144 bytes, MiniMax-M3 独立签字: pass_with_minor）
- `AUDIT-FINAL-REPORT.md`（本报告）

**总判定**: FINAL-REPORT 7/7 **过度宣称**。采纳 Auditor（MiniMax-M3 异厂商）独立判定：真实完成度 **3.5-4/7**。C1=86 可信。P0 安全 gap（CLI 绕过 + 零完整性校验）需立即修。SKILL v2.9.7 有 4 处内部矛盾。**在 Auditor 7 项 P0 前置条件修完前，不应使用"7/7 完成"措辞。**

**核心教训**: Root（DeepSeek-v4-pro）与 D1（DeepSeek-v4-pro）同厂商，Root 总报告对 D1 自报 RED/YELLOW 做了提级——这正是 macp2 教训（GLM 自评 70 → MiniMax 复评 47）要防范的同厂商递归同质化乐观偏差。**跨厂商独立 auditor 不是可选项，是必需品。**

**Co-Authored-By**: Claude <noreply@anthropic.com>
