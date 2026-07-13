import type { IncomingHttpHeaders } from "node:http";

function isGitHubApiUrl(url: URL): boolean {
  return url.hostname === "api.github.com";
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rateLimitReset(headers: IncomingHttpHeaders): string | undefined {
  const resetValue = firstHeaderValue(headers["x-ratelimit-reset"]);
  if (!resetValue) {
    return undefined;
  }
  const resetSeconds = Number.parseInt(resetValue, 10);
  if (!Number.isFinite(resetSeconds)) {
    return undefined;
  }
  return new Date(resetSeconds * 1000).toISOString();
}

function githubMessageFromBody(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const message = (parsed as Record<string, unknown>).message;
      return typeof message === "string" && message.trim().length > 0 ? message.trim() : undefined;
    }
  } catch {
    return undefined;
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 220) : undefined;
}

function configuredToken(githubApiKey: string | undefined): string | undefined {
  const trimmed = githubApiKey?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function githubAuthHint(githubApiKey: string | undefined): string {
  return configuredToken(githubApiKey)
    ? "The configured GitHub API key may lack repository access or may be rate-limited."
    : "Configure apiKeys.github in pi-skill-hub/config.json to increase GitHub API limits for Skill Hub update/source checks.";
}

export function githubRequestHeaders(url: URL, accept: string, userAgent: string, githubApiKey?: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    accept,
    "user-agent": userAgent,
  };
  const token = isGitHubApiUrl(url) ? configuredToken(githubApiKey) : undefined;
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers["x-github-api-version"] = "2022-11-28";
  }
  return headers;
}

export function formatGithubHttpError(
  url: URL,
  statusCode: number,
  body: string,
  headers: IncomingHttpHeaders,
  githubApiKey?: string | undefined,
): string {
  const base = `Remote request failed with HTTP ${String(statusCode)} for ${url.hostname}${url.pathname}.`;
  if (!isGitHubApiUrl(url)) {
    return base;
  }

  const message = githubMessageFromBody(body);
  const remaining = firstHeaderValue(headers["x-ratelimit-remaining"]);
  const resetAt = rateLimitReset(headers);
  const details = [
    message ? `GitHub said: ${message}.` : undefined,
    remaining === "0" ? `Rate limit resets at ${resetAt ?? "the time reported by GitHub"}.` : undefined,
    statusCode === 403 ? githubAuthHint(githubApiKey) : undefined,
  ].filter((part): part is string => Boolean(part));

  return details.length > 0 ? `${base} ${details.join(" ")}` : base;
}
