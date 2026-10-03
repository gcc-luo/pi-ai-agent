import path from "node:path";

export type CoreToolRisk = "normal" | "sensitive" | "destructive";

export interface CoreToolRiskResult {
  risk: CoreToolRisk;
  reason: string;
}

export function classifyCoreToolRisk(input: {
  toolName: string;
  input: Record<string, unknown>;
  workdir: string;
}): CoreToolRiskResult {
  const toolName = input.toolName.toLowerCase();
  if (["read", "write", "edit"].includes(toolName)) {
    const candidate = input.input.path ?? input.input.filePath ?? input.input.file_path;
    if (typeof candidate !== "string" || !candidate.trim()) {
      return { risk: "sensitive", reason: "无法确定文件路径，需要确认" };
    }
    const resolvedWorkdir = path.resolve(input.workdir);
    const resolvedTarget = path.resolve(resolvedWorkdir, candidate);
    const relative = path.relative(resolvedWorkdir, resolvedTarget);
    const insideWorkdir = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    return insideWorkdir
      ? { risk: "normal", reason: "项目工作目录内的文件操作" }
      : { risk: "sensitive", reason: "访问项目工作目录之外的文件" };
  }

  if (toolName !== "bash") return { risk: "normal", reason: "普通工具操作" };
  const command = input.input.command ?? input.input.cmd;
  if (typeof command !== "string") return { risk: "sensitive", reason: "无法检查 Bash 命令，需要确认" };

  const destructiveReason = findDestructiveCommand(command);
  return destructiveReason
    ? { risk: "destructive", reason: destructiveReason }
    : { risk: "normal", reason: "普通 Bash 命令" };
}

function findDestructiveCommand(command: string): string | null {
  const segments = splitShellSegments(command);
  const wordsBySegment = segments.map(tokenizeShellSegment);

  for (const words of wordsBySegment) {
    const executableIndex = words.findIndex((word) => !["env", "command", "builtin"].includes(word));
    const executable = words[executableIndex]?.split("/").pop()?.toLowerCase();
    if (!executable) continue;
    const args = words.slice(executableIndex + 1).map((word) => word.toLowerCase());

    if (["sudo", "doas", "su", "pkexec"].includes(executable)) return "命令请求提升系统权限";
    if (["shutdown", "reboot", "halt", "poweroff", "init"].includes(executable)) return "命令会关闭或重启系统";
    if (/^mkfs(?:\.|$)/.test(executable) || ["diskutil", "format"].includes(executable)) return "命令会格式化磁盘或文件系统";
    if (executable === "rm" && args.some((arg) => /^-[^-]*r|^--recursive$/.test(arg) || arg.includes("recursive"))) {
      return "命令会递归删除文件";
    }
    if (["dd", "wipefs", "shred"].includes(executable)) return "命令会覆盖或清除数据";
  }

  if (hasDownloadedContentShellPipeline(command, segments)) return "命令会将下载内容交给 Shell 执行";
  return null;
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
