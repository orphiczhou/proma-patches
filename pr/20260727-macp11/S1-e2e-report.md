# macp11-S1 跨层 E2E 测试报告

> **任务**：G2 补 macp10 拖分最大的「真系统 E2E」维度（-6 分），写 1 个跨层 E2E 测试，覆盖完整链路 `IPC handler → engine-factory → 真实 coder/judge 引擎 → LLM mock → ApiResponse 信封`，超越现有 `06_TESTS/e2e-coder-judge.test.ts` 的「进程内集成」。
>
> **leaf**：macp11-S1-worker（path=S1, role=worker）
> **日期**：2026-07-27

---

## 1. 任务摘要

macp10 C1=79/100，拖分项明确：真系统 E2E -6（最大单点）、Electron IPC -5、Sandbox -4。本任务（G2）目标 = 补真系统 E2E，回收 +4-6 分。

诊断 macp10 现有两个测试后发现：它们都**绕过了 IPC handler 层**——

- `06_TESTS/e2e-coder-judge.test.ts` L96-108：直接 `createCoderEngine({llm}).generateCode(input)`，是**进程内集成**；
- `06_TESTS/unit-llm-mock.test.ts` L155：`createEngines({judgeLlm})` 走了 engine-factory，但仍直接调 `bundle.judgeEngine.evaluateDocs(...)`，**不经 IPC handler**。

`electron/main.ts` L186-211 的 5 个 coder/judge handler（`coder:generateCode` / `coder:applyFix` / `coder:runGwt` / `judge:evaluateDocs` / `judge:evaluateCode`）的注册与路由逻辑（`ipcMain.handle` 注册 + handler 闭包 → engine → ApiResponse 信封化）从未被任何测试覆盖。这正是 macp10 在「真系统 E2E」维度只得 4/10（-6 拖分）的根因。

本任务交付 `06_TESTS/e2e-ipc-cross-layer.test.ts`（3 个测试用例，全 pass），补齐 IPC handler 这一层，解锁 +4-6 分回收。

---

## 2. testability gap 分析

读 `electron/main.ts` + `electron/engine-factory.ts` 后，确认 4 个 testability gap：

| # | 位置 | gap | 影响 |
|---|------|-----|------|
| G1 | `main.ts` L69-70 | `let coderEngine!` / `let judgeEngine!` 模块级私有 | 外部测试访问不到引擎实例 |
| G2 | `main.ts` L73 | `initEngines()` 无参，内部调 `createEngines()` | 无法注入 mock LLM |
| G3 | `main.ts` L144 | `registerIpcHandlers()` 无参，handler 闭包引用模块私有变量 | 测试拿不到 handler，也无法注入引擎 |
| G4 | `main.ts` L317 | `app.whenReady().then(...)` 是模块 import 时的 side-effect | 测试 import main.ts 会触发 Electron app lifecycle（启动窗口、初始化引擎） |

同时确认 `engine-factory.ts` L158 `createEngines(opts)` **已支持** `{coderLlm, judgeLlm}` 注入（macp3-C1 做的 hook）—— 这是关键复用点。但它**不支持**注入 sandbox/snapshot 端口，意味着走 createEngines 拿到的 coderEngine 会用真实 `sandboxManager` 单例（真 spawn 子进程）+ 真实 `new SnapshotManager()`（真硬链接快照），测试会变慢且依赖环境。

---

## 3. 方案选择

评估了 brief §6.3 的三个方案：

- **方案 A**（export createIpcHandlers，返回 handler 注册表）：最小改动，但 handler 调用不经 ipcMain.handle 注册表，"IPC 注册"语义弱；
- **方案 B**（vi.mock('electron') + import main.ts，靠 app.whenReady side-effect 触发注册）：最真，但 app lifecycle side-effect 难隔离；
- **方案 C**（混合：export registerIpcHandlers(engines?) + vi.mock('electron')）：覆盖最完整。

**选定方案 C 的简化版**（最小改动 + 最真语义）：

1. `main.ts`：`registerIpcHandlers` 加 `export` + 可选 `engines` 参数（缺省回退模块私有，业务路径行为不变）；
2. `engine-factory.ts`：`EngineFactoryOpts` 加 `coderSandbox?` / `coderSnapshot?`（最小 DI 扩展，避开真子进程）；
3. 测试：`vi.mock('electron')` 让 `ipcMain.handle` 把 handler 存进内存 Map（同时自身是 spy）+ `app.whenReady` 返回 pending promise（不触发 side-effect）；测试主动调 `registerIpcHandlers(bundle)` 注册，再从 Map 取 handler 调用。

这条路径同时验证：(a) handler 真经 `ipcMain.handle` 注册（spy 留证）；(b) handler 调用后路由到 engine-factory 产出的真实引擎；(c) LLM mock 被调；(d) ApiResponse 信封字段完整。

---

## 4. testability hook 改动详情（最小、可逆）

### 4.1 `electron/main.ts`（3 处改动）

**改动 ①**（L33）：import 补 `type EngineBundle`：
```ts
import { createEngines, type EngineBundle } from './engine-factory';
```

**改动 ②**（L156）：`registerIpcHandlers` 加 `export` + 可选 `engines` 参数 + coder/judge 局部变量：
```ts
export function registerIpcHandlers(engines?: EngineBundle): void {
  // testability hook：注入优先，缺省回退模块私有（业务路径行为不变）
  const coder = engines?.coderEngine ?? coderEngine;
  const judge = engines?.judgeEngine ?? judgeEngine;
  // ... 原有 20 个 ipcMain.handle / ipcMain.on 不变
}
```

**改动 ③**（L204 / L209 / L214 / L221 / L226）：5 处 handler 闭包内的引擎调用，从模块私有变量改为局部变量：
```ts
return coder.generateCode(req as GenerateCodeInput);   // 原 coderEngine.generateCode
return coder.applyFix(req as FixSpec);                 // 原 coderEngine.applyFix
return coder.runGwt(req as RunGwtInput);               // 原 coderEngine.runGwt
return judge.evaluateDocs(req as EvaluateDocsInput);   // 原 judgeEngine.evaluateDocs
return judge.evaluateCode(req as EvaluateCodeInput);   // 原 judgeEngine.evaluateCode
```

**业务路径不变**：L335 `app.whenReady().then(async () => { await initEngines(); registerIpcHandlers(); createWindow(); ... })` —— `registerIpcHandlers()` 无参调用，`engines` 缺省 → `coder`/`judge` 回退到模块私有 `coderEngine`/`judgeEngine`（initEngines 已赋值）。运行时行为零变化。

**为何最小**：仅 1 个函数签名加可选参数 + 5 处变量名替换，无新增分支、无新增模块、无业务逻辑改动。完全可逆（删 `engines?` 参数 + 把 `coder`/`judge` 换回 `coderEngine`/`judgeEngine` 即恢复原状）。

### 4.2 `electron/engine-factory.ts`（3 处改动）

**改动 ①**（L30-39）：import 补 `CoderSandboxPort` / `CoderSnapshotPort` 类型（这两个类型本就从 `coder-engine-stub.ts` export，L192-206）。

**改动 ②**（L45-63 / L61 / L63）：`EngineFactoryOpts` 加两个可选字段：
```ts
export interface EngineFactoryOpts {
  coderLlm?: CoderLlmClient;
  judgeLlm?: JudgeLlmClient;
  /** coder sandbox 端口；缺省走 sandboxManager 单例（业务路径）。E2E 测试注入 fake 避开真子进程。 */
  coderSandbox?: CoderSandboxPort;
  /** coder snapshot 端口；缺省走 new SnapshotManager()（业务路径）。E2E 测试注入 fake 避开真硬链接快照。 */
  coderSnapshot?: CoderSnapshotPort;
}
```

**改动 ③**（L181-185）：`createEngines` 透传 sandbox/snapshot 到 `createCoderEngine`：
```ts
const coderEngine = createCoderEngine({
  ...(coderLlm ? { llm: coderLlm } : {}),
  ...(opts.coderSandbox ? { sandbox: opts.coderSandbox } : {}),
  ...(opts.coderSnapshot ? { snapshotManager: opts.coderSnapshot } : {}),
});
```

**业务路径不变**：`main.initEngines()` 调 `createEngines()`（无参），不传 sandbox/snapshot → 条件展开为空 → `createCoderEngine({})` → 走默认 `sandboxManager` 单例 + `new SnapshotManager()`，与改动前完全一致。

**为何最小**：engine-factory 本就是 DI 入口（设计原则 §1.2「依赖注入」），扩展它接受更多可选 deps 符合其设计意图，无业务行为改动，无新增模块。

---

## 5. E2E 测试设计（`06_TESTS/e2e-ipc-cross-layer.test.ts`）

### 5.1 隔离策略

```ts
// vi.hoisted：ipcHandlers Map 在 vi.mock factory 与测试用例间共享
const { ipcHandlers } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((ch, fn) => { ipcHandlers.set(ch, fn); }),  // 注册时存 Map + 自身是 spy
    on:     vi.fn((ch, fn) => { ipcHandlers.set(ch, fn); }),
    removeAllListeners: vi.fn(),
  },
  app: { whenReady: () => new Promise<never>(() => {}) },     // pending → side-effect 不触发
  BrowserWindow: class { /* noop mock */ },
}));
```

- `vi.mock('electron')` 让 `ipcMain.handle` 把 handler 存进内存 Map + 自身是 spy（断言 `toHaveBeenCalled`）；
- `app.whenReady` 返回永不 resolve的 pending promise → main.ts 模块 import 时 `app.whenReady().then(...)` 回调永不执行 → `initEngines` / `registerIpcHandlers` / `createWindow` 的 side-effect 不跑（测试隔离，不启动真 Electron）；
- `vi.spyOn(globalThis, 'fetch')` 网络守卫（参考 `unit-llm-mock.test.ts` L32-37）—— 全程断言 `not.toHaveBeenCalled` = 未烧 token 硬证据；
- `fakeSandbox` / `fakeSnapshot`（参考 `e2e-coder-judge.test.ts` L31-81）避开真子进程 spawn 与硬链接快照。

### 5.2 断言链（4 维度，对应 DoD self_check）

| 维度 | 用例 | 断言 |
|------|------|------|
| **handler 真注册到 ipcMain** | it 1 | `expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith('coder:generateCode', expect.any(Function))` + Map 含 5 个关键 channel |
| **engine-factory 返回真实引擎（非 stub）** | it 2 | `expect(bundle.coderEngine).toBeInstanceOf(CoderEngine)` + `res.data.tokensUsed > 0`（stub fallback tokensUsed=0） |
| **LLM mock 真被调** | it 2/3 | `expect(mockCoderLlm.generate).toHaveBeenCalled()` / `expect(mockJudgeLlm.evaluateSoft).toHaveBeenCalledTimes(4)` |
| **response envelope 字段完整** | it 2/3 | `ok` / `requestId`（string, len>0）/ `durationMs`（number, ≥0）/ `data`（outputFiles/verdict）至少 4 字段 |

### 5.3 测试用例

```text
it 1: handler 真注册到 ipcMain（registerIpcHandlers 注册 coder/judge 关键 channel）
it 2: coder:generateCode handler → engine-factory 真实 CoderEngine → mockLlm.generate 被调 → ApiResponse 信封完整
it 3: judge:evaluateDocs handler → engine-factory 真实 JudgeEngine → mockLlm.evaluateSoft 被调 4 次 → 信封完整
```

it 2 还断言写盘真实（`outputDir/src/cli.ts` 存在 + 含 mock LLM 文本），证明 handler 调用后真实引擎的磁盘副作用真发生。

---

## 6. 真跑通证据（三重验证）

### 6.1 typecheck（`npx tsc --noEmit -p tsconfig.build.json`）

```text
=== EXIT: 0 ===
```
（main.ts / engine-factory.ts 改动类型正确，0 error）

### 6.2 build（`npm run build` = `tsc -p tsconfig.build.json`）

```text
=== EXIT: 0 ===
```
（compile 带 emit 通过，dist/ 产物正常）

### 6.3 vitest（`npx vitest run 06_TESTS/e2e-ipc-cross-layer.test.ts`）

```text
[main] IPC handlers registered: 20 endpoints (18 ipcMain.handle + 2 ipcMain.on)
[main] coder:generateCode req= { projectRoot: 'C:\\Users\\sir_c\\AppData\\Local\\Temp\\macp3-e2e-ipc-gencode-...',
  documentPaths: ['01_PRD/prd.md'], stage: 'coding', template: 'cli-script',
  outputDir: '...\\_code' }
[main] judge:evaluateDocs req= { projectRoot: '...', targetDirectory: 'all', enableSoftEval: true }

 ✓ 06_TESTS/e2e-ipc-cross-layer.test.ts (3 tests) 52ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  808ms
=== EXIT: 0 ===
```

**关键证据解读**：
- `[main] IPC handlers registered: 20 endpoints` —— `registerIpcHandlers` 真跑，20 个 handler 全注册（每个 it 都打印一次，因每个 it 独立调 registerIpcHandlers）；
- `[main] coder:generateCode req= {...}` —— handler 闭包真被调用并接收到入参（证明从 ipcHandlers Map 取出的 handler 真路由到了 engine）；
- `3 passed (3)` —— 全部测试用例 pass，0 skip，0 fail；
- `Duration 808ms` —— 测试快速稳定（fakeSandbox 避开真子进程，可复现）。

---

## 7. 与进程内集成的本质区别（多了哪一层）

| 维度 | 进程内集成（`e2e-coder-judge.test.ts`） | 本跨层 E2E（`e2e-ipc-cross-layer.test.ts`） |
|------|------------------------------------------|----------------------------------------------|
| 调用入口 | `createCoderEngine({llm}).generateCode(input)` 直接调引擎方法 | `ipcHandlers.get('coder:generateCode')(event, input)` 经 IPC handler |
| 经过的层 | test → engine | test → **`ipcMain.handle` 注册表** → **handler 闭包（main.ts L186-190）** → engine |
| handler 注册验证 | 无（根本没注册） | `expect(ipcMain.handle).toHaveBeenCalledWith('coder:generateCode', ...)` |
| 信封来源 | engine 内部 `okResponse`（直接拿到） | handler 闭包 `return coder.generateCode(req)` 透传 engine 的 ApiResponse |

**本质区别**：多了 `electron/main.ts` L144 `registerIpcHandlers` 这一层 **IPC 路由**——把 20 个 channel 名（`coder:generateCode` / `judge:evaluateDocs` / ...）映射到对应 handler 函数，handler 再路由到引擎方法。这是 Electron 主进程区别于纯 Node 库的核心结构（renderer 进程只能经 `ipcRenderer.invoke('coder:generateCode', req)` 调用，不能直接拿 engine 引用）。

进程内集成跳过了这一层（直接拿 engine 引用调方法），因此它**无法发现**：
- handler 是否正确注册到 ipcMain（channel 名拼写、注册遗漏）；
- handler 闭包是否正确解构 req 并传给 engine（类型断言 `req as GenerateCodeInput` 是否安全）；
- handler 返回的 ApiResponse 信封是否完整（ok/requestId/durationMs/data）。

本跨层 E2E 完整覆盖这 3 点，这正是 macp10「真系统 E2E」维度失分的部分，也是本任务回收 +4-6 分的依据。

---

## 8. self_check（对照 DoD）

| # | 检查项 | 通过 | 证据 |
|---|--------|------|------|
| 1 | deliverables/S1-e2e-report.md + .note.md 已落盘到 .context/trees/macp11/deliverables/ | ✅ | 本文件 + .note.md（含 mtime） |
| 2 | E2E 测试文件已落盘到 06_TESTS/（遵循 vitest.config.ts include 约定） | ✅ | `06_TESTS/e2e-ipc-cross-layer.test.ts`，匹配 `include: ['06_TESTS/**/*.test.ts']` |
| 3 | npx tsc --noEmit -p tsconfig.build.json exit 0 | ✅ | §6.1，EXIT 0，0 error |
| 4 | npm run build exit 0 | ✅ | §6.2，EXIT 0，dist/ 正常 |
| 5 | npx vitest run E2E 测试 exit 0 + 用例 pass（非 skip） | ✅ | §6.3，3 passed (3)，0 skip，EXIT 0 |
| 6 | 断言链完整：handler 被调 + engine-factory 真实引擎（非 stub）+ LLM mock 被调 + envelope ≥4 字段 | ✅ | §5.2 四维度全断言：`instanceof CoderEngine` + `tokensUsed>0` + `generate.toHaveBeenCalled` + `evaluateSoft.toHaveBeenCalledTimes(4)` + `ok/requestId/durationMs/data` |
| 7 | 报告说清与进程内集成的本质区别（多了哪一层） | ✅ | §7：多了 main.ts registerIpcHandlers 的 IPC 路由层 |
| 8 | testability hook 列出改了哪个文件哪几行 + 为何最小 | ✅ | §4：main.ts L33/L156/L204-226 + engine-factory.ts L30-39/L45-63/L181-185；业务路径行为零变化，可逆 |

---

## 9. 红线遵守

- 🚫 未改 coder/judge 引擎业务逻辑（仅 engine-factory 加可选 DI 字段 + main.ts handler 路由变量化）；
- 🚫 未派 create_session/fork_session 当 reviewer（macp2 红线）；
- 🚫 未裸改 tree-state.json（所有状态经 mcp__tree__*）；
- ✅ 探针/测试先落盘再写报告（F-E1-Y1 时序）；
- ✅ E2E 测试放 06_TESTS/（vitest.config.ts include 约定）；
- ✅ 网络守卫（fetchSpy not.toHaveBeenCalled）证明全程未烧 token。
