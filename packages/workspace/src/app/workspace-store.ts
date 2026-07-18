import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  Message,
  MessageProcess,
  MessageRole,
  Project,
  ProjectMode,
} from "../domain/types.js";
import { resolveWorkspaceRelativePath } from "../domain/paths.js";
import { openWorkspaceDatabase } from "../infra/db.js";
import {
  copyTemplate,
  ensureBuildDir,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../infra/fs-store.js";

export type ProjectPaths = {
  workspaceDir: string;
  buildDir: string;
};

export type WorkspaceStore = {
  createProject(input: {
    ownerUserId: string;
    name: string;
    mode: ProjectMode;
  }): Project;
  listProjects(ownerUserId: string): Project[];
  getProject(id: string): Project | null;
  updateProjectMeta(
    id: string,
    patch: { updatedAt?: string; name?: string; mode?: ProjectMode },
  ): void;
  appendMessage(input: {
    projectId: string;
    role: MessageRole;
    content: string;
    agentName?: string;
    process?: MessageProcess;
  }): Message;
  updateMessage(
    messageId: string,
    patch: { content?: string; process?: MessageProcess | null },
  ): Message | null;
  listMessages(projectId: string): Message[];
  deleteProject(id: string): void;
  readFile(projectId: string, relativePath: string): string;
  writeFile(projectId: string, relativePath: string, content: string): void;
  listFiles(projectId: string, relativeDir?: string): string[];
  getProjectPaths(projectId: string): ProjectPaths | null;
};
type ProjectRow = {
  id: string;
  owner_user_id: string;
  name: string;
  mode: ProjectMode;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  project_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  agent_name: string | null;
  process_json: string | null;
};

function parseProcessJson(
  processJson: string | null,
): MessageProcess | undefined {
  if (processJson === null || processJson === "") {
    return undefined;
  }
  try {
    return JSON.parse(processJson) as MessageProcess;
  } catch {
    return undefined;
  }
}

function randomId(prefix: "proj_" | "msg_"): string {
  return (
    prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 16)
  );
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): Message {
  const process = parseProcessJson(row.process_json);
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    ...(row.agent_name === null ? {} : { agentName: row.agent_name }),
    ...(process === undefined ? {} : { process }),
  };
}

export function createFsSqliteWorkspace(opts: {
  dataRoot: string;
  templatePath: string;
}): WorkspaceStore {
  const database = openWorkspaceDatabase(opts.dataRoot);
  const projectsRoot = path.join(opts.dataRoot, "projects");

  const projectWorkspaceDir = (projectId: string): string =>
    resolveWorkspaceRelativePath(projectsRoot, path.join(projectId, "workspace"));
  const projectBuildDir = (projectId: string): string =>
    resolveWorkspaceRelativePath(projectsRoot, path.join(projectId, "build"));

  return {
    createProject(input) {
      const now = new Date().toISOString();
      const project: Project = {
        id: randomId("proj_"),
        ownerUserId: input.ownerUserId,
        name: input.name,
        mode: input.mode,
        createdAt: now,
        updatedAt: now,
      };

      copyTemplate(opts.templatePath, projectWorkspaceDir(project.id));
      ensureBuildDir(projectBuildDir(project.id));
      database
        .prepare(
          `INSERT INTO projects
            (id, owner_user_id, name, mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project.id,
          project.ownerUserId,
          project.name,
          project.mode,
          project.createdAt,
          project.updatedAt,
        );
      return project;
    },

    listProjects(ownerUserId) {
      const rows = database
        .prepare(
          `SELECT id, owner_user_id, name, mode, created_at, updated_at
           FROM projects
           WHERE owner_user_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(ownerUserId) as ProjectRow[];
      return rows.map(toProject);
    },

    getProject(id) {
      const row = database
        .prepare(
          `SELECT id, owner_user_id, name, mode, created_at, updated_at
           FROM projects
           WHERE id = ?`,
        )
        .get(id) as ProjectRow | undefined;
      return row === undefined ? null : toProject(row);
    },

    updateProjectMeta(id, patch) {
      const assignments: string[] = [];
      const values: string[] = [];
      if (patch.updatedAt !== undefined) {
        assignments.push("updated_at = ?");
        values.push(patch.updatedAt);
      }
      if (patch.name !== undefined) {
        assignments.push("name = ?");
        values.push(patch.name);
      }
      if (patch.mode !== undefined) {
        assignments.push("mode = ?");
        values.push(patch.mode);
      }
      if (assignments.length === 0) {
        return;
      }
      values.push(id);
      database
        .prepare(`UPDATE projects SET ${assignments.join(", ")} WHERE id = ?`)
        .run(...values);
    },

    appendMessage(input) {
      const now = new Date().toISOString();
      const message: Message = {
        id: randomId("msg_"),
        projectId: input.projectId,
        role: input.role,
        content: input.content,
        createdAt: now,
        ...(input.agentName === undefined ? {} : { agentName: input.agentName }),
        ...(input.process === undefined ? {} : { process: input.process }),
      };
      const insertAndTouchProject = database.transaction(() => {
        database
          .prepare(
            `INSERT INTO messages
              (id, project_id, role, content, created_at, agent_name, process_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            message.id,
            message.projectId,
            message.role,
            message.content,
            message.createdAt,
            message.agentName ?? null,
            input.process ? JSON.stringify(input.process) : null,
          );
        database
          .prepare("UPDATE projects SET updated_at = ? WHERE id = ?")
          .run(now, input.projectId);
      });
      insertAndTouchProject();
      return message;
    },

    updateMessage(messageId, patch) {
      const row = database
        .prepare(
          `SELECT id, project_id, role, content, created_at, agent_name, process_json
           FROM messages WHERE id = ?`,
        )
        .get(messageId) as MessageRow | undefined;
      if (!row) return null;
      const now = new Date().toISOString();
      const content = patch.content ?? row.content;
      let processJson = row.process_json;
      if (patch.process !== undefined) {
        processJson =
          patch.process === null ? null : JSON.stringify(patch.process);
      }
      database.transaction(() => {
        database
          .prepare(
            `UPDATE messages SET content = ?, process_json = ? WHERE id = ?`,
          )
          .run(content, processJson, messageId);
        database
          .prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`)
          .run(now, row.project_id);
      })();
      return toMessage({
        ...row,
        content,
        process_json: processJson,
      });
    },

    listMessages(projectId) {
      const rows = database
        .prepare(
          `SELECT id, project_id, role, content, created_at, agent_name, process_json
           FROM messages
           WHERE project_id = ?
           ORDER BY created_at ASC`,
        )
        .all(projectId) as MessageRow[];
      return rows.map(toMessage);
    },

    deleteProject(id) {
      const projectDir = path.join(projectsRoot, id);
      const resolved = path.resolve(projectDir);
      const resolvedRoot = path.resolve(projectsRoot);
      if (
        resolved !== resolvedRoot &&
        !resolved.startsWith(resolvedRoot + path.sep)
      ) {
        throw new Error("Invalid path");
      }
      const tx = database.transaction(() => {
        database.prepare("DELETE FROM messages WHERE project_id = ?").run(id);
        database.prepare("DELETE FROM projects WHERE id = ?").run(id);
      });
      tx();
      fs.rmSync(resolved, { recursive: true, force: true });
    },

    readFile(projectId, relativePath) {
      return readWorkspaceFile(projectWorkspaceDir(projectId), relativePath);
    },

    writeFile(projectId, relativePath, content) {
      writeWorkspaceFile(projectWorkspaceDir(projectId), relativePath, content);
    },

    listFiles(projectId, relativeDir) {
      return listWorkspaceFiles(projectWorkspaceDir(projectId), relativeDir);
    },

    getProjectPaths(projectId) {
      if (!this.getProject(projectId)) {
        return null;
      }
      return {
        workspaceDir: projectWorkspaceDir(projectId),
        buildDir: projectBuildDir(projectId),
      };
    },
  };
}
