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

export async function buildConfiguredApp(config: Config) {
  const db = openDatabase(config.dbPath);
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

  // Ensure KB files directory exists
  fs.mkdirSync(config.kbFilesDir, { recursive: true });

  // Parse pipeline
  const parsePipeline = new ParsePipeline(db, kbFiles, kbChunks, config.kbFilesDir);

  // Build app first so we can pass app.log to ProcessManager
  const app = await buildApp(config, {
    db, projects, sessions, messages, models, sessionStates, skills, skillStore,
    knowledgeBases, kbFiles, kbChunks, kbBindings, kbSearch, config,
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
  await app.register(agentRoutes);

  return app;
}
