import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = resolve(process.cwd(), "src/components/ChatPanel.vue");

describe("ChatPanel assistant presentation", () => {
  it("renders assistant replies as avatar-free document content", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).not.toContain('src="/panda-agent-avatar-22px.svg"');
    expect(source).toContain("Assistant replies are document-style content");
    expect(source).toContain("width: min(880px, 100%);");
    expect(source).toContain("v-if=\"!m.statusOnly && m.showMessageActions && !m.streaming\"");
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
    expect(source).not.toContain("runArtifacts");
    expect(source).toContain('v-if="m.artifacts?.length && !m.hideNonTextContent"');
    expect(source).not.toContain("messages.value.map((m) => m.parts.length)");
    expect(source).toContain("liveTextSignature");
  });
});
