# Bug B 调查报告：同 session 多 leaf 匹配歧义

## 一句话结论

**确认 bug，medium-high 严重度。** 引擎代码 `resolveAuditorIndep` 使用 `Object.values(state.leaves).find(l => l.session_id === auditorSessionId)`（第 1883 行），遇到同 session 多 leaf 时**取第一个匹配，不 fallthrough**；而 `cmdLeafAdd`（第 633 行）**不校验 session_id 唯一性**（仅校验 leaf_id 唯一性），导致歧义场景可以被构造出来。SKILL helper 和 spec 都**没有明文禁止**同 session 多 leaf，但 `cmdLeafSetSession` 和 `cmdSegmentAppend` 又**禁止** session_id 重复 —— 这种不对称是 bug 的直接温床。

## 背景

6/25 17:51–17:53 的会话 `15109031-2c5d-42d6-b200-2fb2c16b5374`（DeepSeek V4 Pro 子会话）是 V10 Phase 2 P2 auditor 探针。会话被外部主会话 7c9b6b65 当作"独立 auditor"派出来，给 v10p2-e2e 树的 commander / worker 写 audit_gate pass。但同一 session 在同一棵树中先被注册为 `v10p2-C-auditor`（worker 角色），后来又被注册为 `v10p2-D-commander`（commander 角色）。当 session 15109031 调 audit_gate 审 worker 时，引擎命中创建时间更早的 C-auditor 而非 D-commander，导致 audit_gate 持续返回 `E_AUDITOR_NOT_INDEPENDENT`，即便 D-commander 已经被 root 授予 pass。最坏情况：C-auditor 被 prune 后，引擎**仍命中 C-auditor**（status=pruned），而不是 fallthrough 到 D-commander —— 这是原始 bug 报告的核心陈述。

## Phase 1：静态分析

### 15109031 场景重建

通过完整读取会话 jsonl（69 行，76 KB）+ tree-state.json 还原场景：

- **tree_id**: `v10p2-e2e`（workspace = `tree-2`，dev 实例 Proma-white 127.0.0.1:19877）
- **session**: `15109031-2c5d-42d6-b200-2fb2c16b5374`（DeepSeek V4 Pro）
- **多 leaf 列表**（同 session 两个 leaf）：

| leaf_id | role | session_id | created_at | status（最终） | audit_gate.verdict |
|---------|------|------------|------------|---------------|-------------------|
| `v10p2-C-auditor` | worker | 15109031-... | 17:49:37.542 | pruned（17:53:13 被 drift prune） | required（从未 pass） |
| `v10p2-D-commander` | commander | 15109031-... | 17:51:09.064 | done | **pass**（17:51:38 被 root 7c9b6b65 授予） |

注意：两个 leaf 都是 `added_by=15109031`（D-commander）/ `added_by=7c9b6b65`（C-auditor），session_id 都是 15109031。

- **调用序列**（摘自 jsonl）：

| 时间 | 调用 | 结果 |
|------|------|------|
| 17:49:53 | `mcp__session__get_my_session_id` | 返回 15109031 |
| 17:49:57 | `audit_gate(v10p2-B-commander, pass, audit_session_id=15109031)` | **拒绝** — `auditor leaf "v10p2-C-auditor" status="pending_brief"` |
| 17:50:17 | `event_append(C-auditor, brief_echo)` | ok |
| 17:50:20 | `event_append(C-auditor, done)` | ok（C-auditor status→done） |
| 17:50:27 | `audit_gate(v10p2-B-commander, pass, audit_session_id=15109031)` 重试 | **拒绝** — `auditor leaf "v10p2-C-auditor" own audit_gate.verdict="required"`（V10-auditor-active 第三重校验） |
| 17:51:09 | `leaf_add(v10p2-D-commander, session=15109031)` | **ok**（关键：引擎未拒绝 session_id 重复） |
| 17:51:13–16 | `event_append(D-commander, brief_echo + done)` | ok |
| 17:51:38 | （root 外部）`audit_gate(v10p2-D-commander, pass, audit_session_id=7c9b6b65)` | ok（D-commander verdict→pass） |
| 17:52:08 | `audit_gate(v10p2-D1-worker, pass, audit_session_id=15109031)` | **拒绝** — 仍命中 C-auditor，verdict=required |
| 17:52:54 | 同上重试（"你现在是 D-commander"） | **拒绝** — 仍命中 C-auditor，verdict=required |
| 17:53:13 | （root 外部）drift prune C-auditor | C-auditor status→pruned |
| 17:53:23 | `audit_gate(v10p2-D1-worker, pass, audit_session_id=15109031)` 重试 | **拒绝** — `auditor leaf "v10p2-C-auditor" status="pruned" (must be done)` —— **即便 C-auditor 已 pruned，引擎仍未 fallthrough 到 D-commander** |

- **引擎返回**：始终 `E_AUDITOR_NOT_INDEPENDENT`，错误信息反复引用 C-auditor（创建时间更早的 leaf），从未引用 D-commander。这是 bug 的决定性证据。

### 引擎代码层证据

文件：`D:\Proma-dev\resources\app\dist\tree-engine.cjs`（154 KB，commit 后版本）

**第 1883 行（`resolveAuditorIndep` 函数内）—— bug 根因代码**：

```javascript
const auditorLeaf = Object.values(state.leaves).find(l => l.session_id === auditorSessionId);
if (!auditorLeaf) return `auditor "${auditorSessionId}" not found as any leaf session in tree (forged UUID)`;
```

`Array.prototype.find` 语义：返回**第一个**使回调返回 truthy 的元素，找到即停。**没有 fallthrough 机制**。

**第 1885–1897 行（V10-auditor-active 三重校验）**：

```javascript
if (auditorLeaf.leaf_id === leaf.leaf_id) return 'auditor is the leaf itself';
if (auditorLeaf.status !== 'done') {
  return `auditor leaf "${auditorLeaf.leaf_id}" status="${auditorLeaf.status}" (must be done; ...)`;
}
if (!Array.isArray(auditorLeaf.events) || auditorLeaf.events.length === 0) {
  return `auditor leaf "${auditorLeaf.leaf_id}" events empty (...)`;
}
const ag = auditorLeaf.audit_gate;
if (!ag || ag.verdict !== 'pass') {
  return `auditor leaf "${auditorLeaf.leaf_id}" own audit_gate.verdict="${ag ? ag.verdict : 'undefined'}" (must be pass; ...)`;
}
```

每条 return 都直接退出函数，**没有任何"如果这个候选 auditor 不达标，尝试下一个同 session 的 leaf"的逻辑**。

**第 633 行 `cmdLeafAdd` —— bug 的另一只手**：

```javascript
async function cmdLeafAdd(args) {
  // ... 校验 leaf_id 命名、parent、role、UUID ...
  if (Object.prototype.hasOwnProperty.call(state.leaves, leaf_id)) {
    throw new TreeStateError(E_DUPLICATE_LEAF, `leaf "${leaf_id}" already exists`);
  }
  // ⚠️ 没有 "session_id already used by other leaf" 校验
  // ...
}
```

`cmdLeafAdd` 仅校验 `leaf_id` 唯一（第 700–702 行），**不校验 `session_id` 是否已被其他 leaf 使用**。这就允许了 15109031 场景：同 session 注册 C-auditor + D-commander 两个 leaf。

**对比：`cmdLeafSetSession`（第 1739 行）和 `cmdSegmentAppend`（第 1739 行）都强制 session_id 唯一**：

```javascript
// cmdLeafSetSession
for (const l of Object.values(state.leaves)) {
  if (l.session_id === new_session_id) {
    throw new TreeStateError(E_SCHEMA_INVALID,
      `session_id "${new_session_id}" already used by leaf "${l.leaf_id}"`);
  }
}
```

`cmdSegmentAppend`（第 1735–1742 行）做相同校验，连 `segment_chain` 数组里的 session_id 也禁止重复。**唯独 `cmdLeafAdd` 不做**。

**`collectValidateIssues`（第 1944–1958 行）—— 软校验，仅 warn**：

```javascript
// 检查 3: 所有 segment_chain 中的 session_id 唯一（跨 leaf 不重复，且与 leaf.session_id 不重复）
const seenSessionIds = new Map();
for (const id of leafIds) {
  const leaf = leaves[id];
  if (leaf.session_id) {
    if (seenSessionIds.has(leaf.session_id)) {
      issues.push({
        type: 'duplicate_session_id',
        leaf_id: id,
        detail: `session_id "${leaf.session_id}" already used by leaf "${seenSessionIds.get(leaf.session_id)}"`
      });
    } else {
      seenSessionIds.set(leaf.session_id, id);
    }
  }
}
```

这段在 `tree_validate` 里会**报告** duplicate_session_id，但**只是 issue 不是 error**，不阻止 `leaf_add`，也不阻止 `audit_gate`。我在复现中实测：`tree_validate` 确实报告了重复，但树仍能正常被写入和被 audit_gate 查询。

#### 是否有 fallthrough：**否**

代码全局搜 `findLeafBySession` 无匹配，搜 `auditor.*session` 全部命中 `resolveAuditorIndep` 这一处。引擎只有这一条路径解析 auditor → leaf，**没有任何 fallback / fallthrough / 候选列表逻辑**。

### V10-auditor-active 加固点分析

- **该加固点的本意**：堵 "僵尸 auditor" —— auditor leaf 标 status=active、events=[]、audit_gate.verdict=skip 但被借身份用（commit log 引用 `audit-gate-test-20260625`，伪造 UUID 404c724f）。
- **当前实现**：第 1856–1899 行注释明确写出"补 3 重新增校验：auditor leaf status 必须是 done、events 必须非空、自己 audit_gate.verdict 必须是 pass"。
- **是否考虑了多 leaf 场景**：**否**。注释和代码都默认 `session_id → 唯一 leaf` 一一映射，没考虑同 session 多 leaf 歧义。三重校验全部作用于"第一个被 find 命中的 leaf"，对其他同 session leaf 视而不见。
- **鸡生蛋解决方案 A（V10-trust-anchor，第 1874 行）**：root 自审放行（`leaf.role === 'root' && auditorSessionId === leaf.session_id` → return null）。这个放行只对 `leaf.role === 'root'` 生效，对 commander / worker 担当 auditor 时不放行 —— 但歧义场景下 root 也可能因 `.find()` 命中非 root leaf 而被绕开 / 错杀。

### SKILL spec 要求

`mcp__tree__tree_help('how_to_register_auditor')`（第 2831–2863 行）：

- **关于 session→leaf 映射**：spec 写"audit_session_id 指向另一个独立 leaf 的 session_id"，"auditor 在自己 session 内调 audit_gate(leaf_id=X, ..., audit_session_id=<auditor 自己 session>)"。
- **是否明文要求唯一**：**否**。spec 没有任何"每个 session_id 只能注册一个 leaf"的明文约束。spec 的全部 4 步流程都默认 auditor session 与被审 leaf session 不同，但没说"auditor session 在树中只能对应一个 leaf"。
- `role_semantics` topic（第 2875 行）：`auditor 不是一个独立 role 字段！auditor 是某个 leaf 的"职责"，由 audit_gate 的 audit_session_id 指向另一个 leaf 的 session_id 实现。` —— 这里隐含了"另一个 leaf"的映射，但同样未明文要求唯一。

**Spec 层的盲区**：helper / SKILL 都没警告用户"不要给同一个 session 注册多个 leaf"。用户（commander）派 auditor session 后，如果**复用同一 session** 创建自己的 commander leaf（或反向），就会落入 bug。

## Phase 2：实时复现

### 测试树

- tree_id: `bug-b-repro-06251851`（主复现树，5 leaf）
- tree_id: `bug-b-repro-06251852`（跨树隔离验证，3 leaf）
- 均在 release 实例（Proma-coral，127.0.0.1:19876）通过 `mcp__tree__*` 工具创建
- 引擎代码版本与 dev 实例（D:\Proma-dev\resources\app\dist\tree-engine.cjs）完全一致（同 commit 7d36cc7）

### 复现场景表

| # | 场景 | 操作 | 期望（spec 暗示） | 实际 | 是否符合 spec |
|---|------|------|------------------|------|--------------|
| 1 | leaf_add 允许 session 重复 | `bugb-A-worker` (session=15109031) 已存在；再 `leaf_add bugb-E-commander` (session=15109031) | 应拒（与 set_session / segment_append 一致） | **ok，引擎接受** | ✗ 不一致 |
| 2 | 同 session 同 tree 2 leaf，audit_gate 命中第一个 | B-commander (a8111bf5, active) + F-worker (a8111bf5, pending_brief) 都存在；audit D-worker with audit_session_id=a8111bf5 | 命中更"合格"的 leaf（或拒绝因歧义） | **命中 B-commander（创建更早），报 status=active** | ✗ 取第一个不 fallthrough |
| 3 | B-commander 加 brief_echo+done 后再 audit | B status→done，audit_gate.verdict 仍 skip；audit D-worker | 命中 B，但 verdict=skip 不达标 | **命中 B-commander，报 own verdict=skip** | ✗ 仍不 fallthrough |
| 4 | B-commander 被 drift prune 后再 audit | B status=pruned；audit D-worker | 应 fallthrough 到 F-worker（仍 pending_brief）或报"无可用 auditor" | **仍命中 B-commander，报 status=pruned** | ✗ **完全无 fallthrough**（这正是 15109031 终态） |
| 5 | 跨 tree session 重复 | tree1 有 B/F (session=a8111bf5)；tree2 创建 G (session=a8111bf5)；audit tree2 的 H-worker | tree2 的 audit 不应受 tree1 影响 | **正确命中 tree2 的 G-worker**，不串树 | ✓ 跨树隔离正常 |
| 6 | tree_validate 检测 duplicate_session_id | 对 bug-b-repro-06251851 调 validate | 应报 duplicate_session_id | **报 2 条 duplicate_session_id issue**（A↔E，B↔F） | ✓ 软检测工作正常 |
| 7 | validate issue 是否阻止后续 audit_gate | 不清状态，继续 audit D-worker | （spec 未定） | **不阻止**，audit_gate 仍执行（仍命中 B） | △ 软检测无强制力 |
| 8 | audit_append 路径（audit_log）是否有同样问题 | （未单独测，但代码第 2441 行同 `Object.values(state.leaves).find(...)`） | 应有同样 bug | 代码同源，**潜在同样问题** | ⚠ 待验证 |

### 决定性证据

**最决定性的是场景 4**（对应 15109031 终态）：

输入：
```
tree state:
  bugb-B-commander: session=a8111bf5, status=pruned (was done), events=[brief_echo, done]
  bugb-F-worker:    session=a8111bf5, status=pending_brief, events=[]
  bugb-D-worker:    session=10bfd544, status=pending_brief, added_by=10bfd544

call: audit_gate(tree=bug-b-repro-06251851, leaf_id=bugb-D-worker, verdict=pass,
                 audit_session_id=a8111bf5-f599-451a-acd0-d75d96b44ccc)
```

引擎返回：
```json
{
  "ok": false,
  "error": {
    "code": "E_AUDITOR_NOT_INDEPENDENT",
    "msg": "audit-gate rejected: auditor \"a8111bf5-...\" not independent for leaf \"bugb-D-worker\" (verdict=pass): auditor leaf \"bugb-B-commander\" status=\"pruned\" (must be done; auditor must have completed its own audit work). Audit must be performed by an independent session that exists in the tree.",
    "help_topic": "how_to_register_auditor"
  }
}
```

**关键观察**：
1. 错误信息只提到 `bugb-B-commander`（第一个 find 命中），完全没提到同 session 的 `bugb-F-worker`。
2. 即便 B-commander 已 pruned（无效），引擎仍以它为唯一候选 auditor，不尝试 F-worker。
3. 用户即便想"修复"（unprune B 或新建合格 auditor），只要 B 在 leaves 对象中**位置早于**其他合格 leaf，bug 就持续。

这完全复现了 15109031 场景的消息 68：`引擎仍按 session_id 15109031 优先命中 C-auditor（创建时间早于 D-commander），但因 status=pruned 不满足 "must be done" 而拒绝。引擎未 fallthrough 到同 session 的下一个 leaf（D-commander）。`

## Phase 3：结论

### 根因

**双层缺陷，互相耦合**：

1. **引擎代码层（`tree-engine.cjs` 第 1883 行）**：`resolveAuditorIndep` 用 `Object.values(state.leaves).find(...)` 取 auditor leaf，遇到多 leaf 同 session 时**取第一个匹配，不 fallthrough**。`audit_append` 路径（第 2441 行）有相同 pattern，潜在同 bug（未单独验证）。

2. **引擎代码层（`tree-engine.cjs` 第 633–799 行 `cmdLeafAdd`）**：**不校验 session_id 跨 leaf 唯一**，导致歧义状态可以被构造。这与 `cmdLeafSetSession`（第 1739 行）和 `cmdSegmentAppend`（第 1735 行）形成**不对称**——后两者强制 session_id 唯一，唯独 leaf_add 不强制。

3. **Spec / Helper 层（`tree_help('how_to_register_auditor')`、`role_semantics`、SKILL.md）**：**没有明文**要求"每个 session_id 在一棵树中只能注册一个 leaf"，也没警告用户不要复用 session 注册多 leaf。`tree_validate` 虽然能软检测 `duplicate_session_id`，但**只是 issue 不是硬拦截**。

4. **V10-auditor-active 加固点（第 1856–1899 行）**：注释和代码都默认 session→leaf 一一映射，没考虑多 leaf 场景。三重校验（status=done + events 非空 + verdict=pass）全部作用于"第一个 find 命中"。

### 严重度

- [ ] 不是 bug（V10 设计就是 session→leaf 唯一映射）
- [ ] low（文档未明说但行为合理）
- [x] **medium**（spec 应该明确，且 leaf_add 应该对称拦截）
- [x] **high（实际场景下会被踩坑）** —— 15109031 已经实际踩中，导致 D-commander 无法被 auditor 15109031 审计（即便 D 已 pass）
- [ ] critical（可绕过审计）—— 暂未发现可被利用绕过 audit；相反，本 bug 是**过度严格**（拒绝本应通过的合法审计），不是**过度宽松**

**最终判定：medium-high**。本身不导致审计被绕过（不是安全漏洞），但导致合法审计链断裂、用户困惑、helper 给的指引（"用 root audit C-auditor"）也只是 patch 现象不治本。V10 Phase 2 e2e 测试的实际工作流（root→auditor→commander→worker）在 auditor session 复用时直接卡死。

### 修复建议（不实施）

#### 1. 引擎层（首选）—— 在 `cmdLeafAdd` 加 session_id 唯一性强校验

第 700 行附近（`if (Object.prototype.hasOwnProperty.call(state.leaves, leaf_id))` 之后）加：

```javascript
// V11-session-leaf-unique: 同一棵树中 session_id 跨 leaf 必须唯一。
// 不对称根源：cmdLeafSetSession / cmdSegmentAppend 都强制唯一，唯独 leaf_add 不强制。
// 失守案例 15109031：C-auditor + D-commander 同 session,resolveAuditorIndep 的 .find() 命中 C 导致 audit_gate 全部失败。
const existingLeafForSession = Object.values(state.leaves).find(
  l => l.session_id === session_id
);
if (existingLeafForSession) {
  throw new TreeStateError(E_SCHEMA_INVALID,
    `session_id "${session_id}" already used by leaf "${existingLeafForSession.leaf_id}". ` +
    `One session = one leaf (auditor resolution uses .find() and would silently pick the first). ` +
    `To reassign, use leaf_set_session or segment_append after archiving the old leaf.`);
}
```

错误码建议新增 `E_DUPLICATE_SESSION_ID`，并在 `ERROR_CODE_TO_HELP_TOPIC` 映射中加入 `how_to_register_auditor` 引用。

#### 2. 引擎层（次选，若必须支持多 leaf 共享 session）—— `resolveAuditorIndep` 改为收集全部候选并选最优

```javascript
// 收集同 session 全部 leaf，按"audit 适配度"排序：done+verdict=pass 优先
const candidates = Object.values(state.leaves).filter(l => l.session_id === auditorSessionId);
if (candidates.length === 0) return `auditor ... not found as any leaf session`;
if (candidates.length > 1) {
  // 选 status=done + audit_gate.verdict=pass 的；若多个达标则报歧义错误
  const qualified = candidates.filter(l =>
    l.status === 'done' && l.audit_gate && l.audit_gate.verdict === 'pass'
  );
  if (qualified.length === 0) return `auditor session ${auditorSessionId} has ${candidates.length} leaves but none qualified (all done+pass missing): ${candidates.map(c => c.leaf_id+'/'+c.status+'/'+c.audit_gate.verdict).join(', ')}`;
  if (qualified.length > 1) return `auditor session ${auditorSessionId} has ${qualified.length} qualified leaves (ambiguous): ${qualified.map(c => c.leaf_id).join(', ')}`;
  // qualified.length === 1: proceed
}
```

注意：方案 2 实质承认"同 session 多 leaf 合法"，但增加歧义错误码会让 V10 e2e 流程更复杂。**推荐方案 1**（leaf_add 拦截）。

#### 3. `resolveAuditorIndep` 防御性 —— 至少跳过非 active/done 状态的候选

即便不强制唯一，也应让 `.find()` 跳过 `pruned` / `archived` 状态的 leaf：

```javascript
const auditorLeaf = Object.values(state.leaves).find(
  l => l.session_id === auditorSessionId &&
       (l.status === 'active' || l.status === 'done' || l.status === 'segment_pending')
);
```

这是**最小防御**，能避免 15109031 终态（C-auditor pruned 后仍被命中），但治标不治本（active 但 verdict=skip 的候选仍会被错命中）。

#### 4. Spec 层 —— `tree_help('how_to_register_auditor')` 和 `tree_help('role_semantics')` 加明文约束

在 `how_to_register_auditor` topic（第 2831 行）的"关键约束"段加：

```
- ⚠️ 每个 session_id 在一棵树中只能注册一个 leaf（V11-session-leaf-unique）。
  若复用同 session 注册第二个 leaf，audit_gate 会因 .find() 命中第一个而行为异常。
  派 auditor 必须用独立 session（fork_session 拿新的 session_id）。
```

在 `role_semantics`（第 2875 行）的"谁能 fork 谁"段后加：

```
## session→leaf 映射约束（V11-session-leaf-unique）
- 每个 session_id 在一棵树中只能对应一个 leaf。
- 这是因为 audit_gate 的 auditor 解析用 .find() 取第一个匹配。
- 复用 session 注册多 leaf 会导致 auditor 解析歧义。
- 派新 leaf 前先确认 session_id 未被占用，或归档旧 leaf。
```

#### 5. Helper 层 —— `tree_help('common_mistakes')` 加 15109031 教训

在 `common_mistakes` topic（参考现有 65996e8b 案例）加：

```
## 失守案例 15109031（V10 P2 e2e）
现象：auditor session 调 audit_gate 始终返回 E_AUDITOR_NOT_INDEPENDENT，
      即使被审 leaf 已 done 且 auditor 自己的另一个 leaf 已 audit_gate=pass。

根因：该 session 在树中被注册了两个 leaf（C-auditor worker + D-commander），
      引擎 .find() 命中创建更早的 C-auditor，不 fallthrough 到 D-commander。
      C-auditor 的 audit_gate.verdict 一直 required（或被 pruned），永远不达标。

教训：
- 一个 session 只注册一个 leaf
- 派 auditor 用 fork_session 拿独立 session_id
- 不要把 commander 自己和 auditor 注册到同一个 session
```

#### 6. 错误码层 —— 新增 `E_DUPLICATE_SESSION_ID`

第 193 行附近的 `ERROR_CODE_TO_HELP_TOPIC` 加：

```javascript
E_DUPLICATE_SESSION_ID:     'how_to_register_auditor',
```

并在错误码索引（第 3228 行附近）加：

```
- E_DUPLICATE_SESSION_ID — session_id 已被树中其他 leaf 占用 [help: how_to_register_auditor]
```

### 15109031 当时的实际原因

**既是引擎 bug，也是使用方式不当**，二者叠加：

1. **使用方式不当**：外部主会话 7c9b6b65 在 D-commander 阶段（消息 33）指示 auditor 子会话 15109031 用**同一 session** 注册第二个 leaf（D-commander），没有先用 fork_session 派独立 session。spec / helper 当时也没明文警告。

2. **引擎 bug**：`cmdLeafAdd` 允许了这种重复（本应像 `cmdLeafSetSession` 一样拒绝）；`resolveAuditorIndep` 用 `.find()` 取第一个匹配且不 fallthrough（本应至少跳过 pruned 或选 done+pass 的候选）。

3. **触发顺序**：C-auditor 创建在前（17:49:37），D-commander 创建在后（17:51:09）。即便 D-commander 被 root 审计 pass（17:51:38），引擎 `.find()` 始终命中 C-auditor。

**责任划分**：
- 用户（外部主会话）：~40%（复用 session 是反模式）
- 引擎 `cmdLeafAdd`：~30%（不对称、未拦截）
- 引擎 `resolveAuditorIndep`：~30%（`.find()` 无 fallthrough）
- Spec / helper：~10%（没明文警告，但即便有用户也未必读）

**结论**：在 V10 Phase 2 真实使用中，**只要 commander 把 auditor session 也用来注册自己的 commander leaf（或反向），bug 必现**。这不是边缘 case，是 V10 P2 e2e 实测中真实踩中的坑，应进入 V11 加固清单（建议命名 `V11-session-leaf-unique`）。

---

## 防御性自检清单（给后续 commander）

下次写 auditor 流程前，问自己 5 个问题：

1. **auditor session 是否在树里已经注册过 leaf？** 调 `tree_leaf_list_active` + `tree_leaf_list_all` 看 session_id 是否已被占用。占用 → 派新 session。
2. **我用的是 fork_session 拿的独立 session 吗？** 不是 → 停下，先 fork。
3. **target leaf 的 added_by 与 auditor session 是否相同？** 相同 → 会触发 `auditor=added_by` self-audit 拦截（即便不是 bug B 也会被 1882 行拦）。
4. **target leaf 是否已经 done + brief_echo？** 没做 → 引擎会因 target 不达标拒绝（不是 auditor 问题）。
5. **如果 audit_gate 持续返回 E_AUDITOR_NOT_INDEPENDENT 但被引用的 auditor leaf 看起来不对**，调 `tree_dump` 看 leaves 全表，确认是否有同 session 的"幽灵 leaf"（pruned/archived 但仍被 `.find()` 命中）。

## 用户使用模式 vs 引擎约束 的错位矩阵

| 用户场景 | 引擎是否支持 | 后果 |
|---------|-------------|------|
| 1 session → 1 leaf（标准） | ✓ 完美 | spec 描述的工作流 |
| 1 session → 多 leaf（commander + auditor 同 session） | ✗ bug | audit_gate 持续失败，helper 给的指引无效 |
| 1 session → 多 leaf（worker + worker 同 session） | ⚠ leaf_add 允许但 validate 报 | audit_gate 可能错杀 |
| 1 session 跨 tree → 各 1 leaf | ✓ 完美 | tree 间隔离正常 |
| 1 session → 1 leaf（archived）→ 新 1 leaf | ⚠ 待测 | archived leaf 是否仍被 `.find()` 命中？未单独验证，但代码层 `.find()` 不区分 archived，**疑似同样 bug** |
| fork session 但用旧 session_id 注册 leaf | ✓ leaf_add 接受 | 隐藏雷区，spec 应警告 |

## 与 Bug A / 其他 V10 问题的关联

- **Bug A**（worker 未完成但 commander 谎报通过）：是审计**过度宽松**类问题。
- **Bug B**（本报告）：是审计**过度严格**类问题（误拒合法审计）。
- 二者方向相反，但根源都是 `audit_gate` 路径的状态校验粒度不够精细。
- V10-auditor-active 三重校验（done + events + verdict）对 Bug A 是必要的（堵僵尸 auditor），但对 Bug B **不足以解决问题** —— 三重校验仍然作用于"第一个 .find() 命中"，对歧义场景无效。

## 引擎代码全景定位（给修复者）

| 函数 | 行号 | 与 Bug B 关系 |
|------|------|--------------|
| `cmdLeafAdd` | 633–799 | **未校验 session_id 唯一**（bug 入口） |
| `cmdLeafSetSession` | 1739 | 强制 session_id 唯一（对比基准） |
| `cmdSegmentAppend` | 1735–1742 | 强制 segment_chain 内 session_id 唯一（对比基准） |
| `resolveAuditorIndep` | 1861–1899 | **`.find()` 取第一个不 fallthrough**（bug 核心） |
| `cmdAuditGate` | 2242–2340 | 调用 resolveAuditorIndep（路由层） |
| `cmdAuditAppend`（audit_log） | 2441 | **同样 `.find()` pattern，疑似同 bug**（未单独验证） |
| `collectValidateIssues` 检查 3 | 1944–1958 | 软报告 duplicate_session_id（不阻止） |
| `ERROR_CODE_TO_HELP_TOPIC` | 193–204 | 无 E_DUPLICATE_SESSION_ID 映射 |
| `tree_help('how_to_register_auditor')` | 2831–2863 | 无 session 唯一性明文约束 |
| `tree_help('role_semantics')` | 2866–2898 | 隐含映射但未明文唯一 |
| `tree_help('v10_constraints')` | 2900+ | 8 大加固点未覆盖此场景 |

修复优先级（基于影响面）：
1. **P0**：`cmdLeafAdd` 加 session_id 唯一校验（治本，一行代码）
2. **P1**：`tree_help('how_to_register_auditor')` + `'role_semantics'` + `'common_mistakes'` 加明文约束和 15109031 教训
3. **P2**：`resolveAuditorIndep` 防御性跳过 pruned/archived 候选
4. **P3**：`cmdAuditAppend` 第 2441 行排查同源 bug
5. **P4**：考虑 `archived` leaf 是否也应从 `.find()` 中排除

## 附：复现产物

- 测试树 1: `bug-b-repro-06251851`（5 leaf：root + A-worker + B-commander(pruned) + C-worker + D-worker + E-commander + F-worker，含两组 duplicate session_id）
- 测试树 2: `bug-b-repro-06251852`（3 leaf：root + G-worker + H-worker，跨树隔离验证用）
- 原始 v10p2-e2e 树（保留）：`C:\Users\sir_c\.proma\agent-workspaces\tree-2\workspace-files\.context\trees\v10p2-e2e\tree-state.json`
- 会话记录：`C:\Users\sir_c\.proma\agent-sessions\15109031-2c5d-42d6-b200-2fb2c16b5374.jsonl`（69 行）

`tree_validate(bug-b-repro-06251851)` 已自检，报告 7 个 issue（含 2 条 `duplicate_session_id`），符合预期。`tree_validate(bug-b-repro-06251852)` 报告 3 个 issue（无 duplicate_session_id，跨树隔离正常）。
