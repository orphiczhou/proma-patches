# macp4-root 执行问题报告

**角色**: root/commander  
**Session**: 527414f7-39cf-4855-9659-12a14bf8f6e3  
**Status**: done  
**时间**: 2026-07-08 17:01 ~ 17:41

## 遇到的问题

### 1. E_BORROWED_IDENTITY — done event 不能跨 session 写入
- **现象**: commander 为 worker leaf 写 done event 时被拒
- **根因**: 引擎要求 done event 只能由 leaf owner session 写入，commander session ≠ worker session
- **解决**: 通过 `send_message` 让 worker session 自己写 done event
- **影响**: 需要额外 4 次 send_message 调用，增加了 worker session 的 API 消耗

### 2. E_AUDIT_PREMATURE — done event 是 audit_gate 硬前置
- **现象**: worker 没有 done event 时 audit_gate 被拒
- **根因**: 引擎校验 `audit_gate` 前必须先有 `done` event，确保"审已完成的工作"
- **解决**: 先让 worker 写 done event，再调 audit_gate

### 3. E_BORROWED_IDENTITY — audit_gate 只能 auditor 自己调
- **现象**: commander 不能 `audit_gate(audit_session_id=dcaed801)` 更新 W3
- **根因**: V10-self-audit-forbidden 要求 `callerSessionId === audit_session_id`
- **影响**: R-06 要求的 W3 audit_gate 更新到独立 auditor 未能完成
- **状态**: 未解决，需 auditor session 可用

### 4. A3 auditor session 卡死
- **现象**: session dcaed801 持续 busy，无法接收新消息
- **根因**: 初始消息被截断（"tree_milestone_set_resu"），agent 可能陷入解析死循环
- **影响**: 无法完成 W3 audit_gate 独立更新
- **教训**: 消息完整性校验应在发送端保证

### 5. R-06 合规不完整
- W1/W2/W4 只有 root 作为 auditor，缺少独立验证 leaf
- W3 有 A3→A4 审计链，但 audit_gate 仍指向 root

### 6. root 自身缺 milestone
- tree_init 创建的 root leaf 默认无 milestone
- set-status done 时被拒（E_SCHEMA_INVALID: milestones must be non-empty）
- 解决: 事后补 M1 milestone

## 建议改进

1. 信任锚模型下，考虑允许 commander 为直属 worker 写 done event
2. 消息发送前做长度校验，防截断
3. tree_init 时自动创建 root milestone 骨架
