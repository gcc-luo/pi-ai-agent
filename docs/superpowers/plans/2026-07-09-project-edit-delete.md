# Project Edit & Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project rename (PUT /:id) and soft-delete (DELETE /:id with agent process cleanup) end-to-end — backend route + repo, frontend API/store/two dialogs, and Sidebar hover action buttons.

**Architecture:** Soft delete via a new `deleted_at` column on `projects`; list/findById filter it out. DELETE route kills the project's in-memory agent processes before soft-deleting. Frontend adds `updateProject` to the API client + store, a `RenameProjectDialog` (single name field) and a generic `ConfirmDialog`, wired into `Sidebar.vue` as hover-revealed icon buttons on each project list item.

**Tech Stack:** Fastify 4, better-sqlite3, vitest (backend); Vue 3 + Pinia + naive-ui + @vue/test-utils + vitest with jsdom (frontend); pnpm workspace.

## Global Constraints

- Node >= 20, pnpm 9.6.0, TypeScript 5.5.4
- Backend tests: `pnpm --filter @pi-web-ui/server test` (vitest)
- Frontend tests: `pnpm --filter @pi-web-ui/web test` (vitest, jsdom)
- Typecheck: `pnpm --filter @pi-web-ui/server typecheck` and `pnpm --filter @pi-web-ui/web typecheck`
- `workdir` is NEVER editable — edit scope is `name` only
- Soft delete only; recycle bin UI is out of scope (future spec)
- User-facing copy must be bilingual (en + zh) in `apps/web/src/i18n/messages.ts`
- Follow existing code style: no emojis in code; 2-space indent; inline scripts use `.js` import suffix in Vue SFCs (matches existing files)
- Pre-existing note: `apps/server/tests/integration/projects.test.ts` has stale tests (POST without `workdir` expects 201, but current route 400s). This is a pre-existing issue, NOT in scope — do not fix it. New integration tests go in a separate file.

---

## File Structure

**Backend (modify):**
- `apps/server/src/db/migrations.ts` — add `003_project_soft_delete` migration
- `apps/server/src/db/repositories/project.ts` — `list()`/`findById()` filter `deleted_at`; `delete()` soft-deletes
- `apps/server/src/routes/projects.ts` — add `PUT /:id`; rewrite `DELETE /:id` to kill processes + soft delete

**Backend (create tests):**
- `apps/server/tests/unit/project-repo-soft-delete.test.ts` — repo-level soft delete behavior
- `apps/server/tests/integration/projects-edit-delete.test.ts` — route-level PUT/DELETE with proper contract

**Frontend (modify):**
- `apps/web/src/api/client.ts` — add `updateProject`
- `apps/web/src/stores/project.ts` — add `update` action
- `apps/web/src/components/Sidebar.vue` — hover action buttons + dialog wiring + new emits
- `apps/web/src/App.vue` — handle `rename-project` + `delete-project` events
- `apps/web/src/i18n/messages.ts` — add `rename.*` and `delete.*` keys (en + zh)

**Frontend (create):**
- `apps/web/src/components/RenameProjectDialog.vue` — single-input rename dialog
- `apps/web/src/components/ConfirmDialog.vue` — generic confirm dialog
- `apps/web/tests/unit/rename-project-dialog.test.ts`
- `apps/web/tests/unit/confirm-dialog.test.ts`
- `apps/web/tests/unit/project-store-update.test.ts`
- `apps/web/tests/unit/api-update-project.test.ts`

---

### Task 1: DB migration — add `deleted_at` column to projects

**Files:**
- Modify: `apps/server/src/db/migrations.ts:42-56`
- Test: `apps/server/tests/integration/migrations.test.ts` (append case)

**Interfaces:**
- Produces: `projects.deleted_at INTEGER` column (nullable); existing repos unaffected until Task 2.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/tests/integration/migrations.test.ts` (read the file first to match its existing style and imports):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";

describe("migrations", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("adds deleted_at column to projects", () => {
    const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("deleted_at");
  });
});
```

If `migrations.test.ts` already has a `describe("migrations", ...)` block, add only the new `it(...)` case inside it to avoid a duplicate describe.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/server test -- migrations.test`
Expected: FAIL — `expected [ ... ] to contain 'deleted_at'`

- [ ] **Step 3: Add the migration**

In `apps/server/src/db/migrations.ts`, append a third entry to the `MIGRATIONS` array (after the `002_models` entry, before the closing `];`):

```ts
  {
    name: "003_project_soft_delete",
    sql: `
      ALTER TABLE projects ADD COLUMN deleted_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(deleted_at) WHERE deleted_at IS NULL;
    `,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/server test -- migrations.test`
Expected: PASS

- [ ] **Step 5: Run full backend test suite to check no regression**

Run: `pnpm --filter @pi-web-ui/server test`
Expected: PASS (pre-existing stale `projects.test.ts` failures are acceptable — they fail on POST-without-workdir, unrelated to this change)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/migrations.ts apps/server/tests/integration/migrations.test.ts
git commit -m "feat(server): add projects.deleted_at column via 003 migration"
```

---

### Task 2: ProjectRepository — soft delete + active filtering

**Files:**
- Modify: `apps/server/src/db/repositories/project.ts:30-50`
- Test: `apps/server/tests/unit/project-repo-soft-delete.test.ts` (create)

**Interfaces:**
- Consumes: `projects.deleted_at` column (Task 1)
- Produces: `ProjectRepository.list()` and `findById()` only return active (non-soft-deleted) projects; `delete(id)` sets `deleted_at = Date.now()` instead of removing the row.

- [ ] **Step 1: Write the failing test**

Create `apps/server/tests/unit/project-repo-soft-delete.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";

describe("ProjectRepository soft delete", () => {
  let db: Database.Database;
  let repo: ProjectRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new ProjectRepository(db);
  });

  it("list() excludes soft-deleted projects", () => {
    const a = repo.create({ name: "a", workdir: "/tmp/a" });
    repo.create({ name: "b", workdir: "/tmp/b" });
    repo.delete(a.id);
    const names = repo.list().map((p) => p.name);
    expect(names).toEqual(["b"]);
  });

  it("findById() returns null for a soft-deleted project", () => {
    const p = repo.create({ name: "a", workdir: "/tmp/a" });
    repo.delete(p.id);
    expect(repo.findById(p.id)).toBeNull();
  });

  it("delete() sets deleted_at instead of removing the row", () => {
    const p = repo.create({ name: "a", workdir: "/tmp/a" });
    repo.delete(p.id);
    const row = db.prepare("SELECT deleted_at FROM projects WHERE id = ?").get(p.id) as { deleted_at: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.deleted_at).not.toBeNull();
  });

  it("delete() on a missing id is a no-op (no throw)", () => {
    expect(() => repo.delete("does-not-exist")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/server test -- project-repo-soft-delete`
Expected: FAIL — `list()` still returns soft-deleted project; `findById` still returns the row; `deleted_at` is null.

- [ ] **Step 3: Update the repository**

In `apps/server/src/db/repositories/project.ts`, replace the bodies of `findById`, `list`, and `delete`:

```ts
  findById(id: string): ProjectDto | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL").get(id) as ProjectRow | undefined;
    return r ? toDto(r) : null;
  }

  list(): ProjectDto[] {
    return (this.db.prepare("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC").all() as ProjectRow[]).map(toDto);
  }

  update(id: string, patch: Partial<{ name: string; description: string | null }>): void {
    const cur = this.findById(id);
    if (!cur) throw new Error("project not found");
    const name = patch.name ?? cur.name;
    const description = patch.description === undefined ? cur.description : patch.description;
    this.db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, description, Date.now(), id);
  }

  delete(id: string): void {
    this.db.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(Date.now(), Date.now(), id);
  }
```

Note: `update()` now throws `"project not found"` for soft-deleted projects because `findById()` returns null — this is the desired behavior (can't rename a deleted project). The `ProjectRow` type at the top of the file must also gain `deleted_at`:

```ts
type ProjectRow = {
  id: string; name: string; workdir: string; description: string | null;
  deleted_at: number | null;
  created_at: number; updated_at: number;
};
```

(`toDto` does not need to expose `deleted_at` — keep `ProjectDto` stable; the recycle bin spec will extend it later.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/server test -- project-repo-soft-delete`
Expected: PASS

- [ ] **Step 5: Run the existing repo test to confirm no regression**

Run: `pnpm --filter @pi-web-ui/server test -- project-repo.test`
Expected: PASS — the existing `"deletes a project"` case asserts `findById` returns null after delete, which still holds.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/db/repositories/project.ts apps/server/tests/unit/project-repo-soft-delete.test.ts
git commit -m "feat(server): soft-delete projects, filter deleted_at in list/findById"
```

---

### Task 3: PUT /:id route — rename project

**Files:**
- Modify: `apps/server/src/routes/projects.ts:6-36`
- Test: `apps/server/tests/integration/projects-edit-delete.test.ts` (create, append in Task 4 too)

**Interfaces:**
- Consumes: `ProjectRepository.update(id, { name })` from existing code (Task 2 kept its signature)
- Produces: `PUT /api/projects/:id` with body `{ name: string }` → `200 ProjectDto` / `400 {error}` / `404 {error}`

- [ ] **Step 1: Write the failing test**

Create `apps/server/tests/integration/projects-edit-delete.test.ts`:

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
import { projectsRoutes } from "../../src/routes/projects.js";
import { sessionsRoutes } from "../../src/routes/sessions.js";

describe("projects edit/delete routes", () => {
  let tmp: string;
  let workdir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-edit-del-"));
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wd-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    app = await buildApp(config, {
      db,
      projects: new ProjectRepository(db),
      sessions: new SessionRepository(db),
      messages: new MessageRepository(db),
      models: new ModelRepository(db),
      sessionStates: new SessionStateStore(),
    });
    await app.register(projectsRoutes, { prefix: "/api/projects" });
    await app.register(sessionsRoutes, { prefix: "/api" });
  });
  afterEach(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function createProject(name = "demo"): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name, workdir },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it("renames a project via PUT", async () => {
    const { id } = await createProject("old");
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      payload: { name: "new-name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("new-name");
    const got = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(got.json().name).toBe("new-name");
  });

  it("PUT rejects empty name with 400", async () => {
    const { id } = await createProject();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      payload: { name: "  " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/does-not-exist",
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/server test -- projects-edit-delete`
Expected: FAIL — `PUT /api/projects/:id` returns 404 (route not registered).

- [ ] **Step 3: Add the PUT route**

In `apps/server/src/routes/projects.ts`, insert a `PUT` handler before the existing `DELETE` handler (after the `GET /:id` block):

```ts
  app.put<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = req.body as { name?: string };
    const name = body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const cur = app.projects.findById(req.params.id);
    if (!cur) return reply.code(404).send({ error: "not found" });
    app.projects.update(req.params.id, { name });
    return app.projects.findById(req.params.id);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/server test -- projects-edit-delete`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/projects.ts apps/server/tests/integration/projects-edit-delete.test.ts
git commit -m "feat(server): PUT /api/projects/:id to rename a project"
```

---

### Task 4: DELETE /:id — kill agent processes + soft delete

**Files:**
- Modify: `apps/server/src/routes/projects.ts` (the existing `DELETE` handler)
- Test: `apps/server/tests/integration/projects-edit-delete.test.ts` (append cases)

**Interfaces:**
- Consumes: `app.sessionStates` (`SessionStateStore`) — iterate `values()`, filter by `state.process.projectId`, call `state.process.kill()`, then `app.sessionStates.delete(state.sessionId)`
- Produces: `DELETE /api/projects/:id` → `204` / `404`; side effect: all in-memory agent processes for the project's sessions are killed and removed from `sessionStates`; the project row gets `deleted_at` set.

- [ ] **Step 1: Write the failing test**

Append to the `describe("projects edit/delete routes", ...)` block in `apps/server/tests/integration/projects-edit-delete.test.ts`:

```ts
  it("DELETE soft-deletes the project (still 404 on GET)", async () => {
    const { id } = await createProject();
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);
    const got = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(got.statusCode).toBe(404);
  });

  it("DELETE kills agent processes for the project's sessions and clears sessionStates", async () => {
    const { id } = await createProject();
    // Create a session via the sessions route
    const s1 = await app.inject({ method: "POST", url: `/api/projects/${id}/sessions` });
    const s2 = await app.inject({ method: "POST", url: `/api/projects/${id}/sessions` });
    const sessionId1 = s1.json().id;
    const sessionId2 = s2.json().id;

    // Inject two fake in-memory agent processes belonging to this project
    const store = (app as any).sessionStates;
    const kill1 = vi.fn();
    const kill2 = vi.fn();
    store.set(sessionId1, { projectId: id, kill: kill1 } as any, {} as any);
    store.set(sessionId2, { projectId: id, kill: kill2 } as any, {} as any);
    // A session belonging to a different project should NOT be touched
    const otherKill = vi.fn();
    store.set("other-session", { projectId: "other", kill: otherKill } as any, {} as any);

    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);
    expect(kill1).toHaveBeenCalledTimes(1);
    expect(kill2).toHaveBeenCalledTimes(1);
    expect(otherKill).not.toHaveBeenCalled();
    expect(store.get(sessionId1)).toBeUndefined();
    expect(store.get(sessionId2)).toBeUndefined();
    expect(store.get("other-session")).toBeDefined();
  });

  it("DELETE returns 404 for unknown id", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/projects/nope" });
    expect(res.statusCode).toBe(404);
  });
```

Add `vi` to the vitest import at the top of the file: `import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/server test -- projects-edit-delete`
Expected: FAIL — the `DELETE kills agent processes...` case fails because the current `DELETE` handler does not iterate `sessionStates` or kill processes; `kill1` is never called.

- [ ] **Step 3: Rewrite the DELETE handler**

In `apps/server/src/routes/projects.ts`, replace the existing `app.delete(...)` block with:

```ts
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const cur = app.projects.findById(req.params.id);
    if (!cur) return reply.code(404).send({ error: "not found" });
    const projectId = req.params.id;
    for (const state of app.sessionStates.values()) {
      if (state.process.projectId !== projectId) continue;
      try {
        state.process.kill();
      } catch (e) {
        req.log.warn({ err: e, sessionId: state.sessionId }, "failed to kill agent process during project delete");
      }
      app.sessionStates.delete(state.sessionId);
    }
    app.projects.delete(projectId);
    return reply.code(204).send();
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/server test -- projects-edit-delete`
Expected: PASS

- [ ] **Step 5: Run full backend suite + typecheck**

Run: `pnpm --filter @pi-web-ui/server test && pnpm --filter @pi-web-ui/server typecheck`
Expected: tests pass (pre-existing stale `projects.test.ts` failures acceptable); typecheck PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/projects.ts apps/server/tests/integration/projects-edit-delete.test.ts
git commit -m "feat(server): DELETE /api/projects/:id kills agent processes + soft-deletes"
```

---

### Task 5: Frontend API client — `updateProject`

**Files:**
- Modify: `apps/web/src/api/client.ts:29-34`
- Test: `apps/web/tests/unit/api-update-project.test.ts` (create)

**Interfaces:**
- Produces: `api.updateProject(id: string, name: string): Promise<ProjectDto>` → `PUT /projects/${id}` body `{ name }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/api-update-project.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../../src/api/client.js";

describe("api.updateProject", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("PUTs { name } to /projects/:id and returns the updated project", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", name: "new" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await api.updateProject("1", "new");
    expect(p.name).toBe("new");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("/api/projects/1");
    expect(calls[0]![1].method).toBe("PUT");
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ name: "new" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/web test -- api-update-project`
Expected: FAIL — `api.updateProject is not a function`.

- [ ] **Step 3: Add `updateProject` to the API client**

In `apps/web/src/api/client.ts`, inside the `export const api = { ... }` object, after the `getProject` line, add:

```ts
  updateProject: (id: string, name: string) =>
    request<ProjectDto>("PUT", `/projects/${id}`, { name }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/web test -- api-update-project`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/tests/unit/api-update-project.test.ts
git commit -m "feat(web): api.updateProject PUTs renamed project"
```

---

### Task 6: Frontend store — `update` action

**Files:**
- Modify: `apps/web/src/stores/project.ts`
- Test: `apps/web/tests/unit/project-store-update.test.ts` (create)

**Interfaces:**
- Consumes: `api.updateProject(id, name)` (Task 5)
- Produces: `useProjectStore().update(id, name): Promise<ProjectDto>` — calls API, replaces the matching project in `state.projects`, updates `state.current` if it matches, returns the updated project. On failure, throws and leaves local state untouched.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/project-store-update.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useProjectStore } from "../../src/stores/project.js";

describe("project store update", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("update(id, name) replaces the matching project in state", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: "1", name: "old", workdir: "/tmp", description: null, createdAt: 0, updatedAt: 0 },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useProjectStore();
    await store.loadAll();
    expect(store.projects[0]!.name).toBe("old");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(
      { id: "1", name: "new", workdir: "/tmp", description: null, createdAt: 0, updatedAt: 1 },
    ), { status: 200, headers: { "Content-Type": "application/json" } }));

    const updated = await store.update("1", "new");
    expect(updated.name).toBe("new");
    expect(store.projects[0]!.name).toBe("new");
  });

  it("update does not mutate state when the API call rejects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: "1", name: "old", workdir: "/tmp", description: null, createdAt: 0, updatedAt: 0 },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const store = useProjectStore();
    await store.loadAll();

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(store.update("1", "new")).rejects.toThrow();
    expect(store.projects[0]!.name).toBe("old");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/web test -- project-store-update`
Expected: FAIL — `store.update is not a function`.

- [ ] **Step 3: Add the `update` action**

In `apps/web/src/stores/project.ts`, add this action inside the `actions` object (e.g. after `create`):

```ts
    async update(id: string, name: string) {
      const updated = await api.updateProject(id, name);
      const idx = this.projects.findIndex((p) => p.id === id);
      if (idx >= 0) this.projects.splice(idx, 1, updated);
      if (this.current?.id === id) this.current = updated;
      return updated;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/web test -- project-store-update`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/project.ts apps/web/tests/unit/project-store-update.test.ts
git commit -m "feat(web): project store update action for rename"
```

---

### Task 7: i18n keys for rename + delete

**Files:**
- Modify: `apps/web/src/i18n/messages.ts`

**Interfaces:**
- Produces: i18n keys `rename.title`, `rename.label`, `rename.placeholder`, `rename.save`, `delete.confirmTitle`, `delete.confirmMessage`, `delete.confirm` in both `en` and `zh` locales.

- [ ] **Step 1: Add keys to the `en` locale**

In `apps/web/src/i18n/messages.ts`, inside the `en: { ... }` object, after the `"newProject.create": "Create",` line, add:

```ts
    // Rename + delete project
    "rename.title": "Rename Project",
    "rename.label": "Name",
    "rename.placeholder": "Project name...",
    "rename.save": "Save",
    "rename.cancel": "Cancel",
    "delete.confirmTitle": "Delete project",
    "delete.confirmMessage": "Delete this project? All running sessions under it will be stopped.",
    "delete.confirm": "Delete",
    "delete.cancel": "Cancel",
```

- [ ] **Step 2: Add keys to the `zh` locale**

Inside the `zh: { ... }` object, after the `"newProject.create": "创建",` line, add:

```ts
    "rename.title": "重命名项目",
    "rename.label": "名称",
    "rename.placeholder": "项目名称...",
    "rename.save": "保存",
    "rename.cancel": "取消",
    "delete.confirmTitle": "删除项目",
    "delete.confirmMessage": "确认删除该项目？该项目下所有运行中的会话将被停止。",
    "delete.confirm": "删除",
    "delete.cancel": "取消",
```

- [ ] **Step 3: Run frontend typecheck + tests to confirm nothing breaks**

Run: `pnpm --filter @pi-web-ui/web typecheck && pnpm --filter @pi-web-ui/web test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/messages.ts
git commit -m "feat(web): i18n keys for project rename + delete"
```

---

### Task 8: `RenameProjectDialog.vue` component

**Files:**
- Create: `apps/web/src/components/RenameProjectDialog.vue`
- Test: `apps/web/tests/unit/rename-project-dialog.test.ts` (create)

**Interfaces:**
- Props: `{ show: boolean; project: { id: string; name: string } | null }`
- Emits: `close` (no payload), `rename(id: string, name: string)`
- Behavior: when `show` toggles to true and `project` is non-null, prefill the input with `project.name`, focus + select the text. Save button disabled when trimmed input is empty. Save emits `rename(project.id, trimmed)` then `close`. Esc / overlay click emits `close`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/rename-project-dialog.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import RenameProjectDialog from "../../src/components/RenameProjectDialog.vue";

describe("RenameProjectDialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  function mountDialog(show: boolean, project: { id: string; name: string } | null) {
    return mount(RenameProjectDialog, {
      props: { show, project },
      global: { stubs: { NModal: { template: '<div v-if="show"><slot/></div>' }, NInput: { template: '<input :value="value" @input="$emit(\'update:value\', ($event.target as HTMLInputElement).value)" />', props: ["value"] } } },
    });
  }

  it("prefills the input with the project name when shown", async () => {
    const w = mountDialog(true, { id: "1", name: "old" });
    await nextTick();
    const input = w.find("input");
    expect((input.element as HTMLInputElement).value).toBe("old");
  });

  it("emits rename(id, name) on save then close", async () => {
    const w = mountDialog(true, { id: "1", name: "old" });
    await nextTick();
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "new-name";
    await input.trigger("input");
    await w.find("[data-test='save']").trigger("click");
    const events = w.emitted();
    expect(events.rename).toEqual([["1", "new-name"]]);
    expect(events.close).toBeDefined();
  });

  it("disables save when name is empty", async () => {
    const w = mountDialog(true, { id: "1", name: "old" });
    await nextTick();
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "   ";
    await input.trigger("input");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/web test -- rename-project-dialog`
Expected: FAIL — component file does not exist, import errors.

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/RenameProjectDialog.vue`:

```vue
<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { NModal, NInput } from "naive-ui";
import { useI18n } from "../i18n/index.js";
import type { ProjectDto } from "@pi-web-ui/shared";

const props = defineProps<{ show: boolean; project: ProjectDto | null }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "rename", id: string, name: string): void;
}>();

const { t } = useI18n();
const name = ref("");
const inputRef = ref<InstanceType<typeof NInput> | null>(null);

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;
    name.value = props.project?.name ?? "";
    await nextTick();
    const el = (inputRef.value as any)?.$el as HTMLElement | undefined;
    const input = el?.querySelector("input") as HTMLInputElement | null;
    input?.focus();
    input?.select();
  },
);

function handleSave() {
  const trimmed = name.value.trim();
  if (!trimmed || !props.project) return;
  emit("rename", props.project.id, trimmed);
  emit("close");
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ t('rename.title') }}</h3>
        <button class="dialog-close" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="name-row">
        <label class="name-label">{{ t('rename.label') }}</label>
        <NInput
          ref="inputRef"
          v-model:value="name"
          size="small"
          :placeholder="t('rename.placeholder')"
          @keydown.enter="handleSave"
        />
      </div>

      <div class="dialog-actions">
        <button class="btn-cancel" @click="emit('close')">{{ t('rename.cancel') }}</button>
        <button
          class="btn-save"
          data-test="save"
          :disabled="!name.trim()"
          @click="handleSave"
        >
          {{ t('rename.save') }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 420px;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
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
.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 20px 16px;
}
.name-label {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 16px;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/web test -- rename-project-dialog`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/RenameProjectDialog.vue apps/web/tests/unit/rename-project-dialog.test.ts
git commit -m "feat(web): RenameProjectDialog component"
```

---

### Task 9: `ConfirmDialog.vue` component (generic)

**Files:**
- Create: `apps/web/src/components/ConfirmDialog.vue`
- Test: `apps/web/tests/unit/confirm-dialog.test.ts` (create)

**Interfaces:**
- Props: `{ show: boolean; title: string; message: string; confirmLabel: string; cancelLabel: string; danger: boolean }`
- Emits: `close`, `confirm`
- Behavior: confirm button emits `confirm` then `close`; cancel button + overlay + Esc emit `close`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/confirm-dialog.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmDialog from "../../src/components/ConfirmDialog.vue";

describe("ConfirmDialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  function mountDialog(danger = false) {
    return mount(ConfirmDialog, {
      props: {
        show: true,
        title: "T",
        message: "M",
        confirmLabel: "OK",
        cancelLabel: "Cancel",
        danger,
      },
      global: { stubs: { NModal: { template: '<div v-if="show"><slot/></div>' } } },
    });
  }

  it("emits confirm then close when confirm button clicked", async () => {
    const w = mountDialog();
    await w.find("[data-test='confirm']").trigger("click");
    expect(w.emitted().confirm).toBeDefined();
    expect(w.emitted().close).toBeDefined();
  });

  it("applies danger class when danger=true", async () => {
    const w = mountDialog(true);
    expect(w.find("[data-test='confirm']").classes()).toContain("danger");
  });

  it("emits close when cancel clicked", async () => {
    const w = mountDialog();
    await w.find("[data-test='cancel']").trigger("click");
    expect(w.emitted().close).toBeDefined();
    expect(w.emitted().confirm).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pi-web-ui/web test -- confirm-dialog`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/ConfirmDialog.vue`:

```vue
<script setup lang="ts">
import { NModal } from "naive-ui";

const props = defineProps<{
  show: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm"): void;
}>();

function handleConfirm() {
  emit("confirm");
  emit("close");
}
</script>

<template>
  <NModal :show="show" @update:show="(v: boolean) => { if (!v) emit('close'); }">
    <div class="dialog" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ title }}</h3>
      </div>
      <div class="dialog-body">{{ message }}</div>
      <div class="dialog-actions">
        <button class="btn-cancel" data-test="cancel" @click="emit('close')">{{ cancelLabel }}</button>
        <button
          class="btn-confirm"
          :class="{ danger: props.danger }"
          data-test="confirm"
          @click="handleConfirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.dialog {
  width: 420px;
  background: var(--bg-deep);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.dialog-header { padding: 16px 20px 8px; }
.dialog-title {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.dialog-body {
  padding: 0 20px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 16px;
}
.btn-cancel, .btn-confirm {
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
.btn-confirm {
  border: none;
  background: var(--accent);
  color: var(--bg-void);
}
.btn-confirm.danger { background: var(--rose); }
.btn-confirm:hover { filter: brightness(1.1); }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pi-web-ui/web test -- confirm-dialog`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ConfirmDialog.vue apps/web/tests/unit/confirm-dialog.test.ts
git commit -m "feat(web): generic ConfirmDialog component"
```

---

### Task 10: Sidebar — hover action buttons + dialog wiring

**Files:**
- Modify: `apps/web/src/components/Sidebar.vue`
- Test: none (component-level behavior is covered by the dialog tests in Tasks 8 & 9; Sidebar wiring is verified via the e2e smoke in Task 12). Typecheck is the gate here.

**Interfaces:**
- Consumes: `useProjectStore().update`, `useProjectStore().remove` (Tasks 6), `RenameProjectDialog` (Task 8), `ConfirmDialog` (Task 9)
- Produces: new Sidebar emits `rename-project(id: string, name: string)` and `delete-project(id: string)` to the parent. (Parent `App.vue` owns the store calls + selection clearing — see Task 11.)

> Rationale for emitting to parent instead of calling the store directly: the existing pattern (e.g. `create-project`) emits to `App.vue`, which owns `selectedProjectId`. Delete must clear that selection, so the parent needs to handle it. Mirroring the existing emit pattern keeps Sidebar dumb about app-level state.

- [ ] **Step 1: Update the `<script setup>` block**

In `apps/web/src/components/Sidebar.vue`, replace the existing `<script setup lang="ts">` block with:

```ts
<script setup lang="ts">
import { ref } from "vue";
import { useProjectStore } from "../stores/project.js";
import { useSessionStore } from "../stores/session.js";
import FileTree from "./FileTree.vue";
import NewProjectDialog from "./NewProjectDialog.vue";
import RenameProjectDialog from "./RenameProjectDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import { useI18n } from "../i18n/index.js";
import type { ProjectDto } from "@pi-web-ui/shared";

const projectStore = useProjectStore();
const sessionStore = useSessionStore();
const { t } = useI18n();

const props = defineProps<{
  selectedProjectId: string | null;
  selectedSessionId: string | null;
}>();

const emit = defineEmits<{
  (e: "select-project", id: string): void;
  (e: "select-session", id: string): void;
  (e: "create-project", name: string, workdir: string): void;
  (e: "rename-project", id: string, name: string): void;
  (e: "delete-project", id: string): void;
  (e: "create-session"): void;
  (e: "select-file", path: string): void;
}>();

const showNewProject = ref(false);
const renameTarget = ref<ProjectDto | null>(null);
const deleteTarget = ref<ProjectDto | null>(null);

function handleCreateProject(name: string, workdir: string) {
  emit("create-project", name, workdir);
  showNewProject.value = false;
}

function startRename(p: ProjectDto) {
  renameTarget.value = p;
}

function startDelete(p: ProjectDto) {
  deleteTarget.value = p;
}
</script>
```

- [ ] **Step 2: Add action buttons to each project list item + wire dialogs in template**

In the same file, locate the project `list-item` block:

```vue
        <div
          v-for="p in projectStore.projects"
          :key="p.id"
          class="list-item"
          :class="{ active: p.id === selectedProjectId }"
          @click="emit('select-project', p.id)"
        >
          <span class="item-icon"> ... </span>
          <span class="item-label truncate">{{ p.name }}</span>
        </div>
```

Replace it with (adds `item-actions` with edit + delete icon buttons, and appends the two dialogs at the end of the `<aside>`):

```vue
        <div
          v-for="p in projectStore.projects"
          :key="p.id"
          class="list-item"
          :class="{ active: p.id === selectedProjectId }"
          @click="emit('select-project', p.id)"
        >
          <span class="item-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1.5 3a1 1 0 011-1h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293h3.586a1 1 0 011 1V11a1 1 0 01-1 1h-9a1 1 0 01-1-1V3z"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
          </span>
          <span class="item-label truncate">{{ p.name }}</span>
          <span class="item-actions">
            <button
              class="item-action"
              :title="t('rename.title')"
              @click.stop="startRename(p)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 10l1-3 5-5 2 2-5 5-3 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
              </svg>
            </button>
            <button
              class="item-action danger"
              :title="t('delete.confirmTitle')"
              @click.stop="startDelete(p)"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3M2 3h8M5 3V2h2v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </span>
        </div>
```

Then, just before the closing `</aside>`, add the two dialogs (after the existing `<NewProjectDialog ... />`):

```vue
    <RenameProjectDialog
      :show="renameTarget !== null"
      :project="renameTarget"
      @close="renameTarget = null"
      @rename="(id, name) => emit('rename-project', id, name)"
    />

    <ConfirmDialog
      :show="deleteTarget !== null"
      :title="t('delete.confirmTitle')"
      :message="t('delete.confirmMessage')"
      :confirm-label="t('delete.confirm')"
      :cancel-label="t('delete.cancel')"
      :danger="true"
      @close="deleteTarget = null"
      @confirm="emit('delete-project', deleteTarget!.id)"
    />
```

- [ ] **Step 3: Add styles for `item-actions`**

In the `<style scoped>` block, after the `.item-label` rules, add:

```css
.item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.list-item:hover .item-actions,
.list-item:focus-within .item-actions {
  opacity: 1;
}
.item-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.item-action:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.item-action.danger:hover {
  background: var(--rose-dim, rgba(244, 63, 94, 0.15));
  color: var(--rose);
}
```

- [ ] **Step 4: Typecheck the frontend**

Run: `pnpm --filter @pi-web-ui/web typecheck`
Expected: PASS — no TS errors; new emits + props are well-typed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Sidebar.vue
git commit -m "feat(web): sidebar hover action buttons for rename + delete"
```

---

### Task 11: App.vue — handle rename + delete events, clear selection on delete

**Files:**
- Modify: `apps/web/src/App.vue:54-68` and the `<Sidebar ... />` template

**Interfaces:**
- Consumes: `useProjectStore().update` / `.remove` (Task 6), new Sidebar emits (Task 10)
- Produces: `renameProject(id, name)` and `deleteProject(id)` handlers on App.vue; on successful delete of the currently-selected project, `selectedProjectId` is set to null (the existing `watch(selectedProjectId)` then clears `selectedSessionId` and `sessionStore`).

- [ ] **Step 1: Add the two handlers to App.vue's `<script setup>`**

In `apps/web/src/App.vue`, after the existing `createSession` function (around line 68), add:

```ts
async function renameProject(id: string, name: string) {
  try {
    await projectStore.update(id, name);
  } catch (e: any) {
    console.error("Failed to rename project:", e);
    alert(`${e.message}`);
  }
}

async function deleteProject(id: string) {
  try {
    await projectStore.remove(id);
    if (selectedProjectId.value === id) {
      selectedProjectId.value = null;
    }
  } catch (e: any) {
    console.error("Failed to delete project:", e);
    alert(`${e.message}`);
  }
}
```

- [ ] **Step 2: Wire the new emits on the Sidebar element**

In the same file's template, update the `<Sidebar ... />` element to add the two handlers:

```vue
        <Sidebar
          :selected-project-id="selectedProjectId"
          :selected-session-id="selectedSessionId"
          @select-project="selectedProjectId = $event"
          @select-session="selectedSessionId = $event"
          @create-project="createProject"
          @rename-project="renameProject"
          @delete-project="deleteProject"
          @create-session="createSession"
          @select-file="filePath = $event"
        />
```

- [ ] **Step 3: Typecheck the frontend**

Run: `pnpm --filter @pi-web-ui/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.vue
git commit -m "feat(web): App.vue handles project rename + delete, clears selection"
```

---

### Task 12: End-to-end smoke + final verification

**Files:**
- No new files. Manual + automated verification of the full stack.

- [ ] **Step 1: Run the entire test + typecheck suite**

Run: `pnpm -r run typecheck && pnpm -r run test`
Expected: PASS across all packages (pre-existing stale `apps/server/tests/integration/projects.test.ts` failures are acceptable — they predate this work).

- [ ] **Step 2: Start the dev stack and smoke-test in a browser**

Run: `pnpm dev` (in one terminal). Once both Vite and Fastify are up, open `http://localhost:5173`.

Manual flow:
1. Create a project via the `+` button in the sidebar (pick a real directory).
2. Hover the new project item → confirm the edit (pencil) and delete (trash) icons fade in.
3. Click the pencil → `RenameProjectDialog` opens, input prefilled, text selected.
4. Type a new name → Save → the sidebar label updates instantly.
5. Refresh the page → the renamed project persists (confirms PUT hit the DB).
6. Create a session under the project, send one message so an agent process is live.
7. Click the trash on the project → `ConfirmDialog` appears with the delete message.
8. Confirm → the project disappears from the sidebar; the welcome screen shows (selection cleared).
9. Refresh → project still gone (soft-deleted, not listed).

- [ ] **Step 3: Verify orphan-process cleanup (optional but recommended)**

While a session's agent process is running (step 6 above), run `ps aux | grep pi` (or the project's agent command) before and after step 8. After delete, the agent process for the project's session should be gone.

- [ ] **Step 4: Final commit (only if any cleanup needed; otherwise skip)**

If the smoke surfaced any fix, stage + commit it. Otherwise this step is a no-op.

---

## Self-Review (completed by plan author)

- **Spec coverage:**
  - §3.1 migration `deleted_at` → Task 1
  - §3.2 repo list/findById filter + delete soft → Task 2
  - §3.3 `PUT /:id` → Task 3
  - §3.3 `DELETE /:id` kill processes + soft delete → Task 4
  - §4.1 `api.updateProject` → Task 5
  - §4.2 store `update` → Task 6
  - §4.3 `RenameProjectDialog` → Task 8
  - §4.3 `ConfirmDialog` → Task 9
  - §4.4 `Sidebar.vue` hover actions + dialog wiring → Task 10
  - §4.4 clear selection on delete → Task 11 (App.vue sets `selectedProjectId = null`; the existing `watch(selectedProjectId)` clears sessions)
  - §4.5 i18n keys → Task 7
  - §5 data flow → covered by Tasks 3-11 + smoke (Task 12)
  - §6 error handling → empty name 400 (Task 3 step 3 + frontend Save disable Task 8); 404 paths (Tasks 3 & 4); kill-process failure non-blocking (Task 4 step 3 try/catch); network error → store throws, local state untouched (Task 6 step 3 + App.vue try/alert)
  - §7 testing → all tasks have tests + Task 12 e2e smoke
  - §8 non-goals respected (no recycle bin UI, no batch delete, no workdir/description edit)

- **Placeholder scan:** no TBD / TODO / "add appropriate". Each code step contains real code.

- **Type consistency:**
  - `api.updateProject(id, name)` — defined Task 5, used Task 6 + Task 11. ✓
  - `store.update(id, name)` returning `ProjectDto` — defined Task 6, used Task 11. ✓
  - Sidebar emits `rename-project(id, name)` / `delete-project(id)` — defined Task 10, consumed Task 11. ✓
  - `RenameProjectDialog` props `{ show, project }` + emits `close` / `rename(id, name)` — Task 8, mounted in Task 10. ✓
  - `ConfirmDialog` props + emits `close` / `confirm` — Task 9, mounted in Task 10 (confirm emits `delete-project` with `deleteTarget.id`). ✓
  - `ProjectRepository.update(id, { name })` / `delete(id)` signatures unchanged from existing code. ✓
