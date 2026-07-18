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
  if (!cols.some((c) => c.name === "task_id")) {
    database.exec(`ALTER TABLE messages ADD COLUMN task_id TEXT`);
  }
  if (!cols.some((c) => c.name === "version_id")) {
    database.exec(`ALTER TABLE messages ADD COLUMN version_id TEXT`);
  }

  const projectCols = database
    .prepare(`PRAGMA table_info(projects)`)
    .all() as Array<{ name: string }>;
  const add = (name: string, ddl: string) => {
    if (!projectCols.some((c) => c.name === name)) {
      database.exec(ddl);
    }
  };
  add("plan_enabled", `ALTER TABLE projects ADD COLUMN plan_enabled INTEGER NOT NULL DEFAULT 0`);
  add("team_enabled", `ALTER TABLE projects ADD COLUMN team_enabled INTEGER NOT NULL DEFAULT 0`);
  add("plan_confirmed", `ALTER TABLE projects ADD COLUMN plan_confirmed INTEGER NOT NULL DEFAULT 0`);
  add("confirmed_requirement", `ALTER TABLE projects ADD COLUMN confirmed_requirement TEXT`);

  // 一次性回填：旧行 team_enabled 仍为 0 且 mode='team'
  database.exec(`
    UPDATE projects SET team_enabled = 1
    WHERE mode = 'team' AND team_enabled = 0
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      summary TEXT NOT NULL,
      preview_revision TEXT,
      snapshot_ref TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE (project_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_versions_project
      ON versions(project_id, number);

    CREATE TABLE IF NOT EXISTS pending_version_intents (
      project_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      assignee TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by_message_id TEXT,
      assignee_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_progress_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project
      ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON tasks(status);
  `);
  return database;
}
