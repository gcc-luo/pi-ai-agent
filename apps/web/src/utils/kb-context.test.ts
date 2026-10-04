import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";
import { renderKbCitations, type KbCitationMeta } from "./kb-context.js";

describe("renderKbCitations", () => {
  it("renders accessible citation buttons with the source reference", () => {
    const citation: KbCitationMeta = {
      localId: 1,
      chunkId: 42,
      kbId: "kb-1",
      fileId: "file-1",
      kbName: "产品知识库",
      fileName: "部署指南.md",
      titlePath: "Docker 部署",
      pageStart: 3,
      pageEnd: null,
    };
    const root = document.createElement("div");
    root.innerHTML = renderKbCitations(renderMarkdown("请查看 [1]。"), { 1: citation });

    const button = root.querySelector<HTMLButtonElement>("button.kb-citation-chip");
    expect(button?.type).toBe("button");
    expect(button?.dataset.localId).toBe("1");
    expect(button?.getAttribute("aria-label")).toContain("查看来源");
    expect(button?.textContent).toContain("部署指南.md");
  });
});
