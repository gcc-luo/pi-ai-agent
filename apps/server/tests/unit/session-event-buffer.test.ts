import { describe, expect, it } from "vitest";
import { SessionEventBuffer } from "../../src/agent/session-event-buffer.js";

describe("SessionEventBuffer", () => {
  it("replays only events after the requested sequence", () => {
    const buffer = new SessionEventBuffer(10);
    const first = buffer.append("session-1", { type: "session_status", sessionId: "session-1", status: "active" });
    const second = buffer.append("session-1", { type: "agent_status", sessionId: "session-1", status: "working" });
    const replayed: unknown[] = [];

    buffer.replay("session-1", first.eventSeq, (event) => replayed.push(event));

    expect(first.eventSeq).toBe(1);
    expect(second.eventSeq).toBe(2);
    expect(replayed).toEqual([second]);
  });

  it("keeps a bounded history and can clear a session", () => {
    const buffer = new SessionEventBuffer(2);
    buffer.append("session-1", { type: "session_status", sessionId: "session-1", status: "active" });
    buffer.append("session-1", { type: "agent_status", sessionId: "session-1", status: "working" });
    buffer.append("session-1", { type: "agent_status", sessionId: "session-1", status: "idle" });

    const replayed: number[] = [];
    buffer.replay("session-1", 0, (event) => replayed.push(event.eventSeq ?? 0));
    expect(replayed).toEqual([2, 3]);

    buffer.clear("session-1");
    const afterClear: unknown[] = [];
    buffer.replay("session-1", 0, (event) => afterClear.push(event));
    expect(afterClear).toEqual([]);
  });

  it("replays only the current run after an idle session is reopened", () => {
    const buffer = new SessionEventBuffer(10);
    buffer.append("session-1", { type: "agent_status", sessionId: "session-1", status: "working" });
    buffer.append("session-1", { type: "message_delta", sessionId: "session-1", messageId: "old", delta: "old" });
    buffer.append("session-1", { type: "agent_status", sessionId: "session-1", status: "idle" });
    const currentStart = buffer.append("session-1", { type: "agent_status", sessionId: "session-1", status: "working" });
    const currentDelta = buffer.append("session-1", { type: "message_delta", sessionId: "session-1", messageId: "new", delta: "new" });
    const replayed: unknown[] = [];

    buffer.replayCurrentRun("session-1", 0, (event) => replayed.push(event));

    expect(replayed).toEqual([currentStart, currentDelta]);
  });
});
