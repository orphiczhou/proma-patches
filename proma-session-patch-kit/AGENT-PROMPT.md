# Agent 执行提示词

> 把下面的提示词复制粘贴给任意 Agent（Proma Agent / Claude Code），让它帮你安装这个补丁工具包。

---

## 安装提示词

```
请按照以下步骤，在 D:\Proma\ 的基础上创建 D:\Proma-dev\ 开发版，并安装会话管理补丁工具包：

## 前置条件
- Proma 商业版已安装在 D:\Proma\
- Node.js >= 18
- 当前目录是补丁工具包根目录（包含 apply-patches.sh）

## 执行方式

直接运行一键安装脚本：

```bash
bash apply-patches.sh
```

如果脚本执行遇到问题，请参考 README.md 中的手动安装步骤逐一排查。

## 安装后验证

1. 确认 D:\Proma-dev\start-dev.bat 已创建
2. 确认 D:\Proma-dev\resources\app\dist\proma-dev-patches.cjs 存在
3. 确认 D:\Proma-dev\resources\app\dist\proma-mcp-server.cjs 存在

## 11 个 MCP 工具

安装后 Agent 自动获得以下工具：
- get_my_session_id: 获取自己会话 ID
- list_channels: 列出 AI 渠道和模型
- list_workspaces: 列出工作区
- list_sessions: 列出会话（支持工作区过滤）
- get_session_info: 会话详情
- get_session_context: token 用量/上下文窗口
- list_messages: 消息历史（UUID/角色/文本/分页）
- create_session: 创建新会话
- fork_session: Fork 会话（支持 UUID 截断）
- send_message: 向会话发消息（wait=true 返回 Agent 输出）
- archive_session: 归档/取消归档会话
```

---

## 卸载提示词

```
请删除 Proma 会话管理补丁：

```bash
bash uninstall.sh
```

手动卸载：
```bash
rm -rf D:/Proma-dev
rm -rf ~/.proma-dev
rm -rf %APPDATA%/@proma/electron-dev
```

---

## 使用示例提示词

Agent 安装完成后，你可以在 Proma 的 Agent 会话中直接说：

> "用 list_channels 看看有哪些模型可用，然后用 create_session 开一个 deepseek-v4-flash 的会话，再 send_message 让它实现一个排序函数。"

> "我开了 5 个开发会话在并行工作。用 get_session_context 帮我监控它们的 token 用量。"

> "这个会话方向有点问题。用 list_messages 查看消息历史，找到第 2 轮 assistant 回复的 UUID，用 fork_session 从那里截断重试。"
