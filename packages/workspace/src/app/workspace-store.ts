import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  Message,
  MessageProcess,
  MessageRole,
  Project,
  ProjectMode,
  Task,
  TaskStatus,
  Version,
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
    planEnabled?: boolean;
    teamEnabled?: boolean;
    mode?: ProjectMode;
  }): Project;
  listProjects(ownerUserId: string): Project[];
  getProject(id: string): Project | null;
  updateProjectMeta(
    id: string,
    patch: {
      updatedAt?: string;
      name?: string;
      mode?: ProjectMode;
      planEnabled?: boolean;
      teamEnabled?: boolean;
      planConfirmed?: boolean;
      confirmedRequirement?: string | null;
    },
  ): void;
  appendMessage(input: {
    projectId: string;
    role: MessageRole;
    content: string;
    agentName?: string;
    process?: MessageProcess;
    taskId?: string | null;
    versionId?: string | null;
  }): Message;
  updateMessage(
    messageId: string,
    patch: {
      content?: string;
      process?: MessageProcess | null;
      taskId?: string | null;
    },
  ): Message | null;
  listMessages(projectId: string): Message[];
  upsertPendingVersionIntent(projectId: string): void;
  takePendingVersionIntent(projectId: string): boolean;
  recordVersion(input: {
    projectId: string;
    summary: string;
    previewRevision?: string | null;
  }): Version;
  listVersions(projectId: string): Version[];
  createTask(input: {
    projectId: string;
    title: string;
    assignee: "Alex";
    status?: TaskStatus;
    createdByMessageId?: string;
  }): Task;
  updateTask(
    taskId: string,
    patch: Partial<
      Pick<
        Task,
        | "title"
        | "status"
        | "assigneeMessageId"
        | "createdByMessageId"
        | "lastProgressAt"
      >
    >,
  ): Task | null;
  getTask(taskId: string): Task | null;
  listTasks(projectId: string): Task[];
  listTasksByStatus(statuses: TaskStatus[]): Task[];
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
  plan_enabled: number;
  team_enabled: number;
  plan_confirmed: number;
  confirmed_requirement: string | null;
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
  task_id: string | null;
  version_id: string | null;
  version_number?: number | null;
};

type VersionRow = {
  id: string;
  project_id: string;
  number: number;
  summary: string;
  preview_revision: string | null;
  snapshot_ref: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  assignee: "Alex";
  status: TaskStatus;
  created_by_message_id: string | null;
  assignee_message_id: string | null;
  created_at: string;
  updated_at: string;
  last_progress_at: string;
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

function randomId(prefix: "proj_" | "msg_" | "task_" | "ver_"): string {
  return (
    prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 16)
  );
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    mode: row.team_enabled ? "team" : "engineer",
    planEnabled: row.plan_enabled === 1,
    teamEnabled: row.team_enabled === 1,
    planConfirmed: row.plan_confirmed === 1,
    ...(row.confirmed_requirement === null || row.confirmed_requirement === undefined
      ? {}
      : { confirmedRequirement: row.confirmed_requirement }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PROJECT_SELECT = `id, owner_user_id, name, mode, plan_enabled, team_enabled,
  plan_confirmed, confirmed_requirement, created_at, updated_at`;

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
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    ...(row.version_id === null || row.version_id === undefined
      ? {}
      : { versionId: row.version_id }),
    ...(row.version_number === null || row.version_number === undefined
      ? {}
      : { versionNumber: row.version_number }),
  };
}

function toVersion(row: VersionRow): Version {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    summary: row.summary,
    previewRevision: row.preview_revision,
    snapshotRef: row.snapshot_ref,
    createdAt: row.created_at,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    assignee: row.assignee,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastProgressAt: row.last_progress_at,
    ...(row.created_by_message_id === null
      ? {}
      : { createdByMessageId: row.created_by_message_id }),
    ...(row.assignee_message_id === null
      ? {}
      : { assigneeMessageId: row.assignee_message_id }),
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
      const planEnabled = input.planEnabled ?? false;
      const teamEnabled =
        input.teamEnabled !== undefined
          ? input.teamEnabled
          : input.mode === "team";
      const mode: ProjectMode = teamEnabled ? "team" : "engineer";
      const project: Project = {
        id: randomId("proj_"),
        ownerUserId: input.ownerUserId,
        name: input.name,
        mode,
        planEnabled,
        teamEnabled,
        planConfirmed: false,
        createdAt: now,
        updatedAt: now,
      };

      copyTemplate(opts.templatePath, projectWorkspaceDir(project.id));
      ensureBuildDir(projectBuildDir(project.id));
      database
        .prepare(
          `INSERT INTO projects
            (id, owner_user_id, name, mode, plan_enabled, team_enabled,
             plan_confirmed, confirmed_requirement, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project.id,
          project.ownerUserId,
          project.name,
          project.mode,
          project.planEnabled ? 1 : 0,
          project.teamEnabled ? 1 : 0,
          0,
          null,
          project.createdAt,
          project.updatedAt,
        );
      return project;
    },

    listProjects(ownerUserId) {
      const rows = database
        .prepare(
          `SELECT ${PROJECT_SELECT}
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
          `SELECT ${PROJECT_SELECT}
           FROM projects
           WHERE id = ?`,
        )
        .get(id) as ProjectRow | undefined;
      return row === undefined ? null : toProject(row);
    },

    updateProjectMeta(id, patch) {
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];
      if (patch.updatedAt !== undefined) {
        assignments.push("updated_at = ?");
        values.push(patch.updatedAt);
      }
      if (patch.name !== undefined) {
        assignments.push("name = ?");
        values.push(patch.name);
      }
      if (patch.planEnabled !== undefined) {
        assignments.push("plan_enabled = ?");
        values.push(patch.planEnabled ? 1 : 0);
      }
      if (patch.teamEnabled !== undefined) {
        assignments.push("team_enabled = ?");
        values.push(patch.teamEnabled ? 1 : 0);
        assignments.push("mode = ?");
        values.push(patch.teamEnabled ? "team" : "engineer");
      } else if (patch.mode !== undefined) {
        assignments.push("mode = ?");
        values.push(patch.mode);
        assignments.push("team_enabled = ?");
        values.push(patch.mode === "team" ? 1 : 0);
      }
      if (patch.planConfirmed !== undefined) {
        assignments.push("plan_confirmed = ?");
        values.push(patch.planConfirmed ? 1 : 0);
      }
      if (patch.confirmedRequirement !== undefined) {
        assignments.push("confirmed_requirement = ?");
        values.push(patch.confirmedRequirement);
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
        ...(input.taskId === undefined || input.taskId === null
          ? {}
          : { taskId: input.taskId }),
        ...(input.versionId === undefined || input.versionId === null
          ? {}
          : { versionId: input.versionId }),
      };
      if (input.versionId) {
        const ver = database
          .prepare(`SELECT number FROM versions WHERE id = ?`)
          .get(input.versionId) as { number: number } | undefined;
        if (ver) {
          message.versionNumber = ver.number;
        }
      }
      const insertAndTouchProject = database.transaction(() => {
        database
          .prepare(
            `INSERT INTO messages
              (id, project_id, role, content, created_at, agent_name, process_json, task_id, version_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            message.id,
            message.projectId,
            message.role,
            message.content,
            message.createdAt,
            message.agentName ?? null,
            input.process ? JSON.stringify(input.process) : null,
            input.taskId ?? null,
            input.versionId ?? null,
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
          `SELECT id, project_id, role, content, created_at, agent_name, process_json, task_id, version_id
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
      let taskId = row.task_id;
      if (patch.taskId !== undefined) {
        taskId = patch.taskId;
      }
      database.transaction(() => {
        database
          .prepare(
            `UPDATE messages SET content = ?, process_json = ?, task_id = ? WHERE id = ?`,
          )
          .run(content, processJson, taskId, messageId);
        database
          .prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`)
          .run(now, row.project_id);
      })();
      return toMessage({
        ...row,
        content,
        process_json: processJson,
        task_id: taskId,
      });
    },

    listMessages(projectId) {
      const rows = database
        .prepare(
          `SELECT m.id, m.project_id, m.role, m.content, m.created_at, m.agent_name,
                  m.process_json, m.task_id, m.version_id, v.number AS version_number
           FROM messages m
           LEFT JOIN versions v ON v.id = m.version_id
           WHERE m.project_id = ?
           ORDER BY m.created_at ASC`,
        )
        .all(projectId) as MessageRow[];
      return rows.map(toMessage);
    },

    upsertPendingVersionIntent(projectId) {
      const now = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO pending_version_intents (project_id, created_at)
           VALUES (?, ?)
           ON CONFLICT(project_id) DO UPDATE SET created_at = excluded.created_at`,
        )
        .run(projectId, now);
    },

    takePendingVersionIntent(projectId) {
      const take = database.transaction(() => {
        const row = database
          .prepare(
            `SELECT project_id FROM pending_version_intents WHERE project_id = ?`,
          )
          .get(projectId) as { project_id: string } | undefined;
        if (!row) return false;
        database
          .prepare(`DELETE FROM pending_version_intents WHERE project_id = ?`)
          .run(projectId);
        return true;
      });
      return take();
    },

    recordVersion(input) {
      const now = new Date().toISOString();
      const insert = database.transaction(() => {
        const maxRow = database
          .prepare(
            `SELECT COALESCE(MAX(number), 0) AS max_number
             FROM versions WHERE project_id = ?`,
          )
          .get(input.projectId) as { max_number: number };
        const version: Version = {
          id: randomId("ver_"),
          projectId: input.projectId,
          number: maxRow.max_number + 1,
          summary: input.summary,
          previewRevision: input.previewRevision ?? null,
          snapshotRef: null,
          createdAt: now,
        };
        database
          .prepare(
            `INSERT INTO versions
              (id, project_id, number, summary, preview_revision, snapshot_ref, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            version.id,
            version.projectId,
            version.number,
            version.summary,
            version.previewRevision,
            version.snapshotRef,
            version.createdAt,
          );
        return version;
      });
      return insert();
    },

    listVersions(projectId) {
      const rows = database
        .prepare(
          `SELECT id, project_id, number, summary, preview_revision, snapshot_ref, created_at
           FROM versions
           WHERE project_id = ?
           ORDER BY number ASC`,
        )
        .all(projectId) as VersionRow[];
      return rows.map(toVersion);
    },

    createTask(input) {
      const now = new Date().toISOString();
      const task: Task = {
        id: randomId("task_"),
        projectId: input.projectId,
        title: input.title,
        assignee: input.assignee,
        status: input.status ?? "assigned",
        createdAt: now,
        updatedAt: now,
        lastProgressAt: now,
        ...(input.createdByMessageId === undefined
          ? {}
          : { createdByMessageId: input.createdByMessageId }),
      };
      database
        .prepare(
          `INSERT INTO tasks
            (id, project_id, title, assignee, status, created_by_message_id,
             assignee_message_id, created_at, updated_at, last_progress_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.projectId,
          task.title,
          task.assignee,
          task.status,
          task.createdByMessageId ?? null,
          task.assigneeMessageId ?? null,
          task.createdAt,
          task.updatedAt,
          task.lastProgressAt,
        );
      return task;
    },

    updateTask(taskId, patch) {
      const row = database
        .prepare(
          `SELECT id, project_id, title, assignee, status, created_by_message_id,
                  assignee_message_id, created_at, updated_at, last_progress_at
           FROM tasks WHERE id = ?`,
        )
        .get(taskId) as TaskRow | undefined;
      if (!row) return null;

      const now = new Date().toISOString();
      const title = patch.title ?? row.title;
      const status = patch.status ?? row.status;
      const createdByMessageId =
        patch.createdByMessageId !== undefined
          ? patch.createdByMessageId
          : row.created_by_message_id;
      const assigneeMessageId =
        patch.assigneeMessageId !== undefined
          ? patch.assigneeMessageId
          : row.assignee_message_id;
      const statusChanged = patch.status !== undefined && patch.status !== row.status;
      const lastProgressAt =
        patch.lastProgressAt !== undefined
          ? patch.lastProgressAt
          : statusChanged
            ? now
            : row.last_progress_at;

      database
        .prepare(
          `UPDATE tasks
           SET title = ?, status = ?, created_by_message_id = ?,
               assignee_message_id = ?, updated_at = ?, last_progress_at = ?
           WHERE id = ?`,
        )
        .run(
          title,
          status,
          createdByMessageId,
          assigneeMessageId,
          now,
          lastProgressAt,
          taskId,
        );

      return toTask({
        ...row,
        title,
        status,
        created_by_message_id: createdByMessageId,
        assignee_message_id: assigneeMessageId,
        updated_at: now,
        last_progress_at: lastProgressAt,
      });
    },

    getTask(taskId) {
      const row = database
        .prepare(
          `SELECT id, project_id, title, assignee, status, created_by_message_id,
                  assignee_message_id, created_at, updated_at, last_progress_at
           FROM tasks WHERE id = ?`,
        )
        .get(taskId) as TaskRow | undefined;
      return row === undefined ? null : toTask(row);
    },

    listTasks(projectId) {
      const rows = database
        .prepare(
          `SELECT id, project_id, title, assignee, status, created_by_message_id,
                  assignee_message_id, created_at, updated_at, last_progress_at
           FROM tasks
           WHERE project_id = ?
           ORDER BY created_at ASC`,
        )
        .all(projectId) as TaskRow[];
      return rows.map(toTask);
    },

    listTasksByStatus(statuses) {
      if (statuses.length === 0) {
        return [];
      }
      const placeholders = statuses.map(() => "?").join(", ");
      const rows = database
        .prepare(
          `SELECT id, project_id, title, assignee, status, created_by_message_id,
                  assignee_message_id, created_at, updated_at, last_progress_at
           FROM tasks
           WHERE status IN (${placeholders})
           ORDER BY created_at ASC`,
        )
        .all(...statuses) as TaskRow[];
      return rows.map(toTask);
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
        database
          .prepare("DELETE FROM pending_version_intents WHERE project_id = ?")
          .run(id);
        database.prepare("DELETE FROM versions WHERE project_id = ?").run(id);
        database.prepare("DELETE FROM tasks WHERE project_id = ?").run(id);
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
