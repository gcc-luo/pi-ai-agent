import { describe, it, expect } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

describe("healthz", () => {
  it("returns ok", async () => {
    process.env.PI_WEB_UI_ROOT = `/tmp/pi-web-ui-test-${Date.now()}-${Math.random()}`;
    const app = await buildApp(loadConfig());
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("allows desktop WebView preflight requests for model switching", async () => {
    process.env.PI_WEB_UI_ROOT = `/tmp/pi-web-ui-test-${Date.now()}-${Math.random()}`;
    const app = await buildApp(loadConfig());
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/config",
      headers: {
        origin: "http://tauri.localhost",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://tauri.localhost");
    expect(res.headers["access-control-allow-methods"]).toContain("PUT");
    expect(res.headers["access-control-allow-headers"]).toContain("content-type");
    await app.close();
  });
});
