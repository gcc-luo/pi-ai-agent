import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStartupErrorHtml } from "./startup-error.js";

const mockGetVersion = vi.fn();

vi.mock("./utils/platform.js", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

describe("createStartupErrorHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the desktop app version without depending on the backend", async () => {
    mockGetVersion.mockResolvedValue("1.3.2");

    const html = await createStartupErrorHtml(
      "Failed to start server sidecar: 拒绝访问。 (os error 5)",
    );

    expect(html).toContain("主程序版本：1.3.2");
    expect(html).toContain("后端服务无法启动");
  });

  it("escapes startup error details", async () => {
    mockGetVersion.mockResolvedValue("1.3.2");

    const html = await createStartupErrorHtml('<script>alert("x")</script>');

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
