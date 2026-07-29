# pro 实例 macpaf2 实景验证报告（3 轮改动运行时）

> 日期：2026-07-29 15:30-15:50 GMT+8
> 验证：轮1 child_done 事件 + 轮2 tree_init UUID 校验 + 轮3 root activity guard + §13.8 leaf 主动性，在 pro 实例运行时（Electron 进程内多角色协作）
> tree：macpaf2（root GLM + commander DeepSeek + auditor MiniMax 异厂商）

---

## 一、部署（Task 14）
- engine 磁盘：D:/Proma-dev/（PRO 共享），md5 `b1951df7`（含轮1 child_done 5 处 + 轮2 tree_init 校验 2 处），三方一致（source=dev/pro=release）
- SKILL：pro workspace `~/.proma-pro/agent-workspaces/default/skills/tree-commander/SKILL.md` v2.9.7 → v2.9.9-macpaf-closeout（md5 一致）
- PRO restart ISOLATED=1 → 加载新 engine + 新 SKILL

## 二、多角色协作（异厂商破锯齿智能）

| Leaf | 厂商 | session | 验证动作 |
|------|------|---------|---------|
| macpaf2-root | GLM-5.2 | 8be76ada | tree_init（轮2验证）+ plan event（轮3准备）+ 背书 auditor（轮3验证）+ 主动 done（§13.8）|
| macpaf2-A1-commander | DeepSeek-v4-pro | 358fd2a2 | M1 + events + deliverables + done（触发 child_done）|
| macpaf2-Au-auditor | MiniMax-M3 | e3928fd7 | brief_echo + done + 异厂商签 M1（V10 三闸门）|

## 三、3 轮改动运行时验证

### 轮1 — child_done 事件 ✅
commander set-status done 后 ~200ms，root 自动收到：
```json
{"type":"child_done","ts":"2026-07-29T15:48:22","meta":{"child_leaf_id":"macpaf2-A1-commander","child_role":"commander","child_path":"A1","status":"done"}}
```
root 共收 **2 条 child_done**（auditor @15:46:18 + commander @15:48:22），证明 `_notifyParentChildDone` 对多 child done 各写一条。

### 轮2 — tree_init UUID 校验 ✅
- 缩写 sid `8be76ada`（cwd 前缀）→ `E_NAME_INVALID`（msg 点出根因"与 MCP caller 不等导致双锁死锁"）
- 完整 UUID → 成功（is_pending=false，避开 PENDING_ROOT）
- **对比 macpaf1**：缩写被接受 → 双锁死锁；macpaf2 在 tree_init 入口拦截，闭环前移

### 轮3 — root activity guard ✅（三态对比孤立验证）
| 会话 | root.events | auditor done event | 背书结果 |
|------|-------------|-------------------|---------|
| macpaf1 | 0（空） | — | ❌ E_AUDITOR_NOT_INDEPENDENT（activity guard）|
| macpaf2 试1 | 1（plan） | 无 | ❌ E_AUDIT_PREMATURE（A7）|
| **macpaf2 试2** | **1（plan）** | **有** | ✅ **成功** |

孤立逻辑：macpaf1→macpaf2（events 0→1）证明 activity guard；macpaf2试1→试2（补 done event）证明 A7。两闸门独立验证。

### 轮3 — §13.8 leaf 主动性 ✅
root 对照 `root_dod.accept_criteria`（3 轮验证）+ 2 条 child_done 确认子 done → **自发收尾**（done event + set-status done + auto_upgrade audit_gate skip→pass），全程无人手工提示。**对比 macpaf1 root 没主动 done 需用户提示**，§13.8 教化生效。

## 四、V10 三闸门（auditor 签 commander M1）✅
- 闸门 A：caller(e3928fd7) === audit_session_id(e3928fd7)
- 闸门 B：auditor(MiniMax) ≠ commander.added_by(root GLM)
- V10-auditor-active：auditor done + audit_gate=pass + events≥2

## 五、顺带发现（非阻塞，已记 pro memory）
1. **auditor 豁免 V5b alignment**：auditor `alignment_pending=true` 但 audit_gate pass 成功（简化协议跳过 alignment，仅适用 worker/commander）
2. **A7 闸门强制顺序**：auditor 先 done event → root 后背书（不可倒置，root 提前背书撞 E_AUDIT_PREMATURE）
3. **note 字段只接受路径**：milestone_set_result 的 note 自由文本被丢弃（审查依据应放 self_check）

## 六、最终状态
- 3 leaf 全 done（root auto_upgrade + commander + auditor），tree_validate **0 issues**
- HMAC 签名链全程维护（child_done 是 event 不在 mac scope，不破坏签名）
- D6-F1/F2 + leaf auto-closeout gap 在 pro 运行时全闭合

**Co-Authored-By**: Claude `<noreply@anthropic.com>`
