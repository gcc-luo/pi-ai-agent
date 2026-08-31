import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../api/client.js";
import { isTauri, isTauriDev } from "../utils/platform.js";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "release-loading"
  | "release-info"
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

  // Keep the update object alive across download → install
  let pendingUpdate: any = null;
  let requestGeneration = 0;

  const isAvailable = computed(() => status.value === "available");
  const isDownloading = computed(() => status.value === "downloading");
  const isReady = computed(() => status.value === "ready");

  async function checkForUpdate(): Promise<void> {
    if (!isTauri()) return;

    const generation = ++requestGeneration;

    if (isTauriDev()) {
      if (generation !== requestGeneration) return;
      status.value = "no-update";
      updateInfo.value = null;
      errorMessage.value = null;
      pendingUpdate = null;
      return;
    }

    status.value = "checking";
    errorMessage.value = null;
    pendingUpdate = null;

    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (generation !== requestGeneration) return;

      if (update?.available) {
        pendingUpdate = update;
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
      if (generation !== requestGeneration) return;
      status.value = "error";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadVersionInfo(): Promise<void> {
    if (!isTauri()) return;

    const generation = ++requestGeneration;

    status.value = "release-loading";
    errorMessage.value = null;
    pendingUpdate = null;

    try {
      const releaseInfo = await api.getReleaseInfo();
      if (generation !== requestGeneration) return;
      updateInfo.value = releaseInfo;
      status.value = "release-info";
    } catch (error) {
      if (generation !== requestGeneration) return;
      status.value = "error";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function downloadAndInstall(): Promise<void> {
    if (!isTauri() || !pendingUpdate) return;

    status.value = "downloading";
    downloadProgress.value = 0;
    errorMessage.value = null;

    try {
      let downloadedBytes = 0;
      let totalBytes = 0;

      await pendingUpdate.download((event: any) => {
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
    if (!isTauri() || !pendingUpdate) return;

    status.value = "installing";

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("prepare_for_update");
      await pendingUpdate.install();
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
    requestGeneration += 1;
    status.value = "idle";
    errorMessage.value = null;
    pendingUpdate = null;
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
    loadVersionInfo,
    getAppVersion,
    reset,
  };
});
