import { describe, expect, it } from "vitest";
import { browserAddressScope } from "../../src/browser/browser-session-manager.js";

describe("Browser network policy", () => {
  it("distinguishes public, private, and loopback addresses", () => {
    expect(browserAddressScope("8.8.8.8")).toBe("public");
    expect(browserAddressScope("127.0.0.1")).toBe("loopback");
    expect(browserAddressScope("::1")).toBe("loopback");
    expect(browserAddressScope("10.0.0.1")).toBe("private");
    expect(browserAddressScope("172.16.0.1")).toBe("private");
    expect(browserAddressScope("192.168.1.1")).toBe("private");
    expect(browserAddressScope("169.254.169.254")).toBe("private");
    expect(browserAddressScope("fc00::1")).toBe("private");
    expect(browserAddressScope("fe80::1")).toBe("private");
  });
});
