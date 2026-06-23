# Proma 技术 Wiki（精简版）

> 完整 Wiki 维护在本地 workspace-files，本文是面向 GitHub 发布的精简版。

## 核心原则

**不可从开源源码重构建 main.cjs**：商业版有 15 个闭源模块（cloudAuth/sync/billing），源构建会导致登录失败。

**正确方式**：商业版 main.cjs + sed 补丁 + 插件文件

## 补丁清单

### 基础补丁
| 补丁 | 功能 | sed 命令 |
|---|---|---|
| 1 | DeepSeek 子Agent → v4-pro | `s/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-flash"/DEEPSEEK_SUBAGENT_MODEL_ID = "deepseek-v4-pro"/g` |
| 2 | PROMA_DEV 隔离 | `s/if (!\(import_electron[0-9]*\)\.app\.isPackaged) {/if (!\1.app.isPackaged \|\| process.env.PROMA_DEV === "1") {/g` |
| 3 | 托盘图标白色 | `s/"iconTemplate.png"/"proma-white.png"/g` |
| 4 | 版本号校正 | 改 `package.json` |

### 插件系统补丁
| 补丁 | 功能 | 注入点 |
|---|---|---|
| A | MCP 钩子 | `sendMessage()` 中 `const dynamicCtx` 之前 |
| B | API 桥接 + require 插件 | `init_index()` 之后 |
| B2 | runAgentHeadless 桥接 | 扩展补丁 B |
| B3 | listAgentWorkspaces 桥接 | 扩展补丁 B |
| C1-5 | 频道/模型元数据覆盖 | `sendMessage()` 多处 |
| D | Renderer 版本同步 | 升级时整体替换 |
| E | 移除 hydration 幂等守卫 | renderer JS 中 `if(qe.has(e))return qe;` |

## 插件工具（10 个）

| 工具 | 功能 |
|---|---|
| `get_my_session_id` | 获取当前会话 ID |
| `list_channels` | 列出 AI 渠道 |
| `list_workspaces` | 列出工作区 |
| `list_sessions` | 列出 Agent 会话 |
| `get_session_info` | 会话详情 |
| `get_session_context` | Token 用量（含上下文窗口/使用率） |
| `list_messages` | 消息历史（分页，含 UUID） |
| `create_session` | 创建新会话 |
| `fork_session` | Fork 会话 |
| `send_message` | 向目标会话发消息（3 种模式） |

## 版本历史

| 版本 | 日期 | 改动 |
|---|---|---|
| v0.6 | 2026-06-15 | 插件模式 POC |
| v0.7 | 2026-06-15 | UI 模型同步 |
| v0.8 | 2026-06-15 | get_session_context 工具 |
| v0.9 | 2026-06-16 | 外部 MCP 服务（HTTP bridge + stdio） |
| v0.10 | 2026-06-16 | send_message + list_messages + 多工作区 |
| v0.10.1 | 2026-06-16 | 10 工具体系 + 完整验证 |
| v0.11 | 2026-06-17 | remote-session 11 工具 (提案阶段2) + 实例命名体系 |

## 树形 UI 浮窗补丁（patch-L/M/M+）

> 独立补丁系列，叠加在插件系统补丁之上。源码发布在 `release/tree-system-v0.2.2/patch-l/`，5 个文件直接 cp 到 `D:/Proma-dev/resources/app/dist/`。

| 版本 | 日期 | 改动 |
|---|---|---|
| patch-L v0.1 | 2026-06-21 | 树形 UI 面板首版（IPC + 浮窗 + fallback 按钮） |
| patch-M v0.1 | 2026-06-22 | TAO Watcher 脚本主导重写（5min interval + nudge + audit-gate） |
| patch-M+ v0.2 | 2026-06-22 | 树面板重写为可调节浮窗 + 真正切换会话（tray:open-agent-session IPC） |
| patch-M+ v0.2.1 | 2026-06-22 | 修复数据混杂 — 按 workspace 分组返回（IPC 用 discoverAllWorkspacesWithTrees） |
| patch-M+ v0.3 | 2026-06-22 | 入口按钮精准注入（每个 .group/project 项目行 absolute 定位 right:60px）+ DOM dump 工具（proma:dom-dump IPC，preload 白名单） |
| patch-M+ v0.3.1 | 2026-06-22 | IPC 加 instance filter（ISOLATED → ~/.proma-dev，否则 ~/.proma）避免跨实例显示 + 清理临时 debug labels |
| patch-M+ v0.4 | 2026-06-22 | 入口按钮记忆 workspace_slug（React fiber + textContent 反查兜底）→ 点击从哪个项目进就激活哪个 workspace + 活跃 tree 排顶 + 不活跃 tree 标灰 |
| patch-M+ v0.4.1 | 2026-06-22 | 修两层 tab 完整显示: IPC 返回所有 workspace(含 name 不再过滤空) + UI 总是显示第一层 workspace tab + 空 workspace 标灰 |
| patch-M+ v0.4.2 | 2026-06-22 | 修第一层只显示 1 个 workspace 的 bug: discoverAllWorkspacesWithTrees 不再强制要求 trees 目录存在, 5 个 workspace 都返回 |
| patch-M+ v0.4.3 | 2026-06-22 | 第二层 tab 按最近活动时间倒排 (IPC 加 latest_activity_ts=max(last_heartbeat, leaves[].last_event_ts, created_at, mtime)) + 🌳 按钮 onClick dump React props 调试入口定位 |
| patch-M+ v0.4.4 | 2026-06-23 | 修入口定位: 基于 dump 真实数据用 3 重保险拿 slug (aria-controls UUID + React props.group.workspace.slug + textContent 反查), 加 workspaceIdToSlug 缓存 |
| patch-M+ v0.4.5-a | 2026-06-23 | 修入口定位 race condition: `makeEntryBtn.onClick` 不再用闭包 slug (注入时 React fiber 可能未就绪 → slug=null), 改为每次点击时从 DOM 重新调 `getWorkspaceSlugFromProjectGroup`, 闭包值只作兜底 |
| patch-M+ v0.4.5-b | 2026-06-23 | 修排序 mtime 干扰: `readTreesFromDir` 算 `latest_activity_ts` 去掉 mtimeMs 参与 (mtime 是文件系统时间, watcher 跑过会让不活跃 tree 顶上来), 只在业务字段 (last_heartbeat / created_at / leaves[].last_event_ts) 全空时退化用 mtime |

### v0.4.4 验证结果 (2026-06-23)

| 验证点 | 结果 | 根因 |
|---|---|---|
| 两层 tab 联动 | ✅ 通过 | - |
| 入口定位 (从某项目 🌳 进激活该 workspace) | ❌ 10 次只 1 次生效 | injectEntryButton 注入时 fiber 可能没准备好 (DOM 刚渲染), slug=null → MutationObserver 重试时已注入直接 return, slug 永不更新. 修复方向: onClick 时重新调 getWorkspaceSlugFromProjectGroup (点击时 fiber 一定准备好了) |
| 第二层按最近活动时间倒排 | ❌ 排错 | latest_activity_ts 用 max(leaves.last_event_ts, last_heartbeat, created_at, mtime), 但 **mtime 是文件系统时间**, watcher 跑过会更新文件让 mtime 变很新, 把不活跃 tree 顶上来. 修复方向: 去掉 mtime, 只用业务时间字段 (last_event_ts / last_heartbeat / created_at) |

### v0.4.5 修复 (2026-06-23, 已验证)

| 修复点 | 修法 | 文件 | 验证结果 |
|---|---|---|---|
| 入口定位 race condition (问题 A) | `makeEntryBtn.onClick` 不用闭包 slug, 每次从 DOM 重新调 `getWorkspaceSlugFromProjectGroup`, 闭包值只作兜底 | proma-tree-view.js | ✅ 通过 (不同 workspace 的 🌳 进去都能正确激活) |
| 排序 mtime 干扰 (问题 B) | `readTreesFromDir` 的 `latest_activity_ts` 不再以 mtimeMs 作初值, 只在业务字段全空时退化用 mtime | proma-dev-patches.cjs | ❌ 仍未解决 — 业务时间倒排仍然不对, 用户反馈第二层 tab 顺序不符合"活跃 tree 排前" |

### 问题 B 未解决 - 待重新诊断 (2026-06-23, 暂不改)

用户反馈问题 B 的修复无效, 第二层 tab 排序仍然不对 (活跃 tree 没排到前面).

可能的新根因方向 (待用户复测后再诊断, **本次未改代码**):
- 业务时间字段本身不准: `last_heartbeat` 可能被 watcher 周期性刷新, 反而比真实 `last_event_ts` 更新

## Tree 体系阶段测试报告 (2026-06-23)

> 完整报告: `.context/audit/2026-06-23-test-summary.md`
> 来源: 用户在"tree 测试 1/2"workspace 实测 commander/worker 体系跑 mdref/pytut 两棵树, 派审计 Agent 出 2 份文档:
> - `.context/audit/2026-06-23-mdref-pytut-tao-audit.md` (启动会话视角, 35 条规则覆盖矩阵)
> - `.context/note.md` 顶部 (元审计 Agent 综合归纳)
> 分析方法: 3 个子 Agent 从工程/方法论/综合对比三个角度独立归纳

### 整体结论

**Tree 体系处于"形式闭环、实质不闭环"的 v0.1 阶段, 不能上生产.**

- ✅ 流程能跑通: 契约下发、event 路由、drift 记录、文件产出
- ❌ **审计链路是伪链路**: commander 自审自过、声称产出但文件未落盘也 pass、零独立审查 leaf
- ❌ 软约束没硬护栏: skill 文档里的"应当"在 tree-state.js 层未升级为"必须"

### 共性确认问题 (两份文档独立得出, P0/P1)

| ID | 问题 | 严重度 | 修复方向 |
|---|---|---|---|
| CP1 | 声称产出文件未落盘但 audit pass (A1/B1) | 🔴 critical | `leaf set-status done` 加 fs.existsSync 校验 expect_outputs |
| CP2 | 零独立审查 leaf (auditor_session_id 全 null 或等于 commander) | 🔴 critical | `audit-gate` 加独立性校验 `auditor_session_id !== added_by && !== root_session_id` |
| CP3 | commander 自做根因诊断 + 自填对齐度 (违反铁律 1) | 🟡 high | alignment 字段从 Agent 输出注入, 禁止 commander 自填 |
| CP4 | 节点数失控 (14 > 10 上限) | 🟡 high | `leaf add` 加 --max-leaves (默认 10) |
| CP5 | self_check 字段格式不合规 (W-05/W-06 全员 fail) | 🟡 mid | done 上行 schema 校验 |
| CP6 | validate 失败仍续跑 + 收尾 | 🟡 high | `tree set-status archived` 强制 validate ok |

### 单文档独有但可信 (中置信度)

- SP1: audit 时序倒填 (A1 audit 比 plan 早 0.3 秒)
- SP2: chapter-02 correction_round=1 是假的 (磁盘只第一版)
- SP3: root session_id 全程 PENDING_ROOT 未修
- SP4: commander idx 369 error_during_execution, context 671% 无预警
- SP5: C-12 双轨违背 (drift_log 明文 "switching to Agent-based execution")
- SP6: 三档纠偏跳级, 未 drift append 即动作
- SP7: W-10/W-13 全员 fail

### 待核实 (低置信度)

- UC1: commander 消息流"无可识别 Agent 调用痕迹" (list_messages 不暴露 tool_use 块)
- UC2: "switching to Agent-based execution" 具体语义 (绕过 worker vs 仅换 fork)
- UC3: tao-watcher 是否真未启动 (字段为 null vs 实际未跑)

### v0.5 计划诊断

**v0.5 完全没碰到审计核心**, 建议:

1. 新建 **Phase 6 (审计机制硬约束, P0 最高优先级)**, 8 个子步骤对应 CP1-CP6 + SP1 + SP4
2. Phase 1 (剪枝语义) 降为 P1, 与 Phase 6 并行
3. **Phase 3 简化**: 不改 setTimeout (审计没提 interval 问题), 只加 silence_minutes + status IPC
4. **migrate-existing-workspaces 改不覆盖策略** (避免覆盖用户手改)

### 子 Agent 分析依据

3 份子 Agent 报告 (工程/方法论/综合对比) 结论**惊人一致**, 互补可信, 无矛盾. 详见完整报告.

## 专家组审议包 (2026-06-23)

> 完整目录: `.context/expert-review-2026-06-23/`
> 用途: 用户召开专家组审议 v0.6 修订计划, 自包含讨论包

| 文件 | 内容 |
|---|---|
| `00-handoff.md` | 交接文件 (项目背景 + 现状 + 7 个决议题) |
| `01-test-summary.md` | 测试报告核心结论 (CP1-CP6) |
| `02-current-v0.5-plan.md` | 现有 v0.5 计划 (已批准的 4 个 bug 修复) |
| `02b-current-v0.5-architecture-fixes.md` | v0.5 调研过程 |
| `03-v0.6-revised-plan-draft.md` | **v0.6 修订计划草稿 (核心讨论稿)** |
| `04-source-tao-audit.md` | 原始 TAO 审计报告 (35 条规则覆盖矩阵) |
| `05-source-meta-audit.md` | 元审计 Agent 综合报告 |
| `README.md` | 专家组导读 |

### v0.6 修订核心 (待专家组审议)

1. **新建 Phase 6 (审计机制硬约束), P0 最高优先级** — 8 个子步骤对应 CP1-CP6 + SP1 + SP4
2. **Phase 1 (剪枝语义) 降 P1**, 与 Phase 6 并行
3. **Phase 3 (watcher) 大幅简化** — 去掉 setTimeout 重构, 只加 silence_minutes 字段
4. **migrate-existing-workspaces 改不覆盖策略**

### 7 个待决议题

1. Phase 6 是否应该作为 P0?
2. Phase 6 是 8 步一次性做, 还是只做 P0 两步先看效果?
3. migrate 策略: 强制 vs 只对新 tree 生效?
4. commander 行为问题: 硬校验让 commander 卡死时是否回退?
5. Proma 平台层 Agent 凭证缺失: 先推平台改造还是先工具层 hack?
6. Phase 3 是否完全不动 watcher 代码?
7. Phase 6 完成后怎么验证?

详见 `expert-review-2026-06-23/00-handoff.md` §6.

- `created_at` 是 tree 创建时间而非最后活动时间, 不该参与"最近活动"判断
- 浮窗 UI 排序逻辑可能根本没用 `latest_activity_ts`, 而是 fallback 到别的字段 (如 `created_at`)
- tree-state.json 里 `leaves[].last_event_ts` 字段缺失或格式不一致
- 排序比较方向反了 ( ascending ↔ descending )

下一步: 需要用户复测时 dump 几个 tree 的真实数据, 看 `last_heartbeat` / `created_at` / `leaves[].last_event_ts` 的实际值, 才能确定是 IPC 计算错还是 UI 排序错.

### 关键文件

| 文件 | 作用 |
|---|---|
| `proma-dev-patches.cjs` | 主入口；注册 IPC、TAO Watcher、workspace 发现 |
| `preload.cjs` | renderer 桥接；promaTreeIpc.invoke 白名单（必须同步加 channel） |
| `renderer/assets/proma-tree-view.js` | 浮窗 UI + 入口按钮注入（MutationObserver 持续 inject） |
| `renderer/assets/proma-tree-view.css` | 浮窗样式 |
| `renderer/index.html` | 注入 link/script 引用 |

### 已知约束

- **不修改 main.cjs**（AGPL 合规，所有逻辑写进 patches.cjs）
- **零外部依赖**（patches.cjs 只用 Node.js 内置 + electron）
- **preload.cjs 白名单制**：新增 IPC channel 必须同步加白名单，否则 renderer invoke 被 reject
- **preload.cjs 已经被 Proma 商业版 require**，修改会立即生效（不需要重启 main 进程之外的步骤）

## 测试记录

### 2026-06-17 remote-session Release 验收 — ❌ 不通过

- **测试方**：Proma Agent（本会话 b18c436b）
- **目标实例**：Release (instance: "release")
- **工具调用层面**：11/11 返回正常，中文无乱码
- **用户判定**：验收不通过（具体问题待用户说明）
- **下一步**：Fork 到新会话重新测试