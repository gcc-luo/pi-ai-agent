import { describe, it, expect } from "vitest";
import { deriveDefaultTitle } from "../../src/ws/agent.js";

describe("deriveDefaultTitle", () => {
  it("returns the trimmed content when short enough", () => {
    expect(deriveDefaultTitle("  hello world  ")).toBe("hello world");
  });

  it("collapses internal whitespace into single spaces", () => {
    expect(deriveDefaultTitle("hello\n\tworld   again")).toBe("hello world again");
  });

  it("truncates to 30 chars and appends an ellipsis when overlong", () => {
    const content = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十ABCDEF";
    const result = deriveDefaultTitle(content)!;
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBe(31);
    expect(result.slice(0, 30)).toBe(content.slice(0, 30));
  });

  it("keeps content of exactly 30 chars without ellipsis", () => {
    const content = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
    expect(content.length).toBe(30);
    expect(deriveDefaultTitle(content)).toBe(content);
  });

  it("returns null for whitespace-only content so the next send retries", () => {
    expect(deriveDefaultTitle("   \n\t ")).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(deriveDefaultTitle("")).toBeNull();
  });
});
