import type { WorkspacePreviewTarget } from "../stores/workspace-tools.js";

export type WorkspacePreviewKind = WorkspacePreviewTarget["kind"];

export function getWorkspacePreviewKind(target: WorkspacePreviewTarget): WorkspacePreviewKind {
  return target.kind;
}
