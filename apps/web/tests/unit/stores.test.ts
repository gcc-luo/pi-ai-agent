import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useProjectStore } from "../../src/stores/project.js";

describe("project store", () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.restoreAllMocks(); });

  it("loads and creates projects", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "1", name: "x" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useProjectStore();
    await store.loadAll();
    await store.create("x");
    expect(store.projects.length).toBe(1);
  });
});
