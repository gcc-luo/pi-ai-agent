import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = resolve(process.cwd(), "src/components/ScheduledTasksView.vue");

describe("ScheduledTasksView execution logs", () => {
  it("renders logs as a paginated table with a conversation detail action", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain("class=\"logs-modal-table\"");
    expect(source).toContain("<NPagination");
    expect(source).toContain("openLogDetail");
    expect(source).toContain("log-detail-modal");
  });
});
