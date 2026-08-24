import { describe, expect, it } from "vitest";
import type { MessagePart } from "@pi-web-ui/shared";
import {
  activityTargetForTool,
  annotateChatRuns,
  buildAgentActivity,
  formatProcessingDuration,
  mergeChatMessageSources,
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
  it("keeps intermediate assistant commentary in order and leaves the final answer outside", () => {
    const messages = [
      {
        ...activityMessage("a1", [
          { kind: "text", text: "我先检查项目启动方式。" },
          {
            kind: "tool_call",
            toolCallId: "call-1",
            name: "bash",
            args: { command: "Get-Content package.json" },
            status: "complete",
            result: "ok",
          },
        ]),
        createdAt: 1_000,
      },
      {
        ...assistant("a2", 7_000),
        createdAt: 8_000,
        parts: [{ kind: "text" as const, text: "桌面端服务已启动。" }],
      },
    ];

    const result = buildAgentActivity("run:u1", messages, false, null);

    expect(result.items.map((item) => item.kind)).toEqual(["message", "tool"]);
    expect(result.items[0]!.part).toEqual({ kind: "text", text: "我先检查项目启动方式。" });
    expect(result.items[1]).toMatchObject({ id: "call-1", durationMs: 7_000 });
    expect(result.items.some((item) => item.part.kind === "text" && item.part.text.includes("服务已启动"))).toBe(false);
  });

  it("leaves final text outside the activity when it follows thinking in the same message", () => {
    const messages = [
      activityMessage("a1", [
        { kind: "thinking", text: "整理最终结论" },
        { kind: "text", text: "这是最后一次明确回复。" },
      ], 8_000),
      {
        ...assistant("a2"),
        hasVisibleContent: false,
        parts: [],
      },
    ];

    const result = buildAgentActivity("run:u1", messages, false, null);

    expect(result.items.map((item) => item.kind)).toEqual(["thinking"]);
    expect(result.items.some((item) =>
      item.part.kind === "text" && item.part.text === "这是最后一次明确回复。",
    )).toBe(false);
  });

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

  it("keeps the overall run complete when a tool fails before a final response", () => {
    const messages = [
      activityMessage("a1", [{
        kind: "tool_call",
        toolCallId: "call-optional-failure",
        name: "Read",
        args: { file_path: "missing.md" },
        status: "complete",
        result: { isError: true, content: "file not found" },
      }]),
      {
        ...assistant("a2", 12_000),
        parts: [{ kind: "text" as const, text: "已根据可用信息完成分析。" }],
      },
    ];

    const activity = buildAgentActivity("run:u1", messages, false, null);

    expect(activity).toMatchObject({
      status: "complete",
      failedCount: 1,
    });
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

describe("activityTargetForTool", () => {
  it("extracts the useful argument for common tools", () => {
    expect(activityTargetForTool("Read", { file_path: "src/App.vue" })).toBe("src/App.vue");
    expect(activityTargetForTool("Bash", { command: "pnpm test" })).toBe("pnpm test");
    expect(activityTargetForTool("Grep", { pattern: "MessageStream" })).toBe("MessageStream");
  });

  it("keeps summaries on one short line", () => {
    const result = activityTargetForTool("Bash", { command: `echo ${"value ".repeat(40)}` });
    expect(result).not.toContain("\n");
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("annotateChatRuns", () => {
  it("keeps the PI Agent header above the run while working and after completion", () => {
    const processMessage = activityMessage("a1", [{ kind: "thinking", text: "分析" }]);
    const active = annotateChatRuns(
      [
        user("u1"),
        processMessage,
        activityMessage("a2", [{
          kind: "tool_call",
          toolCallId: "call-1",
          name: "bash",
          args: { command: "pnpm test" },
          status: "running",
        }]),
      ],
      { isBusy: true, activeElapsedMs: 21_000, expandedRunIds: new Set() },
    );
    const completed = annotateChatRuns(
      [
        user("u1"),
        processMessage,
        {
          ...assistant("a2", 63_000),
          hasVisibleContent: true,
          parts: [{ kind: "text" as const, text: "PPTX 已生成。" }],
        },
      ],
      { isBusy: false, activeElapsedMs: null, expandedRunIds: new Set() },
    );

    expect(active.slice(1).map((message) => message.showHeader)).toEqual([true, false]);
    expect(completed.slice(1).map((message) => message.showHeader)).toEqual([true, false]);
  });

  it("keeps the last explicit reply visible when an empty assistant message follows it", () => {
    const result = annotateChatRuns(
      [
        user("u1"),
        activityMessage("a1", [
          { kind: "thinking", text: "分析请求" },
          {
            kind: "tool_call",
            toolCallId: "call-1",
            name: "bash",
            args: { command: "pnpm test" },
            status: "complete",
            result: "ok",
          },
        ]),
        {
          ...assistant("a2"),
          hasVisibleContent: true,
          parts: [{ kind: "text" as const, text: "你好，你可以开始了。" }],
        },
        {
          ...assistant("a3", 8_000),
          hasVisibleContent: false,
          parts: [],
        },
      ],
      { isBusy: false, activeElapsedMs: null, expandedRunIds: new Set() },
    );

    expect(result[1]).toMatchObject({ hidden: false, showHeader: true, showActivity: true });
    expect(result[2]).toMatchObject({ hidden: false, hideActivityText: false });
    expect(result[3]).toMatchObject({ hidden: true, showHeader: false });
    expect(result[1]!.activity?.items.some((item) =>
      item.part.kind === "text" && item.part.text === "你好，你可以开始了。",
    )).toBe(false);
  });

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

  it("settles the work group as soon as the final answer starts streaming", () => {
    const result = annotateChatRuns(
      [
        user("u1"),
        activityMessage("a1", [{
          kind: "tool_call",
          toolCallId: "call-1",
          name: "Read",
          args: { file_path: "src/App.vue" },
          status: "complete",
          result: "ok",
        }]),
        {
          ...assistant("a2"),
          streaming: true,
          hasVisibleContent: true,
          parts: [{ kind: "text" as const, text: "这是最终回答的开头。" }],
        },
      ],
      { isBusy: true, activeElapsedMs: 9_000, expandedRunIds: new Set() },
    );

    expect(result[1]!.activity).toMatchObject({ status: "complete", durationMs: 9_000 });
    expect(result[2]).toMatchObject({ hidden: false, streaming: true, showMessageActions: true });
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
      showHeader: true,
      showRunStatus: true,
      displayDurationMs: 74_000,
    });
    expect(result[3]).toMatchObject({
      showHeader: false,
      showRunStatus: false,
      canToggleRun: true,
      hiddenMessageCount: 2,
    });
  });

  it("shows each delivered file only once at the end of its run", () => {
    const artifact = {
      path: "output/poem.txt",
      name: "诗歌.txt",
      mimeType: "text/plain",
    };
    const result = annotateChatRuns(
      [
        { ...user("u1"), artifacts: [] },
        {
          ...activityMessage("a1", [{ kind: "thinking", text: "生成文件" }]),
          artifacts: [artifact],
        },
        {
          ...assistant("a2", 32_000),
          hasVisibleContent: true,
          artifacts: [artifact],
        },
      ],
      { isBusy: false, activeElapsedMs: null, expandedRunIds: new Set() },
    );

    expect(result[1]!.artifacts).toEqual([]);
    expect(result[2]!.artifacts).toEqual([artifact]);
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

  it("keeps intermediate commentary inside the expanded activity timeline", () => {
    const result = annotateChatRuns(
      [
        user("u1"),
        activityMessage("a1", [
          { kind: "text", text: "我先检查项目。" },
          { kind: "thinking", text: "分析" },
        ]),
        activityMessage("a2", [
          { kind: "text", text: "接下来运行测试。" },
          {
            kind: "tool_call",
            toolCallId: "call-1",
            name: "bash",
            args: { command: "pnpm test" },
            status: "complete",
            result: "ok",
          },
        ]),
        {
          ...assistant("a3", 12_000),
          hasVisibleContent: true,
          parts: [{ kind: "text" as const, text: "测试已通过。" }],
        },
      ],
      { isBusy: false, activeElapsedMs: null, expandedRunIds: new Set(["run:u1"]) },
    );

    expect(result[1]).toMatchObject({ statusOnly: true, hideActivityText: true });
    expect(result[2]).toMatchObject({ hidden: true, hideActivityText: true });
    expect(result[3]).toMatchObject({ hidden: false, hideActivityText: false });
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

describe("mergeChatMessageSources", () => {
  it("prefers a persisted assistant message over its live stream copy", () => {
    const persisted = [{ id: "db-a1", role: "assistant" as const, createdAt: 1_000 }];
    const live = [
      { id: "assistant-1000", role: "assistant" as const, createdAt: 1_000 },
      { id: "assistant-2000", role: "assistant" as const, createdAt: 2_000 },
    ];

    expect(mergeChatMessageSources(persisted, live).map((message) => message.id)).toEqual([
      "db-a1",
      "assistant-2000",
    ]);
  });

  it("removes a persisted user message's optimistic live copy", () => {
    const persisted = [{
      id: "db-u1",
      role: "user" as const,
      createdAt: 1_100,
      parts: [{ kind: "text" as const, text: "你好" }],
    }];
    const live = [{
      id: "local-u1",
      role: "user" as const,
      createdAt: 1_000,
      parts: [{ kind: "text" as const, text: "你好" }],
    }];

    expect(mergeChatMessageSources(persisted, live).map((message) => message.id)).toEqual(["db-u1"]);
  });

  it("matches repeated user text one-to-one without deleting a new prompt", () => {
    const userMessage = (id: string, createdAt: number) => ({
      id,
      role: "user" as const,
      createdAt,
      parts: [{ kind: "text" as const, text: "你好" }],
    });
    const persisted = [userMessage("db-u1", 1_100)];
    const live = [
      userMessage("local-u1", 1_000),
      userMessage("local-u2", 2_000),
    ];

    expect(mergeChatMessageSources(persisted, live).map((message) => message.id)).toEqual([
      "db-u1",
      "local-u2",
    ]);
  });
});
