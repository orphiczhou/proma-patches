# X-c1-revote — macp11 综合 C1 异厂商独立复评

- **评估员**：macp11-X-auditor，MiniMax-M3，session `22b8407c-6d62-439b-afcd-13656c4b45d6`
- **基线**：macp10 MiniMax-M3 独立签字 C1=79/100
- **评估方法**：独立阅读 J1/S1 交付物与源码；独立运行 build typecheck、production build、J1 probe、IPC cross-layer vitest；不直接采信 worker 自证
- **结论**：**C1 = 86/100，达到 85+；保守计入 IPC-handler 跨层 E2E +4，未把它当作完整 Electron 进程级 E2E。**

## 1. 九维评分表

| 维度 | 满分 | macp10 | macp11 复评 | Δ | 依据 |
|---|---:|---:|---:|---:|---|
| 可运行性 | 10 | 9 | **9** | 0 | build/typecheck 及目标测试独立 exit 0；默认 renderer tsconfig 既有错误不纳入 build scope。 |
| Sandbox | 10 | 6 | **6** | 0 | 未推进 OS 级隔离；S1 测试以 fake sandbox 隔离测试副作用，不等于产品能力提升。 |
| Snapshot | 10 | 9 | **9** | 0 | 未推进产品 snapshot；S1 fake snapshot 仅为测试 DI。 |
| Coder 业务逻辑 | 15 | 15 | **15** | 0 | macp10 已完成 GWT autofix 真应用、路径防护、patchError/appliedFiles；本轮只复核。 |
| Judge 业务逻辑 | 15 | 13 | **15** | **+2** | `featuresMissingSteps` 参与 verdict：>50% 为 `GWT_STEPS_MISSING` reject，≤50% 为 testability soft suggestion；独立 probe 17/17 PASS。 |
| LLM 基础设施 | 12 | 11 | **11** | 0 | 未改变 judge 占位规模或既有 LLM 基础设施分。 |
| Electron IPC | 10 | 5 | **5** | 0 | 5 个 coder/judge handler 已真实接线的既有分数不变；其余 IPC 端点仍为 stubData。 |
| 自动化测试 | 8 | 7 | **8** | **+1** | 新增 `06_TESTS/e2e-ipc-cross-layer.test.ts`，3/3 pass，补齐关键 IPC handler 注册与路由回归覆盖。 |
| 端到端 | 10 | 4 | **8** | **+4** | 新测试跨 `ipcMain.handle` 注册表 → main handler → factory → 真实引擎 → mock LLM → envelope；因 Electron/renderer 为 mock，保守只回收 +4（不是 +6）。 |
| **总计** | **100** | **79** | **86** | **+7** | Judge +2、自动化测试 +1、端到端 +4。 |

## 2. 增量回收核算

- **G1 Judge +2**：这是实质业务修复，不只是类型增量；reject/soft/empty 三个边界均有独立探针。
- **G2 端到端 +4**：原 macp10 测试直接拿 engine 引用，S1 新测试至少经 `registerIpcHandlers` 与 `ipcMain.handle` 注册表；真实引擎和 LLM mock 的链路可观察。由于没有真实 Electron 主进程/renderer，拒绝按满额 +6 计。
- **G3 三 yellow 清理**：提高审计可追溯性和失败防御，但不额外重复计分；其价值已体现在可靠性与报告闭环。
- **自动化测试 +1**：新增 3 个稳定、非 skip 的跨层用例，补足关键路由回归。

## 3. 诚实保留的拖分项

1. **Sandbox 6/10**：仍不是 OS 级隔离。
2. **Electron IPC 5/10**：其余 IPC endpoint 仍为骨架 stub；S1 只证明 coder/judge 五个关键 handler。
3. **LLM 基础设施 11/12**：judge 占位与产品化能力未在本轮减少。
4. **端到端 8/10 而非 10/10**：测试 mock 了 Electron 与 app lifecycle，没有 renderer→真实 Electron 主进程的进程级 smoke test。
5. **Judge IO 边界**：GWT 扫描对非 ENOENT 读错误仍可能返回空 coverage 并 pass（既有实现边界，见 X-audit-J1）。

## 4. 独立验证记录

| 命令 | 结果 |
|---|---|
| `tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npm run build` | exit 0 |
| `node probe-macp11-j1.cjs` | exit 0；3 场景、17 断言全 PASS |
| `vitest run 06_TESTS/e2e-ipc-cross-layer.test.ts` | exit 0；1 file、3 tests passed、0 skipped |

Node 在审计 shell 初始 PATH 中不可见，审计时显式加入 `/c/Program Files/nodejs` 后执行；这不改变命令内容或结果。

## 5. 独立签字

**C1 = 86/100（MiniMax-M3，异厂商独立签字，达到 85+）**。  
评分没有把 mocked Electron 测试夸大为完整系统 E2E，也没有为 G3 yellow 清理重复加分；剩余拖分项已如实列出。

**签字**：macp11-X-auditor（MiniMax-M3，异厂商独立）  
**日期**：2026-07-28 00:00 GMT+8
