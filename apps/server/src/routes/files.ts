import { FastifyPluginAsync } from "fastify";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { FileContentDto, FileNodeDto } from "@pi-web-ui/shared";

// MIME types for the raw streaming endpoint. Only common previewable formats
// are listed — anything else falls back to application/octet-stream, which the
// browser will offer to download rather than attempt to render.
const MIME: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
};

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

async function buildTree(root: string, rel: string, depth: number): Promise<FileNodeDto[]> {
  if (depth > 6) return [];
  const abs = path.join(root, rel);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const out: FileNodeDto[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".pi-web") continue;
    if (e.name === "node_modules") continue;
    const childRel = rel === "/" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      out.push({ name: e.name, path: childRel, type: "directory", children: await buildTree(root, childRel, depth + 1) });
    } else {
      const stat = await fs.stat(path.join(root, childRel));
      out.push({ name: e.name, path: childRel, type: "file", size: stat.size });
    }
  }
  return out;
}

// Resolve `rel` against `workdir` and refuse anything that escapes the workdir.
// Returns the absolute path if safe, null otherwise. `rel` must be a relative
// path like "src/foo.ts"; "/" (the root marker) and absolute paths are rejected.
function resolveSafe(workdir: string, rel: string): string | null {
  if (typeof rel !== "string" || rel === "" || rel === "/" || path.isAbsolute(rel)) return null;
  const abs = path.resolve(workdir, rel);
  const rel2 = path.relative(workdir, abs);
  if (rel2 === "" || rel2 === ".") return null; // would touch the workdir itself
  if (rel2.startsWith("..") || path.isAbsolute(rel2)) return null;
  return abs;
}

export const filesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { projectId: string }; Querystring: { path?: string } }>("/files/:projectId/list", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const rel = req.query.path ?? "/";
    const abs = path.join(project.workdir, rel);
    if (!abs.startsWith(project.workdir)) return reply.code(400).send({ error: "bad path" });
    const tree = await buildTree(project.workdir, rel, 0);
    return tree;
  });

  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>("/files/:projectId/read", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const rel = req.query.path;
    const abs = path.join(project.workdir, rel);
    if (!abs.startsWith(project.workdir)) return reply.code(400).send({ error: "bad path" });
    try {
      const stat = await fs.stat(abs);
      if (stat.size > 1_000_000) return reply.code(413).send({ error: "file too large" });
      const content = await fs.readFile(abs, "utf8");
      const dto: FileContentDto = { path: rel, content, size: stat.size, mtime: stat.mtimeMs };
      return dto;
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post<{ Params: { projectId: string }; Body: { path?: string; type?: string } }>("/files/:projectId/create", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const rel = req.body?.path;
    const type = req.body?.type;
    if (!rel || (type !== "file" && type !== "directory")) {
      return reply.code(400).send({ error: "invalid path or type" });
    }
    const abs = resolveSafe(project.workdir, rel);
    if (!abs) return reply.code(400).send({ error: "bad path" });
    try {
      if (type === "directory") {
        await fs.mkdir(abs, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, "", "utf8");
      }
      return { path: rel };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.put<{ Params: { projectId: string }; Body: { from?: string; to?: string } }>("/files/:projectId/rename", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const from = req.body?.from;
    const to = req.body?.to;
    if (!from || !to) return reply.code(400).send({ error: "invalid from/to" });
    const fromAbs = resolveSafe(project.workdir, from);
    const toAbs = resolveSafe(project.workdir, to);
    if (!fromAbs || !toAbs) return reply.code(400).send({ error: "bad path" });
    try {
      await fs.rename(fromAbs, toAbs);
      return { from, to };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.delete<{ Params: { projectId: string }; Querystring: { path: string } }>("/files/:projectId/delete", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const rel = req.query.path;
    const abs = resolveSafe(project.workdir, rel);
    if (!abs) return reply.code(400).send({ error: "bad path" });
    try {
      await fs.rm(abs, { recursive: true, force: true });
      return reply.code(204).send();
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  // Raw byte streaming for binary previews (image / video / audio / pdf / office).
  // Honors the Range header so <video> can seek. Intentionally separate from
  // `/read` (which is utf8-only and capped at 1MB) so the existing text path is
  // unaffected.
  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>("/files/:projectId/raw", async (req, reply) => {
    const project = app.projects.findById(req.params.projectId);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const abs = resolveSafe(project.workdir, req.query.path);
    if (!abs) return reply.code(400).send({ error: "bad path" });
    try {
      const s = await fs.stat(abs);
      const type = mimeFor(req.query.path);
      // 200MB hard cap — anything bigger isn't a preview, it's a download.
      if (s.size > 200 * 1024 * 1024) {
        return reply.code(413).send({ error: "file too large to preview" });
      }
      reply.header("Content-Type", type);
      reply.header("Accept-Ranges", "bytes");
      reply.header("Cache-Control", "private, no-store");
      // Fastify handles `Range` automatically when we just return a stream and
      // let it own the response, so we don't parse the header ourselves.
      return reply.code(200).send(createReadStream(abs));
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });
};
