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

  it("keeps only the scroll-to-bottom control", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain(".scroll-to-bottom-btn");
    expect(source).toContain("handleClickScrollToBottom");
    expect(source).not.toContain("scroll-to-top-btn");
    expect(source).not.toContain("showScrollTopButton");
    expect(source).not.toContain("scrollToTop");
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

  it("uses one native table grid for markdown headers and body rows", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain(".msg-content :deep(.markdown-table-wrap)");
    expect(source).toContain("display: table-header-group;");
    expect(source).toContain("display: table-row-group;");
    expect(source).not.toContain(".msg-content :deep(thead),\n.msg-content :deep(tbody),");
  });

  it("constrains assistant message bodies so wide markdown stays inside the message", async () => {
    const source = await readFile(componentPath, "utf8");
    const bodyStart = source.indexOf(".msg.assistant .msg-body {");
    const bodyEnd = source.indexOf("}\n", bodyStart);
    const bodyStyles = source.slice(bodyStart, bodyEnd);

    expect(bodyStart).toBeGreaterThan(-1);
    expect(bodyStyles).toContain("width: 100%;");
    expect(bodyStyles).toContain("min-width: 0;");
  });
});
