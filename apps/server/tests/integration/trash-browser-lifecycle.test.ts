import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trashRoutes } from "../../src/routes/trash.js";

describe("trash browser session lifecycle", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function buildTrashApp() {
    const app = Fastify();
    apps.push(app);
    const projectRestore = vi.fn();
    const sessionRestore = vi.fn();
    const listByProject = vi.fn(() => [{ id: "active-child" }, { id: "another-child" }]);
    const resumeSession = vi.fn(async () => undefined);
    const closeSession = vi.fn(async () => undefined);
    const destroyProject = vi.fn();
    const destroySession = vi.fn();
    const prepare = vi.fn(() => ({ all: () => [{ id: "active-child" }, { id: "trashed-child" }] }));

    app.decorate("projects", {
      restore: projectRestore,
      destroyPermanently: destroyProject,
      listDeleted: () => [],
    } as any);
    app.decorate("sessions", {
      restore: sessionRestore,
      listByProject,
      destroyPermanently: destroySession,
      listDeleted: () => [],
    } as any);
    app.decorate("browserManager", { resumeSession } as any);
    app.decorate("pluginManager", { closeSession } as any);
    app.decorate("processManager", {
      revokePluginTokens: vi.fn(),
      revokePluginToken: vi.fn(),
    } as any);
    app.decorate("pluginPermissions", { cancelSession: vi.fn() } as any);
    app.decorate("sessionStates", new Map() as any);
    app.decorate("db", { prepare } as any);
    await app.register(trashRoutes, { prefix: "/api/trash" });

    return {
      app,
      projectRestore,
      sessionRestore,
      listByProject,
      resumeSession,
      closeSession,
      destroyProject,
      destroySession,
    };
  }

  it("clears a session tombstone when restoring that session", async () => {
    const { app, sessionRestore, resumeSession } = await buildTrashApp();

    const result = await app.inject({
      method: "POST",
      url: "/api/trash/restore",
      payload: { kind: "session", id: "restored-session" },
    });

    expect(result.statusCode).toBe(204);
    expect(sessionRestore).toHaveBeenCalledWith("restored-session");
    expect(resumeSession).toHaveBeenCalledWith("restored-session");
  });

  it("clears tombstones for active sessions when restoring their project", async () => {
    const { app, projectRestore, listByProject, resumeSession } = await buildTrashApp();

    const result = await app.inject({
      method: "POST",
      url: "/api/trash/restore",
      payload: { kind: "project", id: "restored-project" },
    });

    expect(result.statusCode).toBe(204);
    expect(projectRestore).toHaveBeenCalledWith("restored-project");
    expect(listByProject).toHaveBeenCalledWith("restored-project");
    expect(resumeSession).toHaveBeenCalledTimes(2);
    expect(resumeSession).toHaveBeenNthCalledWith(1, "active-child");
    expect(resumeSession).toHaveBeenNthCalledWith(2, "another-child");
  });

  it("keeps permanent-delete tombstones for sessions and project children", async () => {
    const { app, closeSession, destroyProject, destroySession } = await buildTrashApp();

    const projectDelete = await app.inject({
      method: "POST",
      url: "/api/trash/destroy",
      payload: { kind: "project", id: "deleted-project" },
    });
    const sessionDelete = await app.inject({
      method: "POST",
      url: "/api/trash/destroy",
      payload: { kind: "session", id: "deleted-session" },
    });

    expect(projectDelete.statusCode).toBe(204);
    expect(sessionDelete.statusCode).toBe(204);
    expect(closeSession).toHaveBeenCalledWith("active-child", { retainTombstone: true });
    expect(closeSession).toHaveBeenCalledWith("trashed-child", { retainTombstone: true });
    expect(closeSession).toHaveBeenCalledWith("deleted-session", { retainTombstone: true });
    expect(destroyProject).toHaveBeenCalledWith("deleted-project");
    expect(destroySession).toHaveBeenCalledWith("deleted-session");
  });
});
