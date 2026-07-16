import type Database from "better-sqlite3";
import { KbFileRepository } from "../db/repositories/kb-file.js";
import { KbChunkRepository } from "../db/repositories/kb-chunk.js";
import { KnowledgeBaseRepository } from "../db/repositories/knowledge-base.js";
import { ModelRepository } from "../db/repositories/model.js";
import { ParsedDocument } from "./parsers/types.js";
import { parseTxt } from "./parsers/txt.js";
import { parseMd } from "./parsers/md.js";
import { parsePdf } from "./parsers/pdf.js";
import { parseDocx } from "./parsers/docx.js";
import { chunkDocument } from "./chunker.js";
import { getEmbeddings, encodeEmbedding, EmbeddingModelConfig } from "./embedding-client.js";
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
    private knowledgeBases: KnowledgeBaseRepository,
    private models: ModelRepository,
  ) {}

  async parseFile(fileId: string): Promise<ParseResult> {
    const file = this.kbFiles.findById(fileId);
    if (!file) {
      console.error(`[KB Parse] file not found: fileId=${fileId}`);
      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason: "not_found" };
    }

    if (file.status === "parsing") {
      console.warn(`[KB Parse] already parsing: fileId=${fileId} name=${file.name}`);
      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason: "already_parsing" };
    }

    console.log(`[KB Parse] start: fileId=${fileId} name=${file.name} ext=${file.ext} size=${file.size}`);

    // Increment generation BEFORE parsing starts
    const newGeneration = this.kbFiles.incrementParseGeneration(fileId);
    this.kbFiles.setParsing(fileId);

    const storagePath = this.kbFiles.getStoragePath(fileId);
    if (!storagePath) {
      const msg = "storage_path_missing";
      console.error(`[KB Parse] failed: fileId=${fileId} reason=${msg}`);
      this.kbFiles.updateStatus(fileId, { status: "failed", failReason: msg });
      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason: msg };
    }

    const fullPath = path.join(this.kbFilesDir, storagePath);
    console.log(`[KB Parse] reading: fullPath=${fullPath}`);

    try {
      const signal = AbortSignal.timeout(PARSE_TIMEOUT_MS);
      const startTime = Date.now();
      const doc = await this.parseByExtension(file.ext, fullPath, signal);
      const parseMs = Date.now() - startTime;

      console.log(`[KB Parse] parsed: fileId=${fileId} ext=${file.ext} chars=${doc.charCount} pages=${doc.pageCount ?? 0} sections=${doc.sections.length} time=${parseMs}ms`);

      // Chunk the document
      const chunks = chunkDocument(doc);
      console.log(`[KB Parse] chunked: fileId=${fileId} chunks=${chunks.length}`);

      if (chunks.length === 0) {
        // Empty document — still mark as ready but with 0 chunks
        console.warn(`[KB Parse] empty document: fileId=${fileId} chars=${doc.charCount}`);
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

      // Get embedding model config for this KB
      const kb = this.knowledgeBases.findById(file.kbId);
      let embeddingConfig: EmbeddingModelConfig | null = null;
      if (kb?.embeddingModelId) {
        const model = this.models.findById(kb.embeddingModelId);
        if (model && model.modelType === "embedding" && model.apiBaseUrl && model.apiKey) {
          embeddingConfig = {
            apiBaseUrl: model.apiBaseUrl,
            apiKey: model.apiKey,
            modelId: model.id,
          };
          console.log(`[KB Parse] embedding model: ${model.id} for kb=${file.kbId}`);
        }
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

      // Generate embeddings if model is configured
      if (embeddingConfig && chunks.length > 0) {
        try {
          const texts = chunks.map((c) => c.content);
          console.log(`[KB Parse] generating embeddings: ${texts.length} chunks`);
          const { embeddings, dimension } = await getEmbeddings(embeddingConfig, texts);

          // Update chunks with embeddings
          const chunksWithRowid = this.kbChunks.listByFileWithEmbedding(fileId, newGeneration);
          for (let i = 0; i < chunksWithRowid.length && i < embeddings.length; i++) {
            const emb = embeddings[i];
            const chunk = chunksWithRowid[i];
            if (emb && chunk) {
              const embeddingBuffer = encodeEmbedding(emb);
              this.kbChunks.updateEmbedding(chunk.rowid, embeddingBuffer);
            }
          }
          console.log(`[KB Parse] embeddings saved: ${embeddings.length} chunks, dimension=${dimension}`);
        } catch (err: any) {
          console.error(`[KB Parse] embedding failed: ${err.message}`);
          // Embedding failure is non-fatal - chunks are still usable for keyword search
        }
      }

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

      console.log(`[KB Parse] done: fileId=${fileId} chunks=${chunks.length} chars=${doc.charCount}`);
      return { success: true, fileId, chunkCount: chunks.length, charCount: doc.charCount, pageCount: doc.pageCount };
    } catch (err: any) {
      // Clean up any chunks inserted with the new generation (partial failure)
      this.kbChunks.deleteByFileAndGeneration(fileId, newGeneration);

      const failReason = classifyError(err);
      const errorMessage = err?.message ?? String(err);
      const errorStack = err?.stack ?? "";

      console.error(`[KB Parse] failed: fileId=${fileId} name=${file.name} ext=${file.ext} reason=${failReason} error="${errorMessage}"`);
      if (errorStack) {
        console.error(errorStack);
      }

      this.kbFiles.updateStatus(fileId, {
        status: "failed",
        failReason: `${failReason}: ${errorMessage}`,
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
        throw new Error(`unsupported_type: .${ext}`);
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
