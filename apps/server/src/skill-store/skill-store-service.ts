import path from "node:path";
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
  type SkillsShSource,
} from "./vendor/providers/skills-sh-identifiers.js";
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
    const source = this.resolveSkillsShSource(skill);
    if (!source) {
      throw new Error(`install is only supported for skills.sh-sourced skills; got provider=${skill.provider}`);
    }
    const requestedName = sanitizeLocalName(localNameOverride ?? skill.name ?? source.skill);
    if (!requestedName || !NAME_RE.test(requestedName) || requestedName.length > 64) {
      throw new Error("invalid skill name (lowercase letters, digits, and hyphens only; max 64 chars)");
    }
    const target = path.join(this.skillsDir, requestedName);
    // installSkillsShSkillDirectory writes files atomically; replace any
    // existing install of the same name to keep installs idempotent.
    await installSkillsShSkillDirectory(source, target, this.timeoutMs);
    const markdown = await fetchSkillsShMarkdown(source, this.timeoutMs);
    return { name: requestedName, path: target, markdown };
  }

  private resolveSkillsShSource(skill: SkillSearchResult): SkillsShSource | undefined {
    return (
      parseSkillsShReference(skill.installReference ?? undefined) ??
      parseSkillsShReference(skill.id) ??
      parseSkillsShReference(skill.sourceUrl ?? undefined)
    );
  }
}
