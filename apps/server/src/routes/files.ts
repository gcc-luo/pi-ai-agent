import { FastifyPluginAsync } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import type { FileNodeDto, FileContentDto } from "@pi-web-ui/shared";

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
};
