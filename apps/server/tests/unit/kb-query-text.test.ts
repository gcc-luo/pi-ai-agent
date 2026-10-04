import { describe, expect, it } from "vitest";
import { buildSearchQueryVariants, extractUserSearchQuery } from "../../src/kb/query-text.js";

describe("knowledge search query text", () => {
  it("keeps the user wording and adds a compact semantic query", () => {
    const query = "帮我搜索一下知识库中和春天相关的诗歌";
    const variants = buildSearchQueryVariants(query);

    expect(variants[0]).toBe(query);
    expect(variants[1]).toBe("春天相关的诗歌");
  });

  it("does not replace a concise query with a worse normalized variant", () => {
    expect(buildSearchQueryVariants("春天")).toEqual(["春天"]);
  });

  it("removes transport wrappers before constructing retrieval variants", () => {
    const query = extractUserSearchQuery("查找春天的诗歌 /skill:browser-use");
    expect(query).toBe("查找春天的诗歌");
    expect(buildSearchQueryVariants(query)).toEqual(["查找春天的诗歌", "春天的诗歌"]);
  });
});
