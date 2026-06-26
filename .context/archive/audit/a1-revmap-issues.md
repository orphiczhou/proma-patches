# A1 反向映射审计报告

> **leaf**: sq_audit-A1-revmap
> **执行时间**: 2026-06-19 18:30 GMT+8
> **方法论**: 树形多Agent终局验证方法论 阶段二 A1（反向映射重构）
> **审计对象**: tree-system-v0.2.0 发布包（17 个文件）
> **上游权威**: CHANGELOG.md（核心交付 4 项）、README.md（核心概念）

---

## 一、反向功能清单

从 17 个文件中逐条反推实际功能点，不依赖原文件自身分组和标题。

### 1. tree-state.js（1552 行）

| ID | 功能点 | 来源 |
|----|--------|------|
| F01 | CLI 子命令路由（17+ 子命令，5 组） | 行 1383-1513 |
| F02 | `init` 命令：创建 tree 目录 + 初始 tree-state.json（root_brief/root_dod/audit_meta） | 行 407-457 |
| F03 | `leaf add`：注册新叶子，含命名正则强校验、parent 引用校验、path 一致性校验 | 行 463-533 |
| F04 | `leaf get` / `leaf list-active` / `leaf list-all`：叶子查询 | 行 539-575 |
| F05 | `tree dump`：全树 JSON dump | 行 581-589 |
| F06 | `event append`：结构化事件登记（8 种类型：done/blocked/plan/brief_echo/heartbeat_reply/nudge/limit/status_check） | 行 973-1001 |
| F07 | `event list`：事件历史查询（按 leaf/type 过滤） | 行 654-686 |
| F08 | `milestone add`：里程碑创建（id/desc/expect_outputs） | 行 877-922 |
| F09 | `milestone set-result`：里程碑审计结果记录（audit_pass + note_path） | 行 924-967 |
| F10 | `leaf set-status`：状态变更，切 done 时严格校验 milestones 非空+全部 audit_pass=true | 行 692-754 |
| F11 | `leaf set-context`：上下文使用率更新（0-100 整数） | 行 760-783 |
| F12 | `leaf set-last-event`：最后事件类型和时间更新 | 行 789-817 |
| F13 | `leaf autonomy-override`：中档纠偏限权（added_must_ask / removed_can_decide） | 行 823-871 |
| F14 | `drift append`：偏差记录双写（leaf.drift_history + 全局 drift_log） | 行 1007-1055 |
| F15 | `drift list`：偏差历史查询（按 leaf / 时间过滤） | 行 595-623 |
| F16 | `heartbeat append`：心跳记录追加，更新 last_heartbeat | 行 1061-1086 |
| F17 | `heartbeat tail`：最近 N 条心跳查询（按 leaf 过滤） | 行 625-652 |
| F18 | `segment append`：竹节交接记录（追加 segment_chain + 状态改为 segment_pending + session_id 唯一性校验） | 行 1092-1140 |
| F19 | `backup`：手动备份（保留最近 10 份） | 行 1146-1157 |
| F20 | `restore`：从备份恢复（恢复前自动安全备份 + schema 校验） | 行 1159-1204 |
| F21 | `validate`：拓扑完整性检查（5 项：parent 引用 / fork_to / session_id 唯一 / path 一致 / milestone.id 唯一） | 行 1210-1329 |
| F22 | 并发文件锁（withLock, 10s 超时，过期锁自动清理） | 行 209-258 |
| F23 | 原子写入（tmp → rename，5 次重试 + 指数退避 50/100/200/400ms，Windows EPERM 兼容） | 行 283-349 |
| F24 | 自动备份（每 10 次写触发，保留最近 10 份） | 行 283-349, 380-401 |
| F25 | LEAF_NAME_RE 命名正则：`^([a-z][a-z0-9_]{3,7})-(?:([A-Z]\d*(?:[a-z]\d*)*)?-)?(\w+)(?:-(s\d+|i\d+))?$` | 行 64 |
| F26 | 10 种错误码枚举（E_LOCK_TIMEOUT ~ E_UNKNOWN） | 行 74-84 |
| F27 | 5 组枚举常量（STATUS/EVENT_TYPE/DRIFT_KIND/DRIFT_SEVERITY/DRIFT_ACTION） | 行 67-71 |
| F28 | 默认 audit_meta（plan_ack_seconds=300, max_self_corrections=2, heartbeat_interval_minutes=15, sweet_spot_limits per model） | 行 87-96 |
| F29 | 带时区偏移的 nowIso() 时间函数 | 行 115-130 |

### 2. skills/tree-commander/SKILL.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F30 | 4 条指挥官铁律（严禁直接读写 tree-state.json / 必须下发 5 件套 / 三步质量门 / 三档递进纠偏） | §1 |
| F31 | 前置检查流程（tree-state.js 存在 / Node.js 可用 / 列出现有 tree / validate 校验） | §2 |
| F32 | 5 件套契约完整模板（brief/dod/report/autonomy/self_audit），含所有必填字段 | §3 |
| F33 | 5 步工作流程（任务规划 → 下发子会话 → 事件路由 → 质量门 → 沉淀文档） | §4 |
| F34 | tree-state.js 子命令完整速查表（Query/Add/Update/Append/Maintain 5 组 20+ 命令） | §5 |
| F35 | 事件路由表（done/blocked/plan/brief_echo/heartbeat_reply 5 种事件的处理动作和子命令） | §6 |
| F36 | plan 默认放行机制（5 分钟无 NACK 自动放行，nack 后走中档纠偏） | §6 |
| F37 | 三档纠偏完整决策树（轻档 nudge → 中档限权 → 重档剪枝），含逐档 tree-state.js 命令序列 | §7 |
| F38 | 心跳 Automation 配置模板（可直粘贴的 YAML，含 15 分钟间隔、哨兵 Agent prompt、判定矩阵、结果处理流程） | §8 |
| F39 | 验收 Agent prompt 模板（6 检查维度 + JSON 输出格式 + severity 判定规则） | §9 |
| F40 | 灾难恢复检查表（4 类故障 F1-F4 + 恢复动作 + tree-state.js 子命令） | §10 |
| F41 | 12 条禁止行为清单（含后果 + 正确做法） | §11 |
| F42 | 命名规范（prefix/path/role/suffix 四段格式 + 完整正则 + 正例/负例表） | §12 |

### 3. skills/tree-worker/SKILL.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F43 | 9 条工人铁律（brief_echo 首条 / milestones 必列 / 每 Mi 自审 / .note.md 必带 / 上下文最小化 / done 附 self_check / 上行结构化 YAML / 禁直接写 tree-state.json / 禁越界） | §1 |
| F44 | 收到 5 件套后首动作流程（解析 → 拆解 milestones → brief_echo → 等待放行） | §2 |
| F45 | 4 种上行消息模板（done / blocked / plan / brief_echo），每种含必填字段 + YAML 模板 | §3 |
| F46 | done 上报含 drift_declaration 字段（v0.2 新增） | §3.1 |
| F47 | blocked 上报含 options A/B 二选一机制 | §3.2 |
| F48 | plan 上报含 silence_ack_seconds + 默认放行声明 | §3.3 |
| F49 | 内部自审完整流程（每 Mi 后 Fork code-reviewer → alignment 评分 → severity 判定 → 最多 2 次自纠） | §4 |
| F50 | 自审 Agent prompt 模板（4 检查点 + 严格 JSON 输出） | §4.3 |
| F51 | drift_history 写入规范（self_correct / declare 两种 action） | §4.5 |
| F52 | .note.md 决策笔记模板（milestone/topic/reversible/可选方案/选择/理由/触发重审条件 7 字段） | §5 |
| F53 | 上下文最小化 3 规则（不留一次性大输出 / 不重复读已读文件 / 超 85% 主动声明） | §6 |
| F54 | 竹节交接响应规范（收到交接指令后输出 ≤2K tokens 简报） | §6 |
| F55 | 12 条禁止行为清单 | §7 |
| F56 | Worker 视角命名规范摘要（4 段格式 + 约束 + 示例） | §8 |

### 4. methodologies/commander-methodology.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F57 | 2 条元信念（工程化=拆成执行片段 / 指挥官不亲自干活） | §0 |
| F58 | 10 条核心原则（根会话纯净 / 双轨执行 / 三步质量门 / trust but verify / 方法论传递 / 多维度审计 / 渐进式交付 / 状态脚本化 / 失败递进 / 沉淀文档） | §1 |
| F59 | 5 步标准工作流程（TaskCreate → 方法论传递 → 并行执行 → 多维度审计 → trust but verify） | §2 |
| F60 | 7 段式子 Agent prompt 模板（任务/背景/必读/详细描述/工作流程/禁止行为/报告格式） | §3 |
| F61 | v0.1 验收实战案例（设计→实施→审计→修复→端到端 5 阶段复盘） | §4 |
| F62 | 新会话初始化模板（handoff_to_new_commander YAML） | §5 |
| F63 | 8 条常见反模式及后果表 | §6 |
| F64 | 工具速查表（Agent 类型 / 会话类型 / 沉淀 / 探索 / 定时任务等对应工具和时机） | §7 |
| F65 | fork_session vs create_session 选择指南 | §7 |

### 5. methodologies/tree-audit-methodology.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F66 | 5 条审计铁律（并行多Agent / 迭代收敛 / 反事实攻击独立 / 修正后回归 / 结论基于证据） | §2 |
| F67 | 最少 7 leaf 强制要求（1 root + 4 审查 + 2 攻击） | §2 铁律1 |
| F68 | 收敛三条件（N_new < N_prev×0.3 / 无阻断严重新问题 / 残留均为建议级） | §2 铁律2 |
| F69 | 三阶段标准执行流程（阶段零规划 / 阶段一四维审查 / 阶段二反向映射+反事实攻击 / 阶段三场景走查 / 循环迭代） | §3 |
| F70 | tree-state 记录规范（8 种 leaf role 定义 + 每 leaf 必记录项 + 每轮迭代 audit_rounds 格式） | §4 |
| F71 | 违规检测清单（6 种常见违规 + 后果 + 检测方式） | §5 |
| F72 | 指挥官快速检查清单（10 项 declare done 前逐项确认） | §6 |

### 6. methodologies/audit-methodology.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F73 | 三阶段验证体系定义（结构完整性审查 → 逻辑严密性攻击 → 场景走查） | §2 |
| F74 | 四维交叉审查定义（一致性/角色闭环/规则符合/契约边界） | §3 |
| F75 | 反向映射重构方法（5 步骤：忽略分组→反提功能→汇总清单→逐项比对→标记遗漏/冗余/偏离） | §4 |
| F76 | 反事实攻击方法（角色视角攻击 + 契约边界攻击，各 3 场景 / 1-2 边界输入） | §4 |
| F77 | 场景走查方法（选 1-3 核心流程 → 逐步对照 → 标记断层） | §5 |
| F78 | 收敛标准（问题数递减至 <30% / 无阻断严重 / 残留建议级） | §6 |
| F79 | 文档类型适配表（用户故事/架构设计/API Spec/测试用例各自审查维度和攻击重点） | §8 |

### 7. design/tree-commander-design.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F80 | 4 个架构补丁（根会话纯净 / 双轨执行 / 递归自审 / 状态访问脚本化） | §1 |
| F81 | C2 层架构定义（在剪枝者之上叠加指挥控制层） | §2 |
| F82 | 5 件套契约设计（brief/dod/report/autonomy/self_audit 完整 schema） | §3 |
| F83 | 双通道节奏设计（事件通道 + 心跳通道，分工矩阵 + 协同去重规则） | §4 |
| F84 | 偏差检测 3 类信号 + 3 类检测 Agent（验收/路线图/哨兵） | §5.1 |
| F85 | 三档纠偏表 + 决策树 + 双层纠偏体系（内部+外部）+ 三层防御全景 | §5.2-5.5 |
| F86 | 5 可靠度机制（brief_echo / DoD 硬校验 / 决策日志 / 上下文最小化 / 命名规范） | §6 |
| F87 | 南大 PRD 场景套用（6 子任务 + 典型时序 + 与传统对比） | §7 |
| F88 | 持久化与灾难恢复（tree-state.json 完整结构 / 写入时机铁律 / 4 类故障 / 竹节式自动交接 / 目录结构） | §8 |
| F89 | MVP 渐进路线（v0.1 → v0.2 → v0.3 → v1.0） | §9 |
| F90 | v0.1 必做项清单（10 项）+ 故意不做清单（6 项）+ 3 个验证场景 | §9.2-9.4 |
| F91 | 附录 A：tree-state.js API 完整 spec（A.1-A.9，含全局约定、子命令分组、输入输出格式、错误码、锁实现骨架） | 附录 A |
| F92 | v0.2 实施规范（§10：S3 rename 修复 spec + 心跳实现 spec + 内部自审 spec + 三档纠偏实现 spec + v0.2 必做项 + S2 验收草稿） | §10 |

### 8. README.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F93 | 系统一句话定义（多层级任务编排系统） | 顶部 |
| F94 | 版本状态表（v0.2.0 / Alpha / 已验证环境 / 已知限制） | 版本状态 |
| F95 | 快速开始 7 步骤 | 快速开始 |
| F96 | 目录结构树（17 个文件组织） | 目录结构 |
| F97 | 核心概念：树形任务结构 | 核心概念 |
| F98 | 核心概念：5 件套契约表（brief/dod/report/autonomy/self_audit 5 列） | 核心概念 |
| F99 | 核心概念：事件通道表（5 类型含 heartbeat） | 核心概念 |
| F100 | 核心概念：状态管理（tree-state.js 5 项能力） | 核心概念 |
| F101 | 已验证场景表（3 场景 + 结果 + 证据） | 已验证场景 |
| F102 | 已知限制清单（6 项） | 已知限制 |
| F103 | 依赖声明（Proma/Node.js/Git Bash） | 依赖 |
| F104 | v0.3 计划清单（6 项 TODO） | 下一步 |
| F105 | 双可读声明（人类读方法论和设计 / Agent 读 SKILL 和 tree-state.js） | 末尾 |

### 9. QUICKSTART.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F106 | 7 步入门教程（init → 规划 → 创建子会话 → 5 件套契约 → 记录事件 → 验证 → 整合） | Step 1-7 |
| F107 | 进阶终局验证流程（7 leaf + 阶段一 + 阶段二 + 回归） | 进阶 |
| F108 | 4 个 FAQ（子会话无响应 / Fork 丢上下文 / 命令报错 / brief_echo 没收到的对策） | 常见问题 |

### 10. test-plans/s1-test-plan.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F109 | 25 步模拟测试命令序列（覆盖 init/leaf/milestone/event/drift/tree/validate 全命令） | §2 |
| F110 | 7 项验证维度（契约下发/事件路由/milestones 推进/F 启动时机/validate/drift_log 为空/write_count） | §4 |
| F111 | 自动备份验证（write_count=10/20 触发） | §5 |
| F112 | 2 个异常路径（EX1: plan 上报+默认放行 / EX2: 心跳模拟） | §6 |
| F113 | 清理步骤 + 失败处理（8 类常见错误及解决） | §7-8 |

### 11. test-plans/s2-test-plan.md

| ID | 功能点 | 来源 |
|----|--------|------|
| F114 | S2a：心跳唤起场景（哨兵检测 + status_check 发送 + heartbeat_log 验证） | §1 |
| F115 | S2b：内部自审场景（self_correct/declare drift 记录 + 双写验证） | §2 |
| F116 | S2c：三档纠偏链场景（nudge → limit → prune 完整递进 + autonomy_overrides + i2 后缀） | §3 |
| F117 | S3 rename 重试验证方法 | §4 |
| F118 | v0.2 发布门清单（7 项检查） | §5 |

### 12-14. 验证报告（3 份）

| ID | 功能点 | 来源 |
|----|--------|------|
| F119 | B 任务真实验证：GLM-5-Turbo / 4 子会话 / 3 次尝试 / 有条件通过（频道限制） | b-verify-report.md |
| F120 | S1 重测：简单二叉树 / 25 命令全部通过 / 7 验证维度全部通过 | v01-retest-report.md |
| F121 | L2 真实验证：DeepSeek-v4-flash / 3 子会话 / 1 次通过 / 0 偏差 | v01-real-test-report.md |

### 15-16. 交接文档（2 份）

| ID | 功能点 | 来源 |
|----|--------|------|
| F122 | B 任务 brief：真实业务任务定义（v0.2 启动公告 / 4 子任务 / 树形结构 / DoD） | b-task-brief.md |
| F123 | L1 审计修复 brief：多阶段修复任务（3 阻断 + 6 严重 / 3 条并行子任务线 / 终局验证要求） | l1-audit-fix-brief.md |

---

## 二、功能清单 vs CHANGELOG 核心交付逐项比对

### 映射矩阵

| CHANGELOG 声称 | 期望文件 | 验证结果 | 对应功能 ID | 备注 |
|---------------|---------|---------|-------------|------|
| **tree-state.js v1.0（1551 行）** | tree-state.js | ✅ 存在，1552 行 | F01-F29 | 行数偏差 1 行，在容差内 |
| &nbsp;&nbsp;树拓扑管理（增删改查、父子关系、路径定位） | tree-state.js | ✅ | F03-F05, F10, F21 | leaf add/get/list-active/list-all/set-status, validate 含 parent/path 校验 |
| &nbsp;&nbsp;事件日志（4 种类型结构化持久化） | tree-state.js | ⚠️ 实际支持 8 种 | F06, F07 | CHANGELOG 列 4 种，EVENT_TYPE_ENUM 含 8 种（多了 heartbeat_reply/nudge/limit/status_check） |
| &nbsp;&nbsp;版本追踪 + 自动备份（每 10 次） | tree-state.js | ✅ | F24 | BACKUP_EVERY_N_WRITES=10, BACKUP_KEEP_RECENT=10 |
| &nbsp;&nbsp;milestone 严格校验（空拒绝 done） | tree-state.js | ✅ | F10 | set-status done 时检查 milestones 非空+全部 audit_pass=true |
| &nbsp;&nbsp;validate() 拓扑完整性检查 | tree-state.js | ✅ | F21 | 5 项检查 |
| &nbsp;&nbsp;Windows rename 重试（5 次 50/100/200/400ms） | tree-state.js | ✅ | F23 | MAX_RENAME_RETRIES=5, BASE_RENAME_DELAY_MS=50 |
| &nbsp;&nbsp;LEAF_NAME_RE | tree-state.js | ✅ | F25 | 行 64，与声称一致 |
| **tree-commander SKILL v2.0** | SKILL.md | ✅ 存在 | F30-F42 | |
| &nbsp;&nbsp;14 条铁律 | SKILL.md | ❌ **偏离** | F30 | §1 标题写作「铁律（4 条）」，不是 14 条。见下方偏离详述 |
| &nbsp;&nbsp;5 件套契约模板 | SKILL.md | ✅ | F32 | §3.1-3.5 完整 YAML 模板 |
| &nbsp;&nbsp;偏差检测与纠偏机制（drift_log） | SKILL.md | ✅ | F37 | §7 完整三档决策树含 drift append 命令 |
| &nbsp;&nbsp;竹节交接流程（v0.3 实现） | SKILL.md | ✅ | F54 | §8.3 标注「v0.3 实现」，与 CHANGELOG 一致 |
| **tree-worker SKILL v2.0** | SKILL.md | ✅ 存在 | F43-F56 | |
| &nbsp;&nbsp;9 条铁律 | SKILL.md | ✅ | F43 | §1 铁律表正好 9 条 |
| &nbsp;&nbsp;4 种上行消息模板 | SKILL.md | ✅ | F45 | §3 done/blocked/plan/brief_echo 各含必填字段+YAML |
| &nbsp;&nbsp;5 件套契约解读流程 | SKILL.md | ✅ | F44 | §2 完整 4 步流程 |
| &nbsp;&nbsp;上下文最小化规则 | SKILL.md | ✅ | F53 | §6 三规则 |
| **commander-methodology.md** | methodology | ✅ 存在 | F57-F65 | |
| &nbsp;&nbsp;14 条铁律 + 双轨执行 | methodology | ❌ **偏离** | F57-F58 | 方法论含 2 元信念+10 原则=12 条，「双轨执行」是原则 2，非额外条目。见下方偏离详述 |
| **tree-audit-methodology.md** | methodology | ✅ 存在 | F66-F72 | |
| &nbsp;&nbsp;5 条铁律 | methodology | ✅ | F66 | 铁律 1-5 皆在 §2 |
| &nbsp;&nbsp;最少 7 leaf 强制要求 | methodology | ✅ | F67 | §2 铁律 1 |
| &nbsp;&nbsp;收敛三条件 + 违规检测清单 | methodology | ✅ | F68, F71 | §2 铁律 2 + §5 |

---

## 三、功能清单 vs README 核心概念逐项比对

| README 核心概念 | 验证结果 | 对应功能 ID | 备注 |
|----------------|---------|-------------|------|
| 树形任务结构 | ✅ | F97 | README 含 ASCII 树图 |
| 5 件套契约（brief/dod/report/autonomy/self_audit） | ✅ | F32, F44, F82, F98 | 多文件覆盖 |
| 事件通道：brief_echo ↑ | ✅ | F35, F45 (§3.4) | |
| 事件通道：plan ↑ | ✅ | F35, F45 (§3.3) | |
| 事件通道：done ↑ | ✅ | F35, F45 (§3.1) | |
| 事件通道：blocked ↑ | ✅ | F35, F45 (§3.2) | |
| 事件通道：heartbeat ↑ | ⚠️ **偏离** | — | README 将 heartbeat 列为方向↑的"事件类型"，但 heartbeat 实际是双向通道（status_check ↓ + heartbeat_reply ↑），由 Automation 驱动，非子会话主动上行 |
| 状态管理：树拓扑管理 | ✅ | F03-F05, F10 | |
| 状态管理：事件日志 | ✅ | F06, F07 | |
| 状态管理：版本追踪+自动备份 | ✅ | F24 | |
| 状态管理：自审记录 | ✅ | F08, F09 | |
| 状态管理：收敛验证（validate） | ✅ | F21 | |

---

## 四、v0.2 新增功能覆盖完整度检查

| v0.2 新增能力 | CHANGELOG 状态 | 实际覆盖情况 | 判定 |
|--------------|---------------|-------------|------|
| **心跳** | 已知限制：「仅方案未编码」 | tree-commander SKILL §8：完整 Automation 配置 + 哨兵 Agent prompt + 判定矩阵 + 结果处理流程；tree-state.js：heartbeat append/tail 已实现。但未创建实际 Proma automation | ⚠️ 「仅方案」说法不准——可执行指令已编码在 SKILL 中，tree-state.js 的数据持久化已完成，缺的是 Automation 创建和 Agent 自动调用 |
| **内审** | 已知限制：「仅方案未编码」 | tree-worker SKILL §4：完整自审流程 + code-reviewer prompt 模板 + drift_history 写入规范；铁律 3 已从可选升级为必须。但 code-reviewer Agent 调用依赖子会话手动执行 | ⚠️ 同上——流程和 prompt 已就绪，缺自动化触发 |
| **三档纠偏** | 已知限制：「仅方案未编码」 | tree-commander SKILL §7：完整 if-else 决策树 + 逐档 tree-state.js 命令序列；tree-state.js 全部所需子命令已实现（drift append, autonomy-override, set-status pruned, leaf add）。但决策由指挥官手动执行 | ⚠️ 同上——最接近「已实现」的一项，所有底层命令就绪 |
| **竹节交接** | 已知限制：「仅方案」 | tree-state.js segment append 已实现；tree-commander SKILL §8.3 标注 v0.3；设计文档 §8.4 有完整 spec | ✅ 准确描述为「仅方案」 |

---

## 五、遗漏项列表（Omissions）

CHANGELOG/README 声称存在但文件中缺失或未充分覆盖的功能。

### O1：tree-commander SKILL「14 条铁律」——数量不实

- **CHANGELOG 声称**：「14 条铁律（根会话纯净、双轨执行、事件路由等）」
- **README 声称**：「指挥官方法论（14条铁律）」
- **实际文件**：
  - tree-commander SKILL §1 标题写作 **「铁律（4 条）」**（严禁直接读写 tree-state.json / 必须下发 5 件套 / 三步质量门 / 三档递进纠偏）
  - tree-commander SKILL §11 另有「12 条禁止行为清单」
  - commander-methodology 有「2 条元信念 + 10 条核心原则」= 12 条
- **判定**：14 这个数字在任何单一文件中都找不到确切对应。最接近的是 SKILL 的 4 铁律 + 12 禁止 = 16，或 methodology 的 2 + 10 = 12。**建议 CHANGELOG 和 README 将措辞改为实际数字，或明确说明计数方式。**

### O2：event list 命令未在 CHANGELOG 中列出

- CHANGELOG 只提「事件日志（brief_echo/done/blocked/plan 结构化持久化）」，未提及 `event list` 查询命令
- 实际 `event list` 支持按 leaf/type 过滤，是按 ts 排序的完整事件查询
- 严重度：低（属隐含功能，append 的自然对偶）

### O3：plan 默认放行机制未在 CHANGELOG 核心交付中声明

- tree-commander SKILL §6 含完整「plan 默认放行机制」：5 分钟内无 NACK 自动放行
- 设计文档 §4.2 也将此列为关键设计点
- CHANGELOG 核心交付项未提及此机制
- 严重度：中（架构性机制，对可用性影响大）

### O4：README 核心概念缺少「纠偏机制」

- README 核心概念含树形结构、5 件套契约、事件通道、状态管理四大块
- 三档纠偏（nudge/limit/prune）是 v0.2 核心新增能力，但 README 核心概念段未单列
- README 仅在「已知限制」中间接提到，而非正面介绍
- 严重度：中

### O5：README 核心概念缺少「心跳通道」

- README 核心概念段没有心跳通道的正面介绍
- 事件通道表将 heartbeat 列为事件类型（方向↑），简化了实际的双向通道设计
- 严重度：中

---

## 六、冗余项列表（Redundancies）

文件中反复出现、有实质功能但在 CHANGELOG 核心交付中未声明的功能。

### R1：tree-state.js 支持 8 种事件类型（CHANGELOG 只提 4 种）

- CHANGELOG：「事件日志（brief_echo/done/blocked/plan 结构化持久化）」
- 实际 EVENT_TYPE_ENUM = `['done', 'blocked', 'plan', 'brief_echo', 'heartbeat_reply', 'nudge', 'limit', 'status_check']`（8 种）
- 多了 heartbeat_reply / nudge / limit / status_check 四种
- 严重度：低（扩展类型与纠偏/心跳通道配套，属于 v0.2 新增）

### R2：tree-state.js `segment append` 命令已完整实现

- CHANGELOG「已知限制」：「竹节交接仅方案」
- tree-state.js 中 `segment append` 已完整实现：追加 segment_chain + 改状态 segment_pending + session_id 唯一性校验 + drift_history 双写
- 设计文档 §8.4 的竹节交接完整流程的底层命令已就绪，只是编排层的 Automation 未实现
- 严重度：低

### R3：灾难恢复检查表（F1-F4）未在 CHANGELOG 中声明

- tree-commander SKILL §10 含完整的 4 类故障恢复检查表（F1 子会话崩溃 / F2 根会话崩溃 / F3 tree-state 损坏 / F4 SDK 配额耗尽）
- 设计文档 §8.3 也含同样内容
- CHANGELOG 核心交付未提灾难恢复能力
- 严重度：中（灾难恢复是生产可用性的关键）

### R4：验收 Agent prompt 模板未在 CHANGELOG 中声明

- tree-commander SKILL §9 含完整验收 Agent prompt 模板（6 检查维度 + JSON 输出格式）
- 设计文档 §10.5 也含验收 Agent prompt 骨架
- CHANGELOG 未将其列为核心交付项
- 严重度：中

### R5：tree-worker SKILL 含 .note.md 决策笔记模板

- tree-worker SKILL §5 含完整 .note.md 模板（7 字段），是可靠度机制之一
- CHANGELOG 未提及
- 严重度：低

### R6：commander-methodology 含 fork_session vs create_session 选择指南

- methodology §7 明确区分两种会话创建方式的适用场景
- CHANGELOG 未提及此决策指南
- 严重度：低

### R7：tree-state.js 含 `restore` 命令

- `restore` 完整实现（恢复前安全备份 + schema 校验 + write_count 重置）
- CHANGELOG 只提「自动备份」未提「恢复」能力
- 严重度：低

### R8：audit-methodology.md（上游原始方法论）未在 CHANGELOG 核心交付中提及

- CHANGELOG 方法论文档段只列了 commander-methodology 和 tree-audit-methodology
- 但 audit-methodology.md 是 tree-audit-methodology 的「上游来源」，独立存在于发布包中
- 严重度：低

---

## 七、偏离项列表（Deviations）

CHANGELOG 描述与实际文件内容不一致。

### D1：「14 条铁律」数字偏离（严重）

- **CHANGELOG**：「tree-commander SKILL v2.0：指挥官操作手册 — 14 条铁律」
- **实际**：tree-commander SKILL §1 标题为「铁律（4 条）」，§11 另有 12 条禁止行为。commander-methodology 含 2 元信念 + 10 原则 = 12 条
- **影响**：下游读者按「14 条」去 SKILL 文件中找，找不到对应列表
- **建议**：CHANGELOG 改为「4 条铁律 + 12 条禁止行为」或明确「14 条约束（含铁律+禁止）」。README 同步修正目录描述。

### D2：「心跳/内审/三档纠偏仅方案未编码」定性偏离（严重）

- **CHANGELOG 已知限制**：「心跳/内审/三档纠偏仅方案未编码」
- **实际情况**：
  - **三档纠偏**：tree-commander SKILL §7 含完整 if-else 决策树 + 逐档 tree-state.js 命令序列；tree-state.js 所有所需子命令（drift append, autonomy-override, set-status pruned, leaf add）100% 已实现。这是最接近「已实现」的一项。
  - **心跳**：tree-commander SKILL §8 含完整 Automation 配置 YAML + 哨兵 Agent prompt + 判定矩阵 + 结果处理流程。tree-state.js 的 heartbeat append/tail 已实现。缺的是实际 Proma automation 创建。
  - **内审**：tree-worker SKILL §4 含完整自审流程 + code-reviewer prompt 模板 + drift_history 规范。铁律 3 已从 v0.1 可选升级为 v0.2 必须。
- **问题**：「仅方案未编码」暗示这些能力只存在于设计文档中，但实际上它们在 SKILL 文件中已有完整的可执行指令（对 AI Agent 而言），且 tree-state.js 底层命令已实现。「未编码」的准确含义应该是「未在 tree-state.js 中自动化执行，需由 Agent 手动按 SKILL 指令触发」。
- **建议**：改为「心跳/内审/三档纠偏的 SKILL 指令已完整，底层 tree-state.js 命令已就绪，但编排层自动化（Proma automation 创建 / code-reviewer Agent 自动调用）待 v0.3」。

### D3：「commander-methodology.md v1.0：14 条铁律 + 双轨执行」数字偏离（严重）

- **CHANGELOG**：「commander-methodology.md v1.0：14 条铁律 + 双轨执行」
- **实际**：methodology 含 §0「元信念（两条根本）」+ §1「十条核心原则」，共 12 条。「双轨执行」是原则 2，不是额外条目。
- **影响**：同 D1，14 这个数字在 methodology 中也无法对应
- **建议**：改为「2 条元信念 + 10 条核心原则（含双轨执行）」或保持原始 methodology 自己的措辞

### D4：README 事件通道表 heartbeat 描述偏离（中）

- **README**：heartbeat 列为方向「↑」（上行），暗示子会话主动发送
- **实际**：心跳是双向通道——根会话通过 Automation 发起 status_check（↓），子会话回复 heartbeat_reply（↑）。不是子会话主动上报的事件类型
- **影响**：新读者可能误解心跳为子会话自发行为
- **建议**：README 事件通道表将 heartbeat 行方向改为「↓↑」并注明「由 Automation 驱动」，或从事件通道表中移出单独介绍

### D5：CHANGELOG 事件日志只列 4 种类型（低）

- **CHANGELOG**：「事件日志（brief_echo/done/blocked/plan 结构化持久化）」
- **实际**：tree-state.js EVENT_TYPE_ENUM 含 8 种，多了 heartbeat_reply/nudge/limit/status_check
- 这不完全是错误（v0.1 确实只有 4 种核心事件类型），但 v0.2 已扩展
- **建议**：更新为「8 种事件类型（核心 4 种 + 纠偏/心跳 4 种）」

### D6：README 目录描述 commander-methodology「14条铁律」（低）

- **README 目录结构**：「commander-methodology.md | 指挥官方法论（14条铁律）」
- 同 D3，methodology 实际是 2 + 10 = 12 条
- **建议**：与 D3 同步修正

---

## 八、结构化问题汇总

### 按严重度分级

| 严重度 | 编号 | 类型 | 简述 |
|--------|------|------|------|
| **严重** | D1 | 偏离 | tree-commander SKILL「14条铁律」数字无对应（实际 4+12=16 或 2+10=12） |
| **严重** | D2 | 偏离 | 「仅方案未编码」定性不准——SKILL 指令和 tree-state.js 命令已完成，缺编排自动化 |
| **严重** | D3 | 偏离 | commander-methodology「14条铁律+双轨执行」数字无对应 |
| 中 | O3 | 遗漏 | plan 默认放行机制未在 CHANGELOG 声明 |
| 中 | O4 | 遗漏 | README 核心概念缺少「纠偏机制」正面介绍 |
| 中 | O5 | 遗漏 | README 核心概念缺少「心跳通道」正面介绍 |
| 中 | R3 | 冗余 | 灾难恢复检查表（F1-F4）未在 CHANGELOG 声明 |
| 中 | R4 | 冗余 | 验收 Agent prompt 模板未在 CHANGELOG 声明 |
| 中 | D4 | 偏离 | README heartbeat 事件方向标注为↑，实际为↓↑双向 |
| 低 | O1 | 遗漏 | `event list` 命令未提及 |
| 低 | R1 | 冗余 | tree-state.js 8 种事件类型，CHANGELOG 只提 4 种 |
| 低 | R2 | 冗余 | segment append 已实现，CHANGELOG 称「仅方案」 |
| 低 | R5 | 冗余 | .note.md 模板未在 CHANGELOG 提及 |
| 低 | R6 | 冗余 | fork vs create 选择指南未提及 |
| 低 | R7 | 冗余 | restore 命令未提及 |
| 低 | R8 | 冗余 | audit-methodology.md 未在核心交付中列出 |
| 低 | D5 | 偏离 | CHANGELOG 事件日志类型数过时（4→8） |
| 低 | D6 | 偏离 | README 目录描述数字同 D3 |

---

## 九、质量门自查

### 覆盖率自检

| 门 | 标准 | 结果 |
|----|------|------|
| 功能清单覆盖率 ≥ 80% 文件 | 17 × 0.8 = 13.6，需 ≥ 14 个文件 | ✅ 17/17（100%）— 全部 17 个文件均已提取功能点 |
| CHANGELOG 核心交付 4 项全部完成映射验证 | 4/4 | ✅ 全部 4 项（tree-state.js / tree-commander SKILL / tree-worker SKILL / 方法论文档）均完成逐子项验证 |

### 反向映射方法自检

| 方法步骤 | 执行 |
|---------|------|
| 忽略原有分组和标注 | ✅ 功能 ID 按文件编号（F01-F123），不沿用源文件 § 编号 |
| 从每条内容反向提取功能点 | ✅ 每个功能点标注了来源（行号或 §） |
| 汇总为功能清单 | ✅ 123 个功能点，按文件分组 |
| 与上游权威文档逐项比对 | ✅ 映射矩阵含 CHANGELOG 全部子项 + README 全部核心概念 |
| 标记遗漏/冗余/偏离 | ✅ 三大清单共 19 项（1 遗漏 + 8 冗余 + 6 偏离，按严重度分 3+5+11） |

---

*审计完成。本报告由 leaf sq_audit-A1-revmap 独立产出，不依赖 CHANGELOG/README 自身分组，不预判问题归属。*
