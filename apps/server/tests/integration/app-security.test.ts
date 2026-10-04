import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { authorizationRoutes } from "../../src/routes/authorization.js";

describe("app security boundary", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });

  function config(overrides: Partial<ReturnType<typeof loadConfig>> = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-security-"));
    tempDirs.push(root);
    vi.stubEnv("PI_WEB_UI_ROOT", root);
    return { ...loadConfig(), host: "0.0.0.0", ...overrides, dbPath: path.join(root, "db.sqlite"), logFile: path.join(root, "server.log") };
  }

  it("refuses a non-loopback listener without an auth token", async () => {
    await expect(buildApp(config())).rejects.toThrow("PI_WEB_UI_AUTH_TOKEN");
  });

  it("protects APIs while keeping health checks public", async () => {
    const app = await buildApp(config({ authToken: "test-token" }));
    const health = await app.inject({ method: "GET", url: "/healthz" });
    const denied = await app.inject({ method: "GET", url: "/api/config" });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { authorization: "Bearer test-token" },
    });

    expect(health.statusCode).toBe(200);
    expect(denied.statusCode).toBe(401);
    // This route is not registered in the bare app; reaching it proves the
    // auth hook accepted the request rather than rejecting it.
    expect(allowed.statusCode).toBe(404);
    await app.close();
  });

  it("allows only the session-token-authenticated internal authorization endpoint through global auth", async () => {
    const app = await buildApp(config({ authToken: "test-token" }));
    app.decorate("processManager", {
      validateAuthorizationToken: () => false,
    } as never);
    await app.register(authorizationRoutes, { prefix: "/api" });

    const internal = await app.inject({
      method: "POST",
      url: "/api/internal/authorization/session-1/check",
      headers: { "x-pi-authorization-token": "session-scoped-secret" },
    });
    const unrelated = await app.inject({
      method: "POST",
      url: "/api/internal/authorization/session-1/other",
      headers: { "x-pi-authorization-token": "session-scoped-secret" },
    });

    // A 403 proves the request passed global deployment authentication and
    // reached the route's independent per-session token check.
    expect(internal.statusCode).toBe(403);
    expect(internal.json()).toEqual({ error: "forbidden" });
    expect(unrelated.statusCode).toBe(401);
    await app.close();
  });
});
