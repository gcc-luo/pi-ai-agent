import type { MessagePart } from "@pi-web-ui/shared";

export interface ChatRunSource {
  id: string;
  role: "user" | "assistant";
  metadata: Record<string, unknown> | null;
  hasNonTextContent?: boolean;
  hasVisibleContent?: boolean;
  parts?: MessagePart[];
}

export type AgentActivityLabel =
  | "analyzeRequest"
  | "searchCode"
  | "readFiles"
  | "modifyFiles"
  | "verifyResults"
  | "useBrowser"
  | "useComputer"
  | "executeOperation";

export interface AgentActivityItem {
  id: string;
  kind: "thinking" | "tool" | "raw";
  label: AgentActivityLabel;
  status: "running" | "complete" | "failed";
  part: MessagePart;
}

export interface AgentActivity {
  runId: string;
  status: "running" | "waiting_permission" | "complete" | "failed" | "interrupted";
  durationMs: number | null;
  currentLabel: AgentActivityLabel;
  operationCount: number;
  completedCount: number;
  failedCount: number;
  items: AgentActivityItem[];
}

export interface ChatRunAnnotation {
  runId: string | null;
  hidden: boolean;
  showHeader: boolean;
  showRunStatus: boolean;
  displayDurationMs: number | null;
  runExpanded: boolean;
  canToggleRun: boolean;
  hiddenMessageCount: number;
  hideNonTextContent: boolean;
  statusOnly: boolean;
  showActivity: boolean;
  activity: AgentActivity | null;
}

interface ChatRunOptions {
  isBusy: boolean;
  activeElapsedMs: number | null;
  expandedRunIds: ReadonlySet<string>;
  outcome?: "interrupted" | "failed" | null;
  waitingForPermission?: boolean;
}

function storedDurationMs(message: ChatRunSource): number | null {
  const durationMs = message.metadata?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : null;
}

function resultFailed(result: unknown): boolean {
  return !!result
    && typeof result === "object"
    && (result as { isError?: unknown }).isError === true;
}

function commandFromArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const value = args as Record<string, unknown>;
  const command = value.command ?? value.cmd;
  return typeof command === "string" ? command.toLowerCase() : "";
}

export function activityLabelForTool(name: string, args: unknown): AgentActivityLabel {
  const lower = name.toLowerCase();
  const command = commandFromArgs(args);

  if (lower.startsWith("browser_")) return "useBrowser";
  if (lower.startsWith("computer_")) return "useComputer";
  if (/write|edit|patch|create_file|delete_file/.test(lower)) return "modifyFiles";
  if (/read|cat|open_file/.test(lower)) return "readFiles";
  if (/search|find|grep|glob|ripgrep/.test(lower)) return "searchCode";

  if (/bash|shell|command|exec/.test(lower)) {
    if (/(^|\s)(pnpm|npm|yarn|vitest|jest|pytest|cargo test|go test|tsc)(\s|$)|vite\s+build/.test(command)) {
      return "verifyResults";
    }
    if (/(apply_patch|sed\s+-i|set-content|add-content|new-item|remove-item|move-item)/.test(command)) {
      return "modifyFiles";
    }
    if (/(^|[;&|]\s*)(rg|grep|find|fd|select-string)(\s|$)/.test(command)) return "searchCode";
    if (/(^|[;&|]\s*)(cat|type|get-content)(\s|$)/.test(command)) return "readFiles";
  }

  return "executeOperation";
}

export function buildAgentActivity(
  runId: string,
  messages: ChatRunSource[],
  isActive: boolean,
  activeElapsedMs: number | null,
  outcome: "interrupted" | "failed" | null = null,
  waitingForPermission = false,
): AgentActivity {
  const items: AgentActivityItem[] = [];
  const toolIndexes = new Map<string, number>();

  messages.forEach((message) => {
    (message.parts ?? []).forEach((part, partIndex) => {
      if (part.kind === "thinking") {
        items.push({
          id: `thinking:${message.id}:${partIndex}`,
          kind: "thinking",
          label: "analyzeRequest",
          status: "complete",
          part,
        });
        return;
      }
      if (part.kind === "raw") {
        items.push({
          id: `raw:${message.id}:${partIndex}`,
          kind: "raw",
          label: "executeOperation",
          status: "complete",
          part,
        });
        return;
      }
      if (part.kind !== "tool_call") return;

      const failed = part.status === "complete" && resultFailed(part.result);
      const item: AgentActivityItem = {
        id: part.toolCallId,
        kind: "tool",
        label: activityLabelForTool(part.name, part.args),
        status: part.status === "running" ? "running" : failed ? "failed" : "complete",
        part,
      };
      const existingIndex = toolIndexes.get(part.toolCallId);
      if (existingIndex === undefined) {
        toolIndexes.set(part.toolCallId, items.length);
        items.push(item);
      } else {
        items[existingIndex] = item;
      }
    });
  });

  const tools = items.filter((item) => item.kind === "tool");
  const failedCount = tools.filter((item) => item.status === "failed").length;
  const completedCount = tools.filter((item) => item.status !== "running").length;
  const currentTool = [...tools].reverse().find((item) => item.status === "running")
    ?? tools.at(-1);
  const storedDuration = storedDurationMs(messages.at(-1) ?? {
    id: runId,
    role: "assistant",
    metadata: null,
  });

  return {
    runId,
    status: waitingForPermission
      ? "waiting_permission"
      : isActive
        ? "running"
        : outcome === "interrupted"
          ? "interrupted"
          : outcome === "failed" || failedCount > 0
            ? "failed"
            : "complete",
    durationMs: isActive ? (activeElapsedMs ?? 0) : storedDuration,
    currentLabel: currentTool?.label ?? "analyzeRequest",
    operationCount: tools.length,
    completedCount,
    failedCount,
    items,
  };
}

export function annotateChatRuns<T extends ChatRunSource>(
  messages: T[],
  options: ChatRunOptions,
): Array<T & ChatRunAnnotation> {
  const runIds = new Map<number, string>();
  const runIndexes = new Map<string, number[]>();
  let currentRunId: string | null = null;

  messages.forEach((message, index) => {
    if (message.role === "user") {
      currentRunId = `run:${message.id}`;
      return;
    }
    if (!currentRunId) currentRunId = `run:orphan:${message.id}`;
    runIds.set(index, currentRunId);
    runIndexes.set(currentRunId, [...(runIndexes.get(currentRunId) ?? []), index]);
  });

  const latestRunId = [...runIndexes.keys()].at(-1) ?? null;

  return messages.map((message, index) => {
    if (message.role !== "assistant") {
      return {
        ...message,
        runId: null,
        hidden: false,
        showHeader: true,
        showRunStatus: false,
        displayDurationMs: null,
        runExpanded: false,
        canToggleRun: false,
        hiddenMessageCount: 0,
        hideNonTextContent: false,
        statusOnly: false,
        showActivity: false,
        activity: null,
      };
    }

    const runId = runIds.get(index)!;
    const indexes = runIndexes.get(runId)!;
    const firstIndex = indexes[0]!;
    const lastIndex = indexes[indexes.length - 1]!;
    const isFirst = index === firstIndex;
    const isLast = index === lastIndex;
    const isActive = options.isBusy && runId === latestRunId;
    const runExpanded = options.expandedRunIds.has(runId);
    const runMessages = indexes.map((messageIndex) => messages[messageIndex]!);
    const activity = buildAgentActivity(
      runId,
      runMessages,
      isActive,
      options.activeElapsedMs,
      runId === latestRunId ? (options.outcome ?? null) : null,
      isActive && options.waitingForPermission === true,
    );
    const lastMessage = messages[lastIndex]!;
    const lastHasVisibleContent = lastMessage.hasVisibleContent
      ?? lastMessage.parts?.some((part) =>
        part.kind === "image" || (part.kind === "text" && part.text.trim().length > 0),
      )
      ?? true;
    const canToggleRun = indexes.length > 1
      || activity.items.length > 0
      || messages[lastIndex]!.hasNonTextContent === true;
    const collapsed = canToggleRun && !runExpanded;
    const durationMs = isActive
      ? (options.activeElapsedMs ?? 0)
      : storedDurationMs(messages[lastIndex]!);
    const statusOwner = isFirst;
    const statusOnly = collapsed && isFirst && (!isLast || !lastHasVisibleContent);

    return {
      ...message,
      runId,
      hidden: collapsed && !isFirst && (!isLast || !lastHasVisibleContent),
      showHeader: collapsed ? isLast && lastHasVisibleContent : isFirst,
      showRunStatus: statusOwner && (isActive || durationMs !== null),
      displayDurationMs: statusOwner ? durationMs : null,
      runExpanded,
      canToggleRun,
      hiddenMessageCount: collapsed ? Math.max(1, indexes.length - 1) : 0,
      hideNonTextContent: false,
      statusOnly,
      showActivity: isFirst && (isActive || activity.items.length > 0),
      activity: isFirst ? activity : null,
    };
  });
}

export function formatProcessingDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}
