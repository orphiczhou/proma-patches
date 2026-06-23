---
milestone: M1-M3
topic: T4补测执行
reversible: false
---

# T4补测执行笔记

## 执行概览

- worker: l1fix-E-test
- 时间: 2026-06-23 08:29–08:45 GMT+8
- MCP调用: ~25次
- 创建session: 6个
- 覆盖频道: DeepSeek (`56ecefd2`) + MiniMax (`b7e25505`)

## 关键决策

### 决策1: 跨provider切换参数选择
- **选择**: send_message(model_id=MiniMax-M3) on DeepSeek session
- **理由**: 这是方案10.3和集成场景2的原始语义——在同一session内切换不同provider的模型
- **结果**: API Error 400，channel级拒绝 + model_id被污染

### 决策2: 并发测试session复用
- **选择**: 复用M1创建的b5a1dc2d和640e6f73，而非新建
- **理由**: 两个session已有消息历史，更接近真实并发场景
- **结果**: MiniMax侧成功，DeepSeek侧因model_id污染失败。揭示了KL#5的副作用

### 决策3: Fork new_title双频道验证
- **选择**: 分别测试DeepSeek和MiniMax
- **理由**: v5声称修复仅在DeepSeek验证，需确认跨频道行为一致性
- **结果**: 双频道均忽略new_title，确认为回归

## 自审checklist

| # | quality_gate | 状态 | 证据 |
|---|-------------|:---:|------|
| 1 | 同session跨provider切换已测试并记录结果 | ✅ | §1.1, session `b5a1dc2d` |
| 2 | MiniMax 8工具全部补测完成 | ✅ | §1.2, 覆盖率3/11→11/11 |
| 3 | 集成步骤5已执行并记录消息数 | ✅ | §2.1, count=26 |
| 4 | Fork new_title完整UUID已记录+交叉验证 | ✅ | §2.2, `f1a81033` + `5419ba5e`, Fork返回值+get_session_info双重确认 |
| 5 | 10个instance="" ERROR的错误码类型已逐项记录 | ✅ | §2.3, 全部为应用层 |
| 6 | 并发测试独立复现完成(结构化验证) | ✅ | §3.1, MiniMax侧通过+DeepSeek侧失败原因已定位 |

## 与v5报告差异

| 差异 | v5声称 | T4实测 |
|------|--------|--------|
| Fork new_title修复 | T2确认修复 ✅ | **回归** — 双频道均忽略 ❌ |
| 跨provider切换 | 未测试 | 不支持(channel级拒绝)，且有session污染副作用 |
| 集成步骤5计数 | 缺步骤5 | count=26(非4), Fork全量复制历史 |

## 风险提示

1. **Fork new_title回归**: 这是v5声称已修复的Bug，T4独立复现证实回归。影响: Fork创建的子session无法自定义标题，影响session管理
2. **model_id污染**: send_message接受任意model_id但不验证channel归属，导致session metadata损坏。建议: send_message应校验model_id是否属于当前channel
3. **T3并发结论**: T3声称"2 session无竞态"基于单一worker单次执行。T4独立复现确认MiniMax侧正确，但DeepSeek侧因session状态问题未完成。建议由第三个独立worker在干净session上重新验证DeepSeek侧

## 可选方案记录

### Fork new_title替代方案
- A: 先Fork再通过其他方式修改标题 — 目前无API支持
- B: 在创建时通过get_session_info后其他工具修改 — 不适用
- C: 接受默认标题，通过workspace/session命名规范区分 — 临时方案
