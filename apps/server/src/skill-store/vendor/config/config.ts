import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONFIG_PATH,
  DEFAULT_EXTERNAL_SKILL_ROOTS,
  DEFAULT_LOCAL_SKILL_ROOT,
  DEFAULT_MAX_SEARCH_RESULTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_UPDATE_STAGING_ROOT,
} from "../constants.js";
import { ConfigValidationError, getErrorMessage } from "../utils/errors.js";

export type SkillsShTransport = "api" | "cli";

export interface SkillsShProviderConfig {
  apiBaseUrl: string;
  downloadBaseUrl: string;
  detailBaseUrl: string;
  apiKey?: string | undefined;
  transport: SkillsShTransport;
  cliCompatibility: boolean;
}

export interface SkillHubApiKeys {
  github?: string | undefined;
  skillsMp?: string | undefined;
  skillsSh?: string | undefined;
}

export interface SkillHubConfig {
  enabled: boolean;
  debug: boolean;
  localSkillRoot: string;
  externalSkillRoots: string[];
  providers: {
    skillsSh: boolean;
    skillsMp: boolean;
  };
  skillsSh: SkillsShProviderConfig;
  maxSearchResults: number;
  requestTimeoutMs: number;
  updateStagingRoot: string;
  apiKeys: SkillHubApiKeys;
}

export interface ConfigLoadResult {
  config: SkillHubConfig;
  warnings: string[];
}

type RawConfig = Partial<{
  enabled: unknown;
  debug: unknown;
  localSkillRoot: unknown;
  externalSkillRoots: unknown;
  providers: unknown;
  skillsSh: unknown;
  maxSearchResults: unknown;
  requestTimeoutMs: unknown;
  updateStagingRoot: unknown;
  apiKeys: unknown;
}>;

const DEFAULT_SKILLS_SH_CONFIG: SkillsShProviderConfig = {
  apiBaseUrl: "https://skills.sh",
  downloadBaseUrl: "https://skills.sh",
  detailBaseUrl: "https://skills.sh",
  transport: "api",
  cliCompatibility: false,
};

const DEFAULT_CONFIG: SkillHubConfig = {
  enabled: true,
  debug: false,
  localSkillRoot: DEFAULT_LOCAL_SKILL_ROOT,
  externalSkillRoots: DEFAULT_EXTERNAL_SKILL_ROOTS,
  providers: {
    skillsSh: true,
    skillsMp: true,
  },
  skillsSh: DEFAULT_SKILLS_SH_CONFIG,
  maxSearchResults: DEFAULT_MAX_SEARCH_RESULTS,
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  updateStagingRoot: DEFAULT_UPDATE_STAGING_ROOT,
  apiKeys: {},
};

function readJsonConfig(pathValue: string): RawConfig {
  if (!existsSync(pathValue)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(pathValue, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigValidationError("config.json must contain a JSON object.");
    }
    return parsed as RawConfig;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }
    throw new ConfigValidationError(`Unable to parse config.json: ${getErrorMessage(error)}`);
  }
}

function booleanValue(value: unknown, defaultValue: boolean, key: string, warnings: string[]): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  warnings.push(`${key} must be boolean; defaulting to ${String(defaultValue)}.`);
  return defaultValue;
}

function positiveIntegerValue(value: unknown, defaultValue: number, key: string, warnings: string[]): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  warnings.push(`${key} must be a positive integer; defaulting to ${String(defaultValue)}.`);
  return defaultValue;
}

function stringPathValue(value: unknown, defaultValue: string, key: string, warnings: string[]): string {
  if (value === undefined) {
    return resolve(defaultValue);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return resolve(value);
  }
  warnings.push(`${key} must be a non-empty string; defaulting to ${defaultValue}.`);
  return resolve(defaultValue);
}

function optionalSecretValue(value: unknown, key: string, warnings: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  warnings.push(`${key} must be a string when configured; ignoring invalid value.`);
  return undefined;
}

function stringPathArrayValue(value: unknown, defaultValue: string[], key: string, warnings: string[]): string[] {
  if (value === undefined) {
    return defaultValue.map((item) => resolve(item));
  }
  if (!Array.isArray(value)) {
    warnings.push(`${key} must be an array of paths; defaulting to configured external roots.`);
    return defaultValue.map((item) => resolve(item));
  }

  const paths = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (paths.length !== value.length) {
    warnings.push(`${key} contained invalid entries that were ignored.`);
  }
  return paths.map((item) => resolve(item));
}

function parseProviders(value: unknown, warnings: string[]): SkillHubConfig["providers"] {
  if (value === undefined) {
    return { ...DEFAULT_CONFIG.providers };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("providers must be an object; default provider settings were used.");
    return { ...DEFAULT_CONFIG.providers };
  }

  const record = value as Record<string, unknown>;
  return {
    skillsSh: booleanValue(record.skillsSh, DEFAULT_CONFIG.providers.skillsSh, "providers.skillsSh", warnings),
    skillsMp: booleanValue(record.skillsMp, DEFAULT_CONFIG.providers.skillsMp, "providers.skillsMp", warnings),
  };
}

function parseApiKeys(value: unknown, warnings: string[]): SkillHubApiKeys {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("apiKeys must be an object; provider/source API keys were ignored.");
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    github: optionalSecretValue(record.github, "apiKeys.github", warnings),
    skillsMp: optionalSecretValue(record.skillsMp, "apiKeys.skillsMp", warnings),
    skillsSh: optionalSecretValue(record.skillsSh, "apiKeys.skillsSh", warnings),
  };
}

function urlValue(value: unknown, defaultValue: string, key: string, warnings: string[]): string {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    warnings.push(`${key} must be an absolute HTTP(S) URL; defaulting to ${defaultValue}.`);
    return defaultValue;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ConfigValidationError(`${key} must use http or https.`);
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    warnings.push(`${key} must be an absolute HTTP(S) URL; defaulting to ${defaultValue}.`);
    return defaultValue;
  }
}

function transportValue(value: unknown, defaultValue: SkillsShTransport, key: string, warnings: string[]): SkillsShTransport {
  if (value === undefined) {
    return defaultValue;
  }
  if (value === "api" || value === "cli") {
    return value;
  }
  warnings.push(`${key} must be either 'api' or 'cli'; defaulting to ${defaultValue}.`);
  return defaultValue;
}

function parseSkillsShConfig(value: unknown, apiKeys: SkillHubApiKeys, warnings: string[]): SkillsShProviderConfig {
  if (value === undefined) {
    return { ...DEFAULT_SKILLS_SH_CONFIG, apiKey: apiKeys.skillsSh };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push("skillsSh must be an object; default skills.sh settings were used.");
    return { ...DEFAULT_SKILLS_SH_CONFIG, apiKey: apiKeys.skillsSh };
  }

  const record = value as Record<string, unknown>;
  const cliCompatibility = booleanValue(record.cliCompatibility, DEFAULT_SKILLS_SH_CONFIG.cliCompatibility, "skillsSh.cliCompatibility", warnings);
  const transport = transportValue(record.transport, DEFAULT_SKILLS_SH_CONFIG.transport, "skillsSh.transport", warnings);
  if (transport === "cli" && !cliCompatibility) {
    warnings.push("skillsSh.transport='cli' requires skillsSh.cliCompatibility=true; skills.sh provider will be unavailable until compatibility mode is explicitly enabled.");
  }

  return {
    apiBaseUrl: urlValue(record.apiBaseUrl, DEFAULT_SKILLS_SH_CONFIG.apiBaseUrl, "skillsSh.apiBaseUrl", warnings),
    downloadBaseUrl: urlValue(record.downloadBaseUrl, DEFAULT_SKILLS_SH_CONFIG.downloadBaseUrl, "skillsSh.downloadBaseUrl", warnings),
    detailBaseUrl: urlValue(record.detailBaseUrl, DEFAULT_SKILLS_SH_CONFIG.detailBaseUrl, "skillsSh.detailBaseUrl", warnings),
    apiKey: optionalSecretValue(record.apiKey, "skillsSh.apiKey", warnings) ?? apiKeys.skillsSh,
    transport,
    cliCompatibility,
  };
}

export function loadConfig(pathValue = CONFIG_PATH): ConfigLoadResult {
  const warnings: string[] = [];
  const raw = readJsonConfig(pathValue);
  const apiKeys = parseApiKeys(raw.apiKeys, warnings);

  return {
    config: {
      enabled: booleanValue(raw.enabled, DEFAULT_CONFIG.enabled, "enabled", warnings),
      debug: booleanValue(raw.debug, DEFAULT_CONFIG.debug, "debug", warnings),
      localSkillRoot: stringPathValue(raw.localSkillRoot, DEFAULT_CONFIG.localSkillRoot, "localSkillRoot", warnings),
      externalSkillRoots: stringPathArrayValue(
        raw.externalSkillRoots,
        DEFAULT_CONFIG.externalSkillRoots,
        "externalSkillRoots",
        warnings,
      ),
      providers: parseProviders(raw.providers, warnings),
      skillsSh: parseSkillsShConfig(raw.skillsSh, apiKeys, warnings),
      maxSearchResults: positiveIntegerValue(
        raw.maxSearchResults,
        DEFAULT_CONFIG.maxSearchResults,
        "maxSearchResults",
        warnings,
      ),
      requestTimeoutMs: positiveIntegerValue(
        raw.requestTimeoutMs,
        DEFAULT_CONFIG.requestTimeoutMs,
        "requestTimeoutMs",
        warnings,
      ),
      updateStagingRoot: stringPathValue(
        raw.updateStagingRoot,
        DEFAULT_CONFIG.updateStagingRoot,
        "updateStagingRoot",
        warnings,
      ),
      apiKeys,
    },
    warnings,
  };
}
