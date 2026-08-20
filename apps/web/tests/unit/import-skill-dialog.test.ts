import { describe, it, expect, beforeEach } from "vitest";
import { DOMWrapper, mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import ImportSkillDialog from "../../src/components/ImportSkillDialog.vue";

describe("ImportSkillDialog", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; });

  function mountDialog(show = true) {
    return mount(ImportSkillDialog, {
      props: { show },
      global: {
        stubs: {
          NModal: { template: '<div><slot/></div>' },
        },
      },
    });
  }

  async function chooseFile(file: File) {
    const input = new DOMWrapper(document.body).find("input[type=file]");
    Object.defineProperty(input.element, "files", { configurable: true, value: [file] });
    await input.trigger("change");
  }

  it("renders the zip picker and disables import until a file is selected", () => {
    mountDialog();
    const dialog = new DOMWrapper(document.body);
    expect(dialog.find("input[type=file]").exists()).toBe(true);
    expect((dialog.find("[data-test=import]").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects non-zip files", async () => {
    mountDialog();
    await chooseFile(new File(["not a zip"], "notes.txt", { type: "text/plain" }));
    const dialog = new DOMWrapper(document.body);
    expect(dialog.find(".status-block.error").exists()).toBe(true);
    expect((dialog.find("[data-test=import]").element as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables import for a zip file", async () => {
    mountDialog();
    await chooseFile(new File(["zip"], "skill.zip", { type: "application/zip" }));
    expect((new DOMWrapper(document.body).find("[data-test=import]").element as HTMLButtonElement).disabled).toBe(false);
  });
});
