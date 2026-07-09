# 交接文件：audtest Pro 端到端测试复盘 + 持续改进（2026-07-09）

> **交接给**：本工作区（Proma改造探索）新会话，模型 GLM-5.2，用子 Agent 群持续改进
> **发起**：2026-07-09 10:10，会话 bcc88fc5
> **任务性质**：基于 audtest Pro 端到端测试报告，修复发现的引擎 bug + 复测
> **项目位置**：`D:/codes/tree-harness/`（git 仓，分支 `release-0.13.16-hardening`，上次 commit 3852c61/facea23）

---

## 一、背景：P0a/P0b/P1b 已落地 + Pro 测试回来

上一轮（2026-07-08）已完成 P0a（auditor role）+ P0b（TaoWatcher 收窄）+ P1b（fix_evidence），本地全量 90/90 绿，commit 3852c61，部署 Pro。用户重启 Pro 后派指挥官（e954cf56）+ 观察者（b1f6efb8）端到端测试，测试材料在 `D:/codes/tree-harness/audtest-test-materials-2026-07-09/`（7 份报告）。

**测试结论**：❌ 端到端核心目标失败（P0a auditor 完整 done 路径未跑通），但 ✅ 单元验证 4/5 通过 + ✅✅ P0b 噪音降低完全通过 + 发现 3 个真实引擎 bug（含 1 个 macp2 加固漏洞 BUG-2）。

---

## 二、Pro 测试结果总结

### 2.1 已确认生效的修复（5 项 ✅）

| 修复 | 证据 | 来源 |
|------|------|------|
| **P0b TaoWatcher 噪音降低** | C-13/R-03/R-06/C-15 假阳性 24-38 条 → **0 条**；audit_log 不再被 tao-watcher 污染（所有 leaf audit_log=[]） | 05 §1.2 |
| **P0a auditor role 创建** | role=auditor + audit_gate.verdict=**required**（不能自审）+ 简化协议（brief_echo 无 milestone） | 05 §1.1 |
| **P0a 审计 P1 修复**（auditor 叶子节点约束） | leaf_add added_by=auditor session → E_BORROWED_IDENTITY `[D2-B1]` "auditors cannot add child leaves" | 02 §2 |
| **P1b fix_evidence** | done event 缺 red_findings_resolved → E_SELFCHECK_INVALID（借 b8711bb7 worker 跑通） | 02 §1 E3-E4 |
| **caller-binding（done event 路径）** | root 代 auditor 写 done → E_BORROWED_IDENTITY；audit_gate pass 无 done → E_AUDIT_PREMATURE | 01 §3 |

### 2.2 端到端失败根因（非 engine 设计问题）

**根因 A：Proma fork identity timeout**（BUG-A，阻断，归属 **Proma app** 非 tree-engine）：
- 6 个 fork session 中 4 个永久 busy（fork_identity_status='timeout'），可用率 33%
- auditor session（8cc4fc3f）卡死 → 无法自调 done event → P0a 简化协议链路断裂
- **这是 Proma app 的 fork 机制 bug，不是 tree-engine 能修的**。tree-engine 的 caller-binding 反而正确生效（拦住 root 代调）。

**根因 B：测试设计依赖 fork session 可靠性**：指挥官直接 fork→leaf_add→假设可用，没探测。正确做法：fork 完先 send_message 探测再绑 leaf。

### 2.3 核心矛盾（设计层面，需新会话研判）

caller-binding 要求"auditor 必须自己调 done event"，但 Proma fork 不保证 session 可用 → 两条约束叠加导致 auditor role 在当前环境不可用。**需研判**：是否给 auditor role 加协议级 fallback（如 root 归档卡死 session + 重新 fork + leaf set-session 替换，需放开 set-session caller 校验）。

---

## 三、发现的引擎 bug 清单（按优先级）

### P0（阻断/安全漏洞，必须修）

#### BUG-2：leaf_add 路径 caller-binding 失效（macp2 加固漏洞）✅ 已确认真实

**现象**：fork 副本（caller=67b8a9a2）手填 `added_by='e954cf56'`（root session）调 leaf_add，引擎接受、未拦。任何 fork 副本可冒 root 身份创建 leaf。

**根因（已验证）**：
- `dispatchLeaf`（tree-engine.cjs 行 4519）接收 `callerSessionId`，但 `case 'add': return await cmdLeafAdd(rest);`（行 4528）**不透传**
- `cmdLeafAdd(args)`（行 816）**无 callerSessionId 参数** —— 唯一不校验 caller 的写路径
- 对比：cmdLeafSetSession（行 1697）/cmdAuditGate（行 2895）/cmdMilestoneSetResult（行 1863）/cmdEventAppend（行 1940）都透传 + 校验 caller

**修复（精确）**：
1. dispatchLeaf 行 4528：`case 'add': return await cmdLeafAdd(rest, callerSessionId);`
2. cmdLeafAdd 行 816：`async function cmdLeafAdd(args, callerSessionId)`
3. cmdLeafAdd 内 added_by 校验后（约行 933 `}` 后）加：
```js
// BUG-2 修复 (2026-07-09 audtest 实证): leaf_add 路径 caller-binding — caller 必须 === added_by。
//   失守: fork 副本手填 added_by=root.session_id 创建 leaf，引擎未拦（macp2 caller-binding 加固漏洞）。
//   CLI 不传 caller（callerSessionId=undefined）跳过，向后兼容全部金标准测试。
if (callerSessionId && role !== 'root') {
  if (callerSessionId !== added_by) {
    throw new TreeStateError(E_BORROWED_IDENTITY,
      `leaf_add rejected: caller "${callerSessionId}" !== added_by "${added_by}" (borrowed identity forbidden; caller must be the operator that creates this leaf). [BUG-2]`);
  }
}
```
**注意**：tree_init 也可能有同样问题（fork 副本手填 session_id=root 建树），但 tree_init 一次性 + root 自创建，优先级低，可后续研判。

#### SDK 时序 bug（fork 后 get_my_session_id 错误返回源 session_id）
- fork 副本第一次调 get_my_session_id 返回源 session_id（错），第二次才返回真实 session_id
- 导致 fork 副本误用源 session_id 做所有操作
- 归属：**Proma SDK**，非 tree-engine。记待办，跨仓需求。

### P1（高优先级）

#### BUG-B：leaf_add 报错时未事务回滚，幽灵 leaf 污染 active_count
- leaf_add(added_by=auditor) 报 E_BORROWED_IDENTITY，但 audtest-A3-worker 仍被创建（status=pending_brief）
- 还连带创建 audtest-A4-worker（来源不明，疑似 fork 副本越权）
- 后果：active_count 被幽灵 leaf 污染，预算护栏测试受干扰
- **修复**：cmdLeafAdd 报错路径做完整事务回滚（withLock 内 throw 前确保不 writeState，或 writeState 前全校验通过）
- 归属：tree-engine

#### W-01 通道不互通
- P0a 简化协议 brief_echo 走 mcp__tree__event_append（引擎层 events[]），W-01 规则扫文本 YAML（消息层）
- 两条通道不互通 → worker/auditor 用 event_append 写 brief_echo 后，W-01 仍可能因"消息层无 brief_echo YAML"误报
- **修复**：W-01 规则（patches.cjs tao-watcher）应同时识别 mcp event_append(brief_echo)，不只扫文本
- 归属：patches.cjs tao-watcher-script

#### _meta 字段缺失
- tree-state._meta: tao_version=null, tao_watcher_session_id=null，但 TaoWatcher 实际运行（写了 W-01 nudge）
- **修复**：tree_init 时初始化 _meta；TaoWatcher 写 nudge 时回填 tao_watcher_session_id
- 归属：tree-engine（tree_init）+ patches.cjs（TaoWatcher 回填）

### P2（一致性/文档）

| # | Bug | 修复方向 | 归属 |
|---|-----|---------|------|
| LIMIT-D | list_active 不含 pending_brief，但预算 active_count 含 → 口径不一致 | list_active 含 pending_brief，或预算只算 status=active | tree-engine |
| LIMIT-E | SKILL alignment_workflow topic + §13.7/§4.6 对 P1b red_findings_resolved schema 描述不完整（缺对象结构） | 补全 red_findings_resolved 对象数组 schema | SKILL |
| A2-worker 状态不一致 | done event 写入但 status='pending_brief'，tree_validate 未检测 | tree_validate 应检查 done event 与 status 字段一致 | tree-engine collectValidateIssues |
| LIMIT-F | SDK 无"探测 fork session 是否可用"接口 | SDK 提供 wait_for_session_ready(session_id, timeout) | SDK 跨仓 |

---

## 四、关键路径索引

| 内容 | 路径 |
|---|---|
| 测试材料（7 份报告） | `D:/codes/tree-harness/audtest-test-materials-2026-07-09/`（00-README 是索引） |
| audtest tree-state | `C:/Users/sir_c/.proma-dev/agent-workspaces/default/.context/trees/audtest/` |
| engine | `D:/codes/tree-harness/tree-engine.cjs`（git 源 = workspace-files = Pro dist，md5 一致） |
| SKILL | `D:/codes/tree-harness/skills/tree-{commander,worker}/SKILL.md` |
| 上次交付报告 | `D:/codes/tree-harness/.context/active/harness-improvement-delivery-2026-07-08.md` |
| P0a 设计 spec | `D:/codes/tree-harness/.context/active/p0a-auditor-role-design-2026-07-08.md` |
| 测试基线（不可破） | `subagent-lifecycle-test.cjs`(30) + `p0-3-status-transition-test.cjs`(19) + `iss003-review-gate-test.cjs`(13) + `auditor-role-test.cjs`(20) + `p1b-fix-evidence-test.cjs`(8) = 90/90 |
| Pro engine/SKILL/patches | `D:/Proma-dev/resources/app/dist/` + `~/.proma-dev/agent-workspaces/default/skills/`（备份 .bak-pre-auditor-role-20260708） |
| CLAUDE.md（P0 教训） | `D:/codes/tree-harness/CLAUDE.md` |

---

## 五、下一步行动建议（按优先级 + 依赖）

### 第一步：修 BUG-2（最高优先，macp2 加固漏洞，独立可修）
1. 改 engine（dispatchLeaf 透传 + cmdLeafAdd 加 caller === added_by 校验，见 §三 P0 精确修复）
2. 加测试用例到 auditor-role-test.cjs：fork 副本（caller=A）手填 added_by=B 调 leaf_add → 期望 E_BORROWED_IDENTITY
3. 跑全量 90/90 + node -c
4. 注意：MCP wrapper 是否透传 caller 给 leaf add？需确认 `proma-mcp-server.cjs` 的 tree_leaf_add 调用是否注入 callerSessionId（若没注入，caller 永远 undefined，校验失效）。**这是修复关键前置**——先 grep proma-mcp-server.cjs 确认 leaf add 路径的 caller 注入。

### 第二步：修 BUG-B（leaf_add 事务原子性）
- cmdLeafAdd 报错路径回滚（withLock 内 throw 前不 writeState）
- 加测试：leaf_add 撞 E_BORROWED_IDENTITY 后，leaf 不应存在

### 第三步：修 P2 一致性（LIMIT-D + tree_validate 状态一致性 + LIMIT-E 文档）
- list_active 与 active_count 口径对齐
- collectValidateIssues 加 done event vs status 一致性检查
- SKILL alignment_workflow + §13.7/§4.6 补 red_findings_resolved schema

### 第四步：研判 auditor role 协议级 fallback（设计决策，需 AskUserQuestion）
- 核心矛盾：caller-binding 要求 auditor 自调 done，但 fork session 不可靠
- 选项 A：SKILL §13.4.1 加 fallback（root 归档卡死 session + 重 fork + leaf set-session 替换，需放开 set-session caller 校验）
- 选项 B：等 Proma 修 fork identity timeout（BUG-A，跨仓，不可控）
- 选项 C：auditor role 降级为"root 代调 + 留痕"（放宽 caller-binding，但弱化安全）
- **建议先修 BUG-2/BUG-B（engine 层确定能修），再研判 fallback（涉及安全语义放松，需用户决策）**

### 不做（跨仓 / 非 tree-engine）
- BUG-A（Proma fork identity timeout）：Proma app 层，记待办
- SDK 时序 bug + LIMIT-F：Proma SDK 仓，记待办

---

## 六、执行方法论（本工作区已验证）

- **子 Agent 群 + 多轮审计迭代**：实施 SubAgent（engine/测试）→ 3-4 路并行审计 SubAgent（引擎契约/schema 一致性/bug 正确性/安全不变量）→ 修复 P0/P1 → 收敛 → 重测
- **绝不破坏基线**：现有 90/90 测试（含 auditor-role-test 20 + p1b-fix-evidence-test 8）+ caller-binding 安全语义 + macp2 三层防护
- **成本纪律**：子 Agent 用内置 Agent 工具（进程内），🚫禁 create_session/fork_session 当 reviewer（macp2 事故红线）；收敛条件（角色/轮数/停止）；预算护栏别关
- **文档引擎一致性**：改 engine 后同步 help topic + SKILL，grep 错误码常量确认
- **测试驱动**：先写测试再改 engine（auditor-role-test Case 9/10 + p1b-fix-evidence-test 是范例）

## 七、完成标准

1. BUG-2 修复 + 测试（fork 副本冒 root 身份 leaf_add 被拦）+ 全量 90/90 绿
2. BUG-B 修复 + 测试（leaf_add 报错不留幽灵 leaf）
3. P2 一致性修复（LIMIT-D + tree_validate + LIMIT-E）
4. 多轮审计收敛 + 本地全绿
5. 部署 Pro（.bak-pre-bug2-fix-20260709）+ 重测（fork 副本冒 root 场景）
6. 交付报告 + commit 到 release-0.13.16-hardening

**首步**：读本文件 + CLAUDE.md + audtest-test-materials 00-README + 01/03/05，然后从 BUG-2 开干（先确认 MCP wrapper 的 leaf add caller 注入）。

---

## 八、audtest 测试材料快速摘要（给新会话）

| 文件 | 关键内容 |
|------|---------|
| 00-README | 索引 + 测试概况 + bug 清单 + 修复建议优先级 |
| 01-commander-final | 最权威失败报告（8 节，含 BUG-A/B/C 归属 + 自我复盘） |
| 03-fork-67b8a9a2 | BUG-2 第一手发现（leaf_add caller-binding 失效） |
| 05-observer | 独立验证 + P0b 噪音降低完全通过 + fork 来源追踪 |
| 06-fork-trace | fork 调用时间线 + BUG-A 时序分析 |

**一句话结论**：P0a/P0b/P1b 改造的单元验证通过（含 macp4-A4 假阳性修复完全生效），但 audtest 暴露 leaf_add caller-binding 漏洞（BUG-2，macp2 加固缺失）+ Proma fork identity timeout（BUG-A，跨仓）。**新会话先修 BUG-2（engine 层确定能修，精确修复点见 §三）**。
