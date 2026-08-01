import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: true,
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Wrap fenced code blocks in a container with a copy button in the top-right
// corner (ChatGPT-style). The button is inert markup inside v-html — clicks
// are handled via event delegation on the .msg-content container, which reads
// the sibling <pre> text content.
function wrapCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (_match, codeAttrs: string, codeBody: string) =>
      `<div class="code-block-wrap"><button type="button" class="code-copy-btn" aria-label="Copy code" title="Copy code">` +
      `<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">` +
      `<rect x="4.5" y="4.5" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.3"></rect>` +
      `<path d="M9.5 4.5v-1a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1" stroke="currentColor" stroke-width="1.3"></path>` +
      `</svg></button><pre><code${codeAttrs}>${codeBody}</code></pre></div>`,
  );
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const raw = marked.parse(text) as string;
  return DOMPurify.sanitize(wrapCodeBlocks(raw), {
    ADD_ATTR: ["target", "rel"],
  });
}
