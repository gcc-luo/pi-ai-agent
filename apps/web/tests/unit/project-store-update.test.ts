import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useProjectStore } from "../../src/stores/project.js";

describe("project store update", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("update(id, name) replaces the matching project in state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: "1", name: "old", workdir: "/tmp", description: null, createdAt: 0, updatedAt: 0 },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useProjectStore();
    await store.loadAll();
    expect(store.projects[0]!.name).toBe("old");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(
      { id: "1", name: "new", workdir: "/tmp", description: null, createdAt: 0, updatedAt: 1 },
    ), { status: 200, headers: { "Content-Type": "application/json" } }));

    const updated = await store.update("1", "new");
    expect(updated.name).toBe("new");
    expect(store.projects[0]!.name).toBe("new");
  });

  it("update does not mutate state when the API call rejects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: "1", name: "old", workdir: "/tmp", description: null, createdAt: 0, updatedAt: 0 },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useProjectStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(store.update("1", "new")).rejects.toThrow();
    expect(store.projects[0]!.name).toBe("old");
  });
});
