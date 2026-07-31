export interface ChatRunSource {
  id: string;
  role: "user" | "assistant";
  metadata: Record<string, unknown> | null;
  hasNonTextContent?: boolean;
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
}

interface ChatRunOptions {
  isBusy: boolean;
  activeElapsedMs: number | null;
  expandedRunIds: ReadonlySet<string>;
}

function storedDurationMs(message: ChatRunSource): number | null {
  const durationMs = message.metadata?.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    ? durationMs
    : null;
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
    const finalMessageHasProcessContent = messages[lastIndex]!.hasNonTextContent === true;
    const canToggleRun = !isActive && (indexes.length > 1 || finalMessageHasProcessContent);
    const collapsed = canToggleRun && !runExpanded;
    const durationMs = isActive
      ? (options.activeElapsedMs ?? 0)
      : storedDurationMs(messages[lastIndex]!);
    const statusOwner = isFirst;
    const statusOnly = collapsed && isFirst && !isLast;

    return {
      ...message,
      runId,
      hidden: collapsed && !isFirst && !isLast,
      showHeader: collapsed ? isLast : isFirst,
      showRunStatus: statusOwner && (isActive || durationMs !== null),
      displayDurationMs: statusOwner ? durationMs : null,
      runExpanded,
      canToggleRun,
      hiddenMessageCount: collapsed ? Math.max(1, indexes.length - 1) : 0,
      hideNonTextContent: collapsed && isLast,
      statusOnly,
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
