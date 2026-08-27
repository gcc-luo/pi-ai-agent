import type { ArtifactItem, MessagePart } from "@pi-web-ui/shared";
import { summarizeTokenUsage, type UsageTotals } from "./token-usage.js";

export interface ChatRunSource {
  id: string;
  role: "user" | "assistant";
  metadata: Record<string, unknown> | null;
  createdAt?: number;
  hasNonTextContent?: boolean;
  hasVisibleContent?: boolean;
  artifacts?: ArtifactItem[];
  parts?: MessagePart[];
  streaming?: boolean;
}

interface ChatMessageSource {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  parts?: MessagePart[];
}

function userMessageSignature(message: ChatMessageSource): string | null {
  const visibleParts = (message.parts ?? []).flatMap((part) => {
    if (part.kind === "text") return [`text:${part.text}`];
    if (part.kind === "image") {
      return [`image:${part.name}:${part.mediaType}:${part.data}`];
    }
    return [];
  });
  return visibleParts.length ? JSON.stringify(visibleParts) : null;
}

/**
 * A completed assistant turn can exist in both collections after history is
 * reloaded: the database row has its own id, while the live copy keeps Pi's
 * stream id. Pi's message timestamp is preserved when the row is persisted,
 * so use that timestamp as the stable identity and prefer the authoritative
 * persisted copy.
 */
export function mergeChatMessageSources<T extends ChatMessageSource>(
  persisted: T[],
  live: T[],
): T[] {
  const persistedAssistantTimestamps = new Set(
    persisted
      .filter((message) => message.role === "assistant")
      .map((message) => message.createdAt),
  );
  const userPairs: Array<{ persistedIndex: number; liveIndex: number; distance: number }> = [];
  persisted.forEach((candidate, persistedIndex) => {
    if (candidate.role !== "user") return;
    const signature = userMessageSignature(candidate);
    if (!signature) return;
    live.forEach((message, liveIndex) => {
      if (message.role !== "user" || userMessageSignature(message) !== signature) return;
      const distance = Math.abs(candidate.createdAt - message.createdAt);
      if (distance <= 10_000) userPairs.push({ persistedIndex, liveIndex, distance });
    });
  });
  userPairs.sort((left, right) => left.distance - right.distance);
  const matchedPersistedUsers = new Set<number>();
  const matchedLiveUsers = new Set<number>();
  for (const pair of userPairs) {
    if (
      matchedPersistedUsers.has(pair.persistedIndex)
      || matchedLiveUsers.has(pair.liveIndex)
    ) continue;
    matchedPersistedUsers.add(pair.persistedIndex);
    matchedLiveUsers.add(pair.liveIndex);
  }

  const uniqueLive = live.filter((message, liveIndex) => {
    if (message.role === "assistant") {
      return !persistedAssistantTimestamps.has(message.createdAt);
    }
    return !matchedLiveUsers.has(liveIndex);
  });

  return [...persisted, ...uniqueLive];
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
  kind: "message" | "thinking" | "tool" | "raw";
  label: AgentActivityLabel;
  status: "running" | "complete" | "failed";
  part: MessagePart;
  durationMs?: number | null;
}

export interface AgentActivity {
  runId: string;
  usage: UsageTotals;
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
  hideActivityText: boolean;
  statusOnly: boolean;
  showActivity: boolean;
  showMessageActions: boolean;
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

function containsProcessParts(message: ChatRunSource): boolean {
  return message.parts?.some((part) =>
    part.kind === "thinking" || part.kind === "tool_call" || part.kind === "raw",
  ) ?? false;
}

function hasStandaloneContent(message: ChatRunSource): boolean {
  if ((message.artifacts?.length ?? 0) > 0) return true;

  const parts = message.parts;
  if (parts) {
    if (parts.some((part) => part.kind === "image")) return true;
    const lastProcessIndex = parts.map((part) =>
      part.kind === "thinking" || part.kind === "tool_call" || part.kind === "raw",
    ).lastIndexOf(true);
    const lastTextIndex = parts.map((part) =>
      part.kind === "text" && part.text.trim().length > 0,
    ).lastIndexOf(true);
    if (lastTextIndex > lastProcessIndex) return true;
    return message.hasVisibleContent === true && parts.length === 0;
  }

  return message.hasVisibleContent ?? message.hasNonTextContent !== true;
}

function finalResponseIndex(messages: ChatRunSource[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (hasStandaloneContent(messages[index]!)) return index;
  }
  return null;
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

function stringArg(args: unknown, keys: string[]): string {
  if (!args || typeof args !== "object") return "";
  const value = args as Record<string, unknown>;
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}

/** Extract the useful, human-readable subject of a tool call for its one-line summary. */
export function activityTargetForTool(name: string, args: unknown): string {
  const lower = name.toLowerCase();
  let target = "";

  if (/bash|shell|command|exec/.test(lower)) {
    target = stringArg(args, ["command", "cmd"]);
  } else if (/read|write|edit|patch|file/.test(lower)) {
    target = stringArg(args, ["file_path", "path", "filename", "name"]);
  } else if (/search|find|grep|glob|ripgrep/.test(lower)) {
    target = stringArg(args, ["pattern", "query", "path", "glob"]);
  } else if (lower.startsWith("browser_")) {
    target = stringArg(args, ["url", "query", "text"]);
  } else if (lower.startsWith("computer_")) {
    target = stringArg(args, ["app", "action", "text"]);
  }

  if (!target) {
    target = stringArg(args, [
      "file_path", "path", "command", "cmd", "pattern", "query", "url", "name", "task",
    ]);
  }

  const singleLine = target.replace(/\s+/g, " ");
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}…` : singleLine;
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
  answerStreaming = false,
): AgentActivity {
  const items: AgentActivityItem[] = [];
  const toolIndexes = new Map<string, number>();
  const responseIndex = finalResponseIndex(messages);

  messages.forEach((message, messageIndex) => {
    const nextCreatedAt = messages
      .slice(messageIndex + 1)
      .find((candidate) => typeof candidate.createdAt === "number")
      ?.createdAt;
    const messageDurationMs = typeof message.createdAt === "number" && typeof nextCreatedAt === "number"
      ? Math.max(0, nextCreatedAt - message.createdAt)
      : null;
    const includeText = messageIndex !== responseIndex;

    (message.parts ?? []).forEach((part, partIndex) => {
      if (part.kind === "text") {
        if (includeText && part.text.trim()) {
          items.push({
            id: `message:${message.id}:${partIndex}`,
            kind: "message",
            label: "analyzeRequest",
            status: "complete",
            part,
          });
        }
        return;
      }
      if (part.kind === "thinking") {
        items.push({
          id: `thinking:${message.id}:${partIndex}`,
          kind: "thinking",
          label: "analyzeRequest",
          status: "complete",
          part,
          durationMs: messageDurationMs,
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
        durationMs: messageDurationMs,
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
  const lastItem = items.at(-1);
  if (isActive && !answerStreaming && lastItem?.kind === "thinking") {
    lastItem.status = "running";
  }
  const failedCount = tools.filter((item) => item.status === "failed").length;
  const completedCount = tools.filter((item) => item.status !== "running").length;
  const hasFinalResponse = responseIndex !== null;
  const currentTool = [...tools].reverse().find((item) => item.status === "running")
    ?? tools.at(-1);
  const storedDuration = storedDurationMs(messages.at(-1) ?? {
    id: runId,
    role: "assistant",
    metadata: null,
  });

  return {
    runId,
    usage: summarizeTokenUsage(messages).session,
    status: waitingForPermission
      ? "waiting_permission"
      : answerStreaming
        ? "complete"
      : isActive
        ? "running"
        : outcome === "interrupted"
          ? "interrupted"
          : outcome === "failed" || (failedCount > 0 && !hasFinalResponse)
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

  const artifactsByRun = new Map<string, ArtifactItem[]>();
  for (const [runId, indexes] of runIndexes) {
    const artifacts: ArtifactItem[] = [];
    for (const index of indexes) {
      for (const artifact of messages[index]!.artifacts ?? []) {
        if (!artifacts.some((item) => item.path === artifact.path)) artifacts.push(artifact);
      }
    }
    artifactsByRun.set(runId, artifacts);
  }

  const latestRunId = [...runIndexes.keys()].at(-1) ?? null;
  const activitiesByRun = new Map<string, AgentActivity>();

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
        hideActivityText: false,
        statusOnly: false,
        showActivity: false,
        showMessageActions: true,
        activity: null,
      };
    }

    const runId = runIds.get(index)!;
    const indexes = runIndexes.get(runId)!;
    const firstIndex = indexes[0]!;
    const lastIndex = indexes[indexes.length - 1]!;
    const runMessages = indexes.map((messageIndex) => messages[messageIndex]!);
    const relativeResponseIndex = finalResponseIndex(runMessages);
    const responseIndex = relativeResponseIndex === null
      ? null
      : indexes[relativeResponseIndex]!;
    const responseMessage = relativeResponseIndex === null
      ? null
      : runMessages[relativeResponseIndex]!;
    const isFirst = index === firstIndex;
    const isResponse = index === responseIndex;
    const isActive = options.isBusy && runId === latestRunId;
    const answerStreaming = isActive
      && responseMessage?.streaming === true
      && hasStandaloneContent(responseMessage);
    const runExpanded = options.expandedRunIds.has(runId);
    const runArtifacts = artifactsByRun.get(runId) ?? [];
    const activity = activitiesByRun.get(runId) ?? buildAgentActivity(
      runId,
      runMessages,
      isActive,
      options.activeElapsedMs,
      runId === latestRunId ? (options.outcome ?? null) : null,
      isActive && options.waitingForPermission === true,
      answerStreaming,
    );
    activitiesByRun.set(runId, activity);
    const responseHasVisibleContent = responseIndex !== null
      && (hasStandaloneContent(messages[responseIndex]!) || runArtifacts.length > 0);
    const hasActivityTimeline = activity.items.length > 0;
    const hideActivityText = activity.items.some((item) =>
      item.kind === "message" && item.id.startsWith(`message:${message.id}:`),
    );
    const canToggleRun = indexes.length > 1
      || activity.items.length > 0
      || messages[lastIndex]!.hasNonTextContent === true;
    const collapsed = canToggleRun && !runExpanded;
    const durationMs = isActive
      ? (options.activeElapsedMs ?? 0)
      : storedDurationMs(messages[lastIndex]!);
    const statusOwner = isFirst;
    const statusOnly = (hasActivityTimeline && isFirst && !isResponse)
      || (collapsed && isFirst && (!isResponse || !responseHasVisibleContent));
    const hiddenByTimeline = hasActivityTimeline && !isFirst && !isResponse;

    return {
      ...message,
      artifacts: index === (responseIndex ?? lastIndex) ? runArtifacts : [],
      runId,
      hidden: hiddenByTimeline
        || (collapsed && !isFirst && (!isResponse || !responseHasVisibleContent)),
      showHeader: isFirst,
      showRunStatus: statusOwner && (isActive || durationMs !== null),
      displayDurationMs: statusOwner ? durationMs : null,
      runExpanded,
      canToggleRun,
      hiddenMessageCount: collapsed ? Math.max(1, indexes.length - 1) : 0,
      hideNonTextContent: false,
      hideActivityText,
      statusOnly,
      showActivity: isFirst && (isActive || activity.items.length > 0 || activity.usage.modelCalls > 0),
      showMessageActions: isResponse,
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
