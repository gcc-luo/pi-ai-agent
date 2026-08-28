import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsDialog from "./SettingsDialog.vue";

const mockThemeStore = vi.hoisted(() => ({
  mode: "dark",
  set: vi.fn(),
}));

const mockUpdateStore = vi.hoisted(() => ({
  status: "idle",
  currentVersion: "1.4.1",
  isAvailable: false,
  isDownloading: false,
  checkForUpdate: vi.fn(),
  getAppVersion: vi.fn(),
}));

vi.mock("../i18n/index.js", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    currentLocale: { value: "zh" },
    toggleLocale: vi.fn(),
  }),
}));

vi.mock("../stores/theme.js", () => ({
  useThemeStore: () => mockThemeStore,
  THEME_OPTIONS: [{ value: "dark", label: "Dark" }],
}));

vi.mock("../stores/update.js", () => ({
  useUpdateStore: () => mockUpdateStore,
}));

vi.mock("../utils/platform.js", () => ({
  isTauri: () => true,
}));

function mountDialog() {
  return mount(SettingsDialog, {
    props: { show: true },
    global: {
      stubs: {
        Modal: {
          name: "Modal",
          template: '<div v-if="show"><slot /></div>',
          props: ["show"],
        },
      },
    },
  });
}

describe("SettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits an event for the version information entry", async () => {
    const wrapper = mountDialog();

    await wrapper.get("[data-test=view-version-info]").trigger("click");

    expect(wrapper.emitted("view-version-info")).toHaveLength(1);
  });
});
