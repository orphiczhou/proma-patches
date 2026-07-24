# Drift UI 显示故障 — 深度审计报告

**审计时间**: 2026-07-24 11:00 (GMT+8)
**审计范围**: drift_history 修复部署后 Tree 面板仍不显示偏移记录
**结论**: 已定位根因 — **renderer 加载了错误的 proma-tree-view.js 副本**，修复写到了无人加载的孤立文件。

---

## TL;DR（一句话根因）

修复把新版 `proma-tree-view.js` 部署到了 `dist/proma-tree-view.js`（根目录），但 Electron renderer 实际加载的是 `dist/renderer/assets/proma-tree-view.js`（旧版，无 drift 渲染代码）。`dist/renderer/index.html:37` 的 `<script src="./assets/proma-tree-view.js">` 决定了 renderer 永远加载旧版。**IPC、CSS、数据全部正常，唯一断点在 renderer JS 文件错位。**

---

## 维度 1：部署完整性 — ❌ 故障定位点

### 发现 1.1：存在两个 proma-tree-view.js 副本（关键）

| 文件路径 | 修改时间 | 是否含「偏移记录」drift 区块 |
|---|---|---|
| `D:\Proma-dev\resources\app\dist\renderer\assets\proma-tree-view.js` | **2026-07-22 19:35:50**（旧） | ❌ 无（只渲染 nudge_log，line 731-751） |
| `D:\Proma-dev\resources\app\dist\proma-tree-view.js` | **2026-07-24 10:42:17**（今天，新） | ✅ 有（line 731-773，含 `hasDrift` + 偏移记录区块） |

**grep 证据**：
- `偏移记录` 全 dist 仅命中 1 个文件 → `dist\proma-tree-view.js`（根目录新版）。旧版 `renderer/assets/` 副本**不含该字符串**。
- 旧版 line 731-751 渲染逻辑：只 `if (leaf.nudge_log && leaf.nudge_log.length > 0)`，line 751 后直接收尾，**根本没有 drift_history 分支**。
- 新版 line 731-773：`const hasDrift = leaf.drift_history && leaf.drift_history.length > 0;`（line 733），line 754-773 渲染 `↕ 偏移记录` 区块。

### 发现 1.2：index.html 引用的是旧版副本

`D:\Proma-dev\resources\app\dist\renderer\index.html:37`：
```html
<script src="./assets/proma-tree-view.js"></script>
```
相对路径 `./assets/` 解析为 `dist\renderer\assets\proma-tree-view.js` → **旧版**。

### 发现 1.3：根目录新版是孤立副本，无人加载

全 `dist` 目录 grep `proma-tree-view\.js`，引用该文件的位置**只有一处**：
```
dist\renderer\index.html:37:  <script src="./assets/proma-tree-view.js"></script>
```
（其余命中来自 `*.bak-*` 备份文件的注释，非加载点。）
→ `dist\proma-tree-view.js`（根目录新版）**没有任何代码加载它**，是一次错误位置的部署。

### 发现 1.4：patches.cjs 是新版（部署正确）

`D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs` 修改时间 **2026-07-24 10:42:17**（今天），line 2154 含 `drift_history` 映射。main 进程 `require()` 的就是这份，所以 **IPC 侧修复确实生效了**——这解释了为什么"上次代码级审计通过"。

### 发现 1.5：无其他副本干扰

- `D:\Proma-dev\resources\app\dist\release\**\*proma-tree*` → 无文件（不存在 release/ 副本）。
- 无 `proma-tree*preload*` 文件（加载方式不是 preload 注入，是纯 `<script>` 标签）。

---

## 维度 2：IPC 运行时验证 — ✅ 正常

### 发现 2.1：IPC handler 正确映射 drift_history

`dist\proma-dev-patches.cjs` line 2133-2163 是活跃的 `get-tree-states` handler，遍历 `state.leaves` 构建返回对象，line 2154-2157：
```js
drift_history: Array.isArray(leaf.drift_history) ? leaf.drift_history.slice(-10).map(d => ({
  ts: d.ts, kind: d.kind, severity: d.severity, action: d.action,
  fork_to: d.fork_to, reason: d.reason
})) : [],
```
字段映射完整，与 renderer 新版消费的字段一致。

### 发现 2.2：真实 drift 数据存在（运行时证据）

13 个 tree-state.json 全部含 `drift_history` 键。实跑提取确认有真实条目：

```
TREE mltest  LEAF mltest-A1-worker  drift_count 1
  sample: {"ts":"2026-07-24T10:45:35.539+08:00",
           "leaf_id":"mltest-A1-worker","kind":"production",
           "severity":"high","action":"prune",
           "reason":"审计测试-违规显示"}
```

这条 drift 是**今天 10:45:35** 写入的（正是用户跑的审计测试）。IPC handler 会把它原样返回给 renderer。

**结论**：IPC 运行时层完全正常，数据存在、映射正确、会被返回。**不是根因。**（即便修好 renderer，这条 drift 立即可见，无需改动 IPC。）

---

## 维度 3：renderer 加载验证 — ❌ 与维度1 同一根因

### 发现 3.1：加载方式

`proma-tree-view.js` 通过 `dist\renderer\index.html` 的 `<script>` 标签同步加载（**非** preload 注入、**非**自定义 protocol）。Electron BrowserWindow 入口 HTML 即 `dist\renderer\index.html`。

### 发现 3.2：pro 重启无法解决

即使 pro 完全重启、renderer 进程重建，加载的**文件路径**仍指向 `dist\renderer\assets\proma-tree-view.js`（旧版文件本身未更新）。重启只刷新进程，不刷新错位的文件。这也是用户"已重启 pro 仍不显示"的直接原因。

### 发现 3.3：架构提示（为何会错位）

`dist\renderer\` 是 **Vite 构建产物目录**（佐证：`dist\renderer\assets\index-Id5HlP6C.css` 带内容哈希，是 Vite 风格输出）。renderer 真正的 JS 资产落点是 `dist\renderer\assets\`，**不是** `dist\` 根。而 main 进程的 `proma-dev-patches.cjs` 才是 `dist\` 根的居民。修复者把 renderer 侧的 JS 当成 main 侧文件，错误地拷到了 `dist\` 根。

---

## 维度 4：CSS 验证 — ✅ 完全正常

`dist\renderer\assets\proma-tree-view.css` 中 drift/违规渲染所需的 class **全部已定义**：

| CSS class | 定义行 |
|---|---|
| `.ptv-detail-section-title` | line 487 |
| `.ptv-violation-list` | line 496 |
| `.ptv-violation-entry` | line 502（含 `.dark` 变体 509-510） |
| `.ptv-violation-entry.ptv-severity-high` | line 513 (`#ef4444`) |
| `.ptv-violation-entry.ptv-severity-mid` | line 514 (`#f59e0b`) |
| `.ptv-violation-entry.ptv-severity-low` | line 515 (`#3b82f6`) |
| `.ptv-violation-sev.ptv-severity-high/mid/low` | line 533-535 |

**结论**：CSS 无缺失、无 `display:none` 隐藏。drift 条目一旦被新版 JS 渲染即可正常可见。**不是根因，无需改动。**（这些 class 旧版也在用，nudge_log 之所以能正常显示正是因为 CSS 没问题。）

---

## 根因定位（为什么部署了却不显示）

**部署目标文件错位。** 修复者更新了两个文件：
1. `dist\proma-dev-patches.cjs`（main 进程加载） ✅ 位置正确 → IPC 修复生效
2. `dist\proma-tree-view.js`（根目录） ❌ **位置错误** → 无任何代码加载

renderer 实际入口是 `dist\renderer\index.html`，它通过 `./assets/proma-tree-view.js` 加载 `dist\renderer\assets\proma-tree-view.js`（旧版，2026-07-22，无 drift 渲染分支）。两份 JS 不同步，renderer 永远拿不到新版。

> 上次"代码级审计通过"是因为审计看到的是 `dist\proma-tree-view.js`（新版，含 hasDrift）和 `patches.cjs`（含 drift_history IPC）——两份被改的文件代码都对，但漏检了"renderer 到底加载哪一份"这一运行时事实。

---

## 修复方案

### 方案 A（最快，立即可用）— 把新版覆盖到正确位置

```bash
# Windows CMD:
copy /Y "D:\Proma-dev\resources\app\dist\proma-tree-view.js" "D:\Proma-dev\resources\app\dist\renderer\assets\proma-tree-view.js"
```
然后**重启 pro**（或对 Tree 面板所在窗口按 Ctrl+R 重载 renderer，比整程重启快）。

### 方案 B（根治，避免再次错位）

`dist\renderer\` 是 Vite 构建产物。源码改动后应**跑构建**让产物正确落到 `dist\renderer\assets\`，而不是手动拷到 `dist\` 根。需定位源码工程（当前 `D:\Codes\multi-agent-collab-platform` 下未发现 `proma-tree-view.js` 源文件，可能在另一仓库或 monorepo 子包），执行构建命令重新产出。

### 方案 C（防御性校验，防回归）

构建/部署流水线末尾加一步断言脚本：
```bash
# 断言真正被加载的 renderer 副本含 drift 渲染逻辑
grep -c "偏移记录" "D:\Proma-dev\resources\app\dist\renderer\assets\proma-tree-view.js"
# 期望 >=1；为 0 则部署错位，立即失败
```

### 附加清理

- `dist\proma-tree-view.js`（根目录孤立副本）：建议删除，或在文件头加注释说明"实际加载的是 renderer/assets/ 版本，本文件仅作主进程参考"，避免日后再次混淆。
- 同理 `dist\proma-dev-patches.cjs.bak-pre-drift` / `.bak-pre-ABC-mltest` 等备份：确认无需后清理。

---

## 验证步骤（应用方案 A 后）

1. 执行方案 A 的 copy 命令。
2. 重启 pro（或 Ctrl+R 重载 renderer）。
3. 打开 Tree 面板 → 找 **mltest** tree。
4. 点击 leaf **`mltest-A1-worker`** → 详情面板应出现：
   - `↕ 偏移记录 (1)` 标题
   - 一条 high 严重度（红色左边框 `#ef4444`）条目：`production · prune` / `high` / 相对时间
   - evidence 行：`审计测试-违规显示`
5. 若可见 → 故障修复确认。若仍不可见 → 打开 DevTools 看 console 报错（届时才需排查 renderer 异常，但本次审计已排除该可能）。

---

## 审计维度小结

| 维度 | 结论 | 关键证据 |
|---|---|---|
| 1 部署完整性 | ❌ 根因 | 两副本；index.html:37 加载旧版；根目录新版孤立 |
| 2 IPC 运行时 | ✅ 正常 | patches.cjs:2154 映射；mltest 真实 drift 数据存在 |
| 3 renderer 加载 | ❌ 同根因 | `<script>` 加载 `./assets/` 旧版；重启不刷新错位文件 |
| 4 CSS | ✅ 正常 | ptv-* class 全定义于 proma-tree-view.css:487-535 |

**唯一需要动手的修复**：把新版 `proma-tree-view.js` 放到 `dist\renderer\assets\`（方案 A），或重建（方案 B）。
