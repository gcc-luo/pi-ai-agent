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
  const sessionStates = new SessionStateStore();

  // Build app first so we can pass app.log to ProcessManager
  const app = await buildApp(config, { db, projects, sessions, messages, models, sessionStates, skills, skillStore, config });
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
  await app.register(agentRoutes);

  return app;
}
