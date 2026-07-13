export interface SkillsCliCommand {
  command: string;
  args: string[];
}

const NPM_SKILLS_EXEC_PREFIX = ["exec", "--yes", "--package=skills", "--", "skills"] as const;
const CMD_SAFE_ARG_PATTERN = /^[A-Za-z0-9_./:=@+-]+$/u;

function validateSkillsArgument(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty.`);
  }
}

function quoteCmdArgument(value: string): string {
  if (value.length > 0 && CMD_SAFE_ARG_PATTERN.test(value)) {
    return value;
  }
  return `"${value.replace(/"/gu, "\"\"")}"`;
}

function buildWindowsNpmCommand(args: readonly string[]): SkillsCliCommand {
  const commandLine = ["npm", ...NPM_SKILLS_EXEC_PREFIX, ...args].map(quoteCmdArgument).join(" ");
  return {
    command: process.env.ComSpec?.trim() || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine],
  };
}

export function buildSkillsCliCommand(args: readonly string[]): SkillsCliCommand {
  if (args.length === 0) {
    throw new Error("At least one skills CLI argument is required.");
  }
  if (process.platform === "win32") {
    return buildWindowsNpmCommand(args);
  }
  return {
    command: "npm",
    args: [...NPM_SKILLS_EXEC_PREFIX, ...args],
  };
}

export function buildSkillsFindCommand(query: string): SkillsCliCommand {
  validateSkillsArgument(query, "Search query");
  return buildSkillsCliCommand(["find", query]);
}

export function buildSkillsAddCommand(installReference: string): SkillsCliCommand {
  validateSkillsArgument(installReference, "Install reference");
  return buildSkillsCliCommand(["add", installReference, "-g", "-y"]);
}
