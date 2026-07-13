import { defineStore } from "pinia";
import { api } from "../api/client.js";
import type {
  SkillSearchResult,
  SkillContentPreview,
  SkillStoreSearchResponse,
} from "@pi-web-ui/shared";

interface State {
  query: string;
  mode: "keyword" | "ai";
  results: SkillSearchResult[];
  errors: { provider: string; message: string }[];
  loading: boolean;
  preview: { skill: SkillSearchResult; data: SkillContentPreview } | null;
  previewLoading: boolean;
  installingId: string | null;
  installedIds: Set<string>;
}

export const useSkillStoreStore = defineStore("skill-store", {
  state: () => ({
    query: "",
    mode: "keyword" as "keyword" | "ai",
    results: [] as SkillSearchResult[],
    errors: [] as { provider: string; message: string }[],
    loading: false,
    preview: null as State["preview"],
    previewLoading: false,
    installingId: null as string | null,
    installedIds: new Set<string>(),
  }),
  actions: {
    async search() {
      const q = this.query.trim();
      if (!q) {
        this.results = [];
        this.errors = [];
        return;
      }
      this.loading = true;
      this.errors = [];
      try {
        const res: SkillStoreSearchResponse = await api.searchSkillStore(q, this.mode);
        this.results = res.results;
        this.errors = res.errors;
      } catch (e: any) {
        this.results = [];
        this.errors = [{ provider: "all", message: e?.message ?? "search failed" }];
      } finally {
        this.loading = false;
      }
    },
    async openPreview(skill: SkillSearchResult) {
      if (this.preview?.skill.id === skill.id) return;
      this.preview = null;
      this.previewLoading = true;
      try {
        const data = await api.previewSkillStore(skill);
        this.preview = { skill, data };
      } catch (e: any) {
        this.preview = {
          skill,
          data: {
            title: skill.name,
            body: "",
            source: "metadata",
            limitation: e?.message ?? "preview failed",
            metadata: {
              provider: skill.provider,
              securityAudits: [],
              status: "unavailable",
            },
          },
        };
      } finally {
        this.previewLoading = false;
      }
    },
    closePreview() {
      this.preview = null;
      this.previewLoading = false;
    },
    async install(skill: SkillSearchResult, localName?: string) {
      this.installingId = skill.id;
      try {
        await api.installSkillStore({ skill, localName });
        this.installedIds.add(skill.id);
      } finally {
        this.installingId = null;
      }
    },
    setMode(mode: "keyword" | "ai") {
      this.mode = mode;
      if (this.query.trim()) this.search();
    },
  },
});
