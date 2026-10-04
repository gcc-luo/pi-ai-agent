import { defineStore } from "pinia";
import { api } from "../api/client.js";
import { useKbStore } from "./kb.js";
import type { KbFileDto, KbFilePage } from "@pi-web-ui/shared";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_PAGE_SIZE = 10;
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
    _loadRequest: 0,
    _pageRequests: {} as Record<string, number>,
    _searchableRequests: {} as Record<string, number>,
    /** 按 kbId 存储轮询定时器 ID，内部字段 */
    _pollTimers: {} as Record<string, ReturnType<typeof setTimeout>>,
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
        if (this._lastKbId) this.stopPolling(this._lastKbId);
        this.page = 1;
        this.search = "";
        this.status = null;
        this.ext = null;
        this._lastKbId = kbId;
      }
    },

    /** 内部：用当前过滤状态拉取指定 KB 的当前页 */
    async _fetchPage(kbId: string) {
      const request = (this._pageRequests[kbId] ?? 0) + 1;
      this._pageRequests[kbId] = request;
      const result = await api.listKbFiles(kbId, {
        page: this.page,
        pageSize: this.pageSize,
        search: this.search || undefined,
        status: this.status ?? undefined,
        ext: this.ext ?? undefined,
      });
      if (this._pageRequests[kbId] !== request) return false;
      this.pages[kbId] = result;
      return true;
    },

    async loadForKb(kbId: string) {
      this._resetFiltersIfKbChanged(kbId);
      this.stopPolling(kbId);
      const request = ++this._loadRequest;
      this.loading = true;
      try {
        if (!await this._fetchPage(kbId)) return;
      } finally {
        if (request === this._loadRequest) this.loading = false;
      }
      if (request !== this._loadRequest) return;
      this.refreshKbSummary(kbId);
      if (this.hasActive(kbId)) {
        this.startPolling(kbId);
      } else {
        this.stopPolling(kbId);
      }
    },

    /** 加载 KB 内全部 ready+enabled 文件（对话侧 picker/banner 用，不分页） */
    async loadSearchableFiles(kbId: string) {
      const request = (this._searchableRequests[kbId] ?? 0) + 1;
      this._searchableRequests[kbId] = request;
      const files = await api.listSearchableKbFiles(kbId);
      if (this._searchableRequests[kbId] === request) this.searchableCache[kbId] = files;
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
      this._pageRequests[kbId] = (this._pageRequests[kbId] ?? 0) + 1;
      this._searchableRequests[kbId] = (this._searchableRequests[kbId] ?? 0) + 1;
      if (this.searchableCache[kbId]) {
        this.searchableCache[kbId] = this.searchableCache[kbId].filter((f) => f.id !== fileId);
      }
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
      this._pageRequests[file.kbId] = (this._pageRequests[file.kbId] ?? 0) + 1;
      this._searchableRequests[file.kbId] = (this._searchableRequests[file.kbId] ?? 0) + 1;
      const searchable = this.searchableCache[file.kbId];
      if (searchable) {
        const remaining = searchable.filter((f) => f.id !== file.id);
        this.searchableCache[file.kbId] = file.enabled && file.status === "ready"
          ? [...remaining, file].sort((a, b) => b.createdAt - a.createdAt)
          : remaining;
      }
      const page = this.pages[file.kbId];
      if (!page) return;
      const idx = page.items.findIndex((f) => f.id === file.id);
      if (idx >= 0) page.items[idx] = file;
      if (file.status === "pending" || file.status === "parsing") page.hasActive = true;
    },

    /** 局部更新缓存中某个文件的字段（用于乐观更新） */
    patchInCache(fileId: string, kbId: string, patch: Partial<KbFileDto>) {
      const file = this.pages[kbId]?.items.find((f) => f.id === fileId)
        ?? this.searchableCache[kbId]?.find((f) => f.id === fileId);
      if (file) this.updateInCache({ ...file, ...patch });
    },

    // ─── 智能轮询：解析中自动刷新当前页 ───

    /** KB 内是否存在 pending/parsing 文件 */
    hasActiveFiles(kbId: string): boolean {
      return this.hasActive(kbId);
    },

    /** 开始轮询指定 KB 的当前页（幂等） */
    startPolling(kbId: string) {
      if (this._pollTimers[kbId]) return; // 已在轮询
      const timer = setTimeout(async () => {
        let failed = false;
        try {
          if (!await this._fetchPage(kbId)) return;
          if (this._pollTimers[kbId] !== timer) return;
          if (this.searchableCache[kbId]) await this.loadSearchableFiles(kbId);
          await this.refreshKbSummary(kbId);
        } catch {
          failed = true;
          // 网络恢复后继续刷新；本次请求完成前不发起下一轮。
        } finally {
          if (this._pollTimers[kbId] === timer) {
            delete this._pollTimers[kbId];
            if (failed || this.hasActive(kbId)) this.startPolling(kbId);
          }
        }
      }, POLL_INTERVAL_MS);
      this._pollTimers[kbId] = timer;
    },

    /** 停止轮询并使在途列表响应失效 */
    stopPolling(kbId: string) {
      const timer = this._pollTimers[kbId];
      if (timer) clearTimeout(timer);
      delete this._pollTimers[kbId];
      this._pageRequests[kbId] = (this._pageRequests[kbId] ?? 0) + 1;
    },

    /** 停止所有轮询（组件卸载时调用） */
    stopAllPolling() {
      for (const kbId of Object.keys(this._pollTimers)) {
        this.stopPolling(kbId);
      }
    },
  },
});
