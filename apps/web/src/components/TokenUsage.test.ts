import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokenUsageSource = readFileSync(resolve(process.cwd(), "src/components/TokenUsage.vue"), "utf8");

describe("TokenUsage supporting text", () => {
  it("uses the compact metric-label size for both explanatory texts", () => {
    expect(tokenUsageSource).toMatch(/\.token-usage-intro\s*\{[^}]*font-size:\s*10px/);
    expect(tokenUsageSource).toMatch(/\.usage-actions \.compact-context-hint\s*\{[^}]*font-size:\s*10px/);
  });
});
