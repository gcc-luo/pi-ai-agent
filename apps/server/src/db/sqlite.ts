import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
