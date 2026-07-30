import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ChatPanel from "../../src/components/ChatPanel.vue";

describe("ChatPanel browser capability", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("loads a disabled session and enables only that session from the composer", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api/, "");
      if (path === "/sessions/s1/browser" && (!init?.method || init.method === "GET")) {
        return Response.json({
          enabled: false,
          status: "disabled",
          pageCount: 0,
          currentUrl: null,
          error: null,
        });
      }
      if (path === "/sessions/s1/browser" && init?.method === "PUT") {
        return Response.json({
          enabled: true,
          status: "running",
          pageCount: 1,
          currentUrl: "about:blank",
          error: null,
        });
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

    const toggle = wrapper.get("[data-test='browser-capability-toggle']");
    expect(toggle.classes()).not.toContain("enabled");
    await toggle.trigger("click");
    await flushPromises();

    expect(toggle.classes()).toContain("enabled");
    expect(toggle.classes()).toContain("running");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions/s1/browser",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
      }),
    );
  });
});
