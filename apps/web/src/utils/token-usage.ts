import type { MessagePart } from "@pi-web-ui/shared";

export interface UsageMessage {
  id: string;
  role: "user" | "assistant";
  createdAt?: number;
  metadata: Record<string, unknown> | null;
  parts?: MessagePart[];
}

export interface UsageTotals {
  /** Pi-normalized uncached input; prompt includes cache reads and writes. */
  input: number;
  prompt: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  modelCalls: number;
  toolCalls: number;
}

export interface UsageCall extends UsageTotals {
  id: string;
  model: string;
}

export interface TokenUsageSummary {
  session: UsageTotals;
  current: UsageTotals;
  calls: UsageCall[];
  latest: UsageCall | null;
}

const emptyTotals = (): UsageTotals => ({
  input: 0, prompt: 0, output: 0, cacheRead: null, cacheWrite: null, modelCalls: 0, toolCalls: 0,
});
const counter = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Derive usage from messages, never increment transport-event counters. */
export function summarizeTokenUsage(messages: UsageMessage[]): TokenUsageSummary {
  const session = emptyTotals();
  let current = emptyTotals();
  let calls: UsageCall[] = [];
  let latest: UsageCall | null = null;
  const seenMessages = new Set<string>();
  const seenTools = new Set<string>();
  let currentTools = new Set<string>();

  for (const message of [...messages].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
    const identity = message.role === "assistant" && message.createdAt !== undefined
      ? `assistant:${message.createdAt}` : message.id;
    if (seenMessages.has(identity)) continue;
    seenMessages.add(identity);
    if (message.role === "user") {
      current = emptyTotals();
      calls = [];
      currentTools = new Set();
      continue;
    }

    const toolIds = new Set<string>();
    for (const part of message.parts ?? []) {
      if (part.kind === "tool_call") toolIds.add(part.toolCallId);
    }
    const toolCalls = message.metadata?.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tool of toolCalls) {
        if (typeof tool?.toolCallId === "string") toolIds.add(tool.toolCallId);
      }
    }
    for (const id of toolIds) {
      seenTools.add(id);
      currentTools.add(id);
    }
    session.toolCalls = seenTools.size;
    current.toolCalls = currentTools.size;

    const raw = message.metadata?.usage;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const usage = raw as Record<string, unknown>;
    const input = counter(usage.input) ?? 0;
    const output = counter(usage.output) ?? 0;
    const cacheRead = counter(usage.cacheRead);
    const cacheWrite = counter(usage.cacheWrite);
    const prompt = input + (cacheRead ?? 0) + (cacheWrite ?? 0);
    const call: UsageCall = {
      id: message.id,
      model: typeof message.metadata?.model === "string" ? message.metadata.model : "—",
      input, prompt, output, cacheRead, cacheWrite, modelCalls: 1, toolCalls: toolIds.size,
    };
    calls.push(call);
    latest = call;
    for (const total of [session, current]) {
      total.input += input;
      total.prompt += prompt;
      total.output += output;
      total.modelCalls++;
      if (cacheRead !== null) total.cacheRead = (total.cacheRead ?? 0) + cacheRead;
      if (cacheWrite !== null) total.cacheWrite = (total.cacheWrite ?? 0) + cacheWrite;
    }
  }
  return { session, current, calls, latest };
}
