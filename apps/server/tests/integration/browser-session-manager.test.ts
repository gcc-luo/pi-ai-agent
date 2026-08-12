import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserSessionManager } from "../../src/browser/browser-session-manager.js";

describe("BrowserSessionManager", () => {
  const managers: BrowserSessionManager[] = [];
  const workdirs: string[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.allSettled(managers.map((manager) => manager.shutdown()));
    await Promise.all(servers.map((server) =>
      new Promise<void>((resolve) => server.close(() => resolve())),
    ));
    for (const workdir of workdirs) {
      const resolved = path.resolve(workdir);
      expect(resolved.startsWith(path.resolve(os.tmpdir()))).toBe(true);
      await fs.rm(resolved, { recursive: true, force: true });
    }
    managers.length = 0;
    workdirs.length = 0;
    servers.length = 0;
  });

  it("isolates sessions and supports semantic interaction, diagnostics, and screenshots", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/missing") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("failed");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
        <html>
          <head><title>Browser fixture</title></head>
          <body>
            <label>Name <input id="name" placeholder="Your name"></label>
            <label>Password <input id="password" type="password"></label>
            <label>Attachment <input id="attachment" type="file"></label>
            <button id="submit" onclick="document.querySelector('#output').textContent =
              document.querySelector('#name').value">Submit</button>
            <div id="output"></div>
            <script>
              console.error("fixture console error");
              fetch("/missing");
            </script>
          </body>
        </html>`);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");

    const fastify = Fastify({ logger: false });
    const manager = new BrowserSessionManager({ logger: fastify.log, headless: true });
    managers.push(manager);
    const workdirA = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-a-"));
    const workdirB = await fs.mkdtemp(path.join(os.tmpdir(), "pi-browser-b-"));
    workdirs.push(workdirA, workdirB);

    await manager.open("session-a", workdirA);
    await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "navigate",
      args: { url: `http://127.0.0.1:${address.port}` },
    });
    const snapshot = await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "snapshot",
    });
    const elements = snapshot.elements as { ref: string; name: string }[];
    const input = elements.find((element) => element.name === "Name");
    const submit = elements.find((element) => element.name === "Submit");
    expect(input?.ref).toMatch(/^e\d+$/);
    expect(submit?.ref).toMatch(/^e\d+$/);

    await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "fill",
      args: { ref: input!.ref, value: "Pi browser" },
    });
    await expect(manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "fill",
      args: { selector: "#password", value: "secret" },
    })).resolves.toMatchObject({ ok: false, requiresConfirmation: true });
    await fs.writeFile(path.join(workdirA, "upload.txt"), "safe upload fixture");
    const blockedUpload = await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "upload",
      args: { selector: "#attachment", paths: ["upload.txt"] },
    });
    expect(blockedUpload).toMatchObject({
      ok: false,
      requiresConfirmation: true,
    });
    await expect(manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "upload",
      args: { selector: "#attachment", paths: ["../outside.txt"], userConfirmed: true },
    })).rejects.toThrow("必须位于当前项目工作区内");
    await fs.writeFile(path.join(workdirB, "outside.txt"), "outside workspace");
    await fs.symlink(path.join(workdirB, "outside.txt"), path.join(workdirA, "linked.txt"));
    await expect(manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "upload",
      args: { selector: "#attachment", paths: ["linked.txt"], userConfirmed: true },
    })).rejects.toThrow("符号链接");
    await expect(manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "upload",
      args: { selector: "#attachment", paths: ["upload.txt"], userConfirmed: true },
    })).resolves.toMatchObject({ ok: true, files: ["upload.txt"] });
    const blockedClick = await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "click",
      args: { ref: submit!.ref },
    });
    expect(blockedClick).toMatchObject({
      ok: false,
      requiresConfirmation: true,
    });
    await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "click",
      args: { ref: submit!.ref, userConfirmed: true },
    });
    const screenshot = await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "screenshot",
      args: { name: "fixture.png", fullPage: true },
    });
    const artifact = screenshot.artifact as { path: string; absolutePath: string };
    expect(artifact.path).toBe("browser/screenshots/fixture.png");
    await expect(fs.stat(artifact.absolutePath)).resolves.toMatchObject({ size: expect.any(Number) });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const consoleResult = await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "console_errors",
    });
    expect(JSON.stringify(consoleResult)).toContain("fixture console error");
    const networkResult = await manager.execute({
      sessionId: "session-a",
      workdir: workdirA,
      action: "network_errors",
    });
    expect(JSON.stringify(networkResult)).toContain("500");

    await manager.open("session-b", workdirB);
    expect(manager.status("session-a", true).currentUrl).toContain(String(address.port));
    expect(manager.status("session-b", true).currentUrl).toBe("about:blank");

    await expect(manager.execute({
      sessionId: "session-b",
      workdir: workdirB,
      action: "navigate",
      args: { url: "file:///etc/passwd" },
    })).rejects.toThrow("仅支持 http 和 https");
  }, 30_000);
});
