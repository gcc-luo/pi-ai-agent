export function projectNameFromPath(workdir: string): string {
  const normalized = workdir.replace(/[\\/]+$/, "");
  if (!normalized) return "Untitled";
  if (/^[A-Za-z]:$/.test(normalized)) return "Untitled";
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "Untitled";
}
