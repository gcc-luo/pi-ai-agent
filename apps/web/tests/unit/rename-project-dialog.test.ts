import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { ProjectDto } from "@pi-web-ui/shared";
import RenameProjectDialog from "../../src/components/RenameProjectDialog.vue";

describe("RenameProjectDialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  // NOTE: stub keys must match naive-ui's internal component `name` options
  // ("Modal" / "Input"), not the export alias ("NModal" / "NInput"). See
  // task-8-report.md for details. The `as HTMLInputElement` cast from the
  // brief is dropped because Vue's runtime template compiler cannot parse TS
  // type assertions in template strings; `$event.target.value` is equivalent
  // at runtime.
  function mountDialog(show: boolean, project: ProjectDto | null) {
    return mount(RenameProjectDialog, {
      props: { show, project },
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

  const project: ProjectDto = {
    id: "1",
    name: "old",
    workdir: "/tmp",
    description: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };

  it("prefills the input with the project name when shown", async () => {
    const w = mountDialog(true, project);
    await nextTick();
    const input = w.find("input");
    expect((input.element as HTMLInputElement).value).toBe("old");
  });

  it("emits rename(id, name) on save then close", async () => {
    const w = mountDialog(true, project);
    await nextTick();
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "new-name";
    await input.trigger("input");
    await w.find("[data-test='save']").trigger("click");
    const events = w.emitted();
    expect(events.rename).toEqual([["1", "new-name"]]);
    expect(events.close).toBeDefined();
  });

  it("disables save when name is empty", async () => {
    const w = mountDialog(true, project);
    await nextTick();
    const input = w.find("input");
    (input.element as HTMLInputElement).value = "   ";
    await input.trigger("input");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });
});
