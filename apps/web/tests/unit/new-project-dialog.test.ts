import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import NewProjectDialog from "../../src/components/NewProjectDialog.vue";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  open: vi.fn(),
  browseDir: vi.fn(),
}));

vi.mock("../../src/utils/platform.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../src/api/client.js", () => ({ api: { browseDir: mocks.browseDir } }));

type BrowseResult = {
  currentPath: string;
  parentPath: string;
  directories: { name: string; path: string }[];
};

const defaultBrowseResult: BrowseResult = {
  currentPath: "C:\\Users\\gengcc",
  parentPath: "C:\\Users",
  directories: [],
};

async function mountDialog(
  show: boolean,
  browseResult: BrowseResult = defaultBrowseResult,
) {
  mocks.browseDir.mockResolvedValue(browseResult);
  const wrapper = mount(NewProjectDialog, {
    props: { show: false },
    global: {
      stubs: {
        Modal: { template: '<div v-if="show"><slot/></div>', props: ["show"] },
        Input: {
          template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
          props: ["value"],
        },
      },
    },
  });
  if (show) await wrapper.setProps({ show: true });
  await flushPromises();
  return wrapper;
}

describe("NewProjectDialog", () => {
  beforeEach(() => {
    mocks.isTauri.mockReset();
    mocks.isTauri.mockReturnValue(false);
    mocks.open.mockReset();
    mocks.browseDir.mockReset();
  });

  it("uses the current directory when choosing the current location", async () => {
    const wrapper = await mountDialog(true, {
      currentPath: "C:\\Users\\gengcc\\IdeaProjects",
      parentPath: "C:\\Users\\gengcc",
      directories: [],
    });

    await wrapper.find("[data-test='choose-current-directory']").trigger("click");

    expect(wrapper.emitted("create")).toEqual([[
      "IdeaProjects",
      "C:\\Users\\gengcc\\IdeaProjects",
    ]]);
    expect(wrapper.emitted("close")).toBeDefined();
  });

  it("uses a selected child directory when choosing the current location", async () => {
    const wrapper = await mountDialog(true, {
      currentPath: "C:\\Users\\gengcc",
      parentPath: "C:\\Users",
      directories: [{ name: "demo", path: "C:\\Users\\gengcc\\demo" }],
    });

    await wrapper.find("[data-test='directory-item']").trigger("click");
    await wrapper.find("[data-test='choose-current-directory']").trigger("click");

    expect(wrapper.emitted("create")).toEqual([[
      "demo",
      "C:\\Users\\gengcc\\demo",
    ]]);
  });

  it("enters a directory on double click without creating it", async () => {
    const wrapper = await mountDialog(true, {
      currentPath: "C:\\Users\\gengcc",
      parentPath: "C:\\Users",
      directories: [{ name: "IdeaProjects", path: "C:\\Users\\gengcc\\IdeaProjects" }],
    });

    await wrapper.find("[data-test='directory-item']").trigger("dblclick");

    expect(mocks.browseDir).toHaveBeenCalledWith("C:\\Users\\gengcc\\IdeaProjects");
    expect(wrapper.emitted("create")).toBeUndefined();
  });

  it("does not create when the desktop picker is cancelled", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.open.mockResolvedValue(null);
    const wrapper = await mountDialog(true);

    expect(mocks.open).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(wrapper.emitted("create")).toBeUndefined();
  });

  it("creates immediately with the final desktop directory name", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.open.mockResolvedValue("C:\\Users\\gengcc\\IdeaProjects\\demo");
    const wrapper = await mountDialog(true);

    expect(wrapper.emitted("create")).toEqual([[
      "demo",
      "C:\\Users\\gengcc\\IdeaProjects\\demo",
    ]]);
    expect(wrapper.emitted("close")).toBeDefined();
  });
});
