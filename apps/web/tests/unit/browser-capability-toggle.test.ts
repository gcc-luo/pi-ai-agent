import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ChatPanel from "../../src/components/ChatPanel.vue";
import { usePluginStore } from "../../src/stores/plugin.js";

describe("ChatPanel plugin selection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("loads globally enabled plugins and updates only the current session", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api/, "");
      const browser = {
        id: "browser-use", name: "Browser Use", icon: "🌐", version: "1.0.0",
        description: "Browser", source: "Pi Web UI", builtin: true, official: true,
        enabled: true, status: "enabled", tools: [], skills: [], capabilities: [],
        permissions: [], supportedPlatforms: ["win32"], settings: {}, error: null, updatedAt: 1,
      };
      if (path === "/plugins" && (!init?.method || init.method === "GET")) {
        return Response.json([browser]);
      }
      if (path === "/sessions/s1/plugins" && (!init?.method || init.method === "GET")) {
        return Response.json({
          selectedPluginIds: [],
          availablePlugins: [browser],
        });
      }
      if (path === "/sessions/s1/plugins" && init?.method === "PUT") {
        return Response.json({ session: null, selectedPluginIds: ["browser-use"], availablePlugins: [browser] });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(ChatPanel, {
      props: { sessionId: "s1", projectId: "p1" },
      global: {
        stubs: {
          Modal: { template: "<div><slot /></div>" },
          Input: { template: "<textarea />" },
        },
      },
    });
    await flushPromises();

    expect(wrapper.find("[data-test='session-plugin-select']").exists()).toBe(true);
    const pluginStore = usePluginStore();
    await pluginStore.setSessionPlugins("s1", ["browser-use"]);
    await flushPromises();

    expect(pluginStore.selectedBySession.s1).toEqual(["browser-use"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/s1/plugins",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ pluginIds: ["browser-use"] }),
      }),
    );
  });
});
