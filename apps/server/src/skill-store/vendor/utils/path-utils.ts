import { posix, relative, resolve, sep, win32 } from "node:path";
import { SkillHubError } from "./errors.js";

export interface SafeLocalSkillPath {
  skillName: string;
  targetPath: string;
}

export type SafeLocalSkillPathResult =
  | { ok: true; value: SafeLocalSkillPath }
  | { ok: false; reason: string };

export type PathKeyPlatform = NodeJS.Platform | "posix";

const PATH_SEPARATOR_PATTERN = /[\\/]/u;
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[a-zA-Z]:/u;
const WINDOWS_RESERVED_PATH_CHARS_PATTERN = /[<>:"|?*\x00-\x1F]/u;
const WINDOWS_RESERVED_BASENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const TRAILING_WINDOWS_UNSAFE_PATTERN = /[. ]$/u;

export function normalizePathForKey(pathValue: string, platform: PathKeyPlatform = process.platform): string {
  const resolvedPath = resolve(pathValue);
  return platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

export function isPathInside(childPath: string, parentPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
}

export function canonicalizeSkillName(name: string): string {
  return name.trim().normalize("NFC");
}

function normalizedRawSkillName(name: string): string {
  return name.normalize("NFC");
}

export function resolveSafeLocalSkillPath(localSkillRoot: string, name: string): SafeLocalSkillPathResult {
  const normalizedName = normalizedRawSkillName(name);
  const skillName = canonicalizeSkillName(name);
  if (skillName.length === 0) {
    return { ok: false, reason: "Skill name cannot be empty." };
  }
  if (normalizedName !== skillName) {
    return { ok: false, reason: "Skill name must not contain leading or trailing whitespace." };
  }
  if (skillName === "." || skillName === "..") {
    return { ok: false, reason: "Skill name must be a direct directory name, not a relative path segment." };
  }
  if (TRAILING_WINDOWS_UNSAFE_PATTERN.test(skillName)) {
    return { ok: false, reason: "Skill name must not end with a space or dot because those names are unsafe on Windows." };
  }
  if (WINDOWS_RESERVED_BASENAME_PATTERN.test(skillName)) {
    return { ok: false, reason: "Skill name uses a Windows reserved device basename." };
  }
  if (PATH_SEPARATOR_PATTERN.test(skillName)) {
    return { ok: false, reason: "Skill name must not contain path separators." };
  }
  if (posix.isAbsolute(skillName) || win32.isAbsolute(skillName) || WINDOWS_DRIVE_PREFIX_PATTERN.test(skillName)) {
    return { ok: false, reason: "Skill name must not be an absolute or drive-qualified path." };
  }
  if (WINDOWS_RESERVED_PATH_CHARS_PATTERN.test(skillName)) {
    return { ok: false, reason: "Skill name contains characters that are not safe for cross-platform directory names." };
  }

  const targetPath = resolve(localSkillRoot, skillName);
  if (!isPathInside(targetPath, localSkillRoot)) {
    return { ok: false, reason: "Resolved skill target must stay inside the local skill root." };
  }

  return { ok: true, value: { skillName, targetPath } };
}

export function toDisplayPath(pathValue: string): string {
  return resolve(pathValue);
}

/**
 * Resolves `relativePath` against `rootPath` and rejects escapes outside the
 * root. Throws `SkillHubError` with `errorPrefix` + the offending relative
 * path when the resolved target leaves the root. Shared by skills.sh download
 * staging and GitHub provider staging to avoid parallel path-safety helpers.
 */
export function safeResolvedPath(rootPath: string, relativePath: string, errorPrefix: string): string {
  const resolvedPath = resolve(rootPath, relativePath);
  if (!isPathInside(resolvedPath, rootPath)) {
    throw new SkillHubError(`${errorPrefix}: ${relativePath}`);
  }
  return resolvedPath;
}
