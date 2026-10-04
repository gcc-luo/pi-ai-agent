import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverAndLoadExtensions,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { BrowserSessionManager } from "../../src/browser/browser-session-manager.js";
import {
  browserBinary,
  browserEnvironment,
  browserIdentity,
} from "../../src/browser/browser-runtime.js";

// Real Chromium smoke is opt-in so unit/CI runs do not depend on a browser install.
describe.runIf(process.env.PI_BROWSER_SMOKE === "1")(
  "native browser integration",
  () => {
    const cleanups: (() => Promise<unknown>)[] = [];
    afterEach(async () => {
      for (const cleanup of cleanups.reverse()) await cleanup();
      cleanups.length = 0;
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("loads the published extension, browses a fixture, emits an image and cleans up isolated sessions", async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-native-browser-"),
      );
      cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
      const server = http.createServer((_req, res) => {
        res.setHeader("content-type", "text/html");
        res.end(
          "<title>Native browser fixture</title><label>Name<input id=\"name\"></label><button onclick=\"document.querySelector('output').textContent=document.querySelector('input').value\">Apply</button><output></output>",
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      cleanups.push(
        () => new Promise<void>((resolve) => server.close(() => resolve())),
      );
      const address = server.address() as { port: number };
      vi.stubEnv("PI_BROWSER_HEADLESS", "true");
      const env = browserEnvironment(root, "a");
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      expect(browserIdentity(root, "a")).not.toEqual(
        browserIdentity(root, "b"),
      );
      vi.stubEnv(
        "PI_WEB_UI_BROWSER_PLUGIN_ENDPOINT",
        "http://host/internal/plugins",
      );
      vi.stubEnv("PI_WEB_UI_BROWSER_PLUGIN_TOKEN", "test-browser-token");
      vi.stubEnv("PI_WEB_UI_BROWSER_SESSION_ID", "a");
      const manager = new BrowserSessionManager({
        logger: Fastify({ logger: false }).log,
        sessionRoot: root,
      });
      cleanups.push(() => manager.shutdown());
      let approved = true;
      const hostCalls: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          const body = JSON.parse(init.body);
          hostCalls.push(body);
          if (body.action === "authorize" && approved)
            manager.begin("a", body.args.toolCallId, "normal");
          if (body.action === "complete")
            manager.report("a", body.args.toolCallId, body.args);
          return new Response(JSON.stringify({ approved, ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }),
      );
      const loaded = await discoverAndLoadExtensions(
        [
          path.resolve(
            import.meta.dirname,
            "../../src/agent/extensions/browser-tools.ts",
          ),
        ],
        root,
        root,
      );
      expect(loaded.errors).toEqual([]);
      const extension = loaded.extensions[0]!;
      const sessionManager = SessionManager.create(
        root,
        path.join(root, "transcripts"),
      );
      loaded.runtime.appendEntry = (type, data) => {
        sessionManager.appendCustomEntry(type, data);
      };
      const ctx = {
        cwd: root,
        mode: "rpc",
        hasUI: false,
        sessionManager,
        isProjectTrusted: () => false,
      };
      for (const handler of extension.handlers.get("session_start") ?? [])
        await handler({ type: "session_start" }, ctx);
      cleanups.push(async () => {
        for (const handler of extension.handlers.get("session_shutdown") ?? [])
          await handler({ type: "session_shutdown", reason: "quit" }, ctx);
      });
      const tool = extension.tools.get("agent_browser")!.definition;
      expect(extension.tools.has("browser_open")).toBe(false);
      let ordinal = 0;
      const execute = async (args: string[]) => {
        const result = await tool.execute(
          `call-${++ordinal}`,
          { args },
          undefined,
          undefined,
          ctx as never,
        );
        expect(result, JSON.stringify(result)).not.toHaveProperty(
          "isError",
          true,
        );
        return result;
      };
      await execute(["open", `http://127.0.0.1:${address.port}`]);
      expect(JSON.stringify(await execute(["snapshot", "-i"]))).toContain(
        "Name",
      );
      expect(manager.status("a", true).currentUrl).toBe(
        `http://127.0.0.1:${address.port}/`,
      );
      await execute(["fill", "#name", "Pi native"]);
      // Start a second real browser with the same workspace but another chat identity.
      const envB = { ...process.env, ...browserEnvironment(root, "b") };
      manager.begin("b", "b-open", "normal");
      const native = promisify(execFile);
      await native(
        browserBinary(),
        ["open", `http://127.0.0.1:${address.port}`],
        { env: envB, timeout: 20000 },
      );
      await native(browserBinary(), ["fill", "#name", "Other chat"], {
        env: envB,
        timeout: 20000,
      });
      expect(
        JSON.stringify(await execute(["get", "value", "#name"])),
      ).toContain("Pi native");
      await execute(["click", "button"]);
      expect(
        JSON.stringify(await execute(["get", "text", "output"])),
      ).toContain("Pi native");
      const screenshot = await execute(["screenshot", "browser/page.png"]);
      expect(screenshot.content.some((part) => part.type === "image")).toBe(
        true,
      );
      expect(screenshot.details).toMatchObject({
        hostArtifacts: [
          expect.objectContaining({
            path: "browser/page.png",
            mimeType: "image/png",
          }),
        ],
      });
      approved = false;
      const denied = await tool.execute(
        "denied",
        { args: ["fill", "#name", "should not run"] },
        undefined,
        undefined,
        ctx as never,
      );
      expect(denied.details).toEqual({ denied: true });
      approved = true;
      expect(
        JSON.stringify(await execute(["get", "value", "#name"])),
      ).toContain("Pi native");
      expect(hostCalls.some((call) => call.action === "complete")).toBe(true);
      await execute(["close"]);
      expect(manager.status("a", true).status).toBe("closed");
      await manager.close("a");
      expect(manager.status("a", true).status).toBe("closed");
    }, 90_000);
  },
);
