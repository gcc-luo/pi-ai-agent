import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentDir = resolve(process.cwd(), "src/components");

describe("composer capability resource selection", () => {
  it("renders resource categories with their concrete selections in a two-level menu", async () => {
    const toolbar = await readFile(resolve(componentDir, "ChatCapabilityToolbar.vue"), "utf8");
    const panel = await readFile(resolve(componentDir, "ChatPanel.vue"), "utf8");

    expect(toolbar.includes('class="capability-menu-categories"')).toBe(true);
    expect(toolbar.includes('class="capability-menu-detail"')).toBe(true);
    expect(toolbar.includes(':inline="true"')).toBe(true);
    expect(toolbar.includes("pick-files")).toBe(true);
    expect(toolbar.includes("pick-folder")).toBe(false);
    expect(toolbar.includes("chat.chooseFolder")).toBe(false);
    expect(toolbar.includes("height: min(254px, calc(60vh - 44px));")).toBe(true);
    expect(panel.includes("height: min(420px, 60vh);")).toBe(false);
    expect(panel.includes("grid-template-rows: minmax(0, 1fr);")).toBe(true);
    expect(toolbar.includes('<span class="capability-menu-category-icon">')).toBe(true);
    expect(toolbar.includes('class="capability-menu-category-chevron"')).toBe(true);
  });

  it("shares the navigation SVGs for matching add-menu categories", async () => {
    const [toolbar, navRail, icons] = await Promise.all([
      readFile(resolve(componentDir, "ChatCapabilityToolbar.vue"), "utf8"),
      readFile(resolve(componentDir, "NavRail.vue"), "utf8"),
      readFile(resolve(componentDir, "CapabilityCategoryIcon.vue"), "utf8"),
    ]);

    expect(toolbar).toContain("<CapabilityCategoryIcon");
    expect(navRail).toContain("<CapabilityCategoryIcon class=\"nav-icon\" name=\"skills\" />");
    expect(navRail).toContain("<CapabilityCategoryIcon class=\"nav-icon\" name=\"plugins\" />");
    expect(navRail).toContain("<CapabilityCategoryIcon class=\"nav-icon\" name=\"connectors\" />");
    expect(navRail).toContain("<CapabilityCategoryIcon class=\"nav-icon\" name=\"knowledge\" />");
    expect(navRail).toContain("<CapabilityCategoryIcon class=\"nav-icon\" name=\"experts\" />");
    expect(icons).toContain("name === 'skills'");
    expect(icons).toContain("name === 'plugins'");
    expect(icons).toContain("name === 'connectors'");
    expect(icons).toContain("name === 'knowledge'");
    expect(icons).toContain("name === 'experts'");
  });

  it("forwards selected plugins, experts, knowledge bases, and connectors", async () => {
    const [toolbar, plugins, experts, knowledgeBases, connectors] = await Promise.all([
      readFile(resolve(componentDir, "ChatCapabilityToolbar.vue"), "utf8"),
      readFile(resolve(componentDir, "PluginSelect.vue"), "utf8"),
      readFile(resolve(componentDir, "ChatExpertPicker.vue"), "utf8"),
      readFile(resolve(componentDir, "ChatKbPicker.vue"), "utf8"),
      readFile(resolve(componentDir, "ConnectorSelect.vue"), "utf8"),
    ]);

    expect(toolbar.includes('@selected="selectPlugin"')).toBe(true);
    expect(toolbar.includes('@selected="selectExpert"')).toBe(true);
    expect(toolbar.includes('@selected="selectKnowledgeBase"')).toBe(true);
    expect(toolbar.includes('@selected="selectConnector"')).toBe(true);
    expect(plugins.includes('emit("selected", plugin)')).toBe(true);
    expect(experts.includes('emit("selected", expert)')).toBe(true);
    expect(knowledgeBases.includes('emit("selected", kb)')).toBe(true);
    expect(connectors.includes('emit("selected", item)')).toBe(true);
  });
});
