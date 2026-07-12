import type { ProjectDto, SessionDto, MessageDto, FileNodeDto, FileContentDto, ModelDto, SkillDto } from "@pi-web-ui/shared";

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

  getConfig: () => request<ConfigDto>("GET", "/config"),
  updateConfig: (model: string) => request<ConfigDto>("PUT", "/config", { model }),

  listModels: () => request<ModelDto[]>("GET", "/models"),
  createModel: (data: { id: string; label: string; provider: string; apiBaseUrl?: string; apiKey?: string; isDefault?: boolean }) =>
    request<ModelDto>("POST", "/models", data),
  updateModel: (id: string, data: { label?: string; provider?: string; apiBaseUrl?: string | null; apiKey?: string | null; isDefault?: boolean }) =>
    request<ModelDto>("PUT", "/models", { id, ...data }),
  deleteModel: (id: string) => request<void>("DELETE", `/models?id=${encodeURIComponent(id)}`),
  testModel: (data: { id?: string; provider: string; apiBaseUrl?: string; apiKey?: string; modelId?: string }) =>
    request<{ ok: boolean; error?: string }>("POST", "/models/test", data),

  browseDir: (dirPath?: string) =>
    request<{ currentPath: string; parentPath: string; directories: { name: string; path: string }[] }>("GET", `/fs/browse${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ""}`),
};
