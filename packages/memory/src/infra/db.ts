import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function openMemoryDatabase(dataRoot: string): Database.Database {
  fs.mkdirSync(dataRoot, { recursive: true });
  const database = new Database(path.join(dataRoot, "isotope.sqlite"));
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
  `);
  return database;
}
