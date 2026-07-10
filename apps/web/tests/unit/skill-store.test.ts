import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSkillStore } from "../../src/stores/skill.js";

describe("skill store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("loadAll populates skills from api", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();
    expect(store.skills.length).toBe(1);
    expect(store.skills[0]!.name).toBe("a");
  });

  it("importSkill adds the new skill to state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(
      { name: "b", description: "b desc", path: "/b/SKILL.md" },
    ), { status: 201, headers: { "Content-Type": "application/json" } }));

    const dto = await store.importSkill({ name: "b", description: "b desc", body: "b body" });
    expect(dto.name).toBe("b");
    expect(store.skills.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("importSkill upserts when name exists", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "old", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(
      { name: "a", description: "new", path: "/a/SKILL.md" },
    ), { status: 201, headers: { "Content-Type": "application/json" } }));

    await store.importSkill({ name: "a", description: "new", body: "b" });
    expect(store.skills.length).toBe(1);
    expect(store.skills[0]!.description).toBe("new");
  });

  it("remove filters the skill out of state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
      { name: "b", description: "b desc", path: "/b/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await store.remove("a");
    expect(store.skills.map((s) => s.name)).toEqual(["b"]);
  });

  it("remove does not mutate state when api rejects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(store.remove("a")).rejects.toThrow();
    expect(store.skills.length).toBe(1);
  });
});
