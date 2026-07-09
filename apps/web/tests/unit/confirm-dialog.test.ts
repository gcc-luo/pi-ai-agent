import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmDialog from "../../src/components/ConfirmDialog.vue";

describe("ConfirmDialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  // NOTE: stub key must match naive-ui's internal component `name` option
  // ("Modal"), not the export alias ("NModal"). See task-8-report.md. Without
  // this fix the real NModal renders via Teleport to document.body and
  // w.find(...) fails.
  function mountDialog(danger = false) {
    return mount(ConfirmDialog, {
      props: {
        show: true,
        title: "T",
        message: "M",
        confirmLabel: "OK",
        cancelLabel: "Cancel",
        danger,
      },
      global: {
        stubs: {
          Modal: { template: '<div v-if="show"><slot/></div>', props: ["show"] },
        },
      },
    });
  }

  it("emits confirm then close when confirm button clicked", async () => {
    const w = mountDialog();
    await w.find("[data-test='confirm']").trigger("click");
    expect(w.emitted().confirm).toBeDefined();
    expect(w.emitted().close).toBeDefined();
  });

  it("applies danger class when danger=true", async () => {
    const w = mountDialog(true);
    expect(w.find("[data-test='confirm']").classes()).toContain("danger");
  });

  it("emits close when cancel clicked", async () => {
    const w = mountDialog();
    await w.find("[data-test='cancel']").trigger("click");
    expect(w.emitted().close).toBeDefined();
    expect(w.emitted().confirm).toBeUndefined();
  });
});
