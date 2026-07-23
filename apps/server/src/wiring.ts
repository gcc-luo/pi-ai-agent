import fs from "node:fs";
import { Config } from "./config.js";
import { openDatabase } from "./db/sqlite.js";
import { ProjectRepository } from "./db/repositories/project.js";
import { SessionRepository } from "./db/repositories/session.js";
import { MessageRepository } from "./db/repositories/message.js";
import { ModelRepository } from "./db/repositories/model.js";
import { ProcessManager } from "./agent/process-manager.js";
import { SessionStateStore } from "./agent/session-state.js";
import { IdleSweeper } from "./agent/idle-sweeper.js";
import { SkillService } from "./agent/skill-service.js";
import { SkillStoreService } from "./skill-store/skill-store-service.js";
import { KnowledgeBaseRepository } from "./db/repositories/knowledge-base.js";
import { KbFileRepository } from "./db/repositories/kb-file.js";
import { KbChunkRepository } from "./db/repositories/kb-chunk.js";
import { SessionKbBindingRepository } from "./db/repositories/session-kb-binding.js";
import { KbSearchService } from "./kb/search-service.js";
import { ParsePipeline } from "./kb/parse-pipeline.js";
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
import { LibreOfficeService } from "./services/libre-office.js";
import { createOfficePdfRoutes } from "./routes/office-pdf.js";
import { ExpertRepository } from "./db/repositories/expert.js";
import { expertsRoutes } from "./routes/experts.js";

export async function buildConfiguredApp(config: Config) {
  const db = openDatabase(config.dbPath);

  // Rebuild FTS5 index if it's empty but kb_chunks has rows.
  // This happens after migration 008 (drop+create) or first-time setup.
  rebuildFtsIndexIfNeeded(db);

  const projects = new ProjectRepository(db);
  const sessions = new SessionRepository(db);
  sessions.markActiveAsCrashed();
  const messages = new MessageRepository(db);
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
  const sessionStates = new SessionStateStore();
  const experts = new ExpertRepository(db);

  // Seed preset experts (idempotent — only inserts if no presets exist)
  experts.seedPresets([
    { name: "前端架构师", icon: "🏗️", category: "development", description: "精通 React/Vue 等前端框架，擅长系统架构设计和性能优化", systemPrompt: "你是一位资深前端架构师，精通 React、Vue、TypeScript 等现代前端技术栈。你擅长系统架构设计、性能优化、代码质量把控和前端工程化。在回答问题时，请从架构视角出发，关注可扩展性、可维护性和最佳实践。", tags: ["React", "Vue", "架构设计", "性能优化"], sortOrder: 100 },
    { name: "全栈工程师", icon: "💻", category: "development", description: "具备前后端全栈开发能力，熟悉 Node.js、Python 等技术栈", systemPrompt: "你是一位经验丰富的全栈工程师，精通前后端开发，熟悉 Node.js、Python、TypeScript、数据库设计等。你能从全局视角审视技术方案，关注系统的完整性、安全性和可部署性。回答问题时请兼顾前后端视角。", tags: ["Node.js", "Python", "全栈", "API设计"], sortOrder: 99 },
    { name: "UI/UX 设计师", icon: "🎨", category: "design", description: "专注用户体验设计，擅长界面设计、交互设计和设计系统构建", systemPrompt: "你是一位专业的 UI/UX 设计师，精通用户体验设计、界面设计、交互设计和设计系统构建。你善于从用户需求出发，提供清晰、美观、易用的设计方案。回答问题时请关注用户体验、视觉层次和交互逻辑。", tags: ["UI设计", "UX", "交互设计", "设计系统"], sortOrder: 98 },
    { name: "数据分析师", icon: "📊", category: "data", description: "精通数据分析和可视化，善于从数据中发现业务洞察", systemPrompt: "你是一位资深数据分析师，精通数据分析、统计建模、数据可视化和业务洞察。你能从海量数据中提取有价值的信息，并用清晰的方式呈现分析结果。回答问题时请以数据驱动，注重事实依据和逻辑推理。", tags: ["数据分析", "可视化", "统计", "SQL"], sortOrder: 97 },
    { name: "产品经理", icon: "📋", category: "product", description: "具备产品规划和需求分析能力，擅长用户研究和产品策略制定", systemPrompt: "你是一位经验丰富的产品经理，擅长产品规划、需求分析、用户研究和产品策略制定。你能从商业价值和用户需求两个维度思考问题，善于将模糊的需求转化为可执行的产品方案。回答问题时请关注用户价值、商业目标和技术可行性。", tags: ["产品规划", "需求分析", "用户研究", "PRD"], sortOrder: 96 },
    { name: "营销策划师", icon: "📣", category: "marketing", description: "精通数字营销和增长策略，擅长内容营销和品牌推广", systemPrompt: "你是一位资深营销策划师，精通数字营销、增长策略、内容营销和品牌推广。你能制定有效的营销方案，分析市场趋势，撰写有吸引力的营销文案。回答问题时请关注目标受众、转化率和品牌价值。", tags: ["数字营销", "内容营销", "增长", "品牌"], sortOrder: 95 },
    { name: "法律顾问", icon: "⚖️", category: "legal", description: "提供法律合规咨询，熟悉合同法、知识产权和隐私法规", systemPrompt: "你是一位专业的法律顾问，熟悉合同法、知识产权法、隐私法规（如 GDPR）和劳动法等。你能从合规角度审视商业方案，识别法律风险并提供合规建议。回答问题时请注意法律条文的准确性，同时提醒咨询方你的建议仅供参考，重大决策应寻求专业律师意见。", tags: ["合规", "知识产权", "隐私", "合同"], sortOrder: 94 },
    { name: "项目经理", icon: "📌", category: "operations", description: "精通敏捷开发和项目管理，擅长团队协作和进度把控", systemPrompt: "你是一位经验丰富的项目经理，精通敏捷开发（Scrum/Kanban）、项目管理和团队协作。你擅长制定项目计划、把控进度、管理风险和协调资源。回答问题时请关注项目目标、时间线、团队效率和风险管理。", tags: ["敏捷", "Scrum", "项目管理", "团队协作"], sortOrder: 93 },
  ]);

  // Ensure KB files directory exists
  fs.mkdirSync(config.kbFilesDir, { recursive: true });

  // Parse pipeline
  const parsePipeline = new ParsePipeline(db, kbFiles, kbChunks, config.kbFilesDir, knowledgeBases, models);

  // Build app first so we can pass app.log to ProcessManager
  const app = await buildApp(config, {
    db, projects, sessions, messages, models, sessionStates, skills, skillStore,
    knowledgeBases, kbFiles, kbChunks, kbBindings, kbSearch, experts, config,
  });
  const processManager = new ProcessManager({ command: config.piCommand, args: config.piArgs, provider: config.piProvider, model: config.piModel, logger: app.log });
  (app as any).processManager = processManager;

  const sweeper = new IdleSweeper({
    idleTimeoutMs: config.idleTimeoutMs,
    suspendedTimeoutMs: config.suspendedTimeoutMs,
    onIdle: (id) => sessions.setStatus(id, "idle"),
    onSuspend: (id) => {
      const state = sessionStates.get(id);
      if (state) { state.process.kill(); sessionStates.delete(id); }
      sessions.setStatus(id, "suspended");
    },
  });
  app.addHook("onClose", async () => sweeper.stop());

  await app.register(projectsRoutes, { prefix: "/api/projects" });
  await app.register(sessionsRoutes, { prefix: "/api" });
  await app.register(filesRoutes, { prefix: "/api" });
  await app.register(configRoutes, { prefix: "/api" });
  await app.register(modelsRoutes, { prefix: "/api/models" });
  await app.register(fsRoutes, { prefix: "/api/fs" });
  await app.register(skillsRoutes, { prefix: "/api/skills" });
  await app.register(skillStoreRoutes, { prefix: "/api/skill-store" });
  await app.register(knowledgeBasesRoutes, { prefix: "/api/knowledge-bases" });
  await app.register(createKbFilesRoutes(parsePipeline, config.kbFilesDir), { prefix: "/api" });
  await app.register(kbSearchRoutes, { prefix: "/api" });
  await app.register(sessionKbBindingsRoutes, { prefix: "/api" });
  await app.register(trashRoutes, { prefix: "/api/trash" });
  await app.register(expertsRoutes, { prefix: "/api/experts" });

  // LibreOffice → PDF conversion for Office file previews
  const loService = new LibreOfficeService({
    binaryPath: config.libreOfficeBinary || undefined,
    timeoutMs: config.loConvertTimeoutMs,
    cacheDir: config.loCacheDir,
    maxCacheFiles: config.loMaxCacheFiles,
    maxCacheBytes: config.loMaxCacheBytes,
  });
  await app.register(createOfficePdfRoutes(loService), { prefix: "/api" });

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
  const chunks = db.prepare("SELECT rowid, content FROM kb_chunks").all() as { rowid: number; content: string }[];

  const insert = db.prepare("INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)");
  const tx = db.transaction(() => {
    for (const chunk of chunks) {
      insert.run(chunk.rowid, tokenizeForFts(chunk.content));
    }
  });
  tx();
  console.log(`[KB FTS] index rebuilt: ${chunks.length} chunks indexed`);
}
