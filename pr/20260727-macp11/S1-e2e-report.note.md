---
milestone: M1
topic: e2e-ipc-cross-layer-testability-hook
reversible: true
---

## 落盘路径 + mtime（硬证据）

| 文件 | 绝对路径 | mtime | size |
|------|----------|-------|------|
| 本报告 | `C:\Users\sir_c\.proma-pro\agent-workspaces\default\.context\trees\macp11\deliverables\S1-e2e-report.md` | 2026-07-27 22:42:55 +0800 | 15311 字节（≥1500 字要求 ✅） |
| E2E 测试 | `D:\Codes\multi-agent-collab-platform\06_TESTS\e2e-ipc-cross-layer.test.ts` | 2026-07-27 22:38:47 +0800 | 12380 字节 |
| testability hook ① | `D:\Codes\multi-agent-collab-platform\electron\main.ts` | 2026-07-27 22:36:09 +0800 | L33 / L156 / L204 / L209 / L214 / L221 / L226 |
| testability hook ② | `D:\Codes\multi-agent-collab-platform\electron\engine-factory.ts` | 2026-07-27 22:35:09 +0800 | L30-39 / L45-63 / L181-185 |

**时序正确性**（F-E1-Y1：先落盘再写报告）：
- 22:35 engine-factory.ts 改完 → 22:36 main.ts 改完 → 22:38 测试文件落盘 → 三重验证跑通 → 22:42 报告落盘。
- 测试与 hook 改动均先于报告落盘，报告里的证据是对已落盘产物的真实记录。

## probe 说明

**无独立 `.cjs` 探针**。autonomy.can_decide 第 4 条允许"探针用 .cjs 落盘还是直接 vitest 断言"自行决策——本任务选**直接 vitest 断言**（`06_TESTS/e2e-ipc-cross-layer.test.ts` 本身即是可复现探针），理由：
- vitest 用例自带断言（`expect(ipcMain.handle).toHaveBeenCalled` / `toBeInstanceOf(CoderEngine)` / `toHaveBeenCalled`），比 `.cjs` 探针的 console.log 更强（断言失败即 exit ≠0）；
- vitest exit 0 + 3 passed 已是"真跑通"的硬证据（§6.3 输出），无需额外 `.cjs`；
- 复现命令：`node node_modules/vitest/vitest.mjs run --root <项目根> 06_TESTS/e2e-ipc-cross-layer.test.ts`（项目 PATH 无 node/npx，用绝对路径 node 跑）。

## 可选方案（testability hook 三选一）

- **方案 A**：export `createIpcHandlers(engines)` 返回 handler 注册表（不经 ipcMain.handle 注册表，IPC 注册语义弱）
- **方案 B**：`vi.mock('electron')` + import main.ts，靠 `app.whenReady` side-effect 触发注册（最真但 side-effect 难隔离）
- **方案 C**：`export registerIpcHandlers(engines?)` + `vi.mock('electron')` ipcMain.handle spy（混合，覆盖最完整）

## 选择

**方案 C 简化版**：`registerIpcHandlers` 加 `export` + 可选 `engines` 参数（不返回 registry）+ `vi.mock('electron')` 让 ipcMain.handle 把 handler 存进内存 Map。

## 理由

1. **handler 注册语义最真**：保留 `ipcMain.handle(channel, handler)` 调用不变，测试用 `vi.mocked(ipcMain.handle).toHaveBeenCalledWith('coder:generateCode', ...)` 断言 handler 真注册到 ipcMain（方案 A 的 registry 返回做不到这点）；
2. **side-effect 隔离干净**：`app.whenReady` 返回 pending promise → main.ts import 时不触发 app lifecycle（方案 B 要处理 createWindow/initEngines side-effect，复杂）；
3. **业务路径零变化**：`engines?` 缺省时回退模块私有变量，L335 `registerIpcHandlers()` 无参调用行为不变；
4. **最小改动**：main.ts 仅 1 个函数签名加可选参数 + 5 处变量名替换；engine-factory 仅加 2 个可选 DI 字段（engine-factory 本就是 DI 入口，符合设计意图）。

## 触发重审条件

- 若后续 S2 接入真实 PromaCloudLlmClient 后，`createEngines()` 无参路径的 sandbox/snapshot 默认行为变化 → 重审 testability hook 是否仍最小；
- 若 macp12+ 要求 IPC handler 测试覆盖 `ipcMain.on`（telemetry:emit fire-and-forget）的信封流转 → 扩展测试（当前仅断言 on 注册，未断言 listener 调用副作用）。
