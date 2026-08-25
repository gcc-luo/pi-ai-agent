import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown tables", () => {
  it("keeps one semantic table inside a horizontal scroll wrapper", () => {
    const html = renderMarkdown([
      "| 会议主题 | 时间 | 状态 | 类型 | 会议号 |",
      "| --- | --- | --- | --- | --- |",
      "| 数据管理周例会 | 8月27日（周四）17:00 - 17:45 | 待开始 | 周期性会议 | 371 318 158 81 |",
    ].join("\n"));
    const root = document.createElement("div");
    root.innerHTML = html;

    const wrapper = root.querySelector(".markdown-table-wrap");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.children).toHaveLength(1);
    expect(wrapper?.firstElementChild?.tagName).toBe("TABLE");
    expect(wrapper?.querySelectorAll("thead th")).toHaveLength(5);
    expect(wrapper?.querySelectorAll("tbody td")).toHaveLength(5);
  });

  it("does not wrap escaped table markup inside a code block", () => {
    const html = renderMarkdown("```html\n<table><tr><td>demo</td></tr></table>\n```");
    const root = document.createElement("div");
    root.innerHTML = html;

    expect(root.querySelector(".markdown-table-wrap")).toBeNull();
    expect(root.querySelector(".code-block-wrap")).not.toBeNull();
  });
});
