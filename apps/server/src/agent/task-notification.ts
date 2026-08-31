import type { ServerEvent } from "@pi-web-ui/shared";
import type { NotificationRepository } from "../db/repositories/notification.js";
import type { SessionRepository } from "../db/repositories/session.js";

type TaskSettledEvent = Extract<ServerEvent, { type: "agent_task_settled" }>;

export function summarizeNotification(content: string, maxLength = 200): string {
  const normalized = content
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function recordAgentTaskSettlement(input: {
  notifications: NotificationRepository;
  sessions: SessionRepository;
  taskId: string;
  projectId: string;
  sessionId: string;
  assistant?: { id: string; content: string } | null;
  error?: string | null;
  completedAt?: number;
}): TaskSettledEvent | null {
  const session = input.sessions.findById(input.sessionId);
  if (!session) return null;

  const failed = Boolean(input.error);
  const completedAt = input.completedAt ?? Date.now();
  const summary = summarizeNotification(
    failed
      ? input.error!
      : input.assistant?.content || "任务已完成",
  );
  const result = input.notifications.recordSettlement({
    taskId: input.taskId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: failed ? undefined : input.assistant?.id,
    type: failed ? "task_failed" : "task_completed",
    title: session.title ?? "新会话",
    body: summary,
    createdAt: completedAt,
  });
  if (!result.created) return null;

  return {
    type: "agent_task_settled",
    notificationId: result.notification.id,
    taskId: input.taskId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    ...(!failed && input.assistant?.id ? { messageId: input.assistant.id } : {}),
    title: result.notification.title,
    summary,
    status: failed ? "failed" : "completed",
    completedAt,
    unreadCount: result.unreadCount,
  };
}
