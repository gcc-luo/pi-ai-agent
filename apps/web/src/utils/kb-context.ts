import { useI18n } from "../i18n/index.js";
import type { KbSearchDiagnostics } from "@pi-web-ui/shared";

const { t } = useI18n();

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
  hits: {
    localId: number;
    chunkId: number;
    kbId?: string;
    fileId?: string;
    segmentId?: string;
    revision?: number;
    kbName: string;
    fileName: string;
    titlePath: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    modality?: "text" | "image" | "video" | "audio";
  }[];
  durationMs: number;
  diagnostics?: KbSearchDiagnostics;
  timestamp: number;
}

export interface KbCitationMeta {
  localId: number;
  chunkId: number;
  kbId?: string;
  fileId?: string;
  segmentId?: string;
  revision?: number;
  kbName: string;
  fileName: string;
  titlePath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  modality?: "text" | "image" | "video" | "audio";
  timeStartMs?: number | null;
  timeEndMs?: number | null;
  content?: string;
}

export function getKbSearchMeta(metadata: Record<string, unknown> | null): KbSearchMeta | null {
  if (!metadata?.kbSearch) return null;
  return metadata.kbSearch as KbSearchMeta;
}

// Replace [N] citations in text with chip HTML
export function renderKbCitations(text: string, chunkMap: Record<number, KbCitationMeta>): string {
  return text.replace(/\[([1-9][0-9]*)\]/g, (match, numStr) => {
    const id = parseInt(numStr, 10);
    const meta = chunkMap[id];
    if (!meta) return match; // not in map, leave as-is
    const parts = [meta.fileName];
    if (meta.titlePath) parts.push(meta.titlePath);
    if (meta.pageStart != null) {
      const page = meta.pageEnd && meta.pageEnd !== meta.pageStart
        ? t("kb.context.pageRange", { start: meta.pageStart, end: meta.pageEnd })
        : t("kb.context.pageSingle", { n: meta.pageStart });
      parts.push(page);
    }
    const title = escapeHtml(parts.join(" · "));
    return `<button type="button" class="kb-citation-chip" data-local-id="${id}" title="${title}" aria-label="${escapeHtml(t("kb.chat.citation.viewFile"))}: ${title}">📖 ${title}</button>`;
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
