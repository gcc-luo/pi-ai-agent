import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(
  path.join(process.cwd(), "index.html"),
  "utf8",
);

describe("desktop startup screen", () => {
  it("renders a loading screen before JavaScript bootstraps", () => {
    expect(indexHtml).toContain('data-startup-screen');
    expect(indexHtml).toContain('data-startup-message');
    expect(indexHtml).toContain("正在启动本地服务");
  });
});
