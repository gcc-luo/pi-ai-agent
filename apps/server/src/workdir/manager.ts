import fs from "node:fs";
import path from "node:path";

export interface WorkdirManagerOptions {
  root: string;
}

export class WorkdirManager {
  constructor(private opts: WorkdirManagerOptions) {
    fs.mkdirSync(this.opts.root, { recursive: true });
  }

  path(projectId: string): string {
    return path.join(this.opts.root, projectId);
  }

  exists(projectId: string): boolean {
    return fs.existsSync(this.path(projectId));
  }

  create(projectId: string): string {
    const wd = this.path(projectId);
    if (fs.existsSync(wd)) throw new Error("project workdir already exists");
    fs.mkdirSync(wd, { recursive: true });
    fs.mkdirSync(path.join(wd, ".pi-web"), { recursive: true });
    fs.writeFileSync(path.join(wd, ".pi-web", "config.json"), JSON.stringify({ projectId, createdAt: Date.now() }, null, 2));
    return wd;
  }

  delete(projectId: string): void {
    fs.rmSync(this.path(projectId), { recursive: true, force: true });
  }
}
