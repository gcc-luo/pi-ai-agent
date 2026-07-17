import { ParsedDocument, ParsedSection, ParseOptions } from "./types.js";

export async function parsePdf(filePath: string, _opts?: ParseOptions): Promise<ParsedDocument> {
  const { extractText } = await import("unpdf");
  const fs = await import("node:fs/promises");

  const buffer = await fs.readFile(filePath);
  // pdfjs-dist 显式拒绝 Node.js Buffer，需要转换为纯 Uint8Array
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const result = await extractText(data);

  const sections: ParsedSection[] = [];
  let totalChars = 0;

  for (let i = 0; i < result.text.length; i++) {
    const text = (result.text[i] ?? "").trim();
    if (!text) continue;
    totalChars += text.length;
    sections.push({
      titlePath: null,
      content: text,
      pageStart: i + 1,
      pageEnd: i + 1,
    });
  }

  if (!sections.length && result.totalPages > 0) {
    throw new Error("pdf_no_text: PDF contains no extractable text (may be scanned or image-based)");
  }

  return {
    sections,
    charCount: totalChars,
    pageCount: result.totalPages,
  };
}
