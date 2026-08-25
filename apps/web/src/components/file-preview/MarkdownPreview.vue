<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../../utils/markdown.js";

// Renders markdown to sanitized HTML. Reuses the same renderer as the chat
// panel so styling and sanitisation rules stay consistent across the app.
const props = defineProps<{ content: string }>();

const html = computed(() => renderMarkdown(props.content));
</script>

<template>
  <div class="md-preview" v-html="html" />
</template>

<style scoped>
.md-preview {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px 32px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text-primary);
}
.md-preview :deep(p) { margin: 0 0 0.6em; }
.md-preview :deep(p:last-child) { margin-bottom: 0; }
.md-preview :deep(h1),
.md-preview :deep(h2),
.md-preview :deep(h3),
.md-preview :deep(h4),
.md-preview :deep(h5),
.md-preview :deep(h6) {
  font-family: var(--font-sans);
  font-weight: 600;
  line-height: 1.3;
  margin: 1.2em 0 0.5em;
}
.md-preview :deep(h1) { font-size: 1.5em; padding-bottom: 0.25em; border-bottom: 1px solid var(--border-default); }
.md-preview :deep(h2) { font-size: 1.3em; padding-bottom: 0.22em; border-bottom: 1px solid var(--border-subtle); }
.md-preview :deep(h3) { font-size: 1.15em; }
.md-preview :deep(h4) { font-size: 1em; }
.md-preview :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.md-preview :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  padding: 1.5px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
}
.md-preview :deep(pre) {
  margin: 0.5em 0;
  padding: 10px 12px;
  background: var(--bg-void);
  border: 1px solid var(--border-default);
  border-left: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}
.md-preview :deep(pre code) { background: transparent; border: none; padding: 0; }
.md-preview :deep(ul),
.md-preview :deep(ol) { margin: 0.3em 0 0.7em; padding-left: 1.6em; }
.md-preview :deep(li) { margin: 0.15em 0; }
.md-preview :deep(blockquote) {
  margin: 0.4em 0 0.8em;
  padding: 0.2em 0 0.2em 14px;
  border-left: 2px solid var(--accent);
  color: var(--text-secondary);
}
.md-preview :deep(.markdown-table-wrap) { max-width: 100%; margin: 0.4em 0 0.85em; overflow-x: auto; border-radius: var(--radius-sm); }
.md-preview :deep(table) { display: table; width: max-content; min-width: 100%; border-collapse: collapse; margin: 0; font-size: 13px; }
.md-preview :deep(thead) { display: table-header-group; }
.md-preview :deep(tbody) { display: table-row-group; }
.md-preview :deep(tr) { display: table-row; }
.md-preview :deep(th),
.md-preview :deep(td) { padding: 6px 10px; border: 1px solid var(--border-default); }
.md-preview :deep(th) { background: var(--bg-elevated); font-weight: 600; }
.md-preview :deep(img) { max-width: 100%; border-radius: var(--radius-sm); }
.md-preview :deep(hr) { border: none; height: 1px; background: var(--border-default); margin: 1em 0; }
</style>
