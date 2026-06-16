# Agent 执行提示词

> 复制粘贴给任意 Agent，让它帮你安装/卸载这个补丁包。

---

## 安装提示词

```
请帮我安装 Proma 会话管理补丁包。

前置条件：Proma 商业版已安装在 D:\Proma\，Node.js >= 18。
你当前在 https://github.com/orphiczhou/proma-patches 仓库根目录。

执行方式一（一键）：
bash apply-patches.sh

执行方式二（交互）：
请先问我：部署方式选哪个？A=双开开发版(推荐) B=Release并行版 C=直接改正式版(不推荐)
需要哪些增强模块？1=DeepSeek子Agent升级 2=会话管理MCP工具 3=元数据覆盖 4=UI同步 5=外部MCP 6=图标替换
等我回复后再按 README.md 执行对应步骤。

安装后验证：
1. 双击 D:\Proma-dev\start-dev.bat 启动
2. 检查 ~/.proma-dev/mcp-bridge-port.json
3. 开 Agent 会话说"用 list_channels 列出 AI 渠道"
```

---

## 卸载提示词

```
请帮我卸载 Proma 会话管理补丁：
bash uninstall.sh
# 或手动：
rm -rf D:/Proma-dev && rm -rf ~/.proma-dev
```

---

## 使用示例

安装后可在 Agent 会话中说：

> "用 list_channels 看有哪些模型，create_session 开一个 deepseek-v4-flash 会话，send_message 让它实现排序函数。"

> "我开了 3 个开发会话。用 get_session_context 监控 token 用量。"

> "list_messages 找到第2轮回复的 UUID，fork_session 从那里截断重试。"

---

## Claude Code 外部 MCP 配置

```json
{
  "mcpServers": {
    "proma-session": {
      "command": "node",
      "args": ["D:\\Proma-dev\\resources\\app\\dist\\proma-mcp-server.cjs"]
    }
  }
}
```
