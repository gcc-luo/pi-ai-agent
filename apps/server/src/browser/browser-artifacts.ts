import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactItem } from "@pi-web-ui/shared";

/** Expose only verified workspace files, never upstream temp spills or saved credentials. */
export async function browserArtifacts(
  details: Record<string, unknown>,
  cwd: string,
): Promise<(ArtifactItem & { source: string })[]> {
  const manifest = details.artifactManifest as
    | { entries?: Record<string, unknown>[] }
    | undefined;
  const entries = [
    ...(Array.isArray(details.artifacts) ? details.artifacts : []),
    ...(manifest?.entries ?? []),
  ];
  const root = await fs.realpath(cwd);
  const found = new Map<string, ArtifactItem & { source: string }>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (
      entry.kind === "spill" ||
      entry.command === "state" ||
      entry.command === "auth" ||
      entry.exists === false ||
      entry.retentionState === "evicted"
    )
      continue;
    const candidate = entry.absolutePath ?? entry.path;
    if (typeof candidate !== "string") continue;
    try {
      const real = await fs.realpath(path.resolve(root, candidate));
      const relative = path.relative(root, real);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        continue;
      if (!(await fs.stat(real)).isFile()) continue;
      const ext = path.extname(real).toLowerCase();
      const mime = (
        {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".pdf": "application/pdf",
          ".webm": "video/webm",
          ".mp4": "video/mp4",
          ".json": "application/json",
        } as Record<string, string>
      )[ext];
      const filePath = relative.split(path.sep).join("/");
      found.set(filePath, {
        path: filePath,
        name: path.basename(real),
        mimeType: mime ?? "application/octet-stream",
        source: "agent_browser",
      });
    } catch {
      /* Missing or inaccessible files are not deliverables. */
    }
  }
  return [...found.values()];
}
