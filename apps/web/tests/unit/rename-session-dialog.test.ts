import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { SessionDto } from "@pi-web-ui/shared";
import RenameSessionDialog from "../../src/components/RenameSessionDialog.vue";

describe("RenameSessionDialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  function mountDialog(show: boolean, session: SessionDto | null) {
    return mount(RenameSessionDialog, {
      props: { show, session },
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
  }

  const session: SessionDto = {
    id: "s1",
    projectId: "p1",
    title: "old",
    parentId: null,
    expertId: null,
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    lastActiveAt: null,
    deletedAt: null,
  };

  it("prefills the input with the session title when shown", async () => {
    const w = mountDialog(true, session);
    await nextTick();
    const input = w.find("input");
    expect((input.element as HTMLInputElement).value).toBe("old");
  });

  it("emits rename(id, title) on save then close", async () => {
    const w = mountDialog(true, session);
    await nextTick();
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "new-title";
    await input.trigger("input");
    await w.find("[data-test='save']").trigger("click");
    const events = w.emitted();
    expect(events.rename).toEqual([["s1", "new-title"]]);
    expect(events.close).toBeDefined();
  });

  it("disables save when title is empty", async () => {
    const w = mountDialog(true, session);
    await nextTick();
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "   ";
    await input.trigger("input");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });
});
