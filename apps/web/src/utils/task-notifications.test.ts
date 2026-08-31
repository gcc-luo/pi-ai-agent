import { describe, expect, it } from "vitest";
import {
  formatUnreadCount,
  isViewingSettledSession,
} from "./task-notifications.js";

const view = {
  activeNav: "chat",
  projectId: "project-1",
  sessionId: "session-1",
};
const windowState = { focused: true, visible: true, minimized: false };

describe("task notification policy", () => {
  it("treats only the focused visible target session as being viewed", () => {
    expect(isViewingSettledSession(view, windowState, {
      projectId: "project-1", sessionId: "session-1",
    })).toBe(true);
    expect(isViewingSettledSession({ ...view, sessionId: "session-2" }, windowState, {
      projectId: "project-1", sessionId: "session-1",
    })).toBe(false);
    expect(isViewingSettledSession({ ...view, activeNav: "plugins" }, windowState, {
      projectId: "project-1", sessionId: "session-1",
    })).toBe(false);
  });

  it.each([
    { focused: false, visible: true, minimized: false },
    { focused: true, visible: false, minimized: false },
    { focused: true, visible: true, minimized: true },
  ])("notifies when the window is not actively viewable", (state) => {
    expect(isViewingSettledSession(view, state, {
      projectId: "project-1", sessionId: "session-1",
    })).toBe(false);
  });

  it("formats unread counts with a 99+ ceiling", () => {
    expect(formatUnreadCount(1)).toBe("1");
    expect(formatUnreadCount(99)).toBe("99");
    expect(formatUnreadCount(100)).toBe("99+");
  });
});
