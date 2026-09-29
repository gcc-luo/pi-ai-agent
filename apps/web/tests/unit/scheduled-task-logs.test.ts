import { describe, expect, it } from "vitest";
import type { MessageDto, TaskLogDto } from "@pi-web-ui/shared";
import { messagesForExecution } from "../../src/utils/scheduled-task-logs.js";

const baseLog: TaskLogDto = {
  id: "log-1",
  taskId: "task-1",
  status: "success",
  output: "完成",
  sessionId: "session-1",
  messageId: "scheduled-user-2",
  startedAt: 2_000,
  finishedAt: 3_000,
};

function message(id: string, role: MessageDto["role"], content: string): MessageDto {
  return { id, sessionId: "session-1", role, content, metadata: null, createdAt: 1, seq: 1 };
}

describe("scheduled task log conversation selection", () => {
  it("returns the execution prompt and replies until the next user message", () => {
    const messages = [
      message("scheduled-user-1", "user", "第一次执行"),
      message("assistant-1", "assistant", "第一次回复"),
      message("scheduled-user-2", "user", "第二次执行"),
      message("assistant-2", "assistant", "第二次回复"),
      message("manual-user", "user", "手动提问"),
    ];

    expect(messagesForExecution(baseLog, messages).map((item) => item.id)).toEqual([
      "scheduled-user-2",
      "assistant-2",
    ]);
  });

  it("returns no conversation when the log has no message target", () => {
    expect(messagesForExecution({ ...baseLog, messageId: null }, [])).toEqual([]);
  });

  it("omits internal messages that have no visible content", () => {
    const messages = [
      message("scheduled-user-2", "user", "第二次执行"),
      message("assistant-2", "assistant", "第二次回复"),
      { ...message("assistant-empty", "assistant", ""), content: null },
    ];

    expect(messagesForExecution(baseLog, messages).map((item) => item.id)).toEqual([
      "scheduled-user-2",
      "assistant-2",
    ]);
  });
});
