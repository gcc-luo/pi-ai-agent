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

  it("does not force the conversation to scroll when toggling agent history", async () => {
    const source = await readFile(componentPath, "utf8");
    const toggleStart = source.indexOf("function toggleRun(");
    const toggleEnd = source.indexOf("const compaction =", toggleStart);
    const toggleSource = source.slice(toggleStart, toggleEnd);

    expect(toggleStart).toBeGreaterThan(-1);
    expect(toggleSource).not.toContain("scrollToBottom");
  });

  it("does not follow tool-part updates and delegates process rendering to AgentActivity", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain('import AgentActivity from "./AgentActivity.vue"');
    expect(source).toContain("<AgentActivity");
    expect(source).toContain("artifactsByRun");
    expect(source).toContain("m.runArtifacts?.length");
    expect(source).not.toContain("messages.value.map((m) => m.parts.length)");
    expect(source).toContain("liveTextSignature");
  });
});
