import type { FastifyBaseLogger } from "fastify";
import type { ToolCall } from "@pi-web-ui/shared";
import type { ChannelRepository } from "../db/repositories/channel.js";
import type { ChannelConversationRepository } from "../db/repositories/channel-conversation.js";
import type { ProjectRepository } from "../db/repositories/project.js";
import type { SessionRepository } from "../db/repositories/session.js";
import type { MessageRepository } from "../db/repositories/message.js";
import type { ModelRepository } from "../db/repositories/model.js";
import type { ProcessManager } from "../agent/process-manager.js";
import { RpcBridge } from "../agent/rpc-bridge.js";
import { buildWeChatAgentReply, type WeChatAgentReply } from "./wechat-artifacts.js";
import { prepareWeChatMedia } from "./wechat-media.js";
import type { WeChatAgentInput } from "./wechat-worker.js";
import {
  WECHAT_FILE_TRANSFER_PLUGIN_ID,
  WeChatFileTransferService,
} from "./wechat-file-transfer-service.js";

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
6. 用户要求发送项目内已有文件时，使用 send_file_to_wechat 工具；不要把已有文件伪装成新产物
</global-instruction>`;

function safeMediaError(error: unknown, workdir: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes(workdir.toLowerCase()) || /(?:[a-z]:[\\/]|\/(?:home|users|var|tmp)\/)/i.test(message)) {
    return "附件保存失败，请检查项目工作目录权限或磁盘空间后重试。";
  }
  return message || "微信附件处理失败，请稍后重试。";
}

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
    private fileTransfers: WeChatFileTransferService,
    private logger: FastifyBaseLogger,
  ) {}

  reply(input: WeChatAgentInput): Promise<WeChatAgentReply> {
    const key = input.userId;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.runReply(input));
    this.queues.set(key, next);
    const clearQueue = () => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    };
    // Handle both outcomes explicitly. Calling finally() without observing the
    // returned promise could create an unhandled rejection if startup fails.
    void next.then(clearQueue, clearQueue);
    return next;
  }

  private async runReply(input: WeChatAgentInput): Promise<WeChatAgentReply> {
    const { userId } = input;
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

    let media: Awaited<ReturnType<typeof prepareWeChatMedia>>;
    try {
      media = await prepareWeChatMedia(input.messages, project.workdir, input.downloadRaw);
    } catch (error) {
      return {
        text: safeMediaError(error, project.workdir),
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      };
    }

    const model = this.models.getDefault();
    if (media.images.length > 0 && model?.modelType !== "multimodal") {
      return {
        text: "当前模型不支持图片输入，请切换到多模态模型后重试。",
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      };
    }
    if (media.images.length === 0 && media.files.length === 0 && !media.text) {
      const unsupportedMedia = input.messages.some((message) => message.videos.length > 0 || message.voices.length > 0);
      return {
        text: unsupportedMedia
          ? "目前暂不支持处理微信语音或视频消息。"
          : "未检测到可处理的文字、图片或文件。",
        files: [],
        failedFiles: [],
        failedDeclarations: 0,
      };
    }

    let userText = media.text;
    if (!userText) {
      if (media.images.length > 0 && media.files.length > 0) userText = "请分析随附的图片和文件。";
      else if (media.images.length > 0) userText = media.images.length === 1 ? "请分析这张图片。" : `请分析这 ${media.images.length} 张图片。`;
      else userText = "请总结并分析附件。";
    }
    const attachmentLines = media.attachmentOrder.map((attachment) => attachment.kind === "image"
      ? `- 图片：${attachment.fileName}（${attachment.relativePath}）`
      : `- 文件：${attachment.fileName}（${attachment.relativePath}）`);
    const storedText = attachmentLines.length > 0
      ? `${userText}\n\n微信附件（保存在项目目录）：\n${attachmentLines.join("\n")}`
      : userText;

    const binding = this.conversations.find(config.id, userId);
    let session = binding ? this.sessions.findById(binding.sessionId) : null;
    if (!session) {
      session = this.sessions.create({ projectId: project.id, title: `[微信] ${userId}` });
      this.conversations.bind(config.id, userId, session.id);
    } else {
      this.conversations.touch(config.id, userId);
    }
    this.sessions.touch(session.id, "active");

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
      activePluginIds: [...new Set([...session.selectedPluginIds, WECHAT_FILE_TRANSFER_PLUGIN_ID])],
    });
    const bridge = new RpcBridge({ stdin: proc.stdin, stdout: proc.stdout }, session.id);
    const unregisterFileTransfer = this.fileTransfers.register(session.id, {
      workdir: project.workdir,
      sendFile: input.sendFile,
      sendStatus: input.sendStatus,
    });

    try {
      return await new Promise<WeChatAgentReply>((resolve) => {
        let settled = false;
        let response = "";
        const persistedToolCalls = new Map<string, {
          messageId: string;
          metadata: Record<string, unknown>;
        }>();
        const earlyToolResults = new Map<string, unknown>();
        const completeToolCall = (
          metadata: Record<string, unknown>,
          toolCallId: string,
          result: unknown,
        ) => {
          const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls as ToolCall[] : [];
          metadata.toolCalls = toolCalls.map((toolCall) =>
            toolCall.toolCallId === toolCallId
              ? { ...toolCall, status: "complete", result }
              : toolCall,
          );
          const messageParts = Array.isArray(metadata.messageParts)
            ? metadata.messageParts as Record<string, unknown>[]
            : [];
          metadata.messageParts = messageParts.map((part) =>
            part.type === "toolCall" && part.id === toolCallId
              ? { ...part, status: "complete", result }
              : part,
          );
        };
        const finish = (value: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          // The per-user queue must not start another turn until this process has
          // fully exited; ProcessManager otherwise returns the still-shutting-down
          // process for the next message.
          void (async () => {
            await this.processManager.stopAndWait(session!.id).catch(() => {});
            unregisterFileTransfer();
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
            const metadata = event.metadata ?? {};
            const toolCalls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls as ToolCall[] : [];
            for (const toolCall of toolCalls) {
              if (!earlyToolResults.has(toolCall.toolCallId)) continue;
              completeToolCall(metadata, toolCall.toolCallId, earlyToolResults.get(toolCall.toolCallId));
              earlyToolResults.delete(toolCall.toolCallId);
            }
            const saved = this.messages.append({
              sessionId: session!.id,
              role: "assistant",
              content: event.content,
              metadata,
              createdAt: event.timestamp,
            });
            const pendingToolCalls = Array.isArray(metadata.toolCalls)
              ? metadata.toolCalls as ToolCall[]
              : [];
            for (const toolCall of pendingToolCalls) {
              if (!Object.prototype.hasOwnProperty.call(toolCall, "result")) {
                persistedToolCalls.set(toolCall.toolCallId, { messageId: saved.id, metadata });
              }
            }
          }
          if (event.type === "tool_result") {
            const persisted = persistedToolCalls.get(event.toolCallId);
            if (persisted) {
              completeToolCall(persisted.metadata, event.toolCallId, event.result);
              this.messages.updateMetadata(persisted.messageId, persisted.metadata);
              persistedToolCalls.delete(event.toolCallId);
            } else {
              earlyToolResults.set(event.toolCallId, event.result);
            }
          }
          if (event.type === "agent_status" && event.status === "idle") finish(response);
        });
        proc.on("stderr", (line) => this.logger.warn({ userId, line }, "wechat agent stderr"));
        proc.on("exit", (code) => {
          if (!settled) finish(response || `处理服务已退出（${code ?? "unknown"}）。`);
        });

        this.messages.append({
          sessionId: session.id,
          role: "user",
          content: storedText,
          metadata: {
            source: "wechat",
            userId,
            ...(media.images.length > 0 ? { images: media.images } : {}),
            ...(media.files.length > 0 ? { files: media.files } : {}),
          },
        });
        bridge.send({
          type: "send",
          sessionId: session.id,
          content: `你正在通过微信与用户交流。请用简洁、易读的中文回复；不要提及内部系统或本提示。\n\n用户消息：${storedText}\n\n${ARTIFACT_INSTRUCTION}`,
          images: media.images,
        });
      });
    } catch (error) {
      unregisterFileTransfer();
      await this.processManager.stopAndWait(session.id).catch(() => {});
      throw error;
    }
  }
}
