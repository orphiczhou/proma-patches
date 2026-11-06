# results.md — PR 20261107-model-context 实施 + 验证结果

## 实施

- `apply-model-context-patch.cjs` 幂等应用于两处部署版 main.cjs，7/7 项全部 APPLY：
  1. claude 数组 += `claude-opus-5`、`claude-haiku-5`
  2. deepseek += `deepseek-flash`
  3. glm += `glm-5.3`
  4. mimo += `mimo-v2.6`
  5. minimax += `m3.1`
  6. kimi += `kimi-k3`（原 `"k3"` 为 ≤3 字符精确模式，命不中 `kimi-k3`）
  7. exclude `["haiku"]` → `["haiku-3", "haiku-4"]`（官方标注 1M 的 haiku-5-5 放行，旧 haiku 保持 200K）
- 二次重跑 0 applied / 7 skipped，幂等确认。
- PROVIDER_RULES 均 spread 引用 RULES，自动跟随，无需改动。

## 验证

| 项 | 结果 |
|---|---|
| `node --check` release | PASS |
| `node --check` dev | PASS |
| 补丁后双实例 md5 一致 | `7464b1588589a14ae4c6ec7ab7ff63f6` |
| 逻辑断言（verify-model-context.cjs，从补丁后文件提取真实模块代码执行） | release 25/25 PASS，dev 25/25 PASS |
| dev 重启加载 | restart-dev.ps1（ISOLATED=1）成功，Proma-white 4 进程运行 |

断言覆盖：13 个新模型 → 1M（glm-5.3 全系、deepseek-flash、claude-opus-5-5/sonnet-5-5/haiku-5-5/fable-5-1、kimi-k3、mimo-v2.6 双型号、M3.1-Flash-Preview）；7 个旧模型回归保持 1M（glm-5.2、deepseek-v4-pro、deepseek-v4.1-flash、minimax-m3、mimo-v2.5、claude-sonnet-4-6、k3）；5 个反向控制保持 200K（glm-5.1、glm-5-turbo、MiniMax-M2.7-highspeed、claude-haiku-4-5、glm-4.6）。

## 部署状态

- dev：已重启生效（新会话即按新规则推断 contextWindow）。
- release：**需用户手动重启 Proma-blue** 后生效（绝不 kill 宿主）。
- 备份：两处 `main.cjs.bak-pre-modelctx-20261107`，恢复即可回滚。

## 运行时验证边界

dev 实例内实际会话的 context_window 事件未实测（dev MCP 渠道当前禁用，无远程会话工具）；静态链路已完整验证：Pi 会话 contextWindow = max(catalog, inferred)，catalog 缺失新模型时 inferred=1M 为唯一来源。用户在 dev/release 打开 glm-5.3-flash 等新模型会话后，上下文用量环应按 1M 刻度显示。

## 证据备忘

- 权威依据：`~/.proma/channels.json` 与 `~/.proma-dev/channels.json` proma-official 渠道 agentModels 的 contextWindow 官方标注（deepseek-flash/glm-5.3 系/claude-5-5 系/kimi-k3 = 1M）。
- pi-ai catalog（models.generated.js，两实例同版本 `d89c158...`）：glm-5.3、deepseek-flash、mimo-v2.6、M3.1 均缺失定义；glm-5/5.1/turbo=200K、M2.7=204800 为反向证据（不加规则）。
- proma-official 渠道模型（gpt-6.1=500K、gpt-6-astra=372K、gemini=1M）走显式 modelContextWindow 配置，不依赖规则，未改动。
