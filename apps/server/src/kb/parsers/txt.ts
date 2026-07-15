import fs from "node:fs/promises";
import { ParsedDocument, ParseOptions } from "./types.js";

export async function parseTxt(filePath: string, _opts?: ParseOptions): Promise<ParsedDocument> {
  const content = await fs.readFile(filePath, "utf8");
  if (!content.trim()) {
    return { sections: [], charCount: 0, pageCount: null };
  }
  return {
    sections: [{ titlePath: null, content: content.trim(), pageStart: null, pageEnd: null }],
    charCount: content.length,
    pageCount: null,
  };
}
