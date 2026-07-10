import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ImportSkillDialog from "../../src/components/ImportSkillDialog.vue";

describe("ImportSkillDialog", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  function mountDialog(show: boolean) {
    return mount(ImportSkillDialog, {
      props: { show },
      global: {
        stubs: {
          Modal: { template: '<div v-if="show"><slot/></div>', props: ["show"] },
          Input: {
            template: '<textarea v-if="type === \'textarea\'" :value="value" @input="$emit(\'update:value\', $event.target.value)" /><input v-else :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
            props: ["value", "type"],
          },
        },
      },
    });
  }

  it("renders three inputs (name, description, body) when shown", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    expect(inputs.length).toBe(2); // name + description (body is textarea)
    const textareas = w.findAll("textarea");
    expect(textareas.length).toBe(1);
  });

  it("disables save when name is empty", async () => {
    const w = mountDialog(true);
    await nextTick();
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables save when name is invalid (uppercase, spaces)", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("Bad Name");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables save when description is empty", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("valid-name");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables save when body is empty", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("valid-name");
    await inputs[1]!.setValue("a description");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables save when all fields valid", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("my-skill");
    await inputs[1]!.setValue("does a thing");
    await w.find("textarea").setValue("body content");
    expect((w.find("[data-test='save']").element as HTMLButtonElement).disabled).toBe(false);
  });

  it("emits create({name,description,body}) and close on save", async () => {
    const w = mountDialog(true);
    await nextTick();
    const inputs = w.findAll("input");
    await inputs[0]!.setValue("my-skill");
    await inputs[1]!.setValue("does a thing");
    await w.find("textarea").setValue("body content");
    await w.find("[data-test='save']").trigger("click");
    const events = w.emitted();
    expect(events.create).toEqual([[{ name: "my-skill", description: "does a thing", body: "body content" }]]);
    expect(events.close).toBeDefined();
  });
});
