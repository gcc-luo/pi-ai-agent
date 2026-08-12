import type Database from "better-sqlite3";

export interface KbParseJob {
  fileId: string;
  attempts: number;
  maxAttempts: number;
}

const LEASE_MS = 30_000;

export class KbParseJobRepository {
  constructor(private db: Database.Database) {}

  recoverInterrupted(): number {
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE kb_parse_jobs
      SET status = 'queued', available_at = ?, leased_at = NULL,
          lease_expires_at = NULL, updated_at = ?
      WHERE status = 'running'
    `).run(now, now);
    this.db.prepare(`
      UPDATE kb_files SET status = 'pending', updated_at = ?
      WHERE status = 'parsing'
        AND id IN (SELECT file_id FROM kb_parse_jobs WHERE status = 'queued')
    `).run(now);
    return result.changes;
  }

  recoverExpired(): number {
    const now = Date.now();
    return this.db.prepare(`
      UPDATE kb_parse_jobs
      SET status = 'queued', available_at = ?, leased_at = NULL,
          lease_expires_at = NULL, updated_at = ?
      WHERE status = 'running' AND lease_expires_at < ?
    `).run(now, now, now).changes;
  }

  enqueue(fileId: string): void {
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO kb_parse_jobs (
          file_id, status, attempts, max_attempts, available_at,
          leased_at, last_error, rerun_requested, created_at, updated_at
        ) VALUES (?, 'queued', 0, 3, ?, NULL, NULL, 0, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
          status = CASE WHEN kb_parse_jobs.status = 'running' THEN 'running' ELSE 'queued' END,
          attempts = CASE WHEN kb_parse_jobs.status = 'running' THEN kb_parse_jobs.attempts ELSE 0 END,
          available_at = excluded.available_at,
          leased_at = CASE WHEN kb_parse_jobs.status = 'running' THEN kb_parse_jobs.leased_at ELSE NULL END,
          lease_expires_at = CASE WHEN kb_parse_jobs.status = 'running' THEN kb_parse_jobs.lease_expires_at ELSE NULL END,
          last_error = NULL,
          rerun_requested = CASE WHEN kb_parse_jobs.status = 'running' THEN 1 ELSE 0 END,
          updated_at = excluded.updated_at
      `).run(fileId, now, now, now);
      this.db.prepare(`
        UPDATE kb_files SET status = 'pending', fail_reason = NULL, updated_at = ?
        WHERE id = ? AND status != 'parsing'
      `).run(now, fileId);
    })();
  }

  claimNext(): KbParseJob | null {
    return this.db.transaction(() => {
      const now = Date.now();
      const row = this.db.prepare(`
        SELECT file_id, attempts, max_attempts
        FROM kb_parse_jobs
        WHERE status = 'queued' AND available_at <= ?
        ORDER BY available_at, created_at
        LIMIT 1
      `).get(now) as { file_id: string; attempts: number; max_attempts: number } | undefined;
      if (!row) return null;
      const claimed = this.db.prepare(`
        UPDATE kb_parse_jobs
        SET status = 'running', attempts = attempts + 1,
            leased_at = ?, lease_expires_at = ?, updated_at = ?
        WHERE file_id = ? AND status = 'queued'
      `).run(now, now + LEASE_MS, now, row.file_id);
      if (claimed.changes !== 1) return null;
      return {
        fileId: row.file_id,
        attempts: row.attempts + 1,
        maxAttempts: row.max_attempts,
      };
    })();
  }

  heartbeat(fileId: string): boolean {
    const now = Date.now();
    return this.db.prepare(`
      UPDATE kb_parse_jobs
      SET leased_at = ?, lease_expires_at = ?, updated_at = ?
      WHERE file_id = ? AND status = 'running'
    `).run(now, now + LEASE_MS, now, fileId).changes === 1;
  }

  complete(fileId: string): void {
    this.db.transaction(() => {
      const row = this.db.prepare(
        "SELECT rerun_requested FROM kb_parse_jobs WHERE file_id = ?"
      ).get(fileId) as { rerun_requested: number } | undefined;
      if (row?.rerun_requested === 1) {
        const now = Date.now();
        this.db.prepare(`
          UPDATE kb_parse_jobs
          SET status = 'queued', attempts = 0, available_at = ?, leased_at = NULL,
              lease_expires_at = NULL, rerun_requested = 0, updated_at = ?
          WHERE file_id = ?
        `).run(now, now, fileId);
      } else {
        this.db.prepare("DELETE FROM kb_parse_jobs WHERE file_id = ?").run(fileId);
      }
    })();
  }

  retryOrFail(job: KbParseJob, error: string): boolean {
    const now = Date.now();
    if (job.attempts >= job.maxAttempts) {
      this.db.prepare(`
        UPDATE kb_parse_jobs
        SET status = 'failed', leased_at = NULL, lease_expires_at = NULL,
            last_error = ?, updated_at = ?
        WHERE file_id = ?
      `).run(error, now, job.fileId);
      return false;
    }
    const delayMs = Math.min(30_000, 1_000 * 3 ** (job.attempts - 1));
    this.db.prepare(`
      UPDATE kb_parse_jobs
      SET status = 'queued', available_at = ?, leased_at = NULL,
          lease_expires_at = NULL, last_error = ?, updated_at = ?
      WHERE file_id = ?
    `).run(now + delayMs, error, now, job.fileId);
    return true;
  }
}
