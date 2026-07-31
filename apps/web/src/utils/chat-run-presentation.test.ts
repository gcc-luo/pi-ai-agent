import { describe, expect, it } from "vitest";
import { annotateChatRuns, formatProcessingDuration } from "./chat-run-presentation.js";

const user = (id: string) => ({ id, role: "user" as const, metadata: null });
const assistant = (id: string, durationMs?: number) => ({
  id,
  role: "assistant" as const,
  metadata: durationMs == null ? null : { durationMs },
});
const assistantWithProcess = (id: string, durationMs?: number) => ({
  ...assistant(id, durationMs),
  hasNonTextContent: true,
});

describe("annotateChatRuns", () => {
  it("keeps every assistant message visible while the latest run is active", () => {
    const result = annotateChatRuns(
      [user("u1"), assistant("a1"), assistant("a2")],
      { isBusy: true, activeElapsedMs: 4_500, expandedRunIds: new Set() },
    );

    expect(result[1]).toMatchObject({
      hidden: false,
      showHeader: true,
      showRunStatus: true,
      displayDurationMs: 4_500,
    });
    expect(result[2]).toMatchObject({
      hidden: false,
      showHeader: false,
      showRunStatus: false,
    });
  });

  it("collapses a completed run to its final assistant message by default", () => {
    const result = annotateChatRuns(
      [user("u1"), assistant("a1"), assistant("a2"), assistant("a3", 74_000)],
      { isBusy: false, activeElapsedMs: null, expandedRunIds: new Set() },
    );

    expect(result.slice(1).map((message) => message.hidden)).toEqual([false, true, false]);
    expect(result[1]).toMatchObject({
      statusOnly: true,
      showRunStatus: true,
      displayDurationMs: 74_000,
    });
    expect(result[3]).toMatchObject({
      showHeader: true,
      showRunStatus: false,
      canToggleRun: true,
      hiddenMessageCount: 2,
    });
  });

  it("shows the full run and moves its status above the first message when expanded", () => {
    const result = annotateChatRuns(
      [user("u1"), assistant("a1"), assistant("a2", 12_000)],
      { isBusy: false, activeElapsedMs: null, expandedRunIds: new Set(["run:u1"]) },
    );

    expect(result[1]).toMatchObject({
      hidden: false,
      statusOnly: false,
      showHeader: true,
      showRunStatus: true,
      runExpanded: true,
    });
    expect(result[2]).toMatchObject({
      hidden: false,
      showHeader: false,
      showRunStatus: false,
      runExpanded: true,
    });
  });

  it("collapses thinking and other process content inside the final assistant message", () => {
    const result = annotateChatRuns(
      [user("u1"), assistantWithProcess("a1", 31_000)],
      { isBusy: false, activeElapsedMs: null, expandedRunIds: new Set() },
    );

    expect(result[1]).toMatchObject({
      hidden: false,
      hideNonTextContent: true,
      showRunStatus: true,
      canToggleRun: true,
    });
  });

  it("keeps separate user turns in separate collapsible runs", () => {
    const result = annotateChatRuns(
      [user("u1"), assistant("a1"), assistant("a2"), user("u2"), assistant("a3")],
      { isBusy: true, activeElapsedMs: 2_000, expandedRunIds: new Set() },
    );

    expect(result[1]!.runId).toBe("run:u1");
    expect(result[2]!.hidden).toBe(false);
    expect(result[4]).toMatchObject({
      runId: "run:u2",
      hidden: false,
      showRunStatus: true,
      displayDurationMs: 2_000,
    });
  });
});

describe("formatProcessingDuration", () => {
  it("uses the compact Codex-style minute and second format", () => {
    expect(formatProcessingDuration(1_000)).toBe("1s");
    expect(formatProcessingDuration(74_000)).toBe("1m 14s");
    expect(formatProcessingDuration(3_661_000)).toBe("1h 1m 1s");
  });
});
