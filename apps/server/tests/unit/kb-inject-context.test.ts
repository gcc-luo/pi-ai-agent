import { describe, expect, it } from "vitest";
import { buildKbContext } from "../../src/kb/inject-context.js";
import type { KbSearchHitDto } from "@pi-web-ui/shared";

describe("buildKbContext", () => {
  it("keeps the knowledge base and file identifiers for citation navigation", () => {
    const hit: KbSearchHitDto = {
      chunkId: 42,
      segmentId: "file-1:1:1",
      revision: 1,
      kbId: "kb-1",
      kbName: "产品知识库",
      fileId: "file-1",
      fileName: "部署指南.md",
      seq: 1,
      titlePath: "Docker 部署",
      pageStart: 3,
      pageEnd: null,
      modality: "text",
      timeStartMs: null,
      timeEndMs: null,
      bbox: null,
      content: "Docker 部署适合中小规模团队。",
      snippet: "Docker 部署适合中小规模团队。",
      score: 0.9,
    };

    const result = buildKbContext([hit]);

    expect(result.chunkMap[1]).toMatchObject({
      kbId: "kb-1",
      fileId: "file-1",
      chunkId: 42,
      segmentId: "file-1:1:1",
    });
  });
});
