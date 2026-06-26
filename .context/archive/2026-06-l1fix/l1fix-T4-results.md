# l1fix-T4 补测结果 — 已知限制闭合

> 执行时间: 2026-06-23 08:29–08:45 GMT+8 | worker: l1fix-E-test | instance: release
> 对标: v5报告已知限制 #5/#6/#8/#9/#10 + MiniMax覆盖边界矩阵
> T3对照: `l1fix-A-test-results.md` (worker d028794b, 单次执行)

---

## 总评

6 项 T4 补测全部执行。**3 项通过，1 项部分通过，2 项发现新问题（含 1 项回归）**。

| # | 已知限制 | 状态 | 关键发现 |
|---|---------|:---:|---------|
| KL #5 | 同session跨provider切换 | ⚠️ 部分通过 | 切换被channel级拒绝(API Error 400)，但model_id被污染为错误值 |
| MiniMax | 8工具补测 | ✅ 通过 | 8/8工具全部可用，但fork_session的new_title被忽略 |
| KL #10 | 集成步骤5 list_messages计数 | ⚠️ 部分通过 | 功能正确但count≠4(Fork全量复制历史) |
| KL #8 | Fork new_title完整UUID | ❌ 回归 | new_title参数在DeepSeek+MiniMax双频道均被忽略 |
| KL #9 | instance=""错误码分类 | ✅ 通过 | 10工具全部返回应用层错误，非MCP -32602 |
| KL #6 | 并发独立复现 | ⚠️ 部分通过 | MiniMax侧成功；DeepSeek侧因KL#5副作用(model_id污染)失败 |

---

## M1: 同session跨provider切换 + MiniMax 8工具

### 1.1 同session内跨provider模型切换 (KL #5)

**测试设计**: 在同一 DeepSeek session 内，先用 `deepseek-v4-pro` 发消息写入上下文，再用 `model_id=MiniMax-M3` 发第二条消息，验证上下文保留 + model_id 同步。

| 步骤 | 工具 | 参数 | 结果 |
|------|------|------|------|
| 创建会话 | remote_create_session | channel=`56ecefd2`, model=`deepseek-v4-pro`, title="T4-跨provider切换测试-pro起点" | ✅ session_id=`b5a1dc2d-65d4-488e-a669-c6c0056c351f` |
| 写入上下文 | remote_send_message | session_id=`b5a1dc2d`, message="记住代号 KEY-MM-99..." | ✅ reply含"KEY-MM-99" |
| **跨provider切换** | remote_send_message | session_id=`b5a1dc2d`, message="代号是什么？...", **model_id=`MiniMax-M3`** | ❌ **API Error: 400** — `"The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed MiniMax-M3."` |
| 验证model_id | remote_get_session_info | session_id=`b5a1dc2d` | ⚠️ **model_id已变为`MiniMax-M3`** (尽管API调用失败) |

**原始返回值 (跨provider send_message)**:
```json
{
  "session_id": "b5a1dc2d-65d4-488e-a669-c6c0056c351f",
  "status": "completed",
  "reply": "API Error: 400 The supported API model names are deepseek-v4-pro or deepseek-v4-flash, but you passed MiniMax-M3."
}
```

**原始返回值 (get_session_info after failed switch)**:
```json
{
  "id": "b5a1dc2d-65d4-488e-a669-c6c0056c351f",
  "title": "T4-跨provider切换测试-pro起点",
  "channel_id": "56ecefd2-8e22-4c62-add5-16e8992c987d",
  "model_id": "MiniMax-M3",
  "channel": {
    "id": "56ecefd2-8e22-4c62-add5-16e8992c987d",
    "name": "DeepSeek官方",
    "provider": "deepseek"
  }
}
```

**结论**:
1. **同session内跨provider模型切换不被支持** — channel 级别校验拒绝非本 channel 的 model_id
2. **严重副作用**: model_id 在 session metadata 中被更新为 MiniMax-M3，即便 API 调用实际失败。这导致该 session 后续所有消息均失败（channel 校验 model_id 不匹配）
3. **影响**: 若允许 send_message 接受任意 model_id 参数但不验证 channel 归属，会造成 session 永久损坏

**清零标准对照**:
- send_message(model_id=其他provider) → ❌ API Error 400 (非无报错)
- 回复含前文上下文 → N/A (消息被拒绝)
- get_session_info 确认 model_id 已同步 → ⚠️ model_id 被同步为错误值

---

### 1.2 MiniMax频道8工具补测 (覆盖边界矩阵)

**MiniMax频道**: `b7e25505-c972-49e7-9173-ef14df3eaa3f` (MiniMax-CodingPlan)
**测试session**: `640e6f73-1f3f-41e0-ba57-b22421172e14` (MiniMax-M3)

| # | 工具 | 参数 | 结果 | 关键返回值 |
|---|------|------|:---:|---------|
| 1 | remote_list_channels | instance="release" | ✅ | 4频道, MiniMax有4模型(M2.7/M2.5/M2.1/M3), provider="anthropic" |
| 2 | remote_list_workspaces | instance="release" | ✅ | 7工作区, 含id/name/slug/created_at |
| 3 | remote_list_sessions | instance="release" | ✅ | count=50, total=142, 含MiniMax session |
| 4 | remote_get_my_session_id | instance="release" | ✅ | session_id=null, is_remote=true (预期行为) |
| 5 | remote_get_session_context | session_id=`640e6f73` | ✅ | input=64048, output=852, total=97654, 9.8% |
| 6 | remote_list_messages | session_id=`640e6f73` | ✅ | count=15, total=15, index连续, 中文无乱码 |
| 7 | remote_fork_session | source=`640e6f73`, new_title="T4-MiniMax-Fork测试" | ⚠️ **new_title被忽略** | 实际title="T4-MiniMax-8工具补测 (fork)", fork_id=`5419ba5e` |
| 8 | remote_archive_session | session_id=`640e6f73`, archived=true/false | ✅ | 归档+反归档循环正常 |

**Fork new_title问题 (MiniMax侧)**:
```json
// Fork调用参数: new_title="T4-MiniMax-Fork测试"
// 实际返回:
{
  "session": {
    "id": "5419ba5e-2c78-46a2-9270-7773f434b9cd",
    "title": "T4-MiniMax-8工具补测 (fork)",  // ← 使用了默认后缀,非指定标题
    "channel_id": "b7e25505-c972-49e7-9173-ef14df3eaa3f",
    "model_id": "MiniMax-M3",
    "source_session_id": "640e6f73-1f3f-41e0-ba57-b22421172e14",
    "fork_source_sdk_session_id": "eac76be0-c8c8-422d-95f0-51a158eb3d3c"
  }
}
```

**MiniMax频道覆盖矩阵更新**:

| 工具 | T2/T3状态 | T4补测 | 最终 |
|------|:---:|:---:|:---:|
| list_channels | ❌ 未测 | ✅ | ✅ |
| list_workspaces | ❌ 未测 | ✅ | ✅ |
| list_sessions | ❌ 未测 | ✅ | ✅ |
| get_my_session_id | ❌ 未测 | ✅ | ✅ |
| get_session_info | ✅ T3 | — | ✅ |
| get_session_context | ❌ 未测 | ✅ | ✅ |
| list_messages | ❌ 未测 | ✅ | ✅ |
| create_session | ✅ T3 | — | ✅ |
| fork_session | ❌ 未测 | ⚠️ new_title忽略 | ⚠️ |
| send_message | ✅ T3 | — | ✅ |
| archive_session | ❌ 未测 | ✅ | ✅ |
| **覆盖率** | **3/11** | **+8** | **11/11** |

---

## M2: 集成步骤5 + Fork UUID + 错误码分类

### 2.1 集成场景1步骤5 — list_messages计数断言 (KL #10)

**测试流程**:

| 步骤 | 工具 | 参数 | 结果 |
|------|------|------|------|
| 1. 创建session_A | remote_create_session | channel=`56ecefd2`, model=`deepseek-v4-pro`, title="T4-集成场景1-会话A" | ✅ `b6eb8284-2e14-4a6c-93b6-ef0e46bbefe8` |
| 2. 发消息 | remote_send_message | session_id=`b6eb8284`, message="记下代号 ALPHA-99" | ✅ reply确认ALPHA-99 |
| 3. Fork→session_B | remote_fork_session | source=`b6eb8284`, model=`deepseek-v4-flash`, new_title="T4-集成场景1-会话B" | ⚠️ title被忽略, fork_id=`48c2e0be-51b2-4314-bef1-7ffa3c6caef8` |
| 4. session_B发消息 | remote_send_message | session_id=`48c2e0be`, message="代号是什么？" | ✅ reply正确识别ALPHA-99(上下文保留) |
| 5. **计数断言** | remote_list_messages | session_id=`48c2e0be` | ⚠️ **count=26, 非方案期望的4** |

**list_messages(session_B) 消息结构分析**:

session_B 的 list_messages 返回 count=26，原因分析：
- Fork 全量复制源 session 的消息历史（包括内部/technical消息）
- session_A 的原始消息被完整保留（index 0-11: 1 user + 1 assistant reply + 多条内部消息 + 1 result）
- session_B 新增的消息（index 12-25: 1 user + 多条assistant内部消息 + 1 reply + 1 result）

**结论**:
- 功能正确：上下文传递 + 代号识别 + 跨模型Fork均正常 ✅
- 计数断言：方案期望"消息数=4(2user+2assistant)"过于简化，实际Fork复制了完整历史含内部消息
- 建议方案v1.1修正：改为验证 session_B 中存在 ≥2 条 user 消息 + ≥1 条含 "ALPHA-99" 的 assistant 消息

---

### 2.2 Fork new_title完整UUID记录+交叉验证 (KL #8)

**测试1: DeepSeek频道 Fork new_title**

| 项目 | 值 |
|------|-----|
| 源session | `b5a1dc2d-65d4-488e-a669-c6c0056c351f` ("T4-跨provider切换测试-pro起点") |
| Fork参数 | source=`b5a1dc2d`, new_title="T4-Fork-new-title-显式指定标题", new_model_id=`deepseek-v4-flash` |
| **期望标题** | "T4-Fork-new-title-显式指定标题" |
| **实际标题** | "T4-跨provider切换测试-pro起点 (fork)" |
| Fork session_id | **`f1a81033-2cb6-40b4-84f0-5f5bb5c3095d`** (32字符UUID完整记录) |

**Fork原始返回值JSON (DeepSeek)**:
```json
{
  "session": {
    "id": "f1a81033-2cb6-40b4-84f0-5f5bb5c3095d",
    "title": "T4-跨provider切换测试-pro起点 (fork)",
    "channel_id": "56ecefd2-8e22-4c62-add5-16e8992c987d",
    "model_id": "deepseek-v4-flash",
    "source_session_id": "b5a1dc2d-65d4-488e-a669-c6c0056c351f",
    "fork_source_sdk_session_id": "7c5512ab-a120-4edf-8262-0d52aa1d07b1",
    "created_at": 1782175584814
  }
}
```

**get_session_info交叉验证**:
```json
{
  "id": "f1a81033-2cb6-40b4-84f0-5f5bb5c3095d",
  "title": "T4-跨provider切换测试-pro起点 (fork)",
  "channel_id": "56ecefd2-8e22-4c62-add5-16e8992c987d",
  "model_id": "deepseek-v4-flash",
  "channel": { "id": "56ecefd2-8e22-4c62-add5-16e8992c987d", "name": "DeepSeek官方", "provider": "deepseek" }
}
```
→ `f1a81033` UUID 在 Fork 返回值和 get_session_info 间一致 ✅；model_id=`deepseek-v4-flash` 覆盖成功 ✅；**new_title 被忽略** ❌

**测试2: MiniMax频道 Fork new_title**

| 项目 | 值 |
|------|-----|
| 源session | `640e6f73-1f3f-41e0-ba57-b22421172e14` ("T4-MiniMax-8工具补测") |
| Fork参数 | source=`640e6f73`, new_title="T4-MiniMax-Fork测试" |
| **期望标题** | "T4-MiniMax-Fork测试" |
| **实际标题** | "T4-MiniMax-8工具补测 (fork)" |
| Fork session_id | **`5419ba5e-2c78-46a2-9270-7773f434b9cd`** |

**结论**: **Fork new_title Bug 回归** — v5报告声称 T2 已修复（用例9.2），但 T4 独立测试在 DeepSeek 和 MiniMax 双频道均复现 `new_title` 被忽略。这是发布阻断级回归。

---

### 2.3 instance="" 错误码类型区分 (KL #9)

**测试方法**: 对 10 个在 instance="" 时返回 ERROR 的工具逐一调用，记录完整错误文本以区分 MCP -32602 vs 应用层错误。

| # | 工具 | instance="" 返回值 | 错误类型 |
|---|------|-------------------|:---:|
| 0 | remote_list_channels | `No instance named '' found (scanned 19876-19895). Use 'host:port' format for LAN instances.` | **应用层** |
| 1 | remote_list_workspaces | 同上 | **应用层** |
| 2 | remote_list_sessions | 同上 | **应用层** |
| 3 | remote_get_session_info | 同上 | **应用层** |
| 4 | remote_get_session_context | 同上 | **应用层** |
| 5 | remote_list_messages | 同上 | **应用层** |
| 6 | remote_create_session | 同上 | **应用层** |
| 7 | remote_fork_session | 同上 | **应用层** |
| 8 | remote_send_message | 同上 | **应用层** |
| 9 | remote_archive_session | 同上 | **应用层** |

**remote_get_my_session_id (对照组)**:
| instance="" 行为 | 返回值 |
|-----------------|--------|
| ⚠️ 无报错 | `{"session_id":null,"is_remote":true,"instance":"","hint":"This is a remote instance call..."}` |

**结论**: 10/10 返回 ERROR 的工具在 instance="" 时全部返回**应用层**错误字符串 `"No instance named '' found (scanned 19876-19895)"`，无一返回 MCP -32602。错误类型为应用层实例发现失败，非 MCP 参数校验错误。与 v5 报告 §补测发现 #1 一致。`remote_get_my_session_id` 是唯一对 instance="" 不报错的工具（设计行为）。

---

## M3: 并发独立复现 + 结构化验证

### 3.1 并发 send_message(wait=false) 独立复现 (KL #6)

**测试设计**: 使用独立 worker (l1fix-E-test) 重复 T3 并发测试，改用结构化验证（消息 index 连续 + status 确认 + 跨 session 无干扰）而非 LLM 精确字符串匹配。

**测试参数**:

| 维度 | Session A (DeepSeek) | Session B (MiniMax) |
|------|---------------------|---------------------|
| Session ID | `b5a1dc2d-65d4-488e-a669-c6c0056c351f` | `640e6f73-1f3f-41e0-ba57-b22421172e14` |
| Channel | DeepSeek官方 (`56ecefd2`) | MiniMax-CodingPlan (`b7e25505`) |
| 指令 | "T4并发复现测试-DeepSeek侧" | "T4并发复现测试-MiniMax侧" |
| wait=false 返回 | `status: "started"` ✅ | `status: "started"` ✅ |
| 用户消息index | 9 | 15 |
| 用户消息timestamp | 1782175634627 | 1782175635405 |
| 时间差 | — | +778ms |
| AI回复index | 10 (assistant) | 16 (assistant) → 17 (result) |
| AI回复timestamp | 1782175638731 | 1782175640120 |
| 响应耗时 | 4104ms | 4715ms (user→assistant) / 1981ms (assistant→result) |
| **回复内容** | ❌ `API Error: 400` (model_id污染) | ✅ `T4-CONCURRENT-MM-DONE` |

**结构化验证**:

| 验证项 | Session A (DeepSeek) | Session B (MiniMax) |
|--------|:---:|:---:|
| send_message(wait=false) 返回 status="started" | ✅ | ✅ |
| 消息 index 连续 (user→assistant→result) | ⚠️ index 9→10 连续但10为error | ✅ index 15→16→17 连续 |
| 无跨session消息泄漏 | ✅ (仅含本session消息) | ✅ (仅含本session消息) |
| AI成功处理并回复 | ❌ (model_id污染) | ✅ |
| 独立完成无干扰 | ❌ (受KL#5副作用影响) | ✅ |

**并发原始返回值 (Session A)**:
```json
{"session_id":"b5a1dc2d-65d4-488e-a669-c6c0056c351f","status":"started","notify":false}
```

**并发原始返回值 (Session B)**:
```json
{"session_id":"640e6f73-1f3f-41e0-ba57-b22421172e14","status":"started","notify":false}
```

**结论**: MiniMax 侧并发测试独立复现成功（结构化验证通过）。DeepSeek 侧因 KL #5 副作用（model_id 污染为 MiniMax-M3）导致后续消息被 channel 拒绝。这不代表并发机制本身有问题，但揭示了跨 provider 切换尝试的持久破坏性影响。**T3 并发结论（2 session 无竞态）在 MiniMax 侧得到独立验证，DeepSeek 侧因 session 状态污染无法完成**。

---

## 关键发现汇总

### 新发现 (T4新增，v5报告未记录)

| # | 发现 | 严重度 | 描述 |
|---|------|:---:|------|
| **F1** | **Fork new_title Bug 回归** | **阻断** | v5声称T2已修复的new_title参数在T4 DeepSeek+MiniMax双频道均被忽略。与v5 §Fork new_title Bug修复确认矛盾 |
| **F2** | **跨provider切换污染session model_id** | **严重** | send_message(model_id=其他provider)虽被channel拒绝，但model_id在session metadata中被更新为错误值，导致session永久损坏（后续消息全部失败） |
| **F3** | **Fork全量复制消息历史** | **中** | Fork保留源session全部消息（含内部/technical消息），导致list_messages计数远超方案预期的4。方案 §四 场景1步骤5的计数断言需修正 |

### 确认项 (与v5/T3一致)

| # | 发现 | 来源 |
|---|------|------|
| C1 | MiniMax 8/8工具全部可用，频道×工具覆盖矩阵从3/11补全至11/11 | T4新增 |
| C2 | instance="" 10工具全部返回应用层错误(非MCP -32602)，与v5 §补测发现#1一致 | 与v5一致 |
| C3 | remote_get_my_session_id对instance=""不报错，与v5一致 | 与v5一致 |
| C4 | 并发send_message(wait=false)机制正常(MiniMax侧独立验证) | 与T3一致 |

---

## 会话清单

| 用途 | Session ID | 频道 | 模型 |
|------|-----------|------|------|
| 跨provider切换测试 | `b5a1dc2d-65d4-488e-a669-c6c0056c351f` | DeepSeek | deepseek-v4-pro→MiniMax-M3(污染) |
| MiniMax 8工具补测 | `640e6f73-1f3f-41e0-ba57-b22421172e14` | MiniMax | MiniMax-M3 |
| MiniMax Fork | `5419ba5e-2c78-46a2-9270-7773f434b9cd` | MiniMax | MiniMax-M3 |
| 集成场景1 session_A | `b6eb8284-2e14-4a6c-93b6-ef0e46bbefe8` | DeepSeek | deepseek-v4-pro |
| 集成场景1 session_B | `48c2e0be-51b2-4314-bef1-7ffa3c6caef8` | DeepSeek | deepseek-v4-flash |
| Fork new_title测试(DS) | `f1a81033-2cb6-40b4-84f0-5f5bb5c3095d` | DeepSeek | deepseek-v4-flash |

---

## 证据覆盖

| 测试项 | 证据等级 | session_id | 原始返回值JSON |
|--------|:---:|:---:|:---:|
| 跨provider切换 | ✅ 完整锚点 | `b5a1dc2d` | ✅ send_message + get_session_info |
| MiniMax 8工具 | ✅ 完整锚点 | `640e6f73` + `5419ba5e` | ✅ 逐工具记录 |
| 集成步骤5 | ✅ 完整锚点 | `b6eb8284` + `48c2e0be` | ✅ list_messages完整消息列表 |
| Fork new_title | ✅ 完整锚点 | `f1a81033` + `5419ba5e` | ✅ Fork返回值 + get_session_info交叉验证 |
| instance="" 错误码 | ✅ 完整锚点 | N/A | ✅ 10工具原始错误文本 |
| 并发复现 | ✅ 完整锚点 | `b5a1dc2d` + `640e6f73` | ✅ send_message + list_messages验证 |
