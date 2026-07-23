import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../src/api/client.js";

describe("api.updateSession", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("PUTs { title } to /sessions/:id and returns the updated session", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "s1", projectId: "p1", title: "new", parentId: null,
      status: "active", createdAt: 0, updatedAt: 0, lastActiveAt: null,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await api.updateSession("s1", "new");
    expect(s.title).toBe("new");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/sessions/s1");
    expect(calls[0]![1].method).toBe("PUT");
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ title: "new" });
  });

  it("PUTs an expert assignment to the current session", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: "s1", projectId: "p1", title: null, parentId: null, expertId: "e1",
      status: "active", createdAt: 0, updatedAt: 0, lastActiveAt: null,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const s = await api.updateSessionExpert("s1", "e1");

    expect(s.expertId).toBe("e1");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/sessions/s1");
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ expertId: "e1" });
  });
});
