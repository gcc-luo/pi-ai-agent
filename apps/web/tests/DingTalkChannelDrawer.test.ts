import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DingTalkChannelDrawer from "../src/components/DingTalkChannelDrawer.vue";
import WeChatChannelDrawer from "../src/components/WeChatChannelDrawer.vue";

const stubs = vi.hoisted(() => ({
  button: { template: "<button><slot /></button>" },
  drawer: { template: "<div><slot /></div>" },
  dropdown: {
    name: "NDropdown",
    props: { width: { type: String, default: undefined } },
    template: "<div><slot /></div>",
  },
  input: { template: "<input />" },
  spin: { template: "<span />" },
  switch: { template: "<input type='checkbox' />" },
}));

vi.mock("naive-ui", () => ({
  NButton: stubs.button,
  NDrawer: stubs.drawer,
  NDropdown: stubs.dropdown,
  NInput: stubs.input,
  NSpin: stubs.spin,
  NSwitch: stubs.switch,
  useMessage: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}));

vi.mock("../src/api/client.js", () => ({ api: { listProjects: vi.fn() } }));
vi.mock("../src/stores/channel.js", () => ({ useChannelStore: () => ({}) }));
vi.mock("../src/i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("DingTalkChannelDrawer", () => {
  it("matches the project menu width to its trigger button", () => {
    const wrapper = mount(DingTalkChannelDrawer, {
      props: { show: false, config: null },
    });

    expect(wrapper.findComponent(stubs.dropdown).props("width")).toBe("trigger");
  });
});

describe("WeChatChannelDrawer", () => {
  it("matches the project menu width to its trigger button", () => {
    const wrapper = mount(WeChatChannelDrawer, {
      props: { show: false, config: null },
    });

    expect(wrapper.findComponent(stubs.dropdown).props("width")).toBe("trigger");
  });
});
