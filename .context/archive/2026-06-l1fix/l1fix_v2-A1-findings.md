# A1 反向映射审计发现

> worker: l1fix_v2-A1-reversemap | 执行时间: 2026-06-19 22:42 GMT+8 | 会话恢复版
> 审计对象: `remote-session-release-report.md` v5 (R1 审计修正版)
> 上游方案: `plan/remote-session-release-acceptance.md` v1.0
> 补充数据: `l1fix-A-test-results.md` (worker d028794b)
> 方法论: 树形多Agent终局验证 v1.0 — A1 反向映射角色

---

## 一、反向映射清单 (从报告内容反向提取覆盖)

从 v5 报告每条实质内容反向提取实际覆盖的测试点。忽略报告自身分组，以方案用例ID为锚点建立映射。

### 1.1 §三 逐工具 41 用例覆盖

| # | 方案用例 | 报告覆盖摘要 | 报告行号 | 证据等级 | 判定 |
|---|---------|------------|---------|:---:|:---:|
| 0.1 | 前置检查 — 返回有效 UUID | 返回 session_id=null（远程调用设计行为），与方案期望矛盾 | L51, L65脚注4 | ⚠️ 聚合 | ⚠️ 偏离 |
| 1.1 | list_channels — 正常调用 | 返回 4 频道 | L52 | ⚠️ 聚合 | ✅ |
| 1.2 | list_channels — 字段验证 | id/name/provider/models 完整 | L52 | ⚠️ 聚合 | ✅ |
| 2.1 | list_workspaces — 正常调用 | 返回 5 工作区，id/name 完整 | L53 | ⚠️ 聚合 | ✅ |
| 3.1 | list_sessions — 默认参数 | 聚合描述覆盖 | L54 | ⚠️ 聚合 | ✅ |
| 3.2 | list_sessions — include_archived | 聚合描述覆盖 | L54 | ⚠️ 聚合 | ✅ |
| 3.3 | list_sessions — limit=3 | 聚合描述覆盖 | L54 | ⚠️ 聚合 | ✅ |
| 3.4 | list_sessions — workspace_id | 聚合描述覆盖 | L54 | ⚠️ 聚合 | ✅ |
| 4.1 | get_my_session_id — instance="release" | 返回有效 UUID + instance 字段 | L55 | ⚠️ 聚合 | ✅ |
| 4.2 | get_my_session_id — 缺 instance | MCP -32602 校验生效 | L55 | ⚠️ 聚合 | ✅ |
| 5.1 | get_session_info — 有效 session | 返回完整字段 | L56 | ⚠️ 聚合 | ✅ |
| 5.2 | get_session_info — 无效 session | "Session not found" | L56 | ⚠️ 聚合 | ✅ |
| 5.3 | get_session_info — 中文标题 | 无乱码，"重新开始" 正确 | L56 | ⚠️ 聚合 | ✅ |
| 6.1 | get_session_context — 有消息 | 返回 input/output/total tokens | L57 | ⚠️ 聚合 | ✅ |
| 6.2 | get_session_context — 空会话 | "No usage data yet" | L57 | ⚠️ 聚合 | ✅ |
| 6.3 | get_session_context — 无效 session | 错误提示 | L57 | ⚠️ 聚合 | ✅ |
| 7.1 | list_messages — 默认参数 | 聚合描述覆盖 | L58 | ⚠️ 聚合 | ✅ |
| 7.2 | list_messages — limit=5 | 聚合描述覆盖 | L58 | ⚠️ 聚合 | ✅ |
| 7.3 | list_messages — offset=2 | 聚合描述覆盖 | L58 | ⚠️ 聚合 | ✅ |
| 7.4 | list_messages — 无效 session | 错误提示 | L58 | ⚠️ 聚合 | ✅ |
| 7.5 | list_messages — 中文内容 | 无乱码 | L58 | ⚠️ 聚合 | ✅ |
| 8.1 | create_session — channel+model+title | UUID 创建成功 | L59 | ⚠️ 聚合 | ✅ |
| 8.2 | create_session — 仅 channel | 默认模型创建成功 | L59 | ⚠️ 聚合 | ✅ |
| 8.3 | create_session — 中文 title | 持久化验证通过 | L59 | ⚠️ 聚合 | ✅ |
| 8.4 | create_session — 无效 channel | "Channel not found" | L59 | ⚠️ 聚合 | ✅ |
| 9.1 | fork_session — 基础 Fork | 全量 Fork 成功 | L60 | ⚠️ 聚合+部分锚点 | ✅ |
| 9.2 | fork_session — new_title | Bug 修复确认，但 source session_id 截断为 8 字符 | L60, L86-91 | ⚠️ 部分锚点 | ⚠️ 偏离 |
| 9.3 | fork_session — up_to_message_uuid | 截断 Fork 成功 | L60 | ⚠️ 聚合 | ✅ |
| 9.4 | fork_session — new_model_id=flash | 模型覆盖成功 | L60 | ⚠️ 聚合 | ✅ |
| 9.5 | fork_session — 无效 source | "Source session not found" | L60 | ⚠️ 聚合 | ✅ |
| 9.6 | fork_session — 上下文保留 | BLUEFOX-7749 完整保留 | L60, L104-110 | ✅ 锚点 | ✅ |
| **10.3** | **send_message — 跨 provider 模型切换 (glm→deepseek, 同 session)** | **T3 补测：MiniMax+DeepSeek 双 provider 独立可用性（两个独立 session），非同一 session 内切换** | **L61, L93-102** | **✅ T3 锚点** | **❌ 语义偏离** |
| 10.1 | send_message — wait=true | status=completed + reply | L61 | ⚠️ 聚合 | ✅ |
| 10.2 | send_message — wait=false | status=started | L61 | ⚠️ 聚合 | ✅ |
| 10.4 | send_message — 无效 session | "Target session not found" | L61 | ⚠️ 聚合 | ✅ |
| 10.5 | send_message — 中文消息 | 无乱码 | L61 | ⚠️ 聚合 | ✅ |
| 10.6 | send_message — model_id 同步 | T3 三 provider 一致性矩阵确认 | L61, L135-148 | ✅ 大部分锚点 | ✅ |
| 11.1 | archive — 归档 | list_sessions 不再出现 | L62 | ⚠️ 聚合 | ✅ |
| 11.2 | archive — include_archived 可见 | 出现在归档列表 | L62 | ⚠️ 聚合 | ✅ |
| 11.3 | archive — 反归档 | list_sessions 重新出现 | L62 | ⚠️ 聚合 | ✅ |
| 11.4 | archive — 无效 session | 错误返回 | L62 | ⚠️ 聚合 | ✅ |

**汇总**: 41/41 方案用例均有报告声称覆盖。但证据等级严重不均——聚合 34/41 (83%) vs 锚点 7/41 (17%)。2 项存在描述偏离 (0.1, 10.3)，1 项证据不完整 (9.2)。

### 1.2 §四 集成测试 3 场景覆盖

| # | 方案场景 | 报告覆盖摘要 | 报告行号 | 与方案差异 |
|---|---------|------------|---------|-----------|
| INT-1 | 场景1: 创建→send→Fork→子会话send (5步) | 步骤1-4 已覆盖。步骤5 (list_messages 计数断言: 消息数=4) **未覆盖** | L74 | ⚠️ 遗漏步骤5 |
| **INT-2** | **场景2: GLM→DS 同一 session 内 send_message 切换 (4步)** | **T3 替代: flash→pro 跨模型 Fork。三重偏差: (a)同session切换→Fork新session (b)跨频道→同频道 (c)send_message换模型→Fork换模型** | **L75, L78, L112-119** | **❌ 三重偏离** |
| INT-3 | 场景3: 归档→反归档循环 (6步) | 6 步全覆盖 | L76 | ✅ |

### 1.3 §五 回归检查 6 项覆盖

| # | 方案检查项 | 报告覆盖 | 行号 | 判定 |
|---|----------|---------|------|:---:|
| R1 | 中文返回无乱码 | ✅ 逐工具验证 | L20, L223 | ✅ |
| R2 | 11/11 工具全部可调用 | ✅ | L25, L224 | ✅ |
| R3 | JSON 解析正确 | ⚠️ 无显式字段存在性验证痕迹 | L225 | ⚠️ 部分 |
| R4 | 错误场景覆盖 (每工具 ≥1) | ✅ T3 补测补齐 | L226 | ✅ |
| R5 | 跨实例通信延迟 (记录每次调用耗时) | ⚠️ 范围值 (2-12s, <200ms)，非逐次记录 | L227, L247-263 | ⚠️ 部分 |
| R6 | 实例自动发现 | ⚠️ 无 port 解析链路显式验证 | L228 | ⚠️ 部分 |

### 1.4 §二 环境参数

| 参数 | 方案声明 | v5 报告 | 匹配 |
|------|---------|---------|:---:|
| 执行实例 | Dev port 19876 | L3: "Dev (port 19876)" | ✅ |
| 目标实例 | Release port 19877 | L3: "Release (port 19877)" | ✅ |
| 测试频道 | DeepSeek 官方 `56ecefd2` | L4 | ✅ |
| 测试模型 | deepseek-v4-pro | L4 | ✅ |
| 子会话模型 | deepseek-v4-flash | L4 | ✅ |

### 1.5 T3 扩展覆盖 (20 去重用例，全部超出方案规划范围)

| # | 扩展项 | 用例数 | 来源 (A-test) | 覆盖内容 |
|---|--------|:---:|------|---------|
| E1 | 工具1 错误用例 | 3 | M2 §2.1 | 空串/不存在/无效 instance → ERROR |
| E2 | 工具2 错误用例 | 3 | M2 §2.2 | 空串/不存在/无效 instance → ERROR |
| E3 | 工具3 错误+边界用例 | 5 | M2 §2.3 | 负limit/limit=0/负offset/不存在workspace/空串instance |
| E4 | instance="" 全11工具 (去重8) | 8 | M2 §2.4 | 含 get_my_session_id 唯一不报错发现 |
| E5 | 并发 send_message | 1 | M3 §3.1 | 2 session (DeepSeek+MiniMax) 近乎同时 (Δ588ms) |
| E6 | model vs model_id 追踪 | 1 | M3 §3.2 | 三 provider 6来源交叉一致性矩阵 |

---

## 二、方案对照表 (逐条比对)

完整 44 条方案用例 vs 反向清单覆盖比对。

| 方案用例ID | 方案核心描述 | 报告实际覆盖 | 语义匹配 | 问题类型 |
|-----------|------------|-------------|:---:|---------|
| 0.1 | get_my_session_id("release") → 有效 UUID | session_id=null（设计行为），矛盾未解决 | ⚠️ | D-01 偏离 |
| 1.1 | list_channels 正常 | 4 频道正常 | ✅ | — |
| 1.2 | list_channels 字段完整 | id/name/provider/models 完整 | ✅ | — |
| 2.1 | list_workspaces 正常 | 5 工作区，id/name 完整 | ✅ | — |
| 3.1 | list_sessions 默认参数 | 正常 | ✅ | — |
| 3.2 | list_sessions include_archived | 正常 | ✅ | — |
| 3.3 | list_sessions limit=3 | 正常 | ✅ | — |
| 3.4 | list_sessions workspace_id | 正常 | ✅ | — |
| 4.1 | get_my_session_id instance="release" | 正常 | ✅ | — |
| 4.2 | get_my_session_id 缺 instance | MCP -32602 | ✅ | — |
| 5.1 | get_session_info 有效 session | 正常 | ✅ | — |
| 5.2 | get_session_info 无效 session | "Session not found" | ✅ | — |
| 5.3 | get_session_info 中文标题 | 无乱码 | ✅ | — |
| 6.1 | get_session_context 有消息 | tokens 正常 | ✅ | — |
| 6.2 | get_session_context 空会话 | "No usage data yet" | ✅ | — |
| 6.3 | get_session_context 无效 session | 错误 | ✅ | — |
| 7.1 | list_messages 默认参数 | 正常 | ✅ | — |
| 7.2 | list_messages limit=5 | 正常 | ✅ | — |
| 7.3 | list_messages offset=2 | 正常 | ✅ | — |
| 7.4 | list_messages 无效 session | 错误 | ✅ | — |
| 7.5 | list_messages 中文内容 | 无乱码 | ✅ | — |
| 8.1 | create_session channel+model+title | 正常 | ✅ | — |
| 8.2 | create_session 仅 channel | 默认模型 | ✅ | — |
| 8.3 | create_session 中文 title | 持久化一致 | ✅ | — |
| 8.4 | create_session 无效 channel | "Channel not found" | ✅ | — |
| 9.1 | fork_session 基础 Fork | 正常 | ✅ | — |
| 9.2 | fork_session new_title | title 正确，但证据截断 | ⚠️ | D-02 偏离 |
| 9.3 | fork_session 截断 | 正常 | ✅ | — |
| 9.4 | fork_session new_model_id=flash | 正常 | ✅ | — |
| 9.5 | fork_session 无效 source | 错误 | ✅ | — |
| 9.6 | fork_session 上下文保留 | BLUEFOX-7749 正确 | ✅ | — |
| 10.1 | send_message wait=true | completed+reply | ✅ | — |
| 10.2 | send_message wait=false | started | ✅ | — |
| **10.3** | **跨 provider 切换: 同 session 内 send_message 换 model_id (glm→deepseek)** | **双独立 session (MiniMax + DeepSeek) 分别创建并通信** | **❌** | **D-03 偏离** |
| 10.4 | send_message 无效 session | 错误 | ✅ | — |
| 10.5 | send_message 中文消息 | 无乱码 | ✅ | — |
| 10.6 | send_message 后 model_id 同步 | T3 三 provider 追踪一致 | ✅ | — |
| 11.1 | archive 有效会话 | list 不再出现 | ✅ | — |
| 11.2 | archive 后 include_archived 可见 | 归档列表可见 | ✅ | — |
| 11.3 | unarchive | list 恢复 | ✅ | — |
| 11.4 | archive 无效 session | 错误 | ✅ | — |
| **INT-1** | **集成场景1: 5步完整链路** | **4/5步 (缺步骤5: list_messages 计数断言)** | **⚠️** | **O-01 遗漏** |
| **INT-2** | **集成场景2: 同 session 跨 provider 切换 (glm→deepseek, 4步)** | **Fork 跨模型 flash→pro (替代方案, 三重偏差)** | **❌** | **D-04 偏离** |
| INT-3 | 集成场景3: 归档→反归档循环 6步 | 6 步全覆盖 | ✅ | — |

---

## 三、遗漏项 (方案有明确要求，报告无对应覆盖)

### O-01: 集成场景1 步骤5 — list_messages 计数断言

| 维度 | 内容 |
|------|------|
| 方案要求 | §四 场景1 步骤5: `remote_list_messages(session_B) → 验证消息数 = 4（2 user + 2 assistant）` |
| 报告状态 | 集成表 L74 标注 "⚠️ 方案步骤5 (list_messages 计数断言) 未覆盖" |
| 影响 | 失去对 Fork 后消息历史完整性的量化校验。步骤1-4 验证了上下文传递，步骤5 验证了计数一致性 |
| 严重度 | **低** — 核心功能 (上下文保留) 已在步骤4 验证，步骤5 为完整性加固 |

### O-02: 回归检查 R5 — 逐次调用耗时记录

| 维度 | 内容 |
|------|------|
| 方案要求 | §五 R5: "记录每次调用耗时" |
| 报告状态 | 性能数据 L247-263 提供范围值和分类耗时（如 send_message 2-12s, 只读 <200ms），非逐次记录。T2 ~35 次 API 调用无逐次耗时 |
| 影响 | 无法识别偶发慢请求、无法做耗时分布分析 |
| 严重度 | **低** — 宏观性能特征已覆盖 |

### O-03: 用例 10.6 — 时序验证 vs 静态对比

| 维度 | 内容 |
|------|------|
| 方案要求 | §三 10.6: "send_message 后 get_session_info 验证 model_id 匹配**最近一次** send_message 使用的模型" |
| 报告实际 | L135-148: 三 provider 静态字段一致性矩阵（create_session参数 vs get_session_info返回 vs list_channels agent_models） |
| 差异 | 方案要求**时序验证**（send → get_session_info，确认动态更新），报告做**静态对比**（各来源字段名一致） |
| 严重度 | **建议** — 静态对比已确认字段一致性，但未验证 send_message 后 session meta 的动态更新行为 |

---

## 四、偏离项 (方案和报告都有，但描述/语义不一致)

### D-01: 用例 0.1 — session_id 期望值矛盾

| 维度 | 方案期望 | 报告实际 |
|------|---------|---------|
| 描述 | 返回有效 session_id (UUID 格式) | session_id=null 属远程调用设计行为 |
| 判定 | 方案期望非 null UUID | 报告认为 null 是设计行为，暂标记通过 |

- **行号**: 方案 L37, 报告 L51 + L65 脚注4
- **分析**: remote_get_my_session_id 在远程调用场景下返回 null 是设计行为（Dev 实例的 Agent 在 Release 实例上没有对应的本地 session）。方案的期望值与实际设计行为存在矛盾。报告脚注 [^4] 已标注并建议修正方案，但仍标记用例为通过——"矛盾未解决即通过"在验收逻辑上有争议。
- **严重度**: **中** — 方案需修正，但功能无缺陷

### D-02: 用例 9.2 — Fork new_title 证据不完整

| 维度 | 方案期望 | 报告实际 |
|------|---------|---------|
| 描述 | title 正确 | title 正确，但 source session_id 截断为 8 字符 |
| 可复现性 | 可独立验证 | 第三方无法通过 API 复现 |

- **行号**: 报告 L60, L86-91
- **分析**: Fork new_title Bug 修复确认是上次验收 (6/17) 的阻断项修复验证，但报告仅保留了 8 字符截断 ID。完整 UUID 存于 A-test 文件但未交叉引用到报告。
- **严重度**: **低** — 功能已验证，证据链待补全

### D-03: 用例 10.3 — 跨 provider 切换语义偏离 (关键)

| 维度 | 方案期望 | 报告实际 |
|------|---------|---------|
| 操作 | 同一 session 内 send_message 时切换 model_id (glm→deepseek) | 两个独立 session 分别在不同 provider 创建并通信 |
| 验证点 | 第二轮正常回复，无 [1211] 错误，上下文不丢 | 两个 provider 均可独立创建会话并通信 |
| Session 数 | 1 个 session，2 次 send_message | 2 个 session，各 1 次 send_message |

- **行号**: 方案 L116-118, 报告 L93-102
- **分析**: 报告的测试验证了"多 provider 基础设施可用性"，但**未验证方案的核心关注点：同一会话内切换模型时 (a) API 是否报错 (b) 上下文是否保留**。这是两个不同层面的问题——provider 部署配置 vs 会话引擎模型路由和上下文序列化。
- **严重度**: **严重** (归入阻断级影响——方案核心路径未覆盖)

### D-04: 集成场景2 — 三重偏离 (关键)

| 维度 | 方案期望 | 报告实际 (T3 替代) | 偏差类型 |
|------|---------|-------------------|---------|
| 切换方式 | 同一 session 内 send_message 切换 model_id | Fork 创建新 session 时指定 new_model_id | 偏差1: 同session→跨session |
| 频道 | 跨频道 (GLM→DeepSeek) | 同频道 (DeepSeek flash→pro) | 偏差2: 跨频道→同频道 |
| 模型切换路径 | send_message(model_id=deepseek-v4-pro) | fork_session(new_model_id=deepseek-v4-pro) | 偏差3: send_message参数→Fork参数 |
| 上下文传递 | 同一 session 消息历史自然保留 | Fork 复制消息历史到新 session | 机制不同 |

- **行号**: 方案 L148-155, 报告 L75 + L78 + L112-119
- **等效性判断**: **不等效**。替代方案验证了 Fork 跨模型消息复制能力；但方案的"同一会话内 send_message 切换 model_id 不丢上下文且不报错"走的是不同的代码路径（会话模型路由 + 上下文序列化 vs Fork 的消息历史复制），未被任何测试覆盖。
- **严重度**: **严重** (归入阻断级影响——方案核心路径未覆盖)

---

## 五、冗余项分析 — T3 扩展用例逐项判定: 冗余 vs 有效补充

### 判定标准

| 类别 | 定义 |
|------|------|
| **有效补充** | 方案未规划 + 填补了方案的设计盲区 + 发现了方案未预见的行为或确认了一致性 |
| **真正冗余** | 方案未规划 + 与方案已有用例重复验证同一路径 + 未发现新信息 + 可删除而不影响验收完整性 |

### 逐项判定

| # | 扩展项 | 用例数 | 判定 | 理由 |
|---|--------|:---:|:---:|------|
| E1 | 工具1 错误用例 (空串/不存在/无效 instance) | 3 | **有效补充** | 方案 §三 1.1-1.2 仅 2 个正向用例，零错误用例。填补了错误处理盲区 |
| E2 | 工具2 错误用例 (空串/不存在/无效 instance) | 3 | **有效补充** | 方案 §三 2.1 仅 1 个正向用例，零错误用例。填补了错误处理盲区 |
| E3 | 工具3 错误+边界用例 (负limit/limit=0/负offset/不存在workspace/空串instance) | 5 | **有效补充** | 方案 §三 3.1-3.4 仅正向。**负 offset 静默归零是关键发现**（中严重度数据完整性风险），方案完全未预见 |
| E4 | instance="" 全 11 工具校验 | 8 (去重) | **有效补充** | 方案未涉及 instance 参数边界。**发现 get_my_session_id 唯一不报错**（中严重度 API 契约不一致），方案未预见 |
| E5 | 并发 send_message | 1 | **有效补充** | 方案未涉及并发场景。验证了多 session 同时操作无竞态——生产环境必需属性 |
| E6 | model vs model_id 追踪 | 1 | **有效补充** | 方案仅 10.6 要求 send_message 后验证 model_id 同步。T3 扩展到三 provider 六来源交叉一致性矩阵，消除了上次验收的字段不一致疑虑 |

**结论: 0/20 真正冗余，20/20 全部为有效补充。**

原 v4 报告中 +23 含 3 项重叠（工具1/2/3 的 instance="" 被重复计入 instance="" 全工具统计），v5 已去重为 +20。重叠发生在**计数层面**（非测试执行层面），每个 instance="" 用例都是独立执行的 MCP 调用。

### 额外观察发现 (非用例，属测试过程中的行为发现)

| # | 发现 | 来源 | 冗余? | 理由 |
|---|------|------|:---:|------|
| D1 | get_my_session_id instance="" 不报错 (其他10工具均报错) | A-test M2 §2.4 | 否 | 揭示真实行为不一致 (中严重度) |
| D2 | list_sessions 负 offset 静默归零 | A-test M2 §2.3 | 否 | 揭示静默数据完整性风险 (中严重度) |
| D3 | MiniMax 频道 provider="anthropic" | A-test M1 §1.1 | 否 | 揭示 provider 字段为 API 协议层语义非模型厂商 |
| D4 | Fork 空会话报错 "no SDK session yet" | A-test 关键发现 #2 | 否 | 确认合理设计约束 |

---

## 六、重点问题深度分析

### 6.1 10.3 跨 provider 切换 — 是否真正覆盖了方案期望的"同 session 内切换"？

**直接答案: 否。**

方案 §三 10.3 的测试路径：
```
session_C: create(model=glm) → send_message → send_message(model=deepseek)  ← 同一 session
```

T3 实际执行的路径：
```
session_MiniMax: create → send_message("你是什么模型？")   ← 独立 session
session_DeepSeek: create → send_message("你是什么模型？")  ← 另一独立 session
```

关键差异：

| 维度 | 方案路径 | T3 实际 | 验证的代码路径 |
|------|---------|---------|-------------|
| Session 数 | 1 | 2 | — |
| 上下文连续性 | 第2发需读第1发的消息历史 | 无历史依赖 | 会话模型路由 vs create_session |
| 模型切换方式 | send_message 内联 model_id 覆盖 | 独立 create_session 指定 model_id | 消息级切换 vs 会话级创建 |
| 失败风险 | [1211] 错误 / 上下文丢失 / 路由失败 | provider 不可用 / session 创建失败 | 不同错误域 |

**方案 10.3 的"同 session 内跨 provider 模型切换"仍为未测试路径。**

### 6.2 集成场景2 替代方案 — 是否覆盖了方案期望的完整链路？

**直接答案: 否。三重偏差使其不等效。**

方案集成场景2 的完整链路：
```
1. create_session(model_id=glm-5.2) → session_C
2. send_message(session_C, "记住 KEY-42") → 正常
3. send_message(session_C, "KEY 是什么？", model_id=deepseek-v4-pro) → 回复含 KEY-42 且无报错
4. get_session_info(session_C) → model_id = deepseek-v4-pro (meta 已同步)
```

T3 替代链路：
```
1. create_session(model_id=deepseek-v4-flash) → session_F
2. send_message(session_F, "记住 INTEGRATION-TEST-2026") → 正常
3. fork_session(source=session_F, new_model_id=deepseek-v4-pro) → session_P
4. send_message(session_P, "代号是什么？") → 回复含 INTEGRATION-TEST-2026
5. get_session_info(session_P) → model_id=deepseek-v4-pro
```

**步骤3 是关键分歧点**: 方案是 send_message 内联切换模型（修改当前会话的运行模型），替代方案是 fork_session 创建新会话（复制消息历史到新模型会话）。两者验证的代码路径完全不同：前者走会话模型路由逻辑，后者走消息历史复制逻辑。

### 6.3 +20 扩展用例 — 有哪些是方案未规划的？

**全部 20 项均为方案未规划。但 0 项为真正冗余，全部为有效补充。**

| 类别 | 数量 | 方案是否涉及 | 发现的价值 |
|------|:---:|:---:|------|
| 工具1/2/3 错误用例 | 11 | 否 (方案对这3个工具仅正向) | 填补设计盲区，发现负offset静默归零 |
| instance="" 全工具 | 8 | 否 | 发现 get_my_session_id 唯一不报错 |
| 并发 | 1 | 否 | 验证生产级并发安全性 |
| model追踪 | 1 | 否 | 消除上次验收的字段不一致疑虑 |

原 v4 的 +23 在 v5 去重为 +20——重叠仅在计数层面（工具1/2/3 的 instance="" 被统计两次），非测试执行层面。

---

## 七、统计汇总

| 类别 | 数量 | 严重度分布 |
|------|:---:|------|
| 方案规划用例总数 | 44 | §三 41 + §四 3 |
| 完全匹配覆盖 | 38 | — |
| 偏离覆盖 | 4 | D-01(中), D-02(低), D-03(严重), D-04(严重) |
| **遗漏 (方案有，报告无)** | **3** | O-01(低), O-02(低), O-03(建议) |
| **偏离 (都有，描述不一致)** | **4** | D-01(中), D-02(低), D-03(严重), D-04(严重) |
| **真正冗余 (报告有，方案无，无价值)** | **0** | — |
| **有效补充 (报告有，方案无，有价值)** | **20** | 全部 T3 扩展用例 |
| 行为发现 (非用例) | 4 | D1(中), D2(中), D3(信息), D4(信息) |

### 严重度分布

| 严重度 | 数量 | 项 |
|:---:|:---:|------|
| 阻断 | 0 | (A1 不认定阻断——那是 A2/W 的职责) |
| 严重 | 2 | D-03 (10.3 语义偏离), D-04 (INT-2 三重偏离) |
| 中 | 1 | D-01 (0.1 期望矛盾) |
| 低 | 3 | O-01 (INT-1步骤5), O-02 (逐次耗时), D-02 (9.2证据) |
| 建议 | 1 | O-03 (10.6 时序验证) |

---

## 八、自检清单

### 质量闸 1: 逐条方案用例 vs 反向清单完整比对

- [x] §三 全部 41 用例逐条比对，每条含行号 + 证据等级 + 判定
- [x] §四 全部 3 集成场景逐条比对，含步骤级覆盖分析
- [x] §五 全部 6 回归检查项逐条比对
- [x] §二 全部 5 环境参数逐条比对
- [x] T3 全部 20 去重扩展用例逐项判定

### 质量闸 2: 遗漏/冗余/偏离各有 ≥1 个具体标注

- [x] 遗漏: O-01 (INT-1步骤5), O-02 (R5逐次耗时), O-03 (10.6时序) — 共 3 项
- [x] 冗余: 经逐项分析，0 项真正冗余，20 项全部为有效补充（已逐项说明理由）
- [x] 偏离: D-01 (0.1期望值), D-02 (9.2证据), D-03 (10.3语义), D-04 (INT-2三重偏差) — 共 4 项

### 质量闸 3: +20 扩展用例逐项判定冗余 or 有效补充

- [x] E1-E6 全部 6 个扩展领域逐项给出判定 + 详细理由
- [x] D1-D4 全部 4 个行为发现逐项给出判定 + 详细理由
- [x] 结论: 0 冗余, 20 有效补充, 4 有效发现

### 领域边界自检

- [x] 未审查数字一致性 (C1 领域) — 引用了附录A的44=41+3公式，未独立验证原始数据
- [x] 未审查格式规范性 (C3 领域) — 未检查表格命名一致性/列对齐
- [x] 未审查逻辑严密性 (C2 领域) — 未攻击推理链/因果归因
- [x] 未审查可验证性证据链 (C4 领域) — 仅标注证据等级（聚合/锚点），未独立重建验证

### 漂移声明

无漂移。严格按 A1 角色定义执行：反向映射→构建清单→方案逐项比对→标记遗漏/冗余/偏离。未越界审查 C1/C2/C3/C4 领域或攻击逻辑。

---

## 九、关键结论

1. **报告 v5 诚实标注了自身局限**：脚注 [^1]-[^5]、已知限制 #5-#9、集成表"与方案差异"列均主动披露了偏离和缺口。A1 独立反向映射确认这些标注准确、充分。

2. **方案核心路径仍有缺口**：用例 10.3 和集成场景2 的"同 session 内跨 provider 模型切换"是方案设计的关键验证点，T3 替代方案走的是不同代码路径（Fork 消息复制 vs 会话模型路由），不等效。这与报告已知限制 #5 一致，是当前 NOT APPROVED FOR RELEASE 的核心原因。

3. **T3 扩展零冗余**：全部 20 个去重扩展用例均为有效补充——填补了方案对工具1/2/3零错误用例、instance 参数边界、并发安全性、字段一致性等维度的设计盲区，且发现 2 个中严重度行为不一致。

4. **方案 0.1 期望值需修正**：remote_get_my_session_id 在远程调用场景下返回 null 是设计行为，方案 §三 0.1 要求"返回有效 UUID 格式"与实际行为矛盾。这是方案层面的问题，建议方案 v1.1 修正期望值或增加远程场景说明。
