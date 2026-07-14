import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
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

export interface ImportZipResult {
  imported: SkillDto[];
  errors: string[];
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

  /**
   * Validate and install a .zip skills bundle. A standard bundle is one that
   * contains at least one `SKILL.md` file with valid frontmatter (`name` +
   * `description`); each such file is treated as a skill, and every entry
   * sharing its parent directory is extracted into `skillsDir/<name>/`.
   * Returns the list of successfully imported skills plus per-skill errors.
   */
  importZip(buffer: Buffer): ImportZipResult {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new Error("invalid_zip");
    }

    const entries = zip.getEntries();
    if (!entries.length) throw new Error("zip_empty");

    // Reject path traversal / absolute paths before extracting anything.
    for (const e of entries) {
      const normalized = e.entryName.replace(/\\/g, "/");
      if (normalized.startsWith("/")) throw new Error(`absolute_path:${normalized}`);
      const parts = normalized.split("/");
      if (parts.some((p) => p === "..")) throw new Error(`path_traversal:${normalized}`);
    }

    const skillMdEntries = entries.filter(
      (e) => !e.isDirectory && path.basename(e.entryName).toUpperCase() === "SKILL.MD",
    );
    if (!skillMdEntries.length) throw new Error("no_skill_md");

    const imported: SkillDto[] = [];
    const errors: string[] = [];
    const seenNames = new Set<string>();

    for (const skillMd of skillMdEntries) {
      const content = skillMd.getData().toString("utf8");
      const parsed = parseFrontmatter(content);
      const label = skillMd.entryName;

      if (!parsed.name || !parsed.description) {
        errors.push(`${label}: missing name or description in frontmatter`);
        continue;
      }
      if (!NAME_RE.test(parsed.name) || parsed.name.length > 64) {
        errors.push(`${label}: invalid skill name '${parsed.name}'`);
        continue;
      }
      if (parsed.description.length > 1024) {
        errors.push(`${label}: description too long`);
        continue;
      }
      if (seenNames.has(parsed.name)) {
        errors.push(`${label}: duplicate skill name '${parsed.name}'`);
        continue;
      }
      seenNames.add(parsed.name);

      const skillMdPath = skillMd.entryName.replace(/\\/g, "/");
      const lastSlash = skillMdPath.lastIndexOf("/");
      // parent dir in the zip; "" means SKILL.md lives at the archive root
      const parentDir = lastSlash === -1 ? "" : skillMdPath.slice(0, lastSlash);
      const installDir = path.join(this.skillsDir, parsed.name);

      // Replace any existing install of the same name to keep imports idempotent.
      fs.rmSync(installDir, { recursive: true, force: true });
      fs.mkdirSync(installDir, { recursive: true });

      const prefix = parentDir === "" ? "" : parentDir + "/";
      for (const e of entries) {
        if (e.isDirectory) continue;
        const ep = e.entryName.replace(/\\/g, "/");
        let rel: string;
        if (parentDir === "") {
          rel = ep;
        } else if (ep.startsWith(prefix)) {
          rel = ep.slice(prefix.length);
        } else {
          continue;
        }
        if (!rel) continue;
        this.writeSafe(installDir, rel, e.getData());
      }

      const finalSkillMd = path.join(installDir, "SKILL.md");
      if (!fs.existsSync(finalSkillMd)) {
        errors.push(`${label}: extraction incomplete`);
        fs.rmSync(installDir, { recursive: true, force: true });
        continue;
      }

      imported.push({
        name: parsed.name,
        description: parsed.description,
        path: finalSkillMd,
      });
    }

    if (!imported.length) {
      throw new Error(`no_valid_skills:${errors.join("; ")}`);
    }

    return { imported, errors };
  }

  private writeSafe(installDir: string, rel: string, data: Buffer): void {
    const target = path.resolve(installDir, rel);
    const root = path.resolve(installDir);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`path_escape:${rel}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }

  uninstall(name: string): void {
    if (!name || name.includes("..") || path.isAbsolute(name)) {
      throw new Error("invalid skill name");
    }
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
