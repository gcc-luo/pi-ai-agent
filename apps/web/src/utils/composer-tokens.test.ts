import { describe, expect, it } from "vitest";
import { getComposerPlainText, insertComposerToken } from "./composer-tokens.js";

describe("composer resource tokens", () => {
  it("inserts an icon token at the current caret and keeps its text representation", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "Use this ";
    document.body.append(editor);

    const range = document.createRange();
    range.setStart(editor.firstChild!, 4);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    insertComposerToken(editor, {
      id: "plugin-documents",
      kind: "plugin",
      label: "Documents",
      icon: "📄",
      value: "@Documents",
    });

    expect(editor.querySelector('[data-composer-token="plugin-documents"]')?.textContent).toContain("Documents");
    expect(getComposerPlainText(editor)).toBe("Use @Documents this ");
    expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(window.getSelection()?.anchorNode?.parentElement?.closest("[data-composer-token]")).toBeNull();

    editor.remove();
  });
});
