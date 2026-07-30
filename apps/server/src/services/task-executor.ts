import type { FastifyBaseLogger } from "fastify";
import type { SessionRepository } from "../db/repositories/session.js";
import type { ProjectRepository } from "../db/repositories/project.js";
import type { ModelRepository } from "../db/repositories/model.js";
import type { MessageRepository } from "../db/repositories/message.js";
import type { ScheduledTaskRepository } from "../db/repositories/scheduled-task.js";
import type { ProcessManager } from "../agent/process-manager.js";
import { RpcBridge } from "../agent/rpc-bridge.js";
import type { SessionDto } from "@pi-web-ui/shared";

const TASK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// Global instruction appended so the agent declares delivered files.
const ARTIFACT_INSTRUCTION = `<global-instruction>
当你创建或生成文件时，必须在回复末尾使用 <artifacts> 标签声明交付物。
格式：
<artifacts>
[{"path": "相对路径", "name": "文件名", "mimeType": "MIME类型"}]
</artifacts>

规则：
1. path 为相对于项目根目录的路径
2. 仅声明实际已写入磁盘的文件
3. 多个文件放在同一个 JSON 数组中
4. 不要声明中间产物或临时文件
</global-instruction>`;

export class TaskExecutor {
  constructor(
    private sessions: SessionRepository,
    private projects: ProjectRepository,
    private models: ModelRepository,
    private messages: MessageRepository,
    private scheduledTasks: ScheduledTaskRepository,
    private processManager: ProcessManager,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Execute a prompt task: create or reuse a session, send the prompt to the agent,
   * and return the AI response. The session remains available for the user
   * to view the full conversation in the chat view.
   */
  async executePrompt(params: {
    taskName: string;
    projectId: string;
    promptText: string;
    taskId: string;
    createNewSession: boolean;
  }): Promise<{ sessionId: string; response: string }> {
    const { taskName, projectId, promptText, taskId, createNewSession } = params;

    // Verify project exists
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Determine whether to create a new session or reuse
    const task = this.scheduledTasks.findById(taskId);
    let session!: SessionDto;
    let isNewSession = true;

    if (!createNewSession && task?.sessionId) {
      // Try to reuse existing session
      const existing = this.sessions.findById(task.sessionId);
      if (existing) {
        session = existing;
        isNewSession = false;
        this.logger.info(`[TaskExecutor] reusing session ${session.id} for task "${taskName}"`);
      } else {
        this.logger.warn(`[TaskExecutor] session ${task.sessionId} not found, creating new one`);
      }
    }

    if (isNewSession) {
      session = this.sessions.create({
        projectId,
        title: `[定时任务] ${taskName}`,
      });
      this.logger.info(`[TaskExecutor] created new session ${session.id} for task "${taskName}"`);
    }

    // Resolve model config
    const defaultModel = this.models.getDefault();
    const modelConfig = defaultModel ? {
      provider: defaultModel.provider,
      model: defaultModel.id,
      modelType: defaultModel.modelType,
      apiKey: this.models.getApiKey(defaultModel.id),
      apiBaseUrl: defaultModel.apiBaseUrl,
    } : undefined;

    // Spawn agent process
    const proc = await this.processManager.start({
      sessionId: session.id,
      projectId: project.id,
      workdir: project.workdir,
      modelConfig,
      browserEnabled: session.browserEnabled,
    });

    const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);

    // Wait for the agent to finish processing
    const response = await new Promise<string>((resolve, reject) => {
      let responseText = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        reject(new Error("Task execution timed out (2 minutes)"));
      }, TASK_TIMEOUT_MS);

      bridge.onEvent((e) => {
        if (settled) return;

        // Persist assistant message on message_end
        if (e.type === "message_end" && e.content) {
          responseText = e.content;
          this.messages.append({
            sessionId: session.id,
            role: "assistant",
            content: e.content,
            metadata: e.metadata ?? undefined,
            createdAt: e.timestamp,
          });
          this.logger.debug(`[TaskExecutor] persisted assistant message for session ${session.id}`);
        }

        // Agent finished processing
        if (e.type === "agent_status" && e.status === "idle") {
          settled = true;
          clearTimeout(timer);
          proc.kill();
          resolve(responseText);
        }
      });

      proc.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          reject(new Error(`Agent process exited with code ${code}`));
        } else {
          resolve(responseText);
        }
      });

      proc.on("stderr", (line) => {
        this.logger.warn(`[TaskExecutor] agent stderr: ${line}`);
      });

      // Send the prompt with artifact instruction (persisted message uses original text)
      bridge.send({ type: "send", sessionId: session.id, content: `${promptText}\n\n${ARTIFACT_INSTRUCTION}` });
      this.messages.append({
        sessionId: session.id,
        role: "user",
        content: promptText,
        metadata: { source: "scheduled-task" },
      });
      this.logger.debug(`[TaskExecutor] persisted user message for session ${session.id}`);
    });

    // Persist session_id on the task for future reuse (reuse mode, first execution)
    if (isNewSession && !createNewSession) {
      this.scheduledTasks.setSessionId(taskId, session.id);
      this.logger.info(`[TaskExecutor] saved session_id ${session.id} on task ${taskId} for reuse`);
    }

    return { sessionId: session.id, response };
  }
}
