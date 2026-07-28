import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = resolve(process.cwd(), "src/components/ChatPanel.vue");
const avatarPath = resolve(process.cwd(), "public/panda-agent-avatar-22px.svg");

describe("ChatPanel PI Agent avatar", () => {
  it("uses the uncropped 22px panda SVG for assistant message headers", async () => {
    const source = await readFile(componentPath, "utf8");
    const avatar = await stat(avatarPath);

    expect(avatar.isFile()).toBe(true);
    expect(source).toContain('src="/panda-agent-avatar-22px.svg"');
    expect(source).toContain('alt="PI Agent"');
    expect(source).not.toContain("padding: 2px;");
  });
});
