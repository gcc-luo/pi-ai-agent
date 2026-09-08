import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TokenUsage from "../../src/components/TokenUsage.vue";
import { summarizeTokenUsage } from "../../src/utils/token-usage.js";

const usage = summarizeTokenUsage([
  { id: "u1", role: "user", metadata: null },
  { id: "a1", role: "assistant", metadata: { usage: { input: 1_200, output: 300 } } },
]);
const emptyUsage = summarizeTokenUsage([
  { id: "u1", role: "user", metadata: null },
]);

function mountUsage(value = usage) {
  return mount(TokenUsage, { props: { usage: value, busy: false } });
}

function bodyGet(selector: string): HTMLElement {
  const element = document.body.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Unable to get ${selector} from document.body`);
  return element;
}

describe("TokenUsage", () => {
  it("starts on overview and switches to call details", async () => {
    const wrapper = mountUsage();
    await wrapper.get(".token-usage-summary").trigger("click");

    expect(bodyGet("[role=tab][aria-selected=true]").textContent).toContain("概览");
    expect(bodyGet("[data-panel=overview]").textContent).toContain("1.2K");
    expect(document.body.querySelector("[data-panel=calls]")).toBeNull();

    bodyGet("[data-tab=calls]").click();
    await nextTick();

    expect(bodyGet("[role=tab][aria-selected=true]").textContent).toContain("调用明细");
    expect(document.body.querySelector("[data-panel=overview]")).toBeNull();
    expect(bodyGet("[data-panel=calls] table").textContent).toContain("—");
    wrapper.unmount();
  });

  it("shows an empty state instead of an empty table", async () => {
    const wrapper = mountUsage(emptyUsage);
    await wrapper.get(".token-usage-summary").trigger("click");

    bodyGet("[data-tab=calls]").click();
    await nextTick();

    expect(bodyGet("[data-panel=calls]").textContent).toContain("暂无调用明细");
    expect(document.body.querySelector("[data-panel=calls] table")).toBeNull();
    wrapper.unmount();
  });

  it("opens a centered modal with a close button and closes on Escape", async () => {
    const wrapper = mount(TokenUsage, { props: { usage, busy: false } });

    expect(document.body.querySelector(".token-usage-details")).toBeNull();
    await wrapper.get(".token-usage-summary").trigger("click");

    const dialog = document.body.querySelector(".token-usage-details");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.querySelector(".token-usage-close")).not.toBeNull();
    expect(dialog?.textContent).toContain("会话累计");

    bodyGet("[data-tab=calls]").click();
    await nextTick();
    dialog?.querySelector<HTMLButtonElement>(".token-usage-close")?.click();
    await nextTick();
    expect(document.body.querySelector(".token-usage-details")).toBeNull();

    await wrapper.get(".token-usage-summary").trigger("click");
    expect(bodyGet("[role=tab][aria-selected=true]").textContent).toContain("概览");
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
