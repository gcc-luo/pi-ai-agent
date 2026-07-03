import { Config } from "./config.js";
import { openDatabase } from "./db/sqlite.js";
import { ProjectRepository } from "./db/repositories/project.js";
import { SessionRepository } from "./db/repositories/session.js";
import { MessageRepository } from "./db/repositories/message.js";
import { WorkdirManager } from "./workdir/manager.js";
import { ProcessManager } from "./agent/process-manager.js";
import { SessionStateStore } from "./agent/session-state.js";
import { buildApp } from "./app.js";
import { projectsRoutes } from "./routes/projects.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { filesRoutes } from "./routes/files.js";
import { agentRoutes } from "./ws/agent.js";

export async function buildConfiguredApp(config: Config) {
  const db = openDatabase(config.dbPath);
  const workdirs = new WorkdirManager({ root: config.workdirRoot });
  const projects = new ProjectRepository(db);
  const sessions = new SessionRepository(db);
  sessions.markActiveAsCrashed();
  const messages = new MessageRepository(db);
  const processManager = new ProcessManager({ command: config.piCommand, args: config.piArgs });
  const sessionStates = new SessionStateStore();
  const app = await buildApp(config, { db, projects, sessions, messages, workdirs, processManager, sessionStates });

  await app.register(projectsRoutes, { prefix: "/api/projects" });
  await app.register(sessionsRoutes, { prefix: "/api" });
  await app.register(filesRoutes, { prefix: "/api" });
  await app.register(agentRoutes);

  return app;
}
