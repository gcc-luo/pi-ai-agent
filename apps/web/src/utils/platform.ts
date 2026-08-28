/**
 * 平台检测工具
 * 判断当前运行环境是 Web 还是 Tauri 桌面端
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isTauriDev(): boolean {
  return isTauri() && import.meta.env.DEV;
}

export function isWeb(): boolean {
  return !isTauri();
}

export const platform = {
  isTauri: isTauri(),
  isWeb: !isTauri(),
};
