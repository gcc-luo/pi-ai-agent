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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify(String(input).includes("computer-use")
        ? { ok: false, denied: true, message: "用户未确认" }
        : { ok: true, approved: false }),
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

    await tools.get("agent_browser")!.definition.execute(
      "browser-call", {}, signal, undefined, {} as never,
    );
    const deniedComputerResult = await tools.get("computer_get_cursor_position")!.definition.execute(
      "computer-call", {}, signal, undefined, {} as never,
    );
    expect("isError" in deniedComputerResult && deniedComputerResult.isError).toBe(true);

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
