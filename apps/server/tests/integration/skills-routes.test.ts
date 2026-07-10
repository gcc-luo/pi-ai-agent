import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";
import { ModelRepository } from "../../src/db/repositories/model.js";
import { SessionStateStore } from "../../src/agent/session-state.js";
import { SkillService } from "../../src/agent/skill-service.js";
import { skillsRoutes } from "../../src/routes/skills.js";

describe("skills routes", () => {
  let tmp: string;
  let skillsDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-skills-"));
    skillsDir = path.join(tmp, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    process.env.PI_WEB_UI_ROOT = tmp;
    process.env.PI_SKILLS_DIR = skillsDir;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    app = await buildApp(config, {
      db,
      projects: new ProjectRepository(db),
      sessions: new SessionRepository(db),
      messages: new MessageRepository(db),
      models: new ModelRepository(db),
      sessionStates: new SessionStateStore(),
      skills: new SkillService(config.skillsDir),
    });
    await app.register(skillsRoutes, { prefix: "/api/skills" });
  });
  afterEach(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.PI_SKILLS_DIR;
  });

  it("GET returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skills" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("POST creates a skill and returns SkillDto", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "demo", description: "demo desc", body: "do x" },
    });
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto.name).toBe("demo");
    expect(dto.description).toBe("demo desc");
    expect(dto.path).toBe(path.join(skillsDir, "demo", "SKILL.md"));
    expect(fs.existsSync(dto.path)).toBe(true);
  });

  it("POST rejects invalid name with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "Bad Name", description: "d", body: "b" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST rejects empty description with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills",
      payload: { name: "x", description: "   ", body: "b" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST overwrites existing skill (upsert)", async () => {
    await app.inject({ method: "POST", url: "/api/skills", payload: { name: "x", description: "old", body: "old" } });
    const res = await app.inject({ method: "POST", url: "/api/skills", payload: { name: "x", description: "new", body: "new" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().description).toBe("new");
    const list = (await app.inject({ method: "GET", url: "/api/skills" })).json();
    expect(list.length).toBe(1);
  });

  it("GET returns list after import", async () => {
    await app.inject({ method: "POST", url: "/api/skills", payload: { name: "alpha", description: "a", body: "b" } });
    await app.inject({ method: "POST", url: "/api/skills", payload: { name: "beta", description: "b", body: "b" } });
    const res = await app.inject({ method: "GET", url: "/api/skills" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: any) => s.name)).toEqual(["alpha", "beta"]);
  });

  it("DELETE removes the skill and returns 204", async () => {
    await app.inject({ method: "POST", url: "/api/skills", payload: { name: "gone", description: "d", body: "b" } });
    const res = await app.inject({ method: "DELETE", url: "/api/skills/gone" });
    expect(res.statusCode).toBe(204);
    const list = (await app.inject({ method: "GET", url: "/api/skills" })).json();
    expect(list).toEqual([]);
  });

  it("DELETE returns 404 for unknown skill", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/skills/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE rejects invalid name with 400", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/skills/UPPER" });
    expect(res.statusCode).toBe(400);
  });
});
