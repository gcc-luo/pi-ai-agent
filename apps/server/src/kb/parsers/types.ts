export interface ParsedSection {
  titlePath: string | null;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  modality?: "text" | "image" | "video" | "audio";
  timeStartMs?: number | null;
  timeEndMs?: number | null;
  bbox?: { x: number; y: number; width: number; height: number } | null;
}

export interface ParsedDocument {
  sections: ParsedSection[];
  charCount: number;
  pageCount: number | null;
}

export interface ParseOptions {
  signal?: AbortSignal;
}
