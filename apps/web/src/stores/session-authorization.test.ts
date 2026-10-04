import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { SessionDto, SessionAuthorizationMode } from "@pi-web-ui/shared";
import { useSessionStore } from "./session.js";

const mockUpdateSessionAuthorizationMode = vi.hoisted(() => vi.fn());

vi.mock("../api/client.js", () => ({
  api: {
    updateSessionAuthorizationMode: mockUpdateSessionAuthorizationMode,
  },
}));

function makeSession(id: string, authorizationMode: SessionAuthorizationMode = "risk_based"): SessionDto {
  return {
    id,
    projectId: "project-1",
    title: id,
    parentId: null,
    expertId: null,
    authorizationMode,
    selectedPluginIds: [],
    browserEnabled: false,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    lastActiveAt: null,
    unreadCount: 0,
    lastReadMessageId: null,
    deletedAt: null,
  };
}

describe("session authorization mode", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
  });

  it.each<SessionAuthorizationMode>(["approve_each", "risk_based", "full_access"])(
    "persists %s and updates the current session and session list",
    async (mode) => {
      const store = useSessionStore();
      const original = makeSession("session-1");
      store.sessions = [original];
      store.current = original;
      const updated = makeSession("session-1", mode);
      mockUpdateSessionAuthorizationMode.mockResolvedValue(updated);

      await store.setAuthorizationMode("session-1", mode);

      expect(mockUpdateSessionAuthorizationMode).toHaveBeenCalledWith("session-1", mode);
      expect(store.sessions[0]?.authorizationMode).toBe(mode);
      expect(store.current?.authorizationMode).toBe(mode);
    },
  );

  it("shows the selected mode while saving, then accepts the server DTO", async () => {
    const store = useSessionStore();
    const original = makeSession("session-1");
    store.sessions = [original];
    store.current = original;
    let finish!: (session: SessionDto) => void;
    mockUpdateSessionAuthorizationMode.mockReturnValue(new Promise<SessionDto>((resolve) => {
      finish = resolve;
    }));

    const saving = store.setAuthorizationMode("session-1", "full_access");
    expect(store.current?.authorizationMode).toBe("full_access");
    expect(store.sessions[0]?.authorizationMode).toBe("full_access");

    finish(makeSession("session-1", "full_access"));
    await saving;
  });

  it("restores the last server mode when saving fails", async () => {
    const store = useSessionStore();
    const original = makeSession("session-1", "approve_each");
    store.sessions = [original];
    store.current = original;
    mockUpdateSessionAuthorizationMode.mockRejectedValue(new Error("network failed"));

    await expect(store.setAuthorizationMode("session-1", "full_access")).rejects.toThrow("network failed");

    expect(store.current?.authorizationMode).toBe("approve_each");
    expect(store.sessions[0]?.authorizationMode).toBe("approve_each");
  });

  it("does not apply a mode change to another session", async () => {
    const store = useSessionStore();
    const first = makeSession("session-1");
    const second = makeSession("session-2", "approve_each");
    store.sessions = [first, second];
    store.current = second;
    mockUpdateSessionAuthorizationMode.mockResolvedValue(makeSession("session-1", "full_access"));

    await store.setAuthorizationMode("session-1", "full_access");

    expect(store.current?.authorizationMode).toBe("approve_each");
    expect(store.sessions.map((session) => session.authorizationMode)).toEqual(["full_access", "approve_each"]);
  });
});
