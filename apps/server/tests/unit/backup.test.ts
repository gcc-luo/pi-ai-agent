import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createDatabaseBackup, listDatabaseBackups, restoreDatabase, validateDatabaseBackup } from "../../src/db/backup.js";
import { openDatabase } from "../../src/db/sqlite.js";

describe("database backup", () => {
  it("creates, lists, validates, and restores a backup", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-backup-"));
    const dbPath = path.join(tmp, "source.sqlite");
    const backupDir = path.join(tmp, "backups");
    const db = openDatabase(dbPath);
    db.prepare("CREATE TABLE backup_probe (value TEXT NOT NULL)").run();
    db.prepare("INSERT INTO backup_probe (value) VALUES (?)").run("before");

    const backup = await createDatabaseBackup(db, backupDir, new Date("2026-08-16T12:34:56.000Z"));
    expect(backup.name).toBe("pi-web-ui-20260816T123456Z.sqlite");
    expect((await listDatabaseBackups(backupDir)).map((item) => item.name)).toEqual([backup.name]);
    expect(await validateDatabaseBackup(backup.path)).toEqual({ ok: true });

    db.prepare("UPDATE backup_probe SET value = 'after'").run();
    db.close();
    const rollbackPath = await restoreDatabase(backup.path, dbPath);
    expect(fs.existsSync(rollbackPath)).toBe(true);

    const restored = openDatabase(dbPath);
    expect(restored.prepare("SELECT value FROM backup_probe").pluck().get()).toBe("before");
    restored.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
