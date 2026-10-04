import { describe, expect, it } from "vitest";
import { highlightCitationText } from "./kb-citation-highlight.js";

describe("highlightCitationText", () => {
  it("highlights a citation across inline markdown nodes", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>系统应先识别<strong>用户真实意图</strong>，再检索相关内容。</p>";

    const mark = highlightCitationText(root, "用户真实意图，再检索相关内容");

    expect(mark).not.toBeNull();
    expect(root.querySelectorAll("mark.kb-citation-highlight").length).toBeGreaterThan(1);
    expect(root.textContent).toContain("用户真实意图，再检索相关内容");
  });

  it("normalizes whitespace when matching a passage", () => {
    const root = document.createElement("div");
    root.innerHTML = "<pre>第一行内容\n第二行引用内容</pre>";

    const mark = highlightCitationText(root, "第一行内容 第二行引用内容");

    expect(mark).not.toBeNull();
    expect(root.querySelector("mark.kb-citation-highlight")?.textContent).toBe("第一行内容\n第二行引用内容");
  });

  it("returns no highlight when the citation is absent", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>这里是另一段正文。</p>";

    expect(highlightCitationText(root, "没有出现在正文里的引用" )).toBeNull();
    expect(root.querySelector("mark.kb-citation-highlight")).toBeNull();
  });
});
