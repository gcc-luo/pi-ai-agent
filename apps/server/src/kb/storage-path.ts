import path from "node:path";

export function resolveKbStoragePath(rootDir: string, relativePath: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("invalid_storage_path");
  }
  return resolved;
}
