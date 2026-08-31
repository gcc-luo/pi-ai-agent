export interface AppViewContext {
  activeNav: string;
  projectId: string | null;
  sessionId: string | null;
}

export interface DesktopWindowState {
  focused: boolean;
  visible: boolean;
  minimized: boolean;
}

export function isViewingSettledSession(
  view: AppViewContext,
  windowState: DesktopWindowState,
  target: { projectId: string; sessionId: string },
): boolean {
  return windowState.focused
    && windowState.visible
    && !windowState.minimized
    && view.activeNav === "chat"
    && view.projectId === target.projectId
    && view.sessionId === target.sessionId;
}

export function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : String(Math.max(0, count));
}
