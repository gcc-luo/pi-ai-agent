export interface SkillsShSource {
  owner: string;
  repo: string;
  skill: string;
}

export const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;

export function isSafeSegment(segment: string | undefined): segment is string {
  return Boolean(segment && segment !== "." && segment !== ".." && SAFE_SEGMENT_PATTERN.test(segment));
}

export function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function parseSafeSegments(value: string): string[] | undefined {
  const segments = value
    .trim()
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecodeURIComponent(segment));
  if (segments.length !== 3 || segments.some((segment) => !isSafeSegment(segment))) {
    return undefined;
  }
  return segments as string[];
}

/**
 * Validates three path/identifier segments and builds a {@link SkillsShSource}.
 * Returns `undefined` when any segment is missing or fails {@link isSafeSegment}.
 * Shared by identifier, URL, and api-id parsing to avoid repeating the
 * segment-validation + source-construction block.
 */
function sourceFromSegments(owner: string | undefined, repo: string | undefined, skill: string | undefined): SkillsShSource | undefined {
  if (!isSafeSegment(owner) || !isSafeSegment(repo) || !isSafeSegment(skill)) {
    return undefined;
  }
  return { owner, repo, skill };
}

export function parseSkillsShIdentifier(identifier: string | undefined): SkillsShSource | undefined {
  if (!identifier) {
    return undefined;
  }

  const trimmed = identifier.trim();
  if (!trimmed) {
    return undefined;
  }

  const identifierParts = trimmed.split("@");
  if (identifierParts.length === 2) {
    const [repoPart, skill] = identifierParts;
    const repoParts = repoPart?.split("/") ?? [];
    if (repoParts.length !== 2) {
      return undefined;
    }

    const [owner, repo] = repoParts;
    return sourceFromSegments(owner, repo, skill);
  }

  const apiIdSegments = parseSafeSegments(trimmed);
  if (!apiIdSegments) {
    return undefined;
  }
  const owner = apiIdSegments[0];
  const repo = apiIdSegments[1];
  const skill = apiIdSegments[2];
  if (!owner || !repo || !skill) {
    return undefined;
  }
  return sourceFromSegments(owner, repo, skill);
}

/**
 * For an `https:` URL on `expectedHostname`, return its decoded path segments.
 * Returns `undefined` for any other protocol or host. Consolidates the
 * protocol/host guard plus path-split/decode block shared by skills.sh and
 * GitHub source-URL parsing.
 */
export function httpsPathSegments(url: URL, expectedHostname: string): (string | undefined)[] | undefined {
  if (url.protocol !== "https:" || url.hostname !== expectedHostname) {
    return undefined;
  }
  return url.pathname.split("/").filter(Boolean).map((segment) => safeDecodeURIComponent(segment));
}

export function parseSkillsShUrl(urlValue: string | undefined): SkillsShSource | undefined {
  if (!urlValue) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(urlValue.trim());
  } catch {
    return undefined;
  }

  const pathSegments = httpsPathSegments(url, "skills.sh");
  if (!pathSegments || pathSegments.length !== 3) {
    return undefined;
  }

  const [owner, repo, skill] = pathSegments;
  return sourceFromSegments(owner, repo, skill);
}

export function parseSkillsShReference(reference: string | undefined): SkillsShSource | undefined {
  return parseSkillsShIdentifier(reference) ?? parseSkillsShUrl(reference);
}

export function skillsShIdentifier(source: SkillsShSource): string {
  return `${source.owner}/${source.repo}@${source.skill}`;
}

export function skillsShApiId(source: SkillsShSource): string {
  return `${source.owner}/${source.repo}/${source.skill}`;
}

export function skillsShDetailUrl(source: SkillsShSource, detailBaseUrl = "https://skills.sh"): string {
  const url = new URL(
    `/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${encodeURIComponent(source.skill)}`,
    detailBaseUrl,
  );
  return url.toString().replace(/\/$/u, "");
}
