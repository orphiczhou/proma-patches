# 子会话创建机制改进 — 实施与审计结果（收敛）

> 日期：2026-07-25 | 基于 design.md（pi 孙会话 13cddc31 调研）
> 范围：P0 + P1（用户确认）+ P1+（迭代增强）

## 0. TL;DR

design.md 调研发现 Pi 运行时 collaboration 注入缺 delegationDepth 检查（伪可用陷阱：depth>0 的 pi 子会话看到 collaboration 工具但调用即 throw）。本轮三件套修复 + 两轮审计收敛：

- **P0**：apply-patches.sh 补丁 Q（sed 对齐 Pi 到 Claude，加 depth 检查）→ 消除伪可用陷阱
- **P1**：patches.cjs create_session/fork_session 的 E_DELEGATION_TOO_DEEP 报错扩展（加替代方案）
- **P1+**：fork_session identityPrompt 在 depth>0 时追加 collaboration 限制提示（覆盖 design.md 核心场景，响应首轮审计 §3 PARTIAL）

**两轮审计全 PASS**，子会话群（2 实施 + 1 审计 + 1 复审）协作完成。

## 1. 子会话群协作记录

| 子会话 | 角色 | session_id | 产出 |
|--------|------|-----------|------|
| 实施 P0 | 改 apply-patches.sh 补丁 Q | 09c127df | implementation-p0.md |
| 实施 P1 | 改 patches.cjs 报错扩展 | dc4cc332 | implementation-p1.md |
| 审计（首轮） | 独立审查 P0+P1 | 400ad4a3 | verdict PASS + §3 PARTIAL（P1 覆盖断层）|
| 审计（复审） | 审查 P1+ 收敛 | 400ad4a3（continue）| verdict PASS（收敛）|

父会话：调研 + review + 部署 + P1+ 增强（响应 §3 PARTIAL）+ 收敛判断。

## 2. 改动清单

### 2.1 P0：apply-patches.sh 补丁 Q（L86-92）
sed 对齐 Pi collaboration 注入到 Claude：
```bash
sed -i 's|triggeredBy !== "delegation";|triggeredBy !== "delegation" \&\& (ctx.sessionMeta?.delegationDepth ?? 0) === 0;|' "$TMPDIR/main-patched.cjs"
```
- 锚点 `triggeredBy !== "delegation";`（带分号，Pi 独有；Claude 那处后接空格+&& 不匹配）→ grep -c = 1 唯一
- 部署后 dist/main.cjs 完整 collaboration 条件 = 2 处（Claude + Pi 对齐），旧锚点 = 0

### 2.2 P1：patches.cjs 报错扩展（L1157 + L1244）
create_session + fork_session 的 E_DELEGATION_TOO_DEEP 报错 msg 扩展（加"当前是协作子会话 + P0 后 collaboration 不可见 + 3 种替代方案"）。逻辑不变（错误码/触发条件/返回结构），只 msg 更详细。

### 2.3 P1+：fork_session identityPrompt 追加（L1370-1385）
fork_session 的 identityPrompt（给新 fork 会话的身份提示）在 `_forkNewDepth > 0` 时追加 collaboration 限制段：
```js
let identityPrompt = [...].join('\n');  // const→let
if (_forkNewDepth > 0) {
  identityPrompt += ['', `**协作子会话限制（delegationDepth=${_forkNewDepth}）**：`, ...3种替代方案].join('\n');
}
```
- 载体选择：fork identityPrompt 直接注入给新会话（design.md §4 P1 "子会话自己知道"原意），fork 是 tree 派生主路径
- 不改身份提示核心（纯追加），const→let 无副作用

## 3. 部署

| 目标 | 状态 |
|------|------|
| apply-patches.sh 补丁 Q | source 已改 |
| dist/main.cjs 补丁 Q | 已 sed 部署（备份 /tmp/main.cjs.bak.p0q）+ grep 验证 2 处对齐 + node --check |
| dist/proma-dev-patches.cjs（P1+P1+） | 已 cp + diff identical + node --check |
| dev/pro 实例 | restart-{dev,pro}.ps1 (ISOLATED=1) LAUNCHED |

## 4. 审计两轮

### 首轮（P0+P1）— VERDICT: PASS（§3 PARTIAL）
- P0 正确性 PASS：sed 精确 + dist 验证 2 处对齐
- P1 正确性 PASS：报错扩展逻辑不变
- **§3 PARTIAL**：P1 实际只在 depth≥MAX_DELEGATION_DEPTH=10 触发，不覆盖 design.md 核心场景（depth=2）
- 向后兼容 PASS / 部署完整性 PASS / 风险 PASS

### 复审（P1+）— VERDICT: PASS（收敛）
- P1+ 通过 fork identityPrompt 注入，depth>0 的 fork 子会话首条消息即获知 collaboration 限制 + 替代方案
- 精准填补 §3 PARTIAL
- const→let 无副作用、身份核心未改、source↔dist 一致

## 5. 覆盖矩阵（P0+P1+P1+ 整体）

| 场景 | depth | P0 工具移除 | P1 报错扩展 | P1+ identityPrompt | 覆盖 |
|------|-------|:-:|:-:|:-:|:-:|
| root 会话用 collaboration | 0 | — | — | — | ✅ 不受限 |
| **fork 子会话（tree 主路径）** | 1-9 | ✅ | ❌ | ✅ | ✅ **完整** |
| create_session 子会话 | 1-9 | ✅ | ❌ | ❌ 无载体 | ⚠️ 残余 |
| depth≥10 fork | ≥10 | ✅ | ✅ | ✅ | ✅ 双保险 |
| depth≥10 create_session | ≥10 | ✅ | ✅ | ❌ | ✅ P1 兜底 |

## 6. 后续观察点

1. **create_session 路径残余**：depth 1-9 的 create_session 子会话不知道 collaboration 限制（无 identityPrompt 载体）。审计认定有意设计（create_session 是独立会话创建，fork 是 tree 派生主路径）。若实战发现 create_session 路径频繁产生困惑子会话，再考虑加提示载体。
2. **design.md 文档偏差**：§4 P1 暗示 depth>0 即触发 E_DELEGATION_TOO_DEEP，实际 MAX=10。session MCP 深度限制（10）比 collaboration（depth=0）宽松——两套机制服务不同场景。design.md 可注明。
3. **补丁 Q 锚点脆弱性**：minified main.cjs 上游更新可能失配。apply-patches.sh 已有 grep -q + set -e fail-safe（失配报错退出，不静默损坏）。
4. **macp 类实战验证**：depth>0 的 pi fork 子会话实战中是否看到 identityPrompt 的 collaboration 限制提示 + 替代方案。

## 7. 交付物

- `D:/Codes/tree-harness/apply-patches.sh`（补丁 Q）
- `D:/Codes/tree-harness/proma-dev-patches.cjs`（P1 报错扩展 + P1+ identityPrompt）
- `D:/Codes/tree-harness/pr/20260724-subsession-mechanism-investigation/{design.md, implementation-p0.md, implementation-p1.md, results.md}`
