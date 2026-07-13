<script setup lang="ts">
import { computed, ref, watch } from "vue";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/atom-one-dark.css";
import { fileExtension } from "../../utils/file-kind.js";

// Per-line syntax highlighting for code/text previews. highlight.js's common
// build covers ~35 mainstream languages; anything outside that set falls back
// to plain monospaced text (still with line numbers). The library is statically
// imported here because TextPreview itself is only mounted by FileViewer when
// the user actually opens a code file, so the cost stays out of the main chunk.
//
// Per-line highlighting is used (rather than whole-document) so we can keep
// the existing line-numbered table layout. Multi-line constructs (block
// comments, template literals) lose continuity across line boundaries — for
// a preview that's an acceptable tradeoff.

const props = defineProps<{ content: string; path: string }>();

const LANG_BY_EXT: Record<string, string> = {
  // JS family
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  // Web
  html: "xml", htm: "xml", xml: "xml", vue: "xml", svelte: "xml", astro: "xml",
  css: "css", scss: "scss", sass: "sass", less: "less", styl: "stylus",
  // Data
  json: "json", json5: "json", jsonc: "json",
  yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", conf: "ini", cfg: "ini",
  // Systems
  py: "python", pyw: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp", hh: "cpp",
  cs: "csharp",
  fs: "fsharp", fsx: "fsharp",
  php: "php",
  pl: "perl", pm: "perl",
  lua: "lua",
  r: "r",
  swift: "swift",
  dart: "dart",
  // Shell
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash", ksh: "bash",
  ps1: "powershell", psm1: "powershell",
  // Query
  sql: "sql",
  graphql: "graphql", gql: "graphql",
  // Build / config
  dockerfile: "dockerfile",
  makefile: "makefile", mk: "makefile",
  cmake: "cmake",
  // Docs
  md: "markdown", markdown: "markdown",
};

function langFor(path: string): string | undefined {
  const ext = fileExtension(path);
  if (!ext) {
    // Filenames like "Dockerfile", "Makefile" have no extension but hljs
    // recognises them by name.
    const stemLower = path.toLowerCase();
    if (stemLower.endsWith("dockerfile")) return "dockerfile";
    if (stemLower.endsWith("makefile")) return "makefile";
    return undefined;
  }
  return LANG_BY_EXT[ext];
}

const language = computed(() => langFor(props.path));

// Lines are split once per content change so the per-row v-for doesn't
// re-split on every re-render.
const lines = computed(() => props.content.split("\n"));

// Whole-document highlight fallback: if the language is unknown we still want
// line numbers but no colour. Computed separately so the per-line highlighter
// can short-circuit.
const hasLanguage = computed(() => {
  const lang = language.value;
  return !!lang && !!hljs.getLanguage(lang);
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Highlight a single line. Returns HTML that's safe to inject via v-html.
// `ignoreIllegals: true` keeps hljs from throwing on stray out-of-grammar
// tokens — it just renders them as plain text within the highlighted span.
function highlightLine(line: string): string {
  const lang = language.value;
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(line);
  try {
    return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(line);
  }
}

// Whole-document highlight used for unknown-but-extension-matched fallbacks
// or as an alternative path. Currently unused but kept here as a reference for
// future migration if we decide to abandon the table layout.
const _highlightedFull = computed(() => {
  const lang = language.value;
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(props.content);
  try {
    return hljs.highlight(props.content, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(props.content);
  }
});

// Hint whether a language was recognised — surfaced in the UI so the user
// knows why a file is uncoloured.
const langLabel = computed(() => (hasLanguage.value ? language.value : null));

// Re-render trigger: hljs output is deterministic, so we only need to react
// to content/path changes. The `ref(0)` is bumped in case future versions of
// hljs produce different output for the same input (e.g., plugin swaps).
const renderTick = ref(0);
watch(() => [props.content, props.path], () => { renderTick.value++; });
</script>

<template>
  <div class="code-block" :data-tick="renderTick">
    <div v-if="langLabel" class="lang-badge">{{ langLabel }}</div>
    <table class="code-table">
      <tbody>
        <tr v-for="(line, i) in lines" :key="i">
          <td class="line-num">{{ i + 1 }}</td>
          <td class="line-content" v-html="highlightLine(line)" />
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.code-block {
  position: relative;
  flex: 1;
  overflow: auto;
  padding: 10px 0 0;
  background: var(--bg-void);
}

.lang-badge {
  position: absolute;
  top: 8px;
  right: 12px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  z-index: 1;
}

.code-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  tab-size: 2;
}

.code-table tr {
  transition: background var(--transition-fast);
}

.code-table tr:hover {
  background: var(--row-hover);
}

.line-num {
  width: 48px;
  padding: 0 12px 0 14px;
  text-align: right;
  color: var(--text-faint);
  user-select: none;
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}

.line-content {
  padding-right: 14px;
  color: var(--text-primary);
  vertical-align: top;
  white-space: pre;
}

/* highlight.js atom-one-dark theme targets `.hljs` on the root element and
 * applies a background colour we don't want (the viewer has its own bg). We
 * neutralise it here and let the per-line span colours do the work. */
.line-content :deep(.hljs) {
  background: transparent;
  padding: 0;
  color: inherit;
}
</style>
