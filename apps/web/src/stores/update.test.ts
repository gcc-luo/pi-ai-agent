import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useUpdateStore } from "./update.js";

vi.mock("../utils/platform.js", () => ({
  isTauri: () => true,
}));

const mockCheck = vi.fn();
const mockInstall = vi.fn();
const mockDownload = vi.fn();
const mockRelaunch = vi.fn();
const mockGetVersion = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mockRelaunch,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mockGetVersion,
}));

describe("useUpdateStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
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
    mockCheck.mockResolvedValue({
      available: true,
      version: "1.3.0",
      date: "2026-08-10",
      body: "Bug fixes and improvements",
      download: mockDownload,
      install: mockInstall,
    });

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe("available");
    expect(store.updateInfo?.version).toBe("1.3.0");
    expect(store.updateInfo?.body).toBe("Bug fixes and improvements");
    expect(store.isAvailable).toBe(true);
  });

  it("handles no update available", async () => {
    mockCheck.mockResolvedValue({
      available: false,
    });

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe("no-update");
    expect(store.updateInfo).toBeNull();
    expect(store.isAvailable).toBe(false);
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
    mockCheck.mockResolvedValue({
      available: true,
      version: "1.3.0",
      download: mockDownload.mockImplementation(async (onEvent: any) => {
        onEvent({ event: "Started", data: { contentLength: 1000 } });
        onEvent({ event: "Progress", data: { chunkLength: 500 } });
        onEvent({ event: "Progress", data: { chunkLength: 500 } });
      }),
      install: mockInstall,
    });

    const store = useUpdateStore();
    store.updateInfo = { version: "1.3.0", date: null, body: "" };
    await store.downloadAndInstall();

    expect(store.status).toBe("ready");
    expect(store.downloadProgress).toBe(100);
    expect(store.isReady).toBe(true);
  });

  it("handles download failure", async () => {
    mockCheck.mockResolvedValue({
      available: true,
      version: "1.3.0",
      download: mockDownload.mockRejectedValue(new Error("Download failed")),
      install: mockInstall,
    });

    const store = useUpdateStore();
    store.updateInfo = { version: "1.3.0", date: null, body: "" };
    await store.downloadAndInstall();

    expect(store.status).toBe("error");
    expect(store.errorMessage).toBe("Download failed");
  });

  it("installs and restarts", async () => {
    mockCheck.mockResolvedValue({
      available: true,
      version: "1.3.0",
      download: mockDownload,
      install: mockInstall.mockResolvedValue(undefined),
    });
    mockRelaunch.mockResolvedValue(undefined);

    const store = useUpdateStore();
    store.updateInfo = { version: "1.3.0", date: null, body: "" };
    await store.installAndRestart();

    expect(mockInstall).toHaveBeenCalled();
    expect(mockRelaunch).toHaveBeenCalled();
  });

  it("handles install failure", async () => {
    mockCheck.mockResolvedValue({
      available: true,
      version: "1.3.0",
      download: mockDownload,
      install: mockInstall.mockRejectedValue(new Error("Install failed")),
    });

    const store = useUpdateStore();
    store.updateInfo = { version: "1.3.0", date: null, body: "" };
    await store.installAndRestart();

    expect(store.status).toBe("error");
    expect(store.errorMessage).toBe("Install failed");
  });

  it("fetches app version", async () => {
    mockGetVersion.mockResolvedValue("1.2.5");

    const store = useUpdateStore();
    await store.getAppVersion();

    expect(store.currentVersion).toBe("1.2.5");
  });

  it("resets state correctly", () => {
    const store = useUpdateStore();
    store.status = "error";
    store.errorMessage = "Some error";

    store.reset();

    expect(store.status).toBe("idle");
    expect(store.errorMessage).toBeNull();
  });
});
