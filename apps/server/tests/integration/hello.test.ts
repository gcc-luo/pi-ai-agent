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
});
