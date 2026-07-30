import fs from "node:fs/promises";
import path from "node:path";

const ARTIFACTS_RE = /<artifacts>\s*([\s\S]*?)\s*<\/artifacts>/g;
const MAX_ARTIFACTS = 50;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_SIZE_BYTES = 100 * 1024 * 1024;

interface DeclaredArtifact {
  path: string;
  name: string;
}

export interface WeChatReplyFile {
  data: Buffer;
  fileName: string;
}

export interface WeChatAgentReply {
  text: string;
  files: WeChatReplyFile[];
  failedFiles: string[];
  failedDeclarations: number;
}

type ArtifactLogger = (data: Record<string, unknown>, message: string) => void;

function parseArtifactDeclarations(content: string): {
  text: string;
  items: DeclaredArtifact[];
  failedDeclarations: number;
} {
  const items: DeclaredArtifact[] = [];
  let failedDeclarations = 0;
  let text = content.replace(ARTIFACTS_RE, (_match, json: string) => {
    try {
      const parsed: unknown = JSON.parse(json.trim());
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const record = entry as Record<string, unknown> | null;
          if (
            record
            && typeof record === "object"
            && typeof record.path === "string"
            && typeof record.name === "string"
          ) {
            items.push({
              path: record.path,
              name: record.name,
            });
          } else {
            failedDeclarations++;
          }
        }
      } else {
        failedDeclarations++;
      }
    } catch {
      failedDeclarations++;
    }
    return "";
  });

  // A truncated final block has no closing tag, so the main regex cannot
  // consume it. The protocol requires artifact declarations at the end.
  const danglingBlock = text.indexOf("<artifacts>");
  if (danglingBlock >= 0) {
    text = text.slice(0, danglingBlock);
    failedDeclarations++;
  }

  return { text: text.trimEnd(), items, failedDeclarations };
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function safeFileName(declaredName: string, artifactPath: string): string {
  const name = path.posix.basename(declaredName.replaceAll("\\", "/")).trim();
  const fallback = path.basename(artifactPath);
  let safe = name && name !== "." && name !== ".." ? name : fallback;
  safe = safe.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return truncateUtf8(safe || "artifact", 255);
}

/**
 * Parse final artifact declarations and load only regular files that resolve
 * inside the configured project workdir. realpath() also prevents symlinks
 * from escaping the project.
 */
export async function buildWeChatAgentReply(
  content: string,
  workdir: string,
  log?: ArtifactLogger,
): Promise<WeChatAgentReply> {
  const parsed = parseArtifactDeclarations(content);
  if (parsed.items.length === 0) {
    return {
      text: parsed.text || (
        parsed.failedDeclarations > 0
          ? "文件声明处理失败。"
          : "我暂时没有生成回复，请稍后再试。"
      ),
      files: [],
      failedFiles: [],
      failedDeclarations: parsed.failedDeclarations,
    };
  }

  const files: WeChatReplyFile[] = [];
  const failedFiles = parsed.items
    .slice(MAX_ARTIFACTS)
    .map((item) => safeFileName(item.name, item.path));
  const seen = new Set<string>();
  let totalSize = 0;
  if (parsed.items.length > MAX_ARTIFACTS) {
    log?.(
      { declaredCount: parsed.items.length, maxArtifacts: MAX_ARTIFACTS },
      "too many WeChat artifacts declared",
    );
  }
  let root: string;
  try {
    root = await fs.realpath(workdir);
  } catch (error) {
    log?.(
      { workdir, err: error instanceof Error ? error.message : String(error) },
      "failed to resolve WeChat artifact workdir",
    );
    return {
      text: parsed.text || "我暂时没有生成回复，请稍后再试。",
      files,
      failedFiles: parsed.items.map((item) => safeFileName(item.name, item.path)),
      failedDeclarations: parsed.failedDeclarations,
    };
  }

  for (const item of parsed.items.slice(0, MAX_ARTIFACTS)) {
    const fileName = safeFileName(item.name, item.path);
    if (!item.path || path.isAbsolute(item.path)) {
      failedFiles.push(fileName);
      log?.({ artifactPath: item.path }, "ignoring unsafe WeChat artifact path");
      continue;
    }

    try {
      const resolved = await fs.realpath(path.resolve(root, item.path));
      const relative = path.relative(root, resolved);
      if (
        !relative
        || relative === ".."
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)
      ) {
        failedFiles.push(fileName);
        log?.({ artifactPath: item.path }, "ignoring WeChat artifact outside project");
        continue;
      }
      if (seen.has(resolved)) continue;

      const stat = await fs.stat(resolved);
      if (!stat.isFile()) {
        failedFiles.push(fileName);
        log?.({ artifactPath: item.path }, "ignoring non-file WeChat artifact");
        continue;
      }
      if (stat.size > MAX_FILE_SIZE_BYTES || totalSize + stat.size > MAX_TOTAL_SIZE_BYTES) {
        failedFiles.push(fileName);
        log?.(
          { artifactPath: item.path, size: stat.size },
          "ignoring oversized WeChat artifact",
        );
        continue;
      }

      files.push({
        data: await fs.readFile(resolved),
        fileName,
      });
      totalSize += stat.size;
      seen.add(resolved);
    } catch (error) {
      failedFiles.push(fileName);
      log?.(
        { artifactPath: item.path, err: error instanceof Error ? error.message : String(error) },
        "failed to load WeChat artifact",
      );
    }
  }

  return {
    text: parsed.text || (files.length > 0 ? "已为你生成文件。" : "我暂时没有生成回复，请稍后再试。"),
    files,
    failedFiles,
    failedDeclarations: parsed.failedDeclarations,
  };
}
