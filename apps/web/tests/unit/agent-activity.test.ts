import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import AgentActivity from "../../src/components/AgentActivity.vue";
import { useI18n } from "../../src/i18n/index.js";
import type { AgentActivity as AgentActivityModel } from "../../src/utils/chat-run-presentation.js";

const activity: AgentActivityModel = {
  runId: "run:u1",
  status: "running",
  durationMs: 74_000,
  currentLabel: "searchCode",
  operationCount: 2,
  completedCount: 1,
  failedCount: 0,
  items: [
    {
      id: "thinking:a1:0",
      kind: "thinking",
      label: "analyzeRequest",
      status: "complete",
      part: { kind: "thinking", text: "检查项目结构" },
    },
    {
      id: "call-1",
      kind: "tool",
      label: "searchCode",
      status: "complete",
      part: {
        kind: "tool_call",
        toolCallId: "call-1",
        name: "bash",
        args: { command: "rg any apps/web" },
        status: "complete",
        result: "2 matches",
      },
    },
    {
      id: "call-2",
      kind: "tool",
      label: "verifyResults",
      status: "running",
      part: {
        kind: "tool_call",
        toolCallId: "call-2",
        name: "bash",
        args: { command: "pnpm test" },
        status: "running",
      },
    },
  ],
};

describe("AgentActivity", () => {
  beforeEach(() => useI18n().setLocale("zh"));

  it("shows one compact summary while collapsed", () => {
    const wrapper = mount(AgentActivity, { props: { activity, expanded: false } });

    expect(wrapper.get(".activity-summary").text()).toContain("正在处理");
    expect(wrapper.get(".activity-summary").text()).toContain("2 项操作");
    expect(wrapper.get(".activity-summary").text()).toContain("搜索代码");
    expect(wrapper.find(".activity-details").exists()).toBe(false);
    expect(wrapper.get("button").attributes("aria-expanded")).toBe("false");
  });

  it("emits toggle and exposes full details only when expanded", async () => {
    const wrapper = mount(AgentActivity, { props: { activity, expanded: true } });

    expect(wrapper.findAll(".activity-item")).toHaveLength(3);
    expect(wrapper.text()).toContain("rg any apps/web");
    expect(wrapper.text()).toContain("检查项目结构");
    await wrapper.get(".activity-summary").trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("announces failures in the completed summary", () => {
    const failed = {
      ...activity,
      status: "failed" as const,
      failedCount: 1,
      completedCount: 2,
      items: activity.items.map((item, index) => index === 2 ? { ...item, status: "failed" as const } : item),
    };
    const wrapper = mount(AgentActivity, { props: { activity: failed, expanded: false } });

    expect(wrapper.get(".activity-summary").text()).toContain("1 项失败");
    expect(wrapper.get(".activity-summary").classes()).toContain("failed");
  });
});
