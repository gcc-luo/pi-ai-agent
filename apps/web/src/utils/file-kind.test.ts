import { describe, expect, it } from "vitest";
import { fileIconKind } from "./file-kind.js";

describe("fileIconKind", () => {
  it.each([
    ["README.md", "markdown"],
    ["app.js", "javascript"],
    ["types.ts", "typescript"],
    ["script.py", "python"],
    ["package.json", "json"],
    ["index.html", "web"],
    ["theme.css", "style"],
    ["records.csv", "data"],
    ["photo.png", "image"],
    ["movie.mp4", "video"],
    ["sound.mp3", "audio"],
    ["guide.pdf", "pdf"],
    ["report.docx", "word"],
    ["table.xlsx", "excel"],
    ["slides.pptx", "powerpoint"],
    ["backup.zip", "archive"],
    [".env", "config"],
    [".env.local", "config"],
    ["notes.txt", "text"],
    ["server.rs", "code"],
    ["unknown.bin", "generic"],
  ] as const)("classifies %s as %s", (filename, expected) => {
    expect(fileIconKind(filename)).toBe(expected);
  });

  it("classifies a nested path by its file name", () => {
    expect(fileIconKind("src/components/Button.vue")).toBe("web");
  });
});
