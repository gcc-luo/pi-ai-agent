import { describe, expect, it } from "vitest";
import { SIDEBAR_MIN_WIDTH, clampSidebarWidth, getSidebarMaxWidth } from "../../src/utils/sidebar-width.js";

describe("sidebar width", () => {
  it("limits the sidebar maximum width to 40% of the viewport", () => {
    expect(getSidebarMaxWidth(1200)).toBe(480);
  });

  it("clamps dragged widths to the minimum and maximum bounds", () => {
    expect(clampSidebarWidth(180, 1200)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(520, 1200)).toBe(480);
  });

  it("keeps the 40% limit on narrow viewports", () => {
    expect(clampSidebarWidth(320, 600)).toBe(240);
  });
});
