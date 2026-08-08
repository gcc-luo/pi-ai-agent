import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import Sidebar from "../../src/components/Sidebar.vue";
import { api } from "../../src/api/client.js";
import { useSessionStore } from "../../src/stores/session.js";

describe("Sidebar session preview", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a compact Markdown preview", async () => {
    const sessions = useSessionStore();
    sessions.sessions = [{
      id: "s1",
      projectId: "p1",
      title: "诗歌会话",
      parentId: null,
      expertId: null,
      selectedPluginIds: [],
      browserEnabled: false,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
      lastActiveAt: 1,
      deletedAt: null,
    }];
    vi.spyOn(api, "listMessages").mockResolvedValue([{
      id: "m1",
      sessionId: "s1",
      role: "assistant",
      content: "## 小径\n\n**春风**吹过。<script>bad()</script>",
      metadata: null,
      createdAt: 1,
      seq: 1,
    }]);

    const wrapper = mount(Sidebar, {
      attachTo: document.body,
      props: { selectedProjectId: "p1", selectedSessionId: null },
      global: {
        stubs: {
          FileTree: true,
          NewProjectDialog: true,
          RenameProjectDialog: true,
          RenameSessionDialog: true,
          ConfirmDialog: true,
        },
      },
    });

    await wrapper.get('[aria-label="诗歌会话"]').trigger("mouseenter");
    await flushPromises();

    const preview = document.body.querySelector<HTMLElement>(".session-preview");
    expect(preview).not.toBeNull();
    expect(preview?.style.width).toBe("310px");
    expect(preview?.querySelector("h2")?.textContent).toBe("小径");
    expect(preview?.querySelector("strong")?.textContent).toBe("春风");
    expect(preview?.querySelector("script")).toBeNull();
  });
});
