import { defineStore } from "pinia";
import { api } from "../api/client.js";
import { useKbStore } from "./kb.js";
import type { KbFileDto, KbFilePage } from "@pi-web-ui/shared";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export const useKbFileStore = defineStore("kb-file", {
  state: () => ({
    /** 按 kbId 缓存当前页数据 */
    pages: {} as Record<string, KbFilePage | null>,
    /** 按 kbId 缓存 KB 内全部 ready+enabled 文件，供对话侧 picker/banner 使用，不分页 */
    searchableCache: {} as Record<string, KbFileDto[]>,
    /** 单组全局过滤状态——UI 同一时刻只展示一个 KB，KB 切换时自动重置 */
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    search: "",
    status: null as string | null,
    ext: null as string | null,
    loading: false,
    /** 上次 loadForKb 的 kbId，用于检测 KB 切换并重置过滤 */
    _lastKbId: null as string | null,
    /** 按 kbId 存储轮询定时器 ID，内部字段 */
    _pollTimers: {} as Record<string, ReturnType<typeof setInterval>>,
  }),
  getters: {
    files: (state) => (kbId: string) => state.pages[kbId]?.items ?? [],
    total: (state) => (kbId: string) => state.pages[kbId]?.total ?? 0,
    hasActive: (state) => (kbId: string) => state.pages[kbId]?.hasActive ?? false,
    totalPages: (state) => (kbId: string) => {
      const total = state.pages[kbId]?.total ?? 0;
      return total === 0 ? 0 : Math.ceil(total / state.pageSize);
    },
    searchableFiles: (state) => (kbId: string) => state.searchableCache[kbId] ?? [],
  },
  actions: {
    /** 拉取 KB 摘要并写回 kbStore.current（仅当当前正在查看该 KB 时） */
    async refreshKbSummary(kbId: string) {
      try {
        const kb = await api.getKnowledgeBase(kbId);
        const kbStore = useKbStore();
        if (kbStore.current?.id === kbId) {
          kbStore.setCurrent(kb);
        }
      } catch {
        // 摘要拉取失败不影响文件列表
      }
    },

    /** KB 切换时重置过滤条件 */
    _resetFiltersIfKbChanged(kbId: string) {
      if (this._lastKbId !== kbId) {
        this.page = 1;
        this.search = "";
        this.status = null;
        this.ext = null;
        this._lastKbId = kbId;
      }
    },

    /** 内部：用当前过滤状态拉取指定 KB 的当前页 */
    async _fetchPage(kbId: string) {
      this.pages[kbId] = await api.listKbFiles(kbId, {
        page: this.page,
        pageSize: this.pageSize,
        search: this.search || undefined,
        status: this.status ?? undefined,
        ext: this.ext ?? undefined,
      });
    },

    async loadForKb(kbId: string) {
      this._resetFiltersIfKbChanged(kbId);
      this.loading = true;
      try {
        await this._fetchPage(kbId);
      } finally {
        this.loading = false;
      }
      this.refreshKbSummary(kbId);
      if (this.hasActive(kbId)) {
        this.startPolling(kbId);
      } else {
        this.stopPolling(kbId);
      }
    },

    /** 加载 KB 内全部 ready+enabled 文件（对话侧 picker/banner 用，不分页） */
    async loadSearchableFiles(kbId: string) {
      this.searchableCache[kbId] = await api.listSearchableKbFiles(kbId);
    },

    async loadPage(kbId: string, page: number) {
      this.page = Math.max(1, Math.min(page, this.totalPages(kbId) || 1));
      await this.loadForKb(kbId);
    },

    async setSearch(kbId: string, q: string) {
      this.search = q;
      this.page = 1;
      await this.loadForKb(kbId);
    },

    async setStatus(kbId: string, s: string | null) {
      this.status = s;
      this.page = 1;
      await this.loadForKb(kbId);
    },

    async setExt(kbId: string, e: string | null) {
      this.ext = e;
      this.page = 1;
      await this.loadForKb(kbId);
    },

    setPageSize(size: number) {
      this.pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, size));
    },

    async createTextFile(kbId: string, name: string, ext: string, content: string) {
      const file = await api.createKbFile(kbId, name, ext, content);
      // 新文件按 created_at DESC 排序，回到第 1 页即可看到
      this.page = 1;
      await this.loadForKb(kbId);
      return file;
    },

    async importFiles(kbId: string, fileList: File[]) {
      const result = await api.importKbFiles(kbId, fileList);
      this.page = 1;
      await this.loadForKb(kbId);
      return result;
    },

    async toggleEnabled(fileId: string, enabled: boolean) {
      const file = await api.setKbFileEnabled(fileId, enabled);
      this.updateInCache(file);
    },

    async reparse(fileId: string, kbId: string) {
      await api.reparseKbFile(fileId);
      // 乐观更新：立即将状态设为 parsing，避免轮询空窗期
      this.patchInCache(fileId, kbId, { status: "parsing", failReason: null });
      this.startPolling(kbId);
    },

    async remove(fileId: string, kbId: string) {
      await api.deleteKbFile(fileId);
      const page = this.pages[kbId];
      if (page) {
        page.items = page.items.filter((f) => f.id !== fileId);
        page.total = Math.max(0, page.total - 1);
      }
      // 当前页空了且不在第 1 页，回退一页
      const pageData = this.pages[kbId];
      if (pageData && pageData.items.length === 0 && this.page > 1) {
        await this.loadPage(kbId, this.page - 1);
      } else {
        await this.refreshKbSummary(kbId);
      }
    },

    async updateContent(fileId: string, patch: { name?: string; content?: string }) {
      const file = await api.updateKbFile(fileId, patch);
      // 内容更新会触发异步重解析，乐观覆盖状态为 parsing
      if (patch.content !== undefined) {
        file.status = "parsing";
        file.failReason = null;
      }
      this.updateInCache(file);
      this.startPolling(file.kbId);
      return file;
    },

    updateInCache(file: KbFileDto) {
      const page = this.pages[file.kbId];
      if (!page) return;
      const idx = page.items.findIndex((f) => f.id === file.id);
      if (idx >= 0) page.items[idx] = file;
    },

    /** 局部更新缓存中某个文件的字段（用于乐观更新） */
    patchInCache(fileId: string, kbId: string, patch: Partial<KbFileDto>) {
      const page = this.pages[kbId];
      if (!page) return;
      const file = page.items.find((f) => f.id === fileId);
      if (file) Object.assign(file, patch);
    },

    // ─── 智能轮询：解析中自动刷新当前页 ───

    /** KB 内是否存在 pending/parsing 文件 */
    hasActiveFiles(kbId: string): boolean {
      return this.hasActive(kbId);
    },

    /** 开始轮询指定 KB 的当前页（幂等） */
    startPolling(kbId: string) {
      if (this._pollTimers[kbId]) return; // 已在轮询
      this._pollTimers[kbId] = setInterval(async () => {
        try {
          await this._fetchPage(kbId);
          // 同步刷新 searchable 缓存（对话侧 picker 可能正在用）
          if (this.searchableCache[kbId]) {
            this.searchableCache[kbId] = await api.listSearchableKbFiles(kbId);
          }
        } catch {
          // 网络异常忽略，下次轮询再试
        }
        // 同步刷新头部统计：解析完成后 failedFileCount/fileCount 会立刻反映
        this.refreshKbSummary(kbId);
        if (!this.hasActive(kbId)) {
          this.stopPolling(kbId);
        }
      }, POLL_INTERVAL_MS);
    },

    /** 停止轮询指定 KB */
    stopPolling(kbId: string) {
      const timer = this._pollTimers[kbId];
      if (timer) {
        clearInterval(timer);
        delete this._pollTimers[kbId];
      }
    },

    /** 停止所有轮询（组件卸载时调用） */
    stopAllPolling() {
      for (const kbId of Object.keys(this._pollTimers)) {
        this.stopPolling(kbId);
      }
    },
  },
});
