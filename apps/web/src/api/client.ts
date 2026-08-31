import type {
  ProjectDto, SessionDto, MessageDto, FileNodeDto, FileContentDto, ModelDto, SkillDto,
  SkillSearchResult, SkillContentPreview, SkillStoreSearchResponse, SkillStoreInstallRequest, SkillStoreInstallResponse,
  KbDto, KbFileDto, KbFilePage, KbChunkDto, KbBindingDto, KbSearchHitDto, TrashItemDto, ExpertDto,
  ScheduledTaskDto, TaskLogDto, TaskType,
  ArtifactItem, ArtifactValidation,
  ChannelDescriptor, ChannelConfigDto, ChannelTestResult, ChannelType, BrowserCapabilityDto,
  PluginDto,
  ConnectorDto, ConnectorToolDto, ConnectorAuditDto, ConnectorTestResult,
  ConnectorToolPolicy, CreateConnectorInput,
  BuiltinConnectorDto,
} from "@pi-web-ui/shared";
import { apiUrl, authHeaders } from "./endpoints.js";

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

export interface DatabaseBackupDto {
  name: string;
  path: string;
  size: number;
  createdAt: number;
}

export interface ReleaseInfoDto {
  version: string;
  date: string | null;
  body: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
const TRANSIENT_RETRY_MS = 1_000;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_MS));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(apiUrl(path), {
          method,
          headers: {
            ...authHeaders(),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        let data: unknown;
        try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
        if (!res.ok) {
          const detail = data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : `${method} ${path} failed: ${res.status}`;
          throw new Error(detail);
        }
        return data as T;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
      const isTransient =
        (error instanceof DOMException && error.name === "AbortError")
        || (error instanceof TypeError && /fetch/i.test(error.message));
      if (!isTransient || attempt === 1) throw error;
    }
  }
  throw lastError;
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
  markSessionRead: (sessionId: string, messageId?: string) =>
    request<SessionDto>("POST", `/sessions/${sessionId}/read`, messageId ? { messageId } : {}),
  getUnreadCount: () => request<{ count: number }>("GET", "/notifications/unread-count"),
  getBrowserCapability: (sessionId: string) =>
    request<BrowserCapabilityDto>("GET", `/sessions/${sessionId}/browser`),
  setBrowserCapability: (sessionId: string, enabled: boolean) =>
    request<BrowserCapabilityDto>("PUT", `/sessions/${sessionId}/browser`, { enabled }),
  listPlugins: () => request<PluginDto[]>("GET", "/plugins"),
  updatePlugin: (id: string, patch: { enabled?: boolean; settings?: Record<string, unknown> }) =>
    request<PluginDto>("PUT", `/plugins/${encodeURIComponent(id)}`, patch),

  listConnectors: (workspaceId?: string) => request<ConnectorDto[]>("GET", `/connectors${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`),
  listConnectorCatalog: () => request<BuiltinConnectorDto[]>("GET", "/connector-catalog"),
  connectBuiltinConnector: (key: string, token: string) => request<ConnectorDto>("POST", `/connector-catalog/${encodeURIComponent(key)}/connect`, { token }),
  getConnector: (id: string) => request<ConnectorDto>("GET", `/connectors/${encodeURIComponent(id)}`),
  createConnector: (input: CreateConnectorInput) => request<ConnectorDto>("POST", "/connectors", input),
  updateConnector: (id: string, patch: Partial<CreateConnectorInput> & { enabled?: boolean }) => request<ConnectorDto>("PUT", `/connectors/${encodeURIComponent(id)}`, patch),
  deleteConnector: (id: string) => request<void>("DELETE", `/connectors/${encodeURIComponent(id)}`),
  testConnector: (id: string) => request<ConnectorTestResult>("POST", `/connectors/${encodeURIComponent(id)}/test`),
  reconnectConnector: (id: string) => request<{ ok: boolean }>("POST", `/connectors/${encodeURIComponent(id)}/reconnect`),
  listConnectorTools: (id: string) => request<ConnectorToolDto[]>("GET", `/connectors/${encodeURIComponent(id)}/tools`),
  updateConnectorTool: (id: string, name: string, patch: { enabled?: boolean; policy?: ConnectorToolPolicy }) => request<ConnectorToolDto>("PATCH", `/connectors/${encodeURIComponent(id)}/tools/${encodeURIComponent(name)}`, patch),
  listConnectorAudits: (id: string) => request<ConnectorAuditDto[]>("GET", `/connectors/${encodeURIComponent(id)}/audits`),
  getSessionPlugins: (sessionId: string) =>
    request<{ selectedPluginIds: string[]; availablePlugins: PluginDto[] }>(
      "GET",
      `/sessions/${sessionId}/plugins`,
    ),
  setSessionPlugins: (sessionId: string, pluginIds: string[]) =>
    request<{
      session: SessionDto;
      selectedPluginIds: string[];
      availablePlugins: PluginDto[];
    }>("PUT", `/sessions/${sessionId}/plugins`, { pluginIds }),
  listSkills: () => request<SkillDto[]>("GET", "/skills"),
  importSkill: (data: { name: string; description: string; body: string }) =>
    request<SkillDto>("POST", "/skills", data),
  importSkillZip: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(apiUrl("/skills/import-zip"), { method: "POST", headers: authHeaders(), body: form }).then(async (res) => {
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
    apiUrl(`/files/${projectId}/raw?path=${encodeURIComponent(path)}`),
  createFile: (projectId: string, path: string, type: "file" | "directory") =>
    request<{ path: string }>("POST", `/files/${projectId}/create`, { path, type }),
  renameFile: (projectId: string, from: string, to: string) =>
    request<{ from: string; to: string }>("PUT", `/files/${projectId}/rename`, { from, to }),
  deleteFile: (projectId: string, path: string) =>
    request<void>("DELETE", `/files/${projectId}/delete?path=${encodeURIComponent(path)}`),
  openFile: (projectId: string, path: string, action: "reveal" | "open-file" | "open-with") =>
    request<{ ok: boolean; error?: string }>("POST", `/files/${projectId}/open`, { path, action }),

  validateArtifacts: (projectId: string, items: ArtifactItem[]) =>
    request<ArtifactValidation[]>("POST", `/files/${projectId}/validate-artifacts`, { items }),

  getConfig: () => request<ConfigDto>("GET", "/config"),
  updateConfig: (model: string) => request<ConfigDto>("PUT", "/config", { model }),
  getReleaseInfo: () => request<ReleaseInfoDto>("GET", "/release-info"),

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
    return fetch(apiUrl(`/knowledge-bases/${kbId}/files/import`), { method: "POST", headers: authHeaders(), body: form }).then(async (res) => {
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
    taskType: TaskType; payload?: string; projectId?: string;
    createNewSession?: boolean; enabled?: boolean;
  }) => request<ScheduledTaskDto>("POST", "/scheduled-tasks", data),
  updateScheduledTask: (id: string, data: {
    name?: string; description?: string; cronExpression?: string;
    taskType?: TaskType; payload?: string; projectId?: string | null;
    createNewSession?: boolean; enabled?: boolean;
  }) => request<ScheduledTaskDto>("PUT", `/scheduled-tasks/${id}`, data),
  deleteScheduledTask: (id: string) =>
    request<void>("DELETE", `/scheduled-tasks/${id}`),
  toggleScheduledTask: (id: string, enabled: boolean) =>
    request<ScheduledTaskDto>("PATCH", `/scheduled-tasks/${id}/toggle`, { enabled }),
  getScheduledTaskLogs: (id: string, limit?: number) =>
    request<TaskLogDto[]>("GET", `/scheduled-tasks/${id}/logs${limit ? `?limit=${limit}` : ""}`),
  runScheduledTask: (id: string) =>
    request<{ message: string }>("POST", `/scheduled-tasks/${id}/run`),

  // ─── Database backups ───
  listDatabaseBackups: () => request<DatabaseBackupDto[]>("GET", "/backups"),
  createDatabaseBackup: () => request<DatabaseBackupDto>("POST", "/backups"),
  validateDatabaseBackup: (name: string) =>
    request<{ ok: boolean; error?: string }>("POST", `/backups/${encodeURIComponent(name)}/validate`),

  // ─── Channels ───
  listChannelDescriptors: () =>
    request<ChannelDescriptor[]>("GET", "/channels/descriptors"),
  listChannelConfigs: () =>
    request<ChannelConfigDto[]>("GET", "/channels/configs"),
  createChannelConfig: (data: { type: ChannelType; name: string; enabled?: boolean; config: Record<string, unknown> }) =>
    request<ChannelConfigDto>("POST", "/channels/configs", data),
  updateChannelConfig: (id: string, patch: { name?: string; enabled?: boolean; config?: Record<string, unknown> }) =>
    request<ChannelConfigDto>("PUT", `/channels/configs/${id}`, patch),
  deleteChannelConfig: (id: string) =>
    request<void>("DELETE", `/channels/configs/${id}`),
  testChannelConfig: (id: string, payload: { text?: string; recipient?: string }) =>
    request<ChannelTestResult>("POST", `/channels/configs/${id}/test`, payload),

  // ─── WeChat channel (QR login flow) ───
  wechatStartLogin: () => request<{ ok: boolean }>("POST", "/channels/wechat/login"),
  wechatStatus: () =>
    request<{
      state: "idle" | "awaiting_scan" | "scanned" | "logged_in" | "expired" | "error";
      qrUrl?: string;
      qrDataUrl?: string;
      userId?: string;
      lastQrUrl?: string;
      error?: string;
    }>("GET", "/channels/wechat/status"),
  wechatLogout: () => request<{ ok: boolean }>("POST", "/channels/wechat/logout"),
  wechatConversations: () => request<{ userId: string; sessionId: string; title: string | null; updatedAt: number }[]>("GET", "/channels/wechat/conversations"),
  wechatTest: (userId: string, text?: string) =>
    request<{ ok: boolean; error?: string }>("POST", "/channels/wechat/test", { userId, text }),
};
