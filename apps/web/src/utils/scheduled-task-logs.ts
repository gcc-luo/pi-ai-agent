import type { MessageDto, TaskLogDto } from "@pi-web-ui/shared";

/**
 * Select the persisted conversation segment created by one scheduled execution.
 * The next user message marks the beginning of a later execution or manual turn.
 */
export function messagesForExecution(log: TaskLogDto, messages: MessageDto[]): MessageDto[] {
  if (!log.messageId) return [];
  const start = messages.findIndex((item) => item.id === log.messageId);
  if (start < 0) return [];
  const nextUser = messages.findIndex((item, index) => index > start && item.role === "user");
  return messages
    .slice(start, nextUser < 0 ? messages.length : nextUser)
    .filter((item) => item.role === "user" || Boolean(item.content?.trim()));
}
