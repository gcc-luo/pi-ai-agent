import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Config } from "./config.js";
import { openDatabase } from "./db/sqlite.js";
import { ProjectRepository } from "./db/repositories/project.js";
import { SessionRepository } from "./db/repositories/session.js";
import { MessageRepository } from "./db/repositories/message.js";
import { ModelRepository } from "./db/repositories/model.js";
import { ProcessManager } from "./agent/process-manager.js";
import { SessionStateStore } from "./agent/session-state.js";
import { SessionEventBuffer } from "./agent/session-event-buffer.js";
import { IdleSweeper } from "./agent/idle-sweeper.js";
import { TrashSweeper } from "./services/trash-sweeper.js";
import { SkillService } from "./agent/skill-service.js";
import { SkillStoreService } from "./skill-store/skill-store-service.js";
import { KnowledgeBaseRepository } from "./db/repositories/knowledge-base.js";
import { KbFileRepository } from "./db/repositories/kb-file.js";
import { KbChunkRepository } from "./db/repositories/kb-chunk.js";
import { SessionKbBindingRepository } from "./db/repositories/session-kb-binding.js";
import { KbSearchService } from "./kb/search-service.js";
import { ParsePipeline } from "./kb/parse-pipeline.js";
import { KbParseJobRepository } from "./db/repositories/kb-parse-job.js";
import { KbParseJobWorker } from "./kb/parse-job-worker.js";
import { tokenizeForFts } from "./kb/fts-tokenize.js";
import { buildApp } from "./app.js";
import { projectsRoutes } from "./routes/projects.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { filesRoutes } from "./routes/files.js";
import { configRoutes } from "./routes/config.js";
import { modelsRoutes } from "./routes/models.js";
import { agentRoutes } from "./ws/agent.js";
import { fsRoutes } from "./routes/fs.js";
import { skillsRoutes } from "./routes/skills.js";
import { skillStoreRoutes } from "./routes/skill-store.js";
import { knowledgeBasesRoutes } from "./routes/knowledge-bases.js";
import { createKbFilesRoutes } from "./routes/kb-files.js";
import { kbSearchRoutes } from "./routes/kb-search.js";
import { sessionKbBindingsRoutes } from "./routes/session-kb-bindings.js";
import { trashRoutes } from "./routes/trash.js";
import { ExpertRepository } from "./db/repositories/expert.js";
import { expertsRoutes } from "./routes/experts.js";
import { ScheduledTaskRepository, TaskLogRepository } from "./db/repositories/scheduled-task.js";
import { TaskScheduler } from "./services/task-scheduler.js";
import { TaskExecutor } from "./services/task-executor.js";
import { scheduledTasksRoutes } from "./routes/scheduled-tasks.js";
import { ChannelRepository } from "./db/repositories/channel.js";
import { channelsRoutes } from "./routes/channels.js";
import { getRegistry, rebuildAdapters, startChannelListeners } from "./channels/registry.js";
import { getWeChatWorker } from "./channels/wechat-worker.js";
import { WeChatAgentService } from "./channels/wechat-agent-service.js";
import { ChannelAgentService } from "./channels/channel-agent-service.js";
import { ChannelConversationRepository } from "./db/repositories/channel-conversation.js";
import { BrowserSessionManager } from "./browser/browser-session-manager.js";
import { browserRoutes } from "./routes/browser.js";
import { PluginRepository } from "./db/repositories/plugin.js";
import { ComputerSessionManager } from "./computer/computer-session-manager.js";
import { PluginManager } from "./plugins/plugin-manager.js";
import { pluginsRoutes } from "./routes/plugins.js";
import { PluginPermissionService } from "./plugins/plugin-permission-service.js";
import { backupsRoutes } from "./routes/backups.js";
import path from "node:path";
import { ConnectorRepository } from "./connectors/connector-repository.js";
import { CredentialVault } from "./connectors/credential-vault.js";
import { McpRuntimeManager } from "./connectors/mcp-runtime.js";
import { ConnectorService } from "./connectors/connector-service.js";
import { connectorsRoutes } from "./routes/connectors.js";
import { releaseRoutes } from "./routes/releases.js";

export async function buildConfiguredApp(config: Config) {
  const db = openDatabase(config.dbPath);

  // Rebuild FTS5 index if it's empty but kb_chunks has rows.
  // This happens after migration 008 (drop+create) or first-time setup.
  rebuildFtsIndexIfNeeded(db);

  const projects = new ProjectRepository(db);
  const sessions = new SessionRepository(db);
  sessions.markActiveAsCrashed();
  const messages = new MessageRepository(db);
  const repairedToolCalls = messages.finishDanglingToolCalls(
    "应用或 Agent 进程已结束，工具调用未完成。",
  );
  if (repairedToolCalls > 0) {
    console.log(`[Session Recovery] finalized ${repairedToolCalls} dangling tool-call messages`);
  }
  const models = new ModelRepository(db);
  const skills = new SkillService(config.skillsDir);
  const skillStore = new SkillStoreService({
    skillsDir: config.skillsDir,
    timeoutMs: config.skillStoreTimeoutMs,
    skillsMpApiKey: config.skillsMpApiKey || undefined,
  });
  const knowledgeBases = new KnowledgeBaseRepository(db);
  const kbFiles = new KbFileRepository(db);
  const kbChunks = new KbChunkRepository(db);
  const kbBindings = new SessionKbBindingRepository(db);
  const kbSearch = new KbSearchService(db);
  const kbParseJobs = new KbParseJobRepository(db);
  const sessionStates = new SessionStateStore();
  const sessionEvents = new SessionEventBuffer();
  const experts = new ExpertRepository(db);
  const scheduledTasks = new ScheduledTaskRepository(db);
  const taskLogs = new TaskLogRepository(db);
  const channels = new ChannelRepository(db);
  const channelConversations = new ChannelConversationRepository(db);
  const plugins = new PluginRepository(db);
  const connectorRepository = new ConnectorRepository(db);
  const credentialVault = new CredentialVault(path.join(path.dirname(config.dbPath), "credentials"));

  // Seed preset experts (idempotent — adds only presets not yet present).
  experts.seedPresets([
    { name: "前端架构师", icon: "🏗️", category: "development", description: "精通 React/Vue 等前端框架，擅长系统架构设计和性能优化", systemPrompt: "你是一位资深前端架构师，精通 React、Vue、TypeScript 等现代前端技术栈。你擅长系统架构设计、性能优化、代码质量把控和前端工程化。在回答问题时，请从架构视角出发，关注可扩展性、可维护性和最佳实践。", tags: ["React", "Vue", "架构设计", "性能优化"], sortOrder: 100 },
    { name: "全栈工程师", icon: "💻", category: "development", description: "具备前后端全栈开发能力，熟悉 Node.js、Python 等技术栈", systemPrompt: "你是一位经验丰富的全栈工程师，精通前后端开发，熟悉 Node.js、Python、TypeScript、数据库设计等。你能从全局视角审视技术方案，关注系统的完整性、安全性和可部署性。回答问题时请兼顾前后端视角。", tags: ["Node.js", "Python", "全栈", "API设计"], sortOrder: 99 },
    { name: "UI/UX 设计师", icon: "🎨", category: "design", description: "专注用户体验设计，擅长界面设计、交互设计和设计系统构建", systemPrompt: "你是一位专业的 UI/UX 设计师，精通用户体验设计、界面设计、交互设计和设计系统构建。你善于从用户需求出发，提供清晰、美观、易用的设计方案。回答问题时请关注用户体验、视觉层次和交互逻辑。", tags: ["UI设计", "UX", "交互设计", "设计系统"], sortOrder: 98 },
    { name: "数据分析师", icon: "📊", category: "data", description: "精通数据分析和可视化，善于从数据中发现业务洞察", systemPrompt: "你是一位资深数据分析师，精通数据分析、统计建模、数据可视化和业务洞察。你能从海量数据中提取有价值的信息，并用清晰的方式呈现分析结果。回答问题时请以数据驱动，注重事实依据和逻辑推理。", tags: ["数据分析", "可视化", "统计", "SQL"], sortOrder: 97 },
    { name: "产品经理", icon: "📋", category: "product", description: "具备产品规划和需求分析能力，擅长用户研究和产品策略制定", systemPrompt: "你是一位经验丰富的产品经理，擅长产品规划、需求分析、用户研究和产品策略制定。你能从商业价值和用户需求两个维度思考问题，善于将模糊的需求转化为可执行的产品方案。回答问题时请关注用户价值、商业目标和技术可行性。", tags: ["产品规划", "需求分析", "用户研究", "PRD"], sortOrder: 96 },
    { name: "营销策划师", icon: "📣", category: "marketing", description: "精通数字营销和增长策略，擅长内容营销和品牌推广", systemPrompt: "你是一位资深营销策划师，精通数字营销、增长策略、内容营销和品牌推广。你能制定有效的营销方案，分析市场趋势，撰写有吸引力的营销文案。回答问题时请关注目标受众、转化率和品牌价值。", tags: ["数字营销", "内容营销", "增长", "品牌"], sortOrder: 95 },
    { name: "法律顾问", icon: "⚖️", category: "legal", description: "提供法律合规咨询，熟悉合同法、知识产权和隐私法规", systemPrompt: "你是一位专业的法律顾问，熟悉合同法、知识产权法、隐私法规（如 GDPR）和劳动法等。你能从合规角度审视商业方案，识别法律风险并提供合规建议。回答问题时请注意法律条文的准确性，同时提醒咨询方你的建议仅供参考，重大决策应寻求专业律师意见。", tags: ["合规", "知识产权", "隐私", "合同"], sortOrder: 94 },
    { name: "项目经理", icon: "📌", category: "operations", description: "精通敏捷开发和项目管理，擅长团队协作和进度把控", systemPrompt: "你是一位经验丰富的项目经理，精通敏捷开发（Scrum/Kanban）、项目管理和团队协作。你擅长制定项目计划、把控进度、管理风险和协调资源。回答问题时请关注项目目标、时间线、团队效率和风险管理。", tags: ["敏捷", "Scrum", "项目管理", "团队协作"], sortOrder: 93 },
    { name: "后端架构师", icon: "🧩", category: "development", description: "擅长分布式系统、服务设计、数据库与高并发治理", systemPrompt: "你是一位资深后端架构师，精通服务边界设计、分布式系统、数据库、缓存、消息队列与高并发治理。请从可靠性、可观测性、安全性、性能和长期演进角度给出可落地的方案，并明确关键取舍。", tags: ["微服务", "数据库", "高并发", "系统设计"], sortOrder: 92 },
    { name: "DevOps 工程师", icon: "⚙️", category: "development", description: "专注 CI/CD、云原生、可观测性和稳定性工程", systemPrompt: "你是一位 DevOps 与 SRE 工程师，熟悉 CI/CD、Docker、Kubernetes、云服务、基础设施即代码、监控告警与故障演练。请优先给出安全、可回滚、可观测的交付与运维方案。", tags: ["CI/CD", "Docker", "Kubernetes", "SRE"], sortOrder: 91 },
    { name: "测试工程师", icon: "🧪", category: "development", description: "擅长测试策略、自动化测试、质量度量与缺陷分析", systemPrompt: "你是一位资深测试工程师，擅长测试策略制定、单元测试、接口测试、端到端测试、性能测试和质量度量。请围绕风险设计测试用例，说明覆盖边界、预期结果与自动化优先级。", tags: ["单元测试", "E2E", "性能测试", "质量保障"], sortOrder: 90 },
    { name: "AI 应用工程师", icon: "✨", category: "development", description: "专注大模型应用、RAG、Agent 与 AI 产品工程化", systemPrompt: "你是一位 AI 应用工程师，熟悉大语言模型、提示词设计、RAG、Agent、模型评估、成本控制与安全防护。请从用户价值、准确性、延迟、成本和数据安全之间做工程化权衡。", tags: ["LLM", "RAG", "Agent", "提示词"], sortOrder: 89 },
    { name: "品牌视觉设计师", icon: "🖌️", category: "design", description: "擅长品牌识别、视觉语言、营销物料和设计规范", systemPrompt: "你是一位品牌视觉设计师，擅长品牌定位到视觉识别系统的落地，包括色彩、字体、版式、插画与营销物料。请提供清晰的视觉方向、设计理由和可执行规范，并保持品牌一致性。", tags: ["品牌", "视觉识别", "排版", "设计规范"], sortOrder: 88 },
    { name: "用户研究员", icon: "🔎", category: "design", description: "通过定性与定量研究理解用户需求和使用障碍", systemPrompt: "你是一位用户研究员，熟悉访谈、问卷、可用性测试、用户旅程和定量分析。请将模糊问题转成可验证的研究假设，给出招募、方法、问题设计与洞察输出建议。", tags: ["用户访谈", "可用性测试", "用户旅程", "洞察"], sortOrder: 87 },
    { name: "数据工程师", icon: "🛠️", category: "data", description: "擅长数据建模、ETL、数据仓库与数据质量治理", systemPrompt: "你是一位数据工程师，精通数据采集、ETL/ELT、数据建模、数据仓库、任务调度和数据质量治理。请设计可维护、可追溯、可扩展的数据链路，并明确口径与质量校验。", tags: ["ETL", "数据仓库", "SQL", "数据治理"], sortOrder: 86 },
    { name: "数据科学家", icon: "📈", category: "data", description: "擅长实验设计、预测建模、因果推断和指标解释", systemPrompt: "你是一位数据科学家，擅长实验设计、统计推断、预测建模、因果分析和指标体系。请区分相关性与因果性，说明数据假设、评估方法、置信度和业务限制。", tags: ["A/B测试", "机器学习", "统计", "因果推断"], sortOrder: 85 },
    { name: "内容营销专家", icon: "✍️", category: "marketing", description: "擅长内容策略、品牌叙事、SEO 与多渠道传播", systemPrompt: "你是一位内容营销专家，擅长内容策略、品牌叙事、SEO、社媒与邮件营销。请结合目标受众、渠道特性和转化目标，提供有明确主题、结构、行动号召和评估指标的内容方案。", tags: ["内容策略", "SEO", "文案", "社媒"], sortOrder: 84 },
    { name: "增长运营专家", icon: "🚀", category: "marketing", description: "聚焦获客、激活、留存、转化与增长实验", systemPrompt: "你是一位增长运营专家，熟悉增长漏斗、用户分层、生命周期运营、渠道分析和增长实验。请先定位关键瓶颈，再提出可衡量、可实验、可复盘的增长动作。", tags: ["增长", "漏斗", "留存", "转化"], sortOrder: 83 },
    { name: "产品策略顾问", icon: "🧭", category: "product", description: "擅长市场定位、产品路线图、商业模式与优先级决策", systemPrompt: "你是一位产品策略顾问，擅长市场分析、竞争定位、产品组合、路线图和商业模式设计。请以用户价值和业务目标为核心，明确假设、优先级、资源投入与验证指标。", tags: ["产品战略", "路线图", "商业模式", "优先级"], sortOrder: 82 },
    { name: "财务分析师", icon: "💰", category: "finance", description: "擅长预算、经营分析、现金流与财务建模", systemPrompt: "你是一位财务分析师，擅长预算编制、经营分析、现金流预测、成本结构和财务建模。请基于明确假设给出计算口径、敏感性分析和经营建议；不确定数据应清晰标注。", tags: ["预算", "现金流", "财务建模", "经营分析"], sortOrder: 81 },
    { name: "投资研究员", icon: "🔬", category: "finance", description: "擅长行业研究、公司分析、估值框架与风险识别", systemPrompt: "你是一位投资研究员，擅长行业研究、公司基本面分析、估值框架和风险识别。请基于公开信息和明确假设进行分析，区分事实与判断，并提示投资分析不构成个性化投资建议。", tags: ["行业研究", "估值", "基本面", "风险"], sortOrder: 80 },
    { name: "合同法务顾问", icon: "📝", category: "legal", description: "擅长合同审阅、条款谈判与交易风险控制", systemPrompt: "你是一位合同法务顾问，擅长合同审阅、条款谈判、知识产权与交易风险控制。请识别权利义务、责任限制、违约、保密、争议解决等关键风险，并提供可讨论的修改建议；重大事项应建议咨询执业律师。", tags: ["合同", "条款审阅", "谈判", "交易风险"], sortOrder: 79 },
    { name: "运营策略专家", icon: "📣", category: "operations", description: "擅长业务流程、服务交付、效率提升与运营指标设计", systemPrompt: "你是一位运营策略专家，擅长业务流程设计、服务交付、组织协同、运营指标和效率改进。请从目标、流程、角色、节奏、风险和数据看板六个方面提出可落地的运营方案。", tags: ["流程优化", "运营指标", "服务交付", "效率"], sortOrder: 78 },
  ]);

  // Ensure KB files directory exists
  fs.mkdirSync(config.kbFilesDir, { recursive: true });

  // Parse pipeline
  const parsePipeline = new ParsePipeline(db, kbFiles, kbChunks, config.kbFilesDir, knowledgeBases, models);

  // Build app first so we can pass app.log to ProcessManager
  const app = await buildApp(config, {
    db, projects, sessions, messages, models, sessionStates, sessionEvents, skills, skillStore,
    knowledgeBases, kbFiles, kbChunks, kbBindings, kbSearch, experts,
    kbParseJobs, scheduledTasks, taskLogs, channels, channelConversations, plugins, config,
  });
  const kbParseWorker = new KbParseJobWorker(kbParseJobs, parsePipeline, app.log);
  (app as any).kbParseWorker = kbParseWorker;
  app.addHook("onReady", async () => kbParseWorker.start());
  app.addHook("onClose", async () => kbParseWorker.stop());
  const browserManager = new BrowserSessionManager({ logger: app.log });
  (app as any).browserManager = browserManager;
  const computerManager = new ComputerSessionManager(app.log);
  (app as any).computerManager = computerManager;
  const pluginManager = new PluginManager(plugins, browserManager, computerManager);
  (app as any).pluginManager = pluginManager;
  const pluginPermissions = new PluginPermissionService();
  (app as any).pluginPermissions = pluginPermissions;
  const connectorRuntime = new McpRuntimeManager(credentialVault, app.log);
  const connectorService = new ConnectorService(connectorRepository, credentialVault, connectorRuntime);
  (app as any).connectorService = connectorService;
  let browserExtensionPath = fileURLToPath(
    new URL("./agent/extensions/browser-tools.js", import.meta.url),
  );
  if (!fs.existsSync(browserExtensionPath)) {
    browserExtensionPath = browserExtensionPath.replace(/\.js$/, ".ts");
  }
  let computerExtensionPath = fileURLToPath(
    new URL("./agent/extensions/computer-tools.js", import.meta.url),
  );
  if (!fs.existsSync(computerExtensionPath)) {
    computerExtensionPath = computerExtensionPath.replace(/\.js$/, ".ts");
  }
  let connectorExtensionPath = fileURLToPath(
    new URL("./agent/extensions/connector-tools.js", import.meta.url),
  );
  if (!fs.existsSync(connectorExtensionPath)) connectorExtensionPath = connectorExtensionPath.replace(/\.js$/, ".ts");
  let contextExtensionPath = fileURLToPath(new URL("./agent/extensions/context-policy.js", import.meta.url));
  if (!fs.existsSync(contextExtensionPath)) contextExtensionPath = contextExtensionPath.replace(/\.js$/, ".ts");
  const processManager = new ProcessManager({
    command: config.piCommand,
    args: config.piArgs,
    npmRegistry: config.piNpmRegistry,
    provider: config.piProvider,
    model: config.piModel,
    autoCompaction: config.piAutoCompaction,
    sessionRootDir: config.piSessionRootDir,
    browserExtensionPath,
    browserEndpoint: `http://127.0.0.1:${config.port}/api/internal/browser`,
    pluginExtensions: {
      "browser-use": browserExtensionPath,
      "computer-use": computerExtensionPath,
    },
    pluginEndpoint: `http://127.0.0.1:${config.port}/api/internal/plugins`,
    connectorExtensionPath,
    connectorEndpoint: `http://127.0.0.1:${config.port}/api`,
    contextExtensionPath,
    hasConnectors: (projectId) => connectorRepository.list(projectId).some((connector) => connector.enabled),
    isPluginEnabled: (pluginId) => {
      const plugin = pluginManager.find(pluginId);
      return plugin?.enabled === true && plugin.status !== "unavailable";
    },
    logger: app.log,
  });
  (app as any).processManager = processManager;
  const wechatAgentService = new WeChatAgentService(
    channels, channelConversations, projects, sessions, messages, models, processManager, app.log,
  );
  getWeChatWorker().setInboundHandler((input) => wechatAgentService.reply(input.userId, input.text));
  const channelAgentService = new ChannelAgentService(
    channels, channelConversations, projects, sessions, messages, models, processManager, app.log,
  );
  getRegistry().setLogger((event, data, level) => {
    const logger = level?.toLowerCase() === "error" ? app.log.error
      : level?.toLowerCase() === "warn" ? app.log.warn
        : level?.toLowerCase() === "debug" ? app.log.debug
          : app.log.info;
    logger.call(app.log, { channelEvent: event, ...data }, "channel adapter event");
  });
  getRegistry().setOnIncoming((message) => channelAgentService.reply({
    channelId: message.adapter,
    sender: message.sender,
    text: message.text,
    metadata: message.metadata,
  }));

  const sweeper = new IdleSweeper({
    idleTimeoutMs: config.idleTimeoutMs,
    suspendedTimeoutMs: config.suspendedTimeoutMs,
    onIdle: (id) => sessions.setStatus(id, "idle"),
    onSuspend: (id) => {
      pluginPermissions.cancelSession(id);
      processManager.revokePluginToken(id);
      const state = sessionStates.get(id);
      if (state) { state.process.kill(); sessionStates.delete(id); }
      void pluginManager.closeSession(id);
      sessions.setStatus(id, "suspended");
    },
  });
  app.addHook("onClose", async () => {
    sweeper.stop();
    await processManager.shutdown();
    pluginPermissions.shutdown();
    await pluginManager.shutdown();
    await connectorRuntime.shutdown();
    try {
      const { getRegistry } = await import("./channels/registry.js");
      await getRegistry().stopAll();
    } catch {
      // best-effort shutdown
    }
  });

  await app.register(projectsRoutes, { prefix: "/api/projects" });
  await app.register(sessionsRoutes, { prefix: "/api" });
  await app.register(filesRoutes, { prefix: "/api" });
  await app.register(configRoutes, { prefix: "/api" });
  await app.register(modelsRoutes, { prefix: "/api/models" });
  await app.register(fsRoutes, { prefix: "/api/fs" });
  await app.register(skillsRoutes, { prefix: "/api/skills" });
  await app.register(skillStoreRoutes, { prefix: "/api/skill-store" });
  await app.register(knowledgeBasesRoutes, { prefix: "/api/knowledge-bases" });
  await app.register(createKbFilesRoutes(kbParseWorker, config.kbFilesDir), { prefix: "/api" });
  await app.register(kbSearchRoutes, { prefix: "/api" });
  await app.register(sessionKbBindingsRoutes, { prefix: "/api" });
  await app.register(browserRoutes, { prefix: "/api" });
  await app.register(pluginsRoutes, { prefix: "/api" });
  await app.register(trashRoutes, { prefix: "/api/trash" });
  await app.register(expertsRoutes, { prefix: "/api/experts" });
  await app.register(channelsRoutes, { prefix: "/api/channels" });
  await app.register(backupsRoutes, { prefix: "/api/backups" });
  await app.register(connectorsRoutes, { prefix: "/api" });
  await app.register(releaseRoutes, { prefix: "/api" });

  // Rebuild channel adapters from persisted configs so test/send works
  // immediately after restart without a re-save.
  await rebuildAdapters(channels.list());
  await startChannelListeners();

  // Resume WeChat only when cached credentials exist. A new QR login must be
  // initiated from the visible UI, otherwise there is no place to show it.
  void getWeChatWorker().ensureStarted().catch((err) => {
    console.error("[wechat] failed to auto-resume:", err);
  });

  // Scheduled tasks
  const taskExecutor = new TaskExecutor(sessions, projects, models, messages, scheduledTasks, processManager, app.log);
  const taskScheduler = new TaskScheduler(scheduledTasks, taskLogs, app.log);
  taskScheduler.setExecutor(taskExecutor);
  (app as any).taskScheduler = taskScheduler;
  await app.register(scheduledTasksRoutes, { prefix: "/api/scheduled-tasks" });
  app.addHook("onReady", async () => taskScheduler.start());
  app.addHook("onClose", async () => taskScheduler.stop());

  // Trash auto-purge: permanently delete items past the retention period
  const trashSweeper = new TrashSweeper(projects, sessions, config.trashRetentionMs, app.log);
  app.addHook("onReady", async () => trashSweeper.start());
  app.addHook("onClose", async () => trashSweeper.stop());


  await app.register(agentRoutes);

  return app;
}

/**
 * Rebuild the FTS5 index from kb_chunks if the index is empty.
 * Called on startup — handles migration 008 (drop+recreate) and fresh installs.
 * Uses tokenizeForFts() to split CJK characters for proper unicode61 indexing.
 */
function rebuildFtsIndexIfNeeded(db: import("better-sqlite3").Database): void {
  // For external-content FTS5 tables, COUNT(*) reads the content table — not the index.
  // Check the _docsize shadow table instead: it only has rows for actually-indexed documents.
  let indexedDocs: number;
  try {
    indexedDocs = (db.prepare("SELECT COUNT(*) as cnt FROM kb_chunks_fts_docsize").get() as { cnt: number }).cnt;
  } catch {
    indexedDocs = 0; // shadow table doesn't exist (fresh install)
  }
  if (indexedDocs > 0) return;

  const chunkCount = (db.prepare("SELECT COUNT(*) as cnt FROM kb_chunks").get() as { cnt: number }).cnt;
  if (chunkCount === 0) return;

  console.log(`[KB FTS] rebuilding index: ${chunkCount} chunks to tokenize with jieba...`);
  const chunks = db.prepare("SELECT rowid, title_path, content FROM kb_chunks").all() as { rowid: number; title_path: string | null; content: string }[];

  const insert = db.prepare("INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)");
  const tx = db.transaction(() => {
    for (const chunk of chunks) {
      insert.run(chunk.rowid, tokenizeForFts(chunk.title_path ? `${chunk.title_path}\n${chunk.content}` : chunk.content));
    }
  });
  tx();
  console.log(`[KB FTS] index rebuilt: ${chunks.length} chunks indexed`);
}
