import type Database from "better-sqlite3";
import { KbFileRepository } from "../db/repositories/kb-file.js";
import { KbChunkRepository } from "../db/repositories/kb-chunk.js";
import { ParsedDocument } from "./parsers/types.js";
import { parseTxt } from "./parsers/txt.js";
import { parseMd } from "./parsers/md.js";
import { parsePdf } from "./parsers/pdf.js";
import { parseDocx } from "./parsers/docx.js";
import { chunkDocument } from "./chunker.js";
import path from "node:path";

const PARSE_TIMEOUT_MS = 60_000;

export interface ParseResult {
  success: boolean;
  fileId: string;
  chunkCount: number;
  charCount: number;
  pageCount: number | null;
  failReason?: string;
}

export class ParsePipeline {
  constructor(
    private db: Database.Database,
    private kbFiles: KbFileRepository,
    private kbChunks: KbChunkRepository,
    private kbFilesDir: string,
  ) {}

  async parseFile(fileId: string): Promise<ParseResult> {
    const file = this.kbFiles.findById(fileId);
    if (!file) {
      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason: "not_found" };
    }

    if (file.status === "parsing") {
      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason: "already_parsing" };
    }

    // Increment generation BEFORE parsing starts
    const newGeneration = this.kbFiles.incrementParseGeneration(fileId);
    this.kbFiles.setParsing(fileId);

    const storagePath = this.kbFiles.getStoragePath(fileId);
    if (!storagePath) {
      this.kbFiles.updateStatus(fileId, { status: "failed", failReason: "read_failed" });
      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason: "read_failed" };
    }

    const fullPath = path.resolve(this.kbFilesDir, "..", storagePath);

    try {
      const signal = AbortSignal.timeout(PARSE_TIMEOUT_MS);
      const doc = await this.parseByExtension(file.ext, fullPath, signal);

      // Chunk the document
      const chunks = chunkDocument(doc);

      if (chunks.length === 0) {
        // Empty document — still mark as ready but with 0 chunks
        this.kbFiles.updateStatus(fileId, {
          status: "ready",
          parseGeneration: newGeneration,
          charCount: doc.charCount,
          pageCount: doc.pageCount,
          chunkCount: 0,
          lastParsedAt: Date.now(),
          failReason: null,
        });
        // Clean up stale generations
        this.kbChunks.deleteStaleGenerations(fileId, newGeneration);
        return { success: true, fileId, chunkCount: 0, charCount: doc.charCount, pageCount: doc.pageCount };
      }

      // Insert chunks with new generation inside a transaction
      const insertChunks = this.db.transaction(() => {
        for (const chunk of chunks) {
          this.kbChunks.insert({
            kbId: file.kbId,
            fileId,
            generation: newGeneration,
            seq: chunk.seq,
            titlePath: chunk.titlePath,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            content: chunk.content,
            charCount: chunk.charCount,
          });
        }
      });
      insertChunks();

      // Delete stale generation chunks
      this.kbChunks.deleteStaleGenerations(fileId, newGeneration);

      // Update file status
      this.kbFiles.updateStatus(fileId, {
        status: "ready",
        parseGeneration: newGeneration,
        charCount: doc.charCount,
        pageCount: doc.pageCount,
        chunkCount: chunks.length,
        lastParsedAt: Date.now(),
        failReason: null,
      });

      return { success: true, fileId, chunkCount: chunks.length, charCount: doc.charCount, pageCount: doc.pageCount };
    } catch (err: any) {
      // Clean up any chunks inserted with the new generation (partial failure)
      this.kbChunks.deleteByFileAndGeneration(fileId, newGeneration);

      const failReason = classifyError(err);
      this.kbFiles.updateStatus(fileId, {
        status: "failed",
        failReason,
        // parse_generation stays at old value — old chunks remain searchable
      });

      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason };
    }
  }

  private async parseByExtension(ext: string, filePath: string, signal: AbortSignal): Promise<ParsedDocument> {
    const opts = { signal };
    switch (ext) {
      case "txt":
        return parseTxt(filePath, opts);
      case "md":
        return parseMd(filePath, opts);
      case "pdf":
        return parsePdf(filePath, opts);
      case "docx":
        return parseDocx(filePath, opts);
      default:
        throw new Error("unsupported_type");
    }
  }
}

function classifyError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (msg.startsWith("unsupported_type")) return "unsupported_type";
  if (msg.startsWith("pdf_no_text")) return "pdf_no_text";
  if (msg.includes("encrypted") || msg.includes("password")) return "pdf_encrypted";
  if (msg.startsWith("docx_invalid")) return "docx_invalid";
  if (msg.includes("timeout") || err.name === "AbortError" || err.name === "TimeoutError") return "timeout";
  if (msg.includes("too large")) return "too_large";
  return "unknown";
}
