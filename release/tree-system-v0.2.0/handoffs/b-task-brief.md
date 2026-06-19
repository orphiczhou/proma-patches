# B 任务 Brief — Proma v0.2 启动公告

> 选定：选项 A（推荐）
> 执行时间：2026-06-18
> tree_id：bverify
> 指挥官 session_id：63b4e61a-5b0e-479a-82e9-0cbb481a30d8
> 第 3 次尝试（前 2 次因 DeepSeek 渠道瞬时问题卡死已归档）

## 任务概述

写一份「Proma v0.2 启动公告」，真实业务价值：
- 供项目团队归档，作为 v0.2 正式启动的标志
- 记录 v0.1 完成的成就（tree-state.js、tree-commander/tree-worker SKILL、S1 测试通过）
- 说明 v0.2 新增能力（心跳通道、内部自审必须化、三档纠偏实现）
- 含 v0.1→v0.2 迁移指南

## 树形结构

```text
bverify-root（指挥所，本会话）
  ├─ bverify-A-announce    🍃 公告核心正文（背景/v0.1 回顾/v0.2 启动宣言/结构框架）
  │   └─ bverify-A1-polish  🍃 孙会话：对 A 的草稿做润色与质量把关
  ├─ bverify-B-techdetail  🍃 v0.2 技术能力详解 + 迁移指南
  └─ bverify-F-integrate   🍃 整合会话（A1+B done 后启动，合并+统一文风+目录+结语）
```

A、B 并行；A1 在 A done 后启动（由 A 通过 plan 事件触发 Fork）；F 在 A1、B 都 done 后启动。

## 各子任务简述

### A: 公告核心正文
- 写公告的主体框架：引言、v0.1 成就回顾、v0.2 启动宣言
- 目标 800 字
- 完成后触发孙会话 A1 做润色

### A1: 润色与质量把关（孙会话）
- 对 A 的草稿做语言润色、结构优化、错别字检查
- 验证与 brief 的对齐度
- 目标 800 字优化后版本

### B: v0.2 技术能力详解 + 迁移指南
- v0.2 三大新能力：心跳通道、内部自审必须化、三档纠偏
- 每项能力的配置方法、使用场景
- v0.1→v0.2 迁移步骤
- 目标 1000 字

### F: 整合
- 合并 A1（润色后）和 B 的产出为单一文档
- 加目录、统一文风、加结语（200 字展望）
- 目标 >= 1500 字（合并后）

## 根 DoD

- 交付物：`.context/bverify-deliverable/proma-v02-launch-announcement.md`
- 最小长度：1500 字
- must_contain：["v0.1", "v0.2", "心跳", "内部自审", "三档纠偏", "迁移指南"]
- 结构：含目录、引言、v0.1 回顾、v0.2 新能力、迁移指南、结语
- quality_gates：Mermaid 图表可渲染（如有）、Markdown 格式规范

## 验证维度

1. tree-commander SKILL 铁律遵循（指挥官侧）
2. tree-worker SKILL 在子会话加载（首条消息加载 + brief_echo）
3. HTTP 直连创建会话 + send_message 真实通信
4. tree-state.js 状态变迁反映真实会话生命周期
5. plan 事件 → 孙会话 Fork（A→A1）
6. 端到端：契约下发 + brief_echo + milestones + done + 整合
7. 最终 validate 通过、产出真实可交付

## 命名约束

- prefix=bverify（7 字符，全小写，无连字符）✅ 匹配 `[a-z][a-z0-9_]{3,7}`
- 所有 leaf_id 严格符合命名正则
- 避免触发 S1 已知问题（不含大写 prefix、不含连字符 prefix、≥4 字符）
