# v0.16.3 多维度综合交叉测试方案

> 创建: 2026-06-18 13:45 | 主 Agent 下发给 Dev 实例指挥会话执行
> 工作区: `结构化实现方案测试` (de35c52e-5ad5-420a-95ca-403e84bf52b4)
> 频道: proma-official（含 18 个跨 provider 模型）

## 一、本轮目标

Dev 实例 v0.16.3 已部署三个修复（补丁 H v2 + Bug 4 + Bug 5），前序回归测试 R1/R2/R3 已通过基础验证。**本轮要做"完整的多维度交叉测试"**——不只是单点验证每个修复，而是：

1. **多修复联合场景**（多个修复同时触发的复合 case）
2. **极端边界**（连续切换、长会话、错误恢复）
3. **跨工具组合**（send_message + fork + archive + remote 的组合拳）
4. **回归用例沉淀**（产出可重复执行的 smoke test 清单）

## 二、必读文档

执行前必须读：

1. **本测试方案**: `workspace-files/.context/plan/test-plan-comprehensive-v0163.md`（即本文）
2. **前序回归报告**: `workspace-files/.context/note.md`（顶部条目，含 R1/R2/R3 结果）
3. **架构 wiki**: `workspace-files/.context/proma-dev-wiki.md`（§五补丁清单、§十一版本记录）

## 三、执行环境

- **HTTP bridge**: `http://127.0.0.1:19876`
- **本实例身份**: Dev（PROMA_INSTANCE_NAME=dev）
- **可用工具**: 11 个本地（`POST /<tool_name>`）+ 11 个远端（无远端实例时跳过）
- **关键端点**:
  - `POST /list_channels` → 看 proma-official 的 18 个模型
  - `POST /create_session` → 创建会话
  - `POST /send_message` → 发消息（支持 model_id 切换）
  - `POST /fork_session` → Fork（支持 up_to_message_uuid 截断）
  - `POST /list_messages` → 拉历史
  - `POST /get_session_info` → 查 meta（关键：model_id 是否同步）
  - `POST /archive_session` → 归档

## 四、矩阵 H/I/J/K/L — 多维度交叉测试

### 矩阵 H — 多 provider 横跳 × 多 sdkSession fork（综合 Bug 1+4+5）

**目标**: 在同一个会话里连续切换 5+ 个 provider 模型，再 fork 到不同 sdkSession 时期的消息，验证三个修复同时生效。

**步骤**:
```
1. create_session(proma-official, glm-5.2, title="[多维-H] 5 provider 横跳")
2. 连续 5 轮 send_message，每轮换一个 model_id：
   - glm-5.2:        "我是 Proma Agent 测试 SubAgent...记住代号 PHOENIX-7"
   - deepseek-v4-pro: "代号复述 + 加一句 DeepSeek 风格"
   - claude-sonnet-4-6-promo-3: "代号复述 + Claude 风格"
   - gpt-5.4:        "代号复述 + GPT 风格"
   - gemini-2.5-pro: "代号复述 + Gemini 风格"
3. 每轮后 get_session_info 记录 model_id（关键断言：每轮都同步）
4. list_messages(limit=200) → 找到 5 个 sdkSession 时期的 UUID 各一个
5. 对 5 个 UUID 各做一次 fork_session(up_to_message_uuid=<UUID>)
   关键断言：5 次 fork 全部成功（Bug 4 候选循环应能处理 5 个 sdkSession）
6. 验证 5 个 forked 会话的消息数 = 各自 idx+1
```

**通过标准**: 5 轮切换 model_id 全部同步 + 5 次 fork 全部成功

---

### 矩阵 I — send_message 三模式 × 跨 provider（Bug 5 + 异步通信）

**目标**: wait/notify/fire-and-forget 三种模式 × 跨 provider 切换的组合验证。

**步骤**:
```
I1: wait=true 模式 × 跨 provider
    create_session → send_message(glm-5.2, wait=true) → send_message(deepseek-v4-pro, wait=true)
    断言: reply 正确，model_id 同步

I2: wait=false + notify 模式 × 跨 provider
    注意: notify 模式只在内部 Agent 调用有效（外部 HTTP bridge 禁用 notify=true）
    本地 MCP server 调用才能用 notify。HTTP bridge 调用只能 wait=false 纯 fire-and-forget
    实际: 测 wait=false（不带 notify），轮询 list_messages 看完成情况

I3: fire-and-forget × 跨 provider × 并发
    create_session → 同时发 3 条 wait=false 消息（model_id 各不同）
    轮询 get_session_context 看 total_tokens 变化
    断言: 不死锁，最终全部完成
```

**通过标准**: 三种模式都不死锁，跨 provider 不报错

---

### 矩阵 J — Fork × Fork（嵌套 Fork）

**目标**: Fork 出的会话能再 Fork，验证 Fork 链路稳定性。

**步骤**:
```
1. create_session(glm-5.2, title="[多维-J] 嵌套 Fork")
2. send_message 几轮（注入上下文 NESTED-OK-99）
3. fork_session(source=Y) → forked_1
4. fork_session(source=forked_1) → forked_2
5. fork_session(source=forked_2) → forked_3
6. 在 forked_3 里 send_message 问"代号？"
   断言: reply 包含 NESTED-OK-99（3 层 Fork 后上下文还在）
```

**通过标准**: 3 层嵌套 Fork 都成功 + 上下文保留

---

### 矩阵 K — 长 session × Bug 2 复检

**目标**: 重新验证 Bug 2（Fork 截断 20 轮）的真相，构造一个明确长会话做对比。

**步骤**:
```
1. create_session(glm-5.2, title="[多维-K] 长会话 Fork 对比")
2. 连续发 30 条消息（编号 1-30），每条让模型回 "REPLY-N"
3. list_messages(limit=200) → total 应为 60+（30 user + 30 assistant + results）
4. fork_session(source=X) 全量 Fork
5. list_messages(session_id=forked, limit=200) → total 应与源会话一致
   断言: |源 total - forked total| <= 2（允许 result 之类的轻微差异）
6. 如果 total 不一致 → 重现 Bug 2；如果一致 → 再次确认 Bug 2 不存在
```

**通过标准**: forked total ≈ 源 total（差 ≤ 2）

---

### 矩阵 L — 错误恢复（跨 provider 时 API 报错的处理）

**目标**: 验证补丁 H v2 在错误恢复路径下的表现。

**步骤**:
```
1. create_session(proma-official, glm-5.2, title="[多维-L] 错误恢复")
2. send_message(model_id="invalid-model-id", message="测试错误恢复")
   断言: 应报错（API 拒绝未知模型），错误信息合理
3. 紧接着 send_message(model_id="glm-5.2", message="恢复正常")
   断言: 应正常返回，不卡死
4. get_session_info → model_id 应为 glm-5.2
```

**通过标准**: 错误后能立即恢复，meta 不被错误状态污染

---

## 五、执行规范

### 1. 身份标识

- 所有测试会话标题前缀 `[多维-X]`
- send_message 的 message 开头：`我是 Proma Agent 综合测试会话（v0.16.3 多维度交叉测试），运行在 Dev 实例，正在执行矩阵 X-Y。`

### 2. 工具调用

- 走 HTTP bridge（`curl http://127.0.0.1:19876/<tool>`）
- 中文消息体 `--data-binary @file.json` 避免 cmd GBK 污染
- Python 解析用 `PYTHONIOENCODING=utf-8`

### 3. 工作流（建议用 tree-commander Skill 自我任命）

- 当前会话作为根会话（指挥官）
- 每个矩阵（H/I/J/K/L）派一个子会话并行执行（用 fork_session 或 create_session）
- 子会话用 tree-worker Skill 接收契约
- 全部完成后汇总报告

**如果 tree-commander Skill 不可用或不熟悉**，回退到串行执行也行——重要的是把 5 个矩阵都跑完。

### 4. 完成动作

1. 所有测试会话归档
2. 报告写到 `workspace-files/.context/note.md` 顶部新条目
3. 报告格式见下

### 5. 报告格式

```markdown
## 2026-06-18 v0.16.3 多维度综合测试报告

### 总览
- 矩阵 H (多 provider × 多 sdkSession fork): X/5 + Y/5 通过
- 矩阵 I (send_message 三模式 × 跨 provider): X/3 通过
- 矩阵 J (嵌套 Fork): X/3 层通过
- 矩阵 K (长会话 Fork 对比): ✅/❌
- 矩阵 L (错误恢复): ✅/❌

### 详细结果
[每个矩阵的实际操作 + 断言结果 + 关键日志]

### 关键发现
[本轮新发现的问题（如果有）]

### Smoke Test 清单（可重复执行）
[基于本轮测试整理的发布前 smoke test 步骤]

### 测试会话清单（归档前）
| session_id | 标题 | 矩阵 |
|---|---|---|

### 改进建议
```

## 六、时间预算

预计 30-45 分钟（5 个矩阵 + 报告）。如果某个矩阵阻塞超过 10 分钟，跳过并记录原因。

## 七、回报主 Agent

完成后给主 Agent（HTTP bridge 外的调用方）返回不超过 300 字的总结：
- 5 个矩阵各自结果
- 任何新发现的问题
- Smoke test 清单是否产出
