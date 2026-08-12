import { FastifyPluginAsync } from "fastify";
import path from "node:path";
import fs from "node:fs/promises";
import AdmZip from "adm-zip";
import { ulid } from "../util/ulid.js";
import { KbParseJobWorker } from "../kb/parse-job-worker.js";
import { resolveKbStoragePath } from "../kb/storage-path.js";

const ALLOWED_EXT = new Set(["txt", "md", "pdf", "docx"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_IMPORT_COUNT = 20;
const ALLOWED_MIME = new Map([
  ["txt", new Set(["text/plain", "application/octet-stream"])],
  ["md", new Set(["text/markdown", "text/plain", "application/octet-stream"])],
  ["pdf", new Set(["application/pdf", "application/octet-stream"])],
  ["docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"])],
]);

export function createKbFilesRoutes(parseJobs: KbParseJobWorker, kbFilesDir: string): FastifyPluginAsync {
  return async (app) => {
    // GET /api/knowledge-bases/:kbId/files — 文件列表（分页 + 服务端过滤）
    app.get<{
      Params: { kbId: string };
      Querystring: { page?: string; pageSize?: string; search?: string; status?: string; ext?: string };
    }>("/knowledge-bases/:kbId/files", async (req, reply) => {
      const kb = app.knowledgeBases.findById(req.params.kbId);
      if (!kb) return reply.code(404).send({ error: "kb_not_found" });
      const page = Math.max(1, parseInt(req.query.page ?? "1", 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? "20", 10) || 20));
      const search = req.query.search?.trim() || undefined;
      const status = req.query.status || undefined;
      const ext = req.query.ext || undefined;
      return app.kbFiles.listByKbPaged(req.params.kbId, { page, pageSize, search, status, ext });
    });

    // GET /api/knowledge-bases/:kbId/files/searchable — KB 内全部 ready+enabled 文件，不分页
    app.get<{ Params: { kbId: string } }>("/knowledge-bases/:kbId/files/searchable", async (req, reply) => {
      const kb = app.knowledgeBases.findById(req.params.kbId);
      if (!kb) return reply.code(404).send({ error: "kb_not_found" });
      return app.kbFiles.listSearchableByKb(req.params.kbId);
    });

    // POST /api/knowledge-bases/:kbId/files — 新建 TXT/MD
    app.post<{ Params: { kbId: string } }>("/knowledge-bases/:kbId/files", async (req, reply) => {
      const body = req.body as { name?: string; ext?: string; content?: string } | null;
      if (!body?.name?.trim()) return reply.code(400).send({ error: "name_required" });
      if (!body.ext || !ALLOWED_EXT.has(body.ext)) return reply.code(400).send({ error: "unsupported_type" });
      if (body.ext !== "txt" && body.ext !== "md") return reply.code(400).send({ error: "use_import_for_binary" });

      const kb = app.knowledgeBases.findById(req.params.kbId);
      if (!kb) return reply.code(404).send({ error: "kb_not_found" });

      const name = body.name.trim();
      if (app.kbFiles.findByNameInKb(req.params.kbId, name)) {
        return reply.code(409).send({ error: "name_exists" });
      }

      const fileId = ulid();
      const content = body.content ?? "";
      const size = Buffer.byteLength(content, "utf8");
      const relativePath = `${req.params.kbId}/${fileId}.${body.ext}`;
      const fullPath = resolveKbStoragePath(kbFilesDir, relativePath);

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");

      const file = app.kbFiles.create({
        kbId: req.params.kbId,
        name,
        ext: body.ext,
        source: "created",
        size,
        storagePath: relativePath,
      });

      parseJobs.enqueue(file.id);

      console.log(`[KB Import] created file: fileId=${file.id} name=${file.name} ext=${file.ext} size=${size} kbId=${req.params.kbId}`);

      return reply.code(201).send(file);
    });

    // POST /api/knowledge-bases/:kbId/files/import — 导入文件
    app.post<{ Params: { kbId: string } }>("/knowledge-bases/:kbId/files/import", async (req, reply) => {
      const kb = app.knowledgeBases.findById(req.params.kbId);
      if (!kb) return reply.code(404).send({ error: "kb_not_found" });

      const parts = req.parts();
      const files: { name: string; ext: string; mimeType: string; buffer: Buffer }[] = [];
      const rejected: { name: string; error: string }[] = [];

      for await (const part of parts) {
        if (part.type === "file") {
          if (files.length >= MAX_IMPORT_COUNT) {
            await part.toBuffer(); // drain
            return reply.code(400).send({ error: "too_many_files", limit: MAX_IMPORT_COUNT });
          }
          const name = part.filename;
          const ext = path.extname(name).slice(1).toLowerCase();
          if (!ALLOWED_EXT.has(ext)) {
            console.warn(`[KB Import] skipped unsupported type: name=${name} ext=${ext}`);
            await part.toBuffer(); // drain
            continue;
          }
          const acceptedMime = ALLOWED_MIME.get(ext);
          if (!acceptedMime?.has(part.mimetype.toLowerCase())) {
            console.warn(`[KB Import] skipped MIME mismatch: name=${name} mime=${part.mimetype}`);
            await part.toBuffer();
            continue;
          }
          const buffer = await part.toBuffer();
          if (buffer.length > MAX_FILE_SIZE) {
            console.warn(`[KB Import] skipped too large: name=${name} size=${buffer.length}`);
            return reply.code(400).send({ error: "too_large", name, limit: MAX_FILE_SIZE });
          }
          if (!isAllowedFileContent(ext, buffer)) {
            console.warn(`[KB Import] skipped content signature mismatch: name=${name} ext=${ext}`);
            rejected.push({ name: path.basename(name), error: "content_type_mismatch" });
            continue;
          }
          files.push({ name: path.basename(name), ext, mimeType: part.mimetype, buffer });
        }
      }

      if (!files.length) return reply.code(400).send({ error: "no_valid_files" });

      console.log(`[KB Import] kbId=${req.params.kbId} received ${files.length} file(s): ${files.map(f => `${f.name}(${f.ext},${f.buffer.length}B)`).join(", ")}`);

      const created: any[] = [];
      const errors: { name: string; error: string }[] = [...rejected];

      for (const f of files) {
        // Check duplicate name
        if (app.kbFiles.findByNameInKb(req.params.kbId, f.name)) {
          console.warn(`[KB Import] duplicate name: ${f.name} in kbId=${req.params.kbId}`);
          errors.push({ name: f.name, error: "name_exists" });
          continue;
        }

        const fileId = ulid();
        const relativePath = `${req.params.kbId}/${fileId}.${f.ext}`;
        const fullPath = resolveKbStoragePath(kbFilesDir, relativePath);

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, f.buffer);

        const file = app.kbFiles.create({
          kbId: req.params.kbId,
          name: f.name,
          ext: f.ext,
          source: "imported",
          size: f.buffer.length,
          storagePath: relativePath,
        });

        console.log(`[KB Import] saved file: fileId=${file.id} name=${f.name} ext=${f.ext} size=${f.buffer.length}B path=${relativePath}`);

        parseJobs.enqueue(file.id);

        created.push(file);
      }

      return reply.code(201).send({ imported: created, errors });
    });

    // GET /api/kb-files/:id — 文件详情
    app.get<{ Params: { id: string } }>("/kb-files/:id", async (req, reply) => {
      const file = app.kbFiles.findById(req.params.id);
      if (!file) return reply.code(404).send({ error: "not_found" });
      return file;
    });

    // GET /api/kb-files/:id/content — 文件正文 (txt/md)
    app.get<{ Params: { id: string } }>("/kb-files/:id/content", async (req, reply) => {
      const file = app.kbFiles.findById(req.params.id);
      if (!file) return reply.code(404).send({ error: "not_found" });
      if (file.ext !== "txt" && file.ext !== "md") {
        return reply.code(400).send({ error: "content_not_available" });
      }
      const storagePath = app.kbFiles.getStoragePath(req.params.id);
      if (!storagePath) return reply.code(404).send({ error: "file_missing" });
      const fullPath = resolveKbStoragePath(kbFilesDir, storagePath);
      try {
        const content = await fs.readFile(fullPath, "utf8");
        return { name: file.name, content, size: file.size };
      } catch {
        return reply.code(404).send({ error: "file_missing" });
      }
    });

    // GET /api/kb-files/:id/chunks — 块列表
    app.get<{ Params: { id: string } }>("/kb-files/:id/chunks", async (req, reply) => {
      const file = app.kbFiles.findById(req.params.id);
      if (!file) return reply.code(404).send({ error: "not_found" });
      return app.kbChunks.listByFile(req.params.id, file.parseGeneration || undefined);
    });

    // PUT /api/kb-files/:id — 更新 (改名/改正文)
    app.put<{ Params: { id: string } }>("/kb-files/:id", async (req, reply) => {
      const body = req.body as { name?: string; content?: string } | null;
      const file = app.kbFiles.findById(req.params.id);
      if (!file) return reply.code(404).send({ error: "not_found" });

      if (body?.name !== undefined && body.name.trim() !== file.name) {
        const name = body.name.trim();
        if (!name) return reply.code(400).send({ error: "name_required" });
        if (app.kbFiles.findByNameInKb(file.kbId, name)) {
          return reply.code(409).send({ error: "name_exists" });
        }
        app.kbFiles.updateName(req.params.id, name);
      }

      if (body?.content !== undefined && (file.ext === "txt" || file.ext === "md")) {
        const storagePath = app.kbFiles.getStoragePath(req.params.id);
        if (storagePath) {
          const fullPath = resolveKbStoragePath(kbFilesDir, storagePath);
          const buf = Buffer.from(body.content, "utf8");
          await fs.writeFile(fullPath, body.content, "utf8");
          app.kbFiles.updateStoragePath(req.params.id, buf.length, storagePath);

          // Trigger durable reparse
          console.log(`[KB Reparse] content updated: fileId=${req.params.id} name=${file.name}`);
          parseJobs.enqueue(req.params.id);
        }
      }

      return app.kbFiles.findById(req.params.id);
    });

    // PUT /api/kb-files/:id/enabled — 启停
    app.put<{ Params: { id: string }; Body: { enabled: boolean } }>("/kb-files/:id/enabled", async (req, reply) => {
      const file = app.kbFiles.findById(req.params.id);
      if (!file) return reply.code(404).send({ error: "not_found" });
      const body = req.body as { enabled: boolean };
      app.kbFiles.setEnabled(req.params.id, body.enabled);
      return app.kbFiles.findById(req.params.id);
    });

    // POST /api/kb-files/:id/reparse — 重新解析
    app.post<{ Params: { id: string } }>("/kb-files/:id/reparse", async (req, reply) => {
      const file = app.kbFiles.findById(req.params.id);
      if (!file) return reply.code(404).send({ error: "not_found" });
      if (file.status === "parsing") return reply.code(409).send({ error: "already_parsing" });

      console.log(`[KB Reparse] triggered: fileId=${req.params.id} name=${file.name} ext=${file.ext} status=${file.status}`);
      parseJobs.enqueue(req.params.id);

      return reply.code(202).send({ message: "reparse_queued" });
    });

    // DELETE /api/kb-files/:id — 删除
    app.delete<{ Params: { id: string } }>("/kb-files/:id", async (req, reply) => {
      const file = app.kbFiles.findById(req.params.id);
      if (!file) return reply.code(404).send({ error: "not_found" });

      const storagePath = app.kbFiles.getStoragePath(req.params.id);
      // Delete chunks first
      app.kbChunks.deleteByFile(req.params.id);
      // Delete file record
      app.kbFiles.delete(req.params.id);
      // Delete physical file
      if (storagePath) {
        const fullPath = resolveKbStoragePath(kbFilesDir, storagePath);
        await fs.unlink(fullPath).catch(() => {});
      }

      return reply.code(204).send();
    });
  };
}

/** Validate file bytes instead of trusting only the client-supplied MIME. */
export function isAllowedFileContent(ext: string, buffer: Buffer): boolean {
  if (ext === "pdf") return buffer.subarray(0, 1024).indexOf(Buffer.from("%PDF-")) >= 0;
  if (ext === "docx") {
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
    try {
      const archive = new AdmZip(buffer);
      return archive.getEntry("[Content_Types].xml") !== null
        && archive.getEntry("word/document.xml") !== null;
    } catch {
      return false;
    }
  }
  if (ext === "txt" || ext === "md") {
    if (buffer.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
