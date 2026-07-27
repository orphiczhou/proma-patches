# X-audit-S1 — macp11-S1 异厂商独立审查

- **审计员**：macp11-X-auditor，MiniMax-M3，session `22b8407c-6d62-439b-afcd-13656c4b45d6`
- **被审**：macp11-S1-worker，GLM-5.2
- **范围**：IPC handler → engine-factory → 真实 coder/judge 引擎 → LLM mock → ApiResponse
- **结论**：**pass_with_minor**

## 1. G1-G5 评估

| 维度 | 结论 | 证据 |
|---|---|---|
| G1 完整性 | green / pass | `06_TESTS/e2e-ipc-cross-layer.test.ts` 有 3 个测试：关键 channel 注册、coder handler 全链路、judge handler 全链路；断言 handler 注册、真实引擎实例、mock LLM、信封与写盘结果。 |
| G2 一致性 | green / pass | `electron/main.ts:156` 导出并接受可选 `EngineBundle`，仅将局部 coder/judge 注入 handler；`electron/engine-factory.ts:55-63,181-185` 透传可选 sandbox/snapshot，生产无参路径保持原默认依赖。 |
| G3 规范性 | green / pass | `S1-e2e-report.md` 记录了 testability gap、方案取舍、改动点、断言矩阵、红线与可复现命令；测试文件落在 vitest include 范围内。 |
| G4 可验证性 | green / pass | 独立 `tsc --noEmit -p tsconfig.build.json` exit 0；独立 `npm run build` exit 0；独立 `vitest run 06_TESTS/e2e-ipc-cross-layer.test.ts`：1 file、3 tests passed、0 skipped、exit 0。 |
| G5 安全 | green / pass | 测试通过 fake sandbox/snapshot 避免副作用，fetch spy 断言未联网；生产 DI 仅为可选参数，不扩展外部输入权限。handler 输入校验仍由既有 engine 层负责。 |

## 2. 跨层真实性复核

这不是直接调用 `createCoderEngine().generateCode()` 的进程内测试。测试先调用 `registerIpcHandlers(bundle)`，由 mocked `ipcMain.handle` 保存注册函数，再从注册表取得 `coder:generateCode` / `judge:evaluateDocs` handler 调用。调用后分别观察：

1. handler 确实由 `ipcMain.handle` 注册（spy + channel Map）；
2. `bundle.coderEngine` 是 `CoderEngine` 实例，judge 走工厂产出的真实 JudgeEngine；
3. coder mock `generate` 被调用并产生真实文件 `outputDir/src/cli.ts`；
4. judge mock `evaluateSoft` 被调用 4 次并产生 pass verdict；
5. 返回值含 `ok`、非空 `requestId`、非负 `durationMs`、data；
6. `fetch` 没有被调用，未烧外部 token。

## 3. Findings

- **green**：IPC channel 名称、注册动作、handler 闭包路由和真实引擎调用均被测试覆盖；engine-factory DI 的生产默认路径没有被改变。
- **green**：coder 的断言覆盖了 LLM 输出到磁盘的副作用，不是仅断言 mock 被调用。
- **yellow（非阻塞，测试边界）**：Electron 本体与 renderer 进程没有启动；`electron` 模块、`ipcMain` 和 `app.whenReady` 均为 Vitest mock，测试从内存 Map 直接调用 handler。因此它是“IPC 注册/路由层跨层 E2E”，不是 renderer→真实 Electron 主进程的进程级 E2E。该选择是为稳定性和避免 Electron lifecycle side effect，足以证明本轮目标的 handler 层缺口，但若要宣称完整系统 E2E，后续仍应增加 Electron smoke test。
- **yellow（非阻塞、既有边界）**：`main.ts` handler 仍对 `unknown` 使用类型断言，运行时字段校验委托给 engine；本轮未引入此模式，也未扩大生产 API 面，因此不作为 S1 fail。

## 4. CWE 清单

| CWE | 判定 | 说明 |
|---|---|---|
| CWE-22 路径遍历 | green | 测试 fixture 使用临时目录；生产 handler 仍交由 coder/judge 既有校验，DI 端口不是用户请求字段。 |
| CWE-73 外部控制文件名 | green | 新增代码只注入内部依赖，不从 IPC req 读取新文件名或命令。 |
| CWE-78 命令注入 | N/A | S1 新代码无 shell 拼接；fake sandbox 不执行命令。 |
| CWE-434 任意文件上传 | N/A / green | E2E 只验证既有 coder 输出，未新增上传端点。 |
| CWE-918 SSRF | green | fetch spy 全程未调用；无新网络目的地。 |

## 5. Verdict

**pass_with_minor**。本轮确实补上了 main.ts `ipcMain.handle` 注册/路由层，跨 handler、工厂、真实引擎、mock LLM 和信封的证据充分，独立验证全绿。minor 仅是“IPC handler E2E”与“真实 Electron/renderer 进程级 E2E”措辞边界，不阻塞 macp11 增量计分。

**签字**：macp11-X-auditor（MiniMax-M3，异厂商独立）  
**日期**：2026-07-27 23:59 GMT+8
