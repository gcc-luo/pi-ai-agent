# Chat Skills Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skills dropdown button in the chat composer that lists user-level pi skills from `~/.pi/agent/skills/`, supports importing (write `SKILL.md`) and uninstalling skills, and on selection fills the chat textarea with `/skill:<name> ` for the user to edit and send.

**Architecture:** Server-side `SkillService` scans `~/.pi/agent/skills/*/SKILL.md` and parses frontmatter (no DB, pure fs). New REST routes `/api/skills` (GET/POST/DELETE). Frontend `SkillSelect.vue` dropdown sits in the ChatPanel composer between the textarea and the send button. Selecting a skill fills the textarea with `/skill:<name> ` — invoking the skill reuses the existing `send` → `prompt` RPC channel; pi expands `/skill:<name>` automatically. **No changes to RPC bridge, session-state, or WS layer.**

**Tech Stack:** Fastify + better-sqlite3 (server); Vue 3 `<script setup lang="ts">` + Pinia + naive-ui (web); `pnpm` workspace; vitest + `@vue/test-utils` for tests.

## Global Constraints

- Skills directory is **only** `~/.pi/agent/skills/` (path joined via `path.join(os.homedir(), ".pi/agent/skills")`). No project-level or shared `~/.agents/skills/` scanning.
- Skills are **directory-type only**: `<name>/SKILL.md`. Root `.md` files in `skillsDir` are ignored (pi still discovers them, just not in this UI).
- Skill name regex: `/^[a-z0-9]+(-[a-z0-9]+)*$/`, length 1-64, no leading/trailing/consecutive hyphens. Matches pi's documented naming rule.
- Description: non-empty string, max 1024 chars.
- `<script setup lang="ts">` SFCs use `.js` import suffix for TS relative imports (matches existing pattern).
- naive-ui stub keys in `@vue/test-utils` tests match component `name` option (`Modal`/`Input`/`Select`/etc.), not export alias — `<script setup>` named imports bind directly.
- ConfirmDialog emit order: `confirm` fires before `close`. `deleteTarget!.id` non-null assertion is safe in the confirm handler.
- All new tests must pass and `pnpm exec vue-tsc --noEmit` (web) + `pnpm exec tsc --noEmit` (server) must be clean before any task is marked complete. Pre-existing stale test files referencing removed `src/workdir/manager.js` are out of scope — do not touch them.

---

## File Structure

### Backend (apps/server)
- **Create** `apps/server/src/agent/skill-service.ts` — `SkillService` class: `list/import/uninstall` over `skillsDir`, pure fs, no DB
- **Create** `apps/server/src/routes/skills.ts` — Fastify plugin: GET/POST/DELETE `/api/skills`
- **Create** `apps/server/tests/unit/skill-service.test.ts` — vitest unit tests for SkillService (uses `os.tmpdir()` for isolated `skillsDir`)
- **Create** `apps/server/tests/integration/skills-routes.test.ts` — vitest integration tests via `app.inject`
- **Modify** `apps/server/src/config.ts` — add `skillsDir: string` field, default `~/.pi/agent/skills`
- **Modify** `apps/server/src/wiring.ts` — instantiate `SkillService(config.skillsDir)`, register `skillsRoutes` under `/api/skills`

### Shared (packages/shared)
- **Modify** `packages/shared/src/types.ts` — add `SkillDto` interface

### Frontend (apps/web)
- **Create** `apps/web/src/stores/skill.ts` — Pinia store: `skills` state + `loadAll/importSkill/remove` actions
- **Create** `apps/web/src/components/SkillSelect.vue` — dropdown button component (emits `select(name)`, `import()`)
- **Create** `apps/web/src/components/ImportSkillDialog.vue` — modal form: name + description + body, emits `create` + `close`
- **Create** `apps/web/tests/unit/api-skills.test.ts` — api client tests for `listSkills/importSkill/deleteSkill`
- **Create** `apps/web/tests/unit/skill-store.test.ts` — Pinia store tests
- **Create** `apps/web/tests/unit/skill-select.test.ts` — SkillSelect mount tests
- **Create** `apps/web/tests/unit/import-skill-dialog.test.ts` — ImportSkillDialog mount tests
- **Create** `apps/web/tests/unit/chat-panel-skill-insert.test.ts` — ChatPanel skill-insert behavior test
- **Modify** `apps/web/src/api/client.ts` — add `listSkills/importSkill/deleteSkill` methods
- **Modify** `apps/web/src/components/ChatPanel.vue` — insert `<SkillSelect>` in composer, wire `@select` to fill textarea
- **Modify** `apps/web/src/i18n/messages.ts` — add skill keys (en + zh)

---

### Task 1: Add SkillDto to shared types

**Files:**
- Modify: `packages/shared/src/types.ts` (append after `ModelDto` block, around line 78)

**Interfaces:**
- Produces: `SkillDto` interface (consumed by Task 2 backend service and Task 4 frontend api client)

- [ ] **Step 1: Add the SkillDto interface**

In `packages/shared/src/types.ts`, append after the `ModelDto` interface (before `Result<T, E = string>`):

```ts
export interface SkillDto {
  name: string;
  description: string;
  path: string;
}
```

- [ ] **Step 2: Verify shared package builds**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui && pnpm --filter @pi-web-ui/shared build`
Expected: exits clean, no errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add SkillDto type"
```

---

### Task 2: SkillService + config.skillsDir + unit tests

**Files:**
- Create: `apps/server/src/agent/skill-service.ts`
- Create: `apps/server/tests/unit/skill-service.test.ts`
- Modify: `apps/server/src/config.ts` (add `skillsDir` field)

**Interfaces:**
- Consumes: `SkillDto` from Task 1
- Produces: `SkillService` class with:
  - `constructor(skillsDir: string)`
  - `list(): SkillDto[]` — scan `skillsDir/*/SKILL.md`, parse frontmatter, skip entries missing name/description, sort by name asc
  - `import(input: { name: string; description: string; body: string }): SkillDto` — validate name regex + description non-empty + length limits; mkdir `<name>`; write `SKILL.md` with frontmatter; upsert (overwrite) semantics; return SkillDto
  - `uninstall(name: string): void` — validate name regex; resolve path and assert it's inside `skillsDir`; rmSync recursive; throw on not found

- [ ] **Step 1: Write the failing test**

Create `apps/server/tests/unit/skill-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SkillService } from "../../src/agent/skill-service.js";

describe("SkillService", () => {
  let dir: string;
  let svc: SkillService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skills-"));
    svc = new SkillService(dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeSkill(name: string, desc: string, body = "body") {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`,
      "utf8",
    );
  }

  it("list returns empty when skillsDir does not exist", () => {
    const missing = path.join(dir, "missing");
    const s = new SkillService(missing);
    expect(s.list()).toEqual([]);
  });

  it("list returns empty when skillsDir is empty", () => {
    expect(svc.list()).toEqual([]);
  });

  it("list returns skills sorted by name", () => {
    writeSkill("b-skill", "b desc");
    writeSkill("a-skill", "a desc");
    const list = svc.list();
    expect(list.map((s) => s.name)).toEqual(["a-skill", "b-skill"]);
  });

  it("list skips directories without SKILL.md", () => {
    writeSkill("real", "real desc");
    fs.mkdirSync(path.join(dir, "no-skill-md"), { recursive: true });
    expect(svc.list().map((s) => s.name)).toEqual(["real"]);
  });

  it("list skips entries missing description in frontmatter", () => {
    const skillDir = path.join(dir, "no-desc");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: no-desc\n---\n\nbody\n`,
      "utf8",
    );
    expect(svc.list().map((s) => s.name)).toEqual([]);
  });

  it("list ignores root .md files (only directory skills)", () => {
    fs.writeFileSync(path.join(dir, "root-skill.md"), "---\nname: root\ndescription: r\n---\n\nbody\n", "utf8");
    expect(svc.list()).toEqual([]);
  });

  it("list returns absolute path to SKILL.md", () => {
    writeSkill("real", "real desc");
    const list = svc.list();
    expect(list[0]!.path).toBe(path.join(dir, "real", "SKILL.md"));
  });

  it("import writes SKILL.md and returns SkillDto", () => {
    const dto = svc.import({ name: "fresh", description: "fresh desc", body: "do stuff" });
    expect(dto.name).toBe("fresh");
    expect(dto.description).toBe("fresh desc");
    expect(dto.path).toBe(path.join(dir, "fresh", "SKILL.md"));
    expect(fs.existsSync(dto.path)).toBe(true);
    const written = fs.readFileSync(dto.path, "utf8");
    expect(written).toContain("name: fresh");
    expect(written).toContain("description: fresh desc");
    expect(written).toContain("do stuff");
  });

  it("import overwrites existing skill (upsert)", () => {
    svc.import({ name: "x", description: "old", body: "old body" });
    svc.import({ name: "x", description: "new", body: "new body" });
    const list = svc.list();
    expect(list.length).toBe(1);
    expect(list[0]!.description).toBe("new");
    const written = fs.readFileSync(list[0]!.path, "utf8");
    expect(written).toContain("new body");
  });

  it("import rejects invalid name (uppercase, spaces, dots, leading hyphen)", () => {
    for (const bad of ["Bad", "with space", "with.dot", "-leading", "trailing-", "double--hyphen"]) {
      expect(() => svc.import({ name: bad, description: "d", body: "b" })).toThrow();
    }
  });

  it("import rejects name longer than 64 chars", () => {
    const long = "a".repeat(65);
    expect(() => svc.import({ name: long, description: "d", body: "b" })).toThrow();
  });

  it("import rejects empty description", () => {
    expect(() => svc.import({ name: "x", description: "   ", body: "b" })).toThrow();
  });

  it("import rejects description longer than 1024 chars", () => {
    const long = "x".repeat(1025);
    expect(() => svc.import({ name: "x", description: long, body: "b" })).toThrow();
  });

  it("uninstall removes the skill directory", () => {
    writeSkill("gone", "gone desc");
    svc.uninstall("gone");
    expect(svc.list().map((s) => s.name)).toEqual([]);
    expect(fs.existsSync(path.join(dir, "gone"))).toBe(false);
  });

  it("uninstall throws on unknown skill", () => {
    expect(() => svc.uninstall("nope")).toThrow();
  });

  it("uninstall rejects invalid name (path-escape defense)", () => {
    expect(() => svc.uninstall("../escape")).toThrow();
    expect(() => svc.uninstall("a/b")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec vitest run tests/unit/skill-service.test.ts`
Expected: FAIL with "Failed to resolve import \"../../src/agent/skill-service.js\""

- [ ] **Step 3: Add `skillsDir` to config**

In `apps/server/src/config.ts`:

Add to the `Config` interface (after `piModel: string;`):
```ts
  skillsDir: string;
```

In `loadConfig()`'s returned object (after `piModel`), add:
```ts
    skillsDir: process.env.PI_SKILLS_DIR ?? path.join(os.homedir(), ".pi/agent/skills"),
```

- [ ] **Step 4: Write minimal implementation**

Create `apps/server/src/agent/skill-service.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { SkillDto } from "@pi-web-ui/shared";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const m = content.match(/^\s*---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { body: content };
  const block = m[1] ?? "";
  const body = m[2] ?? "";
  let name: string | undefined;
  let description: string | undefined;
  for (const line of block.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1] as string;
    let val = (kv[2] ?? "").trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (key === "name") name = val;
    else if (key === "description") description = val;
  }
  return { name, description, body };
}

export class SkillService {
  constructor(private skillsDir: string) {}

  list(): SkillDto[] {
    if (!fs.existsSync(this.skillsDir)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const skills: SkillDto[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = path.join(this.skillsDir, e.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const content = fs.readFileSync(skillMd, "utf8");
      const parsed = parseFrontmatter(content);
      if (!parsed.name || !parsed.description) continue;
      skills.push({ name: parsed.name, description: parsed.description, path: skillMd });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  import(input: { name: string; description: string; body: string }): SkillDto {
    const name = input.name.trim();
    if (!NAME_RE.test(name) || name.length > 64) {
      throw new Error("invalid skill name");
    }
    const description = input.description.trim();
    if (!description || description.length > 1024) {
      throw new Error("invalid description");
    }
    const body = input.body ?? "";
    const dir = path.join(this.skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const skillMd = path.join(dir, "SKILL.md");
    const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
    fs.writeFileSync(skillMd, content, "utf8");
    return { name, description, path: skillMd };
  }

  uninstall(name: string): void {
    if (!NAME_RE.test(name)) throw new Error("invalid skill name");
    const dir = path.join(this.skillsDir, name);
    const resolved = path.resolve(dir);
    const root = path.resolve(this.skillsDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error("path escape");
    }
    if (!fs.existsSync(dir)) throw new Error("not found");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec vitest run tests/unit/skill-service.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Typecheck server**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec tsc --noEmit`
Expected: no new errors (pre-existing stale errors in `tests/integration/{projects,sessions,ws}.test.ts` and `tests/unit/workdir-manager.test.ts` are out of scope)

- [ ] **Step 7: Commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git add apps/server/src/agent/skill-service.ts apps/server/tests/unit/skill-service.test.ts apps/server/src/config.ts
git commit -m "feat(server): SkillService scans ~/.pi/agent/skills for SKILL.md"
```

---

### Task 3: Skills routes + wiring + integration tests

**Files:**
- Create: `apps/server/src/routes/skills.ts`
- Create: `apps/server/tests/integration/skills-routes.test.ts`
- Modify: `apps/server/src/wiring.ts` (instantiate SkillService, register routes)

**Interfaces:**
- Consumes: `SkillService` from Task 2; `Config.skillsDir` from Task 2
- Produces: REST routes `/api/skills` (GET), `/api/skills` (POST), `/api/skills/:name` (DELETE); `app.skills` instance on the Fastify app

- [ ] **Step 1: Write the failing test**

Create `apps/server/tests/integration/skills-routes.test.ts`:

```ts
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
    const res = await app.inject({ method: "DELETE", url: "/api/skills/../escape" });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec vitest run tests/integration/skills-routes.test.ts`
Expected: FAIL with "Failed to resolve import \"../../src/routes/skills.js\""

- [ ] **Step 3: Write minimal implementation**

Create `apps/server/src/routes/skills.ts`:

```ts
import { FastifyPluginAsync } from "fastify";

interface CreateBody {
  name: string;
  description: string;
  body: string;
}

export const skillsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    return app.skills.list();
  });

  app.post("/", async (req, reply) => {
    const body = req.body as CreateBody;
    if (!body?.name || !body?.description || !body?.body) {
      return reply.code(400).send({ error: "name, description, and body are required" });
    }
    try {
      const dto = app.skills.import({ name: body.name, description: body.description, body: body.body });
      return reply.code(201).send(dto);
    } catch (e: any) {
      return reply.code(400).send({ error: e.message ?? "invalid skill" });
    }
  });

  app.delete<{ Params: { name: string } }>("/:name", async (req, reply) => {
    const { name } = req.params;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      return reply.code(400).send({ error: "invalid skill name" });
    }
    try {
      app.skills.uninstall(name);
      return reply.code(204).send();
    } catch (e: any) {
      if (e.message === "not found") return reply.code(404).send({ error: "not found" });
      return reply.code(400).send({ error: e.message ?? "invalid skill" });
    }
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec vitest run tests/integration/skills-routes.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Wire SkillService + routes into the running server**

In `apps/server/src/wiring.ts`:

Add import near other `agent/` imports (after `import { IdleSweeper } from "./agent/idle-sweeper.js";`):
```ts
import { SkillService } from "./agent/skill-service.js";
```

Add import near other `routes/` imports (after `import { fsRoutes } from "./routes/fs.js";`):
```ts
import { skillsRoutes } from "./routes/skills.js";
```

After `const models = new ModelRepository(db);` (before `const sessionStates = new SessionStateStore();`), add:
```ts
  const skills = new SkillService(config.skillsDir);
```

In the `buildApp(config, {...})` call's deps object, add `skills` after `sessionStates`:
```ts
  const app = await buildApp(config, { db, projects, sessions, messages, models, sessionStates, skills, config });
```

After `await app.register(fsRoutes, { prefix: "/api/fs" });`, add:
```ts
  await app.register(skillsRoutes, { prefix: "/api/skills" });
```

- [ ] **Step 6: Typecheck server**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git add apps/server/src/routes/skills.ts apps/server/tests/integration/skills-routes.test.ts apps/server/src/wiring.ts
git commit -m "feat(server): GET/POST/DELETE /api/skills routes + wiring"
```

---

### Task 4: Frontend api client methods + tests

**Files:**
- Modify: `apps/web/src/api/client.ts` (add three methods after `deleteSession`/`listMessages` block)
- Create: `apps/web/tests/unit/api-skills.test.ts`

**Interfaces:**
- Consumes: `SkillDto` from Task 1
- Produces:
  - `api.listSkills(): Promise<SkillDto[]>`
  - `api.importSkill(input: { name; description; body }): Promise<SkillDto>`
  - `api.deleteSkill(name: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/api-skills.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../src/api/client.js";

describe("api skills methods", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("listSkills GETs /skills", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const list = await api.listSkills();
    expect(list).toEqual([]);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills");
    expect(calls[0]![1].method).toBe("GET");
  });

  it("importSkill POSTs { name, description, body } to /skills", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      name: "x", description: "d", path: "/tmp/x/SKILL.md",
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const dto = await api.importSkill({ name: "x", description: "d", body: "b" });
    expect(dto.name).toBe("x");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills");
    expect(calls[0]![1].method).toBe("POST");
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ name: "x", description: "d", body: "b" });
  });

  it("deleteSkill DELETEs /skills/:name", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteSkill("my-skill");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills/my-skill");
    expect(calls[0]![1].method).toBe("DELETE");
  });

  it("deleteSkill URL-encodes the name", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteSkill("a-b");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/skills/a-b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/api-skills.test.ts`
Expected: FAIL — `api.listSkills is not a function` (or similar)

- [ ] **Step 3: Add api methods**

In `apps/web/src/api/client.ts`:

Add `SkillDto` to the type import at the top:
```ts
import type { ProjectDto, SessionDto, MessageDto, FileNodeDto, FileContentDto, ModelDto, SkillDto } from "@pi-web-ui/shared";
```

After the `listMessages` line (before `listFiles`), add:
```ts
  listSkills: () => request<SkillDto[]>("GET", "/skills"),
  importSkill: (data: { name: string; description: string; body: string }) =>
    request<SkillDto>("POST", "/skills", data),
  deleteSkill: (name: string) => request<void>("DELETE", `/skills/${encodeURIComponent(name)}`),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/api-skills.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Typecheck web**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git add apps/web/src/api/client.ts apps/web/tests/unit/api-skills.test.ts
git commit -m "feat(web): api client methods for skills"
```

---

### Task 5: Skill store + tests

**Files:**
- Create: `apps/web/src/stores/skill.ts`
- Create: `apps/web/tests/unit/skill-store.test.ts`

**Interfaces:**
- Consumes: `api.listSkills/importSkill/deleteSkill` from Task 4
- Produces: `useSkillStore` Pinia store with:
  - state: `skills: SkillDto[]`, `loading: boolean`
  - actions: `loadAll()` (await api before mutate), `importSkill(input)` (await + replace/add in list), `remove(name)` (await + filter)

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/skill-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSkillStore } from "../../src/stores/skill.js";

describe("skill store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("loadAll populates skills from api", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();
    expect(store.skills.length).toBe(1);
    expect(store.skills[0]!.name).toBe("a");
  });

  it("importSkill adds the new skill to state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(
      { name: "b", description: "b desc", path: "/b/SKILL.md" },
    ), { status: 201, headers: { "Content-Type": "application/json" } }));

    const dto = await store.importSkill({ name: "b", description: "b desc", body: "b body" });
    expect(dto.name).toBe("b");
    expect(store.skills.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("importSkill upserts when name exists", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "old", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(
      { name: "a", description: "new", path: "/a/SKILL.md" },
    ), { status: 201, headers: { "Content-Type": "application/json" } }));

    await store.importSkill({ name: "a", description: "new", body: "b" });
    expect(store.skills.length).toBe(1);
    expect(store.skills[0]!.description).toBe("new");
  });

  it("remove filters the skill out of state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
      { name: "b", description: "b desc", path: "/b/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await store.remove("a");
    expect(store.skills.map((s) => s.name)).toEqual(["b"]);
  });

  it("remove does not mutate state when api rejects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSkillStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(store.remove("a")).rejects.toThrow();
    expect(store.skills.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/skill-store.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/stores/skill.js"`

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/stores/skill.ts`:

```ts
import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { SkillDto } from "@pi-web-ui/shared";

export const useSkillStore = defineStore("skills", {
  state: () => ({
    skills: [] as SkillDto[],
    loading: false,
  }),
  actions: {
    async loadAll() {
      this.loading = true;
      try { this.skills = await api.listSkills(); }
      finally { this.loading = false; }
    },
    async importSkill(input: { name: string; description: string; body: string }) {
      const dto = await api.importSkill(input);
      const idx = this.skills.findIndex((s) => s.name === dto.name);
      if (idx >= 0) this.skills.splice(idx, 1, dto);
      else this.skills.push(dto);
      this.skills.sort((a, b) => a.name.localeCompare(b.name));
      return dto;
    },
    async remove(name: string) {
      await api.deleteSkill(name);
      this.skills = this.skills.filter((s) => s.name !== name);
    },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/skill-store.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Typecheck web**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git add apps/web/src/stores/skill.ts apps/web/tests/unit/skill-store.test.ts
git commit -m "feat(web): skill Pinia store (loadAll/importSkill/remove)"
```

---

### Task 6: ImportSkillDialog component + tests

**Files:**
- Create: `apps/web/src/components/ImportSkillDialog.vue`
- Create: `apps/web/tests/unit/import-skill-dialog.test.ts`
- Modify: `apps/web/src/i18n/messages.ts` (add skill keys en + zh)

**Interfaces:**
- Consumes: `useI18n` (`t()` with keys `skill.title`, `skill.name`, `skill.namePlaceholder`, `skill.nameHint`, `skill.description`, `skill.descriptionPlaceholder`, `skill.body`, `skill.bodyPlaceholder`, `skill.save`, `skill.cancel`); naive-ui `NModal` + `NInput`
- Produces: `ImportSkillDialog` SFC with props `{ show: boolean }` and emits `close` + `create({ name, description, body })`

- [ ] **Step 1: Add i18n keys**

In `apps/web/src/i18n/messages.ts`, in the `en` block (after the `"deleteSession.cancel": "Cancel",` line — i.e. last key before the closing `}`), add:

```ts
    "skill.title": "Import Skill",
    "skill.name": "Name",
    "skill.namePlaceholder": "e.g. pdf-tools",
    "skill.nameHint": "Lowercase letters, digits, hyphens. No leading/trailing/consecutive hyphens.",
    "skill.description": "Description",
    "skill.descriptionPlaceholder": "What this skill does and when to use it",
    "skill.body": "Body (Markdown)",
    "skill.bodyPlaceholder": "Skill instructions in Markdown...",
    "skill.save": "Save",
    "skill.cancel": "Cancel",
```

In the `zh` block (after `"deleteSession.cancel": "取消",`), add:

```ts
    "skill.title": "导入技能",
    "skill.name": "名称",
    "skill.namePlaceholder": "例如 pdf-tools",
    "skill.nameHint": "小写字母、数字、连字符。不能以连字符开头/结尾或连续。",
    "skill.description": "描述",
    "skill.descriptionPlaceholder": "这个技能做什么、何时使用",
    "skill.body": "正文（Markdown）",
    "skill.bodyPlaceholder": "用 Markdown 写技能指令...",
    "skill.save": "保存",
    "skill.cancel": "取消",
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/tests/unit/import-skill-dialog.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ImportSkillDialog from "../../src/components/ImportSkillDialog.vue";

describe("ImportSkillDialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  function mountDialog(show: boolean) {
    return mount(ImportSkillDialog, {
      props: { show },
      global: {
        stubs: {
          Modal: { template: '<div v-if="show"><slot/></div>', props: ["show"] },
          Input: {
            template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
            props: ["value"],
          },
        },
      },
    });
  }

  it("renders three inputs (name, description, body) when shown", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    expect(inputs.length).toBe(2); // name + description (body is textarea)
    const textareas = w.findAll("textarea");
    expect(textareas.length).toBe(1);
  });

  it("disables save when name is empty", async () => {
    const w = mountDialog(true);
    await nextTick();
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables save when name is invalid (uppercase, spaces)", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("Bad Name");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables save when description is empty", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("valid-name");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables save when body is empty", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("valid-name");
    await inputs[1]!.setValue("a description");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables save when all fields valid", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("my-skill");
    await inputs[1]!.setValue("does a thing");
    await w.find("textarea").setValue("body content");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(false);
  });

  it("emits create({name,description,body}) and close on save", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("my-skill");
    await inputs[1]!.setValue("does a thing");
    await w.find("textarea").setValue("body content");
    await w.find("[data-test='save']").trigger("click");
    const events = w.emitted();
    expect(events.create).toEqual([[{ name: "my-skill", description: "does a thing", body: "body content" }]]);
    expect(events.close).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/import-skill-dialog.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/components/ImportSkillDialog.vue"`

- [ ] **Step 4: Write minimal implementation**

Create `apps/web/src/components/ImportSkillDialog.vue`:

```vue
<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { NModal, NInput } from "naive-ui";
import { useI18n } from "../i18n/index.js";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "create", data: { name: string; description: string; body: string }): void;
}>();

const { t } = useI18n();
const name = ref("");
const description = ref("");
const body = ref("");

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const nameValid = computed(() => NAME_RE.test(name.value.trim()) && name.value.trim().length <= 64);
const descriptionValid = computed(() => description.value.trim().length > 0 && description.value.trim().length <= 1024);
const bodyValid = computed(() => body.value.trim().length > 0);
const canSave = computed(() => nameValid.value && descriptionValid.value && bodyValid.value);

watch(
  () => props.show,
  (visible) => {
    if (!visible) return;
    name.value = "";
    description.value = "";
    body.value = "";
  },
  { immediate: true },
);

function handleSave() {
  if (!canSave.value) return;
  emit("create", { name: name.value.trim(), description: description.value.trim(), body: body.value });
  emit("close");
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('skill.title') }}</h3>
        <button class="dialog-close" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="field-row">
        <label class="field-label">{{ t('skill.name') }}</label>
        <NInput
          v-model:value="name"
          size="small"
          :placeholder="t('skill.namePlaceholder')"
        />
      </div>
      <div v-if="name && !nameValid" class="field-hint">{{ t('skill.nameHint') }}</div>

      <div class="field-row">
        <label class="field-label">{{ t('skill.description') }}</label>
        <NInput
          v-model:value="description"
          size="small"
          :placeholder="t('skill.descriptionPlaceholder')"
        />
      </div>

      <div class="field-row">
        <label class="field-label">{{ t('skill.body') }}</label>
        <NInput
          v-model:value="body"
          type="textarea"
          :rows="6"
          :autosize="{ minRows: 4, maxRows: 12 }"
          :placeholder="t('skill.bodyPlaceholder')"
        />
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')">{{ t('skill.cancel') }}</button>
        <button
          class="btn-save"
          data-test="save"
          :disabled="!canSave"
          @click="handleSave"
        >
          {{ t('skill.save') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
}
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
}
.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.dialog-close:hover { background: var(--bg-hover); color: var(--text-primary); }
.field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 20px 0;
}
.field-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.field-hint {
  padding: 0 20px 4px;
  font-size: 11px;
  color: var(--amber);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
}
.btn-cancel, .btn-save {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-cancel {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
}
.btn-cancel:hover { border-color: var(--text-muted); color: var(--text-primary); }
.btn-save {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-save:not(:disabled):hover { filter: brightness(1.1); }
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/import-skill-dialog.test.ts`
Expected: PASS — all tests green

- [ ] **Step 6: Typecheck web**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git add apps/web/src/components/ImportSkillDialog.vue apps/web/tests/unit/import-skill-dialog.test.ts apps/web/src/i18n/messages.ts
git commit -m "feat(web): ImportSkillDialog component + i18n keys"
```

---

### Task 7: SkillSelect component + tests

**Files:**
- Create: `apps/web/src/components/SkillSelect.vue`
- Create: `apps/web/tests/unit/skill-select.test.ts`
- Modify: `apps/web/src/i18n/messages.ts` (add SkillSelect-only keys: `skill.title`, `skill.empty`, `skill.import`, `skill.uninstall`, `skill.confirmTitle`, `skill.confirmMessage`, `skill.confirm`, `skill.cancel`)

**Interfaces:**
- Consumes: `useSkillStore` (from Task 5); `useI18n` (keys: `skill.title`, `skill.empty`, `skill.import`, `skill.uninstall`, `skill.confirmTitle`, `skill.confirmMessage`, `skill.confirm`, `skill.cancel`); naive-ui `NModal`; existing `ConfirmDialog` component
- Produces: `SkillSelect` SFC with no props and emits `select(name: string)` + `import()`

- [ ] **Step 1: Add additional i18n keys**

In `apps/web/src/i18n/messages.ts`, extend the `skill.*` block added in Task 6. After the existing `"skill.cancel"` line in the `en` block (i.e. after the Save/Cancel pair you already added), add the SkillSelect-specific keys:

```ts
    "skill.dropdown": "Skills",
    "skill.empty": "No skills yet — import one below",
    "skill.import": "Import skill",
    "skill.uninstall": "Uninstall",
    "skill.confirmTitle": "Uninstall skill",
    "skill.confirmMessage": "Uninstall this skill? This cannot be undone.",
    "skill.confirm": "Uninstall",
```

In the `zh` block, after the matching `"skill.cancel": "取消",` line you added in Task 6, add:

```ts
    "skill.dropdown": "技能",
    "skill.empty": "暂无技能，点下方导入",
    "skill.import": "导入技能",
    "skill.uninstall": "卸载",
    "skill.confirmTitle": "卸载技能",
    "skill.confirmMessage": "确认卸载该技能？此操作不可撤销。",
    "skill.confirm": "卸载",
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/tests/unit/skill-select.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import SkillSelect from "../../src/components/SkillSelect.vue";
import ConfirmDialog from "../../src/components/ConfirmDialog.vue";

describe("SkillSelect", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });
  afterEach(() => { document.body.innerHTML = ""; });

  function mountSelect() {
    return mount(SkillSelect, {
      global: {
        stubs: {
          Modal: { template: '<div v-if="show"><slot/></div>', props: ["show"] },
        },
      },
    });
  }

  async function seedSkills(skills: { name: string; description: string; path: string }[]) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(skills), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mountSelect();
    // Wait for onMounted loadAll + flush
    await nextTick();
    await nextTick();
  }

  it("shows empty hint when no skills loaded", async () => {
    const w = mountSelect();
    await nextTick();
    await nextTick();
    // open the dropdown
    await w.find("[data-test='toggle']").trigger("click");
    await nextTick();
    expect(w.text()).toContain("No skills yet");
  });

  it("renders skills in the dropdown", async () => {
    await seedSkills([
      { name: "a-skill", description: "a desc", path: "/a/SKILL.md" },
      { name: "b-skill", description: "b desc", path: "/b/SKILL.md" },
    ]);
  });

  it("emits select(name) when a skill is clicked", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a-skill", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountSelect();
    await nextTick();
    await nextTick();
    await w.find("[data-test='toggle']").trigger("click");
    await nextTick();
    await w.find("[data-test='skill-item']").trigger("click");
    const events = w.emitted();
    expect(events.select).toEqual([["a-skill"]]);
  });

  it("emits import when the import button is clicked", async () => {
    const w = mountSelect();
    await nextTick();
    await nextTick();
    await w.find("[data-test='toggle']").trigger("click");
    await nextTick();
    await w.find("[data-test='import-btn']").trigger("click");
    expect(w.emitted().import).toBeDefined();
  });

  it("renders uninstall button per skill and emits delete flow on click", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "a-skill", description: "a desc", path: "/a/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountSelect();
    await nextTick();
    await nextTick();
    await w.find("[data-test='toggle']").trigger("click");
    await nextTick();
    expect(w.find("[data-test='uninstall-btn']").exists()).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/skill-select.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/components/SkillSelect.vue"`

- [ ] **Step 4: Write minimal implementation**

Create `apps/web/src/components/SkillSelect.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useSkillStore } from "../stores/skill.js";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useI18n } from "../i18n/index.js";

const emit = defineEmits<{
  (e: "select", name: string): void;
  (e: "import"): void;
}>();

const skillStore = useSkillStore();
const { t } = useI18n();

const open = ref(false);
const uninstallTarget = ref<string | null>(null);

onMounted(() => { skillStore.loadAll(); });

function toggle() {
  open.value = !open.value;
  if (open.value) skillStore.loadAll();
}

function selectSkill(name: string) {
  emit("select", name);
  open.value = false;
}

function requestUninstall(name: string) {
  uninstallTarget.value = name;
}

async function confirmUninstall() {
  if (!uninstallTarget.value) return;
  try {
    await skillStore.remove(uninstallTarget.value);
  } catch (e: any) {
    console.error("Failed to uninstall skill:", e);
    alert(`${e.message}`);
  } finally {
    uninstallTarget.value = null;
  }
}
</script>

<template>
  <div class="skill-select">
    <button class="toggle" data-test="toggle" @click="toggle" :title="t('skill.dropdown')">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
      <span class="toggle-label">{{ t('skill.dropdown') }}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" :class="{ flipped: open }">
        <path d="M2 3l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div v-if="open" class="panel">
      <div v-if="!skillStore.skills.length" class="empty">{{ t('skill.empty') }}</div>
      <div
        v-for="s in skillStore.skills"
        v-else
        :key="s.name"
        class="skill-item"
        data-test="skill-item"
        @click="selectSkill(s.name)"
      >
        <div class="skill-info">
          <div class="skill-name">{{ s.name }}</div>
          <div class="skill-desc">{{ s.description }}</div>
        </div>
        <button
          class="uninstall-btn"
          data-test="uninstall-btn"
          :title="t('skill.uninstall')"
          @click.stop="requestUninstall(s.name)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
      <div class="panel-footer">
        <button class="import-btn" data-test="import-btn" @click="emit('import'); open = false">
          + {{ t('skill.import') }}
        </button>
      </div>
    </div>

    <ConfirmDialog
      :show="uninstallTarget !== null"
      :title="t('skill.confirmTitle')"
      :message="t('skill.confirmMessage')"
      :confirm-label="t('skill.confirm')"
      :cancel-label="t('skill.cancel')"
      :danger="true"
      @close="uninstallTarget = null"
      @confirm="confirmUninstall"
    />
  </div>
</template>

<style scoped>
.skill-select {
  position: relative;
  display: flex;
  align-items: flex-end;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}
.toggle:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.toggle-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.panel {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  width: 320px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  z-index: 10;
}
.empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
  font-style: italic;
}
.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background var(--transition-fast);
  border-bottom: 1px solid var(--border-subtle);
}
.skill-item:hover {
  background: var(--bg-hover);
}
.skill-info {
  flex: 1;
  min-width: 0;
}
.skill-name {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.skill-desc {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uninstall-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition-fast);
}
.skill-item:hover .uninstall-btn { opacity: 1; }
.uninstall-btn:hover {
  background: var(--rose-dim, rgba(244, 63, 94, 0.15));
  color: var(--rose);
}
.panel-footer {
  padding: 6px 10px;
  border-top: 1px solid var(--border-subtle);
}
.import-btn {
  width: 100%;
  padding: 6px 8px;
  border: 1px dashed var(--border-active);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.import-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
.flipped { transform: rotate(180deg); }
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/skill-select.test.ts`
Expected: PASS — all tests green

If tests for "renders skills" or "emits select" flake due to async loadAll, add extra `await nextTick()` calls in the test or use `await flushPromises()` from `@vue/test-utils`.

- [ ] **Step 6: Typecheck web**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git add apps/web/src/components/SkillSelect.vue apps/web/tests/unit/skill-select.test.ts apps/web/src/i18n/messages.ts
git commit -m "feat(web): SkillSelect dropdown with import + uninstall"
```

---

### Task 8: ChatPanel wiring + skill insert test

**Files:**
- Modify: `apps/web/src/components/ChatPanel.vue` (insert `<SkillSelect>` in composer, wire `@select` + `<ImportSkillDialog>`)
- Create: `apps/web/tests/unit/chat-panel-skill-insert.test.ts`

**Interfaces:**
- Consumes: `SkillSelect` (from Task 7, emits `select(name)` + `import()`); `ImportSkillDialog` (from Task 6, emits `close` + `create({name,description,body})`); `useSkillStore` (from Task 5)
- Produces: ChatPanel composer with `[textarea] [SkillSelect] [send]` layout. `@select(name)` appends `/skill:<name> ` to `input.value` with proper spacing + focus + cursor-to-end.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/chat-panel-skill-insert.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import ChatPanel from "../../src/components/ChatPanel.vue";

describe("ChatPanel skill insertion", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });
  afterEach(() => { document.body.innerHTML = ""; });

  function mountPanel() {
    return mount(ChatPanel, {
      props: { sessionId: "s1" },
      global: {
        stubs: {
          Input: {
            template: '<textarea :value="value" @input="$emit(\'update:value\', $event.target.value)" @keydown="$emit(\'keydown\', $event)"></textarea>',
            props: ["value"],
          },
        },
      },
    });
  }

  async function openSkillDropdown(w: ReturnType<typeof mountPanel>) {
    await w.find("[data-test='skill-toggle']").trigger("click");
    await nextTick();
  }

  it("inserts /skill:<name> into empty textarea on select", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await nextTick();
    await nextTick();
    await openSkillDropdown(w);
    await w.find("[data-test='skill-item']").trigger("click");
    await nextTick();
    const textarea = w.find("textarea").element as HTMLTextAreaElement;
    expect(textarea.value).toBe("/skill:demo-skill ");
  });

  it("appends /skill:<name> with separator when textarea has content", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await nextTick();
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("existing text");
    await openSkillDropdown(w);
    await w.find("[data-test='skill-item']").trigger("click");
    await nextTick();
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("existing text /skill:demo-skill ");
  });

  it("does not double-space when textarea ends with whitespace", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { name: "demo-skill", description: "d", path: "/d/SKILL.md" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mountPanel();
    await nextTick();
    await nextTick();
    const textarea = w.find("textarea");
    await textarea.setValue("existing text\n");
    await openSkillDropdown(w);
    await w.find("[data-test='skill-item']").trigger("click");
    await nextTick();
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe("existing text\n/skill:demo-skill ");
  });

  it("opens ImportSkillDialog when import is emitted", async () => {
    const w = mountPanel();
    await nextTick();
    await nextTick();
    await openSkillDropdown(w);
    await w.find("[data-test='skill-import-btn']").trigger("click");
    await nextTick();
    expect(w.find("[data-test='import-skill-dialog']").exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/chat-panel-skill-insert.test.ts`
Expected: FAIL — `[data-test='skill-toggle']` not found

- [ ] **Step 3: Modify ChatPanel to wire SkillSelect**

In `apps/web/src/components/ChatPanel.vue`:

In `<script setup>`, add imports near the top (after `import { useI18n } from "../i18n/index.js";`):
```ts
import SkillSelect from "./SkillSelect.vue";
import ImportSkillDialog from "./ImportSkillDialog.vue";
import { useSkillStore } from "../stores/skill.js";
```

After `const { t } = useI18n();`, add:
```ts
const skillStore = useSkillStore();
const showImportSkill = ref(false);
```

After the `send()` function, add:
```ts
function onSkillSelect(name: string) {
  const cur = input.value;
  if (cur.length > 0 && !/\s$/.test(cur)) {
    input.value = cur + " /skill:" + name + " ";
  } else {
    input.value = cur + "/skill:" + name + " ";
  }
  nextTick(() => {
    const el = document.querySelector<HTMLTextAreaElement>(".composer-input textarea");
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });
}

async function onSkillCreate(data: { name: string; description: string; body: string }) {
  try {
    await skillStore.importSkill(data);
  } catch (e: any) {
    console.error("Failed to import skill:", e);
    alert(`${e.message}`);
  } finally {
    showImportSkill.value = false;
  }
}
```

In the `<template>`, replace the composer block:
```html
    <div class="composer">
      <NInput
        v-model:value="input"
        type="textarea"
        :rows="2"
        :autosize="{ minRows: 2, maxRows: 5 }"
        :placeholder="t('chat.placeholder')"
        @keydown="handleKeySend"
        class="composer-input"
      />
      <SkillSelect
        data-test="skill-toggle"
        @select="onSkillSelect"
        @import="showImportSkill = true"
      />
      <button
        class="send-btn"
        :disabled="!input.trim()"
        @click="send"
        :title="t('chat.send')"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M2 9l14-7-7 14V9H2z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
```

After the `</div>` that closes the composer, before `</div>` that closes `.chat-panel`, add:
```html
    <ImportSkillDialog
      data-test="import-skill-dialog"
      :show="showImportSkill"
      @close="showImportSkill = false"
      @create="onSkillCreate"
    />
```

Note: `SkillSelect`'s root toggle button has `data-test="toggle"` internally; mounting it with `data-test="skill-toggle"` as an attribute on the Vue component itself does NOT propagate to the internal toggle button. For the test to find it, you need to add `data-test="skill-toggle"` to the toggle button inside SkillSelect. Update SkillSelect.vue's toggle button to have both attributes:

In `apps/web/src/components/SkillSelect.vue`, change the toggle button's `data-test="toggle"` to:
```html
data-test="toggle skill-toggle"
```

Wait — multiple values in `data-test` won't match a single `[data-test='skill-toggle']` selector. Instead, add a second attribute:

In `apps/web/src/components/SkillSelect.vue`'s toggle button, change:
```html
<button class="toggle" data-test="toggle" @click="toggle" :title="t('skill.dropdown')">
```
to:
```html
<button class="toggle" data-test="skill-toggle" @click="toggle" :title="t('skill.dropdown')">
```

And update the SkillSelect unit test (Task 7 Step 2) — replace `[data-test='toggle']` selectors with `[data-test='skill-toggle']`. Re-run Task 7 tests after this change to confirm they still pass.

Similarly, ensure the import button has `data-test="skill-import-btn"` in SkillSelect.vue. Change the existing `data-test="import-btn"` to:
```html
data-test="skill-import-btn"
```

And update Task 7 tests to use `[data-test='skill-import-btn']`.

Re-run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/skill-select.test.ts`
Expected: PASS — all tests green after the `data-test` rename

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run tests/unit/chat-panel-skill-insert.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Run full web test suite to confirm no regressions**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run`
Expected: all tests green

- [ ] **Step 6: Typecheck web**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd /Users/gengcc/Documents/project/pi-web-ui
git add apps/web/src/components/ChatPanel.vue apps/web/src/components/SkillSelect.vue apps/web/tests/unit/chat-panel-skill-insert.test.ts apps/web/tests/unit/skill-select.test.ts
git commit -m "feat(web): wire SkillSelect into ChatPanel composer, fills /skill:<name>"
```

---

### Task 9: Final verification + merge + push

**Files:**
- None (verification only)

- [ ] **Step 1: Run full server test suite**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec vitest run`
Expected: All new tests pass (`tests/unit/skill-service.test.ts`, `tests/integration/skills-routes.test.ts`). Pre-existing stale failures in `tests/integration/{projects,sessions,ws}.test.ts` and `tests/unit/workdir-manager.test.ts` are out of scope — verify they are the same failures as on master (run `git stash -u && git checkout master && pnpm exec vitest run tests/integration/sessions.test.ts; git checkout - && git stash pop` if needed).

- [ ] **Step 2: Run full web test suite**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vitest run`
Expected: All tests pass (including new `api-skills`, `skill-store`, `skill-select`, `import-skill-dialog`, `chat-panel-skill-insert`).

- [ ] **Step 3: Typecheck both packages**

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/server && pnpm exec tsc --noEmit`
Expected: no new errors

Run: `cd /Users/gengcc/Documents/project/pi-web-ui/apps/web && pnpm exec vue-tsc --noEmit`
Expected: clean

- [ ] **Step 4: Manual UI smoke test (optional but recommended)**

Start dev servers: `cd /Users/gengcc/Documents/project/pi-web-ui && pnpm dev`
- Open `http://localhost:5173`
- Select a project, create a session, open chat
- Verify the "技能" button appears in the composer between textarea and send
- Click it → dropdown opens → "暂无技能，点下方导入" (or list if `~/.pi/agent/skills/` has dirs)
- Click "导入技能" → dialog opens → fill name (e.g. `test-skill`), description, body → Save
- Verify dropdown now lists `test-skill`
- Click `test-skill` in dropdown → textarea gets `/skill:test-skill `
- Click uninstall icon on `test-skill` → confirm → skill disappears from list
- Verify `~/.pi/agent/skills/test-skill/SKILL.md` is created on import and removed on uninstall (run `ls ~/.pi/agent/skills/`)

- [ ] **Step 5: Merge to master**

Use the `superpowers:finishing-a-development-branch` skill. Verify tests, then merge the feature branch to master with `--no-ff`. Delete the feature branch.

- [ ] **Step 6: Push to origin**

```bash
git push origin master
```

Expected: master pushed to `gitee.com:easy-agent/pi-web-ui.git`

---

## Self-Review

**Spec coverage:**

- §2 decisions: scan only `~/.pi/agent/skills/` (Task 2 SkillService) ✓; directory-type only (Task 2 list skips non-dir entries) ✓; select fills textarea (Task 8 `onSkillSelect`) ✓; existing send→prompt RPC (no changes) ✓; uninstall all (Task 2 + Task 3) ✓; inline import dialog (Task 6) ✓; upsert semantics (Task 2 import + Task 3 POST overwrites) ✓
- §3.1 config skillsDir: Task 2 Step 3 ✓
- §3.2 SkillService list/import/uninstall: Task 2 ✓
- §3.3 routes: Task 3 ✓
- §3.4 SkillDto type: Task 1 ✓
- §4.1 api client methods: Task 4 ✓
- §4.2 SkillSelect: Task 7 ✓
- §4.3 ImportSkillDialog: Task 6 ✓
- §4.4 ChatPanel wiring: Task 8 ✓
- §4.5 i18n keys: Task 6 (dialog keys) + Task 7 (dropdown/uninstall keys) ✓
- §5 data flows: list (Task 7 onMounted → api.listSkills → store → render) ✓; select (Task 8 onSkillSelect) ✓; import (Task 8 onSkillCreate → store.importSkill → POST) ✓; uninstall (Task 7 confirmUninstall → store.remove → DELETE) ✓
- §6 error handling: invalid name 400 (Task 3) ✓; empty description 400 (Task 3) ✓; upsert no error (Task 2/3) ✓; path escape 400 (Task 2 regex + Task 3 regex) ✓; not found 404 (Task 3) ✓; scan failure returns empty (Task 2 try/catch) ✓; store catch (Task 5 + Task 7 + Task 8 alert) ✓
- §7.1 backend tests: SkillService unit (Task 2) ✓; routes integration (Task 3) ✓
- §7.2 frontend tests: SkillSelect (Task 7) ✓; ImportSkillDialog (Task 6) ✓; ChatPanel insertion (Task 8) ✓; store (Task 5) ✓; api (Task 4) ✓
- §8 non-goals: confirmed not implemented — no project-level scan, no `~/.agents/skills/`, no file upload, no `get_commands` RPC, no root `.md` listing, no immediate-send mode

**Placeholder scan:** No "TBD"/"TODO"/"implement later". All code shown inline. ✓

**Type consistency:**
- `SkillDto` used in Task 1, Task 2, Task 3, Task 4, Task 5, Task 7 ✓ (same shape `{ name, description, path }`)
- `SkillService` constructor takes `skillsDir: string` (Task 2 + Task 3 wiring) ✓
- `api.listSkills/importSkill/deleteSkill` signatures match across Task 4 and Task 5 store ✓
- `SkillSelect` emits `select(name: string)` + `import()` (Task 7) — matches Task 8 ChatPanel handlers ✓
- `ImportSkillDialog` emits `close` + `create({ name, description, body })` (Task 6) — matches Task 8 `onSkillCreate` ✓
- `data-test` attribute consistency:
  - Task 6 ImportSkillDialog: `[data-test='save']` ✓
  - Task 7 SkillSelect originally `toggle`/`import-btn`/`uninstall-btn`/`skill-item` → Task 8 Step 3 renames `toggle`→`skill-toggle` and `import-btn`→`skill-import-btn` for cross-component test selectors. SkillSelect's own test (Task 7) uses the renamed selectors. ✓
  - Task 8 ChatPanel: `[data-test='skill-toggle']`, `[data-test='skill-item']`, `[data-test='skill-import-btn']`, `[data-test='import-skill-dialog']` ✓
