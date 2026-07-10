import fs from "node:fs";
import path from "node:path";
import { SkillDto } from "@pi-web-ui/shared";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const m = content.match(/^\s*---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { body: content };
  const block = m[1] ?? "";
  const body = m[2] ?? "";
  let name: string | undefined;
  let description: string | undefined;
  for (const line of block.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1] as string;
    let val = (kv[2] ?? "").trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (key === "name") name = val;
    else if (key === "description") description = val;
  }
  return { name, description, body };
}

export class SkillService {
  constructor(private skillsDir: string) {}

  list(): SkillDto[] {
    if (!fs.existsSync(this.skillsDir)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const skills: SkillDto[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = path.join(this.skillsDir, e.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const content = fs.readFileSync(skillMd, "utf8");
      const parsed = parseFrontmatter(content);
      if (!parsed.name || !parsed.description) continue;
      skills.push({ name: parsed.name, description: parsed.description, path: skillMd });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  import(input: { name: string; description: string; body: string }): SkillDto {
    const name = input.name.trim();
    if (!NAME_RE.test(name) || name.length > 64) {
      throw new Error("invalid skill name");
    }
    const description = input.description.trim();
    if (!description || description.length > 1024) {
      throw new Error("invalid description");
    }
    const body = input.body ?? "";
    const dir = path.join(this.skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const skillMd = path.join(dir, "SKILL.md");
    const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
    fs.writeFileSync(skillMd, content, "utf8");
    return { name, description, path: skillMd };
  }

  uninstall(name: string): void {
    if (!NAME_RE.test(name)) throw new Error("invalid skill name");
    const dir = path.join(this.skillsDir, name);
    const resolved = path.resolve(dir);
    const root = path.resolve(this.skillsDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error("path escape");
    }
    if (!fs.existsSync(dir)) throw new Error("not found");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
