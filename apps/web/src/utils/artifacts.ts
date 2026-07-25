// Parse <artifacts> JSON blocks from assistant message text.
// The agent declares delivered files using this protocol:
//   <artifacts>
//   [{"path": "src/utils.ts", "name": "utils.ts", "mimeType": "text/typescript"}]
//   </artifacts>
// Multiple blocks are supported. The block is stripped from the visible text.

import type { ArtifactItem } from "@pi-web-ui/shared";

const ARTIFACTS_RE = /<artifacts>\s*([\s\S]*?)\s*<\/artifacts>/g;

export interface ParsedArtifacts {
  /** Text with <artifacts> blocks removed. */
  text: string;
  /** Parsed artifact declarations. */
  items: ArtifactItem[];
}

export function parseArtifacts(text: string): ParsedArtifacts {
  const items: ArtifactItem[] = [];
  const cleaned = text.replace(ARTIFACTS_RE, (_, json: string) => {
    try {
      const parsed = JSON.parse(json.trim());
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry && typeof entry.path === "string" && typeof entry.name === "string") {
            items.push({
              path: entry.path,
              name: entry.name,
              mimeType: typeof entry.mimeType === "string" ? entry.mimeType : "application/octet-stream",
            });
          }
        }
      }
    } catch {
      // Malformed JSON — silently ignore
    }
    return "";
  });
  return { text: cleaned.trimEnd(), items };
}
