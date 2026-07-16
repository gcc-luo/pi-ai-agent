import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { KbFileDto } from "@pi-web-ui/shared";

const POLL_INTERVAL_MS = 2000;

export const useKbFileStore = defineStore("kb-file", {
  state: () => ({
    files: {} as Record<string, KbFileDto[]>,
    loading: false,
    /** 按 kbId 存储轮询定时器 ID，内部字段 */
    _pollTimers: {} as Record<string, ReturnType<typeof setInterval>>,
  }),
  actions: {
    async loadForKb(kbId: string) {
      this.loading = true;
      try {
        this.files[kbId] = await api.listKbFiles(kbId);
      } finally {
        this.loading = false;
      }
      // 如果有文件正在解析，自动开启轮询
      if (this.hasActiveFiles(kbId)) {
        this.startPolling(kbId);
      }
    },
    async createTextFile(kbId: string, name: string, ext: string, content: string) {
      const file = await api.createKbFile(kbId, name, ext, content);
      if (!this.files[kbId]) this.files[kbId] = [];
      this.files[kbId].unshift(file);
      this.startPolling(kbId);
      return file;
    },
    async importFiles(kbId: string, fileList: File[]) {
      const result = await api.importKbFiles(kbId, fileList);
      if (result.imported.length) {
        if (!this.files[kbId]) this.files[kbId] = [];
        this.files[kbId].unshift(...result.imported);
      }
      this.startPolling(kbId);
      return result;
    },
    async toggleEnabled(fileId: string, enabled: boolean) {
      const file = await api.setKbFileEnabled(fileId, enabled);
      this.updateInCache(file);
    },
    async reparse(fileId: string, kbId: string) {
      await api.reparseKbFile(fileId);
      this.startPolling(kbId);
    },
    async remove(fileId: string, kbId: string) {
      await api.deleteKbFile(fileId);
      if (this.files[kbId]) {
        this.files[kbId] = this.files[kbId].filter((f) => f.id !== fileId);
      }
    },
    async updateContent(fileId: string, patch: { name?: string; content?: string }) {
      const file = await api.updateKbFile(fileId, patch);
      this.updateInCache(file);
      this.startPolling(file.kbId);
      return file;
    },
    updateInCache(file: KbFileDto) {
      const list = this.files[file.kbId];
      if (list) {
        const idx = list.findIndex((f) => f.id === file.id);
        if (idx >= 0) list[idx] = file;
      }
    },

    // ─── 智能轮询：解析中自动刷新 ───

    /** 是否有文件处于 pending/parsing 状态 */
    hasActiveFiles(kbId: string): boolean {
      const list = this.files[kbId];
      if (!list) return false;
      return list.some((f) => f.status === "pending" || f.status === "parsing");
    },

    /** 开始轮询指定 KB 的文件列表（幂等） */
    startPolling(kbId: string) {
      if (this._pollTimers[kbId]) return; // 已在轮询
      this._pollTimers[kbId] = setInterval(async () => {
        try {
          this.files[kbId] = await api.listKbFiles(kbId);
        } catch {
          // 网络异常忽略，下次轮询再试
        }
        if (!this.hasActiveFiles(kbId)) {
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
