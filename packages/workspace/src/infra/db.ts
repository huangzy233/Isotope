import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function openWorkspaceDatabase(dataRoot: string): Database.Database {
  fs.mkdirSync(dataRoot, { recursive: true });
  const database = new Database(path.join(dataRoot, "isotope.sqlite"));
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
      ON projects(owner_user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      agent_name TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_project_created
      ON messages(project_id, created_at ASC);
  `);
  const cols = database
    .prepare(`PRAGMA table_info(messages)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "process_json")) {
    database.exec(`ALTER TABLE messages ADD COLUMN process_json TEXT`);
  }
  return database;
}
