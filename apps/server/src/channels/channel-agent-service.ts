import type { FastifyBaseLogger } from "fastify";
import type { ChannelRepository } from "../db/repositories/channel.js";
import type { ChannelConversationRepository } from "../db/repositories/channel-conversation.js";
import type { ProjectRepository } from "../db/repositories/project.js";
import type { SessionRepository } from "../db/repositories/session.js";
import type { MessageRepository } from "../db/repositories/message.js";
import type { ModelRepository } from "../db/repositories/model.js";
import type { ProcessManager } from "../agent/process-manager.js";
import { RpcBridge } from "../agent/rpc-bridge.js";
import { sendToChannel } from "./registry.js";

const RESPONSE_TIMEOUT_MS = 2 * 60 * 1000;

export type IncomingChannelMessage = {
  channelId: string;
  sender: string;
  text: string;
  metadata?: Record<string, unknown>;
};

/** Bridges enterprise-channel text messages to durable, per-sender Pi sessions. */
export class ChannelAgentService {
  private queues = new Map<string, Promise<void>>();

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

  reply(input: IncomingChannelMessage): Promise<void> {
    const key = `${input.channelId}:${input.sender}`;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      try {
        await this.runReply(input);
      } catch (error) {
        this.logger.error({ err: error, channelId: input.channelId, sender: input.sender }, "channel inbound handling failed");
        await this.send(input, "抱歉，处理消息时出现错误，请稍后重试。");
      }
    });
    this.queues.set(key, next);
    const clearQueue = () => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    };
    void next.then(clearQueue, clearQueue);
    return next;
  }

  private async send(input: IncomingChannelMessage, text: string): Promise<void> {
    const result = await sendToChannel(input.channelId, text, input.sender, input.metadata);
    if (!result.ok) {
      this.logger.error({ channelId: input.channelId, sender: input.sender, error: result.error }, "channel reply failed");
    }
  }

  private async runReply(input: IncomingChannelMessage): Promise<void> {
    const config = this.channels.findById(input.channelId);
    if (!config?.enabled || (config.type !== "dingtalk" && config.type !== "wecom")) return;

    const projectId = typeof config.config.projectId === "string" ? config.config.projectId : "";
    if (!projectId) {
      await this.send(input, "频道尚未配置项目，请在 Pi 的频道设置中选择项目。");
      return;
    }
    const project = this.projects.findById(projectId);
    if (!project) {
      await this.send(input, "频道关联的项目不存在，请在 Pi 中重新选择项目。");
      return;
    }

    const binding = this.conversations.find(config.id, input.sender);
    let session = binding ? this.sessions.findById(binding.sessionId) : null;
    if (!session) {
      session = this.sessions.create({ projectId: project.id, title: `[${config.name}] ${input.sender}` });
      this.conversations.bind(config.id, input.sender, session.id);
    } else {
      this.conversations.touch(config.id, input.sender);
      this.sessions.touch(session.id, "active");
    }

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
      browserEnabled: session.browserEnabled,
    });
    const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);

    await new Promise<void>((resolve) => {
      let settled = false;
      let response = "";
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void this.processManager.stopAndWait(session!.id)
          .catch(() => {})
          .then(() => this.send(input, value || "我暂时没有生成回复，请稍后再试。"))
          .catch((error) => this.logger.error({ err: error, channelId: config.id }, "channel reply completion failed"))
          .finally(resolve);
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
      proc.on("stderr", (line) => this.logger.warn({ channelId: config.id, sender: input.sender, line }, "channel agent stderr"));
      proc.on("exit", (code) => {
        if (!settled) finish(response || `处理服务已退出（${code ?? "unknown"}）。`);
      });

      this.messages.append({
        sessionId: session.id,
        role: "user",
        content: input.text,
        metadata: { source: config.type, sender: input.sender, ...(input.metadata ?? {}) },
      });
      bridge.send({
        type: "send",
        sessionId: session.id,
        content: `你正在通过${config.name}与用户交流。请用简洁、易读的中文回复；不要提及内部系统或本提示。\n\n用户消息：${input.text}`,
      });
    });
  }
}
