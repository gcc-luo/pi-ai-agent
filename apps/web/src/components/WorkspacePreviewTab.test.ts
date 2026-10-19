import { describe, expect, it } from "vitest";
import { getWorkspacePreviewKind } from "./workspace-preview.js";

describe("WorkspacePreviewTab", () => {
  it("dispatches file targets to FileViewer", () => {
    expect(getWorkspacePreviewKind({ kind: "file", path: "src/main.ts" })).toBe("file");
  });

  it("dispatches citation targets to KbCitationViewer", () => {
    const citation = {
      localId: 1,
      chunkId: 2,
      kbName: "Manual",
      fileName: "guide.md",
      titlePath: null,
      pageStart: null,
      pageEnd: null,
    };
    expect(getWorkspacePreviewKind({ kind: "citation", citation })).toBe("citation");
  });
});
