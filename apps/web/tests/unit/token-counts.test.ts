import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import TokenCounts from "../../src/components/TokenCounts.vue";
import { useI18n } from "../../src/i18n/index.js";

describe("TokenCounts", () => {
  beforeEach(() => useI18n().setLocale("zh"));

  it("renders arrows separately from token values", () => {
    const wrapper = mount(TokenCounts, { props: { input: 131_400, output: 4_600 } });

    expect(wrapper.get(".token-arrow-in").text()).toBe("↑");
    expect(wrapper.get(".token-arrow-out").text()).toBe("↓");
    expect(wrapper.get(".token-in .token-value").text()).toBe("131.4K");
    expect(wrapper.get(".token-out .token-value").text()).toBe("4.6K");
  });
});
