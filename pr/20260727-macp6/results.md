# macp6 实战检验 — 实施结果（项目层推进 + §13.3b 实战检验）

> 日期：2026-07-27 | 基于 macp5 §13.3b 落地后的实战检验 + 推进 multi-agent-collab-platform 项目层
> 指挥官：macp6-root（297d75b7）→ v2 接力（4d1c5b94）
> 观察员：MiniMax-M3（a67044a9）异厂商完整评价
> 双目标：① 修项目层 4 实质缺陷（macp3 发现）② §13.3b 多层级 done 实战检验

## 0. TL;DR

**macp6 是迄今最成功的实战**（观察员评语）。双目标达成：
1. ✅ **缺陷1 Judge LLM 接线 + 缺陷2 Coder CWE-22 真修根因**（生产阻塞级，typecheck/build 双绿 + 探针 + 异厂商双审 pass）
2. ✅ **§13.3b 多层级 done 实战零 V10 撞击**（C+J2 双 commander，省 audit_gate，auditor 兄弟结构）

**C1 推断**：macp3 68 → **80-83/100**（观察员异厂商推断，保守 80 中位 83，权威待 macp7）

**新发现 7 项**（观察员异厂商视角，v2 自评未覆盖）+ **macp7 改进路线**（P0 接力协议 + idle 多维核验）

## 1. 双目标达成

### 1.1 项目层缺陷修复（2/4，留 3/4 给 macp7）
- **缺陷1 Judge LLM 接线**（PromaCloudLlmClient.evaluateSoft L399-445 + engine-factory.ts duck-type L83-103，消除交叉类型断言 + 拒绝 silent fallback）✅
- **缺陷2 Coder CWE-22 路径穿越**（coder-engine-stub.ts L557-578 outputDir 严格相等 path.resolve 校验）✅
- 缺陷3 runGwt 假修复 / 缺陷4 evaluateCode 假通过 —— 未修（out_of_scope，留 macp7）

### 1.2 §13.3b 实战检验
- C + J2 双 commander done（root 代调 milestone_set_result，省 audit_gate，零 V10 撞击）
- auditor parent=macp6-root（兄弟结构，避 macp4 错误）
- macp5 发现（commander done 不需 audit_gate，角色初始 skip）二次实证

## 2. 树结构（2 层 5 leaf 扁平化）

| leaf | role | status | 关键 |
|------|------|--------|------|
| macp6-root | root | done | v2 接力（segment_chain=[4d1c5b94]），M-root-done pass |
| macp6-J-commander | commander | pruned | idle 误判（"No usage data"假信号），修复成果由 J2 继承 |
| macp6-J2-commander | commander | done | 缺陷1 修复（验证式接力 J，M1 pass=true）|
| macp6-C-commander | commander | done | 缺陷2 修复（M1 pass=true）|
| macp6-X-auditor | auditor (MiniMax-M3) | done | 异厂商双审 C+J2 全 pass（5/5 + 1 yellow 各）|

## 3. 新发现 7 项（观察员异厂商评价）

| # | 新发现 | 严重度 | 处理（macp7） |
|---|--------|--------|------|
| 1 | **segment_add 接力不改 added_by**，v2 撞 E_BORROWED_IDENTITY（drift 19:11:04 实证：caller 4d1c5b94 is not creator added_by=null）| 🔴 高 | SKILL §13.3b 接力协议补章（身份继承矩阵，P0）|
| 2 | **idle 探测"No usage data"误判 J**（实际产出完成被 prune，浪费 ~10min）| 🟡 中 | SKILL idle 多维核验（mtime + tool calls + queue，P0）|
| 3 | **v2+旧 root emergent 协作**（旧 root 权限锚 + v2 上下文接力，非教化自发涌现）| 🟢 有效 | SKILL §13.3c 教化（权限分工矩阵，P1）|
| 4 | audit_log schema severity 必须 red/yellow/green（v0.21，C/auditor 撞 E_SCHEMA_INVALID 自纠正）| 🟡 中 | auditor brief 加 schema 提示（P1）|
| 5 | auditor done 需 ≥2 events（brief_echo + done）| 🟡 中 | SKILL auditor 角色强制（P1）|
| 6 | F-C-001 path.resolve 规范化宣传偏差（非漏洞，安全等价）| 🟢 low | C-fix-report §1 澄清 |
| 7 | F-J2-001 evaluateSoft 未真实 LLM 跑通（凭据依赖）| 🟢 low | macp7 mock/凭据端到端 |

## 4. 关键过程（v2 接力 + 旧 root 协作）

- 22:15-23:39 旧 root（297d75b7）Stream closed 期间 send 给 auditor 未送达 → auditor 认知停留"J2 未完成"
- 隔夜 12h 父会话误判"context 溢出"（GLM-5.2 usage_pct 虚高 661%，**用户纠正：GLM-5.2 context 计算不准**，ping 核实 root alive）→ 真实卡点是 Stream closed + auditor 认知不同步
- 18:53 派 v2（4d1c5b94）接力（segment_add）
- v2 撞 E_BORROWED_IDENTITY（segment_add 不改 added_by）→ **旧 root 配合代发激活 auditor + 代调 audit_gate + 告知 root done 关键约束**（emergent 协作，非教化）
- 19:04 auditor 审 J2 pass → 19:06 auditor done → 19:19 root done

## 5. C1 推断（观察员异厂商）

macp3 68 → **80-83/100**（保守 80，中位 83，乐观 85）。
- 加分：双缺陷修 +12 + 异厂商双审 +2~3 + §13.3b 教化 +1~2
- 减分：evaluateSoft 未端到端 -2~3 + idle 误判 -1

## 6. 后续（macp7 候选）

- **P0**：SKILL §13.3b 接力协议补章（身份继承矩阵 + CLI 应急通道）+ idle 探测多维核验
- **P1**：audit_log schema severity + auditor ≥2 events + emergent v2+旧 root 协作教化（§13.3c）
- **P2**：evaluateSoft 端到端 + 跨夜长任务心跳 + 缺陷3/4 修复
- 建议升级 tree-commander v2.9.4 → v2.9.5（接力协议 + idle 多维 + audit_log schema）

## 7. 交付物

- `D:/Codes/multi-agent-collab-platform/06_TESTS/macp6-tree-evaluation-2026-07-27.md`（v2 自评，10852 字节）
- `C:/Users/sir_c/.proma-pro/agent-workspaces/default/.context/trees/macp6/deliverables/`（C/J/J2 fix reports + X-audit-C/J2 + HANDOFF + 5 探针脚本）
- 观察员完整评价（a67044a9，7960 字节，MiniMax 异厂商）
- src 改动：`proma-cloud-llm-client.ts` +98 / `electron/engine-factory.ts` +52/-12 / `src/coder/coder-engine-stub.ts` +19

## 8. 自审 + 观察员评价

- v2 自评诚实（标注 C1 增量估算非异厂商签字，权威待 macp7）+ tree_validate 5 issues（v2 接力副作用）
- 观察员异厂商核验认同主体（双目标达成 + §13.3b 通过 + 真修根因），补充 7 新发现（segment_add gap / idle 误判 / emergent 协作等，v2 自评未覆盖）
- 多源审计胜利：MiniMax-M3 真跑探针 + 双审报告 + 诚实 yellow 标注（破 macp2 全 GLM 同质化）
