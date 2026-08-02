# pro 实例 macpaf3 实景验证报告（child_done 两级链）

> 日期：2026-08-02 10:20-10:38 GMT+8
> 验证：**child_done 两级链**（macpaf2 未测的新点：worker→commander→root）+ 3 轮改动回归 + §13.8 主动性
> tree：macpaf3（4 leaf：root GLM + commander DeepSeek + worker GLM + auditor MiniMax 异厂商）

---

## 一、部署（4 leaf 多层级）
| Leaf | Role | 厂商 | parent | 验证动作 |
|------|------|------|--------|---------|
| macpaf3-root | root | GLM | — | tree_init 轮2验证 + plan + 背书 auditor + 主动 done |
| macpaf3-A1-commander | commander | DeepSeek | root | add worker + M1 + 收第一级 child_done + done 触发第二级 |
| macpaf3-A1a-worker | worker | GLM | commander | M1 + done 触发第一级 child_done |
| macpaf3-Au-auditor | auditor | MiniMax | root | 审查 + 签 worker/commander M1 + 关 worker gate |

## 二、核心：两级 child_done 链 ✅（macpaf2 未测新点）

```
worker done @10:30:28
  └─第一级→ commander 收 child_done @10:36:14  ✅
commander done @10:37:01
  └─第二级→ root 收 child_done @10:37:28  ✅
auditor done @10:29:49
  └─→ root 收 child_done @10:29:49（root 直接子）
```

root.events 完整轨迹（4 条）：plan @10:21:30 → child_done(auditor) @10:29:49 → child_done(commander) @10:37:28 → done @10:38:20

**两级 `_notifyParentChildDone` 自底向上传播正确**：每级 done 都给 parent 写 child_done event（meta.child_leaf_id/role/path/status 完整）。

## 三、3 轮改动回归 ✅

| 轮 | 验证点 | 结果 |
|---|--------|------|
| 轮2 | tree_init UUID 校验：缩写 sid `0d9f3f14` 拦截 E_NAME_INVALID + 完整 UUID 成功 | ✅ |
| 轮3 | activity guard：root plan event + 背书 auditor（activity guard + A7 双满足）| ✅ |
| 轮1 | child_done 两级链（worker→commander→root）| ✅ |
| 轮3 | §13.8 主动性：root 不等手工提示，对照 DoD 主动 done | ✅ |

## 四、流程坑发现 + 修复（worker done 三件套）

worker 首次 set-status done 撞 `E_GATEKEEPER_REQUIRED`，根因：流程 task 漏了 worker done 的**三件套门禁**（独立调用，不能只签 milestone）：
1. milestone M1 audit_pass=true ✅（auditor 签了）
2. **alignment_pending=false** ❌（§13.3 步骤 4 漏：commander 需回填带 alignment 的 brief_echo）
3. **audit_gate.verdict=pass** ❌（§13.3 步骤 6 漏：milestone_set_result ≠ audit_gate，是独立调用）

**修复**：commander 回填 alignment（§13.3 步骤4）+ auditor 关 worker audit_gate（§13.3 步骤6）→ worker set-status done 成功 → 触发第一级 child_done。

**教训**：worker done 调度时，步骤 4（alignment 回填）+ 步骤 6（audit_gate pass）是独立调用，不能只 milestone_set_result。SKILL §13.3 已文档化，调度者需完整走 7 步。

## 五、最终状态
- **4 leaf 全 done**（root auto_upgrade + commander + worker + auditor）
- tree_validate **0 issues**
- HMAC 签名链 write_count=32，4 leaf 全 hash
- root §13.3a auto_upgrade（audit_gate skip→pass，done event 触发）

## 六、对比 macpaf2
macpaf2 测了**单级** child_done（commander/auditor done → root）。macpaf3 测了**两级链**（worker→commander→root），证明 `_notifyParentChildDone` 在多层级树自底向上逐级传播，不限于直接子。leaf auto-closeout gap 在多层级场景也闭合。

**Co-Authored-By**: Claude `<noreply@anthropic.com>`
