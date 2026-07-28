# Tree Harness 对抗性审计后修复 — 设计文档

> 日期：2026-07-28
> 触发：auditor MiniMax-M3 异厂商签字 pass_with_minor，要求 7 项 P0 前置修完才升 pass
> 依据：`audit-20260728/AUDIT-FINAL-REPORT.md` + `auditor-signoff.md`（7 P0 前置）+ D6 安全报告
> 目标：真实达成 7/7（非自评），异厂商复审升 pass

---

## 0. 根因

macp3-11 五轮迭代真实工作扎实（C1=86 平台铁证），但 FINAL-REPORT 自评 7/7 是**过度宣称**（auditor 独立判定 3.5-4/7）。macp2 教训再现：Root 总报告（DeepSeek）把 D1 自报 RED/YELLOW 悄悄提级为 ✅。真实缺口：

1. **CLI 兼容通道被双重文档化为合理路径**（D6-F1）— `engine.run()` 省略 callerSessionId 即跳过全部 V10 caller 校验，worker 可伪造 done 闭环
2. **tree-state.json 零完整性校验**（D6-F2）— 直接编辑 status/audit_gate.verdict 字段，引擎 validate 报 0 issues
3. **SKILL §13.3a 与引擎 L1765 直接矛盾**（D2-F8）— SKILL 声称 root 无 milestone 豁免，引擎 `if(!isAuditor&&!isRoot)` 明确豁免
4. **SKILL v2.9.7 内部 4 矛盾**（D3）— §11 计数滞后 / §14 fix 强制 vs 可选 / §14.3 缺 fix 模板 / §13.7 错误码仅 9/51
5. **tree-iterative-development SKILL 未进 tree-harness/skills/ git 副本**（D1-STD7）
6. **FINAL-REPORT 范围混淆**（D1-OD-3/4）— 把测试底座项目分数（multi-agent-collab-platform C1=86）当 tree-harness 自身完成度
7. **C1 轨迹叙事标签错配**（D4-R1）— macp6 选 GLM 自评 76 标"GLM 乐观偏差"，但同轮 MiniMax 观察员实际打 80-83，方向与 macp2 相反

---

## 1. 改动点

### P0-1 CLI 兼容通道关闭（引擎，~20 行）

**位置**：`D:/Codes/tree-harness/tree-engine.cjs`
- L1032 `cmdLeafAdd`：`if (callerSessionId && added_by && callerSessionId !== added_by)` → caller 缺省时拒绝
- L1732 `cmdLeafSetStatus`：`if (callerSessionId)` 短路块 → 改为强制 caller 校验
- L2158 `cmdLeafSetSession`：同上
- L2251 `cmdMilestoneAdd`：同上
- L2416 `cmdMilestoneUpdate`：同上
- 闸门 A 三处（cmdMilestoneSetResult ~L2341 / cmdAuditGate ~L3560 / cmdAuditAppend ~L3701）：`audit_session_id !== callerSessionId` 复合条件，caller 缺省短路 → 强制

**策略**：
- 生产构建（无 `TREE_ENGINE_ALLOW_CLI=1` 环境变量）下，写操作 callerSessionId 缺省抛 `E_CALLER_REQUIRED`
- 保留金标准测试通道：测试调用 `engine.run(cmd, args, treesRoot, 'test-caller-mock')` 显式传 mock caller，或设 `TREE_ENGINE_ALLOW_CLI=1`（仅测试）
- 不向后兼容"省略 caller"的 CLI 写模式 — 这是 auditor 明确要求的方向反转

**范围声明（响应对抗审计 LOW-1，消除"受信任边界假设"口实）**：

P0-1 关闭的是 D6-F1 **done 闭环伪造**攻击面（caller 缺省 → 伪造 done/audit_gate/milestone/event，零 auditor 介入）。GLM 异厂商审计 PoC 实测确认该攻击链 7 步全拦。以下 7 个写操作**刻意不在 P0-1 caller-binding 范围内**，理由如下：

| 写操作 | 豁免理由 |
|--------|---------|
| `drift_append` / `heartbeat_append` / `nudge_append` | 观测性记录，本就允许任意 session 单向声明（非身份敏感，不涉及 done 闭环）|
| `segment_append` | 上下文接力元数据（macp6 实证 added_by 接力走 SKILL 教化协议层，非 caller-binding 范畴）|
| `communication_log` | 观测性记录（§6 强制记 comm_log 的核心目的就是防误判 idle，本就要任意 session 可写）|
| `leaf set-context` / `leaf set-last-event` | 引擎内部记账（context 使用率 / 最后事件时间），非身份敏感 |

这些操作不涉及 done 闭环 / 所有权转移 / 借身份背书，D6-F1 攻击链无法利用。

**已知范围外项（透明披露，后续 P2 评估）**：
- **LOW-2**：`milestone set-result --audit-pass false` 绕过 caller 校验（caller 校验包在 `if(audit_pass===true)` 块内）。CLI 可声明 milestone 失败（数据完整性），但 **failed milestone 无法满足 done 前置**，不构成 done 闭环攻击。修复成本极低（把 caller 校验提到 audit_pass 块外），若 MiniMax 复审要求则修。
- **INFO-3**：`cmdCommunicationLog` 的 `opts.caller` 参数注入残留（`callerSessionId || opts.caller`）。communication_log 是观测性记录（P1-2），攻击面低，评估是否收紧 fallback。

**错误码**：新增 `E_CALLER_REQUIRED`（加入 ERROR-CODES.md + SKILL §13.7）

**同步**：删 SKILL §13.3b "CLI 应急通道"段（L~942-950，给 require 代码的那段）；删 FINAL-REPORT §3.6 + §五 Roadmap "CLI 兼容通道标准化"项

### P0-2 tree-state.json HMAC 完整性（引擎，~50 行）

**位置**：`readState` L592-607 / `writeState` L615+

**策略**：
- engine 启动时生成或读取 secret（落盘 `<engine-dir>/.tree-engine-secret`，权限 0600；首次运行生成随机 32 字节）
- `writeState` 序列化后，对关键字段计算 HMAC-SHA256：
  - 计算 scope：每 leaf 的 `{id, role, status, added_by, session_id, audit_gate.verdict, milestones[].audit_pass, audit_log}` 规范化 JSON
  - 签名写入 `state._meta.integrity = { algo: 'hmac-sha256', mac: '<hex>', fields: [...], ts }`
- `readState` 解析后重算 HMAC，与 `_meta.integrity.mac` 比对；不符抛 `E_STATE_INTEGRITY`（含哪个 leaf 哪个字段被篡改），并自动 `drift_append(kind=security, severity=red, reason='tree-state integrity violation')`

**兼容老数据**：`_meta.integrity` 缺失时（老 state 文件）只 warn 不拒（首次 writeState 自动补签）；但 status=done/audit_gate.verdict=pass 的 leaf 若无签名则拒绝（关键状态必须有签名）

**错误码**：新增 `E_STATE_INTEGRITY`

### P0-3 SKILL §13.3a root 豁免矛盾（~10 行）

**位置**：`skills/tree-commander/SKILL.md` §13.3a L849+
- 删除 §13.3a.2 备选路径（引擎 L1765 已豁免 root milestone，备选冗余）
- §13.3a 序言改："引擎 L1765 `if(!isAuditor&&!isRoot)` 已豁免 root milestone 非空门禁，root done 走 §13.3a.1 正常路径即可，无需备选"
- 引用引擎源码行号锚点

### P0-4 tree-iterative-development cp（归档）

`cp -r C:/Users/sir_c/.proma/agent-workspaces/proma/skills/tree-iterative-development/ D:/Codes/tree-harness/skills/`

### P0-5 + P1-1~5 SKILL 质量批量修订

| ID | 位置 | 改动 |
|----|------|------|
| P1-1 | §11 L697 | 标题"12 条"→"17 条"（核实实际计数）|
| P0-5/P1-2 | §14.6 L1234 | 删 fix leaf "可选"标注，与 §14.2 强制统一 |
| P1-3 | §14.3 L1127 | 补 fix 角色 in_scope 模板（现 6 模板缺 fix）|
| P1-4 | §13.7 L1077 | 补 E_CHILDREN_NOT_DONE / E_AUDITOR_NOT_DONE / E_AUDITOR_NO_EVENTS / E_MAX_SESSIONS / E_CALLER_REQUIRED / E_STATE_INTEGRITY |
| P1-5 | §13.6 L1053 | idle 多维核验补 communication_log 检查（§6 强制记 comm_log 的核心目的就是防误判 idle）|

### P0-6 FINAL-REPORT 范围声明修订

- §一 标题改"阶段性改进报告（macp7-11）"
- §七 区分两个仓：tree-harness（`release-0.13.16-hardening`，本报告主体）vs multi-agent-collab-platform（测试底座，C1=86 评分对象）
- 补 tree-harness 自身完成度诚实声明（修完 7 P0 后真实 7/7）

### P0-7 C1 轨迹披露修正

§二 macp6 数据点脚注："macp6 同轮 MiniMax 观察员实际打 80-83，高于 GLM 自评 76，方向与 macp2 'GLM 乐观'相反。本轨迹选用 GLM 76 是为保守叙事，非 MiniMax 链非单调（macp10 下凹 79）"

---

## 2. 测试计划

### 单测（新增）
- `tests/caller-required.test.cjs`：6 处写操作 caller 缺省 → 全抛 E_CALLER_REQUIRED；`TREE_ENGINE_ALLOW_CLI=1` 下放行
- `tests/state-integrity.test.cjs`：直接编辑 tree-state.json 改 status=done → readState 抛 E_STATE_INTEGRITY + drift 记录；老数据无签名 warn 不拒；关键状态无签名拒绝

### 回归
- macp2-11 全部金标准测试（DBC-spec 等）在 `TREE_ENGINE_ALLOW_CLI=1` 下全过
- 部署 dev/pro + restart ISOLATED=1，macp11 实战场景复跑（root idle + 多层级 done）确认无 V10 撞击

### 异厂商复审
- MiniMax-M3 auditor 复审 7 P0 前置全修完 → 升 pass_with_minor → pass

---

## 3. 多渠道分工（避免锯齿智能）

| 步 | 实施 | 审计 | 签字 |
|---|------|------|------|
| SKILL 修订 | collaboration GLM-5.2 | session DeepSeek-v4-pro | — |
| P0-1 引擎 | session DeepSeek-v4-pro | collaboration GLM-5.2 | — |
| P0-2 引擎 | collaboration GLM-5.2 | session DeepSeek-v4-pro | — |
| 复审签字 | — | — | session MiniMax-M3 |

实施↔审计异厂商交叉（GLM↔DeepSeek），签字 MiniMax 第三方。确定性代码改动同厂商无碍，审计/签字必须异厂商破同款偏差（macp2 教训）。

---

## 4. 渠道 ID（release 实例）

- GLM-5.2：`cbb12a0b-3d21-476d-9812-d37bb5642cda`（ZLM-CodingPlan，collaboration 同渠道）
- DeepSeek-v4-pro：`56ecefd2-8e22-4c62-add5-16e8992c987d`（DeepSeek官方，session 跨渠道）
- MiniMax-M3：`b7e25505-c972-49e7-9173-ef14df3eaa3f`（MiniMax-CodingPlan，session 跨渠道）

**注**：memory `release-subsession-channel.md` 记 ZLM 渠道 session create 曾报 Channel not found；GLM 的活优先用 collaboration，DeepSeek/MiniMax 用 session create。
