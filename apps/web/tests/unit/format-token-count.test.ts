import { describe, expect, it } from "vitest";
import { formatTokenCount } from "../../src/utils/format-token-count.js";

describe("formatTokenCount", () => {
  it("formats token counts below one thousand without a unit", () => {
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats token counts in K until the 1024K boundary", () => {
    expect(formatTokenCount(1_000)).toBe("1.0K");
    expect(formatTokenCount(1_023_999)).toBe("1024.0K");
  });

  it("switches to M after 1024K", () => {
    expect(formatTokenCount(1_024_000)).toBe("1.0M");
    expect(formatTokenCount(2_500_900)).toBe("2.4M");
  });
});
