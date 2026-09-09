import { describe, expect, it } from "vitest";
import { projectNameFromPath } from "./project-path.js";

describe("projectNameFromPath", () => {
  it("extracts the final Windows directory name", () => {
    expect(projectNameFromPath("C:\\Users\\gengcc\\IdeaProjects\\demo")).toBe("demo");
  });

  it("extracts the final POSIX directory name", () => {
    expect(projectNameFromPath("/home/gengcc/projects/demo")).toBe("demo");
  });

  it("ignores trailing separators", () => {
    expect(projectNameFromPath("C:\\work\\demo\\")).toBe("demo");
    expect(projectNameFromPath("/work/demo/")).toBe("demo");
  });

  it("preserves meaningful spaces in directory names", () => {
    expect(projectNameFromPath("/work/ demo ")).toBe(" demo ");
  });

  it("falls back for filesystem roots", () => {
    expect(projectNameFromPath("C:\\")).toBe("Untitled");
    expect(projectNameFromPath("/")).toBe("Untitled");
    expect(projectNameFromPath("")).toBe("Untitled");
  });
});
