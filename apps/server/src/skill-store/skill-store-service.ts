import path from "node:path";
import * as fs from "node:fs";
import {
  SkillSearchResult,
  SkillContentPreview,
  SkillSearchMode,
  SkillStoreSearchResponse,
} from "@pi-web-ui/shared";
import {
  createSkillsShProvider,
} from "./vendor/providers/skills-sh-provider.js";
import { createSkillsMpProvider } from "./vendor/providers/skillsmp-provider.js";
import type { SkillProvider as PshSkillProvider } from "./vendor/providers/provider-types.js";
import {
  installSkillsShSkillDirectory,
  fetchSkillsShMarkdown,
} from "./vendor/providers/skills-sh-download.js";
import {
  parseSkillsShReference,
  isSafeSegment,
  type SkillsShSource,
} from "./vendor/providers/skills-sh-identifiers.js";
import { parseGithubSourceUrl } from "./vendor/utils/source-reference.js";
import { buildRemotePreview } from "./vendor/browser/preview.js";

// Re-export so callers can deep-import the vendored types without reaching
// into the vendor folder themselves.
export type { SkillProvider as PshSkillProvider } from "./vendor/providers/provider-types.js";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 20;

// Stub runner — the skills.sh provider only invokes it when transport="cli",
// which we never enable. Throwing keeps the failure loud if that ever changes.
const stubRunner = {
  run: async () => {
    throw new Error("skills.sh CLI transport is not enabled in pi-web-ui");
  },
};

function dedupeKey(r: SkillSearchResult): string {
  return (
    r.installReference ||
    r.id ||
    `${r.provider}:${r.sourceOwner ?? ""}/${r.sourceRepository ?? ""}/${r.sourcePath ?? ""}`
  );
}

function sanitizeLocalName(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Wraps the vendored pi-skill-hub providers so the rest of the server talks
 * to a clean service instead of reaching into the vendor folder. All HTTP
 * calls go to skills.sh / skillsmp.com directly — no Pi agent runtime is
 * required.
 */
export class SkillStoreService {
  private readonly skillsShProvider: PshSkillProvider;
  private readonly skillsMpProvider: PshSkillProvider;
  private readonly timeoutMs: number;
  private readonly skillsDir: string;

  constructor(opts: { skillsDir: string; timeoutMs?: number; skillsMpApiKey?: string } = {
    skillsDir: path.join(process.env.HOME ?? "~", ".pi", "agent", "skills"),
  }) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.skillsDir = opts.skillsDir;
    this.skillsShProvider = createSkillsShProvider(stubRunner, this.timeoutMs);
    this.skillsMpProvider = createSkillsMpProvider(this.timeoutMs, undefined, opts.skillsMpApiKey);
  }

  async search(query: string, mode: SkillSearchMode = "keyword", limit = DEFAULT_LIMIT): Promise<SkillStoreSearchResponse> {
    const trimmed = query.trim();
    const errors: { provider: string; message: string }[] = [];
    const settled = await Promise.allSettled([
      this.skillsShProvider.search(trimmed, mode, limit),
      this.skillsMpProvider.search(trimmed, mode, limit),
    ]);

    const [sh, mp] = settled;
    const results: SkillSearchResult[] = [];
    if (sh.status === "fulfilled") {
      results.push(...sh.value as SkillSearchResult[]);
    } else {
      errors.push({ provider: "skills-sh", message: String(sh.reason?.message ?? sh.reason) });
    }
    if (mp.status === "fulfilled") {
      results.push(...mp.value as SkillSearchResult[]);
    } else {
      errors.push({ provider: "skillsmp", message: String(mp.reason?.message ?? mp.reason) });
    }

    // Dedupe by canonical identity; on collision keep the higher-popularity entry.
    const byKey = new Map<string, SkillSearchResult>();
    for (const r of results) {
      const key = dedupeKey(r);
      const prev = byKey.get(key);
      if (!prev || r.popularity > prev.popularity) byKey.set(key, r);
    }
    const merged = Array.from(byKey.values()).sort((a, b) => b.popularity - a.popularity).slice(0, limit);

    return { query: trimmed, results: merged, errors };
  }

  async preview(skill: SkillSearchResult): Promise<SkillContentPreview> {
    return await buildRemotePreview(skill as Parameters<typeof buildRemotePreview>[0]);
  }

  async install(skill: SkillSearchResult, localNameOverride?: string): Promise<{ name: string; path: string; markdown?: string }> {
    const source = this.resolveSource(skill);
    if (!source) {
      throw new Error(`Could not resolve a GitHub source for skill "${skill.name}" (${skill.provider}). No installReference, githubUrl, or sourceOwner/sourceRepository/sourcePath provided.`);
    }
    const requestedName = sanitizeLocalName(localNameOverride ?? skill.name ?? source.skill);
    if (!requestedName || !NAME_RE.test(requestedName) || requestedName.length > 64) {
      throw new Error("invalid skill name (lowercase letters, digits, and hyphens only; max 64 chars)");
    }
    const target = path.join(this.skillsDir, requestedName);
    // Replace any existing install of the same name so reinstalls stay
    // idempotent. installSkillsShSkillDirectory itself refuses to write over
    // an existing directory, so we clear the target first.
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    await installSkillsShSkillDirectory(source, target, this.timeoutMs);
    const markdown = await fetchSkillsShMarkdown(source, this.timeoutMs);
    return { name: requestedName, path: target, markdown };
  }

  /**
   * Resolve a {@link SkillsShSource} (owner/repo/skill) for any skill that has
   * a GitHub-backed source. skills.sh's download API can fetch any GitHub
   * repo's skill by `(owner, repo, skillName)` — it doesn't require the skill
   * to be registered on skills.sh — so SkillsMP-sourced skills (whose
   * installReference is a github.com URL) install the same way.
   */
  private resolveSource(skill: SkillSearchResult): SkillsShSource | undefined {
    // 1. Try skills.sh reference (skills.sh/.../owner/repo/skill or owner/repo@skill)
    const sh = parseSkillsShReference(skill.installReference ?? undefined)
      ?? parseSkillsShReference(skill.id)
      ?? parseSkillsShReference(skill.sourceUrl ?? undefined);
    if (sh) return sh;

    // 2. Try GitHub URL (covers SkillsMP whose installReference is a github.com URL)
    const gh = parseGithubSourceUrl(skill.githubUrl ?? undefined)
      ?? parseGithubSourceUrl(skill.sourceUrl ?? undefined)
      ?? parseGithubSourceUrl(skill.installReference ?? undefined);
    if (gh && gh.pathSegments.length > 0) {
      const skillName = gh.pathSegments[gh.pathSegments.length - 1];
      if (isSafeSegment(skillName)) {
        return { owner: gh.owner, repo: gh.repo, skill: skillName };
      }
    }

    // 3. Fall back to metadata fields (sourceOwner/sourceRepository/sourcePath)
    if (skill.sourceOwner && skill.sourceRepository && skill.sourcePath) {
      const segs = skill.sourcePath.split("/").filter(Boolean);
      const skillName = segs[segs.length - 1];
      if (isSafeSegment(skillName) && isSafeSegment(skill.sourceOwner) && isSafeSegment(skill.sourceRepository)) {
        return { owner: skill.sourceOwner, repo: skill.sourceRepository, skill: skillName };
      }
    }

    return undefined;
  }
}
