import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import ChatPanel from "../../src/components/ChatPanel.vue";
import { useAgentStore } from "../../src/stores/agent.js";
import { useI18n } from "../../src/i18n/index.js";

const artifact = {
  path: "界面布局提示词.md",
  name: "界面布局提示词",
  mimeType: "text/markdown",
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mountPanel() {
  return mount(ChatPanel, {
    props: { sessionId: "s1", projectId: "p1" },
    global: {
      stubs: {
        NInput: true,
        SkillSelect: true,
        PluginSelect: true,
        ConnectorSelect: true,
        ImportSkillDialog: true,
        ChatExpertPicker: true,
        ChatKbPicker: true,
        ChatKbBanner: true,
        ChatKbCallCard: true,
        TokenUsage: true,
        AgentActivity: true,
        ConfirmDialog: true,
        FileViewer: true,
      },
    },
  });
}

function addArtifactMessage() {
  const agent = useAgentStore();
  agent.streams.s1 = [
    {
      id: "u1",
      role: "user",
      parts: [{ kind: "text", text: "分析布局" }],
      status: "complete",
      createdAt: 1,
      metadata: null,
    },
    {
      id: "a1",
      role: "assistant",
      parts: [{
        kind: "text",
        text: `布局说明\n<artifacts>\n${JSON.stringify([artifact])}\n</artifacts>`,
      }],
      status: "complete",
      createdAt: 2,
      metadata: null,
    },
  ];
}

describe("ChatPanel artifact validation", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useI18n().setLocale("zh");
    vi.restoreAllMocks();
  });

  it("does not show a delivered-file card before validation returns", async () => {
    let resolveValidation!: (value: unknown) => void;
    const validation = new Promise<unknown>((resolve) => { resolveValidation = resolve; });
    vi.stubGlobal("fetch", vi.fn((input: string | URL) =>
      String(input).includes("/validate-artifacts")
        ? validation.then(jsonResponse)
        : Promise.resolve(jsonResponse([])),
    ));

    const wrapper = mountPanel();
    await flushPromises();
    addArtifactMessage();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".artifact-card").exists()).toBe(false);

    resolveValidation([{ ...artifact, exists: false, size: null }]);
    await flushPromises();
    await wrapper.vm.$nextTick();
    wrapper.unmount();
  });

  it("shows a declaration warning instead of a file card when validation fails", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) =>
      String(input).includes("/validate-artifacts")
        ? Promise.resolve(jsonResponse([{ ...artifact, exists: false, size: null }]))
        : Promise.resolve(jsonResponse([])),
    ));

    const wrapper = mountPanel();
    await flushPromises();
    addArtifactMessage();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".artifact-card").exists()).toBe(false);
    expect(wrapper.get(".artifact-invalid").text()).toContain("文件声明无效");
    wrapper.unmount();
  });

  it("shows the file card after validation confirms the file exists", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) =>
      String(input).includes("/validate-artifacts")
        ? Promise.resolve(jsonResponse([{ ...artifact, exists: true, size: 128 }]))
        : Promise.resolve(jsonResponse([])),
    ));

    const wrapper = mountPanel();
    await flushPromises();
    addArtifactMessage();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".artifact-card").exists()).toBe(true);
    expect(wrapper.find(".artifact-invalid").exists()).toBe(false);
    wrapper.unmount();
  });
});
