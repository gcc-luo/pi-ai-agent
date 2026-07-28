// File preview classification. Centralised so the FileViewer dispatch and any
// future caller share one definition of "what counts as a markdown file".
//
// Kinds are deliberately narrow: each maps to a dedicated preview component,
// and anything we cannot render usefully falls into `unsupported` so the UI
// can show a download affordance instead of a garbled binary dump.

export type FilePreviewKind =
  | "text"
  | "markdown"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "docx"
  | "xlsx"
  | "unsupported";

const TEXT_EXTENSIONS = new Set([
  "txt", "log", "ini", "toml", "yaml", "yml", "conf", "cfg",
  "json", "json5", "jsonc",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
  "css", "scss", "sass", "less", "styl",
  "html", "htm", "xml", "svg", // svg also previewable as image; we treat it as image below
  "vue", "svelte", "astro",
  "py", "rb", "go", "rs", "java", "kt", "kts", "scala",
  "c", "h", "cpp", "cc", "cxx", "hpp", "hxx",
  "cs", "fs", "fsx",
  "php", "pl", "lua", "r", "dart", "swift",
  "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql",
  "dockerfile", "makefile", "cmake",
  "gitignore", "editorconfig", "env",
]);

const EXTENSION_KIND: Record<string, FilePreviewKind> = {
  md: "markdown",
  markdown: "markdown",
  // svg rendered as image — browsers handle it natively
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
  svg: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  ogv: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  aac: "audio",
  m4a: "audio",
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xls: "xlsx",
  // pptx, ppt, doc, odt, ods, odp, rtf → unsupported (no stable JS preview)
};

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function filePreviewKind(filename: string): FilePreviewKind {
  const ext = fileExtension(filename);
  if (!ext) return "unsupported";
  // Filenames like "Dockerfile", "Makefile" have no extension but are text.
  const stemLower = filename.toLowerCase();
  if (stemLower === "dockerfile" || stemLower === "makefile") return "text";
  if (EXTENSION_KIND[ext]) return EXTENSION_KIND[ext];
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}

// Binary previews that need a URL pointing at the /raw endpoint.
export const KIND_USES_RAW_URL: ReadonlySet<FilePreviewKind> = new Set([
  "image",
  "video",
  "audio",
  "pdf",
]);
