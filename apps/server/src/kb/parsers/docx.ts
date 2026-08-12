import fs from "node:fs/promises";
import mammoth from "mammoth";
import { ParsedDocument, ParsedSection, ParseOptions } from "./types.js";

export async function parseDocx(filePath: string, opts?: ParseOptions): Promise<ParsedDocument> {
  const buffer = await fs.readFile(filePath, { signal: opts?.signal });

  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      { styleMap: [] },
    );
    html = result.value;
    opts?.signal?.throwIfAborted();
  } catch (err: any) {
    throw new Error(`docx_invalid: ${err.message}`);
  }

  if (!html.trim()) {
    return { sections: [], charCount: 0, pageCount: null };
  }

  const sections: ParsedSection[] = [];
  const headingStack: { depth: number; text: string }[] = [];
  let currentText = "";

  function buildTitlePath(): string | null {
    if (!headingStack.length) return null;
    return headingStack.map((h) => h.text).join(" > ");
  }

  function flushSection(): void {
    const trimmed = currentText.trim();
    if (trimmed) {
      sections.push({
        titlePath: buildTitlePath(),
        content: trimmed,
        pageStart: null,
        pageEnd: null,
      });
    }
    currentText = "";
  }

  // Simple HTML parsing using regex — mammoth output is well-structured
  // Split by heading tags
  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const parts: { type: "heading"; depth: number; text: string } | { type: "body"; text: string }[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(html)) !== null) {
    // Body before this heading
    if (match.index > lastIndex) {
      const bodyHtml = html.slice(lastIndex, match.index);
      const bodyText = stripHtml(bodyHtml).trim();
      if (bodyText) {
        flushSection();
        currentText += bodyText + "\n\n";
        flushSection();
      }
    }

    const depth = parseInt(match[1]!, 10);
    const text = stripHtml(match[2] ?? "").trim();

    // Update heading stack
    while (headingStack.length && headingStack[headingStack.length - 1]!.depth >= depth) {
      headingStack.pop();
    }
    headingStack.push({ depth, text });

    flushSection();
    lastIndex = match.index + match[0].length;
  }

  // Remaining body after last heading
  if (lastIndex < html.length) {
    const bodyText = stripHtml(html.slice(lastIndex)).trim();
    if (bodyText) {
      currentText += bodyText + "\n\n";
      flushSection();
    }
  }

  const charCount = sections.reduce((sum, s) => sum + s.content.length, 0);

  return { sections, charCount, pageCount: null };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
