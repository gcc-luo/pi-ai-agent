import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../src/api/client.js";

describe("api skills methods", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("listSkills GETs /skills", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const list = await api.listSkills();
    expect(list).toEqual([]);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills");
    expect(calls[0]![1].method).toBe("GET");
  });

  it("importSkill POSTs { name, description, body } to /skills", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      name: "x", description: "d", path: "/tmp/x/SKILL.md",
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const dto = await api.importSkill({ name: "x", description: "d", body: "b" });
    expect(dto.name).toBe("x");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills");
    expect(calls[0]![1].method).toBe("POST");
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ name: "x", description: "d", body: "b" });
  });

  it("deleteSkill DELETEs /skills/:name", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteSkill("my-skill");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills/my-skill");
    expect(calls[0]![1].method).toBe("DELETE");
  });

  it("deleteSkill URL-encodes the name", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteSkill("a-b");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills/a-b");
  });
});
