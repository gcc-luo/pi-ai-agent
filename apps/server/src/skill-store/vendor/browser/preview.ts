import { request } from "node:https";
import type {
  SkillContentPreview,
  SkillPreviewAudit,
  SkillPreviewAuditStatus,
  SkillPreviewMetadata,
  SkillSearchResult,
} from "../types.js";
import { parseSkillsShReference, parseSkillsShUrl, skillsShDetailUrl, type SkillsShSource } from "../providers/skills-sh-identifiers.js";
import { extractSkillsShMarkdownFromPayload, parseSkillsShJsonObject, skillsShDownloadUrl } from "../providers/skills-sh-download.js";
import { parseCompactNumberStrict } from "../providers/provider-numbers.js";
import { githubRequestHeaders } from "../utils/github-http.js";
import { collectHttpResponse, optionalResponseBody } from "../utils/http-stream.js";
import { parseGithubSourceUrl, rawGithubSkillMarkdownUrl, type GithubSource } from "../utils/source-reference.js";
import { sanitizeTerminalText } from "../utils/terminal-text.js";

const USER_AGENT = "pi-skill-hub/0.1.0";
const PREVIEW_TIMEOUT_MS = 8_000;
const AUDIT_LABELS = ["Agent Trust Hub", "Socket", "Snyk"] as const;
/**
 * Maximum allowed length for a dynamic label pattern in {@link parseLabeledCompactNumber}.
 * Patterns above this limit are rejected (returning `undefined`) to mitigate ReDoS risk from
 * oversized attacker-controlled labelPattern inputs. The largest legitimate internal label
 * pattern is ~20 chars (`weekly\\s+installs?`), so 200 provides ample headroom.
 */
const MAX_LABEL_PATTERN_LENGTH = 200;

interface PreviewHttpRequest {
  url: URL;
  accept: string;
  timeoutMs: number;
  githubApiKey?: string | undefined;
}

interface PreviewHttpResponse {
  statusCode: number;
  body: string;
}

export type PreviewHttpClient = (request: PreviewHttpRequest) => Promise<PreviewHttpResponse>;

function metadataStatus(metadata: Omit<SkillPreviewMetadata, "status">): SkillPreviewMetadata["status"] {
  const hasWeeklyInstalls = metadata.weeklyInstalls !== undefined;
  const hasStars = metadata.githubStars !== undefined;
  const hasAudits = metadata.securityAudits.length > 0;
  if (hasWeeklyInstalls && hasStars && hasAudits) {
    return "available";
  }
  if (hasWeeklyInstalls || hasStars || hasAudits) {
    return "partial";
  }
  return "unavailable";
}

function createPreviewMetadata(metadata: Omit<SkillPreviewMetadata, "status">): SkillPreviewMetadata {
  return { ...metadata, status: metadataStatus(metadata) };
}

function unavailableMetadata(skill: SkillSearchResult): SkillPreviewMetadata {
  return createPreviewMetadata({ provider: skill.provider, securityAudits: [] });
}

function metadataPreview(skill: SkillSearchResult, limitation: string, metadata = unavailableMetadata(skill)): SkillContentPreview {
  const source = skill.sourceUrl ? `\nSource: ${skill.sourceUrl}` : "";
  const github = skill.githubUrl && skill.githubUrl !== skill.sourceUrl ? `\nGitHub: ${skill.githubUrl}` : "";
  const popularity = metadata.weeklyInstalls ?? skill.popularity;
  return {
    title: skill.name,
    body: `${skill.description}\n\nProvider: ${skill.provider}\nPopularity: ${String(popularity)}${source}${github}`,
    source: "metadata",
    limitation,
    metadata,
  };
}

function parseSkillsShSource(skill: SkillSearchResult): SkillsShSource | undefined {
  return parseSkillsShReference(skill.installReference) ?? parseSkillsShReference(skill.id) ?? parseSkillsShUrl(skill.sourceUrl);
}

function canonicalSkillsShDetailUrl(source: SkillsShSource): URL {
  return new URL(skillsShDetailUrl(source));
}

function defaultHttpClient(requestOptions: PreviewHttpRequest): Promise<PreviewHttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      requestOptions.url,
      {
        method: "GET",
        headers: githubRequestHeaders(requestOptions.url, requestOptions.accept, USER_AGENT, requestOptions.githubApiKey),
      },
      (res) => {
        collectHttpResponse(res, resolve);
      },
    );
    req.setTimeout(requestOptions.timeoutMs, () => {
      req.destroy(new Error(`Preview request timed out after ${String(requestOptions.timeoutMs)}ms.`));
    });
    req.on("error", reject);
    req.end();
  });
}

export function createPreviewHttpClient(githubApiKey?: string | undefined): PreviewHttpClient {
  return (requestOptions) => defaultHttpClient({ ...requestOptions, githubApiKey });
}

async function requestOptionalText(url: URL, accept: string, httpClient: PreviewHttpClient): Promise<string | undefined> {
  try {
    return optionalResponseBody(await httpClient({ url, accept, timeoutMs: PREVIEW_TIMEOUT_MS }));
  } catch {
    return undefined;
  }
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchSkillsShDownloadMarkdown(source: SkillsShSource, httpClient: PreviewHttpClient): Promise<string | undefined> {
  const text = await requestOptionalText(skillsShDownloadUrl(source), "application/json", httpClient);
  if (!text) {
    return undefined;
  }
  try {
    return extractSkillsShMarkdownFromPayload(parseSkillsShJsonObject(text, `preview ${source.owner}/${source.repo}@${source.skill}`), source);
  } catch {
    return undefined;
  }
}

async function fetchSkillsShDetailHtml(source: SkillsShSource, httpClient: PreviewHttpClient): Promise<string | undefined> {
  return requestOptionalText(canonicalSkillsShDetailUrl(source), "text/html, */*;q=0.8", httpClient);
}

function extractBalancedDiv(html: string, startIndex: number): string | undefined {
  let depth = 0;
  const tagPattern = /<\/?div\b[^>]*>/giu;
  tagPattern.lastIndex = startIndex;
  let start = -1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[0];
    const index = match.index;
    if (!tag.startsWith("</")) {
      if (start < 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    depth -= 1;
    if (start >= 0 && depth === 0) {
      return html.slice(start, index + tag.length);
    }
  }
  return undefined;
}

function markdownTextFromInlineHtml(html: string): string {
  return visibleTextFromHtml(html).trim();
}

function htmlFragmentToMarkdown(fragment: string): string {
  const codeBlocks: string[] = [];
  let markdown = fragment
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/giu, (block) => {
      const code = decodeEntities(
        block
          .replace(/<span\b[^>]*class="[^"]*code-line[^"]*"[^>]*>/giu, "")
          .replace(/<\/span>/giu, "\n")
          .replace(/<br\s*\/?\s*>/giu, "\n")
          .replace(/<[^>]+>/gu, ""),
      ).replace(/\n{3,}/gu, "\n\n").trim();
      const token = `\n\n@@PI_SKILL_HUB_CODE_BLOCK_${String(codeBlocks.length)}@@\n\n`;
      codeBlocks.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
      return token;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_match, level: string, body: string) => `\n\n${"#".repeat(Number.parseInt(level, 10))} ${markdownTextFromInlineHtml(body)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_match, body: string) => `\n- ${markdownTextFromInlineHtml(body)}\n`)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/giu, (_match, body: string) => `\n\n${markdownTextFromInlineHtml(body)}\n\n`)
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");

  markdown = decodeEntities(markdown);
  for (const [index, code] of codeBlocks.entries()) {
    markdown = markdown.replace(`@@PI_SKILL_HUB_CODE_BLOCK_${String(index)}@@`, code);
  }
  return markdown
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function extractSkillsShRenderedMarkdown(html: string): string | undefined {
  const markerIndex = html.indexOf("SKILL.md");
  if (markerIndex < 0) {
    return undefined;
  }
  const proseMatch = /<div\b[^>]*class="[^"]*\bprose\b[^"]*"[^>]*>/iu.exec(html.slice(markerIndex));
  if (!proseMatch || proseMatch.index === undefined) {
    return undefined;
  }
  const startIndex = markerIndex + proseMatch.index;
  const fragment = extractBalancedDiv(html, startIndex);
  const markdown = fragment ? htmlFragmentToMarkdown(fragment) : undefined;
  return markdown && markdown.length > 0 ? markdown : undefined;
}

async function fetchGithubSkillMarkdown(source: GithubSource, httpClient: PreviewHttpClient): Promise<string | undefined> {
  const url = rawGithubSkillMarkdownUrl(source);
  if (!url) {
    return undefined;
  }
  const text = await requestOptionalText(url, "text/markdown, text/plain;q=0.9, */*;q=0.8", httpClient);
  return text && text.trim().length > 0 ? text : undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, '"');
}

function visibleTextFromHtml(html: string): string {
  return decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ").replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function parseLabeledCompactNumber(text: string, labelPattern: string): number | undefined {
  if (labelPattern.length > MAX_LABEL_PATTERN_LENGTH) {
    return undefined;
  }
  const pattern = new RegExp(`${labelPattern}\\s*[:\\-]?\\s*([\\d,.]+\\s*[KMB]?)`, "iu"); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- labelPattern is an internal constant, length-bounded above, and used only against short preview metadata text.
  const match = text.match(pattern);
  return match?.[1] ? parseCompactNumberStrict(match[1].replace(/\s+/gu, "")) : undefined;
}

export function parseWeeklyInstallsFromText(text: string): number | undefined {
  return parseLabeledCompactNumber(text, "weekly\\s+installs?");
}

export function parseGithubStarsFromText(text: string): number | undefined {
  const labeledStars = parseLabeledCompactNumber(text, "github\\s+stars?");
  if (labeledStars !== undefined) {
    return labeledStars;
  }

  const patterns = [
    /([\d,.]+\s*[KMB]?)\s*(?:github\s+)?stars?\b/iu,
    /stargazers_count["'\s:]+([\d,.]+)/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const stars = match?.[1] ? parseCompactNumberStrict(match[1].replace(/\s+/gu, "")) : undefined;
    if (stars !== undefined) {
      return stars;
    }
  }
  return undefined;
}

function normalizedAuditStatus(value: string): SkillPreviewAuditStatus {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("pass")) {
    return "pass";
  }
  if (normalized.startsWith("fail")) {
    return "fail";
  }
  if (normalized.startsWith("warn")) {
    return "warning";
  }
  return "unknown";
}

function escapedLabelPattern(label: string): string {
  return label.split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s+");
}

export function parseSecurityAuditsFromText(text: string): SkillPreviewAudit[] {
  const audits: SkillPreviewAudit[] = [];
  for (const label of AUDIT_LABELS) {
    const escaped = escapedLabelPattern(label);
    if (escaped.length > MAX_LABEL_PATTERN_LENGTH) {
      continue;
    }
    const pattern = new RegExp(`${escaped}.{0,80}?\\b(Pass(?:ed)?|Fail(?:ed)?|Warning|Unknown)\\b`, "iu"); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- escaped is derived from the internal AUDIT_LABELS constant; each part is escaped via replace(/[.*+?^${}()|[\]\\]/g) and length-bounded above.
    const match = text.match(pattern);
    if (match?.[1]) {
      audits.push({ label, status: normalizedAuditStatus(match[1]) });
    }
  }
  return audits;
}

export function parseSkillsShRenderedMetadata(html: string, provider: SkillSearchResult["provider"] = "skills-sh"): SkillPreviewMetadata {
  const text = visibleTextFromHtml(html);
  return createPreviewMetadata({
    provider,
    weeklyInstalls: parseWeeklyInstallsFromText(text),
    githubStars: parseGithubStarsFromText(text),
    securityAudits: parseSecurityAuditsFromText(text),
  });
}

async function fetchGithubStars(source: SkillsShSource, httpClient: PreviewHttpClient): Promise<number | undefined> {
  const text = await requestOptionalText(
    new URL(`https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`),
    "application/vnd.github+json",
    httpClient,
  );
  if (!text) {
    return undefined;
  }
  const parsed = parseJsonObject(text);
  const stars = parsed?.stargazers_count;
  return typeof stars === "number" && Number.isFinite(stars) ? stars : undefined;
}

async function buildSkillsShMetadata(
  skill: SkillSearchResult,
  source: SkillsShSource,
  detailHtml: string | undefined,
  httpClient: PreviewHttpClient,
): Promise<SkillPreviewMetadata> {
  const renderedMetadata = detailHtml ? parseSkillsShRenderedMetadata(detailHtml, skill.provider) : unavailableMetadata(skill);
  if (renderedMetadata.githubStars !== undefined) {
    return renderedMetadata;
  }

  const githubStars = await fetchGithubStars(source, httpClient);
  return createPreviewMetadata({
    provider: skill.provider,
    weeklyInstalls: renderedMetadata.weeklyInstalls,
    githubStars,
    securityAudits: renderedMetadata.securityAudits,
  });
}

export function buildMetadataPreview(skill: SkillSearchResult): SkillContentPreview {
  return metadataPreview(skill, "Full remote SKILL.md/README content is not safely exposed by this provider result.");
}

export async function buildRemotePreview(skill: SkillSearchResult, httpClient: PreviewHttpClient = defaultHttpClient): Promise<SkillContentPreview> {
  if (skill.provider === "skills-sh") {
    const source = parseSkillsShSource(skill);
    if (!source) {
      return buildMetadataPreview(skill);
    }

    const [downloadMarkdown, detailHtml] = await Promise.all([
      fetchSkillsShDownloadMarkdown(source, httpClient),
      fetchSkillsShDetailHtml(source, httpClient),
    ]);
    const metadata = await buildSkillsShMetadata(skill, source, detailHtml, httpClient);
    const markdown = downloadMarkdown ?? (detailHtml ? extractSkillsShRenderedMarkdown(detailHtml) : undefined);

    if (!markdown) {
      return metadataPreview(skill, "Remote SKILL.md was unavailable from skills.sh download and rendered detail sources; showing provider metadata instead.", metadata);
    }

    return {
      title: skill.name,
      body: markdown,
      source: "remote",
      metadata,
    };
  }

  if (skill.provider === "skillsmp" || skill.provider === "github") {
    const source = parseGithubSourceUrl(skill.githubUrl) ?? parseGithubSourceUrl(skill.sourceUrl);
    if (!source) {
      return buildMetadataPreview(skill);
    }

    const markdown = await fetchGithubSkillMarkdown(source, httpClient);
    if (!markdown) {
      return metadataPreview(skill, "Remote SKILL.md was unavailable from the safe GitHub source; showing provider metadata instead.");
    }

    return {
      title: skill.name,
      body: markdown,
      source: "remote",
      metadata: unavailableMetadata(skill),
    };
  }

  return buildMetadataPreview(skill);
}

function formatAuditStatus(audit: SkillPreviewAudit): string {
  return `${audit.label} ${audit.status}`;
}

export function formatPreviewMetadataTags(metadata: SkillPreviewMetadata): string {
  const weeklyInstalls = metadata.weeklyInstalls === undefined ? "Weekly installs: unavailable" : `Weekly installs: ${String(metadata.weeklyInstalls)}`;
  const stars = metadata.githubStars === undefined ? "GitHub stars: unavailable" : `GitHub stars: ${String(metadata.githubStars)}`;
  const audits = metadata.securityAudits.length > 0
    ? `Security audits: ${metadata.securityAudits.map(formatAuditStatus).join(", ")}`
    : "Security audits: unavailable";
  return [`Provider: ${metadata.provider}`, weeklyInstalls, stars, audits, `Metadata: ${metadata.status}`].join(" | ");
}

export function formatPreview(preview: SkillContentPreview): string {
  const lines = [`Preview: ${preview.title}`, formatPreviewMetadataTags(preview.metadata), preview.body.trim()];
  if (preview.limitation) {
    lines.push(`Limitation: ${preview.limitation}`);
  }
  return sanitizeTerminalText(lines.join("\n\n"));
}
