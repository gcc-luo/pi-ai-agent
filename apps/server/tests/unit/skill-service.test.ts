import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SkillService } from "../../src/agent/skill-service.js";

describe("SkillService", () => {
  let dir: string;
  let svc: SkillService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skills-"));
    svc = new SkillService(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSkill(name: string, desc: string, body = "body") {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`,
      "utf8",
    );
  }

  it("list returns empty when skillsDir does not exist", () => {
    const missing = path.join(dir, "missing");
    const s = new SkillService(missing);
    expect(s.list()).toEqual([]);
  });

  it("list returns empty when skillsDir is empty", () => {
    expect(svc.list()).toEqual([]);
  });

  it("list returns skills sorted by name", () => {
    writeSkill("b-skill", "b desc");
    writeSkill("a-skill", "a desc");
    const list = svc.list();
    expect(list.map((s) => s.name)).toEqual(["a-skill", "b-skill"]);
  });

  it("list skips directories without SKILL.md", () => {
    writeSkill("real", "real desc");
    fs.mkdirSync(path.join(dir, "no-skill-md"), { recursive: true });
    expect(svc.list().map((s) => s.name)).toEqual(["real"]);
  });

  it("list skips entries missing description in frontmatter", () => {
    const skillDir = path.join(dir, "no-desc");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: no-desc\n---\n\nbody\n`,
      "utf8",
    );
    expect(svc.list().map((s) => s.name)).toEqual([]);
  });

  it("list ignores root .md files (only directory skills)", () => {
    fs.writeFileSync(path.join(dir, "root-skill.md"), "---\nname: root\ndescription: r\n---\n\nbody\n", "utf8");
    expect(svc.list()).toEqual([]);
  });

  it("list returns absolute path to SKILL.md", () => {
    writeSkill("real", "real desc");
    const list = svc.list();
    expect(list[0]!.path).toBe(path.join(dir, "real", "SKILL.md"));
  });

  it("import writes SKILL.md and returns SkillDto", () => {
    const dto = svc.import({ name: "fresh", description: "fresh desc", body: "do stuff" });
    expect(dto.name).toBe("fresh");
    expect(dto.description).toBe("fresh desc");
    expect(dto.path).toBe(path.join(dir, "fresh", "SKILL.md"));
    expect(fs.existsSync(dto.path)).toBe(true);
    const written = fs.readFileSync(dto.path, "utf8");
    expect(written).toContain("name: fresh");
    expect(written).toContain("description: fresh desc");
    expect(written).toContain("do stuff");
  });

  it("import overwrites existing skill (upsert)", () => {
    svc.import({ name: "x", description: "old", body: "old body" });
    svc.import({ name: "x", description: "new", body: "new body" });
    const list = svc.list();
    expect(list.length).toBe(1);
    expect(list[0]!.description).toBe("new");
    const written = fs.readFileSync(list[0]!.path, "utf8");
    expect(written).toContain("new body");
  });

  it("import rejects invalid name (uppercase, spaces, dots, leading hyphen)", () => {
    for (const bad of ["Bad", "with space", "with.dot", "-leading", "trailing-", "double--hyphen"]) {
      expect(() => svc.import({ name: bad, description: "d", body: "b" })).toThrow();
    }
  });

  it("import rejects name longer than 64 chars", () => {
    const long = "a".repeat(65);
    expect(() => svc.import({ name: long, description: "d", body: "b" })).toThrow();
  });

  it("import rejects empty description", () => {
    expect(() => svc.import({ name: "x", description: "   ", body: "b" })).toThrow();
  });

  it("import rejects description longer than 1024 chars", () => {
    const long = "x".repeat(1025);
    expect(() => svc.import({ name: "x", description: long, body: "b" })).toThrow();
  });

  it("uninstall removes the skill directory", () => {
    writeSkill("gone", "gone desc");
    svc.uninstall("gone");
    expect(svc.list().map((s) => s.name)).toEqual([]);
    expect(fs.existsSync(path.join(dir, "gone"))).toBe(false);
  });

  it("uninstall throws on unknown skill", () => {
    expect(() => svc.uninstall("nope")).toThrow();
  });

  it("uninstall rejects invalid name (path-escape defense)", () => {
    expect(() => svc.uninstall("../escape")).toThrow();
    expect(() => svc.uninstall("a/b")).toThrow();
  });
});
