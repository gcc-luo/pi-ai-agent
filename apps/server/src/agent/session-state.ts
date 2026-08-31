import { RpcBridge } from "./rpc-bridge.js";
import { AgentProcess } from "./types.js";
import type { ServerEvent } from "@pi-web-ui/shared";

export interface SessionState {
  sessionId: string;
  process: AgentProcess;
  bridge: RpcBridge;
  provider: string | null;
  model: string | null;
  runStatus: "working" | "idle";
  runStartedAt: number | null;
  lastActivityAt: number;
  send: (event: ServerEvent) => void;
}

export class SessionStateStore {
  private states = new Map<string, SessionState>();

  set(
    sessionId: string,
    process: AgentProcess,
    bridge: RpcBridge,
    model?: { provider: string; model: string },
  ): SessionState {
    const state: SessionState = {
      sessionId,
      process,
      bridge,
      provider: model?.provider ?? null,
      model: model?.model ?? null,
      runStatus: "idle",
      runStartedAt: null,
      lastActivityAt: Date.now(),
      send: () => {},
    };
    this.states.set(sessionId, state);
    return state;
  }

  get(sessionId: string): SessionState | undefined {
    return this.states.get(sessionId);
  }

  delete(sessionId: string): void {
    this.states.delete(sessionId);
  }

  values(): IterableIterator<SessionState> {
    return this.states.values();
  }

  touch(sessionId: string): void {
    const s = this.states.get(sessionId);
    if (s) s.lastActivityAt = Date.now();
  }
}
