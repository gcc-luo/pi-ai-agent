import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../src/api/client.js";

describe("api.updateProject", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("PUTs { name } to /projects/:id and returns the updated project", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", name: "new" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await api.updateProject("1", "new");
    expect(p.name).toBe("new");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/projects/1");
    expect(calls[0]![1].method).toBe("PUT");
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ name: "new" });
  });
});
