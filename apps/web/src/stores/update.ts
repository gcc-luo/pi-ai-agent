import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { isTauri } from "../utils/platform.js";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "no-update"
  | "error";

export interface UpdateInfo {
  version: string;
  date: string | null;
  body: string;
}

export const useUpdateStore = defineStore("update", () => {
  const status = ref<UpdateStatus>("idle");
  const updateInfo = ref<UpdateInfo | null>(null);
  const downloadProgress = ref(0);
  const errorMessage = ref<string | null>(null);
  const currentVersion = ref<string | null>(null);

  const isAvailable = computed(() => status.value === "available");
  const isDownloading = computed(() => status.value === "downloading");
  const isReady = computed(() => status.value === "ready");

  async function checkForUpdate(): Promise<void> {
    if (!isTauri()) return;

    status.value = "checking";
    errorMessage.value = null;

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (update?.available) {
        updateInfo.value = {
          version: update.version,
          date: update.date ?? null,
          body: update.body ?? "",
        };
        status.value = "available";
      } else {
        status.value = "no-update";
        updateInfo.value = null;
      }
    } catch (error) {
      status.value = "error";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function downloadAndInstall(): Promise<void> {
    if (!isTauri() || !updateInfo.value) return;

    status.value = "downloading";
    downloadProgress.value = 0;
    errorMessage.value = null;

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (!update?.available) {
        status.value = "no-update";
        return;
      }

      let downloadedBytes = 0;
      let totalBytes = 0;

      await update.download((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            downloadProgress.value = Math.round((downloadedBytes / totalBytes) * 100);
          }
        }
      });

      status.value = "ready";
      downloadProgress.value = 100;
    } catch (error) {
      status.value = "error";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function installAndRestart(): Promise<void> {
    if (!isTauri()) return;

    status.value = "installing";

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();

      if (!update?.available) return;

      await update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      status.value = "error";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function getAppVersion(): Promise<void> {
    if (!isTauri()) return;
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      currentVersion.value = await getVersion();
    } catch {
      // ignore
    }
  }

  function reset() {
    status.value = "idle";
    errorMessage.value = null;
  }

  return {
    status,
    updateInfo,
    downloadProgress,
    errorMessage,
    currentVersion,
    isAvailable,
    isDownloading,
    isReady,
    checkForUpdate,
    downloadAndInstall,
    installAndRestart,
    getAppVersion,
    reset,
  };
});
