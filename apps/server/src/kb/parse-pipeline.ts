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
import { getEmbeddingsBatched, encodeEmbedding, embeddingModelVersion, EmbeddingModelConfig } from "./embedding-client.js";
import { ulid } from "../util/ulid.js";
import { resolveKbStoragePath } from "./storage-path.js";

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

    // Build a candidate generation without changing the active generation. The
    // active pointer is switched only after parsing and indexing both succeed.
    const newGeneration = this.kbFiles.nextParseGeneration(fileId);
    this.kbFiles.setParsing(fileId);
    const revisionId = ulid();
    this.db.prepare(`
      INSERT INTO kb_asset_revisions (
        id, file_id, generation, status, parser_version, created_at
      ) VALUES (?, ?, ?, 'parsing', 'v2', ?)
    `).run(revisionId, fileId, newGeneration, Date.now());

    const storagePath = this.kbFiles.getStoragePath(fileId);
    if (!storagePath) {
      const msg = "storage_path_missing";
      console.error(`[KB Parse] failed: fileId=${fileId} reason=${msg}`);
      this.kbFiles.updateStatus(fileId, { status: "failed", failReason: msg });
      this.db.prepare(`
        UPDATE kb_asset_revisions
        SET status = 'failed', fail_reason = ?, completed_at = ? WHERE id = ?
      `).run(msg, Date.now(), revisionId);
      return { success: false, fileId, chunkCount: 0, charCount: 0, pageCount: null, failReason: msg };
    }

    try {
      const fullPath = resolveKbStoragePath(this.kbFilesDir, storagePath);
      console.log(`[KB Parse] reading: fullPath=${fullPath}`);
      const signal = AbortSignal.timeout(PARSE_TIMEOUT_MS);
      const startTime = Date.now();
      const doc = await withAbort(this.parseByExtension(file.ext, fullPath, signal), signal);
      const parseMs = Date.now() - startTime;

      console.log(`[KB Parse] parsed: fileId=${fileId} ext=${file.ext} chars=${doc.charCount} pages=${doc.pageCount ?? 0} sections=${doc.sections.length} time=${parseMs}ms`);

      // Chunk the document
      const chunks = chunkDocument(doc);
      console.log(`[KB Parse] chunked: fileId=${fileId} chunks=${chunks.length}`);

      if (chunks.length === 0) {
        // Empty documents have no retrievable evidence and must not be reported
        // as searchable/ready.
        console.warn(`[KB Parse] empty document: fileId=${fileId} chars=${doc.charCount}`);
        throw new Error("empty_document: document contains no searchable content");
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
            modelVersion: embeddingModelVersion(model.apiBaseUrl, model.id),
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
            modality: chunk.modality,
            timeStartMs: chunk.timeStartMs,
            timeEndMs: chunk.timeEndMs,
            bbox: chunk.bbox,
          });
        }
      });
      insertChunks();

      // Generate embeddings if model is configured
      if (embeddingConfig && chunks.length > 0) {
        const texts = chunks.map((c) => c.titlePath ? `${c.titlePath}\n${c.content}` : c.content);
        console.log(`[KB Parse] generating embeddings: ${texts.length} chunks`);
        try {
          const { embeddings, dimension } = await getEmbeddingsBatched(embeddingConfig, texts);
          const chunksWithRowid = this.kbChunks.listByFileWithEmbedding(fileId, newGeneration);
          for (let i = 0; i < chunksWithRowid.length; i++) {
            const emb = embeddings[i];
            const chunk = chunksWithRowid[i];
            if (!emb || !chunk) throw new Error("embedding_result_incomplete");
            this.kbChunks.upsertVector({
              chunkId: chunk.rowid,
              vectorSpace: "text",
              modality: "text",
              modelId: embeddingConfig.modelId,
              modelVersion: embeddingConfig.modelVersion ?? "unknown",
              dimension,
              embedding: encodeEmbedding(emb),
            });
          }
          console.log(`[KB Parse] embeddings saved: ${embeddings.length} chunks, dimension=${dimension}`);
        } catch (err: any) {
          throw new Error(`embedding_failed: ${err.message}`);
        }
      }

      const completedAt = Date.now();
      this.db.transaction(() => {
        this.kbFiles.updateStatus(fileId, {
          status: "ready", parseGeneration: newGeneration, activeRevisionId: revisionId,
          charCount: doc.charCount, pageCount: doc.pageCount,
          chunkCount: chunks.length, lastParsedAt: completedAt, failReason: null,
        });
        this.db.prepare(`
          UPDATE kb_asset_revisions
          SET status = 'ready', embedding_model_id = ?,
              embedding_model_version = ?, completed_at = ?
          WHERE id = ?
        `).run(
          embeddingConfig?.modelId ?? null,
          embeddingConfig?.modelVersion ?? null,
          completedAt,
          revisionId,
        );
      })();

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
      });
      this.db.prepare(`
        UPDATE kb_asset_revisions
        SET status = 'failed', fail_reason = ?, completed_at = ?
        WHERE id = ?
      `).run(`${failReason}: ${errorMessage}`, Date.now(), revisionId);

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

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let rejectOnAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<T>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = (): void => rejectOnAbort?.(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function classifyError(err: Error): string {
  const msg = err.message.toLowerCase();
  if (msg.startsWith("unsupported_type")) return "unsupported_type";
  if (msg.startsWith("pdf_no_text")) return "pdf_no_text";
  if (msg.includes("encrypted") || msg.includes("password")) return "pdf_encrypted";
  if (msg.startsWith("docx_invalid")) return "docx_invalid";
  if (msg.startsWith("empty_document")) return "empty_document";
  if (msg.startsWith("embedding_failed")) return "embedding_failed";
  if (msg.includes("timeout") || err.name === "AbortError" || err.name === "TimeoutError") return "timeout";
  if (msg.includes("too large")) return "too_large";
  return "unknown";
}
