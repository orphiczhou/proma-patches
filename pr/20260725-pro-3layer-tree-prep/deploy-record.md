# Pro 3 层树形任务准备 — 部署 + Skill 补齐记录

> 日期：2026-07-25 | 为 Pro 上 multi-agent-collab-platform 3 层树形任务准备

## 1. Pro 重启
`restart-pro.ps1` → 加载最新 dist（main.cjs 补丁 Q + patches.cjs full_text + tree-engine.cjs W_STAR_DEGRADATION/progress/communication_log）。

## 2. 检查员报告（子会话 281be2b1）
- **引擎 100% 就绪**：dist 全部最新特征（补丁 Q=2 / full_text=2 / 子会话机制=1 / tree-engine 特征=10）
- **Pro tree-commander SKILL 掉队**（🔴 阻断）：停在 Gap B（2026-07-17），缺 macp 实战后全部改进：
  - P0-1 W_STAR_DEGRADATION 层级委派协议（§4 Step 2.1）→ root 不知道避免越级 → 星形退化
  - P1-1 progress event + brief_echo→active 联动
  - P1-2 communication_log 协议
- Pro tree-worker v2.5 ✅ / tree-auditor v1.0 ✅
- 详见 `check-report.md`

## 3. Skill 补齐动作
1. **backup Pro SKILL**（保 Gap B 知识）→ `pro-tree-commander-backup-v2.7-gapB.md`
2. **修 release §0 version** 2.6 → 2.9.1（标记合并）
3. **合并 Gap B**（§13.4.6 fix leaf 反馈闭环，自 Pro v0.22）到 release §13.4 后（保留 Pro 独有的 auditor→fix leaf 修复闭环协议）
4. **§15 加 v2.9.1 条目**（合并 Gap B 记录）
5. **cp release/tree-commander/SKILL.md → pro**

## 4. Pro tree-commander v2.9.1 验证
| 检查 | 结果 |
|------|------|
| version | 2.9.1 ✅ |
| P0-1（W_STAR/Step 2.1/层级委派） | 5 ✅ |
| Gap B（fix leaf/fixes_resolved） | 11 ✅ |
| P1（progress/brief_echo active/tree_log_communication） | 8 ✅ |
| release vs pro diff | identical ✅ |

## 5. Pro 就绪状态（全绿）
- dist 最新（main.cjs + patches.cjs + tree-engine.cjs）✅
- tree-commander v2.9.1（P0-1 + Gap B + P1-1 + P1-2 全有）✅
- tree-worker v2.5 ✅
- tree-auditor v1.0 ✅
- multi-agent-collab-platform：设计成熟 + 实现骨架期（32/100）+ 12 P0 阻断（待推进）

## 6. 根指挥官派遣
- **session**: `03cce210-11dd-471e-8761-9ce147080fbe`（pro 实例，GLM-5.2，ZLM 渠道）
- **任务**：3+ 层树（prefix=macp2），**多层指挥官主动性**（严格走 P0-1 W_STAR_DEGRADATION 协议：root→commander→sub-commander→worker，root 不越级 worker），推进 macp 项目 P0 阻断
- **wait=false** 派遣（fire-and-forget）
- **观察方式**：父会话 `remote_list_messages(pro, 03cce210)` 定期看进度

## 7. 风险 / 后续
- Gap B 已合并到 release（§13.4.6），Pro 独有内容保留
- tree-worker release v2.2 落后 Pro v2.5（G6 未反向同步，非 3 层核心，后续可 cp Pro → release）
- 根指挥官 3 层树任务长（可能 30+ 分钟），父会话定期观察 + 反馈
