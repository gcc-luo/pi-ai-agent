import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type BackupDatabase = Database.Database & { backup(filename: string): Promise<void> };

export interface DatabaseBackupInfo {
  name: string;
  path: string;
  size: number;
  createdAt: number;
}

export async function createDatabaseBackup(
  db: Database.Database,
  backupDir: string,
  now = new Date(),
): Promise<DatabaseBackupInfo> {
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const name = `pi-web-ui-${stamp}.sqlite`;
  const target = path.join(backupDir, name);
  await (db as BackupDatabase).backup(target);
  const stat = await fs.stat(target);
  return { name, path: target, size: stat.size, createdAt: stat.birthtimeMs || stat.mtimeMs };
}

export async function listDatabaseBackups(backupDir: string): Promise<DatabaseBackupInfo[]> {
  try {
    const entries = await fs.readdir(backupDir, { withFileTypes: true });
    const backups = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^pi-web-ui-\d{8}T\d{6}Z\.sqlite$/.test(entry.name))
      .map(async (entry) => {
        const target = path.join(backupDir, entry.name);
        const stat = await fs.stat(target);
        return { name: entry.name, path: target, size: stat.size, createdAt: stat.mtimeMs };
      }));
    return backups.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function validateDatabaseBackup(backupPath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = new Database(backupPath, { readonly: true });
    const result = db.prepare("PRAGMA integrity_check").pluck().get();
    db.close();
    return result === "ok" ? { ok: true } : { ok: false, error: String(result) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Restore is intentionally an offline operation: the target database must be
 * closed by the caller. A pre-restore copy is kept beside the target so a
 * failed rollout can be recovered manually.
 */
export async function restoreDatabase(backupPath: string, targetPath: string): Promise<string> {
  const validation = await validateDatabaseBackup(backupPath);
  if (!validation.ok) throw new Error(`invalid backup: ${validation.error ?? "integrity check failed"}`);
  const rollbackPath = `${targetPath}.before-restore`;
  if (fsSync.existsSync(targetPath)) await fs.rename(targetPath, rollbackPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (fsSync.existsSync(`${targetPath}${suffix}`)) await fs.rm(`${targetPath}${suffix}`, { force: true });
  }
  try {
    await fs.copyFile(backupPath, targetPath);
  } catch (error) {
    if (fsSync.existsSync(rollbackPath)) await fs.rename(rollbackPath, targetPath);
    throw error;
  }
  return rollbackPath;
}
