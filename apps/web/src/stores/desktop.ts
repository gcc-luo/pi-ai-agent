import { defineStore } from "pinia";
import { ref } from "vue";
import { isTauri } from "../utils/platform.js";

export const useDesktopStore = defineStore("desktop", () => {
  const running = ref(isTauri());

  async function showNotification(title: string, body: string) {
    if (!isTauri()) return;
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title, body });
    } catch {
      // fallback: ignore if plugin not available
    }
  }

  async function openInBrowser(url: string) {
    if (!isTauri()) {
      window.open(url, "_blank");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  }

  return { running, showNotification, openInBrowser };
});
