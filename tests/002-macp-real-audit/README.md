# 测试记录 002：macp 真实项目树形审计实战

> 测试日期：2026-07-24 | 实例：pro | tree_id=macp | 耗时 ~42min
> 对应 PR：A+B+C(`7350492`) + v0.18/v0.20(`d81707c`) + drift_display(`30081c6`)
> 结论：**10/10 leaf done，6 份审计报告（180KB，81+ 发现），树形体系实战验证——但暴露星形退化 + commander 架空问题**

## 1. 测试配置

- **项目**：D:\Codes\multi-agent-collab-platform（多Agent协作平台，7 个设计目录 + src/ 部分实现）
- **树结构**：root → 3 commander(A/B/C) → 6 worker，3 层每节点≥2 分支，10 leaf
- **多渠道**：GLM-5.2×5（主力）+ DeepSeek-v4-pro(pi)×3 + MiniMax-M3×2
- **审计维度**：PRD一致性 / UX设计 / 架构一致性 / API规范 / 实现差距 / 测试覆盖
- **观察员**：DeepSeek pi 运行时（自身也是 v0.20 验证），3 轮 collaboration 子会话探查

## 2. 执行结果

- **10/10 leaf done，全 audit_gate=pass**，write_count=78，call-log 152 条
- **6 份审计报告**（15-42KB，总 180KB）：81+ 项发现（12 P0 / 40 P1 / 46 P2）
- **观察员报告**（12KB）+ **根总结**（10KB，含交叉验证分析）

## 3. 树形体系关键发现（观察员总结）

### 3.1 ⚠️ 星形退化（最重要发现）
- **设计意图**：root → commander → worker 多级树形
- **实际执行**：root 直连 6 worker 的扁平星形——**3 个 commander session 创建后从未收到 brief，完全惰性**
- **根因**：root 在建完结构后直接用 send_message 给 worker 发任务 + 收结果，跳过了 commander 层
- **影响**：树形多级协调优势未发挥；root 成单点瓶颈

### 3.2 "静默期"误判
- root 有 ~30min 无 tree 工具调用（call-log 空白）→ 观察中误判为"冻结"
- **实际**：root 在此期间通过 send_message 与 worker 交互（发任务/收报告），这些**不在 tree call-log 中**
- **教训**：`pending_brief` 状态≠"无活动"；tree 系统缺 send_message 可见性

### 3.3 批量收敛模式
- root 等所有 6 worker 完成 → **16 秒内连续完成** 6 brief_echo + 5 milestone_set_result
- 高效但有风险：某 worker 永久卡住则整树无限等待

### 3.4 命名约定问题（24.3% 失败率）
- leaf_add path="macp/A"（应为"A"）×12 次失败
- milestone id 字段名错 ×6 + expect_outputs 绝对路径 ×6
- **根因**：GLM-5.2 对 naming_convention 理解不充分，依赖试错→修正

### 3.5 未激活的体系组件
heartbeat / TAO watcher / drift（24 次失败零 drift 记录）/ commander / nudge 全未使用。

## 4. 多渠道表现

| 渠道 | 产出 | 特点 |
|------|------|------|
| DeepSeek pi | A1(27KB 最早) + B2(42KB 最大) | pi 运行时全功能验证通过；最快产出 |
| GLM-5.2 | A2(21KB) + B1(27KB) + C2(33KB) + root | 主力稳定，收敛执行力强 |
| MiniMax-M3 | C1(15KB 最小) | 成功参与但报告偏薄 |

**三模型交叉验证的核心价值**：同一项目，DeepSeek 抓出版本漂移、MiniMax 抓出不可运行、GLM 抓出架构一致性——不同模型暴露不同盲区。

## 5. 审计成果摘要（根总结）

12 项 P0 阻断问题：
1. API 文档版本剪刀差（v0.4 vs v0.3，差 4 端点/10 错误码）
2. user-stories 版本链断裂（v0.2 文件实为 v0.6 内容）
3. 整库不可运行（无 build/Electron main 入口）
4. 沙箱管理器完全缺失（0%）
5. Phase 2-4 测试规划完全空白
6. 缺陷管理流程缺失

**交叉验证发现**：版本漂移是项目级系统性问题（4 个维度互证）；三条全栈贯穿缺口（模板扩展性/分析看板/沙箱从 PRD→测试整链断层）。

## 6. 下一步改进方向（基于本次实战）

| 优先级 | 改进项 | 影响 |
|--------|--------|------|
| P0 | **Commander 委派协议**：让 commander 真正驱动 worker（不依赖 root 直连） | 解决星形退化 |
| P0 | **tree_init naming 示例**：init 返回里加 path/leaf_id 代码级示例 | 降低 24% 失败率 |
| P1 | **Worker progress 实时反映**：报告落盘时触发 brief_echo | 解决状态滞后 |
| P1 | **send_message 可观测性**：tree 系统记录/展示 send_message 活动 | 解决"静默期"误判 |
| P1 | **Drift 自动记录**：可恢复错误自动 append drift | 填补体系空白 |
| P2 | **Heartbeat 默认激活** | 健康监控 |
| P2 | **降低 plan_ack_seconds**（300s→60s） | 减少启动延迟 |

## 7. 文件索引

| 文件 | 内容 |
|------|------|
| `macp-observer-report.md` | 观察员完整报告（执行时间线/多渠道/体系发现/经验教训）|
| `macp-root-summary.md` | 根总结（六维度结论/P0 清单/交叉验证/修复路线）|
| 项目 `.context/mlaudit-reports/` | 6 份 worker 审计报告（A1/A2/B1/B2/C1/C2）|
