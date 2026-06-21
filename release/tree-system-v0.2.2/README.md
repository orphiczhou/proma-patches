# 树形会话执行体系 v0.2.2 + TAO 天道运行官 + 补丁 L

> 版本: v0.2.2 | 日期: 2026-06-21
> 包含: tree-state.js v0.2.2 硬化 + TAO v0.1-TAO + 树形 UI 面板（补丁 L）

---

## 一、内容清单

### `core/`
- `tree-state.js` (v0.2.2, ~1900行) — 主状态机
  - 阶段一硬化：cmdInit 自动 root leaf、UUID 校验、added_by 追溯、pending_brief 状态、worker done 前置 events 检查
  - 阶段二 TAO：audit gate/append、nudge append/reset 4 个新子命令
  - migrate 扩展：补 TAO 字段、ROOT_PLACEHOLDER→PENDING_ROOT、worker active→pending_brief

### `tao/` (天道运行官 v0.1-TAO)
- `tao-rules.json` — 35 条规则（Commander 16 + Worker 13 + Root 6）
- `tao-audit-prompt.md` — 审计 Agent prompt 模板
- `tao-nudge-template.md` — 鞭策消息三级模板
- `tao-watcher-prompt.md` — 主循环 prompt（interval=60s automation）
- `tao-health-check-prompt.md` — 自检 prompt（interval=60s automation）

### `patch-l/` (树形 UI 面板，补丁 L v0.17)
- `proma-tree-view.js` (~280行) — vanilla JS 渲染树形 DOM
- `proma-tree-view.css` (~250行) — 树形样式 + 暗色主题
- `proma-dev-patches.cjs` — IPC handler 注册（get-tree-states / navigate-to-session）
- `preload.cjs` — contextBridge 暴露 promaTreeIpc 给 renderer
- `index.html` — 注入 link+script 引用

---

## 二、部署

### Dev 实例

```bash
# 1. 复制核心文件
cp core/tree-state.js        ~/.proma/agent-workspaces/proma/workspace-files/.context/trees/
cp tao/tao-*.{json,md}       ~/.proma/agent-workspaces/proma/workspace-files/.context/trees/

# 2. 部署补丁 L（覆盖 D:/Proma-dev）
cp patch-l/proma-tree-view.js   D:/Proma-dev/resources/app/dist/renderer/assets/
cp patch-l/proma-tree-view.css  D:/Proma-dev/resources/app/dist/renderer/assets/
cp patch-l/proma-dev-patches.cjs D:/Proma-dev/resources/app/dist/
cp patch-l/preload.cjs          D:/Proma-dev/resources/app/dist/
cp patch-l/index.html           D:/Proma-dev/resources/app/dist/renderer/

# 3. 关闭 Dev 实例 → 重启
D:\Proma-dev\start-dev.bat
```

### Release 实例（可选）

```bash
# ASAR 不解包，插件放 asar 同级 dist/
cp patch-l/proma-tree-view.js   D:/Proma-release/resources/app/dist/renderer/assets/
# ... (其他文件同上，路径换成 Proma-release)
```

---

## 三、Proma automation 部署

通过 Proma 桌面应用的自动任务管理页面，或调用 `mcp__automation__create_automation`：

| 任务名 | interval | sessionMode | prompt 来源 |
|--------|---------|------------|-------------|
| TAO-Watcher | 60s | daily | `tao/tao-watcher-prompt.md` |
| TAO-HealthCheck | 60s | daily | `tao/tao-health-check-prompt.md` |

当前实例已创建：
- TAO-Watcher: `0ad8be80-d22f-4574-860e-745f3afd87fd`
- TAO-HealthCheck: `16f0e1bd-d4f8-4734-9353-a880cd2e4c12`

---

## 四、变更要点

### v0.2.2 硬化（vs v0.2.1）

| # | 变更 | 影响 |
|---|------|------|
| 1 | cmdInit 自动创建 root leaf（session_id: --session-id → PROMA_SESSION_ID → PENDING_ROOT） | 堵住 ROOT_PLACEHOLDER 漏洞 |
| 2 | 新增 `leaf set-session` 子命令 | 修正 PENDING_ROOT |
| 3 | cmdLeafAdd UUID 校验 + added_by 强制 | 堵住 CLI 手动注入 |
| 4 | Worker 初始 status=pending_brief | brief_echo 前不可 done |
| 5 | Worker done 前置 events 检查（≥2 含 brief_echo+done） | 堵住 Events 空洞 |
| 6 | validate 新增 root_session_not_real / added_by 追溯 / pending_brief 角色合法性 | 数据完整性 |
| 7 | migrate 扩展（补 TAO 字段、修正历史数据） | 向后兼容 |

### TAO v0.1

- 35 条规则覆盖方法论铁律
- 4 个新子命令：audit gate/append + nudge append/reset
- cmdLeafSetStatus 入口 audit_gate 检查 → E_GATEKEEPER_REQUIRED
- 2 个 Proma automation（Watcher + HealthCheck）

### 补丁 L

- 不修改 main.cjs（AGPL 合规）
- IPC handler 注册在 proma-dev-patches.cjs 加载时
- preload.cjs 通过 contextBridge 暴露 promaTreeIpc
- vanilla JS 渲染，不依赖 React 渲染周期
- 3 秒轮询自动刷新
- 点击节点复制 session_id（fallback）或触发 IPC 导航

---

## 五、已知限制

- **路径校验**：本版本补丁 L 的 IPC handler 在 dev 实例（ISOLATED=1）下能自动找到 `~/.proma/agent-workspaces/proma/workspace-files`。Release 实例（ISOLATED=0 共享正式版数据）需要设置 `PROMA_WORKSPACE_ROOT` 环境变量
- **导航 API**：点击节点目前 fallback 为复制 session_id 到剪贴板 + 提示。真正的 session 切换需要后续 grep main.cjs 定位 navigate 函数
- **侧边栏锚点**：通过 CSS 选择器 `.sidebar / aside / [class*="sidebar"]` 定位。Proma UI 变更后选择器可能失效，会 fallback 为浮动面板
- **bverify / retest / real**：早期污染数据（多 parent=null leaf），无法 migrate，需手动重建或归档

---

## 六、验证

### tree-state.js smoke test

```bash
cd ~/.proma/agent-workspaces/proma/workspace-files/.context/trees
node tree-state.js init testv22 --root-brief '{}' --root-dod '{}' \
  --session-id 00000000-0000-4000-8000-000000000001
node tree-state.js validate testv22  # 应 ok=true
```

### TAO 全链路 smoke test

参见 commit `1c55397` 中的 `taotest` tree：
- Worker pending_brief → audit_gate=required → 补 events → audit pass → done ✓

### 补丁 L UI 验证（手动）

1. 重启 Dev 实例
2. 打开 Proma，侧边栏顶部应出现"🌳 任务树"面板
3. 3 秒内应自动加载 tree 数据
4. 点击节点应触发复制 session_id 或导航提示
5. F12 开 DevTools，Console 应无错误
