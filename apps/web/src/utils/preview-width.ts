export const PREVIEW_MIN_WIDTH = 320;
export const PREVIEW_MAX_WIDTH = 720;
export const PREVIEW_MAX_RATIO = 0.6;

export function getPreviewMaxWidth(viewportWidth: number): number {
  return Math.max(0, Math.min(PREVIEW_MAX_WIDTH, Math.floor(viewportWidth * PREVIEW_MAX_RATIO)));
}

export function clampPreviewWidth(width: number, viewportWidth: number): number {
  const maxWidth = getPreviewMaxWidth(viewportWidth);
  const minWidth = Math.min(PREVIEW_MIN_WIDTH, maxWidth);
  return Math.min(Math.max(Math.round(width), minWidth), maxWidth);
}
