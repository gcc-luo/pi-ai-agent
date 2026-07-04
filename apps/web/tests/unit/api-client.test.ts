import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../src/api/client.js";

describe("api client", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("creates a project via POST", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", name: "x" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await api.createProject("x", "/tmp/test");
    expect(p.id).toBe("1");
    const calls = fetchMock.mock.calls as unknown as Array<[unknown, unknown]>;
    expect(calls[0]![0]).toBe("/api/projects");
    expect((calls[0]![1] as any).method).toBe("POST");
  });
});
