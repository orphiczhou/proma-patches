# P3 via canUseTool 失败 + PreToolUse 转向（调研轮）

> 日期 2026-07-23 | 调研子会话 dab6b414 + 父会话实证调试
> 结论：canUseTool 在 bypassPermissions（默认）下**不被调用** → P3 放 canUseTool 无效；正确载体是 SDK PreToolUse hook。

## 尝试：P3 放 canUseTool（main.cjs:484827 switch 前）

按 02-research 推荐插入：Write/Edit/MultiEdit 命中 tree-state.json/call-log.jsonl/.lock → deny。语法过、部署 dev/pro、restart。

## 实证：失败（debug 铁证）

测试子会话（dev f3a24ba2）直接 Write `systest/tree-state.json` → **成功**（未被拦）。在 P3 加文件日志 `p3-debug.log` 记 canUseTool 调用 → **重启 dev + 重新 Write 后日志文件不存在**（canUseTool 对 Write 完全没被调用）。

## 根因（推翻 02-research 的假设）

02-research 称"bypassPermissions 下 canUseTool 仍生效"——**错误**。实测：Proma bypass 模式 = SDK `allowDangerouslySkipPermissions=true` → **SDK 跳过 canUseTool，所有工具自动放行**。canUseTool 只在 plan/normal 模式被调用（plan 模式写保护靠它）。Proma 默认 bypass → canUseTool 形同虚设。

证据：canUseTool 的 `switch(currentMode)` 里 bypass case（484828-484829）`return allow`；但 bypass 下 SDK 根本不调 canUseTool（allowDangerouslySkipPermissions 绕过），所以连这个 case 都走不到。

## 处置

- 回退 main.cjs 的 canUseTool P3 插入（部署版恢复干净，`switch (currentMode) {` 原样）。
- dev/pro 内存仍是回退前的 P3+debug 版——**需 restart 加载干净版**（低优：debug 只在 plan 模式写日志，bypass 下无害）。

## 正确转向：SDK PreToolUse hook

main.cjs:441325 `hooks: { Stop: [...] }`——SDK 支持 hooks。PreToolUse 是标准 SDK hook，**独立于权限模式，bypass 也触发**。格式（待验证返回字段）：
```js
hooks: { Stop: [...], PreToolUse: [{ hooks: [async (h) => {
  if ((h.tool_name==="Write"||h.tool_name==="Edit") && /tree-state\.json$/.test(String(h.tool_input?.file_path||"").replace(/\\/g,"/"))) {
    return { /* deny 格式待验：permissionDecision:"deny" 或 decision:"block" */ };
  }
  return {};
}] }] }
```
下一步：核实本构建 SDK 的 PreToolUse 返回格式（deny/block 字段）+ 实施 + bypass 实测。

## P2（篡改检测）未动

P2（write_count+SHA-256 在 tree-engine.cjs）与权限模式无关，是 mode-independent 的可靠兜底。建议与 PreToolUse P3 并行推进——P3 预防（hook 拦前面），P2 检测（兜底 Bash 路径）。

## 本轮 net 改动

- main.cjs：0（P3 插入已回退，净零）。
- tree-engine.cjs / patches.cjs：0（本轮没动；A+B+C 是上一轮 7350492）。
- 本档案：记录 canUseTool-bypass 发现 + PreToolUse 转向。
