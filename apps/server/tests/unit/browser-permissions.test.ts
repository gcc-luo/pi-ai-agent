import { describe, expect, it } from "vitest";
import { browserCallNeedsConfirmation } from "../../src/browser/browser-permissions.js";

describe("native browser authorization", () => {
  it("allows observations and requires review of interactions and opaque orchestration", () => {
    for (const args of [
      ["open", "https://example.com"],
      ["snapshot", "-i"],
      ["screenshot"],
    ]) {
      expect(browserCallNeedsConfirmation({ args })).toBe(false);
    }
    for (const params of [
      { args: ["click", "@e1"] },
      { args: ["fill", "@e2", "secret"] },
      { args: ["eval", "location.href='/delete'"] },
      { args: ["batch"], stdin: '[["click","@e1"]]' },
      { script: "await browser(['click', '@e1'])" },
      { semanticAction: { action: "click" } },
      { args: ["--session", "other", "snapshot"] },
      { args: ["close", "--all"] },
      { args: ["wait", "--fn", "fetch('/delete')"] },
      { args: ["wait", "--download", "/tmp/report.pdf"] },
      { args: ["wait", "-d", "/tmp/report.pdf"] },
      { args: ["wait", "--download"] },
      { args: ["snapshot"], electron: { action: "launch" } },
      { args: ["screenshot", "browser/page.png"] },
      { args: ["screenshot", "#hero", "browser/hero.png"] },
      { args: ["snapshot", "-i"], outputPath: "/tmp/result.json" },
    ])
      expect(browserCallNeedsConfirmation(params)).toBe(true);
  });

  it("requires review before navigating to non-web schemes", () => {
    for (const target of [
      "file:///tmp/private.txt",
      "javascript:alert(1)",
      "data:text/html,hello",
      "custom:resource",
    ]) {
      expect(browserCallNeedsConfirmation({ args: ["open", target] })).toBe(true);
      expect(browserCallNeedsConfirmation({ args: ["navigate", target] })).toBe(true);
    }
    expect(browserCallNeedsConfirmation({ args: ["open", "https://example.com"] })).toBe(false);
  });
});
