function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Highlight original text in one pass so query words cannot match inserted markup. */
export function buildHighlightSnippet(
  content: string,
  queryWords: string[],
): string {
  const words = [...new Set(queryWords.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!words.length) return escapeHtml(content.slice(0, 200));
  const pattern = words
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const matcher = new RegExp(pattern, "gi");
  const first = matcher.exec(content);
  if (!first) return escapeHtml(content.slice(0, 200));

  const start = Math.max(0, first.index - 60);
  const end = Math.min(
    content.length,
    start + Math.max(200, first[0].length + 60),
  );
  const text = content.slice(start, end);
  matcher.lastIndex = 0;
  let cursor = 0;
  let snippet = start > 0 ? "…" : "";
  for (const match of text.matchAll(matcher)) {
    const index = match.index!;
    snippet += escapeHtml(text.slice(cursor, index));
    snippet += `<mark>${escapeHtml(match[0])}</mark>`;
    cursor = index + match[0].length;
  }
  return (
    snippet + escapeHtml(text.slice(cursor)) + (end < content.length ? "…" : "")
  );
}

export function buildInstrSnippet(content: string, keyword: string): string {
  return buildHighlightSnippet(content, [keyword]);
}
