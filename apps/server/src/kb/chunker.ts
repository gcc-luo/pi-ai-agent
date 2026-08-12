import { ParsedDocument, ParsedSection } from "./parsers/types.js";

export interface Chunk {
  seq: number;
  titlePath: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  charCount: number;
  modality: "text" | "image" | "video" | "audio";
  timeStartMs: number | null;
  timeEndMs: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

const TARGET_MIN = 800;
const TARGET_MAX = 1200;
const OVERLAP_SIZE = 120;

export function chunkDocument(doc: ParsedDocument): Chunk[] {
  if (!doc.sections.length) return [];

  const chunks: Chunk[] = [];
  let seq = 0;

  // Group sections into chunks: accumulate text up to TARGET_MAX,
  // split at section boundaries when possible.
  let buffer: ParsedSection[] = [];
  let bufferLen = 0;
  let currentTitlePath: string | null = null;
  let currentPageStart: number | null = null;
  let currentPageEnd: number | null = null;
  let currentModality: Chunk["modality"] | null = null;

  function flushBuffer(): void {
    if (!buffer.length) return;
    const text = buffer.map((b) => b.content).join("\n\n").trim();
    if (!text) {
      buffer = [];
      bufferLen = 0;
      return;
    }
    chunks.push({
      seq: seq++,
      titlePath: currentTitlePath,
      pageStart: currentPageStart,
      pageEnd: currentPageEnd,
      content: text,
      charCount: text.length,
      modality: buffer[0]?.modality ?? "text",
      timeStartMs: buffer[0]?.timeStartMs ?? null,
      timeEndMs: buffer.at(-1)?.timeEndMs ?? null,
      bbox: buffer.length === 1 ? buffer[0]?.bbox ?? null : null,
    });
    buffer = [];
    bufferLen = 0;
    currentTitlePath = null;
    currentPageStart = null;
    currentPageEnd = null;
    currentModality = null;
  }

  for (const section of doc.sections) {
    const sectionLen = section.content.length;
    const sectionModality = section.modality ?? "text";

    // Never merge content from different retrieval/vector spaces into one
    // segment. This is required once OCR regions, image captions and video
    // transcripts are emitted by multimodal parsers.
    if (buffer.length > 0 && currentModality !== sectionModality) flushBuffer();

    if (sectionLen > TARGET_MAX) {
      // Flush current buffer first
      flushBuffer();
      // Split large section
      const subChunks = splitLongText(section.content, TARGET_MIN, TARGET_MAX);
      for (const sub of subChunks) {
        chunks.push({
          seq: seq++,
          titlePath: section.titlePath,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          content: sub,
          charCount: sub.length,
          modality: section.modality ?? "text",
          timeStartMs: section.timeStartMs ?? null,
          timeEndMs: section.timeEndMs ?? null,
          bbox: section.bbox ?? null,
        });
      }
    } else if (bufferLen + sectionLen > TARGET_MAX && buffer.length > 0) {
      // Adding this section would exceed max; flush and start new buffer
      flushBuffer();
      addToBuffer(section);
    } else {
      addToBuffer(section);
    }

    function addToBuffer(s: ParsedSection): void {
      if (!currentTitlePath && s.titlePath) currentTitlePath = s.titlePath;
      currentModality = s.modality ?? "text";
      if (s.pageStart != null) {
        if (currentPageStart == null) currentPageStart = s.pageStart;
        currentPageEnd = s.pageEnd ?? s.pageStart;
      }
      buffer.push({
        content: s.content,
        titlePath: s.titlePath,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
        modality: s.modality,
        timeStartMs: s.timeStartMs,
        timeEndMs: s.timeEndMs,
        bbox: s.bbox,
      });
      bufferLen += s.content.length;
    }
  }
  flushBuffer();

  // Deduplicate: remove chunks with identical content
  return deduplicateChunks(chunks);
}

function splitLongText(text: string, minSize: number, maxSize: number): string[] {
  const result: string[] = [];
  let remaining = text;

  while (remaining.length > maxSize) {
    // Try to split at a paragraph boundary near the target
    let splitAt = remaining.lastIndexOf("\n\n", maxSize);
    if (splitAt < minSize) {
      // Try sentence boundary
      splitAt = findSentenceBoundary(remaining, minSize, maxSize);
    }
    if (splitAt < minSize) {
      // Hard split at maxSize
      splitAt = maxSize;
    }

    result.push(remaining.slice(0, splitAt).trim());
    const nextStart = Math.max(0, splitAt - OVERLAP_SIZE);
    remaining = remaining.slice(nextStart).trim();
  }

  if (remaining.trim()) {
    result.push(remaining.trim());
  }

  return result;
}

function findSentenceBoundary(text: string, min: number, max: number): number {
  // Look for sentence-ending punctuation followed by space/newline
  const re = /[。！？.!?]\s/g;
  let lastMatch = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index >= max) break;
    if (match.index >= min) lastMatch = match.index + 1;
  }
  return lastMatch;
}

function deduplicateChunks(chunks: Chunk[]): Chunk[] {
  const seen = new Set<string>();
  const result: Chunk[] = [];
  for (const chunk of chunks) {
    const key = chunk.content;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(chunk);
    }
  }
  // Re-number seq after dedup
  return result.map((c, i) => ({ ...c, seq: i }));
}
