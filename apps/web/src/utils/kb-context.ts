export const KB_CONTEXT_BLOCK_RE = /<!-- kb-context:start -->[\s\S]*?<!-- kb-context:end -->\n*/g;

export function stripKbContext(text: string): string {
  return text.replace(KB_CONTEXT_BLOCK_RE, "").trim();
}

// Extract kbSearch metadata from a message's metadata
export interface KbSearchMeta {
  phase: string;
  query: string;
  kbIds: string[];
  fileIds?: string[];
  hits: { localId: number; chunkId: number; kbName: string; fileName: string; titlePath: string | null; pageStart: number | null; pageEnd: number | null }[];
  durationMs: number;
  timestamp: number;
}

export function getKbSearchMeta(metadata: Record<string, unknown> | null): KbSearchMeta | null {
  if (!metadata?.kbSearch) return null;
  return metadata.kbSearch as KbSearchMeta;
}

// Replace [N] citations in text with chip HTML
export function renderKbCitations(text: string, chunkMap: Record<number, { kbName: string; fileName: string; titlePath: string | null; pageStart: number | null; pageEnd: number | null }>): string {
  return text.replace(/\[([1-9][0-9]*)\]/g, (match, numStr) => {
    const id = parseInt(numStr, 10);
    const meta = chunkMap[id];
    if (!meta) return match; // not in map, leave as-is
    const parts = [meta.fileName];
    if (meta.titlePath) parts.push(meta.titlePath);
    if (meta.pageStart != null) {
      const page = meta.pageEnd && meta.pageEnd !== meta.pageStart
        ? `第 ${meta.pageStart}-${meta.pageEnd} 页`
        : `第 ${meta.pageStart} 页`;
      parts.push(page);
    }
    return `<span class="kb-citation-chip" data-chunk-id="${id}" title="${parts.join(' · ')}">📖 ${parts.join(' · ')}</span>`;
  });
}
