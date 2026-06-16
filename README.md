# Proma 定制补丁集

> 基于 Proma 商业版 v0.12.23，通过 sed 补丁 + 插件文件增强 Agent 能力。
> **给人看也给 Agent 看 — Agent 读完后能交互式帮用户安装。**

## 快速开始（给 Agent）

如果用户让你"给 Proma 打补丁"或"安装 Proma 增强"，请：

1. 询问用户 Proma 路径和是否需要双开
2. 列出可选模块让用户勾选：
   - **A. 双开开发版**（推荐基础）
   - **1. DeepSeek 子Agent V4 Pro**
   - **2. 10 个 MCP 会话工具**（创建/查询/Fork/发送消息/上下文）
   - **3. 频道+模型元数据覆盖**
   - **4. UI 模型同步**
   - **5. 外部 MCP 服务**（跨实例）
   - **6. 白色托盘图标**
3. 按本 README 各模块的 sed 命令执行安装
4. 部署插件文件并验证

## 详细安装步骤

见各模块章节。完整技术 Wiki 见 `proma-dev-wiki.md`，插件源码见 `proma-dev-patches.cjs`，外部 MCP 桥接见 `proma-mcp-server.cjs`。

## 许可证

补丁命令和插件代码为独立作品，基于对 Proma（AGPL-3.0）运行时环境的互操作。按 MIT 许可发布。