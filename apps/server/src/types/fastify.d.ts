import "fastify";
import type Database from "better-sqlite3";
import type { ProjectRepository } from "./db/repositories/project.js";
import type { SessionRepository } from "./db/repositories/session.js";
import type { MessageRepository } from "./db/repositories/message.js";
import type { WorkdirManager } from "./workdir/manager.js";
import type { ProcessManager } from "./agent/process-manager.js";
import type { SessionStateStore } from "./agent/session-state.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database.Database;
    projects: ProjectRepository;
    sessions: SessionRepository;
    messages: MessageRepository;
    workdirs: WorkdirManager;
    processManager: ProcessManager;
    sessionStates: SessionStateStore;
  }
}
