import type { Task, WorkspaceStore } from "@isotope/workspace";
import { getProject } from "./get-project.js";

export function listTasks(
  input: { ownerUserId: string; projectId: string },
  workspace: WorkspaceStore,
): Task[] | null {
  if (!getProject(
    { ownerUserId: input.ownerUserId, projectId: input.projectId },
    workspace,
  )) {
    return null;
  }
  return workspace.listTasks(input.projectId);
}
