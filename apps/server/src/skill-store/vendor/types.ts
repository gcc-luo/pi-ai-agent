export type CatalogProviderId = "skills-sh" | "skillsmp";
export type ProviderId = CatalogProviderId | "github";
export type SearchMode = "keyword" | "ai";
export type SkillRootType = "local" | "external";
export type SkillClassification = "managed" | "adopted" | "unknown" | "external" | "missing";
export type DriftStatus = "clean" | "drifted" | "missing" | "untracked" | "external";
export type ProvenanceKind = "installed" | "adopted";
export type BrowserSortMode = "relevance" | "popularity" | "name" | "provider";
export type BrowserProviderFilter = "all" | CatalogProviderId;
export type UpdateStatus = "available" | "current" | "unknown" | "blocked";

export interface SkillSearchResult {
  id: string;
  name: string;
  author: string;
  description: string;
  popularity: number;
  provider: ProviderId;
  sourceUrl?: string | undefined;
  githubUrl?: string | undefined;
  sourceOwner?: string | undefined;
  sourceRepository?: string | undefined;
  sourcePath?: string | undefined;
  installHint?: string | undefined;
  installReference?: string | undefined;
}

export interface ProviderSearchSummary {
  provider: CatalogProviderId;
  count: number;
  error?: string | undefined;
}

export interface AggregatedSearchResult {
  query: string;
  mode: SearchMode;
  skills: SkillSearchResult[];
  sources: ProviderSearchSummary[];
}

export interface SkillFingerprint {
  algorithm: "sha256";
  digest: string;
  fileCount: number;
  totalBytes: number;
}

export interface ProvenanceEntry {
  name: string;
  localPath: string;
  provenance: ProvenanceKind;
  provider?: ProviderId | undefined;
  sourceId?: string | undefined;
  sourceUrl?: string | undefined;
  sourceOwner?: string | undefined;
  sourceRepository?: string | undefined;
  sourcePath?: string | undefined;
  sourceType?: string | undefined;
  ref?: string | undefined;
  skillPath?: string | undefined;
  sourceTransport?: string | undefined;
  installedAt: string;
  updatedAt: string;
  fingerprint: SkillFingerprint;
}

export interface ProvenanceManifest {
  version: 1;
  updatedAt: string;
  skills: Record<string, ProvenanceEntry>;
}

export interface SkillMetadata {
  name: string;
  description: string;
  hasSkillFile: boolean;
}

export interface InventoryItem {
  name: string;
  path: string;
  rootType: SkillRootType;
  classification: SkillClassification;
  driftStatus: DriftStatus;
  metadata: SkillMetadata;
  fingerprint?: SkillFingerprint | undefined;
  manifestEntry?: ProvenanceEntry | undefined;
}

export interface InventorySnapshot {
  localRoot: string;
  externalRoots: string[];
  items: InventoryItem[];
  manifestOnlyMissing: InventoryItem[];
}

export type SkillPreviewAuditStatus = "pass" | "fail" | "warning" | "unknown";
export type SkillPreviewMetadataStatus = "available" | "partial" | "unavailable";

export interface SkillPreviewAudit {
  label: string;
  status: SkillPreviewAuditStatus;
}

export interface SkillPreviewMetadata {
  provider: ProviderId;
  weeklyInstalls?: number | undefined;
  githubStars?: number | undefined;
  securityAudits: SkillPreviewAudit[];
  status: SkillPreviewMetadataStatus;
}

export interface SkillContentPreview {
  title: string;
  body: string;
  source: "remote" | "metadata";
  limitation?: string | undefined;
  metadata: SkillPreviewMetadata;
}

export interface UpdateDiffSummary {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface UpdateStatusResult {
  item: InventoryItem;
  status: UpdateStatus;
  applicable: boolean;
  reason: string;
  localFingerprint?: SkillFingerprint | undefined;
  upstreamFingerprint?: SkillFingerprint | undefined;
  diff?: UpdateDiffSummary | undefined;
}

export interface UpdateStatusReport {
  target?: string | undefined;
  checkedAt: string;
  results: UpdateStatusResult[];
}

export interface StagedProviderContent {
  provider: ProviderId;
  sourceId: string;
  stagingPath: string;
  fingerprint: SkillFingerprint;
  diff: UpdateDiffSummary;
}

export type PlanAction = "adopt" | "install" | "update" | "remove" | "refresh" | "bind_source";
export type PlanOperationKind = "write_manifest" | "run_command" | "delete_directory" | "scan_inventory" | "stage_content" | "replace_directory" | "skip";

export interface PlanOperation {
  kind: PlanOperationKind;
  target: string;
  description: string;
  protected: boolean;
}

export interface SafetyPlan {
  action: PlanAction;
  title: string;
  previewOnly: boolean;
  requiresConfirmation: boolean;
  confirmationToken?: string | undefined;
  canApply: boolean;
  operations: PlanOperation[];
  blocked: PlanOperation[];
  warnings: string[];
}

export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<CommandRunnerResult>;
}
