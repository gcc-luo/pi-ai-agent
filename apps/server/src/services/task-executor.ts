import type { FastifyBaseLogger } from "fastify";
import type { SessionRepository } from "../db/repositories/session.js";
import type { ProjectRepository } from "../db/repositories/project.js";
import type { ModelRepository } from "../db/repositories/model.js";
import type { ProcessManager } from "../agent/process-manager.js";
import { RpcBridge } from "../agent/rpc-bridge.js";

const TASK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export class TaskExecutor {
  constructor(
    private sessions: SessionRepository,
    private projects: ProjectRepository,
    private models: ModelRepository,
    private processManager: ProcessManager,
    private logger: FastifyBaseLogger,
  ) {}

  /**
   * Execute a prompt task: create a session, send the prompt to the agent,
   * and return the AI response. The session remains available for the user
   * to view the full conversation in the chat view.
   */
  async executePrompt(params: {
    taskName: string;
    projectId: string;
    promptText: string;
  }): Promise<{ sessionId: string; response: string }> {
    const { taskName, projectId, promptText } = params;

    // Verify project exists
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Create a new session for this execution
    const session = this.sessions.create({
      projectId,
      title: `[定时任务] ${taskName}`,
    });

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

        // Capture response text from message_end events
        if (e.type === "message_end" && e.content) {
          responseText = e.content;
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

      // Send the prompt
      bridge.send({ type: "send", sessionId: session.id, content: promptText });
    });

    return { sessionId: session.id, response };
  }
}
