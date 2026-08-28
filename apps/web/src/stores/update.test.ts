import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useUpdateStore } from "./update.js";

const mockIsTauriDev = vi.hoisted(() => vi.fn(() => false));

vi.mock("../utils/platform.js", () => ({
  isTauri: () => true,
  isTauriDev: mockIsTauriDev,
}));

const mockCheck = vi.fn();
const mockInstall = vi.fn();
const mockDownload = vi.fn();
const mockRelaunch = vi.fn();
const mockGetVersion = vi.fn();
const mockInvoke = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mockRelaunch,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

function createMockUpdate() {
  mockInstall.mockResolvedValue(undefined);
  mockDownload.mockImplementation(async (onEvent: any) => {
    onEvent({ event: "Started", data: { contentLength: 1000 } });
    onEvent({ event: "Progress", data: { chunkLength: 500 } });
    onEvent({ event: "Progress", data: { chunkLength: 500 } });
  });
  return {
    available: true,
    version: "1.3.0",
    date: "2026-08-10",
    body: "Bug fixes and improvements",
    download: mockDownload,
    install: mockInstall,
  };
}

describe("useUpdateStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsTauriDev.mockReturnValue(false);
    mockInvoke.mockResolvedValue(undefined);
  });

  it("has correct initial state", () => {
    const store = useUpdateStore();
    expect(store.status).toBe("idle");
    expect(store.updateInfo).toBeNull();
    expect(store.downloadProgress).toBe(0);
    expect(store.errorMessage).toBeNull();
    expect(store.isAvailable).toBe(false);
    expect(store.isDownloading).toBe(false);
    expect(store.isReady).toBe(false);
  });

  it("detects available update", async () => {
    mockCheck.mockResolvedValue(createMockUpdate());

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe("available");
    expect(store.updateInfo?.version).toBe("1.3.0");
    expect(store.updateInfo?.body).toBe("Bug fixes and improvements");
    expect(store.isAvailable).toBe(true);
  });

  it("handles no update available", async () => {
    mockCheck.mockResolvedValue({ available: false });

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe("no-update");
    expect(store.updateInfo).toBeNull();
    expect(store.isAvailable).toBe(false);
  });

  it("does not contact the release updater in Tauri development mode", async () => {
    mockIsTauriDev.mockReturnValue(true);

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(mockCheck).not.toHaveBeenCalled();
    expect(store.status).toBe("no-update");
    expect(store.updateInfo).toBeNull();
  });

  it("handles check failure gracefully", async () => {
    mockCheck.mockRejectedValue(new Error("Network error"));

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe("error");
    expect(store.errorMessage).toBe("Network error");
    expect(store.isAvailable).toBe(false);
  });

  it("downloads update with progress", async () => {
    mockCheck.mockResolvedValue(createMockUpdate());

    const store = useUpdateStore();
    await store.checkForUpdate();
    await store.downloadAndInstall();

    expect(store.status).toBe("ready");
    expect(store.downloadProgress).toBe(100);
    expect(store.isReady).toBe(true);
    expect(mockDownload).toHaveBeenCalled();
  });

  it("handles download failure", async () => {
    const update = createMockUpdate();
    update.download = mockDownload.mockRejectedValue(new Error("Download failed"));
    mockCheck.mockResolvedValue(update);

    const store = useUpdateStore();
    await store.checkForUpdate();
    await store.downloadAndInstall();

    expect(store.status).toBe("error");
    expect(store.errorMessage).toBe("Download failed");
  });

  it("reuses same update object for install after download", async () => {
    mockCheck.mockResolvedValue(createMockUpdate());

    const store = useUpdateStore();
    await store.checkForUpdate();
    await store.downloadAndInstall();
    await store.installAndRestart();

    // check should only be called once (during checkForUpdate)
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it("stops the server sidecar before installing the update", async () => {
    mockCheck.mockResolvedValue(createMockUpdate());

    const store = useUpdateStore();
    await store.checkForUpdate();
    await store.downloadAndInstall();
    await store.installAndRestart();

    expect(mockInvoke).toHaveBeenCalledWith("prepare_for_update");
    const prepareCallOrder = mockInvoke.mock.invocationCallOrder[0];
    const installCallOrder = mockInstall.mock.invocationCallOrder[0];
    expect(prepareCallOrder).toBeDefined();
    expect(installCallOrder).toBeDefined();
    expect(prepareCallOrder!).toBeLessThan(installCallOrder!);
  });

  it("does not start the installer when sidecar cleanup fails", async () => {
    mockCheck.mockResolvedValue(createMockUpdate());
    mockInvoke.mockRejectedValue(new Error("sidecar did not exit"));

    const store = useUpdateStore();
    await store.checkForUpdate();
    await store.downloadAndInstall();
    await store.installAndRestart();

    expect(store.status).toBe("error");
    expect(store.errorMessage).toBe("sidecar did not exit");
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("handles install failure", async () => {
    const update = createMockUpdate();
    update.install = mockInstall.mockRejectedValue(new Error("Install failed"));
    mockCheck.mockResolvedValue(update);

    const store = useUpdateStore();
    await store.checkForUpdate();
    await store.downloadAndInstall();
    await store.installAndRestart();

    expect(store.status).toBe("error");
    expect(store.errorMessage).toBe("Install failed");
  });

  it("does not install without prior download", async () => {
    const store = useUpdateStore();
    await store.installAndRestart();

    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("fetches app version", async () => {
    mockGetVersion.mockResolvedValue("1.2.5");

    const store = useUpdateStore();
    await store.getAppVersion();

    expect(store.currentVersion).toBe("1.2.5");
  });

  it("resets state correctly", async () => {
    mockCheck.mockResolvedValue(createMockUpdate());

    const store = useUpdateStore();
    await store.checkForUpdate();
    store.reset();

    expect(store.status).toBe("idle");
    expect(store.errorMessage).toBeNull();
  });
});
