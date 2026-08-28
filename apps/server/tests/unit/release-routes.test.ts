import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RELEASE_API_URL, releaseRoutes } from "../../src/routes/releases.js";

describe("release routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the latest GitHub release to the version information response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: "v1.4.1",
      body: "## 更新内容\n\n1. 优化更新公告。",
      published_at: "2026-08-28T06:50:38Z",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const app = Fastify();
    await app.register(releaseRoutes, { prefix: "/api" });
    const response = await app.inject({ method: "GET", url: "/api/release-info" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      version: "1.4.1",
      date: "2026-08-28T06:50:38Z",
      body: "## 更新内容\n\n1. 优化更新公告。",
    });
    expect(fetchMock).toHaveBeenCalledWith(RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "PI-AI-Agent",
      },
    });
    await app.close();
  });

  it("returns a gateway error when the release manifest cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    const app = Fastify();
    await app.register(releaseRoutes, { prefix: "/api" });
    const response = await app.inject({ method: "GET", url: "/api/release-info" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "failed to load release information" });
    await app.close();
  });
});
