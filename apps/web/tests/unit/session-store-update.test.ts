import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSessionStore } from "../../src/stores/session.js";

describe("session store update", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  const seedSession = (id: string, title: string | null) => ({
    id, projectId: "p1", title, parentId: null,
    status: "active" as const, createdAt: 0, updatedAt: 0, lastActiveAt: null,
  });

  it("update(id, title) replaces the matching session in state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([seedSession("s1", "old")]), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useSessionStore();
    await store.loadForProject("p1");
    expect(store.sessions[0]!.title).toBe("old");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(seedSession("s1", "new")), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));

    const updated = await store.update("s1", "new");
    expect(updated.title).toBe("new");
    expect(store.sessions[0]!.title).toBe("new");
  });

  it("update does not mutate state when the API call rejects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([seedSession("s1", "old")]), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useSessionStore();
    await store.loadForProject("p1");

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(store.update("s1", "new")).rejects.toThrow();
    expect(store.sessions[0]!.title).toBe("old");
  });
});
