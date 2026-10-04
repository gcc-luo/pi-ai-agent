import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = resolve(process.cwd(), "src/components/ChatPanel.vue");

describe("responsive chat content layout", () => {
  it("scales message and composer gutters to the chat column width", async () => {
    const source = await readFile(componentPath, "utf8");
    const gutter = source.match(/--chat-content-gutter:\s*([^;]+);/)?.[1]?.trim();

    expect(gutter).toBe("clamp(16px, 15%, 280px)");
    expect(source.match(/var\(--chat-content-gutter\)/g)).toHaveLength(2);
  });
});
