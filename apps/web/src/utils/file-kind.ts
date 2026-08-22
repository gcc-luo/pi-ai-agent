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

export type FileIconKind =
  | "markdown"
  | "javascript"
  | "typescript"
  | "python"
  | "json"
  | "web"
  | "style"
  | "data"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "archive"
  | "config"
  | "code"
  | "text"
  | "generic";

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
  mdx: "markdown",
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

const FILE_ICON_KIND_BY_EXTENSION: Record<string, FileIconKind> = {
  md: "markdown",
  markdown: "markdown",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  json: "json",
  json5: "json",
  jsonc: "json",
  html: "web",
  htm: "web",
  xml: "web",
  svg: "web",
  vue: "web",
  svelte: "web",
  astro: "web",
  css: "style",
  scss: "style",
  sass: "style",
  less: "style",
  styl: "style",
  csv: "data",
  tsv: "data",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  ico: "image",
  avif: "image",
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
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  xls: "excel",
  xlsx: "excel",
  ods: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  odp: "powerpoint",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  bz2: "archive",
  xz: "archive",
  txt: "text",
  log: "text",
  ini: "config",
  toml: "config",
  yaml: "config",
  yml: "config",
  conf: "config",
  cfg: "config",
  env: "config",
  cmake: "config",
  gitignore: "config",
  editorconfig: "config",
  dockerfile: "config",
  makefile: "config",
  sh: "code",
  bash: "code",
  zsh: "code",
  fish: "code",
  ps1: "code",
  sql: "code",
  graphql: "code",
  gql: "code",
  pyc: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  kts: "code",
  scala: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cc: "code",
  cxx: "code",
  hpp: "code",
  hxx: "code",
  cs: "code",
  fs: "code",
  fsx: "code",
  php: "code",
  pl: "code",
  lua: "code",
  r: "code",
  dart: "code",
  swift: "code",
};

const SPECIAL_FILE_ICON_KINDS: Record<string, FileIconKind> = {
  dockerfile: "config",
  makefile: "config",
  ".env": "config",
  ".gitignore": "config",
  ".editorconfig": "config",
  gitignore: "config",
  editorconfig: "config",
  env: "config",
};

export function fileIconKind(filename: string): FileIconKind {
  const normalized = filename.split("/").pop()?.toLowerCase() ?? "";
  if (normalized === ".env" || normalized.startsWith(".env.")) return "config";
  const specialKind = SPECIAL_FILE_ICON_KINDS[normalized];
  if (specialKind) return specialKind;

  const ext = fileExtension(normalized);
  if (ext && FILE_ICON_KIND_BY_EXTENSION[ext]) return FILE_ICON_KIND_BY_EXTENSION[ext];
  if (TEXT_EXTENSIONS.has(ext)) return "code";
  return "generic";
}

// Binary previews that need a URL pointing at the /raw endpoint.
export const KIND_USES_RAW_URL: ReadonlySet<FilePreviewKind> = new Set([
  "image",
  "video",
  "audio",
  "pdf",
]);
