import { describe, expect, it } from "vitest";
import {
  buildHighlightSnippet,
  buildInstrSnippet,
} from "../../src/kb/search-snippet.js";
describe("knowledge search snippets", () => {
  it("preserves literal HTML as text while marking matching words", () => {
    expect(
      buildHighlightSnippet("<script>alert(1)</script> token & value", [
        "token",
      ]),
    ).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt; <mark>token</mark> &amp; value",
    );
    expect(buildInstrSnippet("<b>中文</b>", "中文")).toBe(
      "&lt;b&gt;<mark>中文</mark>&lt;/b&gt;",
    );
  });
  it("matches case-insensitively without nested or corrupted markup", () => {
    expect(buildHighlightSnippet("MARK marker Mark", ["mark", "marker"])).toBe(
      "<mark>MARK</mark> <mark>marker</mark> <mark>Mark</mark>",
    );
  });
  it("escapes unmatched snippets too", () => {
    expect(buildHighlightSnippet("<tag>&value", [])).toBe(
      "&lt;tag&gt;&amp;value",
    );
  });
});
