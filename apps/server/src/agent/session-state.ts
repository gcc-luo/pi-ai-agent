import { RpcBridge } from "./rpc-bridge.js";
import { AgentProcess } from "./types.js";
import type { ServerEvent } from "@pi-web-ui/shared";

export interface SessionState {
  sessionId: string;
  process: AgentProcess;
  bridge: RpcBridge;
  lastActivityAt: number;
  send: (event: ServerEvent) => void;
}

export class SessionStateStore {
  private states = new Map<string, SessionState>();

  set(sessionId: string, process: AgentProcess, bridge: RpcBridge): SessionState {
    const state: SessionState = {
      sessionId,
      process,
      bridge,
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
