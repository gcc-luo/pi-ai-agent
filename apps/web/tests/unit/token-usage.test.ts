import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TokenUsage from "../../src/components/TokenUsage.vue";
import { summarizeTokenUsage } from "../../src/utils/token-usage.js";

const usage = summarizeTokenUsage([
  { id: "u1", role: "user", metadata: null },
  { id: "a1", role: "assistant", metadata: { usage: { input: 1_200, output: 300 } } },
]);

describe("TokenUsage", () => {
  it("opens a centered modal with a close button and closes on Escape", async () => {
    const wrapper = mount(TokenUsage, { props: { usage, busy: false } });

    expect(document.body.querySelector(".token-usage-details")).toBeNull();
    await wrapper.get(".token-usage-summary").trigger("click");

    const dialog = document.body.querySelector(".token-usage-details");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.querySelector(".token-usage-close")).not.toBeNull();
    expect(dialog?.textContent).toContain("会话累计");

    dialog?.querySelector<HTMLButtonElement>(".token-usage-close")?.click();
    await nextTick();
    expect(document.body.querySelector(".token-usage-details")).toBeNull();

    await wrapper.get(".token-usage-summary").trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(document.body.querySelector(".token-usage-details")).toBeNull();

    wrapper.unmount();
  });

  it("closes when the backdrop is clicked", async () => {
    const wrapper = mount(TokenUsage, { props: { usage, busy: false } });
    await wrapper.get(".token-usage-summary").trigger("click");

    const backdrop = document.body.querySelector<HTMLElement>(".token-usage-backdrop");
    backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(document.body.querySelector(".token-usage-details")).toBeNull();

    wrapper.unmount();
  });
});
