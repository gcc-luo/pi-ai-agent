import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

describe("built-in plugin extension configuration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const directory of temporaryDirectories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  it("keeps Browser and Computer credentials independent when both extensions load", async () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-plugin-config-"));
    temporaryDirectories.push(isolatedRoot);
    process.env.PI_WEB_UI_BROWSER_PLUGIN_ENDPOINT = "http://127.0.0.1:8080/api/internal/plugins";
    process.env.PI_WEB_UI_BROWSER_PLUGIN_TOKEN = "browser-token";
    process.env.PI_WEB_UI_BROWSER_SESSION_ID = "session-a";
    process.env.PI_WEB_UI_COMPUTER_PLUGIN_ENDPOINT = "http://127.0.0.1:8080/api/internal/plugins";
    process.env.PI_WEB_UI_COMPUTER_PLUGIN_TOKEN = "computer-token";
    process.env.PI_WEB_UI_COMPUTER_SESSION_ID = "session-a";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const sourceRoot = path.resolve(import.meta.dirname, "../../src/agent/extensions");
    const result = await discoverAndLoadExtensions([
      path.join(sourceRoot, "browser-tools.ts"),
      path.join(sourceRoot, "computer-tools.ts"),
    ], isolatedRoot, isolatedRoot);
    expect(result.errors).toEqual([]);
    const tools = new Map(result.extensions.flatMap((extension) => [...extension.tools]));
    const signal = new AbortController().signal;

    await tools.get("browser_open")!.definition.execute(
      "browser-call", {}, signal, undefined, {} as never,
    );
    await tools.get("computer_get_cursor_position")!.definition.execute(
      "computer-call", {}, signal, undefined, {} as never,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [browserUrl, browserRequest] = fetchMock.mock.calls[0]!;
    const [computerUrl, computerRequest] = fetchMock.mock.calls[1]!;
    expect(String(browserUrl)).toContain("/session-a/browser-use/action");
    expect((browserRequest as RequestInit).headers).toMatchObject({
      "x-pi-plugin-token": "browser-token",
    });
    expect(String(computerUrl)).toContain("/session-a/computer-use/action");
    expect((computerRequest as RequestInit).headers).toMatchObject({
      "x-pi-plugin-token": "computer-token",
    });
  });
});
