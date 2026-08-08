import { describe, expect, it } from "vitest";
import type { MessagePart } from "@pi-web-ui/shared";
import {
  annotateChatRuns,
  buildAgentActivity,
  formatProcessingDuration,
} from "./chat-run-presentation.js";

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

const activityMessage = (id: string, parts: MessagePart[], durationMs?: number) => ({
  ...assistantWithProcess(id, durationMs),
  parts,
});

describe("buildAgentActivity", () => {
  it("aggregates many tool calls into one activity and does not count thinking", () => {
    const messages = [
      activityMessage("a1", [
        { kind: "thinking", text: "先看看项目结构" },
        ...Array.from({ length: 20 }, (_, index): MessagePart => ({
          kind: "tool_call",
          toolCallId: `call-${index}`,
          name: "bash",
          args: { command: `rg pattern-${index} apps/web` },
          status: "complete",
          result: "ok",
        })),
      ]),
    ];

    const activity = buildAgentActivity("run:u1", messages, true, 4_500);

    expect(activity).toMatchObject({
      runId: "run:u1",
      status: "running",
      durationMs: 4_500,
      operationCount: 20,
      completedCount: 20,
      failedCount: 0,
      currentLabel: "searchCode",
    });
    expect(activity.items).toHaveLength(21);
  });

  it("reports a failed tool without hiding its detail", () => {
    const messages = [activityMessage("a1", [{
      kind: "tool_call",
      toolCallId: "call-failed",
      name: "bash",
      args: { command: "pnpm test" },
      status: "complete",
      result: { isError: true, content: "tests failed" },
    }], 12_000)];

    const activity = buildAgentActivity("run:u1", messages, false, null);

    expect(activity).toMatchObject({
      status: "failed",
      operationCount: 1,
      completedCount: 1,
      failedCount: 1,
      currentLabel: "verifyResults",
    });
    expect(activity.items[0]).toMatchObject({ id: "call-failed", status: "failed" });
  });

  it("uses stable fallback labels for unknown tools", () => {
    const activity = buildAgentActivity("run:u1", [activityMessage("a1", [{
      kind: "tool_call",
      toolCallId: "call-unknown",
      name: "custom_tool",
      args: {},
      status: "running",
    }])], true, 1_000);

    expect(activity.currentLabel).toBe("executeOperation");
  });

  it("keeps an interrupted run distinct from a successful completion", () => {
    const activity = buildAgentActivity("run:u1", [activityMessage("a1", [], 3_000)], false, null, "interrupted");

    expect(activity.status).toBe("interrupted");
  });
});

describe("annotateChatRuns", () => {
  it("collapses an active run to one activity owner and the latest answer", () => {
    const result = annotateChatRuns(
      [
        user("u1"),
        activityMessage("a1", [{ kind: "thinking", text: "分析" }]),
        activityMessage("a2", [{
          kind: "tool_call", toolCallId: "call-1", name: "bash",
          args: { command: "rg any apps/web" }, status: "running",
        }]),
      ],
      { isBusy: true, activeElapsedMs: 4_500, expandedRunIds: new Set() },
    );

    expect(result[1]).toMatchObject({
      hidden: false,
      showActivity: true,
      showRunStatus: true,
      displayDurationMs: 4_500,
    });
    expect(result[2]).toMatchObject({
      hidden: true,
      showActivity: false,
      showRunStatus: false,
      hideNonTextContent: false,
    });
    expect(result[1]!.activity).toMatchObject({ operationCount: 1, currentLabel: "searchCode" });
  });

  it("renders only one visible activity block for a tool-only active run", () => {
    const toolTurns = Array.from({ length: 20 }, (_, index) => activityMessage(`a${index}`, [{
      kind: "tool_call",
      toolCallId: `call-${index}`,
      name: "bash",
      args: { command: `rg pattern-${index} apps/web` },
      status: index === 19 ? "running" : "complete",
      ...(index === 19 ? {} : { result: "ok" }),
    }]));

    const result = annotateChatRuns(
      [user("u1"), ...toolTurns],
      { isBusy: true, activeElapsedMs: 10_000, expandedRunIds: new Set() },
    );
    const visibleAssistant = result.slice(1).filter((message) => !message.hidden);

    expect(visibleAssistant).toHaveLength(1);
    expect(visibleAssistant[0]).toMatchObject({
      showActivity: true,
      statusOnly: true,
      activity: { operationCount: 20 },
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
      hideNonTextContent: false,
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

  it("distinguishes permission waiting and failed outcomes", () => {
    const waiting = annotateChatRuns(
      [user("u1"), activityMessage("a1", [], 2_000)],
      {
        isBusy: true,
        activeElapsedMs: 4_000,
        expandedRunIds: new Set(),
        waitingForPermission: true,
      },
    );
    expect(waiting[1]!.activity?.status).toBe("waiting_permission");

    const failed = annotateChatRuns(
      [user("u1"), activityMessage("a1", [{ kind: "thinking", text: "分析" }], 2_000)],
      {
        isBusy: false,
        activeElapsedMs: null,
        expandedRunIds: new Set(),
        outcome: "failed",
      },
    );
    expect(failed[1]!.activity?.status).toBe("failed");
  });
});

describe("formatProcessingDuration", () => {
  it("uses the compact Codex-style minute and second format", () => {
    expect(formatProcessingDuration(1_000)).toBe("1s");
    expect(formatProcessingDuration(74_000)).toBe("1m 14s");
    expect(formatProcessingDuration(3_661_000)).toBe("1h 1m 1s");
  });
});
