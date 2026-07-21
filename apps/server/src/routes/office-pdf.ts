import { FastifyPluginAsync } from "fastify";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { LibreOfficeService } from "../services/libre-office.js";

// Same path-safety check used in routes/files.ts.
function resolveSafe(workdir: string, rel: string): string | null {
  if (typeof rel !== "string" || rel === "" || rel === "/" || path.isAbsolute(rel)) return null;
  const abs = path.resolve(workdir, rel);
  const rel2 = path.relative(workdir, abs);
  if (rel2 === "" || rel2 === ".") return null;
  if (rel2.startsWith("..") || path.isAbsolute(rel2)) return null;
  return abs;
}

const OFFICE_EXTENSIONS = new Set([
  ".docx", ".xlsx", ".pptx",
  ".doc", ".xls", ".ppt",
  ".odt", ".ods", ".odp",
  ".rtf",
]);

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

export function createOfficePdfRoutes(loService: LibreOfficeService): FastifyPluginAsync {
  return async (app) => {
    // ── Conversion endpoint ──
    app.get<{ Params: { projectId: string }; Querystring: { path: string } }>(
      "/files/:projectId/office-pdf",
      async (req, reply) => {
        if (!(await loService.isAvailable())) {
          return reply.code(503).send({
            error: "libreoffice_unavailable",
            message: "LibreOffice is not installed or not in PATH",
          });
        }

        const project = (app as any).projects.findById(req.params.projectId);
        if (!project) return reply.code(404).send({ error: "project not found" });

        const abs = resolveSafe(project.workdir, req.query.path);
        if (!abs) return reply.code(400).send({ error: "bad path" });

        const ext = path.extname(abs).toLowerCase();
        if (!OFFICE_EXTENSIONS.has(ext)) {
          return reply.code(400).send({ error: "unsupported file type" });
        }

        let stat;
        try {
          stat = await fs.stat(abs);
        } catch {
          return reply.code(404).send({ error: "file not found" });
        }
        if (stat.size > MAX_FILE_SIZE) {
          return reply.code(413).send({ error: "file too large" });
        }

        try {
          const result = await loService.convert(abs, stat.mtimeMs, stat.size);

          // Async cache eviction (don't block the response)
          loService.evictCache().catch(() => {});

          const pdfStat = await fs.stat(result.pdfPath);
          reply.header("Content-Type", "application/pdf");
          reply.header("Content-Length", String(pdfStat.size));
          reply.header("Cache-Control", "private, max-age=3600");
          reply.header("X-LO-Cache", result.fromCache ? "HIT" : "MISS");
          return reply.code(200).send(createReadStream(result.pdfPath));
        } catch (e: any) {
          if (e.killed || e.code === "ETIMEDOUT" || e.message?.includes("timeout")) {
            return reply.code(504).send({
              error: "conversion_timeout",
              message: "LibreOffice conversion timed out",
            });
          }
          app.log.error({ err: e }, "LibreOffice conversion failed");
          return reply.code(500).send({ error: "conversion_failed", message: e.message });
        }
      },
    );

    // ── Availability check endpoint ──
    app.get("/files/office-status", async () => {
      const available = await loService.isAvailable();
      return { available };
    });
  };
}
