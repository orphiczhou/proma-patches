# PR 20261107-model-context：模型上下文参数更新（1M 规则补齐）

## 根因

main.cjs 的 `context-window` 模块（`AGENT_SDK_1M_CONTEXT_RULES` + `CONTEXT_WINDOW_CONFIG.exclude`）落后于 2026-11 模型阵容。Pi 会话 contextWindow = `max(catalog, inferAgentSdkContextWindow(model, provider))`，而 pi-ai catalog（models.generated.js，两实例 md5 `d89c158...` 一致）对 5.3/M3.1/v2.6/deepseek-flash 等新模型**缺失定义**，规则又不命中 → 一律回落 200K。真实模型 1M 上下文被压到 200K：usage_pct 虚高 ~5x、过早 compact（同 macp6「GLM-5.2 context 计算不准」根因家族，当时 glm-5.2 尚未进规则）。

## 证据（contextWindow 权威值）

来源 A：两实例 `~/.proma{,-dev}/channels.json` proma-official 渠道 agentModels（Proma 官方下发标注）：
- deepseek-flash=1M；glm-5.3 / glm-5.3-flash / glm-5.3-flashx=1M
- claude-opus-5-5 / sonnet-5-5 / haiku-5-5 / fable-5-1=1M；kimi-k3=1M
- gpt-6.1-sol/terra=500K、gpt-6-astra=372K（proma 渠道走显式配置，不依赖规则，不改）
来源 B：pi-ai catalog 快照（系列一致性）：xiaomi mimo v2-pro/v2.5 全系=1048576；minimax M3=1M（M2.7=200K）。
反向证据（不加）：glm-5/glm-5.1/glm-5-turbo catalog=200K；MiniMax-M2.7 catalog=204800；glm-4.x 非 1M。

## 改动点（main.cjs，两处部署版：D:/Proma-release 与 D:/Proma-dev 同 md5 `6d2ef55a...`）

文件内位置：`../../packages/shared/src/utils/context-window.ts` 模块（release 行 1886-1944 附近）。

1. `claude` 数组追加 `"claude-opus-5"`、`"claude-haiku-5"`（子串匹配已覆盖 opus-5-5 / haiku-5-5；fable-5-1、sonnet-5-5 由既有 fable-5 / sonnet-5 覆盖，无需改）。
2. `deepseek: ["deepseek-v4"]` → `["deepseek-v4", "deepseek-flash"]`（v4 前缀已覆盖 v4-pro / v4.1-flash）。
3. `glm: ["glm-5.2"]` → `["glm-5.2", "glm-5.3"]`（覆盖 GLM-5.3 / -flash / -flashx）。
4. `mimo: ["mimo-v2.5"]` → `["mimo-v2.5", "mimo-v2.6"]`。
5. `minimax: ["minimax-m3"]` → `["minimax-m3", "m3.1"]`（M3.1-Flash-Preview）。
6. `kimi: ["k3"]` → `["k3", "kimi-k3"]`（≤3 字符 pattern 是精确/前缀`[`匹配，命不中 `kimi-k3`）。
7. `exclude: ["haiku"]` → `["haiku-3", "haiku-4"]`：旧 haiku 保持 200K，官方标注 1M 的 haiku-5-5 放行（claude-haiku-5 规则命中）。

PROVIDER_RULES（anthropic/deepseek/zhipu-coding/minimax/xiaomi/ark-coding-plan/kimi-*）均 spread 引用 RULES，自动跟随，无需改。

## 风险评估

- Pi 会话（主流使用）：规则只影响 contextWindow 推断，模型 ID 原样发送（484920 注释：pi 不追加 [1m]）→ 无 API 兼容风险。
- Claude Agent SDK 会话：resolveAgentSdkModelId 会为新 pattern 追加 `[1m]` 后缀。与既有 glm-5.2/deepseek-v4 行为同构；claude-haiku-5-5 走 anthropic 时 [1m] 若端点不支持会报模型不存在——该模型仅存在于 proma-official 渠道（显式 contextWindow、渠道当前禁用），实际暴露面≈0。观察项，不阻断。
- 误伤面：`m3.1`、`glm-5.3` 等子串在两实例渠道模型清单内无其他撞名 id。

## 测试计划

1. 补丁幂等：重复执行二次校验（已应用则跳过）。
2. `node --check` 两处 main.cjs。
3. 逻辑单测：node 加载补丁后的规则段，断言 supports1MContext 推断表（glm-5.3-flash→1e6、deepseek-flash→1e6、kimi-k3→1e6、MiniMax-M2.7-highspeed→2e5、glm-5.1→2e5、claude-haiku-5-5→1e6、claude-haiku-4-5→2e5）。
4. 部署验证：restart dev（PROMA_INSTANCE_ISOLATED=1），dev 内新会话确认 glm-5.3-flash 用量刻度按 1M 计算。release 需用户手动重启。

## 回滚

两处备份 `main.cjs.bak-pre-modelctx-20261107`，恢复备份即可。
