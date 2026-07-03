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
};
