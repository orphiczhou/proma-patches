# 改进方案 + 决策记录

## 方案 A+B+C+D

- **A**：milestone_add 强制 V3（reject 空 expect_outputs）——堵入口。
- **B**：milestone_set_result reject 空 expect_outputs——纵深防御。
- **C**：新增 milestone_update API（改 desc/expect_outputs，caller 身份校验，拒绝改已 audit_pass 的）——合法修复路径，消灭文件手术。
- **D**（存储安全）：用户提议 tree-state 改 DB 或 protected-location。

## 用户的存储建议（议题 2）

> "tree-state.json 暴露在会话目录，很难用 harness 约束 agent 不用编辑文件形式修改，是否能改成 DB？看 Proma 用什么数据库，能否复用？或者集中放在 profile 某个会话没权限看编辑的地方，暴露接口给会话查看？"

## 调研结论（详见 02-research）

- **Proma 无任何数据库**（纯 JSON/JSONL 文件）——"迁 DB"等于从零新建，无现成 DB 复用。
- **SQLite 文件仍是文件**——agent 全盘写权限下 `fs.writeFileSync(dbPath,...)` 照样绕过引擎。迁 DB 不解决核心漏洞。
- **Agent 文件访问=全盘无沙箱**（SDK 工具 createRead/WriteToolDefinition 无路径限制，bypassPermissions 放行任意绝对路径）——protected-location（移到 workspace 外）防不住绝对路径直写。
- **结论**：DB / protected-location 都不能根治。真正有效的组合：P1(A+B+C 堵合法入口漏洞) + P2(篡改检测 write_count+hash 让直改被发现) + P3(canUseTool 拦 Write/Edit)。P4(SDK allowedPaths/denyPaths 路径沙箱) 是根治但 SDK 当前不支持。

## 决策

- **本轮实施 P1 = A+B+C**（用户同意 + 调研推荐立即做）。已部署 dev/pro dist + 审计收敛。
- **P2（篡改检测）+ P3（canUseTool 拦截）留后续**——P2 是对用户存储关切的直接回应（检测直改），建议紧随。
- **DB 迁移不做**（无收益、不解决漏洞、改动量大）。
- **B 动态测试**留后续补（yellow，非阻断）。

## 改动落点（已 git 提交 tree-harness）

- `D:/Codes/tree-harness/tree-engine.cjs`：cmdMilestoneAdd V3 空拒绝（~L2070）、cmdMilestoneSetResult 空拒绝（~L2163）、cmdMilestoneUpdate 新增（~L2209）+ dispatchMilestone case 'update'（~L5185）。
- `D:/Codes/tree-harness/proma-dev-patches.cjs`：buildTreeTable 加 tree_milestone_update（~L426）。
- 部署：`D:/Proma-dev/resources/app/dist/`（dev/pro 共享，已 restart pro）。release 宿主未部署（避免杀会话）。
