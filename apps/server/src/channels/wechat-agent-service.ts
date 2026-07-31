import type { FastifyBaseLogger } from "fastify";
import type { ChannelRepository } from "../db/repositories/channel.js";
import type { ChannelConversationRepository } from "../db/repositories/channel-conversation.js";
import type { ProjectRepository } from "../db/repositories/project.js";
import type { SessionRepository } from "../db/repositories/session.js";
import type { MessageRepository } from "../db/repositories/message.js";
import type { ModelRepository } from "../db/repositories/model.js";
import type { ProcessManager } from "../agent/process-manager.js";
import { RpcBridge } from "../agent/rpc-bridge.js";
import { buildWeChatAgentReply, type WeChatAgentReply } from "./wechat-artifacts.js";

const RESPONSE_TIMEOUT_MS = 2 * 60 * 1000;

const ARTIFACT_INSTRUCTION = `<global-instruction>
当你创建或生成文件时，必须在回复末尾使用 <artifacts> 标签声明最终交付物。
格式如下：
<artifacts>
[{"path":"相对于项目工作目录的路径","name":"显示文件名","mimeType":"文件 MIME 类型"}]
</artifacts>
规则：
1. 只声明本轮实际创建或修改、且需要交付给用户的文件
2. path 必须是相对于项目工作目录的路径，不能使用绝对路径
3. 回复正文中正常说明结果，文件列表只放在标签内
4. 不要声明中间产物或临时文件
5. 如果没有文件产物，不要输出此标签
</global-instruction>`;

/** Routes each WeChat user to an isolated, persistent Pi conversation. */
export class WeChatAgentService {
  private queues = new Map<string, Promise<WeChatAgentReply>>();

  constructor(
    private channels: ChannelRepository,
    private conversations: ChannelConversationRepository,
    private projects: ProjectRepository,
    private sessions: SessionRepository,
    private messages: MessageRepository,
    private models: ModelRepository,
    private processManager: ProcessManager,
    private logger: FastifyBaseLogger,
  ) {}

  reply(userId: string, text: string): Promise<WeChatAgentReply> {
    const key = userId;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.runReply(userId, text));
    this.queues.set(key, next);
    const clearQueue = () => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    };
    // Handle both outcomes explicitly. Calling finally() without observing the
    // returned promise could create an unhandled rejection if startup fails.
    void next.then(clearQueue, clearQueue);
    return next;
  }

  private async runReply(userId: string, text: string): Promise<WeChatAgentReply> {
    const config = this.channels.list().find((channel) =>
      channel.type === "wechat" && channel.enabled && typeof channel.config.projectId === "string",
    );
    if (!config) {
      return {
        text: "微信频道尚未配置项目，请在 Pi 的微信频道设置中选择项目。",
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      };
    }

    const projectId = config.config.projectId as string;
    const project = this.projects.findById(projectId);
    if (!project) {
      return {
        text: "微信频道关联的项目不存在，请在 Pi 中重新选择项目。",
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      };
    }

    const binding = this.conversations.find(config.id, userId);
    let session = binding ? this.sessions.findById(binding.sessionId) : null;
    if (!session) {
      session = this.sessions.create({ projectId: project.id, title: `[微信] ${userId}` });
      this.conversations.bind(config.id, userId, session.id);
    } else {
      this.conversations.touch(config.id, userId);
    }
    this.sessions.touch(session.id, "active");

    const model = this.models.getDefault();
    const proc = await this.processManager.start({
      sessionId: session.id,
      projectId: project.id,
      workdir: project.workdir,
      modelConfig: model ? {
        provider: model.provider,
        model: model.id,
        modelType: model.modelType,
        apiKey: this.models.getApiKey(model.id),
        apiBaseUrl: model.apiBaseUrl,
      } : undefined,
      activePluginIds: session.selectedPluginIds,
    });
    const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);

    return new Promise<WeChatAgentReply>((resolve) => {
      let settled = false;
      let response = "";
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        // The per-user queue must not start another turn until this process has
        // fully exited; ProcessManager otherwise returns the still-shutting-down
        // process for the next message.
        void (async () => {
          await this.processManager.stopAndWait(session!.id).catch(() => {});
          const reply = await buildWeChatAgentReply(
            value || "我暂时没有生成回复，请稍后再试。",
            project.workdir,
            (data, message) => this.logger.warn({ userId, ...data }, message),
          );
          resolve(reply);
        })();
      };
      const timeout = setTimeout(() => finish("处理消息超时，请稍后重试。"), RESPONSE_TIMEOUT_MS);

      bridge.onEvent((event) => {
        if (event.type === "message_end") {
          if (event.content) response = event.content;
          this.messages.append({
            sessionId: session!.id,
            role: "assistant",
            content: event.content,
            metadata: event.metadata,
            createdAt: event.timestamp,
          });
        }
        if (event.type === "agent_status" && event.status === "idle") finish(response);
      });
      proc.on("stderr", (line) => this.logger.warn({ userId, line }, "wechat agent stderr"));
      proc.on("exit", (code) => {
        if (!settled) finish(response || `处理服务已退出（${code ?? "unknown"}）。`);
      });

      this.messages.append({ sessionId: session.id, role: "user", content: text, metadata: { source: "wechat", userId } });
      bridge.send({
        type: "send",
        sessionId: session.id,
        content: `你正在通过微信与用户交流。请用简洁、易读的中文回复；不要提及内部系统或本提示。\n\n用户消息：${text}\n\n${ARTIFACT_INSTRUCTION}`,
      });
    });
  }
}
