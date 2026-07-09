# audtest 测试材料合集 — 索引

> **用途**：Proma Tree Harness P0a/P0b/P1b 端到端验证测试的完整材料合集，用于发回上游做修改素材和修复提示
> **整理时间**：2026-07-09 09:39 GMT+8
> **整理者**：独立观察者 b1f6efb8（Pro 实例 GLM-5.2）

---

## 一、测试概况

| 项目 | 值 |
|---|---|
| 测试 tree | `audtest` |
| 测试时间 | 2026-07-08 22:25 – 22:50 GMT+8（约 25 分钟） |
| 测试实例 | Pro (`C:\Users\sir_c\.proma-pro`) + 跨实例操作 Dev (`C:\Users\sir_c\.proma-dev`) |
| 模型 / 渠道 | GLM-5.2 / GLM |
| node_budget | 5 |
| root.session_id | `e954cf56-c26a-4ea4-a270-2facd7977329` |
| 测试总评 | ❌ **端到端核心目标失败**（P0a auditor role 完整 done 路径未跑通） |
| 单元验证 | ✅ 4/5 通过（三层防护 + P1b fix_evidence + 9 个错误码命中） |
| 涉及 session | 1 root + 6 fork + 1 观察者 = **8 个** |

---

## 二、文件清单

| # | 文件 | 来源 | 内容 |
|---|------|------|------|
| **00** | `00-README.md` | 观察者整理 | **本文件** — 索引 + 测试概况 + 关键结论 + 修复建议 |
| **01** | `01-commander-e954cf56-final-report.md` | 指挥官 e954cf56 | **指挥官最终版失败报告**（含 8 节，最权威） |
| **02** | `02-commander-e954cf56-first-report.md` | 指挥官 e954cf56 | 指挥官第一版报告（含"P1b 突破"误判，后被最终版修正） |
| **03** | `03-fork-67b8a9a2-report.md` | fork 副本 67b8a9a2 | **fork 副本独立报告**（含 BUG-2 发现：leaf_add caller-binding 失效） |
| **04** | `04-fork-sessions-summary.md` | 观察者整理 | 5 个 fork 副本的综合报告（8cc4fc3f / d308ce21 / d63805e6 / b8711bb7 / 166a817c） |
| **05** | `05-observer-b1f6efb8-independent-verify.md` | 观察者 b1f6efb8 | **独立观察者验证报告**（含 P0b TaoWatcher 噪音验证 + fork 来源追踪） |
| **06** | `06-fork-trace-and-timeline.md` | 观察者整理 | fork 调用追踪 + 完整时间线 + fork bug 时序分析 |

---

## 三、关键结论摘要

### 3.1 测试结果

| 验证点 | 状态 | 主要依据 |
|---|---|---|
| P0a auditor role **完整 done 路径** | ❌ **失败** | auditor session 全部卡死（fork identity timeout），无法自调 done event |
| 三层防护① startup_notice | ✅ 通过 | tree_init / leaf_add 返回完整注入 5 条告警 |
| 三层防护② caller-binding（done event 路径） | ✅ 通过 | root 代调 done event 被 `E_BORROWED_IDENTITY` 拦 |
| 三层防护② caller-binding（leaf_add 路径） | ❌ **失效** | fork 副本可冒 root 身份创建 leaf（BUG-2） |
| 三层防护③ 预算护栏 | ✅ 通过 | `E_TREE_NODE_BUDGET_EXCEEDED` 拦超预算 leaf |
| P1b fix_evidence | ✅ 通过 | done event 缺 `red_findings_resolved` 被 `E_SELFCHECK_INVALID` 拦（借 b8711bb7 副本跑通） |
| **P0b TaoWatcher 噪音降低**（macp4-A4 修复） | ✅✅ **完全通过** | C-13/R-03/R-06/C-15 假阳性 24-38 条 → 0 条；audit_log 不再被 tao-writer 污染 |
| tree_validate | ✅ 0 issues | （但未检测到 A2-worker 状态不一致等隐藏问题） |

### 3.2 发现的引擎 bug 清单

| # | Bug | 严重度 | 归属 | 详情 |
|---|---|---|---|---|
| **BUG-A** | Proma fork identity timeout（4 fork 3 卡死，25-33% 可用率） | **阻断** | Proma | `01` §2 根因 A、`03` §3 Bug-1 |
| **BUG-B** | leaf_add 报错时未事务回滚，幽灵 leaf 污染 active_count | 高 | tree-engine | `01` §2 根因 C、`02` §3 BUG-B |
| **BUG-2** | leaf_add 路径 caller-binding 失效（fork 副本可冒 root 身份） | 高 | tree-engine | `03` §3 Bug-2、`06` §3.4 |
| **BUG-C** | 连带创建未授权 leaf（A4-worker 来源不明） | 高 | tree-engine / Proma 协同 | `02` §3 BUG-B |
| **SDK bug** | fork 后第一次 `get_my_session_id` 错误返回源 session_id | 中 | SDK | `03` §4、`06` §3 |
| **W-01 通道不互通** | P0a 简化协议 brief_echo 走 mcp event，W-01 扫文本 YAML → 假阳性风险 | 中 | TAO Watcher | `04` Fork #4 (b8711bb7) |
| **_meta 字段缺失** | tao_watcher_session_id=null 但 TaoWatcher 实际运行 | 中 | tree-engine | `05` §1.4 |
| **A2-worker 状态不一致** | done event 写入但 status='pending_brief' | 中 | tree-engine | `05` §1.4 |
| **LIMIT-D** | leaf_list_active 不含 pending_brief，但预算 active_count 含 → 口径不一致 | 中 | tree-engine | `02` §3 LIMIT-C |
| **LIMIT-E** | SKILL `alignment_workflow` topic 对 P1b `red_findings_resolved` schema 描述不完整 | 中 | SKILL 文档 | `01` §4 LIMIT-E |
| **LIMIT-F** | SDK 无"探测 fork session 是否可用"接口 | 中 | SDK | `01` §4 LIMIT-F |

### 3.3 已确认生效的修复

| 修复项 | 证据 |
|---|---|
| macp4-A4 假阳性规则删除（C-13/R-03/R-06/C-15） | `05` §1.2 — 24-38 条假阳性 → 0 条 |
| macp4-A4 caller-binding 双重收紧（caller + role） | `02` §2 — leaf_add added_by=auditor session 被 `E_BORROWED_IDENTITY` + `[D2-B1]` 标签拦 |
| P0b applyNudge 不再 push audit_log | `05` §1.2 — 所有 leaf audit_log 完全为空 |
| P1b fix_evidence red_findings_resolved 强制 schema | `02` §1 步骤 E3-E4 — 缺字段被拦，必须对象数组 |
| 简化协议门禁前置（done event + audit_gate） | `02` §1 步骤 B6 — `E_AUDIT_PREMATURE` |

---

## 四、修复建议优先级（给上游）

### P0（阻断性，必须立即修）

1. **修 BUG-A**（Proma fork identity timeout）
   - 现象：4 fork 3 永久 busy，可用率 25-33%
   - 修复方向：fork identity 异步校验逻辑（V9+ Phase 4 / R2 P1），timeout 后释放 session 或重试
   - 影响：auditor role 在当前环境下完全不可用
   - 详见：`01` §2 根因 A、`03` §3 Bug-1

2. **修 BUG-2**（leaf_add 路径 caller-binding 失效）
   - 现象：fork 副本以 `added_by='e954cf56'`（手填）创建 leaf，引擎未拦
   - 修复方向：在 leaf_add 路径加 `caller === added_by` 校验，与 done event 一致
   - 影响：任何 fork 副本可冒 root 身份创建 leaf（macp2 事故 caller-binding 加固的应防场景）
   - 详见：`03` §3 Bug-2、`06` §3.4

3. **修 SDK 时序 bug**（fork 后 get_my_session_id 错误返回）
   - 现象：fork 副本第一次调 `get_my_session_id` 返回源 session_id（错），第二次才返回真实 session_id
   - 修复方向：fork 完成后 SDK 应稳定返回真实 session_id
   - 影响：fork 副本误用源 session_id 做所有操作，越权写入不被拦
   - 详见：`03` §4、`06` §3

### P1（高优先级）

4. **修 BUG-B/C**（leaf_add 事务原子性 + 连带创建幽灵 leaf）
   - 现象：leaf_add 报 `E_BORROWED_IDENTITY` 但 leaf 仍被创建，还连带创建另一个 leaf
   - 修复方向：报错路径上做完整事务回滚；审计 fork_identity_status=timeout session 是否被允许越权写 tree-state
   - 影响：预算护栏测试结果被幽灵 leaf 干扰，导致 D1 提前撞 E_TREE_NODE_BUDGET_EXCEEDED
   - 详见：`01` §2 根因 C、`02` §3 BUG-B

5. **修 W-01 通道不互通**
   - 现象：P0a 简化协议 brief_echo 走 mcp__tree__event_append（引擎层），W-01 扫文本 YAML（消息层），两条通道不互通 → 假阳性风险
   - 修复方向：W-01 规则应同时识别 mcp event_append(brief_echo)
   - 影响：简化协议下 worker/auditor 容易被 W-01 误报
   - 详见：`04` Fork #4 (b8711bb7) W-01 命中点分析

6. **修 _meta 字段初始化**
   - 现象：tree_dump 的 _meta 中 `tao_version=null`, `tao_watcher_session_id=null`，但 TaoWatcher 实际运行
   - 修复方向：tree_init 时初始化 _meta；TaoWatcher 写 nudge 时回填 tao_watcher_session_id
   - 影响：无法从 tree-state 直接定位 TaoWatcher session（调试困难）
   - 详见：`05` §1.4

### P2（一致性与文档）

7. **修 LIMIT-D**（list_active 与预算口径对齐）
   - 修复方向：要么 list_active 含 pending_brief，要么预算只算 status=active
   - 详见：`02` §3 LIMIT-C

8. **修 LIMIT-E**（回写 SKILL P1b schema）
   - 修复方向：`alignment_workflow` topic 和 §13.7 / §4.6 补全 `red_findings_resolved` 对象数组 schema
   - 详见：`01` §4 LIMIT-E、`02` §2

9. **修 tree_validate 状态一致性检查**
   - 现象：A2-worker 有 done event 但 status='pending_brief'，tree_validate 未检测到
   - 修复方向：tree_validate 应检查 done event 与 status 字段一致
   - 详见：`05` §1.4

10. **修 LIMIT-F**（SDK 提供 wait_for_session_ready 接口）
    - 修复方向：让指挥官能 polling 等 fork session 就绪
    - 详见：`01` §4 LIMIT-F

---

## 五、阅读建议

### 给上游修复团队

1. **先读 `00-README.md`**（本文件）了解全局
2. **读 `01-commander-e954cf56-final-report.md`** 看最权威的失败结论 + BUG 归属
3. **读 `05-observer-b1f6efb8-independent-verify.md`** 看独立验证 + 跨报告交叉验证
4. **读 `03-fork-67b8a9a2-report.md`** 看 BUG-2 的第一手发现
5. **读 `06-fork-trace-and-timeline.md`** 看 fork 调用时序，理解 BUG-A 的复现路径
6. 跳过 `02`（已被 `01` 取代的初版报告）和 `04`（fork 行为学，对修复参考价值较低）

### 给测试团队复盘

1. 读 `01` §7 自我复盘（指挥官的"我做错的地方"）
2. 读 `05` §5 观察者自评（"仅看 tree-state.json 不足以发现所有引擎 bug"）
3. 读 `04` 看 6 个 fork 的行为学对比（理解 Proma fork identity timeout 的副作用）

### 给产品决策者

- **结论**：P0a auditor role 设计正确但**当前不可用**（被 Proma fork identity timeout 卡住）
- **三层防护和 P1b 单元验证通过**，macp4-A4 假阳性修复完全生效
- **建议先修 Proma fork identity 异步校验，再复测**
- 一句话：`01` §8

---

## 六、目录绝对路径

```
C:\Users\sir_c\.proma-pro\agent-workspaces\default\b1f6efb8-e03d-410a-be10-e4db06a4e65f\audtest-test-materials-2026-07-09\
```

包含 7 个 Markdown 文件（00-06），可直接打包发回上游。

---

## 七、原始数据源（如需深挖）

| 数据源 | 路径 / ID |
|---|---|
| tree-state.json | `C:\Users\sir_c\.proma-dev\agent-workspaces\default\.context\trees\audtest\tree-state.json` |
| 指挥官 session | `e954cf56-c26a-4ea4-a270-2facd7977329`（223 条消息） |
| Fork #1 (auditor) | `8cc4fc3f-a3c1-45fc-9b56-9d22d017bfdb`（25 条消息） |
| Fork #2 (A2-worker) | `d308ce21-6a63-4019-9aea-951fb4e52f33`（124 条消息） |
| Fork #3 (A3-worker) | `d63805e6-2140-46c9-9c56-39c52ea4c898`（31 条消息） |
| Fork #4 (A4-worker) | `b8711bb7-8eea-4b3d-9d9c-1620b77ea516`（127 条消息） |
| Fork #5 (孤儿) | `166a817c-70f1-4ec5-9836-d6542458fd00`（5 条消息） |
| Fork #6 (孤儿) | `67b8a9a2-c039-4485-9fc9-a4cbc2d780a4`（40 条消息） |
| 观察者 session | `b1f6efb8-e03d-410a-be10-e4db06a4e65f`（本会话） |
| SKILL 参考 | `C:\Users\sir_c\.proma-dev\agent-workspaces\default\skills\tree-commander\SKILL.md` v2.5 |

如需拉取某个 session 的完整消息（不被截断），用 Proma SDK：
```python
list_messages(session_id=<上述任一 ID>, offset=0, limit=300)
```
