import type Database from "better-sqlite3";
import { KbBindingDto } from "@pi-web-ui/shared";

type Row = {
  session_id: string; kb_id: string; enabled: number;
  file_filter: string | null; bound_at: number;
};

function toDto(r: Row): KbBindingDto {
  return {
    kbId: r.kb_id,
    enabled: r.enabled === 1,
    fileFilter: r.file_filter ? JSON.parse(r.file_filter) as string[] : null,
    boundAt: r.bound_at,
  };
}

export class SessionKbBindingRepository {
  constructor(private db: Database.Database) {}

  listBySession(sessionId: string): KbBindingDto[] {
    return (this.db.prepare(
      "SELECT * FROM session_kb_bindings WHERE session_id = ?"
    ).all(sessionId) as Row[]).map(toDto);
  }

  replaceAll(sessionId: string, bindings: { kbId: string; fileFilter: string[] | null }[]): void {
    const del = this.db.prepare("DELETE FROM session_kb_bindings WHERE session_id = ?");
    const ins = this.db.prepare(
      "INSERT INTO session_kb_bindings (session_id, kb_id, enabled, file_filter, bound_at) VALUES (?, ?, 1, ?, ?)"
    );
    const now = Date.now();
    const tx = this.db.transaction(() => {
      del.run(sessionId);
      for (const b of bindings) {
        ins.run(sessionId, b.kbId, b.fileFilter ? JSON.stringify(b.fileFilter) : null, now);
      }
    });
    tx();
  }
}
