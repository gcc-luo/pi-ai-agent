import { describe, expect, it } from "vitest";
import { PREVIEW_MIN_WIDTH, clampPreviewWidth, getPreviewMaxWidth } from "./preview-width.js";

describe("preview width", () => {
  it("caps the preview at half of the viewport", () => {
    expect(getPreviewMaxWidth(1200)).toBe(600);
    expect(getPreviewMaxWidth(1000)).toBe(500);
  });

  it("clamps dragged widths to the minimum and maximum bounds", () => {
    expect(clampPreviewWidth(240, 1200)).toBe(PREVIEW_MIN_WIDTH);
    expect(clampPreviewWidth(800, 1200)).toBe(600);
  });

  it("keeps the available maximum on narrow viewports", () => {
    expect(clampPreviewWidth(480, 600)).toBe(300);
  });
});
