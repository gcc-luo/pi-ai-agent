import { KbSearchHitDto, ChunkMeta } from "@pi-web-ui/shared";

export const KB_CONTEXT_START = "<!-- kb-context:start -->";
export const KB_CONTEXT_END = "<!-- kb-context:end -->";
export const KB_CONTEXT_BLOCK_RE = /<!-- kb-context:start -->[\s\S]*?<!-- kb-context:end -->\n*/g;

export interface InjectResult {
  contextBlock: string;
  chunkMap: Record<number, ChunkMeta>;
}

export function buildKbContext(hits: KbSearchHitDto[]): InjectResult {
  if (!hits.length) return { contextBlock: "", chunkMap: {} };

  const chunkMap: Record<number, ChunkMeta> = {};
  const lines: string[] = [
    KB_CONTEXT_START,
    "The following knowledge base passages have been retrieved for the user's question.",
    "Use them to ground your answer. When you reference a passage, mark it as [N].",
    "If the passages are insufficient, say so — do not fabricate content not present here.",
    "",
  ];

  hits.forEach((hit, i) => {
    const localId = i + 1;
    chunkMap[localId] = {
      chunkId: hit.chunkId,
      kbName: hit.kbName,
      fileName: hit.fileName,
      titlePath: hit.titlePath,
      pageStart: hit.pageStart,
      pageEnd: hit.pageEnd,
    };

    const meta: string[] = [`KB: ${hit.kbName}`, `File: ${hit.fileName}`];
    if (hit.titlePath) meta.push(`标题: ${hit.titlePath}`);
    if (hit.pageStart != null) {
      const page = hit.pageEnd && hit.pageEnd !== hit.pageStart
        ? `${hit.pageStart}-${hit.pageEnd}`
        : String(hit.pageStart);
      meta.push(`页码: ${page}`);
    }

    lines.push(`[${localId}] (${meta.join(" / ")})`);
    lines.push(hit.content);
    lines.push("");
  });

  lines.push(KB_CONTEXT_END);
  return { contextBlock: lines.join("\n"), chunkMap };
}
