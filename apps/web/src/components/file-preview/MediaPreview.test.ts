import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ImagePreview from "./ImagePreview.vue";
import VideoPreview from "./VideoPreview.vue";
import AudioPreview from "./AudioPreview.vue";

vi.mock("../../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const previewCases = [
  { name: "image", component: ImagePreview, selector: "img" },
  { name: "video", component: VideoPreview, selector: "video" },
  { name: "audio", component: AudioPreview, selector: "audio" },
];

describe.each(previewCases)("$name preview errors", ({ component, selector }) => {
  it("shows a retry action on element errors and remounts the media element", async () => {
    const wrapper = mount(component, { props: { url: "/raw/media" } });
    const originalElement = wrapper.get(selector).element;

    await wrapper.get(selector).trigger("error");
    await flushPromises();
    expect(wrapper.text()).toContain("viewer.loadFailed");
    expect(wrapper.findAll('[data-test="retry-media-preview"]')).toHaveLength(1);

    await wrapper.get('[data-test="retry-media-preview"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0);
    expect(wrapper.get(selector).element).not.toBe(originalElement);
    wrapper.unmount();
  });
});
