export type Locale = "en" | "zh";

export const messages: Record<Locale, Record<string, string>> = {
  en: {
    // Sidebar
    "brand.sub": "Agent Workspace",
    "sidebar.projects": "Projects",
    "sidebar.sessions": "Sessions",
    "sidebar.newProject": "New project",
    "sidebar.newSession": "New session",
    "sidebar.projectPlaceholder": "Project name...",
    "sidebar.noProjects": "No projects yet",
    "sidebar.noSessions": "No sessions yet",
    "sidebar.connected": "Connected",
    "sidebar.connecting": "Connecting",
    "sidebar.disconnected": "Disconnected",

    // Header
    "header.files": "FILES",

    // Welcome screen
    "welcome.title": "PI Workspace",
    "welcome.sub": "Select a project from the sidebar or create a new one to begin.",
    "welcome.hint": "to create a new project",

    // Chat
    "chat.empty": "Start a conversation with the agent",
    "chat.roleUser": "You",
    "chat.roleAgent": "Agent",
    "chat.placeholder": "Send a message...",
    "chat.send": "Send message",

    // File viewer
    "viewer.selectFile": "Select a file to view",

    // Toggle tooltips
    "toggle.light": "Switch to light mode",
    "toggle.dark": "Switch to dark mode",
    "toggle.zh": "Switch to Chinese",
    "toggle.en": "Switch to English",

    // Errors
    "error.agentConfig": "Agent not configured. Set PI_PROVIDER and API key in .env file.",

    // Model
    "model.title": "MODEL",
    "model.select": "Select model",
    "model.switched": "Model switched",
    "model.current": "Current",
    "model.apiKeyHint": "No provider configured. Set PI_PROVIDER and API key in the server .env file.",
    "model.available": "Available models",
    "model.add": "Add model",
    "model.edit": "Edit model",
    "model.delete": "Delete model",
    "model.deleteConfirm": "Are you sure you want to delete this model?",
    "model.id": "Model ID",
    "model.idPlaceholder": "e.g. google/gemini-2.5-pro",
    "model.label": "Label",
    "model.labelPlaceholder": "e.g. Gemini 2.5 Pro",
    "model.provider": "Protocol",
    "model.apiBaseUrl": "API Base URL",
    "model.apiBaseUrlPlaceholder": "Leave empty for default",
    "model.apiKey": "API Key",
    "model.apiKeyPlaceholder": "Enter API key for this model",
    "model.isDefault": "Set as default",
    "model.hasKey": "Key configured",
    "model.noKey": "No key",
    "model.save": "Save",
    "model.cancel": "Cancel",
    "model.selectForChat": "Select model for chat",
    "model.test": "Test",
    "model.testOk": "Connection successful",
    "model.testFail": "Connection failed",

    // Nav
    "nav.chat": "Chat",
    "nav.model": "Models",

    // New Project Dialog
    "newProject.title": "New Project",
    "newProject.loading": "Loading...",
    "newProject.empty": "No directories found",
    "newProject.open": "Open",
    "newProject.manualPath": "Enter path manually...",
    "newProject.go": "Go",
    "newProject.name": "Name",
    "newProject.cancel": "Cancel",
    "newProject.create": "Create",

    // Rename + delete project
    "rename.title": "Rename Project",
    "rename.label": "Name",
    "rename.placeholder": "Project name...",
    "rename.save": "Save",
    "rename.cancel": "Cancel",
    "delete.confirmTitle": "Delete project",
    "delete.confirmMessage": "Delete this project? All running sessions under it will be stopped.",
    "delete.confirm": "Delete",
    "delete.cancel": "Cancel",
  },
  zh: {
    "brand.sub": "Agent 工作台",
    "sidebar.projects": "项目",
    "sidebar.sessions": "会话",
    "sidebar.newProject": "新建项目",
    "sidebar.newSession": "新建会话",
    "sidebar.projectPlaceholder": "项目名称...",
    "sidebar.noProjects": "暂无项目",
    "sidebar.noSessions": "暂无会话",
    "sidebar.connected": "已连接",
    "sidebar.connecting": "连接中",
    "sidebar.disconnected": "已断开",

    "header.files": "文件",

    "welcome.title": "PI 工作台",
    "welcome.sub": "从侧边栏选择一个项目或创建新项目以开始。",
    "welcome.hint": "创建新项目",

    "chat.empty": "开始与 Agent 对话",
    "chat.roleUser": "你",
    "chat.roleAgent": "Agent",
    "chat.placeholder": "发送消息...",
    "chat.send": "发送",

    "viewer.selectFile": "选择一个文件查看",

    "toggle.light": "切换到浅色模式",
    "toggle.dark": "切换到暗色模式",
    "toggle.zh": "切换到中文",
    "toggle.en": "Switch to English",

    "error.agentConfig": "Agent 未配置。请在 .env 文件中设置 PI_PROVIDER 和 API key。",

    "model.title": "模型",
    "model.select": "选择模型",
    "model.switched": "模型已切换",
    "model.current": "当前",
    "model.apiKeyHint": "未配置 Provider。请在服务端 .env 文件中设置 PI_PROVIDER 和 API key。",
    "model.available": "可用模型",
    "model.add": "添加模型",
    "model.edit": "编辑模型",
    "model.delete": "删除模型",
    "model.deleteConfirm": "确定要删除此模型吗？",
    "model.id": "模型 ID",
    "model.idPlaceholder": "例如 google/gemini-2.5-pro",
    "model.label": "标签",
    "model.labelPlaceholder": "例如 Gemini 2.5 Pro",
    "model.provider": "协议",
    "model.apiBaseUrl": "API 基础 URL",
    "model.apiBaseUrlPlaceholder": "留空使用默认值",
    "model.apiKey": "API 密钥",
    "model.apiKeyPlaceholder": "输入此模型的 API 密钥",
    "model.isDefault": "设为默认",
    "model.hasKey": "密钥已配置",
    "model.noKey": "无密钥",
    "model.save": "保存",
    "model.cancel": "取消",
    "model.selectForChat": "选择聊天模型",
    "model.test": "测试",
    "model.testOk": "连接成功",
    "model.testFail": "连接失败",

    "nav.chat": "对话",
    "nav.model": "模型",

    "newProject.title": "新建项目",
    "newProject.loading": "加载中...",
    "newProject.empty": "未找到目录",
    "newProject.open": "打开",
    "newProject.manualPath": "手动输入路径...",
    "newProject.go": "前往",
    "newProject.name": "名称",
    "newProject.cancel": "取消",
    "newProject.create": "创建",

    // Rename + delete project
    "rename.title": "重命名项目",
    "rename.label": "名称",
    "rename.placeholder": "项目名称...",
    "rename.save": "保存",
    "rename.cancel": "取消",
    "delete.confirmTitle": "删除项目",
    "delete.confirmMessage": "确认删除该项目？该项目下所有运行中的会话将被停止。",
    "delete.confirm": "删除",
    "delete.cancel": "取消",
  },
};
