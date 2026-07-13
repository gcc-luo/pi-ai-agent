import type { SkillsShProviderConfig } from "../config/config.js";
import type { CommandRunner, CommandRunnerResult, ProviderId, SearchMode, SkillSearchResult } from "../types.js";
import { buildSkillsFindCommand, type SkillsCliCommand } from "../commands/skills-command.js";
import { SkillHubError } from "../utils/errors.js";
import { sanitizeTerminalText } from "../utils/terminal-text.js";
import {
  defaultSkillsShHttpClient,
  parseSkillsShJsonObject,
  type SkillsShHttpClient,
} from "./skills-sh-download.js";
import {
  parseSkillsShIdentifier,
  skillsShApiId,
  skillsShDetailUrl,
  skillsShIdentifier,
  type SkillsShSource,
} from "./skills-sh-identifiers.js";
import { sourceReferenceFromSkillsShSource } from "../utils/source-reference.js";
import { numericPopularity, parseCompactNumber } from "./provider-numbers.js";
import { createSkillProvider, type SkillProvider } from "./provider-types.js";

interface SkillsShRawResult {
  id?: string;
  skillId?: string;
  slug?: string;
  name?: string;
  title?: string;
  author?: string;
  owner?: string;
  source?: string;
  description?: string;
  summary?: string;
  installs?: number | string;
  installCount?: number | string;
  stars?: number;
  url?: string;
  skillUrl?: string;
  installUrl?: string;
  githubUrl?: string;
  html_url?: string;
}

interface SkillsShProviderRuntimeConfig extends SkillsShProviderConfig {
  timeoutMs: number;
}

const NO_RESULTS_REGEX = /No skills found for\s+["“]?/iu;
const DEFAULT_CONFIG: SkillsShProviderRuntimeConfig = {
  apiBaseUrl: "https://skills.sh",
  downloadBaseUrl: "https://skills.sh",
  detailBaseUrl: "https://skills.sh",
  transport: "api",
  cliCompatibility: false,
  timeoutMs: 10_000,
};

function runtimeConfig(timeoutMs: number, config?: Partial<SkillsShProviderConfig> | undefined): SkillsShProviderRuntimeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    timeoutMs,
  };
}

function normalizeSourceRepo(source: string | undefined): string | undefined {
  if (!source) {
    return undefined;
  }
  const githubMatch = source.match(/(?:github[:/]+|https:\/\/github\.com\/)?([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/iu);
  return githubMatch?.[1];
}

function sourceFromRawResult(item: SkillsShRawResult): SkillsShSource | undefined {
  const parsedId = parseSkillsShIdentifier(item.id) ?? parseSkillsShIdentifier(item.installUrl) ?? parseSkillsShIdentifier(item.skillUrl ?? item.url);
  if (parsedId) {
    return parsedId;
  }

  const sourceRepo = normalizeSourceRepo(item.source);
  const skill = item.skillId ?? item.slug ?? item.id ?? item.name;
  const repoParts = sourceRepo?.split("/") ?? [];
  if (repoParts.length !== 2 || !skill) {
    return undefined;
  }
  return parseSkillsShIdentifier(`${repoParts[0]}/${repoParts[1]}@${skill}`);
}

function resultFromSource(
  source: SkillsShSource,
  installs: number,
  description?: string | undefined,
  url?: string | undefined,
  displayName?: string | undefined,
  author?: string | undefined,
  detailBaseUrl?: string | undefined,
): SkillSearchResult {
  const sourceReference = sourceReferenceFromSkillsShSource(source);
  const identifier = skillsShIdentifier(source);
  const sourceUrl = url ?? skillsShDetailUrl(source, detailBaseUrl);
  return {
    id: identifier,
    name: displayName && displayName.trim().length > 0 ? displayName : source.skill,
    author: author && author.trim().length > 0 ? author : sourceReference.owner ?? source.owner,
    description: description && description.trim().length > 0 ? description : `skills.sh skill from ${source.owner}/${source.repo}`,
    popularity: installs,
    provider: "skills-sh" satisfies ProviderId,
    sourceUrl,
    sourceOwner: sourceReference.owner,
    sourceRepository: sourceReference.repository,
    sourcePath: source.skill,
    installHint: `skills.sh API source ${skillsShApiId(source)}`,
    installReference: identifier,
  };
}

function resultFromIdentifier(identifier: string, installs: number, description?: string, url?: string): SkillSearchResult | undefined {
  const source = parseSkillsShIdentifier(identifier);
  return source ? resultFromSource(source, installs, description, url) : undefined;
}

function jsonItemsFromPayload(parsed: unknown): unknown[] | undefined {
  const container = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  return Array.isArray(parsed)
    ? parsed
    : Array.isArray(container?.results)
      ? container.results
      : Array.isArray(container?.skills)
        ? container.skills
        : undefined;
}

function parseJsonPayload(parsed: unknown, detailBaseUrl?: string | undefined): SkillSearchResult[] | undefined {
  const items = jsonItemsFromPayload(parsed);
  if (!items) {
    return undefined;
  }

  const results: SkillSearchResult[] = [];
  for (const item of items.filter((entry): entry is SkillsShRawResult => Boolean(entry && typeof entry === "object"))) {
    const source = sourceFromRawResult(item);
    if (!source) {
      continue;
    }
    const installs = numericPopularity(item.installs ?? item.installCount ?? item.stars);
    const sourceUrl = item.skillUrl ?? item.url ?? item.installUrl ?? item.githubUrl ?? item.html_url;
    results.push(resultFromSource(
      source,
      installs,
      item.description ?? item.summary,
      sourceUrl,
      item.title ?? item.name,
      item.author ?? item.owner,
      detailBaseUrl,
    ));
  }
  return results;
}

function parseJsonResults(cleaned: string): SkillSearchResult[] | undefined {
  try {
    return parseJsonPayload(JSON.parse(cleaned) as unknown);
  } catch {
    return undefined;
  }
}

export function parseSkillsShOutput(stdout: string): SkillSearchResult[] {
  const cleaned = sanitizeTerminalText(stdout);
  const jsonResults = parseJsonResults(cleaned);
  if (jsonResults) {
    return jsonResults;
  }

  const results: SkillSearchResult[] = [];
  const lines = cleaned.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const compactMatch = line.match(/^(\S+\/\S+@\S+|\S+\/\S+\/\S+)\s+([\d.]+[KMB]?)\s+installs?$/iu);
    if (compactMatch) {
      const nextLine = lines[index + 1]?.replace(/^└\s*/u, "");
      const result = resultFromIdentifier(compactMatch[1] ?? "", parseCompactNumber(compactMatch[2] ?? "0"), undefined, nextLine);
      if (result) {
        results.push(result);
      }
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s*(\S+\/\S+@\S+|\S+\/\S+\/\S+)\s*[-–—]\s*(.+)$/u);
    if (numberedMatch) {
      const result = resultFromIdentifier(numberedMatch[1] ?? "", 0, numberedMatch[2]);
      if (result) {
        results.push(result);
      }
    }
  }

  return results.filter((item) => item.id.length > 0);
}

function isStructuredEmptyOutput(stdout: string): boolean {
  const cleaned = sanitizeTerminalText(stdout).trim();
  if (!cleaned) {
    return false;
  }

  try {
    const items = jsonItemsFromPayload(JSON.parse(cleaned) as unknown);
    return Array.isArray(items) && items.length === 0;
  } catch {
    return false;
  }
}

function isExpectedEmptySearch(result: CommandRunnerResult): boolean {
  const output = sanitizeTerminalText(`${result.stdout}\n${result.stderr}`);
  return NO_RESULTS_REGEX.test(output) || isStructuredEmptyOutput(result.stdout);
}

function firstFailureLine(result: CommandRunnerResult): string | undefined {
  return sanitizeTerminalText(`${result.stderr}\n${result.stdout}`)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function formatFailure(result: CommandRunnerResult): string {
  const detail = firstFailureLine(result);
  return detail
    ? `skills.sh CLI compatibility search failed with exit code ${String(result.code)}: ${detail}`
    : `skills.sh CLI compatibility search failed with exit code ${String(result.code)}.`;
}

function resultsFromCommandResult(result: CommandRunnerResult, limit: number): SkillSearchResult[] {
  const parsed = parseSkillsShOutput(result.stdout).slice(0, limit);
  if (parsed.length > 0) {
    return parsed;
  }

  if (isExpectedEmptySearch(result)) {
    return [];
  }

  if (result.code !== 0) {
    throw new SkillHubError(formatFailure(result));
  }

  return [];
}

export function buildSkillsShFindCommand(query: string): SkillsCliCommand {
  return buildSkillsFindCommand(query);
}

function searchUrl(config: SkillsShProviderRuntimeConfig, query: string, limit: number): URL {
  const url = new URL("/api/search", config.apiBaseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  return url;
}

function formatApiFailure(url: URL, statusCode: number, body: string): string {
  const trimmed = sanitizeTerminalText(body).trim();
  const detail = trimmed.length > 0 ? `: ${trimmed.slice(0, 300)}` : "";
  return `skills.sh API search failed with HTTP ${String(statusCode)} for ${url.hostname}${url.pathname}${detail}`;
}

async function searchWithApi(
  query: string,
  limit: number,
  config: SkillsShProviderRuntimeConfig,
  httpClient: SkillsShHttpClient,
): Promise<SkillSearchResult[]> {
  const url = searchUrl(config, query, limit);
  const response = await httpClient({
    url,
    accept: "application/json",
    timeoutMs: config.timeoutMs,
    apiKey: config.apiKey,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new SkillHubError(formatApiFailure(url, response.statusCode, response.body));
  }
  const parsed = parseSkillsShJsonObject(response.body, `search ${query}`);
  const results = parseJsonPayload(parsed, config.detailBaseUrl);
  if (!results) {
    throw new SkillHubError("skills.sh API search response did not contain a skills or results array.");
  }
  return results.slice(0, limit);
}

async function searchWithCli(runner: CommandRunner, query: string, limit: number, config: SkillsShProviderRuntimeConfig): Promise<SkillSearchResult[]> {
  if (!config.cliCompatibility) {
    throw new SkillHubError("skills.sh CLI compatibility mode is disabled. Set skillsSh.cliCompatibility=true and skillsSh.transport='cli' to use the npm-delivered CLI search path.");
  }
  const command = buildSkillsShFindCommand(query);
  const result = await runner.run(command.command, command.args, { timeoutMs: config.timeoutMs });
  return resultsFromCommandResult(result, limit);
}

export function createSkillsShProvider(
  runner: CommandRunner,
  timeoutMs: number,
  config?: Partial<SkillsShProviderConfig> | undefined,
  httpClient: SkillsShHttpClient = defaultSkillsShHttpClient,
): SkillProvider {
  const providerConfig = runtimeConfig(timeoutMs, config);
  return createSkillProvider({
    id: "skills-sh",
    name: providerConfig.transport === "cli" ? "skills.sh (CLI compatibility)" : "skills.sh",
    requiresAuth: false,
    isAvailable: () => providerConfig.transport === "api" || providerConfig.cliCompatibility,
    search: async (query: string, _mode: SearchMode, limit: number): Promise<SkillSearchResult[]> => {
      if (providerConfig.transport === "cli") {
        return searchWithCli(runner, query, limit, providerConfig);
      }
      return searchWithApi(query, limit, providerConfig, httpClient);
    },
  });
}
