import type {
  ProjectDto, SessionDto, MessageDto, FileNodeDto, FileContentDto, ModelDto, SkillDto,
  SkillSearchResult, SkillContentPreview, SkillStoreSearchResponse, SkillStoreInstallRequest, SkillStoreInstallResponse,
  KbDto, KbFileDto, KbFilePage, KbChunkDto, KbBindingDto, KbSearchHitDto, TrashItemDto, ExpertDto,
  ScheduledTaskDto, TaskLogDto, TaskType,
} from "@pi-web-ui/shared";

export interface ModelOption {
  id: string;
  provider: string;
  label: string;
}

export interface ConfigDto {
  provider: string | null;
  model: string | null;
  models: ModelOption[];
}

const BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => request<ProjectDto[]>("GET", "/projects"),
  createProject: (name: string, workdir: string, description?: string) =>
    request<ProjectDto>("POST", "/projects", { name, workdir, description }),
  getProject: (id: string) => request<ProjectDto>("GET", `/projects/${id}`),
  updateProject: (id: string, name: string) =>
    request<ProjectDto>("PUT", `/projects/${id}`, { name }),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),

  listSessions: (projectId: string) => request<SessionDto[]>("GET", `/projects/${projectId}/sessions`),
  createSession: (projectId: string, parentId?: string) =>
    request<SessionDto>("POST", `/projects/${projectId}/sessions`, { parentId }),
  getSession: (id: string) => request<SessionDto>("GET", `/sessions/${id}`),
  updateSession: (id: string, title: string) =>
    request<SessionDto>("PUT", `/sessions/${id}`, { title }),
  updateSessionExpert: (id: string, expertId: string | null) =>
    request<SessionDto>("PUT", `/sessions/${id}`, { expertId }),
  deleteSession: (id: string) => request<void>("DELETE", `/sessions/${id}`),
  listMessages: (sessionId: string) => request<MessageDto[]>("GET", `/sessions/${sessionId}/messages`),
  listSkills: () => request<SkillDto[]>("GET", "/skills"),
  importSkill: (data: { name: string; description: string; body: string }) =>
    request<SkillDto>("POST", "/skills", data),
  importSkillZip: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(BASE + "/skills/import-zip", { method: "POST", body: form }).then(async (res) => {
      const text = await res.text();
      let data: any = null;
      if (text) try { data = JSON.parse(text); } catch { data = { error: text }; }
      if (!res.ok) throw new Error(data?.error ?? `upload failed: ${res.status}`);
      return data as { imported: SkillDto[]; errors: string[] };
    });
  },
  deleteSkill: (name: string) => request<void>("DELETE", `/skills/${encodeURIComponent(name)}`),

  searchSkillStore: (q: string, mode: "keyword" | "ai" = "keyword", limit = 20) =>
    request<SkillStoreSearchResponse>("GET", `/skill-store/search?q=${encodeURIComponent(q)}&mode=${mode}&limit=${limit}`),
  previewSkillStore: (skill: SkillSearchResult) =>
    request<SkillContentPreview>("POST", "/skill-store/preview", skill),
  installSkillStore: (req: SkillStoreInstallRequest) =>
    request<SkillStoreInstallResponse>("POST", "/skill-store/install", req),

  listFiles: (projectId: string, dir = "/") =>
    request<FileNodeDto[]>("GET", `/files/${projectId}/list?path=${encodeURIComponent(dir)}`),
  readFile: (projectId: string, path: string) =>
    request<FileContentDto>("GET", `/files/${projectId}/read?path=${encodeURIComponent(path)}`),
  // URL (not fetch) for binary previews — <img>/<video>/<iframe> need a
  // plain URL they can stream from, including Range requests for seeking.
  rawFileUrl: (projectId: string, path: string) =>
    `${BASE}/files/${projectId}/raw?path=${encodeURIComponent(path)}`,
  createFile: (projectId: string, path: string, type: "file" | "directory") =>
    request<{ path: string }>("POST", `/files/${projectId}/create`, { path, type }),
  renameFile: (projectId: string, from: string, to: string) =>
    request<{ from: string; to: string }>("PUT", `/files/${projectId}/rename`, { from, to }),
  deleteFile: (projectId: string, path: string) =>
    request<void>("DELETE", `/files/${projectId}/delete?path=${encodeURIComponent(path)}`),

  // Office → PDF via LibreOffice
  officePdfUrl: (projectId: string, path: string) =>
    `${BASE}/files/${projectId}/office-pdf?path=${encodeURIComponent(path)}`,
  checkOfficeAvailability: () =>
    request<{ available: boolean }>("GET", "/files/office-status"),

  getConfig: () => request<ConfigDto>("GET", "/config"),
  updateConfig: (model: string) => request<ConfigDto>("PUT", "/config", { model }),

  listModels: () => request<ModelDto[]>("GET", "/models"),
  createModel: (data: { id: string; label: string; provider: string; modelType?: string; apiBaseUrl?: string; apiKey?: string; isDefault?: boolean }) =>
    request<ModelDto>("POST", "/models", data),
  updateModel: (id: string, data: { label?: string; provider?: string; modelType?: string; apiBaseUrl?: string | null; apiKey?: string | null; isDefault?: boolean }) =>
    request<ModelDto>("PUT", "/models", { id, ...data }),
  deleteModel: (id: string) => request<void>("DELETE", `/models?id=${encodeURIComponent(id)}`),
  testModel: (data: { id?: string; provider: string; modelType?: string; apiBaseUrl?: string; apiKey?: string; modelId?: string }) =>
    request<{ ok: boolean; error?: string; warning?: string }>("POST", "/models/test", data),

  browseDir: (dirPath?: string) =>
    request<{ currentPath: string; parentPath: string; directories: { name: string; path: string }[] }>("GET", `/fs/browse${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ""}`),

  // ─── Knowledge Base ───
  listKnowledgeBases: () => request<KbDto[]>("GET", "/knowledge-bases"),
  createKnowledgeBase: (name: string, description?: string) =>
    request<KbDto>("POST", "/knowledge-bases", { name, description }),
  getKnowledgeBase: (id: string) => request<KbDto>("GET", `/knowledge-bases/${id}`),
  updateKnowledgeBase: (id: string, patch: { name?: string; description?: string | null; enabled?: boolean; embeddingModelId?: string | null }) =>
    request<KbDto>("PUT", `/knowledge-bases/${id}`, patch),
  deleteKnowledgeBase: (id: string) => request<void>("DELETE", `/knowledge-bases/${id}`),

  listKbFiles: (kbId: string, params?: { page?: number; pageSize?: number; search?: string; status?: string; ext?: string }) => {
    const q = new URLSearchParams();
    if (params?.page != null) q.set("page", String(params.page));
    if (params?.pageSize != null) q.set("pageSize", String(params.pageSize));
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.ext) q.set("ext", params.ext);
    const qs = q.toString();
    return request<KbFilePage>("GET", `/knowledge-bases/${kbId}/files${qs ? `?${qs}` : ""}`);
  },
  listSearchableKbFiles: (kbId: string) => request<KbFileDto[]>("GET", `/knowledge-bases/${kbId}/files/searchable`),
  createKbFile: (kbId: string, name: string, ext: string, content: string) =>
    request<KbFileDto>("POST", `/knowledge-bases/${kbId}/files`, { name, ext, content }),
  importKbFiles: (kbId: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    return fetch(BASE + `/knowledge-bases/${kbId}/files/import`, { method: "POST", body: form }).then(async (res) => {
      const data = await res.json().catch(() => ({ error: "parse_failed" }));
      if (!res.ok) throw new Error((data as any)?.error ?? `import failed: ${res.status}`);
      return data as { imported: KbFileDto[]; errors: { name: string; error: string }[] };
    });
  },
  getKbFile: (id: string) => request<KbFileDto>("GET", `/kb-files/${id}`),
  getKbFileContent: (id: string) =>
    request<{ name: string; content: string; size: number }>("GET", `/kb-files/${id}/content`),
  getKbFileChunks: (id: string) => request<KbChunkDto[]>("GET", `/kb-files/${id}/chunks`),
  updateKbFile: (id: string, patch: { name?: string; content?: string }) =>
    request<KbFileDto>("PUT", `/kb-files/${id}`, patch),
  setKbFileEnabled: (id: string, enabled: boolean) =>
    request<KbFileDto>("PUT", `/kb-files/${id}/enabled`, { enabled }),
  reparseKbFile: (id: string) => request<{ message: string }>("POST", `/kb-files/${id}/reparse`),
  deleteKbFile: (id: string) => request<void>("DELETE", `/kb-files/${id}`),

  searchKb: (query: string, kbIds: string[], fileIds?: string[], limit?: number) =>
    request<{ hits: KbSearchHitDto[]; durationMs: number }>("POST", "/kb-search", { query, kbIds, fileIds, limit }),

  getKbBindings: (sessionId: string) => request<KbBindingDto[]>("GET", `/sessions/${sessionId}/kb-bindings`),
  setKbBindings: (sessionId: string, bindings: { kbId: string; fileFilter?: string[] | null }[]) =>
    request<KbBindingDto[]>("PUT", `/sessions/${sessionId}/kb-bindings`, bindings),

  // ─── Trash ───
  listTrash: () => request<TrashItemDto[]>("GET", "/trash"),
  restoreItem: (kind: "project" | "session", id: string) =>
    request<void>("POST", "/trash/restore", { kind, id }),
  destroyItem: (kind: "project" | "session", id: string) =>
    request<void>("POST", "/trash/destroy", { kind, id }),
  emptyTrash: () => request<void>("POST", "/trash/empty"),

  // ─── Experts ───
  listExperts: (category?: string) =>
    request<ExpertDto[]>("GET", `/experts${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  getExpert: (id: string) => request<ExpertDto>("GET", `/experts/${id}`),
  createExpert: (input: { name: string; icon?: string; category: string; description: string; systemPrompt: string; tags?: string[] }) =>
    request<ExpertDto>("POST", "/experts", input),
  updateExpert: (id: string, patch: { name?: string; icon?: string; category?: string; description?: string; systemPrompt?: string; tags?: string[]; sortOrder?: number }) =>
    request<ExpertDto>("PUT", `/experts/${id}`, patch),
  deleteExpert: (id: string) => request<void>("DELETE", `/experts/${id}`),
  summonExpert: (expertId: string, projectId: string) =>
    request<SessionDto>("POST", `/experts/${expertId}/summon`, { projectId }),

  // ─── Scheduled Tasks ───
  listScheduledTasks: () =>
    request<ScheduledTaskDto[]>("GET", "/scheduled-tasks"),
  createScheduledTask: (data: {
    name: string; description?: string; cronExpression: string;
    taskType: TaskType; payload?: string; enabled?: boolean;
  }) => request<ScheduledTaskDto>("POST", "/scheduled-tasks", data),
  updateScheduledTask: (id: string, data: {
    name?: string; description?: string; cronExpression?: string;
    taskType?: TaskType; payload?: string; enabled?: boolean;
  }) => request<ScheduledTaskDto>("PUT", `/scheduled-tasks/${id}`, data),
  deleteScheduledTask: (id: string) =>
    request<void>("DELETE", `/scheduled-tasks/${id}`),
  toggleScheduledTask: (id: string, enabled: boolean) =>
    request<ScheduledTaskDto>("PATCH", `/scheduled-tasks/${id}/toggle`, { enabled }),
  getScheduledTaskLogs: (id: string, limit?: number) =>
    request<TaskLogDto[]>("GET", `/scheduled-tasks/${id}/logs${limit ? `?limit=${limit}` : ""}`),
  runScheduledTask: (id: string) =>
    request<{ message: string }>("POST", `/scheduled-tasks/${id}/run`),
};
