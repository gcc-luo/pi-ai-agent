import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../api/client.js";
import { useKbFileStore } from "./kb-file.js";
vi.mock("../api/client.js", () => ({
  api: {
    listKbFiles: vi.fn(),
    getKnowledgeBase: vi.fn(),
    setKbFileEnabled: vi.fn(),
    deleteKbFile: vi.fn(),
    listSearchableKbFiles: vi.fn(),
  },
}));
const page = (id: string, active = false) =>
  ({
    items: [{ id, kbId: "kb", enabled: true, status: "ready" }],
    total: 1,
    hasActive: active,
  }) as any;
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("knowledge base file cache", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    vi.mocked(api.getKnowledgeBase).mockResolvedValue({ id: "kb" } as any);
  });
  afterEach(() => {
    useKbFileStore().stopAllPolling();
    vi.useRealTimers();
  });
  it("does not overwrite new search results with an older response", async () => {
    const store = useKbFileStore();
    const old = deferred();
    const latest = deferred();
    vi.mocked(api.listKbFiles)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const first = store.loadForKb("kb");
    const second = store.setSearch("kb", "new");
    latest.resolve(page("new"));
    await second;
    old.resolve(page("old"));
    await first;
    expect(store.files("kb")[0]?.id).toBe("new");
  });
  it("keeps loading until the newest request completes", async () => {
    const store = useKbFileStore();
    const old = deferred();
    const latest = deferred();
    vi.mocked(api.listKbFiles)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const first = store.loadForKb("kb");
    const second = store.setSearch("kb", "new");
    old.resolve(page("old"));
    await first;
    expect(store.loading).toBe(true);
    latest.resolve(page("new"));
    await second;
    expect(store.loading).toBe(false);
  });
  it("removes disabled and deleted files from the conversation picker cache", async () => {
    const store = useKbFileStore();
    store.searchableCache.kb = page("file").items;
    vi.mocked(api.setKbFileEnabled).mockResolvedValue({
      ...page("file").items[0],
      enabled: false,
    });
    await store.toggleEnabled("file", false);
    expect(store.searchableFiles("kb")).toEqual([]);
    store.searchableCache.kb = page("file").items;
    await store.remove("file", "kb");
    expect(store.searchableFiles("kb")).toEqual([]);
  });
  it("ignores picker responses started before a file was disabled", async () => {
    const store = useKbFileStore();
    const pending = deferred();
    store.searchableCache.kb = page("file").items;
    vi.mocked(api.listSearchableKbFiles).mockReturnValue(pending.promise);
    const loading = store.loadSearchableFiles("kb");
    vi.mocked(api.setKbFileEnabled).mockResolvedValue({
      ...page("file").items[0],
      enabled: false,
    });
    await store.toggleEnabled("file", false);
    pending.resolve(page("file").items);
    await loading;
    expect(store.searchableFiles("kb")).toEqual([]);
    vi.mocked(api.setKbFileEnabled).mockResolvedValue(page("file").items[0]);
    await store.toggleEnabled("file", true);
    expect(store.searchableFiles("kb").map((file) => file.id)).toEqual([
      "file",
    ]);
  });
  it("stops the previous knowledge base poll when switching", async () => {
    vi.useFakeTimers();
    const store = useKbFileStore();
    vi.mocked(api.listKbFiles)
      .mockResolvedValueOnce(page("a", true))
      .mockResolvedValueOnce(page("b"));
    await store.loadForKb("a");
    await store.loadForKb("b");
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.listKbFiles).toHaveBeenCalledTimes(2);
    expect(store.files("b")[0]?.id).toBe("b");
  });
  it("does not overlap polling requests on a slow connection", async () => {
    vi.useFakeTimers();
    const store = useKbFileStore();
    const pending = deferred();
    store.pages.kb = page("file", true);
    store._lastKbId = "kb";
    vi.mocked(api.listKbFiles).mockReturnValue(pending.promise);
    store.startPolling("kb");
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.listKbFiles).toHaveBeenCalledTimes(1);
    store.stopPolling("kb");
    pending.resolve(page("file", true));
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.listKbFiles).toHaveBeenCalledTimes(1);
  });
});
