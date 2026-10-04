import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { SessionDto } from "@pi-web-ui/shared";
import { useAgentStore } from "./agent.js";
import { useSessionStore } from "./session.js";

function makeSession(authorizationMode: SessionDto["authorizationMode"]): SessionDto {
  return {
    id: "session-1",
    projectId: "project-1",
    title: "Task",
    parentId: null,
    expertId: null,
    authorizationMode,
    selectedPluginIds: [],
    browserEnabled: false,
    status: "idle",
    createdAt: 1,
    updatedAt: 2,
    lastActiveAt: null,
    unreadCount: 0,
    lastReadMessageId: null,
    deletedAt: null,
  };
}

describe("agent session_updated event", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("synchronizes the changed authorization mode to both session views", () => {
    const sessions = useSessionStore();
    const initial = makeSession("risk_based");
    sessions.sessions = [initial];
    sessions.current = initial;

    useAgentStore().handle({ type: "session_updated", session: makeSession("full_access") });

    expect(sessions.sessions[0]?.authorizationMode).toBe("full_access");
    expect(sessions.current?.authorizationMode).toBe("full_access");
  });
});
