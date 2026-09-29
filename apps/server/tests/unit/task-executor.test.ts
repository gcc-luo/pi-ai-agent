import { describe, expect, it } from "vitest";
import { resolveScheduledTaskCapabilities } from "../../src/services/task-executor.js";

describe("scheduled task capability resolution", () => {
  it("keeps valid capabilities and reports invalid ones", () => {
    const result = resolveScheduledTaskCapabilities({
      skillNames: ["code-review", "missing-skill"],
      pluginIds: ["browser-use", "disabled-plugin", "missing-plugin"],
      connectorIds: ["docs", "disabled-connector", "other-project"],
      expertId: "missing-expert",
    }, {
      projectId: "project-a",
      skills: { list: () => [{ name: "code-review" }] },
      plugins: {
        find: (id) => id === "browser-use"
          ? { enabled: true, status: "running" }
          : id === "disabled-plugin"
            ? { enabled: false, status: "disabled" }
            : null,
      },
      connectors: {
        get: (id) => id === "docs"
          ? { id, enabled: true, scopeType: "workspace", scopeId: "project-a" }
          : id === "disabled-connector"
            ? { id, enabled: false, scopeType: "user", scopeId: null }
            : id === "other-project"
              ? { id, enabled: true, scopeType: "workspace", scopeId: "project-b" }
              : null,
      },
      experts: { findById: () => null },
    });

    expect(result).toEqual({
      skillNames: ["code-review"],
      pluginIds: ["browser-use"],
      connectorIds: ["docs"],
      expertId: null,
      warnings: expect.arrayContaining([
        expect.stringContaining("missing-skill"),
        expect.stringContaining("disabled-plugin"),
        expect.stringContaining("other-project"),
        expect.stringContaining("missing-expert"),
      ]),
    });
  });
});
