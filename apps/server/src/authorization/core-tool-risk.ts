import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CoreToolRisk = "normal" | "sensitive" | "destructive";

export interface CoreToolRiskResult {
  risk: CoreToolRisk;
  reason: string;
}

const SHELL_EXECUTABLES = new Set(["sh", "bash", "zsh"]);
const MAX_NESTED_SHELL_COMMANDS = 4;
const SAFE_SIMPLE_COMMANDS = new Set(["echo", "printf", "pwd", "true", "false"]);
const SCRIPT_RUNNERS = new Set(["pnpm", "npm", "yarn", "bun", "npx", "bunx"]);
const INFORMATIONAL_PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const FILE_TOOL_NAMES = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const DEFAULT_TO_CWD_FILE_TOOLS = new Set(["grep", "find", "ls"]);
const PI_UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export function classifyCoreToolRisk(input: {
  toolName: string;
  input: Record<string, unknown>;
  workdir: string;
}): CoreToolRiskResult {
  const toolName = input.toolName.toLowerCase();
  if (FILE_TOOL_NAMES.has(toolName)) {
    const candidate = input.input.path ?? input.input.filePath ?? input.input.file_path;
    if (candidate === undefined && DEFAULT_TO_CWD_FILE_TOOLS.has(toolName)) {
      return { risk: "normal", reason: "项目工作目录内的文件操作" };
    }
    if (typeof candidate !== "string" || !candidate.trim()) {
      return { risk: "sensitive", reason: "无法确定文件路径，需要确认" };
    }
    const containment = isPathWithinWorkdir(candidate, input.workdir);
    return containment === true
      ? { risk: "normal", reason: "项目工作目录内的文件操作" }
      : { risk: "sensitive", reason: containment === false ? "访问项目工作目录之外的文件" : "无法安全解析文件路径" };
  }

  if (toolName !== "bash") return { risk: "normal", reason: "普通工具操作" };
  const command = input.input.command ?? input.input.cmd;
  if (typeof command !== "string") return { risk: "sensitive", reason: "无法检查 Bash 命令，需要确认" };

  const commandRisk = classifyBashCommand(command);
  return commandRisk
    ? commandRisk
    : { risk: "normal", reason: "普通 Bash 命令" };
}

function isPathWithinWorkdir(target: string, workdir: string): boolean | null {
  try {
    const realWorkdir = fs.realpathSync(workdir);
    const normalizedTarget = normalizePiToolPath(target);
    if (normalizedTarget === null) return null;
    const absoluteTarget = path.resolve(workdir, normalizedTarget);
    const realTarget = resolveThroughExistingAncestor(absoluteTarget);
    if (!realTarget) return null;
    const relative = path.relative(realWorkdir, realTarget);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  } catch {
    return null;
  }
}

// Pi's built-in file tools normalize these forms before resolving a path.
// Mirror that behavior so the authorization boundary evaluates the same target
// the tool will open, including a file URL that cannot be decoded safely.
function normalizePiToolPath(target: string): string | null {
  let normalized = target.replace(PI_UNICODE_SPACES, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);

  if (process.platform === "win32" && normalized.startsWith("/") && !normalized.startsWith("//") && !normalized.includes("\\")) {
    const match = normalized.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (match) {
      const suffix = match[2]?.replaceAll("/", "\\");
      normalized = `${match[1]?.toUpperCase()}:\\${suffix ?? ""}`;
    }
  }

  if (normalized === "~") return os.homedir();
  if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
    normalized = path.join(os.homedir(), normalized.slice(2));
  }
  if (/^file:\/\//.test(normalized)) {
    try {
      normalized = fileURLToPath(normalized);
    } catch {
      return null;
    }
  }
  return normalized;
}

function resolveThroughExistingAncestor(absoluteTarget: string): string | null {
  let current = path.resolve(absoluteTarget);
  const remaining: string[] = [];
  while (true) {
    try {
      return path.resolve(fs.realpathSync(current), ...remaining);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      try {
        if (fs.lstatSync(current).isSymbolicLink()) return null;
      } catch (statError) {
        const statCode = (statError as NodeJS.ErrnoException).code;
        if (statCode !== "ENOENT" && statCode !== "ENOTDIR") return null;
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      remaining.unshift(path.basename(current));
      current = parent;
    }
  }
}

// This is a deliberately small conservative classifier, not a shell interpreter.
// Unknown commands and opaque syntax require review instead of being called safe.
function classifyBashCommand(command: string, depth = 0): CoreToolRiskResult | null {
  if (hasOpaqueShellConstruct(command)) {
    return { risk: "sensitive", reason: "Shell 包含命令替换或无法静态检查的语法" };
  }
  const segments = splitShellSegments(command);
  if (hasDownloadedContentShellPipeline(command, segments)) {
    return { risk: "destructive", reason: "命令会将下载内容交给 Shell 执行" };
  }
  const wordsBySegment = segments.map(tokenizeShellSegment);

  for (const words of wordsBySegment) {
    const executableIndex = findExecutableIndex(words);
    const executable = words[executableIndex]?.split("/").pop()?.toLowerCase();
    if (!executable) continue;
    const rawArgs = words.slice(executableIndex + 1);
    const args = rawArgs.map((word) => word.toLowerCase());

    const nestedCommand = getShellCommandPayload(executable, rawArgs);
    if (nestedCommand !== null) {
      if (depth >= MAX_NESTED_SHELL_COMMANDS) return { risk: "sensitive", reason: "Shell 命令嵌套过深，无法安全检查" };
      const nestedRisk = classifyBashCommand(nestedCommand, depth + 1);
      if (nestedRisk) return nestedRisk;
      continue;
    }

    if (["sudo", "doas", "su", "pkexec"].includes(executable)) return { risk: "destructive", reason: "命令请求提升系统权限" };
    if (["shutdown", "reboot", "halt", "poweroff", "init"].includes(executable)) return { risk: "destructive", reason: "命令会关闭或重启系统" };
    if (/^mkfs(?:\.|$)/.test(executable) || ["diskutil", "format"].includes(executable)) return { risk: "destructive", reason: "命令会格式化磁盘或文件系统" };
    if (executable === "rm" && args.some((arg) => /^-[^-]*r|^--recursive$/.test(arg) || arg.includes("recursive"))) {
      return { risk: "destructive", reason: "命令会递归删除文件" };
    }
    if (["dd", "wipefs", "shred"].includes(executable)) return { risk: "destructive", reason: "命令会覆盖或清除数据" };
    if (executable === "find" && args.includes("-delete")) {
      return { risk: "destructive", reason: "find 会删除文件" };
    }
    if (executable === "find" && args.some((arg) => ["-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"].includes(arg))) {
      return { risk: "sensitive", reason: "find 会执行嵌入命令或写入文件" };
    }
    if (SCRIPT_RUNNERS.has(executable)) {
      const exactInfoQuery = args.length === 1 && ["--version", "--help"].includes(args[0] ?? "");
      const informational = exactInfoQuery && (
        INFORMATIONAL_PACKAGE_MANAGERS.has(executable)
        || executable === "npx"
        || executable === "bunx"
      );
      const extendedInfoQuery = INFORMATIONAL_PACKAGE_MANAGERS.has(executable)
        && args.length === 1
        && ["-v", "-h", "help"].includes(args[0] ?? "");
      if (informational || extendedInfoQuery) continue;
      return { risk: "sensitive", reason: "包管理器会执行项目脚本或外部程序" };
    }
    if (["python", "python2", "python3", "node", "deno", "ruby", "perl", "php"].includes(executable)) {
      return { risk: "sensitive", reason: "解释器执行代码的影响无法静态确认" };
    }
    if (SAFE_SIMPLE_COMMANDS.has(executable)) continue;
    if (executable === "git" && ["status", "diff", "log", "show", "rev-parse"].includes(args[0] ?? "")) continue;
    if (executable === "find") continue;
    return { risk: "sensitive", reason: `无法确认命令 ${executable} 的操作范围` };
  }

  return null;
}

function findExecutableIndex(words: string[]): number {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    const lower = word.toLowerCase();
    if (/^[a-z_][a-z0-9_]*=.*/i.test(word)) { index += 1; continue; }
    if (lower === "env") {
      index += 1;
      while (index < words.length) {
        const option = (words[index] ?? "").toLowerCase();
        if (option === "--") { index += 1; break; }
        if (option === "-u" || option === "--unset" || option === "-c" || option === "--chdir") { index += 2; continue; }
        if (option.startsWith("--unset=") || option.startsWith("--chdir=")) { index += 1; continue; }
        if (option.startsWith("-") && !/^[a-z_][a-z0-9_]*=.*/i.test(option)) { index += 1; continue; }
        if (/^[a-z_][a-z0-9_]*=.*/i.test(option)) { index += 1; continue; }
        break;
      }
      continue;
    }
    if (["command", "builtin", "exec", "nohup", "time"].includes(lower)) { index += 1; continue; }
    return index;
  }
  return index;
}

function getShellCommandPayload(executable: string, args: string[]): string | null {
  if (!SHELL_EXECUTABLES.has(executable)) return null;
  for (let i = 0; i < args.length; i += 1) {
    const option = args[i];
    if (!option) continue;
    if (option === "--command" || option === "-c" || (/^-[^-]+$/.test(option) && option.slice(1).includes("c"))) {
      return args[i + 1] ?? "";
    }
  }
  return null;
}

function hasOpaqueShellConstruct(command: string): boolean {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] ?? "";
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"') { quote = null; continue; }
      if (char === "`" || (char === "$" && command[i + 1] === "(")) return true;
      continue;
    }
    if (char === "'" && quote === null) { quote = "'"; continue; }
    if (char === '"' && quote === null) { quote = '"'; continue; }
    if (char === "`") return true;
    if (char === "$" && command[i + 1] === "(") return true;
    if ((char === ">" || char === "<") && command[i + 1] !== "|") return true;
  }
  return false;
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { current += char; escaped = true; continue; }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; current += char; continue; }
    if (char === ";" || char === "\n" || char === "|" || char === "&") {
      segments.push(current.trim());
      current = "";
      if (command[i + 1] === char) i += 1;
      continue;
    }
    current += char;
  }
  segments.push(current.trim());
  return segments.filter(Boolean);
}

function tokenizeShellSegment(segment: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (const char of segment) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (/\s/.test(char)) {
      if (current) { words.push(current); current = ""; }
      continue;
    }
    current += char;
  }
  if (current) words.push(current);
  return words;
}

function hasDownloadedContentShellPipeline(command: string, segments: string[]): boolean {
  if (!command.includes("|") || segments.length < 2) return false;
  const parsed = segments.map(tokenizeShellSegment);
  for (let i = 0; i < parsed.length - 1; i += 1) {
    const source = (parsed[i] ?? []).map((word) => word.toLowerCase());
    const sink = (parsed[i + 1] ?? []).map((word) => word.toLowerCase());
    const downloads = source.some((word) => ["curl", "wget", "fetch", "aria2c"].includes(word.split("/").pop() ?? ""));
    const shell = sink.some((word) => ["sh", "bash", "zsh", "fish"].includes((word.split("/").pop() ?? "").replace(/[^a-z].*$/, "")));
    if (downloads && shell) return true;
  }
  return false;
}
