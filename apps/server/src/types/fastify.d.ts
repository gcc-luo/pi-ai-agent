import "fastify";
import type Database from "better-sqlite3";
import type { ProjectRepository } from "../db/repositories/project.js";
import type { SessionRepository } from "../db/repositories/session.js";
import type { MessageRepository } from "../db/repositories/message.js";
import type { ModelRepository } from "../db/repositories/model.js";
import type { ProcessManager } from "../agent/process-manager.js";
import type { SessionStateStore } from "../agent/session-state.js";
import type { SkillService } from "../agent/skill-service.js";
import type { SkillStoreService } from "../skill-store/skill-store-service.js";
import type { KnowledgeBaseRepository } from "../db/repositories/knowledge-base.js";
import type { KbFileRepository } from "../db/repositories/kb-file.js";
import type { KbChunkRepository } from "../db/repositories/kb-chunk.js";
import type { SessionKbBindingRepository } from "../db/repositories/session-kb-binding.js";
import type { KbSearchService } from "../kb/search-service.js";
import type { ExpertRepository } from "../db/repositories/expert.js";
import type { ScheduledTaskRepository, TaskLogRepository } from "../db/repositories/scheduled-task.js";
import type { TaskScheduler } from "../services/task-scheduler.js";
import type { Config } from "../config.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database.Database;
    projects: ProjectRepository;
    sessions: SessionRepository;
    messages: MessageRepository;
    models: ModelRepository;
    processManager: ProcessManager;
    sessionStates: SessionStateStore;
    skills: SkillService;
    skillStore: SkillStoreService;
    knowledgeBases: KnowledgeBaseRepository;
    kbFiles: KbFileRepository;
    kbChunks: KbChunkRepository;
    kbBindings: SessionKbBindingRepository;
    kbSearch: KbSearchService;
    experts: ExpertRepository;
    scheduledTasks: ScheduledTaskRepository;
    taskLogs: TaskLogRepository;
    taskScheduler: TaskScheduler;
    config: Config;
  }
}
