import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { abortOnDisconnect } from "../../src/routes/request-abort.js";

describe("abortOnDisconnect", () => {
  it("aborts when the response socket closes before it finishes", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: false });
    const lifecycle = abortOnDisconnect(request as never, response as never);

    response.emit("close");

    expect(lifecycle.signal.aborted).toBe(true);
    lifecycle.dispose();
  });

  it("does not abort after a completed response and removes listeners", () => {
    const request = new EventEmitter();
    const response = Object.assign(new EventEmitter(), { writableEnded: true });
    const lifecycle = abortOnDisconnect(request as never, response as never);

    response.emit("close");
    expect(lifecycle.signal.aborted).toBe(false);
    lifecycle.dispose();
    expect(request.listenerCount("aborted")).toBe(0);
    expect(response.listenerCount("close")).toBe(0);
  });
});
