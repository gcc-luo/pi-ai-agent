import type { ProjectDto, SessionDto, MessageDto, FileNodeDto, FileContentDto } from "@pi-web-ui/shared";

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
  createProject: (name: string, description?: string) =>
    request<ProjectDto>("POST", "/projects", { name, description }),
  getProject: (id: string) => request<ProjectDto>("GET", `/projects/${id}`),
  deleteProject: (id: string) => request<void>("DELETE", `/projects/${id}`),

  listSessions: (projectId: string) => request<SessionDto[]>("GET", `/projects/${projectId}/sessions`),
  createSession: (projectId: string, parentId?: string) =>
    request<SessionDto>("POST", `/projects/${projectId}/sessions`, { parentId }),
  getSession: (id: string) => request<SessionDto>("GET", `/sessions/${id}`),
  deleteSession: (id: string) => request<void>("DELETE", `/sessions/${id}`),
  listMessages: (sessionId: string) => request<MessageDto[]>("GET", `/sessions/${sessionId}/messages`),

  listFiles: (projectId: string, dir = "/") =>
    request<FileNodeDto[]>("GET", `/files/${projectId}/list?path=${encodeURIComponent(dir)}`),
  readFile: (projectId: string, path: string) =>
    request<FileContentDto>("GET", `/files/${projectId}/read?path=${encodeURIComponent(path)}`),
};
