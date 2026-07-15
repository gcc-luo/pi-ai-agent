import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type { KbFileDto } from "@pi-web-ui/shared";

export const useKbFileStore = defineStore("kb-file", {
  state: () => ({
    files: {} as Record<string, KbFileDto[]>,
    loading: false,
  }),
  actions: {
    async loadForKb(kbId: string) {
      this.loading = true;
      try {
        this.files[kbId] = await api.listKbFiles(kbId);
      } finally {
        this.loading = false;
      }
    },
    async createTextFile(kbId: string, name: string, ext: string, content: string) {
      const file = await api.createKbFile(kbId, name, ext, content);
      if (!this.files[kbId]) this.files[kbId] = [];
      this.files[kbId].unshift(file);
      return file;
    },
    async importFiles(kbId: string, fileList: File[]) {
      const result = await api.importKbFiles(kbId, fileList);
      if (result.imported.length) {
        if (!this.files[kbId]) this.files[kbId] = [];
        this.files[kbId].unshift(...result.imported);
      }
      return result;
    },
    async toggleEnabled(fileId: string, enabled: boolean) {
      const file = await api.setKbFileEnabled(fileId, enabled);
      this.updateInCache(file);
    },
    async reparse(fileId: string) {
      await api.reparseKbFile(fileId);
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
      return file;
    },
    updateInCache(file: KbFileDto) {
      const list = this.files[file.kbId];
      if (list) {
        const idx = list.findIndex((f) => f.id === file.id);
        if (idx >= 0) list[idx] = file;
      }
    },
  },
});
