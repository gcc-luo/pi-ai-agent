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
    const wrapper = mount(AgentActivity, { props: { activity, expanded: false, canToggle: true } });

    expect(wrapper.get(".activity-summary").text()).toContain("正在处理");
    expect(wrapper.get(".activity-summary").text()).toContain("3 个步骤");
    expect(wrapper.get(".activity-summary").text()).toContain("搜索代码");
    expect(wrapper.find(".activity-details").exists()).toBe(false);
    expect(wrapper.get("button").attributes("aria-expanded")).toBe("false");
  });

  it("emits toggle and exposes full details only when expanded", async () => {
    const wrapper = mount(AgentActivity, { props: { activity, expanded: true, canToggle: true } });

    expect(wrapper.findAll(".activity-item")).toHaveLength(3);
    expect(wrapper.text()).toContain("rg any apps/web");
    expect(wrapper.text()).toContain("检查项目结构");
    await wrapper.get(".activity-summary").trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
  });

  it("renders assistant commentary between timed work steps", () => {
    const timeline = {
      ...activity,
      status: "complete" as const,
      items: [
        {
          id: "message:a1:0",
          kind: "message" as const,
          label: "analyzeRequest" as const,
          status: "complete" as const,
          part: { kind: "text" as const, text: "我先检查项目启动方式。" },
        },
        {
          ...activity.items[1]!,
          durationMs: 7_000,
        },
      ],
    };
    const wrapper = mount(AgentActivity, {
      props: { activity: timeline, expanded: true, canToggle: true },
    });

    expect(wrapper.get(".activity-message").text()).toContain("我先检查项目启动方式");
    expect(wrapper.get(".activity-item-duration").text()).toBe("已工作 7s");
  });

  it("announces failures in the completed summary", () => {
    const failed = {
      ...activity,
      status: "failed" as const,
      failedCount: 1,
      completedCount: 2,
      items: activity.items.map((item, index) => index === 2 ? { ...item, status: "failed" as const } : item),
    };
    const wrapper = mount(AgentActivity, { props: { activity: failed, expanded: false, canToggle: true } });

    expect(wrapper.get(".activity-summary").text()).toContain("1 项失败");
    expect(wrapper.get(".activity-summary").classes()).toContain("failed");
  });

  it("does not expose an expand button when there are no details", () => {
    const empty = { ...activity, items: [], operationCount: 0 };
    const wrapper = mount(AgentActivity, {
      props: { activity: empty, expanded: false, canToggle: false },
    });

    expect(wrapper.find("button.activity-summary").exists()).toBe(false);
    expect(wrapper.find(".activity-chevron").exists()).toBe(false);
    expect(wrapper.get(".activity-summary").text()).not.toContain("0 个步骤");
  });

  it("shows permission waiting as a distinct run state", () => {
    const waiting = { ...activity, status: "waiting_permission" as const };
    const wrapper = mount(AgentActivity, {
      props: { activity: waiting, expanded: false, canToggle: true },
    });

    expect(wrapper.get(".activity-summary").text()).toContain("等待你确认");
    expect(wrapper.get(".activity-summary").text()).toContain("1m 14s");
  });
});
