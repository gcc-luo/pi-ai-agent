import { describe, expect, it, vi } from "vitest";
import { removeComposerSelection } from "./composer-selection.js";
import type { ComposerResourceToken } from "./composer-tokens.js";

function token(kind: ComposerResourceToken["kind"], resourceId: string): ComposerResourceToken {
  return { id: `${kind}-${resourceId}`, kind, resourceId, label: resourceId, icon: "", value: "" };
}

function stores() {
  const plugins = {
    selectedBySession: { session: ["plugin-a", "plugin-b"] },
    setSessionPlugins: vi.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    sessions: [{ id: "session", expertId: "expert-a" }],
    current: null,
    setExpert: vi.fn().mockResolvedValue(undefined),
  };
  const kbBindings = {
    getForSession: vi.fn().mockReturnValue([
      { kbId: "kb-a", fileFilter: ["file-a"] },
      { kbId: "kb-b", fileFilter: null },
    ]),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const connectors = {
    connectors: [{ id: "connector-a", enabled: true }, { id: "connector-b", enabled: false }],
    update: vi.fn().mockResolvedValue(undefined),
  };
  return { plugins, sessions, kbBindings, connectors };
}

describe("composer resource removal", () => {
  it("unselects only the removed plugin for this session", async () => {
    const state = stores();
    await removeComposerSelection(token("plugin", "plugin-a"), "session", state as never);
    expect(state.plugins.setSessionPlugins).toHaveBeenCalledWith("session", ["plugin-b"]);
  });

  it("clears the selected expert without changing another expert", async () => {
    const state = stores();
    await removeComposerSelection(token("expert", "expert-a"), "session", state as never);
    expect(state.sessions.setExpert).toHaveBeenCalledWith("session", null);
    await removeComposerSelection(token("expert", "expert-b"), "session", state as never);
    expect(state.sessions.setExpert).toHaveBeenCalledTimes(1);
  });

  it("preserves other knowledge base bindings and their file filters", async () => {
    const state = stores();
    await removeComposerSelection(token("knowledge_base", "kb-b"), "session", state as never);
    expect(state.kbBindings.save).toHaveBeenCalledWith("session", [
      { kbId: "kb-a", fileFilter: ["file-a"] },
    ]);
  });

  it("disables an enabled connector through the same store as its picker", async () => {
    const state = stores();
    await removeComposerSelection(token("connector", "connector-a"), "session", state as never);
    expect(state.connectors.update).toHaveBeenCalledWith("connector-a", { enabled: false });
    await removeComposerSelection(token("connector", "connector-b"), "session", state as never);
    expect(state.connectors.update).toHaveBeenCalledTimes(1);
  });
});
