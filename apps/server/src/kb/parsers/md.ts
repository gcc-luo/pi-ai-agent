import fs from "node:fs/promises";
import { marked } from "marked";
import { ParsedDocument, ParsedSection, ParseOptions } from "./types.js";

interface MdToken {
  type: string;
  text?: string;
  raw?: string;
  depth?: number;
  tokens?: MdToken[];
  lang?: string;
}

export async function parseMd(filePath: string, opts?: ParseOptions): Promise<ParsedDocument> {
  const content = await fs.readFile(filePath, { encoding: "utf8", signal: opts?.signal });
  if (!content.trim()) {
    return { sections: [], charCount: 0, pageCount: null };
  }

  const tokens = marked.lexer(content) as MdToken[];
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

  for (const token of tokens) {
    if (token.type === "heading" && token.depth !== undefined) {
      flushSection();
      const depth = token.depth;
      // Pop headings at same or deeper level
      while (headingStack.length && headingStack[headingStack.length - 1]!.depth >= depth) {
        headingStack.pop();
      }
      headingStack.push({ depth, text: (token.text ?? "").trim() });
    } else if (token.type === "paragraph" || token.type === "text") {
      currentText += (token.text ?? token.raw ?? "") + "\n\n";
    } else if (token.type === "code") {
      const lang = token.lang ? `\`\`\`${token.lang}\n` : "```\n";
      currentText += `${lang}${token.text ?? ""}\n\`\`\`\n\n`;
    } else if (token.type === "list") {
      currentText += (token.raw ?? "") + "\n\n";
    } else if (token.type === "blockquote") {
      currentText += (token.raw ?? "") + "\n\n";
    } else if (token.type === "table") {
      currentText += (token.raw ?? "") + "\n\n";
    } else if (token.type === "hr") {
      flushSection();
    } else if (token.raw) {
      currentText += token.raw + "\n\n";
    }
  }
  flushSection();

  return { sections, charCount: content.length, pageCount: null };
}
