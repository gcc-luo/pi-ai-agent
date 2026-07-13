import type { ProvenanceEntry, ProviderId, SkillSearchResult } from "../types.js";
import {
  httpsPathSegments,
  isSafeSegment,
  parseSkillsShIdentifier,
  parseSkillsShReference,
  parseSkillsShUrl,
  skillsShDetailUrl,
  skillsShIdentifier,
  type SkillsShSource,
} from "../providers/skills-sh-identifiers.js";

export interface GithubSource {
  readonly owner: string;
  readonly repo: string;
  readonly branch?: string | undefined;
  readonly pathSegments: readonly string[];
}

export type SourceReferenceKind = "skills-sh" | "github" | "provider";

export interface SourceReference {
  readonly kind: SourceReferenceKind;
  readonly provider?: ProviderId | undefined;
  readonly sourceId: string;
  readonly sourceUrl?: string | undefined;
  readonly githubUrl?: string | undefined;
  readonly owner?: string | undefined;
  readonly repository?: string | undefined;
  readonly branch?: string | undefined;
  readonly path?: string | undefined;
  readonly skill?: string | undefined;
  readonly label: string;
}

export interface SourceReferenceMetadata {
  readonly sourceOwner?: string | undefined;
  readonly sourceRepository?: string | undefined;
  readonly sourcePath?: string | undefined;
}

function pathFromSegments(segments: readonly string[]): string | undefined {
  return segments.length > 0 ? segments.join("/") : undefined;
}

function trimSkillMarkdownFile(segments: readonly string[]): string[] {
  const last = segments.at(-1)?.toLowerCase();
  return last === "skill.md" ? segments.slice(0, -1) : [...segments];
}

function normalizeGithubUrlValue(value: string): string {
  return value.trim().replace(/^git\+/iu, "");
}

export function parseGithubSourceUrl(value: string | undefined): GithubSource | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(normalizeGithubUrlValue(value));
  } catch {
    return undefined;
  }

  const pathSegments = httpsPathSegments(url, "github.com");
  if (!pathSegments) {
    return undefined;
  }
  const [owner, repoWithSuffix, sourceKind, branch, ...rawSourcePath] = pathSegments;
  const repo = repoWithSuffix?.replace(/\.git$/iu, "");
  if (!isSafeSegment(owner) || !isSafeSegment(repo)) {
    return undefined;
  }

  if (sourceKind === undefined) {
    return { owner, repo, pathSegments: [] };
  }

  if (sourceKind !== "tree" && sourceKind !== "blob") {
    return undefined;
  }
  if (!isSafeSegment(branch)) {
    return undefined;
  }
  if (rawSourcePath.some((segment) => !isSafeSegment(segment))) {
    return undefined;
  }

  const sourcePath = sourceKind === "blob" ? trimSkillMarkdownFile(rawSourcePath.filter((segment): segment is string => Boolean(segment))) : rawSourcePath.filter((segment): segment is string => Boolean(segment));
  return { owner, repo, branch, pathSegments: sourcePath };
}

export function canonicalGithubUrl(source: GithubSource): string {
  const repoUrl = `https://github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
  if (!source.branch) {
    return repoUrl;
  }
  const encodedPath = source.pathSegments.map(encodeURIComponent).join("/");
  return encodedPath.length > 0
    ? `${repoUrl}/tree/${encodeURIComponent(source.branch)}/${encodedPath}`
    : `${repoUrl}/tree/${encodeURIComponent(source.branch)}`;
}

export function rawGithubSkillMarkdownUrl(source: GithubSource): URL | undefined {
  if (!source.branch || source.pathSegments.length === 0) {
    return undefined;
  }
  const encodedPath = [...source.pathSegments, "SKILL.md"].map(encodeURIComponent).join("/");
  return new URL(
    `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${encodeURIComponent(source.branch)}/${encodedPath}`,
  );
}

export function sourceReferenceFromSkillsShSource(source: SkillsShSource): SourceReference {
  const identifier = skillsShIdentifier(source);
  return {
    kind: "skills-sh",
    provider: "skills-sh",
    sourceId: identifier,
    sourceUrl: skillsShDetailUrl(source),
    owner: source.owner,
    repository: source.repo,
    skill: source.skill,
    path: source.skill,
    label: `${source.owner}/${source.repo}@${source.skill}`,
  };
}

export function sourceReferenceFromGithubSource(source: GithubSource, provider: ProviderId = "github"): SourceReference {
  const sourceUrl = canonicalGithubUrl(source);
  const path = pathFromSegments(source.pathSegments);
  const label = path ? `${source.owner}/${source.repo}/${path}` : `${source.owner}/${source.repo}`;
  return {
    kind: "github",
    provider,
    sourceId: sourceUrl,
    sourceUrl,
    githubUrl: sourceUrl,
    owner: source.owner,
    repository: source.repo,
    branch: source.branch,
    path,
    label,
  };
}

export function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

export function sourceReferenceFromSkill(skill: SkillSearchResult): SourceReference {
  const skillsShSource = parseSkillsShReference(skill.installReference)
    ?? parseSkillsShReference(skill.id)
    ?? parseSkillsShUrl(skill.sourceUrl);
  if (skillsShSource) {
    return sourceReferenceFromSkillsShSource(skillsShSource);
  }

  const githubSource = parseGithubSourceUrl(skill.githubUrl)
    ?? parseGithubSourceUrl(skill.sourceUrl)
    ?? parseGithubSourceUrl(skill.installReference)
    ?? parseGithubSourceUrl(skill.id);
  if (githubSource) {
    return sourceReferenceFromGithubSource(githubSource, skill.provider);
  }

  const owner = firstNonEmpty(skill.sourceOwner, skill.author);
  const repository = firstNonEmpty(skill.sourceRepository);
  const path = firstNonEmpty(skill.sourcePath);
  const sourceId = firstNonEmpty(skill.installReference, skill.sourceUrl, skill.githubUrl, skill.id) ?? skill.id;
  const labelParts = [owner, repository].filter((part): part is string => Boolean(part));
  const label = labelParts.length > 0 ? `${labelParts.join("/")}${path ? `/${path}` : ""}` : `${skill.provider}:${skill.id}`;
  return {
    kind: "provider",
    provider: skill.provider,
    sourceId,
    sourceUrl: firstNonEmpty(skill.sourceUrl, skill.githubUrl, skill.installReference),
    githubUrl: firstNonEmpty(skill.githubUrl),
    owner,
    repository,
    path,
    label,
  };
}

export function sourceReferenceFromProvenanceEntry(entry: ProvenanceEntry): SourceReference | undefined {
  const skillsShSource = entry.provider === "skills-sh" ? parseSkillsShIdentifier(entry.sourceId) ?? parseSkillsShUrl(entry.sourceUrl) : undefined;
  if (skillsShSource) {
    return sourceReferenceFromSkillsShSource(skillsShSource);
  }

  const githubSource = parseGithubSourceUrl(entry.sourceUrl) ?? parseGithubSourceUrl(entry.sourceId);
  if (githubSource) {
    return sourceReferenceFromGithubSource(githubSource, entry.provider ?? "github");
  }

  if (!entry.sourceId && !entry.sourceUrl && !entry.sourceOwner && !entry.sourceRepository) {
    return undefined;
  }

  const labelParts = [entry.sourceOwner, entry.sourceRepository].filter((part): part is string => Boolean(part));
  const label = labelParts.length > 0
    ? `${labelParts.join("/")}${entry.sourcePath ? `/${entry.sourcePath}` : ""}`
    : entry.sourceUrl ?? entry.sourceId ?? entry.name;
  return {
    kind: "provider",
    provider: entry.provider,
    sourceId: entry.sourceId ?? entry.sourceUrl ?? entry.name,
    sourceUrl: entry.sourceUrl,
    owner: entry.sourceOwner,
    repository: entry.sourceRepository,
    path: entry.sourcePath,
    label,
  };
}

export function sourceReferenceMetadata(reference: SourceReference): SourceReferenceMetadata {
  return {
    sourceOwner: reference.owner,
    sourceRepository: reference.repository,
    sourcePath: reference.path ?? reference.skill,
  };
}

export function sourceReferenceLabel(skill: SkillSearchResult): string {
  return sourceReferenceFromSkill(skill).label;
}

function normalizedIdentity(value: string): string {
  return value.trim().replace(/\/$/u, "").toLowerCase();
}

export interface SourceReferenceIdentityOptions {
  readonly sourceIdentityFallback?: string | undefined;
  readonly githubPathFallback?: string | undefined;
}

export function sourceReferenceIdentityKey(reference: SourceReference, options: SourceReferenceIdentityOptions = {}): string | undefined {
  if (reference.kind === "skills-sh" && reference.owner && reference.repository && reference.skill) {
    return `skills-sh:${normalizedIdentity(`${reference.owner}/${reference.repository}@${reference.skill}`)}`;
  }
  if (reference.kind === "github" && reference.owner && reference.repository) {
    const sourcePath = reference.path ?? options.githubPathFallback ?? options.sourceIdentityFallback ?? "";
    return `github:${normalizedIdentity(`${reference.owner}/${reference.repository}/${sourcePath}`)}`;
  }

  const identity = firstNonEmpty(reference.sourceUrl, reference.githubUrl, reference.sourceId, options.sourceIdentityFallback);
  if (!identity) {
    return undefined;
  }

  const normalized = normalizedIdentity(identity);
  return /(?:^[a-z][a-z0-9+.-]*:\/\/|[/@])/iu.test(identity) || !reference.provider
    ? `source:${normalized}`
    : `${reference.provider}:${normalized}`;
}

export function sourceIdentityKey(skill: SkillSearchResult): string {
  const reference = sourceReferenceFromSkill(skill);
  const referenceKey = sourceReferenceIdentityKey(reference, {
    sourceIdentityFallback: skill.id,
    githubPathFallback: skill.name,
  });
  return referenceKey ?? `${skill.provider}:${skill.name.toLowerCase()}:${skill.author.toLowerCase()}:${skill.description.toLowerCase()}`;
}

export function provenanceSourceIdentityKey(entry: ProvenanceEntry): string | undefined {
  const reference = sourceReferenceFromProvenanceEntry(entry);
  return reference
    ? sourceReferenceIdentityKey(reference, {
        sourceIdentityFallback: entry.sourceId ?? entry.name,
        githubPathFallback: entry.sourcePath ?? entry.name,
      })
    : undefined;
}
