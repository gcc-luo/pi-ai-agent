export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_RATIO = 0.4;

export function getSidebarMaxWidth(viewportWidth: number): number {
  return Math.max(0, Math.floor(viewportWidth * SIDEBAR_MAX_RATIO));
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  const maxWidth = getSidebarMaxWidth(viewportWidth);
  const minWidth = Math.min(SIDEBAR_MIN_WIDTH, maxWidth);
  return Math.min(Math.max(Math.round(width), minWidth), maxWidth);
}
