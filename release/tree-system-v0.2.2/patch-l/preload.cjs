"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/preload/index.ts
var index_exports = {};
module.exports = __toCommonJS(index_exports);
var import_electron = require("electron");

// ../../packages/shared/src/types/runtime.ts
var IPC_CHANNELS = {
  /** 获取运行时状态 */
  GET_RUNTIME_STATUS: "runtime:get-status",
  /** 重新初始化运行时（用户安装完 Git/Node 后触发） */
  REINIT_RUNTIME: "runtime:reinit",
  /** 获取指定目录的 Git 仓库状态 */
  GET_GIT_REPO_STATUS: "git:get-repo-status",
  /** 获取未暂存的变更文件列表 */
  GET_UNSTAGED_CHANGES: "git:get-unstaged-changes",
  /** 获取单个文件的 diff */
  GET_FILE_DIFF: "git:get-file-diff",
  /** 获取未追踪文件内容 */
  GET_UNTRACKED_CONTENT: "git:get-untracked-content",
  /** 还原文件变更 */
  REVERT_FILE: "git:revert-file",
  GET_DIFF_CONTENTS: "git:get-diff-contents",
  /** 列出 Git Worktree */
  LIST_WORKTREES: "git:list-worktrees",
  /** 获取 Worktree 相对于基准分支的全量变更 */
  GET_WORKTREE_CHANGES: "git:get-worktree-changes",
  /** 在系统默认浏览器中打开外部链接 */
  OPEN_EXTERNAL: "shell:open-external",
  /** 用系统默认应用打开任意文件 */
  SYSTEM_OPEN_FILE: "shell:system-open-file",
  /** 扫描系统中可用的编辑器应用 */
  SCAN_EDITORS: "shell:scan-editors",
  /** 查询某个文件在本机系统中的默认打开应用信息（带图标） */
  GET_DEFAULT_APP_FOR_FILE: "shell:get-default-app-for-file",
  /** 打开独立预览窗口 */
  OPEN_DETACHED_PREVIEW: "preview:open-detached",
  /** 获取独立预览窗口数据 */
  GET_DETACHED_PREVIEW_DATA: "preview:get-detached-data",
  /** 最小化窗口 */
  WINDOW_MINIMIZE: "window:minimize",
  /** 最大化/还原窗口 */
  WINDOW_MAXIMIZE: "window:maximize",
  /** 关闭窗口 */
  WINDOW_CLOSE: "window:close",
  /** 窗口是否最大化 */
  WINDOW_IS_MAXIMIZED: "window:is-maximized",
  /** 截图导出：将 HTML 渲染为 PNG 图片 */
  SCREENSHOT_CAPTURE: "screenshot:capture"
};
var SCREENSHOT_LIMITS = {
  /** 渲染端预检：编辑器 DOM 元素数上限。超过会导致 inlineComputedStyles 卡顿明显 */
  MAX_ELEMENTS: 3e3,
  /** 渲染端预检：原始 outerHTML 字节数上限（不含 inline 样式）。膨胀系数 5-10× 对应主进程 12MB */
  MAX_RAW_HTML_BYTES: 2 * 1024 * 1024,
  /** 主进程兜底：含 inline 样式的 HTML 字节数上限 */
  MAX_HTML_BYTES: 12 * 1024 * 1024,
  /** 主进程兜底：渲染像素预算（width × height × scale²）。4 字节/像素 ≈ 400MB */
  MAX_PIXELS: 1e8,
  /** 输出图片宽度下限 */
  MIN_WIDTH: 480,
  /** 输出图片宽度上限。渲染端与主进程统一 */
  MAX_WIDTH: 1600
};

// ../../packages/shared/src/types/channel.ts
var CHANNEL_IPC_CHANNELS = {
  /** 获取所有渠道列表 */
  LIST: "channel:list",
  /** 创建渠道 */
  CREATE: "channel:create",
  /** 更新渠道 */
  UPDATE: "channel:update",
  /** 删除渠道 */
  DELETE: "channel:delete",
  /** 解密获取明文 API Key */
  DECRYPT_KEY: "channel:decrypt-key",
  /** 测试渠道连接 */
  TEST: "channel:test",
  /** 从供应商拉取可用模型列表 */
  FETCH_MODELS: "channel:fetch-models",
  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  TEST_DIRECT: "channel:test-direct"
};

// ../../packages/shared/src/types/proxy.ts
var PROXY_IPC_CHANNELS = {
  /** 获取代理配置 */
  GET_SETTINGS: "proxy:get-settings",
  /** 更新代理配置 */
  UPDATE_SETTINGS: "proxy:update-settings",
  /** 检测系统代理 */
  DETECT_SYSTEM: "proxy:detect-system"
};

// ../../packages/shared/src/types/chat.ts
var MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
var CHAT_IPC_CHANNELS = {
  // 对话管理
  /** 获取对话列表 */
  LIST_CONVERSATIONS: "chat:list-conversations",
  /** 创建对话 */
  CREATE_CONVERSATION: "chat:create-conversation",
  /** 获取对话消息（全部） */
  GET_MESSAGES: "chat:get-messages",
  /** 获取对话最近 N 条消息（分页加载） */
  GET_RECENT_MESSAGES: "chat:get-recent-messages",
  /** 更新对话标题 */
  UPDATE_TITLE: "chat:update-title",
  /** 删除对话 */
  DELETE_CONVERSATION: "chat:delete-conversation",
  /** 更新对话使用的模型/渠道 */
  UPDATE_MODEL: "chat:update-conversation-model",
  // 消息发送
  /** 发送消息（触发 AI 流式响应） */
  SEND_MESSAGE: "chat:send-message",
  /** 中止生成 */
  STOP_GENERATION: "chat:stop-generation",
  /** 删除消息 */
  DELETE_MESSAGE: "chat:delete-message",
  /** 从指定消息开始截断后续消息（包含该消息） */
  TRUNCATE_MESSAGES_FROM: "chat:truncate-messages-from",
  /** 更新上下文分隔线 */
  UPDATE_CONTEXT_DIVIDERS: "chat:update-context-dividers",
  /** 生成对话标题 */
  GENERATE_TITLE: "chat:generate-title",
  // 附件管理
  /** 保存附件到本地 */
  SAVE_ATTACHMENT: "chat:save-attachment",
  /** 读取附件（返回 base64） */
  READ_ATTACHMENT: "chat:read-attachment",
  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  SAVE_IMAGE_AS: "chat:save-image-as",
  /** 保存应用内置资源文件到用户选择的位置（原生 Save As 对话框） */
  SAVE_RESOURCE_FILE_AS: "chat:save-resource-file-as",
  /** 删除附件 */
  DELETE_ATTACHMENT: "chat:delete-attachment",
  /** 打开文件选择对话框 */
  OPEN_FILE_DIALOG: "chat:open-file-dialog",
  /** 提取附件文档的文本内容 */
  EXTRACT_ATTACHMENT_TEXT: "chat:extract-attachment-text",
  // 置顶管理
  /** 切换对话置顶状态 */
  TOGGLE_PIN: "chat:toggle-pin",
  /** 切换对话归档状态 */
  TOGGLE_ARCHIVE: "chat:toggle-archive",
  /** 搜索对话消息内容 */
  SEARCH_MESSAGES: "chat:search-messages",
  // 教程
  /** 获取教程内容 */
  GET_TUTORIAL_CONTENT: "chat:get-tutorial-content",
  /** 创建欢迎对话（含教程附件） */
  CREATE_WELCOME_CONVERSATION: "chat:create-welcome-conversation",
  // 流式事件（主进程 → 渲染进程推送）
  /** 内容片段 */
  STREAM_CHUNK: "chat:stream:chunk",
  /** 推理片段 */
  STREAM_REASONING: "chat:stream:reasoning",
  /** 流式完成 */
  STREAM_COMPLETE: "chat:stream:complete",
  /** 流式错误 */
  STREAM_ERROR: "chat:stream:error",
  /** 工具活动事件（记忆工具调用/结果指示） */
  STREAM_TOOL_ACTIVITY: "chat:stream:tool-activity"
};

// ../../packages/shared/src/types/agent.ts
var MEMORY_IPC_CHANNELS = {
  /** 获取全局记忆配置 */
  GET_CONFIG: "memory:get-config",
  /** 保存全局记忆配置 */
  SET_CONFIG: "memory:set-config",
  /** 测试记忆连接 */
  TEST_CONNECTION: "memory:test-connection"
};
var AGENT_IPC_CHANNELS = {
  // 会话管理
  /** 获取会话列表 */
  LIST_SESSIONS: "agent:list-sessions",
  /** 创建会话 */
  CREATE_SESSION: "agent:create-session",
  /** 获取会话 SDKMessage（Phase 4 新格式） */
  GET_SDK_MESSAGES: "agent:get-sdk-messages",
  /** 更新会话标题 */
  UPDATE_TITLE: "agent:update-title",
  /** 删除会话 */
  DELETE_SESSION: "agent:delete-session",
  /** 迁移 Chat 对话记录到 Agent 会话 */
  MIGRATE_CHAT_TO_AGENT: "agent:migrate-chat-to-agent",
  /** 切换会话置顶状态 */
  TOGGLE_PIN: "agent:toggle-pin",
  /** 清除会话完成状态（兼容清除旧版 manualWorking）。channel 值保留旧名以兼容已缓存的 preload */
  CLEAR_COMPLETION_STATE: "agent:confirm-working-done",
  /** 切换会话归档状态 */
  TOGGLE_ARCHIVE: "agent:toggle-archive",
  /** 搜索会话消息内容 */
  SEARCH_MESSAGES: "agent:search-messages",
  /** 搜索当前工作区可引用的 Agent 会话 */
  SEARCH_SESSION_REFERENCES: "agent:search-session-references",
  /** 迁移会话到另一个工作区 */
  MOVE_SESSION_TO_WORKSPACE: "agent:move-session-to-workspace",
  /** 分叉会话（从指定消息处创建新会话） */
  FORK_SESSION: "agent:fork-session",
  /** 快照回退（同一会话内回退到指定点，恢复文件 + 截断对话） */
  REWIND_SESSION: "agent:rewind-session",
  // 工作区管理
  /** 获取工作区列表 */
  LIST_WORKSPACES: "agent:list-workspaces",
  /** 创建工作区 */
  CREATE_WORKSPACE: "agent:create-workspace",
  /** 更新工作区 */
  UPDATE_WORKSPACE: "agent:update-workspace",
  /** 删除工作区 */
  DELETE_WORKSPACE: "agent:delete-workspace",
  /** 重排工作区顺序 */
  REORDER_WORKSPACES: "agent:reorder-workspaces",
  // 标题生成
  /** 生成 Agent 会话标题 */
  GENERATE_TITLE: "agent:generate-title",
  // 消息发送
  /** 发送消息（触发 Agent 流式响应） */
  SEND_MESSAGE: "agent:send-message",
  /** 中止 Agent 执行 */
  STOP_AGENT: "agent:stop",
  // 后台任务管理
  /** 获取任务输出 */
  GET_TASK_OUTPUT: "agent:get-task-output",
  /** 停止任务 */
  STOP_TASK: "agent:stop-task",
  // 工作区能力（MCP + Skill）
  /** 获取工作区能力摘要 */
  GET_CAPABILITIES: "agent:get-capabilities",
  /** 获取工作区 MCP 配置 */
  GET_MCP_CONFIG: "agent:get-mcp-config",
  /** 保存工作区 MCP 配置 */
  SAVE_MCP_CONFIG: "agent:save-mcp-config",
  /** 测试 MCP 服务器连接 */
  TEST_MCP_SERVER: "agent:test-mcp-server",
  /** 获取工作区 Skill 列表 */
  GET_SKILLS: "agent:get-skills",
  /** 获取工作区 Skills 目录绝对路径 */
  GET_SKILLS_DIR: "agent:get-skills-dir",
  /** 删除工作区 Skill */
  DELETE_SKILL: "agent:delete-skill",
  /** 切换工作区 Skill 启用/禁用 */
  TOGGLE_SKILL: "agent:toggle-skill",
  /** 获取其他工作区的 Skill 列表 */
  GET_OTHER_WORKSPACE_SKILLS: "agent:get-other-workspace-skills",
  /** 获取默认 Skills 的 slug 列表（来自 ~/.proma/default-skills/） */
  GET_DEFAULT_SKILL_SLUGS: "agent:get-default-skill-slugs",
  /** 从其他工作区导入 Skill 到当前工作区 */
  IMPORT_SKILL_FROM_WORKSPACE: "agent:import-skill-from-workspace",
  /** 从源工作区同步更新已导入的 Skill */
  UPDATE_SKILL_FROM_SOURCE: "agent:update-skill-from-source",
  /** 读取 SKILL.md 全文内容 */
  READ_SKILL_CONTENT: "agent:read-skill-content",
  /** 写入 SKILL.md 全文内容 */
  WRITE_SKILL_CONTENT: "agent:write-skill-content",
  /** 列出 Skill 目录下的子文件树（不含 SKILL.md） */
  LIST_SKILL_FILES: "agent:list-skill-files",
  /** 读取 Skill 目录下的子文件内容 */
  READ_SKILL_FILE: "agent:read-skill-file",
  /** 写入 Skill 目录下的子文件内容 */
  WRITE_SKILL_FILE: "agent:write-skill-file",
  /** 在 Skill 目录下创建文件或目录 */
  CREATE_SKILL_ENTRY: "agent:create-skill-entry",
  /** 删除 Skill 目录下的文件或目录 */
  DELETE_SKILL_ENTRY: "agent:delete-skill-entry",
  /** 重命名/移动 Skill 目录下的文件或目录 */
  RENAME_SKILL_ENTRY: "agent:rename-skill-entry",
  // 流式事件（主进程 → 渲染进程推送）
  /** Agent 流式事件 */
  STREAM_EVENT: "agent:stream:event",
  /** Agent 流式完成 */
  STREAM_COMPLETE: "agent:stream:complete",
  /** Agent 流式错误 */
  STREAM_ERROR: "agent:stream:error",
  // 附件
  /** 保存文件到 Agent session 工作目录 */
  SAVE_FILES_TO_SESSION: "agent:save-files-to-session",
  /** 保存文件到工作区文件目录 */
  SAVE_FILES_TO_WORKSPACE: "agent:save-files-to-workspace",
  /** 获取工作区文件目录路径 */
  GET_WORKSPACE_FILES_PATH: "agent:get-workspace-files-path",
  /** 打开文件夹选择对话框 */
  OPEN_FOLDER_DIALOG: "agent:open-folder-dialog",
  /** 附加外部目录到 Agent 会话 */
  ATTACH_DIRECTORY: "agent:attach-directory",
  /** 移除会话的附加目录 */
  DETACH_DIRECTORY: "agent:detach-directory",
  /** 附加外部文件到 Agent 会话 */
  ATTACH_FILE: "agent:attach-file",
  /** 移除会话的附加文件 */
  DETACH_FILE: "agent:detach-file",
  /** 附加外部目录到工作区（所有会话共享） */
  ATTACH_WORKSPACE_DIRECTORY: "agent:attach-workspace-directory",
  /** 移除工作区的附加目录 */
  DETACH_WORKSPACE_DIRECTORY: "agent:detach-workspace-directory",
  /** 附加外部文件到工作区（所有会话共享） */
  ATTACH_WORKSPACE_FILE: "agent:attach-workspace-file",
  /** 移除工作区的附加文件 */
  DETACH_WORKSPACE_FILE: "agent:detach-workspace-file",
  /** 获取工作区附加目录列表 */
  GET_WORKSPACE_DIRECTORIES: "agent:get-workspace-directories",
  /** 获取工作区附加文件列表 */
  GET_WORKSPACE_ATTACHED_FILES: "agent:get-workspace-attached-files",
  /** 获取工作区 worktree 仓库配置列表 */
  GET_WORKTREE_REPOS: "agent:get-worktree-repos",
  /** 添加 worktree 仓库到工作区配置 */
  ADD_WORKTREE_REPO: "agent:add-worktree-repo",
  /** 从工作区配置移除 worktree 仓库 */
  REMOVE_WORKTREE_REPO: "agent:remove-worktree-repo",
  // 文件系统操作
  /** 获取 session 工作路径 */
  GET_SESSION_PATH: "agent:get-session-path",
  /** 列出目录内容 */
  LIST_DIRECTORY: "agent:list-directory",
  /** 删除文件/空目录 */
  DELETE_FILE: "agent:delete-file",
  /** 用系统默认应用打开文件 */
  OPEN_FILE: "agent:open-file",
  /** 在系统文件管理器中显示文件 */
  SHOW_IN_FOLDER: "agent:show-in-folder",
  /** 重命名文件/目录 */
  RENAME_FILE: "agent:rename-file",
  /** 移动文件/目录到目标目录 */
  MOVE_FILE: "agent:move-file",
  /** 列出附加目录内容（无工作区路径限制） */
  LIST_ATTACHED_DIRECTORY: "agent:list-attached-directory",
  /** 在文件管理器中显示附加目录文件（无工作区路径限制） */
  SHOW_ATTACHED_IN_FOLDER: "agent:show-attached-in-folder",
  /** 重命名附加目录文件/目录（无工作区路径限制） */
  RENAME_ATTACHED_FILE: "agent:rename-attached-file",
  /** 移动附加目录文件/目录（无工作区路径限制） */
  MOVE_ATTACHED_FILE: "agent:move-attached-file",
  /** 检查路径类型（文件 or 目录），用于拖拽检测 */
  CHECK_PATHS_TYPE: "agent:check-paths-type",
  /** 读取附加目录文件内容为 base64（限制在已附加目录范围内，用于侧面板添加到聊天） */
  READ_ATTACHED_FILE: "agent:read-attached-file",
  /** 搜索工作区文件（用于 @ 引用） */
  SEARCH_WORKSPACE_FILES: "agent:search-workspace-files",
  /** 将文本内容写入临时预览文件并返回绝对路径 */
  WRITE_CLIPBOARD_PREVIEW: "agent:write-clipboard-preview",
  // 标题自动生成通知（主进程 → 渲染进程推送）
  /** 标题已更新（首次对话完成后自动生成） */
  TITLE_UPDATED: "agent:title-updated",
  // 工作区配置变化通知（主进程 → 渲染进程推送）
  /** 工作区能力变化（MCP/Skills 文件监听触发） */
  CAPABILITIES_CHANGED: "agent:capabilities-changed",
  /** 工作区文件变化（session 目录文件监听触发，用于文件浏览器刷新） */
  WORKSPACE_FILES_CHANGED: "agent:workspace-files-changed",
  // 权限系统
  /** 权限响应（渲染进程 → 主进程） */
  PERMISSION_RESPOND: "agent:permission:respond",
  /** 热切换指定会话的权限模式（运行中生效，不广播到其他会话） */
  UPDATE_SESSION_PERMISSION_MODE: "agent:update-session-permission-mode",
  // AskUserQuestion 交互式问答
  /** AskUser 响应（渲染进程 → 主进程） */
  ASK_USER_RESPOND: "agent:ask-user:respond",
  // ExitPlanMode 计划审批
  /** ExitPlanMode 响应（渲染进程 → 主进程） */
  EXIT_PLAN_MODE_RESPOND: "agent:exit-plan-mode:respond",
  // 队列消息（Agent 运行中排队发送）
  /** 排队发送消息 */
  QUEUE_MESSAGE: "agent:queue-message",
  /** 取消队列消息 */
  CANCEL_QUEUED_MESSAGE: "agent:cancel-queued-message",
  /** 提升队列消息为立即发送 */
  PROMOTE_QUEUED_MESSAGE: "agent:promote-queued-message",
  /** 队列消息状态变更通知（主进程 → 渲染进程推送） */
  QUEUED_MESSAGE_STATUS: "agent:queued-message-status",
  // 待处理请求恢复（渲染进程重载后查询主进程状态）
  /** 获取所有待处理的交互请求快照 */
  GET_PENDING_REQUESTS: "agent:get-pending-requests"
};

// ../../packages/shared/src/types/cloud.ts
var CLOUD_IPC_CHANNELS = {
  // 认证相关
  LOGIN: "cloud:auth:login",
  REGISTER: "cloud:auth:register",
  LOGOUT: "cloud:auth:logout",
  REFRESH_TOKEN: "cloud:auth:refresh-token",
  GET_ME: "cloud:auth:get-me",
  GET_AUTH_STATE: "cloud:auth:get-state",
  // 邮箱验证 / 密码重置
  VERIFY_EMAIL: "cloud:auth:verify-email",
  FORGOT_PASSWORD: "cloud:auth:forgot-password",
  RESET_PASSWORD: "cloud:auth:reset-password",
  RESEND_CODE: "cloud:auth:resend-code",
  // Google OAuth
  GET_GOOGLE_OAUTH_STATUS: "cloud:auth:google-oauth-status",
  OPEN_GOOGLE_LOGIN: "cloud:auth:open-google-login",
  // 用户档案更新
  UPDATE_PROFILE: "cloud:auth:update-profile",
  // 认证状态变化推送通道（主进程 → 渲染进程）
  AUTH_STATE_CHANGED: "cloud:auth:state-changed",
  // 账单相关
  GET_BILLING: "cloud:billing:get",
  CHECK_BALANCE: "cloud:billing:check-balance",
  // 额度不足推送通道（主进程 → 渲染进程）
  QUOTA_EXCEEDED: "cloud:billing:quota-exceeded",
  // 余额变动推送通道（主进程 → 渲染进程，如对话扣费后）
  BILLING_CHANGED: "cloud:billing:changed",
  // 官方渠道同步
  SYNC_OFFICIAL_CHANNEL: "cloud:channel:sync-official",
  // 官方渠道更新推送通道（主进程 → 渲染进程）
  OFFICIAL_CHANNEL_UPDATED: "cloud:channel:official-updated",
  // API Key 管理
  LIST_API_KEYS: "cloud:api-keys:list",
  CREATE_API_KEY: "cloud:api-keys:create",
  UPDATE_API_KEY: "cloud:api-keys:update",
  DELETE_API_KEY: "cloud:api-keys:delete",
  // 订阅相关
  GET_SUBSCRIPTION_TIERS: "cloud:subscription:get-tiers",
  GET_SUBSCRIPTION_CURRENT: "cloud:subscription:get-current",
  CREATE_SUBSCRIPTION_WECHAT: "cloud:subscription:create-wechat",
  GET_SUBSCRIPTION_ORDER_STATUS: "cloud:subscription:order-status",
  GET_SUBSCRIPTION_HISTORY: "cloud:subscription:history",
  // 提示词下载
  DOWNLOAD_CLOUD_PROMPTS: "cloud:prompts:download",
  // 模型健康检查
  GET_MODEL_HEALTH: "cloud:model-health:get",
  /** 健康数据更新推送通道（主进程 → 渲染进程） */
  MODEL_HEALTH_UPDATED: "cloud:model-health:updated",
  // 用量日志
  GET_USAGE_LOGS: "cloud:usage:get",
  GET_TOOL_USAGE_LOGS: "cloud:usage:get-tool",
  GET_SPEECH_USAGE_LOGS: "cloud:usage:get-speech",
  GET_AGENT_USAGE_LOGS: "cloud:usage:get-agent"
};

// ../../packages/shared/src/types/sync.ts
var SYNC_IPC_CHANNELS = {
  /** 触发全量同步 */
  FULL_SYNC: "sync:full",
  /** 触发增量同步 */
  INCREMENTAL_SYNC: "sync:incremental",
  /** 获取同步状态 */
  GET_SYNC_STATE: "sync:get-state",
  /** 加载更多历史对话 */
  PULL_MORE: "sync:pull-more",
  /** 从云端下载全部对话 */
  DOWNLOAD_ALL_CONVERSATIONS: "sync:download-all-conversations",
  /** 同步进度推送（主进程 → 渲染进程） */
  SYNC_PROGRESS: "sync:progress"
};

// ../../packages/shared/src/types/environment.ts
var ENVIRONMENT_IPC_CHANNELS = {
  /** 执行环境检测 */
  CHECK: "environment:check"
};

// ../../packages/shared/src/types/installer.ts
var INSTALLER_IPC_CHANNELS = {
  /** 获取安装包清单（优先远程，失败回退内置） */
  MANIFEST: "installer:manifest",
  /** 开始下载（参数：InstallerDownloadRequest） */
  DOWNLOAD: "installer:download",
  /** 取消下载（参数：key） */
  CANCEL: "installer:cancel",
  /** 拉起已下载的安装程序（参数：filePath） */
  LAUNCH: "installer:launch",
  /** 下载进度事件（main → renderer） */
  PROGRESS: "installer:progress"
};

// ../../packages/shared/src/types/github.ts
var GITHUB_RELEASE_IPC_CHANNELS = {
  /** 获取最新 Release */
  GET_LATEST_RELEASE: "github-release:get-latest",
  /** 获取 Release 列表 */
  LIST_RELEASES: "github-release:list",
  /** 获取指定版本的 Release */
  GET_RELEASE_BY_TAG: "github-release:get-by-tag"
};

// ../../packages/shared/src/types/system-prompt.ts
var SYSTEM_PROMPT_IPC_CHANNELS = {
  /** 获取完整配置 */
  GET_CONFIG: "system-prompt:get-config",
  /** 创建提示词 */
  CREATE: "system-prompt:create",
  /** 更新提示词 */
  UPDATE: "system-prompt:update",
  /** 删除提示词 */
  DELETE: "system-prompt:delete",
  /** 更新追加日期时间和用户名开关 */
  UPDATE_APPEND_SETTING: "system-prompt:update-append-setting",
  /** 设置默认提示词 */
  SET_DEFAULT: "system-prompt:set-default"
};

// ../../packages/shared/src/types/chat-tool.ts
var CHAT_TOOL_IPC_CHANNELS = {
  /** 获取所有可用工具信息 */
  GET_ALL_TOOLS: "chat-tool:get-all-tools",
  /** 获取工具凭据 */
  GET_TOOL_CREDENTIALS: "chat-tool:get-credentials",
  /** 更新单个工具的开关状态 */
  UPDATE_TOOL_STATE: "chat-tool:update-state",
  /** 更新工具凭据 */
  UPDATE_TOOL_CREDENTIALS: "chat-tool:update-credentials",
  /** 测试工具连接 */
  TEST_TOOL: "chat-tool:test",
  /** 创建自定义工具 */
  CREATE_CUSTOM_TOOL: "chat-tool:create-custom",
  /** 删除自定义工具 */
  DELETE_CUSTOM_TOOL: "chat-tool:delete-custom",
  /** 自定义工具配置变更通知（文件监听触发） */
  CUSTOM_TOOL_CHANGED: "chat-tool:custom-tool-changed"
};

// ../../packages/shared/src/types/feishu.ts
var FEISHU_IPC_CHANNELS = {
  /** 获取飞书配置（旧格式，向后兼容） */
  GET_CONFIG: "feishu:get-config",
  /** 保存飞书配置（旧格式，向后兼容） */
  SAVE_CONFIG: "feishu:save-config",
  /** 获取解密后的 App Secret（旧格式，向后兼容） */
  GET_DECRYPTED_SECRET: "feishu:get-decrypted-secret",
  /** 测试飞书连接 */
  TEST_CONNECTION: "feishu:test-connection",
  /** 启动 Bridge（旧格式，向后兼容） */
  START_BRIDGE: "feishu:start-bridge",
  /** 停止 Bridge（旧格式，向后兼容） */
  STOP_BRIDGE: "feishu:stop-bridge",
  /** 获取 Bridge 状态（旧格式，向后兼容） */
  GET_STATUS: "feishu:get-status",
  /** Bridge 状态变化（主进程 → 渲染进程推送） */
  STATUS_CHANGED: "feishu:status-changed",
  /** 获取活跃绑定列表 */
  LIST_BINDINGS: "feishu:list-bindings",
  /** 更新绑定（修改工作区/会话） */
  UPDATE_BINDING: "feishu:update-binding",
  /** 移除绑定 */
  REMOVE_BINDING: "feishu:remove-binding",
  /** 渲染进程 → 主进程：上报用户在场状态 */
  REPORT_PRESENCE: "feishu:report-presence",
  // ===== 多 Bot（v2）=====
  /** 获取多 Bot 配置 */
  GET_MULTI_CONFIG: "feishu:get-multi-config",
  /** 保存单个 Bot 配置（新建或更新） */
  SAVE_BOT_CONFIG: "feishu:save-bot-config",
  /** 删除 Bot */
  REMOVE_BOT: "feishu:remove-bot",
  /** 获取单个 Bot 的解密 App Secret */
  GET_BOT_DECRYPTED_SECRET: "feishu:get-bot-decrypted-secret",
  /** 启动单个 Bot Bridge */
  START_BOT: "feishu:start-bot",
  /** 停止单个 Bot Bridge */
  STOP_BOT: "feishu:stop-bot",
  /** 获取多 Bot Bridge 状态 */
  GET_MULTI_STATUS: "feishu:get-multi-status",
  /** 多 Bot 状态变化推送 */
  MULTI_STATUS_CHANGED: "feishu:multi-status-changed",
  // ===== 扫码注册（v3）=====
  /** 启动扫码注册流程，返回最终的 App ID/Secret */
  REGISTER_APP_START: "feishu:register-app-start",
  /** 主进程 → 渲染进程：二维码 URL 已生成 */
  REGISTER_APP_QRCODE: "feishu:register-app-qrcode",
  /** 主进程 → 渲染进程：注册流程状态变化（polling/slow_down/domain_switched） */
  REGISTER_APP_STATUS: "feishu:register-app-status",
  /** 取消正在进行的扫码注册流程 */
  REGISTER_APP_CANCEL: "feishu:register-app-cancel"
};

// ../../packages/shared/src/types/dingtalk.ts
var DINGTALK_IPC_CHANNELS = {
  /** 获取钉钉配置 */
  GET_CONFIG: "dingtalk:get-config",
  /** 保存钉钉配置 */
  SAVE_CONFIG: "dingtalk:save-config",
  /** 获取解密后的 Client Secret */
  GET_DECRYPTED_SECRET: "dingtalk:get-decrypted-secret",
  /** 测试钉钉连接 */
  TEST_CONNECTION: "dingtalk:test-connection",
  /** 启动 Bridge */
  START_BRIDGE: "dingtalk:start-bridge",
  /** 停止 Bridge */
  STOP_BRIDGE: "dingtalk:stop-bridge",
  /** 获取 Bridge 状态 */
  GET_STATUS: "dingtalk:get-status",
  /** Bridge 状态变化（主进程 → 渲染进程推送） */
  STATUS_CHANGED: "dingtalk:status-changed",
  // ===== 多 Bot（v2）=====
  /** 获取多 Bot 配置 */
  GET_MULTI_CONFIG: "dingtalk:get-multi-config",
  /** 保存单个 Bot 配置（新建或更新） */
  SAVE_BOT_CONFIG: "dingtalk:save-bot-config",
  /** 删除 Bot */
  REMOVE_BOT: "dingtalk:remove-bot",
  /** 获取单个 Bot 的解密 Client Secret */
  GET_BOT_DECRYPTED_SECRET: "dingtalk:get-bot-decrypted-secret",
  /** 启动单个 Bot Bridge */
  START_BOT: "dingtalk:start-bot",
  /** 停止单个 Bot Bridge */
  STOP_BOT: "dingtalk:stop-bot",
  /** 获取多 Bot Bridge 状态 */
  GET_MULTI_STATUS: "dingtalk:get-multi-status",
  /** 多 Bot 状态变化推送 */
  MULTI_STATUS_CHANGED: "dingtalk:multi-status-changed"
};

// ../../packages/shared/src/types/wechat.ts
var WECHAT_IPC_CHANNELS = {
  /** 获取微信配置 */
  GET_CONFIG: "wechat:get-config",
  /** 保存微信配置 */
  SAVE_CONFIG: "wechat:save-config",
  /** 开始扫码登录 */
  START_LOGIN: "wechat:start-login",
  /** 登出 */
  LOGOUT: "wechat:logout",
  /** 启动 Bridge（用已有凭证） */
  START_BRIDGE: "wechat:start-bridge",
  /** 停止 Bridge */
  STOP_BRIDGE: "wechat:stop-bridge",
  /** 获取 Bridge 状态 */
  GET_STATUS: "wechat:get-status",
  /** Bridge 状态变化（主进程 → 渲染进程推送） */
  STATUS_CHANGED: "wechat:status-changed"
};

// ../../packages/shared/src/types/automation.ts
var AUTOMATION_IPC_CHANNELS = {
  /** 获取全部定时任务 */
  LIST: "automation:list",
  /** 创建定时任务 */
  CREATE: "automation:create",
  /** 更新定时任务 */
  UPDATE: "automation:update",
  /** 删除定时任务 */
  DELETE: "automation:delete",
  /** 切换启用/暂停 */
  TOGGLE: "automation:toggle",
  /** 立即运行一次（不影响调度计时） */
  RUN_NOW: "automation:run-now",
  /** 任务列表变更事件（main → renderer，运行完成/状态变化时推送） */
  CHANGED: "automation:changed"
};

// src/types/settings.ts
var SETTINGS_IPC_CHANNELS = {
  GET: "settings:get",
  UPDATE: "settings:update",
  UPDATE_SYNC: "settings:update-sync",
  GET_SYSTEM_THEME: "settings:get-system-theme",
  ON_SYSTEM_THEME_CHANGED: "settings:system-theme-changed",
  /** 用户手动切换主题时广播给所有窗口 */
  ON_THEME_SETTINGS_CHANGED: "settings:theme-settings-changed"
};
var SCRATCH_PAD_IPC_CHANNELS = {
  /** 从磁盘加载 scratch-pad.md 内容 */
  LOAD: "scratch-pad:load",
  /** 保存内容到 scratch-pad.md */
  SAVE: "scratch-pad:save",
  /** 同步保存（beforeunload 场景） */
  SAVE_SYNC: "scratch-pad:save-sync",
  /** 导出为 Markdown 到指定目录 */
  EXPORT: "scratch-pad:export",
  /** 打开保存对话框选择导出路径 */
  CHOOSE_EXPORT_PATH: "scratch-pad:choose-export-path"
};
var APP_ICON_IPC_CHANNELS = {
  /** 设置应用图标（variant ID） */
  SET: "app-icon:set"
};
var DOCK_BADGE_IPC_CHANNELS = {
  /** 设置系统应用角标数量 */
  SET_COUNT: "dock-badge:set-count"
};
var QUICK_TASK_IPC_CHANNELS = {
  /** 提交快速任务（渲染进程 → 主进程） */
  SUBMIT: "quick-task:submit",
  /** 隐藏快速任务窗口 */
  HIDE: "quick-task:hide",
  /** 通知渲染进程聚焦输入框 */
  FOCUS: "quick-task:focus",
  /** 重新注册全局快捷键（设置变更后） */
  REREGISTER_GLOBAL_SHORTCUTS: "quick-task:reregister-global-shortcuts"
};
var VOICE_DICTATION_IPC_CHANNELS = {
  /** 获取语音输入设置 */
  GET_SETTINGS: "voice-dictation:get-settings",
  /** 更新语音输入设置 */
  UPDATE_SETTINGS: "voice-dictation:update-settings",
  /** 测试豆包 ASR 连接 */
  TEST_CONNECTION: "voice-dictation:test-connection",
  /** 唤起或停止语音输入浮窗 */
  TOGGLE: "voice-dictation:toggle",
  /** 开始语音输入会话 */
  START: "voice-dictation:start",
  /** 发送音频分片 */
  SEND_AUDIO: "voice-dictation:send-audio",
  /** 停止语音输入会话 */
  STOP: "voice-dictation:stop",
  /** 取消语音输入会话 */
  CANCEL: "voice-dictation:cancel",
  /** 输出最终文本 */
  COMMIT: "voice-dictation:commit",
  /** 隐藏语音输入窗口 */
  HIDE: "voice-dictation:hide",
  /** 调整语音输入窗口高度 */
  RESIZE: "voice-dictation:resize",
  /** 窗口显示后通知渲染进程开始 */
  SHOWN: "voice-dictation:shown",
  /** 全局快捷键请求当前录音停止 */
  TOGGLE_STOP: "voice-dictation:toggle-stop",
  /** 转写文本事件 */
  TRANSCRIPT: "voice-dictation:transcript",
  /** 状态事件 */
  STATE: "voice-dictation:state",
  /** 主窗口插入文本 */
  INSERT_TEXT: "voice-dictation:insert-text",
  /** 检查麦克风权限状态 */
  CHECK_MIC_PERMISSION: "voice-dictation:check-mic-permission",
  /** 请求麦克风权限 */
  REQUEST_MIC_PERMISSION: "voice-dictation:request-mic-permission"
};
var TRAY_IPC_CHANNELS = {
  /** 打开已有 Agent 会话 */
  OPEN_AGENT_SESSION: "tray:open-agent-session",
  /** 创建新会话 */
  CREATE_SESSION: "tray:create-session"
};
var STORAGE_IPC_CHANNELS = {
  /** 计算各目录存储统计 */
  GET_STATS: "storage:get-stats",
  /** 按选项清理存储 */
  CLEANUP: "storage:cleanup",
  /** 仅清理临时文件（启动时/快速清理） */
  CLEANUP_TEMP: "storage:cleanup-temp"
};

// src/types/user-profile.ts
var USER_PROFILE_IPC_CHANNELS = {
  GET: "user-profile:get",
  UPDATE: "user-profile:update"
};

// src/preload/index.ts
var electronAPI = {
  // 运行时
  getRuntimeStatus: () => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_RUNTIME_STATUS);
  },
  reinitRuntime: () => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.REINIT_RUNTIME);
  },
  getGitRepoStatus: (dirPath) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_GIT_REPO_STATUS, dirPath);
  },
  getUnstagedChanges: (dirPath, sessionPath, workspaceFilesPath, extraPaths, sessionId) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_UNSTAGED_CHANGES, dirPath, sessionPath, workspaceFilesPath, extraPaths, sessionId);
  },
  getFileDiff: (input) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_FILE_DIFF, input);
  },
  getUntrackedContent: (input) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_UNTRACKED_CONTENT, input);
  },
  revertFile: (input) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.REVERT_FILE, input);
  },
  getDiffContents: (input) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_DIFF_CONTENTS, input);
  },
  listWorktrees: (repoPath, sessionId) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.LIST_WORKTREES, repoPath, sessionId);
  },
  getWorktreeChanges: (worktreePath, baseBranch, sessionId) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_WORKTREE_CHANGES, worktreePath, baseBranch, sessionId);
  },
  openDetachedPreview: (input) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.OPEN_DETACHED_PREVIEW, input);
  },
  getDetachedPreviewData: (previewId) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_DETACHED_PREVIEW_DATA, previewId);
  },
  // 通用工具
  openExternal: (url) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url);
  },
  // 窗口控制
  windowMinimize: () => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE);
  },
  windowMaximize: () => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE);
  },
  windowClose: () => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE);
  },
  windowIsMaximized: () => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED);
  },
  onWindowResize: (callback) => {
    const handler = () => callback();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  },
  // 渠道管理
  listChannels: () => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.LIST);
  },
  createChannel: (input) => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.CREATE, input);
  },
  updateChannel: (id, input) => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.UPDATE, id, input);
  },
  deleteChannel: (id) => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DELETE, id);
  },
  decryptApiKey: (channelId) => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.DECRYPT_KEY, channelId);
  },
  testChannel: (channelId) => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST, channelId);
  },
  testChannelDirect: (input) => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.TEST_DIRECT, input);
  },
  fetchModels: (input) => {
    return import_electron.ipcRenderer.invoke(CHANNEL_IPC_CHANNELS.FETCH_MODELS, input);
  },
  // 对话管理
  listConversations: () => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.LIST_CONVERSATIONS);
  },
  createConversation: (title, modelId, channelId) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_CONVERSATION, title, modelId, channelId);
  },
  getConversationMessages: (id) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_MESSAGES, id);
  },
  getRecentMessages: (id, limit) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_RECENT_MESSAGES, id, limit);
  },
  updateConversationTitle: (id, title) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_TITLE, id, title);
  },
  updateConversationModel: (id, modelId, channelId) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_MODEL, id, modelId, channelId);
  },
  deleteConversation: (id) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_CONVERSATION, id);
  },
  togglePinConversation: (id) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.TOGGLE_PIN, id);
  },
  toggleArchiveConversation: (id) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.TOGGLE_ARCHIVE, id);
  },
  searchConversationMessages: (query) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEARCH_MESSAGES, query);
  },
  // 教程
  getTutorialContent: () => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_TUTORIAL_CONTENT);
  },
  createWelcomeConversation: () => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_WELCOME_CONVERSATION);
  },
  // 消息发送
  sendMessage: (input) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEND_MESSAGE, input);
  },
  stopGeneration: (conversationId) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.STOP_GENERATION, conversationId);
  },
  deleteMessage: (conversationId, messageId) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_MESSAGE, conversationId, messageId);
  },
  truncateMessagesFrom: (conversationId, messageId, preserveFirstMessageAttachments = false) => {
    return import_electron.ipcRenderer.invoke(
      CHAT_IPC_CHANNELS.TRUNCATE_MESSAGES_FROM,
      conversationId,
      messageId,
      preserveFirstMessageAttachments
    );
  },
  updateContextDividers: (conversationId, dividers) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.UPDATE_CONTEXT_DIVIDERS, conversationId, dividers);
  },
  generateTitle: (input) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.GENERATE_TITLE, input);
  },
  // 附件管理
  saveAttachment: (input) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_ATTACHMENT, input);
  },
  readAttachment: (localPath) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.READ_ATTACHMENT, localPath);
  },
  saveImageAs: (localPath, defaultFilename) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_IMAGE_AS, localPath, defaultFilename);
  },
  saveResourceFileAs: (resourceRelativePath, defaultFilename) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.SAVE_RESOURCE_FILE_AS, resourceRelativePath, defaultFilename);
  },
  deleteAttachment: (localPath) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_ATTACHMENT, localPath);
  },
  openFileDialog: () => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.OPEN_FILE_DIALOG);
  },
  extractAttachmentText: (localPath) => {
    return import_electron.ipcRenderer.invoke(CHAT_IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT, localPath);
  },
  // 用户档案
  getUserProfile: () => {
    return import_electron.ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.GET);
  },
  updateUserProfile: (updates) => {
    return import_electron.ipcRenderer.invoke(USER_PROFILE_IPC_CHANNELS.UPDATE, updates);
  },
  // 应用设置
  getSettings: () => {
    return import_electron.ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET);
  },
  updateSettings: (updates) => {
    return import_electron.ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.UPDATE, updates);
  },
  updateSettingsSync: (updates) => {
    return import_electron.ipcRenderer.sendSync(SETTINGS_IPC_CHANNELS.UPDATE_SYNC, updates);
  },
  getSystemTheme: () => {
    return import_electron.ipcRenderer.invoke(SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME);
  },
  onSystemThemeChanged: (callback) => {
    const listener = (_, isDark) => callback(isDark);
    import_electron.ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, listener);
    };
  },
  onThemeSettingsChanged: (callback) => {
    const listener = (_, payload) => callback(payload);
    import_electron.ipcRenderer.on(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, listener);
    };
  },
  // Scratch Pad 持久化
  loadScratchPad: () => {
    return import_electron.ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.LOAD);
  },
  saveScratchPad: (content) => {
    return import_electron.ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.SAVE, content);
  },
  saveScratchPadSync: (content) => {
    return import_electron.ipcRenderer.sendSync(SCRATCH_PAD_IPC_CHANNELS.SAVE_SYNC, content);
  },
  exportScratchPad: (markdown, dirPath, filename) => {
    return import_electron.ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.EXPORT, markdown, dirPath, filename);
  },
  chooseExportPath: (defaultName) => {
    return import_electron.ipcRenderer.invoke(SCRATCH_PAD_IPC_CHANNELS.CHOOSE_EXPORT_PATH, defaultName);
  },
  // 应用图标切换
  setAppIcon: (variantId) => {
    return import_electron.ipcRenderer.invoke(APP_ICON_IPC_CHANNELS.SET, variantId);
  },
  // Dock/Launcher 角标
  setDockBadgeCount: (count) => {
    return import_electron.ipcRenderer.invoke(DOCK_BADGE_IPC_CHANNELS.SET_COUNT, count);
  },
  // 环境检测
  checkEnvironment: () => {
    return import_electron.ipcRenderer.invoke(ENVIRONMENT_IPC_CHANNELS.CHECK);
  },
  // 第三方安装包（Git / Node.js）
  fetchInstallerManifest: () => {
    return import_electron.ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.MANIFEST);
  },
  downloadInstaller: (req) => {
    return import_electron.ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.DOWNLOAD, req);
  },
  cancelInstallerDownload: (key) => {
    return import_electron.ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.CANCEL, key);
  },
  launchInstaller: (filePath) => {
    return import_electron.ipcRenderer.invoke(INSTALLER_IPC_CHANNELS.LAUNCH, filePath);
  },
  onInstallerProgress: (callback) => {
    const listener = (_, payload) => callback(payload);
    import_electron.ipcRenderer.on(INSTALLER_IPC_CHANNELS.PROGRESS, listener);
    return () => import_electron.ipcRenderer.off(INSTALLER_IPC_CHANNELS.PROGRESS, listener);
  },
  // 代理配置
  getProxySettings: () => {
    return import_electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.GET_SETTINGS);
  },
  updateProxySettings: (config) => {
    return import_electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.UPDATE_SETTINGS, config);
  },
  detectSystemProxy: () => {
    return import_electron.ipcRenderer.invoke(PROXY_IPC_CHANNELS.DETECT_SYSTEM);
  },
  // 流式事件订阅
  onStreamChunk: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_CHUNK, listener);
    };
  },
  onStreamReasoning: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_REASONING, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_REASONING, listener);
    };
  },
  onStreamComplete: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_COMPLETE, listener);
    };
  },
  onStreamError: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_ERROR, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_ERROR, listener);
    };
  },
  onStreamToolActivity: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(CHAT_IPC_CHANNELS.STREAM_TOOL_ACTIVITY, listener);
    };
  },
  // Agent 会话管理
  listAgentSessions: () => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SESSIONS);
  },
  createAgentSession: (title, channelId, workspaceId) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SESSION, title, channelId, workspaceId);
  },
  getAgentSessionSDKMessages: (id) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SDK_MESSAGES, id);
  },
  updateAgentSessionTitle: (id, title) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_TITLE, id, title);
  },
  deleteAgentSession: (id) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SESSION, id);
  },
  migrateChatToAgent: (conversationId, agentSessionId) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.MIGRATE_CHAT_TO_AGENT, conversationId, agentSessionId);
  },
  togglePinAgentSession: (id) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_PIN, id);
  },
  clearAgentCompletionState: (id) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.CLEAR_COMPLETION_STATE, id);
  },
  toggleArchiveAgentSession: (id) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE, id);
  },
  searchAgentSessionMessages: (query) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_MESSAGES, query);
  },
  searchAgentSessionReferences: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_SESSION_REFERENCES, input);
  },
  moveAgentSessionToWorkspace: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_SESSION_TO_WORKSPACE, input);
  },
  forkAgentSession: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.FORK_SESSION, input);
  },
  rewindSession: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.REWIND_SESSION, input);
  },
  generateAgentTitle: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GENERATE_TITLE, input);
  },
  sendAgentMessage: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEND_MESSAGE, input);
  },
  stopAgent: (sessionId) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_AGENT, sessionId);
  },
  // Agent 队列消息
  queueAgentMessage: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.QUEUE_MESSAGE, input);
  },
  // Agent 后台任务管理
  getTaskOutput: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_TASK_OUTPUT, input);
  },
  stopTask: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_TASK, input);
  },
  // Agent 工作区管理
  listAgentWorkspaces: () => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_WORKSPACES);
  },
  createAgentWorkspace: (name) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_WORKSPACE, name);
  },
  updateAgentWorkspace: (id, updates) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_WORKSPACE, id, updates);
  },
  deleteAgentWorkspace: (id) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_WORKSPACE, id);
  },
  reorderAgentWorkspaces: (orderedIds) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.REORDER_WORKSPACES, orderedIds);
  },
  // 工作区能力（MCP + Skill）
  getWorkspaceCapabilities: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_CAPABILITIES, workspaceSlug);
  },
  getWorkspaceMcpConfig: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_MCP_CONFIG, workspaceSlug);
  },
  saveWorkspaceMcpConfig: (workspaceSlug, config) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG, workspaceSlug, config);
  },
  testMcpServer: (name, entry) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.TEST_MCP_SERVER, name, entry);
  },
  getWorkspaceSkills: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS, workspaceSlug);
  },
  getWorkspaceSkillsDir: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS_DIR, workspaceSlug);
  },
  deleteWorkspaceSkill: (workspaceSlug, skillSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL, workspaceSlug, skillSlug);
  },
  toggleWorkspaceSkill: (workspaceSlug, skillSlug, enabled) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_SKILL, workspaceSlug, skillSlug, enabled);
  },
  getOtherWorkspaceSkills: (currentSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS, currentSlug);
  },
  getDefaultSkillSlugs: () => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_DEFAULT_SKILL_SLUGS);
  },
  importSkillFromWorkspace: (targetSlug, sourceSlug, skillSlug) => {
    return import_electron.ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE,
      targetSlug,
      sourceSlug,
      skillSlug
    );
  },
  updateSkillFromSource: (targetSlug, skillSlug) => {
    return import_electron.ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE,
      targetSlug,
      skillSlug
    );
  },
  readSkillContent: (workspaceSlug, skillSlug) => {
    return import_electron.ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.READ_SKILL_CONTENT,
      workspaceSlug,
      skillSlug
    );
  },
  writeSkillContent: (workspaceSlug, skillSlug, content) => {
    return import_electron.ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.WRITE_SKILL_CONTENT,
      workspaceSlug,
      skillSlug,
      content
    );
  },
  listSkillFiles: (workspaceSlug, skillSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SKILL_FILES, workspaceSlug, skillSlug);
  },
  readSkillFile: (workspaceSlug, skillSlug, relativePath) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_SKILL_FILE, workspaceSlug, skillSlug, relativePath);
  },
  writeSkillFile: (workspaceSlug, skillSlug, relativePath, content) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_SKILL_FILE, workspaceSlug, skillSlug, relativePath, content);
  },
  createSkillEntry: (workspaceSlug, skillSlug, relativePath, type) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY, workspaceSlug, skillSlug, relativePath, type);
  },
  deleteSkillEntry: (workspaceSlug, skillSlug, relativePath) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY, workspaceSlug, skillSlug, relativePath);
  },
  renameSkillEntry: (workspaceSlug, skillSlug, fromRelative, toRelative) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY, workspaceSlug, skillSlug, fromRelative, toRelative);
  },
  onAgentStreamEvent: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_EVENT, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_EVENT, listener);
    };
  },
  onAgentStreamComplete: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_COMPLETE, listener);
    };
  },
  onAgentStreamError: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on(AGENT_IPC_CHANNELS.STREAM_ERROR, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(AGENT_IPC_CHANNELS.STREAM_ERROR, listener);
    };
  },
  // 标题自动更新通知
  onAgentTitleUpdated: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(AGENT_IPC_CHANNELS.TITLE_UPDATED, listener);
    };
  },
  // Agent 权限系统
  respondPermission: (response) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.PERMISSION_RESPOND, response);
  },
  updateSessionPermissionMode: (sessionId, mode) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE, sessionId, mode);
  },
  getMemoryConfig: () => {
    return import_electron.ipcRenderer.invoke(MEMORY_IPC_CHANNELS.GET_CONFIG);
  },
  setMemoryConfig: (config) => {
    return import_electron.ipcRenderer.invoke(MEMORY_IPC_CHANNELS.SET_CONFIG, config);
  },
  testMemoryConnection: () => {
    return import_electron.ipcRenderer.invoke(MEMORY_IPC_CHANNELS.TEST_CONNECTION);
  },
  // Chat 工具管理
  getChatTools: () => {
    return import_electron.ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS);
  },
  getChatToolCredentials: (toolId) => {
    return import_electron.ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS, toolId);
  },
  updateChatToolState: (toolId, state) => {
    return import_electron.ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE, toolId, state);
  },
  updateChatToolCredentials: (toolId, credentials) => {
    return import_electron.ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS, toolId, credentials);
  },
  createCustomChatTool: (meta) => {
    return import_electron.ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL, meta);
  },
  deleteCustomChatTool: (toolId) => {
    return import_electron.ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL, toolId);
  },
  onCustomToolChanged: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(CHAT_TOOL_IPC_CHANNELS.CUSTOM_TOOL_CHANGED, listener);
    };
  },
  testChatTool: (toolId) => {
    return import_electron.ipcRenderer.invoke(CHAT_TOOL_IPC_CHANNELS.TEST_TOOL, toolId);
  },
  // AskUserQuestion 交互式问答
  respondAskUser: (response) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.ASK_USER_RESPOND, response);
  },
  // ExitPlanMode 计划审批
  respondExitPlanMode: (response) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND, response);
  },
  // 待处理请求恢复
  getPendingRequests: () => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS);
  },
  // 工作区文件变化通知
  onCapabilitiesChanged: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, listener);
    };
  },
  onWorkspaceFilesChanged: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, listener);
    };
  },
  // Agent 附件
  saveFilesToAgentSession: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION, input);
  },
  saveFilesToWorkspaceFiles: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE, input);
  },
  getWorkspaceFilesPath: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH, workspaceSlug);
  },
  openFolderDialog: () => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG);
  },
  attachDirectory: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_DIRECTORY, input);
  },
  detachDirectory: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_DIRECTORY, input);
  },
  attachFile: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_FILE, input);
  },
  detachFile: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_FILE, input);
  },
  attachWorkspaceDirectory: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY, input);
  },
  detachWorkspaceDirectory: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY, input);
  },
  attachWorkspaceFile: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_FILE, input);
  },
  detachWorkspaceFile: (input) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_FILE, input);
  },
  getWorkspaceDirectories: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES, workspaceSlug);
  },
  getWorkspaceAttachedFiles: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_ATTACHED_FILES, workspaceSlug);
  },
  getWorktreeRepos: (workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKTREE_REPOS, workspaceSlug);
  },
  addWorktreeRepo: (workspaceSlug, repo) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.ADD_WORKTREE_REPO, workspaceSlug, repo);
  },
  removeWorktreeRepo: (workspaceSlug, repoPath) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.REMOVE_WORKTREE_REPO, workspaceSlug, repoPath);
  },
  // Agent 文件系统操作
  getAgentSessionPath: (workspaceId, sessionId) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SESSION_PATH, workspaceId, sessionId);
  },
  listDirectory: (dirPath) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_DIRECTORY, dirPath);
  },
  deleteFile: (filePath) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_FILE, filePath);
  },
  openFile: (filePath) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FILE, filePath);
  },
  writeClipboardPreview: (filename, content) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.WRITE_CLIPBOARD_PREVIEW, filename, content);
  },
  systemOpenFile: (filePath, appName, access) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_FILE, filePath, appName, access);
  },
  scanEditors: () => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.SCAN_EDITORS);
  },
  getDefaultAppForFile: (filePath, access) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.GET_DEFAULT_APP_FOR_FILE, filePath, access);
  },
  showInFolder: (filePath) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_IN_FOLDER, filePath);
  },
  resolveAndReadFile: (filePath, access) => {
    return import_electron.ipcRenderer.invoke("file:resolve-and-read", filePath, access);
  },
  writeTextFile: (filePath, content, access) => {
    return import_electron.ipcRenderer.invoke("file:write-text", filePath, content, access);
  },
  resolveFilePath: (filePath, access) => {
    return import_electron.ipcRenderer.invoke("file:resolve-path", filePath, access);
  },
  preparePdfPreview: (filePath, access) => {
    return import_electron.ipcRenderer.invoke("file:prepare-pdf-preview", filePath, access);
  },
  readBinaryBase64: (filePath, access, maxSize) => {
    return import_electron.ipcRenderer.invoke("file:read-binary-base64", filePath, access, maxSize);
  },
  docxToHtml: (filePath, access) => {
    return import_electron.ipcRenderer.invoke("file:docx-to-html", filePath, access);
  },
  officeToHtml: (filePath, access) => {
    return import_electron.ipcRenderer.invoke("file:office-to-html", filePath, access);
  },
  screenshotCapture: (input) => {
    return import_electron.ipcRenderer.invoke(IPC_CHANNELS.SCREENSHOT_CAPTURE, input);
  },
  renameFile: (filePath, newName) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_FILE, filePath, newName);
  },
  moveFile: (filePath, targetDir) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_FILE, filePath, targetDir);
  },
  listAttachedDirectory: (dirPath, access) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY, dirPath, access);
  },
  readAttachedFile: (filePath, sessionId, workspaceSlug) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.READ_ATTACHED_FILE, filePath, sessionId, workspaceSlug);
  },
  showAttachedInFolder: (filePath, access) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER, filePath, access);
  },
  renameAttachedFile: (filePath, newName, access) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE, filePath, newName, access);
  },
  moveAttachedFile: (filePath, targetDir, access) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE, filePath, targetDir, access);
  },
  checkPathsType: (paths) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE, paths);
  },
  getPathForFile: (file) => {
    return import_electron.webUtils.getPathForFile(file);
  },
  searchWorkspaceFiles: (rootPath, query, limit = 20, additionalPaths, sessionPaths) => {
    return import_electron.ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES, rootPath, query, limit, additionalPaths, sessionPaths);
  },
  // 系统提示词管理
  getSystemPromptConfig: () => {
    return import_electron.ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG);
  },
  createSystemPrompt: (input) => {
    return import_electron.ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.CREATE, input);
  },
  updateSystemPrompt: (id, input) => {
    return import_electron.ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE, id, input);
  },
  deleteSystemPrompt: (id) => {
    return import_electron.ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.DELETE, id);
  },
  updateAppendSetting: (enabled) => {
    return import_electron.ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING, enabled);
  },
  setDefaultPrompt: (id) => {
    return import_electron.ipcRenderer.invoke(SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT, id);
  },
  // 自动更新
  updater: {
    checkForUpdates: () => import_electron.ipcRenderer.invoke("updater:check"),
    getStatus: () => import_electron.ipcRenderer.invoke("updater:get-status"),
    onStatusChanged: (callback) => {
      const listener = (_event, status) => callback(status);
      import_electron.ipcRenderer.on("updater:status-changed", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("updater:status-changed", listener);
      };
    },
    quitAndInstall: () => import_electron.ipcRenderer.invoke("updater:quit-and-install")
  },
  // Cloud 认证
  cloudAuth: {
    login: (data) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.LOGIN, data);
    },
    register: (data) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.REGISTER, data);
    },
    logout: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.LOGOUT);
    },
    getMe: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_ME);
    },
    getAuthState: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_AUTH_STATE);
    },
    verifyEmail: (data) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.VERIFY_EMAIL, data);
    },
    forgotPassword: (data) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.FORGOT_PASSWORD, data);
    },
    resetPassword: (data) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.RESET_PASSWORD, data);
    },
    resendCode: (data) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.RESEND_CODE, data);
    },
    getGoogleOAuthStatus: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_GOOGLE_OAUTH_STATUS);
    },
    openGoogleLogin: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.OPEN_GOOGLE_LOGIN);
    },
    updateProfile: (data) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.UPDATE_PROFILE, data);
    },
    onAuthStateChanged: (callback) => {
      const listener = (_, state) => callback(state);
      import_electron.ipcRenderer.on(CLOUD_IPC_CHANNELS.AUTH_STATE_CHANGED, listener);
      return () => {
        import_electron.ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.AUTH_STATE_CHANGED, listener);
      };
    }
  },
  // Cloud 账单/支付
  cloudBilling: {
    getBilling: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_BILLING);
    },
    checkBalance: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CHECK_BALANCE);
    },
    onQuotaExceeded: (callback) => {
      const listener = () => callback();
      import_electron.ipcRenderer.on(CLOUD_IPC_CHANNELS.QUOTA_EXCEEDED, listener);
      return () => {
        import_electron.ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.QUOTA_EXCEEDED, listener);
      };
    },
    onBillingChanged: (callback) => {
      const listener = () => callback();
      import_electron.ipcRenderer.on(CLOUD_IPC_CHANNELS.BILLING_CHANGED, listener);
      return () => {
        import_electron.ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.BILLING_CHANGED, listener);
      };
    },
    syncOfficialChannel: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.SYNC_OFFICIAL_CHANNEL);
    },
    onOfficialChannelUpdated: (callback) => {
      const listener = () => callback();
      import_electron.ipcRenderer.on(CLOUD_IPC_CHANNELS.OFFICIAL_CHANNEL_UPDATED, listener);
      return () => {
        import_electron.ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.OFFICIAL_CHANNEL_UPDATED, listener);
      };
    },
    getModelHealth: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_MODEL_HEALTH);
    },
    onModelHealthUpdated: (callback) => {
      const listener = () => callback();
      import_electron.ipcRenderer.on(CLOUD_IPC_CHANNELS.MODEL_HEALTH_UPDATED, listener);
      return () => {
        import_electron.ipcRenderer.removeListener(CLOUD_IPC_CHANNELS.MODEL_HEALTH_UPDATED, listener);
      };
    }
  },
  // Cloud API Key 管理
  cloudApiKeys: {
    list: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.LIST_API_KEYS);
    },
    create: (params) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CREATE_API_KEY, params);
    },
    update: (keyId, params) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.UPDATE_API_KEY, keyId, params);
    },
    delete: (keyId) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.DELETE_API_KEY, keyId);
    }
  },
  // Cloud 订阅
  cloudSubscription: {
    getTiers: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_TIERS);
    },
    getCurrent: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_CURRENT);
    },
    createWechatPayment: (tierId) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.CREATE_SUBSCRIPTION_WECHAT, tierId);
    },
    getOrderStatus: (orderNo) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_ORDER_STATUS, orderNo);
    },
    getHistory: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SUBSCRIPTION_HISTORY);
    }
  },
  // Cloud 提示词下载
  cloudPrompts: {
    download: () => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.DOWNLOAD_CLOUD_PROMPTS);
    }
  },
  // Cloud 用量日志
  cloudUsage: {
    getUsageLogs: (params) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_USAGE_LOGS, params);
    },
    getToolUsageLogs: (params) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_TOOL_USAGE_LOGS, params);
    },
    getSpeechUsageLogs: (params) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_SPEECH_USAGE_LOGS, params);
    },
    getAgentUsageLogs: (params) => {
      return import_electron.ipcRenderer.invoke(CLOUD_IPC_CHANNELS.GET_AGENT_USAGE_LOGS, params);
    }
  },
  // 数据同步
  sync: {
    fullSync: () => {
      return import_electron.ipcRenderer.invoke(SYNC_IPC_CHANNELS.FULL_SYNC);
    },
    incrementalSync: () => {
      return import_electron.ipcRenderer.invoke(SYNC_IPC_CHANNELS.INCREMENTAL_SYNC);
    },
    pullMore: () => {
      return import_electron.ipcRenderer.invoke(SYNC_IPC_CHANNELS.PULL_MORE);
    },
    downloadAllConversations: () => {
      return import_electron.ipcRenderer.invoke(SYNC_IPC_CHANNELS.DOWNLOAD_ALL_CONVERSATIONS);
    },
    getSyncState: () => {
      return import_electron.ipcRenderer.invoke(SYNC_IPC_CHANNELS.GET_SYNC_STATE);
    },
    onSyncProgress: (callback) => {
      const listener = (_, event) => callback(event);
      import_electron.ipcRenderer.on(SYNC_IPC_CHANNELS.SYNC_PROGRESS, listener);
      return () => {
        import_electron.ipcRenderer.removeListener(SYNC_IPC_CHANNELS.SYNC_PROGRESS, listener);
      };
    }
  },
  // GitHub Release
  getLatestRelease: () => {
    return import_electron.ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE);
  },
  listReleases: (options) => {
    return import_electron.ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES, options);
  },
  getReleaseByTag: (tag) => {
    return import_electron.ipcRenderer.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG, tag);
  },
  // ===== 飞书集成 =====
  getFeishuConfig: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_CONFIG);
  },
  getDecryptedFeishuSecret: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_DECRYPTED_SECRET);
  },
  saveFeishuConfig: (input) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SAVE_CONFIG, input);
  },
  testFeishuConnection: (appId, appSecret) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.TEST_CONNECTION, appId, appSecret);
  },
  startFeishuBridge: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.START_BRIDGE);
  },
  stopFeishuBridge: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.STOP_BRIDGE);
  },
  getFeishuStatus: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_STATUS);
  },
  listFeishuBindings: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.LIST_BINDINGS);
  },
  updateFeishuBinding: (input) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.UPDATE_BINDING, input);
  },
  removeFeishuBinding: (chatId) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REMOVE_BINDING, chatId);
  },
  reportFeishuPresence: (report) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REPORT_PRESENCE, report);
  },
  onFeishuStatusChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    import_electron.ipcRenderer.on(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.STATUS_CHANGED, listener);
    };
  },
  // --- 多 Bot v2 API ---
  getFeishuMultiConfig: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_MULTI_CONFIG);
  },
  saveFeishuBotConfig: (input) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.SAVE_BOT_CONFIG, input);
  },
  getDecryptedFeishuBotSecret: (botId) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET, botId);
  },
  removeFeishuBot: (botId) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REMOVE_BOT, botId);
  },
  startFeishuBot: (botId) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.START_BOT, botId);
  },
  stopFeishuBot: (botId) => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.STOP_BOT, botId);
  },
  getFeishuMultiStatus: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.GET_MULTI_STATUS);
  },
  // --- 扫码注册 ---
  registerFeishuApp: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REGISTER_APP_START);
  },
  cancelFeishuRegistration: () => {
    return import_electron.ipcRenderer.invoke(FEISHU_IPC_CHANNELS.REGISTER_APP_CANCEL);
  },
  onFeishuRegisterQrcode: (callback) => {
    const listener = (_, payload) => callback(payload);
    import_electron.ipcRenderer.on(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.REGISTER_APP_QRCODE, listener);
    };
  },
  onFeishuRegisterStatus: (callback) => {
    const listener = (_, payload) => callback(payload);
    import_electron.ipcRenderer.on(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(FEISHU_IPC_CHANNELS.REGISTER_APP_STATUS, listener);
    };
  },
  // ===== 微信集成 =====
  getWeChatConfig: () => {
    return import_electron.ipcRenderer.invoke(WECHAT_IPC_CHANNELS.GET_CONFIG);
  },
  startWeChatLogin: () => {
    return import_electron.ipcRenderer.invoke(WECHAT_IPC_CHANNELS.START_LOGIN);
  },
  logoutWeChat: () => {
    return import_electron.ipcRenderer.invoke(WECHAT_IPC_CHANNELS.LOGOUT);
  },
  startWeChatBridge: () => {
    return import_electron.ipcRenderer.invoke(WECHAT_IPC_CHANNELS.START_BRIDGE);
  },
  stopWeChatBridge: () => {
    return import_electron.ipcRenderer.invoke(WECHAT_IPC_CHANNELS.STOP_BRIDGE);
  },
  getWeChatStatus: () => {
    return import_electron.ipcRenderer.invoke(WECHAT_IPC_CHANNELS.GET_STATUS);
  },
  onWeChatStatusChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    import_electron.ipcRenderer.on(WECHAT_IPC_CHANNELS.STATUS_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(WECHAT_IPC_CHANNELS.STATUS_CHANGED, listener);
    };
  },
  // ===== 钉钉集成 =====
  getDingTalkConfig: () => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_CONFIG);
  },
  getDecryptedDingTalkSecret: () => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_DECRYPTED_SECRET);
  },
  saveDingTalkConfig: (input) => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.SAVE_CONFIG, input);
  },
  testDingTalkConnection: (clientId, clientSecret) => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.TEST_CONNECTION, clientId, clientSecret);
  },
  startDingTalkBridge: () => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.START_BRIDGE);
  },
  stopDingTalkBridge: () => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.STOP_BRIDGE);
  },
  getDingTalkStatus: () => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_STATUS);
  },
  onDingTalkStatusChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    import_electron.ipcRenderer.on(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(DINGTALK_IPC_CHANNELS.STATUS_CHANGED, listener);
    };
  },
  // --- 钉钉多 Bot v2 API ---
  getDingTalkMultiConfig: () => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_MULTI_CONFIG);
  },
  saveDingTalkBotConfig: (input) => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.SAVE_BOT_CONFIG, input);
  },
  getDecryptedDingTalkBotSecret: (botId) => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_BOT_DECRYPTED_SECRET, botId);
  },
  removeDingTalkBot: (botId) => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.REMOVE_BOT, botId);
  },
  startDingTalkBot: (botId) => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.START_BOT, botId);
  },
  stopDingTalkBot: (botId) => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.STOP_BOT, botId);
  },
  getDingTalkMultiStatus: () => {
    return import_electron.ipcRenderer.invoke(DINGTALK_IPC_CHANNELS.GET_MULTI_STATUS);
  },
  onMenuCloseTab: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("menu:close-tab", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("menu:close-tab", listener);
    };
  },
  // ===== 快速任务窗口 =====
  submitQuickTask: (input) => {
    return import_electron.ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.SUBMIT, input);
  },
  hideQuickTask: () => {
    return import_electron.ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.HIDE);
  },
  reregisterGlobalShortcuts: () => {
    return import_electron.ipcRenderer.invoke(QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS);
  },
  onQuickTaskFocus: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on(QUICK_TASK_IPC_CHANNELS.FOCUS, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(QUICK_TASK_IPC_CHANNELS.FOCUS, listener);
    };
  },
  onQuickTaskOpenSession: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on("quick-task:open-session", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("quick-task:open-session", listener);
    };
  },
  // ===== 语音输入 =====
  getVoiceDictationSettings: () => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.GET_SETTINGS);
  },
  updateVoiceDictationSettings: (updates) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.UPDATE_SETTINGS, updates);
  },
  testVoiceDictationConnection: (updates) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.TEST_CONNECTION, updates);
  },
  toggleVoiceDictation: () => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.TOGGLE);
  },
  startVoiceDictation: (input) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.START, input);
  },
  sendVoiceDictationAudio: (input) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.SEND_AUDIO, input);
  },
  stopVoiceDictation: (input) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.STOP, input);
  },
  cancelVoiceDictation: (input) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.CANCEL, input);
  },
  commitVoiceDictation: (input) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.COMMIT, input);
  },
  hideVoiceDictation: () => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.HIDE);
  },
  resizeVoiceDictation: (input) => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.RESIZE, input);
  },
  onVoiceDictationShown: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.SHOWN, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.SHOWN, listener);
    };
  },
  onVoiceDictationToggleStop: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.TOGGLE_STOP, listener);
    };
  },
  onVoiceDictationTranscript: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.TRANSCRIPT, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.TRANSCRIPT, listener);
    };
  },
  onVoiceDictationState: (callback) => {
    const listener = (_, event) => callback(event);
    import_electron.ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.STATE, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.STATE, listener);
    };
  },
  onVoiceDictationInsertText: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, listener);
    };
  },
  checkMicrophonePermission: () => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.CHECK_MIC_PERMISSION);
  },
  requestMicrophonePermission: () => {
    return import_electron.ipcRenderer.invoke(VOICE_DICTATION_IPC_CHANNELS.REQUEST_MIC_PERMISSION);
  },
  onTrayOpenAgentSession: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(TRAY_IPC_CHANNELS.OPEN_AGENT_SESSION, listener);
    };
  },
  onTrayCreateSession: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on(TRAY_IPC_CHANNELS.CREATE_SESSION, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(TRAY_IPC_CHANNELS.CREATE_SESSION, listener);
    };
  },
  migrationGetExportPreview: (workspaceId) => {
    return import_electron.ipcRenderer.invoke("migration:getExportPreview", workspaceId);
  },
  migrationGetShareExportPreview: () => {
    return import_electron.ipcRenderer.invoke("migration:getShareExportPreview");
  },
  migrationExport: (options) => {
    return import_electron.ipcRenderer.invoke("migration:export", options);
  },
  migrationExportV2: (options) => {
    return import_electron.ipcRenderer.invoke("migration:exportV2", options);
  },
  migrationParseImportFile: (filePath) => {
    return import_electron.ipcRenderer.invoke("migration:parseImportFile", filePath);
  },
  migrationConfirmImport: (options) => {
    return import_electron.ipcRenderer.invoke("migration:confirmImport", options);
  },
  migrationOpenFileDialog: () => {
    return import_electron.ipcRenderer.invoke("migration:openFileDialog");
  },
  migrationSaveFileDialog: (mode) => {
    return import_electron.ipcRenderer.invoke("migration:saveFileDialog", mode);
  },
  onMigrationOpenImportFile: (callback) => {
    const listener = (_, data) => callback(data);
    import_electron.ipcRenderer.on("migration:open-import-file", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("migration:open-import-file", listener);
    };
  },
  // ===== 存储管理 =====
  getStorageStats: () => {
    return import_electron.ipcRenderer.invoke(STORAGE_IPC_CHANNELS.GET_STATS);
  },
  cleanupStorage: (options) => {
    return import_electron.ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CLEANUP, options);
  },
  cleanupTempStorage: () => {
    return import_electron.ipcRenderer.invoke(STORAGE_IPC_CHANNELS.CLEANUP_TEMP);
  },
  migrationCancelImport: (tempDir) => {
    return import_electron.ipcRenderer.invoke("migration:cancelImport", tempDir);
  },
  // ===== 定时任务（Automation）=====
  listAutomations: () => import_electron.ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.LIST),
  createAutomation: (input) => import_electron.ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.CREATE, input),
  updateAutomation: (input) => import_electron.ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.UPDATE, input),
  deleteAutomation: (id) => import_electron.ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.DELETE, id),
  toggleAutomation: (id, active) => import_electron.ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.TOGGLE, id, active),
  runAutomationNow: (id) => import_electron.ipcRenderer.invoke(AUTOMATION_IPC_CHANNELS.RUN_NOW, id),
  onAutomationChanged: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on(AUTOMATION_IPC_CHANNELS.CHANGED, listener);
    return () => {
      import_electron.ipcRenderer.removeListener(AUTOMATION_IPC_CHANNELS.CHANGED, listener);
    };
  }
};
import_electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// ============================================================
// 补丁 L (v0.17): 树形 UI 面板 IPC 桥接
// 暴露 window.electronAPI.proma 给 renderer 进程
// ============================================================
try {
  const promaBridge = {
    invoke: (channel, ...args) => {
      // 补丁 L (UI 面板)
      if (channel === 'proma:get-tree-states' || channel === 'proma:tree-view-ready') {
        return import_electron.ipcRenderer.invoke(channel, ...args);
      }
      // 补丁 M (Watcher 控制)
      if (['proma:watcher-status', 'proma:watcher-toggle', 'proma:watcher-set-interval',
           'proma:watcher-run-now', 'proma:watcher-config-patch'].includes(channel)) {
        return import_electron.ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error('unknown proma invoke channel: ' + channel));
    },
    send: (channel, ...args) => {
      if (channel === 'proma:navigate-to-session') {
        import_electron.ipcRenderer.send(channel, ...args);
        return true;
      }
      return false;
    },
    on: (channel, listener) => {
      if (channel === 'proma:navigate-to-session') {
        const wrapped = (_event, ...args) => listener(...args);
        import_electron.ipcRenderer.on(channel, wrapped);
        return () => import_electron.ipcRenderer.removeListener(channel, wrapped);
      }
      return () => {};
    }
  };
  // 附加到已暴露的 electronAPI（contextBridge 不允许二次 exposeInMainWorld 同名，所以挂到子对象）
  // 但已 expose 的对象是 frozen proxy，无法直接添加属性。改用单独 expose
  import_electron.contextBridge.exposeInMainWorld("promaTreeIpc", promaBridge);
} catch (e) {
  console.error('[Patch L preload] failed to expose promaTreeIpc:', e);
}
